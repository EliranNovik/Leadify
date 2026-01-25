-- Add due_normalized_percentage column to sales_contribution_income table
ALTER TABLE public.sales_contribution_income
ADD COLUMN IF NOT EXISTS due_normalized_percentage numeric(5,2) DEFAULT 0;

-- Add comment to explain the column
COMMENT ON COLUMN public.sales_contribution_income.due_normalized_percentage IS 'Percentage to apply to due amounts for normalization (0-100)';
