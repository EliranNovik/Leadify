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
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
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

const Clients: React.FC<ClientsProps> = ({
  selectedClient,
  setSelectedClient,
  isLoading,
  setIsLoading,
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
    const fetchClient = async () => {
      setIsLoading(true);
      if (lead_number) {
        const { data, error } = await supabase
          .from('leads')
          .select('*, emails (*)')
          .eq('lead_number', lead_number)
          .single();

        if (error) {
          console.error('Error fetching client', error);
          navigate('/clients');
        } else {
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
        } else {
          navigate(`/clients/${data.lead_number}`);
          setSelectedClient(data);
        }
      }
      setIsLoading(false);
    };

    if (lead_number) {
      // Only fetch if the selected client isn't already the one from the URL
      if (selectedClient?.lead_number !== lead_number) {
        fetchClient();
      } else {
        setIsLoading(false);
      }
    } else {
        fetchClient(); // Fetch latest if no lead_number
    }
  }, [lead_number, navigate, setIsLoading, setSelectedClient]);

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
    return (
      <span
        className="badge bg-black text-white badge-lg ml-2 px-4 py-2 text-base min-w-fit whitespace-nowrap"
        style={{ fontSize: '1.1rem', minWidth: 120, maxWidth: '100%', lineHeight: 1.3 }}
      >
        {stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
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

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <span className="loading loading-spinner loading-lg text-primary"></span>
      </div>
    );
  }

  if (!selectedClient) {
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
  if (selectedClient.next_followup) {
    const today = new Date();
    const followupDate = new Date(selectedClient.next_followup);
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const followupMidnight = new Date(followupDate.getFullYear(), followupDate.getMonth(), followupDate.getDate());
    const diffDays = Math.floor((todayMidnight.getTime() - followupMidnight.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 7) {
      isLeadCold = true;
      coldLeadText = 'Please follow up with client as soon as possible.';
    }
  }

  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component;

  // Before the return statement, add:
  let dropdownItems = null;
  if (selectedClient.stage === 'Client signed agreement') {
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
          <a className="flex items-center gap-3 py-3" onClick={() => updateLeadStage('payment_request_sent')}>
            <CurrencyDollarIcon className="w-5 h-5 text-black" />
            Payment request sent
          </a>
        </li>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={() => updateLeadStage('finances_and_payments_plan')}>
            <BanknotesIcon className="w-5 h-5 text-black" />
            Finances & Payments plan
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
  } else if (selectedClient.stage === 'payment_request_sent') {
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
  } else if (!['unactivated', 'client_signed', 'client_declined', 'Mtng sum+Agreement sent'].includes(selectedClient.stage)) {
    dropdownItems = (
      <>
        <li>
          <a className="flex items-center gap-3 py-3" onClick={e => { e.preventDefault(); setShowScheduleMeetingPanel(true); }}>
            <CalendarDaysIcon className="w-5 h-5 text-black" />
            Schedule Meeting
          </a>
        </li>
        {selectedClient.stage === 'meeting_scheduled' && (
          <li>
            <a className="flex items-center gap-3 py-3" onClick={() => handleStageUpdate('Meeting Ended')}>
              <CheckCircleIcon className="w-5 h-5 text-black" />
              Meeting Ended
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
  } else if (selectedClient.stage === 'Mtng sum+Agreement sent') {
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
        {/* Client Header with Basic Info - moved to top */}
        <div className="border-b border-base-200 w-full px-4 pt-2 pb-2">
          {/* Top row: client details (with stage badge) and Stages/Actions buttons on the same height */}
          <div className="w-full relative flex flex-col md:flex-row md:items-start md:gap-8 min-h-[110px]">
            {/* Center: Stages/Actions buttons and amount badge - absolutely centered */}
            <div className="hidden md:flex flex-col items-center absolute left-1/2 top-0 -translate-x-1/2 z-10">
              <div className="flex gap-3 mb-2 mt-2">
                <div className="dropdown">
                  <label 
                    tabIndex={0} 
                    className="btn bg-neutral text-neutral-content hover:bg-neutral-focus border-none gap-2 min-w-[160px]"
                  >
                    <span>Stages</span>
                    <ChevronDownIcon className="w-5 h-5" />
                  </label>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow-lg bg-base-100 rounded-box w-60">
                    {dropdownItems}
                  </ul>
                </div>
                {selectedClient.stage === 'created' && (
                  <div className="dropdown">
                    <label 
                      tabIndex={0} 
                      className="btn bg-black text-white hover:bg-gray-800 border-none gap-2 min-w-[160px]"
                    >
                      <span>Assign to</span>
                      <ChevronDownIcon className="w-5 h-5" />
                    </label>
                    <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow-lg bg-base-100 rounded-box w-60">
                      <li><a className="flex items-center gap-3 py-3" onClick={() => updateScheduler('Anna Zh')}>Anna Zh</a></li>
                      <li><a className="flex items-center gap-3 py-3" onClick={() => updateScheduler('Mindi')}>Mindi</a></li>
                      <li><a className="flex items-center gap-3 py-3" onClick={() => updateScheduler('Sarah L')}>Sarah L</a></li>
                      <li><a className="flex items-center gap-3 py-3" onClick={() => updateScheduler('David K')}>David K</a></li>
                      <li><a className="flex items-center gap-3 py-3" onClick={() => updateScheduler('Yael')}>Yael</a></li>
                      <li><a className="flex items-center gap-3 py-3" onClick={() => updateScheduler('Michael R')}>Michael R</a></li>
                    </ul>
                  </div>
                )}
                <div className="dropdown">
                  <label 
                    tabIndex={0} 
                    className="btn bg-neutral text-neutral-content hover:bg-neutral-focus border-none gap-2 min-w-[160px]"
                  >
                    <span>Actions</span>
                    <ChevronDownIcon className="w-5 h-5" />
                  </label>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow-lg bg-base-100 rounded-box w-60">
                    <li>
                      <a className="flex items-center gap-3 py-3" onClick={e => { if (!window.confirm('Are you sure you want to unactivate this lead?')) e.preventDefault(); }}>
                        <NoSymbolIcon className="w-5 h-5 text-red-500" />
                        <span className="text-red-500">Unactivate</span>
                      </a>
                    </li>
                    <li><a className="flex items-center gap-3 py-3"><StarIcon className="w-5 h-5 text-black" />Ask for recommendation</a></li>
                    <li><a className="flex items-center gap-3 py-3" onClick={() => setShowEditLeadDrawer(true)}><PencilSquareIcon className="w-5 h-5 text-black" />Edit lead</a></li>
                    <li><a className="flex items-center gap-3 py-3"><Squares2X2Icon className="w-5 h-5 text-black" />Create Sub-Lead</a></li>
                  </ul>
                </div>
              </div>
              {/* Amount badge centered under buttons */}
              <div className="flex flex-col items-center mb-2">
                <div className="badge badge-lg badge-success gap-2 p-4">
                  <span className="text-2xl font-bold">{getCurrencySymbol((selectedClient as any).balance_currency || selectedClient.proposal_currency)}</span>
                  <span className="text-xl">{(selectedClient as any).balance || '0'}</span>
                </div>
              </div>
            </div>
            {/* Left: Client details stacked vertically */}
            <div className="flex flex-col gap-2 w-full md:w-auto md:max-w-xs">
              <h2 className="text-2xl font-bold">{selectedClient.name}</h2>
              <div className="flex items-center gap-2">
                <HashtagIcon className="w-5 h-5 text-primary" />
                <span className="text-lg">{selectedClient.lead_number}</span>
                <span className="ml-2">{getStageBadge(selectedClient.stage)}</span>
              </div>
              <div className="flex items-start gap-2">
                <EnvelopeIcon className="w-5 h-5 text-primary mt-1" />
                <a href={`mailto:${selectedClient.email}`} className="text-primary hover:underline break-all">
                  {selectedClient.email || '---'}
                </a>
              </div>
              <div className="flex items-start gap-2">
                <PhoneIcon className="w-5 h-5 text-primary mt-1" />
                <a href={`tel:${selectedClient.phone}`} className="text-primary hover:underline">
                  {selectedClient.phone || '---'}
                </a>
              </div>
              <div className="flex items-start gap-2">
                <DocumentTextIcon className="w-5 h-5 text-primary mt-1" />
                <span>{selectedClient.category || 'Not specified'} <span className="text-base-content/70">•</span> <span className="text-primary">{selectedClient.topic || 'German Citizenship'}</span></span>
              </div>
            </div>
          </div>
          {/* Stage badge - mobile only, below name (not on desktop) */}
          <div className="block md:hidden w-full mt-1">{getStageBadge(selectedClient.stage)}</div>
        </div>
        {/* Add a bigger gap before the tabs */}
        <div className="mt-10"></div>
        {/* Tabs Navigation */}
        <div className="border-b border-base-200">
          <div className="max-w-7xl mx-auto">
            {/* Desktop version */}
            <ul className="tabs tabs-lifted mb-[-1px] gap-2 px-6 hidden md:flex">
              {tabs.map((tab) => (
                <li key={tab.id}>
                  <button
                    className={`tab text-base font-medium px-6 py-4 ${
                      activeTab === tab.id ? 'tab-active !border-base-200' : ''
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <div className="flex items-center gap-2">
                      <tab.icon className="w-5 h-5" />
                      <span>{tab.label}</span>
                      {tab.id === 'interactions' && (
                        <div className="badge badge-primary badge-sm">31</div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {/* Mobile version: pro styling, no zoom */}
            <div className="md:hidden relative">
              <div
                ref={mobileTabsRef}
                className="overflow-x-auto scrollbar-hide -mx-2 px-2 py-3 flex items-center bg-base-200/80 rounded-2xl shadow-xl border border-base-300"
                style={{ WebkitOverflowScrolling: 'touch', backdropFilter: 'blur(6px)' }}
              >
                <ul className="flex gap-3 snap-x snap-mandatory w-full">
                  {tabs.map((tab, idx) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <li
                        key={tab.id}
                        className="snap-center flex-shrink-0 flex flex-col items-center justify-center"
                        data-tab-idx={idx}
                        style={{ width: 84, transition: 'width 0.2s' }}
                      >
                        <button
                          className={`flex items-center justify-center transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/60 border-2 mb-1 ${
                            isActive
                              ? 'bg-black text-white border-black shadow-[0_4px_24px_0_rgba(0,0,0,0.10)]'
                              : 'bg-white text-primary border-primary shadow-md hover:opacity-90'
                          }`}
                          onClick={() => setActiveTab(tab.id)}
                          style={{
                            width: isActive ? 56 : 48,
                            height: isActive ? 56 : 48,
                            minWidth: isActive ? 56 : 48,
                            minHeight: isActive ? 56 : 48,
                            maxWidth: isActive ? 56 : 48,
                            maxHeight: isActive ? 56 : 48,
                            borderRadius: 12,
                            boxShadow: isActive ? '0 6px 24px 0 rgba(0,0,0,0.10), 0 0 0 2px #000' : undefined,
                            transition: 'box-shadow 0.25s, background 0.25s, color 0.25s, width 0.25s, height 0.25s',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <tab.icon className={`w-6 h-6 ${isActive ? 'text-white' : 'text-primary'}`} />
                        </button>
                        <span className={`truncate font-bold tracking-wide w-full text-center`} style={{ letterSpacing: 0.5, fontSize: isActive ? 13 : 11, color: '#111' }}>{tab.label}</span>
                        {tab.id === 'interactions' && isActive && (
                          <span className="block w-2 h-2 mt-1 rounded-full bg-black border border-white mx-auto animate-bounce"></span>
                        )}
                      </li>
                    );
                  })}
                </ul>
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
    </div>
  );
};

export default Clients;