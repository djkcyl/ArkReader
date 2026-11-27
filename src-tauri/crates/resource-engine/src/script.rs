use crate::error::checkpoint;
#[cfg(not(target_os = "emscripten"))]
use anyhow::Context as _;
use anyhow::Result;
#[cfg(not(target_os = "emscripten"))]
use rquickjs::{Context, Function, Runtime};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
#[cfg(not(target_os = "emscripten"))]
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

const PARSER: &str = include_str!(concat!(env!("OUT_DIR"), "/script-parser.js"));

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub command: String,
    pub raw: String,
    pub key: String,
    #[serde(default)]
    pub tile_metadata: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Support {
    Supported,
    Unsupported,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompatibilityIssue {
    pub line: u32,
    pub command: String,
    pub feature: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Compatibility {
    pub status: Support,
    pub command_count: u32,
    pub decision_count: u32,
    pub issues: Vec<CompatibilityIssue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analyzer_sha256: Option<String>,
}

pub struct Analyzer;
impl Analyzer {
    pub fn revision() -> String {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(PARSER.as_bytes()))
    }
    #[cfg(not(target_os = "emscripten"))]
    fn run<T: DeserializeOwned>(
        mode: &str,
        script: &str,
        variables: &BTreeMap<String, Value>,
        cancel: &CancellationToken,
    ) -> Result<T> {
        checkpoint(cancel)?;
        let runtime = Runtime::new()?;
        runtime.set_memory_limit(64 * 1024 * 1024);
        runtime.set_max_stack_size(1024 * 1024);
        let deadline = Instant::now() + Duration::from_secs(20);
        let cancellation = cancel.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || {
            cancellation.is_cancelled() || Instant::now() > deadline
        })));
        let context = Context::full(&runtime)?;
        let payload =
            serde_json::to_string(&serde_json::json!({"script":script,"variables":variables}))?;
        let result: Result<String> = context.with(|ctx| {
            ctx.eval::<(), _>(PARSER)
                .context("Could not initialize the shared story parser")?;
            let function: Function = ctx.globals().get("arkreaderAnalyze")?;
            match function.call::<_, String>((mode, payload)) {
                Ok(value) => Ok(value),
                Err(error) => {
                    let exception = ctx.catch();
                    let message = exception
                        .as_exception()
                        .and_then(|e| e.message())
                        .unwrap_or_else(|| error.to_string());
                    Err(anyhow::anyhow!(message))
                }
            }
        });
        checkpoint(cancel)?;
        Ok(serde_json::from_str(&result?)?)
    }
    #[cfg(target_os = "emscripten")]
    fn run<T: DeserializeOwned>(
        mode: &str,
        script: &str,
        variables: &BTreeMap<String, Value>,
        cancel: &CancellationToken,
    ) -> Result<T> {
        checkpoint(cancel)?;
        let payload =
            serde_json::to_string(&serde_json::json!({"script":script,"variables":variables}))?;
        let result = crate::web::analyze(mode, &payload)?;
        checkpoint(cancel)?;
        Ok(serde_json::from_str(&result)?)
    }
    pub fn references(
        script: &str,
        variables: &BTreeMap<String, Value>,
        cancel: &CancellationToken,
    ) -> Result<Vec<Reference>> {
        Self::run("references", script, variables, cancel)
    }
    pub fn compatibility(
        script: &str,
        variables: &BTreeMap<String, Value>,
        cancel: &CancellationToken,
    ) -> Result<Compatibility> {
        Self::run("compatibility", script, variables, cancel)
    }
}
