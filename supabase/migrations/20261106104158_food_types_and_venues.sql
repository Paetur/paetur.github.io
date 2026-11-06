BEGIN;

CREATE TABLE public.food_item_types (
 name text PRIMARY KEY CHECK (name=btrim(name) AND length(name) BETWEEN 1 AND 60)
);
ALTER TABLE public.food_item_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_item_types FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.food_item_types TO authenticated;
CREATE POLICY admin_read ON public.food_item_types FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY admin_add ON public.food_item_types FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

ALTER TABLE public.food_items ADD COLUMN quantity_type text NOT NULL DEFAULT 'Piece(s)'
 CHECK (quantity_type=btrim(quantity_type) AND length(quantity_type) BETWEEN 1 AND 60),
 ADD COLUMN venue_ids uuid[];

CREATE FUNCTION app_private.food_venue_eligible(p_household uuid,p_venues uuid[])
 RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_venues IS NULL OR EXISTS (
  SELECT 1 FROM public.effective_session_invitations i
  JOIN public.event_sessions s ON s.id=i.session_id
  JOIN public.event_locations v ON v.id=s.location_id AND v.archived_at IS NULL
  WHERE i.household_id=p_household AND s.location_id=ANY(p_venues)
 )
$$;
REVOKE ALL ON FUNCTION app_private.food_venue_eligible(uuid,uuid[]) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.validate_food_item_settings() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.quantity_type NOT IN ('Batch(s)','Piece(s)','Tray(s)','Packet(s)','Kg','Grams')
 AND NOT EXISTS(SELECT 1 FROM public.food_item_types WHERE name=NEW.quantity_type) THEN
  RAISE EXCEPTION 'Unknown food item type';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.venue_ids) AS selected(id)
   WHERE NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=selected.id)) THEN
  RAISE EXCEPTION 'Unknown food venue';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.validate_food_item_settings() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_food_item_settings BEFORE INSERT OR UPDATE OF quantity_type,venue_ids ON public.food_items
 FOR EACH ROW EXECUTE FUNCTION app_private.validate_food_item_settings();

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
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_text',f.recipe_text,'quantity_type',f.quantity_type,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND app_private.food_venue_eligible(v_household,f.venue_ids) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;

CREATE OR REPLACE FUNCTION app_private.save_food_selection(
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
 IF p_quantity>old_quantity AND NOT app_private.food_venue_eligible(p_household_id,item.venue_ids) THEN
   RAISE EXCEPTION 'Food item unavailable at this household’s venues' USING ERRCODE='42501';
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

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_item_types','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;


CREATE FUNCTION public.admin_save_food_translations(p_food_item_id uuid,p_changes jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_type text; v_type_key text; change jsonb; v_key text;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid food translations'; END IF;
 IF jsonb_array_length(p_changes)>300 THEN RAISE EXCEPTION 'Too many translations in one save'; END IF;
 SELECT quantity_type INTO v_type FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
 v_type_key:=CASE WHEN v_type IN ('Batch(s)','Piece(s)','Tray(s)','Packet(s)','Kg','Grams')
  THEN 'ui:'||v_type ELSE 'ui:Food type: '||v_type END;
 FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  v_key:=change->>'key';
  IF v_key IS NULL OR v_key NOT IN (v_type_key,'food:'||p_food_item_id||':name','food:'||p_food_item_id||':description')
    THEN RAISE EXCEPTION 'Invalid food translation key'; END IF;
  PERFORM public.admin_save_translation(v_key,change->>'language',change->>'value');
  IF v_key='food:'||p_food_item_id||':description' AND change->>'language'='en' AND btrim(change->>'value')='' THEN
   UPDATE public.food_items SET description_en='' WHERE id=p_food_item_id;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_food_translations(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_food_translations(uuid,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
