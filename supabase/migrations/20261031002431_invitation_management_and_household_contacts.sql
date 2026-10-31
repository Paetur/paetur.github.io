-- Empty/group-only households have no invitation. Retired codes are never reassigned.
BEGIN;
ALTER TABLE public.households ALTER COLUMN invite_code DROP NOT NULL;
ALTER TABLE public.households ADD COLUMN whatsapp text;
ALTER TABLE public.households ADD COLUMN postal_address text;
ALTER TABLE public.households ADD COLUMN preferred_contact_method text CHECK(preferred_contact_method IN ('whatsapp','sms','email','postal','manual'));
CREATE TABLE app_private.invitation_code_registry(code text PRIMARY KEY,household_id uuid NOT NULL REFERENCES public.households(id),created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON app_private.invitation_code_registry FROM PUBLIC,anon,authenticated;
ALTER TABLE app_private.invitation_code_registry ENABLE ROW LEVEL SECURITY;
INSERT INTO app_private.invitation_code_registry(code,household_id) SELECT invite_code,id FROM public.households WHERE invite_code IS NOT NULL;
CREATE FUNCTION app_private.sync_invitation_code(p_household_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; code text; bytes bytea; i integer;
BEGIN
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN
   UPDATE public.households SET invite_code=NULL WHERE id=h.id AND invite_code IS NOT NULL;
 ELSIF h.invite_code IS NULL THEN
   LOOP
     bytes:=decode(md5(gen_random_uuid()::text),'hex');code:='';
     FOR i IN 0..7 LOOP code:=code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+get_byte(bytes,i)%32,1); END LOOP;
     INSERT INTO app_private.invitation_code_registry VALUES(code,h.id,now()) ON CONFLICT DO NOTHING;
     EXIT WHEN FOUND;
   END LOOP;
   UPDATE public.households SET invite_code=code WHERE id=h.id;
 END IF;
END $$;
CREATE FUNCTION app_private.sync_guest_invitation_codes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Lifecycle RPCs already lock households in UUID order. Cover trusted direct writes too.
 IF TG_OP='UPDATE' THEN
   PERFORM 1 FROM public.households WHERE id IN(OLD.household_id,NEW.household_id) ORDER BY id FOR UPDATE;
   IF OLD.household_id<>NEW.household_id THEN PERFORM app_private.sync_invitation_code(OLD.household_id); END IF;
 END IF;
 IF TG_OP='DELETE' THEN PERFORM app_private.sync_invitation_code(OLD.household_id);RETURN OLD; END IF;
 PERFORM app_private.sync_invitation_code(NEW.household_id);RETURN NEW;
END $$;
CREATE FUNCTION app_private.sync_archived_invitation_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM app_private.sync_invitation_code(NEW.id);RETURN NEW;END $$;
CREATE FUNCTION app_private.guard_empty_invitation_code() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.invite_code:=NULL;
 ELSIF NEW.invite_code IS NOT NULL AND (NEW.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=NEW.id AND archived_at IS NULL)) THEN NEW.invite_code:=NULL;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.sync_invitation_code(uuid),app_private.sync_guest_invitation_codes(),app_private.sync_archived_invitation_code(),app_private.guard_empty_invitation_code() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER invitation_code_membership AFTER INSERT OR DELETE OR UPDATE OF household_id,archived_at ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.sync_guest_invitation_codes();
CREATE TRIGGER invitation_code_archive AFTER UPDATE OF archived_at ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.sync_archived_invitation_code();
CREATE TRIGGER invitation_code_empty_guard BEFORE INSERT OR UPDATE OF invite_code ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_empty_invitation_code();
UPDATE public.households h SET invite_code=NULL WHERE archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL);
CREATE OR REPLACE FUNCTION public.admin_save_household(p_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; v_id uuid:=p_id; v_code text; bytes bytea; i integer; parent uuid:=nullif(p_values->>'parent_id','')::uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR nullif(btrim(p_values->>'household_name'),'') IS NULL OR length(p_values->>'household_name')>140 THEN RAISE EXCEPTION 'Household name is required (maximum 140 characters)'; END IF;
 IF length(coalesce(p_values->>'email',''))>320 OR length(coalesce(p_values->>'phone',''))>80 OR length(coalesce(p_values->>'notes',''))>2000 THEN RAISE EXCEPTION 'Household field too long'; END IF;
 IF length(coalesce(p_values->>'whatsapp',''))>80 OR length(coalesce(p_values->>'postal_address',''))>1000 THEN RAISE EXCEPTION 'Contact field too long'; END IF;
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
 v_code:=NULL;
 INSERT INTO public.households(household_name,side,language,relation_group_id,parent_id,email,phone,notes,invite_code)
 VALUES(btrim(p_values->>'household_name'),p_values->>'side',p_values->>'language',nullif(p_values->>'relation_group_id','')::uuid,parent,nullif(btrim(p_values->>'email'),''),nullif(btrim(p_values->>'phone'),''),nullif(btrim(p_values->>'notes'),''),v_code) RETURNING id INTO v_id;
 ELSE
 UPDATE public.households SET household_name=btrim(p_values->>'household_name'),side=p_values->>'side',language=p_values->>'language',relation_group_id=nullif(p_values->>'relation_group_id','')::uuid,parent_id=parent,email=nullif(btrim(p_values->>'email'),''),phone=nullif(btrim(p_values->>'phone'),''),notes=nullif(btrim(p_values->>'notes'),''),updated_at=now() WHERE id=v_id;
 END IF;
 UPDATE public.households SET whatsapp=nullif(btrim(p_values->>'whatsapp'),''),postal_address=nullif(btrim(p_values->>'postal_address'),''),preferred_contact_method=nullif(p_values->>'preferred_contact_method','') WHERE id=v_id;
 RETURN v_id;
END $$;

COMMIT;
