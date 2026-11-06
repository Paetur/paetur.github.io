BEGIN;

CREATE FUNCTION public.admin_move_language(p_code text,p_direction integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order text[]; v_position integer; v_target integer;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(language_code ORDER BY sort_order,language_code) INTO v_order FROM public.event_languages;
 v_position:=array_position(v_order,p_code);
 IF v_position IS NULL THEN RAISE EXCEPTION 'Language not found'; END IF;
 v_target:=v_position+p_direction;
 IF v_target<1 OR v_target>cardinality(v_order) THEN RETURN; END IF;
 v_order[v_position]:=v_order[v_target];
 v_order[v_target]:=p_code;
 UPDATE public.event_languages AS language SET sort_order=ordered.ordinality::integer
 FROM unnest(v_order) WITH ORDINALITY AS ordered(code,ordinality)
 WHERE language.language_code=ordered.code AND language.sort_order IS DISTINCT FROM ordered.ordinality::integer;
END $$;
REVOKE ALL ON FUNCTION public.admin_move_language(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_language(text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
