-- Release A compatibility is a surgical transition over the hardened DB106
-- functions. Keep every publication and distribution invariant already present
-- in the database; widen only the legacy V1/V2 allowlist to include V3 and
-- permit new NULL-integrity drafts without changing V1 ownership validation.
DO $$
DECLARE
  function_definition text;
  rewritten_definition text;
  old_clause constant text := $old$
          OR (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '1'::jsonb
             AND (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '2'::jsonb THEN$old$;
  new_clause constant text := $new$
          OR (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '1'::jsonb
             AND (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '2'::jsonb
             AND (NEW."publicationSnapshot" -> 'version') IS DISTINCT FROM '3'::jsonb THEN$new$;
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

  -- Guard against running against the wrong function generation or a partial
  -- DB106 definition. These markers represent the modern V4 metadata contract.
  IF position('NEW."publicationSnapshot" -> ''version'' IS DISTINCT FROM ''4''::jsonb' IN function_definition) = 0
     OR position('NEW."publicationSnapshot" ->> ''period'' IS DISTINCT FROM NEW."period"' IN function_definition) = 0
     OR position('NEW."publicationSnapshot" ->> ''chargePeriod'' IS DISTINCT FROM NEW."chargePeriod"' IN function_definition) = 0
     OR position('NEW."publicationSnapshot" -> ''publicationIntegrityVersion'' IS DISTINCT FROM ''1''::jsonb' IN function_definition) = 0
     OR position('publishing a liquidation requires publication metadata' IN function_definition) = 0
     OR position('modern liquidation identity and evidence are immutable' IN function_definition) = 0
     OR position('expenseSourceEvidence' IN function_definition) = 0
     OR position('publicationExpenseEvidence' IN function_definition) = 0
     OR position('allocationChargeEvidence' IN function_definition) = 0
     OR position('distributionAllocationEvidence' IN function_definition) = 0
     OR position('publicationAllocationEvidence' IN function_definition) = 0
     OR position('generatedChargeEvidence' IN function_definition) = 0
     OR position('modern liquidation publication requires complete matching V4 evidence' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'hardened DB106 V4 publication contract markers are missing';
  END IF;

  IF length(function_definition) - length(replace(function_definition, old_clause, ''))
       <> length(old_clause) THEN
    RAISE EXCEPTION 'expected DB106 legacy V1/V2 publication-version clause was not found exactly once';
  END IF;

  rewritten_definition := replace(function_definition, old_clause, new_clause);
  EXECUTE rewritten_definition;
END;
$$;

DO $$
DECLARE
  function_definition text;
  rewritten_definition text;
  old_clause constant text := $old$
  IF TG_OP = 'INSERT' AND NEW."publicationIntegrityVersion" IS NULL THEN
    RAISE EXCEPTION 'new liquidations require publication integrity v1';
  END IF;
$old$;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO function_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema()
    AND p.proname = 'enforce_liquidation_publication_integrity_origin'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'liquidation publication origin trigger function is missing';
  END IF;

  IF position('modern liquidation distribution recipients must belong to the liquidation tenant and building' IN function_definition) = 0
     OR position('validate_liquidation_distribution_snapshot(' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'hardened DB106 origin ownership or distribution validation markers are missing';
  END IF;

  IF length(function_definition) - length(replace(function_definition, old_clause, ''))
       <> length(old_clause) THEN
    RAISE EXCEPTION 'expected DB106 new-NULL-insert rejection was not found exactly once';
  END IF;

  rewritten_definition := replace(function_definition, old_clause, '');
  EXECUTE rewritten_definition;
END;
$$;
