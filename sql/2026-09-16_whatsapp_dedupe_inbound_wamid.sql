-- Only remove extra copies on the SAME lead/legacy (same message twice on one timeline).
-- Do NOT collapse the same WhatsApp id across different leads — one inbound event
-- is stored once per matching lead on purpose.

DELETE FROM public.whatsapp_messages a
USING public.whatsapp_messages b
WHERE a.direction = 'in'
  AND b.direction = 'in'
  AND a.whatsapp_message_id IS NOT NULL
  AND btrim(a.whatsapp_message_id) <> ''
  AND a.whatsapp_message_id = b.whatsapp_message_id
  AND a.id > b.id
  AND a.lead_id IS NOT DISTINCT FROM b.lead_id
  AND a.legacy_id IS NOT DISTINCT FROM b.legacy_id;
