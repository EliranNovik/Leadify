-- =============================================================================
-- Add flag_type (bigint) to user_content_flags — references flag_types.id.
-- Run after create_flag_types.sql
-- =============================================================================

ALTER TABLE public.user_content_flags
  ADD COLUMN IF NOT EXISTS flag_type bigint NOT NULL DEFAULT 1;

-- Add FK if missing (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_content_flags_flag_type_fkey'
  ) THEN
    ALTER TABLE public.user_content_flags
      ADD CONSTRAINT user_content_flags_flag_type_fkey
      FOREIGN KEY (flag_type) REFERENCES public.flag_types (id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN public.user_content_flags.flag_type IS 'FK to flag_types.id — save ids only (e.g. 1=probability, 2=referral).';

UPDATE public.user_content_flags SET flag_type = 1 WHERE flag_type IS NULL;
