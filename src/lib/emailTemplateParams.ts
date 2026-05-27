/**
 * Email Template Parameter Replacement
 * 
 * This module provides utilities for replacing template parameters in email templates.
 * Supports both client/contact info and meeting-related parameters.
 */

import { supabase } from './supabase';

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
  meetingLocation?: string | null;
  meetingLink?: string | null;
  /** meetings.manual_address — replaces {{address}} / {address} in templates */
  meetingAddress?: string | null;
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
async function getMeetingLocation(clientId: string | null, isLegacyLead: boolean): Promise<string> {
  if (!clientId) return '';
  
  try {
    const {
      getMeetingLocation
    } = await import('./whatsappTemplateParams');
    
    return await getMeetingLocation(clientId, isLegacyLead);
  } catch (error) {
    console.error('Error fetching meeting location:', error);
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

async function getMeetingManualAddress(clientId: string | null, isLegacyLead: boolean): Promise<string> {
  if (!clientId) return '';

  try {
    const { getMeetingManualAddress: fetchManualAddress } = await import('./whatsappTemplateParams');
    return await fetchManualAddress(clientId, isLegacyLead);
  } catch (error) {
    console.error('Error fetching meeting manual_address:', error);
    return '';
  }
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
 * - {location} or {{location}} or {{meeting_location}} - Meeting location
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

function applyMeetingLocationReplacements(result: string, value: string): string {
  let out = applyTemplateParam(result, 'location', value);
  out = applyTemplateParam(out, 'meeting_location', value);
  return out;
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
  const hasLocation =
    templateHasParam(result, 'location') || templateHasParam(result, 'meeting_location');
  const hasLink = templateHasParam(result, 'link');
  const hasAddress = templateHasParam(result, 'address');
  
  // If meeting info is provided directly, use it
  if (context.meetingDate !== undefined || context.meetingTime !== undefined || 
      context.meetingLocation !== undefined || context.meetingLink !== undefined) {
    result = applyMeetingDateReplacements(result, context.meetingDate || '');
    result = applyMeetingTimeReplacements(result, context.meetingTime || '');
    result = applyMeetingLocationReplacements(result, context.meetingLocation || '');
    result = applyMeetingLinkReplacements(result, context.meetingLink || '');
  } 
  // Otherwise, fetch from database if any meeting parameters are present
  else if ((hasDate || hasTime || hasLocation || hasLink) && (context.clientId || context.legacyId)) {
    try {
      const { clientIdForMeeting, isLegacyLead } = resolveClientIdForMeetingFetch(context);
      
      if (clientIdForMeeting) {
        // Fetch meeting data in parallel (only fetch what's needed)
        const [meetingDate, meetingTime, meetingLocation, meetingLink] = await Promise.all([
          hasDate ? getMeetingDate(clientIdForMeeting, isLegacyLead) : Promise.resolve(''),
          hasTime ? getMeetingTime(clientIdForMeeting, isLegacyLead) : Promise.resolve(''),
          hasLocation ? getMeetingLocation(clientIdForMeeting, isLegacyLead) : Promise.resolve(''),
          hasLink ? getMeetingLink(clientIdForMeeting, isLegacyLead) : Promise.resolve(''),
        ]);
        
        result = applyMeetingDateReplacements(result, meetingDate || '');
        result = applyMeetingTimeReplacements(result, meetingTime || '');
        result = applyMeetingLocationReplacements(result, meetingLocation || '');
        result = applyMeetingLinkReplacements(result, meetingLink || '');
      } else {
        // No valid client ID, replace with empty strings
        result = applyMeetingDateReplacements(result, '');
        result = applyMeetingTimeReplacements(result, '');
        result = applyMeetingLocationReplacements(result, '');
        result = applyMeetingLinkReplacements(result, '');
      }
    } catch (error) {
      console.error('Error fetching meeting data for template:', error);
      // On error, replace with empty strings
      result = applyMeetingDateReplacements(result, '');
      result = applyMeetingTimeReplacements(result, '');
      result = applyMeetingLocationReplacements(result, '');
      result = applyMeetingLinkReplacements(result, '');
    }
  }

  if (context.meetingAddress !== undefined) {
    result = applyMeetingAddressReplacements(result, context.meetingAddress || '');
  } else if (hasAddress && (context.clientId || context.legacyId)) {
    try {
      const { clientIdForMeeting, isLegacyLead } = resolveClientIdForMeetingFetch(context);
      if (clientIdForMeeting) {
        const meetingAddress = await getMeetingManualAddress(clientIdForMeeting, isLegacyLead);
        result = applyMeetingAddressReplacements(result, meetingAddress || '');
      } else {
        result = applyMeetingAddressReplacements(result, '');
      }
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
  result = applyMeetingLocationReplacements(result, context.meetingLocation || '');
  result = applyMeetingLinkReplacements(result, context.meetingLink || '');
  result = applyMeetingAddressReplacements(result, context.meetingAddress || '');
  return result;
}

