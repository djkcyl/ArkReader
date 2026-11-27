use arkreader_resource_engine::{engine::Engine, progress::Kind, video::Decoder};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_opener::OpenerExt;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_window_state::AppHandleExt;
use tower::ServiceExt;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[path = "webview_health.rs"]
mod webview_health;

const CSP:&str="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: http://127.0.0.1:*; connect-src 'self' ipc: http://ipc.localhost; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

struct AppState {
    engine: Mutex<Option<Arc<Engine>>>,
    router: Mutex<Option<axum::Router>>,
    #[cfg(target_os = "linux")]
    media_stream: Mutex<Option<arkreader_resource_engine::media_stream::MediaStream>>,
    library: PathBuf,
    playing: AtomicBool,
    quitting: AtomicBool,
    startup_error: Mutex<Option<String>>,
    startup_started: Mutex<Instant>,
    startup_page_ready: AtomicBool,
    ui_ready: AtomicBool,
    navigating: AtomicBool,
    ui_epoch: AtomicU64,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    health: webview_health::Health,
}

fn diagnostic(app: &tauri::AppHandle, event: &str, message: &str) {
    if std::env::var_os("ARKREADER_VERIFY_HIDDEN").is_some() {
        eprintln!(
            "ARKREADER_DIAGNOSTIC {event} {}",
            serde_json::to_string(message).unwrap_or_default()
        );
    }
    if let Ok(directory) = app.path().app_log_dir() {
        let _ = fs::create_dir_all(&directory);
        let path = directory.join("startup.log");
        if fs::metadata(&path).is_ok_and(|m| m.len() > 512 * 1024) {
            let old = directory.join("startup.previous.log");
            let _ = fs::remove_file(&old);
            let _ = fs::rename(&path, old);
        }
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let message = message.chars().take(4096).collect::<String>();
            let _ = writeln!(
                file,
                "{time} {event} {}",
                serde_json::to_string(&message).unwrap_or_default()
            );
        }
    }
}
fn application_url(path: &str) -> String {
    format!(
        "{}{path}",
        if cfg!(any(windows, target_os = "android")) {
            "http://arkreader.localhost"
        } else {
            "arkreader://localhost"
        }
    )
}
fn engine(app: &tauri::AppHandle) -> Result<Arc<Engine>, String> {
    app.state::<AppState>()
        .engine
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "资源引擎正在启动…".into())
}

fn cancel_document_tasks(state: &AppState) {
    if let Some(engine) = state.engine.lock().unwrap().as_ref() {
        engine.set_playing(false);
        for kind in [Kind::Prepare, Kind::HomeMusic] {
            if let Some(job) = engine.jobs.latest(Some(kind)) {
                job.cancel();
            }
        }
    }
}

fn recover_ui(app: &tauri::AppHandle, message: String, epoch: Option<u64>) {
    let state = app.state::<AppState>();
    if state.quitting.load(Ordering::SeqCst)
        || epoch.is_some_and(|e| e != state.ui_epoch.load(Ordering::SeqCst))
    {
        return;
    }
    cancel_document_tasks(&state);
    state.ui_epoch.fetch_add(1, Ordering::SeqCst);
    state.ui_ready.store(false, Ordering::SeqCst);
    state.navigating.store(false, Ordering::SeqCst);
    state.startup_page_ready.store(false, Ordering::SeqCst);
    *state.startup_error.lock().unwrap() = Some(message.clone());
    diagnostic(app, "ui_recovery", &message);
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.navigate(application_url("/startup.html").parse().unwrap()) {
            diagnostic(app, "recovery_navigation_failed", &error.to_string());
        }
    }
}

fn navigate_main_if_ready(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let ready = state
        .engine
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|engine| engine.is_ready());
    if state.quitting.load(Ordering::SeqCst)
        || !state.startup_page_ready.load(Ordering::SeqCst)
        || !ready
        || state.startup_error.lock().unwrap().is_some()
        || state.ui_ready.load(Ordering::SeqCst)
        || state.navigating.swap(true, Ordering::SeqCst)
    {
        return;
    }
    let epoch = state.ui_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    diagnostic(app, "navigate_main", &epoch.to_string());
    if let Some(window) = app.get_webview_window("main") {
        let detail = json!({"epoch":epoch,"version":app.package_info().version.to_string()});
        if let Err(error) = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('arkreader-open-main',{{detail:{detail}}}))"
        )) {
            recover_ui(app, error.to_string(), Some(epoch));
            return;
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(25);
        while Instant::now() < deadline {
            let state = app.state::<AppState>();
            if state.quitting.load(Ordering::SeqCst)
                || state.ui_ready.load(Ordering::SeqCst)
                || state.ui_epoch.load(Ordering::SeqCst) != epoch
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        recover_ui(&app, "主界面未能完成加载，请重试。".into(), Some(epoch));
    });
}

fn launch(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let result: Result<(), String> = async {
            let data = app.state::<AppState>().library.clone();
            let render_root = app
                .path()
                .app_cache_dir()
                .map_err(|e| e.to_string())?
                .join("render-sessions");
            #[cfg(target_os = "android")]
            let executable = {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || crate::mobile::decoder_path(&app))
                    .await
                    .map_err(|e| e.to_string())??
            };
            #[cfg(not(target_os = "android"))]
            let executable = std::env::var_os("ARKREADER_FFMPEG")
                .map(PathBuf::from)
                .unwrap_or(
                    app.path()
                        .resource_dir()
                        .map_err(|e| e.to_string())?
                        .join("native")
                        .join(if cfg!(windows) {
                            "ffmpeg.exe"
                        } else {
                            "ffmpeg"
                        }),
                );
            let native = Engine::with_decoder(data, render_root, Decoder { executable })
                .map_err(|e| e.to_string())?;
            #[cfg(target_os = "linux")]
            {
                let stream =
                    arkreader_resource_engine::media_stream::MediaStream::start(native.clone())
                        .await
                        .map_err(|e| e.to_string())?;
                *app.state::<AppState>().media_stream.lock().unwrap() = Some(stream);
            }
            let router = arkreader_resource_engine::api::router(native.clone());
            *app.state::<AppState>().router.lock().unwrap() = Some(router);
            *app.state::<AppState>().engine.lock().unwrap() = Some(native.clone());
            native.start(true).map_err(|e| e.to_string())?;
            diagnostic(
                &app,
                "engine_ready",
                arkreader_resource_engine::DECODER_REVISION,
            );
            Ok(())
        }
        .await;
        if let Err(error) = result {
            *app.state::<AppState>().startup_error.lock().unwrap() = Some(error.clone());
            diagnostic(&app, "engine_failed", &error);
        }
    });
}

fn ui_asset_path(path: &str) -> Option<String> {
    if path
        .split('/')
        .any(|part| part == ".." || part.contains('\\'))
    {
        return None;
    }
    match path {
        "/" | "/index.html" => Some("index.html".into()),
        "/startup.html" | "/startup.css" | "/ui-watchdog.js" => {
            Some(path.trim_start_matches('/').into())
        }
        path if path.starts_with("/assets/") => Some(path.trim_start_matches('/').into()),
        _ => None,
    }
}
fn cap_range(value: &str) -> Option<String> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let limit = start.saturating_add(4 * 1024 * 1024 - 1);
    let end = if end.is_empty() {
        limit
    } else {
        end.parse::<u64>().ok()?.min(limit)
    };
    (end >= start).then(|| format!("bytes={start}-{end}"))
}

async fn protocol(
    app: &tauri::AppHandle,
    mut request: tauri::http::Request<Vec<u8>>,
) -> Result<tauri::http::Response<Vec<u8>>, String> {
    if request
        .uri()
        .host()
        .is_some_and(|host| host != "localhost" && host != "arkreader.localhost")
    {
        return Err("Unknown application origin".into());
    }
    if let Some(path) = ui_asset_path(request.uri().path()) {
        let asset = app
            .asset_resolver()
            .get_for_scheme(path, false)
            .ok_or("程序缺少内置界面文件")?;
        return tauri::http::Response::builder()
            .status(200)
            .header("content-type", asset.mime_type)
            .header("content-length", asset.bytes.len())
            .header("Content-Security-Policy", CSP)
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "no-store")
            .body(if request.method() == tauri::http::Method::HEAD {
                Vec::new()
            } else {
                asset.bytes
            })
            .map_err(|e| e.to_string());
    }
    if !(request.uri().path().starts_with("/api/") || request.uri().path().starts_with("/media/")) {
        return Err("Unknown application resource".into());
    }
    if request.uri().path().ends_with(".mp4") {
        if let Some(value) = request
            .headers()
            .get("range")
            .and_then(|v| v.to_str().ok())
            .and_then(cap_range)
        {
            request.headers_mut().insert(
                "range",
                value
                    .parse()
                    .map_err(|e: tauri::http::header::InvalidHeaderValue| e.to_string())?,
            );
        }
    }
    let router = app
        .state::<AppState>()
        .router
        .lock()
        .unwrap()
        .clone()
        .ok_or("资源引擎正在启动…")?;
    let (parts, body) = request.into_parts();
    let request = tauri::http::Request::from_parts(parts, axum::body::Body::from(body));
    let response = match router.oneshot(request).await {
        Ok(response) => response,
        Err(never) => match never {},
    };
    let (mut parts, body) = response.into_parts();
    parts
        .headers
        .insert("Content-Security-Policy", CSP.parse().unwrap());
    parts
        .headers
        .insert("X-Content-Type-Options", "nosniff".parse().unwrap());
    let body = body.collect().await.map_err(|e| e.to_string())?.to_bytes();
    Ok(tauri::http::Response::from_parts(parts, body.to_vec()))
}

#[derive(serde::Serialize)]
struct ApiReply {
    status: u16,
    body: Value,
}

#[tauri::command]
async fn app_request(app: tauri::AppHandle, path: String, body: Value) -> Result<ApiReply, String> {
    if !path.starts_with("/api/") {
        return Err("Unknown application operation".into());
    }
    let request = tauri::http::Request::builder()
        .method(tauri::http::Method::POST)
        .uri(path)
        .header("Content-Type", "application/json")
        .body(serde_json::to_vec(&body).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let response = protocol(&app, request).await?;
    let status = response.status().as_u16();
    let bytes = response.into_body();
    let body = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!({ "detail": String::from_utf8_lossy(&bytes) }));
    Ok(ApiReply { status, body })
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> Value {
    let state = app.state::<AppState>();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let notice = state.health.notice();
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let notice: Option<String> = None;
    json!({"version":app.package_info().version.to_string(),"platform":std::env::consts::OS,"library":state.library,"displayRecovery":notice})
}
#[tauri::command]
fn app_ui_heartbeat(app: tauri::AppHandle, generation: u64) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    app.state::<AppState>().health.beat(generation);
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = (app, generation);
}

#[tauri::command]
async fn app_insets(app: tauri::AppHandle) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        tauri::async_runtime::spawn_blocking(move || crate::mobile::insets(&app))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(json!({"top":0,"right":0,"bottom":0,"left":0}))
    }
}
#[tauri::command]
async fn app_playing(app: tauri::AppHandle, playing: bool) -> Result<(), String> {
    app.state::<AppState>()
        .playing
        .store(playing, Ordering::SeqCst);
    if let Ok(engine) = engine(&app) {
        engine.set_playing(playing);
    }
    #[cfg(target_os = "android")]
    {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || crate::mobile::playing(&app, playing))
            .await
            .map_err(|e| e.to_string())??;
    }
    Ok(())
}
#[tauri::command]
async fn app_retry(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.startup_error.lock().unwrap() = None;
    state.startup_page_ready.store(false, Ordering::SeqCst);
    state.ui_ready.store(false, Ordering::SeqCst);
    state.navigating.store(false, Ordering::SeqCst);
    state.ui_epoch.fetch_add(1, Ordering::SeqCst);
    *state.startup_started.lock().unwrap() = Instant::now();
    if let Some(window) = app.get_webview_window("main") {
        if window.url().is_ok_and(|url| url.path() != "/startup.html") {
            window
                .navigate(application_url("/startup.html").parse().unwrap())
                .map_err(|e| e.to_string())?;
        }
    }
    if let Ok(engine) = engine(&app) {
        if !engine.is_ready() && !engine.jobs.busy() {
            engine.start(false).map_err(|e| e.to_string())?;
        }
    } else {
        launch(app.clone());
    }
    Ok(())
}
#[tauri::command]
fn app_cancel_startup(app: tauri::AppHandle) -> Result<(), String> {
    let engine = engine(&app)?;
    if let Some(job) = engine.jobs.latest(Some(Kind::Import)) {
        if job.running() {
            engine.cancel_job(&job.id).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
fn app_startup_ready(app: tauri::AppHandle) {
    app.state::<AppState>()
        .startup_page_ready
        .store(true, Ordering::SeqCst);
    navigate_main_if_ready(&app);
}
#[tauri::command]
fn app_ui_ready(app: tauri::AppHandle, epoch: Option<u64>) {
    let state = app.state::<AppState>();
    if epoch.is_some_and(|e| e != state.ui_epoch.load(Ordering::SeqCst)) {
        return;
    }
    if !app
        .get_webview_window("main")
        .and_then(|w| w.url().ok())
        .is_some_and(|url| matches!(url.path(), "/" | "/index.html"))
    {
        return;
    }
    state.ui_ready.store(true, Ordering::SeqCst);
    state.navigating.store(false, Ordering::SeqCst);
    *state.startup_error.lock().unwrap() = None;
    diagnostic(
        &app,
        "main_ui_ready",
        &state.ui_epoch.load(Ordering::SeqCst).to_string(),
    );
    if std::env::var_os("ARKREADER_VERIFY_HIDDEN").is_some()
        && std::env::var_os("ARKREADER_VERIFY_EXIT_READY").is_some()
    {
        if let Some(path) = std::env::var_os("ARKREADER_VERIFY_SCRIPT") {
            let result = fs::read_to_string(path)
                .map_err(|error| error.to_string())
                .and_then(|script| {
                    app.get_webview_window("main")
                        .ok_or_else(|| "Verification window missing".to_owned())?
                        .eval(&script)
                        .map_err(|error| error.to_string())
                });
            match result {
                Ok(()) => return,
                Err(error) => diagnostic(&app, "verification_failed", &error),
            }
        }
        app_quit(app);
    }
}
#[tauri::command]
fn app_ui_failed(app: tauri::AppHandle, message: String, epoch: Option<u64>) {
    recover_ui(&app, message.chars().take(4096).collect(), epoch);
}
#[tauri::command]
fn app_frontend_log(app: tauri::AppHandle, message: String) {
    diagnostic(&app, "frontend_error", &message);
}
#[tauri::command]
async fn app_startup_progress(app: tauri::AppHandle) -> Result<Value, String> {
    let native = engine(&app).ok();
    let mut value = if let Some(engine) = &native {
        let status = engine.status().await.map_err(|e| e.to_string())?;
        let mut value = status["job"].clone();
        if !value.is_object() {
            value = json!({});
        }
        value["skinReady"] = status["startupSkinReady"].clone();
        value["cursorReady"] = status["cursorReady"].clone();
        value["versionNotice"] = status["resourceUpdate"]["warning"].clone();
        if engine.is_ready() {
            value["phase"] = "ready".into();
            value["state"] = "ready".into();
            value["message"] = "准备完成，正在进入剧情库…".into();
            value["overallProgress"] = 1.into();
            value["error"] = Value::Null;
        }
        value
    } else {
        json!({"phase":"process","message":"正在启动…","state":"running","running":true,"overallProgress":0})
    };
    let state = app.state::<AppState>();
    value["elapsed"] = json!(state
        .startup_started
        .lock()
        .unwrap()
        .elapsed()
        .as_secs_f64());
    value["resourcesReady"] = json!(native.is_some_and(|engine| engine.is_ready()));
    value["uiReady"] = json!(state.ui_ready.load(Ordering::SeqCst));
    value["navigating"] = json!(state.navigating.load(Ordering::SeqCst));
    if let Some(error) = state.startup_error.lock().unwrap().clone() {
        value["error"] = error.into();
    }
    Ok(value)
}
#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    if app
        .state::<AppState>()
        .quitting
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let flags = tauri_plugin_window_state::StateFlags::SIZE
            | tauri_plugin_window_state::StateFlags::POSITION
            | tauri_plugin_window_state::StateFlags::MAXIMIZED
            | tauri_plugin_window_state::StateFlags::FULLSCREEN;
        let _ = app.save_window_state(flags);
    }
    tauri::async_runtime::spawn(async move {
        #[cfg(target_os = "linux")]
        {
            let stream = app.state::<AppState>().media_stream.lock().unwrap().take();
            if let Some(stream) = stream {
                stream.close().await;
            }
        }
        if let Ok(engine) = engine(&app) {
            engine.shutdown().await;
        }
        #[cfg(target_os = "android")]
        let _ = crate::mobile::quit(&app);
        app.exit(0);
    });
}
#[tauri::command]
fn app_open_library(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let path = app.state::<AppState>().library.clone();
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|e| e.to_string())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        Err("此平台使用应用专属数据目录。".into())
    }
}

pub fn run() {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    webview_health::configure_process();
    let mut context = tauri::generate_context!();
    if std::env::var_os("ARKREADER_VERIFY_HIDDEN").is_some() {
        context.config_mut().identifier = format!("io.arkreader.verify.p{}", std::process::id());
    }
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        );
    #[cfg(target_os = "android")]
    let builder = builder.plugin(crate::mobile::init());
    let application = builder
        .register_asynchronous_uri_scheme_protocol("arkreader", |context, request, responder| {
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let response = protocol(&app, request).await.unwrap_or_else(|error| {
                    tauri::http::Response::builder()
                        .status(503)
                        .header("content-type", "application/json")
                        .body(serde_json::to_vec(&json!({ "detail": error })).unwrap())
                        .unwrap()
                });
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            app_info, app_request, app_insets, app_playing, app_retry, app_cancel_startup,
            app_startup_ready, app_startup_progress, app_quit, app_open_library,
            app_ui_ready, app_ui_failed, app_ui_heartbeat, app_frontend_log
        ])
        .setup(|app| {
            let library = std::env::var_os("ARKREADER_DATA")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?.join("library"));
            app.manage(AppState {
                engine: Mutex::new(None),
                router: Mutex::new(None),
                #[cfg(target_os = "linux")]
                media_stream: Mutex::new(None),
                library,
                playing: AtomicBool::new(false),
                quitting: AtomicBool::new(false),
                startup_error: Mutex::new(None),
                startup_started: Mutex::new(Instant::now()),
                startup_page_ready: AtomicBool::new(false),
                ui_ready: AtomicBool::new(false),
                navigating: AtomicBool::new(false),
                ui_epoch: AtomicU64::new(0),
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                health: webview_health::Health::new(),
            });
            diagnostic(app.handle(), "application_start", &app.package_info().version.to_string());
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                webview_health::create(app.handle())?;
                webview_health::monitor(app.handle().clone());
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::CustomProtocol("arkreader://localhost/startup.html".parse().unwrap()),
                )
                .title("ArkReader")
                .initialization_script(format!(
                    "window.__ARKREADER_PLATFORM__={};document.addEventListener('contextmenu',e=>e.preventDefault());",
                    serde_json::to_string(std::env::consts::OS).unwrap()
                ))
                .build()?;
            }
            launch(app.handle().clone());
            Ok(())
        })
        .build(context)
        .expect("Unable to start ArkReader");
    application.run(|app, event| {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            let state = app.state::<AppState>();
            if !state.quitting.load(Ordering::SeqCst) {
                api.prevent_exit();
                if !state.health.recovering.load(Ordering::SeqCst) {
                    app_quit(app.clone());
                }
            }
        }
        if matches!(event, tauri::RunEvent::Exit) {
            if let Ok(engine) = engine(app) {
                engine.jobs.cancel_all();
            }
        }
    });
}
