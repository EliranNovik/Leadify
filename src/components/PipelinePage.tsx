import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { AcademicCapIcon, MagnifyingGlassIcon, CalendarIcon, ChevronUpIcon, ChevronDownIcon, XMarkIcon, UserIcon, ChatBubbleLeftRightIcon, FolderIcon, ChartBarIcon, QuestionMarkCircleIcon, PhoneIcon, EnvelopeIcon, PaperClipIcon, PaperAirplaneIcon, FaceSmileIcon, CurrencyDollarIcon, EyeIcon, Squares2X2Icon, Bars3Icon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { FileText, PencilLine } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import DocumentModal from './DocumentModal';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { InteractionRequiredAuthError, IPublicClientApplication, AccountInfo } from '@azure/msal-browser';
import { toast } from 'react-hot-toast';

interface LeadForPipeline {
  id: number;
  lead_number: string;
  name: string;
  created_at: string;
  expert?: string;
  topic?: string;
  handler_notes?: { content: string }[];
  expert_notes?: { content: string }[];
  meetings: { meeting_date: string }[];
  onedrive_folder_link?: string;
  stage?: string;
  number_of_applicants_meeting?: number;
  potential_applicants_meeting?: number;
  balance?: number;
  balance_currency?: string;
  probability?: number;
  eligibility_status?: string | null;
  next_followup?: string | null;
  manual_interactions?: any[];
  email?: string;
  mobile?: string;
  phone?: string;
  comments?: { text: string; timestamp: string; user: string }[];
  label?: string;
  highlighted_by?: string[];
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

const LABEL_OPTIONS = [
  'High Value',
  'Low Value',
  'Potential Clients',
  'High Risk',
  'Low Risk',
];

const PipelinePage: React.FC = () => {
  const [leads, setLeads] = useState<LeadForPipeline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCreatedDateFrom, setFilterCreatedDateFrom] = useState('');
  const [filterCreatedDateTo, setFilterCreatedDateTo] = useState('');
  const [filterBalanceMin, setFilterBalanceMin] = useState('');
  const [filterBy, setFilterBy] = useState('followup_upcoming');
  const [sortColumn, setSortColumn] = useState<'created_at' | 'meeting_date' | 'stage' | 'offer' | 'probability' | 'total_applicants' | 'potential_applicants' | 'follow_up' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedLead, setSelectedLead] = useState<LeadForPipeline | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [newContact, setNewContact] = useState({
    method: 'email',
    date: '',
    time: '',
    length: '',
    content: '',
    observation: '',
  });
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeAttachments, setComposeAttachments] = useState<{ name: string; contentType: string; contentBytes: string }[]>([]);
  const [emails, setEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [whatsAppInput, setWhatsAppInput] = useState('');
  // WhatsApp chat messages for the chat box (from selectedLead.manual_interactions)
  const whatsAppChatMessages = (selectedLead?.manual_interactions || [])
    .filter((i: any) => i.kind === 'whatsapp')
    .sort((a: any, b: any) => new Date(a.raw_date).getTime() - new Date(b.raw_date).getTime());
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
  const [sending, setSending] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [labelFilter, setLabelFilter] = useState('');
  const [labelDropdownOpen, setLabelDropdownOpen] = useState<number | null>(null);
  const [labelSubmitting, setLabelSubmitting] = useState(false);
  const [highlightedLeads, setHighlightedLeads] = useState<LeadForPipeline[]>([]);
  const [highlightPanelOpen, setHighlightPanelOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [showSignedAgreements, setShowSignedAgreements] = useState(false);
  
  // Helper function to check if a lead is a signed agreement or past that stage
  const isSignedAgreementLead = (lead: LeadForPipeline) => {
    const stage = lead.stage || '';
    const stageLower = stage.toLowerCase();
    
    // Check for signed agreement stages
    const isSignedAgreement = 
      stageLower.includes('client signed agreement') ||
      stageLower.includes('client signed') ||
      stage === 'Client signed agreement' ||
      stage === 'Client Signed Agreement' ||
      stage === 'client signed agreement' ||
      stage === 'client signed' ||
      stageLower.includes('signed agreement');
    
    // Check for stages that come after signed agreement (like success, completed, etc.)
    const isPastSignedAgreement = 
      stageLower.includes('success') ||
      stageLower.includes('completed') ||
      stageLower.includes('finished') ||
      stageLower.includes('done') ||
      stageLower.includes('closed') ||
      stageLower.includes('finalized') ||
      stage === 'Success' ||
      stage === 'Completed' ||
      stage === 'Finished' ||
      stage === 'Done' ||
      stage === 'Closed' ||
      stage === 'Finalized';
    
    return isSignedAgreement || isPastSignedAgreement;
  };

  // Dynamically collect all unique stages from leads
  const stageOptions = useMemo(() => {
    const stages = new Set<string>();
    leads.forEach(lead => { if (lead.stage) stages.add(lead.stage); });
    return Array.from(stages);
  }, [leads]);

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Contracts signed in last 30 days (stage includes 'Client signed agreement')
    const contractsSignedLeads = leads.filter(lead => 
      isSignedAgreementLead(lead) && new Date(lead.created_at) >= thirtyDaysAgo
    );
    const contractsSigned = contractsSignedLeads.length;

    // Count total leads in pipeline (excluding signed agreements)
    const pipelineLeads = leads.filter(lead => !isSignedAgreementLead(lead));
    const totalLeads = pipelineLeads.length;

    // Calculate top worker (expert with most contracts signed in last 30 days)
    const expertCounts: Record<string, number> = {};
    contractsSignedLeads.forEach(lead => {
      const expert = lead.expert || 'Unknown';
      expertCounts[expert] = (expertCounts[expert] || 0) + 1;
    });
    let topWorker = 'N/A';
    let topWorkerCount = 0;
    Object.entries(expertCounts).forEach(([expert, count]) => {
      if (count > topWorkerCount) {
        topWorker = expert;
        topWorkerCount = count;
      }
    });

    return {
      contractsSigned,
      totalLeads,
      topWorker,
      topWorkerCount
    };
  }, [leads]);

  useEffect(() => {
    const fetchLeads = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          created_at,
          expert,
          topic,
          handler_notes,
          expert_notes,
          meetings (
            meeting_date
          ),
          onedrive_folder_link,
          stage,
          number_of_applicants_meeting,
          potential_applicants_meeting,
          balance,
          balance_currency,
          probability,
          eligibility_status,
          next_followup,
          manual_interactions,
          email,
          mobile,
          phone,
          comments,
          label,
          highlighted_by
        `)
        .order('created_at', { ascending: false });
      console.log('PipelinePage leads fetch:', { data, error });
      if (error) {
        console.error('Error fetching leads for pipeline page:', error);
        setLeads([]);
      } else {
        setLeads(data as LeadForPipeline[]);
      }
      setIsLoading(false);
    };
    fetchLeads();
  }, []);

  // Get signed agreement leads
  const signedAgreementLeads = useMemo(() => {
    return leads.filter(isSignedAgreementLead);
  }, [leads]);

  const filteredLeads = useMemo(() => {
    // Debug logging to see what's being filtered
    console.log('Pipeline filtering:', {
      showSignedAgreements,
      totalLeads: leads.length,
      signedAgreements: signedAgreementLeads.length,
      signedStages: signedAgreementLeads.map(lead => ({ name: lead.name, stage: lead.stage }))
    });

    // If showing signed agreements, return all signed agreement leads
    if (showSignedAgreements) {
      console.log('Showing signed agreements:', signedAgreementLeads);
      return signedAgreementLeads;
    }
    
    // Otherwise, exclude leads with "Client signed agreement" stage from the pipeline
    let filtered = leads.filter(lead => !isSignedAgreementLead(lead));
    console.log('Showing pipeline leads (excluding signed agreements):', filtered.length);
    
    return filtered;
    
    // Then apply other filters
    filtered = filtered.filter(lead => {
      const leadNameLower = lead.name.toLowerCase();
      const leadNumberLower = lead.lead_number.toLowerCase();
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = leadNameLower.includes(searchLower) || leadNumberLower.includes(searchLower);
      const createdDate = format(parseISO(lead.created_at), 'yyyy-MM-dd');
      const matchesFrom = filterCreatedDateFrom ? createdDate >= filterCreatedDateFrom : true;
      const matchesTo = filterCreatedDateTo ? createdDate <= filterCreatedDateTo : true;
      // Balance filter
      const balance = lead.balance !== undefined && lead.balance !== null ? Number(lead.balance) : null;
      const matchesBalanceMin = filterBalanceMin ? (balance !== null && balance >= Number(filterBalanceMin)) : true;
      const matchesLabel = labelFilter ? lead.label === labelFilter : true;
      return matchesSearch && matchesFrom && matchesTo && matchesBalanceMin && matchesLabel;
    });
    const today = new Date();
    today.setHours(0,0,0,0);
    if (filterBy === 'all') {
      return filtered;
    } else if (filterBy === 'followup_missed') {
      // Only leads with a past follow up date, sorted by oldest first, then leads with no date
      const past = filtered.filter(lead => lead.next_followup && parseISO(lead.next_followup) < today)
        .sort((a, b) => parseISO(a.next_followup!).getTime() - parseISO(b.next_followup!).getTime());
      const noDate = filtered.filter(lead => !lead.next_followup);
      return [...past, ...noDate];
    } else if (filterBy === 'followup_upcoming') {
      // Only leads with a today/future follow up date, sorted by soonest first, then leads with no date
      const future = filtered.filter(lead => lead.next_followup && parseISO(lead.next_followup) >= today)
        .sort((a, b) => parseISO(a.next_followup!).getTime() - parseISO(b.next_followup!).getTime());
      const noDate = filtered.filter(lead => !lead.next_followup);
      return [...future, ...noDate];
    } else if (filterBy === 'commented') {
      // Only leads with at least one comment
      return filtered.filter(lead => lead.comments && lead.comments.length > 0);
    } else if (filterBy.startsWith('stage:')) {
      // Only leads with the selected stage
      const stage = filterBy.replace('stage:', '');
      return filtered.filter(lead => lead.stage === stage);
    } else if (filterBy === 'top10_offer') {
      // Top 10 highest offer
      return [...filtered]
        .filter(lead => typeof lead.balance === 'number')
        .sort((a, b) => (b.balance || 0) - (a.balance || 0))
        .slice(0, 10);
    } else if (filterBy === 'top10_probability') {
      // Top 10 highest probability
      return [...filtered]
        .filter(lead => typeof lead.probability === 'number')
        .sort((a, b) => (b.probability || 0) - (a.probability || 0))
        .slice(0, 10);
    }
    return filtered;
  }, [leads, showSignedAgreements, searchQuery, filterCreatedDateFrom, filterCreatedDateTo, filterBalanceMin, filterBy, labelFilter]);

  const handleSort = (column: 'created_at' | 'meeting_date' | 'stage' | 'offer' | 'probability' | 'total_applicants' | 'potential_applicants' | 'follow_up') => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortedLeads = useMemo(() => {
    console.log('sortedLeads useMemo - filteredLeads:', filteredLeads.length, 'showSignedAgreements:', showSignedAgreements);
    let leadsToSort = [...filteredLeads];
    if (sortColumn) {
      leadsToSort.sort((a, b) => {
        let aValue, bValue;
        switch (sortColumn) {
          case 'created_at':
            aValue = a.created_at;
            bValue = b.created_at;
            break;
          case 'meeting_date':
            aValue = a.meetings[0]?.meeting_date || '';
            bValue = b.meetings[0]?.meeting_date || '';
            break;
          case 'stage':
            aValue = a.stage || '';
            bValue = b.stage || '';
            break;
          case 'offer':
            aValue = a.balance ?? 0;
            bValue = b.balance ?? 0;
            break;
          case 'probability':
            aValue = a.probability ?? 0;
            bValue = b.probability ?? 0;
            break;
          case 'total_applicants':
            aValue = a.number_of_applicants_meeting ?? 0;
            bValue = b.number_of_applicants_meeting ?? 0;
            break;
          case 'potential_applicants':
            aValue = a.potential_applicants_meeting ?? 0;
            bValue = b.potential_applicants_meeting ?? 0;
            break;
          case 'follow_up':
            aValue = a.next_followup ? new Date(a.next_followup).getTime() : 0;
            bValue = b.next_followup ? new Date(b.next_followup).getTime() : 0;
            break;
          default:
            aValue = '';
            bValue = '';
        }
        if (sortColumn === 'created_at') {
          aValue = a.created_at;
          bValue = b.created_at;
        } else if (sortColumn === 'meeting_date') {
          aValue = a.meetings[0]?.meeting_date || '';
          bValue = b.meetings[0]?.meeting_date || '';
        }
        if (!aValue && !bValue) return 0;
        if (!aValue) return sortDirection === 'asc' ? -1 : 1;
        if (!bValue) return sortDirection === 'asc' ? 1 : -1;
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return leadsToSort;
  }, [filteredLeads, sortColumn, sortDirection]);

  const handleRowClick = (lead: LeadForPipeline) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
    setNewComment('');
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedLead(null), 400);
  };

  const openContactDrawer = () => {
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
    });
    setContactDrawerOpen(true);
    setDrawerOpen(false);
  };

  const closeContactDrawer = () => {
    setContactDrawerOpen(false);
  };

  const handleNewContactChange = (field: string, value: string) => {
    setNewContact((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveContact = async () => {
    if (!selectedLead) return;

    const now = new Date();
    // Get current user's full name
    let currentUserFullName = 'Current User';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: userData } = await supabase
          .from('users')
          .select('full_name, name')
          .eq('email', user.email)
          .single();
        if (userData?.full_name) {
          currentUserFullName = userData.full_name;
        } else if (userData?.name) {
          currentUserFullName = userData.name;
        }
      }
    } catch (error) {
      console.error('Error fetching user info:', error);
    }

    const newInteraction = {
      id: `manual_${now.getTime()}`,
      date: newContact.date || now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      time: newContact.time || now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      raw_date: now.toISOString(),
      employee: currentUserFullName,
      direction: 'out',
      kind: newContact.method,
      length: newContact.length ? `${newContact.length}m` : '',
      content: newContact.content,
      observation: newContact.observation,
      editable: true,
    };

    try {
      const existingInteractions = selectedLead.manual_interactions || [];
      const updatedInteractions = [...existingInteractions, newInteraction];

      const { error: updateError } = await supabase
        .from('leads')
        .update({ manual_interactions: updatedInteractions })
        .eq('id', selectedLead.id);

      if (updateError) throw updateError;
      
      // Update local state
      setSelectedLead({ ...selectedLead, manual_interactions: updatedInteractions });
      closeContactDrawer();
      
      // Refresh leads data
      const fetchLeads = async () => {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            created_at,
            expert,
            topic,
            handler_notes,
            expert_notes,
            meetings (
              meeting_date
            ),
            onedrive_folder_link,
            stage,
            number_of_applicants_meeting,
            potential_applicants_meeting,
            balance,
            balance_currency,
            probability,
            eligibility_status,
            next_followup,
            manual_interactions,
            email,
            mobile,
            phone,
            comments,
            label
          `)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching leads for pipeline page:', error);
          setLeads([]);
        } else {
          setLeads(data as LeadForPipeline[]);
        }
        setIsLoading(false);
      };
      
      await fetchLeads();
    } catch (error) {
      console.error('Error saving contact:', error);
    }
  };

  const handleAttachmentUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (file.size > 4 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const base64Content = content.split(',')[1];
          if (!base64Content) return;
          setComposeAttachments(prev => [...prev, {
            name: file.name,
            contentType: file.type,
            contentBytes: base64Content
          }]);
        } catch (err) {}
      };
      reader.readAsDataURL(file);
    }
  };

  // MSAL hooks
  const { instance, accounts } = useMsal();

  // Fetch emails from Outlook/Graph when opening email modal
  const handleOpenEmailModal = async () => {
    setIsEmailModalOpen(true);
    if (!selectedLead || !instance || !accounts[0]) return;
    setEmailsLoading(true);
    try {
      const tokenResponse = await acquireToken(instance, accounts[0]);
      await syncClientEmails(tokenResponse.accessToken, selectedLead);
      // Fetch emails from DB for this lead
      const { data } = await supabase.from('emails').select('*').eq('client_id', selectedLead.id).order('sent_at', { ascending: false });
      setEmails(data || []);
    } catch (e) {
      // Optionally show error
    }
    setEmailsLoading(false);
  };

  // Helper to acquire token, falling back to popup if needed
  const acquireToken = async (instance: IPublicClientApplication, account: AccountInfo) => {
    try {
      return await instance.acquireTokenSilent({ ...loginRequest, account });
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        return await instance.acquireTokenPopup({ ...loginRequest, account });
      }
      throw error;
    }
  };

  // Microsoft Graph API: Fetch emails for a client and sync to DB
  async function syncClientEmails(token: string, lead: LeadForPipeline) {
    if (!lead.email || !lead.lead_number) return;
    const searchQuery = `"${lead.lead_number}" OR "${lead.email}"`;
    const url = `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(searchQuery)}&$top=50&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,hasAttachments`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ConsistencyLevel: 'eventual'
      }
    });
    if (!res.ok) return;
    const json = await res.json();
    const messages: any[] = json.value || [];
    const clientMessages = messages.filter((msg: any) =>
      (msg.subject && msg.subject.includes(lead.lead_number)) ||
      (msg.from?.emailAddress?.address.toLowerCase() === lead.email!.toLowerCase()) ||
      (msg.toRecipients || []).some((r: any) => r.emailAddress.address.toLowerCase() === lead.email!.toLowerCase()) ||
      (msg.ccRecipients || []).some((r: any) => r.emailAddress.address.toLowerCase() === lead.email!.toLowerCase())
    );
    if (clientMessages.length === 0) return;
    clientMessages.sort((a: any, b: any) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime());
    // No attachments for now
    const emailsToUpsert = clientMessages.map((msg: any) => ({
      message_id: msg.id,
      client_id: lead.id,
      thread_id: msg.conversationId,
      sender_name: msg.from?.emailAddress?.name,
      sender_email: msg.from?.emailAddress?.address,
      recipient_list: (msg.toRecipients || []).map((r: any) => r.emailAddress.address).join(', '),
      subject: msg.subject,
      body_preview: msg.body?.content || '',
      sent_at: msg.receivedDateTime,
      direction: msg.from?.emailAddress?.address.toLowerCase().includes('lawoffice.org.il') ? 'outgoing' : 'incoming',
      attachments: null,
    }));
    await supabase.from('emails').upsert(emailsToUpsert, { onConflict: 'message_id' });
  };

  // Set default subject when opening compose drawer
  useEffect(() => {
    if (showCompose && selectedLead) {
      const defaultSubject = `[${selectedLead.lead_number}] - ${selectedLead.name} - ${selectedLead.topic || ''}`;
      setComposeSubject(defaultSubject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompose, selectedLead]);

  // Send email via Microsoft Graph (copied from InteractionsTab)
  async function sendClientEmail(token: string, subject: string, body: string, lead: LeadForPipeline, senderName: string, attachments: { name: string; contentType: string; contentBytes: string }[]) {
    const signature = `<br><br>Best regards,<br>${senderName}<br>Decker Pex Levi Law Offices`;
    const fullBody = body + signature;
    const messageAttachments = attachments.map(att => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.name,
      contentType: att.contentType,
      contentBytes: att.contentBytes
    }));
    const draftMessage = {
      subject,
      body: { contentType: 'HTML', content: fullBody },
      toRecipients: [{ emailAddress: { address: lead.email! } }],
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    };
    // 1. Create a draft message to get its ID
    const createDraftUrl = `https://graph.microsoft.com/v1.0/me/messages`;
    const draftRes = await fetch(createDraftUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(draftMessage),
    });
    if (!draftRes.ok) {
      throw new Error('Failed to create email draft.');
    }
    const createdDraft = await draftRes.json();
    const messageId = createdDraft.id;
    if (!messageId) {
      throw new Error('Could not get message ID from draft.');
    }
    // 2. Send the draft message
    const sendUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/send`;
    const sendRes = await fetch(sendUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!sendRes.ok) {
      throw new Error('Failed to send email.');
    }
    return createdDraft;
  }

  // Helper to get current user's name
  async function fetchCurrentUserName() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.email) {
      const { data, error } = await supabase
        .from('users')
        .select('full_name')
        .eq('email', user.email)
        .single();
      if (!error && data?.full_name) {
        return data.full_name;
      }
      return user.email;
    }
    return 'Unknown';
  }

  // Add comment to lead
  const handleAddComment = async () => {
    if (!selectedLead || !newComment.trim()) return;
    setCommentSubmitting(true);
    const now = new Date().toISOString();
    const userName = await fetchCurrentUserName();
    const newCommentObj = { text: newComment.trim(), timestamp: now, user: userName };
    const updatedComments = [...(selectedLead.comments || []), newCommentObj];
    try {
      const { error } = await supabase
        .from('leads')
        .update({ comments: updatedComments })
        .eq('id', selectedLead.id);
      if (error) throw error;
      setSelectedLead({ ...selectedLead, comments: updatedComments });
      setNewComment('');
      // Optionally refresh leads
      setLeads(leads => leads.map(l => l.id === selectedLead.id ? { ...l, comments: updatedComments } : l));
    } catch (err) {
      // Optionally show error
    }
    setCommentSubmitting(false);
  };

  const handleLabelChange = async (leadId: number, label: string) => {
    setLabelSubmitting(true);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ label })
        .eq('id', leadId);
      if (error) throw error;
      setLeads(leads => leads.map(l => l.id === leadId ? { ...l, label } : l));
      setLabelDropdownOpen(null);
    } catch (err) {
      // Optionally show error
    }
    setLabelSubmitting(false);
  };

  // Fetch user id on mount
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);
    })();
  }, []);

  // Set highlightedLeads based on leads.highlighted_by
  useEffect(() => {
    if (!userId || leads.length === 0) return;
    setHighlightedLeads(
      leads.filter(l => Array.isArray(l.highlighted_by) && l.highlighted_by.includes(userId))
    );
  }, [userId, leads]);

  const handleHighlight = async (lead: LeadForPipeline) => {
    if (!userId || highlightedLeads.find(l => String(l.id) === String(lead.id))) return;
    // Add userId to highlighted_by array
    const highlightedBy = Array.isArray(lead.highlighted_by) ? [...lead.highlighted_by] : [];
    if (!highlightedBy.includes(userId)) {
      highlightedBy.push(userId);
      await supabase.from('leads').update({ highlighted_by: highlightedBy }).eq('id', lead.id);
      setHighlightedLeads(prev => [...prev, { ...lead, highlighted_by: highlightedBy }]);
      setHighlightPanelOpen(true);
    }
  };
  const handleRemoveHighlight = async (leadId: string) => {
    if (!userId) return;
    const lead = leads.find(l => String(l.id) === String(leadId));
    if (!lead) return;
    let highlightedBy = Array.isArray(lead.highlighted_by) ? [...lead.highlighted_by] : [];
    highlightedBy = highlightedBy.filter((id: string) => id !== userId);
    await supabase.from('leads').update({ highlighted_by: highlightedBy }).eq('id', leadId);
    setHighlightedLeads(prev => prev.filter(l => String(l.id) !== String(leadId)));
  };

  // For scrolling/animating to a main card
  const mainCardRefs = useRef<{ [id: number]: HTMLDivElement | null }>({});
  const handleHighlightCardClick = (leadId: number) => {
    const ref = mainCardRefs.current[leadId];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ref.classList.add('ring-4', 'ring-primary', 'animate-pulse');
      setTimeout(() => {
        ref.classList.remove('animate-pulse');
        setTimeout(() => ref.classList.remove('ring-4', 'ring-primary'), 600);
      }, 1200);
    }
    setHighlightPanelOpen(false);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <ChartBarIcon className="w-8 h-8 text-primary" />
          {showSignedAgreements ? 'Signed Agreements' : 'Pipeline'}
        </h1>
      </div>
      {/* Filters and Search */}
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        {/* Search Bar */}
        <div className="relative flex items-center h-full w-full max-w-md mb-2 md:mb-0">
          <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50" />
          <input
            type="text"
            placeholder="Search by name or lead..."
            className="input input-bordered w-full pl-10 max-w-xs"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        {/* Filters row: right-aligned on md+ */}
        <div className="flex flex-col gap-2 md:flex-row md:gap-4 md:justify-end w-full md:w-auto">
          {/* Filter by Balance (Amount) */}
          <div className="flex flex-col items-start gap-1 min-w-[120px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1 flex items-center gap-1">
              <CurrencyDollarIcon className="w-4 h-4 text-base-content/70" /> Amount
            </label>
            <input
              type="number"
              className="input input-bordered w-full max-w-[90px]"
              value={filterBalanceMin}
              onChange={e => setFilterBalanceMin(e.target.value)}
              placeholder="Min"
            />
          </div>
          {/* Filter by Label */}
          <div className="flex flex-col items-start gap-1 min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Label</label>
            <select
              className="select select-bordered w-full"
              value={labelFilter}
              onChange={e => setLabelFilter(e.target.value)}
            >
              <option value="">All</option>
              {LABEL_OPTIONS.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          {/* Filter by Created Date Range */}
          <div className="flex flex-col items-start gap-1 min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Created Date</label>
            <div className="flex items-center gap-2 w-full">
              <input
                type="date"
                className="input input-bordered w-full max-w-[120px]"
                value={filterCreatedDateFrom}
                onChange={e => setFilterCreatedDateFrom(e.target.value)}
                placeholder="From"
              />
              <input
                type="date"
                className="input input-bordered w-full max-w-[120px]"
                value={filterCreatedDateTo}
                onChange={e => setFilterCreatedDateTo(e.target.value)}
                placeholder="To"
              />
            </div>
          </div>
          {/* Filter By Dropdown */}
          <div className="flex flex-col items-start gap-1 min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Filter by</label>
            <select
              className="select select-bordered w-full"
              value={filterBy}
              onChange={e => setFilterBy(e.target.value)}
            >
              <option value="all">View all</option>
              <option value="followup_upcoming">Follow Up Date: Upcoming</option>
              <option value="followup_missed">Follow Up Date: Missed</option>
              <option value="commented">Commented</option>
              {stageOptions.map(stage => (
                <option key={stage} value={`stage:${stage}`}>Stage: {stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
              <option value="top10_offer">Top 10 Highest Offer</option>
              <option value="top10_probability">Top 10 Highest Probability</option>
            </select>
          </div>
        </div>
      </div>
      {/* Summary Statistics Cards */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Contracts Signed */}
        <div 
          className="bg-gradient-to-br from-green-400 via-green-500 to-green-600 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105 cursor-pointer"
          onClick={() => {
            console.log('Contracts Signed box clicked! Current state:', showSignedAgreements);
            setShowSignedAgreements(!showSignedAgreements);
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm font-medium">Contracts Signed</p>
              <p className="text-3xl font-bold">{summaryStats.contractsSigned}</p>
              <p className="text-green-100 text-xs mt-1">Last 30 days</p>
            </div>
            <div className="flex items-center gap-2 bg-white/20 rounded-full p-3">
              <FileText className="w-7 h-7 text-white/90" />
              <PencilLine className="w-6 h-6 text-white/80 -ml-2" />
            </div>
          </div>
        </div>

        {/* Top Worker */}
        <div className="bg-gradient-to-br from-blue-400 via-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm font-medium">Top Closer</p>
              <p className="text-xl font-bold truncate">{summaryStats.topWorker}</p>
              <p className="text-blue-100 text-xs mt-1">{summaryStats.topWorkerCount} contract{summaryStats.topWorkerCount === 1 ? '' : 's'} signed (last 30 days)</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
              <UserIcon className="w-8 h-8" />
            </div>
          </div>
        </div>

        {/* Total Leads */}
        <div className="bg-gradient-to-br from-purple-400 via-purple-500 to-purple-600 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm font-medium">Total Leads</p>
              <p className="text-3xl font-bold">{summaryStats.totalLeads}</p>
              <p className="text-purple-100 text-xs mt-1">In pipeline</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
              <ChartBarIcon className="w-8 h-8" />
            </div>
          </div>
        </div>
      </div>

      {/* Leads Cards/List Grid Toggle */}
      <div className="flex justify-end mb-2">
        <button
          className="btn btn-outline btn-primary btn-sm flex items-center gap-2"
          onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')}
          title={viewMode === 'cards' ? 'Switch to List View' : 'Switch to Card View'}
        >
          {viewMode === 'cards' ? (
            <Bars3Icon className="w-5 h-5" />
          ) : (
            <Squares2X2Icon className="w-5 h-5" />
          )}
          <span className="hidden md:inline">{viewMode === 'cards' ? 'List View' : 'Card View'}</span>
        </button>
      </div>
      {/* Leads Cards Grid or List */}
      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
          {isLoading ? (
            <div className="col-span-full text-center p-8">
              <div className="loading loading-spinner loading-lg"></div>
              <p className="mt-4 text-base-content/60">Loading leads...</p>
            </div>
          ) : sortedLeads.length > 0 ? (
            sortedLeads.map((lead) => (
              <div
                key={lead.id}
                ref={el => (mainCardRefs.current[lead.id] = el)}
                className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative pb-16"
              >
                <div onClick={() => handleRowClick(lead)} className="flex-1 cursor-pointer flex flex-col">
                  {/* Lead Number and Name */}
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <h3 className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                    {lead.label && (
                      <span className="ml-2 px-2 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border-2 border-primary">{lead.label}</span>
                    )}
                    {/* Label display */}
                    {lead.eligibility_status && lead.eligibility_status !== '' ? (
                      <AcademicCapIcon className="w-6 h-6 text-green-400 ml-4" title="Feasibility chosen" />
                    ) : (
                      <QuestionMarkCircleIcon className="w-6 h-6 text-yellow-400 ml-2" title="Feasibility not chosen" />
                    )}
                  </div>
                  {/* Stage */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs font-semibold text-gray-500">Stage</span>
                    <span className={
                      'text-xs font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white'
                    }>
                      {lead.stage ? lead.stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'N/A'}
                    </span>
                  </div>
                  <div className="space-y-2 divide-y divide-gray-100">
                    {/* Category */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Category</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">{lead.topic || 'N/A'}</span>
                    </div>
                    {/* Offer (Balance) */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Offer</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">
                        {lead.balance !== undefined && lead.balance !== null 
                          ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance}` 
                          : 'N/A'}
                      </span>
                    </div>
                    {/* Probability */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Probability</span>
                      <span className={`text-sm font-bold ml-2 ${
                        (lead.probability || 0) >= 80 ? 'text-green-600' :
                        (lead.probability || 0) >= 60 ? 'text-yellow-600' :
                        (lead.probability || 0) >= 40 ? 'text-orange-600' :
                        'text-red-600'
                      }`}>
                        {lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}
                      </span>
                    </div>
                    {/* Total Applicants */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Total Applicants</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">
                        {lead.number_of_applicants_meeting ?? 'N/A'}
                      </span>
                    </div>
                    {/* Potential Applicants */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Potential Applicants</span>
                      <span className="text-sm font-bold text-gray-800 ml-2">
                        {lead.potential_applicants_meeting ?? 'N/A'}
                      </span>
                    </div>
                    {/* Follow Up Date */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Follow Up Date</span>
                      {lead.next_followup ? (() => {
                        const followupDate = parseISO(lead.next_followup);
                        const today = new Date();
                        today.setHours(0,0,0,0);
                        const isPast = followupDate < today;
                        const badgeClass = isPast ? 'bg-purple-600 text-white' : 'bg-green-500 text-white';
                        return (
                          <span className={`text-xs font-bold ml-2 px-2 py-1 rounded ${badgeClass}`}>
                            {format(followupDate, 'dd/MM/yyyy')}
                          </span>
                        );
                      })() : (
                        <span className="text-sm font-bold text-gray-800 ml-2">N/A</span>
                      )}
                    </div>
                  </div>

                  {/* Meeting Date (if available) */}
                  {lead.meetings.length > 0 && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                      <CalendarIcon className="w-4 h-4" />
                      <span>Meeting: {lead.meetings[0].meeting_date}</span>
                    </div>
                  )}
                </div>
                {/* View Lead Button */}
                <div className="mt-4 flex justify-end">
                  <Link
                    to={`/clients/${lead.lead_number}`}
                    className="btn btn-outline btn-primary btn-sm flex items-center justify-center"
                    title="View Lead"
                  >
                    <EyeIcon className="w-5 h-5" />
                  </Link>
                  <button
                    className="btn btn-outline btn-warning btn-sm ml-2 flex items-center justify-center"
                    title={highlightedLeads.find(l => l.id === lead.id) ? 'Highlighted' : 'Highlight'}
                    onClick={() => handleHighlight(lead)}
                    disabled={!!highlightedLeads.find(l => l.id === lead.id)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-yellow-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M6.05 17.95l-1.414 1.414m12.728 0l-1.414-1.414M6.05 6.05L4.636 4.636" /></svg>
                  </button>
                </div>
                {/* Most recent comment at the bottom left */}
                {lead.comments && lead.comments.length > 0 ? (
                  <div className="absolute left-5 bottom-5 max-w-[85%] flex items-end">
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow text-white text-sm font-bold">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4-4.03 7-9 7a9.77 9.77 0 01-4-.8l-4.28 1.07a1 1 0 01-1.21-1.21l1.07-4.28A7.94 7.94 0 013 12c0-4 4.03-7 9-7s9 3 9 7z"/></svg>
                      </div>
                      <div className="relative bg-white border border-base-200 rounded-2xl px-4 py-2 shadow-md text-sm text-base-content/90" style={{minWidth: '120px'}}>
                        <div className="font-medium leading-snug max-w-xs truncate" title={lead.comments[lead.comments.length - 1].text}>{lead.comments[lead.comments.length - 1].text}</div>
                        <div className="text-[11px] text-base-content/50 text-right mt-1">
                          {lead.comments[lead.comments.length - 1].user} · {format(new Date(lead.comments[lead.comments.length - 1].timestamp), 'dd/MM/yyyy HH:mm')}
                        </div>
                        {/* Chat bubble pointer */}
                        <div className="absolute left-[-10px] bottom-2 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-white border-l-0"></div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="" style={{ minHeight: 0, paddingBottom: 0 }} />
                )}
              </div>
            ))
          ) : (
            <div className="col-span-full text-center p-8">
              <div className="text-base-content/60">
                <ChartBarIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No leads found</p>
                <p className="text-sm">Try adjusting your search or filters</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto w-full mt-6 bg-base-100 rounded-2xl shadow-lg border border-base-200 p-0">
          <table className="table-auto divide-y divide-base-200 text-base w-full">
            <thead className="sticky top-0 z-10 bg-base-200 font-semibold text-base-content shadow-sm">
              <tr>
                <th className="py-3 px-2 text-left rounded-l-xl">Lead</th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('stage')}>
                  Stage {sortColumn === 'stage' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('offer')}>
                  Offer {sortColumn === 'offer' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('probability')}>
                  Probability {sortColumn === 'probability' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="py-3 px-2 text-center">Label</th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('total_applicants')}>
                  Total Applicants {sortColumn === 'total_applicants' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('potential_applicants')}>
                  Potential Applicants {sortColumn === 'potential_applicants' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="cursor-pointer select-none py-3 px-2 text-center" onClick={() => handleSort('follow_up')}>
                  Follow Up {sortColumn === 'follow_up' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                </th>
                <th className="py-3 px-2 text-center rounded-r-xl">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedLeads.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-base-content/60">No leads found</td></tr>
              ) : (
                sortedLeads.map((lead, idx) => (
                  <tr
                    key={lead.id}
                    className="transition group bg-base-100 hover:bg-primary/5 border-b-2 border-base-300"
                    onClick={() => handleRowClick(lead)}
                  >
                    {/* Lead column: lead number + name (left-aligned) */}
                    <td className="px-2 py-3 md:py-4 rounded-l-xl truncate max-w-[180px] text-left">
                      <div className="flex flex-col">
                        <span className="font-mono font-bold text-xs text-gray-500 truncate">{lead.lead_number}</span>
                        <span className="font-semibold text-base-content truncate">{lead.name}</span>
                      </div>
                    </td>
                    {/* Stage */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      <span className="badge badge-sm bg-[#3b28c7] text-white font-bold">
                        {lead.stage ? lead.stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'N/A'}
                      </span>
                    </td>
                    {/* Offer */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      {lead.balance !== undefined && lead.balance !== null ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance}` : 'N/A'}
                    </td>
                    {/* Probability */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      <span className={`font-bold ${(lead.probability ?? 0) >= 80 ? 'text-green-600' : (lead.probability ?? 0) >= 60 ? 'text-yellow-600' : (lead.probability ?? 0) >= 40 ? 'text-orange-600' : 'text-red-600'}`}>{lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}</span>
                    </td>
                    {/* Label */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      {lead.label ? <span className="badge badge-outline badge-primary font-semibold">{lead.label}</span> : ''}
                    </td>
                    {/* Total Applicants */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">{lead.number_of_applicants_meeting ?? 'N/A'}</td>
                    {/* Potential Applicants */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">{lead.potential_applicants_meeting ?? 'N/A'}</td>
                    {/* Follow Up */}
                    <td className="px-2 py-3 md:py-4 text-center truncate">
                      {lead.next_followup ? format(parseISO(lead.next_followup), 'dd/MM/yyyy') : 'N/A'}
                    </td>
                    {/* Actions */}
                    <td className="px-2 py-3 md:py-4 flex gap-2 items-center justify-center rounded-r-xl" onClick={e => e.stopPropagation()}>
                      <Link to={`/clients/${lead.lead_number}`} className="btn btn-outline btn-xs btn-primary rounded-full hover:scale-105 transition-transform" title="View Lead"><EyeIcon className="w-4 h-4" /></Link>
                      <button
                        className="btn btn-outline btn-xs btn-warning flex items-center justify-center rounded-full hover:scale-105 transition-transform group"
                        title={highlightedLeads.find(l => l.id === lead.id) ? 'Highlighted' : 'Highlight'}
                        onClick={() => handleHighlight(lead)}
                        disabled={!!highlightedLeads.find(l => l.id === lead.id)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-yellow-500 group-hover:text-white transition-colors"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M6.05 17.95l-1.414 1.414m12.728 0l-1.414-1.414M6.05 6.05L4.636 4.636" /></svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {/* Drawer for lead summary */}
      {drawerOpen && selectedLead && !isDocumentModalOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300" onClick={closeDrawer} />
          {/* Lead Summary Drawer */}
          <div className={`ml-auto w-full max-w-xl bg-white h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50 rounded-l-2xl relative`} style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}>
            {/* Header with close button */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-800">Lead Details</h2>
              <button
                onClick={closeDrawer}
                className="btn btn-ghost btn-sm btn-circle hover:bg-gray-100"
                aria-label="Close drawer"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            {/* Label at the top */}
            <div className="flex items-center gap-3 mb-2 relative">
              {selectedLead.label && (
                <span className="px-2 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">{selectedLead.label}</span>
              )}
              <div className="relative">
                <button
                  className="btn btn-xs btn-outline btn-primary"
                  onClick={() => setLabelDropdownOpen(labelDropdownOpen === selectedLead.id ? null : selectedLead.id)}
                  disabled={labelSubmitting}
                >
                  {selectedLead.label ? 'Edit Label' : 'Add Label'}
                </button>
                {labelDropdownOpen === selectedLead.id && (
                  <div className="absolute left-0 mt-2 z-50 bg-white border border-base-200 rounded-lg shadow-lg p-2 min-w-[160px]">
                    {LABEL_OPTIONS.map(option => (
                      <button
                        key={option}
                        className={`block w-full text-left px-3 py-1 rounded hover:bg-primary/10 ${selectedLead.label === option ? 'bg-primary/10 text-primary font-bold' : ''}`}
                        onClick={() => handleLabelChange(selectedLead.id, option)}
                        disabled={labelSubmitting}
                      >
                        {option}
                      </button>
                    ))}
                    <button
                      className="block w-full text-left px-3 py-1 rounded hover:bg-base-200 text-error mt-1"
                      onClick={() => handleLabelChange(selectedLead.id, '')}
                      disabled={labelSubmitting}
                    >Remove Label</button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-6 flex-1 overflow-y-auto">
              <div className="flex items-center gap-3">
                <UserIcon className="w-6 h-6 text-base-content/70" />
                <span className="font-semibold text-lg">{selectedLead.name} <span className="text-base-content/50">({selectedLead.lead_number})</span></span>
              </div>
              <div className="flex items-center gap-3">
                <AcademicCapIcon className="w-6 h-6 text-base-content/70" />
                <span className="font-medium">Expert:</span>
                <span>{selectedLead.expert || <span className='text-base-content/40'>Not assigned</span>}</span>
              </div>
              <div className="flex items-center gap-3">
                <ChatBubbleLeftRightIcon className="w-6 h-6 text-base-content/70" />
                <span className="font-medium">Category:</span>
                <span>{selectedLead.topic || <span className='text-base-content/40'>N/A</span>}</span>
              </div>
              {/* Documents Button */}
              <div>
                <span className="font-medium">Documents:</span>
                {selectedLead.onedrive_folder_link ? (
                  <button
                    onClick={() => {
                      setDrawerOpen(false);
                      setIsDocumentModalOpen(true);
                    }}
                    className="btn btn-outline btn-primary mt-2 flex items-center gap-2"
                  >
                    <FolderIcon className="w-5 h-5" />
                    Open Documents
                  </button>
                ) : (
                  <span className="ml-2 text-base-content/40">No link available</span>
                )}
              </div>
              {/* Contact Client Button */}
              <div>
                <span className="font-medium"></span>
                <div className="dropdown mt-2">
                  <label tabIndex={0} className="btn btn-outline btn-primary flex items-center gap-2 cursor-pointer">
                    <UserIcon className="w-5 h-5" /> Contact Client <ChevronDownIcon className="w-4 h-4 ml-1" />
                  </label>
                  <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 mt-2 z-[100]">
                    <li>
                      <button className="flex gap-2 items-center" onClick={handleOpenEmailModal}>
                        <EnvelopeIcon className="w-5 h-5" /> Email
                      </button>
                    </li>
                    <li>
                      <button className="flex gap-2 items-center" onClick={() => setIsWhatsAppOpen(true)}>
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
              </div>
              {/* Last Interactions (Employee & Client) */}
              <div>
                <span className="font-medium">Last Interactions:</span>
                <div className="mt-2 p-3 bg-base-200 rounded-lg text-base-content/80 flex flex-col gap-4">
                  {/* Find last employee and client interactions */}
                  {(() => {
                    const allInteractions = [...(selectedLead.manual_interactions || [])];
                    // Sort by date descending
                    allInteractions.sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());
                    const lastEmployee = allInteractions.find(i => i.direction === 'out');
                    const lastClient = allInteractions.find(i => i.direction === 'in');
                    return (
                      <>
                        <div>
                          <span className="font-semibold text-base-content">Employee:</span>
                          {lastEmployee ? (
                            <div className="mt-1">
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium">{lastEmployee.date} {lastEmployee.time}</span>
                                <span className="badge badge-sm">{lastEmployee.kind}</span>
                              </div>
                              <div className="text-sm mt-1">{lastEmployee.content}</div>
                              {lastEmployee.observation && (
                                <div className="text-xs text-base-content/60 mt-1">{lastEmployee.observation}</div>
                              )}
                            </div>
                          ) : (
                            <span className="ml-2 text-base-content/40">No employee interaction</span>
                          )}
                        </div>
                        <div>
                          <span className="font-semibold text-base-content">Client:</span>
                          {lastClient ? (
                            <div className="mt-1">
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium">{lastClient.date} {lastClient.time}</span>
                                <span className="badge badge-sm">{lastClient.kind}</span>
                              </div>
                              <div className="text-sm mt-1">{lastClient.content}</div>
                              {lastClient.observation && (
                                <div className="text-xs text-base-content/60 mt-1">{lastClient.observation}</div>
                              )}
                            </div>
                          ) : (
                            <span className="ml-2 text-base-content/40">No client interaction</span>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              {/* Expert Note */}
              <div>
                <span className="font-medium">Expert Note:</span>
                <div className="mt-2 p-3 bg-base-200 rounded-lg text-base-content/80">
                  {selectedLead.expert_notes && selectedLead.expert_notes.length > 0
                    ? selectedLead.expert_notes[selectedLead.expert_notes.length - 1].content
                    : <span className='text-base-content/40'>N/A</span>}
                </div>
              </div>
              <div>
                <span className="font-medium">Handler Notes:</span>
                <div className="mt-2 p-3 bg-base-200 rounded-lg text-base-content/80">
                  {selectedLead.handler_notes && selectedLead.handler_notes.length > 0
                    ? selectedLead.handler_notes[selectedLead.handler_notes.length - 1].content
                    : <span className='text-base-content/40'>N/A</span>}
                </div>
              </div>
              <div className="flex gap-6">
                <div>
                  <span className="font-medium">Date Created:</span>
                  <div className="mt-1 text-base-content/80">{format(parseISO(selectedLead.created_at), 'dd/MM/yyyy')}</div>
                </div>
                <div>
                  <span className="font-medium">Meeting Date:</span>
                  <div className="mt-1 text-base-content/80">{selectedLead.meetings.length > 0 ? selectedLead.meetings[0].meeting_date : <span className='text-base-content/40'>N/A</span>}</div>
                </div>
              </div>
              {/* Comments Section */}
              <div>
                <span className="font-medium">Comments:</span>
                <div className="mt-2 space-y-3">
                  {(selectedLead.comments && selectedLead.comments.length > 0) ? (
                    selectedLead.comments.slice().reverse().map((c, idx) => (
                      <div key={idx} className="bg-base-200 rounded-lg p-3 flex flex-col">
                        <span className="text-base-content/90">{c.text}</span>
                        <span className="text-xs text-base-content/50 mt-1">{c.user} · {format(new Date(c.timestamp), 'dd/MM/yyyy HH:mm')}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-base-content/40">No comments yet.</span>
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    className="input input-bordered flex-1"
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    disabled={commentSubmitting}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleAddComment}
                    disabled={commentSubmitting || !newComment.trim()}
                  >
                    {commentSubmitting ? 'Adding...' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Contact Drawer */}
      {contactDrawerOpen && selectedLead && (
        <div className="fixed inset-0 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300 z-[9998]" onClick={closeContactDrawer} />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col z-[9999]">
            <div className="animate-slideInRight h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold">Contact Client</h3>
                <button className="btn btn-ghost btn-sm" onClick={closeContactDrawer}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
              <div className="flex flex-col gap-4 flex-1">
                <div>
                  <label className="block font-semibold mb-1">How to contact</label>
                  <select
                    className="select select-bordered w-full"
                    value={newContact.method}
                    onChange={e => handleNewContactChange('method', e.target.value)}
                  >
                    <option value="email">Email</option>
                    <option value="phone">Phone</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="meeting">Meeting</option>
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
              <div className="mt-6 flex justify-end">
                <button className="btn btn-primary px-8" onClick={handleSaveContact}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Document Modal Drawer (right) */}
      {isDocumentModalOpen && selectedLead && (
        <div className="fixed inset-0 z-60 flex">
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300" onClick={() => { setIsDocumentModalOpen(false); setSelectedLead(null); }} />
          <div className="ml-auto w-full max-w-2xl bg-white h-full shadow-2xl p-0 flex flex-col animate-slideInRight z-60 rounded-l-2xl border-l-4 border-primary relative" style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}>
            <DocumentModal
              isOpen={isDocumentModalOpen}
              onClose={() => { setIsDocumentModalOpen(false); setSelectedLead(null); }}
              leadNumber={selectedLead.lead_number}
              clientName={selectedLead.name}
              onDocumentCountChange={() => {}}
            />
          </div>
        </div>
      )}
      {/* Email Thread Modal (copied from InteractionsTab) */}
      {isEmailModalOpen && selectedLead && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[999] flex items-start justify-center p-4">
          <div className="bg-base-100 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden mt-12">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-base-300">
              <h3 className="text-xl font-bold">Email Thread with {selectedLead.name}</h3>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary btn-sm" onClick={() => setShowCompose(true)}>
                  Compose New Email
                </button>
                <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setIsEmailModalOpen(false)}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>
            {/* Conversation Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {emailsLoading ? (
                <div className="text-center p-8">Loading email history...</div>
              ) : emails.length === 0 ? (
                <div className="text-center p-8 text-base-content/70">No emails found for this client.</div>
              ) : (
                [...emails].reverse().map(email => {
                  // Use sent_at or receivedDateTime for date
                  const sentDate = email.sent_at || email.date || email.receivedDateTime;
                  let formattedDate = 'Unknown date';
                  if (sentDate) {
                    try {
                      formattedDate = new Date(sentDate).toLocaleString();
                    } catch {}
                  }
                  return (
                    <div 
                      key={email.id} 
                      data-email-id={email.id}
                      className={`flex items-end gap-3 ${email.direction === 'outgoing' ? 'flex-row-reverse' : ''}`}
                    >
                      <div className={`avatar placeholder ${email.direction === 'outgoing' ? 'hidden' : ''}`}>
                        <div className="bg-neutral-focus text-neutral-content rounded-full w-10 h-10">
                          <span>{selectedLead.name.charAt(0)}</span>
                        </div>
                      </div>
                      <div className={`chat-bubble max-w-2xl break-words ${email.direction === 'outgoing' ? 'chat-bubble-primary' : 'bg-base-200'}`}> 
                        <div className="flex justify-between items-center text-xs opacity-70 mb-2">
                          <span className="font-bold">{email.from || email.sender_email}</span>
                          <span>{formattedDate}</span>
                        </div>
                        <div className="font-bold mb-2">{email.subject}</div>
                        <div className="prose" dangerouslySetInnerHTML={{ __html: email.bodyPreview || email.body_preview || email.body || '' }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Compose Email Modal (Drawer style, copied from InteractionsTab) */}
      {showCompose && selectedLead && createPortal(
        <div className="fixed inset-0 z-[999]">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowCompose(false)} />
          <div className="fixed inset-y-0 right-0 h-screen w-full max-w-md bg-base-100 shadow-2xl p-8 flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Compose Email</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCompose(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">To</label>
                <input type="text" className="input input-bordered w-full" value={selectedLead.email || ''} disabled />
              </div>
              <div>
                <label className="block font-semibold mb-1">Subject</label>
                <input type="text" className="input input-bordered w-full" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-2">Templates</label>
                <div className="flex flex-wrap gap-2">
                  {emailTemplates.map(template => (
                    <button
                      key={template.name}
                      className="btn btn-outline btn-xs"
                      onClick={() => {
                        const uploadLink = 'https://portal.example.com/upload';
                        const processedBody = template.body
                            .replace(/{client_name}/g, selectedLead.name)
                            .replace(/{upload_link}/g, uploadLink);
                        const newSubject = `[${selectedLead.lead_number}] - ${selectedLead.name} - ${selectedLead.topic || ''}`;
                        setComposeBody(processedBody);
                        setComposeSubject(newSubject);
                      }}
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Body</label>
                <textarea className="textarea textarea-bordered w-full min-h-[120px]" value={composeBody} onChange={e => setComposeBody(e.target.value)} />
              </div>
              {/* Attachments Section */}
              <div>
                <label className="block font-semibold mb-1">Attachments</label>
                <div className="p-4 bg-base-200 rounded-lg">
                  <div className="flex flex-col gap-2 mb-2">
                    {composeAttachments.map((att, index) => (
                      <div key={index} className="flex items-center justify-between text-sm">
                        <span>{att.name}</span>
                        <button 
                          className="btn btn-ghost btn-xs"
                          onClick={() => setComposeAttachments(prev => prev.filter(a => a.name !== att.name))}
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <label htmlFor="file-upload" className="btn btn-outline btn-sm w-full">
                    <PaperClipIcon className="w-4 h-4" /> Add Attachment
                  </label>
                  <input id="file-upload" type="file" className="hidden" onChange={(e) => e.target.files && handleAttachmentUpload(e.target.files)} />
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                className="btn btn-primary px-8"
                disabled={sending}
                onClick={async () => {
                  if (!selectedLead || !instance || !accounts[0]) return;
                  setSending(true);
                  try {
                    const tokenResponse = await acquireToken(instance, accounts[0]);
                    const senderName = accounts[0]?.name || 'Your Team';
                    await sendClientEmail(
                      tokenResponse.accessToken,
                      composeSubject,
                      composeBody,
                      selectedLead,
                      senderName,
                      composeAttachments
                    );
                    toast.success('Email sent and saved!');
                    // Refresh emails after sending
                    setEmailsLoading(true);
                    await syncClientEmails(tokenResponse.accessToken, selectedLead);
                    const { data } = await supabase.from('emails').select('*').eq('client_id', selectedLead.id).order('sent_at', { ascending: false });
                    setEmails(data || []);
                    setIsEmailModalOpen(false); // Close the email thread modal after sending
                  } catch (e: any) {
                    toast.error(e?.message || 'Failed to send email.');
                  }
                  setSending(false);
                }}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* WhatsApp Modal (copied from InteractionsTab) */}
      {isWhatsAppOpen && selectedLead && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden relative animate-fadeInUp">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-primary text-white">
              <div className="avatar placeholder">
                <div className="bg-primary text-white rounded-full w-10 h-10 flex items-center justify-center font-bold">
                  {selectedLead.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                </div>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-lg">{selectedLead.name}</div>
                <div className="text-xs text-primary-content/80">online</div>
              </div>
              <button className="btn btn-ghost btn-sm text-white" onClick={() => setIsWhatsAppOpen(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto px-4 py-6 bg-green-50" style={{ background: 'url(https://www.transparenttextures.com/patterns/cubes.png)', backgroundSize: 'auto' }}>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-5">
                  {whatsAppChatMessages.map((msg: any, idx: number) => (
                    <div key={msg.id || idx} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] px-4 py-2 rounded-2xl shadow text-sm relative ${msg.direction === 'out' ? 'bg-primary text-white rounded-br-md' : 'bg-white text-gray-900 rounded-bl-md border border-base-200'}`} style={{ wordBreak: 'break-word' }}>
                        {msg.content}
                        <div className="flex items-center gap-1 mt-1 text-[10px] opacity-70 justify-end">
                          <span>{msg.time}</span>
                          {msg.direction === 'out' && (
                            <span className="inline-block align-middle">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-blue-400" style={{ display: 'inline' }}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Input Area */}
            <form className="flex items-center gap-2 px-4 py-3 bg-base-200" onSubmit={async e => {
              e.preventDefault();
              if (whatsAppInput.trim()) {
                const now = new Date();
                const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                // Save WhatsApp message to DB (Supabase)
                let senderId = null;
                let senderName = 'You';
                try {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user?.id) {
                    // Look up the internal user id by auth_id
                    const { data: userRow, error: userLookupError } = await supabase
                      .from('users')
                      .select('id, full_name, email')
                      .eq('auth_id', user.id)
                      .single();
                    if (userLookupError || !userRow) {
                      toast.error('Could not find your user profile in the database.');
                      return;
                    }
                    senderId = userRow.id;
                    if (userRow.full_name) senderName = userRow.full_name;
                    else if (userRow.email) senderName = userRow.email;
                  }
                  // Insert into whatsapp_messages table
                  const { error: insertError } = await supabase
                    .from('whatsapp_messages')
                    .insert([
                      {
                        lead_id: selectedLead.id,
                        sender_id: senderId,
                        sender_name: senderName,
                        direction: 'out',
                        message: whatsAppInput,
                        sent_at: now.toISOString(),
                        status: 'sent',
                      }
                    ]);
                  if (insertError) {
                    console.error('[WhatsApp Insert Error]', insertError);
                    toast.error('Failed to save WhatsApp message: ' + insertError.message);
                    return;
                  }
                  // Fetch latest WhatsApp messages for this lead
                  const { data: whatsappData, error: fetchError } = await supabase
                    .from('whatsapp_messages')
                    .select('*')
                    .eq('lead_id', selectedLead.id)
                    .order('sent_at', { ascending: false });
                  let whatsappInteractions: any[] = [];
                  if (!fetchError && whatsappData) {
                    whatsappInteractions = whatsappData.map((msg: any) => ({
                      id: `whatsapp_${msg.id}`,
                      date: msg.sent_at ? new Date(msg.sent_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '',
                      time: msg.sent_at ? new Date(msg.sent_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
                      raw_date: msg.sent_at,
                      employee: msg.sender_name,
                      direction: msg.direction,
                      kind: 'whatsapp',
                      length: '',
                      content: msg.message,
                      observation: '',
                      editable: false,
                    }));
                  }
                  // Merge WhatsApp interactions into manual_interactions for timeline
                  const manualInteractions = selectedLead.manual_interactions || [];
                  const filteredManual = manualInteractions.filter(i => i.kind !== 'whatsapp');
                  const updatedInteractions = [...filteredManual, ...whatsappInteractions];
                  await supabase
                    .from('leads')
                    .update({ manual_interactions: updatedInteractions })
                    .eq('id', selectedLead.id);
                  // Fetch the updated lead from Supabase
                  const { data: updatedLeadArr, error: fetchLeadError } = await supabase
                    .from('leads')
                    .select('*')
                    .eq('id', selectedLead.id)
                    .single();
                  if (!fetchLeadError && updatedLeadArr) {
                    setSelectedLead(updatedLeadArr);
                    setLeads(prevLeads => prevLeads.map(l => l.id === selectedLead.id ? updatedLeadArr : l));
                  } else {
                    // fallback: update selectedLead locally
                    setSelectedLead({ ...selectedLead, manual_interactions: updatedInteractions });
                  }
                  setWhatsAppInput("");
                  toast.success('WhatsApp message sent!');
                } catch (err) {
                  console.error('Failed to save WhatsApp message to DB', err);
                  toast.error('Unexpected error saving WhatsApp message.');
                }
              }
            }}>
              <button type="button" className="btn btn-ghost btn-circle">
                <FaceSmileIcon className="w-6 h-6 text-gray-500" />
              </button>
              <button type="button" className="btn btn-ghost btn-circle">
                <PaperClipIcon className="w-6 h-6 text-gray-500" />
              </button>
              <input
                type="text"
                className="input input-bordered flex-1 rounded-full"
                placeholder="Type a message"
                value={whatsAppInput}
                onChange={e => setWhatsAppInput(e.target.value)}
              />
              <button type="submit" className="btn btn-success btn-circle">
                <PaperAirplaneIcon className="w-6 h-6" />
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}
      {/* Highlighted Cards Panel */}
      <div className={`fixed top-0 right-0 h-full z-40 flex items-start transition-transform duration-300 ${highlightPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 420 }}>
        <div className="relative h-full bg-white shadow-2xl border-l border-base-200 flex flex-col w-full">
          <div className="p-4 border-b border-base-200 flex items-center gap-2">
            <span className="font-bold text-lg">Highlights</span>
            <span className="badge badge-primary">{highlightedLeads.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {highlightedLeads.length === 0 ? (
              <div className="text-base-content/50 text-center mt-12">No highlighted leads yet.</div>
            ) : (
              highlightedLeads.map(lead => (
                <div key={lead.id} className="flex items-start gap-2">
                  {/* Card */}
                  <div
                    className="bg-white rounded-2xl shadow-lg border-2 border-primary/30 hover:shadow-2xl hover:border-primary/60 transition-all duration-200 cursor-pointer flex flex-col gap-2 relative p-4 group"
                    style={{ minHeight: 120, flex: 1 }}
                    onClick={() => handleHighlightCardClick(lead.id)}
                  >
                    {/* Label on top */}
                    {lead.label && (
                      <div className="mb-1 flex justify-start">
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border-2 border-primary">{lead.label}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="font-bold text-base-content truncate text-base">{lead.name}</span>
                    </div>
                    {/* Two rows of content */}
                    <div className="flex flex-row gap-4 text-xs mb-1">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Stage:</span>
                        <span>{lead.stage ? lead.stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Offer:</span>
                        <span>{lead.balance !== undefined && lead.balance !== null ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance}` : 'N/A'}</span>
                      </div>
                    </div>
                    <div className="flex flex-row gap-4 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Probability:</span>
                        <span>{lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Follow Up:</span>
                        <span>{lead.next_followup ? format(parseISO(lead.next_followup), 'dd/MM/yyyy') : 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                  {/* Remove button OUTSIDE the card */}
                  <button
                    className="btn btn-xs btn-error mt-2"
                    title="Remove from highlights"
                    onClick={e => { e.stopPropagation(); handleRemoveHighlight(String(lead.id)); }}
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {/* Highlight Panel Arrow Toggle (moves to left of panel when open) */}
      <button
        className={`fixed z-50 btn btn-circle btn-primary btn-sm transition-transform duration-300`}
        style={{
          top: 100,
          right: highlightPanelOpen ? 420 : 0,
          boxShadow: '0 2px 8px 0 rgba(0,0,0,0.10)',
          position: 'fixed',
        }}
        onClick={() => setHighlightPanelOpen(!highlightPanelOpen)}
        title={highlightPanelOpen ? 'Close Highlights' : 'Open Highlights'}
      >
        <svg className={`w-6 h-6 transition-transform ${highlightPanelOpen ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>
    </div>
  );
};

export default PipelinePage; 