-- Finance cash box: NIS-only auditable ledger.
-- Balance is derived from SUM(amount_nis), where removals are stored as negative values.

CREATE TABLE IF NOT EXISTS public.finance_cash_in_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  description text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_cash_in_categories
  ADD COLUMN IF NOT EXISTS description text NULL;

INSERT INTO public.finance_cash_in_categories (code, label, description, sort_order)
VALUES
  ('petty_cash_replenishment', 'Petty Cash Replenishment', 'Standard refill from company funds', 10),
  ('cash_transfer_in', 'Cash Transfer In', 'Money transferred from another office/account', 20),
  ('returned_cash', 'Returned Cash', 'Unused money returned by an employee', 30),
  ('reimbursement_return', 'Reimbursement Return', 'Employee returns excess reimbursement/advance', 40),
  ('opening_balance', 'Opening Balance', 'Initial cash placed in the box', 50),
  ('cash_adjustment', 'Cash Adjustment', 'Correction after a counting difference', 60),
  ('other_cash_in', 'Other Cash In', 'Fallback category', 70)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

ALTER TABLE public.finance_cash_in_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view cash-in categories" ON public.finance_cash_in_categories;
CREATE POLICY "Authenticated users can view cash-in categories"
  ON public.finance_cash_in_categories FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.finance_cash_in_categories TO authenticated;

CREATE TABLE IF NOT EXISTS public.finance_cash_box_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_nis numeric(14,2) NOT NULL CHECK (amount_nis <> 0),
  expense_type_id uuid NULL REFERENCES public.lead_expense_types(id) ON DELETE SET NULL,
  cash_in_category_id uuid NULL REFERENCES public.finance_cash_in_categories(id) ON DELETE SET NULL,
  employee_id bigint NULL REFERENCES public.tenants_employee(id) ON DELETE SET NULL,
  notes text NULL,
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_cash_box_transactions
  ADD COLUMN IF NOT EXISTS cash_in_category_id uuid NULL
  REFERENCES public.finance_cash_in_categories(id) ON DELETE SET NULL;

-- Safe when this migration was already run with the general expense_types FK.
ALTER TABLE public.finance_cash_box_transactions
  DROP CONSTRAINT IF EXISTS finance_cash_box_transactions_expense_type_id_fkey;
ALTER TABLE public.finance_cash_box_transactions
  ADD CONSTRAINT finance_cash_box_transactions_expense_type_id_fkey
  FOREIGN KEY (expense_type_id) REFERENCES public.lead_expense_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS finance_cash_box_transactions_date_idx
  ON public.finance_cash_box_transactions (transaction_date DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_finance_cash_box_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  ELSE
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_cash_box_audit_trigger ON public.finance_cash_box_transactions;
CREATE TRIGGER finance_cash_box_audit_trigger
BEFORE INSERT OR UPDATE ON public.finance_cash_box_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_finance_cash_box_audit();

ALTER TABLE public.finance_cash_box_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view cash box" ON public.finance_cash_box_transactions;
CREATE POLICY "Authenticated users can view cash box"
  ON public.finance_cash_box_transactions FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can add cash box transactions" ON public.finance_cash_box_transactions;
CREATE POLICY "Authenticated users can add cash box transactions"
  ON public.finance_cash_box_transactions FOR INSERT TO authenticated
  WITH CHECK (created_by IS NULL OR created_by = auth.uid());

DROP POLICY IF EXISTS "Creators and superusers can update cash box transactions" ON public.finance_cash_box_transactions;
DROP POLICY IF EXISTS "Only superusers can update cash box transactions" ON public.finance_cash_box_transactions;
CREATE POLICY "Only superusers can update cash box transactions"
  ON public.finance_cash_box_transactions FOR UPDATE TO authenticated
  USING (public.is_app_superuser())
  WITH CHECK (public.is_app_superuser());

DROP POLICY IF EXISTS "Creators and superusers can delete cash box transactions" ON public.finance_cash_box_transactions;
DROP POLICY IF EXISTS "Only superusers can delete cash box transactions" ON public.finance_cash_box_transactions;
CREATE POLICY "Only superusers can delete cash box transactions"
  ON public.finance_cash_box_transactions FOR DELETE TO authenticated
  USING (public.is_app_superuser());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_cash_box_transactions TO authenticated;

-- Private documents attached to cash box transactions.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finance-cash-box-documents',
  'finance-cash-box-documents',
  false,
  15728640,
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "finance-cash-box-documents insert" ON storage.objects;
DROP POLICY IF EXISTS "finance-cash-box-documents select" ON storage.objects;
DROP POLICY IF EXISTS "finance-cash-box-documents delete" ON storage.objects;
CREATE POLICY "finance-cash-box-documents insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'finance-cash-box-documents');
CREATE POLICY "finance-cash-box-documents select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'finance-cash-box-documents');
CREATE POLICY "finance-cash-box-documents delete" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'finance-cash-box-documents' AND public.is_app_superuser()
  );

CREATE TABLE IF NOT EXISTS public.finance_cash_box_documents (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES public.finance_cash_box_transactions(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NULL,
  storage_path text NOT NULL,
  uploaded_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_cash_box_documents_transaction_idx
  ON public.finance_cash_box_documents (transaction_id, created_at);

ALTER TABLE public.finance_cash_box_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view cash box documents" ON public.finance_cash_box_documents;
CREATE POLICY "Authenticated users can view cash box documents"
  ON public.finance_cash_box_documents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can add cash box documents" ON public.finance_cash_box_documents;
CREATE POLICY "Authenticated users can add cash box documents"
  ON public.finance_cash_box_documents FOR INSERT TO authenticated
  WITH CHECK (uploaded_by IS NULL OR uploaded_by = auth.uid());
DROP POLICY IF EXISTS "Only superusers can delete cash box documents" ON public.finance_cash_box_documents;
CREATE POLICY "Only superusers can delete cash box documents"
  ON public.finance_cash_box_documents FOR DELETE TO authenticated
  USING (public.is_app_superuser());

GRANT SELECT, INSERT, DELETE ON public.finance_cash_box_documents TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.finance_cash_box_documents_id_seq TO authenticated;
