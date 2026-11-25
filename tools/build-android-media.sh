#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version=9.0.2
checksum=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
ndk="${NDK_HOME:-${ANDROID_NDK_HOME:-}}"
test -n "$ndk" || { echo 'Set NDK_HOME to an Android NDK installation.' >&2; exit 1; }
host=linux-x86_64
toolchain="$ndk/toolchains/llvm/prebuilt/$host"
test -d "$toolchain" || { echo 'Build the Android media component on Linux.' >&2; exit 1; }
cache="$root/artifacts/android-media"
mkdir -p "$cache/source"
archive="$cache/ffmpeg-$version.tar.xz"
if ! test -f "$archive"; then curl --fail --location --retry 3 "https://ffmpeg.org/releases/ffmpeg-$version.tar.xz" -o "$archive"; fi
echo "$checksum  $archive" | sha256sum --check
source_dir="$cache/source/ffmpeg-$version"
if ! test -f "$source_dir/configure"; then tar -xf "$archive" -C "$cache/source"; fi
for abi in "${@:-arm64-v8a}"; do
  case "$abi" in
    arm64-v8a) arch=aarch64; triple=aarch64-linux-android ;;
    x86_64) arch=x86_64; triple=x86_64-linux-android ;;
    *) echo "Unsupported Android ABI: $abi" >&2; exit 1 ;;
  esac
  build="$cache/$version-$abi"
  mkdir -p "$build"
  cd "$build"
  "$source_dir/configure" \
    --target-os=android --arch="$arch" --enable-cross-compile \
    --cc="$toolchain/bin/${triple}24-clang" \
    --cxx="$toolchain/bin/${triple}24-clang++" \
    --ar="$toolchain/bin/llvm-ar" --ranlib="$toolchain/bin/llvm-ranlib" \
    --nm="$toolchain/bin/llvm-nm" \
    --strip="$toolchain/bin/llvm-strip" --sysroot="$toolchain/sysroot" \
    --disable-everything --disable-autodetect --disable-doc --disable-debug \
    --disable-network --disable-shared --enable-static --enable-pic --disable-asm \
    --disable-ffplay --disable-ffprobe --enable-ffmpeg \
    --disable-avdevice --disable-swscale \
    --enable-avcodec --enable-avformat --enable-avfilter --enable-swresample \
    --enable-protocol=file,pipe --enable-demuxer=ivf,adx,mov --enable-muxer=mp4 \
    --enable-decoder=adpcm_adx,vp9 --enable-encoder=flac --enable-parser=vp9 \
    --enable-bsf=vp9_superframe,extract_extradata \
    --enable-filter=aresample,aformat,anull,abuffer,abuffersink,null,buffer,buffersink \
    --extra-cflags='-O2 -fPIE' --extra-ldflags='-pie -Wl,-z,max-page-size=16384'
  make -j"$(nproc)" ffmpeg
  destination="$root/src-tauri/gen/android/app/src/main/jniLibs/$abi"
  mkdir -p "$destination"
  cp ffmpeg "$destination/libarkreader_ffmpeg.so"
  "$toolchain/bin/llvm-strip" --strip-unneeded "$destination/libarkreader_ffmpeg.so"
done
notices="$root/src-tauri/gen/android/app/src/main/assets/licenses"
mkdir -p "$notices"
cp "$source_dir/COPYING.LGPLv2.1" "$notices/FFmpeg-LICENSE.txt"
printf 'FFmpeg %s\nSource: https://ffmpeg.org/releases/ffmpeg-%s.tar.xz\nSHA-256: %s\nBuild configuration: tools/build-android-media.sh\n' "$version" "$version" "$checksum" > "$notices/FFmpeg-SOURCE.txt"
