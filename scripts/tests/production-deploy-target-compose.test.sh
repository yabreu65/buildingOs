#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly GUARD="$ROOT_DIR/scripts/production-storage-cutover-guard.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-target-compose.XXXXXX")"
readonly REPO="$TEST_ROOT/current-checkout"
readonly TARGET_TREE="$TEST_ROOT/target-tree"
readonly ENV_FILE="$TEST_ROOT/production.env"
readonly COMPOSE_RELATIVE='infra/docker/docker-compose.production.yml'
readonly TRACE="$TEST_ROOT/docker.trace"
trap 'git -C "$REPO" worktree remove --force "$TARGET_TREE" >/dev/null 2>&1 || true; rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$REPO/infra/docker"
git -C "$REPO" init -q
git -C "$REPO" config core.hooksPath /dev/null
git -C "$REPO" config user.name 'BuildingOS Tests'
git -C "$REPO" config user.email 'tests@buildingos.invalid'
printf '%s\n' 'services:' '  buildingos-minio:' '    image: minio/minio:latest' '  buildingos-api:' '    image: buildingos-api:test' > "$REPO/$COMPOSE_RELATIVE"
git -C "$REPO" add "$COMPOSE_RELATIVE"
git -C "$REPO" commit -qm 'fixture: current production Compose owns MinIO'
readonly CURRENT_SHA="$(git -C "$REPO" rev-parse HEAD)"
printf '%s\n' 'services:' '  buildingos-api:' '    image: buildingos-api:test' > "$REPO/$COMPOSE_RELATIVE"
git -C "$REPO" add "$COMPOSE_RELATIVE"
git -C "$REPO" commit -qm 'fixture: target production Compose externalized'
readonly TARGET_SHA="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" switch --detach -q "$CURRENT_SHA"

current_compose="$(git -C "$REPO" show "$CURRENT_SHA:$COMPOSE_RELATIVE")"
target_compose="$(git -C "$REPO" show "$TARGET_SHA:$COMPOSE_RELATIVE")"
[[ "$current_compose" == *buildingos-minio* ]]
[[ "$target_compose" != *buildingos-minio* ]]

printf '%s\n' \
  'S3_ENDPOINT=http://buildingos-minio:9000' \
  'S3_REGION=default' \
  'S3_ACCESS_KEY=access-value' \
  'S3_SECRET_KEY=secret-value' \
  'S3_BUCKET=buildingos-production' \
  'S3_FORCE_PATH_STYLE=true' \
  'S3_PUBLIC_BASE_URL=https://files.example.invalid' > "$ENV_FILE"

cat > "$TEST_ROOT/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$FAKE_TRACE"

if [[ "$1" == 'compose' ]]; then
  compose_file=''
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == '--file' ]]; then
      compose_file="$2"
      shift 2
      continue
    fi
    shift
  done
  if [[ "$compose_file" == "$TARGET_COMPOSE_FILE" ]]; then
    printf '%s\n' buildingos-api buildingos-web buildingos-migrate
  else
    printf '%s\n' buildingos-minio buildingos-api
  fi
  exit 0
fi

[[ "$1" == 'inspect' ]] || exit 1
if [[ "$2" == '-f' ]]; then
  format="$3"
  container="$4"
else
  format=''
  container="$2"
fi
if [[ "$container" == 'buildingos-minio' ]]; then
  [[ "$format" != '' ]] || exit 0
fi
if [[ "$format" == *Config.Env* ]]; then
  printf '%s\n' 'S3_ENDPOINT=http://buildingos-minio:9000'
elif [[ "$format" == *State.Running* ]]; then
  printf '%s\n' true
elif [[ "$format" == *State.Health* ]]; then
  printf '%s\n' healthy
elif [[ "$format" == *pawtech_public* || "$format" == *pawtech_internal* ]]; then
  printf '%s\n' network-id
fi
DOCKER
chmod +x "$TEST_ROOT/docker"
export PATH="$TEST_ROOT:$PATH" FAKE_TRACE="$TRACE" TARGET_COMPOSE_FILE="$TARGET_TREE/$COMPOSE_RELATIVE"

git -C "$REPO" worktree add --detach -q "$TARGET_TREE" "$TARGET_SHA"
guard_output="$(bash "$GUARD" "$ENV_FILE" "$TARGET_COMPOSE_FILE" buildingos 2>&1)"
[[ "$guard_output" == 'STORAGE_TRANSITION=MINIO:MINIO' ]]
[[ "$(git -C "$REPO" rev-parse HEAD)" == "$CURRENT_SHA" ]]
[[ -z "$(git -C "$REPO" status --porcelain)" ]]
trace_contents="$(<"$TRACE")"
[[ "$trace_contents" == *"$TARGET_COMPOSE_FILE"* ]]
[[ "$trace_contents" != *' build '* ]]
[[ "$trace_contents" != *' migrate '* ]]
[[ "$trace_contents" != *' up '* ]]
[[ "$trace_contents" != *' down '* ]]
[[ "$trace_contents" != *' run '* ]]

git -C "$REPO" worktree remove --force "$TARGET_TREE"
[[ ! -e "$TARGET_TREE" ]]
printf 'PASS: target SHA Compose is validated without moving the current checkout or invoking deployment operations\n'
