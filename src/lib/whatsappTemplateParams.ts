import { supabase } from './supabase';
import { fetchLeadContacts } from './contactHelpers';
import type { ContactInfo } from './contactHelpers';

/** DevTools: filter by [getMeetingLocation]. Enable in prod with VITE_DEBUG_MEETING_LOCATION=true */
const DEBUG_MEETING_LOCATION =
  import.meta.env.DEV ||
  String(import.meta.env?.VITE_DEBUG_MEETING_LOCATION || '').toLowerCase() === 'true';

function dbgMeetingLocation(...args: unknown[]) {
  if (DEBUG_MEETING_LOCATION) {
    console.log('[getMeetingLocation]', ...args);
  }
}

/** Escape % and _ for PostgreSQL ILIKE when matching a literal location name */
function escapeIlikeLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

type TenantMeetingLocationRow = {
  id?: number | string | null;
  address: string | null;
  name: string | null;
  default_link?: string | null;
  is_physical_location?: boolean | null;
  firm_id?: number | string | null;
};

/** When several firms share the same display name, prefer physical + address (+ firm match). */
function pickBestTenantMeetingLocationRow(
  rows: (TenantMeetingLocationRow & { firm_id?: unknown })[] | null | undefined,
  firmId: number | null,
  lookupKey: string
): TenantMeetingLocationRow | null {
  if (!rows?.length) return null;

  const firmNum = firmId != null && Number.isFinite(firmId) ? firmId : null;
  const key = lookupKey.trim();
  const keyLower = key.toLowerCase();
  const keyIsNumeric = /^\d+$/.test(key);
  const keyAsNum = keyIsNumeric ? Number(key) : NaN;

  const inFirm = (r: { firm_id?: unknown }) => {
    if (firmNum == null) return true;
    if (r.firm_id == null || r.firm_id === '') return true;
    return Number(r.firm_id) === firmNum;
  };

  let pool = firmNum != null ? rows.filter(inFirm) : rows;
  if (pool.length === 0) pool = [...rows];

  const addrOf = (r: TenantMeetingLocationRow) =>
    String(r.address ?? '')
      .replace(/\u00a0/g, ' ')
      .trim();

  const score = (r: TenantMeetingLocationRow) => {
    const addr = addrOf(r);
    const phys = r.is_physical_location === true;
    if (phys && addr) return 6;
    if (addr) return 4;
    if (phys) return 2;
    return 0;
  };

  const nameMatchRank = (r: TenantMeetingLocationRow) => {
    const n = String(r.name ?? '').trim();
    if (n === key) return 2;
    if (n.toLowerCase() === keyLower) return 1;
    return 0;
  };

  pool.sort((a, b) => {
    const sb = score(b);
    const sa = score(a);
    if (sb !== sa) return sb - sa;
    if (keyIsNumeric && Number.isFinite(keyAsNum)) {
      const idA = a.id != null ? Number(a.id) : NaN;
      const idB = b.id != null ? Number(b.id) : NaN;
      const ma = Number.isFinite(idA) && idA === keyAsNum ? 1 : 0;
      const mb = Number.isFinite(idB) && idB === keyAsNum ? 1 : 0;
      if (mb !== ma) return mb - ma;
    }
    const ra = nameMatchRank(a);
    const rb = nameMatchRank(b);
    if (rb !== ra) return rb - ra;
    const idA = a.id != null ? Number(a.id) : NaN;
    const idB = b.id != null ? Number(b.id) : NaN;
    if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) return idB - idA;
    return 0;
  });
  const winner = pool[0] ?? null;
  if (DEBUG_MEETING_LOCATION && rows.length) {
    dbgMeetingLocation('pickBest: input row count', rows.length, 'firmId filter', firmId);
    dbgMeetingLocation(
      'pickBest: pool size after firm filter',
      pool.length,
      'candidates (id, name, is_physical, firm_id, addrLen, score)',
      pool.map((r) => ({
        id: r.id,
        name: r.name,
        is_physical_location: r.is_physical_location,
        firm_id: r.firm_id,
        addressLen: addrOf(r).length,
        score: score(r),
      }))
    );
    dbgMeetingLocation('pickBest: chosen', winner
      ? {
          name: winner.name,
          is_physical_location: winner.is_physical_location,
          firm_id: winner.firm_id,
          addressPreview: addrOf(winner).slice(0, 80),
        }
      : null);
  }
  return winner;
}

/** Scoped to current employee so tenants_meetinglocation rows match the lead's firm (table has firm_id bigint). */
async function getCurrentUserFirmId(): Promise<number | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return null;
    const { data: row } = await supabase
      .from('tenants_employee')
      .select('firm_id')
      .eq('auth_id', user.id)
      .maybeSingle();
    if (row?.firm_id == null || row.firm_id === '') return null;
    const n = Number(row.firm_id);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Prefer lead's firm when the column exists (matches tenants_meetinglocation.firm_id). */
async function getFirmIdForNewLead(clientId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('firm_id')
      .eq('id', clientId)
      .maybeSingle();
    if (error || !data || data.firm_id == null || data.firm_id === '') return null;
    const n = Number(data.firm_id);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function shouldUsePhysicalAddress(
  isPhysicalFlag: unknown,
  addressNonEmpty: boolean
): boolean {
  let result = false;
  let reason = '';

  if (isPhysicalFlag === true) {
    result = true;
    reason = 'is_physical_location === true';
  } else if (typeof isPhysicalFlag === 'string') {
    const s = isPhysicalFlag.trim().toLowerCase();
    if (s === 'true' || s === 't' || s === '1' || s === 'yes') {
      result = true;
      reason = `string flag truthy (${JSON.stringify(isPhysicalFlag)})`;
    } else if (s === 'false' || s === 'f' || s === '0' || s === 'no') {
      result = false;
      reason = `string flag falsy (${JSON.stringify(isPhysicalFlag)})`;
    } else {
      result = false;
      reason = `string flag unrecognized (${JSON.stringify(isPhysicalFlag)})`;
    }
  } else if (isPhysicalFlag === 1) {
    result = true;
    reason = 'is_physical_location === 1';
  } else if (isPhysicalFlag === false || isPhysicalFlag === 0) {
    result = false;
    reason = 'is_physical_location is false/0';
  } else if (isPhysicalFlag == null && addressNonEmpty) {
    result = true;
    reason = 'flag null/undefined + non-empty address (legacy)';
  } else {
    result = false;
    reason = `default virtual (flag=${JSON.stringify(isPhysicalFlag)}, addressNonEmpty=${addressNonEmpty})`;
  }

  if (DEBUG_MEETING_LOCATION) {
    dbgMeetingLocation('shouldUsePhysicalAddress', {
      isPhysicalFlag,
      addressNonEmpty,
      result,
      reason,
    });
  }
  return result;
}

async function fetchTenantMeetingLocationRow(
  rawStr: string,
  firmId: number | null
): Promise<TenantMeetingLocationRow | null> {
  const trimmed = rawStr.trim();
  if (!trimmed) return null;

  const selectCols = 'id, address, name, default_link, is_physical_location, firm_id';

  dbgMeetingLocation('fetch row: lookup key', JSON.stringify(trimmed), 'firmId', firmId);

  // PK id is bigint: compare as string (avoids JS precision + allows "012" style if ever stored)
  if (/^\d+$/.test(trimmed)) {
    const { data, error } = await supabase
      .from('tenants_meetinglocation')
      .select(selectCols)
      .eq('id', trimmed);
    dbgMeetingLocation('by id query', { trimmed, error: error?.message, rowCount: data?.length ?? 0 });
    if (!error && data?.length) {
      const picked = pickBestTenantMeetingLocationRow(data, firmId, trimmed);
      if (picked) return picked;
    }
  }

  const { data: byName, error: nameErr } = await supabase
    .from('tenants_meetinglocation')
    .select(selectCols)
    .eq('name', trimmed);

  dbgMeetingLocation('by exact name query', {
    name: trimmed,
    error: nameErr?.message,
    rowCount: byName?.length ?? 0,
  });

  if (!nameErr && byName?.length) {
    const picked = pickBestTenantMeetingLocationRow(byName, firmId, trimmed);
    if (picked) return picked;
  } else if (nameErr) {
    console.warn('getMeetingLocation: tenants_meetinglocation name query', nameErr);
  }

  const pattern = escapeIlikeLiteral(trimmed);
  const { data: byLike, error: likeErr } = await supabase
    .from('tenants_meetinglocation')
    .select(selectCols)
    .ilike('name', pattern)
    .limit(40);

  dbgMeetingLocation('by ilike name query', {
    pattern,
    error: likeErr?.message,
    rowCount: byLike?.length ?? 0,
  });

  if (!likeErr && byLike?.length) {
    return pickBestTenantMeetingLocationRow(byLike, firmId, trimmed);
  }
  if (likeErr) {
    console.warn('getMeetingLocation: tenants_meetinglocation ilike query', likeErr);
  }

  dbgMeetingLocation('fetch row: no tenants_meetinglocation row matched');
  return null;
}

/**
 * Get client/contact name for template param 1
 */
export async function getClientOrContactName(
  client: any,
  contactId?: number | null
): Promise<string> {
  try {
    // If we have a contactId and it's not the main contact, get the contact name
    if (contactId && contactId > 0 && client?.isContact !== true) {
      const contacts = await fetchLeadContacts(client.id, client.lead_type === 'legacy');
      const contact = contacts.find((c: ContactInfo) => c.id === contactId);
      if (contact?.name) {
        return contact.name;
      }
    }

    // For contacts, use the contact name directly
    if (client?.isContact && client?.name) {
      return client.name;
    }

    // Use client name as fallback
    if (client?.name) {
      return client.name;
    }

    // Final fallback
    return 'Client';
  } catch (error) {
    console.error('Error getting client/contact name:', error);
    return 'Client';
  }
}

/**
 * Get phone number for the current user (sender)
 * Fetches from tenants_employee table via employee_id
 */
export async function getPhoneNumber(
  client: any,
  contactId?: number | null
): Promise<string> {
  try {
    // Get the current authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('Error getting authenticated user:', authError);
      return '';
    }

    // Find the user in users table by auth_id or email
    let { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, employee_id, email')
      .eq('auth_id', user.id)
      .maybeSingle();

    // If not found by auth_id, try by email
    if (!userData && user.email) {
      const { data: userByEmail } = await supabase
        .from('users')
        .select('id, employee_id, email')
        .eq('email', user.email)
        .maybeSingle();
      userData = userByEmail;
    }

    if (userError || !userData) {
      console.error('Error fetching user data:', userError);
      return '';
    }

    // If user has an employee_id, fetch phone from tenants_employee table
    if (userData.employee_id) {
      const { data: employeeData, error: employeeError } = await supabase
        .from('tenants_employee')
        .select('phone')
        .eq('id', userData.employee_id)
        .maybeSingle();

      if (employeeError) {
        console.error('Error fetching employee phone:', employeeError);
        return '';
      }

      if (employeeData?.phone) {
        return employeeData.phone;
      }
    }

    return '';
  } catch (error) {
    console.error('Error getting phone number:', error);
    return '';
  }
}

/**
 * Get mobile number for the current user (sender)
 * Fetches from tenants_employee table via employee_id
 */
export async function getMobileNumber(
  client: any,
  contactId?: number | null
): Promise<string> {
  try {
    // Get the current authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('Error getting authenticated user:', authError);
      return '';
    }

    // Find the user in users table by auth_id or email
    let { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, employee_id, email')
      .eq('auth_id', user.id)
      .maybeSingle();

    // If not found by auth_id, try by email
    if (!userData && user.email) {
      const { data: userByEmail } = await supabase
        .from('users')
        .select('id, employee_id, email')
        .eq('email', user.email)
        .maybeSingle();
      userData = userByEmail;
    }

    if (userError || !userData) {
      console.error('Error fetching user data:', userError);
      return '';
    }

    // If user has an employee_id, fetch mobile from tenants_employee table
    if (userData.employee_id) {
      const { data: employeeData, error: employeeError } = await supabase
        .from('tenants_employee')
        .select('mobile, phone')
        .eq('id', userData.employee_id)
        .maybeSingle();

      if (employeeError) {
        console.error('Error fetching employee mobile:', employeeError);
        return '';
      }

      // Return mobile, or fallback to phone if mobile not available
      if (employeeData?.mobile) {
        return employeeData.mobile;
      } else if (employeeData?.phone) {
        return employeeData.phone;
      }
    }

    return '';
  } catch (error) {
    console.error('Error getting mobile number:', error);
    return '';
  }
}

/**
 * Get email address for the current user (sender)
 * Fetches from users table
 */
export async function getEmailAddress(
  client: any,
  contactId?: number | null
): Promise<string> {
  try {
    // Get the current authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('Error getting authenticated user:', authError);
      return '';
    }

    // First try to get email from auth user
    if (user.email) {
      return user.email;
    }

    // Find the user in users table by auth_id to get email
    let { data: userData, error: userError } = await supabase
      .from('users')
      .select('email')
      .eq('auth_id', user.id)
      .maybeSingle();

    // If not found by auth_id, try by user.id (in case auth_id is different)
    if (!userData && user.id) {
      const { data: userById } = await supabase
        .from('users')
        .select('email')
        .eq('id', user.id)
        .maybeSingle();
      userData = userById;
    }

    if (userError) {
      console.error('Error fetching user email:', userError);
      return '';
    }

    if (userData?.email) {
      return userData.email;
    }

    return '';
  } catch (error) {
    console.error('Error getting email address:', error);
    return '';
  }
}

/**
 * WhatsApp Cloud API rejects newlines and some control characters in template body variables.
 * Collapses real line breaks and literal "\\r\\n" from storage into one comma-separated line.
 */
export function sanitizeWhatsAppTemplateVariableText(text: string): string {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/\\r\\n/g, ' ').replace(/\\n/g, ' ').replace(/\\r/g, ' ');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Get meeting location for WhatsApp templates.
 * Uses meetings.custom_address for custom locations; otherwise resolves meetings.meeting_location
 * via tenants_meetinglocation. If is_physical_location is true, uses address (fallback name if empty);
 * if false (virtual / Teams / Zoom room), uses name, not address.
 * No street address on catalog row → "-" (whether or not default_link is set; link uses meeting_link param).
 */
export async function getMeetingLocation(
  clientId: string,
  isLegacyLead: boolean
): Promise<string> {
  try {
    // Determine the correct ID for querying
    let queryId: string | number;
    let columnName: string;

    if (isLegacyLead) {
      const legacyId = clientId.toString().replace('legacy_', '');
      queryId = parseInt(legacyId, 10);
      columnName = 'legacy_lead_id';
    } else {
      queryId = clientId;
      columnName = 'client_id';
    }

    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('meeting_location, custom_address')
      .eq(columnName, queryId)
      .or('status.is.null,status.neq.canceled')
      .order('meeting_date', { ascending: false })
      .order('meeting_time', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching meeting location:', error);
      dbgMeetingLocation('meetings query error', error);
      return '';
    }

    if (!meetings || meetings.length === 0) {
      dbgMeetingLocation('no meeting row', { columnName, queryId, isLegacyLead });
      return '';
    }

    const meeting = meetings[0];
    const rawLoc = meeting.meeting_location;
    const rawLocStr =
      rawLoc === null || rawLoc === undefined ? '' : String(rawLoc).trim();

    const customAddress = meeting.custom_address != null ? String(meeting.custom_address).trim() : '';
    dbgMeetingLocation('meeting row', {
      columnName,
      queryId,
      rawLocStr,
      customAddress: customAddress || '(empty)',
      customSkippedAsDuplicateLabel: !!(customAddress && customAddress === rawLocStr),
    });

    // Same string as location label — not a real override; resolve via tenants_meetinglocation for address
    if (customAddress && customAddress !== rawLocStr) {
      dbgMeetingLocation('returning custom_address (differs from meeting_location label)');
      return sanitizeWhatsAppTemplateVariableText(customAddress);
    }

    if (!rawLocStr) {
      dbgMeetingLocation('empty meeting_location after trim');
      return '';
    }

    const rawStr = rawLocStr;

    const firmFromLead = !isLegacyLead ? await getFirmIdForNewLead(String(queryId)) : null;
    const firmFromSession = await getCurrentUserFirmId();
    const firmId = firmFromLead ?? firmFromSession;
    dbgMeetingLocation('firm resolution', {
      firmFromLead,
      firmFromSession,
      firmIdUsed: firmId,
    });

    const locRow = await fetchTenantMeetingLocationRow(rawStr, firmId);

    if (locRow) {
      const name = locRow.name != null ? String(locRow.name).trim() : '';
      const addr = locRow.address != null ? String(locRow.address).trim() : '';
      const defaultLink =
        locRow.default_link != null ? String(locRow.default_link).trim() : '';
      const physical = shouldUsePhysicalAddress(locRow.is_physical_location, addr.length > 0);

      dbgMeetingLocation('resolved tenants_meetinglocation row', {
        id: locRow.id,
        name,
        addressLen: addr.length,
        addressPreview: addr.slice(0, 120),
        hasDefaultLink: !!defaultLink,
        is_physical_location: locRow.is_physical_location,
        firm_id: locRow.firm_id,
        physicalBranch: physical,
      });

      if (!addr) {
        dbgMeetingLocation('no address on catalog row → hyphen Place param');
        return '-';
      }

      if (physical) {
        dbgMeetingLocation('returning address (physical branch)');
        return sanitizeWhatsAppTemplateVariableText(addr);
      }
      dbgMeetingLocation('virtual branch with address field → name only', { name, rawStr });
      return name || rawStr;
    }

    dbgMeetingLocation('no loc row → raw meeting_location string', rawStr);
    return rawStr;
  } catch (error) {
    console.error('Error getting meeting location:', error);
    dbgMeetingLocation('exception', error);
    return '';
  }
}

/**
 * Get meeting link (Teams/Zoom / maps) from the last meeting.
 * Uses the same tenants_meetinglocation row resolution as getMeetingLocation (no loose parseInt / .single()).
 */
export async function getMeetingLink(
  clientId: string,
  isLegacyLead: boolean
): Promise<string> {
  try {
    let queryId: string | number;
    let columnName: string;

    if (isLegacyLead) {
      const legacyId = clientId.toString().replace('legacy_', '');
      queryId = parseInt(legacyId, 10);
      columnName = 'legacy_lead_id';
    } else {
      queryId = clientId;
      columnName = 'client_id';
    }

    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('teams_meeting_url, meeting_location, custom_link')
      .eq(columnName, queryId)
      .or('status.is.null,status.neq.canceled')
      .order('meeting_date', { ascending: false })
      .order('meeting_time', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching meeting link:', error);
      return '';
    }

    if (!meetings || meetings.length === 0) {
      return '';
    }

    const meeting = meetings[0];

    const custom = meeting.custom_link != null ? String(meeting.custom_link).trim() : '';
    if (custom && /^https?:\/\//i.test(custom)) {
      return custom;
    }

    const rawLoc = meeting.meeting_location;
    const rawStr =
      rawLoc === null || rawLoc === undefined ? '' : String(rawLoc).trim();

    if (rawStr) {
      const firmFromLead = !isLegacyLead ? await getFirmIdForNewLead(String(queryId)) : null;
      const firmFromSession = await getCurrentUserFirmId();
      const firmId = firmFromLead ?? firmFromSession;
      const locRow = await fetchTenantMeetingLocationRow(rawStr, firmId);
      const dl = locRow?.default_link != null ? String(locRow.default_link).trim() : '';
      if (dl) return dl;
    }

    const teams = meeting.teams_meeting_url != null ? String(meeting.teams_meeting_url).trim() : '';
    return teams || '';
  } catch (error) {
    console.error('Error getting meeting link:', error);
    return '';
  }
}

/**
 * Get meeting date and time for template param 2
 * Returns formatted string like "January 15, 2025 at 10:00 AM"
 */
export async function getMeetingDateTime(
  clientId: string | null | undefined,
  isLegacyLead: boolean
): Promise<string> {
  try {
    // Return empty string if no client ID provided (for WhatsApp leads without a connected lead)
    if (!clientId || clientId === null || clientId === undefined || clientId === '') {
      console.log('⚠️ No client ID provided for meeting lookup, skipping');
      return '';
    }

    // Convert to string for validation
    const clientIdStr = clientId.toString();

    // Determine the correct ID for querying
    let queryId: string | number;
    let columnName: string;

    if (isLegacyLead) {
      const legacyId = clientIdStr.replace('legacy_', '');
      queryId = parseInt(legacyId, 10);
      // Validate that it's a valid number (not NaN and greater than 0)
      if (isNaN(queryId) || queryId <= 0) {
        console.warn(`⚠️ Invalid legacy ID format: ${legacyId}, skipping meeting lookup`);
        return '';
      }
      columnName = 'legacy_lead_id';
    } else {
      // For new leads, validate it looks like a UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(clientIdStr)) {
        // If it doesn't match UUID format, it might be a number (like 39 from WhatsApp message ID)
        // In that case, skip the lookup
        console.warn(`⚠️ Invalid UUID format: ${clientIdStr}, skipping meeting lookup (this might be a WhatsApp message ID, not a lead ID)`);
        return '';
      }
      queryId = clientIdStr;
      columnName = 'client_id';
    }

    // Fetch the most recent meeting (past or future) - get the last meeting
    console.log(`🔍 Querying last meeting for ${columnName}=${queryId}`);

    let meetings: any[] | null = null;
    let error: any = null;

    // First try the meetings table
    const { data: meetingsData, error: meetingsError } = await supabase
      .from('meetings')
      .select('meeting_date, meeting_time, status')
      .eq(columnName, queryId)
      .or('status.is.null,status.neq.canceled') // Include null status or non-canceled (exclude canceled)
      .order('meeting_date', { ascending: false }) // Most recent date first
      .order('meeting_time', { ascending: false }) // Most recent time first
      .limit(1);

    meetings = meetingsData;
    error = meetingsError;

    // If no meeting found in meetings table and it's a legacy lead, check leads_lead table
    if (isLegacyLead && (!meetings || meetings.length === 0)) {
      console.log(`🔍 No meeting in meetings table, checking leads_lead table for id=${queryId}`);
      const { data: legacyLeadData, error: legacyError } = await supabase
        .from('leads_lead')
        .select('meeting_date, meeting_time')
        .eq('id', queryId)
        .not('meeting_date', 'is', null)
        .single();

      if (!legacyError && legacyLeadData && legacyLeadData.meeting_date && legacyLeadData.meeting_time) {
        // Convert leads_lead format to meetings format
        meetings = [{
          meeting_date: legacyLeadData.meeting_date,
          meeting_time: legacyLeadData.meeting_time,
          status: null
        }];
        error = null;
        console.log(`✅ Found meeting in leads_lead table:`, meetings[0]);
      }
    }

    console.log(`🔍 Last meeting query result:`, { meetings, error, count: meetings?.length || 0 });

    if (error) {
      console.error('❌ Error fetching meeting:', error);
      return '';
    }

    if (!meetings || meetings.length === 0) {
      console.log(`⚠️ No meetings found for ${columnName}=${queryId}`);
      return '';
    }

    console.log(`✅ Found last meeting:`, meetings[0]);

    const meeting = meetings[0];
    if (!meeting.meeting_date || !meeting.meeting_time) {
      return '';
    }

    // Format the date and time
    const date = new Date(`${meeting.meeting_date}T${meeting.meeting_time}`);

    // Format as "January 15, 2025 at 10:00 AM"
    const options: Intl.DateTimeFormatOptions = {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };

    const formatted = date.toLocaleString('en-US', options);
    return formatted.replace(',', ' at');
  } catch (error) {
    console.error('Error formatting meeting date/time:', error);
    return '';
  }
}

/**
 * Get meeting time only (without date) for template parameters
 * Returns formatted string like "10:00 AM"
 */
export async function getMeetingTime(
  clientId: string | null | undefined,
  isLegacyLead: boolean
): Promise<string> {
  try {
    // Return empty string if no client ID provided
    if (!clientId || clientId === null || clientId === undefined || clientId === '') {
      console.log('⚠️ No client ID provided for meeting time lookup, skipping');
      return '';
    }

    // Convert to string for validation
    const clientIdStr = clientId.toString();

    // Determine the correct ID for querying
    let queryId: string | number;
    let columnName: string;

    if (isLegacyLead) {
      const legacyId = clientIdStr.replace('legacy_', '');
      queryId = parseInt(legacyId, 10);
      if (isNaN(queryId) || queryId <= 0) {
        console.warn(`⚠️ Invalid legacy ID format: ${legacyId}, skipping meeting time lookup`);
        return '';
      }
      columnName = 'legacy_lead_id';
    } else {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(clientIdStr)) {
        console.warn(`⚠️ Invalid UUID format: ${clientIdStr}, skipping meeting time lookup`);
        return '';
      }
      queryId = clientIdStr;
      columnName = 'client_id';
    }

    // Fetch the most recent meeting
    console.log(`🔍 Querying meeting time for ${columnName}=${queryId}`);

    let meetings: any[] | null = null;
    let error: any = null;

    // First try the meetings table
    const { data: meetingsData, error: meetingsError } = await supabase
      .from('meetings')
      .select('meeting_time, meeting_date, status')
      .eq(columnName, queryId)
      .or('status.is.null,status.neq.canceled')
      .order('meeting_date', { ascending: false })
      .order('meeting_time', { ascending: false })
      .limit(1);

    meetings = meetingsData;
    error = meetingsError;

    // If no meeting found in meetings table and it's a legacy lead, check leads_lead table
    if (isLegacyLead && (!meetings || meetings.length === 0)) {
      console.log(`🔍 No meeting in meetings table, checking leads_lead table for id=${queryId}`);
      const { data: legacyLeadData, error: legacyError } = await supabase
        .from('leads_lead')
        .select('meeting_date, meeting_time')
        .eq('id', queryId)
        .not('meeting_date', 'is', null)
        .not('meeting_time', 'is', null)
        .single();

      if (!legacyError && legacyLeadData && legacyLeadData.meeting_date && legacyLeadData.meeting_time) {
        // Convert leads_lead format to meetings format
        meetings = [{
          meeting_date: legacyLeadData.meeting_date,
          meeting_time: legacyLeadData.meeting_time,
          status: null
        }];
        error = null;
        console.log(`✅ Found meeting in leads_lead table:`, meetings[0]);
      }
    }

    if (error) {
      console.error('❌ Error fetching meeting time:', error);
      return '';
    }

    if (!meetings || meetings.length === 0) {
      console.log(`⚠️ No meetings found for ${columnName}=${queryId}`);
      return '';
    }

    const meeting = meetings[0];
    if (!meeting.meeting_time) {
      return '';
    }

    // Format the time directly from meeting_time
    // meeting_time is a TIME type, format: "HH:MM:SS" or "HH:MM"
    const timeStr = meeting.meeting_time.toString();

    // Parse the time string (could be "10:00:00" or "10:00")
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (!timeMatch) {
      console.warn(`⚠️ Could not parse meeting time: ${timeStr}`);
      return '';
    }

    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);

    // Format as "10:00 AM" or "2:30 PM"
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);

    const options: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };

    return date.toLocaleString('en-US', options);
  } catch (error) {
    console.error('Error formatting meeting time:', error);
    return '';
  }
}

/**
 * Generate template parameters array based on param count
 * Param 1 = Client/Contact name
 * Param 2 = Meeting date and time
 */
export async function generateTemplateParameters(
  paramCount: number,
  client: any,
  contactId?: number | null
): Promise<Array<{ type: string; text: string }>> {
  const parameters: Array<{ type: string; text: string }> = [];

  if (paramCount === 0) {
    return parameters;
  }

  // Param 1: Client/Contact name
  if (paramCount >= 1) {
    const clientName = await getClientOrContactName(client, contactId);
    parameters.push({
      type: 'text',
      text: clientName
    });
  }

  // Param 2: Meeting date and time
  if (paramCount >= 2) {
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    // Use lead_id if client is a contact, otherwise use client.id
    let clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;

    // Validate that clientIdForMeeting is a valid UUID or legacy ID format
    // Check if it's a pure number without "legacy_" prefix - this is likely a WhatsApp message ID, not a lead ID
    const clientIdStr = clientIdForMeeting?.toString() || '';
    const isPureNumber = /^\d+$/.test(clientIdStr);
    const isLegacyFormat = clientIdStr.startsWith('legacy_');
    const isUUIDFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientIdStr);

    // If client ID is null, undefined, empty, or an invalid format, skip meeting lookup
    if (!clientIdForMeeting ||
      clientIdForMeeting === null ||
      clientIdForMeeting === undefined ||
      clientIdForMeeting === '' ||
      (isPureNumber && !isLegacyFormat)) { // Pure numbers without "legacy_" prefix are invalid (likely WhatsApp message IDs)
      console.log('⚠️ No valid client ID for meeting lookup (ID:', clientIdForMeeting, 'format:', { isPureNumber, isLegacyFormat, isUUIDFormat }, '), using placeholder');
      const meetingDateTime = '';
      parameters.push({
        type: 'text',
        text: meetingDateTime || 'your scheduled appointment'
      });
    } else {
      console.log('🔍 Fetching meeting for param 2:', { clientIdForMeeting, isLegacyLead, clientId: client?.id, isContact: client?.isContact, lead_id: client?.lead_id });

      const meetingDateTime = await getMeetingDateTime(clientIdForMeeting, isLegacyLead);

      // Always push a parameter, using placeholder if no meeting found
      parameters.push({
        type: 'text',
        text: meetingDateTime || 'your scheduled appointment'
      });

      if (!meetingDateTime) {
        console.warn(`⚠️ No meeting found for client ${clientIdForMeeting}, using placeholder "your scheduled appointment"`);
      } else {
        console.log(`✅ Found meeting date/time: ${meetingDateTime}`);
      }
    }
  }

  // For any additional params beyond 2, fill with appropriate values
  for (let i = 3; i <= paramCount; i++) {
    let paramValue = '';

    // Param 3: Meeting location — resolve address via tenants_meetinglocation (same as param_mapping type meeting_location)
    if (i === 3) {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
      if (clientIdForMeeting) {
        paramValue = await getMeetingLocation(clientIdForMeeting, isLegacyLead);
      }
    }
    // Param 4: Meeting link — always resolve from DB (client.meeting_link was often wrong default_link)
    else if (i === 4) {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
      if (clientIdForMeeting) {
        paramValue = await getMeetingLink(clientIdForMeeting, isLegacyLead);
      }
    }
    // Param 5+: Empty strings (can be extended later)
    else {
      paramValue = '';
    }

    parameters.push({
      type: 'text',
      text: paramValue
    });
  }

  return parameters;
}

