-- 014: Restore administrator guest editing inside the expandable household tree.
-- Only profile fields are editable; RSVP status, household ownership, and submission locks are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_guest(
  p_guest_id uuid,
  p_first_name text,
  p_last_name text,
  p_courtesy_title text,
  p_relation text,
  p_language text,
  p_is_child boolean,
  p_dietary_requirements text,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_first text := NULLIF(pg_catalog.btrim(p_first_name), '');
  v_last text := NULLIF(pg_catalog.btrim(p_last_name), '');
  v_title text := NULLIF(pg_catalog.btrim(p_courtesy_title), '');
  v_relation text := NULLIF(pg_catalog.btrim(p_relation), '');
  v_dietary text := NULLIF(pg_catalog.btrim(p_dietary_requirements), '');
  v_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_guest_id IS NULL OR v_first IS NULL OR pg_catalog.char_length(v_first)>120 THEN
    RAISE EXCEPTION 'A first name of at most 120 characters is required';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_last,''))>120 OR
     pg_catalog.char_length(COALESCE(v_relation,''))>160 OR
     pg_catalog.char_length(COALESCE(v_dietary,''))>1000 OR
     pg_catalog.char_length(COALESCE(v_notes,''))>2000 THEN
    RAISE EXCEPTION 'Guest field exceeds maximum length';
  END IF;
  IF v_title IS NOT NULL AND v_title NOT IN ('Mr.','Ms.','Son','Daughter') THEN
    RAISE EXCEPTION 'Invalid courtesy title';
  END IF;
  IF p_language IS NOT NULL AND p_language NOT IN ('fo','en','de') THEN
    RAISE EXCEPTION 'Invalid guest language';
  END IF;
  IF p_is_child IS NULL THEN
    RAISE EXCEPTION 'Guest child flag is required';
  END IF;

  UPDATE public.guests
  SET first_name=v_first, last_name=v_last,
      courtesy_title=v_title, relation=v_relation,
      language=p_language, is_child=p_is_child,
      dietary_requirements=v_dietary, notes=v_notes,
      updated_at=pg_catalog.now()
  WHERE id=p_guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest not found';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_update_guest(uuid,text,text,text,text,text,boolean,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_guest(uuid,text,text,text,text,text,boolean,text,text)
  TO authenticated;
COMMIT;
