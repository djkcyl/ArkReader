# Third-party notices

ArkReader uses [Tauri](https://github.com/tauri-apps/tauri) (MIT/Apache-2.0), [unity-rs-core](https://github.com/seiunx-dev/unity-rs) (MIT), and [rquickjs](https://github.com/DelSkayn/rquickjs) (MIT) with QuickJS (MIT). Dependency versions are recorded in Cargo.lock and package-lock.json. Included dependency notices are in this directory.

The Arknights UnityFS block decoder in `src-tauri/crates/resource-engine/src/unity_bundle.rs` is derived from [Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker)'s compatibility algorithm. Copyright (c) 2022–2026 Harry Huang, BSD-3-Clause. [Full license](Ark-Unpacker.txt). Upstream credits Kengxxiao and MooncellWiki/UnityPy.

Desktop packages include only the native FFmpeg executable from [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg). Android builds compile FFmpeg from the official release source. Each package includes the corresponding FFmpeg license, source URL and build configuration. FFmpeg runs as a separate media conversion executable. No Python interpreter is included.

Spine 3.8 runtime code in `src/vendor/spine38/` retains the [Spine Runtimes License Agreement](Spine-Runtimes.txt), including its editor-license conditions.

Game resources belong to their respective rights holders and are not included in distributions. No original project open-source license is granted by this private release.
