/**
 * The Due / Invoiced rule, pinned per row.
 *
 * Lives in `src/lib` rather than next to the module it tests because the test script globs
 * `src/lib/*.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDueInvoicedWindow,
  countsTowardDueInvoiced,
  dueInvoicedAllRowsFilter,
  dueInvoicedIncomeDate,
  dueInvoicedReadyToPayFilter,
} from '../utils/contributionDueInvoiced';

const BEFORE = '2026-09-20';
const AFTER = '2026-10-05';

/** Wide enough that the window never decides these cases — they are about whether a row counts. */
const ANY = { from: '2020-01-01', to: '2031-12-31' };
const countsReadyToPay = dueInvoicedReadyToPayFilter(ANY);
const countsAllRows = dueInvoicedAllRowsFilter(ANY);

test('before the cutover a row counts because it fell due, not because it was invoiced', () => {
  assert.equal(countsReadyToPay({ due_date: BEFORE, ready_to_pay: true, invoice_sent: false }), true);
  assert.equal(countsReadyToPay({ due_date: BEFORE, ready_to_pay: false, invoice_sent: true }), false);
});

test('before the cutover a query with no ready_to_pay gate still counts every due row', () => {
  assert.equal(countsAllRows({ due_date: BEFORE, ready_to_pay: false }), true);
});

test('from the cutover only an invoiced row counts, whatever ready_to_pay says', () => {
  assert.equal(countsReadyToPay({ due_date: AFTER, ready_to_pay: true, invoice_sent: false }), false);
  assert.equal(countsReadyToPay({ due_date: AFTER, ready_to_pay: false, invoice_sent: true }), true);
  assert.equal(countsAllRows({ due_date: AFTER, invoice_sent_at: '2026-10-05T09:00:00Z' }), true);
  assert.equal(countsAllRows({ due_date: AFTER }), false);
});

test('a legacy row awaiting finance is placed by its planned date', () => {
  assert.equal(countsAllRows({ due_date: null, date: AFTER, invoice_sent: true }), true);
  assert.equal(countsReadyToPay({ due_date: null, date: AFTER, invoice_sent: true }), true);
  assert.equal(countsAllRows({ due_date: null, date: AFTER }), false);
});

test('before the cutover a row that never fell due is still ignored', () => {
  assert.equal(countsAllRows({ due_date: null, date: BEFORE, invoice_sent: true }), false);
});

test('a row with no date at all never counts', () => {
  assert.equal(countsAllRows({ due_date: null, date: null, invoice_sent: true }), false);
  assert.equal(countsAllRows({}), false);
});

test('the cutover boundary is inclusive of its first day', () => {
  assert.equal(
    countsTowardDueInvoiced({ due_date: '2026-09-30', ready_to_pay: true }, { requireReadyToPay: true }),
    true,
  );
  assert.equal(
    countsTowardDueInvoiced({ due_date: '2026-10-01', ready_to_pay: true }, { requireReadyToPay: true }),
    false,
  );
  assert.equal(
    countsTowardDueInvoiced({ due_date: '2026-10-01', invoice_sent: true }, { requireReadyToPay: true }),
    true,
  );
});

test('from the cutover a row is dated by the day its invoice went out, not when it falls due', () => {
  assert.equal(
    dueInvoicedIncomeDate({ due_date: '2027-03-15', invoice_sent_at: '2026-10-07T09:00:00Z' }),
    '2026-10-07',
  );
  // The automation's own stamp dates a row just the same.
  assert.equal(
    dueInvoicedIncomeDate({
      due_date: '2027-03-15',
      invoice_send_automation_sent_at: '2026-10-07T09:00:00Z',
    }),
    '2026-10-07',
  );
});

test('a row invoiced before the cutover keeps its due date', () => {
  // Hundreds of rows were invoiced in bulk before the cutover and fall due over the following years.
  // Dating them by the invoice would drop them into a closed period that counts nothing.
  assert.equal(
    dueInvoicedIncomeDate({ due_date: '2027-03-15', invoice_sent_at: '2026-09-20T09:00:00Z' }),
    '2027-03-15',
  );
});

test('a row flagged invoiced with no timestamp falls back to its due date', () => {
  assert.equal(dueInvoicedIncomeDate({ due_date: AFTER, invoice_sent: true }), AFTER);
  assert.equal(dueInvoicedIncomeDate({ due_date: null, date: AFTER, invoice_sent: true }), AFTER);
  assert.equal(dueInvoicedIncomeDate({}), null);
});

test('the window is applied to the income date, so a later due date does not exclude a row', () => {
  const october = dueInvoicedReadyToPayFilter({ from: '2026-10-01', to: '2026-10-31' });
  const marchDueOctoberInvoiced = {
    due_date: '2027-03-15',
    invoice_sent_at: '2026-10-07T09:00:00Z',
    ready_to_pay: false,
  };
  assert.equal(october(marchDueOctoberInvoiced), true);

  const march = dueInvoicedReadyToPayFilter({ from: '2027-03-01', to: '2027-03-31' });
  assert.equal(march(marchDueOctoberInvoiced), false);
});

test('a row due in the window but invoiced before the cutover still counts in it', () => {
  const october = dueInvoicedReadyToPayFilter({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(
    october({ due_date: '2026-10-15', invoice_sent_at: '2026-09-20T09:00:00Z', ready_to_pay: false }),
    true,
  );
});

test('ISO timestamp window bounds are compared by day', () => {
  const october = dueInvoicedReadyToPayFilter({
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-31T23:59:59.999Z',
  });
  assert.equal(october({ due_date: '2026-10-31', invoice_sent: true }), true);
  assert.equal(october({ due_date: '2026-11-01', invoice_sent: true }), false);
});

/** Records the `or` filters a query builder was handed, in order. */
function filterSpy() {
  const applied: string[] = [];
  const query = { or: (filter: string) => (applied.push(filter), query) };
  return { query, applied };
}

test('the window query accepts either the due date or the invoice date', () => {
  const { query, applied } = filterSpy();
  applyDueInvoicedWindow(query, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(applied.length, 1);
  assert.equal(
    applied[0],
    'and(due_date.gte.2026-10-01,due_date.lte.2026-10-31),' +
      'and(invoice_sent_at.gte.2026-10-01,invoice_sent_at.lte.2026-10-31),' +
      'and(invoice_send_automation_sent_at.gte.2026-10-01,invoice_send_automation_sent_at.lte.2026-10-31)',
  );
});

test('the invoice-date arms never reach back past the cutover', () => {
  const { query, applied } = filterSpy();
  applyDueInvoicedWindow(query, { from: '2026-08-01', to: '2026-10-31' });
  assert.match(applied[0], /due_date\.gte\.2026-08-01/);
  assert.match(applied[0], /invoice_sent_at\.gte\.2026-10-01/);
});

test('a window closing before the cutover is filtered on the due date alone', () => {
  const { query, applied } = filterSpy();
  applyDueInvoicedWindow(query, { from: '2026-08-01', to: '2026-09-30' });
  assert.equal(applied[0], 'and(due_date.gte.2026-08-01,due_date.lte.2026-09-30)');
});

test('an unbounded window applies no filter at all', () => {
  const { query, applied } = filterSpy();
  applyDueInvoicedWindow(query, { from: null, to: null });
  assert.equal(applied.length, 0);
});
