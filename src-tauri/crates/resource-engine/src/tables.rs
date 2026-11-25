use crate::{flat::Flat, model::*};
use anyhow::{ensure, Context, Result};
use std::collections::BTreeMap;

pub const PROFESSIONS: [(i32, &str); 8] = [
    (512, "先锋"),
    (1, "近卫"),
    (4, "重装"),
    (2, "狙击"),
    (32, "术师"),
    (8, "医疗"),
    (16, "辅助"),
    (64, "特种"),
];
const TRIGGERS: [&str; 12] = [
    "GAME_START",
    "BEFORE_BATTLE",
    "AFTER_BATTLE",
    "SWITCH_TO_SCENE",
    "PAGE_LOADED",
    "STORY_FINISH",
    "CUSTOM_OPERATION",
    "STORY_FINISH_OR_PAGE_LOADED",
    "ACTIVITY_LOADED",
    "ACTIVITY_ANNOUNCE",
    "CRISIS_SEASON_LOADED",
    "STORY_FINISH_OR_CUSTOM_OPERATION",
];

pub fn review(raw: &[u8]) -> Result<Vec<ReviewGroup>> {
    let f = Flat::new(raw)?;
    f.pairs(f.root()?, 4)?
        .into_iter()
        .map(|(id, t)| {
            ensure!(f.string(t, 4)? == id, "Review group identity mismatch");
            let stories = f
                .vector(t, 36)?
                .into_iter()
                .map(|row| {
                    Ok(ReviewStory {
                        story_id: f.optional_string(row, 6)?,
                        story_group: f.optional_string(row, 8)?,
                        story_dependence: f.optional_string(row, 12)?,
                        story_code: f.optional_string(row, 16)?,
                        story_name: f.optional_string(row, 18)?,
                        story_info: f.optional_string(row, 22)?,
                        story_txt: f.optional_string(row, 26)?,
                        avg_tag: f.optional_string(row, 28)?,
                        story_sort: f.scalar(row, 10)?,
                        story_can_show: f.scalar(row, 14)?,
                        story_can_enter: f.scalar(row, 24)?,
                        unlock_type: f.scalar(row, 30)?,
                    })
                })
                .collect::<Result<_>>()?;
            Ok(ReviewGroup {
                id,
                name: f.optional_string(t, 6)?,
                entry_type: f.scalar(t, 8)?,
                act_type: f.scalar(t, 10)?,
                start_time: f.long(t, 12)?,
                end_time: f.long(t, 14)?,
                start_show_time: f.long(t, 16)?,
                end_show_time: f.long(t, 18)?,
                stories,
            })
        })
        .collect()
}

pub fn story_entries(raw: &[u8]) -> Result<Vec<StoryEntry>> {
    let f = Flat::new(raw)?;
    f.pairs(f.root()?, 4)?
        .into_iter()
        .map(|(key, t)| {
            ensure!(f.string(t, 4)? == key, "StoryDB identity mismatch");
            let trigger = f.table(t, 14)?;
            let kind = f.scalar(trigger, 4)?;
            let name = TRIGGERS
                .get(usize::try_from(kind)?)
                .context("Unsupported StoryDB trigger")?
                .to_string();
            Ok(StoryEntry {
                id: key.to_lowercase(),
                source_id: key,
                need_commit: f.boolean(t, 6)?,
                repeatable: f.boolean(t, 8)?,
                disabled: f.boolean(t, 10)?,
                video_resource: f.boolean(t, 12)?,
                trigger: Trigger {
                    kind,
                    name,
                    key: f.optional_string(trigger, 6)?,
                    use_regex: f.boolean(trigger, 8)?,
                },
            })
        })
        .collect()
}

pub fn factions(raw: &[u8]) -> Result<Vec<Faction>> {
    let f = Flat::new(raw)?;
    let mut rows = Vec::new();
    for (id, t) in f.pairs(f.root()?, 4)? {
        let name = f.string(t, 10)?;
        let level = f.scalar(t, 8)?;
        ensure!(
            f.string(t, 4)? == id && !name.is_empty() && (0..=2).contains(&level),
            "Invalid official faction"
        );
        rows.push(Faction {
            id,
            name,
            level,
            order: f.scalar(t, 6)?,
        });
    }
    rows.sort_by(|a, b| (a.order, &a.id).cmp(&(b.order, &b.id)));
    Ok(rows)
}

fn powers(
    f: &Flat<'_>,
    tables: impl IntoIterator<Item = usize>,
    slots: &[usize],
) -> Result<Vec<String>> {
    let mut result = Vec::new();
    for t in tables {
        for &slot in slots {
            let key = f.string(t, slot)?;
            if !key.is_empty() && !result.contains(&key) {
                result.push(key);
            }
        }
    }
    Ok(result)
}

pub fn operators(character: &[u8], handbook: &[u8]) -> Result<BTreeMap<String, OperatorRecord>> {
    let f = Flat::new(character)?;
    let mut names = BTreeMap::new();
    for (id, t) in f.pairs(f.root()?, 4)? {
        let mut main = if let Some(at) = f.field(t, 30)? {
            powers(&f, [f.pointer(at)?], &[4, 6, 8])?
        } else {
            powers(&f, [t], &[24, 26, 28])?
        };
        if main.is_empty() {
            main.push("none".into());
        }
        let secondary = powers(&f, f.vector(t, 32)?, &[4, 6, 8])?;
        names.insert(
            id.clone(),
            Operator {
                id,
                name: f.string(t, 4)?,
                sort: f.scalar(t, 8)?,
                appellation: f.string(t, 36)?,
                rarity: f.scalar(t, 54)? + 1,
                profession: f.scalar(t, 56)?,
                position: f.scalar(t, 38)?,
                display_faction_id: main.last().context("Missing operator faction")?.clone(),
                faction_ids: main,
                secondary_faction_ids: secondary,
            },
        );
    }
    let f = Flat::new(handbook)?;
    let mut stories = BTreeMap::new();
    for (owner, t) in f.pairs(f.root()?, 4)? {
        ensure!(f.string(t, 4)? == owner, "Handbook owner identity mismatch");
        for group in f.vector(t, 12)? {
            let id = f.string(group, 18)?;
            let id = if id.is_empty() { &owner } else { &id };
            let operator = names
                .get(id)
                .context("Handbook operator has no official character")?;
            ensure!(
                !operator.name.is_empty()
                    && (1..=6).contains(&operator.rarity)
                    && PROFESSIONS.iter().any(|(id, _)| *id == operator.profession)
                    && (1..=3).contains(&operator.position),
                "Unsupported official operator filter attributes: {id}"
            );
            for avg in f.vector(group, 16)? {
                let story = f.string(avg, 16)?;
                if story.is_empty() {
                    continue;
                }
                let value = OperatorRecord {
                    operator: operator.clone(),
                    record_id: f.optional_string(group, 4)?,
                    record_name: f.optional_string(group, 6)?,
                    record_order: f.scalar(group, 8)?,
                    part_order: f.scalar(avg, 8)?,
                };
                if let Some(previous) = stories.insert(story, value.clone()) {
                    ensure!(previous == value, "Conflicting operator record identity");
                }
            }
        }
    }
    Ok(stories)
}
