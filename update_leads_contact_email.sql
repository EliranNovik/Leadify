-- Update all rows in leads_contact table where email is '0' (text) to NULL
UPDATE leads_contact
SET email = NULL
WHERE email = '0';

-- Optional: Also handle cases where email might be empty string or just whitespace
-- Uncomment the following if you want to set empty strings to NULL as well:
-- UPDATE leads_contact
-- SET email = NULL
-- WHERE email = '' OR TRIM(email) = '';
