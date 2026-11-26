use crate::{
    client_assets::ClientAssets,
    flat::Flat,
    index,
    media::{Asset, MediaStore},
    model::Index,
    prefab::{Pointer, Prefab},
    source::Source,
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use unity_rs_core::serialized::TypeTree;

const SIGNALS: [(&str, &str); 5] = [
    ("default", "ui.ON_DEFAULT_BTN_CLICK"),
    ("cancel", "ui.ON_CANCEL_BTN_CLICK"),
    ("confirm", "ui.ON_CONFIRM_BTN_CLICK"),
    ("tab", "ui.ON_TAB_SWITCH_BTN_CLICK"),
    ("checkbox", "ui.ON_CHECKBOX_CLICK"),
];

#[derive(Clone, Debug, Serialize)]
pub struct Cue {
    pub key: String,
    pub signal: String,
    pub volume: f64,
    pub pitch: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}
pub struct AudioPlan {
    pub cues: BTreeMap<String, Cue>,
    pub bundles: BTreeMap<String, BTreeSet<String>>,
}

pub async fn plan(index: &Index, source: &Source) -> Result<AudioPlan> {
    let routes: Vec<_> = index
        .routes
        .iter()
        .filter(|(name, _)| name.starts_with("gamedata/excel/audio_data"))
        .map(|(_, r)| r)
        .collect();
    ensure!(
        routes.len() == 1,
        "Official interaction audio table is not unique"
    );
    let raw = index::read_route(source, routes[0]).await?;
    let f = Flat::new(&raw)?;
    let banks = f
        .vector(f.root()?, 6)?
        .into_iter()
        .map(|b| Ok((f.string(b, 14)?, b)))
        .collect::<Result<BTreeMap<_, _>>>()?;
    let mut cues = BTreeMap::new();
    let mut bundles: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (name, signal) in SIGNALS {
        let &bank = banks
            .get(signal)
            .context("Official interaction audio signal missing")?;
        let atoms = f.vector(bank, 4)?;
        ensure!(atoms.len() == 1, "Unsupported compound interaction audio");
        let atom = atoms[0];
        let asset = f.string(atom, 4)?;
        let key = asset.rsplit('/').next().unwrap_or_default().to_lowercase();
        let route = index
            .media
            .get(&key)
            .context("Interaction audio route missing")?;
        bundles
            .entry(route.bundle.clone())
            .or_default()
            .insert(key.clone());
        cues.insert(
            name.into(),
            Cue {
                key,
                signal: signal.into(),
                volume: f.float(atom, 6)?,
                pitch: f.float(atom, 16)?,
                url: None,
            },
        );
    }
    Ok(AudioPlan { cues, bundles })
}

fn tree(
    prefab: &Prefab<'_>,
    schemas: &BTreeMap<&str, TypeTree>,
) -> Result<BTreeMap<String, Option<Value>>> {
    let mut result = BTreeMap::new();
    for &go in prefab.objects.keys() {
        result.insert(prefab.path(go)?, None);
    }
    for object in prefab
        .env
        .studio
        .objects()
        .filter(|o| o.file_index() == prefab.root.file && o.class_id() == 114)
    {
        let id = ObjectId {
            file: object.file_index(),
            path: object.path_id(),
        };
        let row = if prefab.env.schema(id).is_ok() {
            prefab.env.tree(id)?
        } else {
            let class = prefab.env.script_name(id)?;
            let Some(schema) = schemas.get(class.as_str()) else {
                continue;
            };
            prefab.env.tree_with_schema(id, schema)?
        };
        let audio = if let Some(audio) = row.get("_audio") {
            audio.clone()
        } else if row.get("_soundType").is_some() {
            Value::Object(
                row.as_object()
                    .context("Invalid audio component")?
                    .iter()
                    .filter_map(|(k, v)| k.strip_prefix('_').map(|k| (k.to_owned(), v.clone())))
                    .collect(),
            )
        } else {
            continue;
        };
        if row["m_Enabled"].as_i64() == Some(0) || row["m_Enabled"].as_bool() == Some(false) {
            continue;
        }
        let kind = audio["soundType"]
            .as_i64()
            .context("Missing native click sound type")?;
        let cue = match kind {
            0 => Some("default"),
            1 => match audio["internalType"].as_i64() {
                Some(0) => Some("cancel"),
                Some(1) => Some("tab"),
                Some(2) => Some("checkbox"),
                Some(7) => Some("confirm"),
                _ => None,
            },
            _ => None,
        };
        let go: Pointer = serde_json::from_value(row["m_GameObject"].clone())?;
        let go = go
            .resolve(prefab.env, id)?
            .context("Audio component owner missing")?;
        result.insert(
            prefab.path(go)?,
            Some(json!({"cue":cue,"binding":audio,"unsupported":cue.is_none() && kind!=3})),
        );
    }
    Ok(result)
}

fn bind(
    bindings: &mut BTreeMap<String, Value>,
    tree: &BTreeMap<String, Option<Value>>,
    role: &str,
    path: &str,
) -> Result<()> {
    let value = tree
        .get(path)
        .with_context(|| format!("Official sound control path changed: {path}"))?;
    ensure!(
        !value.as_ref().is_some_and(|v| v["unsupported"] == true),
        "Unsupported original interaction sound: {path}"
    );
    let mut value = value.clone().unwrap_or_else(|| json!({"cue":null}));
    value["source"] = path.into();
    bindings.insert(role.into(), value);
    Ok(())
}

pub async fn prepare(
    index: &Index,
    source: &Source,
    client: &ClientAssets,
    store: Arc<MediaStore>,
    common: Arc<Unity>,
) -> Result<String> {
    let plan = plan(index, source).await?;
    let locations = client
        .locate(&[
            (213, "btn_setting".into()),
            (213, "image_judge_dialog_bkg".into()),
        ])
        .await?;
    let files: BTreeSet<String> = locations
        .values()
        .flatten()
        .map(|r| r.file.clone())
        .collect();
    let client_env = client
        .environment(&files.into_iter().collect::<Vec<_>>(), common.clone())
        .await?;
    let settings = source.bundle(super::widgets::SETTINGS).await?;
    let names: Vec<_> = plan.bundles.keys().cloned().collect();
    let paths = source.prefetch(&names, 4).await?;
    let paths: BTreeMap<_, _> = names.into_iter().zip(paths).collect();
    let cancel = source.cancellation();
    crate::runtime::blocking(move || {
        let schemas = BTreeMap::from([
            (
                "AudioClickPlayer",
                common.schema_with_field(114, "_soundType")?,
            ),
            ("UIButton", common.schema_with_field(114, "_audio")?),
        ]);
        let mut bindings = BTreeMap::new();
        let reader = Prefab::new(&common, "avg_reader_main_dialog", None)?;
        let reader_tree = tree(&reader, &schemas)?;
        for (role, node) in [
            ("settings", "btn_setting"),
            ("auto", "btn_auto"),
            ("auto-speed", "btn_auto/btn_speed"),
            ("skip", "btn_skip"),
            ("hide", "btn_hide"),
            ("reader-mode", "btn_readermode"),
            ("top", "btn_top"),
        ] {
            bind(
                &mut bindings,
                &reader_tree,
                &format!("reader.{role}"),
                &format!("avg_reader_main_dialog/panel_btns/{node}"),
            )?;
        }
        for (role, node) in [
            ("settings-close", "btn_setting"),
            ("settings-background", "bg"),
            (
                "font",
                "panel_ui/font_size_setting/toggle_size/Toggle/Background",
            ),
            (
                "spacing",
                "panel_ui/line_space_setting/toggle_size/Toggle/Background",
            ),
            (
                "alpha",
                "panel_ui/bg_alpha_setting/toggle_alpha/Toggle/Background",
            ),
            ("pure", "panel_ui/pure_mode_setting/Toggle/Background"),
        ] {
            bind(
                &mut bindings,
                &reader_tree,
                &format!("reader.{role}"),
                &format!("avg_reader_setting_dialog/{node}"),
            )?;
        }
        bind(
            &mut bindings,
            &reader_tree,
            "reader.choice",
            "avg_reader_text_item/options/avg_reader_desicion_item",
        )?;
        let core = Prefab::new(&client_env, "AVGController", None)?;
        let core_tree = tree(&core, &schemas)?;
        for (role, node) in [
            ("settings", "btn_setting"),
            ("auto", "btn_auto"),
            ("auto-speed", "btn_auto/btn_speed"),
            ("skip", "btn_skip"),
            ("hide", "btn_hide"),
            ("log", "btn_log"),
            ("log-back", "panel_playback/btn_back"),
            ("choice", "panel_decision/option_1"),
            ("quick-speed", "btn_quickplay/speedBtn/buttons/0"),
            ("advance", "btn_click"),
        ] {
            bind(
                &mut bindings,
                &core_tree,
                &format!("normal.{role}"),
                &format!("AVGController/UICanvas/panel_static_padding/panel_avg/{node}"),
            )?;
        }
        bind(
            &mut bindings,
            &core_tree,
            "normal.reader-mode",
            "AVGController/UICanvas/panel_stateengine/state_default/panel_btn/reader_btn",
        )?;
        for (role, node) in [
            ("settings-close", "panel_setting/btn_setting (1)"),
            ("settings-background", "panel_setting/bg_blocker"),
            (
                "font",
                "panel_setting/font_size_setting (1)/toggle_size/Toggle/Background",
            ),
            ("skip-confirm", "panel_brief/confirm/btn_confirm"),
            ("skip-cancel", "panel_brief/confirm/btn_cancel"),
        ] {
            bind(
                &mut bindings,
                &core_tree,
                &format!("normal.{role}"),
                &format!("AVGController/UICanvas/panel_static_padding_top/panel_avg/{node}"),
            )?;
        }
        for (role, path) in [
            ("ok", "panel_ok_dialog/btn_confirm"),
            ("confirm", "panel_judge_dialog/btn_confirm/panel_hotspot"),
            ("cancel", "panel_judge_dialog/btn_cancel/btn_negative"),
        ] {
            bind(&mut bindings, &core_tree, &format!("prompt.{role}"), path)?;
        }
        let settings = Unity::open(&[settings], cancel.clone())?;
        let settings = Prefab::new(&settings, "setting_state", None)?;
        let settings_tree = tree(&settings, &schemas)?;
        for (role, suffix) in [
            ("action", "/panel_customize/button_customize"),
            ("toggle", "/panel_music/button_music_flag/setting_button"),
            ("volume", "/panel_music/slider_music_volumn/setting_slider"),
            ("category-tab", "/tab_buttons/tab_audio"),
        ] {
            let matches: Vec<_> = settings_tree
                .keys()
                .filter(|path| path.ends_with(suffix))
                .collect();
            ensure!(
                matches.len() == 1,
                "Official settings sound path is not unique"
            );
            bind(
                &mut bindings,
                &settings_tree,
                &format!("settings.{role}"),
                matches[0],
            )?;
        }
        bind(
            &mut bindings,
            &settings_tree,
            "settings.tab",
            "setting_tab_dyn_illust",
        )?;
        let mut cues = plan.cues;
        let mut clips = BTreeMap::new();
        for (bundle, keys) in plan.bundles {
            let env = Unity::open(&[paths[&bundle].clone()], cancel.clone())?;
            for object in env.studio.objects().filter(|o| o.class_id() == 83) {
                let name = object.name().unwrap_or_default().to_lowercase();
                if !keys.contains(&name) {
                    continue;
                }
                let asset = store.audio(
                    &env,
                    ObjectId {
                        file: object.file_index(),
                        path: object.path_id(),
                    },
                )?;
                let Asset::Audio { url } = asset else {
                    unreachable!()
                };
                clips.insert(name, url);
            }
        }
        for cue in cues.values_mut() {
            cue.url = Some(
                clips
                    .get(&cue.key)
                    .context("Official interaction sound missing")?
                    .clone(),
            );
        }
        store.named(
            "native-ui-audio.json",
            &serde_json::to_vec(&json!({"bindings":bindings,"cues":cues}))?,
        )
    })
    .await?
}
