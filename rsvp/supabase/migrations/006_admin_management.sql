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
