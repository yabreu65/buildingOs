#!/usr/bin/env bash
# SDK-only S3 recovery-point fence. Integration supplies the pinned image, protected env file, network, and callbacks.

readonly S3_FENCE_POLICY_PRESENT='POLICY_PRESENT'
readonly S3_FENCE_POLICY_ABSENT='POLICY_ABSENT'
readonly S3_FENCE_PRESIGNED_PUT_EXPIRY_SECONDS=86400
readonly S3_FENCE_OBJECT_STAGING_ROOT_PATH='/recovery-point-object-staging'
s3_fence_error() { printf 'ERROR: %s\n' "$1" >&2; return 1; }
s3_fence_private_file() { [[ ! -L "$1" ]] || { s3_fence_error 'private artifact must not be a symlink'; return 1; }; [[ ! -e "$1" ]] || chmod 0600 "$1" || return 1; (umask 077; : > "$1") && chmod 0600 "$1"; }
s3_fence_private_directory() { [[ ! -e "$1" && ! -L "$1" ]] || { s3_fence_error 'private evidence directory must be new'; return 1; }; (umask 077; mkdir -p "$1") && chmod 0700 "$1"; }
s3_fence_private_readable_file() { local mode; [[ -r "$1" && -f "$1" && ! -L "$1" ]] || return 1; mode="$(stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null)" || return 1; [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#077) == 0 )); }
s3_fence_bucket() { [[ "$1" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; }
s3_fence_image() { [[ "$1" =~ ^sha256:[a-f0-9]{64}$ || "$1" =~ ^[^[:space:]@]+@sha256:[a-f0-9]{64}$ ]]; }
s3_fence_network() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; }
s3_fence_numeric_id() { [[ "$1" =~ ^[0-9]{1,10}$ ]] && (( 10#$1 <= 4294967295 )); }
s3_fence_host_user() { local uid gid; uid="$(id -u)" && gid="$(id -g)" && s3_fence_numeric_id "$uid" && s3_fence_numeric_id "$gid" && printf '%s:%s\n' "$uid" "$gid"; }
s3_fence_callback() { [[ "$1" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] && declare -F "$1" >/dev/null; }
s3_fence_hash() { if command -v sha256sum >/dev/null; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
s3_fence_canonical() { jq -ceS 'if type == "object" and (.Version|type == "string") and (.Statement|type == "array" or type == "object") then . else error("invalid") end' "$1" 2>/dev/null; }
s3_fence_decode() { base64 -d 2>/dev/null || base64 -D; }
s3_fence_new_probe_key() { command -v openssl >/dev/null 2>&1 || { s3_fence_error 'openssl is required for random probe keys'; return 1; }; printf 'buildingos-fence-probe-%s\n' "$(openssl rand -hex 16)"; }
s3_fence_probe_key() { [[ "$1" =~ ^buildingos-fence-probe-[a-f0-9]{32}$ ]]; }
s3_fence_helper_source() { local p="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-point-s3-helper.cjs"; [[ -r "$p" && -f "$p" && ! -L "$p" ]] || return 1; printf '%s\n' "$p"; }

# Source is streamed to node stdin. No target checkout mount and no S3_* value reaches argv or logs.
s3_fence_sdk_invoke() {
  local image="$1" env="$2" network="$3" action="$4" request="$5" output="$6" helper bin b64
  s3_fence_image "$image" && s3_fence_private_readable_file "$env" && s3_fence_network "$network" || { s3_fence_error 'SDK integration arguments are invalid'; return 1; }
  [[ "$action" =~ ^(preflight|policy-get|policy-set|policy-remove|presigned-put|put|get|head|list|verify-owned|remove-owned)$ ]] || return 1
  jq -ce . >/dev/null <<<"$request" 2>/dev/null || return 1
  helper="$(s3_fence_helper_source)" || { s3_fence_error 'trusted S3 helper is unavailable'; return 1; }
  s3_fence_private_file "$output" && s3_fence_private_file "$output.stderr" || return 1
  bin="${S3_FENCE_DOCKER_BIN:-docker}"; command -v "$bin" >/dev/null 2>&1 || return 1
  b64="$(printf '%s' "$request" | base64 | tr -d '\n')" || return 1
  { cat "$helper"; printf "\nmain(JSON.parse(Buffer.from('%s','base64').toString('utf8'))).then((x)=>process.stdout.write(JSON.stringify(x))).catch(()=>process.stdout.write(JSON.stringify({ok:false,error:'S3_FENCE_HELPER_RUNTIME_ERROR'})));\n" "$b64"; } | "$bin" run --rm --interactive --env-file "$env" --network "$network" "$image" node - "$action" > "$output" 2> "$output.stderr" || { s3_fence_error 'SDK helper invocation failed'; return 1; }
  jq -e 'type == "object" and (.ok|type == "boolean")' "$output" >/dev/null 2>&1 || { s3_fence_error 'SDK helper response is invalid'; return 1; }
}
# Object reads use the same trusted stdin helper, but only this action receives a writable private staging mount.
# Object identifiers remain inside the stdin request; Docker argv contains only validated integration values.
s3_fence_object_get() {
  local image="$1" env="$2" network="$3" staging="$4" request="$5" response="$6" helper bin b64 staging_real host_user
  s3_fence_image "$image" && s3_fence_private_readable_file "$env" && s3_fence_network "$network" || { s3_fence_error 'SDK object-get integration arguments are invalid'; return 1; }
  [[ -d "$staging" && ! -L "$staging" ]] || { s3_fence_error 'SDK object-get staging is invalid'; return 1; }
  staging_real="$(cd -P -- "$staging" && pwd -P)" || return 1
  [[ "$staging_real" != *,* && "$staging_real" != *$'\n'* && "$staging_real" != *$'\r'* ]] || { s3_fence_error 'SDK object-get staging is invalid'; return 1; }
  jq -e 'type == "object" and .action == "object-get" and (.outputBasename|type == "string" and test("^(?!\\.{1,2}$)[A-Za-z0-9.][A-Za-z0-9._-]{0,127}$"))' >/dev/null 2>&1 <<<"$request" || return 1
  helper="$(s3_fence_helper_source)" || { s3_fence_error 'trusted S3 helper is unavailable'; return 1; }
  s3_fence_private_file "$response" && s3_fence_private_file "$response.stderr" || return 1
  bin="${S3_FENCE_DOCKER_BIN:-docker}"; command -v "$bin" >/dev/null 2>&1 || return 1
  host_user="$(s3_fence_host_user)" || { s3_fence_error 'SDK object-get host identity is invalid'; return 1; }
  b64="$(printf '%s' "$request" | base64 | tr -d '\n')" || return 1
  { cat "$helper"; printf "\nmain(JSON.parse(Buffer.from('%s','base64').toString('utf8'))).then((x)=>process.stdout.write(JSON.stringify(x))).catch(()=>process.stdout.write(JSON.stringify({ok:false,error:'S3_FENCE_HELPER_RUNTIME_ERROR'})));\n" "$b64"; } | "$bin" run --rm --interactive --env-file "$env" --network "$network" --user "$host_user" --env "S3_FENCE_OBJECT_STAGING_ROOT=$S3_FENCE_OBJECT_STAGING_ROOT_PATH" --mount "type=bind,src=$staging_real,dst=$S3_FENCE_OBJECT_STAGING_ROOT_PATH" --workdir /app "$image" node - object-get > "$response" 2> "$response.stderr" || { s3_fence_error 'SDK object-get helper invocation failed'; return 1; }
  jq -e 'type == "object" and (.ok|type == "boolean")' "$response" >/dev/null 2>&1 || { s3_fence_error 'SDK object-get helper response is invalid'; return 1; }
}
s3_fence_ok() { jq -e '.ok == true' "$1" >/dev/null 2>&1; }
s3_fence_request() { s3_fence_sdk_invoke "$@" && s3_fence_ok "$6"; }
s3_fence_preflight() { s3_fence_sdk_invoke "$1" "$2" "$3" preflight '{"action":"preflight"}' "$4/preflight.json" && jq -e '.ok and .version == "8.0.7" and (.missing|type == "array" and length == 0)' "$4/preflight.json" >/dev/null 2>&1; }
s3_fence_policy_raw_from_response() { local response="$1" output="$2" value; value="$(jq -r '.policyBase64 // empty' "$response")"; [[ -n "$value" ]] || return 1; s3_fence_private_file "$output" && printf '%s' "$value" | s3_fence_decode > "$output" && jq -e . "$output" >/dev/null 2>&1; }
s3_fence_policy_request() { jq -cn --rawfile policy "$1" '{action:"policy-set",policy:$policy}'; }

s3_fence_snapshot_policy() (
  umask 077
  local image="$1" env="$2" network="$3" s="$4" response="$4/policy-get.json" state bucket
  s3_fence_private_directory "$s" || return 1
  s3_fence_request "$image" "$env" "$network" policy-get '{"action":"policy-get"}' "$response" || return 1
  state="$(jq -r .state "$response")"; bucket="$(jq -r .bucket "$response")"; s3_fence_bucket "$bucket" || return 1
  s3_fence_private_file "$s/bucket" && printf '%s\n' "$bucket" > "$s/bucket" || return 1
  case "$state" in
    present)
      s3_fence_policy_raw_from_response "$response" "$s/policy.raw.json" || { s3_fence_error 'exact policy bytes are invalid'; return 1; }
      s3_fence_private_file "$s/policy.raw.sha256" && s3_fence_hash "$s/policy.raw.json" > "$s/policy.raw.sha256" || return 1
      s3_fence_private_file "$s/policy.canonical.json" && s3_fence_canonical "$s/policy.raw.json" > "$s/policy.canonical.json" || return 1
      s3_fence_private_file "$s/policy.canonical.sha256" && s3_fence_hash "$s/policy.canonical.json" > "$s/policy.canonical.sha256" || return 1
      s3_fence_private_file "$s/state" && printf '%s\n' "$S3_FENCE_POLICY_PRESENT" > "$s/state" ;;
    absent) s3_fence_private_file "$s/state" && printf '%s\n' "$S3_FENCE_POLICY_ABSENT" > "$s/state" ;;
    *) return 1 ;;
  esac
)
s3_fence_verify_snapshot() { local s="$1" state; [[ -r "$s/state" && -r "$s/bucket" ]] && s3_fence_bucket "$(<"$s/bucket")" || return 1; state="$(<"$s/state")"; if [[ "$state" == "$S3_FENCE_POLICY_ABSENT" ]]; then [[ ! -e "$s/policy.raw.json" ]]; else [[ "$state" == "$S3_FENCE_POLICY_PRESENT" && -r "$s/policy.raw.json" && -r "$s/policy.raw.sha256" && -r "$s/policy.canonical.json" ]] && [[ "$(s3_fence_hash "$s/policy.raw.json")" == "$(<"$s/policy.raw.sha256")" ]] && cmp -s "$s/policy.canonical.json" <(s3_fence_canonical "$s/policy.raw.json"); fi; }
s3_fence_build_temporary_deny() {
  local s="$1" resource state; s3_fence_verify_snapshot "$s" || return 1; resource="arn:aws:s3:::$(<"$s/bucket")/*"; state="$(<"$s/state")"
  s3_fence_private_file "$s/temporary-policy.raw.json" || return 1
  if [[ "$state" == "$S3_FENCE_POLICY_PRESENT" ]]; then jq --arg r "$resource" '.Statement=(if (.Statement|type)=="array" then .Statement else [.Statement] end + [{Sid:"BuildingOSObjectBackupTemporaryWriteDeny",Effect:"Deny",Principal:"*",Action:["s3:PutObject","s3:DeleteObject","s3:DeleteObjectVersion","s3:AbortMultipartUpload"],Resource:$r}])' "$s/policy.raw.json" > "$s/temporary-policy.raw.json"; else jq -cn --arg r "$resource" '{Version:"2012-10-17",Statement:[{Sid:"BuildingOSObjectBackupTemporaryWriteDeny",Effect:"Deny",Principal:"*",Action:["s3:PutObject","s3:DeleteObject","s3:DeleteObjectVersion","s3:AbortMultipartUpload"],Resource:$r}]}' > "$s/temporary-policy.raw.json"; fi || return 1
  s3_fence_private_file "$s/temporary-policy.canonical.json" && s3_fence_canonical "$s/temporary-policy.raw.json" > "$s/temporary-policy.canonical.json" && s3_fence_private_file "$s/temporary-policy.canonical.sha256" && s3_fence_hash "$s/temporary-policy.canonical.json" > "$s/temporary-policy.canonical.sha256"
}
s3_fence_current_policy() { local image="$1" env="$2" network="$3" s="$4" name="$5" response="$4/$5.response.json"; s3_fence_request "$image" "$env" "$network" policy-get '{"action":"policy-get"}' "$response" || return 1; [[ "$(jq -r .state "$response")" == present ]] || return 2; s3_fence_policy_raw_from_response "$response" "$4/$5.raw.json"; }
s3_fence_current_matches_semantic() { s3_fence_current_policy "$1" "$2" "$3" "$4" current || return 1; cmp -s "$4/temporary-policy.canonical.json" <(s3_fence_canonical "$4/current.raw.json"); }
s3_fence_original_verified() { local state="$(<"$4/state")"; if [[ "$state" == "$S3_FENCE_POLICY_ABSENT" ]]; then s3_fence_current_policy "$1" "$2" "$3" "$4" original >/dev/null 2>&1; [[ $? -eq 2 ]]; else s3_fence_current_policy "$1" "$2" "$3" "$4" original && cmp -s "$4/policy.raw.json" "$4/original.raw.json"; fi; }
s3_fence_apply_temporary_deny() {
  local image="$1" env="$2" network="$3" s="$4" request; S3_FENCE_APPLY_STATE=unknown; s3_fence_build_temporary_deny "$s" || return 1; request="$(s3_fence_policy_request "$s/temporary-policy.raw.json")" || return 1
  if s3_fence_request "$image" "$env" "$network" policy-set "$request" "$s/policy-set.json" && s3_fence_current_matches_semantic "$image" "$env" "$network" "$s"; then S3_FENCE_APPLY_STATE=temporary; return 0; fi
  if s3_fence_current_matches_semantic "$image" "$env" "$network" "$s"; then S3_FENCE_APPLY_STATE=temporary; return 1; fi
  if s3_fence_original_verified "$image" "$env" "$network" "$s"; then S3_FENCE_APPLY_STATE=original; return 1; fi
  return 1
}
s3_fence_restore_policy() {
  local image="$1" env="$2" network="$3" s="$4" state request
  s3_fence_verify_snapshot "$s" || return 1
  # Never overwrite a concurrently changed policy: original is already restored; only our observed fence may mutate.
  if s3_fence_original_verified "$image" "$env" "$network" "$s"; then return 0; fi
  s3_fence_current_matches_semantic "$image" "$env" "$network" "$s" || { s3_fence_error 'current policy is neither the original snapshot nor this recovery fence'; return 1; }
  state="$(<"$s/state")"
  if [[ "$state" == "$S3_FENCE_POLICY_PRESENT" ]]; then
    request="$(s3_fence_policy_request "$s/policy.raw.json")" || return 1
    s3_fence_request "$image" "$env" "$network" policy-set "$request" "$s/policy-restore.json" || true
  else
    # minio-js 8.0.7 documents setBucketPolicy(bucket, '') as the DELETE ?policy operation.
    s3_fence_request "$image" "$env" "$network" policy-remove '{"action":"policy-remove"}' "$s/policy-remove.json" || true
  fi
  s3_fence_original_verified "$image" "$env" "$network" "$s" || { s3_fence_error 'exact policy restoration is unverified'; return 1; }
}

s3_fence_presigned_put() { local image="$1" env="$2" network="$3" key="$4" e="$5" request url config="$5/presigned.curl.conf" body="$5/probe-body" output="$5/presigned.response" status bin; s3_fence_probe_key "$key" || return 1; request="$(jq -cn --arg key "$key" '{action:"presigned-put",key:$key,expirySeconds:86400}')"; s3_fence_request "$image" "$env" "$network" presigned-put "$request" "$e/presigned.json" || return 1; url="$(jq -r '.url // empty' "$e/presigned.json")"; [[ "$url" =~ ^https://[^[:space:]\"]+$ ]] || return 1; s3_fence_private_file "$body" && printf 'BuildingOS recovery-point fence probe: %s\n' "$key" > "$body" && s3_fence_private_file "$config" && printf 'url = "%s"\n' "$url" > "$config" && s3_fence_private_file "$output" && s3_fence_private_file "$output.stderr" || return 1; bin="${S3_FENCE_CURL_BIN:-curl}"; status="$("$bin" --config "$config" --silent --show-error --request PUT --data-binary "@$body" --output "$output" --write-out '%{http_code}' 2> "$output.stderr")" || return 1; S3_FENCE_HTTP="$status"; }
s3_fence_probe() { local request; request="$(jq -cn --arg action "$4" --arg key "$5" --argjson versionId "${7:-null}" '{action:$action,key:$key,versionId:$versionId}')" || return 1; s3_fence_sdk_invoke "$1" "$2" "$3" "$4" "$request" "$6"; }
s3_fence_owned() { s3_fence_probe "$1" "$2" "$3" verify-owned "$4" "$6" "${5:-null}" && s3_fence_ok "$6"; }
s3_fence_cleanup_owned() { s3_fence_owned "$1" "$2" "$3" "$4" "$5" "$6" && s3_fence_probe "$1" "$2" "$3" remove-owned "$4" "$7" "$5" && s3_fence_ok "$7"; }

# capture callback runs only while the temporary deny is server-observed. Quiesce/resume preserve the prior API state.
s3_fence_run_recovery_point() {
  local image="$1" env="$2" network="$3" e="$4" quiesce="$5" capture="$6" resume="$7" s key post_key pre_meta="$4/pre-owned.json" post_meta="$4/post-owned.json"
  s3_fence_callback "$quiesce" && s3_fence_callback "$capture" && s3_fence_callback "$resume" || return 1
  s3_fence_private_directory "$e" || return 1; s3_fence_preflight "$image" "$env" "$network" "$e" || return 1; s="$e/policy-snapshot"; s3_fence_snapshot_policy "$image" "$env" "$network" "$s" || return 1
  key="$(s3_fence_new_probe_key)" && s3_fence_presigned_put "$image" "$env" "$network" "$key" "$e" && [[ "$S3_FENCE_HTTP" == 200 ]] && s3_fence_probe "$image" "$env" "$network" head "$key" "$pre_meta" null && s3_fence_ok "$pre_meta" || return 1
  "$quiesce" || return 1
  if ! s3_fence_apply_temporary_deny "$image" "$env" "$network" "$s"; then
    if [[ "$S3_FENCE_APPLY_STATE" == original ]] || s3_fence_original_verified "$image" "$env" "$network" "$s"; then "$resume"; return 1; fi
    s3_fence_restore_policy "$image" "$env" "$network" "$s" && "$resume"; return 1
  fi
  if ! s3_fence_probe "$image" "$env" "$network" put "$key" "$e/fence-put.json" null || ! jq -e '.ok==false and .error=="AccessDenied"' "$e/fence-put.json" >/dev/null || ! s3_fence_probe "$image" "$env" "$network" remove-owned "$key" "$e/fence-delete.json" null || ! jq -e '.ok==false and .error=="AccessDenied"' "$e/fence-delete.json" >/dev/null || ! s3_fence_probe "$image" "$env" "$network" get "$key" "$e/fence-get.json" null || ! s3_fence_ok "$e/fence-get.json" || ! s3_fence_probe "$image" "$env" "$network" head "$key" "$e/fence-head.json" null || ! s3_fence_ok "$e/fence-head.json" || ! s3_fence_probe "$image" "$env" "$network" list "$key" "$e/fence-list.json" null || ! s3_fence_ok "$e/fence-list.json" || ! s3_fence_presigned_put "$image" "$env" "$network" "$key" "$e" || ! [[ "$S3_FENCE_HTTP" == 403 ]] || ! grep -Fq '<Code>AccessDenied</Code>' "$e/presigned.response" || ! "$capture"; then s3_fence_restore_policy "$image" "$env" "$network" "$s" && "$resume"; return 1; fi
  s3_fence_restore_policy "$image" "$env" "$network" "$s" || return 1
  post_key="$(s3_fence_new_probe_key)"
  if ! s3_fence_probe "$image" "$env" "$network" put "$post_key" "$post_meta" null || ! s3_fence_ok "$post_meta"; then "$resume"; return 1; fi
  if ! s3_fence_cleanup_owned "$image" "$env" "$network" "$key" "$(jq -c '.versionId' "$pre_meta")" "$e/cleanup-pre-head.json" "$e/cleanup-pre.json" || ! s3_fence_cleanup_owned "$image" "$env" "$network" "$post_key" "$(jq -c '.versionId' "$post_meta")" "$e/cleanup-post-head.json" "$e/cleanup-post.json"; then "$resume"; return 1; fi
  "$resume"
}
