use crate::model::StoryEntry;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StoryKind {
    Review,
    RoguelikeEntry,
    RoguelikeEnding,
    ActivityAnnouncement,
    ActivityEntryVideo,
    SandboxEntry,
    SandboxBaseStory,
    SandboxPostbattleStory,
    PostbattleStory,
    InterlockEntry,
    InterlockSeason,
    InterlockEnding,
}

static ACTIVITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^activities/(act\d+side)/level_(act\d+side)_entry$").unwrap());
static ROGUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^obt/roguelike/ro([1-6])/level_rogue([1-6])_(entry|ending_\d+)$").unwrap()
});

pub fn classify(row: &StoryEntry) -> Option<StoryKind> {
    if row.disabled || row.trigger.use_regex {
        return None;
    }
    let key = row.trigger.key.as_deref()?;
    let id = row.id.as_str();
    let kind = row.trigger.kind;
    if row.video_resource {
        let capture = ACTIVITY.captures(id)?;
        if kind == 8
            && capture[1] == capture[2]
            && (key == &capture[1] || key == format!("{}sre", capture[1].trim_end_matches("side")))
        {
            return Some(StoryKind::ActivityEntryVideo);
        }
        return None;
    }
    if kind == 9 {
        return Some(StoryKind::ActivityAnnouncement);
    }
    if kind == 2 {
        return match (id, key) {
            ("activities/act3fun/level_act3fun_03_end", "act3fun_03")
            | ("activities/act12side/level_act12side_tr01_end", "act12side_tr01")
            | ("activities/act17d7/level_act17d7_01_end", "act17d7_01") => {
                Some(StoryKind::PostbattleStory)
            }
            _ => None,
        };
    }
    if kind != 6 {
        return None;
    }
    if let Some(capture) = ROGUE.captures(id) {
        if capture[1] == capture[2] {
            let number = &capture[1];
            let ending = &capture[3];
            let prefix = match number {
                "1" => "ro".into(),
                "5" | "6" => format!("RO{number}"),
                _ => format!("ro{number}"),
            };
            let expected = if ending == "entry" {
                format!("rogue_{number}_ro_entry")
            } else {
                format!("rogue_{number}_{prefix}_{ending}")
            };
            if key == expected {
                return Some(if ending == "entry" {
                    StoryKind::RoguelikeEntry
                } else {
                    StoryKind::RoguelikeEnding
                });
            }
        }
    }
    if let Some(relative) = id.strip_prefix("obt/sandboxperm/") {
        if let Some((topic, story)) = relative.split_once('/') {
            if matches!(topic, "sandbox_1" | "sandbox_2")
                && story == format!("{topic}_entry")
                && key == format!("{topic}_ra_entry")
            {
                return Some(StoryKind::SandboxEntry);
            }
            if topic == "sandbox_2" {
                let suffix = story.strip_prefix("sandbox_2_")?;
                let expected = match suffix {
                    "ending_1" | "ending_2" | "ending_3" | "ending_4" => format!(
                        "sandbox_2_mainline{}_avg_baseAvg",
                        suffix.trim_start_matches("ending_")
                    ),
                    "xb2smy" | "xb2amy" => format!("sandbox_2_{suffix}_avg_baseAvg"),
                    _ => String::new(),
                };
                if !expected.is_empty() && key == expected {
                    return Some(StoryKind::SandboxBaseStory);
                }
            }
            if topic == "sandbox_1" {
                let expected = match story {
                    "sandbox_1_ending_1" | "sandbox_1_ending_2" | "sandbox_1_ending_3" => {
                        format!("sandbox_1_ra_ending_{}", story.rsplit('_').next()?)
                    }
                    "sandbox_1_1" => "sandbox_1_ra_ending_tegmaus".into(),
                    _ => String::new(),
                };
                if !expected.is_empty() && key == expected {
                    return Some(StoryKind::SandboxPostbattleStory);
                }
            }
        }
    }
    match (id, key) {
        ("activities/act1lock/level_act1lock_entry", "interlock_sys") => {
            Some(StoryKind::InterlockEntry)
        }
        ("activities/act1lock/level_act1lock_st01", "act1lock") => Some(StoryKind::InterlockSeason),
        ("activities/act1lock/level_act1lock_st02", "inter_lock") => {
            Some(StoryKind::InterlockEnding)
        }
        _ => None,
    }
}
