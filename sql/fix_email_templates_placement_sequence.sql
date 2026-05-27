-- Fix email_templates_placement id sequence after duplicate-key errors on seed.
-- Safe to re-run.

ALTER TABLE public.email_templates_placement
ADD COLUMN IF NOT EXISTS code text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_templates_placement_code
  ON public.email_templates_placement (code)
  WHERE code IS NOT NULL;

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

SELECT setval(
  pg_get_serial_sequence('public.email_templates_placement', 'id'),
  COALESCE((SELECT MAX(id) FROM public.email_templates_placement), 1),
  true
);

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
