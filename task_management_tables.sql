-- Task Management Tables for Handler Dashboard

-- Main tasks table
CREATE TABLE handler_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  assigned_to text, -- handler username/email
  created_by text NOT NULL,
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  tags text[], -- array of tags like ['documents', 'urgent', 'client_contact']
  estimated_hours integer,
  actual_hours integer
);

-- Task comments/notes table for collaboration
CREATE TABLE task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES handler_tasks(id) ON DELETE CASCADE,
  comment text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now(),
  is_internal boolean DEFAULT true -- true for internal notes, false for client-visible
);

-- Task attachments table
CREATE TABLE task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES handler_tasks(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size integer,
  uploaded_by text NOT NULL,
  uploaded_at timestamptz DEFAULT now()
);

-- Task time tracking table
CREATE TABLE task_time_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES handler_tasks(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  duration_minutes integer,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX idx_handler_tasks_lead_id ON handler_tasks(lead_id);
CREATE INDEX idx_handler_tasks_assigned_to ON handler_tasks(assigned_to);
CREATE INDEX idx_handler_tasks_status ON handler_tasks(status);
CREATE INDEX idx_handler_tasks_priority ON handler_tasks(priority);
CREATE INDEX idx_handler_tasks_due_date ON handler_tasks(due_date);
CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX idx_task_attachments_task_id ON task_attachments(task_id);
CREATE INDEX idx_task_time_logs_task_id ON task_time_logs(task_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_handler_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_update_handler_tasks_updated_at
  BEFORE UPDATE ON handler_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_handler_tasks_updated_at();

-- Insert some sample task data (optional)
INSERT INTO handler_tasks (lead_id, title, description, priority, assigned_to, created_by, due_date, tags) 
SELECT 
  id as lead_id,
  'Review client documents for ' || name,
  'Check all uploaded documents and verify completeness',
  'high',
  handler,
  'system',
  now() + interval '7 days',
  ARRAY['documents', 'review']
FROM leads 
WHERE stage = 'handler_assigned' 
LIMIT 3; 