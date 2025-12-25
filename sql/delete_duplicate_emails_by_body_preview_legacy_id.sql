-- Delete duplicate emails where the same body_preview is saved multiple times for the same legacy_id
-- Keeps the email with the lowest id and deletes the rest

DELETE FROM emails
WHERE id IN (
    SELECT e.id
    FROM emails e
    INNER JOIN (
        SELECT 
            body_preview,
            legacy_id,
            MIN(id) as keep_id
        FROM emails
        WHERE legacy_id IS NOT NULL
          AND body_preview IS NOT NULL
          AND body_preview != ''
        GROUP BY body_preview, legacy_id
        HAVING COUNT(*) > 1
    ) keep ON e.body_preview = keep.body_preview 
           AND e.legacy_id = keep.legacy_id
    WHERE e.id != keep.keep_id
);

