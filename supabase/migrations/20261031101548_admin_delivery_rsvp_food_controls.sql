-- Audited manual delivery tracking, RSVP administration and food permissions.
BEGIN;
ALTER TABLE public.invitation_send_queue ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE public.invitation_send_queue ADD COLUMN recipient_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.invitation_send_queue ADD COLUMN invitation_code_snapshot text;
UPDATE public.invitation_send_queue q SET invitation_code_snapshot=h.invite_code FROM public.households h WHERE h.id=q.household_id;
REVOKE INSERT,UPDATE,DELETE ON public.invitation_send_queue FROM authenticated;

CREATE FUNCTION public.admin_save_delivery(p_id uuid,p_household_id uuid,p_values jsonb,p_expected_revision integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;q public.invitation_send_queue%ROWTYPE;c public.household_contacts%ROWTYPE;cid uuid:=nullif(p_values->>'contact_id','')::uuid;v_id uuid:=p_id;v_status text:=p_values->>'status';recipient jsonb;destination text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF v_status IS NULL OR v_status NOT IN ('draft','ready','cancelled','failed') OR p_values->>'channel' IS NULL OR p_values->>'channel' NOT IN ('email','whatsapp','sms','postal','manual') OR nullif(btrim(p_values->>'message_body'),'') IS NULL OR length(p_values->>'message_body')>10000 OR length(coalesce(p_values->>'message_subject',''))>300 OR length(coalesce(p_values->>'reason',''))>2000 THEN RAISE EXCEPTION 'Enter valid delivery details';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Household not found';END IF;
 IF p_id IS NOT NULL THEN SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_id AND household_id=h.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
 IF p_expected_revision IS DISTINCT FROM q.revision THEN RAISE EXCEPTION 'Delivery changed; refresh and try again';END IF;
 IF q.status IN ('sent','cancelled') THEN RAISE EXCEPTION 'Sent and cancelled deliveries are read-only; create a new delivery';END IF;
 END IF;
 IF v_status IN ('cancelled','failed') THEN
 IF p_id IS NULL OR nullif(btrim(p_values->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Existing delivery and reason required';END IF;
 -- Preserve the prepared recipient/message when recording a failed or cancelled attempt.
 UPDATE public.invitation_send_queue SET status=v_status,revision=revision+1,updated_at=clock_timestamp() WHERE id=p_id;
 ELSE
 IF h.archived_at IS NOT NULL OR h.invite_code IS NULL OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Active household with guests required';END IF;
 IF cid IS NOT NULL THEN
 SELECT * INTO c FROM public.household_contacts WHERE id=cid AND household_id=h.id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active contact from this household';END IF;
 IF (p_values->>'channel'='email' AND c.contact_type<>'email') OR (p_values->>'channel' IN ('sms','whatsapp') AND c.contact_type<>'phone') OR (p_values->>'channel'='postal' AND c.contact_type<>'postal') THEN RAISE EXCEPTION 'Contact type does not match delivery channel';END IF;
 destination:=c.contact_value;
 recipient:=jsonb_build_object('contact_name',c.contact_name,'contact_type',c.contact_type,'contact_value',destination);
 ELSE
 destination:=CASE p_values->>'channel' WHEN 'email' THEN h.email WHEN 'sms' THEN h.phone WHEN 'whatsapp' THEN h.whatsapp WHEN 'postal' THEN h.postal_address ELSE h.household_name END;
 recipient:=jsonb_build_object('contact_name',h.household_name,'contact_type',p_values->>'channel','contact_value',destination);
 END IF;
 IF v_status='ready' AND nullif(btrim(destination),'') IS NULL THEN RAISE EXCEPTION 'Recipient details required before marking ready';END IF;
 IF p_id IS NULL THEN INSERT INTO public.invitation_send_queue(household_id,channel,message_body,created_by) VALUES(h.id,p_values->>'channel',p_values->>'message_body',auth.uid()) RETURNING id INTO v_id;END IF;
 UPDATE public.invitation_send_queue SET contact_id=cid,channel=p_values->>'channel',message_subject=nullif(btrim(p_values->>'message_subject'),''),message_body=p_values->>'message_body',status=v_status,recipient_snapshot=recipient,invitation_code_snapshot=h.invite_code,revision=CASE WHEN p_id IS NULL THEN 1 ELSE revision+1 END,updated_at=clock_timestamp() WHERE id=v_id;
 END IF;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value,reason) SELECT v_id,auth.uid(),CASE WHEN p_id IS NULL THEN 'created' ELSE v_status END,CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(q)-'invitation_code_snapshot' END,to_jsonb(n)-'invitation_code_snapshot',nullif(btrim(p_values->>'reason'),'') FROM public.invitation_send_queue n WHERE n.id=v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_confirm_invitation_sent(p_queue_id uuid,p_note text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.invitation_send_queue%ROWTYPE;h public.households%ROWTYPE;hid uuid;v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'Delivery note is too long';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT household_id INTO hid FROM public.invitation_send_queue WHERE id=p_queue_id;
 SELECT * INTO h FROM public.households WHERE id=hid FOR UPDATE;
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
 IF q.status='sent' THEN SELECT id INTO v_id FROM public.invitation_deliveries WHERE queue_id=q.id;RETURN v_id;END IF;
 IF q.status<>'ready' THEN RAISE EXCEPTION 'Queue item must be ready';END IF;
 IF h.archived_at IS NOT NULL OR h.invite_code IS NULL OR q.invitation_code_snapshot IS DISTINCT FROM h.invite_code THEN RAISE EXCEPTION 'Invitation has changed; prepare the delivery again';END IF;
 IF nullif(btrim(q.recipient_snapshot->>'contact_value'),'') IS NULL THEN RAISE EXCEPTION 'Recipient details required; prepare the delivery again';END IF;
 INSERT INTO public.invitation_deliveries(queue_id,confirmed_by,recipient_snapshot,message_snapshot,delivery_note) VALUES(q.id,auth.uid(),q.recipient_snapshot,jsonb_build_object('channel',q.channel,'subject',q.message_subject,'body',q.message_body),nullif(btrim(p_note),'')) RETURNING id INTO v_id;
 UPDATE public.invitation_send_queue SET status='sent',revision=revision+1,updated_at=clock_timestamp() WHERE id=q.id;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value,reason) VALUES(q.id,auth.uid(),'confirmed_sent',jsonb_build_object('status','ready'),jsonb_build_object('status','sent','delivery_id',v_id),nullif(btrim(p_note),''));
 RETURN v_id;
END $$;
CREATE FUNCTION public.admin_record_delivery_sent(p_queue_id uuid,p_expected_revision integer,p_note text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.invitation_send_queue%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
 IF q.status<>'sent' AND q.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Delivery changed; refresh and try again';END IF;
 RETURN public.admin_confirm_invitation_sent(p_queue_id,p_note);
END $$;
REVOKE ALL ON FUNCTION public.admin_confirm_invitation_sent(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_set_food_access(p_household_id uuid,p_enabled boolean,p_expected boolean,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Food access and reason required';END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Active household required';END IF;
 IF h.food IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Food access changed; refresh and try again';END IF;
 IF h.food=p_enabled THEN RETURN;END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Add a guest before enabling food access';END IF;
 IF NOT p_enabled AND (h.food_confirmed OR EXISTS(SELECT 1 FROM public.food_claims WHERE household_id=h.id)) THEN RAISE EXCEPTION 'Food commitments exist; access cannot be disabled';END IF;
 UPDATE public.households SET food=p_enabled WHERE id=h.id;
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value) VALUES(h.id,'food_access',h.id,auth.uid(),'permission_change',jsonb_build_object('enabled',h.food),jsonb_build_object('enabled',p_enabled,'reason',btrim(p_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.admin_reopen_household_rsvp(p_household_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Reason required (maximum 2000 characters)';END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR h.rsvp_state<>'locked' THEN RAISE EXCEPTION 'Active locked household required';END IF;
 UPDATE public.households SET rsvp_state='open',late_submission_until=NULL WHERE id=h.id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason) VALUES(h.id,auth.uid(),'reopened',h.latest_rsvp_submission_id,btrim(p_reason));
END $$;
CREATE OR REPLACE FUNCTION public.admin_authorize_late_rsvp(p_household_id uuid,p_until timestamptz,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 OR p_until IS NULL OR NOT isfinite(p_until) OR p_until<=clock_timestamp() THEN RAISE EXCEPTION 'Valid future expiry and reason required';END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR h.rsvp_state<>'open' THEN RAISE EXCEPTION 'Active open household required';END IF;
 UPDATE public.households SET late_submission_until=p_until WHERE id=h.id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason) VALUES(h.id,auth.uid(),'late_submission_authorized',h.latest_rsvp_submission_id,btrim(p_reason));
END $$;
CREATE OR REPLACE FUNCTION public.admin_correct_rsvp(p_guest_id uuid,p_session_id uuid,p_status text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE hid uuid;v_old text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_status IS NULL OR p_status NOT IN ('attending','declined') OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Valid response and reason required';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT household_id INTO hid FROM public.guests WHERE id=p_guest_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active guest required';END IF;
 PERFORM 1 FROM public.households WHERE id=hid AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.effective_session_invitations WHERE guest_id=p_guest_id AND session_id=p_session_id AND requires_rsvp) THEN RAISE EXCEPTION 'Guest is not invited to this RSVP session';END IF;
 SELECT rsvp_status INTO v_old FROM public.guest_session_responses WHERE guest_id=p_guest_id AND session_id=p_session_id;
 IF v_old=p_status THEN RETURN;END IF;
 INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status) VALUES(p_guest_id,p_session_id,p_status) ON CONFLICT(guest_id,session_id) DO UPDATE SET rsvp_status=excluded.rsvp_status,updated_at=clock_timestamp();
 INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,actor_user_id,action,previous_status,new_status,reason) VALUES(hid,p_guest_id,p_session_id,auth.uid(),'admin_correction',v_old,p_status,btrim(p_reason));
END $$;
REVOKE ALL ON FUNCTION public.admin_save_delivery(uuid,uuid,jsonb,integer),public.admin_record_delivery_sent(uuid,integer,text),public.admin_set_food_access(uuid,boolean,boolean,text),public.admin_reopen_household_rsvp(uuid,text),public.admin_authorize_late_rsvp(uuid,timestamptz,text),public.admin_correct_rsvp(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_delivery(uuid,uuid,jsonb,integer),public.admin_record_delivery_sent(uuid,integer,text),public.admin_set_food_access(uuid,boolean,boolean,text),public.admin_reopen_household_rsvp(uuid,text),public.admin_authorize_late_rsvp(uuid,timestamptz,text),public.admin_correct_rsvp(uuid,uuid,text,text) TO authenticated;
COMMIT;
