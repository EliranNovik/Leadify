-- Centralized company email signatures.
-- Personal data stays on tenants_employee / users.
-- This file only stores company branding + signature-specific overrides (job title, department label, enable).

-- ---------------------------------------------------------------------------
-- Company-wide signature settings (singleton row id = 1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_signature_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name text NOT NULL DEFAULT 'Decker Pex & Co. Law Offices',
  logo_url text,
  secondary_logo_url text,
  website_url text DEFAULT 'https://lawoffice.org.il/en/',
  facebook_url text DEFAULT 'https://www.facebook.com/DeckerPexCo',
  linkedin_url text DEFAULT 'https://www.linkedin.com/company/decker-pex-co/',
  youtube_url text DEFAULT 'https://www.youtube.com/@DeckerPexLawoffice',
  instagram_url text,
  office_phone text,
  office_address text DEFAULT 'Rogowin Tower, 11 Menachem Begin Rd., Ramat Gan, Israel',
  signature_disclaimer text,
  signature_enabled boolean NOT NULL DEFAULT true,
  show_logo boolean NOT NULL DEFAULT true,
  show_secondary_logo boolean NOT NULL DEFAULT true,
  show_facebook boolean NOT NULL DEFAULT true,
  show_linkedin boolean NOT NULL DEFAULT true,
  show_youtube boolean NOT NULL DEFAULT true,
  show_instagram boolean NOT NULL DEFAULT false,
  show_website boolean NOT NULL DEFAULT true,
  show_office_address boolean NOT NULL DEFAULT true,
  show_office_phone boolean NOT NULL DEFAULT false,
  facebook_icon_url text,
  linkedin_icon_url text,
  youtube_icon_url text,
  website_icon_url text,
  instagram_icon_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE public.company_signature_settings IS
  'Singleton company branding for the shared email signature. Changing this row updates every employee signature at send time.';
COMMENT ON COLUMN public.company_signature_settings.logo_url IS
  'Primary firm logo (Decker Pex Levi). Public HTTPS URL.';
COMMENT ON COLUMN public.company_signature_settings.secondary_logo_url IS
  'Secondary image (Duns 100). Public HTTPS URL.';

INSERT INTO public.company_signature_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.company_signature_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_signature_settings select" ON public.company_signature_settings;
DROP POLICY IF EXISTS "company_signature_settings insert" ON public.company_signature_settings;
DROP POLICY IF EXISTS "company_signature_settings update" ON public.company_signature_settings;
DROP POLICY IF EXISTS "company_signature_settings delete" ON public.company_signature_settings;

CREATE POLICY "company_signature_settings select"
  ON public.company_signature_settings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "company_signature_settings insert"
  ON public.company_signature_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "company_signature_settings update"
  ON public.company_signature_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "company_signature_settings delete"
  ON public.company_signature_settings
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_signature_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.update_company_signature_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS company_signature_settings_updated_at ON public.company_signature_settings;
CREATE TRIGGER company_signature_settings_updated_at
  BEFORE UPDATE ON public.company_signature_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_company_signature_settings_updated_at();

-- ---------------------------------------------------------------------------
-- Per-employee signature overrides (job title is not stored on tenants_employee)
-- Name, phone, email, photo stay on tenants_employee / users.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_signature_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id bigint NOT NULL UNIQUE REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
  job_title text,
  department_override text,
  signature_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_signature_profiles IS
  'Signature-specific overrides only. Personal contact data is read from tenants_employee and users.';
COMMENT ON COLUMN public.user_signature_profiles.job_title IS
  'Professional title shown on the signature (e.g. Full Stack Developer). Not the bonuses_role code.';
COMMENT ON COLUMN public.user_signature_profiles.department_override IS
  'Optional department label for the signature. Falls back to tenant_departement.name.';

CREATE INDEX IF NOT EXISTS user_signature_profiles_employee_id_idx
  ON public.user_signature_profiles (employee_id);

ALTER TABLE public.user_signature_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_signature_profiles select" ON public.user_signature_profiles;
DROP POLICY IF EXISTS "user_signature_profiles insert" ON public.user_signature_profiles;
DROP POLICY IF EXISTS "user_signature_profiles update" ON public.user_signature_profiles;
DROP POLICY IF EXISTS "user_signature_profiles delete" ON public.user_signature_profiles;

CREATE POLICY "user_signature_profiles select"
  ON public.user_signature_profiles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "user_signature_profiles insert"
  ON public.user_signature_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "user_signature_profiles update"
  ON public.user_signature_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "user_signature_profiles delete"
  ON public.user_signature_profiles
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_signature_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.update_user_signature_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_signature_profiles_updated_at ON public.user_signature_profiles;
CREATE TRIGGER user_signature_profiles_updated_at
  BEFORE UPDATE ON public.user_signature_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_signature_profiles_updated_at();

-- Reuse the existing public signature-templates bucket for company logos / social icons.
-- Paths: company/logo_*, company/duns_*, company/icon_*
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signature-templates',
  'signature-templates',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']::text[];
