-- Preserve every forecast equation and every validation branch. Repeated
-- JSONB concatenation recopies the accumulated population on each iteration.
-- PL/pgSQL expanded arrays support appending without rebuilding that JSONB
-- document; jsonb_build_object converts the ordered array once at the end.
DO $migration$
DECLARE signature text; body text; declaration text; expected_appends integer;
 append_sql text := 'players:=players||jsonb_build_array(p);';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.canonical_prepare_projection_refresh(integer,text)',
  'public.canonical_prepare_staged_source_refresh(integer,text,text)',
  'public.canonical_apply_bound_finishing(jsonb)'
 ] LOOP
  IF has_function_privilege('anon',signature,'EXECUTE')
   OR has_function_privilege('authenticated',signature,'EXECUTE')
   OR NOT has_function_privilege('service_role',signature,'EXECUTE') THEN
   RAISE EXCEPTION 'Worker-only preparation grants required: %',signature;
  END IF;
  SELECT pg_get_functiondef(signature::regprocedure) INTO STRICT body;
  IF signature='public.canonical_apply_bound_finishing(jsonb)' THEN
   declaration:='players jsonb:=''[]'';';expected_appends:=1;
  ELSE
   declaration:='players jsonb=''[]'';';expected_appends:=2;
  END IF;
  IF (length(body)-length(replace(body,declaration,'')))/length(declaration)<>1
   OR (length(body)-length(replace(body,append_sql,'')))/length(append_sql)<>expected_appends
   OR position('''players'',players,' IN body)=0 THEN
   RAISE EXCEPTION 'Preparation assembly changed; inspect before replacing: %',signature;
  END IF;
  body:=replace(body,declaration,'players jsonb[]:=ARRAY[]::jsonb[];');
  body:=replace(body,append_sql,'players:=array_append(players,p);');
  EXECUTE body;
 END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';
