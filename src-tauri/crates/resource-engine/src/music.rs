use crate::flat::Flat;
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub name: String,
    pub backgrounds: Vec<String>,
    pub intro: Option<String>,
    pub r#loop: Option<String>,
    pub volume: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Music {
    pub default: String,
    pub tracks: Vec<Track>,
}

pub fn parse(display: &[u8], audio: &[u8]) -> Result<Music> {
    let display = Flat::new(display)?;
    let home = display.table(display.root()?, 6)?;
    let default = display.string(home, 24)?;
    ensure!(!default.is_empty(), "Home music default is missing");
    let mut references: Vec<(String, Vec<String>)> = Vec::new();
    for slot in [8, 12] {
        let mut items = display.vector(home, slot)?;
        let mut ordered = Vec::new();
        for item in items.drain(..) {
            ordered.push((display.scalar(item, 8)?, item));
        }
        ordered.sort_by_key(|(order, _)| *order);
        for (_, item) in ordered {
            let name = display.string(item, 14)?;
            for variant in display.vector(item, 24)? {
                let key = display.string(variant, 8)?;
                if key.is_empty() || name.is_empty() {
                    continue;
                }
                if let Some((_, names)) = references.iter_mut().find(|(id, _)| id == &key) {
                    if !names.contains(&name) {
                        names.push(name.clone());
                    }
                } else {
                    references.push((key, vec![name.clone()]));
                }
            }
        }
    }
    if !references.iter().any(|(id, _)| id == &default) {
        references.push((default.clone(), Vec::new()));
    }
    let audio = Flat::new(audio)?;
    let root = audio.root()?;
    let aliases = audio
        .vector(root, 22)?
        .into_iter()
        .map(|row| Ok((audio.string(row, 4)?, audio.string(row, 6)?)))
        .collect::<Result<BTreeMap<_, _>>>()?;
    let banks = audio
        .vector(root, 4)?
        .into_iter()
        .map(|row| Ok((audio.string(row, 16)?, row)))
        .collect::<Result<BTreeMap<_, _>>>()?;
    let mut tracks = BTreeMap::new();
    for row in audio.vector(root, 14)? {
        let id = audio.string(row, 4)?;
        let Some((_, backgrounds)) = references.iter().find(|(key, _)| key == &id) else {
            continue;
        };
        let name = audio.string(row, 6)?;
        let mut signal = audio.string(row, 8)?;
        let mut seen = BTreeSet::new();
        while let Some(next) = aliases.get(&signal) {
            ensure!(
                seen.insert(signal.clone()),
                "Cycle in home music references"
            );
            signal = next.clone();
        }
        let &bank = banks.get(&signal).context("Home music bank missing")?;
        let intro = audio.optional_string(bank, 4)?;
        let looping = audio.optional_string(bank, 6)?;
        let volume = audio.float(bank, 8)?;
        ensure!(
            !name.is_empty()
                && (intro.as_ref().is_some_and(|s| !s.is_empty())
                    || looping.as_ref().is_some_and(|s| !s.is_empty()))
                && volume.is_finite()
                && (0.0..=1.0).contains(&volume),
            "Invalid home music track"
        );
        let track = Track {
            id: id.clone(),
            name,
            backgrounds: backgrounds.clone(),
            intro,
            r#loop: looping,
            volume,
        };
        ensure!(
            tracks.insert(id, track).is_none(),
            "Duplicate home music track"
        );
    }
    ensure!(
        tracks.len() == references.len(),
        "Home music tracks missing"
    );
    Ok(Music {
        default,
        tracks: references
            .into_iter()
            .map(|(id, _)| tracks.remove(&id).context("Home music ordering failed"))
            .collect::<Result<_>>()?,
    })
}
