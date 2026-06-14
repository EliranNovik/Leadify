-- Link invoices and payment/tax documents to a specific firm_management_costs row
-- (so each expense line has its own documents, not shared per month).

ALTER TABLE public.firm_invoices
  ADD COLUMN IF NOT EXISTS firm_management_cost_id uuid
  REFERENCES public.firm_management_costs (id) ON DELETE SET NULL;

ALTER TABLE public.firm_management_cost_documents
  ADD COLUMN IF NOT EXISTS firm_management_cost_id uuid
  REFERENCES public.firm_management_costs (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_firm_invoices_management_cost
  ON public.firm_invoices (firm_management_cost_id);

CREATE INDEX IF NOT EXISTS idx_firm_management_cost_documents_cost
  ON public.firm_management_cost_documents (firm_management_cost_id);

COMMENT ON COLUMN public.firm_invoices.firm_management_cost_id IS
  'Optional FK → firm_management_costs row this invoice belongs to.';

COMMENT ON COLUMN public.firm_management_cost_documents.firm_management_cost_id IS
  'FK → firm_management_costs row this document belongs to.';

-- Backfill payment/tax docs migrated from legacy cost columns
UPDATE public.firm_management_cost_documents d
SET firm_management_cost_id = c.id
FROM public.firm_management_costs c
WHERE d.firm_management_cost_id IS NULL
  AND d.firm_id = c.firm_id
  AND d.billing_month = c.billing_month
  AND (
    (d.doc_type = 'payment_confirmation' AND c.payment_confirmation IS NOT NULL AND c.payment_confirmation = d.storage_path)
    OR (d.doc_type = 'tax_receipt' AND c.tax_receipt IS NOT NULL AND c.tax_receipt = d.storage_path)
  );

-- Single cost line per firm+month → attach orphan month docs to that line
UPDATE public.firm_management_cost_documents d
SET firm_management_cost_id = c.id
FROM public.firm_management_costs c
WHERE d.firm_management_cost_id IS NULL
  AND d.firm_id = c.firm_id
  AND d.billing_month = c.billing_month
  AND (
    SELECT COUNT(*)
    FROM public.firm_management_costs c2
    WHERE c2.firm_id = c.firm_id
      AND c2.billing_month = c.billing_month
  ) = 1;

-- Invoices: attach to earliest cost line for same firm+month when unlinked
UPDATE public.firm_invoices i
SET firm_management_cost_id = sub.cost_id
FROM (
  SELECT DISTINCT ON (i2.id)
    i2.id AS invoice_id,
    c.id AS cost_id
  FROM public.firm_invoices i2
  JOIN public.firm_management_costs c
    ON c.firm_id = i2.firm_id
   AND c.billing_month = i2.invoice_month
  WHERE i2.firm_management_cost_id IS NULL
  ORDER BY i2.id, c.created_at ASC
) sub
WHERE i.id = sub.invoice_id
  AND i.firm_management_cost_id IS NULL;
