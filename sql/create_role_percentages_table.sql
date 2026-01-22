-- Create role_percentages table for Sales Contribution Report
-- This table stores the percentage allocations for each role in signed leads
CREATE TABLE IF NOT EXISTS public.role_percentages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Role name (must be unique)
  role_name VARCHAR(50) NOT NULL UNIQUE,
  
  -- Percentage for this role (0-100)
  percentage DECIMAL(5, 2) NOT NULL DEFAULT 0.00 CHECK (percentage >= 0 AND percentage <= 100),
  
  -- Description of the role for reference
  description TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- User tracking
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE public.role_percentages ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read role percentages
CREATE POLICY "Allow authenticated users to read role percentages"
ON public.role_percentages
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow authenticated users to insert role percentages
CREATE POLICY "Allow authenticated users to insert role percentages"
ON public.role_percentages
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow authenticated users to update role percentages
CREATE POLICY "Allow authenticated users to update role percentages"
ON public.role_percentages
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_role_percentages_role_name ON public.role_percentages(role_name);
CREATE INDEX IF NOT EXISTS idx_role_percentages_updated_at ON public.role_percentages(updated_at);

-- Insert default role percentages (matches current code defaults)
INSERT INTO public.role_percentages (role_name, percentage, description)
VALUES 
  ('CLOSER', 40.00, 'Closer role percentage (40% when no Helper Closer)'),
  ('SCHEDULER', 30.00, 'Scheduler role percentage'),
  ('MANAGER', 20.00, 'Meeting Manager role percentage'),
  ('EXPERT', 10.00, 'Expert role percentage'),
  ('CLOSER_WITH_HELPER', 20.00, 'Closer role percentage when Helper Closer also exists (20% instead of 40%)'),
  ('HELPER_CLOSER', 20.00, 'Helper Closer role percentage (20% when present)')
ON CONFLICT (role_name) DO NOTHING;

-- Add comments
COMMENT ON TABLE public.role_percentages IS 'Stores percentage allocations for each role in Sales Contribution Report signed portion calculations';
COMMENT ON COLUMN public.role_percentages.role_name IS 'Unique role identifier (CLOSER, SCHEDULER, MANAGER, EXPERT, CLOSER_WITH_HELPER, HELPER_CLOSER)';
COMMENT ON COLUMN public.role_percentages.percentage IS 'Percentage allocation for this role (0-100)';
