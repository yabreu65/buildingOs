#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"

run_healthy() {
  source "$AUDITOR"
  container_exists() { return 0; }
  container_state() { printf 'running'; }
  container_health() { printf 'healthy'; }
  AUDIT_EVIDENCE_FAILURES=0
  output_file="$(mktemp "${TMPDIR:-/tmp}/buildingos-readonly-audit-simulator.XXXXXX")"
  report_container_health API buildingos-api > "$output_file"
  output="$(< "$output_file")"
  rm -f "$output_file"
  [[ "$output" == *'API_CONTAINER_STATE=running'* ]]
  [[ "$output" == *'API_CONTAINER_HEALTH=healthy'* ]]
  [[ "$AUDIT_EVIDENCE_FAILURES" -eq 0 ]]
}

run_readyz_degraded() {
  source "$AUDITOR"
  API_READYZ_URL='https://example.invalid/readyz'
  curl() {
    printf '%s' '{"status":"degraded","database":{"status":"up"},"storage":{"status":"up"},"email":{"status":"down"}}'
  }
  AUDIT_EVIDENCE_FAILURES=0
  output_file="$(mktemp "${TMPDIR:-/tmp}/buildingos-readonly-audit-simulator.XXXXXX")"
  public_readyz_status > "$output_file"
  output="$(< "$output_file")"
  rm -f "$output_file"
  [[ "$output" == *'PUBLIC_READYZ_STATUS=DEGRADED'* ]]
  [[ "$AUDIT_EVIDENCE_FAILURES" -eq 1 ]]
}

run_s3_incomplete() {
  source "$AUDITOR"
  safe_env_value() { printf 'buildingos-production'; }
  s3_client_available() { return 0; }
  s3_probe() {
    case "$1" in
      head) return 0 ;;
      versioning) printf 'Suspended' ;;
      objects) printf '3' ;;
    esac
  }
  AUDIT_EVIDENCE_FAILURES=0
  output_file="$(mktemp "${TMPDIR:-/tmp}/buildingos-readonly-audit-simulator.XXXXXX")"
  report_s3_posture > "$output_file"
  output="$(< "$output_file")"
  rm -f "$output_file"
  [[ "$output" == *'S3_VERSIONING_STATUS=Suspended'* ]]
  [[ "$output" == *'S3_DEEP_AUDIT=INCOMPLETE'* ]]
  [[ "$AUDIT_EVIDENCE_FAILURES" -eq 1 ]]
}

run_db_failure() {
  source "$AUDITOR"
  docker() { return 1; }
  AUDIT_QUERY_FAILURES=0
  output_file="$(mktemp "${TMPDIR:-/tmp}/buildingos-readonly-audit-simulator.XXXXXX")"
  report_query_stdin ACTIVE_FINISHED_MIGRATIONS <<'SQL' > "$output_file"
BEGIN READ ONLY;
SELECT count(*) FROM "_prisma_migrations";
COMMIT;
SQL
  output="$(< "$output_file")"
  rm -f "$output_file"
  [[ "$output" == 'ACTIVE_FINISHED_MIGRATIONS=UNKNOWN' ]]
  [[ "$AUDIT_ACTIVE_FINISHED_MIGRATIONS" == UNKNOWN ]]
  [[ "$AUDIT_QUERY_FAILURES" -eq 1 ]]
}

run_db_migration_count_capture() {
  # shellcheck disable=SC1090 # AUDITOR is an exact test fixture path selected at runtime.
  source "$AUDITOR"
  # shellcheck disable=SC2329 # report_query_stdin invokes this callback indirectly.
  readonly_query_stdin() {
    local query
    query="$(< /dev/stdin)"
    [[ "$query" == *'BEGIN READ ONLY;'* && "$query" == *'COMMIT;'* ]]
    case "$query" in
      *'finished_at IS NOT NULL'*) printf '107' ;;
      *'finished_at IS NULL'*) printf '0' ;;
      *) return 1 ;;
    esac
  }
  report_query_stdin ACTIVE_FINISHED_MIGRATIONS <<'SQL' >/dev/null
BEGIN READ ONLY;
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
COMMIT;
SQL
  report_query_stdin FAILED_MIGRATIONS <<'SQL' >/dev/null
BEGIN READ ONLY;
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL;
COMMIT;
SQL
  [[ "$AUDIT_ACTIVE_FINISHED_MIGRATIONS" == 107 ]]
  [[ "$AUDIT_FAILED_MIGRATIONS" == 0 ]]
}

assert_runtime_identity_field() {
  local case_name="$1" field="$2" expected="$3" actual_output="$4"
  if [[ "$actual_output" == *"$field=$expected"* ]]; then
    return 0
  fi

  printf 'FAIL: runtime identity case %s expected %s=%s; actual report:\n%s\n' \
    "$case_name" "$field" "$expected" "$actual_output" >&2
  return 1
}

run_runtime_identity_case() {
  local case_name="$1" checkout_sha="$2" api_sha="$3" web_sha="$4" expected_identity="$5" expected_app_sha="$6"
  local history_count="${7-107}" active_count="${8-107}" failed_count="${9-0}" migration_case="${10-valid}"
  local runtime_tree_count="${11-97}"
  local fixture_auditor output_file output failures=0 expected_evidence_failures field expected field_value
  local deployments_root selector record api_image_id web_image_id migration_rows='' migration_name migration_hash i migration_query_seen_file first_migration second_migration
  fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-readonly-audit-checkout.XXXXXX")"
  fixture_root="$(cd -P -- "$fixture_root" && pwd -P)"
  trap 'rm -rf -- "$fixture_root"' EXIT
  mkdir -m 700 "$fixture_root/.git" "$fixture_root/deployments"
  printf '**/.env\n' > "$fixture_root/.dockerignore"
  chmod 600 "$fixture_root/.dockerignore"
  deployments_root="$fixture_root/deployments"
  selector="$deployments_root/current-successful-deployment.v1"
  record="$deployments_root/rollback-$api_sha.txt"
  api_image_id='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  web_image_id='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  if [[ "$checkout_sha" != "$api_sha" && "$api_sha" == "$web_sha" && "$case_name" != unproven-split ]]; then
    printf 'status=SUCCESS\ntarget_sha=%s\nfrom_sha=%s\nmigration_count=%s\napi_digest=%s\nweb_digest=%s\n' \
      "$api_sha" "$checkout_sha" "$history_count" "$api_image_id" "$web_image_id" > "$record"
    chmod 600 "$record"
    printf 'format=buildingos-current-successful-deployment/v1\nrecord_path=%s\ntarget_sha=%s\n' \
      "$record" "$api_sha" > "$selector"
    chmod 600 "$selector"
  fi
  fixture_auditor="$fixture_root/auditor.sh"
  output_file="$fixture_root/output"
  sed "s|^readonly APP_DIR=.*|readonly APP_DIR='$fixture_root'|" "$AUDITOR" > "$fixture_auditor"
  source "$fixture_auditor"
  git() {
    case "$*" in
      *'rev-parse HEAD') printf '%s' "$checkout_sha" ;;
      *'status --porcelain'*) ;;
      *'ls-files --others --ignored'*) ;;
      *'ls-tree -r --name-only'*)
        [[ "$*" == *"ls-tree -r --name-only $api_sha --"* ]] || return 1
        [[ "$migration_case" == missing-tree ]] && return 1
        for i in $(seq 1 "$runtime_tree_count"); do printf 'apps/api/prisma/migrations/migration_%03d/migration.sql\n' "$i"; done
        ;;
      *'show '*':apps/api/prisma/migrations/'*)
        [[ "$*" == *"show $api_sha:apps/api/prisma/migrations/"* ]] || return 1
        migration_name="${*: -1}"
        migration_name="${migration_name#*:}"
        printf 'contents for %s\n' "$migration_name"
        ;;
      *) return 1 ;;
    esac
  }
  while IFS='|' read -r migration_name migration_hash; do
    [[ -n "$first_migration" ]] || first_migration="$migration_name"
    if [[ -n "$first_migration" && "$migration_name" != "$first_migration" && -z "$second_migration" ]]; then second_migration="$migration_name"; fi
    if [[ "$migration_name" == '20260719000000_add_receipt_sequence' ]]; then
      migration_rows+="$migration_name"$'\t'"$migration_hash"$'\t1\t1\t0\t0\n'
    else
      migration_rows+="$migration_name"$'\t'"$migration_hash"$'\t1\t1\t0\t1\n'
    fi
  done < <(expected_migration_rows)
  migration_query_seen_file="$fixture_root/migration-query-used"
  # shellcheck disable=SC2329 # The sourced runtime verifier invokes this query callback indirectly.
  readonly_query_stdin() {
    local query
    query="$(< /dev/stdin)"
    [[ "$query" == *'BEGIN READ ONLY;'* && "$query" == *'COMMIT;'* ]] || return 64
    [[ "$query" == *'started_at'* && "$query" == *'finished_at'* && "$query" == *'rolled_back_at'* \
      && "$query" == *'checksum'* && "$query" == *'applied_steps_count'* && "$query" == *'"_prisma_migrations"'* ]] || return 1
    printf 'rows-returned\n' > "$migration_query_seen_file"
    case "$migration_case" in
      query-failure) printf 'transport-failure\n' > "$migration_query_seen_file"; return 1 ;;
      unknown) printf 'unknown-payload\n' > "$migration_query_seen_file"; printf 'UNKNOWN\n' ;;
      replacement) printf '%s' "${migration_rows/$first_migration/migration_replaced}" ;;
      checksum)
        migration_hash="$(printf '%064d' 1)"
        printf '%s\t%s\t1\t1\t0\t1\n' "$first_migration" "$migration_hash"
        printf '%s' "${migration_rows#*$'\n'}"
        ;;
      malformed-checksum) printf '%s\tbad\t1\t1\t0\t1\n' "$first_migration"; printf '%s' "${migration_rows#*$'\n'}" ;;
      extra-field|empty-sixth|missing-field)
        migration_hash="${migration_rows#*$'\t'}"
        migration_hash="${migration_hash%%$'\t'*}"
        case "$migration_case" in
          extra-field) printf '%s\t%s\t1\t1\t0\t1\textra\n' "$first_migration" "$migration_hash" ;;
          empty-sixth) printf '%s\t%s\t1\t1\t0\t\n' "$first_migration" "$migration_hash" ;;
          missing-field) printf '%s\t%s\t1\t1\t0\n' "$first_migration" "$migration_hash" ;;
        esac
        printf '%s' "${migration_rows#*$'\n'}"
        ;;
      duplicate-missing) printf '%s' "${migration_rows/$second_migration/$first_migration}" ;;
      invalid-state)
        migration_hash="${migration_rows#*$'\t'}"
        migration_hash="${migration_hash%%$'\t'*}"
        printf '%s\t%s\t0\t1\t0\t1\n' "$first_migration" "$migration_hash"
        printf '%s' "${migration_rows#*$'\n'}"
        ;;
      zero-normal) printf '%s' "${migration_rows/$'\t1\n'/$'\t0\n'}" ;;
      multiple-steps) printf '%s' "${migration_rows/$'\t1\n'/$'\t2\n'}" ;;
      malformed-steps) printf '%s' "${migration_rows/$'\t1\n'/$'\t01x\n'}" ;;
      exception-checksum|exception-multiple-steps)
        local exception_row exception_name exception_hash
        exception_row="$(printf '%s' "$migration_rows" | grep '^20260719000000_add_receipt_sequence')"
        exception_name="${exception_row%%$'\t'*}"
        exception_hash="${exception_row#*$'\t'}"; exception_hash="${exception_hash%%$'\t'*}"
        if [[ "$migration_case" == exception-checksum ]]; then
          printf '%s' "${migration_rows/$exception_name$'\t'$exception_hash/$exception_name$'\t'$(printf '%064d' 2)}"
        else
          local exception_pattern exception_replacement
          exception_pattern="$exception_name"$'\t'"$exception_hash"$'\t1\t1\t0\t0'
          exception_replacement="$exception_name"$'\t'"$exception_hash"$'\t1\t1\t0\t2'
          printf '%s' "${migration_rows/$exception_pattern/$exception_replacement}"
        fi
        ;;
      *) printf '%s' "$migration_rows" ;;
    esac
  }
  container_image_id() {
    case "$1" in
      buildingos-api) printf '%s' "$api_image_id" ;;
      buildingos-web) printf '%s' "$web_image_id" ;;
    esac
  }
  container_revision() {
    case "$1" in
      buildingos-api) printf '%s' "$api_sha" ;;
      buildingos-web) printf '%s' "$web_sha" ;;
    esac
  }
  [[ "$(git -C "$fixture_root" rev-parse HEAD)" == "$checkout_sha" ]]
  [[ "$(git -C "$fixture_root" ls-tree -r --name-only "$api_sha" -- apps/api/prisma/migrations | wc -l | tr -d ' ')" == "$runtime_tree_count" ]]
  [[ "$(container_image_id buildingos-api)" == "$api_image_id" ]]
  [[ "$(container_revision buildingos-api)" == "$api_sha" ]]
  AUDIT_EVIDENCE_FAILURES=0
  if [[ "$case_name" == query-failure ]]; then
    # shellcheck disable=SC2329 # The sourced query path invokes this docker mock indirectly.
    docker() { return 1; }
    report_query_stdin ACTIVE_FINISHED_MIGRATIONS <<'SQL' >/dev/null
BEGIN READ ONLY;
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
COMMIT;
SQL
    active_count="$AUDIT_ACTIVE_FINISHED_MIGRATIONS"
  fi
  AUDIT_ACTIVE_FINISHED_MIGRATIONS="$active_count"
  AUDIT_FAILED_MIGRATIONS="$failed_count"
  CANDIDATE_SHA="$checkout_sha"
  report_runtime_identity "$fixture_root" "$selector" "$deployments_root" > "$output_file"
  output="$(< "$output_file")"
  for field_value in \
    "PRODUCTION_CHECKOUT_SHA=$checkout_sha" \
    "RUNTIME_API_SHA=$api_sha" \
    "RUNTIME_WEB_SHA=$web_sha" \
    "RUNTIME_IDENTITY=$expected_identity" \
    "RUNTIME_APP_SHA=$expected_app_sha" \
    "CANDIDATE_SHA=$CANDIDATE_SHA"; do
    field="${field_value%%=*}"
    expected="${field_value#*=}"
    if ! assert_runtime_identity_field "$case_name" "$field" "$expected" "$output"; then
      failures=$((failures + 1))
    fi
  done

  expected_evidence_failures=0
  if [[ "$expected_identity" == 'UNKNOWN' ]]; then
    expected_evidence_failures=1
  fi
  if [[ "$checkout_sha" != "$api_sha" && "$api_sha" == "$web_sha" ]]; then
    local expected_set_status='NOT_EVALUATED'
    if [[ "$case_name" != unproven-split && "$history_count" == 107 && "$active_count" == 107 && "$failed_count" == 0 ]]; then
      [[ "$migration_case" == valid || "$migration_case" == missing-tree ]] && expected_set_status='PASS' || expected_set_status='UNKNOWN'
    fi
    if [[ "$output" != *"DATABASE_MIGRATION_SET=$expected_set_status"* ]]; then
      printf 'FAIL: runtime identity case %s expected DATABASE_MIGRATION_SET=%s; actual report:\n%s\n' \
        "$case_name" "$expected_set_status" "$output" >&2
      failures=$((failures + 1))
    fi
    if [[ "$expected_set_status" != NOT_EVALUATED && ! -f "$migration_query_seen_file" ]]; then
      printf 'FAIL: exact migration rows did not use readonly_query_stdin\n' >&2
      failures=$((failures + 1))
    fi
    if [[ "$output" == *'migration_001'* || "$output" == *'wrongchecksum'* ]]; then
      printf 'FAIL: migration row details leaked into audit output\n' >&2
      failures=$((failures + 1))
    fi
  fi
  if [[ "$case_name" == set-query-failure && "$(< "$migration_query_seen_file")" != transport-failure ]]; then
    printf 'FAIL: query-failure fixture did not exercise transport failure\n' >&2
    failures=$((failures + 1))
  fi
  if [[ "$case_name" == set-query-failure && "$AUDIT_QUERY_FAILURES" -ne 1 ]]; then
    printf 'FAIL: query transport failure was not counted\n' >&2
    failures=$((failures + 1))
  fi
  if [[ "$migration_case" == unknown && "$(< "$migration_query_seen_file")" != unknown-payload ]]; then
    printf 'FAIL: unknown fixture did not return a successful UNKNOWN payload\n' >&2
    failures=$((failures + 1))
  fi
  if [[ "$case_name" == set-query-unknown && "$AUDIT_QUERY_FAILURES" -ne 0 ]]; then
    printf 'FAIL: successful UNKNOWN payload was counted as transport failure\n' >&2
    failures=$((failures + 1))
  fi
  if [[ "$AUDIT_EVIDENCE_FAILURES" -ne "$expected_evidence_failures" ]]; then
    printf 'FAIL: runtime identity case %s expected AUDIT_EVIDENCE_FAILURES=%s, got %s; actual report:\n%s\n' \
      "$case_name" "$expected_evidence_failures" "$AUDIT_EVIDENCE_FAILURES" "$output" >&2
    failures=$((failures + 1))
  fi
  if [[ "$migration_case" == valid && "$case_name" == proven-split ]]; then
    api_sha="$checkout_sha"
    web_sha="$checkout_sha"
    report_runtime_identity "$fixture_root" "$selector" "$deployments_root" > "$output_file"
    output="$(< "$output_file")"
    if [[ "$output" != *'RUNTIME_IDENTITY=CONSISTENT'* || "$output" != *'DATABASE_MIGRATION_SET=NOT_EVALUATED'* ]]; then
      printf 'FAIL: later consistent identity inherited stale migration-set status; report:\n%s\n' "$output" >&2
      failures=$((failures + 1))
    fi
  fi
  return "$((failures == 0 ? 0 : 1))"
}

run_runtime_identity_normal() {
  local sha='9c2d5e1656c734b3c7d621012ef02b09f0a8d512'
  run_runtime_identity_case normal "$sha" "$sha" "$sha" CONSISTENT "$sha"
}

run_runtime_identity_proven_split() {
  run_runtime_identity_case proven-split \
    '890b4f67044bbc62328493da01d485822e0beafc' \
    'db82d3d37fc6184a6d4063709b9a15b923371695' \
    'db82d3d37fc6184a6d4063709b9a15b923371695' \
    RECOVERED_SPLIT 'db82d3d37fc6184a6d4063709b9a15b923371695' 107 107 0
}

run_runtime_identity_split_rejections() {
  local checkout='890b4f67044bbc62328493da01d485822e0beafc'
  local revision='db82d3d37fc6184a6d4063709b9a15b923371695'
  local failures=0
  if ! (run_runtime_identity_case current-108 "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 108 0); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case runtime-tree-106 "$checkout" "$revision" "$revision" RECOVERED_SPLIT "$revision" 107 107 0 valid 106); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case runtime-tree-108 "$checkout" "$revision" "$revision" RECOVERED_SPLIT "$revision" 107 107 0 valid 108); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case current-failed "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 1); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case historical-108 "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 108 107 0); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case current-unknown "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 UNKNOWN 0); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case current-malformed "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107x 0); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case current-missing "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 ''); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case failed-missing "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 ''); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case query-failure "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 UNKNOWN 0 query-failure); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-replacement "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 replacement); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-checksum "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 checksum); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-malformed-checksum "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 malformed-checksum); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-extra-field "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 extra-field); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-empty-sixth "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 empty-sixth); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-missing-field "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 missing-field); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-duplicate-missing "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 duplicate-missing); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-invalid-state "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 invalid-state); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-zero-normal-steps "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 zero-normal); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-multiple-steps "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 multiple-steps); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-malformed-steps "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 malformed-steps); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-exception-checksum "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 exception-checksum); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-exception-multiple-steps "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 exception-multiple-steps); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-missing-runtime-tree "$checkout" "$revision" "$revision" RECOVERED_SPLIT "$revision" 107 107 0 missing-tree); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-query-unknown "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 unknown); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_case set-query-failure "$checkout" "$revision" "$revision" UNKNOWN UNKNOWN 107 107 0 query-failure); then failures=$((failures + 1)); fi
  [[ "$failures" -eq 0 ]]
}

run_runtime_identity_unproven_split() {
  run_runtime_identity_case unproven-split \
    '890b4f67044bbc62328493da01d485822e0beafc' \
    'db82d3d37fc6184a6d4063709b9a15b923371695' \
    'db82d3d37fc6184a6d4063709b9a15b923371695' \
    UNKNOWN UNKNOWN
}

run_runtime_mismatch() {
  run_runtime_identity_case mismatch \
    '0000000000000000000000000000000000000000' \
    '0000000000000000000000000000000000000000' \
    '0000000000000000000000000000000000000001' \
    UNKNOWN UNKNOWN
}

run_runtime_identity_suite() {
  local failures=0
  if ! (run_runtime_identity_normal); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_proven_split); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_split_rejections); then failures=$((failures + 1)); fi
  if ! (run_runtime_identity_unproven_split); then failures=$((failures + 1)); fi
  if ! (run_runtime_mismatch); then failures=$((failures + 1)); fi
  if [[ "$failures" -ne 0 ]]; then
    printf 'FAIL: %s runtime identity scenario(s) failed\n' "$failures" >&2
    return 1
  fi
  return 0
}

(run_healthy)
(run_readyz_degraded)
(run_s3_incomplete)
(run_db_failure)
(run_db_migration_count_capture)
(run_runtime_identity_suite)

printf 'PASS: deterministic production audit simulator covers degraded readiness, S3, SQL, and runtime identity scenarios\n'
