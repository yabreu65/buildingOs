#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
COMPOSE_FILE="$ROOT_DIR/infra/docker/docker-compose.yml"
readonly COMPOSE_FILE
RUN_ID="$(date +%s)-$$-${RANDOM}"
readonly RUN_ID
BUCKET="buildingos-privacy-$RUN_ID"
readonly BUCKET
CONTAINER_TMP="/tmp/buildingos-minio-privacy.$RUN_ID"
readonly CONTAINER_TMP
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://127.0.0.1:${MINIO_API_PORT:-9100}}"
readonly MINIO_ENDPOINT
OBJECT_KEY="privacy-probe.txt"
readonly OBJECT_KEY
CONTAINER_TMP_CREATED=0
CLEANUP_BUCKET=0

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

mc_in_container() {
  docker exec buildingos-minio sh -c '
    workdir="$1"
    shift
    mc --config-dir "$workdir/config" "$@"
  ' sh "$CONTAINER_TMP" "$@"
}

cleanup() {
  local original_status=$?
  local cleanup_failed=0
  trap - EXIT

  if (( CLEANUP_BUCKET )); then
    if ! mc_in_container rb --force "privacy/$BUCKET" >/dev/null 2>&1; then
      cleanup_failed=1
    fi
    if mc_in_container ls "privacy/$BUCKET" >/dev/null 2>&1; then
      cleanup_failed=1
    fi
  fi
  if (( CONTAINER_TMP_CREATED )); then
    if ! docker exec buildingos-minio sh -c 'rm -rf -- "$1"' sh "$CONTAINER_TMP" >/dev/null 2>&1 \
      || ! docker exec buildingos-minio sh -c 'test ! -e "$1"' sh "$CONTAINER_TMP" >/dev/null 2>&1; then
      cleanup_failed=1
    fi
  fi

  if (( cleanup_failed )); then
    printf 'FAIL: MinIO privacy integration cleanup could not verify removal of its temporary resources\n' >&2
    if (( original_status == 0 )); then
      original_status=1
    fi
  fi
  exit "$original_status"
}
trap cleanup EXIT

for command_name in docker curl npm; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command unavailable: $command_name"
done

if [[ -z "${MINIO_ROOT_USER:-}" ]]; then
  MINIO_ROOT_USER="$(docker exec buildingos-minio sh -c 'printf %s "$MINIO_ROOT_USER"' 2>/dev/null)" \
    || fail 'MINIO_ROOT_USER was not supplied and could not be read from buildingos-minio'
fi
if [[ -z "${MINIO_ROOT_PASSWORD:-}" ]]; then
  MINIO_ROOT_PASSWORD="$(docker exec buildingos-minio sh -c 'printf %s "$MINIO_ROOT_PASSWORD"' 2>/dev/null)" \
    || fail 'MINIO_ROOT_PASSWORD was not supplied and could not be read from buildingos-minio'
fi
[[ -n "$MINIO_ROOT_USER" && -n "$MINIO_ROOT_PASSWORD" ]] || fail 'MinIO credentials are unavailable'
export MINIO_ROOT_USER MINIO_ROOT_PASSWORD

# The private config and all payloads stay under this per-run container path.
docker exec buildingos-minio sh -c 'umask 077 && mkdir "$1"' sh "$CONTAINER_TMP" \
  || fail 'could not create a unique temporary path in buildingos-minio'
CONTAINER_TMP_CREATED=1

docker exec buildingos-minio sh -c '
  mc --config-dir "$1/config" alias set privacy http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  printf "BuildingOS MinIO privacy probe\\n" > "$1/probe"
' sh "$CONTAINER_TMP" >/dev/null || fail 'could not configure authenticated MinIO access'

# Deliberately omit --ignore-existing: a collision fails and is never cleaned up.
mc_in_container mb "privacy/$BUCKET" >/dev/null || fail 'could not create the unique privacy test bucket'
CLEANUP_BUCKET=1
mc_in_container anonymous set public "privacy/$BUCKET" >/dev/null
mc_in_container cp "$CONTAINER_TMP/probe" "privacy/$BUCKET/$OBJECT_KEY" >/dev/null

anonymous_status() {
  local method="$1" url="$2"
  if [[ "$method" == HEAD ]]; then
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' --head "$url"
  else
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --request "$method" "$url"
  fi
}
OBJECT_URL="${MINIO_ENDPOINT%/}/$BUCKET/$OBJECT_KEY"
LIST_URL="${MINIO_ENDPOINT%/}/$BUCKET?list-type=2"
for method_url in "GET $LIST_URL" "GET $OBJECT_URL" "HEAD $OBJECT_URL"; do
  read -r method url <<< "$method_url"
  [[ "$(anonymous_status "$method" "$url")" == 200 ]] \
    || fail "anonymous $method was not allowed before private-policy remediation"
done

# These values satisfy interpolation only; --no-deps runs only the existing initializer.
export POSTGRES_USER=buildingos_privacy_test
export POSTGRES_PASSWORD=buildingos_privacy_test
export POSTGRES_DB=buildingos_privacy_test
export S3_BUCKET="$BUCKET"
docker compose --env-file /dev/null --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE" \
  run --rm --no-deps createbuckets >/dev/null

for method_url in "GET $LIST_URL" "GET $OBJECT_URL" "HEAD $OBJECT_URL"; do
  read -r method url <<< "$method_url"
  [[ "$(anonymous_status "$method" "$url")" == 403 ]] \
    || fail "anonymous $method was not denied after private-policy remediation"
done

version_info="$(mc_in_container version info "privacy/$BUCKET")"
grep -Eiq '(^|[^[:alpha:]])enabled([^[:alpha:]]|$)' <<< "$version_info" \
  || fail 'bucket versioning is not enabled'

(
  cd "$ROOT_DIR/apps/api"
  env -u DATABASE_URL \
  RUN_MINIO_PRIVACY_INTEGRATION=1 \
  MINIO_PRIVACY_BUCKET="$BUCKET" \
  S3_ENDPOINT="$MINIO_ENDPOINT" \
  S3_PUBLIC_BASE_URL="$MINIO_ENDPOINT" \
  S3_ACCESS_KEY="$MINIO_ROOT_USER" \
  S3_SECRET_KEY="$MINIO_ROOT_PASSWORD" \
  S3_BUCKET="$BUCKET" \
  S3_REGION=us-east-1 \
  S3_FORCE_PATH_STYLE=true \
  NODE_ENV=test \
  npm exec -- jest --runInBand --runTestsByPath src/storage/minio.service.privacy.integration.spec.ts
)

printf 'PASS: temporary bucket was public before remediation and private afterward; authenticated SDK and service checks passed\n'
