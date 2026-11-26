use crate::{artifacts, cache::write_json, prts, source};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
pub struct File {
    pub size: u64,
    pub sha256: String,
    pub url: String,
}
#[derive(Serialize, Deserialize)]
pub struct Archive {
    pub version: String,
    pub files: BTreeMap<String, File>,
}
async fn request(path: &str, cancel: &CancellationToken) -> Result<serde_json::Value> {
    source::json(
        &source::client()?,
        source::https(&format!("{}{path}", prts::BASE))?,
        Duration::from_secs(30),
        cancel,
    )
    .await
}
async fn discover(version: &str, cancel: &CancellationToken) -> Result<Archive> {
    let mut before = None;
    let release = loop {
        let suffix = before.map(|id| format!("&before={id}")).unwrap_or_default();
        let page = request(
            &format!("/api/v1/launcher/releases?limit=100{suffix}"),
            cancel,
        )
        .await?;
        let rows = page["releases"]
            .as_array()
            .context("PRTS 客户端清单无效。")?;
        if let Some(row) = rows
            .iter()
            .find(|r| r["gameVersion"] == version && r["readyAt"].is_string())
        {
            break row["id"].as_u64().context("PRTS archive ID missing")?;
        }
        ensure!(
            !rows.is_empty(),
            "PRTS 尚未收录与剧情资源匹配的内置 UI／字体。"
        );
        let next = rows
            .last()
            .and_then(|r| r["id"].as_u64())
            .context("PRTS archive cursor missing")?;
        ensure!(
            before.is_none_or(|old| next < old),
            "PRTS archive pagination stalled"
        );
        before = Some(next);
    };
    let mut files = BTreeMap::new();
    for prefix in ["sharedassets", "globalgamemanagers", "resources"] {
        let mut after: Option<String> = None;
        loop {
            let mut url = source::https(&format!(
                "{}/api/v1/launcher/releases/{release}/files",
                prts::BASE
            ))?;
            url.query_pairs_mut()
                .append_pair("q", &format!("Arknights_Data/{prefix}"))
                .append_pair("limit", "200");
            if let Some(value) = &after {
                url.query_pairs_mut().append_pair("after", value);
            }
            let page =
                source::json(&source::client()?, url, Duration::from_secs(30), cancel).await?;
            for row in page["files"]
                .as_array()
                .context("Missing PRTS builtin file list")?
            {
                let name = row["path"]
                    .as_str()
                    .context("PRTS builtin filename missing")?
                    .strip_prefix("Arknights_Data/")
                    .context("Unexpected PRTS builtin path")?;
                if name.contains('/') {
                    continue;
                }
                let sha256 = row["sha256"]
                    .as_str()
                    .context("PRTS 内置文件尚未归档完成。")?;
                let size = row["size"].as_u64().context("PRTS builtin size missing")?;
                files.insert(
                    name.into(),
                    File {
                        size,
                        sha256: sha256.into(),
                        url: prts::storage(sha256, "launcher/blobs/")?,
                    },
                );
            }
            match page["nextAfter"].as_str() {
                None => break,
                Some(next) => {
                    ensure!(
                        after.as_deref() != Some(next),
                        "PRTS file pagination stalled"
                    );
                    after = Some(next.to_owned());
                }
            }
        }
    }
    ensure!(
        files.contains_key("globalgamemanagers.assets"),
        "PRTS 内置资源不完整。"
    );
    Ok(Archive {
        version: version.into(),
        files,
    })
}
pub async fn load(
    path: &Path,
    version: &str,
    network: bool,
    cancel: &CancellationToken,
) -> Result<Archive> {
    let saved = std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<(String, Archive)>(&b).ok())
        .filter(|(hash, a)| {
            a.version == version && artifacts::fingerprint(a).ok().as_ref() == Some(hash)
        })
        .map(|(_, a)| a);
    if !network {
        return saved.context("请联网缓存内置 UI 和字体后再离线使用。");
    }
    match discover(version, cancel).await {
        Ok(value) => {
            write_json(path, &(artifacts::fingerprint(&value)?, &value))?;
            Ok(value)
        }
        Err(error) => {
            crate::error::checkpoint(cancel)?;
            saved.ok_or(error)
        }
    }
}
