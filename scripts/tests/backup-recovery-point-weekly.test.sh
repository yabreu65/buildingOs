#!/usr/bin/env bash
set -Eeuo pipefail
set +x

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
RUNNER="$SCRIPT_DIR/../backup-recovery-point-weekly.sh"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-weekly-test.XXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
export BUILDINGOS_OPERATION_LOCK_PATH="$tmp/operations.lock"
bin="$tmp/bin"
mkdir "$bin"
real_flock=false
if command -v flock >/dev/null 2>&1; then
  real_flock=true
fi

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }

bash -n "$RUNNER" || fail 'weekly runner syntax'
bash -n "$SCRIPT_DIR/../lib/production-operation-lock.sh" || fail 'lock helper syntax'

output="$(bash "$RUNNER" --mode mock-capture --scenario success)" || fail 'mock success'
grep -Fxq 'WEEKLY_RECOVERY_POINT=MOCK_PASS' <<<"$output" || fail 'mock success evidence'
pass 'mock success'

for scenario in capture-fail fence-fail interrupt; do
  if bash "$RUNNER" --mode mock-capture --scenario "$scenario" >"$tmp/$scenario.out" 2>&1; then
    fail "mock $scenario unexpectedly passed"
  fi
  pass "mock $scenario rejected"
done

if [[ "$real_flock" == true ]]; then
  exec 9>"$BUILDINGOS_OPERATION_LOCK_PATH"
  flock -n 9 || fail 'unable to hold contention lock'
  if bash "$RUNNER" --mode mock-capture --scenario success >"$tmp/held.out" 2>&1; then
    fail 'lock contention unexpectedly passed'
  fi
  grep -Fq 'another production operation is active' "$tmp/held.out" || fail 'lock contention reason'
  exec 9>&-
  pass 'lock contention rejected'
else
  pass 'lock contention skipped because flock is unavailable on this host'
fi

cat >"$bin/rclone" <<'MOCK_RCLONE'
#!/usr/bin/env bash
set -Eeuo pipefail
case "${1:-}" in
  cat)
    path="${2:?}"
    point="$(basename "$(dirname "$(dirname "$path")")")"
    case "$path" in
      */metadata/recovery-point-receipt.json) cat "${MOCK_RECEIPT_DIR:?}/$point.json";;
      */metadata/recovery-point-receipt.sha256) cat "${MOCK_RECEIPT_DIR:?}/$point.sha256";;
      *) exit 2;;
    esac
    ;;
  *) exit 2;;
esac
MOCK_RCLONE
chmod 0755 "$bin/rclone"
receipt_dir="$tmp/receipts"
mkdir "$receipt_dir"
inventory="$tmp/inventory.json"
remote_root='backup:buildingos-production-backup/weekly-recovery-points'

for index in 1 2 3 4 5; do
  id="point-$index"
  completed="2026-10-0${index}T03:30:00Z"
  jq -n --arg id "$id" --arg completed "$completed" --arg root "$remote_root/sha-$index/$id" \
    '{format:"buildingos-recovery-point/v1",status:"PASS",backupSetId:$id,completedAtUtc:$completed,startedAtUtc:$completed,contentManifestSha256:("a"*64),inputManifestSha256:("b"*64),sourceAppSha:("c"*40),remoteRoot:$root,referenceCount:2,uniqueObjectCount:2,databaseDump:{status:"PASS"},statuses:{contentIdentity:"PASS",remoteDump:"PASS",inputManifest:"PASS",contentManifest:"PASS",hashes:"PASS"}}' \
    >"$receipt_dir/$id.json"
  sha256sum "$receipt_dir/$id.json" >"$receipt_dir/$id.sha256"
done
jq -n '[range(1;6) as $i | {path:("sha-"+($i|tostring)+"/point-"+($i|tostring)+"/metadata/recovery-point-receipt.json")}, {path:("sha-"+($i|tostring)+"/point-"+($i|tostring)+"/metadata/recovery-point-receipt.sha256")}]' >"$inventory"
export MOCK_RECEIPT_DIR="$receipt_dir"
PATH="$bin:$PATH" output="$(bash "$RUNNER" --mode retention-dry-run --remote-root "$remote_root" --inventory "$inventory")" || fail 'retention dry run'
grep -Fxq 'VALID_WEEKLY_POINTS=5' <<<"$output" || fail 'retention count'
grep -Fxq 'DELETE_CANDIDATES=1' <<<"$output" || fail 'retention candidate count'
grep -Fxq 'DELETIONS_PERFORMED=0' <<<"$output" || fail 'retention deletion guard'
[[ "$(grep -c '^WOULD_DELETE ' <<<"$output")" == 1 ]] || fail 'retention would-delete output'
pass 'retention keeps four and deletes nothing'

cp "$receipt_dir/point-1.sha256" "$tmp/point-1.sha256.good"
printf '%064d  point-1.json\n' 0 >"$receipt_dir/point-1.sha256"
if PATH="$bin:$PATH" bash "$RUNNER" --mode retention-dry-run --remote-root "$remote_root" --inventory "$inventory" >"$tmp/hash.out" 2>&1; then
  fail 'checksum mismatch unexpectedly passed'
fi
mv "$tmp/point-1.sha256.good" "$receipt_dir/point-1.sha256"
pass 'receipt checksum mismatch rejected'

bad_inventory="$tmp/bad-inventory.json"
jq '.[0].path = "deploy-sha/point/metadata/recovery-point-receipt.json"' "$inventory" >"$bad_inventory"
if PATH="$bin:$PATH" bash "$RUNNER" --mode retention-dry-run --remote-root "$remote_root" --inventory "$bad_inventory" >"$tmp/bad.out" 2>&1; then
  fail 'invalid weekly inventory unexpectedly passed'
fi
pass 'invalid inventory rejected'

printf 'WEEKLY_RECOVERY_POINT_TESTS=PASS\n'
