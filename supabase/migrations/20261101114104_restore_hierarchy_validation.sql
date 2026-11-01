BEGIN;
CREATE OR REPLACE FUNCTION app_private.restore_backup(b jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t text;row jsonb;rows jsonb;payload jsonb:=b->'payload';report jsonb;has_rows boolean;cols text;fk record;source_id text;target_id uuid;identity jsonb;mapping jsonb:='{}';rec record;seq text;next_id bigint;changed integer:=0;
BEGIN
 report:=app_private.validate_backup(b);
 -- Validate reachability before loading rows with application triggers suspended.
 -- UNION deduplicates IDs: malformed cycles (including a branch pointing into a
 -- cycle) cannot make the older recursive parent trigger loop indefinitely.
 WITH RECURSIVE h AS (SELECT id,parent_id FROM jsonb_populate_recordset(NULL::public.households,payload->'tables'->'public.households')),
 reachable(id) AS (SELECT id FROM h WHERE parent_id IS NULL UNION SELECT h.id FROM h JOIN reachable p ON h.parent_id=p.id)
 SELECT (SELECT count(*) FROM h)<>(SELECT count(*) FROM reachable) INTO has_rows;
 IF has_rows THEN RAISE EXCEPTION 'Household hierarchy cycle, duplicate ID or missing parent';END IF;

 -- Consistent lock order, shared with existing management operations. Keep the event closed.
 PERFORM pg_advisory_xact_lock(19421,7744);
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',t);END LOOP;
 IF EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) THEN RAISE EXCEPTION 'Restore destination must be unpublished';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF t IN ('public.event_languages','public.event_settings') THEN CONTINUE;END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s)',t) INTO has_rows;
  IF has_rows THEN RAISE EXCEPTION 'Restore requires an empty application destination; % contains records',t;END IF;
 END LOOP;
 -- Map foreign-key actors by the original verified email, never by user-supplied privileges.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
    source_id:=row->>fk.attname;IF source_id IS NULL OR mapping ? source_id THEN CONTINUE;END IF;
    SELECT u INTO identity FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=source_id;
    IF identity IS NULL THEN RAISE EXCEPTION 'Missing actor identity metadata';END IF;
    SELECT id INTO target_id FROM auth.users WHERE lower(email)=lower(identity->>'email') AND email_confirmed_at IS NOT NULL;
    IF target_id IS NULL THEN RAISE EXCEPTION 'Recreate and verify the historical actor account % before restoring',identity->>'email';END IF;
    mapping:=mapping||jsonb_build_object(source_id,target_id);
   END LOOP;
  END LOOP;
 END LOOP;
 -- Disable only application triggers, transactionally, so imports do not regenerate
 -- invitation codes, create synthetic history, or reject valid out-of-order parents.
 -- Foreign keys, types, unique constraints and CHECK constraints stay enforced.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER',t);END LOOP;
 DELETE FROM public.event_settings;DELETE FROM public.event_languages;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  rows:='[]';
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
   FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
    source_id:=row->>fk.attname;IF source_id IS NOT NULL THEN row:=jsonb_set(row,ARRAY[fk.attname],mapping->source_id);END IF;
   END LOOP;
   IF t='public.admin_membership_audit' THEN FOREACH source_id IN ARRAY ARRAY['actor_id','subject_id'] LOOP IF mapping ? (row->>source_id) THEN row:=jsonb_set(row,ARRAY[source_id],mapping->(row->>source_id));END IF;END LOOP;END IF;
   IF t='public.households' THEN row:=row||'{"parent_id":null,"latest_rsvp_submission_id":null}'::jsonb;END IF;
   IF t='public.event_settings' THEN row:=row||'{"is_published":false}'::jsonb;END IF;
   IF t='public.admin_invitations' AND row->>'status'='pending' THEN row:=row||jsonb_build_object('status','cancelled','expires_at',clock_timestamp(),'attempt_id',gen_random_uuid());END IF;
   rows:=rows||jsonb_build_array(row);
  END LOOP;
  SELECT string_agg(format('%I',attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('INSERT INTO %s (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::%s,$1)',t,cols,cols,t) USING rows;
 END LOOP;
 -- Resolve circular household/submission references once every row exists.
 FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->'public.households') LOOP
  UPDATE public.households SET parent_id=(row->>'parent_id')::uuid,latest_rsvp_submission_id=(row->>'latest_rsvp_submission_id')::uuid WHERE id=(row->>'id')::uuid;
 END LOOP;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s ENABLE TRIGGER USER',t);END LOOP;
 -- Re-run hierarchy and language guards without changing profile values or history.
 UPDATE public.households SET parent_id=parent_id;
 UPDATE public.event_settings SET default_language=default_language,fallback_language=fallback_language;
 IF EXISTS(SELECT 1 FROM public.households h WHERE (h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)) AND h.invite_code IS NOT NULL) THEN RAISE EXCEPTION 'Backup contains an invalid invitation code assignment';END IF;
 IF EXISTS(SELECT 1 FROM public.households h WHERE h.invite_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_private.invitation_code_registry r WHERE r.code=h.invite_code AND r.household_id=h.id)) THEN RAISE EXCEPTION 'Invitation code registry mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items f WHERE (SELECT coalesce(sum(quantity),0) FROM public.food_claims WHERE food_item_id=f.id)>f.quantity_needed) THEN RAISE EXCEPTION 'Food claims exceed available quantities';END IF;
 -- Restart identity sequences with transactional ALTER, not nontransactional setval.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR rec IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND attidentity<>'' LOOP
   seq:=pg_get_serial_sequence(t,rec.attname);EXECUTE format('SELECT coalesce(max(%I),0)+1 FROM %s',rec.attname,t) INTO next_id;
   EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
  END LOOP;
 END LOOP;
 INSERT INTO public.backup_restore_audit(actor_user_id,checksum,source_created_at,restored_counts) VALUES(auth.uid(),b->>'checksum',(payload->>'created_at')::timestamptz,payload->'counts');
 RETURN report||jsonb_build_object('restored',true,'is_published',false,'identity_mapping',mapping,'administrator_access_restored',false);
END $$;
REVOKE ALL ON FUNCTION app_private.restore_backup(jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
