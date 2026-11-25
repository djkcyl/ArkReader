use anyhow::{ensure, Context, Result};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;
use unity_rs_core::serialized::{ContainerMetadataReadLimits, ObjectReference, TypeTree};
use unity_rs_core::source::Region;
use unity_rs_core::studio::{Studio, StudioObject};
use unity_rs_core::type_tree::TypeTreeReadLimits;

pub fn open(path: &Path) -> Result<Studio> {
    open_many(&[path.to_owned()], CancellationToken::new())
}

pub fn open_many(paths: &[PathBuf], cancelled: CancellationToken) -> Result<Studio> {
    Ok(open_scoped(paths, cancelled)?.0)
}

fn open_scoped(
    paths: &[PathBuf],
    cancelled: CancellationToken,
) -> Result<(Studio, BTreeMap<usize, usize>)> {
    let mut inputs = BTreeMap::new();
    let mut owners = BTreeMap::new();
    for (number, path) in paths.iter().enumerate() {
        let source = Region::from_file(path)?;
        let mut signature = [0u8; 7];
        source.read_exact_at(0, &mut signature)?;
        let entries = if &signature == b"UnityFS" {
            crate::unity_bundle::entries(source, cancelled.clone())?
        } else {
            vec![(
                path.file_name()
                    .context("Missing asset filename")?
                    .to_string_lossy()
                    .into_owned(),
                source,
            )]
        };
        for (name, entry) in entries {
            owners.insert(name.clone(), number);
            ensure!(
                inputs.insert(name, entry).is_none(),
                "Duplicate serialized resource in dependency set"
            );
        }
    }
    let studio =
        Studio::open_regions(inputs).context("Could not read the official Unity resource")?;
    let origins = studio
        .files()
        .filter_map(|file| owners.get(file.path()).map(|&owner| (file.index(), owner)))
        .collect();
    Ok((studio, origins))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ObjectId {
    pub file: usize,
    pub path: i64,
}

pub struct Unity {
    pub studio: Studio,
    pub containers: BTreeMap<String, Vec<ObjectId>>,
    schemas: BTreeMap<(String, i32), TypeTree>,
    pub primary_files: BTreeSet<usize>,
    origins: BTreeMap<usize, String>,
}

impl Unity {
    pub fn open(paths: &[PathBuf], cancelled: CancellationToken) -> Result<Self> {
        let inputs = paths
            .iter()
            .map(|path| {
                (
                    path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    path.clone(),
                )
            })
            .collect::<Vec<_>>();
        Self::open_named(&inputs, cancelled)
    }

    pub fn open_named(inputs: &[(String, PathBuf)], cancelled: CancellationToken) -> Result<Self> {
        let paths = inputs
            .iter()
            .map(|(_, path)| path.clone())
            .collect::<Vec<_>>();
        let (studio, owners) = open_scoped(&paths, cancelled)?;
        let primary_files = owners
            .iter()
            .filter_map(|(&file, &owner)| (owner == 0).then_some(file))
            .collect();
        let origins = owners
            .into_iter()
            .map(|(file, owner)| (file, inputs[owner].0.clone()))
            .collect();
        let mut containers: BTreeMap<String, Vec<ObjectId>> = BTreeMap::new();
        for object in studio.objects().filter(|o| o.class_id() == 142) {
            let metadata = object.read_asset_bundle(ContainerMetadataReadLimits::default())?;
            for entry in metadata.container {
                let Some(target) = unity_rs_core::scene::resolve_object_reference(
                    studio.collection(),
                    object.file_index(),
                    entry.asset,
                )?
                else {
                    continue;
                };
                let id = ObjectId {
                    file: target.file_index,
                    path: target.object.path_id,
                };
                let values = containers.entry(entry.key.to_lowercase()).or_default();
                if !values.contains(&id) {
                    values.push(id);
                }
            }
        }
        Ok(Self {
            studio,
            containers,
            schemas: BTreeMap::new(),
            primary_files,
            origins,
        })
    }

    pub fn object(&self, id: ObjectId) -> Result<StudioObject<'_>> {
        self.studio
            .object(id.file, id.path)
            .context("Missing Unity object")
    }

    pub fn primary_objects(&self) -> impl Iterator<Item = StudioObject<'_>> {
        self.studio
            .objects()
            .filter(|object| self.primary_files.contains(&object.file_index()))
    }

    pub fn origin(&self, id: ObjectId) -> Result<&str> {
        self.origins
            .get(&id.file)
            .map(String::as_str)
            .context("Unity object source is not bound")
    }

    pub fn resolve(&self, from: ObjectId, value: &Value) -> Result<Option<ObjectId>> {
        let reference = ObjectReference {
            file_id: i32::try_from(
                value["m_FileID"]
                    .as_i64()
                    .context("Missing Unity reference file")?,
            )?,
            path_id: value["m_PathID"]
                .as_i64()
                .context("Missing Unity reference object")?,
        };
        Ok(unity_rs_core::scene::resolve_object_reference(
            self.studio.collection(),
            from.file,
            reference,
        )?
        .map(|r| ObjectId {
            file: r.file_index,
            path: r.object.path_id,
        }))
    }

    pub fn tree(&self, id: ObjectId) -> Result<Value> {
        let object = self.object(id)?;
        let file = &self.studio.collection().serialized_files()[id.file].file;
        if object.class_id() == 4 && file.object_type_tree(object.object_index()).is_err() {
            let t = unity_rs_core::scene::read_transform(
                file,
                object.object_index(),
                Default::default(),
            )?;
            let pointer =
                |p: ObjectReference| serde_json::json!({"m_FileID":p.file_id,"m_PathID":p.path_id});
            return Ok(serde_json::json!({
                "m_GameObject":pointer(t.component.game_object),
                "m_Father":pointer(t.father),
                "m_Children":t.children.into_iter().map(pointer).collect::<Vec<_>>(),
                "m_LocalPosition":{"x":t.local_position.x,"y":t.local_position.y,"z":t.local_position.z},
                "m_LocalScale":{"x":t.local_scale.x,"y":t.local_scale.y,"z":t.local_scale.z},
                "m_LocalRotation":{"x":t.local_rotation.x,"y":t.local_rotation.y,"z":t.local_rotation.z,"w":t.local_rotation.w}
            }));
        }
        let schema = file
            .object_type_tree(object.object_index())
            .ok()
            .or_else(|| {
                self.schemas
                    .get(&(file.unity_version_string.clone(), object.class_id()))
            })
            .with_context(|| {
                format!(
                    "Unity object has no bound schema: class {}, object {}",
                    object.class_id(),
                    id.path
                )
            })?;
        self.tree_with_schema(id, schema)
    }

    pub fn field(&self, id: ObjectId, name: &str) -> Result<Value> {
        let object = self.object(id)?;
        let file = &self.studio.collection().serialized_files()[id.file].file;
        let schema = file
            .object_type_tree(object.object_index())
            .ok()
            .or_else(|| {
                self.schemas
                    .get(&(file.unity_version_string.clone(), object.class_id()))
            })
            .context("Unity object has no bound schema")?;
        let value = file.read_type_tree_value_with_tree(
            object.object_index(),
            schema,
            TypeTreeReadLimits {
                maximum_materialized_bytes: 128 * 1024 * 1024,
                ..Default::default()
            },
        )?;
        let unity_rs_core::type_tree::TypeValue::Object(fields) = value else {
            anyhow::bail!("Unity object root is not a record");
        };
        let field = fields
            .into_iter()
            .find(|field| field.name == name)
            .with_context(|| format!("Unity field missing: {name}"))?;
        let mut output = Vec::new();
        unity_rs_core::json::write_type_value_json(&field.value, &mut output, false)?;
        Ok(serde_json::from_slice(&output)?)
    }

    pub fn bind_schemas(&mut self, reference: &Unity) -> Result<()> {
        for object in reference
            .studio
            .objects()
            .filter(|object| object.class_id() != 114)
        {
            let file = &reference.studio.collection().serialized_files()[object.file_index()].file;
            if let Ok(schema) = file.object_type_tree(object.object_index()) {
                let key = (file.unity_version_string.clone(), object.class_id());
                if let Some(previous) = self.schemas.get(&key) {
                    ensure!(
                        previous.nodes == schema.nodes,
                        "Conflicting builtin Unity schema"
                    );
                } else {
                    self.schemas.insert(key, schema.clone());
                }
            }
        }
        Ok(())
    }

    pub fn schema(&self, id: ObjectId) -> Result<&TypeTree> {
        let object = self.object(id)?;
        Ok(self.studio.collection().serialized_files()[id.file]
            .file
            .object_type_tree(object.object_index())?)
    }

    pub fn schema_with_field(&self, class_id: i32, field: &str) -> Result<TypeTree> {
        for object in self
            .studio
            .objects()
            .filter(|object| object.class_id() == class_id)
        {
            let id = ObjectId {
                file: object.file_index(),
                path: object.path_id(),
            };
            if let Ok(schema) = self.schema(id) {
                if schema
                    .nodes
                    .iter()
                    .any(|node| node.level == 1 && node.field_name == field)
                {
                    return Ok(schema.clone());
                }
            }
        }
        anyhow::bail!("Official schema missing: {class_id}/{field}")
    }

    pub fn tree_with_schema(&self, id: ObjectId, schema: &TypeTree) -> Result<Value> {
        let object = self.object(id)?;
        let file = &self.studio.collection().serialized_files()[id.file].file;
        let value = file.read_type_tree_value_with_tree(
            object.object_index(),
            schema,
            TypeTreeReadLimits {
                maximum_materialized_bytes: 128 * 1024 * 1024,
                ..Default::default()
            },
        )?;
        let mut output = Vec::new();
        unity_rs_core::json::write_type_value_json(&value, &mut output, false)?;
        Ok(serde_json::from_slice(&output)?)
    }

    pub fn reference(
        &self,
        from: ObjectId,
        reference: ObjectReference,
    ) -> Result<Option<ObjectId>> {
        Ok(unity_rs_core::scene::resolve_object_reference(
            self.studio.collection(),
            from.file,
            reference,
        )?
        .map(|r| ObjectId {
            file: r.file_index,
            path: r.object.path_id,
        }))
    }

    pub fn script_name(&self, id: ObjectId) -> Result<String> {
        let object = self.object(id)?;
        let file = &self.studio.collection().serialized_files()[id.file].file;
        let header = unity_rs_core::monobehaviour::read_mono_behaviour(
            file,
            object.object_index(),
            Default::default(),
        )?;
        let script = self
            .reference(
                id,
                ObjectReference {
                    file_id: header.script.file_id,
                    path_id: header.script.path_id,
                },
            )?
            .context("MonoBehaviour has no script")?;
        Ok(self
            .object(script)?
            .read_mono_script(Default::default())?
            .class_name)
    }

    pub fn text(&self, path: &str) -> Result<Vec<u8>> {
        let id = self.container(path, 49)?;
        let object = self.object(id)?;
        ensure!(
            object.class_id() == 49,
            "Official text route resolves to another object type"
        );
        Ok(object.read_text_bytes(128 * 1024 * 1024)?)
    }

    pub fn container(&self, path: &str, class: i32) -> Result<ObjectId> {
        let candidates = self
            .containers
            .get(&path.to_lowercase())
            .context("Official container missing")?;
        let matches: Vec<_> = candidates
            .iter()
            .filter(|&&id| self.object(id).is_ok_and(|o| o.class_id() == class))
            .copied()
            .collect();
        ensure!(
            matches.len() == 1,
            "Official container is missing or ambiguous for class {class}: {path}"
        );
        Ok(matches[0])
    }
}
