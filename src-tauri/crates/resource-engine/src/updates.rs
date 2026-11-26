use crate::source::Platform;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub platform: Platform,
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

fn compare_client(value: &str, baseline: &str) -> Option<std::cmp::Ordering> {
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
fn compare_resource(value: &str, baseline: &str) -> Option<std::cmp::Ordering> {
    if value == baseline {
        return Some(std::cmp::Ordering::Equal);
    }
    let timestamp = |value: &str| -> Option<Vec<u32>> {
        let parts = value.split(['-', '_']).collect::<Vec<_>>();
        if parts.len() < 7 || parts[..6].iter().any(|s| s.len() != 2) {
            return None;
        }
        parts[..6].iter().map(|s| s.parse().ok()).collect()
    };
    match timestamp(value)?.cmp(&timestamp(baseline)?) {
        std::cmp::Ordering::Equal => None,
        order => Some(order),
    }
}
pub fn warning(resource: &str, client: &str, baseline: &Baseline) -> String {
    // Every host consumes Android resources. Hot updates can change scripts or
    // assets without changing the client version and must still be checked.
    let resource_order = compare_resource(resource, &baseline.resource_version);
    let client_order = compare_client(client, &baseline.client_version);
    if [resource_order, client_order].contains(&Some(std::cmp::Ordering::Greater)) {
        "当前资源或客户端已超过适配基线，部分剧情可能无法播放。建议更新 ArkReader。".into()
    } else if resource_order.is_none() || client_order.is_none() {
        "当前资源或客户端版本尚未确认适配，建议检查 ArkReader 更新。".into()
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn compares_client_versions_numerically() {
        assert_eq!(compare_client("2.7.91", "2.7.91.0"), Some(Ordering::Equal));
        assert_eq!(compare_client("2.10.1", "2.9.99"), Some(Ordering::Greater));
        assert_eq!(compare_client("2.7.91", "2.8.0"), Some(Ordering::Less));
        assert_eq!(compare_client("future-format", "2.7.91"), None);
    }

    #[test]
    fn checks_both_android_resource_and_client_versions() {
        let b = &*BASELINE;
        assert_eq!(b.platform, Platform::Android);
        assert!(warning(&b.resource_version, &b.client_version, b).is_empty());
        assert!(!warning("99-01-01-00-00-00-new", &b.client_version, b).is_empty());
        assert!(!warning(&b.resource_version, "999.0.0", b).is_empty());
        assert!(!warning("unknown", &b.client_version, b).is_empty());
    }

    #[test]
    fn changed_resource_identity_is_not_hidden_by_matching_timestamps() {
        let b = &*BASELINE;
        assert!(!warning("26-11-13-06-37-23-changed", &b.client_version, b).is_empty());
        assert_eq!(
            compare_resource("26-08-17-11-25-42_dbc172", &b.resource_version),
            Some(Ordering::Less)
        );
    }
}
