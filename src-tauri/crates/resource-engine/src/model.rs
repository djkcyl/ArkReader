use crate::source::Manifest;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Route {
    pub bundle: String,
    pub container: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Binding {
    pub route: Route,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RoutingManifest {
    pub bundle: String,
    pub sha256: String,
    pub bundle_count: usize,
    pub asset_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Index {
    pub format: u32,
    pub generator: String,
    pub source: Manifest,
    pub routing: RoutingManifest,
    pub routes: BTreeMap<String, Route>,
    pub dependencies: BTreeMap<String, Vec<String>>,
    pub stories: BTreeMap<String, Route>,
    pub summaries: BTreeMap<String, Route>,
    pub media: BTreeMap<String, Route>,
    pub variables: BTreeMap<String, Value>,
    pub review: Binding,
    pub entries: Binding,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGroup {
    pub id: String,
    pub name: Option<String>,
    pub entry_type: i32,
    pub act_type: i32,
    pub start_time: i64,
    pub end_time: i64,
    pub start_show_time: i64,
    pub end_show_time: i64,
    pub stories: Vec<ReviewStory>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStory {
    pub story_id: Option<String>,
    pub story_group: Option<String>,
    pub story_dependence: Option<String>,
    pub story_code: Option<String>,
    pub story_name: Option<String>,
    pub story_info: Option<String>,
    pub story_txt: Option<String>,
    pub avg_tag: Option<String>,
    pub story_sort: i32,
    pub story_can_show: i32,
    pub story_can_enter: i32,
    pub unlock_type: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryEntry {
    pub id: String,
    pub source_id: String,
    pub need_commit: bool,
    pub repeatable: bool,
    pub disabled: bool,
    pub video_resource: bool,
    pub trigger: Trigger,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    #[serde(rename = "type")]
    pub kind: i32,
    pub name: String,
    pub key: Option<String>,
    pub use_regex: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operator {
    pub id: String,
    pub name: String,
    pub sort: i32,
    pub appellation: String,
    pub rarity: i32,
    pub profession: i32,
    pub position: i32,
    pub display_faction_id: String,
    pub faction_ids: Vec<String>,
    pub secondary_faction_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatorRecord {
    pub operator: Operator,
    pub record_id: Option<String>,
    pub record_name: Option<String>,
    pub record_order: i32,
    pub part_order: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Faction {
    pub id: String,
    pub name: String,
    pub level: i32,
    pub order: i32,
}
