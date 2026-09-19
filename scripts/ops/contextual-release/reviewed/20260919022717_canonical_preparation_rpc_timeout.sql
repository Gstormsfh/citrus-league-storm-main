-- Preparing the complete canonical population is a protected worker RPC.
-- Match the existing bounded publication allowance without changing API role
-- defaults, function bodies, ownership, permissions or numerical policies.
DO $$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.canonical_prepare_projection_refresh(integer,text)',
    'public.canonical_prepare_staged_source_refresh(integer,text,text)'
  ] LOOP
    IF has_function_privilege('anon', signature, 'EXECUTE')
       OR has_function_privilege('authenticated', signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Worker-only preparation grants required: %', signature;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET statement_timeout TO %L', signature, '55s');
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
