import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { getStageColour } from '../lib/stageUtils';
import { PlayIcon, PaperAirplaneIcon, ExclamationTriangleIcon, PhoneIcon, EnvelopeIcon, ClockIcon, PencilSquareIcon, EyeIcon, FolderIcon, CurrencyDollarIcon, XMarkIcon, StarIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { updateLeadStageWithHistory, fetchStageActorInfo } from '../lib/leadStageManager';
import DocumentModal from '../components/DocumentModal';
import FinanceTab from '../components/case-manager/FinanceTab';
import SchedulerWhatsAppModal from '../components/SchedulerWhatsAppModal';
import SchedulerEmailThreadModal from '../components/SchedulerEmailThreadModal';
import EditLeadDrawer from '../components/EditLeadDrawer';
import RMQMessagesPage from './RMQMessagesPage';
import CallOptionsModal from '../components/CallOptionsModal';
import { getUSTimezoneFromPhone } from '../lib/timezoneHelpers';

interface Case {
  id: string;
  lead_number: string;
  client_name: string;
  category: string;
  stage: string;
  stage_colour?: string | null;
  assigned_date: string;
  applicants_count: number | null;
  value: number | null;
  currency: string | null;
  stageId?: number; // For filtering by stage ID
  isFirstPaymentPaid?: boolean; // Payment status for new cases
  isNewLead?: boolean; // Whether this is a new lead or legacy lead
  hasReadyToPay?: boolean; // Whether any payment has been marked as ready to pay
  hasUnpaidPayment?: boolean; // Whether there are any unpaid payments
  hasPaymentPlan?: boolean; // Whether the lead has any payment plans
  language?: string | null; // Language name
  country?: string | null; // Country name
  country_id?: number | null; // Country ID
  phone?: string | null; // Phone number
  mobile?: string | null; // Mobile number
  next_followup?: string | null; // Follow-up date
}

// Helper function to get contrasting text color based on background
const getContrastingTextColor = (hexColor?: string | null) => {
  if (!hexColor) return '#111827'; // Default to black if no color
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

const MyCasesPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newCases, setNewCases] = useState<Case[]>([]);
  const [activeCases, setActiveCases] = useState<Case[]>([]);
  const [closedCases, setClosedCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  
  // State for row selection and action menu
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isFinanceModalOpen, setIsFinanceModalOpen] = useState(false);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [showEditLeadDrawer, setShowEditLeadDrawer] = useState(false);
  const [isRMQModalOpen, setIsRMQModalOpen] = useState(false);
  const [rmqCloserUserId, setRmqCloserUserId] = useState<string | null>(null);
  
  // Call options modal state
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callPhoneNumber, setCallPhoneNumber] = useState<string>('');
  const [callLeadName, setCallLeadName] = useState<string>('');

  useEffect(() => {
    if (user?.id) {
      fetchMyCases();
    }
  }, [user?.id]);

  // Fetch countries with timezone data (will be populated in fetchMyCases)
  const [allCountries, setAllCountries] = useState<any[]>([]);

  // Helper function to safely parse dates
  const safeParseDate = (dateString: string | null | undefined): Date | null => {
    if (!dateString) return null;
    try {
      // Handle empty strings
      if (typeof dateString === 'string' && dateString.trim() === '') {
        return null;
      }
      
      const date = new Date(dateString);
      
      // Check if date is valid using multiple methods
      if (isNaN(date.getTime())) {
        return null;
      }
      
      // Additional check: verify the date is within a reasonable range
      // (between year 1900 and 2100)
      const year = date.getFullYear();
      if (year < 1900 || year > 2100) {
        return null;
      }
      
      return date;
    } catch (error) {
      console.error('Error in safeParseDate:', error);
      return null;
    }
  };

  // Helper function to get follow up date color based on date (same logic as SchedulerToolPage)
  const getFollowUpColor = (followUpDateStr: string | null | undefined): string => {
    if (!followUpDateStr) return 'bg-gray-100 text-gray-600';
    
    try {
      const followUpDate = safeParseDate(followUpDateStr);
      if (!followUpDate) return 'bg-gray-100 text-gray-600';
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Set follow up date to start of day for comparison
      const followUpDateStart = new Date(followUpDate);
      followUpDateStart.setHours(0, 0, 0, 0);
      
      // Calculate difference in days
      const diffTime = followUpDateStart.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays < 0) {
        // Past follow up date - red
        return 'bg-red-500 text-white';
      } else if (diffDays === 0) {
        // Today - green
        return 'bg-green-500 text-white';
      } else {
        // Tomorrow or more than 1 day away - yellow
        return 'bg-yellow-500 text-white';
      }
    } catch (error) {
      console.error('Error parsing follow-up date for color:', followUpDateStr, error);
      return 'bg-gray-100 text-gray-600';
    }
  };

  // Helper function to get country timezone
  const getCountryTimezone = (countryId: string | number | null | undefined, countryName: string | null | undefined, phone?: string | null, mobile?: string | null) => {
    if (!countryId && !countryName) return null;
    
    if (!allCountries || allCountries.length === 0) return null;
    
    // Try to find by name first
    if (countryName) {
      const countryByName = allCountries.find((country: any) => 
        country.name.toLowerCase().trim() === countryName.toLowerCase().trim()
      );
      
      if (countryByName) {
        // Special handling for US (country ID 249): use area code from phone number
        if (countryByName.id === 249) {
          const usTimezone = getUSTimezoneFromPhone(phone, mobile);
          if (usTimezone) {
            return usTimezone;
          }
          return 'America/New_York'; // Fallback to default US timezone
        }
        
        if (countryByName.timezone) {
          return countryByName.timezone;
        }
      }
    }
    
    // Try to find by ID
    if (countryId) {
      const countryIdNum = typeof countryId === 'string' ? parseInt(countryId, 10) : countryId;
      if (!isNaN(countryIdNum as number)) {
        const countryById = allCountries.find((country: any) => country.id.toString() === countryIdNum.toString());
        
        if (countryById) {
          // Special handling for US (country ID 249): use area code from phone number
          if (countryById.id === 249) {
            const usTimezone = getUSTimezoneFromPhone(phone, mobile);
            if (usTimezone) {
              return usTimezone;
            }
            return 'America/New_York'; // Fallback to default US timezone
          }
          
          if (countryById.timezone) {
            return countryById.timezone;
          }
        }
      }
    }
    
    return null;
  };

  // Helper function to get business hours info
  const getBusinessHoursInfo = (timezone: string | null) => {
    if (!timezone) return { isBusinessHours: false, localTime: null };
    
    try {
      const now = new Date();
      
      // Format the local time directly using the timezone
      const formattedTime = now.toLocaleString("en-US", {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      // Get the hour in the target timezone using Intl.DateTimeFormat
      const hourFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false
      });
      const hourParts = hourFormatter.formatToParts(now);
      const hour = parseInt(hourParts.find(part => part.type === 'hour')?.value || '0', 10);
      
      // Business hours: 8 AM to 8 PM (8:00 - 20:00)
      const isBusinessHours = hour >= 8 && hour < 20;
      
      return { isBusinessHours, localTime: formattedTime };
    } catch (error) {
      console.error('Error checking business hours for timezone:', timezone, error);
      return { isBusinessHours: false, localTime: null };
    }
  };

  const fetchMyCases = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user's employee ID, full name, and user ID in one query
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, employee_id, full_name')
        .eq('auth_id', user?.id)
        .single();

      if (userError || !userData?.employee_id) {
        throw new Error('Employee not found for current user');
      }

      const employeeId = userData.employee_id;
      const userFullName = userData.full_name;
      const currentUserId = userData.id; // User ID for follow-ups

      // Fetch all static/reference data and leads in parallel
      const [
        newLeadsResult, 
        legacyLeadsResult,
        allCountriesResult,
        stagesResult,
        allCategoriesResult,
        languageMappingResult
      ] = await Promise.all([
        // New leads: check handler (text) or case_handler_id (numeric)
        supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            stage,
            category_id,
            created_at,
            balance,
            balance_currency,
            handler,
            case_handler_id,
            language,
            country_id,
            phone,
            mobile,
            misc_country!country_id (
              id,
              name,
              timezone
            )
          `)
          .or(
            userFullName
              ? `handler.eq.${userFullName},case_handler_id.eq.${employeeId}`
              : `case_handler_id.eq.${employeeId}`
          )
          .order('created_at', { ascending: false })
          .limit(200),
        
        // Legacy leads: check case_handler_id (numeric)
        supabase
          .from('leads_lead')
          .select(`
            id,
            manual_id,
            name,
            stage,
            category_id,
            cdate,
            no_of_applicants,
            total,
            currency_id,
            language_id,
            phone,
            accounting_currencies!leads_lead_currency_id_fkey (
              name,
              iso_code
            )
          `)
          .eq('case_handler_id', employeeId)
          .order('cdate', { ascending: false })
          .limit(200),
        
        // Fetch countries with timezone data (static data)
        supabase
          .from('misc_country')
          .select('id, name, timezone')
          .order('name', { ascending: true }),
        
        // Fetch stage names and colors (static data)
        supabase
          .from('lead_stages')
          .select('id, name, colour'),
        
        // Fetch categories with their parent main category names (static data)
        supabase
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
          .order('name', { ascending: true }),
        
        // Fetch language mappings (static data)
        supabase
          .from('misc_language')
          .select('id, name')
      ]);

      // Set countries data immediately
      if (allCountriesResult.data) {
        setAllCountries(allCountriesResult.data);
      }

      // Process static data
      const stages = stagesResult.data || [];
      const allCategories = allCategoriesResult.data || [];
      const languageMapping = languageMappingResult.data || [];

      // Create lookup maps
      const stageMap = new Map();
      const stageColourMap = new Map();
      stages.forEach(stage => {
        stageMap.set(String(stage.id), stage.name);
        if (stage.colour) {
          stageColourMap.set(String(stage.id), stage.colour);
        }
      });

      const languageMap = new Map();
      languageMapping.forEach(language => {
        languageMap.set(language.id, language.name);
      });

      if (newLeadsResult.error) throw newLeadsResult.error;
      if (legacyLeadsResult.error) throw legacyLeadsResult.error;

      // Extract lead IDs for parallel queries
      const newLeadIds = (newLeadsResult.data || []).map(lead => lead.id);
      const legacyLeadIds = (legacyLeadsResult.data || []).map(lead => String(lead.id));
      const legacyLeadIdsForQueries = (legacyLeadsResult.data || []).map(lead => lead.id);

      // Fetch all dependent data in parallel
      const [
        newPaymentsResult,
        legacyPaymentsResult,
        legacyCountryDataResult,
        newFollowupsResult,
        legacyFollowupsResult
      ] = await Promise.all([
        // Fetch payment information for new leads
        newLeadIds.length > 0
          ? supabase
              .from('payment_plans')
              .select('lead_id, paid, ready_to_pay, cancel_date')
              .in('lead_id', newLeadIds)
              .is('cancel_date', null)
          : Promise.resolve({ data: [], error: null }),
        
        // Fetch payment information for legacy leads
        legacyLeadIds.length > 0
          ? supabase
              .from('finances_paymentplanrow')
              .select('lead_id, actual_date, ready_to_pay, cancel_date')
              .in('lead_id', legacyLeadIds)
              .is('cancel_date', null)
          : Promise.resolve({ data: [], error: null }),
        
        // Fetch country data for legacy leads via contacts
        legacyLeadIds.length > 0
          ? supabase
              .from('lead_leadcontact')
              .select(`
                lead_id,
                leads_contact (
                  country_id,
                  misc_country (
                    id,
                    name
                  )
                )
              `)
              .in('lead_id', legacyLeadIdsForQueries)
              .eq('main', 'true')
          : Promise.resolve({ data: [], error: null }),
        
        // Fetch follow-ups for new leads
        newLeadIds.length > 0 && currentUserId
          ? supabase
              .from('follow_ups')
              .select('new_lead_id, date')
              .eq('user_id', currentUserId)
              .in('new_lead_id', newLeadIds)
              .is('lead_id', null)
          : Promise.resolve({ data: [], error: null }),
        
        // Fetch follow-ups for legacy leads
        legacyLeadIdsForQueries.length > 0 && currentUserId
          ? supabase
              .from('follow_ups')
              .select('lead_id, date')
              .eq('user_id', currentUserId)
              .in('lead_id', legacyLeadIdsForQueries)
              .is('new_lead_id', null)
          : Promise.resolve({ data: [], error: null })
      ]);

      // Process payment data for new leads
      const newLeadsPaymentMap = new Map<string, boolean>();
      const newLeadsReadyToPayMap = new Map<string, boolean>();
      const newLeadsUnpaidPaymentMap = new Map<string, boolean>();
      const newLeadsHasPaymentPlanMap = new Map<string, boolean>();
      
      const newPayments = newPaymentsResult.data || [];
      const paymentsByLead = new Map<string, any[]>();
      newPayments.forEach((payment: any) => {
        if (!paymentsByLead.has(payment.lead_id)) {
          paymentsByLead.set(payment.lead_id, []);
        }
        paymentsByLead.get(payment.lead_id)!.push(payment);
      });
      
      // Mark all leads that have payments
      paymentsByLead.forEach((payments, leadId) => {
        newLeadsHasPaymentPlanMap.set(leadId, true);
      });
      
      // Mark leads without payments
      newLeadIds.forEach(leadId => {
        if (!newLeadsHasPaymentPlanMap.has(leadId)) {
          newLeadsHasPaymentPlanMap.set(leadId, false);
        }
      });
      
      paymentsByLead.forEach((payments, leadId) => {
        const hasPaidPayment = payments.some((payment: any) => payment.paid === true);
        newLeadsPaymentMap.set(leadId, hasPaidPayment);
        
        const hasReadyToPay = payments.some((payment: any) => payment.ready_to_pay === true);
        newLeadsReadyToPayMap.set(leadId, hasReadyToPay);
        
        const hasUnpaidPayment = payments.some((payment: any) => payment.paid !== true);
        newLeadsUnpaidPaymentMap.set(leadId, hasUnpaidPayment);
      });

      // Process payment data for legacy leads
      const legacyLeadsPaymentMap = new Map<string, boolean>();
      const legacyLeadsReadyToPayMap = new Map<string, boolean>();
      const legacyLeadsUnpaidPaymentMap = new Map<string, boolean>();
      const legacyLeadsHasPaymentPlanMap = new Map<string, boolean>();
      
      const legacyPayments = legacyPaymentsResult.data || [];
      const legacyPaymentsByLead = new Map<string, any[]>();
      legacyPayments.forEach((payment: any) => {
        const leadId = String(payment.lead_id);
        if (!legacyPaymentsByLead.has(leadId)) {
          legacyPaymentsByLead.set(leadId, []);
        }
        legacyPaymentsByLead.get(leadId)!.push(payment);
      });
      
      legacyPaymentsByLead.forEach((payments, leadId) => {
        legacyLeadsHasPaymentPlanMap.set(leadId, true);
      });
      
      legacyLeadIds.forEach(leadId => {
        if (!legacyLeadsHasPaymentPlanMap.has(leadId)) {
          legacyLeadsHasPaymentPlanMap.set(leadId, false);
        }
      });
      
      legacyPaymentsByLead.forEach((payments, leadId) => {
        const hasPaidPayment = payments.some((payment: any) => 
          payment.actual_date != null && payment.actual_date !== ''
        );
        legacyLeadsPaymentMap.set(leadId, hasPaidPayment);
        
        const hasReadyToPay = payments.some((payment: any) => payment.ready_to_pay === true);
        legacyLeadsReadyToPayMap.set(leadId, hasReadyToPay);
        
        const hasUnpaidPayment = payments.some((payment: any) => 
          payment.actual_date == null || payment.actual_date === ''
        );
        legacyLeadsUnpaidPaymentMap.set(leadId, hasUnpaidPayment);
      });

      // Process legacy country data
      const legacyCountryMap = new Map();
      const legacyCountryData = legacyCountryDataResult.data || [];
      legacyCountryData.forEach((item: any) => {
        if (item.leads_contact && (item.leads_contact as any).misc_country) {
          const leadId = item.lead_id;
          const countryName = ((item.leads_contact as any).misc_country as any).name;
          legacyCountryMap.set(leadId, countryName);
        }
      });

      // Process follow-ups
      const followUpsMap = new Map<string, string>();
      const newFollowups = newFollowupsResult.data || [];
      newFollowups.forEach(fu => {
        if (fu.new_lead_id && fu.date) {
          try {
            const date = new Date(fu.date);
            if (date && !isNaN(date.getTime())) {
              const dateStr = date.toISOString().split('T')[0];
              if (dateStr && dateStr !== 'Invalid Date') {
                followUpsMap.set(fu.new_lead_id, dateStr);
              }
            }
          } catch (error) {
            // Silently skip invalid dates
          }
        }
      });
      
      const legacyFollowups = legacyFollowupsResult.data || [];
      legacyFollowups.forEach(fu => {
        if (fu.lead_id && fu.date) {
          try {
            const date = new Date(fu.date);
            if (date && !isNaN(date.getTime())) {
              const dateStr = date.toISOString().split('T')[0];
              if (dateStr && dateStr !== 'Invalid Date') {
                followUpsMap.set(String(fu.lead_id), dateStr);
              }
            }
          } catch (error) {
            // Silently skip invalid dates
          }
        }
      });

      // Helper function to get category name with main category
      const getCategoryName = (categoryId: string | number | null | undefined) => {
        if (!categoryId || categoryId === '---') return 'Unknown';
        
        const category = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString()) as any;
        if (category) {
          if (category.misc_maincategory?.name) {
            return `${category.name} (${category.misc_maincategory.name})`;
          } else {
            return category.name;
          }
        }
        
        return 'Unknown';
      };

      // Helper function to get currency symbol
      const getCurrencySymbol = (currencyId: number | null | undefined, currencyData: any): string => {
        if (!currencyId) return '₪'; // Default to shekel
        
        // Handle currency data (could be array or object)
        const currency = Array.isArray(currencyData) ? currencyData[0] : currencyData;
        
        if (currency?.iso_code) {
          // Map ISO codes to symbols
          const symbolMap: { [key: string]: string } = {
            'ILS': '₪',
            'USD': '$',
            'EUR': '€',
            'GBP': '£',
            'CAD': 'C$',
            'AUD': 'A$',
            'JPY': '¥',
            'CHF': 'CHF',
            'SEK': 'kr',
            'NOK': 'kr',
            'DKK': 'kr',
            'PLN': 'zł',
            'CZK': 'Kč',
            'HUF': 'Ft',
            'RON': 'lei',
            'BGN': 'лв',
            'HRK': 'kn',
            'RUB': '₽',
            'UAH': '₴',
            'TRY': '₺'
          };
          return symbolMap[currency.iso_code] || currency.iso_code;
        }
        
        // Fallback to currency_id mapping if no currency data
        const fallbackMap: { [key: number]: string } = {
          1: '₪',
          2: '€',
          3: '$',
          4: '£'
        };
        return fallbackMap[currencyId] || '₪';
      };

      // Process new leads
      const processedNewLeads: Case[] = (newLeadsResult.data || []).map(lead => {
        const stageId = typeof lead.stage === 'string' ? parseInt(lead.stage, 10) : lead.stage;
        const stage = stageMap.get(String(lead.stage)) || String(lead.stage) || 'Unknown';
        const stageColour = stageColourMap.get(String(lead.stage)) || getStageColour(String(lead.stage)) || null;
        const category = getCategoryName(lead.category_id);
        const value = lead.balance ? parseFloat(String(lead.balance)) : null;
        const currency = lead.balance_currency || '₪';
        const isFirstPaymentPaid = newLeadsPaymentMap.get(lead.id) || false;
        const hasReadyToPay = newLeadsReadyToPayMap.get(lead.id) || false;
        const hasUnpaidPayment = newLeadsUnpaidPaymentMap.get(lead.id) || false;
        const hasPaymentPlan = newLeadsHasPaymentPlanMap.get(lead.id) || false;
        const language = lead.language || null;
        const country = (lead as any).misc_country?.name || null;
        const country_id = lead.country_id || (lead as any).misc_country?.id || null;
        const phone = lead.phone || null;
        const mobile = lead.mobile || null;
        const next_followup = followUpsMap.get(lead.id) || null;

        return {
          id: lead.id,
          lead_number: lead.lead_number || String(lead.id),
          client_name: lead.name || 'Unknown',
          category,
          stage,
          stage_colour: stageColour,
          assigned_date: lead.created_at,
          applicants_count: null,
          value,
          currency,
          stageId: stageId, // Store numeric stage ID for filtering
          isFirstPaymentPaid: isFirstPaymentPaid,
          isNewLead: true,
          hasReadyToPay: hasReadyToPay,
          hasUnpaidPayment: hasUnpaidPayment,
          hasPaymentPlan: hasPaymentPlan,
          language: language,
          country: country,
          country_id: country_id,
          phone: phone,
          mobile: mobile,
          next_followup: next_followup
        };
      });

      // Process legacy leads
      const processedLegacyLeads: Case[] = (legacyLeadsResult.data || []).map(lead => {
        const leadNumber = lead.manual_id || lead.id;
        const category = getCategoryName(lead.category_id);
        const stage = stageMap.get(String(lead.stage)) || String(lead.stage) || 'Unknown';
        const stageColour = stageColourMap.get(String(lead.stage)) || getStageColour(String(lead.stage)) || null;
        const value = lead.total || null;
        const currency = getCurrencySymbol(lead.currency_id, lead.accounting_currencies);
        const stageId = typeof lead.stage === 'string' ? parseInt(lead.stage, 10) : lead.stage;
        const isFirstPaymentPaid = legacyLeadsPaymentMap.get(String(lead.id)) || false;
        const hasReadyToPay = legacyLeadsReadyToPayMap.get(String(lead.id)) || false;
        const hasUnpaidPayment = legacyLeadsUnpaidPaymentMap.get(String(lead.id)) || false;
        const hasPaymentPlan = legacyLeadsHasPaymentPlanMap.get(String(lead.id)) || false;
        const language = lead.language_id ? languageMap.get(lead.language_id) || null : null;
        const country = legacyCountryMap.get(lead.id) || null;
        const country_id = null; // Legacy leads don't have country_id directly, we'll need to look it up if needed
        const phone = (lead as any).phone || null;
        const mobile = null; // Legacy leads don't have mobile field
        const next_followup = followUpsMap.get(String(lead.id)) || null;

        return {
          id: String(lead.id),
          lead_number: String(leadNumber),
          client_name: lead.name || 'Unknown',
          category,
          stage,
          stage_colour: stageColour,
          assigned_date: lead.cdate,
          applicants_count: lead.no_of_applicants,
          value,
          currency,
          stageId: stageId, // Store numeric stage ID for filtering
          isFirstPaymentPaid: isFirstPaymentPaid,
          isNewLead: false,
          hasReadyToPay: hasReadyToPay,
          hasUnpaidPayment: hasUnpaidPayment,
          hasPaymentPlan: hasPaymentPlan,
          language: language,
          country: country,
          country_id: country_id,
          phone: phone,
          mobile: mobile,
          next_followup: next_followup
        };
      });

      // Combine all cases
      const allProcessedCases = [...processedNewLeads, ...processedLegacyLeads];

      // Separate into new, active, and closed cases
      // New cases: stage <= 105 (up to and including "handler set")
      const newCasesList = allProcessedCases.filter(caseItem => {
        const stageId = (caseItem as any).stageId;
        return stageId !== undefined && stageId !== null && stageId <= 105;
      });
      
      // Closed cases: stage === 200 (case closed)
      const closedCasesList = allProcessedCases.filter(caseItem => {
        const stageId = (caseItem as any).stageId;
        return stageId === 200;
      });
      
      // Active cases: stage >= 110 (from "handler started" and beyond) and stage !== 200 (not closed)
      const activeCasesList = allProcessedCases.filter(caseItem => {
        const stageId = (caseItem as any).stageId;
        return stageId !== undefined && stageId !== null && stageId >= 110 && stageId !== 200;
      });

      setNewCases(newCasesList);
      setActiveCases(activeCasesList);
      setClosedCases(closedCasesList);

    } catch (err) {
      console.error('Error fetching my cases:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch cases');
    } finally {
      setLoading(false);
    }
  };

  const handleCaseClick = (caseItem: Case) => {
    // Navigate using the appropriate identifier
    // For legacy leads, use the numeric ID directly (no legacy_ prefix)
    // For new leads, use the lead_number
    const navigationId = caseItem.isNewLead ? caseItem.lead_number : caseItem.id;
    navigate(`/clients/${navigationId}`);
  };

  const handleRowSelect = (caseId: string) => {
    const allCases = [...newCases, ...activeCases, ...closedCases];
    const caseItem = allCases.find(c => c.id === caseId);
    if (caseItem) {
      setSelectedCase(caseItem);
      setSelectedRowId(caseId);
      setShowActionMenu(true);
    }
  };

  const handleCall = async (caseItem: Case) => {
    // Fetch phone data for the case
    try {
      const navigationId = caseItem.isNewLead ? caseItem.lead_number : caseItem.id;
      
      if (caseItem.isNewLead) {
        const { data: newLeadData } = await supabase
          .from('leads')
          .select('phone, mobile')
          .eq('lead_number', navigationId)
          .single();
        
        const phoneNumber = newLeadData?.phone || newLeadData?.mobile;
        if (phoneNumber) {
          // Only show modal for US numbers (country code +1)
          const normalizedPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
          const isUSNumber = normalizedPhone.startsWith('+1') || (normalizedPhone.startsWith('1') && normalizedPhone.length >= 10);
          
          if (isUSNumber) {
            setCallPhoneNumber(phoneNumber);
            setCallLeadName(caseItem.client_name || '');
            setIsCallModalOpen(true);
          } else {
            // For non-US countries, call directly
            window.open(`tel:${phoneNumber}`, '_self');
          }
          return;
        }
      } else {
        const { data: legacyLeadData } = await supabase
          .from('leads_lead')
          .select('phone, email')
          .eq('id', parseInt(navigationId))
          .single();
        
        if (legacyLeadData?.phone) {
          // Only show modal for US numbers (country code +1)
          const normalizedPhone = legacyLeadData.phone.replace(/[\s\-\(\)]/g, '');
          const isUSNumber = normalizedPhone.startsWith('+1') || (normalizedPhone.startsWith('1') && normalizedPhone.length >= 10);
          
          if (isUSNumber) {
            setCallPhoneNumber(legacyLeadData.phone);
            setCallLeadName(caseItem.client_name || '');
            setIsCallModalOpen(true);
          } else {
            // For non-US countries, call directly
            window.open(`tel:${legacyLeadData.phone}`, '_self');
          }
          return;
        }
      }
      
      // If no phone found, navigate to client page with phone tab
      navigate(`/clients/${navigationId}?tab=phone`);
    } catch (error) {
      console.error('Error fetching phone data:', error);
      // Fallback: navigate to client page
      const navigationId = caseItem.isNewLead ? caseItem.lead_number : caseItem.id;
      navigate(`/clients/${navigationId}?tab=phone`);
    }
  };

  const handleEmail = async (caseItem: Case) => {
    setSelectedCase(caseItem);
    setIsEmailModalOpen(true);
    setShowActionMenu(false);
    setSelectedRowId(null);
  };

  const handleWhatsApp = async (caseItem: Case) => {
    setSelectedCase(caseItem);
    setIsWhatsAppModalOpen(true);
    setShowActionMenu(false);
    setSelectedRowId(null);
  };

  const handleTimeline = (caseItem: Case) => {
    const navigationId = caseItem.isNewLead ? caseItem.lead_number : caseItem.id;
    navigate(`/clients/${navigationId}?tab=interactions`);
  };

  const handleEditLead = async (caseItem: Case) => {
    setSelectedCase(caseItem);
    setShowEditLeadDrawer(true);
    setShowActionMenu(false);
    setSelectedRowId(null);
  };

  const handleViewClient = (caseItem: Case) => {
    const navigationId = caseItem.isNewLead ? caseItem.lead_number : caseItem.id;
    navigate(`/clients/${navigationId}`);
  };

  // Helper function to add highlight to user_highlights table
  const handleHighlight = async (caseItem: Case) => {
    try {
      // Get current user's auth_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No user found');
        return;
      }

      // Get user's id from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData) {
        console.error('Error fetching user ID:', userError);
        return;
      }

      const currentUserId = userData.id;
      const leadNumber = caseItem.lead_number || '';

      // Check if highlight already exists
      let existingHighlight;
      if (!caseItem.isNewLead) {
        // Legacy lead
        const numericId = typeof caseItem.id === 'string' && caseItem.id.startsWith('legacy_') 
          ? parseInt(caseItem.id.replace('legacy_', '')) 
          : parseInt(caseItem.id);
        const { data } = await supabase
          .from('user_highlights')
          .select('id')
          .eq('user_id', currentUserId)
          .eq('lead_id', numericId)
          .maybeSingle();
        existingHighlight = data;
      } else {
        // New lead
        const { data } = await supabase
          .from('user_highlights')
          .select('id')
          .eq('user_id', currentUserId)
          .eq('new_lead_id', caseItem.id)
          .maybeSingle();
        existingHighlight = data;
      }

      if (existingHighlight) {
        // Highlight already exists
        return;
      }

      // Insert new highlight
      const highlightData: any = {
        user_id: currentUserId,
        lead_number: leadNumber,
      };

      if (!caseItem.isNewLead) {
        // Legacy lead
        const numericId = typeof caseItem.id === 'string' && caseItem.id.startsWith('legacy_') 
          ? parseInt(caseItem.id.replace('legacy_', '')) 
          : parseInt(caseItem.id);
        highlightData.lead_id = numericId;
      } else {
        highlightData.new_lead_id = caseItem.id;
      }

      const { error: insertError } = await supabase
        .from('user_highlights')
        .insert([highlightData]);

      if (insertError) {
        console.error('Error adding highlight:', insertError);
        return;
      }

      // Dispatch event to refresh HighlightsPanel
      window.dispatchEvent(new CustomEvent('highlights:added'));
    } catch (error) {
      console.error('Error in handleHighlight:', error);
    }
  };

  const handleOpenRMQForCloser = async (caseItem: Case) => {
    try {
      let targetEmployeeId: number | null = null;
      let targetDisplayName: string | null = null;
      let roleType: 'closer' | 'manager' = 'closer';

      if (caseItem.isNewLead) {
        // For new leads, closer is stored as a string (display name)
        const { data: leadData, error: leadError } = await supabase
          .from('leads')
          .select('closer, manager')
          .eq('id', caseItem.id)
          .single();

        if (leadError) {
          console.error('Error fetching lead data:', leadError);
          toast.error('Failed to fetch lead information');
          return;
        }

        // First try closer
        const closerDisplayName = leadData?.closer || null;
        if (closerDisplayName && closerDisplayName.trim() !== '') {
          const { data: employeeData, error: employeeError } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .eq('display_name', closerDisplayName.trim())
            .single();

          if (!employeeError && employeeData) {
            targetEmployeeId = employeeData.id;
            targetDisplayName = employeeData.display_name;
            roleType = 'closer';
          }
        }

        // If no closer found, try manager
        if (!targetEmployeeId) {
          const managerDisplayName = leadData?.manager || null;
          if (managerDisplayName && managerDisplayName.trim() !== '') {
            const { data: employeeData, error: employeeError } = await supabase
              .from('tenants_employee')
              .select('id, display_name')
              .eq('display_name', managerDisplayName.trim())
              .single();

            if (!employeeError && employeeData) {
              targetEmployeeId = employeeData.id;
              targetDisplayName = employeeData.display_name;
              roleType = 'manager';
            }
          }
        }
      } else {
        // For legacy leads, closer is stored as closer_id (numeric), manager as meeting_manager_id
        const legacyId = caseItem.id;
        const { data: leadData, error: leadError } = await supabase
          .from('leads_lead')
          .select('closer_id, meeting_manager_id')
          .eq('id', legacyId)
          .single();

        if (leadError) {
          console.error('Error fetching legacy lead data:', leadError);
          toast.error('Failed to fetch lead information');
          return;
        }

        // First try closer
        const closerId = leadData?.closer_id || null;
        if (closerId) {
          const { data: employeeData, error: employeeError } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .eq('id', closerId)
            .single();

          if (!employeeError && employeeData) {
            targetEmployeeId = employeeData.id;
            targetDisplayName = employeeData.display_name;
            roleType = 'closer';
          }
        }

        // If no closer found, try manager
        if (!targetEmployeeId) {
          const managerId = leadData?.meeting_manager_id || null;
          if (managerId) {
            const { data: employeeData, error: employeeError } = await supabase
              .from('tenants_employee')
              .select('id, display_name')
              .eq('id', managerId)
              .single();

            if (!employeeError && employeeData) {
              targetEmployeeId = employeeData.id;
              targetDisplayName = employeeData.display_name;
              roleType = 'manager';
            }
          }
        }
      }

      // Check if we found either closer or manager
      if (!targetEmployeeId) {
        toast.error('No closer or manager assigned to this lead');
        return;
      }

      // Now find the user ID from the employee ID
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('employee_id', targetEmployeeId)
        .maybeSingle();

      if (userError) {
        console.error('Error fetching user by employee_id:', userError);
        toast.error(`Failed to find ${roleType === 'closer' ? 'closer' : 'manager'} user account`);
        return;
      }

      if (!userData) {
        toast.error(`No user account found for ${roleType === 'closer' ? 'closer' : 'manager'} (${targetDisplayName}). They may not have access to the system.`);
        return;
      }

      // Set selected case and open RMQ modal with the target user's ID
      setSelectedCase(caseItem);
      setRmqCloserUserId(userData.id);
      setIsRMQModalOpen(true);
    } catch (error) {
      console.error('Error opening RMQ for closer/manager:', error);
      toast.error('Failed to open message window');
    }
  };

  const handleStartCase = async (caseItem: Case, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click navigation
    
    try {
      const actor = await fetchStageActorInfo();
      const timestamp = new Date().toISOString();
      const handlerStartedStageId = 110; // Handler Started stage ID
      
      // Create a minimal lead object for the update function
      const lead: any = {
        id: caseItem.isNewLead ? caseItem.id : `legacy_${caseItem.id}`,
        lead_type: caseItem.isNewLead ? 'new' : 'legacy',
      };
      
      if (caseItem.isNewLead) {
        // Update new lead
        const { error } = await supabase
          .from('leads')
          .update({
            stage: handlerStartedStageId,
            stage_changed_by: actor.fullName,
            stage_changed_at: timestamp,
          })
          .eq('id', caseItem.id);
        
        if (error) throw error;
      } else {
        // Update legacy lead
        const legacyId = caseItem.id;
        const { error } = await supabase
          .from('leads_lead')
          .update({
            stage: handlerStartedStageId,
            stage_changed_by: actor.fullName,
            stage_changed_at: timestamp,
          })
          .eq('id', legacyId);
        
        if (error) throw error;
      }
      
      // Record stage change history
      await updateLeadStageWithHistory({
        lead,
        stage: handlerStartedStageId,
        actor,
        timestamp,
      });
      
      toast.success('Case started successfully!');
      
      // Refresh the cases list
      await fetchMyCases();
    } catch (error: any) {
      console.error('Error starting case:', error);
      toast.error('Failed to start case. Please try again.');
    }
  };

  const handleMarkAsReadyToPay = async (caseItem: Case, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click navigation
    
    try {
      const currentDate = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
      
      if (caseItem.isNewLead) {
        // For new leads, find the first unpaid payment
        const { data: payments, error: fetchError } = await supabase
          .from('payment_plans')
          .select('id, paid, cancel_date')
          .eq('lead_id', caseItem.id)
          .eq('paid', false)
          .is('cancel_date', null)
          .order('due_date', { ascending: true })
          .limit(1);
        
        if (fetchError) throw fetchError;
        
        if (!payments || payments.length === 0) {
          toast.error('No unpaid payments found for this lead');
          return;
        }
        
        const firstUnpaidPayment = payments[0];
        
        // Update the first unpaid payment
        const { error } = await supabase
          .from('payment_plans')
          .update({ 
            ready_to_pay: true,
            due_date: currentDate
          })
          .eq('id', firstUnpaidPayment.id);
        
        if (error) throw error;
      } else {
        // For legacy leads, find the first unpaid payment
        const { data: payments, error: fetchError } = await supabase
          .from('finances_paymentplanrow')
          .select('id, actual_date, cancel_date')
          .eq('lead_id', caseItem.id)
          .is('actual_date', null)
          .is('cancel_date', null)
          .order('date', { ascending: true })
          .limit(1);
        
        if (fetchError) throw fetchError;
        
        if (!payments || payments.length === 0) {
          toast.error('No unpaid payments found for this lead');
          return;
        }
        
        const firstUnpaidPayment = payments[0];
        
        // Update the first unpaid payment
        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({ 
            ready_to_pay: true,
            date: currentDate,
            due_date: currentDate
          })
          .eq('id', firstUnpaidPayment.id);
        
        if (error) throw error;
      }
      
      toast.success('Payment marked as ready to pay! Due date set to today. It will now appear in the collection page.');
      
      // Refresh the cases list
      await fetchMyCases();
    } catch (error: any) {
      console.error('Error marking payment as ready to pay:', error);
      toast.error('Failed to mark payment as ready to pay');
    }
  };

  // Bulk handler functions for all visible leads
  const handleBulkStartCase = async () => {
    // Get all eligible cases from filtered new cases
    const eligibleCases = filteredNewCases.filter(
      caseItem => caseItem.isFirstPaymentPaid && caseItem.stageId === 105
    );

    if (eligibleCases.length === 0) {
      toast.error('No eligible cases to start. Cases must have first payment paid and be at "Handler Set" stage.');
      return;
    }

    try {
      const actor = await fetchStageActorInfo();
      const timestamp = new Date().toISOString();
      const handlerStartedStageId = 110;
      
      let successCount = 0;
      let errorCount = 0;

      for (const caseItem of eligibleCases) {
        try {
          const lead: any = {
            id: caseItem.isNewLead ? caseItem.id : `legacy_${caseItem.id}`,
            lead_type: caseItem.isNewLead ? 'new' : 'legacy',
          };

          if (caseItem.isNewLead) {
            const { error } = await supabase
              .from('leads')
              .update({
                stage: handlerStartedStageId,
                stage_changed_by: actor.fullName,
                stage_changed_at: timestamp,
              })
              .eq('id', caseItem.id);
            
            if (error) throw error;
          } else {
            const legacyId = caseItem.id;
            const { error } = await supabase
              .from('leads_lead')
              .update({
                stage: handlerStartedStageId,
                stage_changed_by: actor.fullName,
                stage_changed_at: timestamp,
              })
              .eq('id', legacyId);
            
            if (error) throw error;
          }

          // Record stage change history
          await updateLeadStageWithHistory({
            lead,
            stage: handlerStartedStageId,
            actor,
            timestamp,
          });

          successCount++;
        } catch (error) {
          console.error(`Error starting case ${caseItem.lead_number}:`, error);
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully started ${successCount} case${successCount > 1 ? 's' : ''}!`);
      }
      if (errorCount > 0) {
        toast.error(`Failed to start ${errorCount} case${errorCount > 1 ? 's' : ''}.`);
      }

      // Refresh the cases list
      await fetchMyCases();
    } catch (error: any) {
      console.error('Error in bulk start case:', error);
      toast.error('Failed to start cases. Please try again.');
    }
  };

  const handleBulkMarkAsReadyToPay = async () => {
    // Get all eligible cases from filtered new and active cases
    const eligibleNewCases = filteredNewCases.filter(
      caseItem => !caseItem.isFirstPaymentPaid && caseItem.hasUnpaidPayment && !caseItem.hasReadyToPay && caseItem.hasPaymentPlan
    );
    
    const eligibleActiveCases = filteredActiveCases.filter(
      caseItem => !caseItem.isFirstPaymentPaid && caseItem.hasUnpaidPayment && !caseItem.hasReadyToPay && caseItem.hasPaymentPlan
    );

    const eligibleCases = [...eligibleNewCases, ...eligibleActiveCases];

    if (eligibleCases.length === 0) {
      toast.error('No eligible cases to mark as ready to pay.');
      return;
    }

    try {
      const currentDate = new Date().toISOString().split('T')[0];
      let successCount = 0;
      let errorCount = 0;

      for (const caseItem of eligibleCases) {
        try {
          if (caseItem.isNewLead) {
            const { data: payments, error: fetchError } = await supabase
              .from('payment_plans')
              .select('id, paid, cancel_date')
              .eq('lead_id', caseItem.id)
              .eq('paid', false)
              .is('cancel_date', null)
              .order('due_date', { ascending: true })
              .limit(1);
            
            if (fetchError) throw fetchError;
            
            if (!payments || payments.length === 0) {
              continue;
            }
            
            const firstUnpaidPayment = payments[0];
            
            const { error } = await supabase
              .from('payment_plans')
              .update({ 
                ready_to_pay: true,
                due_date: currentDate
              })
              .eq('id', firstUnpaidPayment.id);
            
            if (error) throw error;
          } else {
            const { data: payments, error: fetchError } = await supabase
              .from('finances_paymentplanrow')
              .select('id, actual_date, cancel_date')
              .eq('lead_id', caseItem.id)
              .is('actual_date', null)
              .is('cancel_date', null)
              .order('date', { ascending: true })
              .limit(1);
            
            if (fetchError) throw fetchError;
            
            if (!payments || payments.length === 0) {
              continue;
            }
            
            const firstUnpaidPayment = payments[0];
            
            const { error } = await supabase
              .from('finances_paymentplanrow')
              .update({ 
                ready_to_pay: true,
                date: currentDate,
                due_date: currentDate
              })
              .eq('id', firstUnpaidPayment.id);
            
            if (error) throw error;
          }

          successCount++;
        } catch (error) {
          console.error(`Error marking case ${caseItem.lead_number} as ready to pay:`, error);
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully marked ${successCount} case${successCount > 1 ? 's' : ''} as ready to pay!`);
      }
      if (errorCount > 0) {
        toast.error(`Failed to mark ${errorCount} case${errorCount > 1 ? 's' : ''} as ready to pay.`);
      }

      // Refresh the cases list
      await fetchMyCases();
    } catch (error: any) {
      console.error('Error in bulk mark as ready to pay:', error);
      toast.error('Failed to mark cases as ready to pay.');
    }
  };

  // Fuzzy search function
  const fuzzySearch = (text: string, query: string): boolean => {
    if (!query) return true;
    
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase().trim();
    
    // Direct substring match
    if (textLower.includes(queryLower)) return true;
    
    // Fuzzy match - check if all characters in query appear in order in text
    let queryIndex = 0;
    for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
      if (textLower[i] === queryLower[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === queryLower.length;
  };

  // Filter cases based on search query, stage, and category
  const filterCases = (cases: Case[]): Case[] => {
    return cases.filter(caseItem => {
      // Search filter
      const matchesSearch = !searchQuery.trim() || 
        fuzzySearch(caseItem.lead_number, searchQuery) ||
        fuzzySearch(caseItem.client_name, searchQuery);
      
      // Stage filter
      const matchesStage = !selectedStage || caseItem.stage === selectedStage;
      
      // Category filter
      const matchesCategory = !selectedCategory || caseItem.category === selectedCategory;
      
      return matchesSearch && matchesStage && matchesCategory;
    });
  };

  const filteredNewCases = filterCases(newCases);
  const filteredActiveCases = filterCases(activeCases);
  const filteredClosedCases = filterCases(closedCases);

  // Calculate eligible cases for bulk actions
  const eligibleStartCaseCount = useMemo(() => {
    return filteredNewCases.filter(
      caseItem => caseItem.isFirstPaymentPaid && caseItem.stageId === 105
    ).length;
  }, [filteredNewCases]);

  const eligibleReadyToPayCount = useMemo(() => {
    const eligibleNew = filteredNewCases.filter(
      caseItem => !caseItem.isFirstPaymentPaid && caseItem.hasUnpaidPayment && !caseItem.hasReadyToPay && caseItem.hasPaymentPlan
    ).length;
    
    const eligibleActive = filteredActiveCases.filter(
      caseItem => !caseItem.isFirstPaymentPaid && caseItem.hasUnpaidPayment && !caseItem.hasReadyToPay && caseItem.hasPaymentPlan
    ).length;
    
    return eligibleNew + eligibleActive;
  }, [filteredNewCases, filteredActiveCases]);

  // Memoize handlerLead for FinanceTab to prevent infinite re-renders
  const handlerLeadForFinance = useMemo(() => {
    if (!selectedCase) return null;
    return {
      id: selectedCase.isNewLead ? selectedCase.id : `legacy_${selectedCase.id}`,
      lead_number: selectedCase.lead_number,
      name: selectedCase.client_name,
      category: selectedCase.category,
      stage: selectedCase.stage,
      created_at: selectedCase.assigned_date,
      balance: selectedCase.value || undefined,
      balance_currency: selectedCase.currency || undefined,
      lead_type: selectedCase.isNewLead ? 'new' : 'legacy'
    } as any;
  }, [selectedCase?.id, selectedCase?.lead_number, selectedCase?.client_name, selectedCase?.category, selectedCase?.stage, selectedCase?.assigned_date, selectedCase?.value, selectedCase?.currency, selectedCase?.isNewLead]);

  // Create client object for WhatsApp modal
  const clientForWhatsApp = useMemo(() => {
    if (!selectedCase) return undefined;
    return {
      id: selectedCase.isNewLead ? selectedCase.id : `legacy_${selectedCase.id}`,
      name: selectedCase.client_name,
      lead_number: selectedCase.lead_number,
      lead_type: selectedCase.isNewLead ? 'new' : 'legacy'
    };
  }, [selectedCase]);

  // Create client object for Email modal
  const clientForEmail = useMemo(() => {
    if (!selectedCase) return undefined;
    return {
      id: selectedCase.isNewLead ? selectedCase.id : `legacy_${selectedCase.id}`,
      name: selectedCase.client_name,
      lead_number: selectedCase.lead_number,
      lead_type: selectedCase.isNewLead ? 'new' : 'legacy',
      topic: selectedCase.category
    };
  }, [selectedCase]);

  // Get unique stages and categories from all cases
  const allCases = [...newCases, ...activeCases, ...closedCases];
  const uniqueStages = Array.from(new Set(allCases.map(c => c.stage))).sort();
  const uniqueCategories = Array.from(new Set(allCases.map(c => c.category))).sort();

  // Check if any filter is active
  const hasActiveFilters = searchQuery.trim() || selectedStage || selectedCategory;

  // Clear all filters function
  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedStage('');
    setSelectedCategory('');
  };

  const renderTable = (cases: Case[], title: string, emptyMessage: string, isNewCases: boolean = false) => (
    <div className="bg-white rounded-lg shadow-sm border">
      <div className="px-3 sm:px-6 py-2 sm:py-4 border-b">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      
      {cases.length === 0 ? (
        <div className="px-3 sm:px-6 py-8 sm:py-12 text-center">
          <p className="text-sm sm:text-base text-gray-500">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full table-compact sm:table-normal">
            <thead>
              <tr className="bg-white">
                <th className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[100px]">
                  Case
                </th>
                <th className="hidden lg:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[120px]">
                  Follow-up
                </th>
                <th className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[120px]">
                  Client
                </th>
                <th className="hidden md:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[150px]">
                  Category
                </th>
                <th className="hidden lg:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[100px]">
                  Language
                </th>
                <th className="hidden lg:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[120px]">
                  Country
                </th>
                <th className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[80px]">
                  Applicants
                </th>
                <th className="hidden md:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-right text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[100px]">
                  Value
                </th>
                <th className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-right text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[120px]">
                  Stage
                </th>
                <th className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 text-right text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider min-w-[100px]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {cases.map((caseItem) => (
                <tr 
                  key={caseItem.id} 
                  className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                    selectedRowId === caseItem.id ? 'bg-primary/5 ring-2 ring-primary ring-offset-1' : ''
                  }`}
                  onClick={() => handleRowSelect(caseItem.id)}
                >
                  <td className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 min-w-[100px]">
                    <div className="flex items-center gap-2">
                      {/* Document icon for all cases */}
                      <svg className="w-4 h-4 sm:w-5 sm:h-5 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {/* Payment status icon for new cases only */}
                      {isNewCases && (
                        <div className="flex-shrink-0">
                          {caseItem.isFirstPaymentPaid ? (
                            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      )}
                      <span className="text-black font-medium text-xs sm:text-sm">
                        {caseItem.lead_number}
                      </span>
                    </div>
                  </td>
                  <td className="hidden lg:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm min-w-[120px]">
                    {caseItem.next_followup ? (
                      <span className={`px-2 py-1 rounded font-semibold text-xs ${getFollowUpColor(caseItem.next_followup)}`}>
                        {(() => {
                          try {
                            const date = safeParseDate(caseItem.next_followup);
                            if (date && !isNaN(date.getTime())) {
                              return date.toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric'
                              });
                            }
                          } catch (error) {
                            console.error('Error formatting follow-up date:', error);
                          }
                          return caseItem.next_followup;
                        })()}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm min-w-[120px]">
                    <div className="max-w-[150px] whitespace-normal break-words leading-tight">
                      {caseItem.client_name}
                    </div>
                    <div className="md:hidden text-[10px] text-gray-500 mt-0.5 space-y-0.5">
                      <div className="max-w-[150px] whitespace-normal break-words leading-tight">{caseItem.category}</div>
                      {caseItem.value !== null && caseItem.value !== undefined && (
                        <div className="whitespace-nowrap font-medium text-gray-700">
                          {caseItem.currency || '₪'}{typeof caseItem.value === 'number' ? caseItem.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : caseItem.value}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="hidden md:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm min-w-[150px]">
                    <div className="max-w-[180px] whitespace-normal break-words leading-tight">
                      {caseItem.category}
                    </div>
                  </td>
                  <td className="hidden lg:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm min-w-[100px]">
                    {caseItem.language || '—'}
                  </td>
                  <td className="hidden lg:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <span>{caseItem.country || '—'}</span>
                      {caseItem.country && (() => {
                        const timezone = getCountryTimezone(caseItem.country_id, caseItem.country, caseItem.phone, caseItem.mobile);
                        const businessInfo = getBusinessHoursInfo(timezone);
                        
                        return timezone ? (
                          <div 
                            className={`w-3 h-3 rounded-full ${businessInfo.isBusinessHours ? 'bg-green-500' : 'bg-red-500'}`} 
                            title={`${businessInfo.localTime ? `Local time: ${businessInfo.localTime}` : 'Time unavailable'} - ${businessInfo.isBusinessHours ? 'Business hours' : 'Outside business hours'} (${timezone})`} 
                          />
                        ) : (
                          <div className="w-3 h-3 rounded-full bg-gray-300" title="No timezone data available" />
                        );
                      })()}
                    </div>
                  </td>
                  <td className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-center text-gray-900 text-xs sm:text-sm min-w-[80px]">
                    {caseItem.applicants_count || 0}
                  </td>
                  <td className="hidden md:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-right text-gray-900 text-xs sm:text-sm min-w-[100px]">
                    {caseItem.value !== null && caseItem.value !== undefined ? (
                      <span className="font-medium">
                        {caseItem.currency || '₪'}{typeof caseItem.value === 'number' ? caseItem.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : caseItem.value}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-right min-w-[120px]">
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs sm:text-sm text-black">
                        {caseItem.stage}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 min-w-[100px]">
                    <div className="flex items-center justify-end gap-2">
                      {/* Missing Payment Plan button - show if no payment plan exists */}
                      {!caseItem.hasPaymentPlan && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenRMQForCloser(caseItem);
                          }}
                          className="btn btn-sm p-1.5 sm:p-2 rounded animate-pulse bg-red-500 text-white hover:bg-red-600 border-none"
                          title="Missing Payment Plan - Click to message closer"
                        >
                          <ExclamationTriangleIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                      )}
                      {/* Start Case button - only show in new cases, when payment is paid (green checkmark), and stage is exactly Handler Set (105) */}
                      {isNewCases && caseItem.isFirstPaymentPaid && caseItem.stageId === 105 && (
                        <button
                          onClick={(e) => handleStartCase(caseItem, e)}
                          className="btn btn-sm btn-primary p-1.5 sm:p-2 rounded animate-pulse"
                          title="Start Case"
                        >
                          <PlayIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                      )}
                      {/* Sent to Finances button - show if not paid, has unpaid payments, and hasn't been marked as ready to pay */}
                      {!caseItem.isFirstPaymentPaid && caseItem.hasUnpaidPayment && !caseItem.hasReadyToPay && caseItem.hasPaymentPlan && (
                        <button
                          onClick={(e) => handleMarkAsReadyToPay(caseItem, e)}
                          className="btn btn-sm btn-warning p-1.5 sm:p-2 rounded animate-pulse"
                          title="Mark as Ready to Pay"
                        >
                          <PaperAirplaneIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary"></div>
          <p className="mt-4 text-gray-600">Loading your cases...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="alert alert-error mb-4">
            <div>
              <h3 className="font-bold">Error Loading Cases</h3>
              <div className="text-xs">{error}</div>
            </div>
          </div>
          <button
            onClick={fetchMyCases}
            className="btn btn-primary"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">My Cases</h1>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar and Filters */}
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-6">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </div>
            <input
              type="text"
              className="input input-bordered w-full pl-10"
              placeholder="Search by lead number or client name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setSearchQuery('')}
              >
                <svg className="h-5 w-5 text-gray-400 hover:text-gray-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>

          {/* Stage Filter */}
          <div className="w-full sm:w-48">
            <select
              className="select select-bordered w-full"
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
            >
              <option value="">All Stages</option>
              {uniqueStages.map(stage => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div className="w-full sm:w-64">
            <select
              className="select select-bordered w-full"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              {uniqueCategories.map(category => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          {/* Bulk Start Case Button */}
          {eligibleStartCaseCount > 0 && (
            <button
              className="btn btn-primary btn-sm sm:btn-md whitespace-nowrap"
              onClick={handleBulkStartCase}
              title={`Start ${eligibleStartCaseCount} case${eligibleStartCaseCount > 1 ? 's' : ''}`}
            >
              <PlayIcon className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
              Start Case ({eligibleStartCaseCount})
            </button>
          )}

          {/* Bulk Sent to Finance Button */}
          {eligibleReadyToPayCount > 0 && (
            <button
              className="btn btn-warning btn-sm sm:btn-md whitespace-nowrap"
              onClick={handleBulkMarkAsReadyToPay}
              title={`Mark ${eligibleReadyToPayCount} case${eligibleReadyToPayCount > 1 ? 's' : ''} as ready to pay`}
            >
              <PaperAirplaneIcon className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
              Sent to Finance ({eligibleReadyToPayCount})
            </button>
          )}

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              className="btn btn-ghost btn-sm sm:btn-md"
              onClick={clearAllFilters}
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 pb-4 sm:pb-8">
        <div className="space-y-3 sm:space-y-8">
          {/* New Cases Table */}
          {renderTable(
            filteredNewCases, 
            `New Cases (${filteredNewCases.length}${hasActiveFilters ? ` of ${newCases.length}` : ''})`, 
            hasActiveFilters ? "No matching new cases found." : "No new cases assigned in the last week.",
            true // isNewCases = true
          )}

          {/* Active Cases Table */}
          {renderTable(
            filteredActiveCases, 
            `Active Cases (${filteredActiveCases.length}${hasActiveFilters ? ` of ${activeCases.length}` : ''})`, 
            hasActiveFilters ? "No matching active cases found." : "No active cases found.",
            false // isNewCases = false
          )}

          {/* Closed Cases Table */}
          {renderTable(
            filteredClosedCases, 
            `Closed Cases (${filteredClosedCases.length}${hasActiveFilters ? ` of ${closedCases.length}` : ''})`, 
            hasActiveFilters ? "No matching closed cases found." : "No closed cases found.",
            false // isNewCases = false
          )}
        </div>
      </div>

      {/* Floating Action Buttons */}
      {selectedCase && selectedRowId && (() => {
        return (
          <>
            {/* Overlay to close buttons */}
            <div
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={() => {
                setShowActionMenu(false);
                setSelectedRowId(null);
                setSelectedCase(null);
              }}
            />
            
            {/* Floating Action Buttons - Centered vertically on right side */}
            <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col items-end gap-3">
              {/* Call Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Call</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCall(selectedCase);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedCase(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Call"
                >
                  <PhoneIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* Email Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Email</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEmail(selectedCase);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Email"
                >
                  <EnvelopeIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* WhatsApp Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">WhatsApp</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleWhatsApp(selectedCase);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="WhatsApp"
                >
                  <FaWhatsapp className="w-6 h-6" />
                </button>
              </div>
              
              {/* Timeline Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Timeline</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTimeline(selectedCase);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedCase(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Timeline"
                >
                  <ClockIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* Edit Lead Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Edit Lead</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditLead(selectedCase);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Edit Lead"
                >
                  <PencilSquareIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* View Client Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">View Client</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewClient(selectedCase);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedCase(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="View Client"
                >
                  <EyeIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* Highlight Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Highlight</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleHighlight(selectedCase);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedCase(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Highlight"
                >
                  <StarIcon className="w-6 h-6 text-white" style={{ color: '#ffffff' }} />
                </button>
              </div>
              
              {/* Documents Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Documents</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCase(selectedCase);
                    setIsDocumentModalOpen(true);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Documents"
                >
                  <FolderIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* Finance Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Finance</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCase(selectedCase);
                    setIsFinanceModalOpen(true);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Finance"
                >
                  <CurrencyDollarIcon className="w-6 h-6" />
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* Document Modal */}
      {selectedCase && (
        <DocumentModal
          isOpen={isDocumentModalOpen}
          onClose={() => {
            setIsDocumentModalOpen(false);
            setSelectedCase(null);
          }}
          leadNumber={selectedCase.lead_number}
          clientName={selectedCase.client_name}
        />
      )}

      {/* Finance Modal */}
      {selectedCase && isFinanceModalOpen && handlerLeadForFinance && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col m-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Finance Plan</h2>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedCase.client_name} ({selectedCase.lead_number})
                </p>
              </div>
              <button
                className="btn btn-ghost btn-circle"
                onClick={() => {
                  setIsFinanceModalOpen(false);
                  setSelectedCase(null);
                }}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <FinanceTab
                leads={[handlerLeadForFinance]}
                uploadFiles={async () => {}}
                uploadingLeadId={null}
                uploadedFiles={{}}
                isUploading={false}
                handleFileInput={async () => {}}
                refreshLeads={async () => {}}
                refreshDashboardData={async () => {
                  await fetchMyCases();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Modal */}
      {selectedCase && clientForWhatsApp && (
        <SchedulerWhatsAppModal
          isOpen={isWhatsAppModalOpen}
          onClose={() => {
            setIsWhatsAppModalOpen(false);
            setSelectedCase(null);
            setSelectedRowId(null);
          }}
          client={clientForWhatsApp}
        />
      )}

      {/* Email Modal */}
      {selectedCase && clientForEmail && (
        <SchedulerEmailThreadModal
          isOpen={isEmailModalOpen}
          onClose={() => {
            setIsEmailModalOpen(false);
            setSelectedCase(null);
            setSelectedRowId(null);
          }}
          client={clientForEmail}
        />
      )}

      {/* Edit Lead Drawer */}
      {showEditLeadDrawer && selectedCase && (
        <EditLeadDrawer
          isOpen={showEditLeadDrawer}
          onClose={() => {
            setShowEditLeadDrawer(false);
            setSelectedCase(null);
            setSelectedRowId(null);
          }}
          lead={selectedCase ? {
            id: selectedCase.isNewLead ? selectedCase.id : `legacy_${selectedCase.id}`,
            lead_number: selectedCase.lead_number,
            name: selectedCase.client_name,
            category: selectedCase.category,
            stage: selectedCase.stage,
            created_at: selectedCase.assigned_date,
            balance: selectedCase.value || undefined,
            balance_currency: selectedCase.currency || undefined,
            lead_type: selectedCase.isNewLead ? 'new' : 'legacy',
            number_of_applicants_meeting: selectedCase.applicants_count || undefined,
          } as any : null}
          onSave={async () => {
            await fetchMyCases();
          }}
        />
      )}

      {/* RMQ Messages Modal */}
      {isRMQModalOpen && selectedCase && (
        <RMQMessagesPage
          isOpen={isRMQModalOpen}
          onClose={() => {
            setIsRMQModalOpen(false);
            setRmqCloserUserId(null);
            setSelectedCase(null);
          }}
          initialUserId={rmqCloserUserId || undefined}
          initialMessage="The finance plan is not ready for this lead. Please create the payment plan."
          initialLeadNumber={selectedCase.lead_number}
          initialLeadName={selectedCase.client_name}
        />
      )}

      {/* Call Options Modal */}
      <CallOptionsModal
        isOpen={isCallModalOpen}
        onClose={() => setIsCallModalOpen(false)}
        phoneNumber={callPhoneNumber}
        leadName={callLeadName}
      />
    </div>
  );
};

export default MyCasesPage;
