-- Allow longer template names for legacy contract templates
-- Previous limit was VARCHAR(30), which prevented descriptive names
-- Expand to VARCHAR(150) so templates like "Agreement Austria EN - with archive"
-- can be saved without truncation errors.

ALTER TABLE public.misc_contracttemplate
ALTER COLUMN name TYPE VARCHAR(150);

