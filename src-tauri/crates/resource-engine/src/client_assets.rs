#[cfg(not(target_os = "emscripten"))]
use crate::apk::{Archive, Member, DATA};
#[cfg(not(target_os = "emscripten"))]
use crate::cache::{resource_path, safe_path};
use crate::net::Client;
use crate::{
    artifacts,
    cache::{write_json, Cache},
    error::{checkpoint, Error},
    progress::{Observer, Progress, TransferState},
    source::{self, Entry},
    unity,
};
use anyhow::{ensure, Context, Result};
use futures_util::{StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "emscripten"))]
use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{io::AsyncWriteExt, sync::Semaphore};
use tokio_util::sync::CancellationToken;

const FILES: &str = "files";

#[derive(Clone, Debug)]
struct FileEntry {
    size: u64,
    compressed: u64,
    content_key: String,
    #[cfg(not(target_os = "emscripten"))]
    parts: Vec<Member>,
    #[cfg(target_os = "emscripten")]
    download: String,
}

#[cfg(not(target_os = "emscripten"))]
fn files(archive: &Archive) -> Result<BTreeMap<String, FileEntry>> {
    let mut groups: BTreeMap<String, BTreeMap<usize, Member>> = BTreeMap::new();
    let mut direct = BTreeSet::new();
    for entry in archive.members.values() {
        let Some(name) = entry.name.strip_prefix(DATA) else {
            continue;
        };
        let (name, part) = match name.rsplit_once(".split") {
            Some((name, suffix))
                if !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit()) =>
            {
                (name, suffix.parse::<usize>()?)
            }
            _ => {
                direct.insert(name.to_owned());
                (name, 0)
            }
        };
        resource_path(name)?;
        ensure!(
            groups
                .entry(name.to_owned())
                .or_default()
                .insert(part, entry.clone())
                .is_none(),
            "Duplicate Android resource part"
        );
    }
    let mut files = BTreeMap::new();
    for (name, parts) in groups {
        ensure!(
            parts.keys().copied().eq(0..parts.len())
                && (!direct.contains(&name) || parts.len() == 1),
            "Android resource parts are incomplete: {name}"
        );
        let parts = parts.into_values().collect::<Vec<_>>();
        let content_key =
            artifacts::fingerprint(&parts.iter().map(|p| (p.size, p.crc)).collect::<Vec<_>>())?;
        files.insert(
            name,
            FileEntry {
                size: parts.iter().map(|p| p.size).sum(),
                compressed: parts.iter().map(|p| p.compressed).sum(),
                content_key,
                parts,
            },
        );
    }
    ensure!(
        files.contains_key("globalgamemanagers.assets"),
        "Android builtin resources missing"
    );
    Ok(files)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientIdentity {
    pub client_version: String,
    pub manifest_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Location {
    pub file: String,
    pub path_id: i64,
    pub class_id: i32,
    pub name: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct FileObjects {
    content_key: String,
    objects: Vec<Location>,
}
#[derive(Default, Serialize, Deserialize)]
struct ObjectIndex {
    files: BTreeMap<String, FileObjects>,
}

#[derive(Clone)]
pub struct ClientAssets {
    cache: Arc<Cache>,
    pub identity: ClientIdentity,
    entries: Arc<BTreeMap<String, FileEntry>>,
    #[cfg(not(target_os = "emscripten"))]
    archive: Arc<Archive>,
    client: Client,
    cancel: CancellationToken,
    slots: Arc<Semaphore>,
    observer: Option<Arc<dyn Observer>>,
    allow_network: bool,
}
impl ClientAssets {
    pub fn with_progress(&self, progress: Arc<Progress>) -> Self {
        Self {
            cancel: progress.cancel.clone(),
            observer: Some(progress),
            ..self.clone()
        }
    }
    pub fn detached(&self, cancel: CancellationToken) -> Self {
        Self {
            cancel,
            observer: None,
            ..self.clone()
        }
    }
    fn trace(
        &self,
        name: &str,
        state: TransferState,
        downloaded: Option<u64>,
        cached: Option<bool>,
    ) {
        if let (Some(observer), Some(entry)) = (&self.observer, self.entries.get(name)) {
            let key = format!(
                "client:{}:{}:{name}",
                self.identity.client_version, self.identity.manifest_sha256
            );
            observer.transfer(&key, name, entry.compressed, state, downloaded, cached);
        }
    }
    pub async fn environment(
        &self,
        files: &[String],
        reference: Arc<unity::Unity>,
    ) -> Result<unity::Unity> {
        let mut names: BTreeSet<String> = files.iter().cloned().collect();
        names.insert("globalgamemanagers.assets".into());
        let mut paths: Vec<PathBuf> = futures_util::stream::iter(names)
            .map(|name| async move { self.file(&name).await })
            .buffer_unordered(4)
            .try_collect()
            .await?;
        let inputs = paths.clone();
        let schemas = reference.clone();
        let cancel = self.cancel.clone();
        let streams = crate::runtime::blocking(move || {
            let mut env = unity::Unity::open(&inputs, cancel)?;
            env.bind_schemas(&schemas)?;
            let mut streams = BTreeSet::new();
            for object in env.studio.objects().filter(|o| o.class_id() == 28) {
                let id = unity::ObjectId {
                    file: object.file_index(),
                    path: object.path_id(),
                };
                let stream = env.field(id, "m_StreamData")?;
                if let Some(path) = stream["path"].as_str().filter(|s| !s.is_empty()) {
                    let filename = path
                        .replace('\\', "/")
                        .rsplit('/')
                        .next()
                        .unwrap_or_default()
                        .to_owned();
                    ensure!(!filename.is_empty(), "Invalid official texture stream path");
                    streams.insert(filename);
                }
            }
            Ok::<_, anyhow::Error>(streams)
        })
        .await??;
        let streams: Vec<PathBuf> = futures_util::stream::iter(streams)
            .map(|name| async move { self.file(&name).await })
            .buffer_unordered(4)
            .try_collect()
            .await?;
        paths.extend(streams);
        let cancel = self.cancel.clone();
        crate::runtime::blocking(move || {
            let mut env = unity::Unity::open(&paths, cancel)?;
            env.bind_schemas(&reference)?;
            Ok(env)
        })
        .await?
    }

    #[cfg(not(target_os = "emscripten"))]
    pub async fn open_mode(
        data: &Path,
        version: &str,
        cancel: CancellationToken,
        allow_network: bool,
    ) -> Result<Self> {
        let cache = Arc::new(Cache::new(data.join("client"))?);
        let directory = safe_path(&cache.root, FILES)?;
        let old = safe_path(&cache.root, "Windows")?;
        if !directory.exists() && old.is_dir() {
            ensure!(
                old.canonicalize()?.parent() == Some(cache.root.as_path()),
                "Client cache escaped its root"
            );
            fs::rename(old, &directory)?;
        }
        let record = cache.path(FILES, "source.json")?;
        let lock = source::path_lock(&record)?;
        let _guard = tokio::select! {biased;_=cancel.cancelled()=>return Err(crate::error::Error::Cancelled.into()),g=lock.lock()=>g};
        let saved = tokio::fs::read(&record)
            .await
            .ok()
            .and_then(|raw| serde_json::from_slice::<(String, Archive)>(&raw).ok())
            .filter(|(sha, a)| {
                a.client_version == version && artifacts::fingerprint(a).ok().as_ref() == Some(sha)
            })
            .map(|(_, a)| a);
        let client = source::client()?;
        let archive = if allow_network {
            match Archive::discover(&client, version, saved.as_ref(), &cancel).await {
                Ok(archive) => {
                    write_json(&record, &(artifacts::fingerprint(&archive)?, &archive))?;
                    archive
                }
                Err(error) => {
                    checkpoint(&cancel)?;
                    saved.ok_or(error)?
                }
            }
        } else {
            saved.context("缺少 Android 客户端资源索引，请联网后重试。")?
        };
        let entries = Arc::new(files(&archive)?);
        Ok(Self {
            cache,
            identity: ClientIdentity {
                client_version: version.into(),
                manifest_sha256: archive.directory_sha256.clone(),
            },
            entries,
            archive: Arc::new(archive),
            client,
            cancel,
            slots: Arc::new(Semaphore::new(4)),
            observer: None,
            allow_network,
        })
    }
    #[cfg(target_os = "emscripten")]
    pub async fn open_mode(
        data: &Path,
        version: &str,
        cancel: CancellationToken,
        allow_network: bool,
    ) -> Result<Self> {
        let cache = Arc::new(Cache::new(data.join("client"))?);
        let archive = crate::web::client::load(
            &cache.path(FILES, "source.json")?,
            version,
            allow_network,
            &cancel,
        )
        .await?;
        let identity = ClientIdentity {
            client_version: version.into(),
            manifest_sha256: artifacts::fingerprint(&archive.files)?,
        };
        let entries = archive
            .files
            .into_iter()
            .map(|(name, row)| {
                (
                    name,
                    FileEntry {
                        size: row.size,
                        compressed: row.size,
                        content_key: row.sha256,
                        download: row.url,
                    },
                )
            })
            .collect();
        Ok(Self {
            cache,
            identity,
            entries: Arc::new(entries),
            client: source::client()?,
            cancel,
            slots: Arc::new(Semaphore::new(4)),
            observer: None,
            allow_network,
        })
    }
    fn cached_path(&self, name: &str) -> Result<PathBuf> {
        self.cache.path(FILES, name)
    }
    pub fn prune(&self, cancel: &CancellationToken) -> Result<()> {
        let mut names: BTreeSet<_> = self.entries.keys().cloned().collect();
        names.extend(["source.json", "objects.json"].map(String::from));
        self.cache.prune(FILES, &names, cancel)?;
        Ok(())
    }
    pub async fn file(&self, name: &str) -> Result<PathBuf> {
        self.trace(name, TransferState::Checking, None, None);
        let result = self.file_inner(name).await;
        self.trace(
            name,
            if result.is_ok() {
                TransferState::Ready
            } else {
                TransferState::Failed
            },
            None,
            None,
        );
        result
    }
    async fn file_inner(&self, name: &str) -> Result<PathBuf> {
        checkpoint(&self.cancel)?;
        let meta = self
            .entries
            .get(name)
            .context("Android builtin resource is absent")?;
        // CRC/size identities describe the APK members; the receipt records the
        // reconstructed file's SHA-256. Repacking offsets do not invalidate it.
        let entry = Entry {
            name: name.into(),
            md5: String::new(),
            ab_size: meta.size,
            total_size: meta.size,
            extra: BTreeMap::from([("apkEntry".into(), meta.content_key.clone().into())]),
        };
        let destination = self.cached_path(name)?;
        let lock = source::path_lock(&destination)?;
        let _guard = tokio::select! {biased;_=self.cancel.cancelled()=>return Err(crate::error::Error::Cancelled.into()),g=lock.lock()=>g};
        let this = self.clone();
        let item = entry.clone();
        if let Some(path) =
            crate::runtime::blocking(move || this.cache.find(FILES, &item, &this.cancel)).await??
        {
            self.trace(name, TransferState::Ready, Some(0), Some(true));
            return Ok(path);
        }
        ensure!(
            self.allow_network,
            "缺少已缓存的 Android 客户端资源：{name}"
        );
        let parent = destination
            .parent()
            .context("Client output has no parent")?;
        tokio::fs::create_dir_all(parent).await?;
        let staging = tempfile::Builder::new()
            .prefix(".client-")
            .tempdir_in(parent)?;
        let payload = staging.path().join("payload");
        let mut file = tokio::fs::File::create(&payload).await?;
        self.trace(name, TransferState::Downloading, Some(0), Some(false));
        #[cfg(not(target_os = "emscripten"))]
        {
            let done = Arc::new(AtomicU64::new(0));
            let mut parts = futures_util::stream::iter(meta.parts.clone()).map(|part| {
            let this = self.clone();
            let done = done.clone();
            let name = name.to_owned();
            async move {
                let _slot=tokio::select!{biased;_=this.cancel.cancelled()=>return Err(anyhow::Error::from(Error::Cancelled)),s=this.slots.clone().acquire_owned()=>s?};
                let bytes=this.archive.read_member(&this.client,&part,&this.cancel).await?;
                let total=done.fetch_add(part.compressed,Ordering::Relaxed)+part.compressed;
                this.trace(&name,TransferState::Downloading,Some(total),Some(false));
                Ok::<_,anyhow::Error>(bytes)
            }
        }).buffered(4);
            while let Some(bytes) = parts.next().await {
                file.write_all(&bytes?).await?;
            }
        }
        #[cfg(target_os = "emscripten")]
        {
            let _slot = tokio::select! {biased;_=self.cancel.cancelled()=>return Err(Error::Cancelled.into()),s=self.slots.acquire()=>s?};
            let response = tokio::select! {biased;_=self.cancel.cancelled()=>return Err(Error::Cancelled.into()),r=self.client.get(source::https(&meta.download)?).send()=>r?.error_for_status()?};
            let mut stream = response.bytes_stream();
            let mut count = 0u64;
            while let Some(chunk) = tokio::select! {biased;_=self.cancel.cancelled()=>return Err(Error::Cancelled.into()),r=stream.next()=>r}
            {
                let bytes = chunk?;
                count += bytes.len() as u64;
                ensure!(count <= meta.size, "PRTS builtin exceeds declared size");
                file.write_all(&bytes).await?;
                self.trace(name, TransferState::Downloading, Some(count), Some(false));
            }
            ensure!(count == meta.size, "Incomplete PRTS builtin file");
        }
        file.sync_all().await?;
        drop(file);
        self.trace(name, TransferState::Verifying, None, None);
        let this = self.clone();
        let target = destination.clone();
        #[cfg(target_os = "emscripten")]
        let expected = Some(meta.content_key.clone());
        #[cfg(not(target_os = "emscripten"))]
        let expected: Option<String> = None;
        crate::runtime::blocking(move || {
            let hash = this
                .cache
                .verify(&payload, &entry, &this.cancel, expected.as_deref())?;
            checkpoint(&this.cancel)?;
            fs::rename(&payload, &target)?;
            this.cache.receipt(&target, &entry, &hash)?;
            drop(staging);
            Ok::<_, anyhow::Error>(())
        })
        .await??;
        Ok(destination)
    }
    pub async fn locate(
        &self,
        wanted: &[(i32, String)],
    ) -> Result<BTreeMap<(i32, String), Vec<Location>>> {
        let index_path = self.cached_path("objects.json")?;
        let lock = source::path_lock(&index_path)?;
        let _guard = tokio::select! {biased;_=self.cancel.cancelled()=>return Err(Error::Cancelled.into()),guard=lock.lock()=>guard};
        let mut saved: ObjectIndex = tokio::fs::read(&index_path)
            .await
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or_default();
        saved
            .files
            .retain(|name, _| self.entries.contains_key(name));
        let pattern =
            regex::Regex::new(r"^(sharedassets\d+|resources|globalgamemanagers)\.assets$")?;
        let mut files: Vec<_> = self
            .entries
            .keys()
            .filter(|name| pattern.is_match(name))
            .collect();
        files.sort_by_key(|name| {
            let number = name
                .trim_start_matches("sharedassets")
                .trim_end_matches(".assets")
                .parse::<u32>()
                .unwrap_or(999);
            (!self.cached_path(name).is_ok_and(|p| p.exists()), number)
        });
        let mut result: BTreeMap<_, Vec<Location>> = wanted
            .iter()
            .cloned()
            .map(|key| (key, Vec::new()))
            .collect();
        for name in files {
            checkpoint(&self.cancel)?;
            let entry = &self.entries[name];
            if !saved
                .files
                .get(name)
                .is_some_and(|file| file.content_key == entry.content_key)
            {
                let path = self.file(name).await?;
                let label = name.clone();
                let objects = crate::runtime::blocking(move || {
                    let env = unity::open(&path)?;
                    Ok::<_, anyhow::Error>(
                        env.objects()
                            .filter(|o| matches!(o.class_id(), 128 | 213))
                            .map(|o| Location {
                                file: label.clone(),
                                path_id: o.path_id(),
                                class_id: o.class_id(),
                                name: o.name().unwrap_or_default().to_owned(),
                            })
                            .collect(),
                    )
                })
                .await??;
                saved.files.insert(
                    name.clone(),
                    FileObjects {
                        content_key: entry.content_key.clone(),
                        objects,
                    },
                );
                write_json(&index_path, &saved)?;
            }
            for object in &saved.files[name].objects {
                if let Some(rows) = result.get_mut(&(object.class_id, object.name.clone())) {
                    rows.push(object.clone());
                }
            }
            if result.values().all(|rows| !rows.is_empty()) {
                return Ok(result);
            }
        }
        let missing: Vec<_> = result
            .iter()
            .filter(|(_, rows)| rows.is_empty())
            .map(|((_, name), _)| name.as_str())
            .collect();
        anyhow::bail!("Missing official client assets: {}", missing.join(", "))
    }
}
