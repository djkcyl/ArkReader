use crate::{
    character::CharacterRef,
    model::{Index, Route},
    script::{Analyzer, Compatibility, Reference, Support},
    source::Source,
    stories::Stories,
    unity::Unity,
};
use anyhow::{ensure, Result};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub script: String,
    pub compatibility: Compatibility,
    pub wanted: BTreeMap<String, BTreeSet<String>>,
    pub tile_sprites: BTreeSet<String>,
    pub unresolved_sound_keys: BTreeSet<String>,
    pub unresolved_music_keys: BTreeSet<String>,
    pub missing: BTreeSet<String>,
    pub historical: Vec<crate::historical::Movie>,
}

pub fn routed<'a>(index: &'a Index, command: &str, raw: &str, key: &str) -> Option<&'a Route> {
    let prefix = match command {
        "background" => Some("avg/backgrounds/"),
        "image" => Some("avg/images/"),
        "cgitem" | "showitem" => Some("avg/items/"),
        "interlude-uichar" => Some("cutin/characters/"),
        _ => None,
    };
    if let Some(prefix) = prefix {
        if let Some(route) = index.routes.get(&format!("{prefix}{key}")) {
            return Some(route);
        }
    }
    if matches!(command, "playmusic" | "playsound" | "playvoice") {
        let path = audio_path(raw);
        if path.contains('/') {
            let path = if path.starts_with("audio/") {
                path
            } else {
                format!("audio/{path}")
            };
            return index.routes.get(&path);
        }
    }
    None
}

fn audio_path(raw: &str) -> String {
    let path = raw.replace('\\', "/").to_lowercase();
    path.strip_suffix(".wav")
        .or_else(|| path.strip_suffix(".ogg"))
        .unwrap_or(&path)
        .to_owned()
}
fn loop_base(key: &str) -> &str {
    key.strip_suffix("_intro")
        .or_else(|| key.strip_suffix("_loop"))
        .unwrap_or(key)
}

fn audio_candidates(raw: &str, source: &Source) -> Vec<String> {
    let path = audio_path(raw);
    let Some((parent, _)) = path.rsplit_once('/') else {
        return Vec::new();
    };
    let mut direct = vec![
        format!("audio/{path}.ab"),
        format!("audio/{parent}.ab"),
        format!("audio/{}.ab", loop_base(&path)),
    ];
    let mut ancestor = parent;
    while let Some((prefix, _)) = ancestor.rsplit_once('/') {
        ancestor = prefix;
        direct.push(format!("audio/{ancestor}.ab"));
    }
    let mut families = vec![format!("audio/{parent}")];
    if let Some(category) = parent
        .strip_prefix("sound_beta_2/customse/")
        .and_then(|s| s.split('/').next())
    {
        direct.push(format!("audio/custom_se/{category}.ab"));
    }
    if parent.starts_with("sound_beta_2/battle/") {
        families.push("audio/sound_beta_2/btl_snd".into());
    }
    if parent.starts_with("sound_beta_2/enemy/") {
        let category = parent.rsplit('/').next().unwrap_or_default();
        if let Some(family) = match category {
            "e_atk" => Some("atk"),
            "e_imp" => Some("imp"),
            "e_skill" => Some("skill"),
            _ => None,
        } {
            families.push(format!("audio/sound_beta_2/enmy_snd_{family}"));
        }
    }
    for family in families {
        for name in source.manifest.entries.keys() {
            if name
                .strip_prefix(&format!("{family}_"))
                .and_then(|s| s.strip_suffix(".ab"))
                .is_some_and(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
            {
                direct.push(name.clone());
            }
        }
    }
    let mut seen = BTreeSet::new();
    direct
        .into_iter()
        .filter(|name| source.manifest.entries.contains_key(name) && seen.insert(name.clone()))
        .collect()
}

struct Resolver<'a> {
    index: &'a Index,
    source: &'a Source,
    media: BTreeMap<String, String>,
    scanned: BTreeSet<String>,
    identified: BTreeMap<(i32, String), String>,
}
impl Resolver<'_> {
    fn exists(&self, name: String) -> Option<String> {
        self.source
            .manifest
            .entries
            .contains_key(&name)
            .then_some(name)
    }
    async fn scan(&mut self, bundle: &str, class_id: i32, prefix: Option<&str>) -> Result<()> {
        if !self.scanned.insert(bundle.into()) {
            return Ok(());
        }
        let path = self.source.bundle(bundle, |_| {}).await?;
        let cancel = self.source.cancellation();
        let prefix = prefix.map(str::to_owned);
        let names = tokio::task::spawn_blocking(move || {
            let env = Unity::open(&[path], cancel)?;
            let mut names = BTreeSet::new();
            if let Some(prefix) = prefix {
                for (container, objects) in &env.containers {
                    if !container.starts_with(&prefix) {
                        continue;
                    }
                    if objects
                        .iter()
                        .any(|&id| env.object(id).is_ok_and(|o| o.class_id() == class_id))
                    {
                        if let Some(stem) =
                            Path::new(container).file_stem().and_then(|s| s.to_str())
                        {
                            names.insert(stem.to_lowercase());
                        }
                    }
                }
            } else {
                for object in env.studio.objects().filter(|o| o.class_id() == class_id) {
                    if let Some(name) = object.name() {
                        names.insert(name.to_lowercase());
                    }
                }
            }
            Ok::<_, anyhow::Error>(names)
        })
        .await??;
        for name in names {
            self.identified
                .insert((class_id, name.clone()), bundle.into());
            self.media.insert(name, bundle.into());
        }
        Ok(())
    }

    async fn resolve(&mut self, reference: &Reference) -> Result<Option<String>> {
        let Reference {
            command, raw, key, ..
        } = reference;
        if let Some(route) = routed(self.index, command, raw, key) {
            return Ok(Some(route.bundle.clone()));
        }
        let name = match command.as_str() {
            "imgeffect" => Some(format!("avg/effects/image/{key}.ab")),
            "spellsticker" => Some(format!("avg/spellsticker/{key}.ab")),
            "animated-kv" => Some(format!("avg/animatedkv/{key}.ab")),
            "animtext" => Some(format!("avg/animatetext/{key}.ab")),
            "bgeffect" => Some(format!("avg/effects/background/{key}.ab")),
            "effect" => Some("avg/fx/battle.ab".into()),
            "interlude-mask" => Some("avg/[uc]common.ab".into()),
            "character" | "charslot" => Some(format!(
                "avg/characters/{}.ab",
                CharacterRef::parse(key).base
            )),
            _ => None,
        };
        if let Some(name) = name {
            return Ok(self.exists(name));
        }
        if command == "imgeffect-image" {
            let key = key.strip_prefix("imgfx:").unwrap_or(key);
            return Ok(routed(self.index, "image", raw, key)
                .or_else(|| self.index.media.get(key))
                .map(|r| r.bundle.clone()));
        }
        if command == "video" {
            let path = raw.to_lowercase();
            if path.starts_with("video/")
                && path.ends_with(".mp4")
                && !path.split('/').any(|s| s == "..")
                && !path.contains('\\')
            {
                return Ok(self.exists(format!("raw/{}.usm", path.trim_end_matches(".mp4"))));
            }
            return Ok(None);
        }
        if matches!(command.as_str(), "cgitem" | "showitem" | "interlude-uichar") {
            if let Some(bundle) = self.identified.get(&(213, key.clone())) {
                return Ok(Some(bundle.clone()));
            }
            let cutin = command == "interlude-uichar";
            let direct = if cutin {
                format!("cutin/characters/{key}.ab")
            } else {
                format!("avg/items/{key}.ab")
            };
            let family = if cutin {
                "spritepack/cutin_char_"
            } else {
                "avg/items/avg_item_img_hub_"
            };
            let prefix = if cutin {
                "dyn/cutin/characters/"
            } else {
                "dyn/avg/items/"
            };
            let mut candidates = vec![direct];
            candidates.extend(
                self.source
                    .manifest
                    .entries
                    .keys()
                    .filter(|name| name.starts_with(family))
                    .cloned(),
            );
            for name in candidates {
                if self.source.manifest.entries.contains_key(&name) {
                    self.scan(&name, 213, Some(prefix)).await?;
                    if let Some(bundle) = self.identified.get(&(213, key.clone())) {
                        return Ok(Some(bundle.clone()));
                    }
                }
            }
            return Ok(None);
        }
        if let Some(bundle) = self.media.get(key) {
            return Ok(Some(bundle.clone()));
        }
        if matches!(command.as_str(), "playmusic" | "playsound" | "playvoice") {
            let mut candidates = Vec::new();
            if let Some(route) = self.index.media.get(loop_base(key)) {
                candidates.push(route.bundle.clone());
            }
            candidates.extend(audio_candidates(raw, self.source));
            for name in candidates {
                self.scan(&name, 83, None).await?;
                if let Some(bundle) = self.media.get(key) {
                    return Ok(Some(bundle.clone()));
                }
            }
        }
        Ok(None)
    }
}

pub async fn plan(stories: &Stories, id: &str) -> Result<Plan> {
    ensure!(
        stories.index.stories.contains_key(id),
        "Unknown story: {id}"
    );
    let script = stories.text(id, false).await?;
    let mut compatibility = stories.inspect(&script).await?;
    compatibility.resource_version = Some(stories.index.source.version.clone());
    compatibility.client_version = Some(stories.index.source.client_version.clone());
    compatibility.story = Some(id.into());
    compatibility.analyzer_sha256 = Some(Analyzer::revision());
    {
        use sha2::{Digest, Sha256};
        compatibility.script_sha256 = Some(format!("{:x}", Sha256::digest(script.as_bytes())));
    }
    if compatibility.status != Support::Supported {
        return Err(crate::error::Error::UnsupportedScript(Box::new(compatibility)).into());
    }
    let text = script.clone();
    let index = stories.index.clone();
    let cancel = stories.source.cancellation();
    let references =
        tokio::task::spawn_blocking(move || Analyzer::references(&text, &index.variables, &cancel))
            .await??;
    let mut result = Plan {
        id: id.into(),
        script,
        compatibility,
        wanted: BTreeMap::new(),
        tile_sprites: BTreeSet::new(),
        unresolved_sound_keys: BTreeSet::new(),
        unresolved_music_keys: BTreeSet::new(),
        missing: BTreeSet::new(),
        historical: Vec::new(),
    };
    let mut resolver = Resolver {
        index: &stories.index,
        source: &stories.source,
        media: stories
            .index
            .media
            .iter()
            .map(|(key, route)| (key.clone(), route.bundle.clone()))
            .collect(),
        scanned: BTreeSet::new(),
        identified: BTreeMap::new(),
    };
    for reference in references {
        stories.source.checkpoint()?;
        if let Some(bundle) = resolver.resolve(&reference).await? {
            result
                .wanted
                .entry(bundle)
                .or_default()
                .insert(reference.key.clone());
            if reference.tile_metadata {
                result.tile_sprites.insert(reference.key);
            }
        } else if matches!(reference.command.as_str(), "playsound" | "playmusic")
            && reference
                .raw
                .strip_prefix('$')
                .is_some_and(|key| !stories.index.variables.contains_key(key))
        {
            if reference.command == "playmusic" {
                result.unresolved_music_keys.insert(reference.key);
            } else {
                result.unresolved_sound_keys.insert(reference.key);
            }
        } else {
            if reference.command == "video" {
                if let Some(movie) = crate::historical::movie(
                    id,
                    &reference.raw,
                    &reference.key,
                    !stories.source.manifest.base_url.is_empty(),
                )? {
                    result.historical.push(movie);
                    continue;
                }
            }
            result.missing.insert(reference.raw);
        }
    }
    Ok(result)
}

pub fn dependencies(index: &Index, bundles: &BTreeSet<String>) -> BTreeSet<String> {
    bundles
        .iter()
        .filter_map(|b| index.dependencies.get(b))
        .flatten()
        .filter(|b| !bundles.contains(*b))
        .cloned()
        .collect()
}
