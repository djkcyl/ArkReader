use crate::unity::{ObjectId, Unity};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use unity_rs_core::serialized::{ObjectReference, TypeTree};

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Quaternion {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Pointer {
    #[serde(rename = "m_FileID")]
    pub file: i32,
    #[serde(rename = "m_PathID")]
    pub path: i64,
}
impl Pointer {
    pub fn resolve(self, env: &Unity, from: ObjectId) -> Result<Option<ObjectId>> {
        env.reference(
            from,
            ObjectReference {
                file_id: self.file,
                path_id: self.path,
            },
        )
    }
}
#[derive(Clone, Debug, Deserialize)]
pub struct Component {
    pub component: Pointer,
}
#[derive(Clone, Debug, Deserialize)]
pub struct GameObject {
    #[serde(rename = "m_Name")]
    pub name: String,
    #[serde(rename = "m_Component")]
    pub components: Vec<Component>,
    #[serde(rename = "m_IsActive", default)]
    pub active: bool,
}
#[derive(Clone, Debug, Deserialize)]
pub struct RectTransform {
    #[serde(rename = "m_GameObject")]
    pub game_object: Pointer,
    #[serde(rename = "m_Father")]
    pub father: Pointer,
    #[serde(rename = "m_Children")]
    pub children: Vec<Pointer>,
    #[serde(rename = "m_SizeDelta", default)]
    pub size: Vec2,
    #[serde(rename = "m_Pivot", default)]
    pub pivot: Vec2,
    #[serde(rename = "m_AnchorMin", default)]
    pub anchor_min: Vec2,
    #[serde(rename = "m_AnchorMax", default)]
    pub anchor_max: Vec2,
    #[serde(rename = "m_AnchoredPosition", default)]
    pub position: Vec2,
    #[serde(rename = "m_LocalScale")]
    pub scale: Vec3,
    #[serde(rename = "m_LocalRotation")]
    pub rotation: Quaternion,
    #[serde(rename = "m_LocalPosition")]
    pub local_position: Vec3,
}

pub struct Prefab<'a> {
    pub env: &'a Unity,
    pub objects: BTreeMap<ObjectId, GameObject>,
    pub transforms: BTreeMap<ObjectId, RectTransform>,
    pub by_object: BTreeMap<ObjectId, ObjectId>,
    pub paths: BTreeMap<String, ObjectId>,
    ambiguous_paths: BTreeSet<String>,
    pub root: ObjectId,
    pub size: [f64; 2],
}
impl<'a> Prefab<'a> {
    pub fn new(env: &'a Unity, root: &str, size: Option<[f64; 2]>) -> Result<Self> {
        let root_name = root.split('/').next().context("Empty prefab root")?;
        let owners: BTreeSet<_> = env
            .studio
            .objects()
            .filter(|o| o.class_id() == 1 && o.name() == Some(root_name))
            .map(|o| o.file_index())
            .collect();
        ensure!(
            owners.len() == 1,
            "Official prefab root is not unique: {root}"
        );
        let file = *owners.first().unwrap();
        let mut objects = BTreeMap::new();
        let mut transforms = BTreeMap::new();
        let mut by_object = BTreeMap::new();
        for object in env
            .studio
            .objects()
            .filter(|o| o.file_index() == file && matches!(o.class_id(), 1 | 4 | 224))
        {
            let id = ObjectId {
                file,
                path: object.path_id(),
            };
            if object.class_id() == 1 {
                objects.insert(id, serde_json::from_value(env.tree(id)?)?);
            } else {
                let t: RectTransform = serde_json::from_value(env.tree(id)?)?;
                let go = t
                    .game_object
                    .resolve(env, id)?
                    .context("RectTransform has no GameObject")?;
                by_object.insert(go, id);
                transforms.insert(id, t);
            }
        }
        let mut result = Self {
            env,
            objects,
            transforms,
            by_object,
            paths: BTreeMap::new(),
            ambiguous_paths: BTreeSet::new(),
            root: ObjectId { file, path: 0 },
            size: [0.0; 2],
        };
        for &go in result.by_object.keys() {
            let path = result.path(go)?;
            if path != root && !path.starts_with(&format!("{root}/")) {
                continue;
            }
            if result.paths.insert(path.clone(), go).is_some() {
                result.ambiguous_paths.insert(path);
            }
        }
        ensure!(
            !result.ambiguous_paths.contains(root),
            "Ambiguous official prefab root: {root}"
        );
        result.root = *result
            .paths
            .get(root)
            .with_context(|| format!("Official prefab path missing: {root}"))?;
        let t = &result.transforms[&result.by_object[&result.root]];
        result.size = size.unwrap_or([t.size.x, t.size.y]);
        Ok(result)
    }

    pub fn path(&self, mut go: ObjectId) -> Result<String> {
        let mut parts = Vec::new();
        let mut seen = BTreeSet::new();
        while let Some(object) = self.objects.get(&go) {
            ensure!(seen.insert(go), "Cycle in Unity hierarchy");
            parts.push(object.name.as_str());
            let Some(&transform) = self.by_object.get(&go) else {
                break;
            };
            let Some(parent) = self.transforms[&transform]
                .father
                .resolve(self.env, transform)?
            else {
                break;
            };
            let Some(parent_transform) = self.transforms.get(&parent) else {
                break;
            };
            let Some(parent_go) = parent_transform.game_object.resolve(self.env, parent)? else {
                break;
            };
            go = parent_go;
        }
        parts.reverse();
        Ok(parts.join("/"))
    }

    fn box_inner(&self, id: ObjectId, depth: usize) -> Result<[f64; 4]> {
        ensure!(depth < 128, "Prefab layout exceeds nesting limit");
        if self.by_object[&self.root] == id {
            return Ok([0.0, 0.0, self.size[0], self.size[1]]);
        }
        let t = self
            .transforms
            .get(&id)
            .context("Missing prefab transform")?;
        let parent = t
            .father
            .resolve(self.env, id)?
            .context("Prefab child has no parent")?;
        let p = self.box_inner(parent, depth + 1)?;
        let width = p[2] * (t.anchor_max.x - t.anchor_min.x) + t.size.x;
        let height = p[3] * (t.anchor_max.y - t.anchor_min.y) + t.size.y;
        let x = p[0]
            + p[2] * (t.anchor_min.x + (t.anchor_max.x - t.anchor_min.x) * t.pivot.x)
            + t.position.x
            - width * t.pivot.x;
        let y = p[1]
            + p[3] * (t.anchor_min.y + (t.anchor_max.y - t.anchor_min.y) * t.pivot.y)
            + t.position.y
            - height * t.pivot.y;
        Ok([x, y, width, height])
    }
    pub fn rect(&self, path: &str) -> Result<[f64; 4]> {
        ensure!(
            !self.ambiguous_paths.contains(path),
            "Ambiguous prefab layout path: {path}"
        );
        let go = self.paths.get(path).context("Missing prefab layout path")?;
        let id = self.by_object[go];
        let [x, y, w, h] = self.box_inner(id, 0)?;
        Ok([x, self.size[1] - y - h, w, h])
    }
    pub fn component(
        &self,
        path: &str,
        kind: &str,
        schema: Option<&TypeTree>,
    ) -> Result<(ObjectId, Value)> {
        ensure!(
            !self.ambiguous_paths.contains(path),
            "Ambiguous prefab component path: {path}"
        );
        let go = *self
            .paths
            .get(path)
            .context("Missing prefab component path")?;
        let field = match kind {
            "Image" => "m_Sprite",
            "Text" => "m_FontData",
            "Slider" => "m_HandleRect",
            "Button" => "m_OnClick",
            _ => anyhow::bail!("Unknown UI component type: {kind}"),
        };
        for component in &self.objects[&go].components {
            let Some(id) = component.component.resolve(self.env, go)? else {
                continue;
            };
            if self.env.object(id)?.class_id() != 114 {
                continue;
            }
            if self.env.schema(id).is_ok() {
                let row = self.env.tree(id)?;
                if row.get(field).is_some() {
                    return Ok((id, row));
                }
            } else if self.env.script_name(id)? == kind {
                return Ok((
                    id,
                    self.env.tree_with_schema(
                        id,
                        schema.context("Missing official UI component schema")?,
                    )?,
                ));
            }
        }
        anyhow::bail!("Official prefab component missing: {path}/{kind}")
    }
}
