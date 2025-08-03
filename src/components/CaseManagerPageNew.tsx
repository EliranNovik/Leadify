import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { 
  Squares2X2Icon, 
  ListBulletIcon,
  UserGroupIcon,
  DocumentTextIcon,
  ClockIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  FolderIcon,
  CheckIcon,
  CurrencyDollarIcon,
  EnvelopeIcon,
  CalendarIcon,
  DocumentMagnifyingGlassIcon,
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';

// Import tab components
import DashboardTab from './case-manager/DashboardTab';
import CasesTab from './case-manager/CasesTab';
import ContactsTab from './case-manager/ContactsTab';
import DocumentsTab from './case-manager/DocumentsTab';
import TasksTab from './case-manager/TasksTab';
import StatusTab from './case-manager/StatusTab';
import NotesTab from './case-manager/NotesTab';
import CommunicationsTab from './case-manager/CommunicationsTab';
import FinanceTab from './case-manager/FinanceTab';

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
  notes?: string;
}

interface UploadedFile {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

interface TabItem {
  id: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: number;
}

const tabs: TabItem[] = [
  { id: 'cases', label: 'Cases', icon: FolderIcon },
  { id: 'contacts', label: 'Contacts', icon: UserGroupIcon },
  { id: 'documents', label: 'Documents', icon: DocumentTextIcon },
  { id: 'tasks', label: 'Tasks', icon: ClockIcon },
  { id: 'status', label: 'Status', icon: CheckIcon },
  { id: 'notes', label: 'Notes', icon: DocumentMagnifyingGlassIcon },
  { id: 'communications', label: 'Communications', icon: ChatBubbleLeftRightIcon },
  { id: 'finance', label: 'Finance', icon: ChartBarIcon },
];

type TabId = typeof tabs[number]['id'];

const CaseManagerPageNew: React.FC = () => {
  const [leads, setLeads] = useState<HandlerLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('cases');
  const [uploadingLeadId, setUploadingLeadId] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{ [leadId: string]: UploadedFile[] }>({});
  const [isUploading, setIsUploading] = useState(false);
  const mainContainerRef = useRef<HTMLDivElement>(null);

  // Dashboard specific states
  const [handlerCasesCount, setHandlerCasesCount] = useState(0);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [tasksDueCount, setTasksDueCount] = useState(0);
  const [documentsPendingCount, setDocumentsPendingCount] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCaseCards, setShowCaseCards] = useState(window.innerWidth >= 768); // Show by default on desktop
  
  // Tasks due data
  const [tasksDue, setTasksDue] = useState<any[]>([]);
  
  // Documents due data
  const [documentsDue, setDocumentsDue] = useState<any[]>([]);
  
  // New dashboard statistics
  const [caseStats, setCaseStats] = useState({
    inProcess: 0,
    applicationsSent: 0,
    approved: 0,
    declined: 0
  });
  const [totalBalance, setTotalBalance] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  
  // Single case view state
  const [selectedCase, setSelectedCase] = useState<HandlerLead | null>(null);

  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const fetchTaskCount = async () => {
    try {
      const { count, error } = await supabase
        .from('handler_tasks')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;
      setTasksDueCount(count || 0);
    } catch (error) {
      console.error('Error fetching task count:', error);
    }
  };

  const fetchHandlerStageStats = async () => {
    try {
      const { count, error } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .not('handler', 'is', null)
        .not('handler', 'eq', '')
        .not('handler', 'eq', '---');

      if (error) throw error;
      setHandlerCasesCount(count || 0);
    } catch (error) {
      console.error('Error fetching handler stage stats:', error);
    }
  };

  const fetchNewMessages = async () => {
    try {
      const { count, error } = await supabase
        .from('communications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (error) throw error;
      setNewMessagesCount(count || 0);
    } catch (error) {
      console.error('Error fetching new messages:', error);
    }
  };

  const fetchTasksDue = async () => {
    try {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const todayStr = today.toISOString().split('T')[0];
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      console.log('Fetching tasks for dates:', todayStr, tomorrowStr);
      
      const { data, error } = await supabase
        .from('handler_tasks')
        .select(`
          *,
          lead:leads(name, lead_number)
        `)
        .in('due_date', [todayStr, tomorrowStr])
        .neq('status', 'completed')
        .order('priority', { ascending: false });
      
      if (error) {
        console.error('Error fetching tasks due:', error);
      } else if (data) {
        console.log('Tasks due fetched:', data);
        console.log('Number of tasks found:', data.length);
        setTasksDue(data);
        setTasksDueCount(data.length);
      } else {
        console.log('No tasks found for today or tomorrow');
        setTasksDue([]);
        setTasksDueCount(0);
      }
    } catch (error) {
      console.error('Error fetching tasks due:', error);
    }
  };

  const fetchDocumentsPending = async () => {
    try {
      // Get today and tomorrow dates
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      // Format dates for comparison (YYYY-MM-DD)
      const todayStr = today.toISOString().split('T')[0];
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      // Fetch documents due today and tomorrow
      const { data: documentsDue, error } = await supabase
        .from('lead_required_documents')
        .select(`
          *,
          lead:leads(name, lead_number),
          contact:contacts(name, relationship)
        `)
        .in('status', ['pending', 'missing'])
        .or(`due_date.eq.${todayStr},due_date.eq.${tomorrowStr}`)
        .order('due_date', { ascending: true });

      if (error) throw error;
      
      // Set the count and store the documents for display
      setDocumentsPendingCount(documentsDue?.length || 0);
      setDocumentsDue(documentsDue || []);
    } catch (error) {
      console.error('Error fetching documents pending:', error);
    }
  };

  const fetchCaseStatistics = async () => {
    try {
      // Fetch cases in process (handler_assigned stage)
      const { count: inProcess, error: inProcessError } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('stage', 'handler_assigned')
        .not('handler', 'is', null)
        .not('handler', 'eq', '')
        .not('handler', 'eq', '---');

      if (inProcessError) throw inProcessError;

      // Fetch cases with applications sent (applications_sent stage)
      const { count: applicationsSent, error: applicationsSentError } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('stage', 'applications_sent')
        .not('handler', 'is', null)
        .not('handler', 'eq', '')
        .not('handler', 'eq', '---');

      if (applicationsSentError) throw applicationsSentError;

      // Fetch approved cases
      const { count: approved, error: approvedError } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('stage', 'approved')
        .not('handler', 'is', null)
        .not('handler', 'eq', '')
        .not('handler', 'eq', '---');

      if (approvedError) throw approvedError;

      // Fetch declined cases
      const { count: declined, error: declinedError } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('stage', 'declined')
        .not('handler', 'is', null)
        .not('handler', 'eq', '')
        .not('handler', 'eq', '---');

      if (declinedError) throw declinedError;

      setCaseStats({
        inProcess: inProcess || 0,
        applicationsSent: applicationsSent || 0,
        approved: approved || 0,
        declined: declined || 0
      });
    } catch (error) {
      console.error('Error fetching case statistics:', error);
    }
  };

  const fetchTotalBalance = async () => {
    try {
      // Get payment plans for all leads with handlers assigned
      const { data: leadsWithHandlers, error: leadsError } = await supabase
        .from('leads')
        .select('id, lead_number')
        .not('handler', 'is', null)
        .not('handler', 'eq', '')
        .not('handler', 'eq', '---');

      if (leadsError) throw leadsError;

      if (!leadsWithHandlers || leadsWithHandlers.length === 0) {
        setTotalBalance(0);
        return;
      }

      const leadIds = leadsWithHandlers.map(lead => lead.id);

      // Create date range for selected month and year
      const startDate = new Date(selectedYear, selectedMonth, 1).toISOString();
      const endDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999).toISOString();

      // Get payment plans for these leads with date filter
      const { data: paymentPlans, error: paymentError } = await supabase
        .from('payment_plans')
        .select('id, value, paid, lead_id, paid_at')
        .in('lead_id', leadIds)
        .eq('paid', true)
        .gte('paid_at', startDate)
        .lte('paid_at', endDate);

      if (paymentError) throw paymentError;

      // Calculate total value from paid payment plans for selected month
      const total = paymentPlans?.reduce((sum, plan) => {
        return sum + (plan.value || 0);
      }, 0) || 0;
      setTotalBalance(total);
    } catch (error) {
      console.error('Error fetching total balance:', error);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .not('handler', 'is', null)
        .not('handler', 'eq', '')
        .not('handler', 'eq', '---')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLeads(data || []);
    } catch (error) {
      console.error('Error fetching leads:', error);
      toast.error('Failed to fetch leads');
    } finally {
      setLoading(false);
    }
  };

  const uploadFiles = async (lead: HandlerLead, files: File[]) => {
    setUploadingLeadId(lead.id);
    setIsUploading(true);
    
    const newFiles: UploadedFile[] = files.map(file => ({
      name: file.name,
      status: 'uploading',
      progress: 0
    }));

    setUploadedFiles(prev => ({
      ...prev,
      [lead.id]: [...(prev[lead.id] || []), ...newFiles]
    }));

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = `${lead.id}/${Date.now()}_${file.name}`;
        
        const { error } = await supabase.storage
          .from('documents')
          .upload(fileName, file);

        if (error) throw error;

        // Update progress
        setUploadedFiles(prev => ({
          ...prev,
          [lead.id]: prev[lead.id].map((f, index) => 
            f.name === file.name 
              ? { ...f, status: 'success', progress: 100 }
              : f
          )
        }));
      }

      toast.success('Files uploaded successfully');
    } catch (error) {
      console.error('Error uploading files:', error);
      toast.error('Failed to upload files');
      
      // Update failed files
      setUploadedFiles(prev => ({
        ...prev,
        [lead.id]: prev[lead.id].map(f => ({
          ...f,
          status: 'error',
          error: 'Upload failed'
        }))
      }));
    } finally {
      setUploadingLeadId(null);
      setIsUploading(false);
    }
  };

  const handleFileInput = (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      uploadFiles(lead, files);
    }
  };

  const refreshLeads = async () => {
    await fetchLeads();
  };

  const refreshDashboardData = async () => {
    await fetchCaseStatistics();
    await fetchTotalBalance();
  };



  const handleCaseSelect = (lead: HandlerLead) => {
    // Immediately scroll to top before state changes
    window.scrollTo({ top: 0, behavior: 'auto' });
    
    setSelectedCase(lead);
    setActiveTab('cases'); // Start with cases tab
  };

  const handleBackToCases = () => {
    // Reset scroll position before state changes
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    
    setSelectedCase(null);
    setActiveTab('cases');
  };

  useEffect(() => {
    fetchLeads();
    fetchHandlerStageStats();
    fetchNewMessages();
    fetchTasksDue();
    fetchDocumentsPending();
    fetchCaseStatistics();
    fetchTotalBalance();
  }, []);

  // Scroll to top when component first mounts with a selected case
  useEffect(() => {
    if (selectedCase) {
      // Force scroll to top on mount and reset all scroll positions
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    }
  }, []);

  // Scroll to top when a case is selected or tab changes
  useLayoutEffect(() => {
    if (selectedCase) {
      // Force scroll to top immediately and reset scroll position
      window.scrollTo({ top: 0, behavior: 'auto' });
      
      // Also reset scroll position on the document body
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    }
  }, [selectedCase]);

  // Additional scroll effect for tab changes
  useEffect(() => {
    if (selectedCase) {
      // Comprehensive scroll reset after component has rendered
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
        
        // Also reset any scrollable containers
        const scrollableElements = document.querySelectorAll('.overflow-auto, .overflow-y-auto, .overflow-scroll');
        scrollableElements.forEach((element) => {
          if (element instanceof HTMLElement) {
            element.scrollTop = 0;
          }
        });
      }, 100);
    }
  }, [activeTab, selectedCase]);

  // Handle responsive case cards display
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768 && !showCaseCards) {
        setShowCaseCards(true);
      } else if (window.innerWidth < 768 && showCaseCards) {
        setShowCaseCards(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [showCaseCards]);

  useEffect(() => {
    fetchTotalBalance();
  }, [selectedMonth, selectedYear]);

  const renderTabContent = () => {
    const tabProps = {
      leads: selectedCase ? [selectedCase] : leads,
      uploadFiles,
      uploadingLeadId,
      uploadedFiles,
      isUploading,
      handleFileInput,
      refreshLeads,
      refreshDashboardData
    };

    switch (activeTab) {
      case 'cases':
        return <CasesTab {...tabProps} />;
      case 'contacts':
        return <ContactsTab {...tabProps} />;
      case 'documents':
        return <DocumentsTab {...tabProps} />;
      case 'tasks':
        return <TasksTab {...tabProps} />;
      case 'status':
        return <StatusTab {...tabProps} />;
      case 'notes':
        return <NotesTab {...tabProps} />;
      case 'communications':
        return <CommunicationsTab {...tabProps} />;
      case 'finance':
        return <FinanceTab {...tabProps} />;
      default:
        return <CasesTab {...tabProps} />;
    }
  };

  // If a case is selected, show single case view
  if (selectedCase) {
    return (
      <div ref={mainContainerRef} className="min-h-screen bg-white pt-8">
        <div className="container mx-auto px-4 py-8">
          {/* Header with back button */}
          <div className="mb-6 sm:mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-700 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-sm">
                      {selectedCase.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <div>
                      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">{selectedCase.name}</h1>
                      <p className="text-sm sm:text-lg text-gray-600">#{selectedCase.lead_number}</p>
                    </div>
                    {selectedCase.handler_stage && (
                      <span className="badge badge-primary badge-sm sm:badge-md lg:badge-lg mt-1">
                        {selectedCase.handler_stage.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={handleBackToCases}
                className="btn btn-outline btn-sm w-full sm:w-auto"
              >
                Back to Dashboard
              </button>
            </div>
            <p className="text-gray-600 text-sm sm:text-base">Case details and management</p>
          </div>

          {/* Tab Navigation - Styled like Clients page */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="w-full">
              {/* Desktop version */}
              <div className="hidden md:flex items-center px-4 py-4">
                <div className="flex bg-gray-50 dark:bg-gray-700 p-1 gap-1 overflow-hidden w-full rounded-lg">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      className={`relative flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-300 hover:scale-[1.02] flex-1 ${
                        activeTab === tab.id
                          ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg transform scale-[1.02]'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:bg-gray-600'
                      }`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'text-white' : 'text-gray-500'}`} />
                      <span className={`whitespace-nowrap font-bold ${activeTab === tab.id ? 'text-white' : 'text-gray-600'}`}>{tab.label}</span>
                      {activeTab === tab.id && (
                        <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white dark:bg-gray-800 rounded-full shadow-lg"></div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              {/* Mobile version: modern card-based design */}
              <div className="md:hidden px-6 py-4">
                <div className="overflow-x-auto scrollbar-hide bg-gray-50 dark:bg-gray-700 rounded-xl p-3 w-full">
                  <div className="flex gap-2 pb-1">
                    {tabs.map((tab) => {
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 min-w-[80px] ${
                            isActive
                              ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-lg transform scale-105'
                              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:bg-gray-600'
                          }`}
                          onClick={() => setActiveTab(tab.id)}
                        >
                          <div className="relative">
                            <tab.icon className={`w-6 h-6 mb-1 ${isActive ? 'text-white' : 'text-gray-500'}`} />
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

          {/* Tab Content */}
          <div className="w-full bg-white dark:bg-gray-900 min-h-screen">
            <div className="p-2 sm:p-4 md:p-6 pb-6 md:pb-6 mb-4 md:mb-0">
              {renderTabContent()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main dashboard view
  return (
    <div ref={mainContainerRef} className="min-h-screen bg-white pt-8">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Case Manager - German & Austrian Departement</h1>
          <p className="text-gray-600">Manage your cases, tasks, and client communications</p>
        </div>

        {/* Dashboard Boxes - Using correct colors from Dashboard.tsx */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-8 w-full mt-6 md:mt-0">
          {/* Handler Cases Box */}
          <div 
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden p-3 md:p-6"
            onClick={() => {
              setExpanded(expanded === 'cases' ? null : 'cases');
              setShowCaseCards(!showCaseCards);
            }}
          >
            <div className="flex items-center gap-2 md:gap-4">
              <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
                <FolderIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
              </div>
              <div>
                <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{handlerCasesCount}</div>
                <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Handler Cases</div>
              </div>
            </div>
            {/* SVG Graph Placeholder */}
            <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-16 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
          </div>

          {/* New Messages Box */}
          <div 
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden p-3 md:p-6"
            onClick={() => setExpanded(expanded === 'messages' ? null : 'messages')}
          >
            <div className="flex items-center gap-2 md:gap-4">
              <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
                <ChatBubbleLeftRightIcon className="w-5 h-5 md:w-7 md:h-7 mr-1 text-white" />
              </div>
              <div>
                <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{newMessagesCount}</div>
                <div className="text-white/80 text-xs md:text-sm font-medium mt-1">New Messages</div>
              </div>
            </div>
            {/* SVG Circle Placeholder */}
            <svg className="absolute bottom-2 right-2 w-10 h-10 md:w-10 md:h-10 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" /><text x="16" y="21" textAnchor="middle" fontSize="10" fill="white" opacity="0.7">99+</text></svg>
          </div>

          {/* Tasks Due Box */}
          <div 
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden p-3 md:p-6"
            onClick={() => {
              console.log('Tasks due box clicked');
              setExpanded(expanded === 'tasks' ? null : 'tasks');
            }}
          >
            <div className="flex items-center gap-2 md:gap-4">
              <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
                <ClockIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
              </div>
              <div>
                <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{tasksDueCount}</div>
                <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Tasks Due</div>
              </div>
            </div>
            {/* SVG Bar Chart Placeholder */}
            <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-12 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
          </div>

          {/* Documents Pending Box */}
          <div 
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white relative overflow-hidden p-3 md:p-6"
            onClick={() => setExpanded(expanded === 'documents' ? null : 'documents')}
          >
            <div className="flex items-center gap-2 md:gap-4">
              <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
                <DocumentTextIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
              </div>
              <div>
                <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{documentsPendingCount}</div>
                <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Documents Pending</div>
              </div>
            </div>
            {/* SVG Line Chart Placeholder */}
            <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-16 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
          </div>
        </div>

        {/* Additional Statistics Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Case Statistics Box */}
          <div className="card bg-base-100 shadow-xl border border-base-300">
            <div className="card-body p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="avatar placeholder">
                  <div className="bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white rounded-full w-12 h-12 shadow-lg">
                    <ChartBarIcon className="w-6 h-6" />
                  </div>
                </div>
                <div>
                  <h3 className="card-title text-xl">Case Statistics</h3>
                  <p className="text-base-content/60 text-sm">Overview of case stages</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
                <div className="card bg-white shadow-lg hover:shadow-xl transition-shadow duration-300 rounded-xl p-4">
                  <div className="card-body p-0 text-center">
                    <div className="stat-title text-sm font-semibold mb-3">In Process</div>
                    <div className="stat-value text-3xl font-bold" style={{ background: 'linear-gradient(to top right, #EC4899, #A855F7, #9333EA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{caseStats.inProcess}</div>
                  </div>
                </div>
                
                <div className="card bg-white shadow-lg hover:shadow-xl transition-shadow duration-300 rounded-xl p-4">
                  <div className="card-body p-0 text-center">
                    <div className="stat-title text-sm font-semibold mb-3">Applications Sent</div>
                    <div className="stat-value text-3xl font-bold" style={{ background: 'linear-gradient(to top right, #EC4899, #A855F7, #9333EA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{caseStats.applicationsSent}</div>
                  </div>
                </div>
                
                <div className="card bg-white shadow-lg hover:shadow-xl transition-shadow duration-300 rounded-xl p-4">
                  <div className="card-body p-0 text-center">
                    <div className="stat-title text-sm font-semibold mb-3">Approved</div>
                    <div className="stat-value text-3xl font-bold" style={{ background: 'linear-gradient(to top right, #EC4899, #A855F7, #9333EA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{caseStats.approved}</div>
                  </div>
                </div>
                
                <div className="card bg-white shadow-lg hover:shadow-xl transition-shadow duration-300 rounded-xl p-4">
                  <div className="card-body p-0 text-center">
                    <div className="stat-title text-sm font-semibold mb-3">Declined</div>
                    <div className="stat-value text-3xl font-bold" style={{ background: 'linear-gradient(to top right, #EC4899, #A855F7, #9333EA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{caseStats.declined}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Total Balance Box */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-tr from-green-500 via-emerald-500 to-teal-600 shadow">
                  <CurrencyDollarIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">My Achievements</h3>
                  <p className="text-sm text-gray-600">Invoiced amount for the month</p>
                </div>
              </div>
                              {/* Month/Year Filter */}
                                        <div className="flex gap-2">
                          <select
                            className="select select-sm select-bordered"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                          >
                            <option value={0}>January</option>
                            <option value={1}>February</option>
                            <option value={2}>March</option>
                            <option value={3}>April</option>
                            <option value={4}>May</option>
                            <option value={5}>June</option>
                            <option value={6}>July</option>
                            <option value={7}>August</option>
                            <option value={8}>September</option>
                            <option value={9}>October</option>
                            <option value={10}>November</option>
                            <option value={11}>December</option>
                          </select>
                          <select
                            className="select select-sm select-bordered"
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                          >
                            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(year => (
                              <option key={year} value={year}>{year}</option>
                            ))}
                          </select>
                        </div>
            </div>
                                  <div className="text-center">
                        <div className="text-3xl font-bold text-gray-900 mb-2">
                          ₪{totalBalance.toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-600 mb-4">
                          Total Achieved Amount - {new Date(selectedYear, selectedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                        </div>
                        <div className="border-t border-gray-200 pt-4">
                          <div className="text-lg font-semibold text-gray-700 mb-1">
                            Applications Sent This Month
                          </div>
                          <div className="text-2xl font-bold text-purple-600">
                            0
                          </div>
                        </div>
                      </div>
          </div>
        </div>

        {/* Tasks Section - Show directly under dashboard boxes when tasks box is clicked */}
        {expanded === 'tasks' && (
          <div className="mb-6">
            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Tasks Due Today & Tomorrow</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tasksDue.length === 0 ? (
                  <div className="col-span-full text-center py-12 text-gray-500">
                    <ClockIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium mb-1">No tasks due today or tomorrow</p>
                    <p className="text-base">All caught up!</p>
                  </div>
                ) : (
                  tasksDue.map((task) => (
                    <div 
                      key={task.id} 
                      className="bg-white rounded-xl shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 group cursor-pointer"
                      onClick={() => {
                        // Find the lead for this task
                        const lead = leads.find(l => l.id === task.lead_id);
                        if (lead) {
                          // Set the selected lead and switch to Tasks tab
                          setSelectedCase(lead);
                          setActiveTab('tasks');
                        }
                      }}
                    >
                      <div className="card-body p-5">
                        {/* Top Row: Status, Priority, and Lead Info */}
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex gap-6">
                            <span className={`badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none`}>
                              {task.status.replace('_', ' ')}
                            </span>
                            <span className="badge bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white border-none">
                              {task.priority}
                            </span>
                          </div>
                          {task.lead && (
                            <div className="text-sm text-base-content/60 font-mono text-right">
                              {task.lead.name}  #{task.lead.lead_number}
                            </div>
                          )}
                        </div>

                        {/* Title and Due Date Row */}
                        <div className="flex justify-between items-start mb-3">
                          <h2 className="card-title text-xl font-bold group-hover:text-purple-600 transition-colors">
                            {task.title}
                          </h2>
                          {task.due_date && (
                            <div className="text-right">
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">Due Date</span>
                              <p className="text-sm font-medium">{task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}</p>
                            </div>
                          )}
                        </div>

                        {/* Description in Gray Box */}
                        {task.description && (
                          <div className="bg-gray-100 rounded-lg p-3 mb-4">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Description</span>
                            <p className="text-sm text-gray-700 line-clamp-3">{task.description}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Documents Section - Show directly under dashboard boxes when documents box is clicked */}
        {expanded === 'documents' && (
          <div className="mb-6">
            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Documents Due Today & Tomorrow</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {documentsDue.length === 0 ? (
                  <div className="col-span-full text-center py-12 text-gray-500">
                    <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium mb-1">No documents due today or tomorrow</p>
                    <p className="text-base">All documents are up to date!</p>
                  </div>
                ) : (
                  documentsDue.map((document) => (
                    <div 
                      key={document.id} 
                      className="bg-white rounded-xl shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 group cursor-pointer"
                      onClick={() => {
                        // Find the lead for this document
                        const lead = leads.find(l => l.id === document.lead_id);
                        if (lead) {
                          // Set the selected lead and switch to Documents tab
                          setSelectedCase(lead);
                          setActiveTab('documents');
                        }
                      }}
                    >
                      <div className="card-body p-5">
                        {/* Top Row: Status and Lead Info */}
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex gap-2">
                            <span className={`badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none`}>
                              {document.status}
                            </span>
                            {document.due_date && (
                                                          <span className="badge bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white border-none">
                              Due: {new Date(document.due_date).toLocaleDateString()}
                            </span>
                            )}
                          </div>
                          {document.lead && (
                            <div className="text-sm text-base-content/60 font-mono text-right">
                              {document.lead.name} #{document.lead.lead_number}
                            </div>
                          )}
                        </div>

                        {/* Document Name and Type */}
                        <div className="mb-3">
                          {/* Separation line before title */}
                          <div className="border-b border-gray-200 mb-3"></div>
                          
                          <h2 className="card-title text-xl font-bold group-hover:text-purple-600 transition-colors">
                            {document.document_name}
                          </h2>
                          <p className="text-sm text-gray-600 mt-1">
                            Type: {document.document_type}
                          </p>
                          
                          {/* Requested From Information */}
                          {document.requested_from && (
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Requested From</span>
                              <span className="text-sm font-medium">{document.requested_from}</span>
                            </div>
                          )}
                          
                          {/* Requested By Information */}
                          {document.requested_from_changed_by && (
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">By</span>
                              <span className="text-sm font-medium">{document.requested_from_changed_by}</span>
                            </div>
                          )}
                          
                          {/* Requested Date Information */}
                          {document.requested_from_changed_at && (
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</span>
                              <span className="text-sm font-medium">{new Date(document.requested_from_changed_at).toLocaleDateString()}</span>
                            </div>
                          )}
                          
                          {/* Separation line after type */}
                          <div className="border-b border-gray-200 mt-3"></div>
                        </div>

                        {/* Contact and Notes */}
                        <div className="space-y-2">
                          {document.contact && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</span>
                                <span className="text-sm font-medium">{document.contact.name}</span>
                              </div>

                              {document.contact.relationship && (
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Relationship</span>
                                  <span className="text-sm font-medium">{document.contact.relationship}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {document.notes && (
                            <div className="bg-gray-100 rounded-lg p-3">
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Notes</span>
                              <p className="text-sm text-gray-700">{document.notes}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Case Cards - Show when cases box is clicked */}
        {showCaseCards && (
          <div className="mb-6">
            <DashboardTab 
              leads={leads}
              uploadFiles={uploadFiles}
              uploadingLeadId={uploadingLeadId}
              uploadedFiles={uploadedFiles}
              isUploading={isUploading}
              handleFileInput={handleFileInput}
              refreshLeads={refreshLeads}
              onCaseSelect={handleCaseSelect}
              showCaseCards={showCaseCards}
              setShowCaseCards={setShowCaseCards}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CaseManagerPageNew; 