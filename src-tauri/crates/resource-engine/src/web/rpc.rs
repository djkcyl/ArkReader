use crate::{api, engine::Engine};
use anyhow::{Context, Result};
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde::Deserialize;
use std::{
    cell::RefCell,
    collections::BTreeMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, OnceLock,
    },
};
use tower::ServiceExt;

#[derive(Deserialize)]
struct Message {
    method: String,
    path: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body: String,
}
static ENGINE: OnceLock<Arc<Engine>> = OnceLock::new();
static ROUTER: OnceLock<axum::Router> = OnceLock::new();
static PENDING: AtomicUsize = AtomicUsize::new(0);
thread_local! { static RUNTIME: RefCell<Option<tokio::runtime::Runtime>> = const { RefCell::new(None) }; }
unsafe extern "C" {
    fn ark_ready();
    fn ark_reply(
        id: u32,
        status: u32,
        headers: *const u8,
        headers_len: usize,
        body: *const u8,
        body_len: usize,
    );
    fn ark_fatal(message: *const u8, length: usize);
}
pub fn install() {}
fn reply(id: u32, status: u32, headers: &BTreeMap<String, String>, body: &[u8]) {
    let headers = serde_json::to_vec(headers).unwrap_or_default();
    unsafe {
        ark_reply(
            id,
            status,
            headers.as_ptr(),
            headers.len(),
            body.as_ptr(),
            body.len(),
        );
    }
}
fn failed(id: u32, error: impl std::fmt::Display) {
    let body = serde_json::to_vec(&serde_json::json!({"detail":error.to_string()})).unwrap();
    reply(
        id,
        500,
        &BTreeMap::from([("content-type".into(), "application/json".into())]),
        &body,
    );
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ark_request(id: u32, data: *const u8, length: usize) {
    let bytes = unsafe { std::slice::from_raw_parts(data, length) }.to_vec();
    let Some(router) = ROUTER.get().cloned() else {
        failed(id, "资源引擎尚未就绪。");
        return;
    };
    RUNTIME.with(|runtime| {
        let runtime = runtime.borrow();
        let _guard = runtime.as_ref().unwrap().enter();
        PENDING.fetch_add(1, Ordering::Relaxed);
        tokio::spawn(async move {
            let result: Result<()> = async {
                let message: Message = serde_json::from_slice(&bytes)?;
                anyhow::ensure!(
                    message.path.starts_with("/api/") || message.path.starts_with("/media/"),
                    "Invalid resource request"
                );
                let mut request = Request::builder()
                    .method(message.method.as_str())
                    .uri(&message.path);
                for (key, value) in message.headers {
                    request = request.header(key, value);
                }
                let response = router
                    .oneshot(request.body(Body::from(message.body))?)
                    .await?;
                let (parts, body) = response.into_parts();
                let headers = parts
                    .headers
                    .iter()
                    .map(|(k, v)| Ok((k.to_string(), v.to_str()?.to_owned())))
                    .collect::<Result<BTreeMap<_, _>>>()?;
                let bytes = body
                    .collect()
                    .await
                    .context("Could not read browser resource response")?
                    .to_bytes();
                reply(id, parts.status.as_u16().into(), &headers, &bytes);
                Ok(())
            }
            .await;
            if let Err(error) = result {
                failed(id, error);
            }
            PENDING.fetch_sub(1, Ordering::Relaxed);
        });
    });
}
#[unsafe(no_mangle)]
pub extern "C" fn ark_playing(playing: i32) {
    if let Some(engine) = ENGINE.get() {
        engine.set_playing(playing != 0);
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn ark_init() {
    let result: Result<()> = (|| {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .event_interval(1)
            .build()?;
        {
            let _guard = runtime.enter();
            let engine = Engine::new("/library".into(), "/render".into())?;
            let _ = ROUTER.set(api::router(engine.clone()));
            let _ = ENGINE.set(engine.clone());
            engine.start(true)?;
        }
        RUNTIME.with(|state| *state.borrow_mut() = Some(runtime));
        unsafe {
            ark_ready();
        }
        Ok(())
    })();
    if let Err(error) = result {
        let message = format!("{error:#}");
        unsafe {
            ark_fatal(message.as_ptr(), message.len());
        }
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn ark_poll() -> i32 {
    RUNTIME.with(|state| {
        if let Some(runtime) = state.borrow().as_ref() {
            runtime.block_on(tokio::task::yield_now());
        }
    });
    i32::from(
        PENDING.load(Ordering::Relaxed) > 0
            || ENGINE.get().is_some_and(|engine| engine.jobs.busy()),
    )
}
