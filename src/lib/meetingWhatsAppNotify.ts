/**
 * WhatsApp reminder templates for meetings — shared by MeetingTab (external / staff+lead)
 * and Calendar MeetingNotifyControls (staff calendar, with or without lead).
 */

export type WhatsAppReminderTemplateRow = {
  id: number;
  name: string;
  language: string;
  content: string;
  params?: string;
  param_mapping?: unknown;
};

export type WhatsAppReminderType = 'reminder' | 'missed_appointment';

/** Loaded for internal / external (staff) meeting notify — see fetchInternalMeetingWhatsAppTemplateNames(). */
export const INTERNAL_MEETING_WHATSAPP_TEMPLATE_NAME_CANDIDATES: Record<
  WhatsAppReminderType,
  string[]
> = {
  reminder: [
    'reminder_of_external_meeting',
    'external_meeting_reminder',
    'reminder_external_meeting',
  ],
  missed_appointment: [
    'missed_appointment_external',
    'external_meeting_missed_appointment',
    'external_missed_appointment',
  ],
};

export const CLIENT_MEETING_WHATSAPP_TEMPLATE_NAME_CANDIDATES: Record<
  WhatsAppReminderType,
  string[]
> = {
  reminder: ['reminder_of_a_meeting'],
  missed_appointment: ['missed_appointment'],
};

export function fetchInternalMeetingWhatsAppTemplateNames(): string[] {
  const names = new Set<string>();
  Object.values(INTERNAL_MEETING_WHATSAPP_TEMPLATE_NAME_CANDIDATES).forEach((list) =>
    list.forEach((n) => names.add(n)),
  );
  Object.values(CLIENT_MEETING_WHATSAPP_TEMPLATE_NAME_CANDIDATES).forEach((list) =>
    list.forEach((n) => names.add(n)),
  );
  return Array.from(names);
}

export function isStaffOrInternalMeeting(meeting: { calendar_type?: string } | null | undefined): boolean {
  return meeting?.calendar_type === 'staff';
}

export type MeetingWhatsAppParamContext = {
  formattedDate: string;
  formattedTime: string;
  /** Display name from tenants_meetinglocation (MeetingTab clientForParams.meeting_location). */
  locationName: string;
  /** Resolved address / label for templates (physical address, custom_address, etc.). */
  locationTextForTemplate: string;
  /** Raw meetings.meeting_location for the meeting being notified. */
  meetingLocationRaw?: string;
  /** meetings.manual_address for the meeting being notified. */
  manualAddress?: string;
  /** meetings.id — used when fetching location / manual_address from DB. */
  meetingId?: number | string | null;
  joinLinkForTemplate: string;
  recipientName?: string | null;
  /** en → tenants_meetinglocation.address_en when set */
  templateLanguage?: string | null;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeLanguageCode(lang: string | null | undefined): string {
  if (!lang) return '';
  return lang.split('_')[0].toLowerCase();
}

/** True when client.id is a CRM lead (legacy numeric, legacy_ prefix, or new-lead UUID). */
export function hasValidLeadId(client: {
  id?: string | number;
  isStaffMeeting?: boolean;
}): boolean {
  if (client.isStaffMeeting || client.id === 'staff-meeting') return false;
  const idStr = String(client.id ?? '').trim();
  if (!idStr || idStr.startsWith('staff-')) return false;
  if (idStr.startsWith('legacy_')) {
    const n = parseInt(idStr.replace('legacy_', ''), 10);
    return Number.isFinite(n) && n > 0;
  }
  if (/^\d+$/.test(idStr)) return true;
  return UUID_REGEX.test(idStr);
}

/** Staff calendar row on Calendar with no linked lead — use meeting-scoped template params only. */
export function isLeadlessStaffCalendarNotify(
  meeting: { calendar_type?: string },
  client: { id?: string | number; isStaffMeeting?: boolean },
): boolean {
  return meeting.calendar_type === 'staff' && !hasValidLeadId(client);
}

function findTemplateByNameAndLanguage(
  reminderTemplates: WhatsAppReminderTemplateRow[],
  names: string[],
  targetLanguage: string,
): WhatsAppReminderTemplateRow | undefined {
  for (const name of names) {
    const found = reminderTemplates.find((t) => {
      const templateLangNormalized = normalizeLanguageCode(t.language);
      return t.name === name && templateLangNormalized === targetLanguage;
    });
    if (found) return found;
  }
  return undefined;
}

export function selectReminderWhatsAppTemplate(
  reminderTemplates: WhatsAppReminderTemplateRow[],
  type: WhatsAppReminderType,
  selectedLanguage: string,
  options?: { useExternalMeetingTemplates?: boolean },
): WhatsAppReminderTemplateRow | undefined {
  const targetLanguage = selectedLanguage.toLowerCase();
  const useExternal = options?.useExternalMeetingTemplates === true;

  const nameCandidates = useExternal
    ? [
        ...INTERNAL_MEETING_WHATSAPP_TEMPLATE_NAME_CANDIDATES[type],
        ...CLIENT_MEETING_WHATSAPP_TEMPLATE_NAME_CANDIDATES[type],
      ]
    : CLIENT_MEETING_WHATSAPP_TEMPLATE_NAME_CANDIDATES[type];

  const byName = findTemplateByNameAndLanguage(reminderTemplates, nameCandidates, targetLanguage);
  if (byName) return byName;

  if (!useExternal) {
    if (type === 'missed_appointment') {
      const templateIdMap: Record<string, number> = { en: 16, he: 15, ru: 15 };
      const byId = reminderTemplates.find((t) => t.id === templateIdMap[targetLanguage]);
      if (byId) return byId;
    } else {
      const templateIdMap: Record<string, number> = { he: 1, en: 2 };
      const byId = reminderTemplates.find((t) => t.id === templateIdMap[targetLanguage]);
      if (byId) return byId;
    }
  }

  return undefined;
}

export function buildLeadlessStaffTemplateClient(
  client: Record<string, unknown>,
  ctx: MeetingWhatsAppParamContext,
): Record<string, unknown> {
  const dateTimeParts = [ctx.formattedDate, ctx.formattedTime].filter(Boolean);
  const meetingDatetime =
    dateTimeParts.length >= 2
      ? `${ctx.formattedDate} at ${ctx.formattedTime}`
      : dateTimeParts[0] || '';

  return {
    ...client,
    id: 'staff-meeting',
    isStaffMeeting: true,
    name: ctx.recipientName?.trim() || client.name || 'Participant',
    templateRecipientName: ctx.recipientName?.trim() || client.name || 'Participant',
    meeting_date: ctx.formattedDate,
    meeting_time: ctx.formattedTime,
    meeting_datetime: meetingDatetime,
    meeting_location: ctx.locationTextForTemplate,
    meeting_location_raw: ctx.meetingLocationRaw ?? '',
    manual_address: ctx.manualAddress ?? '',
    currentMeetingId: ctx.meetingId ?? null,
    meeting_link: ctx.joinLinkForTemplate,
  };
}

/**
 * Build WhatsApp template parameters — mirrors MeetingTab.handleSendWhatsAppReminder.
 * For external meetings tied to a lead, uses lead-based resolution + current-meeting overrides.
 * For leadless staff calendar meetings, fills all meeting fields from ctx.
 */
export async function generateMeetingWhatsAppTemplateParameters(
  selectedTemplate: { id: number; name: string; params?: string },
  client: Record<string, unknown>,
  contactId: number | null | undefined,
  ctx: MeetingWhatsAppParamContext,
  options: { leadlessStaff: boolean },
): Promise<Array<{ type: string; text: string }>> {
  const paramCount = Number(selectedTemplate.params) || 0;
  if (paramCount <= 0) return [];

  const { getTemplateParamDefinitions, generateParamsFromDefinitions } = await import(
    './whatsappTemplateParamMapping'
  );
  const { generateTemplateParameters } = await import('./whatsappTemplateParams');

  const meetingFieldOverrides = {
    meeting_date: ctx.formattedDate,
    meeting_time: ctx.formattedTime,
    meeting_location: ctx.locationTextForTemplate?.trim() || ctx.locationName,
    meeting_location_raw: ctx.meetingLocationRaw ?? '',
    manual_address: ctx.manualAddress ?? '',
    currentMeetingId: ctx.meetingId ?? null,
    templateLanguage: ctx.templateLanguage ?? null,
    preferEnglishMeetingLocation: normalizeLanguageCode(ctx.templateLanguage) === 'en',
  };

  const clientForParams = options.leadlessStaff
    ? buildLeadlessStaffTemplateClient(client, ctx)
    : {
        ...client,
        ...meetingFieldOverrides,
      };

  const paramDefinitions = await getTemplateParamDefinitions(selectedTemplate.id, selectedTemplate.name);

  let templateParameters: Array<{ type: string; text: string }> = [];
  if (paramDefinitions.length > 0) {
    templateParameters = await generateParamsFromDefinitions(
      paramDefinitions,
      clientForParams,
      contactId ?? null,
    );
  } else {
    templateParameters = await generateTemplateParameters(paramCount, clientForParams, contactId ?? null);
  }

  if (paramDefinitions.length > 0) {
    paramDefinitions.forEach((param, index) => {
      if (!templateParameters[index]) return;
      let paramValue = templateParameters[index].text || '';

      switch (param.type) {
        case 'meeting_date':
          paramValue = ctx.formattedDate || '';
          break;
        case 'meeting_time':
          paramValue = ctx.formattedTime || '';
          break;
        case 'meeting_location':
          paramValue = ctx.locationTextForTemplate?.trim()
            ? ctx.locationTextForTemplate
            : templateParameters[index].text || '';
          break;
        case 'location':
          paramValue =
            (ctx.meetingLocationRaw ?? '').trim() ||
            templateParameters[index].text ||
            '';
          break;
        case 'manual_address':
          paramValue =
            (ctx.manualAddress ?? '').trim() ||
            templateParameters[index].text ||
            '';
          break;
        case 'meeting_link':
          paramValue = options.leadlessStaff
            ? ctx.joinLinkForTemplate
            : templateParameters[index].text || '';
          break;
        default:
          paramValue = templateParameters[index].text || '';
      }

      templateParameters[index].text = paramValue.trim();
    });
  }

  while (templateParameters.length < paramCount) {
    templateParameters.push({ type: 'text', text: '' });
  }

  return templateParameters.map((param) => ({
    type: 'text',
    text: (param.text || '').trim(),
  }));
}

export function fillWhatsAppTemplateContent(
  templateContent: string,
  templateParameters: Array<{ text?: string }>,
): string {
  let filled = templateContent || '';
  templateParameters.forEach((param, index) => {
    if (param?.text) {
      filled = filled.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), param.text);
    }
  });
  return filled;
}
