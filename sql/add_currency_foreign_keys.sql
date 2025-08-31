-- Add foreign key constraints for currency_id fields in legacy tables
-- This ensures proper currency lookup for legacy leads using accounting_currencies table

-- Add foreign key constraint for leads_lead.currency_id -> accounting_currencies.id
-- First check if the constraint already exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'leads_lead_currency_id_fkey' 
        AND table_name = 'leads_lead'
    ) THEN
        -- Add the foreign key constraint
        ALTER TABLE leads_lead 
        ADD CONSTRAINT leads_lead_currency_id_fkey 
        FOREIGN KEY (currency_id) REFERENCES accounting_currencies(id);
        
        RAISE NOTICE 'Added foreign key constraint leads_lead_currency_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint leads_lead_currency_id_fkey already exists';
    END IF;
END $$;

-- Add foreign key constraint for finances_paymentplanrow.currency_id -> accounting_currencies.id
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'finances_paymentplanrow_currency_id_fkey' 
        AND table_name = 'finances_paymentplanrow'
    ) THEN
        -- Add the foreign key constraint
        ALTER TABLE finances_paymentplanrow 
        ADD CONSTRAINT finances_paymentplanrow_currency_id_fkey 
        FOREIGN KEY (currency_id) REFERENCES accounting_currencies(id);
        
        RAISE NOTICE 'Added foreign key constraint finances_paymentplanrow_currency_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint finances_paymentplanrow_currency_id_fkey already exists';
    END IF;
END $$;

-- Verify the constraints were created
SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
    AND tc.table_schema = 'public'
    AND kcu.column_name LIKE '%currency_id%'
ORDER BY tc.table_name, tc.constraint_name;
