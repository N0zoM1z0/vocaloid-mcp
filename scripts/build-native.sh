#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$repo_dir/build/native"
mkdir -p "$build_dir"

i686-w64-mingw32-gcc \
  -std=c11 \
  -O2 \
  -Wall \
  -Wextra \
  -Werror \
  -municode \
  -static \
  "$repo_dir/native/vsq_probe.c" \
  -o "$build_dir/vsq_probe.exe"

i686-w64-mingw32-gcc \
  -std=c11 \
  -O2 \
  -Wall \
  -Wextra \
  -Werror \
  -municode \
  -static \
  "$repo_dir/native/vocaloid_export.c" \
  -o "$build_dir/vocaloid_export.exe"

file "$build_dir/vsq_probe.exe"
file "$build_dir/vocaloid_export.exe"
