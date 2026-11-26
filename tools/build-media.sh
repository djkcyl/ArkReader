#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:?Specify windows-x64, linux-x64, macos-arm64 or android-ABI}"
if test "$target" = windows-x64; then root="$(cygpath -u "$root")"; fi
version=9.0.2
checksum=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
cache="$root/artifacts/media-build"
mkdir -p "$cache"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
download() {
  local url="$1" file="$2" expected="$3"
  if ! test -f "$file" || test "$(sha256 "$file" | cut -d ' ' -f 1)" != "$expected"; then
    curl --fail --location --retry 3 "$url" -o "$file.part"
    test "$(sha256 "$file.part" | cut -d ' ' -f 1)" = "$expected" || { echo "Source checksum mismatch: $url" >&2; exit 1; }
    mv "$file.part" "$file"
  fi
}

options=(
  --disable-everything --disable-autodetect --disable-doc --disable-debug
  --disable-network --disable-shared --enable-static --enable-pic --disable-asm
  --disable-ffplay --disable-ffprobe --enable-ffmpeg
  --disable-avdevice --disable-swscale
  --enable-avcodec --enable-avformat --enable-avfilter --enable-swresample
  --enable-protocol=file,pipe --enable-demuxer=ivf,adx,mov --enable-muxer=mp4
  --enable-decoder=adpcm_adx,vp9 --enable-encoder=flac --enable-parser=vp9
  --enable-bsf=vp9_superframe,extract_extradata
  --enable-filter=aresample,aformat,anull,abuffer,abuffersink,null,buffer,buffersink
)
executable=ffmpeg
compiler=cc
strip_tool=strip
destination="$root/src-tauri/resources/native"
notices="$destination"
case "$target" in
  windows-x64)
    export PATH="/ucrt64/bin:/usr/bin:$PATH"
    compiler=gcc
    test "$(gcc -dumpmachine)" = x86_64-w64-mingw32 || { echo 'Use MSYS2 UCRT64 GCC.' >&2; exit 1; }
    options+=(--target-os=mingw32 --arch=x86_64 --cc=gcc --extra-ldflags=-static)
    executable=ffmpeg.exe
    ;;
  linux-x64)
    test "$(uname -s)/$(uname -m)" = Linux/x86_64
    options+=(--arch=x86_64)
    ;;
  macos-arm64)
    test "$(uname -s)/$(uname -m)" = Darwin/arm64
    export MACOSX_DEPLOYMENT_TARGET=12.0
    options+=(--arch=aarch64)
    ;;
  android-arm64-v8a|android-x86_64)
    abi="${target#android-}"
    ndk="${NDK_HOME:-${ANDROID_NDK_HOME:-}}"
    test -n "$ndk" || { echo 'Set NDK_HOME to an Android NDK installation.' >&2; exit 1; }
    toolchain="$ndk/toolchains/llvm/prebuilt/linux-x86_64"
    test -d "$toolchain" || { echo 'Build the Android media component on Linux.' >&2; exit 1; }
    if test "$abi" = arm64-v8a; then arch=aarch64; triple=aarch64-linux-android; else arch=x86_64; triple=x86_64-linux-android; fi
    compiler="$toolchain/bin/${triple}24-clang"
    strip_tool="$toolchain/bin/llvm-strip"
    options+=(
      --target-os=android --arch="$arch" --enable-cross-compile --cc="$compiler"
      --cxx="$toolchain/bin/${triple}24-clang++" --ar="$toolchain/bin/llvm-ar"
      --ranlib="$toolchain/bin/llvm-ranlib" --nm="$toolchain/bin/llvm-nm"
      --strip="$strip_tool" --sysroot="$toolchain/sysroot"
      --extra-cflags='-O2 -fPIE' --extra-ldflags='-pie -Wl,-z,max-page-size=16384'
    )
    destination="$root/src-tauri/gen/android/app/src/main/jniLibs/$abi"
    notices="$root/src-tauri/gen/android/app/src/main/assets/licenses"
    executable=libarkreader_ffmpeg.so
    ;;
  *) echo "Unsupported media target: $target" >&2; exit 1 ;;
esac

# Source/configuration/compiler changes select a fresh build, never an old binary.
key="$({ sha256 "$0"; printf '%s\n' "$target" "${options[@]}"; "$compiler" --version; } | sha256 | cut -d ' ' -f 1)"
build="$cache/$target-$key"
mkdir -p "$build" "$destination" "$notices"
if test -f "$build/complete.sha256" && test -f "$build/$executable" && test "$(sha256 "$build/$executable" | cut -d ' ' -f 1)" = "$(cat "$build/complete.sha256")"; then
  cp "$build/$executable" "$destination/$executable"
  cp "$build/FFmpeg-LICENSE.txt" "$build/FFmpeg-SOURCE.txt" "$notices/"
  echo "Reused verified media component for $target"
  exit 0
fi

url="https://ffmpeg.org/releases/ffmpeg-$version.tar.xz"
archive="$cache/ffmpeg-$version.tar.xz"
download "$url" "$archive" "$checksum"
source_dir="$cache/source/$checksum/ffmpeg-$version"
if ! test -f "$source_dir/configure"; then
  mkdir -p "$cache/source/$checksum"
  tar -xf "$archive" -C "$cache/source/$checksum"
fi
jobs="${ARKREADER_BUILD_JOBS:-}"
if test -z "$jobs"; then
  if test "$target" = macos-arm64; then jobs="$(sysctl -n hw.ncpu)"; else jobs="$(getconf _NPROCESSORS_ONLN)"; fi
fi
cd "$build"
"$source_dir/configure" "${options[@]}"
binary=ffmpeg
test "$target" != windows-x64 || binary=ffmpeg.exe
make -r -j"$jobs" "$binary"
if test "$target" = macos-arm64; then "$strip_tool" -x "$binary"; else "$strip_tool" --strip-unneeded "$binary"; fi
test "$binary" = "$executable" || cp "$binary" "$executable"
cp "$source_dir/COPYING.LGPLv2.1" FFmpeg-LICENSE.txt
{
  printf 'FFmpeg %s\nSource: %s\nSHA-256: %s\nTarget: %s\nBuild: tools/build-media.sh\nConfiguration:' "$version" "$url" "$checksum" "$target"
  printf ' %q' "${options[@]}"
  printf '\n'
} > FFmpeg-SOURCE.txt
sha256 "$executable" | cut -d ' ' -f 1 > complete.sha256
cp "$executable" "$destination/$executable"
cp FFmpeg-LICENSE.txt FFmpeg-SOURCE.txt "$notices/"
echo "Prepared minimal media component for $target"
