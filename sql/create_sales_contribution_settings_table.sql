-- Table: sales_contribution_use_fixed_from_db
-- Single-row toggle for Sales Contribution page.
-- use_fixed_contribution_from_db: when true, Contribution Fixed is taken from employee_fixed_contribution table;
-- when false (default), the existing hardcoded logic is used (Handler/Sales 50%, Marketing/Finance/Partners 100%, etc.).
-- Named separately from sales_contribution_settings (which stores per-department percentages).

CREATE TABLE IF NOT EXISTS public.sales_contribution_use_fixed_from_db (
    id INT PRIMARY KEY DEFAULT 1,
    use_fixed_contribution_from_db BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT single_row_check CHECK (id = 1)
);

-- Ensure exactly one row exists
INSERT INTO public.sales_contribution_use_fixed_from_db (id, use_fixed_contribution_from_db)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION update_sales_contribution_use_fixed_from_db_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_sales_contribution_use_fixed_from_db_updated_at ON public.sales_contribution_use_fixed_from_db;

CREATE TRIGGER trigger_update_sales_contribution_use_fixed_from_db_updated_at
    BEFORE UPDATE ON public.sales_contribution_use_fixed_from_db
    FOR EACH ROW
    EXECUTE FUNCTION update_sales_contribution_use_fixed_from_db_updated_at();

ALTER TABLE public.sales_contribution_use_fixed_from_db ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.sales_contribution_use_fixed_from_db
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow update for authenticated" ON public.sales_contribution_use_fixed_from_db
    FOR UPDATE TO authenticated USING (true)
    WITH CHECK (true);
