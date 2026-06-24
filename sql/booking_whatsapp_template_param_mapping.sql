-- WhatsApp reminder_of_a_meeting: align param_mapping with Meta template body slots.
-- Date {{1}}, Time {{2}}, Place {{3}}, Link {{4}}, Mobile {{5}}, Phone {{6}}, E-mail {{7}}

UPDATE public.whatsapp_templates_v2
SET param_mapping = '[
  {"type": "meeting_date"},
  {"type": "meeting_time"},
  {"type": "location"},
  {"type": "meeting_link"},
  {"type": "mobile_number"},
  {"type": "phone_number"},
  {"type": "email"}
]'::jsonb
WHERE name = 'reminder_of_a_meeting';
