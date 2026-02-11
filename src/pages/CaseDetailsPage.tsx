import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FolderIcon,
  UserGroupIcon,
  DocumentTextIcon,
  ClockIcon,
  FlagIcon,
  PencilIcon,
  ChatBubbleLeftRightIcon,
  ChartBarIcon,
  ChevronDownIcon,
  InformationCircleIcon,
  TagIcon,
  PlayIcon,
  DocumentCheckIcon,
  CheckCircleIcon,
  CurrencyDollarIcon,
  CalendarDaysIcon,
  ArrowPathIcon,
  PencilSquareIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  NoSymbolIcon,
  TrashIcon,
  Squares2X2Icon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';
import { StarIcon } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { getStageName, getStageColour, initializeStageNames, areStagesEquivalent, normalizeStageName } from '../lib/stageUtils';
import { updateLeadStageWithHistory, fetchStageActorInfo } from '../lib/leadStageManager';
import { addToHighlights, removeFromHighlights } from '../lib/highlightsUtils';

// Import tab components
import CasesTab from '../components/case-manager/CasesTab';
import ContactsTab from '../components/case-manager/ContactsTab';
import DocumentsTab from '../components/case-manager/DocumentsTab';
import TasksTab from '../components/case-manager/TasksTab';
import StatusTab from '../components/case-manager/StatusTab';
import NotesTab from '../components/case-manager/NotesTab';
import CommunicationsTab from '../components/case-manager/CommunicationsTab';
import FinanceTab from '../components/case-manager/FinanceTab';

interface HandlerLead {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  category?: string;
  topic?: string;
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
  master_id?: string | number | null;
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
  { id: 'status', label: 'Status', icon: FlagIcon },
  { id: 'notes', label: 'Notes', icon: PencilIcon },
  { id: 'communications', label: 'Communications', icon: ChatBubbleLeftRightIcon },
  { id: 'finance', label: 'Finance', icon: ChartBarIcon },
];

type TabId = typeof tabs[number]['id'];

const CaseDetailsPage: React.FC = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [selectedCase, setSelectedCase] = useState<HandlerLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('cases');
  const [uploadingLeadId, setUploadingLeadId] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{ [leadId: string]: UploadedFile[] }>({});
  const [isUploading, setIsUploading] = useState(false);
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const [isTabBarCollapsed, setIsTabBarCollapsed] = useState(false);
  const desktopTabsRef = useRef<HTMLDivElement>(null);

  // User authentication state
  const [currentUserFullName, setCurrentUserFullName] = useState<string>('');
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState<number | null>(null);

  // Data for resolving IDs to names
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);

  // Actions dropdown state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSubLeadDrawer, setShowSubLeadDrawer] = useState(false);
  const [showUnactivationModal, setShowUnactivationModal] = useState(false);
  const [isInHighlightsState, setIsInHighlightsState] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  // Next payment reminder state
  const [nextDuePayment, setNextDuePayment] = useState<any>(null);

  // Master lead and subleads for lead number formatting
  const [masterLead, setMasterLead] = useState<HandlerLead | null>(null);
  const [subLeads, setSubLeads] = useState<HandlerLead[]>([]);

  // Fetch reference data
  const fetchReferenceData = async () => {
    try {
      const [employeesResult, categoriesResult] = await Promise.all([
        supabase.from('tenants_employee').select('id, display_name, photo_url, photo').order('display_name'),
        supabase.from('misc_category').select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id (
            id,
            name
          )
        `).order('name'),
      ]);

      if (employeesResult.data) setAllEmployees(employeesResult.data);
      if (categoriesResult.data) setAllCategories(categoriesResult.data);
    } catch (error) {
      console.error('Error fetching reference data:', error);
    }
  };

  // Helper function to get employee by ID
  const getEmployeeById = (employeeIdOrName: string | number | null | undefined) => {
    if (!employeeIdOrName || employeeIdOrName === '---' || employeeIdOrName === '--' || employeeIdOrName === '') {
      return null;
    }

    // First, try to match by ID
    const employeeById = allEmployees.find((emp: any) => {
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const searchId = typeof employeeIdOrName === 'string' ? parseInt(employeeIdOrName, 10) : employeeIdOrName;

      if (isNaN(Number(searchId))) return false;
      if (empId.toString() === searchId.toString()) return true;
      if (Number(empId) === Number(searchId)) return true;
      return false;
    });

    if (employeeById) {
      return employeeById;
    }

    // If not found by ID, try to match by display name
    if (typeof employeeIdOrName === 'string') {
      const employeeByName = allEmployees.find((emp: any) => {
        if (!emp.display_name) return false;
        return emp.display_name.trim().toLowerCase() === employeeIdOrName.trim().toLowerCase();
      });

      if (employeeByName) {
        return employeeByName;
      }
    }

    return null;
  };

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string | null | undefined): string => {
    if (!name || name === '---' || name === '--' || name === 'Not assigned') return '';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Helper function to get employee display name
  const getEmployeeDisplayName = (id: string | number | null | undefined): string => {
    if (!id) return '---';
    const employee = getEmployeeById(id);
    return employee?.display_name || '---';
  };

  // Helper function to get category display name with main category (matching Clients page)
  const getCategoryDisplayName = (categoryId: string | number | null | undefined, fallbackCategory?: string): string => {
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      return fallbackCategory || '';
    }

    // Try to find category by ID
    const category = allCategories.find((cat: any) => {
      const catId = typeof cat.id === 'bigint' ? Number(cat.id) : cat.id;
      const searchId = typeof categoryId === 'string' ? parseInt(categoryId, 10) : categoryId;
      return catId === searchId || Number(catId) === Number(searchId);
    });

    if (category) {
      // Return category name with main category in parentheses if available
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name;
      }
    }

    // Try to find by name if ID lookup failed
    const categoryByName = allCategories.find((cat: any) => cat.name === categoryId);
    if (categoryByName) {
      if (categoryByName.misc_maincategory?.name) {
        return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
      } else {
        return categoryByName.name;
      }
    }

    return fallbackCategory || String(categoryId);
  };

  // Employee Avatar Component
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-base';

    if (!employee) {
      return null;
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

    // If we know there's no photo URL or we have an error, show initials immediately
    if (imageError || !photoUrl) {
      return (
        <div
          className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
          title={employee.display_name}
        >
          {initials}
        </div>
      );
    }

    // Try to render image
    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
        onError={() => setImageError(true)}
        title={employee.display_name}
      />
    );
  };

  // Helper function to get stage display name
  const getStageDisplayName = (stage: string | number | null | undefined): string => {
    if (!stage && stage !== 0) return 'No Stage';
    const stageStr = String(stage);
    return getStageName(stageStr);
  };

  // Helper function to calculate contrasting text color based on background
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

  // Fetch the case data
  const fetchCase = async () => {
    if (!caseId) return;

    setLoading(true);
    try {
      // Try to fetch as new lead first
      const { data: newLeadData, error: newLeadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', caseId)
        .single();

      if (!newLeadError && newLeadData) {
        // Found as new lead
        // Debug: Log role values
        console.log('🔍 CaseDetailsPage - New lead role values:', {
          expert: newLeadData.expert,
          expert_id: newLeadData.expert_id,
          handler: newLeadData.handler,
          handler_id: newLeadData.handler_id,
          closer: newLeadData.closer,
          closer_id: newLeadData.closer_id,
          scheduler: newLeadData.scheduler,
          scheduler_id: newLeadData.scheduler_id,
        });

        const lead: HandlerLead = {
          id: newLeadData.id,
          lead_number: newLeadData.lead_number || String(newLeadData.id),
          name: newLeadData.name || 'Unknown',
          email: newLeadData.email,
          phone: newLeadData.phone,
          category: newLeadData.category,
          topic: newLeadData.topic,
          stage: String(newLeadData.stage || ''),
          handler_stage: newLeadData.handler_stage || String(newLeadData.stage || ''),
          created_at: newLeadData.created_at || '',
          balance: newLeadData.balance || 0,
          balance_currency: newLeadData.balance_currency || '₪',
          onedrive_folder_link: newLeadData.onedrive_folder_link,
          // Use ID fields if available, otherwise use name fields
          expert: newLeadData.expert_id || newLeadData.expert || null,
          handler: newLeadData.handler_id || newLeadData.handler || null,
          closer: newLeadData.closer_id || newLeadData.closer || null,
          scheduler: newLeadData.scheduler_id || newLeadData.scheduler || null,
          manager: newLeadData.manager_id || newLeadData.manager || null,
          notes: newLeadData.notes,
          lead_type: 'new',
          master_id: newLeadData.master_id || null,
        };

        console.log('🔍 CaseDetailsPage - Processed lead roles:', {
          expert: lead.expert,
          handler: lead.handler,
          closer: lead.closer,
          scheduler: lead.scheduler,
        });

        setSelectedCase(lead);
      } else {
        // Try to fetch as legacy lead
        const numericId = parseInt(caseId, 10);
        if (isNaN(numericId)) {
          throw new Error('Invalid case ID');
        }

        const { data: legacyLeadData, error: legacyLeadError } = await supabase
          .from('leads_lead')
          .select('*')
          .eq('id', numericId)
          .single();

        if (legacyLeadError || !legacyLeadData) {
          throw new Error('Case not found');
        }

        // Found as legacy lead
        // Debug: Log role values
        console.log('🔍 CaseDetailsPage - Legacy lead role values:', {
          expert_id: legacyLeadData.expert_id,
          case_handler_id: legacyLeadData.case_handler_id,
          closer_id: legacyLeadData.closer_id,
          meeting_scheduler_id: legacyLeadData.meeting_scheduler_id,
        });

        const lead: HandlerLead = {
          id: `legacy_${legacyLeadData.id}`,
          lead_number: legacyLeadData.manual_id || String(legacyLeadData.id),
          name: legacyLeadData.name || 'Unknown',
          category: legacyLeadData.category_id ? String(legacyLeadData.category_id) : undefined,
          topic: legacyLeadData.topic,
          stage: String(legacyLeadData.stage || ''),
          handler_stage: String(legacyLeadData.stage || ''),
          created_at: legacyLeadData.cdate || '',
          balance: legacyLeadData.total || 0,
          balance_currency: '₪',
          // Legacy leads use ID fields
          expert: legacyLeadData.expert_id || null,
          handler: legacyLeadData.case_handler_id || null,
          closer: legacyLeadData.closer_id || null,
          scheduler: legacyLeadData.meeting_scheduler_id || null,
          manager: legacyLeadData.meeting_manager_id || null,
          lead_type: 'legacy',
          master_id: legacyLeadData.master_id || null,
        };

        console.log('🔍 CaseDetailsPage - Processed legacy lead roles:', {
          expert: lead.expert,
          handler: lead.handler,
          closer: lead.closer,
          scheduler: lead.scheduler,
        });

        setSelectedCase(lead);
      }
    } catch (error: any) {
      console.error('Error fetching case:', error);
      toast.error('Failed to load case details');
      navigate('/case-manager');
    } finally {
      setLoading(false);
    }
  };

  // Fetch master lead and subleads for lead number formatting
  const fetchMasterAndSubLeads = async (lead: HandlerLead) => {
    try {
      if (lead.master_id) {
        // This is a sublead - fetch the master lead
        if (lead.lead_type === 'new') {
          const { data: masterData } = await supabase
            .from('leads')
            .select('*')
            .eq('id', String(lead.master_id))
            .single();

          if (masterData) {
            const master: HandlerLead = {
              id: masterData.id,
              lead_number: masterData.lead_number || String(masterData.id),
              name: masterData.name || 'Unknown',
              lead_type: 'new',
              master_id: masterData.master_id || null,
              stage: String(masterData.stage || ''),
              created_at: masterData.created_at || '',
            };
            // Store manual_id in the lead object for formatting
            (master as any).manual_id = masterData.manual_id;
            setMasterLead(master);
          }
        } else {
          // Legacy sublead
          const masterIdNum = typeof lead.master_id === 'number' ? lead.master_id : parseInt(String(lead.master_id), 10);
          if (!isNaN(masterIdNum)) {
            const { data: masterData } = await supabase
              .from('leads_lead')
              .select('*')
              .eq('id', masterIdNum)
              .single();

            if (masterData) {
              const master: HandlerLead = {
                id: `legacy_${masterData.id}`,
                lead_number: masterData.manual_id || String(masterData.id),
                name: masterData.name || 'Unknown',
                lead_type: 'legacy',
                master_id: masterData.master_id || null,
                stage: String(masterData.stage || ''),
                created_at: masterData.cdate || '',
              };
              setMasterLead(master);
            }
          }
        }
      } else {
        // This might be a master lead - fetch subleads
        if (lead.lead_type === 'new') {
          const { data: subLeadsData } = await supabase
            .from('leads')
            .select('*')
            .eq('master_id', lead.id);

          if (subLeadsData && subLeadsData.length > 0) {
            const subLeadsList: HandlerLead[] = subLeadsData.map(sub => {
              const subLead: HandlerLead = {
                id: sub.id,
                lead_number: sub.lead_number || String(sub.id),
                name: sub.name || 'Unknown',
                lead_type: 'new',
                master_id: sub.master_id || null,
                stage: String(sub.stage || ''),
                created_at: sub.created_at || '',
              };
              // Store manual_id for formatting
              (subLead as any).manual_id = sub.manual_id;
              return subLead;
            });
            setSubLeads(subLeadsList);
          }
        } else {
          // Legacy master lead
          const leadIdNum = parseInt(lead.id.replace('legacy_', ''), 10);
          if (!isNaN(leadIdNum)) {
            const { data: subLeadsData } = await supabase
              .from('leads_lead')
              .select('*')
              .eq('master_id', leadIdNum);

            if (subLeadsData && subLeadsData.length > 0) {
              const subLeadsList: HandlerLead[] = subLeadsData.map(sub => ({
                id: `legacy_${sub.id}`,
                lead_number: sub.manual_id || String(sub.id),
                name: sub.name || 'Unknown',
                lead_type: 'legacy',
                master_id: sub.master_id || null,
                stage: String(sub.stage || ''),
                created_at: sub.cdate || '',
              }));
              setSubLeads(subLeadsList);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching master/sub leads:', error);
    }
  };

  // Helper function to extract base number (remove any /X suffix)
  const extractBaseNumber = (leadNumber: string | undefined | null): string => {
    if (!leadNumber) return '';
    // If it contains '/', take the part before the first '/'
    if (leadNumber.includes('/')) {
      return leadNumber.split('/')[0];
    }
    return leadNumber;
  };

  // Format lead number (same logic as DashboardTab)
  const formatLeadNumber = (lead: HandlerLead): string => {
    const masterId = lead.master_id;

    // For new leads with master_id
    if (lead.lead_type === 'new' && masterId) {
      // If lead_number already contains '/', it's already formatted
      if (lead.lead_number && lead.lead_number.includes('/')) {
        return lead.lead_number;
      }
      // Try to get master lead number and format
      const master = masterLead || null;
      if (master) {
        // Use manual_id first (raw number), then extract base from lead_number (in case it has /1), then fallback to masterId
        const rawBase = (master as any).manual_id || extractBaseNumber(master.lead_number) || String(masterId);
        // Try to find sublead suffix by checking other subleads
        const subleads = subLeads.filter(l => l.master_id === masterId && l.id !== lead.id);
        const suffix = subleads.length > 0 ? subleads.length + 2 : 2; // Default to /2, or calculate based on existing subleads
        return `${rawBase}/${suffix}`;
      }
      // Fallback: use lead_number if available, otherwise format with master_id
      return lead.lead_number || `${masterId}/2`;
    }

    // For legacy leads with master_id
    if (lead.lead_type === 'legacy' && masterId) {
      const masterIdStr = String(masterId);
      const master = masterLead || null;
      if (master) {
        // Extract base number (remove any /X suffix that might be in master.lead_number)
        const baseNumber = extractBaseNumber(master.lead_number) || masterIdStr;
        // Try to find sublead suffix
        const subleads = subLeads.filter(l =>
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

  // Initialize stage names on mount
  useEffect(() => {
    initializeStageNames();
  }, []);

  // User authentication effect
  useEffect(() => {
    (async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError) {
          console.error('🔍 Authentication error:', authError);
          setCurrentUserFullName('Unknown User');
          return;
        }

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
  }, []);

  useEffect(() => {
    if (currentUserFullName || currentUserEmployeeId) {
      fetchReferenceData();
      fetchCase();
    }
  }, [caseId, currentUserFullName, currentUserEmployeeId]);

  // Fetch master lead and subleads when selectedCase changes
  useEffect(() => {
    if (selectedCase) {
      fetchMasterAndSubLeads(selectedCase);
    } else {
      setMasterLead(null);
      setSubLeads([]);
    }
  }, [selectedCase]);

  // Fetch next due payment when case changes
  useEffect(() => {
    if (selectedCase?.id) {
      fetchNextDuePayment(selectedCase.id);
    } else {
      setNextDuePayment(null);
    }
  }, [selectedCase?.id]);

  // Fetch superuser status
  useEffect(() => {
    const fetchSuperuserStatus = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          setIsSuperuser(false);
          return;
        }

        let { data: userData, error } = await supabase
          .from('users')
          .select('is_superuser')
          .eq('auth_id', user.id)
          .maybeSingle();

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

  // Check if case is in highlights
  useEffect(() => {
    const checkHighlights = async () => {
      if (!selectedCase?.id) return;

      try {
        const isLegacyLead = selectedCase.lead_type === 'legacy' || selectedCase.id?.toString().startsWith('legacy_');
        const leadId = isLegacyLead
          ? (typeof selectedCase.id === 'string' ? parseInt(selectedCase.id.replace('legacy_', '')) : selectedCase.id)
          : selectedCase.id;

        const { data: highlights, error } = await supabase
          .from('highlights')
          .select('id')
          .eq('lead_id', leadId)
          .eq('is_legacy', isLegacyLead)
          .maybeSingle();

        if (!error && highlights) {
          setIsInHighlightsState(true);
        } else {
          setIsInHighlightsState(false);
        }
      } catch (error) {
        console.error('Error checking highlights:', error);
        setIsInHighlightsState(false);
      }
    };

    if (selectedCase) {
      checkHighlights();
    }
  }, [selectedCase?.id]);

  // Handlers for actions
  const handleActivation = async () => {
    if (!selectedCase) return;
    try {
      const isLegacyLead = selectedCase.lead_type === 'legacy' || selectedCase.id?.toString().startsWith('legacy_');
      const tableName = isLegacyLead ? 'leads_lead' : 'leads';
      const idField = 'id';
      const clientId = isLegacyLead ? selectedCase.id.toString().replace('legacy_', '') : selectedCase.id;

      const { error } = await supabase
        .from(tableName)
        .update({
          status: isLegacyLead ? 0 : 'active',
          unactivated_by: null,
          unactivated_at: null,
          unactivation_reason: null,
        })
        .eq(idField, clientId);

      if (error) throw error;
      toast.success('Case activated successfully');
      await fetchCase();
    } catch (error) {
      console.error('Error activating case:', error);
      toast.error('Failed to activate case');
    }
  };

  const openEditLeadDrawer = () => {
    // TODO: Implement edit lead drawer
    toast.success('Edit lead drawer coming soon');
  };

  // Function to fetch next due payment
  const fetchNextDuePayment = async (caseId: string) => {
    if (!caseId) return;

    try {
      const isLegacyLead = caseId.toString().startsWith('legacy_');

      if (isLegacyLead) {
        // For legacy leads, fetch from finances_paymentplanrow table
        // IMPORTANT: Use 'date' column for legacy leads, not 'due_date'
        const legacyId = caseId.toString().replace('legacy_', '');

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
          .is('actual_date', null) // Payment hasn't been made yet
          .is('cancel_date', null) // Only active payments
          .not('date', 'is', null) // Must have date (not due_date for legacy)
          .order('date', { ascending: true })
          .limit(1);

        if (error) throw error;

        if (data && data.length > 0) {
          const payment = data[0];
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const dueDate = new Date(payment.date); // Use 'date' column for legacy
          dueDate.setHours(0, 0, 0, 0);
          const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          // Only show if payment is due within 10 days or less
          if (daysUntilDue <= 10) {
            setNextDuePayment({
              ...payment,
              isLegacy: true,
              dueDate: payment.date // Store the date for display
            });
          } else {
            setNextDuePayment(null);
          }
        } else {
          setNextDuePayment(null);
        }
      } else {
        // For new leads, fetch from payment_plans table
        // IMPORTANT: Use 'due_date' column for new leads
        const { data, error } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('lead_id', caseId)
          .eq('paid', false) // Only unpaid payments
          .is('cancel_date', null) // Only active payments
          .not('due_date', 'is', null) // Must have due_date (for new leads)
          .order('due_date', { ascending: true })
          .limit(1);

        if (error) throw error;

        if (data && data.length > 0) {
          const payment = data[0];
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const dueDate = new Date(payment.due_date); // Use 'due_date' column for new leads
          dueDate.setHours(0, 0, 0, 0);
          const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          // Only show if payment is due within 10 days or less
          if (daysUntilDue <= 10) {
            setNextDuePayment({
              ...payment,
              isLegacy: false,
              dueDate: payment.due_date // Store the due_date for display
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
  };

  // Scroll to top when component mounts or tab changes
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  }, [activeTab]);

  // File upload functions
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

    // Simulate upload progress
    for (const file of files) {
      try {
        // Add your actual upload logic here
        await new Promise(resolve => setTimeout(resolve, 1000));

        setUploadedFiles(prev => ({
          ...prev,
          [lead.id]: (prev[lead.id] || []).map(f =>
            f.name === file.name ? { ...f, status: 'success' as const, progress: 100 } : f
          )
        }));
      } catch (error) {
        setUploadedFiles(prev => ({
          ...prev,
          [lead.id]: (prev[lead.id] || []).map(f =>
            f.name === file.name ? { ...f, status: 'error' as const, error: 'Upload failed' } : f
          )
        }));
      }
    }

    setUploadingLeadId(null);
    setIsUploading(false);
  };

  const handleFileInput = (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      uploadFiles(lead, files);
    }
  };

  const refreshLeads = async () => {
    await fetchCase();
  };

  const refreshDashboardData = async () => {
    // This can be empty or fetch additional data if needed
  };

  // Update lead stage function (similar to Clients.tsx)
  // Note: updateLeadStageWithHistory handles stage resolution internally
  const updateLeadStage = async (stage: string | number) => {
    if (!selectedCase) return;

    try {
      const actor = await fetchStageActorInfo();
      const timestamp = new Date().toISOString();
      const isLegacyLead = selectedCase.id.startsWith('legacy_');

      // Get current stage name to check for special cases
      const currentStageName = getStageName(String(selectedCase.stage));
      const normalizedStageName = normalizeStageName(currentStageName);

      const additionalFields: Record<string, any> = {};
      if (!isLegacyLead && normalizedStageName === 'communicationstarted') {
        additionalFields.communication_started_by = actor.fullName;
        additionalFields.communication_started_at = timestamp;
      }

      // updateLeadStageWithHistory will resolve the stage ID internally
      await updateLeadStageWithHistory({
        lead: selectedCase as any,
        stage: stage, // Pass stage as-is, let updateLeadStageWithHistory resolve it
        additionalFields,
        actor,
        timestamp,
      });

      // Refresh case data to get updated stage
      await fetchCase();
      toast.success('Stage updated successfully');
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

  // Handle start case
  const handleStartCase = () => {
    updateLeadStage('Handler Started');
  };

  const handleCaseSelect = (lead: HandlerLead) => {
    // Navigate to the case details page
    navigate(`/case-manager/${lead.id}`);
  };

  const handleBackToCases = () => {
    navigate('/case-manager');
  };

  const renderTabContent = () => {
    if (!selectedCase) return null;

    const tabProps = {
      leads: [selectedCase],
      uploadFiles,
      uploadingLeadId,
      uploadedFiles,
      isUploading,
      handleFileInput,
      refreshLeads,
      refreshDashboardData,
      getStageDisplayName,
      onCaseSelect: handleCaseSelect,
      onClientUpdate: async () => {
        // Refresh the case data when client is updated
        await fetchCase();
      }
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

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary"></div>
          <p className="mt-4 text-gray-600">Loading case details...</p>
        </div>
      </div>
    );
  }

  if (!selectedCase) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Case not found</p>

        </div>
      </div>
    );
  }

  return (
    <div ref={mainContainerRef} className="min-h-screen bg-white pt-8">
      <div className="w-full max-w-[95vw] xl:max-w-[98vw] mx-auto px-2 sm:px-4 md:px-6 lg:px-8 xl:px-12 py-8">
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
                <div className="flex flex-col gap-3 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">{selectedCase.name}</h1>

                        {/* Stage badge next to client name on the right */}
                        {selectedCase.stage && (() => {
                          const stageStr = (selectedCase.stage !== null && selectedCase.stage !== undefined)
                            ? String(selectedCase.stage)
                            : '';
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
                      </div>
                      <div className="flex items-center gap-3 flex-wrap mt-1">
                        <p className="text-sm sm:text-lg text-gray-600">#{formatLeadNumber(selectedCase)}</p>

                        {(() => {
                          // For new leads, category might be a string (name) or ID
                          // For legacy leads, category is category_id
                          const categoryDisplay = getCategoryDisplayName(
                            selectedCase.category,
                            selectedCase.category // fallback to itself if it's already a name
                          );

                          if (!categoryDisplay || categoryDisplay === '---' || categoryDisplay === '--') {
                            return null;
                          }

                          return (
                            <span
                              className="badge text-sm px-4 py-2 font-bold shadow-sm bg-base-200 text-base-content/90 border-base-300 whitespace-nowrap flex items-center gap-2"
                            >
                              <TagIcon className="w-4 h-4 flex-shrink-0" />
                              <span>{categoryDisplay}</span>
                            </span>
                          );
                        })()}

                        {selectedCase.topic && (
                          <span
                            className="badge text-sm px-4 py-2 font-bold shadow-sm bg-base-200 text-base-content/90 border-base-300 whitespace-nowrap"
                          >
                            {selectedCase.topic}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Employee Roles */}
            {(() => {
              // Helper to check if a role value is valid (not null, undefined, empty, or '---')
              const isValidRole = (role: string | number | null | undefined): boolean => {
                if (role === null || role === undefined) return false;
                // Handle both string and number IDs
                if (typeof role === 'number') return role > 0;
                const roleStr = String(role).trim();
                return roleStr !== '' && roleStr !== '---' && roleStr !== '--' && roleStr !== 'Not assigned' && roleStr !== 'Unassigned' && roleStr !== '0';
              };

              const hasCloser = isValidRole(selectedCase.closer);
              const hasHandler = isValidRole(selectedCase.handler);
              const hasExpert = isValidRole(selectedCase.expert);
              const hasScheduler = isValidRole(selectedCase.scheduler);

              // Debug: Log role validation
              console.log('🔍 CaseDetailsPage - Role validation:', {
                closer: { value: selectedCase.closer, valid: hasCloser },
                handler: { value: selectedCase.handler, valid: hasHandler },
                expert: { value: selectedCase.expert, valid: hasExpert },
                scheduler: { value: selectedCase.scheduler, valid: hasScheduler },
              });

              console.log('🔍 CaseDetailsPage - Rendering roles section');

              return (
                <div className="flex items-center gap-6 flex-wrap justify-end">
                  {hasCloser && (
                    <div className="flex items-center gap-2">
                      <EmployeeAvatar employeeId={selectedCase.closer} size="md" />
                      <div className="flex flex-col">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Closer</p>
                        <p className="font-medium text-sm leading-5">{getEmployeeDisplayName(selectedCase.closer)}</p>
                      </div>
                    </div>
                  )}
                  {hasHandler && (
                    <div className="flex items-center gap-2">
                      <EmployeeAvatar employeeId={selectedCase.handler} size="md" />
                      <div className="flex flex-col">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Handler</p>
                        <p className="font-medium text-sm leading-5">{getEmployeeDisplayName(selectedCase.handler)}</p>
                      </div>
                    </div>
                  )}
                  {hasExpert && (
                    <div className="flex items-center gap-2">
                      <EmployeeAvatar employeeId={selectedCase.expert} size="md" />
                      <div className="flex flex-col">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Expert</p>
                        <p className="font-medium text-sm leading-5">{getEmployeeDisplayName(selectedCase.expert)}</p>
                      </div>
                    </div>
                  )}
                  {hasScheduler && (
                    <div className="flex items-center gap-2">
                      <EmployeeAvatar employeeId={selectedCase.scheduler} size="md" />
                      <div className="flex flex-col">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Scheduler</p>
                        <p className="font-medium text-sm leading-5">{getEmployeeDisplayName(selectedCase.scheduler)}</p>
                      </div>
                    </div>
                  )}

                  {/* Actions Dropdown */}
                  <div className="dropdown dropdown-end">
                    <label tabIndex={0} className="btn btn-outline btn-square bg-white text-gray-700 hover:bg-gray-50 border-gray-200 shadow-sm">
                      <EllipsisVerticalIcon className="w-5 h-5" />
                    </label>
                    <ul tabIndex={0} className="dropdown-content z-[100] menu p-2 shadow-2xl bg-base-100 rounded-box w-72 mb-2 border border-base-200 mt-2">
                      {/* Activation/Spam Toggle */}
                      {(() => {
                        const isLegacy = selectedCase.lead_type === 'legacy' || selectedCase.id?.toString().startsWith('legacy_');
                        const isUnactivated = isLegacy
                          ? false // Legacy leads don't have status field in HandlerLead interface, skip for now
                          : false; // New leads status check would go here
                        return isUnactivated ? (
                          <li><a className="text-green-600 font-medium" onClick={handleActivation}><CheckCircleIcon className="w-4 h-4" /> Activate Case</a></li>
                        ) : (
                          <li><a className="text-red-600 font-medium" onClick={() => setShowUnactivationModal(true)}><NoSymbolIcon className="w-4 h-4" /> Deactivate / Spam</a></li>
                        );
                      })()}

                      {/* Highlights Toggle */}
                      <li>
                        <a onClick={async () => {
                          if (!selectedCase?.id) return;
                          const isLegacyLead = selectedCase.lead_type === 'legacy' || selectedCase.id?.toString().startsWith('legacy_');
                          const leadId = isLegacyLead
                            ? (typeof selectedCase.id === 'string' ? parseInt(selectedCase.id.replace('legacy_', '')) : selectedCase.id)
                            : selectedCase.id;
                          const leadNumber = selectedCase.lead_number || selectedCase.id?.toString();

                          if (isInHighlightsState) {
                            await removeFromHighlights(leadId, isLegacyLead);
                            setIsInHighlightsState(false);
                          } else {
                            await addToHighlights(leadId, leadNumber, isLegacyLead);
                            setIsInHighlightsState(true);
                          }
                          (document.activeElement as HTMLElement | null)?.blur();
                        }}>
                          {isInHighlightsState ? (
                            <><StarIcon className="w-4 h-4 fill-current text-purple-600" /> Remove from Highlights</>
                          ) : (
                            <><StarIcon className="w-4 h-4" /> Add to Highlights</>
                          )}
                        </a>
                      </li>

                      <div className="divider my-1"></div>

                      {/* Edit / Sub-Lead */}
                      <li><a onClick={() => { openEditLeadDrawer(); (document.activeElement as HTMLElement)?.blur(); }}><PencilSquareIcon className="w-4 h-4" /> Edit Details</a></li>
                      <li><a onClick={() => { setShowSubLeadDrawer(true); (document.activeElement as HTMLElement)?.blur(); }}><Squares2X2Icon className="w-4 h-4" /> Create Sub-Lead</a></li>

                      {/* Delete (Superuser only) */}
                      {isSuperuser && (
                        <>
                          <div className="divider my-1"></div>
                          <li><a className="text-red-600 hover:bg-red-50" onClick={() => { setShowDeleteModal(true); (document.activeElement as HTMLElement)?.blur(); }}><TrashIcon className="w-4 h-4" /> Delete Lead</a></li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Stage Buttons Bar - Similar to ClientHeader.tsx */}
        {selectedCase && (() => {
          const currentStageName = getStageName(String(selectedCase.stage));
          const isLegacy = selectedCase.lead_type === 'legacy' || selectedCase.id?.toString().startsWith('legacy_');
          const isUnactivated = isLegacy
            ? false // Legacy leads don't have status field in HandlerLead interface, skip for now
            : false; // New leads status check would go here
          const isStageNumeric = !isNaN(Number(selectedCase.stage));
          const stageNumeric = isStageNumeric ? Number(selectedCase.stage) : null;

          // Don't show buttons if case is unactivated
          if (isUnactivated) {
            return (
              <div className="mb-6 flex justify-end">
                <div className="px-4 py-2 text-sm text-gray-600">
                  Please activate lead in actions first to see the stage buttons.
                </div>
              </div>
            );
          }

          // Check if case is closed - show "No action available" message
          if (areStagesEquivalent(currentStageName, 'Case Closed')) {
            return (
              <div className="mb-6 flex justify-end">
                <div className="px-4 py-2 text-sm text-gray-600">
                  No action available
                </div>
              </div>
            );
          }

          // Payment badge component
          const paymentBadge = nextDuePayment && (() => {
            // Use dueDate from the stored payment (date for legacy, due_date for new)
            const dueDate = new Date(nextDuePayment.dueDate || nextDuePayment.date || nextDuePayment.due_date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            dueDate.setHours(0, 0, 0, 0);
            const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            // Get currency symbol
            let currencySymbol = '₪';
            if (nextDuePayment.isLegacy) {
              const currency = nextDuePayment.accounting_currencies;
              if (currency?.iso_code) {
                switch (currency.iso_code) {
                  case 'ILS': currencySymbol = '₪'; break;
                  case 'EUR': currencySymbol = '€'; break;
                  case 'USD': currencySymbol = '$'; break;
                  case 'GBP': currencySymbol = '£'; break;
                  default: currencySymbol = currency.iso_code;
                }
              }
            } else {
              if (nextDuePayment.currency) {
                switch (nextDuePayment.currency) {
                  case 'NIS': case 'ILS': currencySymbol = '₪'; break;
                  case 'EUR': currencySymbol = '€'; break;
                  case 'USD': currencySymbol = '$'; break;
                  case 'GBP': currencySymbol = '£'; break;
                  default: currencySymbol = nextDuePayment.currency;
                }
              }
            }

            // Get payment amount
            const amount = nextDuePayment.isLegacy
              ? (nextDuePayment.value || 0)
              : (nextDuePayment.value || nextDuePayment.value_vat || 0);

            // Format date
            const formattedDate = dueDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            });

            // Determine badge color based on days until due
            let badgeColor = 'bg-blue-500';
            if (daysUntilDue < 0) {
              badgeColor = 'bg-red-500';
            } else if (daysUntilDue === 0) {
              badgeColor = 'bg-orange-500';
            } else if (daysUntilDue === 1) {
              badgeColor = 'bg-yellow-500';
            }

            // Format days text
            let daysText = '';
            if (daysUntilDue < 0) {
              daysText = `Overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? 's' : ''}`;
            } else if (daysUntilDue === 0) {
              daysText = 'Due Today';
            } else if (daysUntilDue === 1) {
              daysText = 'Due Tomorrow';
            } else {
              daysText = `Due in ${daysUntilDue} days`;
            }

            return (
              <div className={`${badgeColor} text-white px-6 py-3 rounded-full shadow-lg flex flex-col items-center gap-1`}>
                <div className="flex items-center gap-3">
                  <CurrencyDollarIcon className="w-5 h-5" />
                  <span className="font-semibold">
                    Next Payment: {currencySymbol}{amount.toLocaleString()} ({formattedDate})
                  </span>
                </div>
                <div className="text-sm font-medium">
                  {daysText}
                </div>
              </div>
            );
          })();

          return (
            <div className="mb-6 flex items-center gap-3 flex-wrap">
              {/* Left side - Empty spacer */}
              <div className="flex-1"></div>

              {/* Center - Payment Badge */}
              <div className="flex-1 flex justify-center">
                {paymentBadge}
              </div>

              {/* Right side - Stage buttons */}
              <div className="flex items-center gap-3 flex-wrap flex-1 justify-end">
                {/* Handler Set Stage */}
                {areStagesEquivalent(currentStageName, 'Handler Set') && (
                  <button
                    onClick={handleStartCase}
                    className="btn btn-primary rounded-full px-6 shadow-lg shadow-indigo-100 hover:shadow-indigo-200 text-white gap-2 text-base transition-all hover:scale-105"
                  >
                    <PlayIcon className="w-5 h-5" />
                    Start Case
                  </button>
                )}

                {/* Handler Started Stage */}
                {areStagesEquivalent(currentStageName, 'Handler Started') && (
                  <>
                    <button
                      onClick={() => updateLeadStage('Application submitted')}
                      className="btn btn-success text-white rounded-full px-5 shadow-lg shadow-green-100 hover:shadow-green-200 gap-2 transition-all hover:scale-105"
                    >
                      <DocumentCheckIcon className="w-5 h-5" />
                      Application Submitted
                    </button>
                    <button
                      onClick={() => updateLeadStage('Case Closed')}
                      className="btn btn-neutral rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                    >
                      <CheckCircleIcon className="w-5 h-5" />
                      Close Case
                    </button>
                  </>
                )}

                {/* Application submitted Stage */}
                {areStagesEquivalent(currentStageName, 'Application submitted') && (
                  <button
                    onClick={() => updateLeadStage('Case Closed')}
                    className="btn btn-neutral rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                  >
                    <CheckCircleIcon className="w-5 h-5" />
                    Close Case
                  </button>
                )}

                {/* Payment request sent Stage */}
                {areStagesEquivalent(currentStageName, 'payment_request_sent') && (
                  <button
                    onClick={() => updateLeadStage('finances_and_payments_plan')}
                    className="btn btn-success text-white rounded-full px-5 shadow-lg shadow-green-100 hover:shadow-green-200 gap-2 transition-all hover:scale-105"
                  >
                    <CheckCircleIcon className="w-5 h-5" />
                    Payment Received - new Client !!!
                  </button>
                )}

                {/* Another meeting Stage */}
                {areStagesEquivalent(currentStageName, 'another_meeting') && (
                  <button
                    onClick={() => updateLeadStage('Meeting Ended')}
                    className="btn btn-neutral rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                  >
                    <CheckCircleIcon className="w-5 h-5" />
                    Meeting Ended
                  </button>
                )}

                {/* Meeting scheduled / Meeting rescheduling Stages */}
                {!areStagesEquivalent(currentStageName, 'another_meeting') &&
                  (areStagesEquivalent(currentStageName, 'meeting_scheduled') ||
                    areStagesEquivalent(currentStageName, 'Meeting rescheduling') ||
                    (isStageNumeric && (stageNumeric === 55 || stageNumeric === 21))) && (
                    <>
                      {!areStagesEquivalent(currentStageName, 'meeting_scheduled') &&
                        !areStagesEquivalent(currentStageName, 'Meeting rescheduling') && (
                          <button
                            onClick={() => {
                              // Open schedule meeting - would need to implement this
                              toast.success('Schedule meeting functionality coming soon');
                            }}
                            className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                          >
                            <CalendarDaysIcon className="w-5 h-5" />
                            Schedule Meeting
                          </button>
                        )}
                      <button
                        onClick={() => updateLeadStage('Meeting Ended')}
                        className="btn btn-neutral rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                      >
                        <CheckCircleIcon className="w-5 h-5" />
                        Meeting Ended
                      </button>
                    </>
                  )}

                {/* Waiting for meeting summary Stage */}
                {areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') && (
                  <button
                    onClick={() => {
                      // Open send offer modal - would need to implement this
                      toast.success('Send price offer functionality coming soon');
                    }}
                    className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                  >
                    <DocumentCheckIcon className="w-5 h-5" />
                    Send Price Offer
                  </button>
                )}

                {/* Communication Started Stage */}
                {areStagesEquivalent(currentStageName, 'Communication started') && (
                  <button
                    onClick={() => {
                      // Open schedule meeting - would need to implement this
                      toast.success('Schedule meeting functionality coming soon');
                    }}
                    className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                  >
                    <CalendarDaysIcon className="w-5 h-5" />
                    Schedule Meeting
                  </button>
                )}

                {/* Meeting summary + Agreement sent Stage */}
                {areStagesEquivalent(currentStageName, 'Mtng sum+Agreement sent') && (
                  <>
                    <button
                      onClick={() => {
                        // Open schedule meeting - would need to implement this
                        toast.success('Schedule meeting functionality coming soon');
                      }}
                      className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                    >
                      <CalendarDaysIcon className="w-5 h-5" />
                      Schedule Meeting
                    </button>
                    <button
                      onClick={() => {
                        // Open signed drawer - would need to implement this
                        toast.success('Client signed functionality coming soon');
                      }}
                      className="btn btn-success text-white rounded-full px-5 shadow-lg shadow-green-100 hover:shadow-green-200 gap-2 transition-all hover:scale-105"
                    >
                      <HandThumbUpIcon className="w-5 h-5" />
                      Client signed
                    </button>
                    <button
                      onClick={() => {
                        // Open declined drawer - would need to implement this
                        toast.success('Client declined functionality coming soon');
                      }}
                      className="btn btn-error text-white rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                    >
                      <HandThumbDownIcon className="w-5 h-5" />
                      Client declined
                    </button>
                    <button
                      onClick={() => {
                        // Open send offer modal - would need to implement this
                        toast.success('Revised price offer functionality coming soon');
                      }}
                      className="btn btn-outline rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                    >
                      <PencilSquareIcon className="w-5 h-5" />
                      Revised price offer
                    </button>
                  </>
                )}

                {/* Client signed agreement Stage */}
                {(areStagesEquivalent(currentStageName, 'Client signed agreement') ||
                  areStagesEquivalent(currentStageName, 'client signed agreement') ||
                  areStagesEquivalent(currentStageName, 'client_signed')) && (
                    <button
                      onClick={() => updateLeadStage('payment_request_sent')}
                      className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                    >
                      <CurrencyDollarIcon className="w-5 h-5" />
                      Payment request sent
                    </button>
                  )}

                {/* General stages - Schedule Meeting and Communication Started */}
                {selectedCase &&
                  !areStagesEquivalent(currentStageName, 'Handler Set') &&
                  !areStagesEquivalent(currentStageName, 'Handler Started') &&
                  !areStagesEquivalent(currentStageName, 'Application submitted') &&
                  !areStagesEquivalent(currentStageName, 'payment_request_sent') &&
                  !areStagesEquivalent(currentStageName, 'another_meeting') &&
                  !areStagesEquivalent(currentStageName, 'meeting_scheduled') &&
                  !areStagesEquivalent(currentStageName, 'Meeting rescheduling') &&
                  !areStagesEquivalent(currentStageName, 'waiting_for_mtng_sum') &&
                  !areStagesEquivalent(currentStageName, 'Communication started') &&
                  !areStagesEquivalent(currentStageName, 'Mtng sum+Agreement sent') &&
                  !areStagesEquivalent(currentStageName, 'Success') &&
                  !areStagesEquivalent(currentStageName, 'handler_assigned') &&
                  !areStagesEquivalent(currentStageName, 'client_signed') &&
                  !areStagesEquivalent(currentStageName, 'client signed agreement') &&
                  !areStagesEquivalent(currentStageName, 'Client signed agreement') &&
                  !(isStageNumeric && (stageNumeric === 21 || stageNumeric === 55)) && (
                    <>
                      <button
                        onClick={() => {
                          // Open schedule meeting - would need to implement this
                          toast.success('Schedule meeting functionality coming soon');
                        }}
                        className="btn btn-primary rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                      >
                        <CalendarDaysIcon className="w-5 h-5" />
                        Schedule Meeting
                      </button>
                      <button
                        onClick={() => updateLeadStage('Communication Started')}
                        className="btn btn-outline rounded-full px-5 shadow-lg gap-2 transition-all hover:scale-105"
                      >
                        <ChatBubbleLeftRightIcon className="w-5 h-5" />
                        Communication Started
                      </button>
                    </>
                  )}
              </div>
            </div>
          );
        })()}

        {/* Tab Content */}
        <div className="w-full bg-white dark:bg-gray-900 min-h-screen">
          <div className="p-2 sm:p-4 md:p-6 lg:p-8 xl:p-12 pb-6 md:pb-6 mb-4 md:mb-0 pb-24">
            {renderTabContent()}
          </div>
        </div>
      </div>

      {/* Tab Navigation - Bottom Oval Box (Desktop) */}
      <div className="hidden lg:block fixed bottom-0 left-0 right-0 z-50 pb-safe" style={{ zIndex: 50 }}>
        <div className="flex justify-center px-4 pb-4">
          {isTabBarCollapsed ? (
            // Collapsed state: Single circle with active tab icon
            <button
              onClick={() => setIsTabBarCollapsed(false)}
              className="bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full shadow-2xl border-2 border-white/20 w-14 h-14 flex items-center justify-center transition-all duration-500 ease-in-out hover:scale-110"
              title="Click to expand"
              style={{
                animation: 'fadeInScale 0.5s ease-in-out'
              }}
            >
              <div className="relative">
                {(() => {
                  const activeTabData = tabs.find(tab => tab.id === activeTab);
                  const ActiveIcon = activeTabData?.icon || InformationCircleIcon;
                  return <ActiveIcon className="w-6 h-6" style={{ animation: 'fadeInScale 0.5s ease-in-out 0.1s both' }} />;
                })()}
              </div>
            </button>
          ) : (
            // Expanded state: Full tab bar
            <div className="flex items-center gap-2">
              <div
                ref={desktopTabsRef}
                className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-full shadow-2xl border-2 border-white/20 dark:border-gray-700/20 px-4 py-3 overflow-x-auto scrollbar-hide transition-all duration-500 ease-in-out"
                style={{
                  borderRadius: '9999px',
                  maxWidth: '95vw',
                  animation: 'fadeInScale 0.5s ease-in-out'
                }}
              >
                <div className="flex items-center gap-2" style={{ scrollBehavior: 'smooth' }}>
                  {tabs.map((tab, index) => (
                    <button
                      key={tab.id}
                      className={`relative flex flex-col items-center justify-center gap-1 px-4 py-3 rounded-full font-semibold text-sm transition-all duration-300 whitespace-nowrap flex-shrink-0 ${activeTab === tab.id
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50/50 dark:hover:bg-gray-700/50'
                        }`}
                      style={{
                        animation: `fadeInSlide 0.4s ease-out ${index * 0.05}s both`
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveTab(tab.id);
                      }}
                    >
                      <div className="relative">
                        <tab.icon className={`w-5 h-5 flex-shrink-0 ${activeTab === tab.id ? 'text-white' : 'text-gray-500'}`} />
                      </div>
                      <span className={`font-bold text-xs ${activeTab === tab.id ? 'text-white' : 'text-gray-600'}`}>{tab.label}</span>
                      {activeTab === tab.id && (
                        <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white dark:bg-gray-800 rounded-full shadow-lg"></div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Right collapse button */}
              <button
                onClick={() => setIsTabBarCollapsed(true)}
                className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-full shadow-lg border-2 border-white/20 dark:border-gray-700/20 w-10 h-10 flex items-center justify-center transition-all duration-300 hover:scale-110 hover:bg-white/90 dark:hover:bg-gray-700/90"
                title="Collapse tab bar"
                style={{
                  animation: 'fadeInScale 0.4s ease-out 0.1s both'
                }}
              >
                <ChevronDownIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation - Bottom Oval Box (Mobile) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 pb-safe">
        <div className="flex justify-center px-4 pb-4">
          <div className="bg-white dark:bg-gray-800 rounded-full shadow-2xl border-2 border-gray-200 dark:border-gray-700 px-3 py-3 overflow-x-auto scrollbar-hide" style={{ borderRadius: '9999px', maxWidth: '95vw' }}>
            <div className="flex items-center gap-2" style={{ scrollBehavior: 'smooth' }}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`relative flex flex-col items-center justify-center gap-1 px-4 py-3 rounded-full font-semibold text-sm transition-all duration-300 whitespace-nowrap flex-shrink-0 ${activeTab === tab.id
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <div className="relative">
                    <tab.icon className={`w-5 h-5 flex-shrink-0 ${activeTab === tab.id ? 'text-white' : 'text-gray-500'}`} />
                  </div>
                  <span className={`font-bold text-xs ${activeTab === tab.id ? 'text-white' : 'text-gray-600'}`}>{tab.label}</span>
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
  );
};

export default CaseDetailsPage;
