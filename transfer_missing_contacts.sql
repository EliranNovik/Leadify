-- STEP 1: Check for invalid foreign key references
-- This identifies rows with lead_id or contact_id that don't exist in their respective tables

SELECT 
    COUNT(*) as rows_with_invalid_lead_id
FROM 
    src_leads_leadcontact src
WHERE 
    src.lead_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_lead ll 
        WHERE ll.id = src.lead_id
    );

SELECT 
    COUNT(*) as rows_with_invalid_contact_id
FROM 
    src_leads_leadcontact src
WHERE 
    src.contact_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_contact lc 
        WHERE lc.id = src.contact_id
    );

-- STEP 1b: Count and list EXCLUDED leads (unique lead_ids that don't exist)
-- This shows how many unique lead_ids are invalid

SELECT 
    COUNT(DISTINCT src.lead_id) as excluded_leads_count
FROM 
    src_leads_leadcontact src
WHERE 
    src.lead_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_lead ll 
        WHERE ll.id = src.lead_id
    )
    AND NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = src.contact_id 
          AND llc.lead_id = src.lead_id
    );

-- STEP 1c: List of EXCLUDED lead_ids with details
-- This shows all unique lead_ids that will be excluded

SELECT 
    src.lead_id as excluded_lead_id,
    COUNT(*) as affected_rows_count,
    COUNT(DISTINCT src.contact_id) as affected_contacts_count
FROM 
    src_leads_leadcontact src
WHERE 
    src.lead_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_lead ll 
        WHERE ll.id = src.lead_id
    )
    AND NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = src.contact_id 
          AND llc.lead_id = src.lead_id
    )
GROUP BY src.lead_id
ORDER BY src.lead_id;

-- STEP 1d: Count and list EXCLUDED contacts (unique contact_ids that don't exist)

SELECT 
    COUNT(DISTINCT src.contact_id) as excluded_contacts_count
FROM 
    src_leads_leadcontact src
WHERE 
    src.contact_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_contact lc 
        WHERE lc.id = src.contact_id
    )
    AND NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = src.contact_id 
          AND llc.lead_id = src.lead_id
    );

-- STEP 1e: List of EXCLUDED contact_ids with details

SELECT 
    src.contact_id as excluded_contact_id,
    COUNT(*) as affected_rows_count,
    COUNT(DISTINCT src.lead_id) as affected_leads_count
FROM 
    src_leads_leadcontact src
WHERE 
    src.contact_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_contact lc 
        WHERE lc.id = src.contact_id
    )
    AND NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = src.contact_id 
          AND llc.lead_id = src.lead_id
    )
GROUP BY src.contact_id
ORDER BY src.contact_id;

-- STEP 2: Count how many VALID rows will be transferred
-- This counts rows that:
-- 1. Don't already exist in lead_leadcontact
-- 2. Have valid foreign key references (lead_id exists in leads_lead, contact_id exists in leads_contact)

SELECT 
    COUNT(*) as valid_rows_to_transfer_count
FROM 
    src_leads_leadcontact src
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = src.contact_id 
          AND llc.lead_id = src.lead_id
    )
    AND src.contact_id IS NOT NULL
    AND src.lead_id IS NOT NULL
    -- Validate foreign keys
    AND EXISTS (
        SELECT 1 
        FROM leads_contact lc 
        WHERE lc.id = src.contact_id
    )
    AND EXISTS (
        SELECT 1 
        FROM leads_lead ll 
        WHERE ll.id = src.lead_id
    );

-- Optional: See breakdown by main contact status (for valid rows only)
-- Uncomment to see more details

/*
SELECT 
    COUNT(*) as total_valid_rows_to_transfer,
    COUNT(CASE WHEN src.main = true THEN 1 END) as main_contacts_count,
    COUNT(CASE WHEN src.main = false OR src.main IS NULL THEN 1 END) as non_main_contacts_count
FROM 
    src_leads_leadcontact src
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = src.contact_id 
          AND llc.lead_id = src.lead_id
    )
    AND src.contact_id IS NOT NULL
    AND src.lead_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM leads_contact lc WHERE lc.id = src.contact_id)
    AND EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = src.lead_id);
*/

-- ============================================================================
-- STEP 3: Transfer missing rows from src_leads_leadcontact to lead_leadcontact
-- ============================================================================
-- IMPORTANT: Review the counts above before running this INSERT statement
-- This will insert rows that:
-- 1. Don't already exist in lead_leadcontact
-- 2. Have valid foreign key references (lead_id and contact_id exist in their tables)

INSERT INTO lead_leadcontact (
    main,
    contact_id,
    lead_id,
    contract_html,
    signed_contract_html,
    uid,
    public_token,
    newlead_id
)
SELECT 
    CASE 
        WHEN src.main = true THEN 'true'
        WHEN src.main = false THEN 'false'
        ELSE NULL
    END as main,
    src.contact_id,
    src.lead_id,
    src.contract_html,
    src.signed_contract_html,
    src.uid,
    NULL as public_token,  -- Not in source table, set to NULL
    NULL as newlead_id     -- Not in source table, set to NULL
FROM 
    src_leads_leadcontact src
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = src.contact_id 
          AND llc.lead_id = src.lead_id
    )
    AND src.contact_id IS NOT NULL
    AND src.lead_id IS NOT NULL
    -- Validate foreign keys to avoid constraint violations
    AND EXISTS (
        SELECT 1 
        FROM leads_contact lc 
        WHERE lc.id = src.contact_id
    )
    AND EXISTS (
        SELECT 1 
        FROM leads_lead ll 
        WHERE ll.id = src.lead_id
    );

-- ============================================================================
-- STEP 4: Verify the transfer (run after INSERT)
-- ============================================================================
-- This should now show 0 or a much smaller number

SELECT 
    COUNT(*) as still_missing_contacts_count
FROM 
    leads_contact lc
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    );

-- ============================================================================
-- STEP 4b: Investigate the still-missing contacts
-- ============================================================================
-- Check if missing contacts exist in src_leads_leadcontact

SELECT 
    COUNT(*) as missing_contacts_in_source_table
FROM 
    leads_contact lc
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    )
    AND EXISTS (
        SELECT 1 
        FROM src_leads_leadcontact src 
        WHERE src.contact_id = lc.id
    );

-- STEP 4c: List missing contacts that exist in src_leads_leadcontact but weren't transferred
-- This helps identify why they weren't transferred

SELECT 
    lc.id as contact_id,
    lc.name,
    lc.email,
    lc.mobile,
    src.lead_id,
    src.main,
    lc.newlead_id,
    CASE 
        WHEN src.lead_id IS NOT NULL 
             AND NOT EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = src.lead_id)
        THEN 'Invalid lead_id'
        WHEN src.lead_id IS NULL
        THEN 'No lead_id in source'
        WHEN EXISTS (
            SELECT 1 
            FROM lead_leadcontact llc 
            WHERE llc.contact_id = src.contact_id 
              AND llc.lead_id = src.lead_id
        )
        THEN 'Already exists in lead_leadcontact'
        ELSE 'Other reason'
    END as why_not_transferred,
    CASE 
        WHEN lc.newlead_id IS NOT NULL 
             AND EXISTS (SELECT 1 FROM leads l WHERE l.id = lc.newlead_id)
        THEN 'Can use newlead_id'
        ELSE 'Cannot use newlead_id'
    END as newlead_id_option
FROM 
    leads_contact lc
    INNER JOIN src_leads_leadcontact src ON src.contact_id = lc.id
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    )
ORDER BY lc.id;

-- STEP 4d: Count missing contacts that DON'T exist in src_leads_leadcontact at all

SELECT 
    COUNT(*) as missing_contacts_not_in_source
FROM 
    leads_contact lc
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    )
    AND NOT EXISTS (
        SELECT 1 
        FROM src_leads_leadcontact src 
        WHERE src.contact_id = lc.id
    );

-- STEP 4e: List missing contacts that DON'T exist in src_leads_leadcontact
-- These contacts need to be created manually or are orphaned

SELECT 
    lc.id as contact_id,
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
    AND NOT EXISTS (
        SELECT 1 
        FROM src_leads_leadcontact src 
        WHERE src.contact_id = lc.id
    )
ORDER BY lc.id;

-- STEP 4f: Check if missing contacts have newlead_id and could be connected that way
-- Some contacts might be connected via newlead_id instead of lead_id

SELECT 
    COUNT(*) as missing_contacts_with_newlead_id
FROM 
    leads_contact lc
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    )
    AND lc.newlead_id IS NOT NULL;

-- STEP 4g: List missing contacts with newlead_id that could potentially be connected
-- Note: This requires checking if the newlead_id exists in the leads table

SELECT 
    lc.id as contact_id,
    lc.name,
    lc.email,
    lc.newlead_id,
    CASE 
        WHEN EXISTS (SELECT 1 FROM leads l WHERE l.id = lc.newlead_id)
        THEN 'newlead_id exists in leads table'
        ELSE 'newlead_id does not exist in leads table'
    END as newlead_id_status
FROM 
    leads_contact lc
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    )
    AND lc.newlead_id IS NOT NULL
ORDER BY lc.id;

-- ============================================================================
-- STEP 4h: Solution for the 3 contacts in src_leads_leadcontact with invalid lead_id
-- ============================================================================
-- This transfers contacts that exist in src_leads_leadcontact but have invalid lead_id
-- Uses newlead_id if available, otherwise creates entry with NULL lead_id

-- First, check how many can be transferred using newlead_id
SELECT 
    COUNT(*) as can_transfer_with_newlead_id
FROM 
    leads_contact lc
    INNER JOIN src_leads_leadcontact src ON src.contact_id = lc.id
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    )
    AND src.lead_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = src.lead_id)
    AND lc.newlead_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM leads l WHERE l.id = lc.newlead_id);

-- STEP 4i: Transfer the 3 contacts using newlead_id (if they have valid newlead_id)
-- This handles contacts with invalid lead_id but valid newlead_id

INSERT INTO lead_leadcontact (
    main,
    contact_id,
    lead_id,
    contract_html,
    signed_contract_html,
    uid,
    public_token,
    newlead_id
)
SELECT 
    CASE 
        WHEN src.main = true THEN 'true'
        WHEN src.main = false THEN 'false'
        ELSE NULL
    END as main,
    lc.id as contact_id,
    NULL as lead_id,  -- Set to NULL since lead_id is invalid
    src.contract_html,
    src.signed_contract_html,
    src.uid,
    NULL as public_token,
    lc.newlead_id  -- Use newlead_id from leads_contact
FROM 
    leads_contact lc
    INNER JOIN src_leads_leadcontact src ON src.contact_id = lc.id
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    )
    AND src.lead_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = src.lead_id)
    AND lc.newlead_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM leads l WHERE l.id = lc.newlead_id)
    AND NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id 
          AND llc.newlead_id = lc.newlead_id
    );

-- STEP 4j: List remaining contacts that cannot be transferred (no valid newlead_id)
-- These contacts have invalid lead_id and no valid newlead_id

SELECT 
    lc.id as contact_id,
    lc.name,
    lc.email,
    lc.mobile,
    src.lead_id as invalid_lead_id,
    lc.newlead_id,
    CASE 
        WHEN lc.newlead_id IS NULL THEN 'No newlead_id'
        WHEN NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = lc.newlead_id) THEN 'newlead_id does not exist in leads table'
        ELSE 'Other'
    END as why_cannot_transfer
FROM 
    leads_contact lc
    INNER JOIN src_leads_leadcontact src ON src.contact_id = lc.id
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = lc.id
    )
    AND src.lead_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = src.lead_id)
    AND (
        lc.newlead_id IS NULL 
        OR NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = lc.newlead_id)
    )
ORDER BY lc.id;

-- ============================================================================
-- STEP 5: Detailed exclusion report (all rows being skipped)
-- ============================================================================
-- This shows all rows that will be excluded with their exclusion reasons

SELECT 
    src.id as src_id,
    src.contact_id,
    src.lead_id,
    src.main,
    CASE 
        WHEN src.lead_id IS NOT NULL 
             AND NOT EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = src.lead_id)
             AND src.contact_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM leads_contact lc WHERE lc.id = src.contact_id)
        THEN 'Invalid lead_id (contact exists)'
        WHEN src.contact_id IS NOT NULL 
             AND NOT EXISTS (SELECT 1 FROM leads_contact lc WHERE lc.id = src.contact_id)
             AND src.lead_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = src.lead_id)
        THEN 'Invalid contact_id (lead exists)'
        WHEN (src.lead_id IS NOT NULL 
              AND NOT EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = src.lead_id))
             AND (src.contact_id IS NOT NULL 
                  AND NOT EXISTS (SELECT 1 FROM leads_contact lc WHERE lc.id = src.contact_id))
        THEN 'Both lead_id and contact_id invalid'
        ELSE 'Other'
    END as exclusion_reason
FROM 
    src_leads_leadcontact src
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM lead_leadcontact llc 
        WHERE llc.contact_id = src.contact_id 
          AND llc.lead_id = src.lead_id
    )
    AND src.contact_id IS NOT NULL
    AND src.lead_id IS NOT NULL
    AND (
        NOT EXISTS (SELECT 1 FROM leads_contact lc WHERE lc.id = src.contact_id)
        OR NOT EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = src.lead_id)
    )
ORDER BY 
    exclusion_reason,
    src.lead_id,
    src.contact_id;
