#!/usr/bin/env bash

production_fence_state_write() {
  local file="$1" status="$2" operation_id="$3" source_sha="$4" image="$5" env_file="$6" network="$7" state_dir="$8" api_was_running="$9" api_quiesced="${10}" completed_at="${11:-}" tmp
  [[ "$file" == /* && ! -L "$file" && -d "${file%/*}" && ! -L "${file%/*}" ]] || return 1
  [[ "$status" =~ ^(FENCE_PREPARED|RECOVERED|NEEDS_MANUAL_RECOVERY)$ ]] || return 1
  [[ "$operation_id" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ && "$source_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ "$image" =~ ^sha256:[0-9a-f]{64}$ && "$env_file" == '/opt/pawtech/env/buildingos.env' && "$network" == 'pawtech_public' ]] || return 1
  [[ "$state_dir" == "${file%/*}" && "$api_was_running" =~ ^(true|false)$ && "$api_quiesced" =~ ^(true|false)$ ]] || return 1
  [[ -z "$completed_at" || "$completed_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1
  tmp="$(mktemp "${file}.tmp.XXXXXX")" || return 1
  umask 077
  jq -n --arg format 'buildingos-recovery-fence-operation/v1' --arg status "$status" --arg operationId "$operation_id" \
    --arg sourceSha "$source_sha" --arg image "$image" --arg envFile "$env_file" --arg network "$network" \
    --arg stateDir "$state_dir" --argjson apiWasRunning "$api_was_running" --argjson apiQuiesced "$api_quiesced" \
    --arg completedAt "$completed_at" \
    '{format:$format,status:$status,operationId:$operationId,sourceSha:$sourceSha,image:$image,envFile:$envFile,network:$network,stateDir:$stateDir,apiWasRunning:$apiWasRunning,apiQuiesced:$apiQuiesced} + (if $completedAt == "" then {} else {completedAtUtc:$completedAt} end)' > "$tmp" || { rm -f -- "$tmp"; return 1; }
  chmod 0600 "$tmp" && mv -f -- "$tmp" "$file" || { rm -f -- "$tmp"; return 1; }
}

production_fence_state_validate() {
  local file="$1"
  [[ -f "$file" && ! -L "$file" && -r "$file" ]] || return 1
  jq -e '
    (keys | sort) as $keys |
    (($keys == ["apiQuiesced","apiWasRunning","completedAtUtc","envFile","format","image","network","operationId","sourceSha","stateDir","status"])
      or ($keys == ["apiQuiesced","apiWasRunning","envFile","format","image","network","operationId","sourceSha","stateDir","status"]))
    and .format == "buildingos-recovery-fence-operation/v1"
    and (.status == "FENCE_PREPARED" or .status == "RECOVERED" or .status == "NEEDS_MANUAL_RECOVERY")
    and (.operationId | type == "string" and test("^[a-z0-9][a-z0-9._-]{0,95}$"))
    and (.sourceSha | type == "string" and test("^[0-9a-f]{40}$"))
    and (.image | type == "string" and test("^sha256:[0-9a-f]{64}$"))
    and .envFile == "/opt/pawtech/env/buildingos.env"
    and .network == "pawtech_public"
    and (.stateDir | type == "string" and startswith("/"))
    and (.apiWasRunning | type == "boolean") and (.apiQuiesced | type == "boolean")
    and ((.completedAtUtc // "") | test("^$|^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
  ' "$file" >/dev/null 2>&1
}
