use crate::{
    media::{self, AlphaSources, Asset, CharacterLayout, Composition, ImageFile, MediaStore, Rect},
    prefab::{Pointer, RectTransform, Vec2},
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use image::RgbaImage;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use unity_rs_core::{serialized::ObjectReference, sprite::Sprite};

#[derive(Debug, PartialEq, Eq)]
pub struct CharacterRef<'a> {
    pub base: &'a str,
    pub expression: i32,
    pub body: i32,
    pub alias: Option<String>,
}
impl<'a> CharacterRef<'a> {
    pub fn parse(mut key: &'a str) -> Self {
        let mut body = 0;
        if let Some((base, suffix)) = key.rsplit_once('$') {
            if let Ok(number) = suffix.trim().parse::<i32>() {
                body = number.wrapping_sub(1);
                key = base;
            }
        }
        if let Some((base, alias)) = key.rsplit_once('@') {
            return Self {
                base,
                expression: 0,
                body,
                alias: Some(format!("@{alias}")),
            };
        }
        let mut expression = 0;
        if let Some((base, suffix)) = key.rsplit_once('#') {
            if let Ok(number) = suffix.trim().parse::<i32>() {
                expression = number.wrapping_sub(1);
                key = base;
            }
        }
        Self {
            base: key,
            expression,
            body,
            alias: None,
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpriteItem {
    sprite: Pointer,
    #[serde(default)]
    alpha_tex: Pointer,
    #[serde(default)]
    alias: String,
    #[serde(default)]
    is_whole_body: u8,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpriteGroup {
    sprites: Vec<SpriteItem>,
    #[serde(default)]
    face_pos: Vec2,
    #[serde(default)]
    face_size: Vec2,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hub {
    #[serde(default)]
    sprite_groups: Vec<SpriteGroup>,
    #[serde(default)]
    sprites: Vec<SpriteItem>,
    #[serde(rename = "FacePos", default)]
    face_pos: Vec2,
    #[serde(rename = "FaceSize", default)]
    face_size: Vec2,
}

struct SpriteSource<'a> {
    env: &'a Unity,
    store: &'a MediaStore,
}
impl SpriteSource<'_> {
    fn sprite(&self, owner: ObjectId, item: &SpriteItem) -> Result<(ObjectId, Sprite)> {
        let id = item
            .sprite
            .resolve(self.env, owner)?
            .context("Character sprite is missing")?;
        Ok((id, self.env.object(id)?.read_sprite(Default::default())?))
    }
    fn alpha(
        &self,
        owner: ObjectId,
        item: &SpriteItem,
        id: ObjectId,
        sprite: &Sprite,
    ) -> Result<Option<ObjectId>> {
        if item.alpha_tex.path != 0 {
            item.alpha_tex.resolve(self.env, owner)
        } else {
            let alpha = sprite.render_data.alpha_texture;
            self.env.reference(
                id,
                ObjectReference {
                    file_id: alpha.file_id,
                    path_id: alpha.path_id,
                },
            )
        }
    }
    fn rgba(&self, owner: ObjectId, item: &SpriteItem) -> Result<(RgbaImage, Sprite)> {
        let (id, sprite) = self.sprite(owner, item)?;
        let mut image = media::texture(self.env, media::texture_id(self.env, id, &sprite)?)?;
        if let Some(alpha) = self.alpha(owner, item, id, &sprite)? {
            let alpha = media::texture(self.env, alpha)?;
            let alpha = if alpha.dimensions() != image.dimensions() {
                media::resize_linear(&alpha, image.width(), image.height())?
            } else {
                alpha
            };
            for (pixel, alpha) in image.pixels_mut().zip(alpha.pixels()) {
                pixel[3] = alpha[0];
            }
        }
        Ok((image, sprite))
    }
    fn color(&self, owner: ObjectId, item: &SpriteItem) -> Result<ImageFile> {
        let (id, sprite) = self.sprite(owner, item)?;
        self.store.image(&media::texture(
            self.env,
            media::texture_id(self.env, id, &sprite)?,
        )?)
    }
    fn alpha_image(
        &self,
        owner: ObjectId,
        item: &SpriteItem,
        split: bool,
        dynamic: bool,
    ) -> Result<Option<ImageFile>> {
        let (id, sprite) = self.sprite(owner, item)?;
        let alpha = self.alpha(owner, item, id, &sprite)?;
        if split && dynamic && alpha.is_none() {
            return Ok(None);
        }
        let texture = if split {
            alpha.context("Character has no split alpha texture")?
        } else {
            media::texture_id(self.env, id, &sprite)?
        };
        let mut image = media::texture(self.env, texture)?;
        for pixel in image.pixels_mut() {
            let a = pixel[if split { 0 } else { 3 }];
            *pixel = image::Rgba([a, a, a, 255]);
        }
        Ok(Some(self.store.image(&image)?))
    }
    fn sources(
        &self,
        owner: ObjectId,
        body: &SpriteItem,
        face: Option<(&SpriteItem, Rect)>,
    ) -> Result<AlphaSources> {
        let (id, sprite) = self.sprite(owner, body)?;
        let split = self.alpha(owner, body, id, &sprite)?.is_some();
        let color_main = self.color(owner, body)?;
        let mut result = AlphaSources {
            main: self
                .alpha_image(owner, body, split, false)?
                .context("Character alpha image missing")?,
            color_main,
            split,
            face: None,
            color_face: None,
            face_rect: None,
        };
        if let Some((face, rect)) = face {
            result.color_face = Some(self.color(owner, face)?);
            result.face = self.alpha_image(owner, face, split, true)?;
            if result.face.is_some() {
                result.face_rect = Some(Rect {
                    x: rect.x / result.color_main.width as f64,
                    y: rect.y / result.color_main.height as f64,
                    width: rect.width / result.color_main.width as f64,
                    height: rect.height / result.color_main.height as f64,
                });
            }
        }
        Ok(result)
    }
}

pub fn export(
    env: &Unity,
    store: &MediaStore,
    wanted: &BTreeSet<String>,
) -> Result<BTreeMap<String, Asset>> {
    let mut output = BTreeMap::new();
    let mut layout = None;
    for object in env.primary_objects().filter(|o| o.class_id() == 224) {
        let id = ObjectId {
            file: object.file_index(),
            path: object.path_id(),
        };
        let t: RectTransform = serde_json::from_value(env.tree(id)?)?;
        if t.father.path == 0 {
            layout = Some(CharacterLayout {
                position: t.position,
                size: t.size,
                pivot: t.pivot,
                scale: t.scale,
            });
        }
    }
    let source = SpriteSource { env, store };
    for object in env.primary_objects().filter(|o| o.class_id() == 114) {
        let owner = ObjectId {
            file: object.file_index(),
            path: object.path_id(),
        };
        let tree = env.tree(owner)?;
        if tree.get("spriteGroups").is_none() && tree.get("sprites").is_none() {
            continue;
        }
        let hub: Hub = serde_json::from_value(tree)?;
        let groups = if hub.sprite_groups.is_empty() {
            vec![SpriteGroup {
                sprites: hub.sprites,
                face_pos: hub.face_pos,
                face_size: hub.face_size,
            }]
        } else {
            hub.sprite_groups
        };
        if groups.is_empty() {
            continue;
        }
        for key in wanted {
            let requested = CharacterRef::parse(key);
            let body = usize::try_from(requested.body)
                .ok()
                .filter(|&n| n < groups.len())
                .unwrap_or(0);
            let group = &groups[body];
            ensure!(!group.sprites.is_empty(), "Empty character sprite group");
            let selected = requested
                .alias
                .as_ref()
                .map(|alias| {
                    group
                        .sprites
                        .iter()
                        .position(|item| &item.alias == alias)
                        .unwrap_or(0)
                })
                .unwrap_or_else(|| {
                    usize::try_from(requested.expression)
                        .ok()
                        .filter(|&n| n < group.sprites.len())
                        .unwrap_or(0)
                });
            let item = &group.sprites[selected];
            let composite = group.face_size.x > 0.0
                && group.face_size.y > 0.0
                && item.is_whole_body == 0
                && selected != group.sprites.len() - 1;
            let (image, sprite, alpha, composition) = if composite {
                let body_item = group.sprites.last().unwrap();
                let (body_image, sprite) = source.rgba(owner, body_item)?;
                let (face, _) = source.rgba(owner, item)?;
                let rect = Rect {
                    x: group.face_pos.x,
                    y: group.face_pos.y,
                    width: group.face_size.x,
                    height: group.face_size.y,
                };
                (
                    media::replace_face(&body_image, &face, rect)?,
                    sprite,
                    source.sources(owner, body_item, Some((item, rect)))?,
                    Some(Composition {
                        kind: "body-face".into(),
                        body_index: body,
                        expression_index: selected,
                        face_rect: rect,
                        body_path_id: body_item.sprite.path.to_string(),
                        face_path_id: item.sprite.path.to_string(),
                        sampling: "bilinear-rgba-replacement".into(),
                    }),
                )
            } else {
                let (image, sprite) = source.rgba(owner, item)?;
                (image, sprite, source.sources(owner, item, None)?, None)
            };
            let mut asset = store.image_asset(&image, Some(&sprite))?;
            asset.alpha_sources = Some(alpha);
            asset.layout = layout.clone();
            asset.composition = composition;
            ensure!(
                output
                    .insert(key.clone(), Asset::Image(Box::new(asset)))
                    .is_none(),
                "Ambiguous character sprite hub"
            );
        }
    }
    Ok(output)
}
