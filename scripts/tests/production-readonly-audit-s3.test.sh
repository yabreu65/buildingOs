#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"
source "$AUDITOR"
readonly OUTPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/buildingos-readonly-audit-s3.XXXXXX")"
trap 'rm -f "$OUTPUT_FILE"' EXIT

S3_MODE='pass'
docker() {
  case "$*" in
    *'command -v aws'* )
      [[ "$S3_MODE" != 'unavailable' ]] || return 1
      printf 'available'
      ;;
    *'head-bucket'* )
      [[ "$S3_MODE" != 'head-fail' ]] || return 1
      ;;
    *'get-bucket-versioning'* )
      [[ "$S3_MODE" != 'partial' ]] || return 1
      printf 'Enabled'
      ;;
    *'list-objects-v2'* )
      [[ "$S3_MODE" != 'partial' ]] || return 1
      printf '3'
      ;;
    *)
      return 1
      ;;
  esac
}

report_s3_posture > "$OUTPUT_FILE"
pass_output="$(< "$OUTPUT_FILE")"
[[ "$pass_output" == *'S3_DEEP_AUDIT=PASS'* ]]
[[ "$pass_output" != *'S3_DEEP_AUDIT=INCOMPLETE'* ]]

S3_MODE='partial'
report_s3_posture > "$OUTPUT_FILE"
partial_output="$(< "$OUTPUT_FILE")"
[[ "$partial_output" == *'S3_DEEP_AUDIT=INCOMPLETE'* ]]
[[ "$partial_output" != *'S3_DEEP_AUDIT=PASS'* ]]
[[ "$AUDIT_EVIDENCE_FAILURES" -gt 0 ]]

S3_MODE='head-fail'
report_s3_posture > "$OUTPUT_FILE"
head_output="$(< "$OUTPUT_FILE")"
[[ "$head_output" == *'S3_DEEP_AUDIT=FAIL'* ]]
[[ "$head_output" != *'S3_DEEP_AUDIT=PASS'* ]]

S3_MODE='unavailable'
report_s3_posture > "$OUTPUT_FILE"
unavailable_output="$(< "$OUTPUT_FILE")"
[[ "$unavailable_output" == *'S3_DEEP_AUDIT_UNAVAILABLE'* ]]
[[ "$unavailable_output" == *'S3_DEEP_AUDIT=INCOMPLETE'* ]]
printf 'PASS: S3 deep audit PASS, INCOMPLETE, FAIL, and unavailable states fail closed\n'
