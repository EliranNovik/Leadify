import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase, type Lead } from '../lib/supabase';
import { getStageName, fetchStageNames, areStagesEquivalent } from '../lib/stageUtils';
import { updateLeadStageWithHistory, recordLeadStageChange, fetchStageActorInfo, getLatestStageBeforeStage } from '../lib/leadStageManager';
import { fetchAllLeads, fetchLeadById, searchLeads, type CombinedLead } from '../lib/legacyLeadsApi';
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
  PlusIcon,
  TagIcon,
  ChartBarIcon,
  CheckIcon,
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
import { createTeamsMeeting, sendEmail } from '../lib/graph';
import { ClientTabProps } from '../types/client';
import { useAdminRole } from '../hooks/useAdminRole';
import {
  InteractionRequiredAuthError,
  type IPublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser';
import toast from 'react-hot-toast';
import LeadSummaryDrawer from './LeadSummaryDrawer';
import { generateProformaName } from '../lib/proforma';
import ClientInformationBox from './ClientInformationBox';
import ProgressFollowupBox from './ProgressFollowupBox';

interface TabItem {
  id: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: number;
  component: React.ComponentType<ClientTabProps>;
}

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
  switch (currencyCode) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'NIS':
    case '₪':
      return '₪';
    default:
      return '$';
  }
};

// Add currency options at the top of the component
const currencyOptions = [
  { value: '₪', label: '₪' },
  { value: '$', label: '$' },
  { value: '€', label: '€' },
];

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
  // Removed excessive console.log statements for performance
  // State to store all employees for name lookup
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  // State to store all categories for name lookup
  const [allCategories, setAllCategories] = useState<any[]>([]);

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = (employeeId: string | null | undefined) => {
    if (!employeeId || employeeId === '---') return 'Not assigned';
    // Find employee in the loaded employees array
    const employee = allEmployees.find((emp: any) => emp.id.toString() === employeeId.toString());
    return employee ? employee.display_name : employeeId; // Fallback to ID if not found
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
      // For dropdown compatibility, return the name field which matches the dropdown values
      return currency.name || currency.front_name || currency.iso_code || '₪';
    }
    
    return '₪'; // Default fallback - matches dropdown format
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
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedLeadNumber = searchParams.get('lead');
  const fullLeadNumber = decodeURIComponent(location.pathname.replace(/^\/clients\//, '').replace(/\/$/, ''));

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
  const { instance } = useMsal();
  const { isAdmin, isLoading: isAdminLoading } = useAdminRole();
  const [isSchedulingMeeting, setIsSchedulingMeeting] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);
  const [showScheduleMeetingPanel, setShowScheduleMeetingPanel] = useState(false);
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
  });
  const [meetingLocations, setMeetingLocations] = useState<Array<{id: string, name: string}>>([]);
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
  const [showSendOfferDrawer, setShowSendOfferDrawer] = useState(false);
  const [offerSubject, setOfferSubject] = useState('');
  const [offerBody, setOfferBody] = useState('');
  const [offerSending, setOfferSending] = useState(false);
  const [offerTemplateLang, setOfferTemplateLang] = useState<'en'|'he'|null>(null);
  const [offerTotal, setOfferTotal] = useState(selectedClient?.proposal_total || '');
  const [offerCurrency, setOfferCurrency] = useState(selectedClient?.proposal_currency || '₪');
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
          .from('users')
          .select(`
            id,
            full_name,
            email,
            active,
            employee_id,
            tenants_employee!employee_id (
              id,
              display_name,
              active,
              is_active
            )
          `)
          .eq('active', true)
          .order('full_name', { ascending: true });

        if (!error && data) {
          const mapped = data
            .map(user => {
              const employee = Array.isArray(user.tenants_employee)
                ? user.tenants_employee[0]
                : user.tenants_employee;
              const id = employee?.id ?? user.employee_id;
              if (!id) return null;
              const label = employee?.display_name || user.full_name || user.email || '';
              if (!label) return null;
              return {
                id,
                display_name: label,
                active: true,
                source: 'users',
              };
            })
            .filter(Boolean);

          if (mapped.length > 0) {
            setAllEmployees(mapped);
            return;
          }
        }
      } catch (error) {
        console.error('Clients: Error fetching employees from users table:', error);
      }

      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name, active, is_active, bonuses_role')
          .order('display_name', { ascending: true });

        if (!error && data) {
          setAllEmployees(data);
        }
      } catch (fallbackError) {
        console.error('Clients: Error fetching employees from tenants_employee table:', fallbackError);
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

    const fetchAvailableStages = async () => {
      try {
        const { data, error } = await supabase
          .from('lead_stages')
          .select('id, name')
          .order('name', { ascending: true });
        
        if (error) {
          console.error('Clients: Error fetching stages:', error);
        } else if (data) {
          setAvailableStages(data);
        }
      } catch (err) {
        console.error('Clients: Exception while fetching stages:', err);
      }
    };

    fetchEmployees();
    fetchCategories();
    fetchAvailableStages();
    // Initialize stage names cache
    fetchStageNames().then(stageNames => {
      // Stage names initialized
    }).catch(error => {
      console.error('❌ Error initializing stage names:', error);
    });
  }, []);
  
  // State for unactivated lead view
  const [isUnactivatedView, setIsUnactivatedView] = useState(false);
  const [userManuallyExpanded, setUserManuallyExpanded] = useState(false);

  // Debug isUnactivatedView changes
  useEffect(() => {
    // isUnactivatedView changed
  }, [isUnactivatedView]);

  // Check selectedClient prop and set isUnactivatedView accordingly
  useEffect(() => {
    if (selectedClient) {
      
      // Reset userManuallyExpanded when a new client is selected
      setUserManuallyExpanded(false);
      
      const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      const unactivationReason = selectedClient.unactivation_reason;
      const isUnactivated = isLegacy ? 
        (String(selectedClient.stage) === '91' || (unactivationReason && unactivationReason.trim() !== '')) :
        (String(selectedClient.stage) === '91' || String(selectedClient.stage) === '91' || (unactivationReason && unactivationReason.trim() !== ''));
      
      
      setIsUnactivatedView(isUnactivated);
    }
  }, [selectedClient]);
  
  // Manual check for unactivation (in case useEffect doesn't trigger)
  if (selectedClient) {
    const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
    const unactivationReason = selectedClient.unactivation_reason;
    const isUnactivated = isLegacy ? 
      (String(selectedClient.stage) === '91' || (unactivationReason && unactivationReason.trim() !== '')) :
      ((unactivationReason && unactivationReason.trim() !== '') || false);
    
    // Only set to true if it's currently false and should be true
    // Don't override if user has manually set it to false
    if (isUnactivated && isUnactivatedView === false) {
      setIsUnactivatedView(true);
    }
  }
  
  // State for unactivation modal
  const [showUnactivationModal, setShowUnactivationModal] = useState(false);
  const [unactivationReason, setUnactivationReason] = useState('');
  const [customUnactivationReason, setCustomUnactivationReason] = useState('');
  
  // State for activation modal
  const [showActivationModal, setShowActivationModal] = useState(false);

  // State for available stages
  const [availableStages, setAvailableStages] = useState<Array<{id: string, name: string}>>([]);

  // 1. Add state for the rescheduling drawer and meetings list
  const [showRescheduleDrawer, setShowRescheduleDrawer] = useState(false);
  const [rescheduleMeetings, setRescheduleMeetings] = useState<any[]>([]);
  const [rescheduleFormData, setRescheduleFormData] = useState<any>({
    date: '',
    time: '09:00',
    location: 'Teams',
    manager: '',
    helper: '',
    amount: '',
    currency: 'NIS',
  });
  const [meetingToDelete, setMeetingToDelete] = useState(null);

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
  const [successForm, setSuccessForm] = useState({
    handler: '',
    currency: '₪',
    numApplicants: '',
    proposal: '',
    potentialValue: '',
  });
  const [schedulerOptions, setSchedulerOptions] = useState<string[]>([]);

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

  // Fetch scheduler options from database - employees with bonuses_role 's' or 'c'
  useEffect(() => {
    const fetchSchedulers = async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('display_name, bonuses_role')
        .in('bonuses_role', ['s', 'c'])
        .order('display_name', { ascending: true });
      if (!error && data) {
        setSchedulerOptions(data.map((emp: any) => emp.display_name));
      }
    };
    fetchSchedulers();
  }, []);

  // Helper to convert lead number to case number
  const convertLeadToCaseNumber = (leadNumber: string): string => {
    if (!leadNumber) return leadNumber;
    // Replace 'L' with 'C' at the beginning of the lead number
    return leadNumber.replace(/^L/, 'C');
  };

  // Handler for Payment Received - new Client !!!
  const handlePaymentReceivedNewClient = () => {
    setShowSuccessDrawer(true);
    setSuccessForm({
      handler: '', // No default name
      currency: selectedClient?.proposal_currency || '₪',
      numApplicants: selectedClient?.number_of_applicants_meeting || '',
      proposal: selectedClient?.proposal_total || '',
      potentialValue: selectedClient?.potential_value || '',
    });
  };

  // Handler to save Success drawer
  const handleSaveSuccessDrawer = async () => {
    if (!selectedClient) return;
    try {
      // Convert empty strings to appropriate values for numeric fields
      const numApplicants = successForm.numApplicants === '' ? null : Number(successForm.numApplicants);
      const proposal = successForm.proposal === '' ? null : Number(successForm.proposal);
      const potentialValue = successForm.potentialValue === '' ? null : Number(successForm.potentialValue);
      
      // Convert lead number to case number
      const caseNumber = convertLeadToCaseNumber(selectedClient.lead_number);
      
      const updateData: any = {
        stage: 'Success',
        lead_number: caseNumber, // Update the lead number to case number
        proposal_currency: successForm.currency,
        number_of_applicants_meeting: numApplicants,
        proposal_total: proposal,
        potential_value: potentialValue,
      };
      if (successForm.handler) {
        updateData.closer = successForm.handler;
      }
      
      const actor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();
      updateData.stage_changed_by = actor.fullName;
      updateData.stage_changed_at = stageTimestamp;

      const { error } = await supabase
        .from('leads')
        .update(updateData)
        .eq('id', selectedClient.id);
      
      if (error) throw error;

      await recordLeadStageChange({
        lead: selectedClient,
        stage: 'Success',
        actor,
        timestamp: stageTimestamp,
      });
      
      // Update local state immediately
      setSelectedClient((prev: any) => ({
        ...prev,
        stage: 'Success',
        lead_number: caseNumber, // Update the lead number in local state
        proposal_currency: successForm.currency,
        number_of_applicants_meeting: numApplicants,
        proposal_total: proposal,
        potential_value: potentialValue,
      }));
      
      setShowSuccessDrawer(false);
      
      // Force a complete refresh from the database
      await refreshClientData(selectedClient.id);
      
      toast.success('Lead updated to Success!');
    } catch (error) {
      console.error('Error updating lead:', error);
      toast.error('Failed to update lead.');
    }
  };
  // Add useEffect to fetch meetings when reschedule drawer opens
  useEffect(() => {
    const fetchMeetings = async () => {
      if (!selectedClient?.id || !showRescheduleDrawer) return;
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('client_id', selectedClient.id)
        .order('meeting_date', { ascending: false });
      if (!error && data) setRescheduleMeetings(data);
      else setRescheduleMeetings([]);
    };
    fetchMeetings();
  }, [selectedClient, showRescheduleDrawer]);

  const onClientUpdate = useCallback(async () => {
    if (!selectedClient?.id) return;

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
            *,
            accounting_currencies!leads_lead_currency_id_fkey (
              name,
              iso_code
            ),
            misc_language!leads_lead_language_id_fkey (
              name
            )
          `)
          .eq('id', legacyId)
          .single();

        data = legacyData;
        error = legacyError;

        if (data) {
          // Fetch emails for legacy lead
          const { data: legacyEmails, error: emailsError } = await supabase
            .from('emails')
            .select('*')
            .eq('legacy_id', data.id)
            .order('sent_at', { ascending: false });
            
          if (emailsError) {
            console.error('Error fetching legacy emails:', emailsError);
          }
          
          console.log('📧 Legacy emails fetched in onClientUpdate:', legacyEmails?.length || 0, 'emails');
          
          // Transform legacy lead to match new lead structure
          const transformedData = {
            ...data,
            id: `legacy_${data.id}`,
            lead_number: String(data.id), // Always use id as lead_number for legacy leads
            stage: data.stage !== null && data.stage !== undefined ? String(data.stage) : '',
            source: String(data.source_id || ''),
            created_at: data.cdate,
            updated_at: data.udate,
            notes: data.notes || '',
            special_notes: data.special_notes || '',
            next_followup: data.next_followup || '',
            probability: String(data.probability || ''),
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
            language: data.misc_language?.name || String(data.language_id || ''), // Get language name from joined table
            balance: String(data.total || ''), // Map total to balance
            balance_currency: (() => {
              // Use accounting_currencies name if available, otherwise fallback
              if (data.accounting_currencies?.name) {
                return data.accounting_currencies.name;
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
            emails: legacyEmails || [],
            closer: data.closer_id, // Use closer_id from legacy table
            handler: data.case_handler_id, // Use case_handler_id from legacy table
            unactivation_reason: data.unactivation_reason || null, // Use unactivation_reason from legacy table
            potential_total: data.potential_total || null, // Include potential_total for legacy leads
          };
          console.log('onClientUpdate: Setting transformed legacy data:', transformedData);
          console.log('onClientUpdate: Currency mapping - currency_id:', data.currency_id, 'balance_currency:', transformedData.balance_currency);
          setSelectedClient(transformedData);
        }
      } else {
        // For new leads, fetch from leads table
        const { data: newData, error: newError } = await supabase
          .from('leads')
          .select('*, emails (*), closer')
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
          const transformedData = {
            ...data,
            category: categoryName,
          };
          console.log('onClientUpdate: Setting new lead data:', transformedData);
          setSelectedClient(transformedData);
        }
      }

      if (error) {
        console.error('Error refreshing client data:', error);
      }
    } catch (error) {
      console.error('Error refreshing client data:', error);
    }
  }, [selectedClient?.id, setSelectedClient, allCategories]);

  // Refresh client data when categories are loaded to update category names
  useEffect(() => {
    const refreshClientData = async () => {
      if (allCategories.length > 0 && selectedClient?.id) {
        console.log('🔄 Categories loaded, refreshing client data to update category names');
        try {
          await onClientUpdate();
        } catch (error) {
          console.error('🔄 onClientUpdate failed:', error);
        }
      }
    };
    
    refreshClientData();
  }, [allCategories, selectedClient?.id, onClientUpdate]);
  // Essential data loading for initial page display
  useEffect(() => {
    let isMounted = true;
    const fetchEssentialData = async () => {
      console.log('🚀 fetchEssentialData STARTED');
      setLocalLoading(true);
      console.log('🔍 fetchEssentialData called with lead_number:', lead_number);
      console.log('🔍 fullLeadNumber:', fullLeadNumber);
      if (lead_number) {
        console.log('Fetching essential client data with lead_number:', fullLeadNumber);
        
        // Try to find the lead in both tables
        let clientData = null;
        
        const isManualIdCandidate = /^\d+$/.test(fullLeadNumber);
        console.log('🔍 Treating as manual_id candidate:', isManualIdCandidate, 'requestedLeadNumber:', requestedLeadNumber);
        
        if (isManualIdCandidate) {
          console.log('🔍 Querying new leads by manual_id:', fullLeadNumber);
          const { data: manualResults, error: manualError } = await supabase
            .from('leads')
            .select('*, client_country, emails (*), closer, handler')
            .eq('manual_id', fullLeadNumber);

          if (manualError) {
            console.error('❌ Error querying leads by manual_id:', manualError);
          } else if (manualResults && manualResults.length > 0) {
            console.log('✅ Found leads with matching manual_id:', manualResults.length);
            let chosenLead = null;

            if (requestedLeadNumber) {
              chosenLead = manualResults.find(lead => lead.lead_number === requestedLeadNumber);
              console.log('🔍 Requested lead_number match:', {
                requestedLeadNumber,
                found: !!chosenLead,
              });
            }

            if (!chosenLead) {
              chosenLead = manualResults.find(lead => typeof lead.lead_number === 'string' && lead.lead_number.includes('/1'));
              if (chosenLead) {
                console.log('🔍 Defaulting to master lead with /1 suffix:', chosenLead.lead_number);
              }
            }

            if (!chosenLead) {
              chosenLead = manualResults[0];
              console.log('🔍 Defaulting to first lead for manual_id:', chosenLead?.id);
            }

            if (chosenLead) {
              const categoryName = getCategoryName(chosenLead.category_id, chosenLead.category);
              clientData = {
                ...chosenLead,
                category: categoryName,
              };
              console.log('✅ Selected client from manual_id lookup:', {
                id: clientData.id,
                manual_id: clientData.manual_id,
                lead_number: clientData.lead_number,
              });
            }
          }
        }
        
        // Check if this looks like a legacy lead ID (numeric)
        const isLegacyLeadId = /^\d+$/.test(fullLeadNumber);
        console.log('🔍 isLegacyLeadId:', isLegacyLeadId);
        
        if (!clientData && isLegacyLeadId) {
          // For numeric IDs, try legacy table first
          console.log('🔍 Querying legacy table for ID:', parseInt(fullLeadNumber));
          const { data: legacyLead, error: legacyError } = await supabase
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
            .eq('id', parseInt(fullLeadNumber))
            .single();
          
                    console.log('🔍 Legacy query result:', { legacyLead, legacyError });
          console.log('🔍 Legacy lead data:', legacyLead);
          console.log('🔍 Legacy lead stage:', legacyLead?.stage);
          console.log('🔍 Legacy lead unactivation_reason:', legacyLead?.unactivation_reason);
          
          if (!legacyError && legacyLead) {
              console.log('🔍 Legacy lead found:', legacyLead);
              console.log('🔍 Legacy lead stage:', legacyLead.stage);
              console.log('🔍 Legacy lead unactivation_reason:', legacyLead.unactivation_reason);
              // Fetch emails for legacy lead
              console.log('🔍 Fetching emails for legacy lead ID:', legacyLead.id);
            const { data: legacyEmails, error: emailsError } = await supabase
              .from('emails')
              .select('*')
              .eq('legacy_id', legacyLead.id)
              .order('sent_at', { ascending: false });
            
            console.log('🔍 Email query result:', { 
              legacyId: legacyLead.id, 
              emailsFound: legacyEmails?.length || 0,
              error: emailsError,
              sampleEmails: legacyEmails?.slice(0, 2)
            });
            
            if (emailsError) {
              console.error('❌ Error fetching legacy emails:', emailsError);
            } else {
              console.log('✅ Legacy emails fetched:', legacyEmails?.length || 0, 'emails');
              if (legacyEmails && legacyEmails.length > 0) {
                console.log('📧 Sample legacy email:', legacyEmails[0]);
              }
            }
            
            // Transform legacy lead to match new lead structure
            
            // Get scheduler name if meeting_scheduler_id exists
            let schedulerName = null;
            if (legacyLead.meeting_scheduler_id) {
              try {
                const { data: schedulerData, error: schedulerError } = await supabase
                  .from('tenants_employee')
                  .select('name')
                  .eq('id', legacyLead.meeting_scheduler_id)
                  .single();
                
                if (!schedulerError && schedulerData?.name) {
                  schedulerName = schedulerData.name;
                }
              } catch (error) {
                console.log('Could not fetch scheduler name:', error);
              }
            }
            
            clientData = {
              ...legacyLead,
              id: `legacy_${legacyLead.id}`,
              lead_number: legacyLead.manual_id || String(legacyLead.id), // Use manual_id if exists, otherwise use id
              stage: legacyLead.stage !== null && legacyLead.stage !== undefined ? String(legacyLead.stage) : '',
              source: String(legacyLead.source_id || ''),
              created_at: legacyLead.cdate,
              updated_at: legacyLead.udate,
              notes: legacyLead.notes || '',
              special_notes: legacyLead.special_notes || '',
              next_followup: legacyLead.next_followup || '',
              probability: String(legacyLead.probability || ''),
                    category: (() => {
                      console.log('🔍 Processing legacy lead category - raw data:', { 
                        category_id: legacyLead.category_id, 
                        category: legacyLead.category,
                        allCategoriesLoaded: allCategories.length > 0
                      });
                      const categoryName = getCategoryName(legacyLead.category_id, legacyLead.category);
                      console.log('🔍 Processing legacy lead category result:', { category_id: legacyLead.category_id, category_name: categoryName });
                      return categoryName;
                    })(),
              language: legacyLead.misc_language?.name || String(legacyLead.language_id || ''), // Get language name from joined table
              balance: String(legacyLead.total || ''), // Map total to balance
              balance_currency: (() => {
                // Use accounting_currencies name if available, otherwise fallback
                if (legacyLead.accounting_currencies?.name) {
                  return legacyLead.accounting_currencies.name;
                } else {
                  // Fallback currency mapping based on currency_id
                  switch (legacyLead.currency_id) {
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
              emails: legacyEmails || [],
              closer: legacyLead.closer_id, // Use closer_id from legacy table
              handler: legacyLead.case_handler_id, // Use case_handler_id from legacy table
              scheduler: schedulerName, // Use resolved scheduler name
              unactivation_reason: legacyLead.unactivation_reason || null,
            };
            console.log('🔍 Transformed clientData:', clientData);
            console.log('🔍 clientData.stage:', clientData.stage);
            console.log('🔍 clientData.unactivation_reason:', clientData.unactivation_reason);
            console.log('🔍 Legacy lead stage after transformation:', clientData.stage);
            console.log('🔍 Legacy lead stage type after transformation:', typeof clientData.stage);
          }
        } else if (!clientData) {
          // For non-numeric IDs, try new leads table first
          const { data: newLead, error: newError } = await supabase
            .from('leads')
            .select('*, client_country, emails (*), closer, handler')
            .eq('lead_number', fullLeadNumber)
            .single();

          if (!newError && newLead) {
            // Transform new lead to include category name
            console.log('🔍 Processing new lead lookup category - raw data:', { 
              category_id: newLead.category_id, 
              category: newLead.category,
              allCategoriesLoaded: allCategories.length > 0,
              allCategories: allCategories.map(cat => ({ id: cat.id, name: cat.name }))
            });
            const categoryName = getCategoryName(newLead.category_id, newLead.category);
            console.log('🔍 Processing new lead lookup category result:', { category_id: newLead.category_id, category_name: categoryName });
            clientData = {
              ...newLead,
                    category: categoryName,
            };
          }
        }

        console.log('Database query result:', { clientData });
        if (!clientData) {
          console.error('Client not found in either table');
          navigate('/clients');
        } else if (isMounted) {
          setSelectedClient(clientData);
          // Set unactivated view immediately if lead is unactivated
          const isLegacy = clientData.lead_type === 'legacy' || clientData.id?.toString().startsWith('legacy_');
          const unactivationReason = clientData.unactivation_reason;
          const stageName = getStageName(clientData.stage);
          const stageUnactivated = areStagesEquivalent(stageName, 'unactivated') || areStagesEquivalent(stageName, 'dropped_spam_irrelevant');
          // For legacy leads, show unactivated view if stage is 91 (Dropped Spam/Irrelevant) or if deactivate_note exists
          const isUnactivated = isLegacy ? 
            (String(clientData.stage) === '91' || (unactivationReason && unactivationReason.trim() !== '')) :
            ((unactivationReason && unactivationReason.trim() !== '') || stageUnactivated);
          setIsUnactivatedView(!!(clientData && isUnactivated && !userManuallyExpanded));
        }
      } else {
        // Get the most recent lead from either table
        const allLeads = await fetchAllLeads();
        if (allLeads.length > 0 && isMounted) {
          const latestLead = allLeads[0];
          const latestManualId = (latestLead as any)?.manual_id;
          const latestLeadNumber = (latestLead as any)?.lead_number;
          navigate(buildClientRoute(latestManualId, latestLeadNumber));
          setSelectedClient(latestLead);
          const isLegacy = latestLead.lead_type === 'legacy' || latestLead.id?.toString().startsWith('legacy_');
          const unactivationReason = latestLead.unactivation_reason;
          const stageName = getStageName(latestLead.stage);
          const stageUnactivated = areStagesEquivalent(stageName, 'unactivated') || areStagesEquivalent(stageName, 'dropped_spam_irrelevant');
          // For legacy leads, show unactivated view if stage is 91 (Dropped Spam/Irrelevant) or if deactivate_note exists
          const isUnactivated = isLegacy ? 
            (String(latestLead.stage) === '91' || (unactivationReason && unactivationReason.trim() !== '')) :
            ((unactivationReason && unactivationReason.trim() !== '') || stageUnactivated);
          setIsUnactivatedView(!!(latestLead && isUnactivated && !userManuallyExpanded));
        }
      }
      if (isMounted) setLocalLoading(false);
    };

    fetchEssentialData();
    
    return () => { isMounted = false; };
  }, [lead_number, navigate, setSelectedClient, fullLeadNumber, requestedLeadNumber]); // Removed selectedClient dependencies to prevent infinite loops

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
            supabase.from('accounting_currencies').select('id, name, iso_code').order('id')
          ]).then(([newCurrencies, legacyCurrencies]) => ({ newCurrencies, legacyCurrencies })),
          supabase.from('meeting_locations').select('id, name').eq('is_active', true).order('order_value', { ascending: true }),
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
        
        // Process meeting locations
        if (!meetingLocationsResult.error && meetingLocationsResult.data) {
          setMeetingLocations(meetingLocationsResult.data);
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
        // Fetch latest meeting date for case summary
        const { data, error } = await supabase
          .from('meetings')
          .select('meeting_date')
          .eq('client_id', selectedClient.id)
          .not('meeting_date', 'is', null)
          .order('meeting_date', { ascending: false })
          .limit(1);
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
      setMeetingFormData(prev => ({
        ...prev,
        location: meetingLocations[0].name
      }));
    }
  }, [meetingLocations, meetingFormData.location]);

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
      await updateLeadStage('meeting_paid');
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

      // For legacy leads, also update the stage
      if (isLegacy) {
        // Use the known numeric ID for 'unactivated' stage in legacy system
        updateData.stage = 91;
      } else {
        updateData.stage = '91';
      }

      const stageActor = await fetchStageActorInfo();
      updateData.stage_changed_by = currentUserFullName;
      updateData.stage_changed_at = updateData.unactivated_at;

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq(idField, clientId);
      
      if (error) throw error;

      await recordLeadStageChange({
        lead: selectedClient,
        stage: isLegacy ? 91 : '91',
        actor: stageActor,
        timestamp: updateData.unactivated_at,
      });
      
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

      const stageActor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();
      let stageForHistory: number | null = await getLatestStageBeforeStage(selectedClient);

      if (stageForHistory === null) {
        const previousStage = selectedClient.previous_stage ?? (isLegacy ? 1 : null);
        if (previousStage !== null && previousStage !== undefined) {
          const numericPrevious =
            typeof previousStage === 'number'
              ? previousStage
              : Number.parseInt(String(previousStage), 10);
          if (Number.isFinite(numericPrevious)) {
            stageForHistory = numericPrevious;
          }
        }
      }

      if (stageForHistory !== null) {
        updateData.stage = isLegacy ? stageForHistory : stageForHistory.toString();
        updateData.stage_changed_by = currentUserFullName;
        updateData.stage_changed_at = stageTimestamp;
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

      if (stageForHistory !== null) {
        await recordLeadStageChange({
          lead: selectedClient,
          stage: stageForHistory,
          actor: stageActor,
          timestamp: stageTimestamp,
        });
      }

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
      
      const additionalFields: Record<string, any> = {};
      if (!isLegacyLead && stage === 'communication_started') {
        additionalFields.communication_started_by = actor.fullName;
        additionalFields.communication_started_at = timestamp;
      }

      await updateLeadStageWithHistory({
        lead: selectedClient,
        stage,
        additionalFields,
        actor,
        timestamp,
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
  const handleStageChange = async (newStageId: string) => {
    await updateLeadStage(newStageId);
  };
  const updateScheduler = async (scheduler: string) => {
    if (!selectedClient) return;
    
    try {
      const actor = await fetchStageActorInfo();
      const timestamp = new Date().toISOString();
      const isLegacyLead = selectedClient.id.startsWith('legacy_');
      
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
            stage: 'scheduler_assigned',
            stage_changed_by: actor.fullName,
            stage_changed_at: timestamp,
          })
          .eq('id', selectedClient.id);
        
        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: 'scheduler_assigned',
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

  const getStageBadge = (stage: string) => {
    console.log('🔍 getStageBadge called with stage:', stage);
    console.log('🔍 Stage type:', typeof stage);
    const stageName = getStageName(stage);
    console.log('🔍 Stage name resolved:', stageName);
    return (
      <div className="dropdown dropdown-end">
        <label 
          tabIndex={0} 
          className="badge badge-sm ml-2 px-3 py-1 min-w-max whitespace-nowrap cursor-pointer hover:bg-purple-50 transition-colors"
          style={{ background: '#ffffff', color: '#7c3aed', fontSize: '0.875rem', borderRadius: '0.5rem', minHeight: '1.5rem', border: '2px solid #7c3aed' }}
        >
          {stageName}
          <ChevronDownIcon className="w-3 h-3 ml-1" />
        </label>
        <ul 
          tabIndex={0} 
          className="dropdown-content z-[1] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56 shadow-lg border border-gray-200"
        >
          {availableStages.map((stageOption) => (
            <li key={stageOption.id}>
              <a 
                className={`flex items-center gap-3 py-3 hover:bg-gray-50 transition-colors rounded-lg ${
                  stage === stageOption.id ? 'bg-purple-50 text-purple-700 font-semibold' : ''
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleStageChange(stageOption.id);
                }}
              >
                <span className="font-medium">{stageOption.name}</span>
                {stage === stageOption.id && (
                  <CheckIcon className="w-4 h-4 text-purple-600" />
                )}
              </a>
            </li>
          ))}
        </ul>
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
    });
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

      // Test calendar access first
      const calendarEmail = meetingFormData.calendar === 'active_client' 
        ? 'shared-newclients@lawoffice.org.il' 
        : 'shared-potentialclients@lawoffice.org.il';
      
      console.log('🔍 Testing calendar access for:', calendarEmail);
      const hasAccess = await testCalendarAccess(accessToken, calendarEmail);
      
      if (!hasAccess) {
        toast.error(`Cannot access calendar ${calendarEmail}. Please check permissions or contact your administrator.`, {
          duration: 5000,
          position: 'top-right',
          style: {
            background: '#ef4444',
            color: '#fff',
            fontWeight: '500',
            maxWidth: '500px',
          },
          icon: '🔒',
        });
        setIsCreatingMeeting(false);
        return;
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
      const meetingSubject = `[#${selectedClient.lead_number}] ${selectedClient.name} - ${categoryName} - ${meetingFormData.brief || 'Meeting'}`;
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
          brief: meetingFormData.brief,
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
        toast.error(`Failed to create calendar event: ${errorMessage}`, {
          duration: 6000,
          position: 'top-right',
          style: {
            background: '#ef4444',
            color: '#fff',
            fontWeight: '500',
            maxWidth: '500px',
          },
        });
        setIsCreatingMeeting(false);
        return;
      }

      // Check if this is a legacy lead
      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      
      // For both new and legacy leads, create meeting record in meetings table
      const legacyId = isLegacyLead ? selectedClient.id.toString().replace('legacy_', '') : null;
      
      const meetingData = {
        client_id: isLegacyLead ? null : selectedClient.id, // Use null for legacy leads
        legacy_lead_id: isLegacyLead ? legacyId : null, // Use legacy_lead_id for legacy leads
        meeting_date: meetingFormData.date,
        meeting_time: meetingFormData.time,
        meeting_location: meetingFormData.location,
        meeting_manager: meetingFormData.manager || '',
        meeting_currency: '₪',
        meeting_amount: 0,
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


      // Update lead stage to 'meeting_scheduled' and set scheduler
      const stageActor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();

      if (isLegacyLead) {
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        const { error } = await supabase
          .from('leads_lead')
          .update({ 
            stage: 'meeting_scheduled',
            meeting_scheduler_id: currentUserFullName,
            stage_changed_by: stageActor.fullName,
            stage_changed_at: stageTimestamp,
          })
          .eq('id', legacyId);

        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: 'meeting_scheduled',
          actor: stageActor,
          timestamp: stageTimestamp,
        });
      } else {
        const { error } = await supabase
          .from('leads')
          .update({ 
            stage: 'meeting_scheduled',
            scheduler: currentUserFullName,
            stage_changed_by: stageActor.fullName,
            stage_changed_at: stageTimestamp,
          })
          .eq('id', selectedClient.id);

        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: 'meeting_scheduled',
          actor: stageActor,
          timestamp: stageTimestamp,
        });
      }

      // Update UI
      setShowScheduleMeetingPanel(false);
      setIsSchedulingMeeting(false);
      setIsCreatingMeeting(false);
      setSelectedStage(null); // Close the dropdown
      
      // Reset form
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
      });
      
      // Show success message
      toast.success('Meeting scheduled successfully!', {
        duration: 4000,
        position: 'top-right',
        style: {
          background: '#10b981',
          color: '#fff',
          fontWeight: '500',
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
      const stageValue = isLegacyLead ? 91 : '91';

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

    // If proposalTotal is changed, update balance as well
    const proposalTotal = parseFloat(meetingEndedData.proposalTotal);
    const updateData: Record<string, any> = {
      probability: meetingEndedData.probability,
      meeting_brief: meetingEndedData.meetingBrief,
      number_of_applicants_meeting: meetingEndedData.numberOfApplicants,
      potential_applicants_meeting: meetingEndedData.potentialApplicants,
      proposal_total: proposalTotal,
      proposal_currency: meetingEndedData.proposalCurrency,
      balance: proposalTotal, // Sync balance to proposal_total
      balance_currency: meetingEndedData.proposalCurrency,
      stage: 'waiting_for_mtng_sum',
    };

    try {
      const actor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();
      updateData.stage_changed_by = actor.fullName;
      updateData.stage_changed_at = stageTimestamp;
      updateData.stage = 'waiting_for_mtng_sum';

      // First, find the most recent meeting to update it
      const { data: meetings, error: meetingsError } = await supabase
        .from('meetings')
        .select('id')
        .eq('client_id', selectedClient.id)
        .order('meeting_date', { ascending: false })
        .limit(1);

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

      const { error } = await supabase
        .from('leads')
        .update(updateData)
        .eq('id', selectedClient.id);
      
      if (error) throw error;

      await recordLeadStageChange({
        lead: selectedClient,
        stage: 'waiting_for_mtng_sum',
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
      
      const actor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();
      let updateData;
      
      if (isLegacyLead) {
        // For legacy leads, map fields to leads_lead table columns
        updateData = {
          meeting_scheduling_notes: meetingNotes,
          next_followup: nextFollowup,
          followup_log: followup, // Map to followup_log column
          potential_applicants: potentialApplicants,
          stage: 15, // 'communication_started' stage ID for legacy leads
          stage_changed_by: actor.fullName,
          stage_changed_at: stageTimestamp,
        };
        
        // For legacy leads, update the leads_lead table
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        console.log('Updating legacy lead with ID:', legacyId);
        
        const { error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);
        
        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: 15,
          actor,
          timestamp: stageTimestamp,
        });
      } else {
        // For new leads, update the leads table
        updateData = {
          meeting_scheduling_notes: meetingNotes,
          next_followup: nextFollowup,
          followup: followup,
          potential_applicants: potentialApplicants,
          stage: 'communication_started',
          stage_changed_by: actor.fullName,
          stage_changed_at: stageTimestamp,
        };
        
        console.log('Updating new lead with ID:', selectedClient.id);
        
        const { error } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', selectedClient.id);
        
        if (error) throw error;

        await recordLeadStageChange({
          lead: selectedClient,
          stage: 'communication_started',
          actor,
          timestamp: stageTimestamp,
        });
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

  // English and Hebrew offer templates
  const offerTemplates = {
    en: {
      name: 'Offer (English)',
      subject: 'Price Offer for Your Case',
      body: `Dear {client_name},\n\nWe are pleased to present you with the following price offer for our professional services regarding your case:\n\n- Comprehensive case review and documentation\n- Legal representation throughout the process\n- Ongoing support and communication\n\nOur team is committed to providing you with the highest level of service and expertise. Should you have any questions or require further clarification, please do not hesitate to contact us.\n\nWe look forward to working with you and achieving the best possible outcome for your case.\n\nBest regards,\nThe Law Firm Team`
    },
    he: {
      name: 'הצעת מחיר (עברית)',
      subject: 'הצעת מחיר עבור התיק שלך',
      body: `לקוח/ה יקר/ה,\n\nאנו שמחים להגיש בפניך הצעת מחיר עבור השירותים המשפטיים שאנו מציעים בטיפול בתיקך:\n\n- בדיקת מסמכים מקיפה והכנת התיק\n- ייצוג משפטי מלא לאורך כל התהליך\n- ליווי אישי וזמינות לשאלות\n\nצוות המשרד שלנו מחויב למתן שירות מקצועי, אמין ואישי. לכל שאלה או הבהרה, נשמח לעמוד לרשותך.\n\nנשמח ללוות אותך עד להצלחה.\n\nבברכה,\nצוות המשרד`
    }
  };

  // Open drawer and prefill subject/body
  const openSendOfferDrawer = () => {
    setOfferSubject(`[${selectedClient.lead_number}] - ${selectedClient.name} - ${selectedClient.topic}`);
    setOfferBody('');
    setOfferTemplateLang(null);
    setOfferTotal(selectedClient?.proposal_total || '');
    setOfferCurrency(selectedClient?.proposal_currency || '₪');
    setShowSendOfferDrawer(true);
  };
  // Send offer email logic (reuse InteractionsTab logic)
  const handleSendOfferEmail = async () => {
    if (!selectedClient.email) return;
    setOfferSending(true);
    try {
      // Get accessToken using MSAL instance (same as Teams logic)
      let accessToken;
      const account = instance.getAllAccounts()[0];
      if (!account) {
        toast.error('You must be signed in to send an email.');
        setOfferSending(false);
        return;
      }
      // Use Supabase user's full_name as closer
      const closerName = (await fetchCurrentUserFullName()) || 'Current User';
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
      await sendEmail(accessToken, {
        to: selectedClient.email,
        subject: offerSubject,
        body: offerBody.replace(/\n/g, '<br>'),
      });
      // Save the offer body, total, currency, closer, and update stage
      const stageActor = await fetchStageActorInfo();
      const stageTimestamp = new Date().toISOString();

      await supabase
        .from('leads')
        .update({
          proposal_text: offerBody,
          proposal_total: offerTotal,
          proposal_currency: offerCurrency,
          closer: closerName,
          stage: 'Mtng sum+Agreement sent',
          stage_changed_by: stageActor.fullName,
          stage_changed_at: stageTimestamp,
          balance: offerTotal ? parseFloat(offerTotal) : null, // Sync balance to proposal_total
          balance_currency: offerCurrency
        })
        .eq('id', selectedClient.id);

      await recordLeadStageChange({
        lead: selectedClient,
        stage: 'Mtng sum+Agreement sent',
        actor: stageActor,
        timestamp: stageTimestamp,
      });
      // --- Upsert sent offer email to emails table for Interactions tab ---
      const now = new Date();
      await supabase.from('emails').upsert([
        {
          message_id: `offer_${now.getTime()}`,
          client_id: selectedClient.id,
          thread_id: null,
          sender_name: closerName,
          sender_email: selectedClient.email, // or use the user's email if available
          recipient_list: selectedClient.email,
          subject: offerSubject,
          body_preview: offerBody.replace(/\n/g, '<br>'),
          sent_at: now.toISOString(),
          direction: 'outgoing',
          attachments: null,
        }
      ], { onConflict: 'message_id' });
      toast.success('Offer email sent!');
      setShowSendOfferDrawer(false);
      await onClientUpdate();
    } catch (e: any) {
      console.error('Error sending offer email:', e);
      
      // Check if this is a category validation error from RLS policy
      if (e?.message && e.message.includes('category')) {
        toast.error('Please set a category for this client before performing this action.', {
          duration: 4000,
          style: {
            background: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #fecaca',
          },
        });
      } else {
        toast.error('Failed to send offer email.');
      }
    }
    setOfferSending(false);
  };

  // Helper to generate the total line
  const getTotalLine = () => {
    if (!offerTotal) return '';
    return `Total cost of the offer: ${offerTotal} ${offerCurrency}`;
  };

  // Helper to inject or update the total line in the offer body
  const updateOfferBodyWithTotal = (body: string, total: string, currency: string) => {
    // Find the greeting (first line)
    const lines = body.split('\n');
    let insertIdx = 1;
    // Remove any previous total line
    const filtered = lines.filter(line => !line.trim().startsWith('Total cost of the offer:'));
    // Insert the new total line after greeting
    filtered.splice(insertIdx, 0, getTotalLine());
    return filtered.join('\n');
  };

  // Update offer body when total or currency changes, but only if a template is selected
  useEffect(() => {
    if (offerTemplateLang) {
      setOfferBody(prev => updateOfferBodyWithTotal(prev, offerTotal, offerCurrency));
    }
    // eslint-disable-next-line
  }, [offerTotal, offerCurrency]);

  const handleOpenSignedDrawer = () => {
    const today = new Date();
    setSignedDate(today.toISOString().split('T')[0]);
    setShowSignedDrawer(true);
  };

  const handleSaveSignedDrawer = async () => {
    if (!selectedClient) return;
    
    try {
      const actor = await fetchStageActorInfo();
      const currentUserFullName = actor.fullName;
      const stageTimestamp = new Date().toISOString();

      await supabase
        .from('leads')
        .update({ 
          stage: 'Client signed agreement', 
          date_signed: signedDate,
          stage_changed_by: currentUserFullName,
          stage_changed_at: stageTimestamp
        })
        .eq('id', selectedClient.id);

      await recordLeadStageChange({
        lead: selectedClient,
        stage: 'Client signed agreement',
        actor,
        timestamp: stageTimestamp,
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
    
    // Reset the edit form data with current client data
    setEditLeadData({
      tags: tagsString || selectedClient?.tags || '',
      source: selectedClient?.source || '',
      name: selectedClient?.name || '',
      language: selectedClient?.language || '',
      category: selectedClient?.category || '',
      topic: selectedClient?.topic || '',
      special_notes: selectedClient?.special_notes || '',
      probability: selectedClient?.probability || 0,
      number_of_applicants_meeting: selectedClient?.number_of_applicants_meeting || '',
      potential_applicants_meeting: selectedClient?.potential_applicants_meeting || '',
      balance: selectedClient?.balance || selectedClient?.total || '',
      next_followup: selectedClient?.next_followup || '',
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

  const handlerOptions = useMemo(() => {
    const employees = allEmployees || [];
    const map = new Map<string, string>();

    employees.forEach(emp => {
      if (!emp) return;
      const id = emp.id != null ? String(emp.id) : emp.employee_id != null ? String(emp.employee_id) : '';
      if (!id) return;

      const candidateName = emp.display_name || emp.full_name || emp.name || emp.email || '';
      if (!candidateName) return;

      const activeFlags = [
        emp.active,
        emp.is_active,
        emp.user_active,
        emp.enabled,
        emp.status === 'active',
      ];
      const hasActiveInfo = activeFlags.some(flag => flag !== undefined && flag !== null);
      const isActive = activeFlags.some(flag =>
        flag === true ||
        flag === 'true' ||
        flag === 't' ||
        flag === '1' ||
        flag === 1
      );

      if (hasActiveInfo && !isActive) {
        return;
      }

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
      map.set(opt.id, opt.label);
    });
    return map;
  }, [handlerOptions]);

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
        if (editLeadData.probability !== selectedClient.probability) {
          // Handle empty string for numeric field
          let probabilityValue = null;
          if (editLeadData.probability !== '' && editLeadData.probability !== null && editLeadData.probability !== undefined) {
            const parsed = Number(editLeadData.probability);
            probabilityValue = isNaN(parsed) ? null : parsed;
          }
          updateData.probability = probabilityValue;
        }
        if (editLeadData.next_followup !== selectedClient.next_followup) {
          // Handle empty follow-up date - provide a default date if empty
          const followupValue = editLeadData.next_followup === '' || editLeadData.next_followup === null ? 
            new Date().toISOString().split('T')[0] : editLeadData.next_followup;
          updateData.next_followup = followupValue;
        }
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
        if (editLeadData.probability !== selectedClient.probability) {
          // Handle empty string for numeric field
          let probabilityValue = null;
          if (editLeadData.probability !== '' && editLeadData.probability !== null && editLeadData.probability !== undefined) {
            const parsed = Number(editLeadData.probability);
            probabilityValue = isNaN(parsed) ? null : parsed;
          }
          updateData.probability = probabilityValue;
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
        if (editLeadData.next_followup !== selectedClient.next_followup) {
          // Handle empty follow-up date - provide a default date if empty
          const followupValue = editLeadData.next_followup === '' || editLeadData.next_followup === null ? 
            new Date().toISOString().split('T')[0] : editLeadData.next_followup;
          updateData.next_followup = followupValue;
        }
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
  // Add the reschedule save handler
  const handleRescheduleMeeting = async () => {
    if (!selectedClient || !meetingToDelete || !rescheduleFormData.date || !rescheduleFormData.time) return;
    try {
      // 1. Delete the selected meeting
      await supabase.from('meetings').delete().eq('id', meetingToDelete);

      // 2. Create the new meeting
      const account = instance.getAllAccounts()[0];
      let teamsMeetingUrl = '';
      if (rescheduleFormData.location === 'Teams') {
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
        const [year, month, day] = rescheduleFormData.date.split('-').map(Number);
        const [hours, minutes] = rescheduleFormData.time.split(':').map(Number);
        const start = new Date(year, month - 1, day, hours, minutes);
        const end = new Date(start.getTime() + 30 * 60000);
        const teamsMeetingData = await createTeamsMeeting(accessToken, {
          subject: `[#${selectedClient.lead_number}] ${selectedClient.name} - ${selectedClient.category || 'No Category'} - Meeting`,
          startDateTime: start.toISOString(),
          endDateTime: end.toISOString(),
          manager: rescheduleFormData.manager,
          helper: rescheduleFormData.helper,
          brief: rescheduleFormData.brief,
          attendance_probability: rescheduleFormData.attendance_probability,
          complexity: rescheduleFormData.complexity,
          car_number: rescheduleFormData.car_number,
          expert: selectedClient.expert || '---',
          amount: 0,
          currency: '₪',
        });
        teamsMeetingUrl = teamsMeetingData.joinUrl;
      }
      const { error: meetingError } = await supabase
        .from('meetings')
        .insert([{
          client_id: selectedClient.id,
          meeting_date: rescheduleFormData.date,
          meeting_time: rescheduleFormData.time,
          meeting_location: rescheduleFormData.location,
          meeting_manager: rescheduleFormData.manager, // do not default to account.name
          meeting_currency: rescheduleFormData.currency,
          meeting_amount: rescheduleFormData.amount ? parseFloat(rescheduleFormData.amount) : 0,
          expert: selectedClient.expert || '---',
          helper: rescheduleFormData.helper || '---',
          teams_meeting_url: teamsMeetingUrl,
          meeting_brief: '',
          last_edited_timestamp: new Date().toISOString(),
          last_edited_by: account?.name,
        }]);
      if (meetingError) throw meetingError;

      // 3. Send notification email to client
      if (selectedClient.email) {
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
        // Compose the new template
        const userName = account?.name || 'Staff';
        let signature = (account && (account as any).signature) ? (account as any).signature : null;
        if (!signature) {
          signature = `<br><br>${userName},<br>Decker Pex Levi Law Offices`;
        }
        // Fetch the latest meeting for the client to get the correct teams_meeting_url
        const { data: latestMeetings, error: fetchMeetingError } = await supabase
          .from('meetings')
          .select('*')
          .eq('client_id', selectedClient.id)
          .order('meeting_date', { ascending: false })
          .order('meeting_time', { ascending: false })
          .limit(1);
        if (fetchMeetingError) throw fetchMeetingError;
        const latestMeeting = latestMeetings && latestMeetings.length > 0 ? latestMeetings[0] : null;
        const meetingLink = getValidTeamsLink(latestMeeting?.teams_meeting_url);
        const joinButton = meetingLink
          ? `<div style='margin:24px 0;'>
              <a href='${meetingLink}' target='_blank' style='background:#3b28c7;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;'>Join Meeting</a>
            </div>`
          : '';
        const emailBody = `
          <div style='font-family:sans-serif;font-size:16px;color:#222;'>
            <p>Dear ${selectedClient.name},</p>
            <p>Your previous meeting has been canceled as per your request. Please find below the details for your new meeting:</p>
            <ul style='margin:16px 0 24px 0;padding-left:20px;'>
              <li><strong>Date:</strong> ${rescheduleFormData.date}</li>
              <li><strong>Time:</strong> ${rescheduleFormData.time}</li>
              <li><strong>Location:</strong> ${rescheduleFormData.location}</li>
            </ul>
            ${joinButton}
            <p>If you have any questions or need to reschedule again, please let us know.</p>
            <div style='margin-top:32px;'>${signature}</div>
          </div>
        `;
        const subject = `[${selectedClient.lead_number}] - ${selectedClient.name} - ${rescheduleFormData.date} ${rescheduleFormData.time} ${rescheduleFormData.location} - Your meeting has been rescheduled`;
        await sendEmail(accessToken, {
          to: selectedClient.email,
          subject,
          body: emailBody,
        });
      }
      // 4. Show toast and close drawer
      toast.success('The new meeting was scheduled and the client was notified.');
      setShowRescheduleDrawer(false);
      setMeetingToDelete(null);
      setRescheduleFormData({ date: '', time: '09:00', location: 'Teams', manager: '', helper: '', amount: '', currency: '₪' });
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      toast.error('Failed to reschedule meeting.');
      console.error(error);
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
    setShowPaymentsPlanDrawer(false);
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
  
  // Note: Interaction count is now calculated upfront when entering the client page

  // Tabs array with dynamic interaction count - memoized to ensure updates
  const tabs = useMemo(() => {
    const finalCount = interactionCount || calculateInteractionCountSync();
    
    return [
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
  }, [interactionCount, selectedClient]);
  
  // Force re-render when interaction count changes
  const tabsKey = `tabs-${interactionCount}-${selectedClient?.id}`;

  // Calculate full interaction count when client changes
  useEffect(() => {
    const updateInteractionCount = async () => {
      if (selectedClient) {
        const count = await calculateFullInteractionCount();
        setInteractionCount(count);
      }
    };
    
    updateInteractionCount();
  }, [selectedClient?.id]);

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
  
  // Add persistent state for sub-lead detection
  const [persistentIsSubLead, setPersistentIsSubLead] = useState<boolean | null>(null);
  const [persistentMasterLeadNumber, setPersistentMasterLeadNumber] = useState<string | null>(null);

  // After extracting fullLeadNumber
  // Check if this is a sub-lead by looking at the lead_number in the database
  // Logic: If database lead_number contains '/', then it's a sub-lead
  // Example: lead_number = "192974/1" means this is a sub-lead of master lead "192974"
  const clientLeadNumber = selectedClient?.lead_number ?? '';
  const isSubLead = !!clientLeadNumber && clientLeadNumber.includes('/');
  const masterLeadNumber = isSubLead
    ? clientLeadNumber.split('/')[0]
    : selectedClient?.master_id || null;
  
  // Persist sub-lead detection when first detected
  useEffect(() => {
    if (isSubLead && masterLeadNumber && persistentIsSubLead === null) {
      console.log('🔍 Persisting sub-lead detection:', { isSubLead, masterLeadNumber });
      setPersistentIsSubLead(true);
      setPersistentMasterLeadNumber(masterLeadNumber);
      console.log('🔍 Persistent state set:', { persistentIsSubLead: true, persistentMasterLeadNumber: masterLeadNumber });
    }
  }, [isSubLead, masterLeadNumber, persistentIsSubLead]);

  // Reset persistent state only when the URL changes (different client)
  useEffect(() => {
    setPersistentIsSubLead(null);
    setPersistentMasterLeadNumber(null);
  }, [fullLeadNumber]); // Reset when URL changes, not when client data refreshes

  // Debug logging for master lead detection
  console.log('🔍 Master lead detection:', {
    routeIdentifier: fullLeadNumber,
    isSubLead,
    masterLeadNumber,
    persistentIsSubLead,
    persistentMasterLeadNumber,
    selectedClientId: selectedClient?.id,
    selectedClientLeadNumber: selectedClient?.lead_number,
    selectedClientManualId: selectedClient?.manual_id,
    masterId: selectedClient?.master_id,
    hasSlash: !!clientLeadNumber && clientLeadNumber.includes('/'),
    hasMasterId: !!(selectedClient && selectedClient.master_id),
    selectedClientData: selectedClient ? {
      id: selectedClient.id,
      lead_number: selectedClient.lead_number,
      master_id: selectedClient.master_id,
      manual_id: selectedClient.manual_id
    } : null,
    explanation: clientLeadNumber && clientLeadNumber.includes('/')
      ? `Lead number "${clientLeadNumber}" contains "/" → Sub-lead detected`
      : 'No sub-lead detected'
  });

  // Function to fetch sub-leads for master leads
  const fetchSubLeads = useCallback(async (baseLeadNumber: string) => {
    if (!baseLeadNumber || baseLeadNumber.trim() === '') {
      setSubLeads([]);
      setIsMasterLead(false);
      return [];
    }

    const normalizedBase = baseLeadNumber.trim();

    try {
      const { data, error } = await supabase
        .from('leads')
        .select('lead_number, name, stage, manual_id')
        .like('lead_number', `${normalizedBase}/%`)
        .order('lead_number', { ascending: true });

      if (error) {
        console.error('Error fetching sub-leads:', error);
        return [];
      }

      if (data && data.length > 0) {
        const filtered = data.filter(lead => {
          const leadNumberValue = lead.lead_number || '';
          return !!leadNumberValue && leadNumberValue.includes('/');
        });

        if (filtered.length > 0) {
          setSubLeads(filtered);
          setIsMasterLead(!(selectedClient?.master_id && String(selectedClient.master_id).trim() !== ''));
          return filtered;
        } else {
          setSubLeads([]);
          setIsMasterLead(false);
          return [];
        }
      } else {
        setSubLeads([]);
        setIsMasterLead(false);
        return [];
      }
    } catch (error) {
      console.error('Error fetching sub-leads:', error);
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
    const subLeadBase =
      selectedClient?.lead_number && String(selectedClient.lead_number).trim() !== ''
        ? (() => {
            const trimmed = String(selectedClient.lead_number).trim();
            return trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
          })()
        : selectedClient?.master_id && String(selectedClient.master_id).trim() !== ''
          ? (() => {
              const trimmed = String(selectedClient.master_id).trim();
              return trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
            })()
          : '';

    if (subLeadBase) {
      fetchSubLeads(subLeadBase);
    } else {
      setSubLeads([]);
      setIsMasterLead(false);
    }
  }, [selectedClient?.lead_number, selectedClient?.master_id, fetchSubLeads]);

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



  // Lead is cold logic (must be after null check)
  let isLeadCold = false;
  let coldLeadText = '';
  if (selectedClient && selectedClient.next_followup) {
    const today = new Date();
    const followupDate = new Date(selectedClient.next_followup);
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const followupMidnight = new Date(followupDate.getFullYear(), followupDate.getMonth(), followupDate.getDate());
    const diffDays = Math.floor((todayMidnight.getTime() - followupMidnight.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 7) {
      isLeadCold = true;
      coldLeadText = 'Follow up with client!';
    }
  }
  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component;
  // Before the return statement, add:
  let dropdownItems = null;
  // Get the stage name for comparison
  const currentStageName = selectedClient ? getStageName(selectedClient.stage) : '';
  if (selectedClient && areStagesEquivalent(currentStageName, 'Client signed agreement'))
    dropdownItems = (
      <>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { setShowPaymentsPlanDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}>
            <BanknotesIcon className="w-5 h-5 text-black" />
            Payments plan
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); (document.activeElement as HTMLElement)?.blur(); }}>
            <CalendarDaysIcon className="w-5 h-5 text-black" />
            Schedule Meeting
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { setShowLeadSummaryDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}>
            <DocumentTextIcon className="w-5 h-5 text-black" />
            Lead summary
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { updateLeadStage('payment_request_sent'); (document.activeElement as HTMLElement)?.blur(); }}>
            <CurrencyDollarIcon className="w-5 h-5 text-black" />
            Payment request sent
          </a>
        </li>

      </>
    );
  else if (selectedClient && (areStagesEquivalent(currentStageName, 'dropped_spam_irrelevant') || areStagesEquivalent(currentStageName, 'unactivated'))) {
    dropdownItems = (
      <li className="px-2 py-2 text-sm text-gray-500">
        Please activate lead in actions first.
      </li>
    );
  }
  else if (selectedClient && areStagesEquivalent(currentStageName, 'payment_request_sent')) {
    dropdownItems = (
      <>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); (document.activeElement as HTMLElement)?.blur(); }}>
            <CalendarDaysIcon className="w-5 h-5 text-black" />
            Schedule Meeting
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { setShowLeadSummaryDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}>
            <DocumentTextIcon className="w-5 h-5 text-black" />
            Lead summary
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={handlePaymentReceivedNewClient}>
            <CheckCircleIcon className="w-5 h-5 text-green-600" />
            Payment Received - new Client !!!
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { updateLeadStage('finances_and_payments_plan'); (document.activeElement as HTMLElement)?.blur(); }}>
            <BanknotesIcon className="w-5 h-5 text-black" />
            Finances & Payments plan
          </a>
        </li>
      </>
    );
  } else if (selectedClient && (() => {
    const excludedStages = ['client_signed', 'client_declined', 'Mtng sum+Agreement sent'];
    const isExcluded = excludedStages.some(stage => areStagesEquivalent(currentStageName, stage));
    return !isExcluded;
  })()) {
    dropdownItems = (
      <>
        {areStagesEquivalent(currentStageName, 'meeting_scheduled') ? (
          <>
            <li>
              <a className="flex items-center gap-3 py-3 saira-regular" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); (document.activeElement as HTMLElement)?.blur(); }}>
                <CalendarDaysIcon className="w-5 h-5 text-black" />
                Schedule Meeting
              </a>
            </li>
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
        ) : (
          !['Success', 'handler_assigned'].some(stage => areStagesEquivalent(currentStageName, stage)) && (
            <li>
              <a className="flex items-center gap-3 py-3 saira-regular" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); }}>
                <CalendarDaysIcon className="w-5 h-5 text-black" />
                Schedule Meeting
              </a>
            </li>
          )
        )}
        {areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') && (
          <li>
            <a className="flex items-center gap-3 py-3 saira-regular" onClick={openSendOfferDrawer}>
              <DocumentCheckIcon className="w-5 h-5 text-black" />
              Send Price Offer
            </a>
          </li>
        )}
        {(() => {
          const communicationExcludedStages = ['meeting_scheduled', 'waiting_for_mtng_sum', 'client_signed', 'client signed agreement', 'Client signed agreement', 'communication_started', 'Success', 'handler_assigned'];
          const isCommunicationExcluded = communicationExcludedStages.some(stage => areStagesEquivalent(currentStageName, stage));
          return !isCommunicationExcluded;
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
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); (document.activeElement as HTMLElement)?.blur(); }}>
            <CalendarDaysIcon className="w-5 h-5 text-black" />
            Schedule Meeting
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
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { setShowLeadSummaryDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}>
            <DocumentTextIcon className="w-5 h-5 text-black" />
            Lead summary
          </a>
        </li>
        <li>
                <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { openEditLeadDrawer(); (document.activeElement as HTMLElement)?.blur(); }}><PencilSquareIcon className="w-5 h-5 text-black" />Edit lead</a></li>
        <li>
          <a className="flex items-center gap-3 py-3 saira-regular" onClick={() => { updateLeadStage('revised_offer'); (document.activeElement as HTMLElement)?.blur(); }}>
            <PencilSquareIcon className="w-5 h-5 text-black" />
            Revised price offer
          </a>
        </li>
      </>
    );
  }

  // Sub-lead drawer state
  const [showSubLeadDrawer, setShowSubLeadDrawer] = useState(false);
  const [subLeadStep, setSubLeadStep] = useState<'initial' | 'newContact' | 'newProcedure' | 'details'>('initial');
  const [subLeadForm, setSubLeadForm] = useState({
    name: '',
    email: '',
    phone: '',
    category: '',
    categoryId: '',
    topic: '',
    special_notes: '',
    source: '',
    language: '',
    tags: '',
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

  const [leadsCheck, legacyCheck] = await Promise.all([
    supabase
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
      ),
    supabase
      .from('leads_lead')
      .select('id', { count: 'exact', head: true })
      .or(`manual_id.eq.${manualString},lead_number.eq.${manualString},id.eq.${manualString}`),
  ]);

  if (leadsCheck.error) throw leadsCheck.error;
  if (legacyCheck.error) throw legacyCheck.error;

  return (leadsCheck.count ?? 0) > 0 || (legacyCheck.count ?? 0) > 0;
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
  const [newManualMax, legacyManualMax, newLeadNumberMax, legacyLeadNumberMax, legacyIdMax] = await Promise.all([
    getMaxManualIdFromLeads(),
    getMaxManualIdFromLegacy(),
    getMaxLeadNumberFromLeads(),
    getMaxLeadNumberFromLegacy(),
    getMaxLegacyLeadId(),
  ]);
  const currentMax = [newManualMax, legacyManualMax, newLeadNumberMax, legacyLeadNumberMax, legacyIdMax].reduce(
    (acc, value) => (value > acc ? value : acc),
    BigInt(0)
  );
  return ensureUniqueManualId(currentMax + BigInt(1));
};

const computeNextSubLeadSuffix = async (baseLeadNumber: string): Promise<number> => {
  if (!baseLeadNumber || baseLeadNumber.trim() === '') {
    throw new Error('Invalid base lead number for sub-lead suffix calculation');
  }

  const normalizedBase = baseLeadNumber.trim();
  const normalizedNumericBase = extractDigits(normalizedBase);
  const suffixes: number[] = [];

  const { data: newLeadRows, error: newLeadsError } = await supabase
    .from('leads')
    .select('lead_number')
    .like('lead_number', `${normalizedBase}/%`);

  if (newLeadsError) throw newLeadsError;
  newLeadRows?.forEach(row => {
    const leadNumber = row.lead_number ? String(row.lead_number) : '';
    const match = leadNumber.match(/\/(\d+)$/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (!Number.isNaN(parsed)) {
        suffixes.push(parsed);
      }
    }
  });

  let legacySuffixes: number[] = [];
  const legacyLikeConditions: string[] = [];
  if (normalizedBase) {
    legacyLikeConditions.push(`manual_id.like.${normalizedBase}/%`);
  }
  if (normalizedNumericBase) {
    legacyLikeConditions.push(`manual_id.like.${normalizedNumericBase}/%`);
  }

  if (legacyLikeConditions.length > 0) {
    const { data: legacyRows, error: legacyError } = await supabase
      .from('leads_lead')
      .select('manual_id')
      .or(legacyLikeConditions.join(','));

    if (legacyError) throw legacyError;
    legacyRows?.forEach(row => {
      const manualValue = row.manual_id ? String(row.manual_id) : '';
      const match = manualValue.match(/\/(\d+)$/);
      if (match) {
        const parsed = parseInt(match[1], 10);
        if (!Number.isNaN(parsed)) {
          legacySuffixes.push(parsed);
        }
      }
    });
  }

  suffixes.push(...legacySuffixes);

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

    if (!subLeadForm.categoryId && !subLeadForm.category.trim()) {
      validationErrors.push('Please select a category for the sub-lead.');
    }

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
      const manualId = await getNextAvailableManualId();
      const manualIdString = manualId.toString();

      const nextSuffix = await computeNextSubLeadSuffix(masterBaseNumber);
      const subLeadNumber = `${masterBaseNumber}/${nextSuffix}`;
      const masterIdValue = extractDigits(masterBaseNumber) ?? masterBaseNumber;

      const selectedCategoryOption = subLeadForm.categoryId ? categoryOptionsMap.get(subLeadForm.categoryId) : undefined;
      const categoryIdValue = subLeadForm.categoryId ? Number(subLeadForm.categoryId) : null;
      const categoryName = selectedCategoryOption?.raw?.name || selectedCategoryOption?.label || subLeadForm.category || null;

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

      const newLeadData: Record<string, any> = {
        manual_id: manualIdString,
        master_id: masterIdValue,
        lead_number: subLeadNumber,
        name: trimmedName,
        email: subLeadForm.email,
        phone: subLeadForm.phone,
        category: categoryName,
        category_id: categoryIdValue,
        topic: subLeadForm.topic,
        special_notes: subLeadForm.special_notes,
        source: subLeadForm.source,
        language: subLeadForm.language,
        tags: subLeadForm.tags,
        stage: 'Created',
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

      if (!categoryName) {
        newLeadData.category = null;
      }
      const { error } = await supabase.from('leads').insert([newLeadData]);
      if (error) throw error;
      await fetchSubLeads(masterBaseNumber);
      toast.success(`Sub-lead created: ${subLeadNumber}`);
      setShowSubLeadDrawer(false);
      setSubLeadStep('initial');
      setSubLeadForm({
        name: '',
        email: '',
        phone: '',
        category: '',
        categoryId: '',
        topic: '',
        special_notes: '',
        source: '',
        language: '',
        tags: '',
        handler: '',
        handlerId: '',
        currency: 'NIS',
        numApplicants: '',
        proposal: '',
        potentialValue: '',
      });
      
      // Navigate to the newly created sub-lead's page
      navigate(buildClientRoute(manualIdString, subLeadNumber));
    } catch (error) {
      console.error('Error creating sub-lead:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create sub-lead.');
    } finally {
      setIsSavingSubLead(false);
    }
  };

  // Check if lead is unactivated and show compact view
  const isLegacyForView = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
  const unactivationReasonForView = selectedClient?.unactivation_reason;
  const isUnactivated = isLegacyForView ? 
    (String(selectedClient?.stage) === '91' || (unactivationReasonForView && unactivationReasonForView.trim() !== '')) :
    ((unactivationReasonForView && unactivationReasonForView.trim() !== '') || false);
  
  
  // Show loading state while determining view
  if (localLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }
  
  // Show unactivated view if lead is unactivated and user hasn't clicked to expand
  if (isUnactivated && isUnactivatedView && !userManuallyExpanded) {
    console.log('🔍 RENDERING UNACTIVATED VIEW for client:', selectedClient.id);
    return (
      <div className="min-h-screen p-4">
        <div className="max-w-2xl mx-auto">
          {/* Unactivated Lead Compact Card */}
          <div 
            className="bg-white rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 cursor-pointer transform hover:scale-105 border border-gray-200 overflow-hidden"
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
                <div className="bg-red-700 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide shadow-lg">
                  Unactivated
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
                      <DocumentTextIcon className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-600 font-medium">{selectedClient.topic}</span>
                    </div>
                  )}

                  {/* Email */}
                  <div className="flex items-center gap-2">
                    <EnvelopeIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">{selectedClient.email || 'No email'}</span>
                  </div>

                  {/* Category */}
                  <div className="flex items-center gap-2">
                    <TagIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">{selectedClient.category || 'Not specified'}</span>
                  </div>
                </div>

                {/* Row 2 */}
                <div className="space-y-3">
                  {/* Scheduler */}
                  {selectedClient.scheduler && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-600">Scheduler: {selectedClient.scheduler}</span>
                    </div>
                  )}

                  {/* Phone */}
                  <div className="flex items-center gap-2">
                    <PhoneIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">{selectedClient.phone || 'No phone'}</span>
                  </div>

                  {/* Created Date */}
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500">
                      Created: {selectedClient.created_at ? new Date(selectedClient.created_at).toLocaleDateString() : 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Unactivation Details */}
              {(() => {
                const stageName = getStageName(selectedClient.stage);
                const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                const unactivationReason = selectedClient.unactivation_reason;
                const stageUnactivated = areStagesEquivalent(stageName, 'unactivated') || areStagesEquivalent(stageName, 'dropped_spam_irrelevant');
                const isUnactivated = (unactivationReason && unactivationReason.trim() !== '') || stageUnactivated;
                return isUnactivated;
              })() && (
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  <div className="flex items-center gap-2">
                    <NoSymbolIcon className="w-4 h-4 text-red-400" />
                    <span className="text-sm text-red-600 font-medium">
                      {(() => {
                        const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                        // For legacy leads, use unactivation_reason (not deactivate_note which doesn't exist in leads_lead table)
                        const unactivationReason = selectedClient.unactivation_reason;
                        const stageName = getStageName(selectedClient.stage);
                        
                        // For legacy leads with stage 91 but no unactivation_reason, show default reason
                        if (isLegacy && String(selectedClient.stage) === '91' && !unactivationReason) {
                          return 'Reason: Dropped (Spam/Irrelevant)';
                        }
                        
                        // Return the reason exactly as stored in the database
                        return unactivationReason ? (
                          `Reason: ${unactivationReason}`
                        ) : (
                          'Status: Unactivated (Dropped/Spam/Irrelevant)'
                        );
                      })()}
                    </span>
                  </div>
                  {selectedClient.unactivated_by && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-600">
                        Unactivated by: {selectedClient.unactivated_by}
                      </span>
                    </div>
                  )}
                  {selectedClient.unactivated_at && (
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-600">
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
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <InformationCircleIcon className="w-4 h-4 text-blue-500" />
                  <span className="text-sm text-blue-700 font-medium">Click to view full details</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      {/* Background loading indicator */}
      {backgroundLoading && (
        <div className="fixed top-4 right-4 z-40 bg-blue-100 text-blue-800 px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm">
          <div className="loading loading-spinner loading-xs"></div>
          Loading additional data...
        </div>
      )}
      {/* Mobile view - aligned with desktop layout */}
      <div className="md:hidden px-4 pt-4 pb-3">
        <div className="flex flex-col gap-4">
          {/* Sub-lead notice for mobile */}
          {(isSubLead || persistentIsSubLead) && (masterLeadNumber || persistentMasterLeadNumber) && (
            <div className="text-sm text-gray-500 mb-2">
              This is a Sub-Lead of Master Lead: <a href={`/clients/${masterLeadNumber || persistentMasterLeadNumber}/master`} className="underline text-blue-700 hover:text-blue-900">{masterLeadNumber || persistentMasterLeadNumber}</a>
            </div>
          )}
          
          {/* Master lead notice for mobile */}
          {isMasterLead && subLeads.length > 0 && (
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
              className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl shadow-lg px-5 py-3 mb-3 w-full max-w-xs cursor-pointer hover:from-purple-700 hover:to-blue-700 transition-all duration-200"
              onClick={() => setIsBalanceModalOpen(true)}
              title="Click to edit balance"
            >
              <div className="text-center">
                <div className="text-white text-2xl font-bold whitespace-nowrap">
                  {(() => {
                    const baseAmount = Number(selectedClient?.balance || selectedClient?.total || 0);
                    const subcontractorFee = Number(selectedClient?.subcontractor_fee ?? 0);
                    const mainAmount = baseAmount - subcontractorFee;
                    const currency = selectedClient?.balance_currency || selectedClient?.proposal_currency || selectedClient?.currency;
                    
                    // Calculate VAT
                    let vatAmount = 0;
                    if (selectedClient?.id?.toString().startsWith('legacy_')) {
                      const totalAmount = Number(selectedClient?.total || selectedClient?.balance || 0);
                      if (currency === '₪' || currency === 'ILS') {
                        vatAmount = totalAmount * 0.18;
                      }
                    } else {
                      const totalAmount = Number(selectedClient?.balance || selectedClient?.total || 0);
                      if (currency === '₪' || currency === 'ILS') {
                        vatAmount = totalAmount * 0.18;
                      } else if (selectedClient?.vat_value && Number(selectedClient.vat_value) > 0) {
                        vatAmount = Number(selectedClient.vat_value);
                      }
                    }
                    
                    return (
                      <span>
                        {getCurrencySymbol(currency)}{Number(mainAmount.toFixed(2)).toLocaleString()}
                        {vatAmount > 0 && (
                          <span className="text-white text-base opacity-90 font-normal ml-2">
                            +{Number(vatAmount.toFixed(2)).toLocaleString()} VAT
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </div>
                {/* Always show Total */}
                <div className="text-white text-sm opacity-90 mt-1">
                  Total: {getCurrencySymbol(selectedClient?.balance_currency || selectedClient?.proposal_currency || selectedClient?.currency)}
                  {(() => {
                    const baseAmount = Number(selectedClient?.balance || selectedClient?.total || 0);
                    return Number(baseAmount.toFixed(2)).toLocaleString();
                  })()}
                </div>
                {/* Always show Potential Value */}
                <div className="text-white text-sm opacity-90 mt-2 pt-2 border-t border-white/20">
                  <div className="font-medium">Potential Value:</div>
                  <div className="text-white">
                    {(() => {
                      // Check both potential_total and potential_value for both types
                      const potentialValue = (selectedClient as any)?.potential_total || (selectedClient as any)?.potential_value || null;
                      
                      if (potentialValue !== null && potentialValue !== undefined) {
                        const numValue = typeof potentialValue === 'string' ? parseFloat(potentialValue) : Number(potentialValue);
                        if (!isNaN(numValue) && numValue > 0) {
                          const currency = selectedClient?.balance_currency || selectedClient?.proposal_currency || selectedClient?.currency;
                          const formattedValue = typeof potentialValue === 'string' 
                            ? potentialValue 
                            : numValue.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                          return (
                            <span className="text-white">
                              {getCurrencySymbol(currency)}{formattedValue}
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

            {selectedClient?.stage !== null && selectedClient?.stage !== undefined && selectedClient?.stage !== '' && (
              <div className="dropdown dropdown-end mb-2">
                <label 
                  tabIndex={0} 
                  className="btn btn-sm text-white border-none bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 normal-case text-sm cursor-pointer hover:from-pink-600 hover:via-purple-600 hover:to-purple-700 transition-all duration-200 flex items-center gap-2 whitespace-nowrap px-4"
                >
                  {getStageName(selectedClient.stage)}
                  <ChevronDownIcon className="w-4 h-4" />
                </label>
                <ul 
                  tabIndex={0} 
                  className="dropdown-content z-[1] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56 shadow-lg border border-gray-200"
                >
                  {availableStages.map((stageOption) => (
                    <li key={stageOption.id}>
                      <a 
                        className={`flex items-center gap-3 py-3 hover:bg-gray-50 transition-colors rounded-lg ${
                          selectedClient.stage === stageOption.id ? 'bg-purple-50 text-purple-700 font-semibold' : ''
                        }`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleStageChange(stageOption.id);
                        }}
                      >
                        <span className="font-medium">{stageOption.name}</span>
                        {selectedClient.stage === stageOption.id && (
                          <CheckIcon className="w-4 h-4 text-purple-600" />
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Applicants (same logic as desktop) */}
            {(() => {
              const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
              const applicantsCount = isLegacyLead ? selectedClient?.no_of_applicants : selectedClient?.number_of_applicants_meeting;
              return applicantsCount && applicantsCount > 0 ? (
                <div className="text-center mb-2">
                  <div className="text-black text-lg font-semibold">
                    {applicantsCount} applicant{applicantsCount !== 1 ? 's' : ''}
                  </div>
                </div>
              ) : null;
            })()}
          </div>

          {/* Client info card */}
          <ClientInformationBox 
            selectedClient={selectedClient} 
            getEmployeeDisplayName={getEmployeeDisplayName}
            onClientUpdate={async () => await refreshClientData(selectedClient?.id)}
          />

          {/* Progress & Follow-up card - Hidden on mobile (now inline in ClientInformationBox) */}
          <div className="hidden md:block">
            <ProgressFollowupBox 
              selectedClient={selectedClient} 
              getEmployeeDisplayName={getEmployeeDisplayName}
            />
          </div>
        </div>
      </div>
      {/* Vibrant 'Lead is cold' badge, top right, same height as Stages/Actions */}
      <div className="hidden md:flex w-full justify-center mt-2 mb-2">
        {isLeadCold && (
          <span className="rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-500 to-indigo-600 text-white shadow px-4 py-2 text-sm font-bold flex items-center gap-2 border-2 border-white/20">
            <svg className="w-4 h-4 text-white/90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Lead is cold: {coldLeadText}
          </span>
        )}
      </div>
      {/* Client Details Section (desktop) */}
      <div className="hidden md:block bg-white dark:bg-gray-900 w-full">
        {/* Modern CRM Header */}
        <div className="px-8 py-6">
          {/* Sub-lead notice at the top */}
          {(isSubLead || persistentIsSubLead) && (masterLeadNumber || persistentMasterLeadNumber) && (
            <div className="text-sm text-gray-500 mb-2">
              This is a Sub-Lead of Master Lead: <a href={`/clients/${masterLeadNumber || persistentMasterLeadNumber}/master`} className="underline text-blue-700 hover:text-blue-900">{masterLeadNumber || persistentMasterLeadNumber}</a>
            </div>
          )}
          {/* Master lead notice */}
          {isMasterLead && subLeads.length > 0 && (
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
                        // Get base amount and subtract subcontractor fee for main display value
                        const baseAmount = Number(selectedClient?.balance || selectedClient?.total || 0);
                        const subcontractorFee = Number(selectedClient?.subcontractor_fee ?? 0);
                        const mainAmount = baseAmount - subcontractorFee; // Main value after subtracting subcontractor fee
                        const currency = selectedClient?.balance_currency || selectedClient?.proposal_currency || selectedClient?.currency;
                        
                        // Calculate VAT based on base amount (before subtracting subcontractor fee)
                        let vatAmount = 0;
                        if (selectedClient?.id?.toString().startsWith('legacy_')) {
                          const totalAmount = Number(selectedClient?.total || selectedClient?.balance || 0);
                          if (currency === '₪' || currency === 'ILS') {
                            vatAmount = totalAmount * 0.18;
                          }
                        } else {
                          const totalAmount = Number(selectedClient?.balance || selectedClient?.total || 0);
                          if (currency === '₪' || currency === 'ILS') {
                            vatAmount = totalAmount * 0.18;
                          } else if (selectedClient?.vat_value && Number(selectedClient.vat_value) > 0) {
                            vatAmount = Number(selectedClient.vat_value);
                          }
                        }
                        
                        return (
                          <span>
                            {getCurrencySymbol(currency)}{Number(mainAmount.toFixed(2)).toLocaleString()}
                            {vatAmount > 0 && (
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
                          const currency = selectedClient?.balance_currency || selectedClient?.proposal_currency || selectedClient?.currency;
                          const formattedValue = typeof potentialValue === 'string' 
                            ? potentialValue 
                            : numValue.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                          return (
                            <div className="text-white text-sm opacity-90 mt-2 pt-2 border-t border-white/20">
                              <div className="font-medium">Potential Value:</div>
                              <div className="text-white">
                                <span className="text-white">
                                  {getCurrencySymbol(currency)}{formattedValue}
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
                        Total: {getCurrencySymbol(selectedClient?.balance_currency || selectedClient?.proposal_currency || selectedClient?.currency)}
                        {(() => {
                          // Total is the base amount from database, not calculated as value + VAT
                          const baseAmount = Number(selectedClient?.balance || selectedClient?.total || 0);
                          return Number(baseAmount.toFixed(2)).toLocaleString();
                        })()}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Stage Badge - Under balance badge */}
                {selectedClient?.stage !== null && selectedClient?.stage !== undefined && selectedClient?.stage !== '' && (
                  <div className="dropdown dropdown-end mb-3">
                    <label 
                      tabIndex={0} 
                      className="btn btn-md text-white border-none bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 normal-case text-sm cursor-pointer hover:from-pink-600 hover:via-purple-600 hover:to-purple-700 transition-all duration-200 flex items-center gap-2 whitespace-nowrap px-4"
                    >
                      {getStageName(selectedClient.stage)}
                      <ChevronDownIcon className="w-4 h-4" />
                    </label>
                    <ul 
                      tabIndex={0} 
                      className="dropdown-content z-[1] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56 shadow-lg border border-gray-200"
                    >
                      {availableStages.map((stageOption) => (
                        <li key={stageOption.id}>
                          <a 
                            className={`flex items-center gap-3 py-3 hover:bg-gray-50 transition-colors rounded-lg ${
                              selectedClient.stage === stageOption.id ? 'bg-purple-50 text-purple-700 font-semibold' : ''
                            }`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleStageChange(stageOption.id);
                            }}
                          >
                            <span className="font-medium">{stageOption.name}</span>
                            {selectedClient.stage === stageOption.id && (
                              <CheckIcon className="w-4 h-4 text-purple-600" />
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
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
                {isUnactivated && (
                  <div className="mt-3">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-100 border border-red-300 rounded-lg">
                      <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      <span className="text-red-700 font-medium text-sm">Case is not active</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="w-full lg:w-80">
                <ProgressFollowupBox 
                  selectedClient={selectedClient} 
                  getEmployeeDisplayName={getEmployeeDisplayName}
                />
              </div>
            </div>
          </div>
        </div>
        

        </div>
        
        {/* Tabs Navigation */}
        
        {/* Tabs Navigation */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6 mx-6">
          <div className="w-full">
            {/* Desktop version */}
            <div className="hidden md:flex items-center px-4 py-4 gap-4">
              <div className="flex bg-white dark:bg-gray-800 p-1 gap-1 overflow-x-auto flex-1 rounded-lg scrollbar-hide">
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
              
              {/* Stages and Actions buttons - moved closer to tabs */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="dropdown">
                  <label tabIndex={0} className="btn btn-md bg-white border-2 hover:bg-purple-50 gap-2 text-sm saira-regular" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                    <span>Stages</span>
                    <ChevronDownIcon className="w-4 h-4" style={{ color: '#4218CC' }} />
                  </label>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56">
                    {dropdownItems}
                  </ul>
                </div>
                
                {selectedClient && areStagesEquivalent(currentStageName, 'created') && (
                  <div className="dropdown">
                    <label tabIndex={0} className="btn bg-white text-primary border-primary border-2 hover:bg-purple-50 gap-2">
                      <span>Assign to</span>
                      <ChevronDownIcon className="w-4 h-4" />
                    </label>
                    <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56">
                      {schedulerOptions.map((scheduler) => (
                        <li key={scheduler}>
                          <a 
                            className="flex items-center gap-3 py-3 hover:bg-gray-50 transition-colors rounded-lg" 
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              updateScheduler(scheduler);
                            }}
                          >
                            <UserIcon className="w-5 h-5 text-primary" />
                            <span className="font-medium">{scheduler}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="dropdown dropdown-end">
                  <label tabIndex={0} className="btn btn-md bg-white border-2 hover:bg-purple-50 gap-2 text-sm" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                    <span>Actions</span>
                    <ChevronDownIcon className="w-4 h-4" style={{ color: '#4218CC' }} />
                  </label>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56 shadow-lg border border-gray-200">
                    {(selectedClient.unactivation_reason || areStagesEquivalent(currentStageName, 'unactivated') || areStagesEquivalent(currentStageName, 'dropped_spam_irrelevant')) ? (
                      <li><a className="flex items-center gap-3 py-3 hover:bg-green-50 transition-colors rounded-lg" onClick={() => handleActivation()}><CheckCircleIcon className="w-5 h-5 text-green-500" /><span className="text-green-600 font-medium">Activate</span></a></li>
                    ) : (
                      <li><a className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg" onClick={() => setShowUnactivationModal(true)}><NoSymbolIcon className="w-5 h-5 text-red-500" /><span className="text-red-600 font-medium">Unactivate/Spam</span></a></li>
                    )}
                    <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg"><StarIcon className="w-5 h-5 text-amber-500" /><span className="font-medium">Ask for recommendation</span></a></li>
                    <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg" onClick={() => { openEditLeadDrawer(); (document.activeElement as HTMLElement)?.blur(); }}><PencilSquareIcon className="w-5 h-5 text-blue-500" /><span className="font-medium">Edit lead</span></a></li>
                    <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg" onClick={() => { setShowSubLeadDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}><Squares2X2Icon className="w-5 h-5 text-green-500" /><span className="font-medium">Create Sub-Lead</span></a></li>
                  </ul>
                </div>
              </div>
            </div>
            {/* Mobile version: modern card-based design */}
            <div className="md:hidden px-6 py-4">
              {/* Mobile Action Buttons - Above tabs */}
              <div className="flex gap-2 mb-4">
                <div className="flex-1">
                  <div className="dropdown w-full">
                    <label tabIndex={0} className="btn btn-sm w-full bg-white border-2 hover:bg-purple-50 gap-2 text-sm" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                      <span>Stages</span>
                      <ChevronDownIcon className="w-4 h-4" style={{ color: '#4218CC' }} />
                    </label>
                    <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56">
                      {dropdownItems}
                    </ul>
                  </div>
                </div>
                {selectedClient && areStagesEquivalent(currentStageName, 'created') && (
                  <div className="flex-1">
                    <div className="dropdown w-full">
                      <label tabIndex={0} className="btn btn-sm bg-white text-primary border-primary border-2 hover:bg-purple-50 gap-2">
                        <span>Assign to</span>
                        <ChevronDownIcon className="w-4 h-4" />
                      </label>
                      <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56">
                        {schedulerOptions.map((scheduler) => (
                          <li key={scheduler}>
                            <a 
                              className="flex items-center gap-3 py-3 hover:bg-gray-50 transition-colors rounded-lg" 
                              onClick={() => { updateScheduler(scheduler); (document.activeElement as HTMLElement)?.blur(); }}
                            >
                              <UserIcon className="w-5 h-5 text-primary" />
                              <span className="font-medium">{scheduler}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                <div className="flex-1">
                  <div className="dropdown w-full">
                    <label tabIndex={0} className="btn btn-sm w-full bg-white border-2 hover:bg-purple-50 gap-2 text-sm" style={{ color: '#4218CC', borderColor: '#4218CC' }}>
                      <span>Actions</span>
                      <ChevronDownIcon className="w-4 h-4" style={{ color: '#4218CC' }} />
                    </label>
                    <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 bg-white dark:bg-gray-800 rounded-xl w-56 shadow-lg border border-gray-200">
                      {(selectedClient.unactivation_reason || areStagesEquivalent(currentStageName, 'unactivated') || areStagesEquivalent(currentStageName, 'dropped_spam_irrelevant')) ? (
                        <li><a className="flex items-center gap-3 py-3 hover:bg-green-50 transition-colors rounded-lg" onClick={() => handleActivation()}><CheckCircleIcon className="w-5 h-5 text-green-500" /><span className="text-green-600 font-medium">Activate</span></a></li>
                      ) : (
                        <li><a className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg" onClick={() => setShowUnactivationModal(true)}><NoSymbolIcon className="w-5 h-5 text-red-500" /><span className="text-red-600 font-medium">Unactivate/Spam</span></a></li>
                      )}
                      <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg"><StarIcon className="w-5 h-5 text-amber-500" /><span className="font-medium">Ask for recommendation</span></a></li>
                      <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg" onClick={() => { openEditLeadDrawer(); (document.activeElement as HTMLElement)?.blur(); }}><PencilSquareIcon className="w-5 h-5 text-blue-500" /><span className="font-medium">Edit lead</span></a></li>
                      <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors rounded-lg" onClick={() => { setShowSubLeadDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}><Squares2X2Icon className="w-5 h-5 text-green-500" /><span className="font-medium">Create Sub-Lead</span></a></li>
                    </ul>
                  </div>
                </div>
              </div>
              
              <div
                ref={mobileTabsRef}
                className="overflow-x-auto scrollbar-hide bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 dark:border-gray-700 p-3 w-full"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <div className="flex gap-2 pb-1">
                  {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 min-w-[80px] ${
                          isActive
                            ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-lg transform scale-105'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                        }`}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        <div className="relative">
                          <tab.icon className={`w-6 h-6 mb-1 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                          {tab.id === 'interactions' && tab.badge && (
                            <div className={`absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
                              isActive 
                                ? 'bg-white/20 text-white' 
                                : 'bg-purple-100 text-purple-700'
                            }`}>
                              {tab.badge}
                            </div>
                          )}
                        </div>
                        <span className={`text-xs font-semibold truncate max-w-[70px] ${
                          isActive ? 'text-white' : 'text-gray-600'
                        }`}>
                          {tab.label}
                        </span>
                        {isActive && (
                          <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-white dark:bg-gray-800 rounded-full"></div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Content - full width, white background */}
        <div className="w-full bg-white dark:bg-gray-900 min-h-screen">
          <div
            key={`${activeTab}-${interactionCount}`}
            className="p-2 sm:p-4 md:p-6 pb-6 md:pb-6 mb-4 md:mb-0 slide-fade-in"
          >
                          {ActiveComponent && <ActiveComponent client={selectedClient} onClientUpdate={onClientUpdate} onCreateFinancePlan={activeTab === 'finances' ? () => setShowPaymentsPlanDrawer(true) : undefined} />}
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

              {/* Calendar Selection */}
              <div>
                <label className="block font-semibold mb-1">Calendar</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingFormData.calendar}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, calendar: e.target.value }))}
                >
                  <option value="current">Potential Client</option>
                  <option value="active_client">Active Client</option>
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block font-semibold mb-1">Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={meetingFormData.date}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, date: e.target.value }))}
                  required
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>

              {/* Time */}
              <div>
                <label className="block font-semibold mb-1">Time</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingFormData.time}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, time: e.target.value }))}
                  required
                >
                  {Array.from({ length: 32 }, (_, i) => {
                    const hour = Math.floor(i / 2) + 8; // Start from 8:00
                    const minute = i % 2 === 0 ? '00' : '30';
                    const timeOption = `${hour.toString().padStart(2, '0')}:${minute}`;
                    return (
                      <option key={timeOption} value={timeOption}>
                        {timeOption}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Manager (Optional) */}
              <div>
                <label className="block font-semibold mb-1">Manager (Optional)</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingFormData.manager}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, manager: e.target.value }))}
                >
                  <option value="">Select a manager...</option>
                  {['Anna Zh', 'Mindi', 'Sarah L', 'David K'].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* Helper (Optional) */}
              <div>
                <label className="block font-semibold mb-1">Helper (Optional)</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingFormData.helper}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, helper: e.target.value }))}
                >
                  <option value="">Select a helper...</option>
                  {['Anna Zh', 'Mindi', 'Sarah L', 'David K', '---'].map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Meeting Brief (Optional) */}
              <div>
                <label htmlFor="meeting-brief" className="block font-semibold mb-1">Meeting Brief (Optional)</label>
                <textarea
                  id="meeting-brief"
                  name="meeting-brief"
                  className="textarea textarea-bordered w-full min-h-[80px]"
                  value={meetingFormData.brief}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, brief: e.target.value }))}
                  placeholder="Brief description of the meeting topic..."
                />
              </div>

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
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Update Lead</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowUpdateDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
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
              <div className="pt-4">
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
                  onChange={e => handleMeetingEndedChange('proposalTotal', e.target.value)}
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
                  <option>NIS</option>
                  <option>USD</option>
                  <option>EUR</option>
                </select>
              </div>
              {/* Meeting Total */}
              <div>
                <label className="block font-semibold mb-1">Meeting Total:</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={meetingEndedData.meetingTotal}
                  onChange={e => handleMeetingEndedChange('meetingTotal', e.target.value)}
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
                  <option>NIS</option>
                  <option>USD</option>
                  <option>EUR</option>
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

      {/* Send Offer Drawer */}
      {showSendOfferDrawer && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowSendOfferDrawer(false)} />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Send Price Offer</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSendOfferDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">To</label>
                <input type="text" className="input input-bordered w-full" value={selectedClient.email} disabled />
              </div>
              <div>
                <label className="block font-semibold mb-1">Subject</label>
                <input type="text" className="input input-bordered w-full" value={offerSubject} onChange={e => setOfferSubject(e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-2">Templates</label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(offerTemplates).map(([lang, template]) => (
                    <button
                      key={lang}
                      className="btn btn-outline btn-xs"
                      onClick={() => {
                        setOfferBody(updateOfferBodyWithTotal(template.body.replace('{client_name}', selectedClient.name), offerTotal, offerCurrency));
                        setOfferSubject(`[${selectedClient.lead_number}] - ${template.subject}`);
                        setOfferTemplateLang(lang as 'en'|'he');
                      }}
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block font-semibold mb-1">Total</label>
                  <input type="number" className="input input-bordered w-full" value={offerTotal} onChange={e => setOfferTotal(e.target.value)} min={0} />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Currency</label>
                  <select className="select select-bordered w-full" value={offerCurrency} onChange={e => setOfferCurrency(e.target.value)}>
                    <option value="NIS">NIS</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Body</label>
                <textarea className="textarea textarea-bordered w-full min-h-[120px]" value={offerBody} onChange={e => setOfferBody(e.target.value)} />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSendOfferEmail} disabled={offerSending}>
                {offerSending ? 'Sending...' : 'Send'}
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
            </div>
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

      {/* Loading overlay spinner */}
      {localLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60">
          <span className="loading loading-spinner loading-lg text-primary"></span>
        </div>
      )}
      {/* 3. Add the rescheduling drawer skeleton after the Schedule Meeting drawer */}
      {showRescheduleDrawer && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowRescheduleDrawer(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Reschedule Meeting</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowRescheduleDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
              <div>
                <label className="block font-semibold mb-2">Select a meeting to cancel:</label>
                {rescheduleMeetings.length === 0 ? (
                  <div className="text-base-content/60">No meetings scheduled for this client.</div>
                ) : (
                  <ul className="space-y-2">
                    {rescheduleMeetings.map((meeting) => (
                      <li key={meeting.id} className="flex items-center gap-3 p-2 rounded-lg border border-base-200">
                        <input
                          type="radio"
                          name="meetingToDelete"
                          checked={meetingToDelete === meeting.id}
                          onChange={() => setMeetingToDelete(meeting.id)}
                        />
                        <span className="font-medium">{meeting.meeting_date} {meeting.meeting_time} ({meeting.meeting_location})</span>
                        <span className="text-xs text-base-content/60 ml-2">Manager: {meeting.meeting_manager}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="divider">New Meeting Details</div>
              <div className="flex flex-col gap-3">
                <label className="block font-semibold mb-1">Location</label>
                <select
                  className="select select-bordered w-full"
                  value={rescheduleFormData.location}
                  onChange={e => setRescheduleFormData((prev: any) => ({ ...prev, location: e.target.value }))}
                >
                  <option value="Teams">Teams</option>
                  <option value="Jerusalem Office">Jerusalem Office</option>
                  <option value="Tel Aviv Office">Tel Aviv Office</option>
                  <option value="Phone Call">Phone Call</option>
                  <option value="WhatsApp">WhatsApp</option>
                </select>
                <label className="block font-semibold mb-1">Date</label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={rescheduleFormData.date}
                  onChange={e => setRescheduleFormData((prev: any) => ({ ...prev, date: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                />
                <label className="block font-semibold mb-1">Time</label>
                <select
                  className="select select-bordered w-full"
                  value={rescheduleFormData.time}
                  onChange={e => setRescheduleFormData((prev: any) => ({ ...prev, time: e.target.value }))}
                >
                  {Array.from({ length: 32 }, (_, i) => {
                    const hour = Math.floor(i / 2) + 8;
                    const minute = i % 2 === 0 ? '00' : '30';
                    const timeOption = `${hour.toString().padStart(2, '0')}:${minute}`;
                    return (
                      <option key={timeOption} value={timeOption}>{timeOption}</option>
                    );
                  })}
                </select>
                <label className="block font-semibold mb-1">Manager (Optional)</label>
                <select
                  className="select select-bordered w-full"
                  value={rescheduleFormData.manager}
                  onChange={e => setRescheduleFormData((prev: any) => ({ ...prev, manager: e.target.value }))}
                >
                  <option value="">Select a manager...</option>
                  {['Anna Zh', 'Mindi', 'Sarah L', 'David K'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <label className="block font-semibold mb-1">Helper (Optional)</label>
                <select
                  className="select select-bordered w-full"
                  value={rescheduleFormData.helper}
                  onChange={e => setRescheduleFormData((prev: any) => ({ ...prev, helper: e.target.value }))}
                >
                  <option value="">Select a helper...</option>
                  {['Anna Zh', 'Mindi', 'Sarah L', 'David K', '---'].map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <label className="block font-semibold mb-1">Amount (Optional)</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={rescheduleFormData.amount}
                  onChange={e => setRescheduleFormData((prev: any) => ({ ...prev, amount: e.target.value }))}
                  min={0}
                  placeholder="Enter amount..."
                />
                <label className="block font-semibold mb-1">Currency</label>
                <select
                  className="select select-bordered w-full"
                  value={rescheduleFormData.currency}
                  onChange={e => setRescheduleFormData((prev: any) => ({ ...prev, currency: e.target.value }))}
                >
                  {currencyOptions.map((opt: any) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  className="btn btn-primary px-8"
                  onClick={handleRescheduleMeeting}
                  disabled={
                    !meetingToDelete ||
                    !rescheduleFormData.date ||
                    !rescheduleFormData.time
                  }
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Payments Plan Drawer */}
      {showPaymentsPlanDrawer && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => { setShowPaymentsPlanDrawer(false); setPayments([]); }} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-xl bg-white h-full shadow-2xl p-0 flex flex-col animate-slideInRight z-50 overflow-y-auto border-l border-gray-200 dark:border-gray-700">
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{selectedClient?.lead_number} - {selectedClient?.name}</h3>
                <div className="text-base font-medium text-gray-500 mt-1">Payments plan</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowPaymentsPlanDrawer(false); setPayments([]); }}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            {/* Summary Section */}
            <div className="px-8 pt-6 pb-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-700">
              <div className="space-y-2">
                {/* Edit button above total balance */}
                <div className="flex justify-end mb-1">
                  {!editingBalance && (
                    <button className="btn btn-xs btn-link text-gray-500 hover:text-primary px-0" onClick={() => setEditingBalance(true)}>
                      Edit
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-base text-gray-600">Total balance</span>
                  {editingBalance ? (
                    <input
                      type="number"
                      className="input input-bordered w-32 text-right"
                      value={editedBalance}
                      onChange={e => setEditedBalance(Number(e.target.value))}
                      onBlur={() => { setEditingBalance(false); /* Optionally save */ }}
                      autoFocus
                    />
                  ) : (
                    <span className="text-xl font-bold text-gray-900">
                      {(() => {
                        const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                        const currency = isLegacyLead ? (selectedClient?.balance_currency || '₪') : (selectedClient?.proposal_currency || '₪');
                        return `${currency}${(selectedClient?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                      })()}
                    </span>
                  )}
                </div>
                {(() => {
                  const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                  const currency = isLegacyLead ? (selectedClient?.balance_currency || '₪') : (selectedClient?.proposal_currency || '₪');
                  const balance = selectedClient?.balance || 0;
                  const vatAmount = currency === '₪' ? balance * 0.18 : 0;
                  const totalWithVat = currency === '₪' ? balance * 1.18 : balance;
                  
                  return (
                    <>
                      {currency === '₪' && (
                        <div className="flex items-center justify-between">
                          <span className="text-base text-gray-600">VAT (18%)</span>
                          <span className="text-base font-semibold text-gray-900">
                            {`${currency}${vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-base text-gray-600">
                          {currency === '₪' ? 'Total incl. VAT' : 'Total'}
                        </span>
                        <span className="text-lg font-bold text-primary">
                          {`${currency}${totalWithVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            {/* Auto plan dropdown */}
            <div className="px-8 pt-6 pb-2">
              <label className="block font-semibold mb-1 text-gray-700 dark:text-gray-300">Auto plan</label>
              <select
                className="select select-bordered w-full max-w-xs"
                value={autoPlan}
                onChange={e => {
                  const selectedPlan = e.target.value;
                  if (selectedPlan) {
                    if (payments.length > 0) {
                      if (!window.confirm('This will overwrite your current payments. Continue?')) {
                        return;
                      }
                    }
                    // Generate payment rows for the selected plan
                    const planParts = selectedPlan.split('/').map(Number);
                    const balance = selectedClient?.balance || 0;
                    
                    // Determine currency for legacy leads
                    const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                    let currency = '₪'; // Default
                    if (isLegacyLead) {
                      currency = selectedClient?.balance_currency || '₪';
                    } else {
                      currency = selectedClient?.proposal_currency || '₪';
                    }
                    
                    const newPayments = [];
                    for (let i = 0; i < planParts.length; i++) {
                      const percentage = planParts[i];
                      const value = Math.round(balance * (percentage / 100) * 100) / 100;
                      // Only apply VAT if currency is NIS (₪)
                      const valueVat = currency === '₪' ? Math.round(value * 0.18 * 100) / 100 : 0;
                      const dateObj = new Date(Date.now() + (i + 1) * 30 * 24 * 60 * 60 * 1000);
                      const dueDate = dateObj.toISOString().split('T')[0];
                      newPayments.push({
                        duePercent: `${percentage}%`,
                        dueDate: dueDate,
                        value: value,
                        valueVat: valueVat,
                        currency: currency,
                        client: selectedClient?.name || '',
                        order: i === 0 ? 'First Payment' : i === planParts.length - 1 ? 'Final Payment' : 'Intermediate Payment',
                        notes: '',
                      });
                    }
                    setPayments(newPayments);
                  }
                  setAutoPlan(selectedPlan);
                }}
              >
                <option value="">Choose auto plan...</option>
                {autoPlanOptions.filter(opt => opt).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            {/* Add new payment button */}
            <div className="px-8 pb-2">
              <button className="btn btn-outline w-full" onClick={() => {
                setShowAddPayment(true);
                // Initialize form with correct defaults
                setNewPayment({
                  client: selectedClient?.name || '',
                  order: 'Intermediate Payment',
                  date: '',
                  currency: (() => {
                    const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                    return isLegacyLead ? (selectedClient?.balance_currency || '₪') : (selectedClient?.proposal_currency || '₪');
                  })(),
                  value: 0.0,
                  duePercent: '',
                  applicants: '',
                  notes: '',
                });
              }}>
                Add new payment
              </button>
            </div>
            {/* Add Payment Form */}
            {showAddPayment && (
              <div className="bg-white rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700 mb-6 mx-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                  <div>
                    <label className="block font-semibold mb-1">Client:</label>
                    <select className="select select-bordered w-full" value={newPayment.client} onChange={e => setNewPayment({ ...newPayment, client: e.target.value })}>
                      <option>----------</option>
                      <option>{selectedClient?.name}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Order:</label>
                    <select className="select select-bordered w-full" value={newPayment.order} onChange={e => setNewPayment({ ...newPayment, order: e.target.value })}>
                      <option>First Payment</option>
                      <option>Intermediate Payment</option>
                      <option>Final Payment</option>
                      <option>Single Payment</option>
                      <option>Expense (no VAT)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Date:</label>
                    <input type="date" className="input input-bordered w-full" value={newPayment.date} onChange={e => setNewPayment({ ...newPayment, date: e.target.value })} />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Currency:</label>
                    <select className="select select-bordered w-full" value={newPayment.currency} onChange={e => setNewPayment({ ...newPayment, currency: e.target.value })}>
                      {(() => {
                        const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                        const defaultCurrency = isLegacyLead ? (selectedClient?.balance_currency || '₪') : (selectedClient?.proposal_currency || '₪');
                        
                        // Show the default currency first, then other options
                        const currencies = [defaultCurrency, '₪', '$', '€', '£'].filter((currency, index, arr) => arr.indexOf(currency) === index);
                        
                        return currencies.map(currency => (
                          <option key={currency} value={currency}>{currency}</option>
                        ));
                      })()}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Value:</label>
                    <input type="number" className="input input-bordered w-full text-right" value={newPayment.value} onChange={e => setNewPayment({ ...newPayment, value: parseFloat(e.target.value) })} />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Due Percentage:</label>
                    <input 
                      type="number" 
                      className="input input-bordered w-full text-right" 
                      value={newPayment.duePercent} 
                      onChange={e => setNewPayment({ ...newPayment, duePercent: e.target.value })} 
                      placeholder="e.g., 25"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Applicants:</label>
                    <input type="text" className="input input-bordered w-full" value={newPayment.applicants} onChange={e => setNewPayment({ ...newPayment, applicants: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block font-semibold mb-1">Notes:</label>
                    <textarea className="textarea textarea-bordered w-full min-h-[100px]" value={newPayment.notes} onChange={e => setNewPayment({ ...newPayment, notes: e.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <button className="btn btn-ghost px-6" onClick={() => {
                    setShowAddPayment(false);
                    // Reset form to defaults
                    setNewPayment({
                      client: selectedClient?.name || '',
                      order: 'Intermediate Payment',
                      date: '',
                      currency: (() => {
                        const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                        return isLegacyLead ? (selectedClient?.balance_currency || '₪') : (selectedClient?.proposal_currency || '₪');
                      })(),
                      value: 0.0,
                      duePercent: '',
                      applicants: '',
                      notes: '',
                    });
                  }}>
                    Cancel
                  </button>
                  <button className="btn btn-primary px-8" onClick={() => {
                    let valueNum = typeof newPayment.value === 'number' ? newPayment.value : parseFloat(newPayment.value);
                    if (isNaN(valueNum)) valueNum = 0;
                    // Only apply VAT if currency is NIS (₪)
                    const valueVatNum = newPayment.currency === '₪' ? Math.round(valueNum * 0.18 * 100) / 100 : 0;
                    setPayments([
                      ...payments,
                      { 
                        ...newPayment, 
                        value: valueNum, 
                        valueVat: valueVatNum, 
                        duePercent: newPayment.duePercent ? `${newPayment.duePercent}%` : '', 
                        dueDate: newPayment.date, 
                        currency: newPayment.currency 
                      }
                    ]);
                    setShowAddPayment(false);
                    // Reset form to defaults
                    setNewPayment({
                      client: selectedClient?.name || '',
                      order: 'Intermediate Payment',
                      date: '',
                      currency: (() => {
                        const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
                        return isLegacyLead ? (selectedClient?.balance_currency || '₪') : (selectedClient?.proposal_currency || '₪');
                      })(),
                      value: 0.0,
                      duePercent: '',
                      applicants: '',
                      notes: '',
                    });
                  }}>
                    Save
                  </button>
                </div>
              </div>
            )}
            {/* Save Plan Button */}
            <div className="mt-8 flex justify-end px-8 pb-8">
              <button 
                className="btn btn-primary btn-lg px-8 shadow-lg hover:scale-105 transition-transform"
                onClick={handleSavePaymentsPlan}
                disabled={isSavingPaymentPlan}
              >
                {isSavingPaymentPlan ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Saving...
                  </>
                ) : (
                  'Save Plan'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {showProformaDrawer && proformaData && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowProformaDrawer(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-4xl h-full bg-gradient-to-br from-blue-50 to-indigo-50 shadow-2xl p-0 flex flex-col animate-slideInRight z-50 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 border-b border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold mb-1">Create Proforma</h2>
                  <p className="text-blue-100 text-sm">Client: {proformaData.client}</p>
                </div>
                <button className="btn btn-ghost btn-sm text-white hover:bg-white/20" onClick={() => setShowProformaDrawer(false)}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Main Content - Two Column Layout */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column - Invoice Items */}
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <DocumentTextIcon className="w-5 h-5 text-blue-600" />
                    Invoice Items
                  </h3>
                  
                  {/* Editable table */}
                  <div className="overflow-x-auto">
                    <table className="table w-full">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700">
                          <th className="text-sm font-semibold text-gray-700 dark:text-gray-300">Description</th>
                          <th className="text-sm font-semibold text-gray-700 dark:text-gray-300">Qty</th>
                          <th className="text-sm font-semibold text-gray-700 dark:text-gray-300">Rate</th>
                          <th className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total</th>
                          {!proformaData?.isViewMode && <th className="text-sm font-semibold text-gray-700 dark:text-gray-300">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {proformaData.rows.map((row: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700 transition-colors">
                            <td>
                              <input 
                                className="input input-bordered w-full text-sm" 
                                value={row.description} 
                                onChange={e => handleProformaRowChange(idx, 'description', e.target.value)}
                                readOnly={proformaData?.isViewMode}
                                placeholder="Item description"
                              />
                            </td>
                            <td>
                              <input 
                                className="input input-bordered w-20 text-sm text-center" 
                                type="number" 
                                value={row.qty} 
                                onChange={e => handleProformaRowChange(idx, 'qty', Number(e.target.value))}
                                readOnly={proformaData?.isViewMode}
                              />
                            </td>
                            <td>
                              <input 
                                className="input input-bordered w-24 text-sm text-right" 
                                type="number" 
                                value={row.rate} 
                                onChange={e => handleProformaRowChange(idx, 'rate', Number(e.target.value))}
                                readOnly={proformaData?.isViewMode}
                              />
                            </td>
                            <td>
                              <input className="input input-bordered w-24 text-sm text-right font-semibold" type="number" value={row.total} readOnly />
                            </td>
                            {!proformaData?.isViewMode && (
                              <td>
                                <button 
                                  className="btn btn-ghost btn-xs text-red-500 hover:bg-red-50" 
                                  onClick={() => handleDeleteProformaRow(idx)}
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  
                  {!proformaData?.isViewMode && (
                    <button 
                      className="btn btn-outline btn-sm mt-4 text-blue-600 border-blue-300 hover:bg-blue-50" 
                      onClick={handleAddProformaRow}
                    >
                      <PlusIcon className="w-4 h-4 mr-1" />
                      Add Row
                    </button>
                  )}
                </div>

                {/* Settings Section */}
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Cog6ToothIcon className="w-5 h-5 text-green-600" />
                    Settings
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="form-control">
                      <label className="label cursor-pointer justify-start gap-3">
                        <input 
                          type="checkbox" 
                          className="checkbox checkbox-primary" 
                          checked={proformaData.addVat} 
                          onChange={e => setProformaData((prev: any) => ({ ...prev, addVat: e.target.checked }))}
                          disabled={proformaData?.isViewMode}
                        />
                        <span className="label-text font-medium">Add VAT (18%)</span>
                      </label>
                    </div>
                    
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Currency</span>
                      </label>
                      <select 
                        className="select select-bordered w-full" 
                        value={proformaData.currency} 
                        onChange={e => setProformaData((prev: any) => ({ ...prev, currency: e.target.value }))}
                        disabled={proformaData?.isViewMode}
                      >
                        <option value="₪">₪ (NIS)</option>
                        <option value="$">$ (USD)</option>
                        <option value="€">€ (EUR)</option>
                      </select>
                    </div>
                    
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Bank Account</span>
                      </label>
                      <select 
                        className="select select-bordered w-full" 
                        value={proformaData.bankAccount} 
                        onChange={e => setProformaData((prev: any) => ({ ...prev, bankAccount: e.target.value }))}
                        disabled={proformaData?.isViewMode}
                      >
                        <option value="">Select account...</option>
                        <option value="1">Account 1</option>
                        <option value="2">Account 2</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Notes Section */}
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <ChatBubbleLeftRightIcon className="w-5 h-5 text-purple-600" />
                    Notes
                  </h3>
                  <textarea 
                    className="textarea textarea-bordered w-full min-h-[120px] text-sm" 
                    value={proformaData.notes} 
                    onChange={e => setProformaData((prev: any) => ({ ...prev, notes: e.target.value }))}
                    readOnly={proformaData?.isViewMode}
                    placeholder="Add any additional notes or terms..."
                  />
                </div>
              </div>

              {/* Right Column - Summary & Actions */}
              <div className="w-80 bg-white border-l border-gray-200 dark:border-gray-700 p-6 flex flex-col">
                {/* Summary Card */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 mb-6 border border-blue-200">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <ChartPieIcon className="w-5 h-5 text-blue-600" />
                    Summary
                  </h3>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-600">Subtotal:</span>
                      <span className="font-semibold text-gray-800">
                        {proformaData.currency} {proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0).toLocaleString()}
                      </span>
                    </div>
                    
                    {proformaData.addVat && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-600">VAT (18%):</span>
                        <span className="font-semibold text-gray-800">
                          {proformaData.currency} {Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 0.18 * 100) / 100}
                        </span>
                      </div>
                    )}
                    
                    <div className="border-t border-gray-300 pt-3">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold text-gray-800">Total:</span>
                        <span className="text-xl font-bold text-blue-600">
                          {proformaData.currency} {proformaData.addVat ? Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 1.18 * 100) / 100 : proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Proforma Info */}
                <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-6">
                  <h4 className="font-semibold text-gray-800 mb-2">Proforma Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Name:</span>
                      <span className="font-medium">{generatedProformaName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Language:</span>
                      <span className="font-medium">{proformaData.language}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Payment:</span>
                      <span className="font-medium">{proformaData.currency} {proformaData.payment.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-auto space-y-3">
                  {proformaData?.isViewMode ? (
                    <>
                      <button className="btn btn-primary w-full" onClick={() => setShowProformaDrawer(false)}>
                        Close
                      </button>
                      <button className="btn btn-outline w-full" onClick={() => {
                        setProformaData((prev: any) => ({ ...prev, isViewMode: false }));
                      }}>
                        Edit Proforma
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-primary w-full shadow-lg hover:shadow-xl transition-shadow" onClick={handleCreateProforma}>
                        <DocumentCheckIcon className="w-5 h-5 mr-2" />
                        Create Proforma
                      </button>
                      <div className="text-xs text-gray-500 text-center bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                        ⚠️ Once created, changes cannot be made!
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Drawer */}
      {showSuccessDrawer && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowSuccessDrawer(false)} />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Mark as Success</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSuccessDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">Handler</label>
                <select
                  className="select select-bordered w-full"
                  value={successForm.handler}
                  onChange={e => setSuccessForm(f => ({ ...f, handler: e.target.value }))}
                >
                  <option value="">--</option>
                  {schedulerOptions.map((scheduler) => (
                    <option key={scheduler} value={scheduler}>{scheduler}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Currency</label>
                <select
                  className="select select-bordered w-full"
                  value={successForm.currency}
                  onChange={e => setSuccessForm(f => ({ ...f, currency: e.target.value }))}
                >
                  <option value="NIS">NIS</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Number of Applicants</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={successForm.numApplicants}
                  onChange={e => setSuccessForm(f => ({ ...f, numApplicants: e.target.value }))}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Proposal (Amount Total)</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={successForm.proposal}
                  onChange={e => setSuccessForm(f => ({ ...f, proposal: e.target.value }))}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Potential Value</label>
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={successForm.potentialValue}
                  onChange={e => setSuccessForm(f => ({ ...f, potentialValue: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSaveSuccessDrawer}>
                Save
              </button>
            </div>
          </div>
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
            }}
          />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Create Sub-Lead</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowSubLeadDrawer(false);
                  setIsSavingSubLead(false);
                }}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              {subLeadStep === 'initial' && (
                <>
                  <button
                    className="btn btn-primary mb-4"
                    onClick={() => {
                      prefillSubLeadFormFromClient();
                      setSubLeadStep('details');
                    }}
                  >
                    New Procedure (Same Contact)
                  </button>
                  <button className="btn btn-outline" onClick={() => setSubLeadStep('newContact')}>
                    Add New Contact
                  </button>
                </>
              )}
              {subLeadStep === 'newContact' && (
                <>
                  <label className="block font-semibold mb-1">Name</label>
                  <input className="input input-bordered w-full" value={subLeadForm.name} onChange={e => setSubLeadForm(f => ({ ...f, name: e.target.value }))} />
                  <label className="block font-semibold mb-1">Email</label>
                  <input className="input input-bordered w-full" value={subLeadForm.email} onChange={e => setSubLeadForm(f => ({ ...f, email: e.target.value }))} />
                  <label className="block font-semibold mb-1">Phone</label>
                  <input className="input input-bordered w-full" value={subLeadForm.phone} onChange={e => setSubLeadForm(f => ({ ...f, phone: e.target.value }))} />
                  <label className="block font-semibold mb-1">Category</label>
                  <select
                    className="select select-bordered w-full"
                    value={subLeadForm.categoryId}
                    onChange={e => {
                      const value = e.target.value;
                      const selected = categoryOptionsMap.get(value);
                      setSubLeadForm(f => ({
                        ...f,
                        categoryId: value,
                        category: selected?.label || '',
                      }));
                    }}
                  >
                    <option value="">Select category...</option>
                    {categoryOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <label className="block font-semibold mb-1">Topic</label>
                  <input
                    className="input input-bordered w-full"
                    value={subLeadForm.topic}
                    onChange={e => setSubLeadForm(f => ({ ...f, topic: e.target.value }))}
                    placeholder="Enter topic"
                  />
                  <label className="block font-semibold mb-1">Special Notes</label>
                  <textarea className="textarea textarea-bordered w-full" value={subLeadForm.special_notes} onChange={e => setSubLeadForm(f => ({ ...f, special_notes: e.target.value }))} />
                  <button className="btn btn-primary mt-4" onClick={() => setSubLeadStep('details')}>Save & Next</button>
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
                  <button className="btn btn-primary mt-4" onClick={handleSaveSubLead} disabled={isSavingSubLead}>
                    {isSavingSubLead ? 'Saving...' : 'Save Sub-Lead'}
                  </button>
                </>
              )}
            </div>
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

      {/* Balance Edit Modal */}
      <BalanceEditModal
        isOpen={isBalanceModalOpen}
        onClose={() => setIsBalanceModalOpen(false)}
        selectedClient={selectedClient}
        onUpdate={(clientId) => refreshClientData(clientId || selectedClient?.id)}
      />
    </div>
  );
};

export default Clients;