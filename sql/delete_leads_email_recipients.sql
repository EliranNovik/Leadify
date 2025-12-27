-- Delete all emails from emails table where recipient_list contains leads@lawoffice.org.il
-- This handles both exact matches and comma-separated lists
-- NOTE: This will delete emails where leads@lawoffice.org.il appears anywhere in the recipient_list

-- First, let's see how many emails will be affected (optional - remove DELETE to test)
-- SELECT COUNT(*) FROM emails WHERE LOWER(recipient_list) LIKE '%leads@lawoffice.org.il%';

-- Delete all emails with leads@lawoffice.org.il in recipient_list
DELETE FROM emails
WHERE LOWER(recipient_list) LIKE '%leads@lawoffice.org.il%';

