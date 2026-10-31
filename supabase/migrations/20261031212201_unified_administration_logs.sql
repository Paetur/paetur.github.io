BEGIN;
CREATE TABLE public.invitation_access_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,household_id uuid NOT NULL REFERENCES public.households(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX invitation_access_time ON public.invitation_access_audit(household_id,created_at DESC);
CREATE TABLE public.admin_session_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_user_id uuid NOT NULL REFERENCES auth.users(id),session_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('login','logout_requested')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(session_id,action));
ALTER TABLE public.invitation_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_session_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invitation_access_audit,public.admin_session_audit FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_invitation_access BEFORE UPDATE OR DELETE ON public.invitation_access_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_admin_session BEFORE UPDATE OR DELETE ON public.admin_session_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE FUNCTION public.record_invitation_open(p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 SELECT * INTO h FROM public.households WHERE invite_code=p_code FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RETURN;END IF;
 -- Coalesce repeated loads from the same household into one opening every 15 minutes.
 IF NOT EXISTS(SELECT 1 FROM public.invitation_access_audit WHERE household_id=h.id AND created_at>clock_timestamp()-interval '15 minutes') THEN INSERT INTO public.invitation_access_audit(household_id) VALUES(h.id);END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_invitation_open(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_invitation_open(text) TO service_role;
CREATE FUNCTION public.admin_record_session(p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;started timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN ('login','logout_requested') THEN RAISE EXCEPTION 'Invalid session action';END IF;
 sid:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid;
 SELECT created_at INTO started FROM auth.sessions WHERE id=sid AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified sign-in session required';END IF;
 INSERT INTO public.admin_session_audit(actor_user_id,session_id,action,created_at) VALUES(auth.uid(),sid,p_action,CASE WHEN p_action='login' THEN started ELSE clock_timestamp() END) ON CONFLICT(session_id,action) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.admin_record_session(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_session(text) TO authenticated;

CREATE VIEW app_private.administration_log_entries AS
SELECT 'management:'||m.id::text event_key,m.created_at occurred_at,
 CASE m.entity_type WHEN 'households' THEN 'households' WHEN 'guests' THEN 'guests' WHEN 'household_contacts' THEN 'contacts' WHEN 'food_access' THEN 'food' WHEN 'session_invitations' THEN 'rsvp' ELSE 'households' END category,
 CASE WHEN m.entity_type='session_invitations' THEN 'invitations_changed' WHEN m.action='insert' THEN 'add' WHEN m.action='delete' THEN 'delete' WHEN m.action='update' AND m.before_value->>'archived_at' IS DISTINCT FROM m.after_value->>'archived_at' THEN CASE WHEN m.after_value->>'archived_at' IS NULL THEN 'restore' ELSE 'archive' END WHEN m.action IN ('update','permission_change') THEN 'update' ELSE m.action END action,
 m.household_id,m.actor_user_id,
 coalesce(nullif(concat_ws(' ',m.after_value->>'first_name',m.after_value->>'last_name'),''),m.after_value->>'contact_name',m.after_value->>'household_name',m.entity_type) subject,
 jsonb_build_object('entity',m.entity_type,'before',m.before_value,'after',m.after_value) details
FROM public.management_audit m
UNION ALL SELECT 'rsvp-household:'||r.id,r.created_at,'rsvp',r.action,r.household_id,r.actor_user_id,'Household RSVP',jsonb_build_object('reason',r.reason,'submission_id',r.submission_id) FROM public.rsvp_household_audit r
UNION ALL SELECT 'rsvp-response:'||r.id,r.created_at,'rsvp',CASE r.action WHEN 'submission' THEN 'response_submitted' ELSE 'response_corrected' END,r.household_id,r.actor_user_id,concat_ws(' ',g.first_name,g.last_name),jsonb_build_object('session',s.name,'before',r.previous_status,'after',r.new_status,'reason',r.reason) FROM public.rsvp_response_audit r LEFT JOIN public.guests g ON g.id=r.guest_id LEFT JOIN public.event_sessions s ON s.id=r.session_id
UNION ALL SELECT 'delivery:'||a.id,a.created_at,'invitations',CASE a.action WHEN 'confirmed_sent' THEN 'sent' ELSE a.action END,q.household_id,a.actor_user_id,'Invitation delivery',jsonb_build_object('channel',q.channel,'reason',a.reason,'before_status',a.previous_value->>'status','after_status',a.new_value->>'status') FROM public.invitation_delivery_audit a JOIN public.invitation_send_queue q ON q.id=a.queue_id
UNION ALL SELECT 'opened:'||a.id,a.created_at,'invitations','opened',a.household_id,NULL::uuid,'Invitation opened',jsonb_build_object('recording','Successful invitation load; repeated loads within 15 minutes are grouped') FROM public.invitation_access_audit a
UNION ALL SELECT 'configuration:'||a.id,a.created_at,CASE a.entity_type WHEN 'event_locations' THEN 'venues' ELSE 'sessions' END,CASE WHEN a.before_value IS NULL THEN 'add' WHEN a.before_value->>'archived_at' IS DISTINCT FROM a.after_value->>'archived_at' THEN CASE WHEN a.after_value->>'archived_at' IS NULL THEN 'restore' ELSE 'archive' END ELSE 'update' END,NULL::uuid,a.actor_user_id,coalesce(a.after_value->>'name',a.entity_type),jsonb_build_object('before',a.before_value,'after',a.after_value) FROM public.event_configuration_audit a
UNION ALL SELECT 'membership:'||a.id,a.created_at,'administrators',a.action,NULL::uuid,a.actor_id,coalesce(a.details->>'name','Administrator access'),jsonb_build_object('subject_id',a.subject_id,'details',a.details) FROM public.admin_membership_audit a
UNION ALL SELECT 'app-session:'||a.id,a.created_at,'login',a.action,NULL::uuid,a.actor_user_id,'Administrator session',jsonb_build_object('source','Verified app session') FROM public.admin_session_audit a
UNION ALL SELECT 'auth:'||a.id,a.created_at,'login',coalesce(a.payload->>'action','auth_event'),NULL::uuid,u.id,'Authentication',jsonb_build_object('source','Auth service','provider',a.payload->>'provider') FROM auth.audit_log_entries a LEFT JOIN auth.users u ON u.id::text=a.payload->>'actor_id' WHERE a.created_at IS NOT NULL;
REVOKE ALL ON app_private.administration_log_entries FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_query_logs(p_search text DEFAULT '',p_category text DEFAULT '',p_action text DEFAULT '',p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_before_at timestamptz DEFAULT NULL,p_before_key text DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR length(coalesce(p_search,''))>200 OR length(coalesce(p_action,''))>80 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>=p_to) OR ((p_before_at IS NULL)<>(p_before_key IS NULL)) THEN RAISE EXCEPTION 'Invalid log filters';END IF;
 IF coalesce(p_category,'') NOT IN ('','households','guests','contacts','rsvp','invitations','login','venues','sessions','food','administrators') THEN RAISE EXCEPTION 'Invalid log category';END IF;
 WITH filtered AS (
 SELECT e.*,h.household_name,coalesce(a.name,u.email,CASE WHEN e.category='invitations' AND e.action='opened' THEN 'Guest' WHEN e.actor_user_id IS NULL THEN 'Guest / system' ELSE 'Administrator' END) actor
 FROM app_private.administration_log_entries e LEFT JOIN public.households h ON h.id=e.household_id LEFT JOIN public.admins a ON a.user_id=e.actor_user_id LEFT JOIN auth.users u ON u.id=e.actor_user_id
 WHERE (coalesce(p_category,'')='' OR e.category=p_category) AND (coalesce(p_action,'')='' OR e.action=p_action) AND (p_from IS NULL OR e.occurred_at>=p_from) AND (p_to IS NULL OR e.occurred_at<p_to)
 AND (p_before_at IS NULL OR (e.occurred_at,e.event_key)<(p_before_at,p_before_key))
 AND (coalesce(btrim(p_search),'')='' OR position(lower(btrim(p_search)) in lower(concat_ws(' ',e.subject,h.household_name,a.name,u.email,e.category,e.action,e.details::text)))>0)
 ORDER BY e.occurred_at DESC,e.event_key DESC LIMIT p_limit+1
 ), numbered AS (SELECT *,row_number() over(ORDER BY occurred_at DESC,event_key DESC) n FROM filtered)
 SELECT jsonb_build_object('entries',coalesce(jsonb_agg(to_jsonb(numbered)-'n' ORDER BY occurred_at DESC,event_key DESC) FILTER(WHERE n<=p_limit),'[]'::jsonb),'has_more',count(*)>p_limit) INTO result FROM numbered;
 result:=result||jsonb_build_object('actions',(SELECT coalesce(jsonb_agg(action ORDER BY action),'[]'::jsonb) FROM (SELECT DISTINCT action FROM app_private.administration_log_entries WHERE coalesce(p_category,'')='' OR category=p_category) a));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_query_logs(text,text,text,timestamptz,timestamptz,timestamptz,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_query_logs(text,text,text,timestamptz,timestamptz,timestamptz,text,integer) TO authenticated;
CREATE INDEX rsvp_household_log_time ON public.rsvp_household_audit(created_at DESC,id DESC);
CREATE INDEX rsvp_response_log_time ON public.rsvp_response_audit(created_at DESC,id DESC);
CREATE INDEX invitation_delivery_log_time ON public.invitation_delivery_audit(created_at DESC,id DESC);
CREATE INDEX admin_membership_log_time ON public.admin_membership_audit(created_at DESC,id DESC);
CREATE INDEX management_audit_log_time ON public.management_audit(created_at DESC,id DESC);
CREATE INDEX event_configuration_audit_log_time ON public.event_configuration_audit(created_at DESC,id DESC);
CREATE INDEX admin_session_log_time ON public.admin_session_audit(created_at DESC,id DESC);
CREATE INDEX invitation_access_log_time ON public.invitation_access_audit(created_at DESC,id DESC);
CREATE FUNCTION public.get_invitation_logged(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invitation jsonb;
BEGIN
 invitation:=public.get_invitation_v2(p_code);
 IF invitation IS NOT NULL THEN PERFORM public.record_invitation_open(p_code);END IF;
 RETURN invitation;
END $$;
REVOKE ALL ON FUNCTION public.get_invitation_logged(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_logged(text) TO service_role;

COMMIT;
