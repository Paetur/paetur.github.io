BEGIN;
CREATE TABLE public.backup_restore_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid NOT NULL REFERENCES auth.users(id),checksum text NOT NULL,source_created_at timestamptz,restored_counts jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.backup_restore_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_restore_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.backup_restore_audit TO authenticated;
CREATE INDEX backup_restore_actor ON public.backup_restore_audit(actor_user_id);
CREATE POLICY admin_read ON public.backup_restore_audit FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE TRIGGER immutable_backup_restore_audit BEFORE UPDATE OR DELETE ON public.backup_restore_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
-- Fixed allowlist: no schema, table or SQL identifiers are accepted from backup files.
CREATE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_items',
 'public.food_claims','public.stuff_to_bring','public.things_to_do','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.backup_columns(t text) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'required',attnotnull,'identity',attidentity) ORDER BY attnum)
 FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped
$$;
REVOKE ALL ON FUNCTION app_private.backup_columns(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.backup_payload() RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE tables jsonb:='{}';columns jsonb:='{}';counts jsonb:='{}';t text;rows jsonb;identities jsonb;ids text[]:=ARRAY[]::text[];fk record;one jsonb;
BEGIN
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  -- Convert bigint values to strings so JavaScript cannot round audit/identity IDs.
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM %s r',t) INTO rows;
  DECLARE a record;i integer;BEGIN
   FOR a IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND atttypid='bigint'::regtype AND attnum>0 AND NOT attisdropped LOOP
    FOR i IN 0..jsonb_array_length(rows)-1 LOOP
     IF rows->i->a.attname IS NOT NULL AND rows->i->a.attname<>'null'::jsonb THEN rows:=jsonb_set(rows,ARRAY[i::text,a.attname],to_jsonb(rows->i->>a.attname));END IF;
    END LOOP;
   END LOOP;
  END;
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR one IN SELECT value FROM jsonb_array_elements(rows) LOOP IF one->>fk.attname IS NOT NULL THEN ids:=array_append(ids,one->>fk.attname);END IF;END LOOP;
  END LOOP;
  tables:=tables||jsonb_build_object(t,rows);columns:=columns||jsonb_build_object(t,app_private.backup_columns(t));counts:=counts||jsonb_build_object(t,jsonb_array_length(rows));
 END LOOP;
 -- Only identity metadata, never passwords, tokens, Auth identities or sessions.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email)),'[]') INTO identities FROM auth.users WHERE id::text=ANY(ids) OR id IN(SELECT user_id FROM public.admins);
 RETURN jsonb_build_object('schema_version','20261101105111','created_at',clock_timestamp(),'tables',tables,'columns',columns,'counts',counts,'identities',identities,
 'sign_in_log_reference',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('id',a.id::text)),'[]') FROM public.admin_session_audit a),
 'administrator_reference',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.admins a));
END $$;
REVOKE ALL ON FUNCTION app_private.backup_payload() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.admin_export_backup() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE payload jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 payload:=app_private.backup_payload();
 IF octet_length(payload::text)>20000000 THEN RAISE EXCEPTION 'Application backup exceeds the 20 MB import limit; use managed database backup tools';END IF;
 RETURN jsonb_build_object('format','rsvp-application-backup','version',1,'payload',payload,'checksum',encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.admin_export_backup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_export_backup() TO authenticated;

CREATE FUNCTION app_private.validate_backup(b jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE t text;row jsonb;k text;cols text[];payload jsonb:=b->'payload';n bigint:=0;
BEGIN
 IF b->>'format' IS DISTINCT FROM 'rsvp-application-backup' OR b->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Unsupported backup format or version';END IF;
 IF payload->>'schema_version' IS DISTINCT FROM '20261101105111' THEN RAISE EXCEPTION 'Unsupported backup schema version';END IF;
 IF octet_length(b::text)>20971520 THEN RAISE EXCEPTION 'Backup exceeds 20 MB';END IF;
 IF b->>'checksum' IS DISTINCT FROM encode(sha256(convert_to(payload::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Backup checksum mismatch';END IF;
 IF jsonb_typeof(payload->'tables') IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'columns') IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'counts') IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'identities') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete backup manifest';END IF;
 IF (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(payload->'tables') x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(app_private.backup_tables()) x) THEN RAISE EXCEPTION 'Backup table set does not match this application';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF payload->'columns'->t IS DISTINCT FROM app_private.backup_columns(t) THEN RAISE EXCEPTION 'Schema mismatch for %. Install matching application migrations first',t;END IF;
  IF jsonb_typeof(payload->'tables'->t) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid table data: %',t;END IF;
  IF payload->'counts'->>t IS DISTINCT FROM jsonb_array_length(payload->'tables'->t)::text THEN RAISE EXCEPTION 'Row count mismatch: %',t;END IF;
  SELECT array_agg(attname::text) INTO cols FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
   IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(row))<>cardinality(cols) THEN RAISE EXCEPTION 'Missing fields in %',t;END IF;
   FOR k IN SELECT jsonb_object_keys(row) LOOP IF NOT k=ANY(cols) THEN RAISE EXCEPTION 'Unknown field in %',t;END IF;END LOOP;
  END LOOP;
  n:=n+jsonb_array_length(payload->'tables'->t);
 END LOOP;
 IF jsonb_array_length(payload->'tables'->'public.event_settings')<>1 THEN RAISE EXCEPTION 'Exactly one event settings record is required';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'identities') u WHERE nullif(u->>'id','') IS NULL OR nullif(u->>'email','') IS NULL)
 OR (SELECT count(*) FROM jsonb_array_elements(payload->'identities'))<>(SELECT count(DISTINCT u->>'id') FROM jsonb_array_elements(payload->'identities') u) THEN RAISE EXCEPTION 'Invalid identity manifest';END IF;
 RETURN jsonb_build_object('rows',n,'counts',payload->'counts','event_name',payload->'tables'->'public.event_settings'->0->>'event_name','created_at',payload->>'created_at');
END $$;
REVOKE ALL ON FUNCTION app_private.validate_backup(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.restore_backup(b jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t text;row jsonb;rows jsonb;payload jsonb:=b->'payload';report jsonb;has_rows boolean;cols text;fk record;source_id text;target_id uuid;identity jsonb;mapping jsonb:='{}';rec record;seq text;next_id bigint;changed integer:=0;
BEGIN
 report:=app_private.validate_backup(b);
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
CREATE FUNCTION public.admin_preview_backup(p_backup jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE report jsonb;result jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 report:=app_private.validate_backup(p_backup);
 -- Exercise the actual restore inside a rolled-back subtransaction, including all
 -- constraints and identity checks. No imported data, trigger changes or sequence
 -- restarts survive preview, regardless of success or failure.
 BEGIN
  result:=app_private.restore_backup(p_backup);
  RAISE EXCEPTION USING ERRCODE='P0199',MESSAGE='restore_preview_rollback';
 EXCEPTION WHEN SQLSTATE 'P0199' THEN RETURN report||jsonb_build_object('can_restore',true);
 WHEN OTHERS THEN RETURN report||jsonb_build_object('can_restore',false,'reason',SQLERRM);
 END;
END $$;
REVOKE ALL ON FUNCTION public.admin_preview_backup(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_backup(jsonb) TO authenticated;
CREATE FUNCTION public.admin_restore_backup(p_backup jsonb,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_confirmation IS DISTINCT FROM 'RESTORE '||coalesce(p_backup->'payload'->'tables'->'public.event_settings'->0->>'event_name','') THEN RAISE EXCEPTION 'Type RESTORE followed by the source event name';END IF;
 result:=app_private.restore_backup(p_backup);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_restore_backup(jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_backup(jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
