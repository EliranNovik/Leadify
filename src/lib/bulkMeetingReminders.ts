/**
 * Bulk meeting reminders — the Calendar list view selects several lead meetings at once and
 * sends each lead its reminder over WhatsApp and Outlook in a single run.
 *
 * Unlike MeetingTab / MeetingNotifyControls, nothing here is picked by hand: the template
 * language comes from the lead itself and every contact with a phone / email is notified.
 * Reminder templates only exist in Hebrew and English, so a lead in any other language
 * (Russian included) is reminded in English.
 */

import { buildApiUrl } from './api';
import { convertBodyToHtml } from './emailBodyHtml';
import { replaceEmailTemplateParams } from './emailTemplateParams';
import {
  fetchEmailTemplatesAutomationCache,
  fetchMiscEmailTemplatesByIds,
  parseStoredEmailTemplateContent,
  resolveMeetingEmailTemplateIdsForNotify,
  type EmailAutomationCache,
} from './emailTemplatesAutomation';
import { sendEmail } from './graph';
import { resolveMeetingJoinLink } from './meetingJoinLink';
import {
  isPhysicalMeetingLocation,
  normalizeMeetingLocationRow,
  pickTenantMeetingLocationAddress,
  preferEnglishMeetingTemplateLanguage,
  shouldIncludeMeetingJoinLink,
} from './meetingLocationUtils';
import { fetchLeadContacts } from './contactHelpers';
import {
  fetchInternalMeetingWhatsAppTemplateNames,
  fillWhatsAppTemplateContent,
  formatMeetingDateForMessage,
  generateMeetingWhatsAppTemplateParameters,
  hasValidLeadId,
  isLegacyNotifyLead,
  normalizeLeadIdForContacts,
  normalizeLeadIdForWhatsAppBackend,
  selectReminderWhatsAppTemplate,
  type WhatsAppReminderTemplateRow,
} from './meetingWhatsAppNotify';
import { recordMeetingReminderSends, type MeetingReminderSendInput } from './meetingReminderSends';
import { saveOutgoingEmailRecord } from './saveOutgoingEmailRecord';
import { supabase } from './supabase';

export const HEBREW_LANGUAGE_ID = 2;

export type BulkReminderLanguage = 'en' | 'he';

export type BulkReminderChannel = 'whatsapp' | 'email';

export type BulkReminderLead = {
  id: string | number;
  name?: string | null;
  lead_number?: string | null;
  lead_type?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  language?: string | null;
  language_id?: number | null;
};

/** A calendar row flattened into just what the two senders need. */
export type BulkReminderTarget = {
  /** Calendar row id — also the selection key. Legacy rows look like `legacy_1234`. */
  rowId: string;
  /** meetings.id, or null for legacy rows that live in leads_lead. */
  dbMeetingId: number | null;
  calendarType: string;
  /** yyyy-mm-dd */
  date: string;
  /** HH:mm */
  time: string;
  location: string | number | null;
  manualAddress: string | null;
  customAddress: string | null;
  customLink: string | null;
  teamsLink: string | null;
  lead: BulkReminderLead;
  language: BulkReminderLanguage;
};

export type BulkReminderChannelStatus = 'sent' | 'partial' | 'failed' | 'skipped';

export type BulkReminderChannelResult = {
  status: BulkReminderChannelStatus;
  /** Phone numbers / email addresses that were successfully notified. */
  recipients: string[];
  reason?: string;
};

export type BulkReminderTargetResult = {
  rowId: string;
  leadName: string;
  leadNumber: string | null;
  language: BulkReminderLanguage;
  whatsapp: BulkReminderChannelResult;
  email: BulkReminderChannelResult;
};

export type BulkReminderProgress = {
  completed: number;
  total: number;
  /** The row being worked on right now, or null once the run is done. */
  current: BulkReminderTarget | null;
  results: BulkReminderTargetResult[];
};

export type BulkReminderSummary = {
  total: number;
  whatsappSent: number;
  whatsappRecipients: number;
  whatsappFailed: number;
  emailSent: number;
  emailRecipients: number;
  emailFailed: number;
  /** Rows where neither channel delivered anything. */
  fullyFailed: number;
};

type MeetingLocationRow = {
  id: number | string;
  name?: string | null;
  default_link?: string | null;
  address?: string | null;
  address_en?: string | null;
  is_physical_location?: unknown;
  is_phisical_location?: unknown;
};

export type BulkReminderContext = {
  locations: MeetingLocationRow[];
  whatsappTemplates: WhatsAppReminderTemplateRow[];
  emailCache: EmailAutomationCache | null;
  /** Reminder email template per row, already parsed to plain text. Missing rows cannot be emailed. */
  emailTemplateByRow: Map<string, { content: string; name: string | null }>;
  senderName: string;
  senderEmail: string;
};

const skipped = (reason: string): BulkReminderChannelResult => ({
  status: 'skipped',
  recipients: [],
  reason,
});

const failed = (reason: string): BulkReminderChannelResult => ({
  status: 'failed',
  recipients: [],
  reason,
});

const isUsableContactValue = (value: string | null | undefined): boolean => {
  const trimmed = (value ?? '').trim();
  return trimmed !== '' && trimmed !== '---' && trimmed !== '--';
};

/**
 * The lead's own language decides the template. Hebrew leads are matched on language_id first
 * because the joined language name is a display string that varies by tenant.
 */
export function resolveReminderLanguageForLead(lead: BulkReminderLead): BulkReminderLanguage {
  const languageId = lead.language_id;
  if (languageId != null && Number(languageId) === HEBREW_LANGUAGE_ID) return 'he';

  const name = (lead.language ?? '').toLowerCase();
  if (name.includes('hebrew') || name.includes('עברית')) return 'he';

  return 'en';
}

/**
 * Internal / staff meetings are excluded: they have no lead to take a language or contacts from,
 * and they use a different family of templates.
 */
export function isBulkReminderEligibleMeeting(meeting: {
  calendar_type?: string | null;
  meeting_date?: string | null;
  lead?: { id?: string | number; isStaffMeeting?: boolean } | null;
}): boolean {
  const calendarType = String(meeting.calendar_type ?? '').trim();
  if (calendarType === 'staff' || calendarType === 'recruitment') return false;
  if (!meeting.meeting_date) return false;

  const lead = meeting.lead;
  if (!lead || lead.id == null || String(lead.id).trim() === '') return false;
  return hasValidLeadId(lead);
}

/** Flattens a raw CalendarPage meeting row. Returns null when the row cannot be reminded. */
export function buildBulkReminderTarget(meeting: any): BulkReminderTarget | null {
  if (!isBulkReminderEligibleMeeting(meeting)) return null;

  const lead = meeting.lead;
  const numericMeetingId = Number(meeting.id);
  const bulkLead: BulkReminderLead = {
    id: lead.id,
    name: lead.name ?? meeting.name ?? null,
    lead_number: lead.lead_number ?? meeting.lead_number ?? null,
    lead_type: lead.lead_type ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    mobile: lead.mobile ?? null,
    language: lead.language ?? null,
    language_id: lead.language_id ?? null,
  };

  return {
    rowId: String(meeting.id),
    dbMeetingId: Number.isFinite(numericMeetingId) && numericMeetingId > 0 ? numericMeetingId : null,
    calendarType: String(meeting.calendar_type ?? '').trim(),
    date: String(meeting.meeting_date ?? '').trim(),
    time: String(meeting.meeting_time ?? '').slice(0, 5),
    location: meeting.meeting_location ?? meeting.location ?? null,
    manualAddress: meeting.manual_address ?? null,
    customAddress: meeting.custom_address ?? null,
    customLink: meeting.custom_link ?? null,
    teamsLink: meeting.teams_meeting_url ?? null,
    lead: bulkLead,
    language: resolveReminderLanguageForLead(bulkLead),
  };
}

export function buildBulkReminderTargets(meetings: any[]): BulkReminderTarget[] {
  return (meetings || [])
    .map((meeting) => buildBulkReminderTarget(meeting))
    .filter((target): target is BulkReminderTarget => target !== null);
}

export function summarizeBulkReminderResults(results: BulkReminderTargetResult[]): BulkReminderSummary {
  const summary: BulkReminderSummary = {
    total: results.length,
    whatsappSent: 0,
    whatsappRecipients: 0,
    whatsappFailed: 0,
    emailSent: 0,
    emailRecipients: 0,
    emailFailed: 0,
    fullyFailed: 0,
  };

  for (const result of results) {
    if (result.whatsapp.status === 'sent' || result.whatsapp.status === 'partial') {
      summary.whatsappSent += 1;
      summary.whatsappRecipients += result.whatsapp.recipients.length;
    } else if (result.whatsapp.status === 'failed') {
      summary.whatsappFailed += 1;
    }

    if (result.email.status === 'sent' || result.email.status === 'partial') {
      summary.emailSent += 1;
      summary.emailRecipients += result.email.recipients.length;
    } else if (result.email.status === 'failed') {
      summary.emailFailed += 1;
    }

    const whatsappDelivered = result.whatsapp.recipients.length > 0;
    const emailDelivered = result.email.recipients.length > 0;
    if (!whatsappDelivered && !emailDelivered) summary.fullyFailed += 1;
  }

  return summary;
}

/** Rows that have no reminder email template configured for their language. */
export function findTargetsMissingEmailTemplate(
  targets: BulkReminderTarget[],
  context: BulkReminderContext,
): BulkReminderTarget[] {
  return targets.filter((target) => !context.emailTemplateByRow.has(target.rowId));
}

const toMeetingForTemplateResolution = (target: BulkReminderTarget) => ({
  calendar_type: target.calendarType,
  location: target.location,
});

async function fetchSenderIdentity(): Promise<{ senderName: string; senderEmail: string }> {
  const fallback = { senderName: 'You', senderEmail: '' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return fallback;

  const { data: userRow, error } = await supabase
    .from('users')
    .select('full_name, email, employee_id, tenants_employee!employee_id(display_name)')
    .eq('auth_id', user.id)
    .single();

  if (error || !userRow) return { senderName: fallback.senderName, senderEmail: user.email ?? '' };

  const employee = Array.isArray(userRow.tenants_employee)
    ? userRow.tenants_employee[0]
    : userRow.tenants_employee;

  return {
    senderName: (employee as any)?.display_name || userRow.full_name || fallback.senderName,
    senderEmail: userRow.email || user.email || '',
  };
}

/**
 * Loads everything the whole batch shares — locations, templates and the sender identity — so the
 * per-lead sends do no repeated lookups. Also tells the caller, up front, which rows have no
 * email template so the drawer can warn before anything is sent.
 */
export async function loadBulkReminderContext(
  targets: BulkReminderTarget[],
  channels: BulkReminderChannel[],
): Promise<BulkReminderContext> {
  const wantsEmail = channels.includes('email');
  const wantsWhatsApp = channels.includes('whatsapp');

  const [locationsRes, templatesRes, emailCache, identity] = await Promise.all([
    supabase
      .from('tenants_meetinglocation')
      .select('id, name, default_link, address, address_en, order, is_active, is_physical_location')
      .order('order', { ascending: true }),
    wantsWhatsApp
      ? supabase
          .from('whatsapp_templates_v2')
          .select('id, name, language, content, params, param_mapping')
          .in('name', fetchInternalMeetingWhatsAppTemplateNames())
          .eq('active', true)
      : Promise.resolve({ data: [] as any[], error: null }),
    wantsEmail ? fetchEmailTemplatesAutomationCache() : Promise.resolve(null),
    fetchSenderIdentity(),
  ]);

  const locations: MeetingLocationRow[] = (locationsRes.data || []).map((loc: any) =>
    normalizeMeetingLocationRow(loc),
  );

  const emailTemplateByRow = new Map<string, { content: string; name: string | null }>();

  if (wantsEmail && emailCache) {
    const templateIdByRow = new Map<string, number>();
    for (const target of targets) {
      const ids = resolveMeetingEmailTemplateIdsForNotify(
        emailCache,
        toMeetingForTemplateResolution(target),
        locations,
        'reminder',
      );
      const templateId = ids[target.language];
      if (templateId != null && Number.isFinite(templateId)) {
        templateIdByRow.set(target.rowId, templateId);
      }
    }

    const templatesById = await fetchMiscEmailTemplatesByIds(Array.from(templateIdByRow.values()));
    templateIdByRow.forEach((templateId, rowId) => {
      const row = templatesById.get(templateId);
      if (row?.content) {
        emailTemplateByRow.set(rowId, {
          content: parseStoredEmailTemplateContent(row.content),
          name: row.name || null,
        });
      }
    });
  }

  return {
    locations,
    whatsappTemplates: (templatesRes.data || []) as WhatsAppReminderTemplateRow[],
    emailCache,
    emailTemplateByRow,
    senderName: identity.senderName,
    senderEmail: identity.senderEmail,
  };
}

const findLocationRow = (
  locations: MeetingLocationRow[],
  idOrName: string | number | null | undefined,
): MeetingLocationRow | undefined => {
  if (idOrName == null || idOrName === '' || idOrName === '---' || idOrName === 'Not specified') {
    return undefined;
  }
  const needle = String(idOrName).trim();
  return (
    locations.find((loc) => String(loc.id) === needle) ||
    locations.find((loc) => loc.name != null && String(loc.name).trim() === needle) ||
    locations.find(
      (loc) => loc.name != null && String(loc.name).trim().toLowerCase() === needle.toLowerCase(),
    )
  );
};

const getLocationName = (
  locations: MeetingLocationRow[],
  idOrName: string | number | null | undefined,
): string => {
  if (!idOrName || idOrName === '---' || idOrName === 'Not specified') return 'Not specified';
  return findLocationRow(locations, idOrName)?.name ?? String(idOrName);
};

/** Mirrors MeetingNotifyControls: custom address wins, then a physical location's address, then its name. */
const getLocationTextForTemplate = (
  target: BulkReminderTarget,
  locations: MeetingLocationRow[],
  preferEnglish: boolean,
): string => {
  const custom = target.customAddress?.trim();
  if (custom) return custom;

  const row = findLocationRow(locations, target.location);
  const name = getLocationName(locations, target.location);
  if (row && isPhysicalMeetingLocation(row)) {
    const address = pickTenantMeetingLocationAddress(row, preferEnglish);
    if (address) return address;
  }
  return name;
};

type ReminderRecipient = {
  name: string;
  email: string | null;
  phone: string | null;
  contactId: number | null;
};

async function loadReminderRecipients(lead: BulkReminderLead): Promise<ReminderRecipient[]> {
  const recipients: ReminderRecipient[] = [];

  try {
    const contacts = await fetchLeadContacts(normalizeLeadIdForContacts(lead), isLegacyNotifyLead(lead));
    for (const contact of contacts) {
      const phone = isUsableContactValue(contact.phone)
        ? contact.phone!.trim()
        : isUsableContactValue(contact.mobile)
          ? contact.mobile!.trim()
          : null;
      recipients.push({
        name: contact.name || lead.name || 'Client',
        email: isUsableContactValue(contact.email) ? contact.email!.trim() : null,
        phone,
        contactId: contact.id > 0 ? contact.id : null,
      });
    }
  } catch (error) {
    console.error('loadReminderRecipients: failed to load lead contacts', error);
  }

  // Leads with no contact rows still have a phone / email on the lead itself.
  const hasEmail = recipients.some((r) => r.email);
  const hasPhone = recipients.some((r) => r.phone);
  if (!hasEmail || !hasPhone) {
    const leadPhone = isUsableContactValue(lead.phone)
      ? lead.phone!.trim()
      : isUsableContactValue(lead.mobile)
        ? lead.mobile!.trim()
        : null;
    const leadEmail = isUsableContactValue(lead.email) ? lead.email!.trim() : null;
    if ((!hasEmail && leadEmail) || (!hasPhone && leadPhone)) {
      recipients.push({
        name: lead.name || 'Client',
        email: hasEmail ? null : leadEmail,
        phone: hasPhone ? null : leadPhone,
        contactId: null,
      });
    }
  }

  return recipients;
}

async function sendTargetEmailReminder(
  target: BulkReminderTarget,
  recipients: ReminderRecipient[],
  context: BulkReminderContext,
  accessToken: string,
): Promise<BulkReminderChannelResult> {
  const template = context.emailTemplateByRow.get(target.rowId);
  if (!template) {
    return failed(
      `No ${target.language === 'he' ? 'Hebrew' : 'English'} reminder email template is configured for this meeting's location`,
    );
  }

  const addresses = Array.from(
    new Set(recipients.map((r) => r.email).filter((email): email is string => Boolean(email))),
  );
  if (addresses.length === 0) return skipped('No email address on the lead or its contacts');

  const formattedDate = formatMeetingDateForMessage(target.date);
  const locationName = getLocationName(context.locations, target.location);
  const locationRow = findLocationRow(context.locations, target.location);
  const joinLinkRaw = resolveMeetingJoinLink(
    {
      link: target.teamsLink,
      custom_link: target.customLink,
      location: target.location,
    },
    context.locations,
  );
  const joinLink = shouldIncludeMeetingJoinLink(locationRow, locationName) ? joinLinkRaw : '';

  const primaryRecipient = recipients.find((r) => r.email === addresses[0]);
  const recipientName = primaryRecipient?.name || target.lead.name || 'Client';
  const legacyLead = isLegacyNotifyLead(target.lead);
  const legacyId = legacyLead
    ? (() => {
        const numeric = parseInt(String(target.lead.id).replace(/[^0-9]/g, ''), 10);
        return Number.isFinite(numeric) ? numeric : null;
      })()
    : null;

  const body = await replaceEmailTemplateParams(template.content, {
    clientId: legacyLead ? (legacyId?.toString() ?? null) : String(target.lead.id),
    legacyId,
    clientName: target.lead.name || recipientName,
    contactName: recipientName,
    leadNumber: target.lead.lead_number || null,
    leadType: target.lead.lead_type || null,
    meetingDate: formattedDate,
    meetingTime: target.time,
    meetingLocationRaw: String(target.location ?? '').trim() || null,
    meetingId: target.dbMeetingId,
    meetingLink: joinLink || null,
    templateLanguage: target.language,
    meetingAddress: target.manualAddress?.trim() || target.customAddress?.trim() || undefined,
  });

  const htmlBody = convertBodyToHtml(body);
  const subject = template.name || `Meeting Reminder - ${formattedDate}`;

  await sendEmail(accessToken, {
    to: addresses,
    subject,
    body: htmlBody,
    skipSignature: true,
  });

  try {
    await saveOutgoingEmailRecord({
      client: { id: target.lead.id, lead_type: target.lead.lead_type || undefined },
      subject,
      htmlBody,
      senderName: context.senderName,
      senderEmail: context.senderEmail || 'noreply@lawoffice.org.il',
      recipientList: addresses,
      contactId: primaryRecipient?.contactId ?? null,
      sentAt: new Date(),
    });
  } catch (error) {
    console.error('sendTargetEmailReminder: email sent but the CRM record failed to save', error);
  }

  return { status: 'sent', recipients: addresses };
}

async function sendTargetWhatsAppReminder(
  target: BulkReminderTarget,
  recipients: ReminderRecipient[],
  context: BulkReminderContext,
): Promise<BulkReminderChannelResult> {
  const template = selectReminderWhatsAppTemplate(context.whatsappTemplates, 'reminder', target.language);
  if (!template) {
    return failed(
      `No ${target.language === 'he' ? 'Hebrew' : 'English'} "reminder_of_a_meeting" WhatsApp template is active`,
    );
  }

  const phoneRecipients = recipients.filter((r) => r.phone);
  const seenPhones = new Set<string>();
  const uniqueRecipients = phoneRecipients.filter((r) => {
    if (seenPhones.has(r.phone!)) return false;
    seenPhones.add(r.phone!);
    return true;
  });
  if (uniqueRecipients.length === 0) return skipped('No phone number on the lead or its contacts');

  const locationName = getLocationName(context.locations, target.location);
  const locationRow = findLocationRow(context.locations, target.location);
  const joinLinkRaw = resolveMeetingJoinLink(
    {
      link: target.teamsLink,
      custom_link: target.customLink,
      location: target.location,
    },
    context.locations,
  );
  const paramCtx = {
    formattedDate: formatMeetingDateForMessage(target.date),
    formattedTime: target.time,
    locationName,
    locationTextForTemplate: getLocationTextForTemplate(
      target,
      context.locations,
      preferEnglishMeetingTemplateLanguage(target.language),
    ),
    meetingLocationRaw: String(target.location ?? '').trim(),
    manualAddress: target.manualAddress?.trim() ?? '',
    meetingId: target.dbMeetingId,
    joinLinkForTemplate: shouldIncludeMeetingJoinLink(locationRow, locationName) ? joinLinkRaw : '',
    templateLanguage: target.language,
  };

  const paramCount = Number(template.params) || 0;
  const delivered: string[] = [];
  const errors: string[] = [];

  for (const recipient of uniqueRecipients) {
    const phoneNumber = recipient.phone!;
    try {
      let templateParameters: Array<{ type: string; text: string }> = [];
      if (paramCount > 0) {
        templateParameters = await generateMeetingWhatsAppTemplateParameters(
          template,
          { ...target.lead },
          recipient.contactId,
          { ...paramCtx, recipientName: recipient.name },
          { leadlessStaff: false },
        );
        if (templateParameters.length === 0) {
          errors.push(`${phoneNumber}: could not build template parameters`);
          continue;
        }
      }

      const filledContent = fillWhatsAppTemplateContent(template.content || '', templateParameters);
      const payload: Record<string, unknown> = {
        leadId: normalizeLeadIdForWhatsAppBackend(target.lead),
        phoneNumber,
        sender_name: context.senderName,
        isTemplate: true,
        templateId: template.id,
        templateName: template.name,
        templateLanguage: template.language || target.language,
        contactId: recipient.contactId,
        message: paramCount > 0 ? filledContent || 'Template sent' : template.content || 'Template sent',
      };
      if (paramCount > 0) payload.templateParameters = templateParameters;

      const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);

      if (response.ok) {
        delivered.push(phoneNumber);
        continue;
      }

      const message =
        result?.code === 'RE_ENGAGEMENT_REQUIRED'
          ? 'WhatsApp 24-hour rule: only template messages may be sent'
          : result?.error || `request failed (${response.status})`;
      errors.push(`${phoneNumber}: ${message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${phoneNumber}: ${message}`);
    }
  }

  if (delivered.length === 0) {
    return failed(errors.join('; ') || 'WhatsApp send failed');
  }
  return {
    status: errors.length > 0 ? 'partial' : 'sent',
    recipients: delivered,
    reason: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

/**
 * Sends the reminders one lead at a time, reporting progress as it goes. Never throws: a lead that
 * fails is recorded in its result row so the confirmation screen can show exactly what happened.
 */
export async function sendBulkMeetingReminders(input: {
  targets: BulkReminderTarget[];
  channels: BulkReminderChannel[];
  context: BulkReminderContext;
  /** Microsoft Graph token. Required only when the email channel is on. */
  accessToken?: string | null;
  onProgress?: (progress: BulkReminderProgress) => void;
}): Promise<BulkReminderTargetResult[]> {
  const { targets, channels, context, accessToken, onProgress } = input;
  const wantsEmail = channels.includes('email');
  const wantsWhatsApp = channels.includes('whatsapp');
  const results: BulkReminderTargetResult[] = [];

  for (const target of targets) {
    onProgress?.({ completed: results.length, total: targets.length, current: target, results: [...results] });

    const recipients = await loadReminderRecipients(target.lead);

    let whatsappResult: BulkReminderChannelResult = skipped('WhatsApp was not selected');
    if (wantsWhatsApp) {
      try {
        whatsappResult = await sendTargetWhatsAppReminder(target, recipients, context);
      } catch (error) {
        whatsappResult = failed(error instanceof Error ? error.message : String(error));
      }
    }

    let emailResult: BulkReminderChannelResult = skipped('Email was not selected');
    if (wantsEmail) {
      if (!accessToken) {
        emailResult = failed('Microsoft sign-in is required to send email');
      } else {
        try {
          emailResult = await sendTargetEmailReminder(target, recipients, context, accessToken);
        } catch (error) {
          emailResult = failed(error instanceof Error ? error.message : String(error));
        }
      }
    }

    results.push({
      rowId: target.rowId,
      leadName: target.lead.name || 'Client',
      leadNumber: target.lead.lead_number ?? null,
      language: target.language,
      whatsapp: whatsappResult,
      email: emailResult,
    });

    // Only channels that reached somebody are logged, so the Calendar hook means "delivered".
    const sends: MeetingReminderSendInput[] = [];
    if (whatsappResult.recipients.length > 0) {
      sends.push({
        rowKey: target.rowId,
        channel: 'whatsapp',
        language: target.language,
        recipientCount: whatsappResult.recipients.length,
      });
    }
    if (emailResult.recipients.length > 0) {
      sends.push({
        rowKey: target.rowId,
        channel: 'email',
        language: target.language,
        recipientCount: emailResult.recipients.length,
      });
    }
    await recordMeetingReminderSends(sends);
  }

  onProgress?.({ completed: results.length, total: targets.length, current: null, results: [...results] });
  return results;
}
