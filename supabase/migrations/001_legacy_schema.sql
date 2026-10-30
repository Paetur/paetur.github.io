-- RSVP Manager 001: fresh destination only. Do not apply to source project.
BEGIN;
CREATE TABLE public.relation_groups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.food_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.households (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_name text NOT NULL,
 side text NOT NULL CHECK (side IN ('paetur_hentze','maria_haass')),
 language text NOT NULL DEFAULT 'fo' CHECK (language IN ('fo','en','de')),
 email text, phone text, notes text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 invite_code text NOT NULL UNIQUE CHECK (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
 family_name text,relation_group_id uuid REFERENCES public.relation_groups(id) ON DELETE SET NULL,
 parent_id uuid REFERENCES public.households(id) ON DELETE RESTRICT,
 sort_order integer NOT NULL DEFAULT 0,food boolean NOT NULL DEFAULT false,
 stuff boolean NOT NULL DEFAULT false,things boolean NOT NULL DEFAULT false,
 visited boolean NOT NULL DEFAULT false,visited_at timestamptz,last_name text,
 food_confirmed boolean NOT NULL DEFAULT false,food_confirmed_at timestamptz,
 CONSTRAINT household_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);
CREATE TABLE public.guests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 first_name text NOT NULL,last_name text,relation text,
 language text CHECK (language IS NULL OR language IN ('fo','en','de')),
 is_child boolean NOT NULL DEFAULT false,rsvp_status text NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending','attending','declined')),
 dietary_requirements text,notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 courtesy_title text CHECK (courtesy_title IS NULL OR courtesy_title IN ('Mr.','Ms.','Son','Daughter'))
);
CREATE TABLE public.food_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),category text,name_fo text NOT NULL,name_en text,name_de text,
 description_fo text,description_en text,description_de text,quantity_needed integer NOT NULL DEFAULT 1 CHECK (quantity_needed>=0),
 active boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.food_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),food_item_id uuid NOT NULL REFERENCES public.food_items(id) ON DELETE RESTRICT,
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0),
 notes text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(food_item_id,household_id)
);
CREATE TABLE public.stuff_to_bring (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item text NOT NULL,quantity integer DEFAULT 1,assigned_to text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','done')),
 notes text,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.things_to_do (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task text NOT NULL,assigned_to text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done')),
 due_date date,notes text,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admins (user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX households_parent_idx ON public.households(parent_id);
CREATE INDEX households_relation_group_idx ON public.households(relation_group_id);
CREATE INDEX guests_household_idx ON public.guests(household_id);
CREATE INDEX food_claims_household_idx ON public.food_claims(household_id);
CREATE INDEX food_claims_item_idx ON public.food_claims(food_item_id);
-- Avoid recreating old generate_invite_code default until audited replacement exists.
-- Import explicit original invite_code values; new-household creation uses a trusted RPC later.
COMMIT;
