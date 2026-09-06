#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
readonly TRUSTED_VERIFIER="$SCRIPT_DIR/verify-production-migration-manifest.sh"

fail() {
  printf 'ERROR: target migration contract validation failed: %s\n' "$1" >&2
  exit 1
}

[[ "$#" -eq 1 ]] || fail 'usage: <target-tree>'
target_tree="$1"
[[ -d "$target_tree" && ! -L "$target_tree" ]] || fail 'target tree is not a regular directory'
[[ -f "$TRUSTED_VERIFIER" && ! -L "$TRUSTED_VERIFIER" ]] || fail 'trusted verifier is missing or invalid'

manifest_file="$target_tree/scripts/manifests/production-migrations-81-to-99.tsv"
migrations_dir="$target_tree/apps/api/prisma/migrations"
[[ -f "$manifest_file" && ! -L "$manifest_file" ]] || fail 'target 81-to-99 manifest is missing or invalid'
[[ -d "$migrations_dir" && ! -L "$migrations_dir" ]] || fail 'target migrations directory is missing or invalid'

MANIFEST_FILE="$manifest_file" MIGRATIONS_DIR="$migrations_dir" \
  bash "$TRUSTED_VERIFIER" verify-files
