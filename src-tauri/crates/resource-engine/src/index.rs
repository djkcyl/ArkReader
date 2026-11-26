use crate::{
    cache::{safe_path, write_atomic},
    model::{Binding, Index, Route, RoutingManifest},
    resource_manifest,
    source::Source,
    tables,
    unity::Unity,
};
use anyhow::{ensure, Context, Result};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path};

pub fn table_name(name: &str, expected: &str) -> bool {
    name.strip_prefix(expected).is_some_and(|suffix| {
        suffix
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    })
}

pub fn cache_table(data: &Path, raw: &[u8]) -> Result<String> {
    let digest = format!("{:x}", Sha256::digest(raw));
    let path = data.join("table-cache").join(&digest);
    if fs::read(&path).ok().as_deref() != Some(raw) {
        write_atomic(&path, raw)?;
    }
    Ok(digest)
}

fn relevant(key: &str) -> bool {
    [
        "gamedata/story/",
        "avg/",
        "audio/",
        "cutin/characters/",
        "arts/charportraits/",
        "arts/ui/mainmission/",
        "arts/ui/storyreview/",
        "arts/ui/stage/hometheme/",
        "arts/loadingillusts/loading_interlock",
        "mouse/pc_mouse_mgr",
        "ui/activity/actfun/",
    ]
    .iter()
    .any(|p| key.starts_with(p))
        || key.starts_with("gamedata/excel/")
}

pub async fn build(data: &Path, source: &Source, progress: impl Fn(&str)) -> Result<Index> {
    let names: Vec<_> = source
        .manifest
        .entries
        .keys()
        .filter(|name| name.ends_with(".idx"))
        .collect();
    ensure!(names.len() == 1, "Expected one official routing manifest");
    let name = names[0];
    progress(name);
    let path = source.bundle(name).await?;
    let target = data.to_owned();
    let (routing, digest) = crate::runtime::blocking(move || {
        let raw = fs::read(path)?;
        Ok::<_, anyhow::Error>((resource_manifest::parse(&raw)?, cache_table(&target, &raw)?))
    })
    .await??;
    let mut dependencies = BTreeMap::new();
    for bundle in &routing.bundles {
        safe_path(&data.join("cache"), &bundle.name)?;
        ensure!(
            source.manifest.entries.contains_key(&bundle.name),
            "Routing bundle absent from update list: {}",
            bundle.name
        );
        dependencies.insert(
            bundle.name.clone(),
            bundle
                .all_dependencies
                .iter()
                .map(|&i| routing.bundles[i].name.clone())
                .collect(),
        );
    }
    let mut routes = BTreeMap::new();
    let mut stories = BTreeMap::new();
    let mut summaries = BTreeMap::new();
    let mut aliases: BTreeMap<String, Vec<Route>> = BTreeMap::new();
    let mut metadata = BTreeMap::new();
    for asset in &routing.assets {
        source.checkpoint()?;
        let key = asset.asset_name.to_lowercase();
        let container = asset.path.as_deref().unwrap_or_default();
        let route = Route {
            bundle: routing.bundles[asset.bundle_index].name.clone(),
            container: asset.path.clone(),
        };
        if relevant(&key) {
            routes.insert(key.clone(), route.clone());
        }
        if let Some(relative) = key
            .strip_prefix("gamedata/story/")
            .filter(|_| container.to_lowercase().ends_with(".txt"))
        {
            let (summary, id) = relative
                .strip_prefix("[uc]info/")
                .map_or((false, relative), |id| (true, id));
            safe_path(
                &data.join(if summary { "summaries" } else { "scripts" }),
                &format!("{id}.txt"),
            )?;
            if summary {
                summaries.insert(id.to_owned(), route.clone());
            } else {
                stories.insert(id.to_owned(), route.clone());
            }
        }
        let basename = container
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .strip_suffix(".bytes")
            .unwrap_or_default();
        let kind = if key == "gamedata/story/story_variables" {
            Some("variables")
        } else if key.starts_with("gamedata/excel/") && table_name(basename, "story_review_table") {
            Some("review")
        } else if key.starts_with("gamedata/excel/") && table_name(basename, "story_table") {
            Some("entries")
        } else {
            None
        };
        if let Some(kind) = kind {
            ensure!(
                metadata.insert(kind, route.clone()).is_none(),
                "Duplicate story metadata route"
            );
        }
        if [
            "avg/backgrounds/",
            "avg/images/",
            "avg/items/",
            "cutin/characters/",
            "audio/",
        ]
        .iter()
        .any(|p| key.starts_with(p))
        {
            aliases
                .entry(key.rsplit('/').next().unwrap_or_default().to_owned())
                .or_default()
                .push(route);
        }
    }
    let media = aliases
        .into_iter()
        .filter_map(|(key, mut rows)| {
            if rows.len() == 1 {
                Some((key, rows.remove(0)))
            } else {
                None
            }
        })
        .collect();
    ensure!(metadata.len() == 3, "Missing story bootstrap metadata");
    let mut names: Vec<_> = metadata.values().map(|r| r.bundle.clone()).collect();
    names.sort();
    names.dedup();
    source.prefetch(&names, 4).await?;
    let mut variables = None;
    let mut review = None;
    let mut entries = None;
    for (kind, route) in metadata {
        progress(kind);
        let raw = read_route(source, &route).await?;
        let target = data.to_owned();
        let (raw, sha256) = crate::runtime::blocking(move || {
            let hash = cache_table(&target, &raw)?;
            Ok::<_, anyhow::Error>((raw, hash))
        })
        .await??;
        match kind {
            "variables" => variables = Some(serde_json::from_slice(&raw)?),
            "review" => {
                tables::review(&raw)?;
                review = Some(Binding { route, sha256 });
            }
            "entries" => {
                tables::story_entries(&raw)?;
                entries = Some(Binding { route, sha256 });
            }
            _ => unreachable!(),
        }
    }
    Ok(Index {
        format: 1,
        generator: crate::DECODER_REVISION.into(),
        source: source.manifest.as_ref().clone(),
        routing: RoutingManifest {
            bundle: name.clone(),
            sha256: digest,
            bundle_count: routing.bundles.len(),
            asset_count: routing.assets.len(),
        },
        routes,
        dependencies,
        stories,
        summaries,
        media,
        variables: variables.context("Missing story variables")?,
        review: review.context("Missing review table")?,
        entries: entries.context("Missing StoryDB table")?,
    })
}

pub async fn read_route(source: &Source, route: &Route) -> Result<Vec<u8>> {
    let path = source.bundle(&route.bundle).await?;
    let cancel = source.cancellation();
    let container = route.container.clone().context("Missing table container")?;
    crate::runtime::blocking(move || Unity::open(&[path], cancel)?.text(&container)).await?
}

pub async fn read_table(data: &Path, binding: &Binding, source: &Source) -> Result<Vec<u8>> {
    let digest = &binding.sha256;
    ensure!(
        digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit()),
        "Invalid table identity"
    );
    let path = data.join("table-cache").join(digest);
    let check = path.clone();
    let hash = digest.clone();
    let cached = crate::runtime::blocking(move || {
        fs::read(check)
            .ok()
            .filter(|raw| format!("{:x}", Sha256::digest(raw)) == hash)
    })
    .await?;
    if let Some(raw) = cached {
        return Ok(raw);
    }
    let raw = read_route(source, &binding.route).await?;
    let hash = digest.clone();
    crate::runtime::blocking(move || {
        ensure!(
            format!("{:x}", Sha256::digest(&raw)) == hash,
            "Table differs from pinned source"
        );
        write_atomic(&path, &raw)?;
        Ok(raw)
    })
    .await?
}
