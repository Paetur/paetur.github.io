-- Independent venues, timezone-aware sessions and audited invitation exceptions.
BEGIN;
ALTER TABLE public.event_locations ADD COLUMN timezone text;
UPDATE public.event_locations SET timezone=coalesce((SELECT timezone FROM public.event_settings WHERE id=1),'UTC');
ALTER TABLE public.event_locations ALTER COLUMN timezone SET NOT NULL;
ALTER TABLE public.event_locations ALTER COLUMN timezone SET DEFAULT 'UTC';
ALTER TABLE public.event_locations ADD COLUMN country_code text CHECK(country_code ~ '^[A-Z]{2}$');
ALTER TABLE public.event_locations ADD COLUMN archived_at timestamptz;
CREATE TABLE public.event_configuration_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entity_type text NOT NULL,entity_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),before_value jsonb,after_value jsonb,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.event_configuration_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_configuration_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_configuration_audit TO authenticated;
CREATE POLICY admin_read ON public.event_configuration_audit FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE TRIGGER immutable_event_configuration_audit BEFORE UPDATE OR DELETE ON public.event_configuration_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE FUNCTION app_private.audit_event_configuration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b jsonb;BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN b:=to_jsonb(OLD);END IF;
 IF b IS DISTINCT FROM to_jsonb(NEW) THEN INSERT INTO public.event_configuration_audit(entity_type,entity_id,actor_user_id,before_value,after_value) VALUES(TG_TABLE_NAME,NEW.id,auth.uid(),b,to_jsonb(NEW));END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.audit_event_configuration() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER audit_venue AFTER INSERT OR UPDATE ON public.event_locations FOR EACH ROW EXECUTE FUNCTION app_private.audit_event_configuration();
CREATE TRIGGER audit_session AFTER INSERT OR UPDATE ON public.event_sessions FOR EACH ROW EXECUTE FUNCTION app_private.audit_event_configuration();

CREATE FUNCTION public.admin_save_venue(p_id uuid,p_values jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;v_archived boolean:=coalesce((p_values->>'archived')::boolean,false);
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR length(coalesce(p_values->>'address',''))>1000 OR length(coalesce(p_values->>'notes',''))>2000 OR length(coalesce(p_values->>'map_url',''))>2000 THEN RAISE EXCEPTION 'Enter valid venue details';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_values->>'timezone') THEN RAISE EXCEPTION 'Invalid venue timezone';END IF;
 IF nullif(p_values->>'map_url','') IS NOT NULL AND p_values->>'map_url' !~ '^https://[^ /]+' THEN RAISE EXCEPTION 'Map link must use HTTPS';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF v_id IS NOT NULL THEN
 PERFORM 1 FROM public.event_locations WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Venue not found';END IF;
 IF v_archived AND EXISTS(SELECT 1 FROM public.event_sessions WHERE location_id=v_id AND is_active) THEN RAISE EXCEPTION 'Move or deactivate linked sessions before archiving this venue';END IF;
 ELSE INSERT INTO public.event_locations(name) VALUES(btrim(p_values->>'name')) RETURNING id INTO v_id;END IF;
 UPDATE public.event_locations SET name=btrim(p_values->>'name'),address=nullif(btrim(p_values->>'address'),''),map_url=nullif(btrim(p_values->>'map_url'),''),notes=nullif(btrim(p_values->>'notes'),''),timezone=p_values->>'timezone',country_code=nullif(upper(btrim(p_values->>'country_code')),''),archived_at=CASE WHEN v_archived THEN coalesce(archived_at,now()) ELSE NULL END WHERE id=v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.admin_save_session(p_id uuid,p_values jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;s public.event_sessions%ROWTYPE;v_location uuid:=nullif(p_values->>'location_id','')::uuid;v_start timestamptz:=nullif(p_values->>'starts_at','')::timestamptz;v_end timestamptz:=nullif(p_values->>'ends_at','')::timestamptz;v_rsvp boolean:=coalesce((p_values->>'requires_rsvp')::boolean,true);v_active boolean:=coalesce((p_values->>'is_active')::boolean,true);
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR p_values->>'session_key' IS NULL OR p_values->>'session_key' !~ '^[a-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'Enter a session name and valid key';END IF;
 IF v_end IS NOT NULL AND (v_start IS NULL OR v_end<=v_start) THEN RAISE EXCEPTION 'End must follow start';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 -- Same household locks as submission and membership changes; eligibility cannot race RSVP.
 PERFORM 1 FROM public.households ORDER BY id FOR UPDATE;
 IF v_location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=v_location AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active venue';END IF;
 IF v_id IS NOT NULL THEN
 SELECT * INTO s FROM public.event_sessions WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Session not found';END IF;
 IF (s.requires_rsvp<>v_rsvp OR s.is_active<>v_active) AND (EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE session_id=v_id) OR EXISTS(SELECT 1 FROM public.guest_session_responses WHERE session_id=v_id) OR EXISTS(SELECT 1 FROM public.rsvp_submissions r JOIN public.guests g ON g.household_id=r.household_id LEFT JOIN public.household_session_defaults d ON d.household_id=r.household_id AND d.session_id=v_id LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=v_id WHERE coalesce(o.is_invited,d.is_invited,false))) THEN RAISE EXCEPTION 'Session eligibility is protected by RSVP history; scheduling details can still be edited';END IF;
 ELSE INSERT INTO public.event_sessions(session_key,name) VALUES(p_values->>'session_key',btrim(p_values->>'name')) RETURNING id INTO v_id;END IF;
 UPDATE public.event_sessions SET session_key=p_values->>'session_key',name=btrim(p_values->>'name'),location_id=v_location,starts_at=v_start,ends_at=v_end,requires_rsvp=v_rsvp,is_active=v_active,sort_order=coalesce((p_values->>'sort_order')::integer,sort_order) WHERE id=v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.admin_save_session_assignments(p_household_id uuid,p_assignments jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;x jsonb;sid uuid;gid uuid;v boolean;b boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_assignments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_assignments)>2000 THEN RAISE EXCEPTION 'Invalid session assignments';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Active household required';END IF;
 IF h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=h.id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE household_id=h.id) THEN RAISE EXCEPTION 'Invitation changes are blocked by RSVP history';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_assignments) e GROUP BY e->>'session_id',coalesce(e->>'guest_id','') HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate session assignment';END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP
 sid:=(x->>'session_id')::uuid;gid:=nullif(x->>'guest_id','')::uuid;
 IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT x ? 'is_invited' OR (jsonb_typeof(x->'is_invited') NOT IN ('boolean','null')) THEN RAISE EXCEPTION 'Invalid invitation value';END IF;
 v:=(x->>'is_invited')::boolean;
 IF NOT EXISTS(SELECT 1 FROM public.event_sessions WHERE id=sid) THEN RAISE EXCEPTION 'Session not found';END IF;
 IF gid IS NULL THEN
 IF v IS NULL THEN RAISE EXCEPTION 'Household invitation must be yes or no';END IF;
 SELECT is_invited INTO b FROM public.household_session_defaults WHERE household_id=h.id AND session_id=sid;
 INSERT INTO public.household_session_defaults VALUES(h.id,sid,v) ON CONFLICT(household_id,session_id) DO UPDATE SET is_invited=excluded.is_invited;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM public.guests WHERE id=gid AND household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Guest must belong to this household';END IF;
 SELECT is_invited INTO b FROM public.guest_session_overrides WHERE guest_id=gid AND session_id=sid;
 IF v IS NULL THEN DELETE FROM public.guest_session_overrides WHERE guest_id=gid AND session_id=sid;
 ELSE INSERT INTO public.guest_session_overrides VALUES(gid,sid,v) ON CONFLICT(guest_id,session_id) DO UPDATE SET is_invited=excluded.is_invited;END IF;
 END IF;
 IF b IS DISTINCT FROM v THEN INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value) VALUES(h.id,'session_invitations',coalesce(gid,h.id),auth.uid(),'assign',jsonb_build_object('session_id',sid,'guest_id',gid,'is_invited',b),jsonb_build_object('session_id',sid,'guest_id',gid,'is_invited',v));END IF;
 END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE ON public.event_locations,public.event_sessions,public.household_session_defaults,public.guest_session_overrides FROM authenticated;
REVOKE ALL ON FUNCTION public.admin_save_venue(uuid,jsonb),public.admin_save_session(uuid,jsonb),public.admin_save_session_assignments(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_venue(uuid,jsonb),public.admin_save_session(uuid,jsonb),public.admin_save_session_assignments(uuid,jsonb) TO authenticated;
COMMIT;
