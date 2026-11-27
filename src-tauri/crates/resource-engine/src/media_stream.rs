//! WebKitGTK loads movie data over loopback HTTP instead of a custom URI scheme.
use crate::{api, engine::Engine};
use anyhow::{ensure, Result};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::{sync::Arc, time::Duration};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

pub struct MediaStream {
    stop: CancellationToken,
    task: Option<JoinHandle<()>>,
}
impl MediaStream {
    pub async fn start(engine: Arc<Engine>) -> Result<Self> {
        let mut random = [0u8; 32];
        getrandom::fill(&mut random).map_err(|e| anyhow::anyhow!("Media session key: {e}"))?;
        let token = hex::encode(random);
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let base = format!("http://127.0.0.1:{}/{token}", listener.local_addr()?.port());
        ensure!(
            engine.movie_base.set(base).is_ok(),
            "Movie stream is already running"
        );
        let router = Router::new()
            .route(
                &format!("/{token}/{{name}}"),
                get(movie).options(|| async { cors(StatusCode::NO_CONTENT.into_response()) }),
            )
            .with_state(engine);
        let stop = CancellationToken::new();
        let cancelled = stop.clone();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(cancelled.cancelled_owned())
                .await;
        });
        Ok(Self {
            stop,
            task: Some(task),
        })
    }
    pub async fn close(mut self) {
        self.stop.cancel();
        if let Some(mut task) = self.task.take() {
            if tokio::time::timeout(Duration::from_secs(2), &mut task)
                .await
                .is_err()
            {
                task.abort();
            }
        }
    }
}
impl Drop for MediaStream {
    fn drop(&mut self) {
        self.stop.cancel();
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

fn cors(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Range"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Length, Content-Range, Accept-Ranges"),
    );
    response
}
async fn movie(
    State(engine): State<Arc<Engine>>,
    Path(name): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !name
        .strip_suffix(".mp4")
        .is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit()))
    {
        return cors(StatusCode::NOT_FOUND.into_response());
    }
    cors(match api::serve_media(&engine, &name, &headers).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    })
}
