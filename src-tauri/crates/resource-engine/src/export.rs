use crate::{
    character,
    client_assets::ClientAssets,
    media::{self, Asset, ImageEffectTexture, MediaStore},
    model::Index,
    planning,
    source::Source,
    stamp,
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

#[derive(Clone)]
pub struct Exporter {
    pub source: Source,
    pub index: Arc<Index>,
    pub client: ClientAssets,
    pub store: Arc<MediaStore>,
}
impl Exporter {
    pub async fn open(&self, bundle: &str) -> Result<Unity> {
        let own = BTreeSet::from([bundle.to_owned()]);
        let deps = planning::dependencies(&self.index, &own);
        let names: Vec<_> = std::iter::once(bundle.to_owned()).chain(deps).collect();
        let paths = self.source.prefetch(&names, 4, |_| {}).await?;
        let inputs = names.into_iter().zip(paths).collect::<Vec<_>>();
        let cancel = self.source.cancellation();
        tokio::task::spawn_blocking(move || Unity::open_named(&inputs, cancel)).await?
    }

    pub async fn fonts(&self, wanted: &BTreeSet<String>) -> Result<BTreeMap<String, String>> {
        if wanted.is_empty() {
            return Ok(BTreeMap::new());
        }
        let requests = wanted
            .iter()
            .map(|name| (128, name.clone()))
            .collect::<Vec<_>>();
        let locations = self.client.locate(&requests).await?;
        let mut result = BTreeMap::new();
        for ((_, name), rows) in locations {
            let mut contents = BTreeMap::new();
            for row in rows {
                let path = self.client.file(&row.file).await?;
                let cancel = self.source.cancellation();
                let bytes = tokio::task::spawn_blocking(move || {
                    let env = Unity::open(&[path], cancel)?;
                    let id = crate::ui::locate(&env, &row)?;
                    let font = env.object(id)?.read_font(Default::default())?;
                    let bytes = font.payload.read_to_vec(128 * 1024 * 1024)?;
                    ensure!(!bytes.is_empty(), "Official font is empty");
                    Ok::<_, anyhow::Error>(bytes)
                })
                .await??;
                contents.insert(format!("{:x}", Sha256::digest(&bytes)), bytes);
            }
            ensure!(
                contents.len() == 1,
                "Official font name has different contents: {name}"
            );
            let bytes = contents.into_values().next().unwrap();
            result.insert(name, self.store.bytes(&bytes, "otf")?);
        }
        Ok(result)
    }

    pub async fn bundle(
        &self,
        bundle: &str,
        wanted: &BTreeSet<String>,
        tiled: &BTreeSet<String>,
    ) -> Result<BTreeMap<String, Asset>> {
        let env = Arc::new(self.open(bundle).await?);
        let fonts = if bundle == "avg/[uc]common.ab" {
            let input = env.clone();
            let keys = wanted.clone();
            let names = tokio::task::spawn_blocking(move || {
                let mut names = BTreeSet::new();
                for key in keys {
                    names.extend(crate::interlude::font_names(&input, &key)?);
                }
                Ok::<_, anyhow::Error>(names)
            })
            .await??;
            self.fonts(&names).await?
        } else if bundle.starts_with("avg/animatetext/")
            || bundle.starts_with("avg/animatedkv/")
            || bundle.starts_with("avg/spellsticker/")
        {
            let input = env.clone();
            let names = tokio::task::spawn_blocking(move || stamp::font_names(&input)).await??;
            self.fonts(&names).await?
        } else {
            BTreeMap::new()
        };
        let bundle = bundle.to_owned();
        let wanted = wanted.clone();
        let tiled = tiled.clone();
        let store = self.store.clone();
        let index = self.index.clone();
        let source = self.source.clone();
        let cancel = self.source.cancellation();
        tokio::task::spawn_blocking(move || {
            crate::error::checkpoint(&cancel)?;
            if bundle.starts_with("avg/characters/") {
                return character::export(&env, &store, &wanted);
            }
            if bundle.starts_with("avg/effects/") || bundle == "avg/fx/battle.ab" {
                return wanted
                    .iter()
                    .map(|key| {
                        Ok((
                            key.clone(),
                            crate::effects::export(&env, &source, &bundle, key, &store)?,
                        ))
                    })
                    .collect();
            }
            if bundle.starts_with("avg/animatetext/") {
                let md5 = &index.source.entries[&bundle].md5;
                return wanted
                    .iter()
                    .map(|key| {
                        Ok((
                            key.clone(),
                            stamp::export(&env, &store, &bundle, md5, key, &fonts)?,
                        ))
                    })
                    .collect();
            }
            if bundle.starts_with("avg/animatedkv/") || bundle.starts_with("avg/spellsticker/") {
                return wanted
                    .iter()
                    .map(|key| {
                        Ok((
                            key.clone(),
                            crate::animated_ui::export(
                                &env, &source, &store, &bundle, key, &fonts,
                            )?,
                        ))
                    })
                    .collect();
            }
            if bundle == "avg/[uc]common.ab" {
                let md5 = &index.source.entries[&bundle].md5;
                return wanted
                    .iter()
                    .map(|key| {
                        Ok((
                            key.clone(),
                            crate::interlude::export(&env, &store, &bundle, md5, key, &fonts)?,
                        ))
                    })
                    .collect();
            }
            generic(
                &env,
                &store,
                &bundle,
                &index.source.entries[&bundle].md5,
                &wanted,
                &tiled,
            )
        })
        .await?
    }
}

fn sampler(env: &Unity, id: ObjectId) -> Result<(i64, i64, i64)> {
    let settings = env.field(id, "m_TextureSettings")?;
    Ok((
        settings["m_FilterMode"]
            .as_i64()
            .context("Texture filter mode missing")?,
        settings["m_WrapU"]
            .as_i64()
            .context("Texture U sampler missing")?,
        settings["m_WrapV"]
            .as_i64()
            .context("Texture V sampler missing")?,
    ))
}

fn generic(
    env: &Unity,
    store: &MediaStore,
    bundle: &str,
    md5: &str,
    wanted: &BTreeSet<String>,
    tiled: &BTreeSet<String>,
) -> Result<BTreeMap<String, Asset>> {
    let mut result = BTreeMap::new();
    if bundle.starts_with("avg/items/")
        || bundle.starts_with("cutin/characters/")
        || bundle.starts_with("spritepack/cutin_char_")
    {
        for (path, candidates) in &env.containers {
            let key = std::path::Path::new(path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_lowercase();
            if !wanted.contains(&key) {
                continue;
            }
            for &id in candidates.iter().filter(|&&id| {
                env.primary_files.contains(&id.file)
                    && env.object(id).is_ok_and(|o| o.class_id() == 213)
            }) {
                let (image, sprite) = media::sprite(env, id)?;
                let width = sprite.rect.width.round() as u32;
                let height = sprite.rect.height.round() as u32;
                ensure!(
                    width > 0 && height > 0 && (width as u64) * (height as u64) <= 64 * 1024 * 1024,
                    "Invalid item canvas dimensions"
                );
                let mut canvas = image::RgbaImage::new(width, height);
                let offset = sprite.render_data.texture_rect_offset;
                image::imageops::replace(
                    &mut canvas,
                    &image,
                    offset.x.round() as i64,
                    height as i64 - image.height() as i64 - offset.y.round() as i64,
                );
                result.insert(
                    key.clone(),
                    Asset::Image(Box::new(store.image_asset(&canvas, Some(&sprite))?)),
                );
            }
        }
        return Ok(result);
    }
    for object in env
        .primary_objects()
        .filter(|o| matches!(o.class_id(), 28 | 83 | 213))
    {
        let id = ObjectId {
            file: object.file_index(),
            path: object.path_id(),
        };
        let key = object.name().unwrap_or_default().to_lowercase();
        let full_key = format!("imgfx:{key}");
        if object.class_id() == 213 && wanted.contains(&full_key) {
            let sprite = object.read_sprite(Default::default())?;
            let texture = media::texture_id(env, id, &sprite)?;
            let (filter, wrap_u, wrap_v) = sampler(env, texture)?;
            ensure!(
                [0, 1].contains(&filter) && [0, 1].contains(&wrap_u) && [0, 1].contains(&wrap_v),
                "Unsupported image effect texture sampler"
            );
            let image = media::texture(env, texture)?;
            let mut asset = store.image_asset(&image, None)?;
            asset.image_effect_texture = Some(ImageEffectTexture {
                file: asset.file.clone(),
                kind: "image".into(),
                filter,
                wrap_u,
                wrap_v,
                bundle: bundle.into(),
                md5: md5.into(),
                texture_id: texture.path.to_string(),
            });
            result.insert(full_key, Asset::Image(Box::new(asset)));
        }
        if !wanted.contains(&key) {
            continue;
        }
        if object.class_id() == 83 {
            result.insert(key, store.audio(env, id)?);
        } else if object.class_id() == 213 {
            let (image, sprite) = media::sprite(env, id)?;
            let mut asset = store.image_asset(&image, Some(&sprite))?;
            if tiled.contains(&key) {
                let b = sprite.border;
                asset.border = Some([b.x.into(), b.y.into(), b.z.into(), b.w.into()]);
                let (_, wrap_u, _) = sampler(env, media::texture_id(env, id, &sprite)?)?;
                asset.tile_repeat_uv = Some(!sprite.render_data.settings.packed && wrap_u == 0);
            }
            result.insert(key, Asset::Image(Box::new(asset)));
        } else if let std::collections::btree_map::Entry::Vacant(e) = result.entry(key) {
            e.insert(Asset::Image(Box::new(
                store.image_asset(&media::texture(env, id)?, None)?,
            )));
        }
    }
    Ok(result)
}
