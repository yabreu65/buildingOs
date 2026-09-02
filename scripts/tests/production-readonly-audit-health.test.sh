#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"
source "$AUDITOR"
CANDIDATE_SHA='0000000000000000000000000000000000000000'
API_READYZ_URL='https://example.invalid/readyz'

docker() {
  return 1
}

AUDIT_EVIDENCE_FAILURES=0
report_container_health API missing-container >/dev/null
[[ "$AUDIT_EVIDENCE_FAILURES" -eq 1 ]]

container_revision() {
  return 1
}

AUDIT_EVIDENCE_FAILURES=0
report_runtime_identity >/dev/null
[[ "$AUDIT_EVIDENCE_FAILURES" -eq 1 ]]

curl() {
  return 1
}

AUDIT_EVIDENCE_FAILURES=0
public_get_status PUBLIC_API_HEALTH https://example.invalid/health >/dev/null
[[ "$AUDIT_EVIDENCE_FAILURES" -eq 1 ]]

AUDIT_EVIDENCE_FAILURES=0
public_readyz_status >/dev/null
[[ "$AUDIT_EVIDENCE_FAILURES" -eq 1 ]]

printf 'PASS: container, runtime identity, health, and readyz failures fail closed\n'
