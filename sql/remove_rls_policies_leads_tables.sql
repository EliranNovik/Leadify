-- =============================================
-- Remove RLS Policies on leads_lead, leads_leadstage, and related tables
-- =============================================
-- This script removes RLS policies to fix issues with PublicContractView.tsx
-- and contractAutomation.ts when accessing legacy leads and stage history
-- 
-- Tables handled:
-- - leads_lead (legacy leads table)
-- - leads_leadstage (stage history table - CRITICAL)
-- - leads_leadstages (if exists - plural version)
-- - lead_stages (stage definitions table)

-- =============================================
-- LEADS_LEAD TABLE
-- =============================================

-- Step 1: Check current RLS status
SELECT 'Checking RLS status for leads_lead table...' as info;
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'leads_lead' AND schemaname = 'public';

-- Step 2: List all existing policies on leads_lead
SELECT 'Current policies on leads_lead table:' as info;
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'leads_lead' 
ORDER BY policyname;

-- Step 3: Drop ALL existing policies on leads_lead
DROP POLICY IF EXISTS "Users can read their own leads" ON public.leads_lead;
DROP POLICY IF EXISTS "Authenticated users can read leads_lead" ON public.leads_lead;
DROP POLICY IF EXISTS "Service role can manage all leads" ON public.leads_lead;
DROP POLICY IF EXISTS "Enable UPDATE for authenticated users on leads_lead" ON public.leads_lead;
DROP POLICY IF EXISTS "Enable all operations for authenticated users on leads_lead" ON public.leads_lead;

-- Drop any other policies that might exist (using dynamic SQL to catch all)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'leads_lead' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.leads_lead', r.policyname);
    END LOOP;
END $$;

-- Step 4: Disable RLS on leads_lead table
ALTER TABLE public.leads_lead DISABLE ROW LEVEL SECURITY;

-- Step 5: Grant full permissions (since RLS is disabled, these grants will work)
GRANT ALL ON public.leads_lead TO authenticated;
GRANT ALL ON public.leads_lead TO service_role;
GRANT ALL ON public.leads_lead TO anon;

-- =============================================
-- LEADS_LEADSTAGE TABLE (CRITICAL - this is the stage history table)
-- =============================================

-- Drop all policies on leads_leadstage (if table exists)
DO $$
DECLARE
    r RECORD;
    table_exists BOOLEAN;
BEGIN
    -- Check if table exists
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'leads_leadstage'
    ) INTO table_exists;
    
    IF table_exists THEN
        RAISE NOTICE 'leads_leadstage table exists, removing RLS policies...';
        
        -- Drop all policies on leads_leadstage
        FOR r IN 
            SELECT policyname 
            FROM pg_policies 
            WHERE tablename = 'leads_leadstage' AND schemaname = 'public'
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.leads_leadstage', r.policyname);
        END LOOP;
        
        -- Disable RLS
        ALTER TABLE public.leads_leadstage DISABLE ROW LEVEL SECURITY;
        
        -- Grant permissions
        GRANT ALL ON public.leads_leadstage TO authenticated;
        GRANT ALL ON public.leads_leadstage TO service_role;
        GRANT ALL ON public.leads_leadstage TO anon;
    ELSE
        RAISE NOTICE 'leads_leadstage table does not exist, skipping...';
    END IF;
END $$;

-- =============================================
-- LEADS_LEADSTAGES TABLE (if it exists - plural version)
-- =============================================

-- Drop all policies on leads_leadstages (if table exists)
DO $$
DECLARE
    r RECORD;
    table_exists BOOLEAN;
BEGIN
    -- Check if table exists
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'leads_leadstages'
    ) INTO table_exists;
    
    IF table_exists THEN
        RAISE NOTICE 'leads_leadstages table exists, removing RLS policies...';
        
        -- Drop all policies on leads_leadstages
        FOR r IN 
            SELECT policyname 
            FROM pg_policies 
            WHERE tablename = 'leads_leadstages' AND schemaname = 'public'
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.leads_leadstages', r.policyname);
        END LOOP;
        
        -- Disable RLS
        ALTER TABLE public.leads_leadstages DISABLE ROW LEVEL SECURITY;
        
        -- Grant permissions
        GRANT ALL ON public.leads_leadstages TO authenticated;
        GRANT ALL ON public.leads_leadstages TO service_role;
        GRANT ALL ON public.leads_leadstages TO anon;
    ELSE
        RAISE NOTICE 'leads_leadstages table does not exist, skipping...';
    END IF;
END $$;

-- =============================================
-- LEAD_STAGES TABLE (in case this is what was meant)
-- =============================================

-- Drop all policies on lead_stages (if table exists)
DO $$
DECLARE
    r RECORD;
    table_exists BOOLEAN;
BEGIN
    -- Check if table exists
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'lead_stages'
    ) INTO table_exists;
    
    IF table_exists THEN
        RAISE NOTICE 'lead_stages table exists, removing RLS policies...';
        
        -- Drop all policies on lead_stages
        FOR r IN 
            SELECT policyname 
            FROM pg_policies 
            WHERE tablename = 'lead_stages' AND schemaname = 'public'
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.lead_stages', r.policyname);
        END LOOP;
        
        -- Disable RLS
        ALTER TABLE public.lead_stages DISABLE ROW LEVEL SECURITY;
        
        -- Grant permissions
        GRANT ALL ON public.lead_stages TO authenticated;
        GRANT ALL ON public.lead_stages TO service_role;
        GRANT ALL ON public.lead_stages TO anon;
    ELSE
        RAISE NOTICE 'lead_stages table does not exist, skipping...';
    END IF;
END $$;

-- =============================================
-- VERIFICATION
-- =============================================

-- Verify RLS is disabled on all relevant tables
SELECT 'Verification - RLS status after changes:' as info;
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('leads_lead', 'leads_leadstage', 'leads_leadstages', 'lead_stages') 
  AND schemaname = 'public'
ORDER BY tablename;

-- Verify no policies remain
SELECT 'Remaining policies (should be empty):' as info;
SELECT 
  schemaname,
  tablename,
  policyname
FROM pg_policies 
WHERE tablename IN ('leads_lead', 'leads_leadstage', 'leads_leadstages', 'lead_stages')
ORDER BY tablename, policyname;

-- Test query on leads_lead (should work now)
SELECT 'Test query on leads_lead (should return count):' as info;
SELECT COUNT(*) as total_leads FROM public.leads_lead;
