use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
fn files(root: &Path, items: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(root).expect("Decoder source directory") {
        let entry = entry.expect("Decoder source file");
        let path = entry.path();
        if entry.file_type().unwrap().is_dir() {
            files(&path, items);
        } else {
            items.push(path);
        }
    }
}
fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .join("../../..")
        .canonicalize()
        .unwrap();
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("emscripten") {
        let media = root.join("src-tauri/resources/web-media");
        println!("cargo:rerun-if-changed={}", media.display());
        println!("cargo:rustc-link-search=native={}", media.display());
        for name in [
            "arkreader_media",
            "avformat",
            "avcodec",
            "swresample",
            "avutil",
        ] {
            println!("cargo:rustc-link-lib=static={name}");
        }
    }
    for path in [
        "src/core",
        "tools/desktop-parser.ts",
        "tools/resource_refs.ts",
        "tools/build-native-parser.mjs",
        "tools/web-library.js",
        "package-lock.json",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("script-parser.js");
    let status = Command::new("node")
        .current_dir(&root)
        .arg(root.join("tools/build-native-parser.mjs"))
        .arg(&output)
        .status()
        .expect("Node.js is required to bundle the shared story parser when building ArkReader");
    assert!(status.success(), "Shared story parser bundling failed");
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .canonicalize()
        .unwrap();
    let mut inputs = Vec::new();
    for directory in ["src", "assets"] {
        let path = manifest.join(directory);
        println!("cargo:rerun-if-changed={}", path.display());
        files(&path, &mut inputs);
    }
    inputs.push(root.join("src-tauri/Cargo.lock"));
    inputs.sort();
    let mut digest = Sha256::new();
    for path in inputs {
        digest.update(
            path.strip_prefix(&root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/")
                .as_bytes(),
        );
        digest.update(fs::read(path).unwrap());
    }
    digest.update(fs::read(output).unwrap());
    println!(
        "cargo:rerun-if-changed={}",
        root.join("src-tauri/Cargo.lock").display()
    );
    println!(
        "cargo:rustc-env=ARKREADER_DECODER_REVISION={:x}",
        digest.finalize()
    );
}
