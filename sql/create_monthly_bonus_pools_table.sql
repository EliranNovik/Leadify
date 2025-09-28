-- Create monthly_bonus_pools table
CREATE TABLE IF NOT EXISTS monthly_bonus_pools (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    total_bonus_pool DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
    pool_percentage DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE 
            WHEN total_revenue > 0 THEN (total_bonus_pool / total_revenue) * 100
            ELSE 0
        END
    ) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by BIGINT REFERENCES auth_user(id),
    updated_by BIGINT REFERENCES auth_user(id),
    
    -- Ensure one pool record per month/year
    UNIQUE(year, month)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_monthly_bonus_pools_year_month ON monthly_bonus_pools(year, month);
CREATE INDEX IF NOT EXISTS idx_monthly_bonus_pools_created_at ON monthly_bonus_pools(created_at);

-- Add RLS (Row Level Security) policies
ALTER TABLE monthly_bonus_pools ENABLE ROW LEVEL SECURITY;

-- Policy to allow authenticated users to read bonus pools
CREATE POLICY "Allow authenticated users to read bonus pools" ON monthly_bonus_pools
    FOR SELECT USING (auth.role() = 'authenticated');

-- Policy to allow authenticated users to insert bonus pools
CREATE POLICY "Allow authenticated users to insert bonus pools" ON monthly_bonus_pools
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy to allow authenticated users to update bonus pools
CREATE POLICY "Allow authenticated users to update bonus pools" ON monthly_bonus_pools
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Policy to allow authenticated users to delete bonus pools
CREATE POLICY "Allow authenticated users to delete bonus pools" ON monthly_bonus_pools
    FOR DELETE USING (auth.role() = 'authenticated');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_monthly_bonus_pools_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_monthly_bonus_pools_updated_at
    BEFORE UPDATE ON monthly_bonus_pools
    FOR EACH ROW
    EXECUTE FUNCTION update_monthly_bonus_pools_updated_at();

-- Add comment to document the table
COMMENT ON TABLE monthly_bonus_pools IS 'Monthly bonus pools with calculated percentage based on total revenue';
COMMENT ON COLUMN monthly_bonus_pools.total_bonus_pool IS 'Total bonus pool amount for the month';
COMMENT ON COLUMN monthly_bonus_pools.total_revenue IS 'Total revenue for the month (used to calculate pool percentage)';
COMMENT ON COLUMN monthly_bonus_pools.pool_percentage IS 'Calculated percentage of bonus pool relative to total revenue (auto-calculated)';
