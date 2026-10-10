#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/capture-recovery-point-staging.sh"
pass=0; fail=0
ok(){ ((pass+=1)); printf 'ok %s - %s\n' "$pass" "$1"; }
bad(){ ((fail+=1)); printf 'not ok %s - %s\n' "$fail" "$1" >&2; }
common=(--source-app-sha 0123456789abcdef0123456789abcdef01234567 --api-container buildingos-staging-api --postgres-container buildingos-staging-postgres --database buildingos --api-env-file /opt/pawtech/env/buildingos-staging.env --s3-env-file /opt/pawtech/env/buildingos-staging.env --network buildingos-staging_buildingos_staging_net --rclone-config /tmp/buildingos-staging-rclone.test/rclone.conf --state-parent /opt/pawtech/backups/buildingos-staging-recovery-points --lock-path /opt/pawtech/backups/buildingos-staging-recovery-points/staging-operations.lock)
if "$SCRIPT" "${common[@]}" --destination prod:buildingos-production-backup/staging-recovery-points/x >/dev/null 2>&1; then bad 'production destination is rejected'; else ok 'production destination is rejected'; fi
if "$SCRIPT" "${common[@]}" --destination backup:other-bucket/recovery-points/x >/dev/null 2>&1; then bad 'non-staging prefix is rejected'; else ok 'non-staging prefix is rejected'; fi
if "$SCRIPT" "${common[@]}" --destination stagingtest:buildingos-staging/staging-recovery-points >/dev/null 2>&1; then bad 'missing protected files are rejected'; else ok 'missing protected files are rejected'; fi
if "$SCRIPT" "${common[@]/buildingos-staging-api/buildingos-api}" --destination stagingtest:buildingos-staging/staging-recovery-points >/dev/null 2>&1; then bad 'production API container is rejected'; else ok 'production API container is rejected'; fi
if "$SCRIPT" "${common[@]/buildingos-staging_buildingos_staging_net/pawtech_public}" --destination stagingtest:buildingos-staging/staging-recovery-points >/dev/null 2>&1; then bad 'production network is rejected'; else ok 'production network is rejected'; fi
if "$SCRIPT" "${common[@]/\/opt\/pawtech\/env\/buildingos-staging.env\/\/etc\/buildingos\/object-backup.env}" --destination stagingtest:buildingos-staging/staging-recovery-points >/dev/null 2>&1; then bad 'production environment path is rejected'; else ok 'production environment path is rejected'; fi
if grep -Eq 'echo[[:space:]]+.*(S3_|SECRET|PASSWORD|TOKEN)|printf[[:space:]]+.*(S3_|SECRET|PASSWORD|TOKEN)' "$SCRIPT"; then bad 'adapter prints secret-like values'; else ok 'adapter does not print secret-like values'; fi
((fail == 0)) || exit 1
printf 'PASSED: %s assertions\n' "$pass"
