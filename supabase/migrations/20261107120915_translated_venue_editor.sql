BEGIN;
-- Install before the new frontend so venue details and translations save atomically.
CREATE FUNCTION public.admin_save_venue_with_translations(p_id uuid,p_values jsonb,p_translations jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE venue_id uuid; translation record;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_translations) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid venue translations'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_translations))>300 THEN RAISE EXCEPTION 'Too many translations in one save'; END IF;
 venue_id:=public.admin_save_venue(p_id,p_values);
 FOR translation IN SELECT key,value FROM jsonb_each(p_translations) LOOP
  IF jsonb_typeof(translation.value) IS DISTINCT FROM 'string' OR length(translation.value #>> '{}')>4000 THEN
   RAISE EXCEPTION 'Welcome message too long (maximum 4000 characters per language)';
  END IF;
  PERFORM public.admin_save_translation('venue:'||venue_id||':welcome',translation.key,translation.value #>> '{}');
 END LOOP;
 RETURN venue_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_venue_with_translations(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_venue_with_translations(uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
