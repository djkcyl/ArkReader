use crate::{
    error::checkpoint,
    source::{self, Download, Entry, Manifest, Origin, Platform},
};
use anyhow::{ensure, Context, Result};
use serde::Deserialize;
use std::{collections::BTreeMap, time::Duration};
use tokio_util::sync::CancellationToken;

pub const BASE: &str = "https://torappu.prts.wiki";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Version {
    id: u64,
    client_version: String,
    res_version: String,
    is_ready: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Details {
    client_version: String,
    res_version: String,
    hot_update_list: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HotUpdate {
    version_id: String,
    ab_infos: Vec<Entry>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct File {
    path: String,
    file_hash: String,
    file_size: u64,
}
pub fn storage(hash: &str, prefix: &str) -> Result<String> {
    ensure!(
        hash.len() == 64 && hash.bytes().all(|v| v.is_ascii_hexdigit()),
        "Invalid PRTS file checksum"
    );
    Ok(format!(
        "{BASE}/storage/{prefix}{}/{}/{}",
        &hash[..2],
        &hash[2..4],
        &hash[4..]
    ))
}
async fn versions(timeout: Duration, cancel: &CancellationToken) -> Result<Vec<Version>> {
    let client = source::client()?;
    Ok(serde_json::from_value(
        source::json(
            &client,
            source::https(&format!("{BASE}/api/v1/version"))?,
            timeout,
            cancel,
        )
        .await?,
    )?)
}
pub async fn latest(
    timeout: Duration,
    cancel: &CancellationToken,
    cached: Option<&Manifest>,
) -> Result<Manifest> {
    let latest = versions(timeout, cancel)
        .await?
        .into_iter()
        .filter(|v| v.is_ready)
        .max_by(|a, b| a.res_version.cmp(&b.res_version).then(a.id.cmp(&b.id)))
        .context("PRTS 暂无可用资源版本。")?;
    if let Some(saved) = cached.filter(|saved| {
        saved.origin == Origin::Prts
            && saved.version == latest.res_version
            && saved.client_version == latest.client_version
            && !saved.entries.is_empty()
            && saved.downloads.len() == saved.entries.len()
    }) {
        return Ok(saved.clone());
    }
    let client = source::client()?;
    let (details, files) = tokio::try_join!(
        source::json(
            &client,
            source::https(&format!("{BASE}/api/v1/version/{}", latest.id))?,
            timeout,
            cancel
        ),
        source::json(
            &client,
            source::https(&format!("{BASE}/api/v1/version/{}/files", latest.id))?,
            timeout,
            cancel
        )
    )?;
    let details: Details = serde_json::from_value(details)?;
    let files: Vec<File> = serde_json::from_value(files)?;
    let hot: HotUpdate = serde_json::from_str(&details.hot_update_list)?;
    ensure!(
        details.res_version == latest.res_version
            && details.client_version == latest.client_version
            && hot.version_id == latest.res_version,
        "PRTS 版本与资源清单不一致。"
    );
    let mut archives = BTreeMap::new();
    for file in files {
        ensure!(
            archives.insert(file.path.clone(), file).is_none(),
            "Duplicate PRTS archive"
        );
    }
    let mut entries = BTreeMap::new();
    let mut downloads = BTreeMap::new();
    for entry in hot.ab_infos {
        checkpoint(cancel)?;
        crate::cache::resource_path(&entry.name)?;
        let file = archives
            .remove(&entry.name)
            .with_context(|| format!("PRTS 尚未收录资源：{}", entry.name))?;
        ensure!(
            file.file_size == entry.total_size,
            "PRTS archive size differs from publisher manifest"
        );
        let download = Download {
            url: storage(&file.file_hash, "")?,
            sha256: file.file_hash,
        };
        downloads.insert(entry.name.clone(), download);
        ensure!(
            entries.insert(entry.name.clone(), entry).is_none(),
            "Duplicate publisher resource"
        );
    }
    ensure!(!entries.is_empty(), "Empty PRTS resource manifest");
    Ok(Manifest {
        platform: Platform::Android,
        origin: Origin::Prts,
        version: latest.res_version,
        client_version: latest.client_version,
        base_url: format!("{BASE}/storage/"),
        entries,
        downloads,
    })
}
pub async fn archived(
    version: &str,
    entry: &Entry,
    cancel: &CancellationToken,
) -> Result<Download> {
    let timeout = Duration::from_secs(30);
    let version = versions(timeout, cancel)
        .await?
        .into_iter()
        .find(|v| v.res_version == version && v.is_ready)
        .context("PRTS 尚未收录此历史资源版本。")?;
    let mut url = source::https(&format!("{BASE}/api/v1/bundle"))?;
    url.query_pairs_mut()
        .append_pair("version", &version.id.to_string())
        .append_pair("path", &entry.name)
        .append_pair("limit", "200");
    let value = source::json(&source::client()?, url, timeout, cancel).await?;
    let rows: Vec<File> = serde_json::from_value(value["bundles"].clone())?;
    let row = rows
        .into_iter()
        .find(|r| r.path == entry.name && r.file_size == entry.total_size)
        .context("PRTS 尚未收录此历史影片。")?;
    Ok(Download {
        url: storage(&row.file_hash, "")?,
        sha256: row.file_hash,
    })
}
