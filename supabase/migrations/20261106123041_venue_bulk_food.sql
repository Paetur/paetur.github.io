BEGIN;

CREATE FUNCTION public.admin_add_venue_food(p_venue_id uuid,p_food_item_ids uuid[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item_id uuid;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_food_item_ids),0) NOT BETWEEN 1 AND 2000 OR array_position(p_food_item_ids,NULL) IS NOT NULL
 THEN RAISE EXCEPTION 'Select food items'; END IF;
 PERFORM 1 FROM public.event_locations WHERE id=p_venue_id AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active venue required'; END IF;
 FOR item_id IN SELECT DISTINCT id FROM unnest(p_food_item_ids) AS selected(id) ORDER BY id LOOP
  UPDATE public.food_items
  SET venue_ids=CASE WHEN p_venue_id=ANY(venue_ids) THEN venue_ids ELSE array_append(coalesce(venue_ids,ARRAY[]::uuid[]),p_venue_id) END
  WHERE id=item_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active food item required'; END IF;
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_add_venue_food(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_venue_food(uuid,uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
