use super::scene::{array, integer, number, truth, Scene};
use crate::materials;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub fn error_material() -> Value {
    json!({
        "name":"Hidden/InternalErrorShader",
        "shaderId":"17",
        "shader":"builtin-error",
        "blend":{"srcBlend":1,"destBlend":0,"srcBlendAlpha":1,"destBlendAlpha":0},
        "floats":{},
        "colors":{},
        "textures":{},
        "keywords":[],
        "renderQueue":2000,
        "zWrite":true,
        "cull":"back",
        "source":"Resources/unity default resources"
    })
}
fn hash(name: &str) -> u32 {
    crc32fast::hash(name.as_bytes())
}
fn binding(
    target: Option<String>,
    path: i64,
    kind: &str,
    property: impl Into<String>,
    component: i64,
) -> Value {
    json!({"renderer":target,"pathHash":path,"kind":kind,"property":property.into(),"component":component})
}

fn streamed(words: &Value) -> Result<Vec<(usize, [f32; 4])>> {
    let words = array(words)?;
    let mut at = 0;
    let mut values = Vec::new();
    while at < words.len() {
        ensure!(words.len() - at >= 2, "Truncated streamed animation frame");
        let count = usize::try_from(integer(&words[at + 1])?)?;
        at += 2;
        ensure!(
            count <= (words.len() - at) / 5,
            "Invalid streamed animation frame"
        );
        for _ in 0..count {
            let channel = usize::try_from(integer(&words[at])?)?;
            let mut coefficients = [0.0; 4];
            for i in 0..4 {
                coefficients[i] = f32::from_bits(u32::try_from(integer(&words[at + i + 1])?)?);
            }
            values.push((channel, coefficients));
            at += 5;
        }
    }
    Ok(values)
}

struct MaterialReferences<'a> {
    materials: &'a mut BTreeMap<String, Value>,
    values: Vec<String>,
}
impl MaterialReferences<'_> {
    fn reference(&mut self, pointer: &Value) -> Result<usize> {
        ensure!(
            pointer["m_FileID"] == 0,
            "External animated material reference"
        );
        let path = integer(&pointer["m_PathID"])?;
        let key = if path == 0 {
            "builtin-error".into()
        } else {
            path.to_string()
        };
        if path == 0 {
            self.materials
                .entry(key.clone())
                .or_insert_with(error_material);
        }
        ensure!(
            self.materials.contains_key(&key),
            "Unbound animated material reference"
        );
        if let Some(i) = self.values.iter().position(|s| s == &key) {
            Ok(i)
        } else {
            self.values.push(key);
            Ok(self.values.len() - 1)
        }
    }
}

pub fn extract(
    scene: &Scene<'_>,
    materials: &mut BTreeMap<String, Value>,
) -> Result<Option<Value>> {
    let animators: Vec<_> = scene.by_kind(95).collect();
    if animators.is_empty() {
        return Ok(None);
    }
    ensure!(
        animators.len() == 1,
        "Multiple effect Animator graphs are unsupported"
    );
    let (animator_id, animator) = animators[0];
    ensure!(
        truth(&animator["m_Enabled"])
            && animator["m_CullingMode"] == 0
            && animator["m_UpdateMode"] == 0
            && !truth(&animator["m_ApplyRootMotion"]),
        "Unsupported effect Animator mode"
    );
    ensure!(
        animator["m_Controller"]["m_FileID"] == 0,
        "External effect Animator controller"
    );
    let Some(controller_id) = scene.resolve(animator_id, &animator["m_Controller"])? else {
        return Ok(None);
    };
    let controller = scene
        .rows
        .get(&controller_id)
        .context("Effect Animator controller missing")?;
    let graph = &controller["m_Controller"];
    if array(&graph["m_LayerArray"])?.is_empty()
        && array(&graph["m_StateMachineArray"])?.is_empty()
        && array(&controller["m_StateMachineBehaviours"])?.is_empty()
        && array(&controller["m_AnimationClips"])?.is_empty()
    {
        return Ok(None);
    }
    ensure!(
        array(&controller["m_StateMachineBehaviours"])?.is_empty()
            && array(&graph["m_LayerArray"])?.len() == 1
            && array(&graph["m_StateMachineArray"])?.len() == 1,
        "Unsupported layered effect Animator"
    );
    let machine = &graph["m_StateMachineArray"][0]["data"];
    let names = materials::pairs(&controller["m_TOS"])?
        .into_iter()
        .map(|(k, v)| {
            Ok((
                integer(&k)?,
                v.as_str()
                    .context("Animator state name missing")?
                    .to_owned(),
            ))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    let parameters = array(&graph["m_Values"]["data"]["m_ValueArray"])?;
    let defaults = array(&graph["m_DefaultValues"]["data"]["m_BoolValues"])?;
    let mut triggers = BTreeSet::new();
    let mut default_bools = BTreeMap::new();
    for p in parameters {
        let kind = integer(&p["m_Type"])?;
        let index = usize::try_from(integer(&p["m_Index"])?)?;
        ensure!(
            matches!(kind, 4 | 9) && index < defaults.len(),
            "Unsupported effect Animator parameter"
        );
        let id = integer(&p["m_ID"])?;
        default_bools.insert(id.to_string(), truth(&defaults[index]));
        if kind == 9 {
            triggers.insert(id);
        }
    }
    ensure!(
        array(&machine["m_AnyStateTransitionConstantArray"])?.is_empty(),
        "Unsupported AnyState effect transition"
    );
    let root = scene.owner(animator_id)?;
    let transform_paths = scene
        .transforms
        .keys()
        .map(|&go| Ok((hash(&scene.path(go, root)?), go)))
        .collect::<Result<BTreeMap<_, _>>>()?;
    let mut renderers = BTreeMap::new();
    for (&id, row) in &scene.rows {
        let kind = scene.kind(id)?;
        if matches!(kind, 23 | 96 | 199) {
            let go = scene.owner(id)?;
            renderers.insert(hash(&scene.path(go, root)?), (id, go, row, kind));
        }
    }
    let mut color_props = BTreeMap::new();
    let mut texture_props = BTreeMap::new();
    let mut float_props = BTreeMap::new();
    for material in materials.values() {
        for key in material["colors"]
            .as_object()
            .context("Material colors missing")?
            .keys()
        {
            color_props.insert(hash(key) & 0x0fffffff, key.clone());
        }
        for key in material["textures"]
            .as_object()
            .context("Material textures missing")?
            .keys()
        {
            texture_props.insert(hash(&format!("{key}_ST")) & 0x0fffffff, key.clone());
        }
        for key in material["floats"]
            .as_object()
            .context("Material floats missing")?
            .keys()
        {
            float_props.insert(hash(key) & 0x0fffffff, key.clone());
        }
    }
    let mut particle_names =
        BTreeSet::from(["looping".to_owned(), "ShapeModule.radius.value".into()]);
    for axis in ["x", "y", "z"] {
        particle_names.insert(format!("ShapeModule.m_Scale.{axis}"));
    }
    for bound in ["minColor", "maxColor"] {
        for axis in ["r", "g", "b", "a"] {
            particle_names.insert(format!("InitialModule.startColor.{bound}.{axis}"));
        }
    }
    for property in [
        "InitialModule.startSize",
        "InitialModule.startSizeY",
        "InitialModule.startSizeZ",
        "InitialModule.startSpeed",
        "InitialModule.startLifetime",
        "EmissionModule.rateOverDistance",
        "NoiseModule.strength",
    ] {
        for bound in ["scalar", "minScalar"] {
            particle_names.insert(format!("{property}.{bound}"));
        }
    }
    let particle_hashes = particle_names
        .into_iter()
        .map(|name| (hash(&name), name))
        .collect::<BTreeMap<_, _>>();
    let particles = scene
        .by_kind(198)
        .map(|(id, _)| Ok((scene.owner(id)?, id)))
        .collect::<Result<BTreeMap<_, _>>>()?;
    let mut transforms = BTreeMap::new();
    let mut scales = BTreeMap::new();
    let mut rotations = BTreeMap::new();
    let mut active = BTreeMap::new();
    let mut speed_defaults = BTreeMap::new();
    let mut particle_defaults = json!({});
    let mut trail_defaults = json!({});
    let mut material_defaults = json!({});
    let mut root_position = None;
    let mut references = MaterialReferences {
        materials,
        values: Vec::new(),
    };
    let mut clips = Vec::new();
    for pointer in array(&controller["m_AnimationClips"])? {
        ensure!(pointer["m_FileID"] == 0, "External effect animation clip");
        let id = scene.require(controller_id, pointer)?;
        let clip = scene
            .rows
            .get(&id)
            .context("Effect animation clip missing")?;
        let muscle = &clip["m_MuscleClip"];
        let data = &muscle["m_Clip"]["data"];
        let stream = &data["m_StreamedClip"];
        let curve_count = usize::try_from(integer(&stream["curveCount"])?)?;
        let constants = array(&data["m_ConstantClip"]["data"])?;
        ensure!(
            array(&clip["m_Events"])?.is_empty()
                && !truth(&clip["m_Legacy"])
                && data["m_DenseClip"]["m_CurveCount"] == 0,
            "Unsupported effect clip storage or events"
        );
        let frames = streamed(&stream["data"])?;
        let mut decoded = Vec::new();
        for b in array(&clip["m_ClipBindingConstant"]["genericBindings"])? {
            let kind = integer(&b["typeID"])?;
            let custom = integer(&b["customType"])?;
            let attribute = integer(&b["attribute"])?;
            let path = integer(&b["path"])?;
            let path32 = u32::try_from(path)?;
            let pptr = truth(&b["isPPtrCurve"]);
            let target = transform_paths.get(&path32).copied();
            if matches!(kind, 23 | 96 | 199) && custom == 21 && pptr {
                let renderer = renderers.get(&path32).filter(|(_, _, row, k)| {
                    i64::from(*k) == kind
                        && usize::try_from(attribute).ok().is_some_and(|slot| {
                            array(&row["m_Materials"]).is_ok_and(|m| slot < m.len())
                        })
                });
                let Some((_, go, row, _)) = renderer else {
                    decoded.push(binding(
                        None,
                        path,
                        "materialReference",
                        "m_Materials",
                        attribute,
                    ));
                    continue;
                };
                let target = go.path.to_string();
                let slot = attribute as usize;
                if material_defaults.get(&target).is_none() {
                    material_defaults[&target] = json!({});
                }
                material_defaults[&target][slot.to_string()] =
                    json!(references.reference(&row["m_Materials"][slot])?);
                let mapped = array(&clip["m_ClipBindingConstant"]["pptrCurveMapping"])?
                    .iter()
                    .map(|pointer| references.reference(pointer))
                    .collect::<Result<Vec<_>>>()?;
                let mut value = binding(
                    Some(target),
                    path,
                    "materialReference",
                    "m_Materials",
                    attribute,
                );
                value["references"] = json!(mapped);
                decoded.push(value);
                continue;
            }
            if kind == 96
                && !pptr
                && ((custom == 0 && attribute == hash("m_Time") as i64)
                    || (custom == 30 && attribute == hash("m_Parameters.widthMultiplier") as i64))
            {
                let renderer = renderers.get(&path32).filter(|(_, _, _, k)| *k == 96);
                let name = if custom == 0 {
                    "m_Time"
                } else {
                    "widthMultiplier"
                };
                let target = renderer.map(|(_, go, _, _)| go.path.to_string());
                if let Some((_, _, row, _)) = renderer {
                    let key = target.as_ref().unwrap();
                    if trail_defaults.get(key).is_none() {
                        trail_defaults[key] = json!({});
                    }
                    trail_defaults[key][name] = if custom == 0 {
                        row["m_Time"].clone()
                    } else {
                        row["m_Parameters"]["widthMultiplier"].clone()
                    };
                }
                decoded.push(binding(target, path, "trailProperty", name, 0));
                continue;
            }
            if kind == 198 && custom == 27 && !pptr {
                let particle = target.and_then(|go| particles.get(&go).copied());
                let key = particle.map(|id| id.path.to_string());
                if let Some(name) = particle_hashes.get(&(attribute as u32)) {
                    if let Some(id) = particle {
                        ensure!(
                            name != "looping" || !truth(&scene.rows[&id]["prewarm"]),
                            "Animated particle loop with prewarm is unsupported"
                        );
                        let mut value = &scene.rows[&id];
                        for field in name.split('.') {
                            value = &value[field];
                        }
                        let number = if value.is_boolean() {
                            if truth(value) {
                                1.0
                            } else {
                                0.0
                            }
                        } else {
                            number(value)?
                        };
                        let key = key.as_ref().unwrap();
                        if particle_defaults.get(key).is_none() {
                            particle_defaults[key] = json!({});
                        }
                        particle_defaults[key][name] = json!(number);
                    }
                    decoded.push(binding(key, path, "particleProperty", name.clone(), 0));
                    continue;
                }
                if attribute == hash("simulationSpeed") as i64 {
                    if let Some(id) = particle {
                        speed_defaults.insert(
                            id.path.to_string(),
                            scene.rows[&id]["simulationSpeed"].clone(),
                        );
                    }
                    decoded.push(binding(key, path, "particleSpeed", "simulationSpeed", 0));
                    continue;
                }
            }
            if kind == 114 && custom == 0 && !pptr && target.is_none() {
                decoded.push(binding(
                    None,
                    path,
                    "unboundScriptFloat",
                    attribute.to_string(),
                    0,
                ));
                continue;
            }
            if kind == 1 && attribute == hash("m_IsActive") as i64 && custom == 0 {
                let channel = decoded.len();
                let Some(target) = target else {
                    let mut value = binding(None, path, "gameObjectActive", "m_IsActive", 0);
                    value["gameObject"] = Value::Null;
                    decoded.push(value);
                    continue;
                };
                let initial = truth(&scene.rows[&target]["m_IsActive"]);
                let coefficients = if channel >= curve_count {
                    vec![[
                        0.0,
                        0.0,
                        0.0,
                        number(
                            constants
                                .get(channel - curve_count)
                                .context("Active constant missing")?,
                        )? as f32,
                    ]]
                } else {
                    frames
                        .iter()
                        .filter(|(id, _)| *id == channel)
                        .map(|(_, c)| *c)
                        .collect()
                };
                ensure!(!coefficients.is_empty(), "Missing animated active values");
                let unchanged = coefficients
                    .iter()
                    .all(|c| *c == [0.0, 0.0, 0.0, if initial { 1.0 } else { 0.0 }]);
                ensure!(
                    unchanged || target != root,
                    "Animator self-activation is unsupported"
                );
                let key = target.path.to_string();
                if !unchanged {
                    active.insert(key.clone(), initial);
                }
                let mut value = binding(
                    (!unchanged).then_some(key.clone()),
                    path,
                    if unchanged {
                        "unchangedActive"
                    } else {
                        "gameObjectActive"
                    },
                    "m_IsActive",
                    0,
                );
                value["gameObject"] = key.into();
                decoded.push(value);
                continue;
            }
            if kind == 4 && attribute == 3 && target.is_none() {
                for axis in 0..3 {
                    decoded.push(binding(None, path, "unboundScale", "m_LocalScale", axis));
                }
                continue;
            }
            if kind == 4 && matches!(attribute, 1 | 3 | 4) {
                let (kind, property) = match attribute {
                    1 => ("transformPosition", "m_LocalPosition"),
                    3 => ("transformScale", "m_LocalScale"),
                    _ => ("transformEuler", "localEulerAnglesRaw"),
                };
                if let Some(target) = target {
                    if target == root {
                        ensure!(
                            attribute == 1,
                            "Root rotation or scale animation is unsupported"
                        );
                        root_position = Some(target.path.to_string());
                    }
                    let row = &scene.rows[&scene.transforms[&target]];
                    match attribute {
                        1 => {
                            transforms
                                .insert(target.path.to_string(), row["m_LocalPosition"].clone());
                        }
                        3 => {
                            scales.insert(target.path.to_string(), row["m_LocalScale"].clone());
                        }
                        _ => {
                            rotations
                                .insert(target.path.to_string(), row["m_LocalRotation"].clone());
                        }
                    }
                }
                for axis in 0..3 {
                    decoded.push(binding(
                        target.map(|id| id.path.to_string()),
                        path,
                        kind,
                        property,
                        axis,
                    ));
                }
                continue;
            }
            ensure!(
                matches!(kind, 23 | 96 | 199) && custom == 22 && !pptr,
                "Unknown animated renderer property"
            );
            let Some((_, go, _, _)) = renderers.get(&path32) else {
                decoded.push(binding(
                    None,
                    path,
                    "unboundRendererFloat",
                    attribute.to_string(),
                    0,
                ));
                continue;
            };
            let prop = attribute as u32 & 0x0fffffff;
            let component = attribute >> 28;
            let (kind, name, component) =
                if (4..8).contains(&component) && color_props.contains_key(&prop) {
                    ("color", color_props[&prop].clone(), component - 4)
                } else if (0..4).contains(&component) && texture_props.contains_key(&prop) {
                    ("textureST", texture_props[&prop].clone(), component)
                } else if (0..4).contains(&component) && color_props.contains_key(&prop) {
                    ("vector", color_props[&prop].clone(), component)
                } else if (8..12).contains(&component) && float_props.contains_key(&prop) {
                    ("float", float_props[&prop].clone(), 0)
                } else {
                    anyhow::bail!("Unknown animated material property")
                };
            decoded.push(binding(
                Some(go.path.to_string()),
                path,
                kind,
                name,
                component,
            ));
        }
        ensure!(
            decoded.len() == curve_count + constants.len(),
            "Unbound animation curve channels"
        );
        for (channel, b) in decoded
            .iter()
            .enumerate()
            .filter(|(_, b)| b["kind"] == "materialReference" && !b["renderer"].is_null())
        {
            let count = array(&b["references"])?.len();
            let valid = |v: f64| v.is_finite() && v.fract() == 0.0 && v >= 0.0 && v < count as f64;
            for (_, c) in frames.iter().filter(|(i, _)| *i == channel) {
                ensure!(
                    c[..3].iter().all(|v| *v == 0.0) && valid(c[3] as f64),
                    "Unsupported interpolated material reference"
                );
            }
            if channel >= curve_count {
                ensure!(
                    valid(number(&constants[channel - curve_count])?),
                    "Invalid constant material reference"
                );
            }
        }
        clips.push(json!({
            "name":clip["m_Name"],
            "duration":muscle["m_StopTime"],
            "loop":muscle["m_LoopTime"],
            "curveCount":curve_count,
            "streamed":stream["data"],
            "constants":constants,
            "bindings":decoded
        }));
    }
    let mut states = Vec::new();
    for wrapped in array(&machine["m_StateConstantArray"])? {
        let state = &wrapped["data"];
        let trees = array(&state["m_BlendTreeConstantArray"])?;
        let mut clip_id = None;
        if !trees.is_empty() {
            let nodes = array(&trees[0]["data"]["m_NodeArray"])?;
            ensure!(
                trees.len() == 1
                    && nodes.len() == 1
                    && array(&nodes[0]["data"]["m_ChildIndices"])?.is_empty(),
                "Unsupported effect blend tree"
            );
            let clip = usize::try_from(integer(&nodes[0]["data"]["m_ClipID"])?)?;
            ensure!(clip < clips.len(), "Unbound Animator clip");
            clip_id = Some(clip);
        }
        let name_id = integer(&state["m_NameID"])?;
        let name = names
            .get(&name_id)
            .cloned()
            .unwrap_or_else(|| name_id.to_string());
        let transition_data = array(&state["m_TransitionConstantArray"])?;
        let terminal = clip_id.is_none() && transition_data.is_empty() && name == "destroy";
        ensure!(
            ((state["m_Speed"] == 1.0 || state["m_Speed"] == 1)
                && truth(&state["m_WriteDefaultValues"]))
                || terminal,
            "Unsupported Animator state timing or defaults"
        );
        ensure!(
            number(&state["m_CycleOffset"])? == 0.0
                && [
                    "m_SpeedParamID",
                    "m_MirrorParamID",
                    "m_CycleOffsetParamID",
                    "m_TimeParamID"
                ]
                .iter()
                .all(|k| state[*k] == 0),
            "Unsupported Animator state parameter"
        );
        let mut transitions = Vec::new();
        for wrapped in transition_data {
            let tr = &wrapped["data"];
            let mut conditions = Vec::new();
            for c in array(&tr["m_ConditionConstantArray"])? {
                let c = &c["data"];
                let mode = integer(&c["m_ConditionMode"])?;
                let event = integer(&c["m_EventID"])?;
                ensure!(
                    matches!(mode, 1 | 2)
                        && default_bools.contains_key(&event.to_string())
                        && (!triggers.contains(&event) || mode == 1),
                    "Unsupported Animator transition condition"
                );
                conditions.push(json!({"parameter":event.to_string(),"value":mode==1}));
            }
            ensure!(
                truth(&tr["m_HasExitTime"])
                    && truth(&tr["m_HasFixedDuration"])
                    && tr["m_InterruptionSource"] == 0,
                "Unsupported Animator transition timing"
            );
            transitions.push(json!({
                "destination":tr["m_DestinationState"],
                "exitTime":tr["m_ExitTime"],
                "duration":tr["m_TransitionDuration"],
                "offset":tr["m_TransitionOffset"],
                "endRequired":!conditions.is_empty(),
                "conditions":conditions
            }));
        }
        states.push(json!({"name":name,"clip":clip_id,"transitions":transitions,"speed":state["m_Speed"],"writeDefaults":state["m_WriteDefaultValues"]}));
    }
    fn visit(index: usize, states: &[Value], seen: &mut BTreeSet<usize>) -> Result<()> {
        ensure!(
            index < states.len() && seen.insert(index),
            "Unsupported cyclic Animator state graph"
        );
        for transition in array(&states[index]["transitions"])? {
            visit(
                usize::try_from(integer(&transition["destination"])?)?,
                states,
                seen,
            )?;
        }
        seen.remove(&index);
        Ok(())
    }
    for i in 0..states.len() {
        visit(i, &states, &mut BTreeSet::new())?;
    }
    let has_transitions = states
        .iter()
        .any(|s| s["transitions"].as_array().is_some_and(|v| !v.is_empty()));
    ensure!(
        !has_transitions
            || (rotations.is_empty() && material_defaults.as_object().unwrap().is_empty()),
        "Unsupported rotation or material-reference transition blending"
    );
    let mut result = json!({
        "animatorId":animator_id.path.to_string(),
        "defaultState":machine["m_DefaultState"],
        "states":states,
        "clips":clips,
        "defaultBools":default_bools,
        "triggerParameters":triggers.into_iter().map(|id|id.to_string()).collect::<Vec<_>>(),
        "transformDefaults":transforms,
        "scaleDefaults":scales,
        "rootPositionTarget":root_position,
        "rotationDefaults":rotations,
        "activeDefaults":active
    });
    if !speed_defaults.is_empty() {
        result["particleSpeedDefaults"] = json!(speed_defaults);
    }
    if !particle_defaults.as_object().unwrap().is_empty() {
        result["particleDefaults"] = particle_defaults;
    }
    if !trail_defaults.as_object().unwrap().is_empty() {
        result["trailDefaults"] = trail_defaults;
    }
    if !material_defaults.as_object().unwrap().is_empty() {
        result["materialReferenceDefaults"] = material_defaults;
        result["materialReferences"] = json!(references.values);
    }
    Ok(Some(result))
}
