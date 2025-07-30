-- Fix function return type issue

-- Drop the existing function first
DROP FUNCTION IF EXISTS get_contact_document_completion(uuid);

-- Recreate the function with correct return type
CREATE OR REPLACE FUNCTION get_contact_document_completion(p_contact_id uuid)
RETURNS TABLE(
  total integer,
  completed integer,
  percentage numeric
) AS $$
BEGIN
  RETURN QUERY
  WITH doc_stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status IN ('received', 'approved') THEN 1 END) as completed
    FROM lead_required_documents 
    WHERE contact_id = p_contact_id
  )
  SELECT 
    total::integer,
    completed::integer,
    CASE 
      WHEN total > 0 THEN ROUND((completed::numeric / total::numeric) * 100, 1)
      ELSE 0
    END as percentage
  FROM doc_stats;
END;
$$ LANGUAGE plpgsql; 