-- RSVP Manager 001: fresh destination only. Do not apply to source project.
BEGIN;
CREATE TABLE public.relation_groups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.food_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.households (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_name text NOT NULL,
 side text NOT NULL CHECK (side IN ('paetur_hentze','maria_haass')),
 language text NOT NULL DEFAULT 'fo' CHECK (language IN ('fo','en','de')),
 email text, phone text, notes text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 invite_code text NOT NULL UNIQUE CHECK (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
 family_name text,relation_group_id uuid REFERENCES public.relation_groups(id) ON DELETE SET NULL,
 parent_id uuid REFERENCES public.households(id) ON DELETE RESTRICT,
 sort_order integer NOT NULL DEFAULT 0,food boolean NOT NULL DEFAULT false,
 stuff boolean NOT NULL DEFAULT false,things boolean NOT NULL DEFAULT false,
 visited boolean NOT NULL DEFAULT false,visited_at timestamptz,last_name text,
 food_confirmed boolean NOT NULL DEFAULT false,food_confirmed_at timestamptz,
 CONSTRAINT household_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);
CREATE TABLE public.guests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 first_name text NOT NULL,last_name text,relation text,
 language text CHECK (language IS NULL OR language IN ('fo','en','de')),
 is_child boolean NOT NULL DEFAULT false,rsvp_status text NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending','attending','declined')),
 dietary_requirements text,notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 courtesy_title text CHECK (courtesy_title IS NULL OR courtesy_title IN ('Mr.','Ms.','Son','Daughter'))
);
CREATE TABLE public.food_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),category text,name_fo text NOT NULL,name_en text,name_de text,
 description_fo text,description_en text,description_de text,quantity_needed integer NOT NULL DEFAULT 1 CHECK (quantity_needed>=0),
 active boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.food_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),food_item_id uuid NOT NULL REFERENCES public.food_items(id) ON DELETE RESTRICT,
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0),
 notes text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(food_item_id,household_id)
);
CREATE TABLE public.stuff_to_bring (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item text NOT NULL,quantity integer DEFAULT 1,assigned_to text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','done')),
 notes text,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.things_to_do (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task text NOT NULL,assigned_to text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done')),
 due_date date,notes text,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admins (user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX households_parent_idx ON public.households(parent_id);
CREATE INDEX households_relation_group_idx ON public.households(relation_group_id);
CREATE INDEX guests_household_idx ON public.guests(household_id);
CREATE INDEX food_claims_household_idx ON public.food_claims(household_id);
CREATE INDEX food_claims_item_idx ON public.food_claims(food_item_id);
-- Avoid recreating old generate_invite_code default until audited replacement exists.
-- Import explicit original invite_code values; new-household creation uses a trusted RPC later.
COMMIT;
-- RSVP Manager 002: new reusable single-event schema.
BEGIN;
CREATE TABLE public.event_languages (language_code text PRIMARY KEY CHECK(length(language_code) BETWEEN 2 AND 16),display_name text NOT NULL,enabled boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE public.event_settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),event_name text NOT NULL,event_type text NOT NULL DEFAULT 'other',
 default_language text NOT NULL REFERENCES public.event_languages(language_code),timezone text NOT NULL DEFAULT 'Atlantic/Faroe',
 website_url text,rsvp_deadline timestamptz,is_published boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.event_content (content_key text NOT NULL,language_code text NOT NULL REFERENCES public.event_languages(language_code),content_value text NOT NULL,PRIMARY KEY(content_key,language_code));
CREATE TABLE public.event_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,address text,map_url text,notes text,sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE public.event_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_key text NOT NULL UNIQUE,name text NOT NULL,
 location_id uuid REFERENCES public.event_locations(id) ON DELETE RESTRICT,
 starts_at timestamptz,ends_at timestamptz,requires_rsvp boolean NOT NULL DEFAULT true,is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0,CHECK(starts_at IS NULL OR ends_at IS NULL OR ends_at>starts_at)
);
CREATE TABLE public.household_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 contact_name text,contact_type text NOT NULL CHECK(contact_type IN ('email','phone','postal','other')),
 contact_value text NOT NULL CHECK(length(btrim(contact_value))>0),language_code text REFERENCES public.event_languages(language_code),
 is_primary boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,household_id)
);
CREATE UNIQUE INDEX household_primary_contact_per_type ON public.household_contacts(household_id,contact_type) WHERE is_primary;
CREATE TABLE public.household_session_defaults (
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 is_invited boolean NOT NULL DEFAULT true,PRIMARY KEY(household_id,session_id)
);
CREATE TABLE public.guest_session_overrides (
 guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 is_invited boolean NOT NULL,PRIMARY KEY(guest_id,session_id)
);
CREATE VIEW public.effective_session_invitations WITH (security_invoker=true) AS
 SELECT g.id AS guest_id,g.household_id,s.id AS session_id,s.requires_rsvp
 FROM public.guests g CROSS JOIN public.event_sessions s
 LEFT JOIN public.household_session_defaults d ON d.household_id=g.household_id AND d.session_id=s.id
 LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=s.id
 WHERE s.is_active AND coalesce(o.is_invited,d.is_invited,false);
ALTER TABLE public.households ADD COLUMN rsvp_state text NOT NULL DEFAULT 'open' CHECK(rsvp_state IN ('open','locked'));
ALTER TABLE public.households ADD COLUMN rsvp_submitted_at timestamptz;
ALTER TABLE public.households ADD COLUMN latest_rsvp_submission_id uuid;
ALTER TABLE public.households ADD COLUMN late_submission_until timestamptz;
CREATE TABLE public.rsvp_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 submission_number integer NOT NULL CHECK(submission_number>0),request_id uuid NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(),submission_snapshot jsonb NOT NULL,
 source text NOT NULL DEFAULT 'guest' CHECK(source IN ('guest','admin')),
 UNIQUE(household_id,submission_number),UNIQUE(household_id,request_id),UNIQUE(id,household_id)
);
ALTER TABLE public.households ADD CONSTRAINT household_latest_submission_fk FOREIGN KEY(latest_rsvp_submission_id,id) REFERENCES public.rsvp_submissions(id,household_id) ON DELETE RESTRICT;
CREATE TABLE public.guest_session_responses (
 guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 rsvp_status text NOT NULL CHECK(rsvp_status IN ('attending','declined')),
 last_submission_id uuid REFERENCES public.rsvp_submissions(id) ON DELETE RESTRICT,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guest_id,session_id)
);
CREATE TABLE public.rsvp_household_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('submitted','reopened','late_submission_authorized','admin_locked')),
 submission_id uuid REFERENCES public.rsvp_submissions(id) ON DELETE RESTRICT,
 reason text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(action NOT IN ('reopened','late_submission_authorized','admin_locked') OR (actor_user_id IS NOT NULL AND length(btrim(reason))>0))
);
CREATE TABLE public.rsvp_response_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('submission','admin_correction')),
 previous_status text,new_status text NOT NULL CHECK(new_status IN ('attending','declined')),
 reason text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(action <> 'admin_correction' OR (actor_user_id IS NOT NULL AND length(btrim(reason))>0))
);
CREATE TABLE public.message_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_key text NOT NULL,language_code text NOT NULL REFERENCES public.event_languages(language_code),
 channel text NOT NULL CHECK(channel IN ('whatsapp','sms','email','postal','manual')),
 subject text,body text NOT NULL,is_active boolean NOT NULL DEFAULT true,UNIQUE(template_key,language_code,channel)
);
CREATE TABLE public.invitation_send_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 contact_id uuid,channel text NOT NULL CHECK(channel IN ('whatsapp','sms','email','postal','manual')),
 message_subject text,message_body text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','sent','cancelled','failed')),
 created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(contact_id,household_id) REFERENCES public.household_contacts(id,household_id) ON DELETE RESTRICT
);
CREATE TABLE public.invitation_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),queue_id uuid NOT NULL UNIQUE REFERENCES public.invitation_send_queue(id) ON DELETE RESTRICT,
 confirmed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 confirmed_at timestamptz NOT NULL DEFAULT now(),recipient_snapshot jsonb NOT NULL,message_snapshot jsonb NOT NULL,delivery_note text
);
CREATE TABLE public.invitation_delivery_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,queue_id uuid NOT NULL REFERENCES public.invitation_send_queue(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,action text NOT NULL,previous_value jsonb,new_value jsonb,
 reason text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX household_contacts_household_idx ON public.household_contacts(household_id);
CREATE INDEX rsvp_submissions_household_time_idx ON public.rsvp_submissions(household_id,submitted_at DESC);
CREATE INDEX rsvp_response_audit_household_time_idx ON public.rsvp_response_audit(household_id,created_at DESC);
CREATE INDEX rsvp_household_audit_household_time_idx ON public.rsvp_household_audit(household_id,created_at DESC);
CREATE INDEX invitation_queue_household_status_idx ON public.invitation_send_queue(household_id,status);
CREATE INDEX invitation_delivery_audit_queue_idx ON public.invitation_delivery_audit(queue_id,created_at DESC);
COMMIT;
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

-- Fresh-project installation: migration already installed on the existing RSVP database.
ALTER TABLE public.event_settings ADD COLUMN IF NOT EXISTS event_date date;
COMMENT ON COLUMN public.event_settings.event_date IS
'Primary calendar date of the event, without an assumed time of day; session times are separate.';
-- RSVP Manager: administrator membership via existing verified Supabase Auth accounts.
-- Never call Supabase Auth admin endpoints from the browser or expose service_role.
-- Apply AFTER 001-005. Uses explicit grants and no table write access for clients.
BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_membership_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    action text NOT NULL CHECK (action IN ('add','remove','rename')),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_membership_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_membership_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_membership_audit TO authenticated;
DROP POLICY IF EXISTS admin_read ON public.admin_membership_audit;
CREATE POLICY admin_read ON public.admin_membership_audit FOR SELECT TO authenticated
USING ((SELECT public.is_admin()));
DROP TRIGGER IF EXISTS immutable_admin_membership_audit ON public.admin_membership_audit;
CREATE TRIGGER immutable_admin_membership_audit BEFORE UPDATE OR DELETE
ON public.admin_membership_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();

CREATE OR REPLACE FUNCTION public.admin_list_members()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',a.name,
                  'email',u.email,'created_at',a.created_at) ORDER BY a.created_at)
      FROM public.admins a JOIN auth.users u ON u.id=a.user_id
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_add_existing_user(p_email text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_id uuid; display_name text; normalized_email text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  normalized_email := lower(btrim(coalesce(p_email,'')));
  display_name := btrim(coalesce(p_name,''));
  IF length(normalized_email) < 3 OR length(normalized_email) > 254 OR
     length(display_name) < 1 OR length(display_name) > 120 THEN
    RAISE EXCEPTION 'Valid email and name required';
  END IF;
  SELECT id INTO target_id FROM auth.users
   WHERE lower(email)=normalized_email AND email_confirmed_at IS NOT NULL;
  IF target_id IS NULL THEN
    RAISE EXCEPTION 'A verified Auth user with this email does not exist. Invite them through Supabase Authentication first.';
  END IF;
  INSERT INTO public.admins(user_id,name) VALUES(target_id,display_name)
  ON CONFLICT (user_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'User is already an administrator'; END IF;
  INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details)
  VALUES(auth.uid(),target_id,'add',jsonb_build_object('name',display_name));
  RETURN jsonb_build_object('user_id',target_id,'name',display_name);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_remove_member(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(42319, 11);
  IF (SELECT count(*) FROM public.admins) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last administrator';
  END IF;
  DELETE FROM public.admins WHERE user_id=p_user_id RETURNING name INTO old_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found'; END IF;
  INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details)
  VALUES(auth.uid(),p_user_id,'remove',jsonb_build_object('name',old_name));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_rename_member(p_user_id uuid,p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  new_name := btrim(coalesce(p_name,''));
  IF length(new_name) < 1 OR length(new_name) > 120 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  UPDATE public.admins SET name=new_name WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found'; END IF;
  INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details)
  VALUES(auth.uid(),p_user_id,'rename',jsonb_build_object('name',new_name));
END; $$;

REVOKE ALL ON FUNCTION public.admin_list_members() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_add_existing_user(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_remove_member(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_rename_member(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_existing_user(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rename_member(uuid,text) TO authenticated;
COMMIT;
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
-- Safe first-time defaults. Existing event settings and language choices are never overwritten.
-- New project owners may change these values after first admin login.
BEGIN;
INSERT INTO public.event_languages(language_code,display_name,enabled,sort_order)
VALUES ('en','English',true,1),('fo','Føroyskt',true,2),('de','Deutsch',true,3)
ON CONFLICT(language_code) DO NOTHING;
INSERT INTO public.event_settings(id,event_name,event_type,default_language,timezone,is_published)
VALUES(1,'My event','other','en','UTC',false)
ON CONFLICT(id) DO NOTHING;
COMMIT;

-- ---- Security / hierarchy update 009 ----
-- RSVP Manager 009: authenticated-admin hierarchy and ordering controls.
-- Idempotent, non-destructive. Leaves existing parent links and sort_order values unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_household_parent(p_household_id uuid, p_parent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_side text; v_group uuid; v_old_parent uuid; v_parent_side text; v_parent_group uuid; v_next integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7744);
  SELECT side,relation_group_id,parent_id INTO v_side,v_group,v_old_parent
    FROM public.households WHERE id=p_household_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household not found'; END IF;
  IF p_parent_id IS NOT NULL THEN
    IF p_parent_id=p_household_id THEN RAISE EXCEPTION 'A household cannot be its own parent'; END IF;
    SELECT side,relation_group_id INTO v_parent_side,v_parent_group
      FROM public.households WHERE id=p_parent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parent household not found'; END IF;
    IF v_side<>v_parent_side OR v_group IS DISTINCT FROM v_parent_group THEN
      RAISE EXCEPTION 'Parent must belong to the same side and relation group';
    END IF;
  END IF;
  IF v_old_parent IS NOT DISTINCT FROM p_parent_id THEN RETURN; END IF;
  SELECT coalesce(max(sort_order),0)+1 INTO v_next FROM public.households
    WHERE side=v_side AND relation_group_id IS NOT DISTINCT FROM v_group AND parent_id IS NOT DISTINCT FROM p_parent_id;
  -- The existing guard_household_parent trigger prevents any ancestor cycle.
  UPDATE public.households SET parent_id=p_parent_id,sort_order=v_next,updated_at=now() WHERE id=p_household_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_move_household(p_household_id uuid,p_direction integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_side text;v_group uuid;v_parent uuid;v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7744);
  SELECT side,relation_group_id,parent_id INTO v_side,v_group,v_parent FROM public.households WHERE id=p_household_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household not found'; END IF;
  SELECT array_agg(id ORDER BY sort_order,lower(household_name),id) INTO v_order
  FROM public.households WHERE side=v_side AND relation_group_id IS NOT DISTINCT FROM v_group AND parent_id IS NOT DISTINCT FROM v_parent;
  v_position:=array_position(v_order,p_household_id);v_target:=v_position+p_direction;
  IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
  v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
  UPDATE public.households h SET sort_order=ordered.ordinality::integer,updated_at=now()
    FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE h.id=ordered.id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_move_food_category(p_category_id uuid,p_direction integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO v_order FROM public.food_categories;
  v_position:=array_position(v_order,p_category_id);
  IF v_position IS NULL THEN RAISE EXCEPTION 'Category not found'; END IF;
  v_target:=v_position+p_direction;
  IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
  v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
  UPDATE public.food_categories c SET sort_order=ordered.ordinality::integer
    FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE c.id=ordered.id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_move_food_item(p_food_item_id uuid,p_direction integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_category text;v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT category INTO v_category FROM public.food_items WHERE id=p_food_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
  SELECT array_agg(id ORDER BY sort_order,lower(name_fo),id) INTO v_order
    FROM public.food_items WHERE category IS NOT DISTINCT FROM v_category;
  v_position:=array_position(v_order,p_food_item_id);v_target:=v_position+p_direction;
  IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
  v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
  UPDATE public.food_items f SET sort_order=ordered.ordinality::integer,updated_at=now()
    FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE f.id=ordered.id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_food_category(p_food_item_id uuid,p_category text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old_category text;v_new_category text;v_next integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  v_new_category:=btrim(coalesce(p_category,''));
  IF length(v_new_category)>120 THEN RAISE EXCEPTION 'Category is too long'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT category INTO v_old_category FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
  IF v_new_category<>'' AND NOT EXISTS(SELECT 1 FROM public.food_categories WHERE name=v_new_category) THEN
    RAISE EXCEPTION 'Create the food category before assigning it';
  END IF;
  IF v_old_category IS NOT DISTINCT FROM nullif(v_new_category,'') THEN RETURN; END IF;
  SELECT coalesce(max(sort_order),0)+1 INTO v_next FROM public.food_items WHERE category IS NOT DISTINCT FROM nullif(v_new_category,'');
  UPDATE public.food_items SET category=nullif(v_new_category,''),sort_order=v_next,updated_at=now() WHERE id=p_food_item_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_rename_food_category(p_category_id uuid,p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old text;v_new text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  v_new:=btrim(coalesce(p_name,''));
  IF length(v_new)=0 OR length(v_new)>120 THEN RAISE EXCEPTION 'Enter a valid category name'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT name INTO v_old FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;
  IF v_old=v_new THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.food_categories WHERE name=v_new) THEN RAISE EXCEPTION 'Category already exists'; END IF;
  UPDATE public.food_categories SET name=v_new WHERE id=p_category_id;
  UPDATE public.food_items SET category=v_new,updated_at=now() WHERE category=v_old;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_household_parent(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_move_household(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_move_food_category(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_move_food_item(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_set_food_category(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_rename_food_category(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_household_parent(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_household(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_food_category(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_food_item(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_food_category(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rename_food_category(uuid,text) TO authenticated;
COMMIT;

-- ---- Security / hierarchy update 010 ----
-- RSVP Manager 010: order guest food by admin category and item sort order.
-- Safe on populated projects: no guest, food, or claim data is rewritten.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE f.active),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO anon,authenticated;
COMMIT;

-- ---- Security / hierarchy update 011 ----
-- Migration 011: public invitation, RSVP and food functions require event publication.
-- Deployed in the existing wedding project and tested with anonymous role.
-- Keep per-code rate limiting as a separate edge/API requirement.
BEGIN;
CREATE OR REPLACE FUNCTION public.confirm_household_food(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF; 
 SELECT id INTO v_id FROM public.households WHERE invite_code=p_code AND food=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid food invitation'; END IF;
 UPDATE public.households SET food_confirmed=true,food_confirmed_at=coalesce(food_confirmed_at,now()) WHERE id=v_id AND NOT food_confirmed;
END $function$;
CREATE OR REPLACE FUNCTION public.get_invitation_v2(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE h public.households%ROWTYPE; BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RETURN NULL; END IF;  IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN NULL; END IF; SELECT * INTO h FROM public.households WHERE invite_code=p_code; IF NOT FOUND THEN RETURN NULL; END IF; RETURN jsonb_build_object('household',jsonb_build_object('id',h.id,'name',h.household_name,'language',h.language,'rsvp_state',h.rsvp_state,'food_confirmed',h.food_confirmed),'guests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'first_name',g.first_name,'last_name',g.last_name,'language',g.language,'is_child',g.is_child,'courtesy_title',g.courtesy_title) ORDER BY g.created_at) FROM public.guests g WHERE g.household_id=h.id),'[]'::jsonb),'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('guest_id',v.guest_id,'session_id',v.session_id,'requires_rsvp',v.requires_rsvp,'response',r.rsvp_status)) FROM public.effective_session_invitations v LEFT JOIN public.guest_session_responses r ON r.guest_id=v.guest_id AND r.session_id=v.session_id WHERE v.household_id=h.id),'[]'::jsonb)); END $function$;
CREATE OR REPLACE FUNCTION public.set_household_food_claim(p_code text, p_food_item_id uuid, p_quantity integer, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_household public.households%ROWTYPE;v_needed integer;v_active boolean;v_total integer;v_old integer;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF; 
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
END $function$;
CREATE OR REPLACE FUNCTION public.submit_household_rsvp(p_code text, p_request_id uuid, p_responses jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE h public.households%ROWTYPE;d public.event_settings%ROWTYPE;v_expected integer;v_actual integer;v_id uuid;v_number integer;v_snapshot jsonb;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF; 
IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_request_id IS NULL OR jsonb_typeof(p_responses) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid submission'; END IF;
SELECT * INTO h FROM public.households WHERE invite_code=p_code FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
SELECT id INTO v_id FROM public.rsvp_submissions WHERE household_id=h.id AND request_id=p_request_id;
IF FOUND THEN RETURN jsonb_build_object('submission_id',v_id,'already_processed',true); END IF;
IF h.rsvp_state<>'open' THEN RAISE EXCEPTION 'RSVP is locked'; END IF;
SELECT * INTO d FROM public.event_settings WHERE id=1;
IF NOT FOUND THEN RAISE EXCEPTION 'Event not configured'; END IF;
IF d.rsvp_deadline IS NOT NULL AND clock_timestamp()>d.rsvp_deadline AND (h.late_submission_until IS NULL OR clock_timestamp()>h.late_submission_until) THEN RAISE EXCEPTION 'RSVP deadline passed'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_responses) x WHERE jsonb_typeof(x)<>'object' OR (x->>'guest_id') IS NULL OR (x->>'session_id') IS NULL OR (x->>'status') IS NULL OR x->>'status' NOT IN ('attending','declined')) THEN RAISE EXCEPTION 'Invalid response entry'; END IF;
IF EXISTS(SELECT 1 FROM (SELECT (x->>'guest_id')::uuid guest_id,(x->>'session_id')::uuid session_id,count(*) n FROM jsonb_array_elements(p_responses) x GROUP BY 1,2 HAVING count(*)<>1) z) THEN RAISE EXCEPTION 'Duplicate response'; END IF;
SELECT count(*) INTO v_expected FROM public.effective_session_invitations v WHERE v.household_id=h.id AND v.requires_rsvp;
SELECT count(*) INTO v_actual FROM jsonb_array_elements(p_responses) x JOIN public.effective_session_invitations v ON v.guest_id=(x->>'guest_id')::uuid AND v.session_id=(x->>'session_id')::uuid WHERE v.household_id=h.id AND v.requires_rsvp;
IF v_expected<>v_actual OR jsonb_array_length(p_responses)<>v_expected THEN RAISE EXCEPTION 'Incomplete or unauthorized responses'; END IF;
SELECT coalesce(max(submission_number),0)+1 INTO v_number FROM public.rsvp_submissions WHERE household_id=h.id;
SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id',(x->>'guest_id')::uuid,'session_id',(x->>'session_id')::uuid,'status',x->>'status') ORDER BY x->>'guest_id',x->>'session_id'),'[]'::jsonb) INTO v_snapshot FROM jsonb_array_elements(p_responses) x;
INSERT INTO public.rsvp_submissions(household_id,submission_number,request_id,submission_snapshot) VALUES(h.id,v_number,p_request_id,v_snapshot) RETURNING id INTO v_id;
DELETE FROM public.guest_session_responses r USING public.guests g WHERE r.guest_id=g.id AND g.household_id=h.id;
INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status,last_submission_id) SELECT (x->>'guest_id')::uuid,(x->>'session_id')::uuid,x->>'status',v_id FROM jsonb_array_elements(p_responses) x;
INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,action,new_status) SELECT h.id,(x->>'guest_id')::uuid,(x->>'session_id')::uuid,'submission',x->>'status' FROM jsonb_array_elements(p_responses) x;
UPDATE public.households SET rsvp_state='locked',rsvp_submitted_at=now(),latest_rsvp_submission_id=v_id,late_submission_until=NULL WHERE id=h.id;
INSERT INTO public.rsvp_household_audit(household_id,action,submission_id) VALUES(h.id,'submitted',v_id);
RETURN jsonb_build_object('submission_id',v_id,'submission_number',v_number,'already_processed',false);
END $function$;
COMMIT;

-- ---- Migration 012: guest gateway throttling and direct-RPC protections ----
-- Migration 012/013: restrict guest calls to the throttled Edge Function and create atomic counters.
-- The Edge Function uses a server-only service-role key; public browser code never receives it.
BEGIN;
CREATE TABLE IF NOT EXISTS public.guest_gateway_rate_limits (
  key_hash text NOT NULL,
  period_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  PRIMARY KEY(key_hash, period_start)
);
ALTER TABLE public.guest_gateway_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_gateway_rate_limits FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.guest_gateway_allow_request(p_ip_hash text, p_code text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_period timestamptz;v_limit integer;v_key text;v_ok boolean;v_code text:=upper(coalesce(p_code,''));v_n integer;
BEGIN
 IF p_ip_hash !~ '^[a-f0-9]{64}$'
 OR p_action NOT IN ('get_invitation_v2','get_household_food','set_household_food_claim','confirm_household_food','submit_household_rsvp')
 OR v_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN false; END IF;
 v_period:=date_trunc('minute',clock_timestamp());
 FOR v_n IN 1..3 LOOP
  IF v_n=1 THEN v_key:='ip:'||p_ip_hash;v_limit:=40;
  ELSIF v_n=2 THEN v_key:='code:'||md5(v_code);v_limit:=20;
  ELSE v_key:='global';v_limit:=2500;END IF;
  INSERT INTO public.guest_gateway_rate_limits(key_hash,period_start,request_count)
   VALUES(v_key,v_period,1)
   ON CONFLICT (key_hash,period_start) DO UPDATE
     SET request_count=public.guest_gateway_rate_limits.request_count+1
     WHERE public.guest_gateway_rate_limits.request_count<v_limit
   RETURNING true INTO v_ok;
  IF coalesce(v_ok,false)=false THEN RETURN false; END IF;
  v_ok:=false;
 END LOOP;
 RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.guest_gateway_allow_request(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_gateway_allow_request(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.get_invitation_v2(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_v2(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_household_food(text) TO service_role;
COMMIT;

-- ---- Migration 014: administrator guest editing ----
-- 014: Restore administrator guest editing inside the expandable household tree.
-- Only profile fields are editable; RSVP status, household ownership, and submission locks are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_guest(
  p_guest_id uuid,
  p_first_name text,
  p_last_name text,
  p_courtesy_title text,
  p_relation text,
  p_language text,
  p_is_child boolean,
  p_dietary_requirements text,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_first text := NULLIF(pg_catalog.btrim(p_first_name), '');
  v_last text := NULLIF(pg_catalog.btrim(p_last_name), '');
  v_title text := NULLIF(pg_catalog.btrim(p_courtesy_title), '');
  v_relation text := NULLIF(pg_catalog.btrim(p_relation), '');
  v_dietary text := NULLIF(pg_catalog.btrim(p_dietary_requirements), '');
  v_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_guest_id IS NULL OR v_first IS NULL OR pg_catalog.char_length(v_first)>120 THEN
    RAISE EXCEPTION 'A first name of at most 120 characters is required';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_last,''))>120 OR
     pg_catalog.char_length(COALESCE(v_relation,''))>160 OR
     pg_catalog.char_length(COALESCE(v_dietary,''))>1000 OR
     pg_catalog.char_length(COALESCE(v_notes,''))>2000 THEN
    RAISE EXCEPTION 'Guest field exceeds maximum length';
  END IF;
  IF v_title IS NOT NULL AND v_title NOT IN ('Mr.','Ms.','Son','Daughter') THEN
    RAISE EXCEPTION 'Invalid courtesy title';
  END IF;
  IF p_language IS NOT NULL AND p_language NOT IN ('fo','en','de') THEN
    RAISE EXCEPTION 'Invalid guest language';
  END IF;
  IF p_is_child IS NULL THEN
    RAISE EXCEPTION 'Guest child flag is required';
  END IF;

  UPDATE public.guests
  SET first_name=v_first, last_name=v_last,
      courtesy_title=v_title, relation=v_relation,
      language=p_language, is_child=p_is_child,
      dietary_requirements=v_dietary, notes=v_notes,
      updated_at=pg_catalog.now()
  WHERE id=p_guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest not found';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_update_guest(uuid,text,text,text,text,text,boolean,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_guest(uuid,text,text,text,text,text,boolean,text,text)
  TO authenticated;
COMMIT;


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
