import { supabase } from './supabase';

export type WhatsAppShareLeadClient = {
  id: string;
  lead_number: string;
  name: string;
  lead_type?: 'legacy' | 'new';
  manual_id?: string;
};

export type RmqShareEmployee = {
  id: string;
  full_name: string;
  email?: string;
  display_name?: string;
  photo_url?: string;
  department_name?: string;
};

function getAppOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://leadify-crm.onrender.com';
}

/** Client page path aligned with WhatsApp navigate-to-client logic. */
export function buildWhatsAppClientPagePath(client: WhatsAppShareLeadClient): string | null {
  const isLegacy = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');

  let leadIdentifier: string | null = null;

  if (isLegacy) {
    const clientId = client.id?.toString();
    if (clientId) {
      if (clientId.startsWith('legacy_')) {
        leadIdentifier = clientId.replace('legacy_', '');
      } else if (/^\d+$/.test(clientId)) {
        leadIdentifier = clientId;
      }
    }
    if (!leadIdentifier && client.lead_number && /^\d+$/.test(client.lead_number)) {
      leadIdentifier = client.lead_number;
    }
  } else {
    leadIdentifier = client.lead_number || client.manual_id || null;
  }

  if (!leadIdentifier) return null;

  const encodedIdentifier = encodeURIComponent(leadIdentifier);
  const displayLeadNumber = (client.lead_number || '').trim();
  if (displayLeadNumber.includes('/')) {
    return `/clients/${encodedIdentifier}?lead=${encodeURIComponent(displayLeadNumber)}`;
  }
  return `/clients/${encodedIdentifier}`;
}

export function buildWhatsAppLeadRmqMessage(client: WhatsAppShareLeadClient): string {
  const path = buildWhatsAppClientPagePath(client);
  const origin = getAppOrigin();
  const displayNumber = (client.lead_number || '').trim() || 'Lead';
  const clientName = (client.name || '').trim() || 'Client';

  if (!path) {
    return `Shared WhatsApp conversation: ${clientName} (${displayNumber})`;
  }

  const url = `${origin}${path}`;
  return (
    `Shared from WhatsApp\n\n` +
    `[Lead #${displayNumber} - ${clientName}](${url})`
  );
}

export async function fetchActiveEmployeesForRmqShare(
  excludeUserId: string
): Promise<RmqShareEmployee[]> {
  const { data: usersData, error } = await supabase
    .from('users')
    .select(`
      id,
      full_name,
      email,
      employee_id,
      is_active,
      tenants_employee!employee_id(
        display_name,
        photo_url,
        tenant_departement!department_id(
          name
        )
      )
    `)
    .eq('is_active', true)
    .not('employee_id', 'is', null)
    .neq('id', excludeUserId);

  if (error) {
    throw error;
  }

  const rows = usersData || [];
  const seen = new Set<string>();
  const result: RmqShareEmployee[] = [];

  for (const user of rows) {
    if (!user.id || seen.has(user.id)) continue;
    const emp = user.tenants_employee
      ? Array.isArray(user.tenants_employee)
        ? user.tenants_employee[0]
        : user.tenants_employee
      : null;
    const dept = emp?.tenant_departement
      ? Array.isArray(emp.tenant_departement)
        ? emp.tenant_departement[0]
        : emp.tenant_departement
      : null;
    const displayName = emp?.display_name?.trim() || user.full_name?.trim();
    if (!displayName || displayName.length < 2) continue;

    seen.add(user.id);
    result.push({
      id: user.id,
      full_name: user.full_name || displayName,
      email: user.email,
      display_name: displayName,
      photo_url: emp?.photo_url,
      department_name: dept?.name,
    });
  }

  result.sort((a, b) =>
    (a.display_name || a.full_name).localeCompare(b.display_name || b.full_name, undefined, {
      sensitivity: 'base',
    })
  );

  return result;
}

export async function shareWhatsAppLeadViaRmq(params: {
  senderUserId: string;
  recipientUserId: string;
  client: WhatsAppShareLeadClient;
}): Promise<number> {
  const { senderUserId, recipientUserId, client } = params;
  const content = buildWhatsAppLeadRmqMessage(client);

  const { data: conversationId, error: convError } = await supabase.rpc('create_direct_conversation', {
    user1_uuid: senderUserId,
    user2_uuid: recipientUserId,
  });

  if (convError) {
    throw convError;
  }

  if (conversationId == null) {
    throw new Error('Could not create conversation');
  }

  await new Promise((resolve) => setTimeout(resolve, 400));

  const { error: messageError } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: senderUserId,
    content,
    message_type: 'text',
  });

  if (messageError) {
    throw messageError;
  }

  return Number(conversationId);
}
