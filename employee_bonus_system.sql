-- Employee Bonus System Tables
-- This SQL creates the necessary tables for dynamic bonus calculations and monthly tracking

-- 1. Role Bonus Percentages Table
-- Stores the percentage each role gets from the total bonus pool
CREATE TABLE public.role_bonus_percentages (
    id BIGSERIAL PRIMARY KEY,
    role_code VARCHAR(10) NOT NULL UNIQUE,
    role_name VARCHAR(50) NOT NULL,
    percentage DECIMAL(5,4) NOT NULL CHECK (percentage >= 0 AND percentage <= 1),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default role percentages
INSERT INTO public.role_bonus_percentages (role_code, role_name, percentage) VALUES
('e', 'Expert', 0.1500),
('s', 'Scheduler', 0.1200),
('c', 'Closer', 0.1800),
('h', 'Handler', 0.1000),
('z', 'Manager', 0.2000),
('Z', 'Manager', 0.2000),
('n', 'No Role', 0.0500);

-- 2. Monthly Bonus Pool Table
-- Stores the total bonus pool amount for each month
CREATE TABLE public.monthly_bonus_pools (
    id BIGSERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    total_pool_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'USD',
    is_locked BOOLEAN DEFAULT FALSE, -- Prevents further changes once locked
    created_by BIGINT REFERENCES public.auth_user(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(year, month)
);

-- 3. Employee Monthly Bonuses Table
-- Stores calculated bonuses for each employee per month
CREATE TABLE public.employee_monthly_bonuses (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    role_code VARCHAR(10) NOT NULL,
    role_percentage DECIMAL(5,4) NOT NULL,
    calculated_bonus DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_pool_amount DECIMAL(12,2) NOT NULL,
    performance_metrics JSONB DEFAULT '{}', -- Store additional metrics used in calculation
    is_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(employee_id, year, month)
);

-- 4. Bonus Calculation History Table
-- Tracks when bonus calculations were performed
CREATE TABLE public.bonus_calculation_history (
    id BIGSERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    total_pool_amount DECIMAL(12,2) NOT NULL,
    total_employees INTEGER NOT NULL,
    calculation_method VARCHAR(50) DEFAULT 'role_percentage',
    calculated_by BIGINT REFERENCES public.auth_user(id),
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT
);

-- 5. Indexes for better performance
CREATE INDEX idx_role_bonus_percentages_role_code ON public.role_bonus_percentages(role_code);
CREATE INDEX idx_role_bonus_percentages_active ON public.role_bonus_percentages(is_active);

CREATE INDEX idx_monthly_bonus_pools_year_month ON public.monthly_bonus_pools(year, month);
CREATE INDEX idx_monthly_bonus_pools_created_at ON public.monthly_bonus_pools(created_at);

CREATE INDEX idx_employee_monthly_bonuses_employee ON public.employee_monthly_bonuses(employee_id);
CREATE INDEX idx_employee_monthly_bonuses_year_month ON public.employee_monthly_bonuses(year, month);
CREATE INDEX idx_employee_monthly_bonuses_role ON public.employee_monthly_bonuses(role_code);
CREATE INDEX idx_employee_monthly_bonuses_paid ON public.employee_monthly_bonuses(is_paid);

CREATE INDEX idx_bonus_calculation_history_year_month ON public.bonus_calculation_history(year, month);
CREATE INDEX idx_bonus_calculation_history_calculated_at ON public.bonus_calculation_history(calculated_at);

-- 6. Functions for bonus calculations

-- Function to calculate bonuses for a specific month
CREATE OR REPLACE FUNCTION calculate_monthly_bonuses(
    p_year INTEGER,
    p_month INTEGER,
    p_total_pool DECIMAL(12,2),
    p_calculated_by BIGINT DEFAULT NULL
) RETURNS TABLE(
    employee_id BIGINT,
    calculated_bonus DECIMAL(12,2)
) AS $$
BEGIN
    -- Insert or update monthly bonus pool
    INSERT INTO public.monthly_bonus_pools (year, month, total_pool_amount, created_by)
    VALUES (p_year, p_month, p_total_pool, p_calculated_by)
    ON CONFLICT (year, month) 
    DO UPDATE SET 
        total_pool_amount = EXCLUDED.total_pool_amount,
        updated_at = NOW();

    -- Calculate and insert employee bonuses
    INSERT INTO public.employee_monthly_bonuses (
        employee_id, year, month, role_code, role_percentage, 
        calculated_bonus, total_pool_amount
    )
    SELECT 
        te.id as employee_id,
        p_year as year,
        p_month as month,
        te.bonuses_role as role_code,
        COALESCE(rbp.percentage, 0.05) as role_percentage,
        ROUND(p_total_pool * COALESCE(rbp.percentage, 0.05), 2) as calculated_bonus,
        p_total_pool as total_pool_amount
    FROM public.tenants_employee te
    LEFT JOIN public.role_bonus_percentages rbp ON te.bonuses_role = rbp.role_code AND rbp.is_active = TRUE
    LEFT JOIN public.auth_user au ON te.user_id = au.id
    WHERE au.is_active = TRUE
    ON CONFLICT (employee_id, year, month)
    DO UPDATE SET
        role_code = EXCLUDED.role_code,
        role_percentage = EXCLUDED.role_percentage,
        calculated_bonus = EXCLUDED.calculated_bonus,
        total_pool_amount = EXCLUDED.total_pool_amount,
        updated_at = NOW();

    -- Record calculation history
    INSERT INTO public.bonus_calculation_history (
        year, month, total_pool_amount, total_employees, calculated_by
    )
    SELECT 
        p_year, p_month, p_total_pool, 
        COUNT(*), p_calculated_by
    FROM public.employee_monthly_bonuses 
    WHERE year = p_year AND month = p_month;

    -- Return calculated bonuses
    RETURN QUERY
    SELECT 
        emb.employee_id,
        emb.calculated_bonus
    FROM public.employee_monthly_bonuses emb
    WHERE emb.year = p_year AND emb.month = p_month;
END;
$$ LANGUAGE plpgsql;

-- Function to get employee bonuses for a date range
CREATE OR REPLACE FUNCTION get_employee_bonuses_by_date_range(
    p_start_date DATE,
    p_end_date DATE,
    p_employee_id BIGINT DEFAULT NULL
) RETURNS TABLE(
    employee_id BIGINT,
    employee_name TEXT,
    role_code VARCHAR(10),
    role_name VARCHAR(50),
    year INTEGER,
    month INTEGER,
    calculated_bonus DECIMAL(12,2),
    total_pool_amount DECIMAL(12,2),
    is_paid BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        emb.employee_id,
        te.display_name as employee_name,
        emb.role_code,
        rbp.role_name,
        emb.year,
        emb.month,
        emb.calculated_bonus,
        emb.total_pool_amount,
        emb.is_paid
    FROM public.employee_monthly_bonuses emb
    JOIN public.tenants_employee te ON emb.employee_id = te.id
    LEFT JOIN public.role_bonus_percentages rbp ON emb.role_code = rbp.role_code
    WHERE 
        (p_start_date IS NULL OR DATE(emb.year || '-' || emb.month || '-01') >= p_start_date)
        AND (p_end_date IS NULL OR DATE(emb.year || '-' || emb.month || '-01') <= p_end_date)
        AND (p_employee_id IS NULL OR emb.employee_id = p_employee_id)
    ORDER BY emb.year DESC, emb.month DESC, te.display_name;
END;
$$ LANGUAGE plpgsql;

-- 7. RLS Policies

-- Enable RLS
ALTER TABLE public.role_bonus_percentages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_bonus_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_monthly_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bonus_calculation_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for role_bonus_percentages
CREATE POLICY "Allow authenticated users to read role bonus percentages" ON public.role_bonus_percentages
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to modify role bonus percentages" ON public.role_bonus_percentages
    FOR ALL USING (auth.role() = 'authenticated');

-- RLS Policies for monthly_bonus_pools
CREATE POLICY "Allow authenticated users to read monthly bonus pools" ON public.monthly_bonus_pools
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to modify monthly bonus pools" ON public.monthly_bonus_pools
    FOR ALL USING (auth.role() = 'authenticated');

-- RLS Policies for employee_monthly_bonuses
CREATE POLICY "Allow authenticated users to read employee monthly bonuses" ON public.employee_monthly_bonuses
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to modify employee monthly bonuses" ON public.employee_monthly_bonuses
    FOR ALL USING (auth.role() = 'authenticated');

-- RLS Policies for bonus_calculation_history
CREATE POLICY "Allow authenticated users to read bonus calculation history" ON public.bonus_calculation_history
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to insert bonus calculation history" ON public.bonus_calculation_history
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 8. Triggers for updated_at timestamps

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER update_role_bonus_percentages_updated_at
    BEFORE UPDATE ON public.role_bonus_percentages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_monthly_bonus_pools_updated_at
    BEFORE UPDATE ON public.monthly_bonus_pools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_monthly_bonuses_updated_at
    BEFORE UPDATE ON public.employee_monthly_bonuses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. Sample queries for common operations

-- Get current role percentages
-- SELECT role_code, role_name, percentage FROM public.role_bonus_percentages WHERE is_active = TRUE ORDER BY percentage DESC;

-- Calculate bonuses for current month
-- SELECT * FROM calculate_monthly_bonuses(2024, 12, 10000.00, 1);

-- Get employee bonuses for date range
-- SELECT * FROM get_employee_bonuses_by_date_range('2024-01-01', '2024-12-31');

-- Get monthly bonus pools
-- SELECT year, month, total_pool_amount, is_locked FROM public.monthly_bonus_pools ORDER BY year DESC, month DESC;

-- Update role percentage
-- UPDATE public.role_bonus_percentages SET percentage = 0.25 WHERE role_code = 'c';

-- Mark bonuses as paid
-- UPDATE public.employee_monthly_bonuses SET is_paid = TRUE, paid_at = NOW() WHERE year = 2024 AND month = 12;
