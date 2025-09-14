-- Add unavailable_ranges column to tenants_employee table
-- This column will store JSON array of unavailable date ranges

ALTER TABLE tenants_employee 
ADD COLUMN unavailable_ranges JSONB DEFAULT '[]'::jsonb;

-- Add a comment to describe the column
COMMENT ON COLUMN tenants_employee.unavailable_ranges IS 'JSON array of unavailable date ranges with structure: [{"id": "string", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "reason": "string", "outlookEventId": "string"}]';

-- Create an index for better performance when querying ranges
CREATE INDEX idx_tenants_employee_unavailable_ranges ON tenants_employee USING GIN (unavailable_ranges);
