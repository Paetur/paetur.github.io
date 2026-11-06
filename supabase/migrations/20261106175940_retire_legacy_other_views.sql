BEGIN;

DROP VIEW public.things_to_do,public.stuff_to_bring;
DROP FUNCTION public.admin_save_tasks(jsonb);

NOTIFY pgrst,'reload schema';
COMMIT;
