use crate::{error::Error, script::Compatibility};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::Mutex,
    time::Instant,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Import,
    Prepare,
    Cache,
    HomeMusic,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Queue,
    Cache,
    Connect,
    Index,
    BasePlan,
    UiDownload,
    Ui,
    BaseDownload,
    Catalog,
    BaseVerify,
    Compatibility,
    Resources,
    Download,
    Convert,
    Verify,
    CachePlan,
    CacheVerify,
    Ready,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Queued,
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferState {
    Pending,
    Checking,
    Downloading,
    Verifying,
    Ready,
    Failed,
}

pub trait Observer: Send + Sync {
    fn transfer(
        &self,
        key: &str,
        name: &str,
        total: u64,
        state: TransferState,
        downloaded: Option<u64>,
        cached: Option<bool>,
    );
}
struct Transfer {
    name: String,
    number: usize,
    total: u64,
    downloaded: u64,
    cached: bool,
    state: TransferState,
    samples: VecDeque<(Instant, u64)>,
}
struct Data {
    state: State,
    phase: Phase,
    message: String,
    resource: String,
    done: usize,
    total: usize,
    overall: f64,
    error: Option<String>,
    result: Option<Value>,
    compatibility: Option<Compatibility>,
    finished: Option<Instant>,
    transfers: BTreeMap<String, Transfer>,
    transfer_plan: BTreeSet<String>,
    extra: BTreeMap<String, Value>,
}

pub struct Progress {
    pub id: String,
    pub kind: Kind,
    pub automatic: bool,
    pub cancel: CancellationToken,
    started: Instant,
    data: Mutex<Data>,
}
impl Progress {
    pub fn new(id: String, kind: Kind, automatic: bool, cancel: CancellationToken) -> Self {
        Self {
            id,
            kind,
            automatic,
            cancel,
            started: Instant::now(),
            data: Mutex::new(Data {
                state: State::Queued,
                phase: Phase::Queue,
                message: "准备资源…".into(),
                resource: String::new(),
                done: 0,
                total: 0,
                overall: 0.0,
                error: None,
                result: None,
                compatibility: None,
                finished: None,
                transfers: BTreeMap::new(),
                transfer_plan: BTreeSet::new(),
                extra: BTreeMap::new(),
            }),
        }
    }
    pub fn running(&self) -> bool {
        matches!(
            self.data.lock().unwrap().state,
            State::Queued | State::Running | State::Cancelling
        )
    }
    pub fn phase(
        &self,
        phase: Phase,
        message: impl Into<String>,
        done: usize,
        total: usize,
        resource: impl Into<String>,
    ) {
        let mut d = self.data.lock().unwrap();
        if self.cancel.is_cancelled() {
            return;
        }
        d.state = State::Running;
        if d.phase != phase {
            d.transfer_plan.clear();
        }
        d.phase = phase;
        d.message = message.into();
        d.done = done;
        d.total = total;
        d.resource = resource.into();
        self.advance(&mut d);
    }
    pub fn extra(&self, key: &str, value: Value) {
        self.data.lock().unwrap().extra.insert(key.into(), value);
    }
    pub fn plan(&self, items: impl IntoIterator<Item = (String, String, u64)>) {
        let mut d = self.data.lock().unwrap();
        d.transfer_plan.clear();
        for (key, name, total) in items {
            d.transfer_plan.insert(key.clone());
            let number = d.transfers.len() + 1;
            d.transfers.entry(key).or_insert(Transfer {
                name,
                number,
                total,
                downloaded: 0,
                cached: false,
                state: TransferState::Pending,
                samples: VecDeque::new(),
            });
        }
        self.advance(&mut d);
    }
    pub fn cancel(&self) {
        let mut d = self.data.lock().unwrap();
        if matches!(d.state, State::Queued | State::Running | State::Cancelling) {
            d.state = State::Cancelling;
            d.message = "正在取消…".into();
            self.cancel.cancel();
        }
    }
    pub fn finish(&self, result: anyhow::Result<Value>) {
        let mut d = self.data.lock().unwrap();
        d.finished = Some(Instant::now());
        if self.cancel.is_cancelled() {
            d.state = State::Cancelled;
            d.message = "已取消".into();
            return;
        }
        match result {
            Ok(value) => {
                d.state = State::Completed;
                d.phase = Phase::Ready;
                d.message = "已准备完成".into();
                d.done = d.total;
                d.result = Some(value);
                self.advance(&mut d);
            }
            Err(error) => {
                d.state = State::Failed;
                d.message = "准备未完成".into();
                d.error = Some(format!("{error:#}"));
                if let Some(Error::UnsupportedScript(report)) = error.downcast_ref::<Error>() {
                    d.compatibility = Some(report.as_ref().clone());
                }
            }
        }
    }
    fn budgets(&self, phase: Phase) -> (f64, f64) {
        match self.kind {
            Kind::Prepare | Kind::HomeMusic => match phase {
                Phase::Compatibility => (0.01, 0.02),
                Phase::Ui => (0.02, 0.12),
                Phase::Resources => (0.12, 0.16),
                Phase::Download => (0.16, 0.70),
                Phase::Convert => (0.70, 0.88),
                Phase::Verify => (0.88, 0.90),
                Phase::Ready => (0.90, 0.90),
                _ => (0.0, 0.0),
            },
            Kind::Cache => match phase {
                Phase::CachePlan => (0.0, 0.15),
                Phase::Download => (0.15, 0.95),
                Phase::CacheVerify => (0.95, 0.99),
                Phase::Ready => (1.0, 1.0),
                _ => (0.0, 0.0),
            },
            Kind::Import => match phase {
                Phase::Cache => (0.0, 0.02),
                Phase::Connect => (0.02, 0.08),
                Phase::Index | Phase::Download => (0.08, 0.20),
                Phase::BasePlan => (0.20, 0.22),
                Phase::UiDownload => (0.22, 0.36),
                Phase::Ui => (0.36, 0.64),
                Phase::BaseDownload => (0.64, 0.86),
                Phase::Catalog => (0.86, 0.98),
                Phase::BaseVerify => (0.98, 0.99),
                Phase::Ready => (1.0, 1.0),
                _ => (0.0, 0.0),
            },
        }
    }
    fn advance(&self, d: &mut Data) {
        let (start, end) = self.budgets(d.phase);
        let fraction = if matches!(
            d.phase,
            Phase::Download | Phase::UiDownload | Phase::BaseDownload
        ) && !d.transfer_plan.is_empty()
        {
            let total = d
                .transfer_plan
                .iter()
                .filter_map(|key| d.transfers.get(key))
                .map(|t| t.total.max(1) as f64)
                .sum::<f64>();
            d.transfer_plan
                .iter()
                .filter_map(|key| d.transfers.get(key))
                .map(|t| {
                    if t.state == TransferState::Ready {
                        t.total.max(1) as f64
                    } else {
                        t.downloaded.min(t.total) as f64 * 0.95
                    }
                })
                .sum::<f64>()
                / total
        } else if d.total > 0 {
            (d.done as f64 / d.total as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };
        d.overall = d.overall.max(start + (end - start) * fraction);
    }
    pub fn snapshot(&self, include_result: bool) -> Value {
        let mut d = self.data.lock().unwrap();
        let now = Instant::now();
        self.advance(&mut d);
        let running = matches!(d.state, State::Queued | State::Running | State::Cancelling);
        let mut total = 0;
        let mut ready = 0;
        let mut cached = 0;
        let mut total_bytes = 0;
        let mut ready_bytes = 0;
        let mut downloaded = 0;
        let mut active = 0;
        let mut speed = 0.0;
        let mut items = Vec::new();
        for row in d.transfers.values_mut() {
            total += 1;
            total_bytes += row.total;
            downloaded += row.downloaded;
            if row.state == TransferState::Ready {
                ready += 1;
                ready_bytes += row.total;
                if row.cached {
                    cached += 1;
                }
            }
            if running && row.state == TransferState::Downloading {
                active += 1;
            }
            while row.samples.len() > 2
                && row.samples[1].0 + std::time::Duration::from_secs(3) < now
            {
                row.samples.pop_front();
            }
            let rate = if running
                && row.state == TransferState::Downloading
                && row.samples.len() >= 2
                && row
                    .samples
                    .back()
                    .is_some_and(|(time, _)| now.duration_since(*time).as_secs_f64() < 3.0)
            {
                let (first, bytes) = row.samples[0];
                (row.downloaded - bytes) as f64 / now.duration_since(first).as_secs_f64().max(0.05)
            } else {
                0.0
            };
            speed += rate;
            if matches!(
                row.state,
                TransferState::Checking
                    | TransferState::Downloading
                    | TransferState::Verifying
                    | TransferState::Failed
            ) {
                items.push(json!({"number":row.number,"name":row.name,"total":row.total,"downloaded":row.downloaded,"state":row.state,"bytesPerSecond":rate}));
            }
        }
        items.sort_by_key(|r| r["number"].as_u64());
        items.truncate(8);
        let elapsed = d
            .finished
            .unwrap_or(now)
            .duration_since(self.started)
            .as_secs_f64();
        let mut value = json!({
            "id":self.id,
            "kind":self.kind,
            "state":d.state,
            "running":running,
            "phase":d.phase,
            "message":d.message,
            "done":d.done,
            "total":d.total,
            "resource":d.resource,
            "error":d.error,
            "elapsed":(elapsed*10.0).round()/10.0,
            "overallProgress":d.overall,
            "automatic":self.automatic,
            "downloaded":downloaded,
            "downloadTotal":total_bytes,
            "transfers":{"totalFiles":total,"readyFiles":ready,"cachedFiles":cached,"totalBytes":total_bytes,"readyBytes":ready_bytes,"downloadedBytes":downloaded,"activeDownloads":active,"bytesPerSecond":speed,"items":items}
        });
        if include_result {
            if let Some(result) = &d.result {
                value["result"] = result.clone();
            }
        }
        if let Some(report) = &d.compatibility {
            value["compatibility"] = json!(report);
        }
        value.as_object_mut().unwrap().extend(d.extra.clone());
        value
    }
}
impl Observer for Progress {
    fn transfer(
        &self,
        key: &str,
        name: &str,
        total: u64,
        state: TransferState,
        downloaded: Option<u64>,
        cached: Option<bool>,
    ) {
        let mut d = self.data.lock().unwrap();
        let now = Instant::now();
        let number = d.transfers.len() + 1;
        let row = d.transfers.entry(key.into()).or_insert_with(|| Transfer {
            name: name.into(),
            number,
            total,
            downloaded: 0,
            cached: false,
            state: TransferState::Pending,
            samples: VecDeque::new(),
        });
        if !(state == TransferState::Checking && row.state == TransferState::Ready) {
            row.state = state;
        }
        if state == TransferState::Downloading && row.samples.is_empty() {
            row.samples.push_back((now, row.downloaded));
        }
        if let Some(bytes) = downloaded {
            if bytes > row.downloaded {
                row.downloaded = bytes;
                row.samples.push_back((now, bytes));
                while row.samples.len() > 128 {
                    row.samples.pop_front();
                }
            }
        }
        if let Some(cached) = cached {
            row.cached = cached && row.downloaded == 0;
        }
        if matches!(
            state,
            TransferState::Checking | TransferState::Downloading | TransferState::Verifying
        ) {
            d.resource = name.into();
        }
        self.advance(&mut d);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn progress_never_rewinds_when_more_dependencies_are_discovered() {
        let p = Progress::new(
            "test".into(),
            Kind::Prepare,
            false,
            CancellationToken::new(),
        );
        p.phase(Phase::Download, "download", 0, 0, "");
        p.transfer(
            "one",
            "one",
            100,
            TransferState::Ready,
            Some(100),
            Some(false),
        );
        let previous = p.snapshot(false)["overallProgress"].as_f64().unwrap();
        p.transfer(
            "two",
            "two",
            900,
            TransferState::Downloading,
            Some(0),
            Some(false),
        );
        let next = p.snapshot(false);
        assert!(next["overallProgress"].as_f64().unwrap() >= previous);
        assert_eq!(next["transfers"]["readyFiles"], 1);
        assert_eq!(next["transfers"]["totalFiles"], 2);
    }
}
