use crate::{
    index,
    model::{Faction, Index, Operator, OperatorRecord, ReviewGroup, StoryEntry},
    scope::{classify, StoryKind},
    source::Source,
    special::{self, Special},
    tables,
};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Main,
    Side,
    Mini,
    Memory,
    Roguelike,
    Sandbox,
    Other,
}
impl Category {
    pub const ALL: [Self; 7] = [
        Self::Main,
        Self::Side,
        Self::Mini,
        Self::Memory,
        Self::Roguelike,
        Self::Sandbox,
        Self::Other,
    ];
    fn name(self) -> &'static str {
        match self {
            Self::Main => "主题曲",
            Self::Side => "活动故事",
            Self::Mini => "故事集",
            Self::Memory => "干员密录",
            Self::Roguelike => "集成战略",
            Self::Sandbox => "生息演算",
            Self::Other => "其他剧情",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Story {
    pub id: String,
    pub title: String,
    pub code: String,
    pub tag: String,
    pub order: i32,
    pub group_id: String,
    pub group_name: String,
    pub category: Category,
    pub source: StoryKind,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub record: Option<Record>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub operator: Operator,
    pub record_id: Option<String>,
    pub record_name: Option<String>,
    pub record_order: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub category: Category,
    pub order: i32,
    pub stories: Vec<Story>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator: Option<Operator>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}
#[derive(Serialize, Deserialize)]
pub struct Label<T> {
    pub id: T,
    pub name: String,
}
#[derive(Serialize, Deserialize)]
pub struct OperatorFilters {
    pub rarities: Vec<i32>,
    pub professions: Vec<Label<i32>>,
    pub positions: Vec<Label<i32>>,
    pub factions: Vec<Faction>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub version: String,
    pub bound: bool,
    pub categories: Vec<Label<Category>>,
    pub groups: Vec<Group>,
    pub stories: Vec<Story>,
    pub operator_filters: Option<OperatorFilters>,
}

#[derive(Serialize, Deserialize)]
pub struct Metadata {
    pub review: Vec<ReviewGroup>,
    pub entries: Vec<StoryEntry>,
    pub operators: BTreeMap<String, OperatorRecord>,
    pub factions: Vec<Faction>,
    pub special: Special,
}
impl Metadata {
    pub async fn load(data: &Path, index: &Index, source: &Source) -> Result<Self> {
        let mut raw = BTreeMap::new();
        for table in [
            "character_table",
            "handbook_info_table",
            "handbook_team_table",
            "roguelike_topic_table",
            "sandbox_perm_table",
            "activity_table",
            "stage_table",
        ] {
            let matches: Vec<_> = index
                .routes
                .iter()
                .filter(|(key, _)| {
                    key.strip_prefix("gamedata/excel/")
                        .is_some_and(|key| index::table_name(key, table))
                })
                .map(|(_, route)| route)
                .collect();
            ensure!(
                matches.len() == 1,
                "Missing or ambiguous official table: {table}"
            );
            raw.insert(table, index::read_route(source, matches[0]).await?);
        }
        let review = index::read_table(data, &index.review, source).await?;
        let entries = index::read_table(data, &index.entries, source).await?;
        tokio::task::spawn_blocking(move || {
            Ok(Self {
                review: tables::review(&review)?,
                entries: tables::story_entries(&entries)?,
                operators: tables::operators(&raw["character_table"], &raw["handbook_info_table"])?,
                factions: tables::factions(&raw["handbook_team_table"])?,
                special: special::parse(
                    &raw["roguelike_topic_table"],
                    &raw["sandbox_perm_table"],
                    &raw["activity_table"],
                    &raw["stage_table"],
                )?,
            })
        })
        .await?
    }
}

struct Builder<'a> {
    index: &'a Index,
    groups: Vec<Group>,
    group_ids: HashMap<String, usize>,
    stories: HashSet<String>,
}
impl<'a> Builder<'a> {
    fn group(&mut self, key: &str, name: &str, category: Category) -> usize {
        if let Some(&i) = self.group_ids.get(key) {
            return i;
        }
        let i = self.groups.len();
        self.group_ids.insert(key.to_owned(), i);
        self.groups.push(Group {
            id: key.into(),
            name: if name.is_empty() { key } else { name }.into(),
            category,
            order: i as i32,
            stories: Vec::new(),
            operator: None,
            art_key: None,
            subtitle: None,
            theme: None,
        });
        i
    }
    fn add(
        &mut self,
        id: &str,
        group: usize,
        labels: [&str; 3],
        order: i32,
        source: StoryKind,
    ) -> Option<&mut Story> {
        let [title, code, tag] = labels;
        if !self.index.stories.contains_key(id) || !self.stories.insert(id.to_owned()) {
            return None;
        }
        let group = &mut self.groups[group];
        let title = if title.is_empty() {
            id.rsplit('/').next().unwrap_or(id)
        } else {
            title
        };
        let label = [group.name.as_str(), code, title, tag]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" / ");
        group.stories.push(Story {
            id: id.into(),
            title: title.into(),
            code: code.into(),
            tag: tag.into(),
            order,
            group_id: group.id.clone(),
            group_name: group.name.clone(),
            category: group.category,
            source,
            label,
            variant: None,
            record: None,
            subtitle: None,
            theme: None,
        });
        group.stories.last_mut()
    }
}

pub fn build(index: &Index, metadata: &Metadata) -> Result<Catalog> {
    let mut b = Builder {
        index,
        groups: Vec::new(),
        group_ids: HashMap::new(),
        stories: HashSet::new(),
    };
    for entry in &metadata.review {
        let mut rows: Vec<_> = entry.stories.iter().collect();
        rows.sort_by_key(|r| r.story_sort);
        if entry.entry_type == 0 && !metadata.operators.is_empty() {
            for row in rows {
                let id = row.story_txt.as_deref().unwrap_or_default();
                if !index.stories.contains_key(id) {
                    continue;
                }
                let record = metadata
                    .operators
                    .get(id)
                    .context("Official operator ownership missing")?;
                let operator = &record.operator;
                let group = b.group(&operator.id, &operator.name, Category::Memory);
                b.groups[group].operator = Some(operator.clone());
                b.groups[group].order = operator.sort;
                if let Some(story) = b.add(
                    id,
                    group,
                    [
                        row.story_name.as_deref().unwrap_or_default(),
                        row.story_code.as_deref().unwrap_or_default(),
                        row.avg_tag.as_deref().unwrap_or_default(),
                    ],
                    record.record_order * 1000 + record.part_order,
                    StoryKind::Review,
                ) {
                    story.record = Some(Record {
                        operator: operator.clone(),
                        record_id: record.record_id.clone(),
                        record_name: record.record_name.clone(),
                        record_order: record.record_order,
                    });
                }
            }
            continue;
        }
        let category = match entry.entry_type {
            3 => Category::Main,
            1 => Category::Side,
            2 => Category::Mini,
            0 => Category::Memory,
            _ => Category::Other,
        };
        let group = b.group(
            &entry.id,
            entry.name.as_deref().unwrap_or_default(),
            category,
        );
        for row in rows {
            b.add(
                row.story_txt.as_deref().unwrap_or_default(),
                group,
                [
                    row.story_name.as_deref().unwrap_or_default(),
                    row.story_code.as_deref().unwrap_or_default(),
                    row.avg_tag.as_deref().unwrap_or_default(),
                ],
                row.story_sort,
                StoryKind::Review,
            );
        }
    }
    for entry in &metadata.entries {
        let Some(kind) = classify(entry) else {
            continue;
        };
        let id = entry.id.as_str();
        if !index.stories.contains_key(id) || b.stories.contains(id) {
            continue;
        }
        let (prefix, filename) = id.rsplit_once('/').context("Invalid direct story path")?;
        let parent = prefix
            .rsplit('/')
            .next()
            .context("Missing direct story group")?;
        let group = if let Some(&i) = b.group_ids.get(parent) {
            i
        } else {
            match kind {
                StoryKind::RoguelikeEntry | StoryKind::RoguelikeEnding => b.group(
                    parent,
                    &format!("集成战略 {}", parent.trim_start_matches("ro")),
                    Category::Roguelike,
                ),
                StoryKind::SandboxEntry
                | StoryKind::SandboxBaseStory
                | StoryKind::SandboxPostbattleStory => b.group(
                    parent,
                    &format!("生息演算 {}", parent.trim_start_matches("sandbox_")),
                    Category::Sandbox,
                ),
                _ => b.group(parent, parent, Category::Other),
            }
        };
        if let Some(meta) = metadata.special.groups.get(parent) {
            let g = &mut b.groups[group];
            g.name = meta.name.clone();
            g.order = meta.order;
            g.art_key = Some(meta.art_key.clone());
            g.subtitle = Some(meta.subtitle.clone());
            g.theme = Some(meta.theme.clone());
        }
        let mut title = filename.trim_start_matches("level_").to_owned();
        let mut tag = String::new();
        let mut order = 100000 + b.stories.len() as i32;
        match kind {
            StoryKind::ActivityEntryVideo => {
                title = "活动片头".into();
                tag = "影片".into();
                order = -1;
            }
            StoryKind::RoguelikeEntry | StoryKind::SandboxEntry | StoryKind::InterlockEntry => {
                title = "开篇".into();
                order = -1;
            }
            StoryKind::RoguelikeEnding => {
                title = format!("结局 {}", id.rsplit('_').next().unwrap_or_default())
            }
            StoryKind::ActivityAnnouncement => title = "活动开场".into(),
            _ => {}
        }
        let key = entry
            .trigger
            .key
            .as_deref()
            .unwrap_or_default()
            .to_lowercase();
        let meta = if kind == StoryKind::PostbattleStory {
            metadata.special.stages.get(&key)
        } else {
            metadata.special.triggers.get(&key)
        };
        let mut code = String::new();
        if let Some(meta) = meta {
            title = meta.title.clone();
            tag = meta.tag.clone();
            code = meta.code.clone().unwrap_or_default();
            order = meta.order.unwrap_or(order);
        }
        match kind {
            StoryKind::InterlockSeason => title = "赛季开篇".into(),
            StoryKind::InterlockEnding => title = "赛季终章".into(),
            StoryKind::SandboxPostbattleStory if id.ends_with("sandbox_1_1") => {
                tag = "主线 · 上篇".into()
            }
            StoryKind::SandboxPostbattleStory if id.ends_with("sandbox_1_ending_3") => {
                tag = "主线 · 下篇".into()
            }
            _ => {}
        }
        let subtitle = b.groups[group].subtitle.clone().unwrap_or_default();
        let theme = b.groups[group].theme.clone().unwrap_or_default();
        if let Some(story) = b.add(id, group, [&title, &code, &tag], order, kind) {
            story.subtitle = Some(subtitle);
            story.theme = Some(theme);
        }
    }
    b.groups.retain(|g| !g.stories.is_empty());
    b.groups.sort_by_key(|g| (g.category, g.order));
    for group in &mut b.groups {
        group.stories.sort_by_key(|r| r.order);
        let mut counts = HashMap::new();
        for row in &group.stories {
            *counts.entry(row.label.clone()).or_insert(0) += 1;
        }
        for row in &mut group.stories {
            if counts[&row.label] > 1 {
                let variant = row.id.rsplit('/').next().unwrap_or_default().to_owned();
                row.label.push_str(" / ");
                row.label.push_str(&variant);
                row.variant = Some(variant);
            }
        }
    }
    let used: HashSet<_> = b
        .groups
        .iter()
        .filter_map(|g| g.operator.as_ref())
        .flat_map(|o| o.faction_ids.iter().chain(&o.secondary_faction_ids))
        .collect();
    ensure!(
        used.iter()
            .all(|id| metadata.factions.iter().any(|f| &f.id == *id)),
        "Operator faction missing from official metadata"
    );
    let filters = (!metadata.operators.is_empty()).then(|| OperatorFilters {
        rarities: vec![6, 5, 4, 3, 2, 1],
        professions: tables::PROFESSIONS
            .into_iter()
            .map(|(id, name)| Label {
                id,
                name: name.into(),
            })
            .collect(),
        positions: vec![
            Label {
                id: 1,
                name: "近战位".into(),
            },
            Label {
                id: 2,
                name: "远程位".into(),
            },
        ],
        factions: metadata
            .factions
            .iter()
            .filter(|f| used.contains(&f.id))
            .cloned()
            .collect(),
    });
    Ok(Catalog {
        version: index.source.version.clone(),
        bound: true,
        categories: Category::ALL
            .into_iter()
            .filter(|c| b.groups.iter().any(|g| g.category == *c))
            .map(|id| Label {
                id,
                name: id.name().into(),
            })
            .collect(),
        stories: b
            .groups
            .iter()
            .flat_map(|g| g.stories.iter().cloned())
            .collect(),
        groups: b.groups,
        operator_filters: filters,
    })
}
