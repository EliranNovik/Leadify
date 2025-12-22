-- Script to backfill missing main contacts for existing leads
-- This creates contacts for leads that don't have one yet

-- First, let's identify leads without contacts
WITH leads_without_contacts AS (
    SELECT 
        l.id,
        l.name,
        l.phone,
        l.mobile,
        l.email,
        l.created_at
    FROM leads l
    LEFT JOIN lead_leadcontact llc ON llc.newlead_id = l.id AND llc.main = 'true'
    WHERE llc.id IS NULL  -- No main contact exists
)
SELECT 
    COUNT(*) as leads_without_main_contact,
    'Run the INSERT below to create missing contacts' as action
FROM leads_without_contacts;

-- Uncomment and run this to actually create the missing contacts:
/*
DO $$
DECLARE
    lead_record RECORD;
    new_contact_id bigint;
    created_count integer := 0;
BEGIN
    -- Loop through all leads without main contacts
    FOR lead_record IN 
        SELECT 
            l.id,
            l.name,
            l.phone,
            l.mobile,
            l.email,
            l.created_at
        FROM leads l
        LEFT JOIN lead_leadcontact llc ON llc.newlead_id = l.id AND llc.main = 'true'
        WHERE llc.id IS NULL
    LOOP
        -- Create contact
        INSERT INTO leads_contact (
            cdate,
            udate,
            name,
            mobile,
            phone,
            email,
            newlead_id
        )
        VALUES (
            COALESCE(lead_record.created_at::date, CURRENT_DATE),
            CURRENT_DATE,
            lead_record.name,
            lead_record.mobile,
            lead_record.phone,
            lead_record.email,
            lead_record.id
        )
        RETURNING id INTO new_contact_id;

        -- Create junction record
        INSERT INTO lead_leadcontact (
            contact_id,
            newlead_id,
            main
        )
        VALUES (
            new_contact_id,
            lead_record.id,
            'true'
        );

        created_count := created_count + 1;
        
        IF created_count % 100 = 0 THEN
            RAISE NOTICE 'Created % contacts so far...', created_count;
        END IF;
    END LOOP;

    RAISE NOTICE 'Completed! Created % main contacts for existing leads', created_count;
END $$;
*/

-- After backfilling, verify the results
SELECT 
    'Leads without main contact' as status,
    COUNT(*) as count
FROM leads l
LEFT JOIN lead_leadcontact llc ON llc.newlead_id = l.id AND llc.main = 'true'
WHERE llc.id IS NULL

UNION ALL

SELECT 
    'Leads with main contact' as status,
    COUNT(*) as count
FROM leads l
INNER JOIN lead_leadcontact llc ON llc.newlead_id = l.id AND llc.main = 'true';

