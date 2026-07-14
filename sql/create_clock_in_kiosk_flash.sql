-- Short-lived display events for the entry kiosk “clocked in” modal.
-- Written by Express (service role); read by Express recent-event endpoint.

CREATE TABLE IF NOT EXISTS public.clock_in_kiosk_flash (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id bigint NOT NULL,
    employee_name text NOT NULL,
    photo_url text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT clock_in_kiosk_flash_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES public.clock_in_locations(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.clock_in_kiosk_flash IS
  'Ephemeral clock-in flash payloads for entry kiosk tablets (last few seconds).';

CREATE INDEX IF NOT EXISTS idx_clock_in_kiosk_flash_location_created
  ON public.clock_in_kiosk_flash (location_id, created_at DESC);

ALTER TABLE public.clock_in_kiosk_flash ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.clock_in_kiosk_flash FROM anon, authenticated;
GRANT ALL ON TABLE public.clock_in_kiosk_flash TO service_role;
