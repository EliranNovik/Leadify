-- Count contacts from leads_contact that are missing in lead_leadcontact
-- This finds contacts that don't have a corresponding entry in lead_leadcontact

SELECT 
    COUNT(*) as missing_contacts_count
FROM 
    leads_contact lc
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    );

-- Optional: Get more detailed breakdown
-- Uncomment the query below to see additional details

/*
SELECT 
    COUNT(*) as missing_contacts_count,
    COUNT(CASE WHEN lc.newlead_id IS NOT NULL THEN 1 END) as missing_with_newlead_id,
    COUNT(CASE WHEN lc.newlead_id IS NULL THEN 1 END) as missing_without_newlead_id,
    COUNT(CASE WHEN lc.lead_id IS NOT NULL THEN 1 END) as missing_with_legacy_lead_id
FROM 
    leads_contact lc
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    );
*/

-- Optional: See the actual missing contact IDs and details
-- Uncomment the query below to see the list of missing contacts

/*
SELECT 
    lc.id,
    lc.name,
    lc.email,
    lc.mobile,
    lc.phone,
    lc.newlead_id,
    lc.firm_id
FROM 
    leads_contact lc
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    )
ORDER BY lc.id;
*/
