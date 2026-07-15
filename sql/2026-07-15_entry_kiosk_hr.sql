-- Entry kiosk HR: announcements, display settings, gadgets, employee birthdays
-- Run in Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Employee birthdays
-- ---------------------------------------------------------------------------

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMENT ON COLUMN public.tenants_employee.date_of_birth IS
  'Employee date of birth; shown on entry kiosk when birthdays widget is enabled.';

-- ---------------------------------------------------------------------------
-- Kiosk display settings (one row per location)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.entry_kiosk_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  location_id INTEGER NOT NULL DEFAULT 1 UNIQUE,
  office_label TEXT NOT NULL DEFAULT 'RAMAT GAN',
  show_clock_date BOOLEAN NOT NULL DEFAULT TRUE,
  show_weather BOOLEAN NOT NULL DEFAULT FALSE,
  show_meetings_today BOOLEAN NOT NULL DEFAULT TRUE,
  show_birthdays BOOLEAN NOT NULL DEFAULT TRUE,
  show_announcements BOOLEAN NOT NULL DEFAULT TRUE,
  show_gadgets BOOLEAN NOT NULL DEFAULT TRUE,
  weather_city TEXT NOT NULL DEFAULT 'Tel Aviv',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.entry_kiosk_settings (id, location_id, office_label)
VALUES (1, 1, 'RAMAT GAN')
ON CONFLICT (location_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Kiosk announcements
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.entry_kiosk_announcements (
  id BIGSERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entry_kiosk_announcements_location_idx
  ON public.entry_kiosk_announcements (location_id, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- Kiosk gadgets / extras
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.entry_kiosk_gadgets (
  id BIGSERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  body TEXT,
  icon_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entry_kiosk_gadgets_location_idx
  ON public.entry_kiosk_gadgets (location_id, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- RLS (superuser manage; authenticated read settings for HR UI)
-- ---------------------------------------------------------------------------

ALTER TABLE public.entry_kiosk_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_kiosk_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_kiosk_gadgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entry_kiosk_settings_select_authenticated" ON public.entry_kiosk_settings;
CREATE POLICY "entry_kiosk_settings_select_authenticated"
  ON public.entry_kiosk_settings
  FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "entry_kiosk_settings_manage_superuser" ON public.entry_kiosk_settings;
CREATE POLICY "entry_kiosk_settings_manage_superuser"
  ON public.entry_kiosk_settings
  FOR ALL
  TO authenticated
  USING (is_app_superuser())
  WITH CHECK (is_app_superuser());

DROP POLICY IF EXISTS "entry_kiosk_announcements_select_authenticated" ON public.entry_kiosk_announcements;
CREATE POLICY "entry_kiosk_announcements_select_authenticated"
  ON public.entry_kiosk_announcements
  FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "entry_kiosk_announcements_manage_superuser" ON public.entry_kiosk_announcements;
CREATE POLICY "entry_kiosk_announcements_manage_superuser"
  ON public.entry_kiosk_announcements
  FOR ALL
  TO authenticated
  USING (is_app_superuser())
  WITH CHECK (is_app_superuser());

DROP POLICY IF EXISTS "entry_kiosk_gadgets_select_authenticated" ON public.entry_kiosk_gadgets;
CREATE POLICY "entry_kiosk_gadgets_select_authenticated"
  ON public.entry_kiosk_gadgets
  FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "entry_kiosk_gadgets_manage_superuser" ON public.entry_kiosk_gadgets;
CREATE POLICY "entry_kiosk_gadgets_manage_superuser"
  ON public.entry_kiosk_gadgets
  FOR ALL
  TO authenticated
  USING (is_app_superuser())
  WITH CHECK (is_app_superuser());

GRANT SELECT ON public.entry_kiosk_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entry_kiosk_announcements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entry_kiosk_gadgets TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.entry_kiosk_announcements_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.entry_kiosk_gadgets_id_seq TO authenticated;
