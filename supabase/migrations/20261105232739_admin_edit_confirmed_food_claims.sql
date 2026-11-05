BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_food_selection(p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_expected_quantity integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_expected_quantity IS NULL OR p_expected_quantity<0 THEN RAISE EXCEPTION 'Expected quantity required'; END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR (h.food_confirmed AND p_expected_quantity=0) THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 PERFORM app_private.save_food_selection(h.id,p_food_item_id,p_quantity,NULL,p_expected_quantity);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
