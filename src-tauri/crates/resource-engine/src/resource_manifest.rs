use crate::flat::Flat;
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub name: String,
    pub props: i32,
    pub scc_index: i32,
    pub all_dependencies: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub asset_name: String,
    pub bundle_index: usize,
    pub name: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub raw_count: i32,
    pub bundles: Vec<Bundle>,
    pub assets: Vec<Asset>,
}

pub fn parse(bytes: &[u8]) -> Result<Manifest> {
    let flat = Flat::new(bytes)?;
    let root = flat.root()?;
    let mut names = BTreeSet::new();
    let mut bundles = Vec::new();
    for row in flat.vector(root, 6)? {
        let name = flat.string(row, 4)?;
        ensure!(
            !name.is_empty() && names.insert(name.clone()),
            "Missing or duplicate bundle name"
        );
        let mut dependencies = Vec::new();
        for value in flat.integers(row, 10)? {
            ensure!(value >= 0, "Negative bundle dependency index");
            dependencies.push(value as usize);
        }
        bundles.push(Bundle {
            name,
            props: flat.scalar(row, 6)?,
            scc_index: flat.scalar(row, 8)?,
            all_dependencies: dependencies,
        });
    }
    for bundle in &bundles {
        ensure!(
            bundle.all_dependencies.iter().all(|&i| i < bundles.len()),
            "Bundle dependency outside manifest"
        );
    }
    names.clear();
    let mut assets = Vec::new();
    for row in flat.vector(root, 8)? {
        let name = flat.string(row, 4)?;
        let index = flat.scalar(row, 6)?;
        ensure!(
            !name.is_empty() && names.insert(name.to_lowercase()),
            "Missing or duplicate asset route"
        );
        ensure!(
            index >= 0 && (index as usize) < bundles.len(),
            "Asset refers outside bundle list"
        );
        let asset = Asset {
            asset_name: name,
            bundle_index: index as usize,
            name: flat.optional_string(row, 8)?,
            path: flat.optional_string(row, 10)?,
        };
        ensure!(
            bundles[asset.bundle_index].name.starts_with("raw/")
                || (asset.path.as_ref().is_some_and(|s| !s.is_empty())
                    && asset.name.as_ref().is_some_and(|s| !s.is_empty())),
            "Unity asset has no container binding"
        );
        assets.push(asset);
    }
    ensure!(
        !bundles.is_empty() && !assets.is_empty(),
        "Empty official resource manifest"
    );
    Ok(Manifest {
        raw_count: flat.scalar(root, 4)?,
        bundles,
        assets,
    })
}

impl Manifest {
    pub fn routes(&self) -> BTreeMap<String, (&str, &str)> {
        self.assets
            .iter()
            .map(|asset| {
                (
                    asset.asset_name.to_lowercase(),
                    (
                        self.bundles[asset.bundle_index].name.as_str(),
                        asset.path.as_deref().unwrap_or_default(),
                    ),
                )
            })
            .collect()
    }
}
