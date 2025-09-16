-- Subdepartment Bonus System Tables
-- This SQL extends the bonus system to support subdepartments with their own bonus pools

-- 1. Subdepartments Table
CREATE TABLE public.subdepartments (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    bonus_percentage DECIMAL(5,4) NOT NULL CHECK (bonus_percentage >= 0 AND bonus_percentage <= 1),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default subdepartments
INSERT INTO public.subdepartments (name, description, bonus_percentage) VALUES
('Sales', 'Sales department with dynamic role-based bonuses', 0.4000),
('Handlers', 'Handlers department with specialized roles', 0.3000),
('Marketing', 'Marketing department with specific employee assignments', 0.0500),
('Collection', 'Collection department (Finance department employees)', 0.0500),
('Partners & Co', 'Partners and management roles', 0.2000);

-- 2. Subdepartment Role Percentages Table
-- Stores role percentages within each subdepartment
CREATE TABLE public.subdepartment_role_percentages (
    id BIGSERIAL PRIMARY KEY,
    subdepartment_id BIGINT NOT NULL REFERENCES public.subdepartments(id) ON DELETE CASCADE,
    role_code VARCHAR(10) NOT NULL,
    role_name VARCHAR(50) NOT NULL,
    percentage DECIMAL(5,4) NOT NULL CHECK (percentage >= 0 AND percentage <= 1),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(subdepartment_id, role_code)
);

-- Insert role percentages for each subdepartment

-- Sales subdepartment roles
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 's', 'Scheduler', 0.3000 FROM public.subdepartments WHERE name = 'Sales';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'z', 'Manager', 0.2000 FROM public.subdepartments WHERE name = 'Sales';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'Z', 'Manager', 0.2000 FROM public.subdepartments WHERE name = 'Sales';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'c', 'Closer', 0.4000 FROM public.subdepartments WHERE name = 'Sales';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'h', 'Helper', 0.0000 FROM public.subdepartments WHERE name = 'Sales';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'e', 'Expert', 0.1000 FROM public.subdepartments WHERE name = 'Sales';

-- Handlers subdepartment roles
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'h', 'Handler', 0.7000 FROM public.subdepartments WHERE name = 'Handlers';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'e', 'Expert', 0.1000 FROM public.subdepartments WHERE name = 'Handlers';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'd', 'Diverse', 0.2000 FROM public.subdepartments WHERE name = 'Handlers';

-- Marketing subdepartment (role-based)
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'ma', 'Marketing', 1.0000 FROM public.subdepartments WHERE name = 'Marketing';

-- Collection subdepartment (Finance department)
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'finance', 'Finance', 1.0000 FROM public.subdepartments WHERE name = 'Collection';

-- Partners & Co subdepartment roles
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'P', 'Partner', 0.2000 FROM public.subdepartments WHERE name = 'Partners & Co';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'M', 'Manager', 0.2000 FROM public.subdepartments WHERE name = 'Partners & Co';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'DM', 'Department Manager', 0.2000 FROM public.subdepartments WHERE name = 'Partners & Co';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'PM', 'Project Manager', 0.2000 FROM public.subdepartments WHERE name = 'Partners & Co';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'SE', 'Secretary', 0.2000 FROM public.subdepartments WHERE name = 'Partners & Co';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'B', 'Book keeper', 0.2000 FROM public.subdepartments WHERE name = 'Partners & Co';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'Partners', 'Partners', 0.2000 FROM public.subdepartments WHERE name = 'Partners & Co';
INSERT INTO public.subdepartment_role_percentages (subdepartment_id, role_code, role_name, percentage) 
SELECT id, 'dv', 'Developer', 0.2000 FROM public.subdepartments WHERE name = 'Partners & Co';

-- 3. Employee Subdepartment Assignments Table
-- Maps employees to subdepartments (for special cases like Marketing)
CREATE TABLE public.employee_subdepartment_assignments (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
    subdepartment_id BIGINT NOT NULL REFERENCES public.subdepartments(id) ON DELETE CASCADE,
    assignment_type VARCHAR(20) DEFAULT 'role_based', -- 'role_based', 'specific_employee', 'department_based'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(employee_id, subdepartment_id)
);

-- Insert specific employee assignments for Marketing
INSERT INTO public.employee_subdepartment_assignments (employee_id, subdepartment_id, assignment_type)
SELECT te.id, sd.id, 'specific_employee'
FROM public.tenants_employee te
JOIN public.subdepartments sd ON sd.name = 'Marketing'
WHERE LOWER(te.display_name) LIKE '%olga%' OR LOWER(te.display_name) LIKE '%andrey%';

-- Insert department-based assignments for Collection (Finance department)
INSERT INTO public.employee_subdepartment_assignments (employee_id, subdepartment_id, assignment_type)
SELECT te.id, sd.id, 'department_based'
FROM public.tenants_employee te
JOIN public.subdepartments sd ON sd.name = 'Collection'
JOIN public.tenant_departement td ON te.department_id = td.id
WHERE LOWER(td.name) LIKE '%finance%' OR LOWER(td.name) LIKE '%collection%';

-- 4. Monthly Subdepartment Bonus Pools Table
-- Stores bonus pool amounts for each subdepartment per month
CREATE TABLE public.monthly_subdepartment_bonus_pools (
    id BIGSERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    subdepartment_id BIGINT NOT NULL REFERENCES public.subdepartments(id),
    total_pool_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'USD',
    is_locked BOOLEAN DEFAULT FALSE,
    created_by BIGINT REFERENCES public.auth_user(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(year, month, subdepartment_id)
);

-- 5. Employee Subdepartment Monthly Bonuses Table
-- Stores calculated bonuses for employees within subdepartments
CREATE TABLE public.employee_subdepartment_monthly_bonuses (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
    subdepartment_id BIGINT NOT NULL REFERENCES public.subdepartments(id),
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    role_code VARCHAR(10) NOT NULL,
    role_percentage DECIMAL(5,4) NOT NULL,
    subdepartment_percentage DECIMAL(5,4) NOT NULL,
    calculated_bonus DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_pool_amount DECIMAL(12,2) NOT NULL,
    performance_metrics JSONB DEFAULT '{}',
    is_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(employee_id, subdepartment_id, year, month)
);

-- 6. Indexes for performance
CREATE INDEX idx_subdepartments_name ON public.subdepartments(name);
CREATE INDEX idx_subdepartments_active ON public.subdepartments(is_active);

CREATE INDEX idx_subdepartment_role_percentages_subdept ON public.subdepartment_role_percentages(subdepartment_id);
CREATE INDEX idx_subdepartment_role_percentages_role ON public.subdepartment_role_percentages(role_code);
CREATE INDEX idx_subdepartment_role_percentages_active ON public.subdepartment_role_percentages(is_active);

CREATE INDEX idx_employee_subdepartment_assignments_employee ON public.employee_subdepartment_assignments(employee_id);
CREATE INDEX idx_employee_subdepartment_assignments_subdept ON public.employee_subdepartment_assignments(subdepartment_id);
CREATE INDEX idx_employee_subdepartment_assignments_active ON public.employee_subdepartment_assignments(is_active);

CREATE INDEX idx_monthly_subdepartment_bonus_pools_year_month ON public.monthly_subdepartment_bonus_pools(year, month);
CREATE INDEX idx_monthly_subdepartment_bonus_pools_subdept ON public.monthly_subdepartment_bonus_pools(subdepartment_id);

CREATE INDEX idx_employee_subdepartment_monthly_bonuses_employee ON public.employee_subdepartment_monthly_bonuses(employee_id);
CREATE INDEX idx_employee_subdepartment_monthly_bonuses_subdept ON public.employee_subdepartment_monthly_bonuses(subdepartment_id);
CREATE INDEX idx_employee_subdepartment_monthly_bonuses_year_month ON public.employee_subdepartment_monthly_bonuses(year, month);

-- 7. Functions for subdepartment bonus calculations

-- Function to get employees by subdepartment
CREATE OR REPLACE FUNCTION get_employees_by_subdepartment(
    p_subdepartment_name VARCHAR(100)
) RETURNS TABLE(
    employee_id BIGINT,
    employee_name TEXT,
    role_code VARCHAR(10),
    department_name TEXT,
    assignment_type VARCHAR(20)
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        te.id as employee_id,
        te.display_name as employee_name,
        te.bonuses_role as role_code,
        td.name as department_name,
        esa.assignment_type
    FROM public.tenants_employee te
    JOIN public.auth_user au ON te.user_id = au.id
    LEFT JOIN public.tenant_departement td ON te.department_id = td.id
    LEFT JOIN public.employee_subdepartment_assignments esa ON te.id = esa.employee_id AND esa.is_active = TRUE
    JOIN public.subdepartments sd ON (
        (esa.subdepartment_id = sd.id AND sd.name = p_subdepartment_name) OR
        (esa.subdepartment_id IS NULL AND sd.name = p_subdepartment_name AND 
         CASE 
             WHEN sd.name = 'Sales' THEN te.bonuses_role IN ('s', 'z', 'Z', 'c', 'e')
             WHEN sd.name = 'Handlers' THEN te.bonuses_role IN ('h', 'e', 'd')
             WHEN sd.name = 'Marketing' THEN te.bonuses_role = 'ma'
             WHEN sd.name = 'Collection' THEN td.name = 'Finance'
             WHEN sd.name = 'Partners & Co' THEN te.bonuses_role IN ('P', 'M', 'DM', 'PM', 'SE', 'B', 'Partners', 'dv')
             ELSE FALSE
         END)
    )
    WHERE au.is_active = TRUE
    ORDER BY te.display_name;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate subdepartment bonuses
CREATE OR REPLACE FUNCTION calculate_subdepartment_bonuses(
    p_year INTEGER,
    p_month INTEGER,
    p_total_pool DECIMAL(12,2),
    p_calculated_by BIGINT DEFAULT NULL
) RETURNS TABLE(
    subdepartment_name VARCHAR(100),
    employee_id BIGINT,
    calculated_bonus DECIMAL(12,2)
) AS $$
DECLARE
    subdept RECORD;
    subdept_pool DECIMAL(12,2);
BEGIN
    -- Calculate bonus pool for each subdepartment
    FOR subdept IN 
        SELECT id, name, bonus_percentage 
        FROM public.subdepartments 
        WHERE is_active = TRUE
    LOOP
        subdept_pool := p_total_pool * subdept.bonus_percentage;
        
        -- Insert subdepartment bonus pool
        INSERT INTO public.monthly_subdepartment_bonus_pools (
            year, month, subdepartment_id, total_pool_amount, created_by
        )
        VALUES (p_year, p_month, subdept.id, subdept_pool, p_calculated_by)
        ON CONFLICT (year, month, subdepartment_id)
        DO UPDATE SET 
            total_pool_amount = EXCLUDED.total_pool_amount,
            updated_at = NOW();

        -- Calculate employee bonuses within subdepartment
        INSERT INTO public.employee_subdepartment_monthly_bonuses (
            employee_id, subdepartment_id, year, month, role_code, 
            role_percentage, subdepartment_percentage, calculated_bonus, total_pool_amount
        )
        SELECT 
            te.id as employee_id,
            subdept.id as subdepartment_id,
            p_year as year,
            p_month as month,
            te.bonuses_role as role_code,
            COALESCE(srp.percentage, 0.0) as role_percentage,
            subdept.bonus_percentage as subdepartment_percentage,
            ROUND(subdept_pool * COALESCE(srp.percentage, 0.0), 2) as calculated_bonus,
            subdept_pool as total_pool_amount
        FROM public.tenants_employee te
        JOIN public.auth_user au ON te.user_id = au.id
        LEFT JOIN public.subdepartment_role_percentages srp ON (
            srp.subdepartment_id = subdept.id 
            AND srp.role_code = te.bonuses_role 
            AND srp.is_active = TRUE
        )
        LEFT JOIN public.employee_subdepartment_assignments esa ON (
            te.id = esa.employee_id 
            AND esa.subdepartment_id = subdept.id 
            AND esa.is_active = TRUE
        )
        WHERE au.is_active = TRUE
        AND (
            -- Role-based assignment
            (esa.id IS NULL AND 
             CASE 
                 WHEN subdept.name = 'Sales' THEN te.bonuses_role IN ('s', 'z', 'Z', 'c', 'e')
                 WHEN subdept.name = 'Handlers' THEN te.bonuses_role IN ('h', 'e', 'd')
                 WHEN subdept.name = 'Marketing' THEN te.bonuses_role = 'ma'
                 WHEN subdept.name = 'Collection' THEN td.name = 'Finance'
                 WHEN subdept.name = 'Partners & Co' THEN te.bonuses_role IN ('P', 'M', 'DM', 'PM', 'SE', 'B', 'Partners', 'dv')
                 ELSE FALSE
             END) OR
            -- Specific employee assignment
            (esa.assignment_type = 'specific_employee') OR
            -- Department-based assignment
            (esa.assignment_type = 'department_based')
        )
        ON CONFLICT (employee_id, subdepartment_id, year, month)
        DO UPDATE SET
            role_code = EXCLUDED.role_code,
            role_percentage = EXCLUDED.role_percentage,
            subdepartment_percentage = EXCLUDED.subdepartment_percentage,
            calculated_bonus = EXCLUDED.calculated_bonus,
            total_pool_amount = EXCLUDED.total_pool_amount,
            updated_at = NOW();

        -- Return results for this subdepartment
        RETURN QUERY
        SELECT 
            subdept.name as subdepartment_name,
            esmb.employee_id,
            esmb.calculated_bonus
        FROM public.employee_subdepartment_monthly_bonuses esmb
        WHERE esmb.subdepartment_id = subdept.id 
        AND esmb.year = p_year 
        AND esmb.month = p_month;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 8. RLS Policies
ALTER TABLE public.subdepartments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subdepartment_role_percentages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_subdepartment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_subdepartment_bonus_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_subdepartment_monthly_bonuses ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Allow authenticated users to read subdepartments" ON public.subdepartments
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to modify subdepartments" ON public.subdepartments
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read subdepartment role percentages" ON public.subdepartment_role_percentages
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to modify subdepartment role percentages" ON public.subdepartment_role_percentages
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read employee subdepartment assignments" ON public.employee_subdepartment_assignments
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to modify employee subdepartment assignments" ON public.employee_subdepartment_assignments
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read monthly subdepartment bonus pools" ON public.monthly_subdepartment_bonus_pools
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to modify monthly subdepartment bonus pools" ON public.monthly_subdepartment_bonus_pools
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read employee subdepartment monthly bonuses" ON public.employee_subdepartment_monthly_bonuses
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to modify employee subdepartment monthly bonuses" ON public.employee_subdepartment_monthly_bonuses
    FOR ALL USING (auth.role() = 'authenticated');

-- 9. Triggers for updated_at
CREATE TRIGGER update_subdepartments_updated_at
    BEFORE UPDATE ON public.subdepartments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subdepartment_role_percentages_updated_at
    BEFORE UPDATE ON public.subdepartment_role_percentages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_subdepartment_assignments_updated_at
    BEFORE UPDATE ON public.employee_subdepartment_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_monthly_subdepartment_bonus_pools_updated_at
    BEFORE UPDATE ON public.monthly_subdepartment_bonus_pools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_subdepartment_monthly_bonuses_updated_at
    BEFORE UPDATE ON public.employee_subdepartment_monthly_bonuses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 10. Sample queries

-- Get all subdepartments
-- SELECT * FROM public.subdepartments WHERE is_active = TRUE ORDER BY bonus_percentage DESC;

-- Get employees by subdepartment
-- SELECT * FROM get_employees_by_subdepartment('Sales');

-- Calculate subdepartment bonuses for current month
-- SELECT * FROM calculate_subdepartment_bonuses(2024, 12, 10000.00, 1);

-- Get subdepartment bonus pools for a month
-- SELECT sd.name, msbp.total_pool_amount 
-- FROM public.monthly_subdepartment_bonus_pools msbp
-- JOIN public.subdepartments sd ON msbp.subdepartment_id = sd.id
-- WHERE msbp.year = 2024 AND msbp.month = 12;

-- Update subdepartment bonus percentage
-- UPDATE public.subdepartments SET bonus_percentage = 0.35 WHERE name = 'Sales';

-- Update role percentage within subdepartment
-- UPDATE public.subdepartment_role_percentages 
-- SET percentage = 0.45 
-- WHERE subdepartment_id = (SELECT id FROM public.subdepartments WHERE name = 'Sales') 
-- AND role_code = 'c';
