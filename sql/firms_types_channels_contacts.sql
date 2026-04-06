-- =============================================================================
-- Firms, types, channels, and firm contacts
-- =============================================================================
-- - firm_types: catalog (Service provider, Ref in, Ref out, …) — created before firms (FK)
-- - firms: organization records (optional firm_type_id → firm_types)
-- - channels: catalog (Google, Facebook, …); optional FK from misc_leadsource.channel_id (see sql/misc_leadsource_add_channel_id.sql)
-- - firm_firm_type: which types apply to each firm (many-to-many)
-- - firm_channel: which channels apply to each firm (many-to-many)
-- - firm_contacts: people linked to a firm (login fields optional)
--
-- Run in Supabase SQL Editor. Enable RLS and policies before exposing to clients.
-- =============================================================================

-- 1. Type catalog (service provider, Ref in, Ref out, …) ---------------------
CREATE TABLE IF NOT EXISTS public.firm_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    label text NOT NULL,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.firm_types IS 'Lookup: classification of a firm (e.g. service_provider, ref_in, ref_out).';
COMMENT ON COLUMN public.firm_types.code IS 'Stable machine key, e.g. ref_in';

-- 2. Firms -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.firms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    firm_type_id uuid REFERENCES public.firm_types (id) ON DELETE SET NULL,
    legal_name text,
    vat_number text,
    website text,
    address text,
    contract text,
    invoices text,
    other_docs text,
    notes text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firms_name ON public.firms (name);
CREATE INDEX IF NOT EXISTS idx_firms_firm_type ON public.firms (firm_type_id);
CREATE INDEX IF NOT EXISTS idx_firms_is_active ON public.firms (is_active) WHERE is_active = true;

COMMENT ON TABLE public.firms IS 'Organizations / referral partners / service providers.';
COMMENT ON COLUMN public.firms.firm_type_id IS 'Primary firm type (see also firm_firm_type for many-to-many).';
COMMENT ON COLUMN public.firms.contract IS 'Contract doc URL/path or reference.';
COMMENT ON COLUMN public.firms.invoices IS 'Invoices doc URL/path or reference.';
COMMENT ON COLUMN public.firms.other_docs IS 'Other documents URL/path or reference.';

-- 3. Channel catalog (Google, Facebook, …) -----------------------------------
CREATE TABLE IF NOT EXISTS public.channels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    label text NOT NULL,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.channels IS 'Lookup: acquisition / marketing channel (e.g. google, facebook).';
COMMENT ON COLUMN public.channels.code IS 'Stable machine key, e.g. google_ads';

-- 4. Firm ↔ types (many types per firm) --------------------------------------
CREATE TABLE IF NOT EXISTS public.firm_firm_type (
    firm_id uuid NOT NULL REFERENCES public.firms (id) ON DELETE CASCADE,
    firm_type_id uuid NOT NULL REFERENCES public.firm_types (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (firm_id, firm_type_id)
);

CREATE INDEX IF NOT EXISTS idx_firm_firm_type_type ON public.firm_firm_type (firm_type_id);

-- 5. Firm ↔ channels (many channels per firm) ------------------------------
CREATE TABLE IF NOT EXISTS public.firm_channel (
    firm_id uuid NOT NULL REFERENCES public.firms (id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (firm_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_firm_channel_channel ON public.firm_channel (channel_id);

-- 6. Firm contacts -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.firm_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id uuid NOT NULL REFERENCES public.firms (id) ON DELETE CASCADE,
    name text NOT NULL,
    email text,
    second_email text,
    phone text,
    profile_image_url text,
    user_email text,
    -- Never store plaintext passwords; hash in app (e.g. bcrypt/argon2) or use auth.users.
    password_hash text,
    firm_owner boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firm_contacts_firm ON public.firm_contacts (firm_id);
CREATE INDEX IF NOT EXISTS idx_firm_contacts_email ON public.firm_contacts (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_firm_contacts_user_email ON public.firm_contacts (user_email) WHERE user_email IS NOT NULL;

COMMENT ON COLUMN public.firm_contacts.user_email IS 'Login identifier if this contact has app access (may match email).';
COMMENT ON COLUMN public.firm_contacts.password_hash IS 'Optional: only if not using Supabase Auth; store hash, never plaintext.';
COMMENT ON COLUMN public.firm_contacts.firm_owner IS 'Primary owner flag for this firm contact.';

-- Optional: one “primary” owner per firm (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_firm_one_primary_owner
    ON public.firm_contacts (firm_id)
    WHERE firm_owner = true;

-- If you prefer multiple owners, drop the index above and rely on firm_owner bool only.

-- updated_at touch (scoped function name to avoid clobbering other migrations)
CREATE OR REPLACE FUNCTION public.firms_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_firms_updated_at ON public.firms;
CREATE TRIGGER tr_firms_updated_at
    BEFORE UPDATE ON public.firms
    FOR EACH ROW
    EXECUTE FUNCTION public.firms_touch_updated_at();

DROP TRIGGER IF EXISTS tr_firm_contacts_updated_at ON public.firm_contacts;
CREATE TRIGGER tr_firm_contacts_updated_at
    BEFORE UPDATE ON public.firm_contacts
    FOR EACH ROW
    EXECUTE FUNCTION public.firms_touch_updated_at();

-- Seed examples (optional — edit or remove) ---------------------------------
INSERT INTO public.firm_types (code, label, sort_order) VALUES
    ('service_provider', 'Service provider', 10),
    ('ref_in', 'Ref in', 20),
    ('ref_out', 'Ref out', 30)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.channels (code, label, sort_order) VALUES
    ('google', 'Google', 10),
    ('facebook', 'Facebook', 20),
    ('linkedin', 'LinkedIn', 30),
    ('other', 'Other', 99)
ON CONFLICT (code) DO NOTHING;

-- Supabase: run sql/firms_channels_rls_authenticated.sql for authenticated CRUD policies.
-- Or enable RLS manually:
-- ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.firm_types ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.firm_firm_type ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.firm_channel ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.firm_contacts ENABLE ROW LEVEL SECURITY;
