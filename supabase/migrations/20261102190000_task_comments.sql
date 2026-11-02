-- Atomic spreadsheet-style task edits. Existing due dates and notes are retained.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_save_tasks(p_rows jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;old public.things_to_do%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>1000 THEN RAISE EXCEPTION 'Enter at most 1000 task rows';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL)<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL) THEN RAISE EXCEPTION 'Duplicate task rows';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'id' LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR nullif(btrim(r->>'task'),'') IS NULL OR length(r->>'task')>1000 OR length(coalesce(r->>'assigned_to',''))>300 OR length(coalesce(r->>'notes',''))>4000 OR r->>'status' IS NULL OR r->>'status' NOT IN ('open','in_progress','done') OR (r->>'sort_order')::integer<0 THEN RAISE EXCEPTION 'Enter valid task, assignee and status';END IF;
  IF nullif(r->>'id','') IS NULL THEN
   INSERT INTO public.things_to_do(task,notes,assigned_to,status,sort_order) VALUES(btrim(r->>'task'),nullif(btrim(r->>'notes'),''),nullif(btrim(r->>'assigned_to'),''),r->>'status',(r->>'sort_order')::integer);
  ELSE
   SELECT * INTO old FROM public.things_to_do WHERE id=(r->>'id')::uuid FOR UPDATE;
   IF NOT FOUND OR old.updated_at IS DISTINCT FROM (r->>'expected_updated_at')::timestamptz THEN RAISE EXCEPTION 'Task changed; reload before saving';END IF;
   UPDATE public.things_to_do SET task=btrim(r->>'task'),notes=CASE WHEN r?'notes' THEN nullif(btrim(r->>'notes'),'') ELSE notes END,assigned_to=nullif(btrim(r->>'assigned_to'),''),status=r->>'status',sort_order=(r->>'sort_order')::integer,updated_at=clock_timestamp() WHERE id=old.id;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_tasks(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_tasks(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
