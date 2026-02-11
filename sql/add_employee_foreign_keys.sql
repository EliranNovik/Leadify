-- Add Foreign Keys for Employee Relationships
-- This allows using JOINs instead of mapping employee IDs in the frontend
-- Run this script to add foreign key constraints between leads/leads_lead and tenants_employee

-- ============================================
-- PART 0: Convert text columns to bigint if needed
-- ============================================

DO $$
DECLARE
    col_name text;
    col_type text;
    columns_to_check text[] := ARRAY[
        'case_handler_id', 'closer_id', 'meeting_scheduler_id', 
        'meeting_manager_id', 'meeting_lawyer_id', 'expert_id',
        'exclusive_handler_id', 'anchor_id'
    ];
BEGIN
    -- Check and convert columns in leads_lead table
    FOREACH col_name IN ARRAY columns_to_check
    LOOP
        -- Check if column exists and get its type
        SELECT data_type INTO col_type
        FROM information_schema.columns
        WHERE table_name = 'leads_lead' 
        AND column_name = col_name;
        
        IF col_type IS NOT NULL THEN
            IF col_type = 'text' OR col_type = 'character varying' THEN
                RAISE NOTICE 'Converting leads_lead.%.% from % to bigint', col_name, col_type;
                
                -- Clean non-numeric values first
                EXECUTE format('
                    UPDATE leads_lead 
                    SET %I = NULL 
                    WHERE %I IS NOT NULL 
                    AND %I::text != '''' 
                    AND %I::text !~ ''^[0-9]+$''
                ', col_name, col_name, col_name, col_name);
                
                -- Convert to bigint
                EXECUTE format('
                    ALTER TABLE leads_lead 
                    ALTER COLUMN %I TYPE bigint 
                    USING CASE 
                        WHEN %I::text = '''' OR %I IS NULL THEN NULL
                        ELSE (%I::text)::bigint 
                    END
                ', col_name, col_name, col_name, col_name);
                
                RAISE NOTICE 'Converted leads_lead.% to bigint', col_name;
            ELSIF col_type != 'bigint' THEN
                RAISE NOTICE 'leads_lead.% is type %, skipping conversion', col_name, col_type;
            END IF;
        END IF;
    END LOOP;
    
    -- Check and convert columns in leads table (new leads)
    FOREACH col_name IN ARRAY ARRAY['case_handler_id', 'meeting_manager_id', 'meeting_lawyer_id', 'expert_id']
    LOOP
        SELECT data_type INTO col_type
        FROM information_schema.columns
        WHERE table_name = 'leads' 
        AND column_name = col_name;
        
        IF col_type IS NOT NULL THEN
            IF col_type = 'text' OR col_type = 'character varying' THEN
                RAISE NOTICE 'Converting leads.%.% from % to bigint', col_name, col_type;
                
                -- Clean non-numeric values first
                EXECUTE format('
                    UPDATE leads 
                    SET %I = NULL 
                    WHERE %I IS NOT NULL 
                    AND %I::text != '''' 
                    AND %I::text !~ ''^[0-9]+$''
                ', col_name, col_name, col_name, col_name);
                
                -- Convert to bigint
                EXECUTE format('
                    ALTER TABLE leads 
                    ALTER COLUMN %I TYPE bigint 
                    USING CASE 
                        WHEN %I::text = '''' OR %I IS NULL THEN NULL
                        ELSE (%I::text)::bigint 
                    END
                ', col_name, col_name, col_name, col_name);
                
                RAISE NOTICE 'Converted leads.% to bigint', col_name;
            ELSIF col_type != 'bigint' THEN
                RAISE NOTICE 'leads.% is type %, skipping conversion', col_name, col_type;
            END IF;
        END IF;
    END LOOP;
END $$;

-- ============================================
-- PART 1: Foreign Keys for leads_lead table
-- ============================================

-- Check if foreign keys already exist before adding
DO $$
BEGIN
    -- case_handler_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_leads_lead_case_handler_id'
    ) THEN
        ALTER TABLE leads_lead 
        ADD CONSTRAINT fk_leads_lead_case_handler_id 
        FOREIGN KEY (case_handler_id) REFERENCES tenants_employee(id);
        RAISE NOTICE 'Added fk_leads_lead_case_handler_id';
    ELSE
        RAISE NOTICE 'fk_leads_lead_case_handler_id already exists';
    END IF;

    -- closer_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_leads_lead_closer_id'
    ) THEN
        ALTER TABLE leads_lead 
        ADD CONSTRAINT fk_leads_lead_closer_id 
        FOREIGN KEY (closer_id) REFERENCES tenants_employee(id);
        RAISE NOTICE 'Added fk_leads_lead_closer_id';
    ELSE
        RAISE NOTICE 'fk_leads_lead_closer_id already exists';
    END IF;

    -- meeting_scheduler_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_leads_lead_meeting_scheduler_id'
    ) THEN
        ALTER TABLE leads_lead 
        ADD CONSTRAINT fk_leads_lead_meeting_scheduler_id 
        FOREIGN KEY (meeting_scheduler_id) REFERENCES tenants_employee(id);
        RAISE NOTICE 'Added fk_leads_lead_meeting_scheduler_id';
    ELSE
        RAISE NOTICE 'fk_leads_lead_meeting_scheduler_id already exists';
    END IF;

    -- meeting_manager_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_leads_lead_meeting_manager_id'
    ) THEN
        ALTER TABLE leads_lead 
        ADD CONSTRAINT fk_leads_lead_meeting_manager_id 
        FOREIGN KEY (meeting_manager_id) REFERENCES tenants_employee(id);
        RAISE NOTICE 'Added fk_leads_lead_meeting_manager_id';
    ELSE
        RAISE NOTICE 'fk_leads_lead_meeting_manager_id already exists';
    END IF;

    -- meeting_lawyer_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_leads_lead_meeting_lawyer_id'
    ) THEN
        ALTER TABLE leads_lead 
        ADD CONSTRAINT fk_leads_lead_meeting_lawyer_id 
        FOREIGN KEY (meeting_lawyer_id) REFERENCES tenants_employee(id);
        RAISE NOTICE 'Added fk_leads_lead_meeting_lawyer_id';
    ELSE
        RAISE NOTICE 'fk_leads_lead_meeting_lawyer_id already exists';
    END IF;

    -- expert_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_leads_lead_expert_id'
    ) THEN
        ALTER TABLE leads_lead 
        ADD CONSTRAINT fk_leads_lead_expert_id 
        FOREIGN KEY (expert_id) REFERENCES tenants_employee(id);
        RAISE NOTICE 'Added fk_leads_lead_expert_id';
    ELSE
        RAISE NOTICE 'fk_leads_lead_expert_id already exists';
    END IF;

    -- exclusive_handler_id foreign key (if exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads_lead' AND column_name = 'exclusive_handler_id'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'fk_leads_lead_exclusive_handler_id'
        ) THEN
            ALTER TABLE leads_lead 
            ADD CONSTRAINT fk_leads_lead_exclusive_handler_id 
            FOREIGN KEY (exclusive_handler_id) REFERENCES tenants_employee(id);
            RAISE NOTICE 'Added fk_leads_lead_exclusive_handler_id';
        ELSE
            RAISE NOTICE 'fk_leads_lead_exclusive_handler_id already exists';
        END IF;
    END IF;

    -- anchor_id foreign key (if exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads_lead' AND column_name = 'anchor_id'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'fk_leads_lead_anchor_id'
        ) THEN
            ALTER TABLE leads_lead 
            ADD CONSTRAINT fk_leads_lead_anchor_id 
            FOREIGN KEY (anchor_id) REFERENCES tenants_employee(id);
            RAISE NOTICE 'Added fk_leads_lead_anchor_id';
        ELSE
            RAISE NOTICE 'fk_leads_lead_anchor_id already exists';
        END IF;
    END IF;
END $$;

-- ============================================
-- PART 2: Foreign Keys for leads table (new leads)
-- ============================================

DO $$
BEGIN
    -- case_handler_id foreign key for leads table
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads' AND column_name = 'case_handler_id'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'fk_leads_case_handler_id'
        ) THEN
            ALTER TABLE leads 
            ADD CONSTRAINT fk_leads_case_handler_id 
            FOREIGN KEY (case_handler_id) REFERENCES tenants_employee(id);
            RAISE NOTICE 'Added fk_leads_case_handler_id';
        ELSE
            RAISE NOTICE 'fk_leads_case_handler_id already exists';
        END IF;
    ELSE
        RAISE NOTICE 'leads.case_handler_id column does not exist';
    END IF;

    -- meeting_manager_id foreign key for leads table
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads' AND column_name = 'meeting_manager_id'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'fk_leads_meeting_manager_id'
        ) THEN
            ALTER TABLE leads 
            ADD CONSTRAINT fk_leads_meeting_manager_id 
            FOREIGN KEY (meeting_manager_id) REFERENCES tenants_employee(id);
            RAISE NOTICE 'Added fk_leads_meeting_manager_id';
        ELSE
            RAISE NOTICE 'fk_leads_meeting_manager_id already exists';
        END IF;
    ELSE
        RAISE NOTICE 'leads.meeting_manager_id column does not exist';
    END IF;

    -- expert_id foreign key for leads table
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads' AND column_name = 'expert_id'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'fk_leads_expert_id'
        ) THEN
            ALTER TABLE leads 
            ADD CONSTRAINT fk_leads_expert_id 
            FOREIGN KEY (expert_id) REFERENCES tenants_employee(id);
            RAISE NOTICE 'Added fk_leads_expert_id';
        ELSE
            RAISE NOTICE 'fk_leads_expert_id already exists';
        END IF;
    ELSE
        RAISE NOTICE 'leads.expert_id column does not exist';
    END IF;

    -- meeting_lawyer_id foreign key for leads table
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads' AND column_name = 'meeting_lawyer_id'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'fk_leads_meeting_lawyer_id'
        ) THEN
            ALTER TABLE leads 
            ADD CONSTRAINT fk_leads_meeting_lawyer_id 
            FOREIGN KEY (meeting_lawyer_id) REFERENCES tenants_employee(id);
            RAISE NOTICE 'Added fk_leads_meeting_lawyer_id';
        ELSE
            RAISE NOTICE 'fk_leads_meeting_lawyer_id already exists';
        END IF;
    ELSE
        RAISE NOTICE 'leads.meeting_lawyer_id column does not exist';
    END IF;
END $$;

-- ============================================
-- PART 3: Create indexes for better JOIN performance
-- ============================================

-- Indexes for leads_lead table
CREATE INDEX IF NOT EXISTS idx_leads_lead_case_handler_id ON leads_lead(case_handler_id) WHERE case_handler_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_closer_id ON leads_lead(closer_id) WHERE closer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_scheduler_id ON leads_lead(meeting_scheduler_id) WHERE meeting_scheduler_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_manager_id ON leads_lead(meeting_manager_id) WHERE meeting_manager_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_lawyer_id ON leads_lead(meeting_lawyer_id) WHERE meeting_lawyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_expert_id ON leads_lead(expert_id) WHERE expert_id IS NOT NULL;

-- Indexes for leads table (if columns exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'case_handler_id') THEN
        CREATE INDEX IF NOT EXISTS idx_leads_case_handler_id ON leads(case_handler_id) WHERE case_handler_id IS NOT NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'meeting_manager_id') THEN
        CREATE INDEX IF NOT EXISTS idx_leads_meeting_manager_id ON leads(meeting_manager_id) WHERE meeting_manager_id IS NOT NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'expert_id') THEN
        CREATE INDEX IF NOT EXISTS idx_leads_expert_id ON leads(expert_id) WHERE expert_id IS NOT NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'meeting_lawyer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_leads_meeting_lawyer_id ON leads(meeting_lawyer_id) WHERE meeting_lawyer_id IS NOT NULL;
    END IF;
END $$;

-- ============================================
-- PART 4: Verify foreign keys were created
-- ============================================

SELECT 
    tc.table_name,
    tc.constraint_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name IN ('leads_lead', 'leads')
    AND kcu.column_name LIKE '%_id'
    AND ccu.table_name = 'tenants_employee'
ORDER BY 
    tc.table_name, 
    kcu.column_name;
