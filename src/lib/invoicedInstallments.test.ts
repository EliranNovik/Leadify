import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVOICE_SENT_INCOME_START_DATE,
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
): InvoicedInstallment {
  return { dueDate, amountNis, invoiceSent, countsAsDue } as InvoicedInstallment;
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
