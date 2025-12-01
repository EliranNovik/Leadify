-- Add newsignature column to tenants_employee table
-- This column stores the user's signature generated from company templates

-- Add the column if it doesn't exist
ALTER TABLE public.tenants_employee 
ADD COLUMN IF NOT EXISTS newsignature TEXT;

-- Add comment to document the column
COMMENT ON COLUMN public.tenants_employee.newsignature IS 'HTML signature generated from company signature templates, stored per employee';

