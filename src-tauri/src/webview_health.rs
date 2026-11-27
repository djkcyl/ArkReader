//! Display-process recovery is independent of the web document and resource worker.
use super::{diagnostic, AppState};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_window_state::AppHandleExt;

pub struct Health {
    pub generation: AtomicU64,
    pub recovering: AtomicBool,
    heartbeat: Mutex<Instant>,
    attempts: Mutex<VecDeque<Instant>>,
    notice: Mutex<Option<String>>,
}
impl Health {
    pub fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
            recovering: AtomicBool::new(false),
            heartbeat: Mutex::new(Instant::now()),
            attempts: Mutex::new(VecDeque::new()),
            notice: Mutex::new(None),
        }
    }
    pub fn beat(&self, generation: u64) {
        if self.generation.load(Ordering::SeqCst) == generation {
            *self.heartbeat.lock().unwrap() = Instant::now();
        }
    }
    pub fn notice(&self) -> Option<String> {
        self.notice.lock().unwrap().clone()
    }
}

pub fn configure_process() {
    // RTSS documents this opt-out for incompatible applications. It is scoped
    // to this process and inherited WebView2 children; no global RTSS profile,
    // other process or hardware acceleration setting is changed.
    #[cfg(windows)]
    std::env::set_var("RTSSHooksCompatibility", "1");
}

#[derive(Clone, Copy)]
struct Geometry {
    size: tauri::PhysicalSize<u32>,
    position: tauri::PhysicalPosition<i32>,
    maximized: bool,
    fullscreen: bool,
    visible: bool,
    focused: bool,
    minimized: bool,
}

fn initialization(generation: u64) -> String {
    format!(
        r#"(()=>{{if(window!==window.top)return;
document.addEventListener('contextmenu',event=>event.preventDefault(),{{capture:true}});
window.__arkreaderViewGeneration={generation};window.__ARKREADER_PLATFORM__="desktop";
function heartbeat(){{const core=window.__TAURI__&&window.__TAURI__.core;if(core)core.invoke('app_ui_heartbeat',{{generation:{generation}}}).catch(()=>{{}});}}
document.addEventListener('DOMContentLoaded',heartbeat,{{once:true}});setInterval(heartbeat,1500);
}})();"#
    )
}

pub fn create(app: &tauri::AppHandle) -> tauri::Result<WebviewWindow> {
    create_at(app, None)
}
fn create_at(app: &tauri::AppHandle, geometry: Option<Geometry>) -> tauri::Result<WebviewWindow> {
    let state = app.state::<AppState>();
    let generation = state.health.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *state.health.heartbeat.lock().unwrap() = Instant::now();
    let hidden = std::env::var("ARKREADER_VERIFY_HIDDEN").is_ok_and(|value| value != "0");
    let builder = WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::CustomProtocol("arkreader://localhost/startup.html".parse().unwrap()),
    );
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.data_directory(app.path().app_local_data_dir()?.join("webview"));
    let window = builder
        .title("ArkReader · 明日方舟剧情播放器")
        .inner_size(1440.0, 940.0)
        .min_inner_size(900.0, 620.0)
        .decorations(false)
        .resizable(true)
        .focused(!hidden && geometry.is_none_or(|g| g.focused))
        .initialization_script(initialization(generation))
        .background_color(tauri::window::Color(19, 27, 33, 255))
        .visible(!hidden && geometry.is_none_or(|g| g.visible))
        .on_navigation(|url| {
            matches!(url.scheme(), "tauri" | "arkreader")
                || url.scheme() == "http"
                    && matches!(
                        url.host_str(),
                        Some("tauri.localhost" | "arkreader.localhost")
                    )
        })
        .on_page_load(move |window, payload| {
            diagnostic(
                window.app_handle(),
                "page_load",
                &format!(
                    "generation={generation} event={:?} path={}",
                    payload.event(),
                    payload.url().path()
                ),
            );
        })
        .build()?;
    if let Some(g) = geometry {
        let _ = window.set_size(g.size);
        let _ = window.set_position(g.position);
        if g.maximized {
            let _ = window.maximize();
        }
        if g.fullscreen {
            let _ = window.set_fullscreen(true);
        }
        if g.minimized {
            let _ = window.minimize();
        }
    }
    install_events(app, &window, generation);
    diagnostic(app, "webview_created", &generation.to_string());
    Ok(window)
}

#[cfg(windows)]
fn install_events(app: &tauri::AppHandle, window: &WebviewWindow, generation: u64) {
    use webview2_com::{
        BrowserProcessExitedEventHandler, Microsoft::Web::WebView2::Win32::*,
        ProcessFailedEventHandler,
    };
    use windows::core::Interface;
    let handle = app.clone();
    let installed = window.with_webview(move |platform| unsafe {
        let register = || -> windows::core::Result<()> {
            let core = platform.controller().CoreWebView2()?;
            let mut pid = 0;
            core.BrowserProcessId(&mut pid)?;
            diagnostic(
                &handle,
                "webview_browser",
                &format!("generation={generation} pid={pid}"),
            );
            let h = handle.clone();
            let mut token = 0;
            core.add_ProcessFailed(
                &ProcessFailedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
                        args.ProcessFailedKind(&mut kind)?;
                        let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON_UNEXPECTED;
                        let mut exit = 0;
                        if let Ok(details) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                            let _ = details.Reason(&mut reason);
                            let _ = details.ExitCode(&mut exit);
                        }
                        diagnostic(
                            &h,
                            "webview_process_failed",
                            &format!(
                                "generation={generation} kind={} reason={} exit={exit:#x}",
                                kind.0, reason.0
                            ),
                        );
                        // BrowserProcessExited below waits for the whole group to release.
                        if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                            || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
                        {
                            request_recovery(
                                &h,
                                generation,
                                pid,
                                format!("显示进程异常（{}，{exit:#x}）", kind.0),
                            );
                        }
                    }
                    Ok(())
                })),
                &mut token,
            )?;
            let h = handle.clone();
            let environment = platform.environment().cast::<ICoreWebView2Environment5>()?;
            environment.add_BrowserProcessExited(
                &BrowserProcessExitedEventHandler::create(Box::new(move |_, args| {
                    let mut kind = COREWEBVIEW2_BROWSER_PROCESS_EXIT_KIND_NORMAL;
                    let mut exited_pid = pid;
                    if let Some(args) = args {
                        let _ = args.BrowserProcessExitKind(&mut kind);
                        let _ = args.BrowserProcessId(&mut exited_pid);
                    }
                    diagnostic(
                        &h,
                        "webview_browser_exited",
                        &format!("generation={generation} kind={} pid={exited_pid}", kind.0),
                    );
                    request_recovery(&h, generation, exited_pid, "显示引擎已意外退出".into());
                    Ok(())
                })),
                &mut token,
            )?;
            Ok(())
        };
        if let Err(error) = register() {
            diagnostic(
                &handle,
                "webview_event_registration_failed",
                &error.to_string(),
            );
        }
    });
    if let Err(error) = installed {
        diagnostic(app, "webview_event_registration_failed", &error.to_string());
    }
}
#[cfg(not(windows))]
fn install_events(_app: &tauri::AppHandle, _window: &WebviewWindow, _generation: u64) {}

fn allow_recovery(attempts: &mut VecDeque<Instant>, now: Instant) -> bool {
    while attempts
        .front()
        .is_some_and(|t| now.duration_since(*t) > Duration::from_secs(60))
    {
        attempts.pop_front();
    }
    if attempts.len() >= 3 {
        return false;
    }
    attempts.push_back(now);
    true
}

fn request_recovery(app: &tauri::AppHandle, generation: u64, browser_pid: u32, message: String) {
    let state = app.state::<AppState>();
    if state.quitting.load(Ordering::SeqCst)
        || state.health.generation.load(Ordering::SeqCst) != generation
        || state.health.recovering.swap(true, Ordering::SeqCst)
    {
        return;
    }
    diagnostic(
        app,
        "webview_recovery_requested",
        &format!("generation={generation} {message}"),
    );
    let allowed = allow_recovery(&mut state.health.attempts.lock().unwrap(), Instant::now());
    let h = app.clone();
    if !allowed {
        let _=app.run_on_main_thread(move||fatal(&h,"显示引擎连续异常，已停止自动重启。请关闭对此程序的叠加显示后重试；资料库和缓存均保留。"));
        return;
    }
    state.ui_epoch.fetch_add(1, Ordering::SeqCst);
    state.ui_ready.store(false, Ordering::SeqCst);
    state.navigating.store(false, Ordering::SeqCst);
    state.startup_page_ready.store(false, Ordering::SeqCst);
    state.playing.store(false, Ordering::SeqCst);
    super::cancel_document_tasks(&state);
    *state.startup_error.lock().unwrap() = None;
    *state.health.notice.lock().unwrap() = Some("界面已恢复，可从历史记录继续阅读。".into());
    let _ = app.run_on_main_thread(move || {
        let old = h.get_webview_window("main");
        let geometry = old.as_ref().and_then(|w| {
            Some(Geometry {
                size: w.inner_size().ok()?,
                position: w.outer_position().ok()?,
                maximized: w.is_maximized().unwrap_or(false),
                fullscreen: w.is_fullscreen().unwrap_or(false),
                visible: w.is_visible().unwrap_or(true),
                focused: w.is_focused().unwrap_or(false),
                minimized: w.is_minimized().unwrap_or(false),
            })
        });
        let flags = tauri_plugin_window_state::StateFlags::SIZE
            | tauri_plugin_window_state::StateFlags::POSITION
            | tauri_plugin_window_state::StateFlags::MAXIMIZED
            | tauri_plugin_window_state::StateFlags::FULLSCREEN;
        let _ = h.save_window_state(flags);
        if let Some(w) = old {
            if let Err(error) = w.destroy() {
                fatal(&h, &format!("无法重建显示窗口：{error}"));
                return;
            }
        }
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            while h.get_webview_window("main").is_some() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(25));
            }
            wait_for_browser(browser_pid);
            let handle = h.clone();
            let _ = h.run_on_main_thread(move || {
                if handle.state::<AppState>().quitting.load(Ordering::SeqCst) {
                    return;
                }
                match create_at(&handle, geometry) {
                    Ok(_) => {
                        handle
                            .state::<AppState>()
                            .health
                            .recovering
                            .store(false, Ordering::SeqCst);
                        diagnostic(&handle, "webview_recreated", &generation.to_string());
                    }
                    Err(error) => fatal(&handle, &format!("显示窗口恢复失败：{error}")),
                }
            });
        });
    });
}

#[cfg(windows)]
fn wait_for_browser(pid: u32) {
    if pid == 0 {
        return;
    }
    use windows::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
    };
    unsafe {
        if let Ok(process) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            let _ = WaitForSingleObject(process, 4000);
            let _ = CloseHandle(process);
        }
    }
}
#[cfg(not(windows))]
fn wait_for_browser(_pid: u32) {}

fn fatal(app: &tauri::AppHandle, message: &str) {
    diagnostic(app, "webview_recovery_failed", message);
    if std::env::var_os("ARKREADER_VERIFY_HIDDEN").is_some() {
        app.state::<AppState>()
            .quitting
            .store(true, Ordering::SeqCst);
        app.exit(1);
        return;
    }
    #[cfg(windows)]
    {
        use windows::{
            core::PCWSTR,
            Win32::UI::WindowsAndMessaging::{MessageBoxW, IDRETRY, MB_ICONERROR, MB_RETRYCANCEL},
        };
        let detail = format!(
            "{message}\n\n若使用 RivaTuner / MSI Afterburner，请为 ArkReader 关闭叠加显示后重试。"
        );
        let text: Vec<u16> = detail.encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "ArkReader 显示恢复".encode_utf16().chain(Some(0)).collect();
        let choice = unsafe {
            MessageBoxW(
                None,
                PCWSTR(text.as_ptr()),
                PCWSTR(title.as_ptr()),
                MB_RETRYCANCEL | MB_ICONERROR,
            )
        };
        if choice == IDRETRY {
            let state = app.state::<AppState>();
            state.health.attempts.lock().unwrap().clear();
            state.health.recovering.store(false, Ordering::SeqCst);
            request_recovery(
                app,
                state.health.generation.load(Ordering::SeqCst),
                0,
                "用户重试显示恢复".into(),
            );
            return;
        }
    }
    app.state::<AppState>()
        .quitting
        .store(true, Ordering::SeqCst);
    app.exit(1);
}

pub fn monitor(app: tauri::AppHandle) {
    thread::spawn(move || {
        let mut previous = Instant::now();
        loop {
            thread::sleep(Duration::from_secs(2));
            let state = app.state::<AppState>();
            if state.quitting.load(Ordering::SeqCst) {
                break;
            }
            // A machine waking from sleep needs a fresh response window. Native
            // probes also avoid Chromium's throttling of timers in minimized tabs.
            let now = Instant::now();
            if now.duration_since(previous) > Duration::from_secs(10) {
                *state.health.heartbeat.lock().unwrap() = now;
            }
            previous = now;
            if !state.health.recovering.load(Ordering::SeqCst)
                && state.health.heartbeat.lock().unwrap().elapsed() > Duration::from_secs(20)
            {
                request_recovery(
                    &app,
                    state.health.generation.load(Ordering::SeqCst),
                    0,
                    "显示页面心跳超时".into(),
                );
            }
            if let Some(window) = app.get_webview_window("main") {
                let generation = state.health.generation.load(Ordering::SeqCst);
                let _=window.eval(format!("window.__TAURI__?.core.invoke('app_ui_heartbeat',{{generation:{generation}}}).catch(()=>{{}})"));
            }
        }
    });
}
