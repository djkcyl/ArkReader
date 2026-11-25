pub mod animation;
pub mod blur;
pub mod catalog;
pub mod legacy;
pub mod material;
pub mod mesh;
pub mod native;

use crate::{
    media::{Asset, EffectAsset, EffectContent, MediaStore},
    source::Source,
    unity::Unity,
};
use anyhow::{ensure, Result};

pub fn export(
    env: &Unity,
    source: &Source,
    bundle: &str,
    key: &str,
    store: &MediaStore,
) -> Result<Asset> {
    let foreground = bundle == "avg/fx/battle.ab";
    let image = bundle.starts_with("avg/effects/image/");
    let is_blur = [
        "avg_mohu_zhengyan_01",
        "avg_mohu_biyan_01",
        "avg_mohu_zhuanchang_01",
    ]
    .contains(&key);
    ensure!(
        if foreground {
            catalog::FOREGROUND_PARTICLE_EFFECTS.contains(&key)
        } else if image {
            ["avg_066_screen_distortion", "avg_doctor_wakeup"].contains(&key)
        } else {
            catalog::NATIVE_PARTICLE_EFFECTS.contains(&key)
                || catalog::SIGNAL_EFFECTS.contains(&key)
                || is_blur
        },
        "Unsupported native effect: {key}"
    );
    let prefab = if foreground {
        format!("dyn/avg/effects/battle/{key}.prefab")
    } else {
        format!("dyn/{}.prefab", bundle.trim_end_matches(".ab"))
    };
    let mut scene = scene::Scene::load(env, &prefab)?;
    let components = scene
        .rows
        .keys()
        .copied()
        .filter(|&id| scene.kind(id).ok() == Some(1))
        .map(|id| scene.components(id))
        .collect::<Result<Vec<_>>>()?;
    for component in components.into_iter().flatten() {
        let kind = scene.kind(component)?;
        ensure!(
            !matches!(kind, 111 | 137),
            "Unsupported legacy or skinned effect component"
        );
    }
    let mut profile = if is_blur {
        blur::build(&scene, source, bundle)?
    } else {
        let material = material::collect(&mut scene, source, store)?;
        if catalog::SIGNAL_EFFECTS.contains(&key) {
            legacy::build(
                &scene,
                source,
                bundle,
                material.materials,
                material.textures,
            )?
        } else {
            native::build(
                &scene,
                source,
                bundle,
                material.materials,
                material.textures,
                false,
            )?
        }
    };
    if profile["kind"] == "native-particles-v2" {
        profile["evidence"]["prefab"] = prefab.into();
    }
    if image {
        let items = scene
            .by_kind(114)
            .filter(|(_, row)| {
                row.get("_meshRenderers").is_some() && row.get("_effectDuration").is_some()
            })
            .collect::<Vec<_>>();
        ensure!(items.len() == 1, "Ambiguous image effect item");
        let (owner, item) = items[0];
        let mut bindings = Vec::new();
        for pointer in scene::array(&item["_meshRenderers"])? {
            ensure!(pointer["m_FileID"] == 0, "External image effect renderer");
            let renderer = scene.require(owner, pointer)?;
            let go = scene.owner(renderer)?.path.to_string();
            ensure!(
                scene::array(&profile["meshes"])?
                    .iter()
                    .any(|mesh| mesh["rendererKey"].as_str() == Some(&go)
                        && mesh["materialSlot"] == 0),
                "Image effect renderer has no first material"
            );
            bindings.push(go);
        }
        profile["imageBindings"] = serde_json::json!(bindings);
        profile["sortingMode"] = "additive".into();
        for field in ["nodes", "meshes"] {
            for node in profile[field].as_array_mut().unwrap() {
                node["transforms"][0]["m_LocalScale"] = serde_json::json!({"x":1,"y":1,"z":1});
            }
        }
    }
    let url = store.bytes(&serde_json::to_vec(&profile)?, "json")?;
    Ok(Asset::Effect(EffectAsset {
        url,
        content: EffectContent::Particle { profile },
    }))
}
pub mod scene;
