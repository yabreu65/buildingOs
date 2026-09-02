#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"
readonly REQUIRED='awk bash cat curl date docker git jq sha256sum stat'
readonly OPTIONAL_WITH_FALLBACK='pg_restore'
readonly OPTIONAL_OBSERVATION='node psql'
readonly NOT_USED='find sed grep cut tr wc mktemp sort head tail shasum'

auditor_text="$(< "$AUDITOR")"
[[ "$auditor_text" == *'for command_name in awk bash cat curl date docker git jq sha256sum stat'* ]]
[[ "$auditor_text" == *'command -v pg_restore'* ]]
[[ "$auditor_text" == *'docker exec -i "$POSTGRES_CONTAINER" pg_restore --list'* ]]
[[ "$auditor_text" == *'docker exec -i "$API_CONTAINER" node'* ]]
[[ "$auditor_text" == *'S3_DEEP_AUDIT_UNAVAILABLE'* ]]

for command_name in $REQUIRED; do
  [[ "$command_name" != 'pg_restore' ]] || { printf 'FAIL: fallback dependency classified as required\n' >&2; exit 1; }
done
[[ "$OPTIONAL_WITH_FALLBACK" == 'pg_restore' ]]
[[ "$OPTIONAL_OBSERVATION" == 'node psql' ]]
[[ "$NOT_USED" == *'sed'* && "$NOT_USED" == *'shasum'* ]]

printf 'PASS: auditor dependency matrix is explicit (required=%s; fallback=%s; observation=%s; not-used=%s)\n' \
  "$REQUIRED" "$OPTIONAL_WITH_FALLBACK" "$OPTIONAL_OBSERVATION" "$NOT_USED"
