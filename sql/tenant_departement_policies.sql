-- Enable RLS on the tenant_departement table
ALTER TABLE tenant_departement ENABLE ROW LEVEL SECURITY;

-- Policy for SELECT (READ) operations
CREATE POLICY "Enable read access for authenticated users" ON tenant_departement
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy for INSERT (CREATE) operations
CREATE POLICY "Enable insert for authenticated users" ON tenant_departement
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Policy for UPDATE operations
CREATE POLICY "Enable update for authenticated users" ON tenant_departement
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Policy for DELETE operations
CREATE POLICY "Enable delete for authenticated users" ON tenant_departement
    FOR DELETE
    TO authenticated
    USING (true);
