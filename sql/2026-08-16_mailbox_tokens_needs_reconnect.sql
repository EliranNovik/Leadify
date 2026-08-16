-- Keep mailbox_tokens rows when Microsoft refresh fails.
-- status: connected | needs_reconnect
-- Do not delete tokens on invalid_grant; mark needs_reconnect instead.

ALTER TABLE public.mailbox_tokens
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'connected';

ALTER TABLE public.mailbox_tokens
  ADD COLUMN IF NOT EXISTS last_refresh_error text;

ALTER TABLE public.mailbox_tokens
  ADD COLUMN IF NOT EXISTS last_refresh_at timestamptz;

UPDATE public.mailbox_tokens
SET status = 'connected'
WHERE status IS NULL OR btrim(status) = '';

-- After this ships, these active employees still have no token and must connect
-- Outlook once in the CRM (same Microsoft account as their CRM email).
-- The app will prompt them when they log in.
--
-- Reconnect: Alexandra, Anat, Bar, Caroline, Dana, Einat, Eliya, Hava, Ido,
-- IrinaT, JonathanR, Joshua, Julia, Katya, Lior, Maria, MiriamL, Rebecca,
-- Reut, Solomon Natar, WMichael, Yael, Yana, Yehonatan D
-- Optional / skip: Ai Agent, Office (noscheduler), Daan (gmail), Mordechai,
-- Jane (not staff), Meir (not staff)
