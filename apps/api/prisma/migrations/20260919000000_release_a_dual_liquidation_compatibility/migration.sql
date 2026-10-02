-- Release A compatibility: preserve historical NULL integrity rows and accept
-- the pinned pre-v1 writer's V3 publication snapshot without weakening v1.
CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  modern boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'PUBLISHED' THEN
      RAISE EXCEPTION 'published liquidations cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."publicationIntegrityVersion" IS NOT NULL
     AND NEW."publicationIntegrityVersion" <> 1 THEN
    RAISE EXCEPTION 'liquidation publicationIntegrityVersion is invalid';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'new liquidations must start in DRAFT';
    END IF;

    IF NEW."publicationIntegrityVersion" = 1 AND (
      NEW."period" !~ '^\d{4}-(0[1-9]|1[0-2])$'
      OR NEW."chargePeriod" IS NULL
      OR NEW."chargePeriod" !~ '^\d{4}-(0[1-9]|1[0-2])$'
      OR NEW."chargePeriod" <> to_char((NEW."period" || '-01')::date + INTERVAL '1 month', 'YYYY-MM')
      OR NEW."valuationMode" IS NULL
      OR NEW."distributionSnapshot" IS NULL
    ) THEN
      RAISE EXCEPTION 'publication integrity v1 drafts require next chargePeriod, frozen distribution and valuation evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."publicationIntegrityVersion" IS DISTINCT FROM OLD."publicationIntegrityVersion" THEN
    RAISE EXCEPTION 'liquidation publicationIntegrityVersion is immutable after insert';
  END IF;

  IF OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'published liquidations cannot be updated';
  END IF;

  modern := COALESCE(OLD."publicationIntegrityVersion" = 1, false);
  IF modern AND (
    NEW."id" IS DISTINCT FROM OLD."id" OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
    OR NEW."buildingId" IS DISTINCT FROM OLD."buildingId" OR NEW."period" IS DISTINCT FROM OLD."period"
    OR NEW."chargePeriod" IS DISTINCT FROM OLD."chargePeriod"
    OR NEW."valuationMode" IS DISTINCT FROM OLD."valuationMode"
    OR NEW."baseCurrency" IS DISTINCT FROM OLD."baseCurrency"
    OR NEW."totalAmountMinor" IS DISTINCT FROM OLD."totalAmountMinor"
    OR NEW."totalsByCurrency" IS DISTINCT FROM OLD."totalsByCurrency"
    OR NEW."expenseSnapshot" IS DISTINCT FROM OLD."expenseSnapshot"
    OR NEW."distributionSnapshot" IS DISTINCT FROM OLD."distributionSnapshot"
    OR NEW."unitCount" IS DISTINCT FROM OLD."unitCount"
    OR NEW."generatedByMembershipId" IS DISTINCT FROM OLD."generatedByMembershipId"
    OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt"
    OR NEW."grossExpenseAmountMinor" IS DISTINCT FROM OLD."grossExpenseAmountMinor"
    OR NEW."adjustmentAmountMinor" IS DISTINCT FROM OLD."adjustmentAmountMinor"
    OR NEW."preIncomeAmountMinor" IS DISTINCT FROM OLD."preIncomeAmountMinor"
    OR NEW."incomeOffsetAmountMinor" IS DISTINCT FROM OLD."incomeOffsetAmountMinor"
    OR NEW."netDistributableAmountMinor" IS DISTINCT FROM OLD."netDistributableAmountMinor"
    OR NEW."incomeOffsetSnapshot" IS DISTINCT FROM OLD."incomeOffsetSnapshot"
    OR NEW."incomeOffsetsByCurrency" IS DISTINCT FROM OLD."incomeOffsetsByCurrency"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'modern liquidation identity and evidence are immutable';
  END IF;

  IF modern AND (
    NEW."period" !~ '^\d{4}-(0[1-9]|1[0-2])$'
    OR NEW."chargePeriod" IS NULL
    OR NEW."chargePeriod" !~ '^\d{4}-(0[1-9]|1[0-2])$'
    OR NEW."chargePeriod" <> to_char((NEW."period" || '-01')::date + INTERVAL '1 month', 'YYYY-MM')
  ) THEN
    RAISE EXCEPTION 'modern liquidation chargePeriod must equal period plus one month';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'DRAFT' AND NEW."status" IN ('REVIEWED', 'CANCELED') THEN
      NULL;
    ELSIF OLD."status" = 'REVIEWED' AND NEW."status" IN ('PUBLISHED', 'CANCELED') THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'invalid liquidation status transition';
    END IF;
  END IF;

  IF NEW."status" = 'PUBLISHED' THEN
    IF NOT modern THEN
      IF NEW."publicationSnapshot" IS NULL
         OR (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '1'::jsonb
            AND (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '2'::jsonb
            AND (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '3'::jsonb THEN
        RAISE EXCEPTION 'legacy liquidation drafts cannot be published';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."publicationSnapshot" IS NULL OR NEW."publishedAt" IS NULL
       OR NEW."publishedByMembershipId" IS NULL THEN
      RAISE EXCEPTION 'publishing a liquidation requires publication metadata';
    END IF;
    IF NEW."publicationSnapshot" ->> 'version' IS DISTINCT FROM '4'
       OR NEW."publicationSnapshot" ->> 'liquidationId' IS DISTINCT FROM NEW."id"
       OR NEW."publicationSnapshot" ->> 'tenantId' IS DISTINCT FROM NEW."tenantId"
       OR NEW."publicationSnapshot" ->> 'buildingId' IS DISTINCT FROM NEW."buildingId"
       OR NEW."publicationSnapshot" ->> 'period' IS DISTINCT FROM NEW."period"
       OR NEW."publicationSnapshot" ->> 'chargePeriod' IS DISTINCT FROM NEW."chargePeriod"
       OR NEW."publicationSnapshot" ->> 'publicationIntegrityVersion' IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'modern liquidation publication requires matching V4 integrity evidence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Liquidation_publication_integrity" ON "Liquidation";
CREATE TRIGGER "Liquidation_publication_integrity"
BEFORE INSERT OR UPDATE OR DELETE ON "Liquidation"
FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_publication_integrity();

-- The pre-v1 runtime intentionally omits publicationIntegrityVersion on new
-- drafts. Keep v1 recipient ownership and distribution validation unchanged.
CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."publicationIntegrityVersion" = 1
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(NEW."distributionSnapshot" -> 'allocations', '[]'::jsonb)) AS item(value)
       WHERE NOT EXISTS (
         SELECT 1
         FROM "Unit" unit
         WHERE unit."id" = item.value ->> 'unitId'
           AND unit."tenantId" = NEW."tenantId"
           AND unit."buildingId" = NEW."buildingId"
       )
     )
  THEN
    RAISE EXCEPTION 'modern liquidation distribution recipients must belong to the liquidation tenant and building';
  ELSIF TG_OP = 'UPDATE'
     AND NEW."publicationIntegrityVersion" = 1
     AND (
       NEW."distributionSnapshot" IS DISTINCT FROM OLD."distributionSnapshot"
       OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
       OR NEW."buildingId" IS DISTINCT FROM OLD."buildingId"
     )
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(NEW."distributionSnapshot" -> 'allocations', '[]'::jsonb)) AS item(value)
       WHERE NOT EXISTS (
         SELECT 1
         FROM "Unit" unit
         WHERE unit."id" = item.value ->> 'unitId'
           AND unit."tenantId" = NEW."tenantId"
           AND unit."buildingId" = NEW."buildingId"
       )
     )
  THEN
    RAISE EXCEPTION 'modern liquidation distribution recipients must belong to the liquidation tenant and building';
  END IF;

  IF TG_OP <> 'DELETE' AND NEW."publicationIntegrityVersion" = 1 THEN
    PERFORM validate_liquidation_distribution_snapshot(
      NEW."distributionSnapshot",
      NEW."tenantId",
      NEW."buildingId",
      NEW."totalAmountMinor"
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS "Liquidation_publication_integrity_origin" ON "Liquidation";
CREATE TRIGGER "Liquidation_publication_integrity_origin"
BEFORE INSERT OR UPDATE ON "Liquidation"
FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_publication_integrity_origin();
