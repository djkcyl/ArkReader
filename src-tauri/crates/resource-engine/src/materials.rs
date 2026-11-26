use crate::{
    media::{self, ImageFile, MediaStore},
    source::Source,
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

pub fn map(value: &Value) -> Result<BTreeMap<String, Value>> {
    value
        .as_array()
        .context("Unity property map is not a list")?
        .iter()
        .map(|pair| {
            let (key, value) = if let Some(values) = pair.as_array() {
                ensure!(values.len() == 2, "Invalid Unity property pair");
                (&values[0], &values[1])
            } else {
                (&pair["key"], &pair["value"])
            };
            Ok((
                key.as_str()
                    .context("Unity property key is not a string")?
                    .into(),
                value.clone(),
            ))
        })
        .collect()
}

pub fn pairs(value: &Value) -> Result<Vec<(Value, Value)>> {
    value
        .as_array()
        .context("Unity property map is not a list")?
        .iter()
        .map(|pair| {
            if let Some(values) = pair.as_array() {
                ensure!(values.len() == 2, "Invalid Unity property pair");
                Ok((values[0].clone(), values[1].clone()))
            } else {
                ensure!(
                    pair.get("key").is_some() && pair.get("value").is_some(),
                    "Invalid Unity property pair"
                );
                Ok((pair["key"].clone(), pair["value"].clone()))
            }
        })
        .collect()
}

#[derive(Serialize)]
pub struct MaterialValues {
    pub floats: BTreeMap<String, Value>,
    pub vectors: BTreeMap<String, Value>,
}
#[derive(Serialize)]
pub struct FilterProfile {
    pub schema: u32,
    pub version: String,
    pub materials: BTreeMap<String, MaterialValues>,
    pub presets: BTreeMap<String, Value>,
    pub glitch: BTreeMap<String, Value>,
}
#[derive(Serialize)]
pub struct BlockerProfile {
    pub schema: u32,
    pub version: String,
    pub floats: BTreeMap<String, Value>,
    pub mask: ImageFile,
}

pub async fn filters(
    source: &Source,
    common: Arc<Unity>,
    store: Arc<MediaStore>,
) -> Result<FilterProfile> {
    let path = source.bundle("arts/avg_shader_profile.ab").await?;
    let cancel = source.cancellation();
    let version = source.manifest.version.clone();
    crate::runtime::blocking(move || {
        let shaders = Unity::open(&[path], cancel)?;
        let names = BTreeSet::from([
            "mat_grayscale",
            "mat_chaos",
            "mat_chaos_blur",
            "mat_blit_ghost",
            "mat_ghost_front",
            "mat_ghost_back",
        ]);
        let mut materials = BTreeMap::new();
        let mut presets = BTreeMap::new();
        let mut glitch = BTreeMap::new();
        for env in [common.as_ref(), &shaders] {
            for object in env
                .studio
                .objects()
                .filter(|o| matches!(o.class_id(), 21 | 114))
            {
                let id = ObjectId {
                    file: object.file_index(),
                    path: object.path_id(),
                };
                let row = env.tree(id)?;
                let key = row["m_Name"].as_str().unwrap_or_default();
                if object.class_id() == 21 && names.contains(key) {
                    materials.insert(
                        key.into(),
                        MaterialValues {
                            floats: map(&row["m_SavedProperties"]["m_Floats"])?,
                            vectors: map(&row["m_SavedProperties"]["m_Colors"])?,
                        },
                    );
                }
                if object.class_id() == 114
                    && ((key.starts_with("chaos_") && row.get("weight").is_some())
                        || row.get("glichSpeed").is_some())
                {
                    let value = Value::Object(
                        row.as_object()
                            .context("Invalid native filter")?
                            .iter()
                            .filter(|(k, _)| !k.starts_with("m_"))
                            .map(|(k, v)| (k.clone(), v.clone()))
                            .collect(),
                    );
                    if key.starts_with("chaos_") && row.get("weight").is_some() {
                        presets.insert(key.into(), value.clone());
                    }
                    if row.get("glichSpeed").is_some() {
                        glitch.insert(key.into(), value);
                    }
                }
            }
        }
        ensure!(
            materials
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
                == names
                && ["chaos_none", "chaos_normal", "chaos_hard"]
                    .iter()
                    .all(|k| presets.contains_key(*k)),
            "Official filter profile changed"
        );
        ensure!(
            glitch.len() == 10 && glitch.contains_key("glitch_none"),
            "Official character glitch profile changed"
        );
        let profile = FilterProfile {
            schema: 3,
            version,
            materials,
            presets,
            glitch,
        };
        store.named("native-filter-profile.json", &serde_json::to_vec(&profile)?)?;
        Ok(profile)
    })
    .await?
}

pub fn blocker(env: &Unity, store: &MediaStore, version: &str) -> Result<BlockerProfile> {
    let materials: Vec<_> = env
        .studio
        .objects()
        .filter(|o| o.class_id() == 21 && o.name() == Some("slide_mask"))
        .collect();
    ensure!(
        materials.len() == 1,
        "Original slide-mask material is not unique"
    );
    let object = materials[0];
    let id = ObjectId {
        file: object.file_index(),
        path: object.path_id(),
    };
    let material = env.tree(id)?;
    let properties = &material["m_SavedProperties"];
    let textures = map(&properties["m_TexEnvs"])?;
    let mask = textures
        .get("_MaskTex")
        .context("Slide mask texture missing")?;
    let texture = env
        .resolve(id, &mask["m_Texture"])?
        .context("Slide mask texture reference missing")?;
    let settings = env.field(texture, "m_TextureSettings")?;
    ensure!(
        settings["m_FilterMode"] == 1
            && settings["m_WrapU"] == 1
            && settings["m_WrapV"] == 1
            && env.field(texture, "m_MipCount")? == 1,
        "Unsupported slide-mask sampling"
    );
    let profile = BlockerProfile {
        schema: 1,
        version: version.into(),
        floats: map(&properties["m_Floats"])?,
        mask: store.image(&media::texture(env, texture)?)?,
    };
    store.named(
        "native-blocker-profile.json",
        &serde_json::to_vec(&profile)?,
    )?;
    Ok(profile)
}
