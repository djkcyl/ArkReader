use crate::flat::Flat;
use anyhow::{Context, Result};
use chrono::{DateTime, Datelike};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub name: String,
    pub order: i32,
    pub art_key: String,
    pub subtitle: String,
    pub theme: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Story {
    pub title: String,
    pub tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Special {
    pub groups: BTreeMap<String, Group>,
    pub triggers: BTreeMap<String, Story>,
    pub stages: BTreeMap<String, Story>,
}

pub fn collection_number(id: &str) -> Option<usize> {
    match id {
        "act8d2" => Some(1),
        "act17d7" => Some(2),
        _ => id
            .strip_prefix("act")
            .and_then(|s| s.strip_suffix("fun"))
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|n| (3..=7).contains(n)),
    }
}

pub fn parse(rogue: &[u8], sandbox: &[u8], activity: &[u8], stage: &[u8]) -> Result<Special> {
    let mut result = Special::default();
    let f = Flat::new(rogue)?;
    let root = f.root()?;
    for (key, t) in f.pairs(root, 4)? {
        let display = *f
            .vector(t, 22)?
            .first()
            .context("Missing roguelike display")?;
        result.groups.insert(
            key.replace("rogue_", "ro"),
            Group {
                name: f.string(t, 6)?,
                order: f.scalar(t, 12)?,
                art_key: format!("arts/ui/stage/hometheme/{}", f.string(display, 6)?),
                subtitle: "主题探索 · 结局回顾".into(),
                theme: "roguelike".into(),
            },
        );
    }
    for (topic, detail) in f.pairs(root, 8)? {
        for (ending, t) in f.pairs(detail, 78)? {
            result.triggers.insert(
                format!("{topic}_{ending}").to_lowercase(),
                Story {
                    title: f.string(t, 8)?,
                    tag: "结局".into(),
                    order: Some(f.scalar(t, 16)?),
                    ..Default::default()
                },
            );
        }
    }
    let f = Flat::new(sandbox)?;
    let root = f.root()?;
    for (key, t) in f.pairs(root, 4)? {
        let display = *f
            .vector(t, 20)?
            .first()
            .context("Missing sandbox display")?;
        result.groups.insert(
            key,
            Group {
                name: f.string(t, 8)?,
                order: f.scalar(t, 14)?,
                art_key: format!("arts/ui/stage/hometheme/{}", f.string(display, 4)?),
                subtitle: "生息档案 · 主线与支线".into(),
                theme: "sandbox".into(),
            },
        );
    }
    let detail = f.table(root, 6)?;
    for (_, value) in f.pairs(detail, 4)? {
        let lines: BTreeMap<_, _> = f
            .pairs(value, 66)?
            .into_iter()
            .map(|(key, t)| Ok((key, (f.string(t, 6)?, f.scalar(t, 16)?))))
            .collect::<Result<_>>()?;
        for t in f.vector(value, 68)? {
            let key = f.string(t, 4)?;
            let line = f.string(t, 6)?;
            let (title, order) = lines.get(&line).context("Missing sandbox story line")?;
            result.triggers.insert(
                key,
                Story {
                    title: title.clone(),
                    tag: "主线".into(),
                    order: Some(*order),
                    ..Default::default()
                },
            );
        }
    }
    for (topic, value) in f.pairs(detail, 6)? {
        for (line, t) in f.pairs(value, 62)? {
            let avg = line.strip_prefix("sideline_").unwrap_or(&line);
            result.triggers.insert(
                format!("{topic}_{avg}_avg_baseavg"),
                Story {
                    title: f.string(t, 6)?,
                    tag: if line.starts_with("sideline_") {
                        "支线"
                    } else {
                        "主线"
                    }
                    .into(),
                    order: Some(f.scalar(t, 12)?),
                    ..Default::default()
                },
            );
        }
    }
    let f = Flat::new(activity)?;
    let root = f.root()?;
    for (key, t) in f.pairs(root, 4)? {
        let april = collection_number(&key).is_some();
        if !april && key != "act1lock" {
            continue;
        }
        let year = DateTime::from_timestamp(f.long(t, 12)?, 0)
            .context("Invalid activity date")?
            .year();
        let name = match key.as_str() {
            "act8d2" => "Why So Mysterious?".into(),
            "act17d7" => "LOYAL TO THE BEAT".into(),
            "act3fun" => "狂弹要塞！".into(),
            "act4fun" => "人气主播 U-Official".into(),
            "act5fun" => "泰拉投资大师课".into(),
            "act6fun" => "ARKnoNIGHTS".into(),
            _ => f.string(t, 10)?,
        };
        result.groups.insert(
            key.clone(),
            Group {
                name: if april {
                    format!("{year} · {name}")
                } else {
                    name
                },
                subtitle: format!(
                    "{year} / {}",
                    if april {
                        "愚人节活动"
                    } else {
                        "联锁竞赛"
                    }
                ),
                theme: "special".into(),
                order: -year,
                art_key: if key == "act1lock" {
                    "arts/loadingillusts/loading_interlock"
                } else {
                    ""
                }
                .into(),
            },
        );
    }
    let april = f.table(root, 32)?;
    for (key, t) in f.pairs(april, 4)? {
        result.stages.insert(
            key,
            Story {
                title: f.string(t, 10)?,
                code: Some(f.string(t, 8)?),
                tag: "行动后".into(),
                ..Default::default()
            },
        );
    }
    let f = Flat::new(stage)?;
    for (key, t) in f.pairs(f.root()?, 4)? {
        if key.starts_with("act17d7") || key.starts_with("act1lock") {
            result.stages.insert(
                key,
                Story {
                    title: f.string(t, 22)?,
                    code: Some(f.string(t, 20)?),
                    tag: "行动后".into(),
                    ..Default::default()
                },
            );
        }
    }
    Ok(result)
}
