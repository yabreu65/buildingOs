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
readonly PRODUCTION_ROOT='/opt/pawtech/apps/buildingos'
readonly DEPLOYMENTS_ROOT="$PRODUCTION_ROOT/deployments"
readonly CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR="$DEPLOYMENTS_ROOT/current-successful-deployment.v1"
readonly RECOVERY_POINTS_ROOT='/opt/pawtech/backups/recovery-points'
readonly BACKUP_SCRIPT_PATH='/opt/pawtech/backups/scripts/backup-postgres.sh'
readonly BACKUP_IDENTITY_MANIFEST_PATH="${APP_DIR}/infra/production/backup-postgres.identity.v1"
readonly OBJECT_BACKUP_RECEIPT='/var/lib/buildingos-object-backup/object-backup-receipt.json'
readonly BACKUP_IDENTITY_VERSION='backup-postgres.identity.v1'
readonly BACKUP_SCRIPT_SHA256='3cbf2bf191bd9a06e7bbf831848cfa2816cd80fca980593f84d3411cb3b14ff5'
readonly BACKUP_SCRIPT_OWNER='yoryi'
readonly BACKUP_SCRIPT_GROUP='yoryi'
readonly BACKUP_SCRIPT_MODE='0775'
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
  AUDIT_INTERNAL_FAILURES=$((AUDIT_INTERNAL_FAILURES + 1))
  AUDIT_FAILURE_REASON="${1:-unknown}"
  AUDIT_FAILURE_REASON="${AUDIT_FAILURE_REASON//$'\n'/ }"
  AUDIT_FAILURE_REASON="${AUDIT_FAILURE_REASON//$'\r'/ }"
  printf 'ERROR: %s\n' "$AUDIT_FAILURE_REASON" >&2
  audit_failure_summary >&2
  exit 1
}

input_failure() {
  AUDIT_FAILURE_CLASS='INPUT_ERROR'
  AUDIT_FAILURE_REASON="${1:-unknown}"
  AUDIT_FAILURE_REASON="${AUDIT_FAILURE_REASON//$'\n'/ }"
  AUDIT_FAILURE_REASON="${AUDIT_FAILURE_REASON//$'\r'/ }"
  printf 'ERROR: %s\n' "$AUDIT_FAILURE_REASON" >&2
  audit_failure_summary >&2
  exit 1
}

audit_failure_summary() {
  printf 'AUDIT_STATUS=INCOMPLETE\n' >&2
  printf 'AUDIT_QUERY_FAILURES=%s\n' "$AUDIT_QUERY_FAILURES" >&2
  printf 'AUDIT_EVIDENCE_FAILURES=%s\n' "$AUDIT_EVIDENCE_FAILURES" >&2
  printf 'AUDIT_INTERNAL_FAILURES=%s\n' "$AUDIT_INTERNAL_FAILURES" >&2
  printf 'FAILED_STAGE=%s\n' "$AUDIT_STAGE" >&2
  printf 'FAILURE_CLASS=%s\n' "$AUDIT_FAILURE_CLASS" >&2
  printf 'FAILURE_REASON=%s\n' "$AUDIT_FAILURE_REASON" >&2
}

audit_unexpected_error() {
  local rc=$?
  AUDIT_INTERNAL_FAILURES=$((AUDIT_INTERNAL_FAILURES + 1))
  AUDIT_FAILURE_REASON="unexpected command failure at line ${BASH_LINENO[0]-unknown}"
  audit_failure_summary >&2
  exit "$rc"
}

AUDIT_QUERY_FAILURES=0
AUDIT_EVIDENCE_FAILURES=0
AUDIT_INTERNAL_FAILURES=0
AUDIT_ACTIVE_FINISHED_MIGRATIONS='UNKNOWN'
AUDIT_FAILED_MIGRATIONS='UNKNOWN'
AUDIT_STAGE='STARTUP'
AUDIT_FAILURE_CLASS='AUDITOR_ERROR'
AUDIT_FAILURE_REASON='UNKNOWN'
RUNTIME_APP_SHA='UNKNOWN'
RUNTIME_API_IMAGE_ID='UNKNOWN'
RUNTIME_WEB_IMAGE_ID='UNKNOWN'
RECOVERY_POINT_AUDIT_STATUS='NOT_EVALUATED'
RECOVERY_POINT_POSTGRES_BACKUP_EVIDENCE_STATUS='NOT_EVALUATED'
RECOVERY_POINT_REFERENCE_RECONCILIATION_STATUS='NOT_EVALUATED'
RECOVERY_POINT_CONTENT_IDENTITY_STATUS='NOT_EVALUATED'
RECOVERY_POINT_SELECTOR_REPORTED=false
SELECTED_SUCCESSFUL_DEPLOYMENT_RECORD=''

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
  local app_dir="${1:-$APP_DIR}"
  local path pattern status_output ignored_paths
  local runtime_env_excluded=false

  [[ -f "$app_dir/.dockerignore" ]] || return 1
  while IFS= read -r pattern; do
    [[ "$pattern" =~ ^[[:space:]]*! ]] && return 1
    if [[ "$pattern" == '**/.env' || "$pattern" == 'infra/docker/.env' ]]; then
      runtime_env_excluded=true
    fi
  done < "$app_dir/.dockerignore"
  [[ "$runtime_env_excluded" == true ]] || return 1

  if ! ignored_paths="$(git -C "$app_dir" ls-files --others --ignored --exclude-standard 2>/dev/null)"; then
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

container_image_id() {
  local container="$1" image_id

  image_id="$(docker inspect --type container --format '{{.Image}}' "$container" 2>/dev/null)" || return 1
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$image_id"
}

container_revision() {
  local container="$1"
  local image_id revision

  image_id="$(container_image_id "$container")" || return 1
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
  [[ "$query" == *'BEGIN READ ONLY;'* ]] || return 64
  [[ "$query" == *'COMMIT;'* ]] || return 64
  printf '%s\n' "$query" | docker exec -i "$POSTGRES_CONTAINER" sh -lc \
    'exec psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$1"' \
    sh "$DATABASE_NAME"
}

record_query_failure() {
  if [[ "$1" -eq 64 ]]; then
    AUDIT_INTERNAL_FAILURES=$((AUDIT_INTERNAL_FAILURES + 1))
    AUDIT_FAILURE_REASON='SQL payload is missing BEGIN READ ONLY or COMMIT'
    printf 'ERROR: %s\n' "$AUDIT_FAILURE_REASON" >&2
  else
    AUDIT_QUERY_FAILURES=$((AUDIT_QUERY_FAILURES + 1))
  fi
}

report_query_stdin() {
  local key="$1"
  local value
  local rc

  if value="$(readonly_query_stdin 2>/dev/null)"; then
    case "$key" in
      ACTIVE_FINISHED_MIGRATIONS) AUDIT_ACTIVE_FINISHED_MIGRATIONS="$value" ;;
      FAILED_MIGRATIONS) AUDIT_FAILED_MIGRATIONS="$value" ;;
    esac
    printf '%s=%s\n' "$key" "$value"
  else
    rc=$?
    record_query_failure "$rc"
    case "$key" in
      ACTIVE_FINISHED_MIGRATIONS) AUDIT_ACTIVE_FINISHED_MIGRATIONS='UNKNOWN' ;;
      FAILED_MIGRATIONS) AUDIT_FAILED_MIGRATIONS='UNKNOWN' ;;
    esac
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

# Frozen name|SHA256 inventory verified from approved base c9d9a47c30215d0ac61b5c46b9cf6c6519658545.
expected_migration_rows() {
  cat <<'MIGRATION_INVENTORY'
20260211013456_init_postgres|df91d1594bac39d6d1937be7e3a61d65c887252c085d3ba53e4432baca8b7987
20260211015129_tenant_name_unique|d8ca49053f03b16f5876183edf79b25603c51b0c5755837a4efa0f2571111e3e
20260213015939_add_building_unit_occupant|8b1f825227db80b0f046c4ace6d56853d9916ae0c691550ed4c96748cf7560bf
20260213232629_add_audit_billing_models|6d5e5b43884501fc751c3d1a48453090f4599d43631859a3ff9f5cfb5d4c5788
20260215212357_add_ticket_models|c90bcdbb52f7607da792e077900c2ec0efd6a901fa59be5a238f4a185c4b2398
20260216141712_add_communications_module|bdb0bdc8016ded59559e8b211773da290e8136e3aba39ae5eb96520467f6f50b
20260216152955_add_documents_and_files_module|32b64d82d7d9467c55a81aeb871d1d02b2811cd64a90e43400e850ca190b1f8e
20260216194957_add_vendors_and_operations_module|6556b75952b92e4f938fdd75ee70e642c7d3695369c5aa6910b8773d85cf9cfc
20260216203551_add_finanzas_charges_payments_allocations|0480a82fbdfdaf1fe58255cf5dbabf173283f6696fd7a2d92406ad1e01dd244e
20260217032610_expand_audit_log_all_modules|52fd6ea52d4626a85f34ad501ff37a1adc576f3089600f5129231671c50ec0dd
20260217041336_add_impersonation_audit_actions|78de1e732454debee2192267689ed82a6ed76c4bb92b84d4fcb52301a82fe2fe
20260217213321_add_tenant_branding|e38728de91144ece98a7dc082c824f3fe0afc4147a183f30a320def1fb557acf
20260217213428_add_tenant_branding_audit_action|19d1e20934b666c37e7929a2d71c15d916429e6b8383732846660e718afc7e1c
20260217215449_add_invitation_model|ba301aa4bb7aa78111daacf9beaaad5312f68668594abe9eec7c5533469e3157
20260217221442_add_onboarding_state|9d0289a569f095b1d5484efd4aad611b17ff68df772b7c1d9fb7140cdc563bb3
20260218023749_add_scoped_membership_roles|7fa207c5c63758dddf9ad5af8c8dbe32b59dd839af66aaa23eb193a88789e726
20260218030131_add_user_context|4fc592119220f9c32ba0da8c52c7c88819bee946fe6370836a94f47f56a23e2e
20260218160012_add_email_logging|4a343619eaf19ad5fa5e895318264743dfee63e0a548cd9a16a5f114ca0a4f0a
20260218182315_add_notifications_model|695f336604258e919a0ff205d59c98b442bb6337c339495497726e85d21cc0d8
20260218235500_add_support_tickets|4db77f31f596968f6f23b4e84db8c49ce0235e885071ed7e58df08ef3455e91f
20260218_add_ai_analytics|40b8ffdae43d772951485472e3b17d0df4c1293768bed88e86913b15f38eca4c
20260223000001_add_lead_model|0782578968cfe8417adfac683058285443ddb451ecee5759499c3cd7e5588873
20260224002136_add_missing_billing_plan_columns|053cc26473e6ff27888e32f2ecbddfc3821b4d3a8db5d70934c4e687301c022d
20260322133357_add_ai_consultation_limits|73d6c2aeb8243588591b2e9b0de0877eff8c6913ec86c4f8b33bfd91ef76c589
20260322_add_ai_ticket_categorization|abdb81f2cdba526428bad49ba8bc45a7dde75c2ce7376e4012a6ef0025fdcb9b
20260324023040_add_payment_canceled_at|e4f264faa5b10056fc7b0670a4d2bce19c91d259f3b7499d7d30c6d42c9dac3d
20260324220712_add_welcome_to_email_type|521200d54a9653f37e110360026561121f0f164e06bfdf485a7eb44fedd30b8b
20260324234534_add_expense_allocation_schema|f0547d97811af3f1605f310b0d00fba87917ae4d42e4a40b12ea9d98d3b24877
20260325144923_change_expense_period_total_to_bigint|98a36a614651cf5471f330d68358ff0e0e4ed19e1c12aeadb411ab523b68086a
20260325153749_change_total_to_allocate_snapshot_to_bigint|becf1d5f1b734cf00c34a05a3434f9cb8c4726bfa7da4c7706ab63880d64aa69
20260325190000_add_tenant_members_invitations|1acd6ce1e9f71b8993b7ffe044be2a9db690653715036bd746ad97011172f654
20260325193013_make_unitoccupant_userid_nullable|24562d99875ec11f49fb4f4edbfcc8dcd2718f5de3e986fcd8fe577e9d476e86
20260326120000_add_payment_cancel_audit_action|d4171937196775f93837c36196ed2369720649a4715624ee3cd33bfdeec1b9a4
20260328000000_add_communication_soft_delete|b63caa0d96ee464e1c5217af977bf543ed379a16484afe53562a6848452e6e29
20260331223859_add_tenant_currency|867a0e14c494d18840012c38a60a3febd033996b38385d1187eb71ddabd20718
20260401000000_add_expense_liquidation_flow|2249b5b98230f00a9a85927675cdbe1ab89bf89889362ffafe8eb3f50fad4fef
20260402000000_add_expense_ledger_category_code_sort|03ce8cd73b6adfb52908856668a0a1c61b02161f481b34e5380f3514d31aca54
20260402000001_fix_liquidation_cancel_unique|51722043f7cf140dc5c2005b9e3fd60123cc06d3a0276c463dc5ffe270c729fd
20260402000002_fix_charge_cancel_unique|db9db61d19913f130b34356d899ff58b98abb97084ae7f8a15402a87b2a83585
20260402000003_cleanup_canceled_liquidations|b75b9341310f52bf6e8710c817841fef9f26562121ccad2838aeb681517f49ad
20260402_add_income_model|5b85958471e7d1e8fd7b72fe7b9c8ea03e5911b6a2d173c6b797679fc4e83cae
20260402_add_movement_type_to_expense_ledger_category|7651d592575a63cd3e64f45e745e2cefc4e8afe5bf16bb12f4083792be07ec90
20260402_add_universal_liquidation_schema|2fef6671e1d4d6c2e9f611adfb25fe7c6b3f7bd066407a1f306f94c55536d8ba
20260402_backfill_movement_type|0b169abcb5d66171d74d440a81549da8ad2ebc480833efa865170d81ab0fab26
20260404_add_notification_types|f3ed3c02080ef5d7a5da2f23086f922be6d8e904b0810ffd579138930e27fc85
20260405_add_charge_automation_fields|f151c0ec01e9ad752279bbbff9cf12d01927dfe86cab3aa46a135207e3a112c3
20260405_add_expense_imported_audit_action|60ee40b02b460721593ca607c298f9d4ee5f266477d741e7503a872e49cb85d0
20260405_add_finance_summary_email|9ada018d137229665557618ac767c60160c0878fd3b49dd612031a21c912af33
20260405_add_payment_reminder_and_expense_period_notifications|bf39a5f69a3d2d17acb0659f252571fb90bc94e4da4a934423eea9586e0018c0
20260405_add_recurring_expense_model|2ecf6c858b76ba8d8b68835a900abcedddb26eb10e34e20daa09f5f1d8f8d4a5
20260405_add_ticket_escalated_audit_action|47a9ba09e32ea10cecee72255882900a8b0cb1d5b8799fe69e1cc0d68f6faab3
20260405_add_ticket_escalation_field|5414f31cae002b9984eca5971986681edad2d88fecbabcacc8caae334836604c
20260405_add_urgent_ticket_notification_type|e06c809fbcb5efe87f9f332e8c995741fee9d22556c1436a1b4701c234e8c5f0
20260406115109_periods_and_adjustments|f4a8c699ecfe1afcde9f0546768d0b22351dde95defefd0d9063aab1c7845de2
20260419000100_backfill_payment_paidat|459af792badac421bafe0d473e7ec77e031710867884f0affc3790dc23ee155d
20260419000200_add_dashboard_debt_aging_indexes|c5de92baf17995c71cc45ebd9ca9e114f71e09e2c50e3576a40d5d515465ad81
20260423170000_add_rls_pilot_tenant_tables|d7164dbb0585abbb8e4d110ee12b70a8291625977efdcdf34a9a2f195efd2071
20260423174500_add_rls_strict_mode_toggle|9924033ca0081400a9139f6b77c406c271db2e86ef63f2f240fa0a337ae853c4
20260423190000_force_rls_on_pilot_tables|5baf63e785b90798c975acb39f3c296b18abbe1686d68433d69e8180a6a9e718
20260423203000_add_payment_receipt_columns|5e96a8dbd3f9d1458859eff22d2c519fe466983d11a6770475170d4d120458c4
20260425000000_add_p2a_monthly_snapshots|ed63828b9d8aed97b50d6f608e3a8ad9572d7439c8a2518b3902445390e788f9
20260426000000_add_p2b_processes|c6208329e3de48bec445b7f16f086ea44b5205672d4892a31ef0b921a3d3a0ce
20260430080000_add_assistant_handoffs_hitl|a7b1c9197a5ed2eb6632defaa8004ec61100547e8b7525ada54144278cd2fce2
20260430080000_fix_assistant_tables|13a514bbd0ee4fe57d7cc86900b33ab9151852b49a911d5764a4e65a5678c1c0
20260430143000_add_assistant_messages|00b8d0587fb86f4722212d22d55c78e63b89e71b2bfce6110d8cadfcdc7b9066
20260430190000_add_ops_alerts_and_metrics|dbdff14e1dd47f19fdfcc73bd980d6524b0584b025694513ac507f71b53ae057
20260430195000_add_assistant_handoff_audit_schema|5154a91250d3673ef49618c7ddac3d9a071ca8c04f9db9cc3a86ff7c9b8b2e7d
20260430200000_fix_assistant_handoff_timestamps_for_ops_metrics|14fa069cf443726eeb5d8b77eb4804bc80a9347f489f56a4468fc84ebf22c8be
20260510000000_expand_tenant_scope_non_breaking|357c95062d1675dbe4ecc61ec6b12e7a252501155dcaa867ca13c7da9b4bae65
20260510000001_enforce_tenant_scope_non_breaking|0eccb0c129365d4b26fd4ab89cccf37c5406f6b84e5ad8e21eba1bd992e74eb0
20260511193000_add_building_soft_delete|a39936bee573ba14bb760c5ccf59437cfe8a165498c5494fb2a18e1597ccb026
20260616000000_add_payment_email_provider_models|1ac19e32a01c5959e25b5bb3020332e4ad54416e43f92c17222b4e7f847d9d63
20260616000001_add_tenant_next_building_alias_index|57760db4d77c7c8ae39527b965dd5aac09825b6f8240efb2234f953edd824ee5
20260616000002_add_tenant_is_demo|541ba38d7d5b18c5e5318b013558fe0bdc12091fa049ded6c277fac97466a942
20260630110000_add_liquidation_charge_uniqueness|809f92ab4bbe56749d620c9710efe81db3ce3ead12fcc9b5de27655af4fcd3e8
20260703000000_add_auth_sessions|a86391524eb8eeaffe245f906677244c419428aae8bda60739799f006867e4cb
20260711000000_add_liquidation_publication_snapshot|1782d0567ab850fa3cf06d93e9b4ffd4ba9b94f25d48f130df0d42c45643b73e
20260714000000_add_onboarding_imports|130337860f184bef084dba61e21e91dcf2de413e09c3199a4975053ec358fc56
20260715000000_add_onboarding_import_confirmation|a8bb343ca7d90bdb9711cb77261234903833a4b45b48b09ffe8abbb85f715ca4
20260719000000_add_receipt_sequence|93c6d2c0b8c4468fea26489cfb4875bfdc6763ec0056487c21094eae0dbcb257
20260720000000_version_onboarding_import_preview_identity|dedb32ace6e3f7e0cb2dbc30565d76f7fb7d91d59b67e652b21e849f8f708972
20260805000000_add_receipt_generated_to_payment_audit_action|2eca33fa948a8374c8e9df65b1ad03396b6e60618c2908eb76500ce24f314281
20260807000000_add_recurring_expense_tenant_shared|73c11f3ae0bc2946b0292b6a7e19415922c215a0099725ccffad7dfd5792b7e5
20260809000000_add_multicurrency_foundation|72387a00d29fc206601f175d09e858c8ef977b040f5b0b7828d2d6ba553580d8
20260810000000_add_expense_multicurrency_snapshot|9fabbda282282973458afde3f7c827882423e242b8a0ae4fa7fec41cb23f61d8
20260810010000_add_income_multicurrency_snapshot|272cb4d1a2f574b97eb119c2085969680acebe97dfb3b5b64ed7c21df5253598
20260810020000_add_adjustment_multicurrency_snapshot|01389a6aaa6b28913dc47929b32ea93036bd113d228dff44600910dae4c6cd64
20260810030000_add_liquidation_functional_valuation|a5ac79fe256dc8efd47b283c79d5326ed48098a6706432b26f8e593eab7785b7
20260811000000_add_payment_multicurrency_snapshot|13db688679ee726a37a3380dc3375e2ee55f0bbc516bfc440c47c9fe72b4227e
20260812000000_add_payment_allocation_original_share|857e76ba79b6ce52adba7e07bbda723a33ab0db76cfb55f3de177a1892f65832
20260814000000_add_funds_ledger|beadcf1d433740e224b64e6a7bcbc0d985bb8fbe92a7e43f15b3f2ad271419c9
20260815000000_add_income_applications|b73832c8cb8715ebc895270c26913f9a0e7c28cc55efd1e7b66810d11a608d08
20260816000000_add_income_policies|0b291960b38677ad95a70608f998865d8819378a26cf3ba989ae9ec13a63a345
20260816000001_income_policy_createdby_setnull|668bddb7cb548119979a72a22df26b3e1aca656a4b1fb07d419ecd5e526d2fc3
20260816000002_income_offsets_to_liquidations|c18ed0093da20da89e3e627ca1457349f1d36da93c1e11f914f4b8ace4aa654f
20260816000003_liquidation_income_offset_invariants|4ff212a16eda9e32db64b28b8eb56f29a2ee5ccb5fbb034af56a7b7cad8fc6d9
20260816000004_legacy_income_application_provenance|f77a48381a9d32198b34f3ed92465190f8f6284ec80cc4916c304ec776905a2b
20260831000000_add_payment_receipt_issuance_snapshot|36e92c7ae5a01b9193daec266183441ece906b123981154ad8d5a59f157468d0
20260905000000_add_object_version_identity|3161d9f1ece049e80d4e8cd14f301a73f86605e4405059777b8ea1ab6b9324c5
20260906000000_add_liquidation_distribution_snapshot|63fed2df75bb5becb0dfc68ad55e9627797624ddeb106462783ac6d9c03da1cb
20260913000000_add_phase3d2_publication_integrity|7743eb93ee3355c3bb47903fc1bbf69273e7d0af788c4b503ec86da2879ed312
20260914000000_allow_authorized_parent_cascades|f8140bdf0ed05a5cec11e1f255eeae93d26c968455a0ce0eb18f38a972cfbeec
20260915000000_align_liquidation_valuation_mode_enum|e9c837990efc95d356c8755881a3b3a48c4e1b861c62852bc0aaaa8af58f4608
20260916000000_harden_phase3d2_distribution_integrity|fcd9d2b86ad38ad40e2f6c30ccab201d612433a42f3656e5287d7b5167eb677d
20260917000000_harden_phase3d2_nullable_publication_validation|aa926621eb544bb6d243e1c6c6d76dcf13a1c8e8b7c541b1030982984b8b4b83
20260918000000_enforce_modern_distribution_unit_ownership|5932afb02d9a47bab3ff779bad155b293acf4a31d7a4da91ef17b7501fe1dfa1
20260919000000_release_a_dual_liquidation_compatibility|1684ae7a56af3d957d5ff01d3ef352a6973104e40ddf9bca342b283111be2777
MIGRATION_INVENTORY
}

validate_database_migration_set() {
  local app_dir="$1" runtime_sha="$2" rows line name checksum started finished rolled_back applied_steps extra without_tabs tab_count query_rc found duplicate
  local active=0
  local -a expected_rows=() seen_names=()

  AUDIT_DATABASE_MIGRATION_SET='UNKNOWN'
  [[ "$runtime_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Za-z0-9][A-Za-z0-9_-]*)\|([0-9a-f]{64})$ ]] || return 1
    expected_rows+=("$line")
  done < <(expected_migration_rows)
  [[ "${#expected_rows[@]}" -eq 107 ]] || return 1

  if rows="$(readonly_query_stdin 2>/dev/null <<'SQL'
BEGIN READ ONLY;
SELECT COALESCE(migration_name, '<NULL>') || E'\t' || COALESCE(checksum, '<NULL>')
       || E'\t' || CASE WHEN started_at IS NOT NULL THEN '1' ELSE '0' END
       || E'\t' || CASE WHEN finished_at IS NOT NULL THEN '1' ELSE '0' END
       || E'\t' || CASE WHEN rolled_back_at IS NOT NULL THEN '1' ELSE '0' END
       || E'\t' || COALESCE(applied_steps_count::text, '<NULL>')
FROM "_prisma_migrations"
ORDER BY migration_name;
COMMIT;
SQL
)"; then
    :
  else
    query_rc=$?
    if [[ "$query_rc" -eq 64 ]]; then
      record_query_failure "$query_rc"
    else
      AUDIT_QUERY_FAILURES=$((AUDIT_QUERY_FAILURES + 1))
    fi
    return 1
  fi
  [[ -n "$rows" ]] || return 1
  while IFS= read -r line; do
    [[ -n "$line" ]] || return 1
    without_tabs="${line//$'\t'/}"
    tab_count=$((${#line} - ${#without_tabs}))
    [[ "$tab_count" -eq 5 && "$line" != $'\t'* && "$line" != *$'\t' && "$line" != *$'\t\t'* ]] || return 1
    IFS=$'\t' read -r name checksum started finished rolled_back applied_steps extra <<< "$line"
    [[ -n "$name" && -n "$checksum" && -n "$applied_steps" && -z "${extra:-}" ]] || return 1
    [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ && "$checksum" =~ ^[0-9a-f]{64}$ ]] || return 1
    [[ "$started" == 1 && "$finished" == 1 && "$rolled_back" == 0 ]] || return 1
    [[ "$applied_steps" =~ ^(0|[1-9][0-9]*)$ ]] || return 1
    duplicate=false
    for line in "${seen_names[@]:-}"; do [[ "$line" != "$name" ]] || duplicate=true; done
    [[ "$duplicate" == false ]] || return 1
    seen_names+=("$name")
    found=false
    for line in "${expected_rows[@]}"; do
      if [[ "$line" == "$name|$checksum" ]]; then found=true; break; fi
    done
    [[ "$found" == true ]] || return 1
    if [[ "$name" == '20260719000000_add_receipt_sequence' && "$checksum" == '93c6d2c0b8c4468fea26489cfb4875bfdc6763ec0056487c21094eae0dbcb257' ]]; then
      [[ "$applied_steps" == 0 || "$applied_steps" == 1 ]] || return 1
    else
      [[ "$applied_steps" == 1 ]] || return 1
    fi
    active=$((active + 1))
  done <<< "$rows"
  [[ "$active" -eq 107 && "${#seen_names[@]}" -eq 107 ]] || return 1
  for line in "${expected_rows[@]}"; do
    name="${line%%|*}"
    found=false
    for checksum in "${seen_names[@]}"; do [[ "$checksum" != "$name" ]] || found=true; done
    [[ "$found" == true ]] || return 1
  done
  AUDIT_DATABASE_MIGRATION_SET='PASS'
}

report_runtime_identity() {
  local app_dir="${1:-$APP_DIR}"
  local selector="${2:-$CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR}"
  local deployments_root="${3:-$DEPLOYMENTS_ROOT}"
  local production_sha='UNKNOWN'
  local api_revision='UNKNOWN'
  local web_revision='UNKNOWN'
  local checkout_status='UNKNOWN'
  local identity='UNKNOWN'
  local status_output from_sha migration_count

  RUNTIME_APP_SHA='UNKNOWN'
  AUDIT_DATABASE_MIGRATION_SET='NOT_EVALUATED'
  if [[ -d "$app_dir/.git" ]]; then
    production_sha="$(git -C "$app_dir" rev-parse HEAD 2>/dev/null || printf 'UNKNOWN')"
    if [[ "$production_sha" =~ ^[0-9a-f]{40}$ ]]; then
      if status_output="$(git -C "$app_dir" status --porcelain --untracked-files=all 2>/dev/null)" && [[ -z "$status_output" ]] && checkout_has_only_approved_ignored_files "$app_dir"; then
        checkout_status='CLEAN'
      else
        checkout_status='DIRTY'
      fi
    fi
  fi
  RUNTIME_API_IMAGE_ID="$(container_image_id "$API_CONTAINER" 2>/dev/null || printf 'UNKNOWN')"
  RUNTIME_WEB_IMAGE_ID="$(container_image_id "$WEB_CONTAINER" 2>/dev/null || printf 'UNKNOWN')"
  api_revision="$(container_revision "$API_CONTAINER" 2>/dev/null || printf 'UNKNOWN')"
  web_revision="$(container_revision "$WEB_CONTAINER" 2>/dev/null || printf 'UNKNOWN')"

  printf 'CANDIDATE_SHA=%s\n' "$CANDIDATE_SHA"
  printf 'PRODUCTION_CHECKOUT_SHA=%s\n' "$production_sha"
  printf 'PRODUCTION_CHECKOUT_STATUS=%s\n' "$checkout_status"
  printf 'RUNTIME_API_SHA=%s\n' "$api_revision"
  printf 'RUNTIME_WEB_SHA=%s\n' "$web_revision"
  printf 'API_REVISION=%s\n' "$api_revision"
  printf 'WEB_REVISION=%s\n' "$web_revision"

  if [[ "$checkout_status" == 'CLEAN' && "$production_sha" =~ ^[0-9a-f]{40}$ && "$api_revision" =~ ^[0-9a-f]{40}$ && "$web_revision" =~ ^[0-9a-f]{40}$ && "$api_revision" == "$web_revision" ]]; then
    if [[ "$production_sha" == "$api_revision" ]]; then
      RUNTIME_APP_SHA="$api_revision"
      identity='CONSISTENT'
    elif validate_current_successful_deployment_selector_binding "$selector" "$deployments_root" "$api_revision" "$RUNTIME_API_IMAGE_ID" "$RUNTIME_WEB_IMAGE_ID"; then
      from_sha="$(strict_key_value "$SELECTED_SUCCESSFUL_DEPLOYMENT_RECORD" from_sha 2>/dev/null || true)"
      migration_count="$(strict_key_value "$SELECTED_SUCCESSFUL_DEPLOYMENT_RECORD" migration_count 2>/dev/null || true)"
      if [[ "$from_sha" == "$production_sha" && "$migration_count" == '107' \
        && "$AUDIT_ACTIVE_FINISHED_MIGRATIONS" =~ ^(0|[1-9][0-9]*)$ \
        && "$AUDIT_ACTIVE_FINISHED_MIGRATIONS" == '107' \
        && "$AUDIT_FAILED_MIGRATIONS" =~ ^(0|[1-9][0-9]*)$ \
        && "$AUDIT_FAILED_MIGRATIONS" == '0' ]]; then
        if validate_database_migration_set "$app_dir" "$api_revision"; then
          RUNTIME_APP_SHA="$api_revision"
          identity='RECOVERED_SPLIT'
        fi
      fi
    fi
  fi

  printf 'RUNTIME_APP_SHA=%s\n' "$RUNTIME_APP_SHA"
  printf 'RUNTIME_IDENTITY=%s\n' "$identity"
  printf 'DATABASE_MIGRATION_SET=%s\n' "${AUDIT_DATABASE_MIGRATION_SET:-NOT_EVALUATED}"
  if [[ "$identity" == 'UNKNOWN' ]]; then
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
    record_query_failure "$?"
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
  report_query_stdin 'NEGATIVE_PAYMENT_ALLOCATIONS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "PaymentAllocation" WHERE amount <= 0;
COMMIT;
SQL
  report_query_stdin 'NEGATIVE_PAYMENT_ORIGINAL_ALLOCATIONS' <<'SQL'
BEGIN READ ONLY;
SELECT count(*) FROM "PaymentAllocation" WHERE "paymentOriginalAmountMinor" < 0;
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
         bool_or(c.currency = p.currency
                 AND a."paymentOriginalAmountMinor" IS NOT NULL
                 AND a."paymentOriginalAmountMinor" <> a.amount) AS inconsistent_same_currency_share,
         bool_or(c.currency <> p."functionalCurrencyCode") AS functional_currency_unverifiable,
         COALESCE(sum(
           CASE
             WHEN c.currency = p.currency THEN a.amount
             WHEN a."paymentOriginalAmountMinor" IS NOT NULL THEN a."paymentOriginalAmountMinor"
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
       || '|' || count(*) FILTER (WHERE inconsistent_same_currency_share)
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
    local definite_overallocations unverifiable_overallocations inconsistent_same_currency_shares functional_definite_overallocations functional_unverifiable_overallocations
    IFS='|' read -r definite_overallocations unverifiable_overallocations inconsistent_same_currency_shares functional_definite_overallocations functional_unverifiable_overallocations <<< "$value"
    if [[ "$definite_overallocations" =~ ^[0-9]+$ && "$unverifiable_overallocations" =~ ^[0-9]+$ && "$inconsistent_same_currency_shares" =~ ^[0-9]+$ && "$functional_definite_overallocations" =~ ^[0-9]+$ && "$functional_unverifiable_overallocations" =~ ^[0-9]+$ ]]; then
      printf 'OVER_ALLOCATIONS_DEFINITE=%s\n' "$definite_overallocations"
      printf 'OVER_ALLOCATIONS_UNVERIFIABLE=%s\n' "$unverifiable_overallocations"
      printf 'INCONSISTENT_SAME_CURRENCY_SHARES=%s\n' "$inconsistent_same_currency_shares"
      printf 'OVER_ALLOCATIONS_FUNCTIONAL_DEFINITE=%s\n' "$functional_definite_overallocations"
      printf 'OVER_ALLOCATIONS_FUNCTIONAL_UNVERIFIABLE=%s\n' "$functional_unverifiable_overallocations"
    else
      AUDIT_QUERY_FAILURES=$((AUDIT_QUERY_FAILURES + 1))
      printf 'OVER_ALLOCATIONS_DEFINITE=UNKNOWN\nOVER_ALLOCATIONS_UNVERIFIABLE=UNKNOWN\nINCONSISTENT_SAME_CURRENCY_SHARES=UNKNOWN\nOVER_ALLOCATIONS_FUNCTIONAL_DEFINITE=UNKNOWN\nOVER_ALLOCATIONS_FUNCTIONAL_UNVERIFIABLE=UNKNOWN\n'
    fi
  else
    record_query_failure "$?"
    printf 'OVER_ALLOCATIONS_DEFINITE=UNKNOWN\nOVER_ALLOCATIONS_UNVERIFIABLE=UNKNOWN\nINCONSISTENT_SAME_CURRENCY_SHARES=UNKNOWN\nOVER_ALLOCATIONS_FUNCTIONAL_DEFINITE=UNKNOWN\nOVER_ALLOCATIONS_FUNCTIONAL_UNVERIFIABLE=UNKNOWN\n'
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
         ,bool_or(p.currency <> c.currency AND
           p."functionalCurrencyCode" IS NULL
           AND p."functionalAmountMinor" IS NULL
           AND p."exchangeRateId" IS NULL
           AND p."exchangeRateValue" IS NULL
           AND p."exchangeRateDirection" IS NULL
           AND p."exchangeRateEffectiveAt" IS NULL
           AND p."conversionDate" IS NULL) AS has_legacy_cross_currency
         ,bool_or(p.currency <> c.currency AND (
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
  AND (has_same_currency OR (has_invalid_cross_currency AND (NOT has_legacy_cross_currency OR has_conversion_metadata)));
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
    record_query_failure "$?"
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
        [[ "$versioning" == 'Enabled' ]] && versioning_ok=true
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

validate_pg_restore_list() {
  local dump="$1"

  if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --list "$dump" >/dev/null 2>&1
    return
  fi
  container_exists "$POSTGRES_CONTAINER" || return 2
  docker exec -i "$POSTGRES_CONTAINER" pg_restore --list < "$dump" >/dev/null 2>&1
}

file_owner() {
  stat -L -c '%U' -- "$1" 2>/dev/null || stat -L -f '%Su' "$1"
}

file_group() {
  stat -L -c '%G' -- "$1" 2>/dev/null || stat -L -f '%Sg' "$1"
}

file_mode() {
  stat -L -c '%a' -- "$1" 2>/dev/null || stat -L -f '%Lp' "$1"
}

file_identity() {
  stat -L -c '%d:%i' -- "$1" 2>/dev/null || stat -L -f '%i' "$1"
}

manifest_field() {
  local manifest="$1"
  local key="$2"

  awk -F '=' -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$manifest"
}

state_field() {
  local state_file="$1"
  local key="$2"

  awk -F '=' -v key="$key" '$1 == key { value=substr($0, index($0, "=") + 1); count++; } END { if (count != 1) exit 1; print value }' "$state_file"
}

parse_epoch() {
  local timestamp="$1"

  [[ "$timestamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1
  date -u -d "$timestamp" +%s 2>/dev/null || date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$timestamp" +%s 2>/dev/null
}

validate_backup_manifest() {
  local manifest="$1"
  local expected_manifest manifest_snapshot

  [[ -f "$manifest" && ! -L "$manifest" ]] || return 1
  manifest_snapshot="$(cat -- "$manifest"; printf '__BUILDINGOS_MANIFEST_END__')" || return 1
  manifest_snapshot="${manifest_snapshot%__BUILDINGOS_MANIFEST_END__}"
  printf -v expected_manifest '%s\npath=%s\nsha256=%s\nowner=%s\ngroup=%s\nmode=%s\n' \
    "version=$BACKUP_IDENTITY_VERSION" "$BACKUP_SCRIPT_PATH" "$BACKUP_SCRIPT_SHA256" \
    "$BACKUP_SCRIPT_OWNER" "$BACKUP_SCRIPT_GROUP" "$BACKUP_SCRIPT_MODE"
  [[ "$manifest_snapshot" == "$expected_manifest" ]]
}

require_canonical_directory_without_symlinks() {
  local directory="$1"
  local component current canonical
  local -a components=()

  [[ "$directory" == /* && "$directory" != '/' && "$directory" != *'//'* && "$directory" != *'/./'* && "$directory" != *'/../'* && "$directory" != */. && "$directory" != */.. && "$directory" != */ ]] || return 1
  [[ -d "$directory" ]] || return 1
  IFS='/' read -r -a components <<< "${directory#/}"
  current=''
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || return 1
    current="$current/$component"
    [[ ! -L "$current" ]] || return 1
  done
  canonical="$(cd -P -- "$directory" && pwd -P)" || return 1
  [[ "$canonical" == "$directory" ]]
}

canonical_private_regular_file_under_root() {
  local file="$1" root="$2" parent

  [[ "$file" == "$root/"* && "$file" != *'//'* && "$file" != *'/./'* && "$file" != *'/../'* ]] || return 1
  parent="${file%/*}"
  require_canonical_directory_without_symlinks "$root" || return 1
  require_canonical_directory_without_symlinks "$parent" || return 1
  [[ -f "$file" && ! -L "$file" && "$(file_mode "$file")" == 600 ]] || return 1
  [[ "$(file_owner "$file")" == "$(file_owner "$root")" && "$(file_group "$file")" == "$(file_group "$root")" ]]
}

canonical_private_directory_under_root() {
  local directory="$1" root="$2"

  [[ "$directory" == "$root/"* && "$directory" != *'//'* && "$directory" != *'/./'* && "$directory" != *'/../'* ]] || return 1
  require_canonical_directory_without_symlinks "$root" || return 1
  require_canonical_directory_without_symlinks "$directory" || return 1
  [[ "$(file_mode "$directory")" == 700 && "$(file_owner "$directory")" == "$(file_owner "$root")" && "$(file_group "$directory")" == "$(file_group "$root")" ]]
}

strict_key_value() {
  local file="$1" key="$2"

  awk -F '=' -v key="$key" '
    $1 == key { value=substr($0, index($0, "=") + 1); count++; }
    END { if (count != 1 || value == "") exit 1; print value }
  ' "$file"
}

sha256_sidecar_matches() {
  local artifact="$1" sidecar="$2" expected="$3" actual sidecar_value

  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || return 1
  actual="$(sha256sum -- "$artifact" | awk '{print $1}')" || return 1
  sidecar_value="$(< "$sidecar")" || return 1
  [[ "$actual" == "$expected" && "$sidecar_value" == "$expected" ]]
}

validate_current_successful_deployment_selector_binding() {
  local selector="$1" deployments_root="$2" runtime_sha="$3" runtime_api_image_id="${4:-}" runtime_web_image_id="${5:-}"
  local selector_format selector_record selector_target record_status record_target
  local new_api_count new_web_count rollback_api_count rollback_web_count record_api_image_id record_web_image_id

  SELECTED_SUCCESSFUL_DEPLOYMENT_RECORD=''
  [[ "$runtime_sha" =~ ^[0-9a-f]{40}$ && "$selector" == "$deployments_root/current-successful-deployment.v1" ]] || return 1
  canonical_private_regular_file_under_root "$selector" "$deployments_root" || return 1
  [[ "$(awk 'END { print NR }' "$selector")" == 3 ]] || return 1
  selector_format="$(strict_key_value "$selector" format)" || return 1
  selector_record="$(strict_key_value "$selector" record_path)" || return 1
  selector_target="$(strict_key_value "$selector" target_sha)" || return 1
  [[ "$selector_format" == 'buildingos-current-successful-deployment/v1' && "$selector_target" == "$runtime_sha" ]] || return 1
  canonical_private_regular_file_under_root "$selector_record" "$deployments_root" || return 1
  record_status="$(strict_key_value "$selector_record" status)" || return 1
  record_target="$(strict_key_value "$selector_record" target_sha)" || return 1
  [[ "$record_status" == SUCCESS && "$record_target" == "$runtime_sha" ]] || return 1
  if [[ -n "$runtime_api_image_id" || -n "$runtime_web_image_id" ]]; then
    [[ "$runtime_api_image_id" =~ ^sha256:[0-9a-f]{64}$ && "$runtime_web_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
    new_api_count="$(awk -F '=' '$1 == "new_api_digest" { count++ } END { print count + 0 }' "$selector_record")"
    new_web_count="$(awk -F '=' '$1 == "new_web_digest" { count++ } END { print count + 0 }' "$selector_record")"
    rollback_api_count="$(awk -F '=' '$1 == "api_digest" { count++ } END { print count + 0 }' "$selector_record")"
    rollback_web_count="$(awk -F '=' '$1 == "web_digest" { count++ } END { print count + 0 }' "$selector_record")"
    if [[ "$new_api_count" == 1 && "$new_web_count" == 1 && "$rollback_api_count" == 0 && "$rollback_web_count" == 0 ]]; then
      record_api_image_id="$(strict_key_value "$selector_record" new_api_digest)" || return 1
      record_web_image_id="$(strict_key_value "$selector_record" new_web_digest)" || return 1
    elif [[ "$new_api_count" == 0 && "$new_web_count" == 0 && "$rollback_api_count" == 1 && "$rollback_web_count" == 1 ]]; then
      record_api_image_id="$(strict_key_value "$selector_record" api_digest)" || return 1
      record_web_image_id="$(strict_key_value "$selector_record" web_digest)" || return 1
    else
      return 1
    fi
    [[ "$record_api_image_id" == "$runtime_api_image_id" && "$record_web_image_id" == "$runtime_web_image_id" ]] || return 1
  fi
  SELECTED_SUCCESSFUL_DEPLOYMENT_RECORD="$selector_record"
}

validate_selected_successful_deployment_recovery_point() {
  local selector_record="$1" recovery_root="$2"
  local recovery_id receipt bundle receipt_hash source_sha remote_root

  RECOVERY_POINT_POSTGRES_BACKUP_EVIDENCE_STATUS='INCOMPLETE'
  RECOVERY_POINT_REFERENCE_RECONCILIATION_STATUS='INCOMPLETE'
  RECOVERY_POINT_CONTENT_IDENTITY_STATUS='INCOMPLETE'
  local input_hash content_hash dump_hash dump_bytes references unique actual_hash actual_bytes

  recovery_id="$(strict_key_value "$selector_record" recovery_point_id)" || return 1
  receipt="$(strict_key_value "$selector_record" recovery_point_receipt_path)" || return 1
  bundle="$(strict_key_value "$selector_record" recovery_point_bundle_path)" || return 1
  receipt_hash="$(strict_key_value "$selector_record" recovery_point_receipt_sha256)" || return 1
  source_sha="$(strict_key_value "$selector_record" recovery_point_source_sha)" || return 1
  remote_root="$(strict_key_value "$selector_record" recovery_point_remote_root)" || return 1
  [[ "$recovery_id" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ && "$receipt_hash" =~ ^[0-9a-f]{64}$ && "$source_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ "$receipt" != NOT_EVALUATED && "$bundle" != NOT_EVALUATED && "$remote_root" != NOT_EVALUATED ]] || return 1
  canonical_private_directory_under_root "$bundle" "$recovery_root" || return 1
  [[ "$receipt" == "$bundle/metadata/recovery-point-receipt.json" ]] || return 1
  canonical_private_regular_file_under_root "$receipt" "$recovery_root" || return 1
  actual_hash="$(sha256sum -- "$receipt")" || return 1
  [[ "${actual_hash%% *}" == "$receipt_hash" ]] || return 1

  jq -e --arg id "$recovery_id" --arg source "$source_sha" --arg remote "$remote_root" '
    (keys | sort) == ["backupSetId", "completedAtUtc", "contentManifestSha256", "databaseDump", "format", "inputManifestSha256", "referenceCount", "remoteRoot", "sourceAppSha", "startedAtUtc", "status", "statuses", "uniqueObjectCount"]
    and .format == "buildingos-recovery-point/v1" and .status == "PASS"
    and .backupSetId == $id and .sourceAppSha == $source and .remoteRoot == $remote
    and (.startedAtUtc | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
    and (.completedAtUtc | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
    and (.inputManifestSha256 | type == "string" and test("^[0-9a-f]{64}$"))
    and (.contentManifestSha256 | type == "string" and test("^[0-9a-f]{64}$"))
    and (.databaseDump | type == "object" and (keys | sort) == ["bytes", "sha256"] and (.sha256 | type == "string" and test("^[0-9a-f]{64}$")) and (.bytes | type == "number" and floor == . and . >= 0))
    and (.referenceCount | type == "number" and floor == . and . >= 0)
    and (.uniqueObjectCount | type == "number" and floor == . and . >= 0)
    and (.statuses | type == "object" and (keys | sort) == ["contentIdentity", "contentManifest", "databaseArchive", "hashes", "inputManifest", "referenceCount", "remoteDump"] and all(.[]; . == "PASS"))
  ' "$receipt" >/dev/null || return 1

  input_hash="$(jq -er '.inputManifestSha256' "$receipt")" || return 1
  content_hash="$(jq -er '.contentManifestSha256' "$receipt")" || return 1
  dump_hash="$(jq -er '.databaseDump.sha256' "$receipt")" || return 1
  dump_bytes="$(jq -er '.databaseDump.bytes' "$receipt")" || return 1
  references="$(jq -er '.referenceCount' "$receipt")" || return 1
  unique="$(jq -er '.uniqueObjectCount' "$receipt")" || return 1
  canonical_private_regular_file_under_root "$bundle/file-manifest.json" "$recovery_root" || return 1
  canonical_private_regular_file_under_root "$bundle/file-manifest.sha256" "$recovery_root" || return 1
  canonical_private_regular_file_under_root "$bundle/metadata/reference-content-manifest.json" "$recovery_root" || return 1
  canonical_private_regular_file_under_root "$bundle/metadata/reference-content-manifest.sha256" "$recovery_root" || return 1
  canonical_private_regular_file_under_root "$bundle/metadata/recovery-point-receipt.sha256" "$recovery_root" || return 1
  canonical_private_regular_file_under_root "$bundle/postgresql/buildingos_${recovery_id}.dump" "$recovery_root" || return 1
  sha256_sidecar_matches "$receipt" "$bundle/metadata/recovery-point-receipt.sha256" "$receipt_hash" || return 1
  sha256_sidecar_matches "$bundle/file-manifest.json" "$bundle/file-manifest.sha256" "$input_hash" || return 1
  sha256_sidecar_matches "$bundle/metadata/reference-content-manifest.json" "$bundle/metadata/reference-content-manifest.sha256" "$content_hash" || return 1
  [[ "$(sha256sum -- "$bundle/postgresql/buildingos_${recovery_id}.dump" | awk '{print $1}')" == "$dump_hash" ]] || return 1
  actual_bytes="$(wc -c < "$bundle/postgresql/buildingos_${recovery_id}.dump")"; actual_bytes="${actual_bytes//[[:space:]]/}"
  [[ "$actual_bytes" == "$dump_bytes" ]] || return 1
  validate_pg_restore_list "$bundle/postgresql/buildingos_${recovery_id}.dump" || return 1
  RECOVERY_POINT_POSTGRES_BACKUP_EVIDENCE_STATUS='PASS'
  jq -e --argjson references "$references" --argjson unique "$unique" '
    type == "array" and length == $references
    and ([.[].id] | unique | length) == length
    and all(.[]; type == "object" and (keys | sort) == ["bucket", "checksum", "id", "objectKey", "objectVersionId", "size", "tenantId"]
      and (.id | type == "string" and length > 0) and (.tenantId | type == "string" and length > 0)
      and (.bucket | type == "string" and length > 0) and (.objectKey | type == "string" and length > 0)
      and (.objectVersionId == null or (.objectVersionId | type == "string" and length > 0))
      and (.size | type == "number" and floor == . and . >= 0) and (.checksum == null or (.checksum | type == "string")))
    and ([.[] | .bucket + "\u0000" + .objectKey + "\u0000" + (if .objectVersionId == null then "" else .objectVersionId end)] | unique | length) >= $unique
  ' "$bundle/file-manifest.json" >/dev/null || return 1
  jq -e --slurpfile manifest "$bundle/file-manifest.json" --argjson references "$references" --argjson unique "$unique" '
    type == "array" and length == $references
    and ([.[].id] | unique | length) == $references
    and ([.[].identitySha256] | unique | length) == $unique
    and ([.[].destinationObjectPath] | unique | length) == $unique
    and all(.[]; . as $row
      | type == "object" and (keys | sort) == ["bucket", "capturedObjectVersionId", "checksum", "destinationObjectPath", "id", "identitySha256", "objectKey", "objectVersionId", "size", "sourceContentBytes", "sourceContentSha256", "tenantId"]
      and (.identitySha256 | type == "string" and test("^[0-9a-f]{64}$"))
      and (.sourceContentSha256 | type == "string" and test("^[0-9a-f]{64}$"))
      and (.sourceContentBytes | type == "number" and floor == . and . >= 0)
      and (.destinationObjectPath == ("objects/" + .identitySha256 + ".blob"))
      and (.capturedObjectVersionId == null or (.capturedObjectVersionId | type == "string" and length > 0))
      and ([$manifest[0][] | select(.id == $row.id)] | length) == 1
      and ([$manifest[0][] | select(.id == $row.id)][0] | {id, tenantId, bucket, objectKey, objectVersionId, size, checksum}) == ($row | {id, tenantId, bucket, objectKey, objectVersionId, size, checksum}))
  ' "$bundle/metadata/reference-content-manifest.json" >/dev/null || return 1
  RECOVERY_POINT_REFERENCE_RECONCILIATION_STATUS='PASS'

  local expected_blob_paths destination content_digest content_bytes blob actual_blob_digest actual_blob_bytes
  expected_blob_paths="$(jq -r '.[].destinationObjectPath' "$bundle/metadata/reference-content-manifest.json")" || return 1
  while IFS=$'\t' read -r destination content_digest content_bytes; do
    [[ "$destination" =~ ^objects/[a-f0-9]{64}\.blob$ && "$content_digest" =~ ^[0-9a-f]{64}$ && "$content_bytes" =~ ^[0-9]+$ ]] || return 1
    blob="$bundle/$destination"
    canonical_private_regular_file_under_root "$blob" "$recovery_root" || return 1
    actual_blob_digest="$(sha256sum -- "$blob" | awk '{print $1}')" || return 1
    actual_blob_bytes="$(wc -c < "$blob")"; actual_blob_bytes="${actual_blob_bytes//[[:space:]]/}"
    [[ "$actual_blob_digest" == "$content_digest" && "$actual_blob_bytes" == "$content_bytes" ]] || return 1
  done < <(jq -r '.[] | [.destinationObjectPath, .sourceContentSha256, (.sourceContentBytes | tostring)] | @tsv' "$bundle/metadata/reference-content-manifest.json")

  while IFS= read -r blob; do
    [[ "$blob" == "$bundle/objects/"* ]] || return 1
    destination="${blob#"$bundle/"}"
    printf '%s\n' "$expected_blob_paths" | grep -Fqx -- "$destination" || return 1
  done < <(find "$bundle/objects" -mindepth 1 -print)
  RECOVERY_POINT_CONTENT_IDENTITY_STATUS='PASS'
}

validate_current_successful_deployment_selector() {
  local selector="$1" deployments_root="$2" recovery_root="$3" runtime_sha="$4"

  validate_current_successful_deployment_selector_binding "$selector" "$deployments_root" "$runtime_sha" || return 1
  validate_selected_successful_deployment_recovery_point "$SELECTED_SUCCESSFUL_DEPLOYMENT_RECORD" "$recovery_root"
}

report_recovery_point_selector() {
  local selector="${1:-$CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR}"
  local deployments_root="${2:-$DEPLOYMENTS_ROOT}"
  local recovery_root="${3:-$RECOVERY_POINTS_ROOT}"
  local runtime_sha="${4:-$RUNTIME_APP_SHA}"
  local runtime_api_image_id="${5-$RUNTIME_API_IMAGE_ID}"
  local runtime_web_image_id="${6-$RUNTIME_WEB_IMAGE_ID}"
  local selector_status='NOT_EVALUATED'
  local recovery_status='NOT_EVALUATED'

  RECOVERY_POINT_POSTGRES_BACKUP_EVIDENCE_STATUS='INCOMPLETE'
  RECOVERY_POINT_REFERENCE_RECONCILIATION_STATUS='INCOMPLETE'
  RECOVERY_POINT_CONTENT_IDENTITY_STATUS='INCOMPLETE'
  if [[ "$runtime_sha" =~ ^[0-9a-f]{40}$ ]] && validate_current_successful_deployment_selector_binding "$selector" "$deployments_root" "$runtime_sha" "$runtime_api_image_id" "$runtime_web_image_id"; then
    selector_status='PASS'
    if validate_selected_successful_deployment_recovery_point "$SELECTED_SUCCESSFUL_DEPLOYMENT_RECORD" "$recovery_root"; then
      recovery_status='PASS'
    else
      AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
    fi
  else
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
  fi
  RECOVERY_POINT_AUDIT_STATUS="$recovery_status"
  RECOVERY_POINT_SELECTOR_REPORTED=true
  printf 'CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR=%s\n' "$selector_status"
}

validate_backup_script_file() {
  local script_path="$1"
  local parent owner group mode digest identity_before identity_after owner_after group_after mode_after

  [[ "$script_path" == "$BACKUP_SCRIPT_PATH" ]] || return 1
  parent="${script_path%/*}"
  require_canonical_directory_without_symlinks "$parent" || return 1
  [[ -f "$script_path" && ! -L "$script_path" ]] || return 1
  identity_before="$(file_identity "$script_path")" || return 1
  owner="$(file_owner "$script_path")" || return 1
  group="$(file_group "$script_path")" || return 1
  mode="0$(file_mode "$script_path")" || return 1
  [[ "$owner" == "$BACKUP_SCRIPT_OWNER" && "$group" == "$BACKUP_SCRIPT_GROUP" && "$mode" == "$BACKUP_SCRIPT_MODE" ]] || return 1
  digest="$(sha256sum -- "$script_path")" || return 1
  digest="${digest%% *}"
  identity_after="$(file_identity "$script_path")" || return 1
  owner_after="$(file_owner "$script_path")" || return 1
  group_after="$(file_group "$script_path")" || return 1
  mode_after="0$(file_mode "$script_path")" || return 1
  [[ "$identity_before" == "$identity_after" && ! -L "$script_path" && -f "$script_path" ]] || return 1
  [[ "$owner_after" == "$owner" && "$group_after" == "$group" && "$mode_after" == "$mode" ]] || return 1
  [[ "$digest" == "$BACKUP_SCRIPT_SHA256" ]]
}

validate_backup_mechanism() {
  local manifest="$1"

  validate_backup_manifest "$manifest" || return 1
  validate_backup_script_file "$BACKUP_SCRIPT_PATH"
}

format_epoch() {
  date -u -d "@$1" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$1" '+%Y-%m-%dT%H:%M:%SZ'
}

validate_object_location() {
  local location="$1"
  [[ "$location" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$ ]]
}

validate_object_backup_receipt() {
  local receipt="$1"
  local source destination started_at completed_at started_epoch completed_epoch now age

  [[ -f "$receipt" && ! -L "$receipt" && -r "$receipt" ]] || return 1
  jq -e '
    type == "object" and
    .receipt_version == 1 and
    .status == "PASS" and
    .copy_status == "PASS" and
    .verification_status == "PASS" and
    .recovery_point_valid == "NOT_EVALUATED" and
    (.source | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$")) and
    (.destination | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$")) and
    (.started_at_utc | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")) and
    (.completed_at_utc | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
  ' "$receipt" >/dev/null 2>&1 || return 1

  source="$(jq -er '.source' "$receipt")"
  destination="$(jq -er '.destination' "$receipt")"
  validate_object_location "$source" || return 1
  validate_object_location "$destination" || return 1
  [[ "${source#*:}" == buildingos-production ]] || return 1
  [[ "${source#*:}" != "${destination#*:}" ]] || return 1
  started_at="$(jq -er '.started_at_utc' "$receipt")"
  completed_at="$(jq -er '.completed_at_utc' "$receipt")"
  started_epoch="$(parse_epoch "$started_at")" || return 1
  completed_epoch="$(parse_epoch "$completed_at")" || return 1
  now="$(date -u +%s)"
  age=$((now - completed_epoch))
  (( started_epoch <= completed_epoch && age >= 0 && age <= MAX_BACKUP_AGE_SECONDS ))
}

# Scheduled Object Storage copy evidence remains independently validated from recovery evidence.
report_object_backup_receipt() {
  local receipt="$1"
  local receipt_status='INCOMPLETE' copy_status='INCOMPLETE'
  local postgres_evidence_status="$RECOVERY_POINT_POSTGRES_BACKUP_EVIDENCE_STATUS"
  local reference_reconciliation_status="$RECOVERY_POINT_REFERENCE_RECONCILIATION_STATUS"
  local content_identity_status="$RECOVERY_POINT_CONTENT_IDENTITY_STATUS"
  if validate_object_backup_receipt "$receipt"; then
    receipt_status='PASS'
    copy_status='PASS'
  else
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
  fi
  if [[ "$RECOVERY_POINT_SELECTOR_REPORTED" != true ]]; then
    postgres_evidence_status='NOT_EVALUATED'
    reference_reconciliation_status='NOT_IMPLEMENTED'
    content_identity_status='NOT_IMPLEMENTED'
  fi
  printf 'OBJECT_BACKUP_RECEIPT=%s\n' "$receipt_status"
  printf 'OBJECT_BACKUP_COPY=%s\n' "$copy_status"
  printf 'POSTGRES_BACKUP_EVIDENCE=%s\n' "$postgres_evidence_status"
  printf 'DB_OBJECT_REFERENCE_RECONCILIATION=%s\n' "$reference_reconciliation_status"
  printf 'DB_OBJECT_CONTENT_IDENTITY=%s\n' "$content_identity_status"
  printf 'RECOVERY_POINT_VALID=%s\n' "$RECOVERY_POINT_AUDIT_STATUS"
  [[ "$RECOVERY_POINT_AUDIT_STATUS" == PASS ]] || AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
}

backup_readiness_status() {
  local component status value matches
  local -a required_components=(
    POSTGRES_BACKUP_MECHANISM
    POSTGRES_BACKUP_EVIDENCE
    OBJECT_BACKUP_RECEIPT
    OBJECT_BACKUP_COPY
    CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR
    DB_OBJECT_REFERENCE_RECONCILIATION
    DB_OBJECT_CONTENT_IDENTITY
    RECOVERY_POINT_VALID
  )

  [[ "$#" -eq "${#required_components[@]}" ]] || { printf 'INCOMPLETE'; return; }
  for component in "${required_components[@]}"; do
    matches=0
    value=''
    for status in "$@"; do
      if [[ "$status" == "$component="* ]]; then
        matches=$((matches + 1))
        value="${status#*=}"
      fi
    done
    [[ "$matches" -eq 1 && "$value" == PASS ]] || { printf 'INCOMPLETE'; return; }
  done
  printf 'PASS'
}

report_backup_readiness() {
  local selector="${1:-$CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR}"
  local deployments_root="${2:-$DEPLOYMENTS_ROOT}"
  local recovery_root="${3:-$RECOVERY_POINTS_ROOT}"
  local mechanism_manifest="${4:-$BACKUP_IDENTITY_MANIFEST_PATH}"
  local object_backup_receipt="${5:-$OBJECT_BACKUP_RECEIPT}"
  local mechanism_path='UNKNOWN' mechanism_digest='UNKNOWN' mechanism_owner='UNKNOWN' mechanism_group='UNKNOWN' mechanism_mode='UNKNOWN'
  local mechanism_identity='UNKNOWN' mechanism_status='INCOMPLETE'
  local selector_status='INCOMPLETE' receipt_status='INCOMPLETE' copy_status='INCOMPLETE'
  local postgres_evidence_status='INCOMPLETE' reference_reconciliation_status='INCOMPLETE' content_identity_status='INCOMPLETE' recovery_status='INCOMPLETE'

  report_recovery_point_selector "$selector" "$deployments_root" "$recovery_root"
  report_object_backup_receipt "$object_backup_receipt"
  if validate_backup_mechanism "$mechanism_manifest"; then
    mechanism_path="$(manifest_field "$mechanism_manifest" path)"
    mechanism_digest="$(manifest_field "$mechanism_manifest" sha256)"
    mechanism_owner="$(manifest_field "$mechanism_manifest" owner)"
    mechanism_group="$(manifest_field "$mechanism_manifest" group)"
    mechanism_mode="$(manifest_field "$mechanism_manifest" mode)"
    mechanism_identity="path=${mechanism_path};sha256=${mechanism_digest};owner=${mechanism_owner};group=${mechanism_group};mode=${mechanism_mode}"
    mechanism_status='PASS'
  else
    AUDIT_EVIDENCE_FAILURES=$((AUDIT_EVIDENCE_FAILURES + 1))
  fi
  selector_status='INCOMPLETE'
  [[ "$RECOVERY_POINT_SELECTOR_REPORTED" == true && "$SELECTED_SUCCESSFUL_DEPLOYMENT_RECORD" != '' ]] && selector_status='PASS'
  if [[ "$RECOVERY_POINT_SELECTOR_REPORTED" == true ]]; then
    postgres_evidence_status="$RECOVERY_POINT_POSTGRES_BACKUP_EVIDENCE_STATUS"
    reference_reconciliation_status="$RECOVERY_POINT_REFERENCE_RECONCILIATION_STATUS"
    content_identity_status="$RECOVERY_POINT_CONTENT_IDENTITY_STATUS"
    recovery_status="$RECOVERY_POINT_AUDIT_STATUS"
  fi
  if validate_object_backup_receipt "$object_backup_receipt"; then
    receipt_status='PASS'
    copy_status='PASS'
  fi
  printf 'BACKUP_MECHANISM_PATH=%s\n' "$mechanism_path"
  printf 'BACKUP_MECHANISM_SHA256=%s\n' "$mechanism_digest"
  printf 'BACKUP_MECHANISM_OWNER=%s\n' "$mechanism_owner"
  printf 'BACKUP_MECHANISM_GROUP=%s\n' "$mechanism_group"
  printf 'BACKUP_MECHANISM_MODE=%s\n' "$mechanism_mode"
  printf 'BACKUP_MECHANISM_IDENTITY=%s\n' "$mechanism_identity"
  printf 'BACKUP_IDENTITY_MANIFEST=%s\n' "$mechanism_manifest"
  printf 'POSTGRES_BACKUP_MECHANISM=%s\n' "$mechanism_status"
  printf 'BACKUP_READINESS=%s\n' "$(backup_readiness_status \
    "POSTGRES_BACKUP_MECHANISM=$mechanism_status" \
    "POSTGRES_BACKUP_EVIDENCE=$postgres_evidence_status" \
    "OBJECT_BACKUP_RECEIPT=$receipt_status" \
    "OBJECT_BACKUP_COPY=$copy_status" \
    "CURRENT_SUCCESSFUL_DEPLOYMENT_SELECTOR=$selector_status" \
    "DB_OBJECT_REFERENCE_RECONCILIATION=$reference_reconciliation_status" \
    "DB_OBJECT_CONTENT_IDENTITY=$content_identity_status" \
    "RECOVERY_POINT_VALID=$recovery_status")"
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
  trap audit_unexpected_error ERR
  readonly CANDIDATE_SHA="$1"
  readonly API_HEALTH_URL="$2"
  readonly API_READYZ_URL="$3"
  readonly WEB_LOGIN_URL="$4"

  [[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]] || input_failure 'candidate SHA is not exactly 40 lowercase hexadecimal characters'
  for url in "$API_HEALTH_URL" "$API_READYZ_URL" "$WEB_LOGIN_URL"; do
    [[ "$url" =~ ^https://[A-Za-z0-9._:/?=%+-]+$ ]] || input_failure 'public audit URL is not an HTTPS URL'
  done

  for command_name in awk bash cat curl date docker git jq sha256sum stat; do
    command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
  done

  AUDIT_QUERY_FAILURES=0
  AUDIT_EVIDENCE_FAILURES=0
  AUDIT_INTERNAL_FAILURES=0
  AUDIT_ACTIVE_FINISHED_MIGRATIONS='UNKNOWN'
  AUDIT_FAILED_MIGRATIONS='UNKNOWN'
  AUDIT_STAGE='CONTAINER_HEALTH'
  printf 'PRODUCTION_READONLY_AUDIT\n'
  report_container_health API "$API_CONTAINER"
  report_container_health WEB "$WEB_CONTAINER"
  report_container_health POSTGRES "$POSTGRES_CONTAINER"
  report_container_health REDIS "$REDIS_CONTAINER"
  report_container_health TRAEFIK "$TRAEFIK_CONTAINER"
  AUDIT_STAGE='PUBLIC_HEALTH'
  public_get_status PUBLIC_API_HEALTH "$API_HEALTH_URL"
  public_readyz_status
  public_get_status PUBLIC_WEB_LOGIN "$WEB_LOGIN_URL"
  AUDIT_STAGE='RUNTIME_CONFIG'
  report_safe_runtime_config
  AUDIT_STAGE='MIGRATIONS'
  report_migrations_and_schema
  AUDIT_STAGE='RUNTIME_IDENTITY'
  report_runtime_identity
  AUDIT_STAGE='FINANCE_COUNTS'
  report_finance_counts
  AUDIT_STAGE='FINANCE_INTEGRITY'
  report_finance_integrity
  AUDIT_STAGE='TENANT_CLASSIFICATION'
  report_tenant_classification
  AUDIT_STAGE='STORAGE_DATABASE'
  report_storage_database_buckets
  AUDIT_STAGE='S3'
  report_s3_posture
  AUDIT_STAGE='MINIO'
  report_minio_posture
  AUDIT_STAGE='BACKUP'
  report_backup_readiness

  if (( AUDIT_QUERY_FAILURES == 0 && AUDIT_EVIDENCE_FAILURES == 0 && AUDIT_INTERNAL_FAILURES == 0 )); then
    trap - ERR
    printf 'AUDIT_STATUS=COMPLETE\n'
    printf 'AUDIT_QUERY_FAILURES=0\nAUDIT_EVIDENCE_FAILURES=0\nAUDIT_INTERNAL_FAILURES=%s\n' "$AUDIT_INTERNAL_FAILURES"
  else
    trap - ERR
    printf 'AUDIT_STATUS=INCOMPLETE\n'
    printf 'AUDIT_QUERY_FAILURES=%s\n' "$AUDIT_QUERY_FAILURES"
    printf 'AUDIT_EVIDENCE_FAILURES=%s\n' "$AUDIT_EVIDENCE_FAILURES"
    printf 'AUDIT_INTERNAL_FAILURES=%s\n' "$AUDIT_INTERNAL_FAILURES"
    return 1
  fi
}

if [[ -z "${BASH_SOURCE[0]-}" || "${BASH_SOURCE[0]-}" == "$0" ]]; then
  main "$@"
fi
