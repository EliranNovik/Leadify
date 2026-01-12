-- Find lead number for a legacy contract
-- The URL shows: /public-legacy-contract/204912/46aab9e5-f9c0-48e3-afa6-f2a730c7bab0
-- Where 204912 is likely the contact_id or lead_id

-- Option 1: Search by contact_id (if 204912 is the contact ID)
SELECT 
    llc.id as contact_id,
    llc.lead_id,
    ll.lead_number,
    ll.manual_id,
    ll.id as lead_table_id,
    CASE 
        WHEN ll.lead_number IS NOT NULL THEN ll.lead_number::text
        WHEN ll.manual_id IS NOT NULL THEN ll.manual_id::text
        ELSE ll.id::text
    END as display_lead_number,
    ll.name as lead_name,
    llc.signed_contract_html IS NOT NULL as has_signed_contract
FROM lead_leadcontact llc
INNER JOIN leads_lead ll ON llc.lead_id = ll.id
WHERE llc.id = 204912
    AND llc.signed_contract_html IS NOT NULL;

-- Option 2: Search by lead_id (if 204912 is the lead ID)
SELECT 
    llc.id as contact_id,
    llc.lead_id,
    ll.lead_number,
    ll.manual_id,
    ll.id as lead_table_id,
    CASE 
        WHEN ll.lead_number IS NOT NULL THEN ll.lead_number::text
        WHEN ll.manual_id IS NOT NULL THEN ll.manual_id::text
        ELSE ll.id::text
    END as display_lead_number,
    ll.name as lead_name,
    llc.signed_contract_html IS NOT NULL as has_signed_contract
FROM lead_leadcontact llc
INNER JOIN leads_lead ll ON llc.lead_id = ll.id
WHERE llc.lead_id = 204912
    AND llc.signed_contract_html IS NOT NULL;

-- Option 3: Search by UUID in the signed_contract_html (if the UUID is stored in the HTML)
-- This searches for the UUID string in the HTML content
SELECT 
    llc.id as contact_id,
    llc.lead_id,
    ll.lead_number,
    ll.manual_id,
    ll.id as lead_table_id,
    CASE 
        WHEN ll.lead_number IS NOT NULL THEN ll.lead_number::text
        WHEN ll.manual_id IS NOT NULL THEN ll.manual_id::text
        ELSE ll.id::text
    END as display_lead_number,
    ll.name as lead_name,
    llc.signed_contract_html IS NOT NULL as has_signed_contract
FROM lead_leadcontact llc
INNER JOIN leads_lead ll ON llc.lead_id = ll.id
WHERE llc.signed_contract_html IS NOT NULL
    AND llc.signed_contract_html::text LIKE '%46aab9e5-f9c0-48e3-afa6-f2a730c7bab0%';

-- Option 4: Search all contacts with signed contracts for lead_id 204912
-- (In case the number in the URL is the lead_id)
SELECT 
    llc.id as contact_id,
    llc.lead_id,
    ll.lead_number,
    ll.manual_id,
    ll.id as lead_table_id,
    CASE 
        WHEN ll.lead_number IS NOT NULL THEN ll.lead_number::text
        WHEN ll.manual_id IS NOT NULL THEN ll.manual_id::text
        ELSE ll.id::text
    END as display_lead_number,
    ll.name as lead_name,
    llc.signed_contract_html IS NOT NULL as has_signed_contract,
    LEFT(llc.signed_contract_html::text, 200) as contract_preview
FROM lead_leadcontact llc
INNER JOIN leads_lead ll ON llc.lead_id = ll.id
WHERE ll.id = 204912
    AND llc.signed_contract_html IS NOT NULL;

-- Option 5: Comprehensive search - find by either contact_id or lead_id
SELECT 
    llc.id as contact_id,
    llc.lead_id,
    ll.lead_number,
    ll.manual_id,
    ll.id as lead_table_id,
    CASE 
        WHEN ll.lead_number IS NOT NULL THEN ll.lead_number::text
        WHEN ll.manual_id IS NOT NULL THEN ll.manual_id::text
        ELSE ll.id::text
    END as display_lead_number,
    ll.name as lead_name,
    llc.signed_contract_html IS NOT NULL as has_signed_contract
FROM lead_leadcontact llc
INNER JOIN leads_lead ll ON llc.lead_id = ll.id
WHERE (llc.id = 204912 OR llc.lead_id = 204912)
    AND llc.signed_contract_html IS NOT NULL;
