import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVOICE_SENT_INCOME_START_DATE,
  INVOICED_SELECTS_FOR_TEST,
  installmentDedupKey,
  isExpenseInstallmentRow,
  sumContributionIncomeNisInRange,
  sumInvoicedNisInRange,
  type InvoicedInstallment,
} from './invoicedInstallments';

/**
 * Only the fields the sums read; the rest of the shape is irrelevant here.
 *
 * `countsAsDue` defaults to true because that is what the default (un-widened) fetch produces for
 * every row — the false case only arises for a row pulled in solely because its invoice was sent.
 */
function installment(
  dueDate: string,
  amountNis: number,
  invoiceSent: boolean,
  countsAsDue = true,
  /** Defaults to the net amount, so a test only sets this when it cares about the fee deduction. */
  amountNisGross = amountNis,
): InvoicedInstallment {
  return { dueDate, amountNis, amountNisGross, invoiceSent, countsAsDue } as InvoicedInstallment;
}

/**
 * These pin down the October 2026 switch in how the contribution report measures income: everything
 * that fell due before it, only what was actually invoiced from it on.
 *
 * The boundary matters because the `invoice_sent` column only exists from mid-September 2026, so
 * applying the new rule to an earlier month would silently report close to zero income.
 */
test('contribution income: before the cutover, invoice_sent is ignored', () => {
  const rows = [
    installment('2026-09-15', 1000, false),
    installment('2026-09-20', 500, true),
  ];
  assert.equal(sumContributionIncomeNisInRange(rows, '2026-09-01', '2026-09-30'), 1500);
});

test('contribution income: from the cutover, only invoiced rows count', () => {
  const rows = [
    installment('2026-10-05', 1000, false),
    installment('2026-10-20', 500, true),
  ];
  assert.equal(sumContributionIncomeNisInRange(rows, '2026-10-01', '2026-10-31'), 500);
});

test('contribution income: the cutover day itself is already under the new rule', () => {
  const lastDueDay = installment('2026-09-30', 700, false);
  const firstNewDay = installment('2026-10-01', 700, false);
  assert.equal(sumContributionIncomeNisInRange([lastDueDay], '2026-09-01', '2026-10-31'), 700);
  assert.equal(sumContributionIncomeNisInRange([firstNewDay], '2026-09-01', '2026-10-31'), 0);
  assert.equal(INVOICE_SENT_INCOME_START_DATE, '2026-10-01');
});

test('contribution income: a range spanning the cutover sums each half on its own basis', () => {
  const rows = [
    installment('2026-08-10', 100, false), // pre-cutover, counts regardless
    installment('2026-09-10', 200, false), // pre-cutover, counts regardless
    installment('2026-10-10', 400, false), // post-cutover, never invoiced → dropped
    installment('2026-11-10', 800, true), // post-cutover, invoiced → counts
  ];
  assert.equal(sumContributionIncomeNisInRange(rows, '2026-08-01', '2026-11-30'), 1100);
});

test('contribution income: installments outside the window never count', () => {
  const rows = [
    installment('2026-09-30', 1000, true),
    installment('2026-11-01', 1000, true),
  ];
  assert.equal(sumContributionIncomeNisInRange(rows, '2026-10-01', '2026-10-31'), 0);
});

test('contribution income: an inverted or empty range is zero, not a full sum', () => {
  const rows = [installment('2026-10-10', 1000, true)];
  assert.equal(sumContributionIncomeNisInRange(rows, '2026-10-31', '2026-10-01'), 0);
  assert.equal(sumContributionIncomeNisInRange(rows, '', '2026-10-31'), 0);
});

/**
 * Income is dated by the day the invoice went out, which is what makes the contribution report's
 * Total income comparable with the Dashboard Invoiced scoreboard. Only rows invoiced from the cutover
 * on move; anything invoiced before it keeps its due date.
 */
function invoicedOn(
  dueDate: string,
  invoiceSentDate: string,
  amountNis: number,
): InvoicedInstallment {
  return { ...installment(dueDate, amountNis, true), invoiceSentDate } as InvoicedInstallment;
}

test('contribution income: a row invoiced in the window counts there, not in its due month', () => {
  const row = invoicedOn('2027-03-15', '2026-10-07', 1000);
  assert.equal(sumContributionIncomeNisInRange([row], '2026-10-01', '2026-10-31'), 1000);
  assert.equal(sumContributionIncomeNisInRange([row], '2027-03-01', '2027-03-31'), 0);
});

test('contribution income: a row invoiced before the cutover stays in its due month', () => {
  const row = invoicedOn('2026-12-15', '2026-09-20', 1000);
  assert.equal(sumContributionIncomeNisInRange([row], '2026-12-01', '2026-12-31'), 1000);
  assert.equal(sumContributionIncomeNisInRange([row], '2026-09-01', '2026-09-30'), 0);
});

test('contribution income: no row is counted in two windows', () => {
  const rows = [
    invoicedOn('2027-03-15', '2026-10-07', 1000), // dated October
    invoicedOn('2026-12-15', '2026-09-20', 500), // dated December, its due month
  ];
  const whole = sumContributionIncomeNisInRange(rows, '2026-09-01', '2027-03-31');
  const months = [
    ['2026-09-01', '2026-09-30'],
    ['2026-10-01', '2026-10-31'],
    ['2026-11-01', '2026-11-30'],
    ['2026-12-01', '2026-12-31'],
    ['2027-01-01', '2027-01-31'],
    ['2027-02-01', '2027-02-28'],
    ['2027-03-01', '2027-03-31'],
  ].reduce((sum, [from, to]) => sum + sumContributionIncomeNisInRange(rows, from, to), 0);
  assert.equal(whole, 1500);
  assert.equal(months, whole);
});

test('the due-based total that feeds the Dashboard still ignores invoice_sent', () => {
  const rows = [
    installment('2026-10-05', 1000, false),
    installment('2026-10-20', 500, true),
  ];
  assert.equal(sumInvoicedNisInRange(rows, '2026-10-01', '2026-10-31'), 1500);
});

/**
 * The widened fetch pulls in rows that were invoiced but never flagged ready to pay. Income has to
 * count them; the Dashboard's due-based total must not, or widening the fetch for one caller would
 * silently inflate the other.
 */
test('an invoiced row that was never ready to pay is income, but is not due', () => {
  const row = installment('2026-10-05', 1000, true, false);
  assert.equal(sumContributionIncomeNisInRange([row], '2026-10-01', '2026-10-31'), 1000);
  assert.equal(sumInvoicedNisInRange([row], '2026-10-01', '2026-10-31'), 0);
});

test('before the cutover an invoiced row still needs the due-based flag', () => {
  const row = installment('2026-09-05', 1000, true, false);
  assert.equal(sumContributionIncomeNisInRange([row], '2026-09-01', '2026-09-30'), 0);
});

/**
 * Income is the gross sum; the scoreboard total is net of the subcontractor fee.
 *
 * The contribution report's Total income must equal the plain sum of the rows its per-employee
 * Due / Invoiced column counts, and that column deducts no fee. Summing the net figure made the
 * header smaller than the column beneath it for any lead carrying a subcontractor fee.
 */
test('contribution income is gross, while the due-based total stays net of fees', () => {
  const row = installment('2026-10-05', 700, true, true, 1000);
  assert.equal(sumContributionIncomeNisInRange([row], '2026-10-01', '2026-10-31'), 1000);
  assert.equal(sumInvoicedNisInRange([row], '2026-10-01', '2026-10-31'), 700);
});

/**
 * A whole payment plan is invoiced in one pass, so every installment carries the same send day.
 *
 * Keying only on lead + event date + amount made those installments indistinguishable and the dedup
 * discarded all but the first: a real plan of 29 equal monthly installments counted as one payment,
 * and the Invoiced scoreboard lost roughly 40% of its rows.
 */
test('dedup keeps installments invoiced on the same day for the same amount', () => {
  const base = {
    leadNumber: 'L1001',
    eventDate: '2026-09-28',
    amountNisGross: 234,
    source: 'new' as const,
  };
  const keys = new Set(
    ['2026-10-27', '2026-11-27', '2026-12-27'].map((dueDate, i) =>
      installmentDedupKey({ ...base, dueDate, paymentId: i + 1 }),
    ),
  );
  assert.equal(keys.size, 3);
});

test('dedup still collapses the same installment arriving twice', () => {
  const row = {
    leadNumber: 'L1001',
    eventDate: '2026-09-28',
    dueDate: '2026-10-27',
    amountNisGross: 234,
    source: 'new' as const,
    paymentId: 7,
  };
  assert.equal(installmentDedupKey(row), installmentDedupKey({ ...row }));
});

/** The cross-table duplicate this guards against: same lead, due date and amount, different ids. */
test('dedup collapses one plan present in both payment tables', () => {
  const shared = {
    leadNumber: 'L1001',
    eventDate: '2026-09-28',
    dueDate: '2026-10-27',
    amountNisGross: 234,
  };
  assert.equal(
    installmentDedupKey({ ...shared, source: 'new', paymentId: 'abc' }),
    installmentDedupKey({ ...shared, source: 'legacy', paymentId: 991 }),
  );
});

/** With no date of any kind the id is the only thing left to tell two rows apart. */
test('dedup falls back to the row id when an installment has no date', () => {
  const shared = {
    leadNumber: 'L1001',
    eventDate: '2026-09-28',
    dueDate: null,
    amountNisGross: 234,
    source: 'legacy' as const,
  };
  assert.notEqual(
    installmentDedupKey({ ...shared, paymentId: 1 }),
    installmentDedupKey({ ...shared, paymentId: 2 }),
  );
});

/**
 * Without an event scope the event date and the due date are the same value, so the due-based
 * measures must key exactly as they did before this was changed.
 */
test('dedup key is unchanged for the due-based measures', () => {
  assert.equal(
    installmentDedupKey({
      leadNumber: 'L1001',
      eventDate: '2026-10-27',
      dueDate: '2026-10-27',
      amountNisGross: 234,
      source: 'new',
      paymentId: 7,
    }),
    'L1001|2026-10-27|2026-10-27|234',
  );
});

/**
 * Both payment queries must select the columns that record an invoice being sent.
 *
 * Dropping them is silent and total: the `or` filter that widens the fetch is evaluated server-side,
 * so nothing errors, but every row comes back with no invoice flags, and from the cutover on income is
 * exactly zero. That failure has happened, which is why it is pinned here.
 */
test('both payment selects carry the invoice_sent columns', () => {
  for (const [name, select] of Object.entries(INVOICED_SELECTS_FOR_TEST)) {
    for (const column of ['invoice_sent', 'invoice_sent_at', 'invoice_send_automation_sent_at']) {
      assert.ok(
        new RegExp(`\\b${column}\\b`).test(select),
        `${name} payment select is missing ${column}, which silently zeroes contribution income`,
      );
    }
  }
});

/**
 * `excludeExpenseRows` can only work if the column holding the order is fetched, and the two tables
 * keep it under different names. Omitting either is silent — every row reads as not-an-expense and
 * the filter quietly does nothing.
 */
test('both payment selects carry the column that identifies an expense row', () => {
  assert.match(INVOICED_SELECTS_FOR_TEST.new, /\bpayment_order\b/);
  assert.match(INVOICED_SELECTS_FOR_TEST.legacy, /"order"/);
});

test('isExpenseInstallmentRow reads the order column belonging to each table', () => {
  // Legacy numeric order 99, new-table labels including the pre-rename one.
  assert.equal(isExpenseInstallmentRow({ order: 99 }, 'legacy'), true);
  assert.equal(isExpenseInstallmentRow({ order: '99' }, 'legacy'), true);
  assert.equal(isExpenseInstallmentRow({ payment_order: 'Expense' }, 'new'), true);
  assert.equal(isExpenseInstallmentRow({ payment_order: 'Expense (no VAT)' }, 'new'), true);

  for (const order of [1, 5, 9, 90]) {
    assert.equal(isExpenseInstallmentRow({ order }, 'legacy'), false);
  }
  for (const label of ['First Payment', 'Intermediate Payment', 'Final Payment', 'Single Payment']) {
    assert.equal(isExpenseInstallmentRow({ payment_order: label }, 'new'), false);
  }

  // Each table is read on its own column, so a value parked on the other one must not leak through.
  // Legacy order 1 carrying an "Expense" label in payment_order is still a first payment.
  assert.equal(isExpenseInstallmentRow({ order: 1, payment_order: 'Expense' }, 'legacy'), false);
  assert.equal(isExpenseInstallmentRow({ payment_order: 'First Payment', order: 99 }, 'new'), false);

  // A missing order is not an expense; defaulting the other way would drop real revenue.
  assert.equal(isExpenseInstallmentRow({}, 'new'), false);
  assert.equal(isExpenseInstallmentRow({}, 'legacy'), false);
  assert.equal(isExpenseInstallmentRow({ order: null }, 'legacy'), false);
});
