BEGIN;

LOCK TABLE public.legacy_stuff_to_bring, public.other_items, public.food_recipes, public.food_items IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.food_recipes) THEN
  RAISE EXCEPTION 'Legacy recipe groups still contain data';
 END IF;
 IF EXISTS (
  SELECT 1 FROM public.legacy_stuff_to_bring a
  LEFT JOIN public.stuff_to_bring b USING (id)
  WHERE b.id IS NULL
     OR ROW(a.item,a.quantity,a.assigned_to,a.status,a.sort_order,a.created_at)
        IS DISTINCT FROM ROW(b.item,b.quantity,b.assigned_to,b.status,b.sort_order,b.created_at)
     OR (a.notes IS DISTINCT FROM b.notes AND a.notes IS DISTINCT FROM 'Imported from Food.csv')
 ) THEN
  RAISE EXCEPTION 'Legacy bring-list archive contains records or notes missing from Other';
 END IF;
END $$;

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
   'reserved_for_you',coalesce(f.reserved_household_id=v_household,false),
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND (f.reserved_household_id IS NULL OR f.reserved_household_id=v_household) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;

DROP FUNCTION public.admin_save_recipe(uuid,text,text,uuid[],jsonb,timestamptz);
ALTER TABLE public.food_items DROP COLUMN recipe_id;
DROP TABLE public.food_recipes;
DROP TABLE public.legacy_stuff_to_bring;

NOTIFY pgrst,'reload schema';
COMMIT;
