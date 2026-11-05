BEGIN;

-- Preserve legacy recipe links while letting food items move independently.
ALTER TABLE public.food_items
  ADD COLUMN recipe_text text CHECK (length(recipe_text) <= 12000),
  ADD COLUMN reserved_household_id uuid REFERENCES public.households(id) ON DELETE SET NULL,
  DROP CONSTRAINT food_recipe_category,
  DROP CONSTRAINT recipe_requires_category,
  ADD CONSTRAINT food_recipe_link FOREIGN KEY (recipe_id) REFERENCES public.food_recipes(id);

CREATE INDEX food_items_reserved_household ON public.food_items(reserved_household_id) WHERE reserved_household_id IS NOT NULL;

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
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_id',f.recipe_id,'recipe_name',fr.name,'recipe_text',f.recipe_text,
   'reserved_for_you',coalesce(f.reserved_household_id=v_household,false),
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_recipes fr ON fr.id=f.recipe_id LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND (f.reserved_household_id IS NULL OR f.reserved_household_id=v_household) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_household_food_claim(p_code text, p_food_item_id uuid, p_quantity integer, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_household public.households%ROWTYPE;v_needed integer;v_active boolean;v_total integer;v_old integer;v_reserved_household uuid;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF;
 IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 SELECT * INTO v_household FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT v_household.food OR v_household.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 SELECT quantity_needed,active,reserved_household_id INTO v_needed,v_active,v_reserved_household FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND OR NOT v_active THEN RAISE EXCEPTION 'Food item unavailable'; END IF;
 SELECT coalesce(sum(quantity),0) INTO v_total FROM public.food_claims WHERE food_item_id=p_food_item_id;
 SELECT coalesce(quantity,0) INTO v_old FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 IF v_reserved_household IS NOT NULL AND v_reserved_household<>v_household.id AND p_quantity>coalesce(v_old,0) THEN
   RAISE EXCEPTION 'Food item unavailable' USING ERRCODE='42501';
 END IF;
 IF v_total-coalesce(v_old,0)+p_quantity>v_needed THEN RAISE EXCEPTION 'Insufficient remaining quantity'; END IF;
 IF p_quantity=0 THEN DELETE FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 ELSE INSERT INTO public.food_claims(household_id,food_item_id,quantity,notes) VALUES(v_household.id,p_food_item_id,p_quantity,p_notes)
 ON CONFLICT(food_item_id,household_id) DO UPDATE SET quantity=excluded.quantity,notes=excluded.notes;
 END IF;
END $function$;

NOTIFY pgrst,'reload schema';
COMMIT;
