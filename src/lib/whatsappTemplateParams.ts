import { supabase } from './supabase';
import { fetchLeadContacts } from './contactHelpers';
import type { ContactInfo } from './contactHelpers';

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
 * Get meeting location from the last meeting
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

    // Fetch the most recent meeting
    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('meeting_location')
      .eq(columnName, queryId)
      .or('status.is.null,status.neq.canceled')
      .order('meeting_date', { ascending: false })
      .order('meeting_time', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching meeting location:', error);
      return '';
    }

    if (!meetings || meetings.length === 0 || !meetings[0].meeting_location) {
      return '';
    }

    return meetings[0].meeting_location;
  } catch (error) {
    console.error('Error getting meeting location:', error);
    return '';
  }
}

/**
 * Get meeting link (Teams/Zoom URL) from the last meeting
 */
export async function getMeetingLink(
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

    // Fetch the most recent meeting with location
    let meetings: any[] | null = null;
    let error: any = null;

    const { data: meetingsData, error: meetingsError } = await supabase
      .from('meetings')
      .select('teams_meeting_url, meeting_location')
      .eq(columnName, queryId)
      .or('status.is.null,status.neq.canceled')
      .order('meeting_date', { ascending: false })
      .order('meeting_time', { ascending: false })
      .limit(1);

    meetings = meetingsData;
    error = meetingsError;

    // Legacy leads in leads_lead table don't have teams_meeting_url, so no need to check there
    // (teams_meeting_url is only in the meetings table)

    if (error) {
      console.error('Error fetching meeting link:', error);
      return '';
    }

    if (!meetings || meetings.length === 0) {
      return '';
    }

    const meeting = meetings[0];

    // First check if location has default_link
    if (meeting.meeting_location) {
      // Fetch location details to check for default_link
      // meeting_location can be either a name (string) or an ID (number)
      let locationQuery = supabase
        .from('tenants_meetinglocation')
        .select('default_link');

      // Try to match by ID first (if it's a number)
      const locationId = parseInt(meeting.meeting_location, 10);
      if (!isNaN(locationId)) {
        locationQuery = locationQuery.eq('id', locationId);
      } else {
        // Otherwise match by name
        locationQuery = locationQuery.eq('name', meeting.meeting_location);
      }

      const { data: locationData, error: locationError } = await locationQuery.single();

      if (!locationError && locationData?.default_link) {
        return locationData.default_link;
      }
    }

    // Fallback to teams_meeting_url
    return meeting.teams_meeting_url || '';
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

    // Param 3: Meeting location (if available)
    if (i === 3 && client?.meeting_location) {
      paramValue = client.meeting_location;
    }
    // Param 4: Meeting link (if available)
    else if (i === 4) {
      // Try to get meeting link from client object first (set by MeetingTab)
      if (client?.meeting_link) {
        paramValue = client.meeting_link;
      } else {
        // Fallback: fetch from database
        const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
        const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
        if (clientIdForMeeting) {
          paramValue = await getMeetingLink(clientIdForMeeting, isLegacyLead);
        }
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

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/3bb9a82c-3ad4-47e1-84df-d5398935b352', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'whatsappTemplateParams.ts:652', message: 'generateTemplateParameters result', data: { paramCount, parametersLength: parameters.length, parameters }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'G' }) }).catch(() => { });
  // #endregion

  return parameters;
}

