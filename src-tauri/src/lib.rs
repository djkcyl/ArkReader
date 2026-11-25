mod app;
#[cfg(target_os = "android")]
mod mobile;

#[cfg_attr(
    any(target_os = "android", target_os = "ios"),
    tauri::mobile_entry_point
)]
pub fn run() {
    app::run();
}
