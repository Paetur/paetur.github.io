-- Additional public event read API for the standalone RSVP Manager.
-- Public content is shown only when the event is published.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_public_event_v2()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object(
  'event', to_jsonb(e),
  'sessions', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order), '[]'::jsonb)
               FROM public.event_sessions s WHERE s.is_active),
  'locations', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order), '[]'::jsonb)
               FROM public.event_locations l),
  'content', (SELECT coalesce(jsonb_object_agg(c.language_code,c.content_value), '{}'::jsonb)
              FROM public.event_content c WHERE c.content_key='welcome')
 ) FROM public.event_settings e WHERE e.id=1 AND e.is_published;
$$;
REVOKE ALL ON FUNCTION public.get_public_event_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_event_v2() TO anon,authenticated;

-- Prevent food list discovery through a valid invitation code that lacks food access.
-- Food editing is still controlled separately by set_household_food_claim.
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid;v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
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
-- Reassert exact public grants after replace.
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO anon,authenticated;
COMMIT;
