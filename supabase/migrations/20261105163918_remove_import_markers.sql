BEGIN;

-- Strip source labels while retaining any text after the separator.
UPDATE public.guests
SET notes=nullif(regexp_replace(notes,'^[[:blank:]]*Imported from (Paetur|Maria|Food)[.]csv([[:blank:]]*[;|][[:blank:]]*|[[:blank:]]*$)','','i'),'')
WHERE notes ~* '^[[:blank:]]*Imported from (Paetur|Maria|Food)[.]csv([[:blank:]]*[;|]|[[:blank:]]*$)';

UPDATE public.households
SET notes=nullif(regexp_replace(notes,'^[[:blank:]]*Imported from (Paetur|Maria|Food)[.]csv([[:blank:]]*[;|][[:blank:]]*|[[:blank:]]*$)','','i'),'')
WHERE notes ~* '^[[:blank:]]*Imported from (Paetur|Maria|Food)[.]csv([[:blank:]]*[;|]|[[:blank:]]*$)';

DO $$
BEGIN
 IF to_regclass('public.legacy_stuff_to_bring') IS NULL THEN RETURN; END IF;
 LOCK TABLE public.legacy_stuff_to_bring, public.other_items IN ACCESS EXCLUSIVE MODE;
 IF EXISTS (
  SELECT 1 FROM public.legacy_stuff_to_bring a
  LEFT JOIN public.stuff_to_bring b USING (id)
  WHERE b.id IS NULL
     OR ROW(a.item,a.quantity,a.assigned_to,a.status,a.sort_order,a.created_at)
        IS DISTINCT FROM ROW(b.item,b.quantity,b.assigned_to,b.status,b.sort_order,b.created_at)
     OR (a.notes IS DISTINCT FROM b.notes AND a.notes IS DISTINCT FROM 'Imported from Food.csv')
 ) THEN
  RAISE EXCEPTION 'Legacy bring-list archive contains records or notes missing from Other';
 END IF;
 DROP TABLE public.legacy_stuff_to_bring;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
