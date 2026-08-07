#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output="${1:-$project_root/llm-context.zip}"

if ! command -v zip >/dev/null 2>&1; then
  echo "Error: 'zip' is required but was not found." >&2
  exit 1
fi

cd "$project_root"

files=()
while IFS= read -r -d '' file; do
  files+=("$file")
done < <(
  find . -mindepth 1 \
    \( \
      -name '.*' -o \
      -path './bundles/private' -o \
      -path './packages/rules/src/generated' -o \
      -type d \( \
        -name node_modules -o \
        -name dist -o \
        -name build -o \
        -name coverage -o \
        -name cache -o \
        -name caches -o \
        -name tmp -o \
        -name temp -o \
        -name out -o \
        -name target \
      \) \
    \) -prune -o \
    -type f \
      ! -name '*.zip' \
      ! -name '*.tsbuildinfo' \
      ! -name '*.map' \
      ! -name '*.min.js' \
      ! -name '*.min.css' \
      ! -name '*.pdf' \
      ! -name '*.png' \
      ! -name '*.jpg' \
      ! -name '*.jpeg' \
      ! -name '*.gif' \
      ! -name '*.webp' \
      ! -name '*.ico' \
      ! -name '*.woff' \
      ! -name '*.woff2' \
      ! -name '*.ttf' \
      ! -name '*.mp3' \
      ! -name '*.mp4' \
      ! -name '*.mov' \
      ! -name '*.wasm' \
      -print0
)

if ((${#files[@]} == 0)); then
  echo "Error: no context files found." >&2
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/llm-context.XXXXXX")"
tmp_output="$tmp_dir/context.zip"
trap 'rm -rf "$tmp_dir"' EXIT

zip -q "$tmp_output" "${files[@]}"
mkdir -p "$(dirname "$output")"
mv "$tmp_output" "$output"
rm -rf "$tmp_dir"
trap - EXIT

echo "Created $output with ${#files[@]} files."
