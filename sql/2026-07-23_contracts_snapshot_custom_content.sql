-- Backfill per-entity digital contracts that still have null custom_content
-- (legacy "live template link" rows). Snapshot current template body onto each contract
-- so future edits stay isolated and admin templates are no longer shared.

UPDATE contracts c
SET custom_content = ct.content
FROM contract_templates ct
WHERE c.template_id = ct.id
  AND c.custom_content IS NULL
  AND ct.content IS NOT NULL
  AND (
    c.employee_id IS NOT NULL
    OR c.user_id IS NOT NULL
    OR c.external_firm_id IS NOT NULL
  );
