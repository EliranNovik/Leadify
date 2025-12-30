-- Fix proformainvoice and proformainvoicerow ID sequence synchronization
-- This script ensures the sequences are synced with the actual maximum IDs in the tables
-- This is needed when IDs are inserted manually or imported, causing the sequences to be out of sync

DO $$
DECLARE
    v_max_id bigint;
    v_sequence_name text;
    v_new_seq_value bigint;
BEGIN
    -- Fix proformainvoice sequence
    RAISE NOTICE '=== Fixing proformainvoice sequence ===';
    
    SELECT pg_get_serial_sequence('public.proformainvoice', 'id') INTO v_sequence_name;
    
    IF v_sequence_name IS NULL THEN
        v_sequence_name := 'public.proformainvoice_id_seq';
    END IF;
    
    RAISE NOTICE 'Sequence name: %', v_sequence_name;
    
    SELECT COALESCE(MAX(id), 0) INTO v_max_id FROM public.proformainvoice;
    RAISE NOTICE 'Current max ID in table: %', v_max_id;
    
    v_new_seq_value := v_max_id + 1;
    EXECUTE format('SELECT setval(%L, %s, false)', v_sequence_name, v_new_seq_value);
    
    RAISE NOTICE 'Sequence updated to: %', v_new_seq_value;
    
    -- Fix proformainvoicerow sequence
    RAISE NOTICE '=== Fixing proformainvoicerow sequence ===';
    
    SELECT pg_get_serial_sequence('public.proformainvoicerow', 'id') INTO v_sequence_name;
    
    IF v_sequence_name IS NULL THEN
        v_sequence_name := 'public.proformainvoicerow_id_seq';
    END IF;
    
    RAISE NOTICE 'Sequence name: %', v_sequence_name;
    
    SELECT COALESCE(MAX(id), 0) INTO v_max_id FROM public.proformainvoicerow;
    RAISE NOTICE 'Current max ID in table: %', v_max_id;
    
    v_new_seq_value := v_max_id + 1;
    EXECUTE format('SELECT setval(%L, %s, false)', v_sequence_name, v_new_seq_value);
    
    RAISE NOTICE 'Sequence updated to: %', v_new_seq_value;
    RAISE NOTICE '=== All sequences synchronized! ===';
END $$;

