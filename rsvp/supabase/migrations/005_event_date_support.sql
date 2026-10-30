-- Fresh-project installation: migration already installed on the existing RSVP database.
ALTER TABLE public.event_settings ADD COLUMN IF NOT EXISTS event_date date;
COMMENT ON COLUMN public.event_settings.event_date IS
'Primary calendar date of the event, without an assumed time of day; session times are separate.';
