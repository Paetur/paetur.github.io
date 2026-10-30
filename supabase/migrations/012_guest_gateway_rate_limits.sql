-- Migration 012/013: restrict guest calls to the throttled Edge Function and create atomic counters.
-- The Edge Function uses a server-only service-role key; public browser code never receives it.
BEGIN;
CREATE TABLE IF NOT EXISTS public.guest_gateway_rate_limits (
  key_hash text NOT NULL,
  period_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  PRIMARY KEY(key_hash, period_start)
);
ALTER TABLE public.guest_gateway_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_gateway_rate_limits FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.guest_gateway_allow_request(p_ip_hash text, p_code text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_period timestamptz;v_limit integer;v_key text;v_ok boolean;v_code text:=upper(coalesce(p_code,''));v_n integer;
BEGIN
 IF p_ip_hash !~ '^[a-f0-9]{64}$'
 OR p_action NOT IN ('get_invitation_v2','get_household_food','set_household_food_claim','confirm_household_food','submit_household_rsvp')
 OR v_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN false; END IF;
 v_period:=date_trunc('minute',clock_timestamp());
 FOR v_n IN 1..3 LOOP
  IF v_n=1 THEN v_key:='ip:'||p_ip_hash;v_limit:=40;
  ELSIF v_n=2 THEN v_key:='code:'||md5(v_code);v_limit:=20;
  ELSE v_key:='global';v_limit:=2500;END IF;
  INSERT INTO public.guest_gateway_rate_limits(key_hash,period_start,request_count)
   VALUES(v_key,v_period,1)
   ON CONFLICT (key_hash,period_start) DO UPDATE
     SET request_count=public.guest_gateway_rate_limits.request_count+1
     WHERE public.guest_gateway_rate_limits.request_count<v_limit
   RETURNING true INTO v_ok;
  IF coalesce(v_ok,false)=false THEN RETURN false; END IF;
  v_ok:=false;
 END LOOP;
 RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.guest_gateway_allow_request(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_gateway_allow_request(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.get_invitation_v2(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_v2(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_household_food(text) TO service_role;
COMMIT;
