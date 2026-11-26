#[cfg(target_os = "emscripten")]
fn main() {
    arkreader_resource_engine::web::install();
}
#[cfg(not(target_os = "emscripten"))]
fn main() {
    panic!("Build arkreader-web for wasm32-unknown-emscripten");
}
