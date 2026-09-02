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
  report_query_stdin DATABASE_IDENTITY <<'SQL' > "$output_file"
BEGIN READ ONLY;
SELECT current_database();
COMMIT;
SQL
  output="$(< "$output_file")"
  rm -f "$output_file"
  [[ "$output" == 'DATABASE_IDENTITY=UNKNOWN' ]]
  [[ "$AUDIT_QUERY_FAILURES" -eq 1 ]]
}

run_runtime_mismatch() {
  source "$AUDITOR"
  CANDIDATE_SHA='0000000000000000000000000000000000000000'
  container_revision() {
    case "$1" in
      buildingos-api) printf '%s' "$CANDIDATE_SHA" ;;
      buildingos-web) printf '%040d' 1 ;;
    esac
  }
  AUDIT_EVIDENCE_FAILURES=0
  output_file="$(mktemp "${TMPDIR:-/tmp}/buildingos-readonly-audit-simulator.XXXXXX")"
  report_runtime_identity > "$output_file"
  output="$(< "$output_file")"
  rm -f "$output_file"
  [[ "$output" == *'RUNTIME_IDENTITY=UNKNOWN'* ]]
  [[ "$AUDIT_EVIDENCE_FAILURES" -eq 1 ]]
}

(run_healthy)
(run_readyz_degraded)
(run_s3_incomplete)
(run_db_failure)
(run_runtime_mismatch)

printf 'PASS: deterministic production audit simulator covers degraded readiness, S3, SQL, and runtime mismatch scenarios\n'
