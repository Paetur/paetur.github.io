-- Recipes group existing or newly created food items; claims stay on the original item IDs.
BEGIN;
CREATE TABLE public.food_recipes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 300),
 category text NOT NULL REFERENCES public.food_categories(name) ON UPDATE CASCADE,
 sort_order integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(id,category)
);
CREATE INDEX food_recipes_category ON public.food_recipes(category);
ALTER TABLE public.food_recipes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_recipes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.food_recipes TO authenticated;
CREATE POLICY admin_read ON public.food_recipes FOR SELECT TO authenticated USING((SELECT public.is_admin()));
ALTER TABLE public.food_items ADD COLUMN recipe_id uuid;
ALTER TABLE public.food_items ADD CONSTRAINT food_recipe_category FOREIGN KEY(recipe_id,category) REFERENCES public.food_recipes(id,category) ON UPDATE CASCADE;
ALTER TABLE public.food_items ADD CONSTRAINT recipe_requires_category CHECK(recipe_id IS NULL OR category IS NOT NULL);
CREATE INDEX food_items_recipe ON public.food_items(recipe_id,category);
CREATE FUNCTION public.admin_save_recipe(p_id uuid,p_name text,p_category text,p_items uuid[],p_new_items jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;old public.food_recipes%ROWTYPE;r jsonb;n integer;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>300 OR p_items IS NULL OR cardinality(p_items)>500 OR jsonb_typeof(p_new_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_new_items)>100 OR cardinality(p_items)+jsonb_array_length(p_new_items)=0 THEN RAISE EXCEPTION 'Enter a recipe name and at least one food item';END IF;
 IF (SELECT count(*) FROM unnest(p_items) id)<>(SELECT count(DISTINCT id) FROM unnest(p_items) id) THEN RAISE EXCEPTION 'Duplicate food items';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.food_categories WHERE name=p_category) THEN RAISE EXCEPTION 'Choose a food category';END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO old FROM public.food_recipes WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR old.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Recipe changed; reload before saving';END IF;
 END IF;
 PERFORM 1 FROM public.food_items WHERE recipe_id=p_id OR id=ANY(p_items) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.food_items WHERE id=ANY(p_items))<>cardinality(p_items) THEN RAISE EXCEPTION 'Food item not found';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items WHERE id=ANY(p_items) AND recipe_id IS NOT NULL AND recipe_id IS DISTINCT FROM p_id) THEN RAISE EXCEPTION 'Food item already belongs to another recipe';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_new_items) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR nullif(btrim(r->>'name'),'') IS NULL OR length(r->>'name')>300 OR (r->>'quantity') IS NULL OR (r->>'quantity')::integer<0 OR length(coalesce(r->>'user_comment',''))>4000 OR length(coalesce(r->>'admin_comment',''))>4000 THEN RAISE EXCEPTION 'Enter a valid new food item';END IF;
 END LOOP;
 IF p_id IS NULL THEN INSERT INTO public.food_recipes(name,category,sort_order) VALUES(btrim(p_name),p_category,(SELECT coalesce(max(sort_order),0)+1 FROM public.food_recipes WHERE category=p_category)) RETURNING id INTO v_id;
 ELSE UPDATE public.food_recipes SET name=btrim(p_name),category=p_category,updated_at=clock_timestamp() WHERE id=p_id;END IF;
 UPDATE public.food_items SET recipe_id=NULL WHERE recipe_id=v_id AND NOT(id=ANY(p_items));
 UPDATE public.food_items SET recipe_id=v_id,category=p_category WHERE id=ANY(p_items);
 SELECT coalesce(max(sort_order),0) INTO n FROM public.food_items WHERE category=p_category;
 FOR r IN SELECT value FROM jsonb_array_elements(p_new_items) LOOP
  n:=n+1;
  INSERT INTO public.food_items(category,recipe_id,name_fo,name_en,quantity_needed,description_en,admin_comment,sort_order) VALUES(p_category,v_id,btrim(r->>'name'),btrim(r->>'name'),(r->>'quantity')::integer,nullif(btrim(r->>'user_comment'),''),nullif(btrim(r->>'admin_comment'),''),n);
 END LOOP;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_recipe(uuid,text,text,uuid[],jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_recipe(uuid,text,text,uuid[],jsonb,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_recipes','public.food_items',
 'public.food_claims','public.stuff_to_bring','public.things_to_do','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.archived_at IS NULL AND h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_id',f.recipe_id,'recipe_name',fr.name,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_recipes fr ON fr.id=f.recipe_id LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
