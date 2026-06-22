-- =============================================================================
-- Digital POA — staff-authored TEMPLATES
-- -----------------------------------------------------------------------------
-- In addition to the four hard-coded POA types (sql/digital_poa.sql), staff can
-- compose their own POA templates from free text + inserted fields.
--
--   * poa_templates           : the reusable templates (text body + field defs)
--   * poa_documents.template_id: a POA instance created from a template
--
-- A template carries a POA category (misc_maincategory) and a language
-- (languages). The body is plain text with {{key}} tokens that map to the
-- entries in the `fields` JSON array; the public page renders those tokens as
-- inputs / signature pads.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TEMPLATES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.poa_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT NULL,

  -- POA category + language (loose references to existing lookup tables).
  -- NOTE: misc_maincategory.id is BIGINT (Django), languages.id is UUID.
  category_id  BIGINT NULL,
  language_id  UUID NULL,

  direction    TEXT NOT NULL DEFAULT 'ltr',          -- ltr / rtl (derived from language)

  -- Free text with {{key}} tokens; `fields` is the ordered list of field defs:
  -- [{ "key": "...", "label": "...", "type": "text|textarea|date|email|tel|signature",
  --    "required": true, "prefill": "name|email|phone|address|id_passport|null" }]
  body         TEXT NOT NULL DEFAULT '',
  fields       JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Document typography (applied in the editor and on the public POA page).
  font_family  TEXT NULL,
  font_size    TEXT NULL,

  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,

  created_by   TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.poa_templates IS 'Staff-authored Power of Attorney templates (free text + inserted fields).';
COMMENT ON COLUMN public.poa_templates.category_id IS 'POA category (misc_maincategory.id).';
COMMENT ON COLUMN public.poa_templates.language_id IS 'Template language (languages.id).';
COMMENT ON COLUMN public.poa_templates.body IS 'Template text with {{key}} tokens matching the fields array.';
COMMENT ON COLUMN public.poa_templates.fields IS 'Ordered field definitions rendered on the public POA page.';

-- If an earlier version created language_id as BIGINT, fix it to UUID so it can
-- reference languages.id (no data loss expected on a fresh feature table).
DO $$
DECLARE v_type text;
BEGIN
  SELECT data_type INTO v_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'poa_templates' AND column_name = 'language_id';
  IF v_type IS NOT NULL AND v_type <> 'uuid' THEN
    ALTER TABLE public.poa_templates DROP CONSTRAINT IF EXISTS poa_templates_language_fk;
    ALTER TABLE public.poa_templates DROP COLUMN language_id;
    ALTER TABLE public.poa_templates ADD COLUMN language_id UUID NULL;
  END IF;
END$$;

-- Typography columns for tables created before they were added.
ALTER TABLE public.poa_templates ADD COLUMN IF NOT EXISTS font_family TEXT NULL;
ALTER TABLE public.poa_templates ADD COLUMN IF NOT EXISTS font_size TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_poa_templates_active ON public.poa_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_poa_templates_category ON public.poa_templates(category_id);

-- Foreign keys to the lookup tables (added defensively: if the referenced
-- column types differ across environments the table still works without them).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'poa_templates_category_fk'
  ) THEN
    BEGIN
      ALTER TABLE public.poa_templates
        ADD CONSTRAINT poa_templates_category_fk
        FOREIGN KEY (category_id) REFERENCES public.misc_maincategory(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping poa_templates_category_fk: %', SQLERRM;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'poa_templates_language_fk'
  ) THEN
    BEGIN
      ALTER TABLE public.poa_templates
        ADD CONSTRAINT poa_templates_language_fk
        FOREIGN KEY (language_id) REFERENCES public.languages(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping poa_templates_language_fk: %', SQLERRM;
    END;
  END IF;
END$$;

-- keep updated_at fresh (reuse the helper from digital_poa.sql if present)
CREATE OR REPLACE FUNCTION public._poa_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_poa_templates_touch ON public.poa_templates;
CREATE TRIGGER trg_poa_templates_touch
  BEFORE UPDATE ON public.poa_templates
  FOR EACH ROW EXECUTE FUNCTION public._poa_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. LINK poa_documents -> templates
-- -----------------------------------------------------------------------------
ALTER TABLE public.poa_documents
  ADD COLUMN IF NOT EXISTS template_id UUID NULL REFERENCES public.poa_templates(id) ON DELETE SET NULL;

-- A document now comes from EITHER a hard-coded type OR a template.
ALTER TABLE public.poa_documents ALTER COLUMN poa_type_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_poa_documents_template ON public.poa_documents(template_id);

-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.poa_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poa_templates_all_auth ON public.poa_templates;
CREATE POLICY poa_templates_all_auth
  ON public.poa_templates FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.poa_templates TO authenticated;

-- =============================================================================
-- 4. STAFF RPC — create a POA instance from a template
-- =============================================================================
CREATE OR REPLACE FUNCTION public.poa_create_from_template(
  p_contact_id BIGINT,
  p_template_id UUID,
  p_new_lead_id UUID DEFAULT NULL,
  p_legacy_lead_id BIGINT DEFAULT NULL,
  p_prefill JSONB DEFAULT '{}'::jsonb,
  p_created_by TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tpl public.poa_templates;
  v_lang TEXT;
  v_id UUID;
  v_token TEXT;
BEGIN
  SELECT * INTO v_tpl FROM public.poa_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unknown POA template');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.leads_contact WHERE id = p_contact_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contact not found');
  END IF;

  SELECT lower(l.iso_code) INTO v_lang FROM public.languages l WHERE l.id = v_tpl.language_id;

  INSERT INTO public.poa_documents (
    template_id, contact_id, new_lead_id, legacy_lead_id,
    language, field_data, status, created_by, expires_at
  )
  VALUES (
    p_template_id, p_contact_id, p_new_lead_id, p_legacy_lead_id,
    COALESCE(v_lang, 'en'), COALESCE(p_prefill, '{}'::jsonb), 'pending', p_created_by, p_expires_at
  )
  RETURNING id, secure_token INTO v_id, v_token;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'secure_token', v_token,
    'template_id', p_template_id,
    'type_name', v_tpl.name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.poa_create_from_template(BIGINT, UUID, UUID, BIGINT, JSONB, TEXT, TIMESTAMPTZ) TO authenticated;

-- =============================================================================
-- 5. Replace poa_get_public + poa_list_for_contact to understand templates
-- =============================================================================

-- Fetch a POA (hard-coded type OR template) for the public signing page.
CREATE OR REPLACE FUNCTION public.poa_get_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poa public.poa_documents;
  v_type public.poa_types;
  v_tpl public.poa_templates;
  v_contact public.leads_contact;
  v_lang TEXT;
  v_type_json JSONB;
  v_tpl_json JSONB := NULL;
BEGIN
  SELECT * INTO v_poa FROM public.poa_documents WHERE secure_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'POA not found');
  END IF;

  IF v_poa.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This power of attorney is no longer available.');
  END IF;

  IF v_poa.expires_at IS NOT NULL AND v_poa.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This power of attorney link has expired.');
  END IF;

  SELECT * INTO v_contact FROM public.leads_contact WHERE id = v_poa.contact_id;

  IF v_poa.template_id IS NOT NULL THEN
    SELECT * INTO v_tpl FROM public.poa_templates WHERE id = v_poa.template_id;
    SELECT lower(l.iso_code) INTO v_lang FROM public.languages l WHERE l.id = v_tpl.language_id;
    v_type_json := jsonb_build_object(
      'id', NULL,
      'key', 'template',
      'name', v_tpl.name,
      'language', COALESCE(v_lang, 'en'),
      'direction', COALESCE(v_tpl.direction, 'ltr'),
      'jurisdiction', NULL,
      'description', v_tpl.description
    );
    v_tpl_json := jsonb_build_object(
      'id', v_tpl.id,
      'name', v_tpl.name,
      'description', v_tpl.description,
      'body', v_tpl.body,
      'fields', v_tpl.fields,
      'direction', COALESCE(v_tpl.direction, 'ltr'),
      'language', COALESCE(v_lang, 'en'),
      'font_family', v_tpl.font_family,
      'font_size', v_tpl.font_size
    );
  ELSE
    SELECT * INTO v_type FROM public.poa_types WHERE id = v_poa.poa_type_id;
    v_type_json := jsonb_build_object(
      'id', v_type.id,
      'key', v_type.key,
      'name', v_type.name,
      'language', v_type.language,
      'direction', v_type.direction,
      'jurisdiction', v_type.jurisdiction,
      'description', v_type.description
    );
  END IF;

  -- First view: flip pending/sent -> viewed
  IF v_poa.status IN ('pending', 'sent') THEN
    UPDATE public.poa_documents
      SET status = 'viewed', viewed_at = COALESCE(viewed_at, now())
      WHERE id = v_poa.id;
    v_poa.status := 'viewed';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'poa', jsonb_build_object(
      'id', v_poa.id,
      'status', v_poa.status,
      'field_data', v_poa.field_data,
      'signatures', v_poa.signatures,
      'signer_name', v_poa.signer_name,
      'signer_email', v_poa.signer_email,
      'signed_at', v_poa.signed_at,
      'created_at', v_poa.created_at
    ),
    'type', v_type_json,
    'template', v_tpl_json,
    'contact', jsonb_build_object(
      'id', v_contact.id,
      'name', v_contact.name,
      'email', v_contact.email,
      'phone', v_contact.phone,
      'mobile', v_contact.mobile,
      'address', v_contact.address,
      'id_passport', v_contact.id_passport
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.poa_get_public(TEXT) TO anon, authenticated;

-- List POAs for a contact (newest first), covering both types and templates.
CREATE OR REPLACE FUNCTION public.poa_list_for_contact(p_contact_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.created_at DESC), '[]'::JSONB)
  INTO v_rows
  FROM (
    SELECT
      d.id,
      d.secure_token,
      d.status,
      d.poa_type_id,
      d.template_id,
      COALESCE(pt.key, 'template') AS type_key,
      COALESCE(pt.name, tpl.name)  AS type_name,
      COALESCE(pt.language, d.language) AS type_language,
      d.signer_name,
      d.created_at,
      d.sent_at,
      d.viewed_at,
      d.signed_at,
      d.expires_at
    FROM public.poa_documents d
    LEFT JOIN public.poa_types pt ON pt.id = d.poa_type_id
    LEFT JOIN public.poa_templates tpl ON tpl.id = d.template_id
    WHERE d.contact_id = p_contact_id
  ) t;

  RETURN jsonb_build_object('ok', true, 'poas', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.poa_list_for_contact(BIGINT) TO authenticated;
