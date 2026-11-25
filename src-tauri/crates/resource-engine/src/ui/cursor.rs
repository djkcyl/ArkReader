use crate::{
    media::{self, MediaStore},
    model::Index,
    prefab::{GameObject, RectTransform},
    source::Source,
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

pub const RESOURCE: &str = "mouse/pc_mouse_mgr";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub path: String,
    pub parent: Option<String>,
    pub active: bool,
    pub anchor_min: [f64; 2],
    pub anchor_max: [f64; 2],
    pub position: [f64; 2],
    pub size: [f64; 2],
    pub pivot: [f64; 2],
    pub scale: [f64; 3],
    pub rotation: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sprite: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<[f64; 4]>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Key {
    pub time: f64,
    pub value: f64,
    pub in_slope: Option<f64>,
    pub out_slope: Option<f64>,
    pub weighted_mode: u32,
    pub in_weight: f64,
    pub out_weight: f64,
}
#[derive(Serialize)]
pub struct Track {
    pub path: String,
    pub property: String,
    pub axis: String,
    pub keys: Vec<Key>,
}
#[derive(Serialize)]
pub struct Animation {
    pub name: String,
    pub duration: f64,
    pub tracks: Vec<Track>,
}
#[derive(Serialize)]
pub struct Cursor {
    pub handler: String,
    pub reference: [f64; 2],
    #[serde(rename = "match")]
    pub match_screen: f64,
    pub nodes: Vec<Node>,
    pub sprites: BTreeMap<String, String>,
    pub down: Animation,
    pub up: Animation,
}

fn scalar(value: &Value, axis: &str) -> Result<f64> {
    value
        .as_f64()
        .or_else(|| value[axis].as_f64())
        .context("Invalid cursor animation value")
}
fn slope(value: &Value, axis: &str) -> Result<Option<f64>> {
    let value = if value.is_object() {
        &value[axis]
    } else {
        value
    };
    if matches!(value.as_str(), Some("Infinity" | "-Infinity")) {
        Ok(None)
    } else {
        Ok(Some(scalar(value, axis)?))
    }
}
fn tracks(clip: &Value) -> Result<Animation> {
    let mut tracks = Vec::new();
    let mut duration = 0.0f64;
    for (field, property) in [
        ("m_ScaleCurves", "scale"),
        ("m_EulerCurves", "rotation"),
        ("m_PositionCurves", "position"),
    ] {
        for curve in clip[field]
            .as_array()
            .context("Cursor animation curves missing")?
        {
            for axis in ["x", "y", "z"] {
                let mut keys = Vec::new();
                for key in curve["curve"]["m_Curve"]
                    .as_array()
                    .context("Cursor animation keys missing")?
                {
                    let time = key["time"]
                        .as_f64()
                        .context("Invalid cursor animation time")?;
                    duration = duration.max(time);
                    keys.push(Key {
                        time,
                        value: scalar(&key["value"], axis)?,
                        in_slope: slope(&key["inSlope"], axis)?,
                        out_slope: slope(&key["outSlope"], axis)?,
                        weighted_mode: u32::try_from(
                            key["weightedMode"]
                                .as_u64()
                                .context("Cursor tangent weighting missing")?,
                        )?,
                        in_weight: scalar(&key["inWeight"], axis)?,
                        out_weight: scalar(&key["outWeight"], axis)?,
                    });
                }
                tracks.push(Track {
                    path: curve["path"]
                        .as_str()
                        .context("Cursor animation path missing")?
                        .into(),
                    property: property.into(),
                    axis: axis.into(),
                    keys,
                });
            }
        }
    }
    Ok(Animation {
        name: clip["m_Name"]
            .as_str()
            .context("Cursor clip name missing")?
            .into(),
        duration,
        tracks,
    })
}

struct Scene<'a> {
    env: &'a Unity,
    rows: BTreeMap<ObjectId, Value>,
    nodes: Vec<Node>,
    sprites: BTreeMap<String, String>,
    store: &'a MediaStore,
    visited: BTreeSet<ObjectId>,
}
impl Scene<'_> {
    fn visit(&mut self, id: ObjectId, path: String, parent: Option<String>) -> Result<()> {
        ensure!(self.visited.insert(id), "Cycle in cursor hierarchy");
        let go: GameObject = serde_json::from_value(
            self.rows
                .get(&id)
                .context("Cursor GameObject missing")?
                .clone(),
        )?;
        let mut transform = None;
        let mut image = None;
        for component in &go.components {
            let Some(id) = component.component.resolve(self.env, id)? else {
                continue;
            };
            let Some(row) = self.rows.get(&id) else {
                continue;
            };
            if row.get("m_AnchorMin").is_some() {
                transform = Some((id, serde_json::from_value::<RectTransform>(row.clone())?));
            }
            if row.get("m_Sprite").is_some() {
                image = Some((id, row.clone()));
            }
        }
        let (transform_id, t) = transform.context("Cursor RectTransform missing")?;
        ensure!(
            t.rotation.x.abs() <= 1e-6 && t.rotation.y.abs() <= 1e-6,
            "Unsupported cursor spatial rotation"
        );
        let mut node = Node {
            path: path.clone(),
            parent,
            active: go.active,
            anchor_min: [t.anchor_min.x, t.anchor_min.y],
            anchor_max: [t.anchor_max.x, t.anchor_max.y],
            position: [t.position.x, t.position.y],
            size: [t.size.x, t.size.y],
            pivot: [t.pivot.x, t.pivot.y],
            scale: [t.scale.x, t.scale.y, t.scale.z],
            rotation: (2.0 * t.rotation.z.atan2(t.rotation.w)).to_degrees(),
            sprite: None,
            color: None,
        };
        if let Some((owner, row)) = image {
            if let Some(id) = self.env.resolve(owner, &row["m_Sprite"])? {
                let (image, sprite) = media::sprite(self.env, id)?;
                let hash = format!("{:x}", Sha256::digest(sprite.name.as_bytes()));
                let filename = format!("native-prts-{}.png", &hash[..12]);
                if !self.sprites.contains_key(&filename) {
                    self.store.named_image(&filename, &image)?;
                    self.sprites.insert(filename.clone(), sprite.name);
                }
                node.sprite = Some(filename);
                node.color =
                    Some(["r", "g", "b", "a"].map(|c| row["m_Color"][c].as_f64().unwrap_or(0.0)));
            }
        }
        self.nodes.push(node);
        for child in t.children {
            let child = child
                .resolve(self.env, transform_id)?
                .context("Cursor child transform missing")?;
            let row = self
                .rows
                .get(&child)
                .context("Cursor child record missing")?;
            let go = self
                .env
                .resolve(child, &row["m_GameObject"])?
                .context("Cursor child owner missing")?;
            let name = self.rows[&go]["m_Name"]
                .as_str()
                .context("Cursor child name missing")?;
            let child_path = if path.is_empty() {
                name.into()
            } else {
                format!("{path}/{name}")
            };
            self.visit(go, child_path, Some(path.clone()))?;
        }
        Ok(())
    }
}

fn extract(env: &Unity, container: &str, store: &MediaStore) -> Result<Cursor> {
    let root = env.container(container, 1)?;
    let mut rows = BTreeMap::new();
    for object in env.studio.objects().filter(|o| {
        o.file_index() == root.file && matches!(o.class_id(), 1 | 4 | 224 | 114 | 111 | 74)
    }) {
        let id = ObjectId {
            file: object.file_index(),
            path: object.path_id(),
        };
        rows.insert(id, env.tree(id)?);
    }
    let (manager_id, manager) = rows
        .iter()
        .find(|(_, row)| {
            row.get("_defaultConfig").is_some()
                && row["m_GameObject"]["m_PathID"].as_i64() == Some(root.path)
        })
        .context("Default cursor configuration missing")?;
    let handler_id = env
        .resolve(*manager_id, &manager["_defaultConfig"]["mouseHandler"])?
        .context("Default cursor handler missing")?;
    let handler = rows
        .get(&handler_id)
        .context("Cursor handler record missing")?;
    let root = env
        .resolve(handler_id, &handler["m_GameObject"])?
        .context("Cursor root missing")?;
    let canvas = env
        .resolve(*manager_id, &manager["_canvasUI"])?
        .context("Cursor canvas missing")?;
    let canvas = env
        .resolve(canvas, &env.tree(canvas)?["m_GameObject"])?
        .context("Cursor canvas owner missing")?;
    let scaler = rows
        .values()
        .find(|row| {
            row["m_GameObject"]["m_PathID"].as_i64() == Some(canvas.path)
                && row.get("m_ReferenceResolution").is_some()
        })
        .context("Cursor canvas scaling missing")?;
    let (animation_id, animation) = rows
        .iter()
        .find(|(_, row)| {
            row["m_GameObject"]["m_PathID"].as_i64() == Some(root.path)
                && row.get("m_Animations").is_some()
        })
        .context("Cursor animation missing")?;
    let mut clips = BTreeMap::new();
    for pointer in animation["m_Animations"]
        .as_array()
        .context("Cursor clip list missing")?
    {
        let id = env
            .resolve(*animation_id, pointer)?
            .context("Cursor clip missing")?;
        let clip = rows.get(&id).context("Cursor clip record missing")?;
        clips.insert(
            clip["m_Name"]
                .as_str()
                .context("Cursor clip name missing")?,
            clip,
        );
    }
    let down = tracks(
        clips
            .get(
                handler["_onBtnDownAnim"]["animationName"]
                    .as_str()
                    .context("Cursor down animation missing")?,
            )
            .context("Cursor down clip missing")?,
    )?;
    let up = tracks(
        clips
            .get(
                handler["_onBtnUpAnim"]["animationName"]
                    .as_str()
                    .context("Cursor up animation missing")?,
            )
            .context("Cursor up clip missing")?,
    )?;
    let handler = handler["_id"]
        .as_str()
        .context("Cursor identity missing")?
        .to_owned();
    let reference = [
        scaler["m_ReferenceResolution"]["x"]
            .as_f64()
            .context("Cursor reference width missing")?,
        scaler["m_ReferenceResolution"]["y"]
            .as_f64()
            .context("Cursor reference height missing")?,
    ];
    let match_screen = scaler["m_MatchWidthOrHeight"]
        .as_f64()
        .context("Cursor scaling mode missing")?;
    let mut scene = Scene {
        env,
        rows,
        nodes: Vec::new(),
        sprites: BTreeMap::new(),
        store,
        visited: BTreeSet::new(),
    };
    scene.visit(root, String::new(), None)?;
    Ok(Cursor {
        handler,
        reference,
        match_screen,
        nodes: scene.nodes,
        sprites: scene.sprites,
        down,
        up,
    })
}

pub async fn prepare(index: &Index, source: &Source, store: Arc<MediaStore>) -> Result<String> {
    let route = index
        .routes
        .get(RESOURCE)
        .context("Official PRTS cursor route missing")?;
    let container = route
        .container
        .clone()
        .context("Official cursor container missing")?;
    let path = source.bundle(&route.bundle, |_| {}).await?;
    let cancel = source.cancellation();
    tokio::task::spawn_blocking(move || {
        let env = Unity::open(&[path], cancel)?;
        let cursor = extract(&env, &container, &store)?;
        store.named("native-cursor.json", &serde_json::to_vec(&cursor)?)
    })
    .await?
}
