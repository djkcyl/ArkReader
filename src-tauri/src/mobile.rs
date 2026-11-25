use serde_json::{json, Value};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager,
};

struct Bridge(PluginHandle<tauri::Wry>);

pub fn insets(app: &tauri::AppHandle) -> Result<Value, String> {
    app.state::<Bridge>()
        .0
        .run_mobile_plugin("insets", json!({}))
        .map_err(|error| error.to_string())
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("arkreader-mobile")
        .setup(|app, api| {
            let handle = api.register_android_plugin("io.arkreader.mobile", "ArkReaderPlugin")?;
            app.manage(Bridge(handle));
            Ok(())
        })
        .build()
}

pub fn decoder_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let info: Value = app
        .state::<Bridge>()
        .0
        .run_mobile_plugin("paths", json!({}))
        .map_err(|error| error.to_string())?;
    let path = info["nativeLibraryDir"]
        .as_str()
        .ok_or("无法取得影片组件目录")?;
    Ok(std::path::Path::new(path).join("libarkreader_ffmpeg.so"))
}
pub fn playing(app: &tauri::AppHandle, value: bool) -> Result<(), String> {
    app.state::<Bridge>()
        .0
        .run_mobile_plugin::<()>("playerMode", json!({"playing":value}))
        .map_err(|error| error.to_string())
}
pub fn quit(app: &tauri::AppHandle) -> Result<(), String> {
    app.state::<Bridge>()
        .0
        .run_mobile_plugin::<()>("quit", json!({}))
        .map_err(|error| error.to_string())
}
