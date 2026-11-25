use crate::{cache::safe_path, engine::Engine, error::Error};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

pub struct ApiError(anyhow::Error, StatusCode);
impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self(error, StatusCode::CONFLICT)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut value = json!({"detail":self.0.to_string()});
        if let Some(Error::UnsupportedScript(report)) = self.0.downcast_ref::<Error>() {
            value["compatibility"] = json!(report);
        }
        (self.1, Json(value)).into_response()
    }
}
type Result<T> = std::result::Result<T, ApiError>;
type Shared = State<Arc<Engine>>;

pub fn router(engine: Arc<Engine>) -> Router {
    Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({"ready":true,"native":true})) }),
        )
        .route("/api/status", get(status))
        .route("/api/storage", get(storage))
        .route("/api/import", post(initialize))
        .route("/api/cache/clear", post(clear))
        .route("/api/catalog", get(catalog))
        .route("/api/playable-stories", get(catalog))
        .route("/api/profile", get(profile))
        .route("/api/filter-profile", get(filters))
        .route("/api/blocker-profile", get(blocker))
        .route("/api/catalog-art/{id}", get(cover))
        .route("/api/home-music", get(music))
        .route("/api/home-music/{id}/prepare", post(prepare_music))
        .route("/api/home-music/operations/{id}", get(operation))
        .route("/api/home-music/operations/{id}/cancel", post(cancel))
        .route("/api/prepare", post(prepare))
        .route("/api/story/{*story}", get(story))
        .route("/api/operations/{id}", get(operation))
        .route("/api/operations/{id}/cancel", post(cancel))
        .route("/api/story-cache", get(cache_status).post(cache_stories))
        .route("/media/{*name}", get(media))
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .with_state(engine)
}

async fn status(State(engine): Shared) -> Result<Json<Value>> {
    Ok(Json(engine.status().await?))
}
async fn storage(
    State(engine): Shared,
    Query(query): Query<BTreeMap<String, String>>,
) -> Result<Json<Value>> {
    Ok(Json(
        engine
            .storage(query.get("scan").is_none_or(|s| s != "false"))
            .await?,
    ))
}
async fn initialize(State(engine): Shared) -> Result<Json<Value>> {
    Ok(Json(engine.start(false)?.snapshot(false)))
}
async fn clear(State(engine): Shared) -> Result<Json<Value>> {
    engine.clear_cache().await?;
    Ok(Json(json!({"cleared":true})))
}
async fn catalog(State(engine): Shared) -> Result<Json<Value>> {
    let current = engine.current().await?;
    Ok(Json(
        serde_json::to_value(&current.base.catalog).map_err(anyhow::Error::from)?,
    ))
}
async fn profile(State(engine): Shared) -> Result<Json<Value>> {
    Ok(Json(engine.current().await?.base.profile.clone()))
}
async fn filters(State(engine): Shared) -> Result<Json<Value>> {
    Ok(Json(engine.current().await?.base.filters.clone()))
}
async fn blocker(State(engine): Shared) -> Result<Json<Value>> {
    Ok(Json(engine.current().await?.base.blocker.clone()))
}
async fn music(State(engine): Shared) -> Result<Json<Value>> {
    let current = engine.current().await?;
    let music = &current.base.music;
    Ok(Json(json!({
        "version":current.index.source.version,
        "default":music.default,
        "tracks":music.tracks.iter().map(|t|json!({"id":t.id,"name":t.name,"backgrounds":t.backgrounds})).collect::<Vec<_>>()
    })))
}
async fn prepare_music(State(engine): Shared, Path(id): Path<String>) -> Result<Json<Value>> {
    Ok(Json(engine.start_music(id).await?.snapshot(false)))
}
#[derive(Deserialize)]
struct Prepare {
    story: String,
}
async fn prepare(State(engine): Shared, Json(body): Json<Prepare>) -> Result<Json<Value>> {
    Ok(Json(engine.start_story(body.story).await?.snapshot(false)))
}
async fn story(State(engine): Shared, Path(id): Path<String>) -> Result<Json<Value>> {
    let job = engine.start_story(id).await?;
    while job.running() {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let value = job.snapshot(true);
    if let Some(result) = value.get("result") {
        return Ok(Json(result.clone()));
    }
    Err(ApiError(
        anyhow::anyhow!(value["error"]
            .as_str()
            .unwrap_or("剧情准备已取消。")
            .to_owned()),
        StatusCode::CONFLICT,
    ))
}
async fn operation(State(engine): Shared, Path(id): Path<String>) -> Result<Json<Value>> {
    let job = engine.jobs.get(&id).ok_or_else(|| {
        ApiError(
            anyhow::anyhow!("任务已过期，请重新尝试。"),
            StatusCode::NOT_FOUND,
        )
    })?;
    Ok(Json(job.snapshot(true)))
}
async fn cancel(State(engine): Shared, Path(id): Path<String>) -> Result<Json<Value>> {
    Ok(Json(engine.cancel_job(&id)?))
}
async fn cache_status(State(engine): Shared) -> Result<Json<Value>> {
    Ok(Json(engine.cache_status().await?))
}
#[derive(Deserialize)]
struct CacheRequest {
    stories: Vec<String>,
}
async fn cache_stories(
    State(engine): Shared,
    Json(body): Json<CacheRequest>,
) -> Result<Json<Value>> {
    Ok(Json(
        engine.start_cache(body.stories).await?.snapshot(false),
    ))
}

async fn cover(
    State(engine): Shared,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response> {
    let current = engine.current().await?;
    let image = current.base.covers.get(&id).ok_or_else(|| {
        ApiError(
            anyhow::anyhow!("此章节没有回顾封面。"),
            StatusCode::NOT_FOUND,
        )
    })?;
    let name = image
        .url
        .strip_prefix("/media/")
        .ok_or_else(|| anyhow::anyhow!("Invalid cover URL"))?;
    serve_media(&engine, name, &headers).await
}
async fn media(
    State(engine): Shared,
    Path(name): Path<String>,
    headers: HeaderMap,
) -> Result<Response> {
    serve_media(&engine, &name, &headers).await
}

pub async fn serve_media(engine: &Engine, name: &str, headers: &HeaderMap) -> Result<Response> {
    let path = safe_path(&engine.store.directory, name)?;
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|error| ApiError(error.into(), StatusCode::NOT_FOUND))?;
    let size = file.metadata().await.map_err(anyhow::Error::from)?.len();
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    if size == 0 && range.is_some() {
        return Ok(range_error(size));
    }
    let (start, end, partial) = if let Some(range) = range {
        let Some(range) = range.strip_prefix("bytes=").filter(|s| !s.contains(',')) else {
            return Ok(range_error(size));
        };
        let Some((first, last)) = range.split_once('-') else {
            return Ok(range_error(size));
        };
        if first.is_empty() {
            let Some(length) = last.parse::<u64>().ok().filter(|n| *n > 0) else {
                return Ok(range_error(size));
            };
            (size.saturating_sub(length), size.saturating_sub(1), true)
        } else {
            let Some(start) = first.parse::<u64>().ok().filter(|start| *start < size) else {
                return Ok(range_error(size));
            };
            let end = if last.is_empty() {
                size.saturating_sub(1)
            } else {
                let Some(end) = last.parse::<u64>().ok().filter(|end| *end >= start) else {
                    return Ok(range_error(size));
                };
                end.min(size.saturating_sub(1))
            };
            (start, end, true)
        }
    } else {
        (0, size.saturating_sub(1), false)
    };
    let length = if size == 0 { 0 } else { end - start + 1 };
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(anyhow::Error::from)?;
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    let mime = match extension {
        "png" => "image/png",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "json" => "application/json",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    };
    let body = Body::from_stream(tokio_util::io::ReaderStream::new(file.take(length)));
    let mut response = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, length)
        .header(header::CACHE_CONTROL, "no-store");
    if partial {
        response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    Ok(response.body(body).map_err(anyhow::Error::from)?)
}
fn range_error(size: u64) -> Response {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::CONTENT_RANGE, format!("bytes */{size}"))
        .body(Body::empty())
        .unwrap()
}
