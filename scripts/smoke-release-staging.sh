#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_SHA_PATTERN='^[0-9a-f]{40}$'
readonly EXPECTED_ROOT='/opt/pawtech/apps/buildingos-release-staging'
readonly APP_DIR='/opt/pawtech/apps/buildingos-release-staging/buildingos-app'
readonly COMPOSE_PROJECT='buildingos-release-staging'
readonly COMPOSE_FILE='infra/docker/docker-compose.release-staging.yml'
readonly ENV_FILE='/opt/pawtech/env/buildingos-release-staging.env'
readonly LOCAL_API_BASE='http://127.0.0.1:4020'
readonly LOCAL_WEB_BASE='http://127.0.0.1:4021'
readonly PUBLIC_API_BASE='https://buildingos-api-release-staging.31-220-98-21.sslip.io'
readonly PUBLIC_WEB_BASE='https://buildingos-release-staging.31-220-98-21.sslip.io'
readonly MAX_ATTEMPTS=8
readonly ATTEMPT_DELAY_SECONDS=5

usage() {
  printf 'Usage: %s <sha>\n' "${0##*/}" >&2
  exit 64
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

trap 'rc=$?; printf "ERROR: smoke failed at line %s (exit %s)\n" "$LINENO" "$rc" >&2' ERR

validate_sha() {
  local sha="$1"
  [[ "$sha" =~ $EXPECTED_SHA_PATTERN ]] || fail "SHA must be exactly 40 lowercase hex characters"
}

assert_detached_clean_tree() {
  cd "$APP_DIR"
  [[ -d .git ]] || fail "Git repository not found at $APP_DIR"
  test "$(git rev-parse HEAD)" = "$1"
  git symbolic-ref -q HEAD >/dev/null && fail "Repository must be in detached HEAD"
  test -z "$(git status --porcelain --untracked-files=all)"
}

compose_ps_check() {
  local output
  output="$(
    docker compose \
      --project-name "$COMPOSE_PROJECT" \
      --env-file "$ENV_FILE" \
      -f "$COMPOSE_FILE" \
      ps 2>&1
  )"

  printf '%s\n' "$output"

  grep -q 'buildingos-release-staging-api' <<<"$output" || fail "API service missing from compose ps"
  grep -q 'buildingos-release-staging-web' <<<"$output" || fail "Web service missing from compose ps"
  grep -q 'buildingos-release-staging-postgres' <<<"$output" || fail "PostgreSQL service missing from compose ps"
  grep -q 'buildingos-release-staging-redis' <<<"$output" || fail "Redis service missing from compose ps"
  grep -q 'buildingos-release-staging-minio' <<<"$output" || fail "MinIO service missing from compose ps"
  grep -q 'buildingos-release-staging-mailpit' <<<"$output" || fail "Mailpit service missing from compose ps"
}

http_fetch() {
  local label="$1"
  local url="$2"
  local body_file status_code attempt

  body_file="${TMPDIR:-/tmp}/buildingos-smoke-${label//[^a-zA-Z0-9]/_}.$$"
  trap 'rm -f "$body_file"' RETURN

  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    status_code="$(curl --silent --show-error --connect-timeout 5 --max-time 15 --output "$body_file" --write-out '%{http_code}' "$url" || true)"
    if [[ "$status_code" == "200" ]]; then
      printf '%s\n' "$body_file"
      trap - RETURN
      return 0
    fi
    sleep "$ATTEMPT_DELAY_SECONDS"
  done

  fail "$label did not return HTTP 200 after $MAX_ATTEMPTS attempts: $url"
}

check_liveness_json() {
  local label="$1"
  local body_file="$2"

  python3 - "$label" "$body_file" <<'PY'
import json
import pathlib
import sys

label = sys.argv[1]
body = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
payload = json.loads(body)
if payload.get('status') != 'ok':
    raise SystemExit(f"{label}: expected status=ok, got {payload.get('status')!r}")
if not isinstance(payload.get('timestamp'), str) or not payload['timestamp']:
    raise SystemExit(f"{label}: timestamp missing or invalid")
PY
}

check_readiness_json() {
  local label="$1"
  local body_file="$2"

  python3 - "$label" "$body_file" <<'PY'
import json
import pathlib
import sys

label = sys.argv[1]
body = pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')
payload = json.loads(body)
status = payload.get('status')
if status not in {'healthy', 'degraded'}:
    raise SystemExit(f"{label}: expected healthy/degraded readiness, got {status!r}")
if not isinstance(payload.get('timestamp'), str) or not payload['timestamp']:
    raise SystemExit(f"{label}: timestamp missing or invalid")
checks = payload.get('checks')
if not isinstance(checks, dict) or 'database' not in checks or 'email' not in checks or 'storage' not in checks:
    raise SystemExit(f"{label}: readiness checks are incomplete")
PY
}

check_login_html() {
  local label="$1"
  local body_file="$2"
  grep -q 'BuildingOS' "$body_file" || fail "$label should render the BuildingOS login page"
}

main() {
  [[ $# -eq 1 ]] || usage
  local target_sha="$1"
  validate_sha "$target_sha"

  command -v git >/dev/null || fail "git is required"
  command -v curl >/dev/null || fail "curl is required"
  command -v python3 >/dev/null || fail "python3 is required"

  assert_detached_clean_tree "$target_sha"
  compose_ps_check

  local body_file

  body_file="$(http_fetch 'local-api-health' "$LOCAL_API_BASE/health")"
  check_liveness_json 'local-api-health' "$body_file"

  body_file="$(http_fetch 'local-api-ready' "$LOCAL_API_BASE/ready")"
  check_readiness_json 'local-api-ready' "$body_file"

  body_file="$(http_fetch 'local-api-readyz' "$LOCAL_API_BASE/readyz")"
  check_readiness_json 'local-api-readyz' "$body_file"

  body_file="$(http_fetch 'local-web-login' "$LOCAL_WEB_BASE/login")"
  check_login_html 'local-web-login' "$body_file"

  body_file="$(http_fetch 'public-api-health' "$PUBLIC_API_BASE/health")"
  check_liveness_json 'public-api-health' "$body_file"

  body_file="$(http_fetch 'public-web-login' "$PUBLIC_WEB_BASE/login")"
  check_login_html 'public-web-login' "$body_file"

  printf 'Smoke checks passed for %s\n' "$target_sha"
}

main "$@"
