-- Safe first-time defaults. Existing event settings and language choices are never overwritten.
-- New project owners may change these values after first admin login.
BEGIN;
INSERT INTO public.event_languages(language_code,display_name,enabled,sort_order)
VALUES ('en','English',true,1),('fo','Føroyskt',true,2),('de','Deutsch',true,3)
ON CONFLICT(language_code) DO NOTHING;
INSERT INTO public.event_settings(id,event_name,event_type,default_language,timezone,is_published)
VALUES(1,'My event','other','en','UTC',false)
ON CONFLICT(id) DO NOTHING;
COMMIT;
