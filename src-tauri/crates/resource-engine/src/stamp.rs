use crate::{
    media::{self, Asset, EffectAsset, EffectContent, MediaStore},
    prefab::{GameObject, Quaternion, RectTransform, Vec2, Vec3},
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    path: String,
    active: bool,
    min: Vec2,
    max: Vec2,
    pos: Vec2,
    size: Vec2,
    pivot: Vec2,
    scale: Vec3,
    rotation: Quaternion,
    #[serde(skip_serializing_if = "Option::is_none")]
    alpha: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    spacing: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<[f64; 4]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slot: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    font_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    alignment: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    font: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sprite: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    border: Option<[f64; 4]>,
}
#[derive(Serialize)]
pub struct Track {
    pub path: String,
    pub property: String,
    pub keys: Vec<Value>,
}
#[derive(Serialize)]
struct Profile {
    nodes: Vec<Node>,
    clips: BTreeMap<String, Vec<Track>>,
    animation: String,
    media: BTreeMap<String, Value>,
    bundle: String,
    md5: String,
}

pub fn font_names(env: &Unity) -> Result<BTreeSet<String>> {
    let mut names = BTreeSet::new();
    for object in env.primary_objects().filter(|o| o.class_id() == 114) {
        let row = env.tree(ObjectId {
            file: object.file_index(),
            path: object.path_id(),
        })?;
        if let Some(name) = row["_fontName"].as_str().filter(|name| !name.is_empty()) {
            names.insert(name.into());
        }
    }
    Ok(names)
}

pub fn tracks(clip: &Value) -> Result<Vec<Track>> {
    let mut tracks = Vec::new();
    for (field, property) in [
        ("m_FloatCurves", None),
        ("m_RotationCurves", Some("rotation")),
        ("m_ScaleCurves", Some("scale")),
    ] {
        for curve in clip[field]
            .as_array()
            .context("Stamp animation curves missing")?
        {
            let keys = curve["curve"]["m_Curve"]
                .as_array()
                .context("Stamp animation keys missing")?;
            if keys.is_empty() {
                continue;
            }
            let axes: Vec<Option<&str>> = if property.is_some() {
                let values = keys[0]["value"]
                    .as_object()
                    .context("Stamp animation vector missing")?;
                ["x", "y", "z", "w"]
                    .into_iter()
                    .filter(|axis| values.contains_key(*axis))
                    .map(Some)
                    .collect()
            } else {
                vec![None]
            };
            for axis in axes {
                let property = if let Some(property) = property {
                    format!("{property}.{}", axis.unwrap())
                } else {
                    curve["attribute"]
                        .as_str()
                        .context("Stamp animation property missing")?
                        .into()
                };
                let mut samples = Vec::new();
                for key in keys {
                    let mut sample = serde_json::Map::new();
                    for (field, value) in key.as_object().context("Invalid stamp animation key")? {
                        let mut value = if let Some(axis) = axis.filter(|_| value.is_object()) {
                            value[axis].clone()
                        } else {
                            value.clone()
                        };
                        if matches!(field.as_str(), "inSlope" | "outSlope") && value.is_string() {
                            ensure!(
                                matches!(value.as_str(), Some("Infinity" | "-Infinity")),
                                "Invalid stamp animation tangent"
                            );
                            value = Value::Null;
                        }
                        sample.insert(field.clone(), value);
                    }
                    samples.push(Value::Object(sample));
                }
                tracks.push(Track {
                    path: curve["path"]
                        .as_str()
                        .context("Stamp animation path missing")?
                        .into(),
                    property,
                    keys: samples,
                });
            }
        }
    }
    Ok(tracks)
}

struct Builder<'a> {
    env: &'a Unity,
    store: &'a MediaStore,
    rows: BTreeMap<ObjectId, Value>,
    text_slots: Vec<ObjectId>,
    nodes: Vec<Node>,
    media: BTreeMap<String, Value>,
    seen: BTreeSet<ObjectId>,
}
impl Builder<'_> {
    fn visit(&mut self, id: ObjectId, path: String) -> Result<()> {
        ensure!(self.seen.insert(id), "Cycle in stamp hierarchy");
        let go: GameObject = serde_json::from_value(
            self.rows
                .get(&id)
                .context("Stamp GameObject missing")?
                .clone(),
        )?;
        let mut components = Vec::new();
        for component in go.components {
            if let Some(id) = component.component.resolve(self.env, id)? {
                if let Some(row) = self.rows.get(&id) {
                    components.push((id, row.clone()));
                }
            }
        }
        let (transform_id, transform) = components
            .iter()
            .find(|(_, row)| row.get("m_AnchorMin").is_some())
            .context("Stamp RectTransform missing")?;
        let t: RectTransform = serde_json::from_value(transform.clone())?;
        let mut node = Node {
            path: path.clone(),
            active: go.active,
            min: t.anchor_min,
            max: t.anchor_max,
            pos: t.position,
            size: t.size,
            pivot: t.pivot,
            scale: t.scale,
            rotation: t.rotation,
            alpha: None,
            spacing: None,
            color: None,
            slot: None,
            font_size: None,
            alignment: None,
            font: None,
            sprite: None,
            border: None,
        };
        for (owner, row) in &components {
            if let Some(value) = row.get("m_Alpha") {
                node.alpha = Some(value.as_f64().context("Invalid stamp alpha")?);
            }
            if let Some(value) = row.get("m_Spacing") {
                node.spacing = Some(value.clone());
            }
            if row.get("m_Color").is_some() {
                node.color =
                    Some(["r", "g", "b", "a"].map(|c| row["m_Color"][c].as_f64().unwrap_or(0.0)));
            }
            if let Some(slot) = self.text_slots.iter().position(|id| id == owner) {
                node.slot = Some(slot);
                node.font_size = Some(
                    row["m_FontData"]["m_FontSize"]
                        .as_i64()
                        .context("Stamp text size missing")?,
                );
                node.alignment = Some(
                    row["m_FontData"]["m_Alignment"]
                        .as_i64()
                        .context("Stamp text alignment missing")?,
                );
                let names: BTreeSet<_> = components
                    .iter()
                    .filter_map(|(_, row)| {
                        row["_fontName"].as_str().filter(|name| !name.is_empty())
                    })
                    .collect();
                ensure!(
                    names.len() == 1,
                    "Official stamp font binding is not unique"
                );
                node.font = Some(names.first().unwrap().to_string());
            }
            if row.get("m_Sprite").is_some() {
                let sprite = self
                    .env
                    .resolve(*owner, &row["m_Sprite"])?
                    .context("Stamp sprite missing")?;
                let (image, metadata) = media::sprite(self.env, sprite)?;
                ensure!(
                    image.width() == metadata.rect.width.round() as u32
                        && image.height() == metadata.rect.height.round() as u32,
                    "Unexpected trimmed stamp sprite"
                );
                if !self.media.contains_key(&metadata.name) {
                    let file = self.store.image(&image)?;
                    self.media
                        .insert(metadata.name.clone(), json!({"url":file.url}));
                }
                node.sprite = Some(metadata.name);
                match row["m_Type"].as_i64() {
                    Some(1) => {
                        let b = metadata.border;
                        node.border = Some([b.x.into(), b.y.into(), b.z.into(), b.w.into()]);
                    }
                    Some(0) => {}
                    _ => anyhow::bail!("Unsupported stamp sprite mode"),
                }
            }
        }
        self.nodes.push(node);
        for pointer in t.children {
            let id = pointer
                .resolve(self.env, *transform_id)?
                .context("Stamp child transform missing")?;
            let row = self.rows.get(&id).context("Stamp child record missing")?;
            let go = self
                .env
                .resolve(id, &row["m_GameObject"])?
                .context("Stamp child object missing")?;
            let name = self.rows[&go]["m_Name"]
                .as_str()
                .context("Stamp node name missing")?;
            let child_path = if path.is_empty() {
                name.into()
            } else {
                format!("{path}/{name}")
            };
            self.visit(go, child_path)?;
        }
        Ok(())
    }
}

pub fn export(
    env: &Unity,
    store: &MediaStore,
    bundle: &str,
    md5: &str,
    key: &str,
    fonts: &BTreeMap<String, String>,
) -> Result<Asset> {
    ensure!(
        key == "group_location_stamp",
        "Unsupported animated text template: {key}"
    );
    let root = env.container(&format!("dyn/avg/animatetext/{key}.prefab"), 1)?;
    let mut rows = BTreeMap::new();
    let mut clips = BTreeMap::new();
    for object in env
        .studio
        .objects()
        .filter(|o| o.file_index() == root.file && matches!(o.class_id(), 1 | 224 | 114 | 74 | 225))
    {
        let id = ObjectId {
            file: object.file_index(),
            path: object.path_id(),
        };
        let row = env.tree(id)?;
        if object.class_id() == 74 {
            clips.insert(
                row["m_Name"]
                    .as_str()
                    .context("Stamp clip name missing")?
                    .to_owned(),
                tracks(&row)?,
            );
        }
        rows.insert(id, row);
    }
    let views: Vec<_> = rows
        .iter()
        .filter(|(_, row)| row.get("_textArray").is_some())
        .collect();
    ensure!(views.len() == 1, "Animated text view is not unique");
    let (owner, view) = views[0];
    let mut text_slots = Vec::new();
    for pointer in view["_textArray"]
        .as_array()
        .context("Stamp slots missing")?
    {
        text_slots.push(
            env.resolve(*owner, pointer)?
                .context("Stamp text slot reference missing")?,
        );
    }
    let animation = view["_animationName"]
        .as_str()
        .context("Stamp animation name missing")?
        .to_owned();
    let mut builder = Builder {
        env,
        store,
        rows,
        text_slots,
        nodes: Vec::new(),
        media: BTreeMap::new(),
        seen: BTreeSet::new(),
    };
    builder.visit(root, String::new())?;
    for name in builder
        .nodes
        .iter()
        .filter_map(|node| node.font.as_ref())
        .collect::<BTreeSet<_>>()
    {
        let url = fonts
            .get(name)
            .context("Official animated text font missing")?;
        builder
            .media
            .insert(name.clone(), json!({"url":url,"kind":"font"}));
    }
    let profile = Profile {
        nodes: builder.nodes,
        clips,
        animation,
        media: builder.media,
        bundle: bundle.into(),
        md5: md5.into(),
    };
    let bytes = serde_json::to_vec(&profile)?;
    let url = store.bytes(&bytes, "json")?;
    Ok(Asset::Effect(EffectAsset {
        url,
        content: EffectContent::Stamp {
            stamp: serde_json::to_value(profile)?,
        },
    }))
}
