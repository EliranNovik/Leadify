-- Fill the Invoiced measure's missing history by inferring an invoice from collected payments.
--
-- Why
-- ---
-- The `invoice_sent` columns only start recording in mid-September 2026, so the Invoiced scoreboard
-- has almost no history: July holds 2 rows and August 10, against 487 in September. The "Last 3m"
-- column divides that by three and reports a number that looks like a collapse in invoicing rather
-- than the absence of a column.
--
-- A payment that was collected must have been invoiced — you cannot bill a client without sending
-- the invoice. 651 rows paid in the last three months carry no invoice stamp, and those are the
-- rows this fills in: 300 in `payment_plans`, 351 in `finances_paymentplanrow`.
--
-- Which date
-- ----------
-- Not the paid date. The invoice goes out first and the money arrives afterwards, so the paid date
-- post-dates the event being measured. `sent_to_finance_at` — the day the row was handed over for
-- the invoice to be sent — is the closer proxy, and 600 of the 651 have one. The two agree to within
-- 1-2 days for the median row, but the worst gaps run to 141 days (new) and 219 days (legacy), which
-- is what rules the paid date out as the primary basis. The 51 rows with no handoff date fall back
-- to the paid date, the only date they have.
--
-- Honesty about the result
-- ------------------------
-- These stamps are deduced, not recorded, so `invoice_sent_inferred` marks them. Without it an
-- inferred stamp is indistinguishable from a real one and nobody could later tell which figures were
-- measured and which were reconstructed.
--
-- This is also deliberately partial: it only covers rows that were PAID. Anything invoiced in July or
-- August that is still outstanding stays invisible, so those two months remain somewhat understated.
-- Extending the same inference to every row handed to finance would give full coverage but would
-- assume finance actually sent each invoice, which is not provable from the data.

BEGIN;

-- 1. Provenance. Defaults false, so every existing stamp stays marked as genuinely recorded.
ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS invoice_sent_inferred BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE finances_paymentplanrow
  ADD COLUMN IF NOT EXISTS invoice_sent_inferred BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN payment_plans.invoice_sent_inferred IS
  'True when invoice_sent/invoice_sent_at were deduced from the payment being collected rather than recorded at send time. See sql/2026-10-12_infer_invoice_sent_from_paid.sql.';
COMMENT ON COLUMN finances_paymentplanrow.invoice_sent_inferred IS
  'True when invoice_sent/invoice_sent_at were deduced from the payment being collected rather than recorded at send time. See sql/2026-10-12_infer_invoice_sent_from_paid.sql.';

-- 2. Snapshot for rollback. Drop once the numbers have been reviewed.
CREATE TABLE IF NOT EXISTS _infer_invoice_sent_new AS
SELECT id, invoice_sent, invoice_sent_at
FROM payment_plans
WHERE cancel_date IS NULL
  AND paid IS TRUE
  AND paid_at IS NOT NULL
  AND paid_at >= '2026-07-12'
  AND paid_at < '2026-10-13'
  AND invoice_sent_at IS NULL
  AND invoice_send_automation_sent_at IS NULL;

CREATE TABLE IF NOT EXISTS _infer_invoice_sent_legacy AS
SELECT id, invoice_sent, invoice_sent_at
FROM finances_paymentplanrow
WHERE cancel_date IS NULL
  AND actual_date IS NOT NULL
  AND actual_date >= '2026-07-12'
  AND actual_date <= '2026-10-12'
  AND invoice_sent_at IS NULL
  AND invoice_send_automation_sent_at IS NULL;

-- 3. The inference. `payment_plans` records collection in `paid` / `paid_at`; the legacy table has
--    no `paid` column and records it in `actual_date`.
UPDATE payment_plans
SET
  invoice_sent = TRUE,
  invoice_sent_at = COALESCE(sent_to_finance_at, paid_at),
  invoice_sent_inferred = TRUE
WHERE cancel_date IS NULL
  AND paid IS TRUE
  AND paid_at IS NOT NULL
  AND paid_at >= '2026-07-12'
  AND paid_at < '2026-10-13'
  AND invoice_sent_at IS NULL
  AND invoice_send_automation_sent_at IS NULL;

UPDATE finances_paymentplanrow
SET
  invoice_sent = TRUE,
  invoice_sent_at = COALESCE(sent_to_finance_at, actual_date::timestamptz),
  invoice_sent_inferred = TRUE
WHERE cancel_date IS NULL
  AND actual_date IS NOT NULL
  AND actual_date >= '2026-07-12'
  AND actual_date <= '2026-10-12'
  AND invoice_sent_at IS NULL
  AND invoice_send_automation_sent_at IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification — run after COMMIT.
--
-- Expect roughly 300 new and 351 legacy:
-- SELECT count(*) FROM payment_plans WHERE invoice_sent_inferred;
-- SELECT count(*) FROM finances_paymentplanrow WHERE invoice_sent_inferred;
--
-- The Invoiced measure's monthly shape, recorded vs inferred. July and August should go from
-- near-nothing to a few hundred each:
-- SELECT
--   to_char(invoice_sent_at, 'YYYY-MM') AS month,
--   count(*) FILTER (WHERE NOT invoice_sent_inferred) AS recorded,
--   count(*) FILTER (WHERE invoice_sent_inferred) AS inferred,
--   count(*) AS total
-- FROM payment_plans
-- WHERE invoice_sent_at IS NOT NULL AND cancel_date IS NULL
-- GROUP BY 1 ORDER BY 1;
--
-- No stamp should post-date its own payment:
-- SELECT count(*) FROM payment_plans
-- WHERE invoice_sent_inferred AND invoice_sent_at > paid_at;
--
-- Rollback:
-- BEGIN;
-- UPDATE payment_plans p SET
--   invoice_sent = b.invoice_sent,
--   invoice_sent_at = b.invoice_sent_at,
--   invoice_sent_inferred = FALSE
-- FROM _infer_invoice_sent_new b WHERE b.id = p.id;
-- UPDATE finances_paymentplanrow p SET
--   invoice_sent = b.invoice_sent,
--   invoice_sent_at = b.invoice_sent_at,
--   invoice_sent_inferred = FALSE
-- FROM _infer_invoice_sent_legacy b WHERE b.id = p.id;
-- COMMIT;
--
-- Once accepted:
-- DROP TABLE _infer_invoice_sent_new, _infer_invoice_sent_legacy;
