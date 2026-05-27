-- Email template automation: map meeting location + placement + language → misc_emailtemplate
-- Run after misc_emailtemplate, email_templates_placement, misc_language, tenants_meetinglocation exist.

-- Stable placement codes for meeting-tab email actions
ALTER TABLE public.email_templates_placement
ADD COLUMN IF NOT EXISTS code text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_templates_placement_code
  ON public.email_templates_placement (code)
  WHERE code IS NOT NULL;

-- Tag existing rows by name (avoids inserting duplicate placement rows)
UPDATE public.email_templates_placement AS p
SET code = v.code
FROM (VALUES
  ('Meeting Invitation', 'meeting_invitation'),
  ('Meeting Invitation JLM', 'meeting_invitation_jlm'),
  ('Meeting Invitation TLV', 'meeting_invitation_tlv'),
  ('Meeting Invitation TLV + Parking', 'meeting_invitation_tlv_parking'),
  ('Meeting Reminder', 'meeting_reminder'),
  ('Meeting Cancellation', 'meeting_cancellation'),
  ('Meeting Rescheduled', 'meeting_rescheduled')
) AS v(name, code)
WHERE p.code IS NULL
  AND lower(trim(p.name)) = lower(trim(v.name));

-- Resync id sequence (table often has rows with ids > sequence after imports/manual inserts)
SELECT setval(
  pg_get_serial_sequence('public.email_templates_placement', 'id'),
  COALESCE((SELECT MAX(id) FROM public.email_templates_placement), 1),
  true
);

-- Insert only placements that do not exist yet (by code)
INSERT INTO public.email_templates_placement (name, code)
SELECT v.name, v.code
FROM (VALUES
  ('Meeting Invitation', 'meeting_invitation'),
  ('Meeting Invitation JLM', 'meeting_invitation_jlm'),
  ('Meeting Invitation TLV', 'meeting_invitation_tlv'),
  ('Meeting Invitation TLV + Parking', 'meeting_invitation_tlv_parking'),
  ('Meeting Reminder', 'meeting_reminder'),
  ('Meeting Cancellation', 'meeting_cancellation'),
  ('Meeting Rescheduled', 'meeting_rescheduled')
) AS v(name, code)
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates_placement p WHERE p.code = v.code
);

CREATE TABLE IF NOT EXISTS public.email_templates_automation (
  id bigserial PRIMARY KEY,
  meeting_location_id bigint NULL REFERENCES public.tenants_meetinglocation (id) ON DELETE CASCADE,
  placement_id bigint NOT NULL REFERENCES public.email_templates_placement (id) ON DELETE RESTRICT,
  language_id bigint NOT NULL REFERENCES public.misc_language (id) ON DELETE RESTRICT,
  email_template_id bigint NOT NULL REFERENCES public.misc_emailtemplate (id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_templates_automation_location_placement_lang
  ON public.email_templates_automation (meeting_location_id, placement_id, language_id)
  WHERE meeting_location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_templates_automation_global_placement_lang
  ON public.email_templates_automation (placement_id, language_id)
  WHERE meeting_location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_templates_automation_location
  ON public.email_templates_automation (meeting_location_id)
  WHERE meeting_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_templates_automation_placement
  ON public.email_templates_automation (placement_id);

CREATE INDEX IF NOT EXISTS idx_email_templates_automation_active
  ON public.email_templates_automation (is_active)
  WHERE is_active = true;

COMMENT ON TABLE public.email_templates_automation IS
  'Maps meeting location + email placement + language to a misc_emailtemplate row. NULL meeting_location_id = fallback for all locations.';

COMMENT ON COLUMN public.email_templates_automation.meeting_location_id IS
  'tenants_meetinglocation.id; NULL applies when no location-specific rule exists.';

CREATE OR REPLACE FUNCTION public.update_email_templates_automation_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_templates_automation_updated_at ON public.email_templates_automation;
CREATE TRIGGER trg_email_templates_automation_updated_at
  BEFORE UPDATE ON public.email_templates_automation
  FOR EACH ROW
  EXECUTE FUNCTION public.update_email_templates_automation_updated_at();

ALTER TABLE public.email_templates_automation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read email_templates_automation" ON public.email_templates_automation;
CREATE POLICY "Allow authenticated read email_templates_automation" ON public.email_templates_automation
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert email_templates_automation" ON public.email_templates_automation;
CREATE POLICY "Allow authenticated insert email_templates_automation" ON public.email_templates_automation
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update email_templates_automation" ON public.email_templates_automation;
CREATE POLICY "Allow authenticated update email_templates_automation" ON public.email_templates_automation
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated delete email_templates_automation" ON public.email_templates_automation;
CREATE POLICY "Allow authenticated delete email_templates_automation" ON public.email_templates_automation
  FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates_automation TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.email_templates_automation_id_seq TO authenticated;

-- Seed rows mirroring legacy MeetingTab hardcoded template IDs (English + Hebrew).
-- Adjust location names/IDs in admin after deploy if your tenants_meetinglocation rows differ.
WITH langs AS (
  SELECT
    (SELECT id FROM public.misc_language WHERE lower(name) LIKE '%english%' OR lower(name) = 'en' ORDER BY id LIMIT 1) AS en_id,
    (SELECT id FROM public.misc_language WHERE lower(name) LIKE '%hebrew%' OR lower(name) LIKE '%heb%' OR lower(name) = 'he' ORDER BY id LIMIT 1) AS he_id
),
placements AS (
  SELECT id, code FROM public.email_templates_placement WHERE code IS NOT NULL
),
loc AS (
  SELECT id, lower(name) AS name_lc FROM public.tenants_meetinglocation
)
INSERT INTO public.email_templates_automation (meeting_location_id, placement_id, language_id, email_template_id, notes)
SELECT NULL, p.id, l.en_id, t.template_id, 'Legacy default (all locations)'
FROM placements p
JOIN langs l ON l.en_id IS NOT NULL
JOIN (VALUES
  ('meeting_reminder', 163),
  ('meeting_cancellation', 153),
  ('meeting_rescheduled', 155)
) AS t(code, template_id) ON t.code = p.code
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates_automation e
  WHERE e.meeting_location_id IS NULL AND e.placement_id = p.id AND e.language_id = l.en_id
);

WITH langs AS (
  SELECT
    (SELECT id FROM public.misc_language WHERE lower(name) LIKE '%english%' OR lower(name) = 'en' ORDER BY id LIMIT 1) AS en_id,
    (SELECT id FROM public.misc_language WHERE lower(name) LIKE '%hebrew%' OR lower(name) LIKE '%heb%' OR lower(name) = 'he' ORDER BY id LIMIT 1) AS he_id
),
placements AS (
  SELECT id, code FROM public.email_templates_placement WHERE code IS NOT NULL
)
INSERT INTO public.email_templates_automation (meeting_location_id, placement_id, language_id, email_template_id, notes)
SELECT NULL, p.id, l.he_id, t.template_id, 'Legacy default (all locations)'
FROM placements p
JOIN langs l ON l.he_id IS NOT NULL
JOIN (VALUES
  ('meeting_reminder', 167),
  ('meeting_cancellation', 154),
  ('meeting_rescheduled', 156)
) AS t(code, template_id) ON t.code = p.code
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates_automation e
  WHERE e.meeting_location_id IS NULL AND e.placement_id = p.id AND e.language_id = l.he_id
);

-- Location-specific invitation templates (English)
INSERT INTO public.email_templates_automation (meeting_location_id, placement_id, language_id, email_template_id, notes)
SELECT loc.id, p.id, l.en_id, t.template_id, 'Legacy location invitation (EN)'
FROM public.tenants_meetinglocation loc
CROSS JOIN (SELECT id FROM public.misc_language WHERE lower(name) LIKE '%english%' OR lower(name) = 'en' ORDER BY id LIMIT 1) l(en_id)
CROSS JOIN public.email_templates_placement p
JOIN (VALUES
  ('meeting_invitation', 151),
  ('meeting_invitation_jlm', 157),
  ('meeting_invitation_tlv', 161),
  ('meeting_invitation_tlv_parking', 159)
) AS t(code, template_id) ON t.code = p.code
WHERE (
  (p.code = 'meeting_invitation_jlm' AND (loc.name ILIKE '%jrslm%' OR loc.name ILIKE '%jerusalem%'))
  OR (p.code = 'meeting_invitation_tlv_parking' AND loc.name ILIKE '%tlv%' AND loc.name ILIKE '%parking%')
  OR (p.code = 'meeting_invitation_tlv' AND loc.name ILIKE '%tlv%' AND loc.name NOT ILIKE '%parking%' AND loc.name NOT ILIKE '%jrslm%')
  OR (p.code = 'meeting_invitation' AND loc.name ILIKE '%teams%')
)
AND NOT EXISTS (
  SELECT 1 FROM public.email_templates_automation e
  WHERE e.meeting_location_id = loc.id AND e.placement_id = p.id AND e.language_id = l.en_id
);

-- Location-specific invitation templates (Hebrew)
INSERT INTO public.email_templates_automation (meeting_location_id, placement_id, language_id, email_template_id, notes)
SELECT loc.id, p.id, l.he_id, t.template_id, 'Legacy location invitation (HE)'
FROM public.tenants_meetinglocation loc
CROSS JOIN (SELECT id FROM public.misc_language WHERE lower(name) LIKE '%hebrew%' OR lower(name) LIKE '%heb%' OR lower(name) = 'he' ORDER BY id LIMIT 1) l(he_id)
CROSS JOIN public.email_templates_placement p
JOIN (VALUES
  ('meeting_invitation', 152),
  ('meeting_invitation_jlm', 158),
  ('meeting_invitation_tlv', 162),
  ('meeting_invitation_tlv_parking', 160)
) AS t(code, template_id) ON t.code = p.code
WHERE (
  (p.code = 'meeting_invitation_jlm' AND (loc.name ILIKE '%jrslm%' OR loc.name ILIKE '%jerusalem%'))
  OR (p.code = 'meeting_invitation_tlv_parking' AND loc.name ILIKE '%tlv%' AND loc.name ILIKE '%parking%')
  OR (p.code = 'meeting_invitation_tlv' AND loc.name ILIKE '%tlv%' AND loc.name NOT ILIKE '%parking%' AND loc.name NOT ILIKE '%jrslm%')
  OR (p.code = 'meeting_invitation' AND loc.name ILIKE '%teams%')
)
AND NOT EXISTS (
  SELECT 1 FROM public.email_templates_automation e
  WHERE e.meeting_location_id = loc.id AND e.placement_id = p.id AND e.language_id = l.he_id
);
