-- Registered kiosk devices + short-lived display sessions for secure document display.
-- Access only via Express service role (no anon/authenticated RLS policies).

CREATE TABLE IF NOT EXISTS public.kiosk_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location_id BIGINT NOT NULL REFERENCES public.clock_in_locations(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_seen_at TIMESTAMPTZ,
  paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paired_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_devices_location_id ON public.kiosk_devices(location_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_devices_status ON public.kiosk_devices(status);

COMMENT ON TABLE public.kiosk_devices IS 'Registered entry-kiosk tablets; device token hash stored server-side only.';

CREATE TABLE IF NOT EXISTS public.kiosk_pairing_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  location_id BIGINT NOT NULL DEFAULT 1 REFERENCES public.clock_in_locations(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  device_id UUID REFERENCES public.kiosk_devices(id) ON DELETE SET NULL,
  pending_device_token TEXT,
  token_claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_pairing_codes_code ON public.kiosk_pairing_codes(code);
CREATE INDEX IF NOT EXISTS idx_kiosk_pairing_codes_expires ON public.kiosk_pairing_codes(expires_at);

COMMENT ON TABLE public.kiosk_pairing_codes IS 'Short-lived 6-digit codes for pairing a tablet to a kiosk device.';

CREATE TABLE IF NOT EXISTS public.kiosk_display_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_device_id UUID NOT NULL REFERENCES public.kiosk_devices(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('digital_contract', 'poa', 'payment')),
  resource_id TEXT NOT NULL,
  resource_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'expired')),
  allowed_actions TEXT[] NOT NULL DEFAULT ARRAY['view', 'complete'],
  expires_at TIMESTAMPTZ NOT NULL,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_display_sessions_device ON public.kiosk_display_sessions(kiosk_device_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_display_sessions_status ON public.kiosk_display_sessions(status);
CREATE INDEX IF NOT EXISTS idx_kiosk_display_sessions_expires ON public.kiosk_display_sessions(expires_at);

COMMENT ON TABLE public.kiosk_display_sessions IS 'One document/payment task pushed from CRM to a specific kiosk device.';

ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_display_sessions ENABLE ROW LEVEL SECURITY;

-- No policies: service role only via backend.
