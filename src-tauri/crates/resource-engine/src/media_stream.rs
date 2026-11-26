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

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn movie_ranges_require_the_session_key_and_close_with_the_app() -> Result<()> {
        let root = tempfile::tempdir()?;
        let engine = Engine::new(root.path().join("data"), root.path().join("render"))?;
        let url = engine.store.bytes(b"0123456789", "mp4")?;
        let server = MediaStream::start(engine.clone()).await?;
        let base = engine.movie_base.get().unwrap();
        let url = format!("{base}/{}", url.strip_prefix("/media/").unwrap());
        let client = reqwest::Client::builder().no_proxy().build()?;
        let response = client.get(&url).header("Range", "bytes=3-6").send().await?;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 3-6/10");
        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        assert_eq!(&response.bytes().await?[..], b"3456");
        assert_eq!(
            client.head(&url).send().await?.headers()[header::CONTENT_LENGTH],
            "10"
        );
        assert_eq!(
            client
                .get(format!("{base}/settings.json"))
                .send()
                .await?
                .status(),
            StatusCode::NOT_FOUND
        );
        let address = reqwest::Url::parse(&url)?;
        let port = address.port().unwrap();
        assert_eq!(
            client
                .get(format!("http://127.0.0.1:{port}/wrong/movie.mp4"))
                .send()
                .await?
                .status(),
            StatusCode::NOT_FOUND
        );
        server.close().await;
        assert!(
            tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
                .await
                .is_err()
        );
        engine.shutdown().await;
        Ok(())
    }
}
