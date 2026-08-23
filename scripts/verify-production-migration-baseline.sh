#!/usr/bin/env bash
set -Eeuo pipefail

readonly POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-pawtech-postgres}"
readonly DATABASE_NAME="${DATABASE_NAME:-buildingos_db}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ "$DATABASE_NAME" =~ ^[a-z0-9_]+$ ]] || fail "Unsafe database name"
command -v docker >/dev/null || fail "docker is required"
docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || fail "PostgreSQL container is unavailable"

result="$({
  docker exec -i "$POSTGRES_CONTAINER" sh -lc \
    'exec psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$1"' sh "$DATABASE_NAME" <<'SQL'
SELECT CASE WHEN
  (
    SELECT checksum = 'a1d133670a3b3cefb8b747fab3bc6d05109f548aa3d760a498cbbd0820c3d063'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
      AND applied_steps_count = 1
    FROM "_prisma_migrations"
    WHERE migration_name = '20260510000001_enforce_tenant_scope_non_breaking'
  )
  AND (
    SELECT checksum = 'manual_insert'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
      AND applied_steps_count = 1
    FROM "_prisma_migrations"
    WHERE migration_name = '20260616000001_add_tenant_next_building_alias_index'
  )
  AND to_regclass('public."UnitAssociation"') IS NOT NULL
  AND (
    SELECT count(*) = 7
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'UnitAssociation'
      AND column_name IN ('id', 'tenantId', 'buildingId', 'apartmentId', 'parkingId', 'createdAt', 'updatedAt')
      AND is_nullable = 'NO'
  )
  AND (
    SELECT count(*) = 6
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('Unit', 'tenantId'),
        ('MembershipRole', 'tenantId'),
        ('UserContext', 'tenantId'),
        ('UnitGroupMember', 'tenantId'),
        ('UnitGroupMember', 'buildingId'),
        ('SupportTicketComment', 'tenantId')
      )
      AND is_nullable = 'NO'
  )
  AND (
    SELECT count(*) = 7 AND bool_and(convalidated)
    FROM pg_constraint
    WHERE conname IN (
      'Unit_tenantId_fkey',
      'MembershipRole_tenantId_fkey',
      'UserContext_tenantId_fkey',
      'UnitGroupMember_tenantId_fkey',
      'UnitGroupMember_buildingId_fkey',
      'SupportTicketComment_tenantId_fkey',
      'UnitAssociation_pkey'
    )
  )
  AND (
    SELECT count(*) = 4 AND bool_and(i.indisunique)
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname IN (
      'Unit_tenantId_buildingId_code_key',
      'UnitGroupMember_tenantId_unitGroupId_unitId_key',
      'UnitOccupant_tenantId_unitId_memberId_key',
      'UnitAssociation_tenantId_buildingId_apartmentId_parkingId_key'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Tenant'
      AND column_name = 'nextBuildingAliasIndex'
      AND data_type = 'integer'
      AND is_nullable = 'NO'
      AND column_default = '1'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Building'
      AND column_name = 'alias'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  )
  AND (
    SELECT count(*) = 6
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ReceiptSequence'
      AND (
        (column_name = 'id' AND data_type = 'text' AND is_nullable = 'NO' AND column_default IS NULL)
        OR (column_name = 'tenantId' AND data_type = 'text' AND is_nullable = 'NO' AND column_default IS NULL)
        OR (column_name = 'year' AND data_type = 'integer' AND is_nullable = 'NO' AND column_default IS NULL)
        OR (column_name = 'lastNumber' AND data_type = 'integer' AND is_nullable = 'NO' AND column_default = '0')
        OR (column_name = 'createdAt' AND data_type = 'timestamp without time zone' AND datetime_precision = 3 AND is_nullable = 'NO' AND column_default = 'CURRENT_TIMESTAMP')
        OR (column_name = 'updatedAt' AND data_type = 'timestamp without time zone' AND datetime_precision = 3 AND is_nullable = 'NO' AND column_default IS NULL)
      )
  )
  AND (
    SELECT count(*) = 6
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ReceiptSequence'
  )
  AND (
    SELECT count(*) = 1 AND bool_and(
      conname = 'ReceiptSequence_pkey'
      AND convalidated
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public."ReceiptSequence"'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]
    )
    FROM pg_constraint
    WHERE conrelid = 'public."ReceiptSequence"'::regclass
      AND contype = 'p'
  )
  AND (
    SELECT count(*) = 1 AND bool_and(
      conname = 'ReceiptSequence_tenantId_fkey'
      AND convalidated
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public."ReceiptSequence"'::regclass AND attname = 'tenantId' AND NOT attisdropped)]::smallint[]
      AND confrelid = 'public."Tenant"'::regclass
      AND confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public."Tenant"'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]
      AND confdeltype = 'c'
      AND confupdtype = 'c'
    )
    FROM pg_constraint
    WHERE conrelid = 'public."ReceiptSequence"'::regclass
      AND contype = 'f'
  )
  AND (
    SELECT count(*) = 3
      AND count(*) FILTER (WHERE c.relname = 'ReceiptSequence_pkey' AND i.indisunique AND i.indkey::text = '1') = 1
      AND count(*) FILTER (WHERE c.relname = 'ReceiptSequence_tenantId_year_key' AND i.indisunique AND i.indkey::text = '2 3') = 1
      AND count(*) FILTER (WHERE c.relname = 'ReceiptSequence_tenantId_idx' AND NOT i.indisunique AND i.indkey::text = '2') = 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public."ReceiptSequence"'::regclass
  )
THEN 'OK' ELSE 'FAIL' END;
SQL
} 2>/dev/null)" || fail "Unable to verify the production migration baseline"

[[ "$result" == "OK" ]] || fail "Production migration baseline differs from the audited legacy state"
printf 'Production migration baseline verified: HISTORY_ONLY_DRIFT\n'
