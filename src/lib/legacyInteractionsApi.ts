import { supabase } from './supabase';

const LEGACY_INTERACTION_LIMIT = 200;

interface LegacyInteraction {
  id: number;
  cdate: string | null;
  kind: string | null;
  date: string | null;
  time: string | null;
  minutes: number | null;
  content: string | null;
  creator_id: string | null;
  direction: string | null;
  employee_id: string | null;
  description: string | null;
  contact_id: number | null;
}

interface EmployeeRecord {
  id: string;
  display_name: string | null;
  official_name: string | null;
}

export interface TransformedLegacyInteraction {
  id: string | number;
  date: string;
  time: string;
  raw_date: string;
  employee: string;
  direction: 'in' | 'out';
  kind: string;
  length: string;
  content: string;
  observation: string;
  editable: boolean;
  status?: string;
  subject?: string;
  recipient_name?: string | null; // Recipient name for "To:" display
  contact_id?: number | null; // Contact ID from leads_leadinteractions.contact_id
  contact_name?: string; // Contact name fetched from lead_leadcontact -> leads_contact
}

const cleanLegacyText = (text?: string | null): string => {
  if (!text || text === '\\N' || text === 'EMPTY' || text === 'FAILED') {
    return '';
  }

  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .trim();
};

const transformLegacyInteraction = (
  interaction: LegacyInteraction,
  employeeMap: Record<string, EmployeeRecord>,
  clientName: string,
  contactMap: Record<number, string> = {},
): TransformedLegacyInteraction => {
  let interactionDate = interaction.date || interaction.cdate?.split('T')[0] || '';
  let interactionTime = interaction.time || interaction.cdate?.split('T')[1]?.substring(0, 5) || '';

  if (interactionDate === '\\N' || interactionDate === 'EMPTY') interactionDate = '';
  if (interactionTime === '\\N' || interactionTime === 'EMPTY') interactionTime = '';

  let direction: 'in' | 'out' = 'in';
  if (interaction.direction === 'o' || interaction.kind === 'c') {
    direction = 'out';
  }

  let kind = interaction.kind || 'note';
  switch (kind) {
    case 'w':
      // Legacy WhatsApp interactions from leads_leadinteractions are manual interactions
      kind = 'whatsapp_manual';
      break;
    case 'c':
      kind = 'call';
      break;
    case 'e':
      // Legacy email interactions from leads_leadinteractions are manual interactions
      // They should be treated as editable manual interactions, not actual emails
      kind = 'email_manual';
      break;
    case 'EMPTY':
      // For EMPTY kind, check description for METHOD: marker to distinguish interaction types
      // Format: "METHOD:sms|observation text" or "METHOD:office|observation text"
      const description = interaction.description || '';
      if (description.startsWith('METHOD:sms|')) {
        kind = 'sms';
      } else if (description.startsWith('METHOD:office|')) {
        kind = 'office';
      } else {
        kind = 'note';
      }
      break;
    default:
      kind = 'note';
  }

  let content = cleanLegacyText(interaction.content);
  if (!content) {
    content = 'No content';
  }

  const length = interaction.minutes ? `${interaction.minutes} min` : '';

  // Get contact name if contact_id is present
  const contactName = interaction.contact_id && contactMap[interaction.contact_id] 
    ? contactMap[interaction.contact_id] 
    : null;

  // Get employee name from creator_id or employee_id (the person who saved/created the interaction)
  let employeeNameFromId: string | null = null;
  let employeeId: string | number | null = null;
  if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY') {
    employeeId = interaction.creator_id;
  } else if (interaction.employee_id && interaction.employee_id !== '\\N' && interaction.employee_id !== 'EMPTY') {
    employeeId = interaction.employee_id;
  }

  if (employeeId) {
    // Convert to string for map lookup (map keys are strings)
    const employeeIdStr = String(employeeId);
    if (employeeMap[employeeIdStr]) {
      const record = employeeMap[employeeIdStr];
      employeeNameFromId = record.display_name || record.official_name || employeeIdStr;
    } else {
      // If not found in map, try to convert to number and look up again (in case of type mismatch)
      const employeeIdNum = typeof employeeId === 'string' ? parseInt(employeeId, 10) : employeeId;
      if (!isNaN(employeeIdNum as number) && employeeMap[String(employeeIdNum)]) {
        const record = employeeMap[String(employeeIdNum)];
        employeeNameFromId = record.display_name || record.official_name || String(employeeIdNum);
      } else {
        employeeNameFromId = employeeIdStr;
      }
    }
  }

  // Determine employee (sender) and recipient based on direction
  let employeeName: string; // The sender/employee field
  let recipientName: string | null; // The recipient for "To:" display
  
  if (direction === 'out') {
    // Outgoing: employee is the sender, contact/client is the recipient
    employeeName = employeeNameFromId || 'Unknown';
    recipientName = contactName || clientName || 'Client';
  } else {
    // Incoming: contact/client is the sender, employee is the recipient
    employeeName = contactName || clientName || 'Client';
    recipientName = employeeNameFromId || 'Team';
  }

  // Determine if this is a manual interaction (not from call_logs table)
  // Manual interactions in leads_leadinteractions are typically those with kind 'c', 'e', 'w', or 'EMPTY'
  // and are not associated with call_logs. We can identify them by checking if they have meaningful content
  // and are not just call logs. For now, we'll mark all as editable=false, but manual calls/emails/whatsapp
  // should be editable. We'll use a different approach: check if kind is 'c', 'e', or 'w' and set editable based on that.
  // Actually, the safest approach is to check if this interaction was created manually vs from call_logs.
  // Since we can't distinguish easily, we'll mark interactions with kind 'c', 'e', 'w' as potentially editable.
  // But for now, let's keep editable: false and handle it in the filter logic.
  
  // Determine status - only set for actual email (not email_manual) and whatsapp (not whatsapp_manual), not for calls, SMS, notes, email_manual, or whatsapp_manual
  // This prevents "sent" badge from showing for manual interactions
  let interactionStatus: string | undefined = undefined;
  if (kind === 'email' || kind === 'whatsapp') {
    // Only actual email (not email_manual) and WhatsApp (not whatsapp_manual) should have status
    interactionStatus = interaction.direction === 'o' ? 'sent' : 'received';
  }
  // For calls, SMS, notes, email_manual, and whatsapp_manual, don't set status to avoid showing "sent" badge
  
  // recipientName is already set above based on direction
  
  return {
    id: `legacy_${interaction.id}`,
    date: interactionDate
      ? new Date(interactionDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : 'Unknown',
    time: interactionTime || 'Unknown',
    raw_date: interaction.cdate || interactionDate || '',
    employee: employeeName,
    direction,
    kind,
    length,
    content,
    observation: cleanLegacyText((interaction.description || '').replace(/^METHOD:(sms|office)\|/, '')), // Remove METHOD: prefix from observation
    editable: kind === 'email_manual' || kind === 'whatsapp_manual', // Legacy email and WhatsApp interactions are manual and editable
    status: interactionStatus,
    subject: cleanLegacyText((interaction.description || '').replace(/^METHOD:(sms|office)\|/, '')), // Remove METHOD: prefix from subject
    recipient_name: recipientName, // Set recipient_name for "To:" display
    contact_id: interaction.contact_id || null, // Include contact_id if available
    contact_name: contactName || undefined, // Include contact_name if available
  };
};

export const fetchLegacyInteractions = async (
  leadId: string,
  clientName?: string,
): Promise<TransformedLegacyInteraction[]> => {
  const numericId = parseInt(leadId.replace('legacy_', ''), 10);
  if (Number.isNaN(numericId)) {
    return [];
  }

  const { data, error } = await supabase
    .from('leads_leadinteractions')
    .select(
      'id, cdate, kind, date, time, minutes, content, creator_id, direction, employee_id, description, contact_id',
    )
    .eq('lead_id', numericId)
    .order('cdate', { ascending: false })
    .limit(LEGACY_INTERACTION_LIMIT);

  if (error) {
    console.error('❌ Error fetching legacy interactions:', error);
    return [];
  }

  const interactions = (data || []) as LegacyInteraction[];
  console.log(`📊 [fetchLegacyInteractions] Fetched ${interactions.length} interactions from database for lead_id ${numericId}`, {
    leadId: numericId,
    fetchedCount: interactions.length,
    interactionIds: interactions.map(i => i.id).slice(0, 20), // First 20 IDs for debugging
    interactionKinds: interactions.reduce((acc, i) => {
      const kind = i.kind || 'null';
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  });
  const employeeIds = [
    ...new Set(
      interactions.flatMap((interaction) => {
        const ids: (string | number)[] = [];
        if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY') {
          // Convert to number if it's a numeric string, otherwise keep as string
          const id = interaction.creator_id;
          const numId = typeof id === 'string' ? parseInt(id, 10) : id;
          if (!isNaN(numId) && numId > 0) {
            ids.push(numId);
          } else {
            ids.push(id);
          }
        }
        if (interaction.employee_id && interaction.employee_id !== '\\N' && interaction.employee_id !== 'EMPTY') {
          // Convert to number if it's a numeric string, otherwise keep as string
          const id = interaction.employee_id;
          const numId = typeof id === 'string' ? parseInt(id, 10) : id;
          if (!isNaN(numId) && numId > 0) {
            ids.push(numId);
          } else {
            ids.push(id);
          }
        }
        return ids;
      }),
    ),
  ];

  let employeeMap: Record<string, EmployeeRecord> = {};
  if (employeeIds.length > 0) {
    const { data: employeeData, error: employeeError } = await supabase
      .from('tenants_employee')
      .select('id, display_name, official_name')
      .in('id', employeeIds);

    if (!employeeError && employeeData) {
      employeeMap = (employeeData as EmployeeRecord[]).reduce((acc, record) => {
        acc[record.id.toString()] = record;
        return acc;
      }, {} as Record<string, EmployeeRecord>);
    }
  }

  // Fetch contact names for interactions that have contact_id
  const contactIds = interactions
    .map(i => i.contact_id)
    .filter((id): id is number => id !== null && id !== undefined);
  
  let contactMap: Record<number, string> = {};
  if (contactIds.length > 0) {
    // Fetch contact names from lead_leadcontact -> leads_contact
    // contact_id in leads_leadinteractions references lead_leadcontact.id
    const { data: leadContactsData, error: leadContactsError } = await supabase
      .from('lead_leadcontact')
      .select('id, contact_id, leads_contact:contact_id(name)')
      .in('id', contactIds);

    if (!leadContactsError && leadContactsData) {
      leadContactsData.forEach((leadContact: any) => {
        const contactName = leadContact.leads_contact?.name;
        if (contactName && leadContact.id) {
          contactMap[leadContact.id] = contactName;
        }
      });
    }
  }

  return interactions.map((interaction) =>
    transformLegacyInteraction(interaction, employeeMap, clientName || 'Client', contactMap),
  );
};

