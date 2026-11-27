pub(crate) mod client;
pub(crate) mod http;
mod rpc;
pub use rpc::install;

use anyhow::Result;
use std::{ffi::CString, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

unsafe extern "C" {
    fn ark_analyze(mode: *const u8, payload: *const u8, output: *mut u8, length: usize) -> i32;
    fn ark_media_open(
        video: *const u8,
        audio: *const u8,
        output: *const u8,
        soundtrack: *const u8,
        failure: *mut i32,
    ) -> usize;
    fn ark_media_step(movie: usize, budget: i32) -> i32;
    fn ark_media_close(movie: usize);
    fn av_strerror(error: i32, buffer: *mut u8, size: usize) -> i32;
}
pub fn analyze(mode: &str, payload: &str) -> Result<String> {
    let mode = CString::new(mode)?;
    let payload = CString::new(payload)?;
    let length = unsafe {
        ark_analyze(
            mode.as_ptr().cast(),
            payload.as_ptr().cast(),
            std::ptr::null_mut(),
            0,
        )
    };
    anyhow::ensure!(
        length > 0 && length < 64 * 1024 * 1024,
        "Invalid script parser response"
    );
    let mut bytes = vec![0; length as usize];
    let size = unsafe {
        ark_analyze(
            mode.as_ptr().cast(),
            payload.as_ptr().cast(),
            bytes.as_mut_ptr(),
            bytes.len(),
        )
    };
    anyhow::ensure!(size == length, "Script parser response changed");
    let result: serde_json::Value = serde_json::from_slice(&bytes)?;
    if let Some(error) = result["error"].as_str() {
        anyhow::bail!("{error}");
    }
    result["value"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| anyhow::anyhow!("Missing script parser response"))
}
pub async fn remux(
    video: &Path,
    audio: &Path,
    output: &Path,
    soundtrack: &Path,
    cancel: &CancellationToken,
) -> Result<()> {
    let video = CString::new(video.to_string_lossy().as_bytes())?;
    let audio = CString::new(audio.to_string_lossy().as_bytes())?;
    let output = CString::new(output.to_string_lossy().as_bytes())?;
    let soundtrack = CString::new(soundtrack.to_string_lossy().as_bytes())?;
    // The Emscripten runtime and this opaque media handle stay on one worker.
    struct Movie(usize);
    impl Drop for Movie {
        fn drop(&mut self) {
            unsafe { ark_media_close(self.0) }
        }
    }
    crate::error::checkpoint(cancel)?;
    let mut failure = 0;
    let movie = Movie(unsafe {
        ark_media_open(
            video.as_ptr().cast(),
            audio.as_ptr().cast(),
            output.as_ptr().cast(),
            soundtrack.as_ptr().cast(),
            &mut failure,
        )
    });
    if movie.0 == 0 {
        return Err(media_error(failure));
    }
    loop {
        crate::error::checkpoint(cancel)?;
        match unsafe { ark_media_step(movie.0, 64) } {
            0 => return Ok(()),
            1 => {
                tokio::select! { biased; _=cancel.cancelled()=>crate::error::checkpoint(cancel)?, _=tokio::time::sleep(Duration::from_millis(1))=>{} }
            }
            error => return Err(media_error(error)),
        }
    }
}

fn media_error(error: i32) -> anyhow::Error {
    let mut bytes = [0u8; 128];
    unsafe {
        av_strerror(error, bytes.as_mut_ptr(), bytes.len());
    }
    let end = bytes
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(bytes.len());
    anyhow::anyhow!(
        "影片封装失败：{} ({error})",
        String::from_utf8_lossy(&bytes[..end])
    )
}
