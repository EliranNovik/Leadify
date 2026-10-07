-- Office expenses share the cash box's category list.
--
-- `office_expenses.expense_type_id` pointed at `office_expense_types`, a three-row lookup of its own
-- (Open AI Fee / Legal Opinions / Consultation). The cash box's removals point at
-- `lead_expense_types` instead, and the two lists had drifted apart, so the same purchase was
-- categorised differently depending on which screen it was entered from. This repoints office
-- expenses at `lead_expense_types` so both screens offer one list.
--
-- `office_expense_types` is left in place but is no longer referenced by anything.

-- -----------------------------------------------------------------------------
-- Step 1 — refuse to run if any row would be orphaned by the new key.
--
-- When this was written every office_expenses row had a null category, so nothing needed moving.
-- If that is no longer true, the offending rows have to be recategorised by hand first: silently
-- nulling someone's category would lose data.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  stranded bigint;
BEGIN
  SELECT count(*) INTO stranded
  FROM public.office_expenses oe
  WHERE oe.expense_type_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_expense_types t WHERE t.id = oe.expense_type_id
    );

  IF stranded > 0 THEN
    RAISE EXCEPTION
      'office_expenses has % row(s) whose category is not in lead_expense_types. Recategorise them (or clear expense_type_id) before running this migration.',
      stranded;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Step 2 — move the foreign key over.
--
-- The old constraint is found by the column it covers rather than by name, because a name is only a
-- convention and dropping the wrong one would leave inserts failing against the old lookup.
-- ON DELETE SET NULL matches how finance_cash_box_transactions references the same table.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  old_constraint text;
BEGIN
  FOR old_constraint IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.office_expenses'::regclass
      AND con.contype = 'f'
      AND att.attname = 'expense_type_id'
  LOOP
    EXECUTE format('ALTER TABLE public.office_expenses DROP CONSTRAINT %I', old_constraint);
  END LOOP;

  ALTER TABLE public.office_expenses
    ADD CONSTRAINT office_expenses_expense_type_id_fkey
    FOREIGN KEY (expense_type_id)
    REFERENCES public.lead_expense_types (id)
    ON DELETE SET NULL;
END;
$$;

COMMENT ON COLUMN public.office_expenses.expense_type_id IS
  'FK → lead_expense_types (same category list the cash box uses for removals).';

COMMENT ON TABLE public.office_expense_types IS
  'Superseded by lead_expense_types; no longer referenced (see sql/2026-10-07_office_expenses_lead_expense_types.sql).';

-- -----------------------------------------------------------------------------
-- Step 3 — confirm the key now points at lead_expense_types.
-- -----------------------------------------------------------------------------
SELECT
  con.conname          AS constraint_name,
  ref.relname          AS references_table,
  con.confdeltype      AS on_delete -- 'n' = SET NULL
FROM pg_constraint con
JOIN pg_class ref ON ref.oid = con.confrelid
WHERE con.conrelid = 'public.office_expenses'::regclass
  AND con.contype = 'f';
