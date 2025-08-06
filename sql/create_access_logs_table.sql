-- Create access_logs table for storing backend API access logs
CREATE TABLE IF NOT EXISTS access_logs (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    request_method VARCHAR(10) NOT NULL,
    endpoint TEXT NOT NULL,
    request_body TEXT,
    response_body TEXT,
    response_code INTEGER NOT NULL,
    ip_address INET,
    user_agent TEXT,
    processing_time_ms INTEGER,
    user_id UUID REFERENCES auth.users(id),
    session_id TEXT
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_method ON access_logs(request_method);
CREATE INDEX IF NOT EXISTS idx_access_logs_endpoint ON access_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_access_logs_response_code ON access_logs(response_code);

-- Enable RLS (Row Level Security)
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;

-- Create policy to allow admins to read all logs
CREATE POLICY "Admins can read all access logs" ON access_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Create policy to allow service role to insert logs
CREATE POLICY "Service role can insert access logs" ON access_logs
    FOR INSERT
    WITH CHECK (true);

-- Grant necessary permissions
GRANT SELECT ON access_logs TO authenticated;
GRANT INSERT ON access_logs TO service_role;
GRANT USAGE ON SEQUENCE access_logs_id_seq TO service_role; 