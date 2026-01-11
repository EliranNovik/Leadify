/* Step 1: Count rows where lead_id = client_id (need to be fixed) for id > 176788832 */
SELECT 
    COUNT(*) as rows_to_fix,
    COUNT(DISTINCT fpp.lead_id) as unique_leads_affected
FROM finances_paymentplanrow fpp
WHERE fpp.lead_id::bigint = fpp.client_id
  AND fpp.id > 176788832;

/* Step 2: Show sample of rows that will be fixed with their main contact info */
SELECT 
    fpp.id,
    fpp.lead_id,
    fpp.client_id as current_client_id,
    llc.contact_id as main_contact_id,
    lc.name as main_contact_name
FROM finances_paymentplanrow fpp
LEFT JOIN lead_leadcontact llc ON llc.lead_id::text = fpp.lead_id::text 
    AND LOWER(COALESCE(llc.main::text, '')) = 'true'
LEFT JOIN leads_contact lc ON lc.id = llc.contact_id
WHERE fpp.lead_id::bigint = fpp.client_id
  AND fpp.id > 176788832
LIMIT 10;

/* Step 3: Update client_id to use the main contact's contact_id */
UPDATE finances_paymentplanrow fpp
SET client_id = llc.contact_id
FROM lead_leadcontact llc
WHERE fpp.lead_id::bigint = fpp.client_id
  AND fpp.id > 176788832
  AND llc.lead_id::text = fpp.lead_id::text
  AND LOWER(COALESCE(llc.main::text, '')) = 'true'
  AND llc.contact_id IS NOT NULL;

/* Step 4: Verify the fix - count remaining rows where lead_id = client_id */
SELECT 
    COUNT(*) as remaining_problematic_rows
FROM finances_paymentplanrow
WHERE lead_id::bigint = client_id
  AND id > 176788832;
