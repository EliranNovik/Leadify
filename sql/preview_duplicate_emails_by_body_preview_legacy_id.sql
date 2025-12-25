-- Preview duplicate emails by body_preview and legacy_id

WITH duplicates AS (
    SELECT 
        body_preview,
        legacy_id,
        COUNT(*) as duplicate_count,
        MIN(id) as keep_id
    FROM emails
    WHERE legacy_id IS NOT NULL
      AND body_preview IS NOT NULL
      AND body_preview != ''
    GROUP BY body_preview, legacy_id
    HAVING COUNT(*) > 1
)
SELECT 
    d.body_preview,
    d.legacy_id,
    d.duplicate_count,
    d.keep_id,
    ARRAY_AGG(e.id ORDER BY e.id) as delete_ids,
    ARRAY_AGG(e.id ORDER BY e.id) as all_ids
FROM duplicates d
INNER JOIN emails e ON e.body_preview = d.body_preview AND e.legacy_id = d.legacy_id
WHERE e.id != d.keep_id
GROUP BY d.body_preview, d.legacy_id, d.duplicate_count, d.keep_id
ORDER BY d.duplicate_count DESC
LIMIT 100;

