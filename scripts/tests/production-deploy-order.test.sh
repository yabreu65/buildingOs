#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy-production.sh"
readonly ROLLBACK_SCRIPT="$ROOT_DIR/scripts/rollback-production.sh"

line_number() { awk -v pattern="$1" 'index($0, pattern) { print NR; exit }' "$2"; }
post_line="$(line_number 'verify-production-migration-manifest.sh verify-db post' "$DEPLOY_SCRIPT")"
compatibility_line="$(line_number 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$DEPLOY_SCRIPT")"
receipt_line="$(line_number 'generate_rollback_compatibility_receipt' "$DEPLOY_SCRIPT")"
recreate_line="$(line_number 'up --detach --no-deps --force-recreate buildingos-api buildingos-web' "$DEPLOY_SCRIPT")"
[[ -n "$post_line" && -n "$compatibility_line" && -n "$receipt_line" && -n "$recreate_line" ]]
(( post_line < compatibility_line && compatibility_line < receipt_line && receipt_line < recreate_line ))
grep -F 'validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db' "$ROLLBACK_SCRIPT" >/dev/null
if grep -F 'incompatible_rows=' "$ROLLBACK_SCRIPT" >/dev/null; then exit 1; fi
printf 'PASS: migration -> post verification -> compatibility -> receipt -> application recreation\n'
