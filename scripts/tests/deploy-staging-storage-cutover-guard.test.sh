#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy-staging.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-staging-guard.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$TEST_ROOT/bin"

while IFS= read -r service; do
  [[ "$service" != 'minio' ]] || {
    printf 'FAIL: target staging Compose still defines local MinIO\n' >&2
    exit 1
  }
done < <(docker compose --env-file "$ROOT_DIR/infra/docker/.env.staging.example" --file "$ROOT_DIR/infra/docker/docker-compose.staging.yml" config --services)

cat > "$TEST_ROOT/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == 'compose' ]]; then
  if [[ " $* " == *' config --services '* ]]; then
    if [[ "${FAKE_EXTERNAL_TARGET:-}" == 'true' ]]; then
      printf '%s\n' buildingos-api buildingos-web
    else
      printf '%s\n' minio buildingos-api buildingos-web
    fi
  fi
  exit 0
fi
if [[ "$1" == 'inspect' ]]; then
  format="$3"
  container="$4"
  case "$format" in
    '{{range .Config.Env}}{{println .}}{{end}}')
      [[ "$container" == 'buildingos-staging-api' ]] && printf 'S3_ENDPOINT=%s\n' "${FAKE_API_ENDPOINT:-http://minio:9000}"
      ;;
    '{{.State.Running}}')
      if [[ "$container" == 'buildingos-staging-api' ]]; then printf '%s\n' "${FAKE_API_RUNNING:-false}"; else printf 'true\n'; fi
      ;;
    *'pawtech_public'*)
      [[ "${FAKE_PUBLIC_ATTACHED:-false}" == 'true' ]] && printf 'network-id\n'
      ;;
    *'buildingos-staging_buildingos_staging_net'*)
      [[ "${FAKE_INTERNAL_ATTACHED:-true}" == 'true' ]] && printf 'network-id\n'
      ;;
  esac
  exit 0
fi
exit 1
DOCKER
chmod +x "$TEST_ROOT/bin/docker"
export PATH="$TEST_ROOT/bin:$PATH"

source "$DEPLOY_SCRIPT"
readonly ENV_FILE="$TEST_ROOT/staging.env"
readonly compose=(docker compose --project-name buildingos-staging --env-file "$ENV_FILE" --file infra/docker/docker-compose.staging.yml)

run_case() {
  local name="$1"
  local expected="$2"
  shift 2
  export FAKE_CONFIRMATION FAKE_API_RUNNING FAKE_PUBLIC_ATTACHED FAKE_INTERNAL_ATTACHED FAKE_EXTERNAL_TARGET FAKE_API_ENDPOINT
  printf 'STORAGE_CUTOVER_CONFIRMATION=%s\n' "${FAKE_CONFIRMATION:-}" > "$ENV_FILE"
  if require_storage_cutover_preconditions; then
    actual='accept'
  else
    actual='reject'
  fi
  [[ "$actual" == "$expected" ]] || {
    printf 'FAIL: %s expected %s, got %s\n' "$name" "$expected" "$actual" >&2
    exit 1
  }
}

FAKE_EXTERNAL_TARGET=true
FAKE_API_ENDPOINT=http://minio:9000
FAKE_API_RUNNING=false
FAKE_PUBLIC_ATTACHED=false
FAKE_INTERNAL_ATTACHED=true

FAKE_CONFIRMATION='' run_case 'missing confirmation' reject
FAKE_CONFIRMATION=STORAGE_01_CONTABO FAKE_API_RUNNING=true run_case 'API still running' reject
FAKE_API_RUNNING=false FAKE_PUBLIC_ATTACHED=true run_case 'MinIO remains public' reject
FAKE_PUBLIC_ATTACHED=false run_case 'all cutover preconditions' accept

FAKE_EXTERNAL_TARGET=false FAKE_API_RUNNING=true FAKE_PUBLIC_ATTACHED=true run_case 'local-MinIO target bypasses cutover guard' accept
FAKE_EXTERNAL_TARGET=true FAKE_API_ENDPOINT=https://staging.example.invalid FAKE_CONFIRMATION='' run_case 'already external API bypasses cutover guard' accept

printf 'PASS: external-storage cutover guard rejects unsafe states and accepts only the proven barrier state\n'
