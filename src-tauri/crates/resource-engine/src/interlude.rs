use crate::{
    materials,
    media::{self, Asset, EffectAsset, EffectContent, MediaStore},
    prefab::{GameObject, RectTransform},
    stamp,
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const SUPPORTED: [&str; 5] = [
    "group_interclude_vertical_common",
    "ui_cutin_mask_vertical",
    "ui_cutin_mask_horizon",
    "group_interclude_square_common",
    "interlude_dialog_left",
];

pub fn font_names(env: &Unity, key: &str) -> Result<BTreeSet<String>> {
    if key != "group_interclude_square_common" {
        return Ok(BTreeSet::new());
    }
    let root = env.container(&format!("dyn/avg/[uc]common/masktemplate/{key}.prefab"), 1)?;
    let go: GameObject = serde_json::from_value(env.tree(root)?)?;
    for component in go.components {
        let Some(id) = component.component.resolve(env, root)? else {
            continue;
        };
        let row = env.tree(id)?;
        if row.get("_imgMask").is_none() {
            continue;
        }
        let deco = env
            .resolve(id, &row["_decoPrefab"])?
            .context("Interlude caption decoration missing")?;
        let go: GameObject = serde_json::from_value(env.tree(deco)?)?;
        for component in go.components {
            let Some(id) = component.component.resolve(env, deco)? else {
                continue;
            };
            let row = env.tree(id)?;
            if row.get("_text").is_none() {
                continue;
            }
            let text = env
                .resolve(id, &row["_text"])?
                .context("Interlude caption missing")?;
            let row = env.tree(text)?;
            let owner = env
                .resolve(text, &row["m_GameObject"])?
                .context("Interlude caption owner missing")?;
            let go: GameObject = serde_json::from_value(env.tree(owner)?)?;
            let mut names = BTreeSet::new();
            for component in go.components {
                if let Some(id) = component.component.resolve(env, owner)? {
                    let row = env.tree(id)?;
                    if let Some(name) = row["_fontName"].as_str() {
                        names.insert(name.into());
                    }
                }
            }
            ensure!(
                names.len() == 1,
                "Interlude caption font binding is not unique"
            );
            return Ok(names);
        }
    }
    anyhow::bail!("Official interlude caption font missing")
}
fn color(value: &Value) -> Result<[f64; 4]> {
    Ok([
        value["r"].as_f64().context("Missing color R")?,
        value["g"].as_f64().context("Missing color G")?,
        value["b"].as_f64().context("Missing color B")?,
        value["a"].as_f64().context("Missing color A")?,
    ])
}
fn truth(value: &Value) -> bool {
    value
        .as_bool()
        .unwrap_or_else(|| value.as_i64().is_some_and(|n| n != 0))
}

struct Builder<'a> {
    env: &'a Unity,
    store: &'a MediaStore,
    rows: BTreeMap<ObjectId, Value>,
    transforms: BTreeMap<ObjectId, ObjectId>,
    textures: BTreeMap<String, Value>,
    sprites: BTreeMap<String, Value>,
    materials: BTreeMap<String, Value>,
    dialog: bool,
    char_image: Option<ObjectId>,
    visiting: BTreeSet<ObjectId>,
}
impl Builder<'_> {
    fn texture(&mut self, id: ObjectId) -> Result<String> {
        let key = id.path.to_string();
        if !self.textures.contains_key(&key) {
            let settings = self.env.field(id, "m_TextureSettings")?;
            let filter = settings["m_FilterMode"]
                .as_i64()
                .context("Missing texture filter")?;
            let u = settings["m_WrapU"]
                .as_i64()
                .context("Missing texture U sampler")?;
            let v = settings["m_WrapV"]
                .as_i64()
                .context("Missing texture V sampler")?;
            ensure!(
                [0, 1].contains(&filter) && [0, 1].contains(&u) && [0, 1].contains(&v),
                "Unsupported interlude texture sampler"
            );
            let file = self.store.image(&media::texture(self.env, id)?)?;
            self.textures.insert(key.clone(),json!({"url":file.url,"width":file.width,"height":file.height,"filter":filter,"wrapU":u,"wrapV":v}));
        }
        Ok(key)
    }
    fn sprite(&mut self, owner: ObjectId, pointer: &Value) -> Result<String> {
        ensure!(pointer["m_FileID"] == 0, "External interlude sprite");
        let id = self
            .env
            .resolve(owner, pointer)?
            .context("Interlude sprite missing")?;
        let key = id.path.to_string();
        if !self.sprites.contains_key(&key) {
            let s = self.env.object(id)?.read_sprite(Default::default())?;
            ensure!(
                s.render_data.texture.file_id == 0 && s.render_data.alpha_texture.path_id == 0,
                "Unsupported interlude texture dependency"
            );
            let texture = media::texture_id(self.env, id, &s)?;
            let texture = self.texture(texture)?;
            let r = s.render_data.texture_rect;
            let o = s.render_data.texture_rect_offset;
            let b = s.border;
            self.sprites.insert(
                key.clone(),
                json!({
                    "texture":texture,
                    "rect":{"x":r.x,"y":r.y,"width":r.width,"height":r.height},
                    "size":[s.rect.width,s.rect.height],
                    "offset":[o.x,o.y],
                    "border":[b.x,b.y,b.z,b.w],
                    "ppu":s.pixels_to_units
                }),
            );
        }
        Ok(key)
    }
    fn material(&mut self, owner: ObjectId, pointer: &Value) -> Result<Option<String>> {
        let Some(id) = self.env.resolve(owner, pointer)? else {
            return Ok(None);
        };
        ensure!(pointer["m_FileID"] == 0, "External interlude material");
        let key = id.path.to_string();
        if !self.materials.contains_key(&key) {
            let row = self.env.tree(id)?;
            let props = &row["m_SavedProperties"];
            let shader = self
                .env
                .resolve(id, &row["m_Shader"])?
                .context("Interlude shader missing")?;
            let shader = self.env.field(shader, "m_ParsedForm")?;
            ensure!(
                shader["m_Name"] == "Torappu/UI/DoubleDissolve"
                    && row["m_ValidKeywords"].as_array().is_some_and(Vec::is_empty),
                "Unsupported interlude shader variant"
            );
            let mut textures = BTreeMap::new();
            for (name, value) in materials::map(&props["m_TexEnvs"])? {
                ensure!(
                    value["m_Texture"]["m_FileID"] == 0,
                    "External interlude material texture"
                );
                let texture = if let Some(texture) = self.env.resolve(id, &value["m_Texture"])? {
                    Some(self.texture(texture)?)
                } else {
                    None
                };
                textures.insert(name,json!({"texture":texture,"st":[value["m_Scale"]["x"],value["m_Scale"]["y"],value["m_Offset"]["x"],value["m_Offset"]["y"]]}));
            }
            let colors = materials::map(&props["m_Colors"])?
                .into_iter()
                .map(|(k, v)| Ok((k, color(&v)?)))
                .collect::<Result<BTreeMap<_, _>>>()?;
            self.materials.insert(key.clone(),json!({
                "shader":"ui-dual-dissolve",
                "shaderId":row["m_Shader"]["m_PathID"].as_i64().context("Shader identity missing")?.to_string(),
                "floats":materials::map(&props["m_Floats"])?,
                "colors":colors,
                "textures":textures
            }));
        }
        Ok(Some(key))
    }
    fn node(&mut self, go: ObjectId) -> Result<Value> {
        ensure!(self.visiting.insert(go), "Cycle in interlude hierarchy");
        let g: GameObject = serde_json::from_value(
            self.rows
                .get(&go)
                .context("Interlude object missing")?
                .clone(),
        )?;
        let transform = *self
            .transforms
            .get(&go)
            .context("Interlude transform missing")?;
        let mut t = self.rows[&transform].clone();
        let mut components = Vec::new();
        let mut layout = serde_json::Map::new();
        for component in &g.components {
            let Some(id) = component.component.resolve(self.env, go)? else {
                continue;
            };
            let d = self.rows.get(&id).cloned().unwrap_or_else(|| json!({}));
            if Some(id) == self.char_image {
                components.push(json!({"kind":"dialog-portrait"}));
            } else if d.get("_targetMesh").is_some() {
                ensure!(
                    self.dialog
                        && d["_targetTexture"]["m_PathID"] == 0
                        && truth(&d["_matchRect"])
                        && truth(&d["_matchByWidth"])
                        && d["_targetRotation"]
                            .as_object()
                            .is_some_and(|r| r.values().all(|v| v.as_f64() == Some(0.0))),
                    "Unsupported interlude mesh image"
                );
                let mesh = self
                    .env
                    .resolve(id, &d["_targetMesh"])?
                    .context("Interlude mesh missing")?;
                let geometry = self.env.object(mesh)?.read_mesh(Default::default())?;
                let bounds = self.env.field(mesh, "m_LocalAABB")?;
                let extent = &bounds["m_Extent"];
                let width = extent["x"]
                    .as_f64()
                    .context("Interlude mesh width missing")?
                    * 2.0;
                ensure!(width > 0.0, "Empty interlude mesh bounds");
                let scale = t["m_SizeDelta"]["x"]
                    .as_f64()
                    .context("Interlude width missing")?
                    / width;
                let points = geometry
                    .mesh
                    .vertices
                    .iter()
                    .map(|v| [v[0] as f64 * scale, -(v[1] as f64) * scale])
                    .collect::<Vec<_>>();
                let triangles = geometry
                    .mesh
                    .sub_meshes
                    .iter()
                    .flat_map(|s| {
                        s.indices
                            .as_chunks::<3>()
                            .0
                            .iter()
                            .map(|v| [v[0], v[1], v[2]])
                    })
                    .collect::<Vec<_>>();
                components.push(json!({"kind":"mesh-mask","points":points,"triangles":triangles}));
                t["m_SizeDelta"]["y"] = json!(
                    extent["y"]
                        .as_f64()
                        .context("Interlude mesh height missing")?
                        * 2.0
                        * scale
                );
            } else if let Some(alpha) = d.get("m_Alpha") {
                layout.insert("alpha".into(), alpha.clone());
            } else if d.get("m_Sprite").is_some() {
                ensure!(
                    matches!(d["m_Type"].as_i64(), Some(0 | 1))
                        && !truth(&d["m_PreserveAspect"])
                        && !truth(&d["m_UseSpriteMesh"]),
                    "Unsupported interlude image geometry"
                );
                if d["m_Sprite"]["m_PathID"] != 0 {
                    let sprite = self.sprite(id, &d["m_Sprite"])?;
                    let material = self.material(id, &d["m_Material"])?;
                    components.push(json!({"kind":"image","sprite":sprite,"material":material,"color":color(&d["m_Color"])?,"sliced":d["m_Type"]==1}));
                } else {
                    ensure!(
                        d["m_Material"]["m_PathID"] == 0,
                        "Unbound interlude material"
                    );
                    components.push(json!({"kind":"solid","color":color(&d["m_Color"])?}));
                }
            } else if d.get("m_FontData").is_some() {
                let font = &d["m_FontData"];
                ensure!(
                    font["m_Alignment"] == 3
                        && font["m_FontSize"] == 18
                        && !truth(&font["m_RichText"]),
                    "Unsupported interlude label layout"
                );
                components.push(
                    json!({"kind":"label","size":font["m_FontSize"],"color":color(&d["m_Color"])?}),
                );
            } else if d.get("m_Spacing").is_some() {
                ensure!(
                    d["m_ChildAlignment"] == 3
                        && truth(&d["m_ChildControlWidth"])
                        && !truth(&d["m_ChildControlHeight"])
                        && !truth(&d["m_ChildForceExpandWidth"])
                        && !truth(&d["m_ReverseArrangement"]),
                    "Unsupported interlude label group"
                );
                layout.insert("row".into(),json!({"left":d["m_Padding"]["m_Left"],"right":d["m_Padding"]["m_Right"],"spacing":d["m_Spacing"]}));
            } else if d.get("m_IgnoreLayout").is_some() {
                layout.insert("ignore".into(), json!(truth(&d["m_IgnoreLayout"])));
                layout.insert("preferredWidth".into(), d["m_PreferredWidth"].clone());
                layout.insert("minWidth".into(), d["m_MinWidth"].clone());
            } else if d.get("_colorPoints").is_some() {
                ensure!(
                    !truth(&d["_useGradient"]) && d["_tapeDirection"] == 0,
                    "Unsupported interlude gradient"
                );
                components.push(json!({"kind":"gradient","color":color(&d["m_Color"])?,"points":d["_colorPoints"]}));
            } else if d.get("_writeChannel").is_some() && d.get("_blockRaycast").is_some() {
                components.push(
                    json!({"kind":"mask","write":d["_writeChannel"],"colorMask":d["_colorMask"]}),
                );
            } else if truth(&d["_readChannel"]) {
                components.push(json!({"kind":"read-mask"}));
            }
        }
        let transform_value = Value::Object(
            [
                "m_AnchorMin",
                "m_AnchorMax",
                "m_AnchoredPosition",
                "m_SizeDelta",
                "m_Pivot",
                "m_LocalScale",
                "m_LocalRotation",
            ]
            .into_iter()
            .map(|k| (k.into(), t[k].clone()))
            .collect(),
        );
        let parsed: RectTransform = serde_json::from_value(t)?;
        let mut children = Vec::new();
        for child in parsed.children {
            let id = child
                .resolve(self.env, transform)?
                .context("Interlude child transform missing")?;
            let go = self
                .env
                .resolve(id, &self.rows[&id]["m_GameObject"])?
                .context("Interlude child owner missing")?;
            children.push(self.node(go)?);
        }
        let mut result = json!({"id":go.path.to_string(),"name":g.name,"active":g.active,"transform":transform_value,"components":components,"children":children});
        result.as_object_mut().unwrap().extend(layout);
        self.visiting.remove(&go);
        Ok(result)
    }
}

fn bind_paths(node: &Value, path: &str, result: &mut BTreeMap<String, String>) -> Result<()> {
    let id = node["id"]
        .as_str()
        .context("Interlude node identity missing")?;
    ensure!(
        result.insert(path.into(), id.into()).is_none(),
        "Ambiguous interlude animation target"
    );
    for child in node["children"]
        .as_array()
        .context("Interlude children missing")?
    {
        let name = child["name"]
            .as_str()
            .context("Interlude child name missing")?;
        let next = if path.is_empty() {
            name.into()
        } else {
            format!("{path}/{name}")
        };
        bind_paths(child, &next, result)?;
    }
    Ok(())
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
        SUPPORTED.contains(&key),
        "Unsupported interlude mask template: {key}"
    );
    let root = env.container(&format!("dyn/avg/[uc]common/masktemplate/{key}.prefab"), 1)?;
    let mut rows = BTreeMap::new();
    let mut transforms = BTreeMap::new();
    for object in env.studio.objects().filter(|o| {
        o.file_index() == root.file && matches!(o.class_id(), 1 | 224 | 114 | 21 | 74 | 225 | 111)
    }) {
        let id = ObjectId {
            file: object.file_index(),
            path: object.path_id(),
        };
        let row = env.tree(id)?;
        if object.class_id() == 224 {
            transforms.insert(
                env.resolve(id, &row["m_GameObject"])?
                    .context("Interlude transform owner missing")?,
                id,
            );
        }
        rows.insert(id, row);
    }
    let go: GameObject = serde_json::from_value(rows[&root].clone())?;
    let mut template = None;
    let mut animations = Vec::new();
    for component in go.components {
        let Some(id) = component.component.resolve(env, root)? else {
            continue;
        };
        if let Some(row) = rows.get(&id) {
            if row.get("_imgMask").is_some() {
                ensure!(template.is_none(), "Ambiguous interlude template");
                template = Some((id, row.clone()));
            }
            if env.object(id)?.class_id() == 111 {
                animations.push((id, row.clone()));
            }
        }
    }
    let (owner, template) = template.context("Interlude template component missing")?;
    let dialog = template.get("_dialogGroup").is_some();
    let char_image = if dialog {
        env.resolve(owner, &template["_charImage"])?
    } else {
        None
    };
    let animated = template["_animWrapper"]["m_PathID"] != 0;
    if animated
        || template["_animLocs"]
            .as_array()
            .is_some_and(|v| !v.is_empty())
    {
        ensure!(
            key == "ui_cutin_mask_horizon"
                && !animations.is_empty()
                && animations
                    .iter()
                    .all(|(_, row)| !truth(&row["m_PlayAutomatically"])),
            "Unsupported interlude template animation"
        );
    }
    let mut b = Builder {
        env,
        store,
        rows,
        transforms,
        textures: BTreeMap::new(),
        sprites: BTreeMap::new(),
        materials: BTreeMap::new(),
        dialog,
        char_image,
        visiting: BTreeSet::new(),
    };
    let tree = b.node(root)?;
    let scale = env.resolve(owner, &template["_scaleTrans"])?;
    let scale_node = if let Some(scale) = scale {
        env.resolve(scale, &b.rows[&scale]["m_GameObject"])?
            .context("Interlude scale node missing")?
    } else {
        root
    };
    let scale_transform = scale.unwrap_or(b.transforms[&root]);
    let mut profile = json!({
        "kind":"interlude-template-v1",
        "name":key,
        "template":tree,
        "scaleNode":scale_node.path.to_string(),
        "emptyNode":template["_emptyImg"]["m_PathID"].as_i64().context("Interlude empty node missing")?.to_string(),
        "initialScale":[b.rows[&scale_transform]["m_LocalScale"]["x"],b.rows[&scale_transform]["m_LocalScale"]["y"]],
        "evidence":{"bundle":bundle,"md5":md5,"root":root.path.to_string()}
    });
    if dialog {
        let group = env
            .resolve(owner, &template["_dialogGroup"])?
            .context("Interlude dialog group missing")?;
        let group = env
            .resolve(group, &b.rows[&group]["m_GameObject"])?
            .context("Interlude dialog owner missing")?;
        let go: GameObject = serde_json::from_value(b.rows[&group].clone())?;
        let mut animation = None;
        for component in go.components {
            let Some(id) = component.component.resolve(env, group)? else {
                continue;
            };
            if env.object(id)?.class_id() == 111 {
                animation = Some((id, b.rows[&id].clone()));
                break;
            }
        }
        let (id, animation) = animation.context("Dialog intro animation missing")?;
        let clip = env
            .resolve(id, &animation["m_Animation"])?
            .context("Dialog intro clip missing")?;
        let clip = &b.rows[&clip];
        let tracks = stamp::tracks(clip)?;
        let mut paths = BTreeMap::new();
        let group_node = profile["template"]["children"]
            .as_array()
            .context("Dialog children missing")?
            .iter()
            .find(|n| n["id"].as_str() == Some(&group.path.to_string()))
            .context("Dialog group node missing")?;
        bind_paths(group_node, "", &mut paths)?;
        let properties = [
            "m_AnchoredPosition.x",
            "m_Alpha",
            "scale.x",
            "scale.y",
            "scale.z",
            "rotation.x",
            "rotation.y",
            "rotation.z",
            "rotation.w",
        ];
        ensure!(
            !truth(&animation["m_PlayAutomatically"])
                && tracks.iter().all(|t| paths.contains_key(&t.path)
                    && properties.contains(&t.property.as_str())
                    && (!matches!(t.property.as_str(), "rotation.x" | "rotation.y")
                        || t.keys.iter().all(|k| k["value"].as_f64() == Some(0.0)))),
            "Unsupported dialog intro bindings"
        );
        let portrait = char_image.context("Dialog portrait missing")?;
        let portrait = env
            .resolve(portrait, &b.rows[&portrait]["m_GameObject"])?
            .context("Dialog portrait owner missing")?;
        let bg = env
            .resolve(owner, &template["_charBackgroundImage"])?
            .context("Dialog background missing")?;
        let bg = env
            .resolve(bg, &b.rows[&bg]["m_GameObject"])?
            .context("Dialog background owner missing")?;
        profile["dialog"] = json!({"group":group.path.to_string(),"portrait":portrait.path.to_string(),"background":bg.path.to_string()});
        let tracks = tracks
            .into_iter()
            .map(|t| {
                let node = paths[&t.path].clone();
                let mut value = serde_json::to_value(t)?;
                value["node"] = node.into();
                Ok(value)
            })
            .collect::<Result<Vec<_>>>()?;
        profile["intro"] = json!({
            "name":clip["m_Name"],
            "duration":clip["m_MuscleClip"]["m_StopTime"].as_f64().context("Intro end missing")?-clip["m_MuscleClip"]["m_StartTime"].as_f64().context("Intro start missing")?,
            "tracks":tracks
        });
    }
    if animated {
        let name = template["_animLocs"][0]["animationName"]
            .as_str()
            .context("Interlude intro name missing")?;
        let mut clip = None;
        for (id, animation) in &animations {
            for pointer in animation["m_Animations"]
                .as_array()
                .context("Interlude animation clips missing")?
            {
                let target = env
                    .resolve(*id, pointer)?
                    .context("Interlude animation clip missing")?;
                let row = &b.rows[&target];
                if row["m_Name"].as_str() == Some(name) {
                    clip = Some(row);
                }
            }
        }
        let clip = clip.context("Interlude intro clip missing")?;
        let tracks = stamp::tracks(clip)?;
        let mut paths = BTreeMap::new();
        bind_paths(&profile["template"], "", &mut paths)?;
        ensure!(
            clip["m_PositionCurves"]
                .as_array()
                .is_some_and(Vec::is_empty)
                && clip["m_PPtrCurves"].as_array().is_some_and(Vec::is_empty)
                && tracks.iter().all(|t| paths.contains_key(&t.path)
                    && ["scale.x", "scale.y", "scale.z"].contains(&t.property.as_str())),
            "Unsupported interlude intro binding"
        );
        let tracks = tracks
            .into_iter()
            .map(|t| {
                let node = paths[&t.path].clone();
                let mut value = serde_json::to_value(t)?;
                value["node"] = node.into();
                Ok(value)
            })
            .collect::<Result<Vec<_>>>()?;
        profile["intro"] = json!({"name":clip["m_Name"],"tracks":tracks});
    }
    if let Some(deco) = env.resolve(owner, &template["_decoPrefab"])? {
        let go: GameObject = serde_json::from_value(b.rows[&deco].clone())?;
        let components = go
            .components
            .iter()
            .filter_map(|c| c.component.resolve(env, deco).transpose())
            .collect::<Result<Vec<_>>>()?;
        let toggle = components
            .iter()
            .filter_map(|id| b.rows.get(id))
            .find(|row| row.get("_select").is_some())
            .context("Interlude selection component missing")?;
        let selected = toggle["_select"]["m_PathID"]
            .as_i64()
            .context("Selected interlude node missing")?
            .to_string();
        let unselected = toggle["_unselect"]["m_PathID"]
            .as_i64()
            .context("Unselected interlude node missing")?
            .to_string();
        profile["deco"] = b.node(deco)?;
        profile["selectedNode"] = selected.into();
        profile["unselectedNode"] = unselected.into();
        if key == "group_interclude_square_common" {
            let (owner, row) = components
                .iter()
                .filter_map(|id| b.rows.get(id).map(|row| (*id, row)))
                .find(|(_, row)| row.get("_text").is_some())
                .context("Interlude caption binding missing")?;
            let text = env
                .resolve(owner, &row["_text"])?
                .context("Interlude caption missing")?;
            let label = env
                .resolve(text, &b.rows[&text]["m_GameObject"])?
                .context("Interlude caption owner missing")?;
            let go: GameObject = serde_json::from_value(b.rows[&label].clone())?;
            let mut names = BTreeSet::new();
            for component in go.components {
                if let Some(id) = component.component.resolve(env, label)? {
                    if let Some(name) = b.rows.get(&id).and_then(|row| row["_fontName"].as_str()) {
                        names.insert(name.to_owned());
                    }
                }
            }
            ensure!(names.len() == 1, "Interlude caption font is not unique");
            let name = names.first().unwrap();
            profile["fontName"] = name.clone().into();
            profile["font"] =
                json!({"url":fonts.get(name).context("Official caption font missing")?});
        }
    }
    profile["textures"] = serde_json::to_value(b.textures)?;
    profile["sprites"] = serde_json::to_value(b.sprites)?;
    profile["materials"] = serde_json::to_value(b.materials)?;
    let url = store.bytes(&serde_json::to_vec(&profile)?, "json")?;
    Ok(Asset::Effect(EffectAsset {
        url,
        content: EffectContent::Interlude { interlude: profile },
    }))
}
