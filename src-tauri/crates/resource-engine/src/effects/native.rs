use super::{
    animation, mesh,
    scene::{array, held_tangents, integer, number, select, truth, vec3, Scene},
};
use crate::{source::Source, unity::ObjectId};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const MODULES: [&str; 14] = [
    "InitialModule",
    "EmissionModule",
    "ShapeModule",
    "SizeModule",
    "RotationModule",
    "ColorModule",
    "UVModule",
    "VelocityModule",
    "ForceModule",
    "NoiseModule",
    "CustomDataModule",
    "ClampVelocityModule",
    "TrailModule",
    "InheritVelocityModule",
];

fn active(
    scene: &Scene<'_>,
    go: ObjectId,
    animated: &Value,
    item_roots: &BTreeSet<ObjectId>,
) -> Result<bool> {
    let chain = scene.chain(go)?;
    for (i, t) in chain.iter().enumerate() {
        let key = t["key"].as_str().context("Transform key missing")?;
        let activated = i == 0 && item_roots.iter().any(|root| root.path.to_string() == key);
        if !truth(&t["activeSelf"]) && animated.get(key).is_none() && !activated {
            return Ok(false);
        }
    }
    Ok(true)
}
fn pointer_id(value: &Value) -> Result<String> {
    Ok(integer(&value["m_PathID"])?.to_string())
}

pub fn build(
    scene: &Scene<'_>,
    source: &Source,
    bundle: &str,
    mut materials: BTreeMap<String, Value>,
    textures: BTreeMap<String, Value>,
    ui_geometry: bool,
) -> Result<Value> {
    let mut items = scene
        .by_kind(114)
        .filter(|(_, d)| d.get("_effectDuration").is_some())
        .collect::<Vec<_>>();
    if items.len() > 1 {
        let root = scene.owner(items[0].0)?;
        ensure!(
            items
                .iter()
                .all(|(id, _)| scene.owner(*id).ok() == Some(root)),
            "Nested effect lifecycles are unsupported"
        );
        let ids = scene.components(root)?;
        items.sort_by_key(|(id, _)| ids.iter().position(|candidate| candidate == id));
        for (_, d) in items.iter().skip(1) {
            ensure!(
                array(&d["_particleSystemList"])?.is_empty()
                    && d["_effectAnimator"]["m_PathID"] == 0
                    && d["_fadeAnimation"]["m_PathID"] == 0,
                "Additional active effect lifecycle"
            );
        }
        items.truncate(1);
    }
    let item_roots = items
        .iter()
        .map(|(id, _)| scene.owner(*id))
        .collect::<Result<BTreeSet<_>>>()?;
    let mut emission_targets = BTreeSet::new();
    if let Some((id, item)) = items.first().filter(|(_, item)| item["_fadeType"] == 3) {
        for pointer in array(&item["_particleSystemList"])? {
            ensure!(pointer["m_FileID"] == 0, "External emission fade target");
            let target = scene.require(*id, pointer)?;
            ensure!(
                scene.kind(target)? == 198,
                "Emission fade target is not a particle system"
            );
            emission_targets.insert(target);
        }
    }
    let animation = animation::extract(scene, &mut materials)?;
    let animated = animation
        .as_ref()
        .map(|a| a["activeDefaults"].clone())
        .unwrap_or_else(|| json!({}));
    for (id, d) in scene.by_kind(224) {
        ensure!(
            d["m_AnchorMin"]["x"] == 0.5
                && d["m_AnchorMin"]["y"] == 0.5
                && d["m_AnchorMax"]["x"] == 0.5
                && d["m_AnchorMax"]["y"] == 0.5,
            "Unsupported driven particle rectangle"
        );
        if let Some(parent) = scene.resolve(id, &d["m_Father"])? {
            if let Some(parent) = scene
                .rows
                .get(&parent)
                .filter(|p| p.get("m_Pivot").is_some())
            {
                ensure!(
                    parent["m_Pivot"]["x"] == 0.5
                        && parent["m_Pivot"]["y"] == 0.5
                        && ["x", "y"]
                            .iter()
                            .all(|a| number(&d["m_AnchoredPosition"][*a]).ok()
                                == number(&d["m_LocalPosition"][*a]).ok()),
                    "Unresolved particle rectangle anchor"
                );
            }
        }
    }
    let renderers = scene
        .by_kind(199)
        .map(|(id, row)| Ok((scene.owner(id)?, (id, row))))
        .collect::<Result<BTreeMap<_, _>>>()?;
    let mut nodes = Vec::new();
    let mut meshes = Vec::new();
    let mut trails = Vec::new();
    let mut uv_tweens = Vec::new();
    let mut uv_rotations = Vec::new();
    let mut delayed = Vec::new();
    let mut root_delay = 0.0;
    let mut markers = Vec::new();
    for (&id, d) in &scene.rows {
        source.checkpoint()?;
        let kind = scene.kind(id)?;
        if kind == 114 {
            let go = scene.owner(id)?;
            let chain = scene.chain(go)?;
            if d.get("_delayTime")
                .and_then(Value::as_f64)
                .is_some_and(|v| v != 0.0)
                && truth(&d["m_Enabled"])
            {
                let is_animated = animated.get(go.path.to_string()).is_some();
                ensure!(
                    chain.iter().rev().skip(1).all(|t| animated
                        .get(t["key"].as_str().unwrap_or_default())
                        .is_none()),
                    "Animated delay ancestor is unsupported"
                );
                let transform = &scene.rows[&scene.transforms[&go]];
                if transform["m_Father"]["m_PathID"] == 0 {
                    let other = scene.rows.iter().any(|(other, row)| {
                        row.get("xspeed").is_some()
                            || row.get("_rotateTex1").is_some()
                            || (*other != id
                                && row
                                    .get("_delayTime")
                                    .and_then(Value::as_f64)
                                    .is_some_and(|v| v != 0.0))
                    });
                    ensure!(
                        truth(&scene.rows[&go]["m_IsActive"])
                            && !other
                            && items.iter().all(|(_, item)| item["_fadeType"] == 0),
                        "Unsupported delayed root activation clocks"
                    );
                    root_delay = number(&d["_delayTime"])?;
                }
                if active(scene, go, &animated, &item_roots)? {
                    let mut value = json!({"target":go.path.to_string(),"delay":d["_delayTime"]});
                    if is_animated {
                        value["animated"] = true.into();
                        value["initialActive"] = json!(truth(&scene.rows[&go]["m_IsActive"]));
                    }
                    delayed.push(value);
                }
            }
            if d.get("_rotateTex1").is_some()
                && d["_propertyName"].as_str().is_some_and(|s| !s.is_empty())
                && active(scene, go, &animated, &item_roots)?
            {
                let angles = (1..=4)
                    .map(|i| {
                        if truth(&d[format!("_rotateTex{i}")]) {
                            d[if i == 1 {
                                "angle1".into()
                            } else {
                                format!("_angle{i}")
                            }]
                            .clone()
                        } else {
                            Value::Null
                        }
                    })
                    .collect::<Vec<_>>();
                uv_rotations.push(json!({"renderer":go.path.to_string(),"property":d["_propertyName"],"angles":angles}));
            }
            if d.get("xspeed").is_some() {
                ensure!(
                    chain.iter().all(|t| animated
                        .get(t["key"].as_str().unwrap_or_default())
                        .is_none()),
                    "Animated UV component activation is unsupported"
                );
                if active(scene, go, &animated, &item_roots)? {
                    let repeat = d.get("tweenRepeat");
                    let mut maps = vec![
                        json!({"name":"_MainTex","speed":[d["xspeed"],d["yspeed"]],"wrap":truth(repeat.unwrap_or(&d["protectMainUV"]))}),
                    ];
                    if truth(&d["useSecondMap"]) {
                        maps.push(json!({"name":d["secondMapName"],"speed":[d["secondXSpeed"],d["secondYSpeed"]],"wrap":truth(repeat.unwrap_or(&d["protectSecondUV"]))}));
                    }
                    if let Some(extra) = d["extraMapSettings"].as_array() {
                        for m in extra.iter().filter(|m| truth(&m["enabled"])) {
                            maps.push(json!({"name":m["mapName"],"speed":[m["XSpeed"],m["YSpeed"]],"wrap":repeat.is_some_and(truth)}));
                        }
                    }
                    uv_tweens.push(json!({
                        "renderer":go.path.to_string(),
                        "advance":repeat.is_some(),
                        "repeat":repeat.is_some_and(truth),
                        "duration":d.get("tweenAnmTime").cloned().unwrap_or(json!(0)),
                        "keepInitOffset":truth(&d["keepInitOffset"]),
                        "shared":truth(&d["useSharedMaterial"]),
                        "enabled":truth(&d["m_Enabled"]),
                        "maps":maps
                    }));
                }
            }
            if [
                "_delayTime",
                "_effectDuration",
                "_bodyTransofrm",
                "xspeed",
                "_rotateTex1",
            ]
            .iter()
            .all(|k| d.get(*k).is_none())
            {
                ensure!(
                    d.as_object().is_some_and(|d| d.len() == 4
                        && ["m_GameObject", "m_Enabled", "m_Script", "m_Name"]
                            .iter()
                            .all(|key| d.contains_key(*key))),
                    "Unknown native effect component"
                );
                let script = scene.require(id, &d["m_Script"])?;
                let definition = scene
                    .env
                    .object(script)?
                    .read_mono_script(Default::default())?;
                ensure!(
                    definition.class_name == "AVGEffect" && definition.namespace == "Torappu.AVG",
                    "Unknown effect marker type"
                );
                let origin = scene.env.origin(script)?;
                markers.push(json!({"bundle":origin,"md5":source.manifest.entries.get(origin).context("Marker source missing")?.md5,"type":"Torappu.AVG.AVGEffect"}));
            }
        }
        if kind == 198 {
            let go = scene.owner(id)?;
            if !active(scene, go, &animated, &item_roots)? {
                continue;
            }
            let enabled = d
                .as_object()
                .context("Invalid particle system")?
                .iter()
                .filter(|(_, v)| v.is_object() && truth(&v["enabled"]))
                .map(|(key, _)| key.as_str())
                .collect::<BTreeSet<_>>();
            ensure!(
                enabled
                    .iter()
                    .all(|k| MODULES.contains(k) || *k == "SubModule"),
                "Unsupported native particle module"
            );
            let mut births = Vec::new();
            let mut probabilities = Vec::new();
            let mut moving_birth = false;
            if truth(&d["SubModule"]["enabled"]) {
                for link in array(&d["SubModule"]["subEmitters"])? {
                    if link["emitter"]["m_PathID"] == 0 && link["emitter"]["m_FileID"] == 0 {
                        continue;
                    }
                    ensure!(
                        link["emitter"]["m_FileID"] == 0
                            && link["type"] == 0
                            && link["properties"] == 0
                            && (0.0..=1.0).contains(&number(&link["emitProbability"])?),
                        "Unsupported sub-emitter event or inheritance"
                    );
                    let target = scene.require(id, &link["emitter"])?;
                    ensure!(
                        scene.kind(target)? == 198,
                        "Sub-emitter target has another type"
                    );
                    let child = &scene.rows[&target];
                    ensure!(
                        truth(&child["EmissionModule"]["enabled"]) && !truth(&child["prewarm"]),
                        "Unsupported child emission lifecycle"
                    );
                    births.push(target.path.to_string());
                    probabilities.push(link["emitProbability"].clone());
                    let initial = &d["InitialModule"];
                    ensure!(
                        matches!(integer(&initial["startSpeed"]["minMaxState"])?, 0 | 3),
                        "Unsupported birth speed curve"
                    );
                    moving_birth |= number(&initial["startSpeed"]["scalar"])? != 0.0
                        || (initial["startSpeed"]["minMaxState"] == 3
                            && number(&initial["startSpeed"]["minScalar"])? != 0.0)
                        || number(&initial["gravityModifier"]["scalar"])? != 0.0
                        || [
                            "VelocityModule",
                            "ForceModule",
                            "NoiseModule",
                            "InheritVelocityModule",
                        ]
                        .iter()
                        .any(|k| enabled.contains(k));
                }
            }
            if !truth(&d["EmissionModule"]["enabled"]) && !emission_targets.contains(&id) {
                continue;
            }
            let (renderer_id, r) = renderers.get(&go).context("Particle renderer missing")?;
            let render_enabled = truth(&r["m_Enabled"]);
            if !render_enabled && births.is_empty() {
                continue;
            }
            ensure!(
                render_enabled || d["cullingMode"] == 3,
                "Unsupported invisible culled particle driver"
            );
            ensure!(
                matches!(integer(&d["scalingMode"])?, 0 | 1)
                    && matches!(integer(&d["moveWithTransform"])?, 0 | 1)
                    && truth(&d["playOnAwake"]),
                "Unsupported particle transform mode"
            );
            let mode = integer(&r["m_RenderMode"])?;
            let alignment = integer(&r["m_RenderAlignment"])?;
            let pivot = vec3(&r["m_Pivot"])?;
            let velocity_mesh = mode == 4 && alignment == 4 && pivot == [0.0; 3];
            let velocity_quad = mode == 0
                && alignment == 4
                && pivot[2] == 0.0
                && !truth(&d["RotationModule"]["enabled"]);
            let legacy_stretch = !ui_geometry && mode == 1 && (0..=4).contains(&alignment);
            ensure!(
                [0, 1, 4, 5].contains(&mode)
                    && ([0, 1, 2].contains(&alignment)
                        || velocity_mesh
                        || velocity_quad
                        || legacy_stretch),
                "Unsupported particle renderer alignment"
            );
            let flip = vec3(&r["m_Flip"])?;
            ensure!(
                flip == [0.0; 3]
                    || ((mode == 0 || legacy_stretch)
                        && flip[2] == 0.0
                        && flip.iter().all(|v| (0.0..=1.0).contains(v))),
                "Unsupported particle flip layout"
            );
            ensure!(
                mode != 1
                    || ((!truth(&r["m_FreeformStretching"]) || ui_geometry)
                        && number(&r["m_CameraVelocityScale"])? == 0.0),
                "Unsupported particle stretch geometry"
            );
            let slots = array(&r["m_Materials"])?;
            let trail = &d["TrailModule"];
            let mut trail_material = None;
            if truth(&trail["enabled"]) {
                ensure!(
                    [0, 1].contains(&integer(&trail["mode"])?)
                        && [0, 1, 2].contains(&integer(&trail["textureMode"])?)
                        && (truth(&trail["dieWithParticles"]) || trail["mode"] == 0)
                        && !truth(&trail["generateLightingData"])
                        && !truth(&trail["splitSubEmitterRibbons"])
                        && !truth(&trail["attachRibbonsToTransform"])
                        && (0.0..=1.0).contains(&number(&trail["ratio"])?),
                    "Unsupported particle trail variation"
                );
                if trail["mode"] == 1 {
                    ensure!(
                        trail["ribbonCount"] == 1
                            && !truth(&d["InitialModule"]["size3D"])
                            && matches!(
                                integer(&d["InitialModule"]["startSize"]["minMaxState"])?,
                                0 | 3
                            ),
                        "Unsupported particle ribbon layout"
                    );
                }
                ensure!(scene.chain(go)?.iter().all(|t|vec3(&t["m_LocalScale"]).is_ok_and(|v|v.iter().all(|s|*s>0.0))),"Negative particle trail scale");
                let slot = slots.get(1).context("Particle trail material missing")?;
                let key = pointer_id(slot)?;
                ensure!(
                    materials.contains_key(&key),
                    "Particle trail material is unbound"
                );
                trail_material = Some(key);
            }
            if mode == 5 && trail_material.is_none() {
                continue;
            }
            let sh = &d["ShapeModule"];
            if truth(&sh["enabled"]) {
                ensure!(
                    [0, 2, 4, 5, 6, 8, 10, 12, 15, 16].contains(&integer(&sh["type"])?),
                    "Unsupported particle emission shape"
                );
            }
            let noise = &d["NoiseModule"];
            if truth(&noise["enabled"]) {
                let quality = integer(&noise["quality"])?;
                let octaves = integer(&noise["octaves"])?;
                ensure!(
                    (quality == 2 || ([0, 1].contains(&quality) && octaves == 1))
                        && (1..=4).contains(&octaves)
                        && !truth(&noise["remapEnabled"]),
                    "Unsupported particle noise variant"
                );
            }
            let clamp = &d["ClampVelocityModule"];
            if truth(&clamp["enabled"]) {
                ensure!(
                    !truth(&clamp["separateAxis"])
                        && (number(&clamp["drag"]["scalar"])? == 0.0
                            || clamp["drag"]["minMaxState"] == 0)
                        && (0.0..=1.0).contains(&number(&clamp["dampen"])?),
                    "Unsupported particle velocity clamp"
                );
            }
            let uv = &d["UVModule"];
            if truth(&uv["enabled"]) {
                ensure!(
                    uv["mode"] == 0
                        && uv["timeMode"] == 0
                        && matches!(integer(&uv["animationType"])?, 0 | 1)
                        && !truth(&uv["flipU"])
                        && !truth(&uv["flipV"]),
                    "Unsupported particle flipbook mode"
                );
            }
            let mut modules = select(d, &MODULES)?;
            held_tangents(&mut modules);
            let mut main = select(
                d,
                &[
                    "lengthInSec",
                    "simulationSpeed",
                    "looping",
                    "prewarm",
                    "moveWithTransform",
                    "scalingMode",
                    "startDelay",
                    "autoRandomSeed",
                    "randomSeed",
                    "cullingMode",
                    "stopAction",
                    "ringBufferMode",
                ],
            )?;
            main["subEmitterModuleEnabled"] = json!(truth(&d["SubModule"]["enabled"]));
            let renderer = select(
                r,
                &[
                    "m_RenderMode",
                    "m_SortMode",
                    "m_MaxParticleSize",
                    "m_LengthScale",
                    "m_VelocityScale",
                    "m_CameraVelocityScale",
                    "m_SortingOrder",
                    "m_Pivot",
                    "m_Flip",
                    "m_RenderAlignment",
                    "m_UseCustomVertexStreams",
                    "m_VertexStreams",
                    "m_MinParticleSize",
                    "m_FreeformStretching",
                    "m_RotateWithStretchDirection",
                ],
            )?;
            let key = if render_enabled {
                pointer_id(slots.first().context("Particle material slot missing")?)?
            } else {
                String::new()
            };
            if let Some(material) = materials.get(&key) {
                if material["shader"] == "directional-grab" {
                    ensure!(
                        array(&material["keywords"])?.is_empty()
                            && !matches!(material["floats"]["_DirMode"].as_f64(), Some(1.0 | 2.0)),
                        "Unsupported directional particle grab transform"
                    );
                }
            }
            let mut node = json!({
                "id":id.path.to_string(),
                "rendererKey":go.path.to_string(),
                "name":scene.rows[&go]["m_Name"],
                "transforms":scene.chain(go)?,
                "modules":modules,
                "main":main,
                "renderer":renderer,
                "material":key,
                "renderEnabled":render_enabled
            });
            if emission_targets.contains(&id) {
                node["emissionFadeTarget"] = true.into();
            }
            if !births.is_empty() {
                node["birthEmitters"] = json!(births);
                node["birthProbabilities"] = json!(probabilities);
                if moving_birth {
                    node["movingBirthEmitter"] = true.into();
                }
            }
            if mode == 4 {
                ensure!(!slots.is_empty(), "Particle mesh material missing");
                let first = mesh::geometry(scene, *renderer_id, &r["m_Mesh"], true, false)?;
                let alternatives = ["m_Mesh1", "m_Mesh2", "m_Mesh3"]
                    .into_iter()
                    .filter(|key| r[*key]["m_PathID"] != 0)
                    .collect::<Vec<_>>();
                if alternatives.is_empty() {
                    node["mesh"] = first;
                } else {
                    ensure!(
                        r["m_MeshDistribution"] == 0,
                        "Weighted mesh variants are unsupported"
                    );
                    let mut variants = vec![first];
                    for key in alternatives {
                        variants.push(mesh::geometry(scene, *renderer_id, &r[key], true, false)?);
                    }
                    node["meshVariants"] = json!(variants);
                }
                if slots.len() > 2 {
                    node["extraMeshPasses"] = json!(slots.len() - 2);
                }
            }
            if truth(&sh["enabled"]) && sh["type"] == 6 {
                let mut geometry = mesh::geometry(scene, id, &sh["m_Mesh"], false, true)?;
                if !truth(&sh["m_UseMeshColors"]) {
                    geometry.as_object_mut().unwrap().remove("colorBytes");
                }
                node["emissionMesh"] = geometry;
            }
            if let Some(trail) = trail_material {
                node["trailMaterial"] = json!(trail);
                if mode == 5 {
                    node["material"] = json!(trail);
                    node["rendererKey"] = format!("{}:trail", go.path).into();
                }
            }
            nodes.push(node);
        }
        if kind == 96 && truth(&d["m_Enabled"]) {
            let p = &d["m_Parameters"];
            let go = scene.owner(id)?;
            ensure!(
                !ui_geometry
                    && p["alignment"] == 0
                    && p["numCornerVertices"] == 0
                    && p["numCapVertices"] == 0
                    && !truth(&p["generateLightingData"])
                    && [0, 1, 2, 3].contains(&integer(&p["textureMode"])?)
                    && !truth(&d["m_Autodestruct"]),
                "Unsupported standalone trail geometry"
            );
            let slots = array(&d["m_Materials"])?;
            ensure!(
                slots.len() == 1 && slots[0]["m_PathID"] != 0,
                "Unsupported trail material slots"
            );
            trails.push(json!({
                "rendererKey":go.path.to_string(),
                "name":scene.rows[&go]["m_Name"],
                "transforms":scene.chain(go)?,
                "material":pointer_id(&slots[0])?,
                "order":d["m_SortingOrder"],
                "time":d["m_Time"],
                "minDistance":d["m_MinVertexDistance"],
                "emitting":d["m_Emitting"],
                "parameters":p
            }));
        }
        if kind == 23 && truth(&d["m_Enabled"]) {
            let go = scene.owner(id)?;
            if !active(scene, go, &animated, &item_roots)? {
                continue;
            }
            let (filter, mf) = scene
                .by_kind(33)
                .find(|(id, _)| scene.owner(*id).ok() == Some(go))
                .context("Mesh renderer filter missing")?;
            let geometry = mesh::geometry(scene, filter, &mf["m_Mesh"], false, false)?;
            let faces = array(&geometry["triangles"])?;
            let slots = array(&d["m_Materials"])?;
            for (slot, pointer) in slots.iter().enumerate() {
                let key = if pointer["m_PathID"] == 0 && pointer["m_FileID"] == 0 {
                    materials
                        .entry("builtin-error".into())
                        .or_insert_with(animation::error_material);
                    "builtin-error".into()
                } else {
                    pointer_id(pointer)?
                };
                let submesh = slot.min(faces.len() - 1);
                meshes.push(json!({
                    "name":scene.rows[&go]["m_Name"],
                    "rendererKey":go.path.to_string(),
                    "materialSlot":slot,
                    "submesh":submesh,
                    "transforms":scene.chain(go)?,
                    "positions":geometry["positions"],
                    "uv":geometry["uv"],
                    "triangles":faces[submesh],
                    "material":key,
                    "order":d["m_SortingOrder"]
                }));
            }
        }
    }
    let fade = items
        .first()
        .map(|(_, item)| integer(&item["_fadeType"]))
        .transpose()?
        .unwrap_or(0);
    ensure!((0..=4).contains(&fade), "Unsupported effect fade mode");
    let animator_bound = fade != 4
        || items
            .first()
            .is_some_and(|(_, item)| item["_effectAnimator"]["m_PathID"] != 0);
    if fade == 4 && animator_bound {
        let target = pointer_id(&items[0].1["_effectAnimator"])?;
        ensure!(
            animation
                .as_ref()
                .is_some_and(|a| a["animatorId"].as_str() == Some(&target)),
            "Effect fade Animator is not bound"
        );
    }
    if fade == 1 {
        ensure!(
            items[0].1["_fadeAnimation"]["m_PathID"] == 0
                && items[0].1["_fadeAnimation"]["m_FileID"] == 0,
            "Legacy fade animation is unsupported"
        );
    }
    for node in nodes.iter().chain(meshes.iter()) {
        ensure!(
            !node.get("renderEnabled").is_none_or(truth)
                || node["material"]
                    .as_str()
                    .is_some_and(|key| materials.contains_key(key)),
            "Effect renderer material is unbound"
        );
    }
    let ids = nodes
        .iter()
        .map(|n| n["id"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    for node in &nodes {
        if let Some(children) = node["birthEmitters"].as_array() {
            for child in children {
                let key = child.as_str().context("Invalid sub-emitter identity")?;
                ensure!(ids.contains(key), "Sub-emitter simulation node missing");
                let target = nodes
                    .iter()
                    .find(|n| n["id"].as_str() == Some(key))
                    .unwrap();
                ensure!(
                    target["birthEmitters"].as_array().is_none_or(Vec::is_empty),
                    "Nested birth-emitter graph is unsupported"
                );
            }
        }
    }
    let orders = scene
        .rows
        .iter()
        .filter(|(id, _)| {
            scene
                .kind(**id)
                .is_ok_and(|kind| matches!(kind, 23 | 96 | 199))
        })
        .map(|(_, d)| integer(&d["m_SortingOrder"]))
        .collect::<Result<BTreeSet<_>>>()?;
    let shader_bundles = materials
        .values()
        .filter_map(|m| m["shaderBundle"].as_str())
        .map(|name| {
            Ok((
                name,
                source
                    .manifest
                    .entries
                    .get(name)
                    .context("Shader source missing")?
                    .md5
                    .clone(),
            ))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    let mut profile = json!({
        "kind":"native-particles-v2",
        "fadeType":fade,
        "fadeAnimatorBound":animator_bound,
        "hasEffectItem":!items.is_empty(),
        "duration":items.first().map(|(_,d)|d["_effectDuration"].clone()).unwrap_or(json!(0)),
        "renderOrders":orders,
        "nodes":nodes,
        "meshes":meshes,
        "uvTweens":uv_tweens,
        "uvRotations":uv_rotations,
        "delayedActivations":delayed,
        "rootDelay":root_delay,
        "animation":animation,
        "materials":materials,
        "textures":textures,
        "evidence":{"markerScripts":markers,"bundle":bundle,"md5":source.manifest.entries[bundle].md5,"shaderBundles":shader_bundles}
    });
    if !trails.is_empty() {
        profile["standaloneTrails"] = json!(trails);
    }
    Ok(profile)
}
