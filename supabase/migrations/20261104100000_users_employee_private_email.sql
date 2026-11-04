-- Private (personal) email captured at recruitment user creation.
-- On hire, users.email + auth email become the Outlook/work email; this column keeps the original private address.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS employee_private_email text;

COMMENT ON COLUMN public.users.employee_private_email IS
  'Personal/private email collected during recruitment. Auth + users.email may later switch to the Outlook/work email on hire; this column retains the original private address.';

-- Backfill from current email when empty (recruitment users that have not been hired yet).
UPDATE public.users
SET employee_private_email = NULLIF(lower(btrim(email)), '')
WHERE employee_private_email IS NULL
  AND email IS NOT NULL
  AND btrim(email) <> '';
