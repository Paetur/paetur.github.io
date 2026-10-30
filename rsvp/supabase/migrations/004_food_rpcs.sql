-- RSVP Manager 004: protected food RPCs and validation queries.
BEGIN;
CREATE FUNCTION public.get_household_food(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid;v_result jsonb;
BEGIN
 SELECT id INTO v_household FROM public.households WHERE invite_code=p_code;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
 'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,'quantity_needed',f.quantity_needed,
 'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0)) ORDER BY f.sort_order)
 FROM public.food_items f WHERE f.active),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes)) FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;
CREATE FUNCTION public.set_household_food_claim(p_code text,p_food_item_id uuid,p_quantity integer,p_notes text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household public.households%ROWTYPE;v_needed integer;v_active boolean;v_total integer;v_old integer;
BEGIN
 IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 SELECT * INTO v_household FROM public.households WHERE invite_code=p_code FOR UPDATE;
 IF NOT FOUND OR NOT v_household.food OR v_household.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 SELECT quantity_needed,active INTO v_needed,v_active FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND OR NOT v_active THEN RAISE EXCEPTION 'Food item unavailable'; END IF;
 SELECT coalesce(sum(quantity),0) INTO v_total FROM public.food_claims WHERE food_item_id=p_food_item_id;
 SELECT coalesce(quantity,0) INTO v_old FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 IF v_total-coalesce(v_old,0)+p_quantity>v_needed THEN RAISE EXCEPTION 'Insufficient remaining quantity'; END IF;
 IF p_quantity=0 THEN DELETE FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 ELSE INSERT INTO public.food_claims(household_id,food_item_id,quantity,notes) VALUES(v_household.id,p_food_item_id,p_quantity,p_notes)
 ON CONFLICT(food_item_id,household_id) DO UPDATE SET quantity=excluded.quantity,notes=excluded.notes;
 END IF;
END $$;
CREATE FUNCTION public.confirm_household_food(p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
 SELECT id INTO v_id FROM public.households WHERE invite_code=p_code AND food=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid food invitation'; END IF;
 UPDATE public.households SET food_confirmed=true,food_confirmed_at=coalesce(food_confirmed_at,now()) WHERE id=v_id AND NOT food_confirmed;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_household_food(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_household_food(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_household_food(text) TO anon,authenticated;
COMMIT;

