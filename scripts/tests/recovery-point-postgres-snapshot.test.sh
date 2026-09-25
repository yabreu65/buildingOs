#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/recovery-point-postgres-snapshot.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/recovery-postgres-snapshot.XXXXXX")"
trap 'rm -rf -- "$T"' EXIT
B="$T/bin" A="$T/audit" S="$T/state"
pass=0 fail=0
pass_test() { pass=$((pass + 1)); printf 'ok %s - %s\n' "$pass" "$1"; }
fail_test() { fail=$((fail + 1)); printf 'not ok %s - %s\n' "$fail" "$1" >&2; }
ok() { local name="$1"; shift; if "$@" >>"$A" 2>&1; then pass_test "$name"; else fail_test "$name"; fi; }
bad() { local name="$1"; shift; if "$@" >>"$A" 2>&1; then fail_test "$name (unexpected success)"; else pass_test "$name"; fi; }
mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }
no_capture_artifacts() { [[ ! -e "$1/postgres.dump" && ! -L "$1/postgres.dump" && ! -e "$1/file-rows.json" && ! -L "$1/file-rows.json" ]] && [[ -z "$(find "$1" -maxdepth 1 -name '.recovery-point-postgres-*' -print -quit)" ]] && [[ ! -e "$S/exporter-open" ]]; }

mkdir -p "$B" "$S"
: >"$A"; chmod 0600 "$A"
cat >"$B/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$@" >>"$AUDIT"
[[ "$1" == exec ]] || exit 90
shift
[[ "${1:-}" == -i ]] && shift
[[ "${1:-}" == postgres-test ]] || exit 90
shift
case "$1" in
  sh)
    [[ "$2" == -c && "$3" == *'command -v pg_dump'* && "$3" == *'command -v psql'* && "$3" == *'command -v pg_restore'* ]] || exit 20
    ;;
  psql)
    shift
    if [[ " $* " == *' -c '* ]]; then
      [[ -e "$STATE/exporter-open" && ! -e "$STATE/exporter-closed" ]] || exit 91
      sql="${!#}"
      token="$(printf '%s' "$sql" | awk -F"'" '/SET TRANSACTION SNAPSHOT/{print $2}')"
      [[ "$token" == 00000003-0000001B-1 ]] || exit 92
      before_snapshot="${sql%%SET TRANSACTION SNAPSHOT*}"
      after_snapshot="${sql#*SET TRANSACTION SNAPSHOT}"
      [[ "$before_snapshot" == *'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'* && "$after_snapshot" == *'information_schema.columns'* ]] || exit 93
      [[ "$after_snapshot" == *"to_jsonb(file_row) -> 'objectVersionId'"* && "$sql" != *'"objectVersionId"'* ]] || exit 94
      [[ "${MODE:-ok}" != query-fail ]] || exit 12
      case "${MODE:-ok}" in
        malformed-json) printf '{bad\n' ;; non-array) printf '{"not":"array"}\n' ;; empty) printf '[]\n' ;; invalid-row) printf '[{"unexpected":true}]\n' ;;
        modern) printf '%s\n' '[{"id":"file-a","tenantId":"tenant-a","bucket":"bucket-a","objectKey":"private/object-key","objectVersionId":"version-a","size":7,"checksum":null}]' ;;
        *) printf '%s\n' '[{"id":"file-a","tenantId":"tenant-a","bucket":"bucket-a","objectKey":"private/object-key","objectVersionId":null,"size":7,"checksum":null}]' ;;
      esac
    else
      : >"$STATE/exporter-open"
      while IFS= read -r line; do
        case "$line" in
          'SELECT pg_export_snapshot();')
            case "${MODE:-ok}" in
              snapshot-invalid) printf 'not a snapshot\n' ;;
              no-snapshot) : ;;
              *) printf '00000003-0000001B-1\n' ;;
            esac
            ;;
          ROLLBACK\;)
            : >"$STATE/exporter-rolled-back"
            ;;
          '\q')
            rm -f "$STATE/exporter-open"
            : >"$STATE/exporter-closed"
            exit 0
            ;;
        esac
      done
      exit 13
    fi
    ;;
  pg_dump)
    [[ -e "$STATE/exporter-open" && ! -e "$STATE/exporter-closed" ]] || exit 14
    [[ " $* " == *' --snapshot=00000003-0000001B-1 '* ]] || exit 15
    [[ "${MODE:-ok}" != dump-fail ]] || exit 16
    printf 'custom-archive\n'
    ;;
  pg_restore)
    [[ "$1" == pg_restore && "$2" == --list ]] || exit 17
    [[ "${MODE:-ok}" != restore-fail ]] || exit 18
    printf 'archive listing\n'
    ;;
  *) exit 19 ;;
esac
MOCK
chmod +x "$B/docker"
cat >"$B/timeout" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'timeout %s\n' "$@" >>"$AUDIT"
[[ "$1" == 6h ]] || exit 21
shift
exec "$@"
MOCK
chmod +x "$B/timeout"
export PATH="$B:/usr/bin:/bin" AUDIT="$A" STATE="$S"
source "$LIB"

P="$T/private-ok"; mkdir "$P"; chmod 0700 "$P"
ok 'capture holds the exporter transaction through dump and File query' bash -Eeuo pipefail -c 'source "$1"; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
ok 'capture publishes private output pair' bash -c '[[ "$(stat -f %Lp "$1" 2>/dev/null || stat -c %a "$1")" == 700 && -f "$1/postgres.dump" && ! -L "$1/postgres.dump" && "$(stat -f %Lp "$1/postgres.dump" 2>/dev/null || stat -c %a "$1/postgres.dump")" == 600 && -f "$1/file-rows.json" && ! -L "$1/file-rows.json" && "$(stat -f %Lp "$1/file-rows.json" 2>/dev/null || stat -c %a "$1/file-rows.json")" == 600 ]]' _ "$P"
ok 'dump and query receive the identical exported snapshot' bash -c 'grep -F -- "--snapshot=00000003-0000001B-1" "$1" >/dev/null && grep -F -- "SET TRANSACTION SNAPSHOT '\''00000003-0000001B-1'\''" "$1" >/dev/null' _ "$A"
ok 'dump archive is validated and exporter is rolled back and closed' bash -c 'grep -Fx pg_restore "$1" >/dev/null && test -e "$2/exporter-rolled-back" && test -e "$2/exporter-closed" && test ! -e "$2/exporter-open"' _ "$A" "$S"
ok 'capture does not expose File row data in output or command arguments' bash -c '! grep -Fq private/object-key "$1"' _ "$A"
ok 'preflight verifies local timeout and container PostgreSQL tools without a database call' recovery_point_postgres_snapshot_require_runtime postgres-test
ok 'exporter, dump, query, and restore are each wrapped in the six-hour timeout' bash -c 'test "$(grep -c "^timeout 6h$" "$1")" -ge 5' _ "$A"
P="$T/private-modern"; mkdir "$P"; chmod 0700 "$P"; rm -f "$S"/*
ok 'modern File schema records the object version from the imported snapshot' env MODE=modern bash -Eeuo pipefail -c 'source "$1"; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
ok 'modern File schema retains the exact object version' bash -c 'grep -Fq "\"objectVersionId\":\"version-a\"" "$1/file-rows.json"' _ "$P"
P="$T/private-legacy"; mkdir "$P"; chmod 0700 "$P"; rm -f "$S"/*
ok 'legacy File schema emits a null object version without a direct column reference' bash -Eeuo pipefail -c 'source "$1"; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
ok 'legacy File schema retains a null object version' bash -c 'grep -Fq "\"objectVersionId\":null" "$1/file-rows.json"' _ "$P"
P="$T/private-existing"; mkdir "$P"; chmod 0700 "$P"; printf keep >"$P/postgres.dump"; chmod 0600 "$P/postgres.dump"
bad 'existing output is never overwritten' bash -Eeuo pipefail -c 'source "$1"; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
ok 'existing output remains intact' bash -c 'test "$(<"$1/postgres.dump")" = keep' _ "$P"
P="$T/private-symlink"; mkdir "$P"; chmod 0700 "$P"; ln -s "$P/missing" "$P/file-rows.json"
bad 'symlink output is rejected before capture' bash -Eeuo pipefail -c 'source "$1"; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
P="$T/private-publish"; mkdir "$P"; chmod 0700 "$P"; rm -f "$S"/*
bad 'second publication failure removes the output pair' bash -Eeuo pipefail -c 'source "$1"; calls=0; ln() { calls=$((calls + 1)); (( calls == 2 )) && return 1; command ln "$@"; }; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
ok 'publication failure leaves no partial output or exporter' no_capture_artifacts "$P"

P="$T/private-no-snapshot"; mkdir "$P"; chmod 0700 "$P"; rm -f "$S"/*
bad 'missing exporter snapshot response expires instead of blocking' env MODE=no-snapshot RECOVERY_POINT_POSTGRES_SNAPSHOT_RESPONSE_TIMEOUT_SECONDS=1 bash -Eeuo pipefail -c 'source "$1"; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
ok 'missing exporter response terminates and reaps exporter cleanup' bash -c 'test -e "$1/exporter-closed" && test ! -e "$1/exporter-open"' _ "$S"
ok 'missing exporter response removes capture artifacts' no_capture_artifacts "$P"
P="$T/private-term"; mkdir "$P"; chmod 0700 "$P"; rm -f "$S"/*
env MODE=no-snapshot RECOVERY_POINT_POSTGRES_SNAPSHOT_RESPONSE_TIMEOUT_SECONDS=30 bash -Eeuo pipefail -c 'source "$1"; trap "printf prior-exit >\"$3/prior-exit\"" EXIT; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P" "$S" &
signal_pid="$!"
for _ in $(seq 1 30); do [[ -e "$S/exporter-open" ]] && break; sleep 0.1; done
kill -TERM "$signal_pid"
if wait "$signal_pid" 2>/dev/null; then fail_test 'TERM interrupts active capture'; else pass_test 'TERM interrupts active capture'; fi
ok 'TERM cleanup closes and reaps exporter, artifacts, and caller EXIT trap' bash -c 'test -e "$1/exporter-closed" && test ! -e "$1/exporter-open" && test -e "$1/prior-exit" && [[ -z "$(find "$2" -maxdepth 1 -name ".recovery-point-postgres-*" -print -quit)" ]]' _ "$S" "$P"

for failure in snapshot-invalid dump-fail query-fail restore-fail; do
  P="$T/private-$failure"; mkdir "$P"; chmod 0700 "$P"; rm -f "$S"/*
  bad "$failure fails under set -e" env MODE="$failure" bash -Eeuo pipefail -c 'source "$1"; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
  ok "$failure removes outputs, temporary artifacts, and exporter" no_capture_artifacts "$P"
done
P="$T/private-malformed"; mkdir "$P"; chmod 0700 "$P"; rm -f "$S"/*
bad 'malformed JSON is rejected by capture syntax validation' env MODE=malformed-json bash -Eeuo pipefail -c 'source "$1"; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
for accepted_shape in empty non-array invalid-row; do
  P="$T/private-$accepted_shape"; mkdir "$P"; chmod 0700 "$P"; rm -f "$S"/*
  ok "$accepted_shape JSON is retained for manifest-layer validation" env MODE="$accepted_shape" bash -Eeuo pipefail -c 'source "$1"; recovery_point_postgres_snapshot_capture postgres-test appdb appuser "$2"' _ "$LIB" "$P"
done

((fail == 0)) || exit 1
printf 'PASSED: %s assertions\n' "$pass"
