use crate::{
    prefab::Pointer,
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub fn number(value: &Value) -> Result<f64> {
    value.as_f64().context("Native effect number missing")
}
pub fn integer(value: &Value) -> Result<i64> {
    value.as_i64().context("Native effect integer missing")
}
pub fn truth(value: &Value) -> bool {
    value
        .as_bool()
        .unwrap_or_else(|| value.as_f64().is_some_and(|v| v != 0.0))
}
pub fn array(value: &Value) -> Result<&Vec<Value>> {
    value.as_array().context("Native effect array missing")
}
pub fn vec3(value: &Value) -> Result<[f64; 3]> {
    Ok([
        number(&value["x"])?,
        number(&value["y"])?,
        number(&value["z"])?,
    ])
}
pub fn color(value: &Value) -> Result<[f64; 4]> {
    Ok([
        number(&value["r"])?,
        number(&value["g"])?,
        number(&value["b"])?,
        number(&value["a"])?,
    ])
}
pub fn select(value: &Value, fields: &[&str]) -> Result<Value> {
    Ok(Value::Object(
        fields
            .iter()
            .map(|&key| {
                Ok((
                    key.into(),
                    value
                        .get(key)
                        .with_context(|| format!("Native field missing: {key}"))?
                        .clone(),
                ))
            })
            .collect::<Result<_>>()?,
    ))
}
pub fn held_tangents(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if matches!(key.as_str(), "inSlope" | "outSlope")
                    && matches!(child.as_str(), Some("Infinity" | "-Infinity"))
                {
                    *child = Value::Null;
                } else {
                    held_tangents(child);
                }
            }
        }
        Value::Array(values) => {
            for child in values {
                held_tangents(child);
            }
        }
        _ => {}
    }
}

pub struct Scene<'a> {
    pub env: &'a Unity,
    pub root: ObjectId,
    pub rows: BTreeMap<ObjectId, Value>,
    pub transforms: BTreeMap<ObjectId, ObjectId>,
}
impl<'a> Scene<'a> {
    pub fn load(env: &'a Unity, prefab: &str) -> Result<Self> {
        let root = env.container(prefab, 1)?;
        let mut all = BTreeMap::new();
        let mut transforms = BTreeMap::new();
        for object in env.studio.objects().filter(|o| {
            o.file_index() == root.file
                && matches!(
                    o.class_id(),
                    1 | 4 | 224 | 198 | 199 | 21 | 114 | 33 | 23 | 96 | 95 | 91 | 74
                )
        }) {
            let id = ObjectId {
                file: object.file_index(),
                path: object.path_id(),
            };
            let row = env.tree(id)?;
            if matches!(object.class_id(), 4 | 224) {
                transforms.insert(
                    env.resolve(id, &row["m_GameObject"])?
                        .context("Effect transform owner missing")?,
                    id,
                );
            }
            all.insert(id, row);
        }
        ensure!(
            transforms.contains_key(&root),
            "Effect root transform missing"
        );
        let mut scene = Self {
            env,
            root,
            rows: all,
            transforms,
        };
        let mut selected = BTreeMap::new();
        for (&id, row) in &scene.rows {
            let object = env.object(id)?;
            let owner = if object.class_id() == 1 {
                Some(id)
            } else if row.get("m_GameObject").is_some() {
                env.resolve(id, &row["m_GameObject"])?
            } else {
                None
            };
            if owner
                .map(|go| scene.belongs(go))
                .transpose()?
                .unwrap_or(true)
            {
                selected.insert(id, row.clone());
            }
        }
        scene.rows = selected;
        scene
            .transforms
            .retain(|go, t| scene.rows.contains_key(go) && scene.rows.contains_key(t));
        Ok(scene)
    }
    pub fn kind(&self, id: ObjectId) -> Result<i32> {
        Ok(self.env.object(id)?.class_id())
    }
    pub fn owner(&self, id: ObjectId) -> Result<ObjectId> {
        self.env
            .resolve(
                id,
                &self.rows.get(&id).context("Effect component missing")?["m_GameObject"],
            )?
            .context("Effect component owner missing")
    }
    pub fn resolve(&self, owner: ObjectId, pointer: &Value) -> Result<Option<ObjectId>> {
        self.env.resolve(owner, pointer)
    }
    pub fn require(&self, owner: ObjectId, pointer: &Value) -> Result<ObjectId> {
        self.resolve(owner, pointer)?
            .context("Effect reference is null")
    }
    pub fn key(&self, id: ObjectId) -> String {
        id.path.to_string()
    }
    pub fn belongs(&self, mut go: ObjectId) -> Result<bool> {
        let mut seen = BTreeSet::new();
        while let Some(&t) = self.transforms.get(&go) {
            if go == self.root {
                return Ok(true);
            }
            ensure!(seen.insert(go), "Cycle in effect hierarchy");
            let Some(parent) = self.resolve(t, &self.rows[&t]["m_Father"])? else {
                return Ok(false);
            };
            let Some(row) = self.rows.get(&parent) else {
                return Ok(false);
            };
            go = self.require(parent, &row["m_GameObject"])?;
        }
        Ok(false)
    }
    pub fn chain(&self, mut go: ObjectId) -> Result<Vec<Value>> {
        let mut result = Vec::new();
        let mut seen = BTreeSet::new();
        while let Some(&t) = self.transforms.get(&go) {
            ensure!(seen.insert(go), "Cycle in effect transform chain");
            let row = &self.rows[&t];
            result.push(json!({
                "key":go.path.to_string(),
                "activeSelf":truth(&self.rows[&go]["m_IsActive"]),
                "m_LocalPosition":row["m_LocalPosition"],
                "m_LocalRotation":row["m_LocalRotation"],
                "m_LocalScale":row["m_LocalScale"]
            }));
            let Some(parent) = self.resolve(t, &row["m_Father"])? else {
                break;
            };
            let Some(row) = self.rows.get(&parent) else {
                break;
            };
            go = self.require(parent, &row["m_GameObject"])?;
        }
        result.reverse();
        Ok(result)
    }
    pub fn path(&self, mut go: ObjectId, root: ObjectId) -> Result<String> {
        let mut parts = Vec::new();
        let mut seen = BTreeSet::new();
        while go != root {
            ensure!(seen.insert(go), "Cycle in effect animation path");
            parts.push(
                self.rows[&go]["m_Name"]
                    .as_str()
                    .context("Effect object name missing")?,
            );
            let &t = self
                .transforms
                .get(&go)
                .context("Effect animation transform missing")?;
            let parent = self.require(t, &self.rows[&t]["m_Father"])?;
            go = self.require(
                parent,
                &self
                    .rows
                    .get(&parent)
                    .context("Effect animation path escapes root")?["m_GameObject"],
            )?;
        }
        parts.reverse();
        Ok(parts.join("/"))
    }
    pub fn components(&self, go: ObjectId) -> Result<Vec<ObjectId>> {
        array(&self.rows[&go]["m_Component"])?
            .iter()
            .filter_map(|row| {
                serde_json::from_value::<Pointer>(row["component"].clone())
                    .map_err(anyhow::Error::from)
                    .and_then(|p| p.resolve(self.env, go))
                    .transpose()
            })
            .collect()
    }
    pub fn by_kind(&self, kind: i32) -> impl Iterator<Item = (ObjectId, &Value)> {
        self.rows.iter().filter_map(move |(&id, row)| {
            self.env
                .object(id)
                .ok()
                .filter(|o| o.class_id() == kind)
                .map(|_| (id, row))
        })
    }
    pub fn insert(&mut self, id: ObjectId) -> Result<()> {
        if !self.rows.contains_key(&id) {
            ensure!(
                !self
                    .rows
                    .keys()
                    .any(|key| key.path == id.path && key.file != id.file),
                "Ambiguous effect object identity"
            );
            self.rows.insert(id, self.env.tree(id)?);
        }
        Ok(())
    }
}
