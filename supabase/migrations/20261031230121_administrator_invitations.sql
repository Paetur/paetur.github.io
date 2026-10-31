BEGIN;
CREATE TABLE public.admin_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 invited_by uuid NOT NULL REFERENCES auth.users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','cancelled')),
 delivery_state text NOT NULL DEFAULT 'sending' CHECK(delivery_state IN ('sending','sent','failed')),
 attempt_id uuid NOT NULL DEFAULT gen_random_uuid(), attempts integer NOT NULL DEFAULT 1,
 last_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), sent_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
 accepted_by uuid REFERENCES auth.users(id), accepted_at timestamptz,
 last_error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254)
);
CREATE TABLE public.admin_invitation_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invitation_id uuid NOT NULL REFERENCES public.admin_invitations(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id), action text NOT NULL,
 email text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_invitation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_invitations,public.admin_invitation_audit FROM PUBLIC,anon,authenticated;
CREATE INDEX admin_invitation_audit_time ON public.admin_invitation_audit(created_at DESC,id DESC);
CREATE INDEX admin_invitation_audit_invitation ON public.admin_invitation_audit(invitation_id);
CREATE INDEX admin_invitation_audit_actor ON public.admin_invitation_audit(actor_user_id);
CREATE INDEX admin_invitations_inviter ON public.admin_invitations(invited_by);
CREATE INDEX admin_invitations_acceptor ON public.admin_invitations(accepted_by);
CREATE TRIGGER immutable_admin_invitation_audit BEFORE UPDATE OR DELETE ON public.admin_invitation_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();

CREATE FUNCTION app_private.require_live_session() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 sid:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=sid AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Sign in again to manage administrator invitations' USING ERRCODE='42501';END IF;
 RETURN auth.uid();
END $$;
REVOKE ALL ON FUNCTION app_private.require_live_session() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_list_invitations() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'name',name,'status',status,'delivery_state',delivery_state,'attempts',attempts,'sent_at',sent_at,'expires_at',expires_at,'last_error_code',last_error_code,'created_at',created_at) ORDER BY created_at DESC),'[]'::jsonb) FROM public.admin_invitations WHERE status='pending');
END $$;

CREATE FUNCTION public.admin_prepare_invitation(p_email text,p_name text,p_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; e text:=lower(btrim(coalesce(p_email,''))); n text:=btrim(coalesce(p_name,'')); i public.admin_invitations%ROWTYPE; existing_confirmed boolean;
BEGIN
 actor:=app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(e)>254 OR length(n) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter a valid email and display name';END IF;
 -- Serialize reservations globally: enforce limits even for different emails.
 PERFORM pg_advisory_xact_lock(192837465);
 IF EXISTS(SELECT 1 FROM public.admins a JOIN auth.users u ON u.id=a.user_id WHERE lower(u.email)=e) THEN RAISE EXCEPTION 'This person is already an administrator';END IF;
 SELECT * INTO i FROM public.admin_invitations WHERE email=e FOR UPDATE;
 IF p_id IS NOT NULL AND (i.id IS NULL OR i.id<>p_id OR i.status<>'pending') THEN RAISE EXCEPTION 'Pending invitation not found';END IF;
 IF i.id IS NOT NULL AND i.status='pending' AND p_id IS NULL THEN RAISE EXCEPTION 'A pending invitation already exists. Use Resend or Cancel';END IF;
 IF i.id IS NOT NULL AND i.last_attempt_at>clock_timestamp()-interval '60 seconds' THEN RAISE EXCEPTION 'Wait one minute before sending again';END IF;
 IF i.status='pending' AND i.delivery_state='sending' AND i.last_attempt_at>clock_timestamp()-interval '2 minutes' THEN RAISE EXCEPTION 'An invitation email is already being sent';END IF;
 IF (SELECT count(*) FROM public.admin_invitation_audit WHERE action='email_requested' AND created_at>clock_timestamp()-interval '1 hour' AND actor_user_id=actor)>=10 OR (SELECT count(*) FROM public.admin_invitation_audit WHERE action='email_requested' AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'Invitation sending limit reached. Try again later';END IF;
 INSERT INTO public.admin_invitations(email,name,invited_by) VALUES(e,n,actor)
 ON CONFLICT(email) DO UPDATE SET name=n,invited_by=actor,status='pending',delivery_state='sending',attempt_id=gen_random_uuid(),attempts=public.admin_invitations.attempts+1,last_attempt_at=clock_timestamp(),expires_at=clock_timestamp()+interval '7 days',accepted_by=NULL,accepted_at=NULL,last_error_code=NULL,sent_at=NULL RETURNING * INTO i;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email,details) VALUES(i.id,actor,'email_requested',e,jsonb_build_object('name',n,'attempt',i.attempts));
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=e AND email_confirmed_at IS NOT NULL) INTO existing_confirmed;
 RETURN jsonb_build_object('id',i.id,'email',e,'attempt_id',i.attempt_id,'existing_confirmed',existing_confirmed);
END $$;

-- Only the Edge Function may report the email service result. The attempt ID
-- prevents late callbacks from overwriting a newer send, cancellation or acceptance.
CREATE FUNCTION public.admin_finish_invitation(p_id uuid,p_attempt_id uuid,p_sent boolean,p_error_code text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.admin_invitations%ROWTYPE;
BEGIN
 SELECT * INTO i FROM public.admin_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR i.attempt_id<>p_attempt_id OR i.status<>'pending' OR i.delivery_state<>'sending' THEN RETURN false;END IF;
 UPDATE public.admin_invitations SET delivery_state=CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,sent_at=CASE WHEN p_sent THEN clock_timestamp() ELSE NULL END,last_error_code=CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error_code,'email_failed'),80) END WHERE id=i.id;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email,details) VALUES(i.id,i.invited_by,CASE WHEN p_sent THEN 'email_sent' ELSE 'email_failed' END,i.email,jsonb_build_object('error_code',CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error_code,'email_failed'),80) END));
 RETURN true;
END $$;

CREATE FUNCTION public.admin_cancel_invitation(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; i public.admin_invitations%ROWTYPE;
BEGIN
 actor:=app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 SELECT * INTO i FROM public.admin_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR i.status<>'pending' THEN RAISE EXCEPTION 'Pending invitation not found';END IF;
 UPDATE public.admin_invitations SET status='cancelled' WHERE id=i.id;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email) VALUES(i.id,actor,'invitation_cancelled',i.email);
END $$;

CREATE FUNCTION public.admin_my_invitation() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e text;
BEGIN
 PERFORM app_private.require_live_session();
 SELECT lower(email) INTO e FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 RETURN (SELECT jsonb_build_object('id',i.id,'name',i.name,'email',i.email,'expires_at',i.expires_at,'needs_password',(SELECT coalesce(encrypted_password,'')='' FROM auth.users WHERE id=auth.uid())) FROM public.admin_invitations i WHERE i.email=e AND i.status='pending' AND i.delivery_state='sent' AND i.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by));
END $$;

CREATE FUNCTION public.admin_accept_invitation(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; e text; i public.admin_invitations%ROWTYPE;
BEGIN
 actor:=app_private.require_live_session();
 -- Serialize membership additions with the existing last-admin/revocation guard.
 PERFORM pg_advisory_xact_lock(42319,11);
 SELECT lower(email) INTO e FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL;
 SELECT * INTO i FROM public.admin_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR e IS NULL OR i.email<>e OR i.status<>'pending' OR i.delivery_state<>'sent' OR i.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by) THEN RAISE EXCEPTION 'No active invitation for this verified account' USING ERRCODE='42501';END IF;
 INSERT INTO public.admins(user_id,name) VALUES(actor,i.name) ON CONFLICT(user_id) DO NOTHING;
 IF FOUND THEN INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details) VALUES(i.invited_by,actor,'add',jsonb_build_object('name',i.name,'source','accepted_invitation'));END IF;
 UPDATE public.admin_invitations SET status='accepted',accepted_by=actor,accepted_at=clock_timestamp() WHERE id=i.id;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email) VALUES(i.id,actor,'invitation_accepted',e);
END $$;

REVOKE ALL ON FUNCTION public.admin_list_invitations(),public.admin_prepare_invitation(text,text,uuid),public.admin_finish_invitation(uuid,uuid,boolean,text),public.admin_cancel_invitation(uuid),public.admin_my_invitation(),public.admin_accept_invitation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_invitations(),public.admin_prepare_invitation(text,text,uuid),public.admin_cancel_invitation(uuid),public.admin_my_invitation(),public.admin_accept_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finish_invitation(uuid,uuid,boolean,text) TO service_role;
CREATE OR REPLACE VIEW app_private.administration_log_entries AS
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
UNION ALL SELECT 'auth:'||a.id,a.created_at,'login',coalesce(a.payload->>'action','auth_event'),NULL::uuid,u.id,'Authentication',jsonb_build_object('source','Auth service','provider',a.payload->>'provider') FROM auth.audit_log_entries a LEFT JOIN auth.users u ON u.id::text=a.payload->>'actor_id' WHERE a.created_at IS NOT NULL
UNION ALL SELECT 'admin-invitation:'||a.id,a.created_at,'administrators',a.action,NULL::uuid,a.actor_user_id,a.email,a.details FROM public.admin_invitation_audit a;

COMMIT;
