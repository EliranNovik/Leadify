-- Enable RLS on misc_category table
ALTER TABLE public.misc_category ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to read all categories
CREATE POLICY "Allow authenticated users to read misc_category" ON public.misc_category
    FOR SELECT
    TO authenticated
    USING (true);

-- Create policy to allow service role to read all categories (for backend operations)
CREATE POLICY "Allow service role to read misc_category" ON public.misc_category
    FOR SELECT
    TO service_role
    USING (true);

-- Create policy to allow anon users to read categories (if needed for public access)
CREATE POLICY "Allow anon users to read misc_category" ON public.misc_category
    FOR SELECT
    TO anon
    USING (true);

-- Optional: Create policy for inserting/updating if needed
CREATE POLICY "Allow authenticated users to insert misc_category" ON public.misc_category
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update misc_category" ON public.misc_category
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Optional: Create policy for deleting if needed
CREATE POLICY "Allow authenticated users to delete misc_category" ON public.misc_category
    FOR DELETE
    TO authenticated
    USING (true);
