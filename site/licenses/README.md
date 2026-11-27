# Third-party notices

ArkReader uses [Tauri](https://github.com/tauri-apps/tauri) (MIT/Apache-2.0), [unity-rs-core](https://github.com/seiunx-dev/unity-rs) (MIT), and [rquickjs](https://github.com/DelSkayn/rquickjs) (MIT) with QuickJS (MIT). Dependency versions are recorded in Cargo.lock and package-lock.json. Included dependency notices are in this directory.

The Arknights UnityFS block decoder in `src-tauri/crates/resource-engine/src/unity_bundle.rs` is derived from [Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker)'s compatibility algorithm. Copyright (c) 2022–2026 Harry Huang, BSD-3-Clause. [Full license](Ark-Unpacker.txt). Upstream credits Kengxxiao and MooncellWiki/UnityPy.

Desktop and Android packages compile a minimal FFmpeg executable from the same official release source using `tools/build-media.sh`. Each package includes the corresponding license, source URL and build configuration. FFmpeg runs as a separate media conversion executable. No Python interpreter is included.

The static web package links a minimal LGPL FFmpeg build into its WebAssembly resource engine. It uses the same FFmpeg source and media formats as the native packages. Its corresponding license, source URL and build configuration are included in the web package. `tools/build-media.sh web` and `tools/build-web.mjs` rebuild and relink the component from source.

Spine 3.8 runtime code in `src/vendor/spine38/` retains the [Spine Runtimes License Agreement](Spine-Runtimes.txt), including its editor-license conditions.

Game resources belong to their respective rights holders and are not included in distributions. No original project open-source license is granted by this release.
