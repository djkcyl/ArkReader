use crate::{
    cache::{safe_path, write_json},
    engine::{Engine, Version},
    export::Exporter,
    planning,
    progress::{Kind, Phase, Progress},
    source::Source,
    stories::Stories,
};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Instant, UNIX_EPOCH},
};

#[derive(Clone, Serialize, Deserialize)]
struct FileStamp {
    path: String,
    size: u64,
    modified: u64,
}
#[derive(Clone, Serialize, Deserialize)]
struct Record {
    identity: String,
    files: Vec<FileStamp>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub label: String,
    pub state: String,
    pub error: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Queue {
    identity: String,
    id: String,
    state: String,
    items: Vec<Item>,
    completed: usize,
    failed: usize,
    current: String,
    progress: Value,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Store {
    records: BTreeMap<String, Record>,
    queue: Option<Queue>,
    #[serde(skip)]
    last_save: Option<Instant>,
}

fn stamp(root: &Path, path: &Path) -> Result<FileStamp> {
    let path = path.canonicalize()?;
    ensure!(
        path.starts_with(root),
        "Cached original is outside the data directory"
    );
    let metadata = path.metadata()?;
    let modified = u64::try_from(metadata.modified()?.duration_since(UNIX_EPOCH)?.as_nanos())?;
    Ok(FileStamp {
        path: path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/"),
        size: metadata.len(),
        modified,
    })
}
impl Store {
    pub fn load(root: &Path) -> Self {
        let mut store = fs::read(root.join("story-cache.json"))
            .ok()
            .and_then(|raw| serde_json::from_slice::<Self>(&raw).ok())
            .unwrap_or_default();
        if let Some(queue) = &mut store.queue {
            if matches!(queue.state.as_str(), "queued" | "running" | "cancelling") {
                queue.state = "paused".into();
            }
        }
        store
    }
    fn save(&mut self, data: &Path, force: bool) -> Result<()> {
        if force
            || self
                .last_save
                .is_none_or(|last| last.elapsed().as_millis() >= 500)
        {
            write_json(&data.join("story-cache.json"), self)?;
            self.last_save = Some(Instant::now());
        }
        Ok(())
    }
    pub fn status(
        &self,
        data: &Path,
        version: &Version,
        job: Option<&Arc<Progress>>,
    ) -> Result<Value> {
        let identity = version.content_key.as_str();
        let mut cached = Vec::new();
        let mut stale = Vec::new();
        let mut memo = BTreeMap::new();
        for (id, record) in &self.records {
            let valid = record.identity == identity
                && !record.files.is_empty()
                && record.files.iter().all(|expected| {
                    *memo
                        .entry((expected.path.clone(), expected.size, expected.modified))
                        .or_insert_with(|| {
                            safe_path(data, &expected.path)
                                .ok()
                                .and_then(|path| stamp(data, &path).ok())
                                .is_some_and(|actual| {
                                    actual.size == expected.size
                                        && actual.modified == expected.modified
                                })
                        })
                });
            if valid {
                cached.push(id);
            } else {
                stale.push(id);
            }
        }
        let queue = self.queue.as_ref().map(|queue| {
            let current = job.filter(|job| job.id == queue.id && job.kind == Kind::Cache);
            let mut value = current
                .map(|job| job.snapshot(false))
                .unwrap_or_else(|| queue.progress.clone());
            if !value.is_object() {
                value = json!({});
            }
            let state = if queue.identity != identity {
                "outdated"
            } else if current.is_none() {
                queue.state.as_str()
            } else {
                value["state"].as_str().unwrap_or(&queue.state)
            }
            .to_owned();
            let details = json!({
                "id": queue.id,
                "kind": "cache",
                "state": state,
                "total": queue.items.len(),
                "completed": queue.completed,
                "failed": queue.failed,
                "current": queue.current,
                "items": queue.items,
                "running": current.is_some_and(|job| job.running())
            });
            value
                .as_object_mut()
                .unwrap()
                .extend(details.as_object().unwrap().clone());
            value
        });
        Ok(json!({"cached":cached,"stale":stale,"job":queue}))
    }
}

impl Engine {
    pub async fn cache_status(&self) -> Result<Value> {
        let version = self.current().await?;
        self.cache_store.lock().unwrap().status(
            &self.data,
            &version,
            self.jobs.latest(Some(Kind::Cache)).as_ref(),
        )
    }
    pub async fn start_cache(self: &Arc<Self>, ids: Vec<String>) -> Result<Arc<Progress>> {
        ensure!(
            !ids.is_empty() && ids.len() <= 5000,
            "请选择需要缓存的剧情。"
        );
        let version = self.current().await?;
        let labels = version
            .base
            .catalog
            .stories
            .iter()
            .map(|s| (s.id.clone(), s.label.clone()))
            .collect::<BTreeMap<_, _>>();
        let mut seen = BTreeSet::new();
        let ids = ids
            .into_iter()
            .filter(|id| seen.insert(id.clone()))
            .collect::<Vec<_>>();
        ensure!(
            ids.iter().all(|id| labels.contains_key(id)),
            "所选剧情不在当前目录中。"
        );
        let job = self.jobs.create(Kind::Cache, false)?;
        let items = ids
            .iter()
            .map(|id| Item {
                id: id.clone(),
                label: labels[id].clone(),
                state: "pending".into(),
                error: None,
            })
            .collect();
        let mut store = self.cache_store.lock().unwrap();
        store.queue = Some(Queue {
            identity: version.content_key.clone(),
            id: job.id.clone(),
            state: "running".into(),
            items,
            completed: 0,
            failed: 0,
            current: String::new(),
            progress: job.snapshot(false),
        });
        store.save(&self.data, true)?;
        drop(store);
        let engine = self.clone();
        let progress = job.clone();
        self.jobs.spawn(job.clone(), async move {
            let result = engine.cache_batch(version, ids, progress.clone()).await;
            let mut store = engine.cache_store.lock().unwrap();
            if let Some(queue) = &mut store.queue {
                queue.state = if progress.cancel.is_cancelled() {
                    "paused"
                } else if result.is_ok() {
                    "completed"
                } else {
                    "failed"
                }
                .into();
                queue.current.clear();
                queue.progress = progress.snapshot(false);
                if queue.state == "completed" {
                    queue.progress["overallProgress"] = json!(1.0);
                }
            }
            let saved = store.save(&engine.data, true);
            result.and_then(|value| saved.map(|_| value))
        });
        Ok(job)
    }
    fn cache_item(
        &self,
        job: &Progress,
        id: &str,
        state: &str,
        error: Option<String>,
    ) -> Result<()> {
        let mut store = self.cache_store.lock().unwrap();
        if let Some(queue) = &mut store.queue {
            queue.current = id.into();
            if let Some(item) = queue.items.iter_mut().find(|item| item.id == id) {
                item.state = state.into();
                item.error = error;
            }
            queue.completed = queue
                .items
                .iter()
                .filter(|item| item.state == "completed")
                .count();
            queue.failed = queue
                .items
                .iter()
                .filter(|item| item.state == "failed")
                .count();
            queue.progress = job.snapshot(false);
        }
        store.save(&self.data, false)
    }
    async fn cache_batch(
        &self,
        version: Arc<Version>,
        ids: Vec<String>,
        job: Arc<Progress>,
    ) -> Result<Value> {
        let source = version.source.with_progress(job.clone());
        let client = version.client.with_progress(job.clone());
        let stories = Stories {
            data: self.data.clone(),
            index: version.index.clone(),
            source: source.clone(),
        };
        let mut plans = Vec::new();
        let mut requested = BTreeSet::new();
        for (i, id) in ids.iter().enumerate() {
            crate::error::checkpoint(&job.cancel)?;
            job.phase(Phase::CachePlan, "检查待缓存剧情…", i, ids.len(), id);
            self.cache_item(&job, id, "planning", None)?;
            match planning::plan(&stories, id).await {
                Ok(plan) if plan.missing.is_empty() => {
                    let mut own = plan.wanted.keys().cloned().collect::<BTreeSet<_>>();
                    own.insert(version.index.stories[id].bundle.clone());
                    let summary_id = version
                        .base
                        .metadata
                        .review
                        .iter()
                        .flat_map(|g| g.stories.iter())
                        .find(|row| row.story_txt.as_deref() == Some(id))
                        .and_then(|row| row.story_info.as_deref())
                        .map(|id| id.strip_prefix("info/").unwrap_or(id))
                        .unwrap_or(id);
                    if let Some(route) = version.index.summaries.get(summary_id) {
                        own.insert(route.bundle.clone());
                    }
                    let deps = planning::dependencies(&version.index, &own);
                    own.extend(deps);
                    requested.extend(own.iter().cloned());
                    plans.push((id.clone(), plan, own));
                }
                Ok(plan) => self.cache_item(
                    &job,
                    id,
                    "failed",
                    Some(format!(
                        "未找到所需资源：{}",
                        plan.missing
                            .into_iter()
                            .take(5)
                            .collect::<Vec<_>>()
                            .join("；")
                    )),
                )?,
                Err(error) => {
                    crate::error::checkpoint(&job.cancel)?;
                    self.cache_item(&job, id, "failed", Some(error.to_string()))?;
                }
            }
        }
        job.phase(Phase::Download, "下载所选剧情资源…", 0, requested.len(), "");
        job.plan(requested.iter().map(|name| {
            (
                source.transfer_key(name),
                name.clone(),
                source.manifest.entries[name].total_size,
            )
        }));
        // Settle each story independently so an unavailable package does not discard other results.
        let exporter = Exporter {
            source: source.clone(),
            index: version.index.clone(),
            client: client.clone(),
            store: self.store.clone(),
        };
        let cache_identity = version.content_key.clone();
        for (id, plan, own) in plans {
            crate::error::checkpoint(&job.cancel)?;
            self.cache_item(&job, &id, "downloading", None)?;
            let result: Result<Vec<PathBuf>> = async {
                let mut files = source
                    .prefetch(&own.into_iter().collect::<Vec<_>>(), 4, |_| {})
                    .await?;
                for movie in &plan.historical {
                    let historical = Source::new(
                        self.data.join("cache/historical-movies"),
                        movie.manifest.clone(),
                        job.cancel.clone(),
                    )?
                    .with_progress(job.clone());
                    files.push(historical.bundle(&movie.bundle, |_| {}).await?);
                }
                let mut fonts = BTreeSet::new();
                for (bundle, keys) in &plan.wanted {
                    if bundle.starts_with("avg/animatetext/")
                        || bundle.starts_with("avg/animatedkv/")
                        || bundle.starts_with("avg/spellsticker/")
                        || bundle == "avg/[uc]common.ab"
                    {
                        let env = exporter.open(bundle).await?;
                        let keys = keys.clone();
                        let common = bundle == "avg/[uc]common.ab";
                        fonts.extend(
                            tokio::task::spawn_blocking(move || {
                                if common {
                                    let mut names = BTreeSet::new();
                                    for key in keys {
                                        names.extend(crate::interlude::font_names(&env, &key)?);
                                    }
                                    Ok(names)
                                } else {
                                    crate::stamp::font_names(&env)
                                }
                            })
                            .await??,
                        );
                    }
                }
                if !fonts.is_empty() {
                    let locations = client
                        .locate(
                            &fonts
                                .into_iter()
                                .map(|name| (128, name))
                                .collect::<Vec<_>>(),
                        )
                        .await?;
                    let names = locations
                        .values()
                        .flatten()
                        .map(|row| row.file.clone())
                        .collect::<BTreeSet<_>>();
                    for name in names {
                        files.push(client.file(&name).await?);
                    }
                }
                Ok(files)
            }
            .await;
            match result {
                Ok(files) => {
                    let files = files
                        .into_iter()
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .map(|path| stamp(&self.data, &path))
                        .collect::<Result<Vec<_>>>()?;
                    self.cache_store.lock().unwrap().records.insert(
                        id.clone(),
                        Record {
                            identity: cache_identity.clone(),
                            files,
                        },
                    );
                    self.cache_item(&job, &id, "completed", None)?;
                }
                Err(error) => {
                    crate::error::checkpoint(&job.cancel)?;
                    self.cache_item(&job, &id, "failed", Some(error.to_string()))?;
                }
            }
        }
        job.phase(Phase::CacheVerify, "检查缓存结果…", 1, 1, "");
        let store = self.cache_store.lock().unwrap();
        let queue = store.queue.as_ref().context("Cache queue disappeared")?;
        Ok(json!({"completed":queue.completed,"failed":queue.failed}))
    }
}
