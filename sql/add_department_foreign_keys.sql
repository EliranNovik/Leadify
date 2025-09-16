-- Add foreign key constraints and RLS policies for department relationships
-- This connects misc_category -> misc_maincategory -> tenant_departement

-- First, ensure all tables have proper primary keys and unique constraints

-- 1. Add primary key to misc_maincategory if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'misc_maincategory_pkey') THEN
        ALTER TABLE misc_maincategory ADD CONSTRAINT misc_maincategory_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- 2. Add primary key to tenant_departement if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_departement_pkey') THEN
        ALTER TABLE tenant_departement ADD CONSTRAINT tenant_departement_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- 3. Add primary key to misc_category if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'misc_category_pkey') THEN
        ALTER TABLE misc_category ADD CONSTRAINT misc_category_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- 4. Add foreign key constraint from misc_category to misc_maincategory
ALTER TABLE misc_category 
ADD CONSTRAINT fk_misc_category_parent_id 
FOREIGN KEY (parent_id) REFERENCES misc_maincategory(id) 
ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Add foreign key constraint from misc_maincategory to tenant_departement
ALTER TABLE misc_maincategory 
ADD CONSTRAINT fk_misc_maincategory_department_id 
FOREIGN KEY (department_id) REFERENCES tenant_departement(id) 
ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_misc_category_parent_id ON misc_category(parent_id);
CREATE INDEX IF NOT EXISTS idx_misc_maincategory_department_id ON misc_maincategory(department_id);

-- 4. RLS Policies for misc_category
ALTER TABLE misc_category ENABLE ROW LEVEL SECURITY;

-- Policy for misc_category - allow all operations for authenticated users
CREATE POLICY "Allow all operations on misc_category for authenticated users" 
ON misc_category FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- 5. RLS Policies for misc_maincategory
ALTER TABLE misc_maincategory ENABLE ROW LEVEL SECURITY;

-- Policy for misc_maincategory - allow all operations for authenticated users
CREATE POLICY "Allow all operations on misc_maincategory for authenticated users" 
ON misc_maincategory FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- 6. RLS Policies for tenant_departement
ALTER TABLE tenant_departement ENABLE ROW LEVEL SECURITY;

-- Policy for tenant_departement - allow all operations for authenticated users
CREATE POLICY "Allow all operations on tenant_departement for authenticated users" 
ON tenant_departement FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- 7. Add comments for documentation
COMMENT ON CONSTRAINT fk_misc_category_parent_id ON misc_category IS 'Links categories to their parent main category';
COMMENT ON CONSTRAINT fk_misc_maincategory_department_id ON misc_maincategory IS 'Links main categories to their department';
COMMENT ON INDEX idx_misc_category_parent_id IS 'Index for faster lookups on category parent_id';
COMMENT ON INDEX idx_misc_maincategory_department_id IS 'Index for faster lookups on main category department_id';
