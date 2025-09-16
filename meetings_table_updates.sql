-- SQL to add new columns to the meetings table
-- Run this SQL in your Supabase SQL editor or database management tool

-- Add the new columns to the meetings table
ALTER TABLE public.meetings 
ADD COLUMN IF NOT EXISTS attendance_probability VARCHAR(20) DEFAULT 'Medium',
ADD COLUMN IF NOT EXISTS complexity VARCHAR(20) DEFAULT 'Simple',
ADD COLUMN IF NOT EXISTS car_number TEXT DEFAULT '';

-- Add comments to document the new columns
COMMENT ON COLUMN public.meetings.attendance_probability IS 'Meeting attendance probability: Low, Medium, High, Very High';
COMMENT ON COLUMN public.meetings.complexity IS 'Meeting complexity: Simple, Complex';
COMMENT ON COLUMN public.meetings.car_number IS 'Car number for the meeting';

-- Create indexes for better query performance (optional)
CREATE INDEX IF NOT EXISTS idx_meetings_attendance_probability ON public.meetings(attendance_probability);
CREATE INDEX IF NOT EXISTS idx_meetings_complexity ON public.meetings(complexity);

-- Update existing records to have default values (optional)
UPDATE public.meetings 
SET 
    attendance_probability = 'Medium',
    complexity = 'Simple',
    car_number = ''
WHERE attendance_probability IS NULL 
   OR complexity IS NULL 
   OR car_number IS NULL;
