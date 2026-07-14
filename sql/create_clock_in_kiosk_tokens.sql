-- Rotating QR tokens for the office entry kiosk clock-in flow.
-- Backend (service role) is the only reader/writer; clients never touch this table directly.

CREATE TABLE IF NOT EXISTS public.clock_in_kiosk_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token uuid NOT NULL UNIQUE,
    location_id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT clock_in_kiosk_tokens_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES public.clock_in_locations(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.clock_in_kiosk_tokens IS
  'Short-lived QR tokens minted for entry kiosk clock-in; validated by Express backend.';

CREATE INDEX IF NOT EXISTS idx_clock_in_kiosk_tokens_location_expires
  ON public.clock_in_kiosk_tokens (location_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_clock_in_kiosk_tokens_token
  ON public.clock_in_kiosk_tokens (token);

ALTER TABLE public.clock_in_kiosk_tokens ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon: only service_role bypasses RLS.
DROP POLICY IF EXISTS "No direct client access to kiosk tokens" ON public.clock_in_kiosk_tokens;

REVOKE ALL ON TABLE public.clock_in_kiosk_tokens FROM anon, authenticated;
GRANT ALL ON TABLE public.clock_in_kiosk_tokens TO service_role;
