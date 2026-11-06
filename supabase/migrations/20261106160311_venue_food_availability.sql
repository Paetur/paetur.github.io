BEGIN;

CREATE OR REPLACE FUNCTION public.admin_edit_venue_food(p_venue_id uuid,p_add uuid[],p_remove uuid[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item_id uuid;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_add IS NULL OR p_remove IS NULL OR cardinality(p_add)+cardinality(p_remove)>2000
    OR array_position(p_add,NULL) IS NOT NULL OR array_position(p_remove,NULL) IS NOT NULL
    OR p_add && p_remove THEN RAISE EXCEPTION 'Invalid venue food selections'; END IF;
 PERFORM 1 FROM public.event_locations WHERE id=p_venue_id AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active venue required'; END IF;
 FOR item_id IN SELECT DISTINCT id FROM unnest(p_add||p_remove) AS selected(id) ORDER BY id LOOP
  IF item_id=ANY(p_add) THEN
   UPDATE public.food_items
   SET venue_ids=CASE WHEN p_venue_id=ANY(venue_ids) THEN venue_ids ELSE array_append(coalesce(venue_ids,ARRAY[]::uuid[]),p_venue_id) END
   WHERE id=item_id AND active;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active food item required'; END IF;
  ELSE
   UPDATE public.food_items SET venue_ids=array_remove(
     coalesce(venue_ids,ARRAY(SELECT id FROM public.event_locations WHERE archived_at IS NULL ORDER BY id)),p_venue_id)
   WHERE id=item_id AND (p_venue_id=ANY(venue_ids) OR (venue_ids IS NULL AND active));
  END IF;
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_edit_venue_food(uuid,uuid[],uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_venue_food(uuid,uuid[],uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
