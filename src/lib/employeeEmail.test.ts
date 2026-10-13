import test from 'node:test';
import assert from 'node:assert/strict';

import { employeeEmailsFromUserRows, pickEmployeeEmail } from './employeeEmail';

test('an employee with a disabled old account is shown at their live address', () => {
  /*
   * Rebecca (employee 43) has two `users` rows: `Rebeccag@` from a deactivated account and
   * `rebecca@` from the live one. Clients were being given the dead address because the first row
   * returned won, and PostgREST does not promise an order.
   */
  const email = pickEmployeeEmail([
    { email: 'Rebeccag@lawoffice.org.il', isActive: false },
    { email: 'rebecca@lawoffice.org.il', isActive: true },
  ]);
  assert.equal(email, 'rebecca@lawoffice.org.il');

  // Same answer whichever order the rows arrive in — that is the whole point.
  assert.equal(
    pickEmployeeEmail([
      { email: 'rebecca@lawoffice.org.il', isActive: true },
      { email: 'Rebeccag@lawoffice.org.il', isActive: false },
    ]),
    'rebecca@lawoffice.org.il',
  );
});

test('an employee whose accounts are all disabled still gets a contact line', () => {
  // A stale address a client might still reach beats dropping the block, so this does not go blank.
  const email = pickEmployeeEmail([
    { email: 'old@lawoffice.org.il', isActive: false },
    { email: 'older@lawoffice.org.il', isActive: false },
  ]);
  assert.equal(email, 'old@lawoffice.org.il');
});

test('two live accounts resolve the same way every run', () => {
  const rows = [
    { email: 'b@lawoffice.org.il', isActive: true },
    { email: 'a@lawoffice.org.il', isActive: true },
  ];
  assert.equal(pickEmployeeEmail(rows), 'a@lawoffice.org.il');
  assert.equal(pickEmployeeEmail([...rows].reverse()), 'a@lawoffice.org.il');
});

test('an unknown active flag is not treated as active', () => {
  /*
   * `is_active` is null on some rows. Null is not a statement that the account works, so a row that
   * says it is active outranks it.
   */
  assert.equal(
    pickEmployeeEmail([
      { email: 'unknown@lawoffice.org.il', isActive: null },
      { email: 'live@lawoffice.org.il', isActive: true },
    ]),
    'live@lawoffice.org.il',
  );
  // With nothing better, it is still used rather than losing the line.
  assert.equal(
    pickEmployeeEmail([{ email: 'unknown@lawoffice.org.il', isActive: null }]),
    'unknown@lawoffice.org.il',
  );
});

test('an employee with no usable address yields none', () => {
  assert.equal(pickEmployeeEmail([]), '');
  assert.equal(pickEmployeeEmail([{ email: '   ', isActive: true }]), '');
});

test('grouping raw users rows resolves one address per employee', () => {
  const resolved = employeeEmailsFromUserRows([
    { employee_id: 43, email: 'Rebeccag@lawoffice.org.il', is_active: false },
    { employee_id: 43, email: 'rebecca@lawoffice.org.il', is_active: true },
    { employee_id: 181, email: 'nastasya@lawoffice.org.il', is_active: true },
  ]);
  assert.equal(resolved.get(43), 'rebecca@lawoffice.org.il');
  assert.equal(resolved.get(181), 'nastasya@lawoffice.org.il');
  assert.equal(resolved.size, 2);
});

test('rows that identify no employee or no address are skipped', () => {
  const resolved = employeeEmailsFromUserRows([
    { employee_id: null, email: 'orphan@lawoffice.org.il', is_active: true },
    { employee_id: 0, email: 'zero@lawoffice.org.il', is_active: true },
    { employee_id: 43, email: null, is_active: true },
    { employee_id: 43, email: '  ', is_active: true },
  ]);
  assert.equal(resolved.size, 0);
});
