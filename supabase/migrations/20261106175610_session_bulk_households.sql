BEGIN;

CREATE FUNCTION public.admin_session_invitation_locks()
 RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 RETURN ARRAY(
  SELECT h.id FROM public.households h
  WHERE h.archived_at IS NULL AND (
   h.rsvp_state<>'open'
   OR EXISTS(SELECT 1 FROM public.rsvp_submissions r WHERE r.household_id=h.id)
   OR EXISTS(SELECT 1 FROM public.rsvp_response_audit r WHERE r.household_id=h.id)
  )
 );
END $$;

CREATE FUNCTION public.admin_edit_session_households(p_session_id uuid,p_add uuid[],p_remove uuid[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_household_id uuid;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_add IS NULL OR p_remove IS NULL OR cardinality(p_add)+cardinality(p_remove)>2000
    OR array_position(p_add,NULL) IS NOT NULL OR array_position(p_remove,NULL) IS NOT NULL
    OR p_add && p_remove THEN RAISE EXCEPTION 'Invalid household selections'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.event_sessions WHERE id=p_session_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
 FOR v_household_id IN SELECT DISTINCT id FROM unnest(p_add||p_remove) AS selected(id) ORDER BY id LOOP
  IF NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=v_household_id AND g.archived_at IS NULL)
  THEN RAISE EXCEPTION 'Household must have an active guest'; END IF;
  PERFORM public.admin_save_session_assignments(v_household_id,jsonb_build_array(jsonb_build_object(
   'session_id',p_session_id,'is_invited',v_household_id=ANY(p_add))));
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_session_invitation_locks(),public.admin_edit_session_households(uuid,uuid[],uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_session_invitation_locks(),public.admin_edit_session_households(uuid,uuid[],uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
