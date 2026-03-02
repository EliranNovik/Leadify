-- Ensure foreign keys exist for contact-related columns so Supabase/PostgREST
-- can use joins (emails → leads_contact, leads_leadinteractions → lead_leadcontact,
-- leads_contact.creator_id → tenants_employee). Run once; safe to re-run.
--
-- Step 1: Clean orphaned references (set to NULL where referenced row does not exist).
-- Step 2: Add FK constraints only if missing and column type is compatible (bigint/integer).
-- Step 3: Indexes for join performance.

-- ========== Step 1: Fix orphaned references ==========

-- emails.contact_id → leads_contact(id). Only when column exists and is numeric.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'emails' AND column_name = 'contact_id'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    UPDATE public.emails e
    SET contact_id = NULL
    WHERE e.contact_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.leads_contact lc WHERE lc.id = e.contact_id);
  END IF;
END $$;

-- leads_leadinteractions.contact_id → lead_leadcontact(id). Only when column exists and is numeric.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads_leadinteractions' AND column_name = 'contact_id'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    UPDATE public.leads_leadinteractions li
    SET contact_id = NULL
    WHERE li.contact_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.lead_leadcontact llc WHERE llc.id = li.contact_id);
  END IF;
END $$;

-- leads_contact.creator_id → tenants_employee(id). Optional; clean orphans when column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads_contact' AND column_name = 'creator_id'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    UPDATE public.leads_contact lc
    SET creator_id = NULL
    WHERE lc.creator_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.tenants_employee te WHERE te.id = lc.creator_id);
  END IF;
END $$;

-- whatsapp_messages.contact_id → leads_contact(id). Optional; when column exists and numeric.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_messages' AND column_name = 'contact_id'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    UPDATE public.whatsapp_messages wm
    SET contact_id = NULL
    WHERE wm.contact_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.leads_contact lc WHERE lc.id = wm.contact_id);
  END IF;
END $$;

-- ========== Step 2: Add FK constraints (only if missing and type compatible) ==========

-- emails.contact_id → leads_contact(id). Name used in app: emails_contact_id_fkey
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'emails' AND column_name = 'contact_id'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.emails'::regclass
        AND conname = 'emails_contact_id_fkey'
        AND contype = 'f'
    ) THEN
      ALTER TABLE public.emails
        ADD CONSTRAINT emails_contact_id_fkey
        FOREIGN KEY (contact_id) REFERENCES public.leads_contact(id)
        ON UPDATE CASCADE ON DELETE CASCADE;
      RAISE NOTICE 'Added emails_contact_id_fkey';
    END IF;
  END IF;
END $$;

-- leads_leadinteractions.contact_id → lead_leadcontact(id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads_leadinteractions' AND column_name = 'contact_id'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.leads_leadinteractions'::regclass
        AND conname = 'fk_leads_leadinteractions_contact_id'
        AND contype = 'f'
    ) THEN
      ALTER TABLE public.leads_leadinteractions
        ADD CONSTRAINT fk_leads_leadinteractions_contact_id
        FOREIGN KEY (contact_id) REFERENCES public.lead_leadcontact(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      RAISE NOTICE 'Added fk_leads_leadinteractions_contact_id';
    END IF;
  END IF;
END $$;

-- leads_contact.creator_id → tenants_employee(id). Enables join for creator display name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads_contact' AND column_name = 'creator_id'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.leads_contact'::regclass
        AND conname = 'fk_leads_contact_creator_id'
        AND contype = 'f'
    ) THEN
      ALTER TABLE public.leads_contact
        ADD CONSTRAINT fk_leads_contact_creator_id
        FOREIGN KEY (creator_id) REFERENCES public.tenants_employee(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      RAISE NOTICE 'Added fk_leads_contact_creator_id';
    END IF;
  END IF;
END $$;

-- whatsapp_messages.contact_id → leads_contact(id). Name used in app: whatsapp_messages_contact_id_fkey
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_messages' AND column_name = 'contact_id'
      AND data_type IN ('bigint', 'integer')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.whatsapp_messages'::regclass
        AND conname = 'whatsapp_messages_contact_id_fkey'
        AND contype = 'f'
    ) THEN
      ALTER TABLE public.whatsapp_messages
        ADD CONSTRAINT whatsapp_messages_contact_id_fkey
        FOREIGN KEY (contact_id) REFERENCES public.leads_contact(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      RAISE NOTICE 'Added whatsapp_messages_contact_id_fkey';
    END IF;
  END IF;
END $$;

-- ========== Step 3: Indexes for join performance ==========

CREATE INDEX IF NOT EXISTS idx_emails_contact_id
  ON public.emails(contact_id) WHERE contact_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_leadinteractions' AND column_name = 'contact_id') THEN
    CREATE INDEX IF NOT EXISTS idx_leads_leadinteractions_contact_id
      ON public.leads_leadinteractions(contact_id) WHERE contact_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_contact' AND column_name = 'creator_id') THEN
    CREATE INDEX IF NOT EXISTS idx_leads_contact_creator_id
      ON public.leads_contact(creator_id) WHERE creator_id IS NOT NULL;
  END IF;
END $$;
