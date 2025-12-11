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

/**
 * Replace all template parameters in email content
 * 
 * Supported parameters:
 * - {name} or {client_name} - Client/contact name
 * - {lead_number} - Lead number
 * - {topic} - Topic/category
 * - {lead_type} - Lead type (legacy/new)
 * - {date} - Meeting date
 * - {time} - Meeting time
 * - {location} - Meeting location
 * - {link} - Meeting link
 * 
 * @param content - The email template content
 * @param context - Context object with client/contact and meeting info
 * @returns Promise<string> - The content with all parameters replaced
 */
export async function replaceEmailTemplateParams(
  content: string,
  context: EmailTemplateContext
): Promise<string> {
  if (!content) return '';
  
  let result = content;
  
  // Basic synchronous replacements
  const name = getName(context);
  result = result
    .replace(/\{name\}/gi, name)
    .replace(/\{client_name\}/gi, name)
    .replace(/\{lead_number\}/gi, context.leadNumber || '')
    .replace(/\{topic\}/gi, context.topic || '')
    .replace(/\{lead_type\}/gi, context.leadType || '');
  
  // Check if any meeting parameters need to be replaced
  const hasDate = /\{date\}/i.test(result);
  const hasTime = /\{time\}/i.test(result);
  const hasLocation = /\{location\}/i.test(result);
  const hasLink = /\{link\}/i.test(result);
  
  // If meeting info is provided directly, use it
  if (context.meetingDate !== undefined || context.meetingTime !== undefined || 
      context.meetingLocation !== undefined || context.meetingLink !== undefined) {
    result = result
      .replace(/\{date\}/gi, context.meetingDate || '')
      .replace(/\{time\}/gi, context.meetingTime || '')
      .replace(/\{location\}/gi, context.meetingLocation || '')
      .replace(/\{link\}/gi, context.meetingLink || '');
  } 
  // Otherwise, fetch from database if any meeting parameters are present
  else if ((hasDate || hasTime || hasLocation || hasLink) && (context.clientId || context.legacyId)) {
    try {
      // Determine if it's a legacy lead and get the client ID
      const isLegacyLead = context.leadType === 'legacy' || 
                          context.legacyId !== null || 
                          context.legacyId !== undefined ||
                          (context.clientId !== null && 
                           typeof context.clientId === 'string' && 
                           context.clientId.startsWith('legacy_'));
      
      let clientIdForMeeting: string | null = null;
      
      if (isLegacyLead) {
        // For legacy leads, use legacyId if available, or extract from clientId
        if (context.legacyId !== null && context.legacyId !== undefined) {
          clientIdForMeeting = context.legacyId.toString();
        } else if (context.clientId && typeof context.clientId === 'string') {
          // Extract numeric ID from clientId (might be "legacy_123" or just a number string)
          const numeric = parseInt(context.clientId.replace(/[^0-9]/g, ''), 10);
          clientIdForMeeting = isNaN(numeric) ? null : numeric.toString();
        }
      } else {
        // For new leads, use clientId directly
        clientIdForMeeting = context.clientId || null;
      }
      
      if (clientIdForMeeting) {
        // Fetch meeting data in parallel (only fetch what's needed)
        const [meetingDate, meetingTime, meetingLocation, meetingLink] = await Promise.all([
          hasDate ? getMeetingDate(clientIdForMeeting, isLegacyLead) : Promise.resolve(''),
          hasTime ? getMeetingTime(clientIdForMeeting, isLegacyLead) : Promise.resolve(''),
          hasLocation ? getMeetingLocation(clientIdForMeeting, isLegacyLead) : Promise.resolve(''),
          hasLink ? getMeetingLink(clientIdForMeeting, isLegacyLead) : Promise.resolve('')
        ]);
        
        result = result
          .replace(/\{date\}/gi, meetingDate || '')
          .replace(/\{time\}/gi, meetingTime || '')
          .replace(/\{location\}/gi, meetingLocation || '')
          .replace(/\{link\}/gi, meetingLink || '');
      } else {
        // No valid client ID, replace with empty strings
        result = result
          .replace(/\{date\}/gi, '')
          .replace(/\{time\}/gi, '')
          .replace(/\{location\}/gi, '')
          .replace(/\{link\}/gi, '');
      }
    } catch (error) {
      console.error('Error fetching meeting data for template:', error);
      // On error, replace with empty strings
      result = result
        .replace(/\{date\}/gi, '')
        .replace(/\{time\}/gi, '')
        .replace(/\{location\}/gi, '')
        .replace(/\{link\}/gi, '');
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
  return content
    .replace(/\{name\}/gi, name)
    .replace(/\{client_name\}/gi, name)
    .replace(/\{lead_number\}/gi, context.leadNumber || '')
    .replace(/\{topic\}/gi, context.topic || '')
    .replace(/\{lead_type\}/gi, context.leadType || '')
    .replace(/\{date\}/gi, context.meetingDate || '')
    .replace(/\{time\}/gi, context.meetingTime || '')
    .replace(/\{location\}/gi, context.meetingLocation || '')
    .replace(/\{link\}/gi, context.meetingLink || '');
}

