-- Add front_name column to currencies table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'currencies' AND column_name = 'front_name') THEN
        ALTER TABLE currencies ADD COLUMN front_name TEXT;
    END IF;
END $$;

-- Update existing currencies with front_name values based on the screenshot
UPDATE currencies 
SET front_name = CASE 
    WHEN name = '$' THEN 'United States (USD)'
    WHEN name = '£' THEN 'Great Britain (GPB)'
    WHEN name = '€' THEN 'Europe (EUR)'
    WHEN name = '₪' THEN 'Israel (NIS)'
    ELSE name || ' (' || iso_code || ')'
END
WHERE front_name IS NULL OR front_name = '';

-- Add comment for documentation
COMMENT ON COLUMN currencies.front_name IS 'Display name for the currency/region (e.g., "United States (USD)")';

-- Create index for better query performance
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_currencies_front_name') THEN
        CREATE INDEX idx_currencies_front_name ON currencies(front_name);
    END IF;
END $$;
