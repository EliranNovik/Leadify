-- =============================================================================
-- Multiple payment confirmations / tax receipts per firm per billing month
-- (replaces single path columns on firm_management_costs for new uploads)
--
-- Prerequisites: firms, firm_management_costs, document buckets from
--   create_firm_management_cost_document_buckets.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.firm_management_cost_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms (id) ON DELETE CASCADE,
  billing_month date NOT NULL,
  doc_type text NOT NULL,
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firm_management_cost_documents_doc_type_chk CHECK (
    doc_type IN ('payment_confirmation', 'tax_receipt')
  )
);

COMMENT ON TABLE public.firm_management_cost_documents IS
  'Payment confirmations and tax receipts per firm + billing month (multiple files allowed).';

CREATE INDEX IF NOT EXISTS idx_firm_management_cost_documents_firm_month
  ON public.firm_management_cost_documents (firm_id, billing_month);

CREATE INDEX IF NOT EXISTS idx_firm_management_cost_documents_type
  ON public.firm_management_cost_documents (doc_type);

-- Migrate legacy single-path columns (one document per cost row)
INSERT INTO public.firm_management_cost_documents (
  firm_id,
  billing_month,
  doc_type,
  storage_path,
  file_name,
  created_at
)
SELECT
  c.firm_id,
  c.billing_month,
  'payment_confirmation',
  c.payment_confirmation,
  regexp_replace(c.payment_confirmation, '^.*/', ''),
  COALESCE(c.updated_at, c.created_at, now())
FROM public.firm_management_costs c
WHERE c.payment_confirmation IS NOT NULL
  AND trim(c.payment_confirmation) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.firm_management_cost_documents d
    WHERE d.firm_id = c.firm_id
      AND d.billing_month = c.billing_month
      AND d.doc_type = 'payment_confirmation'
      AND d.storage_path = c.payment_confirmation
  );

INSERT INTO public.firm_management_cost_documents (
  firm_id,
  billing_month,
  doc_type,
  storage_path,
  file_name,
  created_at
)
SELECT
  c.firm_id,
  c.billing_month,
  'tax_receipt',
  c.tax_receipt,
  regexp_replace(c.tax_receipt, '^.*/', ''),
  COALESCE(c.updated_at, c.created_at, now())
FROM public.firm_management_costs c
WHERE c.tax_receipt IS NOT NULL
  AND trim(c.tax_receipt) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.firm_management_cost_documents d
    WHERE d.firm_id = c.firm_id
      AND d.billing_month = c.billing_month
      AND d.doc_type = 'tax_receipt'
      AND d.storage_path = c.tax_receipt
  );

ALTER TABLE public.firm_management_cost_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm_management_cost_documents_authenticated_all"
  ON public.firm_management_cost_documents;
CREATE POLICY "firm_management_cost_documents_authenticated_all"
  ON public.firm_management_cost_documents
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_management_cost_documents TO authenticated;
