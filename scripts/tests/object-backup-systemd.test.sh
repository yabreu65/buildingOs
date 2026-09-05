#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly SERVICE="$ROOT_DIR/infra/production/systemd/pawtech-buildingos-object-backup.service"
readonly TIMER="$ROOT_DIR/infra/production/systemd/pawtech-buildingos-object-backup.timer"
readonly ENV_TEMPLATE="$ROOT_DIR/infra/production/buildingos-object-backup.env.example"

PASS_COUNT=0
FAIL_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok %s - %s\n' "$PASS_COUNT" "$1"; }
fail_test() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok %s - %s\n' "$FAIL_COUNT" "$1" >&2; }

assert_contains() {
  local name="$1"
  local value="$2"
  local file="$3"
  if grep -Fq -- "$value" "$file"; then pass "$name"; else fail_test "$name"; fi
}

assert_absent() {
  local name="$1"
  local value="$2"
  local file="$3"
  if grep -Fq -- "$value" "$file"; then fail_test "$name"; else pass "$name"; fi
}

assert_line_count() {
  local name="$1"
  local value="$2"
  local expected="$3"
  local file="$4"
  local actual
  actual="$(grep -Fc -- "$value" "$file" || true)"
  if [[ "$actual" == "$expected" ]]; then pass "$name"; else fail_test "$name"; fi
}

assert_contains 'service uses oneshot mode' 'Type=oneshot' "$SERVICE"
assert_contains 'service runs as yoryi' 'User=yoryi' "$SERVICE"
assert_contains 'service uses yoryi group' 'Group=yoryi' "$SERVICE"
assert_contains 'service uses protected environment file' 'EnvironmentFile=/etc/buildingos/object-backup.env' "$SERVICE"
assert_contains 'service uses application working directory' 'WorkingDirectory=/opt/pawtech/apps/buildingos/buildingos-app' "$SERVICE"
assert_contains 'service invokes object backup primitive' 'ExecStart=/opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-object-storage.sh' "$SERVICE"
assert_contains 'service wants network online' 'Wants=network-online.target' "$SERVICE"
assert_contains 'service starts after network online' 'After=network-online.target' "$SERVICE"
assert_absent 'service does not require Docker' 'docker' "$SERVICE"
assert_contains 'service uses restrictive umask' 'UMask=0077' "$SERVICE"
assert_contains 'service prevents privilege escalation' 'NoNewPrivileges=true' "$SERVICE"
assert_contains 'service isolates temporary files' 'PrivateTmp=true' "$SERVICE"
assert_contains 'service protects home' 'ProtectHome=true' "$SERVICE"
assert_contains 'service protects the system' 'ProtectSystem=strict' "$SERVICE"
assert_contains 'service uses dedicated state directory' 'StateDirectory=buildingos-object-backup' "$SERVICE"
assert_contains 'service permits only dedicated state writes' 'ReadWritePaths=/var/lib/buildingos-object-backup' "$SERVICE"

assert_line_count 'timer has one daily schedule' 'OnCalendar=' '1' "$TIMER"
assert_contains 'timer has daily schedule' 'OnCalendar=*-*-* 02:15:00' "$TIMER"
assert_contains 'timer is persistent' 'Persistent=true' "$TIMER"
assert_contains 'timer randomizes by fifteen minutes' 'RandomizedDelaySec=15m' "$TIMER"
assert_contains 'timer binds only object backup service' 'Unit=pawtech-buildingos-object-backup.service' "$TIMER"

assert_contains 'template defines source placeholder' 'OBJECT_BACKUP_SOURCE=source-remote:buildingos-production' "$ENV_TEMPLATE"
assert_contains 'template defines distinct destination bucket' 'OBJECT_BACKUP_DESTINATION=backup-remote:buildingos-production-backup' "$ENV_TEMPLATE"
assert_contains 'template uses dedicated receipt state directory' 'OBJECT_BACKUP_RECEIPT=/var/lib/buildingos-object-backup/object-backup-receipt.json' "$ENV_TEMPLATE"
assert_contains 'template points rclone config outside Git' 'RCLONE_CONFIG=/etc/buildingos/object-backup-rclone.conf' "$ENV_TEMPLATE"
assert_absent 'template has no access key variable' 'ACCESS_KEY=' "$ENV_TEMPLATE"
assert_absent 'template has no secret key variable' 'SECRET_KEY=' "$ENV_TEMPLATE"
assert_absent 'template has no signed URL' 'https://' "$ENV_TEMPLATE"

source_location="$(grep '^OBJECT_BACKUP_SOURCE=' "$ENV_TEMPLATE")"
source_location="${source_location#*=}"
destination_location="$(grep '^OBJECT_BACKUP_DESTINATION=' "$ENV_TEMPLATE")"
destination_location="${destination_location#*=}"
source_bucket="${source_location#*:}"
destination_bucket="${destination_location#*:}"
if [[ "$source_bucket" != "$destination_bucket" ]]; then
  pass 'template source and destination bucket names differ'
else
  fail_test 'template source and destination bucket names differ'
fi

for unit_file in "$SERVICE" "$TIMER"; do
  assert_absent "$(basename "$unit_file") has no paired backup coordinator" 'backup-buildingos-production.sh' "$unit_file"
  assert_absent "$(basename "$unit_file") has no PostgreSQL paired backup" 'backup-postgres-paired.sh' "$unit_file"
  assert_absent "$(basename "$unit_file") has no MinIO backup" 'backup-minio.sh' "$unit_file"
  assert_absent "$(basename "$unit_file") has no MinIO dependency" 'MinIO' "$unit_file"
  assert_absent "$(basename "$unit_file") has no control update dependency" 'CONTROL_UPDATE' "$unit_file"
  assert_absent "$(basename "$unit_file") has no sudo invocation" 'sudo' "$unit_file"
  assert_absent "$(basename "$unit_file") has no systemctl invocation" 'systemctl' "$unit_file"
done

if (( FAIL_COUNT > 0 )); then
  printf 'FAILED: %s failed, %s passed\n' "$FAIL_COUNT" "$PASS_COUNT" >&2
  exit 1
fi
printf 'PASSED: %s assertions\n' "$PASS_COUNT"
