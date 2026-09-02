#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly GUARD="$ROOT_DIR/scripts/production-storage-cutover-guard.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-production-storage-guard.XXXXXX")"
readonly ENV_FILE="$TEST_ROOT/production.env"
readonly COMPOSE_FILE="$TEST_ROOT/production-compose.yml"
trap 'rm -rf "$TEST_ROOT"' EXIT

printf '%s\n' 'services: {}' > "$COMPOSE_FILE"

cat > "$TEST_ROOT/bin-docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$1" == 'compose' ]]; then
  printf '%s\n' ${FAKE_COMPOSE_SERVICES:-buildingos-api buildingos-web buildingos-migrate}
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

if [[ "$container" == 'buildingos-minio' && "${FAKE_MINIO_EXISTS:-true}" != 'true' ]]; then
  exit 1
fi

if [[ -z "$format" ]]; then
  exit 0
fi

case "$format" in
  *Config.Env*)
    if [[ "$container" == 'buildingos-api' ]]; then
      printf 'S3_ENDPOINT=%s\n' "${FAKE_CURRENT_ENDPOINT:-http://buildingos-minio:9000}"
    fi
    if [[ "${FAKE_CURRENT_DUPLICATE:-false}" == 'true' && "$container" == 'buildingos-api' ]]; then
      printf 'S3_ENDPOINT=duplicate\n'
    fi
    ;;
  *State.Running*)
    case "$container" in
      buildingos-api) printf '%s\n' "${FAKE_API_RUNNING:-true}" ;;
      buildingos-web) printf '%s\n' "${FAKE_WEB_RUNNING:-true}" ;;
      buildingos-minio) printf '%s\n' "${FAKE_MINIO_RUNNING:-true}" ;;
      *) printf 'false\n' ;;
    esac
    ;;
  *State.Health*)
    case "$container" in
      buildingos-api) printf '%s\n' "${FAKE_API_HEALTH:-healthy}" ;;
      buildingos-web) printf '%s\n' "${FAKE_WEB_HEALTH:-healthy}" ;;
      buildingos-minio) printf '%s\n' "${FAKE_MINIO_HEALTH:-healthy}" ;;
    esac
    ;;
  *'pawtech_public'*)
    if [[ "$container" == 'buildingos-minio' && "${FAKE_PUBLIC_ATTACHED:-true}" == 'true' ]]; then
      printf 'network-id\n'
    fi
    ;;
  *'pawtech_internal'*)
    if [[ "$container" == 'buildingos-minio' && "${FAKE_INTERNAL_ATTACHED:-true}" == 'true' ]]; then
      printf 'network-id\n'
    fi
    ;;
esac
DOCKER
chmod +x "$TEST_ROOT/bin-docker"
export PATH="$TEST_ROOT:$PATH"
ln -s "$TEST_ROOT/bin-docker" "$TEST_ROOT/docker"

write_env() {
  local endpoint="$1"
  local confirmation="${2:-}"
  printf '%s\n' \
    "S3_ENDPOINT=$endpoint" \
    'S3_REGION=default' \
    'S3_ACCESS_KEY=access-value' \
    'S3_SECRET_KEY=secret-value' \
    'S3_BUCKET=buildingos-production' \
    'S3_FORCE_PATH_STYLE=true' \
    'S3_PUBLIC_BASE_URL=https://files.example.invalid' \
    "STORAGE_CUTOVER_CONFIRMATION=$confirmation" > "$ENV_FILE"
}

run_case() {
  local name="$1"
  local expected="$2"
  shift 2
  local output actual

  set +e
  output="$(bash "$GUARD" "$ENV_FILE" "$COMPOSE_FILE" buildingos 2>&1)"
  if [[ "$?" -eq 0 ]]; then actual='PASS'; else actual='FAIL'; fi
  set -e
  [[ "$actual" == "$expected" ]] || {
    printf 'FAIL: %s expected %s, got %s\n%s\n' "$name" "$expected" "$actual" "$output" >&2
    exit 1
  }
  if [[ "$name" == 'secret never emitted' ]]; then
    [[ "$output" != *'secret-value'* ]] || {
      printf 'FAIL: secret value was emitted\n' >&2
      exit 1
    }
  fi
}

export FAKE_API_RUNNING=true FAKE_WEB_RUNNING=true FAKE_MINIO_EXISTS=true FAKE_MINIO_RUNNING=true
export FAKE_API_HEALTH=healthy FAKE_WEB_HEALTH=healthy FAKE_MINIO_HEALTH=healthy
export FAKE_PUBLIC_ATTACHED=true FAKE_INTERNAL_ATTACHED=true
export FAKE_CURRENT_ENDPOINT=http://buildingos-minio:9000 FAKE_COMPOSE_SERVICES='buildingos-api buildingos-web buildingos-migrate'

write_env http://buildingos-minio:9000
run_case 'MINIO to MINIO without confirmation' PASS

FAKE_API_HEALTH=unhealthy
run_case 'MINIO to MINIO API unhealthy' FAIL
export STORAGE_CUTOVER_ALLOW_UNHEALTHY_RETRY=true
run_case 'MINIO to MINIO unhealthy migration retry' PASS
unset STORAGE_CUTOVER_ALLOW_UNHEALTHY_RETRY
FAKE_API_HEALTH=healthy FAKE_WEB_HEALTH=unhealthy
run_case 'MINIO to MINIO web unhealthy' FAIL
FAKE_WEB_HEALTH=healthy

FAKE_PUBLIC_ATTACHED=false
run_case 'MINIO to MINIO requires public MinIO' FAIL

FAKE_PUBLIC_ATTACHED=false
write_env https://usc1.contabostorage.com
run_case 'MINIO to EXTERNAL missing confirmation' FAIL

write_env https://usc1.contabostorage.com STORAGE_02_CONTABO
FAKE_API_RUNNING=true
run_case 'MINIO to EXTERNAL API still running' FAIL

FAKE_API_RUNNING=false FAKE_WEB_RUNNING=false FAKE_PUBLIC_ATTACHED=true
run_case 'MINIO to EXTERNAL public MinIO attached' FAIL

FAKE_PUBLIC_ATTACHED=false FAKE_INTERNAL_ATTACHED=false
run_case 'MINIO to EXTERNAL internal MinIO missing' FAIL

FAKE_INTERNAL_ATTACHED=true
run_case 'MINIO to EXTERNAL barrier valid' PASS

FAKE_CURRENT_ENDPOINT=https://current.example.invalid FAKE_MINIO_EXISTS=false FAKE_API_RUNNING=true FAKE_WEB_RUNNING=true
write_env https://target.example.invalid
FAKE_API_RUNNING=false
run_case 'EXTERNAL to EXTERNAL API stopped unexpectedly' FAIL
FAKE_API_RUNNING=true
write_env https://target.example.invalid
run_case 'EXTERNAL to EXTERNAL without MinIO' PASS

write_env http://buildingos-minio:9000
run_case 'EXTERNAL to MINIO missing rollback confirmation' FAIL

FAKE_API_RUNNING=false
write_env http://buildingos-minio:9000 STORAGE_02_MINIO_ROLLBACK
FAKE_MINIO_EXISTS=true FAKE_PUBLIC_ATTACHED=true
run_case 'EXTERNAL to MINIO rollback barrier valid' PASS

FAKE_CURRENT_ENDPOINT=ftp://unknown.example.invalid
write_env https://target.example.invalid
run_case 'UNKNOWN current provider' FAIL

FAKE_CURRENT_ENDPOINT=https://current.example.invalid
write_env ftp://unknown.example.invalid
run_case 'UNKNOWN target provider' FAIL

write_env https://target.example.invalid
printf '%s\n' \
  'S3_ENDPOINT=https://target.example.invalid' \
  'S3_REGION=default' \
  'S3_SECRET_KEY=secret-value' \
  'S3_BUCKET=buildingos-production' \
  'S3_FORCE_PATH_STYLE=true' \
  'S3_PUBLIC_BASE_URL=https://files.example.invalid' > "$ENV_FILE"
run_case 'missing required external S3 variable' FAIL

write_env https://target.example.invalid
printf '%s\n' 'S3_ENDPOINT=https://duplicate.example.invalid' >> "$ENV_FILE"
run_case 'duplicate storage variable' FAIL

FAKE_CURRENT_ENDPOINT=http://buildingos-minio:9000 FAKE_PUBLIC_ATTACHED=false FAKE_INTERNAL_ATTACHED=true
write_env https://target.example.invalid
run_case 'secret never emitted' FAIL

FAKE_COMPOSE_SERVICES='buildingos-api buildingos-minio'
write_env http://buildingos-minio:9000
run_case 'target Compose owns legacy MinIO' FAIL

printf 'PASS: production storage transition guard matrix and secret-output checks\n'
