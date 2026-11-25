use crate::progress::{Observer, Progress, TransferState};
use crate::{
    cache::{resource_path, write_atomic, write_json, Cache},
    error::{checkpoint, Error},
    source::{self, Entry},
    unity,
};
use anyhow::{ensure, Context, Result};
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use futures_util::{StreamExt, TryStreamExt};
use md5::{Digest, Md5};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{io::AsyncWriteExt, sync::Semaphore};
use tokio_util::sync::CancellationToken;

const APP_CODE: &str = "GzD1CpaWgmSq1wew";
const LAUNCHER_API: &str = "https://launcher.hypergryph.com/api/game/get_latest";
const MANIFEST_KEY: &str = "c0f30e1ce763bbc21cc355a34303ac50399444bff68c4a22af398c0a166ee143";
const MANIFEST_IV: &str = "33467861192750649501937264608400";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub size: u64,
    pub md5: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Package {
    pub file_path: String,
    pub game_files_md5: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClientRecord {
    pub client_version: String,
    pub pkg: Package,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientIdentity {
    pub client_version: String,
    pub manifest_md5: String,
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
    md5: String,
    objects: Vec<Location>,
}
#[derive(Default, Serialize, Deserialize)]
struct ObjectIndex {
    manifest_md5: String,
    files: BTreeMap<String, FileObjects>,
}

fn full_hash(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn base(record: &ClientRecord, version: &str) -> Result<String> {
    ensure!(
        record.client_version == version,
        "Official client manifest belongs to another version"
    );
    let base = record.pkg.file_path.trim_end_matches('/');
    let url = source::https(base)?;
    ensure!(
        url.host_str() == Some("ak.hycdn.cn")
            && url.path().starts_with(&format!("/{APP_CODE}/"))
            && url.path().ends_with("/files")
            && url.query().is_none()
            && url.fragment().is_none()
            && full_hash(&record.pkg.game_files_md5),
        "Invalid official client source"
    );
    Ok(format!("{base}/"))
}

pub fn parse_manifest(raw: &[u8], expected: &str) -> Result<BTreeMap<String, FileEntry>> {
    ensure!(
        full_hash(expected) && format!("{:x}", Md5::digest(raw)).eq_ignore_ascii_case(expected),
        "Official client manifest checksum mismatch"
    );
    ensure!(
        !raw.is_empty() && raw.len().is_multiple_of(16),
        "Invalid official client manifest envelope"
    );
    let key = hex::decode(MANIFEST_KEY)?;
    let iv = hex::decode(MANIFEST_IV)?;
    let plain = cbc::Decryptor::<aes::Aes256>::new_from_slices(&key, &iv)?
        .decrypt_padded_vec_mut::<Pkcs7>(raw)
        .map_err(|_| anyhow::anyhow!("Invalid official manifest padding"))?;
    let mut entries = BTreeMap::new();
    #[derive(Deserialize)]
    struct Row {
        path: String,
        #[serde(flatten)]
        entry: FileEntry,
    }
    for line in std::str::from_utf8(&plain)?
        .trim_start_matches('\u{feff}')
        .lines()
        .filter(|line| !line.trim().is_empty())
    {
        let row: Row = serde_json::from_str(line)?;
        resource_path(&row.path)?;
        ensure!(
            full_hash(&row.entry.md5),
            "Invalid official client file checksum"
        );
        ensure!(
            entries.insert(row.path, row.entry).is_none(),
            "Duplicate official client file"
        );
    }
    ensure!(!entries.is_empty(), "Empty official client manifest");
    Ok(entries)
}

#[derive(Clone)]
pub struct ClientAssets {
    pub cache: Arc<Cache>,
    pub identity: ClientIdentity,
    pub entries: Arc<BTreeMap<String, FileEntry>>,
    base: String,
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
                self.identity.client_version, self.identity.manifest_md5
            );
            observer.transfer(&key, name, entry.size, state, downloaded, cached);
        }
    }
    pub fn with_cancellation(&self, cancel: CancellationToken) -> Self {
        Self {
            cancel,
            ..self.clone()
        }
    }
    pub async fn environment(
        &self,
        files: &[String],
        reference: Arc<unity::Unity>,
    ) -> Result<unity::Unity> {
        let mut names: BTreeSet<String> = files.iter().cloned().collect();
        names.insert("Arknights_Data/globalgamemanagers.assets".into());
        let mut paths: Vec<PathBuf> = futures_util::stream::iter(names)
            .map(|name| async move { self.file(&name).await })
            .buffer_unordered(4)
            .try_collect()
            .await?;
        let inputs = paths.clone();
        let schemas = reference.clone();
        let cancel = self.cancel.clone();
        let streams = tokio::task::spawn_blocking(move || {
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
                    streams.insert(format!("Arknights_Data/{filename}"));
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
        tokio::task::spawn_blocking(move || {
            let mut env = unity::Unity::open(&paths, cancel)?;
            env.bind_schemas(&reference)?;
            Ok(env)
        })
        .await?
    }
    pub async fn open(data: &Path, version: &str, cancel: CancellationToken) -> Result<Self> {
        Self::open_mode(data, version, cancel, true).await
    }
    pub async fn open_mode(
        data: &Path,
        version: &str,
        cancel: CancellationToken,
        allow_network: bool,
    ) -> Result<Self> {
        ensure!(
            !version.is_empty()
                && version.len() <= 101
                && version
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)),
            "Invalid official client version"
        );
        let cache = Arc::new(Cache::new(data.join("client"))?);
        let directory = cache.path("Windows", version, "source.json")?;
        let lock = source::path_lock(&directory)?;
        let _guard = tokio::select! {biased;_=cancel.cancelled()=>return Err(Error::Cancelled.into()),guard=lock.lock()=>guard};
        let client = source::client()?;
        let saved = tokio::fs::read(&directory)
            .await
            .ok()
            .and_then(|raw| serde_json::from_slice::<ClientRecord>(&raw).ok())
            .filter(|record| base(record, version).is_ok());
        let record = if let Some(record) = saved {
            record
        } else {
            ensure!(allow_network, "缺少客户端资源清单，请联网后重试。");
            let mut url = source::https(LAUNCHER_API)?;
            url.query_pairs_mut().extend_pairs([
                ("appcode", APP_CODE),
                ("channel", "1"),
                ("sub_channel", "1"),
                ("version", ""),
                ("platform", "Windows"),
            ]);
            let record: ClientRecord = serde_json::from_value(
                source::json(&client, url, Duration::from_secs(40), &cancel).await?,
            )?;
            base(&record, version)?;
            write_json(&directory, &record)?;
            record
        };
        let base = base(&record, version)?;
        let manifest = cache.path("Windows", version, "game_files")?;
        let raw = tokio::fs::read(&manifest).await.unwrap_or_default();
        let parsed = parse_manifest(&raw, &record.pkg.game_files_md5);
        let entries = if let Ok(entries) = parsed {
            entries
        } else {
            ensure!(allow_network, "客户端资源清单需要联网修复。");
            let response = tokio::select! {biased;_=cancel.cancelled()=>return Err(Error::Cancelled.into()),response=client.get(source::https(&base)?.join("game_files")?).send()=>response?.error_for_status()?};
            let bytes = tokio::select! {biased;_=cancel.cancelled()=>return Err(Error::Cancelled.into()),bytes=response.bytes()=>bytes?};
            let entries = parse_manifest(&bytes, &record.pkg.game_files_md5)?;
            write_atomic(&manifest, &bytes)?;
            entries
        };
        Ok(Self {
            cache,
            identity: ClientIdentity {
                client_version: version.into(),
                manifest_md5: record.pkg.game_files_md5.to_lowercase(),
            },
            entries: Arc::new(entries),
            base,
            client,
            cancel,
            slots: Arc::new(Semaphore::new(4)),
            observer: None,
            allow_network,
        })
    }

    pub fn cached_path(&self, name: &str) -> Result<PathBuf> {
        self.cache
            .path("Windows", &self.identity.client_version, name)
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
            .ok_or_else(|| Error::ResourceNotFound(name.into()))?;
        let entry = Entry {
            name: name.into(),
            md5: meta.md5.clone(),
            ab_size: meta.size,
            total_size: meta.size,
            extra: BTreeMap::new(),
        };
        let destination = self.cached_path(name)?;
        let lock = source::path_lock(&destination)?;
        let guard = tokio::select! {biased;_=self.cancel.cancelled()=>return Err(Error::Cancelled.into()),guard=lock.lock_owned()=>guard};
        let this = self.clone();
        let item = entry.clone();
        let (guard, cached) = tokio::task::spawn_blocking(move || {
            let result = this.cache.find(
                "Windows",
                &this.identity.client_version,
                &item,
                &this.cancel,
            );
            (guard, result)
        })
        .await?;
        if let Some(path) = cached? {
            self.trace(name, TransferState::Ready, Some(0), Some(true));
            return Ok(path);
        }
        ensure!(self.allow_network, "缺少已缓存的客户端资源：{name}");
        let _slot = tokio::select! {biased;_=self.cancel.cancelled()=>return Err(Error::Cancelled.into()),slot=self.slots.acquire()=>slot?};
        let parent = destination
            .parent()
            .context("Invalid client resource location")?;
        tokio::fs::create_dir_all(parent).await?;
        let staging = tempfile::Builder::new()
            .prefix(".client-")
            .tempdir_in(parent)?;
        let payload = staging.path().join("payload");
        self.trace(name, TransferState::Downloading, Some(0), Some(false));
        let response = tokio::select! {biased;_=self.cancel.cancelled()=>return Err(Error::Cancelled.into()),response=self.client.get(source::https(&self.base)?.join(name)?).send()=>response?.error_for_status()?};
        ensure!(
            response.status() == reqwest::StatusCode::OK,
            "Incomplete official client response"
        );
        let mut chunks = response.bytes_stream();
        let mut output = tokio::fs::File::create(&payload).await?;
        let mut size = 0u64;
        while let Some(chunk) = tokio::select! {biased;_=self.cancel.cancelled()=>return Err(Error::Cancelled.into()),chunk=chunks.next()=>chunk}
        {
            let chunk = chunk?;
            size += chunk.len() as u64;
            ensure!(
                size <= entry.ab_size,
                "Client resource exceeds official size"
            );
            output.write_all(&chunk).await?;
            self.trace(name, TransferState::Downloading, Some(size), Some(false));
        }
        output.sync_all().await?;
        drop(output);
        self.trace(name, TransferState::Verifying, None, None);
        let this = self.clone();
        let target = destination.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            let hash = this.cache.verify(&payload, &entry, &this.cancel, None)?;
            checkpoint(&this.cancel)?;
            fs::rename(payload, &target)?;
            this.cache.receipt(&target, &hash)?;
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
            .filter(|v: &ObjectIndex| v.manifest_md5 == self.identity.manifest_md5)
            .unwrap_or_default();
        saved.manifest_md5 = self.identity.manifest_md5.clone();
        let pattern = regex::Regex::new(
            r"^Arknights_Data/(sharedassets\d+|resources|globalgamemanagers)\.assets$",
        )?;
        let mut files: Vec<_> = self
            .entries
            .keys()
            .filter(|name| pattern.is_match(name))
            .collect();
        files.sort_by_key(|name| {
            let number = name
                .trim_start_matches("Arknights_Data/sharedassets")
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
                .is_some_and(|file| file.md5 == entry.md5)
            {
                let path = self.file(name).await?;
                let label = name.clone();
                let objects = tokio::task::spawn_blocking(move || {
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
                        md5: entry.md5.clone(),
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
