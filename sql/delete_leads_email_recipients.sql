-- Delete all emails from emails table where recipient_list contains leads@lawoffice.org.il
-- This handles both exact matches and comma-separated lists
DELETE FROM emails
WHERE LOWER(recipient_list) LIKE '%leads@lawoffice.org.il%';

