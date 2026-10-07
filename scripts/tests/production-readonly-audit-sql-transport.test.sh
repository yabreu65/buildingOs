#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-readonly-audit-sql.XXXXXX")"
readonly CAPTURE_FILE="$TEST_ROOT/psql-stdin"
readonly DOCKER_CALLS_FILE="$TEST_ROOT/docker-calls"
: > "$DOCKER_CALLS_FILE"
trap 'rm -rf "$TEST_ROOT"' EXIT

# Replace only the transport boundary. The payload below is the exact stdin
# that the real helper would pass to psql.
docker() {
  printf 'call\n' >> "$DOCKER_CALLS_FILE"
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

docker_call_count() {
  wc -l < "$DOCKER_CALLS_FILE" | tr -d '[:space:]'
}

source "$AUDITOR"

readonly_query_stdin >/dev/null <<'SQL'
BEGIN READ ONLY;
SELECT CASE WHEN count(*) = 6 THEN 'YES' ELSE 'NO' END
       || 'READY' || 'PENDING' || 'FAILED'
       || 'SUBMITTED' || 'APPROVED' || 'RECONCILED' || 'RECEIPT_GENERATED'
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'Payment'
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
printf 'PASS: SQL literals reach mocked psql stdin unchanged\n'

docker_calls_before_rejected_query="$(docker_call_count)"
if readonly_query_stdin >/dev/null <<'SQL'
SELECT 'missing read-only boundary';
COMMIT;
SQL
then
  printf 'FAIL: query missing BEGIN READ ONLY was accepted\n' >&2
  exit 1
fi
[[ "$(docker_call_count)" -eq "$docker_calls_before_rejected_query" ]] || {
  printf 'FAIL: query missing BEGIN READ ONLY reached Docker\n' >&2
  exit 1
}
printf 'PASS: query missing BEGIN READ ONLY is rejected before Docker\n'

if readonly_query_stdin >/dev/null <<'SQL'
BEGIN READ ONLY;
SELECT 'missing commit';
SQL
then
  printf 'FAIL: query missing COMMIT was accepted\n' >&2
  exit 1
fi
[[ "$(docker_call_count)" -eq "$docker_calls_before_rejected_query" ]] || {
  printf 'FAIL: query missing COMMIT reached Docker\n' >&2
  exit 1
}
printf 'PASS: query missing COMMIT is rejected before Docker\n'

assert_rejected_before_docker() {
  local label="$1"
  local payload="$2"
  local calls_before
  calls_before="$(docker_call_count)"

  if printf '%s' "$payload" | readonly_query_stdin >/dev/null; then
    printf 'FAIL: %s was accepted\n' "$label" >&2
    exit 1
  fi
  [[ "$(docker_call_count)" -eq "$calls_before" ]] || {
    printf 'FAIL: %s reached Docker\n' "$label" >&2
    exit 1
  }
  printf 'PASS: %s is rejected before Docker\n' "$label"
}

assert_rejected_before_docker 'comment-prefix transaction spoof' $'-- BEGIN READ ONLY;\nSELECT \'spoofed\';\nCOMMIT;\n'
assert_rejected_before_docker 'literal-only transaction spoof' $'SELECT \'BEGIN READ ONLY; COMMIT;\';\n'
assert_rejected_before_docker 'internal ROLLBACK statement' $'BEGIN READ ONLY;\nSELECT 1;\nROLLBACK;\nCOMMIT;\n'
assert_rejected_before_docker 'internal COMMIT statement' $'BEGIN READ ONLY;\nSELECT 1;\nCOMMIT;\nCOMMIT;\n'
assert_rejected_before_docker 'multiple SELECT statements' $'BEGIN READ ONLY;\nSELECT 1;\nSELECT 2;\nCOMMIT;\n'
assert_rejected_before_docker 'block-comment transaction spoof' $'/* BEGIN READ ONLY; */\nSELECT 1;\n/* COMMIT; */\n'
assert_rejected_before_docker 'trailing SQL statement' $'BEGIN READ ONLY;\nSELECT 1;\nCOMMIT;\nSELECT 2;\n'
assert_rejected_before_docker 'trailing SQL comment' $'BEGIN READ ONLY;\nSELECT 1;\nCOMMIT;\n-- trailing comment\n'

docker_calls_before_e_string="$(docker_call_count)"
if ! readonly_query_stdin >/dev/null <<'SQL'
BEGIN READ ONLY;
SELECT E'\\t';
COMMIT;
SQL
then
  printf 'FAIL: generated E-string query was rejected\n' >&2
  exit 1
fi
[[ "$(docker_call_count)" -eq $((docker_calls_before_e_string + 1)) ]] || {
  printf 'FAIL: generated E-string query did not reach Docker\n' >&2
  exit 1
}
[[ "$(< "$CAPTURE_FILE")" == *"SELECT E'\\\\t';"* ]] || {
  printf 'FAIL: E-string query was not forwarded unchanged\n' >&2
  exit 1
}
printf 'PASS: generated E-string query is forwarded unchanged\n'
