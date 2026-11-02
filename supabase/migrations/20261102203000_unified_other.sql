-- Canonical Other list. Preserve old read APIs during frontend rollout.
BEGIN;
LOCK TABLE public.things_to_do,public.stuff_to_bring IN ACCESS EXCLUSIVE MODE;
CREATE TABLE public.other_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE CHECK(length(btrim(name)) BETWEEN 1 AND 120),legacy_key text UNIQUE CHECK(legacy_key IN ('tasks','stuff')),sort_order integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO public.other_categories(name,legacy_key,sort_order) SELECT 'Things to do','tasks',0 WHERE EXISTS(SELECT 1 FROM public.things_to_do);
INSERT INTO public.other_categories(name,legacy_key,sort_order) SELECT 'Stuff to bring','stuff',1 WHERE EXISTS(SELECT 1 FROM public.stuff_to_bring);
ALTER TABLE public.things_to_do RENAME TO other_items;
ALTER TABLE public.other_items RENAME COLUMN task TO item;
ALTER TABLE public.other_items ADD COLUMN category_id uuid REFERENCES public.other_categories(id);
ALTER TABLE public.other_items ADD COLUMN quantity integer;
ALTER TABLE public.other_items ADD COLUMN source_kind text NOT NULL DEFAULT 'other' CHECK(source_kind IN ('task','stuff','other'));
ALTER TABLE public.other_items ADD COLUMN source_id uuid;
ALTER TABLE public.other_items DROP CONSTRAINT things_to_do_status_check;
ALTER TABLE public.other_items ADD CONSTRAINT other_status CHECK(status IN ('open','assigned','in_progress','done'));
UPDATE public.other_items SET category_id=(SELECT id FROM public.other_categories WHERE legacy_key='tasks'),source_kind='task',source_id=id;
INSERT INTO public.other_items(id,item,assigned_to,status,due_date,notes,sort_order,created_at,updated_at,quantity,category_id,source_kind,source_id)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.other_items o WHERE o.id=s.id) THEN gen_random_uuid() ELSE s.id END,s.item,s.assigned_to,s.status,NULL,s.notes,s.sort_order,s.created_at,s.updated_at,s.quantity,(SELECT id FROM public.other_categories WHERE legacy_key='stuff'),'stuff',s.id FROM public.stuff_to_bring s;
ALTER TABLE public.other_items ALTER COLUMN category_id SET NOT NULL;
CREATE INDEX other_items_category ON public.other_items(category_id);
CREATE UNIQUE INDEX other_source_identity ON public.other_items(source_kind,source_id) WHERE source_id IS NOT NULL;
ALTER TABLE public.stuff_to_bring RENAME TO legacy_stuff_to_bring;
REVOKE ALL ON public.legacy_stuff_to_bring FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_legacy_stuff BEFORE INSERT OR UPDATE OR DELETE ON public.legacy_stuff_to_bring FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
ALTER TABLE public.other_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.other_categories,public.other_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.other_categories,public.other_items TO authenticated;
CREATE POLICY admin_read ON public.other_categories FOR SELECT TO authenticated USING((SELECT public.is_admin()));
-- other_items retains the administrator-only RLS policy from the original task table.
CREATE VIEW public.things_to_do WITH(security_invoker=true) AS SELECT id,item AS task,assigned_to,status,due_date,notes,sort_order,created_at,updated_at FROM public.other_items WHERE source_kind='task';
CREATE VIEW public.stuff_to_bring WITH(security_invoker=true) AS SELECT source_id AS id,item,quantity,assigned_to,status,notes,sort_order,created_at,updated_at FROM public.other_items WHERE source_kind='stuff';
REVOKE ALL ON public.things_to_do,public.stuff_to_bring FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.things_to_do,public.stuff_to_bring TO authenticated;
CREATE FUNCTION public.admin_save_other(p_id uuid,p_values jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.other_items%ROWTYPE;result public.other_items%ROWTYPE;category uuid:=(p_values->>'category_id')::uuid;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR nullif(btrim(p_values->>'item'),'') IS NULL OR length(p_values->>'item')>1000 OR length(coalesce(p_values->>'notes',''))>4000 OR length(coalesce(p_values->>'assigned_to',''))>300 OR p_values->>'status' IS NULL OR p_values->>'status' NOT IN ('open','assigned','in_progress','done') OR (p_values->>'sort_order') IS NULL OR (p_values->>'sort_order')::integer<0 THEN RAISE EXCEPTION 'Enter valid item details';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.other_categories WHERE id=category) THEN RAISE EXCEPTION 'Choose a category';END IF;
 SELECT * INTO old FROM public.other_items WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  -- Stable client UUIDs make new-row retries safe after an uncertain response.
  IF p_expected_updated_at IS NULL THEN
   IF old.item=btrim(p_values->>'item') AND coalesce(old.notes,'')=btrim(coalesce(p_values->>'notes','')) AND coalesce(old.assigned_to,'')=btrim(coalesce(p_values->>'assigned_to','')) AND old.status=p_values->>'status' AND old.category_id=category THEN RETURN to_jsonb(old);END IF;
   RAISE EXCEPTION 'Item changed; reload before saving';
  END IF;
  IF old.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Item changed; reload before saving';END IF;
  UPDATE public.other_items SET item=btrim(p_values->>'item'),notes=nullif(btrim(p_values->>'notes'),''),assigned_to=nullif(btrim(p_values->>'assigned_to'),''),status=p_values->>'status',category_id=category,sort_order=(p_values->>'sort_order')::integer,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO result;
 ELSE
  IF p_expected_updated_at IS NOT NULL THEN RAISE EXCEPTION 'Item not found';END IF;
  INSERT INTO public.other_items(id,item,notes,assigned_to,status,category_id,sort_order) VALUES(p_id,btrim(p_values->>'item'),nullif(btrim(p_values->>'notes'),''),nullif(btrim(p_values->>'assigned_to'),''),p_values->>'status',category,(p_values->>'sort_order')::integer) RETURNING * INTO result;
 END IF;
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.admin_save_other(uuid,jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_other(uuid,jsonb,timestamptz) TO authenticated;
CREATE FUNCTION public.admin_save_other_category(p_id uuid,p_name text,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result public.other_categories%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>120 THEN RAISE EXCEPTION 'Enter a category name';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_id IS NULL THEN
  SELECT * INTO result FROM public.other_categories WHERE name=btrim(p_name);IF FOUND THEN RETURN to_jsonb(result);END IF;
  INSERT INTO public.other_categories(name,sort_order) VALUES(btrim(p_name),(SELECT coalesce(max(sort_order),0)+1 FROM public.other_categories)) RETURNING * INTO result;
 ELSE
  SELECT * INTO result FROM public.other_categories WHERE id=p_id FOR UPDATE;IF NOT FOUND OR result.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Category changed; reload before saving';END IF;
  UPDATE public.other_categories SET name=btrim(p_name),updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO result;
 END IF;
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.admin_save_other_category(uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_other_category(uuid,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_tasks(p_rows jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;old public.other_items%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>1000 THEN RAISE EXCEPTION 'Enter at most 1000 task rows';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL)<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL) THEN RAISE EXCEPTION 'Duplicate task rows';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 INSERT INTO public.other_categories(name,legacy_key,sort_order) SELECT 'Things to do','tasks',0 WHERE NOT EXISTS(SELECT 1 FROM public.other_categories WHERE legacy_key='tasks') ON CONFLICT(name) DO NOTHING;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'id' LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR nullif(btrim(r->>'task'),'') IS NULL OR length(r->>'task')>1000 OR length(coalesce(r->>'assigned_to',''))>300 OR length(coalesce(r->>'notes',''))>4000 OR r->>'status' IS NULL OR r->>'status' NOT IN ('open','in_progress','done') OR (r->>'sort_order')::integer<0 THEN RAISE EXCEPTION 'Enter valid task, assignee and status';END IF;
  IF nullif(r->>'id','') IS NULL THEN
   INSERT INTO public.other_items(item,notes,assigned_to,status,sort_order,category_id,source_kind) VALUES(btrim(r->>'task'),nullif(btrim(r->>'notes'),''),nullif(btrim(r->>'assigned_to'),''),r->>'status',(r->>'sort_order')::integer,(SELECT id FROM public.other_categories ORDER BY (legacy_key='tasks') DESC NULLS LAST,sort_order,id LIMIT 1),'task');
  ELSE
   SELECT * INTO old FROM public.other_items WHERE id=(r->>'id')::uuid AND source_kind='task' FOR UPDATE;
   IF NOT FOUND OR old.updated_at IS DISTINCT FROM (r->>'expected_updated_at')::timestamptz THEN RAISE EXCEPTION 'Task changed; reload before saving';END IF;
   UPDATE public.other_items SET item=btrim(r->>'task'),notes=CASE WHEN r?'notes' THEN nullif(btrim(r->>'notes'),'') ELSE notes END,assigned_to=nullif(btrim(r->>'assigned_to'),''),status=r->>'status',sort_order=(r->>'sort_order')::integer,updated_at=clock_timestamp() WHERE id=old.id;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_tasks(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_tasks(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_recipes','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;


NOTIFY pgrst,'reload schema';
COMMIT;
