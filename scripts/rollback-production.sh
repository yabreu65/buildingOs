#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
# shellcheck source=scripts/production-security-validate.sh
source "$SCRIPT_DIR/production-security-validate.sh"
readonly RELEASE_A_PORTABLE_STAT_LIBRARY="$SCRIPT_DIR/lib/recovery-point-portable-stat.sh"
[[ -f "$RELEASE_A_PORTABLE_STAT_LIBRARY" && ! -L "$RELEASE_A_PORTABLE_STAT_LIBRARY" ]] || {
  printf 'ERROR: trusted portable stat helper is missing or invalid\n' >&2
  exit 1
}
# shellcheck source=scripts/lib/recovery-point-portable-stat.sh
source "$RELEASE_A_PORTABLE_STAT_LIBRARY"

usage() {
  printf 'Usage: %s <expected_current_sha> <previous_sha> <previous_api_digest> <previous_web_digest> <compatibility_receipt> <api_health_url> <api_readyz_url> <web_login_url>\n' "${0##*/}" >&2
  exit 64
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

ROLLBACK_API_WAS_RUNNING=false
ROLLBACK_API_QUIESCED=false
ROLLBACK_RECREATE_STARTED=false
ROLLBACK_BARRIER_ACTIVE=false
ROLLBACK_CONTROL_DIR='/opt/pawtech/apps/buildingos/release-control'
ROLLBACK_SENTINEL="$ROLLBACK_CONTROL_DIR/CLOSED"
ROLLBACK_RECORD_SUCCESS=false
PHASE='preflight'
ROLLBACK_FROM_API_DIGEST=''
ROLLBACK_FROM_WEB_DIGEST=''
ROLLBACK_RECOVERY_POINT_ID='NOT_EVALUATED'
ROLLBACK_RECOVERY_POINT_RECEIPT_PATH='NOT_EVALUATED'
ROLLBACK_RECOVERY_POINT_BUNDLE_PATH='NOT_EVALUATED'
ROLLBACK_RECOVERY_POINT_RECEIPT_SHA256='NOT_EVALUATED'
ROLLBACK_RECOVERY_POINT_SOURCE_SHA='NOT_EVALUATED'
ROLLBACK_RECOVERY_POINT_REMOTE_ROOT='NOT_EVALUATED'

ensure_rollback_barrier() {
  local temporary_sentinel
  ROLLBACK_BARRIER_ACTIVE=true
  [[ -d /opt/pawtech/apps/buildingos && ! -L /opt/pawtech/apps/buildingos ]] || return 1
  if [[ -e "$ROLLBACK_CONTROL_DIR" || -L "$ROLLBACK_CONTROL_DIR" ]]; then
    [[ -d "$ROLLBACK_CONTROL_DIR" && ! -L "$ROLLBACK_CONTROL_DIR" ]] || return 1
  else
    install -d -m 711 "$ROLLBACK_CONTROL_DIR" || return 1
  fi
  chmod 711 "$ROLLBACK_CONTROL_DIR" || return 1
  [[ "$(recovery_point_portable_stat_mode "$ROLLBACK_CONTROL_DIR")" == 711 ]] || return 1
  if [[ -e "$ROLLBACK_SENTINEL" || -L "$ROLLBACK_SENTINEL" ]]; then
    [[ -f "$ROLLBACK_SENTINEL" && ! -L "$ROLLBACK_SENTINEL" ]] || return 1
  else
    temporary_sentinel="$(mktemp "$ROLLBACK_CONTROL_DIR/.CLOSED.XXXXXX")" || return 1
    chmod 600 "$temporary_sentinel" || return 1
    mv -n -- "$temporary_sentinel" "$ROLLBACK_SENTINEL" || return 1
  fi
  [[ -f "$ROLLBACK_SENTINEL" && ! -L "$ROLLBACK_SENTINEL" ]] || return 1
  chmod 600 "$ROLLBACK_SENTINEL" || return 1
  [[ "$(recovery_point_portable_stat_mode "$ROLLBACK_SENTINEL")" == 600 ]] || return 1
  ROLLBACK_BARRIER_ACTIVE=true
}

probe_rollback_runtime_barrier() {
  local expected_state="$1"
  docker exec --user 1001:1001 buildingos-api node -e '
const fs = require("node:fs");
const path = require("node:path");
const fail = (message) => { console.error(message); process.exit(1); };
const sentinel = process.env.RELEASE_A_WRITE_BARRIER_PATH;
if (process.env.RELEASE_A_WRITE_BARRIER_ENABLED !== "true") fail("barrier is not enabled");
if (process.getuid() !== 1001 || process.getgid() !== 1001) fail("unexpected API UID/GID");
if (!sentinel) fail("barrier sentinel path is missing");
const parent = path.dirname(sentinel);
const parentStat = fs.lstatSync(parent);
if (!parentStat.isDirectory()) fail("barrier parent is not a directory");
fs.accessSync(parent, fs.constants.X_OK);
let state;
try { fs.lstatSync(sentinel); state = "CLOSED"; }
catch (error) { if (error && error.code === "ENOENT") state = "OPEN"; else throw error; }
if (state !== process.argv[1]) fail(`expected ${process.argv[1]}, observed ${state}`);
' "$expected_state"
}

remove_release_a_barrier() {
  [[ "$ROLLBACK_BARRIER_ACTIVE" == true && -f "$ROLLBACK_SENTINEL" && ! -L "$ROLLBACK_SENTINEL" ]] || return 1
  [[ "$(recovery_point_portable_stat_mode "$ROLLBACK_CONTROL_DIR")" == 711 ]] || return 1
  [[ "$(recovery_point_portable_stat_mode "$ROLLBACK_SENTINEL")" == 600 ]] || return 1
  rm -f -- "$ROLLBACK_SENTINEL" || return 1
  [[ ! -e "$ROLLBACK_SENTINEL" && ! -L "$ROLLBACK_SENTINEL" ]] || return 1
}

rollback_fail_closed() {
  ensure_rollback_barrier || printf 'ERROR: rollback write barrier could not be proven closed.\n' >&2
  docker stop --timeout 30 buildingos-api buildingos-web >/dev/null 2>&1 || true
  if [[ "$(docker inspect --format '{{.State.Running}}' buildingos-api 2>/dev/null || true)" != false \
    || "$(docker inspect --format '{{.State.Running}}' buildingos-web 2>/dev/null || true)" != false ]]; then
    printf 'ERROR: rollback application stop state is uncertain; operator intervention is required.\n' >&2
  fi
}

rollback_exit() {
  local rc=$?
  trap - EXIT
  if [[ "$ROLLBACK_BARRIER_ACTIVE" == true && "$ROLLBACK_RECORD_SUCCESS" != true ]]; then
    rollback_fail_closed || true
    if [[ "$ROLLBACK_API_QUIESCED" == true ]]; then
      write_rollback_record FAILED || true
    fi
  fi
  exit "$rc"
}
trap rollback_exit EXIT

publish_current_successful_selector() {
  local deployments_dir="$1" record="$2" target_sha="$3" selector="$4" temporary_selector
  [[ "$record" == "$deployments_dir/"* && "$target_sha" =~ ^[0-9a-f]{40}$ && "$selector" == "$deployments_dir/current-successful-deployment.v1" ]] || return 1
  temporary_selector="$(mktemp "$deployments_dir/.current-successful-deployment.v1.tmp.XXXXXX")" || return 1
  {
    printf 'format=buildingos-current-successful-deployment/v1\n'
    printf 'record_path=%s\n' "$record"
    printf 'target_sha=%s\n' "$target_sha"
  } > "$temporary_selector" || return 1
  chmod 600 "$temporary_selector" || return 1
  mv -f -- "$temporary_selector" "$selector"
}

reset_rollback_recovery_point() {
  ROLLBACK_RECOVERY_POINT_ID='NOT_EVALUATED'
  ROLLBACK_RECOVERY_POINT_RECEIPT_PATH='NOT_EVALUATED'
  ROLLBACK_RECOVERY_POINT_BUNDLE_PATH='NOT_EVALUATED'
  ROLLBACK_RECOVERY_POINT_RECEIPT_SHA256='NOT_EVALUATED'
  ROLLBACK_RECOVERY_POINT_SOURCE_SHA='NOT_EVALUATED'
  ROLLBACK_RECOVERY_POINT_REMOTE_ROOT='NOT_EVALUATED'
}

strict_record_value() {
  local record="$1" key="$2"

  awk -F '=' -v key="$key" '
    $1 == key { value=substr($0, index($0, "=") + 1); count++; }
    END { if (count != 1 || value == "") exit 1; print value }
  ' "$record"
}

record_key_count() {
  local record="$1" key="$2"

  awk -F '=' -v key="$key" '$1 == key { count++ } END { print count + 0 }' "$record"
}

record_matches_prior_runtime_identity() {
  local record="$1" target_sha="$2" api_digest="$3" web_digest="$4"
  local status record_target new_api_count new_web_count rollback_api_count rollback_web_count record_api record_web

  [[ -f "$record" && ! -L "$record" && -r "$record" ]] || return 1
  status="$(strict_record_value "$record" status)" || return 1
  record_target="$(strict_record_value "$record" target_sha)" || return 1
  [[ "$status" == SUCCESS && "$record_target" == "$target_sha" ]] || return 1

  new_api_count="$(record_key_count "$record" new_api_digest)"
  new_web_count="$(record_key_count "$record" new_web_digest)"
  rollback_api_count="$(record_key_count "$record" api_digest)"
  rollback_web_count="$(record_key_count "$record" web_digest)"
  if [[ "$new_api_count" == 1 && "$new_web_count" == 1 && "$rollback_api_count" == 0 && "$rollback_web_count" == 0 ]]; then
    record_api="$(strict_record_value "$record" new_api_digest)" || return 1
    record_web="$(strict_record_value "$record" new_web_digest)" || return 1
  elif [[ "$new_api_count" == 0 && "$new_web_count" == 0 && "$rollback_api_count" == 1 && "$rollback_web_count" == 1 ]]; then
    record_api="$(strict_record_value "$record" api_digest)" || return 1
    record_web="$(strict_record_value "$record" web_digest)" || return 1
  else
    return 1
  fi
  [[ "$record_api" == "$api_digest" && "$record_web" == "$web_digest" ]]
}

copy_strict_recovery_binding_from_record() {
  local record="$1"
  local recovery_id receipt bundle receipt_hash source_sha remote_root

  recovery_id="$(strict_record_value "$record" recovery_point_id)" || return 1
  receipt="$(strict_record_value "$record" recovery_point_receipt_path)" || return 1
  bundle="$(strict_record_value "$record" recovery_point_bundle_path)" || return 1
  receipt_hash="$(strict_record_value "$record" recovery_point_receipt_sha256)" || return 1
  source_sha="$(strict_record_value "$record" recovery_point_source_sha)" || return 1
  remote_root="$(strict_record_value "$record" recovery_point_remote_root)" || return 1
  [[ "$recovery_id" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ && "$receipt_hash" =~ ^[0-9a-f]{64}$ && "$source_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ "$bundle" =~ ^/[A-Za-z0-9._/-]+$ && "$bundle" != *'//' && "$bundle" != *'/./'* && "$bundle" != *'/../'* && "$bundle" != */ ]] || return 1
  [[ "$receipt" == "$bundle/metadata/recovery-point-receipt.json" ]] || return 1
  [[ "$remote_root" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9._/-]+$ && "$remote_root" != *'//' && "$remote_root" != *'/./'* && "$remote_root" != *'/../'* ]] || return 1

  ROLLBACK_RECOVERY_POINT_ID="$recovery_id"
  ROLLBACK_RECOVERY_POINT_RECEIPT_PATH="$receipt"
  ROLLBACK_RECOVERY_POINT_BUNDLE_PATH="$bundle"
  ROLLBACK_RECOVERY_POINT_RECEIPT_SHA256="$receipt_hash"
  ROLLBACK_RECOVERY_POINT_SOURCE_SHA="$source_sha"
  ROLLBACK_RECOVERY_POINT_REMOTE_ROOT="$remote_root"
}

# Bind only one complete prior recovery proof; discovery order never selects a record.
bind_unique_prior_success_recovery_point() {
  local deployments_dir="$1" record
  local matching_records=0 valid_bindings=0 malformed_binding=false

  reset_rollback_recovery_point
  [[ -d "$deployments_dir" && ! -L "$deployments_dir" ]] || return 1
  while IFS= read -r -d '' record; do
    if record_matches_prior_runtime_identity "$record" "$PREVIOUS_SHA" "$PREVIOUS_API_DIGEST" "$PREVIOUS_WEB_DIGEST"; then
      matching_records=$((matching_records + 1))
      if copy_strict_recovery_binding_from_record "$record"; then
        valid_bindings=$((valid_bindings + 1))
      else
        malformed_binding=true
      fi
    fi
  done < <(find "$deployments_dir" -mindepth 1 -maxdepth 1 -type f -print0)

  if [[ "$matching_records" == 1 && "$valid_bindings" == 1 && "$malformed_binding" == false ]]; then
    return 0
  fi
  reset_rollback_recovery_point
  return 1
}

rollback_compose_config_preflight() {
  local expected_current_sha="$1"
  shift
  export IMAGE_TAG="$expected_current_sha"
  export BUILD_REVISION="$expected_current_sha"
  "$@" config --quiet
}

write_rollback_record() {
  local status="$1"
  local temporary_record

  install -d -m 700 "$(dirname "$RECORD")"
  umask 077
  temporary_record="$(mktemp "${RECORD}.tmp.XXXXXX")" || fail 'Unable to create rollback record'
  if ! {
    printf 'timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'status=%s\n' "$status"
    printf 'phase=%s\n' "$PHASE"
    printf 'from_sha=%s\n' "$EXPECTED_CURRENT_SHA"
    printf 'from_api_digest=%s\n' "$ROLLBACK_FROM_API_DIGEST"
    printf 'from_web_digest=%s\n' "$ROLLBACK_FROM_WEB_DIGEST"
    printf 'target_sha=%s\n' "$PREVIOUS_SHA"
    printf 'previous_sha=%s\n' "$PREVIOUS_SHA"
    printf 'api_digest=%s\n' "$PREVIOUS_API_DIGEST"
    printf 'web_digest=%s\n' "$PREVIOUS_WEB_DIGEST"
    printf 'migration_count=%s\n' "$migration_count"
    printf 'recovery_point_id=%s\n' "$ROLLBACK_RECOVERY_POINT_ID"
    printf 'recovery_point_receipt_path=%s\n' "$ROLLBACK_RECOVERY_POINT_RECEIPT_PATH"
    printf 'recovery_point_bundle_path=%s\n' "$ROLLBACK_RECOVERY_POINT_BUNDLE_PATH"
    printf 'recovery_point_receipt_sha256=%s\n' "$ROLLBACK_RECOVERY_POINT_RECEIPT_SHA256"
    printf 'recovery_point_source_sha=%s\n' "$ROLLBACK_RECOVERY_POINT_SOURCE_SHA"
    printf 'recovery_point_remote_root=%s\n' "$ROLLBACK_RECOVERY_POINT_REMOTE_ROOT"
    printf 'rollback_compatibility_basis=%s\n' "$ROLLBACK_COMPATIBILITY_BASIS"
    printf 'database_changed=no\n'
    printf 'database_restore=never-automatic\n'
  } > "$temporary_record"; then
    rm -f -- "$temporary_record"
    fail 'Unable to write rollback record'
  fi
  chmod 600 "$temporary_record" || {
    rm -f -- "$temporary_record"
    fail 'Unable to secure rollback record'
  }
  mv -f -- "$temporary_record" "$RECORD" || {
    rm -f -- "$temporary_record"
    fail 'Unable to publish rollback record'
  }
}

if [[ "${BUILDINGOS_ROLLBACK_SELECTOR_LIBRARY_ONLY:-false}" == true && "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

[[ $# -eq 8 ]] || usage
readonly EXPECTED_CURRENT_SHA="$1"
readonly PREVIOUS_SHA="$2"
readonly PREVIOUS_API_DIGEST="$3"
readonly PREVIOUS_WEB_DIGEST="$4"
readonly RECEIPT="$5"
readonly API_HEALTH_URL="$6"
readonly API_READYZ_URL="$7"
readonly WEB_LOGIN_URL="$8"
readonly APP_DIR='/opt/pawtech/apps/buildingos/buildingos-app'
readonly PRODUCTION_ROOT='/opt/pawtech/apps/buildingos'
readonly COMPOSE_FILE='infra/docker/docker-compose.production.yml'
readonly ENV_FILE='/opt/pawtech/env/buildingos.env'
readonly POSTGRES_CONTAINER='pawtech-postgres'
readonly DEPLOYMENTS_DIR="$PRODUCTION_ROOT/deployments"
readonly CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR="$DEPLOYMENTS_DIR/current-successful-deployment.v1"
RECORD="$DEPLOYMENTS_DIR/rollback-$(date -u +%Y%m%dT%H%M%SZ)-$PREVIOUS_SHA.txt"
readonly RECORD

for sha in "$EXPECTED_CURRENT_SHA" "$PREVIOUS_SHA"; do
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "Every SHA must be exactly 40 lowercase hexadecimal characters"
done
for digest in "$PREVIOUS_API_DIGEST" "$PREVIOUS_WEB_DIGEST"; do
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Every image digest must be immutable"
done
validate_rollback_receipt \
  "$RECEIPT" \
  "$EXPECTED_CURRENT_SHA" \
  "$PREVIOUS_SHA" \
  "$PREVIOUS_API_DIGEST" \
  "$PREVIOUS_WEB_DIGEST"
readonly migration_count="$VALIDATED_ROLLBACK_MIGRATION_COUNT"
[[ "$migration_count" == 107 ]] || fail 'Application rollback requires the verified DB107 compatibility contract'
MIGRATION_TARGET_APPLIED="$migration_count"

cd "$APP_DIR"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail "Production checkout is not clean"
[[ "$(git rev-parse HEAD)" == "$EXPECTED_CURRENT_SHA" ]] || fail "Production checkout changed since compatibility review"
compose=(docker compose --project-name buildingos --env-file "$ENV_FILE" --file "$COMPOSE_FILE")
rollback_compose_config_preflight "$EXPECTED_CURRENT_SHA" "${compose[@]}"

PHASE='quiesce'
ROLLBACK_API_WAS_RUNNING="$(docker inspect --format '{{.State.Running}}' buildingos-api)" \
  || fail 'Unable to inspect the current API before rollback'
[[ "$ROLLBACK_API_WAS_RUNNING" == 'true' || "$ROLLBACK_API_WAS_RUNNING" == 'false' ]] \
  || fail 'Current API running state is invalid'
ROLLBACK_FROM_API_DIGEST="$(docker inspect --format '{{.Image}}' buildingos-api)" \
  || fail 'Unable to capture the current API image before rollback'
ROLLBACK_FROM_WEB_DIGEST="$(docker inspect --format '{{.Image}}' buildingos-web)" \
  || fail 'Unable to capture the current Web image before rollback'
[[ "$ROLLBACK_FROM_API_DIGEST" =~ ^sha256:[0-9a-f]{64}$ && "$ROLLBACK_FROM_WEB_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'Current rollback source images are not immutable'
ensure_rollback_barrier || fail 'Unable to establish the Release A CLOSED write barrier'
current_barrier_enabled="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' buildingos-api \
  | awk -F= '$1 == "RELEASE_A_WRITE_BARRIER_ENABLED" { count++; value=substr($0, index($0, "=") + 1) } END { if (count > 1) exit 2; if (count == 1) print value }')" \
  || fail 'Unable to inspect current API barrier configuration'
if [[ "$current_barrier_enabled" == true ]]; then
  probe_rollback_runtime_barrier CLOSED || fail 'Current API runtime could not prove the Release A barrier CLOSED'
elif [[ -z "$current_barrier_enabled" || "$current_barrier_enabled" == false ]]; then
  printf 'Rollback runtime barrier probe: NOT_APPLICABLE (current API is non-barrier-aware)\n'
else
  fail 'Current API has an invalid Release A barrier-enabled value'
fi
ROLLBACK_API_QUIESCED=true
"${compose[@]}" stop --timeout 30 buildingos-api buildingos-web
[[ "$(docker inspect --format '{{.State.Running}}' buildingos-api)" == false ]] \
  || fail 'Current API remained running during rollback compatibility validation'
[[ "$(docker inspect --format '{{.State.Running}}' buildingos-web)" == false ]] \
  || fail 'Current Web remained running during rollback compatibility validation'

current_migration_count="$(docker exec "$POSTGRES_CONTAINER" sh -lc 'exec psql -qAt -U "$POSTGRES_USER" -d buildingos_db -c '\''SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'\''')"
[[ "$current_migration_count" == "$migration_count" ]] || fail "Database migration count changed after compatibility review"
PRODUCTION_DB107_MIGRATION_VERIFIER="$APP_DIR/scripts/verify-production-migration-manifest.sh" \
  validate_application_rollback_compatibility "$POSTGRES_CONTAINER" buildingos_db \
    "$PREVIOUS_SHA" \
    "$EXPECTED_CURRENT_SHA"
[[ "$ROLLBACK_COMPATIBILITY_BASIS" == 'DB107_PINNED_RUNTIME' ]] \
  || fail 'Rollback pair did not receive the exact DB107 compatibility PASS'

docker image inspect "$PREVIOUS_API_DIGEST" >/dev/null
docker image inspect "$PREVIOUS_WEB_DIGEST" >/dev/null
rollback_tag="rollback-${PREVIOUS_SHA:0:12}"
docker tag "$PREVIOUS_API_DIGEST" "buildingos-api:$rollback_tag"
docker tag "$PREVIOUS_WEB_DIGEST" "buildingos-web:$rollback_tag"

export IMAGE_TAG="$rollback_tag"
export BUILD_REVISION="$EXPECTED_CURRENT_SHA"
PHASE='application-recreate'
write_rollback_record IN_PROGRESS
remove_release_a_barrier || fail 'Unable to securely release the write barrier for validated old-runtime rollback'
"${compose[@]}" up --detach --no-deps --force-recreate buildingos-api buildingos-web
ROLLBACK_RECREATE_STARTED=true

for container in buildingos-api buildingos-web; do
  for attempt in {1..18}; do
    [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")" == 'healthy' ]] && break
    [[ "$attempt" -eq 18 ]] && fail "$container did not become healthy after rollback"
    sleep 5
  done
done
for url in "$API_HEALTH_URL" "$API_READYZ_URL" "$WEB_LOGIN_URL"; do
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$url" >/dev/null || fail "Rollback smoke failed"
done

active_api_digest="$(docker inspect --format '{{.Image}}' buildingos-api)"
active_web_digest="$(docker inspect --format '{{.Image}}' buildingos-web)"
[[ "$active_api_digest" == "$PREVIOUS_API_DIGEST" && "$active_web_digest" == "$PREVIOUS_WEB_DIGEST" ]] || fail 'Rollback runtime image IDs do not match the requested previous digests'
[[ "$(docker image inspect "$active_api_digest" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$PREVIOUS_SHA" ]] || fail 'Rollback API revision does not match the requested previous SHA'
[[ "$(docker image inspect "$active_web_digest" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$PREVIOUS_SHA" ]] || fail 'Rollback Web revision does not match the requested previous SHA'

# No record is selected by recency, mtime, or filename: missing, malformed, and ambiguous
# prior proofs intentionally leave this rollback receipt explicitly not evaluated.
bind_unique_prior_success_recovery_point "$DEPLOYMENTS_DIR" || true
write_rollback_record SUCCESS
ROLLBACK_RECORD_SUCCESS=true
ROLLBACK_BARRIER_ACTIVE=false
if ! publish_current_successful_selector "$DEPLOYMENTS_DIR" "$RECORD" "$PREVIOUS_SHA" "$CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR"; then
  printf 'ERROR: rollback record succeeded but the current-successful selector was not published; the prior selector is stale and operator intervention is required\n' >&2
  exit 1
fi
printf 'Application rollback completed without database changes\n'
