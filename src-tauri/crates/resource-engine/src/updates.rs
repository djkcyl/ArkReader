use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub resource_version: String,
    pub client_version: String,
}
pub static BASELINE: LazyLock<Baseline> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../assets/compatibility_baseline.json"))
        .expect("Valid adaptation baseline")
});

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub state: String,
    pub baseline: Baseline,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub official_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub official_client_version: Option<String>,
    pub message: String,
    pub warning: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub checked_at: f64,
}
impl Default for Update {
    fn default() -> Self {
        Self {
            state: "not-checked".into(),
            baseline: BASELINE.clone(),
            current_version: None,
            client_version: None,
            official_version: None,
            official_client_version: None,
            message: String::new(),
            warning: String::new(),
            error: None,
            checked_at: 0.0,
        }
    }
}

fn compare(value: &str, baseline: &str, resource: bool) -> Option<std::cmp::Ordering> {
    if value == baseline {
        return Some(std::cmp::Ordering::Equal);
    }
    if resource {
        let parse = |v: &str| -> Option<Vec<u64>> {
            let pieces = v.split('-').collect::<Vec<_>>();
            if pieces.len() != 7 || pieces[..6].iter().any(|p| p.len() != 2) {
                return None;
            }
            let values = pieces
                .into_iter()
                .map(str::parse::<u64>)
                .collect::<std::result::Result<Vec<_>, _>>()
                .ok()?;
            Some(values[..6].to_vec())
        };
        let ordering = parse(value)?.cmp(&parse(baseline)?);
        if ordering == std::cmp::Ordering::Equal {
            None
        } else {
            Some(ordering)
        }
    } else {
        let parse = |v: &str| -> Option<Vec<u64>> {
            let mut values = v
                .split('.')
                .map(str::parse::<u64>)
                .collect::<std::result::Result<Vec<_>, _>>()
                .ok()?;
            if !(2..=4).contains(&values.len()) {
                return None;
            }
            values.resize(4, 0);
            Some(values)
        };
        Some(parse(value)?.cmp(&parse(baseline)?))
    }
}
pub fn warning(resource: &str, client: &str) -> String {
    let values = [
        compare(resource, &BASELINE.resource_version, true),
        compare(client, &BASELINE.client_version, false),
    ];
    if values.contains(&Some(std::cmp::Ordering::Greater)) {
        "官方已发布新版本，部分新剧情可能无法播放。建议更新 ArkReader。".into()
    } else if values.contains(&None) {
        "当前官方版本与本程序适配的版本不同，建议检查 ArkReader 更新。".into()
    } else {
        String::new()
    }
}
