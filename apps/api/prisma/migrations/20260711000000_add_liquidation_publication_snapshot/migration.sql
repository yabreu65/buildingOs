-- Add immutable publication snapshot for published liquidations
ALTER TABLE "Liquidation"
ADD COLUMN "publicationSnapshot" JSONB;

CREATE OR REPLACE FUNCTION enforce_liquidation_publication_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_review_metadata boolean;
  has_publish_metadata boolean;
  has_cancel_metadata boolean;
BEGIN
  has_review_metadata := NEW."reviewedAt" IS NOT NULL
    OR NEW."reviewedByMembershipId" IS NOT NULL;
  has_publish_metadata := NEW."publicationSnapshot" IS NOT NULL
    OR NEW."publishedAt" IS NOT NULL
    OR NEW."publishedByMembershipId" IS NOT NULL;
  has_cancel_metadata := NEW."canceledAt" IS NOT NULL
    OR NEW."canceledByMembershipId" IS NOT NULL;

  IF NEW."generatedByMembershipId" IS NULL THEN
    RAISE EXCEPTION 'liquidations require generatedByMembershipId';
  END IF;

  IF TG_OP = 'INSERT' THEN
    CASE NEW."status"
      WHEN 'DRAFT' THEN
        IF has_review_metadata THEN
          RAISE EXCEPTION 'draft liquidations cannot carry review metadata';
        END IF;
        IF has_publish_metadata THEN
          RAISE EXCEPTION 'draft liquidations cannot carry publication metadata';
        END IF;
        IF has_cancel_metadata THEN
          RAISE EXCEPTION 'draft liquidations cannot carry cancellation metadata';
        END IF;
        IF NEW."publicationSnapshot" IS NOT NULL THEN
          RAISE EXCEPTION 'draft liquidations cannot carry publicationSnapshot';
        END IF;
      ELSE
        RAISE EXCEPTION 'new liquidations must start in DRAFT';
    END CASE;

    RETURN NEW;
  END IF;

  IF OLD."status" = 'PUBLISHED' THEN
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'published liquidations cannot change status';
    END IF;

    IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
       OR NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."buildingId" IS DISTINCT FROM OLD."buildingId"
       OR NEW."period" IS DISTINCT FROM OLD."period"
       OR NEW."chargePeriod" IS DISTINCT FROM OLD."chargePeriod"
       OR NEW."baseCurrency" IS DISTINCT FROM OLD."baseCurrency"
       OR NEW."totalAmountMinor" IS DISTINCT FROM OLD."totalAmountMinor"
       OR NEW."totalsByCurrency" IS DISTINCT FROM OLD."totalsByCurrency"
       OR NEW."expenseSnapshot" IS DISTINCT FROM OLD."expenseSnapshot"
       OR NEW."unitCount" IS DISTINCT FROM OLD."unitCount"
       OR NEW."generatedByMembershipId" IS DISTINCT FROM OLD."generatedByMembershipId"
       OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt"
       OR NEW."reviewedByMembershipId" IS DISTINCT FROM OLD."reviewedByMembershipId"
       OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
       OR NEW."publishedByMembershipId" IS DISTINCT FROM OLD."publishedByMembershipId"
       OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR NEW."canceledByMembershipId" IS DISTINCT FROM OLD."canceledByMembershipId"
       OR NEW."canceledAt" IS DISTINCT FROM OLD."canceledAt"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
       OR NEW."publicationSnapshot" IS DISTINCT FROM OLD."publicationSnapshot"
    THEN
      RAISE EXCEPTION 'published liquidations are immutable';
    END IF;

    RETURN NEW;
  END IF;

  IF OLD."status" = 'CANCELED' THEN
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'canceled liquidations cannot change status';
    END IF;

    IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
       OR NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."buildingId" IS DISTINCT FROM OLD."buildingId"
       OR NEW."period" IS DISTINCT FROM OLD."period"
       OR NEW."chargePeriod" IS DISTINCT FROM OLD."chargePeriod"
       OR NEW."baseCurrency" IS DISTINCT FROM OLD."baseCurrency"
       OR NEW."totalAmountMinor" IS DISTINCT FROM OLD."totalAmountMinor"
       OR NEW."totalsByCurrency" IS DISTINCT FROM OLD."totalsByCurrency"
       OR NEW."expenseSnapshot" IS DISTINCT FROM OLD."expenseSnapshot"
       OR NEW."unitCount" IS DISTINCT FROM OLD."unitCount"
       OR NEW."generatedByMembershipId" IS DISTINCT FROM OLD."generatedByMembershipId"
       OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt"
       OR NEW."reviewedByMembershipId" IS DISTINCT FROM OLD."reviewedByMembershipId"
       OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
       OR NEW."publishedByMembershipId" IS DISTINCT FROM OLD."publishedByMembershipId"
       OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR NEW."canceledByMembershipId" IS DISTINCT FROM OLD."canceledByMembershipId"
       OR NEW."canceledAt" IS DISTINCT FROM OLD."canceledAt"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
       OR NEW."publicationSnapshot" IS DISTINCT FROM OLD."publicationSnapshot"
    THEN
      RAISE EXCEPTION 'canceled liquidations are immutable';
    END IF;

    RETURN NEW;
  END IF;

  CASE NEW."status"
    WHEN 'DRAFT' THEN
      IF OLD."status" IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'invalid liquidation status transition from % to %', OLD."status", NEW."status";
      END IF;
      IF has_review_metadata THEN
        RAISE EXCEPTION 'draft liquidations cannot carry review metadata';
      END IF;
      IF has_publish_metadata THEN
        RAISE EXCEPTION 'draft liquidations cannot carry publication metadata';
      END IF;
      IF has_cancel_metadata THEN
        RAISE EXCEPTION 'draft liquidations cannot carry cancellation metadata';
      END IF;
      IF NEW."publicationSnapshot" IS NOT NULL THEN
        RAISE EXCEPTION 'draft liquidations cannot carry publicationSnapshot';
      END IF;
    WHEN 'REVIEWED' THEN
      IF OLD."status" NOT IN ('DRAFT', 'REVIEWED') THEN
        RAISE EXCEPTION 'invalid liquidation status transition from % to %', OLD."status", NEW."status";
      END IF;
      IF NEW."reviewedAt" IS NULL OR NEW."reviewedByMembershipId" IS NULL THEN
        RAISE EXCEPTION 'reviewed liquidations require reviewedAt and reviewedByMembershipId';
      END IF;
      IF has_publish_metadata THEN
        RAISE EXCEPTION 'reviewed liquidations cannot carry publication metadata';
      END IF;
      IF has_cancel_metadata THEN
        RAISE EXCEPTION 'reviewed liquidations cannot carry cancellation metadata';
      END IF;
      IF NEW."publicationSnapshot" IS NOT NULL THEN
        RAISE EXCEPTION 'reviewed liquidations cannot carry publicationSnapshot';
      END IF;
      IF NEW."status" = OLD."status" THEN
        IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
           OR NEW."id" IS DISTINCT FROM OLD."id"
           OR NEW."buildingId" IS DISTINCT FROM OLD."buildingId"
           OR NEW."period" IS DISTINCT FROM OLD."period"
           OR NEW."chargePeriod" IS DISTINCT FROM OLD."chargePeriod"
           OR NEW."baseCurrency" IS DISTINCT FROM OLD."baseCurrency"
           OR NEW."totalAmountMinor" IS DISTINCT FROM OLD."totalAmountMinor"
           OR NEW."totalsByCurrency" IS DISTINCT FROM OLD."totalsByCurrency"
           OR NEW."expenseSnapshot" IS DISTINCT FROM OLD."expenseSnapshot"
           OR NEW."unitCount" IS DISTINCT FROM OLD."unitCount"
           OR NEW."generatedByMembershipId" IS DISTINCT FROM OLD."generatedByMembershipId"
           OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt"
           OR NEW."reviewedByMembershipId" IS DISTINCT FROM OLD."reviewedByMembershipId"
           OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
           OR NEW."publicationSnapshot" IS DISTINCT FROM OLD."publicationSnapshot"
           OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
        THEN
          RAISE EXCEPTION 'reviewed liquidations are immutable';
        END IF;
      END IF;
    WHEN 'PUBLISHED' THEN
      IF OLD."status" IS DISTINCT FROM 'REVIEWED' THEN
        RAISE EXCEPTION 'invalid liquidation status transition from % to %', OLD."status", NEW."status";
      END IF;
      IF NEW."publicationSnapshot" IS NULL
         OR NEW."publishedAt" IS NULL
         OR NEW."publishedByMembershipId" IS NULL
      THEN
        RAISE EXCEPTION 'publishing a liquidation requires publicationSnapshot, publishedAt and publishedByMembershipId';
      END IF;
      IF NEW."canceledAt" IS NOT NULL OR NEW."canceledByMembershipId" IS NOT NULL THEN
        RAISE EXCEPTION 'published liquidations cannot carry cancellation metadata';
      END IF;
      IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
         OR NEW."id" IS DISTINCT FROM OLD."id"
         OR NEW."buildingId" IS DISTINCT FROM OLD."buildingId"
         OR NEW."period" IS DISTINCT FROM OLD."period"
         OR NEW."chargePeriod" IS DISTINCT FROM OLD."chargePeriod"
         OR NEW."baseCurrency" IS DISTINCT FROM OLD."baseCurrency"
         OR NEW."totalAmountMinor" IS DISTINCT FROM OLD."totalAmountMinor"
         OR NEW."totalsByCurrency" IS DISTINCT FROM OLD."totalsByCurrency"
         OR NEW."expenseSnapshot" IS DISTINCT FROM OLD."expenseSnapshot"
         OR NEW."unitCount" IS DISTINCT FROM OLD."unitCount"
         OR NEW."generatedByMembershipId" IS DISTINCT FROM OLD."generatedByMembershipId"
         OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt"
         OR NEW."reviewedByMembershipId" IS DISTINCT FROM OLD."reviewedByMembershipId"
         OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
         OR NEW."canceledByMembershipId" IS DISTINCT FROM OLD."canceledByMembershipId"
         OR NEW."canceledAt" IS DISTINCT FROM OLD."canceledAt"
         OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      THEN
        RAISE EXCEPTION 'publishing a liquidation cannot change financial history';
      END IF;
    WHEN 'CANCELED' THEN
      IF OLD."status" NOT IN ('DRAFT', 'REVIEWED') THEN
        RAISE EXCEPTION 'invalid liquidation status transition from % to %', OLD."status", NEW."status";
      END IF;
      IF NEW."canceledAt" IS NULL OR NEW."canceledByMembershipId" IS NULL THEN
        RAISE EXCEPTION 'canceled liquidations require canceledAt and canceledByMembershipId';
      END IF;
      IF has_publish_metadata THEN
        RAISE EXCEPTION 'canceled liquidations cannot carry publication metadata';
      END IF;
      IF NEW."publicationSnapshot" IS NOT NULL THEN
        RAISE EXCEPTION 'canceled liquidations cannot carry publicationSnapshot';
      END IF;
      IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
         OR NEW."id" IS DISTINCT FROM OLD."id"
         OR NEW."buildingId" IS DISTINCT FROM OLD."buildingId"
         OR NEW."period" IS DISTINCT FROM OLD."period"
         OR NEW."chargePeriod" IS DISTINCT FROM OLD."chargePeriod"
         OR NEW."baseCurrency" IS DISTINCT FROM OLD."baseCurrency"
         OR NEW."totalAmountMinor" IS DISTINCT FROM OLD."totalAmountMinor"
         OR NEW."totalsByCurrency" IS DISTINCT FROM OLD."totalsByCurrency"
         OR NEW."expenseSnapshot" IS DISTINCT FROM OLD."expenseSnapshot"
         OR NEW."unitCount" IS DISTINCT FROM OLD."unitCount"
         OR NEW."generatedByMembershipId" IS DISTINCT FROM OLD."generatedByMembershipId"
         OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt"
         OR NEW."reviewedByMembershipId" IS DISTINCT FROM OLD."reviewedByMembershipId"
         OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
         OR NEW."publishedByMembershipId" IS DISTINCT FROM OLD."publishedByMembershipId"
         OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
         OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
         OR NEW."publicationSnapshot" IS DISTINCT FROM OLD."publicationSnapshot"
      THEN
        RAISE EXCEPTION 'canceling a liquidation cannot change financial history';
      END IF;
    ELSE
      RAISE EXCEPTION 'unknown liquidation status: %', NEW."status";
  END CASE;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Liquidation_publicationSnapshot_immutable"
BEFORE INSERT OR UPDATE ON "Liquidation"
FOR EACH ROW
EXECUTE FUNCTION enforce_liquidation_publication_snapshot_immutable();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Liquidation"
    WHERE "status" = 'PUBLISHED'
    GROUP BY "tenantId", "buildingId", "period"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'cannot create published liquidation uniqueness constraint: duplicate published liquidations exist for tenant, building and period';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "Liquidation_unique_published_tenant_building_period"
ON "Liquidation" ("tenantId", "buildingId", "period")
WHERE "status" = 'PUBLISHED';
