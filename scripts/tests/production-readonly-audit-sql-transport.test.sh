#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-readonly-audit-sql.XXXXXX")"
readonly CAPTURE_FILE="$TEST_ROOT/psql-stdin"
trap 'rm -rf "$TEST_ROOT"' EXIT

# Replace only the transport boundary. The payload below is the exact stdin
# that the real helper would pass to psql.
docker() {
  local payload
  [[ "$1" == 'exec' && "$*" == *'psql'* ]] || return 1
  payload="$(< /dev/stdin)"
  printf '%s\n' "$payload" >> "$CAPTURE_FILE"
  if [[ "$payload" == *'information_schema.columns'* ]]; then
    printf 'YES\n'
  elif [[ "$payload" == *'FROM "Tenant"'* ]]; then
    printf '2|3\n'
  elif [[ "$payload" == *'string_agg(bucket'* ]]; then
    printf 'buildingos-production:1\n'
  elif [[ "$payload" == *'TARGET_MIGRATION'* ]]; then
    printf 'APPLIED\n'
  else
    printf '1\n'
  fi
}

source "$AUDITOR"

readonly_query_stdin >/dev/null <<'SQL'
BEGIN READ ONLY;
SELECT CASE WHEN count(*) = 6 THEN 'YES' ELSE 'NO' END
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'Payment';
SELECT 'READY' || 'PENDING' || 'FAILED';
SELECT 'SUBMITTED' || 'APPROVED' || 'RECONCILED' || 'RECEIPT_GENERATED';
COMMIT;
SQL

report_migrations_and_schema >/dev/null
report_finance_counts >/dev/null
report_tenant_classification >/dev/null
report_storage_database_buckets >/dev/null

received="$(< "$CAPTURE_FILE")"
for literal in "'YES'" "'NO'" "'public'" "'Payment'" "'READY'" "'PENDING'" "'FAILED'" "'SUBMITTED'" "'APPROVED'" "'RECONCILED'" "'RECEIPT_GENERATED'"; do
  [[ "$received" == *"$literal"* ]] || {
    printf 'FAIL: mocked psql stdin lost SQL literal %s\n' "$literal" >&2
    exit 1
  }
done
[[ "$received" == BEGIN\ READ\ ONLY\;*COMMIT\;* ]]

AUDIT_QUERY_FAILURES=0
AUDIT_INTERNAL_FAILURES=0
set +e
invalid_output="$(report_query_stdin INVALID_QUERY <<'SQL' 2>&1
SELECT 1;
SQL
)"
invalid_rc=$?
set -e
[[ "$invalid_rc" -eq 0 ]]
[[ "$invalid_output" == *'INVALID_QUERY=UNKNOWN'* ]]
[[ "$invalid_output" == *'SQL payload is missing BEGIN READ ONLY or COMMIT'* ]]
[[ "$AUDIT_QUERY_FAILURES" -eq 0 ]]
[[ "$AUDIT_INTERNAL_FAILURES" -eq 1 ]]
printf 'PASS: SQL literals reach mocked psql stdin unchanged\n'
