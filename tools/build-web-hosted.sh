#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Linux static hosts need only Node and standard build tools preinstalled.
for tool in node curl git python3 make cc tar; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done
export RUSTUP_TOOLCHAIN=1.100.0
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
export ARKREADER_BUILD_JOBS="${ARKREADER_BUILD_JOBS:-2}"
cache="$PWD/.cache/web-build"
mkdir -p "$cache"
if ! command -v rustup >/dev/null; then
  export CARGO_HOME="$cache/cargo" RUSTUP_HOME="$cache/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
  if ! command -v rustup >/dev/null; then
    curl --fail --location --retry 3 https://sh.rustup.rs -o "$cache/rustup-init.sh"
    sh "$cache/rustup-init.sh" -y --no-modify-path --profile minimal --default-toolchain "$RUSTUP_TOOLCHAIN"
  fi
fi
rustup toolchain install "$RUSTUP_TOOLCHAIN" --profile minimal --target wasm32-unknown-emscripten

export EMSDK="${EMSDK:-$cache/emsdk}"
export EM_CONFIG="$EMSDK/.emscripten"
export EMSDK_USE_CURL=1
sdk_commit=a7c808831a666cc903fedb906c171a718cd97341
if ! test -f "$EMSDK/emsdk"; then
  git init "$EMSDK"
  git -C "$EMSDK" remote add origin https://github.com/emscripten-core/emsdk.git
  git -C "$EMSDK" fetch --depth 1 origin "$sdk_commit"
  git -C "$EMSDK" checkout --detach FETCH_HEAD
fi
test "$(git -C "$EMSDK" rev-parse HEAD)" = "$sdk_commit" || { echo 'Unexpected Emscripten SDK checkout' >&2; exit 1; }
"$EMSDK/emsdk" install 7.0.1
"$EMSDK/emsdk" activate 7.0.1 --embedded
export PATH="$EMSDK/upstream/emscripten:$PATH"
npm run web:build
