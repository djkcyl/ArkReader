//! Resource decoding shared by Android and the desktop application.

pub const DECODER_REVISION: &str = env!("ARKREADER_DECODER_REVISION");

pub mod artifacts;

pub mod animated_ui;
pub mod api;
#[cfg(not(target_os = "emscripten"))]
mod apk;
pub mod artwork;
pub mod cache;
pub mod catalog;
pub mod character;
pub mod client_assets;
pub mod effects;
pub mod engine;
pub mod error;
pub mod export;
pub mod flat;
pub mod historical;
pub mod index;
pub mod interlude;
pub mod jobs;
pub mod materials;
pub mod media;
#[cfg(not(target_os = "emscripten"))]
pub mod media_stream;
pub mod model;
pub mod music;
mod net;
pub mod planning;
pub mod prefab;
pub mod progress;
mod prts;
pub mod resource_manifest;
mod runtime;
pub mod scope;
pub mod script;
mod session;
pub mod source;
pub mod special;
pub mod stamp;
pub mod stories;
pub mod story_cache;
pub mod tables;
pub mod ui;
pub mod unity;
pub mod unity_bundle;
pub mod updates;
pub mod video;
#[cfg(target_os = "emscripten")]
pub mod web;
