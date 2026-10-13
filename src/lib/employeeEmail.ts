/**
 * Choosing an employee's email address when `users` holds more than one row for them.
 *
 * Email lives on `users.employee_id` because `tenants_employee` has no email column, and twelve
 * employees have several rows there — usually a disabled older account beside the current one.
 * Rebecca (43) has both `Rebeccag@` (deactivated) and `rebecca@` (live).
 *
 * Code that took "the first row returned" was therefore picking at random, because PostgREST
 * promises no particular order, and clients were sent the dead address. Code that used
 * `.maybeSingle()` fared worse: more than one match makes it error, so those employees lost their
 * address entirely.
 */

export type EmployeeEmailCandidate = { email: string; isActive: boolean | null };

/**
 * The address to show for an employee, given every `users` row they own.
 *
 * Active wins. When none is active the first address still wins, because a stale address a client
 * might reach beats dropping the contact line. Sorting makes the choice repeatable between runs
 * rather than dependent on row order.
 */
export function pickEmployeeEmail(candidates: EmployeeEmailCandidate[]): string {
  const usable = candidates.filter((candidate) => String(candidate.email || '').trim());
  if (usable.length === 0) return '';

  const sorted = [...usable].sort((a, b) => {
    // `is_active` is null on some rows, which is not a statement that the account works.
    const activeDelta = Number(b.isActive === true) - Number(a.isActive === true);
    if (activeDelta !== 0) return activeDelta;
    return a.email.toLowerCase().localeCompare(b.email.toLowerCase());
  });
  return sorted[0].email.trim();
}

/** Group raw `users` rows by employee and resolve one address each. */
export function employeeEmailsFromUserRows(rows: unknown[]): Map<number, string> {
  const byEmployee = new Map<number, EmployeeEmailCandidate[]>();

  for (const raw of rows ?? []) {
    const row = raw as { employee_id?: unknown; email?: unknown; is_active?: unknown };
    const employeeId = Number(row?.employee_id);
    const email = String(row?.email ?? '').trim();
    if (!Number.isFinite(employeeId) || employeeId <= 0 || !email) continue;
    const list = byEmployee.get(employeeId) || [];
    list.push({ email, isActive: (row?.is_active ?? null) as boolean | null });
    byEmployee.set(employeeId, list);
  }

  const resolved = new Map<number, string>();
  for (const [employeeId, candidates] of byEmployee) {
    const email = pickEmployeeEmail(candidates);
    if (email) resolved.set(employeeId, email);
  }
  return resolved;
}
