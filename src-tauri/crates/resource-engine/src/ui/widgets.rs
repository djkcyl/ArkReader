use crate::{
    client_assets::ClientAssets,
    media::{self, MediaStore},
    prefab::{Pointer, Prefab},
    source::Source,
    unity::Unity,
};
use anyhow::{ensure, Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};
use unity_rs_core::serialized::TypeTree;

pub const SETTINGS: &str = "ui/home/setting_state.ab";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graphic {
    pub path: String,
    pub rect: [f64; 4],
    pub color: [f64; 4],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sprite: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sprite_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sliced: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<[f64; 4]>,
}
#[derive(Serialize)]
pub struct Control {
    pub rect: [f64; 4],
    pub background: Graphic,
    pub icon: Graphic,
    pub text: Graphic,
}
#[derive(Serialize)]
pub struct Dialog {
    pub background: Graphic,
    pub content: Graphic,
    pub controls: BTreeMap<String, Control>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub size: [f64; 2],
    pub track: Graphic,
    pub handle: Graphic,
    pub label: Graphic,
    pub area: [f64; 4],
    pub hotspot: [f64; 4],
    pub tint_handle: bool,
}
#[derive(Serialize)]
pub struct Action {
    pub size: [f64; 2],
    pub background: Graphic,
    pub text: Graphic,
}
#[derive(Clone, Serialize)]
pub struct TabState {
    pub background: Graphic,
    pub text: Graphic,
}
#[derive(Clone, Serialize)]
pub struct Tab {
    pub size: [f64; 2],
    pub on: TabState,
    pub off: TabState,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toggle {
    pub size: [f64; 2],
    pub background: Graphic,
    pub bar: Graphic,
    #[serde(rename = "on_mask")]
    pub on_mask: Graphic,
    #[serde(rename = "unavailable_mask")]
    pub unavailable_mask: Graphic,
    pub open: Graphic,
    pub close: Graphic,
    pub order: Vec<String>,
    pub states: BTreeMap<String, Value>,
    pub checked_state: String,
    pub unchecked_state: String,
    pub tint_path: String,
}
#[derive(Serialize)]
pub struct Settings {
    pub action: Action,
    pub toggle: Toggle,
    pub tabs: BTreeMap<String, Tab>,
}
#[derive(Serialize)]
pub struct Widgets {
    pub dialogs: BTreeMap<String, Dialog>,
    pub volume: Volume,
    pub settings: Settings,
}

struct Graphics<'a> {
    store: &'a MediaStore,
    image_schema: &'a TypeTree,
    text_schema: &'a TypeTree,
}
impl Graphics<'_> {
    fn get(&self, prefab: &Prefab<'_>, path: &str, filename: Option<&str>) -> Result<Graphic> {
        let text = filename.is_none();
        let (id, row) = prefab.component(
            path,
            if text { "Text" } else { "Image" },
            Some(if text {
                self.text_schema
            } else {
                self.image_schema
            }),
        )?;
        let color = ["r", "g", "b", "a"].map(|c| row["m_Color"][c].as_f64().unwrap_or(0.0));
        let mut result = Graphic {
            path: path.into(),
            rect: prefab.rect(path)?,
            color,
            font_size: None,
            align: None,
            sprite: None,
            sprite_name: None,
            sliced: None,
            border: None,
        };
        if text {
            result.font_size = Some(
                row["m_FontData"]["m_FontSize"]
                    .as_i64()
                    .context("Missing original font size")?,
            );
            result.align = Some(
                row["m_FontData"]["m_Alignment"]
                    .as_i64()
                    .context("Missing original text alignment")?,
            );
        } else {
            let pointer: Pointer = serde_json::from_value(row["m_Sprite"].clone())?;
            if let Some(sprite) = pointer.resolve(prefab.env, id)? {
                let (image, metadata) = media::sprite(prefab.env, sprite)?;
                let name = filename.unwrap();
                self.store.named_image(name, &image)?;
                let b = metadata.border;
                result.sprite = Some(name.into());
                result.sprite_name = Some(metadata.name);
                result.sliced = Some(row["m_Type"].as_i64() == Some(1));
                result.border = Some([b.x.into(), b.y.into(), b.z.into(), b.w.into()]);
            }
        }
        Ok(result)
    }
}

fn dialogs(env: &Unity, g: &Graphics<'_>) -> Result<BTreeMap<String, Dialog>> {
    let mut result = BTreeMap::new();
    for mode in ["ok", "judge"] {
        let root = format!("panel_{mode}_dialog");
        let prefab = Prefab::new(env, &root, Some([1280.0, 720.0]))?;
        let background = format!(
            "{root}/{}",
            if mode == "ok" {
                "panel_content_container"
            } else {
                "panel_content_bkg"
            }
        );
        let content = format!(
            "{background}/{}",
            if mode == "ok" {
                "panel_text_scroll/panel_text_content/text_content"
            } else {
                "layout_content/layout_text/text_content"
            }
        );
        let mut controls = BTreeMap::new();
        for action in if mode == "ok" {
            vec!["confirm"]
        } else {
            vec!["cancel", "confirm"]
        } {
            let path = format!("{root}/btn_{action}");
            let bg = if mode == "judge" && action == "confirm" {
                format!("{path}/img_blue_bkg")
            } else {
                path.clone()
            };
            controls.insert(
                action.into(),
                Control {
                    rect: prefab.rect(&path)?,
                    background: g.get(
                        &prefab,
                        &bg,
                        Some(&format!("native-{mode}-{action}-bg.png")),
                    )?,
                    icon: g.get(
                        &prefab,
                        &format!("{path}/image_icon"),
                        Some(&format!("native-{mode}-{action}-icon.png")),
                    )?,
                    text: g.get(
                        &prefab,
                        &format!(
                            "{path}/{}",
                            if mode == "ok" {
                                "text_confirm"
                            } else {
                                "text_content"
                            }
                        ),
                        None,
                    )?,
                },
            );
        }
        result.insert(
            mode.into(),
            Dialog {
                background: g.get(
                    &prefab,
                    &background,
                    Some(&format!("native-{mode}-dialog-bg.png")),
                )?,
                content: g.get(&prefab, &content, None)?,
                controls,
            },
        );
    }
    Ok(result)
}

fn path_ending(prefab: &Prefab<'_>, suffix: &str) -> Result<String> {
    let paths: Vec<_> = prefab
        .paths
        .keys()
        .filter(|path| path.ends_with(suffix))
        .collect();
    ensure!(
        paths.len() == 1,
        "Original setting control is missing or ambiguous: {suffix}"
    );
    Ok(paths[0].clone())
}

fn toggle_states(prefab: &Prefab<'_>, root: &str) -> Result<BTreeMap<String, Value>> {
    let go = prefab.root;
    let mut controller = None;
    for component in &prefab.objects[&go].components {
        let Some(id) = component.component.resolve(prefab.env, go)? else {
            continue;
        };
        if prefab.env.object(id)?.class_id() == 95 {
            let row = prefab.env.tree(id)?;
            controller = Some(
                prefab
                    .env
                    .resolve(id, &row["m_Controller"])?
                    .context("Toggle animator controller missing")?,
            );
            break;
        }
    }
    let controller = controller.context("Toggle has no authored animator")?;
    let tree = prefab.env.tree(controller)?;
    let bar = prefab
        .paths
        .get(&format!("{root}/button_bar"))
        .context("Toggle bar missing")?;
    let initial = prefab.transforms[&prefab.by_object[bar]].position.x;
    let mut result = BTreeMap::new();
    for pointer in tree["m_AnimationClips"]
        .as_array()
        .context("Toggle clips missing")?
    {
        let id = prefab
            .env
            .resolve(controller, pointer)?
            .context("Toggle clip reference is null")?;
        let clip = prefab.env.tree(id)?;
        let state = clip["m_Name"]
            .as_str()
            .context("Toggle clip name missing")?
            .trim_start_matches("setting_button_")
            .to_owned();
        let data = &clip["m_MuscleClip"]["m_Clip"]["data"];
        let streamed = &data["m_StreamedClip"];
        let mut bytes = Vec::new();
        for number in streamed["data"]
            .as_array()
            .context("Toggle streamed data missing")?
        {
            bytes.extend_from_slice(
                &u32::try_from(number.as_u64().context("Invalid animation word")?)?.to_le_bytes(),
            );
        }
        let mut at = 0;
        let mut values = BTreeMap::new();
        while at < bytes.len() {
            ensure!(bytes.len() - at >= 8, "Truncated animation frame");
            let time = f32::from_le_bytes(bytes[at..at + 4].try_into()?);
            let count = i32::from_le_bytes(bytes[at + 4..at + 8].try_into()?);
            at += 8;
            ensure!(
                count >= 0 && count as usize <= (bytes.len() - at) / 20,
                "Invalid animation frame size"
            );
            for _ in 0..count {
                let index = i32::from_le_bytes(bytes[at..at + 4].try_into()?);
                let value = f32::from_le_bytes(bytes[at + 16..at + 20].try_into()?);
                at += 20;
                if time.is_finite() && time <= 0.0 {
                    values.insert(index, value as f64);
                }
            }
        }
        let start = streamed["curveCount"]
            .as_i64()
            .context("Missing animation curve count")?;
        for (i, value) in data["m_ConstantClip"]["data"]
            .as_array()
            .context("Toggle constants missing")?
            .iter()
            .enumerate()
        {
            values.insert(
                i32::try_from(start + i as i64)?,
                value.as_f64().context("Invalid animation constant")?,
            );
        }
        let mut row = serde_json::json!({});
        for (i, binding) in clip["m_ClipBindingConstant"]["genericBindings"]
            .as_array()
            .context("Toggle bindings missing")?
            .iter()
            .enumerate()
        {
            for node in ["on_mask", "unavailable_mask", "button_bar"] {
                if binding["path"].as_u64() != Some(crc32fast::hash(node.as_bytes()) as u64) {
                    continue;
                }
                let attribute = binding["attribute"].as_u64();
                if attribute == Some(crc32fast::hash(b"m_IsActive") as u64) {
                    row[node] = serde_json::json!(
                        *values
                            .get(&(i as i32))
                            .context("Toggle activation value missing")?
                            != 0.0
                    );
                }
                if node == "button_bar"
                    && attribute == Some(crc32fast::hash(b"m_AnchoredPosition.x") as u64)
                {
                    row["barOffset"] = serde_json::json!(
                        *values
                            .get(&(i as i32))
                            .context("Toggle offset value missing")?
                            - initial
                    );
                }
            }
        }
        ensure!(
            result.insert(state, row).is_none(),
            "Duplicate authored toggle state"
        );
    }
    Ok(result)
}

fn settings(env: &Unity, g: &Graphics<'_>) -> Result<(Volume, Settings)> {
    let probe = Prefab::new(env, "setting_state", Some([1280.0, 720.0]))?;
    let root = path_ending(&probe, "/panel_music/slider_music_volumn/setting_slider")?;
    let p = Prefab::new(env, &root, None)?;
    let handle = format!("{root}/handle_slide_area/handle");
    let (_, slider) = p.component(&root, "Slider", None)?;
    let volume = Volume {
        size: p.size,
        track: g.get(
            &p,
            &format!("{root}/background"),
            Some("native-volume-track.png"),
        )?,
        handle: g.get(
            &p,
            &format!("{handle}/handle_image"),
            Some("native-volume-handle.png"),
        )?,
        label: g.get(&p, &format!("{handle}/handle_image/value_text"), None)?,
        area: p.rect(&format!("{root}/handle_slide_area"))?,
        hotspot: p.rect(&format!("{handle}/hotspot"))?,
        tint_handle: slider["m_TargetGraphic"]["m_PathID"].as_i64().unwrap_or(0) != 0,
    };
    let root = path_ending(&probe, "/panel_customize/button_customize")?;
    let p = Prefab::new(env, &root, None)?;
    let action = Action {
        size: p.size,
        background: g.get(
            &p,
            &format!("{root}/img_customize"),
            Some("native-setting-action.png"),
        )?,
        text: g.get(&p, &format!("{root}/label_customize"), None)?,
    };
    let root = path_ending(&probe, "/panel_music/button_music_flag/setting_button")?;
    let p = Prefab::new(env, &root, None)?;
    let mut toggle = Toggle {
        size: p.size,
        background: g.get(&p, &root, Some("native-setting-toggle-bg.png"))?,
        bar: g.get(
            &p,
            &format!("{root}/button_bar"),
            Some("native-setting-toggle-bar.png"),
        )?,
        on_mask: g.get(
            &p,
            &format!("{root}/on_mask"),
            Some("native-setting-toggle-on.png"),
        )?,
        unavailable_mask: g.get(
            &p,
            &format!("{root}/unavailable_mask"),
            Some("native-setting-toggle-disabled.png"),
        )?,
        open: g.get(&p, &format!("{root}/open"), None)?,
        close: g.get(&p, &format!("{root}/close"), None)?,
        order: Vec::new(),
        states: toggle_states(&p, &root)?,
        checked_state: String::new(),
        unchecked_state: String::new(),
        tint_path: String::new(),
    };
    let t = p.by_object[&p.root];
    for child in &p.transforms[&t].children {
        let id = child
            .resolve(env, t)?
            .context("Toggle child transform missing")?;
        let go = p.transforms[&id]
            .game_object
            .resolve(env, id)?
            .context("Toggle child object missing")?;
        toggle.order.push(p.objects[&go].name.clone());
    }
    let open_center = toggle.open.rect[0] + toggle.open.rect[2] / 2.0;
    let bar_center = toggle.bar.rect[0] + toggle.bar.rect[2] / 2.0;
    let on = (bar_center
        + toggle.states.get("on").context("Toggle on state missing")?["barOffset"]
            .as_f64()
            .context("Toggle on offset missing")?
        - open_center)
        .abs();
    let off = (bar_center
        + toggle
            .states
            .get("off")
            .context("Toggle off state missing")?["barOffset"]
            .as_f64()
            .context("Toggle off offset missing")?
        - open_center)
        .abs();
    (toggle.checked_state, toggle.unchecked_state) = if on >= off {
        ("on".into(), "off".into())
    } else {
        ("off".into(), "on".into())
    };
    let (id, button) = p.component(&root, "Button", None)?;
    let target = env
        .resolve(id, &button["m_TargetGraphic"])?
        .context("Toggle tint target missing")?;
    let target_tree = env.tree(target)?;
    toggle.tint_path = p.path(
        env.resolve(target, &target_tree["m_GameObject"])?
            .context("Toggle tint object missing")?,
    )?;
    let root = "setting_tab_dyn_illust";
    let p = Prefab::new(env, root, None)?;
    let tab = Tab {
        size: p.size,
        on: TabState {
            background: g.get(
                &p,
                &format!("{root}/state_on"),
                Some("native-setting-tab-on.png"),
            )?,
            text: g.get(&p, &format!("{root}/valuestr"), None)?,
        },
        off: TabState {
            background: g.get(
                &p,
                &format!("{root}/state_off"),
                Some("native-setting-tab-off.png"),
            )?,
            text: g.get(&p, &format!("{root}/valuestr"), None)?,
        },
    };
    Ok((
        volume,
        Settings {
            action,
            toggle,
            tabs: BTreeMap::from([("game".into(), tab.clone()), ("audio".into(), tab)]),
        },
    ))
}

pub async fn prepare(
    source: &Source,
    client: &ClientAssets,
    store: Arc<MediaStore>,
    common: Arc<Unity>,
) -> Result<String> {
    let locations = client
        .locate(&[(213, "image_judge_dialog_bkg".into())])
        .await?;
    let rows = &locations[&(213, "image_judge_dialog_bkg".into())];
    ensure!(rows.len() == 1, "Official dialog binding is not unique");
    let client_env = client
        .environment(&[rows[0].file.clone()], common.clone())
        .await?;
    let settings_path = source.bundle(SETTINGS, |_| {}).await?;
    let cancel = source.cancellation();
    tokio::task::spawn_blocking(move || {
        let settings_env = Unity::open(&[settings_path], cancel)?;
        let image = common.schema_with_field(114, "m_Sprite")?;
        let text = common.schema_with_field(114, "m_FontData")?;
        let g = Graphics {
            store: &store,
            image_schema: &image,
            text_schema: &text,
        };
        let dialogs = dialogs(&client_env, &g)?;
        let (volume, settings) = settings(&settings_env, &g)?;
        store.named(
            "native-widgets.json",
            &serde_json::to_vec(&Widgets {
                dialogs,
                volume,
                settings,
            })?,
        )
    })
    .await?
}
