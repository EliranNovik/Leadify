/**
 * When staff must clock in, block Supabase REST reads/writes except tables
 * required to complete clock-in or resolve the gate.
 */
let gateBlocksDataAccess = false;

const ALLOWED_REST_PREFIXES = [
  '/rest/v1/employee_clock_in',
  '/rest/v1/users',
  '/rest/v1/tenants_employee',
  '/rest/v1/clock_in_locations',
  '/rest/v1/rpc/',
];

export function setClockInGateBlocksDataAccess(blocked: boolean): void {
  gateBlocksDataAccess = blocked;
}

export function isClockInGateRestRequestAllowed(pathname: string): boolean {
  if (!gateBlocksDataAccess) return true;
  return ALLOWED_REST_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function buildClockInGateBlockedResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 'CLOCK_IN_REQUIRED',
      message: 'You must clock in before using the system.',
    }),
    {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
