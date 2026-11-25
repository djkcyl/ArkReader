use crate::{
    catalog::Group,
    effects::scene::{array, number, truth},
    media::{self, ImageFile, MediaStore},
    model::{Index, Route},
    special,
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Art {
    Sprite(Route),
    Collection { bundle: String, number: usize },
}
impl Art {
    pub fn bundle(&self) -> &str {
        match self {
            Self::Sprite(route) => &route.bundle,
            Self::Collection { bundle, .. } => bundle,
        }
    }
}

pub fn binding(index: &Index, group: &Group) -> Result<Option<Art>> {
    let id = group.id.as_str();
    if let Some(number) = special::collection_number(id) {
        let matches = index
            .routes
            .iter()
            .filter(|(key, _)| key.as_str() == "ui/activity/actfun/actfun_collection_dlg")
            .map(|(_, r)| r)
            .collect::<Vec<_>>();
        ensure!(
            matches.len() == 1,
            "Official collection cover route missing"
        );
        return Ok(Some(Art::Collection {
            bundle: matches[0].bundle.clone(),
            number,
        }));
    }
    if let Some(key) = group.art_key.as_deref().filter(|s| !s.is_empty()) {
        return Ok(index.routes.get(key).cloned().map(Art::Sprite));
    }
    if id.starts_with("char_") {
        return Ok(index
            .routes
            .get(&format!("arts/charportraits/{id}_1"))
            .or_else(|| {
                index
                    .routes
                    .get(&format!("arts/charportraits/linkages/{id}_1"))
            })
            .cloned()
            .map(Art::Sprite));
    }
    if id.starts_with("main_") {
        return Ok(index
            .routes
            .get(&format!("arts/ui/mainmission/{id}"))
            .cloned()
            .map(Art::Sprite));
    }
    let id = if id == "1stact" { "act1d0" } else { id };
    if !id.starts_with("act") {
        return Ok(None);
    }
    let suffix = format!("/storyentrypic_{id}");
    let matches = index
        .routes
        .iter()
        .filter(|(key, _)| key.starts_with("arts/ui/storyreview/") && key.ends_with(&suffix))
        .map(|(_, route)| route)
        .collect::<Vec<_>>();
    ensure!(matches.len() <= 1, "Ambiguous official story cover");
    Ok(matches.first().map(|route| Art::Sprite((*route).clone())))
}

pub fn export(env: &Unity, store: &MediaStore, binding: &Art) -> Result<ImageFile> {
    let image = match binding {
        Art::Sprite(route) => {
            let container = route
                .container
                .as_deref()
                .context("Cover container missing")?;
            let candidates = env
                .containers
                .get(&container.to_lowercase())
                .context("Official cover missing")?;
            let sprite = candidates
                .iter()
                .copied()
                .find(|&id| env.object(id).is_ok_and(|o| o.class_id() == 213));
            if let Some(id) = sprite {
                media::sprite(env, id)?.0
            } else {
                let id = candidates
                    .iter()
                    .copied()
                    .find(|&id| env.object(id).is_ok_and(|o| o.class_id() == 28))
                    .context("Cover has no supported image object")?;
                media::texture(env, id)?
            }
        }
        Art::Collection {
            number: collection_index,
            ..
        } => {
            let candidates = env
                .primary_objects()
                .filter(|o| o.class_id() == 114 && o.name() == Some("actfun_collection"))
                .collect::<Vec<_>>();
            ensure!(
                candidates.len() == 1,
                "Official collection atlas is not unique"
            );
            let object = candidates[0];
            let id = ObjectId {
                file: object.file_index(),
                path: object.path_id(),
            };
            let data = env.tree(id)?;
            let name = format!("img_actfun{collection_index}");
            let sprite = array(&data["_sprites"])?
                .iter()
                .find(|s| s["name"].as_str() == Some(&name))
                .context("Official collection sprite missing")?;
            let atlas = array(&data["_atlases"])?
                .iter()
                .find(|a| a["index"] == sprite["atlas"])
                .context("Official collection atlas page missing")?;
            let texture = env
                .resolve(id, &atlas["texture"])?
                .context("Collection texture missing")?;
            let mut image = media::texture(env, texture)?;
            if let Some(alpha) = env.resolve(id, &atlas["alpha"])? {
                let alpha = media::texture(env, alpha)?;
                ensure!(
                    alpha.dimensions() == image.dimensions(),
                    "Collection alpha dimensions differ"
                );
                for (p, a) in image.pixels_mut().zip(alpha.pixels()) {
                    p[3] = a[0];
                }
            }
            let rect = &sprite["rect"];
            let coordinate = |key: &str| -> Result<u32> {
                let value = number(&rect[key])?;
                ensure!(
                    value >= 0.0 && value <= u32::MAX as f64,
                    "Invalid collection sprite coordinate"
                );
                Ok(value.round() as u32)
            };
            let x = coordinate("x")?;
            let y = coordinate("y")?;
            let w = coordinate("w")?;
            let h = coordinate("h")?;
            ensure!(
                x.checked_add(w).is_some_and(|v| v <= image.width())
                    && y.checked_add(h).is_some_and(|v| v <= image.height()),
                "Collection sprite lies outside atlas"
            );
            let image =
                image::imageops::crop_imm(&image, x, image.height() - y - h, w, h).to_image();
            if truth(&sprite["rotate"]) {
                image::imageops::rotate270(&image)
            } else {
                image
            }
        }
    };
    store.webp(&image)
}
