#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; WORKFLOW="$ROOT/.github/workflows/capture-recovery-point-staging.yml"
pass=0; fail=0; ok(){ ((pass+=1)); printf 'ok %s - %s\n' "$pass" "$1"; }; bad(){ ((fail+=1)); printf 'not ok %s - %s\n' "$fail" "$1" >&2; }
if grep -Fq 'workflow_dispatch:' "$WORKFLOW"; then ok 'manual dispatch is required'; else bad 'manual dispatch missing'; fi
if grep -Fq 'environment: staging' "$WORKFLOW"; then ok 'staging environment is required'; else bad 'staging environment missing'; fi
if grep -Fq 'capture-recovery-point-staging.sh' "$WORKFLOW"; then ok 'workflow uses staging adapter'; else bad 'staging adapter missing'; fi
if grep -Fq 'buildingos-production-backup' "$WORKFLOW"; then bad 'production bucket appears in workflow'; else ok 'production bucket is not referenced'; fi
if grep -Fq 'stagingtest:buildingos-staging/staging-recovery-points' "$WORKFLOW"; then ok 'destination is fixed to the Staging bucket and prefix'; else bad 'fixed Staging destination missing'; fi
if grep -Eq 'systemctl[[:space:]]+(enable|start|restart|stop|disable)' "$WORKFLOW"; then bad 'workflow changes systemd'; else ok 'workflow does not change systemd'; fi
if grep -Eq 'docker[[:space:]]+compose.*down|docker[[:space:]]+rm.*-v' "$WORKFLOW"; then bad 'workflow contains destructive Docker cleanup'; else ok 'workflow has no destructive Docker cleanup'; fi
((fail == 0)) || exit 1; printf 'PASSED: %s assertions\n' "$pass"
