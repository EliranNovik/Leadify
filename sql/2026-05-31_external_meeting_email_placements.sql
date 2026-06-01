-- External / internal (IM) meeting email placements for Admin → Email Templates Automation.
-- Map rows with meeting_location_id NULL + these placement codes to your external-meeting misc_emailtemplate rows.
-- Safe to re-run.

INSERT INTO public.email_templates_placement (name, code)
SELECT v.name, v.code
FROM (VALUES
  ('External Meeting Invitation', 'external_meeting_invitation'),
  ('External Meeting Invitation JLM', 'external_meeting_invitation_jlm'),
  ('External Meeting Invitation TLV', 'external_meeting_invitation_tlv'),
  ('External Meeting Invitation TLV + Parking', 'external_meeting_invitation_tlv_parking'),
  ('External Meeting Reminder', 'external_meeting_reminder'),
  ('External Meeting Cancellation', 'external_meeting_cancellation'),
  ('External Meeting Rescheduled', 'external_meeting_rescheduled')
) AS v(name, code)
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates_placement p WHERE p.code = v.code
);
