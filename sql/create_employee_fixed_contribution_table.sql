-- Table: employee_fixed_contribution
-- Stores the fixed contribution amount per employee per department role (Partners, Marketing, Finance).
-- Used by Sales Contribution page "Fixed contribution" modal.

CREATE TABLE IF NOT EXISTS public.employee_fixed_contribution (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
    department_role VARCHAR(50) NOT NULL
        CHECK (department_role IN ('Partners', 'Marketing', 'Finance')),
    fixed_contribution_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_employee_fixed_contribution_employee_department
        UNIQUE (employee_id, department_role)
);

CREATE INDEX IF NOT EXISTS idx_employee_fixed_contribution_employee_id
    ON public.employee_fixed_contribution(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_fixed_contribution_department_role
    ON public.employee_fixed_contribution(department_role);

CREATE OR REPLACE FUNCTION update_employee_fixed_contribution_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_employee_fixed_contribution_updated_at ON public.employee_fixed_contribution;

CREATE TRIGGER trigger_update_employee_fixed_contribution_updated_at
    BEFORE UPDATE ON public.employee_fixed_contribution
    FOR EACH ROW
    EXECUTE FUNCTION update_employee_fixed_contribution_updated_at();

ALTER TABLE public.employee_fixed_contribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated to select employee_fixed_contribution" ON public.employee_fixed_contribution;
DROP POLICY IF EXISTS "Allow authenticated to insert employee_fixed_contribution" ON public.employee_fixed_contribution;
DROP POLICY IF EXISTS "Allow authenticated to update employee_fixed_contribution" ON public.employee_fixed_contribution;
DROP POLICY IF EXISTS "Allow authenticated to delete employee_fixed_contribution" ON public.employee_fixed_contribution;

CREATE POLICY "Allow authenticated to select employee_fixed_contribution"
    ON public.employee_fixed_contribution FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated to insert employee_fixed_contribution"
    ON public.employee_fixed_contribution FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated to update employee_fixed_contribution"
    ON public.employee_fixed_contribution FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated to delete employee_fixed_contribution"
    ON public.employee_fixed_contribution FOR DELETE TO authenticated USING (true);

COMMENT ON TABLE public.employee_fixed_contribution IS 'Fixed contribution amount per employee per department role (Partners, Marketing, Finance).';
COMMENT ON COLUMN public.employee_fixed_contribution.fixed_contribution_amount IS 'Fixed contribution amount (e.g. salary budget) for this employee in this department role.';
