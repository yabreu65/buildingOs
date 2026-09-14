-- Prisma expects Liquidation.valuationMode to use the database enum created by
-- 20260810030000_add_liquidation_functional_valuation. Some deployed databases
-- retained this column as TEXT, which breaks enum-bound Prisma parameters.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    JOIN pg_type ON pg_type.oid = pg_attribute.atttypid
    WHERE pg_namespace.nspname = current_schema()
      AND pg_class.relname = 'Liquidation'
      AND pg_attribute.attname = 'valuationMode'
      AND NOT pg_attribute.attisdropped
      AND pg_type.typname = 'text'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM "Liquidation"
      WHERE "valuationMode" IS NOT NULL
        AND "valuationMode" NOT IN ('FUNCTIONAL', 'LEGACY_NOMINAL')
    ) THEN
      RAISE EXCEPTION 'cannot convert Liquidation.valuationMode to LiquidationValuationMode: invalid existing value';
    END IF;

    ALTER TABLE "Liquidation"
    ALTER COLUMN "valuationMode" TYPE "LiquidationValuationMode"
    USING "valuationMode"::text::"LiquidationValuationMode";
  END IF;
END;
$$;
