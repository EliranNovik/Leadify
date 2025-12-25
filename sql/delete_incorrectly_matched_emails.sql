-- Delete emails where legacy_id is set but sender_email doesn't match any contact in that lead
-- This fixes the issue where emails were matched to leads based on recipient list
-- when the sender was actually a different client
-- Note: Emails from office (@lawoffice.org.il) are preserved as they should be matched based on recipients

-- For legacy leads: Delete emails where sender doesn't match lead email or any contact email
-- BUT preserve emails where sender is from office (those should be matched based on recipients)
DELETE FROM emails e
WHERE e.legacy_id IS NOT NULL
  -- Don't delete if sender is from office (those are matched based on recipients)
  AND NOT (LOWER(TRIM(e.sender_email)) LIKE '%@lawoffice.org.il')
  AND NOT EXISTS (
    -- Check if sender matches the lead's main email
    SELECT 1
    FROM leads_lead ll
    WHERE ll.id = e.legacy_id
      AND LOWER(TRIM(ll.email)) = LOWER(TRIM(e.sender_email))
  )
  AND NOT EXISTS (
    -- Check if sender matches any contact in this lead
    SELECT 1
    FROM lead_leadcontact llc
    JOIN leads_contact lc ON lc.id = llc.contact_id
    WHERE llc.lead_id = e.legacy_id
      AND LOWER(TRIM(lc.email)) = LOWER(TRIM(e.sender_email))
  )
  AND NOT EXISTS (
    -- Also check newlead_id relationships for legacy contacts
    SELECT 1
    FROM lead_leadcontact llc
    JOIN leads_contact lc ON lc.id = llc.contact_id
    WHERE llc.newlead_id IN (
      SELECT id FROM leads WHERE id IN (
        SELECT DISTINCT newlead_id FROM lead_leadcontact WHERE lead_id = e.legacy_id
      )
    )
      AND LOWER(TRIM(lc.email)) = LOWER(TRIM(e.sender_email))
  );

-- For new leads (client_id): Delete emails where sender doesn't match lead email or any contact email
-- BUT preserve emails where sender is from office (those should be matched based on recipients)
DELETE FROM emails e
WHERE e.client_id IS NOT NULL
  -- Don't delete if sender is from office (those are matched based on recipients)
  AND NOT (LOWER(TRIM(e.sender_email)) LIKE '%@lawoffice.org.il')
  AND NOT EXISTS (
    -- Check if sender matches the lead's main email
    SELECT 1
    FROM leads l
    WHERE l.id = e.client_id
      AND LOWER(TRIM(l.email)) = LOWER(TRIM(e.sender_email))
  )
  AND NOT EXISTS (
    -- Check if sender matches any contact in this lead
    SELECT 1
    FROM leads_contact lc
    WHERE lc.newlead_id = e.client_id
      AND LOWER(TRIM(lc.email)) = LOWER(TRIM(e.sender_email))
  )
  AND NOT EXISTS (
    -- Also check legacy lead relationships for contacts
    SELECT 1
    FROM lead_leadcontact llc
    JOIN leads_contact lc ON lc.id = llc.contact_id
    WHERE llc.newlead_id = e.client_id
      AND LOWER(TRIM(lc.email)) = LOWER(TRIM(e.sender_email))
  );

-- Note: This query will delete emails that were incorrectly matched.
-- Emails where sender is from office (@lawoffice.org.il) are not affected by this query
-- as they should be matched based on recipients, not sender.

