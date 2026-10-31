BEGIN;
ALTER TABLE public.household_contacts ADD COLUMN guest_id uuid REFERENCES public.guests(id) ON DELETE RESTRICT;
CREATE INDEX household_contact_guest ON public.household_contacts(guest_id) WHERE guest_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.admin_save_contact(p_id uuid,p_household_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;linked_guest uuid;existing_guest uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household required'; END IF;
 IF nullif(btrim(p_values->>'contact_value'),'') IS NULL OR length(p_values->>'contact_value')>1000 OR length(coalesce(p_values->>'contact_name',''))>140 THEN RAISE EXCEPTION 'Enter valid contact details'; END IF;
 IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.household_contacts WHERE id=p_id AND household_id=p_household_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Active contact not found'; END IF;
 IF p_id IS NOT NULL THEN SELECT guest_id INTO existing_guest FROM public.household_contacts WHERE id=p_id;END IF;
 linked_guest:=CASE WHEN p_values ? 'guest_id' THEN nullif(p_values->>'guest_id','')::uuid ELSE existing_guest END;
 IF linked_guest IS NOT NULL AND (p_id IS NULL OR linked_guest IS DISTINCT FROM existing_guest) AND NOT EXISTS(SELECT 1 FROM public.guests g JOIN public.households h ON h.id=g.household_id WHERE g.id=linked_guest AND g.archived_at IS NULL AND h.archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active guest from an active household';END IF;
 IF coalesce((p_values->>'is_primary')::boolean,false) THEN UPDATE public.household_contacts SET is_primary=false,updated_at=now() WHERE household_id=p_household_id AND contact_type=p_values->>'contact_type' AND is_primary; END IF;
 IF v_id IS NULL THEN
 INSERT INTO public.household_contacts(household_id,contact_type,contact_value) VALUES(p_household_id,p_values->>'contact_type',btrim(p_values->>'contact_value')) RETURNING id INTO v_id;
 END IF;
 UPDATE public.household_contacts SET guest_id=linked_guest,contact_name=nullif(btrim(p_values->>'contact_name'),''),contact_type=p_values->>'contact_type',contact_value=btrim(p_values->>'contact_value'),language_code=nullif(p_values->>'language_code',''),preferred_method=nullif(p_values->>'preferred_method',''),is_primary=coalesce((p_values->>'is_primary')::boolean,false),updated_at=now() WHERE id=v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_contact(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_contact(uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
