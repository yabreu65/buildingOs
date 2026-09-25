#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; LIB="$ROOT/scripts/lib/recovery-point-file-object-bundle.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/recovery-bundle.XXXXXX")"; trap 'rm -rf -- "$T"' EXIT
B="$T/bin"; S="$T/stage"; P="$T/private"; A="$T/audit"; E="$P/api.env"; R="$P/rclone.conf"; M="$P/file-manifest.json"; H="$P/file-manifest.sha256"
IMAGE='registry.example.invalid/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; NETWORK=private_net; BUCKET=source-bucket
pass=0; fail=0; ok(){ local n="$1"; shift; if "$@" >>"$A" 2>&1; then pass=$((pass+1)); printf 'ok %s - %s\n' "$pass" "$n"; else fail=$((fail+1)); printf 'not ok %s - %s\n' "$fail" "$n" >&2; fi; }; bad(){ local n="$1"; shift; if "$@" >>"$A" 2>&1; then fail=$((fail+1)); printf 'not ok %s - unexpected success\n' "$fail" "$n" >&2; else pass=$((pass+1)); printf 'ok %s - %s\n' "$pass" "$n"; fi; }
sha(){ if command -v sha256sum >/dev/null; then sha256sum "$1"|awk '{print $1}'; else shasum -a 256 "$1"|awk '{print $1}'; fi; }; mode(){ stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null; }; owner(){ stat -f '%u' "$1" 2>/dev/null || stat -c '%u' "$1" 2>/dev/null; }
verify_retained_blobs(){ local root="$1" path expected_hash expected_bytes file; test "$(find "$root/objects" -type f | wc -l | tr -d ' ')" = 2 || return 1; while IFS=$'\t' read -r path expected_hash expected_bytes; do file="$root/$path"; test -f "$file" && test ! -L "$file" && test "$(sha "$file")" = "$expected_hash" && test "$(wc -c <"$file" | tr -d ' ')" = "$expected_bytes" || return 1; done < <(jq -r '.[] | [.destinationObjectPath, .sourceContentSha256, (.sourceContentBytes | tostring)] | @tsv' "$root/metadata/reference-content-manifest.json" | sort -u); }
verify_private_bundle(){ local root="$1" file uid; uid="$(id -u)"; test "$(mode "$root/metadata/reference-content-manifest.json")" = 600 && test "$(mode "$root/metadata/reference-content-manifest.sha256")" = 600 && test "$(mode "$root/metadata")" = 700 && test "$(mode "$root/objects")" = 700 && test "$(owner "$root/metadata/reference-content-manifest.json")" = "$uid" && test "$(owner "$root/metadata/reference-content-manifest.sha256")" = "$uid" && test "$(owner "$root/metadata")" = "$uid" && test "$(owner "$root/objects")" = "$uid" && test "$(find "$root/objects" -type f -links +1 | wc -l | tr -d ' ')" = 0 || return 1; while IFS= read -r file; do test "$(mode "$file")" = 600 && test "$(owner "$file")" = "$uid" || return 1; done < <(find "$root/objects" -type f -print); test -z "$(find "$root" \( -name '.bundle-*' -o -name '.recovery-point-*' \) -print -quit)"; }
mkdir -p "$B" "$S" "$P"; chmod 0700 "$S" "$P"; : >"$A"; chmod 0600 "$A"; printf 'S3_ENDPOINT=https://storage.example.invalid\nS3_ACCESS_KEY=secret\nS3_SECRET_KEY=secret\nS3_BUCKET=%s\n' "$BUCKET" >"$E"; : >"$R"; chmod 0600 "$E" "$R"
cat >"$M" <<'JSON'
[{"id":"a","tenantId":"t","bucket":"source-bucket","objectKey":"tab\rkey\tend","objectVersionId":"ver-☃","size":6,"checksum":null},{"id":"b","tenantId":"t","bucket":"source-bucket","objectKey":"tab\rkey\tend","objectVersionId":"ver-☃","size":6,"checksum":null},{"id":"c","tenantId":"t","bucket":"source-bucket","objectKey":"current","objectVersionId":null,"size":7,"checksum":null}]
JSON
jq -cS 'sort_by(.id)' "$M" >"$M.tmp" && mv "$M.tmp" "$M"; sha "$M" >"$H"; chmod 0600 "$M" "$H"
cat >"$B/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
env= net= user= staging_env= image= mount= workdir= action=
for x in "$@"; do [[ "$x" != *$'tab\rkey\tend'* && "$x" != *'ver-☃'* && "$x" != *storage.example.invalid* && "$x" != *secret* ]] || exit 90; done
while (($#)); do case "$1" in run|--rm|--interactive)shift;;--env-file)env="$2";shift 2;;--network)net="$2";shift 2;;--user)user="$2";shift 2;;--env)staging_env="$2";shift 2;;--mount)mount="$2";shift 2;;--workdir)workdir="$2";shift 2;;*)if [[ -z "$image" ]];then image="$1";shift;elif [[ "$1" == node ]];then shift;[[ "$1" == - ]]||exit 91;shift;action="$1";shift;else exit 92;fi;;esac;done
[[ "$env" == "$FAKE_ENV" && "$net" == "$FAKE_NET" && "$user" =~ ^[0-9]{1,10}:[0-9]{1,10}$ && "$staging_env" == S3_FENCE_OBJECT_STAGING_ROOT=/recovery-point-object-staging && "$mount" == type=bind,src=?*,dst=/recovery-point-object-staging && "$image" == "$FAKE_IMAGE" && "$action" == object-get && "$workdir" == /app ]] || exit 93
src="$(cat)"; [[ "$src" == *S3_FENCE_HELPER_PROTOCOL_V2* ]] || exit 94; b64="$(printf '%s\n' "$src"|awk -F"'" 'index($0,"main(JSON.parse(Buffer.from("){print $2}')"; req="$(printf %s "$b64"|base64 -d)"; key="$(jq -r .key <<<"$req")"; out="$(jq -r .outputBasename <<<"$req")"; root="${mount#type=bind,src=}"; root="${root%,dst=/recovery-point-object-staging}"
case "$key" in $'tab\rkey\tend') body=pinned; version='ver-☃';; current) body=current; version=now;;*)exit 95;;esac
[[ "${MODE:-ok}" != object-fail ]] || { jq -cn '{ok:false,error:"S3_FENCE_SDK_ERROR"}'; exit; }; printf %s "$body" >"$root/$out"; chmod 600 "$root/$out"; bytes="${#body}"; digest="$(if command -v sha256sum >/dev/null;then printf %s "$body"|sha256sum|awk '{print $1}';else printf %s "$body"|shasum -a 256|awk '{print $1}';fi)"; jq -cn --arg b "$FAKE_BUCKET" --arg v "$version" --arg h "$digest" --argjson n "$bytes" '{ok:true,bucket:$b,bytes:$n,sha256:$h,versionId:$v}'
DOCKER
cat >"$B/rclone" <<'RCLONE'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$@" >>"$LOG"; case "$1" in check) [[ "$2" == --help ]]&&{ printf '%s\n' --download;exit; };;help)printf '%s\n' --files-from-raw;exit;;--config) case "$3" in lsf) exit;;copyto) [[ "${MODE:-ok}" != copy-fail ]]||exit 4;;check) exit;;esac;;esac
RCLONE
chmod +x "$B/docker" "$B/rclone"; export PATH="$B:/usr/bin:/bin" S3_FENCE_DOCKER_BIN=docker FAKE_ENV="$E" FAKE_NET="$NETWORK" FAKE_IMAGE="$IMAGE" FAKE_BUCKET="$BUCKET" LOG="$T/argv"; : >"$LOG"; chmod 0600 "$LOG"
source "$LIB"
run(){ recovery_point_file_object_bundle_capture "$M" "$H" "$IMAGE" "$E" "$NETWORK" "$BUCKET" "$B/rclone" "$R" archive:recovery-point "$1"; }
ok 'pinned and current SDK reads create the unchanged content manifest' run "$S"
ok 'manifest preserves pinned and observed current versions' jq -e --arg key $'tab\rkey\tend' 'length==3 and .[0].objectKey==$key and .[0].capturedObjectVersionId=="ver-☃" and .[2].objectVersionId==null and .[2].capturedObjectVersionId=="now"' "$S/metadata/reference-content-manifest.json"
ok 'verified unique blobs are retained with expected paths bytes and hashes' verify_retained_blobs "$S"
ok 'published metadata and retained blobs are private, owned, and staging is cleaned' verify_private_bundle "$S"
ok 'only two unique object reads and four remote copies occur' bash -c 'test "$(grep -Ec "^archive:recovery-point/(objects/[0-9a-f]{64}\\.blob|metadata/reference-content-manifest\\.(json|sha256))$" "$1")" = 4' _ "$LOG"
F="$T/object-fail"; mkdir "$F"; chmod 0700 "$F"; bad 'helper failure aborts without local residue' env MODE=object-fail bash -c 'source "$1"; recovery_point_file_object_bundle_capture "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9" archive:object-fail "${10}"' _ "$LIB" "$M" "$H" "$IMAGE" "$E" "$NETWORK" "$BUCKET" "$B/rclone" "$R" "$F"; ok 'object failure leaves its root empty' test -z "$(find "$F" -mindepth 1 -print -quit)"
F="$T/copy-fail"; mkdir "$F"; chmod 0700 "$F"; bad 'remote copy failure preserves the no-retry warning' env MODE=copy-fail bash -c 'source "$1"; recovery_point_file_object_bundle_capture "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9" archive:copy-fail "${10}"' _ "$LIB" "$M" "$H" "$IMAGE" "$E" "$NETWORK" "$BUCKET" "$B/rclone" "$R" "$F"; ok 'remote failure removes only owned local outputs' test -z "$(find "$F" -mindepth 1 -print -quit)"; ok 'remote failure declares residue risk' grep -Fq 'remote unique namespace is incomplete; remote residue may remain; operator cleanup is required; do not retry.' "$A"
if grep -Fq $'tab\rkey\tend' "$A" "$LOG" || grep -Fq 'ver-☃' "$A" "$LOG" || grep -Fq storage.example.invalid "$A" "$LOG"; then fail 'raw object identifiers and endpoint are absent from logs'; else pass=$((pass+1)); printf 'ok %s - raw object identifiers and endpoint are absent from logs\n' "$pass"; fi
((fail==0)) || exit 1; printf 'PASSED: %s assertions\n' "$pass"
