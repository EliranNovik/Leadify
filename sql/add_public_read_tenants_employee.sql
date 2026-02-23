-- Add public read policy for tenants_employee table
-- This allows anonymous users to view employee business cards
-- Required for BusinessCardPage to work on mobile/public links

-- Enable RLS on tenants_employee table (if not already enabled)
ALTER TABLE tenants_employee ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists (to avoid conflicts)
DROP POLICY IF EXISTS "Allow public read access for business cards" ON tenants_employee;

-- Create policy for public/anonymous read access
-- This allows anyone to read employee data for business card display
CREATE POLICY "Allow public read access for business cards" ON tenants_employee
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Note: This policy allows public access to all employee data
-- If you need more restrictive access, you can modify the USING clause
-- For example, to only allow access to specific employees:
-- USING (id IN (SELECT id FROM public_employee_ids))
