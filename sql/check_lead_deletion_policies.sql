-- Check current RLS policies for lead deletion
-- This script helps diagnose why lead deletion might be failing

-- ============================================
-- CHECK IF RLS IS ENABLED ON LEADS TABLE
-- ============================================
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename IN ('leads', 'leads_lead');

-- ============================================
-- CHECK ALL POLICIES ON LEADS TABLE
-- ============================================
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
WHERE tablename IN ('leads', 'leads_lead')
ORDER BY tablename, cmd, policyname;

-- ============================================
-- CHECK SPECIFIC DELETE POLICIES
-- ============================================
SELECT 
    tablename,
    policyname,
    cmd,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies
WHERE tablename IN ('leads', 'leads_lead')
  AND cmd = 'DELETE'
ORDER BY tablename, policyname;

-- ============================================
-- CHECK USERS TABLE STRUCTURE (for policy reference)
-- ============================================
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'users'
  AND column_name IN ('id', 'auth_id', 'is_superuser', 'email')
ORDER BY ordinal_position;

-- ============================================
-- CHECK IF CURRENT USER IS A SUPERUSER (requires auth context)
-- ============================================
-- This query will only work if executed in the context of an authenticated user
-- Run this in Supabase SQL Editor while logged in to check your own permissions
SELECT 
    id,
    email,
    is_superuser,
    auth_id,
    CASE 
        WHEN auth_id = auth.uid() THEN 'Current user'
        ELSE 'Other user'
    END as user_status
FROM users
WHERE auth_id = auth.uid();

-- ============================================
-- CHECK FOR ANY POLICIES THAT MIGHT CONFLICT
-- ============================================
-- Look for policies that might be too restrictive
SELECT 
    tablename,
    policyname,
    cmd,
    qual,
    CASE 
        WHEN qual LIKE '%is_superuser%' THEN 'Uses superuser check'
        WHEN qual = 'true' THEN 'Allows all'
        WHEN qual IS NULL THEN 'No condition'
        ELSE 'Has condition'
    END as policy_type
FROM pg_policies
WHERE tablename IN ('leads', 'leads_lead')
  AND cmd = 'DELETE'
ORDER BY tablename, policyname;

