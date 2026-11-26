use crate::{
    artifacts,
    cache::{safe_path, write_json},
    media::{Asset, MediaStore, VideoAsset},
    source::Source,
};
use anyhow::{ensure, Context, Result};
use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct Decoder {
    pub executable: PathBuf,
}

fn copy(input: &mut impl Read, output: &mut impl Write, cancel: &CancellationToken) -> Result<()> {
    let mut buffer = [0u8; 65536];
    loop {
        crate::error::checkpoint(cancel)?;
        let n = input.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        output.write_all(&buffer[..n])?;
    }
    Ok(())
}

pub fn demux(path: &Path, video: &Path, audio: &Path, cancel: &CancellationToken) -> Result<()> {
    let mut input = fs::File::open(path)?;
    let length = input.metadata()?.len();
    let mut video = fs::File::create(video)?;
    let mut audio = fs::File::create(audio)?;
    let mut seen_video = false;
    let mut seen_audio = false;
    while input.stream_position()? < length {
        crate::error::checkpoint(cancel)?;
        let start = input.stream_position()?;
        let mut header = [0u8; 32];
        input.read_exact(&mut header)?;
        ensure!(
            start != 0 || &header[..4] == b"CRID",
            "Invalid Sofdec header"
        );
        let size = u32::from_be_bytes(header[4..8].try_into()?) as u64;
        let offset = header[9] as u64;
        let padding = u16::from_be_bytes(header[10..12].try_into()?) as u64;
        let end = start
            .checked_add(8)
            .and_then(|start| start.checked_add(size))
            .context("Movie chunk overflow")?;
        ensure!(
            end <= length && offset >= 24 && size >= offset + padding,
            "Invalid movie chunk boundaries"
        );
        let tag = &header[..4];
        if header[15] == 0 && (tag == b"@SFV" || tag == b"@SFA") {
            ensure!(
                header[12] == 0,
                "Multiple native movie tracks are unsupported"
            );
            let count = size - offset - padding;
            input.seek(SeekFrom::Start(start + 8 + offset))?;
            let first = if tag == b"@SFV" {
                !seen_video
            } else {
                !seen_audio
            };
            if first {
                let mut prefix = [0u8; 12];
                ensure!(count >= 12, "Incomplete movie codec header");
                input.read_exact(&mut prefix)?;
                if tag == b"@SFV" {
                    ensure!(
                        &prefix[..4] == b"DKIF" && &prefix[8..12] == b"VP90",
                        "Unsupported native movie picture codec"
                    );
                } else {
                    ensure!(
                        &prefix[..2] == b"\x80\x00",
                        "Unsupported native movie audio codec"
                    );
                }
                input.seek(SeekFrom::Start(start + 8 + offset))?;
            }
            let mut chunk = Read::by_ref(&mut input).take(count);
            if tag == b"@SFV" {
                copy(&mut chunk, &mut video, cancel)?;
                seen_video = true;
            } else {
                copy(&mut chunk, &mut audio, cancel)?;
                seen_audio = true;
            }
            ensure!(chunk.limit() == 0, "Incomplete movie chunk");
        }
        input.seek(SeekFrom::Start(end))?;
    }
    ensure!(seen_video && seen_audio, "Native movie is missing a track");
    video.sync_all()?;
    audio.sync_all()?;
    Ok(())
}

impl Decoder {
    pub async fn export(&self, source: &Source, bundle: &str, store: &MediaStore) -> Result<Asset> {
        let entry = source
            .manifest
            .entries
            .get(bundle)
            .context("Movie bundle missing")?;
        let native_mp4 = bundle.ends_with(".mp4");
        let encoding = if native_mp4 {
            "original-mp4-1"
        } else {
            "vp9-flac-1"
        };
        let signature = artifacts::fingerprint(&(
            crate::DECODER_REVISION,
            &source.manifest.version,
            &entry.md5,
            encoding,
        ))?;
        let receipts = store
            .directory
            .parent()
            .context("Media directory has no session")?
            .join("exported");
        let record = receipts.join(format!("movie-{signature}.json"));
        if let Ok(raw) = fs::read(&record) {
            if let Ok(asset) = serde_json::from_slice::<VideoAsset>(&raw) {
                let name = asset
                    .url
                    .strip_prefix("/media/")
                    .context("Invalid cached movie URL")?;
                let path = safe_path(&store.directory, name)?;
                let expected = artifacts::Receipt {
                    size: asset.size,
                    sha256: asset.sha256.clone(),
                };
                let cancel = source.cancellation();
                if tokio::task::spawn_blocking(move || artifacts::valid(&path, &expected, &cancel))
                    .await?
                {
                    return Ok(Asset::Video(asset));
                }
            }
        }
        let original = source.bundle(bundle, |_| {}).await?;
        let staging = tempfile::Builder::new()
            .prefix(".movie-")
            .tempdir_in(&store.directory)?;
        let output = staging.path().join("movie.mp4");
        let cancel = source.cancellation();
        if native_mp4 {
            let target = output.clone();
            let token = cancel.clone();
            tokio::task::spawn_blocking(move || {
                let mut input = fs::File::open(&original)?;
                let mut header = [0u8; 12];
                input.read_exact(&mut header)?;
                ensure!(&header[4..8] == b"ftyp", "Invalid original MP4 header");
                if fs::hard_link(&original, &target).is_err() {
                    input.seek(SeekFrom::Start(0))?;
                    let mut output = fs::File::create(target)?;
                    copy(&mut input, &mut output, &token)?;
                    output.sync_all()?;
                }
                Ok::<_, anyhow::Error>(())
            })
            .await??;
        } else {
            let video = staging.path().join("movie.ivf");
            let audio = staging.path().join("movie.adx");
            let video_path = video.clone();
            let audio_path = audio.clone();
            let token = cancel.clone();
            tokio::task::spawn_blocking(move || demux(&original, &video_path, &audio_path, &token))
                .await??;
            let log = staging.path().join("decoder.log");
            let mut command = tokio::process::Command::new(&self.executable);
            command
                .kill_on_drop(true)
                .args([
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-i",
                ])
                .arg(&video)
                .args(["-protocol_whitelist", "file,pipe", "-i"])
                .arg(&audio)
                .args(["-map", "0:v:0", "-map", "1:a:0"]);
            command.args(["-c:v", "copy", "-c:a", "flac", "-strict", "experimental"]);
            command
                .args(["-movflags", "+faststart"])
                .arg(&output)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(fs::File::create(&log)?);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.as_std_mut().creation_flags(0x08000000);
            }
            let mut child = command
                .spawn()
                .context("影片组件无法启动，请使用完整的 ArkReader 程序包。")?;
            let status = tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    child.kill().await?;
                    let _ = child.wait().await;
                    return Err(crate::error::Error::Cancelled.into());
                }
                status = tokio::time::timeout(Duration::from_secs(300), child.wait()) => {
                    match status {
                        Ok(result) => result?,
                        Err(_) => {
                            child.kill().await?;
                            let _ = child.wait().await;
                            anyhow::bail!("影片准备超时，请重试。");
                        }
                    }
                }
            };
            if !status.success() {
                let mut file = fs::File::open(log)?;
                let size = file.metadata()?.len().min(2000);
                file.seek(SeekFrom::End(-(size as i64)))?;
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)?;
                anyhow::bail!("影片封装失败：{}", String::from_utf8_lossy(&bytes));
            }
        }
        crate::error::checkpoint(&cancel)?;
        let target = output.clone();
        let token = cancel.clone();
        let receipt =
            tokio::task::spawn_blocking(move || artifacts::receipt(&target, &token)).await??;
        let name = format!("{}.mp4", receipt.sha256);
        let destination = store.directory.join(&name);
        if !destination.exists() {
            fs::rename(&output, &destination)?;
        }
        let asset = VideoAsset {
            url: format!("/media/{name}"),
            sha256: receipt.sha256,
            size: receipt.size,
            codecs: if native_mp4 { "h264,aac" } else { "vp9,flac" }.into(),
            bundle: bundle.into(),
            md5: entry.md5.clone(),
            source: None,
        };
        write_json(&record, &asset)?;
        drop(staging);
        Ok(Asset::Video(asset))
    }
}
