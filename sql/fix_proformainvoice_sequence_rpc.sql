-- Create an RPC function to fix the proformainvoice and proformainvoicerow sequences
-- This can be called from the client when a sequence sync error is detected

-- Drop the function if it exists (to allow changing return type)
DROP FUNCTION IF EXISTS fix_proformainvoice_sequence();

CREATE OR REPLACE FUNCTION fix_proformainvoice_sequence()
RETURNS JSON AS $$
DECLARE
  v_max_id BIGINT;
  v_new_seq_value BIGINT;
  v_sequence_name TEXT;
  v_invoice_seq_value BIGINT;
  v_row_seq_value BIGINT;
BEGIN
  -- Fix proformainvoice sequence
  SELECT pg_get_serial_sequence('public.proformainvoice', 'id') INTO v_sequence_name;
  
  IF v_sequence_name IS NULL THEN
    v_sequence_name := 'public.proformainvoice_id_seq';
  END IF;
  
  SELECT COALESCE(MAX(id), 0) INTO v_max_id FROM public.proformainvoice;
  v_invoice_seq_value := v_max_id + 1;
  EXECUTE format('SELECT setval(%L, %s, false)', v_sequence_name, v_invoice_seq_value);
  
  -- Fix proformainvoicerow sequence
  SELECT pg_get_serial_sequence('public.proformainvoicerow', 'id') INTO v_sequence_name;
  
  IF v_sequence_name IS NULL THEN
    v_sequence_name := 'public.proformainvoicerow_id_seq';
  END IF;
  
  SELECT COALESCE(MAX(id), 0) INTO v_max_id FROM public.proformainvoicerow;
  v_row_seq_value := v_max_id + 1;
  EXECUTE format('SELECT setval(%L, %s, false)', v_sequence_name, v_row_seq_value);
  
  -- Return both sequence values as JSON
  RETURN json_build_object(
    'proformainvoice', v_invoice_seq_value,
    'proformainvoicerow', v_row_seq_value
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION fix_proformainvoice_sequence() TO authenticated;

