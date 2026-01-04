import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate, useParams, useNavigationType } from 'react-router-dom';
import { supabase, type Lead } from '../lib/supabase';
import { getStageName, fetchStageNames, areStagesEquivalent, normalizeStageName, getStageColour } from '../lib/stageUtils';
import { updateLeadStageWithHistory, recordLeadStageChange, fetchStageActorInfo, getLatestStageBeforeStage } from '../lib/leadStageManager';
import { fetchAllLeads, fetchLeadById, searchLeads, type CombinedLead } from '../lib/legacyLeadsApi';
import { getUnactivationReasonFromId } from '../lib/unactivationReasons';
import { saveFollowUp } from '../lib/followUpsManager';
import BalanceEditModal from './BalanceEditModal';
import {
  PencilIcon,
  TrashIcon,
  InformationCircleIcon,
  UserGroupIcon,
  UserIcon,
  MegaphoneIcon,
  CalendarIcon,
  CurrencyDollarIcon,
  ChatBubbleLeftRightIcon,
  PencilSquareIcon,
  Square2StackIcon,
  AcademicCapIcon,
  NoSymbolIcon,
  DocumentCheckIcon,
  HandThumbDownIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  PhoneIcon,
  HashtagIcon,
  DocumentDuplicateIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  StarIcon,
  Squares2X2Icon,
  MagnifyingGlassIcon,
  ChevronRightIcon,
  MapPinIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  BanknotesIcon,
  FolderIcon,
  ChartPieIcon,
  DocumentChartBarIcon,
  Cog6ToothIcon,
  SparklesIcon,
  XMarkIcon,
  HandThumbUpIcon,
  TagIcon,
  ChartBarIcon,
  CheckIcon,
  PlayIcon,
  EyeIcon,
  ClockIcon,
  Bars3Icon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import InfoTab from './client-tabs/InfoTab';
import RolesTab from './client-tabs/RolesTab';
import ContactInfoTab from './client-tabs/ContactInfoTab';
import MarketingTab from './client-tabs/MarketingTab';
import ExpertTab from './client-tabs/ExpertTab';
import MeetingTab from './client-tabs/MeetingTab';
import PriceOfferTab from './client-tabs/PriceOfferTab';
import InteractionsTab from './client-tabs/InteractionsTab';
import FinancesTab from './client-tabs/FinancesTab';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { createTeamsMeeting, sendEmail, createCalendarEventWithAttendee } from '../lib/graph';
import { generateICSFromDateTime } from '../lib/icsGenerator';
import { sendEmailViaBackend } from '../lib/mailboxApi';
import { useAuthContext } from '../contexts/AuthContext';
import { ClientInteractionsCache, ClientTabProps } from '../types/client';
import { useAdminRole } from '../hooks/useAdminRole';
import {
  InteractionRequiredAuthError,
  type AccountInfo,
} from '@azure/msal-browser';
import toast from 'react-hot-toast';
import LeadSummaryDrawer from './LeadSummaryDrawer';
import { generateProformaName } from '../lib/proforma';
import TimePicker from './TimePicker';
import ClientInformationBox from './ClientInformationBox';
import ProgressFollowupBox from './ProgressFollowupBox';
import SendPriceOfferModal from './SendPriceOfferModal';
import { addToHighlights, removeFromHighlights, isInHighlights } from '../lib/highlightsUtils';
import { replaceEmailTemplateParams } from '../lib/emailTemplateParams';

// Template parsing and formatting utilities (from MeetingTab.tsx)
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

// Helper to check if text contains RTL characters
const containsRTL = (text?: string | null): boolean => {
  if (!text) return false;
  const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/;
  return rtlRegex.test(text);
};

// Format email body with line breaks and RTL support
const formatEmailBody = async (
  template: string, 
  recipientName: string,
  context?: {
    client?: any;
    meetingDate?: string;
    meetingTime?: string;
    meetingLocation?: string;
    meetingLink?: string;
  }
): Promise<string> => {
  if (!template) return '';
  
  let htmlBody = template;
  
  // If context is provided, use centralized template replacement
  if (context?.client) {
    const templateContext = {
      clientId: context.client?.id || null,
      clientName: context.client?.name || recipientName,
      contactName: recipientName,
      leadNumber: context.client?.lead_number || null,
      // topic removed - not to be included in emails
      meetingDate: context.meetingDate || null,
      meetingTime: context.meetingTime || null,
      meetingLocation: context.meetingLocation || null,
      meetingLink: context.meetingLink || null,
    };
    
    htmlBody = await replaceEmailTemplateParams(template, templateContext);
  } else {
    // Fallback: just replace {name}
    htmlBody = template.replace(/\{\{name\}\}/g, recipientName).replace(/\{name\}/gi, recipientName);
  }
  
  // Preserve line breaks: convert \n to <br> if not already in HTML
  // Check if content already has HTML structure
  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(htmlBody);
  
  if (!hasHtmlTags) {
    // Plain text: convert line breaks to <br> and preserve spacing
    htmlBody = htmlBody
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .replace(/\r/g, '\n')    // Handle old Mac line endings
      .replace(/\n/g, '<br>'); // Convert to HTML line breaks
  } else {
    // Has HTML: ensure <br> tags are preserved, convert remaining \n
    htmlBody = htmlBody
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/(<br\s*\/?>|\n)/gi, '<br>') // Normalize all line breaks
      .replace(/\n/g, '<br>'); // Convert any remaining newlines
  }
  
  // Detect if content contains Hebrew/RTL text
  const isRTL = containsRTL(htmlBody);
  
  // Wrap in div with proper direction and styling
  if (isRTL) {
    htmlBody = `<div dir="rtl" style="text-align: right; direction: rtl; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
  } else {
    htmlBody = `<div dir="ltr" style="text-align: left; direction: ltr; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
  }
  
  return htmlBody;
};

const getContrastingTextColor = (hexColor?: string | null) => {
  if (!hexColor) return '#111827';
  let sanitized = hexColor.trim();
  if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
  if (sanitized.length === 3) {
    sanitized = sanitized.split('').map(char => char + char).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
    return '#111827';
  }
  const r = parseInt(sanitized.slice(0, 2), 16) / 255;
  const g = parseInt(sanitized.slice(2, 4), 16) / 255;
  const b = parseInt(sanitized.slice(4, 6), 16) / 255;

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? '#111827' : '#ffffff';
};

interface TabItem {
  id: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: number;
  component: React.ComponentType<ClientTabProps>;
}

interface ClientSignedForm {
  fileId: string;
  handlerId: string;
  handler: string;
  currency: string;
  numApplicants: string;
  proposal: string;
  potentialValue: string;
}

type HandlerOption = {
  id: string;
  label: string;
};

// Note: This tabs array is now replaced by the dynamic one below
// const tabs: TabItem[] = [
//   { id: 'info', label: 'Info', icon: InformationCircleIcon, component: InfoTab },
//   { id: 'roles', label: 'Roles', icon: UserGroupIcon, component: RolesTab },
//   { id: 'contact', label: 'Contact info', icon: UserIcon, component: ContactInfoTab },
//   { id: 'marketing', label: 'Marketing', icon: MegaphoneIcon, component: MarketingTab },
//   { id: 'expert', label: 'Expert', icon: UserIcon, component: ExpertTab },
//   { id: 'meeting', label: 'Meeting', icon: CalendarIcon, component: MeetingTab },
//   { id: 'price', label: 'Price Offer', icon: CurrencyDollarIcon, component: PriceOfferTab },
//   { id: 'interactions', label: 'Interactions', icon: ChatBubbleLeftRightIcon, badge: 31, component: InteractionsTab },
//   { id: 'finances', label: 'Finances', icon: CurrencyDollarIcon, component: FinancesTab },
// ];

const tabColors = [
  'bg-primary',
  'bg-secondary',
  'bg-accent',
  'bg-info',
  'bg-success',
  'bg-warning',
  'bg-error',
  'bg-purple-500',
  'bg-pink-500',
];

interface ClientsProps {
  selectedClient: any;
  setSelectedClient: React.Dispatch<any>;
  refreshClientData: (clientId: number | string) => Promise<void>;
}

const getCurrencySymbol = (currencyCode?: string) => {
  if (!currencyCode) return '₪';
  
  // Convert to string and trim whitespace from currency code
  const strCode = String(currencyCode).trim();
  if (!strCode) return '₪';
  
  // If it's already a symbol, return it as-is (check exact match first)
  const symbols = ['₪', '$', '€', '£', 'C$', 'A$', '¥', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RUB', 'UAH', 'TRY'];
  const exactMatch = symbols.find(s => s === strCode);
  if (exactMatch) {
    return exactMatch;
  }
  
  // Map currency codes to symbols
  const upperCode = strCode.toUpperCase();
  switch (upperCode) {
    case 'USD':
    case 'US$':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'ILS':
    case 'NIS':
      return '₪';
    case 'CAD':
      return 'C$';
    case 'AUD':
      return 'A$';
    case 'JPY':
      return '¥';
    case 'CHF':
      return 'CHF';
    case 'SEK':
      return 'SEK';
    case 'NOK':
      return 'NOK';
    case 'DKK':
      return 'DKK';
    case 'PLN':
      return 'PLN';
    case 'CZK':
      return 'CZK';
    case 'HUF':
      return 'HUF';
    case 'RON':
      return 'RON';
    case 'BGN':
      return 'BGN';
    case 'HRK':
      return 'HRK';
    case 'RUB':
      return 'RUB';
    case 'UAH':
      return 'UAH';
    case 'TRY':
      return 'TRY';
    default:
      // If it's a short string that looks like a symbol, return it
      if (strCode.length <= 3 && !strCode.match(/^[A-Z]{3}$/)) {
        return strCode;
      }
      return strCode; // Return as-is if we can't map it
  }
};

// Add getValidTeamsLink helper (copied from MeetingTab)
function getValidTeamsLink(link: string | undefined): string {
  if (!link) return '';
  try {
    if (link.startsWith('http')) return link;
    const obj = JSON.parse(link);
    if (obj && typeof obj === 'object' && obj.joinUrl && typeof obj.joinUrl === 'string') {
      return obj.joinUrl;
    }
    if (obj && typeof obj === 'object' && obj.joinWebUrl && typeof obj.joinWebUrl === 'string') {
      return obj.joinWebUrl;
    }
  } catch (e) {
    if (typeof link === 'string' && link.startsWith('http')) return link;
  }
  return '';
}

// Helper to fetch Outlook signature if not present
async function fetchOutlookSignature(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/mailboxSettings', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.mailSignature || null;
  } catch {
    return null;
  }
}

// Helper to get current user's full name from Supabase
async function fetchCurrentUserFullName() {
  try {
    // Get current user name from Supabase auth and users table
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user?.email) {
      return 'System User';
    }
    
    // Get user from users table
    const { data: userData, error } = await supabase
      .from('users')
      .select('full_name, first_name, last_name, email')
      .eq('email', user.email)
      .single();
    
    if (error) {
      return user.email;
    }
    
    if (userData) {
      if (userData.full_name) {
        return userData.full_name;
      } else if (userData.first_name && userData.last_name) {
        return `${userData.first_name} ${userData.last_name}`;
      } else if (userData.first_name) {
        return userData.first_name;
      } else if (userData.last_name) {
        return userData.last_name;
      } else {
        return userData.email;
      }
    }
    
    return user.email;
  } catch (error) {
    console.error('Error getting current user name:', error);
    return 'System User';
  }
}

const Clients: React.FC<ClientsProps> = ({
  selectedClient,
  setSelectedClient,
  refreshClientData,
}) => {
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  
  // Removed excessive console.log statements for performance
  // State to store all employees for name lookup
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  // State to store employee availability data (unavailable_times and unavailable_ranges)
  const [employeeAvailabilityData, setEmployeeAvailabilityData] = useState<{[key: string]: any[]}>({});
  // State to store all categories for name lookup
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [allLanguages, setAllLanguages] = useState<Array<{ id: number; name: string | null }>>([]);
  const [allCountries, setAllCountries] = useState<Array<{ id: number; name: string; iso_code?: string | null }>>([]);
  // State for country codes (for phone code dropdowns)
  const [countryCodes, setCountryCodes] = useState<Array<{ code: string; country: string; name: string }>>([
    { code: '+972', country: 'IL', name: 'Israel' } // Default fallback
  ]);
  // State to track if current user is a superuser
  const [isSuperuser, setIsSuperuser] = useState<boolean>(false);
  // State to track if current lead is in highlights
  const [isInHighlightsState, setIsInHighlightsState] = useState<boolean>(false);

  // Helper function to extract country code and number from full phone number
  const parsePhoneNumber = (fullNumber: string | undefined | null) => {
    // Handle null, undefined, or empty values
    if (!fullNumber || fullNumber === '---' || fullNumber === null || fullNumber === undefined || fullNumber.trim() === '') {
      return { countryCode: '+972', number: '' };
    }
    
    // Trim the input to remove any extra spaces
    const trimmed = fullNumber.trim();
    
    // Find matching country code
    const matchedCode = countryCodes.find(code => trimmed.startsWith(code.code));
    if (matchedCode) {
      return {
        countryCode: matchedCode.code,
        number: trimmed.substring(matchedCode.code.length)
      };
    }
    
    // Default to Israel if no match found
    return { countryCode: '+972', number: trimmed };
  };

  // Helper function to format phone number for display
  const formatPhoneNumber = (countryCode: string, number: string) => {
    if (!number || number.trim() === '') return '';
    return `${countryCode}${number}`;
  };

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = (employeeId: string | null | undefined) => {
    if (!employeeId || employeeId === '---') return 'Not assigned';
    // Find employee in the loaded employees array
    const employee = allEmployees.find((emp: any) => emp.id.toString() === employeeId.toString());
    return employee ? employee.display_name : employeeId; // Fallback to ID if not found
  };

  // Helper function to check if an employee is unavailable at a specific date and time
  const isEmployeeUnavailable = (employeeName: string, date: string, time: string): boolean => {
    if (!date || !time || !employeeName) return false;
    
    const unavailableForDate = employeeAvailabilityData[date] || [];
    return unavailableForDate.some(unavailable => {
      if (unavailable.employeeName === employeeName) {
        // If it's a range (all-day unavailable), always return true
        if (unavailable.isRange || unavailable.startTime === 'All Day') {
          return true;
        }
        
        // For specific time slots, check time overlap
        const unavailableStart = unavailable.startTime;
        const unavailableEnd = unavailable.endTime;
        const isTimeConflict = time >= unavailableStart && time <= unavailableEnd;
        
        return isTimeConflict;
      }
      return false;
    });
  };

  // Function to find duplicate contacts
  const findDuplicateContacts = async () => {
    if (!selectedClient?.id) {
      setDuplicateContacts([]);
      return;
    }

    // Clear state immediately before starting async work
    setDuplicateContacts([]);

    try {
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      const currentLeadId = isLegacyLead 
        ? (typeof selectedClient.id === 'string' ? selectedClient.id.replace('legacy_', '') : String(selectedClient.id))
        : selectedClient.id;

      // Get all contacts for the current lead
      const { data: leadContacts } = await supabase
        .from('lead_leadcontact')
        .select('contact_id, main, newlead_id, lead_id')
        .or(isLegacyLead 
          ? `lead_id.eq.${currentLeadId}` 
          : `newlead_id.eq.${currentLeadId}`
        );

      if (!leadContacts || leadContacts.length === 0) {
        setDuplicateContacts([]);
        return;
      }

      const contactIds = leadContacts.map(lc => lc.contact_id).filter(Boolean);
      if (contactIds.length === 0) {
        setDuplicateContacts([]);
        return;
      }

      // Get contact details
      const { data: currentContacts } = await supabase
        .from('leads_contact')
        .select('id, name, email, phone, mobile')
        .in('id', contactIds);

      if (!currentContacts || currentContacts.length === 0) {
        setDuplicateContacts([]);
        return;
      }

      // Build search filters for duplicate detection
      const duplicateMatches: Array<{
        contactId: number;
        contactName: string;
        contactEmail: string | null;
        contactPhone: string | null;
        contactMobile: string | null;
        contactCountry: string | null;
        leadId: string | number;
        leadNumber: string;
        leadName: string;
        leadType: 'new' | 'legacy';
        matchingFields: string[];
        stage: string | number | null;
        category: string | null;
        topic: string | null;
        source: string | null;
        status: string | number | null;
      }> = [];

      for (const currentContact of currentContacts) {
        const filters: string[] = [];
        
        // Normalize phone numbers for comparison
        const normalizePhone = (phone: string | null | undefined): string => {
          if (!phone) return '';
          return phone.replace(/\D/g, '');
        };

        if (currentContact.email) {
          filters.push(`email.eq.${currentContact.email}`);
        }
        if (currentContact.name) {
          filters.push(`name.ilike.%${currentContact.name}%`);
        }
        if (currentContact.phone) {
          const normalizedPhone = normalizePhone(currentContact.phone);
          if (normalizedPhone) {
            filters.push(`phone.eq.${currentContact.phone}`);
            // Also check mobile field
            filters.push(`mobile.eq.${currentContact.phone}`);
          }
        }
        if (currentContact.mobile) {
          const normalizedMobile = normalizePhone(currentContact.mobile);
          if (normalizedMobile) {
            filters.push(`phone.eq.${currentContact.mobile}`);
            filters.push(`mobile.eq.${currentContact.mobile}`);
          }
        }

        if (filters.length === 0) continue;

        // Find contacts with matching data (excluding current lead's contacts)
        // Build OR query properly for Supabase
        let duplicateQuery = supabase
          .from('leads_contact')
          .select('id, name, email, phone, mobile, country_id, misc_country!country_id(id, name)');
        
        if (filters.length > 0) {
          duplicateQuery = duplicateQuery.or(filters.join(','));
        }
        
        // Exclude current lead's contacts - filter after fetching
        const { data: allDuplicateContacts } = await duplicateQuery;
        const duplicateContacts = allDuplicateContacts?.filter(
          dc => !contactIds.includes(dc.id)
        ) || [];

        if (!duplicateContacts || duplicateContacts.length === 0) continue;

        // For each duplicate contact, find which leads it belongs to
        const duplicateContactIds = duplicateContacts.map(dc => dc.id);
        const { data: relationships } = await supabase
          .from('lead_leadcontact')
          .select('contact_id, newlead_id, lead_id')
          .in('contact_id', duplicateContactIds);

        if (!relationships || relationships.length === 0) continue;

        // Get lead information for each relationship
        const newLeadIds = relationships
          .map(r => r.newlead_id)
          .filter(Boolean) as string[];
        const legacyLeadIds = relationships
          .map(r => r.lead_id)
          .filter(Boolean) as number[];

        // Fetch new leads (excluding subleads - those with master_id)
        if (newLeadIds.length > 0) {
          const { data: newLeads } = await supabase
            .from('leads')
            .select('id, lead_number, name, stage, category, master_id, status, topic, source_id')
            .in('id', newLeadIds)
            .is('master_id', null); // Only get main leads, exclude subleads

          if (newLeads) {
            for (const duplicateContact of duplicateContacts) {
              const contactRelationships = relationships.filter(r => r.contact_id === duplicateContact.id);
              for (const rel of contactRelationships) {
                if (rel.newlead_id) {
                  const lead = newLeads.find(l => l.id === rel.newlead_id);
                  if (lead && lead.id !== currentLeadId) {
                    const matchingFields: string[] = [];
                    if (currentContact.email && duplicateContact.email && currentContact.email.toLowerCase() === duplicateContact.email.toLowerCase()) {
                      matchingFields.push('email');
                    }
                    if (currentContact.phone && duplicateContact.phone && normalizePhone(currentContact.phone) === normalizePhone(duplicateContact.phone)) {
                      matchingFields.push('phone');
                    }
                    if (currentContact.mobile && duplicateContact.mobile && normalizePhone(currentContact.mobile) === normalizePhone(duplicateContact.mobile)) {
                      matchingFields.push('mobile');
                    }
                    if (currentContact.phone && duplicateContact.mobile && normalizePhone(currentContact.phone) === normalizePhone(duplicateContact.mobile)) {
                      matchingFields.push('phone/mobile');
                    }
                    if (currentContact.mobile && duplicateContact.phone && normalizePhone(currentContact.mobile) === normalizePhone(duplicateContact.phone)) {
                      matchingFields.push('mobile/phone');
                    }

                    if (matchingFields.length > 0) {
                      // Get category name for new lead (category is already text in new leads table)
                      const categoryName = lead.category || null;
                      // Get stage name from stage ID
                      const stageName = (lead.stage !== null && lead.stage !== undefined) ? getStageName(String(lead.stage)) : null;
                      // Get country name from the contact
                      const countryName = (duplicateContact.misc_country as any)?.name || null;
                      // Get topic
                      const topicName = lead.topic || null;
                      // Get source name
                      let sourceName = null;
                      if (lead.source_id) {
                        const { data: sourceData } = await supabase
                          .from('misc_leadsource')
                          .select('name')
                          .eq('id', lead.source_id)
                          .maybeSingle();
                        sourceName = sourceData?.name || null;
                      }
                      
                      duplicateMatches.push({
                        contactId: duplicateContact.id,
                        contactName: duplicateContact.name || 'Unknown',
                        contactEmail: duplicateContact.email,
                        contactPhone: duplicateContact.phone,
                        contactMobile: duplicateContact.mobile,
                        contactCountry: countryName,
                        leadId: lead.id,
                        leadNumber: lead.lead_number || String(lead.id),
                        leadName: lead.name || 'Unknown',
                        leadType: 'new',
                        matchingFields,
                        stage: stageName, // Use stage name instead of ID
                        category: categoryName,
                        topic: topicName,
                        source: sourceName,
                        status: lead.status || null,
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // Fetch legacy leads (excluding subleads - those with master_id)
        if (legacyLeadIds.length > 0) {
          const { data: legacyLeads } = await supabase
            .from('leads_lead')
            .select('id, name, stage, category_id, master_id, status, topic, source_id')
            .in('id', legacyLeadIds)
            .is('master_id', null); // Only get main leads, exclude subleads

          if (legacyLeads) {
            for (const duplicateContact of duplicateContacts) {
              const contactRelationships = relationships.filter(r => r.contact_id === duplicateContact.id);
              for (const rel of contactRelationships) {
                if (rel.lead_id) {
                  const lead = legacyLeads.find(l => l.id === rel.lead_id);
                  if (lead && String(lead.id) !== String(currentLeadId)) {
                    const matchingFields: string[] = [];
                    if (currentContact.email && duplicateContact.email && currentContact.email.toLowerCase() === duplicateContact.email.toLowerCase()) {
                      matchingFields.push('email');
                    }
                    if (currentContact.phone && duplicateContact.phone && normalizePhone(currentContact.phone) === normalizePhone(duplicateContact.phone)) {
                      matchingFields.push('phone');
                    }
                    if (currentContact.mobile && duplicateContact.mobile && normalizePhone(currentContact.mobile) === normalizePhone(duplicateContact.mobile)) {
                      matchingFields.push('mobile');
                    }
                    if (currentContact.phone && duplicateContact.mobile && normalizePhone(currentContact.phone) === normalizePhone(duplicateContact.mobile)) {
                      matchingFields.push('phone/mobile');
                    }
                    if (currentContact.mobile && duplicateContact.phone && normalizePhone(currentContact.mobile) === normalizePhone(duplicateContact.phone)) {
                      matchingFields.push('mobile/phone');
                    }

                    if (matchingFields.length > 0) {
                      // Get category name for legacy lead
                      const categoryName = lead.category_id ? getCategoryName(lead.category_id) : null;
                      // Get stage name from stage ID
                      const stageName = (lead.stage !== null && lead.stage !== undefined) ? getStageName(String(lead.stage)) : null;
                      
                      // Get country name from the contact
                      const countryName = (duplicateContact.misc_country as any)?.name || null;
                      // Get topic
                      const topicName = lead.topic || null;
                      // Get source name
                      let sourceName = null;
                      if (lead.source_id) {
                        const { data: sourceData } = await supabase
                          .from('misc_leadsource')
                          .select('name')
                          .eq('id', lead.source_id)
                          .maybeSingle();
                        sourceName = sourceData?.name || null;
                      }
                      
                      duplicateMatches.push({
                        contactId: duplicateContact.id,
                        contactName: duplicateContact.name || 'Unknown',
                        contactEmail: duplicateContact.email,
                        contactPhone: duplicateContact.phone,
                        contactMobile: duplicateContact.mobile,
                        contactCountry: countryName,
                        leadId: `legacy_${lead.id}`,
                        leadNumber: String(lead.id),
                        leadName: lead.name || 'Unknown',
                        leadType: 'legacy',
                        matchingFields,
                        stage: stageName, // Use stage name instead of ID
                        category: categoryName,
                        topic: topicName,
                        source: sourceName,
                        status: lead.status || null,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Deduplicate by leadNumber to ensure each lead appears only once
      // If the same lead has multiple matching contacts, we'll keep the first one
      const uniqueMatches = Array.from(
        new Map(
          duplicateMatches.map(m => [m.leadNumber, m])
        ).values()
      );

      setDuplicateContacts(uniqueMatches);
    } catch (error) {
      console.error('Error finding duplicate contacts:', error);
      setDuplicateContacts([]);
    }
  };

  // Helper function to format lead number for legacy leads
  // For sub-leads, calculates suffix based on existing sub-leads with same master_id
  const formatLegacyLeadNumber = (legacyLead: any, subLeadSuffix?: number): string => {
    const masterId = legacyLead.master_id;
    const leadId = String(legacyLead.id);
    
    // If master_id is null/empty, it's a master lead - return just the ID
    if (!masterId || String(masterId).trim() === '') {
      return leadId;
    }
    
    // If master_id exists, it's a sub-lead
    // Use provided suffix if available, otherwise calculate it
    if (subLeadSuffix !== undefined) {
      return `${masterId}/${subLeadSuffix}`;
    }
    
    // If suffix not provided, return a placeholder that will be calculated when data is fetched
    // This is a fallback - ideally suffix should be calculated when fetching the data
    return `${masterId}/?`;
  };


  // Helper function to get currency symbol from currency ID or currency name
  const getCurrencySymbol = (currencyId: string | number | null | undefined, fallbackCurrency?: string) => {
    if (!currencyId || currencyId === '---') {
      // If no currency_id but we have a fallback currency, use it
      if (fallbackCurrency && fallbackCurrency.trim() !== '') {
        return fallbackCurrency;
      }
      // Default to NIS - use the same format as dropdown expects
      return '₪'; // Default to NIS
    }
    
    // Find currency in loaded currencies
    const currency = currencies.find((curr: any) => curr.id.toString() === currencyId.toString());
    
    if (currency) {
      // Map currency to its symbol based on ISO code or name
      const isoCode = currency.iso_code ? currency.iso_code.toUpperCase() : null;
      const currencyName = currency.name ? currency.name.toUpperCase() : null;
      
      // Map common currencies to their symbols
      if (isoCode === 'ILS' || isoCode === 'NIS' || currencyName === 'ILS' || currencyName === 'NIS') return '₪';
      if (isoCode === 'EUR' || currencyName === 'EUR' || currencyName === 'EURO') return '€';
      if (isoCode === 'USD' || currencyName === 'USD' || currencyName === 'DOLLAR') return '$';
      if (isoCode === 'GBP' || currencyName === 'GBP' || currencyName === 'POUND') return '£';
      if (isoCode === 'CAD' || currencyName === 'CAD') return 'C$';
      
      // If no match found, return the symbol if available, otherwise default to ₪
      return currency.front_name || '₪';
    }
    
    return '₪'; // Default fallback
  };

  // Helper function to get category name from ID with main category
  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string) => {
    console.log('🔍 getCategoryName called with categoryId:', categoryId, 'type:', typeof categoryId, 'fallbackCategory:', fallbackCategory);
    
    if (!categoryId || categoryId === '---') {
      console.log('🔍 getCategoryName: categoryId is null/undefined/---, checking fallback');
      // If no category_id but we have a fallback category, try to find it in the loaded categories
      if (fallbackCategory && fallbackCategory.trim() !== '') {
        console.log('🔍 getCategoryName: Looking for fallback category in loaded categories:', fallbackCategory);
        
        // Try to find the fallback category in the loaded categories
        const foundCategory = allCategories.find((cat: any) => 
          cat.name.toLowerCase().trim() === fallbackCategory.toLowerCase().trim()
        );
        
        if (foundCategory) {
          console.log('🔍 getCategoryName: Found fallback category in loaded categories:', foundCategory);
          // Return category name with main category in parentheses
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name; // Fallback if no main category
          }
        } else {
          console.log('🔍 getCategoryName: Fallback category not found in loaded categories, using as-is:', fallbackCategory);
          return fallbackCategory; // Use as-is if not found in loaded categories
        }
      }
      console.log('🔍 getCategoryName: No fallback category, returning empty string');
      return '';
    }
    
    console.log('🔍 getCategoryName processing valid categoryId:', { 
      categoryId, 
      allCategoriesLength: allCategories.length,
      allCategories: allCategories.map(cat => ({ 
        id: cat.id, 
        name: cat.name, 
        parent_id: cat.parent_id,
        mainCategory: cat.misc_maincategory?.name 
      }))
    });
    
    // Find category in loaded categories
    const category = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (category) {
      console.log('🔍 Found category:', { 
        id: category.id, 
        name: category.name, 
        mainCategory: category.misc_maincategory?.name 
      });
      
      // Return category name with main category in parentheses
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name; // Fallback if no main category
      }
    }
    
    console.log('🔍 Category not found, returning empty string for categoryId:', categoryId);
    return ''; // Return empty string instead of ID to show "Not specified"
  };
  const { lead_number = "" } = useParams();
  const location = useLocation();
  const navType = useNavigationType();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedLeadNumber = searchParams.get('lead');
  const fullLeadNumber = decodeURIComponent(location.pathname.replace(/^\/clients\//, '').replace(/\/$/, '').replace(/\/master$/, ''));

  const buildClientRoute = useCallback((manualId?: string | null, leadNumberValue?: string | null) => {
    const manualString = manualId?.toString().trim() || '';
    const leadString = leadNumberValue?.toString().trim() || '';
    const isSubLeadNumber = leadString.includes('/');

    if (isSubLeadNumber && manualString !== '') {
      const query = leadString !== '' ? `?lead=${encodeURIComponent(leadString)}` : '';
      return `/clients/${encodeURIComponent(manualString)}` + query;
    }

    if (leadString !== '') {
      return `/clients/${encodeURIComponent(leadString)}`;
    }

    if (manualString !== '') {
      return `/clients/${encodeURIComponent(manualString)}`;
    }

    return '/clients';
  }, []);
  const [activeTab, setActiveTab] = useState('info');
  const [isStagesOpen, setIsStagesOpen] = useState(false);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isBalanceModalOpen, setIsBalanceModalOpen] = useState(false);
  // Track the last route to detect route changes and force refetch
  const lastRouteRef = useRef<string>('');
  // Default to collapsed on mobile, expanded on desktop
  const [isClientInfoCollapsed, setIsClientInfoCollapsed] = useState(false);
  const [isProgressCollapsed, setIsProgressCollapsed] = useState(false);
  
  // Set default collapsed state for mobile on mount
  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      setIsClientInfoCollapsed(true);
      setIsProgressCollapsed(true);
    }
  }, []);
  const [duplicateContacts, setDuplicateContacts] = useState<Array<{
    contactId: number;
    contactName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    contactMobile: string | null;
    contactCountry: string | null;
    leadId: string | number;
    leadNumber: string;
    leadName: string;
    leadType: 'new' | 'legacy';
    matchingFields: string[];
    stage: string | number | null;
    category: string | null;
    topic: string | null;
    source: string | null;
    status: string | number | null;
  }>>([]);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [isDuplicateDropdownOpen, setIsDuplicateDropdownOpen] = useState(false);
  const [copyingContactId, setCopyingContactId] = useState<number | null>(null);
  const { instance } = useMsal();
  const { isAdmin, isLoading: isAdminLoading } = useAdminRole();
  const [isSchedulingMeeting, setIsSchedulingMeeting] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);
  const [showScheduleMeetingPanel, setShowScheduleMeetingPanel] = useState(false);
  // Tabs inside Schedule Meeting drawer: 'regular' or 'paid'
  const [meetingType, setMeetingType] = useState<'regular' | 'paid'>('regular');
  // Controls which stage the lead should move to after successfully creating a meeting
  // - 'meeting_scheduled' for the first meeting
  // - 'another_meeting' for follow-up meetings
  const [scheduleStageTarget, setScheduleStageTarget] = useState<'meeting_scheduled' | 'another_meeting'>('meeting_scheduled');
  // Toggle for notifying client via email when scheduling a meeting
  const [notifyClientOnSchedule, setNotifyClientOnSchedule] = useState(false);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [meetingFormData, setMeetingFormData] = useState({
    date: '',
    time: '09:00',
    location: '',
    manager: '',
    helper: '',
    brief: '',
    attendance_probability: 'Medium',
    complexity: 'Simple',
    car_number: '',
    calendar: 'current', // 'current' or 'active_client'
    // Extra fields for "Paid meeting" tab
    collection_manager: '',
    paid_category: '',
    paid_currency: '',
    meeting_total: '',
  });
  const [meetingLocations, setMeetingLocations] = useState<
    Array<{ id: string | number; name: string; default_link?: string | null }>
  >([]);
  const [meetingCountsByTime, setMeetingCountsByTime] = useState<Record<string, number>>({});
  const [showManagerDropdown, setShowManagerDropdown] = useState(false);
  const managerDropdownRef = useRef<HTMLDivElement>(null);
  const [managerSearchTerm, setManagerSearchTerm] = useState('');
  const [showHelperDropdown, setShowHelperDropdown] = useState(false);
  const helperDropdownRef = useRef<HTMLDivElement>(null);
  const [helperSearchTerm, setHelperSearchTerm] = useState('');
  const navigate = useNavigate();
  const [showUpdateDrawer, setShowUpdateDrawer] = useState(false);
  const [meetingNotes, setMeetingNotes] = useState('');
  const [nextFollowup, setNextFollowup] = useState('');
  const [followup, setFollowup] = useState('');
  const [potentialApplicants, setPotentialApplicants] = useState('');
  const [isSavingUpdate, setIsSavingUpdate] = useState(false);
  const [showMeetingEndedDrawer, setShowMeetingEndedDrawer] = useState(false);
  const [isSavingMeetingEnded, setIsSavingMeetingEnded] = useState(false);
  const [showMeetingIrrelevantModal, setShowMeetingIrrelevantModal] = useState(false);
  const [meetingIrrelevantReason, setMeetingIrrelevantReason] = useState('');
  const [isProcessingMeetingIrrelevant, setIsProcessingMeetingIrrelevant] = useState(false);
  const [latestMeetingDate, setLatestMeetingDate] = useState<string | null>(null);
  const [meetingEndedData, setMeetingEndedData] = useState({
    probability: 50,
    meetingBrief: '',
    numberOfApplicants: 1,
    potentialApplicants: 2,
    proposalTotal: '0.0',
    proposalCurrency: '₪',
    meetingTotal: '0.0',
    meetingTotalCurrency: '₪',
    meetingPaymentForm: '',
    specialNotes: '',
  });
  const [showSendOfferModal, setShowSendOfferModal] = useState(false);
  const [showSignedDrawer, setShowSignedDrawer] = useState(false);
  const [signedDate, setSignedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [showDeclinedDrawer, setShowDeclinedDrawer] = useState(false);
  const [showLeadSummaryDrawer, setShowLeadSummaryDrawer] = useState(false);
  const [showEditLeadDrawer, setShowEditLeadDrawer] = useState(false);
  const [editLeadData, setEditLeadData] = useState({
    tags: selectedClient?.tags || '',
    source: selectedClient?.source || '',
    name: selectedClient?.name || '',
    language: selectedClient?.language || '',
    category: selectedClient?.category || '',
    topic: selectedClient?.topic || '',
    special_notes: selectedClient?.special_notes || '',
    probability: selectedClient?.probability || 0,
    number_of_applicants_meeting: selectedClient?.number_of_applicants_meeting || '',
    potential_applicants_meeting: selectedClient?.potential_applicants_meeting || '',
    balance: selectedClient?.balance || '',
    next_followup: selectedClient?.next_followup || '',
          balance_currency: selectedClient?.balance_currency || '₪',
  });
  // Main categories for Edit Lead drawer
  const [mainCategories, setMainCategories] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [languagesList, setLanguagesList] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<Array<{id: string, front_name: string, iso_code: string, name: string}>>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [currentLeadTags, setCurrentLeadTags] = useState<string>('');

  // --- Mobile Tabs Carousel State ---
  const mobileTabsRef = useRef<HTMLDivElement>(null);
  const desktopTabsRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [isTabsScrollable, setIsTabsScrollable] = useState(false);
  // Remove tabScales and wave zoom effect
  // ---

  // Local loading state for client data
  const [localLoading, setLocalLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);

  // Fetch all employees, categories, and currencies for name lookup
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name, official_name, unavailable_times, unavailable_ranges')
          .order('display_name', { ascending: true });

        if (error) throw error;

        const mapped = (data || [])
          .filter(emp => emp?.id !== null && emp?.id !== undefined)
          .map(emp => {
            const nameCandidates = [
              typeof emp.display_name === 'string' ? emp.display_name.trim() : '',
              typeof (emp as any).official_name === 'string' ? (emp as any).official_name.trim() : '',
            ];
            let displayName =
              nameCandidates.find(
                name => name && !/^\d+$/.test(name) && !name.includes('@') && name.toLowerCase() !== 'null'
              ) || '';
            if (!displayName) {
              displayName = `Employee ${emp.id}`;
            }
              return {
              id: emp.id,
              display_name: displayName,
              unavailable_times: emp.unavailable_times || [],
              unavailable_ranges: emp.unavailable_ranges || [],
            };
          });

        console.log('Clients: Loaded employees for handler dropdown:', mapped.length);
        setAllEmployees(mapped);

        // Build availability map by date for quick lookup
        const availabilityMap: {[key: string]: any[]} = {};
        mapped.forEach(emp => {
          const unavailableTimes = emp.unavailable_times || [];
          const unavailableRanges = emp.unavailable_ranges || [];

          // Process unavailable times
          unavailableTimes.forEach((time: any) => {
            const date = time.date;
            if (!availabilityMap[date]) {
              availabilityMap[date] = [];
            }
            availabilityMap[date].push({
              employeeId: emp.id,
              employeeName: emp.display_name,
              ...time
            });
          });

          // Process unavailable ranges
          unavailableRanges.forEach((range: any) => {
            const startDate = new Date(range.startDate);
            const endDate = new Date(range.endDate);
            const currentDate = new Date(startDate);
            
            while (currentDate <= endDate) {
              const dateString = currentDate.toISOString().split('T')[0];
              if (!availabilityMap[dateString]) {
                availabilityMap[dateString] = [];
              }
              availabilityMap[dateString].push({
                employeeId: emp.id,
                employeeName: emp.display_name,
                date: dateString,
                startTime: 'All Day',
                endTime: 'All Day',
                reason: range.reason,
                isRange: true,
                rangeId: range.id
              });
              
              currentDate.setDate(currentDate.getDate() + 1);
            }
          });
        });

        setEmployeeAvailabilityData(availabilityMap);
      } catch (error) {
        console.error('Clients: Error fetching employees:', error);
        setAllEmployees([]);
      }
    };


    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          `)
          .order('name', { ascending: true });
        
        if (error) {
          console.error('Clients: Error fetching categories:', error);
        } else if (data) {
          // Store the full category data with parent information
          console.log('🔍 Categories loaded successfully:', {
            count: data.length,
            categories: data.map((cat: any) => ({
              id: cat.id,
              name: cat.name,
              parent_id: cat.parent_id,
              mainCategory: cat.misc_maincategory?.name
            }))
          });
          setAllCategories(data);
        }
      } catch (err) {
        console.error('Clients: Exception while fetching categories:', err);
      }
    };
    
    const fetchLanguages = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_language')
          .select('id, name')
          .order('name', { ascending: true });
        
        if (error) {
          console.error('Clients: Error fetching languages:', error);
        } else if (data) {
          setAllLanguages(data);
        }
      } catch (err) {
        console.error('Clients: Exception while fetching languages:', err);
      }
    };
    
    const fetchCountries = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_country')
          .select('id, name, iso_code')
          .order('name', { ascending: true });
        
        if (error) {
          console.error('Clients: Error fetching countries:', error);
        } else if (data) {
          setAllCountries(data);
        }
      } catch (err) {
        console.error('Clients: Exception while fetching countries:', err);
      }
    };

    const fetchCountryCodes = async () => {
      try {
        const { data: countriesData, error: countriesError } = await supabase
          .from('misc_country')
          .select('id, name, phone_code, iso_code, order')
          .not('phone_code', 'is', null)
          .order('order', { ascending: true })
          .order('name', { ascending: true });

        if (!countriesError && countriesData) {
          setCountryCodes(
            countriesData
              .filter(country => country?.phone_code && country?.name)
              .map(country => ({
                code: country.phone_code.startsWith('+') ? country.phone_code : `+${country.phone_code}`,
                country: country.iso_code || '',
                name: country.name
              }))
          );
        }
      } catch (error) {
        console.error('Error fetching country codes:', error);
      }
    };

    const fetchAvailableStages = async () => {
      try {
        const { data, error } = await supabase
          .from('lead_stages')
          .select('id, name, colour')
          .order('id', { ascending: true });
        
        if (error) {
          console.error('Clients: Error fetching stages:', error);
        } else if (data) {
          const normalizedStages = data
            .map(stage => ({
              id: Number(stage.id),
              name: stage.name ?? '',
              colour: stage.colour ?? null,
            }))
            .filter(stage => !Number.isNaN(stage.id));
          setAvailableStages(normalizedStages);
        }
      } catch (err) {
        console.error('Clients: Exception while fetching stages:', err);
      }
    };

    fetchEmployees();
    fetchCategories();
    fetchLanguages();
    fetchCountries();
    fetchCountryCodes();
    fetchAvailableStages();
    // Initialize stage names cache
    fetchStageNames().then(stageNames => {
      // Stage names initialized
    }).catch(error => {
      console.error('❌ Error initializing stage names:', error);
    });
  }, []);

  // Fetch current user's superuser status
  useEffect(() => {
    const fetchSuperuserStatus = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
          setIsSuperuser(false);
          return;
        }

        // Try to find user by auth_id first
        let { data: userData, error } = await supabase
          .from('users')
          .select('is_superuser')
          .eq('auth_id', user.id)
          .maybeSingle();
        
        // If not found by auth_id, try by email
        if (!userData && user.email) {
          const { data: userByEmail, error: emailError } = await supabase
            .from('users')
            .select('is_superuser')
            .eq('email', user.email)
            .maybeSingle();
          
          userData = userByEmail;
          error = emailError;
        }

        if (!error && userData) {
          // Check if user is superuser (handle boolean, string, or number)
          const superuserStatus = userData.is_superuser === true || 
                                  userData.is_superuser === 'true' || 
                                  userData.is_superuser === 1;
          setIsSuperuser(superuserStatus);
        } else {
          setIsSuperuser(false);
        }
      } catch (error) {
        console.error('Error fetching superuser status:', error);
        setIsSuperuser(false);
      }
    };

    fetchSuperuserStatus();
  }, []);

  // Check if desktop tabs are scrollable
  useEffect(() => {
    const checkDesktopTabsScroll = () => {
      const el = desktopTabsRef.current;
      if (!el) {
        setIsTabsScrollable(false);
        return;
      }
      
      const hasScroll = el.scrollWidth > el.clientWidth;
      setIsTabsScrollable(hasScroll);
    };

    // Initial check
    const timeoutId = setTimeout(checkDesktopTabsScroll, 200);
    
    const el = desktopTabsRef.current;
    if (el) {
      // Enable mouse wheel scrolling
      el.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      }, { passive: false });
      
      window.addEventListener('resize', checkDesktopTabsScroll);
      
      // Observe for size changes
      const observer = new ResizeObserver(() => {
        setTimeout(checkDesktopTabsScroll, 100);
      });
      observer.observe(el);
      
      return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('resize', checkDesktopTabsScroll);
        observer.disconnect();
      };
    }
    
    return () => {
      clearTimeout(timeoutId);
    };
  }, [selectedClient]); // Re-check scrollability when client changes (which affects tabs)

  // Check if mobile tabs can scroll
  useEffect(() => {
    const checkScroll = () => {
      const el = mobileTabsRef.current;
      if (!el) {
        setCanScrollRight(false);
        setCanScrollLeft(false);
        return;
      }
      
      const hasScroll = el.scrollWidth > el.clientWidth;
      const scrollLeft = el.scrollLeft;
      const maxScroll = el.scrollWidth - el.clientWidth;
      
      const shouldShowRight = hasScroll && scrollLeft < maxScroll - 5;
      const shouldShowLeft = hasScroll && scrollLeft > 5;
      
      setCanScrollRight(shouldShowRight);
      setCanScrollLeft(shouldShowLeft);
      
      // Debug log (remove in production)
      if (hasScroll) {
        console.log('📜 Mobile tabs scroll check:', {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          scrollLeft,
          maxScroll,
          canScrollRight: shouldShowRight,
          canScrollLeft: shouldShowLeft
        });
      }
    };

    // Initial check with delay to ensure tabs are rendered
    const timeoutId = setTimeout(checkScroll, 200);
    
    const el = mobileTabsRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
      window.addEventListener('resize', checkScroll);
    }

    // Also check when tabs change - observe the inner flex container
    const observer = new ResizeObserver(() => {
      // Small delay to ensure DOM is updated
      setTimeout(checkScroll, 100);
    });
    if (el) {
      observer.observe(el);
      // Also observe the inner flex container if it exists
      const innerContainer = el.querySelector('.flex.gap-2');
      if (innerContainer) {
        observer.observe(innerContainer);
      }
    }

    // Use MutationObserver to detect when tab buttons are added/removed
    const mutationObserver = new MutationObserver(() => {
      setTimeout(checkScroll, 100);
    });
    if (el) {
      mutationObserver.observe(el, { childList: true, subtree: true });
    }

    return () => {
      clearTimeout(timeoutId);
      if (el) {
        el.removeEventListener('scroll', checkScroll);
      }
      window.removeEventListener('resize', checkScroll);
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, []); // Empty deps - observers handle all updates
  
  const lastCategoryRefreshIds = useRef<Set<string>>(new Set());
  const isBalanceUpdatingRef = useRef<boolean>(false);
  
  // State for unactivation modal
  const [showUnactivationModal, setShowUnactivationModal] = useState(false);
  const [unactivationReason, setUnactivationReason] = useState('');
  const [customUnactivationReason, setCustomUnactivationReason] = useState('');
  
  // State for activation modal
  const [showActivationModal, setShowActivationModal] = useState(false);

  // State for delete confirmation modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeletingLead, setIsDeletingLead] = useState(false);

  // Helper function to get tomorrow's date in YYYY-MM-DD format (moved here for use in state initialization)
  const getTomorrowDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  // 1. Add state for the rescheduling drawer and meetings list
  const [showRescheduleDrawer, setShowRescheduleDrawer] = useState(false);
  const [hasScheduledMeetings, setHasScheduledMeetings] = useState(false);
  const [nextMeetingDate, setNextMeetingDate] = useState<string | null>(null);
  const [rescheduleMeetings, setRescheduleMeetings] = useState<any[]>([]);
  const [rescheduleFormData, setRescheduleFormData] = useState<any>({
    date: getTomorrowDate(), // Default to tomorrow so button is enabled
    time: '09:00',
    location: 'Teams',
    calendar: 'current',
    manager: '',
    helper: '',
    amount: '',
    currency: 'NIS',
    attendance_probability: 'Medium',
    complexity: 'Simple',
    car_number: '',
  });
  const [meetingToDelete, setMeetingToDelete] = useState<number | null>(null);
  const [rescheduleOption, setRescheduleOption] = useState<'cancel' | 'reschedule'>('cancel');
  // Toggle for notifying client via email when rescheduling a meeting
  const [notifyClientOnReschedule, setNotifyClientOnReschedule] = useState(false);
  const [isReschedulingMeeting, setIsReschedulingMeeting] = useState(false);
  const [rescheduleMeetingCountsByTime, setRescheduleMeetingCountsByTime] = useState<Record<string, number>>({});
  
  // State for sticky header on scroll
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const scrollThreshold = 100; // Show sticky header after scrolling 100px

  // 1. Add state for the payments plan drawer
  const [showPaymentsPlanDrawer, setShowPaymentsPlanDrawer] = useState(false);
  const [editingBalance, setEditingBalance] = useState(false);
  const [editedBalance, setEditedBalance] = useState(selectedClient?.balance || 0);
  const [autoPlan, setAutoPlan] = useState('');
  const autoPlanOptions = [
    '', // Default empty option
    '40/30/30',
    '50/30/20',
    '34/33/33',
    '60/20/20',
    '70/20/10',
    '50/25/25',
  ];
  const [payments, setPayments] = useState<any[]>([]);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [nextDuePayment, setNextDuePayment] = useState<any>(null);
  const [newPayment, setNewPayment] = useState({
    client: '',
    order: 'Intermediate Payment',
    date: '',
    currency: '₪',
    value: 0.0,
    duePercent: '',
    applicants: '',
    notes: '',
  });

  // 1. Add state for the Success drawer and its form fields
  const [showSuccessDrawer, setShowSuccessDrawer] = useState(false);
  const [successForm, setSuccessForm] = useState<ClientSignedForm>({
    fileId: '',
    handlerId: '',
    handler: '',
    currency: '₪',
    numApplicants: '',
    proposal: '',
    potentialValue: '',
  });
  const [schedulerOptions, setSchedulerOptions] = useState<string[]>([]);
  const [schedulerSearchTerm, setSchedulerSearchTerm] = useState('');
  const [filteredSchedulerOptions, setFilteredSchedulerOptions] = useState<string[]>([]);
  const [showSchedulerDropdown, setShowSchedulerDropdown] = useState(false);
const [handlerSearchTerm, setHandlerSearchTerm] = useState('');
const [filteredHandlerSearchOptions, setFilteredHandlerSearchOptions] = useState<HandlerOption[]>([]);
const [showHandlerSearchDropdown, setShowHandlerSearchDropdown] = useState(false);
const handlerSearchContainerRef = useRef<HTMLDivElement | null>(null);
const [successStageHandlerSearch, setSuccessStageHandlerSearch] = useState('');
const [filteredSuccessStageHandlerOptions, setFilteredSuccessStageHandlerOptions] = useState<HandlerOption[]>([]);
const [showSuccessStageHandlerDropdown, setShowSuccessStageHandlerDropdown] = useState(false);
const successStageHandlerContainerRef = useRef<HTMLDivElement | null>(null); // Mobile ref
const successStageHandlerContainerRefDesktop = useRef<HTMLDivElement | null>(null); // Desktop ref
const [isUpdatingSuccessStageHandler, setIsUpdatingSuccessStageHandler] = useState(false);

  // Mobile edge dropdowns state
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMobileStagesDropdown, setShowMobileStagesDropdown] = useState(false);
  const [showMobileActionsDropdown, setShowMobileActionsDropdown] = useState(false);
  const [showMobileClientInfo, setShowMobileClientInfo] = useState(false);

  // State and helpers for lead stages
  const [availableStages, setAvailableStages] = useState<Array<{ id: number; name: string; colour?: string | null }>>([]);
  type StageDropdownAnchor = 'badge' | 'desktop' | 'mobile';
  const [stageDropdownAnchor, setStageDropdownAnchor] = useState<StageDropdownAnchor | null>(null);
  const badgeStageDropdownRef = useRef<HTMLDivElement | null>(null);
  const desktopStageDropdownRef = useRef<HTMLDivElement | null>(null);
  const mobileStageDropdownRef = useRef<HTMLDivElement | null>(null);
  const badgeStageListRef = useRef<HTMLDivElement | null>(null);
  const desktopStageListRef = useRef<HTMLDivElement | null>(null);
  const mobileStageListRef = useRef<HTMLDivElement | null>(null);

  // Close stage dropdown if user is not a superuser
  useEffect(() => {
    if (!isSuperuser && stageDropdownAnchor !== null) {
      setStageDropdownAnchor(null);
    }
  }, [isSuperuser, stageDropdownAnchor]);

  const getDropdownRef = (anchor: StageDropdownAnchor) => {
    switch (anchor) {
      case 'badge':
        return badgeStageDropdownRef;
      case 'desktop':
        return desktopStageDropdownRef;
      case 'mobile':
        return mobileStageDropdownRef;
      default:
        return badgeStageDropdownRef;
    }
  };

  const getListRef = (anchor: StageDropdownAnchor) => {
    switch (anchor) {
      case 'badge':
        return badgeStageListRef;
      case 'desktop':
        return desktopStageListRef;
      case 'mobile':
        return mobileStageListRef;
      default:
        return badgeStageListRef;
    }
  };

  const stageIdMap = useMemo(() => {
    const map = new Map<string, number>();
    availableStages.forEach(stage => {
      if (!stage) return;
      const { id, name } = stage;
      if (id !== undefined && id !== null && !Number.isNaN(Number(id))) {
        const numericId = Number(id);
        map.set(normalizeStageName(String(id)), numericId);
      }
      if (name) {
        const numericId = Number(id);
        if (!Number.isNaN(numericId)) {
          map.set(normalizeStageName(name), numericId);
        }
      }
    });
    return map;
  }, [availableStages]);

  const stageAliasMap = useMemo<Record<string, string>>(
    () => ({
      financesandpaymentsplan: 'financespaymentsplan',
      meetingpaid: 'meetingcomplete',
      paidmeeting: 'meetingcomplete',
      clientdeclined: 'clientdeclinedpriceoffer',
    }),
    []
  );

  const manualStageIdFallbacks = useMemo<Record<string, number>>(
    () => ({
      created: 0,
      schedulerassigned: 10,
      precommunication: 11,
      communicationstarted: 15,
      meetingscheduled: 20,
      meetingrescheduled: 21,
      meetingcomplete: 30,
      meetingirrelevant: 35,
      waitingformtngsum: 40,
      mtngsumagreementsent: 50,
      clientdeclinedpriceoffer: 51,
      clientdeclined: 51,
      anothermeeting: 55,
      clientsignedagreement: 60,
      paymentrequestsent: 70,
      droppedspamirrelevant: 91,
      success: 100,
      handlerset: 105,
      handlerstarted: 110,
      applicationsubmitted: 150,
      caseclosed: 200,
    }),
    []
  );

  const sortedStages = useMemo(
    () =>
      (availableStages || [])
        .slice()
        .sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0)),
    [availableStages]
  );

  const resolveStageId = useCallback(
    (value: string | number | null | undefined): number | null => {
      if (value === null || value === undefined) {
        return null;
      }

      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
      }

      const strValue = String(value).trim();
      if (!strValue) {
        return null;
      }

      const directNumeric = Number(strValue);
      if (!Number.isNaN(directNumeric) && Number.isFinite(directNumeric)) {
        return directNumeric;
      }

      const normalized = normalizeStageName(strValue);

      if (stageIdMap.has(normalized)) {
        return stageIdMap.get(normalized) ?? null;
      }

      const aliasTarget = stageAliasMap[normalized];
      if (aliasTarget && stageIdMap.has(aliasTarget)) {
        return stageIdMap.get(aliasTarget) ?? null;
      }

      if (manualStageIdFallbacks[normalized] !== undefined) {
        return manualStageIdFallbacks[normalized];
      }

      console.warn('Unable to resolve stage identifier to numeric ID', { value, normalized });
      return null;
    },
    [stageAliasMap, stageIdMap, manualStageIdFallbacks]
  );

  useEffect(() => {
    if (!stageDropdownAnchor) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const dropdownRefs = [badgeStageDropdownRef, desktopStageDropdownRef, mobileStageDropdownRef];
      const clickedInside = dropdownRefs.some(ref => ref.current?.contains(target));
      if (!clickedInside) {
        setStageDropdownAnchor(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [stageDropdownAnchor]);

  useEffect(() => {
    if (!stageDropdownAnchor) return;
    const listRef = getListRef(stageDropdownAnchor).current;
    if (!listRef) return;

    const currentStageId = resolveStageId(selectedClient?.stage);
    const currentStageIndex = sortedStages.findIndex(
      stageOption => resolveStageId(stageOption.id) === currentStageId
    );

    if (currentStageIndex < 0) return;

    listRef.scrollTop = 0;
  }, [stageDropdownAnchor, selectedClient?.stage, sortedStages, resolveStageId]);

  const getStageIdOrWarn = useCallback(
    (alias: string | number): number | null => {
      const resolved = resolveStageId(alias);
      if (resolved === null) {
        console.warn('Unable to resolve stage alias to numeric ID', { alias, availableStages });
      }
      return resolved;
    },
    [availableStages, resolveStageId]
  );

  const normalizeClientStage = useCallback(
    (client: any) => {
      if (!client) return client;
      const resolved = resolveStageId(client.stage);
      if (resolved !== null) {
        return { ...client, stage: resolved };
      }
      return client;
    },
    [resolveStageId]
  );

  const droppedStageId = useMemo(
    () => getStageIdOrWarn('Dropped (Spam/Irrelevant)') ?? 91,
    [getStageIdOrWarn]
  );

  // State for unactivated lead view
  const [isUnactivatedView, setIsUnactivatedView] = useState(false);
  const [userManuallyExpanded, setUserManuallyExpanded] = useState(false);

  // Debug isUnactivatedView changes
  useEffect(() => {
    // isUnactivatedView changed
  }, [isUnactivatedView]);

  // Check selectedClient prop and set isUnactivatedView accordingly
  // Consolidated into a single useEffect to prevent conflicts
  const prevClientIdRef = useRef<string | undefined>();
  const isSettingUpClientRef = useRef(false); // Flag to prevent useEffect from interfering during setup
  
  useEffect(() => {
    // Skip if we're in the middle of setting up a client
    if (isSettingUpClientRef.current) {
      console.log('🔍 useEffect: Skipping - client setup in progress');
      return;
    }

    if (!selectedClient) {
      setIsUnactivatedView(false);
      prevClientIdRef.current = undefined;
      return;
    }

    const currentClientId = selectedClient.id?.toString();
    // Reset userManuallyExpanded when a new client is selected (only if client ID actually changed)
    if (currentClientId && prevClientIdRef.current !== currentClientId) {
      setUserManuallyExpanded(false);
      prevClientIdRef.current = currentClientId;
    }

    try {
      const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      // Check unactivation status based on status column
      // Only show unactivated box for new leads (not legacy leads)
      const statusValue = (selectedClient as any).status;
      const isUnactivated = !isLegacy && (statusValue === 'inactive');

      console.log('🔍 useEffect: Checking unactivation status', {
        currentClientId,
        isLegacy,
        statusValue,
        isUnactivated,
        userManuallyExpanded,
        currentIsUnactivatedView: isUnactivatedView,
        isSettingUpClient: isSettingUpClientRef.current
      });

      // Always update to match the actual status, but only if user hasn't manually expanded
      // This ensures the state is always in sync with the actual data
      if (!userManuallyExpanded) {
        setIsUnactivatedView(isUnactivated);
      } else if (!isUnactivated) {
        // If lead is no longer unactivated, reset the expanded state
        setUserManuallyExpanded(false);
        setIsUnactivatedView(false);
      }
    } catch (error) {
      console.error('Error checking unactivation status in useEffect:', error);
      setIsUnactivatedView(false);
    }
  }, [selectedClient?.id, selectedClient?.lead_type, (selectedClient as any)?.status, userManuallyExpanded]);

  // Check if lead is in highlights
  useEffect(() => {
    const checkHighlightStatus = async () => {
      if (!selectedClient?.id) {
        setIsInHighlightsState(false);
        return;
      }

      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof selectedClient.id === 'string' ? parseInt(selectedClient.id.replace('legacy_', '')) : selectedClient.id)
        : selectedClient.id;

      const highlighted = await isInHighlights(leadId, isLegacyLead);
      setIsInHighlightsState(highlighted);
    };

    checkHighlightStatus();
  }, [selectedClient?.id, selectedClient?.lead_type]);

  // Listen for highlight changes
  useEffect(() => {
    const handleHighlightChange = () => {
      if (selectedClient?.id) {
        const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
        const leadId = isLegacyLead 
          ? (typeof selectedClient.id === 'string' ? parseInt(selectedClient.id.replace('legacy_', '')) : selectedClient.id)
          : selectedClient.id;
        isInHighlights(leadId, isLegacyLead).then(setIsInHighlightsState);
      }
    };

    window.addEventListener('highlights:added', handleHighlightChange);
    window.addEventListener('highlights:removed', handleHighlightChange);

    return () => {
      window.removeEventListener('highlights:added', handleHighlightChange);
      window.removeEventListener('highlights:removed', handleHighlightChange);
    };
  }, [selectedClient?.id, selectedClient?.lead_type]);

  // Update newPayment currency when selected client changes
  useEffect(() => {
    if (selectedClient) {
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      let currency = '₪'; // Default
      
      if (isLegacyLead) {
        // For legacy leads, use balance_currency
        currency = selectedClient.balance_currency || '₪';
      } else {
        // For new leads, use proposal_currency or default
        currency = selectedClient.proposal_currency || '₪';
      }
      
      setNewPayment(prev => ({ ...prev, currency }));
    }
  }, [selectedClient]);

  // Populate scheduler options with all active employees
  useEffect(() => {
    if (allEmployees && allEmployees.length > 0) {
      const uniqueNames = Array.from(
        new Set(
          allEmployees
            .map(emp => (typeof emp.display_name === 'string' ? emp.display_name.trim() : ''))
            .filter(name => name && !/^\d+$/.test(name))
        )
      ).sort((a, b) => a.localeCompare(b));
      setSchedulerOptions(uniqueNames);
      setFilteredSchedulerOptions(uniqueNames);
    } else {
      setSchedulerOptions([]);
      setFilteredSchedulerOptions([]);
    }
  }, [allEmployees]);
  useEffect(() => {
    const search = schedulerSearchTerm.trim().toLowerCase();
    if (!search) {
      setFilteredSchedulerOptions(schedulerOptions);
    } else {
      setFilteredSchedulerOptions(
        schedulerOptions.filter(option => option.toLowerCase().includes(search))
      );
    }
  }, [schedulerSearchTerm, schedulerOptions]);

useEffect(() => {
  if (!showSchedulerDropdown) return;
  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[data-assign-dropdown="true"]')) {
      setShowSchedulerDropdown(false);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => {
    document.removeEventListener('mousedown', handleClickOutside);
  };
}, [showSchedulerDropdown]);

useEffect(() => {
  if (!selectedClient) {
    setSchedulerSearchTerm('');
    setFilteredSchedulerOptions(schedulerOptions);
    return;
  }
  const schedulerName =
    selectedClient.scheduler && typeof selectedClient.scheduler === 'string'
      ? selectedClient.scheduler
      : '';

  // If scheduler is "---" or empty, set search term to empty (will show as placeholder)
  const displayValue = (schedulerName && schedulerName.trim() !== '' && schedulerName !== '---') 
    ? schedulerName 
    : '';

  setSchedulerSearchTerm(displayValue);
  setFilteredSchedulerOptions(schedulerOptions);
}, [selectedClient, schedulerOptions]);


  // Helper to convert lead number to case number
  // Helper function to get display lead number (shows "C" prefix in UI when stage is Success/100)
  const getDisplayLeadNumber = (lead: any): string => {
    if (!lead) return '---';
    let displayNumber = lead.lead_number || lead.manual_id || lead.id || '---';
    
    // Remove any existing / suffix for processing (we'll add /1 if needed)
    const displayStr = displayNumber.toString();
    const hasExistingSuffix = displayStr.includes('/');
    
    // For master leads, we want to show /1, so strip any existing suffix first
    let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;
    
    const isSuccessStage = lead.stage === '100' || lead.stage === 100;
    // Show "C" prefix in UI for both new and legacy leads when stage is Success (100)
    if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
      // Replace "L" prefix with "C" for display only
      baseNumber = baseNumber.toString().replace(/^L/, 'C');
    }
    
    // Add /1 suffix to master leads (frontend only)
    // A lead is a master if: it has no master_id AND (isMasterLead is true OR has sub-leads)
    const hasNoMasterId = !lead.master_id || String(lead.master_id).trim() === '';
    const hasSubLeads = subLeads && subLeads.length > 0;
    // Use isMasterLead state or check subLeads array - either indicates it's a master lead
    const shouldAddSuffix = hasNoMasterId && (isMasterLead || hasSubLeads);
    
    if (shouldAddSuffix) {
      displayNumber = `${baseNumber}/1`;
    } else {
      displayNumber = baseNumber;
    }
    
    return displayNumber.toString();
  };

  // Handler for Payment Received - new Client !!!
  const handlePaymentReceivedNewClient = () => {
    if (!selectedClient) return;
    const defaultCurrency =
      selectedClient.proposal_currency ||
      selectedClient.balance_currency ||
      '₪';

    const existingHandlerId =
      selectedClient.case_handler_id != null
        ? String(selectedClient.case_handler_id)
        : '';

    const existingHandlerName =
      (existingHandlerId && handlerOptionsMap.get(existingHandlerId)) ||
      selectedClient.handler ||
      '';

    setSuccessForm({
      fileId: selectedClient.file_id || '',
      handlerId: existingHandlerId,
      handler: existingHandlerName,
      currency: defaultCurrency || '₪',
      numApplicants: selectedClient.number_of_applicants_meeting
        ? String(selectedClient.number_of_applicants_meeting)
        : '',
      proposal: selectedClient.proposal_total
        ? String(selectedClient.proposal_total)
        : '',
      potentialValue: selectedClient.potential_value
        ? String(selectedClient.potential_value)
        : '',
    });

    setShowSuccessDrawer(true);
  };

  // Handler to save Success drawer
  const handleSaveSuccessDrawer = async () => {
    if (!selectedClient) return;
    try {
      const numApplicants =
        successForm.numApplicants.trim() === ''
          ? null
          : Number(successForm.numApplicants);
      const proposal =
        successForm.proposal.trim() === ''
          ? null
          : Number(successForm.proposal);
      const potentialValue =
        successForm.potentialValue.trim() === ''
          ? null
          : Number(successForm.potentialValue);
      const fileId = successForm.fileId.trim() === '' ? null : successForm.fileId.trim();

      if (
        (successForm.numApplicants && Number.isNaN(Number(successForm.numApplicants))) ||
        (successForm.proposal && Number.isNaN(Number(successForm.proposal))) ||
        (successForm.potentialValue && Number.isNaN(Number(successForm.potentialValue)))
      ) {
        toast.error('Please enter valid numeric values.');
        return;
      }

      const successStageId = resolveStageId('Success');
      if (successStageId === null) {
        toast.error('Unable to resolve "Success" stage. Please contact an administrator.');
        return;
      }

      const actor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();

      const isLegacyLead =
        selectedClient.lead_type === 'legacy' ||
        selectedClient.id?.toString().startsWith('legacy_');

      const handlerIdNumeric =
        successForm.handlerId && successForm.handlerId.trim() !== ''
          ? Number.parseInt(successForm.handlerId, 10)
          : null;

      const handlerName =
        successForm.handler ||
        (handlerIdNumeric != null
          ? handlerOptionsMap.get(String(handlerIdNumeric)) || ''
          : '');

      if (isLegacyLead) {
        const legacyId = selectedClient.id
          .toString()
          .replace('legacy_', '');

        const mapCurrencyToLegacyId = (value: string | null | undefined) => {
          switch ((value || '').trim()) {
            case '₪':
            case 'ILS':
            case 'NIS':
              return 1;
            case '$':
            case 'USD':
              return 3;
            case '€':
            case 'EUR':
              return 2;
            case '£':
            case 'GBP':
              return 4;
            default:
              return 1;
          }
        };

      const updateData: any = {
        file_id: fileId,
        case_handler_id: handlerIdNumeric,
        stage: successStageId,
        stage_changed_by: actor.fullName,
        stage_changed_at: stageTimestamp,
        no_of_applicants: numApplicants,
        total: proposal,
        potential_total: potentialValue,
        currency_id: mapCurrencyToLegacyId(successForm.currency),
      };

        const { error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);

        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: successStageId,
          actor,
          timestamp: stageTimestamp,
        });

        setSelectedClient((prev: any) => ({
          ...prev,
          stage: successStageId,
          // Don't update lead_number - keep original "L" prefix in database
          proposal_currency: successForm.currency,
          number_of_applicants_meeting: numApplicants ?? prev?.number_of_applicants_meeting,
          proposal_total: proposal ?? prev?.proposal_total,
          potential_value: potentialValue ?? prev?.potential_value,
          file_id: fileId ?? prev?.file_id,
          case_handler_id: handlerIdNumeric ?? prev?.case_handler_id,
          handler: handlerName || prev?.handler,
          closer: handlerName || prev?.closer,
          balance: proposal ?? prev?.balance,
          balance_currency: successForm.currency || prev?.balance_currency,
        }));

        await refreshClientData(selectedClient.id);
      } else {
        const updateData: any = {
          stage: successStageId,
          // Don't update lead_number - keep original "L" prefix in database, only show "C" in UI
          file_id: fileId,
          proposal_currency: successForm.currency,
        balance_currency: successForm.currency,
        number_of_applicants_meeting: numApplicants,
        proposal_total: proposal,
        potential_value: potentialValue,
        balance: proposal,
          stage_changed_by: actor.fullName,
          stage_changed_at: stageTimestamp,
        };

        if (handlerName) {
          updateData.handler = handlerName;
          updateData.closer = handlerName;
        }
        if (handlerIdNumeric != null && !Number.isNaN(handlerIdNumeric)) {
          updateData.case_handler_id = handlerIdNumeric;
        }

      const { error } = await supabase
        .from('leads')
        .update(updateData)
        .eq('id', selectedClient.id);
      
      if (error) throw error;

      await recordLeadStageChange({
        lead: selectedClient,
        stage: successStageId,
        actor,
        timestamp: stageTimestamp,
      });
      
      setSelectedClient((prev: any) => ({
        ...prev,
        stage: successStageId,
          // Don't update lead_number - keep original "L" prefix in database, only show "C" in UI
        proposal_currency: successForm.currency,
        number_of_applicants_meeting: numApplicants,
        proposal_total: proposal,
        potential_value: potentialValue,
          file_id: fileId ?? prev?.file_id,
          handler: handlerName || prev?.handler,
          case_handler_id:
            handlerIdNumeric != null ? handlerIdNumeric : prev?.case_handler_id,
          closer: handlerName || prev?.closer,
          balance: proposal ?? prev?.balance,
          balance_currency: successForm.currency || prev?.balance_currency,
        }));

      await refreshClientData(selectedClient.id);
      }
      
      setShowSuccessDrawer(false);
      toast.success('Lead updated to Success!');
    } catch (error) {
      console.error('Error updating lead:', error);
      toast.error('Failed to update lead.');
    }
  };
  // Check for scheduled meetings (upcoming, not canceled)
  useEffect(() => {
    const checkScheduledMeetings = async () => {
      if (!selectedClient?.id) {
        setHasScheduledMeetings(false);
        setNextMeetingDate(null);
        return;
      }
      
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      const today = new Date().toISOString().split('T')[0];
      
      let query = supabase
        .from('meetings')
        .select('id, meeting_date, status')
        .gte('meeting_date', today)
        .or('status.is.null,status.neq.canceled')
        .order('meeting_date', { ascending: true });
      
      if (isLegacyLead) {
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        query = query.eq('legacy_lead_id', legacyId);
      } else {
        query = query.eq('client_id', selectedClient.id);
      }
      
      const { data, error } = await query.limit(1);
      
      if (!error && data && data.length > 0) {
        setHasScheduledMeetings(true);
        setNextMeetingDate(data[0].meeting_date);
      } else {
        setHasScheduledMeetings(false);
        setNextMeetingDate(null);
      }
    };
    
    checkScheduledMeetings();
  }, [selectedClient?.id]);

  // Add useEffect to fetch meetings when reschedule drawer opens
  useEffect(() => {
    const fetchMeetings = async () => {
      if (!selectedClient?.id || !showRescheduleDrawer) return;
      
      // Check if this is a legacy lead
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      
      // Get today's date in YYYY-MM-DD format for filtering
      const today = new Date().toISOString().split('T')[0];
      
      let query = supabase
        .from('meetings')
        .select('*')
        .neq('status', 'canceled') // Only fetch non-canceled meetings
        .gte('meeting_date', today); // Only fetch upcoming meetings (today and future)
      
      if (isLegacyLead) {
        const legacyIdStr = selectedClient.id.toString().replace('legacy_', '');
        // Convert to number for legacy_lead_id (it's a bigint in the database)
        const numericLegacyId = /^\d+$/.test(legacyIdStr) ? parseInt(legacyIdStr, 10) : legacyIdStr;
        query = query.eq('legacy_lead_id', numericLegacyId);
      } else {
        query = query.eq('client_id', selectedClient.id);
      }
      
      const { data, error } = await query.order('meeting_date', { ascending: true });
      
      if (!error && data) setRescheduleMeetings(data);
      else setRescheduleMeetings([]);
    };
    fetchMeetings();
  }, [selectedClient, showRescheduleDrawer]);

  // Fetch meeting counts by time for the selected date in reschedule drawer
  useEffect(() => {
    const fetchRescheduleMeetingCounts = async () => {
      if (!rescheduleFormData.date) {
        setRescheduleMeetingCountsByTime({});
        return;
      }

      try {
        // Fetch all meetings for the selected date
        const { data: meetings, error } = await supabase
          .from('meetings')
          .select('meeting_time')
          .eq('meeting_date', rescheduleFormData.date)
          .or('status.is.null,status.neq.canceled');

        if (error) {
          console.error('Error fetching reschedule meeting counts:', error);
          setRescheduleMeetingCountsByTime({});
          return;
        }

        // Count meetings by time slot
        const counts: Record<string, number> = {};
        if (meetings) {
          meetings.forEach((meeting: any) => {
            if (meeting.meeting_time) {
              // Extract time in HH:MM format (handle both TIME and TIMESTAMP formats)
              const timeStr = typeof meeting.meeting_time === 'string' 
                ? meeting.meeting_time.substring(0, 5) 
                : new Date(meeting.meeting_time).toTimeString().substring(0, 5);
              counts[timeStr] = (counts[timeStr] || 0) + 1;
            }
          });
        }

        setRescheduleMeetingCountsByTime(counts);
      } catch (error) {
        console.error('Error fetching reschedule meeting counts:', error);
        setRescheduleMeetingCountsByTime({});
      }
    };

    fetchRescheduleMeetingCounts();
  }, [rescheduleFormData.date]);


  // Handle scroll detection for sticky header
  useEffect(() => {
    if (!selectedClient) {
      setShowStickyHeader(false);
      return;
    }

    const handleScroll = () => {
      // Check both window scroll and main element scroll
      const windowScrollY = window.scrollY || window.pageYOffset || 0;
      
      // Also check the main element scroll (since App.tsx has overflow-y-auto on main)
      const mainElement = document.querySelector('main');
      const mainScrollTop = mainElement ? mainElement.scrollTop : 0;
      
      // Use whichever is greater (handles both cases)
      const scrollY = Math.max(windowScrollY, mainScrollTop);
      
      const shouldShow = scrollY > scrollThreshold;
      setShowStickyHeader(shouldShow);
    };

    // Initial check after a small delay to ensure DOM is ready
    const timeoutId = setTimeout(handleScroll, 100);

    // Listen to both window and main element scroll
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    const mainElement = document.querySelector('main');
    if (mainElement) {
      mainElement.addEventListener('scroll', handleScroll, { passive: true });
    }
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('scroll', handleScroll);
      const mainEl = document.querySelector('main');
      if (mainEl) {
        mainEl.removeEventListener('scroll', handleScroll);
      }
    };
  }, [scrollThreshold, selectedClient]);

  const onClientUpdate = useCallback(async () => {
    if (!selectedClient?.id) return;
    
    // Refresh scheduled meetings check
    const checkScheduledMeetings = async () => {
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      const today = new Date().toISOString().split('T')[0];
      
      let query = supabase
        .from('meetings')
        .select('id, meeting_date, status')
        .gte('meeting_date', today)
        .or('status.is.null,status.neq.canceled')
        .order('meeting_date', { ascending: true });
      
      if (isLegacyLead) {
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        query = query.eq('legacy_lead_id', legacyId);
      } else {
        query = query.eq('client_id', selectedClient.id);
      }
      
      const { data, error } = await query.limit(1);
      
      if (!error && data && data.length > 0) {
        setHasScheduledMeetings(true);
        setNextMeetingDate(data[0].meeting_date);
      } else {
        setHasScheduledMeetings(false);
        setNextMeetingDate(null);
      }
    };
    
    await checkScheduledMeetings();
    
    // Skip if balance is being updated - refreshClientData will handle it
    if (isBalanceUpdatingRef.current) {
      console.log('⏸️ Skipping onClientUpdate - balance update in progress (from callback)');
      return;
    }

    // Check if this is a legacy lead
    const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');

    try {
      let data;
      let error;

      if (isLegacyLead) {
        // For legacy leads, fetch from leads_lead table with currency information
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        const { data: legacyData, error: legacyError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            lead_number,
            manual_id,
            master_id,
            name,
            email,
            phone,
            mobile,
            topic,
            stage,
            cdate,
            udate,
            notes,
            special_notes,
            next_followup,
            probability,
            eligibile,
            source_id,
            category,
            category_id,
            language_id,
            total,
            currency_id,
            closer_id,
            case_handler_id,
            vat,
            meeting_scheduler_id,
            meeting_manager_id,
            meeting_lawyer_id,
            expert_id,
            unactivation_reason,
            no_of_applicants,
            potential_total,
            status,
            sales_roles_locked,
            reason_id,
            unactivated_by,
            unactivated_at,
            master_id,
            manual_id,
            description,
            description_last_edited_by,
            description_last_edited_at,
            special_notes_last_edited_by,
            special_notes_last_edited_at,
            misc_language!leads_lead_language_id_fkey (
              name
            ),
            accounting_currencies!leads_lead_currency_id_fkey (
              name,
              iso_code
            )
          `)
          .eq('id', legacyId)
          .single();

        data = legacyData;
        error = legacyError;

        if (data) {
          // Fetch source name separately since the foreign key relationship doesn't exist
          let sourceName = '';
          if (data.source_id) {
            const { data: sourceData } = await supabase
              .from('misc_leadsource')
              .select('name')
              .eq('id', data.source_id)
              .maybeSingle();
            sourceName = sourceData?.name || '';
          }
          
          const legacyLanguageRecord = Array.isArray(data.misc_language)
            ? data.misc_language[0]
            : data.misc_language;
          const legacyCurrencyRecord = Array.isArray(data.accounting_currencies)
            ? data.accounting_currencies[0]
            : data.accounting_currencies;

          // Calculate sub-lead suffix if this is a sub-lead (has master_id)
          let subLeadSuffix: number | undefined;
          if (data.master_id) {
            const { data: existingSubLeads } = await supabase
              .from('leads_lead')
              .select('id')
              .eq('master_id', data.master_id)
              .not('master_id', 'is', null)
              .order('id', { ascending: true });
            
            if (existingSubLeads) {
              const currentLeadIndex = existingSubLeads.findIndex(sub => sub.id === data.id);
              // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
              subLeadSuffix = currentLeadIndex >= 0 ? currentLeadIndex + 2 : existingSubLeads.length + 2;
            }
          }

          // Transform legacy lead to match new lead structure
          const legacyStageId = resolveStageId(data.stage);
          // Extract language name from joined table - ensure we get the name, not the ID
          let languageName = '';
          if (legacyLanguageRecord?.name) {
            languageName = legacyLanguageRecord.name;
          } else if (data.language_id) {
            // If join failed, fetch language name directly by language_id
            console.warn('⚠️ Language join failed, fetching language name directly for language_id:', data.language_id);
            try {
              const { data: langData } = await supabase
                .from('misc_language')
                .select('name')
                .eq('id', data.language_id)
                .maybeSingle();
              if (langData?.name) {
                languageName = langData.name;
              }
            } catch (langError) {
              console.error('Error fetching language name:', langError);
            }
          }
          
          // Create transformed data by explicitly selecting only the fields we want
          // This ensures unwanted fields (description, tracking fields, language_id) are never included
          const transformedData = {
            id: `legacy_${data.id}`,
            name: data.name || '',
            email: data.email || '',
            phone: data.phone || '',
            mobile: data.mobile || '',
            topic: data.topic || '',
            lead_number: formatLegacyLeadNumber(data, subLeadSuffix), // Format lead number with /1 for master, /X for sub-leads
            stage: legacyStageId ?? (typeof data.stage === 'number' ? data.stage : null),
            source: sourceName || String(data.source_id || ''), // Get source name from separate query
            created_at: data.cdate,
            updated_at: data.udate,
            notes: data.notes || '',
            special_notes: data.special_notes || '',
            next_followup: data.next_followup || '',
            probability: data.probability !== null && data.probability !== undefined ? Number(data.probability) : 0,
            category: (() => {
              console.log('🔍 Processing new lead category - raw data:', { 
                category_id: data.category_id, 
                category: data.category,
                allCategoriesLoaded: allCategories.length > 0,
                allCategories: allCategories.map(cat => ({ id: cat.id, name: cat.name }))
              });
              const categoryName = getCategoryName(data.category_id, data.category);
              console.log('🔍 Processing new lead category result:', { category_id: data.category_id, category_name: categoryName });
              return categoryName;
            })(),
            language: languageName, // Always use the language name (never use ID)
            balance: String(data.total || ''), // Map total to balance
            balance_currency: (() => {
              // Use accounting_currencies name if available, otherwise fallback
              if (legacyCurrencyRecord?.name) {
                return legacyCurrencyRecord.name;
              } else {
                // Fallback currency mapping based on currency_id
                switch (data.currency_id) {
                  case 1: return '₪';
                  case 2: return '€';
                  case 3: return '$';
                  case 4: return '£';
                  default: return '₪';
                }
              }
            })(),
            lead_type: 'legacy',
            // Add missing fields with defaults
            client_country: null,
            emails: [],
            closer: data.closer_id, // Use closer_id from legacy table
            closer_id: data.closer_id || null, // Include closer_id for RolesTab
            handler:
              data.case_handler_id !== null && data.case_handler_id !== undefined
                ? getEmployeeDisplayName(String(data.case_handler_id))
                : 'Not assigned',
            case_handler_id: data.case_handler_id || null, // Include case_handler_id for RolesTab
            unactivation_reason: data.unactivation_reason || null, // Use unactivation_reason from legacy table
            potential_total: data.potential_total || null, // Include potential_total for legacy leads
            status: data.status || null, // Include status field for unactivation check
            sales_roles_locked: data.sales_roles_locked || null, // Include sales_roles_locked for roles tab
            reason_id: data.reason_id || null, // Include reason_id for fallback unactivation reason
            unactivated_by: data.unactivated_by || null, // Include unactivated_by
            unactivated_at: data.unactivated_at || null, // Include unactivated_at
            vat: (data as any).vat || null, // Include vat column for legacy leads
            manual_id: data.manual_id || null,
            master_id: data.master_id || null,
            eligibile: data.eligibile || null,
            no_of_applicants: data.no_of_applicants || null,
            meeting_scheduler_id: data.meeting_scheduler_id || null,
            meeting_manager_id: data.meeting_manager_id || null,
            meeting_lawyer_id: data.meeting_lawyer_id || null,
            expert_id: data.expert_id || null,
            description: data.description || null,
            description_last_edited_by: data.description_last_edited_by || null,
            description_last_edited_at: data.description_last_edited_at || null,
            special_notes_last_edited_by: data.special_notes_last_edited_by || null,
            special_notes_last_edited_at: data.special_notes_last_edited_at || null,
            // Note: language_id is excluded as we use language (name) instead
          };
          console.log('onClientUpdate: Setting transformed legacy data:', transformedData);
          console.log('onClientUpdate: Currency mapping - currency_id:', data.currency_id, 'balance_currency:', transformedData.balance_currency);
          setSelectedClient(normalizeClientStage(transformedData));
        }
      } else {
        // For new leads, fetch from leads table - join with accounting_currencies (like legacy leads)
        const { data: newData, error: newError } = await supabase
          .from('leads')
          .select(`
            *,
            balance,
            currency_id,
            proposal_total,
            subcontractor_fee,
            potential_total,
            vat,
            vat_value,
            number_of_applicants_meeting,
            accounting_currencies!leads_currency_id_fkey (
              id,
              name,
              iso_code
            )
          `)
          .eq('id', selectedClient.id)
          .single();

        data = newData;
        error = newError;

        if (data) {
          // Transform new lead to include category name with main category
          console.log('🔍 Processing onClientUpdate category - raw data:', { 
            category_id: data.category_id, 
            category: data.category,
            allCategoriesLoaded: allCategories.length > 0
          });
          const categoryName = getCategoryName(data.category_id, data.category);
          console.log('🔍 Processing onClientUpdate category result:', { category_id: data.category_id, category_name: categoryName });
          const newLeadStageId = resolveStageId(data.stage);
          
          // Extract currency data from joined table (like legacy leads)
          const currencyRecord = data.accounting_currencies 
            ? (Array.isArray(data.accounting_currencies) ? data.accounting_currencies[0] : data.accounting_currencies)
            : null;
          
          // Convert currency_id to symbol (like legacy leads)
          const currencySymbol = (() => {
            if (currencyRecord?.iso_code) {
              const isoCode = currencyRecord.iso_code.toUpperCase();
              if (isoCode === 'ILS' || isoCode === 'NIS') return '₪';
              if (isoCode === 'USD') return '$';
              if (isoCode === 'EUR') return '€';
              if (isoCode === 'GBP') return '£';
              if (isoCode === 'CAD') return 'C$';
              if (isoCode === 'AUD') return 'A$';
              if (isoCode === 'JPY') return '¥';
              return currencyRecord.name || isoCode || '₪';
            }
            // Fallback: if we have currency_id but no joined data, use simple mapping
            if (data.currency_id) {
              const currencyId = Number(data.currency_id);
              switch (currencyId) {
                case 1: return '₪'; break; // ILS
                case 2: return '€'; break; // EUR
                case 3: return '$'; break; // USD
                case 4: return '£'; break; // GBP
                default: return '₪';
              }
            }
            return '₪'; // Default fallback
          })();
          
          // CRITICAL: If balance is updating, don't overwrite fresh data
          if (isBalanceUpdatingRef.current) {
            console.log('⏸️ onClientUpdate: Skipping - balance update in progress, not overwriting fresh data');
            return;
          }
          
          const transformedData = {
            ...data,
            category: categoryName,
            stage: newLeadStageId ?? (typeof data.stage === 'number' ? data.stage : null),
            emails: [],
            handler:
              (data.handler && data.handler.trim() !== '' && data.handler !== 'Not assigned')
                ? data.handler
                : (data.case_handler_id !== null && data.case_handler_id !== undefined
                    ? getEmployeeDisplayName(String(data.case_handler_id))
                    : 'Not assigned'),
            // CRITICAL: Preserve currency_id from database - preserve from selectedClient if missing in fetched data
            currency_id: data.currency_id ?? selectedClient?.currency_id ?? null,
            // Ensure all financial columns are preserved from the database
            balance: data.balance,
            proposal_total: data.proposal_total,
            subcontractor_fee: data.subcontractor_fee,
            potential_total: data.potential_total,
            vat: data.vat,
            vat_value: data.vat_value,
            number_of_applicants_meeting: data.number_of_applicants_meeting,
            // For backward compatibility, also set balance_currency and proposal_currency as computed symbols
            balance_currency: currencySymbol,
            proposal_currency: currencySymbol,
          };
          
          console.log('onClientUpdate: Setting new lead data:', {
            ...transformedData,
            balance_currency: transformedData.balance_currency,
            proposal_currency: transformedData.proposal_currency,
            balance: transformedData.balance,
            proposal_total: transformedData.proposal_total
          });
          console.log('onClientUpdate: Currency values - balance_currency:', data.balance_currency, 'proposal_currency:', data.proposal_currency);
          setSelectedClient(normalizeClientStage(transformedData));
        }
      }

      if (error) {
        console.error('Error refreshing client data:', error);
      }
    } catch (error) {
      console.error('Error refreshing client data:', error);
    }
  }, [selectedClient?.id, setSelectedClient, allCategories, allEmployees, normalizeClientStage, resolveStageId]);

  // Refresh client data when categories are loaded to update category names
  useEffect(() => {
    if (allCategories.length === 0 || !selectedClient?.id) {
      return;
    }

    // Skip if balance is being updated - let refreshClientData handle it
    if (isBalanceUpdatingRef.current) {
      console.log('⏸️ Skipping onClientUpdate - balance update in progress');
      return;
    }

    const clientIdKey = selectedClient.id.toString();
    if (lastCategoryRefreshIds.current.has(clientIdKey)) {
      return;
    }

    const refreshClientData = async () => {
      console.log('🔄 Categories loaded, refreshing client data to update category names');
      try {
        await onClientUpdate();
        lastCategoryRefreshIds.current.add(clientIdKey);
      } catch (error) {
        console.error('🔄 onClientUpdate failed:', error);
      }
    };

    refreshClientData();
  }, [allCategories, selectedClient?.id, onClientUpdate]);

  // Find duplicate contacts when selectedClient changes
  useEffect(() => {
    // Clear immediately when client changes to prevent showing old badge
    setDuplicateContacts([]);
    
    if (selectedClient?.id) {
      // Use a small delay to ensure state is cleared first, then fetch
      const timeoutId = setTimeout(() => {
        findDuplicateContacts();
      }, 0);
      
      return () => clearTimeout(timeoutId);
    }
  }, [selectedClient?.id]);

  // Essential data loading for initial page display
  useEffect(() => {
    // Prevent running if we're currently setting up a client to avoid race conditions
    if (isSettingUpClientRef.current) {
      return;
    }
    
    // Check if route has changed
    const currentRoute = location.pathname;
    const routeChanged = lastRouteRef.current !== currentRoute;
    
    // If this is a back/forward navigation (POP) and we already have the client loaded, skip the fetch
    // Note: routeChanged can be true on POP navigation, so we check navType first
    if (navType === 'POP' && selectedClient && lead_number) {
      const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      const currentClientId = isLegacy 
        ? selectedClient.id?.toString().replace('legacy_', '')
        : selectedClient.id?.toString();
      const currentLeadNumber = selectedClient.lead_number;
      
      // Check if we have the correct client already loaded
      if (isLegacy) {
        if (currentClientId === lead_number) {
          console.log('🔍 Clients: POP navigation with cached client, skipping fetch');
          setLocalLoading(false);
          lastRouteRef.current = currentRoute; // Update route ref to prevent future refetches
          return; // Skip fetch - we have the cached client
        }
      } else {
        if (currentLeadNumber === lead_number || currentClientId === lead_number) {
          console.log('🔍 Clients: POP navigation with cached client, skipping fetch');
          setLocalLoading(false);
          lastRouteRef.current = currentRoute; // Update route ref to prevent future refetches
          return; // Skip fetch - we have the cached client
        }
      }
    }
    
    // Always refetch if route changed (including coming back from /master)
    // But skip if it's a POP navigation and we already handled it above
    if (routeChanged && navType !== 'POP') {
      lastRouteRef.current = currentRoute;
      // Clear selectedClient immediately to reset all child components
      setSelectedClient(null);
      // Continue to fetch data below - don't return early
    } else if (routeChanged && navType === 'POP') {
      // POP navigation but client doesn't match - update route ref and continue
      lastRouteRef.current = currentRoute;
    } else if (selectedClient && lead_number && !location.pathname.includes('/master')) {
      // Only skip fetch if we have the same client AND we're not on the master route
      const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      const currentClientId = isLegacy 
        ? selectedClient.id?.toString().replace('legacy_', '')
        : selectedClient.id?.toString();
      const currentLeadNumber = selectedClient.lead_number;
      
      // For legacy leads, compare by ID; for new leads, compare by lead_number
      if (isLegacy) {
        // Legacy lead: compare numeric ID
        if (currentClientId === lead_number) {
          setLocalLoading(false); // Ensure loading is cleared
          return; // Already have the correct legacy client loaded
        }
      } else {
        // New lead: compare by lead_number or manual_id
        if (currentLeadNumber === lead_number || currentClientId === lead_number) {
          setLocalLoading(false); // Ensure loading is cleared
          return; // Already have the correct new client loaded
        }
      }
    }
    
    let isMounted = true;
    const fetchEssentialData = async () => {
      // Always set loading when fetching new data
      setLocalLoading(true);
      // Use fullLeadNumber if lead_number is empty (fallback for route parsing)
      const effectiveLeadNumber = lead_number || fullLeadNumber;
      if (effectiveLeadNumber) {
        // Try to find the lead in both tables - run queries in parallel for faster loading
        let clientData = null;
        
        const isManualIdCandidate = /^\d+$/.test(effectiveLeadNumber);
        const isLegacyLeadId = /^\d+$/.test(effectiveLeadNumber);
        
        // Run all possible queries in parallel to find the lead faster
        const queries = [];
        
        if (isManualIdCandidate) {
          queries.push(
            supabase
              .from('leads')
              .select('*')
              .eq('manual_id', effectiveLeadNumber)
              .then(({ data, error }) => ({ type: 'manual', data, error }))
          );
        }
        
        if (isLegacyLeadId) {
          queries.push(
            supabase
              .from('leads_lead')
              .select(`
                *,
                accounting_currencies!leads_lead_currency_id_fkey (
                  name,
                  iso_code
                ),
                misc_language!leads_lead_language_id_fkey (
                  name
                )
              `)
              .eq('id', parseInt(effectiveLeadNumber))
              .single()
              .then(({ data, error }) => ({ type: 'legacy', data, error }))
          );
        }
        
        // Also try by lead_number for new leads
        queries.push(
          supabase
            .from('leads')
            .select('*')
            .eq('lead_number', effectiveLeadNumber)
            .single()
            .then(({ data, error }) => ({ type: 'lead_number', data, error }))
        );
        
        // Wait for all queries to complete
        const results = await Promise.allSettled(queries);
        
        // Process results in priority order: manual_id > legacy > lead_number
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { type, data, error } = result.value;
            
            if (type === 'manual' && data && data.length > 0) {
              let chosenLead = null;
              if (requestedLeadNumber) {
                chosenLead = data.find((lead: any) => lead.lead_number === requestedLeadNumber);
              }
              if (!chosenLead) {
                const masterLead = data.find((lead: any) => typeof lead.lead_number === 'string' && lead.lead_number.includes('/1'));
                chosenLead = masterLead || data.sort((a: any, b: any) => {
                  const aNum = typeof a.lead_number === 'string' ? a.lead_number : '';
                  const bNum = typeof b.lead_number === 'string' ? b.lead_number : '';
                  return aNum.localeCompare(bNum);
                })[0];
              }
              
              if (chosenLead) {
                const categoryName = getCategoryName(chosenLead.category_id, chosenLead.category);
                const chosenStageId = resolveStageId(chosenLead.stage);
                clientData = {
                  ...chosenLead,
                  category: categoryName,
                  stage: chosenStageId ?? (typeof chosenLead.stage === 'number' ? chosenLead.stage : null),
                  emails: [],
                  handler:
                    (chosenLead.handler && chosenLead.handler.trim() !== '' && chosenLead.handler !== 'Not assigned')
                      ? chosenLead.handler
                      : (chosenLead.case_handler_id !== null && chosenLead.case_handler_id !== undefined
                          ? getEmployeeDisplayName(String(chosenLead.case_handler_id))
                          : 'Not assigned'),
                };
                break; // Found it, stop searching
              }
            } else if (type === 'legacy' && data && !error) {
              // Process legacy lead
              const legacyLead = data;
              const legacyCurrencyRecord = Array.isArray(legacyLead.accounting_currencies)
                ? legacyLead.accounting_currencies[0]
                : legacyLead.accounting_currencies;
              const legacyLanguageRecord = Array.isArray(legacyLead.misc_language)
                ? legacyLead.misc_language[0]
                : legacyLead.misc_language;
              
              // Get scheduler name if available (defer to avoid blocking)
              let schedulerName = '---';
              if (legacyLead.meeting_scheduler_id) {
                schedulerName = getEmployeeDisplayName(String(legacyLead.meeting_scheduler_id));
              }
              
              // Calculate sub-lead suffix if this is a sub-lead (has master_id)
              let subLeadSuffix: number | undefined;
              if (legacyLead.master_id) {
                const { data: existingSubLeads } = await supabase
                  .from('leads_lead')
                  .select('id')
                  .eq('master_id', legacyLead.master_id)
                  .not('master_id', 'is', null)
                  .order('id', { ascending: true });
                
                if (existingSubLeads) {
                  const currentLeadIndex = existingSubLeads.findIndex(sub => sub.id === legacyLead.id);
                  // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
                  subLeadSuffix = currentLeadIndex >= 0 ? currentLeadIndex + 2 : existingSubLeads.length + 2;
                }
              }

              const legacyStageId = resolveStageId(legacyLead.stage);
              
              // Extract language name from joined table
              let languageName = '';
              if (legacyLanguageRecord?.name) {
                languageName = legacyLanguageRecord.name;
              } else if (legacyLead.language_id) {
                // If join failed, fetch language name directly by language_id
                try {
                  const { data: langData } = await supabase
                    .from('misc_language')
                    .select('name')
                    .eq('id', legacyLead.language_id)
                    .maybeSingle();
                  if (langData?.name) {
                    languageName = langData.name;
                  }
                } catch (langError) {
                  console.error('Error fetching language name:', langError);
                }
              }
              
              // Create transformed data by explicitly selecting only the fields we want
              // This ensures unwanted fields (description, tracking fields, language_id) are never included
              clientData = {
                id: `legacy_${legacyLead.id}`,
                name: legacyLead.name || '',
                email: legacyLead.email || '',
                phone: legacyLead.phone || '',
                mobile: legacyLead.mobile || '',
                topic: legacyLead.topic || '',
                lead_number: formatLegacyLeadNumber(legacyLead, subLeadSuffix),
                stage: legacyStageId ?? (typeof legacyLead.stage === 'number' ? legacyLead.stage : null),
                source: String(legacyLead.source_id || ''),
                created_at: legacyLead.cdate,
                updated_at: legacyLead.udate,
                notes: legacyLead.notes || '',
                special_notes: legacyLead.special_notes || '',
                next_followup: legacyLead.next_followup || '',
                probability: legacyLead.probability !== null && legacyLead.probability !== undefined ? Number(legacyLead.probability) : 0,
                category: getCategoryName(legacyLead.category_id, legacyLead.category),
                language: languageName, // Always use the language name (never use ID)
                balance: String(legacyLead.total || ''),
                balance_currency: legacyCurrencyRecord?.name || (() => {
                  switch (legacyLead.currency_id) {
                    case 1: return '₪';
                    case 2: return '€';
                    case 3: return '$';
                    case 4: return '£';
                    default: return '₪';
                  }
                })(),
                lead_type: 'legacy',
                client_country: null,
                emails: [],
                closer: legacyLead.closer_id,
                closer_id: legacyLead.closer_id || null, // Include closer_id for RolesTab
                handler:
                  legacyLead.case_handler_id !== null && legacyLead.case_handler_id !== undefined
                    ? getEmployeeDisplayName(String(legacyLead.case_handler_id))
                    : 'Not assigned',
                case_handler_id: legacyLead.case_handler_id || null, // Include case_handler_id for RolesTab
                scheduler: schedulerName,
                unactivation_reason: legacyLead.unactivation_reason || null,
                unactivated_by: legacyLead.unactivated_by || null,
                unactivated_at: legacyLead.unactivated_at || null,
                status: legacyLead.status || null,
                sales_roles_locked: legacyLead.sales_roles_locked || null,
                reason_id: legacyLead.reason_id || null,
                manual_id: legacyLead.manual_id || null,
                master_id: legacyLead.master_id || null,
                eligibile: legacyLead.eligibile || null,
                no_of_applicants: legacyLead.no_of_applicants || null,
                meeting_scheduler_id: legacyLead.meeting_scheduler_id || null,
                meeting_manager_id: legacyLead.meeting_manager_id || null,
                meeting_lawyer_id: legacyLead.meeting_lawyer_id || null,
                expert_id: legacyLead.expert_id || null,
                vat: (legacyLead as any).vat || null,
                potential_total: legacyLead.potential_total || null,
                description: legacyLead.description || null,
                description_last_edited_by: legacyLead.description_last_edited_by || null,
                description_last_edited_at: legacyLead.description_last_edited_at || null,
                special_notes_last_edited_by: legacyLead.special_notes_last_edited_by || null,
                special_notes_last_edited_at: legacyLead.special_notes_last_edited_at || null,
                // Note: language_id is excluded as we use language (name) instead
              };
              break; // Found it, stop searching
            } else if (type === 'lead_number' && data && !error) {
              // Process new lead by lead_number
              const newLead = data;
              const categoryName = getCategoryName(newLead.category_id, newLead.category);
              const newStageId = resolveStageId(newLead.stage);
              clientData = {
                ...newLead,
                category: categoryName,
                stage: newStageId ?? (typeof newLead.stage === 'number' ? newLead.stage : null),
                emails: [],
                handler:
                  (newLead.handler && newLead.handler.trim() !== '' && newLead.handler !== 'Not assigned')
                    ? newLead.handler
                    : (newLead.case_handler_id !== null && newLead.case_handler_id !== undefined
                        ? getEmployeeDisplayName(String(newLead.case_handler_id))
                        : 'Not assigned'),
              };
              break; // Found it, stop searching
            }
          }
        }
        
        // If no client found from parallel queries, try fallback lookup
        if (!clientData) {
          const numericLeadCandidate = effectiveLeadNumber.replace(/^[LC]/i, '');
          if (numericLeadCandidate && /^\d+$/.test(numericLeadCandidate)) {
            const { data: leadsByManualId, error: manualLookupError } = await supabase
              .from('leads')
              .select('*')
              .eq('manual_id', numericLeadCandidate)
              .order('created_at', { ascending: false })
              .limit(1);

            if (!manualLookupError && leadsByManualId?.[0]) {
              const leadByManualId = leadsByManualId[0];
              const categoryName = getCategoryName(leadByManualId.category_id, leadByManualId.category);
              const manualStageId = resolveStageId(leadByManualId.stage);
              clientData = {
                ...leadByManualId,
                category: categoryName,
                stage: manualStageId ?? (typeof leadByManualId.stage === 'number' ? leadByManualId.stage : null),
                emails: [],
                handler:
                  (leadByManualId.handler && leadByManualId.handler.trim() !== '' && leadByManualId.handler !== 'Not assigned')
                    ? leadByManualId.handler
                    : (leadByManualId.case_handler_id !== null && leadByManualId.case_handler_id !== undefined
                        ? getEmployeeDisplayName(String(leadByManualId.case_handler_id))
                        : 'Not assigned'),
              };
            }
          }
        }

        // Set client data and stop loading as soon as we have it
        if (clientData && isMounted) {
          // Set unactivated view BEFORE setting selectedClient
          try {
            const isLegacy = clientData.lead_type === 'legacy' || clientData.id?.toString().startsWith('legacy_');
            const statusValue = (clientData as any).status;
            const isUnactivated = !isLegacy && (statusValue === 'inactive');
            setIsUnactivatedView(!!(clientData && isUnactivated && !userManuallyExpanded));
          } catch (error) {
            console.error('Error checking unactivation status:', error);
            setIsUnactivatedView(false);
          }
          
          // Set flag to prevent useEffect from interfering
          isSettingUpClientRef.current = true;
          
          // Set the client immediately for faster rendering
          setSelectedClient(normalizeClientStage(clientData));
          setLocalLoading(false); // Stop loading immediately - don't wait for anything else
          
          // Clear flag after a brief delay
          setTimeout(() => {
            isSettingUpClientRef.current = false;
          }, 100);
        } else if (!clientData) {
          // If still no client found, try to get latest lead
          // Only do this if there's no lead_number in the URL (empty route)
          // If there IS a lead_number, it means we're trying to load a specific client, so don't jump to latest
          if (!lead_number && isMounted) {
            const allLeads = await fetchAllLeads();
            if (allLeads.length > 0 && isMounted) {
              const latestLead = allLeads[0];
              const latestManualId = (latestLead as any)?.manual_id;
              const latestLeadNumber = (latestLead as any)?.lead_number;
              const targetRoute = buildClientRoute(latestManualId, latestLeadNumber);
              if (location.pathname !== targetRoute) {
                navigate(targetRoute);
              }
              // Set flag to prevent useEffect from interfering
              isSettingUpClientRef.current = true;
              
              // Set unactivated view BEFORE setting selectedClient
              const isLegacy = latestLead.lead_type === 'legacy' || latestLead.id?.toString().startsWith('legacy_');
              const statusValue = (latestLead as any).status;
              const isUnactivated = !isLegacy && (statusValue === 'inactive');
              setIsUnactivatedView(!!(latestLead && isUnactivated && !userManuallyExpanded));
              
              // Set the client
              setSelectedClient(normalizeClientStage(latestLead));
              setLocalLoading(false); // Stop loading immediately
              
              // Clear flag after a brief delay
              setTimeout(() => {
                isSettingUpClientRef.current = false;
              }, 100);
            } else {
              setLocalLoading(false);
            }
          } else {
            setLocalLoading(false);
          }
        }
      } else {
        // Get the most recent lead from either table
        // Only navigate if we're not already on a valid route to prevent switching
        const allLeads = await fetchAllLeads();
        if (allLeads.length > 0 && isMounted) {
          const latestLead = allLeads[0];
          const latestManualId = (latestLead as any)?.manual_id;
          const latestLeadNumber = (latestLead as any)?.lead_number;
          const targetRoute = buildClientRoute(latestManualId, latestLeadNumber);
          // Only navigate if we're not already on this route
          if (location.pathname !== targetRoute) {
            navigate(targetRoute);
          }
          // Set flag to prevent useEffect from interfering
          isSettingUpClientRef.current = true;
          
          // Set unactivated view BEFORE setting selectedClient
          const isLegacy = latestLead.lead_type === 'legacy' || latestLead.id?.toString().startsWith('legacy_');
          // Check unactivation status based on status column
          // Only show unactivated box for new leads (not legacy leads)
          const statusValue = (latestLead as any).status;
          const isUnactivated = !isLegacy && (statusValue === 'inactive');
          console.log('🔍 fetchEssentialData (no lead_number): Setting isUnactivatedView BEFORE setSelectedClient', {
            isLegacy,
            statusValue,
            isUnactivated,
            userManuallyExpanded
          });
          setIsUnactivatedView(!!(latestLead && isUnactivated && !userManuallyExpanded));
          
          // Now set the client
          setSelectedClient(normalizeClientStage(latestLead));
          setLocalLoading(false); // Stop loading immediately
          
          // Clear flag after a brief delay
          setTimeout(() => {
            isSettingUpClientRef.current = false;
          }, 100);
        } else {
          setLocalLoading(false);
        }
      }
    };

    fetchEssentialData();
    
    return () => { 
      isMounted = false;
      // Don't set loading to false here - it should only be set in the async function
    };
  }, [lead_number, fullLeadNumber, requestedLeadNumber, buildClientRoute, droppedStageId, userManuallyExpanded, location.pathname]); // Added location.pathname to ensure refetch on route change
  // Background loading for non-essential data (runs after essential data is loaded)
  useEffect(() => {
    const loadBackgroundData = async () => {
      setBackgroundLoading(true);
      try {
        // Fetch all non-essential data in parallel for better performance
        const [categoriesResult, sourcesResult, languagesResult, currenciesResult, meetingLocationsResult, tagsResult] = await Promise.all([
          // Fetch categories with their parent main category names using JOINs
          supabase.from('misc_category')
            .select(`
              id,
              name,
              parent_id,
              misc_maincategory!parent_id (
                id,
                name
              )
            `)
            .order('name', { ascending: true }),
          supabase.from('sources').select('name'),
          supabase.from('misc_language').select('name'),
          // Fetch currencies (try both tables)
          Promise.all([
            supabase.from('currencies').select('id, front_name, iso_code, name').order('id'),
            supabase.from('accounting_currencies').select('id, name, iso_code, order').order('order', { ascending: true, nullsFirst: false })
          ]).then(([newCurrencies, legacyCurrencies]) => ({ newCurrencies, legacyCurrencies })),
          // Fetch meeting locations from tenants_meetinglocation table (all locations for the firm)
          supabase
            .from('tenants_meetinglocation')
            .select('id, name, default_link, "order"')
            .order('order', { ascending: true }),
          // Fetch tags
          supabase.from('misc_leadtag').select('id, name, order').eq('active', true).order('order', { ascending: true })
        ]);
        
        // Process dropdown data results
        if (!categoriesResult.error && categoriesResult.data) {
          // Create formatted category names with parent main category
          const formattedNames = categoriesResult.data.map((category: any) => {
            if (category.misc_maincategory) {
              return `${category.name} (${category.misc_maincategory.name})`;
            } else {
              return category.name; // Fallback if no parent main category
            }
          }).filter(Boolean);
          setMainCategories(formattedNames);
        }
        
        if (!sourcesResult.error && sourcesResult.data) {
          const names = sourcesResult.data.map((row: any) => row.name).filter(Boolean);
          setSources(names);
        }
        
        if (!languagesResult.error && languagesResult.data) {
          const names = languagesResult.data.map((row: any) => row.name).filter(Boolean);
          setLanguagesList(names);
        }
        
        // Process currencies
        const { newCurrencies, legacyCurrencies } = currenciesResult;
        if (!newCurrencies.error && newCurrencies.data && newCurrencies.data.length > 0) {
          setCurrencies(newCurrencies.data);
        } else if (!legacyCurrencies.error && legacyCurrencies.data && legacyCurrencies.data.length > 0) {
          const transformedCurrencies = legacyCurrencies.data.map(currency => ({
            id: currency.id.toString(),
            front_name: currency.iso_code === 'NIS' ? '₪' : currency.iso_code === 'EUR' ? '€' : currency.iso_code === 'USD' ? '$' : currency.iso_code === 'GBP' ? '£' : currency.iso_code,
            iso_code: currency.iso_code,
            name: currency.name
          }));
          setCurrencies(transformedCurrencies);
        } else {
          // Fallback to hardcoded currencies
          const fallbackCurrencies = [
            { id: '1', front_name: '₪', iso_code: 'NIS', name: '₪' },
            { id: '2', front_name: '€', iso_code: 'EUR', name: '€' },
            { id: '3', front_name: '$', iso_code: 'USD', name: '$' },
            { id: '4', front_name: '£', iso_code: 'GBP', name: '£' }
          ];
          setCurrencies(fallbackCurrencies);
        }
        
        // Process meeting locations from tenants_meetinglocation
        if (!meetingLocationsResult.error && meetingLocationsResult.data) {
          const processedLocations = meetingLocationsResult.data
            .filter((loc: any) => loc && loc.name)
            .map((loc: any) => ({
              id: loc.id,
              name: loc.name,
              default_link: loc.default_link ?? null,
            }));
          setMeetingLocations(processedLocations);
        }
        
        // Process tags
        if (!tagsResult.error && tagsResult.data) {
          setAllTags(tagsResult.data);
          const tagNames = tagsResult.data.map((tag: any) => tag.name);
          setTagsList(tagNames);
        }
        
        console.log('✅ Background data loading completed');
      } catch (error) {
        console.error('Error fetching background data:', error);
      } finally {
        setBackgroundLoading(false);
      }
    };
    
    // Start background loading
    loadBackgroundData();
  }, []); // Run once when component mounts

  // Additional data loading for specific client
  useEffect(() => {
    if (!selectedClient?.id) return;
    
    const loadAdditionalData = async () => {
      try {
        // Check if this is a legacy lead
        const isLegacyLead = selectedClient.lead_type === 'legacy' || 
                             (selectedClient.id && selectedClient.id.toString().startsWith('legacy_'));
        
        // Fetch latest meeting date for case summary
        let query = supabase
          .from('meetings')
          .select('meeting_date')
          .not('meeting_date', 'is', null)
          .order('meeting_date', { ascending: false })
          .limit(1);
        
        if (isLegacyLead) {
          const legacyId = selectedClient.id.toString().replace('legacy_', '');
          query = query.eq('legacy_lead_id', parseInt(legacyId, 10));
        } else {
          query = query.eq('client_id', selectedClient.id);
        }
        
        const { data, error } = await query;
        if (!error && data && data.length > 0) setLatestMeetingDate(data[0].meeting_date);
        else setLatestMeetingDate(null);
      } catch (error) {
        console.error('Error fetching latest meeting:', error);
        setLatestMeetingDate(null);
      }
    };
    
    loadAdditionalData();
  }, [selectedClient?.id]);

  // Set default location when meeting locations are loaded
  useEffect(() => {
    if (meetingLocations.length > 0 && !meetingFormData.location) {
      // Prefer "Teams" as default if it exists; otherwise use the first location
      const teamsLocation =
        meetingLocations.find(loc => loc.name === 'Teams') || meetingLocations[0];

      setMeetingFormData(prev => ({
        ...prev,
        location: teamsLocation.name,
      }));
    }
  }, [meetingLocations, meetingFormData.location]);

  // Fetch meeting counts by time for the selected date
  useEffect(() => {
    const fetchMeetingCounts = async () => {
      if (!meetingFormData.date) {
        setMeetingCountsByTime({});
        return;
      }

      try {
        // Fetch all meetings for the selected date
        const { data: meetings, error } = await supabase
          .from('meetings')
          .select('meeting_time')
          .eq('meeting_date', meetingFormData.date)
          .or('status.is.null,status.neq.canceled');

        if (error) {
          console.error('Error fetching meeting counts:', error);
          setMeetingCountsByTime({});
          return;
        }

        // Count meetings by time slot
        const counts: Record<string, number> = {};
        if (meetings) {
          meetings.forEach((meeting: any) => {
            if (meeting.meeting_time) {
              // Extract time in HH:MM format (handle both TIME and TIMESTAMP formats)
              const timeStr = typeof meeting.meeting_time === 'string' 
                ? meeting.meeting_time.substring(0, 5) 
                : new Date(meeting.meeting_time).toTimeString().substring(0, 5);
              counts[timeStr] = (counts[timeStr] || 0) + 1;
            }
          });
        }

        setMeetingCountsByTime(counts);
      } catch (error) {
        console.error('Error fetching meeting counts:', error);
        setMeetingCountsByTime({});
      }
    };

    fetchMeetingCounts();
  }, [meetingFormData.date]);

  // Close manager and helper dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (managerDropdownRef.current && !managerDropdownRef.current.contains(event.target as Node)) {
        setShowManagerDropdown(false);
      }
      if (helperDropdownRef.current && !helperDropdownRef.current.contains(event.target as Node)) {
        setShowHelperDropdown(false);
      }
    };

    if (showManagerDropdown || showHelperDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showManagerDropdown, showHelperDropdown]);

  // Handle tab switching from URL
  useEffect(() => {
    const tabFromUrl = new URLSearchParams(location.search).get('tab');
    if (tabFromUrl && tabs.map(t => t.id).includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [location.search]);

  

  const handleStageUpdate = async (newStage: string) => {
    if (!selectedClient) return;
    
    if (newStage === 'Schedule Meeting') {
      setShowScheduleMeetingPanel(true);
      setSelectedStage(null); // Close the dropdown immediately
      (document.activeElement as HTMLElement)?.blur();
    } else if (newStage === 'Unactivate/Spam') {
      setShowUnactivationModal(true);
      setSelectedStage(null); // Close the dropdown immediately
      (document.activeElement as HTMLElement)?.blur();
    } else if (newStage === 'Activate') {
      setShowActivationModal(true);
      setSelectedStage(null); // Close the dropdown immediately
      (document.activeElement as HTMLElement)?.blur();
    } else if (newStage === 'Paid Meeting') {
      await updateLeadStage('Paid Meeting');
    } else if (newStage === 'Communication Started') {
      const currentStageName = getStageName(selectedClient.stage);
      if (areStagesEquivalent(currentStageName, 'scheduler_assigned')) {
        setShowUpdateDrawer(true);
        (document.activeElement as HTMLElement)?.blur();
      } else {
        await updateLeadStage('communication_started');
      }
    } else if (newStage === 'Meeting Ended') {
      setActiveTab('meeting');
      setShowMeetingEndedDrawer(true);
      (document.activeElement as HTMLElement)?.blur();
    } else {
      setSelectedStage(newStage);
    }
  };

  const handleUnactivation = async () => {
    // Validate reason
    const finalReason = unactivationReason === 'other' ? customUnactivationReason : unactivationReason;
    
    if (!finalReason.trim()) {
      toast.error('Please select or enter a reason for unactivation');
      return;
    }
    
    try {
      // Get current Supabase auth user
      const { data: { user } } = await supabase.auth.getUser();
      let currentUserFullName = 'Unknown User';
      
      if (user) {
        // Get user's full name from users table
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('full_name')
          .eq('auth_id', user.id)
          .single();
        
        if (!userError && userData?.full_name) {
          currentUserFullName = userData.full_name;
        } else {
          console.log('Could not fetch user full_name, using email as fallback');
          currentUserFullName = user.email || 'Unknown User';
        }
      }

      // Determine which table to update based on lead type
      const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      const tableName = isLegacy ? 'leads_lead' : 'leads';
      const idField = isLegacy ? 'id' : 'id';
      const clientId = isLegacy ? selectedClient.id.toString().replace('legacy_', '') : selectedClient.id;

      const updateData: any = {
        unactivated_by: currentUserFullName,
        unactivated_at: new Date().toISOString(),
        unactivation_reason: finalReason
      };

      // Set status based on lead type (do NOT change stage)
      if (isLegacy) {
        // For legacy leads, set status to 10 (inactive)
        updateData.status = 10;
      } else {
        // For new leads, set status to 'inactive'
        updateData.status = 'inactive';
      }

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq(idField, clientId);
      
      if (error) throw error;
      
      // Refresh client data
      await onClientUpdate();
      setShowUnactivationModal(false);
      setUnactivationReason('');
      setCustomUnactivationReason('');
      toast.success('Lead unactivated successfully');
    } catch (error) {
      console.error('Error unactivating lead:', error);
      toast.error('Failed to unactivate lead');
    }
  };
  const handleActivation = async () => {
    try {
      // Get current Supabase auth user
      const { data: { user } } = await supabase.auth.getUser();
      let currentUserFullName = 'Unknown User';
      
      if (user) {
        // Get user's full name from users table
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('full_name')
          .eq('auth_id', user.id)
          .single();
        
        if (!userError && userData?.full_name) {
          currentUserFullName = userData.full_name;
        } else {
          console.log('Could not fetch user full_name, using email as fallback');
          currentUserFullName = user.email || 'Unknown User';
        }
      }

      // Determine which table to update based on lead type
      const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      
      const updateData: any = {
        unactivated_by: null,
        unactivated_at: null,
        unactivation_reason: null
      };

      // Set status based on lead type
      if (isLegacy) {
        // For legacy leads, set status to 0 (active)
        updateData.status = 0;
      } else {
        // For new leads, set status to 'active'
        updateData.status = 'active';
      }

      const tableName = isLegacy ? 'leads_lead' : 'leads';
      const idField = isLegacy ? 'id' : 'id';
      const clientId = isLegacy ? selectedClient.id.toString().replace('legacy_', '') : selectedClient.id;

      console.log('🔍 Activating lead:', { tableName, clientId, updateData });

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq(idField, clientId);
      
      if (error) throw error;
      
      console.log('🔍 Lead activation successful');

      // Record activation event in lead_changes table (only for new leads)
      if (!isLegacy) {
        const { error: changeError } = await supabase
          .from('lead_changes')
          .insert({
            lead_id: selectedClient.id,
            field_name: 'lead_activated',
            old_value: 'unactivated',
            new_value: 'activated',
            changed_by: currentUserFullName,
            changed_at: new Date().toISOString()
          });

        if (changeError) {
          console.error('Error recording activation event:', changeError);
          // Don't throw error here as the main activation was successful
        }
      }
      
      // Refresh client data
      await onClientUpdate();
      setShowActivationModal(false);
      toast.success('Lead activated successfully');
    } catch (error) {
      console.error('Error activating lead:', error);
      toast.error('Failed to activate lead');
    }
  };
  const updateLeadStage = async (stage: string | number) => {
    if (!selectedClient) return;
    
    try {
      const actor = await fetchStageActorInfo();
      const timestamp = new Date().toISOString();
      const isLegacyLead = selectedClient.id.startsWith('legacy_');
      const resolvedStageValue = resolveStageId(stage);
      if (resolvedStageValue === null) {
        toast.error('Unable to resolve the selected stage. Please contact an administrator.');
        return;
      }
      const normalizedStageName = normalizeStageName(getStageName(String(resolvedStageValue)));
      
      const additionalFields: Record<string, any> = {};
      if (!isLegacyLead && normalizedStageName === 'communicationstarted') {
        additionalFields.communication_started_by = actor.fullName;
        additionalFields.communication_started_at = timestamp;
      }

      await updateLeadStageWithHistory({
        lead: selectedClient,
        stage: resolvedStageValue,
        additionalFields,
        actor,
        timestamp,
      });

      setSelectedClient((prev: any) => {
        if (!prev) return prev;
        return { ...prev, stage: resolvedStageValue };
      });
      
      await onClientUpdate();
      setSelectedStage(null);
    } catch (error: any) {
      console.error('Error updating lead stage:', error);
      
      if (error?.message && error.message.includes('category')) {
        toast.error('Please set a category for this client before performing this action.', {
          duration: 4000,
          style: {
            background: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #fecaca',
          },
        });
      } else {
        toast.error('Failed to update lead stage. Please try again.');
      }
    }
  };

  // Function to handle stage change from dropdown
  const handleStageChange = async (newStageId: string | number) => {
    await updateLeadStage(newStageId);
  };
  const handleStartCase = useCallback(() => {
    setStageDropdownAnchor(null);
    void updateLeadStage('Handler Started');
    (document.activeElement as HTMLElement | null)?.blur();
  }, [updateLeadStage]);
  const updateScheduler = async (scheduler: string) => {
    if (!selectedClient) return;
    
    try {
      const actor = await fetchStageActorInfo();
      const timestamp = new Date().toISOString();
      const isLegacyLead = selectedClient.id.startsWith('legacy_');
      
      const schedulerStageId = getStageIdOrWarn('scheduler_assigned');
      if (schedulerStageId === null) {
        toast.error('Unable to resolve the "Scheduler assigned" stage. Please contact an administrator.');
        return;
      }

      if (isLegacyLead) {
        const legacyId = selectedClient.id.replace('legacy_', '');

        let schedulerEmployeeId = actor.employeeId;

        if (!schedulerEmployeeId) {
          const { data: fallbackEmployee } = await supabase
            .from('tenants_employee')
            .select('id')
            .eq('display_name', actor.fullName)
            .single();

          if (fallbackEmployee?.id) {
            schedulerEmployeeId = fallbackEmployee.id;
          }
        }

        if (!schedulerEmployeeId) {
          throw new Error('Current user is not linked to an employee record.');
        }

        const { error } = await supabase
          .from('leads_lead')
          .update({ 
            meeting_scheduler_id: schedulerEmployeeId,
            stage: 10,
            stage_changed_by: actor.fullName,
            stage_changed_at: timestamp,
          })
          .eq('id', legacyId);
        
        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: 10,
          actor,
          timestamp,
        });
      } else {
        const { error } = await supabase
          .from('leads')
          .update({ 
            scheduler,
            stage: schedulerStageId,
            stage_changed_by: actor.fullName,
            stage_changed_at: timestamp,
          })
          .eq('id', selectedClient.id);
        
        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: schedulerStageId,
          actor,
          timestamp,
        });
      }
      
      await onClientUpdate();
    } catch (error: any) {
      console.error('Error updating scheduler:', error);
      
      if (error?.message && error.message.includes('category')) {
        toast.error('Please set a category for this client before performing this action.', {
          duration: 4000,
          style: {
            background: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #fecaca',
          },
        });
      } else {
        toast.error('Failed to update scheduler. Please try again.');
      }
    }
  };

  const assignSuccessStageHandler = async (option: HandlerOption | null) => {
    if (!selectedClient || isUpdatingSuccessStageHandler) return;

    const rawClientId = selectedClient.id;
    const handlerIdRaw = option?.id ?? '';
    const handlerLabel = option?.label ?? '';
    const trimmedId = handlerIdRaw.trim();
    const handlerIdNumeric =
      trimmedId && /^\d+$/.test(trimmedId) ? Number.parseInt(trimmedId, 10) : null;
    const clientIdString =
      rawClientId !== undefined && rawClientId !== null
        ? String(rawClientId)
        : '';

    console.log('🎯 assignSuccessStageHandler called:', {
      option,
      handlerLabel,
      handlerIdNumeric,
      clientId: rawClientId
    });

    setIsUpdatingSuccessStageHandler(true);
    try {
      const isLegacyLead =
        selectedClient.lead_type === 'legacy' || clientIdString.startsWith('legacy_');

      // If handler is being assigned (not cleared), change stage to 105 (Handler Set)
      const shouldUpdateStage = handlerLabel && handlerLabel.trim() !== '';
      console.log('📊 Should update stage?', shouldUpdateStage, 'Handler label:', handlerLabel);
      
      let handlerSetStageId: number | null = null;
      let actor: any = null;
      let stageTimestamp: string | null = null;

      if (shouldUpdateStage) {
        handlerSetStageId = getStageIdOrWarn('Handler Set');
        console.log('🔍 Handler Set stage ID:', handlerSetStageId);
        if (handlerSetStageId === null) {
          handlerSetStageId = 105; // Fallback to numeric ID if name resolution fails
          console.log('⚠️ Using fallback stage ID: 105');
        }
        actor = await fetchStageActorInfo();
        stageTimestamp = new Date().toISOString();
        console.log('👤 Actor:', actor, 'Timestamp:', stageTimestamp);
      }

      if (isLegacyLead) {
        const legacyId = clientIdString.replace('legacy_', '');
        const updatePayload: Record<string, any> = {
          case_handler_id: handlerIdNumeric,
        };

        if (shouldUpdateStage && handlerSetStageId !== null) {
          updatePayload.stage = handlerSetStageId;
          updatePayload.stage_changed_by = actor.fullName;
          updatePayload.stage_changed_at = stageTimestamp;
          console.log('✅ Adding stage update to payload for legacy lead');
        }

        console.log('📤 Updating legacy lead with payload:', updatePayload);
        const { error } = await supabase
          .from('leads_lead')
          .update(updatePayload)
          .eq('id', legacyId);
        if (error) {
          console.error('❌ Error updating legacy lead:', error);
          throw error;
        }
        console.log('✅ Legacy lead updated successfully');

        if (shouldUpdateStage && handlerSetStageId !== null && actor) {
          console.log('📝 Recording stage change for legacy lead');
          await recordLeadStageChange({
            lead: selectedClient,
            stage: handlerSetStageId,
            actor,
            timestamp: stageTimestamp!,
          });
        }
      } else {
        // For new leads, save to handler column and case_handler_id
        const updatePayload: Record<string, any> = {
          case_handler_id: handlerIdNumeric,
          handler: handlerLabel || null,
        };

        if (!handlerLabel) {
          updatePayload.handler = null;
          updatePayload.case_handler_id = null;
        }

        if (shouldUpdateStage && handlerSetStageId !== null) {
          updatePayload.stage = handlerSetStageId;
          updatePayload.stage_changed_by = actor.fullName;
          updatePayload.stage_changed_at = stageTimestamp;
          console.log('✅ Adding stage update to payload for new lead');
        }

        console.log('📤 Updating new lead with payload:', updatePayload);
        const { error } = await supabase
          .from('leads')
          .update(updatePayload)
          .eq('id', rawClientId);
        if (error) {
          console.error('❌ Error updating new lead:', error);
          throw error;
        }
        console.log('✅ New lead updated successfully');

        if (shouldUpdateStage && handlerSetStageId !== null && actor) {
          console.log('📝 Recording stage change for new lead');
          await recordLeadStageChange({
            lead: selectedClient,
            stage: handlerSetStageId,
            actor,
            timestamp: stageTimestamp!,
          });
        }
      }

      console.log('🔄 Updating local client state...');
      setSelectedClient((prev: any) => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          case_handler_id: handlerIdNumeric,
          handler: handlerLabel || '',
          closer: handlerLabel || null,
          ...(shouldUpdateStage && handlerSetStageId !== null ? { stage: handlerSetStageId } : {}),
        };
        console.log('📊 Updated client state:', { oldStage: prev.stage, newStage: updated.stage });
        return updated;
      });

      console.log('🔄 Refreshing client data from database...');
      await refreshClientData(rawClientId ?? clientIdString);
      
      console.log('✅ Handler assignment complete!');
      toast.success(handlerLabel ? 'Case handler assigned and stage updated to Handler Set.' : 'Case handler cleared.');
    } catch (error) {
      console.error('❌ Error updating case handler for success stage:', error);
      toast.error('Failed to update case handler. Please try again.');
    } finally {
      setIsUpdatingSuccessStageHandler(false);
    }
  };

  const getStageBadge = (stage: string | number, anchor: StageDropdownAnchor = 'badge') => {
    const stageName = getStageName(String(stage));
    const currentStageId = resolveStageId(stage);
    const currentStageIndex = sortedStages.findIndex(
      stageOption => resolveStageId(stageOption.id) === currentStageId
    );
    const dropdownRef = getDropdownRef(anchor);
    const stageColourFromList =
      sortedStages.find(stageOption => resolveStageId(stageOption.id) === currentStageId)?.colour ?? null;
    const fallbackStageColour = stageColourFromList || getStageColour(String(stage)) || '#ffffff';
    const badgeTextColour = getContrastingTextColor(fallbackStageColour);

    const previousStages =
      currentStageIndex > 0 ? sortedStages.slice(0, currentStageIndex) : [];
    const nextStages =
      currentStageIndex >= 0
        ? sortedStages.slice(currentStageIndex + 1)
        : sortedStages;

    const renderStageOption = (
      stageOption: { id: number; name: string },
      variant: 'previous' | 'next'
    ) => {
      const optionStageId = resolveStageId(stageOption.id);

      const stageColour =
        (sortedStages.find(option => resolveStageId(option.id) === optionStageId)?.colour ??
          getStageColour(String(stageOption.id))) || '#6b7280';
      const badgeTextColour = getContrastingTextColor(stageColour);

      return (
        <button
          key={`${variant}-${stageOption.id}`}
          type="button"
          className="w-full px-3 py-2.5 rounded-xl border border-transparent flex items-center justify-center transition-all group hover:opacity-80"
          onClick={() => {
            setStageDropdownAnchor(null);
            handleStageChange(stageOption.id);
          }}
        >
          <span
            className="inline-flex items-center justify-center px-3 py-1 rounded-lg text-sm font-semibold shadow-sm transition-opacity w-48"
            style={{
              backgroundColor: stageColour,
              color: badgeTextColour,
              boxShadow: '0 4px 10px rgba(17,24,39,0.12)',
            }}
          >
            {stageOption.name}
          </span>
        </button>
      );
    };

    const renderCurrentStage = () => (
      <div className="px-1">
        <span
          className="text-[11px] uppercase tracking-[0.32em] block mb-2 text-center"
          style={{ color: fallbackStageColour }}
        >
          Current
              </span>
        <button
          type="button"
          disabled
          className="w-full text-left px-4 py-3 rounded-xl border shadow-lg flex items-center justify-between cursor-default"
          style={{
            backgroundColor: fallbackStageColour,
            borderColor: fallbackStageColour,
            color: badgeTextColour,
            boxShadow: '0 10px 24px rgba(17,24,39,0.12)'
          }}
        >
              <div className="flex flex-col">
            <span className="text-sm font-semibold leading-tight">{stageName}</span>
            <span className="text-xs font-medium uppercase tracking-[0.22em]" style={{ color: badgeTextColour, opacity: 0.9 }}>
              Active stage
                </span>
              </div>
        </button>
            </div>
    );

    const renderTimelineOverlay = (overlayAnchor: StageDropdownAnchor) => (
      <div
        className={`absolute ${
          overlayAnchor === 'mobile' 
            ? 'left-1/2 transform -translate-x-1/2' 
            : overlayAnchor === 'badge' 
            ? 'right-0' 
            : 'right-0'
        } mt-2 w-72 rounded-2xl border border-base-300 bg-white dark:bg-base-100 shadow-2xl z-[60] overflow-hidden`}
      >
        <div
          ref={getListRef(overlayAnchor)}
          className="max-h-80 overflow-y-auto px-3 py-5 space-y-4"
        >
          {previousStages.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] uppercase tracking-[0.32em] text-base-content/60 block text-center">
                Previous
              </span>
              {previousStages.map(stageOption => renderStageOption(stageOption, 'previous'))}
            </div>
          )}
          {renderCurrentStage()}
          {nextStages.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] uppercase tracking-[0.32em] text-purple-400/80 dark:text-purple-300/70 block text-center">
                Upcoming
              </span>
              {nextStages.map(stageOption => renderStageOption(stageOption, 'next'))}
            </div>
          )}
        </div>
      </div>
    );

    return (
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          className={`badge badge-sm ${anchor === 'mobile' ? 'ml-0 px-3 py-1.5' : 'ml-2 px-4 py-2'} min-w-max whitespace-nowrap transition-transform duration-200 flex items-center ${
            isSuperuser 
              ? 'cursor-pointer hover:scale-[1.02]' 
              : 'cursor-default'
          }`}
          style={{
            background: fallbackStageColour,
            color: badgeTextColour,
            fontSize: anchor === 'mobile' ? '0.75rem' : '0.95rem',
            fontWeight: 600,
            borderRadius: anchor === 'mobile' ? '0.5rem' : '0.65rem',
            minHeight: anchor === 'mobile' ? '1.5rem' : '2rem',
            border: `2px solid ${fallbackStageColour}`,
            boxShadow: '0 8px 22px rgba(17, 24, 39, 0.12)',
          }}
          onClick={() => {
            if (isSuperuser) {
              // If current stage is "Communication started", open Update Lead drawer instead of dropdown
              if (areStagesEquivalent(stageName, 'Communication started')) {
                setShowUpdateDrawer(true);
                setStageDropdownAnchor(null);
                (document.activeElement as HTMLElement)?.blur();
              } else {
                setStageDropdownAnchor(prev => (prev === anchor ? null : anchor));
              }
            }
          }}
          disabled={!isSuperuser}
        >
          {stageName}
          {isSuperuser && <ChevronDownIcon className="w-3 h-3 ml-1" />}
        </button>
        {isSuperuser && stageDropdownAnchor === anchor && renderTimelineOverlay(anchor)}
      </div>
    );
  };

  const closeSchedulePanel = () => {
    setShowScheduleMeetingPanel(false);
    setMeetingFormData({
      date: '',
      time: '09:00',
      location: '',
      manager: '',
      helper: '',
      brief: '',
      attendance_probability: 'Medium',
      complexity: 'Simple',
      car_number: '',
      calendar: 'current',
      collection_manager: '',
      paid_category: '',
      paid_currency: '',
      meeting_total: '',
    });
    setMeetingType('regular');
    setNotifyClientOnSchedule(false); // Reset to default
  };

  // Function to test calendar access permissions
  const testCalendarAccess = async (accessToken: string, calendarEmail: string) => {
    try {
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calendarEmail)}/calendar`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`🔍 Calendar access test for ${calendarEmail}:`, {
        status: response.status,
        statusText: response.statusText
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Calendar access confirmed for ${calendarEmail}:`, data.name);
        return true;
      } else {
        const error = await response.json();
        console.error(`❌ Calendar access denied for ${calendarEmail}:`, error);
        return false;
      }
    } catch (error) {
      console.error(`❌ Calendar access test failed for ${calendarEmail}:`, error);
      return false;
    }
  };
  // Function to create calendar event in selected calendar
  const createCalendarEvent = async (accessToken: string, meetingDetails: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
    location: string;
    calendar?: string;
    manager?: string;
    helper?: string;
    brief?: string;
    attendance_probability?: string;
    complexity?: string;
    car_number?: string;
    expert?: string;
    amount?: number;
    currency?: string;
  }) => {
    // Determine which calendar to use based on selection
    const calendarEmail = meetingDetails.calendar === 'active_client' 
      ? 'shared-newclients@lawoffice.org.il' 
      : 'shared-potentialclients@lawoffice.org.il';
    
    console.log('Using calendar:', calendarEmail, 'for selection:', meetingDetails.calendar);
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calendarEmail)}/calendar/events`;
    
    console.log('🔍 Calendar creation details:', {
      calendarEmail,
      url,
      subject: meetingDetails.subject,
      startDateTime: meetingDetails.startDateTime,
      endDateTime: meetingDetails.endDateTime,
      location: meetingDetails.location
    });
    
    // Create detailed description with meeting information
    const description = [
      'Meeting Details:',
      `Manager: ${meetingDetails.manager || 'Not specified'}`,
      `Helper: ${meetingDetails.helper || 'Not specified'}`,
      `Expert: ${meetingDetails.expert || 'Not specified'}`,
      `Amount: ${meetingDetails.currency || '₪'}${meetingDetails.amount || 0}`,
      `Attendance Probability: ${meetingDetails.attendance_probability || 'Not specified'}`,
      `Complexity: ${meetingDetails.complexity || 'Not specified'}`,
      meetingDetails.car_number ? `Car Number: ${meetingDetails.car_number}` : '',
      meetingDetails.brief ? `Brief: ${meetingDetails.brief}` : '',
      '',
      'Generated by RMQ 2.0 System'
    ].filter(line => line !== '').join('\n');

    const body: any = {
      subject: meetingDetails.subject,
      start: {
        dateTime: meetingDetails.startDateTime,
        timeZone: 'UTC'
      },
      end: {
        dateTime: meetingDetails.endDateTime,
        timeZone: 'UTC'
      },
      location: {
        displayName: meetingDetails.location
      },
      body: {
        contentType: 'text',
        content: description
      },
      // Removed attendees to prevent automatic email invitations
      // attendees: (meetingDetails.attendees || []).map(a => ({
      //   emailAddress: {
      //     address: a.email
      //   },
      //   type: 'required'
      // }))
    };

    // Add Teams meeting properties only if location is Teams
    if (meetingDetails.location === 'Teams') {
      body.isOnlineMeeting = true;
      body.onlineMeetingProvider = 'teamsForBusiness';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Calendar event creation error:', {
        status: response.status,
        statusText: response.statusText,
        calendarEmail,
        error: error
      });
      
      // Provide more specific error messages
      let errorMessage = 'Failed to create calendar event';
      if (response.status === 403) {
        errorMessage = `Access denied to calendar ${calendarEmail}. Please check permissions.`;
      } else if (response.status === 404) {
        errorMessage = `Calendar ${calendarEmail} not found. Please verify the calendar exists.`;
      } else if (response.status === 400) {
        errorMessage = `Invalid request to calendar ${calendarEmail}. ${error.error?.message || ''}`;
      } else {
        errorMessage = error.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('Calendar event creation response:', data);
    console.log('Online meeting data:', data.onlineMeeting);
    console.log('Join URL:', data.onlineMeeting?.joinUrl);
    console.log('Web link:', data.webLink);
    
    const joinUrl = data.onlineMeeting?.joinUrl || data.webLink;
    console.log('Final join URL:', joinUrl);
    
    return {
      joinUrl: joinUrl,
      id: data.id,
      onlineMeeting: data.onlineMeeting
    };
  };

  const handleScheduleMeeting = async () => {
    if (!selectedClient) return;
    if (!instance || typeof instance.getAllAccounts !== 'function' || typeof instance.acquireTokenSilent !== 'function') {
      alert('Microsoft login is not available. Please try again later.');
      return;
    }
    setIsCreatingMeeting(true);
    try {
      const account = instance.getAllAccounts()[0];
      if (!account) {
        toast.error("You must be signed in to schedule a Teams meeting.", {
          duration: 4000,
          position: 'top-right',
        });
        setIsCreatingMeeting(false);
        return;
      }

      // Get current user's full_name from database to match scheduler dropdown values
      let currentUserFullName = '';
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', account.username)
          .single();
        if (userData?.full_name) {
          currentUserFullName = userData.full_name;
        }
      } catch (error) {
        console.log('Could not fetch user full_name');
      }

      console.log('Meeting creation debug:', {
        accountUsername: account.username,
        accountName: account.name,
        currentUserFullName: currentUserFullName,
        selectedClientId: selectedClient.id
      });

      let teamsMeetingUrl = '';
      const selectedLocation = meetingLocations.find(
        loc => loc.name === meetingFormData.location
      );

      // If this is a Teams meeting, create an online event via Graph as before.
      // Otherwise, if the chosen location has a default_link, use that as the join URL.
      if (meetingFormData.location === 'Teams') {
        // Create calendar event for all locations in potential clients calendar
        let accessToken;
        try {
          const response = await instance.acquireTokenSilent({
            ...loginRequest,
            account,
          });
          accessToken = response.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            // If silent acquisition fails, prompt the user to log in
            const response = await instance.loginPopup(loginRequest);
            accessToken = response.accessToken;
          } else {
            throw error; // Rethrow other errors
          }
        }

        // Convert date and time to start/end times
        const [year, month, day] = meetingFormData.date.split('-').map(Number);
        const [hours, minutes] = meetingFormData.time.split(':').map(Number);
        const start = new Date(year, month - 1, day, hours, minutes);
        const end = new Date(start.getTime() + 30 * 60000); // 30 min meeting

        // Test calendar access first (skip for legacy leads with potential_client calendar type)
        const isLegacyLeadForCalendar = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
        const calendarEmail = meetingFormData.calendar === 'active_client' 
          ? 'shared-newclients@lawoffice.org.il' 
          : 'shared-potentialclients@lawoffice.org.il';
        
        // Skip calendar access check for legacy leads when using potential_client calendar
        const shouldSkipCalendarCheck = isLegacyLeadForCalendar && meetingFormData.calendar !== 'active_client';
        
        if (!shouldSkipCalendarCheck) {
          console.log('🔍 Testing calendar access for:', calendarEmail);
          try {
            const hasAccess = await testCalendarAccess(accessToken, calendarEmail);
            if (!hasAccess) {
              // Show warning but continue - calendar creation will be attempted and will fail gracefully
              toast.error(`Cannot access calendar ${calendarEmail}. Meeting will still be created without calendar sync.`, {
                duration: 5000,
                position: 'top-right',
                style: {
                  background: '#f59e0b',
                  color: '#fff',
                  fontWeight: '500',
                  maxWidth: '500px',
                },
                icon: '🔒',
              });
            }
          } catch (accessError) {
            // If access check fails, show warning but continue
            console.warn('⚠️ Calendar access check failed:', accessError);
            toast.error(`Calendar access check failed. Meeting will still be created without calendar sync.`, {
              duration: 5000,
              position: 'top-right',
              style: {
                background: '#f59e0b',
                color: '#fff',
                fontWeight: '500',
                maxWidth: '500px',
              },
            });
          }
        } else {
          console.log('⏭️ Skipping calendar access check for legacy lead with potential_client calendar');
        }

        // Create calendar event with client name, category, and lead number in subject
        console.log('🔍 Selected client data for calendar:', {
          id: selectedClient.id,
          name: selectedClient.name,
          lead_number: selectedClient.lead_number,
          category: selectedClient.category,
          category_id: selectedClient.category_id,
          isLegacy: selectedClient.id.toString().startsWith('legacy_')
        });
        const categoryName = selectedClient.category || 'No Category';
        const meetingSubject = `[#${selectedClient.lead_number}] ${selectedClient.name} - ${categoryName} - Meeting`;
        console.log('Creating meeting in calendar:', meetingFormData.calendar);
        
        try {
          const calendarEventData = await createCalendarEvent(accessToken, {
            subject: meetingSubject,
            startDateTime: start.toISOString(),
            endDateTime: end.toISOString(),
            location: meetingFormData.location,
            calendar: meetingFormData.calendar,
            manager: meetingFormData.manager,
            helper: meetingFormData.helper,
            brief: '', // Brief removed from UI
            attendance_probability: meetingFormData.attendance_probability,
            complexity: meetingFormData.complexity,
            car_number: meetingFormData.car_number,
            expert: selectedClient.expert || '---',
            amount: 0, // Default amount for new meetings
            currency: '₪',
          });
          teamsMeetingUrl = calendarEventData.joinUrl;
          console.log('✅ Teams meeting URL set to:', teamsMeetingUrl);
        } catch (calendarError) {
          console.error('❌ Calendar creation failed:', calendarError);
          const errorMessage = calendarError instanceof Error ? calendarError.message : String(calendarError);
          // Show warning but continue with meeting creation
          toast.error(`Calendar sync failed: ${errorMessage}. Meeting will still be created.`, {
            duration: 5000,
            position: 'top-right',
            style: {
              background: '#f59e0b',
              color: '#fff',
              fontWeight: '500',
              maxWidth: '500px',
            },
          });
          // Continue without calendar event - meeting will be created without Teams URL
          teamsMeetingUrl = '';
        }
      } else if (selectedLocation?.default_link) {
        // For non-Teams online locations, use the default_link from tenants_meetinglocation
        teamsMeetingUrl = selectedLocation.default_link;
      }

      // Check if this is a legacy lead
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      
      // For both new and legacy leads, create meeting record in meetings table
      const legacyId = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : null;
      
      // Helper function to convert display name to employee ID
      const getEmployeeIdFromDisplayName = (displayName: string | null | undefined): number | null => {
        if (!displayName || displayName === '---' || displayName.trim() === '') return null;
        
        // Try exact match first
        let employee = allEmployees.find((emp: any) => 
          emp.display_name && emp.display_name.trim() === displayName.trim()
        );
        
        // If not found, try case-insensitive match
        if (!employee) {
          employee = allEmployees.find((emp: any) => 
            emp.display_name && emp.display_name.trim().toLowerCase() === displayName.trim().toLowerCase()
          );
        }
        
        if (!employee) {
          console.warn(`Employee not found for display name: "${displayName}"`);
          return null;
        }
        
        // Ensure ID is a number (bigint)
        const employeeId = typeof employee.id === 'string' ? parseInt(employee.id, 10) : Number(employee.id);
        if (isNaN(employeeId)) {
          console.error(`Invalid employee ID for "${displayName}":`, employee.id);
          return null;
        }
        
        return employeeId;
      };

      // Resolve collection manager employee ID (used mainly for paid meetings but safe for all)
      let collectionEmployeeId: string | number | null = null;
      if (meetingFormData.collection_manager) {
        const collectionEmp = allEmployees.find(
          emp => emp.display_name === meetingFormData.collection_manager
        );
        if (collectionEmp) {
          collectionEmployeeId = collectionEmp.id;
        }
      }

      // Resolve manager and helper employee IDs
      const managerEmployeeId = getEmployeeIdFromDisplayName(meetingFormData.manager);
      const helperEmployeeId = getEmployeeIdFromDisplayName(meetingFormData.helper);
      
      // Resolve scheduler employee ID (for legacy leads, need numeric ID)
      const schedulerEmployeeId = getEmployeeIdFromDisplayName(currentUserFullName);
      
      // Resolve expert employee ID (for legacy leads, need numeric ID)
      const expertEmployeeId = getEmployeeIdFromDisplayName(selectedClient.expert);

      // Resolve paid-meeting category (subcategory) if selected
      let paidCategoryId: string | null = null;
      let paidCategoryName: string | null = null;
      if (meetingType === 'paid' && meetingFormData.paid_category) {
        const paidCategory = categoryOptions.find(
          opt => opt.label === meetingFormData.paid_category
        );
        if (paidCategory) {
          paidCategoryId = paidCategory.id;
          // Stored "regular" category should be just the subcategory name without main category suffix
          paidCategoryName = paidCategory.label.includes(' (')
            ? paidCategory.label.split(' (')[0]
            : paidCategory.label;
        }
      }

      // Resolve meeting currency (for paid meetings use selected currency; otherwise keep default)
      const resolvedMeetingCurrency =
        meetingType === 'paid' && meetingFormData.paid_currency
          ? meetingFormData.paid_currency
          : '₪';

      // For paid meetings, the main lead meeting should use current timestamp
      // For regular meetings, use the date/time from the form
      let mainMeetingDate = meetingFormData.date;
      let mainMeetingTime = meetingFormData.time;
      
      if (meetingType === 'paid') {
        const now = new Date();
        mainMeetingDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
        mainMeetingTime = now.toTimeString().split(' ')[0].slice(0, 5); // HH:MM
      }

      const meetingData = {
        client_id: isLegacyLead ? null : selectedClient.id, // Use null for legacy leads
        legacy_lead_id: isLegacyLead ? legacyId : null, // Use legacy_lead_id for legacy leads
        meeting_date: mainMeetingDate,
        meeting_time: mainMeetingTime,
        meeting_location: meetingFormData.location,
        meeting_manager: meetingFormData.manager || '',
        meeting_currency: resolvedMeetingCurrency,
        meeting_amount:
          meetingType === 'paid' && meetingFormData.meeting_total
            ? Number(meetingFormData.meeting_total) || 0
            : 0,
        expert: selectedClient.expert || '---',
        helper: meetingFormData.helper || '---',
        teams_meeting_url: teamsMeetingUrl,
        meeting_brief: meetingFormData.brief || '',
        attendance_probability: meetingFormData.attendance_probability,
        complexity: meetingFormData.complexity,
        car_number: meetingFormData.car_number || '',
        scheduler: currentUserFullName, // Always use Supabase user's full_name
        last_edited_timestamp: new Date().toISOString(),
        last_edited_by: currentUserFullName,
        calendar_type: meetingFormData.calendar === 'active_client' ? 'active_client' : 'potential_client',
      };

      console.log('Attempting to insert meeting data:', meetingData);

      const { data: insertedData, error: meetingError } = await supabase
        .from('meetings')
        .insert([meetingData])
        .select();

      console.log('Database insert result:', { insertedData, meetingError });

      if (meetingError) {
        console.error('Meeting creation error:', meetingError);
        throw meetingError;
      }

      console.log('Meeting created successfully with scheduler:', currentUserFullName);
      console.log('Inserted meeting record:', insertedData);


      // Update lead stage based on context and set scheduler
      const stageActor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();

      // For paid meetings, use stage 60 (client signed agreement) for main lead
      // Otherwise use the normal target stage
      let mainLeadStageId: number;
      if (meetingType === 'paid') {
        const clientSignedStageId = getStageIdOrWarn('Client signed agreement');
        // Use 60 as fallback if lookup fails (60 is the ID for client signed agreement)
        mainLeadStageId = clientSignedStageId ?? 60;
      } else {
        const targetStageKey =
          scheduleStageTarget === 'another_meeting' ? 'another_meeting' : 'meeting_scheduled';
        const targetStageId = getStageIdOrWarn(targetStageKey);
        if (targetStageId === null) {
          toast.error(
            `Unable to resolve the "${targetStageKey === 'another_meeting' ? 'Another meeting' : 'Meeting scheduled'}" stage. Please contact an administrator.`
          );
          setIsCreatingMeeting(false);
          return;
        }
        mainLeadStageId = targetStageId;
      }

      if (isLegacyLead) {
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        const updatePayload: any = { 
          stage: mainLeadStageId,
          stage_changed_by: stageActor.fullName,
          stage_changed_at: stageTimestamp,
        };

        // Update scheduler for legacy leads (must be numeric employee ID, not display name)
        if (schedulerEmployeeId !== null) {
          updatePayload.meeting_scheduler_id = schedulerEmployeeId;
        }

        // Update manager and helper for legacy leads
        if (managerEmployeeId !== null) {
          updatePayload.meeting_manager_id = managerEmployeeId;
        }
        if (helperEmployeeId !== null) {
          updatePayload.meeting_lawyer_id = helperEmployeeId;
        }
        
        // Update expert for legacy leads (must be numeric employee ID, not display name)
        if (expertEmployeeId !== null) {
          updatePayload.expert_id = expertEmployeeId;
        }

        // For paid meetings, persist meeting_total and category/currency on legacy lead
        if (meetingType === 'paid') {
          if (meetingFormData.meeting_total) {
            // Legacy column is text, store as string
            updatePayload.meeting_total = meetingFormData.meeting_total;
          }
          if (paidCategoryId && paidCategoryName) {
            updatePayload.category_id = Number(paidCategoryId);
            updatePayload.category = paidCategoryName;
          }
        }

        // Always persist meeting_collection_id if a collection manager was chosen
        if (collectionEmployeeId) {
          updatePayload.meeting_collection_id = collectionEmployeeId;
        }

        const { error } = await supabase
          .from('leads_lead')
          .update(updatePayload)
          .eq('id', legacyId);

        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: mainLeadStageId,
          actor: stageActor,
          timestamp: stageTimestamp,
        });
      } else {
        const updatePayload: any = { 
          stage: mainLeadStageId,
          scheduler: currentUserFullName,
          stage_changed_by: stageActor.fullName,
          stage_changed_at: stageTimestamp,
        };

        // Update manager and helper for new leads (as employee IDs)
        if (managerEmployeeId !== null) {
          updatePayload.manager = managerEmployeeId;
        }
        if (helperEmployeeId !== null) {
          updatePayload.helper = helperEmployeeId;
        }

        // For paid meetings, persist meeting_total and category/currency on new lead
        if (meetingType === 'paid') {
          if (meetingFormData.meeting_total) {
            // New leads column is numeric
            updatePayload.meeting_total = Number(meetingFormData.meeting_total) || 0;
          }
          if (paidCategoryId && paidCategoryName) {
            updatePayload.category_id = paidCategoryId;
            updatePayload.category = paidCategoryName;
          }
        }

        // Always persist meeting_collection_id if a collection manager was chosen
        if (collectionEmployeeId) {
          updatePayload.meeting_collection_id = collectionEmployeeId;
        }

        const { error } = await supabase
          .from('leads')
          .update(updatePayload)
          .eq('id', selectedClient.id);

        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: mainLeadStageId,
          actor: stageActor,
          timestamp: stageTimestamp,
        });
      }

      // For paid meetings, create a sublead with stage 20 and a meeting with the drawer data
      // Note: The main lead meeting is already created above with current timestamp for paid meetings
      if (meetingType === 'paid' && !isLegacyLead) {
        // Create sublead asynchronously (non-blocking) so it doesn't delay the main flow
        (async () => {
          try {
            // Create a sublead with the same client data
            // Use the same logic as handleSaveSubLead to get masterBaseNumber
            const masterBaseNumber = (() => {
              if (selectedClient.lead_number && String(selectedClient.lead_number).trim() !== '') {
                const trimmed = String(selectedClient.lead_number).trim();
                return trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
              }
              if (selectedClient.master_id && String(selectedClient.master_id).trim() !== '') {
                const trimmed = String(selectedClient.master_id).trim();
                return trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
              }
              return '';
            })();

            if (!masterBaseNumber) {
              console.error('Unable to determine master lead number for sublead creation');
              toast.error('Unable to determine master lead number for sublead creation.');
              return;
            }

            // Add timeout protection for suffix computation (increased to 15 seconds)
            let nextSuffix: number;
            try {
              const suffixPromise = computeNextSubLeadSuffix(masterBaseNumber);
              const suffixTimeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Suffix computation timeout')), 15000)
              );
              nextSuffix = await Promise.race([suffixPromise, suffixTimeout]) as number;
            } catch (suffixError) {
              console.error('Error computing sublead suffix:', suffixError);
              // Skip sublead creation if suffix computation fails
              toast.error('Failed to compute sublead suffix. Sublead creation skipped, but main lead was updated successfully.');
              return; // Exit early, don't create sublead
            }
            
            const subLeadNumber = `${masterBaseNumber}/${nextSuffix}`;
            const masterIdValue = extractDigits(masterBaseNumber) ?? masterBaseNumber;
            
            // Simplified manual ID generation - use timestamp-based approach for speed
            // This avoids slow queries to legacy tables
            let manualIdString: string;
            try {
              // Try to get next available ID from new leads table only (faster)
              const { data: maxLeadData } = await supabase
                .from('leads')
                .select('manual_id')
                .not('manual_id', 'is', null)
                .order('manual_id', { ascending: false })
                .limit(1)
                .single();
              
              if (maxLeadData?.manual_id) {
                const maxId = BigInt(String(maxLeadData.manual_id));
                manualIdString = (maxId + BigInt(1)).toString();
              } else {
                // Fallback: use timestamp-based ID
                manualIdString = Date.now().toString();
              }
            } catch (error) {
              console.warn('Error getting manual ID, using timestamp fallback:', error);
              // Fallback: use timestamp-based ID
              manualIdString = Date.now().toString();
            }

            // Get stage 20 (meeting scheduled)
            const meetingScheduledStageId = getStageIdOrWarn('meeting_scheduled');
            if (meetingScheduledStageId === null) {
              toast.error('Unable to resolve the "Meeting scheduled" stage. Please contact an administrator.');
              setIsCreatingMeeting(false);
              return;
            }

            const parseNumericInput = (value: any) => {
              if (!value) return null;
              const parsed = Number(value);
              return Number.isFinite(parsed) ? parsed : null;
            };

            const meetingAmount = meetingType === 'paid' && meetingFormData.meeting_total
              ? parseNumericInput(meetingFormData.meeting_total) ?? 0
              : 0;

            const subLeadData: Record<string, any> = {
              manual_id: manualIdString,
              master_id: masterIdValue,
              lead_number: subLeadNumber,
              name: selectedClient.name,
              email: selectedClient.email || null,
              phone: selectedClient.phone || null,
              mobile: selectedClient.mobile || null,
              category: paidCategoryName || selectedClient.category || null,
              category_id: paidCategoryId || selectedClient.category_id || null,
              topic: selectedClient.topic || null,
              special_notes: selectedClient.special_notes || null,
              source: selectedClient.source || 'Manual',
              language: selectedClient.language || 'EN',
              tags: selectedClient.tags || null,
              stage: meetingScheduledStageId, // Stage 20
              probability: 0,
              balance: meetingAmount,
              balance_currency: resolvedMeetingCurrency,
              meeting_total: meetingAmount,
              meeting_total_currency: resolvedMeetingCurrency,
              proposal_total: meetingAmount,
              potential_value: null,
              handler: selectedClient.handler || null,
              case_handler_id: selectedClient.case_handler_id || null,
              scheduler: currentUserFullName,
              created_at: new Date().toISOString(),
              stage_changed_by: stageActor.fullName,
              stage_changed_at: stageTimestamp,
            };

            if (!subLeadData.category) {
              subLeadData.category = null;
            }

            // Insert the sublead (same as handleSaveSubLead)
            const { data: insertedSubLead, error: subLeadError } = await supabase
              .from('leads')
              .insert([subLeadData])
              .select('id')
              .single();

            if (subLeadError) {
              console.error('Error creating sublead:', subLeadError);
              throw subLeadError;
            }

            // 3. Create the first contact for the sublead (synchronously, same as handleSaveSubLead)
            if (insertedSubLead?.id) {
              // Get the next available contact ID
              const { data: maxContactId } = await supabase
                .from('leads_contact')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .single();
              
              const newContactId = maxContactId ? maxContactId.id + 1 : 1;
              const currentDate = new Date().toISOString().split('T')[0];
              
              // Insert the first contact
              const { error: contactError } = await supabase
                .from('leads_contact')
                .insert([{
                  id: newContactId,
                  name: selectedClient.name,
                  mobile: selectedClient.mobile || null,
                  phone: selectedClient.phone || null,
                  email: selectedClient.email || null,
                  newlead_id: insertedSubLead.id,
                  cdate: currentDate,
                  udate: currentDate
                }]);
              
              if (contactError) {
                console.error('Error creating contact for sublead:', contactError);
                // Continue even if contact creation fails
              } else {
                // Get the next available relationship ID
                const { data: maxRelationshipId } = await supabase
                  .from('lead_leadcontact')
                  .select('id')
                  .order('id', { ascending: false })
                  .limit(1)
                  .single();
                
                const newRelationshipId = maxRelationshipId ? maxRelationshipId.id + 1 : 1;
                
                // Create the relationship, marking it as main
                const { error: relationshipError } = await supabase
                  .from('lead_leadcontact')
                  .insert([{
                    id: newRelationshipId,
                    contact_id: newContactId,
                    newlead_id: insertedSubLead.id,
                    main: true
                  }]);
                
                if (relationshipError) {
                  console.error('Error creating contact relationship for sublead:', relationshipError);
                  // Continue even if relationship creation fails
                }
              }
            }

            // 4. Create a meeting for the sublead with the drawer data
            const subLeadMeetingData = {
              client_id: insertedSubLead.id,
              legacy_lead_id: null,
              meeting_date: meetingFormData.date,
              meeting_time: meetingFormData.time,
              meeting_location: meetingFormData.location,
              meeting_manager: meetingFormData.manager || '',
              meeting_currency: resolvedMeetingCurrency,
              meeting_amount: meetingAmount,
              expert: selectedClient.expert || '---',
              helper: meetingFormData.helper || '---',
              teams_meeting_url: teamsMeetingUrl,
              meeting_brief: meetingFormData.brief || '',
              attendance_probability: meetingFormData.attendance_probability,
              complexity: meetingFormData.complexity,
              car_number: meetingFormData.car_number || '',
              scheduler: currentUserFullName,
              last_edited_timestamp: new Date().toISOString(),
              last_edited_by: currentUserFullName,
              calendar_type: meetingFormData.calendar === 'active_client' ? 'active_client' : 'potential_client',
            };

            const { error: subLeadMeetingError } = await supabase
              .from('meetings')
              .insert([subLeadMeetingData]);

            if (subLeadMeetingError) {
              console.error('Error creating sublead meeting:', subLeadMeetingError);
              // Continue even if this fails - the sublead is already created
            }

            // Record stage change for sublead (non-blocking to avoid timeout)
            recordLeadStageChange({
              lead: { ...selectedClient, id: insertedSubLead.id, lead_number: subLeadNumber },
              stage: meetingScheduledStageId,
              actor: stageActor,
              timestamp: stageTimestamp,
            }).catch(err => {
              console.error('Error recording stage change for sublead (non-blocking):', err);
            });

            toast.success(`Sublead ${subLeadNumber} created and meeting scheduled!`, {
              duration: 5000,
              position: 'top-right',
              style: {
                background: '#ffffff',
                color: '#111827',
                fontWeight: '500',
                border: '1px solid #d1d5db',
              },
              icon: '✅',
            });
          } catch (subleadError) {
            console.error('Error in sublead creation process (non-blocking):', subleadError);
            // Continue - sublead creation is not critical for the main flow
            toast.error('Sublead creation encountered an issue, but main lead was updated successfully.', {
              duration: 5000,
            });
          }
        })();
      }

      // Automatically send the appropriate meeting invitation email (only for regular meetings, not paid, and if notify toggle is on)
      if (notifyClientOnSchedule && meetingType === 'regular' && insertedData && insertedData.length > 0 && selectedClient.email) {
        const newMeeting: any = {
          id: insertedData[0].id,
          client_id: insertedData[0].client_id,
          date: insertedData[0].meeting_date,
          time: insertedData[0].meeting_time,
          location: insertedData[0].meeting_location,
          manager: insertedData[0].meeting_manager,
          currency: insertedData[0].meeting_currency,
          amount: insertedData[0].meeting_amount,
          brief: insertedData[0].meeting_brief,
          scheduler: insertedData[0].scheduler || currentUserFullName,
          helper: insertedData[0].helper,
          expert: insertedData[0].expert,
          link: insertedData[0].teams_meeting_url || '',
          lastEdited: {
            timestamp: insertedData[0].last_edited_timestamp,
            user: insertedData[0].last_edited_by,
          },
        };

        // Determine the appropriate invitation type based on meeting location
        const location = (meetingFormData.location || '').toLowerCase();
        let invitationType: 'invitation' | 'invitation_jlm' | 'invitation_tlv' | 'invitation_tlv_parking' = 'invitation';
        
        if (location.includes('jrslm') || location.includes('jerusalem')) {
          invitationType = 'invitation_jlm';
        } else if (location.includes('tlv') && location.includes('parking')) {
          invitationType = 'invitation_tlv_parking';
        } else if (location.includes('tlv') || location.includes('tel aviv')) {
          invitationType = 'invitation_tlv';
        }

        console.log('🎯 [Clients.tsx] Auto-sending meeting invitation:', {
          location: meetingFormData.location,
          invitationType,
          clientEmail: selectedClient.email,
          meetingDate: newMeeting.date
        });
        
        // Actually send the meeting invitation email
        (async () => {
          console.log('🚀 STARTING email sending process...');
          try {
            console.log('🔐 Getting Microsoft account...');
            const account = instance.getAllAccounts()[0];
            if (!account) {
              console.error('❌ No Microsoft account found for email sending');
              return;
            }
            console.log('✅ Microsoft account found:', account.username);

            // Get access token
            console.log('🔑 Acquiring access token...');
            const tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account });
            console.log('✅ Access token acquired');
            
            // Fetch email template based on invitation type and language_id
            const templateMapping: Record<string, {en: number, he: number}> = {
              invitation: { en: 151, he: 152 }, // Regular meeting: EN=151, HE=152
              invitation_jlm: { en: 157, he: 158 },
              invitation_tlv: { en: 161, he: 162 },
              invitation_tlv_parking: { en: 159, he: 160 },
            };
            
            const templateIds = templateMapping[invitationType];
            
            // Use language_id from database (1=English, 2=Hebrew)
            // For legacy leads, fetch language_id from database if not available
            const isLegacyLeadForSchedule = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
            let clientLanguageIdForSchedule: number | null = selectedClient.language_id || null;
            
            if (isLegacyLeadForSchedule && !clientLanguageIdForSchedule) {
              const legacyIdForSchedule = selectedClient.id.toString().replace('legacy_', '');
              const { data: legacyData } = await supabase
                .from('leads_lead')
                .select('language_id')
                .eq('id', legacyIdForSchedule)
                .maybeSingle();
              clientLanguageIdForSchedule = legacyData?.language_id || null;
            } else if (!isLegacyLeadForSchedule && !clientLanguageIdForSchedule) {
              const { data: leadData } = await supabase
                .from('leads')
                .select('language_id')
                .eq('id', selectedClient.id)
                .maybeSingle();
              clientLanguageIdForSchedule = leadData?.language_id || null;
            }
            
            // Get language name from language_id to determine if Hebrew or English
            let isHebrew = false;
            if (clientLanguageIdForSchedule) {
              const { data: languageData } = await supabase
                .from('misc_language')
                .select('name')
                .eq('id', clientLanguageIdForSchedule)
                .maybeSingle();
              
              const languageName = languageData?.name?.toLowerCase() || '';
              isHebrew = languageName.includes('hebrew') || languageName.includes('עברית') || languageName === 'he';
            } else {
              // Fallback to text language field if language_id is not available
              isHebrew = selectedClient.language?.toLowerCase() === 'he' || 
                        selectedClient.language?.toLowerCase() === 'hebrew';
            }
            
            const templateId = isHebrew ? templateIds.he : templateIds.en;
            
            console.log('🌍 Language selection:', {
              language_id: clientLanguageIdForSchedule,
              language_text: selectedClient.language,
              isHebrew,
              selectedTemplateId: templateId,
              invitationType,
              isLegacyLead: isLegacyLeadForSchedule,
              fullClient: selectedClient
            });
            
            // Fetch the template (with RLS bypass if needed)
            let templateData = null;
            let templateError = null;
            
            try {
              console.log('🔍 Fetching template with ID:', templateId);
              const result = await supabase
                .from('misc_emailtemplate')
                .select('name, content')
                .eq('id', templateId)
                .maybeSingle(); // Use maybeSingle to avoid throwing on no results
              
              templateData = result.data;
              templateError = result.error;
              
              console.log('📧 Template fetch result:', { 
                templateId, 
                hasData: !!templateData, 
                hasError: !!templateError,
                errorMessage: templateError?.message,
                errorCode: templateError?.code,
                dataKeys: templateData ? Object.keys(templateData) : [],
                hasName: !!templateData?.name,
                hasContent: !!templateData?.content,
                nameLength: templateData?.name?.length || 0,
                contentLength: templateData?.content?.length || 0
              });
            } catch (fetchError) {
              console.error('❌ Template fetch exception:', fetchError);
              templateError = fetchError as any;
            }

            // Format meeting date and time
            const [year, month, day] = newMeeting.date.split('-');
            const formattedDate = `${day}/${month}/${year}`;
            const formattedTime = newMeeting.time ? newMeeting.time.substring(0, 5) : '';
            
            // Prepare email subject
            let subject = `Meeting with Decker, Pex, Levi Lawoffice - ${formattedDate}`;
            let body = '';
            
            if (!templateData || templateError) {
              console.warn('⚠️ Using FALLBACK email (template not usable):', {
                templateId,
                hasTemplateData: !!templateData,
                hasError: !!templateError,
                errorMessage: templateError?.message
              });
              // Fallback: Create a simple meeting invitation
              body = `
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <h2 style="color: #4218CC;">Meeting Invitation</h2>
                    <p>Dear ${selectedClient.name || 'Valued Client'},</p>
                    <p>You have a scheduled meeting with Decker, Pex, Levi Lawoffice.</p>
                    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                      <p><strong>Date:</strong> ${formattedDate}</p>
                      <p><strong>Time:</strong> ${formattedTime}</p>
                      <p><strong>Location:</strong> ${meetingFormData.location || 'TBD'}</p>
                      ${newMeeting.link ? `<p><strong>Meeting Link:</strong> <a href="${newMeeting.link}">${newMeeting.link}</a></p>` : ''}
                      ${selectedClient.category ? `<p><strong>Category:</strong> ${selectedClient.category}</p>` : ''}
                      ${selectedClient.topic ? `<p><strong>Topic:</strong> ${selectedClient.topic}</p>` : ''}
                    </div>
                    <p>We look forward to meeting with you.</p>
                    <p>Best regards,<br/>Decker, Pex, Levi Lawoffice</p>
                  </body>
                </html>
              `;
            } else {
              console.log('✅ Using email template:', templateId, 'Name:', templateData.name);
              console.log('📄 Raw template content (first 200 chars):', templateData.content?.substring(0, 200));
              
              // Step 1: Parse template content (handles JSON/delta format)
              const parsedContent = parseTemplateContent(templateData.content);
              console.log('🔄 Parsed template content (first 200 chars):', parsedContent.substring(0, 200));
              
              // Step 2: Format body with parameter replacement and line break conversion
              body = await formatEmailBody(
                parsedContent,
                selectedClient.name || 'Valued Client',
                {
                  client: selectedClient,
                  meetingDate: formattedDate,
                  meetingTime: formattedTime,
                  meetingLocation: meetingFormData.location || '',
                  meetingLink: newMeeting.link || ''
                }
              );
              
              // Use template name as subject if available
              if (templateData.name) {
                subject = templateData.name;
              }
              
              console.log('📝 Final email body prepared, length:', body.length);
            }
            
            // Check if recipient email is a Microsoft domain (for Outlook/Exchange)
            const isMicrosoftEmail = (email: string): boolean => {
              const microsoftDomains = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'onmicrosoft.com'];
              return microsoftDomains.some(domain => email.toLowerCase().includes(`@${domain}`));
            };
            
            const useOutlookCalendarInvite = isMicrosoftEmail(selectedClient.email);
            const recipientName = selectedClient.name || 'Valued Client';
            const locationName = meetingFormData.location || 'Office';
            
            // Build description HTML (category and topic removed)
            let descriptionHtml = `<p>Meeting with <strong>${recipientName}</strong></p>`;
            if (newMeeting.link) {
              descriptionHtml += `<p><strong>Join Link:</strong> <a href="${newMeeting.link}">${newMeeting.link}</a></p>`;
            }
            
            // Calendar subject (category and topic removed)
            const calendarSubject = `Meeting with Decker, Pex, Levi Lawoffice`;
            
            // Prepare date/time for calendar
            const startDateTime = new Date(`${newMeeting.date}T${formattedTime}:00`);
            const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 hour duration
            
            if (useOutlookCalendarInvite) {
              // For Microsoft email clients: Use Microsoft Graph API to create calendar event
              // This automatically sends a proper Outlook meeting invitation
              try {
                await createCalendarEventWithAttendee(tokenResponse.accessToken, {
                  subject: calendarSubject,
                  startDateTime: startDateTime.toISOString(),
                  endDateTime: endDateTime.toISOString(),
                  location: locationName === 'Teams' ? 'Microsoft Teams Meeting' : locationName,
                  description: descriptionHtml,
                  attendeeEmail: selectedClient.email,
                  attendeeName: recipientName,
                  organizerEmail: account.username || 'noreply@lawoffice.org.il',
                  organizerName: account?.name || 'Law Office',
                  teamsJoinUrl: locationName === 'Teams' ? newMeeting.link : undefined,
                  timeZone: 'Asia/Jerusalem'
                });
                
                console.log('✅ Outlook calendar invitation sent successfully');
              } catch (calendarError) {
                console.error('❌ Failed to create Outlook calendar event:', calendarError);
                // Fallback to regular email with ICS attachment
                throw calendarError;
              }
            } else {
              // For non-Microsoft email clients (Gmail, etc.): Send email with ICS attachment
              // Generate ICS calendar file attachment
              let attachments: Array<{ name: string; contentBytes: string; contentType?: string }> | undefined;
              try {
                const icsContent = generateICSFromDateTime({
                  subject: calendarSubject,
                  date: newMeeting.date,
                  time: formattedTime,
                  durationMinutes: 60,
                  location: locationName === 'Teams' ? 'Microsoft Teams Meeting' : locationName,
                  description: descriptionHtml.replace(/<[^>]+>/g, ''), // Strip HTML for ICS
                  organizerEmail: account.username || 'noreply@lawoffice.org.il',
                  organizerName: account?.name || 'Law Office',
                  attendeeEmail: selectedClient.email,
                  attendeeName: recipientName,
                  teamsJoinUrl: locationName === 'Teams' ? newMeeting.link : undefined,
                  timeZone: 'Asia/Jerusalem'
                });
                
                const icsBase64 = btoa(unescape(encodeURIComponent(icsContent)));
                
                attachments = [{
                  name: 'meeting-invite.ics',
                  contentBytes: icsBase64,
                  contentType: 'text/calendar; charset=utf-8; method=REQUEST'
                }];
                
                console.log('📅 ICS calendar file generated');
              } catch (icsError) {
                console.error('❌ Failed to generate ICS file:', icsError);
              }
              
              // Send email with ICS attachment
              await sendEmail(tokenResponse.accessToken, {
                to: selectedClient.email,
                subject,
                body,
                skipSignature: true, // Don't include user signature for template emails
                attachments
              });
              
              console.log('✅ Email with calendar invite sent successfully');
            }
            
            // Save email to database for tracking
            const now = new Date();
            try {
              const isLegacyLead = selectedClient.lead_type === 'legacy' || 
                                   (selectedClient.id && selectedClient.id.toString().startsWith('legacy_'));
              
              const emailRecord: any = {
                message_id: `meeting_invitation_${now.getTime()}_${Date.now()}`,
                thread_id: null,
                sender_name: account?.name || 'Law Office',
                sender_email: account.username || 'noreply@lawoffice.org.il',
                recipient_list: selectedClient.email,
                subject,
                body_html: body, // Full HTML body for display
                body_preview: body.substring(0, 200), // Store first 200 chars as preview
                sent_at: now.toISOString(),
                direction: 'outgoing', // Must be 'outgoing' not 'outbound'
                attachments: null,
              };
              
              // Set either client_id OR legacy_id, not both
              if (isLegacyLead) {
                const numericId = parseInt(selectedClient.id.toString().replace(/[^0-9]/g, ''), 10);
                emailRecord.legacy_id = isNaN(numericId) ? null : numericId; // FIXED: was legacy_lead_id
                emailRecord.client_id = null;
              } else {
                emailRecord.client_id = selectedClient.id || null;
                emailRecord.legacy_id = null; // FIXED: was legacy_lead_id
              }
              
              const { data, error } = await supabase.from('emails').insert(emailRecord).select();
              if (error) {
                console.error('❌ Database error saving email:', error);
                throw error;
              }
              console.log('📧 Email record saved to database:', {
                isLegacy: isLegacyLead,
                client_id: emailRecord.client_id,
                legacy_id: emailRecord.legacy_id,
                savedId: data?.[0]?.id
              });
              // Stage evaluation is handled automatically by database triggers
            } catch (dbError) {
              console.error('❌ Failed to save email to database:', dbError);
              // Don't fail the whole operation if DB save fails
            }
            
            toast.success('Meeting invitation sent!', { duration: 3000 });
          } catch (emailError) {
            console.error('❌ Error sending meeting invitation:', emailError);
            // Don't show error to user - meeting was created successfully
          }
        })();
      } else {
        console.log('⚠️ [Clients.tsx] Meeting created but email not sent:', {
          meetingType,
          hasInsertedData: !!insertedData,
          dataLength: insertedData?.length,
          hasClientEmail: !!selectedClient?.email
        });
      }

      // Update UI
      setShowScheduleMeetingPanel(false);
      setIsSchedulingMeeting(false);
      setIsCreatingMeeting(false);
      setSelectedStage(null); // Close the dropdown
      
      // Reset form and tab
      setMeetingFormData({
        date: '',
        time: '09:00',
        location: '',
        manager: '',
        helper: '',
        brief: '', // Keep for type compatibility, but field removed from UI
        attendance_probability: 'Medium',
        complexity: 'Simple',
        car_number: '',
        calendar: 'current',
        collection_manager: '',
        paid_category: '',
        paid_currency: '',
        meeting_total: '',
      });
      setMeetingType('regular');
      
      // Show success message
      toast.success('Meeting scheduled successfully!', {
        duration: 4000,
        position: 'top-right',
        style: {
          background: '#ffffff',
          color: '#111827',
          fontWeight: '500',
          border: '1px solid #d1d5db',
        },
        icon: '✅',
      });

      // Refresh client data
      console.log('Calling onClientUpdate after meeting creation');
      await onClientUpdate();
      console.log('onClientUpdate completed');
    } catch (error) {
      console.error('Error scheduling meeting:', error);
      toast.error('Failed to schedule meeting. Please try again.', {
        duration: 4000,
        position: 'top-right',
        style: {
          background: '#ef4444',
          color: '#fff',
          fontWeight: '500',
        },
        icon: '❌',
      });
      setIsCreatingMeeting(false);
    }
  };

  const handleMeetingEndedChange = (field: string, value: any) => {
    setMeetingEndedData(prev => ({ ...prev, [field]: value }));
  };

  // Initialize meeting ended data with proposal total and currency when drawer opens
  useEffect(() => {
    if (showMeetingEndedDrawer && selectedClient && currencies.length > 0) {
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      
      // Get proposal total
      let proposalTotal = '0.0';
      if (isLegacyLead) {
        // For legacy leads: use total or balance
        const totalValue = (selectedClient as any).total || selectedClient.balance;
        if (totalValue && Number(totalValue) > 0) {
          proposalTotal = typeof totalValue === 'number' ? totalValue.toString() : String(totalValue);
        }
      } else {
        // For new leads: use proposal_total or balance
        const totalValue = (selectedClient as any).proposal_total || selectedClient.balance;
        if (totalValue && Number(totalValue) > 0) {
          proposalTotal = typeof totalValue === 'number' ? totalValue.toString() : String(totalValue);
        }
      }

      // Get currency
      let proposalCurrency = '₪'; // Default
      if (isLegacyLead) {
        // For legacy leads: use balance_currency or convert currency_id to symbol
        if (selectedClient.balance_currency) {
          proposalCurrency = selectedClient.balance_currency;
        } else if ((selectedClient as any).currency_id) {
          const currencyId = (selectedClient as any).currency_id;
          // Use the existing getCurrencySymbol helper function
          proposalCurrency = getCurrencySymbol(currencyId, selectedClient.balance_currency || '₪');
        }
      } else {
        // For new leads: use proposal_currency or balance_currency
        proposalCurrency = (selectedClient as any).proposal_currency || selectedClient.balance_currency || '₪';
      }

      // Normalize currency to match dropdown format (ISO code or name)
      if (proposalCurrency && currencies.length > 0) {
        // Try to find matching currency in the list
        const matchingCurrency = currencies.find(c => 
          c.iso_code === proposalCurrency || 
          c.front_name === proposalCurrency || 
          c.name === proposalCurrency ||
          (proposalCurrency === '₪' && (c.iso_code === 'ILS' || c.iso_code === 'NIS')) ||
          (proposalCurrency === '$' && c.iso_code === 'USD') ||
          (proposalCurrency === '€' && c.iso_code === 'EUR') ||
          (proposalCurrency === '£' && c.iso_code === 'GBP')
        );
        if (matchingCurrency) {
          // Use the format that matches the dropdown (iso_code or name)
          proposalCurrency = matchingCurrency.iso_code || matchingCurrency.front_name || matchingCurrency.name || proposalCurrency;
        }
      }

      setMeetingEndedData(prev => ({
        ...prev,
        proposalTotal: proposalTotal !== '0.0' ? proposalTotal : prev.proposalTotal,
        proposalCurrency: proposalCurrency || prev.proposalCurrency,
      }));
    }
  }, [showMeetingEndedDrawer, selectedClient?.id, currencies.length]);

  const handleMeetingIrrelevant = () => {
    setMeetingIrrelevantReason('');
    setShowMeetingIrrelevantModal(true);
  };

  const handleCancelMeetingIrrelevant = () => {
    if (isProcessingMeetingIrrelevant) return;
    setShowMeetingIrrelevantModal(false);
    setMeetingIrrelevantReason('');
  };

  const handleConfirmMeetingIrrelevant = async () => {
    if (!selectedClient) return;

    const trimmedReason = meetingIrrelevantReason.trim();
    if (!trimmedReason) {
      toast.error('Please provide a reason for marking the lead as irrelevant');
      return;
    }

    setIsProcessingMeetingIrrelevant(true);

    try {
      const actor = await fetchStageActorInfo();
      const currentUserFullName = actor.fullName;
      const timestamp = new Date().toISOString();
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      const tableName = isLegacyLead ? 'leads_lead' : 'leads';
      const clientId = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : selectedClient.id;
      const stageValue = droppedStageId ?? manualStageIdFallbacks.droppedspamirrelevant ?? 91;
      if (stageValue === null || Number.isNaN(stageValue)) {
        toast.error('Unable to resolve the "Dropped (Spam/Irrelevant)" stage. Please contact an administrator.');
        setIsProcessingMeetingIrrelevant(false);
        return;
      }

      const updateData: Record<string, any> = {
        unactivated_by: currentUserFullName,
        unactivated_at: timestamp,
        unactivation_reason: trimmedReason,
        stage_changed_by: currentUserFullName,
        stage_changed_at: timestamp,
        stage: stageValue,
      };

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq('id', clientId);

      if (error) throw error;

      await recordLeadStageChange({
        lead: selectedClient,
        stage: stageValue,
        actor,
        timestamp,
      });

      toast.success('Lead marked as irrelevant successfully');
      setShowMeetingIrrelevantModal(false);
      setMeetingIrrelevantReason('');
      setShowMeetingEndedDrawer(false);
      await onClientUpdate();
    } catch (error) {
      console.error('Error marking lead as irrelevant:', error);
      toast.error('Failed to mark lead as irrelevant. Please try again.');
    } finally {
      setIsProcessingMeetingIrrelevant(false);
    }
  };
  const handleSendPriceOffer = async () => {
    if (!selectedClient) return;
    setIsSavingMeetingEnded(true);

    // Check if this is a legacy lead
    const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');

    // If proposalTotal is changed, update balance as well
    const proposalTotal = parseFloat(meetingEndedData.proposalTotal);
    const waitingStageId = getStageIdOrWarn('waiting_for_mtng_sum');
    if (waitingStageId === null) {
      toast.error('Unable to resolve the "Waiting for Mtng sum" stage. Please contact an administrator.');
      setIsSavingMeetingEnded(false);
      return;
    }

    try {
      const actor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();

      // First, find the most recent meeting to update it
      let meetings: any[] = [];
      let meetingsError: any = null;
      
      if (isLegacyLead) {
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        const { data, error } = await supabase
          .from('meetings')
          .select('id')
          .eq('legacy_lead_id', legacyId)
          .order('meeting_date', { ascending: false })
          .limit(1);
        meetings = data || [];
        meetingsError = error;
      } else {
        const { data, error } = await supabase
          .from('meetings')
          .select('id')
          .eq('client_id', selectedClient.id)
          .order('meeting_date', { ascending: false })
          .limit(1);
        meetings = data || [];
        meetingsError = error;
      }

      if (meetingsError) throw meetingsError;

      // If a meeting exists, update it with the brief and total
      if (meetings && meetings.length > 0) {
        const latestMeetingId = meetings[0].id;
        const { error: meetingUpdateError } = await supabase
          .from('meetings')
          .update({
            meeting_brief: meetingEndedData.meetingBrief,
            meeting_amount: proposalTotal,
            meeting_currency: meetingEndedData.proposalCurrency,
          })
          .eq('id', latestMeetingId);

        if (meetingUpdateError) throw meetingUpdateError;
      }

      // Update the lead based on type
      if (isLegacyLead) {
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        
        // Helper function to convert currency name to currency_id for legacy leads
        const currencyNameToId = (currencyName: string): number | null => {
          switch (currencyName) {
            case '₪': return 1; // NIS
            case '€': return 2; // EUR  
            case '$': return 3; // USD
            case '£': return 4; // GBP
            default: return 1; // Default to NIS
          }
        };
        
        const updateData: Record<string, any> = {
          probability: meetingEndedData.probability ? Number(meetingEndedData.probability) : null,
          meeting_brief: meetingEndedData.meetingBrief,
          no_of_applicants: meetingEndedData.numberOfApplicants ? Number(meetingEndedData.numberOfApplicants) : null,
          potential_total: proposalTotal ? String(proposalTotal) : null,
          total: proposalTotal ? String(proposalTotal) : null, // Sync total to proposal_total
          currency_id: currencyNameToId(meetingEndedData.proposalCurrency),
          stage: waitingStageId,
          stage_changed_by: actor.fullName,
          stage_changed_at: stageTimestamp,
        };

        const { error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);
        
        if (error) throw error;
      } else {
        const updateData: Record<string, any> = {
          probability: meetingEndedData.probability,
          meeting_brief: meetingEndedData.meetingBrief,
          number_of_applicants_meeting: meetingEndedData.numberOfApplicants,
          potential_applicants_meeting: meetingEndedData.potentialApplicants,
          proposal_total: proposalTotal,
          proposal_currency: meetingEndedData.proposalCurrency,
          balance: proposalTotal, // Sync balance to proposal_total
          balance_currency: meetingEndedData.proposalCurrency,
          stage: waitingStageId,
          stage_changed_by: actor.fullName,
          stage_changed_at: stageTimestamp,
        };

        const { error } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', selectedClient.id);
        
        if (error) throw error;
      }

      await recordLeadStageChange({
        lead: selectedClient,
        stage: waitingStageId,
        actor,
        timestamp: stageTimestamp,
      });
      
      setShowMeetingEndedDrawer(false);
      await onClientUpdate();
    } catch (error: any) {
      console.error('Error saving meeting ended data:', error);
      
      // Check if this is a category validation error from RLS policy
      if (error?.message && error.message.includes('category')) {
        toast.error('Please set a category for this client before performing this action.', {
          duration: 4000,
          style: {
            background: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #fecaca',
          },
        });
      } else {
        toast.error('Failed to save meeting data. Please ensure the new fields exist in the database.', {
          duration: 5000,
          position: 'top-right',
          style: {
            background: '#ef4444',
            color: '#fff',
            fontWeight: '500',
          },
          icon: '❌',
        });
      }
    } finally {
      setIsSavingMeetingEnded(false);
    }
  };
  const handleUpdateMeeting = async (details: any) => {
    // Implementation of handleUpdateMeeting
  };
  const handleSaveUpdateDrawer = async () => {
    if (!selectedClient) return;
    setIsSavingUpdate(true);
    try {
      // Check if this is a legacy lead
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      
      console.log('handleSaveUpdateDrawer - Is legacy lead:', isLegacyLead);
      
      // Check if already in "Communication started" stage
      const currentStageName = getStageName(selectedClient.stage);
      const isAlreadyCommunicationStarted = areStagesEquivalent(currentStageName, 'Communication started');
      
      const actor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();
      let updateData: Record<string, any>;
      const communicationStageId = getStageIdOrWarn('communication_started');
      if (!isLegacyLead && communicationStageId === null && !isAlreadyCommunicationStarted) {
        toast.error('Unable to resolve the "Communication started" stage. Please contact an administrator.');
        setIsSavingUpdate(false);
        return;
      }
      
      // Save follow-up to new follow_ups table
      if (nextFollowup) {
        console.log('💾 Saving follow-up to follow_ups table:', {
          leadId: selectedClient.id,
          nextFollowup,
          isLegacy: isLegacyLead
        });
        const { data: followUpData, error: followUpError } = await saveFollowUp(
          selectedClient.id,
          nextFollowup
          // userId will be fetched from current auth user in saveFollowUp
        );
        if (followUpError) {
          console.error('❌ Error saving follow-up:', followUpError);
          toast.error('Failed to save follow-up date. Please try again.');
          // Don't throw - continue with other updates
        } else {
          console.log('✅ Follow-up saved successfully:', followUpData);
        }
      } else {
        console.log('ℹ️ No follow-up date to save (nextFollowup is empty)');
      }
      
      if (isLegacyLead) {
        // For legacy leads, map fields to leads_lead table columns
        const legacyCommunicationStageId = communicationStageId ?? 15;
        updateData = {
          meeting_scheduling_notes: meetingNotes,
          followup_log: followup, // Map to followup_log column
          potential_applicants: potentialApplicants,
        };
        
        // Only update stage if not already in "Communication started" stage
        if (!isAlreadyCommunicationStarted) {
          updateData.stage = legacyCommunicationStageId;
          updateData.stage_changed_by = actor.fullName;
          updateData.stage_changed_at = stageTimestamp;
        }
        
        // For legacy leads, update the leads_lead table
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        console.log('Updating legacy lead with ID:', legacyId);
        
        const { error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);
        
        if (error) throw error;

        // Only record stage change if stage was actually changed
        if (!isAlreadyCommunicationStarted) {
        await recordLeadStageChange({
          lead: selectedClient,
          stage: legacyCommunicationStageId,
          actor,
          timestamp: stageTimestamp,
        });
        }

        // Insert history record for legacy leads
        const { error: historyError } = await supabase
          .from('scheduling_info_history')
          .insert({
            legacy_lead_id: legacyId,
            meeting_scheduling_notes: meetingNotes,
            next_followup: nextFollowup || null,
            followup_log: followup,
            created_by: actor.fullName,
          });

        if (historyError) {
          console.error('Error inserting scheduling history:', historyError);
          // Don't throw - history is not critical
        }
      } else {
        // For new leads, update the leads table
        updateData = {
          meeting_scheduling_notes: meetingNotes,
          followup: followup,
          potential_applicants: potentialApplicants,
        };
        
        // Only update stage if not already in "Communication started" stage
        if (!isAlreadyCommunicationStarted && communicationStageId !== null) {
          updateData.stage = communicationStageId;
          updateData.stage_changed_by = actor.fullName;
          updateData.stage_changed_at = stageTimestamp;
        }
        
        console.log('Updating new lead with ID:', selectedClient.id);
        
        const { error } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', selectedClient.id);
        
        if (error) throw error;

        // Only record stage change if stage was actually changed
        if (!isAlreadyCommunicationStarted && communicationStageId !== null) {
        await recordLeadStageChange({
          lead: selectedClient,
            stage: communicationStageId,
          actor,
          timestamp: stageTimestamp,
        });
        }

        // Insert history record for new leads
        const { error: historyError } = await supabase
          .from('scheduling_info_history')
          .insert({
            lead_id: selectedClient.id,
            meeting_scheduling_notes: meetingNotes,
            next_followup: nextFollowup || null,
            followup: followup,
            created_by: actor.fullName,
          });

        if (historyError) {
          console.error('Error inserting scheduling history:', historyError);
          // Don't throw - history is not critical
        }
      }
      
      setShowUpdateDrawer(false);
      setMeetingNotes('');
      setNextFollowup('');
      setFollowup('');
      setPotentialApplicants('');
      if (onClientUpdate) await onClientUpdate();
    } catch (err: any) {
      console.error('Error in handleSaveUpdateDrawer:', err);
      
      // Check if this is a category validation error from RLS policy
      if (err?.message && err.message.includes('category')) {
        toast.error('Please set a category for this client before performing this action.', {
          duration: 4000,
          style: {
            background: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #fecaca',
          },
        });
      } else {
        toast.error('Failed to update lead.');
      }
    } finally {
      setIsSavingUpdate(false);
    }
  };

  const openSendOfferModal = () => {
    if (!selectedClient) return;
    setShowSendOfferModal(true);
  };

  const handleOpenSignedDrawer = () => {
    const today = new Date();
    setSignedDate(today.toISOString().split('T')[0]);
    setShowSignedDrawer(true);
  };

  const handleSaveSignedDrawer = async () => {
    if (!selectedClient) return;
    
    try {
      const actor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();
      const signedStageId = getStageIdOrWarn('Client signed agreement');
      if (signedStageId === null) {
        alert('Unable to resolve the "Client signed agreement" stage. Please contact an administrator.');
        return;
      }

      // Use updateLeadStageWithHistory to ensure celebration triggers
      // Pass signedDate as stageDate so it's saved in leads_leadstage.date field
      // Note: We don't save date_signed in leads_lead table - it's only saved in leads_leadstage.date
      await updateLeadStageWithHistory({
        lead: selectedClient,
        stage: signedStageId,
        additionalFields: {}, // No additional fields - date is saved in leads_leadstage via stageDate
        actor,
        timestamp: stageTimestamp,
        stageDate: signedDate, // Pass the signed date to be used in leads_leadstage.date field
      });
      
      setShowSignedDrawer(false);
      await onClientUpdate();
    } catch (error) {
      console.error('Error updating signed agreement:', error);
      alert('Failed to update signed agreement. Please try again.');
    }
  };

  const handleOpenDeclinedDrawer = () => {
    setShowDeclinedDrawer(true);
  };

  const handleConfirmDeclined = async () => {
    if (!selectedClient) return;
    await updateLeadStage('client_declined');
    setShowDeclinedDrawer(false);
  };

  // Handle delete lead
  const handleDeleteLead = async () => {
    if (!selectedClient || !selectedClient.id) {
      console.error('❌ No client selected for deletion');
      toast.error('No lead selected for deletion');
      return;
    }

    console.log('🔍 Delete lead called with:', {
      id: selectedClient.id,
      lead_type: selectedClient.lead_type,
      lead_number: selectedClient.lead_number,
      name: selectedClient.name
    });

    setIsDeletingLead(true);
    try {
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      
      console.log('🔍 Deleting lead:', {
        id: selectedClient.id,
        lead_type: selectedClient.lead_type,
        isLegacyLead,
        lead_number: selectedClient.lead_number
      });
      
      if (isLegacyLead) {
        // Delete from leads_lead table
        let legacyId: number;
        
        if (typeof selectedClient.id === 'string') {
          // Remove 'legacy_' prefix if present
          const idString = selectedClient.id.replace('legacy_', '');
          legacyId = parseInt(idString, 10);
        } else {
          legacyId = Number(selectedClient.id);
        }
        
        if (isNaN(legacyId)) {
          console.error('❌ Invalid legacy ID:', selectedClient.id);
          toast.error('Invalid lead ID. Cannot delete.');
          setIsDeletingLead(false);
          return;
        }
        
        console.log('🔍 Attempting to delete legacy lead with ID:', legacyId);
        
        // First verify the lead exists
        const { data: existingLead } = await supabase
          .from('leads_lead')
          .select('id, name, manual_id')
          .eq('id', legacyId)
          .single();
        
        if (!existingLead) {
          console.warn('⚠️ Legacy lead not found, may have already been deleted');
          toast.error('Lead not found. It may have already been deleted.');
          setIsDeletingLead(false);
          return;
        }
        
        console.log('🔍 Legacy lead found, proceeding with deletion:', existingLead);
        
        // Use .select() to get the count of deleted rows
        const { data: deletedData, error } = await supabase
          .from('leads_lead')
          .delete()
          .eq('id', legacyId)
          .select();
        
        if (error) {
          console.error('❌ Error deleting legacy lead:', error);
          console.error('❌ Error details:', JSON.stringify(error, null, 2));
          toast.error(`Failed to delete lead: ${error.message || error.code || 'Unknown error'}`);
          setIsDeletingLead(false);
          return;
        }
        
        // Check if any rows were actually deleted
        if (!deletedData || deletedData.length === 0) {
          console.error('❌ No rows were deleted. This might be due to RLS policies or the lead not existing.');
          
          // Verify deletion by checking if lead still exists
          const { data: verifyDeleted } = await supabase
            .from('leads_lead')
            .select('id')
            .eq('id', legacyId)
            .maybeSingle();
          
          if (verifyDeleted) {
            console.error('❌ Legacy lead still exists after deletion attempt - likely RLS policy issue');
            toast.error('Failed to delete lead. You may not have permission to delete this lead, or it may be protected by database policies.');
          } else {
            console.log('✅ Legacy lead deleted (verification confirms it no longer exists)');
          }
          setIsDeletingLead(false);
          return;
        }
        
        console.log('✅ Legacy lead deleted successfully. Deleted rows:', deletedData.length);
      } else {
        // Delete from leads table (new leads)
        const leadId = selectedClient.id;
        
        console.log('🔍 Attempting to delete new lead with ID:', leadId);
        
        // First verify the lead exists
        const { data: existingLead } = await supabase
          .from('leads')
          .select('id, name, lead_number')
          .eq('id', leadId)
          .single();
        
        if (!existingLead) {
          console.warn('⚠️ Lead not found, may have already been deleted');
          toast.error('Lead not found. It may have already been deleted.');
          setIsDeletingLead(false);
          return;
        }
        
        console.log('🔍 Lead found, proceeding with deletion:', existingLead);
        
        // Use .select() to get the count of deleted rows
        const { data: deletedData, error } = await supabase
          .from('leads')
          .delete()
          .eq('id', leadId)
          .select();
        
        if (error) {
          console.error('❌ Error deleting new lead:', error);
          console.error('❌ Error details:', JSON.stringify(error, null, 2));
          toast.error(`Failed to delete lead: ${error.message || error.code || 'Unknown error'}`);
          setIsDeletingLead(false);
          return;
        }
        
        // Check if any rows were actually deleted
        if (!deletedData || deletedData.length === 0) {
          console.error('❌ No rows were deleted. This might be due to RLS policies or the lead not existing.');
          
          // Verify deletion by checking if lead still exists
          const { data: verifyDeleted } = await supabase
            .from('leads')
            .select('id')
            .eq('id', leadId)
            .maybeSingle();
          
          if (verifyDeleted) {
            console.error('❌ Lead still exists after deletion attempt - likely RLS policy issue');
            toast.error('Failed to delete lead. You may not have permission to delete this lead, or it may be protected by database policies.');
          } else {
            console.log('✅ Lead deleted (verification confirms it no longer exists)');
          }
          setIsDeletingLead(false);
          return;
        }
        
        console.log('✅ New lead deleted successfully. Deleted rows:', deletedData.length);
      }

      console.log('✅ Lead deletion completed successfully');
      toast.success('Lead deleted successfully');
      setShowDeleteModal(false);
      
      // Fetch the last lead to navigate to it
      try {
        console.log('🔍 Fetching last lead to navigate to...');
        
        // Try to get the last new lead first
        const { data: lastNewLead } = await supabase
          .from('leads')
          .select('id, lead_number')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (lastNewLead) {
          console.log('🔍 Found last new lead:', lastNewLead);
          navigate(`/clients/${lastNewLead.lead_number || lastNewLead.id}`);
          return;
        }
        
        // If no new leads, try to get the last legacy lead
        const { data: lastLegacyLead } = await supabase
          .from('leads_lead')
          .select('id, manual_id')
          .order('cdate', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (lastLegacyLead) {
          console.log('🔍 Found last legacy lead:', lastLegacyLead);
          const legacyId = lastLegacyLead.manual_id || lastLegacyLead.id;
          navigate(`/clients/${legacyId}`);
          return;
        }
        
        // If no leads at all, navigate to empty clients page
        console.log('🔍 No leads found, navigating to empty clients page');
        navigate('/clients');
      } catch (navError) {
        console.error('❌ Error fetching last lead for navigation:', navError);
        // Fallback to empty clients page if there's an error
        navigate('/clients');
      }
    } catch (error: any) {
      console.error('❌ Exception deleting lead:', error);
      console.error('❌ Exception stack:', error.stack);
      toast.error(`Failed to delete lead: ${error.message || 'Unknown error'}`);
      setIsDeletingLead(false);
    }
  };

  useEffect(() => {
    if (selectedClient) {
      // Get the correct currency for this lead (handles both new and legacy leads)
      const currentCurrency = getCurrencySymbol(
        selectedClient?.currency_id || selectedClient?.meeting_total_currency_id,
        selectedClient?.balance_currency
      );
      
      setEditLeadData({
        tags: selectedClient.tags || '',
        source: selectedClient.source || '',
        name: selectedClient.name || '',
        language: selectedClient.language || '',
        category: selectedClient.category || '',
        topic: selectedClient.topic || '',
        special_notes: selectedClient.special_notes || '',
        probability: selectedClient.probability || 0,
        number_of_applicants_meeting: selectedClient.number_of_applicants_meeting || '',
        potential_applicants_meeting: selectedClient.potential_applicants_meeting || '',
        balance: selectedClient.balance || selectedClient.total || '',
        next_followup: selectedClient.next_followup || '',
        balance_currency: currentCurrency,
      });
    }
  }, [selectedClient, currencies]);

  const handleEditLeadChange = (field: string, value: any) => {
    // For category field, keep the full formatted string (subcategory + main category)
    setEditLeadData(prev => ({ ...prev, [field]: value }));
  };

  // Fetch current lead tags for editing
  const fetchCurrentLeadTags = async (leadId: string) => {
    try {
      // Check if it's a legacy lead
      const isLegacyLead = leadId.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        const legacyId = parseInt(leadId.replace('legacy_', ''));
        const { data, error } = await supabase
          .from('leads_lead_tags')
          .select(`
            id,
            leadtag_id,
            misc_leadtag (
              id,
              name
            )
          `)
          .eq('lead_id', legacyId);
        
        if (!error && data) {
          const tags = data
            .filter(item => item.misc_leadtag && typeof item.misc_leadtag === 'object')
            .map(item => (item.misc_leadtag as any).name);
          
          // Join tags with comma and space
          const tagsString = tags.join(', ');
          setCurrentLeadTags(tagsString);
          return tagsString;
        } else {
          console.error('Error fetching current lead tags (legacy):', error);
          setCurrentLeadTags('');
          return '';
        }
      } else {
        // For new leads, fetch from leads_lead_tags table using newlead_id
        const { data, error } = await supabase
          .from('leads_lead_tags')
          .select(`
            id,
            leadtag_id,
            misc_leadtag (
              id,
              name
            )
          `)
          .eq('newlead_id', leadId);
        
        if (!error && data) {
          const tags = data
            .filter(item => item.misc_leadtag && typeof item.misc_leadtag === 'object')
            .map(item => (item.misc_leadtag as any).name);
          
          // Join tags with comma and space
          const tagsString = tags.join(', ');
          setCurrentLeadTags(tagsString);
          return tagsString;
        } else {
          console.error('Error fetching current lead tags (new):', error);
          setCurrentLeadTags('');
          return '';
        }
      }
    } catch (error) {
      console.error('Error fetching current lead tags:', error);
      setCurrentLeadTags('');
      return '';
    }
  };
  // Save lead tags
  const saveLeadTags = async (leadId: string, tagsString: string) => {
    try {
      const isLegacyLead = leadId.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        const legacyId = parseInt(leadId.replace('legacy_', ''));
        
        // First, remove all existing tags for this legacy lead
        const { error: deleteError } = await supabase
          .from('leads_lead_tags')
          .delete()
          .eq('lead_id', legacyId);
        
        if (deleteError) {
          console.error('Error deleting existing tags (legacy):', deleteError);
          return;
        }
        
        // Parse the tags string and find matching tag IDs
        if (tagsString.trim()) {
          const tagNames = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
          
          // Find tag IDs for the provided tag names
          const tagIds = tagNames
            .map(tagName => allTags.find(tag => tag.name === tagName)?.id)
            .filter(id => id !== undefined);
          
          // Insert new tags for legacy lead
          if (tagIds.length > 0) {
            const tagInserts = tagIds.map(tagId => ({
              lead_id: legacyId,
              leadtag_id: tagId
            }));
            
            const { error: insertError } = await supabase
              .from('leads_lead_tags')
              .insert(tagInserts);
            
            if (insertError) {
              console.error('Error inserting new tags (legacy):', insertError);
              return;
            }
          }
        }
        
      } else {
        // For new leads, use the newlead_id column
        // First, remove all existing tags for this new lead
        const { error: deleteError } = await supabase
          .from('leads_lead_tags')
          .delete()
          .eq('newlead_id', leadId);
        
        if (deleteError) {
          console.error('Error deleting existing tags (new):', deleteError);
          return;
        }
        
        // Parse the tags string and find matching tag IDs
        if (tagsString.trim()) {
          const tagNames = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
          
          // Find tag IDs for the provided tag names
          const tagIds = tagNames
            .map(tagName => allTags.find(tag => tag.name === tagName)?.id)
            .filter(id => id !== undefined);
          
          // Insert new tags for new lead
          if (tagIds.length > 0) {
            const tagInserts = tagIds.map(tagId => ({
              newlead_id: leadId,
              leadtag_id: tagId
            }));
            
            const { error: insertError } = await supabase
              .from('leads_lead_tags')
              .insert(tagInserts);
            
            if (insertError) {
              console.error('Error inserting new tags (new):', insertError);
              return;
            }
          }
        }
        
      }
    } catch (error) {
      console.error('Error saving tags:', error);
    }
  };

  const openEditLeadDrawer = async () => {
    // Get the correct currency for this lead (handles both new and legacy leads)
    const currentCurrency = getCurrencySymbol(
      selectedClient?.currency_id || selectedClient?.meeting_total_currency_id,
      selectedClient?.balance_currency
    );
    
    // Fetch current tags for this lead
    const tagsString = await fetchCurrentLeadTags(selectedClient?.id || '');
    
    // Fetch follow-up from follow_ups table for current user
    let followUpDate = '';
    let sourceName = selectedClient?.source || '';
    let languageName = selectedClient?.language || '';
    
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: userData } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', user.id)
        .single();
      
      if (userData && selectedClient) {
        const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
        
        if (isLegacyLead) {
          const legacyId = selectedClient.id.toString().replace('legacy_', '');
          
          // Fetch follow-up
          const { data: followUpData } = await supabase
            .from('follow_ups')
            .select('date')
            .eq('user_id', userData.id)
            .eq('lead_id', legacyId)
            .is('new_lead_id', null)
            .maybeSingle();
          
          if (followUpData?.date) {
            followUpDate = new Date(followUpData.date).toISOString().split('T')[0];
          }
          
          // Fetch source name from source_id for legacy leads
          if (selectedClient.source && !isNaN(Number(selectedClient.source))) {
            const sourceId = Number(selectedClient.source);
            const { data: sourceData } = await supabase
              .from('misc_leadsource')
              .select('name')
              .eq('id', sourceId)
              .maybeSingle();
            
            if (sourceData?.name) {
              sourceName = sourceData.name;
            }
          }
          
          // Language is already fetched as name from the joined table, so use it directly
          // But if it's an ID string, try to fetch the name
          if (selectedClient.language && !isNaN(Number(selectedClient.language))) {
            const languageId = Number(selectedClient.language);
            const { data: languageData } = await supabase
              .from('misc_language')
              .select('name')
              .eq('id', languageId)
              .maybeSingle();
            
            if (languageData?.name) {
              languageName = languageData.name;
            }
          }
        } else {
          const { data: followUpData } = await supabase
            .from('follow_ups')
            .select('date')
            .eq('user_id', userData.id)
            .eq('new_lead_id', selectedClient.id)
            .is('lead_id', null)
            .maybeSingle();
          
          if (followUpData?.date) {
            followUpDate = new Date(followUpData.date).toISOString().split('T')[0];
          }
        }
      }
    }
    
    // Reset the edit form data with current client data
    // Ensure probability is a number
    const probabilityValue = (() => {
      const prob = selectedClient?.probability;
      if (typeof prob === 'string') {
        return prob === '' ? 0 : (Number(prob) || 0);
      }
      return prob !== null && prob !== undefined ? Number(prob) : 0;
    })();
    
    setEditLeadData({
      tags: tagsString || selectedClient?.tags || '',
      source: sourceName,
      name: selectedClient?.name || '',
      language: languageName,
      category: selectedClient?.category || '',
      topic: selectedClient?.topic || '',
      special_notes: selectedClient?.special_notes || '',
      probability: probabilityValue,
      number_of_applicants_meeting: selectedClient?.number_of_applicants_meeting || '',
      potential_applicants_meeting: selectedClient?.potential_applicants_meeting || '',
      balance: selectedClient?.balance || selectedClient?.total || '',
      next_followup: followUpDate || '',
      balance_currency: currentCurrency,
    });
    setShowEditLeadDrawer(true);
  };
  const categoryOptions = useMemo(() => {
    const categories = allCategories || [];
    const options = categories
      .map(cat => {
        if (!cat) return null;
        const id = cat.id != null ? String(cat.id) : '';
        if (!id) return null;
        const mainName = cat.misc_maincategory?.name || null;
        const label = mainName ? `${mainName} › ${cat.name}` : cat.name || '';
        if (!label) return null;
        return {
          id,
          label,
          raw: cat,
        };
      })
      .filter(Boolean) as Array<{ id: string; label: string; raw: any }>;

    options.sort((a, b) => a.label.localeCompare(b.label));
    return options;
  }, [allCategories]);

  const categoryOptionsMap = useMemo(() => {
    const map = new Map<string, { id: string; label: string; raw: any }>();
    categoryOptions.forEach(opt => {
      map.set(opt.id, opt);
    });
    return map;
  }, [categoryOptions]);

  const handlerOptions = useMemo<HandlerOption[]>(() => {
    const employees = allEmployees || [];
    const map = new Map<string, string>();

    employees.forEach(emp => {
      if (!emp) return;
      const id = emp.id != null ? String(emp.id) : '';
      if (!id) return;

      const candidateName = emp.display_name || '';
      // Filter out emails and "Not assigned"
      if (!candidateName || 
          candidateName.includes('@') || 
          candidateName.toLowerCase() === 'not assigned') return;

      if (!map.has(id)) {
        map.set(id, candidateName);
      }
    });

    const options = Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return options;
  }, [allEmployees]);

  const handlerOptionsMap = useMemo(() => {
    const map = new Map<string, string>();
    handlerOptions.forEach(opt => {
      map.set(String(opt.id), opt.label);
    });
    return map;
  }, [handlerOptions]);

  // Filter success stage handler options when search term changes
  useEffect(() => {
    console.log('🔍 Filtering handler options, search term:', successStageHandlerSearch);
    if (!successStageHandlerSearch || successStageHandlerSearch.trim() === '') {
      console.log('📋 No search term, showing all options:', handlerOptions.length);
      setFilteredSuccessStageHandlerOptions(handlerOptions);
    } else {
      const searchLower = successStageHandlerSearch.toLowerCase();
      const filtered = handlerOptions.filter(option =>
        option.label.toLowerCase().includes(searchLower)
      );
      console.log('📋 Filtered options:', filtered.length, 'matches');
      setFilteredSuccessStageHandlerOptions(filtered);
    }
  }, [successStageHandlerSearch, handlerOptions]);

  // Track dropdown visibility changes
  useEffect(() => {
    console.log('👁️ Success handler dropdown visibility changed:', showSuccessStageHandlerDropdown);
  }, [showSuccessStageHandlerDropdown]);

useEffect(() => {
  if (!showSuccessDrawer) return;
  const currentLabel =
    successForm.handler ||
    (successForm.handlerId ? handlerOptionsMap.get(successForm.handlerId) || '' : '');
  setHandlerSearchTerm(currentLabel);
  setFilteredHandlerSearchOptions(handlerOptions);
}, [
  showSuccessDrawer,
  successForm.handler,
  successForm.handlerId,
  handlerOptions,
  handlerOptionsMap,
]);

useEffect(() => {
  const searchValue = handlerSearchTerm.trim().toLowerCase();
  if (!searchValue) {
    setFilteredHandlerSearchOptions(handlerOptions);
  } else {
    setFilteredHandlerSearchOptions(
      handlerOptions.filter(option => option.label.toLowerCase().includes(searchValue))
    );
  }
}, [handlerSearchTerm, handlerOptions]);

useEffect(() => {
  if (!showHandlerSearchDropdown) return;

  const handleClickOutside = (event: MouseEvent) => {
    if (
      handlerSearchContainerRef.current &&
      !handlerSearchContainerRef.current.contains(event.target as Node)
    ) {
      setShowHandlerSearchDropdown(false);
    }
  };

  document.addEventListener('mousedown', handleClickOutside);
  return () => {
    document.removeEventListener('mousedown', handleClickOutside);
  };
}, [showHandlerSearchDropdown]);

useEffect(() => {
  setFilteredSuccessStageHandlerOptions(handlerOptions);
}, [handlerOptions]);

useEffect(() => {
  if (!selectedClient) {
    setSuccessStageHandlerSearch('');
    return;
  }

  const handlerId =
    selectedClient.case_handler_id != null
      ? String(selectedClient.case_handler_id)
      : '';

  const derivedLabel =
    (handlerId && handlerOptionsMap.get(handlerId)) ||
    selectedClient.handler ||
    '';

  // If handler is "Not assigned" or empty, set search to empty (will show as placeholder)
  const handlerValue = (derivedLabel && derivedLabel.toLowerCase() !== 'not assigned' && derivedLabel.trim() !== '')
    ? derivedLabel
    : '';
  
  setSuccessStageHandlerSearch(handlerValue);
}, [
  selectedClient?.case_handler_id,
  selectedClient?.handler,
  selectedClient?.id,
  handlerOptionsMap,
]);

useEffect(() => {
  const searchValue = successStageHandlerSearch.trim().toLowerCase();
  // Filter out "Not assigned" from options
  const filteredOptions = handlerOptions.filter(option => 
    option.label.toLowerCase() !== 'not assigned'
  );
  
  if (!searchValue) {
    setFilteredSuccessStageHandlerOptions(filteredOptions);
  } else {
    setFilteredSuccessStageHandlerOptions(
      filteredOptions.filter(option => option.label.toLowerCase().includes(searchValue))
    );
  }
}, [successStageHandlerSearch, handlerOptions]);

useEffect(() => {
  if (!showSuccessStageHandlerDropdown) {
    console.log('🔴 Success handler dropdown is closed, not adding click-outside listener');
    return;
  }

  console.log('🟢 Success handler dropdown is open, adding click-outside listener');

  const handleClickOutside = (event: MouseEvent) => {
    const mobileContains = successStageHandlerContainerRef.current?.contains(event.target as Node);
    const desktopContains = successStageHandlerContainerRefDesktop.current?.contains(event.target as Node);
    
    console.log('🖱️ Click-outside handler fired', {
      target: event.target,
      hasMobileContainer: !!successStageHandlerContainerRef.current,
      hasDesktopContainer: !!successStageHandlerContainerRefDesktop.current,
      mobileContains,
      desktopContains
    });
    
    // Close dropdown only if click is outside BOTH containers
    if (!mobileContains && !desktopContains) {
      console.log('❌ Click was OUTSIDE both containers - closing dropdown');
      setShowSuccessStageHandlerDropdown(false);
    } else {
      console.log('✅ Click was INSIDE a container - keeping dropdown open');
    }
  };

  document.addEventListener('mousedown', handleClickOutside);
  return () => {
    console.log('🧹 Removing click-outside listener');
    document.removeEventListener('mousedown', handleClickOutside);
  };
}, [showSuccessStageHandlerDropdown]);

  const currencyOptions = useMemo(() => {
    if (currencies && currencies.length > 0) {
      return currencies
        .map(currency => {
          const display =
            currency.name ||
            currency.front_name ||
            currency.iso_code ||
            '';
          if (!display) return null;
          return {
            value: display,
            label: display,
          };
        })
        .filter(Boolean) as Array<{ value: string; label: string }>;
    }
    return [
      { value: '₪', label: '₪' },
      { value: '$', label: '$' },
      { value: '€', label: '€' },
      { value: '£', label: '£' },
    ];
  }, [currencies]);

  const handleSuccessFieldChange = useCallback(
    (field: keyof ClientSignedForm, value: string) => {
      setSuccessForm(prev => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  const handleSaveEditLead = async () => {
    if (!selectedClient) return;
    
    // Check if this is a legacy lead
    const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
    
    try {
      // Get current user name from Supabase users table
      const currentUserName = await fetchCurrentUserFullName();
      
      console.log('Current user for lead edit:', currentUserName);
      console.log('Is legacy lead:', isLegacyLead);
      
      // Create update data based on whether it's a legacy lead or not
      // Only include fields that have actually changed
      let updateData: any = {};
      
      if (isLegacyLead) {
        // For legacy leads, only include fields that exist in leads_lead table
        // Map balance to total and balance_currency to currency_id
        const currencyNameToId = (currencyName: string): number | null => {
          switch (currencyName) {
            case '₪': return 1; // NIS
            case '€': return 2; // EUR  
            case '$': return 3; // USD
            case '£': return 4; // GBP
            default: return 1; // Default to NIS
          }
        };
        
        // Check each field and only include if it has changed
        if (editLeadData.name !== selectedClient.name) {
          updateData.name = editLeadData.name;
        }
        if (editLeadData.topic !== selectedClient.topic) {
          updateData.topic = editLeadData.topic;
        }
        if (editLeadData.special_notes !== selectedClient.special_notes) {
          updateData.special_notes = editLeadData.special_notes;
          updateData.notes = editLeadData.special_notes; // Map special_notes to notes for legacy
        }
        // Compare probability values (handle both string and number formats)
        const currentProbability = typeof selectedClient.probability === 'string' 
          ? (selectedClient.probability === '' ? 0 : Number(selectedClient.probability) || 0)
          : (selectedClient.probability || 0);
        const newProbability = typeof editLeadData.probability === 'string'
          ? (editLeadData.probability === '' ? 0 : Number(editLeadData.probability) || 0)
          : (editLeadData.probability || 0);
        
        if (newProbability !== currentProbability) {
          updateData.probability = newProbability;
        }
        // Handle source - convert source name to source_id
        if (editLeadData.source !== selectedClient.source) {
          if (editLeadData.source && editLeadData.source.trim() !== '') {
            // Look up source_id from misc_leadsource table by name
            const { data: sourceData } = await supabase
              .from('misc_leadsource')
              .select('id')
              .eq('name', editLeadData.source)
              .maybeSingle();
            
            if (sourceData?.id) {
              updateData.source_id = sourceData.id;
            } else {
              // If source not found, try to parse as ID (in case user entered ID directly)
              const sourceId = parseInt(editLeadData.source);
              if (!isNaN(sourceId)) {
                updateData.source_id = sourceId;
              }
            }
          } else {
            updateData.source_id = null;
          }
        }
        // Handle language - convert language name to language_id
        if (editLeadData.language !== selectedClient.language) {
          if (editLeadData.language && editLeadData.language.trim() !== '') {
            // Look up language_id from misc_language table by name
            const { data: languageData } = await supabase
              .from('misc_language')
              .select('id')
              .eq('name', editLeadData.language)
              .maybeSingle();
            
            if (languageData?.id) {
              updateData.language_id = languageData.id;
            } else {
              // If language not found, try to parse as ID (in case user entered ID directly)
              const languageId = parseInt(editLeadData.language);
              if (!isNaN(languageId)) {
                updateData.language_id = languageId;
              }
            }
          } else {
            updateData.language_id = null;
          }
        }
        // Handle number_of_applicants_meeting - map to no_of_applicants for legacy
        if (editLeadData.number_of_applicants_meeting !== selectedClient.number_of_applicants_meeting) {
          // Handle empty string for numeric field
          let applicantsValue = null;
          if (editLeadData.number_of_applicants_meeting !== '' && editLeadData.number_of_applicants_meeting !== null && editLeadData.number_of_applicants_meeting !== undefined) {
            const parsed = Number(editLeadData.number_of_applicants_meeting);
            applicantsValue = isNaN(parsed) ? null : parsed;
          }
          updateData.no_of_applicants = applicantsValue;
        }
        // Follow-up is now handled separately in follow_ups table - don't include in updateData
        if (editLeadData.balance !== selectedClient.balance) {
          // Handle empty string for balance field
          const balanceValue = editLeadData.balance === '' || editLeadData.balance === null ? null : String(editLeadData.balance);
          updateData.total = balanceValue; // Convert to string for text column
        }
        if (editLeadData.balance_currency !== selectedClient.balance_currency) {
          updateData.currency_id = currencyNameToId(editLeadData.balance_currency); // Map currency name to ID
        }
        if (editLeadData.category !== selectedClient.category) {
          // Find the exact category ID from the formatted category name for legacy leads
          // We need to match both the subcategory name AND the main category name
          const fullCategoryString = editLeadData.category;
          const foundCategory = allCategories.find((cat: any) => {
            const expectedFormat = cat.misc_maincategory?.name 
              ? `${cat.name} (${cat.misc_maincategory.name})`
              : cat.name;
            return expectedFormat === fullCategoryString;
          });
          
          if (foundCategory) {
            updateData.category_id = foundCategory.id;
            updateData.category = foundCategory.name; // Save just the subcategory name
          } else {
            // Fallback: try to find by subcategory name only (less precise)
            const categoryName = editLeadData.category.includes(' (') ? editLeadData.category.split(' (')[0] : editLeadData.category;
            const fallbackCategory = allCategories.find((cat: any) => 
              cat.name.toLowerCase().trim() === categoryName.toLowerCase().trim()
            );
            
            if (fallbackCategory) {
              updateData.category_id = fallbackCategory.id;
              updateData.category = categoryName;
            } else {
              updateData.category = editLeadData.category; // Final fallback
            }
          }
        }
        
        // Handle tags separately for legacy leads (using saveLeadTags function)
        const currentTagsString = await fetchCurrentLeadTags(selectedClient.id);
        if (editLeadData.tags !== currentTagsString) {
          await saveLeadTags(selectedClient.id, editLeadData.tags);
        }
      } else {
        // For regular leads, check each field and only include if it has changed
        if (editLeadData.tags !== selectedClient.tags) {
          // Use saveLeadTags function for proper tag management
          await saveLeadTags(selectedClient.id, editLeadData.tags);
        }
        if (editLeadData.source !== selectedClient.source) {
          updateData.source = editLeadData.source;
        }
        if (editLeadData.name !== selectedClient.name) {
          updateData.name = editLeadData.name;
        }
        if (editLeadData.language !== selectedClient.language) {
          updateData.language = editLeadData.language;
        }
        if (editLeadData.category !== selectedClient.category) {
          // Find the exact category ID from the formatted category name
          // We need to match both the subcategory name AND the main category name
          const fullCategoryString = editLeadData.category;
          const foundCategory = allCategories.find((cat: any) => {
            const expectedFormat = cat.misc_maincategory?.name 
              ? `${cat.name} (${cat.misc_maincategory.name})`
              : cat.name;
            return expectedFormat === fullCategoryString;
          });
          
          if (foundCategory) {
            updateData.category_id = foundCategory.id;
            updateData.category = foundCategory.name; // Save just the subcategory name
          } else {
            // Fallback: try to find by subcategory name only (less precise)
            const categoryName = editLeadData.category.includes(' (') ? editLeadData.category.split(' (')[0] : editLeadData.category;
            const fallbackCategory = allCategories.find((cat: any) => 
              cat.name.toLowerCase().trim() === categoryName.toLowerCase().trim()
            );
            
            if (fallbackCategory) {
              updateData.category_id = fallbackCategory.id;
              updateData.category = categoryName;
            } else {
              updateData.category = editLeadData.category; // Final fallback
            }
          }
        }
        if (editLeadData.topic !== selectedClient.topic) {
          updateData.topic = editLeadData.topic;
        }
        if (editLeadData.special_notes !== selectedClient.special_notes) {
          updateData.special_notes = editLeadData.special_notes;
        }
        // Compare probability values (handle both string and number formats)
        const currentProbabilityNew = typeof selectedClient.probability === 'string' 
          ? (selectedClient.probability === '' ? 0 : Number(selectedClient.probability) || 0)
          : (selectedClient.probability || 0);
        const newProbabilityNew = typeof editLeadData.probability === 'string'
          ? (editLeadData.probability === '' ? 0 : Number(editLeadData.probability) || 0)
          : (editLeadData.probability || 0);
        
        if (newProbabilityNew !== currentProbabilityNew) {
          updateData.probability = newProbabilityNew;
        }
        if (editLeadData.number_of_applicants_meeting !== selectedClient.number_of_applicants_meeting) {
          // Handle empty string for numeric field
          let applicantsValue = null;
          if (editLeadData.number_of_applicants_meeting !== '' && editLeadData.number_of_applicants_meeting !== null && editLeadData.number_of_applicants_meeting !== undefined) {
            const parsed = Number(editLeadData.number_of_applicants_meeting);
            applicantsValue = isNaN(parsed) ? null : parsed;
          }
          updateData.number_of_applicants_meeting = applicantsValue;
        }
        if (editLeadData.potential_applicants_meeting !== selectedClient.potential_applicants_meeting) {
          // Handle empty string for numeric field
          let potentialValue = null;
          if (editLeadData.potential_applicants_meeting !== '' && editLeadData.potential_applicants_meeting !== null && editLeadData.potential_applicants_meeting !== undefined) {
            const parsed = Number(editLeadData.potential_applicants_meeting);
            potentialValue = isNaN(parsed) ? null : parsed;
          }
          updateData.potential_applicants_meeting = potentialValue;
        }
        if (editLeadData.balance !== selectedClient.balance) {
          // Handle empty string for numeric field
          let balanceValue = null;
          if (editLeadData.balance !== '' && editLeadData.balance !== null && editLeadData.balance !== undefined) {
            const parsed = Number(editLeadData.balance);
            balanceValue = isNaN(parsed) ? null : parsed;
          }
          updateData.balance = balanceValue;
        }
        // Follow-up is now handled separately in follow_ups table - don't include in updateData
        if (editLeadData.balance_currency !== selectedClient.balance_currency) {
          updateData.balance_currency = editLeadData.balance_currency;
        }
      }
      
      // Track changes by comparing old and new values
      const changesToInsert = [];
      
      // Since we only include changed fields in updateData, we can directly track them
      const fieldsToTrack = Object.keys(updateData);
      const fieldMapping: { [key: string]: string } = isLegacyLead ? {
        'total': 'balance',
        'currency_id': 'balance_currency',
        'notes': 'special_notes',
        'category_id': 'category'
      } : {
        'category_id': 'category'
      };
      
      for (const field of fieldsToTrack) {
        // For legacy leads, map the field names to match the client data structure
        const clientField = fieldMapping[field] || field;
        const oldValue = selectedClient[clientField as keyof typeof selectedClient] || '';
        const newValue = updateData[field as keyof typeof updateData] || '';
        
        // Convert to strings for comparison
        let oldValueStr = String(oldValue);
        let newValueStr = String(newValue);
        
        // Special handling for currency_id comparison
        if (field === 'currency_id' && isLegacyLead) {
          // Convert the current currency name to ID for comparison
          const currencyNameToId = (currencyName: string): string => {
            switch (currencyName) {
              case '₪': return '1';
              case '€': return '2';
              case '$': return '3';
              case '£': return '4';
              default: return '1';
            }
          };
          oldValueStr = currencyNameToId(String(oldValue));
        }
        
        console.log(`${field} changed: ${oldValueStr} -> ${newValueStr}`);
        changesToInsert.push({
          lead_id: selectedClient.id,
          field_name: clientField, // Use the mapped field name for tracking
          old_value: oldValueStr,
          new_value: newValueStr,
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }
      
      console.log('Total changes detected:', changesToInsert.length);
      console.log('Changes to insert:', changesToInsert);
      
      // If no changes were detected, don't proceed with the update
      if (Object.keys(updateData).length === 0) {
        console.log('No changes detected, skipping update');
        setShowEditLeadDrawer(false);
        return;
      }
      
      let updateError;
      
      if (isLegacyLead) {
        // For legacy leads, update the leads_lead table
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        console.log('Updating legacy lead with ID:', legacyId);
        
        const { error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);
        
        updateError = error;
      } else {
        // For regular leads, update the leads table
        console.log('Updating regular lead with ID:', selectedClient.id);
        
        const { error } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', selectedClient.id);
        
        updateError = error;
      }
        
      if (updateError) {
        console.error('Error updating lead:', updateError);
        toast.error('Failed to update lead.');
        return;
      }
      
      // Handle follow-up save/update in follow_ups table
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', user.id)
          .single();
        
        if (userData) {
          // Fetch current follow-up to compare
          let currentFollowUp;
          if (isLegacyLead) {
            const legacyId = selectedClient.id.toString().replace('legacy_', '');
            const { data } = await supabase
              .from('follow_ups')
              .select('id, date')
              .eq('user_id', userData.id)
              .eq('lead_id', legacyId)
              .is('new_lead_id', null)
              .maybeSingle();
            currentFollowUp = data;
          } else {
            const { data } = await supabase
              .from('follow_ups')
              .select('id, date')
              .eq('user_id', userData.id)
              .eq('new_lead_id', selectedClient.id)
              .is('lead_id', null)
              .maybeSingle();
            currentFollowUp = data;
          }
          
          const currentFollowUpDate = currentFollowUp?.date ? new Date(currentFollowUp.date).toISOString().split('T')[0] : '';
          const newFollowUpDate = editLeadData.next_followup || '';
          
          if (currentFollowUpDate !== newFollowUpDate) {
            if (newFollowUpDate && newFollowUpDate.trim() !== '') {
              // Update or create follow-up
              if (currentFollowUp) {
                // Update existing
                const { error: followupError } = await supabase
                  .from('follow_ups')
                  .update({ date: newFollowUpDate + 'T00:00:00Z' })
                  .eq('id', currentFollowUp.id)
                  .eq('user_id', userData.id);
                
                if (followupError) {
                  console.error('Error updating follow-up:', followupError);
                  toast.error('Failed to update follow-up date');
                }
              } else {
                // Create new
                const insertData: any = {
                  user_id: userData.id,
                  date: newFollowUpDate + 'T00:00:00Z',
                  created_at: new Date().toISOString()
                };
                
                if (isLegacyLead) {
                  const legacyId = selectedClient.id.toString().replace('legacy_', '');
                  insertData.lead_id = legacyId;
                  insertData.new_lead_id = null;
                } else {
                  insertData.new_lead_id = selectedClient.id;
                  insertData.lead_id = null;
                }
                
                const { error: followupError } = await supabase
                  .from('follow_ups')
                  .insert(insertData);
                
                if (followupError) {
                  console.error('Error creating follow-up:', followupError);
                  toast.error('Failed to save follow-up date');
                }
              }
            } else {
              // Delete follow-up if date is empty
              if (currentFollowUp) {
                const { error: followupError } = await supabase
                  .from('follow_ups')
                  .delete()
                  .eq('id', currentFollowUp.id)
                  .eq('user_id', userData.id);
                
                if (followupError) {
                  console.error('Error deleting follow-up:', followupError);
                  toast.error('Failed to delete follow-up');
                }
              }
            }
          }
        }
      }
      
      // Log the changes to lead_changes table (only for regular leads, as legacy leads don't have this table)
      if (!isLegacyLead && changesToInsert.length > 0) {
        const { error: historyError } = await supabase
          .from('lead_changes')
          .insert(changesToInsert);
        
        if (historyError) {
          console.error('Error logging lead changes:', historyError);
        } else {
          console.log('Logged', changesToInsert.length, 'field changes');
        }
      }
      
      setShowEditLeadDrawer(false);
      if (onClientUpdate) await onClientUpdate();
      toast.success('Lead updated!');
      
    } catch (error) {
      console.error('Error in handleSaveEditLead:', error);
      toast.error('Failed to update lead.');
    }
  };
  // Handler for canceling meeting only
  const handleCancelMeeting = async () => {
    if (!selectedClient || !meetingToDelete) return;
    try {
      const account = instance.getAllAccounts()[0];
      
      // 1. Cancel the meeting (set status to 'canceled')
      const { data: { user } } = await supabase.auth.getUser();
      const editor = user?.email || account?.name || 'system';
      const { error: cancelError } = await supabase
        .from('meetings')
        .update({ 
          status: 'canceled', 
          last_edited_timestamp: new Date().toISOString(), 
          last_edited_by: editor 
        })
        .eq('id', meetingToDelete);
      
      if (cancelError) throw cancelError;

      // 2. Get meeting details for email
      const { data: canceledMeeting, error: fetchError } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', meetingToDelete)
        .single();
      
      if (fetchError) throw fetchError;

      // 3. Send cancellation email to client (only if notify toggle is on)
      if (notifyClientOnReschedule && selectedClient.email && canceledMeeting) {
        let accessToken;
        try {
          const response = await instance.acquireTokenSilent({ ...loginRequest, account });
          accessToken = response.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            const response = await instance.loginPopup(loginRequest);
            accessToken = response.accessToken;
          } else {
            throw error;
          }
        }
        
        // Determine language for template selection (same logic as schedule meeting)
        // Template ID 153 = English cancellation, 154 = Hebrew cancellation
        // For legacy leads, fetch language_id from database if not available
        const isLegacyLeadForCancel = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
        let clientLanguageId: number | null = selectedClient.language_id || null;
        
        if (isLegacyLeadForCancel && !clientLanguageId) {
          const legacyIdForCancel = selectedClient.id.toString().replace('legacy_', '');
          const { data: legacyData } = await supabase
            .from('leads_lead')
            .select('language_id')
            .eq('id', legacyIdForCancel)
            .maybeSingle();
          clientLanguageId = legacyData?.language_id || null;
        } else if (!isLegacyLeadForCancel && !clientLanguageId) {
          const { data: leadData } = await supabase
            .from('leads')
            .select('language_id')
            .eq('id', selectedClient.id)
            .maybeSingle();
          clientLanguageId = leadData?.language_id || null;
        }
        
        // Get language name from language_id to determine if Hebrew or English
        let templateId: number = 153; // Default to English
        if (clientLanguageId) {
          const { data: languageData } = await supabase
            .from('misc_language')
            .select('name')
            .eq('id', clientLanguageId)
            .maybeSingle();
          
          const languageName = languageData?.name?.toLowerCase() || '';
          const isHebrew = languageName.includes('hebrew') || languageName.includes('עברית') || languageName === 'he';
          templateId = isHebrew ? 154 : 153; // HE: 154, EN: 153
        } else {
          // Fallback to text language field if language_id is not available
          const isHebrewByText = selectedClient.language?.toLowerCase() === 'he' || 
                                 selectedClient.language?.toLowerCase() === 'hebrew';
          templateId = isHebrewByText ? 154 : 153;
        }
        
        const isHebrew = templateId === 154;
        
        console.log('🌍 Cancellation email language selection:', {
          language_id: clientLanguageId,
          language_text: selectedClient.language,
          isHebrew,
          selectedTemplateId: templateId,
          isLegacyLead: isLegacyLeadForCancel,
          fullClient: selectedClient
        });
        
        // Fetch email template by ID (including name for subject)
        let templateContent: string | null = null;
        let templateName: string | null = null;
        
        try {
          console.log('📧 Fetching cancellation email template:', { templateId, isHebrew });
          
          const { data: template, error: templateError } = await supabase
            .from('misc_emailtemplate')
            .select('name, content')
            .eq('id', templateId)
            .single();
          
          if (templateError) {
            console.error('❌ Error fetching cancellation email template:', {
              error: templateError,
              code: templateError.code,
              message: templateError.message,
              details: templateError.details,
              hint: templateError.hint,
              templateId,
              isHebrew,
              language_id: selectedClient.language_id,
              language_text: selectedClient.language
            });
          } else if (template && template.content) {
            const parsed = parseTemplateContent(template.content);
            templateContent = parsed && parsed.trim() ? parsed : template.content;
            templateName = template.name || null;
            console.log('✅ Cancellation email template fetched successfully', {
              templateId,
              templateName,
              isHebrew,
              language_id: selectedClient.language_id,
              language_text: selectedClient.language,
              rawLength: template.content.length,
              parsedLength: parsed?.length || 0,
              finalLength: templateContent?.length || 0,
              usingRaw: !parsed || !parsed.trim()
            });
          } else {
            console.warn('⚠️ Template fetched but content is empty or null', {
              templateId,
              hasTemplate: !!template,
              hasContent: !!(template?.content),
              isHebrew,
              language_id: selectedClient.language_id,
              language_text: selectedClient.language
            });
          }
        } catch (error) {
          console.error('❌ Exception fetching cancellation email template:', error);
        }
        
        const formattedDate = canceledMeeting.meeting_date ? new Date(canceledMeeting.meeting_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
        const formattedTime = canceledMeeting.meeting_time ? canceledMeeting.meeting_time.substring(0, 5) : '';
        const locationName = canceledMeeting.meeting_location || 'Teams';
        
        // Build email body using template or fallback
        let emailBody: string;
        let emailSubject: string;
        if (templateContent && templateContent.trim()) {
          console.log('✅ Using cancellation email template');
          emailBody = await formatEmailBody(templateContent, selectedClient.name, {
            client: selectedClient,
            meetingDate: formattedDate,
            meetingTime: formattedTime,
            meetingLocation: locationName,
          });
          // Use template name as subject if available, otherwise fallback
          emailSubject = templateName || `[${selectedClient.lead_number}] - ${selectedClient.name} - Meeting Canceled`;
        } else {
          console.warn('⚠️ Using fallback hardcoded email template for cancellation');
          emailBody = `
            <div style='font-family:sans-serif;font-size:16px;color:#222;'>
              <p>Dear ${selectedClient.name},</p>
              <p>We regret to inform you that your meeting scheduled for:</p>
              <ul style='margin:16px 0 24px 0;padding-left:20px;'>
                <li><strong>Date:</strong> ${formattedDate}</li>
                <li><strong>Time:</strong> ${formattedTime}</li>
                <li><strong>Location:</strong> ${locationName}</li>
              </ul>
              <p>has been canceled.</p>
              <p>If you have any questions or would like to reschedule, please let us know.</p>
            </div>
          `;
          emailSubject = `[${selectedClient.lead_number}] - ${selectedClient.name} - Meeting Canceled`;
        }
        
        // Use sendEmailViaBackend to save email to database with proper context
        if (userId) {
          const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
          const legacyId = isLegacyLead ? parseInt(selectedClient.id.toString().replace('legacy_', ''), 10) : null;
          
          await sendEmailViaBackend({
            userId,
            subject: emailSubject,
            bodyHtml: emailBody,
            to: [selectedClient.email],
            context: {
              clientId: !isLegacyLead ? selectedClient.id : null,
              legacyLeadId: isLegacyLead ? legacyId : null,
              leadType: selectedClient.lead_type || (isLegacyLead ? 'legacy' : 'new'),
              leadNumber: selectedClient.lead_number || null,
              contactEmail: selectedClient.email || null,
              contactName: selectedClient.name || null,
              senderName: account?.name || 'Staff',
            },
          });
          } else {
            // Fallback to old method if userId not available
            await sendEmail(accessToken, {
              to: selectedClient.email,
              subject: emailSubject,
              body: emailBody,
              skipSignature: true, // Don't include user signature for template emails
            });
          }
      }

      // 4. Update stage to "Meeting rescheduling" (ID 21) - ONLY if not in "Another meeting" stage
      // For "Another meeting" stage, keep the stage unchanged
      const currentStageNameForCheck = selectedClient ? getStageName(selectedClient.stage) : '';
      if (!areStagesEquivalent(currentStageNameForCheck, 'another_meeting')) {
      await updateLeadStage(21);
      }

      // 5. Show toast and close drawer
      toast.success(notifyClientOnReschedule ? 'Meeting canceled and client notified.' : 'Meeting canceled.');
      setShowRescheduleDrawer(false);
      setNotifyClientOnReschedule(false); // Reset to default
      setMeetingToDelete(null);
      setRescheduleFormData({ date: getTomorrowDate(), time: '09:00', location: 'Teams', calendar: 'current', manager: '', helper: '', amount: '', currency: 'NIS', attendance_probability: 'Medium', complexity: 'Simple', car_number: '' });
      setRescheduleOption('cancel');
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      toast.error('Failed to cancel meeting.');
      console.error(error);
    }
  };

  // Handler for canceling and creating new meeting (or just creating new meeting in stage 21)
  const handleRescheduleMeeting = async () => {
    if (!selectedClient || !rescheduleFormData.date || !rescheduleFormData.time) return;
    
    setIsReschedulingMeeting(true);
    
    // IMPORTANT: Always automatically cancel the oldest upcoming meeting when rescheduling
    // Find and cancel the oldest upcoming meeting automatically (user doesn't need to select)
    const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
    const legacyIdStr = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : null;
    // Convert to number for legacy_lead_id (it's a bigint in the database)
    const legacyId = legacyIdStr && /^\d+$/.test(legacyIdStr) ? parseInt(legacyIdStr, 10) : legacyIdStr;
    
    // Query for the oldest upcoming meeting to cancel
    let query = supabase
      .from('meetings')
      .select('id, meeting_date, meeting_time, meeting_location')
      .neq('status', 'canceled')
      .gte('meeting_date', new Date().toISOString().split('T')[0])
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true })
      .limit(1);
    
    if (isLegacyLead && legacyId !== null) {
      query = query.eq('legacy_lead_id', legacyId);
    } else if (!isLegacyLead) {
      query = query.eq('client_id', selectedClient.id);
    }
    
    const { data: upcomingMeetingsToCancel, error: queryError } = await query;
    
    let canceledMeeting = null;
    let meetingIdToCancel: number | null = null;
    
    if (queryError) {
      console.error('❌ Error querying for meetings to cancel:', queryError);
    } else if (upcomingMeetingsToCancel && upcomingMeetingsToCancel.length > 0) {
      meetingIdToCancel = upcomingMeetingsToCancel[0].id;
      console.log('🔄 Automatically canceling oldest upcoming meeting before rescheduling:', meetingIdToCancel);
      
      try {
        const account = instance.getAllAccounts()[0];
        const { data: { user } } = await supabase.auth.getUser();
        const editor = user?.email || account?.name || 'system';
        const { error: cancelError } = await supabase
          .from('meetings')
          .update({ 
            status: 'canceled', 
            last_edited_timestamp: new Date().toISOString(), 
            last_edited_by: editor 
          })
          .eq('id', meetingIdToCancel);
        
        if (cancelError) {
          console.error('❌ Failed to cancel old meeting:', cancelError);
          throw new Error(`Failed to cancel old meeting: ${cancelError.message}`);
        }

        const { data: canceledMeetingData } = await supabase
          .from('meetings')
          .select('*')
          .eq('id', meetingIdToCancel)
          .single();
        
        canceledMeeting = canceledMeetingData;
        console.log('✅ Old meeting canceled successfully:', meetingIdToCancel);
      } catch (error) {
        console.error('❌ Error canceling meeting:', error);
        throw error;
      }
    } else {
      console.log('ℹ️ No upcoming meetings found to cancel (this is a new meeting, not a reschedule)');
    }
    
    try {
      const account = instance.getAllAccounts()[0];

      // Get current user's full_name from database to match scheduler dropdown values
      let currentUserFullName = '';
      try {
        // First try to get user by auth_id (more reliable)
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser?.id) {
          const { data: userData } = await supabase
            .from('users')
            .select('full_name, employee_id')
            .eq('auth_id', authUser.id)
            .maybeSingle();
          
          if (userData?.full_name) {
            currentUserFullName = userData.full_name;
          } else if (userData?.employee_id) {
            // Fallback: try to get display_name from employees table
            const employee = allEmployees.find((emp: any) => emp.id === userData.employee_id);
            if (employee?.display_name) {
              currentUserFullName = employee.display_name;
            }
          }
        }
        
        // If still empty, try by email as fallback
        if (!currentUserFullName && account.username) {
          const { data: userDataByEmail } = await supabase
            .from('users')
            .select('full_name, employee_id')
            .eq('email', account.username)
            .maybeSingle();
          
          if (userDataByEmail?.full_name) {
            currentUserFullName = userDataByEmail.full_name;
          } else if (userDataByEmail?.employee_id) {
            // Fallback: try to get display_name from employees table
            const employee = allEmployees.find((emp: any) => emp.id === userDataByEmail.employee_id);
            if (employee?.display_name) {
              currentUserFullName = employee.display_name;
            }
          }
        }
        
        // Final fallback: use account name if available
        if (!currentUserFullName && account.name) {
          currentUserFullName = account.name;
        }
      } catch (error) {
        console.error('Could not fetch user full_name:', error);
        // Use account name as fallback
        if (account.name) {
          currentUserFullName = account.name;
        }
      }
      
      // Ensure we have a scheduler name - if still empty, use account username
      if (!currentUserFullName) {
        console.error('⚠️ Could not determine current user full name for scheduler field');
        // Use account username as last resort
        currentUserFullName = account.username || 'System User';
      }

      // Helper function to convert display name to employee ID
      const getEmployeeIdFromDisplayName = (displayName: string | null | undefined): number | null => {
        if (!displayName || displayName === '---' || displayName.trim() === '') return null;
        
        // Try exact match first
        let employee = allEmployees.find((emp: any) => 
          emp.display_name && emp.display_name.trim() === displayName.trim()
        );
        
        // If not found, try case-insensitive match
        if (!employee) {
          employee = allEmployees.find((emp: any) => 
            emp.display_name && emp.display_name.trim().toLowerCase() === displayName.trim().toLowerCase()
          );
        }
        
        if (!employee) {
          console.warn(`Employee not found for display name: "${displayName}"`);
          return null;
        }
        
        // Ensure ID is a number (bigint)
        const employeeId = typeof employee.id === 'string' ? parseInt(employee.id, 10) : Number(employee.id);
        if (isNaN(employeeId)) {
          console.error(`Invalid employee ID for "${displayName}":`, employee.id);
          return null;
        }
        
        return employeeId;
      };

      // Resolve manager and helper employee IDs
      const managerEmployeeId = getEmployeeIdFromDisplayName(rescheduleFormData.manager);
      const helperEmployeeId = getEmployeeIdFromDisplayName(rescheduleFormData.helper);
      
      // Resolve scheduler employee ID (for legacy leads, need numeric ID)
      const schedulerEmployeeId = getEmployeeIdFromDisplayName(currentUserFullName);
      
      // Resolve expert employee ID (for legacy leads, need numeric ID)
      const expertEmployeeId = getEmployeeIdFromDisplayName(selectedClient.expert);

      // 2. Create the new meeting
      // Note: We don't create the calendar event here - it will be created later with the attendee
      // For Teams meetings, we'll get the URL from createCalendarEventWithAttendee
      let teamsMeetingUrl = '';
      const selectedLocation = meetingLocations.find(
        loc => loc.name === rescheduleFormData.location
      );

      // For non-Teams online locations, use the default_link from tenants_meetinglocation
      if (selectedLocation?.default_link && rescheduleFormData.location !== 'Teams') {
        teamsMeetingUrl = selectedLocation.default_link;
      }
      // For Teams meetings, the URL will be generated by createCalendarEventWithAttendee later

      // Check if this is a legacy lead
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      
      // For both new and legacy leads, create meeting record in meetings table
      const legacyIdStr = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : null;
      // Convert to number for legacy_lead_id (it's a bigint in the database)
      const legacyId = legacyIdStr && /^\d+$/.test(legacyIdStr) ? parseInt(legacyIdStr, 10) : legacyIdStr;

      const meetingData = {
        client_id: isLegacyLead ? null : selectedClient.id, // Use null for legacy leads
        legacy_lead_id: isLegacyLead ? legacyId : null, // Use legacy_lead_id for legacy leads (must be numeric)
        meeting_date: rescheduleFormData.date,
        meeting_time: rescheduleFormData.time,
        meeting_location: rescheduleFormData.location,
        meeting_manager: rescheduleFormData.manager || '',
        meeting_currency: rescheduleFormData.currency || '₪',
        meeting_amount: rescheduleFormData.amount ? parseFloat(rescheduleFormData.amount) : 0,
        expert: selectedClient.expert || '---',
        helper: rescheduleFormData.helper || '---',
        teams_meeting_url: teamsMeetingUrl,
        meeting_brief: '',
        attendance_probability: rescheduleFormData.attendance_probability,
        complexity: rescheduleFormData.complexity,
        car_number: rescheduleFormData.car_number || '',
        scheduler: currentUserFullName, // Always use Supabase user's full_name
        last_edited_timestamp: new Date().toISOString(),
        last_edited_by: currentUserFullName,
        calendar_type: rescheduleFormData.calendar === 'active_client' ? 'active_client' : 'potential_client',
      };

      const { data: insertedData, error: meetingError } = await supabase
        .from('meetings')
        .insert([meetingData])
        .select();

      if (meetingError) {
        console.error('Meeting creation error:', meetingError);
        throw meetingError;
      }

      // Update lead stage and roles
      const stageActor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();
      const currentStage = typeof selectedClient.stage === 'number' ? selectedClient.stage : 
                          (selectedClient.stage ? parseInt(String(selectedClient.stage), 10) : null);
      
      // Check if current stage is "Another meeting"
      const currentStageName = getStageName(selectedClient.stage);
      const isAnotherMeeting = areStagesEquivalent(currentStageName, 'Another meeting');
      
      // When rescheduling (new meeting is scheduled), change stage to "Meeting scheduled" (id 20)
      // EXCEPT when in "Another meeting" stage - then keep the stage unchanged
      const meetingScheduledStageId = getStageIdOrWarn('meeting_scheduled');
      if (meetingScheduledStageId === null) {
        toast.error('Unable to resolve the "Meeting scheduled" stage. Please contact an administrator.');
        setIsReschedulingMeeting(false);
        return;
      }
      // Don't update stage if:
      // 1. Already at "Meeting scheduled" stage, OR
      // 2. Currently in "Another meeting" stage (exclusive condition)
      const shouldUpdateStage = !isAnotherMeeting && (currentStage !== meetingScheduledStageId);
      const rescheduledStageId = meetingScheduledStageId; // Meeting scheduled (id 20)

      if (isLegacyLead) {
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        const updatePayload: any = {};

        // Only update stage if needed
        if (shouldUpdateStage) {
          updatePayload.stage = rescheduledStageId;
          updatePayload.stage_changed_by = stageActor.fullName;
          updatePayload.stage_changed_at = stageTimestamp;
        }

        // Always update scheduler for legacy leads (must be numeric employee ID, not display name)
        // Same as in handleScheduleMeeting - always update if schedulerEmployeeId is available
        if (schedulerEmployeeId !== null) {
          updatePayload.meeting_scheduler_id = schedulerEmployeeId;
        }

        // Always update manager and helper for legacy leads
        if (managerEmployeeId !== null) {
          updatePayload.meeting_manager_id = managerEmployeeId;
        }
        if (helperEmployeeId !== null) {
          updatePayload.meeting_lawyer_id = helperEmployeeId;
        }
        
        // Always update expert for legacy leads (must be numeric employee ID, not display name)
        if (expertEmployeeId !== null) {
          updatePayload.expert_id = expertEmployeeId;
        }

        // Only update if there's something to update
        if (Object.keys(updatePayload).length > 0) {
          const { error } = await supabase
            .from('leads_lead')
            .update(updatePayload)
            .eq('id', legacyId);

          if (error) throw error;
        }

        // Record stage change only if stage was updated
        if (shouldUpdateStage) {
          await recordLeadStageChange({
            lead: selectedClient,
            stage: rescheduledStageId,
            actor: stageActor,
            timestamp: stageTimestamp,
          });
        }
      } else {
        // Only update new leads table if this is actually a new lead (not legacy)
        if (!isLegacyLead) {
          const updatePayload: any = {};

          // Only update stage if needed
          if (shouldUpdateStage) {
            updatePayload.stage = rescheduledStageId;
            updatePayload.stage_changed_by = stageActor.fullName;
            updatePayload.stage_changed_at = stageTimestamp;
          }

          // Always update scheduler for new leads (same as in handleScheduleMeeting)
          updatePayload.scheduler = currentUserFullName;

          // Always update manager and helper for new leads (as employee IDs)
          if (managerEmployeeId !== null) {
            updatePayload.manager = managerEmployeeId;
          }
          if (helperEmployeeId !== null) {
            updatePayload.helper = helperEmployeeId;
          }

          const { error } = await supabase
            .from('leads')
            .update(updatePayload)
            .eq('id', selectedClient.id);

          if (error) throw error;
        } else {
          console.warn('Attempted to update leads table for legacy lead in reschedule, skipping');
        }

        // Record stage change only if stage was updated
        if (shouldUpdateStage) {
          await recordLeadStageChange({
            lead: selectedClient,
            stage: rescheduledStageId,
            actor: stageActor,
            timestamp: stageTimestamp,
          });
        }
      }

      // 3. Send notification email to client with calendar invitation (only if notify toggle is on)
      if (notifyClientOnReschedule && selectedClient.email) {
        let accessToken;
        try {
          const response = await instance.acquireTokenSilent({ ...loginRequest, account });
          accessToken = response.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            const response = await instance.loginPopup(loginRequest);
            accessToken = response.accessToken;
          } else {
            throw error;
          }
        }
        
        // Compose the email template (no signature for template emails)
        const userName = account?.name || 'Staff';
        
        // Use the newly created meeting's Teams URL (from insertedData) instead of fetching latest
        // This ensures we get the correct Teams link for the current meeting, not an old one
        // Note: For Teams meetings, the URL will be updated after calendar event creation
        let newMeetingTeamsUrl = insertedData && insertedData[0] ? insertedData[0].teams_meeting_url : null;
        let meetingLink = getValidTeamsLink(newMeetingTeamsUrl);
        
        console.log('🔗 Initial Teams meeting URL for email:', {
          insertedDataId: insertedData?.[0]?.id,
          teamsUrl: newMeetingTeamsUrl,
          meetingLink,
          location: rescheduleFormData.location
        });
        
        // joinButton will be built later after we have the final meetingLink
        const joinButton = meetingLink
          ? `<div style='margin:24px 0;'>
              <a href='${meetingLink}' target='_blank' style='background:#3b28c7;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;'>Join Meeting</a>
            </div>`
          : '';
        
        // Determine client language and fetch appropriate template
        // For rescheduled meetings: use template 155/156
        // For new meetings (no canceled meeting): use invitation templates based on location (same as schedule meeting)
        let templateContent: string | null = null;
        let templateNameForReschedule: string | null = null;
        
        try {
          // Get language_id from client to determine language
          let clientLanguageId: number | null = null;
          
          if (isLegacyLead) {
            if ((selectedClient as any).language_id) {
              clientLanguageId = (selectedClient as any).language_id;
            } else {
              const legacyIdForReschedule = selectedClient.id.toString().replace('legacy_', '');
              const { data: legacyData } = await supabase
                .from('leads_lead')
                .select('language_id')
                .eq('id', legacyIdForReschedule)
                .single();
              clientLanguageId = legacyData?.language_id || null;
            }
          } else {
            // For new leads, fetch language_id from leads table
            if ((selectedClient as any).language_id) {
              clientLanguageId = (selectedClient as any).language_id;
            } else {
              // Only query leads table if this is actually a new lead (not legacy)
              if (!isLegacyLead) {
                const { data: leadData } = await supabase
                  .from('leads')
                  .select('language_id')
                  .eq('id', selectedClient.id)
                  .single();
                clientLanguageId = leadData?.language_id || null;
              } else {
                console.warn('Attempted to query leads table for legacy lead language_id, skipping');
              }
            }
          }
          
          // Get language name from language_id to determine if Hebrew or English
          let isHebrew = false;
          if (clientLanguageId) {
            const { data: languageData } = await supabase
              .from('misc_language')
              .select('name')
              .eq('id', clientLanguageId)
              .single();
            
            const languageName = languageData?.name?.toLowerCase() || '';
            isHebrew = languageName.includes('hebrew') || languageName.includes('עברית') || languageName === 'he';
          }
          
          // Determine template ID based on whether there's a canceled meeting or not
          let templateId: number;
          if (canceledMeeting) {
            // Rescheduled meeting: use rescheduled templates (155/156)
            templateId = isHebrew ? 156 : 155; // HE: 156, EN: 155
            console.log('📧 Fetching rescheduled email template:', { 
              clientLanguageId, 
              isHebrew, 
              templateId 
            });
          } else {
            // New meeting (no canceled meeting): use invitation templates based on location (same as schedule meeting)
            // Use the exact same logic as schedule meeting to determine invitation type
            const location = (rescheduleFormData.location || '').toLowerCase();
            let invitationType: 'invitation' | 'invitation_jlm' | 'invitation_tlv' | 'invitation_tlv_parking' = 'invitation';
            
            if (location.includes('jrslm') || location.includes('jerusalem')) {
              invitationType = 'invitation_jlm';
            } else if (location.includes('tlv') && location.includes('parking')) {
              invitationType = 'invitation_tlv_parking';
            } else if (location.includes('tlv') || location.includes('tel aviv')) {
              invitationType = 'invitation_tlv';
            }
            
            console.log('🎯 Reschedule meeting - determining invitation type:', {
              location: rescheduleFormData.location,
              locationLower: location,
              invitationType
            });
            
            const templateMapping: Record<string, {en: number, he: number}> = {
              invitation: { en: 151, he: 152 },
              invitation_jlm: { en: 157, he: 158 },
              invitation_tlv: { en: 161, he: 162 },
              invitation_tlv_parking: { en: 159, he: 160 },
            };
            
            const templateIds = templateMapping[invitationType];
            templateId = isHebrew ? templateIds.he : templateIds.en;
            
            console.log('📧 Fetching invitation email template for new meeting:', { 
              location,
              invitationType,
              clientLanguageId, 
              isHebrew, 
              templateId 
            });
          }
          
          // Fetch email template by ID (including name for subject)
          const { data: template, error: templateError } = await supabase
            .from('misc_emailtemplate')
            .select('name, content')
            .eq('id', templateId)
            .single();
          
          if (templateError) {
            console.error('❌ Error fetching email template:', templateError);
          } else if (template && template.content) {
            const parsed = parseTemplateContent(template.content);
            templateContent = parsed && parsed.trim() ? parsed : template.content;
            templateNameForReschedule = template.name || null;
            console.log('✅ Email template fetched successfully', {
              templateId,
              templateName: template.name,
              rawLength: template.content.length,
              parsedLength: parsed?.length || 0,
              finalLength: templateContent?.length || 0,
              usingRaw: !parsed || !parsed.trim()
            });
          }
        } catch (error) {
          console.error('❌ Exception fetching email template:', error);
        }
        
        // Format dates and times
        const formatDate = (dateStr: string): string => {
          const [year, month, day] = dateStr.split('-');
          return `${day}/${month}/${year}`;
        };
        const formattedNewDate = formatDate(rescheduleFormData.date);
        const formattedNewTime = rescheduleFormData.time.substring(0, 5);
        const formattedOldDate = canceledMeeting?.meeting_date ? formatDate(canceledMeeting.meeting_date) : '';
        const formattedOldTime = canceledMeeting?.meeting_time ? canceledMeeting.meeting_time.substring(0, 5) : '';
        const newLocationName = rescheduleFormData.location;
        const oldLocationName = canceledMeeting?.meeting_location || 'Teams';
        
        // Convert date and time to ISO format for calendar invitation
        // Always send calendar invite for all meeting types (regular, paid, etc.)
        const [yearVal, monthVal, dayVal] = rescheduleFormData.date.split('-').map(Number);
        const [hours, minutes] = rescheduleFormData.time.split(':').map(Number);
        const startDateTime = new Date(yearVal, monthVal - 1, dayVal, hours, minutes);
        const endDateTime = new Date(startDateTime.getTime() + 30 * 60000); // 30 min meeting
        
        // Check if recipient email is a Microsoft domain (for Outlook/Exchange)
        const isMicrosoftEmail = (email: string): boolean => {
          if (!email) return false;
          const emailLower = email.toLowerCase().trim();
          const microsoftDomains = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'onmicrosoft.com'];
          const isMicrosoft = microsoftDomains.some(domain => {
            // Check for exact domain match (after @) or subdomain
            const domainPattern = new RegExp(`@([a-z0-9-]+\\.)?${domain.replace('.', '\\.')}$`, 'i');
            return domainPattern.test(emailLower);
          });
          console.log('🔍 Microsoft email check:', {
            email,
            emailLower,
            isMicrosoft,
            domains: microsoftDomains
          });
          return isMicrosoft;
        };
        
        const useOutlookCalendarInvite = isMicrosoftEmail(selectedClient.email);
        console.log('📧 Calendar invite method:', {
          email: selectedClient.email,
          useOutlookCalendarInvite,
          willUseMicrosoftGraph: useOutlookCalendarInvite
        });
        // Category removed from meeting subject
        const meetingSubject = canceledMeeting 
          ? `[#${selectedClient.lead_number}] ${selectedClient.name} - Meeting Rescheduled`
          : `[#${selectedClient.lead_number}] ${selectedClient.name} - Meeting`;
        
        // For Teams meetings, create calendar event FIRST to get the Teams URL
        // Then build email body with the correct Teams link
        if (rescheduleFormData.location === 'Teams' && useOutlookCalendarInvite) {
          try {
            // Create a temporary email body for the calendar event description
            const tempEmailBody = `Meeting with ${selectedClient.name}`;
            
            const calendarEventResult = await createCalendarEventWithAttendee(accessToken, {
              subject: meetingSubject,
              startDateTime: startDateTime.toISOString(),
              endDateTime: endDateTime.toISOString(),
              location: 'Microsoft Teams Meeting',
              description: tempEmailBody,
              attendeeEmail: selectedClient.email,
              attendeeName: selectedClient.name,
              organizerEmail: account.username || 'noreply@lawoffice.org.il',
              organizerName: userName,
              teamsJoinUrl: undefined, // Will be generated by Microsoft Graph
              timeZone: 'Asia/Jerusalem'
            });
            
            // Update the meeting record with the Teams URL
            if (calendarEventResult?.joinUrl && insertedData && insertedData[0]?.id) {
              await supabase
                .from('meetings')
                .update({ teams_meeting_url: calendarEventResult.joinUrl })
                .eq('id', insertedData[0].id);
              
              // Update the meetingLink variable with the new Teams URL
              meetingLink = getValidTeamsLink(calendarEventResult.joinUrl);
              newMeetingTeamsUrl = calendarEventResult.joinUrl;
              console.log('✅ Got Teams meeting URL from calendar event:', {
                joinUrl: calendarEventResult.joinUrl,
                meetingLink,
                location: rescheduleFormData.location
              });
            }
          } catch (teamsError) {
            console.error('❌ Failed to create Teams calendar event:', teamsError);
            // Continue with email sending even if Teams calendar creation fails
          }
        }
        
        // Build email body based on whether we canceled a meeting or not
        // Now we have the correct Teams URL if it's a Teams meeting
        let emailBody = '';
        let emailSubject = '';
        
        // Build joinButton with updated meetingLink
        const finalJoinButton = meetingLink
          ? `<div style='margin:24px 0;'>
              <a href='${meetingLink}' target='_blank' style='background:#3b28c7;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;'>Join Meeting</a>
            </div>`
          : '';
        
        if (canceledMeeting) {
          // Meeting was canceled and rescheduled - use template if available
          if (templateContent && templateContent.trim()) {
            console.log('✅ Using rescheduled email template');
            // For rescheduled meetings, we need to replace template parameters
            // First replace standard parameters using the centralized function
            let templatedBody = await replaceEmailTemplateParams(templateContent, {
              clientName: selectedClient.name,
              contactName: selectedClient.name,
              leadNumber: selectedClient.lead_number || null,
              topic: selectedClient.topic || null,
              leadType: selectedClient.lead_type || null,
              clientId: isLegacyLead ? null : selectedClient.id,
              legacyId: isLegacyLead ? parseInt(selectedClient.id.toString().replace('legacy_', ''), 10) : null,
              meetingDate: formattedNewDate,
              meetingTime: formattedNewTime,
              meetingLocation: newLocationName,
              meetingLink: meetingLink || undefined,
            });
            
            // Manually replace old meeting details if the template has those placeholders
            // Common placeholders might be: {old_date}, {old_time}, {old_location}
            templatedBody = templatedBody
              .replace(/\{old_date\}/gi, formattedOldDate)
              .replace(/\{old_time\}/gi, formattedOldTime)
              .replace(/\{old_location\}/gi, oldLocationName)
              .replace(/\{previous_date\}/gi, formattedOldDate)
              .replace(/\{previous_time\}/gi, formattedOldTime)
              .replace(/\{previous_location\}/gi, oldLocationName);
            
            // Then format with RTL support
            emailBody = await formatEmailBody(templatedBody, selectedClient.name, {
              client: selectedClient,
              meetingDate: formattedNewDate,
              meetingTime: formattedNewTime,
              meetingLocation: newLocationName,
              meetingLink: meetingLink || undefined,
            });
            // Use template name as subject if available
            emailSubject = templateNameForReschedule || `[${selectedClient.lead_number}] - ${selectedClient.name} - Meeting Rescheduled`;
          } else {
            console.warn('⚠️ Using fallback hardcoded email template for rescheduled');
            // Fallback to hardcoded email
            emailBody = `
              <div style='font-family:sans-serif;font-size:16px;color:#222;'>
                <p>Dear ${selectedClient.name},</p>
                <p>We regret to inform you that your previous meeting scheduled for:</p>
                <ul style='margin:16px 0 16px 0;padding-left:20px;'>
                  <li><strong>Date:</strong> ${formattedOldDate}</li>
                  <li><strong>Time:</strong> ${formattedOldTime}</li>
                  <li><strong>Location:</strong> ${oldLocationName}</li>
                </ul>
                <p>has been canceled. Please find below the details for your new meeting:</p>
                <ul style='margin:16px 0 24px 0;padding-left:20px;'>
                  <li><strong>Date:</strong> ${formattedNewDate}</li>
                  <li><strong>Time:</strong> ${formattedNewTime}</li>
                  <li><strong>Location:</strong> ${newLocationName}</li>
                </ul>
                ${finalJoinButton}
                <p>Please check the calendar invitation attached for the exact meeting time.</p>
                <p>If you have any questions or need to reschedule again, please let us know.</p>
              </div>
            `;
          }
          // Use template name as subject if available
          emailSubject = templateNameForReschedule || `[${selectedClient.lead_number}] - ${selectedClient.name} - Meeting Rescheduled`;
        } else {
          // Just scheduling a new meeting (no meeting to cancel) - use invitation template (same as schedule meeting)
          if (templateContent && templateContent.trim()) {
            console.log('✅ Using invitation email template for new meeting');
            // Format body with parameter replacement (same as schedule meeting)
            emailBody = await formatEmailBody(
              templateContent,
              selectedClient.name || 'Valued Client',
              {
                client: selectedClient,
                meetingDate: formattedNewDate,
                meetingTime: formattedNewTime,
                meetingLocation: newLocationName,
                meetingLink: meetingLink || ''
              }
            );
            // Use template name as subject if available
            emailSubject = templateNameForReschedule || `[${selectedClient.lead_number}] - ${selectedClient.name} - New Meeting Scheduled`;
          } else {
            console.warn('⚠️ Using fallback hardcoded email template for new meeting');
            // Fallback to hardcoded email
            emailBody = `
              <div style='font-family:sans-serif;font-size:16px;color:#222;'>
                <p>Dear ${selectedClient.name},</p>
                <p>We have scheduled a new meeting for you. Please find the details below:</p>
                <ul style='margin:16px 0 24px 0;padding-left:20px;'>
                  <li><strong>Date:</strong> ${formattedNewDate}</li>
                  <li><strong>Time:</strong> ${formattedNewTime}</li>
                  <li><strong>Location:</strong> ${newLocationName}</li>
                </ul>
                ${finalJoinButton}
                <p>Please check the calendar invitation attached for the exact meeting time.</p>
                <p>If you have any questions or need to reschedule, please let us know.</p>
              </div>
            `;
            emailSubject = `[${selectedClient.lead_number}] - ${selectedClient.name} - New Meeting Scheduled`;
          }
        }
        
        // STEP 1: Send reschedule notification email (if there was a canceled meeting)
        // This email does NOT include calendar invite - just notification
        if (canceledMeeting && emailBody && emailSubject) {
          console.log('📧 Sending reschedule notification email (without calendar invite)');
          try {
            if (userId) {
              const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
              const legacyId = isLegacyLead ? parseInt(selectedClient.id.toString().replace('legacy_', ''), 10) : null;
              
              await sendEmailViaBackend({
                userId,
                subject: emailSubject,
                bodyHtml: emailBody,
                to: [selectedClient.email],
                context: {
                  clientId: !isLegacyLead ? selectedClient.id : null,
                  legacyLeadId: isLegacyLead ? legacyId : null,
                  leadType: selectedClient.lead_type || (isLegacyLead ? 'legacy' : 'new'),
                  leadNumber: selectedClient.lead_number || null,
                  contactEmail: selectedClient.email || null,
                  contactName: selectedClient.name || null,
                  senderName: account?.name || 'Staff',
                },
              });
            } else {
              await sendEmail(accessToken, {
                to: selectedClient.email,
                subject: emailSubject,
                body: emailBody,
                skipSignature: true,
              });
            }
            console.log('✅ Reschedule notification email sent successfully');
          } catch (rescheduleEmailError) {
            console.error('❌ Failed to send reschedule notification email:', rescheduleEmailError);
            // Continue to send invitation email even if reschedule email fails
          }
        }
        
        // STEP 2: Send meeting invitation email with calendar invite (same as schedule meeting)
        // This uses location-based templates and includes calendar invite
        if (insertedData && insertedData.length > 0 && selectedClient.email) {
          console.log('📧 Sending meeting invitation email with calendar invite');
          
          // Import the invitation email sending logic from handleScheduleMeeting
          // This will be done in a separate async block to avoid blocking
          (async () => {
            try {
              const newMeeting: any = {
                id: insertedData[0].id,
                client_id: insertedData[0].client_id,
                date: insertedData[0].meeting_date,
                time: insertedData[0].meeting_time,
                location: insertedData[0].meeting_location,
                manager: insertedData[0].meeting_manager,
                currency: insertedData[0].meeting_currency,
                amount: insertedData[0].meeting_amount,
                brief: insertedData[0].meeting_brief,
                scheduler: insertedData[0].scheduler || currentUserFullName,
                helper: insertedData[0].helper,
                expert: insertedData[0].expert,
                link: insertedData[0].teams_meeting_url || meetingLink || '',
                lastEdited: {
                  timestamp: insertedData[0].last_edited_timestamp,
                  user: insertedData[0].last_edited_by,
                },
              };

              // Determine the appropriate invitation type based on meeting location
              const location = (rescheduleFormData.location || '').toLowerCase();
              let invitationType: 'invitation' | 'invitation_jlm' | 'invitation_tlv' | 'invitation_tlv_parking' = 'invitation';
              
              if (location.includes('jrslm') || location.includes('jerusalem')) {
                invitationType = 'invitation_jlm';
              } else if (location.includes('tlv') && location.includes('parking')) {
                invitationType = 'invitation_tlv_parking';
              } else if (location.includes('tlv') || location.includes('tel aviv')) {
                invitationType = 'invitation_tlv';
              }

              console.log('🎯 Sending meeting invitation email:', {
                location: rescheduleFormData.location,
                invitationType,
                clientEmail: selectedClient.email,
                meetingDate: newMeeting.date
              });
              
              // Fetch email template based on invitation type and language_id
              const templateMapping: Record<string, {en: number, he: number}> = {
                invitation: { en: 151, he: 152 },
                invitation_jlm: { en: 157, he: 158 },
                invitation_tlv: { en: 161, he: 162 },
                invitation_tlv_parking: { en: 159, he: 160 },
              };
              
              const templateIds = templateMapping[invitationType];
              
              // Get language_id from client
              let clientLanguageIdForInvite: number | null = selectedClient.language_id || null;
              
              if (isLegacyLead && !clientLanguageIdForInvite) {
                const legacyIdForInvite = selectedClient.id.toString().replace('legacy_', '');
                const { data: legacyData } = await supabase
                  .from('leads_lead')
                  .select('language_id')
                  .eq('id', legacyIdForInvite)
                  .maybeSingle();
                clientLanguageIdForInvite = legacyData?.language_id || null;
              } else if (!isLegacyLead && !clientLanguageIdForInvite) {
                const { data: leadData } = await supabase
                  .from('leads')
                  .select('language_id')
                  .eq('id', selectedClient.id)
                  .maybeSingle();
                clientLanguageIdForInvite = leadData?.language_id || null;
              }
              
              // Determine if Hebrew
              let isHebrew = false;
              if (clientLanguageIdForInvite) {
                const { data: languageData } = await supabase
                  .from('misc_language')
                  .select('name')
                  .eq('id', clientLanguageIdForInvite)
                  .maybeSingle();
                
                const languageName = languageData?.name?.toLowerCase() || '';
                isHebrew = languageName.includes('hebrew') || languageName.includes('עברית') || languageName === 'he';
              } else {
                isHebrew = selectedClient.language?.toLowerCase() === 'he' || 
                          selectedClient.language?.toLowerCase() === 'hebrew';
              }
              
              const templateId = isHebrew ? templateIds.he : templateIds.en;
              
              // Fetch the template
              const { data: templateData, error: templateError } = await supabase
                .from('misc_emailtemplate')
                .select('name, content')
                .eq('id', templateId)
                .maybeSingle();

              // Format meeting date and time
              const [year, month, day] = newMeeting.date.split('-');
              const formattedDate = `${day}/${month}/${year}`;
              const formattedTime = newMeeting.time ? newMeeting.time.substring(0, 5) : '';
              
              // Prepare email subject and body
              let subject = `Meeting with Decker, Pex, Levi Lawoffice - ${formattedDate}`;
              let body = '';
              
              if (!templateData || templateError) {
                // Fallback email
                body = `
                  <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                      <h2 style="color: #4218CC;">Meeting Invitation</h2>
                      <p>Dear ${selectedClient.name || 'Valued Client'},</p>
                      <p>You have a scheduled meeting with Decker, Pex, Levi Lawoffice.</p>
                      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p><strong>Date:</strong> ${formattedDate}</p>
                        <p><strong>Time:</strong> ${formattedTime}</p>
                        <p><strong>Location:</strong> ${rescheduleFormData.location || 'TBD'}</p>
                        ${newMeeting.link ? `<p><strong>Meeting Link:</strong> <a href="${newMeeting.link}">${newMeeting.link}</a></p>` : ''}
                      </div>
                      <p>We look forward to meeting with you.</p>
                      <p>Best regards,<br/>Decker, Pex, Levi Lawoffice</p>
                    </body>
                  </html>
                `;
              } else {
                // Use template
                const parsedContent = parseTemplateContent(templateData.content);
                body = await formatEmailBody(
                  parsedContent,
                  selectedClient.name || 'Valued Client',
                  {
                    client: selectedClient,
                    meetingDate: formattedDate,
                    meetingTime: formattedTime,
                    meetingLocation: rescheduleFormData.location || '',
                    meetingLink: newMeeting.link || ''
                  }
                );
                
                if (templateData.name) {
                  subject = templateData.name;
                }
              }
              
              // Check if recipient email is a Microsoft domain
              const isMicrosoftEmailForInvite = (email: string): boolean => {
                const microsoftDomains = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'onmicrosoft.com'];
                return microsoftDomains.some(domain => email.toLowerCase().includes(`@${domain}`));
              };
              
              const useOutlookCalendarInviteForInvite = isMicrosoftEmailForInvite(selectedClient.email);
              const recipientName = selectedClient.name || 'Valued Client';
              const locationName = rescheduleFormData.location || 'Office';
              
              // Build description HTML for calendar
              let descriptionHtml = `<p>Meeting with <strong>${recipientName}</strong></p>`;
              if (newMeeting.link) {
                descriptionHtml += `<p><strong>Join Link:</strong> <a href="${newMeeting.link}">${newMeeting.link}</a></p>`;
              }
              
              const calendarSubject = `Meeting with Decker, Pex, Levi Lawoffice`;
              
              // Prepare date/time for calendar
              const startDateTimeForInvite = new Date(`${newMeeting.date}T${formattedTime}:00`);
              const endDateTimeForInvite = new Date(startDateTimeForInvite.getTime() + 60 * 60 * 1000); // 1 hour duration
              
              if (useOutlookCalendarInviteForInvite) {
                // For Microsoft email clients: Use Microsoft Graph API to create calendar event
                try {
                  await createCalendarEventWithAttendee(accessToken, {
                    subject: calendarSubject,
                    startDateTime: startDateTimeForInvite.toISOString(),
                    endDateTime: endDateTimeForInvite.toISOString(),
                    location: locationName === 'Teams' ? 'Microsoft Teams Meeting' : locationName,
                    description: descriptionHtml,
                    attendeeEmail: selectedClient.email,
                    attendeeName: recipientName,
                    organizerEmail: account.username || 'noreply@lawoffice.org.il',
                    organizerName: account?.name || 'Law Office',
                    teamsJoinUrl: locationName === 'Teams' ? newMeeting.link : undefined,
                    timeZone: 'Asia/Jerusalem'
                  });
                  
                  console.log('✅ Outlook calendar invitation sent successfully');
                } catch (calendarError) {
                  console.error('❌ Failed to create Outlook calendar event:', calendarError);
                  // Fallback to regular email with ICS attachment
                  throw calendarError;
                }
              } else {
                // For non-Microsoft email clients: Send email with ICS attachment
                let attachments: Array<{ name: string; contentBytes: string; contentType?: string }> | undefined;
                try {
                  const icsContent = generateICSFromDateTime({
                    subject: calendarSubject,
                    date: newMeeting.date,
                    time: formattedTime,
                    durationMinutes: 60,
                    location: locationName === 'Teams' ? 'Microsoft Teams Meeting' : locationName,
                    description: descriptionHtml.replace(/<[^>]+>/g, ''),
                    organizerEmail: account.username || 'noreply@lawoffice.org.il',
                    organizerName: account?.name || 'Law Office',
                    attendeeEmail: selectedClient.email,
                    attendeeName: recipientName,
                    teamsJoinUrl: locationName === 'Teams' ? newMeeting.link : undefined,
                    timeZone: 'Asia/Jerusalem'
                  });
                  
                  const icsBase64 = btoa(unescape(encodeURIComponent(icsContent)));
                  
                  attachments = [{
                    name: 'meeting-invite.ics',
                    contentBytes: icsBase64,
                    contentType: 'text/calendar; charset=utf-8; method=REQUEST'
                  }];
                  
                  console.log('📅 ICS calendar file generated');
                } catch (icsError) {
                  console.error('❌ Failed to generate ICS file:', icsError);
                }
                
                // Send email with ICS attachment
                await sendEmail(accessToken, {
                  to: selectedClient.email,
                  subject,
                  body,
                  skipSignature: true,
                  attachments
                });
                
                console.log('✅ Email with calendar invite sent successfully');
              }
              
              // Save email to database for tracking
              try {
                const emailRecord: any = {
                  message_id: `meeting_invitation_${Date.now()}_${Math.random()}`,
                  thread_id: null,
                  sender_name: account?.name || 'Law Office',
                  sender_email: account.username || 'noreply@lawoffice.org.il',
                  recipient_list: selectedClient.email,
                  subject,
                  body_html: body,
                  body_preview: body.substring(0, 200),
                  sent_at: new Date().toISOString(),
                  direction: 'outgoing',
                  attachments: null,
                };
                
                if (isLegacyLead) {
                  const numericId = parseInt(selectedClient.id.toString().replace(/[^0-9]/g, ''), 10);
                  emailRecord.legacy_id = isNaN(numericId) ? null : numericId;
                  emailRecord.client_id = null;
                } else {
                  emailRecord.client_id = selectedClient.id || null;
                  emailRecord.legacy_id = null;
                }
                
                await supabase.from('emails').insert(emailRecord);
                console.log('📧 Invitation email record saved to database');
                // Stage evaluation is handled automatically by database triggers
              } catch (dbError) {
                console.error('❌ Failed to save invitation email to database:', dbError);
              }
              
              console.log('✅ Meeting invitation email sent successfully');
            } catch (inviteEmailError) {
              console.error('❌ Error sending meeting invitation email:', inviteEmailError);
              // Don't fail the whole operation if invitation email fails
            }
          })();
        }
        
      }

      // 5. Show toast and close drawer
      toast.success(notifyClientOnReschedule ? 'Meeting rescheduled and client notified.' : 'Meeting rescheduled.');
      setShowRescheduleDrawer(false);
      setNotifyClientOnReschedule(false); // Reset to default
      setMeetingToDelete(null);
      setRescheduleFormData({ date: getTomorrowDate(), time: '09:00', location: 'Teams', calendar: 'current', manager: '', helper: '', amount: '', currency: 'NIS', attendance_probability: 'Medium', complexity: 'Simple', car_number: '' });
      setRescheduleOption('cancel');
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      toast.error('Failed to reschedule meeting.');
      console.error(error);
    } finally {
      setIsReschedulingMeeting(false);
    }
  };





  // Calculate interaction count (synchronous part)
  const calculateInteractionCountSync = () => {
    if (!selectedClient) return 0;
    
    let count = 0;
    
    // Count manual interactions
    if (selectedClient.manual_interactions && Array.isArray(selectedClient.manual_interactions)) {
      count += selectedClient.manual_interactions.length;
    }
    
    // Count emails
    if (selectedClient.emails && Array.isArray(selectedClient.emails)) {
      count += selectedClient.emails.length;
    }
    
    // Count WhatsApp messages (if available)
    if (selectedClient.whatsapp_messages && Array.isArray(selectedClient.whatsapp_messages)) {
      count += selectedClient.whatsapp_messages.length;
    }
    
    return count;
  };

  // Calculate full interaction count including legacy interactions
  const calculateFullInteractionCount = async () => {
    if (!selectedClient) return 0;
    
    let count = calculateInteractionCountSync();
    
    // For legacy leads, fetch and count legacy interactions
    const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
    if (isLegacyLead && selectedClient?.id) {
      try {
        const { fetchLegacyInteractions } = await import('../lib/legacyInteractionsApi');
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        const legacyInteractions = await fetchLegacyInteractions(legacyId, selectedClient.name);
        count += legacyInteractions.length;
      } catch (error) {
        console.error('Error counting legacy interactions:', error);
      }
    }
    
    return count;
  };
  // Handle save payments plan
  const handleSavePaymentsPlan = async () => {
    if (!selectedClient?.id) return;
    setIsSavingPaymentPlan(true);

    // Optimistic UI update
    // NOTE: do not close the finance plan drawer here; the user may still
    // be working in the Finances tab. FinancesTab handles its own drawer state.
    setPayments([]); // Optionally, setPayments(newPayments) if you want to show them immediately
    setActiveTab('finances');
    toast.success('Payment plan saved!');

    try {
      // Get current user name from Supabase users table
      const currentUserName = await fetchCurrentUserFullName();
      
      console.log('Current user for payment plan creation:', currentUserName);

      // Check if this is a legacy lead
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      const legacyId = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : null;

      if (isLegacyLead) {
        // For legacy leads, use finances_paymentplanrow table
        console.log('Saving payment plan for legacy lead:', legacyId);
        
        // Delete existing payment plans for this legacy lead
        const { error: deleteError } = await supabase
          .from('finances_paymentplanrow')
          .delete()
          .eq('lead_id', legacyId);
        if (deleteError) throw deleteError;

        // Map payment order strings to numeric values for legacy payments
        const getOrderNumber = (orderString: string): number => {
          switch (orderString) {
            case 'First Payment': return 1;
            case 'Intermediate Payment': return 5;
            case 'Final Payment': return 9;
            case 'Single Payment': return 90;
            case 'Expense (no VAT)': return 99;
            default: return 1; // Default to first payment
          }
        };

        // Insert new payment plans into finances_paymentplanrow table
        const paymentPlansToInsert = payments.map((payment, index) => {
          // Determine currency_id based on the payment currency
          let currencyId = 1; // Default to NIS
          if (payment.currency) {
            switch (payment.currency) {
              case '₪': currencyId = 1; break;
              case '€': currencyId = 2; break;
              case '$': currencyId = 3; break;
              case '£': currencyId = 4; break;
              default: currencyId = 1; break;
            }
          }
          
          return {
            cdate: new Date().toISOString().split('T')[0], // Current date
            udate: new Date().toISOString().split('T')[0], // Current date
            date: payment.dueDate || payment.date || null,
            value: (() => {
              const val = typeof payment.value === 'number' ? payment.value : parseFloat(payment.value);
              return isNaN(val) ? 0 : val;
            })(),
            vat_value: (() => {
              const vat = typeof payment.valueVat === 'number' ? payment.valueVat : parseFloat(payment.valueVat);
              return isNaN(vat) ? 0 : vat;
            })(),
            lead_id: legacyId.toString(), // Ensure it's a string
            notes: payment.notes || '',
            due_date: payment.dueDate || payment.date || null,
            due_percent: (() => {
              const percent = payment.duePercent || '0';
              return percent.includes('%') ? percent : percent + '%';
            })(), // Store the due percentage as text with % sign
            order: (() => {
              const orderNum = getOrderNumber(payment.order);
              return isNaN(orderNum) ? 1 : orderNum;
            })(), // Convert string to numeric order with validation
            currency_id: (() => {
              const cid = currencyId;
              return isNaN(cid) ? 1 : cid;
            })(), // Ensure currency_id is valid
            client_id: null, // Will be null for legacy leads
          };
        });

        console.log('Payment plans to insert:', paymentPlansToInsert);
        
        const { data: insertedPayments, error: paymentInsertError } = await supabase
          .from('finances_paymentplanrow')
          .insert(paymentPlansToInsert)
          .select('id');

        if (paymentInsertError) {
          console.error('Payment insert error details:', paymentInsertError);
          throw paymentInsertError;
        }
        console.log('Legacy payment plans inserted:', insertedPayments);

      } else {
        // For new leads, use payment_plans table
        console.log('Saving payment plan for new lead:', selectedClient.id);
        
        // Delete existing payment plans
        const { error: deleteError } = await supabase
          .from('payment_plans')
          .delete()
          .eq('lead_id', selectedClient.id);
        if (deleteError) throw deleteError;

        const paymentPlansToInsert = payments.map(payment => ({
          lead_id: selectedClient.id,
          due_percent: payment.duePercent ? parseFloat(payment.duePercent.replace('%', '')) : 0,
          due_date: payment.dueDate || payment.date || null,
          value: typeof payment.value === 'number' ? payment.value : parseFloat(payment.value),
          value_vat: typeof payment.valueVat === 'number' ? payment.valueVat : parseFloat(payment.valueVat),
          client_name: payment.client,
          payment_order: payment.order,
          notes: payment.notes,
          created_by: currentUserName,
        }));
        
        // Log the payment plan creation in payment_plan_changes table
        const changesToInsert = paymentPlansToInsert.map(payment => ({
          lead_id: selectedClient.id,
          payment_plan_id: null, // Will be set after insertion
          field_name: 'payment_plan_created',
          old_value: null,
          new_value: JSON.stringify({
            payment_order: payment.payment_order,
            value: payment.value,
            due_date: payment.due_date,
            client_name: payment.client_name
          }),
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        }));

        // Insert the payment plans first
        const { data: insertedPayments, error: paymentInsertError } = await supabase
          .from('payment_plans')
          .insert(paymentPlansToInsert)
          .select('id');

        if (paymentInsertError) throw paymentInsertError;

        // Now update the payment_plan_id in the changes records
        if (insertedPayments && insertedPayments.length > 0) {
          const updatedChanges = changesToInsert.map((change, index) => ({
            ...change,
            payment_plan_id: insertedPayments[index]?.id || null
          }));

          const { error: historyError } = await supabase
            .from('payment_plan_changes')
            .insert(updatedChanges);
          
          if (historyError) console.error('Error logging payment plan creation:', historyError);
        }
      }
      
      // Optionally, refresh just the payment plans here if needed
      // await refreshPaymentPlans(selectedClient.id);
    } catch (error) {
      toast.error('Failed to save payment plan. Please try again.');
      // Optionally, revert UI changes here
    } finally {
      setIsSavingPaymentPlan(false);
    }
  };

  // Proforma drawer state
  const [showProformaDrawer, setShowProformaDrawer] = useState(false);
  const [proformaData, setProformaData] = useState<any>(null);
  const [isSavingPaymentPlan, setIsSavingPaymentPlan] = useState(false);
  const [generatedProformaName, setGeneratedProformaName] = useState<string>('');
  const [interactionCount, setInteractionCount] = useState<number>(0);
  const [interactionsCache, setInteractionsCache] = useState<ClientInteractionsCache | null>(null);
  
  // Note: Interaction count is now calculated upfront when entering the client page

  // Tabs array with dynamic interaction count - memoized to ensure updates
  const tabs = useMemo(() => {
    const finalCount = interactionCount || calculateInteractionCountSync();
    
    // Get current stage name
    const currentStageName = selectedClient ? getStageName(selectedClient.stage) : '';
    const isCreatedStage = areStagesEquivalent(currentStageName, 'Created');
    
    const allTabs = [
      { id: 'info', label: 'Info', icon: InformationCircleIcon, component: InfoTab },
      { id: 'roles', label: 'Roles', icon: UserGroupIcon, component: RolesTab },
      { id: 'contact', label: 'Contact info', icon: UserIcon, component: ContactInfoTab },
      { id: 'marketing', label: 'Marketing', icon: MegaphoneIcon, component: MarketingTab },
      { id: 'expert', label: 'Expert', icon: UserIcon, component: ExpertTab },
      { id: 'meeting', label: 'Meeting', icon: CalendarIcon, component: MeetingTab },
      { id: 'price', label: 'Price Offer', icon: CurrencyDollarIcon, component: PriceOfferTab },
      { id: 'interactions', label: 'Interactions', icon: ChatBubbleLeftRightIcon, badge: finalCount, component: InteractionsTab },
      { id: 'finances', label: 'Finances', icon: BanknotesIcon, component: FinancesTab },
    ];
    
    // Filter out Meeting, Price Offer, and Finances tabs when stage is "Created"
    if (isCreatedStage) {
      return allTabs.filter(tab => 
        tab.id !== 'meeting' && 
        tab.id !== 'price' && 
        tab.id !== 'finances'
      );
    }
    
    return allTabs;
  }, [interactionCount, selectedClient]);
  
  // Force re-render when interaction count changes
  const tabsKey = `tabs-${interactionCount}-${selectedClient?.id}`;
  
  // Switch away from hidden tabs (Meeting, Price Offer, Finances) when stage is "Created"
  useEffect(() => {
    if (!selectedClient) return;
    
    const currentStageName = getStageName(selectedClient.stage);
    const isCreatedStage = areStagesEquivalent(currentStageName, 'Created');
    
    if (isCreatedStage && (activeTab === 'meeting' || activeTab === 'price' || activeTab === 'finances')) {
      setActiveTab('info');
    }
  }, [selectedClient?.stage, activeTab]);

  // Reset cached interactions when switching to a different client
  useEffect(() => {
    if (!selectedClient?.id) {
      setInteractionsCache(null);
      return;
    }

    if (interactionsCache && interactionsCache.leadId !== selectedClient.id) {
      setInteractionsCache(null);
    }
  }, [selectedClient?.id, interactionsCache?.leadId]);

  // Calculate interaction count when client changes (fallback when cache is missing)
  useEffect(() => {
    if (!selectedClient) return;

    if (interactionsCache && interactionsCache.leadId === selectedClient.id) {
      const cachedCount =
        interactionsCache.count ??
        (interactionsCache.interactions ? interactionsCache.interactions.length : 0);
      setInteractionCount(cachedCount);
      return;
    }

    const updateInteractionCount = async () => {
      const count = await calculateFullInteractionCount();
      setInteractionCount(count);
    };

    updateInteractionCount();
  }, [selectedClient?.id, interactionsCache?.leadId]);

  const handleInteractionsCacheUpdate = useCallback(
    (cache: ClientInteractionsCache) => {
      setInteractionsCache(cache);
      const count = cache.count ?? (cache.interactions ? cache.interactions.length : 0);
      setInteractionCount(count);
    },
    []
  );

  const handleInteractionCountUpdate = useCallback((count: number) => {
    setInteractionCount(count);
  }, []);

  // Handler to open proforma drawer
  const handleOpenProforma = async (payment: any) => {
    const proformaName = await generateProformaName();
    setGeneratedProformaName(proformaName);
    setProformaData({
      client: selectedClient?.name,
      clientId: selectedClient?.id,
      paymentRowId: payment.id,
      payment: payment.value + payment.valueVat,
      base: payment.value,
      vat: payment.valueVat,
      language: 'EN',
      rows: [
        { description: payment.order, qty: 1, rate: payment.value, total: payment.value },
      ],
      addVat: true,
      currency: '₪',
      bankAccount: '',
      notes: '',
    });
    setShowProformaDrawer(true);
  };

  // Handler for proforma row changes
  const handleProformaRowChange = (idx: number, field: string, value: any) => {
    setProformaData((prev: any) => {
      const rows = prev.rows.map((row: any, i: number) =>
        i === idx ? { ...row, [field]: value, total: field === 'qty' || field === 'rate' ? value * (field === 'qty' ? row.rate : row.qty) : row.total } : row
      );
      return { ...prev, rows };
    });
  };

  // Handler to add row
  const handleAddProformaRow = () => {
    setProformaData((prev: any) => ({
      ...prev,
      rows: [...prev.rows, { description: '', qty: 1, rate: 0, total: 0 }],
    }));
  };

  // Handler to delete row
  const handleDeleteProformaRow = (idx: number) => {
    setProformaData((prev: any) => ({
      ...prev,
      rows: prev.rows.filter((_: any, i: number) => i !== idx),
    }));
  };

  // Generate proforma content as a structured object
  const generateProformaContent = async (data: any, createdBy: string) => {
    const total = data.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
    const totalWithVat = data.addVat ? Math.round(total * 1.18 * 100) / 100 : total;
    
    // Generate proforma name
    const proformaName = await generateProformaName();
    
    return JSON.stringify({
      client: data.client,
      clientId: data.clientId,
      proformaName: proformaName, // Add the generated name
      payment: data.payment,
      base: data.base,
      vat: data.vat,
      language: data.language,
      rows: data.rows,
      total: total,
      totalWithVat: totalWithVat,
      addVat: data.addVat,
      currency: data.currency,
      bankAccount: data.bankAccount,
      notes: data.notes,
      createdAt: new Date().toISOString(),
      createdBy: createdBy,
    });
  };
  // Handler for create proforma
  const handleCreateProforma = async () => {
    if (!proformaData) return;
    try {
      // Get current user (example for MSAL)
      let createdBy = 'Unknown';
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && user.email) {
          const { data: userData, error } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', user.email)
            .single();
          if (!error && userData?.full_name) {
            createdBy = userData.full_name;
          } else {
            createdBy = user.email;
          }
        }
      } catch {}
      // Generate proforma content with name and createdBy
      const proformaContent = await generateProformaContent(proformaData, createdBy);
      // Save proforma to the database for the specific payment row
      const { error } = await supabase
        .from('payment_plans')
        .update({ proforma: proformaContent })
        .eq('id', proformaData.paymentRowId);
      if (error) throw error;
      toast.success('Proforma created and saved successfully!');
      setShowProformaDrawer(false);
      setProformaData(null);
    } catch (error) {
      console.error('Error saving proforma:', error);
      toast.error('Failed to save proforma. Please try again.');
    }
  };

  // Function to save proforma content to database
  const saveProformaToDatabase = async (rowId: string | number, proformaContent: string) => {
    try {
      const { error } = await supabase
        .from('payment_plans')
        .update({ proforma: proformaContent })
        .eq('id', rowId);
      
      if (error) throw error;
      
      toast.success('Proforma saved successfully!');
      return true;
    } catch (error) {
      console.error('Error saving proforma:', error);
      toast.error('Failed to save proforma.');
      return false;
    }
  };

  // Function to view existing proforma
  const handleViewProforma = (payment: any) => {
    if (!payment.proforma || payment.proforma.trim() === '') return;
    
    try {
      const proformaData = JSON.parse(payment.proforma);
      setGeneratedProformaName(proformaData.proformaName || 'Proforma');
      setProformaData({
        ...proformaData,
        paymentRowId: payment.id,
        isViewMode: true, // Flag to indicate view-only mode
      });
      setShowProformaDrawer(true);
    } catch (error) {
      console.error('Error parsing proforma data:', error);
      toast.error('Failed to load proforma data.');
    }
  };

  // Function to get proforma name from stored data
  const getProformaName = (proformaData: string) => {
    if (!proformaData || proformaData.trim() === '') {
      return 'Proforma';
    }
    
    try {
      const parsed = JSON.parse(proformaData);
      return parsed.proformaName || 'Proforma';
    } catch {
      return 'Proforma';
    }
  };

  // Add state for sub-leads
  const [subLeads, setSubLeads] = useState<any[]>([]);
  const [isMasterLead, setIsMasterLead] = useState(false);
  
  // After extracting fullLeadNumber
  // Check if this is a sub-lead by looking at the lead_number in the database
  // Logic: If database lead_number contains '/', then it's a sub-lead
  // Example: lead_number = "192974/1" means this is a sub-lead of master lead "192974"
  const clientLeadNumber = selectedClient?.lead_number ?? '';
  const isSubLead = !!clientLeadNumber && clientLeadNumber.includes('/');
  const masterLeadNumber = isSubLead
    ? clientLeadNumber.split('/')[0]
    : selectedClient?.master_id || null;

  // Function to fetch sub-leads for master leads
  const fetchSubLeads = useCallback(async (baseLeadNumber: string) => {
    if (!baseLeadNumber || baseLeadNumber.trim() === '') {
      setSubLeads([]);
      setIsMasterLead(false);
      return [];
    }

    // Don't fetch subleads if current client is a sublead (has master_id)
    if (selectedClient?.master_id && String(selectedClient.master_id).trim() !== '') {
      setSubLeads([]);
      setIsMasterLead(false);
      return [];
    }

    // Check if the BASE LEAD (the one we're checking for subleads) has master_id and manual_id NULL
    // If both are NULL, it means there are no subleads connected to it - don't fetch
    const normalizedBase = baseLeadNumber.trim();
    const normalizedId = normalizedBase.replace(/^C/, ''); // Remove 'C' prefix if present
    
    let baseLeadMasterId: string | null | undefined = undefined;
    let baseLeadManualId: string | null | undefined = undefined;
    let foundBaseLead = false;
    
    // Determine if this is a legacy lead based on selectedClient
    // If selectedClient is a legacy lead, the base lead is also a legacy lead
    const isLegacyLead = selectedClient?.id && selectedClient.id.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      // For legacy leads, ONLY query leads_lead table
      try {
        const numericId = parseInt(normalizedBase, 10);
        if (!isNaN(numericId)) {
          const { data: legacyBaseLead, error: legacyError } = await supabase
            .from('leads_lead')
            .select('master_id, manual_id')
            .eq('id', numericId)
            .maybeSingle();
          
          if (!legacyError && legacyBaseLead) {
            baseLeadMasterId = legacyBaseLead.master_id;
            baseLeadManualId = legacyBaseLead.manual_id;
            foundBaseLead = true;
          }
        }
      } catch (error) {
        console.error('Error checking legacy lead master_id/manual_id:', error);
      }
    } else {
      // For new leads, ONLY query leads table by lead_number
      try {
        const { data: newBaseLead, error: newLeadError } = await supabase
          .from('leads')
          .select('master_id, manual_id')
          .eq('lead_number', normalizedBase)
          .maybeSingle();
        
        if (!newLeadError && newBaseLead) {
          baseLeadMasterId = newBaseLead.master_id;
          baseLeadManualId = newBaseLead.manual_id;
          foundBaseLead = true;
        }
      } catch (error) {
        console.error('Error checking new lead master_id/manual_id:', error);
      }
    }
    
    // If we found the base lead and it has a master_id (meaning it IS a sublead), don't fetch subleads
    if (foundBaseLead) {
      // Check if master_id is NOT NULL/empty (meaning this base lead IS a sublead itself)
      const hasMasterId = baseLeadMasterId !== null && baseLeadMasterId !== undefined && String(baseLeadMasterId).trim() !== '';
      
      // If the base lead has a master_id, it IS a sublead - don't fetch its subleads
      if (hasMasterId) {
        setSubLeads([]);
        setIsMasterLead(false);
        return [];
      }
      // If master_id is NULL, it's a master lead - proceed to fetch subleads
    }

    const allSubLeads: any[] = [];

    try {
      // Fetch new leads (from 'leads' table) with pattern matching
      const { data: newLeads, error: newLeadsError } = await supabase
        .from('leads')
        .select('lead_number, name, stage, manual_id, master_id')
        .like('lead_number', `${normalizedBase}/%`)
        .order('lead_number', { ascending: true });

      if (newLeadsError) {
        console.error('Error fetching new sub-leads:', newLeadsError);
      } else if (newLeads && newLeads.length > 0) {
        // Filter to only include leads that match the pattern
        // For new leads, we rely on lead_number pattern matching (e.g., "L209667/1")
        const validNewSubLeads = newLeads.filter(lead => {
          const leadNumberValue = lead.lead_number || '';
          const hasValidLeadNumber = !!leadNumberValue && leadNumberValue.includes('/');
          
          if (!hasValidLeadNumber) {
            return false;
          }
          
          // If master_id exists, it should match the base lead (or base without prefix)
          // But don't exclude if master_id is not set - pattern matching is sufficient
          if (lead.master_id && String(lead.master_id).trim() !== '') {
            const masterIdStr = String(lead.master_id).trim();
            const baseWithoutPrefix = normalizedBase.replace(/^C/, '').replace(/^L/, '');
            const normalizedBaseClean = normalizedBase.replace(/^C/, '').replace(/^L/, '');
            const masterMatchesBase = masterIdStr === normalizedBase || masterIdStr === normalizedBaseClean || masterIdStr === baseWithoutPrefix;
            if (!masterMatchesBase) {
              return false; // master_id doesn't point to this base lead
            }
          }
          
          return true;
        });
        allSubLeads.push(...validNewSubLeads);
      }

      // Also check for legacy leads with master_id pointing to this base lead
      const normalizedId = normalizedBase.replace(/^C/, ''); // Remove 'C' prefix if present
      
      const { data: legacyLeads, error: legacyLeadsError } = await supabase
        .from('leads_lead')
        .select('id, name, stage, manual_id, master_id')
        .or(`master_id.eq.${normalizedBase},master_id.eq.${normalizedId}`)
        .not('master_id', 'is', null)
        .order('id', { ascending: true });

      if (legacyLeadsError) {
        console.error('Error fetching legacy sub-leads:', legacyLeadsError);
      } else if (legacyLeads && legacyLeads.length > 0) {
        // Filter to only include legacy leads that have valid master_id or manual_id
        const validLegacySubLeads = legacyLeads.filter(lead => {
          const hasMasterId = lead.master_id && String(lead.master_id).trim() !== '';
          const hasManualId = lead.manual_id && String(lead.manual_id).trim() !== '';
          return hasMasterId || hasManualId;
        });
        allSubLeads.push(...validLegacySubLeads);
      }

      // Only set as master lead if we found valid subleads with master_id or manual_id
      if (allSubLeads.length > 0) {
        setSubLeads(allSubLeads);
        setIsMasterLead(true);
        return allSubLeads;
      } else {
        setSubLeads([]);
        setIsMasterLead(false);
        return [];
      }
    } catch (error) {
      console.error('Error fetching sub-leads:', error);
      setSubLeads([]);
      setIsMasterLead(false);
      return [];
    }
  }, [selectedClient?.master_id]);

  // Function to fetch next due payment
  const fetchNextDuePayment = useCallback(async (clientId: string) => {
    if (!clientId) return;
    
    try {
      const isLegacyLead = clientId.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // For legacy leads, fetch from finances_paymentplanrow table
        const legacyId = clientId.toString().replace('legacy_', '');
        
        const { data, error } = await supabase
          .from('finances_paymentplanrow')
          .select(`
            *,
            accounting_currencies!finances_paymentplanrow_currency_id_fkey (
              name,
              iso_code
            )
          `)
          .eq('lead_id', legacyId)
          .is('cancel_date', null) // Only active payments
          .order('due_date', { ascending: true })
          .limit(1);
        
        if (error) throw error;
        
        if (data && data.length > 0) {
          const payment = data[0];
          const today = new Date();
          const dueDate = new Date(payment.due_date);
          
          // Only show if payment is due today or in the future
          if (dueDate >= today) {
            setNextDuePayment({
              ...payment,
              isLegacy: true
            });
          } else {
            setNextDuePayment(null);
          }
        } else {
          setNextDuePayment(null);
        }
      } else {
        // For new leads, fetch from payment_plans table
        const { data, error } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('lead_id', clientId)
          .eq('paid', false) // Only unpaid payments
          .order('due_date', { ascending: true })
          .limit(1);
        
        if (error) throw error;
        
        if (data && data.length > 0) {
          const payment = data[0];
          const today = new Date();
          const dueDate = new Date(payment.due_date);
          
          // Only show if payment is due today or in the future
          if (dueDate >= today) {
            setNextDuePayment({
              ...payment,
              isLegacy: false
            });
          } else {
            setNextDuePayment(null);
          }
        } else {
          setNextDuePayment(null);
        }
      }
    } catch (error) {
      console.error('Error fetching next due payment:', error);
      setNextDuePayment(null);
    }
  }, []);

  // Fetch sub-leads when client changes
  useEffect(() => {
    // Don't fetch subleads if current client is a sublead (has master_id)
    if (selectedClient?.master_id && String(selectedClient.master_id).trim() !== '') {
      setSubLeads([]);
      setIsMasterLead(false);
      return;
    }

    // Determine base lead number for fetching subleads
    // IMPORTANT: Use the route parameter (fullLeadNumber) as the source of truth for legacy leads
    // The route parameter is always correct, while selectedClient.lead_number might be wrong
    let subLeadBase = '';
    
    const isLegacyLead = selectedClient?.id && selectedClient.id.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      // For legacy leads, use the route parameter directly (source of truth)
      // If route has a numeric ID like "123284", use it directly
      // Otherwise, fall back to the ID from selectedClient
      const routeLeadNumber = fullLeadNumber.trim();
      const isNumericRoute = /^\d+$/.test(routeLeadNumber);
      
      if (isNumericRoute) {
        // Route parameter is a numeric ID - use it directly
        subLeadBase = routeLeadNumber;
      } else {
        // Route parameter might be a sublead or something else - use ID from selectedClient
        subLeadBase = selectedClient.id.toString().replace('legacy_', '');
      }
    } else {
      // For new leads, use lead_number or id
      if (selectedClient?.lead_number && String(selectedClient.lead_number).trim() !== '') {
        const trimmed = String(selectedClient.lead_number).trim();
        subLeadBase = trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
      } else if (selectedClient?.id) {
        subLeadBase = selectedClient.id.toString();
      }
    }

    if (subLeadBase) {
      fetchSubLeads(subLeadBase);
    } else {
      setSubLeads([]);
      setIsMasterLead(false);
    }
  }, [fullLeadNumber, selectedClient?.lead_number, selectedClient?.master_id, selectedClient?.id, fetchSubLeads]);

  // Fetch next due payment when client changes
  useEffect(() => {
    if (selectedClient?.id) {
      fetchNextDuePayment(selectedClient.id.toString());
    } else {
      setNextDuePayment(null);
    }
  }, [selectedClient?.id, fetchNextDuePayment]);

  if (!localLoading && !selectedClient) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Clients</h1>
        <div className="alert">
          <span>Please select a client from search or create a new one.</span>
        </div>
      </div>
    );
  }
  const interactionsCacheForLead =
    selectedClient?.id && interactionsCache?.leadId === selectedClient.id
      ? interactionsCache
      : null;

  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component;
  const financeProps =
    activeTab === 'finances'
      ? { onCreateFinancePlan: () => setShowPaymentsPlanDrawer(true) }
      : {};
  // Before the return statement, add:
  let dropdownItems = null;
  // Get the stage name for comparison
  const currentStageName = selectedClient ? getStageName(selectedClient.stage) : '';
  const stageNumeric =
    selectedClient?.stage !== null && selectedClient?.stage !== undefined
      ? Number(selectedClient.stage)
      : null;
  const isStageNumeric = stageNumeric !== null && Number.isFinite(stageNumeric);
  const scheduleMenuLabel =
    isStageNumeric && stageNumeric >= 40 && stageNumeric !== 60 && stageNumeric !== 70 ? 'Another meeting' : 'Schedule Meeting';

  const handleScheduleMenuClick = useCallback(
    (event?: React.MouseEvent<HTMLAnchorElement>) => {
      if (event) {
        event.preventDefault();
      }

      // Decide which stage we want AFTER the meeting is successfully created:
      // - If the current stage is 40+ (already in meeting flow) BUT NOT stage 60 (Client signed agreement) or 70 (Payment request sent), this is an "Another meeting" action
      // - Otherwise it's the first "Schedule Meeting"
      const stageNumeric =
        selectedClient?.stage !== null && selectedClient?.stage !== undefined
          ? Number(selectedClient.stage)
          : null;

      if (stageNumeric !== null && Number.isFinite(stageNumeric) && stageNumeric >= 40 && stageNumeric !== 60 && stageNumeric !== 70) {
        setScheduleStageTarget('another_meeting');
      } else {
        setScheduleStageTarget('meeting_scheduled');
      }

      setShowScheduleMeetingPanel(true);
      (document.activeElement as HTMLElement | null)?.blur();
    },
    [selectedClient?.stage]
  );

  if (selectedClient && areStagesEquivalent(currentStageName, 'Created')) {
    dropdownItems = (
      <li className="px-2 py-2 text-sm text-base-content/70">
        No action available
      </li>
    );
  }
  else if (selectedClient && areStagesEquivalent(currentStageName, 'Communication started')) {
    dropdownItems = (
      <>
        <li>
          <a 
            className="flex items-center gap-3 py-3 saira-regular" 
            onClick={() => {
              setShowUpdateDrawer(true);
              (document.activeElement as HTMLElement)?.blur();
            }}
          >
            <PencilSquareIcon className="w-5 h-5 text-base-content" />
            Communication started
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={handleScheduleMenuClick}>
            <CalendarDaysIcon className="w-5 h-5 text-black" />
            {scheduleMenuLabel}
          </a>
        </li>
      </>
    );
  }
  else if (selectedClient && areStagesEquivalent(currentStageName, 'Client signed agreement'))
    dropdownItems = (
      <>
        {/* <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { setShowPaymentsPlanDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}>
            <BanknotesIcon className="w-5 h-5 text-base-content" />
            Payments plan
          </a>
        </li> */}
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { updateLeadStage('payment_request_sent'); (document.activeElement as HTMLElement)?.blur(); }}>
            <CurrencyDollarIcon className="w-5 h-5 text-base-content" />
            Payment request sent
          </a>
        </li>

      </>
    );
  else if (selectedClient && areStagesEquivalent(currentStageName, 'Success')) {
    dropdownItems = (
      <li className="px-2 py-2 text-sm text-base-content/70">
        No action available
      </li>
    );
  }
  else if (selectedClient && areStagesEquivalent(currentStageName, 'Handler Set')) {
    dropdownItems = (
      <li>
        <a className="flex items-center gap-3 py-3 saira-regular" onClick={handleStartCase}>
          <PlayIcon className="w-5 h-5 text-black" />
          Start Case
        </a>
      </li>
    );
  }
  else if (selectedClient && areStagesEquivalent(currentStageName, 'Handler Started')) {
    dropdownItems = (
      <>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { updateLeadStage('Application submitted'); (document.activeElement as HTMLElement)?.blur(); }}>
            <DocumentCheckIcon className="w-5 h-5 text-black" />
            Application submitted
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { updateLeadStage('Case Closed'); (document.activeElement as HTMLElement)?.blur(); }}>
            <CheckCircleIcon className="w-5 h-5 text-black" />
            Case closed
          </a>
        </li>
      </>
    );
  }
  else if (selectedClient && areStagesEquivalent(currentStageName, 'Application submitted')) {
    dropdownItems = (
      <li>
        <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { updateLeadStage('Case Closed'); (document.activeElement as HTMLElement)?.blur(); }}>
          <CheckCircleIcon className="w-5 h-5 text-black" />
          Case closed
        </a>
      </li>
    );
  }
  else if (selectedClient && areStagesEquivalent(currentStageName, 'Case Closed')) {
    dropdownItems = (
      <li className="px-2 py-2 text-sm text-base-content/70">
        No action available
      </li>
    );
  }
  // Note: "Meeting rescheduling" (stage 21) is now handled in the main condition below
  // to show the same options as meeting_scheduled (Reschedule Meeting and Meeting Ended)
  else if (selectedClient && (() => {
    const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
    const isUnactivated = isLegacy
      ? (selectedClient.status === 10)
      : (selectedClient.status === 'inactive');
    return isUnactivated;
  })()) {
    dropdownItems = (
      <li className="px-2 py-2 text-sm text-base-content/70">
        Please activate lead in actions first.
      </li>
    );
  }
  else if (selectedClient && areStagesEquivalent(currentStageName, 'payment_request_sent')) {
    dropdownItems = (
      <>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={handlePaymentReceivedNewClient}>
            <CheckCircleIcon className="w-5 h-5 text-green-600" />
            Payment Received - new Client !!!
          </a>
        </li>
        {/* <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { updateLeadStage('finances_and_payments_plan'); (document.activeElement as HTMLElement)?.blur(); }}>
            <BanknotesIcon className="w-5 h-5 text-black" />
            Finances & Payments plan
          </a>
        </li> */}
      </>
    );
  } else if (selectedClient && (() => {
    const excludedStages = ['client_signed', 'client_declined', 'Mtng sum+Agreement sent'];
    const isExcluded = excludedStages.some(stage => areStagesEquivalent(currentStageName, stage));
    return !isExcluded;
  })()) {
    dropdownItems = (
      <>
        {/* Special handling for "Another meeting" stage - only show Meeting ReScheduling and Meeting Ended */}
        {areStagesEquivalent(currentStageName, 'another_meeting') ? (
          <>
            <li>
              <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { setShowRescheduleDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}>
                <ArrowPathIcon className="w-5 h-5 text-black" />
                Meeting ReScheduling
              </a>
            </li>
            <li>
              <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => handleStageUpdate('Meeting Ended')}>
                <CheckCircleIcon className="w-5 h-5 text-black" />
                Meeting Ended
              </a>
            </li>
          </>
        ) : (areStagesEquivalent(currentStageName, 'meeting_scheduled') ||
        areStagesEquivalent(currentStageName, 'Meeting rescheduling') ||
        (isStageNumeric && (stageNumeric === 55 || stageNumeric === 21))) ? (
          <>
            {/* Only show Schedule Meeting button for stage 55, not for "Meeting scheduled" or "Meeting rescheduled" */}
            {!areStagesEquivalent(currentStageName, 'meeting_scheduled') && 
             !areStagesEquivalent(currentStageName, 'Meeting rescheduling') && (
              <li>
                <a className="flex items-center gap-3 py-3 saira-regular" onClick={handleScheduleMenuClick}>
                  <CalendarDaysIcon className="w-5 h-5 text-black" />
                  {scheduleMenuLabel}
                </a>
              </li>
            )}
            <li>
              <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { setShowRescheduleDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}>
                <ArrowPathIcon className="w-5 h-5 text-black" />
                Meeting ReScheduling
              </a>
            </li>
            {/* Only show "Meeting Ended" for stage 21 if there are upcoming meetings */}
            {!(areStagesEquivalent(currentStageName, 'Meeting rescheduling') || (isStageNumeric && stageNumeric === 21)) || hasScheduledMeetings ? (
              <li>
                <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => handleStageUpdate('Meeting Ended')}>
                  <CheckCircleIcon className="w-5 h-5 text-black" />
                  Meeting Ended
                </a>
              </li>
            ) : null}
          </>
        ) : (
          !['Success', 'handler_assigned'].some(stage => areStagesEquivalent(currentStageName, stage)) && (
            <li>
              <a className="flex items-center gap-3 py-3 saira-regular" onClick={handleScheduleMenuClick}>
                <CalendarDaysIcon className="w-5 h-5 text-black" />
                {scheduleMenuLabel}
              </a>
            </li>
          )
        )}
        {areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') && (
          <li>
            <a
              className="flex items-center gap-3 py-3 saira-regular"
              onClick={(e) => {
                e.preventDefault();
                openSendOfferModal();
                (document.activeElement as HTMLElement | null)?.blur();
              }}
            >
              <DocumentCheckIcon className="w-5 h-5 text-black" />
              Send Price Offer
            </a>
          </li>
        )}
        {(() => {
          const communicationExcludedStages = ['meeting_scheduled', 'another_meeting', 'waiting_for_mtng_sum', 'client_signed', 'client signed agreement', 'Client signed agreement', 'communication_started', 'Success', 'handler_assigned', 'Meeting rescheduling'];
          const isCommunicationExcluded = communicationExcludedStages.some(stage => areStagesEquivalent(currentStageName, stage));
          // Also exclude if current stage is 21 (Meeting rescheduled)
          const isStage21 = (isStageNumeric && stageNumeric === 21) || areStagesEquivalent(currentStageName, 'Meeting rescheduling');
          return !isCommunicationExcluded && !isStage21;
        })() && (
          <li>
            <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => handleStageUpdate('Communication Started')}>
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-black" />
              Communication Started
            </a>
          </li>
        )}
      </>
    );
  } else if (selectedClient && areStagesEquivalent(currentStageName, 'Mtng sum+Agreement sent')) {
    dropdownItems = (
      <>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={handleScheduleMenuClick}>
            <CalendarDaysIcon className="w-5 h-5 text-black" />
            {scheduleMenuLabel}
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={handleOpenSignedDrawer}>
            <HandThumbUpIcon className="w-5 h-5 text-black" />
            Client signed
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={handleOpenDeclinedDrawer}>
            <HandThumbDownIcon className="w-5 h-5 text-black" />
            <span className="text-black saira-regular">Client declined</span>
          </a>
        </li>
        <li>
          <a
            className="flex items-center gap-3 py-3 saira-regular"
            onClick={() => {
              openSendOfferModal();
              (document.activeElement as HTMLElement)?.blur();
            }}
          >
            <PencilSquareIcon className="w-5 h-5 text-black" />
            Revised price offer
          </a>
        </li>
      </>
    );
  }

  // Sub-lead drawer state
  const [showSubLeadDrawer, setShowSubLeadDrawer] = useState(false);
  const [subLeadStep, setSubLeadStep] = useState<'initial' | 'newContact' | 'newContactDetails' | 'newProcedure' | 'details' | 'sameContract'>('initial');
  // State for contracts and contacts with contracts (for "Same Contract" feature)
  const [contactContracts, setContactContracts] = useState<{
    [contactId: number]: {
      contactId: number;
      contactName: string;
      contractId: string;
      contractName: string;
      contactEmail?: string | null;
      contactPhone?: string | null;
      contactMobile?: string | null;
      contactCountryId?: number | null;
    };
  }>({});
  const [selectedContractContactId, setSelectedContractContactId] = useState<number | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [contactsWithContracts, setContactsWithContracts] = useState<Array<{
    contactId: number;
    contactName: string;
    contractId: string;
    contractName: string;
    contactEmail?: string | null;
    contactPhone?: string | null;
    contactMobile?: string | null;
    contactCountryId?: number | null;
  }>>([]);

  // Fetch contracts and contacts when drawer opens
  useEffect(() => {
    if (!showSubLeadDrawer || !selectedClient) return;
    
    const fetchContractsAndContacts = async () => {
      try {
        const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
        const contactsMap: { [contactId: number]: { contactName: string; contractId: string; contractName: string } } = {};
        
        if (!isLegacyLead && selectedClient?.id) {
          // For new leads, fetch contracts from contracts table
          const { data: contracts, error: contractsError } = await supabase
            .from('contracts')
            .select('id, template_id, contact_id, contact_name, status')
            .eq('client_id', selectedClient.id)
            .order('created_at', { ascending: false });
          
          if (contractsError) {
            console.error('Error fetching contracts:', contractsError);
            return;
          }
          
          if (contracts && contracts.length > 0) {
            // Fetch contract templates to get contract names
            const { data: templates } = await supabase
              .from('contract_templates')
              .select('id, name');
            
            const templateMap = new Map((templates || []).map(t => [t.id, t.name]));
            
            // Fetch contacts to get contact names
            const { data: leadContacts } = await supabase
              .from('lead_leadcontact')
              .select('contact_id, newlead_id')
              .eq('newlead_id', selectedClient.id);
            
            if (leadContacts && leadContacts.length > 0) {
              const contactIds = leadContacts.map(lc => lc.contact_id).filter(Boolean);
              
            const { data: contacts } = await supabase
              .from('leads_contact')
              .select('id, name, email, phone, mobile, country_id')
                .in('id', contactIds);
              
              const contactMap = new Map((contacts || []).map(c => [c.id, c]));
              
              // Process contracts and map them to contacts
              contracts.forEach(contract => {
                const contactId = contract.contact_id;
                if (contactId) {
                  const contactRecord: any = contactMap.get(contactId);
                  const contactName = contract.contact_name || contactRecord?.name || 'Unknown Contact';
                  const contactEmail = contactRecord?.email || null;
                  const contactPhone = contactRecord?.phone || null;
                  const contactMobile = contactRecord?.mobile || null;
                  const contactCountryId = contactRecord?.country_id ?? null;
                  const contractName = templateMap.get(contract.template_id) || 'Contract';
                  
                  if (!contactsMap[contactId] || contracts.indexOf(contract) === 0) {
                    // Only store the most recent contract per contact
                    contactsMap[contactId] = {
                      contactId,
                      contactName,
                      contractId: contract.id,
                      contractName,
                      contactEmail,
                      contactPhone,
                      contactMobile,
                      contactCountryId
                    };
                  }
                }
              });
            }
          }
        }
        
        const contactsList = Object.values(contactsMap);
        setContactsWithContracts(contactsList);
        setContactContracts(contactsMap);
      } catch (error) {
        console.error('Error fetching contracts and contacts:', error);
      }
    };
    
    fetchContractsAndContacts();
  }, [showSubLeadDrawer, selectedClient]);
  const [subLeadForm, setSubLeadForm] = useState({
    name: '',
    email: '',
    phone: '',
    mobile: '', // For new contact details
    country: '', // For new contact details (country name)
    countryId: '', // For new contact details (country ID)
    category: '',
    categoryId: '',
    topic: '',
    special_notes: '',
    source: '',
    language: '',
    tags: '',
    facts: '',
    // Details step fields
    handler: '',
    handlerId: '',
    currency: 'NIS',
    numApplicants: '',
    proposal: '',
    potentialValue: '',
  });
  const [isSavingSubLead, setIsSavingSubLead] = useState(false);

  const normalizeCurrencyForForm = useCallback((value: string | null | undefined) => {
    if (!value) return 'NIS';
    const normalized = value.trim();
    if (normalized === '') return 'NIS';
    switch (normalized) {
      case '₪':
      case 'ILS':
      case 'NIS':
        return 'NIS';
      case '$':
      case 'USD':
        return 'USD';
      case '€':
      case 'EUR':
        return 'EUR';
      default:
        return normalized;
    }
  }, []);

  const convertCurrencyForInsert = useCallback((value: string | null | undefined) => {
    if (!value) return '₪';
    switch (value.trim()) {
      case 'NIS':
      case 'ILS':
        return '₪';
      case 'USD':
        return 'USD';
      case 'EUR':
        return 'EUR';
      default:
        return value;
    }
  }, []);
  const toBigIntSafe = (value: any): bigint | null => {
    if (value === null || value === undefined || value === '') return null;
    try {
      if (typeof value === 'bigint') return value;
      const normalized = typeof value === 'number' ? Math.trunc(value) : (value as string).trim();
      if (normalized === '') return null;
      return BigInt(normalized);
    } catch {
      return null;
    }
  };

const extractDigits = (value: any): string | null => {
  if (value === null || value === undefined) return null;
  const digits = String(value).match(/\d+/g)?.join('');
  if (!digits || digits.trim() === '') return null;
  return digits.replace(/^0+(?=\d)/, '') || '0';
};

const getMaxNumericValue = (rows: any[] | null | undefined, key: string): bigint => {
  let max = BigInt(0);
  rows?.forEach(row => {
    const digits = extractDigits((row as any)[key]);
    if (digits) {
      try {
        const value = BigInt(digits);
        if (value > max) {
          max = value;
        }
      } catch {
        // Ignore values that cannot be parsed to BigInt
      }
    }
  });
  return max;
};

const getMaxManualIdFromLeads = async (): Promise<bigint> => {
  const { data, error } = await supabase
    .from('leads')
    .select('manual_id');

  if (error) throw error;
  return getMaxNumericValue(data, 'manual_id');
};

const getMaxManualIdFromLegacy = async (): Promise<bigint> => {
  const { data, error } = await supabase
    .from('leads_lead')
    .select('manual_id');

  if (error) throw error;
  return getMaxNumericValue(data, 'manual_id');
};

const getMaxLeadNumberFromLeads = async (): Promise<bigint> => {
  const { data, error } = await supabase
    .from('leads')
    .select('lead_number');

  if (error) throw error;
  return getMaxNumericValue(data, 'lead_number');
};

const getMaxLeadNumberFromLegacy = async (): Promise<bigint> => {
  const { data, error } = await supabase
    .from('leads_lead')
    .select('lead_number');

  if (error) throw error;
  return getMaxNumericValue(data, 'lead_number');
};

  const getMaxLegacyLeadId = async (): Promise<bigint> => {
    const { data, error } = await supabase
      .from('leads_lead')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);

    if (error) throw error;
    const legacyId = data?.[0]?.id;
    const parsed = toBigIntSafe(legacyId);
    return parsed ?? BigInt(0);
  };

const manualIdExists = async (manualId: bigint): Promise<boolean> => {
  const manualString = manualId.toString();

  try {
    // Check leads table first
    const leadsCheck = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .or(
        [
          `manual_id.eq.${manualString}`,
          `lead_number.eq.${manualString}`,
          `lead_number.eq.L${manualString}`,
          `lead_number.like.${manualString}/%`,
          `lead_number.like.L${manualString}/%`,
        ].join(',')
      );

    if (leadsCheck.error) {
      console.warn('Error checking manual_id in leads table:', leadsCheck.error);
    } else if ((leadsCheck.count ?? 0) > 0) {
      return true;
    }

    // Check legacy table separately to avoid query issues
    try {
      const legacyCheckManualId = await supabase
        .from('leads_lead')
        .select('id', { count: 'exact', head: true })
        .eq('manual_id', manualString);
      
      if (!legacyCheckManualId.error && (legacyCheckManualId.count ?? 0) > 0) {
        return true;
      }
    } catch (err) {
      console.warn('Error checking manual_id in leads_lead table:', err);
    }

    try {
      const legacyCheckLeadNumber = await supabase
        .from('leads_lead')
        .select('id', { count: 'exact', head: true })
        .eq('lead_number', manualString);
      
      if (!legacyCheckLeadNumber.error && (legacyCheckLeadNumber.count ?? 0) > 0) {
        return true;
      }
    } catch (err) {
      console.warn('Error checking lead_number in leads_lead table:', err);
    }

    // Don't check id.eq as it might cause type issues - manual_id and lead_number are sufficient
    return false;
  } catch (error) {
    console.error('Error in manualIdExists:', error);
    // On error, assume ID doesn't exist to allow creation to proceed
    return false;
  }
};

const ensureUniqueManualId = async (initialManualId: bigint): Promise<bigint> => {
  let candidate = initialManualId;
  let attempts = 0;

  while (attempts < 1000) {
    const exists = await manualIdExists(candidate);
    if (!exists) return candidate;
    candidate += BigInt(1);
    attempts += 1;
  }

  throw new Error('Unable to determine a unique manual_id');
};

const getNextAvailableManualId = async (): Promise<bigint> => {
  try {
    const [newManualMax, legacyManualMax, newLeadNumberMax, legacyLeadNumberMax, legacyIdMax] = await Promise.all([
      getMaxManualIdFromLeads().catch(err => {
        console.warn('Error getting max manual_id from leads table:', err);
        return BigInt(0);
      }),
      getMaxManualIdFromLegacy().catch(err => {
        console.warn('Error getting max manual_id from legacy table:', err);
        return BigInt(0);
      }),
      getMaxLeadNumberFromLeads().catch(err => {
        console.warn('Error getting max lead_number from leads table:', err);
        return BigInt(0);
      }),
      getMaxLeadNumberFromLegacy().catch(err => {
        console.warn('Error getting max lead_number from legacy table:', err);
        return BigInt(0);
      }),
      getMaxLegacyLeadId().catch(err => {
        console.warn('Error getting max legacy lead id:', err);
        return BigInt(0);
      }),
    ]);
    const currentMax = [newManualMax, legacyManualMax, newLeadNumberMax, legacyLeadNumberMax, legacyIdMax].reduce(
      (acc, value) => (value > acc ? value : acc),
      BigInt(0)
    );
    return await ensureUniqueManualId(currentMax + BigInt(1));
  } catch (error) {
    console.error('Error in getNextAvailableManualId, using timestamp-based fallback:', error);
    // Fallback: use timestamp-based ID if all else fails
    const timestampId = BigInt(Date.now());
    return timestampId;
  }
};

const computeNextSubLeadSuffix = async (baseLeadNumber: string): Promise<number> => {
  if (!baseLeadNumber || baseLeadNumber.trim() === '') {
    throw new Error('Invalid base lead number for sub-lead suffix calculation');
  }

  const normalizedBase = baseLeadNumber.trim();
  const suffixes: number[] = [];

  // Query both new leads and legacy leads tables for suffixes
  try {
    const [newLeadRowsResult, legacyLeadRowsResult] = await Promise.all([
      supabase
        .from('leads')
        .select('lead_number')
        .like('lead_number', `${normalizedBase}/%`)
        .limit(100),
      supabase
        .from('leads_lead')
        .select('lead_number')
        .like('lead_number', `${normalizedBase}/%`)
        .limit(100)
    ]);

    if (newLeadRowsResult.error) {
      console.warn('Error querying new leads for suffix:', newLeadRowsResult.error);
    } else {
      newLeadRowsResult.data?.forEach(row => {
        const leadNumber = row.lead_number ? String(row.lead_number) : '';
        const match = leadNumber.match(/\/(\d+)$/);
        if (match) {
          const parsed = parseInt(match[1], 10);
          if (!Number.isNaN(parsed)) {
            suffixes.push(parsed);
          }
        }
      });
    }

    // Note: leads_lead table doesn't have 'lead_number' column
    // Legacy leads use 'id' as the lead number, and sub-leads are identified by 'master_id'
    // So we skip querying leads_lead for suffixes here - it will be handled separately
    // when creating legacy sub-leads by counting existing sub-leads with same master_id
  } catch (error) {
    console.warn('Error processing leads for suffix:', error);
    // Return default suffix 2 if processing fails
    return 2;
  }

  // Calculate suffix from found values, default to 2
  const calculatedSuffix = suffixes.length > 0 ? Math.max(...suffixes) + 1 : 2;
  return Math.max(calculatedSuffix, 2);
};
  const prefillSubLeadFormFromClient = useCallback(() => {
    if (!selectedClient) return;

    const baseCategoryId = selectedClient.category_id != null ? String(selectedClient.category_id) : '';
    const categoryOption = baseCategoryId ? categoryOptionsMap.get(baseCategoryId) : undefined;

    const rawHandlerId =
      selectedClient.case_handler_id != null
        ? String(selectedClient.case_handler_id)
        : (() => {
            if (!selectedClient.handler) return '';
            const found = handlerOptions.find(opt => opt.label === selectedClient.handler);
            return found?.id || '';
          })();

    const handlerLabel = rawHandlerId
      ? handlerOptionsMap.get(rawHandlerId) || selectedClient.handler || ''
      : selectedClient.handler || '';

    const resolvedCurrency =
      selectedClient.balance_currency ||
      selectedClient.meeting_total_currency ||
      selectedClient.proposal_currency ||
      selectedClient.currency ||
      subLeadForm.currency ||
      '₪';

    const resolvedApplicants =
      selectedClient.number_of_applicants_meeting != null
        ? String(selectedClient.number_of_applicants_meeting)
        : selectedClient.number_of_applicants != null
          ? String(selectedClient.number_of_applicants)
          : '';

    setSubLeadForm(prev => ({
      ...prev,
      name: selectedClient.name || '',
      email: selectedClient.email || '',
      phone: selectedClient.phone || '',
      category: categoryOption?.label || selectedClient.category || '',
      categoryId: baseCategoryId || '',
      topic: selectedClient.topic || '',
      special_notes: selectedClient.special_notes || '',
      source: selectedClient.source || '',
      language: selectedClient.language || '',
      facts: selectedClient.facts || '',
      tags: (() => {
        if (Array.isArray(selectedClient.tags)) {
          return selectedClient.tags.join(', ');
        }
        if (typeof selectedClient.tags === 'string') {
          return selectedClient.tags;
        }
        return prev.tags;
      })(),
      handler: handlerLabel || '',
      handlerId: rawHandlerId || '',
      currency: normalizeCurrencyForForm(resolvedCurrency),
      numApplicants: resolvedApplicants,
      proposal: '',
      potentialValue: '',
    }));
  }, [
    categoryOptionsMap,
    handlerOptions,
    handlerOptionsMap,
    selectedClient,
    subLeadForm.currency,
    normalizeCurrencyForForm,
  ]);

  // Handler to save sub-lead
  const handleSaveSubLead = async () => {
    if (!selectedClient || isSavingSubLead) return;

    const trimmedName = subLeadForm.name.trim();
    const validationErrors: string[] = [];

    if (!trimmedName) {
      validationErrors.push('Name is required to create a sub-lead.');
    }

    // Category will automatically be inherited from the master lead - no validation needed
    // We'll ensure it's set from selectedClient.category_id in the save logic

    if (validationErrors.length > 0) {
      toast.error(validationErrors[0]);
      return;
    }

    const masterBaseNumber = (() => {
      if (selectedClient.lead_number && String(selectedClient.lead_number).trim() !== '') {
        const trimmed = String(selectedClient.lead_number).trim();
        return trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
      }
      if (selectedClient.master_id && String(selectedClient.master_id).trim() !== '') {
        const trimmed = String(selectedClient.master_id).trim();
        return trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
      }
      return '';
    })();

    if (!masterBaseNumber) {
      toast.error('Unable to determine master lead number for sub-lead creation.');
      return;
    }

    setIsSavingSubLead(true);
    try {
      // Check if the parent is a legacy lead
      const isLegacyParent = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
      
      // Get parent legacy lead's actual ID if it's a legacy lead
      let parentLegacyId: number | null = null;
      if (isLegacyParent) {
        const legacyIdStr = selectedClient.id.toString().replace('legacy_', '');
        parentLegacyId = parseInt(legacyIdStr, 10);
        if (isNaN(parentLegacyId)) {
          toast.error('Unable to determine parent legacy lead ID.');
          setIsSavingSubLead(false);
          return;
        }
      }
      
      const manualId = await getNextAvailableManualId();
      // For legacy leads, manual_id should be numeric (bigint) - ensure it's a number
      // For new leads, manual_id is stored as text
      const manualIdString = manualId.toString(); // Used for new leads and navigation
      const manualIdForLegacy = isLegacyParent ? Number(manualId) : manualId.toString();
      
      // Ensure parentLegacyId is properly set and numeric
      if (isLegacyParent && (!parentLegacyId || isNaN(parentLegacyId))) {
        toast.error('Invalid parent legacy lead ID.');
        setIsSavingSubLead(false);
        return;
      }

      // For legacy sub-leads, calculate suffix by counting existing sub-leads with same master_id
      // For new leads, use the standard suffix calculation
      let nextSuffix: number;
      if (isLegacyParent) {
        // Count existing sub-leads with the same master_id
        const { data: existingSubLeads, error: countError } = await supabase
          .from('leads_lead')
          .select('id')
          .eq('master_id', parentLegacyId)
          .not('master_id', 'is', null);
        
        if (countError) {
          console.warn('Error counting existing legacy sub-leads:', countError);
          nextSuffix = 2; // Default to 2 if count fails
        } else {
          // Suffix is count + 1 (first sub-lead is /2, second is /3, etc.)
          nextSuffix = (existingSubLeads?.length || 0) + 2;
        }
      } else {
        // For new leads, use standard suffix calculation
        nextSuffix = await computeNextSubLeadSuffix(masterBaseNumber);
      }
      
      const subLeadNumber = `${masterBaseNumber}/${nextSuffix}`;
      
      // For legacy leads, master_id should be the parent's actual ID (numeric), not extracted digits
      // For new leads, use extracted digits or base number
      const masterIdValue = isLegacyParent ? parentLegacyId : (extractDigits(masterBaseNumber) ?? masterBaseNumber);

      // For sub-leads, use form's category_id first (user may have changed it), then fall back to master lead
      let categoryIdValue: number | null = null;
      
      // Primary source: Form's categoryId (user selection)
      if (subLeadForm.categoryId && subLeadForm.categoryId.trim() !== '') {
        const categoryIdStr = subLeadForm.categoryId.trim();
        const parsedId = Number(categoryIdStr);
        if (!Number.isNaN(parsedId) && parsedId > 0) {
          categoryIdValue = parsedId;
        }
      }
      
      // If not in form, try to find it from the form category name/text
      if (categoryIdValue === null && subLeadForm.category && subLeadForm.category.trim() !== '') {
        const matchingOption = categoryOptions.find(opt => 
          opt.label === subLeadForm.category || 
          opt.label.toLowerCase() === subLeadForm.category.toLowerCase()
        );
        if (matchingOption) {
          const parsedId = Number(matchingOption.id);
          if (!Number.isNaN(parsedId) && parsedId > 0) {
            categoryIdValue = parsedId;
          }
        }
      }
      
      // Fallback: Inherit from master lead's category_id
      if (categoryIdValue === null && selectedClient?.category_id != null) {
        const clientCategoryId = typeof selectedClient.category_id === 'number' 
          ? selectedClient.category_id 
          : Number(selectedClient.category_id);
        if (!Number.isNaN(clientCategoryId) && clientCategoryId > 0) {
          categoryIdValue = clientCategoryId;
        }
      }
      
      // If category_id is still null but we have category text from master lead, search for it in allCategories
      if (categoryIdValue === null && selectedClient?.category && selectedClient.category.trim() !== '') {
        console.log('🔍 Master lead has category text but no category_id, searching in allCategories:', {
          categoryText: selectedClient.category,
          allCategoriesCount: allCategories.length
        });
        
        // Try to find category by matching the text
        // The category text might be in format like "Lived bef 1933,le af (Germany)" or just the name
        const categoryText = selectedClient.category.trim();
        
        // First try exact match with category name
        let foundCategory = allCategories.find((cat: any) => {
          const catName = cat.name?.trim() || '';
          return catName.toLowerCase() === categoryText.toLowerCase();
        });
        
        // If not found, try matching just the category name part (before comma or parentheses)
        if (!foundCategory) {
          const categoryNamePart = categoryText.split(',')[0].split('(')[0].trim();
          foundCategory = allCategories.find((cat: any) => {
            const catName = cat.name?.trim() || '';
            return catName.toLowerCase() === categoryNamePart.toLowerCase();
          });
        }
        
        // If still not found, try partial match
        if (!foundCategory) {
          const categoryNamePart = categoryText.split(',')[0].split('(')[0].trim();
          foundCategory = allCategories.find((cat: any) => {
            const catName = cat.name?.trim() || '';
            return catName.toLowerCase().includes(categoryNamePart.toLowerCase()) ||
                   categoryNamePart.toLowerCase().includes(catName.toLowerCase());
          });
        }
        
        // Also try matching with the formatted label (Main Category > Category)
        if (!foundCategory) {
          foundCategory = categoryOptions.find(opt => {
            const optLabel = opt.label?.trim() || '';
            return optLabel.toLowerCase() === categoryText.toLowerCase() ||
                   optLabel.toLowerCase().includes(categoryText.toLowerCase()) ||
                   categoryText.toLowerCase().includes(optLabel.toLowerCase());
          });
          if (foundCategory) {
            const parsedId = Number(foundCategory.id);
            if (!Number.isNaN(parsedId) && parsedId > 0) {
              categoryIdValue = parsedId;
              console.log('✅ Found category ID from formatted label:', { categoryId: categoryIdValue, label: foundCategory.label });
            }
          }
        }
        
        if (foundCategory && !categoryIdValue) {
          const parsedId = Number(foundCategory.id || foundCategory.raw?.id);
          if (!Number.isNaN(parsedId) && parsedId > 0) {
            categoryIdValue = parsedId;
            console.log('✅ Found category ID from category search:', { 
              categoryId: categoryIdValue, 
              categoryName: foundCategory.name || foundCategory.raw?.name 
            });
          }
        }
      }
      
      // Final validation - if still null, show error
      if (categoryIdValue === null || categoryIdValue <= 0) {
        console.error('❌ Category ID could not be determined:', {
          masterLeadCategoryId: selectedClient?.category_id,
          masterLeadCategory: selectedClient?.category,
          formCategoryId: subLeadForm.categoryId,
          formCategory: subLeadForm.category,
          allCategoriesCount: allCategories.length
        });
        toast.error('Unable to determine category. The master lead must have a category set.');
        setIsSavingSubLead(false);
        return;
      }
      
      console.log('✅ Category ID inherited from master lead:', { 
        categoryIdValue, 
        masterLeadCategoryId: selectedClient?.category_id,
        masterLeadName: selectedClient?.name
      });

      let handlerIdValue: string | number | null = null;
      if (subLeadForm.handlerId && subLeadForm.handlerId.trim() !== '') {
        const trimmedHandlerId = subLeadForm.handlerId.trim();
        handlerIdValue = /^\d+$/.test(trimmedHandlerId) ? Number(trimmedHandlerId) : trimmedHandlerId;
      }
      const handlerLabel = subLeadForm.handlerId
        ? handlerOptionsMap.get(subLeadForm.handlerId) || subLeadForm.handler || ''
        : subLeadForm.handler || '';

      const parseNumericInput = (value: string) => {
        if (!value) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const proposalAmount = parseNumericInput(subLeadForm.proposal);
      const potentialValueAmount = parseNumericInput(subLeadForm.potentialValue);
      const applicantCount = parseNumericInput(subLeadForm.numApplicants);
      const currencyValue = convertCurrencyForInsert(subLeadForm.currency);

      const createdStageId = getStageIdOrWarn('Created');
      if (createdStageId === null) {
        toast.error('Unable to resolve the "Created" stage. Please contact an administrator.');
        setIsSavingSubLead(false);
        return;
      }
      
      // For subleads created with same contract, always set stage to 60 (client signed agreement)
      let targetStageId: number | null = null;
      if (subLeadStep === 'sameContract') {
        const clientSignedStageId = getStageIdOrWarn('Client signed agreement');
        if (clientSignedStageId === null) {
          console.warn('Unable to resolve "Client signed agreement" stage, falling back to stage ID 60');
          targetStageId = 60; // Fallback to direct ID if stage name resolution fails
        } else {
          targetStageId = clientSignedStageId;
        }
      } else {
        // For other sublead creation scenarios, use the created stage
        targetStageId = createdStageId;
      }

      // Final validation - categoryIdValue should never be null at this point
      if (!categoryIdValue || categoryIdValue <= 0) {
        console.error('❌ CRITICAL: categoryIdValue is invalid after all checks:', {
          categoryIdValue,
          formCategoryId: subLeadForm.categoryId,
          formCategory: subLeadForm.category,
          clientCategoryId: selectedClient?.category_id
        });
        toast.error('Unable to determine a valid category ID. Please select a category from the dropdown and try again.');
        setIsSavingSubLead(false);
        return;
      }

      // Prepare lead data - structure differs for legacy vs new leads
      let newLeadData: Record<string, any>;
      let tableName: string;
      
      if (isLegacyParent) {
        // For legacy sub-leads, create in leads_lead table
        // Note: leads_lead table doesn't have 'lead_number' column - the 'id' column IS the lead number
        // The 'id' must be manually set - get the next available ID
        tableName = 'leads_lead';
        
        // Get the next available ID from leads_lead table
        // Also check leads table's lead_number (with L prefix) to ensure ID is higher
        const [maxIdResult, maxLeadNumberResult] = await Promise.all([
          supabase
            .from('leads_lead')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('leads')
            .select('lead_number')
            .like('lead_number', 'L%')
            .order('lead_number', { ascending: false })
            .limit(100) // Get multiple to find the max numeric value
        ]);
        
        if (maxIdResult.error) {
          console.error('Error getting max ID from leads_lead:', maxIdResult.error);
          throw new Error('Failed to get next available ID for legacy sub-lead');
        }
        
        // Get max ID from leads_lead
        const maxLegacyId = maxIdResult.data?.id ? Number(maxIdResult.data.id) : 0;
        
        // Get max numeric value from leads table's lead_number (strip L prefix)
        let maxLeadsNumber = 0;
        if (maxLeadNumberResult.data && !maxLeadNumberResult.error) {
          maxLeadNumberResult.data.forEach(row => {
            if (row.lead_number) {
              const leadNumStr = String(row.lead_number);
              // Strip "L" prefix and extract numeric part
              const numericPart = leadNumStr.replace(/^L/, '');
              const numericValue = parseInt(numericPart, 10);
              if (!isNaN(numericValue) && numericValue > maxLeadsNumber) {
                maxLeadsNumber = numericValue;
              }
            }
          });
        }
        
        // Use the maximum of both, then add 1
        const nextId = Math.max(maxLegacyId, maxLeadsNumber) + 1;
        
        newLeadData = {
          id: nextId, // Manually set the ID (this IS the lead number for legacy leads)
          manual_id: Number(manualIdForLegacy), // Must be numeric (bigint) for leads_lead
          master_id: Number(masterIdValue), // Parent legacy lead's ID (must be numeric bigint)
          // lead_number doesn't exist in leads_lead - id is the lead number
          name: trimmedName,
          email: subLeadForm.email || null,
          phone: subLeadForm.phone || null,
          mobile: null,
          category_id: categoryIdValue,
          topic: subLeadForm.topic || null,
          special_notes: subLeadForm.special_notes || null,
          source_id: null, // Legacy leads use source_id, not source
          language_id: null, // Legacy leads use language_id, not language
          description: subLeadForm.facts || null, // Legacy leads use 'description' instead of 'facts'
          // Legacy leads don't have 'tags' column
          stage: targetStageId,
          probability: 0,
          total: proposalAmount ?? 0,
          meeting_total: proposalAmount ?? 0,
          // Legacy leads don't have 'handler' column, only 'case_handler_id'
          case_handler_id: handlerIdValue,
          no_of_applicants: applicantCount || null,
          cdate: new Date().toISOString().split('T')[0],
          udate: new Date().toISOString().split('T')[0],
        };
      } else {
        // For new sub-leads, create in leads table
        tableName = 'leads';
        newLeadData = {
          manual_id: manualIdString,
          master_id: masterIdValue,
          lead_number: subLeadNumber,
          name: trimmedName,
          email: subLeadForm.email,
          phone: subLeadForm.phone,
          category_id: categoryIdValue,
          category: null,
          topic: subLeadForm.topic,
          special_notes: subLeadForm.special_notes,
          source: subLeadForm.source,
          language: subLeadForm.language,
          facts: subLeadForm.facts,
          tags: subLeadForm.tags,
          stage: targetStageId,
          probability: 0,
          balance: proposalAmount ?? 0,
          balance_currency: currencyValue,
          meeting_total: proposalAmount,
          meeting_total_currency: currencyValue,
          proposal_total: proposalAmount,
          potential_value: potentialValueAmount,
          handler: handlerLabel || null,
          case_handler_id: handlerIdValue,
          number_of_applicants_meeting: applicantCount,
          created_at: new Date().toISOString(),
        };
      }
      
      console.log('🔍 Creating sublead with data:', {
        isLegacyParent,
        tableName,
        subLeadStep,
        newLeadData: { ...newLeadData, manual_id: newLeadData.manual_id?.toString() },
        masterBaseNumber,
        subLeadNumber,
        masterIdValue
      });
      
      const { data: insertedLead, error } = await supabase.from(tableName).insert([newLeadData]).select('id').single();
      
      if (error) {
        console.error('❌ Error inserting lead:', {
          error,
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
          code: error?.code
        });
        throw error;
      }
      
      console.log('✅ Lead inserted successfully:', insertedLead);
      
      // Create the first contact in leads_contact and lead_leadcontact tables
      if (insertedLead?.id) {
        const insertedLeadId = insertedLead.id;
        // Get the next available contact ID
        const { data: maxContactId } = await supabase
          .from('leads_contact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();
        
        const newContactId = maxContactId ? maxContactId.id + 1 : 1;
        const currentDate = new Date().toISOString().split('T')[0];
        
        // Determine contact details based on which step we came from
        let contactName: string;
        let contactMobile: string | null;
        let contactPhone: string | null;
        let contactEmail: string | null;
        let contactCountryId: number | null = null;
        
        if (subLeadStep === 'newContactDetails') {
          // Use new contact details from form
          contactName = trimmedName;
          contactMobile = subLeadForm.mobile || null;
          contactPhone = subLeadForm.phone || null;
          contactEmail = subLeadForm.email || null;
          contactCountryId = subLeadForm.countryId ? Number(subLeadForm.countryId) : null;
        } else if (subLeadStep === 'sameContract' && selectedContractContactId) {
          const storedContact = contactContracts[selectedContractContactId];
          
          contactName = trimmedName || storedContact?.contactName || selectedClient?.name || '';
          contactMobile = storedContact?.contactMobile || selectedClient?.mobile || null;
          contactPhone = storedContact?.contactPhone || selectedClient?.phone || null;
          contactEmail = storedContact?.contactEmail || selectedClient?.email || null;
          contactCountryId = storedContact?.contactCountryId ?? selectedClient?.country_id ?? null;
        } else {
          // For 'newProcedure', fetch the existing client's main contact information
          const isLegacyClient = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
          
          // Try to get main contact from client (both legacy and new leads)
          let mainContact = null;
          if (selectedClient?.id) {
            if (isLegacyClient) {
              // Fetch main contact for legacy leads
              const legacyId = selectedClient.id.toString().replace('legacy_', '');
              const { data: leadContacts } = await supabase
                .from('lead_leadcontact')
                .select('contact_id, main')
                .eq('lead_id', legacyId)
                .eq('main', 'true')
                .limit(1)
                .maybeSingle();
              
              if (leadContacts?.contact_id) {
                const { data: contactData } = await supabase
                  .from('leads_contact')
                  .select('name, email, phone, mobile, country_id')
                  .eq('id', leadContacts.contact_id)
                  .maybeSingle();
                
                if (contactData) {
                  mainContact = contactData;
                }
              }
            } else {
              // Fetch main contact for new leads
              const { data: leadContacts } = await supabase
                .from('lead_leadcontact')
                .select('contact_id, main')
                .eq('newlead_id', selectedClient.id)
                .eq('main', true)
                .limit(1)
                .maybeSingle();
              
              if (leadContacts?.contact_id) {
                const { data: contactData } = await supabase
                  .from('leads_contact')
                  .select('name, email, phone, mobile, country_id')
                  .eq('id', leadContacts.contact_id)
                  .maybeSingle();
                
                if (contactData) {
                  mainContact = contactData;
                }
              }
            }
          }
          
          // Use main contact data if available, otherwise fall back to client data
          contactName = trimmedName || mainContact?.name || selectedClient?.name || '';
          contactMobile = mainContact?.mobile || selectedClient?.mobile || null;
          contactPhone = mainContact?.phone || selectedClient?.phone || null;
          contactEmail = mainContact?.email || selectedClient?.email || null;
          contactCountryId = mainContact?.country_id || selectedClient?.country_id || null;
          
          if (contactCountryId && typeof contactCountryId !== 'number') {
            contactCountryId = Number(contactCountryId) || null;
          }
        }
        
        // Insert the first contact
        const contactInsertData: Record<string, any> = {
          id: newContactId,
          name: contactName,
          mobile: contactMobile,
          phone: contactPhone,
          email: contactEmail,
          country_id: contactCountryId,
          cdate: currentDate,
          udate: currentDate
        };
        
        // For new leads, add newlead_id; for legacy leads, don't add it
        if (!isLegacyParent) {
          contactInsertData.newlead_id = insertedLeadId;
        }
        
        const { error: contactError } = await supabase
          .from('leads_contact')
          .insert([contactInsertData]);
        
        if (contactError) {
          console.error('Error creating contact:', contactError);
          // Continue even if contact creation fails
        } else {
          // Get the next available relationship ID
          const { data: maxRelationshipId } = await supabase
            .from('lead_leadcontact')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .single();
          
          const newRelationshipId = maxRelationshipId ? maxRelationshipId.id + 1 : 1;
          
          // Create the relationship, marking it as main
          const relationshipData: Record<string, any> = {
            id: newRelationshipId,
            contact_id: newContactId,
            main: true
          };
          
          // For new leads, use newlead_id; for legacy leads, use lead_id
          if (isLegacyParent) {
            relationshipData.lead_id = insertedLeadId;
          } else {
            relationshipData.newlead_id = insertedLeadId;
          }
          
          const { error: relationshipError } = await supabase
            .from('lead_leadcontact')
            .insert([relationshipData]);
          
          if (relationshipError) {
            console.error('Error creating contact relationship:', relationshipError);
            // Continue even if relationship creation fails
          }
          
          // For 'sameContract' step, we don't copy or modify the contract
          // The contract remains linked to the original lead/client
          // The UI should display contracts from the master lead when viewing sub-leads
          if (subLeadStep === 'sameContract' && selectedContractId) {
            console.log('🔍 Sub-lead created with same contract. Contract remains with original lead:', selectedContractId);
          }
        }
      }
      
      await fetchSubLeads(masterBaseNumber);
      toast.success(`Sub-lead created: ${subLeadNumber}`);
      setShowSubLeadDrawer(false);
      setSubLeadStep('initial');
      setSelectedContractContactId(null);
      setSelectedContractId(null);
      setSubLeadForm({
        name: '',
        email: '',
        phone: '',
        mobile: '',
        country: '',
        countryId: '',
        category: '',
        categoryId: '',
        topic: '',
        special_notes: '',
        source: '',
        language: '',
        tags: '',
        facts: '',
        handler: '',
        handlerId: '',
        currency: 'NIS',
        numApplicants: '',
        proposal: '',
        potentialValue: '',
      });
      
      // Navigate to the newly created sub-lead's page
      // For legacy leads, use the inserted ID (which is the lead number), for new leads use manual_id
      const routeManualId = isLegacyParent && insertedLead?.id 
        ? String(insertedLead.id) 
        : manualIdString;
      navigate(buildClientRoute(routeManualId, subLeadNumber));
    } catch (error: any) {
      console.error('Error creating sub-lead:', error);
      console.error('Error details:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        error: error
      });
      
      // Get a more detailed error message
      let errorMessage = 'Failed to create sub-lead.';
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.details) {
        errorMessage = error.details;
      } else if (error?.hint) {
        errorMessage = error.hint;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      toast.error(errorMessage);
    } finally {
      setIsSavingSubLead(false);
    }
  };

  // Function to copy a duplicate contact to the current lead
  const handleCopyDuplicateContact = async (duplicateContact: typeof duplicateContacts[0]) => {
    if (!selectedClient?.id) {
      toast.error('No lead selected');
      return;
    }

    setCopyingContactId(duplicateContact.contactId);
    
    try {
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      const currentLeadId = isLegacyLead 
        ? (typeof selectedClient.id === 'string' ? selectedClient.id.replace('legacy_', '') : String(selectedClient.id))
        : selectedClient.id;

      // Get the next available contact ID
      const { data: maxContactId } = await supabase
        .from('leads_contact')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .single();

      const newContactId = maxContactId ? maxContactId.id + 1 : 1;
      const currentDate = new Date().toISOString().split('T')[0];

      // Create the contact
      const contactInsertData: any = {
        id: newContactId,
        name: duplicateContact.contactName || '',
        mobile: duplicateContact.contactMobile || null,
        phone: duplicateContact.contactPhone || null,
        email: duplicateContact.contactEmail || null,
        cdate: currentDate,
        udate: currentDate
      };

      // For new leads, add newlead_id
      if (!isLegacyLead) {
        contactInsertData.newlead_id = currentLeadId;
      }

      const { error: contactError } = await supabase
        .from('leads_contact')
        .insert([contactInsertData]);

      if (contactError) {
        console.error('Error creating contact:', contactError);
        toast.error('Failed to create contact');
        return;
      }

      // Get the next available relationship ID
      const { data: maxRelationshipId } = await supabase
        .from('lead_leadcontact')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .single();

      const newRelationshipId = maxRelationshipId ? maxRelationshipId.id + 1 : 1;

      // Create the relationship
      const relationshipInsertData: any = {
        id: newRelationshipId,
        contact_id: newContactId,
        main: 'false'
      };

      if (isLegacyLead) {
        relationshipInsertData.lead_id = currentLeadId;
      } else {
        relationshipInsertData.newlead_id = currentLeadId;
      }

      const { error: relationshipError } = await supabase
        .from('lead_leadcontact')
        .insert([relationshipInsertData]);

      if (relationshipError) {
        console.error('Error creating contact relationship:', relationshipError);
        toast.error('Failed to link contact to lead');
        return;
      }

      toast.success(`Contact "${duplicateContact.contactName}" copied successfully`);
      
      // Refresh client data to show the new contact
      if (refreshClientData) {
        await refreshClientData(selectedClient.id);
      }
    } catch (error: any) {
      console.error('Error copying contact:', error);
      toast.error(error?.message || 'Failed to copy contact');
    } finally {
      setCopyingContactId(null);
    }
  };

  // ===== TOP PRIORITY: Check unactivation status FIRST, before any other logic =====
  // This must be checked immediately to prevent flickering and ensure badge is always shown
  const isLegacyForView = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
  const statusValue = selectedClient ? (selectedClient as any).status : null;
  // Only show unactivated box for new leads (not legacy leads)
  const isUnactivated = selectedClient && statusValue !== null && statusValue !== undefined && !isLegacyForView
    ? (statusValue === 'inactive')
    : false;
  
  // Debug logging - only log when values actually change
  useEffect(() => {
    console.log('🔍 RENDER TOP PRIORITY: Checking unactivation status', {
      selectedClientId: selectedClient?.id,
      isLegacyForView,
      statusValue,
      isUnactivated,
      userManuallyExpanded,
      hasSelectedClient: !!selectedClient
    });
  }, [selectedClient?.id, isLegacyForView, statusValue, isUnactivated, userManuallyExpanded, selectedClient]);
  
  // Show unactivated view if lead is unactivated and user hasn't clicked to expand
  // This takes priority over loading state to prevent flickering
  if (selectedClient && isUnactivated && !userManuallyExpanded) {
    console.log('🔍 RENDERING UNACTIVATED VIEW (TOP PRIORITY) for client:', selectedClient.id);
    return (
      <div className="min-h-screen p-4">
        <div className="max-w-2xl mx-auto">
          {/* Unactivated Lead Compact Card */}
          <div 
            className="bg-base-100 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 cursor-pointer transform hover:scale-105 border border-base-300 overflow-hidden"
            onClick={() => {
              console.log('🔍 Clicking unactivated view to expand');
              console.log('🔍 Current isUnactivatedView before setting:', isUnactivatedView);
              setUserManuallyExpanded(true);
              setIsUnactivatedView(false);
              console.log('🔍 Set isUnactivatedView to false and userManuallyExpanded to true');
            }}
          >
            {/* Header with Unactivated Badge */}
            <div className="bg-gradient-to-r from-red-500 to-red-600 p-4 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                    <UserIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{selectedClient.name}</h2>
                    <p className="text-red-100 text-sm">Lead #{selectedClient.lead_number}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Stage Badge */}
                  {(() => {
                    const stageStr = (selectedClient.stage !== null && selectedClient.stage !== undefined) ? String(selectedClient.stage) : '';
                    const stageName = getStageName(stageStr);
                    const stageColor = getStageColour(stageStr);
                    const textColor = getContrastingTextColor(stageColor);
                    const backgroundColor = stageColor || '#3b28c7';
                    
                    return (
                      <span 
                        className="badge text-xs px-2 py-1 shadow-lg"
                        style={{
                          backgroundColor: backgroundColor,
                          color: textColor,
                          borderColor: backgroundColor,
                        }}
                      >
                        {stageName}
                      </span>
                    );
                  })()}
                  {/* Meeting Scheduled Badge */}
                  {hasScheduledMeetings && nextMeetingDate && (
                    <button
                      onClick={() => setActiveTab('meeting')}
                      className="shadow-lg cursor-pointer animate-pulse font-semibold rounded-full"
                      style={{
                        background: 'linear-gradient(to bottom right, #10b981, #14b8a6)',
                        color: 'white',
                        borderColor: '#10b981',
                        padding: '0.5rem 1rem',
                        minHeight: '3.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.875rem',
                        lineHeight: '1.25rem',
                      }}
                    >
                      <span className="flex flex-col items-center gap-0.5">
                        <span className="font-semibold">Meeting Scheduled</span>
                        <span className="text-xs font-medium opacity-90">
                          {(() => {
                            const date = new Date(nextMeetingDate);
                            return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                          })()}
                        </span>
                      </span>
                    </button>
                  )}
                  <div className="bg-red-700 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide shadow-lg">
                    Unactivated
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Two Row Grid Layout */}
              <div className="grid grid-cols-2 gap-4">
                {/* Row 1 */}
                <div className="space-y-3">
                  {/* Topic */}
                  {selectedClient.topic && (
                    <div className="flex items-center gap-2">
                      <DocumentTextIcon className="w-4 h-4 text-base-content/60" />
                      <span className="text-sm text-base-content/80 font-medium">{selectedClient.topic}</span>
                    </div>
                  )}

                  {/* Email */}
                  <div className="flex items-center gap-2">
                    <EnvelopeIcon className="w-4 h-4 text-base-content/60" />
                    <span className="text-sm text-base-content/80">{selectedClient.email || 'No email'}</span>
                  </div>

                  {/* Category */}
                  <div className="flex items-center gap-2">
                    <TagIcon className="w-4 h-4 text-base-content/60" />
                    <span className="text-sm text-base-content/80">{selectedClient.category || 'Not specified'}</span>
                  </div>
                </div>

                {/* Row 2 */}
                <div className="space-y-3">
                  {/* Scheduler */}
                  {selectedClient.scheduler && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-base-content/60" />
                      <span className="text-sm text-base-content/80">Scheduler: {selectedClient.scheduler}</span>
                    </div>
                  )}

                  {/* Handler */}
                  {selectedClient.handler && selectedClient.handler !== 'Not assigned' && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-base-content/60" />
                      <span className="text-sm text-base-content/80">Handler: {selectedClient.handler}</span>
                    </div>
                  )}

                  {/* Closer */}
                  {selectedClient.closer && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-base-content/60" />
                      <span className="text-sm text-base-content/80">Closer: {selectedClient.closer}</span>
                    </div>
                  )}

                  {/* Phone */}
                  <div className="flex items-center gap-2">
                    <PhoneIcon className="w-4 h-4 text-base-content/60" />
                    <span className="text-sm text-base-content/80">{selectedClient.phone || 'No phone'}</span>
                  </div>

                  {/* Created Date */}
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-base-content/60" />
                    <span className="text-sm text-base-content/70">
                      Created: {selectedClient.created_at ? new Date(selectedClient.created_at).toLocaleDateString() : 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Value (Balance) Badge */}
              {(() => {
                const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                const balanceValue = isLegacy 
                  ? (selectedClient as any).total || selectedClient.balance
                  : selectedClient.balance || (selectedClient as any).proposal_total;
                
                // Get currency symbol - for legacy leads, use balance_currency or get from currency_id
                let balanceCurrency = selectedClient.balance_currency;
                if (!balanceCurrency && isLegacy) {
                  const currencyId = (selectedClient as any).currency_id;
                  if (currencyId) {
                    balanceCurrency = getCurrencySymbol(currencyId, '₪');
                  } else {
                    balanceCurrency = '₪';
                  }
                } else if (!balanceCurrency) {
                  balanceCurrency = '₪';
                }
                
                if (balanceValue && (Number(balanceValue) > 0 || balanceValue !== '0')) {
                  const formattedValue = typeof balanceValue === 'number' 
                    ? balanceValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                    : Number(balanceValue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                  
                  return (
                    <div className="flex items-center justify-center pt-2">
                      <span className="badge badge-lg px-4 py-2 bg-green-100 text-green-800 border border-green-300 font-semibold">
                        Value: {balanceCurrency}{formattedValue}
                      </span>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Unactivation Details - Only for new leads (not legacy) */}
              {(() => {
                const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                // Only show unactivated box for new leads (not legacy leads)
                const isUnactivated = !isLegacy && (selectedClient.status === 'inactive');
                return isUnactivated;
              })() && (
                <div className="pt-3 border-t border-base-300 space-y-2">
                  <div className="flex items-center gap-2">
                    <NoSymbolIcon className="w-4 h-4 text-error" />
                    <span className="text-sm text-error font-medium">
                      {(() => {
                        const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                        // For legacy leads, use unactivation_reason (not deactivate_note which doesn't exist in leads_lead table)
                        let unactivationReason = selectedClient.unactivation_reason;
                        
                        // For legacy leads, if no unactivation_reason, try to get it from reason_id
                        if (isLegacy && !unactivationReason) {
                          const reasonId = (selectedClient as any).reason_id;
                          if (reasonId) {
                            const reasonFromId = getUnactivationReasonFromId(reasonId);
                            if (reasonFromId) {
                              unactivationReason = reasonFromId;
                            }
                          }
                        }
                        
                        // Return the reason exactly as stored in the database or from reason_id mapping
                        return unactivationReason ? (
                          `Reason: ${unactivationReason}`
                        ) : (
                          'No reason added'
                        );
                      })()}
                    </span>
                  </div>
                  {selectedClient.unactivated_by && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-base-content/60" />
                      <span className="text-sm text-base-content/80">
                        Unactivated by: {selectedClient.unactivated_by}
                      </span>
                    </div>
                  )}
                  {selectedClient.unactivated_at && (
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-base-content/60" />
                      <span className="text-sm text-base-content/80">
                        Unactivated: {new Date(selectedClient.unactivated_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Click to Expand Hint */}
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <InformationCircleIcon className="w-4 h-4 text-base-content/70" />
                  <span className="text-sm text-base-content font-medium">Click to view full details</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Show loading state while determining view (only if not unactivated)
  if (localLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-base-100">
      {/* Sticky Header - appears when scrolled down, positioned below main header */}
      {showStickyHeader && selectedClient && (
        <div className="fixed top-16 left-0 md:left-[100px] right-0 z-[45] bg-base-100 shadow-lg border-b border-base-300 transition-all duration-300 ease-in-out">
          <div className="max-w-7xl mx-auto px-4 py-3">
            {/* Mobile View - Only lead number and client name */}
            <div className="md:hidden flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-base font-bold text-base-content whitespace-nowrap">
                  #{selectedClient.lead_number || selectedClient.id}
                </span>
                <span className="text-base font-semibold text-base-content/90 truncate">
                  {selectedClient.name || 'Unnamed Lead'}
                </span>
              </div>
            </div>

            {/* Desktop View - Full layout with tab navigation */}
            <div className="hidden md:flex items-center justify-between gap-4 flex-wrap">
              {/* Left side: Tab navigation arrows, tab name badge, lead number, name, and next follow-up */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Tab Navigation Buttons and Tab Name - Desktop Only - On the left */}
                <div className="hidden md:flex items-center gap-2">
                  <button
                    onClick={() => {
                      const currentIndex = tabs.findIndex(tab => tab.id === activeTab);
                      if (currentIndex > 0) {
                        setActiveTab(tabs[currentIndex - 1].id);
                      } else {
                        setActiveTab(tabs[tabs.length - 1].id); // Wrap to last tab
                      }
                    }}
                    className="p-2 rounded-lg hover:bg-base-200 transition-colors"
                    title="Previous tab"
                    aria-label="Previous tab"
                  >
                    <ChevronLeftIcon className="w-6 h-6" style={{ color: '#4218CC' }} />
                  </button>
                  {/* Current Tab Name Badge */}
                  {(() => {
                    const currentTab = tabs.find(tab => tab.id === activeTab);
                    return currentTab ? (
                      <span className="badge text-sm px-3 py-1.5 font-semibold shadow-sm whitespace-nowrap" style={{ backgroundColor: '#4218CC', color: '#ffffff', borderColor: '#4218CC' }}>
                        {currentTab.label}
                      </span>
                    ) : null;
                  })()}
                  <button
                    onClick={() => {
                      const currentIndex = tabs.findIndex(tab => tab.id === activeTab);
                      if (currentIndex < tabs.length - 1) {
                        setActiveTab(tabs[currentIndex + 1].id);
                      } else {
                        setActiveTab(tabs[0].id); // Wrap to first tab
                      }
                    }}
                    className="p-2 rounded-lg hover:bg-base-200 transition-colors"
                    title="Next tab"
                    aria-label="Next tab"
                  >
                    <ChevronRightIcon className="w-6 h-6" style={{ color: '#4218CC' }} />
                  </button>
                </div>
                <div className="flex items-center gap-3 min-w-0 flex-wrap">
                  <span className="text-lg font-bold text-base-content whitespace-nowrap">
                    #{selectedClient.lead_number || selectedClient.id}
                  </span>
                  <span className="text-lg font-semibold text-base-content/90 truncate">
                    {selectedClient.name || 'Unnamed Lead'}
                  </span>
                  {selectedClient.next_followup && (
                    <div className="flex items-center gap-1.5 text-sm text-base-content/80 whitespace-nowrap">
                      <CalendarDaysIcon className="w-4 h-4 flex-shrink-0" />
                      <span className="font-medium">
                        {new Date(selectedClient.next_followup).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right side: Stage badge and topic */}
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Stage Badge */}
                {(() => {
                  const stageStr = (selectedClient.stage !== null && selectedClient.stage !== undefined) ? String(selectedClient.stage) : '';
                  const stageName = getStageName(stageStr);
                  const stageColor = getStageColour(stageStr);
                  const textColor = getContrastingTextColor(stageColor);
                  const backgroundColor = stageColor || '#3b28c7';
                  
                  return (
                    <span 
                      className="badge text-sm px-4 py-2 font-bold shadow-sm whitespace-nowrap"
                      style={{
                        backgroundColor: backgroundColor,
                        color: textColor,
                        borderColor: backgroundColor,
                      }}
                    >
                      {stageName}
                    </span>
                  );
                })()}
                
                {/* Topic/Category - same size as stage badge */}
                {selectedClient.category && (
                  <span 
                    className="badge text-sm px-4 py-2 font-bold shadow-sm bg-base-200 text-base-content/90 border-base-300 whitespace-nowrap flex items-center gap-2"
                  >
                    <TagIcon className="w-4 h-4 flex-shrink-0" />
                    <span className="hidden sm:inline">{selectedClient.category}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Background loading indicator */}
      {backgroundLoading && (
        <div className="fixed top-4 right-4 z-40 bg-info/20 text-info-content px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm">
          <div className="loading loading-spinner loading-xs"></div>
          Loading additional data...
        </div>
      )}
      {/* Mobile view - aligned with desktop layout */}
      <div className="md:hidden px-4 pt-4 pb-3">
        <div className="flex flex-col gap-4">
          {/* Sub-lead notice for mobile */}
          {isSubLead && masterLeadNumber && (
            <div className="text-sm text-gray-500 mb-2">
              This is a Sub-Lead of Master Lead: <a href={`/clients/${masterLeadNumber}/master`} className="underline text-blue-700 hover:text-blue-900">{masterLeadNumber}</a>
            </div>
          )}
          
          {/* Master lead notice for mobile */}
          {isMasterLead && subLeads.length > 0 && !(selectedClient?.master_id && String(selectedClient.master_id).trim() !== '') && (
            <div className="text-sm text-gray-500 mb-2">
              This is a master lead with {subLeads.length} sub-lead{subLeads.length !== 1 ? 's' : ''}. 
              <a 
                href={`/clients/${(() => {
                  // Get the base lead number without any suffix like /2
                  const leadNumber = selectedClient.lead_number || selectedClient.id || '';
                  return leadNumber.toString().split('/')[0];
                })()}/master`} 
                className="underline text-blue-700 hover:text-blue-900 ml-1"
              >
                View all sub-leads
              </a>
            </div>
          )}
          
          {/* Amount badge + stage badge + applicants - Moved to top for mobile */}
          <div className="w-full flex flex-col items-center mb-4">
            {/* Mobile Badges - Meeting, Lead is Cold, Duplicate Contact - Above balance badge */}
            <div className="md:hidden w-full flex flex-col gap-2 mb-3 px-2">
              {/* Meeting Scheduled Badge */}
              {hasScheduledMeetings && nextMeetingDate && (
                <button
                  onClick={() => setActiveTab('meeting')}
                  className="w-full rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg px-4 py-2 text-sm font-bold flex items-center justify-center gap-2 border-2 border-white/20 hover:from-green-600 hover:to-emerald-600 transition-all cursor-pointer animate-pulse"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Meeting Scheduled: {(() => {
                    const date = new Date(nextMeetingDate);
                    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  })()}
                </button>
              )}
              
              {/* Duplicate Contact Badge */}
              {duplicateContacts.length > 0 && (
                <button
                  onClick={() => setIsDuplicateModalOpen(true)}
                  className="w-full rounded-xl bg-gradient-to-tr from-orange-500 via-red-500 to-pink-600 text-white shadow-lg px-4 py-2 text-sm font-bold flex items-center justify-center gap-2 border-2 border-white/20 hover:from-orange-600 hover:via-red-600 hover:to-pink-700 transition-all cursor-pointer"
                >
                  <DocumentDuplicateIcon className="w-4 h-4" />
                  {duplicateContacts.length === 1 
                    ? `Duplicate Contact: ${duplicateContacts[0].contactName} in Lead ${duplicateContacts[0].leadNumber}`
                    : `${duplicateContacts.length} Duplicate Contacts`
                  }
                </button>
              )}
            </div>
            
            {/* Next Payment Due Indicator */}
            {nextDuePayment && (
              <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-xl shadow-lg px-4 py-2 mb-2 w-full max-w-xs">
                <div className="text-center">
                  <div className="text-white text-xs font-semibold mb-1">Next Payment Due</div>
                  <div className="text-white text-sm font-bold">
                    {(() => {
                      const dueDate = new Date(nextDuePayment.due_date);
                      const today = new Date();
                      const diffTime = dueDate.getTime() - today.getTime();
                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                      
                      let dateText = dueDate.toLocaleDateString('en-GB');
                      if (diffDays === 0) {
                        dateText = 'Today';
                      } else if (diffDays === 1) {
                        dateText = 'Tomorrow';
                      } else if (diffDays < 0) {
                        dateText = `${Math.abs(diffDays)} days overdue`;
                      }
                      
                      const currency = nextDuePayment.isLegacy 
                        ? (nextDuePayment.accounting_currencies?.iso_code === 'ILS' ? '₪' : nextDuePayment.accounting_currencies?.iso_code || '₪')
                        : (nextDuePayment.currency || '₪');
                      
                      const amount = nextDuePayment.isLegacy 
                        ? (Number(nextDuePayment.value) + Number(nextDuePayment.vat_value || 0))
                        : (Number(nextDuePayment.value) + Number(nextDuePayment.value_vat || 0));
                      
                      return `${currency}${Number(amount.toFixed(2)).toLocaleString()} - ${dateText}`;
                    })()}
                  </div>
                </div>
              </div>
            )}
            
            {/* Balance and Stage badges in one line on mobile */}
            <div className="flex items-center gap-2 mb-3 w-full">
            <div 
                className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl shadow-lg px-3 py-2 flex-1 cursor-pointer hover:from-purple-700 hover:to-blue-700 transition-all duration-200"
              onClick={() => setIsBalanceModalOpen(true)}
              title="Click to edit balance"
            >
              <div className="text-center">
                <div className="text-white text-base font-bold whitespace-nowrap truncate">
                  {(() => {
                    // For new leads, use balance column. For legacy, use total
                    const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
                    const baseAmount = isLegacyLead 
                      ? Number(selectedClient?.total || selectedClient?.balance || 0)
                      : Number(selectedClient?.balance || selectedClient?.proposal_total || 0);
                    const subcontractorFee = Number(selectedClient?.subcontractor_fee ?? 0);
                    const mainAmount = baseAmount - subcontractorFee;
                    
                    // Get currency symbol - prioritize computed values from refreshClientData
                    // These are set by App.tsx refreshClientData and are fresh
                    let currency = selectedClient?.proposal_currency ?? selectedClient?.balance_currency ?? '₪';
                    
                    // If no computed currency, try to get from currency_id directly
                    if ((!currency || currency === '₪') && selectedClient?.currency_id && !isLegacyLead) {
                      // For new leads without computed currency, use currency_id mapping
                      // This is a fallback - normally App.tsx should set proposal_currency/balance_currency
                      const currencyId = Number(selectedClient.currency_id);
                      switch (currencyId) {
                        case 1: currency = '₪'; break; // ILS
                        case 2: currency = '€'; break; // EUR  
                        case 3: currency = '$'; break; // USD
                        case 4: currency = '£'; break; // GBP
                        default: currency = '₪';
                      }
                    }
                    
                    console.log('💰 Balance badge rendering - currency_id:', selectedClient?.currency_id, 'proposal_currency:', selectedClient?.proposal_currency, 'balance_currency:', selectedClient?.balance_currency, 'final currency:', currency);
                    
                    // Calculate VAT - only show if vat column is 'true' for new leads
                    let vatAmount = 0;
                    let shouldShowVAT = false;
                    
                    if (isLegacyLead) {
                      // Legacy leads: check 'vat' column (text type, same as new leads)
                      // 'false', '0', 'no' → VAT excluded (don't show VAT)
                      // 'true', '1', 'yes', NULL, undefined → VAT included (show VAT)
                      const vatValue = (selectedClient as any)?.vat;
                      shouldShowVAT = true; // Default to showing VAT (included)
                      
                      if (vatValue !== null && vatValue !== undefined) {
                        const vatStr = String(vatValue).toLowerCase().trim();
                        // If VAT is excluded, don't show VAT in badge
                        if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') {
                          shouldShowVAT = false;
                        }
                      }
                      
                      // Only calculate VAT if we should show it
                      if (shouldShowVAT) {
                        const totalAmount = Number(selectedClient?.total || selectedClient?.balance || 0);
                        vatAmount = totalAmount * 0.18;
                      }
                    } else {
                      // New leads: check 'vat' column (text type)
                      // 'false', '0', 'no' → VAT excluded (don't show VAT)
                      // 'true', '1', 'yes', NULL, undefined → VAT included (show VAT)
                      const vatValue = selectedClient?.vat;
                      shouldShowVAT = true; // Default to showing VAT (included)
                      
                      if (vatValue !== null && vatValue !== undefined) {
                        const vatStr = String(vatValue).toLowerCase().trim();
                        // If VAT is excluded, don't show VAT in badge
                        if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') {
                          shouldShowVAT = false;
                        }
                      }
                      
                      // Only calculate VAT if we should show it
                      if (shouldShowVAT) {
                        // Use vat_value from database if available, otherwise calculate for all currencies
                        if (selectedClient?.vat_value && Number(selectedClient.vat_value) > 0) {
                          vatAmount = Number(selectedClient.vat_value);
                        } else {
                          const totalAmount = Number(selectedClient?.balance || selectedClient?.proposal_total || 0);
                          vatAmount = totalAmount * 0.18; // Calculate VAT for all currencies
                        }
                      }
                    }
                    
                    return (
                      <span>
                        {currency}{Number(mainAmount.toFixed(2)).toLocaleString()}
                        {shouldShowVAT && vatAmount > 0 && (
                          <span className="text-white text-base opacity-90 font-normal ml-2">
                            +{Number(vatAmount.toFixed(2)).toLocaleString()} VAT
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </div>
                {/* Always show Total */}
                <div className="text-white text-xs opacity-90 mt-1">
                  Total: {(() => {
                    const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
                    // Get currency symbol - prioritize computed values from refreshClientData
                    let currency = selectedClient?.proposal_currency ?? selectedClient?.balance_currency ?? '₪';
                    
                    // If no computed currency, try to get from currency_id directly
                    if ((!currency || currency === '₪') && selectedClient?.currency_id && !isLegacyLead) {
                      const currencyId = Number(selectedClient.currency_id);
                      switch (currencyId) {
                        case 1: currency = '₪'; break; // ILS
                        case 2: currency = '€'; break; // EUR  
                        case 3: currency = '$'; break; // USD
                        case 4: currency = '£'; break; // GBP
                        default: currency = '₪';
                      }
                    }
                    
                    const baseAmount = isLegacyLead
                      ? Number(selectedClient?.total || selectedClient?.balance || 0)
                      : Number(selectedClient?.balance || selectedClient?.proposal_total || 0);
                    return `${currency}${Number(baseAmount.toFixed(2)).toLocaleString()}`;
                  })()}
                </div>
                {/* Always show Potential Value */}
                <div className="text-white text-xs opacity-90 mt-1.5 pt-1.5 border-t border-white/20">
                  <div className="font-medium">Potential Value:</div>
                  <div className="text-white">
                    {(() => {
                      // Check both potential_total and potential_value for both types
                      const potentialValue = (selectedClient as any)?.potential_total || (selectedClient as any)?.potential_value || null;
                      
                      if (potentialValue !== null && potentialValue !== undefined) {
                        const numValue = typeof potentialValue === 'string' ? parseFloat(potentialValue) : Number(potentialValue);
                        if (!isNaN(numValue) && numValue > 0) {
                            // Get currency symbol - prioritize computed values from refreshClientData
                          let currency = selectedClient?.proposal_currency ?? selectedClient?.balance_currency ?? '₪';
                          
                          // If no computed currency, try to get from currency_id directly
                          if ((!currency || currency === '₪') && selectedClient?.currency_id) {
                            const currencyId = Number(selectedClient.currency_id);
                            switch (currencyId) {
                              case 1: currency = '₪'; break; // ILS
                              case 2: currency = '€'; break; // EUR  
                              case 3: currency = '$'; break; // USD
                              case 4: currency = '£'; break; // GBP
                              default: currency = '₪';
                            }
                          }
                          const formattedValue = typeof potentialValue === 'string' 
                            ? potentialValue 
                            : numValue.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                          return (
                            <span className="text-white">
                              {currency}{formattedValue}
                            </span>
                          );
                        }
                      }
                      return <span className="text-white opacity-60">Not set</span>;
                    })()}
                  </div>
                </div>
              </div>
            </div>

              {/* Stage Badge - Same line - Hidden on mobile, shown on desktop */}
              <div className="hidden md:flex flex-col gap-1.5 flex-shrink-0">
            {selectedClient?.stage !== null &&
              selectedClient?.stage !== undefined &&
              selectedClient?.stage !== '' && (
                    <>
                  {getStageBadge(selectedClient.stage, 'badge')}
                      {/* Meeting Scheduled badge directly under stage */}
                  {hasScheduledMeetings && nextMeetingDate && (
                    <button
                      onClick={() => setActiveTab('meeting')}
                          className="badge badge-sm px-3 py-1.5 shadow-md cursor-pointer animate-pulse font-semibold whitespace-nowrap"
                      style={{
                        background: 'linear-gradient(to bottom right, #10b981, #14b8a6)',
                        color: 'white',
                        borderColor: '#10b981',
                            fontSize: '0.7rem',
                            minHeight: '1.5rem',
                          }}
                        >
                          Meeting: {(() => {
                            const date = new Date(nextMeetingDate);
                            return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                          })()}
                    </button>
                  )}
                    </>
                  )}
              </div>
            </div>

            {/* Action Buttons - Below badges */}
            {selectedClient?.stage !== null &&
              selectedClient?.stage !== undefined &&
              selectedClient?.stage !== '' && (
                <div className="flex justify-center items-center gap-2 mb-2 flex-wrap">
                  {areStagesEquivalent(currentStageName, 'Handler Set') && (
                    <button
                      type="button"
                      onClick={handleStartCase}
                      className="flex items-center gap-2 px-3 py-2 rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-semibold shadow-lg animate-pulse hover:animate-none transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 text-sm"
                    >
                      <PlayIcon className="w-5 h-5" />
                      Start Case
                    </button>
                  )}
                  {areStagesEquivalent(currentStageName, 'Handler Started') && (
                    <>
                      <button
                        type="button"
                        onClick={() => updateLeadStage('Application submitted')}
                        className="flex items-center gap-2 px-3 py-2 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold shadow-lg animate-pulse hover:animate-none transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 text-sm"
                      >
                        <DocumentCheckIcon className="w-6 h-6" />
                        Application submitted
                      </button>
                      <button
                        type="button"
                        onClick={() => updateLeadStage('Case Closed')}
                        className="flex items-center gap-2 px-3 py-2 rounded-full bg-gradient-to-r from-gray-500 to-slate-500 text-white font-semibold shadow-lg animate-pulse hover:animate-none transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 text-sm"
                      >
                        <CheckCircleIcon className="w-6 h-6" />
                        Case closed
                      </button>
                    </>
                  )}
                  {areStagesEquivalent(currentStageName, 'Application submitted') && (
                    <button
                      type="button"
                      onClick={() => updateLeadStage('Case Closed')}
                      className="flex items-center gap-2 px-3 py-2 rounded-full bg-gradient-to-r from-gray-500 to-slate-500 text-white font-semibold shadow-lg animate-pulse hover:animate-none transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 text-sm"
                    >
                      <CheckCircleIcon className="w-6 h-6" />
                      Case closed
                    </button>
                  )}
                </div>
              )}

          </div>

          {/* Client Header - Lead number with language badge below, name aligned with lead number */}
          <div className="flex items-center gap-3 mb-3 px-1">
            <div className="hidden md:flex w-10 h-10 rounded-full items-center justify-center flex-shrink-0" style={{ backgroundColor: '#391BC8' }}>
              <UserIcon className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-base-content whitespace-nowrap">
                  {selectedClient ? getDisplayLeadNumber(selectedClient) : '---'}
                </span>
                <span className="text-lg font-bold text-base-content">-</span>
                <span className="text-xl font-bold text-base-content/90 truncate">
                  {selectedClient ? (selectedClient.name || '---') : '---'}
                </span>
              </div>
              
              {/* Category and Topic - plain text */}
              <div className="flex items-center gap-2 flex-wrap text-sm text-base-content/70">
                {selectedClient?.category && (
                  <span className="font-medium">
                    {selectedClient.category}
                  </span>
                )}
                {selectedClient?.category && selectedClient?.topic && (
                  <span>•</span>
                )}
                {selectedClient?.topic && (
                  <span className="font-medium">
                    {selectedClient.topic}
                  </span>
                )}
              </div>
              
              {/* Language and Applicant badges */}
              <div className="flex items-center gap-2 flex-wrap">
              {selectedClient?.language && (
                <span className="px-3 py-1 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600 rounded-full flex-shrink-0 w-fit">
                  {selectedClient.language}
                </span>
              )}
              {/* Stage Badge - Mobile only, next to language badge */}
              {selectedClient?.stage !== null &&
                selectedClient?.stage !== undefined &&
                selectedClient?.stage !== '' && (
                  <div className="md:hidden">
                    {getStageBadge(selectedClient.stage, 'mobile')}
                  </div>
                )}
                {(() => {
                  const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                  const applicantsCount = isLegacyLead ? selectedClient?.no_of_applicants : selectedClient?.number_of_applicants_meeting;
                  return applicantsCount && applicantsCount > 0 ? (
                    <span className="badge badge-lg bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold border-0 shadow-md px-4 py-3">
                      {applicantsCount}
                    </span>
                  ) : null;
                })()}
              </div>
            </div>
          </div>

          {/* Client info and Progress boxes - Horizontally scrollable on mobile - HIDDEN ON MOBILE: Accessed via menu button */}
          <div className="hidden lg:flex flex-row gap-3 w-full -mx-4 px-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory md:overflow-x-visible">
            {/* Client Information Box */}
            <div className="min-w-[calc(100%-1rem)] md:flex-1 md:min-w-0 snap-start bg-base-100 rounded-2xl shadow-md border border-base-300 overflow-hidden hover:shadow-lg transition-shadow duration-200">
              <div className="h-full flex flex-col">
                {/* Header with collapse button */}
                <div className="flex items-center justify-between gap-3 mb-4 md:hidden p-3.5 pb-0">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-base font-semibold text-base-content">Client Information</span>
                  </div>
                  <button
                    onClick={() => {
                      const next = !(isClientInfoCollapsed && isProgressCollapsed);
                      setIsClientInfoCollapsed(next);
                      setIsProgressCollapsed(next);
                    }}
                    className="btn btn-ghost btn-sm btn-circle p-0 w-8 h-8 min-h-0"
                    aria-label={isClientInfoCollapsed ? "Expand" : "Collapse"}
                  >
                    {isClientInfoCollapsed ? (
                      <ChevronRightIcon className="w-5 h-5 text-base-content/80" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-base-content/80" />
                    )}
                  </button>
                </div>
                {/* Collapsible content */}
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isClientInfoCollapsed ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'} md:max-h-none md:opacity-100`}>
                  <div className="p-3.5 pt-0 md:pt-3.5">
                    <div className="hide-client-header-mobile">
                      <ClientInformationBox 
                        selectedClient={selectedClient} 
                        getEmployeeDisplayName={getEmployeeDisplayName}
                        onClientUpdate={async () => await refreshClientData(selectedClient?.id)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Progress & Follow-up Box */}
            <div className="min-w-[calc(100%-1rem)] md:flex-1 md:min-w-0 snap-start bg-base-100 rounded-2xl shadow-md border border-base-300 overflow-visible hover:shadow-lg transition-shadow duration-200">
              <div className="h-full flex flex-col">
                {/* Header with collapse button - no icon on mobile */}
                <div className="flex items-center justify-between gap-3 mb-4 md:hidden p-3.5 pb-0">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-base font-semibold text-base-content">Progress & Follow-up</span>
                  </div>
                  <button
                    onClick={() => {
                      const next = !(isClientInfoCollapsed && isProgressCollapsed);
                      setIsClientInfoCollapsed(next);
                      setIsProgressCollapsed(next);
                    }}
                    className="btn btn-ghost btn-sm btn-circle p-0 w-8 h-8 min-h-0"
                    aria-label={isProgressCollapsed ? "Expand" : "Collapse"}
                  >
                    {isProgressCollapsed ? (
                      <ChevronRightIcon className="w-5 h-5 text-base-content/80" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-base-content/80" />
                    )}
                  </button>
                </div>
                {/* Collapsible content */}
                <div className={`overflow-visible transition-all duration-300 ease-in-out ${isProgressCollapsed ? 'max-h-0' : 'max-h-[2000px]'} md:max-h-none`}>
                  <div className="p-3.5 pt-0 md:pt-3.5" style={{ overflow: 'visible' }}>
                    <ProgressFollowupBox 
                      selectedClient={selectedClient} 
                      getEmployeeDisplayName={getEmployeeDisplayName}
                      dropdownsContent={
                        <>
                          {/* First row: Stages and Actions buttons - Desktop Only */}
                          <div className="hidden md:flex flex-row gap-3 w-full">
                            <div className="flex flex-col flex-1 gap-3">
                              <div className="dropdown relative" style={{ zIndex: 9999, overflow: 'visible' }}>
                                <label tabIndex={0} className="btn btn-lg bg-white border-2 hover:bg-purple-50 gap-2 text-base saira-regular w-full justify-between" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                                  <span>Stages</span>
                                  <ChevronDownIcon className="w-5 h-5" style={{ color: '#4218CC' }} />
                                </label>
                                {dropdownItems && (
                                  <ul tabIndex={0} className="dropdown-content z-[9999] menu p-2 bg-white dark:bg-base-100 rounded-xl w-56 shadow-2xl border border-base-300" style={{ zIndex: 9999 }}>
                                    {dropdownItems}
                                  </ul>
                                )}
                              </div>
                              
                              {/* Input fields under Stages button */}
                              {selectedClient && areStagesEquivalent(currentStageName, 'Success') && (
                                <div className="flex flex-col items-start gap-1">
                                  <label className="block text-sm font-semibold text-primary mb-1">Assign case handler</label>
                                  <div ref={successStageHandlerContainerRef} className="relative w-full">
                                    <input
                                      type="text"
                                      className="input input-bordered w-full"
                                      placeholder="Not assigned"
                                      value={successStageHandlerSearch}
                                      onChange={e => {
                                        console.log('📝 Input onChange:', e.target.value);
                                        setSuccessStageHandlerSearch(e.target.value);
                                        setShowSuccessStageHandlerDropdown(true);
                                        console.log('✅ Set dropdown to show');
                                      }}
                                      onFocus={() => {
                                        console.log('🎯 Input onFocus - showing dropdown');
                                        setShowSuccessStageHandlerDropdown(true);
                                        setFilteredSuccessStageHandlerOptions(handlerOptions);
                                      }}
                                      onBlur={() => {
                                        console.log('👋 Input onBlur');
                                      }}
                                      autoComplete="off"
                                      disabled={isUpdatingSuccessStageHandler}
                                    />
                                    {showSuccessStageHandlerDropdown && (() => {
                                      console.log('🎨 Rendering success handler dropdown with', filteredSuccessStageHandlerOptions.length, 'options');
                                      return (
                                      <div className="absolute z-[9999] mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-base-300 bg-base-100 shadow-2xl">
                                        <button
                                          type="button"
                                          className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                                          onClick={() => {
                                            console.log('🖱️ Clear handler clicked');
                                            setSuccessStageHandlerSearch('');
                                            setShowSuccessStageHandlerDropdown(false);
                                            setFilteredSuccessStageHandlerOptions(handlerOptions);
                                            void assignSuccessStageHandler(null);
                                          }}
                                          disabled={isUpdatingSuccessStageHandler}
                                        >
                                          ---------
                                        </button>
                                        {filteredSuccessStageHandlerOptions.length > 0 ? (
                                          filteredSuccessStageHandlerOptions.map(option => (
                                            <button
                                              type="button"
                                              key={option.id}
                                              className="w-full text-left px-4 py-2 text-sm hover:bg-primary/10"
                                              onClick={() => {
                                                console.log('🖱️ Dropdown option clicked:', option);
                                                setSuccessStageHandlerSearch(option.label);
                                                setShowSuccessStageHandlerDropdown(false);
                                                setFilteredSuccessStageHandlerOptions(handlerOptions);
                                                void assignSuccessStageHandler(option);
                                              }}
                                              disabled={isUpdatingSuccessStageHandler}
                                            >
                                              {option.label}
                                            </button>
                                          ))
                                        ) : (
                                          <div className="px-4 py-3 text-sm text-base-content/60">
                                            No handlers found
                                          </div>
                                        )}
                                      </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
                              
                              {selectedClient && areStagesEquivalent(currentStageName, 'created') && (
                                <div className="relative" data-assign-dropdown="true">
                                  <label className="block text-sm font-medium text-primary mb-1">Assign to</label>
                                  <input
                                    type="text"
                                    className="input input-bordered w-full"
                                    placeholder="---"
                                    value={schedulerSearchTerm}
                                    onChange={e => {
                                      setSchedulerSearchTerm(e.target.value);
                                      setShowSchedulerDropdown(true);
                                    }}
                                    onFocus={() => setShowSchedulerDropdown(true)}
                                  />
                                  {showSchedulerDropdown && (
                                    <div className="absolute z-[60] mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-base-300 bg-base-100 shadow-2xl">
                                      <button
                                        type="button"
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                                        onClick={() => {
                                          setSchedulerSearchTerm('');
                                          setShowSchedulerDropdown(false);
                                          updateScheduler('');
                                        }}
                                      >
                                        ---------
                                      </button>
                                      {filteredSchedulerOptions.length > 0 ? (
                                        filteredSchedulerOptions.map(option => (
                                          <button
                                            type="button"
                                            key={option}
                                            className="w-full text-left px-4 py-2 text-sm hover:bg-primary/10"
                                            onClick={() => {
                                              setSchedulerSearchTerm(option);
                                              setShowSchedulerDropdown(false);
                                              updateScheduler(option);
                                            }}
                                          >
                                            {option}
                                          </button>
                                        ))
                                      ) : (
                                        <div className="px-4 py-3 text-sm text-base-content/60">
                                          No matches found
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            
                            <div className="dropdown dropdown-end flex-1 relative" style={{ zIndex: 9999, overflow: 'visible' }}>
                              <label tabIndex={0} className="btn btn-lg bg-white border-2 hover:bg-purple-50 gap-2 text-base w-full justify-between" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                                <span>Actions</span>
                                <ChevronDownIcon className="w-5 h-5" style={{ color: '#4218CC' }} />
                              </label>
                              <ul tabIndex={0} className="dropdown-content z-[9999] menu p-2 bg-base-100 rounded-xl w-56 shadow-2xl border border-base-300" style={{ zIndex: 9999 }}>
                                {(() => {
                                  const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                                  const isUnactivated = isLegacy
                                    ? (selectedClient?.status === 10)
                                    : (selectedClient?.status === 'inactive');
                                  return isUnactivated;
                                })() ? (
                                  <li><a className="flex items-center gap-3 py-3 hover:bg-green-50 transition-colors rounded-lg" onClick={() => handleActivation()}><CheckCircleIcon className="w-5 h-5 text-green-500" /><span className="text-green-600 font-medium">Activate</span></a></li>
                                ) : (
                                  <li><a className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg" onClick={() => setShowUnactivationModal(true)}><NoSymbolIcon className="w-5 h-5 text-red-500" /><span className="text-red-600 font-medium">Unactivate/Spam</span></a></li>
                                )}
                                <li>
                                  <a
                                    className="flex items-center gap-3 py-3 hover:bg-base-200 transition-colors rounded-lg"
                                    onClick={async () => {
                                      if (!selectedClient?.id) return;
                                      
                                      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                                      const leadId = isLegacyLead 
                                        ? (typeof selectedClient.id === 'string' ? parseInt(selectedClient.id.replace('legacy_', '')) : selectedClient.id)
                                        : selectedClient.id;
                                      const leadNumber = selectedClient.lead_number || selectedClient.id?.toString();

                                      if (isInHighlightsState) {
                                        await removeFromHighlights(leadId, isLegacyLead);
                                      } else {
                                        await addToHighlights(leadId, leadNumber, isLegacyLead);
                                      }
                                      
                                      (document.activeElement as HTMLElement | null)?.blur();
                                    }}
                                  >
                                    {isInHighlightsState ? (
                                      <>
                                        <StarIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                                        <span className="font-medium">Remove from Highlights</span>
                                      </>
                                    ) : (
                                      <>
                                        <StarIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                                        <span className="font-medium">Add to Highlights</span>
                                      </>
                                    )}
                                  </a>
                                </li>
                                <li>
                                  <a
                                    className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg"
                                    onClick={() => {
                                      openEditLeadDrawer();
                                      (document.activeElement as HTMLElement | null)?.blur();
                                    }}
                                  >
                                    <PencilSquareIcon className="w-5 h-5 text-blue-500" />
                                    <span className="font-medium">Edit lead</span>
                                  </a>
                                </li>
                                <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg" onClick={() => { setShowSubLeadDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}><Squares2X2Icon className="w-5 h-5 text-green-500" /><span className="font-medium">Create Sub-Lead</span></a></li>
                                {isSuperuser && (
                                  <li>
                                    <a
                                      className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg"
                                      onClick={() => {
                                        setShowDeleteModal(true);
                                        (document.activeElement as HTMLElement | null)?.blur();
                                      }}
                                    >
                                      <TrashIcon className="w-5 h-5 text-red-500" />
                                      <span className="text-red-600 font-medium">Delete Lead</span>
                                    </a>
                                  </li>
                                )}
                              </ul>
                            </div>
                          </div>
                        </>
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Badges section - Duplicate Contacts */}
      <div className="hidden md:flex w-full justify-between items-center mt-2 mb-2 px-4">
        {/* Duplicate Contacts Badge - Left side */}
        {duplicateContacts.length > 0 ? (
          <div className="flex justify-start">
            <div className="relative">
              {duplicateContacts.length === 1 ? (
              <button
                onClick={() => setIsDuplicateModalOpen(true)}
                className="rounded-xl bg-gradient-to-tr from-orange-500 via-red-500 to-pink-600 text-white shadow-lg px-4 py-2 text-sm font-bold flex items-center gap-2 border-2 border-white/20 hover:from-orange-600 hover:via-red-600 hover:to-pink-700 transition-all cursor-pointer"
              >
                <DocumentDuplicateIcon className="w-4 h-4" />
                Duplicate Contact: {duplicateContacts[0].contactName} in Lead {duplicateContacts[0].leadNumber}
              </button>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setIsDuplicateDropdownOpen(!isDuplicateDropdownOpen)}
                  className="rounded-xl bg-gradient-to-tr from-orange-500 via-red-500 to-pink-600 text-white shadow-lg px-4 py-2 text-sm font-bold flex items-center gap-2 border-2 border-white/20 hover:from-orange-600 hover:via-red-600 hover:to-pink-700 transition-all cursor-pointer"
                >
                  <DocumentDuplicateIcon className="w-4 h-4" />
                  {duplicateContacts.length} Duplicate Contacts
                  <ChevronDownIcon className={`w-4 h-4 transition-transform ${isDuplicateDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {isDuplicateDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 bg-base-100 rounded-lg shadow-xl border border-base-300 z-50 min-w-[300px] max-h-96 overflow-y-auto">
                    {duplicateContacts.map((dup, idx) => (
                      <div
                        key={`${dup.contactId}-${dup.leadId}-${idx}`}
                        className="p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer"
                        onClick={() => {
                          navigate(`/clients/${dup.leadNumber}`);
                          setIsDuplicateDropdownOpen(false);
                        }}
                      >
                        <div className="font-semibold text-base-content">{dup.contactName}</div>
                        <div className="text-sm text-base-content/80">Lead {dup.leadNumber}: {dup.leadName}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {dup.stage && (
                            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                              Stage: {dup.stage}
                            </span>
                          )}
                          {dup.category && (
                            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                              {dup.category}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-base-content/70 mt-1">
                          Matches: {dup.matchingFields.join(', ')}
                        </div>
                      </div>
                    ))}
                    <div className="p-3 border-t border-gray-200 bg-gray-50">
                      <button
                        onClick={() => {
                          setIsDuplicateModalOpen(true);
                          setIsDuplicateDropdownOpen(false);
                        }}
                        className="w-full text-sm font-semibold text-orange-600 hover:text-orange-700"
                      >
                        View All Details
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        ) : (
          <div></div>
        )}

        </div>
      {/* Client Details Section (desktop) */}
      <div className="hidden md:block bg-white dark:bg-gray-900 w-full">
        {/* Modern CRM Header */}
        <div className="px-8 py-6">
          {/* Sub-lead notice at the top */}
          {isSubLead && masterLeadNumber && (
            <div className="text-sm text-gray-500 mb-2">
              This is a Sub-Lead of Master Lead: <a href={`/clients/${masterLeadNumber}/master`} className="underline text-blue-700 hover:text-blue-900">{masterLeadNumber}</a>
            </div>
          )}
          {/* Master lead notice */}
          {isMasterLead && subLeads.length > 0 && !(selectedClient?.master_id && String(selectedClient.master_id).trim() !== '') && (
            <div className="text-sm text-gray-500 mb-2">
              This is a master lead with {subLeads.length} sub-lead{subLeads.length !== 1 ? 's' : ''}. 
              <a 
                href={`/clients/${(() => {
                  // Get the base lead number without any suffix like /2
                  const leadNumber = selectedClient.lead_number || selectedClient.id || '';
                  return leadNumber.toString().split('/')[0];
                })()}/master`} 
                className="underline text-blue-700 hover:text-blue-900 ml-1"
              >
                View all sub-leads
              </a>
            </div>
          )}

          {/* Client Details - Modern Box Design */}
          <div className="pt-0">
            <div className="flex flex-col lg:flex-row justify-between gap-8">
              <div className="w-full lg:w-80">
                <ClientInformationBox selectedClient={selectedClient} onClientUpdate={async () => await refreshClientData(selectedClient?.id)} />
              </div>
              <div className="w-full lg:w-48 flex flex-col items-center">
                {/* Next Payment Due Indicator */}
                {nextDuePayment && (
                  <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-xl shadow-lg px-4 py-2 mb-2 w-full max-w-xs">
                    <div className="text-center">
                      <div className="text-white text-xs font-semibold mb-1">Next Payment Due</div>
                      <div className="text-white text-sm font-bold">
                        {(() => {
                          const dueDate = new Date(nextDuePayment.due_date);
                          const today = new Date();
                          const diffTime = dueDate.getTime() - today.getTime();
                          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                          
                          let dateText = dueDate.toLocaleDateString('en-GB');
                          if (diffDays === 0) {
                            dateText = 'Today';
                          } else if (diffDays === 1) {
                            dateText = 'Tomorrow';
                          } else if (diffDays < 0) {
                            dateText = `${Math.abs(diffDays)} days overdue`;
                          }
                          
                          const currency = nextDuePayment.isLegacy 
                            ? (nextDuePayment.accounting_currencies?.iso_code === 'ILS' ? '₪' : nextDuePayment.accounting_currencies?.iso_code || '₪')
                            : (nextDuePayment.currency || '₪');
                          
                          const amount = nextDuePayment.isLegacy 
                            ? (Number(nextDuePayment.value) + Number(nextDuePayment.vat_value || 0))
                            : (Number(nextDuePayment.value) + Number(nextDuePayment.value_vat || 0));
                          
                          return `${currency}${Number(amount.toFixed(2)).toLocaleString()} - ${dateText}`;
                        })()}
                      </div>
                    </div>
                  </div>
                )}
                
                <div 
                  className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl shadow-lg p-4 mb-3 cursor-pointer hover:from-purple-700 hover:to-blue-700 transition-all duration-200"
                  onClick={() => setIsBalanceModalOpen(true)}
                  title="Click to edit balance"
                >
                  <div className="text-center">
                    <div className="text-white text-2xl font-bold whitespace-nowrap">
                      {(() => {
                        // For new leads, use balance column. For legacy, use total
                        const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
                        const baseAmount = isLegacyLead 
                          ? Number(selectedClient?.total || selectedClient?.balance || 0)
                          : Number(selectedClient?.balance || selectedClient?.proposal_total || 0);
                        const subcontractorFee = Number(selectedClient?.subcontractor_fee ?? 0);
                        const mainAmount = baseAmount - subcontractorFee;
                        
                        // Get currency symbol - prioritize computed values from refreshClientData
                        let currency = selectedClient?.proposal_currency ?? selectedClient?.balance_currency ?? '₪';
                        
                        // If no computed currency, try to get from currency_id directly
                        if ((!currency || currency === '₪') && selectedClient?.currency_id && !isLegacyLead) {
                          const currencyId = Number(selectedClient.currency_id);
                          switch (currencyId) {
                            case 1: currency = '₪'; break; // ILS
                            case 2: currency = '€'; break; // EUR  
                            case 3: currency = '$'; break; // USD
                            case 4: currency = '£'; break; // GBP
                            default: currency = '₪';
                          }
                        }
                        
                        // Calculate VAT - only show if vat column is 'true' for new leads
                        let vatAmount = 0;
                        let shouldShowVAT = false;
                        
                        if (isLegacyLead) {
                          // Legacy leads: check 'vat' column (text type, same as new leads)
                          // 'false', '0', 'no' → VAT excluded (don't show VAT)
                          // 'true', '1', 'yes', NULL, undefined → VAT included (show VAT)
                          const vatValue = (selectedClient as any)?.vat;
                          shouldShowVAT = true; // Default to showing VAT (included)
                          
                          if (vatValue !== null && vatValue !== undefined) {
                            const vatStr = String(vatValue).toLowerCase().trim();
                            // If VAT is excluded, don't show VAT in badge
                            if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') {
                              shouldShowVAT = false;
                            }
                          }
                          
                          // Only calculate VAT if we should show it
                          if (shouldShowVAT) {
                            const totalAmount = Number(selectedClient?.total || selectedClient?.balance || 0);
                            vatAmount = totalAmount * 0.18;
                          }
                        } else {
                          // New leads: check 'vat' column (text type)
                          // 'false', '0', 'no' → VAT excluded (don't show VAT)
                          // 'true', '1', 'yes', NULL, undefined → VAT included (show VAT)
                          const vatValue = selectedClient?.vat;
                          shouldShowVAT = true; // Default to showing VAT (included)
                          
                          if (vatValue !== null && vatValue !== undefined) {
                            const vatStr = String(vatValue).toLowerCase().trim();
                            // If VAT is excluded, don't show VAT in badge
                            if (vatStr === 'false' || vatStr === '0' || vatStr === 'no' || vatStr === 'excluded') {
                              shouldShowVAT = false;
                            }
                          }
                          
                          // Only calculate VAT if we should show it
                          if (shouldShowVAT) {
                            // Use vat_value from database if available, otherwise calculate for all currencies
                            if (selectedClient?.vat_value && Number(selectedClient.vat_value) > 0) {
                              vatAmount = Number(selectedClient.vat_value);
                            } else {
                              const totalAmount = Number(selectedClient?.balance || selectedClient?.proposal_total || 0);
                              vatAmount = totalAmount * 0.18; // Calculate VAT for all currencies
                            }
                          }
                        }
                        
                        return (
                          <span>
                            {currency}{Number(mainAmount.toFixed(2)).toLocaleString()}
                            {shouldShowVAT && vatAmount > 0 && (
                              <span className="text-white text-base opacity-90 font-normal ml-2">
                                +{Number(vatAmount.toFixed(2)).toLocaleString()} VAT
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </div>
                    {/* Conditionally show Potential Value - only if set */}
                    {(() => {
                      const potentialValue = (selectedClient as any)?.potential_total || (selectedClient as any)?.potential_value || null;
                      if (potentialValue !== null && potentialValue !== undefined) {
                        const numValue = typeof potentialValue === 'string' ? parseFloat(potentialValue) : Number(potentialValue);
                        if (!isNaN(numValue) && numValue > 0) {
                            // Get currency symbol - prioritize computed values from refreshClientData
                          let currency = selectedClient?.proposal_currency ?? selectedClient?.balance_currency ?? '₪';
                          
                          // If no computed currency, try to get from currency_id directly
                          if ((!currency || currency === '₪') && selectedClient?.currency_id) {
                            const currencyId = Number(selectedClient.currency_id);
                            switch (currencyId) {
                              case 1: currency = '₪'; break; // ILS
                              case 2: currency = '€'; break; // EUR  
                              case 3: currency = '$'; break; // USD
                              case 4: currency = '£'; break; // GBP
                              default: currency = '₪';
                            }
                          }
                          const formattedValue = typeof potentialValue === 'string' 
                            ? potentialValue 
                            : numValue.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                          return (
                            <div className="text-white text-sm opacity-90 mt-2 pt-2 border-t border-white/20">
                              <div className="font-medium">Potential Value:</div>
                              <div className="text-white">
                                <span className="text-white">
                                  {currency}{formattedValue}
                                </span>
                              </div>
                            </div>
                          );
                        }
                      }
                      return null;
                    })()}
                    {/* Conditionally show Total - only if subcontractor fee exists */}
                    {Number(selectedClient?.subcontractor_fee ?? 0) > 0 && (
                      <div className="text-white text-sm opacity-90 mt-2 pt-2 border-t border-white/20">
                        Total: {(() => {
                          const isLegacyLead = selectedClient?.id?.toString().startsWith('legacy_');
                            // Get currency symbol - prioritize computed values from refreshClientData
                          let currency = selectedClient?.proposal_currency ?? selectedClient?.balance_currency ?? '₪';
                          
                          // If no computed currency, try to get from currency_id directly
                          if ((!currency || currency === '₪') && selectedClient?.currency_id) {
                            const currencyId = Number(selectedClient.currency_id);
                            switch (currencyId) {
                              case 1: currency = '₪'; break; // ILS
                              case 2: currency = '€'; break; // EUR  
                              case 3: currency = '$'; break; // USD
                              case 4: currency = '£'; break; // GBP
                              default: currency = '₪';
                            }
                          }
                          const baseAmount = isLegacyLead
                            ? Number(selectedClient?.total || selectedClient?.balance || 0)
                            : Number(selectedClient?.balance || selectedClient?.proposal_total || 0);
                          return `${currency}${Number(baseAmount.toFixed(2)).toLocaleString()}`;
                        })()}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Stage Badge - Under balance badge */}
                {selectedClient?.stage !== null &&
                  selectedClient?.stage !== undefined &&
                  selectedClient?.stage !== '' && (
                    <div className="mb-3 flex justify-center items-center gap-3">
                      {getStageBadge(selectedClient.stage, 'desktop')}
                      {/* Meeting Scheduled Badge */}
                      {hasScheduledMeetings && nextMeetingDate && (
                        <button
                          onClick={() => setActiveTab('meeting')}
                          className="shadow-lg cursor-pointer animate-pulse font-semibold rounded-full"
                          style={{
                            background: 'linear-gradient(to bottom right, #10b981, #14b8a6)',
                            color: 'white',
                            borderColor: '#10b981',
                            padding: '0.5rem 1rem',
                            minHeight: '3.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.875rem',
                            lineHeight: '1.25rem',
                          }}
                        >
                          <span className="flex flex-col items-center gap-0.5">
                            <span className="font-semibold">Meeting Scheduled</span>
                            <span className="text-xs font-medium opacity-90">
                              {(() => {
                                const date = new Date(nextMeetingDate);
                                return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                              })()}
                            </span>
                          </span>
                        </button>
                      )}
                      {areStagesEquivalent(currentStageName, 'Handler Set') && (
                        <button
                          type="button"
                          onClick={handleStartCase}
                          className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-semibold shadow-lg animate-pulse hover:animate-none hover:scale-105 transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                        >
                          <PlayIcon className="w-5 h-5" />
                          Start Case
                        </button>
                      )}
                      {areStagesEquivalent(currentStageName, 'Handler Started') && (
                        <>
                          <button
                            type="button"
                            onClick={() => updateLeadStage('Application submitted')}
                            className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold shadow-lg animate-pulse hover:animate-none hover:scale-105 transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                          >
                            <DocumentCheckIcon className="w-6 h-6" />
                            Application submitted
                          </button>
                          <button
                            type="button"
                            onClick={() => updateLeadStage('Case Closed')}
                            className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-gray-500 to-slate-500 text-white font-semibold shadow-lg animate-pulse hover:animate-none hover:scale-105 transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                          >
                            <CheckCircleIcon className="w-6 h-6" />
                            Case closed
                          </button>
                        </>
                      )}
                      {areStagesEquivalent(currentStageName, 'Application submitted') && (
                        <button
                          type="button"
                          onClick={() => updateLeadStage('Case Closed')}
                          className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-gray-500 to-slate-500 text-white font-semibold shadow-lg animate-pulse hover:animate-none hover:scale-105 transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                        >
                          <CheckCircleIcon className="w-6 h-6" />
                          Case closed
                        </button>
                      )}
                  </div>
                )}
                
                {/* Category Prompt Message - Under stage badge */}
                {(!selectedClient?.category_id && !selectedClient?.category) && (
                  <div className="text-center mb-3">
                    <div className="text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-lg border border-orange-200 inline-block animate-pulse shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105" style={{
                      boxShadow: '0 4px 8px rgba(0,0,0,0.1), 0 8px 16px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.2)',
                      animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                    }}>
                      Please add a category for this lead
                    </div>
                  </div>
                )}
                
                {/* Applicants Display - Under stage badge */}
                {(() => {
                  const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                  const applicantsCount = isLegacyLead ? selectedClient?.no_of_applicants : selectedClient?.number_of_applicants_meeting;
                  
                  return applicantsCount && applicantsCount > 0 ? (
                    <div className="text-center mb-3">
                      <div className="text-black text-lg font-semibold">
                        {applicantsCount} applicant{applicantsCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                  ) : null;
                })()}
                
                {/* Show "Case is not active" message for unactivated leads */}
                {(() => {
                  const isLegacyForBadge = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                  const statusValueForBadge = selectedClient ? (selectedClient as any).status : null;
                  const isUnactivatedForBadge = isLegacyForBadge
                    ? (statusValueForBadge === 10 || statusValueForBadge === '10' || Number(statusValueForBadge) === 10)
                    : (statusValueForBadge === 'inactive');
                  
                  return isUnactivatedForBadge ? (
                    <div className="mt-3">
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-100 border border-red-300 rounded-lg">
                        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                        <span className="text-red-700 font-medium text-sm">Case is not active</span>
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>
              <div className="w-full lg:w-80">
                <ProgressFollowupBox 
                  selectedClient={selectedClient} 
                  getEmployeeDisplayName={getEmployeeDisplayName}
                  dropdownsContent={
                    <>
                      {/* First row: Stages and Actions buttons */}
                      <div className="flex flex-row gap-3 w-full">
                        <div className="flex flex-col flex-1 gap-3">
                          <div className="dropdown relative" style={{ zIndex: 9999, overflow: 'visible' }}>
                            <label tabIndex={0} className="btn btn-lg bg-white border-2 hover:bg-purple-50 gap-2 text-base saira-regular w-full justify-between" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                              <span>Stages</span>
                              <ChevronDownIcon className="w-5 h-5" style={{ color: '#4218CC' }} />
                            </label>
                            {dropdownItems && (
                              <ul tabIndex={0} className="dropdown-content z-[9999] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56 shadow-2xl" style={{ zIndex: 9999 }}>
                                {dropdownItems}
                              </ul>
                            )}
                          </div>
                          
                          {/* Input fields under Stages button */}
                          {selectedClient && areStagesEquivalent(currentStageName, 'Success') && (
                            <div className="flex flex-col items-start gap-1">
                              <label className="block text-sm font-semibold text-primary mb-1">Assign case handler</label>
                              <div ref={successStageHandlerContainerRefDesktop} className="relative w-full">
                                <input
                                  type="text"
                                  className="input input-bordered w-full"
                                  placeholder="Not assigned"
                                  value={successStageHandlerSearch}
                                  onChange={e => {
                                    setSuccessStageHandlerSearch(e.target.value);
                                    setShowSuccessStageHandlerDropdown(true);
                                  }}
                                  onFocus={() => {
                                    setShowSuccessStageHandlerDropdown(true);
                                    setFilteredSuccessStageHandlerOptions(handlerOptions);
                                  }}
                                  autoComplete="off"
                                  disabled={isUpdatingSuccessStageHandler}
                                />
                                {showSuccessStageHandlerDropdown && (
                                  <div className="absolute z-[60] mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-base-300 bg-base-100 shadow-2xl">
                                    <button
                                      type="button"
                                      className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                                      onClick={() => {
                                        setSuccessStageHandlerSearch('');
                                        setShowSuccessStageHandlerDropdown(false);
                                        setFilteredSuccessStageHandlerOptions(handlerOptions);
                                        void assignSuccessStageHandler(null);
                                      }}
                                      disabled={isUpdatingSuccessStageHandler}
                                    >
                                      ---------
                                    </button>
                                    {filteredSuccessStageHandlerOptions.length > 0 ? (
                                      filteredSuccessStageHandlerOptions.map(option => (
                                        <button
                                          type="button"
                                          key={option.id}
                                          className="w-full text-left px-4 py-2 text-sm hover:bg-primary/10"
                                          onClick={() => {
                                            setSuccessStageHandlerSearch(option.label);
                                            setShowSuccessStageHandlerDropdown(false);
                                            setFilteredSuccessStageHandlerOptions(handlerOptions);
                                            void assignSuccessStageHandler(option);
                                          }}
                                          disabled={isUpdatingSuccessStageHandler}
                                        >
                                          {option.label}
                                        </button>
                                      ))
                                    ) : (
                                      <div className="px-4 py-3 text-sm text-base-content/60">
                                        No handlers found
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {selectedClient && areStagesEquivalent(currentStageName, 'created') && (
                            <div className="relative" data-assign-dropdown="true">
                              <label className="block text-sm font-medium text-primary mb-1">Assign to</label>
                              <input
                                type="text"
                                className="input input-bordered w-full"
                                placeholder="---"
                                value={schedulerSearchTerm}
                                onChange={e => {
                                  setSchedulerSearchTerm(e.target.value);
                                  setShowSchedulerDropdown(true);
                                }}
                                onFocus={() => setShowSchedulerDropdown(true)}
                              />
                              {showSchedulerDropdown && (
                                <div className="absolute z-[60] mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-base-300 bg-base-100 shadow-2xl">
                                  <button
                                    type="button"
                                    className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                                    onClick={() => {
                                      setSchedulerSearchTerm('');
                                      setShowSchedulerDropdown(false);
                                      updateScheduler('');
                                    }}
                                  >
                                    ---------
                                  </button>
                                  {filteredSchedulerOptions.length > 0 ? (
                                    filteredSchedulerOptions.map(option => (
                                      <button
                                        type="button"
                                        key={option}
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-primary/10"
                                        onClick={() => {
                                          setSchedulerSearchTerm(option);
                                          setShowSchedulerDropdown(false);
                                          updateScheduler(option);
                                        }}
                                      >
                                        {option}
                                      </button>
                                    ))
                                  ) : (
                                    <div className="px-4 py-3 text-sm text-base-content/60">
                                      No matches found
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        
                        <div className="dropdown dropdown-end flex-1 relative" style={{ zIndex: 9999, overflow: 'visible' }}>
                          <label tabIndex={0} className="btn btn-lg bg-white border-2 hover:bg-purple-50 gap-2 text-base w-full justify-between" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                            <span>Actions</span>
                            <ChevronDownIcon className="w-5 h-5" style={{ color: '#4218CC' }} />
                          </label>
                          <ul tabIndex={0} className="dropdown-content z-[9999] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56 shadow-2xl border border-gray-200" style={{ zIndex: 9999 }}>
                          {(() => {
                            const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                            const isUnactivated = isLegacy
                              ? (selectedClient?.status === 10)
                              : (selectedClient?.status === 'inactive');
                            return isUnactivated;
                          })() ? (
                            <li><a className="flex items-center gap-3 py-3 hover:bg-green-50 transition-colors rounded-lg" onClick={() => handleActivation()}><CheckCircleIcon className="w-5 h-5 text-green-500" /><span className="text-green-600 font-medium">Activate</span></a></li>
                          ) : (
                            <li><a className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg" onClick={() => setShowUnactivationModal(true)}><NoSymbolIcon className="w-5 h-5 text-red-500" /><span className="text-red-600 font-medium">Unactivate/Spam</span></a></li>
                          )}
                          <li>
                            <a
                              className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg"
                              onClick={async () => {
                                if (!selectedClient?.id) return;
                                
                                const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                                const leadId = isLegacyLead 
                                  ? (typeof selectedClient.id === 'string' ? parseInt(selectedClient.id.replace('legacy_', '')) : selectedClient.id)
                                  : selectedClient.id;
                                const leadNumber = selectedClient.lead_number || selectedClient.id?.toString();

                                if (isInHighlightsState) {
                                  await removeFromHighlights(leadId, isLegacyLead);
                                } else {
                                  await addToHighlights(leadId, leadNumber, isLegacyLead);
                                }
                                
                                (document.activeElement as HTMLElement | null)?.blur();
                              }}
                            >
                              {isInHighlightsState ? (
                                <>
                                  <StarIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                                  <span className="font-medium">Remove from Highlights</span>
                                </>
                              ) : (
                                <>
                                  <StarIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                                  <span className="font-medium">Add to Highlights</span>
                                </>
                              )}
                            </a>
                          </li>
                          <li>
                            <a
                              className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg"
                              onClick={() => {
                                openEditLeadDrawer();
                                (document.activeElement as HTMLElement | null)?.blur();
                              }}
                            >
                              <PencilSquareIcon className="w-5 h-5 text-blue-500" />
                              <span className="font-medium">Edit lead</span>
                            </a>
                          </li>
                          <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg" onClick={() => { setShowSubLeadDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}><Squares2X2Icon className="w-5 h-5 text-green-500" /><span className="font-medium">Create Sub-Lead</span></a></li>
                          {isSuperuser && (
                            <li>
                              <a
                                className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg"
                                onClick={() => {
                                  setShowDeleteModal(true);
                                  (document.activeElement as HTMLElement | null)?.blur();
                                }}
                              >
                                <TrashIcon className="w-5 h-5 text-red-500" />
                                <span className="text-red-600 font-medium">Delete Lead</span>
                              </a>
                            </li>
                          )}
                        </ul>
                      </div>
                      </div>
                    </>
                  }
                />
              </div>
            </div>
          </div>
        </div>
        </div>
        
        {/* Tabs Navigation */}
        
        {/* Tabs Navigation - Desktop */}
        <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6 mx-6">
          <div className="w-full">
            {/* Desktop version */}
            <div className="flex flex-col px-4 py-4 gap-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div ref={desktopTabsRef} className="flex bg-white dark:bg-gray-800 p-1 gap-1 overflow-x-auto flex-1 rounded-lg scrollbar-hide min-w-0" style={{ scrollBehavior: 'smooth' }}>
                                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      className={`relative flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-300 hover:scale-[1.02] whitespace-nowrap flex-shrink-0 ${
                        activeTab === tab.id
                          ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg transform scale-[1.02]'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                      }`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                    <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'text-white' : 'text-gray-500'}`} />
                    <span className={`whitespace-nowrap saira-light font-bold ${activeTab === tab.id ? 'text-white' : 'text-gray-600'}`}>{tab.label}</span>
                    {tab.id === 'interactions' && tab.badge && (
                      <div className={`badge badge-sm font-bold ${
                        activeTab === tab.id 
                          ? 'bg-white/20 text-white border-white/30' 
                          : 'bg-purple-100 text-purple-700 border-purple-200'
                      }`}>
                        {tab.badge}
                      </div>
                    )}
                    {activeTab === tab.id && (
                      <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white dark:bg-gray-800 rounded-full shadow-lg"></div>
                    )}
                  </button>
                ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Mobile: Edge-positioned arrow buttons */}
        <div className="lg:hidden">
          {/* Right Edge - Menu Button */}
          <button
            onClick={() => {
              setShowMobileMenu(!showMobileMenu);
              setShowMobileStagesDropdown(false);
              setShowMobileActionsDropdown(false);
            }}
            className="fixed right-2 top-1/2 -translate-y-1/2 z-[45] bg-white rounded-full shadow-lg p-3 transition-all hover:scale-110"
            style={{ backgroundColor: '#4218CC' }}
          >
            <Bars3Icon className="w-6 h-6 text-white" />
          </button>

          {/* Mobile Menu - Choose Client Info, Stages or Actions */}
          {showMobileMenu && (
            <>
              <div 
                className="fixed inset-0 z-40 bg-black/20"
                onClick={() => setShowMobileMenu(false)}
              />
              <div className="fixed right-2 top-1/2 -translate-y-1/2 mr-16 z-50 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => {
                    setShowMobileMenu(false);
                    setShowMobileClientInfo(true);
                    setShowMobileStagesDropdown(false);
                    setShowMobileActionsDropdown(false);
                  }}
                  className="w-full px-6 py-4 text-left hover:bg-purple-50 transition-colors border-b border-gray-100"
                >
                  <span className="font-semibold" style={{ color: '#4218CC' }}>Client Info</span>
                </button>
                <button
                  onClick={() => {
                    setShowMobileMenu(false);
                    setShowMobileStagesDropdown(true);
                    setShowMobileActionsDropdown(false);
                    setShowMobileClientInfo(false);
                  }}
                  className="w-full px-6 py-4 text-left hover:bg-purple-50 transition-colors border-b border-gray-100"
                >
                  <span className="font-semibold" style={{ color: '#4218CC' }}>Stages</span>
                </button>
                <button
                  onClick={() => {
                    setShowMobileMenu(false);
                    setShowMobileStagesDropdown(false);
                    setShowMobileActionsDropdown(true);
                    setShowMobileClientInfo(false);
                  }}
                  className="w-full px-6 py-4 text-left hover:bg-purple-50 transition-colors"
                >
                  <span className="font-semibold" style={{ color: '#4218CC' }}>Actions</span>
                </button>
              </div>
            </>
          )}

          {/* Mobile Stages Dropdown */}
          {showMobileStagesDropdown && (
            <>
              <div 
                className="fixed inset-0 z-40 bg-black/20"
                onClick={() => setShowMobileStagesDropdown(false)}
              />
              <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50 bg-base-100 rounded-r-2xl shadow-2xl border border-l-0 border-base-300 w-64 max-h-[80vh] overflow-y-auto">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-base" style={{ color: '#4218CC' }}>Stages</h3>
                    <button
                      onClick={() => setShowMobileStagesDropdown(false)}
                      className="btn btn-ghost btn-sm btn-circle"
                    >
                      <XMarkIcon className="w-5 h-5" />
                    </button>
                  </div>
                  {dropdownItems && (
                    <ul className="menu p-0">
                      {dropdownItems}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Mobile Actions Dropdown */}
          {showMobileActionsDropdown && (
            <>
              <div 
                className="fixed inset-0 z-40 bg-black/20"
                onClick={() => setShowMobileActionsDropdown(false)}
              />
              <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-base-100 rounded-l-2xl shadow-2xl border border-r-0 border-base-300 w-64 max-h-[80vh] overflow-y-auto">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-base" style={{ color: '#4218CC' }}>Actions</h3>
                    <button
                      onClick={() => setShowMobileActionsDropdown(false)}
                      className="btn btn-ghost btn-sm btn-circle"
                    >
                      <XMarkIcon className="w-5 h-5" />
                    </button>
                  </div>
                  <ul className="menu p-0">
                    {(() => {
                      const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                      const isUnactivated = isLegacy
                        ? (selectedClient?.status === 10)
                        : (selectedClient?.status === 'inactive');
                      return isUnactivated;
                    })() ? (
                      <li><a className="flex items-center gap-3 py-3 hover:bg-green-50 transition-colors rounded-lg" onClick={() => handleActivation()}><CheckCircleIcon className="w-5 h-5 text-green-500" /><span className="text-green-600 font-medium">Activate</span></a></li>
                    ) : (
                      <li><a className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg" onClick={() => setShowUnactivationModal(true)}><NoSymbolIcon className="w-5 h-5 text-red-500" /><span className="text-red-600 font-medium">Unactivate/Spam</span></a></li>
                    )}
                    <li>
                      <a
                        className="flex items-center gap-3 py-3 hover:bg-base-200 transition-colors rounded-lg"
                        onClick={async () => {
                          if (!selectedClient?.id) return;
                          
                          const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                          const leadId = isLegacyLead 
                            ? (typeof selectedClient.id === 'string' ? parseInt(selectedClient.id.replace('legacy_', '')) : selectedClient.id)
                            : selectedClient.id;
                          const leadNumber = selectedClient.lead_number || selectedClient.id?.toString();

                          if (isInHighlightsState) {
                            await removeFromHighlights(leadId, isLegacyLead);
                          } else {
                            await addToHighlights(leadId, leadNumber, isLegacyLead);
                          }
                          
                          setShowMobileActionsDropdown(false);
                        }}
                      >
                        {isInHighlightsState ? (
                          <>
                            <StarIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                            <span className="font-medium">Remove from Highlights</span>
                          </>
                        ) : (
                          <>
                            <StarIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                            <span className="font-medium">Add to Highlights</span>
                          </>
                        )}
                      </a>
                    </li>
                    <li>
                      <a
                        className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg"
                        onClick={() => {
                          openEditLeadDrawer();
                          setShowMobileActionsDropdown(false);
                        }}
                      >
                        <PencilSquareIcon className="w-5 h-5 text-blue-500" />
                        <span className="font-medium">Edit lead</span>
                      </a>
                    </li>
                    <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg" onClick={() => { setShowSubLeadDrawer(true); setShowMobileActionsDropdown(false); }}><Squares2X2Icon className="w-5 h-5 text-green-500" /><span className="font-medium">Create Sub-Lead</span></a></li>
                    {isSuperuser && (
                      <li>
                        <a
                          className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg"
                          onClick={() => {
                            setShowDeleteModal(true);
                            setShowMobileActionsDropdown(false);
                          }}
                        >
                          <TrashIcon className="w-5 h-5 text-red-500" />
                          <span className="text-red-600 font-medium">Delete Lead</span>
                        </a>
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </>
          )}

          {/* Mobile Client Information Panel */}
          {showMobileClientInfo && (
            <>
              <div 
                className="fixed inset-0 z-40 bg-black/20"
                onClick={() => setShowMobileClientInfo(false)}
              />
              <div className="fixed right-0 top-0 bottom-0 z-50 bg-base-100 shadow-2xl border-l border-base-300 w-80 max-w-[85vw] overflow-y-auto">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg" style={{ color: '#4218CC' }}>Client Information</h3>
                    <button
                      onClick={() => setShowMobileClientInfo(false)}
                      className="btn btn-ghost btn-sm btn-circle"
                    >
                      <XMarkIcon className="w-5 h-5" />
                    </button>
                  </div>
                  <ClientInformationBox 
                    selectedClient={selectedClient} 
                    getEmployeeDisplayName={getEmployeeDisplayName}
                    onClientUpdate={async () => await refreshClientData(selectedClient?.id)}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Stages, Actions, and Assign to - Mobile Only - Above Tabs - HIDDEN: Using edge arrows instead */}
        <div className="hidden px-4 py-3 space-y-3">
          {/* First row: Stages and Actions buttons */}
          <div className="flex flex-row gap-3 w-full">
            <div className="flex flex-col flex-1 gap-3">
              <div className="dropdown relative" style={{ zIndex: 9999, overflow: 'visible' }}>
                <label tabIndex={0} className="btn btn-lg bg-white border-2 hover:bg-purple-50 gap-2 text-base saira-regular w-full justify-between" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                  <span>Stages</span>
                  <ChevronDownIcon className="w-5 h-5" style={{ color: '#4218CC' }} />
                </label>
                {dropdownItems && (
                  <ul tabIndex={0} className="dropdown-content z-[9999] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56 shadow-2xl" style={{ zIndex: 9999 }}>
                    {dropdownItems}
                  </ul>
                )}
              </div>
              
              {/* Input fields under Stages button */}
              {selectedClient && areStagesEquivalent(currentStageName, 'Success') && (
                <div className="flex flex-col items-start gap-1">
                  <label className="block text-sm font-semibold text-primary mb-1">Assign case handler</label>
                  <div ref={successStageHandlerContainerRef} className="relative w-full">
                    <input
                      type="text"
                      className="input input-bordered w-full"
                      placeholder="Not assigned"
                      value={successStageHandlerSearch}
                      onChange={e => {
                        setSuccessStageHandlerSearch(e.target.value);
                        setShowSuccessStageHandlerDropdown(true);
                      }}
                      onFocus={() => {
                        setShowSuccessStageHandlerDropdown(true);
                        setFilteredSuccessStageHandlerOptions(handlerOptions);
                      }}
                      autoComplete="off"
                      disabled={isUpdatingSuccessStageHandler}
                    />
                    {showSuccessStageHandlerDropdown && (
                      <div className="absolute z-[60] mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-base-300 bg-base-100 shadow-2xl">
                        <button
                          type="button"
                          className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                          onClick={() => {
                            setSuccessStageHandlerSearch('');
                            setShowSuccessStageHandlerDropdown(false);
                            setFilteredSuccessStageHandlerOptions(handlerOptions);
                            void assignSuccessStageHandler(null);
                          }}
                          disabled={isUpdatingSuccessStageHandler}
                        >
                          ---------
                        </button>
                        {filteredSuccessStageHandlerOptions.length > 0 ? (
                          filteredSuccessStageHandlerOptions.map(option => (
                            <button
                              type="button"
                              key={option.id}
                              className="w-full text-left px-4 py-2 text-sm hover:bg-primary/10"
                              onClick={() => {
                                setSuccessStageHandlerSearch(option.label);
                                setShowSuccessStageHandlerDropdown(false);
                                setFilteredSuccessStageHandlerOptions(handlerOptions);
                                void assignSuccessStageHandler(option);
                              }}
                              disabled={isUpdatingSuccessStageHandler}
                            >
                              {option.label}
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-base-content/60">
                            No handlers found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {selectedClient && areStagesEquivalent(currentStageName, 'created') && (
                <div className="relative" data-assign-dropdown="true">
                  <label className="block text-sm font-medium text-primary mb-1">Assign to</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="---"
                    value={schedulerSearchTerm}
                    onChange={e => {
                      setSchedulerSearchTerm(e.target.value);
                      setShowSchedulerDropdown(true);
                    }}
                    onFocus={() => setShowSchedulerDropdown(true)}
                  />
                  {showSchedulerDropdown && (
                    <div className="absolute z-[60] mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-base-300 bg-base-100 shadow-2xl">
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                        onClick={() => {
                          setSchedulerSearchTerm('');
                          setShowSchedulerDropdown(false);
                          updateScheduler('');
                        }}
                      >
                        ---------
                      </button>
                      {filteredSchedulerOptions.length > 0 ? (
                        filteredSchedulerOptions.map(option => (
                          <button
                            type="button"
                            key={option}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-primary/10"
                            onClick={() => {
                              setSchedulerSearchTerm(option);
                              setShowSchedulerDropdown(false);
                              updateScheduler(option);
                            }}
                          >
                            {option}
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-sm text-base-content/60">
                          No matches found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="dropdown dropdown-end flex-1 relative" style={{ zIndex: 9999, overflow: 'visible' }}>
              <label tabIndex={0} className="btn btn-lg bg-white border-2 hover:bg-purple-50 gap-2 text-base w-full justify-between" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                <span>Actions</span>
                <ChevronDownIcon className="w-5 h-5" style={{ color: '#4218CC' }} />
              </label>
              <ul tabIndex={0} className="dropdown-content z-[9999] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56 shadow-2xl border border-gray-200" style={{ zIndex: 9999 }}>
                {(() => {
                  const isLegacy = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                  const isUnactivated = isLegacy
                    ? (selectedClient?.status === 10)
                    : (selectedClient?.status === 'inactive');
                  return isUnactivated;
                })() ? (
                  <li><a className="flex items-center gap-3 py-3 hover:bg-green-50 transition-colors rounded-lg" onClick={() => handleActivation()}><CheckCircleIcon className="w-5 h-5 text-green-500" /><span className="text-green-600 font-medium">Activate</span></a></li>
                ) : (
                  <li><a className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg" onClick={() => setShowUnactivationModal(true)}><NoSymbolIcon className="w-5 h-5 text-red-500" /><span className="text-red-600 font-medium">Unactivate/Spam</span></a></li>
                )}
                <li>
                  <a
                    className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg"
                    onClick={async () => {
                      if (!selectedClient?.id) return;
                      
                      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                      const leadId = isLegacyLead 
                        ? (typeof selectedClient.id === 'string' ? parseInt(selectedClient.id.replace('legacy_', '')) : selectedClient.id)
                        : selectedClient.id;
                      const leadNumber = selectedClient.lead_number || selectedClient.id?.toString();

                      if (isInHighlightsState) {
                        await removeFromHighlights(leadId, isLegacyLead);
                      } else {
                        await addToHighlights(leadId, leadNumber, isLegacyLead);
                      }
                      
                      (document.activeElement as HTMLElement | null)?.blur();
                    }}
                  >
                    {isInHighlightsState ? (
                      <>
                        <StarIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                        <span className="font-medium">Remove from Highlights</span>
                      </>
                    ) : (
                      <>
                        <StarIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                        <span className="font-medium">Add to Highlights</span>
                      </>
                    )}
                  </a>
                </li>
                <li>
                  <a
                    className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg"
                    onClick={() => {
                      openEditLeadDrawer();
                      (document.activeElement as HTMLElement | null)?.blur();
                    }}
                  >
                    <PencilSquareIcon className="w-5 h-5 text-blue-500" />
                    <span className="font-medium">Edit lead</span>
                  </a>
                </li>
                <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg" onClick={() => { setShowSubLeadDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}><Squares2X2Icon className="w-5 h-5 text-green-500" /><span className="font-medium">Create Sub-Lead</span></a></li>
                {isSuperuser && (
                  <li>
                    <a
                      className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg"
                      onClick={() => {
                        setShowDeleteModal(true);
                        (document.activeElement as HTMLElement | null)?.blur();
                      }}
                    >
                      <TrashIcon className="w-5 h-5 text-red-500" />
                      <span className="text-red-600 font-medium">Delete Lead</span>
                    </a>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>

        {/* Tabs Navigation - Mobile */}
        <div className="md:hidden px-4 py-2 mb-6 mt-2">
              
              <div
                ref={mobileTabsRef}
                className="relative overflow-x-auto overflow-y-hidden scrollbar-hide touch-pan-x w-full -mx-2 px-2"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {/* Scroll indicator - fade gradient on left */}
                {canScrollLeft && (
                  <div 
                    className="absolute left-0 top-0 bottom-0 w-8 pointer-events-none z-30"
                    style={{
                      background: 'linear-gradient(to right, rgba(15, 23, 42, 0.15) 0%, rgba(255, 255, 255, 0.85) 45%, rgba(255, 255, 255, 0) 100%)'
                    }}
                  />
                )}
                {/* Scroll indicator - fade gradient on right */}
                {canScrollRight && (
                  <div 
                    className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none z-30"
                    style={{
                      background: 'linear-gradient(to left, rgba(15, 23, 42, 0.15) 0%, rgba(255, 255, 255, 0.85) 45%, rgba(255, 255, 255, 0) 100%)'
                    }}
                  />
                )}
                <div className="flex gap-2 pb-1 min-w-max">
                  {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        className={`relative flex flex-col items-center justify-center p-3 rounded-lg transition-all duration-300 min-w-[85px] ${
                          isActive
                            ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-lg transform scale-105'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                        }`}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        <div className="relative">
                          <tab.icon className={`w-5 h-5 mb-1 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                          {tab.id === 'interactions' && tab.badge && (
                            <div className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
                              isActive 
                                ? 'bg-white/20 text-white' 
                                : 'bg-purple-100 text-purple-700'
                            }`}>
                              {tab.badge}
                            </div>
                          )}
                        </div>
                        <span className={`text-xs font-semibold truncate max-w-[80px] ${
                          isActive ? 'text-white' : 'text-gray-600'
                        }`}>
                          {tab.label}
                        </span>
                        {isActive && (
                          <div className="absolute -bottom-0.5 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-white dark:bg-gray-800 rounded-full"></div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
        </div>

        {/* Tab Content - full width, white background */}
        <div className="w-full bg-base-100 min-h-screen">
          <div
            key={`${activeTab}-${interactionCount}`}
            className="p-2 sm:p-4 md:p-6 pb-6 md:pb-6 mb-4 md:mb-0"
          >
                          {ActiveComponent && selectedClient && (
                            <ActiveComponent
                              key={`${activeTab}-${selectedClient.id}`}
                              client={selectedClient}
                              onClientUpdate={onClientUpdate}
                              interactionsCache={interactionsCacheForLead}
                              onInteractionsCacheUpdate={handleInteractionsCacheUpdate}
                              onInteractionCountUpdate={handleInteractionCountUpdate}
                              {...financeProps}
                            />
                          )}
          </div>
        </div>
      {/* Schedule Meeting Right Panel */}
      {showScheduleMeetingPanel && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={closeSchedulePanel}
          />
          {/* Panel */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl flex flex-col animate-slideInRight z-50">
            {/* Fixed Header */}
            <div className="flex items-center justify-between p-8 pb-4 border-b border-base-300">
              <h3 className="text-2xl font-bold">Schedule Meeting</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeSchedulePanel}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-8 pt-4">
              {/* Notify Client Toggle */}
              <div className="mb-6 flex items-center justify-between">
                <label className="block font-semibold text-base">Notify Client</label>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifyClientOnSchedule}
                  onChange={(e) => setNotifyClientOnSchedule(e.target.checked)}
                />
              </div>

              {/* Tabs: Regular vs Paid meeting */}
              {/* <div className="mb-4">
                <div className="inline-flex rounded-lg bg-base-200 p-1">
                  <button
                    type="button"
                    className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                      meetingType === 'regular'
                        ? 'bg-base-100 text-primary shadow-sm'
                        : 'text-base-content/60'
                    }`}
                    onClick={() => setMeetingType('regular')}
                  >
                    Regular meeting
                  </button>
                  <button
                    type="button"
                    className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                      meetingType === 'paid'
                        ? 'bg-base-100 text-primary shadow-sm'
                        : 'text-base-content/60'
                    }`}
                    onClick={() => setMeetingType('paid')}
                  >
                    Paid meeting
                  </button>
                </div>
              </div> */}

              <div className="flex flex-col gap-4">
              {/* Location */}
              <div>
                <label className="block font-semibold mb-1">Location</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingFormData.location}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, location: e.target.value }))}
                >
                  {meetingLocations.map((location) => (
                    <option key={location.id} value={location.name}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Calendar */}
              <div>
                <label className="block font-semibold mb-1">Calendar</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingFormData.calendar}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, calendar: e.target.value }))}
                >
                  <option value="current">Potential Client</option>
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block font-semibold mb-1">Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={meetingFormData.date}
                  onChange={(e) => {
                    setMeetingFormData(prev => ({ ...prev, date: e.target.value }));
                    // Reset meeting counts when date changes
                    setMeetingCountsByTime({});
                  }}
                  required
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>

              {/* Time */}
              <TimePicker
                value={meetingFormData.time}
                onChange={(time) => setMeetingFormData(prev => ({ ...prev, time }))}
                meetingCounts={meetingCountsByTime}
                label="Time"
              />

              {/* Manager (Optional) */}
              <div className="relative" ref={managerDropdownRef}>
                <label className="block font-semibold mb-1">Manager (Optional)</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Select a manager..."
                  value={meetingFormData.manager}
                  onChange={(e) => {
                    const value = e.target.value;
                    setMeetingFormData(prev => ({ ...prev, manager: value }));
                    setManagerSearchTerm(value);
                    setShowManagerDropdown(true);
                  }}
                  onFocus={() => {
                    setManagerSearchTerm(meetingFormData.manager || '');
                    setShowManagerDropdown(true);
                  }}
                  autoComplete="off"
                />
                {showManagerDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {(() => {
                      const searchTerm = (managerSearchTerm || meetingFormData.manager || '').toLowerCase();
                      const filteredEmployees = allEmployees.filter(emp => {
                        return !searchTerm || emp.display_name.toLowerCase().includes(searchTerm);
                      });
                      
                      return filteredEmployees.length > 0 ? (
                        filteredEmployees.map(emp => {
                          const isUnavailable = meetingFormData.date && meetingFormData.time
                            ? isEmployeeUnavailable(emp.display_name, meetingFormData.date, meetingFormData.time)
                            : false;
                          return (
                            <div
                              key={emp.id}
                              className={`px-4 py-2 cursor-pointer flex items-center justify-between ${
                                isUnavailable
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                  : 'hover:bg-gray-100'
                              }`}
                              onClick={() => {
                                setMeetingFormData(prev => ({ ...prev, manager: emp.display_name }));
                                setManagerSearchTerm('');
                                setShowManagerDropdown(false);
                              }}
                            >
                              <span>{emp.display_name}</span>
                              {isUnavailable && (
                                <div className="flex items-center gap-1">
                                  <ClockIcon className="w-4 h-4" />
                                  <span className="text-xs">Unavailable</span>
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="px-4 py-2 text-gray-500 text-center">
                          No employees found
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Helper (Optional) */}
              <div className="relative" ref={helperDropdownRef}>
                <label className="block font-semibold mb-1">Helper (Optional)</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Select a helper..."
                  value={meetingFormData.helper}
                  onChange={(e) => {
                    const value = e.target.value;
                    setMeetingFormData(prev => ({ ...prev, helper: value }));
                    setHelperSearchTerm(value);
                    setShowHelperDropdown(true);
                  }}
                  onFocus={() => {
                    setHelperSearchTerm(meetingFormData.helper || '');
                    setShowHelperDropdown(true);
                  }}
                  autoComplete="off"
                />
                {showHelperDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {(() => {
                      const searchTerm = (helperSearchTerm || meetingFormData.helper || '').toLowerCase();
                      const filteredEmployees = allEmployees.filter(emp => {
                        return !searchTerm || emp.display_name.toLowerCase().includes(searchTerm);
                      });
                      
                      return filteredEmployees.length > 0 ? (
                        filteredEmployees.map(emp => {
                          const isUnavailable = meetingFormData.date && meetingFormData.time
                            ? isEmployeeUnavailable(emp.display_name, meetingFormData.date, meetingFormData.time)
                            : false;
                          return (
                            <div
                              key={emp.id}
                              className={`px-4 py-2 cursor-pointer flex items-center justify-between ${
                                isUnavailable
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                  : 'hover:bg-gray-100'
                              }`}
                              onClick={() => {
                                setMeetingFormData(prev => ({ ...prev, helper: emp.display_name }));
                                setHelperSearchTerm('');
                                setShowHelperDropdown(false);
                              }}
                            >
                              <span>{emp.display_name}</span>
                              {isUnavailable && (
                                <div className="flex items-center gap-1">
                                  <ClockIcon className="w-4 h-4" />
                                  <span className="text-xs">Unavailable</span>
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="px-4 py-2 text-gray-500 text-center">
                          No employees found
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Extra fields only for Paid meeting - COMMENTED OUT */}
              {/* {meetingType === 'paid' && (
                <>
                  <div>
                    <label className="block font-semibold mb-1">Meeting collection manager</label>
                    <input
                      type="text"
                      className="input input-bordered w-full"
                      placeholder="Select a collection manager..."
                      list="meeting-collection-manager-options"
                      value={meetingFormData.collection_manager}
                      onChange={(e) =>
                        setMeetingFormData(prev => ({ ...prev, collection_manager: e.target.value }))
                      }
                    />
                    <datalist id="meeting-collection-manager-options">
                      {allEmployees.map(emp => (
                        <option key={emp.id} value={emp.display_name} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Paid meeting category</label>
                    <select
                      className="select select-bordered w-full"
                      value={meetingFormData.paid_category}
                      onChange={(e) =>
                        setMeetingFormData(prev => ({ ...prev, paid_category: e.target.value }))
                      }
                    >
                      <option value="">Please choose</option>
                      {categoryOptions
                        .filter(opt => {
                          const labelLower = opt.label.toLowerCase();
                          const mainName =
                            (opt.raw as any)?.misc_maincategory?.name?.toLowerCase?.() || '';
                          return (
                            labelLower.includes('paid meeting') ||
                            mainName.includes('paid meeting') ||
                            labelLower.includes('paid') ||
                            mainName.includes('paid')
                          );
                        })
                        .map(opt => (
                          <option key={opt.id} value={opt.label}>
                            {opt.label}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Paid meeting currency</label>
                    <select
                      className="select select-bordered w-full"
                      value={meetingFormData.paid_currency}
                      onChange={(e) =>
                        setMeetingFormData(prev => ({ ...prev, paid_currency: e.target.value }))
                      }
                    >
                      <option value="">Please choose</option>
                      {currencies.map((currency: any) => (
                        <option key={currency.id} value={currency.front_name || currency.iso_code}>
                          {currency.front_name || currency.iso_code || currency.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Meeting total</label>
                    <input
                      type="number"
                      className="input input-bordered w-full no-arrows"
                      placeholder="Enter total amount..."
                      value={meetingFormData.meeting_total}
                      onChange={(e) =>
                        setMeetingFormData(prev => ({
                          ...prev,
                          meeting_total: e.target.value,
                        }))
                      }
                      min="0"
                      step="0.01"
                    />
                  </div>
                </>
              )} */}

              {/* Meeting Attendance Probability */}
              <div>
                <label className="block font-semibold mb-1">Meeting Attendance Probability</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingFormData.attendance_probability}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, attendance_probability: e.target.value }))}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Very High">Very High</option>
                </select>
              </div>

              {/* Meeting Complexity */}
              <div>
                <label className="block font-semibold mb-1">Meeting Complexity</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingFormData.complexity}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, complexity: e.target.value }))}
                >
                  <option value="Simple">Simple</option>
                  <option value="Complex">Complex</option>
                </select>
              </div>

              {/* Meeting Car Number */}
              <div>
                <label htmlFor="car-number" className="block font-semibold mb-1">Meeting Car Number</label>
                <input
                  id="car-number"
                  type="text"
                  className="input input-bordered w-full"
                  value={meetingFormData.car_number}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, car_number: e.target.value }))}
                  placeholder="Enter car number..."
                />
              </div>
              </div>
            </div>
            
            {/* Fixed Footer */}
            <div className="p-8 pt-4 border-t border-base-300 bg-base-100">
              <div className="flex justify-end">
                <button 
                  className="btn btn-primary px-8" 
                  onClick={handleScheduleMeeting}
                  disabled={!meetingFormData.date || !meetingFormData.time || isCreatingMeeting}
                >
                  {isCreatingMeeting ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Creating Meeting...
                    </>
                  ) : (
                    'Create Meeting'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Update Lead Drawer */}
      {showUpdateDrawer && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => setShowUpdateDrawer(false)}
          />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl flex flex-col animate-slideInRight z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
            {/* Header */}
            <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0 border-b border-base-300">
              <h3 className="text-2xl font-bold">Update Lead</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowUpdateDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 pt-4">
              <div className="flex flex-col gap-4">
                <div>
                  <label htmlFor="meeting-notes" className="block font-semibold mb-1">Meeting scheduling notes:</label>
                  <textarea
                    id="meeting-notes"
                    name="meeting-notes"
                    className="textarea textarea-bordered w-full min-h-[120px]"
                    value={meetingNotes}
                    onChange={e => setMeetingNotes(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Next followup:</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={nextFollowup}
                    onChange={e => setNextFollowup(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="followup-notes" className="block font-semibold mb-1">Followup:</label>
                  <textarea
                    id="followup-notes"
                    name="followup-notes"
                    className="textarea textarea-bordered w-full min-h-[120px]"
                    value={followup}
                    onChange={e => setFollowup(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Potential applicants:</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={potentialApplicants}
                    onChange={e => setPotentialApplicants(e.target.value)}
                  />
                </div>
              </div>
            </div>
            {/* Fixed Save Button */}
            <div className="p-6 pt-4 border-t border-base-300 flex-shrink-0 bg-base-100" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 0))' }}>
              <button
                className="btn btn-primary w-full text-lg font-semibold"
                onClick={handleSaveUpdateDrawer}
                disabled={isSavingUpdate}
              >
                {isSavingUpdate ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Meeting Ended Drawer */}
      {showMeetingEndedDrawer && (
        <div className="fixed inset-0 z-[60] flex">
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => setShowMeetingEndedDrawer(false)}
          />
          <div className="ml-auto w-full max-w-lg bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Update Lead</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowMeetingEndedDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              {/* Probability */}
              <div>
                <label className="block font-semibold mb-1">Probability: {meetingEndedData.probability}%</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={meetingEndedData.probability}
                  onChange={e => handleMeetingEndedChange('probability', Number(e.target.value))}
                  className="range range-primary"
                />
              </div>
              {/* Meeting Brief */}
              <div>
                <label className="block font-semibold mb-1">Meeting Brief:</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[120px]"
                  value={meetingEndedData.meetingBrief}
                  onChange={e => handleMeetingEndedChange('meetingBrief', e.target.value)}
                />
              </div>
              {/* Number of applicants */}
              <div>
                <label className="block font-semibold mb-1">Number of applicants:</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={meetingEndedData.numberOfApplicants}
                  onChange={e => handleMeetingEndedChange('numberOfApplicants', Number(e.target.value))}
                />
              </div>
              {/* Proposal Total */}
              <div>
                <label className="block font-semibold mb-1">Proposal Total:</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={meetingEndedData.proposalTotal}
                  onFocus={(e) => e.target.select()}
                  onChange={e => {
                    // Only allow numbers and decimal point
                    let value = e.target.value.replace(/[^0-9.]/g, '');
                    // Prevent multiple decimal points
                    const parts = value.split('.');
                    if (parts.length > 2) {
                      value = parts[0] + '.' + parts.slice(1).join('');
                    }
                    handleMeetingEndedChange('proposalTotal', value);
                  }}
                />
              </div>
              {/* Currency */}
              <div>
                <label className="block font-semibold mb-1">Currency:</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingEndedData.proposalCurrency}
                  onChange={e => handleMeetingEndedChange('proposalCurrency', e.target.value)}
                >
                  {currencies.length > 0 ? (
                    currencies.map((currency) => (
                      <option key={currency.id} value={currency.iso_code || currency.name}>
                        {currency.name || currency.iso_code}
                      </option>
                    ))
                  ) : (
                    <>
                      <option>NIS</option>
                      <option>USD</option>
                      <option>EUR</option>
                    </>
                  )}
                </select>
              </div>
              {/* Meeting Total */}
              <div>
                <label className="block font-semibold mb-1">Meeting Total:</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={meetingEndedData.meetingTotal}
                  onFocus={(e) => e.target.select()}
                  onChange={e => {
                    // Only allow numbers and decimal point
                    let value = e.target.value.replace(/[^0-9.]/g, '');
                    // Prevent multiple decimal points
                    const parts = value.split('.');
                    if (parts.length > 2) {
                      value = parts[0] + '.' + parts.slice(1).join('');
                    }
                    handleMeetingEndedChange('meetingTotal', value);
                  }}
                />
              </div>
              {/* Meeting total currency */}
              <div>
                <label className="block font-semibold mb-1">Meeting total currency:</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingEndedData.meetingTotalCurrency}
                  onChange={e => handleMeetingEndedChange('meetingTotalCurrency', e.target.value)}
                >
                  {currencies.length > 0 ? (
                    currencies.map((currency) => (
                      <option key={currency.id} value={currency.iso_code || currency.name}>
                        {currency.name || currency.iso_code}
                      </option>
                    ))
                  ) : (
                    <>
                      <option>NIS</option>
                      <option>USD</option>
                      <option>EUR</option>
                    </>
                  )}
                </select>
              </div>
              {/* Meeting Payment form */}
              <div>
                <label className="block font-semibold mb-1">Meeting Payment form:</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingEndedData.meetingPaymentForm}
                  onChange={e => handleMeetingEndedChange('meetingPaymentForm', e.target.value)}
                >
                  <option value="">---------</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
              {/* Special notes */}
              <div>
                <label className="block font-semibold mb-1">Special notes:</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[120px]"
                  value={meetingEndedData.specialNotes}
                  onChange={e => handleMeetingEndedChange('specialNotes', e.target.value)}
                />
              </div>
              {/* Potential applicants */}
              <div>
                <label className="block font-semibold mb-1">Potential applicants:</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={meetingEndedData.potentialApplicants}
                  onChange={e => handleMeetingEndedChange('potentialApplicants', Number(e.target.value))}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-between items-center mt-6">
                <button
                  className="btn btn-error gap-2"
                  onClick={handleMeetingIrrelevant}
                  disabled={isSavingMeetingEnded}
                >
                  <HandThumbDownIcon className="w-5 h-5" />
                  Meeting Irrelevant
                </button>
                <button
                  className="btn btn-success gap-2"
                  onClick={handleSendPriceOffer}
                  disabled={isSavingMeetingEnded}
                >
                  {isSavingMeetingEnded ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : (
                    <DocumentCheckIcon className="w-5 h-5" />
                  )}
                  I have to send Price offer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showMeetingIrrelevantModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => {
              if (!isProcessingMeetingIrrelevant) {
                handleCancelMeetingIrrelevant();
              }
            }}
          />
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full mx-4 z-10">
            <div className="flex items-center justify-between mb-6">
              <h3 className="flex items-center gap-3 text-2xl font-bold text-gray-900">
                <ExclamationTriangleIcon className="w-7 h-7 text-red-500" />
                Mark Lead as Irrelevant
              </h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleCancelMeetingIrrelevant}
                disabled={isProcessingMeetingIrrelevant}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-5">
              <p className="text-sm text-red-600 leading-relaxed">
                Marking this lead as irrelevant should only be done when you are certain there is no legal eligibility. If you are unsure, please click cancel.
              </p>

              <div>
                <label className="block font-semibold mb-2 text-gray-900">Reason for this action</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[120px]"
                  placeholder="Provide details about why this lead is irrelevant..."
                  value={meetingIrrelevantReason}
                  onChange={(e) => setMeetingIrrelevantReason(e.target.value)}
                  disabled={isProcessingMeetingIrrelevant}
                />
                <p className="text-xs text-gray-500 mt-2">
                  This reason will be saved to the lead history for future reference.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                className="btn btn-outline"
                onClick={handleCancelMeetingIrrelevant}
                disabled={isProcessingMeetingIrrelevant}
              >
                Cancel
              </button>
              <button
                className="btn btn-error"
                onClick={handleConfirmMeetingIrrelevant}
                disabled={isProcessingMeetingIrrelevant || !meetingIrrelevantReason.trim()}
              >
                {isProcessingMeetingIrrelevant ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Signed Drawer (New) */}
      {showSuccessDrawer && (
        <div className="fixed inset-0 z-[60] flex">
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => setShowSuccessDrawer(false)}
          />
          <div className="ml-auto w-full max-w-lg bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="text-3xl font-black tracking-tight text-primary">Client signed !!!!</h3>
                <p className="mt-2 text-lg font-semibold text-base-content">
                  Name: <span className="font-bold">{selectedClient?.name || '—'}</span>
                </p>
                <p className="text-lg font-semibold text-base-content">
                  Topic: <span className="font-bold">{selectedClient?.topic || '—'}</span>
                </p>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowSuccessDrawer(false)}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="flex flex-col gap-5 flex-1 overflow-y-auto">
              <div>
                <label className="block font-semibold mb-1">File ID</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={successForm.fileId}
                  onChange={e => handleSuccessFieldChange('fileId', e.target.value)}
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Case handler</label>
                <div ref={handlerSearchContainerRef} className="relative">
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="Type case handler name or choose from suggestions..."
                    value={handlerSearchTerm}
                    onChange={e => {
                      const value = e.target.value;
                      setHandlerSearchTerm(value);
                      setShowHandlerSearchDropdown(true);
                      setSuccessForm(prev => ({
                        ...prev,
                        handler: value,
                        handlerId: '',
                      }));
                    }}
                    onFocus={() => {
                      setShowHandlerSearchDropdown(true);
                      setFilteredHandlerSearchOptions(handlerOptions);
                    }}
                    autoComplete="off"
                  />
                  {showHandlerSearchDropdown && (
                    <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-base-300 bg-base-100 shadow-2xl">
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                        onClick={() => {
                          setSuccessForm(prev => ({
                            ...prev,
                            handlerId: '',
                            handler: '',
                          }));
                          setHandlerSearchTerm('');
                          setShowHandlerSearchDropdown(false);
                        }}
                      >
                        ---------
                      </button>
                      {filteredHandlerSearchOptions.length > 0 ? (
                        filteredHandlerSearchOptions.map(option => (
                          <button
                            type="button"
                            key={option.id}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-primary/10"
                            onClick={() => {
                              setSuccessForm(prev => ({
                                ...prev,
                                handlerId: option.id,
                                handler: option.label,
                              }));
                              setHandlerSearchTerm(option.label);
                              setShowHandlerSearchDropdown(false);
                            }}
                          >
                            {option.label}
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-sm text-base-content/60">
                          No handlers found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">Currency</label>
                <select
                  className="select select-bordered w-full"
                  value={successForm.currency}
                  onChange={e => handleSuccessFieldChange('currency', e.target.value)}
                >
                  {currencyOptions.map(currency => (
                    <option key={currency.value} value={currency.value}>
                      {currency.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1">Number of applicants</label>
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={successForm.numApplicants}
                  onChange={e => handleSuccessFieldChange('numApplicants', e.target.value)}
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Proposal Total</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={successForm.proposal}
                  onChange={e => handleSuccessFieldChange('proposal', e.target.value)}
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Potential Value</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={successForm.potentialValue}
                  onChange={e => handleSuccessFieldChange('potentialValue', e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                className="btn btn-ghost"
                onClick={() => setShowSuccessDrawer(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary px-8"
                onClick={handleSaveSuccessDrawer}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Signed Drawer */}
      {showSignedDrawer && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowSignedDrawer(false)} />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Client Signed Agreement</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSignedDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">Date Signed</label>
                <input type="date" className="input input-bordered w-full" value={signedDate} onChange={e => setSignedDate(e.target.value)} />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSaveSignedDrawer}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Declined Drawer */}
      {showDeclinedDrawer && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowDeclinedDrawer(false)} />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Client Declined</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDeclinedDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-6 flex-1">
              {isSuperuser ? (
                <>
                  <div className="alert alert-warning">
                    <ExclamationTriangleIcon className="w-6 h-6" />
                    <div>
                      <h4 className="font-bold">Important Notice</h4>
                      <p>Please contact your supervisor before choosing this option.</p>
                    </div>
                  </div>
                  <div className="text-base-content/80">
                    <p>Are you sure you want to mark this client as declined?</p>
                    <p className="mt-2 text-sm">This action will change the lead stage to "Client declined".</p>
                  </div>
                  {!isAdmin && !isAdminLoading && (
                    <div className="alert alert-error">
                      <ExclamationTriangleIcon className="w-6 h-6" />
                      <div>
                        <h4 className="font-bold">Access Restricted</h4>
                        <p>Only administrators can decline clients. Please contact your supervisor.</p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="alert alert-warning">
                  <ExclamationTriangleIcon className="w-6 h-6" />
                  <div>
                    <h4 className="font-bold">Access Restricted</h4>
                    <p>You do not have access to perform this action. Please contact a manager or admin for assistance.</p>
                  </div>
                </div>
              )}
            </div>
            {isSuperuser && (
              <div className="mt-6 flex gap-3 justify-end">
                <button className="btn btn-ghost" onClick={() => setShowDeclinedDrawer(false)}>
                  Cancel
                </button>
                {isAdmin && (
                  <button className="btn btn-error" onClick={handleConfirmDeclined}>
                    Yes, decline client
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Lead Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => !isDeletingLead && setShowDeleteModal(false)} />
          <div className="relative bg-base-100 rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-error">Delete Lead</h3>
              <button 
                className="btn btn-ghost btn-sm btn-circle" 
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeletingLead}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div className="alert alert-error">
                <ExclamationTriangleIcon className="w-6 h-6" />
                <div>
                  <h4 className="font-bold">Warning: This action cannot be undone!</h4>
                  <p>Are you sure you want to delete this lead? This will permanently remove the lead and all associated data.</p>
                </div>
              </div>
              {selectedClient && (
                <div className="bg-base-200 rounded-lg p-4">
                  <p className="font-semibold">Lead: {selectedClient.lead_number || selectedClient.id}</p>
                  <p className="text-base-content/70">Name: {selectedClient.name || '---'}</p>
                </div>
              )}
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <button 
                className="btn btn-ghost" 
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeletingLead}
              >
                Cancel
              </button>
              <button 
                className="btn btn-error" 
                onClick={handleDeleteLead}
                disabled={isDeletingLead}
              >
                {isDeletingLead ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Deleting...
                  </>
                ) : (
                  'Yes, delete lead'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Lead Drawer */}
      {showEditLeadDrawer && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowEditLeadDrawer(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Edit Lead</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowEditLeadDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
              <div>
                <label className="block font-semibold mb-1">Tags</label>
                <input 
                  type="text" 
                  className="input input-bordered w-full" 
                  placeholder="Search or select tags..."
                  value={editLeadData.tags} 
                  onChange={e => handleEditLeadChange('tags', e.target.value)}
                  list="tags-options"
                />
                <datalist id="tags-options">
                  {tagsList.map((name, index) => (
                    <option key={`${name}-${index}`} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block font-semibold mb-1">Source</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Search or select a source..."
                  value={editLeadData.source}
                  onChange={e => handleEditLeadChange('source', e.target.value)}
                  list="source-options"
                />
                <datalist id="source-options">
                  {sources.map((name, index) => (
                    <option key={`${name}-${index}`} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block font-semibold mb-1">Client Name</label>
                <input type="text" className="input input-bordered w-full" value={editLeadData.name} onChange={e => handleEditLeadChange('name', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Language</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Search or select a language..."
                  value={editLeadData.language}
                  onChange={e => handleEditLeadChange('language', e.target.value)}
                  list="language-options"
                />
                <datalist id="language-options">
                  {languagesList.map((name, index) => (
                    <option key={`${name}-${index}`} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block font-semibold mb-1">Category</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Search or select a category..."
                  value={editLeadData.category}
                  onChange={e => handleEditLeadChange('category', e.target.value)}
                  list="category-options"
                />
                <datalist id="category-options">
                  {mainCategories.map((name, index) => (
                    <option key={`${name}-${index}`} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block font-semibold mb-1">Topic</label>
                <input type="text" className="input input-bordered w-full" value={editLeadData.topic} onChange={e => handleEditLeadChange('topic', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Special Notes</label>
                <textarea className="textarea textarea-bordered w-full min-h-[60px]" value={editLeadData.special_notes} onChange={e => handleEditLeadChange('special_notes', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Probability</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    className="range range-primary flex-1"
                    value={editLeadData.probability || 0}
                    onChange={e => handleEditLeadChange('probability', parseInt(e.target.value))}
                  />
                  <span className="text-sm font-medium text-gray-700 min-w-[50px] text-right">
                    {editLeadData.probability || 0}%
                  </span>
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Number of Applicants</label>
                <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.number_of_applicants_meeting} onChange={e => handleEditLeadChange('number_of_applicants_meeting', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Potential Applicants</label>
                <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.potential_applicants_meeting} onChange={e => handleEditLeadChange('potential_applicants_meeting', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Balance (Amount)</label>
                <input type="number" min="0" className="input input-bordered w-full" value={editLeadData.balance} onChange={e => handleEditLeadChange('balance', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Follow Up Date</label>
                <input type="date" className="input input-bordered w-full" value={editLeadData.next_followup} onChange={e => handleEditLeadChange('next_followup', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Balance Currency</label>
                <select className="select select-bordered w-full" value={editLeadData.balance_currency} onChange={e => handleEditLeadChange('balance_currency', e.target.value)}>
                  {currencies.length > 0 ? (
                    <>
                      {/* Show current currency first */}
                      {currencies
                        .filter(currency => currency.name === editLeadData.balance_currency)
                        .map((currency) => (
                          <option key={`current-${currency.id}`} value={currency.name}>
                            {currency.name} ({currency.iso_code})
                          </option>
                        ))
                      }
                      {/* Show other currencies */}
                      {currencies
                        .filter(currency => currency.name !== editLeadData.balance_currency)
                        .map((currency) => (
                          <option key={currency.id} value={currency.name}>
                            {currency.name} ({currency.iso_code})
                          </option>
                        ))
                      }
                    </>
                  ) : (
                    <option value="">Loading currencies...</option>
                  )}
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSaveEditLead}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <LeadSummaryDrawer isOpen={showLeadSummaryDrawer} onClose={() => setShowLeadSummaryDrawer(false)} client={selectedClient} />
      <SendPriceOfferModal
        isOpen={Boolean(showSendOfferModal && selectedClient)}
        onClose={() => setShowSendOfferModal(false)}
        client={selectedClient}
        msalInstance={instance}
        loginRequest={loginRequest}
        onOfferSent={onClientUpdate}
      />
      {/* Loading overlay spinner */}
      {localLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60">
          <span className="loading loading-spinner loading-lg text-primary"></span>
        </div>
      )}
      {showSubLeadDrawer && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => {
              setShowSubLeadDrawer(false);
              setSubLeadStep('initial');
              setIsSavingSubLead(false);
              setSelectedContractContactId(null);
              setSelectedContractId(null);
            }}
          />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl flex flex-col animate-slideInRight z-50">
            {/* Fixed Header */}
            <div className="flex items-center justify-between p-8 pb-6 border-b border-base-300">
              <h3 className="text-2xl font-bold">Create Sub-Lead</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowSubLeadDrawer(false);
                  setIsSavingSubLead(false);
                  setSubLeadStep('initial');
                  setSelectedContractContactId(null);
                  setSelectedContractId(null);
                }}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto p-8 pt-6">
              <div className="flex flex-col gap-4">
              {subLeadStep === 'initial' && (
                <>
                  <button
                    className="btn btn-primary mb-4"
                    onClick={() => {
                      prefillSubLeadFormFromClient();
                      setSubLeadStep('newProcedure');
                    }}
                  >
                    New Procedure (Same Contact)
                  </button>
                  <button 
                    className="btn btn-outline" 
                    onClick={() => {
                      // Pre-fill category, topic, facts, and special notes from existing client
                      const baseCategoryId = selectedClient?.category_id != null ? String(selectedClient.category_id) : '';
                      const categoryOption = baseCategoryId ? categoryOptionsMap.get(baseCategoryId) : undefined;
                      
                      setSubLeadForm({
                        name: '',
                        email: '',
                        phone: '',
                        mobile: '',
                        country: '',
                        countryId: '',
                        category: categoryOption?.label || selectedClient?.category || '',
                        categoryId: baseCategoryId || '',
                        topic: selectedClient?.topic || '',
                        special_notes: selectedClient?.special_notes || '',
                        source: '',
                        language: '',
                        tags: '',
                        facts: selectedClient?.facts || '',
                        handler: '',
                        handlerId: '',
                        currency: 'NIS',
                        numApplicants: '',
                        proposal: '',
                        potentialValue: '',
                      });
                      setSubLeadStep('newContact');
                    }}
                  >
                    Add New Contact
                  </button>
                  {/* Same Contract buttons - one for each contact with a contract */}
                  {contactsWithContracts.map((item) => (
                    <button
                      key={item.contactId}
                      className="btn btn-outline btn-success"
                      onClick={() => {
                        setSelectedContractContactId(item.contactId);
                        setSelectedContractId(item.contractId);
                        // Pre-fill form with client data
                        const baseCategoryId = selectedClient?.category_id != null ? String(selectedClient.category_id) : '';
                        const countryIdValue = item.contactCountryId ?? selectedClient?.country_id ?? '';
                        const countryIdString =
                          countryIdValue !== null && countryIdValue !== undefined ? String(countryIdValue) : '';
                        setSubLeadForm({
                          name: item.contactName,
                          email: item.contactEmail || selectedClient?.email || '',
                          phone: item.contactPhone || selectedClient?.phone || '',
                          mobile: item.contactMobile || selectedClient?.mobile || '',
                          country: '',
                          countryId: countryIdString,
                          category: selectedClient?.category || '',
                          categoryId: baseCategoryId || '',
                          topic: selectedClient?.topic || '',
                          special_notes: selectedClient?.special_notes || '',
                          source: '',
                          language: selectedClient?.language || '',
                          tags: '',
                          facts: selectedClient?.facts || '',
                          handler: '',
                          handlerId: '',
                          currency: 'NIS',
                          numApplicants: '',
                          proposal: '',
                          potentialValue: '',
                        });
                        setSubLeadStep('sameContract');
                      }}
                    >
                      Same Contract - {item.contactName}
                    </button>
                  ))}
                </>
              )}
              {subLeadStep === 'newContact' && (
                <>
                  <label className="block font-semibold mb-1">Category</label>
                  <div className="relative">
                    <input
                      type="text"
                      className="input input-bordered w-full pr-10"
                      value={subLeadForm.category}
                      onChange={e => {
                        const value = e.target.value;
                        setSubLeadForm(f => ({ ...f, category: value, categoryId: '' }));
                      }}
                      placeholder="Type to search categories..."
                    />
                    {subLeadForm.category && (
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setSubLeadForm(f => ({ ...f, category: '', categoryId: '' }))}
                      >
                        ✕
                      </button>
                    )}
                    {subLeadForm.category && !subLeadForm.categoryId && (
                      <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {categoryOptions
                          .filter(opt => opt.label.toLowerCase().includes(subLeadForm.category.toLowerCase()))
                          .slice(0, 10)
                          .map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                              onClick={() => {
                                setSubLeadForm(f => ({
                                  ...f,
                                  categoryId: opt.id,
                                  category: opt.label
                                }));
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                  <label className="block font-semibold mb-1 mt-4">Topic</label>
                  <input 
                    className="input input-bordered w-full" 
                    value={subLeadForm.topic}
                    onChange={e => setSubLeadForm(f => ({ ...f, topic: e.target.value }))}
                    placeholder="Enter topic"
                  />
                  <label className="block font-semibold mb-1">Client Name</label>
                  <input 
                    className="input input-bordered w-full" 
                    value={subLeadForm.name}
                    onChange={e => setSubLeadForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Enter client name"
                  />
                  <label className="block font-semibold mb-1">Language</label>
                  <select
                    className="select select-bordered w-full"
                    value={subLeadForm.language}
                    onChange={e => setSubLeadForm(f => ({ ...f, language: e.target.value }))}
                  >
                    <option value="">Select language...</option>
                    {allLanguages.map(lang => (
                      <option key={lang.id} value={lang.name || ''}>
                        {lang.name || 'Unknown'}
                      </option>
                    ))}
                  </select>
                  <label className="block font-semibold mb-1">Facts of Case</label>
                  <textarea 
                    className="textarea textarea-bordered w-full" 
                    value={subLeadForm.facts}
                    onChange={e => setSubLeadForm(f => ({ ...f, facts: e.target.value }))}
                    placeholder="Enter facts of the case"
                    rows={4}
                  />
                  <label className="block font-semibold mb-1">Special Notes</label>
                  <textarea 
                    className="textarea textarea-bordered w-full" 
                    value={subLeadForm.special_notes}
                    onChange={e => setSubLeadForm(f => ({ ...f, special_notes: e.target.value }))}
                    placeholder="Enter special notes"
                    rows={4}
                  />
                </>
              )}
              {subLeadStep === 'newContactDetails' && (
                <>
                  <label className="block font-semibold mb-1">Name *</label>
                  <input 
                    className="input input-bordered w-full" 
                    value={subLeadForm.name}
                    onChange={e => setSubLeadForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Enter contact name"
                  />
                  <label className="block font-semibold mb-1">Mobile</label>
                  <div className="flex gap-2">
                    <select
                      className="select select-bordered w-40"
                      value={parsePhoneNumber(subLeadForm.mobile).countryCode}
                      onChange={(e) => {
                        const currentMobile = subLeadForm.mobile || '';
                        const currentParsed = parsePhoneNumber(currentMobile);
                        const newNumber = currentParsed.number ? formatPhoneNumber(e.target.value, currentParsed.number) : e.target.value;
                        setSubLeadForm(f => ({ ...f, mobile: newNumber }));
                      }}
                    >
                      {countryCodes.map((code) => (
                        <option key={`${code.code}-${code.country}`} value={code.code}>
                          {code.code} {code.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      placeholder="Enter mobile number"
                      className="input input-bordered flex-1"
                      value={parsePhoneNumber(subLeadForm.mobile).number}
                      onChange={(e) => {
                        const { countryCode } = parsePhoneNumber(subLeadForm.mobile);
                        setSubLeadForm(f => ({ ...f, mobile: formatPhoneNumber(countryCode, e.target.value) }));
                      }}
                    />
                  </div>
                  <label className="block font-semibold mb-1">Phone</label>
                  <div className="flex gap-2">
                    <select
                      className="select select-bordered w-40"
                      value={parsePhoneNumber(subLeadForm.phone).countryCode}
                      onChange={(e) => {
                        const currentPhone = subLeadForm.phone || '';
                        const currentParsed = parsePhoneNumber(currentPhone);
                        const newNumber = currentParsed.number ? formatPhoneNumber(e.target.value, currentParsed.number) : e.target.value;
                        setSubLeadForm(f => ({ ...f, phone: newNumber }));
                      }}
                    >
                      {countryCodes.map((code) => (
                        <option key={`${code.code}-${code.country}`} value={code.code}>
                          {code.code} {code.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      placeholder="Enter phone number"
                      className="input input-bordered flex-1"
                      value={parsePhoneNumber(subLeadForm.phone).number}
                      onChange={(e) => {
                        const { countryCode } = parsePhoneNumber(subLeadForm.phone);
                        setSubLeadForm(f => ({ ...f, phone: formatPhoneNumber(countryCode, e.target.value) }));
                      }}
                    />
                  </div>
                  <label className="block font-semibold mb-1">Email</label>
                  <input 
                    className="input input-bordered w-full" 
                    value={subLeadForm.email}
                    onChange={e => setSubLeadForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="Enter email address"
                    type="email"
                  />
                  <label className="block font-semibold mb-1">Country</label>
                  <select
                    className="select select-bordered w-full"
                    value={subLeadForm.country}
                    onChange={e => {
                      const countryName = e.target.value;
                      const countryId = allCountries.find(c => c.name === countryName)?.id || '';
                      setSubLeadForm(f => ({ ...f, country: countryName, countryId: countryId.toString() }));
                    }}
                  >
                    <option value="">Select country...</option>
                    {allCountries.map(country => (
                      <option key={country.id} value={country.name}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {subLeadStep === 'sameContract' && (
                <>
                  <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm text-blue-800">
                      <strong>Contract:</strong> {contactContracts[selectedContractContactId || 0]?.contractName || 'Contract'} - {contactContracts[selectedContractContactId || 0]?.contactName || 'Contact'}
                    </p>
                  </div>
                  <label className="block font-semibold mb-1">Category</label>
                  <div className="relative">
                    <input
                      type="text"
                      className="input input-bordered w-full pr-10"
                      value={subLeadForm.category}
                      onChange={e => {
                        const value = e.target.value;
                        setSubLeadForm(f => ({ ...f, category: value, categoryId: '' }));
                      }}
                      placeholder="Type to search categories..."
                    />
                    {subLeadForm.category && (
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setSubLeadForm(f => ({ ...f, category: '', categoryId: '' }))}
                      >
                        ✕
                      </button>
                    )}
                    {subLeadForm.category && !subLeadForm.categoryId && (
                      <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {categoryOptions
                          .filter(opt => opt.label.toLowerCase().includes(subLeadForm.category.toLowerCase()))
                          .slice(0, 10)
                          .map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                              onClick={() => {
                                setSubLeadForm(f => ({
                                  ...f,
                                  categoryId: opt.id,
                                  category: opt.label
                                }));
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                  <label className="block font-semibold mb-1">Name</label>
                  <input
                    className="input input-bordered w-full"
                    value={subLeadForm.name}
                    onChange={e => setSubLeadForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Enter client name"
                  />
                  <label className="block font-semibold mb-1">Language</label>
                  <select
                    className="select select-bordered w-full"
                    value={subLeadForm.language}
                    onChange={e => setSubLeadForm(f => ({ ...f, language: e.target.value }))}
                  >
                    <option value="">Select language...</option>
                    {allLanguages.map(lang => (
                      <option key={lang.id} value={lang.name || ''}>
                        {lang.name || 'Unknown'}
                      </option>
                    ))}
                  </select>
                  <label className="block font-semibold mb-1">Facts of Case</label>
                  <textarea 
                    className="textarea textarea-bordered w-full" 
                    value={subLeadForm.facts}
                    onChange={e => setSubLeadForm(f => ({ ...f, facts: e.target.value }))}
                    placeholder="Enter facts of the case"
                    rows={4}
                  />
                  <label className="block font-semibold mb-1">Special Notes</label>
                  <textarea 
                    className="textarea textarea-bordered w-full" 
                    value={subLeadForm.special_notes}
                    onChange={e => setSubLeadForm(f => ({ ...f, special_notes: e.target.value }))}
                    placeholder="Enter special notes"
                    rows={4}
                  />
                </>
              )}
              {subLeadStep === 'newProcedure' && (
                <>
                  <label className="block font-semibold mb-1">Category</label>
                  <div className="relative">
                    <input
                      type="text"
                      className="input input-bordered w-full pr-10"
                      value={subLeadForm.category}
                      onChange={e => {
                        const value = e.target.value;
                        setSubLeadForm(f => ({ ...f, category: value, categoryId: '' }));
                      }}
                      placeholder="Type to search categories..."
                    />
                    {subLeadForm.category && (
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setSubLeadForm(f => ({ ...f, category: '', categoryId: '' }))}
                      >
                        ✕
                      </button>
                    )}
                    {subLeadForm.category && !subLeadForm.categoryId && (
                      <div className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {categoryOptions
                          .filter(opt => opt.label.toLowerCase().includes(subLeadForm.category.toLowerCase()))
                          .slice(0, 10)
                          .map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                              onClick={() => {
                                setSubLeadForm(f => ({
                                  ...f,
                                  categoryId: opt.id,
                                  category: opt.label
                                }));
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                  <label className="block font-semibold mb-1 mt-4">Topic</label>
                  <input 
                    className="input input-bordered w-full" 
                    value={subLeadForm.topic}
                    onChange={e => setSubLeadForm(f => ({ ...f, topic: e.target.value }))}
                    placeholder="Enter topic"
                  />
                  <label className="block font-semibold mb-1">Client Name</label>
                  <input 
                    className="input input-bordered w-full" 
                    value={subLeadForm.name}
                    onChange={e => setSubLeadForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Enter client name"
                  />
                  <label className="block font-semibold mb-1">Language</label>
                  <select
                    className="select select-bordered w-full"
                    value={subLeadForm.language}
                    onChange={e => setSubLeadForm(f => ({ ...f, language: e.target.value }))}
                  >
                    <option value="">Select language...</option>
                    {allLanguages.map(lang => (
                      <option key={lang.id} value={lang.name || ''}>
                        {lang.name || 'Unknown'}
                      </option>
                    ))}
                  </select>
                  <label className="block font-semibold mb-1">Facts of Case</label>
                  <textarea 
                    className="textarea textarea-bordered w-full" 
                    value={subLeadForm.facts}
                    onChange={e => setSubLeadForm(f => ({ ...f, facts: e.target.value }))}
                    placeholder="Enter facts of the case"
                    rows={4}
                  />
                  <label className="block font-semibold mb-1">Special Notes</label>
                  <textarea 
                    className="textarea textarea-bordered w-full" 
                    value={subLeadForm.special_notes}
                    onChange={e => setSubLeadForm(f => ({ ...f, special_notes: e.target.value }))}
                    placeholder="Enter special notes"
                    rows={4}
                  />
                </>
              )}
              {subLeadStep === 'details' && (
                <>
                  <label className="block font-semibold mb-1">Handler</label>
                  <select
                    className="select select-bordered w-full"
                    value={subLeadForm.handlerId}
                    onChange={e => {
                      const value = e.target.value;
                      setSubLeadForm(f => ({
                        ...f,
                        handlerId: value,
                        handler: handlerOptionsMap.get(value) || '',
                      }));
                    }}
                  >
                    <option value="">Select handler...</option>
                    {handlerOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <label className="block font-semibold mb-1">Currency</label>
                  <select className="select select-bordered w-full" value={subLeadForm.currency} onChange={e => setSubLeadForm(f => ({ ...f, currency: e.target.value }))}>
                    <option value="NIS">NIS</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                  <label className="block font-semibold mb-1">Number of Applicants</label>
                  <input className="input input-bordered w-full" value={subLeadForm.numApplicants} onChange={e => setSubLeadForm(f => ({ ...f, numApplicants: e.target.value }))} />
                  <label className="block font-semibold mb-1">Proposal (Amount Total)</label>
                  <input className="input input-bordered w-full" value={subLeadForm.proposal} onChange={e => setSubLeadForm(f => ({ ...f, proposal: e.target.value }))} />
                  <label className="block font-semibold mb-1">Potential Value</label>
                  <input className="input input-bordered w-full" value={subLeadForm.potentialValue} onChange={e => setSubLeadForm(f => ({ ...f, potentialValue: e.target.value }))} />
                </>
              )}
              </div>
            </div>
            {/* Fixed Footer with Action Button */}
            {subLeadStep === 'newContact' && (
              <div className="border-t border-base-300 p-4 bg-base-100">
                <button 
                  className="btn btn-primary w-full" 
                  onClick={() => setSubLeadStep('newContactDetails')}
                >
                  Next: Contact Details
                </button>
              </div>
            )}
            {(subLeadStep === 'newContactDetails' || subLeadStep === 'sameContract' || subLeadStep === 'newProcedure' || subLeadStep === 'details') && (
              <div className="border-t border-base-300 p-4 bg-base-100">
                <button 
                  className="btn btn-primary w-full" 
                  onClick={handleSaveSubLead} 
                  disabled={isSavingSubLead}
                >
                  {isSavingSubLead 
                    ? (subLeadStep === 'details' ? 'Saving...' : 'Creating...') 
                    : (subLeadStep === 'details' ? 'Save Sub-Lead' : 'Create Sub-Lead')
                  }
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activation Modal */}
      {showActivationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowActivationModal(false)} />
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 z-10">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Activate Lead</h3>
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={() => setShowActivationModal(false)}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-6">
              <div>
                <p className="text-gray-600 mb-4">
                  Are you sure you want to activate <strong>{selectedClient?.name}</strong> (Lead #{selectedClient?.lead_number})?
                </p>
                
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircleIcon className="w-5 h-5 text-green-500" />
                    <span className="text-green-700 font-medium">
                      This will restore the lead to its previous stage: <strong>{selectedClient?.previous_stage ? getStageName(selectedClient.previous_stage) : 'Created'}</strong>
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <button 
                  className="btn btn-outline" 
                  onClick={() => setShowActivationModal(false)}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-success" 
                  onClick={handleActivation}
                >
                  Activate Lead
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Unactivation Modal */}
      {showUnactivationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => {
            setShowUnactivationModal(false);
            setUnactivationReason('');
            setCustomUnactivationReason('');
          }} />
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 z-10">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Unactivate Lead</h3>
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={() => {
                  setShowUnactivationModal(false);
                  setUnactivationReason('');
                  setCustomUnactivationReason('');
                }}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-6">
              <div>
                <p className="text-gray-600 mb-4">
                  Are you sure you want to unactivate <strong>{selectedClient?.name}</strong> (Lead #{selectedClient?.lead_number})?
                </p>
                
                <label className="block font-semibold mb-2 text-gray-900">Reason for Unactivation</label>
                <select 
                  className="select select-bordered w-full mb-3" 
                  value={unactivationReason}
                  onChange={(e) => setUnactivationReason(e.target.value)}
                >
                  <option value="">Select a reason...</option>
                  <option value="test">test</option>
                  <option value="spam">spam</option>
                  <option value="double - same source">double - same source</option>
                  <option value="double -diff. source">double -diff. source</option>
                  <option value="no intent">no intent</option>
                  <option value="non active category">non active category</option>
                  <option value="IrrelevantBackground">IrrelevantBackground</option>
                  <option value="incorrect contact">incorrect contact</option>
                  <option value="no legal eligibility">no legal eligibility</option>
                  <option value="no profitability">no profitability</option>
                  <option value="can't be reached">can't be reached</option>
                  <option value="expired">expired</option>
                  <option value="other">Other (Enter custom reason)</option>
                </select>
                
                {unactivationReason === 'other' && (
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="Enter custom reason..."
                    value={customUnactivationReason}
                    onChange={(e) => setCustomUnactivationReason(e.target.value)}
                  />
                )}
              </div>
              
              <div className="flex gap-3 justify-end">
                <button 
                  className="btn btn-outline" 
                  onClick={() => {
                    setShowUnactivationModal(false);
                    setUnactivationReason('');
                    setCustomUnactivationReason('');
                  }}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-error" 
                  onClick={handleUnactivation}
                  disabled={!unactivationReason.trim() || (unactivationReason === 'other' && !customUnactivationReason.trim())}
                >
                  Unactivate Lead
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Contacts Modal */}
      {isDuplicateModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-0">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setIsDuplicateModalOpen(false)}
          />
          <div className="bg-white rounded-none shadow-2xl p-4 md:p-8 w-full h-full z-10 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl md:text-2xl font-bold text-gray-900">Duplicate Contacts</h3>
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={() => setIsDuplicateModalOpen(false)}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <p className="text-sm md:text-base text-gray-600 mb-4">
                The following contacts have matching data (email, phone, or mobile) and are associated with other leads:
              </p>
              
              {/* Mobile: horizontal scroll, Desktop: 3-column grid */}
              <div className="overflow-x-auto md:overflow-x-visible -mx-2 sm:-mx-4 md:-mx-0 px-2 sm:px-4 md:px-0">
                <div className="flex md:grid md:grid-cols-3 gap-3 sm:gap-4 min-w-max md:min-w-0 pb-4">
                  {duplicateContacts.map((dup, idx) => {
                    // Helper to get stage badge
                    const getStageBadgeForDuplicate = (stage: string | number | null) => {
                      if (!stage && stage !== 0) {
                        return <span className="badge badge-outline">No Stage</span>;
                      }
                      const stageStr = String(stage);
                      const stageName = getStageName(stageStr);
                      const stageColour = getStageColour(stageStr);
                      const badgeTextColour = getContrastingTextColor(stageColour);
                      const backgroundColor = stageColour || '#3f28cd';
                      const textColor = stageColour ? badgeTextColour : '#ffffff';
                      
                      return (
                        <span
                          className="badge hover:opacity-90 transition-opacity duration-200 text-xs px-3 py-1 max-w-full"
                          style={{
                            backgroundColor,
                            borderColor: backgroundColor,
                            color: textColor,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: 'inline-block',
                          }}
                          title={stageName}
                        >
                          {stageName}
                        </span>
                      );
                    };

                    // Helper to get status icon
                    const getStatusIcon = (status: string | number | null, leadType: 'new' | 'legacy') => {
                      const isInactive = leadType === 'legacy' 
                        ? (status === 10 || status === '10' || Number(status) === 10)
                        : (status === 'inactive');
                      
                      if (isInactive) {
                        return <XCircleIcon className="h-7 w-7 text-error" title="Inactive" />;
                      } else {
                        return <CheckCircleIcon className="h-7 w-7 text-success" title="Active" />;
                      }
                    };
                    
                    // Check if lead is inactive for styling
                    const isInactive = dup.leadType === 'legacy' 
                      ? (dup.status === 10 || dup.status === '10' || Number(dup.status) === 10)
                      : (dup.status === 'inactive');
                    
                    const cardClasses = [
                      'card',
                      'shadow-lg',
                      'hover:shadow-2xl',
                      'transition-all',
                      'duration-300',
                      'ease-in-out',
                      'transform',
                      'hover:-translate-y-1',
                      'cursor-pointer',
                      'group',
                      'border',
                      isInactive ? 'bg-red-50 border-red-200' : 'bg-base-100 border-base-200',
                    ].join(' ');
                    
                    return (
                      <div key={`${dup.contactId}-${dup.leadId}-${idx}`} className="flex-shrink-0 w-80 md:w-auto md:flex-shrink">
                        <div 
                          className={cardClasses}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/clients/${dup.leadNumber}`);
                            setIsDuplicateModalOpen(false);
                          }}
                        >
                          <div className="card-body p-5 relative">
                            <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-2 gap-2">
                              <div className="flex items-center gap-2 order-2 md:order-1">
                                <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors truncate">
                                  {dup.leadName}
                                </h2>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 order-1 md:order-2">
                                {getStageBadgeForDuplicate(dup.stage)}
                                {getStatusIcon(dup.status, dup.leadType)}
                              </div>
                            </div>
                            
                            <p className="text-sm text-base-content/60 font-mono mb-4">
                              #{dup.leadNumber}
                            </p>

                            <div className="text-sm text-base-content/80 mb-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold">Contact:</span>
                                <span className="truncate font-medium">{dup.contactName}</span>
                              </div>
                            </div>

                            <div className="divider my-0"></div>

                            {(dup.category || dup.topic || dup.source) && (
                              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                                {dup.category && (
                                  <div className="flex items-center gap-2" title="Category">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                    </svg>
                                    <span className="truncate">{dup.category}</span>
                                  </div>
                                )}
                                {dup.topic && (
                                  <div className="flex items-center gap-2" title="Topic">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                    </svg>
                                    <span className="truncate">{dup.topic}</span>
                                  </div>
                                )}
                                {dup.source && (
                                  <div className="flex items-center gap-2" title="Source">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    <span className="truncate">{dup.source}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-base-200/50 flex-1">
                              <div className="mb-2">
                                <span className="badge badge-success text-xs">match</span>
                              </div>
                              <div className="grid grid-cols-1 gap-3 text-lg">
                                {dup.contactEmail && (
                                  <div className="flex items-center gap-3 min-w-0 p-3 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors" title="Email">
                                    <EnvelopeIcon className="h-6 w-6 text-primary flex-shrink-0" />
                                    <span className="truncate font-semibold">{dup.contactEmail}</span>
                                  </div>
                                )}
                                {dup.contactPhone && (
                                  <div className="flex items-center gap-3 min-w-0 p-3 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors" title="Phone">
                                    <PhoneIcon className="h-6 w-6 text-primary flex-shrink-0" />
                                    <span className="truncate font-semibold">{dup.contactPhone}</span>
                                  </div>
                                )}
                                {dup.contactMobile && (
                                  <div className="flex items-center gap-3 min-w-0 p-3 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors" title="Mobile">
                                    <PhoneIcon className="h-6 w-6 text-primary flex-shrink-0" />
                                    <span className="truncate font-semibold">{dup.contactMobile}</span>
                                  </div>
                                )}
                                {dup.contactCountry && (
                                  <div className="flex items-center gap-3 min-w-0 p-3 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors" title="Country">
                                    <MapPinIcon className="h-6 w-6 text-primary flex-shrink-0" />
                                    <span className="truncate font-semibold">{dup.contactCountry}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-gray-200">
              <button 
                className="btn btn-outline" 
                onClick={() => setIsDuplicateModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Meeting Drawer */}
      {showRescheduleDrawer && (
        <div className="fixed inset-0 z-[60] flex">
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => {
              setShowRescheduleDrawer(false);
      setNotifyClientOnReschedule(false); // Reset to default
              setMeetingToDelete(null);
              setRescheduleFormData({ date: getTomorrowDate(), time: '09:00', location: 'Teams', calendar: 'current', manager: '', helper: '', amount: '', currency: 'NIS', attendance_probability: 'Medium', complexity: 'Simple', car_number: '' });
              setRescheduleOption('cancel');
              setNotifyClientOnReschedule(false); // Reset to default
            }}
          />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl flex flex-col animate-slideInRight z-50">
            {/* Fixed Header */}
            <div className="flex items-center justify-between p-8 pb-4 border-b border-base-300">
              <h3 className="text-2xl font-bold">Reschedule Meeting</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowRescheduleDrawer(false);
      setNotifyClientOnReschedule(false); // Reset to default
                  setMeetingToDelete(null);
                  setRescheduleFormData({ date: getTomorrowDate(), time: '09:00', location: 'Teams', calendar: 'current', manager: '', helper: '', amount: '', currency: 'NIS', attendance_probability: 'Medium', complexity: 'Simple', car_number: '' });
                  setRescheduleOption('cancel');
                  setNotifyClientOnReschedule(false); // Reset to default
                }}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-8 pt-4">
              {/* Notify Client Toggle */}
              <div className="mb-6 flex items-center justify-between">
                <label className="block font-semibold text-base">Notify Client</label>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifyClientOnReschedule}
                  onChange={(e) => setNotifyClientOnReschedule(e.target.checked)}
                />
              </div>

              <div className="flex flex-col gap-4">
                {/* Select Meeting - Optional for stage 21 */}
                {(() => {
                  const currentStage = typeof selectedClient?.stage === 'number' ? selectedClient.stage : 
                                      (selectedClient?.stage ? parseInt(String(selectedClient.stage), 10) : null);
                  const isStage21 = currentStage === 21;
                  const showMeetingSelection = rescheduleMeetings.length > 0 && (rescheduleOption === 'cancel' || !isStage21);
                  
                  if (!showMeetingSelection) return null;
                  
                  return (
                    <div>
                      <label className="block font-semibold mb-1">
                        Select Meeting {isStage21 && rescheduleOption === 'reschedule' ? '(Optional)' : ''}
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={meetingToDelete || ''}
                        onChange={(e) => {
                          const meetingId = e.target.value ? parseInt(e.target.value) : null;
                          setMeetingToDelete(meetingId);
                          // Pre-fill form with selected meeting data
                          const selectedMeeting = rescheduleMeetings.find(m => m.id === meetingId);
                          if (selectedMeeting) {
                            setRescheduleFormData({
                              date: selectedMeeting.meeting_date || getTomorrowDate(),
                              time: selectedMeeting.meeting_time ? selectedMeeting.meeting_time.substring(0, 5) : '09:00',
                              location: selectedMeeting.meeting_location || 'Teams',
                              calendar: selectedMeeting.calendar_type === 'active_client' ? 'active_client' : 'current',
                              manager: selectedMeeting.meeting_manager || '',
                              helper: selectedMeeting.helper || '',
                              amount: selectedMeeting.meeting_amount?.toString() || '',
                              currency: selectedMeeting.meeting_currency || 'NIS',
                              attendance_probability: selectedMeeting.attendance_probability || 'Medium',
                              complexity: selectedMeeting.complexity || 'Simple',
                              car_number: selectedMeeting.car_number || '',
                            });
                          }
                        }}
                        required={rescheduleOption === 'cancel' || (rescheduleOption === 'reschedule' && !isStage21)}
                      >
                        <option value="">Select a meeting...</option>
                        {rescheduleMeetings.map((meeting) => (
                          <option key={meeting.id} value={meeting.id}>
                            {meeting.meeting_date} {meeting.meeting_time ? meeting.meeting_time.substring(0, 5) : ''} - {meeting.meeting_location || 'Teams'}
                          </option>
                        ))}
                      </select>
                      {isStage21 && rescheduleOption === 'reschedule' && (
                        <p className="text-sm text-gray-500 mt-1">
                          In stage 21, you can reschedule without canceling an existing meeting.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Reschedule Options */}
                <div>
                  <label className="block font-semibold mb-2">Action</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className={`btn flex-1 ${rescheduleOption === 'cancel' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setRescheduleOption('cancel')}
                    >
                      Cancel Meeting
                    </button>
                    <button
                      type="button"
                      className={`btn flex-1 ${rescheduleOption === 'reschedule' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setRescheduleOption('reschedule')}
                    >
                      Reschedule Meeting
                    </button>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    {rescheduleOption === 'cancel' 
                      ? 'Cancel the meeting and send cancellation email to client.'
                      : 'Cancel the previous meeting and create a new one. Client will be notified of both actions.'}
                  </p>
                </div>

                {/* Form fields - only show when reschedule option is selected */}
                {rescheduleOption === 'reschedule' && (
                  <>
                {/* Location */}
                <div>
                  <label className="block font-semibold mb-1">Location</label>
                  <select
                    className="select select-bordered w-full"
                    value={rescheduleFormData.location}
                    onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, location: e.target.value }))}
                  >
                    {meetingLocations.map((location) => (
                      <option key={location.id} value={location.name}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Calendar */}
                <div>
                  <label className="block font-semibold mb-1">Calendar</label>
                  <select
                    className="select select-bordered w-full"
                    value={rescheduleFormData.calendar}
                    onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, calendar: e.target.value }))}
                  >
                    <option value="current">Potential Client</option>
                  </select>
                </div>

                {/* Date */}
                <div>
                  <label className="block font-semibold mb-1">New Date</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={rescheduleFormData.date}
                    onChange={(e) => {
                      setRescheduleFormData((prev: any) => ({ ...prev, date: e.target.value }));
                      // Reset meeting counts when date changes
                      setRescheduleMeetingCountsByTime({});
                    }}
                    required
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>

                {/* Time */}
                <TimePicker
                  value={rescheduleFormData.time}
                  onChange={(time) => setRescheduleFormData((prev: any) => ({ ...prev, time }))}
                  meetingCounts={rescheduleMeetingCountsByTime}
                  label="New Time"
                />

                {/* Manager (Optional) */}
                <div>
                  <label className="block font-semibold mb-1">Manager (Optional)</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="Select a manager..."
                    list="reschedule-meeting-manager-options"
                    value={rescheduleFormData.manager}
                    onChange={(e) =>
                      setRescheduleFormData((prev: any) => ({ ...prev, manager: e.target.value }))
                    }
                  />
                  <datalist id="reschedule-meeting-manager-options">
                    {allEmployees.map(emp => (
                      <option key={emp.id} value={emp.display_name} />
                    ))}
                  </datalist>
                </div>

                {/* Helper (Optional) */}
                <div>
                  <label className="block font-semibold mb-1">Helper (Optional)</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="Select a helper..."
                    list="reschedule-meeting-helper-options"
                    value={rescheduleFormData.helper}
                    onChange={(e) =>
                      setRescheduleFormData((prev: any) => ({ ...prev, helper: e.target.value }))
                    }
                  />
                  <datalist id="reschedule-meeting-helper-options">
                    {allEmployees.map(emp => (
                      <option key={emp.id} value={emp.display_name} />
                    ))}
                  </datalist>
                </div>

                {/* Meeting Attendance Probability */}
                <div>
                  <label className="block font-semibold mb-1">Meeting Attendance Probability</label>
                  <select
                    className="select select-bordered w-full"
                    value={rescheduleFormData.attendance_probability || 'Medium'}
                    onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, attendance_probability: e.target.value }))}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Very High">Very High</option>
                  </select>
                </div>

                {/* Meeting Complexity */}
                <div>
                  <label className="block font-semibold mb-1">Meeting Complexity</label>
                  <select
                    className="select select-bordered w-full"
                    value={rescheduleFormData.complexity || 'Simple'}
                    onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, complexity: e.target.value }))}
                  >
                    <option value="Simple">Simple</option>
                    <option value="Complex">Complex</option>
                  </select>
                </div>

                {/* Meeting Car Number */}
                <div>
                  <label className="block font-semibold mb-1">Meeting Car Number</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={rescheduleFormData.car_number || ''}
                    onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, car_number: e.target.value }))}
                    placeholder="Enter car number..."
                  />
                </div>
                </>
                )}
              </div>
            </div>

            {/* Fixed Footer */}
            <div className="p-8 pt-4 border-t border-base-300 bg-base-100">
              <div className="flex justify-end gap-3">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowRescheduleDrawer(false);
      setNotifyClientOnReschedule(false); // Reset to default
                    setMeetingToDelete(null);
                    setRescheduleFormData({ date: getTomorrowDate(), time: '09:00', location: 'Teams', calendar: 'current', manager: '', helper: '', amount: '', currency: 'NIS', attendance_probability: 'Medium', complexity: 'Simple', car_number: '' });
                    setRescheduleOption('cancel');
                  }}
                >
                  Cancel
                </button>
                {rescheduleOption === 'cancel' ? (
                  <button
                    className="btn btn-primary px-8"
                    onClick={handleCancelMeeting}
                    disabled={!meetingToDelete}
                  >
                    Cancel Meeting
                  </button>
                ) : (
                  <button
                    className="btn btn-primary px-8"
                    onClick={handleRescheduleMeeting}
                    disabled={!rescheduleFormData.date || !rescheduleFormData.time || isReschedulingMeeting}
                  >
                    {isReschedulingMeeting ? (
                      <>
                        <span className="loading loading-spinner loading-sm"></span>
                        Rescheduling...
                      </>
                    ) : (
                      'Reschedule Meeting'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Balance Edit Modal */}
      <BalanceEditModal
        isOpen={isBalanceModalOpen}
        onClose={() => setIsBalanceModalOpen(false)}
        selectedClient={selectedClient}
        onUpdate={async (clientId) => {
          isBalanceUpdatingRef.current = true;
          console.log('🔒 Setting balance update flag to prevent onClientUpdate');
          try {
            await refreshClientData(clientId || selectedClient?.id);
            // Wait longer for state to fully propagate and UI to update
            await new Promise(resolve => setTimeout(resolve, 500));
            console.log('✅ Balance update complete, UI should be updated');
          } catch (error) {
            console.error('❌ Error in balance update:', error);
          } finally {
            // Clear the flag after a longer delay to ensure all updates are done
            setTimeout(() => {
              isBalanceUpdatingRef.current = false;
              console.log('🔓 Clearing balance update flag');
            }, 1500);
          }
        }}
      />
    </div>
  );
};

export default Clients;