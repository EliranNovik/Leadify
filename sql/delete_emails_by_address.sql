-- Delete emails where sender_email or recipient_list contains the following emails:
-- - andrey1bar@gmail.com
-- - support@lawfirms1.com

DELETE FROM emails
WHERE sender_email ILIKE '%andrey1bar@gmail.com%'
   OR recipient_list ILIKE '%andrey1bar@gmail.com%'
   OR sender_email ILIKE '%support@lawfirms1.com%'
   OR recipient_list ILIKE '%support@lawfirms1.com%';

