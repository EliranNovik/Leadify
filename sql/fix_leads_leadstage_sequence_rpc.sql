-- Create an RPC function to fix the leads_leadstage sequence
-- This can be called from the client when a sequence sync error is detected

CREATE OR REPLACE FUNCTION fix_leads_leadstage_sequence()
RETURNS BIGINT AS $$
DECLARE
  v_max_id BIGINT;
  v_new_seq_value BIGINT;
BEGIN
  -- Get the maximum ID from the table
  SELECT COALESCE(MAX(id), 0) INTO v_max_id
  FROM leads_leadstage;
  
  -- Set the sequence to max_id + 1
  v_new_seq_value := v_max_id + 1;
  
  -- Reset the sequence
  PERFORM setval('leads_leadstage_id_seq', v_new_seq_value, false);
  
  -- Return the new sequence value
  RETURN v_new_seq_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION fix_leads_leadstage_sequence() TO authenticated;

