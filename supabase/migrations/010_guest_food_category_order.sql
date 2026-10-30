-- RSVP Manager 010: order guest food by admin category and item sort order.
-- Safe on populated projects: no guest, food, or claim data is rewritten.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE f.active),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO anon,authenticated;
COMMIT;