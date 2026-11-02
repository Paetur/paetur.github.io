-- Add private administrator comments and omit fully claimed options from other households.
BEGIN;
ALTER TABLE public.food_items ADD COLUMN admin_comment text CHECK (length(admin_comment)<=4000);
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
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;
CREATE FUNCTION app_private.guard_food_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.quantity_needed<(SELECT coalesce(sum(quantity),0) FROM public.food_claims WHERE food_item_id=NEW.id) THEN RAISE EXCEPTION 'Amount cannot be less than existing claims';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_food_capacity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER food_capacity_guard BEFORE UPDATE OF quantity_needed ON public.food_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_food_capacity();
NOTIFY pgrst,'reload schema';
COMMIT;
