use crate::cache::{resource_path, safe_path};
use crate::net::Client;
use crate::progress::{Observer, Progress, TransferState};
use crate::{
    cache::Cache,
    error::{checkpoint, Error},
};
use anyhow::{ensure, Context, Result};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};
use tokio::{
    io::AsyncWriteExt,
    sync::{Mutex as AsyncMutex, Semaphore},
};
use tokio_util::sync::CancellationToken;

const NETWORK_URL: &str = "https://ak-conf.hypergryph.com/config/prod/official/network_config";
const RESOURCE_PLATFORM: &str = "Android";
pub(crate) const BUNDLE_CACHE: &str = "bundles";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Platform {
    Android,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    #[default]
    Official,
    Prts,
}
impl Origin {
    pub fn name(self) -> &'static str {
        match self {
            Self::Official => "官方",
            Self::Prts => "PRTS",
        }
    }
    fn is_official(&self) -> bool {
        *self == Self::Official
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Download {
    pub url: String,
    // PRTS addresses the extracted bundle, while the HTTP body is its ZIP archive.
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub md5: String,
    pub ab_size: u64,
    pub total_size: u64,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Entry {
    pub fn full_md5(&self) -> Option<&str> {
        (self.md5.len() == 32 && self.md5.bytes().all(|b| b.is_ascii_hexdigit()))
            .then_some(self.md5.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub platform: Platform,
    #[serde(default, skip_serializing_if = "Origin::is_official")]
    pub origin: Origin,
    pub version: String,
    pub client_version: String,
    pub base_url: String,
    pub entries: BTreeMap<String, Entry>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub downloads: BTreeMap<String, Download>,
}

#[derive(Clone)]
pub struct Source {
    pub cache: Arc<Cache>,
    pub manifest: Arc<Manifest>,
    client: Client,
    cancelled: CancellationToken,
    slots: Arc<Semaphore>,
    observer: Option<Arc<dyn Observer>>,
}

pub(crate) fn path_lock(path: &Path) -> Result<Arc<AsyncMutex<()>>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<AsyncMutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| anyhow::anyhow!("Resource lock registry unavailable"))?;
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(path).and_then(Weak::upgrade) {
        return Ok(lock);
    }
    let lock = Arc::new(AsyncMutex::new(()));
    locks.insert(path.to_owned(), Arc::downgrade(&lock));
    Ok(lock)
}

pub fn https(url: &str) -> Result<crate::net::Url> {
    let parsed = crate::net::Url::parse(url)?;
    ensure!(
        parsed.scheme() == "https"
            && parsed.host_str().is_some()
            && parsed.username().is_empty()
            && parsed.password().is_none(),
        "Invalid official resource URL"
    );
    Ok(parsed)
}

#[cfg(not(target_os = "emscripten"))]
pub(crate) fn client() -> Result<Client> {
    Ok(Client::builder()
        .user_agent(concat!("ArkReader/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 6 && attempt.url().scheme() == "https" {
                attempt.follow()
            } else {
                attempt.error("Unsafe resource redirect")
            }
        }))
        .build()?)
}

#[cfg(target_os = "emscripten")]
pub(crate) fn client() -> Result<Client> {
    Ok(Client::new())
}

pub(crate) async fn json(
    client: &Client,
    url: crate::net::Url,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<Value> {
    tokio::select! {biased;
        _=cancel.cancelled()=>Err(Error::Cancelled.into()),
        result=async {client.get(url).timeout(timeout).send().await?.error_for_status()?.json().await.context("无法读取资源清单。") }=>result,
    }
}

pub async fn official(timeout: Duration, cancel: &CancellationToken) -> Result<Manifest> {
    let client = client()?;
    let response = json(&client, https(NETWORK_URL)?, timeout, cancel).await?;
    let config: Value = serde_json::from_str(
        response["content"]
            .as_str()
            .context("Missing official network configuration")?,
    )?;
    let network = &config["configs"][config["funcVer"]
        .as_str()
        .context("Missing official network version")?]["network"];
    let version_url = network["hv"]
        .as_str()
        .context("Missing official version endpoint")?
        .replace("{}", RESOURCE_PLATFORM)
        .replace("{0}", RESOURCE_PLATFORM);
    let version = json(&client, https(&version_url)?, timeout, cancel).await?;
    let resource = version["resVersion"]
        .as_str()
        .context("Missing official resource version")?;
    ensure!(
        resource_path(resource)?.components().count() == 1,
        "Invalid official resource version"
    );
    let base = format!(
        "{}/{}/assets/{resource}/",
        network["hu"]
            .as_str()
            .context("Missing official resource endpoint")?
            .trim_end_matches('/'),
        RESOURCE_PLATFORM
    );
    let raw = json(
        &client,
        https(&base)?.join("hot_update_list.json")?,
        timeout,
        cancel,
    )
    .await?;
    ensure!(
        raw["versionId"].as_str() == Some(resource),
        "Official manifest and version disagree"
    );
    let mut entries = BTreeMap::new();
    for value in raw["abInfos"]
        .as_array()
        .context("Missing official file list")?
    {
        let entry: Entry = serde_json::from_value(value.clone())?;
        resource_path(&entry.name)?;
        ensure!(
            entries.insert(entry.name.clone(), entry).is_none(),
            "Duplicate official resource entry"
        );
    }
    ensure!(!entries.is_empty(), "Empty official resource list");
    Ok(Manifest {
        platform: Platform::Android,
        origin: Origin::Official,
        version: resource.into(),
        client_version: version["clientVersion"]
            .as_str()
            .context("Missing official client version")?
            .into(),
        base_url: base,
        entries,
        downloads: BTreeMap::new(),
    })
}

impl Source {
    pub fn new(cache: PathBuf, manifest: Manifest, cancelled: CancellationToken) -> Result<Self> {
        ensure!(
            resource_path(&manifest.version)?.components().count() == 1,
            "Invalid resource version"
        );
        if !manifest.base_url.is_empty() {
            https(&manifest.base_url)?;
        }
        let cache = Arc::new(Cache::new(cache)?);
        let directory = safe_path(&cache.root, BUNDLE_CACHE)?;
        if !directory.exists() {
            // Keep the existing downloaded files when removing the platform
            // directory level. No per-file copies or parallel cache are needed.
            for name in ["Windows", "Android", "iOS"] {
                let previous = safe_path(&cache.root, name)?;
                if previous.is_dir() {
                    ensure!(
                        previous.canonicalize()?.parent() == Some(cache.root.as_path()),
                        "Cache directory escaped its root"
                    );
                    std::fs::rename(previous, &directory)?;
                    break;
                }
            }
        }
        Ok(Self {
            cache,
            manifest: Arc::new(manifest),
            client: client()?,
            cancelled,
            slots: Arc::new(Semaphore::new(4)),
            observer: None,
        })
    }
    pub fn cancellation(&self) -> CancellationToken {
        self.cancelled.clone()
    }

    fn with_cancellation(&self, cancelled: CancellationToken) -> Self {
        Self {
            cancelled,
            ..self.clone()
        }
    }

    pub fn with_progress(&self, progress: Arc<Progress>) -> Self {
        Self {
            cancelled: progress.cancel.clone(),
            observer: Some(progress),
            ..self.clone()
        }
    }
    pub fn detached(&self, cancelled: CancellationToken) -> Self {
        Self {
            cancelled,
            observer: None,
            ..self.clone()
        }
    }
    pub fn transfer_key(&self, name: &str) -> String {
        format!("bundle:{}:{name}", self.manifest.version)
    }
    fn trace(
        &self,
        name: &str,
        state: TransferState,
        downloaded: Option<u64>,
        cached: Option<bool>,
    ) {
        if let (Some(observer), Some(entry)) = (&self.observer, self.manifest.entries.get(name)) {
            observer.transfer(
                &self.transfer_key(name),
                name,
                entry.total_size,
                state,
                downloaded,
                cached,
            );
        }
    }
    pub fn checkpoint(&self) -> Result<()> {
        Ok(checkpoint(&self.cancelled)?)
    }
    pub fn cached_path(&self, name: &str) -> Result<PathBuf> {
        self.cache.path(BUNDLE_CACHE, name)
    }

    pub async fn bundle(&self, name: &str) -> Result<PathBuf> {
        self.trace(name, TransferState::Checking, None, None);
        let result = self.bundle_inner(name).await;
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

    async fn bundle_inner(&self, name: &str) -> Result<PathBuf> {
        self.checkpoint()?;
        let entry = self
            .manifest
            .entries
            .get(name)
            .ok_or_else(|| Error::ResourceNotFound(name.into()))?;
        let destination = self.cached_path(name)?;
        let lock = path_lock(&destination)?;
        let guard = tokio::select! {biased;_=self.cancelled.cancelled()=>return Err(Error::Cancelled.into()),guard=lock.lock_owned()=>guard};
        let source = self.clone();
        let entry_copy = entry.clone();
        let (guard, cached) = crate::runtime::blocking(move || {
            let result = source
                .cache
                .find(BUNDLE_CACHE, &entry_copy, &source.cancelled);
            (guard, result)
        })
        .await?;
        if let Some(path) = cached? {
            self.trace(name, TransferState::Ready, Some(0), Some(true));
            return Ok(path);
        }
        self.checkpoint()?;
        if self.manifest.base_url.is_empty() {
            return Err(Error::NotCached(name.into()).into());
        }
        let _permit = tokio::select! {biased;_=self.cancelled.cancelled()=>return Err(Error::Cancelled.into()),permit=self.slots.acquire()=>permit?};
        let parent = destination
            .parent()
            .context("Invalid resource cache location")?;
        tokio::fs::create_dir_all(parent).await?;
        let staging = tempfile::Builder::new()
            .prefix(".fetch-")
            .tempdir_in(parent)?;
        let archive_path = staging.path().join("download.zip");
        let server_name = name.replace('/', "_").replace('#', "__");
        let server_name = format!(
            "{}.dat",
            server_name
                .rsplit_once('.')
                .map_or(server_name.as_str(), |(stem, _)| stem)
        );
        let archived;
        let download = match self.manifest.downloads.get(name) {
            Some(row) => Some(row),
            None if self.manifest.origin == Origin::Prts => {
                archived =
                    crate::prts::archived(&self.manifest.version, entry, &self.cancelled).await?;
                Some(&archived)
            }
            None => None,
        };
        let url = match download {
            Some(row) => https(&row.url)?,
            None => https(&self.manifest.base_url)?.join(&server_name)?,
        };
        self.trace(name, TransferState::Downloading, Some(0), Some(false));
        let response = tokio::select! {biased;_=self.cancelled.cancelled()=>return Err(Error::Cancelled.into()),response=self.client.get(url).send()=>response?.error_for_status()?};
        let mut stream = response.bytes_stream();
        let mut archive = tokio::fs::File::create(&archive_path).await?;
        let mut downloaded = 0u64;
        while let Some(chunk) = tokio::select! {biased;_=self.cancelled.cancelled()=>return Err(Error::Cancelled.into()),chunk=stream.next()=>chunk}
        {
            let chunk = chunk?;
            downloaded += chunk.len() as u64;
            ensure!(
                downloaded <= entry.total_size,
                "Resource download exceeds official size"
            );
            archive.write_all(&chunk).await?;
            self.trace(
                name,
                TransferState::Downloading,
                Some(downloaded),
                Some(false),
            );
        }
        ensure!(
            downloaded == entry.total_size,
            "Resource download is incomplete"
        );
        archive.sync_all().await?;
        drop(archive);
        self.trace(name, TransferState::Verifying, None, None);
        let source = self.clone();
        let output = destination.clone();
        let entry_copy = entry.clone();
        let expected_sha256 = download.map(|row| row.sha256.clone());
        crate::runtime::blocking(move || {
            let _guard = guard;
            let result = source.cache.unpack(
                &archive_path,
                &output,
                &entry_copy,
                &source.cancelled,
                expected_sha256.as_deref(),
            );
            drop(staging);
            result
        })
        .await??;
        Ok(destination)
    }

    pub async fn prefetch(&self, names: &[String], concurrency: usize) -> Result<Vec<PathBuf>> {
        let batch = self.with_cancellation(self.cancelled.child_token());
        let source = &batch;
        let results: Vec<Result<(usize, PathBuf)>> =
            stream::iter(names.iter().cloned().enumerate())
                .map(|(i, name)| async move {
                    let result = source.bundle(&name).await.map(|path| (i, path));
                    if result.is_err() {
                        source.cancelled.cancel();
                    }
                    result
                })
                .buffer_unordered(concurrency.clamp(1, 8))
                .collect()
                .await;
        let mut error = None;
        let mut result = Vec::new();
        for item in results {
            match item {
                Ok(value) => result.push(value),
                Err(problem) => {
                    if error.is_none()
                        || problem
                            .downcast_ref::<Error>()
                            .is_none_or(|e| !matches!(e, Error::Cancelled))
                    {
                        error = Some(problem);
                    }
                }
            }
        }
        if let Some(error) = error {
            return Err(error);
        }
        result.sort_by_key(|(i, _)| *i);
        Ok(result.into_iter().map(|(_, path)| path).collect())
    }
}
