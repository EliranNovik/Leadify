-- Give "sent to finance" its own date, and backfill the rows that were invoiced but never marked.
--
-- Why this is needed
-- ------------------
-- The Dashboard "Sent to finance" scoreboard files each row under its `due_date`, and every code
-- path that marks a row sent to finance overwrites `due_date` with the day it was marked. That made
-- the due date double as a sent-to-finance date, at the cost of destroying the real payment
-- schedule. It also means rows that were invoiced without being marked — see below — can never be
-- counted on the day their invoice went out, because their due date is years away.
--
-- `sent_to_finance_at` already exists for exactly this purpose but was only written by a rarely-used
-- admin action (8 rows in total) and read by nothing that reports. This migration makes it the
-- authoritative sent-to-finance date and backfills it so no history is lost.
--
-- The 317 unmarked rows
-- ---------------------
-- `backend/src/services/proformaInvoiceSendService.js` recorded `invoice_sent` without also marking
-- `ready_to_pay`, unlike the frontend path in `src/lib/markPaymentPlanInvoiceSent.ts` which does
-- both. Every invoice sent by the backend therefore shows as invoiced but not sent to finance.
--
-- `due_date` is deliberately NOT touched here. Whole payment plans are invoiced in one go — one
-- lead has 30 installments all invoiced on 2026-09-28 but due monthly through February 2029 — so
-- collapsing those due dates onto the invoice date would erase the agreed schedule and make the
-- Collection Due Report demand the entire multi-year balance at once.

BEGIN;

-- 0. Snapshot what this migration is about to change, so it can be undone.
--    Step 1 flips `ready_to_pay` on rows that were invoiced but never marked, and after the fact
--    those are indistinguishable from the rows that were already marked. Recording the ids first is
--    the only way back. Drop these two tables once the numbers have been reviewed.
CREATE TABLE IF NOT EXISTS _sent_to_finance_backfill_new AS
SELECT id, ready_to_pay, ready_to_pay_by, sent_to_finance, sent_to_finance_at
FROM payment_plans
WHERE cancel_date IS NULL
  AND sent_to_finance_at IS NULL
  AND COALESCE(invoice_sent_at, invoice_send_automation_sent_at) IS NOT NULL;

CREATE TABLE IF NOT EXISTS _sent_to_finance_backfill_legacy AS
SELECT id, ready_to_pay, ready_to_pay_by, sent_to_finance, sent_to_finance_at
FROM finances_paymentplanrow
WHERE cancel_date IS NULL
  AND sent_to_finance_at IS NULL
  AND COALESCE(invoice_sent_at, invoice_send_automation_sent_at) IS NOT NULL;

-- 1. Backfill from the invoice: a sent invoice IS a handoff to finance, dated the day it went out.
--    Manual sends win over the automation stamp, matching `resolveInvoiceSentAt`.
--    Only the automation records who sent an invoice, and it stores the actor's auth user id rather
--    than an employee id, so it has to be resolved through `users` — `ready_to_pay_by` is a bigint
--    employee id and `invoice_send_automation_by` is a uuid. There is no `invoice_sent_by` column at
--    all, so manually-invoiced rows keep a NULL actor rather than being attributed to the wrong
--    person. That covers 143 of the 317 rows; the remaining 174 stay unattributed.
UPDATE payment_plans
SET
  sent_to_finance = TRUE,
  sent_to_finance_at = COALESCE(invoice_sent_at, invoice_send_automation_sent_at),
  ready_to_pay = TRUE,
  ready_to_pay_by = COALESCE(
    ready_to_pay_by,
    (
      SELECT u.employee_id
      FROM users u
      WHERE u.auth_id = payment_plans.invoice_send_automation_by
        AND u.employee_id IS NOT NULL
      LIMIT 1
    )
  )
WHERE cancel_date IS NULL
  AND sent_to_finance_at IS NULL
  AND COALESCE(invoice_sent_at, invoice_send_automation_sent_at) IS NOT NULL;

UPDATE finances_paymentplanrow
SET
  sent_to_finance = TRUE,
  sent_to_finance_at = COALESCE(invoice_sent_at, invoice_send_automation_sent_at),
  ready_to_pay = TRUE,
  ready_to_pay_by = COALESCE(
    ready_to_pay_by,
    (
      SELECT u.employee_id
      FROM users u
      WHERE u.auth_id = finances_paymentplanrow.invoice_send_automation_by
        AND u.employee_id IS NOT NULL
      LIMIT 1
    )
  )
WHERE cancel_date IS NULL
  AND sent_to_finance_at IS NULL
  AND COALESCE(invoice_sent_at, invoice_send_automation_sent_at) IS NOT NULL;

-- 2. Backfill the rows already marked sent to finance the old way.
--    Their `due_date` was overwritten with the marking day at the time, so it is the best record of
--    when finance received them. Without this step every pre-existing figure would drop to zero once
--    the scoreboard starts reading `sent_to_finance_at`.
UPDATE payment_plans
SET
  sent_to_finance = TRUE,
  sent_to_finance_at = due_date::timestamptz
WHERE cancel_date IS NULL
  AND sent_to_finance_at IS NULL
  AND ready_to_pay IS TRUE
  AND due_date IS NOT NULL;

UPDATE finances_paymentplanrow
SET
  sent_to_finance = TRUE,
  sent_to_finance_at = COALESCE(due_date, date)::timestamptz
WHERE cancel_date IS NULL
  AND sent_to_finance_at IS NULL
  AND ready_to_pay IS TRUE
  AND COALESCE(due_date, date) IS NOT NULL;

-- 3. The scoreboard selects a date range on this column on every dashboard load.
CREATE INDEX IF NOT EXISTS idx_payment_plans_sent_to_finance_at
  ON payment_plans (sent_to_finance_at)
  WHERE sent_to_finance_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finances_paymentplanrow_sent_to_finance_at
  ON finances_paymentplanrow (sent_to_finance_at)
  WHERE sent_to_finance_at IS NOT NULL;

COMMENT ON COLUMN payment_plans.sent_to_finance_at IS
  'When this row was handed to finance. Authoritative date for the Dashboard "Sent to finance" measure. Set when an invoice is sent or when the row is marked sent to finance; independent of due_date, which is the client payment schedule.';
COMMENT ON COLUMN finances_paymentplanrow.sent_to_finance_at IS
  'When this row was handed to finance. Authoritative date for the Dashboard "Sent to finance" measure. Set when an invoice is sent or when the row is marked sent to finance; independent of due_date, which is the client payment schedule.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification — run after COMMIT.
--
-- SELECT
--   to_char(sent_to_finance_at, 'YYYY-MM') AS month,
--   count(*) FILTER (WHERE invoice_sent_at IS NOT NULL OR invoice_send_automation_sent_at IS NOT NULL) AS from_invoice,
--   count(*) AS total
-- FROM payment_plans
-- WHERE sent_to_finance_at IS NOT NULL AND cancel_date IS NULL
-- GROUP BY 1 ORDER BY 1;
--
-- Expect zero rows left behind:
-- SELECT count(*) FROM payment_plans
-- WHERE cancel_date IS NULL
--   AND COALESCE(invoice_sent_at, invoice_send_automation_sent_at) IS NOT NULL
--   AND (ready_to_pay IS NOT TRUE OR sent_to_finance_at IS NULL);
--
-- Rollback of step 1, if the numbers look wrong. Step 2 only wrote a date equal to `due_date`, which
-- is what the code falls back to anyway, so it needs no undo.
--
-- BEGIN;
-- UPDATE payment_plans p SET
--   ready_to_pay = b.ready_to_pay,
--   ready_to_pay_by = b.ready_to_pay_by,
--   sent_to_finance = b.sent_to_finance,
--   sent_to_finance_at = b.sent_to_finance_at
-- FROM _sent_to_finance_backfill_new b WHERE b.id = p.id;
-- UPDATE finances_paymentplanrow p SET
--   ready_to_pay = b.ready_to_pay,
--   ready_to_pay_by = b.ready_to_pay_by,
--   sent_to_finance = b.sent_to_finance,
--   sent_to_finance_at = b.sent_to_finance_at
-- FROM _sent_to_finance_backfill_legacy b WHERE b.id = p.id;
-- COMMIT;
--
-- Once the result is accepted:
-- DROP TABLE _sent_to_finance_backfill_new, _sent_to_finance_backfill_legacy;
