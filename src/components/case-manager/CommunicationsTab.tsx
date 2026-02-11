import React, { useState, useEffect, useCallback, Fragment, useMemo, useRef } from 'react';
import { ClientInteractionsCache } from '../../types/client';
import TimelineHistoryButtons from '../client-tabs/TimelineHistoryButtons';
import EmojiPicker from 'emoji-picker-react';
import {
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PhoneIcon,
  ArrowUturnRightIcon,
  ArrowUturnLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  PencilSquareIcon,
  PaperClipIcon,
  XMarkIcon,
  UserIcon,
  PaperAirplaneIcon,
  FaceSmileIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  StopIcon,
  SpeakerWaveIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  DocumentTextIcon,
  LinkIcon,
  UserPlusIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { createPortal } from 'react-dom';
import AISummaryPanel from '../client-tabs/AISummaryPanel';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { useLocation, useNavigate } from 'react-router-dom';
import sanitizeHtml from 'sanitize-html';
import { buildApiUrl } from '../../lib/api';
import { fetchLegacyInteractions } from '../../lib/legacyInteractionsApi';
import { appendEmailSignature } from '../../lib/emailSignature';
import SchedulerWhatsAppModal from '../SchedulerWhatsAppModal';
import ContactSelectorModal from '../ContactSelectorModal';
import EmailThreadModal from '../EmailThreadModal';
import { stripSignatureAndQuotedTextPreserveHtml } from '../../lib/graphEmailSync';
import {
  sendEmailViaBackend,
  triggerMailboxSync,
  fetchEmailBodyFromBackend,
  downloadAttachmentFromBackend,
  getMailboxLoginUrl,
  getMailboxStatus,
} from '../../lib/mailboxApi';
import { useAuthContext } from '../../contexts/AuthContext';
import { fetchLeadContacts } from '../../lib/contactHelpers';
import type { ContactInfo } from '../../lib/contactHelpers';
import { fetchWhatsAppTemplates, type WhatsAppTemplate } from '../../lib/whatsappTemplates';
import { replaceEmailTemplateParams } from '../../lib/emailTemplateParams';

const normalizeEmailForFilter = (value?: string | null) =>
  value ? value.trim().toLowerCase() : '';

const sanitizeEmailForFilter = (value: string) =>
  value.replace(/[^a-z0-9@._+!~-]/g, '');

// Extract visible text from HTML for RTL detection (ignore HTML tags and metadata)
const extractVisibleText = (html?: string | null): string => {
  if (!html) return '';
  // Remove HTML tags but preserve text content
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || '';
};

const containsRTL = (text?: string | null) => {
  if (!text) return false;
  // Check only visible text content, not HTML tags
  const visibleText = extractVisibleText(text);
  return /[\u0590-\u05FF]/.test(visibleText);
};

// Get direction for plain text (no HTML)
const getTextDirection = (text?: string | null): 'rtl' | 'ltr' => {
  if (!text) return 'ltr';
  return /[\u0590-\u05FF]/.test(text) ? 'rtl' : 'ltr';
};

const getMessageDirection = (message: any): 'rtl' | 'ltr' => {
  // Check subject (plain text)
  if (message.subject && /[\u0590-\u05FF]/.test(message.subject)) {
    return 'rtl';
  }
  // Check body_html or bodyPreview (extract visible text only)
  if (message.bodyPreview && containsRTL(message.bodyPreview)) {
    return 'rtl';
  }
  return 'ltr';
};

// Format time with date and time - shows full date and time
const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  
  // Compare dates by calendar day (ignore time) to properly detect today/yesterday
  const dateStartOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowStartOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((nowStartOfDay.getTime() - dateStartOfDay.getTime()) / (1000 * 60 * 60 * 24));

  const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (diffDays === 0) {
    // Today: show "Today at HH:MM"
    return `Today at ${timeString}`;
  } else if (diffDays === 1) {
    // Yesterday: show "Yesterday at HH:MM"
    return `Yesterday at ${timeString}`;
  } else if (diffDays <= 7) {
    // Within a week: show weekday, date, and time
    const weekday = date.toLocaleDateString([], { weekday: 'short' });
    const monthDay = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${weekday}, ${monthDay} at ${timeString}`;
  } else {
    // Older: show full date and time
    const dateString = date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    return `${dateString} at ${timeString}`;
  }
};

// Format date separator
const formatDateSeparator = (timestamp: string) => {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  const diffTime = today.getTime() - date.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

const collectClientEmails = (client: any): string[] => {
  const emails: string[] = [];
  const pushEmail = (val?: string | null) => {
    const normalized = normalizeEmailForFilter(val);
    if (normalized) {
      emails.push(normalized);
    }
  };

  pushEmail(client?.email);

  const extraEmails = (client as any)?.emails;
  if (Array.isArray(extraEmails)) {
    extraEmails.forEach((entry: any) => {
      if (typeof entry === 'string') {
        pushEmail(entry);
      } else if (entry && typeof entry === 'object') {
        if (typeof entry.email === 'string') {
          pushEmail(entry.email);
        }
        if (typeof entry.value === 'string') {
          pushEmail(entry.value);
        }
        if (typeof entry.address === 'string') {
          pushEmail(entry.address);
        }
      }
    });
  }

  return Array.from(new Set(emails));
};

const buildEmailFilterClauses = (params: {
  clientId?: string | null;
  legacyId?: number | null;
  emails: string[];
}) => {
  const clauses: string[] = [];

  if (params.legacyId !== undefined && params.legacyId !== null && !Number.isNaN(params.legacyId)) {
    clauses.push(`legacy_id.eq.${params.legacyId}`);
  }

  if (params.clientId) {
    clauses.push(`client_id.eq.${params.clientId}`);
  }

  params.emails.forEach((email) => {
    const sanitized = sanitizeEmailForFilter(email);
    if (sanitized) {
      clauses.push(`sender_email.ilike.${sanitized}`);
      clauses.push(`recipient_list.ilike.%${sanitized}%`);
    }
  });

  return clauses;
};

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  sizeInBytes: number;
  isInline: boolean;
  contentUrl?: string; // For download
}

interface CallLog {
  id: number;
  cdate: string;
  udate?: string;
  direction?: string;
  date?: string;
  time?: string;
  source?: string;
  incomingdid?: string;
  destination?: string;
  status?: string;
  url?: string;
  call_id?: string;
  action?: string;
  duration?: number;
  lead_id?: number;
  lead_interaction_id?: number;
  employee_id?: number;
}

interface Interaction {
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
  error_message?: string; // Add error message field for WhatsApp failures
  call_log?: CallLog; // Add call log data for call interactions
  recording_url?: string; // Add recording URL for call interactions
  call_duration?: number; // Add call duration for call interactions
  body_html?: string | null;
  body_preview?: string | null;
  renderedContent?: string;
  renderedContentFallback?: string;
  contact_id?: number | null; // Contact ID for email, WhatsApp, and manual interactions
  contact_name?: string; // Contact name for manual interactions
  sender_email?: string | null; // Sender email for email interactions
  recipient_list?: string | null; // Recipient list for email interactions
  phone_number?: string | null; // Phone number for WhatsApp interactions
  recipient_name?: string | null; // Recipient name for "To:" display in timeline
}

interface EmailTemplate {
  id: number;
  name: string;
  subject: string | null;
  content: string;
  rawContent: string;
  languageId: string | null;
  languageName: string | null;
  placementId: number | null;
  placementName: string | null;
}

const contactMethods = [
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Call' },
  { value: 'sms', label: 'SMS' },
  { value: 'office', label: 'In Office' },
];

const extractHtmlBody = (html: string) => {
  if (!html) return html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
};

// Helper function to format email HTML with line breaks and RTL support
// Process email HTML to convert cid: references to data URLs from inline attachments
const processEmailHtmlWithInlineImages = (html: string, attachments: any[] = []): string => {
  if (!html || !attachments || attachments.length === 0) return html;
  
  // Find all inline attachments - check multiple field name variations
  const inlineAttachments = attachments.filter((att: any) => {
    if (!att) return false;
    
    // Check if it's an inline attachment (has contentId/content_id OR isInline flag)
    const hasContentId = !!(att.contentId || att.content_id || att.contentID);
    const isInline = att.isInline === true;
    
    // Check for contentBytes in various field name formats
    const hasContentBytes = !!(att.contentBytes || att.content_bytes || att.contentBytesBase64);
    
    return (hasContentId || isInline) && hasContentBytes;
  });
  
  if (inlineAttachments.length === 0) return html;
  
  // Create a map of Content-ID to data URL
  const cidToDataUrl = new Map<string, string>();
  
  inlineAttachments.forEach((att: any) => {
    try {
      const contentId = att.contentId || att.content_id || att.contentID;
      const contentBytes = att.contentBytes || att.content_bytes || att.contentBytesBase64;
      
      if (!contentId || !contentBytes) return;
      
      // Convert base64 contentBytes to data URL
      // Handle both raw base64 and data: URLs
      let base64Data = contentBytes;
      if (contentBytes.startsWith('data:')) {
        // Already a data URL, use it directly
        base64Data = contentBytes;
      } else {
        // Assume it's base64, construct data URL
        const contentType = att.contentType || att.content_type || att.mimeType || 'image/png';
        base64Data = `data:${contentType};base64,${contentBytes}`;
      }
      
      // Store both with and without angle brackets (some emails use <cid:...>, others use cid:...)
      const cidValue = contentId.replace(/^<|>$/g, '').trim(); // Remove angle brackets if present
      cidToDataUrl.set(`cid:${cidValue}`, base64Data);
      cidToDataUrl.set(`<cid:${cidValue}>`, base64Data);
      cidToDataUrl.set(`cid:<${cidValue}>`, base64Data);
      cidToDataUrl.set(cidValue, base64Data); // Also match without cid: prefix
    } catch (error) {
      console.error('Error processing inline attachment:', error, att);
    }
  });
  
  if (cidToDataUrl.size === 0) return html;
  
  // Replace all cid: references in img src attributes
  let processedHtml = html;
  
  // Match img tags with cid: references in src attribute (various formats)
  processedHtml = processedHtml.replace(/<img([^>]*?)src\s*=\s*["'](cid:[^"']+)["']([^>]*?)>/gi, (match, before, cidRef, after) => {
    const cidValue = cidRef.replace(/^cid:/i, '').replace(/^<|>$/g, '').trim();
    const dataUrl = cidToDataUrl.get(`cid:${cidValue}`) || 
                    cidToDataUrl.get(`<cid:${cidValue}>`) || 
                    cidToDataUrl.get(`cid:<${cidValue}>`) ||
                    cidToDataUrl.get(cidValue);
    
    if (dataUrl) {
      // Preserve other attributes and replace src
      return `<img${before}src="${dataUrl}"${after}>`;
    }
    return match; // Keep original if no match found
  });
  
  // Also handle cid: references that might be in other formats or contexts
  cidToDataUrl.forEach((dataUrl, cidKey) => {
    // Replace standalone cid: references in src attributes
    const escapedCid = cidKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(src=["'])${escapedCid}(["'])`, 'gi');
    processedHtml = processedHtml.replace(regex, `$1${dataUrl}$2`);
  });
  
  return processedHtml;
};

const formatEmailHtmlForDisplay = (html: string | null | undefined): string => {
  if (!html) return '';
  
  // First extract body content if wrapped in body tags
  let content = extractHtmlBody(html);
  
  // Normalize line endings first
  content = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  
  // Normalize multiple consecutive line breaks (collapse 3+ to 2 for paragraph spacing)
  content = content.replace(/\n{3,}/g, '\n\n');
  
  // CRITICAL: Always convert \n to <br> tags, regardless of HTML structure
  // Strategy: 
  // 1. Protect existing <br> tags with a placeholder
  // 2. Convert all newlines to <br> tags (even inside HTML tags - we'll handle this properly)
  // 3. Restore original <br> tags
  // 4. Clean up any <br> tags that ended up inside HTML tags
  
  const brPlaceholder = '__BR_PLACEHOLDER__';
  
  // Protect existing <br> tags (including self-closing variants)
  content = content.replace(/<br\s*\/?>/gi, brPlaceholder);
  
  // Now convert ALL newlines to <br> tags, even those inside or between HTML tags
  // Handle double newlines (paragraph breaks) separately
  content = content.replace(/\n\n/g, '__PARA_BREAK__');
  content = content.replace(/\n/g, '<br>');
  content = content.replace(/__PARA_BREAK__/g, '<br><br>');
  
  // Restore the original <br> tags
  content = content.replace(new RegExp(brPlaceholder, 'g'), '<br>');
  
  // Clean up <br> tags that ended up inside HTML tags (between < and >)
  // This regex finds <br> tags that are inside HTML tag boundaries and removes them
  content = content.replace(/<([^>]+)<br>([^>]*)>/gi, '<$1 $2>');
  content = content.replace(/<([^>]*)<br>([^>]+)>/gi, '<$1 $2>');
  
  // Normalize whitespace around HTML tags (but preserve intentional spacing)
  content = content.replace(/>\s+/g, '>');
  content = content.replace(/\s+</g, '<');
  
  // Collapse 3+ consecutive <br> tags (with optional whitespace) to exactly 2
  content = content.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
  
  // Remove any remaining newlines (shouldn't be any, but just in case)
  content = content.replace(/\n/g, ' ');
  
  // Clean up excessive whitespace between tags
  content = content.replace(/(>)\s{2,}(<)/g, '$1 $2');
  
  // Remove leading/trailing whitespace
  content = content.trim();
  
  // If content doesn't already have a wrapper div with direction, add one with auto direction
  const hasDirection = /dir\s*=\s*["'](rtl|ltr|auto)["']/i.test(content);
  const hasWrapperDiv = /^<div[^>]*dir/i.test(content.trim());
  
  if (!hasDirection && !hasWrapperDiv) {
    // Wrap with auto direction - let browser determine based on content
    content = `<div dir="auto" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${content}</div>`;
  }
  
  return content;
};

const parseTemplateContent = (rawContent: string | null | undefined): string => {
  if (!rawContent) return '';

  const sanitizeTemplateText = (text: string) => {
    if (!text) return '';

    return text
      .split('\n')
      .map(line => line.replace(/\s+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  };

  const tryParseDelta = (input: string) => {
    try {
      const parsed = JSON.parse(input);
      const ops = parsed?.delta?.ops || parsed?.ops;
      if (Array.isArray(ops)) {
        const text = ops
          .map((op: any) => (typeof op?.insert === 'string' ? op.insert : ''))
          .join('');
        return sanitizeTemplateText(text);
      }
    } catch (error) {
      // ignore
    }
    return null;
  };

  const cleanHtml = (input: string) => {
    let text = input;

    const htmlMatch = text.match(/html\s*:\s*(.*)/is);
    if (htmlMatch) {
      text = htmlMatch[1];
    }

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
  if (text !== null) {
    return text;
  }

  text = tryParseDelta(
    rawContent
      .replace(/^"|"$/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
  );
  if (text !== null) {
    return text;
  }

  const normalised = rawContent
    .replace(/\\"/g, '"')
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  const insertRegex = /"?insert"?\s*:\s*"([^"\n]*)"/g;
  const inserts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(normalised))) {
    inserts.push(match[1]);
  }
  if (inserts.length > 0) {
    const combined = inserts.join('');
    const decoded = combined.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return sanitizeTemplateText(decoded);
  }

  return sanitizeTemplateText(cleanHtml(rawContent));
};

const normaliseAddressList = (value: string | null | undefined) => {
  if (!value) return [] as string[];
  return value
    .split(/[;,]+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
};

const convertBodyToHtml = (text: string) => {
  if (!text) return '';
  // First, protect existing anchor tags by replacing them with placeholders
  const anchorPlaceholders: string[] = [];
  let placeholderIndex = 0;
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  const textWithPlaceholders = text.replace(anchorRegex, (match) => {
    anchorPlaceholders.push(match);
    return `__ANCHOR_PLACEHOLDER_${placeholderIndex++}__`;
  });
  
  // Convert plain URLs to links (but skip those already in anchor tags)
  const urlRegex = /(https?:\/\/[^\s<>]+)/gi;
  const escaped = textWithPlaceholders.replace(urlRegex, url => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  
  // Restore original anchor tags
  let result = escaped;
  anchorPlaceholders.forEach((anchor, index) => {
    result = result.replace(`__ANCHOR_PLACEHOLDER_${index}__`, anchor);
  });
  
  // Preserve line breaks: convert \n to <br>
  result = result
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\r/g, '\n')    // Handle old Mac line endings
    .replace(/\n/g, '<br>'); // Convert to HTML line breaks
  
  // Wrap with auto direction - let the browser determine based on content
  result = `<div dir="auto" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${result}</div>`;
  
  return result;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const replaceTemplateTokens = async (content: string, client: any) => {
  if (!content) return '';
  
  const isLegacyLead = client?.lead_type === 'legacy' || 
                       (client?.id && typeof client.id === 'string' && client.id.startsWith('legacy_'));
  
  // Determine client ID and legacy ID
  let clientId: string | null = null;
  let legacyId: number | null = null;
  
  if (isLegacyLead) {
    if (client?.id) {
      const numeric = parseInt(client.id.toString().replace(/[^0-9]/g, ''), 10);
      legacyId = isNaN(numeric) ? null : numeric;
      clientId = legacyId?.toString() || null;
    }
  } else {
    clientId = client?.id || null;
  }
  
  const context = {
    clientId,
    legacyId,
    clientName: client?.name || null,
    contactName: client?.name || null,
    leadNumber: client?.lead_number || null,
    topic: client?.topic || null,
    leadType: client?.lead_type || null,
  };
  
  return await replaceEmailTemplateParams(content, context);
};

// Check if an email is from the office domain (always team/user, never client)
const isOfficeEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return email.toLowerCase().endsWith('@lawoffice.org.il');
};

// Build email-to-display-name mapping for all employees
const buildEmployeeEmailToNameMap = async (): Promise<Map<string, string>> => {
  const emailToNameMap = new Map<string, string>();
  
  try {
    // Fetch all employees and users in parallel
    const [employeesResult, usersResult] = await Promise.all([
      supabase
        .from('tenants_employee')
        .select('id, display_name')
        .not('display_name', 'is', null),
      supabase
        .from('users')
        .select('employee_id, email')
        .not('email', 'is', null)
    ]);
    
    if (employeesResult.error || usersResult.error) {
      console.error('Error fetching employees/users for email mapping:', employeesResult.error || usersResult.error);
      return emailToNameMap;
    }
    
    // Create employee_id to email mapping from users table
    const employeeIdToEmail = new Map<number, string>();
    usersResult.data?.forEach((user: any) => {
      if (user.employee_id && user.email) {
        employeeIdToEmail.set(user.employee_id, user.email.toLowerCase());
      }
    });
    
    // Map emails to display names
    employeesResult.data?.forEach((emp: any) => {
      if (!emp.display_name) return;
      
      // Method 1: Use email from users table (employee_id match)
      const emailFromUsers = employeeIdToEmail.get(emp.id);
      if (emailFromUsers) {
        emailToNameMap.set(emailFromUsers, emp.display_name);
      }
      
      // Method 2: Use pattern matching (display_name.toLowerCase().replace(/\s+/g, '.') + '@lawoffice.org.il')
      const patternEmail = `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
      emailToNameMap.set(patternEmail, emp.display_name);
    });
  } catch (error) {
    console.error('Error building employee email-to-name map:', error);
  }
  
  return emailToNameMap;
};

const emailTemplates = [
  {
    name: 'Document Reminder',
    subject: 'Reminder: Required Documents for Your Application',
    body: `Dear {client_name},\n\nAs part of your application process, we kindly remind you to upload the required documents to your client portal.\n\nThis will help us proceed without delays. If you need assistance or are unsure which documents are still needed, please contact us.\n\nYou can upload documents here: {upload_link}\n\nThank you for your cooperation.`,
  },
  {
    name: 'Application Submission Confirmation',
    subject: 'Confirmation: Your Application Has Been Submitted',
    body: `Dear {client_name},\n\nWe're pleased to inform you that your application has been successfully submitted to the relevant authorities.\n\nYou will be notified once there are any updates or additional requirements. Please note that processing times may vary depending on the case.\n\nIf you have any questions or wish to discuss the next steps, feel free to contact your case manager.`,
  },
];

// Component to handle truncated content with expand/collapse
const TruncatedContent: React.FC<{ 
  content: string; 
  maxCharacters: number;
  direction?: 'rtl' | 'ltr' | 'auto';
  subject?: string;
}> = ({ content, maxCharacters, direction, subject }) => {
  // Helper function to truncate HTML content by character count (text only)
  const truncateHtmlByChars = (html: string, maxChars: number): { truncated: string; isTruncated: boolean } => {
    if (!html) return { truncated: '', isTruncated: false };
    
    // Remove HTML tags to count actual text characters
    const textContent = html.replace(/<[^>]*>/g, '');
    if (textContent.length <= maxChars) {
      return { truncated: html, isTruncated: false };
    }
    
    // Find the truncation point in the text
    let charCount = 0;
    let truncatedHtml = '';
    let inTag = false;
    let tagBuffer = '';
    
    for (let i = 0; i < html.length; i++) {
      const char = html[i];
      
      if (char === '<') {
        inTag = true;
        tagBuffer = char;
      } else if (char === '>') {
        inTag = false;
        tagBuffer += char;
        truncatedHtml += tagBuffer;
        tagBuffer = '';
      } else if (inTag) {
        tagBuffer += char;
      } else {
        // Regular text character
        if (charCount < maxChars) {
          truncatedHtml += char;
          charCount++;
        } else {
          break;
        }
      }
    }
    
    // Close any open tags and add ellipsis
    truncatedHtml += '...';
    return { truncated: truncatedHtml, isTruncated: true };
  };
  
  const { truncated: truncatedContent, isTruncated } = truncateHtmlByChars(content, maxCharacters);
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div 
      className="text-sm sm:text-base text-gray-700 break-words mb-4"
      dir="auto"
      style={{ 
        lineHeight: '1.6'
      }}
    >
      {subject && (
        <div 
          className="font-bold text-base sm:text-lg mb-2 text-gray-900"
          dir="auto"
        >
          {subject}
        </div>
      )}
      <div 
        className="max-w-none whitespace-pre-wrap overflow-visible"
        style={{ lineHeight: '1.6', maxHeight: 'none' }}
        dir={direction || 'auto'}
        dangerouslySetInnerHTML={{ 
          __html: isExpanded ? content : truncatedContent
        }} 
      />
      {isTruncated && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
};

// Component to handle email content with error handling for broken HTML elements
const EmailContentWithErrorHandling: React.FC<{ html: string; emailId: string }> = ({ html, emailId }) => {
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!contentRef.current) return;

    // Find all images in the email content
    const images = contentRef.current.querySelectorAll('img');
    
    const handleImageError = (img: HTMLImageElement) => {
      // Remove the broken image tag
      console.log('Removing broken image:', img.src);
      img.remove();
    };

    // Attach error handlers to all images
    images.forEach((img) => {
      // Only attach if not already handled
      if (!img.hasAttribute('data-error-handled')) {
        img.setAttribute('data-error-handled', 'true');
        img.addEventListener('error', () => handleImageError(img), { once: true });
      }
    });

    // Also handle broken iframes, videos, and other embedded content
    const iframes = contentRef.current.querySelectorAll('iframe, video, embed, object');
    iframes.forEach((element) => {
      if (!element.hasAttribute('data-error-handled')) {
        element.setAttribute('data-error-handled', 'true');
        element.addEventListener('error', () => {
          console.log('Removing broken embedded content:', element.tagName);
          element.remove();
        }, { once: true });
      }
    });

    // Cleanup function
    return () => {
      images.forEach((img) => {
        const handler = () => handleImageError(img);
        img.removeEventListener('error', handler);
      });
    };
  }, [html, emailId]); // Re-run when email content changes

  return (
    <div
      ref={contentRef}
      dangerouslySetInnerHTML={{ __html: html }}
      className="prose prose-lg max-w-none text-gray-800 break-words email-content"
      style={{ 
        wordBreak: 'break-word', 
        overflowWrap: 'anywhere',
        whiteSpace: 'normal',
        lineHeight: '1.8',
        fontSize: '15px'
      }}
      dir="auto"
    />
  );
};

// Helper to get current user's full name from Supabase
// Join users.employee_id with tenants_employee.id to get display_name
async function fetchCurrentUserFullName() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.id) {
    const { data, error } = await supabase
      .from('users')
      .select(`
        full_name,
        employee_id,
        tenants_employee!employee_id(
          display_name
        )
      `)
      .eq('auth_id', user.id)
      .single();
    if (!error && data) {
      // Return display_name from tenants_employee if available, otherwise full_name
      const employee = Array.isArray(data.tenants_employee) ? data.tenants_employee[0] : data.tenants_employee;
      return employee?.display_name || data.full_name;
    }
  }
  return null;
}

// Utility to sanitize email HTML for modal view - preserve Outlook formatting
function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'b', 'i', 'u', 'ul', 'ol', 'li', 'br', 'strong', 'em', 'a', 'span', 'div', 'body', 'img', 'table', 'tbody', 'tr', 'td', 'th', 'thead', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'style'],
      span: ['style', 'dir', 'class', 'data-icon'],
      div: ['style', 'dir', 'class'],
      p: ['style', 'dir', 'class'],
      body: ['style', 'dir'],
      img: ['src', 'alt', 'style', 'width', 'height', 'crossorigin', 'class'],
      td: ['style', 'dir', 'colspan', 'rowspan', 'align'],
      th: ['style', 'dir', 'colspan', 'rowspan', 'align'],
      tr: ['style'],
      table: ['style', 'width', 'border', 'cellpadding', 'cellspacing'],
      '*': ['style', 'dir'], // Allow style and dir on any allowed tag
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    disallowedTagsMode: 'discard',
    // Preserve whitespace and structure better
    textFilter: (text) => {
      // Preserve Unicode characters including emojis
      return text;
    },
  });
}

const FETCH_BATCH_SIZE = 500;
const EMAIL_MODAL_LIMIT = 200;

// Helper component to handle employee avatar with image error fallback
const EmployeeAvatar: React.FC<{ photo: string | null; name: string; initials: string; avatarBg: string }> = ({ photo, name, initials, avatarBg }) => {
  const [imageError, setImageError] = React.useState(false);
  
  if (photo && !imageError) {
    return (
      <img
        src={photo}
        alt={name}
        className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full object-cover shadow-lg ring-2 ring-white`}
        onError={() => setImageError(true)}
      />
    );
  }
  
  return (
    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold shadow-lg ring-2 ring-white ${avatarBg} text-white text-sm sm:text-base`}>
      {initials}
    </div>
  );
};

interface HandlerLead {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  category?: string;
  stage: string;
  handler_stage?: string;
  created_at: string;
  balance?: number;
  balance_currency?: string;
  onedrive_folder_link?: string;
  expert?: string;
  handler?: string;
  closer?: string;
  scheduler?: string;
  manager?: string;
  manual_interactions?: any[];
  topic?: string;
  lead_type?: 'legacy' | 'new';
}

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles?: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId?: string | null;
  uploadedFiles?: { [leadId: string]: any[] };
  isUploading?: boolean;
  handleFileInput?: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads?: () => Promise<void>;
  onClientUpdate?: () => Promise<void>;
}

const CommunicationsTab: React.FC<HandlerTabProps> = ({
  leads,
  onClientUpdate,
}) => {
  // Use the first lead as the client
  const client = leads && leads.length > 0 ? leads[0] : null;
  
  if (!client) {
    return <div className="flex justify-center items-center h-32"><span className="loading loading-spinner loading-md text-primary"></span></div>;
  }
  
  // Determine if this is a legacy lead
  const isLegacyLead = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
  
  // Initialize optional props with defaults
  const interactionsCache: ClientInteractionsCache | null = null;
  const onInteractionsCacheUpdate = undefined;
  const onInteractionCountUpdate = undefined;
  const allEmployeesProp: any[] = [];
  
  // onClientUpdate is optional and already checked before use, so no need for default
  
  // Use local state for interactions - initialize from cache, persisted state, or empty
  // Direct sessionStorage access (more reliable than usePersistedState for this use case)
  const [interactions, setInteractions] = useState<Interaction[]>(() => {
    if (!client?.id) return [];
    
    // Priority: 1. Cache, 2. Persisted state from sessionStorage, 3. Empty array
    if (interactionsCache && interactionsCache.leadId === client.id) {
      return interactionsCache.interactions || [];
    }
    
    // Check sessionStorage for persisted interactions
    try {
      const persistedKey = `interactions_${client.id}`;
      const persisted = sessionStorage.getItem(persistedKey);
      if (persisted) {
        try {
          const parsed = JSON.parse(persisted);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`✅ Initializing interactions from sessionStorage for client ${client.id} (${parsed.length} interactions)`);
            return parsed;
          }
        } catch (e) {
          console.warn('Failed to parse persisted interactions on init:', e);
        }
      }
    } catch (e) {
      // sessionStorage might not be available
    }
    
    return [];
  });
  
  // Update interactions when cache changes (but only if we don't already have interactions)
  useEffect(() => {
    if (interactionsCache && interactionsCache.leadId === client?.id) {
      const cachedInteractions = interactionsCache.interactions || [];
      // Only update if we don't have interactions or if cache has more interactions
      if (cachedInteractions.length > 0 && (interactions.length === 0 || cachedInteractions.length > interactions.length)) {
        setInteractions(cachedInteractions);
        // Update count when loading from cache
        if (onInteractionCountUpdate) {
          const cachedCount = interactionsCache.count ?? cachedInteractions.length;
          onInteractionCountUpdate(cachedCount);
        }
      }
    }
  }, [interactionsCache, client?.id, onInteractionCountUpdate]);
  
  // Track if we've updated the count on initial load for the current client
  const hasUpdatedInitialCountRef = useRef<string | null>(null);
  
  // Reset the flag when client changes
  useEffect(() => {
    if (client?.id && hasUpdatedInitialCountRef.current !== client.id) {
      hasUpdatedInitialCountRef.current = null;
    }
  }, [client?.id]);
  
  // Update count on initial mount if interactions were loaded from sessionStorage or cache
  useEffect(() => {
    if (!client?.id) return;
    if (hasUpdatedInitialCountRef.current === client.id) return; // Already updated for this client
    
    if (interactions.length > 0 && onInteractionCountUpdate) {
      // Check if these interactions are from sessionStorage (initial load)
      try {
        const persistedKey = `interactions_${client.id}`;
        const persisted = sessionStorage.getItem(persistedKey);
        if (persisted) {
          try {
            const parsed = JSON.parse(persisted);
            if (Array.isArray(parsed) && parsed.length === interactions.length) {
              // These are from sessionStorage, update count
              console.log(`✅ Updating count from initial sessionStorage load: ${interactions.length}`);
              onInteractionCountUpdate(interactions.length);
              hasUpdatedInitialCountRef.current = client.id;
              return;
            }
          } catch (e) {
            // Continue to update count
          }
        }
        
        // Also check cache
        if (interactionsCache && interactionsCache.leadId === client.id) {
          const cachedCount = interactionsCache.count ?? interactions.length;
          console.log(`✅ Updating count from initial cache load: ${cachedCount}`);
          onInteractionCountUpdate(cachedCount);
          hasUpdatedInitialCountRef.current = client.id;
          return;
        }
        
        // Fallback: update count from interactions length
        console.log(`✅ Updating count from initial interactions: ${interactions.length}`);
        onInteractionCountUpdate(interactions.length);
        hasUpdatedInitialCountRef.current = client.id;
      } catch (e) {
        // sessionStorage not available, but still update count
        if (onInteractionCountUpdate && interactions.length > 0) {
          onInteractionCountUpdate(interactions.length);
          hasUpdatedInitialCountRef.current = client.id;
        }
      }
    }
  }, [interactions.length, client?.id, onInteractionCountUpdate, interactionsCache]);
  
  // Persist interactions to sessionStorage whenever they change (for tab switching)
  // Also update the client ID ref to track which client these interactions belong to
  useEffect(() => {
    if (interactions.length > 0 && client?.id) {
      interactionsClientIdRef.current = client.id.toString();
      try {
        const persistedKey = `interactions_${client.id}`;
        sessionStorage.setItem(persistedKey, JSON.stringify(interactions));
      } catch (e) {
        console.warn('Failed to persist interactions to sessionStorage:', e);
      }
    } else if (!client?.id || interactions.length === 0) {
      interactionsClientIdRef.current = null;
    }
  }, [interactions, client?.id]);
  
  const [employeePhoneMap, setEmployeePhoneMap] = useState<Map<string, string>>(new Map()); // phone/ext -> display_name
  const [employeePhotoMap, setEmployeePhotoMap] = useState<Map<string, string>>(new Map()); // display_name -> photo_url
  
  // Use employees from prop (loaded in parent) or fallback to local state
  const [allEmployees, setAllEmployees] = useState<any[]>(allEmployeesProp);
  
  // Update local employees state when prop changes (employees are loaded in parent)
  useEffect(() => {
    if (allEmployeesProp && allEmployeesProp.length > 0) {
      setAllEmployees(allEmployeesProp);
    }
  }, [allEmployeesProp]);

  // Helper function to get employee display name from ID (similar to RolesTab)
  const getEmployeeDisplayName = useMemo(() => {
    return (employeeId: string | number | null | undefined, employees: any[] = allEmployees) => {
      if (!employeeId || employeeId === '---' || employeeId === null || employeeId === undefined) return '---';

      // Convert employeeId to number for comparison
      const idAsNumber = typeof employeeId === 'string' ? parseInt(employeeId, 10) : Number(employeeId);

      if (isNaN(idAsNumber)) {
        // If not a number, assume it's already a display name
        return String(employeeId);
      }

      // Find employee by ID - try both string and number comparison
      const employee = employees.find((emp: any) => {
        const empId = typeof emp.id === 'string' ? parseInt(emp.id, 10) : Number(emp.id);
        return !isNaN(empId) && empId === idAsNumber;
      });

      if (employee && employee.display_name) {
        return employee.display_name;
      }

      return '---';
    };
  }, [allEmployees]);
  const [editIndex, setEditIndex] = useState<number|null>(null);
  const [editData, setEditData] = useState({ date: '', time: '', content: '', observation: '', length: '', direction: 'out' as 'in' | 'out' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [newContact, setNewContact] = useState({
    method: 'email',
    date: '',
    time: '',
    length: '',
    content: '',
    observation: '',
    direction: 'out', // 'out' = we contacted client, 'in' = client contacted us
    contact_id: null as number | null,
    contact_name: '', // For display
  });
  const [manualInteractionContacts, setManualInteractionContacts] = useState<Array<{ id: number; name: string; email?: string | null; phone?: string | null; mobile?: string | null }>>([]);
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const [mailboxStatus, setMailboxStatus] = useState<{ connected: boolean; mailbox?: string | null; lastSyncedAt?: string | null }>({
    connected: false,
    mailbox: null,
    lastSyncedAt: null,
  });
  const [isMailboxLoading, setIsMailboxLoading] = useState(false);
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [emails, setEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailSearchQuery, setEmailSearchQuery] = useState('');
  const [isSearchBarOpen, setIsSearchBarOpen] = useState(false);
  const [interactionsLoading, setInteractionsLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeBodyIsRTL, setComposeBodyIsRTL] = useState(false);
  const [composeToRecipients, setComposeToRecipients] = useState<string[]>([]);
  const [composeCcRecipients, setComposeCcRecipients] = useState<string[]>([]);
  const [composeToInput, setComposeToInput] = useState('');
  const [composeCcInput, setComposeCcInput] = useState('');
  const [composeRecipientError, setComposeRecipientError] = useState<string | null>(null);
  
  // Employee autocomplete state for compose
  const [composeEmployees, setComposeEmployees] = useState<Array<{ email: string; name: string }>>([]);
  const [composeToSuggestions, setComposeToSuggestions] = useState<Array<{ email: string; name: string }>>([]);
  const [composeCcSuggestions, setComposeCcSuggestions] = useState<Array<{ email: string; name: string }>>([]);
  const [showComposeToSuggestions, setShowComposeToSuggestions] = useState(false);
  const [showComposeCcSuggestions, setShowComposeCcSuggestions] = useState(false);
  const composeToSuggestionsRef = useRef<HTMLDivElement>(null);
  const composeCcSuggestionsRef = useRef<HTMLDivElement>(null);
  
  // State for lead contacts (all contacts associated with the client)
  const [leadContacts, setLeadContacts] = useState<ContactInfo[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [showComposeLinkForm, setShowComposeLinkForm] = useState(false);
  const [composeLinkLabel, setComposeLinkLabel] = useState('');
  const [composeLinkUrl, setComposeLinkUrl] = useState('');
  
  // Lead contacts modal state
  const [showComposeContactsModal, setShowComposeContactsModal] = useState(false);
  const [composeLeadContacts, setComposeLeadContacts] = useState<ContactInfo[]>([]);
  const [composeSelectedContactIds, setComposeSelectedContactIds] = useState<Set<number>>(new Set());
  const [loadingComposeContacts, setLoadingComposeContacts] = useState(false);
  
  const [composeTemplates, setComposeTemplates] = useState<EmailTemplate[]>([]);
  const [composeTemplateSearch, setComposeTemplateSearch] = useState('');
  const [composeTemplateDropdownOpen, setComposeTemplateDropdownOpen] = useState(false);
  const [selectedComposeTemplateId, setSelectedComposeTemplateId] = useState<number | null>(null);
  const composeTemplateDropdownRef = useRef<HTMLDivElement | null>(null);
  
  // Template filters
  const [composeTemplateLanguageFilter, setComposeTemplateLanguageFilter] = useState<string | null>(null);
  const [composeTemplatePlacementFilter, setComposeTemplatePlacementFilter] = useState<number | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<Array<{ id: string; name: string }>>([]);
  const [availablePlacements, setAvailablePlacements] = useState<Array<{ id: number; name: string }>>([]);
  const [sending, setSending] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<{ name: string; contentType: string; contentBytes: string }[]>([]);
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [selectedEmailForView, setSelectedEmailForView] = useState<any | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<Interaction | null>(null);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showEmailDetail, setShowEmailDetail] = useState(false);
  const [showContactSelector, setShowContactSelector] = useState(false);
  const [showContactSelectorForEmail, setShowContactSelectorForEmail] = useState(false);
  const [selectedContactForWhatsApp, setSelectedContactForWhatsApp] = useState<{
    contact: ContactInfo;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null>(null);
  // Use a ref to store the contact immediately (before state updates)
  const selectedContactForWhatsAppRef = useRef<{
    contact: ContactInfo;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null>(null);
  const [selectedContactForEmail, setSelectedContactForEmail] = useState<{
    contact: ContactInfo;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null>(null);
  const [whatsAppInput, setWhatsAppInput] = useState("");
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const userFullNameLoadedRef = useRef(false);
  const [bodyFocused, setBodyFocused] = useState(false);
  const [footerHeight, setFooterHeight] = useState(72);
  const [composeOverlayOpen, setComposeOverlayOpen] = useState(false);
  const quillRef = useRef<ReactQuill>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeWhatsAppId, setActiveWhatsAppId] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<{url: string, type: 'image' | 'video', caption?: string} | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // AI suggestions state for email compose
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const formattedLastSync = useMemo(() => {
    if (!mailboxStatus.lastSyncedAt) return null;
    try {
      return new Date(mailboxStatus.lastSyncedAt).toLocaleString();
    } catch (error) {
      return null;
    }
  }, [mailboxStatus.lastSyncedAt]);

  const refreshMailboxStatus = useCallback(async () => {
    if (!userId) {
      setMailboxStatus({ connected: false, mailbox: null, lastSyncedAt: null });
      return;
    }
    try {
      setIsMailboxLoading(true);
      setMailboxError(null);
      const status = await getMailboxStatus(userId);
      setMailboxStatus({
        connected: Boolean(status?.connected),
        mailbox: status?.mailbox || status?.displayName || null,
        lastSyncedAt: status?.lastSyncedAt || status?.last_synced_at || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load mailbox status';
      setMailboxError(message);
      console.error('Mailbox status error:', error);
    } finally {
      setIsMailboxLoading(false);
    }
  }, [userId]);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Reset email detail view when modal closes
  useEffect(() => {
    if (!isEmailModalOpen) {
      setShowEmailDetail(false);
      setSelectedEmailForView(null);
    }
  }, [isEmailModalOpen]);

  const mailboxStatusRequestedRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    // Reset to true on mount
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('msal') === 'success') {
      const connectedMailbox = params.get('mailbox');
      toast.success(connectedMailbox ? `Mailbox ${connectedMailbox} connected` : 'Mailbox connected');
      params.delete('msal');
      params.delete('mailbox');
      const newSearch = params.toString();
      const newUrl = `${location.pathname}${newSearch ? `?${newSearch}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      mailboxStatusRequestedRef.current = false;
      refreshMailboxStatus();
    }
  }, [location.pathname, location.search, refreshMailboxStatus]);

  const handleMailboxConnect = useCallback(async () => {
    if (!userId) {
      toast.error('Please sign in to connect your mailbox.');
      return;
    }
    try {
      setIsMailboxLoading(true);
      const redirectTo = `${window.location.origin}${location.pathname}${location.search}`;
      const url = await getMailboxLoginUrl(userId, redirectTo);
      const popup = window.open(url, '_blank', 'width=640,height=780');
      if (!popup) {
        window.location.href = url;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initiate mailbox connection';
      toast.error(message);
      console.error('Mailbox connect error:', error);
    } finally {
      setIsMailboxLoading(false);
    }
  }, [userId, location.pathname]);

  const filteredComposeTemplates = useMemo(() => {
    let filtered = composeTemplates;
    
    // Filter by language
    if (composeTemplateLanguageFilter) {
      filtered = filtered.filter(template => template.languageId === composeTemplateLanguageFilter);
    }
    
    // Filter by placement
    if (composeTemplatePlacementFilter !== null) {
      filtered = filtered.filter(template => template.placementId === composeTemplatePlacementFilter);
    }
    
    // Filter by search query
    const query = composeTemplateSearch.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter(template => template.name.toLowerCase().includes(query));
    }
    
    return filtered;
  }, [composeTemplates, composeTemplateSearch, composeTemplateLanguageFilter, composeTemplatePlacementFilter]);

  const pushComposeRecipient = (list: string[], address: string) => {
    const normalized = address.trim();
    if (!normalized) return;
    if (!emailRegex.test(normalized)) {
      throw new Error('Please enter a valid email address.');
    }
    if (!list.some(item => item.toLowerCase() === normalized.toLowerCase())) {
      list.push(normalized);
    }
  };

  const addComposeRecipient = (type: 'to' | 'cc', rawValue: string) => {
    const value = rawValue.trim().replace(/[;,]+$/, '');
    if (!value) return;
    try {
      if (type === 'to') {
        const updated = [...composeToRecipients];
        pushComposeRecipient(updated, value);
        setComposeToRecipients(updated);
        setComposeToInput('');
        setShowComposeToSuggestions(false);
        setComposeToSuggestions([]);
      } else {
        const updated = [...composeCcRecipients];
        pushComposeRecipient(updated, value);
        setComposeCcRecipients(updated);
        setComposeCcInput('');
        setShowComposeCcSuggestions(false);
        setComposeCcSuggestions([]);
      }
      setComposeRecipientError(null);
    } catch (error) {
      setComposeRecipientError((error as Error).message);
    }
  };

  const removeComposeRecipient = (type: 'to' | 'cc', email: string) => {
    if (type === 'to') {
      setComposeToRecipients(prev => prev.filter(item => item !== email));
    } else {
      setComposeCcRecipients(prev => prev.filter(item => item !== email));
    }
  };

  // Search employees locally for compose
  const searchComposeEmployees = (searchText: string): Array<{ email: string; name: string }> => {
    if (!searchText || searchText.trim().length < 1) return [];
    
    const searchLower = searchText.trim().toLowerCase();
    return composeEmployees
      .filter(emp => 
        emp.name.toLowerCase().includes(searchLower) || 
        emp.email.toLowerCase().includes(searchLower)
      )
      .slice(0, 10); // Limit to 10 results
  };

  const handleComposeRecipientKeyDown = (type: 'to' | 'cc') => (event: React.KeyboardEvent<HTMLInputElement>) => {
    const value = type === 'to' ? composeToInput : composeCcInput;
    const suggestions = type === 'to' ? composeToSuggestions : composeCcSuggestions;
    const showSuggestions = type === 'to' ? showComposeToSuggestions : showComposeCcSuggestions;
    
    if (event.key === 'ArrowDown' && showSuggestions && suggestions.length > 0) {
      event.preventDefault();
      // Select first suggestion
      const firstSuggestion = suggestions[0];
      if (firstSuggestion) {
        addComposeRecipient(type, firstSuggestion.email);
      }
      return;
    }
    
    if (event.key === 'Escape') {
      if (type === 'to') {
        setShowComposeToSuggestions(false);
      } else {
        setShowComposeCcSuggestions(false);
      }
      return;
    }
    
    const keys = ['Enter', ',', ';'];
    if (keys.includes(event.key)) {
      event.preventDefault();
      if (value.trim()) {
        addComposeRecipient(type, value);
      }
    } else if (event.key === 'Backspace' && !value) {
      if (type === 'to' && composeToRecipients.length > 0) {
        setComposeToRecipients(prev => prev.slice(0, -1));
      }
      if (type === 'cc' && composeCcRecipients.length > 0) {
        setComposeCcRecipients(prev => prev.slice(0, -1));
      }
    }
  };

  const renderComposeRecipients = (type: 'to' | 'cc') => {
    const items = type === 'to' ? composeToRecipients : composeCcRecipients;
    const value = type === 'to' ? composeToInput : composeCcInput;
    const setValue = type === 'to' ? setComposeToInput : setComposeCcInput;
    const placeholder = type === 'to' ? 'Add recipient and press Enter' : 'Add CC and press Enter';
    const suggestions = type === 'to' ? composeToSuggestions : composeCcSuggestions;
    const showSuggestions = type === 'to' ? showComposeToSuggestions : showComposeCcSuggestions;
    const suggestionsRef = type === 'to' ? composeToSuggestionsRef : composeCcSuggestionsRef;

    return (
      <div className="relative">
        <div className="border border-base-300 rounded-lg px-3 py-2 flex flex-wrap gap-2">
          {items.map(email => (
            <span key={`${type}-${email}`} className="bg-primary/10 text-primary px-2 py-1 rounded-full text-sm flex items-center gap-1">
              {email}
              <button
                type="button"
                onClick={() => removeComposeRecipient(type, email)}
                className="text-primary hover:text-primary-focus"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </span>
          ))}
          <input
            className="flex-1 min-w-[160px] outline-none bg-transparent"
            value={value}
            onChange={event => {
              const newValue = event.target.value;
              setValue(newValue);
              if (composeRecipientError) {
                setComposeRecipientError(null);
              }
              
              // Search employees immediately as user types
              if (newValue.trim().length > 0) {
                const results = searchComposeEmployees(newValue.trim());
                if (type === 'to') {
                  setComposeToSuggestions(results);
                  setShowComposeToSuggestions(results.length > 0);
                } else {
                  setComposeCcSuggestions(results);
                  setShowComposeCcSuggestions(results.length > 0);
                }
              } else {
                if (type === 'to') {
                  setComposeToSuggestions([]);
                  setShowComposeToSuggestions(false);
                } else {
                  setComposeCcSuggestions([]);
                  setShowComposeCcSuggestions(false);
                }
              }
            }}
            onFocus={() => {
              // Show suggestions if we have them or search again
              if (value.trim().length > 0) {
                const results = searchComposeEmployees(value.trim());
                if (type === 'to') {
                  setComposeToSuggestions(results);
                  setShowComposeToSuggestions(results.length > 0);
                } else {
                  setComposeCcSuggestions(results);
                  setShowComposeCcSuggestions(results.length > 0);
                }
              }
            }}
            onBlur={() => {
              // Delay hiding to allow clicking on suggestions
              setTimeout(() => {
                if (type === 'to') {
                  setShowComposeToSuggestions(false);
                } else {
                  setShowComposeCcSuggestions(false);
                }
              }, 200);
            }}
            onKeyDown={handleComposeRecipientKeyDown(type)}
            placeholder={placeholder}
          />
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => addComposeRecipient(type, value)}
            disabled={!value.trim()}
          >
            <PlusIcon className="w-3 h-3" />
          </button>
        </div>
        
        {/* Autocomplete Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
            onMouseDown={(e) => e.preventDefault()} // Prevent input blur on click
          >
            {suggestions.map((suggestion, index) => (
              <div
                key={`${type}-suggestion-${index}-${suggestion.email}`}
                className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addComposeRecipient(type, suggestion.email);
                }}
              >
                <div className="font-medium text-gray-900">{suggestion.name}</div>
                <div className="text-xs text-gray-500">{suggestion.email}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const normaliseUrl = (value: string) => {
    if (!value) return '';
    let url = value.trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    try {
      const parsed = new URL(url);
      return parsed.toString();
    } catch (error) {
      return '';
    }
  };

  const handleCancelComposeLink = () => {
    setShowComposeLinkForm(false);
    setComposeLinkLabel('');
    setComposeLinkUrl('');
  };

  const handleInsertComposeLink = () => {
    const formattedUrl = normaliseUrl(composeLinkUrl);
    if (!formattedUrl) {
      toast.error('Please provide a valid URL (including the domain).');
      return;
    }

    const label = composeLinkLabel.trim();
    setComposeBody(prev => {
      const existing = prev || '';
      const trimmedExisting = existing.replace(/\s*$/, '');
      // If label is provided, create HTML anchor tag with label as clickable text
      // If no label, just use the URL (convertBodyToHtml will make it clickable)
      const linkLine = label 
        ? `<a href="${formattedUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : formattedUrl;
      return trimmedExisting ? `${trimmedExisting}\n\n${linkLine}` : linkLine;
    });

    handleCancelComposeLink();
  };

  // Handle opening compose contacts modal
  const handleOpenComposeContactsModal = async () => {
    if (!client) return;
    
    setShowComposeContactsModal(true);
    setLoadingComposeContacts(true);
    setComposeSelectedContactIds(new Set());
    
    try {
      const isLegacyLead = typeof client.id === 'string' && client.id.startsWith('legacy_');
      const contacts = await fetchLeadContacts(client.id, isLegacyLead);
      
      // Filter only contacts with valid emails
      const contactsWithEmail = contacts.filter(c => c.email && c.email.trim());
      setComposeLeadContacts(contactsWithEmail);
    } catch (error) {
      console.error('Error fetching lead contacts:', error);
      toast.error('Failed to load contacts');
      setComposeLeadContacts([]);
    } finally {
      setLoadingComposeContacts(false);
    }
  };
  
  // Toggle compose contact selection
  const toggleComposeContactSelection = (contactId: number) => {
    setComposeSelectedContactIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) {
        newSet.delete(contactId);
      } else {
        newSet.add(contactId);
      }
      return newSet;
    });
  };
  
  // Add selected compose contacts to recipients
  const handleAddSelectedComposeContacts = () => {
    const selectedContacts = composeLeadContacts.filter(c => composeSelectedContactIds.has(c.id));
    const newRecipients = selectedContacts
      .map(c => c.email!)
      .filter(email => email && !composeToRecipients.includes(email));
    
    if (newRecipients.length > 0) {
      setComposeToRecipients(prev => [...prev, ...newRecipients]);
      toast.success(`Added ${newRecipients.length} contact(s) to recipients`);
    }
    
    setShowComposeContactsModal(false);
    setComposeSelectedContactIds(new Set());
  };

  // Helper function to check if text contains Hebrew
  const containsHebrew = (text: string): boolean => {
    return /[\u0590-\u05FF]/.test(text);
  };

  // Helper function to check if language is Hebrew
  const isHebrewLanguage = (languageId: string | null, languageName: string | null): boolean => {
    if (!languageId && !languageName) return false;
    const langId = languageId?.toString().toLowerCase() || '';
    const langName = languageName?.toString().toLowerCase() || '';
    return langId.includes('he') || langName.includes('hebrew') || langName.includes('עברית');
  };

  const handleComposeTemplateSelect = async (template: EmailTemplate) => {
    setSelectedComposeTemplateId(template.id);
    const templatedBody = await replaceTemplateTokens(template.content, client);
    const finalBody = templatedBody || template.content || template.rawContent;
    
    if (template.subject && template.subject.trim()) {
      const templatedSubject = await replaceTemplateTokens(template.subject, client);
      setComposeSubject(templatedSubject || template.subject);
    }
    
    setComposeBody(finalBody);
    
    // Check if template is Hebrew based on language or content
    const isHebrew = isHebrewLanguage(template.languageId, template.languageName) || containsHebrew(finalBody);
    setComposeBodyIsRTL(isHebrew);
    
    setComposeTemplateSearch(template.name);
    setComposeTemplateDropdownOpen(false);
  };

  // Debug selectedFile state changes
  useEffect(() => {
    console.log('📁 selectedFile state changed:', selectedFile);
  }, [selectedFile]);
  const [showAiSummary, setShowAiSummary] = useState(false);
  const lastEmailRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 1. Add state for WhatsApp messages from DB
  const [whatsAppMessages, setWhatsAppMessages] = useState<any[]>([]);
  
  // WhatsApp templates state
  const [whatsAppTemplates, setWhatsAppTemplates] = useState<WhatsAppTemplate[]>([]);
  
  // Emoji picker state
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  
  // Audio playback state for call recordings
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

  // Audio playback functions
  const handlePlayRecording = async (recordingUrl: string, callId: string) => {
    let hasShownError = false; // Flag to prevent duplicate toast notifications
    
    try {
      
      // Stop current audio if playing
      if (audioRef && !audioRef.paused) {
        audioRef.pause();
        audioRef.currentTime = 0;
      }

      // Validate and clean the recording URL
      let cleanUrl = recordingUrl;
      
      // Check if URL is absolute (handle both encoded and unencoded URLs)
      let decodedUrl = recordingUrl;
      try {
        // Try to decode the URL first
        decodedUrl = decodeURIComponent(recordingUrl);
      } catch (error) {
        // If decoding fails, use the original URL
        decodedUrl = recordingUrl;
      }
      const isAbsolute = decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://');
      
      if (!isAbsolute) {
        console.error('Invalid recording URL:', recordingUrl);
        toast.error('Invalid recording URL');
        return;
      }

      // For 1com URLs, extract call ID and use our proxy endpoint
      if (decodedUrl.includes('pbx6webserver.1com.co.il')) {
        try {
          // Extract call ID from the URL
          const urlParams = new URL(decodedUrl).searchParams;
          const callId = urlParams.get('id');
          const tenant = urlParams.get('tenant');
          
          if (!callId) {
            console.error('Could not extract call ID from URL:', decodedUrl);
            toast.error('Invalid recording URL format');
            return;
          }
          
          // Use our backend proxy to avoid CORS issues
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
          cleanUrl = `${backendUrl}/api/call-recording/${callId}${tenant ? `?tenant=${tenant}` : ''}`;
        } catch (error) {
          console.error('Error parsing 1com URL:', error);
          toast.error('Failed to parse recording URL');
          return;
        }
      }

      // First, check if this is a 2024 recording that might not be available
      const isOldRecording = callId.startsWith('pbx24-') || decodedUrl.includes('pbx24-');
      if (isOldRecording) {
        // Make a GET request to check if the recording is available
        try {
          const checkResponse = await fetch(cleanUrl);
          if (!checkResponse.ok) {
            const errorData = await checkResponse.json().catch(() => null);
            if (errorData?.isOldRecording) {
              if (!hasShownError) {
                hasShownError = true;
                toast.error('This recording is from 2024 and may no longer be accessible. 1com typically archives older recordings.');
              }
              return;
            }
          } else {
            // Check if the response is actually audio
            const contentType = checkResponse.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              // The backend returned JSON instead of audio, likely an error
              const errorData = await checkResponse.json().catch(() => null);
              if (errorData?.isOldRecording) {
                if (!hasShownError) {
                  hasShownError = true;
                  toast.error('This recording is from 2024 and may no longer be accessible. 1com typically archives older recordings.');
                }
                return;
              }
            }
          }
        } catch (checkError) {
          // Continue with normal playback attempt
        }
      }

      // Create new audio element
      const audio = new Audio(cleanUrl);
      setAudioRef(audio);
      setPlayingAudioId(callId);

      audio.onended = () => {
        setPlayingAudioId(null);
        setAudioRef(null);
      };

      audio.onerror = (error) => {
        console.error('Audio playback error:', error);
        console.error('Failed URL:', cleanUrl);
        if (!hasShownError) {
          hasShownError = true;
          // Check if this is a 2024 recording for a more specific error message
          if (isOldRecording) {
            toast.error('This recording is from 2024 and may no longer be accessible. 1com typically archives older recordings.');
          } else {
            toast.error('Recording is not available');
          }
        }
        setPlayingAudioId(null);
        setAudioRef(null);
      };


      await audio.play();
    } catch (error) {
      console.error('Error playing recording:', error);
      if (!hasShownError) {
        hasShownError = true;
        toast.error('Recording is not available');
      }
      setPlayingAudioId(null);
      setAudioRef(null);
    }
  };

  const handleStopRecording = () => {
    if (audioRef && !audioRef.paused) {
      audioRef.pause();
      audioRef.currentTime = 0;
    }
    setPlayingAudioId(null);
    setAudioRef(null);
  };
  // Add state for WhatsApp error messages
  const [whatsAppError, setWhatsAppError] = useState<string | null>(null);
  
  // Debug: Log when whatsAppError changes
  useEffect(() => {
    console.log('🔍 WhatsApp error state changed:', whatsAppError);
  }, [whatsAppError]);

  // Find the index of the last email in the sorted interactions - memoized to prevent recalculation
  const INITIAL_VISIBLE_INTERACTIONS = 20;
  const [visibleInteractionsCount, setVisibleInteractionsCount] = useState(INITIAL_VISIBLE_INTERACTIONS);

  const sortedInteractions = useMemo(() => {
    // Final safety filter: Remove any email interactions with no meaningful body content
    const filtered = interactions.filter((interaction: any) => {
      if (interaction.kind === 'email') {
        // Check if this is a manual interaction (by ID prefix) - always include manual interactions
        const isManualInteraction = interaction.id?.toString().startsWith('manual_');
        if (isManualInteraction) {
          return true; // Always include manual interactions regardless of content
        }
        
        const content = interaction.content || '';
        const subject = interaction.subject || '';
        
        // Remove HTML tags to check actual text content
        const textContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        
        // Check if this is a legacy email (from leads_leadinteractions)
        const isLegacyEmail = interaction.id?.toString().startsWith('legacy_');
        
        // email_manual interactions are manual interactions, always include them
        if (interaction.kind === 'email_manual') {
          return true;
        }
        
        let hasContent = false;
        
        if (isLegacyEmail) {
          // For legacy emails, check content field directly (they don't have body_html/body_preview)
          hasContent = textContent && 
                      textContent.length >= 20 && 
                      textContent.toLowerCase() !== subject.toLowerCase();
        } else {
          // For new emails (from emails table), check body_html/body_preview
          const hasBodyContent = (interaction.body_html && interaction.body_html.trim() !== '') ||
                                (interaction.body_preview && interaction.body_preview.trim() !== '');
          
          hasContent = hasBodyContent && 
                      textContent && 
                      textContent.length >= 20 && 
                      textContent.toLowerCase() !== subject.toLowerCase();
        }
        
        // Filter out if no meaningful content
        if (!hasContent) {
          console.log('🚫 Final filter: Removing email interaction with no meaningful body:', {
            id: interaction.id,
            isLegacy: isLegacyEmail,
            subject: subject.substring(0, 50),
            contentLength: textContent.length,
            hasBodyHtml: !!(interaction.body_html && interaction.body_html.trim()),
            hasBodyPreview: !!(interaction.body_preview && interaction.body_preview.trim())
          });
          return false;
        }
      }
      return true;
    });
    
    return filtered.sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());
  }, [interactions]);

  useEffect(() => {
    const nextCount = client.id
      ? Math.min(INITIAL_VISIBLE_INTERACTIONS, sortedInteractions.length || 0)
      : INITIAL_VISIBLE_INTERACTIONS;
    setVisibleInteractionsCount(nextCount);
  }, [client.id, sortedInteractions.length]);

  const visibleInteractions = useMemo(
    () => sortedInteractions.slice(0, visibleInteractionsCount),
    [sortedInteractions, visibleInteractionsCount]
  );
  const hasMoreInteractions = sortedInteractions.length > visibleInteractionsCount;
  const renderedInteractions = useMemo(
    () =>
      visibleInteractions.map((row) => {
        // Process WhatsApp messages with templates
        if (row.kind === 'whatsapp' && row.direction === 'out' && whatsAppTemplates.length > 0) {
          let processedContent = row.content || '';
          
          // PRIORITY 1: Match by template_id if available (most reliable)
          const templateId = (row as any).template_id;
          if (templateId) {
            const templateIdNum = Number(templateId);
            const template = whatsAppTemplates.find(t => Number(t.id) === templateIdNum);
            if (template) {
              if (template.params === '0' && template.content) {
                processedContent = template.content;
              } else if (template.params === '1') {
                const paramMatch = row.content?.match(/\[Template:.*?\]\s*(.+)/);
                if (paramMatch && paramMatch[1].trim()) {
                  processedContent = paramMatch[1].trim();
                } else {
                  processedContent = template.content || processedContent;
                }
              }
              return { ...row, content: processedContent };
            }
          }
          
          // PRIORITY 2: Fallback to name matching for backward compatibility
          if (processedContent.includes('[Template:') || processedContent.includes('Template:') || processedContent.includes('TEMPLATE_MARKER:')) {
            const templateMatch = processedContent.match(/\[Template:\s*([^\]]+)\]/) || 
                                  processedContent.match(/Template:\s*(.+)/) ||
                                  processedContent.match(/TEMPLATE_MARKER:(.+)/);
            
            if (templateMatch) {
              const templateTitle = templateMatch[1].trim().replace(/\]$/, '');
              const template = whatsAppTemplates.find(t => 
                t.title.toLowerCase() === templateTitle.toLowerCase() ||
                (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
              );
              
              if (template) {
                if (template.params === '0' && template.content) {
                  processedContent = template.content;
                } else if (template.params === '1') {
                  const paramMatch = row.content?.match(/\[Template:.*?\]\s*(.+)/);
                  if (paramMatch && paramMatch[1].trim()) {
                    processedContent = paramMatch[1].trim();
                  } else {
                    processedContent = template.content || processedContent;
                  }
                }
                return { ...row, content: processedContent };
              }
            }
          }
        }
        
        if (row.kind !== 'email') {
          return row;
        }

        const originalContent =
          typeof row.content === 'string' ? row.content : row.content != null ? String(row.content) : '';

        // Don't strip signatures/quoted text - show full content
        // The user requested to remove content truncation
        const sanitizedBase = sanitizeEmailHtml(originalContent);

        let sanitizedWithoutSubject = sanitizedBase;
        if (row.subject) {
          try {
            // Only remove subject if it appears at the very beginning of the content
            const subjectPattern = new RegExp(`^${escapeRegExp(row.subject)}\\s*:?\\s*[\\-–—]*`, 'i');
            const withoutSubjectSource = originalContent.replace(subjectPattern, '').trim();
            if (withoutSubjectSource && withoutSubjectSource !== originalContent) {
              const sanitizedCandidate = sanitizeEmailHtml(withoutSubjectSource);
              if (sanitizedCandidate) {
                sanitizedWithoutSubject = sanitizedCandidate;
              }
            }
          } catch (error) {
            console.warn('Failed to strip subject prefix from email content', error);
          }
        }

        return {
          ...row,
          renderedContent: sanitizedWithoutSubject || sanitizedBase,
          renderedContentFallback: sanitizedBase,
        };
      }),
    [visibleInteractions, whatsAppTemplates] // Include templates in dependencies
  );
  const lastEmailIdx = useMemo(() => 
    sortedInteractions.map(row => row.kind).lastIndexOf('email'),
    [sortedInteractions]
  );

  // Debug: Log renderedInteractions to see what's being rendered
  useEffect(() => {
    const whatsappCount = renderedInteractions.filter((r: any) => r?.kind === 'whatsapp').length;
    const totalCount = renderedInteractions.length;
    console.log(`🔍 Rendered interactions: ${totalCount} total, ${whatsappCount} WhatsApp messages`);
    if (whatsappCount > 0) {
      console.log('✅ WhatsApp messages in renderedInteractions:', renderedInteractions.filter((r: any) => r?.kind === 'whatsapp').slice(0, 3));
    }
  }, [renderedInteractions]);

  // --- Add: handler for clicking an interaction to jump to message in modal ---
  const handleInteractionClick = async (row: Interaction, idx: number) => {
    // Legacy email interactions (email_manual) should open edit drawer, not email modal
    if (row.kind === 'email_manual') {
      // Treat as manual interaction - open edit drawer
      openEditDrawer(idx);
      return;
    }
    
    // Legacy WhatsApp interactions (whatsapp_manual) should open edit drawer, not WhatsApp modal
    if (row.kind === 'whatsapp_manual') {
      // Treat as manual interaction - open edit drawer
      openEditDrawer(idx);
      return;
    }
    
    if (row.kind === 'email' && !row.editable) {
      // For actual sent/received emails (not manual), open email modal
      // Ensure contacts are loaded first
      let contacts = leadContacts;
      if (contacts.length === 0) {
        try {
          const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
          const normalizedLeadId = isLegacyLead 
            ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
            : client.id;
          
          contacts = await fetchLeadContacts(normalizedLeadId, isLegacyLead);
          setLeadContacts(contacts);
        } catch (error) {
          console.error('Error fetching contacts for email click:', error);
        }
      }
      
      // Find the contact associated with this email
      let contactToSelect: ContactInfo | null = null;
      const emailContactId = (row as any).contact_id;
      const senderEmail = (row as any).sender_email?.toLowerCase().trim();
      const recipientList = (row as any).recipient_list?.toLowerCase() || '';
      
      // First, try to find by contact_id if available (STRICT MATCH)
      if (emailContactId !== null && emailContactId !== undefined && contacts.length > 0) {
        contactToSelect = contacts.find(c => c.id === Number(emailContactId)) || null;
      }
      
      // If not found by contact_id, try to match by email address (for old emails without contact_id)
      if (!contactToSelect && contacts.length > 0) {
        // Split recipient list to check each recipient individually
        const recipients = recipientList.split(/[,;]/).map((r: string) => r.trim().toLowerCase()).filter((r: string) => r);
        
        const isOutgoing = row.direction === 'out';
        
        // For outgoing emails, prioritize matching recipients
        // For incoming emails, prioritize matching sender
        if (isOutgoing && recipients.length > 0) {
          // Outgoing email: match by recipient
          for (const contact of contacts) {
            const contactEmail = contact.email?.toLowerCase().trim();
            if (contactEmail && recipients.includes(contactEmail)) {
              contactToSelect = contact;
              break;
            }
          }
        } else if (!isOutgoing && senderEmail) {
          // Incoming email: match by sender
          for (const contact of contacts) {
            const contactEmail = contact.email?.toLowerCase().trim();
            if (contactEmail && senderEmail === contactEmail) {
              contactToSelect = contact;
              break;
            }
          }
        }
        
        // Fallback: try reverse matching if primary match didn't work
        if (!contactToSelect) {
          for (const contact of contacts) {
            const contactEmail = contact.email?.toLowerCase().trim();
            if (contactEmail) {
              if (isOutgoing && senderEmail === contactEmail) {
                // Outgoing but sender matches (less likely but possible)
                contactToSelect = contact;
                break;
              } else if (!isOutgoing && recipients.includes(contactEmail)) {
                // Incoming but recipient matches (less likely but possible)
                contactToSelect = contact;
                break;
              }
            }
          }
        }
      }
      
      // If still no contact found, use the main contact as fallback
      if (!contactToSelect && contacts.length > 0) {
        contactToSelect = contacts.find(c => c.isMain) || contacts[0] || null;
      }
      
      // Set the selected contact if found (BEFORE opening modal)
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
        : client.id;
      
      if (contactToSelect) {
        
        // Set the contact state first
        setSelectedContactForEmail({
          contact: contactToSelect,
          leadId,
          leadType: isLegacyLead ? 'legacy' : 'new'
        });
        
        // Wait longer for state to update, then open modal
        await new Promise(resolve => setTimeout(resolve, 200));
      } else {
        console.warn('⚠️ No contact found for email, clearing selected contact and opening modal without filter', {
          emailId: row.id,
          emailContactId: emailContactId,
          senderEmail,
          recipientList,
          contactsCount: contacts.length,
          contacts: contacts.map(c => ({ id: c.id, name: c.name, email: c.email }))
        });
        // Clear any previously selected contact
        setSelectedContactForEmail(null);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Find the email in the emails list and set it as selected
      // We'll set it after emails are loaded
      setActiveEmailId(row.id.toString());
      
      // Now open the modal
      setIsEmailModalOpen(true);
      
      // Find and select the email after a short delay to ensure emails are loaded
      setTimeout(() => {
        const emailToSelect = emails.find((e: any) => e.id === row.id);
        if (emailToSelect) {
          setSelectedEmailForView(emailToSelect);
          hydrateEmailBodies([emailToSelect]);
        }
      }, 300);
    } else if (row.kind === 'whatsapp' && !row.editable) {
      // For actual sent/received WhatsApp messages (not manual), open WhatsApp modal
      // Ensure contacts are loaded first
      let contacts = leadContacts;
      if (contacts.length === 0) {
        try {
          const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
          const normalizedLeadId = isLegacyLead 
            ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
            : client.id;
          
          contacts = await fetchLeadContacts(normalizedLeadId, isLegacyLead);
          setLeadContacts(contacts);
        } catch (error) {
          console.error('Error fetching contacts for WhatsApp click:', error);
        }
      }
      
      // Find the contact associated with this WhatsApp message
      let contactToSelect: ContactInfo | null = null;
      const whatsappContactId = (row as any).contact_id;
      const phoneNumber = (row as any).phone_number;
      
      // First, try to find by contact_id if available (STRICT MATCH)
      if (whatsappContactId !== null && whatsappContactId !== undefined && contacts.length > 0) {
        contactToSelect = contacts.find(c => c.id === Number(whatsappContactId)) || null;
      }
      
      // If not found by contact_id, try to match by phone number
      if (!contactToSelect && phoneNumber && contacts.length > 0) {
        // Normalize phone number (remove spaces, dashes, etc.)
        const normalizePhone = (phone: string) => phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
        const normalizedPhone = normalizePhone(phoneNumber);
        
        for (const contact of contacts) {
          const contactPhone = contact.phone ? normalizePhone(contact.phone) : null;
          const contactMobile = contact.mobile ? normalizePhone(contact.mobile) : null;
          
          // Try exact match first
          if (contactPhone === normalizedPhone || contactMobile === normalizedPhone) {
            contactToSelect = contact;
            break;
          }
          
          // Try last 4 digits match (fallback)
          if (normalizedPhone.length >= 4) {
            const last4 = normalizedPhone.slice(-4);
            if ((contactPhone && contactPhone.slice(-4) === last4) || 
                (contactMobile && contactMobile.slice(-4) === last4)) {
              contactToSelect = contact;
              break;
            }
          }
        }
      }
      
      // If still no contact found, use the main contact as fallback
      if (!contactToSelect && contacts.length > 0) {
        contactToSelect = contacts.find(c => c.isMain) || contacts[0] || null;
      }
      
      // Set the contact if found
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
        : client.id;
      
      if (contactToSelect) {
        const contactData = {
          contact: contactToSelect,
          leadId,
          leadType: isLegacyLead ? 'legacy' : 'new' as 'legacy' | 'new'
        };
        selectedContactForWhatsAppRef.current = contactData;
        setSelectedContactForWhatsApp(contactData);
        // Wait a bit for state to update, then open modal
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsWhatsAppOpen(true);
            setActiveWhatsAppId(row.id.toString());
          });
        });
      } else {
        console.warn('⚠️ No contact found for WhatsApp message, opening without contact filter');
        // Clear any previously selected contact
        setSelectedContactForWhatsApp(null);
        selectedContactForWhatsAppRef.current = null;
        setIsWhatsAppOpen(true);
        setActiveWhatsAppId(row.id.toString());
      }
    } else if (row.editable) {
      // Manual interactions - open edit drawer
      openEditDrawer(idx);
    } else {
      // Other interactions (calls, etc.) - open edit drawer as well
      openEditDrawer(idx);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('focus') === 'email' && lastEmailIdx !== -1) {
      // Open the email modal for the last email
      setIsEmailModalOpen(true);
      setActiveEmailId(sortedInteractions[lastEmailIdx].id.toString());
      // Scroll to the last email
      setTimeout(() => {
        lastEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [location.search, lastEmailIdx, sortedInteractions]); // Now safe to include these memoized values

  // Handle email modal opening from localStorage flag
  useEffect(() => {
    if (localStorage.getItem('openEmailModal') === 'true') {
      // Wait for interactions to be loaded and emails to be available
      if (interactions.length > 0 && emails.length > 0) {
        if (lastEmailIdx !== -1) {
          setIsEmailModalOpen(true);
          setActiveEmailId(sortedInteractions[lastEmailIdx].id.toString());
          setTimeout(() => {
            lastEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
        localStorage.removeItem('openEmailModal');
      } else {
        // If emails aren't loaded yet, wait a bit and try again
        const timeoutId = setTimeout(() => {
          if (localStorage.getItem('openEmailModal') === 'true') {
            if (interactions.length > 0 && emails.length > 0 && lastEmailIdx !== -1) {
              setIsEmailModalOpen(true);
              setActiveEmailId(sortedInteractions[lastEmailIdx].id.toString());
              setTimeout(() => {
                lastEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
            }
            localStorage.removeItem('openEmailModal');
          }
        }, 2000); // Wait 2 seconds for emails to load
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [client.id, interactions.length, emails.length, lastEmailIdx, sortedInteractions]); // Include necessary dependencies

  // Handle WhatsApp modal opening from localStorage flag
  useEffect(() => {
    if (localStorage.getItem('openWhatsAppModal') === 'true') {
      // Wait for interactions to be loaded
      if (interactions.length > 0) {
        setIsWhatsAppOpen(true);
        localStorage.removeItem('openWhatsAppModal');
      } else {
        // If interactions aren't loaded yet, wait a bit and try again
        const timeoutId = setTimeout(() => {
          if (localStorage.getItem('openWhatsAppModal') === 'true') {
            if (interactions.length > 0) {
              setIsWhatsAppOpen(true);
            }
            localStorage.removeItem('openWhatsAppModal');
          }
        }, 2000); // Wait 2 seconds for interactions to load
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [client.id, interactions.length]); // Include interactions.length since we need to check it




  // Close WhatsApp modal when client changes
  useEffect(() => {
    setIsWhatsAppOpen(false);
    // Clear any stale flags when client changes
    localStorage.removeItem('openWhatsAppModal');
    localStorage.removeItem('whatsAppFromCalendar');
  }, [client.id]);

  // Handle click outside to close emoji picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isEmojiPickerOpen) {
        const target = event.target as HTMLElement;
        if (!target.closest('.emoji-picker-container') && !target.closest('button[type="button"]')) {
          setIsEmojiPickerOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEmojiPickerOpen]);

  // Handle WhatsApp modal close and navigation back to Calendar
  const handleWhatsAppClose = () => {
    setIsWhatsAppOpen(false);
    setWhatsAppInput('');
    setSelectedFile(null);
    setSelectedMedia(null);
    setActiveWhatsAppId(null);
    setWhatsAppError(null); // Clear any error messages when closing
    selectedContactForWhatsAppRef.current = null; // Clear the ref
    
    // Check if WhatsApp was opened from Calendar
    if (localStorage.getItem('whatsAppFromCalendar') === 'true') {
      localStorage.removeItem('whatsAppFromCalendar');
      navigate('/calendar');
    }
  };

  // 2. Fetch WhatsApp messages from DB when WhatsApp modal opens or client changes
  useEffect(() => {
    async function fetchWhatsAppMessages() {
      if (!client?.id) return;
      
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      let query = supabase.from('whatsapp_messages').select('*');
      
      if (isLegacyLead) {
        const legacyId = parseInt(client.id.replace('legacy_', ''));
        query = query.eq('legacy_id', legacyId);
      } else {
        query = query.eq('lead_id', client.id);
      }
      
      const { data, error } = await query.order('sent_at', { ascending: true });
      if (!error && data) {
        setWhatsAppMessages(data);
      } else {
        setWhatsAppMessages([]);
      }
    }
    if (isWhatsAppOpen) {
      fetchWhatsAppMessages();
    }
  }, [isWhatsAppOpen, client.id]);

  // 3. Periodically check status of pending messages
  useEffect(() => {
    if (!isWhatsAppOpen || !client?.id) return;

    const interval = setInterval(async () => {
      // Check if there are any pending messages
      const hasPendingMessages = whatsAppMessages.some(msg => msg.whatsapp_status === 'pending');
      
      if (hasPendingMessages) {
        // Refetch messages to get updated statuses
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        let query = supabase.from('whatsapp_messages').select('*');
        
        if (isLegacyLead) {
          const legacyId = parseInt(client.id.replace('legacy_', ''));
          query = query.eq('legacy_id', legacyId);
        } else {
          query = query.eq('lead_id', client.id);
        }
        
        const { data, error } = await query.order('sent_at', { ascending: true });
        if (!error && data) {
          setWhatsAppMessages(data);
        }
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [isWhatsAppOpen, client.id, whatsAppMessages]);

  // 3. On send, save to DB and refetch messages
  const handleSendWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whatsAppInput.trim()) return;

    // Clear any previous errors
    setWhatsAppError(null);

    // Check if client has phone number
    console.log('🔍 Checking phone numbers:', { phone: client.phone, mobile: client.mobile });
    if (!client.phone && !client.mobile) {
      console.log('❌ No phone number found, setting error');
      setWhatsAppError('❌ No phone number available for this client. Please add a phone number first.');
      // Add a small delay to ensure the error is displayed
      setTimeout(() => {
        console.log('🔍 Error should be visible now');
      }, 100);
      return;
    }

    // Validate phone number format
    const phoneNumber = client.phone || client.mobile;
    console.log('🔍 Phone number to use:', phoneNumber);
    if (!phoneNumber || phoneNumber.trim() === '') {
      console.log('❌ Phone number is empty, setting error');
      setWhatsAppError('❌ No phone number available for this client. Please add a phone number first.');
      return;
    }
    
    const now = new Date();
    let senderName = 'You';
    let whatsappStatus = 'sent';
    let errorMessage = null;
    
    try {
      // Get current user's full name from users table with employee join
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        const { data: userRow, error: userLookupError } = await supabase
          .from('users')
          .select(`
            full_name,
            email,
            employee_id,
            tenants_employee!employee_id(
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .single();
        if (!userLookupError && userRow) {
          // Use display_name from tenants_employee if available, otherwise full_name
          const employee = Array.isArray(userRow.tenants_employee) ? userRow.tenants_employee[0] : userRow.tenants_employee;
          senderName = employee?.display_name || userRow.full_name || userRow.email || 'You';
        }
      }
      
      // Try to send via WhatsApp API first
      const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: client.id,
          message: whatsAppInput.trim(),
          phoneNumber: client.phone || client.mobile,
          sender_name: senderName
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        let errorMessage = '';
        if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
          errorMessage = '⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity. The customer needs to reply first to reset the timer.';
        } else if (result.error?.includes('phone') || result.error?.includes('invalid') || result.error?.includes('format')) {
          errorMessage = '❌ Invalid phone number format. Please check the client\'s phone number.';
        } else if (result.error?.includes('not found') || result.error?.includes('404')) {
          errorMessage = '❌ Phone number not found or not registered on WhatsApp.';
        } else {
          errorMessage = `❌ WhatsApp API Error: ${result.error || 'Unknown error'}`;
        }
        
        setWhatsAppError(errorMessage);
        return; // Don't save to database if API call failed
      }
      
      // Message sent successfully via WhatsApp API - backend will save to database
      console.log('✅ WhatsApp message sent successfully, backend will save to database');
      
      setWhatsAppInput('');
      
      // Refetch messages - handle both new and legacy leads
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      let query = supabase.from('whatsapp_messages').select('*');
      if (isLegacyLead) {
        const legacyId = parseInt(client.id.replace('legacy_', ''));
        query = query.eq('legacy_id', legacyId);
      } else {
        query = query.eq('lead_id', client.id);
      }
      
      const { data, error } = await query.order('sent_at', { ascending: true });
      if (!error && data) {
        setWhatsAppMessages(data);
      }
      
      // Stage evaluation is handled automatically by database triggers
      
      // Optionally, update interactions timeline
      if (onClientUpdate) await onClientUpdate();
      
      // Clear any previous errors and show success
      setWhatsAppError(null);
      
    } catch (err) {
      console.error('Unexpected error sending WhatsApp message:', err);
      setWhatsAppError('Unexpected error sending WhatsApp message: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  // Helper function to render WhatsApp-style message status
  const renderMessageStatus = (status?: string, errorMessage?: string) => {
    if (!status) return null;
    
    const baseClasses = "w-7 h-7";
    
    switch (status) {
      case 'sent':
        return (
          <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'pending':
        return (
          <svg className={`${baseClasses} text-gray-400 animate-pulse`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'delivered':
        return (
          <svg className={`${baseClasses} text-gray-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l4 4L17 8" />
          </svg>
        );
      case 'read':
        return (
          <svg className={`${baseClasses} text-black`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l4 4L17 8" />
          </svg>
        );
      case 'failed':
        return (
          <div className="relative group">
            <svg className={`${baseClasses} text-red-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {errorMessage && (
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-red-600 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 max-w-xs">
                {errorMessage}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-red-600"></div>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // Handle file selection for WhatsApp
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    console.log('📁 File selected:', file);
    if (file) {
      console.log('📁 File details:', {
        name: file.name,
        size: file.size,
        type: file.type
      });
      setSelectedFile(file);
    }
  };

  // Handle emoji selection
  const handleEmojiClick = (emojiObject: any) => {
    const emoji = emojiObject.emoji;
    setWhatsAppInput(prev => prev + emoji);
    setIsEmojiPickerOpen(false);
  };

  // Helper function to detect if message contains only emojis
  const isEmojiOnly = (text: string): boolean => {
    // Simple approach: check if the text length is very short and contains emoji-like characters
    const cleanText = text.trim();
    if (cleanText.length === 0) return false;
    
    // Check if the message is very short (likely emoji-only) and contains non-ASCII characters
    const hasNonAscii = /[^\x00-\x7F]/.test(cleanText);
    const isShort = cleanText.length <= 5; // Most emojis are 1-3 characters
    
    return hasNonAscii && isShort;
  };

  // Send media message via WhatsApp
  const handleSendMedia = async () => {
    if (!selectedFile || !client) {
      console.log('❌ Cannot send media - missing file or client:', { selectedFile, client });
      return;
    }

    console.log('📤 Starting to send media:', {
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      clientId: client.id,
      clientName: client.name
    });

    // Clear any previous errors
    setWhatsAppError(null);

    // Check if client has phone number
    console.log('🔍 Media: Checking phone numbers:', { phone: client.phone, mobile: client.mobile });
    if (!client.phone && !client.mobile) {
      console.log('❌ Media: No phone number found, setting error');
      setWhatsAppError('❌ No phone number available for this client. Please add a phone number first.');
      // Add a small delay to ensure the error is displayed
      setTimeout(() => {
        console.log('🔍 Media: Error should be visible now');
      }, 100);
      return;
    }

    setUploadingMedia(true);
    let whatsappStatus = 'sent';
    let errorMessage = null;
    
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('leadId', client.id);

      // Upload media to WhatsApp
      const uploadResponse = await fetch(buildApiUrl('/api/whatsapp/upload-media'), {
        method: 'POST',
        body: formData,
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        errorMessage = uploadResult.error || 'Failed to upload media';
        whatsappStatus = 'failed';
        throw new Error(errorMessage);
      }

      // Send media message
      const mediaType = selectedFile.type.startsWith('image/') ? 'image' : 'document';
      const senderName = currentUserFullName || 'You';
      const response = await fetch(buildApiUrl('/api/whatsapp/send-media'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: client.id,
          mediaUrl: uploadResult.mediaId,
          mediaType: mediaType,
          caption: whatsAppInput.trim() || undefined,
          phoneNumber: client.phone || client.mobile,
          sender_name: senderName
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
          errorMessage = '⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity.';
          whatsappStatus = 'failed';
        } else if (result.error?.includes('phone') || result.error?.includes('invalid') || result.error?.includes('format')) {
          errorMessage = '❌ Invalid phone number format. Please check the client\'s phone number.';
          whatsappStatus = 'failed';
        } else if (result.error?.includes('not found') || result.error?.includes('404')) {
          errorMessage = '❌ Phone number not found or not registered on WhatsApp.';
          whatsappStatus = 'failed';
        } else {
          errorMessage = result.error || 'Failed to send media';
          whatsappStatus = 'failed';
        }
        throw new Error(errorMessage);
      }

      // Media sent successfully - clear any previous errors
      setWhatsAppError(null);
      
    } catch (apiError) {
      // API call failed - don't save to database
      console.error('WhatsApp Media API Error:', apiError);
      const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown API error';
      setWhatsAppError('Failed to send media: ' + errorMessage);
      setUploadingMedia(false);
      return; // Don't save to database if API call failed
    }

    // Media sent successfully - backend will save to database
    console.log('✅ WhatsApp media sent successfully, backend will save to database');
    
    setWhatsAppInput('');
    setSelectedFile(null);
    setUploadingMedia(false);
    
    // Refetch messages to update the display
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    let query = supabase.from('whatsapp_messages').select('*');
    if (isLegacyLead) {
      const legacyId = parseInt(client.id.replace('legacy_', ''));
      query = query.eq('legacy_id', legacyId);
    } else {
      query = query.eq('lead_id', client.id);
    }
    
    const { data, error } = await query.order('sent_at', { ascending: true });
    if (!error && data) {
      setWhatsAppMessages(data);
    }
    
    // Stage evaluation is handled automatically by database triggers
    
    // Optionally, update interactions timeline
    if (onClientUpdate) await onClientUpdate();
  };

  // 4. Use whatsAppMessages for chat display
  // Replace whatsAppChatMessages with whatsAppMessages in the modal rendering
  // 5. In the timeline, merge WhatsApp messages from DB with other interactions
  // In fetchAndCombineInteractions, fetch WhatsApp messages from DB and merge with manual_interactions and emails
  // Guard to prevent multiple simultaneous fetches
  const isFetchingInteractionsRef = useRef(false);
  
  const fetchInteractions = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      // Don't fetch if no client
      if (!client?.id) {
        console.log('⚠️ InteractionsTab: No client ID, skipping fetch');
        setInteractions([]);
        setEmails([]);
        setInteractionsLoading(false);
        return;
      }
      
      // Prevent multiple simultaneous fetches
      if (isFetchingInteractionsRef.current && !options?.bypassCache) {
        console.log('⚠️ InteractionsTab: Already fetching, skipping duplicate request');
        return;
      }
      
      isFetchingInteractionsRef.current = true;

      const cacheForLead: ClientInteractionsCache | null =
        interactionsCache && interactionsCache.leadId === client.id ? interactionsCache : null;

      if (!options?.bypassCache && cacheForLead) {
        console.log('✅ InteractionsTab using cached interactions for lead:', cacheForLead.leadId);
        let cachedInteractions = cacheForLead.interactions || [];
        const cachedWhatsAppCount = cachedInteractions.filter((i: any) => i.kind === 'whatsapp').length;
        console.log(`📊 Cached interactions: ${cachedInteractions.length} total, ${cachedWhatsAppCount} WhatsApp messages`);
        
        // CRITICAL: Filter out email interactions with no meaningful body content from cache
        cachedInteractions = cachedInteractions.filter((interaction: any) => {
          if (interaction.kind === 'email') {
            // Check if this is a manual interaction (by ID prefix) - always include manual interactions
            const isManualInteraction = interaction.id?.toString().startsWith('manual_');
            if (isManualInteraction) {
              return true; // Always include manual interactions regardless of content
            }
            
            const content = interaction.content || '';
            const subject = interaction.subject || '';
            
            // Remove HTML tags to check actual text content
            const textContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            
            // Filter out if:
            // 1. Content is empty or just whitespace
            // 2. Content is the same as subject (case-insensitive)
            // 3. Content is too short (less than 20 characters)
            // 4. No body_html or body_preview exists
            const hasBodyContent = (interaction.body_html && interaction.body_html.trim() !== '') ||
                                  (interaction.body_preview && interaction.body_preview.trim() !== '');
            
            if (!hasBodyContent || 
                !textContent || 
                textContent.length < 20 || 
                textContent.toLowerCase() === subject.toLowerCase()) {
              console.log('🚫 Filtering out cached email interaction with no meaningful body:', {
                id: interaction.id,
                subject: subject.substring(0, 50),
                contentLength: textContent.length,
                hasBodyContent
              });
              return false;
            }
          }
          return true;
        });
        
        // Process cached WhatsApp messages with templates if templates are available
        if (whatsAppTemplates.length > 0 && cachedWhatsAppCount > 0) {
          console.log('🔄 Processing cached WhatsApp messages with templates...');
          cachedInteractions = cachedInteractions.map((interaction: any) => {
            if (interaction.kind === 'whatsapp' && interaction.direction === 'out') {
              // Process template messages from cache
              const templateId = interaction.template_id;
              if (templateId) {
                const templateIdNum = Number(templateId);
                const template = whatsAppTemplates.find(t => Number(t.id) === templateIdNum);
                if (template && template.content) {
                  if (template.params === '0') {
                    return { ...interaction, content: template.content };
                  } else if (template.params === '1') {
                    const paramMatch = interaction.content?.match(/\[Template:.*?\]\s*(.+)/);
                    if (paramMatch && paramMatch[1].trim()) {
                      return { ...interaction, content: paramMatch[1].trim() };
                    }
                    return { ...interaction, content: template.content };
                  }
                }
              }
              
              // Fallback to name matching
              const templateMatch = interaction.content?.match(/\[Template:\s*([^\]]+)\]/) || 
                                    interaction.content?.match(/Template:\s*(.+)/) ||
                                    interaction.content?.match(/TEMPLATE_MARKER:(.+)/);
              
              if (templateMatch) {
                const templateTitle = templateMatch[1].trim().replace(/\]$/, '');
                const template = whatsAppTemplates.find(t => 
                  t.title.toLowerCase() === templateTitle.toLowerCase() ||
                  (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
                );
                if (template && template.content) {
                  if (template.params === '0') {
                    return { ...interaction, content: template.content };
                  } else if (template.params === '1') {
                    const paramMatch = interaction.content?.match(/\[Template:.*?\]\s*(.+)/);
                    if (paramMatch && paramMatch[1].trim()) {
                      return { ...interaction, content: paramMatch[1].trim() };
                    }
                    return { ...interaction, content: template.content };
                  }
                }
              }
            }
            return interaction;
          });
          console.log('✅ Processed cached WhatsApp messages with templates');
        }
        
        if (!isMountedRef.current) return;
        setInteractions(cachedInteractions);
        interactionsClientIdRef.current = client?.id?.toString() || null; // Track that these interactions belong to this client
        // Persist cached interactions to sessionStorage for tab switching
        if (client?.id && cachedInteractions.length > 0) {
          try {
            sessionStorage.setItem(`interactions_${client.id}`, JSON.stringify(cachedInteractions));
          } catch (e) {
            console.warn('Failed to persist cached interactions to sessionStorage:', e);
          }
        }
        setEmails(cacheForLead.emails || []);
        setInteractionsLoading(false);
        const cachedCount =
          cacheForLead.count ?? (cacheForLead.interactions ? cacheForLead.interactions.length : 0);
        onInteractionCountUpdate?.(cachedCount);
        isFetchingInteractionsRef.current = false;
        return;
      }

      const startTime = performance.now();
      console.log('🚀 Starting InteractionsTab fetch...');
      if (isMountedRef.current) {
        setInteractionsLoading(true);
      }
      try {
        // Ensure currentUserFullName is set before mapping emails
        let userFullName = currentUserFullName;
        if (!userFullName && !userFullNameLoadedRef.current) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && user.id) {
            const { data, error } = await supabase
              .from('users')
              .select(`
                full_name,
                employee_id,
                tenants_employee!employee_id(
                  display_name
                )
              `)
              .eq('auth_id', user.id)
              .single();
            if (!error && data) {
              // Use display_name from tenants_employee if available, otherwise full_name
              const employee = Array.isArray(data.tenants_employee) ? data.tenants_employee[0] : data.tenants_employee;
              userFullName = employee?.display_name || data.full_name;
              if (isMountedRef.current) {
                setCurrentUserFullName(userFullName);
                userFullNameLoadedRef.current = true;
              }
            }
          }
        }

        // Prepare parallel queries for better performance
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const legacyId = isLegacyLead ? parseInt(client.id.replace('legacy_', '')) : null;

        // Execute all database queries in parallel with aggressive limits
        const [whatsAppResult, callLogsResult, legacyResult, emailsResult] = await Promise.all([
          // WhatsApp messages query - only fetch essential fields
          client?.id ? (async () => {
            try {
              let query = supabase
                .from('whatsapp_messages')
                .select('id, sent_at, sender_name, direction, message, whatsapp_status, error_message, contact_id, phone_number, template_id')
                .limit(FETCH_BATCH_SIZE);
              
              if (isLegacyLead) {
                if (legacyId !== null) {
                  query = query.eq('legacy_id', legacyId);
                } else {
                  console.warn('⚠️ Legacy lead ID is null, skipping WhatsApp query');
                  return { data: [], error: null };
                }
              } else {
                query = query.eq('lead_id', client.id);
              }
              
              const { data, error } = await query.order('sent_at', { ascending: false });
              
              if (error) {
                console.error('❌ WhatsApp query error:', error);
              }
              
              return { data: data || [], error };
            } catch (err) {
              console.error('❌ WhatsApp query exception:', err);
              return { data: [], error: err };
            }
          })() : Promise.resolve({ data: [], error: null }),

          // Call logs query - only fetch essential fields
          // Note: call_logs.lead_id is BIGINT and only stores legacy lead IDs
          // For new leads, skip this query as call_logs doesn't support UUID lead_ids
          client?.id && isLegacyLead ? (async () => {
            try {
              const query = supabase
                .from('call_logs')
                .select(`
                  id,
                  cdate,
                  time,
                  source,
                  destination,
                  status,
                  duration,
                  url,
                  direction,
                  tenants_employee!employee_id (
                    display_name,
                    photo_url
                  )
                `)
                .eq('lead_id', legacyId)
                .limit(FETCH_BATCH_SIZE);
              
              const { data, error } = await query.order('cdate', { ascending: false });
              return { data, error };
            } catch (error) {
              return { data: [], error };
            }
          })() : Promise.resolve({ data: [], error: null }),

          // Legacy interactions query - only for legacy leads, with limit
          isLegacyLead && client?.id ? (async () => {
            try {
              const interactions = await fetchLegacyInteractions(client.id, client.name);
              return interactions.slice(0, FETCH_BATCH_SIZE);
            } catch (error) {
              return [];
            }
          })() : Promise.resolve([]),

          client?.id
            ? (async () => {
                // Collect all email addresses for this client (including contacts)
                // This ensures emails are shown in all leads where any of these email addresses match
                const clientEmails = collectClientEmails(client);
                // Also add emails from contacts if available
                const allEmails = [...clientEmails];
                if (leadContacts && leadContacts.length > 0) {
                  leadContacts.forEach((contact) => {
                    if (contact.email) {
                      const normalized = normalizeEmailForFilter(contact.email);
                      if (normalized && !allEmails.includes(normalized)) {
                        allEmails.push(normalized);
                      }
                    }
                  });
                }
                
                // Build query that matches by lead ID OR email addresses
                // This ensures emails are shown in all leads where the email address matches
                const emailFilters = buildEmailFilterClauses({
                  clientId: !isLegacyLead ? String(client.id) : null,
                  legacyId: isLegacyLead ? legacyId : null,
                  emails: allEmails,
                });

                let emailQuery = supabase
                  .from('emails')
                  .select(
                    'id, message_id, subject, sent_at, direction, sender_email, recipient_list, body_html, body_preview, attachments, contact_id'
                  )
                  .limit(EMAIL_MODAL_LIMIT)
                  .order('sent_at', { ascending: false });

                if (emailFilters.length > 0) {
                  emailQuery = emailQuery.or(emailFilters.join(','));
                } else if (isLegacyLead && legacyId !== null) {
                  emailQuery = emailQuery.eq('legacy_id', legacyId);
                } else {
                  emailQuery = emailQuery.eq('client_id', client.id);
                }

                const { data, error } = await emailQuery;
                return { data: data || [], error };
              })()
            : Promise.resolve({ data: [], error: null })
        ]);

        // Process results from parallel queries
        if (emailsResult.error) {
          console.error('❌ Failed to fetch emails for interactions tab:', emailsResult.error);
        }

        // Log WhatsApp query results for debugging
        if (whatsAppResult.error) {
          console.error('❌ Failed to fetch WhatsApp messages for interactions tab:', whatsAppResult.error);
        } else {
          console.log(`✅ Fetched ${whatsAppResult.data?.length || 0} WhatsApp messages for interactions tab`);
        }

        // Process WhatsApp messages with template content
        const processTemplateMessage = (msg: any): string => {
          let processedMessage = msg.message || '';
          
          // If templates aren't loaded yet, return original message
          if (whatsAppTemplates.length === 0) {
            console.log('⚠️ Templates not loaded yet, skipping template processing for message:', msg.id);
            return processedMessage;
          }
          
          // PRIORITY 1: Match by template_id if available (most reliable)
          if (msg.template_id) {
            const templateId = Number(msg.template_id);
            const template = whatsAppTemplates.find(t => Number(t.id) === templateId);
            if (template) {
              console.log(`✅ Matched template by ID ${templateId}: ${template.title} (${template.language || 'N/A'})`);
              if (template.params === '0' && template.content) {
                processedMessage = template.content;
              } else if (template.params === '1') {
                // For templates with params, try to extract parameter from message
                const paramMatch = msg.message?.match(/\[Template:.*?\]\s*(.+)/);
                if (paramMatch && paramMatch[1].trim()) {
                  processedMessage = paramMatch[1].trim();
                } else {
                  processedMessage = template.content || processedMessage;
                }
              }
              return processedMessage;
            } else {
              console.warn(`⚠️ Template with ID ${templateId} not found. Available IDs:`, whatsAppTemplates.map(t => t.id));
            }
          }
          
          // PRIORITY 2: Fallback to name matching for backward compatibility (legacy messages without template_id)
          if (msg.direction === 'out' && msg.message) {
            // Check if message already matches a template content
            const isAlreadyProperlyFormatted = whatsAppTemplates.some(template => 
              template.content && msg.message === template.content
            );
            
            if (isAlreadyProperlyFormatted) {
              return processedMessage;
            }
            
            // Try to find template by name in the message
            const templateMatch = msg.message.match(/\[Template:\s*([^\]]+)\]/) || 
                                  msg.message.match(/Template:\s*(.+)/) ||
                                  msg.message.match(/TEMPLATE_MARKER:(.+)/);
            
            if (templateMatch) {
              const templateTitle = templateMatch[1].trim().replace(/\]$/, '');
              console.log(`🔍 Looking for template by name: "${templateTitle}"`);
              
              // Try case-insensitive matching on title and name360
              const template = whatsAppTemplates.find(t => 
                t.title.toLowerCase() === templateTitle.toLowerCase() ||
                (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
              );
              
              if (template) {
                console.log(`✅ Matched template by name "${templateTitle}": ${template.title} (${template.language || 'N/A'})`);
                if (template.params === '0' && template.content) {
                  processedMessage = template.content;
                } else if (template.params === '1') {
                  // For templates with params, try to extract parameter from message
                  const paramMatch = msg.message.match(/\[Template:.*?\]\s*(.+)/);
                  if (paramMatch && paramMatch[1].trim()) {
                    processedMessage = paramMatch[1].trim();
                  } else {
                    processedMessage = template.content || processedMessage;
                  }
                }
              } else {
                console.warn(`⚠️ Template with name "${templateTitle}" not found. Available names:`, whatsAppTemplates.map(t => t.title || t.name360));
              }
            }
          }
          
          return processedMessage;
        };

        const [whatsAppDbMessages, callLogInteractions, legacyInteractions] = [
          // Process WhatsApp messages
          (whatsAppResult.data || []).map((msg: any) => {
            // Ensure sent_at exists and is valid
            const sentAt = msg.sent_at || msg.created_at || new Date().toISOString();
            const sentAtDate = new Date(sentAt);
            
            // Skip messages with invalid dates
            if (isNaN(sentAtDate.getTime())) {
              console.warn('⚠️ WhatsApp message has invalid sent_at:', { id: msg.id, sent_at: msg.sent_at });
              return null;
            }
            
            // Process template message to get actual content
            const processedContent = processTemplateMessage(msg);
            
            // Log if template processing occurred
            if (msg.message !== processedContent && msg.direction === 'out') {
              console.log(`✅ Template processed for message ${msg.id}:`, {
                original: msg.message?.substring(0, 50),
                processed: processedContent?.substring(0, 50),
                template_id: msg.template_id
              });
            }
            
            return {
              id: msg.id,
              date: sentAtDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
              time: sentAtDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
              raw_date: sentAt,
              employee: msg.sender_name || 'You',
              direction: msg.direction || 'in',
              kind: 'whatsapp',
              length: '',
              content: processedContent,
              observation: msg.error_message || '',
              editable: false,
              status: msg.whatsapp_status || 'sent',
              error_message: msg.error_message,
              contact_id: msg.contact_id || null,
              phone_number: msg.phone_number || null,
              template_id: msg.template_id || null,
            };
          }).filter((msg: any) => msg !== null),

          // Process call logs
          callLogsResult.data?.map((callLog: any) => {
            const callDate = new Date(callLog.cdate);
            const callTime = callLog.time || '00:00';
            const direction = callLog.direction?.toLowerCase().includes('incoming') ? 'in' : 'out';
            
            // Normalize phone number helper (shared for both employee and client matching)
            const normalizePhone = (p: string): string => {
              if (!p) return '';
              let cleaned = p.replace(/[^\d]/g, '');
              if (cleaned.startsWith('00972')) {
                cleaned = '0' + cleaned.substring(5);
              } else if (cleaned.startsWith('972')) {
                cleaned = '0' + cleaned.substring(3);
              } else if (cleaned.startsWith('00') && cleaned.length > 10) {
                const withoutPrefix = cleaned.substring(2);
                if (withoutPrefix.length >= 9 && !withoutPrefix.startsWith('0')) {
                  cleaned = '0' + withoutPrefix;
                } else {
                  cleaned = withoutPrefix;
                }
              }
              return cleaned;
            };
            
            // Helper to match by extension to employee (phone_ext or mobile_ext)
            // Simple extension matching: if we see "849", check if "849" exists in phone_ext or mobile_ext
            const matchExtensionToEmployee = (ext: string): string | null => {
              if (!ext || !employeePhoneMap || employeePhoneMap.size === 0) return null;
              
              const trimmed = String(ext).trim();
              
              // Simple direct match: check if extension exists in map (from phone_ext or mobile_ext)
              if (employeePhoneMap.has(trimmed)) {
                return employeePhoneMap.get(trimmed) || null;
              }
              
              // If extension has a dash (e.g., "849-decker"), try just the numeric part
              if (trimmed.includes('-')) {
                const numericPart = trimmed.split('-')[0].trim();
                if (numericPart && employeePhoneMap.has(numericPart)) {
                  return employeePhoneMap.get(numericPart) || null;
                }
              }
              
              // Also try numeric-only version (remove any non-digits)
              const numericOnly = trimmed.replace(/[^\d]/g, '');
              if (numericOnly && numericOnly !== trimmed && employeePhoneMap.has(numericOnly)) {
                return employeePhoneMap.get(numericOnly) || null;
              }
              
              return null;
            };
            
            // Helper to match phone/mobile number to client
            const matchPhoneNumberToClient = (phone: string): string | null => {
              if (!phone) return null;
              const normalized = normalizePhone(phone);
              if (!normalized || normalized.length < 9) return null; // Need at least 9 digits for phone number
              
              // Check against client phone/mobile
              const clientPhone = client.phone ? normalizePhone(client.phone) : '';
              const clientMobile = client.mobile ? normalizePhone(client.mobile) : '';
              
              // Exact matches
              if (normalized === clientPhone || normalized === clientMobile) {
                return client.name;
              }
              
              // Partial matches (last 7-9 digits)
              if (normalized.length >= 9) {
                const last9 = normalized.slice(-9);
                const last7 = normalized.slice(-7);
                
                if (clientPhone && (clientPhone.slice(-9) === last9 || clientPhone.slice(-7) === last7)) {
                  return client.name;
                }
                if (clientMobile && (clientMobile.slice(-9) === last9 || clientMobile.slice(-7) === last7)) {
                  return client.name;
                }
              }
              
              return null;
            };
            
            // Helper to match phone/mobile number to employee (fallback if not client)
            const matchPhoneNumberToEmployee = (phone: string): string | null => {
              if (!phone) return null;
              const trimmed = phone.trim();
              const normalized = normalizePhone(trimmed);
              
              // Try exact match first
              if (employeePhoneMap.has(trimmed)) {
                return employeePhoneMap.get(trimmed) || null;
              }
              if (normalized && employeePhoneMap.has(normalized)) {
                return employeePhoneMap.get(normalized) || null;
              }
              
              // Try partial match (last 7-9 digits)
              if (normalized && normalized.length >= 9) {
                const last9 = normalized.slice(-9);
                if (employeePhoneMap.has(last9)) {
                  return employeePhoneMap.get(last9) || null;
                }
                const last7 = normalized.slice(-7);
                if (employeePhoneMap.has(last7)) {
                  return employeePhoneMap.get(last7) || null;
                }
              }
              
              return null;
            };
            
            // Helper to match phone number to contact by last 4 digits
            const matchPhoneNumberToContact = (phone: string): string | null => {
              if (!phone || !leadContacts || leadContacts.length === 0) return null;
              
              const normalized = normalizePhone(phone);
              if (!normalized || normalized.length < 4) return null; // Need at least 4 digits
              
              const last4 = normalized.slice(-4);
              
              // Try to match against all contacts' phone and mobile numbers
              for (const contact of leadContacts) {
                if (contact.phone) {
                  const contactPhoneNormalized = normalizePhone(contact.phone);
                  if (contactPhoneNormalized && contactPhoneNormalized.slice(-4) === last4) {
                    return contact.name;
                  }
                }
                if (contact.mobile) {
                  const contactMobileNormalized = normalizePhone(contact.mobile);
                  if (contactMobileNormalized && contactMobileNormalized.slice(-4) === last4) {
                    return contact.name;
                  }
                }
              }
              
              return null;
            };
            
            // Determine employee name:
            // - For outbound calls: employee who made the call (source)
            // - For inbound calls: employee who received the call (destination)
            let employeeName: string | null = null;
            
            // Debug: log for first few calls
            const callLogsArray = callLogsResult?.data || [];
            const isDebugCall = callLogsArray.indexOf(callLog) < 2;
            
            // First, try to get employee name from the JOIN
            if (callLog.tenants_employee) {
              const employee = Array.isArray(callLog.tenants_employee) ? callLog.tenants_employee[0] : callLog.tenants_employee;
              if (employee?.display_name) {
                employeeName = employee.display_name;
                if (isDebugCall) {
                  console.log(`✅ Employee name from JOIN for call ${callLog.id}: "${employeeName}"`);
                }
              } else if (isDebugCall) {
                console.log(`⚠️ JOIN has employee but no display_name for call ${callLog.id}:`, employee);
              }
            } else {
              // JOIN didn't provide employee - this is where we need phone matching
              // Log this for debugging
              if (isDebugCall) {
                console.log(`⚠️ No JOIN employee data for call ${callLog.id}, will try phone matching. Source: "${callLog.source}", Destination: "${callLog.destination}", Direction: "${direction}", Map ready: ${employeePhoneMap.size > 0 ? 'YES' : 'NO'}`);
              }
            }
            
            // If JOIN didn't provide employee name, try matching extensions first (simple direct match)
            if (!employeeName) {
              if (isDebugCall) {
                console.log(`🔍 Starting extension/phone matching for call ${callLog.id}. Map size: ${employeePhoneMap.size}`);
                console.log(`🔍 Source: "${callLog.source}", Destination: "${callLog.destination}", Direction: "${direction}"`);
              }
              
              // Determine which field to check based on direction
              // For outbound: source is the employee extension
              // For inbound: destination is the employee extension
              const primaryField = direction === 'out' ? callLog.source : callLog.destination;
              const secondaryField = direction === 'out' ? callLog.destination : callLog.source;
              
              // Try primary field first (most likely to be the employee extension)
              if (primaryField) {
                const cleaned = String(primaryField).trim();
                
                // If it's a short number (2-4 digits), it's likely an extension - match directly
                if (/^\d+$/.test(cleaned) && cleaned.length >= 2 && cleaned.length <= 4) {
                  employeeName = matchExtensionToEmployee(cleaned);
                  if (employeeName && isDebugCall) {
                    console.log(`✅ Matched extension "${cleaned}" to employee "${employeeName}"`);
                  }
                }
                // If it has a dash (e.g., "849-decker"), try just the numeric part
                else if (cleaned.includes('-')) {
                  const numericPart = cleaned.split('-')[0].trim();
                  if (/^\d+$/.test(numericPart) && numericPart.length >= 2 && numericPart.length <= 4) {
                    employeeName = matchExtensionToEmployee(numericPart);
                    if (employeeName && isDebugCall) {
                      console.log(`✅ Matched extension "${numericPart}" (from "${cleaned}") to employee "${employeeName}"`);
                    }
                  }
                }
                
                // If extension matching didn't work, try as phone number (for longer numbers)
                if (!employeeName && cleaned.length > 4) {
                  employeeName = matchPhoneNumberToEmployee(cleaned);
                  if (employeeName && isDebugCall) {
                    console.log(`✅ Matched phone "${cleaned}" to employee "${employeeName}"`);
                  }
                }
              }
              
              // If primary field didn't match, try secondary field as fallback
              if (!employeeName && secondaryField) {
                const cleaned = String(secondaryField).trim();
                
                // Try extension matching for short numbers
                if (/^\d+$/.test(cleaned) && cleaned.length >= 2 && cleaned.length <= 4) {
                  employeeName = matchExtensionToEmployee(cleaned);
                  if (employeeName && isDebugCall) {
                    console.log(`✅ Matched extension "${cleaned}" (secondary) to employee "${employeeName}"`);
                  }
                }
                // Try phone matching for longer numbers
                else if (!employeeName && cleaned.length > 4) {
                  employeeName = matchPhoneNumberToEmployee(cleaned);
                  if (employeeName && isDebugCall) {
                    console.log(`✅ Matched phone "${cleaned}" (secondary) to employee "${employeeName}"`);
                  }
                }
              }
            }
            
            // Final fallback for employee name - show "Unknown" if we can't match
            if (!employeeName) {
              if (isDebugCall) {
                console.log(`❌ Could not match employee for call ${callLog.id}. Source: "${callLog.source}", Destination: "${callLog.destination}", Map size: ${employeePhoneMap.size}`);
              }
              employeeName = 'Unknown';
            } else if (isDebugCall) {
              console.log(`✅ Final employee name for call ${callLog.id}: "${employeeName}"`);
            }
            
            // Determine recipient name for "To:" field:
            // - For outbound calls: destination (client we called) - this is the recipient
            // - For inbound calls: destination (employee who received the call) - this is the recipient
            const recipientPhone = direction === 'out' ? callLog.destination : callLog.destination;
            let recipientName: string | null = null;
            
            if (recipientPhone) {
              // First try to match phone/mobile number to client
              if (recipientPhone.length > 4) {
                recipientName = matchPhoneNumberToClient(recipientPhone);
              }
              
              // If not a client, try matching to employee (fallback)
              if (!recipientName) {
                // Try extension match first
                if (recipientPhone.length >= 2 && recipientPhone.length <= 4) {
                  recipientName = matchExtensionToEmployee(recipientPhone);
                }
                // Then try phone number match
                if (!recipientName && recipientPhone.length > 4) {
                  recipientName = matchPhoneNumberToEmployee(recipientPhone);
                }
              }
              
              // If still no match, try matching to lead contacts by last 4 digits
              if (!recipientName && recipientPhone.length >= 4) {
                recipientName = matchPhoneNumberToContact(recipientPhone);
                if (recipientName && isDebugCall) {
                  console.log(`✅ Matched recipient phone "${recipientPhone}" to contact "${recipientName}" by last 4 digits`);
                }
              }
              
              // If still no match, show the phone number
              if (!recipientName) {
                recipientName = recipientPhone;
              }
            }
            
            const duration = callLog.duration ? `${Math.floor(callLog.duration / 60)}:${(callLog.duration % 60).toString().padStart(2, '0')}` : '0:00';
            
            let content = '';
            if (callLog.source && callLog.destination) {
              content = `From: ${callLog.source}, To: ${callLog.destination}`;
            } else if (callLog.source) {
              content = `From: ${callLog.source}`;
            } else if (callLog.destination) {
              content = `To: ${callLog.destination}`;
            } else {
              content = 'Call logged';
            }
            
            return {
              id: `call_${callLog.id}`,
              date: callDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
              time: callTime,
              raw_date: callLog.cdate,
              employee: employeeName,
              direction: direction,
              kind: 'call',
              length: duration,
              content: content,
              observation: '',
              editable: false,
              status: callLog.status,
              call_log: callLog,
              recording_url: callLog.url,
              call_duration: callLog.duration,
              employee_data: callLog.tenants_employee,
              recipient_name: recipientName || null, // Store the recipient name for display in "To:" field
            };
          }) || [],

          // Process legacy interactions
          // Note: We used to filter out calls here to avoid duplicates with call_logs table,
          // but this was also filtering out manual call interactions saved to leads_leadinteractions.
          // Now we keep all legacy interactions and rely on deduplication logic elsewhere.
          (() => {
            const legacyInteractions = Array.isArray(legacyResult) ? legacyResult : [];
            const clientLeadId = isLegacyLead ? legacyId : client.id;
            console.log(`📊 [InteractionsTab] Legacy interactions from fetchLegacyInteractions for lead ${clientLeadId}:`, {
              leadId: clientLeadId,
              legacyResultType: Array.isArray(legacyResult) ? 'array' : typeof legacyResult,
              legacyInteractionsCount: legacyInteractions.length,
              legacyInteractionIds: legacyInteractions.slice(0, 20).map((i: any) => i.id) // First 20 IDs
            });
            return legacyInteractions;
          })()
        ];

        // 1. Manual interactions - fast client-side processing
        const manualInteractions = (client.manual_interactions || []).map((i: any) => {
          // Use recipient_name if already set (from when interaction was saved)
          // Otherwise, calculate it based on direction
          let recipientName = i.recipient_name;
          
          if (!recipientName) {
            // Fallback: calculate recipient_name based on direction
            if (i.direction === 'out') {
              // Outgoing: we contacted client/contact - recipient is contact/client
              recipientName = i.contact_name || client.name;
            } else {
              // Incoming: client/contact contacted us - recipient is the employee who saved it
              // Note: i.employee is the sender (contact/client) for incoming, not the recipient
              // Use userFullName as fallback since we don't have the saved employee name here
              recipientName = userFullName || 'You';
            }
          }
          
          // Set sender (employee field) based on direction
          let employeeDisplay = '';
          if (i.direction === 'out') {
            // Outgoing: employee is sender
            employeeDisplay = i.employee || userFullName || 'You';
          } else {
            // Incoming: client/contact is sender
            employeeDisplay = i.contact_name || client.name;
          }
          
          // CRITICAL: Ensure raw_date exists - construct from date and time if missing
          let rawDate = i.raw_date;
          if (!rawDate && i.date && i.time) {
            // Try to parse date and time to create ISO string
            try {
              // Handle different date formats (DD/MM/YYYY, YYYY-MM-DD, etc.)
              const dateStr = i.date;
              const timeStr = i.time;
              
              // Try DD/MM/YYYY format first (common in en-GB)
              let parsedDate: Date | null = null;
              if (dateStr.includes('/')) {
                const [day, month, year] = dateStr.split('/');
                const fullYear = year.length === 2 ? `20${year}` : year;
                parsedDate = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timeStr}`);
              } else if (dateStr.includes('-')) {
                // Try YYYY-MM-DD format
                parsedDate = new Date(`${dateStr}T${timeStr}`);
              } else {
                // Try to parse as-is
                parsedDate = new Date(`${dateStr} ${timeStr}`);
              }
              
              if (parsedDate && !isNaN(parsedDate.getTime())) {
                rawDate = parsedDate.toISOString();
              } else {
                // Fallback: use current date if parsing fails
                rawDate = new Date().toISOString();
              }
            } catch (error) {
              console.warn('Failed to parse date/time for manual interaction:', { date: i.date, time: i.time, error });
              // Fallback: use current date if parsing fails
              rawDate = new Date().toISOString();
            }
          } else if (!rawDate) {
            // If no date/time at all, use current date as fallback
            rawDate = new Date().toISOString();
          }
          
          return {
            ...i,
            employee: employeeDisplay,
            recipient_name: recipientName, // Store recipient for display
            raw_date: rawDate, // Ensure raw_date is always set
          };
        });
        
        // Debug: Log manual interactions processing
        if (manualInteractions.length > 0) {
          console.log(`📋 [InteractionsTab] Processed ${manualInteractions.length} manual interactions:`, {
            leadId: isLegacyLead ? legacyId : client.id,
            interactions: manualInteractions.map(i => ({
              id: i.id,
              kind: i.kind,
              hasRawDate: !!i.raw_date,
              raw_date: i.raw_date,
              date: i.date,
              time: i.time
            }))
          });
        }
        
        // 2. Email interactions - prioritise freshly fetched emails, fallback to client prop
        const clientEmails = emailsResult.data || [];
        
        // Build employee email-to-name mapping for email sender matching
        const employeeEmailMap = await buildEmployeeEmailToNameMap();
        
        const sortedEmails = [...clientEmails].sort((a: any, b: any) => {
          const aDate = new Date(a.sent_at || 0).getTime();
          const bDate = new Date(b.sent_at || 0).getTime();
          return bDate - aDate;
        });
        
        // Helper function to check if email has meaningful body content
        const hasMeaningfulBody = (email: any): boolean => {
          const subject = email.subject?.trim() || '';
          
          // Check body_html
          if (email.body_html && email.body_html.trim() !== '') {
            // Remove HTML tags and normalize whitespace
            const textContent = email.body_html
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            
            // Check if there's actual text content that's different from subject
            if (textContent && 
                textContent.toLowerCase() !== subject.toLowerCase() && 
                textContent.length > 20) { // At least 20 characters of actual content
              return true;
            }
          }
          
          // Check body_preview
          if (email.body_preview && email.body_preview.trim() !== '') {
            // Remove HTML tags and normalize whitespace
            const textContent = email.body_preview
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            
            // Check if preview is meaningful:
            // - Not just subject
            // - Not just whitespace
            // - Has meaningful length (at least 20 characters)
            // - Not just common email prefixes like "RE:", "FW:", etc.
            if (textContent && 
                textContent.toLowerCase() !== subject.toLowerCase() &&
                !textContent.match(/^(re|fw|fwd):\s*$/i) && // Not just "RE:" or "FW:"
                textContent.length > 20) { // At least 20 characters of actual content
              return true;
            }
          }
          
          return false;
        };

        // Separate emails into those with meaningful body and those without
        const emailsWithBody: any[] = [];
        const emailsWithoutBody: any[] = [];
        
        sortedEmails.forEach((e: any) => {
          if (hasMeaningfulBody(e)) {
            emailsWithBody.push(e);
          } else {
            emailsWithoutBody.push(e);
          }
        });

        // Try to fetch bodies for emails that don't have meaningful content
        // This will happen asynchronously, so we'll filter them out for now
        // but they might appear after hydration
        if (emailsWithoutBody.length > 0 && userId) {
          // Fetch bodies for emails without content (limit to avoid too many requests)
          const emailsToHydrate = emailsWithoutBody.slice(0, 10).map((e: any) => ({
            id: e.message_id,
            subject: e.subject || '',
            bodyPreview: e.body_preview || '',
            body_html: e.body_html || null,
            body_preview: e.body_preview || null,
          }));
          
          // Hydrate in background (don't wait for it, and don't trigger refetch to avoid infinite loops)
          // The state updates from hydrateEmailBodies will cause a re-render if needed
          setTimeout(() => {
            hydrateEmailBodies(emailsToHydrate).catch(err => {
              console.error('Error hydrating email bodies in interactions list:', err);
            });
          }, 100);
        }

        // Only show emails with meaningful body content
        const emailInteractions = emailsWithBody
          .map((e: any) => {
            const emailDate = new Date(e.sent_at);
            
            // Use formatEmailHtmlForDisplay to preserve line breaks and apply RTL
            const bodyHtml = e.body_html ? formatEmailHtmlForDisplay(e.body_html) : null;
            const bodyPreview = e.body_preview ? formatEmailHtmlForDisplay(e.body_preview) : '';
            
            // Only use body content, never fall back to subject (we've already filtered out emails without body)
            // If body is empty after formatting, use empty string (shouldn't happen due to filtering)
            let body = '';
            if (bodyHtml && bodyHtml.trim() !== '') {
              // Remove HTML tags to check actual text content
              const textContent = bodyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              if (textContent && textContent.length > 20 && textContent.toLowerCase() !== e.subject?.trim().toLowerCase()) {
                body = bodyHtml;
              }
            }
            
            if (!body && bodyPreview && bodyPreview.trim() !== '') {
              // Remove HTML tags to check actual text content
              const textContent = bodyPreview.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              if (textContent && textContent.length > 20 && textContent.toLowerCase() !== e.subject?.trim().toLowerCase()) {
                body = bodyPreview;
              }
            }
            
            // If somehow body is still empty after all checks, skip this email
            if (!body || body.trim() === '') {
              return null; // This will be filtered out
            }
          
          // CRITICAL: Determine direction based on sender email
          // Simple rule: If sender is from office → employee to client (outgoing)
          //              If sender is NOT from office → client to employee (incoming)
          // This ensures we NEVER have client-to-client emails
          const senderEmail = e.sender_email || '';
          const isFromOffice = isOfficeEmail(senderEmail);
          
          // Override direction field based on sender
          // If sender is from office domain, it's always outgoing (employee to client)
          // If sender is NOT from office, it's always incoming (client to employee)
          let correctedDirection: 'outgoing' | 'incoming';
          if (isFromOffice) {
            correctedDirection = 'outgoing'; // Employee to client
          } else {
            correctedDirection = 'incoming'; // Client to employee
          }
          
          // Get sender display name - use employee display_name for office emails
          let senderDisplayName = null;
          if (isFromOffice) {
            // For team/user emails: use employee display_name from cache if available
            senderDisplayName = employeeEmailMap.get(senderEmail.toLowerCase()) || e.sender_name || null;
          }
          
          // Convert correctedDirection to timeline format ('outgoing'/'incoming' -> 'out'/'in')
          const isOutgoing = correctedDirection === 'outgoing';
          
          // Get employee name for timeline display - EXACT SAME LOGIC AS EMAIL MODAL DISPLAY (lines 5611-5624)
          let employeeName: string;
          let employeeRecipientName: string | null = null; // For incoming emails, store who received it
          
          if (isOutgoing) {
            // For team/user emails: use employee display_name from cache if available, otherwise fallback
            employeeName = senderDisplayName 
              || userFullName 
              || senderEmail 
              || 'Team';
          } else {
            // For client emails - use contact name or client name
            // Find contact by contact_id if available
            let contactName = null;
            if (e.contact_id && leadContacts && leadContacts.length > 0) {
              const contact = leadContacts.find((c: any) => c.id === Number(e.contact_id));
              if (contact) {
                contactName = contact.name;
              }
            }
            employeeName = contactName || client.name || senderEmail || 'Client';
            
            // For incoming emails (client to employee), find the employee recipient
            const recipientList = e.recipient_list?.toLowerCase() || '';
            const recipients = recipientList.split(/[,;]/).map((r: string) => r.trim().toLowerCase()).filter((r: string) => r);
            
            // Find employee email in recipient list
            for (const recipientEmail of recipients) {
              if (isOfficeEmail(recipientEmail)) {
                // Get employee name from employeeEmailMap
                employeeRecipientName = employeeEmailMap.get(recipientEmail) || recipientEmail;
                break;
              }
            }
            
            // Fallback if no employee found
            if (!employeeRecipientName) {
              employeeRecipientName = userFullName || 'Team';
            }
          }
          
          return {
            id: e.message_id,
            date: emailDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
            time: emailDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            raw_date: e.sent_at,
            employee: employeeName,
            direction: isOutgoing ? 'out' : 'in',
            kind: 'email',
            length: '',
            content: body,
            subject: e.subject || '',
            observation: e.observation || '',
            editable: false, // Actual emails are not editable, only manual emails are
            status: e.status,
            body_html: bodyHtml,
            body_preview: bodyPreview || null,
            contact_id: e.contact_id || null,
            sender_email: senderEmail || null,
            recipient_list: e.recipient_list || null,
            employee_recipient_name: employeeRecipientName, // Store employee recipient for incoming emails
          };
          })
          .filter((interaction: any) => interaction !== null); // Filter out null entries
      
        // Helper function to normalize line breaks for manual email interactions
        const normalizeManualContent = (content: string): string => {
          if (!content) return '';
          
          // Check if content already has HTML tags
          const hasHtmlTags = /<[^>]+>/.test(content);
          
          let normalized = content;
          
          if (hasHtmlTags) {
            // Content already has HTML - normalize existing <br> tags and line breaks
            // First, normalize line endings in the HTML
            normalized = normalized
              .replace(/\r\n/g, '\n')
              .replace(/\r/g, '\n');
            
            // Replace existing <br> tags with placeholder to avoid duplication
            const brPlaceholder = '__BR_PLACEHOLDER__';
            normalized = normalized.replace(/<br\s*\/?>/gi, brPlaceholder);
            
            // Normalize multiple consecutive line breaks (3+ to 2)
            normalized = normalized.replace(/\n{3,}/g, '\n\n');
            
            // Convert newlines to <br> tags
            normalized = normalized.replace(/\n\n/g, '__PARA_BREAK__');
            normalized = normalized.replace(/\n/g, '<br>');
            normalized = normalized.replace(/__PARA_BREAK__/g, '<br><br>');
            
            // Restore original <br> tags (they were already there)
            normalized = normalized.replace(new RegExp(brPlaceholder, 'g'), '<br>');
            
            // Collapse 3+ consecutive <br> tags to exactly 2
            normalized = normalized.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
          } else {
            // Plain text - normalize line endings
            normalized = normalized
              .replace(/\r\n/g, '\n')
              .replace(/\r/g, '\n');
            
            // Collapse excessive consecutive line breaks (3+ to 2 for paragraph spacing)
            normalized = normalized.replace(/\n{3,}/g, '\n\n');
            
            // Convert to HTML: single newline becomes <br>, double newline becomes <br><br>
            normalized = normalized.replace(/\n\n/g, '__PARA_BREAK__');
            normalized = normalized.replace(/\n/g, '<br>');
            normalized = normalized.replace(/__PARA_BREAK__/g, '<br><br>');
          }
          
          // Wrap in div with proper styling if not already wrapped
          if (!normalized.includes('<div')) {
            normalized = `<div dir="auto" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif; white-space: normal; line-height: 1.6;">${normalized}</div>`;
          }
          
          return normalized;
        };
        
        // Process legacy interactions to set recipient_name correctly (similar to manual interactions)
        const processedLegacyInteractions = (legacyInteractions || []).map((i: any) => {
          // Normalize content for email_manual and whatsapp_manual interactions
          let normalizedContent = i.content;
          if ((i.kind === 'email_manual' || i.kind === 'whatsapp_manual') && i.content) {
            normalizedContent = normalizeManualContent(i.content);
          }
          
          // Use recipient_name from transformation if available
          // The transformation already handles contact_name and employee name correctly
          // For outgoing: recipient is contact/client
          // For incoming: recipient is the employee who saved the interaction
          let recipientName = i.recipient_name;
          if (!recipientName) {
            // Fallback: calculate recipient_name based on direction
            if (i.direction === 'out') {
              // Outgoing: use contact_name if available, otherwise client name
              recipientName = i.contact_name || client.name;
            } else {
              // Incoming: client/contact contacted us, so recipient is the employee who saved it
              // Note: i.employee is the sender (contact/client) for incoming, not the recipient
              // We need to use the employee who created/saved the interaction
              // Since we don't have that info here, use a generic fallback
              recipientName = userFullName || 'Team';
            }
          }
          
          return {
            ...i,
            recipient_name: recipientName, // Store recipient for display (uses contact_name if available)
            content: normalizedContent, // Store normalized content
            // Preserve contact_id and contact_name from transformation
            contact_id: i.contact_id,
            contact_name: i.contact_name,
          };
        });
        
        // Combine all interactions
        const combined = [...manualInteractions, ...emailInteractions, ...whatsAppDbMessages, ...callLogInteractions, ...processedLegacyInteractions];
        
        // Log combined count before filtering
        const clientLeadId = isLegacyLead ? legacyId : client.id;
        console.log(`📊 [InteractionsTab] Combined interactions for lead ${clientLeadId}:`, {
          leadId: clientLeadId,
          manualCount: manualInteractions.length,
          emailCount: emailInteractions.length,
          whatsAppCount: whatsAppDbMessages.length,
          callLogCount: callLogInteractions.length,
          legacyCount: processedLegacyInteractions.length,
          totalCombined: combined.length
        });
        
        // Filter out interactions with invalid dates and log for debugging
        const filteredOutByReason: Record<string, number> = {};
        const filteredOutDetails: Array<{id: any, kind: any, reason: string, raw_date?: string, subject?: string, contentLength?: number}> = [];
        const validInteractions = combined.filter((interaction: any) => {
          if (!interaction.raw_date) {
            filteredOutByReason['missing_raw_date'] = (filteredOutByReason['missing_raw_date'] || 0) + 1;
            filteredOutDetails.push({ id: interaction.id, kind: interaction.kind, reason: 'missing_raw_date' });
            return false;
          }
          const date = new Date(interaction.raw_date);
          if (isNaN(date.getTime())) {
            filteredOutByReason['invalid_raw_date'] = (filteredOutByReason['invalid_raw_date'] || 0) + 1;
            filteredOutDetails.push({ id: interaction.id, kind: interaction.kind, reason: 'invalid_raw_date', raw_date: interaction.raw_date });
            return false;
          }
          
          // CRITICAL: Filter out email interactions that have no meaningful body content
          // This is a safety check in case emails slipped through the earlier filtering
          if (interaction.kind === 'email') {
            // Check if this is a manual interaction (by ID prefix) - always include manual interactions
            const isManualInteraction = interaction.id?.toString().startsWith('manual_');
            if (isManualInteraction) {
              // Always include manual interactions regardless of content length
              return true;
            }
            
            const content = interaction.content || '';
            const subject = interaction.subject || '';
            
            // Remove HTML tags to check actual text content
            const textContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            
            // Filter out if:
            // 1. Content is empty or just whitespace
            // 2. Content is the same as subject (case-insensitive)
            // 3. Content is too short (less than 20 characters)
            if (!textContent || 
                textContent.length < 20 || 
                textContent.toLowerCase() === subject.toLowerCase()) {
              filteredOutByReason['email_no_meaningful_body'] = (filteredOutByReason['email_no_meaningful_body'] || 0) + 1;
              filteredOutDetails.push({ 
                id: interaction.id, 
                kind: interaction.kind, 
                reason: 'email_no_meaningful_body',
                subject: subject.substring(0, 50),
                contentLength: textContent.length
              });
              return false;
            }
          }
          
          return true;
        });
        
        // Log filtering results
        console.log(`📊 [InteractionsTab] After filtering validInteractions for lead ${clientLeadId}:`, {
          leadId: clientLeadId,
          beforeFiltering: combined.length,
          afterFiltering: validInteractions.length,
          filteredOut: combined.length - validInteractions.length,
          filteredOutByReason,
          filteredOutDetails: filteredOutDetails.slice(0, 20) // First 20 for debugging
        });
        
        // Deduplicate interactions - remove exact duplicates by id
        const duplicateIds = new Set();
        const uniqueById = validInteractions.filter((interaction: any, index: number, self: any[]) => {
          const firstIndex = self.findIndex((i: any) => i.id === interaction.id);
          if (firstIndex !== index) {
            duplicateIds.add(interaction.id);
            return false;
          }
          return true;
        });
        
        console.log(`📊 [InteractionsTab] After deduplication by ID for lead ${clientLeadId}:`, {
          leadId: clientLeadId,
          beforeDedup: validInteractions.length,
          afterDedup: uniqueById.length,
          duplicatesRemoved: validInteractions.length - uniqueById.length,
          duplicateIds: Array.from(duplicateIds).slice(0, 20) // First 20 for debugging
        });
        
        // For emails, deduplicate by message_id - keep the one with most content
        // Also filter out emails that only have a subject (no actual content)
        const emailMap = new Map<string, any>();
        const nonEmailInteractions: any[] = [];
        const emailsFilteredOut: Array<{id: any, reason: string, isLegacy?: boolean, hasBodyHtml?: boolean, hasBodyPreview?: boolean, hasContentField?: boolean, contentLength?: number, subject?: string}> = [];
        const emailsDeduplicated: Array<{id: any, keptId: any}> = [];
        
        uniqueById.forEach((interaction: any) => {
          if (interaction.kind === 'email' && interaction.id) {
            // Check if this is a manual interaction (by ID prefix) - always include manual interactions
            const isManualInteraction = interaction.id?.toString().startsWith('manual_');
            if (isManualInteraction) {
              // Always include manual interactions - add to nonEmailInteractions to bypass email deduplication
              nonEmailInteractions.push(interaction);
              return;
            }
            
            // Check if this is a legacy email (from leads_leadinteractions)
            // Legacy emails have content field, not body_html/body_preview
            const isLegacyEmail = interaction.id?.toString().startsWith('legacy_');
            
            let hasContent = false;
            
            if (isLegacyEmail) {
              // For legacy emails, check content field directly
              const contentText = (interaction.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              const subjectText = (interaction.subject || '').trim();
              
              hasContent = contentText && 
                          contentText.length >= 20 && // At least 20 characters
                          contentText.toLowerCase() !== subjectText.toLowerCase();
            } else {
              // For new emails (from emails table), check body_html/body_preview
              const hasBodyContent = (interaction.body_html && interaction.body_html.trim() !== '') ||
                                    (interaction.body_preview && interaction.body_preview.trim() !== '');
              
              // Remove HTML tags to check actual text content
              const contentText = (interaction.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              const subjectText = (interaction.subject || '').trim();
              
              // Must have body content AND meaningful text content that's different from subject
              hasContent = hasBodyContent && 
                          contentText && 
                          contentText.length >= 20 && // At least 20 characters
                          contentText.toLowerCase() !== subjectText.toLowerCase();
            }
            
            if (!hasContent) {
              // Skip this email - it only has a subject or no meaningful content
              const contentText = (interaction.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              emailsFilteredOut.push({ 
                id: interaction.id, 
                reason: 'email_no_content',
                isLegacy: isLegacyEmail,
                hasBodyHtml: !!(interaction.body_html && interaction.body_html.trim()),
                hasBodyPreview: !!(interaction.body_preview && interaction.body_preview.trim()),
                hasContentField: !!(interaction.content && interaction.content.trim()),
                contentLength: contentText.length,
                subject: (interaction.subject || '').substring(0, 50)
              });
              return;
            }
            
            const messageId = interaction.id;
            const existing = emailMap.get(messageId);
            
            if (!existing) {
              emailMap.set(messageId, interaction);
            } else {
              // Compare content - keep the one with more content (not just subject)
              // Use same strict checking as above
              const existingContentText = (existing.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              const existingSubjectText = (existing.subject || '').trim();
              const existingHasContent = existingContentText && 
                                        existingContentText.length >= 20 &&
                                        existingContentText.toLowerCase() !== existingSubjectText.toLowerCase();
              
              const currentContentText = (interaction.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              const currentSubjectText = (interaction.subject || '').trim();
              const currentHasContent = currentContentText && 
                                       currentContentText.length >= 20 &&
                                       currentContentText.toLowerCase() !== currentSubjectText.toLowerCase();
              
              if (currentHasContent && !existingHasContent) {
                // Current has content, existing doesn't - replace
                emailsDeduplicated.push({ id: interaction.id, keptId: existing.id });
                emailMap.set(messageId, interaction);
              } else if (!currentHasContent && existingHasContent) {
                // Existing has content, current doesn't - keep existing
                emailsDeduplicated.push({ id: interaction.id, keptId: existing.id });
                // Do nothing
              } else if (currentHasContent && existingHasContent) {
                // Both have content, keep the one with more content
                if (currentContentText.length > existingContentText.length) {
                  emailsDeduplicated.push({ id: existing.id, keptId: interaction.id });
                  emailMap.set(messageId, interaction);
                } else {
                  emailsDeduplicated.push({ id: interaction.id, keptId: existing.id });
                }
              }
              // If neither has content, don't add either (shouldn't happen due to earlier filtering)
            }
          } else {
            nonEmailInteractions.push(interaction);
          }
        });
        
        console.log(`📊 [InteractionsTab] After email deduplication for lead ${clientLeadId}:`, {
          leadId: clientLeadId,
          beforeEmailDedup: uniqueById.length,
          emailsFilteredOut: emailsFilteredOut.length,
          emailsDeduplicated: emailsDeduplicated.length,
          afterEmailDedup: Array.from(emailMap.values()).length + nonEmailInteractions.length,
          emailsFilteredOutDetails: emailsFilteredOut, // Show all filtered emails
          emailsDeduplicatedDetails: emailsDeduplicated.slice(0, 20),
          emailBreakdown: {
            totalEmails: uniqueById.filter((i: any) => i.kind === 'email').length,
            legacyEmails: uniqueById.filter((i: any) => i.kind === 'email' && i.id?.toString().startsWith('legacy_')).length,
            newEmails: uniqueById.filter((i: any) => i.kind === 'email' && !i.id?.toString().startsWith('legacy_')).length
          }
        });
        
        // Additional deduplication: remove interactions with the same timestamp
        // Group by timestamp and keep only one per timestamp
        const timestampMap = new Map<string, any>();
        const allInteractions = [...Array.from(emailMap.values()), ...nonEmailInteractions];
        const timestampDuplicates: Array<{id: any, timestampKey: string, keptId: any}> = [];
        
        allInteractions.forEach((interaction: any) => {
          const timestampKey = `${interaction.raw_date}_${interaction.kind}`;
          const existing = timestampMap.get(timestampKey);
          
          if (!existing) {
            timestampMap.set(timestampKey, interaction);
          } else {
            // If we have duplicates with same timestamp, prefer the one with more content
            const existingHasContent = existing.content && 
                                      existing.content !== existing.subject && 
                                      existing.content.trim() !== '';
            const currentHasContent = interaction.content && 
                                     interaction.content !== interaction.subject && 
                                     interaction.content.trim() !== '';
            
            if (currentHasContent && !existingHasContent) {
              // Current has content, existing doesn't - replace
              timestampDuplicates.push({ id: existing.id, timestampKey, keptId: interaction.id });
              timestampMap.set(timestampKey, interaction);
            } else if (!currentHasContent && existingHasContent) {
              // Existing has content, current doesn't - keep existing
              timestampDuplicates.push({ id: interaction.id, timestampKey, keptId: existing.id });
              // Do nothing
            } else {
              // Both have same level of content, keep the first one
              timestampDuplicates.push({ id: interaction.id, timestampKey, keptId: existing.id });
              // Do nothing
            }
          }
        });
        
        const uniqueInteractions = Array.from(timestampMap.values());
        
        console.log(`📊 [InteractionsTab] After timestamp deduplication for lead ${clientLeadId}:`, {
          leadId: clientLeadId,
          beforeTimestampDedup: allInteractions.length,
          afterTimestampDedup: uniqueInteractions.length,
          timestampDuplicatesRemoved: allInteractions.length - uniqueInteractions.length,
          timestampDuplicatesDetails: timestampDuplicates.slice(0, 20)
        });
        
        console.log(`📊 [InteractionsTab] FINAL COUNT for lead ${clientLeadId}:`, {
          leadId: clientLeadId,
          finalCount: uniqueInteractions.length,
          breakdown: {
            manual: uniqueInteractions.filter((i: any) => !i.id?.toString().startsWith('legacy_') && !i.id?.toString().startsWith('call_') && i.kind !== 'email' && i.kind !== 'whatsapp').length,
            email: uniqueInteractions.filter((i: any) => i.kind === 'email').length,
            whatsapp: uniqueInteractions.filter((i: any) => i.kind === 'whatsapp').length,
            call: uniqueInteractions.filter((i: any) => i.kind === 'call').length,
            legacy: uniqueInteractions.filter((i: any) => i.id?.toString().startsWith('legacy_')).length,
            callLog: uniqueInteractions.filter((i: any) => i.id?.toString().startsWith('call_')).length
          }
        });
        
        const sorted = uniqueInteractions.sort((a, b) => {
          const dateA = new Date(a.raw_date).getTime();
          const dateB = new Date(b.raw_date).getTime();
          return dateB - dateA;
        });
        
        // Log WhatsApp messages count for debugging
        const whatsappCount = sorted.filter((i: any) => i.kind === 'whatsapp').length;
        if (whatsappCount > 0) {
          console.log(`✅ Processed ${whatsappCount} WhatsApp messages in interactions timeline`);
        }
        
        // Persist interactions to sessionStorage for tab switching
        if (client?.id && sorted.length > 0) {
          try {
            sessionStorage.setItem(`interactions_${client.id}`, JSON.stringify(sorted));
          } catch (e) {
            console.warn('Failed to persist interactions to sessionStorage:', e);
          }
        }
        
        const formattedEmailsForModal = sortedEmails.slice(0, EMAIL_MODAL_LIMIT).map((e: any) => {
          const previewSource = e.body_html || e.body_preview || e.subject || '';
          // Use formatEmailHtmlForDisplay to preserve line breaks and apply RTL
          const previewHtmlSource = previewSource
            ? (/<[a-z][\s\S]*>/i.test(previewSource) 
                ? formatEmailHtmlForDisplay(previewSource) 
                : convertBodyToHtml(previewSource))
            : '';
          const sanitizedPreviewBase = previewHtmlSource ? sanitizeEmailHtml(previewHtmlSource) : '';
          const sanitizedPreview = sanitizedPreviewBase || sanitizeEmailHtml(convertBodyToHtml(e.subject || ''));

          return {
            id: e.message_id,
            subject: e.subject,
            from: e.sender_email,
            to: e.recipient_list,
            date: e.sent_at,
            bodyPreview: sanitizedPreview,
            direction: e.direction,
            attachments: e.attachments,
          };
        });
        // Always set interactions - React will handle unmounted components gracefully
        // If component remounts, we want the data anyway
        const whatsappInSorted = sorted.filter((i: any) => i.kind === 'whatsapp').length;
        console.log(`📊 Setting interactions: ${sorted.length} total, ${whatsappInSorted} WhatsApp messages`);
        console.log(`📊 isMountedRef.current: ${isMountedRef.current}`);
        
        if (!isMountedRef.current) {
          console.warn('⚠️ Component appears unmounted, but setting interactions anyway (component may remount)');
        }
        
        setInteractions(sorted as Interaction[]);
        interactionsClientIdRef.current = client?.id?.toString() || null; // Track that these interactions belong to this client
        // Persist interactions to sessionStorage for tab switching
        if (client?.id && sorted.length > 0) {
          try {
            sessionStorage.setItem(`interactions_${client.id}`, JSON.stringify(sorted));
          } catch (e) {
            console.warn('Failed to persist interactions to sessionStorage:', e);
          }
        }
        
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);
        console.log(`✅ InteractionsTab loaded in ${duration}ms with ${sorted.length} interactions`);
        setEmails(formattedEmailsForModal);

        onInteractionCountUpdate?.(sorted.length);
        onInteractionsCacheUpdate?.({
          leadId: client.id,
          interactions: sorted,
          emails: formattedEmailsForModal,
          count: sorted.length,
          fetchedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Error in fetchAndCombineInteractions:', error);
        if (isMountedRef.current) {
          setInteractions([]);
          setEmails([]);
        }
        onInteractionCountUpdate?.(0);
        onInteractionsCacheUpdate?.({
          leadId: client.id,
          interactions: [],
          emails: [],
          count: 0,
          fetchedAt: new Date().toISOString(),
        });
      } finally {
        isFetchingInteractionsRef.current = false;
        if (isMountedRef.current) setInteractionsLoading(false);
      }
    },
    [
      client?.id, // Only depend on client.id, not the whole client object
      leadContacts, // Include contacts so we can match emails by contact email addresses
      interactionsCache,
      currentUserFullName,
      onInteractionCountUpdate,
      onInteractionsCacheUpdate,
      // Removed whatsAppTemplates and employeePhoneMap from dependencies - they're used directly in the function
      // This prevents unnecessary re-creation of fetchInteractions when these change
    ]
  );

  // Use ref to track last client ID to prevent infinite loops
  const lastClientIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef<boolean>(false);
  const interactionsClientIdRef = useRef<string | null>(null); // Track which client ID the current interactions belong to
  
  useEffect(() => {
    const currentClientId = client?.id?.toString() || null;
    
    // If we already have interactions for this client, don't fetch again (tab switching scenario)
    if (currentClientId && interactionsClientIdRef.current === currentClientId && interactions.length > 0) {
      console.log(`✅ Already have ${interactions.length} interactions for client ${currentClientId}, skipping fetch (tab switch)`);
      setInteractionsLoading(false);
      lastClientIdRef.current = currentClientId;
      return;
    }
    
    // Only fetch if client ID actually changed and we're not already fetching
    if (currentClientId && currentClientId !== lastClientIdRef.current && !isFetchingRef.current) {
      
      // Check for persisted state in sessionStorage first
      let hasPersistedData = false;
      try {
        const persistedKey = `interactions_${currentClientId}`;
        const persisted = sessionStorage.getItem(persistedKey);
        if (persisted) {
          try {
            const parsed = JSON.parse(persisted);
            if (Array.isArray(parsed) && parsed.length > 0) {
              console.log(`✅ Found persisted interactions for client ${currentClientId} (${parsed.length} interactions), loading from sessionStorage`);
              setInteractions(parsed);
              setInteractionsLoading(false);
              interactionsClientIdRef.current = currentClientId; // Track that these interactions belong to this client
              // Update cache with persisted data
              if (onInteractionsCacheUpdate) {
                onInteractionsCacheUpdate({
                  leadId: currentClientId,
                  interactions: parsed,
                  emails: [],
                  count: parsed.length,
                  fetchedAt: new Date().toISOString(),
                });
              }
              if (onInteractionCountUpdate) {
                onInteractionCountUpdate(parsed.length);
              }
              lastClientIdRef.current = currentClientId;
              hasPersistedData = true;
            }
          } catch (e) {
            console.warn('Failed to parse persisted interactions:', e);
          }
        }
      } catch (e) {
        // sessionStorage might not be available
      }
      
      // If we have persisted data, don't fetch
      if (hasPersistedData) {
        return;
      }
      
      // Check if we have cache for this client
      if (interactionsCache && interactionsCache.leadId === currentClientId && interactionsCache.interactions && interactionsCache.interactions.length > 0) {
        console.log(`✅ Using cached interactions for client ${currentClientId} (${interactionsCache.interactions.length} interactions)`);
        setInteractions(interactionsCache.interactions);
        setInteractionsLoading(false);
        interactionsClientIdRef.current = currentClientId; // Track that these interactions belong to this client
        if (onInteractionCountUpdate) {
          onInteractionCountUpdate(interactionsCache.count || interactionsCache.interactions.length);
        }
        lastClientIdRef.current = currentClientId;
        return;
      }
      
      // No persisted data or cache, fetch fresh
      console.log('🔄 Client changed, fetching fresh interactions...', {
        previous: lastClientIdRef.current,
        current: currentClientId,
        isFetching: isFetchingRef.current
      });
      lastClientIdRef.current = currentClientId;
      isFetchingRef.current = true;
      
      // Call fetchInteractions - it will check cache internally
      fetchInteractions({ bypassCache: false }).finally(() => {
        isFetchingRef.current = false;
      });
    } else if (!currentClientId) {
      // Clear if no client
      if (lastClientIdRef.current !== null) {
        lastClientIdRef.current = null;
        isFetchingRef.current = false;
        setInteractions([]);
        setEmails([]);
        setInteractionsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]); // Only depend on client.id - interactions are managed separately

  // Fetch contacts when client changes
  useEffect(() => {
    const loadContacts = async () => {
      if (!client?.id) {
        setLeadContacts([]);
        return;
      }
      
      try {
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const normalizedLeadId = isLegacyLead 
          ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
          : client.id;
        
        const contacts = await fetchLeadContacts(normalizedLeadId, isLegacyLead);
        setLeadContacts(contacts);
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setLeadContacts([]);
      }
    };
    
    loadContacts();
  }, [client?.id, client?.lead_type]);

  // Fetch employee phone/extension mapping - use allEmployees prop if available
  useEffect(() => {
    const loadEmployeePhoneMap = async () => {
      try {
        // Use employees from prop if available, otherwise fetch
        let employees: any[] = [];
        
        if (allEmployees && allEmployees.length > 0) {
          // Use employees from prop (already loaded in parent)
          employees = allEmployees;
        } else {
          // Fallback: fetch employees if not provided via prop
          const { data, error } = await supabase
            .from('tenants_employee')
            .select('id, display_name, phone_ext, phone, mobile, mobile_ext, onecom_code, photo_url')
            .not('display_name', 'is', null);

          if (error) {
            console.error('Error fetching employees for phone mapping:', error);
            return;
          }
          
          employees = data || [];
        }

        const phoneMap = new Map<string, string>();
        const photoMap = new Map<string, string>(); // display_name -> photo_url
        
        const normalizePhone = (phone: string): string => {
          if (!phone) return '';
          // Remove all non-digit characters
          let cleaned = phone.replace(/[^\d]/g, '');
          // Handle Israeli phone numbers: remove country code prefixes
          if (cleaned.startsWith('00972')) {
            cleaned = '0' + cleaned.substring(5);
          } else if (cleaned.startsWith('972')) {
            cleaned = '0' + cleaned.substring(3);
          } else if (cleaned.startsWith('00') && cleaned.length > 10) {
            const withoutPrefix = cleaned.substring(2);
            if (withoutPrefix.length >= 9 && !withoutPrefix.startsWith('0')) {
              cleaned = '0' + withoutPrefix;
            } else {
              cleaned = withoutPrefix;
            }
          }
          return cleaned;
        };

        employees?.forEach((emp: any) => {
          if (!emp.display_name) return;

          // Map employee name to photo URL
          if (emp.photo_url) {
            photoMap.set(emp.display_name, emp.photo_url);
          }

          // Map all phone/ext variations to employee name
          if (emp.phone_ext) {
            const ext = String(emp.phone_ext).trim();
            // Store both the full extension and just the numeric part
            phoneMap.set(ext, emp.display_name);
            // Also match with tenant prefix if exists (e.g., "849-decker" -> "849")
            if (ext.includes('-')) {
              phoneMap.set(ext.split('-')[0], emp.display_name);
            }
            // Also store just the numeric part if it contains non-digits
            const numericOnly = ext.replace(/[^\d]/g, '');
            if (numericOnly && numericOnly !== ext) {
              phoneMap.set(numericOnly, emp.display_name);
            }
          }
          if (emp.phone) {
            const phone = normalizePhone(emp.phone);
            if (phone) {
              phoneMap.set(phone, emp.display_name);
              // Also match last 7-9 digits for partial matching
              if (phone.length >= 9) {
                phoneMap.set(phone.slice(-9), emp.display_name);
                phoneMap.set(phone.slice(-7), emp.display_name);
              }
            }
          }
          if (emp.mobile) {
            const mobile = normalizePhone(emp.mobile);
            if (mobile) {
              phoneMap.set(mobile, emp.display_name);
              if (mobile.length >= 9) {
                phoneMap.set(mobile.slice(-9), emp.display_name);
                phoneMap.set(mobile.slice(-7), emp.display_name);
              }
            }
          }
          if (emp.mobile_ext) {
            const mobileExt = String(emp.mobile_ext).trim();
            // Store both the full extension and just the numeric part
            phoneMap.set(mobileExt, emp.display_name);
            // Also match with tenant prefix if exists (e.g., "849-decker" -> "849")
            if (mobileExt.includes('-')) {
              phoneMap.set(mobileExt.split('-')[0], emp.display_name);
            }
            // Also store just the numeric part if it contains non-digits
            const numericOnly = mobileExt.replace(/[^\d]/g, '');
            if (numericOnly && numericOnly !== mobileExt) {
              phoneMap.set(numericOnly, emp.display_name);
            }
          }
          // Also map onecom_code if available (this is often used for OneCom integration)
          if (emp.onecom_code !== null && emp.onecom_code !== undefined) {
            const onecomCode = String(emp.onecom_code).trim();
            if (onecomCode) {
              phoneMap.set(onecomCode, emp.display_name);
              // Also store numeric-only version
              const numericOnly = onecomCode.replace(/[^\d]/g, '');
              if (numericOnly && numericOnly !== onecomCode) {
                phoneMap.set(numericOnly, emp.display_name);
              }
            }
          }
        });

        console.log(`✅ Loaded employee phone map with ${phoneMap.size} entries`);
        console.log(`✅ Loaded employee photo map with ${photoMap.size} entries`);
        setEmployeePhoneMap(phoneMap);
        setEmployeePhotoMap(photoMap);
      } catch (error) {
        console.error('Error loading employee phone map:', error);
      }
    };

    loadEmployeePhoneMap();
  }, [allEmployees]); // Depend on allEmployees so it rebuilds when employees are loaded

  // Re-process interactions when employeePhoneMap becomes available
  // Update interactions in place instead of re-fetching to avoid performance issues
  useEffect(() => {
    if (employeePhoneMap.size > 0 && interactions.length > 0 && client?.id) {
      // Check if any call interactions have "Unknown" or suspiciously short employee names
      const callInteractions = interactions.filter((i: any) => i.kind === 'call');
      const hasUnknownEmployees = callInteractions.some((i: any) => {
        const empName = i.employee || '';
        // Check for "Unknown", empty, or very short names (likely failed matching)
        return empName === 'Unknown' || empName === '' || (empName.length <= 2 && empName !== 'AZ'); // AZ is valid initials
      });
      
      if (hasUnknownEmployees) {
        const unknownCount = callInteractions.filter((i: any) => {
          const empName = i.employee || '';
          return empName === 'Unknown' || empName === '' || (empName.length <= 2 && empName !== 'AZ');
        }).length;
        console.log(`🔄 Employee phone map loaded (${employeePhoneMap.size} entries), found ${unknownCount} call(s) with unknown/short employee names, updating in place...`);
        
        // Update interactions in place instead of re-fetching
        const updatedInteractions = interactions.map((interaction: any) => {
          if (interaction.kind === 'call' && (interaction.employee === 'Unknown' || !interaction.employee || interaction.employee.length <= 2)) {
            // Re-process this call with the now-available phone map
            const callLog = interaction.call_log;
            if (callLog) {
              const direction = callLog.direction || 'out';
              const primaryField = direction === 'out' ? callLog.source : callLog.destination;
              
              if (primaryField) {
                const cleaned = String(primaryField).trim();
                let employeeName: string | null = null;
                
                // Try extension matching
                if (/^\d+$/.test(cleaned) && cleaned.length >= 2 && cleaned.length <= 4) {
                  employeeName = employeePhoneMap.get(cleaned) || null;
                } else if (cleaned.includes('-')) {
                  const numericPart = cleaned.split('-')[0].trim();
                  if (/^\d+$/.test(numericPart) && numericPart.length >= 2 && numericPart.length <= 4) {
                    employeeName = employeePhoneMap.get(numericPart) || null;
                  }
                }
                
                // Try phone matching
                if (!employeeName && cleaned.length > 4) {
                  const normalized = cleaned.replace(/[^\d]/g, '');
                  employeeName = employeePhoneMap.get(normalized) || 
                                 employeePhoneMap.get(normalized.slice(-9)) || 
                                 employeePhoneMap.get(normalized.slice(-7)) || 
                                 null;
                }
                
                if (employeeName) {
                  console.log(`✅ Updated call ${interaction.id} employee from "${interaction.employee}" to "${employeeName}"`);
                  return { ...interaction, employee: employeeName };
                }
              }
            }
          }
          return interaction;
        });
        
        // Only update if we actually changed something
        const hasChanges = updatedInteractions.some((updated: any, idx: number) => 
          updated.employee !== interactions[idx]?.employee
        );
        
        if (hasChanges) {
          setInteractions(updatedInteractions);
        }
      }
    }
  }, [employeePhoneMap.size, client?.id]); // Removed interactions.length to prevent loops

  // Helper function to match phone number to employee or client name
  const matchPhoneToName = (phoneNumber: string | null | undefined): string | null => {
    if (!phoneNumber || !phoneNumber.trim()) return null;

    const phone = phoneNumber.trim();
    
    // Normalize phone number
    const normalizePhone = (p: string): string => {
      let cleaned = p.replace(/[^\d]/g, '');
      if (cleaned.startsWith('00972')) {
        cleaned = '0' + cleaned.substring(5);
      } else if (cleaned.startsWith('972')) {
        cleaned = '0' + cleaned.substring(3);
      } else if (cleaned.startsWith('00') && cleaned.length > 10) {
        const withoutPrefix = cleaned.substring(2);
        if (withoutPrefix.length >= 9 && !withoutPrefix.startsWith('0')) {
          cleaned = '0' + withoutPrefix;
        } else {
          cleaned = withoutPrefix;
        }
      }
      return cleaned;
    };

    // Try exact match first
    if (employeePhoneMap.has(phone)) {
      return employeePhoneMap.get(phone) || null;
    }

    // Try normalized match
    const normalized = normalizePhone(phone);
    if (employeePhoneMap.has(normalized)) {
      return employeePhoneMap.get(normalized) || null;
    }

    // Try extension match (if it's a short number like "849" or "849-decker")
    if (phone.length >= 2 && phone.length <= 4) {
      if (employeePhoneMap.has(phone)) {
        return employeePhoneMap.get(phone) || null;
      }
      // Also try without tenant suffix
      if (phone.includes('-')) {
        const ext = phone.split('-')[0];
        if (employeePhoneMap.has(ext)) {
          return employeePhoneMap.get(ext) || null;
        }
      }
    }

    // Try partial match (last 7-9 digits for phone numbers)
    if (normalized.length >= 9) {
      const last9 = normalized.slice(-9);
      if (employeePhoneMap.has(last9)) {
        return employeePhoneMap.get(last9) || null;
      }
      const last7 = normalized.slice(-7);
      if (employeePhoneMap.has(last7)) {
        return employeePhoneMap.get(last7) || null;
      }
    }

    // Try to match against client phone numbers
    if (normalized) {
      const clientPhone = client.phone ? normalizePhone(client.phone) : '';
      const clientMobile = client.mobile ? normalizePhone(client.mobile) : '';
      if (normalized === clientPhone || normalized === clientMobile) {
        return client.name;
      }
    }

    // If no match found, return null (will display the number)
    return null;
  };

  // Fetch WhatsApp templates on component mount
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const templates = await fetchWhatsAppTemplates();
        setWhatsAppTemplates(templates);
        console.log(`✅ Loaded ${templates.length} WhatsApp templates for interactions tab:`, templates.map(t => ({ id: t.id, name: t.title || t.name360, language: t.language })));
        
        // Process templates in place instead of re-fetching
        // This will be handled by the useEffect below
      } catch (error) {
        console.error('Error fetching WhatsApp templates:', error);
        setWhatsAppTemplates([]);
      }
    };
    
    loadTemplates();
  }, []);

  // Removed fetchInteractionsRef - calling fetchInteractions directly now

  // Reprocess interactions when templates become available
  // Update interactions in place instead of re-fetching to avoid performance issues
  useEffect(() => {
    if (whatsAppTemplates.length > 0 && interactions.length > 0) {
      // Check if any WhatsApp interactions need template processing
      const whatsappInteractions = interactions.filter((i: any) => i.kind === 'whatsapp' && i.direction === 'out');
      const needsProcessing = whatsappInteractions.some((interaction: any) => 
        interaction.content?.includes('[Template:') || 
        interaction.content?.includes('Template:') || 
        interaction.content?.includes('TEMPLATE_MARKER:')
      );
      
      if (needsProcessing) {
        console.log('🔄 Templates are available, updating WhatsApp interactions in place to apply template content...');
        
        // Update interactions in place
        const updatedInteractions = interactions.map((interaction: any) => {
          if (interaction.kind === 'whatsapp' && interaction.direction === 'out') {
            const templateId = interaction.template_id;
            let updatedContent = interaction.content;
            
            // Try to match by template_id first
            if (templateId) {
              const templateIdNum = Number(templateId);
              const template = whatsAppTemplates.find(t => Number(t.id) === templateIdNum);
              if (template && template.content) {
                if (template.params === '0') {
                  updatedContent = template.content;
                } else if (template.params === '1') {
                  const paramMatch = interaction.content?.match(/\[Template:.*?\]\s*(.+)/);
                  if (paramMatch && paramMatch[1].trim()) {
                    updatedContent = paramMatch[1].trim();
                  } else {
                    updatedContent = template.content;
                  }
                }
              }
            }
            
            // Fallback to name matching
            if (updatedContent === interaction.content) {
              const templateMatch = interaction.content?.match(/\[Template:\s*([^\]]+)\]/) || 
                                    interaction.content?.match(/Template:\s*(.+)/) ||
                                    interaction.content?.match(/TEMPLATE_MARKER:(.+)/);
              
              if (templateMatch) {
                const templateTitle = templateMatch[1].trim().replace(/\]$/, '');
                const template = whatsAppTemplates.find(t => 
                  t.title.toLowerCase() === templateTitle.toLowerCase() ||
                  (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
                );
                if (template && template.content) {
                  if (template.params === '0') {
                    updatedContent = template.content;
                  } else if (template.params === '1') {
                    const paramMatch = interaction.content?.match(/\[Template:.*?\]\s*(.+)/);
                    if (paramMatch && paramMatch[1].trim()) {
                      updatedContent = paramMatch[1].trim();
                    } else {
                      updatedContent = template.content;
                    }
                  }
                }
              }
            }
            
            if (updatedContent !== interaction.content) {
              return { ...interaction, content: updatedContent };
            }
          }
          return interaction;
        });
        
        // Only update if we actually changed something
        const hasChanges = updatedInteractions.some((updated: any, idx: number) => 
          updated.content !== interactions[idx]?.content
        );
        
        if (hasChanges) {
          setInteractions(updatedInteractions);
        }
      }
    }
  }, [whatsAppTemplates.length]); // Only depend on templates length, not interactions to avoid loops


  const hydrateEmailBodies = useCallback(async (messages: { id: string; subject: string; bodyPreview?: string; body_html?: string | null; body_preview?: string | null }[]) => {
    if (!messages || messages.length === 0) return;
    if (!userId) return;

    const requiresHydration = messages.filter(message => {
      // Skip "offer_" prefixed message IDs (optimistic price offer inserts - body already stored)
      if (message.id && message.id.startsWith('offer_')) {
        return false;
      }
      
      // Skip optimistic IDs (temporary IDs that don't exist in the backend)
      if (message.id && message.id.startsWith('optimistic_')) {
        console.log(`📧 Skipping optimistic email ID: ${message.id}`);
        return false;
      }
      
      // ALWAYS hydrate if body_html is missing or empty (this is the main issue)
      const hasBodyHtml = message.body_html && message.body_html.trim() !== '';
      if (!hasBodyHtml) {
        console.log(`📧 Email ${message.id} missing body_html, will hydrate`);
        return true;
      }
      
      // Also check if body_preview/bodyPreview seems truncated (even if body_html exists, it might be incomplete)
      const preview = (message.bodyPreview || message.body_preview || '').trim();
      if (!preview) return true;
      
      // Remove HTML tags and normalize whitespace to check actual content length
      const normalisedPreview = preview
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Hydrate if:
      // 1. Preview is very short (< 100 chars suggests truncation - increased threshold)
      // 2. Preview equals the subject (likely truncated)
      // 3. Preview ends with "..." or similar truncation indicators
      const isTruncated = normalisedPreview.length < 100 || 
                          normalisedPreview === message.subject ||
                          normalisedPreview.endsWith('...') ||
                          normalisedPreview.endsWith('…');
      
      if (isTruncated) {
        console.log(`📧 Email ${message.id} seems truncated, will hydrate`);
      }
      
      return isTruncated;
    });

    if (requiresHydration.length === 0) return;

    try {
      const updates: Record<string, { html: string; preview: string }> = {};

      await Promise.all(
        requiresHydration.map(async message => {
          if (!message.id) return;
          try {
            const rawContent = await fetchEmailBodyFromBackend(userId, message.id);
            if (!rawContent || typeof rawContent !== 'string') return;

            // Use formatEmailHtmlForDisplay to preserve line breaks and apply RTL
            const formattedHtml = formatEmailHtmlForDisplay(rawContent);
            const cleanedHtml = sanitizeEmailHtml(formattedHtml);
            const previewHtml =
              cleanedHtml && cleanedHtml.trim()
                ? cleanedHtml
                : sanitizeEmailHtml(convertBodyToHtml(rawContent));

            updates[message.id] = {
              html: cleanedHtml,
              preview: previewHtml,
            };

            // Skip database update for "offer_" emails (they're already stored correctly)
            // Also skip if we don't have permission (403 errors) - the backend will handle updates
            if (!message.id.startsWith('offer_')) {
              try {
                await supabase
                  .from('emails')
                  .update({ 
                    body_html: rawContent, 
                    body_preview: rawContent 
                  })
                  .eq('message_id', message.id);
              } catch (dbErr: any) {
                // Silently fail - backend will handle updates, and we don't want to spam errors
                if (dbErr?.code !== 'PGRST116') { // PGRST116 is "no rows updated", which is fine
                  console.warn('Could not update email body in database (backend will handle it):', dbErr);
                }
              }
            }
          } catch (err) {
            // Only log if it's not a network/CORS error (those are expected if backend is down)
            if (err instanceof TypeError && err.message.includes('fetch')) {
              // Network error - backend might be down, skip logging to avoid spam
            } else {
              console.error('Unexpected error hydrating email body', err);
            }
          }
        })
      );

      if (Object.keys(updates).length > 0) {
        setEmails(prev =>
          prev.map(email => {
            const update = updates[email.id];
            if (!update) return email;
            return {
              ...email,
              body_html: update.html, // Update body_html with full content
              bodyPreview: update.preview, // Keep bodyPreview for backward compatibility
              body_preview: update.preview, // Also update body_preview
            };
          })
        );
        
        // Also update selectedEmailForView if it's one of the hydrated emails
        setSelectedEmailForView((prev: any) => {
          if (!prev) return prev;
          const update = updates[prev.id];
          if (!update) return prev;
          return {
            ...prev,
            body_html: update.html, // Update body_html with full content
            bodyPreview: update.preview, // Keep bodyPreview for backward compatibility
            body_preview: update.preview, // Also update body_preview
          };
        });
      }
    } catch (error) {
      console.error('Failed to hydrate email bodies from backend', error);
    }
  }, [userId]);

  const fetchEmailsForModal = useCallback(async () => {
    if (!client.id) return;
    
    setEmailsLoading(true);
    try {
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const legacyId = isLegacyLead ? parseInt(client.id.replace('legacy_', '')) : null;

      // Collect all email addresses for this client (including contacts)
      // This ensures emails are shown in all leads where any of these email addresses match
      const clientEmails = collectClientEmails(client);
      // Also add emails from contacts if available
      const allEmails = [...clientEmails];
      if (leadContacts && leadContacts.length > 0) {
        leadContacts.forEach((contact) => {
          if (contact.email) {
            const normalized = normalizeEmailForFilter(contact.email);
            if (normalized && !allEmails.includes(normalized)) {
              allEmails.push(normalized);
            }
          }
        });
      }
      
      // Build query that matches by lead ID OR email addresses
      // This ensures emails are shown in all leads where the email address matches
      const emailFilters = buildEmailFilterClauses({
        clientId: !isLegacyLead ? String(client.id) : null,
        legacyId: isLegacyLead ? legacyId : null,
        emails: allEmails,
      });

      let emailQuery = supabase
        .from('emails')
        .select(
          'id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, attachments, contact_id'
        )
        .order('sent_at', { ascending: true });

      if (emailFilters.length > 0) {
        emailQuery = emailQuery.or(emailFilters.join(','));
      } else if (isLegacyLead && legacyId !== null) {
        emailQuery = emailQuery.eq('legacy_id', legacyId);
      } else {
        emailQuery = emailQuery.eq('client_id', client.id);
      }
      
      // Note: We'll filter by contact client-side to handle both contact_id and email matching
      // This ensures we catch emails that might not have contact_id set yet
      
      const { data: emailData, error: emailError } = await emailQuery;
      
      if (emailError) {
        console.error('❌ Error fetching emails for InteractionsTab:', emailError);
      } else {
        let clientEmails = emailData || [];
        console.log(`📧 InteractionsTab fetched ${clientEmails.length} emails for client ${client.id}`);
        
        // Strict client-side filtering if contact is selected
        if (selectedContactForEmail?.contact.id) {
          const contactId = Number(selectedContactForEmail.contact.id);
          const contactEmail = selectedContactForEmail.contact.email?.toLowerCase().trim();
          
          console.log(`🔍 Filtering emails for contact ID: ${contactId}, email: ${contactEmail}`);
          
          clientEmails = clientEmails.filter((e: any) => {
            // STRICT RULE: If email has contact_id, it MUST match exactly (no fallback to email matching)
            if (e.contact_id !== null && e.contact_id !== undefined) {
              const emailContactId = Number(e.contact_id);
              return emailContactId === contactId;
            }
            
            // Only if email has NO contact_id, then match by email address
            // This is a fallback for old emails that don't have contact_id set yet
            if (contactEmail) {
              const senderEmail = e.sender_email?.toLowerCase().trim();
              const recipientList = e.recipient_list?.toLowerCase() || '';
              
              // Split recipient_list by comma/semicolon and check for exact match
              const recipients = recipientList.split(/[,;]/).map((r: string) => r.trim());
              const matchesEmail = senderEmail === contactEmail || recipients.includes(contactEmail);
              
              if (matchesEmail) {
                console.log(`✅ Including email ${e.id} by email match: ${contactEmail}`);
              }
              return matchesEmail;
            }
            
            // No contact email to match, exclude this email
            console.log(`❌ Excluding email ${e.id}: no contact email to match`);
            return false;
          });
          
          console.log(`📧 After strict filtering by contact, ${clientEmails.length} emails remain`);
        }
        
        // Build employee email-to-name mapping once for all emails
        const employeeEmailMap = await buildEmployeeEmailToNameMap();
        
        // Deduplicate emails by message_id before formatting
        const uniqueEmailsMap = new Map<string, any>();
        clientEmails.forEach((e: any) => {
          const messageId = e.message_id;
          if (messageId) {
            // If we already have this message_id, skip it to avoid duplicates
            if (!uniqueEmailsMap.has(messageId)) {
              uniqueEmailsMap.set(messageId, e);
            }
          }
        });
        const uniqueClientEmails = Array.from(uniqueEmailsMap.values());
        
        // Format emails for modal display - preserve Outlook HTML structure
        const formattedEmailsForModal = uniqueClientEmails.map((e: any) => {
          const rawHtml = typeof e.body_html === 'string' ? e.body_html : null;
          const rawPreview = typeof e.body_preview === 'string' ? e.body_preview : null;
          
          // Use formatEmailHtmlForDisplay to preserve line breaks and apply RTL
          let cleanedHtml = null;
          if (rawHtml) {
            cleanedHtml = formatEmailHtmlForDisplay(rawHtml);
          }
          
          let cleanedPreview = null;
          if (rawPreview) {
            cleanedPreview = formatEmailHtmlForDisplay(rawPreview);
          } else if (cleanedHtml) {
            cleanedPreview = cleanedHtml;
          }
          
          const fallbackText = cleanedPreview || cleanedHtml || e.subject || '';
          
          // Sanitize but preserve Outlook's direction and style attributes
          // Note: formatEmailHtmlForDisplay already handles line breaks and RTL, so we just sanitize
          const sanitizedHtml = cleanedHtml ? sanitizeEmailHtml(cleanedHtml) : null;
          const sanitizedPreview = cleanedPreview
            ? sanitizeEmailHtml(cleanedPreview)
            : sanitizedHtml ?? (fallbackText ? sanitizeEmailHtml(convertBodyToHtml(fallbackText)) : null);
          
          // Determine if email is from team/user based on sender email domain
          // Emails from @lawoffice.org.il are ALWAYS team/user, never client
          const senderEmail = e.sender_email || '';
          const isFromOffice = isOfficeEmail(senderEmail);
          
          // Override direction field: if sender is from office domain, it's always outgoing (team/user)
          let correctedDirection = e.direction;
          if (isFromOffice) {
            correctedDirection = 'outgoing';
          }
          
          // Get sender display name - use employee display_name for office emails
          let senderDisplayName = null;
          if (isFromOffice) {
            // For team/user emails: use employee display_name from cache if available
            senderDisplayName = employeeEmailMap.get(senderEmail.toLowerCase()) || e.sender_name || null;
          }
          
          // Prefer body_html over body_preview for better formatting (body_html has <br> tags)
          // Store both so we can use body_html when available
          const finalBody = sanitizedHtml || sanitizedPreview || '';
          
          return {
            id: e.message_id,
            subject: e.subject,
            from: senderEmail,
            to: e.recipient_list,
            date: e.sent_at,
            body_html: sanitizedHtml || null, // Store body_html separately
            bodyPreview: finalBody, // Keep for backward compatibility
            body_preview: sanitizedPreview || null, // Also store body_preview
            direction: correctedDirection,
            attachments: e.attachments,
            contact_id: e.contact_id,
            sender_display_name: senderDisplayName,
          };
        });
        
        // Additional deduplication by message_id after formatting (double-check)
        const finalUniqueEmails = formattedEmailsForModal.reduce((acc: any[], email: any) => {
          if (email.id && !acc.some(e => e.id === email.id)) {
            acc.push(email);
          }
          return acc;
        }, []);
        
        setEmails(finalUniqueEmails);
        
        // Check which emails need hydration (missing body_html)
        const emailsNeedingHydration = finalUniqueEmails.filter((e: any) => 
          !e.body_html || e.body_html.trim() === ''
        );
        
        // Auto-select first email if none is selected
        if (finalUniqueEmails.length > 0 && !selectedEmailForView) {
          const firstEmail = finalUniqueEmails[0];
          setSelectedEmailForView(firstEmail);
          // If first email needs hydration, prioritize it
          if (emailsNeedingHydration.some((e: any) => e.id === firstEmail.id)) {
            hydrateEmailBodies([firstEmail]);
          }
        } else if (activeEmailId) {
          // If we have an activeEmailId from clicking, find and select that email
          const emailToSelect = finalUniqueEmails.find((e: any) => e.id === activeEmailId);
          if (emailToSelect) {
            setSelectedEmailForView(emailToSelect);
            // If this email needs hydration, prioritize it
            if (emailsNeedingHydration.some((e: any) => e.id === emailToSelect.id)) {
              hydrateEmailBodies([emailToSelect]);
            }
            setActiveEmailId(null); // Clear after selecting
          }
        }
        
        // Hydrate ALL emails that are missing body_html (batch process in background)
        if (emailsNeedingHydration.length > 0) {
          console.log(`📧 Hydrating ${emailsNeedingHydration.length} emails missing body_html`);
          // Hydrate in batches to avoid overwhelming the backend
          const batchSize = 5;
          for (let i = 0; i < emailsNeedingHydration.length; i += batchSize) {
            const batch = emailsNeedingHydration.slice(i, i + batchSize);
            setTimeout(() => hydrateEmailBodies(batch), i * 500); // Stagger requests
          }
        }
      }
    } catch (error) {
      console.error('❌ Error in fetchEmailsForModal:', error);
      setEmails([]);
    } finally {
      setEmailsLoading(false);
    }
  }, [client, leadContacts, selectedContactForEmail, hydrateEmailBodies]); // Include leadContacts to match emails by contact email addresses

  const runMailboxSync = useCallback(async () => {
    if (!userId) {
      toast.error('Sign in to sync emails.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Connect your mailbox to sync emails.');
      return;
    }

    setEmailsLoading(true);

    try {
      await triggerMailboxSync(userId);
      await refreshMailboxStatus();
      if (onClientUpdate) {
        await onClientUpdate();
      }
      await fetchEmailsForModal();
    } catch (e) {
      console.error('Mailbox sync failed:', e);
      const message = e instanceof Error ? e.message : 'Failed to sync new emails from server.';
      toast.error(message);
    } finally {
      setEmailsLoading(false);
    }
  }, [userId, mailboxStatus.connected, onClientUpdate, fetchEmailsForModal, refreshMailboxStatus]);

  const syncOnComposeRef = useRef(false);
  useEffect(() => {
    if (showCompose) {
      if (!syncOnComposeRef.current) {
        syncOnComposeRef.current = true;
        runMailboxSync();
      }
    } else {
      syncOnComposeRef.current = false;
    }
  }, [showCompose, runMailboxSync]);

  // Effect to run the slow sync only once when the component mounts
  // DISABLED: Graph sync is too slow and blocks UI loading
  // Run Graph sync only on explicit user action (like clicking refresh)
  useEffect(() => {
    // Skip automatic Graph sync for now - it's causing the 4-second delay
    // Users can manually sync emails if needed
    console.log('InteractionsTab mounted - skipping automatic mailbox sync for performance');
  }, [client.id]);

  // Handle AI suggestions for email compose
  const handleAISuggestions = async () => {
    if (!client || isLoadingAI) return;

    setIsLoadingAI(true);
    setShowAISuggestions(true);
    
    try {
      const requestType = composeBody.trim() ? 'improve' : 'suggest';
      
      // Get email conversation history from interactions
      const emailInteractions = interactions.filter(interaction => 
        interaction.kind === 'email' && interaction.content
      );
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-ai-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          currentMessage: composeBody.trim(),
          conversationHistory: emailInteractions.map(interaction => ({
            id: interaction.id,
            direction: interaction.direction === 'out' ? 'out' : 'in',
            message: interaction.content || '',
            sent_at: interaction.date + ' ' + interaction.time,
            sender_name: interaction.employee || 'Unknown'
          })),
          clientName: client.name,
          requestType
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        // Get the single suggestion and clean it
        const suggestion = result.suggestion.trim();
        setAiSuggestions([suggestion]);
      } else {
        if (result.code === 'OPENAI_QUOTA') {
          toast.error('AI quota exceeded. Please check plan/billing or try again later.');
          setAiSuggestions(['Sorry, AI is temporarily unavailable (quota exceeded).']);
          return;
        }
        throw new Error(result.error || 'Failed to get AI suggestions');
      }
    } catch (error) {
      console.error('Error getting AI suggestions:', error);
      toast.error('Failed to get AI suggestions. Please try again later.');
      setAiSuggestions(['Sorry, AI suggestions are not available right now.']);
    } finally {
      setIsLoadingAI(false);
    }
  };

  // Apply AI suggestion
  const applyAISuggestion = (suggestion: string) => {
    setComposeBody(suggestion);
    setShowAISuggestions(false);
    setAiSuggestions([]);
  };

  const handleSendEmail = async () => {
    if (!userId) {
      toast.error('Please sign in to send emails.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Connect your mailbox before sending emails.');
      return;
    }

    const finalToRecipients = [...composeToRecipients];
    const finalCcRecipients = [...composeCcRecipients];

    try {
      if (composeToInput.trim()) {
        pushComposeRecipient(finalToRecipients, composeToInput.trim());
      }
      if (composeCcInput.trim()) {
        pushComposeRecipient(finalCcRecipients, composeCcInput.trim());
      }
    } catch (error) {
      setComposeRecipientError((error as Error).message || 'Please enter a valid email address.');
      return;
    }

    if (composeToInput.trim()) {
      setComposeToRecipients(finalToRecipients);
      setComposeToInput('');
    }
    if (composeCcInput.trim()) {
      setComposeCcRecipients(finalCcRecipients);
      setComposeCcInput('');
    }

    if (finalToRecipients.length === 0) {
      const fallbackRecipients = normaliseAddressList(client.email);
      if (fallbackRecipients.length > 0) {
        finalToRecipients.push(...fallbackRecipients);
      }
    }

    if (finalToRecipients.length === 0) {
      setComposeRecipientError('Please add at least one recipient.');
      return;
    }

    setComposeRecipientError(null);
    setSending(true);

    try {
      const bodyHtml = convertBodyToHtml(composeBody);
      const emailContentWithSignature = await appendEmailSignature(bodyHtml);
      const subject = composeSubject && composeSubject.trim()
        ? composeSubject
        : `[${client.lead_number}] - ${client.name}`;
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const legacyId = isLegacyLead
        ? (() => {
            const numeric = parseInt(String(client.id).replace('legacy_', ''), 10);
            return Number.isNaN(numeric) ? null : numeric;
          })()
        : null;
      const senderName = currentUserFullName || userEmail || 'Your Team';

      // Find the contact_id from the selected contact or the first recipient
      let contactId: number | null = selectedContactId;
      if (!contactId && finalToRecipients.length > 0) {
        // Try to find contact by email
        const contactByEmail = leadContacts.find(c => c.email === finalToRecipients[0]);
        if (contactByEmail) {
          contactId = contactByEmail.id;
        }
      }

      const sendResult = await sendEmailViaBackend({
        userId,
        subject,
        bodyHtml: emailContentWithSignature,
        to: finalToRecipients,
        cc: finalCcRecipients,
        attachments: composeAttachments,
        context: {
          clientId: !isLegacyLead ? client.id : null,
          legacyLeadId: isLegacyLead ? legacyId : null,
          leadType: client.lead_type || (isLegacyLead ? 'legacy' : 'new'),
          leadNumber: client.lead_number || null,
          contactEmail: client.email || null,
          contactName: client.name || null,
          contactId: contactId || null,
          senderName,
          userInternalId: client.user_internal_id || undefined,
        },
      });

      const messageId = sendResult?.id || sendResult?.messageId || `temp_${Date.now()}`;
      const conversationId = sendResult?.conversationId || null;
      const sentAt = sendResult?.sentAt || new Date().toISOString();
      
      // Optimistic insert to emails table to ensure email appears immediately
      // The backend will also save it, but this ensures it shows up right away
      const emailRecord: any = {
        message_id: messageId,
        thread_id: conversationId,
        sender_name: senderName,
        sender_email: userEmail || null,
        recipient_list: finalToRecipients.join(', ') + (finalCcRecipients.length > 0 ? `, ${finalCcRecipients.join(', ')}` : ''),
        subject,
        body_html: emailContentWithSignature,
        body_preview: emailContentWithSignature.substring(0, 500), // First 500 chars as preview
        sent_at: sentAt,
        direction: 'outgoing',
        attachments: composeAttachments.length > 0 ? composeAttachments.map(att => ({
          name: att.name,
          contentType: att.contentType || 'application/octet-stream',
        })) : null,
      };
      
      // Set either client_id OR legacy_id, not both
      if (isLegacyLead) {
        emailRecord.legacy_id = legacyId;
        emailRecord.client_id = null;
      } else {
        emailRecord.client_id = client.id;
        emailRecord.legacy_id = null;
      }
      
      // Add contact_id if available
      if (contactId) {
        emailRecord.contact_id = contactId;
      }
      
      try {
        await supabase.from('emails').upsert([emailRecord], { onConflict: 'message_id' });
      } catch (dbError) {
        console.warn('Optimistic email insert failed (backend will save it):', dbError);
        // Don't throw - backend will save it
      }
      
      toast.success('Email sent!');
      
      // Remove optimistic emails (those with temp_ IDs) before fetching fresh emails
      setEmails((prev) => {
        return prev.filter((email: any) => {
          const msgId = email.id;
          return !(typeof msgId === 'string' && msgId.startsWith('temp_'));
        });
      });
      
      await fetchInteractions({ bypassCache: true });
      await fetchEmailsForModal();

      if (onClientUpdate) {
        await onClientUpdate();
      }

      setComposeBody('');
      setComposeAttachments([]);
      setShowComposeLinkForm(false);
      setComposeLinkLabel('');
      setComposeLinkUrl('');
      setShowCompose(false);
    } catch (e) {
      console.error('Error in handleSendEmail:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to send email.');
    } finally {
      setSending(false);
    }
  };

  const handleDownloadAttachment = async (messageId: string, attachment: Attachment) => {
    if (downloadingAttachments[attachment.id]) return;
    if (!userId) {
      toast.error('Please sign in to download attachments.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Connect your mailbox to download attachments.');
      return;
    }

    setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: true }));
    toast.loading(`Downloading ${attachment.name}...`, { id: attachment.id });

    try {
      const { blob, fileName } = await downloadAttachmentFromBackend(userId, messageId, attachment.id);
      const downloadName = fileName || attachment.name || 'attachment';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      toast.success(`${downloadName} downloaded.`, { id: attachment.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed.', { id: attachment.id });
    } finally {
      setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: false }));
    }
  };

  const handleAttachmentUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;
    
    for (const file of Array.from(files)) {
      if (file.size > 4 * 1024 * 1024) { // 4MB limit
        toast.error(`${file.name} is too large. Please choose files under 4MB.`);
        continue;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const base64Content = content.split(',')[1];
          if (!base64Content) throw new Error('Could not read file content.');

          setComposeAttachments(prev => [...prev, {
            name: file.name,
            contentType: file.type,
            contentBytes: base64Content
          }]);
          toast.success(`${file.name} attached.`);
        } catch (err) {
          toast.error(`Error processing ${file.name}.`);
        }
      };
      reader.onerror = () => {
        toast.error(`Failed to read ${file.name}.`);
      };
      reader.readAsDataURL(file);
    }
  };

  // Set the subject when the email modal opens (if not already set by user)
  useEffect(() => {
    if (isEmailModalOpen) {
      // Use selected contact's name if available, otherwise use client name
      const nameToUse = selectedContactForEmail?.contact.name || client.name;
      const defaultSubject = `[${client.lead_number}] - ${nameToUse} - ${client.topic || ''}`;
      setComposeSubject(prev => prev && prev.trim() ? prev : defaultSubject);
      
      // Fetch emails when modal opens - add delay to ensure contact is set if it was just set
      const fetchDelay = selectedContactForEmail ? 200 : 0;
      setTimeout(() => {
        fetchEmailsForModal();
      }, fetchDelay);
      
      if (!mailboxStatusRequestedRef.current) {
        mailboxStatusRequestedRef.current = true;
        refreshMailboxStatus();
      }
    }
  }, [isEmailModalOpen, client, fetchEmailsForModal, selectedContactForEmail]);

  // Separate effect to re-fetch emails when selected contact changes (while modal is open)
  useEffect(() => {
    if (isEmailModalOpen && selectedContactForEmail) {
      fetchEmailsForModal();
    }
  }, [selectedContactForEmail?.contact.id, isEmailModalOpen, fetchEmailsForModal]);

  // Clear selected contact when email modal closes
  useEffect(() => {
    if (!isEmailModalOpen) {
      setSelectedContactForEmail(null);
    }
  }, [isEmailModalOpen]);

  // Auto-scroll to bottom when new emails arrive
  useEffect(() => {
    if (isEmailModalOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [emails, isEmailModalOpen]);

  // Handle image loading errors in email content (CORS-blocked images from external domains)
  useEffect(() => {
    if (!isEmailModalOpen || emails.length === 0) return;

    // Small delay to ensure DOM is updated after emails changes
    const timeoutId = setTimeout(() => {
      const emailContentDivs = document.querySelectorAll('.email-content');
      emailContentDivs.forEach(div => {
        const images = div.querySelectorAll('img');
        images.forEach(img => {
          // Remove existing error handlers to avoid duplicates
          const existingHandler = (img as any).__errorHandler;
          if (existingHandler) {
            img.removeEventListener('error', existingHandler);
          }

          // Add error handler to hide images that fail to load (CORS issues)
          const errorHandler = () => {
            // Hide the image instead of showing broken image icon
            img.style.display = 'none';
            // Optionally add a data attribute for debugging
            img.setAttribute('data-load-error', 'true');
          };

          img.addEventListener('error', errorHandler);
          // Store reference to handler for cleanup
          (img as any).__errorHandler = errorHandler;
        });
      });
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      // Cleanup: remove error handlers
      const emailContentDivs = document.querySelectorAll('.email-content');
      emailContentDivs.forEach(div => {
        const images = div.querySelectorAll('img');
        images.forEach(img => {
          const handler = (img as any).__errorHandler;
          if (handler) {
            img.removeEventListener('error', handler);
            delete (img as any).__errorHandler;
          }
        });
      });
    };
  }, [isEmailModalOpen, emails]);

  // Helper function to convert HTML content to plain text for editing (converts <br> to newlines, strips other HTML)
  const htmlToPlainText = (html: string): string => {
    if (!html) return '';
    
    // Create a temporary div to parse HTML
    const tmp = document.createElement('div');
    
    // Convert <br> tags to newlines before parsing
    let processedHtml = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<\/div>/gi, '\n')
      .replace(/<div[^>]*>/gi, '');
    
    tmp.innerHTML = processedHtml;
    
    // Get text content (this strips all HTML tags)
    let text = tmp.textContent || tmp.innerText || '';
    
    // Clean up excessive whitespace but preserve line breaks
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ') // Replace multiple spaces/tabs with single space
      .replace(/\n\s+\n/g, '\n\n') // Clean up lines with only whitespace
      .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
      .trim();
    
    return text;
  };
  
  // Update openEditDrawer to return a Promise and always fetch latest data for manual interactions
  const openEditDrawer = async (idx: number) => {
    const row = interactions[idx];
    let latestRow = row;
    if (row.id && row.id.toString().startsWith('manual_')) {
      const { data, error } = await supabase
        .from('leads')
        .select('manual_interactions')
        .eq('id', client.id)
        .single();
      if (!error && data?.manual_interactions) {
        const found = data.manual_interactions.find((i: any) => i.id === row.id || i.id === Number(row.id));
        if (found) {
          latestRow = { ...row, ...found };
        }
      }
    }
    setActiveInteraction(latestRow);
    
    // Convert HTML content to plain text for email_manual and whatsapp_manual interactions
    let contentForEdit = latestRow.content || '';
    if ((latestRow.kind === 'email_manual' || latestRow.kind === 'whatsapp_manual') && contentForEdit) {
      contentForEdit = htmlToPlainText(contentForEdit);
    }
    
    setEditData({
      date: latestRow.date || '',
      time: latestRow.time || '',
      content: contentForEdit,
      observation: latestRow.observation || '',
      length: latestRow.length ? String(latestRow.length).replace(/m$/, '') : '',
      direction: latestRow.direction || 'out',
    });
    setDetailsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDetailsDrawerOpen(false);
    setActiveInteraction(null);
  };

  const handleEditChange = (field: string, value: string) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  };

  // Helper function to convert plain text to HTML format (converts newlines to <br> tags)
  const plainTextToHtml = (text: string): string => {
    if (!text) return '';
    
    // Normalize line endings
    let html = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    
    // Collapse excessive consecutive line breaks (3+ to 2 for paragraph spacing)
    html = html.replace(/\n{3,}/g, '\n\n');
    
    // Convert to HTML: single newline becomes <br>, double newline becomes <br><br>
    html = html.replace(/\n\n/g, '__PARA_BREAK__');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/__PARA_BREAK__/g, '<br><br>');
    
    // Wrap in div with proper styling
    if (!html.includes('<div')) {
      html = `<div dir="auto" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif; white-space: normal; line-height: 1.6;">${html}</div>`;
    }
    
    return html;
  };
  
  const handleSave = async () => {
    if (!activeInteraction) return;
    
    const isManual = activeInteraction.id.toString().startsWith('manual_');
    
    // Convert plain text content back to HTML format for email_manual and whatsapp_manual interactions
    let contentToSave = editData.content;
    if ((activeInteraction.kind === 'email_manual' || activeInteraction.kind === 'whatsapp_manual') && contentToSave) {
      contentToSave = plainTextToHtml(contentToSave);
    }

    // --- Optimistic Update ---
    const previousInteractions = [...interactions];
    const updatedInteractions = interactions.map((interaction) => {
      if (interaction.id === activeInteraction.id) {
        return {
          ...interaction,
          date: editData.date,
          time: editData.time,
          content: contentToSave,
          observation: editData.observation,
          length: editData.length ? `${editData.length}m` : '',
          direction: editData.direction,
        };
      }
      return interaction;
    });
    setInteractions(updatedInteractions);
    closeDrawer();
    // --- End Optimistic Update ---

    try {
      if (isManual) {
        const updatedManualInteraction = updatedInteractions.find(i => i.id === activeInteraction.id);
        if (updatedManualInteraction) {
          const allManualInteractions = updatedInteractions.filter(i => i.id.toString().startsWith('manual_'));
          
          // Update manual_interactions and latest_interaction timestamp for new leads
          if (!isLegacyLead) {
            const { error } = await supabase
              .from('leads')
              .update({ 
                manual_interactions: allManualInteractions,
                latest_interaction: new Date().toISOString()
              })
              .eq('id', client.id);
            if (error) throw error;
          } else {
            // For legacy leads, manual interactions are stored in leads_leadinteractions
            // We need to find the interaction ID and update it
            // Since we're editing an existing interaction, we need to find its database ID
            // For now, we'll update the local state and let the refresh handle the database sync
            // Note: Editing legacy interactions in leads_leadinteractions requires the database ID
            // which we don't have in the Interaction interface. This is a limitation.
            // The interaction will be updated on the next fetch, but we should ideally store the DB ID.
            console.warn('Editing legacy manual interactions requires database ID. Changes may not persist until refresh.');
            // For legacy leads, we can't easily update individual interactions without the DB ID
            // The optimistic update will show the change, but it may revert on refresh
          }
        }
      } else {
        const { error } = await supabase
          .from('emails')
          .update({ observation: editData.observation })
          .eq('message_id', activeInteraction.id);
        if (error) throw error;
      }
      
      toast.success('Interaction updated!');
      if (onClientUpdate) await onClientUpdate(); // Silently refresh data
    } catch (error) {
      toast.error('Update failed. Reverting changes.');
      setInteractions(previousInteractions); // Revert on failure
      console.error(error);
    }
  };

  const openContactDrawer = async () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear().toString().slice(-2)}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setNewContact({
      method: 'email',
      date,
      time,
      length: '',
      content: '',
      observation: '',
      direction: 'out',
      contact_id: null,
      contact_name: '',
    });
    
    // Fetch lead contacts using the helper function
    if (client) {
      try {
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const leadId = isLegacyLead ? client.id.replace('legacy_', '') : client.id;
        
        console.log('🔍 Fetching contacts for manual interaction:', { 
          isLegacyLead, 
          leadId, 
          clientId: client.id,
          leadType: client.lead_type 
        });
        
        // Use the existing helper function to fetch contacts
        const contacts = await fetchLeadContacts(leadId, isLegacyLead);
        
        console.log('📋 Contacts fetched:', { contacts, count: contacts?.length });
        
        // Helper to normalize phone numbers for deduplication
        const normalizePhone = (phone: string | null | undefined): string => {
          if (!phone) return '';
          return phone.replace(/[\s\-\(\)\+]/g, '').trim();
        };
        
        // Convert ContactInfo to our simpler format
        const simplifiedContacts = contacts.map(c => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          mobile: c.mobile,
        }));
        
        // Add the lead/client itself as the first option
        const allContactsWithLead = [
          {
            id: -1, // Special ID for the lead itself
            name: client.name,
            email: client.email,
            phone: client.phone,
            mobile: client.mobile,
          },
          ...simplifiedContacts
        ];
        
        // Deduplicate by phone number - keep first occurrence
        const seenPhones = new Set<string>();
        const deduplicatedContacts = allContactsWithLead.filter(contact => {
          const phone = normalizePhone(contact.phone || contact.mobile);
          if (!phone) {
            // Keep contacts without phone numbers
            return true;
          }
          if (seenPhones.has(phone)) {
            // Skip duplicate phone number
            return false;
          }
          seenPhones.add(phone);
          return true;
        });
        
        console.log('📋 Deduplicated contacts:', { 
          original: allContactsWithLead.length, 
          deduplicated: deduplicatedContacts.length 
        });
        
        setManualInteractionContacts(deduplicatedContacts);
      } catch (error) {
        console.error('❌ Error fetching contacts:', error);
        setManualInteractionContacts([]);
      }
    }
    
    setContactDrawerOpen(true);
  };

  const closeContactDrawer = () => {
    setContactDrawerOpen(false);
  };

  const handleNewContactChange = (field: string, value: any) => {
    setNewContact((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveContact = async () => {
    if (!client) return;

    // Ensure we have the current user's full name and employee_id
    let userFullName = currentUserFullName;
    let employeeId: number | null = null;
    if (!userFullName || !employeeId) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          const { data: userData } = await supabase
            .from('users')
            .select(`
              full_name,
              employee_id,
              tenants_employee!employee_id(
                display_name
              )
            `)
            .eq('auth_id', user.id)
            .single();
          if (userData) {
            // Use display_name from tenants_employee if available, otherwise full_name
            const employee = Array.isArray(userData.tenants_employee) ? userData.tenants_employee[0] : userData.tenants_employee;
            userFullName = employee?.display_name || userData.full_name;
            employeeId = userData.employee_id;
          }
        }
      } catch (error) {
        console.error('Error fetching user info:', error);
      }
    }

    const now = new Date();
    
    // Determine recipient name based on direction (same logic as in fetchInteractions)
    let employeeDisplay = '';
    let recipientName = '';
    
    if (newContact.direction === 'out') {
      // We contacted client - employee is sender
      employeeDisplay = userFullName || 'You';
      recipientName = newContact.contact_name || client.name;
    } else {
      // Client contacted us - client/contact is sender
      employeeDisplay = newContact.contact_name || client.name;
      recipientName = userFullName || 'You';
    }
    
    // Normalize method: convert 'call_log' to 'call' for consistency
    const normalizedMethod = newContact.method === 'call_log' ? 'call' : newContact.method;
    
    const newInteraction: Interaction = {
      id: `manual_${now.getTime()}`,
      date: newContact.date || now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      time: newContact.time || now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      raw_date: now.toISOString(),
      employee: employeeDisplay,
      direction: newContact.direction as 'in' | 'out',
      kind: normalizedMethod, // Use normalized method (call_log -> call)
      length: newContact.length ? `${newContact.length}m` : '',
      content: newContact.content,
      observation: newContact.observation,
      editable: true,
      contact_id: newContact.contact_id,
      contact_name: newContact.contact_name,
      recipient_name: recipientName, // Set recipient_name immediately for proper "From:" and "To:" display
    };

    // --- Optimistic Update ---
    const previousInteractions = [...interactions];
    const newInteractions = [newInteraction, ...interactions].sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());
    setInteractions(newInteractions);
    closeContactDrawer();
    // --- End Optimistic Update ---

    try {
      // Check if this is a legacy lead
      if (isLegacyLead) {
        // For legacy leads, save to leads_leadinteractions table
        const legacyId = client.id.toString().replace('legacy_', '');
        const numericLegacyId = parseInt(legacyId, 10);
        
        if (isNaN(numericLegacyId)) {
          throw new Error(`Invalid legacy lead ID: ${legacyId}`);
        }

        // Map interaction kind to database format (use normalizedMethod for consistency)
        const kindMap: Record<string, string> = {
          'email': 'e',
          'call': 'c',
          'call_log': 'c', // Backwards compatibility: map call_log to 'c' as well
          'whatsapp': 'w', // WhatsApp interactions use 'w' kind
          'sms': 'EMPTY', // SMS interactions use 'EMPTY' kind (same as notes)
          'office': 'EMPTY', // Office interactions use 'EMPTY' kind (same as notes)
          'note': 'EMPTY',
          'meeting': 'EMPTY',
        };
        const dbKind = kindMap[normalizedMethod] || 'EMPTY';

        // Map direction to database format
        const dbDirection = newContact.direction === 'out' ? 'o' : 'i';

        // Parse minutes from length string (e.g., "5m" -> 5)
        const minutes = newContact.length ? parseInt(newContact.length.replace(/[^0-9]/g, ''), 10) || null : null;

        // Format date and time for database
        // Convert date from "DD.MM.YY" format to ISO format (YYYY-MM-DD)
        let interactionDate: string;
        if (newContact.date) {
          // Parse DD.MM.YY format
          const dateParts = newContact.date.split('.');
          if (dateParts.length === 3) {
            const day = dateParts[0].padStart(2, '0');
            const month = dateParts[1].padStart(2, '0');
            const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
            interactionDate = `${year}-${month}-${day}`;
          } else {
            // If parsing fails, use current date
            interactionDate = now.toISOString().split('T')[0];
          }
        } else {
          interactionDate = now.toISOString().split('T')[0];
        }
        
        // Format time (convert from HH:MM to HH:MM:SS format for database)
        let interactionTime: string;
        if (newContact.time) {
          // If time is in HH:MM format, append :00 for seconds
          if (newContact.time.match(/^\d{2}:\d{2}$/)) {
            interactionTime = `${newContact.time}:00`;
          } else if (newContact.time.match(/^\d{2}:\d{2}:\d{2}$/)) {
            // Already in HH:MM:SS format
            interactionTime = newContact.time;
          } else {
            // Invalid format, use current time
            interactionTime = now.toTimeString().split(' ')[0];
          }
        } else {
          interactionTime = now.toTimeString().split(' ')[0]; // HH:MM:SS format
        }

        // Get the next available ID for leads_leadinteractions
        const { data: maxIdData, error: maxIdError } = await supabase
          .from('leads_leadinteractions')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        if (maxIdError && maxIdError.code !== 'PGRST116') { // PGRST116 = no rows returned
          throw maxIdError;
        }

        const nextId = maxIdData?.id ? maxIdData.id + 1 : 1;

        // Prepare description - prefix with METHOD: to preserve the kind when fetching
        // Format: "METHOD:office|observation text" or "METHOD:sms|observation text"
        let descriptionValue = newContact.observation || null;
        if (normalizedMethod === 'sms') {
          descriptionValue = descriptionValue ? `METHOD:sms|${descriptionValue}` : 'METHOD:sms|';
        } else if (normalizedMethod === 'office') {
          descriptionValue = descriptionValue ? `METHOD:office|${descriptionValue}` : 'METHOD:office|';
        }
        
        // Insert into leads_leadinteractions table
        // Only include contact_id if a specific contact was selected (not the main lead with id -1)
        const insertPayload: any = {
          id: nextId,
          cdate: now.toISOString(),
          udate: now.toISOString(),
          kind: dbKind,
          date: interactionDate,
          time: interactionTime,
          minutes: minutes,
          content: newContact.content || '',
          creator_id: employeeId ? String(employeeId) : null,
          lead_id: numericLegacyId,
          direction: dbDirection,
          description: descriptionValue,
          employee_id: employeeId ? String(employeeId) : null,
        };
        
        // Add contact_id if a specific contact was selected (not -1 which represents the main lead)
        // Note: newContact.contact_id is leads_contact.id, but we need lead_leadcontact.id for the foreign key
        if (newContact.contact_id && newContact.contact_id !== -1) {
          // Look up the lead_leadcontact.id from leads_contact.id and lead_id
          const { data: leadContactData, error: leadContactError } = await supabase
            .from('lead_leadcontact')
            .select('id')
            .eq('lead_id', numericLegacyId)
            .eq('contact_id', newContact.contact_id)
            .single();
          
          if (!leadContactError && leadContactData?.id) {
            insertPayload.contact_id = leadContactData.id;
          } else {
            console.warn('⚠️ Could not find lead_leadcontact.id for contact_id:', newContact.contact_id, 'lead_id:', numericLegacyId);
          }
        }
        
        console.log('💾 Inserting legacy interaction:', {
          method: normalizedMethod,
          dbKind,
          payload: insertPayload,
        });

        const { error: insertError, data: insertData } = await supabase
          .from('leads_leadinteractions')
          .insert(insertPayload)
          .select();

        if (insertError) {
          console.error('❌ Error inserting legacy interaction:', {
            error: insertError,
            code: insertError.code,
            message: insertError.message,
            details: insertError.details,
            hint: insertError.hint,
            method: normalizedMethod,
            dbKind,
            payload: insertPayload,
          });
          throw insertError;
        }
        
        // Verify that the insert actually succeeded by checking insertData
        if (!insertData || insertData.length === 0) {
          console.error('❌ Insert returned no data - interaction may not have been saved:', {
            method: normalizedMethod,
            dbKind,
            payload: insertPayload,
          });
          throw new Error('Insert returned no data - interaction may not have been saved');
        }
        
        console.log('✅ Legacy interaction saved successfully:', { 
          id: nextId, 
          kind: dbKind, 
          lead_id: numericLegacyId,
          method: normalizedMethod,
          insertedData: insertData,
        });
        // Stage evaluation is handled automatically by database triggers
        // NOTE: Manual email interactions should NOT be saved to emails table - only to leads_leadinteractions
      } else {
        // For new leads, save to manual_interactions JSONB column
        const existingInteractions = client.manual_interactions || [];
        const updatedInteractions = [...existingInteractions, newInteraction];

        // Update manual_interactions and latest_interaction timestamp
        const { error: updateError } = await supabase
          .from('leads')
          .update({ 
            manual_interactions: updatedInteractions,
            latest_interaction: now.toISOString()
          })
          .eq('id', client.id);

        if (updateError) {
          console.error('Error updating new lead interaction:', updateError);
          throw updateError;
        }
        console.log('✅ New lead interaction saved successfully:', { 
          kind: normalizedMethod,
          client_id: client.id 
        });
        // Stage evaluation is handled automatically by database triggers
      }
      
      // Only show success toast if we actually saved
      // For legacy leads, insertData is verified above (throws if empty)
      // For new leads, updateError is checked and throws if failed
      // NOTE: Manual email interactions are saved to leads_leadinteractions (legacy) or manual_interactions (new)
      // They should NOT be saved to the emails table - only real synced emails from Outlook go there
      toast.success('Interaction saved!');
      
      // Force refresh of interactions to show the newly saved interaction
      if (onClientUpdate) {
        await onClientUpdate(); // Refresh client data
      }
      // Also trigger a direct fetch to ensure the interaction appears immediately
      await fetchInteractions({ bypassCache: true });

    } catch (error) {
      toast.error('Save failed. Reverting changes.');
      setInteractions(previousInteractions); // Revert on failure
      console.error('❌ Error saving interaction:', error);
    }
  };

  // Combine emails and WhatsApp messages for AI summary
  const aiSummaryMessages = [
    // Emails
    ...emails.map(email => ({
      type: 'email',
      direction: email.direction === 'outgoing' ? 'out' : 'in',
      from: email.from,
      to: email.to,
      date: email.date,
      content: email.bodyPreview,
      subject: email.subject,
    })),
    // WhatsApp messages
    ...whatsAppMessages.map(msg => ({
      type: 'whatsapp',
      direction: msg.direction === 'out' ? 'out' : 'in',
      from: msg.sender_name || 'You',
      to: client.name,
      date: msg.date,
      content: msg.content,
    })),
  ].sort((a, b) => {
    // Sort by date descending (emails have full date, WhatsApp only time)
    const aDate = new Date(a.date);
    const bDate = new Date(b.date);
    return bDate.getTime() - aDate.getTime();
  });

  useEffect(() => {
    // Set default font size and family for new content
    const quillEditor = document.querySelector('.ql-editor');
    if (quillEditor) {
      (quillEditor as HTMLElement).style.fontSize = '16px';
      (quillEditor as HTMLElement).style.fontFamily = 'system-ui, Arial, sans-serif';
      (quillEditor as HTMLElement).style.lineHeight = '1.7';
      (quillEditor as HTMLElement).style.padding = '18px 16px';
    }
  }, []);

  useEffect(() => {
    if (isWhatsAppOpen) {
      console.log('WhatsApp client.id:', client.id);
      console.log('WhatsApp messages:', whatsAppMessages);
    }
  }, [isWhatsAppOpen, client.id]); // Removed whatsAppMessages dependency

  // Effect: when WhatsApp modal opens and activeWhatsAppId is set, scroll to and highlight the message
  React.useEffect(() => {
    if (isWhatsAppOpen && activeWhatsAppId) {
      setTimeout(() => {
        const el = document.querySelector(`[data-whatsapp-id="${activeWhatsAppId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (el.firstChild as HTMLElement)?.classList?.add('ring-2', 'ring-primary');
          setTimeout(() => (el.firstChild as HTMLElement)?.classList?.remove('ring-2', 'ring-primary'), 1200);
        }
      }, 300);
    }
  }, [isWhatsAppOpen, activeWhatsAppId]);

  // Fetch employees for autocomplete when compose modal opens
  useEffect(() => {
    const fetchComposeEmployees = async () => {
      try {
        const [employeesResult, usersResult] = await Promise.all([
          supabase
            .from('tenants_employee')
            .select('id, display_name')
            .not('display_name', 'is', null),
          supabase
            .from('users')
            .select('employee_id, email')
            .not('email', 'is', null)
        ]);

        if (employeesResult.error || usersResult.error) {
          console.error('Error fetching employees:', employeesResult.error || usersResult.error);
          return;
        }

        // Create employee_id to email mapping
        const employeeIdToEmail = new Map<number, string>();
        usersResult.data?.forEach((user: any) => {
          if (user.employee_id && user.email) {
            employeeIdToEmail.set(user.employee_id, user.email.toLowerCase());
          }
        });

        // Build employee list with email and name
        const employeeList: Array<{ email: string; name: string }> = [];
        employeesResult.data?.forEach((emp: any) => {
          if (!emp.display_name) return;
          
          // Method 1: Use email from users table
          const emailFromUsers = employeeIdToEmail.get(emp.id);
          if (emailFromUsers) {
            employeeList.push({ email: emailFromUsers, name: emp.display_name });
          }
          
          // Method 2: Also add pattern email
          const patternEmail = `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
          // Only add if it's different from the actual email
          if (!emailFromUsers || emailFromUsers !== patternEmail) {
            employeeList.push({ email: patternEmail, name: emp.display_name });
          }
        });

        // Remove duplicates based on email
        const uniqueEmployees = Array.from(
          new Map(employeeList.map(emp => [emp.email, emp])).values()
        );
        
        setComposeEmployees(uniqueEmployees);
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };

    if (showCompose) {
      fetchComposeEmployees();
    }
  }, [showCompose]);

  useEffect(() => {
    if (!isEmailModalOpen) return;
    
    // Use selected contact's email if available, otherwise fall back to client email
    const emailToUse = selectedContactForEmail?.contact.email || client.email;
    const initialRecipients = normaliseAddressList(emailToUse);
    setComposeToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
    setComposeCcRecipients([]);
    setComposeToInput('');
    setComposeCcInput('');
    setComposeRecipientError(null);
    setShowComposeLinkForm(false);
    setComposeLinkLabel('');
    setComposeLinkUrl('');
    setSelectedComposeTemplateId(null);
    setComposeTemplateSearch('');
    setComposeTemplateLanguageFilter(null);
    setComposeTemplatePlacementFilter(null);
  }, [isEmailModalOpen, client.email, selectedContactForEmail]);

  useEffect(() => {
    if (!isEmailModalOpen) return;

    let isMounted = true;
    const loadTemplates = async () => {
      try {
        // First, fetch languages and placements to create lookup maps
        const [languagesResult, placementsResult, templatesResult] = await Promise.all([
          supabase
            .from('misc_language')
            .select('id, name')
            .order('name', { ascending: true }),
          supabase
            .from('email_templates_placement')
            .select('id, name')
            .order('name', { ascending: true }),
          supabase
            .from('misc_emailtemplate')
            .select(`
              *,
              email_templates_placement!placement_id (
                id,
                name
              )
            `)
            .eq('active', 't')
            .order('name', { ascending: true })
        ]);

        if (templatesResult.error) {
          console.error('Error fetching templates:', templatesResult.error);
          throw templatesResult.error;
        }
        if (!isMounted) return;

        // Create lookup maps for languages and placements
        const languageMap = new Map<string, string>();
        if (!languagesResult.error && languagesResult.data) {
          languagesResult.data.forEach((lang: any) => {
            languageMap.set(String(lang.id), lang.name || 'Unknown');
          });
          setAvailableLanguages(languagesResult.data.map((lang: any) => ({
            id: String(lang.id),
            name: lang.name || 'Unknown'
          })));
        }

        const placementMap = new Map<number, string>();
        if (!placementsResult.error && placementsResult.data) {
          placementsResult.data.forEach((placement: any) => {
            const placementId = typeof placement.id === 'number' ? placement.id : Number(placement.id);
            placementMap.set(placementId, placement.name || 'Unknown');
          });
          setAvailablePlacements(placementsResult.data.map((placement: any) => ({
            id: typeof placement.id === 'number' ? placement.id : Number(placement.id),
            name: placement.name || 'Unknown'
          })));
        }

        // Parse templates and match with language/placement names
        const parsed = (templatesResult.data || []).map((template: any) => {
          const placement = Array.isArray(template.email_templates_placement) 
            ? template.email_templates_placement[0] 
            : template.email_templates_placement;
          
          const languageId = template.language_id ? String(template.language_id) : null;
          const languageName = languageId ? languageMap.get(languageId) || null : null;
          
          return {
            id: typeof template.id === 'number' ? template.id : Number(template.id),
            name: template.name || `Template ${template.id}`,
            subject: typeof template.subject === 'string' ? template.subject : null,
            content: parseTemplateContent(template.content),
            rawContent: template.content || '',
            languageId: languageId,
            languageName: languageName,
            placementId: placement?.id ? (typeof placement.id === 'number' ? placement.id : Number(placement.id)) : null,
            placementName: placement?.name || null,
          };
        });

        setComposeTemplates(parsed);
      } catch (error) {
        console.error('Failed to load email templates:', error);
        if (isMounted) {
          setComposeTemplates([]);
        }
      }
    };

    loadTemplates();
    return () => {
      isMounted = false;
    };
  }, [isEmailModalOpen]);

  useEffect(() => {
    if (!composeTemplateDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (composeTemplateDropdownRef.current && !composeTemplateDropdownRef.current.contains(event.target as Node)) {
        setComposeTemplateDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [composeTemplateDropdownOpen]);

  return (
    <div className="p-4 md:p-6 lg:p-8 flex flex-col xl:flex-row gap-6 md:gap-8 lg:gap-12 items-start min-h-screen max-w-7xl mx-auto">
      <div className="relative w-full flex-1 min-w-0">
        {/* Loading indicator */}
        {interactionsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="loading loading-spinner loading-lg text-primary"></div>
            <span className="ml-3 text-lg">Loading interactions...</span>
          </div>
        ) : (
          <>
            {/* Header with Action Buttons */}
            <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-8 md:mb-12">
              {/* Mobile: Contact Client Dropdown */}
              <div className="dropdown lg:hidden">
                <label tabIndex={0} className="btn btn-outline btn-primary flex items-center gap-2 cursor-pointer w-full sm:w-auto justify-center">
                  <UserIcon className="w-5 h-5" /> Contact Client <ChevronDownIcon className="w-4 h-4 ml-1" />
                </label>
                <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 mt-2 z-[100]">
                  <li>
                    <button className="flex gap-2 items-center" onClick={() => {
                      setShowContactSelectorForEmail(true);
                    }}>
                      <EnvelopeIcon className="w-5 h-5" /> Email
                    </button>
                  </li>
                  <li>
                    <button className="flex gap-2 items-center" onClick={() => {
                      setShowContactSelector(true);
                    }}>
                      <FaWhatsapp className="w-5 h-5" /> WhatsApp
                    </button>
                  </li>
                  <li>
                    <button className="flex gap-2 items-center" onClick={openContactDrawer}>
                      <ChatBubbleLeftRightIcon className="w-5 h-5" /> Contact
                    </button>
                  </li>
                </ul>
              </div>
              
              {/* Desktop: Individual Buttons */}
              <div className="hidden lg:flex gap-4">
                <button 
                  className="btn btn-outline btn-primary flex items-center gap-2"
                  onClick={() => setShowContactSelectorForEmail(true)}
                >
                  <EnvelopeIcon className="w-5 h-5" /> Email
                </button>
                <button 
                  className="btn btn-outline btn-primary flex items-center gap-2"
                  onClick={() => setShowContactSelector(true)}
                >
                  <FaWhatsapp className="w-5 h-5" /> WhatsApp
                </button>
                <button 
                  className="btn btn-outline btn-primary flex items-center gap-2"
                  onClick={openContactDrawer}
                >
                  <ChatBubbleLeftRightIcon className="w-5 h-5" /> Manual Entry
                </button>
              </div>
              
              {/* AI Smart Recap Button */}
              {/* <button 
                className="btn bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-none hover:from-purple-700 hover:to-indigo-700 shadow-lg w-full sm:w-auto lg:ml-auto justify-center"
                onClick={() => {
                  // Toggle AI summary panel on mobile, or show/hide it on desktop
                  if (window.innerWidth < 1024) {
                    // Mobile: show drawer with AI summary
                    setAiDrawerOpen(true);
                  } else {
                    // Desktop: toggle AI panel visibility
                    setShowAiSummary(!showAiSummary);
                  }
                }}
              >
                <SparklesIcon className="w-5 h-5" />
                AI Smart Recap
              </button> */}
              
            </div>
            
            {/* Timeline container with improved spacing */}
            <div className="relative max-w-5xl">
              {/* Timeline line */}
              <div className="absolute left-8 sm:left-12 md:left-16 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-accent to-secondary shadow-lg" style={{ zIndex: 0 }} />
              
              <div className="space-y-8 md:space-y-10 lg:space-y-12">
              {renderedInteractions
                .map((row, idx) => {
                // Debug: Log first few WhatsApp messages being rendered
                if (row.kind === 'whatsapp' && idx < 3) {
                  console.log(`🔍 Rendering WhatsApp message ${idx}:`, {
                    id: row.id,
                    kind: row.kind,
                    content: row.content?.substring(0, 50),
                    raw_date: row.raw_date,
                    employee: row.employee,
                    direction: row.direction
                  });
                }
                
                // Date formatting with validation and fallback
                let dateObj: Date;
                if (!row.raw_date) {
                  console.warn('⚠️ Interaction missing raw_date in render, using current date:', { id: row.id, kind: row.kind });
                  dateObj = new Date();
                } else {
                  dateObj = new Date(row.raw_date);
                  if (isNaN(dateObj.getTime())) {
                    console.warn('⚠️ Interaction has invalid raw_date in render, using current date:', { id: row.id, kind: row.kind, raw_date: row.raw_date });
                    dateObj = new Date();
                  }
                }
                
                const day = dateObj.getDate().toString().padStart(2, '0');
                const month = dateObj.toLocaleString('en', { month: 'short' });
                const year = dateObj.getFullYear();
                const time = dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              
              // Icon and color
              let icon, iconBg, cardBg, textGradient, avatarBg;
              // Check if this is a call interaction (including manual calls and call_log for backwards compatibility)
              const isCall = row.kind === 'call' || row.kind === 'call_log' || (row.editable && (row.kind === 'call' || row.kind === 'call_log'));
              
              if (row.direction === 'out') {
                // Employee (Outgoing)
                if (row.kind === 'sms') {
                  icon = <ChatBubbleLeftRightIcon className="w-4 h-4 md:w-5 md:h-5 !text-purple-600 drop-shadow-sm" style={{color: '#9333ea'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-purple-200';
                } else if (isCall) {
                  // All calls use same color, show direction with icon (including manual calls)
                  const DirectionIcon = row.direction === 'out' ? ArrowUpIcon : ArrowDownIcon;
                  icon = (
                    <div className="flex items-center justify-center relative">
                      <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-blue-600 drop-shadow-sm" style={{color: '#2563eb'}} />
                      <DirectionIcon className="w-3 h-3 md:w-3.5 md:h-3.5 !text-blue-600 absolute -bottom-0.5 -right-0.5 bg-white rounded-full" style={{color: '#2563eb'}} />
                    </div>
                  );
                  iconBg = 'bg-white shadow-lg border-2 border-blue-200';
                } else if (row.kind === 'whatsapp_manual') {
                  // Legacy WhatsApp interactions are manual interactions but still show WhatsApp icon
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 !text-green-600 drop-shadow-sm" style={{color: '#16a34a'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-green-200';
                } else if (row.kind === 'whatsapp') {
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 !text-green-600 drop-shadow-sm" style={{color: '#16a34a'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-green-200';
                } else if (row.kind === 'email_manual') {
                  // Legacy email interactions are manual interactions but still show email icon
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 !text-blue-600 drop-shadow-sm" style={{color: '#2563eb'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-blue-200';
                } else if (row.kind === 'email') {
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 !text-blue-600 drop-shadow-sm" style={{color: '#2563eb'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-blue-200';
                } else if (row.kind === 'office') {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-orange-600 drop-shadow-sm" style={{color: '#ea580c'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-orange-200';
                } else {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-gray-600 drop-shadow-sm" style={{color: '#4b5563'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-gray-200';
                }
                // Use same color for all calls regardless of direction (including manual calls)
                if (isCall) {
                  cardBg = 'bg-gradient-to-tr from-blue-500 via-blue-600 to-indigo-600';
                  textGradient = 'bg-gradient-to-tr from-blue-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent';
                  avatarBg = 'bg-gradient-to-tr from-blue-500 via-blue-600 to-indigo-600 text-white';
                } else {
                  cardBg = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600';
                  textGradient = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 bg-clip-text text-transparent';
                  avatarBg = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white';
                }
              } else {
                // Client (Ingoing)
                if (row.kind === 'sms') {
                  icon = <ChatBubbleLeftRightIcon className="w-4 h-4 md:w-5 md:h-5 !text-indigo-600 drop-shadow-sm" style={{color: '#4f46e5'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-indigo-200';
                } else if (isCall) {
                  // All calls use same color, show direction with icon (inbound direction = 'in', including manual calls)
                  const DirectionIcon = ArrowDownIcon;
                  icon = (
                    <div className="flex items-center justify-center relative">
                      <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-blue-600 drop-shadow-sm" style={{color: '#2563eb'}} />
                      <DirectionIcon className="w-3 h-3 md:w-3.5 md:h-3.5 !text-blue-600 absolute -bottom-0.5 -right-0.5 bg-white rounded-full" style={{color: '#2563eb'}} />
                    </div>
                  );
                  iconBg = 'bg-white shadow-lg border-2 border-blue-200';
                } else if (row.kind === 'whatsapp_manual') {
                  // Legacy WhatsApp interactions are manual interactions but still show WhatsApp icon
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 !text-green-600 drop-shadow-sm" style={{color: '#16a34a'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-green-200';
                } else if (row.kind === 'whatsapp') {
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 !text-green-600 drop-shadow-sm" style={{color: '#16a34a'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-green-200';
                } else if (row.kind === 'email_manual') {
                  // Legacy email interactions are manual interactions but still show email icon
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 !text-cyan-600 drop-shadow-sm" style={{color: '#0891b2'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-cyan-200';
                } else if (row.kind === 'email') {
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 !text-cyan-600 drop-shadow-sm" style={{color: '#0891b2'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-cyan-200';
                } else if (row.kind === 'office') {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-amber-600 drop-shadow-sm" style={{color: '#d97706'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-amber-200';
                } else {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-slate-600 drop-shadow-sm" style={{color: '#475569'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-slate-200';
                }
                // Use same color for all calls regardless of direction (including manual calls)
                if (isCall) {
                  cardBg = 'bg-gradient-to-tr from-blue-500 via-blue-600 to-indigo-600';
                  textGradient = 'bg-gradient-to-tr from-blue-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent';
                  avatarBg = 'bg-gradient-to-tr from-blue-500 via-blue-600 to-indigo-600 text-white';
                } else {
                  cardBg = 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400';
                  textGradient = 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 bg-clip-text text-transparent';
                  avatarBg = 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white';
                }
              }
              
              // Get employee photo if available
              // For calls: from employee_data (JOIN result)
              // For other interactions: look up by employee name from employeePhotoMap
              // For manual interactions where client contacted us: don't look up photo (client won't be in employee map)
              let employeePhoto: string | null = null;
              const employeeData = (row as any).employee_data;
              const isManualInteraction = row.editable;
              const isClientSender = isManualInteraction && row.direction === 'in';
              
              if (employeeData) {
                // Calls have employee_data from JOIN
                employeePhoto = Array.isArray(employeeData) ? employeeData[0]?.photo_url : employeeData?.photo_url;
              } else if (!isClientSender && row.employee && employeePhotoMap.has(row.employee)) {
                // For email/WhatsApp/etc (not manual interactions with client as sender), look up by employee name
                employeePhoto = employeePhotoMap.get(row.employee) || null;
              }
              // If isClientSender is true, leave employeePhoto as null (will show initials only)
              
              // Initials - handle case where employee name might be missing or short
              const employeeNameForInitials = row.employee || 'Unknown';
              const initials = employeeNameForInitials.split(' ').map(n => n[0]).join('').toUpperCase() || '?';
              
              // Debug: Log employee name for calls to verify it's correct
              if (row.kind === 'call' && idx < 3) {
                console.log(`🔍 Rendering call ${(row as any).call_log?.id}: employee="${row.employee}", initials="${initials}", photo="${employeePhoto}"`);
              }
              
              // Debug: Log if employee name seems wrong
              if (row.kind === 'call' && (!row.employee || row.employee === 'Unknown' || row.employee.length <= 2)) {
                console.warn(`⚠️ Call ${(row as any).call_log?.id} has suspicious employee name: "${row.employee}"`);
              }
              
              return (
                <div
                  key={row.id}
                  ref={idx === lastEmailIdx ? lastEmailRef : null}
                  className="relative pl-16 sm:pl-20 md:pl-24 cursor-pointer group"
                  onClick={() => handleInteractionClick(row, idx)}
                >
                  {/* Timeline dot and icon, large, left-aligned */}
                  <div className="absolute -left-6 sm:-left-8 md:-left-10 top-0" style={{ zIndex: 2 }}>
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-xl ring-4 ring-white ${iconBg}`}>
                      {React.cloneElement(icon, { className: 'w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8' })}
                    </div>
                  </div>
                  
                  {/* Main content container with better spacing */}
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-6">
                    {/* Timestamp and metadata */}
                    <div className="flex-shrink-0 lg:w-32">
                      <div className="text-sm md:text-base font-semibold text-gray-700 mb-1">{day} {month} {year}</div>
                      <div className="text-xs md:text-sm text-gray-500">{time}</div>
                      {row.length && row.length !== 'm' && (
                        <div className="text-xs text-gray-400 mt-1">{row.length}</div>
                      )}
                    </div>
                    
                    {/* Main content card */}
                    <div className="flex-1 min-w-0">
                      <div className={`p-[2px] rounded-2xl ${cardBg} shadow-xl hover:shadow-2xl transition-all duration-300 group-hover:scale-[1.02]`}>
                        <div className="bg-white rounded-2xl p-4 sm:p-5 md:p-6">
                          {/* Header section with employee info and status */}
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                            <div className="flex items-center gap-3">
                              <EmployeeAvatar photo={employeePhoto} name={row.employee} initials={initials} avatarBg={avatarBg} />
                              <div className="flex flex-col gap-1">
                                <div className={`font-semibold text-sm sm:text-base md:text-lg ${textGradient}`}>
                                  {row.employee}
                                </div>
                                {/* Show recipient for call and manual interactions (excluding email/whatsapp which have their own logic) */}
                                {(row.kind === 'call' || row.kind === 'call_log' || row.kind === 'sms' || (row.editable && row.kind !== 'email' && row.kind !== 'whatsapp')) && (() => {
                                  // For call logs from database, get from call_log
                                  if (row.kind === 'call' || row.kind === 'call_log') {
                                    // Use the stored recipient_name from the interaction object (set during processing)
                                    const recipientName = (row as any).recipient_name;
                                    
                                    // Only show if we have a recipient name to display
                                    if (!recipientName) return null;
                                    
                                    return (
                                      <div className="text-xs text-gray-500 flex flex-col gap-0.5 mt-1">
                                        <div className="flex items-center gap-1">
                                          <span>To:</span>
                                          <span className="font-medium text-gray-700">{recipientName}</span>
                                        </div>
                                      </div>
                                    );
                                  }
                                  
                                  // For SMS and other manual interactions (excluding email/whatsapp), get from recipient_name
                                  // Note: For legacy leads, SMS might be saved as 'note' kind, so we check editable as well
                                  if (row.kind === 'sms' || (row.editable && row.kind !== 'email' && row.kind !== 'whatsapp' && row.kind !== 'call')) {
                                    const recipientName = (row as any).recipient_name;
                                    if (!recipientName) return null;
                                    
                                    return (
                                      <div className="text-xs text-gray-500 flex flex-col gap-0.5 mt-1">
                                        <div className="flex items-center gap-1">
                                          <span>To:</span>
                                          <span className="font-medium text-gray-700">{recipientName}</span>
                                        </div>
                                      </div>
                                    );
                                  }
                                  
                                  return null;
                                })()}
                                {/* Show recipient for email and WhatsApp interactions */}
                                {/* CRITICAL: If outgoing (employee to client), show client/contact name */}
                                {/*          If incoming (client to employee), show employee name */}
                                {(row.kind === 'email' || row.kind === 'whatsapp') && (() => {
                                  const isOutgoing = row.direction === 'out';
                                  
                                  // For manual interactions, use recipient_name set during processing
                                  if (row.editable && (row as any).recipient_name) {
                                    return (
                                      <div className="text-xs text-gray-500 flex items-center gap-1">
                                        <span>To:</span>
                                        <span className="font-medium text-gray-700">{(row as any).recipient_name}</span>
                                      </div>
                                    );
                                  }
                                  
                                  // If outgoing (employee to client), show client/contact name
                                  if (isOutgoing) {
                                    const interactionContactId = (row as any).contact_id;
                                    const recipientList = (row as any).recipient_list?.toLowerCase() || '';
                                    const phoneNumber = (row as any).phone_number;
                                    let recipientName = null;
                                    
                                    // First, try to find by contact_id (most reliable)
                                    if (interactionContactId !== null && interactionContactId !== undefined) {
                                      if (leadContacts.length > 0) {
                                        const contact = leadContacts.find(c => c.id === Number(interactionContactId));
                                        if (contact) {
                                          recipientName = contact.name;
                                        }
                                      }
                                    }
                                    
                                    // If not found by contact_id, try to match by email (for emails) or phone (for WhatsApp)
                                    if (!recipientName && leadContacts.length > 0) {
                                      if (row.kind === 'email') {
                                        // Email matching logic - find contact in recipient list
                                        const recipients = recipientList.split(/[,;]/).map((r: string) => r.trim().toLowerCase()).filter((r: string) => r);
                                        
                                        for (const contact of leadContacts) {
                                          const contactEmail = contact.email?.toLowerCase().trim();
                                          if (contactEmail && recipients.includes(contactEmail)) {
                                            recipientName = contact.name;
                                            break;
                                          }
                                        }
                                        
                                        // If no contact found, use client name as fallback
                                        if (!recipientName) {
                                          recipientName = client.name || 'Client';
                                        }
                                      } else if (row.kind === 'whatsapp') {
                                        // WhatsApp matching logic - match by phone number
                                        if (phoneNumber) {
                                          const normalizePhone = (phone: string) => phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
                                          const normalizedPhone = normalizePhone(phoneNumber);
                                          
                                          for (const contact of leadContacts) {
                                            const contactPhone = contact.phone ? normalizePhone(contact.phone) : null;
                                            const contactMobile = contact.mobile ? normalizePhone(contact.mobile) : null;
                                            
                                            if (contactPhone === normalizedPhone || contactMobile === normalizedPhone) {
                                              recipientName = contact.name;
                                              break;
                                            }
                                            
                                            if (normalizedPhone.length >= 4) {
                                              const last4 = normalizedPhone.slice(-4);
                                              if ((contactPhone && contactPhone.slice(-4) === last4) || 
                                                  (contactMobile && contactMobile.slice(-4) === last4)) {
                                                recipientName = contact.name;
                                                break;
                                              }
                                            }
                                          }
                                          
                                          // If no contact found, use client name as fallback
                                          if (!recipientName) {
                                            recipientName = client.name || 'Client';
                                          }
                                        }
                                      }
                                    }
                                    
                                    return recipientName ? (
                                      <div className="text-xs text-gray-500 flex items-center gap-1">
                                        <span>To:</span>
                                        <span className="font-medium text-gray-700">{recipientName}</span>
                                      </div>
                                    ) : null;
                                  } else {
                                    // If incoming (client to employee), show employee name
                                    // For incoming emails, row.employee contains the CLIENT name (the sender)
                                    // Use the stored employee_recipient_name that was set when creating the interaction
                                    const employeeRecipientName = (row as any).employee_recipient_name || 'Team';
                                    
                                    return (
                                      <div className="text-xs text-gray-500 flex items-center gap-1">
                                        <span>To:</span>
                                        <span className="font-medium text-gray-700">{employeeRecipientName}</span>
                                      </div>
                                    );
                                  }
                                })()}
                              </div>
                            </div>
                            
                            {/* Status badges */}
                            <div className="flex flex-wrap gap-2">
                              {/* Show status badge for WhatsApp and Call interactions */}
                              {row.kind === 'whatsapp' && row.status && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm ${cardBg} text-white text-xs ${row.status.toLowerCase().includes('not') ? 'opacity-80' : ''}`}>
                                  {row.status}
                                </span>
                              )}
                              {/* Call status badge - only show if status is known and not 'unread', 'unknown', or 'sent' */}
                              {row.kind === 'call' && row.status && 
                               row.status !== 'unread' && 
                               row.status.toLowerCase() !== 'unknown' && 
                               row.status.toLowerCase() !== 'sent' && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm text-xs ${
                                  row.status.toLowerCase() === 'answered' ? 'bg-green-500 text-white' :
                                  (row.status.toLowerCase() === 'no+answer' || row.status.toLowerCase() === 'no answer') ? 'bg-red-500 text-white' :
                                  row.status.toLowerCase() === 'failed' ? 'bg-red-500 text-white' :
                                  row.status.toLowerCase() === 'busy' ? 'bg-yellow-500 text-white' :
                                  'bg-gray-600 text-white'
                                }`}>
                                  {row.status === 'NO+ANSWER' ? 'NO ANSWER' : row.status}
                                </span>
                              )}
                              {/* SMS status badge - only show if status is known and not 'unread', 'unknown', or 'sent' */}
                              {row.kind === 'sms' && row.status && 
                               row.status !== 'unread' && 
                               row.status.toLowerCase() !== 'unknown' && 
                               row.status.toLowerCase() !== 'sent' && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm text-xs ${
                                  row.status.toLowerCase() === 'answered' ? 'bg-green-500 text-white' :
                                  (row.status.toLowerCase() === 'no+answer' || row.status.toLowerCase() === 'no answer') ? 'bg-red-500 text-white' :
                                  row.status.toLowerCase() === 'failed' ? 'bg-red-500 text-white' :
                                  row.status.toLowerCase() === 'busy' ? 'bg-yellow-500 text-white' :
                                  'bg-gray-600 text-white'
                                }`}>
                                  {row.status === 'NO+ANSWER' ? 'NO ANSWER' : row.status}
                                </span>
                              )}
                              {row.length && row.length !== 'm' && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm ${cardBg} text-white text-xs`}>
                                  {row.length}
                                </span>
                              )}

                              {/* WhatsApp status indicator */}
                              {row.kind === 'whatsapp' && row.status && (
                                <div className="flex items-center gap-1">
                                  {renderMessageStatus(row.status, (row as any).error_message)}
                                  {row.status === 'failed' && (
                                    <span className="px-2 py-1 rounded-full font-medium shadow-sm bg-red-100 text-red-700 text-xs">
                                      Failed
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        
                          {/* Content section - show content for all calls (manual calls are editable, database calls have auto-generated content) */}
                          {row.content && (
                            <TruncatedContent
                              content={(() => {
                                // For email_manual and whatsapp_manual interactions, content is already normalized with proper line breaks
                                if ((row.kind === 'email_manual' || row.kind === 'whatsapp_manual') && row.content) {
                                  // Content should already be normalized, but ensure it's properly formatted
                                  return row.renderedContent || row.renderedContentFallback || row.content;
                                }
                                // For other interactions, use existing logic
                                return row.renderedContent || row.renderedContentFallback || (row.content ? row.content.replace(/\n/g, '<br>') : '');
                              })()}
                              maxCharacters={500}
                              direction={getTextDirection(row.content)}
                              subject={row.subject}
                            />
                          )}
                          
                          {/* Call recording playback controls - only show play button for NO+ANSWER and BUSY status */}
                          {row.kind === 'call' && (() => {
                            const callStatus = row.status?.toUpperCase() || '';
                            const shouldShowPlayButton = callStatus === 'NO+ANSWER' || 
                                                         callStatus === 'NO ANSWER' || 
                                                         callStatus === 'BUSY';
                            
                            if (!shouldShowPlayButton) return null;
                            
                            return (
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                  <SpeakerWaveIcon className="w-5 h-5 text-gray-500" />
                                  <span className="text-sm font-medium text-gray-700">
                                    {row.recording_url ? 'Call Recording' : 'Recording not available'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {row.recording_url && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (playingAudioId === row.id) {
                                          handleStopRecording();
                                        } else {
                                          handlePlayRecording(row.recording_url!, row.id.toString());
                                        }
                                      }}
                                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                                        playingAudioId === row.id
                                          ? 'bg-red-500 text-white hover:bg-red-600 shadow-md'
                                          : 'bg-purple-500 text-white hover:bg-purple-600 shadow-md'
                                      }`}
                                    >
                                      {playingAudioId === row.id ? (
                                        <>
                                          <StopIcon className="w-4 h-4" />
                                          Stop
                                        </>
                                      ) : (
                                        <>
                                          <PlayIcon className="w-4 h-4" />
                                          Play
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Observation/Notes */}
                          {row.observation && row.observation !== 'call-ended' && (
                            <div className="bg-purple-50 border-l-4 border-purple-400 p-3 rounded-r-lg">
                              <div className="flex items-start gap-2">
                                <div className="w-2 h-2 bg-purple-400 rounded-full mt-2 flex-shrink-0"></div>
                                <div>
                                  <div className="text-sm font-medium text-purple-900 mb-1">Note</div>
                                  <div className="text-sm text-purple-800 break-words">{row.observation}</div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
            .filter(Boolean)}

            {hasMoreInteractions && (
              <div className="flex justify-center pt-4">
                <button
                  className="btn btn-outline btn-primary"
                  onClick={() =>
                    setVisibleInteractionsCount(prev =>
                      Math.min(prev + INITIAL_VISIBLE_INTERACTIONS, sortedInteractions.length)
                    )
                  }
                >
                  Load more interactions ({sortedInteractions.length - visibleInteractionsCount})
                </button>
              </div>
            )}
              </div>
            </div>
            
            {/* Timeline and History Buttons at bottom */}
            <div className="mt-8 md:mt-12 pt-6 md:pt-8 border-t border-base-200">
              <TimelineHistoryButtons client={client} />
            </div>
          </>
        )}
      </div>
      {/* Right-side AI summary panel (hidden on mobile, conditional on desktop) */}
      {showAiSummary && (
        <div className="hidden xl:block w-full max-w-md ai-summary-panel">
          <div className="sticky top-8">
            <AISummaryPanel messages={aiSummaryMessages} />
          </div>
        </div>
      )}
      {/* Email Thread Modal - Inline modal showing all interactions filtered by selected contact */}
      {isEmailModalOpen && createPortal(
        <div className="fixed inset-0 bg-white z-[9999]">
          {/* CSS to ensure email content displays fully and preserves Outlook formatting */}
          <style>{`
            .email-content {
              max-width: none !important;
              overflow: visible !important;
              word-wrap: break-word !important;
            }
            .email-content * {
              max-width: none !important;
              overflow: visible !important;
            }
            .email-content img {
              max-width: 100% !important;
              height: auto !important;
              display: inline-block !important;
              object-fit: contain !important;
            }
            .email-content img[src^="data:"] {
              max-width: 100% !important;
              height: auto !important;
              display: inline-block !important;
            }
            .email-content img[data-load-error="true"] {
              display: none !important;
            }
            .email-content table {
              width: 100% !important;
              border-collapse: collapse !important;
            }
            .email-content p, 
            .email-content div, 
            .email-content span {
              word-wrap: break-word !important;
            }
            /* Preserve Outlook's original text direction and alignment */
            .email-content [dir] {
              /* Let Outlook's dir attribute control direction */
            }
            .email-content [dir="auto"] {
              unicode-bidi: plaintext;
            }
            .email-content [dir="rtl"] {
              text-align: right;
            }
            .email-content [dir="ltr"] {
              text-align: left;
            }
          `}</style>
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between p-4 md:p-6 border-b border-gray-200">
              <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                {/* Back Button - Mobile Only (when in email detail view) */}
                {isMobile && showEmailDetail && (
                  <button
                    onClick={() => {
                      setShowEmailDetail(false);
                      setSelectedEmailForView(null);
                    }}
                    className="btn btn-ghost btn-circle btn-sm flex-shrink-0 mr-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <h2 className="text-lg md:text-2xl font-bold text-gray-900">Interactions</h2>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                  <span className="text-gray-600 text-sm md:text-base truncate">
                    {selectedContactForEmail ? selectedContactForEmail.contact.name : client.name} ({client.lead_number})
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {/* Mailbox Status and Sync - Hidden on Mobile */}
                {!isMobile && (
                  <>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full font-semibold ${
                          mailboxStatus.connected
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-current"></span>
                        {mailboxStatus.connected ? 'Mailbox connected' : 'Mailbox disconnected'}
                      </span>
                      {formattedLastSync && (
                        <span>Last sync: {formattedLastSync}</span>
                      )}
                      {mailboxError && (
                        <span className="text-error">{mailboxError}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={runMailboxSync}
                        disabled={isMailboxLoading || emailsLoading || !mailboxStatus.connected || !userId}
                      >
                        {isMailboxLoading ? 'Syncing...' : 'Sync emails'}
                      </button>
                      {!mailboxStatus.connected && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={handleMailboxConnect}
                          disabled={isMailboxLoading || !userId}
                        >
                          Connect mailbox
                        </button>
                      )}
                    </div>
                  </>
                )}
                <button
                  onClick={() => {
                    setIsEmailModalOpen(false);
                    setSelectedEmailForView(null);
                    setEmailSearchQuery('');
                    setShowEmailDetail(false);
                  }}
                  className="btn btn-ghost btn-circle"
                >
                  <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              </div>
            </div>

            {/* Search Bar - Collapsible */}
            <div className="border-b border-gray-200 bg-white">
              {/* Toggle Button */}
              <div className="px-4 md:px-6 py-2 flex items-center justify-between">
                <button
                  onClick={() => setIsSearchBarOpen(!isSearchBarOpen)}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <span>Search emails</span>
                  {isSearchBarOpen ? (
                    <ChevronUpIcon className="h-4 w-4" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4" />
                  )}
                </button>
                {emailSearchQuery && (
                  <span className="text-xs text-gray-500">
                    {emailSearchQuery.length} character{emailSearchQuery.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {/* Search Input - Collapsible */}
              {isSearchBarOpen && (
                <div className="px-4 md:px-6 pb-3 transition-all duration-200">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                      placeholder="Search emails by keywords, sender name, or recipient..."
                      value={emailSearchQuery}
                      onChange={(e) => setEmailSearchQuery(e.target.value)}
                      autoFocus
                    />
                    {emailSearchQuery && (
                      <button
                        onClick={() => setEmailSearchQuery('')}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center"
                      >
                        <XMarkIcon className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Email List and Viewer - Split View */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Sidebar - Email List (Hidden on Mobile when in detail view) */}
              <div className={`${isMobile && showEmailDetail ? 'hidden' : isMobile ? 'w-full' : 'w-80'} border-r border-gray-200 flex flex-col overflow-hidden`}>
                <div className="flex-1 overflow-y-auto p-2">
                  {emailsLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="loading loading-spinner loading-lg text-purple-500"></div>
                    </div>
                  ) : emails.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-500 p-4">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium">No emails</p>
                        <p className="text-xs text-gray-400 mt-1">Try syncing emails</p>
                      </div>
                    </div>
                  ) : (() => {
                    const filteredEmails = [...emails].filter((message) => {
                      // STRICT filtering by selected contact if one is selected
                      if (selectedContactForEmail) {
                        const contactId = Number(selectedContactForEmail.contact.id);
                        const contactEmail = selectedContactForEmail.contact.email?.toLowerCase().trim();
                        
                        // STRICT RULE: If email has contact_id, it MUST match exactly (no fallback to email matching)
                        if (message.contact_id !== null && message.contact_id !== undefined) {
                          const emailContactId = Number(message.contact_id);
                          if (emailContactId !== contactId) {
                            return false; // Different contact_id, exclude immediately
                          }
                          // contact_id matches, continue to search filter
                        } else {
                          // Only if email has NO contact_id, then match by email address (fallback for old emails)
                          if (contactEmail) {
                            const messageFrom = message.from?.toLowerCase().trim();
                            const messageTo = message.to?.toLowerCase().trim() || '';
                            
                            // Split recipient_list by comma/semicolon and check for exact match
                            const recipients = messageTo.split(/[,;]/).map((r: string) => r.trim());
                            const matchesContact = 
                              messageFrom === contactEmail || 
                              recipients.includes(contactEmail);
                            
                            if (!matchesContact) {
                              return false; // Email doesn't match, exclude
                            }
                          } else {
                            // No contact email to match, exclude this message
                            return false;
                          }
                        }
                      }
                      
                      if (!emailSearchQuery.trim()) return true;
                      
                      const searchTerm = emailSearchQuery.toLowerCase();
                      
                      // Search in subject
                      if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in email body content
                      if (message.bodyPreview && message.bodyPreview.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in sender name (from field)
                      if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in recipient (to field)
                      if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in sender name (display name)
                      // Determine if from office domain (team/user) based on email, not just direction
                      const isFromOffice = isOfficeEmail(message.from);
                      const isTeamEmail = isFromOffice || message.direction === 'outgoing';
                      const senderName = isTeamEmail 
                        ? ((message as any).sender_display_name || currentUserFullName || 'Team')
                        : (selectedContactForEmail?.contact.name || client.name || 'Client');
                      if (senderName.toLowerCase().includes(searchTerm)) return true;
                      
                      return false;
                    });
                    
                    if (filteredEmails.length === 0 && emailSearchQuery.trim()) {
                      return (
                        <div className="flex items-center justify-center h-full text-gray-500 p-4">
                          <div className="text-center">
                            <MagnifyingGlassIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                            <p className="text-sm font-medium">No emails found</p>
                            <p className="text-xs text-gray-400 mt-1">No emails match "{emailSearchQuery}"</p>
                            <button
                              onClick={() => setEmailSearchQuery('')}
                              className="mt-3 text-xs text-purple-600 hover:text-purple-800 underline"
                            >
                              Clear search
                            </button>
                          </div>
                        </div>
                      );
                    }
                    
                    return (
                      <div className="space-y-2">
                        {filteredEmails
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .map((message, index) => {
                      const senderEmail = message.from || '';
                      const isFromOffice = isOfficeEmail(senderEmail);
                      const isOutgoing = isFromOffice ? true : (message.direction === 'outgoing');
                      const senderDisplayName = isOutgoing
                        ? ((message as any).sender_display_name || currentUserFullName || 'Team')
                        : (selectedContactForEmail?.contact.name || client.name || 'Client');
                      const isSelected = selectedEmailForView?.id === message.id;
                      
                      // Get preview text (strip HTML) - prefer body_html if available for full content preview
                      const contentForPreview = (message as any).body_html || message.bodyPreview || (message as any).body_preview || '';
                      const previewText = contentForPreview
                        ? contentForPreview.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().substring(0, 100)
                        : 'No content';
                      
                      return (
                        <button
                          key={message.id || index}
                          onClick={() => {
                            setSelectedEmailForView(message);
                            // Hydrate this email if needed
                            hydrateEmailBodies([message]);
                            // On mobile, show detail view
                            if (isMobile) {
                              setShowEmailDetail(true);
                            }
                          }}
                          className={`w-full text-left p-3 rounded-lg border transition-all ${
                            isSelected
                              ? 'bg-purple-50 border-purple-300 shadow-sm'
                              : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-start gap-2 mb-2">
                            <div className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${
                              isOutgoing ? 'bg-blue-500' : 'bg-pink-500'
                            }`}></div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold text-gray-900 truncate" dir="auto">
                                  {senderDisplayName}
                                </span>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  isOutgoing ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                                }`}>
                                  {isOutgoing ? 'Team' : 'Client'}
                                </span>
                              </div>
                              <div className="text-sm font-semibold text-gray-900 mb-1 line-clamp-1" dir="auto">
                                {message.subject || '(no subject)'}
                              </div>
                              <div className="text-xs text-gray-500" dir="auto" style={{ 
                                display: '-webkit-box',
                                WebkitLineClamp: 'none',
                                WebkitBoxOrient: 'vertical',
                                overflow: 'visible',
                                textOverflow: 'clip'
                              }}>
                                {previewText}
                              </div>
                              <div className="text-xs text-gray-400 mt-2">
                                {formatTime(message.date)}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Right Side - Selected Email Viewer (Hidden on Mobile when in list view) */}
              <div className={`${isMobile && !showEmailDetail ? 'hidden' : 'flex-1'} flex flex-col overflow-hidden bg-white`}>
                {selectedEmailForView ? (
                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-4xl mx-auto">
                      {/* Email Header */}
                      <div className="border-b border-gray-200 pb-4 mb-6">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <h2 className="text-xl font-bold text-gray-900 mb-2" dir="auto">
                              {selectedEmailForView.subject || '(no subject)'}
                            </h2>
                            <div className="flex items-center gap-2 mb-3">
                              <div className={`px-2 py-1 rounded text-xs font-semibold ${
                                (isOfficeEmail(selectedEmailForView.from) || selectedEmailForView.direction === 'outgoing')
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-pink-100 text-pink-700'
                              }`}>
                                {(isOfficeEmail(selectedEmailForView.from) || selectedEmailForView.direction === 'outgoing') ? 'Team' : 'Client'}
                              </div>
                              <span className="text-sm font-semibold text-gray-700" dir="auto">
                                {(isOfficeEmail(selectedEmailForView.from) || selectedEmailForView.direction === 'outgoing')
                                  ? ((selectedEmailForView as any).sender_display_name || currentUserFullName || 'Team')
                                  : (selectedContactForEmail?.contact.name || client.name || 'Client')}
                              </span>
                            </div>
                          </div>
                          <div className="text-sm text-gray-500">
                            {formatTime(selectedEmailForView.date)}
                          </div>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="font-semibold text-gray-600">From:</span>
                            <span className="ml-2 text-gray-900" dir="ltr">{selectedEmailForView.from || 'Unknown'}</span>
                          </div>
                          {selectedEmailForView.to && (() => {
                            const recipients = selectedEmailForView.to.split(/[,;]/).map((r: string) => r.trim()).filter((r: string) => r);
                            return (
                              <div>
                                <span className="font-semibold text-gray-600">To:</span>
                                <span className="ml-2 text-gray-900" dir="ltr">
                                  {recipients.map((recipient: string, idx: number) => (
                                    <span key={idx}>
                                      {recipient}
                                      {idx < recipients.length - 1 && ', '}
                                    </span>
                                  ))}
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Email Body - Full Content */}
                      <div className="mb-6">
                        {(() => {
                          // Prefer body_html over bodyPreview/body_preview for full content
                          let emailContent = selectedEmailForView.body_html || selectedEmailForView.bodyPreview || selectedEmailForView.body_preview;
                          
                          if (emailContent) {
                            // Process inline images (convert cid: references to data URLs)
                            const attachments = selectedEmailForView.attachments || [];
                            emailContent = processEmailHtmlWithInlineImages(emailContent, attachments);
                            
                            // Format and sanitize the HTML
                            emailContent = formatEmailHtmlForDisplay(emailContent);
                            emailContent = sanitizeEmailHtml(emailContent);
                            
                            return (
                              <EmailContentWithErrorHandling 
                                html={emailContent}
                                emailId={selectedEmailForView.id}
                              />
                            );
                          } else {
                            return (
                              <div className="text-gray-500 italic py-8 text-center">
                                Loading email content...
                                <div className="mt-2">
                                  <button
                                    onClick={() => {
                                      if (selectedEmailForView) {
                                        hydrateEmailBodies([selectedEmailForView]);
                                      }
                                    }}
                                    className="btn btn-sm btn-outline"
                                  >
                                    Fetch Full Content
                                  </button>
                                </div>
                              </div>
                            );
                          }
                        })()}
                      </div>

                      {/* Attachments */}
                      {selectedEmailForView.attachments && Array.isArray(selectedEmailForView.attachments) && selectedEmailForView.attachments.length > 0 && (
                        <div className="border-t border-gray-200 pt-6">
                          <h3 className="text-sm font-semibold text-gray-700 mb-3">
                            Attachments ({selectedEmailForView.attachments.length})
                          </h3>
                          <div className="space-y-2">
                            {selectedEmailForView.attachments.map((attachment: any, idx: number) => {
                              if (!attachment || (!attachment.id && !attachment.name)) return null;
                              
                              const attachmentKey = attachment.id || attachment.name || `${selectedEmailForView.id}-${idx}`;
                              const attachmentName = attachment.name || `Attachment ${idx + 1}`;
                              const isDownloading = attachment.id && downloadingAttachments[attachment.id];
                              
                              return (
                                <button
                                  key={attachmentKey}
                                  type="button"
                                  className="flex items-center gap-3 w-full p-3 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors text-left"
                                  onClick={() => handleDownloadAttachment(selectedEmailForView.id, attachment)}
                                  disabled={Boolean(isDownloading)}
                                >
                                  {isDownloading ? (
                                    <span className="loading loading-spinner loading-sm text-blue-500" />
                                  ) : (
                                    <DocumentTextIcon className="w-5 h-5 text-blue-600 flex-shrink-0" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-900 truncate">
                                      {attachmentName}
                                    </div>
                                    {(attachment.sizeInBytes || attachment.size) && (
                                      <div className="text-xs text-gray-500">
                                        {((attachment.sizeInBytes || attachment.size) / 1024).toFixed(1)} KB
                                      </div>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <p className="text-lg font-medium">Select an email</p>
                      <p className="text-sm text-gray-400 mt-1">Choose an email from the list to view its content</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Compose Area */}
            <div className="border-t border-gray-200 p-3 md:p-6">
              {showCompose && createPortal(
                <div className="fixed inset-0 z-[10002]">
                  <div className="absolute inset-0 bg-black/50" onClick={() => setShowCompose(false)} />
                  <div className="relative z-[10003] flex h-full w-full flex-col bg-white shadow-2xl">
                    <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 md:px-6 lg:px-10">
                      <h2 className="text-lg font-semibold md:text-xl">Compose Email</h2>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowCompose(false)}>
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 md:px-6 lg:px-10">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="font-semibold text-sm">To</label>
                          </div>
                          {renderComposeRecipients('to')}
                        </div>
                        <div className="space-y-2">
                          <label className="font-semibold text-sm">CC</label>
                          {renderComposeRecipients('cc')}
                        </div>
                        {composeRecipientError && <p className="text-sm text-error">{composeRecipientError}</p>}

                  <input
                    type="text"
                    placeholder="Subject"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />

                        <label className="font-semibold text-sm">Body</label>

                        {showComposeLinkForm && (
                          <div className="flex flex-col gap-3 md:flex-row md:items-end bg-base-200/70 border border-base-300 rounded-lg p-3">
                            <div className="flex-1 flex flex-col gap-2 md:flex-row md:items-center">
                              <input
                                type="text"
                                className="input input-bordered w-full md:flex-1"
                                placeholder="Link label (optional)"
                                value={composeLinkLabel}
                                onChange={event => setComposeLinkLabel(event.target.value)}
                              />
                              <input
                                type="url"
                                className="input input-bordered w-full md:flex-1"
                                placeholder="https://example.com"
                                value={composeLinkUrl}
                                onChange={event => setComposeLinkUrl(event.target.value)}
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={handleInsertComposeLink}
                                disabled={!composeLinkUrl.trim()}
                              >
                                Insert Link
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={handleCancelComposeLink}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* AI Suggestions Dropdown */}
                        {showAISuggestions && (
                          <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-sm font-semibold text-gray-900">
                                {composeBody.trim() ? 'AI Message Improvement' : 'AI Suggestions'}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAISuggestions(false);
                                  setAiSuggestions([]);
                                }}
                                className="btn btn-ghost btn-xs"
                              >
                                <XMarkIcon className="w-4 h-4" />
                              </button>
                            </div>
                            
                            <div className="space-y-2">
                              {isLoadingAI ? (
                                <div className="text-center text-gray-500 py-4">
                                  <div className="loading loading-spinner loading-sm"></div>
                                  <span className="ml-2">Getting AI suggestions...</span>
                                </div>
                              ) : (
                                <div 
                                  className="w-full p-4 rounded-lg border border-gray-200 bg-white cursor-pointer hover:bg-gray-100 transition-colors"
                                  onClick={() => applyAISuggestion(aiSuggestions[0])}
                                >
                                  <div className="text-sm text-gray-900">{aiSuggestions[0]}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                  <textarea
                    placeholder="Type your message..."
                    value={composeBody}
                    onChange={(e) => {
                      setComposeBody(e.target.value);
                      // Dynamically detect Hebrew as user types
                      setComposeBodyIsRTL(containsHebrew(e.target.value));
                    }}
                    dir={composeBodyIsRTL ? 'rtl' : 'ltr'}
                    style={{
                      textAlign: composeBodyIsRTL ? 'right' : 'left',
                      direction: composeBodyIsRTL ? 'rtl' : 'ltr'
                    }}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y min-h-[320px]"
                    rows={10}
                  />
                  
                  {composeAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {composeAttachments.map((file, index) => (
                        <div key={index} className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-lg">
                          <PaperClipIcon className="w-4 h-4 text-gray-500" />
                          <span className="text-sm">{file.name}</span>
                          <button
                            onClick={() => setComposeAttachments(prev => prev.filter((_, i) => i !== index))}
                            className="text-red-500 hover:text-red-700"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  </div>
                    <div className="px-4 py-4 border-t border-gray-200 flex items-center justify-between gap-4 md:px-6 lg:px-10">
                      {/* Left side - Buttons and Template Filters */}
                      <div className="flex items-center gap-4 flex-wrap">
                        {/* Circle action buttons */}
                        <div className="flex items-center gap-3">
                          {/* Attach Files Button */}
                          <button
                            type="button"
                            className="btn btn-circle border-0 text-white hover:opacity-90 transition-all hover:scale-105"
                            style={{ 
                              backgroundColor: '#4218CC', 
                              width: '44px', 
                              height: '44px'
                            }}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={sending}
                            title="Attach files"
                          >
                            <PaperClipIcon className="w-6 h-6" />
                          </button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={(e) => e.target.files && handleAttachmentUpload(e.target.files)}
                            className="hidden"
                          />
                          
                          {/* AI Suggestions Button */}
                          <button
                            type="button"
                            onClick={handleAISuggestions}
                            disabled={isLoadingAI || !client}
                            className="btn btn-circle border-0 text-white hover:opacity-90 transition-all hover:scale-105"
                            style={{ 
                              backgroundColor: '#4218CC', 
                              width: '44px', 
                              height: '44px'
                            }}
                            title={composeBody.trim() ? "Improve message with AI" : "Get AI suggestions"}
                          >
                            {isLoadingAI ? (
                              <span className="loading loading-spinner loading-sm" />
                            ) : (
                              <SparklesIcon className="w-6 h-6" />
                            )}
                          </button>
                          
                          {/* Add Link Button */}
                          <button
                            type="button"
                            className={`btn btn-circle border-0 text-white hover:opacity-90 transition-all hover:scale-105 ${
                              showComposeLinkForm ? 'ring-2 ring-offset-2 ring-[#4218CC]' : ''
                            }`}
                            style={{ 
                              backgroundColor: '#4218CC', 
                              width: '44px', 
                              height: '44px'
                            }}
                            onClick={() => setShowComposeLinkForm(prev => !prev)}
                            disabled={sending}
                            title={showComposeLinkForm ? 'Hide link form' : 'Add link'}
                          >
                            <LinkIcon className="w-6 h-6" />
                          </button>
                          
                          {/* Add Contacts from Lead Button */}
                          <button
                            type="button"
                            className={`btn btn-circle border-0 text-white hover:opacity-90 transition-all hover:scale-105 ${
                              showComposeContactsModal ? 'ring-2 ring-offset-2 ring-[#4218CC]' : ''
                            }`}
                            style={{ 
                              backgroundColor: '#4218CC', 
                              width: '44px', 
                              height: '44px'
                            }}
                            onClick={handleOpenComposeContactsModal}
                            disabled={sending || !client}
                            title="Add contacts from lead"
                          >
                            <UserPlusIcon className="w-6 h-6" />
                          </button>
                        </div>
                        
                        {/* Divider */}
                        <div className="w-px h-8 bg-base-300 hidden sm:block" />
                        
                        {/* Template filters */}
                        <div className="flex items-center gap-2 flex-wrap" ref={composeTemplateDropdownRef}>
                          {/* Language Filter */}
                          <select
                            className="select select-bordered select-sm w-28 text-sm"
                            value={composeTemplateLanguageFilter || ''}
                            onChange={(e) => {
                              setComposeTemplateLanguageFilter(e.target.value || null);
                              if (!composeTemplateDropdownOpen) {
                                setComposeTemplateDropdownOpen(true);
                              }
                            }}
                          >
                            <option value="">Language</option>
                            {availableLanguages.map(lang => (
                              <option key={lang.id} value={lang.id}>
                                {lang.name}
                              </option>
                            ))}
                          </select>
                          
                          {/* Placement Filter */}
                          <select
                            className="select select-bordered select-sm w-36 text-sm"
                            value={composeTemplatePlacementFilter ?? ''}
                            onChange={(e) => {
                              setComposeTemplatePlacementFilter(e.target.value ? Number(e.target.value) : null);
                              if (!composeTemplateDropdownOpen) {
                                setComposeTemplateDropdownOpen(true);
                              }
                            }}
                          >
                            <option value="">Placement</option>
                            {availablePlacements.map(placement => (
                              <option key={placement.id} value={placement.id}>
                                {placement.name}
                              </option>
                            ))}
                          </select>
                          
                          {/* Template Search */}
                          <div className="relative w-40">
                            <input
                              type="text"
                              className="input input-bordered input-sm w-full pr-8"
                              placeholder="Templates..."
                              value={composeTemplateSearch}
                              onChange={event => {
                                setComposeTemplateSearch(event.target.value);
                                if (!composeTemplateDropdownOpen) {
                                  setComposeTemplateDropdownOpen(true);
                                }
                              }}
                              onFocus={() => {
                                if (!composeTemplateDropdownOpen) {
                                  setComposeTemplateDropdownOpen(true);
                                }
                              }}
                              onBlur={() => setTimeout(() => setComposeTemplateDropdownOpen(false), 150)}
                            />
                            <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            {composeTemplateDropdownOpen && (
                              <div className="absolute bottom-full mb-1 z-20 w-72 bg-white border border-gray-300 rounded-md shadow-lg max-h-56 overflow-y-auto">
                                {filteredComposeTemplates.length === 0 ? (
                                  <div className="px-3 py-2 text-sm text-gray-500">No templates found</div>
                                ) : (
                                  filteredComposeTemplates.map(template => (
                                    <div
                                      key={template.id}
                                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                                      onMouseDown={e => e.preventDefault()}
                                      onClick={() => handleComposeTemplateSelect(template)}
                                    >
                                      <div className="font-medium">{template.name}</div>
                                      {(template.placementName || template.languageName) && (
                                        <div className="text-xs text-gray-500 mt-1">
                                          {template.placementName && <span>{template.placementName}</span>}
                                          {template.placementName && template.languageName && <span> • </span>}
                                          {template.languageName && <span>{template.languageName}</span>}
                                        </div>
                                      )}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                          
                          {/* Clear Filters Button */}
                          {(selectedComposeTemplateId !== null || composeTemplateLanguageFilter || composeTemplatePlacementFilter !== null) && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-circle"
                              onClick={() => {
                                setSelectedComposeTemplateId(null);
                                setComposeTemplateSearch('');
                                setComposeBody('');
                                setComposeBodyIsRTL(false);
                                const nameToUse = selectedContactForEmail?.contact.name || client.name;
                                const defaultSubjectValue = `[${client.lead_number}] - ${nameToUse} - ${client.topic || ''}`;
                                setComposeSubject(defaultSubjectValue);
                              }}
                              title="Clear filters"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {/* Right side - Send button only */}
                      <button
                        onClick={handleSendEmail}
                        disabled={sending || !composeBody.trim()}
                        className="btn btn-primary min-w-[100px] flex items-center gap-2"
                      >
                        {sending ? (
                          <span className="loading loading-spinner loading-sm" />
                        ) : (
                          <>
                            <PaperAirplaneIcon className="w-4 h-4" />
                            Send
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}
              
              {/* Lead Contacts Modal */}
              {showComposeContactsModal && createPortal(
                <div className="fixed inset-0 z-[10004] flex items-center justify-center">
                  <div 
                    className="absolute inset-0 bg-black/50" 
                    onClick={() => setShowComposeContactsModal(false)} 
                  />
                  <div className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                    {/* Modal Header */}
                    <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">Select Contacts</h3>
                        <p className="text-sm text-gray-500">Add contacts from this lead to recipients</p>
                      </div>
                      <button
                        onClick={() => setShowComposeContactsModal(false)}
                        className="btn btn-ghost btn-sm btn-circle"
                      >
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                    
                    {/* Modal Body */}
                    <div className="px-5 py-4 max-h-[320px] overflow-y-auto">
                      {loadingComposeContacts ? (
                        <div className="flex items-center justify-center py-8">
                          <span className="loading loading-spinner loading-md text-primary" />
                          <span className="ml-2 text-gray-500">Loading contacts...</span>
                        </div>
                      ) : composeLeadContacts.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <UserPlusIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                          <p>No contacts with email found for this lead</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {composeLeadContacts.map(contact => {
                            const isSelected = composeSelectedContactIds.has(contact.id);
                            const alreadyAdded = composeToRecipients.includes(contact.email!);
                            
                            return (
                              <div
                                key={contact.id}
                                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                  alreadyAdded 
                                    ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
                                    : isSelected 
                                      ? 'bg-purple-50 border-purple-300' 
                                      : 'bg-white border-gray-200 hover:bg-gray-50'
                                }`}
                                onClick={() => !alreadyAdded && toggleComposeContactSelection(contact.id)}
                              >
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                                  alreadyAdded
                                    ? 'bg-gray-300 border-gray-300'
                                    : isSelected 
                                      ? 'bg-[#4218CC] border-[#4218CC]' 
                                      : 'border-gray-300'
                                }`}>
                                  {(isSelected || alreadyAdded) && <CheckIcon className="w-3 h-3 text-white" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-gray-900 truncate">{contact.name}</span>
                                    {contact.isMain && (
                                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Main</span>
                                    )}
                                    {alreadyAdded && (
                                      <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Added</span>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-500 truncate">{contact.email}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    
                    {/* Modal Footer */}
                    <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
                      <span className="text-sm text-gray-500">
                        {composeSelectedContactIds.size > 0 
                          ? `${composeSelectedContactIds.size} contact(s) selected`
                          : 'Select contacts to add'}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setShowComposeContactsModal(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm text-white"
                          style={{ backgroundColor: '#4218CC' }}
                          onClick={handleAddSelectedComposeContacts}
                          disabled={composeSelectedContactIds.size === 0}
                        >
                          Add Selected
                        </button>
                      </div>
                    </div>
                  </div>
                </div>,
                document.body
              )}
              
              {!showCompose && (
                <button
                  onClick={() => {
                    // Use selected contact's email if available, otherwise fall back to client email
                    const emailToUse = selectedContactForEmail?.contact.email || client.email;
                    const initialRecipients = normaliseAddressList(emailToUse);
                    setComposeToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
                    setComposeCcRecipients([]);
                    setComposeToInput('');
                    setComposeCcInput('');
                    setComposeRecipientError(null);
                    setShowComposeLinkForm(false);
                    setComposeLinkLabel('');
                    setComposeLinkUrl('');
                    setSelectedComposeTemplateId(null);
                    setComposeTemplateSearch('');
                    setComposeTemplateLanguageFilter(null);
                    setComposeTemplatePlacementFilter(null);
                    // Use selected contact's name if available, otherwise use client name
                    const nameToUse = selectedContactForEmail?.contact.name || client.name;
                    const defaultSubjectValue = `[${client.lead_number}] - ${nameToUse} - ${client.topic || ''}`;
                    setComposeSubject(defaultSubjectValue);
                    setComposeBody('');
                    setComposeAttachments([]);
                    setShowCompose(true);
                  }}
                  className="w-full btn btn-primary"
                >
                  <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                  Compose Message
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {contactDrawerOpen && createPortal(
        <div className="fixed inset-0 z-[999] flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={closeContactDrawer} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between p-8 pb-6 flex-shrink-0">
              <h3 className="text-2xl font-bold">Contact Client</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeContactDrawer}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1 overflow-y-auto min-h-0 px-8">
              <div>
                <label className="block font-semibold mb-1">Direction</label>
                <select
                  className="select select-bordered w-full"
                  value={newContact.direction}
                  onChange={e => handleNewContactChange('direction', e.target.value)}
                >
                  <option value="out">We contacted client</option>
                  <option value="in">Client contacted us</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Contact Person (Optional)</label>
                <select
                  className="select select-bordered w-full"
                  value={newContact.contact_id?.toString() || ''}
                  onChange={e => {
                    const contactId = e.target.value ? parseInt(e.target.value) : null;
                    const contact = manualInteractionContacts.find(c => c.id === contactId);
                    handleNewContactChange('contact_id', contactId);
                    handleNewContactChange('contact_name', contact?.name || '');
                  }}
                >
                  <option value="">-- Select Contact (Optional) --</option>
                  {manualInteractionContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                      {(contact.phone || contact.mobile) && ` - ${contact.phone || contact.mobile}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">How to contact</label>
                <select
                  className="select select-bordered w-full"
                  value={newContact.method}
                  onChange={e => handleNewContactChange('method', e.target.value)}
                >
                  {contactMethods.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Date</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.date}
                  onChange={e => handleNewContactChange('date', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Time</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.time}
                  onChange={e => handleNewContactChange('time', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Minutes</label>
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={newContact.length}
                  onChange={e => handleNewContactChange('length', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Content</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[80px]"
                  value={newContact.content}
                  onChange={e => handleNewContactChange('content', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Observation</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[60px]"
                  value={newContact.observation}
                  onChange={e => handleNewContactChange('observation', e.target.value)}
                />
              </div>
            </div>
            <div className="p-8 pt-6 flex justify-end flex-shrink-0 border-t border-base-300">
              <button className="btn btn-primary px-8" onClick={handleSaveContact}>
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Contact Selector Modal for WhatsApp */}
      {client && (
        <ContactSelectorModal
          isOpen={showContactSelector}
          onClose={() => {
            setShowContactSelector(false);
            setSelectedContactForWhatsApp(null);
          }}
          leadId={isLegacyLead 
            ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
            : client.id}
          leadType={isLegacyLead ? 'legacy' : 'new'}
          leadName={client.name}
          leadNumber={client.lead_number}
          leadEmail={client.email}
          leadPhone={client.phone}
          leadMobile={client.mobile}
          mode="whatsapp"
          onContactSelected={(contact, leadId, leadType) => {
            console.log('📞 Contact selected for WhatsApp:', { contact, leadId, leadType });
            // Set the contact in both state and ref (ref is immediate, state is async)
            const contactData = { contact, leadId, leadType };
            selectedContactForWhatsAppRef.current = contactData;
            setSelectedContactForWhatsApp(contactData);
            setShowContactSelector(false);
            // Use requestAnimationFrame to ensure state update is flushed, then open modal
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                console.log('🚀 Opening WhatsApp modal with contact:', contactData.contact.name);
                setIsWhatsAppOpen(true);
              });
            });
          }}
        />
      )}
      {/* Contact Selector Modal for Email */}
      {client && (
        <ContactSelectorModal
          isOpen={showContactSelectorForEmail}
          onClose={() => {
            setShowContactSelectorForEmail(false);
            // Don't clear selectedContactForEmail here - it will be cleared when email modal closes
          }}
          leadId={isLegacyLead 
            ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
            : client.id}
          leadType={isLegacyLead ? 'legacy' : 'new'}
          leadName={client.name}
          leadNumber={client.lead_number}
          leadEmail={client.email}
          leadPhone={client.phone}
          leadMobile={client.mobile}
          mode="email"
          onContactSelected={(contact, leadId, leadType) => {
            setSelectedContactForEmail({ contact, leadId, leadType });
            setShowContactSelectorForEmail(false);
            setIsEmailModalOpen(true);
          }}
        />
      )}
      {/* WhatsApp Modal */}
      <SchedulerWhatsAppModal
        isOpen={isWhatsAppOpen}
        onClose={() => {
          handleWhatsAppClose();
          setSelectedContactForWhatsApp(null);
          selectedContactForWhatsAppRef.current = null;
        }}
        client={client ? {
          id: client.id,
          name: client.name,
          lead_number: client.lead_number,
          phone: client.phone,
          mobile: client.mobile,
          lead_type: client.lead_type
        } : undefined}
        selectedContact={selectedContactForWhatsApp || selectedContactForWhatsAppRef.current}
        hideContactSelector={true}
        onClientUpdate={async () => {
          // Refresh interactions when WhatsApp messages are updated
          if (onClientUpdate) {
            await onClientUpdate();
          }
          // Trigger re-fetch of interactions by updating a dependency
          // The useEffect with client.id dependency will handle the refresh
        }}
      />
      {/* Email Thread Modal - Removed, using inline modal below instead */}
      {/* Details Drawer for Interactions */}
      {detailsDrawerOpen && activeInteraction && createPortal(
        <div className="fixed inset-0 z-[999] flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setDetailsDrawerOpen(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
              <h3 className="text-2xl font-bold">Interaction Details</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetailsDrawerOpen(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1 overflow-y-auto min-h-0">
              <div><span className="font-semibold">Type:</span> {activeInteraction.kind}</div>
              <div><span className="font-semibold">Date:</span> {activeInteraction.date} {activeInteraction.time}</div>
              <div><span className="font-semibold">Employee:</span> {activeInteraction.employee}</div>
              {activeInteraction.editable && (
                <>
                  <div>
                    <label className="block font-semibold mb-1">Direction</label>
                    <select
                      className="select select-bordered w-full"
                      value={editData.direction}
                      onChange={e => handleEditChange('direction', e.target.value)}
                    >
                      <option value="out">We contacted client</option>
                      <option value="in">Client contacted us</option>
                    </select>
                  </div>
                  {(activeInteraction.kind === 'call' || activeInteraction.kind === 'call_log') && (
                    <div>
                      <label className="block font-semibold mb-1">Minutes</label>
                      <input
                        type="number"
                        className="input input-bordered w-full"
                        value={editData.length}
                        onChange={e => handleEditChange('length', e.target.value)}
                        min={0}
                      />
                    </div>
                  )}
                  <div>
                    <label className="block font-semibold mb-1">Content</label>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-[80px]"
                      value={editData.content}
                      onChange={e => handleEditChange('content', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Observation</label>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-[60px]"
                      value={editData.observation}
                      onChange={e => handleEditChange('observation', e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 justify-end mt-4">
                    <button className="btn btn-primary" onClick={handleSave}>Save</button>
                    <button className="btn btn-ghost" onClick={closeDrawer}>Cancel</button>
                  </div>
                </>
              )}
              {/* Show non-editable fields for non-manual interactions */}
              {!activeInteraction.editable && (
                <>
                  <div><span className="font-semibold">Content:</span> {activeInteraction.content}</div>
                  <div><span className="font-semibold">Observation:</span> {activeInteraction.observation}</div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* AI Smart Recap Drawer for Mobile */}
      {/* {aiDrawerOpen && createPortal(
        <div className="fixed inset-0 z-[999] flex lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setAiDrawerOpen(false)} />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between p-6 border-b border-base-300 bg-gradient-to-r from-purple-600 to-indigo-600">
              <div className="flex items-center gap-3">
                <SparklesIcon className="w-6 h-6 text-white" />
                <h3 className="text-xl font-bold text-white saira-regular">AI Smart Recap</h3>
              </div>
              <button className="btn btn-ghost btn-sm text-white hover:bg-white/20" onClick={() => setAiDrawerOpen(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <AISummaryPanel messages={aiSummaryMessages} />
            </div>
          </div>
        </div>,
        document.body
      )} */}
    </div>
  );
};

export default CommunicationsTab; 