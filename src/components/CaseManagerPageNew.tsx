import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Squares2X2Icon,
  ListBulletIcon,
  DocumentTextIcon,
  ClockIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  FolderIcon,
  CurrencyDollarIcon,
  EnvelopeIcon,
  CalendarIcon,
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { convertToNIS } from '../lib/currencyConversion';

// Import tab components
import DashboardTab from './case-manager/DashboardTab';

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
  lead_type?: 'new' | 'legacy';
}

interface UploadedFile {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}


const CaseManagerPageNew: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [leads, setLeads] = useState<HandlerLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingLeadId, setUploadingLeadId] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{ [leadId: string]: UploadedFile[] }>({});
  const [isUploading, setIsUploading] = useState(false);
  const mainContainerRef = useRef<HTMLDivElement>(null);

  // Get handler ID from URL params (if filtering by specific handler)
  const handlerIdFromUrl = searchParams.get('handlerId');
  const [filterHandlerId, setFilterHandlerId] = useState<number | null>(
    handlerIdFromUrl ? parseInt(handlerIdFromUrl, 10) : null
  );
  const [filterHandlerName, setFilterHandlerName] = useState<string | null>(null);

  // Update filterHandlerId when URL changes
  useEffect(() => {
    const handlerId = searchParams.get('handlerId');
    if (handlerId) {
      const parsedId = parseInt(handlerId, 10);
      if (!isNaN(parsedId)) {
        setFilterHandlerId(parsedId);
      }
    } else {
      setFilterHandlerId(null);
    }
  }, [searchParams]);

  // User authentication state
  const [currentUserFullName, setCurrentUserFullName] = useState<string>('');
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState<number | null>(null);

  // Data for resolving IDs to names
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);

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
  const [applicationsSentThisMonth, setApplicationsSentThisMonth] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // Single case view state

  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = (employeeId: string | number | null | undefined) => {
    if (!employeeId) return 'Unknown';
    // Convert both to string for comparison since employeeId might be bigint
    const employee = allEmployees.find((emp: any) => emp.id.toString() === employeeId.toString());
    return employee ? employee.display_name : 'Unknown';
  };

  // Helper function to get category name from ID or name with main category
  const getCategoryDisplayName = (categoryId: string | number | null | undefined, fallbackCategory?: string | number) => {
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      // If no category_id but we have a fallback category, try to find it in the loaded categories
      if (fallbackCategory && String(fallbackCategory).trim() !== '') {
        // Try to find the fallback category in the loaded categories
        let foundCategory = null;
        if (typeof fallbackCategory === 'number') {
          foundCategory = allCategories.find((cat: any) =>
            cat.id.toString() === fallbackCategory.toString()
          );
        }

        if (!foundCategory) {
          foundCategory = allCategories.find((cat: any) =>
            cat.name.toLowerCase().trim() === String(fallbackCategory).toLowerCase().trim()
          );
        }

        if (foundCategory) {
          // Return category name with main category in parentheses
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name;
          }
        } else {
          return String(fallbackCategory);
        }
      }
      return 'Not specified';
    }

    // If allCategories is not loaded yet, return the original value
    if (!allCategories || allCategories.length === 0) {
      return String(categoryId);
    }

    // First try to find by ID
    const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (categoryById) {
      // Return category name with main category in parentheses
      if (categoryById.misc_maincategory?.name) {
        return `${categoryById.name} (${categoryById.misc_maincategory.name})`;
      } else {
        return categoryById.name;
      }
    }

    // If not found by ID, try to find by name (in case it's already a name)
    const categoryByName = allCategories.find((cat: any) => cat.name === categoryId);
    if (categoryByName) {
      // Return category name with main category in parentheses
      if (categoryByName.misc_maincategory?.name) {
        return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
      } else {
        return categoryByName.name;
      }
    }

    return String(categoryId);
  };

  // Helper function to get stage name from stage ID or name
  const getStageDisplayName = (stage: string | number | null | undefined) => {
    if (!stage || (typeof stage === 'string' && !stage.trim())) {
      return 'No Stage';
    }

    const stageStr = String(stage);

    // If it's already text (not a numeric ID), return as-is with proper formatting
    if (typeof stage === 'string' && !stage.match(/^\d+$/)) {
      return stageStr.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    }

    // For numeric IDs, use comprehensive mapping (same as Calendar page)
    const stageMapping: { [key: string]: string } = {
      '0': 'Created',
      '10': 'Scheduler Assigned',
      '11': 'Handler Started',
      '15': 'Success',
      '20': 'Meeting Scheduled',
      '35': 'Meeting Irrelevant',
      '50': 'Meeting Scheduled',
      '51': 'Client Declined Price Offer',
      '60': 'Handler Assigned',
      '91': 'Dropped (Spam/Irrelevant)',
      '105': 'Success',
      '110': 'Handler Assigned',
      '200': 'Meeting Scheduled',
      'meeting_scheduled': 'Meeting Scheduled',
      'scheduler_assigned': 'Scheduler Assigned',
      'handler_started': 'Handler Started',
      'handler_assigned': 'Handler Assigned',
      'success': 'Success',
      'created': 'Created'
    };

    const stageName = stageMapping[stageStr] || stageStr;

    return stageName;
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

  // Fetch reference data (employees and categories)
  const fetchReferenceData = async () => {
    try {
      // Fetch all employees
      const { data: employeesData, error: employeesError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, official_name')
        .order('display_name');

      if (employeesError) {
        console.error('Error fetching employees:', employeesError);
      } else {
        setAllEmployees(employeesData || []);
      }

      // Fetch all categories with their parent main category names using JOINs
      const { data: categoriesData, error: categoriesError } = await supabase
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

      if (categoriesError) {
        console.error('Error fetching categories:', categoriesError);
      } else {
        setAllCategories(categoriesData || []);
      }
    } catch (error) {
      console.error('Error fetching reference data:', error);
    }
  };

  const fetchHandlerStageStats = async () => {
    try {
      // Count new leads with handler assigned (excluding inactive leads)
      let newLeadsQuery = supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .not('handler', 'is', null)
        .not('handler', 'eq', '')
        .not('handler', 'eq', '---')
        .is('unactivated_at', null); // Only active leads (exclude inactive)

      if (currentUserFullName) {
        newLeadsQuery = newLeadsQuery.eq('handler', currentUserFullName);
      }

      // Also filter by case_handler_id if we have handler ID
      if (currentUserEmployeeId) {
        newLeadsQuery = newLeadsQuery.eq('case_handler_id', currentUserEmployeeId);
      }

      const { count: newLeadsCount, error: newLeadsError } = await newLeadsQuery;

      if (newLeadsError) throw newLeadsError;

      // Count legacy leads with handler assigned (excluding inactive leads)
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select('*', { count: 'exact', head: true })
        .not('case_handler_id', 'is', null)
        .or('status.eq.0,status.is.null'); // Only active leads (status 0 or null = active, status 10 = inactive)

      if (currentUserEmployeeId) {
        legacyLeadsQuery = legacyLeadsQuery.eq('case_handler_id', currentUserEmployeeId);
      }

      const { count: legacyLeadsCount, error: legacyLeadsError } = await legacyLeadsQuery;

      if (legacyLeadsError) throw legacyLeadsError;

      setHandlerCasesCount((newLeadsCount || 0) + (legacyLeadsCount || 0));
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
    console.log('⏰ fetchTasksDue: ===== START =====');
    try {
      // Get today and tomorrow dates
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Format dates for comparison (YYYY-MM-DD)
      const todayStr = today.toISOString().split('T')[0];
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      console.log('⏰ fetchTasksDue: Date calculations', {
        today: today.toISOString(),
        tomorrow: tomorrow.toISOString(),
        todayStr,
        tomorrowStr
      });

      // Fetch all tasks with due_date (regardless of status) and filter in JavaScript
      // This approach handles both new and legacy leads
      console.log('⏰ fetchTasksDue: Fetching all tasks with due_date...');
      const { data: allTasksWithDueDate, error: fetchError } = await supabase
        .from('handler_tasks')
        .select('*')
        .not('due_date', 'is', null)
        .neq('status', 'completed')
        .order('priority', { ascending: false });

      console.log('⏰ fetchTasksDue: Fetched all tasks with due_date', {
        count: allTasksWithDueDate?.length || 0,
        error: fetchError
      });

      if (fetchError) {
        console.error('⏰ fetchTasksDue: Error fetching tasks:', fetchError);
        throw fetchError;
      }

      // Filter in JavaScript to match due date (today or tomorrow)
      console.log('⏰ fetchTasksDue: Filtering tasks by date', {
        totalTasks: allTasksWithDueDate?.length || 0,
        todayStr,
        tomorrowStr
      });

      const tasksDue = (allTasksWithDueDate || []).filter(task => {
        if (!task.due_date) return false;
        try {
          const taskDate = new Date(task.due_date);
          const taskDateStr = taskDate.toISOString().split('T')[0];
          const matches = taskDateStr === todayStr || taskDateStr === tomorrowStr;
          return matches;
        } catch (e) {
          console.warn('⏰ fetchTasksDue: Error parsing date', {
            taskId: task.id,
            due_date: task.due_date,
            error: e
          });
          return false;
        }
      });

      console.log('⏰ fetchTasksDue: Filter results', {
        totalFetched: allTasksWithDueDate?.length || 0,
        afterDateFilter: tasksDue.length,
        tasksDue: tasksDue.map(t => ({
          id: t.id,
          title: t.title,
          due_date: t.due_date,
          lead_id: t.lead_id,
          legacy_lead_id: t.legacy_lead_id,
          status: t.status
        }))
      });

      // Enrich tasks with lead information
      console.log('⏰ fetchTasksDue: Starting enrichment process...');
      const enrichedTasks = await Promise.all(
        (tasksDue || []).map(async (task, index) => {
          console.log(`⏰ fetchTasksDue: Enriching task ${index + 1}/${tasksDue.length}`, {
            taskId: task.id,
            title: task.title,
            lead_id: task.lead_id,
            legacy_lead_id: task.legacy_lead_id
          });

          let leadInfo = null;

          // For new leads
          if (task.lead_id) {
            console.log(`⏰ fetchTasksDue: Fetching new lead info for lead_id: ${task.lead_id}`);
            const { data: leadData, error: leadError } = await supabase
              .from('leads')
              .select('name, lead_number')
              .eq('id', task.lead_id)
              .single();

            console.log(`⏰ fetchTasksDue: New lead fetch result`, {
              lead_id: task.lead_id,
              leadData,
              error: leadError
            });

            if (leadData) {
              leadInfo = leadData;
            }
          }
          // For legacy leads
          else if (task.legacy_lead_id) {
            console.log(`⏰ fetchTasksDue: Fetching legacy lead info for legacy_lead_id: ${task.legacy_lead_id}`);
            const { data: leadData, error: leadError } = await supabase
              .from('leads_lead')
              .select('id, name')
              .eq('id', task.legacy_lead_id)
              .single();

            console.log(`⏰ fetchTasksDue: Legacy lead fetch result`, {
              legacy_lead_id: task.legacy_lead_id,
              leadData,
              error: leadError
            });

            if (leadData) {
              leadInfo = {
                name: leadData.name || 'Unknown',
                lead_number: String(leadData.id)
              };
            }
          } else {
            console.log(`⏰ fetchTasksDue: Task has neither lead_id nor legacy_lead_id`, {
              taskId: task.id,
              title: task.title
            });
          }

          return {
            ...task,
            lead: leadInfo
          };
        })
      );

      console.log('⏰ fetchTasksDue: Enrichment complete', {
        count: enrichedTasks.length,
        enrichedTasks: enrichedTasks,
        sample: enrichedTasks.slice(0, 3).map(t => ({
          id: t.id,
          title: t.title,
          due_date: t.due_date,
          lead: t.lead
        }))
      });

      // Set the count and store the tasks for display
      console.log('⏰ fetchTasksDue: Setting state', {
        count: enrichedTasks.length,
        tasksCount: enrichedTasks.length
      });

      setTasksDueCount(enrichedTasks.length);
      setTasksDue(enrichedTasks);

      console.log('⏰ fetchTasksDue: State updated', {
        tasksDueCount: enrichedTasks.length,
        tasksDueLength: enrichedTasks.length
      });

      console.log('⏰ fetchTasksDue: ===== END (SUCCESS) =====');
    } catch (error) {
      console.error('⏰ fetchTasksDue: ===== ERROR =====', error);
      console.error('⏰ fetchTasksDue: Error details', {
        error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      setTasksDue([]);
      setTasksDueCount(0);
    }
  };

  const fetchDocumentsPending = async () => {
    console.log('📄 fetchDocumentsPending: ===== START =====');
    try {
      // Get today and tomorrow dates
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Format dates for comparison (YYYY-MM-DD)
      const todayStr = today.toISOString().split('T')[0];
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      console.log('📄 fetchDocumentsPending: Date calculations', {
        today: today.toISOString(),
        tomorrow: tomorrow.toISOString(),
        todayStr,
        tomorrowStr
      });

      // Fetch all documents with due_date (regardless of status) and filter in JavaScript
      // We'll filter by status AND date in JavaScript to catch all relevant documents
      // This is more reliable than the .or() filter which might have issues with date formats
      console.log('📄 fetchDocumentsPending: Fetching all documents with due_date...');
      const { data: allDocumentsWithDueDate, error: fetchError } = await supabase
        .from('lead_required_documents')
        .select(`
          *,
          contact:contacts(name, relationship)
        `)
        .not('due_date', 'is', null)
        .order('due_date', { ascending: true });

      console.log('📄 fetchDocumentsPending: Fetched all documents with due_date', {
        count: allDocumentsWithDueDate?.length || 0,
        error: fetchError
      });

      if (fetchError) {
        console.error('📄 fetchDocumentsPending: Error fetching documents:', fetchError);
        throw fetchError;
      }

      // Filter in JavaScript to match:
      // 1. Status must be 'pending' or 'missing' (exclude 'received')
      // 2. Due date must be today or tomorrow
      console.log('📄 fetchDocumentsPending: Filtering documents by status and date', {
        totalDocuments: allDocumentsWithDueDate?.length || 0,
        todayStr,
        tomorrowStr
      });

      const documentsDue = (allDocumentsWithDueDate || []).filter(doc => {
        // First check status - must be 'pending' or 'missing' (exclude 'received')
        const hasValidStatus = doc.status && (doc.status === 'pending' || doc.status === 'missing');

        if (!hasValidStatus) {
          // Log documents that are filtered out due to status
          if (doc.due_date) {
            try {
              const docDate = new Date(doc.due_date);
              const docDateStr = docDate.toISOString().split('T')[0];
              const isDueTodayOrTomorrow = docDateStr === todayStr || docDateStr === tomorrowStr;
              if (isDueTodayOrTomorrow) {
                console.log('📄 fetchDocumentsPending: Document excluded due to status (but due today/tomorrow)', {
                  docId: doc.id,
                  document_name: doc.document_name,
                  due_date: doc.due_date,
                  status: doc.status,
                  docDateStr,
                  todayStr,
                  tomorrowStr
                });
              }
            } catch (e) {
              // Ignore date parsing errors for logging
            }
          }
          return false;
        }

        // Then check due date
        if (!doc.due_date) return false;
        try {
          const docDate = new Date(doc.due_date);
          const docDateStr = docDate.toISOString().split('T')[0];
          const matches = docDateStr === todayStr || docDateStr === tomorrowStr;
          if (matches) {
            console.log('📄 fetchDocumentsPending: ✅ Document matches all filters', {
              docId: doc.id,
              document_name: doc.document_name,
              due_date: doc.due_date,
              status: doc.status,
              docDateStr,
              todayStr,
              tomorrowStr
            });
          } else {
            console.log('📄 fetchDocumentsPending: Document has valid status but wrong date', {
              docId: doc.id,
              document_name: doc.document_name,
              due_date: doc.due_date,
              status: doc.status,
              docDateStr,
              todayStr,
              tomorrowStr
            });
          }
          return matches;
        } catch (e) {
          console.warn('📄 fetchDocumentsPending: Error parsing date', {
            docId: doc.id,
            due_date: doc.due_date,
            error: e
          });
          return false;
        }
      });

      console.log('📄 fetchDocumentsPending: Filter results', {
        totalFetched: allDocumentsWithDueDate?.length || 0,
        afterStatusFilter: (allDocumentsWithDueDate || []).filter(d => d.status && (d.status === 'pending' || d.status === 'missing')).length,
        afterDateFilter: documentsDue.length,
        documentsDue: documentsDue.map(d => ({
          id: d.id,
          document_name: d.document_name,
          due_date: d.due_date,
          status: d.status
        }))
      });

      const error = null; // No error if we got here

      console.log('📄 fetchDocumentsPending: Query executed', {
        hasError: !!error,
        error: error ? {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        } : null,
        dataLength: documentsDue?.length || 0,
        rawData: documentsDue
      });

      if (error) {
        console.error('📄 fetchDocumentsPending: Error fetching documents:', error);
        throw error;
      }

      console.log('📄 fetchDocumentsPending: Fetched documents (raw)', {
        count: documentsDue?.length || 0,
        allDocuments: documentsDue,
        sample: documentsDue?.slice(0, 5).map(d => ({
          id: d.id,
          document_name: d.document_name,
          due_date: d.due_date,
          lead_id: d.lead_id,
          legacy_lead_id: d.legacy_lead_id,
          status: d.status,
          contact: d.contact
        }))
      });

      if (!documentsDue || documentsDue.length === 0) {
        console.log('📄 fetchDocumentsPending: No documents found - checking if query is correct');
        // Let's also check what documents exist in the table
        const { data: allDocs, error: allDocsError } = await supabase
          .from('lead_required_documents')
          .select('id, document_name, due_date, status, lead_id, legacy_lead_id')
          .limit(20);

        console.log('📄 fetchDocumentsPending: Sample of all documents in table', {
          count: allDocs?.length || 0,
          sample: allDocs,
          error: allDocsError
        });

        // Check documents with pending/missing status
        const { data: pendingDocs, error: pendingError } = await supabase
          .from('lead_required_documents')
          .select('id, document_name, due_date, status, lead_id, legacy_lead_id')
          .in('status', ['pending', 'missing'])
          .limit(20);

        console.log('📄 fetchDocumentsPending: Documents with pending/missing status', {
          count: pendingDocs?.length || 0,
          sample: pendingDocs,
          error: pendingError
        });

        // Check documents with due_date set
        const { data: docsWithDueDate, error: dueDateError } = await supabase
          .from('lead_required_documents')
          .select('id, document_name, due_date, status, lead_id, legacy_lead_id')
          .not('due_date', 'is', null)
          .limit(20);

        console.log('📄 fetchDocumentsPending: Documents with due_date set', {
          count: docsWithDueDate?.length || 0,
          sample: docsWithDueDate,
          error: dueDateError,
          dueDates: docsWithDueDate?.map(d => ({
            id: d.id,
            document_name: d.document_name,
            due_date: d.due_date,
            due_date_type: typeof d.due_date,
            due_date_length: d.due_date ? String(d.due_date).length : 0
          }))
        });

        // Try a different query approach - get all pending/missing and filter in JS
        const { data: allPendingMissing, error: allPendingError } = await supabase
          .from('lead_required_documents')
          .select('id, document_name, due_date, status, lead_id, legacy_lead_id, contact:contacts(name, relationship)')
          .in('status', ['pending', 'missing'])
          .not('due_date', 'is', null);

        if (allPendingMissing && allPendingMissing.length > 0) {
          console.log('📄 fetchDocumentsPending: All pending/missing documents with due_date', {
            count: allPendingMissing.length,
            allDocs: allPendingMissing.map(d => ({
              id: d.id,
              document_name: d.document_name,
              due_date: d.due_date,
              due_date_parsed: d.due_date ? new Date(d.due_date).toISOString().split('T')[0] : null,
              status: d.status
            }))
          });

          // Filter in JavaScript to see if date matching is the issue
          const filteredDocs = allPendingMissing.filter(doc => {
            if (!doc.due_date) return false;
            const docDate = new Date(doc.due_date);
            const docDateStr = docDate.toISOString().split('T')[0];
            const matches = docDateStr === todayStr || docDateStr === tomorrowStr;
            console.log('📄 fetchDocumentsPending: Checking document date', {
              docId: doc.id,
              document_name: doc.document_name,
              due_date: doc.due_date,
              docDateStr,
              todayStr,
              tomorrowStr,
              matches
            });
            return matches;
          });

          console.log('📄 fetchDocumentsPending: Filtered documents (JS filter)', {
            count: filteredDocs.length,
            filteredDocs: filteredDocs
          });
        }
      }

      // Enrich documents with lead information
      console.log('📄 fetchDocumentsPending: Starting enrichment process...');
      const enrichedDocuments = await Promise.all(
        (documentsDue || []).map(async (doc, index) => {
          console.log(`📄 fetchDocumentsPending: Enriching document ${index + 1}/${documentsDue.length}`, {
            docId: doc.id,
            document_name: doc.document_name,
            lead_id: doc.lead_id,
            legacy_lead_id: doc.legacy_lead_id
          });

          let leadInfo = null;

          // For new leads
          if (doc.lead_id) {
            console.log(`📄 fetchDocumentsPending: Fetching new lead info for lead_id: ${doc.lead_id}`);
            const { data: leadData, error: leadError } = await supabase
              .from('leads')
              .select('name, lead_number')
              .eq('id', doc.lead_id)
              .single();

            console.log(`📄 fetchDocumentsPending: New lead fetch result`, {
              lead_id: doc.lead_id,
              leadData,
              error: leadError
            });

            if (leadData) {
              leadInfo = leadData;
            }
          }
          // For legacy leads
          else if (doc.legacy_lead_id) {
            console.log(`📄 fetchDocumentsPending: Fetching legacy lead info for legacy_lead_id: ${doc.legacy_lead_id}`);
            const { data: leadData, error: leadError } = await supabase
              .from('leads_lead')
              .select('name, lead_number')
              .eq('id', doc.legacy_lead_id)
              .single();

            console.log(`📄 fetchDocumentsPending: Legacy lead fetch result`, {
              legacy_lead_id: doc.legacy_lead_id,
              leadData,
              error: leadError
            });

            if (leadData) {
              leadInfo = leadData;
            }
          } else {
            console.log(`📄 fetchDocumentsPending: Document has neither lead_id nor legacy_lead_id`, {
              docId: doc.id,
              document_name: doc.document_name
            });
          }

          return {
            ...doc,
            lead: leadInfo
          };
        })
      );

      console.log('📄 fetchDocumentsPending: Enrichment complete', {
        count: enrichedDocuments.length,
        enrichedDocuments: enrichedDocuments,
        sample: enrichedDocuments.slice(0, 3).map(d => ({
          id: d.id,
          document_name: d.document_name,
          due_date: d.due_date,
          lead: d.lead
        }))
      });

      // Set the count and store the documents for display
      console.log('📄 fetchDocumentsPending: Setting state', {
        count: enrichedDocuments.length,
        documentsCount: enrichedDocuments.length
      });

      setDocumentsPendingCount(enrichedDocuments.length);
      setDocumentsDue(enrichedDocuments);

      console.log('📄 fetchDocumentsPending: State updated', {
        documentsPendingCount: enrichedDocuments.length,
        documentsDueLength: enrichedDocuments.length
      });

      console.log('📄 fetchDocumentsPending: ===== END (SUCCESS) =====');
    } catch (error) {
      console.error('📄 fetchDocumentsPending: ===== ERROR =====', error);
      console.error('📄 fetchDocumentsPending: Error details', {
        error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      // Set to 0 on error to avoid showing incorrect counts
      setDocumentsPendingCount(0);
      setDocumentsDue([]);
      console.log('📄 fetchDocumentsPending: State reset to 0 due to error');
    }
  };

  const fetchCaseStatistics = async () => {
    try {
      // Helper function to get stage ID from stage
      const getStageId = (stage: string | number | null | undefined): number | null => {
        if (!stage) return null;
        if (typeof stage === 'number') return stage;
        const parsed = parseInt(String(stage), 10);
        return isNaN(parsed) ? null : parsed;
      };

      // Count "In Process" = New Cases (stage <= 105) + Active Cases (stage >= 110 and stage < 150, excluding Application Submitted and above)
      let inProcessCount = 0;

      // Count new leads (new cases + active cases, excluding inactive)
      if (currentUserFullName || currentUserEmployeeId) {
        let newLeadsQuery = supabase
          .from('leads')
          .select('id, stage, handler_stage')
          .not('handler', 'is', null)
          .not('handler', 'eq', '')
          .not('handler', 'eq', '---')
          .is('unactivated_at', null); // Only active leads

        if (currentUserFullName) {
          newLeadsQuery = newLeadsQuery.eq('handler', currentUserFullName);
        }
        if (currentUserEmployeeId) {
          newLeadsQuery = newLeadsQuery.eq('case_handler_id', currentUserEmployeeId);
        }

        const { data: newLeads, error: newLeadsError } = await newLeadsQuery;
        if (!newLeadsError && newLeads) {
          newLeads.forEach(lead => {
            const stageId = getStageId(lead.handler_stage || lead.stage);
            if (stageId !== null && stageId !== undefined && stageId !== 200) {
              // New cases: stage <= 105 OR Active cases: stage >= 110 AND stage < 150 (exclude Application Submitted and above)
              if (stageId <= 105 || (stageId >= 110 && stageId < 150)) {
                inProcessCount++;
              }
            }
          });
        }
      }

      // Count legacy leads (new cases + active cases, excluding inactive)
      if (currentUserEmployeeId) {
        let legacyLeadsQuery = supabase
          .from('leads_lead')
          .select('id, stage')
          .not('case_handler_id', 'is', null)
          .eq('case_handler_id', currentUserEmployeeId)
          .or('status.eq.0,status.is.null'); // Only active leads

        const { data: legacyLeads, error: legacyLeadsError } = await legacyLeadsQuery;
        if (!legacyLeadsError && legacyLeads) {
          legacyLeads.forEach(lead => {
            const stageId = getStageId(lead.stage);
            if (stageId !== null && stageId !== undefined && stageId !== 200) {
              // New cases: stage <= 105 OR Active cases: stage >= 110 AND stage < 150 (exclude Application Submitted and above)
              if (stageId <= 105 || (stageId >= 110 && stageId < 150)) {
                inProcessCount++;
              }
            }
          });
        }
      }

      // Count "Applications Sent" = All leads where employee is handler that have stage >= 150 (Application Submitted and above) from leads_leadstage
      let applicationsSentCount = 0;

      // For new leads - get lead IDs first, then check leads_leadstage
      if (currentUserFullName || currentUserEmployeeId) {
        let newLeadsQuery = supabase
          .from('leads')
          .select('id')
          .not('handler', 'is', null)
          .not('handler', 'eq', '')
          .not('handler', 'eq', '---')
          .is('unactivated_at', null); // Only active leads

        if (currentUserFullName) {
          newLeadsQuery = newLeadsQuery.eq('handler', currentUserFullName);
        }
        if (currentUserEmployeeId) {
          newLeadsQuery = newLeadsQuery.eq('case_handler_id', currentUserEmployeeId);
        }

        const { data: userNewLeads, error: userNewLeadsError } = await newLeadsQuery;
        if (!userNewLeadsError && userNewLeads && userNewLeads.length > 0) {
          const userNewLeadIds = userNewLeads.map(l => l.id);

          // Count distinct leads from leads_leadstage where stage >= 150
          const { data: stageRecords, error: stageError } = await supabase
            .from('leads_leadstage')
            .select('newlead_id', { count: 'exact', head: false })
            .in('newlead_id', userNewLeadIds)
            .gte('stage', 150);

          if (!stageError && stageRecords) {
            // Get unique lead IDs that have stage >= 150
            const uniqueLeadIds = new Set(stageRecords.map(r => r.newlead_id).filter(Boolean));
            applicationsSentCount += uniqueLeadIds.size;
          }
        }
      }

      // For legacy leads - get lead IDs first, then check leads_leadstage
      if (currentUserEmployeeId) {
        const { data: userLegacyLeads, error: userLegacyLeadsError } = await supabase
          .from('leads_lead')
          .select('id')
          .eq('case_handler_id', currentUserEmployeeId)
          .not('case_handler_id', 'is', null)
          .or('status.eq.0,status.is.null'); // Only active leads

        if (!userLegacyLeadsError && userLegacyLeads && userLegacyLeads.length > 0) {
          const userLegacyLeadIds = userLegacyLeads.map(l => Number(l.id)).filter(id => !Number.isNaN(id));

          // Count distinct leads from leads_leadstage where stage >= 150
          const { data: stageRecords, error: stageError } = await supabase
            .from('leads_leadstage')
            .select('lead_id', { count: 'exact', head: false })
            .in('lead_id', userLegacyLeadIds)
            .gte('stage', 150);

          if (!stageError && stageRecords) {
            // Get unique lead IDs that have stage >= 150
            const uniqueLeadIds = new Set(stageRecords.map(r => r.lead_id).filter(Boolean));
            applicationsSentCount += uniqueLeadIds.size;
          }
        }
      }

      // Fetch approved cases (stage = approved)
      let newApproved = 0;
      let legacyApproved = 0;
      if (currentUserFullName || currentUserEmployeeId) {
        let newApprovedQuery = supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('stage', 'approved')
          .not('handler', 'is', null)
          .not('handler', 'eq', '')
          .not('handler', 'eq', '---')
          .is('unactivated_at', null);

        if (currentUserFullName) {
          newApprovedQuery = newApprovedQuery.eq('handler', currentUserFullName);
        }
        if (currentUserEmployeeId) {
          newApprovedQuery = newApprovedQuery.eq('case_handler_id', currentUserEmployeeId);
        }

        const { count: newApprovedCount, error: newApprovedError } = await newApprovedQuery;
        if (!newApprovedError) newApproved = newApprovedCount || 0;
      }

      if (currentUserEmployeeId) {
        let legacyApprovedQuery = supabase
          .from('leads_lead')
          .select('*', { count: 'exact', head: true })
          .eq('stage', 'approved')
          .eq('case_handler_id', currentUserEmployeeId)
          .not('case_handler_id', 'is', null)
          .or('status.eq.0,status.is.null');

        const { count: legacyApprovedCount, error: legacyApprovedError } = await legacyApprovedQuery;
        if (!legacyApprovedError) legacyApproved = legacyApprovedCount || 0;
      }

      // Fetch declined cases (stage = declined)
      let newDeclined = 0;
      let legacyDeclined = 0;
      if (currentUserFullName || currentUserEmployeeId) {
        let newDeclinedQuery = supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('stage', 'declined')
          .not('handler', 'is', null)
          .not('handler', 'eq', '')
          .not('handler', 'eq', '---')
          .is('unactivated_at', null);

        if (currentUserFullName) {
          newDeclinedQuery = newDeclinedQuery.eq('handler', currentUserFullName);
        }
        if (currentUserEmployeeId) {
          newDeclinedQuery = newDeclinedQuery.eq('case_handler_id', currentUserEmployeeId);
        }

        const { count: newDeclinedCount, error: newDeclinedError } = await newDeclinedQuery;
        if (!newDeclinedError) newDeclined = newDeclinedCount || 0;
      }

      if (currentUserEmployeeId) {
        let legacyDeclinedQuery = supabase
          .from('leads_lead')
          .select('*', { count: 'exact', head: true })
          .eq('stage', 'declined')
          .eq('case_handler_id', currentUserEmployeeId)
          .not('case_handler_id', 'is', null)
          .or('status.eq.0,status.is.null');

        const { count: legacyDeclinedCount, error: legacyDeclinedError } = await legacyDeclinedQuery;
        if (!legacyDeclinedError) legacyDeclined = legacyDeclinedCount || 0;
      }

      setCaseStats({
        inProcess: inProcessCount,
        applicationsSent: applicationsSentCount,
        approved: newApproved + legacyApproved,
        declined: newDeclined + legacyDeclined
      });
    } catch (error) {
      console.error('Error fetching case statistics:', error);
    }
  };

  const fetchTotalBalance = async () => {
    try {
      // Don't fetch if we don't have user identification yet
      if (!currentUserFullName && !currentUserEmployeeId) {
        console.log('🔍 My Achievements - Skipping fetch: No user data available yet');
        setTotalBalance(0);
        return;
      }

      // Create date range for selected month and year (based on due_date, not paid_at)
      const startDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01T00:00:00`;
      const endDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59).toISOString();

      console.log('🔍 My Achievements - Fetching payments for month/year:', {
        selectedMonth,
        selectedYear,
        startDate,
        endDate,
        currentUserFullName,
        currentUserEmployeeId
      });

      // Fetch new payment plans - ready to pay with due_date in selected month/year
      let newPaymentsQuery = supabase
        .from('payment_plans')
        .select(`
          id,
          lead_id,
          value,
          value_vat,
          currency,
          due_date,
          cancel_date,
          ready_to_pay
        `)
        .eq('ready_to_pay', true)
        .not('due_date', 'is', null)
        .is('cancel_date', null)
        .gte('due_date', startDate)
        .lte('due_date', endDate);

      // Filter by current user's handler if available
      let newPayments: any[] = [];
      if (currentUserFullName) {
        // First, get lead IDs for this handler
        const { data: userLeads, error: userLeadsError } = await supabase
          .from('leads')
          .select('id')
          .eq('handler', currentUserFullName)
          .not('handler', 'is', null)
          .not('handler', 'eq', '')
          .not('handler', 'eq', '---');

        if (!userLeadsError && userLeads && userLeads.length > 0) {
          const userLeadIds = userLeads.map(l => l.id);
          newPaymentsQuery = newPaymentsQuery.in('lead_id', userLeadIds);
          const { data: newPaymentsData, error: newError } = await newPaymentsQuery;
          if (newError) {
            console.error('❌ My Achievements - Error fetching new payments:', newError);
            throw newError;
          }
          newPayments = newPaymentsData || [];
          console.log('✅ My Achievements - Fetched new payments:', newPayments.length);
        } else {
          // No new leads for this user, skip new payments query but still check legacy leads
          console.log('✅ My Achievements - No new leads found, skipping new payments query');
        }
      } else {
        // No currentUserFullName, execute query without handler filter
        const { data: newPaymentsData, error: newError } = await newPaymentsQuery;
        if (newError) {
          console.error('❌ My Achievements - Error fetching new payments:', newError);
          throw newError;
        }
        newPayments = newPaymentsData || [];
        console.log('✅ My Achievements - Fetched new payments:', newPayments.length);
      }
      // Fetch legacy payment plans from finances_paymentplanrow
      // Filter by due_date in selected month/year (not ready_to_pay flag)
      let legacyPaymentsQuery = supabase
        .from('finances_paymentplanrow')
        .select(`
          id,
          lead_id,
          value,
          value_base,
          vat_value,
          currency_id,
          due_date,
          cancel_date,
          accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
        `)
        .not('due_date', 'is', null)
        .is('cancel_date', null)
        .gte('due_date', startDate)
        .lte('due_date', endDate);

      // Filter by current user's case_handler_id if available
      let legacyPayments: any[] = [];
      if (currentUserEmployeeId) {
        // First, get lead IDs for this handler
        const { data: userLegacyLeads, error: userLegacyLeadsError } = await supabase
          .from('leads_lead')
          .select('id')
          .eq('case_handler_id', currentUserEmployeeId)
          .not('case_handler_id', 'is', null);

        if (!userLegacyLeadsError && userLegacyLeads && userLegacyLeads.length > 0) {
          const userLegacyLeadIds = userLegacyLeads.map(l => Number(l.id)).filter(id => !Number.isNaN(id));
          legacyPaymentsQuery = legacyPaymentsQuery.in('lead_id', userLegacyLeadIds);
          const { data: legacyPaymentsData, error: legacyError } = await legacyPaymentsQuery;
          if (legacyError) {
            console.error('❌ My Achievements - Error fetching legacy payments:', legacyError);
            throw legacyError;
          }
          legacyPayments = legacyPaymentsData || [];
          console.log('✅ My Achievements - Fetched legacy payments:', legacyPayments.length);
        } else {
          // No legacy leads for this user, skip legacy payments query
          console.log('✅ My Achievements - No legacy leads found, skipping legacy payments query');
        }
      } else {
        // No currentUserEmployeeId, execute query without handler filter
        const { data: legacyPaymentsData, error: legacyError } = await legacyPaymentsQuery;
        if (legacyError) {
          console.error('❌ My Achievements - Error fetching legacy payments:', legacyError);
          throw legacyError;
        }
        legacyPayments = legacyPaymentsData || [];
        console.log('✅ My Achievements - Fetched legacy payments:', legacyPayments.length);
      }

      // Calculate total from new payments
      let totalInNIS = 0;

      // Process new payments
      if (newPayments && newPayments.length > 0) {
        newPayments.forEach((payment: any) => {
          const value = Number(payment.value || 0);
          let vat = Number(payment.value_vat || 0);
          if (!vat && (payment.currency || '₪') === '₪') {
            vat = Math.round(value * 0.18 * 100) / 100;
          }
          const amount = value + vat;

          // Convert to NIS
          let currencyForConversion = payment.currency || 'NIS';
          if (currencyForConversion === '₪') currencyForConversion = 'NIS';
          else if (currencyForConversion === '€') currencyForConversion = 'EUR';
          else if (currencyForConversion === '$') currencyForConversion = 'USD';
          else if (currencyForConversion === '£') currencyForConversion = 'GBP';

          const valueInNIS = convertToNIS(value, currencyForConversion);
          totalInNIS += valueInNIS;
        });
      }

      // Process legacy payments
      if (legacyPayments && legacyPayments.length > 0) {
        legacyPayments.forEach((payment: any) => {
          const value = Number(payment.value || payment.value_base || 0);

          // Get currency from accounting_currencies relation
          const accountingCurrency: any = payment.accounting_currencies
            ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
            : null;

          let currencyForConversion = 'NIS';
          if (accountingCurrency?.name) {
            currencyForConversion = accountingCurrency.name;
          } else if (accountingCurrency?.iso_code) {
            currencyForConversion = accountingCurrency.iso_code;
          } else if (payment.currency_id) {
            switch (payment.currency_id) {
              case 1: currencyForConversion = 'NIS'; break;
              case 2: currencyForConversion = 'EUR'; break;
              case 3: currencyForConversion = 'USD'; break;
              case 4: currencyForConversion = 'GBP'; break;
              default: currencyForConversion = 'NIS'; break;
            }
          }

          // Normalize currency symbols to codes
          if (currencyForConversion === '₪') currencyForConversion = 'NIS';
          else if (currencyForConversion === '€') currencyForConversion = 'EUR';
          else if (currencyForConversion === '$') currencyForConversion = 'USD';
          else if (currencyForConversion === '£') currencyForConversion = 'GBP';

          const valueInNIS = convertToNIS(value, currencyForConversion);
          totalInNIS += valueInNIS;
        });
      }

      console.log('✅ My Achievements - Total in NIS:', totalInNIS);
      setTotalBalance(totalInNIS);
    } catch (error) {
      console.error('❌ My Achievements - Error fetching total balance:', error);
      setTotalBalance(0);
    }
  };

  const fetchApplicationsSentThisMonth = async () => {
    try {
      // Create date range for selected month and year
      const startDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01T00:00:00`;
      const endDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59).toISOString();

      console.log('🔍 My Achievements - Fetching applications sent for month/year:', {
        selectedMonth,
        selectedYear,
        startDate,
        endDate,
        stageId: 150
      });

      let totalCount = 0;

      // Fetch stage changes for new leads (newlead_id)
      if (currentUserFullName) {
        // First, get new lead IDs for this handler
        const { data: userLeads, error: userLeadsError } = await supabase
          .from('leads')
          .select('id')
          .eq('handler', currentUserFullName)
          .not('handler', 'is', null)
          .not('handler', 'eq', '')
          .not('handler', 'eq', '---');

        if (!userLeadsError && userLeads && userLeads.length > 0) {
          const userLeadIds = userLeads.map(l => l.id);

          // Count stage changes to 150 (application submitted) for new leads
          const { data: newStageChanges, error: newStageError } = await supabase
            .from('leads_leadstage')
            .select('id', { count: 'exact', head: false })
            .eq('stage', 150)
            .in('newlead_id', userLeadIds)
            .not('date', 'is', null)
            .gte('date', startDate)
            .lte('date', endDate);

          if (newStageError) {
            console.error('❌ My Achievements - Error fetching new stage changes:', newStageError);
          } else {
            const newCount = newStageChanges?.length || 0;
            console.log('✅ My Achievements - Found', newCount, 'new lead stage changes to 150');
            totalCount += newCount;
          }
        }
      }

      // Fetch stage changes for legacy leads (lead_id)
      if (currentUserEmployeeId) {
        // First, get legacy lead IDs for this handler
        const { data: userLegacyLeads, error: userLegacyLeadsError } = await supabase
          .from('leads_lead')
          .select('id')
          .eq('case_handler_id', currentUserEmployeeId)
          .not('case_handler_id', 'is', null);

        if (!userLegacyLeadsError && userLegacyLeads && userLegacyLeads.length > 0) {
          const userLegacyLeadIds = userLegacyLeads.map(l => Number(l.id)).filter(id => !Number.isNaN(id));

          // Count stage changes to 150 (application submitted) for legacy leads
          const { data: legacyStageChanges, error: legacyStageError } = await supabase
            .from('leads_leadstage')
            .select('id', { count: 'exact', head: false })
            .eq('stage', 150)
            .in('lead_id', userLegacyLeadIds)
            .not('date', 'is', null)
            .gte('date', startDate)
            .lte('date', endDate);

          if (legacyStageError) {
            console.error('❌ My Achievements - Error fetching legacy stage changes:', legacyStageError);
          } else {
            const legacyCount = legacyStageChanges?.length || 0;
            console.log('✅ My Achievements - Found', legacyCount, 'legacy lead stage changes to 150');
            totalCount += legacyCount;
          }
        }
      }

      console.log('✅ My Achievements - Total applications sent this month:', totalCount);
      setApplicationsSentThisMonth(totalCount);
    } catch (error) {
      console.error('❌ My Achievements - Error fetching applications sent:', error);
      setApplicationsSentThisMonth(0);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      // Fetch new leads with JOINs for related data
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          *,
          master_id,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          )
        `)
        .not('handler', 'is', null)
        .not('handler', 'eq', '')
        .not('handler', 'eq', '---')
        .is('unactivated_at', null); // Only active leads (exclude inactive)

      // Filter new leads by handler field if we have handler name (from URL param or current user)
      if (currentUserFullName) {
        newLeadsQuery = newLeadsQuery.eq('handler', currentUserFullName);
        console.log('🔍 Filtering new leads by handler:', currentUserFullName);
      }

      // Also filter by case_handler_id if we have handler ID (more reliable)
      if (currentUserEmployeeId) {
        newLeadsQuery = newLeadsQuery.eq('case_handler_id', currentUserEmployeeId);
        console.log('🔍 Filtering new leads by case_handler_id:', currentUserEmployeeId);
      }

      const { data: newLeadsData, error: newLeadsError } = await newLeadsQuery.order('created_at', { ascending: false });

      if (newLeadsError) {
        console.error('Error fetching new leads:', newLeadsError);
        throw newLeadsError;
      }

      // Fetch legacy leads with JOINs for related data
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(`
          *,
          master_id,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          ),
          case_handler:tenants_employee!case_handler_id(
            id,
            display_name
          ),
          expert:tenants_employee!expert_id(
            id,
            display_name
          )
        `)
        .not('case_handler_id', 'is', null)
        .or('status.eq.0,status.is.null'); // Only active leads (status 0 or null = active, status 10 = inactive)

      // Filter legacy leads by case_handler_id if we have the employee ID
      if (currentUserEmployeeId) {
        legacyLeadsQuery = legacyLeadsQuery.eq('case_handler_id', currentUserEmployeeId);
        console.log('🔍 Filtering legacy leads by case_handler_id:', currentUserEmployeeId);
      }

      const { data: legacyLeadsData, error: legacyLeadsError } = await legacyLeadsQuery.order('cdate', { ascending: false });

      if (legacyLeadsError) {
        console.error('Error fetching legacy leads:', legacyLeadsError);
        throw legacyLeadsError;
      }

      // Transform new leads to include resolved names
      const transformedNewLeads = (newLeadsData || []).map(lead => {
        // Debug logging for category JOIN data
        if (lead.category_id && Math.random() < 0.1) { // Log 10% for debugging
          console.log('🔍 New lead category debug:', {
            leadId: lead.id,
            categoryId: lead.category_id,
            miscCategory: lead.misc_category,
            fallbackCategory: lead.category
          });
        }

        return {
          ...lead,
          lead_type: 'new' as const,
          handler: lead.handler || 'Not assigned',
          expert: lead.expert || '--',
          category: lead.misc_category?.name
            ? (lead.misc_category.misc_maincategory?.name
              ? `${lead.misc_category.name} (${lead.misc_category.misc_maincategory.name})`
              : lead.misc_category.name)
            : getCategoryDisplayName(lead.category_id, lead.category)
        };
      });

      // Transform legacy leads to match HandlerLead interface with resolved names
      const transformedLegacyLeads = (legacyLeadsData || []).map(lead => {
        // Debug logging for category JOIN data
        if (lead.category_id && Math.random() < 0.1) { // Log 10% for debugging
          console.log('🔍 Legacy lead category debug:', {
            leadId: lead.id,
            categoryId: lead.category_id,
            miscCategory: lead.misc_category,
            fallbackCategory: lead.category
          });
        }

        return {
          ...lead,
          id: `legacy_${lead.id}`,
          lead_number: String(lead.id),
          created_at: lead.cdate,
          lead_type: 'legacy' as const,
          handler: lead.case_handler?.display_name || getEmployeeDisplayName(lead.case_handler_id) || 'Not assigned',
          expert: lead.expert?.display_name || getEmployeeDisplayName(lead.expert_id) || '--',
          category: lead.misc_category?.name
            ? (lead.misc_category.misc_maincategory?.name
              ? `${lead.misc_category.name} (${lead.misc_category.misc_maincategory.name})`
              : lead.misc_category.name)
            : getCategoryDisplayName(lead.category_id, lead.category),
          balance: lead.total || 0,
          balance_currency: lead.currency_id === 1 ? '₪' : lead.currency_id === 2 ? '$' : lead.currency_id === 3 ? '€' : '₪'
        };
      });

      // Combine new leads and legacy leads
      const allLeads = [
        ...transformedNewLeads,
        ...transformedLegacyLeads
      ];

      setLeads(allLeads);
      console.log('🔍 Total leads fetched:', allLeads.length, '(New:', transformedNewLeads.length, 'Legacy:', transformedLegacyLeads.length, ')');
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
    // Navigate to the case details page
    // Remove "legacy_" prefix from ID for URL
    const caseId = lead.id.startsWith('legacy_') ? lead.id.replace('legacy_', '') : lead.id;
    navigate(`/case-manager/${caseId}`);
  };


  // User authentication effect - also handles handlerId from URL
  useEffect(() => {
    (async () => {
      try {
        // If handlerId is in URL, fetch that handler's info instead of current user
        if (filterHandlerId) {
          const { data: handlerData, error: handlerError } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .eq('id', filterHandlerId)
            .single();

          if (!handlerError && handlerData) {
            setFilterHandlerName(handlerData.display_name || '');
            setCurrentUserFullName(handlerData.display_name || '');
            setCurrentUserEmployeeId(filterHandlerId);
            return;
          }
        }

        // Otherwise, fetch current user's data
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError) {
          console.error('🔍 Authentication error:', authError);
          setCurrentUserFullName('Unknown User');
          return;
        }

        // Fetch current user's data with employee relationship using JOIN
        if (user?.id) {
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select(`
              id,
              full_name,
              email,
              employee_id,
              tenants_employee!employee_id(
                id,
                display_name
              )
            `)
            .eq('auth_id', user.id)
            .single();

          if (userError) {
            console.error('🔍 User data fetch error details:', userError);
            setCurrentUserFullName('Unknown User');
            return;
          }

          if (userData?.full_name) {
            setCurrentUserFullName(userData.full_name);
          } else if (userData?.tenants_employee && Array.isArray(userData.tenants_employee) && userData.tenants_employee.length > 0) {
            setCurrentUserFullName(userData.tenants_employee[0].display_name);
          } else {
            setCurrentUserFullName('Unknown User');
          }

          // Store employee ID for efficient filtering
          if (userData?.employee_id && typeof userData.employee_id === 'number') {
            setCurrentUserEmployeeId(userData.employee_id);
          } else {
            setCurrentUserEmployeeId(null);
          }
        } else {
          setCurrentUserFullName('Unknown User');
        }
      } catch (error) {
        console.error('🔍 Error in user data fetching:', error);
        setCurrentUserFullName('Unknown User');
      }
    })();
  }, [filterHandlerId]);

  useEffect(() => {
    // Only fetch leads when we have user authentication data
    if (currentUserFullName || currentUserEmployeeId) {
      fetchReferenceData(); // Fetch reference data first
      fetchLeads();
      fetchHandlerStageStats();
      fetchNewMessages();
      fetchTasksDue();
      console.log('📄 CaseManagerPageNew: Calling fetchDocumentsPending from useEffect');
      fetchDocumentsPending();
      fetchCaseStatistics();
      fetchTotalBalance();
      fetchApplicationsSentThisMonth();
    }
  }, [currentUserFullName, currentUserEmployeeId]);


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
    fetchApplicationsSentThisMonth();
  }, [selectedMonth, selectedYear, currentUserFullName, currentUserEmployeeId]);


  // Main dashboard view
  return (
    <div ref={mainContainerRef} className="min-h-screen bg-white pt-8">
      <div className="w-full max-w-[95vw] xl:max-w-[98vw] mx-auto px-2 sm:px-4 md:px-6 lg:px-8 xl:px-12 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome{currentUserFullName ? `, ${currentUserFullName}` : ''}!
          </h1>
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
            <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-12 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10" /><rect x="10" y="10" width="4" height="20" /><rect x="18" y="16" width="4" height="14" /><rect x="26" y="6" width="4" height="24" /><rect x="34" y="14" width="4" height="16" /></svg>
          </div>

          {/* Documents Pending Box */}
          <div
            className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white relative overflow-hidden p-3 md:p-6"
            onClick={() => {
              console.log('📄 Documents Pending Box clicked', {
                expanded,
                documentsPendingCount,
                documentsDueLength: documentsDue.length,
                documentsDue: documentsDue
              });
              setExpanded(expanded === 'documents' ? null : 'documents');
            }}
          >
            <div className="flex items-center gap-2 md:gap-4">
              <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
                <DocumentTextIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
              </div>
              <div>
                <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">
                  {(() => {
                    console.log('📄 Rendering documentsPendingCount:', documentsPendingCount);
                    return documentsPendingCount;
                  })()}
                </div>
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
                  <p className="text-sm text-gray-600">Collection due for the month</p>
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
                Total Due Amount - {new Date(selectedYear, selectedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </div>
              <div className="border-t border-gray-200 pt-4">
                <div className="text-lg font-semibold text-gray-700 mb-1">
                  Applications Sent This Month
                </div>
                <div className="text-2xl font-bold text-purple-600">
                  {applicationsSentThisMonth}
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
                        // Navigate to the case details page
                        // Use lead_id or legacy_lead_id from task
                        if (task.lead_id) {
                          navigate(`/case-manager/${task.lead_id}`);
                        } else if (task.legacy_lead_id) {
                          navigate(`/case-manager/${task.legacy_lead_id}`);
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
              {(() => {
                console.log('📄 Expanded documents view - rendering', {
                  expanded,
                  documentsDueLength: documentsDue.length,
                  documentsPendingCount,
                  documentsDue: documentsDue
                });
                return null;
              })()}
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
                        // Find the lead for this document (handle both new and legacy leads)
                        let leadIdToFind: string | null = null;

                        if (document.lead_id) {
                          // New lead
                          leadIdToFind = document.lead_id;
                        } else if (document.legacy_lead_id) {
                          // Legacy lead - add "legacy_" prefix
                          leadIdToFind = `legacy_${document.legacy_lead_id}`;
                        }

                        if (leadIdToFind) {
                          const lead = leads.find(l => l.id === leadIdToFind);
                          if (lead) {
                            // Navigate to the case details page
                            // Remove "legacy_" prefix from ID for URL
                            const caseId = lead.id.startsWith('legacy_') ? lead.id.replace('legacy_', '') : lead.id;
                            navigate(`/case-manager/${caseId}`);
                          } else {
                            // Lead not in current leads list, but we can still navigate using the ID
                            const caseId = leadIdToFind.startsWith('legacy_') ? leadIdToFind.replace('legacy_', '') : leadIdToFind;
                            navigate(`/case-manager/${caseId}`);
                          }
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
              getStageDisplayName={getStageDisplayName}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CaseManagerPageNew; 