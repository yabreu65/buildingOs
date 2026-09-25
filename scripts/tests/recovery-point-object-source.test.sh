#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/recovery-point-object-source.sh"
PORTABLE="$ROOT/scripts/lib/recovery-point-portable-stat.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-recovery-point-object.XXXXXX")"
trap '[[ -n "${KEEP:-}" ]] || rm -rf -- "$T"' EXIT
B="$T/bin"; STAGING="$T/staging"; ENV_FILE="$T/api.protected.env"; PAYLOAD="$T/payload"; AUDIT="$T/audit"
IMAGE='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
NETWORK='private_net'; BUCKET='source-bucket'; KEY=$'reports/line\nbreak & plus+'; VERSION='version +&/id'
PASS=0; FAIL=0
pass(){ PASS=$((PASS+1)); printf 'ok %s - %s\n' "$PASS" "$1"; }
fail(){ FAIL=$((FAIL+1)); printf 'not ok %s - %s\n' "$FAIL" "$1" >&2; }
ok(){ local n="$1"; shift; if "$@" >>"$AUDIT" 2>&1; then pass "$n"; else fail "$n"; fi; }
bad(){ local n="$1"; shift; if "$@" >>"$AUDIT" 2>&1; then fail "$n (unexpected success)"; else pass "$n"; fi; }
mode(){ recovery_point_portable_stat_mode "$1"; }
sha(){ if command -v sha256sum >/dev/null; then sha256sum "$1"|awk '{print $1}'; else shasum -a 256 "$1"|awk '{print $1}'; fi; }
absent(){ [[ ! -e "$1" && ! -L "$1" ]]; }

mkdir -p "$B" "$STAGING"; chmod 0700 "$STAGING"
printf 'S3_ENDPOINT=https://storage.example.invalid\nS3_ACCESS_KEY=never-log-secret\nS3_SECRET_KEY=never-log-secret\nS3_BUCKET=%s\n' "$BUCKET" >"$ENV_FILE"
printf 'fixture object bytes\n' >"$PAYLOAD"; : >"$AUDIT"; chmod 0600 "$ENV_FILE" "$AUDIT"
cat >"$B/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
env= net= image= mount= workdir= user= staging_root= action=
for arg in "$@"; do
  [[ "$arg" != *"$FAKE_KEY"* && "$arg" != *"$FAKE_VERSION"* && "$arg" != *never-log-secret* && "$arg" != *storage.example.invalid* ]] || exit 90
done
while (($#)); do
  case "$1" in
    run|--rm|--interactive) shift ;;
    --env-file) env="$2"; shift 2 ;;
    --network) net="$2"; shift 2 ;;
    --mount) mount="$2"; shift 2 ;;
    --workdir) workdir="$2"; shift 2 ;;
    --user) user="$2"; shift 2 ;;
    --env) [[ "$2" == S3_FENCE_OBJECT_STAGING_ROOT=* ]] || exit 99; staging_root="${2#S3_FENCE_OBJECT_STAGING_ROOT=}"; shift 2 ;;
    *) if [[ -z "$image" ]]; then image="$1"; shift
       elif [[ "$1" == node ]]; then shift; [[ "$1" == - ]] || exit 91; shift; action="$1"; shift
       else exit 92; fi ;;
  esac
done
[[ "$env" == "$FAKE_ENV" && "$net" == "$FAKE_NETWORK" && "$image" == "$FAKE_IMAGE" && "$action" == object-get ]] || exit 93
[[ "$workdir" == /app && "$staging_root" == /recovery-point-object-staging && "$user" == "$FAKE_UID:$FAKE_GID" && "$mount" == type=bind,src=*,dst=/recovery-point-object-staging ]] || exit 94
src="$(cat)"; [[ "$src" == *S3_FENCE_HELPER_PROTOCOL_V2* ]] || exit 95
b64="$(printf '%s\n' "$src" | awk -F"'" 'index($0,"main(JSON.parse(Buffer.from("){print $2}')"
request="$(printf %s "$b64" | base64 -d)"
[[ "$(jq -r .action <<<"$request")" == object-get && "$(jq -r .bucket <<<"$request")" == "$FAKE_BUCKET" ]] || exit 96
[[ "$(jq -r .key <<<"$request")" == "$FAKE_KEY" ]] || exit 97
root="${mount#type=bind,src=}"; root="${root%,dst=/recovery-point-object-staging}"
out="$(jq -r .outputBasename <<<"$request")"
[[ "$out" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || exit 98
case "${FAKE_MODE:-success}" in
  stream-fail) : >"$root/$out"; chmod 600 "$root/$out"; rm -f -- "$root/$out"; jq -cn '{ok:false,error:"S3_FENCE_SDK_ERROR"}' ;;
  *) cp "$FAKE_PAYLOAD" "$root/$out"; chmod 600 "$root/$out"
     bytes="$(wc -c <"$FAKE_PAYLOAD" | tr -d '[:space:]')"; digest="$(if command -v sha256sum >/dev/null; then sha256sum "$FAKE_PAYLOAD"|awk '{print $1}'; else shasum -a 256 "$FAKE_PAYLOAD"|awk '{print $1}'; fi)"
     observed="${FAKE_OBSERVED_VERSION:-$FAKE_VERSION}"
     [[ "${FAKE_MODE:-success}" != current-null ]] || observed=''
     [[ "${FAKE_MODE:-success}" != bytes-mismatch ]] || bytes=99
     [[ "${FAKE_MODE:-success}" != hash-mismatch ]] || digest="${digest/a/b}"
     [[ "${FAKE_MODE:-success}" != version-mismatch ]] || observed=other-version
     jq -cn --arg b "$FAKE_BUCKET" --argjson n "$bytes" --arg h "$digest" --arg v "$observed" '{ok:true,bucket:$b,bytes:$n,sha256:$h,versionId:(if $v=="" then null else $v end)}' ;;
esac
DOCKER
chmod +x "$B/docker"
export PATH="$B:/usr/bin:/bin" S3_FENCE_DOCKER_BIN=docker FAKE_ENV="$ENV_FILE" FAKE_NETWORK="$NETWORK" FAKE_IMAGE="$IMAGE" FAKE_BUCKET="$BUCKET" FAKE_KEY="$KEY" FAKE_VERSION="$VERSION" FAKE_PAYLOAD="$PAYLOAD" FAKE_UID="$(id -u)" FAKE_GID="$(id -g)"
source "$PORTABLE"
source "$LIB"
PINNED="$STAGING/pinned-object"; CURRENT="$STAGING/current-object"
ok 'pinned SDK object fetch succeeds with private output' recovery_point_object_source_fetch "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$KEY" "$VERSION" 21 "$STAGING" "$PINNED"
ok 'pinned bytes are exact' cmp -s "$PAYLOAD" "$PINNED"
ok 'pinned output mode is 0600' test "$(mode "$PINNED")" = 600
ok 'pinned result reports independent bytes hash and version' bash -c '[[ "$1" == 21 && "$2" == "$3" && "$4" == "$5" ]]' _ "$RECOVERY_POINT_OBJECT_SOURCE_BYTES" "$RECOVERY_POINT_OBJECT_SOURCE_SHA256" "$(sha "$PAYLOAD")" "$RECOVERY_POINT_OBJECT_SOURCE_OBSERVED_VERSION_ID" "$VERSION"
ok 'current reference binds the observed version' recovery_point_object_source_fetch "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$KEY" '' 21 "$STAGING" "$CURRENT"
ok 'current reference returns observed version' test "$RECOVERY_POINT_OBJECT_SOURCE_OBSERVED_VERSION_ID" = "$VERSION"
CURRENT_NULL="$STAGING/current-null"
ok 'current reference retains nullable version semantics' env FAKE_MODE=current-null bash -c 'source "$1"; recovery_point_object_source_fetch "$2" "$3" "$4" "$5" "$6" "" 21 "$7" "$8"; test -z "$RECOVERY_POINT_OBJECT_SOURCE_OBSERVED_VERSION_ID"' _ "$LIB" "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$KEY" "$STAGING" "$CURRENT_NULL"
for mode_name in bytes-mismatch hash-mismatch version-mismatch stream-fail; do
  out="$STAGING/$mode_name"
  bad "$mode_name fails closed and leaves no output" env FAKE_MODE="$mode_name" bash -c 'source "$1"; recovery_point_object_source_fetch "$2" "$3" "$4" "$5" "$6" "$7" 21 "$8" "$9"' _ "$LIB" "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$KEY" "$VERSION" "$STAGING" "$out"
  ok "$mode_name cleanup is exclusive" absent "$out"
done
printf keep >"$STAGING/collision"
bad 'existing output is never overwritten' recovery_point_object_source_fetch "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$KEY" "$VERSION" 21 "$STAGING" "$STAGING/collision"
ok 'collision is preserved' cmp -s <(printf keep) "$STAGING/collision"
ln -s "$PAYLOAD" "$STAGING/symlink"
bad 'symlink output fails closed' recovery_point_object_source_fetch "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$KEY" "$VERSION" 21 "$STAGING" "$STAGING/symlink"
if grep -Fq -- "$KEY" "$AUDIT" || grep -Fq -- "$VERSION" "$AUDIT" || grep -Fq -- never-log-secret "$AUDIT" || grep -Fq -- storage.example.invalid "$AUDIT"; then fail 'identifiers and credentials stay out of host command logs'; else pass 'identifiers and credentials stay out of host command logs'; fi
((FAIL==0)) || exit 1
printf 'PASSED: %s assertions\n' "$PASS"
