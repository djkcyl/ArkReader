use super::scene::{array, color, integer, number, truth, vec3, Scene};
use crate::{source::Source, unity::ObjectId};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

fn constant(c: &Value) -> Result<f64> {
    ensure!(
        c["minMaxState"] == 0,
        "Unsupported nonconstant signal field"
    );
    number(&c["scalar"])
}
fn range(c: &Value) -> Result<[f64; 2]> {
    let value = number(&c["scalar"])?;
    match integer(&c["minMaxState"])? {
        0 => Ok([value, value]),
        3 => Ok([number(&c["minScalar"])?, value]),
        _ => anyhow::bail!("Unsupported signal particle curve"),
    }
}
fn gradient(g: &Value) -> Result<Value> {
    match integer(&g["minMaxState"])? {
        0 => Ok(json!({"constant":color(&g["maxColor"])?})),
        2 => Ok(json!({"min":color(&g["minColor"])?,"max":color(&g["maxColor"])?})),
        1 => {
            let v = &g["maxGradient"];
            ensure!(
                matches!(integer(&v["m_Mode"])?, 0 | 1),
                "Unsupported signal gradient mode"
            );
            let mut colors = Vec::new();
            let mut alpha = Vec::new();
            let color_count = integer(&v["m_NumColorKeys"])?;
            let alpha_count = integer(&v["m_NumAlphaKeys"])?;
            ensure!(
                (0..=8).contains(&color_count) && (0..=8).contains(&alpha_count),
                "Invalid gradient key count"
            );
            for i in 0..color_count {
                let c = color(&v[format!("key{i}")])?;
                colors.push([number(&v[format!("ctime{i}")])? / 65535.0, c[0], c[1], c[2]]);
            }
            for i in 0..alpha_count {
                alpha.push([
                    number(&v[format!("atime{i}")])? / 65535.0,
                    number(&v[format!("key{i}")]["a"])?,
                ]);
            }
            Ok(json!({"mode":v["m_Mode"],"color":colors,"alpha":alpha}))
        }
        _ => anyhow::bail!("Unsupported signal particle gradient"),
    }
}
fn world(
    scene: &Scene<'_>,
    id: ObjectId,
    seen: &mut BTreeSet<ObjectId>,
) -> Result<([f64; 3], [f64; 3])> {
    ensure!(seen.insert(id), "Cycle in signal transform");
    let t = &scene.rows[&id];
    let q = &t["m_LocalRotation"];
    let y = number(&q["y"])?;
    let w = number(&q["w"])?;
    ensure!(
        number(&q["x"])? == 0.0
            && number(&q["z"])? == 0.0
            && [(0.0, 1.0), (1.0, 0.0)].contains(&(y, w)),
        "Unsupported signal rotation"
    );
    let sign = if y != 0.0 { -1.0 } else { 1.0 };
    let local = vec3(&t["m_LocalPosition"])?;
    let local_scale = vec3(&t["m_LocalScale"])?;
    let scale = [local_scale[0] * sign, local_scale[1], local_scale[2] * sign];
    let Some(parent) = scene.resolve(id, &t["m_Father"])? else {
        return Ok((local, scale));
    };
    let (position, parent_scale) = world(scene, parent, seen)?;
    Ok((
        std::array::from_fn(|i| position[i] + parent_scale[i] * local[i]),
        std::array::from_fn(|i| parent_scale[i] * scale[i]),
    ))
}

pub fn build(
    scene: &Scene<'_>,
    source: &Source,
    bundle: &str,
    materials: BTreeMap<String, Value>,
    textures: BTreeMap<String, Value>,
) -> Result<Value> {
    let items = scene
        .by_kind(114)
        .filter(|(_, row)| row.get("_effectDuration").is_some())
        .collect::<Vec<_>>();
    ensure!(
        items.len() == 1 && items[0].1["_fadeType"] == 2,
        "Unsupported signal lifecycle"
    );
    let renderers = scene
        .by_kind(199)
        .map(|(id, row)| Ok((scene.owner(id)?, row)))
        .collect::<Result<BTreeMap<_, _>>>()?;
    let mut nodes = Vec::new();
    for (id, d) in scene.by_kind(198) {
        for (name, value) in d.as_object().context("Invalid signal particle")? {
            if value.is_object() && truth(&value["enabled"]) {
                ensure!(
                    [
                        "InitialModule",
                        "ShapeModule",
                        "EmissionModule",
                        "ColorModule",
                        "CustomDataModule"
                    ]
                    .contains(&name.as_str()),
                    "Unsupported signal particle module: {name}"
                );
            }
        }
        if truth(&d["CustomDataModule"]["enabled"]) {
            for vector in 0..2 {
                for axis in 0..4 {
                    ensure!(
                        constant(&d["CustomDataModule"][format!("vector{vector}_{axis}")])? == 0.0,
                        "Unsupported signal custom data"
                    );
                }
            }
        }
        if !truth(&d["EmissionModule"]["enabled"]) {
            continue;
        }
        let initial = &d["InitialModule"];
        let emission = &d["EmissionModule"];
        let go = scene.owner(id)?;
        let r = renderers.get(&go).context("Signal renderer missing")?;
        let t_id = scene.transforms[&go];
        let t = &scene.rows[&t_id];
        ensure!(
            !truth(&d["looping"])
                && !truth(&d["prewarm"])
                && number(&d["simulationSpeed"])? == 1.0
                && d["scalingMode"] == 1
                && d["moveWithTransform"] == 0
                && truth(&d["playOnAwake"]),
            "Unsupported signal simulation mode"
        );
        ensure!(
            constant(&initial["gravityModifier"])? == 0.0
                && constant(&initial["startRotation"])? == 0.0
                && !truth(&initial["rotation3D"]),
            "Unsupported signal motion"
        );
        ensure!(
            r["m_RenderMode"] == 0
                && matches!(integer(&r["m_RenderAlignment"])?, 0 | 2)
                && (!truth(&r["m_UseCustomVertexStreams"])
                    || r["m_VertexStreams"] == json!([0, 1, 3, 4, 34, 38]))
                && vec3(&r["m_Pivot"])? == [0.0; 3]
                && vec3(&r["m_Flip"])? == [0.0; 3],
            "Unsupported signal billboard mode"
        );
        let (position, scale) = world(scene, t_id, &mut BTreeSet::new())?;
        let shape = if truth(&d["ShapeModule"]["enabled"]) {
            let shape = &d["ShapeModule"];
            ensure!(
                shape["type"] == 5
                    && vec3(&shape["m_Position"])? == [0.0; 3]
                    && vec3(&shape["m_Rotation"])? == [0.0; 3]
                    && number(&shape["randomPositionAmount"])? == 0.0,
                "Unsupported signal shape"
            );
            Some([
                number(&shape["m_Scale"]["x"])?,
                number(&shape["m_Scale"]["y"])?,
            ])
        } else {
            None
        };
        ensure!(
            constant(&emission["rateOverDistance"])? == 0.0,
            "Unsupported signal distance emission"
        );
        let mut bursts = Vec::new();
        for burst in array(&emission["m_Bursts"])? {
            ensure!(
                burst["cycleCount"] == 1 && number(&burst["probability"])? == 1.0,
                "Unsupported repeating signal burst"
            );
            bursts.push([number(&burst["time"])?, constant(&burst["countCurve"])?]);
        }
        nodes.push(json!({
            "id":id.path.to_string(),
            "name":scene.rows[&go]["m_Name"],
            "position":position,
            "localScale":[t["m_LocalScale"]["x"],t["m_LocalScale"]["y"]],
            "flip":scale[0]<0.0&&r["m_RenderAlignment"]==2,
            "delay":constant(&d["startDelay"])?,
            "duration":d["lengthInSec"],
            "life":range(&initial["startLifetime"])?,
            "sizeX":range(&initial["startSize"])?,
            "sizeY":if truth(&initial["size3D"]){Some(range(&initial["startSizeY"])?)}else{None},
            "startColor":gradient(&initial["startColor"])?,
            "color":if truth(&d["ColorModule"]["enabled"]){Some(gradient(&d["ColorModule"]["gradient"])?)}else{None},
            "shape":shape,
            "speedZ":constant(&initial["startSpeed"])?*if scale[2]>0.0{1.0}else{-1.0},
            "rate":constant(&emission["rateOverTime"])?,
            "bursts":bursts,
            "maxParticles":initial["maxNumParticles"],
            "maxSize":r["m_MaxParticleSize"],
            "order":r["m_SortingOrder"],
            "material":integer(&r["m_Materials"][0]["m_PathID"])?.to_string()
        }));
    }
    let orders = renderers
        .values()
        .map(|r| integer(&r["m_SortingOrder"]))
        .collect::<Result<BTreeSet<_>>>()?;
    Ok(json!({
        "kind":"signal-particles-v1",
        "renderOrders":orders,
        "fadeType":2,
        "duration":items[0].1["_effectDuration"],
        "nodes":nodes,
        "materials":materials,
        "textures":textures,
        "evidence":{"bundle":bundle,"md5":source.manifest.entries[bundle].md5,"particleSystems":scene.by_kind(198).count()}
    }))
}
