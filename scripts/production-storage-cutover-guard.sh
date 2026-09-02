#!/usr/bin/env bash
set -Eeuo pipefail

readonly REQUIRED_STORAGE_KEYS=(
  S3_ENDPOINT
  S3_REGION
  S3_ACCESS_KEY
  S3_SECRET_KEY
  S3_BUCKET
  S3_FORCE_PATH_STYLE
  S3_PUBLIC_BASE_URL
)

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  return 1
}

usage() {
  printf 'Usage: %s <target_env_file> <compose_file> <project_name>\n' "${0##*/}" >&2
  return 64
}

read_env_value() {
  local file="$1"
  local expected_name="$2"
  local line name value count=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
      continue
    fi
    [[ "$line" == *=* ]] || continue
    name="${line%%=*}"
    value="${line#*=}"
    [[ "$name" == "$expected_name" ]] || continue
    count=$((count + 1))
    [[ "$count" -eq 1 ]] || {
      fail "duplicate storage variable: $expected_name"
      return 1
    }
    printf '%s' "$value"
  done < "$file"

  [[ "$count" -eq 1 ]]
}

read_text_env_value() {
  local text="$1"
  local expected_name="$2"
  local line name value count=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
      continue
    fi
    [[ "$line" == *=* ]] || continue
    name="${line%%=*}"
    value="${line#*=}"
    [[ "$name" == "$expected_name" ]] || continue
    count=$((count + 1))
    [[ "$count" -eq 1 ]] || {
      fail "duplicate API storage variable: $expected_name"
      return 1
    }
    printf '%s' "$value"
  done <<< "$text"

  [[ "$count" -eq 1 ]]
}

provider_from_endpoint() {
  local endpoint="$1"
  local authority host

  [[ "$endpoint" =~ ^https?://[^[:space:]]+$ ]] || {
    printf 'UNKNOWN'
    return 0
  }
  authority="${endpoint#*://}"
  authority="${authority%%/*}"
  host="${authority%%:*}"
  case "$host" in
    minio|buildingos-minio|buildingos-staging-minio|localhost|127.0.0.1)
      printf 'MINIO'
      ;;
    *)
      printf 'EXTERNAL_S3'
      ;;
  esac
}

container_exists() {
  docker inspect "$1" >/dev/null 2>&1
}

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == 'true' ]]
}

container_healthy() {
  [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "$1" 2>/dev/null)" == 'healthy' ]]
}

network_is_attached() {
  local container="$1"
  local network="$2"
  [[ -n "$(docker inspect -f "{{with index .NetworkSettings.Networks \"$network\"}}{{.NetworkID}}{{end}}" "$container" 2>/dev/null)" ]]
}

require_minio_topology() {
  local require_public="$1"

  container_exists buildingos-minio || { fail 'legacy MinIO container is unavailable'; return 1; }
  container_running buildingos-minio || { fail 'legacy MinIO container must be running'; return 1; }
  container_healthy buildingos-minio || { fail 'legacy MinIO container must be healthy'; return 1; }
  network_is_attached buildingos-minio pawtech_internal || { fail 'legacy MinIO must remain attached to pawtech_internal'; return 1; }
  if [[ "$require_public" == 'yes' ]]; then
    network_is_attached buildingos-minio pawtech_public || { fail 'legacy MinIO must remain attached to pawtech_public'; return 1; }
  else
    ! network_is_attached buildingos-minio pawtech_public || { fail 'legacy MinIO must be detached from pawtech_public'; return 1; }
  fi
}

require_stopped_container() {
  local container="$1"
  container_exists "$container" || { fail "$container container is unavailable"; return 1; }
  ! container_running "$container" || { fail "$container must be stopped for storage transition"; return 1; }
}

require_healthy_container() {
  local container="$1"
  container_exists "$container" || { fail "$container container is unavailable"; return 1; }
  container_running "$container" || { fail "$container must be running for a normal deployment"; return 1; }
  container_healthy "$container" || { fail "$container must be healthy for a normal deployment"; return 1; }
}

require_target_storage() {
  local env_file="$1"
  local key value

  [[ -r "$env_file" ]] || { fail 'target production env file is missing or unreadable'; return 1; }
  for key in "${REQUIRED_STORAGE_KEYS[@]}"; do
    value="$(read_env_value "$env_file" "$key")" || {
      fail "required storage variable is missing: $key"
      return 1
    }
    [[ -n "$value" ]] || { fail "required storage variable is empty: $key"; return 1; }
  done

  value="$(read_env_value "$env_file" S3_ENDPOINT)"
  [[ "$value" =~ ^https?://[^[:space:]]+$ ]] || { fail 'S3_ENDPOINT is not a valid HTTP(S) endpoint'; return 1; }
  value="$(read_env_value "$env_file" S3_FORCE_PATH_STYLE)"
  [[ "$value" == 'true' || "$value" == 'false' ]] || { fail 'S3_FORCE_PATH_STYLE must be true or false'; return 1; }
}

require_target_compose_without_legacy_minio() {
  local env_file="$1"
  local compose_file="$2"
  local project_name="$3"
  local service
  local services

  services="$(docker compose --project-name "$project_name" --env-file "$env_file" --file "$compose_file" config --services 2>/dev/null)" || {
    fail 'target production Compose could not be rendered'
    return 1
  }
  while IFS= read -r service; do
    case "$service" in
      buildingos-minio|buildingos-minio-init|minio|createbuckets)
        fail "target production Compose still owns legacy storage service: $service"
        return 1
        ;;
    esac
  done <<< "$services"
}

current_api_endpoint() {
  local api_container="$1"
  local api_env endpoint

  container_exists "$api_container" || return 1
  api_env="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$api_container" 2>/dev/null)" || return 1
  endpoint="$(read_text_env_value "$api_env" S3_ENDPOINT)" || return 1
  [[ -n "$endpoint" ]] || return 1
  printf '%s' "$endpoint"
}

main() {
  local env_file compose_file project_name
  local target_endpoint current_endpoint current_provider target_provider confirmation allow_unhealthy_retry

  [[ $# -eq 3 ]] || { usage; return 64; }
  env_file="$1"
  compose_file="$2"
  project_name="$3"
  allow_unhealthy_retry="${STORAGE_CUTOVER_ALLOW_UNHEALTHY_RETRY:-false}"

  require_target_storage "$env_file" || return 1
  require_target_compose_without_legacy_minio "$env_file" "$compose_file" "$project_name" || return 1

  current_endpoint="$(current_api_endpoint buildingos-api)" || {
    fail 'current API storage endpoint cannot be inspected'
    return 1
  }
  target_endpoint="$(read_env_value "$env_file" S3_ENDPOINT)"
  current_provider="$(provider_from_endpoint "$current_endpoint")"
  target_provider="$(provider_from_endpoint "$target_endpoint")"

  [[ "$current_provider" != 'UNKNOWN' ]] || { fail 'current storage provider is UNKNOWN'; return 1; }
  [[ "$target_provider" != 'UNKNOWN' ]] || { fail 'target storage provider is UNKNOWN'; return 1; }

  case "$current_provider:$target_provider" in
    MINIO:MINIO)
      if [[ "$allow_unhealthy_retry" == 'true' ]]; then
        container_exists buildingos-api || { fail 'API container is unavailable for migration retry'; return 1; }
        container_exists buildingos-web || { fail 'Web container is unavailable for migration retry'; return 1; }
      else
        require_healthy_container buildingos-api || return 1
        require_healthy_container buildingos-web || return 1
      fi
      require_minio_topology yes || return 1
      ;;
    MINIO:EXTERNAL_S3)
      confirmation="$(read_env_value "$env_file" STORAGE_CUTOVER_CONFIRMATION || true)"
      [[ "$confirmation" == 'STORAGE_02_CONTABO' ]] || { fail 'external-storage cutover confirmation is required'; return 1; }
      require_stopped_container buildingos-api || return 1
      require_stopped_container buildingos-web || return 1
      require_minio_topology no || return 1
      ;;
    EXTERNAL_S3:EXTERNAL_S3)
      if [[ "$allow_unhealthy_retry" == 'true' ]]; then
        container_exists buildingos-api || { fail 'API container is unavailable for migration retry'; return 1; }
        container_exists buildingos-web || { fail 'Web container is unavailable for migration retry'; return 1; }
      else
        require_healthy_container buildingos-api || return 1
        require_healthy_container buildingos-web || return 1
      fi
      ;;
    EXTERNAL_S3:MINIO)
      confirmation="$(read_env_value "$env_file" STORAGE_CUTOVER_CONFIRMATION || true)"
      [[ "$confirmation" == 'STORAGE_02_MINIO_ROLLBACK' ]] || { fail 'MinIO rollback confirmation is required'; return 1; }
      require_stopped_container buildingos-api || return 1
      require_minio_topology yes || return 1
      ;;
    *)
      fail "unsupported storage transition: $current_provider to $target_provider"
      return 1
      ;;
  esac

  printf 'STORAGE_TRANSITION=%s:%s\n' "$current_provider" "$target_provider"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
