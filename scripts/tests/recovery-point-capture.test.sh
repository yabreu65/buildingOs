#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; LIB="$ROOT/scripts/lib/recovery-point-capture.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/recovery-capture.XXXXXX")"; trap '[[ -n "${KEEP:-}" ]] || rm -rf -- "$T"' EXIT
B="$T/bin"; A="$T/audit"; E="$T/api.protected.env"; R="$T/rclone.conf"; SHA=0123456789abcdef0123456789abcdef01234567; IMAGE='registry.example.invalid/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; NETWORK=private_net; BUCKET=source-bucket
pass=0; fail=0; ok(){ local n="$1";shift;if "$@" >>"$A" 2>&1;then pass=$((pass+1));printf 'ok %s - %s\n' "$pass" "$n";else fail=$((fail+1));printf 'not ok %s - %s\n' "$fail" "$n" >&2;fi;};bad(){ local n="$1";shift;if "$@" >>"$A" 2>&1;then fail=$((fail+1));printf 'not ok %s - unexpected success\n' "$fail" "$n" >&2;else pass=$((pass+1));printf 'ok %s - %s\n' "$pass" "$n";fi;}; mode(){ stat -f '%Lp' "$1" 2>/dev/null||stat -c '%a' "$1" 2>/dev/null; }; clean(){ [[ -z "$(find "$1" -mindepth 1 -print -quit)" ]]; }
mkdir -p "$B"; : >"$A"; chmod 0600 "$A"; printf 'S3_ENDPOINT=https://storage.example.invalid\nS3_ACCESS_KEY=secret-value\nS3_SECRET_KEY=secret-value\nS3_BUCKET=%s\n' "$BUCKET" >"$E"; : >"$R"; chmod 0600 "$E" "$R"
cat >"$B/timeout" <<'EOF'
#!/usr/bin/env bash
shift; exec "$@"
EOF
cat >"$B/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
for x in "$@";do [[ "$x" != *raw-private-key* && "$x" != *version-private* && "$x" != *secret-value* && "$x" != *storage.example.invalid* ]]||exit 90;done
if [[ "$1" == run ]];then
  env= net= user= staging_env= image= mount= workdir= action=;while (($#));do case "$1" in run|--rm|--interactive)shift;;--env-file)env="$2";shift 2;;--network)net="$2";shift 2;;--user)user="$2";shift 2;;--env)staging_env="$2";shift 2;;--mount)mount="$2";shift 2;;--workdir)workdir="$2";shift 2;;*)if [[ -z "$image" ]];then image="$1";shift;elif [[ "$1" == node ]];then shift;[[ "$1" == - ]]||exit 91;shift;action="$1";shift;else exit 92;fi;;esac;done
  [[ "$env" == "$FAKE_ENV" && "$net" == "$FAKE_NETWORK" && "$user" =~ ^[0-9]{1,10}:[0-9]{1,10}$ && "$staging_env" == S3_FENCE_OBJECT_STAGING_ROOT=/recovery-point-object-staging && "$mount" == type=bind,src=?*,dst=/recovery-point-object-staging && "$image" == "$FAKE_IMAGE" && "$action" == object-get && "$workdir" == /app ]]||exit 93; src="$(cat)";b64="$(printf '%s\n' "$src"|awk -F"'" 'index($0,"main(JSON.parse(Buffer.from("){print $2}')";req="$(printf %s "$b64"|base64 -d)";[[ "$(jq -r .key <<<"$req")" == raw-private-key ]]||exit 94;[[ "${MODE:-ok}" != object-fail ]]||{ jq -cn '{ok:false,error:"S3_FENCE_SDK_ERROR"}';exit;};root="${mount#type=bind,src=}";root="${root%,dst=/recovery-point-object-staging}";out="$(jq -r .outputBasename <<<"$req")";printf obj >"$root/$out";chmod 600 "$root/$out";digest="$(if command -v sha256sum >/dev/null;then printf obj|sha256sum|awk '{print $1}';else printf obj|shasum -a 256|awk '{print $1}';fi)";jq -cn --arg b "$FAKE_BUCKET" --arg h "$digest" '{ok:true,bucket:$b,bytes:3,sha256:$h,versionId:"version-private"}';exit
fi
printf '%s\n' "$@" >>"$AUDIT"; shift; [[ "${1:-}" == -i ]]&&shift; shift
case "$1" in sh)exit;;psql)if [[ " $* " == *' -c '* ]];then [[ "${MODE:-ok}" != postgres-fail ]]||exit 2;printf '%s\n' '[{"id":"file-a","tenantId":"tenant-a","bucket":"source-bucket","objectKey":"raw-private-key","objectVersionId":"version-private","size":3,"checksum":null}]';else while read -r x;do [[ "$x" == *pg_export_snapshot* ]]&&printf '00000003-0000001B-1\n';done;fi;;pg_dump)[[ "${MODE:-ok}" != postgres-fail ]]||exit 2;printf archive;;pg_restore)exit;;*)exit 2;;esac
DOCKER
cat >"$B/rclone" <<'RCLONE'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$@" >>"$AUDIT"; [[ "$1" == check && "$2" == --help ]]&&{ printf '%s\n' --download;exit;};[[ "$1" == help ]]&&{ printf '%s\n' --files-from-raw;exit;};if [[ "$1" == --config && "$3" == lsf ]];then exit;fi;if [[ "$1" == --config && "$3" == copyto ]];then [[ "${MODE:-ok}" != dump-copy-fail ]]||exit 2;exit;fi
RCLONE
chmod +x "$B"/*; export PATH="$B:/usr/bin:/bin" AUDIT="$A" S3_FENCE_DOCKER_BIN=docker FAKE_ENV="$E" FAKE_NETWORK="$NETWORK" FAKE_IMAGE="$IMAGE" FAKE_BUCKET="$BUCKET"
source "$LIB"
run(){ recovery_point_capture_create postgres-test appdb appuser "$IMAGE" "$E" "$NETWORK" "$BUCKET" "$B/rclone" "$R" archive:unique-root "$1" "$SHA" backup-01; }
P="$T/success";mkdir "$P";chmod 0700 "$P";ok 'threads exact SDK integration through a complete recovery capture' run "$P"
ok 'publishes private dump, content manifest, and receipt' bash -c 'test "$(stat -f %Lp "$1" 2>/dev/null||stat -c %a "$1")" = 700 && test "$(stat -f %Lp "$1/postgresql/buildingos_backup-01.dump" 2>/dev/null||stat -c %a "$1/postgresql/buildingos_backup-01.dump")" = 600 && jq -e ".status==\"PASS\" and .referenceCount==1 and .uniqueObjectCount==1" "$1/metadata/recovery-point-receipt.json"' _ "$P"
ok 'capture rejects tampered content mapping' bash -c 'source "$1"; ! recovery_point_capture_content_valid "$2/file-manifest.json" "$2/metadata/reference-content-manifest.json" 2 1' _ "$LIB" "$P"
P="$T/object-fail";mkdir "$P";chmod 0700 "$P";bad 'object SDK failure aborts capture and cleans local outputs' env MODE=object-fail bash -c 'source "$1"; recovery_point_capture_create postgres-test appdb appuser "$2" "$3" "$4" "$5" "$6" "$7" "$8" archive:object-fail "$9" "${10}" backup-01' _ "$LIB" "$IMAGE" "$E" "$NETWORK" "$BUCKET" "$B/rclone" "$R" "$P" "$SHA";ok 'object failure root is empty' clean "$P"
P="$T/postgres-fail";mkdir "$P";chmod 0700 "$P";bad 'database failure remains fail-closed' env MODE=postgres-fail bash -c 'source "$1"; recovery_point_capture_create postgres-test appdb appuser "$2" "$3" "$4" "$5" "$6" "$7" "$8" archive:postgres-fail "$9" "${10}" backup-01' _ "$LIB" "$IMAGE" "$E" "$NETWORK" "$BUCKET" "$B/rclone" "$R" "$P" "$SHA";ok 'database failure root is empty' clean "$P"
if grep -Fq raw-private-key "$A" || grep -Fq version-private "$A" || grep -Fq storage.example.invalid "$A" || grep -Fq secret-value "$A";then fail=$((fail+1));printf 'not ok %s - keys versions endpoints and credentials never reach host logs\n' "$fail" >&2;else pass=$((pass+1));printf 'ok %s - keys versions endpoints and credentials never reach host logs\n' "$pass";fi
((fail==0))||exit 1;printf 'PASSED: %s assertions\n' "$pass"
