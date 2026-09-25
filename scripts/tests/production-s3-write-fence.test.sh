#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/production-s3-write-fence.sh"
PORTABLE="$ROOT/scripts/lib/recovery-point-portable-stat.sh"
HELPER="$ROOT/scripts/lib/recovery-point-s3-helper.cjs"
T="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-s3-fence.XXXXXX")"
trap 'rm -rf "$T"' EXIT
BIN="$T/bin"; NODE_BIN="$(command -v node)"; ENV_FILE="$T/api.protected.env"; POLICY="$T/policy"; STATE="$T/state"; LOG="$T/log"; OBJ="$T/objects"
IMAGE='registry.example.invalid/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; NETWORK=private_net; BUCKET=source-bucket
PASS=0; FAIL=0
pass(){ PASS=$((PASS+1)); printf 'ok %s - %s\n' "$PASS" "$1"; }; fail(){ FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1" >&2; }
ok(){ local n="$1"; shift; if "$@" >>"$T/audit" 2>&1; then pass "$n"; else fail "$n"; fi; }; bad(){ local n="$1"; shift; if "$@" >>"$T/audit" 2>&1; then fail "$n (unexpected success)"; else pass "$n"; fi; }
has(){ grep -Fq -- "$2" "$3" >>"$T/audit" 2>&1 && pass "$1" || fail "$1"; }; mode(){ recovery_point_portable_stat_mode "$1"; }
private_tree(){ [[ "$(mode "$1")" == 700 ]] || return 1; local f; while IFS= read -r -d '' f; do [[ "$(mode "$f")" == 600 ]] || return 1; done < <(find "$1" -type f -print0); }
mkdir -p "$BIN" "$OBJ"; printf 'S3_ENDPOINT=https://storage.example.invalid\nS3_ACCESS_KEY=never-log-secret\nS3_SECRET_KEY=never-log-secret\nS3_BUCKET=%s\nS3_REGION=us-east-1\n' "$BUCKET" >"$ENV_FILE"
printf '{\n  "Version": "2012-10-17",\n  "Statement": [{"Sid":"keep","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::source-bucket/*"}]\n}\n' >"$POLICY"
cp "$POLICY" "$T/original-policy"
printf present >"$STATE"; : >"$LOG"; chmod 0600 "$ENV_FILE" "$POLICY" "$LOG" "$T/original-policy"

cat >"$BIN/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
env= net= image= action=; for arg in "$@"; do [[ "$arg" != *never-log-secret* && "$arg" != *never-log-url* ]] || exit 99; done
while (($#)); do case "$1" in run|--rm|--interactive) shift;; --env-file) env="$2";shift 2;; --network) net="$2";shift 2;; --mount|-v|--volume) exit 98;; *) if [[ -z "$image" ]];then image="$1";shift;elif [[ "$1" == node ]];then shift;[[ "$1" == - ]]||exit 97;shift;action="$1";shift;else shift;fi;; esac; done
[[ "$env" == "$FAKE_ENV" && "$net" == "$FAKE_NET" && "$image" == "$FAKE_IMAGE" ]] || exit 96
src="$(cat)"; [[ "$src" == *S3_FENCE_HELPER_PROTOCOL_V2* ]] || exit 95
b64="$(printf '%s\n' "$src" | awk -F"'" 'index($0,"main(JSON.parse(Buffer.from("){print $2}')"; req="$(printf %s "$b64"|base64 -d)"; [[ "$(jq -r .action <<<"$req")" == "$action" ]]||exit 94
printf '%s\n' "$action" >>"$FAKE_LOG"; printf '%s\n' "$req" >"$FAKE_REQUEST"; reply(){ jq -cn "$@"; }; key="$(jq -r '.key // empty' <<<"$req")"
case "$action" in
preflight) [[ -n "${FAKE_MISSING:-}" ]] && reply --arg x "$FAKE_MISSING" '{ok:false,version:"8.0.7",missing:[$x]}' || reply '{ok:true,version:"8.0.7",missing:[]}' ;;
policy-get) if [[ "$(<"$FAKE_STATE")" == absent ]];then reply --arg b "$FAKE_BUCKET" '{ok:true,state:"absent",bucket:$b}';elif [[ "${FAKE_THIRD_PARTY:-}" == 1 ]] && grep -Fq BuildingOSObjectBackupTemporaryWriteDeny "$FAKE_POLICY";then reply --arg b "$FAKE_BUCKET" --arg p "$(printf '{\"Version\":\"2012-10-17\",\"Statement\":[]}'|base64|tr -d '\n')" '{ok:true,state:"present",bucket:$b,policyBase64:$p}';else reply --arg b "$FAKE_BUCKET" --arg p "$(base64 <"$FAKE_POLICY"|tr -d '\n')" '{ok:true,state:"present",bucket:$b,policyBase64:$p}';fi ;;
policy-set) if [[ "${FAKE_REJECT:-}" == 1 ]];then reply '{ok:false,error:"AccessDenied"}';elif [[ "${FAKE_RESTORE_FAIL:-}" == 1 ]] && grep -Fq BuildingOSObjectBackupTemporaryWriteDeny "$FAKE_POLICY";then reply '{ok:false,error:"AccessDenied"}';else jq -j .policy <<<"$req" >"$FAKE_POLICY";printf present >"$FAKE_STATE"; [[ "${FAKE_AMBIGUOUS:-}" == 1 ]] && exit 7; reply '{ok:true}';fi ;;
policy-remove) printf absent >"$FAKE_STATE"; [[ "${FAKE_REMOVE_AMBIGUOUS:-}" == 1 ]] && exit 7; reply '{ok:true}' ;;
presigned-put) [[ "$(jq -r .expirySeconds <<<"$req")" == 86400 ]]||exit 93; printf '%s' "$key" >"$FAKE_PRESIGNED_KEY"; reply --arg u "https://storage.example.invalid/$FAKE_BUCKET/$key?x=never-log-url" '{ok:true,url:$u}' ;;
put) if [[ "$(<"$FAKE_STATE")" == present ]] && grep -Fq BuildingOSObjectBackupTemporaryWriteDeny "$FAKE_POLICY";then reply '{ok:false,error:"AccessDenied"}';else printf 'BuildingOS recovery-point fence probe: %s\n' "$key" >"$FAKE_OBJ/$key";reply --arg v "v-$key" '{ok:true,versionId:$v}';fi ;;
get|list) reply '{ok:true}' ;;
head) [[ -e "$FAKE_OBJ/$key" ]] && reply --arg v "v-$key" '{ok:true,versionId:$v}' || reply '{ok:false,error:"NoSuchKey"}' ;;
verify-absent) version="$(jq -r .versionId <<<"$req")"; expected="${FAKE_ABSENT_VERSION:-v-$key}"; [[ "$(jq -r .bucket <<<"$req")" == "$FAKE_BUCKET" ]] || { reply '{ok:false,error:"S3_FENCE_BUCKET_MISMATCH"}'; exit; }; [[ "$version" == "$expected" ]] || { reply '{ok:false,error:"S3_FENCE_VERSION_MISMATCH"}'; exit; }; [[ -e "$FAKE_OBJ/$key.deleted" ]] && reply --arg b "$FAKE_BUCKET" --arg k "$key" --arg v "$version" '{ok:true,state:"absent",bucket:$b,key:$k,versionId:$v}' || reply '{ok:false,error:"S3_FENCE_OBJECT_PRESENT"}' ;;
verify-owned|remove-owned) version="$(jq -r '.versionId // empty' <<<"$req")"; expected="v-$key"; [[ "$(jq -r .bucket <<<"$req")" == "$FAKE_BUCKET" ]] || { reply '{ok:false,error:"S3_FENCE_BUCKET_MISMATCH"}'; exit; }; [[ "${FAKE_FORCE_OWNERSHIP_MISMATCH:-}" == 1 ]] && expected=unexpected-version; if [[ ! -r "$FAKE_OBJ/$key" || "$(<"$FAKE_OBJ/$key")" != "BuildingOS recovery-point fence probe: $key" || "$version" != "$expected" ]];then reply '{ok:false,error:"S3_FENCE_OWNERSHIP_MISMATCH"}';elif [[ "$action" == remove-owned && "$(<"$FAKE_STATE")" == present ]] && grep -Fq BuildingOSObjectBackupTemporaryWriteDeny "$FAKE_POLICY";then printf 'delete-s3\n' >>"$FAKE_LOG"; reply '{ok:false,error:"AccessDenied"}';else [[ "$action" == remove-owned ]] && : >"$FAKE_OBJ/$key.deleted";reply '{ok:true}';fi ;;
*) exit 92;; esac
DOCKER
chmod +x "$BIN/docker"
cat >"$BIN/curl" <<'CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
for a in "$@";do [[ "$a" != *never-log-url* && "$a" != *never-log-secret* ]]||exit 88;done
out= body= config=;while (($#));do case "$1" in --output)out="$2";shift 2;; --data-binary)body="${2#@}";shift 2;; --config)config="$2";shift 2;; --request|--write-out)shift 2;; *)shift;;esac;done
[[ -r "$config" ]] || exit 86; config_hash="$(if command -v sha256sum >/dev/null; then sha256sum "$config" | awk '{print $1}'; else shasum -a 256 "$config" | awk '{print $1}'; fi)"; printf '%s %s\n' "$config" "$config_hash" >>"$FAKE_CURL_LOG"
if [[ "$(<"$FAKE_STATE")" == present ]] && grep -Fq BuildingOSObjectBackupTemporaryWriteDeny "$FAKE_POLICY";then printf '<Code>AccessDenied</Code>' >"$out";printf 403;else [[ -r "$body" ]] || exit 87; cp "$body" "$FAKE_OBJ/$(<"$FAKE_PRESIGNED_KEY")"; printf probe >"$out";printf 200;fi
CURL
chmod +x "$BIN/curl"
export PATH="$BIN:/usr/bin:/bin" S3_FENCE_DOCKER_BIN=docker S3_FENCE_CURL_BIN=curl FAKE_ENV="$ENV_FILE" FAKE_NET="$NETWORK" FAKE_IMAGE="$IMAGE" FAKE_POLICY="$POLICY" FAKE_STATE="$STATE" FAKE_BUCKET="$BUCKET" FAKE_LOG="$LOG" FAKE_OBJ="$OBJ" FAKE_PRESIGNED_KEY="$T/presigned-key" FAKE_CURL_LOG="$T/curl-log" FAKE_REQUEST="$T/last-request.json"
source "$PORTABLE"
source "$LIB"
quiesce(){ printf 'quiesce\n' >>"$LOG"; }; capture(){ printf 'capture\n' >>"$LOG"; }; capture_fail(){ printf 'capture\n' >>"$LOG"; return 1; }; resume(){ printf 'resume\n' >>"$LOG"; }

export FAKE_MISSING=removeObject; bad 'missing SDK method blocks before quiescence' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/missing" quiesce capture resume; unset FAKE_MISSING
ok 'present lifecycle captures only under the proven fence' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/present" quiesce capture resume
has 'capture follows fence probes' $'fence-list\ncapture' "$LOG"; has 'resume follows cleanup and exact restore' resume "$LOG"; ok 'private evidence includes exact raw policy' private_tree "$T/present"; has 'original raw bytes retain formatting' '  "Version":' "$T/present/policy-snapshot/policy.raw.json"
[[ "$(grep -c '^presigned-put$' "$LOG" || true)" == 1 ]] && pass 'presigned PUT is signed exactly once' || fail 'presigned PUT is signed exactly once'
[[ "$(awk '/^quiesce$/{fenced=1;next} fenced && /^presigned-put$/{count++} END{print count+0}' "$LOG")" == 0 ]] && pass 'no presigned PUT signing occurs after quiescence' || fail 'no presigned PUT signing occurs after quiescence'
[[ "$(wc -l <"$T/curl-log" | tr -d ' ')" == 2 && "$(sort -u "$T/curl-log" | wc -l | tr -d ' ')" == 1 ]] && pass 'presigned PUT replay uses the saved curl config identity' || fail 'presigned PUT replay uses the saved curl config identity'

versioned_key='buildingos-fence-probe-fedcba9876543210fedcba9876543210'; printf 'BuildingOS recovery-point fence probe: %s\n' "$versioned_key" >"$OBJ/$versioned_key"; cat "$T/original-policy" >"$POLICY"; printf present >"$STATE"; s3_fence_snapshot_policy "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/versioned-fence" && s3_fence_apply_temporary_deny "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/versioned-fence" || exit 1
before_delete_s3="$(grep -c '^delete-s3$' "$LOG" || true)"; s3_fence_probe "$IMAGE" "$ENV_FILE" "$NETWORK" remove-owned "$versioned_key" "$T/null-version-delete.json" '' true "$BUCKET" || exit 1; [[ "$(jq -r .error "$T/null-version-delete.json")" == S3_FENCE_OWNERSHIP_MISMATCH && "$(grep -c '^delete-s3$' "$LOG" || true)" == "$before_delete_s3" ]] && pass 'null version fails ownership before temporary deny' || fail 'null version fails ownership before temporary deny'
s3_fence_probe "$IMAGE" "$ENV_FILE" "$NETWORK" head "$versioned_key" "$T/literal-null-version.json" 'null' || exit 1; [[ "$(jq -r .versionId "$FAKE_REQUEST")" == null && "$(jq -r '.versionId|type' "$FAKE_REQUEST")" == string ]] && pass 'literal null version remains a JSON string' || fail 'literal null version remains a JSON string'
s3_fence_probe "$IMAGE" "$ENV_FILE" "$NETWORK" head "$versioned_key" "$T/unusual-version.json" 'odd +&/id' || exit 1; [[ "$(jq -r .versionId "$FAKE_REQUEST")" == 'odd +&/id' && "$(jq -r '.versionId|type' "$FAKE_REQUEST")" == string ]] && pass 'unusual raw version round-trips without JSON quoting' || fail 'unusual raw version round-trips without JSON quoting'
s3_fence_probe "$IMAGE" "$ENV_FILE" "$NETWORK" head "$versioned_key" "$T/json-null-version.json" '' true || exit 1; [[ "$(jq -r '.versionId|type' "$FAKE_REQUEST")" == null ]] && pass 'explicit null version remains JSON null' || fail 'explicit null version remains JSON null'
: >"$OBJ/$versioned_key.deleted"; s3_fence_verify_absent "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$versioned_key" "v-$versioned_key" "$T/verify-absent.json" || exit 1; [[ "$(jq -r .state "$T/verify-absent.json")" == absent && "$(jq -r .bucket "$FAKE_REQUEST")" == "$BUCKET" && "$(jq -r .key "$FAKE_REQUEST")" == "$versioned_key" && "$(jq -r .versionId "$FAKE_REQUEST")" == "v-$versioned_key" ]] && pass 'absence wrapper binds exact bucket key and version' || fail 'absence wrapper binds exact bucket key and version'
FAKE_ABSENT_VERSION=null s3_fence_verify_absent "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$versioned_key" 'null' "$T/verify-absent-literal-null.json" || exit 1; [[ "$(jq -r '.versionId|type' "$FAKE_REQUEST")" == string && "$(jq -r .versionId "$FAKE_REQUEST")" == null ]] && pass 'absence wrapper preserves literal null version as a string' || fail 'absence wrapper preserves literal null version as a string'
bad 'empty version ID fails before invocation' s3_fence_probe "$IMAGE" "$ENV_FILE" "$NETWORK" head "$versioned_key" "$T/empty-version.json" ''
s3_fence_probe "$IMAGE" "$ENV_FILE" "$NETWORK" remove-owned "$versioned_key" "$T/exact-version-delete.json" 'v-buildingos-fence-probe-fedcba9876543210fedcba9876543210' false "$BUCKET" || exit 1; [[ "$(jq -r .error "$T/exact-version-delete.json")" == AccessDenied && "$(grep -c '^delete-s3$' "$LOG" || true)" == "$((before_delete_s3 + 1))" ]] && pass 'raw exact version reaches S3 temporary deny' || fail 'raw exact version reaches S3 temporary deny'
s3_fence_restore_policy "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/versioned-fence" || exit 1
s3_fence_private_file "$T/cleanup-owned-head.json"; before_actions="$(wc -l <"$LOG"|tr -d ' ')"; s3_fence_cleanup_owned "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$versioned_key" "v-$versioned_key" "$T/cleanup-owned-head.json" "$T/cleanup-owned-remove.json" "$T/cleanup-owned-absence.json" || exit 1
[[ "$(tail -n +$((before_actions + 1)) "$LOG"|tr '\n' ' ')" == 'verify-owned remove-owned verify-absent ' && "$(jq -r '.bucket' "$FAKE_REQUEST")" == "$BUCKET" && "$(jq -r '.versionId' "$FAKE_REQUEST")" == "v-$versioned_key" && "$(jq -r '.state' "$T/cleanup-owned-absence.json")" == absent ]] && pass 'cleanup verifies exact absence immediately after owned exact-version removal' || fail 'cleanup verifies exact absence immediately after owned exact-version removal'
wrong_bucket_key='buildingos-fence-probe-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; printf 'BuildingOS recovery-point fence probe: %s\n' "$wrong_bucket_key" >"$OBJ/$wrong_bucket_key"; before_remove_actions="$(grep -c '^remove-owned$' "$LOG" || true)"; bad 'cleanup bucket mismatch fails before any delete' s3_fence_cleanup_owned "$IMAGE" "$ENV_FILE" "$NETWORK" wrong-bucket "$wrong_bucket_key" "v-$wrong_bucket_key" "$T/wrong-bucket-owned.json" "$T/wrong-bucket-remove.json" "$T/wrong-bucket-absence.json"; [[ "$(grep -c '^remove-owned$' "$LOG" || true)" == "$before_remove_actions" && -f "$OBJ/$wrong_bucket_key" ]] && pass 'bucket mismatch leaves object untouched' || fail 'bucket mismatch leaves object untouched'
wrong_version_key='buildingos-fence-probe-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; printf 'BuildingOS recovery-point fence probe: %s\n' "$wrong_version_key" >"$OBJ/$wrong_version_key"; before_remove_actions="$(grep -c '^remove-owned$' "$LOG" || true)"; bad 'cleanup version mismatch fails before any delete' s3_fence_cleanup_owned "$IMAGE" "$ENV_FILE" "$NETWORK" "$BUCKET" "$wrong_version_key" 'different-version' "$T/wrong-version-owned.json" "$T/wrong-version-remove.json" "$T/wrong-version-absence.json"; [[ "$(grep -c '^remove-owned$' "$LOG" || true)" == "$before_remove_actions" && -f "$OBJ/$wrong_version_key" ]] && pass 'version mismatch leaves object untouched' || fail 'version mismatch leaves object untouched'
capture_before_mismatch="$(grep -c '^capture$' "$LOG" || true)"; export FAKE_FORCE_OWNERSHIP_MISMATCH=1; bad 'ownership mismatch fails closed before capture' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/ownership-mismatch" quiesce capture resume; unset FAKE_FORCE_OWNERSHIP_MISMATCH; [[ "$(grep -c '^capture$' "$LOG" || true)" == "$capture_before_mismatch" ]] && pass 'ownership mismatch leaves capture uncalled' || fail 'ownership mismatch leaves capture uncalled'
[[ "$(<"$POLICY")" == *$'  "Version":'* ]] && pass 'exact raw policy was restored' || fail 'exact raw policy was restored'

printf absent >"$STATE"; ok 'absent policy removes only temporary fence' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/absent" quiesce capture resume; [[ "$(<"$STATE")" == absent ]] && pass 'absent state is restored' || fail 'absent state is restored'
printf absent >"$STATE"; export FAKE_REMOVE_AMBIGUOUS=1; ok 'ambiguous policy removal succeeds only after absent readback' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/absent-ambiguous" quiesce capture resume; unset FAKE_REMOVE_AMBIGUOUS
cat "$T/original-policy" >"$POLICY"; printf present >"$STATE"; export FAKE_REJECT=1; before="$(grep -c '^resume$' "$LOG"||true)"; bad 'rejected apply with original readback returns failure' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/reject" quiesce capture resume; unset FAKE_REJECT; [[ "$(grep -c '^resume$' "$LOG"||true)" -gt "$before" ]] && pass 'rejected unchanged policy resumes prior API state' || fail 'rejected unchanged policy resumes prior API state'
cat "$T/original-policy" >"$POLICY"; printf present >"$STATE"; before="$(grep -c '^resume$' "$LOG"||true)"; export FAKE_AMBIGUOUS=1; bad 'ambiguous mutation restores before resume' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/ambiguous" quiesce capture resume; unset FAKE_AMBIGUOUS; [[ "$(grep -c '^resume$' "$LOG"||true)" -gt "$before" ]] && pass 'ambiguous mutation resumes only after verified restoration' || fail 'ambiguous mutation resumes only after verified restoration'
cat "$T/original-policy" >"$POLICY"; printf present >"$STATE"; bad 'capture failure restores before resume' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/capture-fail" quiesce capture_fail resume
cat "$T/original-policy" >"$POLICY"; printf present >"$STATE"; before_resume="$(grep -c '^resume$' "$LOG"||true)"; before_set="$(grep -c '^policy-set$' "$LOG"||true)"; before_remove="$(grep -c '^policy-remove$' "$LOG"||true)"; export FAKE_THIRD_PARTY=1; bad 'unexpected third-party policy refuses restoration mutation' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/third-party" quiesce capture_fail resume; unset FAKE_THIRD_PARTY; [[ "$(grep -c '^policy-set$' "$LOG"||true)" == "$((before_set + 1))" ]] && pass 'third-party policy receives no restore set' || fail 'third-party policy receives no restore set'; [[ "$(grep -c '^policy-remove$' "$LOG"||true)" == "$before_remove" ]] && pass 'third-party policy receives no restore remove' || fail 'third-party policy receives no restore remove'; [[ "$(grep -c '^resume$' "$LOG"||true)" == "$before_resume" ]] && pass 'third-party policy keeps API stopped' || fail 'third-party policy keeps API stopped'
cat "$T/original-policy" >"$POLICY"; printf present >"$STATE"; export FAKE_RESTORE_FAIL=1; before="$(grep -c '^resume$' "$LOG"||true)"; bad 'restoration failure keeps API stopped' s3_fence_run_recovery_point "$IMAGE" "$ENV_FILE" "$NETWORK" "$T/restore-fail" quiesce capture resume; unset FAKE_RESTORE_FAIL; [[ "$(grep -c '^resume$' "$LOG"||true)" == "$before" ]] && pass 'no resume before restore verification' || fail 'no resume before restore verification'

# Actual helper execution against a fake minio@8.0.7 module; no Docker or network is used here.
NODEMOD="$T/app/node_modules/minio"; mkdir -p "$NODEMOD"; cat >"$NODEMOD/package.json" <<'JSON'
{"version":"8.0.7"}
JSON
cat >"$NODEMOD/index.js" <<'NODE'
const fs=require('fs'),{Readable}=require('stream'); let state=()=>fs.readFileSync(process.env.HSTATE,'utf8'); let policy=()=>fs.readFileSync(process.env.HPOLICY,'utf8');
class Client{constructor(){} async getBucketPolicy(){if(state()==='absent'){let e=new Error();e.code='NoSuchBucketPolicy';throw e}if(state()==='error'){let e=new Error();e.code='AccessDenied';throw e}return policy()}async setBucketPolicy(_,p){fs.writeFileSync(process.env.HSET,p);if(p===''){fs.writeFileSync(process.env.HSTATE,'absent');return}fs.writeFileSync(process.env.HPOLICY,p);fs.writeFileSync(process.env.HSTATE,'present')}async presignedPutObject(_,k,e){if(e!==86400)throw Error();return 'https://x/'+k}async putObject(_,k,body){fs.writeFileSync(process.env.HOBJ,body);return {}}async removeObject(bucket,key,options){fs.writeFileSync(process.env.HREMOVED,JSON.stringify({bucket,key,options:options||null}));return {}}async getObject(_,k,o){if(process.env.HGET)fs.writeFileSync(process.env.HGET,JSON.stringify({key:k,options:o||null}));if(process.env.HSTREAM_FAIL){return new Readable({read(){this.destroy(new Error('stream failure'))}})}return Readable.from([fs.readFileSync(process.env.HOBJ)])}async statObject(){if(process.env.HSTAT_ERROR){let e=new Error();e.code=process.env.HSTAT_ERROR;throw e}if(process.env.HSTAT_MISMATCH)return {versionId:'different'};return {versionId:process.env.HSTAT_JSON?JSON.parse(process.env.HSTAT_JSON):(process.env.HVERSION||'v1')}}listObjects(_,k){return Readable.from([{name:k}])}}
if(process.env.HMISSING)delete Client.prototype[process.env.HMISSING]; module.exports={Client};
NODE
cat >"$T/app/helper-runner.cjs" <<'NODE'
const fs=require('fs'); const [,,file,request]=process.argv; eval(`${fs.readFileSync(file,'utf8')}\nmain(JSON.parse(request)).then(x=>process.stdout.write(JSON.stringify(x)))`);
NODE
helper_call(){ (cd "$T/app" && NODE_PATH="$T/app/node_modules" HSTATE="$T/hstate" HPOLICY="$T/hpolicy" HOBJ="$T/hobj" HGET="$T/hget" HSET="$T/hset" HREMOVED="$T/hremoved" HVERSION="${HVERSION:-}" HSTAT_JSON="${HSTAT_JSON:-}" HSTAT_ERROR="${HSTAT_ERROR:-}" HSTAT_MISMATCH="${HSTAT_MISMATCH:-}" S3_ENDPOINT=https://x S3_ACCESS_KEY=a S3_SECRET_KEY=b S3_BUCKET="$BUCKET" "$NODE_BIN" - "$HELPER" "$1" <<'NODE'
const fs=require('fs'); const [,,file,request]=process.argv; eval(`${fs.readFileSync(file,'utf8')}\nmain(JSON.parse(request)).then(x=>process.stdout.write(JSON.stringify(x)))`);
NODE
)
}
helper_object_get(){
  (
    cd "$T/app"
    HSTATE="$T/hstate" HPOLICY="$T/hpolicy" HOBJ="$T/hobj" HGET="$T/hget" HSET="$T/hset" HREMOVED="$T/hremoved" HVERSION="${HVERSION:-}" HSTREAM_FAIL="${HSTREAM_FAIL:-}" S3_ENDPOINT=https://x S3_ACCESS_KEY=a S3_SECRET_KEY=b S3_BUCKET="$BUCKET" S3_FENCE_OBJECT_STAGING_ROOT="$T/helper-object" "$NODE_BIN" "$T/app/helper-runner.cjs" "$HELPER" "$1"
  )
}
printf present >"$T/hstate"; printf '{ "Version":"2012-10-17", "Statement":[] }' >"$T/hpolicy"; key='buildingos-fence-probe-0123456789abcdef0123456789abcdef'
helper_present="$(helper_call '{"action":"policy-get"}')"; [[ "$(jq -r .ok <<<"$helper_present")" == true && "$(jq -r .policyBase64 <<<"$helper_present"|base64 -d)" == "$(<"$T/hpolicy")" ]] && pass 'helper policy-present behavior executes' || fail 'helper policy-present behavior executes'
printf absent >"$T/hstate"; [[ "$(helper_call '{"action":"policy-get"}'|jq -r .state)" == absent ]] && pass 'helper policy-absent behavior executes' || fail 'helper policy-absent behavior executes'
printf error >"$T/hstate"; [[ "$(helper_call '{"action":"policy-get"}'|jq -r .ok)" == false ]] && pass 'helper policy-error behavior executes' || fail 'helper policy-error behavior executes'
absent_key='buildingos-fence-probe-0123456789abcdef0123456789abcdef'
for absence_code in NoSuchKey NotFound; do
  absence_response="$(HSTAT_ERROR="$absence_code" helper_call "{\"action\":\"verify-absent\",\"bucket\":\"$BUCKET\",\"key\":\"$absent_key\",\"versionId\":\"exact-v1\"}")"
  [[ "$(jq -r .state <<<"$absence_response")" == absent && "$(jq -r .bucket <<<"$absence_response")" == "$BUCKET" && "$(jq -r .key <<<"$absence_response")" == "$absent_key" && "$(jq -r .versionId <<<"$absence_response")" == exact-v1 ]] && pass "explicit exact-version $absence_code is verified absent" || fail "explicit exact-version $absence_code is verified absent"
done
literal_null_absence="$(HSTAT_ERROR=NoSuchKey helper_call "{\"action\":\"verify-absent\",\"bucket\":\"$BUCKET\",\"key\":\"$absent_key\",\"versionId\":\"null\"}")"
[[ "$(jq -r .state <<<"$literal_null_absence")" == absent && "$(jq -r '.versionId|type' <<<"$literal_null_absence")" == string && "$(jq -r .versionId <<<"$literal_null_absence")" == null ]] && pass 'absence classifier distinguishes literal null string from null' || fail 'absence classifier distinguishes literal null string from null'
for failure_code in AccessDenied NoSuchBucket S3_FENCE_SDK_ERROR; do
  absence_response="$(HSTAT_ERROR="$failure_code" helper_call "{\"action\":\"verify-absent\",\"bucket\":\"$BUCKET\",\"key\":\"$absent_key\",\"versionId\":\"exact-v1\"}")"
  [[ "$(jq -r .ok <<<"$absence_response")" == false && "$(jq -r .error <<<"$absence_response")" == "$failure_code" ]] && pass "$failure_code is not normalized to absence" || fail "$failure_code is not normalized to absence"
done
for ordinary_head_error in NoSuchKey NotFound; do
  ordinary_head_response="$(HSTAT_ERROR="$ordinary_head_error" helper_call "{\"action\":\"head\",\"key\":\"$absent_key\"}")"
  [[ "$(jq -r .ok <<<"$ordinary_head_response")" == false && "$(jq -r .error <<<"$ordinary_head_response")" == "$ordinary_head_error" ]] && pass "ordinary HEAD preserves $ordinary_head_error failure" || fail "ordinary HEAD preserves $ordinary_head_error failure"
done
[[ "$(helper_call "{\"action\":\"verify-absent\",\"bucket\":\"wrong-bucket\",\"key\":\"$absent_key\",\"versionId\":\"exact-v1\"}"|jq -r .error)" == S3_FENCE_BUCKET_MISMATCH ]] && pass 'absence check rejects a bucket mismatch' || fail 'absence check rejects a bucket mismatch'
[[ "$(HSTAT_MISMATCH=1 helper_call "{\"action\":\"verify-absent\",\"bucket\":\"$BUCKET\",\"key\":\"$absent_key\",\"versionId\":\"exact-v1\"}"|jq -r .error)" == S3_FENCE_VERSION_MISMATCH ]] && pass 'absence check rejects a version mismatch' || fail 'absence check rejects a version mismatch'
[[ "$(HVERSION='null' helper_call "{\"action\":\"head\",\"key\":\"$absent_key\"}"|jq -r .versionId)" == null && "$(HVERSION='null' helper_call "{\"action\":\"head\",\"key\":\"$absent_key\"}"|jq -r '.versionId|type')" == string ]] && pass 'literal null provider version remains a string' || fail 'literal null provider version remains a string'
unusual_version='unusual +&/ id'
[[ "$(HVERSION="$unusual_version" helper_call "{\"action\":\"head\",\"key\":\"$absent_key\"}"|jq -r .versionId)" == "$unusual_version" ]] && pass 'unusual non-empty provider version is preserved' || fail 'unusual non-empty provider version is preserved'
for malformed_version in '""' '{}' '[]' '2' 'false'; do
  [[ "$(HSTAT_JSON="$malformed_version" helper_call "{\"action\":\"head\",\"key\":\"$absent_key\"}"|jq -r .error)" == S3_FENCE_VERSION_ID_INVALID ]] && pass "malformed provider version $malformed_version fails closed" || fail "malformed provider version $malformed_version fails closed"
done
for malformed_request in '{"action":"head","key":"'"$absent_key"'","versionId":""}' '{"action":"head","key":"'"$absent_key"'","versionId":{}}' '{"action":"head","key":"'"$absent_key"'","versionId":[]}' '{"action":"head","key":"'"$absent_key"'","versionId":2}' '{"action":"head","key":"'"$absent_key"'","versionId":false}'; do
  [[ "$(helper_call "$malformed_request"|jq -r .error)" == S3_FENCE_REQUEST_INVALID ]] && pass 'malformed request version ID fails closed' || fail 'malformed request version ID fails closed'
done
printf present >"$T/hstate"; mkdir -m 0700 "$T/helper-object"; printf object >"$T/hobj"
helper_object_response="$(helper_object_get '{"action":"object-get","bucket":"source-bucket","key":"weird / key+%","versionId":"v1","expectedBytes":6,"outputBasename":"actual-object"}')"
object_hash="$(if command -v sha256sum >/dev/null; then sha256sum "$T/helper-object/actual-object"|awk '{print $1}'; else shasum -a 256 "$T/helper-object/actual-object"|awk '{print $1}'; fi)"
[[ "$(jq -r .ok <<<"$helper_object_response")" == true && "$(jq -r .versionId <<<"$helper_object_response")" == v1 && "$(jq -r .sha256 <<<"$helper_object_response")" == "$object_hash" && "$(<"$T/helper-object/actual-object")" == object && "$(mode "$T/helper-object/actual-object")" == 600 && ! -e "$T/app/actual-object" && "$(jq -r .key "$T/hget")" == 'weird / key+%' && "$(jq -r .options.versionId "$T/hget")" == v1 ]] && pass 'helper resolves MinIO from app cwd and streams to configured mount root' || fail 'helper resolves MinIO from app cwd and streams to configured mount root'
helper_current_response="$(helper_object_get '{"action":"object-get","bucket":"source-bucket","key":"current","versionId":null,"expectedBytes":6,"outputBasename":"actual-current"}')"
[[ "$(jq -r .ok <<<"$helper_current_response")" == true && "$(jq -r .versionId <<<"$helper_current_response")" == v1 && "$(jq -r .options.versionId "$T/hget")" == v1 ]] && pass 'helper binds current reads to the observed version' || fail 'helper binds current reads to the observed version'
helper_object_response="$(HVERSION=other helper_object_get '{"action":"object-get","bucket":"source-bucket","key":"pinned","versionId":"v1","expectedBytes":6,"outputBasename":"version-mismatch"}')"
[[ "$(jq -r .error <<<"$helper_object_response")" == S3_FENCE_VERSION_MISMATCH && ! -e "$T/helper-object/version-mismatch" ]] && pass 'helper rejects a pinned version mismatch before output' || fail 'helper rejects a pinned version mismatch before output'
helper_object_response="$(helper_object_get '{"action":"object-get","bucket":"source-bucket","key":"size","versionId":"v1","expectedBytes":5,"outputBasename":"size-mismatch"}')"
[[ "$(jq -r .error <<<"$helper_object_response")" == S3_FENCE_OBJECT_SIZE_MISMATCH && ! -e "$T/helper-object/size-mismatch" ]] && pass 'helper removes its exclusive file on size mismatch' || fail 'helper removes its exclusive file on size mismatch'
helper_object_response="$(HSTREAM_FAIL=1 helper_object_get '{"action":"object-get","bucket":"source-bucket","key":"stream","versionId":"v1","expectedBytes":6,"outputBasename":"stream-failure"}')"
[[ "$(jq -r .ok <<<"$helper_object_response")" == false && ! -e "$T/helper-object/stream-failure" ]] && pass 'helper removes its exclusive file on stream failure' || fail 'helper removes its exclusive file on stream failure'
printf present >"$T/hstate"; (cd "$T/app" && HMISSING=setBucketPolicy NODE_PATH="$T/app/node_modules" HSTATE="$T/hstate" HPOLICY="$T/hpolicy" HOBJ="$T/hobj" HSET="$T/hset" S3_ENDPOINT=https://x S3_ACCESS_KEY=a S3_SECRET_KEY=b S3_BUCKET="$BUCKET" "$NODE_BIN" - "$HELPER" '{"action":"preflight"}' <<'NODE' >"$T/helper-missing"
const fs=require('fs');const[,,f,r]=process.argv;eval(`${fs.readFileSync(f,'utf8')}\nmain(JSON.parse(r)).then(x=>process.stdout.write(JSON.stringify(x)))`);
NODE
)
[[ "$(jq -r .ok "$T/helper-missing")" == false ]] && pass 'helper preflight detects actual missing method' || fail 'helper preflight detects actual missing method'
printf present >"$T/hstate"; [[ "$(helper_call "{\"action\":\"put\",\"key\":\"$key\"}"|jq -r .ok)" == true && "$(helper_call "{\"action\":\"get\",\"key\":\"$key\"}"|jq -r .ok)" == true && "$(helper_call "{\"action\":\"head\",\"key\":\"$key\"}"|jq -r .versionId)" == v1 && "$(helper_call "{\"action\":\"list\",\"key\":\"$key\"}"|jq -r .ok)" == true ]] && pass 'helper authenticated data-plane probes execute' || fail 'helper authenticated data-plane probes execute'
printf unexpected-object >"$T/hobj"; [[ "$(helper_call "{\"action\":\"remove-owned\",\"bucket\":\"$BUCKET\",\"key\":\"$key\",\"versionId\":\"v1\"}"|jq -r .ok)" == false && "$(<"$T/hobj")" == unexpected-object && ! -e "$T/hremoved" ]] && pass 'helper refuses mismatched owned cleanup and preserves object' || fail 'helper refuses mismatched owned cleanup and preserves object'
printf 'BuildingOS recovery-point fence probe: %s\n' "$key" >"$T/hobj"; [[ "$(HVERSION=exact-v1 helper_call "{\"action\":\"remove-owned\",\"bucket\":\"$BUCKET\",\"key\":\"$key\",\"versionId\":\"exact-v1\"}"|jq -r .ok)" == true && "$(jq -r '.bucket' "$T/hremoved")" == "$BUCKET" && "$(jq -r '.key' "$T/hremoved")" == "$key" && "$(jq -r '.options.versionId' "$T/hremoved")" == exact-v1 ]] && pass 'cleanup removes only the verified exact owned version' || fail 'cleanup removes only the verified exact owned version'
helper_call '{"action":"policy-remove"}' >/dev/null; [[ "$(<"$T/hstate")" == absent && ! -s "$T/hset" ]] && pass 'helper removes policy through setBucketPolicy empty string' || fail 'helper removes policy through setBucketPolicy empty string'
((FAIL==0))||exit 1; printf 'PASSED: %s assertions\n' "$PASS"
