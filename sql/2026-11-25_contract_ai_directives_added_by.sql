-- Who added each contract AI policy, rule, or behavior.
-- Run in the Supabase SQL editor. Safe to run more than once.
-- Existing rows keep their created_at and have no author until someone adds a new one.

ALTER TABLE public.contract_ai_directives
  ADD COLUMN IF NOT EXISTS created_by uuid;

COMMENT ON COLUMN public.contract_ai_directives.created_by IS
  'auth.users id of the superuser who added the row.';

CREATE OR REPLACE FUNCTION public.contract_ai_directives_stamp_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    IF NEW.created_at IS NULL THEN
      NEW.created_at := now();
    END IF;
    RETURN NEW;
  END IF;

  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_ai_directives_stamp_creator ON public.contract_ai_directives;
CREATE TRIGGER contract_ai_directives_stamp_creator
BEFORE INSERT OR UPDATE ON public.contract_ai_directives
FOR EACH ROW
EXECUTE FUNCTION public.contract_ai_directives_stamp_creator();
