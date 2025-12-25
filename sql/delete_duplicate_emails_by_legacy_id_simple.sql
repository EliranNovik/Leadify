-- Delete duplicate emails where the same message_id is saved multiple times for the same legacy_id
-- Keeps the email with the lowest id and deletes the rest

DELETE FROM emails
WHERE id IN (
    SELECT e.id
    FROM emails e
    INNER JOIN (
        SELECT 
            message_id,
            legacy_id,
            MIN(id) as keep_id
        FROM emails
        WHERE legacy_id IS NOT NULL
          AND message_id IS NOT NULL
        GROUP BY message_id, legacy_id
        HAVING COUNT(*) > 1
    ) keep ON e.message_id = keep.message_id 
           AND e.legacy_id = keep.legacy_id
    WHERE e.id != keep.keep_id
);
