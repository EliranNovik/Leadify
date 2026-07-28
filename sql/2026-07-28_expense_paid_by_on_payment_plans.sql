-- Who paid an Expense finance row — used so firm-paid expenses reduce lead total value,
-- while client-paid expenses neither reduce nor inflate contract total.
-- Run after lead expenses finance link.

ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS expense_paid_by text
    CHECK (expense_paid_by IS NULL OR expense_paid_by IN ('firm', 'client'));

ALTER TABLE public.finances_paymentplanrow
  ADD COLUMN IF NOT EXISTS expense_paid_by text
    CHECK (expense_paid_by IS NULL OR expense_paid_by IN ('firm', 'client'));

COMMENT ON COLUMN public.payment_plans.expense_paid_by IS
  'For Expense rows only: firm = reduces lead total value; client = pass-through (does not reduce or inflate contract total).';

COMMENT ON COLUMN public.finances_paymentplanrow.expense_paid_by IS
  'For Expense rows (order 99) only: firm = reduces lead total value; client = pass-through.';

CREATE INDEX IF NOT EXISTS idx_payment_plans_expense_paid_by
  ON public.payment_plans (expense_paid_by)
  WHERE expense_paid_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finances_paymentplanrow_expense_paid_by
  ON public.finances_paymentplanrow (expense_paid_by)
  WHERE expense_paid_by IS NOT NULL;
