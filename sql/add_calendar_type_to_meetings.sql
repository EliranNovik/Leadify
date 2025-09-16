-- Add calendar_type column to meetings table to track whether meeting is for potential or active client
-- This will help distinguish meetings in the calendar view

-- Add the new column
ALTER TABLE meetings 
ADD COLUMN calendar_type VARCHAR(20) DEFAULT 'potential_client' 
CHECK (calendar_type IN ('potential_client', 'active_client'));

-- Add a comment to explain the column
COMMENT ON COLUMN meetings.calendar_type IS 'Indicates whether the meeting is for a potential client (shared-potentialclients@lawoffice.org.il) or active client (shared-newclients@lawoffice.org.il)';

-- Update existing meetings to have the default value
UPDATE meetings 
SET calendar_type = 'potential_client' 
WHERE calendar_type IS NULL;

-- Make the column NOT NULL after setting default values
ALTER TABLE meetings 
ALTER COLUMN calendar_type SET NOT NULL;

-- Create an index for better query performance
CREATE INDEX idx_meetings_calendar_type ON meetings(calendar_type);
