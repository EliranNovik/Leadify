-- Create sales_contribution_settings table
CREATE TABLE IF NOT EXISTS public.sales_contribution_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Department name (Sales, Handlers, Partners, Marketing, Finance)
  department_name VARCHAR(50) NOT NULL UNIQUE,
  
  -- Percentage for this department
  percentage DECIMAL(5, 2) NOT NULL DEFAULT 0.00 CHECK (percentage >= 0 AND percentage <= 100),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- User tracking
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Create table for income setting (single row)
CREATE TABLE IF NOT EXISTS public.sales_contribution_income (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Income amount
  income_amount DECIMAL(15, 2) NOT NULL DEFAULT 1650000.00 CHECK (income_amount >= 0),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- User tracking
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE public.sales_contribution_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_contribution_income ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read settings
CREATE POLICY "Allow authenticated users to read sales contribution settings"
ON public.sales_contribution_settings
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow authenticated users to insert settings
CREATE POLICY "Allow authenticated users to insert sales contribution settings"
ON public.sales_contribution_settings
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to update settings
CREATE POLICY "Allow authenticated users to update sales contribution settings"
ON public.sales_contribution_settings
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Policy: Allow authenticated users to read income
CREATE POLICY "Allow authenticated users to read sales contribution income"
ON public.sales_contribution_income
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow authenticated users to insert income
CREATE POLICY "Allow authenticated users to insert sales contribution income"
ON public.sales_contribution_income
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to update income
CREATE POLICY "Allow authenticated users to update sales contribution income"
ON public.sales_contribution_income
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sales_contribution_settings_department ON public.sales_contribution_settings(department_name);
CREATE INDEX IF NOT EXISTS idx_sales_contribution_settings_updated_at ON public.sales_contribution_settings(updated_at);

-- Insert default department percentages (can be adjusted later)
INSERT INTO public.sales_contribution_settings (department_name, percentage)
VALUES 
  ('Sales', 0.00),
  ('Handlers', 0.00),
  ('Partners', 0.00),
  ('Marketing', 0.00),
  ('Finance', 0.00)
ON CONFLICT (department_name) DO NOTHING;

-- Insert default income (single row - will be updated, not inserted again)
INSERT INTO public.sales_contribution_income (income_amount)
VALUES (1650000.00)
ON CONFLICT DO NOTHING;

-- Add comments
COMMENT ON TABLE public.sales_contribution_settings IS 'Stores percentage settings per department for Sales Contribution Report';
COMMENT ON TABLE public.sales_contribution_income IS 'Stores the income amount for Sales Contribution Report (single row)';
