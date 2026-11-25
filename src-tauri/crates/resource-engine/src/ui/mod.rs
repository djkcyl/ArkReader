pub mod application;
pub mod audio;
pub mod cursor;
mod sprites;
pub mod widgets;

use crate::{
    client_assets::{ClientAssets, ClientIdentity, Location},
    media::{self, MediaStore},
    prefab::{Pointer, Prefab},
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use serde::Serialize;
use std::{collections::BTreeSet, path::Path, sync::Arc};
use unity_rs_core::serialized::TypeTree;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreUiProfile {
    pub reference_resolution: [u32; 2],
    pub font: String,
    pub dialogue_frame: String,
    pub source: ClientIdentity,
    pub history_marker: String,
    #[serde(rename = "readerUI")]
    pub reader_ui: bool,
}

pub fn locate(env: &Unity, location: &Location) -> Result<ObjectId> {
    let filename = Path::new(&location.file)
        .file_name()
        .context("Missing client file name")?;
    let files: Vec<_> = env
        .studio
        .files()
        .filter(|f| Path::new(f.path()).file_name() == Some(filename))
        .collect();
    ensure!(
        files.len() == 1,
        "Client asset file is missing or ambiguous"
    );
    let id = ObjectId {
        file: files[0].index(),
        path: location.path_id,
    };
    let object = env.object(id)?;
    ensure!(
        object.class_id() == location.class_id && object.name() == Some(location.name.as_str()),
        "Official UI binding changed: {}",
        location.name
    );
    Ok(id)
}

fn bind_sprite(
    env: &Unity,
    role: &str,
    candidates: &[Location],
    schema: &TypeTree,
) -> Result<ObjectId> {
    if candidates.len() == 1 {
        return locate(env, &candidates[0]);
    }
    let (root, suffix) = match role {
        "native-control-skip.png" => ("AVGController", "/panel_avg/btn_skip/image"),
        "native-photo-dim.png" => ("slot_showItem_photo", "/black"),
        "native-quick-fill.png" => ("AVGController", "/panel_avg/btn_quickplay/slider/slider"),
        _ => ("AVGController", ""),
    };
    let prefab = Prefab::new(env, root, None)?;
    let mut selected = BTreeSet::new();
    for candidate in candidates {
        let id = locate(env, candidate)?;
        let pattern = [
            0i32.to_le_bytes().as_slice(),
            id.path.to_le_bytes().as_slice(),
        ]
        .concat();
        for object in env
            .studio
            .objects()
            .filter(|o| o.class_id() == 114 && o.file_index() == id.file)
        {
            let raw = object.read_raw(4 * 1024 * 1024)?;
            if !raw.windows(pattern.len()).any(|bytes| bytes == pattern) {
                continue;
            }
            let owner = ObjectId {
                file: object.file_index(),
                path: object.path_id(),
            };
            let Ok(tree) = env.tree_with_schema(owner, schema) else {
                continue;
            };
            let pointer: Pointer = serde_json::from_value(tree["m_Sprite"].clone())?;
            if pointer.resolve(env, owner)? != Some(id) {
                continue;
            }
            let go: Pointer = serde_json::from_value(tree["m_GameObject"].clone())?;
            let go = go
                .resolve(env, owner)?
                .context("UI Image has no GameObject")?;
            let path = prefab.path(go)?;
            if path.starts_with(&format!("{root}/")) && path.ends_with(suffix) {
                selected.insert(id);
            }
        }
    }
    ensure!(
        selected.len() == 1,
        "Official UI sprite binding is not unique: {role}"
    );
    Ok(*selected.first().unwrap())
}

pub async fn prepare_core(
    client: &ClientAssets,
    store: Arc<MediaStore>,
    common: Arc<Unity>,
) -> Result<CoreUiProfile> {
    let mut requested: BTreeSet<_> = sprites::PLAYER_SPRITES
        .iter()
        .map(|(_, name)| (213, name.to_string()))
        .collect();
    requested.extend([
        (128, "Novecentowide-Medium".into()),
        (128, "NotoSansHans-Medium".into()),
        (213, "sprite_playback_chosen".into()),
    ]);
    let locations = client
        .locate(&requested.into_iter().collect::<Vec<_>>())
        .await?;
    let files: BTreeSet<String> = locations
        .values()
        .flatten()
        .map(|r| r.file.clone())
        .collect();
    let env = client
        .environment(&files.into_iter().collect::<Vec<_>>(), common.clone())
        .await?;
    let identity = client.identity.clone();
    tokio::task::spawn_blocking(move || {
        let schema = common.schema_with_field(114, "m_Sprite")?;
        for (file, name) in [
            ("native-reader-auto.ttf", "Novecentowide-Medium"),
            ("native-dialog.ttf", "NotoSansHans-Medium"),
        ] {
            let rows = locations
                .get(&(128, name.into()))
                .context("Official UI font missing")?;
            ensure!(rows.len() == 1, "Official UI font is not unique");
            store.font(&env, locate(&env, &rows[0])?, Some(file))?;
        }
        for &(file, name) in sprites::PLAYER_SPRITES.iter().chain(std::iter::once(&(
            "native-playback-chosen.png",
            "sprite_playback_chosen",
        ))) {
            let rows = locations
                .get(&(213, name.into()))
                .context("Official UI sprite missing")?;
            let id = bind_sprite(&env, file, rows, &schema)?;
            let (mut image, _) = media::sprite(&env, id)?;
            if file == "native-photo-dim.png" {
                for pixel in image.pixels_mut() {
                    pixel[0] = 0;
                    pixel[1] = 0;
                    pixel[2] = 0;
                }
            }
            store.named_image(file, &image)?;
        }
        for &(file, name) in sprites::READER_SPRITES {
            let candidates: Vec<_> = common
                .studio
                .objects()
                .filter(|o| o.class_id() == 213 && o.name() == Some(name))
                .collect();
            ensure!(
                candidates.len() == 1,
                "Official reader UI sprite is not unique: {name}"
            );
            let object = candidates[0];
            let (image, _) = media::sprite(
                &common,
                ObjectId {
                    file: object.file_index(),
                    path: object.path_id(),
                },
            )?;
            store.named_image(file, &image)?;
        }
        Ok(CoreUiProfile {
            reference_resolution: [1280, 720],
            font: "/media/native-dialog.ttf".into(),
            dialogue_frame: "/media/native-dialog-frame.png".into(),
            source: identity,
            history_marker: "/media/native-playback-chosen.png".into(),
            reader_ui: true,
        })
    })
    .await?
}
