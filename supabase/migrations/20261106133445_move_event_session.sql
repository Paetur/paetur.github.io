BEGIN;

CREATE FUNCTION public.admin_move_session(p_session_id uuid,p_direction integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order uuid[]; v_position integer; v_target integer;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO v_order FROM public.event_sessions;
 v_position:=array_position(v_order,p_session_id);
 IF v_position IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
 v_target:=v_position+p_direction;
 IF v_target<1 OR v_target>cardinality(v_order) THEN RETURN; END IF;
 v_order[v_position]:=v_order[v_target];
 v_order[v_target]:=p_session_id;
 UPDATE public.event_sessions AS session SET sort_order=ordered.ordinality::integer
 FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality)
 WHERE session.id=ordered.id AND session.sort_order IS DISTINCT FROM ordered.ordinality::integer;
END $$;
REVOKE ALL ON FUNCTION public.admin_move_session(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_session(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_session(p_id uuid,p_values jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 ELSE
 INSERT INTO public.event_sessions(session_key,name,sort_order)
 SELECT p_values->>'session_key',btrim(p_values->>'name'),coalesce(max(sort_order),0)+1 FROM public.event_sessions
 RETURNING id INTO v_id;
 END IF;
 UPDATE public.event_sessions SET session_key=p_values->>'session_key',name=btrim(p_values->>'name'),location_id=v_location,starts_at=v_start,ends_at=v_end,requires_rsvp=v_rsvp,is_active=v_active,sort_order=coalesce((p_values->>'sort_order')::integer,sort_order) WHERE id=v_id;
 RETURN v_id;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
