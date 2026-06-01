/**
 * Email Template Parameter Replacement
 * 
 * This module provides utilities for replacing template parameters in email templates.
 * Supports both client/contact info and meeting-related parameters.
 */

import { supabase } from './supabase';
import { preferEnglishMeetingTemplateLanguage } from './meetingLocationUtils';

export interface EmailTemplateContext {
  // Client/Contact info
  clientId?: string | null;
  legacyId?: number | null;
  clientName?: string | null;
  contactName?: string | null;
  leadNumber?: string | null;
  topic?: string | null;
  leadType?: string | null;
  
  // Meeting info (can be provided directly or fetched from DB)
  meetingDate?: string | null;
  meetingTime?: string | null;
  /** @deprecated Prefer meetingLocationRaw — raw meetings.meeting_location for {{location}} */
  meetingLocation?: string | null;
  /** Raw meetings.meeting_location column → {{location}} */
  meetingLocationRaw?: string | null;
  /** Resolved address / place → {{meeting_location}} (same as WhatsApp meeting_location param) */
  meetingLocationResolved?: string | null;
  meetingLink?: string | null;
  /** meetings.manual_address — replaces {{address}} / {address} in templates */
  meetingAddress?: string | null;
  /** meetings.id — prefer this row when resolving location / address / link */
  meetingId?: number | string | null;
  /** When English (en), use tenants_meetinglocation.address_en for {{meeting_location}} when set */
  templateLanguage?: string | null;
}

/**
 * Get the best available name (contact name or client name)
 */
function getName(context: EmailTemplateContext): string {
  return context.contactName || context.clientName || 'Client';
}

/**
 * Fetch meeting date from the database
 */
async function getMeetingDate(clientId: string | null, isLegacyLead: boolean): Promise<string> {
  if (!clientId) return '';
  
  try {
    const {
      getMeetingDateTime
    } = await import('./whatsappTemplateParams');
    
    const meetingDateTime = await getMeetingDateTime(clientId, isLegacyLead);
    if (!meetingDateTime) return '';
    
    // Extract date from datetime string (format: "January 15, 2025 at 10:00 AM")
    return meetingDateTime.split(' at ')[0] || '';
  } catch (error) {
    console.error('Error fetching meeting date:', error);
    return '';
  }
}

/**
 * Fetch meeting time from the database
 */
async function getMeetingTime(clientId: string | null, isLegacyLead: boolean): Promise<string> {
  if (!clientId) return '';
  
  try {
    const {
      getMeetingTime
    } = await import('./whatsappTemplateParams');
    
    return await getMeetingTime(clientId, isLegacyLead);
  } catch (error) {
    console.error('Error fetching meeting time:', error);
    return '';
  }
}

/**
 * Fetch meeting location from the database
 */
async function getMeetingLocationResolved(
  clientId: string | null,
  isLegacyLead: boolean,
  meetingId?: number | string | null,
  preferEnglish = false,
): Promise<string> {
  if (!clientId && meetingId == null) return '';

  try {
    const { getMeetingLocation } = await import('./whatsappTemplateParams');
    return await getMeetingLocation(clientId || '', isLegacyLead, meetingId, { preferEnglish });
  } catch (error) {
    console.error('Error fetching resolved meeting location:', error);
    return '';
  }
}

async function getMeetingLocationRaw(
  clientId: string | null,
  isLegacyLead: boolean,
  meetingId?: number | string | null,
): Promise<string> {
  if (!clientId && meetingId == null) return '';

  try {
    const { getMeetingLocationRaw: fetchRaw } = await import('./whatsappTemplateParams');
    return await fetchRaw(clientId || '', isLegacyLead, meetingId);
  } catch (error) {
    console.error('Error fetching raw meeting_location:', error);
    return '';
  }
}

/**
 * Fetch meeting link from the database
 */
async function getMeetingLink(clientId: string | null, isLegacyLead: boolean): Promise<string> {
  if (!clientId) return '';
  
  try {
    const {
      getMeetingLink
    } = await import('./whatsappTemplateParams');
    
    return await getMeetingLink(clientId, isLegacyLead);
  } catch (error) {
    console.error('Error fetching meeting link:', error);
    return '';
  }
}

async function getMeetingManualAddress(
  clientId: string | null,
  isLegacyLead: boolean,
  meetingId?: number | string | null,
): Promise<string> {
  if (!clientId && meetingId == null) return '';

  try {
    const { getMeetingManualAddress: fetchManualAddress } = await import('./whatsappTemplateParams');
    return await fetchManualAddress(clientId || '', isLegacyLead, meetingId);
  } catch (error) {
    console.error('Error fetching meeting manual_address:', error);
    return '';
  }
}

function isValidClientIdForMeetingFetch(clientId: string | null | undefined): boolean {
  if (!clientId) return false;
  const s = String(clientId).trim();
  if (!s || s === 'staff-meeting' || s.startsWith('staff-')) return false;
  return true;
}

/**
 * 
 * Supported parameters:
 * - {name} or {client_name} - Client/contact name
 * - {lead_number} - Lead number
 * - {topic} - Topic/category
 * - {lead_type} - Lead type (legacy/new)
 * - {date} or {{date}} - Meeting date
 * - {time} or {{time}} - Meeting time
 * - {location} or {{location}} - Raw meetings.meeting_location column
 * - {{meeting_location}} - Resolved address / place (catalog + custom_address; same as WhatsApp)
 * - {link} or {{link}} - Meeting link
 * - {address} or {{address}} - meetings.manual_address
 * 
 * @param content - The email template content
 * @param context - Context object with client/contact and meeting info
 * @returns Promise<string> - The content with all parameters replaced
 */
/** Normalize rare brace variants from editors (fullwidth / Unicode) */
function normalizeTemplateBraces(s: string): string {
  return s.replace(/\uFF5B/g, '{').replace(/\uFF5D/g, '}');
}

function applyTemplateParam(result: string, paramName: string, value: string): string {
  const v = value || '';
  const escaped = paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return result
    .replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'gi'), v)
    .replace(new RegExp(`\\{\\s*${escaped}\\s*\\}`, 'gi'), v);
}

function applyMeetingDateReplacements(result: string, value: string): string {
  return applyTemplateParam(result, 'date', value);
}

function applyMeetingTimeReplacements(result: string, value: string): string {
  return applyTemplateParam(result, 'time', value);
}

function applyLocationReplacements(result: string, rawValue: string): string {
  return applyTemplateParam(result, 'location', rawValue);
}

function applyMeetingLocationResolvedReplacements(result: string, resolvedValue: string): string {
  return applyTemplateParam(result, 'meeting_location', resolvedValue);
}

function applyMeetingLinkReplacements(result: string, linkValue: string): string {
  return applyTemplateParam(result, 'link', linkValue);
}

function applyMeetingAddressReplacements(result: string, addressValue: string): string {
  return applyTemplateParam(result, 'address', addressValue);
}

function templateHasParam(result: string, paramName: string): boolean {
  const escaped = paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'i').test(result) ||
    new RegExp(`\\{\\s*${escaped}\\s*\\}`, 'i').test(result)
  );
}

function resolveClientIdForMeetingFetch(context: EmailTemplateContext): {
  clientIdForMeeting: string | null;
  isLegacyLead: boolean;
} {
  const isLegacyLead =
    context.leadType === 'legacy' ||
    context.legacyId !== null ||
    context.legacyId !== undefined ||
    (context.clientId !== null &&
      typeof context.clientId === 'string' &&
      context.clientId.startsWith('legacy_'));

  let clientIdForMeeting: string | null = null;

  if (isLegacyLead) {
    if (context.legacyId !== null && context.legacyId !== undefined) {
      clientIdForMeeting = context.legacyId.toString();
    } else if (context.clientId && typeof context.clientId === 'string') {
      const numeric = parseInt(context.clientId.replace(/[^0-9]/g, ''), 10);
      clientIdForMeeting = Number.isNaN(numeric) ? null : numeric.toString();
    }
  } else {
    clientIdForMeeting = context.clientId || null;
  }

  return { clientIdForMeeting, isLegacyLead };
}

export async function replaceEmailTemplateParams(
  content: string,
  context: EmailTemplateContext
): Promise<string> {
  if (!content) return '';
  
  let result = normalizeTemplateBraces(content);
  
  // Basic synchronous replacements
  const name = getName(context);
  result = applyTemplateParam(result, 'name', name);
  result = applyTemplateParam(result, 'client_name', name);
  result = applyTemplateParam(result, 'lead_number', context.leadNumber || '');
  result = applyTemplateParam(result, 'lead_type', context.leadType || '');
  
  // Check if any meeting parameters need to be replaced
  const hasDate = templateHasParam(result, 'date');
  const hasTime = templateHasParam(result, 'time');
  const hasLocation = templateHasParam(result, 'location');
  const hasMeetingLocation = templateHasParam(result, 'meeting_location');
  const hasLink = templateHasParam(result, 'link');
  const hasAddress = templateHasParam(result, 'address');

  const meetingId = context.meetingId ?? null;
  const { clientIdForMeeting, isLegacyLead } = resolveClientIdForMeetingFetch(context);
  const clientIdForFetch = isValidClientIdForMeetingFetch(clientIdForMeeting) ? clientIdForMeeting : null;
  const canFetchMeeting =
    Boolean(meetingId) || Boolean(clientIdForFetch) || context.legacyId != null;
  const preferEnglish = preferEnglishMeetingTemplateLanguage(context.templateLanguage);

  if (context.meetingDate !== undefined) {
    result = applyMeetingDateReplacements(result, context.meetingDate || '');
  }
  if (context.meetingTime !== undefined) {
    result = applyMeetingTimeReplacements(result, context.meetingTime || '');
  }
  if (context.meetingLink !== undefined) {
    result = applyMeetingLinkReplacements(result, context.meetingLink || '');
  }

  let locationRaw =
    context.meetingLocationRaw !== undefined
      ? context.meetingLocationRaw || ''
      : context.meetingLocation !== undefined
        ? context.meetingLocation || ''
        : undefined;

  let locationResolved =
    context.meetingLocationResolved !== undefined ? context.meetingLocationResolved || '' : undefined;

  if (canFetchMeeting) {
    if (hasDate && context.meetingDate === undefined) {
      const meetingDate = clientIdForFetch
        ? await getMeetingDate(clientIdForFetch, isLegacyLead)
        : '';
      result = applyMeetingDateReplacements(result, meetingDate || '');
    }
    if (hasTime && context.meetingTime === undefined) {
      const meetingTime = clientIdForFetch
        ? await getMeetingTime(clientIdForFetch, isLegacyLead)
        : '';
      result = applyMeetingTimeReplacements(result, meetingTime || '');
    }
    if (hasLink && context.meetingLink === undefined && clientIdForFetch) {
      const meetingLink = await getMeetingLink(clientIdForFetch, isLegacyLead);
      result = applyMeetingLinkReplacements(result, meetingLink || '');
    }
    if (hasLocation && locationRaw === undefined) {
      locationRaw = await getMeetingLocationRaw(clientIdForFetch, isLegacyLead, meetingId);
    }
    if (hasMeetingLocation && locationResolved === undefined) {
      locationResolved = await getMeetingLocationResolved(
        clientIdForFetch,
        isLegacyLead,
        meetingId,
        preferEnglish,
      );
    }
  }

  if (hasLocation) {
    result = applyLocationReplacements(result, locationRaw ?? '');
  }
  if (hasMeetingLocation) {
    result = applyMeetingLocationResolvedReplacements(result, locationResolved ?? '');
  }

  if (context.meetingAddress !== undefined) {
    result = applyMeetingAddressReplacements(result, context.meetingAddress || '');
  } else if (hasAddress && canFetchMeeting) {
    try {
      const meetingAddress = await getMeetingManualAddress(clientIdForFetch, isLegacyLead, meetingId);
      result = applyMeetingAddressReplacements(result, meetingAddress || '');
    } catch (error) {
      console.error('Error fetching meeting manual_address for template:', error);
      result = applyMeetingAddressReplacements(result, '');
    }
  }
  
  return result;
}

/**
 * Synchronous version that only handles basic replacements
 * Use this when meeting data is provided directly in the context
 */
export function replaceEmailTemplateParamsSync(
  content: string,
  context: EmailTemplateContext
): string {
  if (!content) return '';
  
  const name = getName(context);
  let result = normalizeTemplateBraces(content);
  result = applyTemplateParam(result, 'name', name);
  result = applyTemplateParam(result, 'client_name', name);
  result = applyTemplateParam(result, 'lead_number', context.leadNumber || '');
  result = applyTemplateParam(result, 'lead_type', context.leadType || '');
  result = applyMeetingDateReplacements(result, context.meetingDate || '');
  result = applyMeetingTimeReplacements(result, context.meetingTime || '');
  result = applyLocationReplacements(
    result,
    context.meetingLocationRaw ?? context.meetingLocation ?? '',
  );
  result = applyMeetingLocationResolvedReplacements(
    result,
    context.meetingLocationResolved ?? context.meetingLocation ?? '',
  );
  result = applyMeetingLinkReplacements(result, context.meetingLink || '');
  result = applyMeetingAddressReplacements(result, context.meetingAddress || '');
  return result;
}

