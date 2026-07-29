-- Atomic multi-lead expense split.
-- Creates one linked Finances row and one lead_expenses row per lead/contact line.
-- Requires the 2026-07-28 lead expenses migrations.

CREATE SEQUENCE IF NOT EXISTS public.lead_expense_legacy_plan_id_seq
  AS bigint
  START WITH 1000000000000;

DO $$
DECLARE
  v_last bigint;
  v_max bigint;
BEGIN
  SELECT last_value INTO v_last FROM public.lead_expense_legacy_plan_id_seq;
  SELECT COALESCE(MAX(id), 1000000000000) INTO v_max
  FROM public.finances_paymentplanrow;
  PERFORM setval(
    'public.lead_expense_legacy_plan_id_seq',
    GREATEST(v_last, v_max, 1000000000000),
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_split_lead_expenses(
  p_lines jsonb,
  p_expense_type_id uuid,
  p_currency_id integer,
  p_currency text,
  p_expense_date date,
  p_notes text,
  p_finance_notes text,
  p_include_vat boolean,
  p_paid_by text,
  p_is_reimbursable boolean,
  p_is_reimbursed boolean,
  p_created_by_display text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_lead_type text;
  v_new_lead_id uuid;
  v_legacy_lead_id bigint;
  v_lead_number text;
  v_contact_id bigint;
  v_contact_name text;
  v_amount numeric(14, 2);
  v_vat_amount numeric(14, 2);
  v_payment_id bigint;
  v_expense_id bigint;
  v_expense_ids jsonb := '[]'::jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Select at least two lead contacts';
  END IF;
  IF p_paid_by NOT IN ('firm', 'client') THEN
    RAISE EXCEPTION 'Invalid paid-by value';
  END IF;
  IF p_is_reimbursed AND NOT p_is_reimbursable THEN
    RAISE EXCEPTION 'A reimbursed expense must be reimbursable';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) AS line
    GROUP BY
      line->>'lead_type',
      line->>'new_lead_id',
      line->>'legacy_lead_id',
      line->>'contact_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'The same lead contact was selected more than once';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_lead_type := v_line->>'lead_type';
    v_new_lead_id := NULLIF(v_line->>'new_lead_id', '')::uuid;
    v_legacy_lead_id := NULLIF(v_line->>'legacy_lead_id', '')::bigint;
    v_lead_number := NULLIF(BTRIM(v_line->>'lead_number'), '');
    v_contact_id := NULLIF(v_line->>'contact_id', '')::bigint;
    v_amount := ROUND((v_line->>'amount')::numeric, 2);
    v_vat_amount := ROUND(COALESCE((v_line->>'vat_amount')::numeric, 0), 2);

    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Every split amount must be greater than zero';
    END IF;
    IF v_contact_id IS NULL THEN
      RAISE EXCEPTION 'Every split line requires a contact';
    END IF;

    SELECT NULLIF(BTRIM(name), '')
    INTO v_contact_name
    FROM public.leads_contact
    WHERE id = v_contact_id;
    IF v_contact_name IS NULL THEN
      v_contact_name := 'Contact #' || v_contact_id;
    END IF;

    IF v_lead_type = 'new' AND v_new_lead_id IS NOT NULL AND v_legacy_lead_id IS NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.lead_leadcontact
        WHERE newlead_id = v_new_lead_id
          AND contact_id = v_contact_id
      ) THEN
        RAISE EXCEPTION 'Selected contact % does not belong to new lead %',
          v_contact_id, v_new_lead_id;
      END IF;

      INSERT INTO public.payment_plans (
        lead_id,
        due_percent,
        percent,
        due_date,
        value,
        value_vat,
        client_name,
        client_id,
        payment_order,
        notes,
        currency,
        currency_id,
        created_by,
        expense_paid_by
      )
      VALUES (
        v_new_lead_id,
        0,
        0,
        p_expense_date,
        v_amount,
        v_vat_amount,
        v_contact_name,
        v_contact_id,
        'Expense',
        p_finance_notes,
        p_currency,
        p_currency_id,
        COALESCE(NULLIF(BTRIM(p_created_by_display), ''), 'System User'),
        p_paid_by
      )
      RETURNING id INTO v_payment_id;

      INSERT INTO public.lead_expenses (
        lead_type,
        new_lead_id,
        legacy_lead_id,
        lead_number,
        expense_type_id,
        amount,
        currency_id,
        expense_date,
        notes,
        include_vat,
        paid_by,
        is_reimbursable,
        is_reimbursed,
        contact_id,
        payment_plan_id,
        legacy_payment_plan_row_id,
        created_by,
        updated_by
      )
      VALUES (
        'new',
        v_new_lead_id,
        NULL,
        v_lead_number,
        p_expense_type_id,
        v_amount,
        p_currency_id,
        p_expense_date,
        NULLIF(BTRIM(p_notes), ''),
        p_include_vat,
        p_paid_by,
        p_is_reimbursable,
        p_is_reimbursed,
        v_contact_id,
        v_payment_id,
        NULL,
        auth.uid(),
        auth.uid()
      )
      RETURNING id INTO v_expense_id;
    ELSIF v_lead_type = 'legacy'
      AND v_legacy_lead_id IS NOT NULL
      AND v_new_lead_id IS NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.lead_leadcontact
        WHERE lead_id = v_legacy_lead_id
          AND contact_id = v_contact_id
      ) THEN
        RAISE EXCEPTION 'Selected contact % does not belong to legacy lead %',
          v_contact_id, v_legacy_lead_id;
      END IF;

      v_payment_id := nextval('public.lead_expense_legacy_plan_id_seq');
      INSERT INTO public.finances_paymentplanrow (
        id,
        cdate,
        udate,
        date,
        value,
        vat_value,
        lead_id,
        notes,
        due_date,
        due_percent,
        "order",
        currency_id,
        client_id,
        expense_paid_by
      )
      VALUES (
        v_payment_id,
        CURRENT_DATE,
        CURRENT_DATE,
        p_expense_date,
        v_amount,
        v_vat_amount,
        v_legacy_lead_id,
        p_finance_notes,
        NULL,
        '0%',
        99,
        p_currency_id,
        v_contact_id,
        p_paid_by
      );

      INSERT INTO public.lead_expenses (
        lead_type,
        new_lead_id,
        legacy_lead_id,
        lead_number,
        expense_type_id,
        amount,
        currency_id,
        expense_date,
        notes,
        include_vat,
        paid_by,
        is_reimbursable,
        is_reimbursed,
        contact_id,
        payment_plan_id,
        legacy_payment_plan_row_id,
        created_by,
        updated_by
      )
      VALUES (
        'legacy',
        NULL,
        v_legacy_lead_id,
        v_lead_number,
        p_expense_type_id,
        v_amount,
        p_currency_id,
        p_expense_date,
        NULLIF(BTRIM(p_notes), ''),
        p_include_vat,
        p_paid_by,
        p_is_reimbursable,
        p_is_reimbursed,
        v_contact_id,
        NULL,
        v_payment_id,
        auth.uid(),
        auth.uid()
      )
      RETURNING id INTO v_expense_id;
    ELSE
      RAISE EXCEPTION 'Each split line must identify exactly one new or legacy lead';
    END IF;

    v_expense_ids := v_expense_ids || jsonb_build_array(v_expense_id);
  END LOOP;

  RETURN jsonb_build_object(
    'expense_ids', v_expense_ids,
    'count', jsonb_array_length(v_expense_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_split_lead_expenses(
  jsonb, uuid, integer, text, date, text, text, boolean, text, boolean, boolean, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_split_lead_expenses(
  jsonb, uuid, integer, text, date, text, text, boolean, text, boolean, boolean, text
) TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.lead_expense_legacy_plan_id_seq TO authenticated;
