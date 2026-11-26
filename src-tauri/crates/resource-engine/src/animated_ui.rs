mod layout;

use crate::{
    effects::{
        native,
        scene::{array, color, integer, number, truth, vec3, Scene},
    },
    materials,
    media::{self, Asset, EffectAsset, EffectContent, MediaStore},
    prefab::GameObject,
    source::Source,
    stamp,
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const FAMILIES: [(&str, &str); 7] = [
    ("Torappu/UI/Disturb(CustomData)", "customDisturb"),
    ("Torappu/UI/BlendMode/ColorDodge", "dodge"),
    (
        "Torappu/UI/Disturb/DisturbDissolve-CustomDirection",
        "disturb",
    ),
    ("Torappu/UI/UI-Fx-Common", "common"),
    ("Torappu/UI/Shape/ShapeRect", "shape"),
    ("Torappu/UI/UIPost/RTImageFisheye", "fisheye"),
    ("Torappu/UI/AlphaBlend", "alpha"),
];

struct Builder<'a> {
    env: &'a Unity,
    source: &'a Source,
    store: &'a MediaStore,
    bundle: &'a str,
    root: ObjectId,
    rows: BTreeMap<ObjectId, Value>,
    transforms: BTreeMap<ObjectId, ObjectId>,
    textures: BTreeMap<String, Value>,
    materials: BTreeMap<String, Value>,
    nodes: Vec<Value>,
    paths: BTreeMap<ObjectId, String>,
    fonts: BTreeMap<String, Value>,
    available_fonts: &'a BTreeMap<String, String>,
    spell: bool,
    extended: bool,
    visiting: BTreeSet<ObjectId>,
}

impl Builder<'_> {
    fn resolve(&self, owner: ObjectId, pointer: &Value) -> Result<Option<ObjectId>> {
        self.env.resolve(owner, pointer)
    }
    fn require(&self, owner: ObjectId, pointer: &Value) -> Result<ObjectId> {
        self.resolve(owner, pointer)?
            .context("Animated UI reference missing")
    }
    fn texture(&mut self, owner: ObjectId, pointer: &Value) -> Result<Option<String>> {
        let Some(id) = self.resolve(owner, pointer)? else {
            return Ok(None);
        };
        ensure!(
            self.env.object(id)?.class_id() == 28,
            "Animated UI sampler references another type"
        );
        let origin = self.env.origin(id)?;
        let key = format!("{origin}:{}", id.path);
        if !self.textures.contains_key(&key) {
            let settings = self.env.field(id, "m_TextureSettings")?;
            let filter = integer(&settings["m_FilterMode"])?;
            let u = integer(&settings["m_WrapU"])?;
            let v = integer(&settings["m_WrapV"])?;
            ensure!(
                [0, 1].contains(&filter) && [0, 1].contains(&u) && [0, 1].contains(&v),
                "Unsupported animated UI sampler"
            );
            let file = self.store.image(&media::texture(self.env, id)?)?;
            self.textures.insert(key.clone(),json!({"url":file.url,"width":file.width,"height":file.height,"filter":filter,"wrapU":u,"wrapV":v,"bundle":origin}));
        }
        Ok(Some(key))
    }

    fn material(&mut self, owner: ObjectId, pointer: &Value) -> Result<Option<String>> {
        let Some(id) = self.resolve(owner, pointer)? else {
            return Ok(None);
        };
        let identity = format!("{}:{}", self.env.origin(id)?, id.path);
        if self.materials.contains_key(&identity) {
            return Ok(Some(identity));
        }
        let d = self.env.tree(id)?;
        let shader = self.require(id, &d["m_Shader"])?;
        let form = self.env.field(shader, "m_ParsedForm")?;
        let shader_name = form["m_Name"].as_str().context("UI shader name missing")?;
        let family = FAMILIES
            .iter()
            .find_map(|(name, family)| (*name == shader_name).then_some(*family));
        let saved = &d["m_SavedProperties"];
        let floats = materials::map(&saved["m_Floats"])?;
        let colors = materials::map(&saved["m_Colors"])?
            .into_iter()
            .map(|(key, value)| Ok((key, color(&value)?)))
            .collect::<Result<BTreeMap<_, _>>>()?;
        let tex = materials::map(&saved["m_TexEnvs"])?;
        let keywords = array(&d["m_ValidKeywords"])?;
        let f =
            |key: &str, default: f64| floats.get(key).and_then(Value::as_f64).unwrap_or(default);
        if shader_name == "Spine/SkeletonGraphic" {
            ensure!(
                keywords
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<BTreeSet<_>>()
                    == BTreeSet::from([
                        "UNITY_UI_ALPHACLIP",
                        "_CANVAS_GROUP_COMPATIBLE",
                        "_STRAIGHT_ALPHA_INPUT"
                    ])
                    && f("_StencilComp", 8.0) == 8.0
                    && f("_StencilOp", 0.0) == 0.0,
                "Unsupported Spine UI shader variant"
            );
            let texture = self.texture(
                id,
                &tex.get("_MainTex").context("Spine texture slot missing")?["m_Texture"],
            )?;
            self.materials.insert(
                identity.clone(),
                json!({
                    "name":d["m_Name"],
                    "shader":"spine",
                    "shaderId":shader.path.to_string(),
                    "constants":vec![0.0;84],
                    "color":colors.get("_Color").copied().unwrap_or([1.0;4]),
                    "dst":10,
                    "textures":[{"name":"_MainTex","key":texture,"sampler":0}]
                }),
            );
            return Ok(Some(identity));
        }
        if family == Some("dodge") {
            ensure!(
                (keywords.is_empty() || keywords == &vec![json!("UNITY_UI_ALPHACLIP")])
                    && f("_StencilComp", 8.0) == 8.0
                    && f("_StencilOp", 0.0) == 0.0
                    && f("_ColorMask", 15.0) == 15.0,
                "Unsupported dodge shader stencil"
            );
            let texture = tex.get("_MainTex").context("Dodge texture slot missing")?;
            let key = self.texture(id, &texture["m_Texture"])?;
            let mut constants = vec![0.0; 84];
            constants[8..12].copy_from_slice(&[
                number(&texture["m_Scale"]["x"])?,
                number(&texture["m_Scale"]["y"])?,
                number(&texture["m_Offset"]["x"])?,
                number(&texture["m_Offset"]["y"])?,
            ]);
            constants[12] = number(floats.get("_Opacity").context("Dodge opacity missing")?)?;
            self.materials.insert(
                identity.clone(),
                json!({
                    "name":d["m_Name"],
                    "shader":"dodge",
                    "shaderId":shader.path.to_string(),
                    "alphaClip":!keywords.is_empty(),
                    "constants":constants,
                    "color":colors.get("_TintColor").context("Dodge tint missing")?,
                    "dst":1,
                    "textures":[{"name":"_MainTex","key":key,"sampler":0}]
                }),
            );
            return Ok(Some(identity));
        }
        let family = family.context("Unsupported animated UI shader")?;
        let expected = if family == "shape" {
            vec![json!("_ADDITIONMAPMOVETYPE_TILE")]
        } else if self.spell && family == "common" && keywords == &vec![json!("UNITY_UI_ALPHACLIP")]
        {
            vec![json!("UNITY_UI_ALPHACLIP")]
        } else {
            Vec::new()
        };
        ensure!(
            keywords == &expected,
            "Unsupported animated UI shader keywords"
        );
        ensure!(
            self.spell
                || (f("_StencilComp", 8.0) == 8.0
                    && f("_StencilOp", 0.0) == 0.0
                    && f("_ColorMask", 15.0) == 15.0),
            "Unsupported animated UI stencil"
        );
        let state = &form["m_SubShaders"][0]["m_Passes"][0];
        let layout = layout::get(family)?;
        let mut bindings = BTreeMap::new();
        let mut values = BTreeMap::new();
        for property in array(&form["m_PropInfo"]["m_Props"])? {
            let name = property["m_Name"]
                .as_str()
                .context("Shader property name missing")?;
            match property["m_Type"].as_i64() {
                Some(0 | 1) => {
                    values.insert(
                        name.to_owned(),
                        json!((0..4)
                            .map(|i| property[format!("m_DefValue[{i}]")].clone())
                            .collect::<Vec<_>>()),
                    );
                }
                Some(2 | 3) => {
                    values.insert(name.to_owned(), property["m_DefValue[0]"].clone());
                }
                Some(4) => {
                    values.insert(format!("{name}_ST"), json!([1.0, 1.0, 0.0, 0.0]));
                }
                _ => {}
            }
        }
        values.extend(floats.clone());
        for (name, value) in &colors {
            values.insert(name.clone(), json!(value));
        }
        for (name, value) in tex {
            let key = self.texture(id, &value["m_Texture"])?;
            let st = json!([
                value["m_Scale"]["x"],
                value["m_Scale"]["y"],
                value["m_Offset"]["x"],
                value["m_Offset"]["y"]
            ]);
            values.insert(format!("{name}_ST"), st.clone());
            bindings.insert(name, json!({"key":key,"st":st}));
        }
        if family == "customDisturb" {
            ensure!(
                !self.rows.values().any(|c| c.get("_rotateTex1").is_some()),
                "Animated UI UV rotator is unsupported"
            );
            values.entry("_HG_UV_ROTATION".into()).or_insert(json!(0));
            for i in 0..4 {
                values
                    .entry(format!("_Rotation{i}"))
                    .or_insert(json!([0.0, 0.0, 0.0, 0.0]));
            }
        }
        let mut constants = vec![0.0; 84];
        let mut locations = BTreeMap::new();
        for &(prop, offset, size) in layout.constants {
            ensure!(
                offset + size <= constants.len(),
                "UI material constant exceeds supported layout"
            );
            let value = values
                .get(prop)
                .with_context(|| format!("UI material constant missing: {prop}"))?;
            let values = value
                .as_array()
                .cloned()
                .unwrap_or_else(|| vec![value.clone()]);
            ensure!(
                values.len() >= size,
                "UI material constant dimensions differ"
            );
            for i in 0..size {
                constants[offset + i] = number(&values[i])?;
            }
            locations.insert(prop, json!({"offset":offset,"size":size}));
        }
        let mut slots = Vec::new();
        for &(prop, sampler) in layout.textures {
            let default = array(&form["m_PropInfo"]["m_Props"])?
                .iter()
                .find(|p| p["m_Name"].as_str() == Some(prop))
                .map(|p| p["m_DefTexture"]["m_DefaultName"].clone())
                .unwrap_or(json!("white"));
            slots.push(json!({"name":prop,"key":bindings.get(prop).map(|b|b["key"].clone()).unwrap_or(Value::Null),"sampler":sampler,"default":default}));
        }
        let blend = &state["m_State"]["rtBlend0"]["destBlend"];
        let blend_name = blend["name"].as_str().context("UI blend name missing")?;
        let default = array(&form["m_PropInfo"]["m_Props"])?
            .iter()
            .find(|p| p["m_Name"].as_str() == Some(blend_name))
            .map(|p| &p["m_DefValue[0]"])
            .unwrap_or(&blend["val"]);
        let dst = number(floats.get(blend_name).unwrap_or(default))?;
        ensure!(
            [1.0, 10.0].contains(&dst),
            "Unsupported UI blend destination"
        );
        let tint = if family == "customDisturb" {
            [1.0; 4]
        } else if family == "alpha" {
            colors.get("_TintColor").copied().unwrap_or([1.0; 4])
        } else {
            colors.get("_Color").copied().unwrap_or([1.0; 4])
        };
        let mut material = json!({
            "name":d["m_Name"],
            "shader":family,
            "shaderId":shader.path.to_string(),
            "constants":constants,
            "locations":locations,
            "textures":slots,
            "color":tint,
            "dst":dst
        });
        if self.spell {
            let stencil = [
                ("Stencil", 0),
                ("StencilComp", 8),
                ("StencilOp", 0),
                ("StencilReadMask", 255),
                ("StencilWriteMask", 255),
                ("ColorMask", 15),
            ]
            .into_iter()
            .map(|(key, value)| (key, f(&format!("_{key}"), value as f64) as i64))
            .collect::<BTreeMap<_, _>>();
            material["stencil"] = json!(stencil);
            if expected == vec![json!("UNITY_UI_ALPHACLIP")] {
                material["shader"] = "commonClip".into();
            }
        }
        self.materials.insert(identity.clone(), material);
        Ok(Some(identity))
    }

    fn ui_particles(&mut self, owner: ObjectId, component: &Value) -> Result<Vec<Value>> {
        ensure!(
            !truth(&component["_meshSharing"])
                && (self.extended || vec3(&component["_scale3D"])? == [1.0; 3]),
            "Unsupported shared UI particles"
        );
        let mut systems = Vec::new();
        for pointer in array(&component["_particles"])? {
            let Some(id) = self.resolve(owner, pointer)? else {
                continue;
            };
            ensure!(pointer["m_FileID"] == 0, "External UI particle system");
            let d = self
                .rows
                .get(&id)
                .context("UI particle system missing")?
                .clone();
            let go = self.require(id, &d["m_GameObject"])?;
            if (self.spell || self.extended)
                && !truth(&d["EmissionModule"]["enabled"])
                && !truth(&d["SubModule"]["enabled"])
                && !self
                    .rows
                    .values()
                    .any(|r| truth(&r["SubModule"]["enabled"]))
            {
                continue;
            }
            let object: GameObject = serde_json::from_value(self.rows[&go].clone())?;
            let mut renderer_id = None;
            for c in object.components {
                if let Some(id) = c.component.resolve(self.env, go)? {
                    if self.env.object(id)?.class_id() == 199 {
                        renderer_id = Some(id);
                        break;
                    }
                }
            }
            let renderer_id = renderer_id.context("UI particle renderer missing")?;
            let renderer = self.rows[&renderer_id].clone();
            let transform_id = self.transforms[&go];
            let tr = self.rows[&transform_id].clone();
            let space = (
                integer(&d["moveWithTransform"])?,
                integer(&d["scalingMode"])?,
            );
            let allowed = if self.extended {
                vec![(0, 0), (0, 1), (1, 0)]
            } else if self.spell {
                vec![(0, 1), (1, 0)]
            } else {
                vec![(0, 1)]
            };
            let trail = &d["TrailModule"];
            let ui_trail = self.extended && truth(&trail["enabled"]);
            let slots = array(&renderer["m_Materials"])?;
            if ui_trail {
                ensure!(
                    trail["mode"] == 0
                        && truth(&trail["dieWithParticles"])
                        && !truth(&trail["worldSpace"])
                        && !truth(&trail["sizeAffectsLifetime"])
                        && space == (1, 0)
                        && slots.len() == 2
                        && slots[0] == slots[1],
                    "Unsupported UI trail routing"
                );
            }
            ensure!(
                allowed.contains(&space)
                    && (if self.extended {
                        [0, 1, 5].contains(&integer(&renderer["m_RenderMode"])?)
                            && [0, 1, 2].contains(&integer(&renderer["m_RenderAlignment"])?)
                    } else {
                        renderer["m_RenderMode"] == 0
                            && [0, 1].contains(&integer(&renderer["m_RenderAlignment"])?)
                    })
                    && slots.len() == if ui_trail { 2 } else { 1 }
                    && number(&renderer["m_MinParticleSize"])? == 0.0
                    && (self.extended || number(&renderer["m_MaxParticleSize"])? == 20.0)
                    && (!truth(&trail["enabled"]) || ui_trail)
                    && !truth(&d["SubModule"]["enabled"])
                    && !truth(&d["CustomDataModule"]["enabled"]),
                "Unsupported UI particle bake mode"
            );
            if !self.extended {
                ensure!(
                    vec3(&tr["m_LocalPosition"])? == [0.0; 3]
                        && tr["m_LocalRotation"] == json!({"x":0.0,"y":0.0,"z":0.0,"w":1.0}),
                    "Unsupported UI particle transform"
                );
            }
            let mut subset = BTreeMap::new();
            for id in [id, go, transform_id, renderer_id] {
                subset.insert(id, self.rows[&id].clone());
            }
            subset.get_mut(&go).unwrap()["m_IsActive"] = true.into();
            subset.get_mut(&renderer_id).unwrap()["m_Enabled"] = 1.into();
            let transform = subset.get_mut(&transform_id).unwrap();
            transform["m_Father"] = json!({"m_FileID":0,"m_PathID":0});
            if self.extended && transform.get("m_AnchorMin").is_some() {
                transform["m_AnchorMin"] = json!({"x":0.5,"y":0.5});
                transform["m_AnchorMax"] = json!({"x":0.5,"y":0.5});
            }
            let mid = self.material(renderer_id, &slots[0])?;
            let pid = integer(&slots[0]["m_PathID"])?.to_string();
            let dummy = BTreeMap::from([(
                pid.clone(),
                json!({
                    "name":pid,
                    "shader":"alpha",
                    "floats":{},
                    "colors":{},
                    "textures":{},
                    "keywords":[],
                    "blend":{"srcBlend":5,"destBlend":10,"srcBlendAlpha":5,"destBlendAlpha":10}
                }),
            )]);
            let scene = Scene {
                env: self.env,
                root: go,
                rows: subset,
                transforms: BTreeMap::from([(go, transform_id)]),
            };
            let sim = native::build(
                &scene,
                self.source,
                self.bundle,
                dummy,
                BTreeMap::new(),
                true,
            )?;
            if array(&sim["nodes"])?.is_empty() {
                continue;
            }
            let mut system_go = go;
            let mut path = Vec::new();
            let mut seen = BTreeSet::new();
            while system_go != self.root {
                ensure!(seen.insert(system_go), "Cycle in UI particle path");
                path.push(
                    self.rows[&system_go]["m_Name"]
                        .as_str()
                        .context("Particle name missing")?
                        .to_owned(),
                );
                let t = self.transforms[&system_go];
                let parent = self.require(t, &self.rows[&t]["m_Father"])?;
                system_go = self.require(parent, &self.rows[&parent]["m_GameObject"])?;
            }
            path.reverse();
            let position = tr
                .get("m_AnchoredPosition")
                .unwrap_or(&tr["m_LocalPosition"]);
            let anchor = if self.extended {
                Some(Value::Object(
                    ["m_AnchorMin", "m_AnchorMax", "m_Pivot"]
                        .into_iter()
                        .filter_map(|key| tr.get(key).map(|v| (key.into(), v.clone())))
                        .collect(),
                ))
            } else {
                None
            };
            systems.push(json!({
                "profile":sim,
                "material":mid,
                "pathId":id.path.to_string(),
                "animationPath":path.join("/"),
                "offset":[position["x"],position["y"]],
                "uiScale":if self.extended{vec3(&component["_scale3D"])?}else{[1.0;3]},
                "extended":self.extended,
                "self":d["m_GameObject"]==component["m_GameObject"],
                "rotation":if self.extended{Some(tr["m_LocalRotation"].clone())}else{None},
                "anchor":anchor
            }));
        }
        Ok(systems)
    }

    fn spine(&mut self, owner: ObjectId, component: &Value) -> Result<Value> {
        let asset = self.require(owner, &component["skeletonDataAsset"])?;
        let data = self.env.tree(asset)?;
        let settings = &component["meshGenerator"]["settings"];
        ensure!(
            !truth(&component["allowMultipleCanvasRenderers"])
                && !truth(&component["enableSeparatorSlots"])
                && !truth(&settings["tintBlack"])
                && !truth(&settings["canvasGroupTintBlack"])
                && array(&data["skeletonDataModifiers"])?.is_empty()
                && data["controller"]["m_PathID"] == 0,
            "Unsupported SkeletonGraphic extension"
        );
        let skeleton = self.require(asset, &data["skeletonJSON"])?;
        let raw = self
            .env
            .object(skeleton)?
            .read_text_bytes(64 * 1024 * 1024)?;
        let skeleton: Value = serde_json::from_slice(&raw)?;
        ensure!(
            skeleton["skeleton"]["spine"]
                .as_str()
                .is_some_and(|v| v.starts_with("3.8."))
                && array(&skeleton["slots"])?
                    .iter()
                    .all(|slot| slot.get("blend").is_none_or(|blend| blend == "normal")),
            "Unsupported Spine version or slot blend mode"
        );
        let mut atlases = Vec::new();
        for pointer in array(&data["atlasAssets"])? {
            let atlas = self.require(asset, pointer)?;
            let definition = self.env.tree(atlas)?;
            let raw = self.require(atlas, &definition["atlasFile"])?;
            let text = String::from_utf8(self.env.object(raw)?.read_text_bytes(16 * 1024 * 1024)?)?;
            let mut materials = Vec::new();
            for pointer in array(&definition["materials"])? {
                materials.push(self.material(atlas, pointer)?);
            }
            atlases.push(json!({"text":text,"materials":materials}));
        }
        let mixes = array(&data["fromAnimation"])?
            .iter()
            .zip(array(&data["toAnimation"])?.iter())
            .zip(array(&data["duration"])?.iter())
            .map(|((a, b), duration)| json!([a, b, duration]))
            .collect::<Vec<_>>();
        Ok(json!({
            "skeleton":skeleton,
            "atlases":atlases,
            "scale":data["scale"],
            "skin":component["initialSkinName"],
            "flipX":truth(&component["initialFlipX"]),
            "flipY":truth(&component["initialFlipY"]),
            "animation":component["startingAnimation"],
            "loop":truth(&component["startingLoop"]),
            "timeScale":component["timeScale"],
            "freeze":truth(&component["freeze"]),
            "clipping":truth(&settings["useClipping"]),
            "pma":truth(&settings["pmaVertexColors"]),
            "defaultMix":data["defaultMix"],
            "mixes":mixes
        }))
    }

    fn visit(&mut self, go: ObjectId, path: String) -> Result<()> {
        ensure!(self.visiting.insert(go), "Cycle in animated UI hierarchy");
        let d = self
            .rows
            .get(&go)
            .context("Animated UI object missing")?
            .clone();
        let object: GameObject = serde_json::from_value(d.clone())?;
        let mut components = Vec::new();
        for c in object.components {
            if let Some(id) = c.component.resolve(self.env, go)? {
                components.push(id);
            }
        }
        if self.extended
            && components
                .iter()
                .any(|&id| self.env.object(id).is_ok_and(|o| o.class_id() == 198))
            && !components.iter().any(|id| {
                self.rows
                    .get(id)
                    .is_some_and(|v| v.get("_particles").is_some())
            })
        {
            self.visiting.remove(&go);
            return Ok(());
        }
        let Some(&transform) = components
            .iter()
            .find(|&&id| self.env.object(id).is_ok_and(|o| o.class_id() == 224))
        else {
            self.visiting.remove(&go);
            return Ok(());
        };
        let tr = self.rows[&transform].clone();
        ensure!(
            self.extended
                || (number(&tr["m_LocalRotation"]["x"])? == 0.0
                    && number(&tr["m_LocalRotation"]["y"])? == 0.0),
            "Unsupported UI perspective transform"
        );
        let mut n = json!({"path":path,"active":truth(&d["m_IsActive"])});
        self.paths.insert(go, path.clone());
        for (key, field) in [
            ("min", "m_AnchorMin"),
            ("max", "m_AnchorMax"),
            ("pos", "m_AnchoredPosition"),
            ("size", "m_SizeDelta"),
            ("pivot", "m_Pivot"),
            ("scale", "m_LocalScale"),
            ("rotation", "m_LocalRotation"),
        ] {
            n[key] = tr[field].clone();
        }
        n["pos"]["z"] = tr["m_LocalPosition"]["z"].clone();
        for id in &components {
            let c = self.rows.get(id).cloned().unwrap_or_else(|| json!({}));
            if let Some(alpha) = c.get("m_Alpha") {
                n["alpha"] = alpha.clone();
            }
            if self.spell && c.get("m_FontData").is_some() {
                let fd = &c["m_FontData"];
                let font = components
                    .iter()
                    .filter_map(|id| self.rows.get(id))
                    .find_map(|row| row["_fontName"].as_str())
                    .context("Spell font binding missing")?
                    .to_owned();
                let slot = self
                    .nodes
                    .iter()
                    .filter(|n| n.get("text").is_some())
                    .count();
                n["text"] = json!({"font":font,"size":fd["m_FontSize"],"style":fd["m_FontStyle"],"alignment":fd["m_Alignment"],"fallback":c["m_Text"],"slot":slot});
                n["color"] = json!(color(&c["m_Color"])?);
                let url = self
                    .available_fonts
                    .get(&font)
                    .context("Official spell font missing")?;
                self.fonts.insert(font, json!({"url":url}));
            }
            if self.spell && c.get("m_HorizontalFit").is_some() {
                n["fit"] = json!([c["m_HorizontalFit"], c["m_VerticalFit"]]);
            }
            if self.spell && c.get("m_ChildControlWidth").is_some() {
                n["layout"] = crate::effects::scene::select(
                    &c,
                    &[
                        "m_ChildControlWidth",
                        "m_ChildControlHeight",
                        "m_ChildForceExpandWidth",
                        "m_ChildForceExpandHeight",
                        "m_ChildScaleWidth",
                        "m_ChildScaleHeight",
                        "m_Spacing",
                        "m_ChildAlignment",
                        "m_Padding",
                    ],
                )?;
            }
            if self.spell && c.get("_needCleaner").is_some() {
                ensure!(
                    c["_comp"] == 1 && c["_opt"] == 2,
                    "Unsupported spell text stencil"
                );
                n["stencil"] = json!({
                    "Stencil":255,
                    "StencilComp":3,
                    "StencilOp":2,
                    "StencilReadMask":c["_readChannel"],
                    "StencilWriteMask":c["_writeChannel"],
                    "ColorMask":c["_colorMask"]
                });
            }
            if c.get("_particles").is_some() {
                n["particles"] = json!(self.ui_particles(*id, &c)?);
            }
            if c.get("skeletonDataAsset").is_some() {
                n["spine"] = self.spine(*id, &c)?;
                n["color"] = json!(color(&c["m_Color"])?);
            }
            if c.get("_floatProperty1").is_some() {
                let mut bindings = Vec::new();
                for (field, param) in c
                    .as_object()
                    .unwrap()
                    .iter()
                    .filter(|(_, p)| p.is_object() && truth(&p["enable"]))
                {
                    let mut values = BTreeMap::new();
                    if field.starts_with("_floatProperty") {
                        values.insert("floatValue".into(), param["floatValue"].clone());
                    } else if field.starts_with("_colorProperty")
                        || field.starts_with("_vector4Property")
                    {
                        let prop = if field.starts_with("_colorProperty") {
                            "color"
                        } else {
                            "value"
                        };
                        for (key, value) in param[prop]
                            .as_object()
                            .context("UI animated property components missing")?
                        {
                            values.insert(format!("{prop}.{key}"), value.clone());
                        }
                    } else if field.starts_with("_textureProperty") {
                        for prop in ["tiling", "offset"] {
                            for (key, value) in param[prop]
                                .as_object()
                                .context("UI animated texture components missing")?
                            {
                                values.insert(format!("{prop}.{key}"), value.clone());
                            }
                        }
                    } else {
                        anyhow::bail!("Unsupported UI material animation property");
                    }
                    let property = format!(
                        "{}{}",
                        param["name"]
                            .as_str()
                            .context("UI material property name missing")?,
                        if field.starts_with("_textureProperty") {
                            "_ST"
                        } else {
                            ""
                        }
                    );
                    bindings.push(json!({"field":field,"property":property,"values":values}));
                }
                n["materialBindings"] = json!(bindings);
            }
            if c.get("m_Padding").is_some() && c.get("m_Softness").is_some() {
                ensure!(
                    c["m_Padding"]
                        .as_object()
                        .is_some_and(|v| v.values().all(|n| number(n).ok() == Some(0.0)))
                        && c["m_Softness"]
                            .as_object()
                            .is_some_and(|v| v.values().all(|n| number(n).ok() == Some(0.0))),
                    "Unsupported soft UI mask"
                );
                n["mask"] = true.into();
            }
            if c.get("m_Texture").is_some() && c.get("m_UVRect").is_some() {
                let r = &c["m_UVRect"];
                n["color"] = json!(color(&c["m_Color"])?);
                n["material"] = json!(self.material(*id, &c["m_Material"])?);
                n["sprite"] = json!({
                    "texture":self.texture(*id,&c["m_Texture"])?,
                    "uv":[number(&r["x"])?,number(&r["y"])?,number(&r["x"])?+number(&r["width"])?,number(&r["y"])?+number(&r["height"])?],
                    "padding":[0,0,1,1]
                });
            }
            if c.get("m_Sprite").is_some() {
                ensure!(
                    matches!(integer(&c["m_Type"])?, 0 | 1)
                        && !truth(&c["m_PreserveAspect"])
                        && !truth(&c["m_UseSpriteMesh"]),
                    "Unsupported animated UI image geometry"
                );
                n["color"] = json!(color(&c["m_Color"])?);
                n["material"] = json!(self.material(*id, &c["m_Material"])?);
                if let Some(sprite) = self.resolve(*id, &c["m_Sprite"])? {
                    let s = self.env.object(sprite)?.read_sprite(Default::default())?;
                    let rd = &s.render_data;
                    ensure!(
                        rd.settings.raw == 64 && rd.alpha_texture.path_id == 0,
                        "Unsupported packed or split UI sprite"
                    );
                    let pointer =
                        json!({"m_FileID":rd.texture.file_id,"m_PathID":rd.texture.path_id});
                    let key = self
                        .texture(sprite, &pointer)?
                        .context("UI sprite texture missing")?;
                    let tex = &self.textures[&key];
                    let width = number(&tex["width"])?;
                    let height = number(&tex["height"])?;
                    let r = rd.texture_rect;
                    let off = rd.texture_rect_offset;
                    let (x, y, w, h) = (r.x as f64, r.y as f64, r.width as f64, r.height as f64);
                    let (ox, oy) = (off.x as f64, off.y as f64);
                    let (sw, sh) = (s.rect.width as f64, s.rect.height as f64);
                    n["sprite"] = json!({"texture":key,"uv":[x/width,y/height,(x+w)/width,(y+h)/height],"padding":[ox/sw,oy/sh,(ox+w)/sw,(oy+h)/sh]});
                    let b = s.border;
                    let border = [b.x as f64, b.y as f64, b.z as f64, b.w as f64];
                    if c["m_Type"] == 1 && border.iter().any(|b| *b != 0.0) {
                        let ppu = s.pixels_to_units as f64 / 100.0
                            * number(&c["m_PixelsPerUnitMultiplier"])?;
                        ensure!(ppu > 0.0, "Invalid sliced UI pixels per unit");
                        let padding = [ox, oy, sw - ox - w, sh - oy - h];
                        n["sprite"]["slice"] = json!({
                            "border":border.map(|v|v/ppu),
                            "padding":padding.map(|v|v/ppu),
                            "inner":[(x-ox+border[0])/width,(y-oy+border[1])/height,(x-ox+sw-border[2])/width,(y-oy+sh-border[3])/height],
                            "fillCenter":truth(&c["m_FillCenter"])
                        });
                    }
                } else {
                    n["sprite"] = json!({"texture":null,"uv":[0,0,1,1],"padding":[0,0,1,1]});
                }
            }
        }
        self.nodes.push(n);
        for pointer in array(&tr["m_Children"])? {
            let t = self.require(transform, pointer)?;
            let go = self.require(t, &self.rows[&t]["m_GameObject"])?;
            let name = self.rows[&go]["m_Name"]
                .as_str()
                .context("UI child name missing")?;
            let next = if path.is_empty() {
                name.into()
            } else {
                format!("{path}/{name}")
            };
            self.visit(go, next)?;
        }
        self.visiting.remove(&go);
        Ok(())
    }
}

pub fn export(
    env: &Unity,
    source: &Source,
    store: &MediaStore,
    bundle: &str,
    key: &str,
    fonts: &BTreeMap<String, String>,
) -> Result<Asset> {
    let spell = bundle.starts_with("avg/spellsticker/");
    let extended = !spell && !matches!(key, "act47side_01" | "act4mainss_01");
    let root = env.container(
        &format!(
            "dyn/avg/{}/{key}.prefab",
            if spell { "spellsticker" } else { "animatedkv" }
        ),
        1,
    )?;
    let mut rows = BTreeMap::new();
    let mut transforms = BTreeMap::new();
    for object in env.primary_objects() {
        ensure!(
            !matches!(object.class_id(), 95 | 23),
            "Animated UI Animator or mesh routing is unsupported"
        );
        if !matches!(
            object.class_id(),
            1 | 4 | 224 | 114 | 111 | 74 | 225 | 21 | 198 | 199
        ) {
            continue;
        }
        let id = ObjectId {
            file: object.file_index(),
            path: object.path_id(),
        };
        let row = env.tree(id)?;
        if matches!(object.class_id(), 4 | 224) {
            transforms.insert(
                env.resolve(id, &row["m_GameObject"])?
                    .context("UI transform owner missing")?,
                id,
            );
        }
        rows.insert(id, row);
    }
    let mut b = Builder {
        env,
        source,
        store,
        bundle,
        root,
        rows,
        transforms,
        textures: BTreeMap::new(),
        materials: BTreeMap::new(),
        nodes: Vec::new(),
        paths: BTreeMap::new(),
        fonts: BTreeMap::new(),
        available_fonts: fonts,
        spell,
        extended,
        visiting: BTreeSet::new(),
    };
    b.visit(root, String::new())?;
    let mut animations = Vec::new();
    let mut entries = Vec::new();
    for (&id, d) in &b.rows {
        if env.object(id)?.class_id() == 111 {
            ensure!(
                !truth(&d["m_AnimatePhysics"]) && d["m_CullingType"] == 0,
                "Unsupported UI animation clock"
            );
            let go = b.require(id, &d["m_GameObject"])?;
            let path = b.paths.get(&go).context("UI animation root missing")?;
            for pointer in array(&d["m_Animations"])? {
                let clip_id = b.require(id, pointer)?;
                let clip = &b.rows[&clip_id];
                ensure!(
                    truth(&clip["m_Legacy"])
                        && array(&clip["m_Events"])?.is_empty()
                        && array(&clip["m_PPtrCurves"])?.is_empty()
                        && array(&clip["m_PositionCurves"])?.is_empty(),
                    "Unsupported UI animation storage"
                );
                let tracks = stamp::tracks(clip)?;
                let mut allowed = BTreeSet::from([
                    "m_AnchoredPosition.x",
                    "m_AnchoredPosition.y",
                    "m_Color.r",
                    "m_Color.g",
                    "m_Color.b",
                    "m_Color.a",
                    "m_Alpha",
                    "m_IsActive",
                    "m_SizeDelta.x",
                    "m_SizeDelta.y",
                    "scale.x",
                    "scale.y",
                    "scale.z",
                    "rotation.x",
                    "rotation.y",
                    "rotation.z",
                    "rotation.w",
                ]);
                if extended {
                    allowed.extend([
                        "m_LocalPosition.x",
                        "m_LocalPosition.y",
                        "m_LocalPosition.z",
                        "simulationSpeed",
                        "EmissionModule.rateOverTime.scalar",
                        "EmissionModule.rateOverTime.minScalar",
                        "ShapeModule.radius.value",
                    ]);
                }
                if spell {
                    allowed.extend([
                        "m_AnchorMin.x",
                        "m_AnchorMin.y",
                        "m_AnchorMax.x",
                        "m_AnchorMax.y",
                    ]);
                }
                ensure!(
                    tracks.iter().all(|t| allowed.contains(t.property.as_str())
                        || [
                            "_floatProperty",
                            "_colorProperty",
                            "_vector4Property",
                            "_textureProperty"
                        ]
                        .iter()
                        .any(|p| t.property.starts_with(p))),
                    "Unsupported UI animation property"
                );
                let length = tracks
                    .iter()
                    .flat_map(|t| t.keys.iter())
                    .map(|k| number(&k["time"]))
                    .collect::<Result<Vec<_>>>()?
                    .into_iter()
                    .fold(0.0f64, f64::max);
                animations.push(json!({
                    "root":path,
                    "name":clip["m_Name"],
                    "tracks":tracks,
                    "length":length,
                    "auto":truth(&d["m_PlayAutomatically"])&&pointer==&d["m_Animation"],
                    "wrap":if truth(&d["m_WrapMode"]){d["m_WrapMode"].clone()}else{clip["m_WrapMode"].clone()}
                }));
            }
        }
        if d.get("_entries").is_some() {
            for entry in array(&d["_entries"])? {
                let wrapper = b.require(id, &entry["animationWrapper"])?;
                let go = b.require(wrapper, &b.rows[&wrapper]["m_GameObject"])?;
                entries.push(json!({"root":b.paths.get(&go).context("UI animation entry root missing")?,"name":entry["animationName"]}));
            }
        }
    }
    if spell {
        entries = animations
            .iter()
            .filter(|a| !truth(&a["auto"]))
            .map(|a| json!({"root":a["root"],"name":a["name"]}))
            .collect();
    }
    let mut profile = json!({"nodes":b.nodes,"animations":animations,"entries":entries,"materials":b.materials,"textures":b.textures,"bundle":bundle});
    if spell {
        profile["fonts"] = json!(b.fonts);
    }
    let url = store.bytes(&serde_json::to_vec(&profile)?, "json")?;
    Ok(Asset::Effect(EffectAsset {
        url,
        content: EffectContent::AnimatedKv {
            animated_kv: profile,
        },
    }))
}
