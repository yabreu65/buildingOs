#!/usr/bin/env bash
set -Eeuo pipefail
set +x

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "docker is required"

api_container="${API_CONTAINER_NAME:-buildingos-api}"
web_container="${WEB_CONTAINER_NAME:-buildingos-web}"
[[ "$api_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || fail "unsafe API container name"
[[ "$web_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || fail "unsafe Web container name"

container_revision() {
  local container="$1" image_id revision
  image_id="$(docker inspect --type container --format '{{.Image}}' "$container")" || fail "unable to inspect running application container"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "running container image ID is invalid"
  revision="$(docker image inspect "$image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" || fail "unable to inspect running application image"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail "running application revision label is invalid"
  printf '%s\n' "$revision"
}

api_sha="$(container_revision "$api_container")"
web_sha="$(container_revision "$web_container")"
[[ "$api_sha" == "$web_sha" ]] || fail "API and Web deployed revisions disagree"

printf '%s\n' "$api_sha"
