use super::scene::{array, integer, number, truth, Scene};
use crate::source::Source;
use anyhow::{ensure, Result};
use serde_json::{json, Value};

fn one<'a>(
    scene: &'a Scene<'_>,
    kind: i32,
    predicate: impl Fn(&Value) -> bool,
) -> Result<&'a Value> {
    let values = scene
        .by_kind(kind)
        .filter(|(_, row)| predicate(row))
        .map(|(_, row)| row)
        .collect::<Vec<_>>();
    ensure!(
        values.len() == 1,
        "Native blur component is not unique: {kind}"
    );
    Ok(values[0])
}
pub fn build(scene: &Scene<'_>, source: &Source, bundle: &str) -> Result<Value> {
    ensure!(
        scene.by_kind(23).next().is_none(),
        "Blur effect requires unsupported mesh rendering"
    );
    let item = one(scene, 114, |v| v.get("_effectDuration").is_some())?;
    ensure!(
        item["_fadeType"] == 0 && array(&item["_particleSystemList"])?.is_empty(),
        "Unsupported blur fade mode"
    );
    ensure!(
        scene
            .by_kind(198)
            .all(|(_, row)| !truth(&row["EmissionModule"]["enabled"])),
        "Blur effect requires particle simulation"
    );
    let settings = one(scene, 114, |row| row["m_Name"] == "HGMobileBlur")?;
    ensure!(
        array(&one(scene, 114, |row| row.get("settings").is_some())?["settings"])?.len() == 1,
        "Unsupported blur settings graph"
    );
    ensure!(
        one(scene, 114, |row| row.get("antialiasingMode").is_some())?["antialiasingMode"] == 0,
        "Unsupported blur antialiasing mode"
    );
    let animator = one(scene, 95, |_| true)?;
    ensure!(
        animator["m_CullingMode"] == 0 && animator["m_UpdateMode"] == 0,
        "Unsupported blur animator mode"
    );
    let volume = one(scene, 114, |row| row.get("sharedProfile").is_some())?;
    ensure!(
        truth(&volume["isGlobal"]) && truth(&volume["m_Enabled"]) && truth(&settings["active"]),
        "Unsupported local blur volume"
    );
    let controller = &one(scene, 91, |_| true)?["m_Controller"];
    ensure!(
        array(&controller["m_LayerArray"])?.len() == 1
            && array(&controller["m_StateMachineArray"])?.len() == 1,
        "Unsupported blur animation layers"
    );
    let states = array(&controller["m_StateMachineArray"][0]["data"]["m_StateConstantArray"])?;
    ensure!(states.len() == 1, "Unsupported blur states");
    let state = &states[0]["data"];
    ensure!(
        array(&state["m_TransitionConstantArray"])?.is_empty()
            && number(&state["m_Speed"])? == 1.0
            && number(&state["m_CycleOffset"])? == 0.0,
        "Unsupported blur animation timing"
    );
    let clip = one(scene, 74, |_| true)?;
    let bindings = array(&clip["m_ClipBindingConstant"]["genericBindings"])?;
    ensure!(
        !truth(&clip["m_Legacy"]) && array(&clip["m_Events"])?.is_empty(),
        "Unsupported blur clip events"
    );
    ensure!(
        bindings.len() == 1
            && integer(&bindings[0]["attribute"])? == crc32fast::hash(b"weight") as i64
            && integer(&bindings[0]["path"])?
                == crc32fast::hash(b"static_offset/fixed/pp_dm") as i64,
        "Unknown animated blur property"
    );
    let muscle = &clip["m_MuscleClip"];
    let data = &muscle["m_Clip"]["data"];
    ensure!(
        data["m_StreamedClip"]["curveCount"] == 1
            && data["m_DenseClip"]["m_CurveCount"] == 0
            && array(&data["m_ConstantClip"]["data"])?.is_empty()
            && !truth(&muscle["m_LoopTime"]),
        "Unsupported blur animation storage"
    );
    let settings = super::scene::select(
        settings,
        &["enabled", "blurDegree", "resMode", "blurSpread", "quality"],
    )?;
    Ok(json!({
        "kind":"mohu-volume-v1",
        "duration":muscle["m_StopTime"],
        "curve":data["m_StreamedClip"]["data"],
        "initialWeight":volume["weight"],
        "priority":volume["priority"],
        "settings":settings,
        "fadeType":0,
        "evidence":{"bundle":bundle,"md5":source.manifest.entries[bundle].md5,"clip":clip["m_Name"],"binding":bindings[0]}
    }))
}
