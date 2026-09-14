-- Apply the null-safe publication checks to databases that already ran the
-- original Phase 3D.2 migrations.
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
    RAISE EXCEPTION 'liquidation publication trigger function is missing';
  END IF;

  rewritten_definition := replace(
    function_definition,
    $replace$NEW."publicationSnapshot" ->> 'version' NOT IN ('1', '2')$replace$,
    $replace$((NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '1'::jsonb
       AND (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '2'::jsonb)$replace$
  );

  IF rewritten_definition <> function_definition THEN
    EXECUTE rewritten_definition;
  END IF;
END;
$$;

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
    AND p.proname = 'validate_liquidation_distribution_snapshot';

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'liquidation distribution validation function is missing';
  END IF;

  rewritten_definition := replace(
    function_definition,
    $replace$movement ->> 'scope' NOT IN ('BUILDING', 'UNIT_GROUP', 'ADJUSTMENT')$replace$,
    $replace$jsonb_typeof(movement -> 'scope') IS DISTINCT FROM 'string'
      OR (movement ->> 'scope') IS DISTINCT FROM 'BUILDING'
         AND (movement ->> 'scope') IS DISTINCT FROM 'UNIT_GROUP'
         AND (movement ->> 'scope') IS DISTINCT FROM 'ADJUSTMENT')$replace$
  );
  rewritten_definition := replace(
    rewritten_definition,
    $replace$movement ->> 'scope' <> 'UNIT_GROUP'$replace$,
    $replace$movement ->> 'scope' IS DISTINCT FROM 'UNIT_GROUP'$replace$
  );
  rewritten_definition := replace(
    rewritten_definition,
    $replace$movement ->> 'weightSource' NOT IN ('COEFFICIENT', 'M2', 'EQUAL')$replace$,
    $replace$jsonb_typeof(movement -> 'weightSource') IS DISTINCT FROM 'string'
      OR (movement ->> 'weightSource') IS DISTINCT FROM 'COEFFICIENT'
         AND (movement ->> 'weightSource') IS DISTINCT FROM 'M2'
         AND (movement ->> 'weightSource') IS DISTINCT FROM 'EQUAL')$replace$
  );

  IF rewritten_definition <> function_definition THEN
    EXECUTE rewritten_definition;
  END IF;
END;
$$;
