#[cfg(target_os = "emscripten")]
pub use crate::web::http::Client;
#[cfg(not(target_os = "emscripten"))]
pub use reqwest::{header, Client, StatusCode, Url};
#[cfg(target_os = "emscripten")]
pub use url::Url;
