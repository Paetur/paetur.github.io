BEGIN;
-- Apply after the canonical-field frontend has deployed. Fail rather than discard divergent text.
LOCK TABLE public.food_items,public.event_locations,public.food_item_translations,public.venue_translations IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM public.food_items f
  CROSS JOIN LATERAL(VALUES('fo',f.name_fo,f.description_fo),('de',f.name_de,f.description_de)) old(language,name,comment)
  LEFT JOIN public.food_item_translations t ON t.food_item_id=f.id AND t.language_code=old.language
  WHERE nullif(btrim(old.name),'') IS DISTINCT FROM t.name OR nullif(btrim(old.comment),'') IS DISTINCT FROM t.user_comment
 ) OR EXISTS (
  SELECT 1 FROM public.event_locations v
  CROSS JOIN LATERAL(VALUES('fo',v.welcome_fo),('de',v.welcome_de)) old(language,message)
  LEFT JOIN public.venue_translations t ON t.venue_id=v.id AND t.language_code=old.language
  WHERE nullif(btrim(old.message),'') IS DISTINCT FROM t.welcome_message
 ) THEN RAISE EXCEPTION 'Legacy translations differ from normalized storage; reconcile before dropping columns'; END IF;
END $$;
-- Preserve the existing label for historical records whose English source was missing.
UPDATE public.food_items SET name_en=coalesce(nullif(btrim(name_fo),''),nullif(btrim(name_de),'')) WHERE nullif(btrim(name_en),'') IS NULL;
ALTER TABLE public.food_items ALTER COLUMN name_en SET NOT NULL;
ALTER TABLE public.food_items ADD CONSTRAINT food_items_source_name_nonempty CHECK(btrim(name_en)<>'');

CREATE OR REPLACE FUNCTION public.admin_save_venue(p_id uuid, p_values jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 UPDATE public.event_locations SET name=btrim(p_values->>'name'),address=nullif(btrim(p_values->>'address'),''),map_url=nullif(btrim(p_values->>'map_url'),''),notes=nullif(btrim(p_values->>'notes'),''),timezone=p_values->>'timezone',welcome_en=CASE WHEN p_values ? 'welcome_en' THEN nullif(btrim(p_values->>'welcome_en'),'') ELSE welcome_en END,country_code=nullif(upper(btrim(p_values->>'country_code')),''),archived_at=CASE WHEN v_archived THEN coalesce(archived_at,now()) ELSE NULL END WHERE id=v_id;
 IF p_values ? 'welcome_fo' THEN
  PERFORM app_private.store_translation('venue:'||v_id||':welcome','fo',coalesce(p_values->>'welcome_fo',''));
 END IF;
 IF p_values ? 'welcome_de' THEN
  PERFORM app_private.store_translation('venue:'||v_id||':welcome','de',coalesce(p_values->>'welcome_de',''));
 END IF;
 RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_move_food_item(p_food_item_id uuid, p_direction integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_category text;v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
 SELECT category INTO v_category FROM public.food_items WHERE id=p_food_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
 SELECT array_agg(id ORDER BY sort_order,lower(name_en),id) INTO v_order FROM public.food_items
 WHERE category IS NOT DISTINCT FROM v_category;
 v_position:=array_position(v_order,p_food_item_id);v_target:=v_position+p_direction;
 IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
 v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
 UPDATE public.food_items f SET sort_order=ordered.ordinality::integer,updated_at=now()
 FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE f.id=ordered.id;
END $function$;

-- Compatibility JSON fields come from normalized rows; no duplicate columns remain.
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.archived_at IS NULL AND h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_text',f.recipe_text,'quantity_type',f.quantity_type,
   'name_fo',translation_fo.name,'name_en',f.name_en,'name_de',translation_de.name,
   'description_fo',translation_fo.user_comment,'description_en',f.description_en,'description_de',translation_de.user_comment,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_en),f.id)
   FROM public.food_items f
   LEFT JOIN public.food_item_translations translation_fo ON translation_fo.food_item_id=f.id AND translation_fo.language_code='fo'
   LEFT JOIN public.food_item_translations translation_de ON translation_de.food_item_id=f.id AND translation_de.language_code='de'
   LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND app_private.food_venue_eligible(v_household,f.venue_ids) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_save_translation(p_key text, p_language text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language AND enabled) THEN RAISE EXCEPTION 'Choose an enabled language'; END IF;
 PERFORM app_private.store_translation(p_key,p_language,p_value);
END $function$;

DROP TRIGGER sync_food_translations ON public.food_items;
DROP TRIGGER sync_venue_translations ON public.event_locations;
DROP FUNCTION app_private.sync_legacy_translation_columns();
ALTER TABLE public.food_items DROP COLUMN name_fo,DROP COLUMN name_de,DROP COLUMN description_fo,DROP COLUMN description_de;
ALTER TABLE public.event_locations DROP COLUMN welcome_fo,DROP COLUMN welcome_de;
NOTIFY pgrst,'reload schema';
COMMIT;
