-- Drop all existing overloads of create_proforma_with_rows to avoid conflicts
DROP FUNCTION IF EXISTS create_proforma_with_rows(bigint, numeric, numeric, numeric, text, numeric, text, numeric, numeric, numeric, jsonb);
DROP FUNCTION IF EXISTS create_proforma_with_rows(bigint, numeric, numeric, numeric, text, numeric, text, numeric, numeric, numeric, numeric, jsonb);

-- Update create_proforma_with_rows function to accept creator_id parameter
CREATE OR REPLACE FUNCTION create_proforma_with_rows(
    p_lead_id bigint,
    p_total numeric,
    p_total_base numeric,
    p_vat_value numeric DEFAULT 0,
    p_notes text DEFAULT NULL,
    p_sub_total numeric DEFAULT NULL,
    p_add_vat text DEFAULT 'f',
    p_currency_id numeric DEFAULT 1,
    p_client_id numeric DEFAULT NULL,
    p_bank_account_id numeric DEFAULT NULL,
    p_ppr_id numeric DEFAULT NULL,
    p_creator_id numeric DEFAULT NULL,
    p_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
    v_proforma_id bigint;
    v_row jsonb;
BEGIN
    -- Insert proforma
    INSERT INTO proformainvoice (
        cdate, total, total_base, vat_value, notes, sub_total, 
        add_vat, currency_id, lead_id, client_id, bank_account_id, ppr_id, creator_id
    ) VALUES (
        current_date, p_total, p_total_base, p_vat_value, p_notes, 
        p_sub_total, p_add_vat, p_currency_id, p_lead_id, p_client_id, p_bank_account_id, p_ppr_id, p_creator_id
    ) RETURNING id INTO v_proforma_id;
    
    -- Insert rows
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        INSERT INTO proformainvoicerow (
            description, qty, rate, total, invoice_id
        ) VALUES (
            COALESCE(v_row->>'description', ''),
            COALESCE((v_row->>'qty')::numeric, 1),
            COALESCE((v_row->>'rate')::numeric, 0),
            COALESCE((v_row->>'total')::numeric, 0),
            v_proforma_id
        );
    END LOOP;
    
    RETURN v_proforma_id;
END;
$$;

-- Update GRANT statement to include the new parameter signature
-- Revoke old grants for all overloads
DO $$
BEGIN
    -- Revoke old grants (if they exist)
    EXECUTE 'REVOKE EXECUTE ON FUNCTION create_proforma_with_rows(bigint, numeric, numeric, numeric, text, numeric, text, numeric, numeric, numeric, jsonb) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION create_proforma_with_rows(bigint, numeric, numeric, numeric, text, numeric, text, numeric, numeric, numeric, numeric, jsonb) FROM authenticated';
EXCEPTION
    WHEN OTHERS THEN
        -- Ignore if grants don't exist
        NULL;
END $$;

-- Grant execute permission with new signature (13 parameters: including p_ppr_id and p_creator_id)
GRANT EXECUTE ON FUNCTION create_proforma_with_rows(bigint, numeric, numeric, numeric, text, numeric, text, numeric, numeric, numeric, numeric, numeric, jsonb) TO authenticated;
