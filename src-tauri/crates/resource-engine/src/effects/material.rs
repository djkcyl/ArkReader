use super::{
    catalog::SHADER_FAMILIES,
    scene::{array, color, integer, number, truth, Scene},
};
use crate::{
    materials,
    media::{self, MediaStore},
    source::Source,
    unity::ObjectId,
};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub struct MaterialSet {
    pub materials: BTreeMap<String, Value>,
    pub textures: BTreeMap<String, Value>,
}

fn renderer_slots(
    scene: &Scene<'_>,
    id: ObjectId,
    row: &Value,
    particles: &BTreeMap<ObjectId, (ObjectId, &Value)>,
    fade_targets: &BTreeSet<ObjectId>,
) -> Result<Vec<Value>> {
    if !truth(&row["m_Enabled"]) {
        return Ok(Vec::new());
    }
    let slots = array(&row["m_Materials"])?;
    if row.get("m_RenderMode").is_none() {
        return Ok(slots.clone());
    }
    let go = scene.owner(id)?;
    let particle = particles.get(&go);
    if particle.is_some_and(|(_, p)| {
        !truth(&p["EmissionModule"]["enabled"]) && !fade_targets.contains(&go)
    }) {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    if row["m_RenderMode"] != 5 {
        result.extend(slots.iter().take(1).cloned());
    }
    if particle.is_some_and(|(_, p)| truth(&p["TrailModule"]["enabled"])) {
        result.extend(slots.iter().skip(1).take(1).cloned());
    }
    Ok(result)
}

pub fn collect(scene: &mut Scene<'_>, source: &Source, store: &MediaStore) -> Result<MaterialSet> {
    let particles = scene
        .by_kind(198)
        .map(|(id, row)| Ok((scene.owner(id)?, (id, row))))
        .collect::<Result<BTreeMap<_, _>>>()?;
    let mut fade_targets = BTreeSet::new();
    for (id, item) in scene
        .by_kind(114)
        .filter(|(_, row)| row.get("_effectDuration").is_some() && row["_fadeType"] == 3)
    {
        for pointer in array(&item["_particleSystemList"])? {
            let target = scene.require(id, pointer)?;
            fade_targets.insert(scene.owner(target)?);
        }
    }
    let mut used = BTreeSet::new();
    for (&id, row) in &scene.rows {
        if matches!(scene.kind(id)?, 23 | 96 | 199) {
            for pointer in renderer_slots(scene, id, row, &particles, &fade_targets)? {
                if let Some(material) = scene.resolve(id, &pointer)? {
                    used.insert(material);
                }
            }
        }
    }
    for (id, animator) in scene.by_kind(95) {
        let Some(controller) = scene.resolve(id, &animator["m_Controller"])? else {
            continue;
        };
        ensure!(
            animator["m_Controller"]["m_FileID"] == 0,
            "External animated material controller"
        );
        let controller_row = &scene.rows[&controller];
        for pointer in array(&controller_row["m_AnimationClips"])? {
            ensure!(pointer["m_FileID"] == 0, "External material animation clip");
            let clip = scene.require(controller, pointer)?;
            let row = &scene.rows[&clip];
            if !array(&row["m_ClipBindingConstant"]["genericBindings"])?
                .iter()
                .any(|b| b["customType"] == 21 && truth(&b["isPPtrCurve"]))
            {
                continue;
            }
            for pointer in array(&row["m_ClipBindingConstant"]["pptrCurveMapping"])? {
                ensure!(
                    pointer["m_FileID"] == 0,
                    "External animated material target"
                );
                if let Some(material) = scene.resolve(clip, pointer)? {
                    ensure!(
                        scene.kind(material)? == 21,
                        "Animation material target has another type"
                    );
                    used.insert(material);
                }
            }
        }
    }
    drop(particles);
    for &id in &used {
        scene.insert(id)?;
    }
    let mut result = MaterialSet {
        materials: BTreeMap::new(),
        textures: BTreeMap::new(),
    };
    for id in used {
        source.checkpoint()?;
        ensure!(
            scene.kind(id)? == 21,
            "Renderer material target has another type"
        );
        let row = scene.rows[&id].clone();
        let shader = scene.require(id, &row["m_Shader"])?;
        let parsed = scene.env.field(shader, "m_ParsedForm")?;
        let shader_name = parsed["m_Name"].as_str().context("Shader name missing")?;
        let family = SHADER_FAMILIES
            .iter()
            .find_map(|(name, family)| (*name == shader_name).then_some(*family))
            .context("Unsupported particle shader")?;
        let keywords = array(&row["m_ValidKeywords"])?;
        let allowed = match family {
            "directional-grab" => vec!["_CUSTOMDATA_ON"],
            "anchor" => vec!["_HGCUSTOMVERTEXSTREAM_ON", "_WEIGHT_ON"],
            _ => vec!["_HGCUSTOMVERTEXSTREAM_ON"],
        };
        ensure!(
            keywords
                .iter()
                .all(|k| k.as_str().is_some_and(|k| allowed.contains(&k))),
            "Unsupported particle shader keyword"
        );
        let props = &row["m_SavedProperties"];
        let floats = materials::map(&props["m_Floats"])?;
        let colors = materials::map(&props["m_Colors"])?
            .into_iter()
            .map(|(key, value)| Ok((key, color(&value)?)))
            .collect::<Result<BTreeMap<_, _>>>()?;
        let f = |key: &str, default: f64| -> f64 {
            floats.get(key).and_then(Value::as_f64).unwrap_or(default)
        };
        ensure!(
            shader_name != "Torappu/Particles/Ram/VertexDisturb(CustomData)"
                || f("_NormalDisturb", 0.0) <= 0.0
                || f("_NormalDisturbIntensity", 0.0) == 0.0,
            "Unsupported normal-directed vertex disturbance"
        );
        let passes = array(&parsed["m_SubShaders"][0]["m_Passes"])?;
        let state = &passes
            .iter()
            .find(|pass| pass["m_Type"] == 0)
            .context("Particle shader pass missing")?["m_State"];
        let mut blend = BTreeMap::new();
        for key in ["srcBlend", "destBlend", "srcBlendAlpha", "destBlendAlpha"] {
            let prop = &state["rtBlend0"][key];
            let name = prop["name"]
                .as_str()
                .context("Shader blend binding missing")?;
            let value = if name == "<noninit>" {
                number(&prop["val"])?
            } else {
                number(
                    floats
                        .get(name)
                        .context("Material blend property missing")?,
                )?
            };
            blend.insert(key, value);
        }
        let grab = matches!(family, "grab" | "directional-grab");
        ensure!(
            [1.0, 5.0].contains(&blend["srcBlend"])
                && [0.0, 1.0, 10.0].contains(&blend["destBlend"])
                && blend["srcBlendAlpha"]
                    == if family == "ui-ram" {
                        5.0
                    } else if grab {
                        1.0
                    } else {
                        0.0
                    }
                && if grab {
                    blend["destBlendAlpha"] == 0.0
                } else {
                    [1.0, 10.0].contains(&blend["destBlendAlpha"])
                }
                && !truth(&state["zWrite"]["val"]),
            "Unsupported particle blend or depth state"
        );
        if family == "ui-ram" {
            ensure!(
                keywords.is_empty()
                    && f("_StencilComp", 8.0) == 8.0
                    && f("_StencilOp", 0.0) == 0.0
                    && f("_ColorMask", 15.0) == 15.0,
                "Unsupported clipped UI particle material"
            );
        }
        if family == "directional-grab" {
            ensure!(
                (0..5).any(|v| f("_DirMode", 0.0) == v as f64),
                "Unsupported screen disturbance direction"
            );
        }
        for key in [
            "_MainTexChannel",
            "_RamTexChannel",
            "_DisturbTexChannel",
            "_DissolvTexChannel",
        ] {
            let maximum = if matches!(key, "_MainTexChannel" | "_RamTexChannel") {
                5
            } else {
                4
            };
            ensure!(
                if family == "ram" {
                    (0..maximum).any(|v| f(key, 0.0) == v as f64)
                } else {
                    f(key, 0.0) == 0.0
                },
                "Unsupported texture channel selector"
            );
        }
        ensure!(
            f("_HG_UV_ROTATION", 0.0) == 0.0,
            "Unsupported native UV rotation mode"
        );
        let mut slots = BTreeMap::new();
        for (name, value) in materials::map(&props["m_TexEnvs"])? {
            let texture = if let Some(texture) = scene.resolve(id, &value["m_Texture"])? {
                ensure!(
                    scene.kind(texture)? == 28,
                    "Particle sampler does not reference a texture"
                );
                let key = texture.path.to_string();
                if !result.textures.contains_key(&key) {
                    let sampler = scene.env.field(texture, "m_TextureSettings")?;
                    let filter = integer(&sampler["m_FilterMode"])?;
                    let u = integer(&sampler["m_WrapU"])?;
                    let v = integer(&sampler["m_WrapV"])?;
                    ensure!(
                        [0, 1].contains(&filter) && [0, 1].contains(&u) && [0, 1].contains(&v),
                        "Unsupported particle sampler"
                    );
                    let origin = scene.env.origin(texture)?;
                    let md5 = &source
                        .manifest
                        .entries
                        .get(origin)
                        .context("Texture source is not in manifest")?
                        .md5;
                    let file = store.image(&media::texture(scene.env, texture)?)?;
                    result.textures.insert(
                        key.clone(),
                        json!({
                            "url":file.url,
                            "width":file.width,
                            "height":file.height,
                            "filter":filter,
                            "wrapU":u,
                            "wrapV":v,
                            "bundle":origin,
                            "md5":md5
                        }),
                    );
                }
                Some(key)
            } else {
                None
            };
            slots.insert(name,json!({"key":texture,"st":[value["m_Scale"]["x"],value["m_Scale"]["y"],value["m_Offset"]["x"],value["m_Offset"]["y"]]}));
        }
        let origin = scene.env.origin(id)?;
        let shader_origin = scene.env.origin(shader)?;
        let mut material = json!({
            "name":row["m_Name"],
            "shader":family,
            "blend":blend,
            "floats":floats,
            "colors":colors,
            "textures":slots,
            "keywords":keywords,
            "shaderId":shader.path.to_string(),
            "bundle":origin,
            "bundleMd5":source.manifest.entries.get(origin).context("Material source missing")?.md5,
            "shaderName":shader_name,
            "shaderBundle":shader_origin,
            "vertexDisturb":shader_name=="Torappu/Particles/Ram/VertexDisturb(CustomData)",
            "disturbScaleEnabled":shader_name=="Torappu/Particles-L2D/Disturb/Disturb(CustomData)"
        });
        if grab {
            material["grabTexture"] = passes
                .iter()
                .find(|p| p["m_Type"] == 2)
                .map(|p| p["m_TextureName"].clone())
                .unwrap_or_else(|| json!(""));
        }
        result.materials.insert(id.path.to_string(), material);
    }
    Ok(result)
}
