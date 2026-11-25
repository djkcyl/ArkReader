use crate::progress::{Kind, Progress};
use anyhow::{ensure, Result};
use futures_util::FutureExt;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    future::Future,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tokio_util::sync::CancellationToken;

pub struct Jobs {
    sequence: AtomicU64,
    entries: Mutex<BTreeMap<String, Arc<Progress>>>,
    root: CancellationToken,
}
impl Jobs {
    pub fn new(root: CancellationToken) -> Self {
        Self {
            sequence: AtomicU64::new(1),
            entries: Mutex::new(BTreeMap::new()),
            root,
        }
    }
    pub fn create(&self, kind: Kind, automatic: bool) -> Result<Arc<Progress>> {
        let mut entries = self.entries.lock().unwrap();
        ensure!(
            !entries
                .values()
                .any(|job| job.running()
                    && ((kind == Kind::HomeMusic) == (job.kind == Kind::HomeMusic))),
            "资源正在处理中，请稍后再试。"
        );
        let id = self.sequence.fetch_add(1, Ordering::Relaxed).to_string();
        let job = Arc::new(Progress::new(
            id.clone(),
            kind,
            automatic,
            self.root.child_token(),
        ));
        entries.insert(id, job.clone());
        while entries.len() > 32 {
            let Some(key) = entries
                .iter()
                .filter(|(_, job)| !job.running())
                .min_by_key(|(id, _)| id.parse::<u64>().unwrap_or(0))
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            entries.remove(&key);
        }
        Ok(job)
    }
    pub fn spawn<F>(&self, job: Arc<Progress>, work: F)
    where
        F: Future<Output = Result<Value>> + Send + 'static,
    {
        tokio::spawn(async move {
            let result = std::panic::AssertUnwindSafe(work)
                .catch_unwind()
                .await
                .unwrap_or_else(|_| Err(anyhow::anyhow!("资源处理任务意外中断，请重试。")));
            job.finish(result);
        });
    }
    pub fn get(&self, id: &str) -> Option<Arc<Progress>> {
        self.entries.lock().unwrap().get(id).cloned()
    }
    pub fn latest(&self, kind: Option<Kind>) -> Option<Arc<Progress>> {
        self.entries
            .lock()
            .unwrap()
            .values()
            .filter(|job| kind.map_or(job.kind != Kind::HomeMusic, |kind| job.kind == kind))
            .max_by_key(|job| job.id.parse::<u64>().unwrap_or(0))
            .cloned()
    }
    pub fn busy(&self) -> bool {
        self.entries
            .lock()
            .unwrap()
            .values()
            .any(|job| job.running())
    }
    pub fn cancel_all(&self) {
        for job in self.entries.lock().unwrap().values() {
            job.cancel();
        }
    }
}
