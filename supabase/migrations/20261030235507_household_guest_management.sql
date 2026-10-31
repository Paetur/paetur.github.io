-- Household/guest lifecycle. No imported identities, codes or responses are changed.
BEGIN;
ALTER TABLE public.households ADD COLUMN archived_at timestamptz;
ALTER TABLE public.guests ADD COLUMN archived_at timestamptz;
ALTER TABLE public.household_contacts ADD COLUMN archived_at timestamptz;
ALTER TABLE public.household_contacts ADD COLUMN preferred_method text CHECK(preferred_method IN ('whatsapp','sms','email','postal','manual'));
CREATE TABLE public.management_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 household_id uuid NOT NULL REFERENCES public.households(id),
 entity_type text NOT NULL, entity_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL, before_value jsonb, after_value jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX management_audit_household_time ON public.management_audit(household_id,created_at DESC);
ALTER TABLE public.management_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.management_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.management_audit TO authenticated;
CREATE POLICY admin_read ON public.management_audit FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE TRIGGER immutable_management_audit BEFORE UPDATE OR DELETE ON public.management_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.audit_management() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b jsonb; a jsonb; h uuid;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN b:=to_jsonb(OLD)-'invite_code'-'updated_at'; END IF;
 a:=to_jsonb(NEW)-'invite_code'-'updated_at';
 IF a IS NOT DISTINCT FROM b THEN RETURN NEW; END IF;
 h:=CASE WHEN TG_TABLE_NAME='households' THEN NEW.id ELSE (a->>'household_id')::uuid END;
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value)
 VALUES(h,TG_TABLE_NAME,NEW.id,auth.uid(),lower(TG_OP),b,a);
 -- A move is also visible in the source household's history.
 IF TG_TABLE_NAME='guests' AND TG_OP='UPDATE' AND b->>'household_id' IS DISTINCT FROM a->>'household_id' THEN
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value)
 VALUES((b->>'household_id')::uuid,TG_TABLE_NAME,NEW.id,auth.uid(),'move',b,a);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.audit_management() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER household_management_audit AFTER INSERT OR UPDATE ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.audit_management();
CREATE TRIGGER guest_management_audit AFTER INSERT OR UPDATE ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.audit_management();
CREATE TRIGGER contact_management_audit AFTER INSERT OR UPDATE ON public.household_contacts FOR EACH ROW EXECUTE FUNCTION app_private.audit_management();

CREATE FUNCTION public.admin_save_household(p_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; v_id uuid:=p_id; v_code text; bytes bytea; i integer; parent uuid:=nullif(p_values->>'parent_id','')::uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR nullif(btrim(p_values->>'household_name'),'') IS NULL OR length(p_values->>'household_name')>140 THEN RAISE EXCEPTION 'Household name is required (maximum 140 characters)'; END IF;
 IF length(coalesce(p_values->>'email',''))>320 OR length(coalesce(p_values->>'phone',''))>80 OR length(coalesce(p_values->>'notes',''))>2000 THEN RAISE EXCEPTION 'Household field too long'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_id IS NOT NULL THEN
 SELECT * INTO h FROM public.households WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Household not found'; END IF;
 IF h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore household before editing'; END IF;
 -- Keep children in the same grouping; never silently move a whole subtree.
 IF (h.side IS DISTINCT FROM p_values->>'side' OR h.relation_group_id IS DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid)
 AND EXISTS(SELECT 1 FROM public.households WHERE parent_id=p_id) THEN RAISE EXCEPTION 'Move child households before changing this household grouping'; END IF;
 END IF;
 IF parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.households WHERE id=parent AND archived_at IS NULL AND side=p_values->>'side' AND relation_group_id IS NOT DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid) THEN RAISE EXCEPTION 'Parent must be active and in the same side and relation group'; END IF;
 IF v_id IS NULL THEN
 -- 40 random bits, the existing unambiguous 32-character alphabet, collision retry.
 LOOP
 bytes:=decode(md5(gen_random_uuid()::text),'hex');v_code:='';
 FOR i IN 0..7 LOOP v_code:=v_code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+get_byte(bytes,i)%32,1); END LOOP;
 EXIT WHEN NOT EXISTS(SELECT 1 FROM public.households WHERE invite_code=v_code);
 END LOOP;
 INSERT INTO public.households(household_name,side,language,relation_group_id,parent_id,email,phone,notes,invite_code)
 VALUES(btrim(p_values->>'household_name'),p_values->>'side',p_values->>'language',nullif(p_values->>'relation_group_id','')::uuid,parent,nullif(btrim(p_values->>'email'),''),nullif(btrim(p_values->>'phone'),''),nullif(btrim(p_values->>'notes'),''),v_code) RETURNING id INTO v_id;
 ELSE
 UPDATE public.households SET household_name=btrim(p_values->>'household_name'),side=p_values->>'side',language=p_values->>'language',relation_group_id=nullif(p_values->>'relation_group_id','')::uuid,parent_id=parent,email=nullif(btrim(p_values->>'email'),''),phone=nullif(btrim(p_values->>'phone'),''),notes=nullif(btrim(p_values->>'notes'),''),updated_at=now() WHERE id=v_id;
 END IF;
 RETURN v_id;
END $$;

CREATE FUNCTION public.admin_create_guest(p_household_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=p_household_id) THEN RAISE EXCEPTION 'Guests can only be added to active households without submitted RSVPs'; END IF;
 INSERT INTO public.guests(household_id,first_name) VALUES(p_household_id,'New guest') RETURNING id INTO v_id;
 PERFORM public.admin_update_guest(v_id,p_values->>'first_name',p_values->>'last_name',p_values->>'courtesy_title',p_values->>'relation',p_values->>'language',coalesce((p_values->>'is_child')::boolean,false),p_values->>'dietary_requirements',p_values->>'notes');
 RETURN v_id;
END $$;

CREATE FUNCTION public.admin_move_guest(p_guest_id uuid,p_household_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.guests%ROWTYPE; target public.households%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO g FROM public.guests WHERE id=p_guest_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Guest not found'; END IF;
 PERFORM 1 FROM public.households WHERE id IN(g.household_id,p_household_id) ORDER BY id FOR UPDATE;
 SELECT * INTO target FROM public.households WHERE id=p_household_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination household not found'; END IF;
 IF g.household_id=p_household_id THEN RETURN; END IF;
 IF g.archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.households WHERE id IN(g.household_id,p_household_id) AND (archived_at IS NOT NULL OR rsvp_state<>'open')) OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id IN(g.household_id,p_household_id)) OR EXISTS(SELECT 1 FROM public.guest_session_responses WHERE guest_id=p_guest_id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE guest_id=p_guest_id) THEN RAISE EXCEPTION 'Move requires active households and guest without RSVP history'; END IF;
 -- Freeze the old effective assignment for EVERY session, including inactive sessions.
 INSERT INTO public.guest_session_overrides(guest_id,session_id,is_invited)
 SELECT g.id,s.id,coalesce(o.is_invited,d.is_invited,false) FROM public.event_sessions s
 LEFT JOIN public.household_session_defaults d ON d.household_id=g.household_id AND d.session_id=s.id
 LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=s.id
 ON CONFLICT(guest_id,session_id) DO UPDATE SET is_invited=excluded.is_invited;
 UPDATE public.guests SET household_id=p_household_id,updated_at=now() WHERE id=p_guest_id;
END $$;

CREATE FUNCTION public.admin_set_archived(p_entity text,p_id uuid,p_archived boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; hid uuid; existing timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_entity NOT IN ('households','guests','household_contacts') OR p_entity IS NULL OR p_archived IS NULL THEN RAISE EXCEPTION 'Invalid archive request'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_entity='households' THEN hid:=p_id;
 ELSIF p_entity='guests' THEN SELECT household_id INTO hid FROM public.guests WHERE id=p_id;
 ELSE SELECT household_id INTO hid FROM public.household_contacts WHERE id=p_id; END IF;
 SELECT * INTO h FROM public.households WHERE id=hid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Record not found'; END IF;
 IF p_entity<>'households' AND h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the household first'; END IF;
 IF p_entity IN ('households','guests') AND (h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=hid)) THEN RAISE EXCEPTION 'Records with submitted RSVPs cannot be archived or restored'; END IF;
 IF p_entity='guests' AND (EXISTS(SELECT 1 FROM public.guest_session_responses WHERE guest_id=p_id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE guest_id=p_id)) THEN RAISE EXCEPTION 'Guest has RSVP history'; END IF;
 IF p_entity='households' THEN
 IF p_archived AND (h.food_confirmed OR EXISTS(SELECT 1 FROM public.food_claims WHERE household_id=hid) OR EXISTS(SELECT 1 FROM public.households WHERE parent_id=hid AND archived_at IS NULL) OR EXISTS(SELECT 1 FROM public.invitation_send_queue WHERE household_id=hid AND status IN ('draft','ready')) OR EXISTS(SELECT 1 FROM public.guests g JOIN public.guest_session_responses r ON r.guest_id=g.id WHERE g.household_id=hid) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE household_id=hid)) THEN RAISE EXCEPTION 'Resolve food commitments, active child households, invitation queues or RSVP history before archiving'; END IF;
 IF NOT p_archived AND EXISTS(SELECT 1 FROM public.households WHERE id=h.parent_id AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore the parent household first'; END IF;
 END IF;
 IF p_entity='household_contacts' AND p_archived THEN UPDATE public.household_contacts SET is_primary=false WHERE id=p_id; END IF;
 EXECUTE format('UPDATE public.%I SET archived_at=$1,updated_at=now() WHERE id=$2',p_entity) USING CASE WHEN p_archived THEN now() ELSE NULL END,p_id;
END $$;

CREATE FUNCTION public.admin_save_contact(p_id uuid,p_household_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household required'; END IF;
 IF nullif(btrim(p_values->>'contact_value'),'') IS NULL OR length(p_values->>'contact_value')>1000 OR length(coalesce(p_values->>'contact_name',''))>140 THEN RAISE EXCEPTION 'Enter valid contact details'; END IF;
 IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.household_contacts WHERE id=p_id AND household_id=p_household_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Active contact not found'; END IF;
 IF coalesce((p_values->>'is_primary')::boolean,false) THEN UPDATE public.household_contacts SET is_primary=false,updated_at=now() WHERE household_id=p_household_id AND contact_type=p_values->>'contact_type' AND is_primary; END IF;
 IF v_id IS NULL THEN
 INSERT INTO public.household_contacts(household_id,contact_type,contact_value) VALUES(p_household_id,p_values->>'contact_type',btrim(p_values->>'contact_value')) RETURNING id INTO v_id;
 END IF;
 UPDATE public.household_contacts SET contact_name=nullif(btrim(p_values->>'contact_name'),''),contact_type=p_values->>'contact_type',contact_value=btrim(p_values->>'contact_value'),language_code=nullif(p_values->>'language_code',''),preferred_method=nullif(p_values->>'preferred_method',''),is_primary=coalesce((p_values->>'is_primary')::boolean,false),updated_at=now() WHERE id=v_id;
 RETURN v_id;
END $$;
-- Contact writes now use the audited API only.
REVOKE INSERT,UPDATE ON public.household_contacts FROM authenticated;
DO $$ DECLARE f regprocedure; BEGIN
 FOREACH f IN ARRAY ARRAY['public.admin_save_household(uuid,jsonb)'::regprocedure,'public.admin_create_guest(uuid,jsonb)'::regprocedure,'public.admin_move_guest(uuid,uuid)'::regprocedure,'public.admin_set_archived(text,uuid,boolean)'::regprocedure,'public.admin_save_contact(uuid,uuid,jsonb)'::regprocedure] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);
 END LOOP;
END $$;

CREATE OR REPLACE VIEW public.effective_session_invitations WITH (security_invoker=true) AS
 SELECT g.id AS guest_id,g.household_id,s.id AS session_id,s.requires_rsvp
 FROM public.guests g JOIN public.households h ON h.id=g.household_id CROSS JOIN public.event_sessions s
 LEFT JOIN public.household_session_defaults d ON d.household_id=g.household_id AND d.session_id=s.id
 LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=s.id
 WHERE g.archived_at IS NULL AND h.archived_at IS NULL AND s.is_active AND coalesce(o.is_invited,d.is_invited,false);
-- Apply archive filtering to the existing reviewed gateway RPCs without changing their grants.
DO $$ DECLARE f regprocedure; body text; BEGIN
 FOREACH f IN ARRAY ARRAY['public.get_invitation_v2(text)'::regprocedure,'public.submit_household_rsvp(text,uuid,jsonb)'::regprocedure,'public.set_household_food_claim(text,uuid,integer,text)'::regprocedure,'public.confirm_household_food(text)'::regprocedure,'public.get_household_food(text)'::regprocedure] LOOP
 body:=pg_get_functiondef(f);
 body:=replace(body,'WHERE invite_code=p_code','WHERE archived_at IS NULL AND invite_code=p_code');
 body:=replace(body,'WHERE h.invite_code=p_code','WHERE h.archived_at IS NULL AND h.invite_code=p_code');
 IF f='public.get_invitation_v2(text)'::regprocedure THEN body:=replace(body,'WHERE g.household_id=h.id','WHERE g.archived_at IS NULL AND g.household_id=h.id'); END IF;
 EXECUTE body;
 END LOOP;
END $$;

-- Enforce grouping/archive consistency even through the older hierarchy RPC.
CREATE FUNCTION app_private.guard_management_parent() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.parent_id IS NOT NULL AND NEW.archived_at IS NULL AND NOT EXISTS(
 SELECT 1 FROM public.households p WHERE p.id=NEW.parent_id AND p.archived_at IS NULL
 AND p.side=NEW.side AND p.relation_group_id IS NOT DISTINCT FROM NEW.relation_group_id
 ) THEN RAISE EXCEPTION 'Parent must be active and in the same side and relation group'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_management_parent() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER management_parent_guard BEFORE INSERT OR UPDATE OF parent_id,side,relation_group_id,archived_at ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_management_parent();

COMMIT;
