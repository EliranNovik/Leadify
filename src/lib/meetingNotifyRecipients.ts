import { supabase } from './supabase';
import type { ContactInfo } from './contactHelpers';

export type NotifyRecipientSource = 'lead' | 'staff' | 'firm' | 'external';

export type NotifyRecipient = ContactInfo & {
  recipientKey: string;
  source: NotifyRecipientSource;
  sourceLabel: string;
  imageUrl?: string | null;
  employeeId?: number;
  subtitle?: string | null;
};

const normalizeContactInfoForDedup = (c: Partial<ContactInfo>) => {
  const normalizePhone = (phone: string | null | undefined) =>
    phone?.replace(/[\s\-()]/g, '').replace(/^\+/, '') || '';

  return {
    name: (c.name || '').toLowerCase().trim(),
    email: (c.email || '').toLowerCase().trim(),
    phone: normalizePhone(c.phone || c.mobile),
  };
};

const contactsMatchForDedup = (c1: ContactInfo, c2: ContactInfo): boolean => {
  const n1 = normalizeContactInfoForDedup(c1);
  const n2 = normalizeContactInfoForDedup(c2);

  if (n1.email && n2.email && n1.email === n2.email) return true;
  if (n1.phone && n2.phone && n1.phone === n2.phone) return true;
  if (n1.name && n2.name && n1.name === n2.name) {
    if (
      (n1.email && n2.email && n1.email === n2.email) ||
      (n1.phone && n2.phone && n1.phone === n2.phone)
    ) {
      return true;
    }
  }
  return false;
};

export function mergeNotifyRecipients(
  leadContacts: NotifyRecipient[],
  participantContacts: NotifyRecipient[],
): NotifyRecipient[] {
  const result = [...leadContacts];
  for (const contact of participantContacts) {
    if (result.some((c) => c.recipientKey === contact.recipientKey)) continue;
    const duplicateParticipant = result
      .filter((c) => c.source !== 'lead')
      .some((c) => contactsMatchForDedup(c, contact));
    if (duplicateParticipant) continue;
    result.push(contact);
  }
  return result;
}

export function getNotifySourceBadgeClass(source: NotifyRecipientSource): string {
  switch (source) {
    case 'staff':
      return 'bg-blue-100 text-blue-700';
    case 'firm':
      return 'bg-amber-100 text-amber-800';
    case 'external':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-purple-100 text-purple-700';
  }
}

export function getNotifyRecipientPhone(contact: NotifyRecipient): string | null {
  const mobile = contact.mobile?.trim();
  const phone = contact.phone?.trim();

  // Staff WhatsApp must use mobile only; desk phones/extensions break delivery.
  if (contact.source === 'staff') {
    if (mobile && mobile !== '' && mobile !== '---') return mobile;
    return null;
  }

  if (phone && phone !== '' && phone !== '---') return phone;
  if (mobile && mobile !== '' && mobile !== '---') return mobile;
  return null;
}

export function getMeetingDbId(meeting: { id: number | string }): number | null {
  const id = typeof meeting.id === 'number' ? meeting.id : Number(meeting.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function fetchMeetingParticipantContacts(meetingId: number): Promise<NotifyRecipient[]> {
  const { data: partData, error: partErr } = await supabase
    .from('meeting_participants')
    .select('id, employee_id, firm_contact_id, free_name, free_email, free_phone')
    .eq('meeting_id', meetingId);
  if (partErr || !partData?.length) return [];

  const employeeIds = Array.from(
    new Set(
      partData
        .map((r: any) => (r.employee_id != null ? Number(r.employee_id) : null))
        .filter((n: any) => Number.isFinite(n) && n > 0),
    ),
  ) as number[];
  const firmIds = Array.from(
    new Set(
      partData
        .map((r: any) => (r.firm_contact_id ? String(r.firm_contact_id) : null))
        .filter(Boolean),
    ),
  ) as string[];

  const fetchEmployeesWithPhones = async () => {
    if (!employeeIds.length) return { data: [] as any[] };
    const res = await supabase
      .from('tenants_employee')
      .select('id, display_name, photo_url, photo, phone, mobile, phone_ext')
      .in('id', employeeIds);
    if (!res.error) return res;
    if ((res.error as any)?.code === '42703') {
      return supabase.from('tenants_employee').select('id, display_name, photo_url, photo').in('id', employeeIds);
    }
    return res;
  };

  const [empsRes, usersRes, firmsRes] = await Promise.all([
    fetchEmployeesWithPhones(),
    employeeIds.length
      ? supabase.from('users').select('employee_id, email').in('employee_id', employeeIds).not('email', 'is', null)
      : Promise.resolve({ data: [] as any[] }),
    firmIds.length
      ? supabase
          .from('firm_contacts')
          .select('id, name, email, second_email, user_email, phone, profile_image_url, firm_id, firms!firm_contacts_firm_id_fkey(id, name)')
          .in('id', firmIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const empById = new Map<number, any>();
  (empsRes as any).data?.forEach((e: any) => empById.set(Number(e.id), e));
  const emailByEmployeeId = new Map<number, string>();
  (usersRes as any).data?.forEach((u: any) => {
    const eid = Number(u.employee_id);
    if (Number.isFinite(eid) && eid > 0 && u.email) emailByEmployeeId.set(eid, String(u.email));
  });
  const firmById = new Map<string, any>();
  (firmsRes as any).data?.forEach((f: any) => firmById.set(String(f.id), f));

  let nextSyntheticId = -4000000;
  const allocId = (rowId: unknown): number => {
    if (rowId != null && /^\d+$/.test(String(rowId))) return -Number(rowId);
    return nextSyntheticId--;
  };

  const recipients: NotifyRecipient[] = [];

  for (const r of partData) {
    const rowKey = r.id != null ? String(r.id) : `idx-${recipients.length}`;

    if (r.employee_id != null) {
      const empId = Number(r.employee_id);
      const e = empById.get(empId);
      recipients.push({
        id: allocId(r.id),
        recipientKey: `staff-${rowKey}`,
        name: e?.display_name || `Staff #${empId}`,
        email: emailByEmployeeId.get(empId) || null,
        phone: e?.phone ? String(e.phone) : null,
        mobile: e?.mobile ? String(e.mobile) : null,
        country_id: null,
        isMain: false,
        source: 'staff',
        sourceLabel: 'Staff',
        imageUrl: e?.photo_url || e?.photo || null,
        employeeId: empId,
      });
    } else if (r.firm_contact_id) {
      const f = firmById.get(String(r.firm_contact_id));
      const firmObj = Array.isArray(f?.firms) ? f.firms[0] : f?.firms;
      const email = f?.email || f?.second_email || f?.user_email || null;
      recipients.push({
        id: allocId(r.id),
        recipientKey: `firm-${rowKey}`,
        name: f?.name || 'Firm contact',
        email: email ? String(email) : null,
        phone: f?.phone ? String(f.phone) : null,
        mobile: null,
        country_id: null,
        isMain: false,
        source: 'firm',
        sourceLabel: 'Firm Contact',
        imageUrl: f?.profile_image_url || null,
        subtitle: firmObj?.name ? String(firmObj.name) : null,
      });
    } else {
      const name = String(r.free_name || '').trim() || 'External participant';
      recipients.push({
        id: allocId(r.id),
        recipientKey: `ext-${rowKey}`,
        name,
        email: r.free_email ? String(r.free_email) : null,
        phone: r.free_phone ? String(r.free_phone) : null,
        mobile: null,
        country_id: null,
        isMain: false,
        source: 'external',
        sourceLabel: 'External',
      });
    }
  }

  return recipients;
}
