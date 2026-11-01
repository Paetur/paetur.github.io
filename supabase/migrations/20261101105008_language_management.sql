BEGIN;
ALTER TABLE public.event_languages ADD CONSTRAINT event_language_code_format CHECK(language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
ALTER TABLE public.event_settings ADD COLUMN fallback_language text NOT NULL DEFAULT 'en' REFERENCES public.event_languages(language_code);
ALTER TABLE public.households DROP CONSTRAINT IF EXISTS households_language_check;
ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_language_check;
ALTER TABLE public.households ADD CONSTRAINT households_language_fk FOREIGN KEY(language) REFERENCES public.event_languages(language_code);
ALTER TABLE public.guests ADD CONSTRAINT guests_language_fk FOREIGN KEY(language) REFERENCES public.event_languages(language_code);
CREATE INDEX households_language ON public.households(language);
CREATE INDEX guests_language ON public.guests(language);

CREATE FUNCTION app_private.guard_language_preferences() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.event_languages WHERE language_code IN(NEW.default_language,NEW.fallback_language) ORDER BY language_code FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=NEW.default_language AND enabled)
 OR NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=NEW.fallback_language AND enabled) THEN
 RAISE EXCEPTION 'Default and fallback languages must be enabled';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_language_preferences() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER language_preferences_guard BEFORE INSERT OR UPDATE OF default_language,fallback_language ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_language_preferences();
CREATE FUNCTION app_private.guard_language_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Disable languages instead of deleting their translations';END IF;
 IF NEW.language_code IS DISTINCT FROM OLD.language_code THEN RAISE EXCEPTION 'Language codes cannot be renamed';END IF;
 IF NOT NEW.enabled AND EXISTS(SELECT 1 FROM public.event_settings WHERE default_language=OLD.language_code OR fallback_language=OLD.language_code) THEN RAISE EXCEPTION 'Choose another default and fallback before disabling this language';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_language_removal() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER language_removal_guard BEFORE UPDATE OR DELETE ON public.event_languages FOR EACH ROW EXECUTE FUNCTION app_private.guard_language_removal();
CREATE FUNCTION app_private.guard_profile_language() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE code text;old_code text;
BEGIN
 code:=to_jsonb(NEW)->>TG_ARGV[0];IF TG_OP='UPDATE' THEN old_code:=to_jsonb(OLD)->>TG_ARGV[0];END IF;
 IF code IS NOT NULL AND code IS DISTINCT FROM old_code THEN PERFORM 1 FROM public.event_languages WHERE language_code=code FOR SHARE;END IF;
 IF code IS NOT NULL AND code IS DISTINCT FROM old_code AND NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=code AND enabled) THEN RAISE EXCEPTION 'Choose an enabled language';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_profile_language() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER household_language_guard BEFORE INSERT OR UPDATE OF language ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_language('language');
CREATE TRIGGER guest_language_guard BEFORE INSERT OR UPDATE OF language ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_language('language');
CREATE TRIGGER contact_language_guard BEFORE INSERT OR UPDATE OF language_code ON public.household_contacts FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_language('language_code');

CREATE FUNCTION public.admin_save_language(p_code text,p_name text,p_enabled boolean,p_order integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_code IS NULL OR p_code !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' OR length(p_code)>16 OR nullif(btrim(p_name),'') IS NULL OR length(p_name)>80 OR p_enabled IS NULL OR p_order IS NULL THEN RAISE EXCEPTION 'Enter a language code, name, enabled state and order';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 INSERT INTO public.event_languages(language_code,display_name,enabled,sort_order) VALUES(p_code,btrim(p_name),p_enabled,p_order)
 ON CONFLICT(language_code) DO UPDATE SET display_name=excluded.display_name,enabled=excluded.enabled,sort_order=excluded.sort_order;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_language(text,text,boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_language(text,text,boolean,integer) TO authenticated;

CREATE FUNCTION public.get_language_configuration() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('languages',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY sort_order,language_code),'[]') FROM public.event_languages l WHERE enabled),
 'default_language',e.default_language,'fallback_language',e.fallback_language,
 'translations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.event_content c JOIN public.event_languages l USING(language_code) WHERE l.enabled AND c.content_key LIKE 'ui:%'))
 FROM public.event_settings e WHERE e.id=1
$$;
REVOKE ALL ON FUNCTION public.get_language_configuration() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_language_configuration() TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_public_event_v2() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('event',to_jsonb(e),
 'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order),'[]') FROM public.event_sessions s WHERE s.is_active),
 'locations',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order),'[]') FROM public.event_locations l WHERE l.archived_at IS NULL),
 'content',(SELECT coalesce(jsonb_object_agg(c.language_code,c.content_value),'{}') FROM public.event_content c WHERE c.content_key='welcome'),
 'translations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.event_content c WHERE c.content_key NOT LIKE 'ui:%'))
 FROM public.event_settings e WHERE e.id=1 AND e.is_published
$$;
REVOKE ALL ON FUNCTION public.get_public_event_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_event_v2() TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_guest(
  p_guest_id uuid,
  p_first_name text,
  p_last_name text,
  p_courtesy_title text,
  p_relation text,
  p_language text,
  p_is_child boolean,
  p_dietary_requirements text,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_first text := NULLIF(pg_catalog.btrim(p_first_name), '');
  v_last text := NULLIF(pg_catalog.btrim(p_last_name), '');
  v_title text := NULLIF(pg_catalog.btrim(p_courtesy_title), '');
  v_relation text := NULLIF(pg_catalog.btrim(p_relation), '');
  v_dietary text := NULLIF(pg_catalog.btrim(p_dietary_requirements), '');
  v_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_guest_id IS NULL OR v_first IS NULL OR pg_catalog.char_length(v_first)>120 THEN
    RAISE EXCEPTION 'A first name of at most 120 characters is required';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_last,''))>120 OR
     pg_catalog.char_length(COALESCE(v_relation,''))>160 OR
     pg_catalog.char_length(COALESCE(v_dietary,''))>1000 OR
     pg_catalog.char_length(COALESCE(v_notes,''))>2000 THEN
    RAISE EXCEPTION 'Guest field exceeds maximum length';
  END IF;
  IF v_title IS NOT NULL AND v_title NOT IN ('Mr.','Ms.','Son','Daughter') THEN
    RAISE EXCEPTION 'Invalid courtesy title';
  END IF;
  IF p_language IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language) THEN
    RAISE EXCEPTION 'Invalid guest language';
  END IF;
  IF p_is_child IS NULL THEN
    RAISE EXCEPTION 'Guest child flag is required';
  END IF;

  UPDATE public.guests
  SET first_name=v_first, last_name=v_last,
      courtesy_title=v_title, relation=v_relation,
      language=p_language, is_child=p_is_child,
      dietary_requirements=v_dietary, notes=v_notes,
      updated_at=pg_catalog.now()
  WHERE id=p_guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest not found';
  END IF;
END
$function$;

CREATE FUNCTION public.admin_set_language_preferences(p_default text,p_fallback text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 UPDATE public.event_settings SET default_language=p_default,fallback_language=p_fallback,updated_at=now() WHERE id=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event settings not found';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_language_preferences(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_language_preferences(text,text) TO authenticated;
CREATE FUNCTION public.admin_save_translation(p_key text,p_language text,p_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source_tokens text[];value_tokens text[];parts text[];target uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_key IS NULL OR length(p_key)>800 OR p_key !~ '^(welcome|ui:.+|venue:[0-9a-f-]{36}:welcome|food:[0-9a-f-]{36}:(name|description)|session:[0-9a-f-]{36}:name)$' OR p_value IS NULL OR length(p_value)>12000 THEN RAISE EXCEPTION 'Invalid translation key or text';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language AND enabled) THEN RAISE EXCEPTION 'Choose an enabled language';END IF;
 IF p_key LIKE 'ui:%' THEN
  SELECT array_agg(m[1] ORDER BY m[1]) INTO source_tokens FROM regexp_matches(substr(p_key,4),'\{([A-Za-z][A-Za-z0-9_]*)\}','g') m;
  SELECT array_agg(m[1] ORDER BY m[1]) INTO value_tokens FROM regexp_matches(p_value,'\{([A-Za-z][A-Za-z0-9_]*)\}','g') m;
  IF btrim(p_value)<>'' AND source_tokens IS DISTINCT FROM value_tokens THEN RAISE EXCEPTION 'Keep the same placeholders as the original phrase';END IF;
 END IF;
 parts:=string_to_array(p_key,':');
 IF parts[1] IN ('venue','food','session') THEN
  target:=parts[2]::uuid;
  IF parts[1]='venue' AND NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=target) OR parts[1]='food' AND NOT EXISTS(SELECT 1 FROM public.food_items WHERE id=target) OR parts[1]='session' AND NOT EXISTS(SELECT 1 FROM public.event_sessions WHERE id=target) THEN RAISE EXCEPTION 'Translation target not found';END IF;
 END IF;
 IF parts[1] IN ('venue','food') AND p_language IN ('fo','en','de') THEN
  target:=parts[2]::uuid;
  IF parts[1]='venue' THEN
   EXECUTE format('UPDATE public.event_locations SET %I=$1 WHERE id=$2','welcome_'||p_language) USING nullif(btrim(p_value),''),target;
  ELSE
   IF parts[3]='name' AND p_language='fo' AND btrim(p_value)='' THEN RAISE EXCEPTION 'Faroese name is required';END IF;
   EXECUTE format('UPDATE public.food_items SET %I=$1 WHERE id=$2',parts[3]||'_'||p_language) USING nullif(btrim(p_value),''),target;
  END IF;
  DELETE FROM public.event_content WHERE content_key=p_key AND language_code=p_language;RETURN;
 END IF;
 IF btrim(p_value)='' THEN DELETE FROM public.event_content WHERE content_key=p_key AND language_code=p_language;
 ELSE INSERT INTO public.event_content(content_key,language_code,content_value) VALUES(p_key,p_language,p_value) ON CONFLICT(content_key,language_code) DO UPDATE SET content_value=excluded.content_value;END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_translation(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_translation(text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
