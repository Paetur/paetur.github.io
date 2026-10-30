-- RSVP Manager 002: new reusable single-event schema.
BEGIN;
CREATE TABLE public.event_languages (language_code text PRIMARY KEY CHECK(length(language_code) BETWEEN 2 AND 16),display_name text NOT NULL,enabled boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE public.event_settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),event_name text NOT NULL,event_type text NOT NULL DEFAULT 'other',
 default_language text NOT NULL REFERENCES public.event_languages(language_code),timezone text NOT NULL DEFAULT 'Atlantic/Faroe',
 website_url text,rsvp_deadline timestamptz,is_published boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.event_content (content_key text NOT NULL,language_code text NOT NULL REFERENCES public.event_languages(language_code),content_value text NOT NULL,PRIMARY KEY(content_key,language_code));
CREATE TABLE public.event_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,address text,map_url text,notes text,sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE public.event_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_key text NOT NULL UNIQUE,name text NOT NULL,
 location_id uuid REFERENCES public.event_locations(id) ON DELETE RESTRICT,
 starts_at timestamptz,ends_at timestamptz,requires_rsvp boolean NOT NULL DEFAULT true,is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0,CHECK(starts_at IS NULL OR ends_at IS NULL OR ends_at>starts_at)
);
CREATE TABLE public.household_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 contact_name text,contact_type text NOT NULL CHECK(contact_type IN ('email','phone','postal','other')),
 contact_value text NOT NULL CHECK(length(btrim(contact_value))>0),language_code text REFERENCES public.event_languages(language_code),
 is_primary boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,household_id)
);
CREATE UNIQUE INDEX household_primary_contact_per_type ON public.household_contacts(household_id,contact_type) WHERE is_primary;
CREATE TABLE public.household_session_defaults (
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 is_invited boolean NOT NULL DEFAULT true,PRIMARY KEY(household_id,session_id)
);
CREATE TABLE public.guest_session_overrides (
 guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 is_invited boolean NOT NULL,PRIMARY KEY(guest_id,session_id)
);
CREATE VIEW public.effective_session_invitations WITH (security_invoker=true) AS
 SELECT g.id AS guest_id,g.household_id,s.id AS session_id,s.requires_rsvp
 FROM public.guests g CROSS JOIN public.event_sessions s
 LEFT JOIN public.household_session_defaults d ON d.household_id=g.household_id AND d.session_id=s.id
 LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=s.id
 WHERE s.is_active AND coalesce(o.is_invited,d.is_invited,false);
ALTER TABLE public.households ADD COLUMN rsvp_state text NOT NULL DEFAULT 'open' CHECK(rsvp_state IN ('open','locked'));
ALTER TABLE public.households ADD COLUMN rsvp_submitted_at timestamptz;
ALTER TABLE public.households ADD COLUMN latest_rsvp_submission_id uuid;
ALTER TABLE public.households ADD COLUMN late_submission_until timestamptz;
CREATE TABLE public.rsvp_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 submission_number integer NOT NULL CHECK(submission_number>0),request_id uuid NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(),submission_snapshot jsonb NOT NULL,
 source text NOT NULL DEFAULT 'guest' CHECK(source IN ('guest','admin')),
 UNIQUE(household_id,submission_number),UNIQUE(household_id,request_id),UNIQUE(id,household_id)
);
ALTER TABLE public.households ADD CONSTRAINT household_latest_submission_fk FOREIGN KEY(latest_rsvp_submission_id,id) REFERENCES public.rsvp_submissions(id,household_id) ON DELETE RESTRICT;
CREATE TABLE public.guest_session_responses (
 guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 rsvp_status text NOT NULL CHECK(rsvp_status IN ('attending','declined')),
 last_submission_id uuid REFERENCES public.rsvp_submissions(id) ON DELETE RESTRICT,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guest_id,session_id)
);
CREATE TABLE public.rsvp_household_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('submitted','reopened','late_submission_authorized','admin_locked')),
 submission_id uuid REFERENCES public.rsvp_submissions(id) ON DELETE RESTRICT,
 reason text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(action NOT IN ('reopened','late_submission_authorized','admin_locked') OR (actor_user_id IS NOT NULL AND length(btrim(reason))>0))
);
CREATE TABLE public.rsvp_response_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('submission','admin_correction')),
 previous_status text,new_status text NOT NULL CHECK(new_status IN ('attending','declined')),
 reason text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(action <> 'admin_correction' OR (actor_user_id IS NOT NULL AND length(btrim(reason))>0))
);
CREATE TABLE public.message_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_key text NOT NULL,language_code text NOT NULL REFERENCES public.event_languages(language_code),
 channel text NOT NULL CHECK(channel IN ('whatsapp','sms','email','postal','manual')),
 subject text,body text NOT NULL,is_active boolean NOT NULL DEFAULT true,UNIQUE(template_key,language_code,channel)
);
CREATE TABLE public.invitation_send_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 contact_id uuid,channel text NOT NULL CHECK(channel IN ('whatsapp','sms','email','postal','manual')),
 message_subject text,message_body text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','sent','cancelled','failed')),
 created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(contact_id,household_id) REFERENCES public.household_contacts(id,household_id) ON DELETE RESTRICT
);
CREATE TABLE public.invitation_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),queue_id uuid NOT NULL UNIQUE REFERENCES public.invitation_send_queue(id) ON DELETE RESTRICT,
 confirmed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 confirmed_at timestamptz NOT NULL DEFAULT now(),recipient_snapshot jsonb NOT NULL,message_snapshot jsonb NOT NULL,delivery_note text
);
CREATE TABLE public.invitation_delivery_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,queue_id uuid NOT NULL REFERENCES public.invitation_send_queue(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,action text NOT NULL,previous_value jsonb,new_value jsonb,
 reason text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX household_contacts_household_idx ON public.household_contacts(household_id);
CREATE INDEX rsvp_submissions_household_time_idx ON public.rsvp_submissions(household_id,submitted_at DESC);
CREATE INDEX rsvp_response_audit_household_time_idx ON public.rsvp_response_audit(household_id,created_at DESC);
CREATE INDEX rsvp_household_audit_household_time_idx ON public.rsvp_household_audit(household_id,created_at DESC);
CREATE INDEX invitation_queue_household_status_idx ON public.invitation_send_queue(household_id,status);
CREATE INDEX invitation_delivery_audit_queue_idx ON public.invitation_delivery_audit(queue_id,created_at DESC);
COMMIT;
