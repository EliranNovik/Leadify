-- Check if sequences are still integer type (this could cause overflow even if columns are bigint)
WITH seq_stats AS (
    SELECT 
        schemaname,
        sequencename,
        data_type,
        start_value,
        min_value,
        max_value,
        cache_size,
        last_value,
        CASE 
            WHEN data_type::text = 'integer' AND last_value > 2000000000 THEN 'WARNING - sequence is integer and approaching limit'
            WHEN data_type::text = 'integer' THEN 'WARNING - sequence is integer (should be bigint)'
            ELSE 'OK'
        END as status
    FROM pg_sequences
    WHERE sequencename IN (
        'leads_contact_id_seq',
        'lead_leadcontact_id_seq',
        'leads_lead_id_seq'
    )
)
SELECT * FROM seq_stats
ORDER BY sequencename;

-- Also check the resolved regclass and type to confirm existence
SELECT 
    'lead_leadcontact_id_seq' as sequence_name,
    to_regclass('lead_leadcontact_id_seq') as resolved_sequence,
    pg_typeof(nextval('lead_leadcontact_id_seq'::regclass)) as sequence_type;

