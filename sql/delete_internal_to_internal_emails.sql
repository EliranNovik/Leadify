-- Delete emails where sender is @lawoffice.org.il AND all recipients are @lawoffice.org.il
-- This script removes internal-to-internal emails that should not be saved

-- First, let's see how many emails will be affected (for verification)
-- This uses a helper function approach which is more reliable than regex
SELECT 
    COUNT(*) as emails_to_delete,
    COUNT(DISTINCT sender_email) as unique_senders,
    MIN(sent_at) as earliest_email,
    MAX(sent_at) as latest_email
FROM emails
WHERE 
    -- Sender must be from @lawoffice.org.il domain
    LOWER(sender_email) LIKE '%@lawoffice.org.il'
    -- Recipient_list must exist and not be empty
    AND recipient_list IS NOT NULL 
    AND recipient_list != ''
    -- All recipients must be from @lawoffice.org.il domain
    -- We check this by removing all @lawoffice.org.il occurrences and checking if any @ remains
    -- If no @ remains after removal, all emails were from @lawoffice.org.il
    AND LOWER(REPLACE(recipient_list, '@lawoffice.org.il', '')) NOT LIKE '%@%';

-- Alternative: More explicit check using regex (if the above doesn't work)
/*
SELECT 
    COUNT(*) as emails_to_delete
FROM emails
WHERE 
    LOWER(sender_email) LIKE '%@lawoffice.org.il'
    AND recipient_list IS NOT NULL 
    AND recipient_list != ''
    -- Regex: all emails must end with @lawoffice.org.il
    -- Pattern matches: email@lawoffice.org.il, email@lawoffice.org.il, email@lawoffice.org.il
    AND LOWER(recipient_list) ~ '^([^,@]+@lawoffice\.org\.il\s*,\s*)*[^,@]+@lawoffice\.org\.il\s*$';
*/

-- If the above count looks correct, uncomment and run the DELETE statement below
-- WARNING: This will permanently delete the emails!

/*
DELETE FROM emails
WHERE 
    -- Sender must be from @lawoffice.org.il domain
    LOWER(sender_email) LIKE '%@lawoffice.org.il'
    -- Recipient_list must exist and not be empty
    AND recipient_list IS NOT NULL 
    AND recipient_list != ''
    -- All recipients must be from @lawoffice.org.il domain
    -- Check: after removing @lawoffice.org.il, no @ symbols should remain
    AND LOWER(REPLACE(recipient_list, '@lawoffice.org.il', '')) NOT LIKE '%@%';
*/

-- Alternative DELETE using regex (if the above doesn't work)
/*
DELETE FROM emails
WHERE 
    LOWER(sender_email) LIKE '%@lawoffice.org.il'
    AND recipient_list IS NOT NULL 
    AND recipient_list != ''
    AND LOWER(recipient_list) ~ '^([^,@]+@lawoffice\.org\.il\s*,\s*)*[^,@]+@lawoffice\.org\.il\s*$';
*/
