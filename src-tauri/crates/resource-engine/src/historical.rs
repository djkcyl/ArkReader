use crate::source::{Entry, Manifest, Origin, Platform};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::LazyLock};

pub fn prune(data: &std::path::Path, cancel: &tokio_util::sync::CancellationToken) -> Result<()> {
    let cache = crate::cache::Cache::new(data.join("cache/historical-movies"))?;
    let allowed = MOVIES
        .values()
        .map(|record| record.entry.name.clone())
        .collect();
    cache.prune(crate::source::BUNDLE_CACHE, &allowed, cancel)?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    resource: String,
    platform: Platform,
    version: String,
    manifest_url: String,
    manifest_sha256: String,
    entry: Entry,
}
static MOVIES: LazyLock<BTreeMap<String, Record>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../assets/historical_movies.json"))
        .expect("Valid historical movie sources")
});
#[derive(Clone, Debug, Serialize)]
pub struct Movie {
    pub key: String,
    pub manifest: Manifest,
    pub bundle: String,
    pub provenance: Value,
}

pub fn movie(
    story: &str,
    raw: &str,
    key: &str,
    network: bool,
    origin: Origin,
) -> Result<Option<Movie>> {
    let Some(row) = MOVIES
        .get(story)
        .filter(|row| row.resource == raw.to_lowercase())
    else {
        return Ok(None);
    };
    let base = row
        .manifest_url
        .strip_suffix("hot_update_list.json")
        .context("Invalid historical manifest URL")?;
    crate::source::https(base)?;
    let provenance = json!({
        "kind":"official-historical-movie",
        "resource":row.resource,
        "platform":row.platform,
        "version":row.version,
        "manifestUrl":row.manifest_url,
        "manifestSha256":row.manifest_sha256,
        "bundle":row.entry.name,
        "md5":row.entry.md5,
        "size":row.entry.ab_size
    });
    Ok(Some(Movie {
        key: key.into(),
        bundle: row.entry.name.clone(),
        manifest: Manifest {
            platform: row.platform,
            origin,
            version: row.version.clone(),
            client_version: String::new(),
            base_url: if network { base.into() } else { String::new() },
            entries: BTreeMap::from([(row.entry.name.clone(), row.entry.clone())]),
            downloads: BTreeMap::new(),
        },
        provenance,
    }))
}
