use crate::{
    cache::{safe_path, write_atomic, write_json},
    index,
    model::{Index, Route},
    script::{Analyzer, Compatibility},
    source::Source,
};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Serialize, Deserialize)]
struct TextReceipt {
    identity: String,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
struct InspectionReceipt {
    identity: String,
    report: Compatibility,
}

#[derive(Clone)]
pub struct Stories {
    pub data: PathBuf,
    pub index: Arc<Index>,
    pub source: Source,
}
impl Stories {
    pub async fn text(&self, id: &str, summary: bool) -> Result<String> {
        let route = if summary {
            self.index.summaries.get(id)
        } else {
            self.index.stories.get(id)
        };
        let Some(route) = route else {
            ensure!(summary, "Unknown story: {id}");
            return Ok(String::new());
        };
        self.read(route).await
    }

    async fn read(&self, route: &Route) -> Result<String> {
        let entry = self
            .source
            .manifest
            .entries
            .get(&route.bundle)
            .context("Story bundle missing from source")?;
        let identity = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(
                self.source.manifest.platform,
                &self.source.manifest.version,
                route,
                entry
            ))?)
        );
        let receipt = self
            .data
            .join("text-receipts")
            .join(format!("{identity}.json"));
        let blob_root = self.data.join("text-cache");
        let expected = identity.clone();
        let record = receipt.clone();
        let root = blob_root.clone();
        let cached =
            crate::runtime::blocking(move || read_text_cache(&record, &root, &expected)).await??;
        if let Some(text) = cached {
            return Ok(text);
        }
        let raw = index::read_route(&self.source, route).await?;
        let text = String::from_utf8(raw).context("Official story script is not valid UTF-8")?;
        let bytes = text.as_bytes().to_vec();
        crate::runtime::blocking(move || {
            let sha256 = format!("{:x}", Sha256::digest(&bytes));
            write_atomic(&blob_root.join(&sha256), &bytes)?;
            write_json(&receipt, &TextReceipt { identity, sha256 })
        })
        .await??;
        Ok(text)
    }

    pub async fn inspect(&self, script: &str) -> Result<Compatibility> {
        let revision = Analyzer::revision();
        let identity = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(
                script,
                &self.index.variables,
                &revision
            ))?)
        );
        let path = self
            .data
            .join("script-inspection")
            .join(format!("{identity}.json"));
        let script = script.to_owned();
        let index = self.index.clone();
        let cancel = self.source.cancellation();
        crate::runtime::blocking(move || {
            if let Ok(raw) = fs::read(&path) {
                if let Ok(saved) = serde_json::from_slice::<InspectionReceipt>(&raw) {
                    if saved.identity == identity {
                        return Ok(saved.report);
                    }
                }
            }
            let report = Analyzer::compatibility(&script, &index.variables, &cancel)?;
            write_json(
                &path,
                &InspectionReceipt {
                    identity,
                    report: report.clone(),
                },
            )?;
            Ok(report)
        })
        .await?
    }
}

fn read_text_cache(receipt: &Path, root: &Path, identity: &str) -> Result<Option<String>> {
    let Ok(raw) = fs::read(receipt) else {
        return Ok(None);
    };
    let Ok(record) = serde_json::from_slice::<TextReceipt>(&raw) else {
        return Ok(None);
    };
    if record.identity != identity
        || record.sha256.len() != 64
        || !record.sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Ok(None);
    }
    let path = safe_path(root, &record.sha256)?;
    let Ok(raw) = fs::read(path) else {
        return Ok(None);
    };
    if format!("{:x}", Sha256::digest(&raw)) != record.sha256 {
        return Ok(None);
    }
    Ok(Some(
        String::from_utf8(raw).context("Cached story script is not valid UTF-8")?,
    ))
}
