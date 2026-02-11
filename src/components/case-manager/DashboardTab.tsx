import React, { useState, useEffect } from 'react';
import { MagnifyingGlassIcon, CalendarIcon, Squares2X2Icon, ListBulletIcon, FolderIcon, ExclamationTriangleIcon, PlayIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { getUSTimezoneFromPhone } from '../../lib/timezoneHelpers';
import { updateLeadStageWithHistory, fetchStageActorInfo } from '../../lib/leadStageManager';
import { getStageName, fetchStageNames } from '../../lib/stageUtils';
import { toast } from 'react-hot-toast';

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
  lead_type?: 'new' | 'legacy';
  master_id?: string | number | null;
}

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: any[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
}

interface DashboardTabProps extends HandlerTabProps {
  onCaseSelect: (lead: HandlerLead) => void;
  showCaseCards: boolean;
  setShowCaseCards: (show: boolean) => void;
  getStageDisplayName?: (stage: string | number | null | undefined) => string; // Optional for backward compatibility
}

const DashboardTab: React.FC<DashboardTabProps> = ({ leads, refreshLeads, onCaseSelect, showCaseCards, setShowCaseCards, getStageDisplayName }) => {
  // Initialize stage names cache on mount (exactly as Clients.tsx does)
  useEffect(() => {
    fetchStageNames().then(stageNames => {
      // Stage names initialized (same as Clients.tsx line 1593)
      console.log('🔍 DashboardTab: Stage names initialized');
    }).catch(error => {
      console.error('❌ DashboardTab: Error initializing stage names:', error);
    });
  }, []);
  console.log('🔍 DashboardTab: Component rendered with', leads.length, 'leads', {
    showCaseCards,
    leadIds: leads.map(l => l.id).slice(0, 5)
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [applicantCounts, setApplicantCounts] = useState<{[key: string]: number}>({});
  const [followUps, setFollowUps] = useState<{[key: string]: string}>({});
  const [allCountries, setAllCountries] = useState<any[]>([]);
  const [leadCountries, setLeadCountries] = useState<{[key: string]: {name: string, id: number | null}}>({});
  const [leadData, setLeadData] = useState<{[key: string]: any}>({});
  const [paymentStatus, setPaymentStatus] = useState<{[key: string]: boolean}>({});
  const [hasPaymentPlan, setHasPaymentPlan] = useState<{[key: string]: boolean}>({});
  const [hasUnpaidPayment, setHasUnpaidPayment] = useState<{[key: string]: boolean}>({});
  const [hasReadyToPay, setHasReadyToPay] = useState<{[key: string]: boolean}>({});
  const [masterLeadsMap, setMasterLeadsMap] = useState<Map<string, HandlerLead>>(new Map());

  // Fetch all data in parallel
  useEffect(() => {
    const fetchAllData = async () => {
      if (leads.length === 0) {
        console.log('🔍 DashboardTab: No leads to fetch data for');
        return;
      }

      try {
        console.log('🔍 DashboardTab: Starting to fetch data for', leads.length, 'leads');
        
        // Get current user's ID for follow-ups
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) {
          console.error('🔍 DashboardTab: Auth error:', authError);
          return;
        }
        if (!user) {
          console.log('🔍 DashboardTab: No user found');
          return;
        }

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', user.id)
          .single();

        if (userError) {
          console.error('🔍 DashboardTab: User data error:', userError);
          return;
        }

        const currentUserId = userData?.id;
        if (!currentUserId) {
          console.log('🔍 DashboardTab: No currentUserId found');
          return;
        }

        // Separate new and legacy leads
        const newLeads = leads.filter(lead => !lead.id.startsWith('legacy_'));
        const legacyLeads = leads.filter(lead => lead.id.startsWith('legacy_'));
        const legacyLeadIds = legacyLeads
          .map(lead => {
            const idStr = lead.id.replace('legacy_', '');
            const parsed = parseInt(idStr, 10);
            return isNaN(parsed) ? null : parsed;
          })
          .filter((id): id is number => id !== null);
        
        console.log('🔍 DashboardTab: Separated leads', {
          total: leads.length,
          new: newLeads.length,
          legacy: legacyLeads.length,
          legacyIds: legacyLeadIds.length,
          newLeadIds: newLeads.map(l => l.id).slice(0, 5),
          legacyLeadIds: legacyLeadIds.slice(0, 5)
        });

        // Fetch all data in parallel
        const [
          contractsResult,
          paymentsResult,
          legacyPaymentsResult,
          followUpsNewResult,
          followUpsLegacyResult,
          countriesResult,
          newLeadsDataResult
        ] = await Promise.all([
          // Applicant counts
          newLeads.length > 0
            ? supabase
                .from('contracts')
                .select('client_id, applicant_count')
                .in('client_id', newLeads.map(lead => lead.id))
            : Promise.resolve({ data: [], error: null }),
          
          // Payment plans for new leads
          newLeads.length > 0
            ? supabase
                .from('payment_plans')
                .select('lead_id, paid, ready_to_pay, cancel_date, due_date')
                .in('lead_id', newLeads.map(lead => lead.id))
                .is('cancel_date', null)
                .order('due_date', { ascending: true })
            : Promise.resolve({ data: [], error: null }),

          // Fetch payment information for legacy leads
          legacyLeadIds.length > 0
            ? supabase
                .from('finances_paymentplanrow')
                .select('lead_id, actual_date, ready_to_pay, cancel_date, date')
                .in('lead_id', legacyLeadIds)
                .is('cancel_date', null)
                .order('date', { ascending: true })
            : Promise.resolve({ data: [], error: null }),

          // Follow-ups for new leads
          newLeads.length > 0 && currentUserId
            ? supabase
                .from('follow_ups')
                .select('new_lead_id, date')
                .eq('user_id', currentUserId)
                .in('new_lead_id', newLeads.map(lead => lead.id))
                .is('lead_id', null)
            : Promise.resolve({ data: [], error: null }),

          // Follow-ups for legacy leads
          legacyLeadIds.length > 0 && currentUserId
            ? supabase
                .from('follow_ups')
                .select('lead_id, date')
                .eq('user_id', currentUserId)
                .in('lead_id', legacyLeadIds)
                .is('new_lead_id', null)
            : Promise.resolve({ data: [], error: null }),

          // Countries
          supabase
            .from('misc_country')
            .select('id, name, timezone')
            .order('name', { ascending: true }),

          // New leads data (for country, phone, mobile)
          newLeads.length > 0
            ? supabase
                .from('leads')
                .select('id, country_id, phone, mobile, misc_country!country_id(id, name)')
                .in('id', newLeads.map(lead => lead.id))
            : Promise.resolve({ data: [], error: null })
        ]);

        // Check for errors in each result
        console.log('🔍 DashboardTab: Query results received', {
          contracts: contractsResult.data?.length || 0,
          contractsError: contractsResult.error?.message,
          payments: paymentsResult.data?.length || 0,
          paymentsError: paymentsResult.error?.message,
          legacyPayments: legacyPaymentsResult.data?.length || 0,
          legacyPaymentsError: legacyPaymentsResult.error?.message,
          followUpsNew: followUpsNewResult.data?.length || 0,
          followUpsNewError: followUpsNewResult.error?.message,
          followUpsLegacy: followUpsLegacyResult.data?.length || 0,
          followUpsLegacyError: followUpsLegacyResult.error?.message,
          countries: countriesResult.data?.length || 0,
          countriesError: countriesResult.error?.message,
          newLeadsData: newLeadsDataResult.data?.length || 0,
          newLeadsDataError: newLeadsDataResult.error?.message
        });

        if (contractsResult.error) {
          console.error('🔍 DashboardTab: Contracts error:', contractsResult.error);
        }
        if (paymentsResult.error) {
          console.error('🔍 DashboardTab: Payments error:', paymentsResult.error);
        }
        if (legacyPaymentsResult.error) {
          console.error('🔍 DashboardTab: Legacy payments error:', legacyPaymentsResult.error);
        }
        if (followUpsNewResult.error) {
          console.error('🔍 DashboardTab: Follow-ups new error:', followUpsNewResult.error);
        }
        if (followUpsLegacyResult.error) {
          console.error('🔍 DashboardTab: Follow-ups legacy error:', followUpsLegacyResult.error);
        }
        if (countriesResult.error) {
          console.error('🔍 DashboardTab: Countries error:', countriesResult.error);
        }
        if (newLeadsDataResult.error) {
          console.error('🔍 DashboardTab: New leads data error:', newLeadsDataResult.error);
        }

        // Process applicant counts
        const countsMap: {[key: string]: number} = {};
        (contractsResult.data || []).forEach(contract => {
          const clientId = contract.client_id;
          const applicantCount = contract.applicant_count || 0;
          if (countsMap[clientId]) {
            countsMap[clientId] += applicantCount;
          } else {
            countsMap[clientId] = applicantCount;
          }
        });
        console.log('🔍 DashboardTab: Applicant counts processed', {
          contracts: contractsResult.data?.length || 0,
          countsMapSize: Object.keys(countsMap).length,
          sampleCounts: Object.entries(countsMap).slice(0, 3)
        });
        setApplicantCounts(countsMap);

        // Process follow-ups
        const followUpsMap: {[key: string]: string} = {};
        (followUpsNewResult.data || []).forEach(fu => {
          if (fu.new_lead_id && fu.date) {
            try {
              const date = new Date(fu.date);
              if (date && !isNaN(date.getTime())) {
                const dateStr = date.toISOString().split('T')[0];
                if (dateStr && dateStr !== 'Invalid Date') {
                  followUpsMap[fu.new_lead_id] = dateStr;
                }
              }
            } catch (error) {
              console.warn('🔍 DashboardTab: Invalid follow-up date for new lead', fu.new_lead_id, fu.date);
            }
          }
        });
        (followUpsLegacyResult.data || []).forEach(fu => {
          if (fu.lead_id && fu.date) {
            try {
              const date = new Date(fu.date);
              if (date && !isNaN(date.getTime())) {
                const dateStr = date.toISOString().split('T')[0];
                if (dateStr && dateStr !== 'Invalid Date') {
                  followUpsMap[`legacy_${fu.lead_id}`] = dateStr;
                }
              }
            } catch (error) {
              console.warn('🔍 DashboardTab: Invalid follow-up date for legacy lead', fu.lead_id, fu.date);
            }
          }
        });
        console.log('🔍 DashboardTab: Follow-ups processed', {
          newFollowUps: followUpsNewResult.data?.length || 0,
          legacyFollowUps: followUpsLegacyResult.data?.length || 0,
          followUpsMapSize: Object.keys(followUpsMap).length
        });
        setFollowUps(followUpsMap);

        // Set countries
        if (countriesResult.data) {
          setAllCountries(countriesResult.data);
          console.log('🔍 DashboardTab: Countries loaded', countriesResult.data.length);
        } else {
          console.warn('🔍 DashboardTab: No countries data received');
        }

        // Process lead countries
        const countriesMap: {[key: string]: {name: string, id: number | null}} = {};
        (newLeadsDataResult.data || []).forEach((lead: any) => {
          const country = lead.misc_country;
          countriesMap[lead.id] = {
            name: country?.name || null,
            id: lead.country_id || country?.id || null
          };
        });
        console.log('🔍 DashboardTab: Lead countries processed', {
          newLeadsData: newLeadsDataResult.data?.length || 0,
          countriesMapSize: Object.keys(countriesMap).length,
          sampleCountries: Object.entries(countriesMap).slice(0, 3)
        });
        setLeadCountries(countriesMap);
        setLeadData(Object.fromEntries((newLeadsDataResult.data || []).map((lead: any) => [lead.id, lead])));

        // Process payment status
        const paymentStatusMap: {[key: string]: boolean} = {};
        const hasPaymentPlanMap: {[key: string]: boolean} = {};
        const hasUnpaidPaymentMap: {[key: string]: boolean} = {};
        const hasReadyToPayMap: {[key: string]: boolean} = {};
        const payments = paymentsResult.data || [];
        const paymentsByLead = new Map<string, any[]>();
        
        console.log('🔍 DashboardTab: Processing payments', {
          totalPayments: payments.length,
          samplePayments: payments.slice(0, 3)
        });
        
        payments.forEach((payment: any) => {
          if (!paymentsByLead.has(payment.lead_id)) {
            paymentsByLead.set(payment.lead_id, []);
          }
          paymentsByLead.get(payment.lead_id)!.push(payment);
        });

        console.log('🔍 DashboardTab: Payments grouped by lead', {
          uniqueLeads: paymentsByLead.size,
          sampleLeads: Array.from(paymentsByLead.entries()).slice(0, 3)
        });

        // Process payment data for each lead
        paymentsByLead.forEach((payments, leadId) => {
          hasPaymentPlanMap[leadId] = true;
          
          // Sort payments by due_date to find the first payment
          const sortedPayments = [...payments].sort((a: any, b: any) => {
            const dateA = a.due_date ? new Date(a.due_date).getTime() : 0;
            const dateB = b.due_date ? new Date(b.due_date).getTime() : 0;
            return dateA - dateB;
          });
          
          // Check if the first payment (by due_date) is paid
          const firstPayment = sortedPayments[0];
          const isFirstPaymentPaid = firstPayment ? firstPayment.paid === true : false;
          
          const hasUnpaid = payments.some((payment: any) => payment.paid !== true);
          const hasReady = payments.some((payment: any) => payment.ready_to_pay === true);
          
          paymentStatusMap[leadId] = isFirstPaymentPaid;
          hasUnpaidPaymentMap[leadId] = hasUnpaid;
          hasReadyToPayMap[leadId] = hasReady;
        });

        // Mark leads without payments
        newLeads.forEach(lead => {
          if (!hasPaymentPlanMap.hasOwnProperty(lead.id)) {
            hasPaymentPlanMap[lead.id] = false;
            paymentStatusMap[lead.id] = false;
            hasUnpaidPaymentMap[lead.id] = false;
            hasReadyToPayMap[lead.id] = false;
          }
        });

        // Process legacy payment data
        const legacyPayments = legacyPaymentsResult.data || [];
        const legacyPaymentsByLead = new Map<string, any[]>();
        
        console.log('🔍 DashboardTab: Processing legacy payments', {
          totalLegacyPayments: legacyPayments.length,
          sampleLegacyPayments: legacyPayments.slice(0, 3)
        });
        
        legacyPayments.forEach((payment: any) => {
          const leadId = `legacy_${payment.lead_id}`;
          if (!legacyPaymentsByLead.has(leadId)) {
            legacyPaymentsByLead.set(leadId, []);
          }
          legacyPaymentsByLead.get(leadId)!.push(payment);
        });

        console.log('🔍 DashboardTab: Legacy payments grouped by lead', {
          uniqueLegacyLeads: legacyPaymentsByLead.size,
          sampleLegacyLeads: Array.from(legacyPaymentsByLead.entries()).slice(0, 3)
        });

        // Process legacy payment data for each lead
        legacyPaymentsByLead.forEach((payments, leadId) => {
          hasPaymentPlanMap[leadId] = true;
          
          // Sort payments by date to find the first payment
          const sortedPayments = [...payments].sort((a: any, b: any) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            return dateA - dateB;
          });
          
          // Check if the first payment (by date) is paid (has actual_date)
          const firstPayment = sortedPayments[0];
          const isFirstPaymentPaid = firstPayment ? (firstPayment.actual_date != null && firstPayment.actual_date !== '') : false;
          
          const hasUnpaid = payments.some((payment: any) => 
            payment.actual_date == null || payment.actual_date === ''
          );
          const hasReady = payments.some((payment: any) => payment.ready_to_pay === true);
          
          paymentStatusMap[leadId] = isFirstPaymentPaid;
          hasUnpaidPaymentMap[leadId] = hasUnpaid;
          hasReadyToPayMap[leadId] = hasReady;
        });

        // Mark legacy leads without payments
        legacyLeads.forEach(lead => {
          const legacyId = `legacy_${lead.id}`;
          if (!hasPaymentPlanMap.hasOwnProperty(legacyId)) {
            hasPaymentPlanMap[legacyId] = false;
            paymentStatusMap[legacyId] = false;
            hasUnpaidPaymentMap[legacyId] = false;
            hasReadyToPayMap[legacyId] = false;
          }
        });

        setPaymentStatus(paymentStatusMap);
        setHasPaymentPlan(hasPaymentPlanMap);
        setHasUnpaidPayment(hasUnpaidPaymentMap);
        setHasReadyToPay(hasReadyToPayMap);

        console.log('🔍 DashboardTab: Payment status processed', {
          totalLeads: newLeads.length,
          withPayments: Object.keys(paymentStatusMap).length,
          paid: Object.values(paymentStatusMap).filter(v => v).length,
          hasPaymentPlan: Object.values(hasPaymentPlanMap).filter(v => v).length,
          hasUnpaid: Object.values(hasUnpaidPaymentMap).filter(v => v).length,
          hasReadyToPay: Object.values(hasReadyToPayMap).filter(v => v).length
        });

        // Build master leads map for sublead formatting
        const masterMap = new Map<string, HandlerLead>();
        leads.forEach(lead => {
          const masterId = lead.master_id;
          if (masterId) {
            if (lead.lead_type === 'new') {
              // Find the master lead (new lead)
              const masterIdStr = String(masterId);
              const masterLead = leads.find(l => 
                l.lead_type === 'new' && 
                (l.id === masterIdStr || (l as any).id === masterIdStr)
              );
              if (masterLead) {
                masterMap.set(lead.id, masterLead);
              }
            } else if (lead.lead_type === 'legacy') {
              // Find the master lead (legacy lead)
              const masterIdStr = String(masterId);
              const masterLead = leads.find(l => {
                if (l.lead_type === 'legacy') {
                  const legacyId = l.id.replace('legacy_', '');
                  return legacyId === masterIdStr || l.id === `legacy_${masterIdStr}`;
                }
                return false;
              });
              if (masterLead) {
                masterMap.set(lead.id, masterLead);
              }
            }
          }
        });
        setMasterLeadsMap(masterMap);
        
        console.log('🔍 DashboardTab: Data fetch completed successfully');
      } catch (error) {
        console.error('🔍 DashboardTab: Error fetching data:', error);
        if (error instanceof Error) {
          console.error('🔍 DashboardTab: Error details:', error.message, error.stack);
        }
      }
    };

    fetchAllData();
  }, [leads]);

  // Helper function to get stage ID from stage
  const getStageId = (stage: string | number | null | undefined): number | null => {
    if (!stage) return null;
    if (typeof stage === 'number') return stage;
    const parsed = parseInt(String(stage), 10);
    return isNaN(parsed) ? null : parsed;
  };

  // Helper function to safely parse dates
  const safeParseDate = (dateString: string | null | undefined): Date | null => {
    if (!dateString) return null;
    try {
      if (typeof dateString === 'string' && dateString.trim() === '') {
        return null;
      }
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return null;
      }
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

  // Helper function to get follow up date color
  const getFollowUpColor = (followUpDateStr: string | null | undefined): string => {
    if (!followUpDateStr) return 'bg-gray-100 text-gray-600';
    try {
      const followUpDate = safeParseDate(followUpDateStr);
      if (!followUpDate) return 'bg-gray-100 text-gray-600';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const followUpDateStart = new Date(followUpDate);
      followUpDateStart.setHours(0, 0, 0, 0);
      const diffTime = followUpDateStart.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        return 'bg-red-500 text-white';
      } else if (diffDays === 0) {
        return 'bg-green-500 text-white';
      } else {
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

    if (countryName) {
      const countryByName = allCountries.find((country: any) =>
        country.name.toLowerCase().trim() === countryName.toLowerCase().trim()
      );
      if (countryByName) {
        if (countryByName.id === 249) {
          const usTimezone = getUSTimezoneFromPhone(phone, mobile);
          if (usTimezone) return usTimezone;
          return 'America/New_York';
        }
        if (countryByName.timezone) {
          return countryByName.timezone;
        }
      }
    }

    if (countryId) {
      const countryIdNum = typeof countryId === 'string' ? parseInt(countryId, 10) : countryId;
      if (!isNaN(countryIdNum as number)) {
        const countryById = allCountries.find((country: any) => country.id.toString() === countryIdNum.toString());
        if (countryById) {
          if (countryById.id === 249) {
            const usTimezone = getUSTimezoneFromPhone(phone, mobile);
            if (usTimezone) return usTimezone;
            return 'America/New_York';
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
      const formattedTime = now.toLocaleString("en-US", {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      const hourFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false
      });
      const hourParts = hourFormatter.formatToParts(now);
      const hour = parseInt(hourParts.find(part => part.type === 'hour')?.value || '0', 10);
      const isBusinessHours = hour >= 8 && hour < 20;
      return { isBusinessHours, localTime: formattedTime };
    } catch (error) {
      console.error('Error checking business hours for timezone:', timezone, error);
      return { isBusinessHours: false, localTime: null };
    }
  };

  // Filter leads based on search and date filters
  const filterLeads = (leadsToFilter: HandlerLead[]) => {
    return leadsToFilter.filter(lead => {
    const matchesSearch = !searchTerm || 
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.lead_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const leadDate = new Date(lead.created_at);
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;
    
    const matchesDateRange = (!fromDate || leadDate >= fromDate) && 
                           (!toDate || leadDate <= toDate);
    
    return matchesSearch && matchesDateRange;
  });
  };

  // Categorize leads into new, active, and closed cases
  const categorizeLeads = (leadsToCategorize: HandlerLead[]) => {
    console.log('🔍 DashboardTab: Categorizing leads', {
      total: leadsToCategorize.length,
      sampleStages: leadsToCategorize.slice(0, 5).map(l => ({
        id: l.id,
        stage: l.stage,
        handler_stage: l.handler_stage
      }))
    });

    // Filter out inactive leads first
    const activeLeads = leadsToCategorize.filter(lead => {
      if (lead.lead_type === 'new') {
        // For new leads: inactive if unactivated_at is not null
        const leadAny = lead as any;
        return leadAny.unactivated_at === null || leadAny.unactivated_at === undefined;
      } else if (lead.lead_type === 'legacy') {
        // For legacy leads: inactive if status === 10
        const leadAny = lead as any;
        return leadAny.status !== 10 && (leadAny.status === 0 || leadAny.status === null || leadAny.status === undefined);
      }
      // If we can't determine type, include it (shouldn't happen)
      return true;
    });

    console.log('🔍 DashboardTab: Filtered inactive leads', {
      before: leadsToCategorize.length,
      after: activeLeads.length,
      filtered: leadsToCategorize.length - activeLeads.length
    });

    const newCases: HandlerLead[] = [];
    const activeCases: HandlerLead[] = [];
    const closedCases: HandlerLead[] = [];

    activeLeads.forEach(lead => {
      const stageId = getStageId(lead.handler_stage || lead.stage);
      
      if (stageId === null || stageId === undefined) {
        // If we can't determine stage, put it in new cases
        newCases.push(lead);
      } else if (stageId === 200) {
        // Closed cases: stage === 200
        closedCases.push(lead);
      } else if (stageId <= 105) {
        // New cases: stage <= 105 (up to and including "handler set")
        newCases.push(lead);
      } else if (stageId >= 110) {
        // Active cases: stage >= 110 (from "handler started" and beyond) and stage !== 200
        activeCases.push(lead);
      } else {
        // Anything else goes to new cases
        newCases.push(lead);
      }
    });

    console.log('🔍 DashboardTab: Categorization complete', {
      new: newCases.length,
      active: activeCases.length,
      closed: closedCases.length,
      sampleNew: newCases.slice(0, 3).map(l => ({ id: l.id, stage: l.stage })),
      sampleActive: activeCases.slice(0, 3).map(l => ({ id: l.id, stage: l.stage })),
      sampleClosed: closedCases.slice(0, 3).map(l => ({ id: l.id, stage: l.stage }))
    });

    return { newCases, activeCases, closedCases };
  };

  // Get categorized and filtered leads
  const { newCases, activeCases, closedCases } = categorizeLeads(leads);
  const filteredNewCases = filterLeads(newCases);
  const filteredActiveCases = filterLeads(activeCases);
  const filteredClosedCases = filterLeads(closedCases);
  
  const hasActiveFilters = searchTerm || dateFrom || dateTo;

  console.log('🔍 DashboardTab: Filtered leads', {
    new: { total: newCases.length, filtered: filteredNewCases.length },
    active: { total: activeCases.length, filtered: filteredActiveCases.length },
    closed: { total: closedCases.length, filtered: filteredClosedCases.length },
    hasActiveFilters,
    searchTerm,
    dateFrom,
    dateTo
  });

  // Helper function to format sublead numbers
  const formatLeadNumber = (lead: HandlerLead): string => {
    const masterId = lead.master_id;
    
    // For new leads with master_id
    if (lead.lead_type === 'new' && masterId) {
      // If lead_number already contains '/', it's already formatted
      if (lead.lead_number && lead.lead_number.includes('/')) {
        return lead.lead_number;
      }
      // Try to get master lead number and format
      const masterLead = masterLeadsMap.get(lead.id) || leads.find(l => l.id === String(masterId));
      if (masterLead) {
        const baseNumber = (masterLead as any).manual_id || masterLead.lead_number || String(masterId);
        // Try to find sublead suffix by checking other subleads
        const subleads = leads.filter(l => l.master_id === masterId && l.id !== lead.id);
        const suffix = subleads.length > 0 ? subleads.length + 2 : 2; // Default to /2, or calculate based on existing subleads
        return `${baseNumber}/${suffix}`;
      }
      // Fallback: use lead_number if available, otherwise format with master_id
      return lead.lead_number || `${masterId}/2`;
    }
    
    // For legacy leads with master_id
    if (lead.lead_type === 'legacy' && masterId) {
      const masterIdStr = String(masterId);
      const masterLead = leads.find(l => {
        if (l.lead_type === 'legacy') {
          return l.id === `legacy_${masterIdStr}` || (l as any).id === masterIdStr;
        }
        return false;
      });
      if (masterLead) {
        const baseNumber = masterLead.lead_number || masterIdStr;
        // Try to find sublead suffix
        const subleads = leads.filter(l => 
          l.lead_type === 'legacy' && 
          (l.master_id === masterId || l.master_id === Number(masterId)) && 
          l.id !== lead.id
        );
        const suffix = subleads.length > 0 ? subleads.length + 2 : 2;
        return `${baseNumber}/${suffix}`;
      }
      // Fallback
      return `${masterIdStr}/2`;
    }
    
    // Master lead or no master_id - return as-is
    return lead.lead_number;
  };

  // Handle row click
  const handleRowClick = (lead: HandlerLead, event?: React.MouseEvent) => {
    // If Cmd/Ctrl is pressed, could open in new tab (if we had navigation)
    if (event?.metaKey || event?.ctrlKey) {
      return;
    }

    // Call the onCaseSelect handler
    onCaseSelect(lead);
  };

  // Handle Start Case
  const handleStartCase = async (lead: HandlerLead, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const actor = await fetchStageActorInfo();
      const timestamp = new Date().toISOString();
      const handlerStartedStageId = 110;

      const leadObj: any = {
        id: lead.lead_type === 'new' ? lead.id : lead.id.replace('legacy_', ''),
        lead_type: lead.lead_type || 'new',
      };

      if (lead.lead_type === 'new') {
        const { error } = await supabase
          .from('leads')
          .update({
            stage: handlerStartedStageId,
            stage_changed_by: actor.fullName,
            stage_changed_at: timestamp,
          })
          .eq('id', lead.id);

        if (error) throw error;
      } else {
        const legacyId = lead.id.replace('legacy_', '');
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

      await updateLeadStageWithHistory({
        lead: leadObj,
        stage: handlerStartedStageId,
        actor,
        timestamp,
      });

      toast.success('Case started successfully!');
      await refreshLeads();
    } catch (error: any) {
      console.error('Error starting case:', error);
      toast.error('Failed to start case. Please try again.');
    }
  };

  // Handle Mark as Ready to Pay
  const handleMarkAsReadyToPay = async (lead: HandlerLead, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const currentDate = new Date().toISOString().split('T')[0];

      if (lead.lead_type === 'new') {
        const { data: payments, error: fetchError } = await supabase
          .from('payment_plans')
          .select('id, paid, cancel_date')
          .eq('lead_id', lead.id)
          .eq('paid', false)
          .is('cancel_date', null)
          .order('due_date', { ascending: true })
          .limit(1);

        if (fetchError) throw fetchError;

        if (!payments || payments.length === 0) {
          toast.error('No unpaid payments found for this lead');
          return;
        }

        const { error } = await supabase
          .from('payment_plans')
          .update({
            ready_to_pay: true,
            due_date: currentDate
          })
          .eq('id', payments[0].id);

        if (error) throw error;
      } else {
        const legacyId = lead.id.replace('legacy_', '');
        const { data: payments, error: fetchError } = await supabase
          .from('finances_paymentplanrow')
          .select('id, actual_date, cancel_date')
          .eq('lead_id', legacyId)
          .is('actual_date', null)
          .is('cancel_date', null)
          .order('date', { ascending: true })
          .limit(1);

        if (fetchError) throw fetchError;

        if (!payments || payments.length === 0) {
          toast.error('No unpaid payments found for this lead');
          return;
        }

        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({
            ready_to_pay: true,
            date: currentDate,
            due_date: currentDate
          })
          .eq('id', payments[0].id);

        if (error) throw error;
      }

      toast.success('Payment marked as ready to pay! Due date set to today.');
      await refreshLeads();
    } catch (error: any) {
      console.error('Error marking payment as ready to pay:', error);
      toast.error('Failed to mark payment as ready to pay');
      }
    };

  // Handle Open RMQ for Closer (Missing Payment Plan)
  const handleOpenRMQForCloser = async (lead: HandlerLead) => {
    try {
      let targetEmployeeId: number | null = null;
      let targetDisplayName: string | null = null;

      if (lead.lead_type === 'new') {
        const { data: leadData, error: leadError } = await supabase
          .from('leads')
          .select('closer, manager')
          .eq('id', lead.id)
          .single();

        if (leadError) {
          toast.error('Failed to fetch lead information');
          return;
        }

        const closerDisplayName = leadData?.closer || leadData?.manager || null;
        if (closerDisplayName && closerDisplayName.trim() !== '') {
          const { data: employeeData } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .eq('display_name', closerDisplayName.trim())
            .single();

          if (employeeData) {
            targetEmployeeId = employeeData.id;
            targetDisplayName = employeeData.display_name;
          }
        }
      } else {
        const legacyId = lead.id.replace('legacy_', '');
        const { data: leadData, error: leadError } = await supabase
          .from('leads_lead')
          .select('closer_id, meeting_manager_id')
          .eq('id', legacyId)
          .single();

        if (leadError) {
          toast.error('Failed to fetch lead information');
          return;
        }

        const closerId = leadData?.closer_id || leadData?.meeting_manager_id || null;
        if (closerId) {
          const { data: employeeData } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .eq('id', closerId)
            .single();

          if (employeeData) {
            targetEmployeeId = employeeData.id;
            targetDisplayName = employeeData.display_name;
          }
        }
      }

      if (!targetEmployeeId) {
        toast.error('No closer or manager assigned to this lead');
        return;
      }

      // For now, just show a toast. In a full implementation, this would open RMQ modal
      toast.success(`Would open message to ${targetDisplayName || 'closer/manager'}`);
    } catch (error) {
      console.error('Error opening RMQ for closer:', error);
      toast.error('Failed to open message window');
    }
  };

  // Render table for a category of cases
  const renderTable = (cases: HandlerLead[], title: string, emptyMessage: string, isNewCases: boolean = false) => {
    console.log('🔍 DashboardTab: Rendering table', {
      title,
      casesCount: cases.length,
      isNewCases,
      sampleCases: cases.slice(0, 3).map(c => ({ id: c.id, name: c.name, stage: c.stage }))
    });

  return (
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
              {cases.map((lead) => {
                const applicantCount = applicantCounts[lead.id] || 0;
                // Use getStageName exactly as Clients.tsx does (line 851, 925, 12813)
                // Clients.tsx uses: getStageName(String(lead.stage))
                const stageToDisplay = lead.handler_stage || lead.stage;
                const displayStage = (stageToDisplay !== null && stageToDisplay !== undefined) 
                  ? getStageName(String(stageToDisplay)) 
                  : 'No Stage';
                const followUpDate = followUps[lead.id];
                const countryInfo = leadCountries[lead.id];
                const leadInfo = leadData[lead.id] || {};
                const stageId = getStageId(lead.handler_stage || lead.stage);
                const formattedLeadNumber = formatLeadNumber(lead);
                const isFirstPaymentPaid = paymentStatus[lead.id] || false;
                const hasPaymentPlanForLead = hasPaymentPlan[lead.id] || false;
                const hasUnpaidPaymentForLead = hasUnpaidPayment[lead.id] || false;
                const hasReadyToPayForLead = hasReadyToPay[lead.id] || false;
                
                // Debug log for first few leads
                if (cases.indexOf(lead) < 3) {
                  console.log('🔍 DashboardTab: Rendering lead row', {
                    leadId: lead.id,
                    leadNumber: formattedLeadNumber,
                    isNewCases,
                    isLegacy: lead.id.startsWith('legacy_'),
                    stageId,
                    isFirstPaymentPaid,
                    hasPaymentPlanForLead,
                    hasUnpaidPaymentForLead,
                    hasReadyToPayForLead,
                    paymentStatus: paymentStatus[lead.id],
                    allPaymentStatus: paymentStatus
                  });
                }
                
                return (
                  <tr
                    key={lead.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={(e) => handleRowClick(lead, e)}
                  >
                    <td className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 min-w-[100px]">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {/* Payment status icon - show for all leads in new cases box */}
                        {isNewCases && (
                          <div className="flex-shrink-0" title={isFirstPaymentPaid ? 'First payment paid' : 'First payment not paid'}>
                            {isFirstPaymentPaid ? (
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
                          {formattedLeadNumber}
                        </span>
                      </div>
                    </td>
                    <td className="hidden lg:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm min-w-[120px]">
                      {followUpDate ? (
                        <span className={`px-2 py-1 rounded font-semibold text-xs ${getFollowUpColor(followUpDate)}`}>
                          {(() => {
                            try {
                              const date = safeParseDate(followUpDate);
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
                            return followUpDate;
                          })()}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm min-w-[120px]">
                      <div className="max-w-[150px] whitespace-normal break-words leading-tight">
                        {lead.name}
                      </div>
                      <div className="md:hidden text-[10px] text-gray-500 mt-0.5 space-y-0.5">
                        <div className="max-w-[150px] whitespace-normal break-words leading-tight">{lead.category || 'N/A'}</div>
                        {lead.balance !== null && lead.balance !== undefined && (
                          <div className="whitespace-nowrap font-medium text-gray-700">
                            {lead.balance_currency || '₪'}{typeof lead.balance === 'number' ? lead.balance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : lead.balance}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="hidden md:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm min-w-[150px]">
                      <div className="max-w-[180px] whitespace-normal break-words leading-tight">
                        {lead.category || 'N/A'}
                      </div>
                    </td>
                    <td className="hidden lg:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm min-w-[120px]">
        <div className="flex items-center gap-2">
                        <span>{countryInfo?.name || '—'}</span>
                        {countryInfo?.name && (() => {
                          const timezone = getCountryTimezone(countryInfo.id, countryInfo.name, leadInfo.phone, leadInfo.mobile);
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
                      {applicantCount || 0}
                    </td>
                    <td className="hidden md:table-cell px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-right text-gray-900 text-xs sm:text-sm min-w-[100px]">
                      {lead.balance !== null && lead.balance !== undefined ? (
                        <span className="font-medium">
                          {lead.balance_currency || '₪'}{typeof lead.balance === 'number' ? lead.balance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : lead.balance}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-right min-w-[120px]">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs sm:text-sm text-black">
                          {displayStage}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 min-w-[100px]">
                      <div className="flex items-center justify-end gap-2">
                        {/* Missing Payment Plan button - show if no payment plan exists */}
                        {!hasPaymentPlanForLead && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenRMQForCloser(lead);
                            }}
                            className="btn btn-sm p-1.5 sm:p-2 rounded animate-pulse bg-red-500 text-white hover:bg-red-600 border-none"
                            title="Missing Payment Plan - Click to message closer"
                          >
                            <ExclamationTriangleIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                          </button>
                        )}
                        {/* Start Case button - only show in new cases, when payment is paid, and stage is exactly Handler Set (105) */}
                        {isNewCases && isFirstPaymentPaid && stageId === 105 && (
          <button
                            onClick={(e) => handleStartCase(lead, e)}
                            className="btn btn-sm btn-primary p-1.5 sm:p-2 rounded animate-pulse"
                            title="Start Case"
                          >
                            <PlayIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                          </button>
                        )}
                        {/* Sent to Finances button - show if not paid, has unpaid payments, and hasn't been marked as ready to pay */}
                        {!isFirstPaymentPaid && hasUnpaidPaymentForLead && !hasReadyToPayForLead && hasPaymentPlanForLead && (
                          <button
                            onClick={(e) => handleMarkAsReadyToPay(lead, e)}
                            className="btn btn-sm btn-warning p-1.5 sm:p-2 rounded animate-pulse"
                            title="Mark as Ready to Pay"
                          >
                            <PaperAirplaneIcon className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
    );
  };

  console.log('🔍 DashboardTab: Rendering component', {
    leadsCount: leads.length,
    showCaseCards,
    hasActiveFilters,
    newCasesCount: newCases.length,
    activeCasesCount: activeCases.length,
    closedCasesCount: closedCases.length,
    filteredNewCount: filteredNewCases.length,
    filteredActiveCount: filteredActiveCases.length,
    filteredClosedCount: filteredClosedCases.length
  });

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="p-8 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search Cases</label>
            <div className="relative">
              <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                className="input input-bordered w-full pl-10"
                placeholder="Search by name, lead #, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
            <input
              type="date"
              className="input input-bordered w-full"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
            <input
              type="date"
              className="input input-bordered w-full"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
        
        {(searchTerm || dateFrom || dateTo) && (
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => {
                setSearchTerm('');
                setDateFrom('');
                setDateTo('');
              }}
              className="btn btn-outline btn-sm"
            >
              Clear Filters
            </button>
            <span className="text-sm text-gray-600">
              Showing {filteredNewCases.length + filteredActiveCases.length + filteredClosedCases.length} of {leads.length} cases
            </span>
          </div>
        )}
      </div>

      {/* Cases Tables - Show when showCaseCards is true OR when there are active search filters */}
      {(() => {
        const shouldShow = showCaseCards || hasActiveFilters;
        console.log('🔍 DashboardTab: Should show tables?', {
          shouldShow,
          showCaseCards,
          hasActiveFilters,
          searchTerm,
          dateFrom,
          dateTo
        });
        return shouldShow;
      })() && (
        <div className="space-y-3 sm:space-y-8">
          {/* New Cases Table */}
          {renderTable(
            filteredNewCases,
            `New Cases (${filteredNewCases.length}${hasActiveFilters ? ` of ${newCases.length}` : ''})`,
            hasActiveFilters ? "No matching new cases found." : "No new cases assigned in the last week.",
            true // isNewCases
          )}

          {/* Active Cases Table */}
          {renderTable(
            filteredActiveCases,
            `Active Cases (${filteredActiveCases.length}${hasActiveFilters ? ` of ${activeCases.length}` : ''})`,
            hasActiveFilters ? "No matching active cases found." : "No active cases found.",
            false
          )}

          {/* Closed Cases Table */}
          {renderTable(
            filteredClosedCases,
            `Closed Cases (${filteredClosedCases.length}${hasActiveFilters ? ` of ${closedCases.length}` : ''})`,
            hasActiveFilters ? "No matching closed cases found." : "No closed cases found.",
            false
                      )}
                    </div>
      )}
    </div>
  );
};

export default DashboardTab; 
