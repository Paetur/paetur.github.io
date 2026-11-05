BEGIN;

LOCK TABLE public.households, public.food_items, public.food_claims IN SHARE ROW EXCLUSIVE MODE;

-- A reservation has no stored quantity. Convert it to one unit unless a claim already exists.
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM public.food_items f JOIN public.households h ON h.id=f.reserved_household_id
   WHERE NOT EXISTS (SELECT 1 FROM public.food_claims c WHERE c.food_item_id=f.id AND c.household_id=h.id)
     AND (NOT f.active OR NOT h.food OR h.archived_at IS NOT NULL OR h.food_confirmed
       OR f.quantity_needed<=coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
 ) THEN RAISE EXCEPTION 'Resolve legacy reservations without an eligible household or remaining capacity'; END IF;
END $$;

INSERT INTO public.food_claims(food_item_id,household_id,quantity)
 SELECT id,reserved_household_id,1 FROM public.food_items WHERE reserved_household_id IS NOT NULL
 ON CONFLICT (food_item_id,household_id) DO NOTHING;

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
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_text',f.recipe_text,
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

CREATE FUNCTION app_private.save_food_selection(
 p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_notes text,p_expected_quantity integer
) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item public.food_items%ROWTYPE; old_quantity integer; claimed_total bigint;
BEGIN
 IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 SELECT * INTO item FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND OR NOT item.active THEN RAISE EXCEPTION 'Food item unavailable'; END IF;
 SELECT coalesce(sum(quantity),0),coalesce(max(quantity) FILTER (WHERE household_id=p_household_id),0)
 INTO claimed_total,old_quantity FROM public.food_claims WHERE food_item_id=p_food_item_id;
 IF p_expected_quantity IS NOT NULL AND old_quantity<>p_expected_quantity THEN
   RAISE EXCEPTION 'Food selection changed; refresh and try again';
 END IF;
 IF claimed_total-old_quantity+p_quantity>item.quantity_needed THEN RAISE EXCEPTION 'Insufficient remaining quantity'; END IF;
 IF p_quantity=0 THEN
  DELETE FROM public.food_claims WHERE household_id=p_household_id AND food_item_id=p_food_item_id;
 ELSE
  INSERT INTO public.food_claims AS existing(food_item_id,household_id,quantity,notes)
   VALUES(p_food_item_id,p_household_id,p_quantity,p_notes)
   ON CONFLICT (food_item_id,household_id) DO UPDATE SET quantity=excluded.quantity,
    notes=CASE WHEN p_expected_quantity IS NULL THEN excluded.notes ELSE existing.notes END;
 END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.save_food_selection(uuid,uuid,integer,text,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.set_household_food_claim(p_code text,p_food_item_id uuid,p_quantity integer,p_notes text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR h.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 PERFORM app_private.save_food_selection(h.id,p_food_item_id,p_quantity,p_notes,NULL);
END $$;

CREATE FUNCTION public.admin_set_food_selection(p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_expected_quantity integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_expected_quantity IS NULL OR p_expected_quantity<0 THEN RAISE EXCEPTION 'Expected quantity required'; END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR h.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 PERFORM app_private.save_food_selection(h.id,p_food_item_id,p_quantity,NULL,p_expected_quantity);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_food_selection(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_food_selection(uuid,uuid,integer,integer) TO authenticated;

ALTER TABLE public.food_items DROP COLUMN reserved_household_id;
NOTIFY pgrst,'reload schema';
COMMIT;
