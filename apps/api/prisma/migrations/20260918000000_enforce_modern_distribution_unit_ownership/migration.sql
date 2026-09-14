-- Modern distribution snapshots must prove recipient ownership while units still exist.
CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."publicationIntegrityVersion" IS NULL THEN
    RAISE EXCEPTION 'new liquidations require publication integrity v1';
  END IF;

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
