use crate::{
    artifacts::{self, Artifacts},
    artwork::{self, Art},
    cache::{safe_path, write_json},
    catalog::{self, Catalog, Metadata},
    client_assets::ClientAssets,
    export::Exporter,
    index,
    jobs::Jobs,
    materials,
    media::{ImageFile, MediaStore},
    model::Index,
    music::{self, Music},
    planning,
    progress::{Kind, Phase, Progress},
    source::{self, Manifest, Origin, Source},
    stories::Stories,
    ui,
    unity::Unity,
    updates::{self, Update},
};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{RwLock, Semaphore};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
pub struct Base {
    pub catalog: Catalog,
    pub metadata: Metadata,
    pub music: Music,
    pub profile: Value,
    pub filters: Value,
    pub blocker: Value,
    pub covers: BTreeMap<String, ImageFile>,
    pub bundles: BTreeSet<String>,
    pub files: BTreeSet<String>,
}
pub struct Version {
    pub content_key: String,
    pub index: Arc<Index>,
    pub source: Source,
    pub client: ClientAssets,
    pub base: Arc<Base>,
}
#[derive(Serialize, Deserialize)]
struct StoredIndex {
    sha256: String,
    index: Index,
}

pub struct Engine {
    pub data: PathBuf,
    pub runtime: PathBuf,
    pub jobs: Jobs,
    pub store: Arc<MediaStore>,
    pub artifacts: Arc<Artifacts>,
    pub decode: Arc<Semaphore>,
    pub video: crate::video::Decoder,
    pub(crate) movie_base: OnceLock<String>,
    session: Mutex<Option<crate::session::Session>>,
    cancel: CancellationToken,
    version: RwLock<Option<Arc<Version>>>,
    update: Mutex<Update>,
    ready: AtomicBool,
    playing: AtomicBool,
    music_files: Mutex<BTreeSet<String>>,
    pub(crate) cache_store: Mutex<crate::story_cache::Store>,
}
impl Engine {
    pub fn new(data: PathBuf, render_root: PathBuf) -> Result<Arc<Self>> {
        Self::with_decoder(
            data,
            render_root,
            crate::video::Decoder {
                executable: PathBuf::from("ffmpeg"),
            },
        )
    }
    pub fn with_decoder(
        data: PathBuf,
        render_root: PathBuf,
        video: crate::video::Decoder,
    ) -> Result<Arc<Self>> {
        fs::create_dir_all(&data)?;
        fs::create_dir_all(&render_root)?;
        let data = data.canonicalize()?;
        let render_root = render_root.canonicalize()?;
        ensure!(
            !data.starts_with(&render_root) && !render_root.starts_with(&data),
            "Render cache must be separate from user data"
        );
        let session = crate::session::Session::new(&render_root)?;
        let runtime = session.path().to_owned();
        let cancel = CancellationToken::new();
        let store = Arc::new(MediaStore::new(&runtime.join("media"))?);
        let artifacts = Arc::new(Artifacts::new(&data)?);
        let cache_store = Mutex::new(crate::story_cache::Store::load(&data));
        Ok(Arc::new(Self {
            data,
            runtime,
            jobs: Jobs::new(cancel.clone()),
            store,
            artifacts,
            decode: Arc::new(Semaphore::new(2)),
            video,
            movie_base: OnceLock::new(),
            session: Mutex::new(Some(session)),
            cancel,
            version: RwLock::new(None),
            update: Mutex::new(Update::default()),
            ready: AtomicBool::new(false),
            playing: AtomicBool::new(false),
            music_files: Mutex::new(BTreeSet::new()),
            cache_store,
        }))
    }
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Acquire)
    }
    pub fn source_origin(&self) -> Origin {
        fs::read(self.data.join("resource-source.json"))
            .ok()
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or(if cfg!(target_os = "emscripten") {
                Origin::Prts
            } else {
                Origin::Official
            })
    }
    pub fn select_source(&self, origin: Origin) -> Result<()> {
        #[cfg(target_os = "emscripten")]
        ensure!(origin == Origin::Prts, "网页版使用 PRTS 资源来源。");
        ensure!(
            !self.jobs.busy() && !self.playing.load(Ordering::Acquire),
            "请先结束播放和资源任务，再切换来源。"
        );
        write_json(&self.data.join("resource-source.json"), &origin)?;
        self.ready.store(false, Ordering::Release);
        Ok(())
    }
    pub fn set_playing(&self, value: bool) {
        self.playing.store(value, Ordering::Release);
    }
    pub async fn current(&self) -> Result<Arc<Version>> {
        ensure!(self.is_ready(), "基础资源尚未准备完成。");
        self.version
            .read()
            .await
            .clone()
            .context("剧情资料尚未就绪。")
    }
    pub fn start(self: &Arc<Self>, automatic: bool) -> Result<Arc<Progress>> {
        ensure!(!self.is_ready(), "基础资源已准备完成。");
        let job = self.jobs.create(Kind::Import, automatic)?;
        if automatic && self.data.join("setup-paused").exists() {
            job.cancel();
            job.finish(Err(crate::error::Error::Cancelled.into()));
            return Ok(job);
        }
        let _ = fs::remove_file(self.data.join("setup-paused"));
        let engine = self.clone();
        let progress = job.clone();
        self.jobs.spawn(
            job.clone(),
            async move { engine.initialize(progress).await },
        );
        Ok(job)
    }
    pub fn cancel_job(&self, id: &str) -> Result<Value> {
        let job = self.jobs.get(id).context("任务已结束，请重新尝试。");
        let job = job?;
        if job.kind == Kind::Import && job.running() {
            write_json(&self.data.join("setup-paused"), &true)?;
        }
        job.cancel();
        Ok(job.snapshot(false))
    }
    fn cached_index(&self) -> Option<Index> {
        let raw = fs::read(self.data.join("index.json")).ok()?;
        let record = serde_json::from_slice::<StoredIndex>(&raw).ok()?;
        if record.index.format != 1 || artifacts::fingerprint(&record.index).ok()? != record.sha256
        {
            return None;
        }
        Some(record.index)
    }

    fn cached_manifest(&self) -> Option<Manifest> {
        let raw = fs::read(self.data.join("resource-manifest.json")).ok()?;
        let (digest, manifest): (String, Manifest) = serde_json::from_slice(&raw).ok()?;
        if artifacts::fingerprint(&manifest).ok()? != digest {
            return None;
        }
        Some(manifest)
    }

    async fn initialize(&self, job: Arc<Progress>) -> Result<Value> {
        self.ready.store(false, Ordering::Release);
        job.phase(Phase::Cache, "读取资源缓存…", 0, 1, "");
        let cached = self.cached_index();
        let previous = self.cached_manifest();
        let origin = self.source_origin();
        job.phase(
            Phase::Connect,
            format!("检查{}资源版本…", origin.name()),
            0,
            0,
            "",
        );
        let official = match origin {
            Origin::Official => source::official(Duration::from_secs(20), &job.cancel).await,
            Origin::Prts => {
                crate::prts::latest(Duration::from_secs(30), &job.cancel, previous.as_ref()).await
            }
        };
        crate::error::checkpoint(&job.cancel)?;
        let checked_at = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs_f64();
        let mut update = Update {
            checked_at,
            ..Default::default()
        };
        let (manifest, online) = match official {
            Ok(manifest) => {
                update.official_version = Some(manifest.version.clone());
                update.official_client_version = Some(manifest.client_version.clone());
                // Persist the target before replacing files. A partially updated
                // shared directory must resume this manifest, not an old index.
                write_json(
                    &self.data.join("resource-manifest.json"),
                    &(artifacts::fingerprint(&manifest)?, &manifest),
                )?;
                (manifest, true)
            }
            Err(error) => {
                let Some(previous) = previous else {
                    return Err(error.context(format!(
                        "无法连接{}资源服务器。请检查网络后重试。",
                        origin.name()
                    )));
                };
                update.state = "offline".into();
                update.message = "本次未能检查最新资源，正在使用已缓存的版本。".into();
                update.error = Some(format!("{error:#}"));
                (previous, false)
            }
        };
        let version = self
            .build_version(manifest, cached.as_ref(), online, &job)
            .await?;
        crate::error::checkpoint(&job.cancel)?;
        update.current_version = Some(version.index.source.version.clone());
        update.client_version = Some(version.index.source.client_version.clone());
        update.warning = updates::warning(
            update
                .official_version
                .as_deref()
                .unwrap_or(&version.index.source.version),
            update
                .official_client_version
                .as_deref()
                .unwrap_or(&version.index.source.client_version),
            &update.baseline,
        );
        if update.state == "not-checked" {
            update.state = if cached
                .as_ref()
                .is_some_and(|old| old.source.version == version.index.source.version)
            {
                "latest"
            } else {
                "updated"
            }
            .into();
            update.message = format!("已检查{}资源，当前为该来源最新版本。", origin.name());
        }
        write_json(
            &self.data.join("index.json"),
            &StoredIndex {
                sha256: artifacts::fingerprint(version.index.as_ref())?,
                index: version.index.as_ref().clone(),
            },
        )?;
        if online {
            job.phase(Phase::BaseVerify, "清理过期资源…", 0, 1, "");
            let cache = version.source.cache.clone();
            let names = version.index.source.entries.keys().cloned().collect();
            let client = version.client.clone();
            let data = self.data.clone();
            let cancel = job.cancel.clone();
            crate::runtime::blocking(move || {
                cache.prune(source::BUNDLE_CACHE, &names, &cancel)?;
                client.prune(&cancel)?;
                crate::historical::prune(&data, &cancel)?;
                Ok::<_, anyhow::Error>(())
            })
            .await??;
        }
        *self.version.write().await = Some(Arc::new(version));
        *self.update.lock().unwrap() = update;
        self.ready.store(true, Ordering::Release);
        job.phase(Phase::Ready, "准备完成", 1, 1, "");
        self.status().await
    }

    async fn build_version(
        &self,
        manifest: Manifest,
        cached: Option<&Index>,
        online: bool,
        job: &Arc<Progress>,
    ) -> Result<Version> {
        let mut request = manifest.clone();
        if !online {
            request.base_url.clear();
        }
        let source = Source::new(self.data.join("cache"), request, job.cancel.clone())?
            .with_progress(job.clone());
        let same = cached.is_some_and(|index| {
            index.generator == crate::DECODER_REVISION && index.source.entries == manifest.entries
        });
        job.phase(Phase::Index, "读取剧情索引…", 0, 1, "");
        let mut index = if same {
            cached.unwrap().clone()
        } else {
            index::build(&self.data, &source, |name| {
                job.phase(Phase::Index, "读取剧情索引…", 0, 1, name)
            })
            .await?
        };
        index.source = manifest;
        let index = Arc::new(index);
        job.phase(Phase::BasePlan, "准备基础资源…", 0, 1, "");
        let client = ClientAssets::open_mode(
            &self.data,
            &index.source.client_version,
            job.cancel.clone(),
            online,
        )
        .await?
        .with_progress(job.clone());
        let key = artifacts::fingerprint(&(
            crate::DECODER_REVISION,
            &index.source.platform,
            &index.source.entries,
            &index.routing.sha256,
            &client.identity.manifest_sha256,
        ))?;
        let artifacts = self.artifacts.clone();
        let runtime = self.runtime.clone();
        let lookup = key.clone();
        let cancel = job.cancel.clone();
        #[cfg(target_os = "emscripten")]
        artifacts.prepare_restore("base", &lookup, &cancel).await?;
        let saved =
            crate::runtime::blocking(move || artifacts.restore("base", &lookup, &runtime, &cancel))
                .await??;
        let base = if let Some(saved) = saved {
            job.phase(Phase::BaseVerify, "常用资源已就绪", 1, 1, "界面与目录");
            serde_json::from_value(saved)?
        } else {
            let mut base = self.prepare_base(&index, &source, &client, job).await?;
            let mut files = Vec::new();
            for entry in fs::read_dir(&self.store.directory)? {
                let entry = entry?;
                if entry.file_type()?.is_file() {
                    files.push(format!("media/{}", entry.file_name().to_string_lossy()));
                }
            }
            base.files = files.iter().cloned().collect();
            let artifacts = self.artifacts.clone();
            let runtime = self.runtime.clone();
            let cancel = job.cancel.clone();
            let metadata = serde_json::to_value(&base)?;
            let key = key.clone();
            crate::runtime::blocking(move || {
                artifacts.store("base", &key, &runtime, &files, metadata, &cancel)
            })
            .await??;
            base
        };
        Ok(Version {
            content_key: key,
            index,
            source: source.detached(self.cancel.clone()),
            client: client.detached(self.cancel.clone()),
            base: Arc::new(base),
        })
    }

    async fn table(index: &Index, source: &Source, name: &str) -> Result<Vec<u8>> {
        let routes = index
            .routes
            .iter()
            .filter(|(key, _)| {
                key.strip_prefix("gamedata/excel/")
                    .is_some_and(|key| index::table_name(key, name))
            })
            .map(|(_, route)| route)
            .collect::<Vec<_>>();
        ensure!(
            routes.len() == 1,
            "Official metadata table is not unique: {name}"
        );
        index::read_route(source, routes[0]).await
    }

    async fn prepare_base(
        &self,
        index: &Arc<Index>,
        source: &Source,
        client: &ClientAssets,
        job: &Arc<Progress>,
    ) -> Result<Base> {
        let mut bundles = BTreeSet::from([
            "avg/[uc]common.ab".to_owned(),
            "arts/avg_shader_profile.ab".into(),
            ui::widgets::SETTINGS.into(),
        ]);
        bundles.extend(ui::application::BUNDLES.iter().map(|s| s.to_string()));
        bundles.insert(
            index
                .routes
                .get(ui::cursor::RESOURCE)
                .context("Official cursor route missing")?
                .bundle
                .clone(),
        );
        let sound = ui::audio::plan(index, source).await?;
        bundles.extend(sound.bundles.keys().cloned());
        let deps = planning::dependencies(index, &bundles);
        bundles.extend(deps);
        job.phase(
            Phase::UiDownload,
            "下载播放界面资源…",
            0,
            bundles.len(),
            "播放器界面",
        );
        job.plan(bundles.iter().map(|name| {
            (
                source.transfer_key(name),
                name.clone(),
                source.manifest.entries[name].total_size,
            )
        }));
        source
            .prefetch(&bundles.iter().cloned().collect::<Vec<_>>(), 4)
            .await?;
        let common_path = source.bundle("avg/[uc]common.ab").await?;
        let cancel = job.cancel.clone();
        let common =
            Arc::new(crate::runtime::blocking(move || Unity::open(&[common_path], cancel)).await??);
        job.phase(Phase::Ui, "准备播放界面…", 0, 6, "字体与播放按钮");
        let mut profile = serde_json::to_value(
            ui::prepare_core(client, self.store.clone(), common.clone()).await?,
        )?;
        job.phase(Phase::Ui, "准备设置与弹窗…", 1, 6, "设置控件");
        profile["widgets"] =
            ui::widgets::prepare(source, client, self.store.clone(), common.clone())
                .await?
                .into();
        profile["applicationWidgets"] = ui::application::prepare(index, source, self.store.clone())
            .await?
            .into();
        job.phase(Phase::Ui, "准备光标与点击反馈…", 2, 6, "PRTS 光标");
        profile["cursor"] = ui::cursor::prepare(index, source, self.store.clone())
            .await?
            .into();
        job.phase(Phase::Ui, "准备交互音效…", 3, 6, "按钮音效");
        profile["interactionAudio"] =
            ui::audio::prepare(index, source, client, self.store.clone(), common.clone())
                .await?
                .into();
        job.phase(Phase::Ui, "准备公共画面效果…", 4, 6, "滤镜与遮罩");
        let filters = serde_json::to_value(
            materials::filters(source, common.clone(), self.store.clone()).await?,
        )?;
        let input = common.clone();
        let store = self.store.clone();
        let resource_version = index.source.version.clone();
        let blocker =
            crate::runtime::blocking(move || materials::blocker(&input, &store, &resource_version))
                .await??;
        let blocker = serde_json::to_value(blocker)?;
        drop(common);
        job.phase(Phase::Ui, "读取主页音乐…", 5, 6, "主页音乐目录");
        let (display, audio) = tokio::try_join!(
            Self::table(index, source, "display_meta_table"),
            Self::table(index, source, "audio_data")
        )?;
        let music = crate::runtime::blocking(move || music::parse(&display, &audio)).await??;
        job.phase(Phase::BaseDownload, "整理剧情目录…", 0, 0, "章节与干员资料");
        let metadata = Metadata::load(&self.data, index, source).await?;
        let catalog = catalog::build(index, &metadata)?;
        let mut artwork: BTreeMap<String, Vec<(String, Art)>> = BTreeMap::new();
        for group in &catalog.groups {
            if let Some(binding) = artwork::binding(index, group)? {
                artwork
                    .entry(binding.bundle().into())
                    .or_default()
                    .push((group.id.clone(), binding));
            }
        }
        bundles.extend(artwork.keys().cloned());
        let common_pattern = regex::Regex::new(r"^avg/imgs/asp_cgcommon_\d+\.ab$")?;
        bundles.extend(
            index
                .source
                .entries
                .keys()
                .filter(|name| common_pattern.is_match(name))
                .cloned(),
        );
        let deps = planning::dependencies(index, &bundles);
        bundles.extend(deps);
        job.phase(
            Phase::BaseDownload,
            "缓存目录封面与公共贴图…",
            0,
            bundles.len(),
            "目录与公共资源",
        );
        job.plan(bundles.iter().map(|name| {
            (
                source.transfer_key(name),
                name.clone(),
                source.manifest.entries[name].total_size,
            )
        }));
        source
            .prefetch(&bundles.iter().cloned().collect::<Vec<_>>(), 4)
            .await?;
        let total = artwork.values().map(Vec::len).sum();
        let mut done = 0;
        let mut covers = BTreeMap::new();
        let exporter = Exporter {
            source: source.clone(),
            index: index.clone(),
            client: client.clone(),
            store: self.store.clone(),
        };
        for (bundle, groups) in artwork {
            job.phase(Phase::Catalog, "准备目录封面…", done, total, &bundle);
            let env = exporter.open(&bundle).await?;
            let store = self.store.clone();
            let cancel = job.cancel.clone();
            let count = groups.len();
            let rendered = crate::runtime::blocking(move || {
                let mut result = BTreeMap::new();
                for (id, binding) in groups {
                    crate::error::checkpoint(&cancel)?;
                    result.insert(id, artwork::export(&env, &store, &binding)?);
                }
                Ok::<_, anyhow::Error>(result)
            })
            .await??;
            covers.extend(rendered);
            done += count;
        }
        job.phase(Phase::BaseVerify, "检查基础资源…", 1, 1, "界面与目录");
        Ok(Base {
            catalog,
            metadata,
            music,
            profile,
            filters,
            blocker,
            covers,
            bundles,
            files: BTreeSet::new(),
        })
    }

    pub async fn status(&self) -> Result<Value> {
        let version = self.version.read().await;
        let current = version.as_ref();
        let job = self
            .jobs
            .latest(None)
            .map(|job| job.snapshot(false))
            .unwrap_or_else(|| json!({"running":false,"message":"","error":null}));
        Ok(json!({
            "resourceSource":self.source_origin(),
            "version":current.map(|v|v.index.source.version.as_str()),
            "stories":current.map_or(0,|v|v.index.stories.len()),
            "storyPlayerScripts":current.map_or(0,|v|v.base.catalog.stories.len()),
            "media":current.map_or(0,|v|v.index.media.len()),
            "job":job,
            "baseResources":{"ready":self.is_ready(),"bundleCount":current.map_or(0,|v|v.base.bundles.len()),"coverCount":current.map_or(0,|v|v.base.covers.len())},
            "setupPaused":self.data.join("setup-paused").exists(),
            "startupSkinReady":self.store.directory.join("native-judge-dialog-bg.png").is_file()
                && self.store.directory.join("native-setting-action.png").is_file(),
            "cursorReady":self.store.directory.join("native-cursor.json").is_file(),
            "resourceUpdate":self.update.lock().unwrap().clone()
        }))
    }

    pub async fn story_script(&self, id: &str) -> Result<Value> {
        let version = self.current().await?;
        ensure!(
            version
                .base
                .catalog
                .stories
                .iter()
                .any(|story| story.id == id),
            "当前剧情目录中没有这段剧情。"
        );
        let stories = Stories {
            data: self.data.clone(),
            index: version.index.clone(),
            source: version.source.clone(),
        };
        Ok(
            json!({ "id": id, "script": stories.text(id, false).await?, "variables": version.index.variables }),
        )
    }

    pub async fn start_story(self: &Arc<Self>, id: String) -> Result<Arc<Progress>> {
        let version = self.current().await?;
        ensure!(
            version.base.catalog.stories.iter().any(|s| s.id == id),
            "当前剧情目录中没有这段剧情。"
        );
        let job = self.jobs.create(Kind::Prepare, false)?;
        let engine = self.clone();
        let progress = job.clone();
        self.jobs.spawn(job.clone(), async move {
            let mut pack = engine.prepare_story(version, &id, progress).await?;
            if let Some(base) = engine.movie_base.get() {
                if let Some(assets) = pack["assets"].as_object_mut() {
                    for asset in assets.values_mut().filter(|asset| asset["kind"] == "video") {
                        if let Some(name) = asset["url"]
                            .as_str()
                            .and_then(|url| url.strip_prefix("/media/"))
                        {
                            asset["url"] = format!("{base}/{name}").into();
                        }
                    }
                }
            }
            Ok(pack)
        });
        Ok(job)
    }

    pub async fn prepare_story(
        &self,
        version: Arc<Version>,
        id: &str,
        job: Arc<Progress>,
    ) -> Result<Value> {
        job.phase(Phase::Compatibility, "检查剧情指令与参数…", 0, 0, "");
        let source = version.source.with_progress(job.clone());
        let client = version.client.with_progress(job.clone());
        let stories = Stories {
            data: self.data.clone(),
            index: version.index.clone(),
            source: source.clone(),
        };
        let plan = planning::plan(&stories, id).await?;
        let brief = version.base.metadata.review.iter().find_map(|group| {
            let row = group.stories.iter().find(|row| row.story_txt.as_deref() == Some(id))?;
            let chapter = if group.entry_type == 0 {
                Some("干员密录".to_owned())
            } else {
                group.name.clone()
            };
            Some(json!({
                "chapterName": chapter,
                "title": format!("{} {}", row.story_code.as_deref().unwrap_or_default(), row.story_name.as_deref().unwrap_or_default()),
                "tag": format!("  {}", row.avg_tag.as_deref().unwrap_or_default()),
                "infoId": row.story_info
            }))
        });
        let summary_id = brief
            .as_ref()
            .and_then(|b| b["infoId"].as_str())
            .map(|id| id.strip_prefix("info/").unwrap_or(id))
            .unwrap_or(id);
        let summary = stories.text(summary_id, true).await?;
        let signature = artifacts::fingerprint(&(
            crate::DECODER_REVISION,
            &version.index.source.version,
            &version.client.identity,
            id,
            &plan.script,
            &summary,
            &version.index.variables,
        ))?;
        let pack_path = self.runtime.join("packs").join(format!("{signature}.json"));
        if let Ok(raw) = tokio::fs::read(&pack_path).await {
            if let Ok(pack) = serde_json::from_slice::<Value>(&raw) {
                if let Ok(receipts) = serde_json::from_value::<BTreeMap<String, artifacts::Receipt>>(
                    pack["mediaReceipts"].clone(),
                ) {
                    let root = self.runtime.clone();
                    let cancel = job.cancel.clone();
                    let valid = crate::runtime::blocking(move || {
                        receipts.iter().all(|(name, r)| {
                            safe_path(&root.join("media"), name)
                                .is_ok_and(|p| artifacts::valid(&p, r, &cancel))
                        })
                    })
                    .await?;
                    if valid {
                        job.phase(Phase::Ready, "播放资源已就绪", 1, 1, "");
                        return Ok(pack);
                    }
                }
            }
        }
        ensure!(
            plan.missing.is_empty(),
            "部分剧情资源未能找到：{}",
            plan.missing
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join("；")
        );
        job.phase(Phase::Resources, "读取剧情与依赖…", 0, 0, "");
        let wanted = plan.wanted.keys().cloned().collect::<BTreeSet<_>>();
        let dependencies = planning::dependencies(&version.index, &wanted);
        let names = wanted
            .iter()
            .chain(&dependencies)
            .cloned()
            .collect::<Vec<_>>();
        let historical = plan
            .historical
            .iter()
            .map(|movie| {
                Source::new(
                    self.data.join("cache/historical-movies"),
                    movie.manifest.clone(),
                    job.cancel.clone(),
                )
                .map(|source| source.with_progress(job.clone()))
            })
            .collect::<Result<Vec<_>>>()?;
        job.phase(
            Phase::Download,
            "下载所需剧情资源…",
            0,
            names.len() + historical.len(),
            "",
        );
        let transfers = names
            .iter()
            .map(|name| {
                (
                    source.transfer_key(name),
                    name.clone(),
                    source.manifest.entries[name].total_size,
                )
            })
            .chain(
                historical
                    .iter()
                    .zip(&plan.historical)
                    .map(|(source, movie)| {
                        (
                            source.transfer_key(&movie.bundle),
                            movie.bundle.clone(),
                            source.manifest.entries[&movie.bundle].total_size,
                        )
                    }),
            );
        job.plan(transfers);
        source.prefetch(&names, 4).await?;
        for (source, movie) in historical.iter().zip(&plan.historical) {
            source.bundle(&movie.bundle).await?;
        }
        let exporter = Exporter {
            source,
            index: version.index.clone(),
            client,
            store: self.store.clone(),
        };
        let mut assets = BTreeMap::new();
        let total = plan.wanted.len() + plan.historical.len();
        for (done, (bundle, keys)) in plan.wanted.iter().enumerate() {
            crate::error::checkpoint(&job.cancel)?;
            job.phase(Phase::Convert, "准备画面与声音…", done, total, bundle);
            let _permit = self.decode.acquire().await?;
            if bundle.starts_with("raw/video/") {
                let asset = self
                    .video
                    .export(&exporter.source, bundle, &self.store)
                    .await?;
                for key in keys {
                    assets.insert(key.clone(), asset.clone());
                }
            } else {
                assets.extend(exporter.bundle(bundle, keys, &plan.tile_sprites).await?);
            }
        }
        for (number, movie) in plan.historical.iter().enumerate() {
            job.phase(
                Phase::Convert,
                "准备剧情影片…",
                plan.wanted.len() + number,
                total,
                &movie.bundle,
            );
            let source = &historical[number];
            let mut asset = self
                .video
                .export(source, &movie.bundle, &self.store)
                .await?;
            if let crate::media::Asset::Video(ref mut video) = asset {
                video.source = Some(movie.provenance.clone());
            }
            assets.insert(movie.key.clone(), asset);
        }
        let missing = plan
            .wanted
            .values()
            .flatten()
            .filter(|key| !assets.contains_key(*key))
            .cloned()
            .collect::<Vec<_>>();
        ensure!(
            missing.is_empty(),
            "部分剧情资源未能准备好：{}",
            missing
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join("；")
        );
        job.phase(Phase::Verify, "检查播放资源…", 0, 1, "");
        let mut pack = json!({
            "id":id,
            "version":version.index.source.version,
            "clientVersion":version.index.source.client_version,
            "compatibility":plan.compatibility,
            "script":plan.script,
            "variables":version.index.variables,
            "assets":assets,
            "unresolvedSoundKeys":plan.unresolved_sound_keys,
            "unresolvedMusicKeys":plan.unresolved_music_keys,
            "missing":[],
            "errors":[],
            "summary":summary,
            "skipBrief":brief,
            "resourceBundles":{"direct":wanted,"dependencies":dependencies,"historicalMovies":plan.historical.iter().map(|movie|&movie.provenance).collect::<Vec<_>>()}
        });
        let mut files = Vec::new();
        artifacts::media_files(&pack["assets"], &mut files);
        let files = files.into_iter().collect::<BTreeSet<_>>();
        let runtime = self.runtime.clone();
        let cancel = job.cancel.clone();
        let receipts = crate::runtime::blocking(move || {
            files
                .into_iter()
                .map(|name| {
                    let path = safe_path(&runtime, &name)?;
                    Ok((
                        name.trim_start_matches("media/").to_owned(),
                        artifacts::receipt(&path, &cancel)?,
                    ))
                })
                .collect::<Result<BTreeMap<_, _>>>()
        })
        .await??;
        pack["mediaReceipts"] = json!(receipts);
        write_json(&pack_path, &pack)?;
        Ok(pack)
    }

    pub async fn start_music(self: &Arc<Self>, id: String) -> Result<Arc<Progress>> {
        let version = self.current().await?;
        ensure!(
            version.base.music.tracks.iter().any(|t| t.id == id),
            "这首音乐不在当前列表中，请重新选择。"
        );
        let job = self.jobs.create(Kind::HomeMusic, false)?;
        let engine = self.clone();
        let progress = job.clone();
        self.jobs.spawn(job.clone(), async move {
            engine.prepare_music(version, &id, progress).await
        });
        Ok(job)
    }

    pub async fn prepare_music(
        &self,
        version: Arc<Version>,
        id: &str,
        job: Arc<Progress>,
    ) -> Result<Value> {
        let track = version
            .base
            .music
            .tracks
            .iter()
            .find(|t| t.id == id)
            .context("Unknown home music track")?;
        let mut wanted: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut keys = BTreeMap::new();
        for (part, raw) in [
            ("intro", track.intro.as_deref()),
            ("loop", track.r#loop.as_deref()),
        ] {
            let Some(raw) = raw.filter(|s| !s.is_empty()) else {
                keys.insert(part, String::new());
                continue;
            };
            let key = raw.rsplit('/').next().unwrap_or_default().to_lowercase();
            let route = planning::routed(&version.index, "playmusic", raw, &key)
                .context("主页音乐资源未找到。")?;
            wanted
                .entry(route.bundle.clone())
                .or_default()
                .insert(key.clone());
            keys.insert(part, key);
        }
        let own = wanted.keys().cloned().collect::<BTreeSet<_>>();
        let deps = planning::dependencies(&version.index, &own);
        let names = own.into_iter().chain(deps).collect::<Vec<_>>();
        let inputs = names
            .iter()
            .map(|name| &version.source.manifest.entries[name])
            .collect::<Vec<_>>();
        let signature = artifacts::fingerprint(&(
            crate::DECODER_REVISION,
            version.index.source.platform,
            &version.client.identity.manifest_sha256,
            track,
            inputs,
        ))?;
        let artifacts = self.artifacts.clone();
        let root = self.runtime.clone();
        let cancel = job.cancel.clone();
        let key = signature.clone();
        #[cfg(target_os = "emscripten")]
        artifacts.prepare_restore("music", &key, &cancel).await?;
        if let Some(result) =
            crate::runtime::blocking(move || artifacts.restore("music", &key, &root, &cancel))
                .await??
        {
            let mut files = Vec::new();
            artifacts::media_files(&result, &mut files);
            self.music_files.lock().unwrap().extend(files);
            return Ok(result);
        }
        let source = version.source.with_progress(job.clone());
        let client = version.client.with_progress(job.clone());
        job.phase(
            Phase::Download,
            "下载主页音乐…",
            0,
            names.len(),
            &track.name,
        );
        job.plan(names.iter().map(|name| {
            (
                source.transfer_key(name),
                track.name.clone(),
                source.manifest.entries[name].total_size,
            )
        }));
        source.prefetch(&names, 4).await?;
        let exporter = Exporter {
            source,
            index: version.index.clone(),
            client,
            store: self.store.clone(),
        };
        let mut assets = BTreeMap::new();
        for (done, (bundle, keys)) in wanted.iter().enumerate() {
            job.phase(
                Phase::Convert,
                "准备主页音乐…",
                done,
                wanted.len(),
                &track.name,
            );
            let _permit = self.decode.acquire().await?;
            assets.extend(exporter.bundle(bundle, keys, &BTreeSet::new()).await?);
        }
        ensure!(
            keys.values().all(|key| key.is_empty()
                || matches!(assets.get(key), Some(crate::media::Asset::Audio { .. }))),
            "主页音乐未能完整读取。"
        );
        let result = json!({"id":id,"name":track.name,"version":version.index.source.version,"intro":keys["intro"],"loop":keys["loop"],"volume":track.volume,"assets":assets});
        let mut files = Vec::new();
        artifacts::media_files(&result, &mut files);
        self.music_files
            .lock()
            .unwrap()
            .extend(files.iter().cloned());
        let artifacts = self.artifacts.clone();
        let root = self.runtime.clone();
        let cancel = job.cancel.clone();
        let metadata = result.clone();
        crate::runtime::blocking(move || {
            artifacts.store("music", &signature, &root, &files, metadata, &cancel)
        })
        .await??;
        Ok(result)
    }

    pub async fn storage(&self, scan: bool) -> Result<Value> {
        let mut value = self.status().await?;
        let mut original = None;
        let mut files = None;
        let mut startup = None;
        let mut temporary = None;
        if scan {
            let data = self.data.clone();
            let runtime = self.runtime.clone();
            let sizes = crate::runtime::blocking(move || {
                let raw = size_of(&data.join("cache"))?;
                let client = size_of(&data.join("client"))?;
                let shared = size_of(&data.join("derived-cache"))?;
                let temporary = size_of(&runtime)?;
                Ok::<_, anyhow::Error>((raw.0 + client.0, raw.1 + client.1, shared.0, temporary.0))
            })
            .await??;
            original = Some(sizes.0);
            files = Some(sizes.1);
            startup = Some(sizes.2);
            temporary = Some(sizes.3);
        }
        value.as_object_mut().unwrap().extend(
            json!({
                "dataPath":self.data,
                "runtimePath":self.runtime,
                "originalBytes":original,
                "originalFiles":files,
                "startupBytes":startup,
                "temporaryBytes":temporary,
                "scanned":scan,
                "policy":"originals-and-startup-cache"
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        Ok(value)
    }

    pub async fn clear_cache(&self) -> Result<()> {
        ensure!(
            !self.jobs.busy() && !self.playing.load(Ordering::Acquire),
            "请先结束播放和资源任务，再清理缓存。"
        );
        let artifacts = self.artifacts.clone();
        crate::runtime::blocking(move || artifacts.clear()).await??;
        let mut keep = self
            .current()
            .await
            .ok()
            .map(|v| {
                v.base
                    .files
                    .iter()
                    .filter_map(|name| {
                        Path::new(&name)
                            .file_name()
                            .map(|s| s.to_string_lossy().into_owned())
                    })
                    .collect::<BTreeSet<_>>()
            })
            .unwrap_or_default();
        keep.extend(self.music_files.lock().unwrap().iter().filter_map(|name| {
            Path::new(name)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
        }));
        let root = self.runtime.canonicalize()?;
        ensure!(
            root.join(".arkreader-session").is_file() && !self.data.starts_with(&root),
            "Refusing to clear an unowned render cache"
        );
        for entry in fs::read_dir(&self.store.directory)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !name.starts_with("native-") && !keep.contains(&name) {
                    fs::remove_file(safe_path(&root.join("media"), &name)?)?;
                }
            }
        }
        for name in ["packs", "exported"] {
            let target = safe_path(&root, name)?;
            if target.is_dir() {
                ensure!(
                    target.canonicalize()?.starts_with(&root),
                    "Render cache escaped session"
                );
                fs::remove_dir_all(target)?;
            }
        }
        Ok(())
    }
    pub async fn shutdown(&self) {
        self.cancel.cancel();
        self.jobs.cancel_all();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while self.jobs.busy() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        if !self.jobs.busy() {
            let session = self.session.lock().unwrap().take();
            if let Some(session) = session {
                let _ = crate::runtime::blocking(move || session.close()).await;
            }
        }
    }
}

fn size_of(path: &Path) -> Result<(u64, u64)> {
    if !path.exists() {
        return Ok((0, 0));
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Ok((0, 0));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Ok((0, 0));
        }
    }
    if metadata.is_file() {
        return Ok((metadata.len(), 1));
    }
    let mut size = 0;
    let mut count = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        match size_of(&entry.path()) {
            Ok((bytes, files)) => {
                size += bytes;
                count += files;
            }
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) => {}
            Err(error) => return Err(error),
        }
    }
    Ok((size, count))
}
impl Drop for Engine {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
