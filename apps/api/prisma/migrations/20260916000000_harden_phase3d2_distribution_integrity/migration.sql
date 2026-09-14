-- Phase 3D.2 corrective slice:
-- validate the complete frozen distribution before modern publication.
CREATE OR REPLACE FUNCTION validate_liquidation_distribution_snapshot(
  snapshot jsonb,
  expected_tenant_id text,
  expected_building_id text,
  expected_total_amount_minor bigint
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  movement jsonb;
  recipient jsonb;
  allocation jsonb;
  expected_row record;
  expected_total numeric;
  rounded_total numeric;
  movement_amount bigint;
  movement_total bigint;
  snapshot_total bigint;
  allocation_amount bigint;
  actual_amount bigint;
  coefficient_total numeric;
  expected_weight numeric;
  calculated_weight numeric;
  allocation_total bigint;
  movement_amount_total bigint;
  all_coefficients boolean;
  canonical_weight_source text;
  recalculated_allocations jsonb := '{}'::jsonb;
  allocation_identity jsonb := '{}'::jsonb;
  existing_identity jsonb;
  existing_amount bigint;
BEGIN
  IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
     OR snapshot -> 'version' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(snapshot -> 'tenantId') IS DISTINCT FROM 'string'
     OR btrim(snapshot ->> 'tenantId') = ''
     OR snapshot ->> 'tenantId' IS DISTINCT FROM expected_tenant_id
     OR jsonb_typeof(snapshot -> 'buildingId') IS DISTINCT FROM 'string'
     OR btrim(snapshot ->> 'buildingId') = ''
     OR snapshot ->> 'buildingId' IS DISTINCT FROM expected_building_id
     OR jsonb_typeof(snapshot -> 'totalAmountMinor') IS DISTINCT FROM 'number'
     OR snapshot ->> 'totalAmountMinor' !~ '^(0|[1-9][0-9]*)$'
  THEN
    RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
  END IF;

  snapshot_total := (snapshot ->> 'totalAmountMinor')::bigint;
  IF snapshot_total IS DISTINCT FROM expected_total_amount_minor
     OR jsonb_typeof(snapshot -> 'movements') IS DISTINCT FROM 'array'
     OR jsonb_typeof(snapshot -> 'allocations') IS DISTINCT FROM 'array'
     OR (snapshot_total > 0 AND jsonb_array_length(snapshot -> 'movements') = 0)
     OR (snapshot_total > 0 AND jsonb_array_length(snapshot -> 'allocations') = 0)
  THEN
    RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(snapshot -> 'allocations') AS item(value)
    GROUP BY item.value ->> 'unitId'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(snapshot -> 'movements') AS item(value)
    GROUP BY item.value ->> 'movementId'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
  END IF;

  SELECT COALESCE(SUM((item.value ->> 'amountMinor')::bigint), 0)
  INTO movement_amount_total
  FROM jsonb_array_elements(snapshot -> 'movements') AS item(value);
  IF movement_amount_total IS DISTINCT FROM snapshot_total THEN
    RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
  END IF;

  FOR allocation IN SELECT value FROM jsonb_array_elements(snapshot -> 'allocations') AS item(value) LOOP
    IF jsonb_typeof(allocation) IS DISTINCT FROM 'object'
       OR jsonb_typeof(allocation -> 'unitId') IS DISTINCT FROM 'string'
       OR btrim(allocation ->> 'unitId') = ''
       OR jsonb_typeof(allocation -> 'unitCode') IS DISTINCT FROM 'string'
       OR btrim(allocation ->> 'unitCode') = ''
       OR (
         jsonb_typeof(allocation -> 'unitLabel') IS DISTINCT FROM 'null'
         AND jsonb_typeof(allocation -> 'unitLabel') IS DISTINCT FROM 'string'
       )
       OR jsonb_typeof(allocation -> 'amountMinor') IS DISTINCT FROM 'number'
       OR allocation ->> 'amountMinor' !~ '^(0|[1-9][0-9]*)$'
    THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;
  END LOOP;

  SELECT COALESCE(SUM((item.value ->> 'amountMinor')::bigint), 0)
  INTO allocation_total
  FROM jsonb_array_elements(snapshot -> 'allocations') AS item(value);
  IF allocation_total IS DISTINCT FROM snapshot_total THEN
    RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
  END IF;

  FOR movement IN SELECT value FROM jsonb_array_elements(snapshot -> 'movements') AS item(value) LOOP
    IF jsonb_typeof(movement) IS DISTINCT FROM 'object'
       OR jsonb_typeof(movement -> 'movementId') IS DISTINCT FROM 'string'
       OR btrim(movement ->> 'movementId') = ''
       OR jsonb_typeof(movement -> 'scope') IS DISTINCT FROM 'string'
       OR (movement ->> 'scope') IS DISTINCT FROM 'BUILDING'
          AND (movement ->> 'scope') IS DISTINCT FROM 'UNIT_GROUP'
          AND (movement ->> 'scope') IS DISTINCT FROM 'ADJUSTMENT'
       OR jsonb_typeof(movement -> 'amountMinor') IS DISTINCT FROM 'number'
       OR movement ->> 'amountMinor' !~ '^(0|[1-9][0-9]*)$'
       OR (movement ->> 'scope' = 'UNIT_GROUP'
           AND (jsonb_typeof(movement -> 'unitGroupId') IS DISTINCT FROM 'string'
                OR btrim(movement ->> 'unitGroupId') = ''))
       OR (movement ->> 'scope' IS DISTINCT FROM 'UNIT_GROUP'
           AND movement -> 'unitGroupId' IS DISTINCT FROM 'null')
       OR jsonb_typeof(movement -> 'totalWeight') IS DISTINCT FROM 'string'
       OR btrim(movement ->> 'totalWeight') = ''
       OR movement ->> 'totalWeight' !~ '^(0|[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?)$'
       OR jsonb_typeof(movement -> 'recipientUnitIds') IS DISTINCT FROM 'array'
       OR jsonb_typeof(movement -> 'recipients') IS DISTINCT FROM 'array'
       OR jsonb_typeof(movement -> 'allocations') IS DISTINCT FROM 'array'
       OR jsonb_array_length(movement -> 'recipients') = 0
       OR jsonb_array_length(movement -> 'allocations') = 0
       OR jsonb_typeof(movement -> 'weightSource') IS DISTINCT FROM 'string'
       OR (movement ->> 'weightSource') IS DISTINCT FROM 'COEFFICIENT'
          AND (movement ->> 'weightSource') IS DISTINCT FROM 'M2'
          AND (movement ->> 'weightSource') IS DISTINCT FROM 'EQUAL'
    THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(movement -> 'recipientUnitIds') AS item(value)
      GROUP BY item.value #>> '{}'
      HAVING COUNT(*) > 1
    ) OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(movement -> 'recipients') AS item(value)
      GROUP BY item.value ->> 'unitId'
      HAVING COUNT(*) > 1
    ) OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(movement -> 'allocations') AS item(value)
      GROUP BY item.value ->> 'unitId'
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(movement -> 'recipientUnitIds') AS item(value)
      WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string' OR btrim(item.value #>> '{}') = ''
    ) OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(movement -> 'recipientUnitIds') AS ids(value)
      FULL OUTER JOIN jsonb_array_elements(movement -> 'recipients') AS recipients(value)
        ON ids.value #>> '{}' = recipients.value ->> 'unitId'
      WHERE ids.value IS NULL OR recipients.value IS NULL
    ) OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(movement -> 'recipients') AS recipients(value)
      FULL OUTER JOIN jsonb_array_elements(movement -> 'allocations') AS allocations(value)
        ON recipients.value ->> 'unitId' = allocations.value ->> 'unitId'
      WHERE recipients.value IS NULL OR allocations.value IS NULL
    ) THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;

    coefficient_total := 0;
    all_coefficients := true;
    calculated_weight := 0;
    FOR recipient IN SELECT value FROM jsonb_array_elements(movement -> 'recipients') AS item(value) LOOP
      IF jsonb_typeof(recipient) IS DISTINCT FROM 'object'
         OR jsonb_typeof(recipient -> 'unitId') IS DISTINCT FROM 'string'
         OR btrim(recipient ->> 'unitId') = ''
         OR jsonb_typeof(recipient -> 'unitCode') IS DISTINCT FROM 'string'
         OR btrim(recipient ->> 'unitCode') = ''
         OR (
           jsonb_typeof(recipient -> 'unitLabel') IS DISTINCT FROM 'null'
           AND jsonb_typeof(recipient -> 'unitLabel') IS DISTINCT FROM 'string'
         )
         OR jsonb_typeof(recipient -> 'weight') IS DISTINCT FROM 'string'
         OR recipient ->> 'weight' !~ '^(0|[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?)$'
         OR (
           jsonb_typeof(recipient -> 'coefficient') IS DISTINCT FROM 'null'
           AND (
             jsonb_typeof(recipient -> 'coefficient') IS DISTINCT FROM 'string'
             OR recipient ->> 'coefficient' !~ '^(0|[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?)$'
           )
         )
         OR (
           jsonb_typeof(recipient -> 'm2') IS DISTINCT FROM 'null'
           AND (
             jsonb_typeof(recipient -> 'm2') IS DISTINCT FROM 'string'
             OR recipient ->> 'm2' !~ '^(0|[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?)$'
           )
         )
      THEN
        RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
      END IF;

      IF recipient -> 'coefficient' IS NULL OR jsonb_typeof(recipient -> 'coefficient') = 'null' THEN
        all_coefficients := false;
      ELSE
        coefficient_total := coefficient_total + (recipient ->> 'coefficient')::numeric;
      END IF;
    END LOOP;

    canonical_weight_source := movement ->> 'weightSource';
    IF canonical_weight_source = 'COEFFICIENT'
       AND (NOT all_coefficients OR coefficient_total <= 0) THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;
    IF canonical_weight_source = 'M2'
       AND (
         EXISTS (
           SELECT 1
           FROM jsonb_array_elements(movement -> 'recipients') AS item(value)
           WHERE jsonb_typeof(item.value -> 'm2') IS DISTINCT FROM 'string'
         )
         OR (
           SELECT COALESCE(SUM((item.value ->> 'm2')::numeric), 0)
           FROM jsonb_array_elements(movement -> 'recipients') AS item(value)
         ) <= 0
       ) THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;

    FOR recipient IN SELECT value FROM jsonb_array_elements(movement -> 'recipients') AS item(value) LOOP
      expected_weight := CASE
        WHEN canonical_weight_source = 'COEFFICIENT' THEN (recipient ->> 'coefficient')::numeric
        WHEN canonical_weight_source = 'M2' THEN (recipient ->> 'm2')::numeric
        ELSE 1
      END;
      IF (recipient ->> 'weight')::numeric IS DISTINCT FROM expected_weight THEN
        RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
      END IF;
      calculated_weight := calculated_weight + expected_weight;
    END LOOP;
    IF calculated_weight IS DISTINCT FROM (movement ->> 'totalWeight')::numeric
       OR calculated_weight <= 0
    THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;

    movement_amount := (movement ->> 'amountMinor')::bigint;
    SELECT COALESCE(SUM((item.value ->> 'amountMinor')::bigint), 0)
    INTO movement_total
    FROM jsonb_array_elements(movement -> 'allocations') AS item(value);
    IF movement_total IS DISTINCT FROM movement_amount
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(movement -> 'allocations') AS item(value)
         LEFT JOIN jsonb_array_elements(movement -> 'recipients') AS recipients(value)
           ON item.value ->> 'unitId' = recipients.value ->> 'unitId'
         WHERE recipients.value IS NULL
            OR jsonb_typeof(item.value -> 'unitCode') IS DISTINCT FROM 'string'
            OR btrim(item.value ->> 'unitCode') = ''
            OR item.value ->> 'unitCode' IS DISTINCT FROM recipients.value ->> 'unitCode'
            OR NULLIF(btrim(item.value ->> 'unitLabel'), '') IS DISTINCT FROM
               NULLIF(btrim(recipients.value ->> 'unitLabel'), '')
       )
    THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;

    IF movement_amount <> 0 AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(movement -> 'recipients') AS item(value)
      WHERE (item.value ->> 'weight')::numeric > 0
    ) THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;

    FOR expected_row IN
      WITH recipients AS (
        SELECT
          item.value ->> 'unitId' AS unit_id,
          (item.value ->> 'weight')::numeric AS weight
        FROM jsonb_array_elements(movement -> 'recipients') AS item(value)
      ),
      base AS (
        SELECT
          unit_id,
          exact_amount,
          CASE
            WHEN exact_amount - floor(exact_amount) > 0.5 THEN floor(exact_amount) + 1
            WHEN exact_amount - floor(exact_amount) < 0.5 THEN floor(exact_amount)
            WHEN mod(floor(exact_amount), 2) = 0 THEN floor(exact_amount)
            ELSE floor(exact_amount) + 1
          END AS rounded_amount
        FROM (
          SELECT unit_id,
                 ((movement ->> 'amountMinor')::numeric * weight) /
                   (SELECT SUM(weight) FROM recipients) AS exact_amount
          FROM recipients
        ) AS exact_values
      ),
      summary AS (
        SELECT
          SUM(rounded_amount) AS rounded_total,
          COUNT(*) AS recipient_count,
          COUNT(*) FILTER (WHERE rounded_amount > 0) AS positive_count
        FROM base
      ),
      ordered_all AS (
        SELECT
          base.*,
          summary.rounded_total,
          summary.recipient_count,
          summary.positive_count,
          row_number() OVER (
            ORDER BY
              CASE WHEN ((movement ->> 'amountMinor')::numeric - summary.rounded_total) >= 0
                THEN base.exact_amount - base.rounded_amount END DESC NULLS LAST,
              CASE WHEN ((movement ->> 'amountMinor')::numeric - summary.rounded_total) < 0
                THEN base.exact_amount - base.rounded_amount END ASC NULLS LAST,
              base.unit_id
          ) AS all_rank
        FROM base CROSS JOIN summary
      ),
      ordered_positive AS (
        SELECT
          unit_id,
          row_number() OVER (
            ORDER BY exact_amount - rounded_amount ASC, unit_id
          ) AS positive_rank
        FROM base
        WHERE rounded_amount > 0
      )
      SELECT
        ordered_all.unit_id,
        CASE
          WHEN ((movement ->> 'amountMinor')::numeric - ordered_all.rounded_total) >= 0 THEN
            ordered_all.rounded_amount
            + floor(((movement ->> 'amountMinor')::numeric - ordered_all.rounded_total) /
                    ordered_all.recipient_count)
            + CASE WHEN ordered_all.all_rank <= mod(
                ((movement ->> 'amountMinor')::numeric - ordered_all.rounded_total),
                ordered_all.recipient_count
              ) THEN 1 ELSE 0 END
          ELSE
            ordered_all.rounded_amount
            - floor((ordered_all.rounded_total - (movement ->> 'amountMinor')::numeric) /
                    NULLIF(ordered_all.positive_count, 0))
            - CASE WHEN ordered_positive.positive_rank <= mod(
                (ordered_all.rounded_total - (movement ->> 'amountMinor')::numeric),
                NULLIF(ordered_all.positive_count, 0)
              ) THEN 1 ELSE 0 END
        END AS expected_amount
      FROM ordered_all
      LEFT JOIN ordered_positive USING (unit_id)
    LOOP
      SELECT (item.value ->> 'amountMinor')::bigint
      INTO actual_amount
      FROM jsonb_array_elements(movement -> 'allocations') AS item(value)
      WHERE item.value ->> 'unitId' = expected_row.unit_id;

      IF NOT FOUND OR actual_amount IS DISTINCT FROM expected_row.expected_amount::bigint THEN
        RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
      END IF;

      existing_amount := COALESCE((recalculated_allocations ->> expected_row.unit_id)::bigint, 0);
      recalculated_allocations := jsonb_set(
        recalculated_allocations,
        ARRAY[expected_row.unit_id],
        to_jsonb(existing_amount + expected_row.expected_amount::bigint),
        true
      );

      SELECT item.value
      INTO existing_identity
      FROM jsonb_array_elements(movement -> 'recipients') AS item(value)
      WHERE item.value ->> 'unitId' = expected_row.unit_id;
      IF allocation_identity ? expected_row.unit_id
         AND (
           allocation_identity -> expected_row.unit_id ->> 'unitCode' IS DISTINCT FROM existing_identity ->> 'unitCode'
           OR NULLIF(btrim(allocation_identity -> expected_row.unit_id ->> 'unitLabel'), '') IS DISTINCT FROM
              NULLIF(btrim(existing_identity ->> 'unitLabel'), '')
         )
      THEN
        RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
      END IF;
      allocation_identity := jsonb_set(
        allocation_identity,
        ARRAY[expected_row.unit_id],
        jsonb_build_object(
          'unitCode', existing_identity -> 'unitCode',
          'unitLabel', existing_identity -> 'unitLabel'
        ),
        true
      );
    END LOOP;
  END LOOP;

  IF (SELECT COUNT(*) FROM jsonb_object_keys(recalculated_allocations)) <>
     jsonb_array_length(snapshot -> 'allocations') THEN
    RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
  END IF;

  FOR allocation IN SELECT value FROM jsonb_array_elements(snapshot -> 'allocations') AS item(value) LOOP
    IF (recalculated_allocations ->> (allocation ->> 'unitId'))::bigint IS DISTINCT FROM
         (allocation ->> 'amountMinor')::bigint
       OR allocation_identity -> (allocation ->> 'unitId') ->> 'unitCode' IS DISTINCT FROM allocation ->> 'unitCode'
       OR NULLIF(btrim(allocation_identity -> (allocation ->> 'unitId') ->> 'unitLabel'), '') IS DISTINCT FROM
          NULLIF(btrim(allocation ->> 'unitLabel'), '')
    THEN
      RAISE EXCEPTION 'modern liquidation publication requires complete frozen distribution evidence';
    END IF;
  END LOOP;
END;
$$;

-- New NULL rows are not historical rows. Existing NULL rows remain publishable
-- only through the explicit legacy V1/V2 publication path.
CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."publicationIntegrityVersion" IS NULL THEN
    RAISE EXCEPTION 'new liquidations require publication integrity v1';
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

-- The original trigger retains the 3D.1/3D.2 publication checks. Remove only
-- its mutable Unit existence predicate; Charge foreign keys remain the
-- relational safeguard when generated charges are written.
DO $$
DECLARE
  function_definition text;
  rewritten_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO function_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema()
    AND p.proname = 'enforce_liquidation_publication_integrity'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'existing liquidation publication trigger function is missing';
  END IF;

  rewritten_definition := regexp_replace(
    function_definition,
    E'OR NOT EXISTS \\(\\s+SELECT 1\\s+FROM "Unit" unit\\s+WHERE unit\\."id" = allocation ->> ''unitId''\\s+AND unit\\."tenantId" = NEW\\."tenantId"\\s+AND unit\\."buildingId" = NEW\\."buildingId"\\s+AND TRUE\\s+AND TRUE\\s+\\)',
    'OR FALSE',
    'n'
  );

  IF rewritten_definition = function_definition THEN
    RAISE EXCEPTION 'mutable Unit publication predicate was not found';
  END IF;

  EXECUTE rewritten_definition;
END;
$$;

DROP TRIGGER IF EXISTS "Liquidation_publication_integrity" ON "Liquidation";
CREATE TRIGGER "Liquidation_publication_integrity"
BEFORE INSERT OR UPDATE OR DELETE ON "Liquidation"
FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_publication_integrity();
