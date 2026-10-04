/**
 * The Due / Invoiced rule, pinned per row.
 *
 * Lives in `src/lib` rather than next to the module it tests because the test script globs
 * `src/lib/*.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countsTowardDueInvoiced,
  dueInvoicedAllRowsFilter,
  dueInvoicedReadyToPayFilter,
} from '../utils/contributionDueInvoiced';

const BEFORE = '2026-09-20';
const AFTER = '2026-10-05';

test('before the cutover a row counts because it fell due, not because it was invoiced', () => {
  assert.equal(
    dueInvoicedReadyToPayFilter({ due_date: BEFORE, ready_to_pay: true, invoice_sent: false }),
    true,
  );
  assert.equal(
    dueInvoicedReadyToPayFilter({ due_date: BEFORE, ready_to_pay: false, invoice_sent: true }),
    false,
  );
});

test('before the cutover a query with no ready_to_pay gate still counts every due row', () => {
  assert.equal(dueInvoicedAllRowsFilter({ due_date: BEFORE, ready_to_pay: false }), true);
});

test('from the cutover only an invoiced row counts, whatever ready_to_pay says', () => {
  assert.equal(
    dueInvoicedReadyToPayFilter({ due_date: AFTER, ready_to_pay: true, invoice_sent: false }),
    false,
  );
  assert.equal(
    dueInvoicedReadyToPayFilter({ due_date: AFTER, ready_to_pay: false, invoice_sent: true }),
    true,
  );
  assert.equal(
    dueInvoicedAllRowsFilter({ due_date: AFTER, invoice_sent_at: '2026-10-05T09:00:00Z' }),
    true,
  );
  assert.equal(dueInvoicedAllRowsFilter({ due_date: AFTER }), false);
});

test('a legacy row awaiting finance is placed by its planned date', () => {
  assert.equal(dueInvoicedAllRowsFilter({ due_date: null, date: AFTER, invoice_sent: true }), true);
  assert.equal(
    dueInvoicedReadyToPayFilter({ due_date: null, date: AFTER, invoice_sent: true }),
    true,
  );
  assert.equal(dueInvoicedAllRowsFilter({ due_date: null, date: AFTER }), false);
});

test('before the cutover a row that never fell due is still ignored', () => {
  assert.equal(dueInvoicedAllRowsFilter({ due_date: null, date: BEFORE, invoice_sent: true }), false);
});

test('a row with no date at all never counts', () => {
  assert.equal(dueInvoicedAllRowsFilter({ due_date: null, date: null, invoice_sent: true }), false);
  assert.equal(dueInvoicedAllRowsFilter({}), false);
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
