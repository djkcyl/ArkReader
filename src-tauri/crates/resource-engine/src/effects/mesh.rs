use super::scene::{integer, vec3, Scene};
use crate::unity::ObjectId;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::sync::LazyLock;

static BUILTINS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../assets/builtin-meshes.json"))
        .expect("Valid built-in mesh data")
});

pub fn geometry(
    scene: &Scene<'_>,
    owner: ObjectId,
    pointer: &Value,
    particle: bool,
    emission: bool,
) -> Result<Value> {
    let file = integer(&pointer["m_FileID"])?;
    let path = integer(&pointer["m_PathID"])?;
    if file > 0 {
        let file = &scene.env.studio.collection().serialized_files()[owner.file].file;
        let external = file
            .externals
            .get(integer(&pointer["m_FileID"])? as usize - 1)
            .context("Mesh external reference missing")?;
        if external
            .path
            .eq_ignore_ascii_case("library/unity default resources")
        {
            let source = BUILTINS
                .get(path.to_string())
                .context("Unsupported built-in particle mesh")?;
            ensure!(!emission, "Built-in emission geometry is unsupported");
            let mut value = json!({"positions":source["positions"],"uv":source["uv"],"sourceSha256":source["sourceSha256"],"bounds":source["bounds"]});
            value["triangles"] = if particle {
                source["triangles"][0].clone()
            } else {
                source["triangles"].clone()
            };
            return Ok(value);
        }
    }
    let id = scene.require(owner, pointer)?;
    let geometry = scene.env.object(id)?.read_mesh(Default::default())?;
    let mesh = &geometry.mesh;
    let bounds = scene.env.field(id, "m_LocalAABB")?;
    let faces = mesh
        .sub_meshes
        .iter()
        .map(|s| {
            s.indices
                .as_chunks::<3>()
                .0
                .iter()
                .map(|v| [v[0], v[1], v[2]])
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    ensure!(!faces.is_empty(), "Mesh has no submesh geometry");
    if particle || emission {
        ensure!(faces.len() == 1, "Unsupported multi-submesh particle mesh");
    }
    let mut value = json!({
        "positions":mesh.vertices,
        "triangles":if particle||emission{json!(faces[0])}else{json!(faces)},
        "bounds":{"center":vec3(&bounds["m_Center"])?,"extent":vec3(&bounds["m_Extent"])?}
    });
    if emission {
        let normals = mesh
            .normals
            .as_ref()
            .context("Emission mesh normals missing")?;
        ensure!(
            normals.len() == mesh.vertices.len() && !faces[0].is_empty(),
            "Invalid emission mesh topology"
        );
        value["normals"] = json!(normals);
    } else {
        let uv = mesh.uv0.as_ref().context("Particle mesh UVs missing")?;
        ensure!(
            uv.len() == mesh.vertices.len(),
            "Particle mesh UV layout mismatch"
        );
        value["uv"] = json!(uv);
    }
    if let Some(colors) = &geometry.channels.colors {
        let channels = scene.env.field(id, "m_VertexData")?;
        let channel = &channels["m_Channels"][3];
        ensure!(
            channel["format"] == 2 && channel["dimension"] == 4 && colors.dimension == 4,
            "Unsupported particle mesh color format"
        );
        let values = colors
            .values
            .as_chunks::<4>()
            .0
            .iter()
            .map(|v| [v[0], v[1], v[2], v[3]])
            .collect::<Vec<_>>();
        ensure!(
            values.len() == mesh.vertices.len(),
            "Mesh color count mismatch"
        );
        if emission {
            value["colorBytes"] = json!(values
                .into_iter()
                .map(|v| v.map(|c| (c * 255.0).round().clamp(0.0, 255.0) as u8))
                .collect::<Vec<_>>());
        } else if particle {
            value["colors"] = json!(values);
        }
    }
    Ok(value)
}
