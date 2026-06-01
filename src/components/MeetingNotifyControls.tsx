import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { useMsal } from '@azure/msal-react';
import { EnvelopeIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { buildApiUrl } from '../lib/api';
import { fetchLeadContacts } from '../lib/contactHelpers';
import {
  fetchEmailTemplatesAutomationCache,
  fetchMiscEmailTemplatesByIds,
  inferInvitationEmailTypeFromLocationName,
  isStaffOrInternalMeeting,
  resolveMeetingEmailTemplateIdsForNotify,
  resolveMeetingLocationId,
  type EmailAutomationCache,
  type MeetingEmailNotifyType,
} from '../lib/emailTemplatesAutomation';
import { replaceEmailTemplateParams } from '../lib/emailTemplateParams';
import { createCalendarEventWithAttendee, sendEmail } from '../lib/graph';
import { generateICSFromDateTime } from '../lib/icsGenerator';
import { getLinkType, resolveMeetingJoinLink } from '../lib/meetingJoinLink';
import {
  fetchMeetingParticipantContacts,
  getNotifyRecipientPhone,
  getNotifySourceBadgeClass,
  mergeNotifyRecipients,
  type NotifyRecipient,
  type NotifyRecipientSource,
} from '../lib/meetingNotifyRecipients';
import {
  fetchInternalMeetingWhatsAppTemplateNames,
  fillWhatsAppTemplateContent,
  generateMeetingWhatsAppTemplateParameters,
  hasValidLeadId,
  isLeadlessStaffCalendarNotify,
  selectReminderWhatsAppTemplate,
} from '../lib/meetingWhatsAppNotify';
import {
  isPhysicalMeetingLocation,
  normalizeMeetingLocationRow,
  pickTenantMeetingLocationAddress,
  preferEnglishMeetingTemplateLanguage,
  shouldIncludeMeetingJoinLink,
} from '../lib/meetingLocationUtils';
import { loginRequest } from '../msalConfig';
import { saveOutgoingEmailRecord } from '../lib/saveOutgoingEmailRecord';
import { meetingInvitationEmailTemplate } from './Meetings';
import { supabase } from '../lib/supabase';

export type MeetingNotifyControlsMeeting = {
  id: number | string;
  date: string;
  time: string;
  location?: string | number | null;
  link?: string | null;
  brief?: string | null;
  calendar_type?: string;
  custom_link?: string | null;
  custom_address?: string | null;
  manual_address?: string | null;
};

export type MeetingNotifyControlsClient = {
  id: string | number;
  name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  lead_number?: string;
  lead_type?: string;
  language?: string;
  language_id?: number;
  /** Internal (staff) calendar meeting — not linked to a CRM lead */
  isStaffMeeting?: boolean;
};

type MeetingNotifyControlsProps = {
  meeting: MeetingNotifyControlsMeeting;
  client: MeetingNotifyControlsClient;
  dbMeetingId: number | null;
  variant?: 'toolbar' | 'sidebar';
  modalZIndexClass?: string;
  alwaysShow?: boolean;
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

type LoadedEmailTemplates = {
  en: { content: string | null; name: string | null } | null;
  he: { content: string | null; name: string | null } | null;
};

type WhatsAppTemplate = {
  id: number;
  language: string;
  content: string;
  name: string;
  params?: string;
  param_mapping?: any;
};

type EmailType = MeetingEmailNotifyType;
type WhatsAppReminderType = 'reminder' | 'missed_appointment';

export function OutlookIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#0078D4" d="M22 6.5v11c0 .83-.67 1.5-1.5 1.5H17V5h3.5c.83 0 1.5.67 1.5 1.5z" />
      <path fill="#0078D4" d="M16 5H4.5C3.67 5 3 5.67 3 6.5v11c0 .83.67 1.5 1.5 1.5H16V5z" />
      <path fill="#28A8EA" d="M15 12.5 8.5 7.25v10.5L15 12.5z" />
      <ellipse fill="#0078D4" cx="9.5" cy="12.5" rx="3.5" ry="4" />
    </svg>
  );
}

const isLegacyLead = (client: MeetingNotifyControlsClient): boolean =>
  client.lead_type === 'legacy' || String(client.id).startsWith('legacy_');

const resolveMeetingLocationTextForTemplate = (
  meeting: MeetingNotifyControlsMeeting,
  resolveRecord: (idOrName: string | number | null | undefined) => MeetingLocationRow | undefined,
  getName: (idOrName: string | number | null | undefined) => string,
  preferEnglish: boolean,
): string => {
  const custom = meeting.custom_address?.trim();
  if (custom) return custom;
  const locRow = resolveRecord(meeting.location);
  const name = getName(meeting.location);
  if (locRow && isPhysicalMeetingLocation(locRow)) {
    const addr = pickTenantMeetingLocationAddress(locRow, preferEnglish);
    if (addr) return addr;
  }
  return name;
};

const normalizeLeadIdForContacts = (client: MeetingNotifyControlsClient): string | number =>
  isLegacyLead(client)
    ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
    : client.id;

const normalizeLeadIdForWhatsAppBackend = (client: MeetingNotifyControlsClient): string | number =>
  isLegacyLead(client)
    ? (typeof client.id === 'string' ? client.id : `legacy_${client.id}`)
    : client.id;

const getInitials = (name: string | null | undefined): string => {
  if (!name) return '--';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

const sortNotifyRecipients = (items: NotifyRecipient[]) => {
  const sourceOrder: Record<NotifyRecipientSource, number> = {
    staff: 0,
    firm: 1,
    external: 2,
    lead: 3,
  };
  return [...items].sort((a, b) => {
    const orderDiff = sourceOrder[a.source] - sourceOrder[b.source];
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });
};

const containsRTL = (text?: string | null): boolean => {
  if (!text) return false;
  const textOnly = text.replace(/<[^>]*>/g, '');
  return /[\u0590-\u05FF]/.test(textOnly);
};

const linkifyPlainUrlsInEmailHtml = (html: string): string => {
  if (!html) return html;
  if (!/\bhttps?:\/\//i.test(html) && !/\bmailto:/i.test(html)) return html;

  const preserved: string[] = [];
  let s = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (block) => {
    const i = preserved.length;
    preserved.push(block);
    return `@@MEETING_NOTIFY_LINK_${i}@@`;
  });

  s = s
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part || part.startsWith('<')) return part;
      return part.replace(/\b(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+)/gi, (url) => {
        const safeHref = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      });
    })
    .join('');

  preserved.forEach((block, i) => {
    s = s.replace(`@@MEETING_NOTIFY_LINK_${i}@@`, block);
  });
  return s;
};

const parseTemplateContent = (rawContent: string | null | undefined): string => {
  if (!rawContent) return '';

  const sanitizeTemplateText = (text: string) =>
    text
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();

  const tryParseDelta = (input: string) => {
    try {
      const parsed = JSON.parse(input);
      const ops = parsed?.delta?.ops || parsed?.ops;
      if (Array.isArray(ops)) {
        return sanitizeTemplateText(ops.map((op: any) => (typeof op?.insert === 'string' ? op.insert : '')).join(''));
      }
    } catch {
      // ignore
    }
    return null;
  };

  const cleanHtml = (input: string) => {
    let text = input;
    const htmlMatch = text.match(/html\s*:\s*(.*)/is);
    if (htmlMatch) text = htmlMatch[1];
    text = text
      .replace(/^{?delta\s*:\s*\{.*?\},?/is, '')
      .replace(/^{|}$/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\r/g, '')
      .replace(/\\/g, '\\');
    return sanitizeTemplateText(text);
  };

  let text = tryParseDelta(rawContent);
  if (text !== null) return text;

  text = tryParseDelta(rawContent.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
  if (text !== null) return text;

  const normalised = rawContent.replace(/\\"/g, '"').replace(/\r/g, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const insertRegex = /"?insert"?\s*:\s*"([^"\n]*)"/g;
  const inserts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(normalised))) {
    inserts.push(match[1]);
  }
  if (inserts.length > 0) {
    return sanitizeTemplateText(inserts.join('').replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
  }

  return sanitizeTemplateText(cleanHtml(rawContent));
};

const formatDateForMessage = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return dateStr;
  return `${day}/${month}/${year}`;
};

const normalizeLanguageCode = (lang: string | null | undefined): string => {
  if (!lang) return '';
  return lang.split('_')[0].toLowerCase();
};

const isPastMeeting = (meeting: MeetingNotifyControlsMeeting): boolean => {
  if (!meeting.date) return false;
  const time = meeting.time ? meeting.time.substring(0, 5) : '23:59';
  const meetingTime = new Date(`${meeting.date}T${time}:00`);
  return !Number.isNaN(meetingTime.getTime()) && meetingTime < new Date();
};

const NotifyRecipientAvatar = ({ contact, size = 'sm' }: { contact: NotifyRecipient; size?: 'sm' | 'md' }) => {
  const [imageError, setImageError] = useState(false);
  const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-11 h-11 text-sm';
  const avatarBgClass =
    contact.source === 'firm'
      ? 'bg-fuchsia-100 text-fuchsia-700'
      : contact.source === 'external'
        ? 'bg-amber-100 text-amber-700'
        : contact.source === 'staff'
          ? 'bg-blue-100 text-blue-700'
          : 'bg-purple-100 text-purple-700';

  if (contact.imageUrl && !imageError) {
    return (
      <img
        src={contact.imageUrl}
        alt={contact.name}
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0 ring-1 ring-gray-200`}
        title={contact.name}
        onError={() => setImageError(true)}
      />
    );
  }

  return (
    <div className={`${sizeClasses} rounded-full flex items-center justify-center font-semibold flex-shrink-0 ring-1 ring-gray-200 ${avatarBgClass}`}>
      {getInitials(contact.name)}
    </div>
  );
};

export const MeetingNotifyControls: React.FC<MeetingNotifyControlsProps> = ({
  meeting,
  client,
  dbMeetingId,
  variant = 'sidebar',
  modalZIndexClass = 'z-[60]',
  alwaysShow = true,
}) => {
  const { instance } = useMsal();
  const notifyDropdownRef = useRef<HTMLDivElement>(null);
  const whatsAppDropdownRef = useRef<HTMLDivElement>(null);

  const [allMeetingLocations, setAllMeetingLocations] = useState<MeetingLocationRow[]>([]);
  const [emailAutomationCache, setEmailAutomationCache] = useState<EmailAutomationCache | null>(null);
  const [reminderTemplates, setReminderTemplates] = useState<WhatsAppTemplate[]>([]);

  const [showNotifyDropdown, setShowNotifyDropdown] = useState(false);
  const [showWhatsAppDropdown, setShowWhatsAppDropdown] = useState(false);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [showWhatsAppNotifyModal, setShowWhatsAppNotifyModal] = useState(false);

  const [contacts, setContacts] = useState<NotifyRecipient[]>([]);
  const [whatsAppContacts, setWhatsAppContacts] = useState<NotifyRecipient[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingWhatsAppContacts, setLoadingWhatsAppContacts] = useState(false);
  const [selectedEmailRecipientKeys, setSelectedEmailRecipientKeys] = useState<Set<string>>(new Set());
  const [selectedWhatsAppRecipientKeys, setSelectedWhatsAppRecipientKeys] = useState<Set<string>>(new Set());
  const [selectedEmailLanguage, setSelectedEmailLanguage] = useState<'en' | 'he'>('en');
  const [selectedLanguage, setSelectedLanguage] = useState<'he' | 'en' | 'ru'>('he');
  const [emailTemplates, setEmailTemplates] = useState<LoadedEmailTemplates>({ en: null, he: null });
  const [emailType, setEmailType] = useState<EmailType>('invitation');
  const [whatsAppReminderType, setWhatsAppReminderType] = useState<WhatsAppReminderType>('reminder');
  const [sendingEmailMeetingId, setSendingEmailMeetingId] = useState<number | string | null>(null);
  const [sendingWhatsAppMeetingId, setSendingWhatsAppMeetingId] = useState<number | string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchMeetingLocations = async () => {
      const { data, error } = await supabase
        .from('tenants_meetinglocation')
        .select('id, name, default_link, address, address_en, order, is_active, is_physical_location')
        .order('order', { ascending: true });

      if (!cancelled && !error && data) {
        setAllMeetingLocations(data.map((loc: any) => normalizeMeetingLocationRow(loc)));
      }
    };

    const fetchReminderTemplates = async () => {
      const { data, error } = await supabase
        .from('whatsapp_templates_v2')
        .select('id, name, language, content, params, param_mapping')
        .in('name', fetchInternalMeetingWhatsAppTemplateNames())
        .eq('active', true);

      if (!cancelled && !error && data) {
        setReminderTemplates(data as WhatsAppTemplate[]);
      } else if (error) {
        console.error('Error fetching reminder templates:', error);
      }
    };

    void fetchMeetingLocations();
    void fetchReminderTemplates();
    void fetchEmailTemplatesAutomationCache().then((cache) => {
      if (!cancelled) setEmailAutomationCache(cache);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (notifyDropdownRef.current && !notifyDropdownRef.current.contains(target)) {
        setShowNotifyDropdown(false);
      }
      if (whatsAppDropdownRef.current && !whatsAppDropdownRef.current.contains(target)) {
        setShowWhatsAppDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showNotifyModal) {
      setSelectedEmailRecipientKeys(new Set());
      return;
    }
    const keys = contacts
      .filter((c) => c.email && c.email !== '---')
      .map((c) => c.recipientKey);
    if (keys.length === 0 && client.email) {
      keys.push('client-primary-email');
    }
    setSelectedEmailRecipientKeys(new Set(keys));
  }, [showNotifyModal, contacts, client.email]);

  useEffect(() => {
    if (!showWhatsAppNotifyModal) {
      setSelectedWhatsAppRecipientKeys(new Set());
      return;
    }
    const keys = whatsAppContacts
      .filter((c) => getNotifyRecipientPhone(c))
      .map((c) => c.recipientKey);
    if (keys.length === 0) {
      const clientPhone = client.phone?.trim();
      const clientMobile = client.mobile?.trim();
      const hasClientPhone =
        (clientPhone && clientPhone !== '' && clientPhone !== '---') ||
        (clientMobile && clientMobile !== '' && clientMobile !== '---');
      if (hasClientPhone) keys.push('client-primary-phone');
    }
    setSelectedWhatsAppRecipientKeys(new Set(keys));
  }, [showWhatsAppNotifyModal, whatsAppContacts, client.phone, client.mobile]);

  const shouldRender = alwaysShow || !isPastMeeting(meeting);

  const resolveMeetingLocationRecord = (idOrName: string | number | null | undefined): MeetingLocationRow | undefined => {
    if (idOrName == null || idOrName === '' || idOrName === '---' || idOrName === 'Not specified') return undefined;
    const s = String(idOrName).trim();
    const byId = allMeetingLocations.find((loc) => String(loc.id) === s);
    if (byId) return byId;
    const byNameExact = allMeetingLocations.find((loc) => loc.name != null && String(loc.name).trim() === s);
    if (byNameExact) return byNameExact;
    return allMeetingLocations.find((loc) => loc.name != null && String(loc.name).trim().toLowerCase() === s.toLowerCase());
  };

  const getMeetingLocationName = (locationId: string | number | null | undefined) => {
    if (!locationId || locationId === '---' || locationId === 'Not specified') return 'Not specified';
    const location = resolveMeetingLocationRecord(locationId);
    return location?.name ?? String(locationId);
  };

  const meetingJoinLink = (currentMeeting: MeetingNotifyControlsMeeting) =>
    resolveMeetingJoinLink(currentMeeting, allMeetingLocations);

  const invitationTypeForMeeting = useMemo(() => {
    const rawLocation = String(meeting.location ?? '').trim();
    if (isStaffOrInternalMeeting(meeting) && rawLocation) {
      return inferInvitationEmailTypeFromLocationName(rawLocation);
    }
    const locationName = getMeetingLocationName(meeting.location);
    return inferInvitationEmailTypeFromLocationName(locationName);
  }, [allMeetingLocations, meeting.location, meeting.calendar_type]);

  const invitationLabel = useMemo(() => {
    switch (invitationTypeForMeeting) {
      case 'invitation_jlm':
        return 'Meeting Invitation JLM';
      case 'invitation_tlv_parking':
        return 'Meeting Invitation TLV + Parking';
      case 'invitation_tlv':
        return 'Meeting Invitation TLV';
      default:
        return 'Meeting Invitation';
    }
  }, [invitationTypeForMeeting]);

  const formatEmailBody = async (
    template: string,
    recipientName: string,
    context?: {
      client?: MeetingNotifyControlsClient;
      meeting?: MeetingNotifyControlsMeeting;
      meetingDate?: string;
      meetingTime?: string;
      meetingLink?: string;
      meetingId?: number | string | null;
      templateLanguage?: string | null;
    },
  ): Promise<string> => {
    if (!template) return '';

    let htmlBody = template;

    if (context?.client || context?.meeting) {
      const legacyLead = context.client ? isLegacyLead(context.client) : false;
      let clientId: string | number | null = context.client?.id || null;
      let legacyId: number | null = null;

      if (legacyLead && context.client?.id) {
        const numeric = parseInt(String(context.client.id).replace(/[^0-9]/g, ''), 10);
        legacyId = Number.isNaN(numeric) ? null : numeric;
        clientId = legacyId?.toString() || null;
      }

      htmlBody = await replaceEmailTemplateParams(template, {
        clientId,
        legacyId,
        clientName: context.client?.name || recipientName,
        contactName: recipientName,
        leadNumber: context.client?.lead_number || null,
        leadType: context.client?.lead_type || null,
        meetingDate: context.meetingDate || null,
        meetingTime: context.meetingTime || null,
        meetingLocationRaw: String(context.meeting?.location ?? '').trim() || null,
        meetingId: context.meetingId ?? context.meeting?.id ?? dbMeetingId ?? null,
        meetingLink: context.meetingLink || null,
        templateLanguage: context.templateLanguage ?? null,
        meetingAddress:
          context.meeting?.manual_address?.trim() ||
          context.meeting?.custom_address?.trim() ||
          undefined,
      });
    } else {
      htmlBody = template.replace(/\{\{name\}\}/g, recipientName).replace(/\{name\}/gi, recipientName);
    }

    const hasHtmlTags = /<[a-z][\s\S]*>/i.test(htmlBody);
    if (!hasHtmlTags) {
      htmlBody = htmlBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
    } else {
      htmlBody = htmlBody
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/(<br\s*\/?>|\n)/gi, '<br>')
        .replace(/\n/g, '<br>');
    }

    htmlBody = linkifyPlainUrlsInEmailHtml(htmlBody);

    if (containsRTL(htmlBody)) {
      return `<div dir="rtl" style="text-align: right; direction: rtl; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
    }
    return `<div dir="ltr" style="text-align: left; direction: ltr; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
  };

  const loadNotifyRecipients = async (): Promise<NotifyRecipient[]> => {
    let allContacts: NotifyRecipient[] = [];
    // Same as MeetingTab: lead contacts when a CRM lead exists; staff meetings also load participants.
    if (hasValidLeadId(client)) {
      const fetchedContacts = await fetchLeadContacts(normalizeLeadIdForContacts(client), isLegacyLead(client));
      allContacts = fetchedContacts.map((c) => ({
        ...c,
        recipientKey: `lead-${c.id}`,
        source: 'lead',
        sourceLabel: c.isMain ? 'Lead (Main)' : 'Lead Contact',
      }));
    }

    if (meeting.calendar_type === 'staff' && dbMeetingId != null) {
      const participantContacts = await fetchMeetingParticipantContacts(dbMeetingId);
      allContacts = mergeNotifyRecipients(allContacts, participantContacts);
    }

    return allContacts;
  };

  const handleNotifyClick = async (type: EmailType) => {
    setEmailType(type);
    setLoadingContacts(true);
    setShowNotifyDropdown(false);

    try {
      const allContacts = await loadNotifyRecipients();
      setContacts(allContacts);

      try {
        const cache = emailAutomationCache ?? (await fetchEmailTemplatesAutomationCache());
        if (!emailAutomationCache) setEmailAutomationCache(cache);

        const templateIds = resolveMeetingEmailTemplateIdsForNotify(
          cache,
          meeting,
          allMeetingLocations,
          type,
        );

        if (!templateIds.en && !templateIds.he) {
          const placementHint = isStaffOrInternalMeeting(meeting)
            ? 'Configure external_meeting_* placements (no location) in Admin → Misc → Email Templates Automation.'
            : 'Set them in Admin → Misc → Email Templates Automation.';
          toast.error(`No email templates configured for this email type. ${placementHint}`);
          setEmailTemplates({ en: null, he: null });
        } else {
          const idsToLoad = [templateIds.en, templateIds.he].filter((id): id is number => id != null && Number.isFinite(id));
          const templatesById = await fetchMiscEmailTemplatesByIds(idsToLoad);

          const nextTemplates: LoadedEmailTemplates = { en: null, he: null };
          (['en', 'he'] as const).forEach((lang) => {
            const templateId = templateIds[lang];
            if (!templateId) return;
            const row = templatesById.get(templateId);
            if (row?.content) {
              nextTemplates[lang] = { content: parseTemplateContent(row.content), name: row.name || null };
            }
          });
          setEmailTemplates(nextTemplates);
        }
      } catch (error) {
        console.error('Error fetching email templates:', error);
        toast.error('Failed to load email templates');
      }

      setShowNotifyModal(true);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      toast.error('Failed to load contacts');
    } finally {
      setLoadingContacts(false);
    }
  };

  const handleWhatsAppNotifyClick = async (type: WhatsAppReminderType) => {
    setWhatsAppReminderType(type);
    setLoadingWhatsAppContacts(true);
    setShowWhatsAppDropdown(false);

    try {
      let allContacts = await loadNotifyRecipients();
      if (allContacts.length === 0 && (client.phone || client.mobile)) {
        allContacts.push({
          id: -1,
          recipientKey: 'lead-fallback',
          name: client.name || 'Client',
          email: client.email || null,
          phone: client.phone || null,
          mobile: client.mobile || null,
          country_id: null,
          isMain: true,
          source: 'lead',
          sourceLabel: 'Lead (Main)',
        });
      }
      setWhatsAppContacts(allContacts);
      setShowWhatsAppNotifyModal(true);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      toast.error('Failed to load contacts');
    } finally {
      setLoadingWhatsAppContacts(false);
    }
  };

  const toggleEmailRecipient = (recipientKey: string) => {
    setSelectedEmailRecipientKeys((prev) => {
      const next = new Set(prev);
      if (next.has(recipientKey)) next.delete(recipientKey);
      else next.add(recipientKey);
      return next;
    });
  };

  const toggleWhatsAppRecipient = (recipientKey: string) => {
    setSelectedWhatsAppRecipientKeys((prev) => {
      const next = new Set(prev);
      if (next.has(recipientKey)) next.delete(recipientKey);
      else next.add(recipientKey);
      return next;
    });
  };

  const handleSendEmail = async (
    emailAddress?: string | string[],
    contactName?: string,
    explicitEmailType?: EmailType,
  ) => {
    setSendingEmailMeetingId(meeting.id);
    setShowNotifyModal(false);

    try {
      const recipientEmail = emailAddress || client.email;
      if (!recipientEmail || (Array.isArray(recipientEmail) && recipientEmail.length === 0) || !instance) {
        throw new Error('Recipient email or MSAL instance missing');
      }

      const accounts = instance.getAllAccounts();
      if (!accounts.length) throw new Error('No Microsoft account found');
      const account = accounts[0];

      let tokenResponse;
      try {
        tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account });
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          toast('Your session has expired. Please sign in again.', { icon: '🔑' });
          tokenResponse = await instance.acquireTokenPopup({ ...loginRequest, account });
        } else {
          throw error;
        }
      }

      const senderName = account?.name || 'Your Team';
      const now = new Date();
      const formattedTime = meeting.time ? meeting.time.substring(0, 5) : meeting.time;
      const formattedDate = formatDateForMessage(meeting.date);
      const currentEmailType = explicitEmailType || emailType;

      const locationName = getMeetingLocationName(meeting.location);
      const joinLinkRaw = meetingJoinLink(meeting);
      const locationRecord = resolveMeetingLocationRecord(meeting.location);
      const includeJoinLink = shouldIncludeMeetingJoinLink(locationRecord, locationName);
      const joinLink = includeJoinLink ? joinLinkRaw : '';
      const teamsJoinUrlForCalendar = includeJoinLink && joinLink && getLinkType(joinLink) === 'teams' ? joinLink : undefined;
      const calendarLocationDisplay = includeJoinLink && locationName === 'Teams' ? 'Microsoft Teams Meeting' : locationName;

      const isMicrosoftEmail = (email: string | string[]): boolean => {
        const emails = Array.isArray(email) ? email : [email];
        const microsoftDomains = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'onmicrosoft.com'];
        return emails.some((addr) => microsoftDomains.some((domain) => addr.toLowerCase().includes(`@${domain}`)));
      };

      const recipientEmailArray = Array.isArray(recipientEmail) ? recipientEmail : [recipientEmail];
      const primaryRecipientEmail = recipientEmailArray[0];
      const useOutlookCalendarInvite = isMicrosoftEmail(recipientEmail);
      const recipientName =
        contactName ||
        (Array.isArray(emailAddress)
          ? contacts.find((c) => c.email === primaryRecipientEmail)?.name || client.name || 'Client'
          : contacts.find((c) => c.email === emailAddress)?.name || client.name || 'Client');

      let descriptionHtml = `<p>Meeting with <strong>${recipientName}</strong></p>`;
      if (joinLink) {
        const joinLabel = getLinkType(joinLink) === 'teams' ? 'Join Teams Meeting' : 'Join Meeting';
        descriptionHtml += `<p><strong>${joinLabel}:</strong> <a href="${joinLink}">${joinLink}</a></p>`;
      }
      if (meeting.brief) {
        descriptionHtml += `<p><strong>Brief:</strong><br>${meeting.brief.replace(/\n/g, '<br>')}</p>`;
      }

      const calendarSubject = 'Meeting with Decker, Pex, Levi Lawoffice';
      const startDateTime = new Date(`${meeting.date}T${formattedTime}:00`);
      const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

      let languageToUse: 'en' | 'he';
      if (currentEmailType === 'rescheduled') {
        const languageId = client.language_id;
        const isHebrew = languageId === 2 || (languageId === undefined && client.language?.toLowerCase().includes('hebrew'));
        languageToUse = isHebrew ? 'he' : 'en';
      } else {
        languageToUse = selectedEmailLanguage;
      }

      const selectedTemplate = languageToUse === 'en' ? emailTemplates.en : emailTemplates.he;

      let subject: string;
      if (selectedTemplate?.name) {
        subject = selectedTemplate.name;
      } else if (currentEmailType === 'cancellation') {
        subject = `[${client.lead_number || client.id}] - ${client.name || 'Client'} - Meeting Canceled`;
      } else if (currentEmailType === 'reminder') {
        subject = `Meeting Reminder - ${formattedDate}`;
      } else if (currentEmailType === 'rescheduled') {
        subject = `[${client.lead_number || client.id}] - ${client.name || 'Client'} - Meeting Rescheduled`;
      } else {
        subject = `Meeting with Decker, Pex, Levi Lawoffice - ${formattedDate}`;
      }

      let htmlBody: string;
      if (selectedTemplate?.content) {
        htmlBody = await formatEmailBody(selectedTemplate.content, recipientName, {
          client,
          meeting,
          meetingDate: formattedDate,
          meetingTime: formattedTime,
          meetingLink: joinLink,
          meetingId: dbMeetingId ?? meeting.id,
          templateLanguage: languageToUse,
        });
      } else {
        const fallbackHtml = meetingInvitationEmailTemplate({
          clientName: recipientName,
          meetingDate: formattedDate,
          meetingTime: undefined,
          location: locationName,
          category: '',
          topic: '',
          joinLink,
          senderName,
        });
        htmlBody = await formatEmailBody(fallbackHtml, recipientName, {
          client,
          meeting,
          meetingDate: formattedDate,
          meetingTime: formattedTime,
          meetingLink: joinLink,
          meetingId: dbMeetingId ?? meeting.id,
        });
      }

      if (
        currentEmailType === 'invitation' ||
        currentEmailType === 'invitation_jlm' ||
        currentEmailType === 'invitation_tlv' ||
        currentEmailType === 'invitation_tlv_parking'
      ) {
        if (useOutlookCalendarInvite) {
          await createCalendarEventWithAttendee(tokenResponse.accessToken, {
            subject: calendarSubject,
            startDateTime: startDateTime.toISOString(),
            endDateTime: endDateTime.toISOString(),
            location: calendarLocationDisplay,
            description: descriptionHtml,
            attendeeEmail: primaryRecipientEmail,
            attendeeName: recipientName,
            organizerEmail: account.username || 'noreply@lawoffice.org.il',
            organizerName: senderName,
            teamsJoinUrl: teamsJoinUrlForCalendar,
            timeZone: 'Asia/Jerusalem',
          });
        } else {
          let attachments: Array<{ name: string; contentBytes: string; contentType?: string }> | undefined;
          try {
            const icsContent = generateICSFromDateTime({
              subject: calendarSubject,
              date: meeting.date,
              time: formattedTime,
              durationMinutes: 60,
              location: calendarLocationDisplay,
              description: descriptionHtml.replace(/<[^>]+>/g, ''),
              organizerEmail: account.username || 'noreply@lawoffice.org.il',
              organizerName: senderName,
              attendeeEmail: primaryRecipientEmail,
              attendeeName: recipientName,
              teamsJoinUrl: teamsJoinUrlForCalendar,
              timeZone: 'Asia/Jerusalem',
            });
            attachments = [
              {
                name: 'meeting-invite.ics',
                contentBytes: btoa(unescape(encodeURIComponent(icsContent))),
                contentType: 'text/calendar; charset=utf-8; method=REQUEST',
              },
            ];
          } catch (icsError) {
            console.error('Failed to generate ICS file:', icsError);
          }

          await sendEmail(tokenResponse.accessToken, {
            to: recipientEmail,
            subject,
            body: htmlBody,
            attachments,
            skipSignature: true,
          });
        }
      } else {
        await sendEmail(tokenResponse.accessToken, {
          to: recipientEmail,
          subject,
          body: htmlBody,
          skipSignature: true,
        });
      }

      const emailTypeMessages: Record<EmailType, string> = {
        invitation: `Meeting invitation sent for meeting on ${meeting.date}`,
        invitation_jlm: `Meeting invitation (JLM) sent for meeting on ${meeting.date}`,
        invitation_tlv: `Meeting invitation (TLV) sent for meeting on ${meeting.date}`,
        invitation_tlv_parking: `Meeting invitation (TLV + Parking) sent for meeting on ${meeting.date}`,
        reminder: `Meeting reminder sent for meeting on ${meeting.date}`,
        cancellation: `Meeting cancellation notice sent for meeting on ${meeting.date}`,
        rescheduled: `Meeting rescheduled notice sent for meeting on ${meeting.date}`,
      };
      toast.success(emailTypeMessages[currentEmailType]);

      const contactByEmail = contacts.find((c) => c.email === recipientEmailArray[0]);
      const contactId = contactByEmail && contactByEmail.id > 0 ? contactByEmail.id : null;
      const senderEmail = account.username || account.name || 'noreply@lawoffice.org.il';

      await saveOutgoingEmailRecord({
        client,
        subject,
        htmlBody,
        senderName,
        senderEmail,
        recipientList: recipientEmail,
        contactId,
        sentAt: now,
        messageId: `optimistic_${now.getTime()}`,
      });
    } catch (error) {
      console.error('Error in MeetingNotifyControls.handleSendEmail:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Graph API error')) {
        const graphErrorMatch = errorMessage.match(/Graph API error sending email: (.+)/);
        toast.error(graphErrorMatch ? graphErrorMatch[1] : 'Failed to send email via Microsoft Graph API.');
      } else if (errorMessage.includes('No recipient') || errorMessage.includes('Recipient email')) {
        toast.error('Please specify a recipient email address.');
      } else if (errorMessage.includes('Microsoft account')) {
        toast.error('Please sign in to your Microsoft account.');
      } else {
        toast.error(`Failed to send email: ${errorMessage}`);
      }
    } finally {
      setSendingEmailMeetingId(null);
    }
  };

  const handleSendWhatsAppReminder = async (phoneNumbers?: string | string[], reminderType?: WhatsAppReminderType) => {
    const type = reminderType || whatsAppReminderType;
    setSendingWhatsAppMeetingId(meeting.id);
    setShowWhatsAppNotifyModal(false);
    setShowWhatsAppDropdown(false);

    try {
      const templateName = type === 'missed_appointment' ? 'missed_appointment' : 'reminder_of_a_meeting';
      const targetLanguage = selectedLanguage.toLowerCase();
      const useExternalTemplates = isStaffOrInternalMeeting(meeting);
      const selectedTemplate = selectReminderWhatsAppTemplate(reminderTemplates, type, selectedLanguage, {
        useExternalMeetingTemplates: useExternalTemplates,
      });

      if (!selectedTemplate) {
        toast.error(
          `Reminder template not found for ${selectedLanguage === 'he' ? 'Hebrew' : 'English'}. Please ensure templates with name "${templateName}" and language "${targetLanguage}" exist in the database.`,
        );
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      let senderName = 'You';
      if (user?.id) {
        const { data: userRow, error: userLookupError } = await supabase
          .from('users')
          .select('full_name, employee_id, tenants_employee!employee_id(display_name)')
          .eq('auth_id', user.id)
          .single();
        if (!userLookupError && userRow) {
          const employee = Array.isArray(userRow.tenants_employee) ? userRow.tenants_employee[0] : userRow.tenants_employee;
          senderName = employee?.display_name || userRow.full_name || 'You';
        }
      }

      const formattedDate = formatDateForMessage(meeting.date);
      const formattedTime = meeting.time ? meeting.time.substring(0, 5) : '';
      const locationName = getMeetingLocationName(meeting.location);
      const leadlessStaff = isLeadlessStaffCalendarNotify(meeting, client);
      const locationRecord = resolveMeetingLocationRecord(meeting.location);
      const joinLinkRaw = meetingJoinLink(meeting);
      const includeJoinLink = shouldIncludeMeetingJoinLink(locationRecord, locationName);
      const joinLinkForTemplate = includeJoinLink ? joinLinkRaw : '';
      const preferEnglishWhatsApp = preferEnglishMeetingTemplateLanguage(selectedLanguage);
      const paramCtx = {
        formattedDate,
        formattedTime,
        locationName,
        locationTextForTemplate: resolveMeetingLocationTextForTemplate(
          meeting,
          resolveMeetingLocationRecord,
          getMeetingLocationName,
          preferEnglishWhatsApp,
        ),
        meetingLocationRaw: String(meeting.location ?? '').trim(),
        manualAddress: meeting.manual_address?.trim() ?? '',
        meetingId: dbMeetingId ?? meeting.id,
        joinLinkForTemplate,
        templateLanguage: selectedLanguage,
      };
      const phoneNumbersToSend = phoneNumbers ? (Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers]) : [];

      if (phoneNumbersToSend.length === 0) {
        toast.error('No phone numbers selected');
        return;
      }

      const sendPromises = phoneNumbersToSend.map(async (phoneNumber) => {
        if (!phoneNumber || phoneNumber.trim() === '') {
          return { success: false, phoneNumber, error: 'Invalid phone number' };
        }

        const contact = whatsAppContacts.find(
          (c) => c.phone?.trim() === phoneNumber.trim() || c.mobile?.trim() === phoneNumber.trim(),
        );
        const normalizedLeadId = leadlessStaff ? null : normalizeLeadIdForWhatsAppBackend(client);
        const paramCount = Number(selectedTemplate.params) || 0;
        let templateParameters: Array<{ type: string; text: string }> = [];

        if (paramCount > 0) {
          try {
            templateParameters = await generateMeetingWhatsAppTemplateParameters(
              selectedTemplate,
              { ...client },
              contact?.id || null,
              { ...paramCtx, recipientName: contact?.name },
              { leadlessStaff },
            );
            if (templateParameters.length === 0) {
              return { success: false, phoneNumber, error: 'Failed to generate template parameters' };
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, phoneNumber, error: `Error generating template parameters: ${message}` };
          }
        }

        const filledContent = fillWhatsAppTemplateContent(selectedTemplate.content || '', templateParameters);

        const messagePayload: any = {
          leadId: normalizedLeadId,
          phoneNumber: phoneNumber.trim(),
          sender_name: senderName,
          isTemplate: true,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          templateLanguage: selectedTemplate.language || targetLanguage,
          contactId: contact && contact.id > 0 ? contact.id : null,
        };

        if (paramCount > 0) {
          messagePayload.templateParameters = templateParameters;
          messagePayload.message = filledContent || 'Template sent';
        } else {
          messagePayload.message = selectedTemplate.content || 'Template sent';
        }

        let response: Response;
        let result: any;
        try {
          response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messagePayload),
          });
          result = await response.json();
        } catch {
          return { success: false, phoneNumber, error: 'Failed to send WhatsApp message: Network error' };
        }

        const isDbSaveError = !response.ok && result && result.error && (
          result.error.includes('save') ||
          result.error.includes('Failed to save message') ||
          result.details?.includes('save') ||
          result.details?.includes('permission denied')
        );

        if (!response.ok && !isDbSaveError) {
          const errorMessage =
            result?.code === 'RE_ENGAGEMENT_REQUIRED'
              ? 'WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity.'
              : result?.error || 'Failed to send WhatsApp message';
          return { success: false, phoneNumber, error: errorMessage };
        }

        if (response.ok) {
          return { success: true, phoneNumber };
        }

        const whatsappMessageId =
          result?.messageId ??
          result?.message_id ??
          result?.whatsapp_message_id ??
          result?.data?.whatsapp_message_id ??
          result?.id;

        try {
          const legacyLead = !leadlessStaff && isLegacyLead(client);
          const legacyId = legacyLead
            ? (() => {
                const numeric = parseInt(String(client.id).replace('legacy_', ''), 10);
                return Number.isNaN(numeric) ? null : numeric;
              })()
            : null;
          const now = new Date();
          const whatsappMessageRecord: any = {
            phone_number: phoneNumber.trim(),
            sender_name: senderName,
            direction: 'out',
            message: filledContent || selectedTemplate.content || `[Template: ${selectedTemplate.name}]`,
            template_id: selectedTemplate.id,
            sent_at: now.toISOString(),
            whatsapp_message_id: whatsappMessageId || `optimistic_${now.getTime()}`,
            whatsapp_status: 'sent',
            message_type: 'text',
            whatsapp_timestamp: now.toISOString(),
            ...(staffMeeting
              ? {}
              : {
                  lead_id: legacyLead ? null : client.id,
                  legacy_id: legacyLead ? legacyId : null,
                }),
          };
          if (contact && contact.id > 0) whatsappMessageRecord.contact_id = contact.id;

          const { data: insertedData, error: insertError } = await supabase.from('whatsapp_messages').insert([whatsappMessageRecord]).select();
          if (insertError) {
            if (insertError.code === '42501' && insertError.message?.includes('pending_stage_evaluations')) {
              const messageRecordWithoutContext = { ...whatsappMessageRecord };
              delete messageRecordWithoutContext.lead_id;
              delete messageRecordWithoutContext.legacy_id;
              delete messageRecordWithoutContext.contact_id;
              const { data: insertedWithoutContext, error: insertWithoutContextError } = await supabase
                .from('whatsapp_messages')
                .insert([messageRecordWithoutContext])
                .select();
              if (!insertWithoutContextError && insertedWithoutContext && insertedWithoutContext.length > 0) {
                await supabase
                  .from('whatsapp_messages')
                  .update({
                    lead_id: whatsappMessageRecord.lead_id,
                    legacy_id: whatsappMessageRecord.legacy_id,
                    contact_id: whatsappMessageRecord.contact_id,
                  })
                  .eq('id', insertedWithoutContext[0].id);
              }
            }
          } else if (!insertedData || insertedData.length === 0) {
            console.warn('WhatsApp message insert succeeded but returned no data');
          }
        } catch (dbError) {
          console.error('Error saving WhatsApp message record to database (message was sent successfully):', dbError);
        }

        return { success: true, phoneNumber };
      });

      const results = await Promise.all(sendPromises);
      const successCount = results.filter((r): r is { success: boolean; phoneNumber: string; error?: string } => r !== undefined && r.success).length;
      const failureCount = results.filter((r): r is { success: boolean; phoneNumber: string; error?: string } => r !== undefined && !r.success).length;

      if (successCount > 0) {
        const typeLabel = type === 'missed_appointment' ? 'missed appointment' : 'reminder';
        toast.success(`WhatsApp ${typeLabel} sent to ${successCount} contact${successCount !== 1 ? 's' : ''}`);
      }
      if (failureCount > 0) {
        const errors = results
          .filter((r): r is { success: boolean; phoneNumber: string; error?: string } => r !== undefined && !r.success)
          .map((r) => r.error || 'Unknown error')
          .join(', ');
        toast.error(`Failed to send to ${failureCount} contact${failureCount !== 1 ? 's' : ''}: ${errors}`);
      }
    } catch (error) {
      console.error('Error sending WhatsApp reminder:', error);
      toast.error('Failed to send WhatsApp reminder');
    } finally {
      setSendingWhatsAppMeetingId(null);
    }
  };

  const controlButtonClass =
    variant === 'toolbar'
      ? 'btn btn-sm btn-circle h-9 w-9 min-h-9 min-w-9 p-0 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm'
      : 'btn btn-circle h-11 w-11 min-h-11 min-w-11 p-0 shrink-0 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm';
  const wrapperClass = variant === 'toolbar' ? 'flex items-center gap-2' : 'flex flex-col items-center gap-2 sm:gap-3';

  if (!shouldRender) return null;

  return (
    <>
      <div className={wrapperClass}>
        <div className="relative flex justify-center" ref={notifyDropdownRef}>
          <button
            type="button"
            className={controlButtonClass}
            onClick={() => {
              if (sendingEmailMeetingId !== meeting.id) setShowNotifyDropdown((v) => !v);
            }}
            disabled={sendingEmailMeetingId === meeting.id}
            title="Notify via Email"
          >
            {sendingEmailMeetingId === meeting.id ? (
              <span className="loading loading-spinner loading-sm"></span>
            ) : (
              <OutlookIcon className="w-5 h-5" />
            )}
          </button>
          {showNotifyDropdown && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
              <button
                type="button"
                className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100 first:rounded-t-lg"
                onClick={() => handleNotifyClick(invitationTypeForMeeting)}
              >
                {invitationLabel}
              </button>
              <button type="button" className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100" onClick={() => handleNotifyClick('reminder')}>
                Meeting Reminder
              </button>
              <button type="button" className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100" onClick={() => handleNotifyClick('rescheduled')}>
                Meeting Rescheduled
              </button>
              <button type="button" className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 last:rounded-b-lg text-red-600" onClick={() => handleNotifyClick('cancellation')}>
                Meeting Cancellation
              </button>
            </div>
          )}
        </div>

        <div className="relative flex justify-center" ref={whatsAppDropdownRef}>
          <button
            type="button"
            className={controlButtonClass}
            onClick={(e) => {
              e.stopPropagation();
              if (sendingWhatsAppMeetingId !== meeting.id) setShowWhatsAppDropdown((v) => !v);
            }}
            disabled={sendingWhatsAppMeetingId === meeting.id}
            title="Send WhatsApp Reminder"
          >
            {sendingWhatsAppMeetingId === meeting.id ? (
              <span className="loading loading-spinner loading-sm"></span>
            ) : (
              <FaWhatsapp className="w-5 h-5 text-green-600" aria-hidden="true" />
            )}
          </button>
          {showWhatsAppDropdown && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
              <button
                type="button"
                className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100 first:rounded-t-lg"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleWhatsAppNotifyClick('reminder');
                }}
              >
                Meeting Reminder
              </button>
              <button
                type="button"
                className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100 last:rounded-b-lg"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleWhatsAppNotifyClick('missed_appointment');
                }}
              >
                Missed Appointment
              </button>
            </div>
          )}
        </div>
      </div>

      {showNotifyModal && (
        <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center ${modalZIndexClass}`} onClick={() => setShowNotifyModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Select Recipients</h3>
                <button type="button" onClick={() => setShowNotifyModal(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Language</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedEmailLanguage('en')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedEmailLanguage === 'en' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedEmailLanguage('he')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedEmailLanguage === 'he' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    עברית
                  </button>
                </div>
              </div>

              {loadingContacts ? (
                <div className="flex justify-center items-center py-8">
                  <span className="loading loading-spinner loading-md"></span>
                </div>
              ) : (
                (() => {
                  const sortedContacts = sortNotifyRecipients(contacts);
                  const emailContacts = sortedContacts.filter((c) => c.email && c.email !== '---');
                  const hasClientFallback = Boolean(client.email) && emailContacts.length === 0;
                  const selectableCount = emailContacts.length + (hasClientFallback ? 1 : 0);

                  return (
                    <div className="space-y-3">
                      {selectableCount > 1 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">{selectedEmailRecipientKeys.size} of {selectableCount} selected</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() =>
                                setSelectedEmailRecipientKeys(
                                  new Set([
                                    ...emailContacts.map((c) => c.recipientKey),
                                    ...(hasClientFallback ? ['client-primary-email'] : []),
                                  ]),
                                )
                              }
                            >
                              Select all
                            </button>
                            <button type="button" className="text-gray-500 hover:underline" onClick={() => setSelectedEmailRecipientKeys(new Set())}>
                              Clear
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {sortedContacts.map((contact) => {
                          const hasEmail = Boolean(contact.email && contact.email !== '---');
                          const isSelected = hasEmail && selectedEmailRecipientKeys.has(contact.recipientKey);
                          return (
                            <label
                              key={contact.recipientKey}
                              className={`flex items-start gap-3 px-4 py-3 border rounded-lg transition-colors ${!hasEmail ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed' : isSelected ? 'border-purple-300 bg-purple-50 cursor-pointer' : 'border-gray-200 hover:bg-gray-50 cursor-pointer'}`}
                            >
                              <input
                                type="checkbox"
                                className="checkbox checkbox-primary checkbox-sm mt-1"
                                checked={isSelected}
                                disabled={!hasEmail}
                                onChange={() => toggleEmailRecipient(contact.recipientKey)}
                              />
                              <NotifyRecipientAvatar contact={contact} size="sm" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 flex flex-wrap items-center gap-2">
                                  <span>{contact.name || '---'}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${getNotifySourceBadgeClass(contact.source)}`}>{contact.sourceLabel}</span>
                                </div>
                                {contact.subtitle && <div className="text-xs text-gray-400 truncate">{contact.subtitle}</div>}
                                <div className="text-sm text-gray-500 truncate">{hasEmail ? contact.email : 'No email address'}</div>
                              </div>
                            </label>
                          );
                        })}

                        {hasClientFallback && (
                          <label
                            className={`flex items-start gap-3 px-4 py-3 border rounded-lg cursor-pointer transition-colors ${selectedEmailRecipientKeys.has('client-primary-email') ? 'border-purple-300 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'}`}
                          >
                            <input
                              type="checkbox"
                              className="checkbox checkbox-primary checkbox-sm mt-1"
                              checked={selectedEmailRecipientKeys.has('client-primary-email')}
                              onChange={() => toggleEmailRecipient('client-primary-email')}
                            />
                            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-purple-100 text-purple-700 font-semibold flex-shrink-0 text-xs">
                              {getInitials(client.name || 'Client')}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900">{client.name || 'Client'}</div>
                              <div className="text-sm text-gray-500 truncate">{client.email}</div>
                            </div>
                          </label>
                        )}

                        {sortedContacts.length === 0 && !hasClientFallback && (
                          <div className="text-center py-8 text-gray-500">
                            <EnvelopeIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                            <p>No recipients found</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {!loadingContacts && (
              <div className="p-6 pt-0 flex gap-3 border-t border-gray-100">
                <button type="button" className="btn btn-ghost flex-1" onClick={() => setShowNotifyModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary flex-1"
                  disabled={selectedEmailRecipientKeys.size === 0 || sendingEmailMeetingId === meeting.id}
                  onClick={() => {
                    const selectedEmails = contacts
                      .filter((c) => selectedEmailRecipientKeys.has(c.recipientKey) && c.email && c.email !== '---')
                      .map((c) => c.email!);
                    if (selectedEmailRecipientKeys.has('client-primary-email') && client.email) selectedEmails.push(client.email);
                    if (selectedEmails.length === 0) {
                      toast.error('Select at least one recipient');
                      return;
                    }
                    void handleSendEmail(selectedEmails, client.name || 'Client');
                  }}
                >
                  {sendingEmailMeetingId === meeting.id ? (
                    <span className="loading loading-spinner loading-sm"></span>
                  ) : (
                    `Send Email${selectedEmailRecipientKeys.size > 1 ? ` (${selectedEmailRecipientKeys.size})` : ''}`
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showWhatsAppNotifyModal && (
        <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center ${modalZIndexClass}`} onClick={() => setShowWhatsAppNotifyModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Send WhatsApp {whatsAppReminderType === 'missed_appointment' ? 'Missed Appointment' : 'Reminder'}
                </h3>
                <button type="button" onClick={() => setShowWhatsAppNotifyModal(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Language</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedLanguage('he')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedLanguage === 'he' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    Hebrew
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedLanguage('en')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedLanguage === 'en' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    English
                  </button>
                  {whatsAppReminderType === 'missed_appointment' && (
                    <button
                      type="button"
                      onClick={() => setSelectedLanguage('ru')}
                      className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedLanguage === 'ru' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    >
                      Russian
                    </button>
                  )}
                </div>
              </div>

              {loadingWhatsAppContacts ? (
                <div className="flex justify-center items-center py-8">
                  <span className="loading loading-spinner loading-md"></span>
                </div>
              ) : (
                (() => {
                  const sortedContacts = sortNotifyRecipients(whatsAppContacts);
                  const phoneContacts = sortedContacts.filter((c) => getNotifyRecipientPhone(c));
                  const clientPhone = client.phone?.trim();
                  const clientMobile = client.mobile?.trim();
                  const clientPhoneNumber =
                    clientPhone && clientPhone !== '' && clientPhone !== '---'
                      ? clientPhone
                      : clientMobile && clientMobile !== '' && clientMobile !== '---'
                        ? clientMobile
                        : null;
                  const hasClientFallback = Boolean(clientPhoneNumber) && phoneContacts.length === 0;
                  const selectableCount = phoneContacts.length + (hasClientFallback ? 1 : 0);

                  return (
                    <div className="space-y-3">
                      {selectableCount > 1 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">{selectedWhatsAppRecipientKeys.size} of {selectableCount} selected</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-green-600 hover:underline"
                              onClick={() =>
                                setSelectedWhatsAppRecipientKeys(
                                  new Set([
                                    ...phoneContacts.map((c) => c.recipientKey),
                                    ...(hasClientFallback ? ['client-primary-phone'] : []),
                                  ]),
                                )
                              }
                            >
                              Select all
                            </button>
                            <button type="button" className="text-gray-500 hover:underline" onClick={() => setSelectedWhatsAppRecipientKeys(new Set())}>
                              Clear
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {sortedContacts.map((contact) => {
                          const phoneNumber = getNotifyRecipientPhone(contact);
                          const hasPhone = Boolean(phoneNumber);
                          const isSelected = hasPhone && selectedWhatsAppRecipientKeys.has(contact.recipientKey);

                          return (
                            <label
                              key={contact.recipientKey}
                              className={`flex items-start gap-3 px-4 py-3 border rounded-lg transition-colors ${!hasPhone ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed' : isSelected ? 'border-green-300 bg-green-50 cursor-pointer' : 'border-gray-200 hover:bg-gray-50 cursor-pointer'}`}
                            >
                              <input
                                type="checkbox"
                                className="checkbox checkbox-success checkbox-sm mt-1"
                                checked={isSelected}
                                disabled={!hasPhone}
                                onChange={() => toggleWhatsAppRecipient(contact.recipientKey)}
                              />
                              <NotifyRecipientAvatar contact={contact} size="sm" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 flex flex-wrap items-center gap-2">
                                  <span>{contact.name || '---'}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${getNotifySourceBadgeClass(contact.source)}`}>{contact.sourceLabel}</span>
                                </div>
                                {contact.subtitle && <div className="text-xs text-gray-400 truncate">{contact.subtitle}</div>}
                                <div className="text-sm text-gray-500 truncate">{hasPhone ? phoneNumber : 'No phone number'}</div>
                              </div>
                            </label>
                          );
                        })}

                        {hasClientFallback && clientPhoneNumber && (
                          <label
                            className={`flex items-start gap-3 px-4 py-3 border rounded-lg cursor-pointer transition-colors ${selectedWhatsAppRecipientKeys.has('client-primary-phone') ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:bg-gray-50'}`}
                          >
                            <input
                              type="checkbox"
                              className="checkbox checkbox-success checkbox-sm mt-1"
                              checked={selectedWhatsAppRecipientKeys.has('client-primary-phone')}
                              onChange={() => toggleWhatsAppRecipient('client-primary-phone')}
                            />
                            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0 text-xs">
                              {getInitials(client.name || 'Client')}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900">{client.name || 'Client'}</div>
                              <div className="text-sm text-gray-500 truncate">{clientPhoneNumber}</div>
                            </div>
                          </label>
                        )}

                        {sortedContacts.length === 0 && !hasClientFallback && (
                          <div className="text-center py-8 text-gray-500">
                            <FaWhatsapp className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                            <p>No recipients found</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {!loadingWhatsAppContacts && (
              <div className="p-6 pt-0 flex gap-3 border-t border-gray-100">
                <button type="button" className="btn btn-ghost flex-1" onClick={() => setShowWhatsAppNotifyModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn bg-green-600 hover:bg-green-700 text-white border-green-600 flex-1"
                  disabled={selectedWhatsAppRecipientKeys.size === 0 || sendingWhatsAppMeetingId === meeting.id}
                  onClick={() => {
                    const selectedPhones = whatsAppContacts
                      .filter((c) => selectedWhatsAppRecipientKeys.has(c.recipientKey))
                      .map((c) => getNotifyRecipientPhone(c))
                      .filter(Boolean) as string[];

                    if (selectedWhatsAppRecipientKeys.has('client-primary-phone')) {
                      const clientPhone = client.phone?.trim();
                      const clientMobile = client.mobile?.trim();
                      const clientPhoneNumber =
                        clientPhone && clientPhone !== '' && clientPhone !== '---'
                          ? clientPhone
                          : clientMobile && clientMobile !== '' && clientMobile !== '---'
                            ? clientMobile
                            : null;
                      if (clientPhoneNumber) selectedPhones.push(clientPhoneNumber);
                    }

                    if (selectedPhones.length === 0) {
                      toast.error('Select at least one recipient');
                      return;
                    }

                    void handleSendWhatsAppReminder(selectedPhones, whatsAppReminderType);
                  }}
                >
                  {sendingWhatsAppMeetingId === meeting.id ? (
                    <span className="loading loading-spinner loading-sm"></span>
                  ) : (
                    `Send WhatsApp${selectedWhatsAppRecipientKeys.size > 1 ? ` (${selectedWhatsAppRecipientKeys.size})` : ''}`
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default MeetingNotifyControls;
