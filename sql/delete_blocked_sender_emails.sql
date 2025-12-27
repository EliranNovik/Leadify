-- Delete all emails from emails table where sender_email is in the blocked list
-- This matches the BLOCKED_SENDER_EMAILS list used in the backend and frontend

DELETE FROM emails
WHERE LOWER(sender_email) IN (
  'wordpress@german-and-austrian-citizenship.lawoffice.org.il',
  'wordpress@insolvency-law.com',
  'wordpress@citizenship-for-children.usa-immigration.lawyer',
  'lawoffic@israel160.jetserver.net',
  'list@wordfence.com',
  'wordpress@usa-immigration.lawyer',
  'wordpress@heritage-based-european-citizenship.lawoffice.org.il',
  'wordpress@heritage-based-european-citizenship-heb.lawoffice.org.il',
  'no-reply@lawzana.com',
  'support@lawfirms1.com',
  'no-reply@zoom.us',
  'info@israel-properties.com',
  'notifications@invoice4u.co.il',
  'isetbeforeyou@yahoo.com',
  'no-reply@support.microsoft.com',
  'ivy@pipe.hnssd.com',
  'no-reply@mail.instagram.com',
  'no_reply@email.apple.com',
  'noreplay@maskyoo.co.il',
  'email@german-and-austrian-citizenship.lawoffice.org.il',
  'noreply@mobilepunch.com',
  'notification@facebookmail.com',
  'news@events.imhbusiness.com',
  'khawaish@usareaimmigrationservices.com',
  'message@shidurit.com'
'khawaish@usareaimmigrationservices.com'
)

