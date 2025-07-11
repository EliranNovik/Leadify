import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase, type Lead } from '../lib/supabase';
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
  ClockIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ChartBarIcon,
  BanknotesIcon,
  TagIcon,
  FolderIcon,
  ChartPieIcon,
  DocumentChartBarIcon,
  Cog6ToothIcon,
  SparklesIcon,
  XMarkIcon,
  HandThumbUpIcon,
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

interface TabItem {
  id: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: number;
  component: React.ComponentType<ClientTabProps>;
}

const tabs: TabItem[] = [
  { id: 'info', label: 'Info', icon: InformationCircleIcon, component: InfoTab },
  { id: 'roles', label: 'Roles', icon: UserGroupIcon, component: RolesTab },
  { id: 'contact', label: 'Contact info', icon: UserIcon, component: ContactInfoTab },
  { id: 'marketing', label: 'Marketing', icon: MegaphoneIcon, component: MarketingTab },
  { id: 'expert', label: 'Expert', icon: UserIcon, component: ExpertTab },
  { id: 'meeting', label: 'Meeting', icon: CalendarIcon, component: MeetingTab },
  { id: 'price', label: 'Price Offer', icon: CurrencyDollarIcon, component: PriceOfferTab },
  { id: 'interactions', label: 'Interactions', icon: ChatBubbleLeftRightIcon, badge: 31, component: InteractionsTab },
];

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
  refreshClientData: (clientId: number) => Promise<void>;
}

const getCurrencySymbol = (currencyCode?: string) => {
  switch (currencyCode) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'NIS':
      return '₪';
    default:
      return '$';
  }
};

// Add currency options at the top of the component
const currencyOptions = [
  { value: 'NIS', label: 'NIS' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
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

const Clients: React.FC<ClientsProps> = ({
  selectedClient,
  setSelectedClient,
  refreshClientData,
}) => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('info');
  const [isStagesOpen, setIsStagesOpen] = useState(false);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const { instance } = useMsal();
  const { isAdmin, isLoading: isAdminLoading } = useAdminRole();
  const [isSchedulingMeeting, setIsSchedulingMeeting] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);
  const [showScheduleMeetingPanel, setShowScheduleMeetingPanel] = useState(false);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [meetingFormData, setMeetingFormData] = useState({
    date: '',
    time: '09:00',
    location: 'Teams',
    manager: '',
    helper: '',
  });
  const navigate = useNavigate();
  const [showUpdateDrawer, setShowUpdateDrawer] = useState(false);
  const [meetingNotes, setMeetingNotes] = useState('');
  const [nextFollowup, setNextFollowup] = useState('');
  const [followup, setFollowup] = useState('');
  const [potentialApplicants, setPotentialApplicants] = useState('');
  const [isSavingUpdate, setIsSavingUpdate] = useState(false);
  const [showMeetingEndedDrawer, setShowMeetingEndedDrawer] = useState(false);
  const [isSavingMeetingEnded, setIsSavingMeetingEnded] = useState(false);
  const [meetingEndedData, setMeetingEndedData] = useState({
    probability: 50,
    meetingBrief: '',
    numberOfApplicants: 1,
    potentialApplicants: 2,
    proposalTotal: '0.0',
    proposalCurrency: 'NIS',
    meetingTotal: '0.0',
    meetingTotalCurrency: 'NIS',
    meetingPaymentForm: '',
    specialNotes: '',
  });
  const [showSendOfferDrawer, setShowSendOfferDrawer] = useState(false);
  const [offerSubject, setOfferSubject] = useState('');
  const [offerBody, setOfferBody] = useState('');
  const [offerSending, setOfferSending] = useState(false);
  const [offerTemplateLang, setOfferTemplateLang] = useState<'en'|'he'|null>(null);
  const [offerTotal, setOfferTotal] = useState(selectedClient?.proposal_total || '');
  const [offerCurrency, setOfferCurrency] = useState(selectedClient?.proposal_currency || 'NIS');
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
    balance_currency: selectedClient?.balance_currency || 'NIS',
  });

  // --- Mobile Tabs Carousel State ---
  const mobileTabsRef = useRef<HTMLDivElement>(null);
  // Remove tabScales and wave zoom effect
  // ---

  // Local loading state for client data
  const [localLoading, setLocalLoading] = useState(true);

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
  const [autoPlan, setAutoPlan] = useState('40/30/30');
  const autoPlanOptions = [
    '40/30/30',
    '50/30/20',
    '34/33/33',
    '60/20/20',
    '70/20/10',
  ];
  const [payments, setPayments] = useState<any[]>([]);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [newPayment, setNewPayment] = useState({
    client: '',
    order: 'Intermediate Payment',
    date: '',
    currency: '₪',
    value: 0.0,
    applicants: '',
    notes: '',
  });

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

    // Manually refetch the client data to ensure it's up-to-date
    const { data, error } = await supabase
      .from('leads')
      .select('*, emails (*)')
      .eq('id', selectedClient.id)
      .single();

    if (error) {
      console.error('Error refreshing client data:', error);
    } else if (data) {
      setSelectedClient(data);
    }
  }, [selectedClient?.id, setSelectedClient]);

  useEffect(() => {
    let isMounted = true;
    const fetchClient = async () => {
      setLocalLoading(true);
      if (lead_number) {
        const { data, error } = await supabase
          .from('leads')
          .select('*, emails (*)')
          .eq('lead_number', lead_number)
          .single();

        if (error) {
          console.error('Error fetching client', error);
          navigate('/clients');
        } else if (isMounted) {
          setSelectedClient(data);
        }
      } else {
        const { data, error } = await supabase
          .from('leads')
          .select('*, emails (*)')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (error) {
          console.error('Error fetching latest client', error);
        } else if (isMounted) {
          navigate(`/clients/${data.lead_number}`);
          setSelectedClient(data);
        }
      }
      if (isMounted) setLocalLoading(false);
    };

    fetchClient();
    return () => { isMounted = false; };
  }, [lead_number, navigate, setSelectedClient]);

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
    } else if (newStage === 'Unactivate/Spam') {
      if (window.confirm('Are you sure you want to unactivate this lead?')) {
        await updateLeadStage('unactivated');
      }
    } else if (newStage === 'Paid Meeting') {
      await updateLeadStage('meeting_paid');
    } else if (newStage === 'Communication Started') {
      if (selectedClient.stage === 'scheduler_assigned') {
        setShowUpdateDrawer(true);
      } else {
        await updateLeadStage('communication_started');
      }
    } else if (newStage === 'Meeting Ended') {
      setActiveTab('meeting');
      setShowMeetingEndedDrawer(true);
    } else {
      setSelectedStage(newStage);
    }
  };

  const updateLeadStage = async (stage: string) => {
    if (!selectedClient) return;
    
    try {
      const { error } = await supabase
        .from('leads')
        .update({ stage })
        .eq('id', selectedClient.id);
      
      if (error) throw error;
      
      // Refresh client data
      await onClientUpdate();
      setSelectedStage(null);
    } catch (error) {
      console.error('Error updating lead stage:', error);
      alert('Failed to update lead stage. Please try again.');
    }
  };

  const updateScheduler = async (scheduler: string) => {
    if (!selectedClient) return;
    
    try {
      const { error } = await supabase
        .from('leads')
        .update({ scheduler: scheduler, stage: 'scheduler_assigned' })
        .eq('id', selectedClient.id);
      
      if (error) throw error;
      
      // Refresh client data
      await onClientUpdate();
    } catch (error) {
      console.error('Error updating scheduler:', error);
      alert('Failed to update scheduler. Please try again.');
    }
  };

  const getStageBadge = (stage: string) => {
    // Format stage: remove underscores, capitalize each word
    const formatted = (stage || 'No Stage')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
    return (
      <span
        className="badge badge-sm ml-2 px-3 py-1 min-w-max whitespace-nowrap"
        style={{ background: '#7c3aed', color: '#fff', fontSize: '0.875rem', borderRadius: '0.5rem', minHeight: '1.5rem' }}
      >
        {formatted}
      </span>
    );
  };

  const closeSchedulePanel = () => {
    setShowScheduleMeetingPanel(false);
    setMeetingFormData({
      date: '',
      time: '09:00',
      location: 'Teams',
      manager: '',
      helper: '',
    });
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
        alert("You must be signed in to schedule a Teams meeting.");
        setIsCreatingMeeting(false);
        return;
      }

      let teamsMeetingUrl = '';
      
      // Only create Teams meeting if location is Teams
      if (meetingFormData.location === 'Teams') {
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

        // Create Teams meeting
        teamsMeetingUrl = await createTeamsMeeting(accessToken, {
          subject: `Meeting with ${selectedClient.name}`,
          startDateTime: start.toISOString(),
          endDateTime: end.toISOString(),
          attendees: selectedClient.email ? [{ email: selectedClient.email }] : [],
        });
      }

      // Create meeting record in database
      const { error: meetingError } = await supabase
        .from('meetings')
        .insert([{
          client_id: selectedClient.id,
          meeting_date: meetingFormData.date,
          meeting_time: meetingFormData.time,
          meeting_location: meetingFormData.location,
          meeting_manager: meetingFormData.manager || account.name,
          meeting_currency: 'NIS',
          meeting_amount: 0,
          expert: selectedClient.expert || '---',
          helper: meetingFormData.helper || '---',
          teams_meeting_url: teamsMeetingUrl,
          meeting_brief: '',
          last_edited_timestamp: new Date().toISOString(),
          last_edited_by: account.name,
        }]);

      if (meetingError) throw meetingError;

      // Update lead stage to 'meeting_scheduled'
      await supabase
        .from('leads')
        .update({ stage: 'meeting_scheduled' })
        .eq('id', selectedClient.id);

      // Update UI
      setShowScheduleMeetingPanel(false);
      setIsSchedulingMeeting(false);
      setIsCreatingMeeting(false);
      setSelectedStage(null); // Close the dropdown
      
      // Reset form
      setMeetingFormData({
        date: '',
        time: '09:00',
        location: 'Teams',
        manager: '',
        helper: '',
      });
      
      // Show success message
      alert('Meeting scheduled successfully!');

      // Refresh client data
      onClientUpdate();
    } catch (error) {
      console.error('Error scheduling meeting:', error);
      alert('Failed to schedule meeting. Please try again.');
      setIsCreatingMeeting(false);
    }
  };

  const handleMeetingEndedChange = (field: string, value: any) => {
    setMeetingEndedData(prev => ({ ...prev, [field]: value }));
  };

  const handleMeetingIrrelevant = async () => {
    await updateLeadStage('unactivated');
    setShowMeetingEndedDrawer(false);
  };

  const handleSendPriceOffer = async () => {
    if (!selectedClient) return;
    setIsSavingMeetingEnded(true);

    const updateData = {
      probability: meetingEndedData.probability,
      meeting_brief: meetingEndedData.meetingBrief,
      number_of_applicants_meeting: meetingEndedData.numberOfApplicants,
      potential_applicants_meeting: meetingEndedData.potentialApplicants,
      proposal_total: parseFloat(meetingEndedData.proposalTotal),
      proposal_currency: meetingEndedData.proposalCurrency,
      balance: parseFloat(meetingEndedData.meetingTotal),
      balance_currency: meetingEndedData.meetingTotalCurrency,
      stage: 'waiting_for_mtng_sum',
    };

    try {
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
            meeting_amount: parseFloat(meetingEndedData.meetingTotal),
            meeting_currency: meetingEndedData.meetingTotalCurrency,
          })
          .eq('id', latestMeetingId);

        if (meetingUpdateError) throw meetingUpdateError;
      }

      const { error } = await supabase
        .from('leads')
        .update(updateData)
        .eq('id', selectedClient.id);
      
      if (error) throw error;
      
      setShowMeetingEndedDrawer(false);
      await onClientUpdate();
    } catch (error) {
      console.error('Error saving meeting ended data:', error);
      alert('Failed to save meeting data. Please ensure the new fields exist in the database.');
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
      const { error } = await supabase
        .from('leads')
        .update({
          meeting_scheduling_notes: meetingNotes,
          next_followup: nextFollowup,
          followup: followup,
          potential_applicants: potentialApplicants,
          stage: 'communication_started',
        })
        .eq('id', selectedClient.id);
      if (error) throw error;
      setShowUpdateDrawer(false);
      setMeetingNotes('');
      setNextFollowup('');
      setFollowup('');
      setPotentialApplicants('');
      if (onClientUpdate) await onClientUpdate();
    } catch (err) {
      alert('Failed to update lead.');
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
    setOfferCurrency(selectedClient?.proposal_currency || 'NIS');
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
      let closerName = account.name || 'Current User';
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
      await supabase
        .from('leads')
        .update({
          proposal_text: offerBody,
          proposal_total: offerTotal,
          proposal_currency: offerCurrency,
          closer: closerName,
          stage: 'Mtng sum+Agreement sent',
          balance: offerTotal ? parseFloat(offerTotal) : null,
          balance_currency: offerCurrency
        })
        .eq('id', selectedClient.id);
      toast.success('Offer email sent!');
      setShowSendOfferDrawer(false);
      await onClientUpdate();
    } catch (e) {
      toast.error('Failed to send offer email.');
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
    await supabase
      .from('leads')
      .update({ stage: 'Client signed agreement', date_signed: signedDate })
      .eq('id', selectedClient.id);
    setShowSignedDrawer(false);
    await onClientUpdate();
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
        balance: selectedClient.balance || '',
        next_followup: selectedClient.next_followup || '',
        balance_currency: selectedClient.balance_currency || 'NIS',
      });
    }
  }, [selectedClient]);

  const handleEditLeadChange = (field: string, value: any) => {
    setEditLeadData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveEditLead = async () => {
    if (!selectedClient) return;
    const updateData = {
      tags: editLeadData.tags,
      source: editLeadData.source,
      name: editLeadData.name,
      language: editLeadData.language,
      category: editLeadData.category,
      topic: editLeadData.topic,
      special_notes: editLeadData.special_notes,
      probability: Number(editLeadData.probability),
      number_of_applicants_meeting: editLeadData.number_of_applicants_meeting,
      potential_applicants_meeting: editLeadData.potential_applicants_meeting,
      balance: editLeadData.balance,
      next_followup: editLeadData.next_followup,
      balance_currency: editLeadData.balance_currency,
    };
    const { error } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', selectedClient.id);
    if (!error) {
      setShowEditLeadDrawer(false);
      if (onClientUpdate) await onClientUpdate();
      toast.success('Lead updated!');
    } else {
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
        teamsMeetingUrl = await createTeamsMeeting(accessToken, {
          subject: `Meeting with ${selectedClient.name}`,
          startDateTime: start.toISOString(),
          endDateTime: end.toISOString(),
          attendees: selectedClient.email ? [{ email: selectedClient.email }] : [],
        });
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
      setRescheduleFormData({ date: '', time: '09:00', location: 'Teams', manager: '', helper: '', amount: '', currency: 'NIS' });
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      toast.error('Failed to reschedule meeting.');
      console.error(error);
    }
  };





  // Tabs array with Finances tab
  const tabs = [
    { id: 'info', label: 'Info', icon: InformationCircleIcon, component: InfoTab },
    { id: 'roles', label: 'Roles', icon: UserGroupIcon, component: RolesTab },
    { id: 'contact', label: 'Contact info', icon: UserIcon, component: ContactInfoTab },
    { id: 'marketing', label: 'Marketing', icon: MegaphoneIcon, component: MarketingTab },
    { id: 'expert', label: 'Expert', icon: UserIcon, component: ExpertTab },
    { id: 'meeting', label: 'Meeting', icon: CalendarIcon, component: MeetingTab },
    { id: 'price', label: 'Price Offer', icon: CurrencyDollarIcon, component: PriceOfferTab },
    { id: 'interactions', label: 'Interactions', icon: ChatBubbleLeftRightIcon, badge: 31, component: InteractionsTab },
    { id: 'finances', label: 'Finances', icon: BanknotesIcon, component: FinancesTab },
  ];

  // Handle save payments plan
  const handleSavePaymentsPlan = async () => {
    if (!selectedClient?.id) return;
    
    setIsSavingPaymentPlan(true);
    const balance = selectedClient?.balance || 0;
    const vat = balance * 0.18;
    const total = balance + vat;
    
    // Create payments based on auto plan
    const payments: Array<{
      duePercent: string;
      dueDate: string;
      value: number;
      valueVat: number;
      client: string;
      order: string;
      proforma?: string;
      notes: string;
    }> = [];
    const planParts = autoPlan.split('/').map(Number);
    const totalAmount = total;
    
    let remainingAmount = totalAmount;
    for (let i = 0; i < planParts.length; i++) {
      const percentage = planParts[i];
      const amount = (totalAmount * percentage) / 100;
      const vatAmount = (amount * 0.18);
      
      payments.push({
        duePercent: `${percentage}%`,
        dueDate: new Date(Date.now() + (i + 1) * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
        value: Math.round(amount * 100) / 100,
        valueVat: Math.round(vatAmount * 100) / 100,
        client: selectedClient?.name || '',
        order: i === 0 ? 'First Payment' : i === planParts.length - 1 ? 'Final Payment' : 'Intermediate Payment',
        notes: '',
      });
      
      remainingAmount -= amount;
    }
    
    const newFinancePlan = {
      total: Math.round(totalAmount * 100) / 100,
      vat: Math.round(vat * 100) / 100,
      payments: payments,
    };
    
    try {
      // First, delete any existing payment plans for this lead
      const { error: deleteError } = await supabase
        .from('payment_plans')
        .delete()
        .eq('lead_id', selectedClient.id);
      
      if (deleteError) throw deleteError;
      
      // Insert new payment plans
      const paymentPlansToInsert = payments.map(payment => ({
        lead_id: selectedClient.id,
        due_percent: parseFloat(payment.duePercent.replace('%', '')),
        due_date: new Date(Date.now() + (payments.indexOf(payment) + 1) * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        value: payment.value,
        value_vat: payment.valueVat,
        client_name: payment.client,
        payment_order: payment.order,
        notes: payment.notes,
      }));
      
      const { error: insertError } = await supabase
        .from('payment_plans')
        .insert(paymentPlansToInsert);
      
      if (insertError) throw insertError;
      
      setShowPaymentsPlanDrawer(false);
      setActiveTab('finances');
      toast.success('Payment plan saved successfully!');
    } catch (error) {
      console.error('Error saving payment plan:', error);
      toast.error('Failed to save payment plan. Please try again.');
    } finally {
      setIsSavingPaymentPlan(false);
    }
  };

  // Proforma drawer state
  const [showProformaDrawer, setShowProformaDrawer] = useState(false);
  const [proformaData, setProformaData] = useState<any>(null);
  const [isSavingPaymentPlan, setIsSavingPaymentPlan] = useState(false);
  const [generatedProformaName, setGeneratedProformaName] = useState<string>('');

  // Handler to open proforma drawer
  const handleOpenProforma = async (payment: any) => {
    const proformaName = await generateProformaName(selectedClient?.id);
    setGeneratedProformaName(proformaName);
    
    setProformaData({
      client: selectedClient?.name,
      clientId: selectedClient?.id,
      paymentRowId: payment.id, // Add the payment row ID
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

  // Function to generate sequential proforma name
  const generateProformaName = async (clientId: number) => {
    if (!clientId) {
      const year = new Date().getFullYear();
      const timestamp = Date.now().toString().slice(-4);
      return `${year}-${timestamp} Proforma`;
    }
    
    try {
      // Get all existing proformas for this client
      const { data, error } = await supabase
        .from('payment_plans')
        .select('proforma')
        .eq('lead_id', clientId)
        .not('proforma', 'is', null);

      if (error) throw error;

      // Extract proforma names and find the highest number
      const existingNames = data
        .map(row => row.proforma)
        .filter(proforma => proforma && typeof proforma === 'string')
        .map(proforma => {
          try {
            const parsed = JSON.parse(proforma);
            return parsed.proformaName || '';
          } catch {
            return '';
          }
        })
        .filter(name => name.startsWith(`${new Date().getFullYear()}-`));

      // Find the highest number
      let maxNumber = 0;
      existingNames.forEach(name => {
        const match = name.match(/\d+$/);
        if (match) {
          const num = parseInt(match[0]);
          if (num > maxNumber) maxNumber = num;
        }
      });

      // Generate next number
      const nextNumber = maxNumber + 1;
      const year = new Date().getFullYear();
      return `${year}-${nextNumber.toString().padStart(2, '0')} Proforma`;
    } catch (error) {
      console.error('Error generating proforma name:', error);
      // Fallback to current timestamp
      const year = new Date().getFullYear();
      const timestamp = Date.now().toString().slice(-4);
      return `${year}-${timestamp} Proforma`;
    }
  };

  // Generate proforma content as a structured object
  const generateProformaContent = async (data: any, createdBy: string) => {
    const total = data.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
    const totalWithVat = data.addVat ? Math.round(total * 1.18 * 100) / 100 : total;
    
    // Generate proforma name
    const proformaName = await generateProformaName(data.clientId);
    
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
      if (instance && typeof instance.getAllAccounts === 'function') {
        const account = instance.getAllAccounts()[0];
        if (account && account.name) createdBy = account.name;
      }
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
  if (selectedClient && selectedClient.stage === 'Client signed agreement')
    dropdownItems = (
      <>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => setShowPaymentsPlanDrawer(true)}>
            <BanknotesIcon className="w-5 h-5 text-black" />
            Payments plan
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); }}>
            <CalendarDaysIcon className="w-5 h-5 text-black" />
            Schedule Meeting
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => setShowLeadSummaryDrawer(true)}>
            <DocumentTextIcon className="w-5 h-5 text-black" />
            Lead summary
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => updateLeadStage('payment_request_sent')}>
            <CurrencyDollarIcon className="w-5 h-5 text-black" />
            Payment request sent
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => handleStageUpdate('Unactivate/Spam')}>
            <NoSymbolIcon className="w-5 h-5 text-red-500" />
            <span className="text-red-500">Unactivate/Spam</span>
          </a>
        </li>
      </>
    );
  else if (selectedClient && selectedClient.stage === 'payment_request_sent') {
    dropdownItems = (
      <>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); }}>
            <CalendarDaysIcon className="w-5 h-5 text-black" />
            Schedule Meeting
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => setShowLeadSummaryDrawer(true)}>
            <DocumentTextIcon className="w-5 h-5 text-black" />
            Lead summary
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => updateLeadStage('client_signed')}>
            <CheckCircleIcon className="w-5 h-5 text-green-600" />
            Payment Received - new Client !!!
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => updateLeadStage('finances_and_payments_plan')}>
            <BanknotesIcon className="w-5 h-5 text-black" />
            Finances & Payments plan
          </a>
        </li>
      </>
    );
  } else if (selectedClient && !['unactivated', 'client_signed', 'client_declined', 'Mtng sum+Agreement sent'].includes(selectedClient.stage)) {
    dropdownItems = (
      <>
        {selectedClient.stage === 'meeting_scheduled' ? (
          <>
            <li>
              <a className="flex items-center gap-3 py-3" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); }}>
                <CalendarDaysIcon className="w-5 h-5 text-black" />
                Schedule Meeting
              </a>
            </li>
            <li>
              <a className="flex items-center gap-3 py-3" onClick={() => setShowRescheduleDrawer(true)}>
                <ArrowPathIcon className="w-5 h-5 text-black" />
                Meeting ReScheduling
              </a>
            </li>
            <li>
              <a className="flex items-center gap-3 py-3" onClick={() => handleStageUpdate('Meeting Ended')}>
                <CheckCircleIcon className="w-5 h-5 text-black" />
                Meeting Ended
              </a>
            </li>
          </>
        ) : (
          <li>
            <a className="flex items-center gap-3 py-3" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); }}>
              <CalendarDaysIcon className="w-5 h-5 text-black" />
              Schedule Meeting
            </a>
          </li>
        )}
        {selectedClient.stage === 'waiting_for_mtng_sum' && (
          <li>
            <a className="flex items-center gap-3 py-3" onClick={openSendOfferDrawer}>
              <DocumentCheckIcon className="w-5 h-5 text-black" />
              Send Price Offer
            </a>
          </li>
        )}
        {!['meeting_scheduled', 'waiting_for_mtng_sum', 'client_signed', 'client signed agreement', 'Client signed agreement', 'communication_started'].includes(selectedClient.stage) && (
          <li>
            <a className="flex items-center gap-3 py-3" onClick={() => handleStageUpdate('Communication Started')}>
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-black" />
              Communication Started
            </a>
          </li>
        )}
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => handleStageUpdate('Unactivate/Spam')}>
            <NoSymbolIcon className="w-5 h-5 text-red-500" />
            <span className="text-red-500">Unactivate/Spam</span>
          </a>
        </li>
      </>
    );
  } else if (selectedClient && selectedClient.stage === 'Mtng sum+Agreement sent') {
    dropdownItems = (
      <>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); }}>
            <CalendarDaysIcon className="w-5 h-5 text-black" />
            Schedule Meeting
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={handleOpenSignedDrawer}>
            <HandThumbUpIcon className="w-5 h-5 text-black" />
            Client signed
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={handleOpenDeclinedDrawer}>
            <HandThumbDownIcon className="w-5 h-5 text-black" />
            <span className="text-black">Client declined</span>
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => setShowLeadSummaryDrawer(true)}>
            <DocumentTextIcon className="w-5 h-5 text-black" />
            Lead summary
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => setShowEditLeadDrawer(true)}><PencilSquareIcon className="w-5 h-5 text-black" />Edit lead</a></li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => updateLeadStage('revised_offer')}>
            <PencilSquareIcon className="w-5 h-5 text-black" />
            Revised price offer
          </a>
        </li>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      {/* Vibrant 'Lead is cold' badge, top right, same height as Stages/Actions */}
      <div className="relative">
        {isLeadCold && (
          <div className="absolute right-4 top-0 z-20 flex items-center">
            <span className="rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-500 to-indigo-600 text-white shadow px-4 py-2 text-sm font-bold flex items-center gap-2 border-2 border-white/20">
              <svg className="w-4 h-4 text-white/90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Lead is cold: {coldLeadText}
            </span>
          </div>
        )}
      </div>
      {/* Client Details Section */}
      <div className="bg-base-100 rounded-lg shadow-lg w-full">
        {/* Stylish Professional Client Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          {/* Contact Information Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            {/* Contact Details */}
            <div className="rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.03] bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden">
              <div className="p-6">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <EnvelopeIcon className="w-5 h-5 text-white opacity-90" />
                  Contact
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-white/20">
                    <span className="text-white/80 font-medium">Email</span>
                    <a 
                      href={selectedClient ? `mailto:${selectedClient.email}` : undefined} 
                      className="text-white hover:text-white/80 transition-colors font-medium break-all text-right"
                    >
                      {selectedClient ? selectedClient.email : '---'}
                    </a>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-white/80 font-medium">Phone</span>
                    <a 
                      href={selectedClient ? `tel:${selectedClient.phone}` : undefined} 
                      className="text-white hover:text-white/80 transition-colors font-medium"
                    >
                      {selectedClient ? selectedClient.phone : '---'}
                    </a>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Case Information */}
            <div className="rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.03] bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden">
              <div className="p-6">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <DocumentTextIcon className="w-5 h-5 text-white opacity-90" />
                  Case Details
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-white/20">
                    <span className="text-white/80 font-medium">Category</span>
                    <span className="text-white font-semibold text-right">
                      {selectedClient ? (selectedClient.category || 'Not specified') : 'Not specified'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-white/80 font-medium">Topic</span>
                    <span className="text-white font-semibold text-right">
                      {selectedClient ? (selectedClient.topic || 'German Citizenship') : 'German Citizenship'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Progress Indicator */}
            <div className="rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.03] bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden">
              <div className="p-6">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <ChartBarIcon className="w-5 h-5 text-white opacity-90" />
                  Status
                </h3>
                {selectedClient && (
                  <div className="space-y-4">
                    <div className="py-2 border-b border-white/20">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-white/80 font-medium">Probability</span>
                        <span className="text-white font-bold">{selectedClient.probability || 0}%</span>
                      </div>
                      <div className="w-full bg-white/20 rounded-full h-2">
                        <div 
                          className="bg-white h-2 rounded-full transition-all duration-300" 
                          style={{ width: `${selectedClient.probability || 0}%` }}
                        ></div>
                      </div>
                    </div>
                    {selectedClient.next_followup && (
                      <div className="flex justify-between items-center py-2">
                        <span className="text-white/80 font-medium">Next Follow-up</span>
                        <span className="text-white font-semibold text-right">
                          {new Date(selectedClient.next_followup).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Main Client Info Row */}
          <div className="flex flex-wrap items-center justify-between gap-6 mt-6">
            {/* Left: Client Identity */}
            <div className="flex items-center gap-6 ml-4">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-1">
                  {selectedClient ? selectedClient.name : 'Loading...'}
                </h1>
                <div className="flex items-center gap-4">
                  <span className="text-xl font-semibold text-gray-600">
                    {selectedClient ? selectedClient.lead_number : ''}
                  </span>
                  {selectedClient && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 border border-purple-200">
                      {selectedClient.stage?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'No Stage'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            {/* Right: Balance & Actions */}
            <div className="flex items-center gap-4">
              {/* Balance Display */}
              {selectedClient && (
                <div className="text-2xl font-bold text-gray-900">
                  {getCurrencySymbol(selectedClient.balance_currency || selectedClient.proposal_currency)}
                  {(selectedClient.balance || 0).toLocaleString()}
                </div>
              )}
              
              {/* Action Buttons */}
              <div className="flex gap-3">
                <div className="dropdown">
                  <label 
                    tabIndex={0} 
                    className="btn bg-neutral text-neutral-content hover:bg-neutral-focus border-none gap-2 min-w-[120px] shadow-sm"
                  >
                    <span>Stages</span>
                    <ChevronDownIcon className="w-5 h-5" />
                  </label>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow-xl bg-white rounded-xl w-64 border border-gray-200">
                    {dropdownItems}
                  </ul>
                </div>
                
                <div className="dropdown dropdown-end">
                  <label 
                    tabIndex={0} 
                    className="btn bg-neutral text-neutral-content hover:bg-neutral-focus border-none gap-2 min-w-[120px] shadow-sm"
                  >
                    <span>Actions</span>
                    <ChevronDownIcon className="w-5 h-5" />
                  </label>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow-xl bg-white rounded-xl w-64 border border-gray-200">
                    <li>
                      <a className="flex items-center gap-3 py-3 hover:bg-red-50 transition-colors rounded-lg" onClick={e => { if (!window.confirm('Are you sure you want to unactivate this lead?')) e.preventDefault(); }}>
                        <NoSymbolIcon className="w-5 h-5 text-red-500" />
                        <span className="text-red-600 font-medium">Unactivate</span>
                      </a>
                    </li>
                    <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 transition-colors rounded-lg"><StarIcon className="w-5 h-5 text-amber-500" /><span className="font-medium">Ask for recommendation</span></a></li>
                    <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 transition-colors rounded-lg" onClick={() => setShowEditLeadDrawer(true)}><PencilSquareIcon className="w-5 h-5 text-blue-500" /><span className="font-medium">Edit lead</span></a></li>
                    <li><a className="flex items-center gap-3 py-3 hover:bg-gray-50 transition-colors rounded-lg"><Squares2X2Icon className="w-5 h-5 text-green-500" /><span className="font-medium">Create Sub-Lead</span></a></li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Tabs Navigation */}
        <div className="bg-white">
          <div className="w-full">
            {/* Desktop version */}
            <div className="hidden md:flex items-center px-4 py-4">
              <div className="flex bg-white rounded-xl shadow-lg border border-gray-200 p-1 gap-1 overflow-hidden w-full">
                                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      className={`relative flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-300 hover:scale-[1.02] flex-1 ${
                        activeTab === tab.id
                          ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg transform scale-[1.02]'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                    <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'text-white' : 'text-gray-500'}`} />
                    <span className="whitespace-nowrap">{tab.label}</span>
                    {tab.id === 'interactions' && (
                      <div className={`badge badge-sm font-bold ${
                        activeTab === tab.id 
                          ? 'bg-white/20 text-white border-white/30' 
                          : 'bg-purple-100 text-purple-700 border-purple-200'
                      }`}>
                        31
                      </div>
                    )}
                    {activeTab === tab.id && (
                      <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white rounded-full shadow-lg"></div>
                    )}
                  </button>
                ))}
              </div>
            </div>
            {/* Mobile version: modern card-based design */}
            <div className="md:hidden px-6 py-4">
              <div
                ref={mobileTabsRef}
                className="overflow-x-auto scrollbar-hide bg-white rounded-2xl shadow-lg border border-gray-200 p-3 w-full"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <div className="flex gap-2 pb-1">
                  {tabs.map((tab, idx) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 min-w-[80px] ${
                          isActive
                            ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-lg transform scale-105'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        <div className="relative">
                          <tab.icon className={`w-6 h-6 mb-1 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                          {tab.id === 'interactions' && (
                            <div className={`absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
                              isActive 
                                ? 'bg-white/20 text-white' 
                                : 'bg-purple-100 text-purple-700'
                            }`}>
                              31
                            </div>
                          )}
                        </div>
                        <span className={`text-xs font-semibold truncate max-w-[70px] ${
                          isActive ? 'text-white' : 'text-gray-600'
                        }`}>
                          {tab.label}
                        </span>
                        {isActive && (
                          <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-white rounded-full"></div>
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
        <div className="w-full bg-white min-h-screen">
          <div
            key={activeTab}
            className="p-6 pb-6 md:pb-6 mb-4 md:mb-0 slide-fade-in"
          >
            {ActiveComponent && <ActiveComponent client={selectedClient} onClientUpdate={onClientUpdate} />}
          </div>
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
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Schedule Meeting</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeSchedulePanel}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              {/* Location */}
              <div>
                <label className="block font-semibold mb-1">Location</label>
                <select
                  className="select select-bordered w-full"
                  value={meetingFormData.location}
                  onChange={(e) => setMeetingFormData(prev => ({ ...prev, location: e.target.value }))}
                >
                  <option value="Teams">Teams</option>
                  <option value="Jerusalem Office">Jerusalem Office</option>
                  <option value="Tel Aviv Office">Tel Aviv Office</option>
                  <option value="Phone Call">Phone Call</option>
                  <option value="WhatsApp">WhatsApp</option>
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
            </div>
            <div className="mt-6 flex justify-end">
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
                <label className="block font-semibold mb-1">Meeting scheduling notes:</label>
                <textarea
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
                <label className="block font-semibold mb-1">Followup:</label>
                <textarea
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
        <div className="fixed inset-0 z-50 flex">
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
                <input type="text" className="input input-bordered w-full" value={editLeadData.tags} onChange={e => handleEditLeadChange('tags', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Source</label>
                <input type="text" className="input input-bordered w-full" value={editLeadData.source} onChange={e => handleEditLeadChange('source', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Client Name</label>
                <input type="text" className="input input-bordered w-full" value={editLeadData.name} onChange={e => handleEditLeadChange('name', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Language</label>
                <input type="text" className="input input-bordered w-full" value={editLeadData.language} onChange={e => handleEditLeadChange('language', e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-1">Category</label>
                <input type="text" className="input input-bordered w-full" value={editLeadData.category} onChange={e => handleEditLeadChange('category', e.target.value)} />
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
                <input type="number" min="0" max="100" className="input input-bordered w-full" value={editLeadData.probability} onChange={e => handleEditLeadChange('probability', e.target.value)} />
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
                  <option value="NIS">NIS</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
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
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowPaymentsPlanDrawer(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-xl bg-white h-full shadow-2xl p-0 flex flex-col animate-slideInRight z-50 overflow-y-auto border-l border-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{selectedClient?.lead_number} - {selectedClient?.name}</h3>
                <div className="text-base font-medium text-gray-500 mt-1">Payments plan</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPaymentsPlanDrawer(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            {/* Summary Section */}
            <div className="px-8 pt-6 pb-4 border-b border-gray-100 bg-gray-50">
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
                    <span className="text-xl font-bold text-gray-900">₪{(selectedClient?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-base text-gray-600">VAT (18%)</span>
                  <span className="text-base font-semibold text-gray-900">₪{((selectedClient?.balance || 0) * 0.18).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-base text-gray-600">Total incl. VAT</span>
                  <span className="text-lg font-bold text-primary">₪{((selectedClient?.balance || 0) * 1.18).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
            {/* Auto plan dropdown */}
            <div className="px-8 pt-6 pb-2">
              <label className="block font-semibold mb-1 text-gray-700">Auto plan</label>
              <select
                className="select select-bordered w-full max-w-xs"
                value={autoPlan}
                onChange={e => setAutoPlan(e.target.value)}
              >
                {autoPlanOptions.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            {/* Add new payment button */}
            <div className="px-8 pb-2">
              <button className="btn btn-outline w-full" onClick={() => setShowAddPayment(true)}>
                Add new payment
              </button>
            </div>
            {/* Add Payment Form */}
            {showAddPayment && (
              <div className="bg-white rounded-xl shadow p-6 border border-gray-200 mb-6 mx-8">
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
                      <option>Intermediate Payment</option>
                      <option>First Payment</option>
                      <option>Final Payment</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Date:</label>
                    <input type="date" className="input input-bordered w-full" value={newPayment.date} onChange={e => setNewPayment({ ...newPayment, date: e.target.value })} />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Currency:</label>
                    <select className="select select-bordered w-full" value={newPayment.currency} onChange={e => setNewPayment({ ...newPayment, currency: e.target.value })}>
                      <option>₪</option>
                      <option>$</option>
                      <option>€</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Value:</label>
                    <input type="number" className="input input-bordered w-full text-right" value={newPayment.value} onChange={e => setNewPayment({ ...newPayment, value: parseFloat(e.target.value) })} />
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
                <div className="flex justify-end">
                  <button className="btn btn-primary px-8" onClick={() => { setPayments([...payments, newPayment]); setShowAddPayment(false); }}>
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
          <div className="ml-auto w-full max-w-2xl bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50 overflow-y-auto">
            {/* Header */}
            <div className="mb-6 p-4 rounded-lg bg-blue-100 border border-blue-200">
              <div className="text-lg font-semibold mb-1">
                Client: <span className="text-blue-700 font-bold">{proformaData.client}</span> <span className="inline-block text-blue-700 ml-2"><svg className="w-5 h-5 inline" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg></span> <span className="text-blue-900 font-bold">Missing Tax ID!</span>
              </div>
              <div className="text-md font-medium">Payment: <span className="text-blue-900 font-bold">₪ {proformaData.payment.toLocaleString()}</span></div>
              <div className="text-md">Language: {proformaData.language}</div>
              <div className="text-md mt-2">
                <span className="text-blue-900 font-bold">Proforma Name: </span>
                <span className="text-blue-700">{generatedProformaName}</span>
              </div>
            </div>
            <div className="mb-4 text-xl font-bold">Language: {proformaData.language}</div>
            {/* Editable table */}
            <table className="table w-full mb-4">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Total</th>
                  {!proformaData?.isViewMode && <th>Delete</th>}
                </tr>
              </thead>
              <tbody>
                {proformaData.rows.map((row: any, idx: number) => (
                  <tr key={idx}>
                    <td>
                      <input 
                        className="input input-bordered w-full" 
                        value={row.description} 
                        onChange={e => handleProformaRowChange(idx, 'description', e.target.value)}
                        readOnly={proformaData?.isViewMode}
                      />
                    </td>
                    <td>
                      <input 
                        className="input input-bordered w-16" 
                        type="number" 
                        value={row.qty} 
                        onChange={e => handleProformaRowChange(idx, 'qty', Number(e.target.value))}
                        readOnly={proformaData?.isViewMode}
                      />
                    </td>
                    <td>
                      <input 
                        className="input input-bordered w-24" 
                        type="number" 
                        value={row.rate} 
                        onChange={e => handleProformaRowChange(idx, 'rate', Number(e.target.value))}
                        readOnly={proformaData?.isViewMode}
                      />
                    </td>
                    <td><input className="input input-bordered w-24" type="number" value={row.total} readOnly /></td>
                    {!proformaData?.isViewMode && (
                      <td><a className="text-blue-600 hover:underline cursor-pointer" onClick={() => handleDeleteProformaRow(idx)}>delete</a></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!proformaData?.isViewMode && (
              <a className="text-blue-600 hover:underline cursor-pointer mb-2" onClick={handleAddProformaRow}>add row</a>
            )}
            {/* Totals */}
            <div className="mb-2 flex gap-4 items-center">
              <div>Total:</div>
              <input className="input input-bordered w-32" type="number" value={proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)} readOnly />
            </div>
            <div className="mb-4 flex gap-4 items-center">
              <div>Total with VAT:</div>
              <input className="input input-bordered w-32" type="number" value={proformaData.addVat ? Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 1.18 * 100) / 100 : proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)} readOnly />
            </div>
            {/* VAT, currency, bank, notes */}
            <div className="mb-4 flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  checked={proformaData.addVat} 
                  onChange={e => setProformaData((prev: any) => ({ ...prev, addVat: e.target.checked }))}
                  disabled={proformaData?.isViewMode}
                /> Add vat
              </label>
              <label>Currency:
                <select 
                  className="select select-bordered ml-2" 
                  value={proformaData.currency} 
                  onChange={e => setProformaData((prev: any) => ({ ...prev, currency: e.target.value }))}
                  disabled={proformaData?.isViewMode}
                >
                  <option value="₪">₪</option>
                  <option value="$">$</option>
                  <option value="€">€</option>
                </select>
              </label>
              <label>Bank account:
                <select 
                  className="select select-bordered ml-2" 
                  value={proformaData.bankAccount} 
                  onChange={e => setProformaData((prev: any) => ({ ...prev, bankAccount: e.target.value }))}
                  disabled={proformaData?.isViewMode}
                >
                  <option value="">---------</option>
                  <option value="1">Account 1</option>
                  <option value="2">Account 2</option>
                </select>
              </label>
            </div>
            <div className="mb-4">
              <label>Notes:</label>
              <textarea 
                className="textarea textarea-bordered w-full min-h-[100px]" 
                value={proformaData.notes} 
                onChange={e => setProformaData((prev: any) => ({ ...prev, notes: e.target.value }))}
                readOnly={proformaData?.isViewMode}
              />
            </div>
            {proformaData?.isViewMode ? (
              <div className="flex gap-2">
                <button className="btn btn-primary w-32" onClick={() => setShowProformaDrawer(false)}>Close</button>
                <button className="btn btn-outline w-32" onClick={() => {
                  // Remove view mode flag to allow editing
                  setProformaData((prev: any) => ({ ...prev, isViewMode: false }));
                }}>Edit</button>
              </div>
            ) : (
              <>
                <button className="btn btn-primary w-32" onClick={handleCreateProforma}>Create</button>
                <div className="mt-2 text-xs text-gray-500">* Once you create, CHANGES CANNOT be made!</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Clients;