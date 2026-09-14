-- Corrective slice: preserve publication integrity while allowing database-proven parent cascades.
CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  modern boolean;
  snapshotPublishedAt timestamptz;
  snapshotDueDate timestamptz;
  allocationTotal bigint;
  expenseTotalsByCurrency jsonb;
  expenseSourceEvidence jsonb;
  publicationExpenseEvidence jsonb;
  functionalExpenseTotal bigint;
  allocationChargeEvidence jsonb;
  distributionAllocationEvidence jsonb;
  publicationAllocationEvidence jsonb;
  generatedChargeEvidence jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'PUBLISHED' THEN
      IF EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = OLD."tenantId")
         AND EXISTS (SELECT 1 FROM "Building" WHERE "id" = OLD."buildingId") THEN
        RAISE EXCEPTION 'published liquidations cannot be deleted';
      END IF;
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
             AND (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '2'::jsonb THEN
        RAISE EXCEPTION 'legacy liquidation drafts cannot be published';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."publicationSnapshot" IS NULL OR NEW."publishedAt" IS NULL
       OR NEW."publishedByMembershipId" IS NULL THEN
      RAISE EXCEPTION 'publishing a liquidation requires publication metadata';
    END IF;
    IF NEW."publicationSnapshot" -> 'version' IS DISTINCT FROM '4'::jsonb
       OR NEW."publicationSnapshot" ->> 'liquidationId' IS DISTINCT FROM NEW."id"
       OR NEW."publicationSnapshot" ->> 'tenantId' IS DISTINCT FROM NEW."tenantId"
       OR NEW."publicationSnapshot" ->> 'buildingId' IS DISTINCT FROM NEW."buildingId"
       OR NEW."publicationSnapshot" ->> 'period' IS DISTINCT FROM NEW."period"
       OR NEW."publicationSnapshot" ->> 'chargePeriod' IS DISTINCT FROM NEW."chargePeriod"
       OR NEW."publicationSnapshot" -> 'publicationIntegrityVersion' IS DISTINCT FROM '1'::jsonb
       OR NEW."publicationSnapshot" ->> 'valuationMode' IS DISTINCT FROM NEW."valuationMode"::text
       OR NEW."publicationSnapshot" ->> 'baseCurrency' IS DISTINCT FROM NEW."baseCurrency"
       OR NEW."publicationSnapshot" -> 'totalAmountMinor' IS DISTINCT FROM to_jsonb(NEW."totalAmountMinor")
       OR NEW."publicationSnapshot" -> 'totalsByCurrency' IS DISTINCT FROM NEW."totalsByCurrency"
       OR jsonb_typeof(NEW."publicationSnapshot" -> 'totalsByCurrency') IS DISTINCT FROM 'object'
       OR jsonb_typeof(NEW."publicationSnapshot" -> 'expenses') IS DISTINCT FROM 'array'
       OR jsonb_typeof(NEW."publicationSnapshot" -> 'allocations') IS DISTINCT FROM 'array'
       OR jsonb_typeof(NEW."publicationSnapshot" -> 'dueDate') IS DISTINCT FROM 'string'
       OR jsonb_typeof(NEW."publicationSnapshot" -> 'publishedAt') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END IF;

    BEGIN
      snapshotDueDate := (NEW."publicationSnapshot" ->> 'dueDate')::timestamptz;
      snapshotPublishedAt := (NEW."publicationSnapshot" ->> 'publishedAt')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END;

    IF snapshotPublishedAt IS DISTINCT FROM NEW."publishedAt" THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END IF;

    IF (NEW."totalAmountMinor" <> 0 AND jsonb_array_length(NEW."publicationSnapshot" -> 'expenses') = 0)
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'expenses') AS expense
         WHERE jsonb_typeof(expense) IS DISTINCT FROM 'object'
            OR jsonb_typeof(expense -> 'expenseId') IS DISTINCT FROM 'string'
            OR btrim(expense ->> 'expenseId') = ''
            OR jsonb_typeof(expense -> 'categoryName') IS DISTINCT FROM 'string'
            OR btrim(expense ->> 'categoryName') = ''
            OR (jsonb_typeof(expense -> 'vendorName') IS DISTINCT FROM 'null'
                AND (jsonb_typeof(expense -> 'vendorName') IS DISTINCT FROM 'string'
                     OR btrim(expense ->> 'vendorName') = ''))
            OR jsonb_typeof(expense -> 'amountMinor') IS DISTINCT FROM 'number'
            OR expense ->> 'amountMinor' !~ '^(0|[1-9][0-9]*)$'
            OR jsonb_typeof(expense -> 'currencyCode') IS DISTINCT FROM 'string'
            OR btrim(expense ->> 'currencyCode') = ''
            OR jsonb_typeof(expense -> 'invoiceDate') IS DISTINCT FROM 'string'
            OR (jsonb_typeof(expense -> 'description') IS DISTINCT FROM 'null'
                AND (jsonb_typeof(expense -> 'description') IS DISTINCT FROM 'string'
                     OR btrim(expense ->> 'description') = ''))
            OR jsonb_typeof(expense -> 'type') IS DISTINCT FROM 'string'
            OR expense ->> 'type' NOT IN ('EXPENSE', 'ADJUSTMENT')
       ) THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END IF;

    IF NEW."valuationMode" = 'FUNCTIONAL' AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'expenses') AS expense
         WHERE jsonb_typeof(expense -> 'functionalAmountMinor') IS DISTINCT FROM 'number'
            OR expense ->> 'functionalAmountMinor' !~ '^(0|[1-9][0-9]*)$'
            OR jsonb_typeof(expense -> 'functionalCurrencyCode') IS DISTINCT FROM 'string'
            OR btrim(expense ->> 'functionalCurrencyCode') = ''
            OR expense ->> 'functionalCurrencyCode' IS DISTINCT FROM NEW."baseCurrency"
            OR (
              jsonb_typeof(expense -> 'exchangeRateValue') IS DISTINCT FROM 'string'
              AND jsonb_typeof(expense -> 'exchangeRateValue') IS DISTINCT FROM 'number'
            )
            OR btrim(expense ->> 'exchangeRateValue') = ''
            OR expense ->> 'exchangeRateValue' !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
            OR jsonb_typeof(expense -> 'exchangeRateDirection') IS DISTINCT FROM 'string'
            OR expense ->> 'exchangeRateDirection' NOT IN ('IDENTITY', 'DIRECT', 'INVERSE')
            OR jsonb_typeof(expense -> 'conversionDate') IS DISTINCT FROM 'string'
            OR (
              expense ->> 'exchangeRateDirection' = 'IDENTITY' AND (
                (expense ->> 'exchangeRateValue')::numeric <> 1
                OR jsonb_typeof(expense -> 'exchangeRateId') IS DISTINCT FROM 'null'
                OR jsonb_typeof(expense -> 'exchangeRateEffectiveAt') IS DISTINCT FROM 'null'
              )
            )
            OR (
              expense ->> 'exchangeRateDirection' IN ('DIRECT', 'INVERSE') AND (
                (expense ->> 'exchangeRateValue')::numeric <= 0
                OR jsonb_typeof(expense -> 'exchangeRateId') IS DISTINCT FROM 'string'
                OR btrim(expense ->> 'exchangeRateId') = ''
                OR jsonb_typeof(expense -> 'exchangeRateEffectiveAt') IS DISTINCT FROM 'string'
              )
            )
       ) THEN
      RAISE EXCEPTION 'modern functional liquidation publication requires complete FX evidence';
    END IF;

    BEGIN
      PERFORM (expense ->> 'invoiceDate')::timestamptz
      FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'expenses') AS expense;

      IF NEW."valuationMode" = 'FUNCTIONAL' THEN
        PERFORM (expense ->> 'conversionDate')::timestamptz
        FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'expenses') AS expense;

        PERFORM (expense ->> 'exchangeRateEffectiveAt')::timestamptz
        FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'expenses') AS expense
        WHERE expense ->> 'exchangeRateDirection' IN ('DIRECT', 'INVERSE');
      END IF;

      PERFORM 1
      FROM jsonb_each(NEW."publicationSnapshot" -> 'totalsByCurrency') AS total(currencyCode, amount)
      WHERE btrim(currencyCode) = ''
         OR jsonb_typeof(amount) IS DISTINCT FROM 'number'
         OR amount #>> '{}' !~ '^(0|[1-9][0-9]*)$';
      IF FOUND THEN
        RAISE EXCEPTION 'invalid totalsByCurrency evidence';
      END IF;

      SELECT COALESCE(jsonb_object_agg(currencyCode, totalAmount), '{}'::jsonb)
      INTO expenseTotalsByCurrency
      FROM (
        SELECT expense ->> 'currencyCode' AS currencyCode,
               SUM((expense ->> 'amountMinor')::bigint) AS totalAmount
        FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'expenses') AS expense
        GROUP BY expense ->> 'currencyCode'
      ) AS expenseTotals;

      IF NEW."valuationMode" = 'FUNCTIONAL' THEN
        SELECT COALESCE(SUM((expense ->> 'functionalAmountMinor')::bigint), 0)
        INTO functionalExpenseTotal
        FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'expenses') AS expense;
      END IF;

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'expenseId', expense -> 'expenseId',
            'categoryName', expense -> 'categoryName',
            'vendorName', expense -> 'vendorName',
            'amountMinor', expense -> 'amountMinor',
            'currencyCode', expense -> 'currencyCode',
            'invoiceDate', expense -> 'invoiceDate',
            'description', expense -> 'description',
            'type', expense -> 'type'
          ) || jsonb_strip_nulls(jsonb_build_object(
            'sourcePeriod', expense -> 'sourcePeriod',
            'functionalAmountMinor', expense -> 'functionalAmountMinor',
            'functionalCurrencyCode', expense -> 'functionalCurrencyCode',
            'exchangeRateId', expense -> 'exchangeRateId',
            'exchangeRateValue', to_jsonb(expense ->> 'exchangeRateValue'),
            'exchangeRateDirection', expense -> 'exchangeRateDirection',
            'exchangeRateEffectiveAt', expense -> 'exchangeRateEffectiveAt',
            'conversionDate', expense -> 'conversionDate'
          ))
          ORDER BY expense ->> 'expenseId', expense::text
        ),
        '[]'::jsonb
      )
      INTO publicationExpenseEvidence
      FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'expenses') AS expense;

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'expenseId', expense -> 'expenseId',
            'categoryName', expense -> 'categoryName',
            'vendorName', expense -> 'vendorName',
            'amountMinor', expense -> 'amountMinor',
            'currencyCode', expense -> 'currencyCode',
            'invoiceDate', expense -> 'invoiceDate',
            'description', expense -> 'description',
            'type', expense -> 'type'
          ) || jsonb_strip_nulls(jsonb_build_object(
            'sourcePeriod', expense -> 'sourcePeriod',
            'functionalAmountMinor', expense -> 'functionalAmountMinor',
            'functionalCurrencyCode', expense -> 'functionalCurrencyCode',
            'exchangeRateId', expense -> 'exchangeRateId',
            'exchangeRateValue', to_jsonb(expense ->> 'exchangeRateValue'),
            'exchangeRateDirection', expense -> 'exchangeRateDirection',
            'exchangeRateEffectiveAt', expense -> 'exchangeRateEffectiveAt',
            'conversionDate', expense -> 'conversionDate'
          ))
          ORDER BY expense ->> 'expenseId', expense::text
        ),
        '[]'::jsonb
      )
      INTO expenseSourceEvidence
      FROM jsonb_array_elements(NEW."expenseSnapshot") AS expense;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END;

    IF EXISTS (
         SELECT 1
         FROM jsonb_each(NEW."publicationSnapshot" -> 'totalsByCurrency') AS declared(currencyCode, amount)
         LEFT JOIN jsonb_each(expenseTotalsByCurrency) AS actual(currencyCode, amount)
           USING (currencyCode)
         WHERE (declared.amount #>> '{}')::bigint
               IS DISTINCT FROM COALESCE((actual.amount #>> '{}')::bigint, 0)
       ) OR EXISTS (
         SELECT 1
         FROM jsonb_each(expenseTotalsByCurrency) AS actual(currencyCode, amount)
         LEFT JOIN jsonb_each(NEW."publicationSnapshot" -> 'totalsByCurrency') AS declared(currencyCode, amount)
           USING (currencyCode)
         WHERE declared.currencyCode IS NULL
       ) OR expenseSourceEvidence IS DISTINCT FROM publicationExpenseEvidence
       OR (
         NEW."valuationMode" = 'FUNCTIONAL'
         AND functionalExpenseTotal IS DISTINCT FROM COALESCE(
           NEW."preIncomeAmountMinor", NEW."totalAmountMinor"
         )
       ) THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END IF;

    IF jsonb_typeof(NEW."distributionSnapshot") IS DISTINCT FROM 'object'
       OR jsonb_typeof(NEW."distributionSnapshot" -> 'allocations') IS DISTINCT FROM 'array'
       OR jsonb_array_length(NEW."distributionSnapshot" -> 'allocations') = 0
       OR EXISTS (
             SELECT 1
             FROM jsonb_array_elements(NEW."distributionSnapshot" -> 'allocations') AS allocation
             WHERE jsonb_typeof(allocation -> 'unitId') IS DISTINCT FROM 'string'
                OR btrim(allocation ->> 'unitId') = ''
                OR jsonb_typeof(allocation -> 'unitCode') IS DISTINCT FROM 'string'
                OR btrim(allocation ->> 'unitCode') = ''
                OR (
                  jsonb_typeof(allocation -> 'unitLabel') IS DISTINCT FROM 'null'
                  AND jsonb_typeof(allocation -> 'unitLabel') IS DISTINCT FROM 'string'
                )
                OR jsonb_typeof(allocation -> 'amountMinor') IS DISTINCT FROM 'number'
                OR allocation ->> 'amountMinor' !~ '^(0|[1-9][0-9]*)$'
           ) THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END IF;

    IF jsonb_array_length(NEW."publicationSnapshot" -> 'allocations') = 0
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'allocations') AS allocation
         WHERE jsonb_typeof(allocation -> 'unitId') IS DISTINCT FROM 'string'
            OR btrim(allocation ->> 'unitId') = ''
            OR jsonb_typeof(allocation -> 'unitCode') IS DISTINCT FROM 'string'
            OR btrim(allocation ->> 'unitCode') = ''
            OR (
              jsonb_typeof(allocation -> 'unitLabel') IS DISTINCT FROM 'null'
              AND jsonb_typeof(allocation -> 'unitLabel') IS DISTINCT FROM 'string'
            )
            OR jsonb_typeof(allocation -> 'amountMinor') IS DISTINCT FROM 'number'
            OR allocation ->> 'amountMinor' !~ '^(0|[1-9][0-9]*)$'
            OR NOT EXISTS (
              SELECT 1
              FROM "Unit" unit
              WHERE unit."id" = allocation ->> 'unitId'
                AND unit."tenantId" = NEW."tenantId"
                AND unit."buildingId" = NEW."buildingId"
                AND TRUE
                AND TRUE
            )
       ) THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END IF;

    BEGIN
      SELECT COALESCE(SUM((allocation ->> 'amountMinor')::bigint), 0)
      INTO allocationTotal
      FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'allocations') AS allocation;

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'tenantId', NEW."tenantId",
            'buildingId', NEW."buildingId",
            'period', NEW."period",
            'chargePeriod', NEW."chargePeriod",
            'type', 'COMMON_EXPENSE',
            'concept', 'Expensas comunes ' || NEW."period",
            'currency', NEW."baseCurrency",
            'dueDate', snapshotDueDate AT TIME ZONE 'UTC',
            'liquidationId', NEW."id",
            'unitId', allocation ->> 'unitId',
            'amountMinor', (allocation ->> 'amountMinor')::bigint
          )
          ORDER BY allocation ->> 'unitId', (allocation ->> 'amountMinor')::bigint
        ) FILTER (WHERE (allocation ->> 'amountMinor')::bigint > 0),
        '[]'::jsonb
      )
      INTO allocationChargeEvidence
      FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'allocations') AS allocation;

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'tenantId', "tenantId",
            'buildingId', "buildingId",
            'period', "period",
            'chargePeriod', "chargePeriod",
            'type', "type",
            'concept', "concept",
            'currency', "currency",
            'dueDate', "dueDate",
            'liquidationId', "liquidationId",
            'unitId', "unitId",
            'amountMinor', "amount"
          )
          ORDER BY "unitId", "amount"
        ),
        '[]'::jsonb
      )
      INTO generatedChargeEvidence
      FROM "Charge"
      WHERE "liquidationId" = NEW."id";

          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'unitId', allocation ->> 'unitId',
                'unitCode', allocation ->> 'unitCode',
                'unitLabel', allocation -> 'unitLabel',
                'amountMinor', (allocation ->> 'amountMinor')::bigint
              )
              ORDER BY allocation ->> 'unitId', allocation ->> 'unitCode',
                       allocation ->> 'unitLabel', (allocation ->> 'amountMinor')::bigint
            ),
            '[]'::jsonb
          )
          INTO publicationAllocationEvidence
          FROM jsonb_array_elements(NEW."publicationSnapshot" -> 'allocations') AS allocation;

          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'unitId', allocation ->> 'unitId',
                'unitCode', allocation ->> 'unitCode',
                'unitLabel', allocation -> 'unitLabel',
                'amountMinor', (allocation ->> 'amountMinor')::bigint
              )
              ORDER BY allocation ->> 'unitId', allocation ->> 'unitCode',
                       allocation ->> 'unitLabel', (allocation ->> 'amountMinor')::bigint
            ),
            '[]'::jsonb
          )
          INTO distributionAllocationEvidence
          FROM jsonb_array_elements(NEW."distributionSnapshot" -> 'allocations') AS allocation;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END;

    IF allocationTotal IS DISTINCT FROM NEW."totalAmountMinor"
       OR publicationAllocationEvidence IS DISTINCT FROM distributionAllocationEvidence
       OR allocationChargeEvidence IS DISTINCT FROM generatedChargeEvidence THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END IF;

    IF NEW."grossExpenseAmountMinor" IS NOT NULL
       OR NEW."adjustmentAmountMinor" IS NOT NULL
       OR NEW."preIncomeAmountMinor" IS NOT NULL
       OR NEW."incomeOffsetAmountMinor" IS NOT NULL
       OR NEW."netDistributableAmountMinor" IS NOT NULL
       OR NEW."incomeOffsetSnapshot" IS NOT NULL
       OR NEW."incomeOffsetsByCurrency" IS NOT NULL THEN
      IF NOT NEW."publicationSnapshot" ?& ARRAY[
        'grossExpenseAmountMinor', 'adjustmentAmountMinor', 'preIncomeAmountMinor',
        'incomeOffsetAmountMinor', 'netDistributableAmountMinor', 'incomeOffsets',
        'incomeOffsetsByCurrency'
      ]
         OR NEW."publicationSnapshot" -> 'grossExpenseAmountMinor' IS DISTINCT FROM to_jsonb(NEW."grossExpenseAmountMinor")
         OR NEW."publicationSnapshot" -> 'adjustmentAmountMinor' IS DISTINCT FROM to_jsonb(NEW."adjustmentAmountMinor")
         OR NEW."publicationSnapshot" -> 'preIncomeAmountMinor' IS DISTINCT FROM to_jsonb(NEW."preIncomeAmountMinor")
         OR NEW."publicationSnapshot" -> 'incomeOffsetAmountMinor' IS DISTINCT FROM to_jsonb(NEW."incomeOffsetAmountMinor")
         OR NEW."publicationSnapshot" -> 'netDistributableAmountMinor' IS DISTINCT FROM to_jsonb(NEW."netDistributableAmountMinor")
         OR NEW."publicationSnapshot" -> 'incomeOffsets' IS DISTINCT FROM NEW."incomeOffsetSnapshot"
         OR NEW."publicationSnapshot" -> 'incomeOffsetsByCurrency' IS DISTINCT FROM NEW."incomeOffsetsByCurrency" THEN
        RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
      END IF;
    ELSIF NEW."publicationSnapshot" ?| ARRAY[
      'grossExpenseAmountMinor', 'adjustmentAmountMinor', 'preIncomeAmountMinor',
      'incomeOffsetAmountMinor', 'netDistributableAmountMinor', 'incomeOffsets',
      'incomeOffsetsByCurrency'
    ] THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Liquidation_publication_integrity" ON "Liquidation";
CREATE TRIGGER "Liquidation_publication_integrity"
BEFORE INSERT OR UPDATE OR DELETE ON "Liquidation"
FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_publication_integrity();

CREATE OR REPLACE FUNCTION enforce_liquidation_generated_charge_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."liquidationId" IS NULL THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = OLD."tenantId")
       OR NOT EXISTS (SELECT 1 FROM "Building" WHERE "id" = OLD."buildingId")
       OR (
         OLD."canceledAt" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "Unit" WHERE "id" = OLD."unitId")
       ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'liquidation-generated charges cannot be deleted';
  END IF;

  IF OLD."liquidationId" IS NULL THEN
    IF NEW."liquidationId" IS NOT NULL THEN
      RAISE EXCEPTION 'manual charges cannot acquire liquidationId';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."buildingId" IS DISTINCT FROM OLD."buildingId" OR NEW."unitId" IS DISTINCT FROM OLD."unitId"
     OR NEW."period" IS DISTINCT FROM OLD."period" OR NEW."chargePeriod" IS DISTINCT FROM OLD."chargePeriod"
     OR NEW."type" IS DISTINCT FROM OLD."type" OR NEW."concept" IS DISTINCT FROM OLD."concept"
     OR NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate" OR NEW."liquidationId" IS DISTINCT FROM OLD."liquidationId"
     OR (
           NEW."createdByMembershipId" IS DISTINCT FROM OLD."createdByMembershipId"
           AND NOT (
             NEW."createdByMembershipId" IS NULL
             AND OLD."createdByMembershipId" IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM "Membership" WHERE "id" = OLD."createdByMembershipId"
             )
           )
         )
     OR NEW."periodId" IS DISTINCT FROM OLD."periodId"
     OR NEW."coefficientSnapshot" IS DISTINCT FROM OLD."coefficientSnapshot"
     OR NEW."sumCoefSnapshot" IS DISTINCT FROM OLD."sumCoefSnapshot"
     OR NEW."totalToAllocateSnapshot" IS DISTINCT FROM OLD."totalToAllocateSnapshot"
     OR NEW."categorySnapshotId" IS DISTINCT FROM OLD."categorySnapshotId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'liquidation-generated charge economic origin is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Charge_liquidation_generated_immutable" ON "Charge";
CREATE TRIGGER "Charge_liquidation_generated_immutable"
BEFORE UPDATE OR DELETE ON "Charge"
FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_generated_charge_immutable();
