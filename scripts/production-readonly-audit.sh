#!/usr/bin/env bash
set -Eeuo pipefail
set +x

readonly API_CONTAINER='buildingos-api'
readonly WEB_CONTAINER='buildingos-web'
readonly POSTGRES_CONTAINER='pawtech-postgres'
readonly REDIS_CONTAINER='pawtech-redis'
readonly TRAEFIK_CONTAINER='pawtech-traefik'
readonly DATABASE_NAME='buildingos_db'
readonly APP_DIR='/opt/pawtech/apps/buildingos/buildingos-app'
readonly BACKUP_ROOT='/opt/pawtech/backups/tmp'
readonly BACKUP_SCRIPT_PATH='/opt/pawtech/backups/scripts/backup-postgres.sh'
readonly BACKUP_IDENTITY_MANIFEST_PATH="${APP_DIR}/infra/production/backup-postgres.identity.v1"
readonly ALLOWED_IGNORED_RUNTIME_ENV='infra/docker/.env'
readonly EXPECTED_BUCKET='buildingos-production'
readonly KNOWN_PRODUCTION_BASELINE='20260816000004_legacy_income_application_provenance'
readonly TARGET_MIGRATION='20260831000000_add_payment_receipt_issuance_snapshot'
readonly MAX_BACKUP_AGE_SECONDS=129600

usage() {
  printf 'Usage: %s <candidate_sha> <api_health_url> <api_readyz_url> <web_login_url>\n' "${0##*/}" >&2
  return 64
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

AUDIT_QUERY_FAILURES=0
AUDIT_EVIDENCE_FAILURES=0

container_exists() {
  docker inspect --type container "$1" >/dev/null 2>&1
}

container_state() {
  docker inspect --type container --format '{{.State.Status}}' "$1" 2>/dev/null || printf 'UNKNOWN'
}

container_health() {
  docker inspect --type container --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not_configured{{end}}' "$1" 2>/dev/null || printf 'UNKNOWN'
}

checkout_has_only_approved_ignored_files() {
  local path pattern status_output ignored_paths
  local runtime_env_excluded=false

  [[ -f "$APP_DIR/.dockerignore" ]] || return 1
  while IFS= read -r pattern; do
    [[ "$pattern" =~ ^[[:space:]]*! ]] && return 1
    if [[ "$pattern" == '**/.env' || "$pattern" == 'infra/docker/.env' ]]; then
      runtime_env_excluded=true
    fi
  done < "$APP_DIR/.dockerignore"
  [[ "$runtime_env_excluded" == true ]] || return 1

  if ! ignored_paths="$(git -C "$APP_DIR" ls-files --others --ignored --exclude-standard 2>/dev/null)"; then
    return 1
  fi
  if [[ -n "$ignored_paths" ]]; then
    while IFS= read -r path; do
      case "$path" in
        .env|.env.*|*/.env|*/.env.*|*.pem|*.key|*.p12|*.pfx|*.crt|*.log|*.dump|*.sql|*.bak|*.backup)
          [[ "$path" == "$ALLOWED_IGNORED_RUNTIME_ENV" ]] || return 1
          ;;
      esac
    done <<< "$ignored_paths"
  fi
}

report_container_health() {
  local label="$1"
  local container="$2"
  local state health
  if container_exists "$container"; then
    state="$(container_state "$container")"
    health="$(container_health "$container")"
    printf '%s_CONTAINER_STATE=%s\n' "$label" "$state"
    printf '%s_CONTAINER_HEALTH=%s\n' "$label" "$health"
    if [[ "$state" != 'running' || ( "$health" != 'healthy' && "$health" != 'not_configured' ) ]]; then
      AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
    fi
  else
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
    printf '%s_CONTAINER_STATE=UNKNOWN\n' "$label"
    printf '%s_CONTAINER_HEALTH=UNKNOWN\n' "$label"
  fi
}

container_revision() {
  local container="$1"
  local image_id revision

  image_id="$(docker inspect --type container --format '{{.Image}}' "$container" 2>/dev/null)" || return 1
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  revision="$(docker image inspect "$image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null)" || return 1
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || return 1
  printf '%s\n' "$revision"
}

safe_env_value() {
  local container="$1"
  local key="$2"
  local line

  case "$key" in
    APP_ENV|NODE_ENV|STORAGE_BACKEND|S3_ENDPOINT|S3_BUCKET|S3_FORCE_PATH_STYLE|PAYMENT_PROVIDER|ENABLE_PAYMENT_WEBHOOKS)
      ;;
    *)
      return 1
      ;;
  esac

  line="$(docker inspect --type container --format "{{range .Config.Env}}{{if eq (index (split . \"=\") 0) \"$key\"}}{{println .}}{{end}}{{end}}" "$container" 2>/dev/null)" || return 1
  [[ "$line" == "$key="* ]] || return 1
  printf '%s\n' "${line#*=}"
}

safe_value_or_unknown() {
  local value="$1"
  if [[ "$value" =~ ^[A-Za-z0-9._:/+=?@%,-]+$ ]]; then
    printf '%s' "$value"
  else
    printf 'UNKNOWN'
  fi
}

endpoint_hostname() {
  local endpoint="$1"
  local authority host

  [[ "$endpoint" =~ ^https?://[^[:space:]]+$ ]] || { printf 'UNKNOWN'; return; }
  authority="${endpoint#*://}"
  authority="${authority%%/*}"
  authority="${authority##*@}"
  host="${authority%%:*}"
  [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || { printf 'UNKNOWN'; return; }
  printf '%s' "$host"
}

storage_backend_from_host() {
  case "$1" in
    minio|buildingos-minio|buildingos-staging-minio|localhost|127.0.0.1)
      printf 'MINIO'
      ;;
    UNKNOWN)
      printf 'UNKNOWN'
      ;;
    *)
      printf 'EXTERNAL_S3'
      ;;
  esac
}

readonly_query_stdin() {
  local query

  query="$(< /dev/stdin)"
  [[ "$query" == *'BEGIN READ ONLY;'* ]] || fail 'SQL payload is missing BEGIN READ ONLY'
  [[ "$query" == *'COMMIT;'* ]] || fail 'SQL payload is missing COMMIT'
  printf '%s\n' "$query" | docker exec -i "$POSTGRES_CONTAINER" sh -lc \
    'exec psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$1"' \
    sh "$DATABASE_NAME"
}

report_query_stdin() {
  local key="$1"
  local value

  if value="$(readonly_query_stdin 2>/dev/null)"; then
    printf '%s=%s\n' "$key" "$value"
  else
    AUDIT_QUERY_FAILURES=$((AUDIT_QUERY_FAILURES + 1))
    printf '%s=UNKNOWN\n' "$key"
  fi
}

public_get_status() {
  local label="$1"
  local url="$2"
  local status

  if status="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --request GET --output /dev/null --write-out '%{http_code}' "$url" 2>/dev/null)" && [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
    printf '%s=%s\n' "$label" "$status"
  else
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
    printf '%s=FAIL\n' "$label"
  fi
}

public_readyz_status() {
  local body
  local database_status='UNKNOWN'
  local storage_status='UNKNOWN'
  local readiness_status='UNKNOWN'
  local readyz_ok=false

  if body="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --request GET "$API_READYZ_URL" 2>/dev/null)"; then
    [[ "$body" == *'"database":{"status":"up"'* ]] && database_status='UP'
    [[ "$body" == *'"storage":{"status":"up"'* ]] && storage_status='UP'
    [[ "$body" == *'"status":"healthy"'* ]] && readiness_status='HEALTHY'
    [[ "$body" == *'"status":"degraded"'* ]] && readiness_status='DEGRADED'
    [[ "$body" == *'"status":"unhealthy"'* ]] && readiness_status='UNHEALTHY'
    printf 'PUBLIC_READYZ_HTTP=200\n'
    if [[ "$readiness_status" == 'HEALTHY' && "$database_status" == 'UP' && "$storage_status" == 'UP' ]]; then
      readyz_ok=true
    fi
  else
    printf 'PUBLIC_READYZ_HTTP=FAIL\n'
  fi
  printf 'PUBLIC_READYZ_DATABASE=%s\n' "$database_status"
  printf 'PUBLIC_READYZ_STORAGE=%s\n' "$storage_status"
  printf 'PUBLIC_READYZ_STATUS=%s\n' "$readiness_status"
  if [[ "$readyz_ok" != true ]]; then
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
  fi
}

report_runtime_identity() {
  local production_sha='UNKNOWN'
  local api_revision='UNKNOWN'
  local web_revision='UNKNOWN'
  local checkout_status='UNKNOWN'
  local status_output

  if [[ -d "$APP_DIR/.git" ]]; then
    production_sha="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || printf 'UNKNOWN')"
    if [[ "$production_sha" =~ ^[0-9a-f]{40}$ ]]; then
      if status_output="$(git -C "$APP_DIR" status --porcelain --untracked-files=all 2>/dev/null)" && [[ -z "$status_output" ]] && checkout_has_only_approved_ignored_files; then
        checkout_status='CLEAN'
      else
        checkout_status='DIRTY'
      fi
    fi
  fi
  api_revision="$(container_revision "$API_CONTAINER" 2>/dev/null || printf 'UNKNOWN')"
  web_revision="$(container_revision "$WEB_CONTAINER" 2>/dev/null || printf 'UNKNOWN')"

  printf 'CANDIDATE_SHA=%s\n' "$CANDIDATE_SHA"
  printf 'PRODUCTION_CHECKOUT_SHA=%s\n' "$production_sha"
  printf 'PRODUCTION_CHECKOUT_STATUS=%s\n' "$checkout_status"
  printf 'API_REVISION=%s\n' "$api_revision"
  printf 'WEB_REVISION=%s\n' "$web_revision"
  if [[ "$checkout_status" == 'CLEAN' && "$production_sha" =~ ^[0-9a-f]{40}$ && "$production_sha" == "$api_revision" && "$api_revision" == "$web_revision" ]]; then
    printf 'RUNTIME_IDENTITY=CONSISTENT\n'
  else
    printf 'RUNTIME_IDENTITY=UNKNOWN\n'
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
  fi
}

report_safe_runtime_config() {
  local app_env node_env storage_backend endpoint bucket path_style provider webhooks
  local endpoint_host

  app_env="$(safe_env_value "$API_CONTAINER" APP_ENV 2>/dev/null || true)"
  node_env="$(safe_env_value "$API_CONTAINER" NODE_ENV 2>/dev/null || true)"
  storage_backend="$(safe_env_value "$API_CONTAINER" STORAGE_BACKEND 2>/dev/null || true)"
  endpoint="$(safe_env_value "$API_CONTAINER" S3_ENDPOINT 2>/dev/null || true)"
  bucket="$(safe_env_value "$API_CONTAINER" S3_BUCKET 2>/dev/null || true)"
  path_style="$(safe_env_value "$API_CONTAINER" S3_FORCE_PATH_STYLE 2>/dev/null || true)"
  provider="$(safe_env_value "$API_CONTAINER" PAYMENT_PROVIDER 2>/dev/null || true)"
  webhooks="$(safe_env_value "$API_CONTAINER" ENABLE_PAYMENT_WEBHOOKS 2>/dev/null || true)"
  endpoint_host="$(endpoint_hostname "$endpoint")"

  if [[ -z "$storage_backend" ]]; then
    storage_backend="$(storage_backend_from_host "$endpoint_host")"
  fi
  printf 'APP_ENV=%s\n' "$(safe_value_or_unknown "${app_env:-UNKNOWN}")"
  printf 'NODE_ENV=%s\n' "$(safe_value_or_unknown "${node_env:-UNKNOWN}")"
  printf 'STORAGE_BACKEND=%s\n' "$(safe_value_or_unknown "$storage_backend")"
  printf 'S3_ENDPOINT_HOSTNAME=%s\n' "$endpoint_host"
  printf 'S3_BUCKET=%s\n' "$(safe_value_or_unknown "${bucket:-UNKNOWN}")"
  printf 'S3_FORCE_PATH_STYLE=%s\n' "$(safe_value_or_unknown "${path_style:-UNKNOWN}")"
  printf 'PAYMENT_PROVIDER=%s\n' "$(safe_value_or_unknown "${provider:-UNKNOWN}")"
  printf 'ENABLE_PAYMENT_WEBHOOKS=%s\n' "$(safe_value_or_unknown "${webhooks:-UNKNOWN}")"
}

report_migrations_and_schema() {
  local receipt_columns

  report_query_stdin 'DATABASE_NAME' <<'SQL'
BEGIN READ ONLY;
SELECT current_database();
COMMIT;
SQL
  report_query_stdin 'ACTIVE_FINISHED_MIGRATIONS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
COMMIT;
SQL
  report_query_stdin 'FAILED_MIGRATIONS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL;
COMMIT;
SQL
  report_query_stdin 'MIGRATIONS_AFTER_KNOWN_BASELINE' <<SQL
BEGIN READ ONLY;
SELECT COALESCE(string_agg(migration_name, ',' ORDER BY finished_at, migration_name), 'NONE')
FROM "_prisma_migrations"
WHERE migration_name > '$KNOWN_PRODUCTION_BASELINE'
  AND finished_at IS NOT NULL
  AND rolled_back_at IS NULL;
COMMIT;
SQL
  report_query_stdin 'TARGET_MIGRATION_STATUS' <<SQL
BEGIN READ ONLY;
SELECT CASE
  WHEN count(*) = 0 THEN 'NOT_APPLIED'
  WHEN count(*) = 1 AND bool_and(finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN 'APPLIED'
  ELSE 'AMBIGUOUS'
END
FROM "_prisma_migrations"
WHERE migration_name = '$TARGET_MIGRATION';
COMMIT;
SQL
  if receipt_columns="$(readonly_query_stdin <<'SQL'
BEGIN READ ONLY;
SELECT CASE WHEN count(*) = 6 THEN 'YES' ELSE 'NO' END
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Payment'
  AND column_name IN ('receiptSnapshot', 'receiptSnapshotVersion', 'receiptSnapshotHash', 'receiptSnapshotCreatedAt', 'receiptGenerationToken', 'receiptGenerationLeaseUntil');
COMMIT;
SQL
  2>/dev/null)"; then
    printf 'RECEIPT_SNAPSHOT_COLUMNS=%s\n' "$receipt_columns"
    if [[ "$receipt_columns" == 'YES' ]]; then
      report_query_stdin 'RECEIPT_GENERATION_TOKEN_COUNT' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "Payment" WHERE "receiptGenerationToken" IS NOT NULL;
COMMIT;
SQL
      report_query_stdin 'ACTIVE_RECEIPT_GENERATION_LEASE_COUNT' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "Payment" WHERE "receiptGenerationLeaseUntil" > CURRENT_TIMESTAMP;
COMMIT;
SQL
    else
      printf 'RECEIPT_GENERATION_TOKEN_COUNT=NOT_APPLICABLE\n'
      printf 'ACTIVE_RECEIPT_GENERATION_LEASE_COUNT=NOT_APPLICABLE\n'
    fi
  else
    AUDIT_QUERY_FAILURES=$((AUDIT_QUERY_FAILURES + 1))
    printf 'RECEIPT_SNAPSHOT_COLUMNS=UNKNOWN\nRECEIPT_GENERATION_TOKEN_COUNT=UNKNOWN\nACTIVE_RECEIPT_GENERATION_LEASE_COUNT=UNKNOWN\n'
  fi
}

report_finance_counts() {
  report_query_stdin 'PAYMENTS_COUNT' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "Payment";
COMMIT;
SQL
  report_query_stdin 'PAYMENT_ALLOCATIONS_COUNT' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "PaymentAllocation";
COMMIT;
SQL
  report_query_stdin 'EXPENSES_COUNT' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "Expense";
COMMIT;
SQL
  report_query_stdin 'INCOMES_COUNT' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "Income";
COMMIT;
SQL
  report_query_stdin 'CHARGES_COUNT' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "Charge";
COMMIT;
SQL
  report_query_stdin 'RECEIPT_STATUS_COUNTS' <<'SQL'
BEGIN READ ONLY;
SELECT 'READY=' || count(*) FILTER (WHERE "receiptStatus" = 'READY')
  || ',PENDING=' || count(*) FILTER (WHERE "receiptStatus" = 'PENDING')
  || ',FAILED=' || count(*) FILTER (WHERE "receiptStatus" = 'FAILED')
FROM "Payment";
COMMIT;
SQL
  report_query_stdin 'PAYMENT_AUDIT_TOTAL' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "PaymentAuditLog";
COMMIT;
SQL
  report_query_stdin 'PAYMENT_AUDIT_ACTION_COUNTS' <<'SQL'
BEGIN READ ONLY;
SELECT 'SUBMITTED=' || count(*) FILTER (WHERE action = 'SUBMITTED')
  || ',APPROVED=' || count(*) FILTER (WHERE action = 'APPROVED')
  || ',RECONCILED=' || count(*) FILTER (WHERE action = 'RECONCILED')
  || ',RECEIPT_GENERATED=' || count(*) FILTER (WHERE action = 'RECEIPT_GENERATED')
FROM "PaymentAuditLog";
COMMIT;
SQL
}

report_finance_integrity() {
  report_query_stdin 'ORPHAN_ALLOCATIONS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*)
FROM "PaymentAllocation" a
LEFT JOIN "Payment" p ON p.id = a."paymentId"
LEFT JOIN "Charge" c ON c.id = a."chargeId"
WHERE p.id IS NULL
   OR c.id IS NULL
   OR a."tenantId" <> p."tenantId"
   OR a."tenantId" <> c."tenantId"
   OR p."buildingId" <> c."buildingId"
   OR p."unitId" IS DISTINCT FROM c."unitId";
COMMIT;
SQL
  if value="$(readonly_query_stdin <<'SQL'
BEGIN READ ONLY;
WITH per_payment AS (
  SELECT p.id,
         p.amount,
         p."functionalAmountMinor",
         p."functionalCurrencyCode",
         bool_or(a."paymentOriginalAmountMinor" IS NULL AND c.currency <> p.currency) AS legacy_cross_unverifiable,
         bool_or(c.currency <> p.currency) AS has_cross_currency,
         bool_or(c.currency = p.currency) AS has_same_currency,
         bool_or(c.currency <> p."functionalCurrencyCode") AS functional_currency_unverifiable,
         COALESCE(sum(
           CASE
             WHEN a."paymentOriginalAmountMinor" IS NOT NULL THEN a."paymentOriginalAmountMinor"
             WHEN c.currency = p.currency THEN a.amount
             ELSE 0
            END
          ), 0) AS original_consumed,
         COALESCE(sum(a.amount) FILTER (WHERE c.currency = p."functionalCurrencyCode"), 0) AS functional_consumed
  FROM "Payment" p
  JOIN "PaymentAllocation" a ON a."paymentId" = p.id
  JOIN "Charge" c ON c.id = a."chargeId"
  GROUP BY p.id, p.amount, p."functionalAmountMinor", p."functionalCurrencyCode"
)
SELECT count(*) FILTER (WHERE NOT legacy_cross_unverifiable AND original_consumed > amount)
       || '|' || count(*) FILTER (WHERE legacy_cross_unverifiable)
       || '|' || count(*) FILTER (WHERE has_cross_currency
                                      AND NOT functional_currency_unverifiable
                                      AND "functionalAmountMinor" IS NOT NULL
                                      AND functional_consumed > "functionalAmountMinor")
       || '|' || count(*) FILTER (WHERE has_cross_currency
                                      AND (functional_currency_unverifiable OR "functionalAmountMinor" IS NULL
                                           OR "functionalCurrencyCode" IS NULL))
FROM per_payment;
COMMIT;
SQL
  2>/dev/null)"; then
    local definite_overallocations unverifiable_overallocations functional_definite_overallocations functional_unverifiable_overallocations
    IFS='|' read -r definite_overallocations unverifiable_overallocations functional_definite_overallocations functional_unverifiable_overallocations <<< "$value"
    if [[ "$definite_overallocations" =~ ^[0-9]+$ && "$unverifiable_overallocations" =~ ^[0-9]+$ && "$functional_definite_overallocations" =~ ^[0-9]+$ && "$functional_unverifiable_overallocations" =~ ^[0-9]+$ ]]; then
      printf 'OVER_ALLOCATIONS_DEFINITE=%s\n' "$definite_overallocations"
      printf 'OVER_ALLOCATIONS_UNVERIFIABLE=%s\n' "$unverifiable_overallocations"
      printf 'OVER_ALLOCATIONS_FUNCTIONAL_DEFINITE=%s\n' "$functional_definite_overallocations"
      printf 'OVER_ALLOCATIONS_FUNCTIONAL_UNVERIFIABLE=%s\n' "$functional_unverifiable_overallocations"
    else
      AUDIT_QUERY_FAILURES=$((AUDIT_QUERY_FAILURES + 1))
      printf 'OVER_ALLOCATIONS_DEFINITE=UNKNOWN\nOVER_ALLOCATIONS_UNVERIFIABLE=UNKNOWN\nOVER_ALLOCATIONS_FUNCTIONAL_DEFINITE=UNKNOWN\nOVER_ALLOCATIONS_FUNCTIONAL_UNVERIFIABLE=UNKNOWN\n'
    fi
  else
    AUDIT_QUERY_FAILURES=$((AUDIT_QUERY_FAILURES + 1))
    printf 'OVER_ALLOCATIONS_DEFINITE=UNKNOWN\nOVER_ALLOCATIONS_UNVERIFIABLE=UNKNOWN\nOVER_ALLOCATIONS_FUNCTIONAL_DEFINITE=UNKNOWN\nOVER_ALLOCATIONS_FUNCTIONAL_UNVERIFIABLE=UNKNOWN\n'
  fi
  report_query_stdin 'CHARGE_OVER_ALLOCATIONS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*)
FROM (
  SELECT c.id
  FROM "Charge" c
  JOIN "PaymentAllocation" a ON a."chargeId" = c.id
  GROUP BY c.id, c.amount
  HAVING sum(a.amount) > c.amount
) charge_overallocations;
COMMIT;
SQL
  report_query_stdin 'DUPLICATE_CANONICAL_CHARGE_KEYS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*)
FROM (
  SELECT "tenantId", "buildingId", "unitId", period, concept
  FROM "Charge"
  WHERE "canceledAt" IS NULL
  GROUP BY "tenantId", "buildingId", "unitId", period, concept
  HAVING count(*) > 1
) duplicate_keys;
COMMIT;
SQL
  report_query_stdin 'CURRENCY_MISMATCHES_DEFINITE' <<'SQL'
BEGIN READ ONLY;
WITH per_payment AS (
  SELECT p.id,
         bool_or(p.currency <> c.currency) AS has_cross_currency,
         bool_or(p.currency = c.currency) AS has_same_currency,
         bool_or(p.currency <> c.currency AND (
           p."functionalCurrencyCode" IS NULL
           OR p."functionalCurrencyCode" <> c.currency
           OR p."functionalAmountMinor" IS NULL
           OR p."exchangeRateValue" IS NULL
           OR p."exchangeRateDirection" IS NULL
           OR p."exchangeRateDirection" NOT IN ('IDENTITY', 'DIRECT', 'INVERSE')
           OR p."conversionDate" IS NULL
           OR (p."exchangeRateDirection" = 'IDENTITY' AND (p."exchangeRateValue" <> 1 OR p."exchangeRateId" IS NOT NULL OR p."exchangeRateEffectiveAt" IS NOT NULL))
           OR (p."exchangeRateDirection" IN ('DIRECT', 'INVERSE') AND (p."exchangeRateValue" <= 0 OR p."exchangeRateId" IS NULL OR p."exchangeRateEffectiveAt" IS NULL))
         )) AS has_invalid_cross_currency
  FROM "PaymentAllocation" a
  JOIN "Payment" p ON p.id = a."paymentId"
  JOIN "Charge" c ON c.id = a."chargeId"
  GROUP BY p.id
)
SELECT count(*)
FROM per_payment
WHERE has_cross_currency AND (has_same_currency OR has_invalid_cross_currency);
COMMIT;
SQL
  report_query_stdin 'CURRENCY_MISMATCHES_UNVERIFIABLE' <<'SQL'
BEGIN READ ONLY;
WITH per_payment AS (
  SELECT p.id,
         bool_or(p.currency <> c.currency) AS has_cross_currency,
         bool_or(p.currency = c.currency) AS has_same_currency,
         bool_or(p.currency <> c.currency AND
           p."functionalCurrencyCode" IS NULL
           AND p."functionalAmountMinor" IS NULL
           AND p."exchangeRateId" IS NULL
           AND p."exchangeRateValue" IS NULL
           AND p."exchangeRateDirection" IS NULL
           AND p."exchangeRateEffectiveAt" IS NULL
           AND p."conversionDate" IS NULL) AS has_unverifiable_cross_currency,
         bool_or(p.currency <> c.currency AND (
           p."functionalCurrencyCode" IS NOT NULL
           OR p."functionalAmountMinor" IS NOT NULL
           OR p."exchangeRateId" IS NOT NULL
           OR p."exchangeRateValue" IS NOT NULL
           OR p."exchangeRateDirection" IS NOT NULL
           OR p."exchangeRateEffectiveAt" IS NOT NULL
           OR p."conversionDate" IS NOT NULL
         )) AS has_conversion_metadata
  FROM "PaymentAllocation" a
  JOIN "Payment" p ON p.id = a."paymentId"
  JOIN "Charge" c ON c.id = a."chargeId"
  GROUP BY p.id
)
SELECT count(*)
FROM per_payment
WHERE has_cross_currency
  AND NOT has_same_currency
  AND has_unverifiable_cross_currency
  AND NOT has_conversion_metadata;
COMMIT;
SQL
  report_query_stdin 'DUPLICATE_RECEIPT_FILE_GRAPHS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*)
FROM (
  SELECT d."fileId"
  FROM "Payment" p
  JOIN "Document" d ON d.id = p."receiptDocumentId"
  JOIN "File" f ON f.id = d."fileId"
  WHERE p."receiptDocumentId" IS NOT NULL
  GROUP BY d."fileId"
  HAVING count(*) > 1
) duplicate_files;
COMMIT;
SQL
  report_query_stdin 'DUPLICATE_RECEIPT_DOCUMENT_GRAPHS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*)
FROM (
  SELECT p."receiptDocumentId"
  FROM "Payment" p
  WHERE p."receiptDocumentId" IS NOT NULL
  GROUP BY p."receiptDocumentId"
  HAVING count(*) > 1
) duplicate_documents;
COMMIT;
SQL
  report_query_stdin 'DUPLICATE_RECEIPT_GENERATED_AUDITS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*)
FROM (
  SELECT "tenantId", "paymentId"
  FROM "PaymentAuditLog"
  WHERE action = 'RECEIPT_GENERATED'
  GROUP BY "tenantId", "paymentId"
  HAVING count(*) > 1
) duplicate_audits;
COMMIT;
SQL
}

report_tenant_classification() {
  local classification
  if classification="$(readonly_query_stdin <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FILTER (WHERE "isDemo" = true)
       || '|' || count(*) FILTER (WHERE "isDemo" = false)
FROM "Tenant";
COMMIT;
SQL
  2>/dev/null)"; then
    printf 'TENANT_DEMO_TEST=%s\n' "${classification%%|*}"
    printf 'TENANT_UNKNOWN=%s\n' "${classification#*|}"
  else
    AUDIT_QUERY_FAILURES=$((AUDIT_QUERY_FAILURES + 1))
    printf 'TENANT_DEMO_TEST=UNKNOWN\nTENANT_UNKNOWN=UNKNOWN\n'
  fi
  printf 'TENANT_SYSTEM_INTERNAL=UNKNOWN\n'
  printf 'TENANT_REAL_BUSINESS=UNKNOWN\n'
}

report_storage_database_buckets() {
  report_query_stdin 'FILE_BUCKET_COUNTS' <<'SQL'
BEGIN READ ONLY;
SELECT COALESCE(string_agg(bucket || ':' || row_count::text, ',' ORDER BY bucket), 'NONE')
FROM (SELECT bucket, count(*) AS row_count FROM "File" GROUP BY bucket) bucket_counts;
COMMIT;
SQL
  report_query_stdin 'FILE_EXPECTED_BUCKET_COUNT' <<SQL
BEGIN READ ONLY;
SELECT count(*) FROM "File" WHERE bucket = '$EXPECTED_BUCKET';
COMMIT;
SQL
  report_query_stdin 'FILE_OTHER_BUCKET_COUNT' <<SQL
BEGIN READ ONLY;
SELECT count(*) FROM "File" WHERE bucket <> '$EXPECTED_BUCKET';
COMMIT;
SQL
  printf 'EXPECTED_AUTHORITATIVE_BUCKET=%s\n' "$EXPECTED_BUCKET"
}

s3_client_available() {
  docker exec "$API_CONTAINER" node -e 'require.resolve("minio")' >/dev/null 2>&1
}

s3_probe() {
  local operation="$1"
  docker exec -i "$API_CONTAINER" node - "$operation" <<'NODE'
'use strict';

const Minio = require('minio');
const operation = process.argv[2];
const endpoint = new URL(process.env.S3_ENDPOINT);
const client = new Minio.Client({
  endPoint: endpoint.hostname,
  port: endpoint.port ? Number(endpoint.port) : undefined,
  useSSL: endpoint.protocol === 'https:',
  pathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  accessKey: process.env.S3_ACCESS_KEY || '',
  secretKey: process.env.S3_SECRET_KEY || '',
  region: process.env.S3_REGION || 'us-east-1',
});
const bucket = process.env.S3_BUCKET;

const run = async () => {
  if (operation === 'head') {
    if (!(await client.bucketExists(bucket))) {
      throw new Error('bucket is not reachable');
    }
    return;
  }
  if (operation === 'versioning') {
    const versioning = await client.getBucketVersioning(bucket);
    process.stdout.write(`${versioning.Status || 'UNKNOWN'}\n`);
    return;
  }
  if (operation === 'objects') {
    let continuationToken = '';
    let objectCount = 0;
    do {
      const result = await client.listObjectsV2Query(bucket, '', continuationToken, '', 100, '');
      objectCount += result.objects.length;
      if (!result.isTruncated) {
        break;
      }
      if (!result.nextContinuationToken) {
        throw new Error('S3 object listing is truncated without a continuation token');
      }
      continuationToken = result.nextContinuationToken;
    } while (true);
    process.stdout.write(`${objectCount}\n`);
    return;
  }
  throw new Error('unsupported S3 probe');
};

run().catch(() => {
  process.exitCode = 1;
});
NODE
}

report_s3_posture() {
  local configured_bucket versioning object_count
  local versioning_ok=false
  local object_count_ok=false

  configured_bucket="$(safe_env_value "$API_CONTAINER" S3_BUCKET 2>/dev/null || true)"
  if [[ "$configured_bucket" != "$EXPECTED_BUCKET" ]]; then
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
    printf 'S3_BUCKET_REACHABLE=UNKNOWN\nS3_VERSIONING_STATUS=UNKNOWN\nS3_BUSINESS_OBJECT_COUNT=UNKNOWN\nS3_DEEP_AUDIT=INCOMPLETE\n'
    return
  fi
  if s3_client_available; then
    if s3_probe head >/dev/null 2>&1; then
      printf 'S3_BUCKET_REACHABLE=YES\n'
      if versioning="$(s3_probe versioning 2>/dev/null)"; then
        versioning_ok=true
      else
        versioning='UNKNOWN'
      fi
      if object_count="$(s3_probe objects 2>/dev/null)"; then
        object_count_ok=true
      else
        object_count='UNKNOWN'
      fi
      printf 'S3_VERSIONING_STATUS=%s\n' "$(safe_value_or_unknown "$versioning")"
      printf 'S3_BUSINESS_OBJECT_COUNT=%s\n' "$(safe_value_or_unknown "$object_count")"
      if [[ "$versioning_ok" == true && "$object_count_ok" == true ]]; then
        printf 'S3_DEEP_AUDIT=PASS\n'
      else
        AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
        printf 'S3_DEEP_AUDIT=INCOMPLETE\n'
      fi
    else
      AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
      printf 'S3_BUCKET_REACHABLE=FAIL\nS3_VERSIONING_STATUS=UNKNOWN\nS3_BUSINESS_OBJECT_COUNT=UNKNOWN\nS3_DEEP_AUDIT=FAIL\n'
    fi
  else
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
    printf 'S3_DEEP_AUDIT_UNAVAILABLE\nS3_DEEP_AUDIT=INCOMPLETE\n'
  fi
}

file_mtime() {
  stat -c '%Y' -- "$1" 2>/dev/null || stat -f '%m' -- "$1"
}

validate_pg_restore_list() {
  local dump="$1"

  if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --list "$dump" >/dev/null 2>&1
    return
  fi
  container_exists "$POSTGRES_CONTAINER" || return 2
  docker exec -i "$POSTGRES_CONTAINER" pg_restore --list < "$dump" >/dev/null 2>&1
}

manifest_field() {
  local manifest="$1"
  local key="$2"

  awk -F '=' -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$manifest"
}

validate_backup_mechanism() {
  local manifest="$1"
  local validator="$2"

  [[ -f "$manifest" && ! -L "$manifest" && -x "$validator" ]] || return 1
  bash "$validator" backup-identity "$manifest" >/dev/null 2>&1
}

format_epoch() {
  date -u -d "@$1" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$1" '+%Y-%m-%dT%H:%M:%SZ'
}

report_backup_readiness() {
  local latest_dump=''
  local latest_mtime=0
  local candidate mtime checksum_file expected actual now age
  local mechanism_path='UNKNOWN' mechanism_digest='UNKNOWN' mechanism_owner='UNKNOWN' mechanism_group='UNKNOWN' mechanism_mode='UNKNOWN'
  local mechanism_identity='UNKNOWN' backup_validator restore_result
  local dump_present='NO'
  local checksum_present='NO'
  local checksum_status='NOT_RUN'
  local restore_status='NOT_RUN'
  local backup_required='YES'

  if [[ -d "$BACKUP_ROOT" && ! -L "$BACKUP_ROOT" ]]; then
    while IFS= read -r -d '' candidate; do
      [[ ! -L "$candidate" ]] || continue
      mtime="$(file_mtime "$candidate" 2>/dev/null || printf '0')"
      [[ "$mtime" =~ ^[0-9]+$ ]] || continue
      if (( mtime > latest_mtime )); then
        latest_mtime="$mtime"
        latest_dump="$candidate"
      fi
    done < <(find "$BACKUP_ROOT" -mindepth 2 -maxdepth 2 -type f -name 'buildingos_db_*.dump' -print0 2>/dev/null)
  fi

  if [[ -n "$latest_dump" ]]; then
    dump_present='YES'
    checksum_file="$latest_dump.sha256"
    if [[ -s "$checksum_file" && ! -L "$checksum_file" ]]; then
      checksum_present='YES'
      expected=''
      IFS=' ' read -r expected _ < "$checksum_file" || true
      if actual="$(sha256sum -- "$latest_dump" 2>/dev/null)"; then
        actual="${actual%% *}"
      else
        actual='UNKNOWN'
      fi
      if [[ "$expected" =~ ^[0-9a-f]{64}$ && "$expected" == "$actual" ]]; then
        checksum_status='PASS'
      else
        checksum_status='FAIL'
        AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
      fi
    else
      checksum_status='INCOMPLETE'
      AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
    fi
    if validate_pg_restore_list "$latest_dump"; then
      restore_status='PASS'
    else
      restore_result=$?
      if [[ "$restore_result" -eq 2 ]]; then
        restore_status='INCOMPLETE'
      else
        restore_status='FAIL'
      fi
      AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
    fi
    now="$(date -u +%s)"
    age=$((now - latest_mtime))
    if (( age >= 0 && age <= MAX_BACKUP_AGE_SECONDS )) && [[ "$checksum_status" == 'PASS' && "$restore_status" == 'PASS' ]]; then
      backup_required='NO'
    fi
    printf 'LATEST_BUILDINGOS_DB_BACKUP_TIMESTAMP=%s\n' "$(format_epoch "$latest_mtime")"
    printf 'LATEST_BUILDINGOS_DB_BACKUP_FILE=%s\n' "${latest_dump##*/}"
    printf 'BACKUP_AGE_SECONDS=%s\n' "$age"
  else
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
    printf 'LATEST_BUILDINGOS_DB_BACKUP_TIMESTAMP=UNKNOWN\n'
    printf 'LATEST_BUILDINGOS_DB_BACKUP_FILE=UNKNOWN\n'
    printf 'BACKUP_AGE_SECONDS=UNKNOWN\n'
  fi
  backup_validator="$APP_DIR/scripts/production-security-validate.sh"
  if validate_backup_mechanism "$BACKUP_IDENTITY_MANIFEST_PATH" "$backup_validator"; then
    mechanism_path="$(manifest_field "$BACKUP_IDENTITY_MANIFEST_PATH" path)"
    mechanism_digest="$(manifest_field "$BACKUP_IDENTITY_MANIFEST_PATH" sha256)"
    mechanism_owner="$(manifest_field "$BACKUP_IDENTITY_MANIFEST_PATH" owner)"
    mechanism_group="$(manifest_field "$BACKUP_IDENTITY_MANIFEST_PATH" group)"
    mechanism_mode="$(manifest_field "$BACKUP_IDENTITY_MANIFEST_PATH" mode)"
    mechanism_identity="path=${mechanism_path};sha256=${mechanism_digest};owner=${mechanism_owner};group=${mechanism_group};mode=${mechanism_mode}"
  else
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
  fi
  printf 'BACKUP_MECHANISM_PATH=%s\n' "$mechanism_path"
  printf 'BACKUP_MECHANISM_SHA256=%s\n' "$mechanism_digest"
  printf 'BACKUP_MECHANISM_OWNER=%s\n' "$mechanism_owner"
  printf 'BACKUP_MECHANISM_GROUP=%s\n' "$mechanism_group"
  printf 'BACKUP_MECHANISM_MODE=%s\n' "$mechanism_mode"
  printf 'BACKUP_MECHANISM_IDENTITY=%s\n' "$mechanism_identity"
  printf 'BACKUP_IDENTITY_MANIFEST=%s\n' "$BACKUP_IDENTITY_MANIFEST_PATH"
  printf 'BACKUP_DUMP_PRESENT=%s\n' "$dump_present"
  printf 'BACKUP_CHECKSUM_PRESENT=%s\n' "$checksum_present"
  printf 'BACKUP_CHECKSUM_VERIFICATION=%s\n' "$checksum_status"
  printf 'BACKUP_PG_RESTORE_LIST=%s\n' "$restore_status"
  printf 'PREDEPLOY_BACKUP_REQUIRED=%s\n' "$backup_required"
}

report_minio_posture() {
  local state networks ports endpoint host authoritative
  if ! container_exists buildingos-minio; then
    printf 'MINIO_CONTAINER=ABSENT\nMINIO_AUTHORITATIVE=UNKNOWN\n'
    return
  fi
  state="$(container_state buildingos-minio)"
  networks="$(docker inspect --type container --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}} {{end}}' buildingos-minio 2>/dev/null || printf 'UNKNOWN')"
  ports="$(docker inspect --type container --format '{{json .NetworkSettings.Ports}}' buildingos-minio 2>/dev/null || printf 'UNKNOWN')"
  endpoint="$(safe_env_value "$API_CONTAINER" S3_ENDPOINT 2>/dev/null || true)"
  host="$(endpoint_hostname "$endpoint")"
  authoritative="$(storage_backend_from_host "$host")"
  [[ "$authoritative" == 'MINIO' ]] && authoritative='YES' || [[ "$authoritative" == 'EXTERNAL_S3' ]] && authoritative='NO' || authoritative='UNKNOWN'
  printf 'MINIO_CONTAINER=%s\n' "$state"
  printf 'MINIO_NETWORKS=%s\n' "$networks"
  printf 'MINIO_PUBLISHED_PORTS=%s\n' "$ports"
  printf 'MINIO_AUTHORITATIVE=%s\n' "$authoritative"
}

main() {
  local url

  [[ $# -eq 4 ]] || { usage; return 64; }
  readonly CANDIDATE_SHA="$1"
  readonly API_HEALTH_URL="$2"
  readonly API_READYZ_URL="$3"
  readonly WEB_LOGIN_URL="$4"

  [[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'candidate SHA is not exactly 40 lowercase hexadecimal characters'
  for url in "$API_HEALTH_URL" "$API_READYZ_URL" "$WEB_LOGIN_URL"; do
    [[ "$url" =~ ^https://[A-Za-z0-9._:/?=%+-]+$ ]] || fail 'public audit URL is not an HTTPS URL'
  done

  for command_name in awk bash curl date docker find git sha256sum stat; do
    command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
  done

  AUDIT_QUERY_FAILURES=0
  AUDIT_EVIDENCE_FAILURES=0
  printf 'PRODUCTION_READONLY_AUDIT\n'
  report_runtime_identity
  report_container_health API "$API_CONTAINER"
  report_container_health WEB "$WEB_CONTAINER"
  report_container_health POSTGRES "$POSTGRES_CONTAINER"
  report_container_health REDIS "$REDIS_CONTAINER"
  report_container_health TRAEFIK "$TRAEFIK_CONTAINER"
  public_get_status PUBLIC_API_HEALTH "$API_HEALTH_URL"
  public_readyz_status
  public_get_status PUBLIC_WEB_LOGIN "$WEB_LOGIN_URL"
  report_safe_runtime_config
  report_migrations_and_schema
  report_finance_counts
  report_finance_integrity
  report_tenant_classification
  report_storage_database_buckets
  report_s3_posture
  report_minio_posture
  report_backup_readiness

  if (( AUDIT_QUERY_FAILURES == 0 && AUDIT_EVIDENCE_FAILURES == 0 )); then
    printf 'AUDIT_STATUS=COMPLETE\n'
  else
    printf 'AUDIT_STATUS=INCOMPLETE\n'
    printf 'AUDIT_QUERY_FAILURES=%s\n' "$AUDIT_QUERY_FAILURES"
    printf 'AUDIT_EVIDENCE_FAILURES=%s\n' "$AUDIT_EVIDENCE_FAILURES"
    return 1
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
