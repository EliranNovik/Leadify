-- Allow Finance → Expenses registry to include Rent and Partner draws
-- (office_rent_expense / partner_draw_expense).

ALTER TABLE public.finance_expense_entries
  DROP CONSTRAINT IF EXISTS finance_expense_entries_kind_check;

ALTER TABLE public.finance_expense_entries
  ADD CONSTRAINT finance_expense_entries_kind_check
  CHECK (kind IN (
    'lead',
    'subcontractor',
    'other_firm',
    'office',
    'marketing',
    'rent',
    'partner_draws'
  ));
