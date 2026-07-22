/**
 * When staff must clock in, block Supabase REST reads/writes except tables
 * required to complete clock-in or resolve the gate.
 */
let gateBlocksDataAccess = false;

const ALLOWED_REST_PREFIXES = [
  '/rest/v1/employee_clock_in',
  '/rest/v1/employee_wfh_period_requests',
  '/rest/v1/users',
  '/rest/v1/tenants_employee',
  '/rest/v1/tenant_departement',
  '/rest/v1/employee_field_assignments',
  '/rest/v1/employee_unavailability_reasons',
  '/rest/v1/clock_in_locations',
  '/rest/v1/rpc/',
  // RMQ messaging (available from clock-in gate before clock-in)
  '/rest/v1/messages',
  '/rest/v1/conversations',
  '/rest/v1/conversation_participants',
  '/rest/v1/message_read_receipts',
  '/rest/v1/rmq_user_pinned_messages',
  '/rest/v1/rmq_message_comments',
  '/rest/v1/rmq_message_lead_flags',
  '/rest/v1/leads',
  '/rest/v1/leads_lead',
  // Calendar (available from clock-in gate before clock-in)
  '/rest/v1/meetings',
  '/rest/v1/meeting_participants',
  '/rest/v1/outlook_teams_meetings',
  '/rest/v1/tenants_meetinglocation',
  '/rest/v1/misc_category',
  '/rest/v1/misc_maincategory',
  '/rest/v1/misc_languages',
  '/rest/v1/misc_language',
  '/rest/v1/contract_templates',
  '/rest/v1/contract_types',
  '/rest/v1/misc_contracttemplate',
  '/rest/v1/contracts',
  '/rest/v1/firms',
  '/rest/v1/firm_contacts',
  '/rest/v1/emails',
  '/rest/v1/leads_leadstage',
  '/rest/v1/lead_stages',
  '/rest/v1/call_logs',
  '/rest/v1/whatsapp_messages',
  '/rest/v1/lead_case_documents',
  '/rest/v1/staff_meeting_documents',
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
      headers: {
        'Content-Type': 'application/json',
        // Without CORS headers browsers report this as a generic network/CORS failure.
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, accept-profile, content-profile, prefer',
      },
    },
  );
}
