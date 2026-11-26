#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
for abi in "${@:-arm64-v8a}"; do
  bash "$root/tools/build-media.sh" "android-$abi"
done
