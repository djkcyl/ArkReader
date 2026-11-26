use anyhow::{ensure, Context, Result};
use futures_util::{Stream, StreamExt};
use http::StatusCode;
use serde::de::DeserializeOwned;
use std::{ffi::CString, sync::Arc, time::Duration};
use url::Url;

unsafe extern "C" {
    fn ark_net_start(url: *const u8, timeout: u32) -> u32;
    fn ark_net_meta(id: u32, data: *mut u8, capacity: usize) -> i32;
    fn ark_net_read(id: u32, data: *mut u8, capacity: usize) -> i32;
    fn ark_net_close(id: u32);
}
struct Ticket(u32);
impl Drop for Ticket {
    fn drop(&mut self) {
        unsafe {
            ark_net_close(self.0);
        }
    }
}
#[derive(Clone)]
pub struct Client;
pub struct Request {
    url: Url,
    timeout: Duration,
}
pub struct Response {
    ticket: Arc<Ticket>,
    status: StatusCode,
}
impl Client {
    pub fn new() -> Self {
        Self
    }
    pub fn get(&self, url: Url) -> Request {
        Request {
            url,
            timeout: Duration::from_secs(90),
        }
    }
}
impl Request {
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
    pub async fn send(self) -> Result<Response> {
        let url = CString::new(self.url.as_str())?;
        let ticket = Arc::new(Ticket(unsafe {
            ark_net_start(
                url.as_ptr().cast(),
                self.timeout.as_millis().min(u128::from(u32::MAX)) as u32,
            )
        }));
        loop {
            let size = unsafe { ark_net_meta(ticket.0, std::ptr::null_mut(), 0) };
            if size == -2 {
                tokio::time::sleep(Duration::from_millis(10)).await;
                continue;
            }
            ensure!(size > 0 && size < 1024 * 1024, "浏览器网络请求失败。");
            let mut bytes = vec![0; size as usize];
            ensure!(
                unsafe { ark_net_meta(ticket.0, bytes.as_mut_ptr(), bytes.len()) } == size,
                "HTTP response metadata changed"
            );
            let meta: serde_json::Value = serde_json::from_slice(&bytes)?;
            if let Some(error) = meta["error"].as_str() {
                anyhow::bail!("{error}");
            }
            return Ok(Response {
                ticket,
                status: StatusCode::from_u16(
                    meta["status"].as_u64().context("Missing HTTP status")? as u16,
                )?,
            });
        }
    }
}
impl Response {
    pub fn error_for_status(self) -> Result<Self> {
        ensure!(
            self.status.is_success(),
            "资源请求失败：HTTP {}",
            self.status
        );
        Ok(self)
    }
    pub fn bytes_stream(self) -> impl Stream<Item = Result<Vec<u8>>> + Send {
        futures_util::stream::unfold(Some(self.ticket), |state| async move {
            let ticket = state?;
            loop {
                let mut bytes = vec![0; 65536];
                let size = unsafe { ark_net_read(ticket.0, bytes.as_mut_ptr(), bytes.len()) };
                if size == -2 {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    continue;
                }
                if size < 0 {
                    return Some((Err(anyhow::anyhow!("资源下载中断，请重试。")), None));
                }
                if size == 0 {
                    return None;
                }
                bytes.truncate(size as usize);
                return Some((Ok(bytes), Some(ticket)));
            }
        })
        .boxed()
    }
    pub async fn json<T: DeserializeOwned>(self) -> Result<T> {
        let mut stream = self.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            bytes.extend(chunk?);
            ensure!(bytes.len() <= 64 * 1024 * 1024, "资源清单超过大小限制。");
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
}
