BEGIN;
-- Keep exports usable if backend migrations are approved in separate steps.
CREATE OR REPLACE FUNCTION public.admin_export_backup() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE payload jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='event_settings' AND column_name='fallback_language') THEN RAISE EXCEPTION 'Apply the language management migration before exporting a version 1 backup';END IF;
 payload:=app_private.backup_payload();
 IF octet_length(payload::text)>20000000 THEN RAISE EXCEPTION 'Application backup exceeds the 20 MB import limit; use managed database backup tools';END IF;
 RETURN jsonb_build_object('format','rsvp-application-backup','version',1,'payload',payload,'checksum',encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.admin_export_backup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_export_backup() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
