-- Function to automatically create a main contact for new leads
CREATE OR REPLACE FUNCTION create_auto_main_contact_for_lead()
RETURNS TRIGGER AS $$
DECLARE
    new_contact_id bigint;
BEGIN
    -- Only proceed if this is a NEW lead (INSERT) and not an UPDATE
    IF (TG_OP = 'INSERT') THEN
        -- Create a contact record with the lead's main information
        INSERT INTO leads_contact (
            cdate,
            udate,
            name,
            mobile,
            phone,
            email,
            newlead_id,
            creator_id,
            firm_id
        )
        VALUES (
            CURRENT_DATE,
            CURRENT_DATE,
            NEW.name,
            NEW.mobile,
            NEW.phone,
            NEW.email,
            NEW.id,  -- Link to the new lead
            NULL,    -- creator_id can be set later
            NULL     -- firm_id can be set later
        )
        RETURNING id INTO new_contact_id;

        -- Create the junction record linking lead to contact as MAIN contact
        INSERT INTO lead_leadcontact (
            contact_id,
            lead_id,
            newlead_id,
            main
        )
        VALUES (
            new_contact_id,
            NULL,           -- lead_id is for legacy leads only
            NEW.id,         -- newlead_id for new leads
            'true'          -- Mark as main contact
        );

        RAISE NOTICE 'Auto-created main contact (ID: %) for lead %', new_contact_id, NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trg_auto_create_main_contact ON leads;

-- Create trigger on leads table
CREATE TRIGGER trg_auto_create_main_contact
AFTER INSERT ON leads
FOR EACH ROW
EXECUTE FUNCTION create_auto_main_contact_for_lead();

-- Add comment for documentation
COMMENT ON FUNCTION create_auto_main_contact_for_lead() IS 
'Automatically creates a main contact in leads_contact and links it via lead_leadcontact when a new lead is created. This ensures every lead has at least one contact for WhatsApp messaging and other communication.';

-- Verify trigger was created
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE trigger_name = 'trg_auto_create_main_contact';

