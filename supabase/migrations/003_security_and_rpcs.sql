-- RSVP Manager 003: SECURITY AND CORE RPCs. Fresh destination only.
-- Review all function bodies and run 004 tests before exposing a public website.
BEGIN;
-- Explicit permissions: no direct anon table access; admins receive only selected tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY[
 'admins','households','guests','relation_groups','food_categories','food_items','food_claims','stuff_to_bring','things_to_do',
 'event_languages','event_settings','event_content','event_locations','event_sessions','household_contacts',
 'household_session_defaults','guest_session_overrides','rsvp_submissions','guest_session_responses',
 'rsvp_household_audit','rsvp_response_audit','message_templates','invitation_send_queue','invitation_deliveries','invitation_delivery_audit'
 ] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
-- Read access for administrators. Write permissions only for configuration tables;
-- all RSVP state/history and delivery history must be written via trusted RPCs.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY[
 'households','guests','relation_groups','food_categories','food_items','food_claims','stuff_to_bring','things_to_do',
 'event_languages','event_settings','event_content','event_locations','event_sessions','household_contacts',
 'household_session_defaults','guest_session_overrides','rsvp_submissions','guest_session_responses',
 'rsvp_household_audit','rsvp_response_audit','message_templates','invitation_send_queue','invitation_deliveries','invitation_delivery_audit'
 ] LOOP
  EXECUTE format('CREATE POLICY admin_read ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_admin()))',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
-- The admins table has deliberately no RLS policy; is_admin() is a tightly scoped definer.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['relation_groups','food_categories','food_items','stuff_to_bring','things_to_do',
 'event_languages','event_settings','event_content','event_locations','event_sessions','household_contacts',
 'household_session_defaults','guest_session_overrides','message_templates','invitation_send_queue'] LOOP
  EXECUTE format('CREATE POLICY admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()))',t);
  EXECUTE format('CREATE POLICY admin_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()))',t);
  EXECUTE format('GRANT INSERT,UPDATE ON public.%I TO authenticated',t);
 END LOOP;
END $$;
-- Household and guest edits, food claims, all RSVP history, delivery confirmation:
-- no direct API UPDATE/INSERT/DELETE; use reviewed RPCs (or trusted migration role).
-- Identity/serial audit sequences are not granted to authenticated clients.

-- Prevent household hierarchy cycles, serializing parent changes across concurrent transactions.
CREATE FUNCTION public.guard_household_parent() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE found_cycle boolean;
BEGIN
 IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 WITH RECURSIVE ancestry(id,parent_id,path) AS (
  SELECT h.id,h.parent_id,ARRAY[h.id] FROM public.households h WHERE h.id=NEW.parent_id
  UNION ALL
  SELECT p.id,p.parent_id,a.path||p.id FROM public.households p JOIN ancestry a ON p.id=a.parent_id
  WHERE NOT p.id=ANY(a.path)
 ) SELECT EXISTS(SELECT 1 FROM ancestry WHERE id=NEW.id OR parent_id=NEW.id) INTO found_cycle;
 IF NEW.parent_id=NEW.id OR found_cycle THEN RAISE EXCEPTION 'Household hierarchy cycle'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER household_parent_guard BEFORE INSERT OR UPDATE OF parent_id ON public.households
 FOR EACH ROW EXECUTE FUNCTION public.guard_household_parent();

-- Append-only history: even privileged application RPCs cannot rewrite/delete audit rows.
CREATE FUNCTION public.prevent_history_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Historical records are immutable'; END $$;
CREATE TRIGGER immutable_rsvp_submissions BEFORE UPDATE OR DELETE ON public.rsvp_submissions FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_rsvp_household_audit BEFORE UPDATE OR DELETE ON public.rsvp_household_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_rsvp_response_audit BEFORE UPDATE OR DELETE ON public.rsvp_response_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_invitation_deliveries BEFORE UPDATE OR DELETE ON public.invitation_deliveries FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_invitation_delivery_audit BEFORE UPDATE OR DELETE ON public.invitation_delivery_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();

CREATE FUNCTION public.get_public_event() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object('event',to_jsonb(e),'sessions',(
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order), '[]'::jsonb)
  FROM public.event_sessions s WHERE s.is_active
 )) INTO result FROM public.event_settings e WHERE e.id=1 AND e.is_published;
 RETURN result;
END $$;

-- Invitation data: do not expose email/phone, dietary data, or invitation codes for other households.
CREATE FUNCTION public.get_invitation_v2(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.households%ROWTYPE; result jsonb;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN NULL; END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
  'household',jsonb_build_object('id',h.id,'name',h.household_name,'language',h.language,'rsvp_state',h.rsvp_state,'food_confirmed',h.food_confirmed),
  'guests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'first_name',g.first_name,'last_name',g.last_name,'language',g.language,'is_child',g.is_child,'courtesy_title',g.courtesy_title) ORDER BY g.created_at)
     FROM public.guests g WHERE g.household_id=h.id),'[]'::jsonb),
  'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('guest_id',v.guest_id,'session_id',v.session_id,'requires_rsvp',v.requires_rsvp,'response',r.rsvp_status))
     FROM public.effective_session_invitations v LEFT JOIN public.guest_session_responses r ON r.guest_id=v.guest_id AND r.session_id=v.session_id
     WHERE v.household_id=h.id),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END $$;

-- p_responses: [{"guest_id":"uuid","session_id":"uuid","status":"attending|declined"}, ...]
CREATE FUNCTION public.submit_household_rsvp(p_code text,p_request_id uuid,p_responses jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.households%ROWTYPE; d public.event_settings%ROWTYPE;
 v_expected integer;v_actual integer;v_submission_id uuid;v_number integer;v_snapshot jsonb;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_request_id IS NULL
    OR jsonb_typeof(p_responses) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid submission'; END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
 SELECT id INTO v_submission_id FROM public.rsvp_submissions WHERE household_id=h.id AND request_id=p_request_id;
 IF FOUND THEN RETURN jsonb_build_object('submission_id',v_submission_id,'already_processed',true); END IF;
 IF h.rsvp_state <> 'open' THEN RAISE EXCEPTION 'RSVP is locked'; END IF;
 SELECT * INTO d FROM public.event_settings WHERE id=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not configured'; END IF;
 IF d.rsvp_deadline IS NOT NULL AND clock_timestamp()>d.rsvp_deadline
    AND (h.late_submission_until IS NULL OR clock_timestamp()>h.late_submission_until)
 THEN RAISE EXCEPTION 'RSVP deadline passed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_responses) x
   WHERE jsonb_typeof(x) <> 'object' OR (x->>'guest_id') IS NULL OR (x->>'session_id') IS NULL
      OR x->>'status' NOT IN ('attending','declined')) THEN RAISE EXCEPTION 'Invalid response entry'; END IF;
 -- Casts also reject malformed UUIDs; duplicate pairs are rejected below.
 IF EXISTS (SELECT 1 FROM (
  SELECT (x->>'guest_id')::uuid guest_id,(x->>'session_id')::uuid session_id,count(*) n
  FROM jsonb_array_elements(p_responses) x GROUP BY 1,2 HAVING count(*)<>1
 ) dup) THEN RAISE EXCEPTION 'Duplicate guest/session response'; END IF;
 SELECT count(*) INTO v_expected FROM public.effective_session_invitations v WHERE v.household_id=h.id AND v.requires_rsvp;
 SELECT count(*) INTO v_actual FROM jsonb_array_elements(p_responses) x
 JOIN public.effective_session_invitations v ON v.guest_id=(x->>'guest_id')::uuid AND v.session_id=(x->>'session_id')::uuid
 WHERE v.household_id=h.id AND v.requires_rsvp;
 IF v_expected<>v_actual OR jsonb_array_length(p_responses)<>v_expected THEN RAISE EXCEPTION 'Incomplete or unauthorized responses'; END IF;
 SELECT coalesce(max(submission_number),0)+1 INTO v_number FROM public.rsvp_submissions WHERE household_id=h.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id',(x->>'guest_id')::uuid,'session_id',(x->>'session_id')::uuid,'status',x->>'status') ORDER BY x->>'guest_id',x->>'session_id'),'[]'::jsonb)
 INTO v_snapshot FROM jsonb_array_elements(p_responses) x;
 INSERT INTO public.rsvp_submissions(household_id,submission_number,request_id,submission_snapshot)
 VALUES(h.id,v_number,p_request_id,v_snapshot) RETURNING id INTO v_submission_id;
 -- Remove obsolete current responses for this household (e.g. changed invitations after reopening).
 DELETE FROM public.guest_session_responses r USING public.guests g WHERE r.guest_id=g.id AND g.household_id=h.id;
 INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status,last_submission_id)
 SELECT (x->>'guest_id')::uuid,(x->>'session_id')::uuid,x->>'status',v_submission_id
 FROM jsonb_array_elements(p_responses) x;
 INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,action,new_status)
 SELECT h.id,(x->>'guest_id')::uuid,(x->>'session_id')::uuid,'submission',x->>'status' FROM jsonb_array_elements(p_responses) x;
 UPDATE public.households SET rsvp_state='locked',rsvp_submitted_at=now(),latest_rsvp_submission_id=v_submission_id,late_submission_until=NULL WHERE id=h.id;
 INSERT INTO public.rsvp_household_audit(household_id,action,submission_id) VALUES(h.id,'submitted',v_submission_id);
 RETURN jsonb_build_object('submission_id',v_submission_id,'submission_number',v_number,'already_processed',false);
END $$;

CREATE FUNCTION public.admin_reopen_household_rsvp(p_household_id uuid,p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.rsvp_state<>'locked' THEN RAISE EXCEPTION 'Household not locked'; END IF;
 UPDATE public.households SET rsvp_state='open',late_submission_until=NULL WHERE id=p_household_id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason)
 VALUES(p_household_id,auth.uid(),'reopened',h.latest_rsvp_submission_id,p_reason);
END $$;

CREATE FUNCTION public.admin_authorize_late_rsvp(p_household_id uuid,p_until timestamptz,p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR p_until IS NULL OR p_until<=clock_timestamp() THEN RAISE EXCEPTION 'Valid expiry and reason required'; END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.rsvp_state<>'open' THEN RAISE EXCEPTION 'Household must be open'; END IF;
 UPDATE public.households SET late_submission_until=p_until WHERE id=p_household_id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason)
 VALUES(p_household_id,auth.uid(),'late_submission_authorized',h.latest_rsvp_submission_id,p_reason);
END $$;

CREATE FUNCTION public.admin_correct_rsvp(p_guest_id uuid,p_session_id uuid,p_status text,p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household_id uuid;v_old text;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF p_status NOT IN ('attending','declined') OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Invalid correction'; END IF;
 SELECT household_id INTO v_household_id FROM public.guests WHERE id=p_guest_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown guest'; END IF;
 PERFORM 1 FROM public.households WHERE id=v_household_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.effective_session_invitations WHERE guest_id=p_guest_id AND session_id=p_session_id AND requires_rsvp) THEN RAISE EXCEPTION 'Not invited'; END IF;
 SELECT rsvp_status INTO v_old FROM public.guest_session_responses WHERE guest_id=p_guest_id AND session_id=p_session_id;
 INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status) VALUES(p_guest_id,p_session_id,p_status)
 ON CONFLICT(guest_id,session_id) DO UPDATE SET rsvp_status=excluded.rsvp_status,updated_at=now();
 INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,actor_user_id,action,previous_status,new_status,reason)
 VALUES(v_household_id,p_guest_id,p_session_id,auth.uid(),'admin_correction',v_old,p_status,p_reason);
END $$;

CREATE FUNCTION public.admin_confirm_invitation_sent(p_queue_id uuid,p_note text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.invitation_send_queue%ROWTYPE;v_id uuid;v_recipient jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'ready' THEN RAISE EXCEPTION 'Queue item must be ready'; END IF;
 SELECT coalesce(jsonb_build_object('contact_name',c.contact_name,'contact_type',c.contact_type,'contact_value',c.contact_value),jsonb_build_object('household_id',q.household_id))
 INTO v_recipient FROM (SELECT 1) z LEFT JOIN public.household_contacts c ON c.id=q.contact_id;
 INSERT INTO public.invitation_deliveries(queue_id,confirmed_by,recipient_snapshot,message_snapshot,delivery_note)
 VALUES(q.id,auth.uid(),v_recipient,jsonb_build_object('channel',q.channel,'subject',q.message_subject,'body',q.message_body),p_note)
 RETURNING id INTO v_id;
 UPDATE public.invitation_send_queue SET status='sent',updated_at=now() WHERE id=q.id;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,new_value)
 VALUES(q.id,auth.uid(),'confirmed_sent',jsonb_build_object('delivery_id',v_id));
 RETURN v_id;
END $$;

-- Lock down every function explicitly. Public functions are the only anon entry points.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_event() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_v2(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reopen_household_rsvp(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_authorize_late_rsvp(uuid,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_correct_rsvp(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_invitation_sent(uuid,text) TO authenticated;
COMMIT;
