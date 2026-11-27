use crate::{
    cache::{safe_path, write_atomic},
    prefab::Vec2,
    unity::{ObjectId, Unity},
};
use anyhow::{ensure, Context, Result};
use image::{ImageEncoder, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use unity_rs_core::{
    serialized::ObjectReference,
    simple_assets::SimpleAssetReadLimits,
    sprite::{Sprite, SpriteReadLimits},
    texture::{read_texture2d, TextureFormat, TextureReadLimits},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImageFile {
    pub url: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteMetadata {
    pub pivot: Vec2,
    pub rect: Rect,
    pub pixels_per_unit: f64,
    pub texture_rect: Rect,
    pub texture_rect_offset: Vec2,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlphaSources {
    pub main: ImageFile,
    pub color_main: ImageFile,
    pub split: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub face: Option<ImageFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_face: Option<ImageFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub face_rect: Option<Rect>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CharacterLayout {
    pub position: Vec2,
    pub size: Vec2,
    pub pivot: Vec2,
    pub scale: crate::prefab::Vec3,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Composition {
    pub kind: String,
    pub body_index: usize,
    pub expression_index: usize,
    pub face_rect: Rect,
    pub body_path_id: String,
    pub face_path_id: String,
    pub sampling: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAsset {
    #[serde(flatten)]
    pub file: ImageFile,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub sprite: Option<SpriteMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<[f64; 4]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tile_repeat_uv: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alpha_sources: Option<AlphaSources>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<CharacterLayout>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composition: Option<Composition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_effect_texture: Option<ImageEffectTexture>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEffectTexture {
    #[serde(flatten)]
    pub file: ImageFile,
    pub kind: String,
    pub filter: i64,
    pub wrap_u: i64,
    pub wrap_v: i64,
    pub bundle: String,
    pub md5: String,
    pub texture_id: String,
}
impl ImageAsset {
    pub fn new(file: ImageFile) -> Self {
        Self {
            file,
            sprite: None,
            border: None,
            tile_repeat_uv: None,
            alpha_sources: None,
            layout: None,
            composition: None,
            image_effect_texture: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Asset {
    Image(Box<ImageAsset>),
    Audio { url: String },
    Video(VideoAsset),
    Effect(EffectAsset),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MovieTrack {
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VideoAsset {
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub codecs: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<MovieTrack>,
    pub bundle: String,
    pub md5: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EffectAsset {
    pub url: String,
    #[serde(flatten)]
    pub content: EffectContent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EffectContent {
    Particle {
        profile: serde_json::Value,
    },
    Stamp {
        stamp: serde_json::Value,
    },
    AnimatedKv {
        #[serde(rename = "animatedKV")]
        animated_kv: serde_json::Value,
    },
    Interlude {
        interlude: serde_json::Value,
    },
}

pub struct MediaStore {
    pub directory: PathBuf,
}
impl MediaStore {
    pub fn new(path: &Path) -> Result<Self> {
        fs::create_dir_all(path)?;
        Ok(Self {
            directory: path.to_owned(),
        })
    }
    pub fn bytes(&self, data: &[u8], extension: &str) -> Result<String> {
        ensure!(
            extension.bytes().all(|b| b.is_ascii_alphanumeric()),
            "Invalid media extension"
        );
        let digest = format!("{:x}", Sha256::digest(data));
        let name = format!("{digest}.{extension}");
        let path = self.directory.join(&name);
        if !path.exists() {
            write_atomic(&path, data)?;
        }
        Ok(format!("/media/{name}"))
    }
    pub fn named(&self, name: &str, data: &[u8]) -> Result<String> {
        write_atomic(&safe_path(&self.directory, name)?, data)?;
        Ok(format!("/media/{name}"))
    }
    pub fn image(&self, image: &RgbaImage) -> Result<ImageFile> {
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new_with_quality(
            &mut bytes,
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::Adaptive,
        )
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )?;
        Ok(ImageFile {
            url: self.bytes(&bytes, "png")?,
            width: image.width(),
            height: image.height(),
        })
    }
    pub fn named_image(&self, name: &str, image: &RgbaImage) -> Result<String> {
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new_with_quality(
            &mut bytes,
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::Adaptive,
        )
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )?;
        self.named(name, &bytes)
    }

    pub fn webp(&self, image: &RgbaImage) -> Result<ImageFile> {
        let mut bytes = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut bytes).write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )?;
        Ok(ImageFile {
            url: self.bytes(&bytes, "webp")?,
            width: image.width(),
            height: image.height(),
        })
    }
    pub fn audio(&self, env: &Unity, id: ObjectId) -> Result<Asset> {
        let clip = env
            .object(id)?
            .read_audio_clip(SimpleAssetReadLimits::default())?;
        let kind = clip
            .direct_wav
            .context("Unsupported official audio codec")?;
        let mut output = Vec::new();
        unity_rs_core::audio::write_direct_wav(
            &clip.payload,
            kind,
            256 * 1024 * 1024,
            &mut output,
        )?;
        Ok(Asset::Audio {
            url: self.bytes(&output, "wav")?,
        })
    }
    pub fn font(&self, env: &Unity, id: ObjectId, name: Option<&str>) -> Result<String> {
        let font = env
            .object(id)?
            .read_font(SimpleAssetReadLimits::default())?;
        let bytes = font.payload.read_to_vec(32 * 1024 * 1024)?;
        ensure!(!bytes.is_empty(), "Official font is empty");
        name.map_or_else(
            || self.bytes(&bytes, "otf"),
            |name| self.named(name, &bytes),
        )
    }
    pub fn image_asset(&self, image: &RgbaImage, sprite: Option<&Sprite>) -> Result<ImageAsset> {
        let mut result = ImageAsset::new(self.image(image)?);
        if let Some(sprite) = sprite {
            result.sprite = Some(sprite_metadata(sprite));
        }
        Ok(result)
    }
}

pub fn texture(env: &Unity, id: ObjectId) -> Result<RgbaImage> {
    let object = env.object(id)?;
    let collection = env.studio.collection();
    let source = read_texture2d(
        collection,
        &collection.serialized_files()[id.file].file,
        object.object_index(),
        TextureReadLimits::default(),
    )?;
    let rgba = source.decode_mip_rgba8(0, TextureReadLimits::default())?;
    let mut image = RgbaImage::from_raw(rgba.width, rgba.height, rgba.pixels)
        .context("Invalid decoded texture dimensions")?;
    image::imageops::flip_vertical_in_place(&mut image);
    if source.format == TextureFormat::ALPHA8 {
        alpha_only_color(&mut image);
    }
    Ok(image)
}
pub fn sprite(env: &Unity, id: ObjectId) -> Result<(RgbaImage, Sprite)> {
    let object = env.object(id)?;
    let metadata = object.read_sprite(SpriteReadLimits::default())?;
    let rgba = object.decode_sprite(SpriteReadLimits::default(), TextureReadLimits::default())?;
    let mut image = RgbaImage::from_raw(rgba.width, rgba.height, rgba.pixels)
        .context("Invalid decoded sprite dimensions")?;
    let pointer = metadata.render_data.texture;
    if let Some(texture) = env.reference(
        id,
        ObjectReference {
            file_id: pointer.file_id,
            path_id: pointer.path_id,
        },
    )? {
        let object = env.object(texture)?;
        let collection = env.studio.collection();
        let source = read_texture2d(
            collection,
            &collection.serialized_files()[texture.file].file,
            object.object_index(),
            TextureReadLimits::default(),
        )?;
        if source.format == TextureFormat::ALPHA8 {
            alpha_only_color(&mut image);
        }
    }
    Ok((image, metadata))
}

fn alpha_only_color(image: &mut RgbaImage) {
    // Alpha-only UI masks carry no authored color; their exported RGB stays black.
    for pixel in image.pixels_mut() {
        pixel[0] = 0;
        pixel[1] = 0;
        pixel[2] = 0;
    }
}
pub fn texture_id(env: &Unity, id: ObjectId, sprite: &Sprite) -> Result<ObjectId> {
    let reference = sprite.render_data.texture;
    env.reference(
        id,
        ObjectReference {
            file_id: reference.file_id,
            path_id: reference.path_id,
        },
    )?
    .context("Sprite has no texture")
}
pub fn sprite_metadata(sprite: &Sprite) -> SpriteMetadata {
    let r = sprite.rect;
    let t = sprite.render_data.texture_rect;
    let p = sprite.pivot;
    let o = sprite.render_data.texture_rect_offset;
    SpriteMetadata {
        pivot: Vec2 {
            x: p.x.into(),
            y: p.y.into(),
        },
        rect: Rect {
            x: r.x.into(),
            y: r.y.into(),
            width: r.width.into(),
            height: r.height.into(),
        },
        pixels_per_unit: sprite.pixels_to_units.into(),
        texture_rect: Rect {
            x: t.x.into(),
            y: t.y.into(),
            width: t.width.into(),
            height: t.height.into(),
        },
        texture_rect_offset: Vec2 {
            x: o.x.into(),
            y: o.y.into(),
        },
    }
}

pub fn sample_linear(image: &RgbaImage, x: f64, y: f64) -> Rgba<u8> {
    let x = x.clamp(0.0, (image.width() - 1) as f64);
    let y = y.clamp(0.0, (image.height() - 1) as f64);
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(image.width() - 1);
    let y1 = (y0 + 1).min(image.height() - 1);
    let a = x - x0 as f64;
    let b = y - y0 as f64;
    Rgba(std::array::from_fn(|c| {
        let top =
            image.get_pixel(x0, y0)[c] as f64 * (1.0 - a) + image.get_pixel(x1, y0)[c] as f64 * a;
        let bottom =
            image.get_pixel(x0, y1)[c] as f64 * (1.0 - a) + image.get_pixel(x1, y1)[c] as f64 * a;
        (top * (1.0 - b) + bottom * b).clamp(0.0, 255.0) as u8
    }))
}
pub fn resize_linear(image: &RgbaImage, width: u32, height: u32) -> Result<RgbaImage> {
    ensure!(
        width > 0 && height > 0 && (width as u64) * (height as u64) <= 64 * 1024 * 1024,
        "Invalid image size"
    );
    let sx = image.width() as f64 / width as f64;
    let sy = image.height() as f64 / height as f64;
    Ok(RgbaImage::from_fn(width, height, |x, y| {
        sample_linear(
            image,
            (x as f64 + 0.5) * sx - 0.5,
            (y as f64 + 0.5) * sy - 0.5,
        )
    }))
}
pub fn replace_face(body: &RgbaImage, face: &RgbaImage, rect: Rect) -> Result<RgbaImage> {
    ensure!(
        [rect.x, rect.y, rect.width, rect.height]
            .into_iter()
            .all(f64::is_finite)
            && rect.width > 0.0
            && rect.height > 0.0,
        "Invalid face UV rectangle"
    );
    let left = (rect.x - 0.5).ceil().max(0.0) as u32;
    let top = (rect.y - 0.5).ceil().max(0.0) as u32;
    let right = (rect.x + rect.width - 0.5)
        .floor()
        .min((body.width() - 1) as f64);
    let bottom = (rect.y + rect.height - 0.5)
        .floor()
        .min((body.height() - 1) as f64);
    let mut result = body.clone();
    if left as f64 <= right && top as f64 <= bottom {
        for y in top..=bottom as u32 {
            for x in left..=right as u32 {
                let pixel = sample_linear(
                    face,
                    (x as f64 + 0.5 - rect.x) * face.width() as f64 / rect.width - 0.5,
                    (y as f64 + 0.5 - rect.y) * face.height() as f64 / rect.height - 0.5,
                );
                result.put_pixel(x, y, pixel);
            }
        }
    }
    Ok(result)
}
