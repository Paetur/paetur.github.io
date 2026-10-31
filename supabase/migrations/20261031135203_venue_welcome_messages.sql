BEGIN;
ALTER TABLE public.event_locations ADD COLUMN welcome_fo text CHECK(length(welcome_fo)<=4000);
ALTER TABLE public.event_locations ADD COLUMN welcome_en text CHECK(length(welcome_en)<=4000);
ALTER TABLE public.event_locations ADD COLUMN welcome_de text CHECK(length(welcome_de)<=4000);
-- Preserve existing messages while making them independently editable per venue.
UPDATE public.event_locations SET welcome_fo=(SELECT content_value FROM public.event_content WHERE content_key='welcome' AND language_code='fo'),welcome_en=(SELECT content_value FROM public.event_content WHERE content_key='welcome' AND language_code='en'),welcome_de=(SELECT content_value FROM public.event_content WHERE content_key='welcome' AND language_code='de');
CREATE OR REPLACE FUNCTION public.admin_save_venue(p_id uuid,p_values jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;v_archived boolean:=coalesce((p_values->>'archived')::boolean,false);
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR length(coalesce(p_values->>'address',''))>1000 OR length(coalesce(p_values->>'notes',''))>2000 OR length(coalesce(p_values->>'map_url',''))>2000 THEN RAISE EXCEPTION 'Enter valid venue details';END IF;
 IF length(coalesce(p_values->>'welcome_fo',''))>4000 OR length(coalesce(p_values->>'welcome_en',''))>4000 OR length(coalesce(p_values->>'welcome_de',''))>4000 THEN RAISE EXCEPTION 'Welcome message too long (maximum 4000 characters per language)';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_values->>'timezone') THEN RAISE EXCEPTION 'Invalid venue timezone';END IF;
 IF nullif(p_values->>'map_url','') IS NOT NULL AND p_values->>'map_url' !~ '^https://[^ /]+' THEN RAISE EXCEPTION 'Map link must use HTTPS';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF v_id IS NOT NULL THEN
 PERFORM 1 FROM public.event_locations WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Venue not found';END IF;
 IF v_archived AND EXISTS(SELECT 1 FROM public.event_sessions WHERE location_id=v_id AND is_active) THEN RAISE EXCEPTION 'Move or deactivate linked sessions before archiving this venue';END IF;
 ELSE INSERT INTO public.event_locations(name) VALUES(btrim(p_values->>'name')) RETURNING id INTO v_id;END IF;
 UPDATE public.event_locations SET name=btrim(p_values->>'name'),address=nullif(btrim(p_values->>'address'),''),map_url=nullif(btrim(p_values->>'map_url'),''),notes=nullif(btrim(p_values->>'notes'),''),timezone=p_values->>'timezone',welcome_fo=CASE WHEN p_values ? 'welcome_fo' THEN nullif(btrim(p_values->>'welcome_fo'),'') ELSE welcome_fo END,welcome_en=CASE WHEN p_values ? 'welcome_en' THEN nullif(btrim(p_values->>'welcome_en'),'') ELSE welcome_en END,welcome_de=CASE WHEN p_values ? 'welcome_de' THEN nullif(btrim(p_values->>'welcome_de'),'') ELSE welcome_de END,country_code=nullif(upper(btrim(p_values->>'country_code')),''),archived_at=CASE WHEN v_archived THEN coalesce(archived_at,now()) ELSE NULL END WHERE id=v_id;
 RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_save_venue(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_venue(uuid,jsonb),public.admin_save_household(uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
