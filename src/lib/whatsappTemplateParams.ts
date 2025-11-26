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
    
    // Fetch the most recent meeting
    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('teams_meeting_url')
      .eq(columnName, queryId)
      .or('status.is.null,status.neq.canceled')
      .order('meeting_date', { ascending: false })
      .order('meeting_time', { ascending: false })
      .limit(1);
    
    if (error) {
      console.error('Error fetching meeting link:', error);
      return '';
    }
    
    if (!meetings || meetings.length === 0 || !meetings[0].teams_meeting_url) {
      return '';
    }
    
    return meetings[0].teams_meeting_url;
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
    
    // Fetch the most recent meeting (past or future) - get the last meeting
    console.log(`🔍 Querying last meeting for ${columnName}=${queryId}`);
    
    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('meeting_date, meeting_time, status')
      .eq(columnName, queryId)
      .or('status.is.null,status.neq.canceled') // Include null status or non-canceled (exclude canceled)
      .order('meeting_date', { ascending: false }) // Most recent date first
      .order('meeting_time', { ascending: false }) // Most recent time first
      .limit(1);
    
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
    const clientIdForMeeting = client?.isContact && client?.lead_id ? client.lead_id : client?.id;
    
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
  
  // For any additional params beyond 2, fill with empty strings
  for (let i = 3; i <= paramCount; i++) {
    parameters.push({
      type: 'text',
      text: ''
    });
  }
  
  return parameters;
}

