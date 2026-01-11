/* Count occurrences where lead_id and client_id are matching (equal) for id > 176788832 */
/* Note: Casting lead_id to bigint to match client_id type */
SELECT 
    COUNT(*) as matching_rows_count
FROM finances_paymentplanrow
WHERE lead_id::bigint = client_id
  AND id > 176788832;
