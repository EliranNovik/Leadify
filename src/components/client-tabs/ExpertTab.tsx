import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ClientTabProps } from '../../types/client';
import {
  AcademicCapIcon,
  ShareIcon,
  PencilSquareIcon,
  DocumentArrowUpIcon,
  PaperClipIcon,
  HashtagIcon,
  CheckIcon,
  XMarkIcon,
  ClockIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  XCircleIcon,
  SparklesIcon,
  ArrowPathIcon,
  ArrowsPointingOutIcon,
  Squares2X2Icon,
  DocumentTextIcon,
  CpuChipIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { FolderIcon } from '@heroicons/react/24/solid';
import { supabase } from '../../lib/supabase';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  fetchPublicUserId,
  fetchFlagTypes,
  fetchLeadFieldFlagsForLead,
  setLeadFieldFlagged,
  setLegacyLeadFieldFlagged,
  type ContentFlagMeta,
  type FlagTypeRow,
} from '../../lib/userContentFlags';
import FlagTypeFlagButton from '../FlagTypeFlagButton';
import DocumentModal from '../DocumentModal';
import ExpertNotesModal from '../ExpertNotesModal';
import { toast } from 'react-hot-toast';
import { buildCaseDocumentStoragePath, CASE_DOCUMENTS_STORAGE_BUCKET } from '../../lib/caseDocumentsStorage';

interface UploadedFile {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

interface Note {
  id: string;
  content: string;
  timestamp: string;
  edited_by?: string;
  edited_at?: string;
}

interface EligibilityOption {
  value: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  color: string;
}

interface EligibilityStatus {
  value: string;
  timestamp: string;
}

type OneDriveFileItem = {
  id: string;
  name: string;
  webUrl?: string;
  downloadUrl?: string;
  lastModifiedDateTime?: string;
  size?: number;
  file?: { mimeType?: string };
};

// Helper to detect Hebrew (RTL) vs English (LTR) for text direction
const getTextDirection = (text: string): 'rtl' | 'ltr' => {
  if (!text || !text.trim()) return 'ltr';
  const hebrewRegex = /[\u0590-\u05FF]/;
  return hebrewRegex.test(text) ? 'rtl' : 'ltr';
};

const formatBytes = (bytes?: number): string => {
  const b = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0;
  if (b <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

// Safe date formatter - returns empty string for invalid dates to avoid "Invalid Date"
const safeFormatDate = (dateVal: string | number | Date | undefined | null): string => {
  if (dateVal == null) return '';
  if (dateVal instanceof Date) {
    return Number.isNaN(dateVal.getTime()) ? '' : dateVal.toLocaleString();
  }
  if (typeof dateVal === 'number') {
    const d = new Date(dateVal);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  }
  const str = String(dateVal).trim();
  if (!str) return '';
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
};

const ExpertTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  // Helper function to clean up text formatting
  const formatNoteText = (text: string): string => {
    if (!text) return '';

    // Replace \r\n with \n, then \r with \n for proper line breaks
    // Also handle escaped \r characters (\\r)
    const cleaned = text
      .replace(/\\r\\n/g, '\n')  // Handle escaped \r\n
      .replace(/\\r/g, '\n')     // Handle escaped \r
      .replace(/\r\n/g, '\n')    // Handle actual \r\n
      .replace(/\r/g, '\n')      // Handle actual \r
      .trim();

    return cleaned;
  };

  // Function to clean up existing notes in the database
  const cleanupExistingNotes = async () => {
    if (!client.expert_notes || client.expert_notes.length === 0) return;

    const hasUncleanNotes = client.expert_notes.some((note: any) =>
      note.content && (note.content.includes('\r') || note.content.includes('\\r'))
    );

    if (hasUncleanNotes) {
      const cleanedNotes = client.expert_notes.map((note: any) => ({
        ...note,
        content: formatNoteText(note.content)
      }));

      setExpertNotes(cleanedNotes);

      // Save cleaned notes back to database
      // Check if this is a legacy lead
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

      if (isLegacyLead) {
        // For legacy leads, save to leads_lead table using the actual integer ID
        const legacyIdStr = client.id.toString().replace('legacy_', '');
        const legacyId = parseInt(legacyIdStr, 10);

        if (!isNaN(legacyId)) {
          await supabase
            .from('leads_lead')
            .update({ expert_notes: cleanedNotes })
            .eq('id', legacyId);
        }
      } else {
        // For new leads, save to leads table
        await supabase
          .from('leads')
          .update({ expert_notes: cleanedNotes })
          .eq('id', client.id);
      }

      if (onClientUpdate) await onClientUpdate();
    }
  };

  // Helper function to get current user's full name
  const getCurrentUserName = async (): Promise<string> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return 'Unknown';

      // Get user's full name from users table
      const { data: userData, error } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (error || !userData?.full_name) {
        return user?.email || 'Unknown';
      }

      return userData.full_name;
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'Unknown';
    }
  };



  // Helper function to get expert name from expert_id
  const getExpertName = async (expertId: string | number): Promise<string> => {
    if (!expertId) return '--';

    try {
      // Try to get expert name from tenants_employee table
      const { data: employeeData, error: employeeError } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', expertId)
        .single();

      if (!employeeError && employeeData?.display_name) {
        return employeeData.display_name;
      }

      // If not found in tenants_employee, try employees table as fallback
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('employees')
        .select('full_name')
        .eq('id', expertId)
        .single();

      if (!fallbackError && fallbackData?.full_name) {
        return fallbackData.full_name;
      }

      // If not found in either table, return the ID as string
      return String(expertId);
    } catch (error) {
      console.error('Error getting expert name:', error);
      return String(expertId);
    }
  };

  // Helper function to fetch legacy expert data
  const fetchLegacyExpertData = async () => {
    if (!client.id || !client.id.toString().startsWith('legacy_')) return;

    try {
      const legacyIdStr = client.id.toString().replace('legacy_', '');
      const legacyId = parseInt(legacyIdStr, 10);
      if (isNaN(legacyId)) return;

      const { data: legacyData, error } = await supabase
        .from('leads_lead')
        .select('expert_id, expert_opinion, expert_notes')
        .eq('id', legacyId)
        .single();

      if (error) {
        console.error('Error fetching legacy expert data:', error);
        return;
      }

      if (legacyData) {
        // Get expert name from expert_id
        const expertName = await getExpertName(legacyData.expert_id);

        // Update the expert name state
        setExpertName(expertName);

        // Add expert_opinion to expert notes if it exists - use DB expert_notes, not client
        if (legacyData.expert_opinion && legacyData.expert_opinion.trim()) {
          const existingNotes = Array.isArray(legacyData.expert_notes) ? legacyData.expert_notes : [];
          const hasExpertOpinion = existingNotes.some((note: any) =>
            note?.content && (note.content.includes('Expert Opinion:') || note.content.includes(legacyData.expert_opinion))
          );

          if (!hasExpertOpinion) {
            const expertOpinionNote = {
              id: `legacy_opinion_${Date.now()}`,
              content: `Expert Opinion: ${formatNoteText(legacyData.expert_opinion)}`,
              timestamp: new Date().toISOString()
            };

            const updatedNotes = [...existingNotes, expertOpinionNote];
            setExpertNotes(updatedNotes);

            await supabase
              .from('leads_lead')
              .update({ expert_notes: updatedNotes })
              .eq('id', legacyId);
          }
        }

        // Update client expert name if it's different
        if (expertName !== client.expert) {
          client.expert = expertName;
          if (onClientUpdate) await onClientUpdate();
        }
      }
    } catch (error) {
      console.error('Error in fetchLegacyExpertData:', error);
    }
  };

  // Function to fetch tracking information and update notes
  const fetchTrackingInfo = async () => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const tableName = isLegacyLead ? 'leads_lead' : 'leads';
    const recordId = isLegacyLead ? client.id.toString().replace('legacy_', '') : client.id;

    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('expert_notes_last_edited_by, expert_notes_last_edited_at, handler_notes_last_edited_by, handler_notes_last_edited_at')
        .eq('id', recordId)
        .single();

      if (error) {
        return;
      }

      // Update section-level tracking for footer display
      if (data.expert_notes_last_edited_by) setExpertNotesLastEditedBy(data.expert_notes_last_edited_by);
      if (data.expert_notes_last_edited_at) setExpertNotesLastEditedAt(data.expert_notes_last_edited_at);
      if (data.handler_notes_last_edited_by) setHandlerNotesLastEditedBy(data.handler_notes_last_edited_by);
      if (data.handler_notes_last_edited_at) setHandlerNotesLastEditedAt(data.handler_notes_last_edited_at);

      // Update expert notes with tracking info if available
      if (data.expert_notes_last_edited_by && expertNotes.length > 0) {
        const updatedExpertNotes = expertNotes.map(note => ({
          ...note,
          edited_by: note.edited_by || data.expert_notes_last_edited_by,
          edited_at: note.edited_at || data.expert_notes_last_edited_at
        }));
        setExpertNotes(updatedExpertNotes);
      }

      // Update handler notes with tracking info if available
      if (data.handler_notes_last_edited_by && handlerNotes.length > 0) {
        const updatedHandlerNotes = handlerNotes.map(note => ({
          ...note,
          edited_by: note.edited_by || data.handler_notes_last_edited_by,
          edited_at: note.edited_at || data.handler_notes_last_edited_at
        }));
        setHandlerNotes(updatedHandlerNotes);
      }
    } catch (error) {
      // Silent error handling
    }
  };

  // Function to fetch docs_url for legacy leads
  const fetchDocsUrl = async (): Promise<string | null> => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    if (isLegacyLead) {
      try {
        const legacyId = client.id.toString().replace('legacy_', '');
        const { data, error } = await supabase
          .from('leads_lead')
          .select('docs_url')
          .eq('id', legacyId)
          .single();

        if (error) {
          return null;
        }

        if (data && data.docs_url) {
          setDocsUrl(data.docs_url);
          return String(data.docs_url);
        }
      } catch (error) {
        // Silent error handling
      }
    }
    return null;
  };

  // Function to fetch the assigned expert (legacy + new leads)
  const fetchAssignedExpert = async () => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    if (isLegacyLead) {
      try {
        const legacyId = client.id.toString().replace('legacy_', '');
        const { data, error } = await supabase
          .from('leads_lead')
          .select('expert_id')
          .eq('id', legacyId)
          .single();

        if (error) {
          console.error('Error fetching expert_id:', error);
          setExpertName('--');
          return;
        }

        if (data && data.expert_id) {
          const resolvedName = await getExpertName(data.expert_id);
          setExpertName(resolvedName || '--');
        } else {
          setExpertName('--');
        }
      } catch (error) {
        console.error('Error in fetchAssignedExpert (legacy):', error);
        setExpertName('--');
      }
    } else {
      try {
        const expertIdentifier = client.expert_id || client.expert;
        if (!expertIdentifier) {
          setExpertName('--');
          return;
        }

        const resolvedName = await getExpertName(expertIdentifier);
        setExpertName(resolvedName || '--');
      } catch (error) {
        console.error('Error in fetchAssignedExpert (new lead):', error);
        setExpertName(client.expert || '--');
      }
    }
  };

  // Function to fetch eligibility data for legacy leads
  // Note: This function is defined before state declarations, but it's fine because
  // it's only called in useEffect which runs after render when state exists
  const fetchLegacyEligibilityData = async () => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    if (!isLegacyLead) {
      return;
    }

    try {
      const legacyId = client.id.toString().replace('legacy_', '');

      const { data, error } = await supabase
        .from('leads_lead')
        .select('expert_examination, section_eligibility, eligibilty_date, section_eligibility_last_edited_by, section_eligibility_last_edited_at, eligibility_status, eligibility_status_timestamp')
        .eq('id', legacyId)
        .single();

      if (error) {
        return;
      }

      if (data) {
        // Priority: Use eligibility_status if it exists, otherwise map from expert_examination
        let eligibilityValue = '';
        let eligibilityTimestamp = '';

        // First, try to use eligibility_status column (like new leads)
        if (data.eligibility_status) {
          eligibilityValue = data.eligibility_status;
          eligibilityTimestamp = data.eligibility_status_timestamp || data.eligibilty_date || new Date().toISOString();
        } else {
          // Fallback: Map expert_examination to eligibility status (legacy behavior)
          // Convert to number for comparison since it might come as string from database
          const examValue = Number(data.expert_examination);
          if (examValue === 8) {
            eligibilityValue = 'feasible_no_check';
          } else if (examValue === 1) {
            eligibilityValue = 'not_feasible';
          } else if (examValue === 5) {
            eligibilityValue = 'feasible_check';
          }
          eligibilityTimestamp = data.eligibilty_date || new Date().toISOString();
        }

        // Update eligibility status (always set, even if empty, to ensure state is updated)
        setEligibilityStatus({
          value: eligibilityValue,
          timestamp: eligibilityTimestamp
        });

        // Update section eligibility (optional for legacy leads, can be null)
        setSelectedSection(data.section_eligibility || '');

        // Update section eligibility tracking info
        if (data.section_eligibility_last_edited_by) {
          setSectionEligibilityLastEditedBy(data.section_eligibility_last_edited_by);
        }
        if (data.section_eligibility_last_edited_at) {
          setSectionEligibilityLastEditedAt(data.section_eligibility_last_edited_at);
        }
      }
    } catch (error) {
      // Silent error handling
    }
  };

  // Fetch current user's superuser status and employee ID
  useEffect(() => {
    const fetchCurrentUserInfo = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          setIsSuperuser(false);
          setCurrentUserEmployeeId(null);
          return;
        }

        // Try to find user by auth_id first
        let { data: userData, error } = await supabase
          .from('users')
          .select('is_superuser, employee_id, tenants_employee!employee_id(display_name)')
          .eq('auth_id', user.id)
          .maybeSingle();

        // If not found by auth_id, try by email
        if (!userData && user.email) {
          const { data: userByEmail, error: emailError } = await supabase
            .from('users')
            .select('is_superuser, employee_id, tenants_employee!employee_id(display_name)')
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

          // Set employee ID
          if (userData.employee_id && typeof userData.employee_id === 'number') {
            setCurrentUserEmployeeId(userData.employee_id);
          } else {
            setCurrentUserEmployeeId(null);
          }

          // Set display name from employee relationship
          if (userData.tenants_employee) {
            const employee = Array.isArray(userData.tenants_employee)
              ? userData.tenants_employee[0]
              : userData.tenants_employee;
            if (employee && employee.display_name) {
              setCurrentUserDisplayName(employee.display_name);
            } else {
              setCurrentUserDisplayName(null);
            }
          } else {
            setCurrentUserDisplayName(null);
          }
        } else {
          setIsSuperuser(false);
          setCurrentUserEmployeeId(null);
          setCurrentUserDisplayName(null);
        }
      } catch (error) {
        console.error('Error fetching current user info:', error);
        setIsSuperuser(false);
        setCurrentUserEmployeeId(null);
      }
    };

    fetchCurrentUserInfo();
  }, []);

  // Fetch assigned expert ID and display name
  // Based on RolesTab: 
  // - Legacy leads: expert stored in 'expert_id' column (employee ID)
  // - New leads: expert stored in 'expert' column (employee ID, not display_name)
  useEffect(() => {
    const fetchAssignedExpert = async () => {
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

      if (isLegacyLead) {
        try {
          const legacyId = client.id.toString().replace('legacy_', '');
          const { data, error } = await supabase
            .from('leads_lead')
            .select('expert_id')
            .eq('id', legacyId)
            .single();

          if (!error && data && data.expert_id) {
            const expertIdNum = typeof data.expert_id === 'string' ? parseInt(data.expert_id, 10) : Number(data.expert_id);
            if (!isNaN(expertIdNum)) {
              setAssignedExpertId(expertIdNum);
              // Get display name from employee ID
              const expertName = await getExpertName(expertIdNum);
              setAssignedExpertDisplayName(expertName !== '--' ? expertName : null);
            } else {
              setAssignedExpertId(null);
              setAssignedExpertDisplayName(null);
            }
          } else {
            setAssignedExpertId(null);
            setAssignedExpertDisplayName(null);
          }
        } catch (error) {
          console.error('Error fetching assigned expert (legacy):', error);
          setAssignedExpertId(null);
          setAssignedExpertDisplayName(null);
        }
      } else {
        // For new leads, expert is stored in 'expert' column as employee ID (number)
        try {
          const { data, error } = await supabase
            .from('leads')
            .select('expert')
            .eq('id', client.id)
            .single();

          if (!error && data && data.expert) {
            // Expert is stored as employee ID (number) in 'expert' column for new leads
            const expertIdNum = typeof data.expert === 'string' ? parseInt(data.expert, 10) : Number(data.expert);
            if (!isNaN(expertIdNum)) {
              setAssignedExpertId(expertIdNum);
              // Get display name from employee ID
              const expertName = await getExpertName(expertIdNum);
              setAssignedExpertDisplayName(expertName !== '--' ? expertName : null);
            } else {
              setAssignedExpertId(null);
              setAssignedExpertDisplayName(null);
            }
          } else {
            setAssignedExpertId(null);
            setAssignedExpertDisplayName(null);
          }
        } catch (error) {
          console.error('Error fetching assigned expert (new lead):', error);
          setAssignedExpertId(null);
          setAssignedExpertDisplayName(null);
        }
      }
    };

    fetchAssignedExpert();
  }, [client.id, client.lead_type, client.expert]);

  // Fetch notes from database on component mount and when client.id changes
  const fetchNotesFromDatabase = async () => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    if (isLegacyLead) {
      const legacyIdStr = client.id.toString().replace('legacy_', '');
      const legacyId = parseInt(legacyIdStr, 10);

      if (!isNaN(legacyId)) {
        try {
          const { data, error } = await supabase
            .from('leads_lead')
            .select('expert_notes, handler_notes')
            .eq('id', legacyId)
            .single();

          if (!error && data) {
            setExpertNotes(Array.isArray(data.expert_notes) ? data.expert_notes : []);
            setHandlerNotes(Array.isArray(data.handler_notes) ? data.handler_notes : []);
          }
        } catch (error) {
          console.error('Error fetching notes from database:', error);
        }
      }
    } else {
      // For new leads, fetch from leads table
      try {
        const { data, error } = await supabase
          .from('leads')
          .select('expert_notes, handler_notes')
          .eq('id', client.id)
          .single();

        if (!error && data) {
          setExpertNotes(Array.isArray(data.expert_notes) ? data.expert_notes : []);
          setHandlerNotes(Array.isArray(data.handler_notes) ? data.handler_notes : []);
        }
      } catch (error) {
        console.error('Error fetching notes from database (new leads):', error);
      }
    }
  };

  // Section & eligibility - Initialize for new leads, legacy leads will be fetched
  // MUST be declared BEFORE useEffect hooks that use them
  const isLegacyForInit = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
  const [selectedSection, setSelectedSection] = useState(isLegacyForInit ? '' : (client.section_eligibility || ''));
  const [eligibilityStatus, setEligibilityStatus] = useState<EligibilityStatus>({
    value: isLegacyForInit ? '' : (client.eligibility_status || ''),
    timestamp: isLegacyForInit ? '' : (client.eligibility_status_timestamp || '')
  });
  const [sectionEligibilityLastEditedBy, setSectionEligibilityLastEditedBy] = useState<string | null>(null);
  const [sectionEligibilityLastEditedAt, setSectionEligibilityLastEditedAt] = useState<string | null>(null);
  const [expertNotesLastEditedBy, setExpertNotesLastEditedBy] = useState<string | null>(null);
  const [expertNotesLastEditedAt, setExpertNotesLastEditedAt] = useState<string | null>(null);
  const [handlerNotesLastEditedBy, setHandlerNotesLastEditedBy] = useState<string | null>(null);
  const [handlerNotesLastEditedAt, setHandlerNotesLastEditedAt] = useState<string | null>(null);

  // AI Summary state - MUST be declared before useEffect hooks that use them
  const [showAISummary, setShowAISummary] = useState(false);
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [savedAiSummary, setSavedAiSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [useSavedSummary, setUseSavedSummary] = useState(false);

  // Helper function to create a formatted summary when AI is unavailable
  const createFormattedSummary = (text: string): string => {
    const lines = text.split('\n').filter(line => line.trim());
    let summary = `📋 Lead Summary for ${client.name || 'Client'}\n`;
    if (client.lead_number) {
      summary += `Lead #${client.lead_number}\n`;
    }
    summary += `${'='.repeat(50)}\n\n`;

    // Parse and format the sections
    const sections: { [key: string]: string[] } = {};
    let currentSection = '';

    lines.forEach(line => {
      if (line.includes('Special Notes:') || line.includes('General Notes:') ||
        line.includes('Facts of Case:') || line.includes('Manager Notes:')) {
        currentSection = line.replace(':', '').trim();
        sections[currentSection] = [];
      } else if (currentSection && line.trim() && !line.includes('No ')) {
        sections[currentSection].push(line.trim());
      }
    });

    Object.entries(sections).forEach(([section, content]) => {
      if (content.length > 0) {
        summary += `\n${section}:\n`;
        content.forEach(item => {
          summary += `  • ${item}\n`;
        });
      }
    });

    return summary;
  };

  // Function to generate AI summary
  const generateAISummary = async () => {
    setIsGeneratingSummary(true);
    setAiSummary('');
    let combinedText = '';

    try {
      // Debug: Log individual field data
      console.log('🔍 [AI Summary Debug] Field Data:', {
        specialNotes: {
          length: summaryData.specialNotes?.length || 0,
          preview: summaryData.specialNotes?.substring(0, 100) || 'empty',
          isEmpty: !summaryData.specialNotes || summaryData.specialNotes.trim().length === 0
        },
        generalNotes: {
          length: summaryData.generalNotes?.length || 0,
          preview: summaryData.generalNotes?.substring(0, 100) || 'empty',
          isEmpty: !summaryData.generalNotes || summaryData.generalNotes.trim().length === 0
        },
        facts: {
          length: summaryData.facts?.length || 0,
          preview: summaryData.facts?.substring(0, 100) || 'empty',
          isEmpty: !summaryData.facts || summaryData.facts.trim().length === 0
        },
        managerNotes: {
          length: summaryData.managerNotes?.length || 0,
          preview: summaryData.managerNotes?.substring(0, 100) || 'empty',
          isEmpty: !summaryData.managerNotes || summaryData.managerNotes.trim().length === 0
        }
      });

      // Combine all the summary fields
      combinedText = `
Special Notes:
${summaryData.specialNotes || 'No special notes'}

General Notes:
${summaryData.generalNotes || 'No general notes'}

Facts of Case:
${summaryData.facts || 'No facts available'}

Manager Notes:
${summaryData.managerNotes || 'No manager notes'}
      `.trim();

      // Debug: Log combined text info
      const combinedLength = combinedText.length;
      const nonEmptyLength = combinedText.replace(/No (special notes|general notes|facts available|manager notes)/g, '').trim().length;

      console.log('🔍 [AI Summary Debug] Combined Text:', {
        totalLength: combinedLength,
        nonEmptyLength: nonEmptyLength,
        preview: combinedText.substring(0, 200),
        hasContent: nonEmptyLength > 0,
        estimatedTokens: Math.ceil(combinedLength / 4) // Rough estimate: 1 token ≈ 4 characters
      });

      if (!combinedText || nonEmptyLength === 0) {
        console.warn('⚠️ [AI Summary Debug] No content available to summarize');
        toast.error('No content available to summarize');
        setIsGeneratingSummary(false);
        return;
      }

      // Warn if content is very long (might cause issues)
      if (combinedLength > 10000) {
        console.warn('⚠️ [AI Summary Debug] Content is very long:', combinedLength, 'characters. This might cause rate limiting.');
      }

      // Try to use Supabase function first
      try {
        const requestBody = {
          content: combinedText,
          leadNumber: client.lead_number,
          clientName: client.name
        };

        console.log('🔍 [AI Summary Debug] Calling Supabase function with:', {
          contentLength: combinedText.length,
          leadNumber: client.lead_number,
          clientName: client.name,
          estimatedTokens: Math.ceil(combinedText.length / 4)
        });

        const { data, error } = await supabase.functions.invoke('ai-lead-summary', {
          body: requestBody
        });

        console.log('🔍 [AI Summary Debug] Supabase function response:', {
          hasError: !!error,
          error: error ? {
            message: error.message,
            code: (error as any).code,
            details: error
          } : null,
          hasData: !!data,
          dataKeys: data ? Object.keys(data) : [],
          summaryLength: data?.summary?.length || 0
        });

        if (!error && data?.summary) {
          console.log('✅ [AI Summary Debug] Successfully received AI summary');
          const generatedSummary = data.summary;
          setAiSummary(generatedSummary);
          setShowAISummary(true);
          setIsGeneratingSummary(false);
          // Save to database
          await saveAiSummaryToDatabase(generatedSummary);
          return;
        }

        // If there's an error from the function, check if it's a rate limit or quota
        if (error) {
          const errorMessage = error.message || '';
          const errorCode = (error as any).code || '';

          console.error('❌ [AI Summary Debug] Supabase function error:', {
            message: errorMessage,
            code: errorCode,
            fullError: error
          });

          // Check for quota errors
          if (errorMessage.includes('quota') || errorMessage.includes('billing') || errorCode === 'QUOTA_EXCEEDED') {
            console.warn('⚠️ [AI Summary Debug] Quota exceeded detected from Supabase function');
            toast.error('AI service quota exceeded. Showing formatted summary instead.');
            const fallbackSummary = createFormattedSummary(combinedText);
            setAiSummary(fallbackSummary);
            setShowAISummary(true);
            setIsGeneratingSummary(false);
            return;
          }

          // Check for rate limit errors
          if (errorMessage.includes('429') || errorMessage.includes('rate limit') || errorCode === 'RATE_LIMIT') {
            console.warn('⚠️ [AI Summary Debug] Rate limit detected from Supabase function');
            toast.error('AI service rate limit reached. Showing formatted summary instead.');
            // Show fallback formatted summary
            const fallbackSummary = createFormattedSummary(combinedText);
            setAiSummary(fallbackSummary);
            setShowAISummary(true);
            setIsGeneratingSummary(false);
            return;
          }
        }

        // If function returned an error response with status 429
        if (data?.code === 'QUOTA_EXCEEDED') {
          console.warn('⚠️ [AI Summary Debug] Quota exceeded in response data');
          toast.error('AI service quota exceeded. Showing formatted summary instead.');
          const fallbackSummary = createFormattedSummary(combinedText);
          setAiSummary(fallbackSummary);
          setShowAISummary(true);
          setIsGeneratingSummary(false);
          return;
        }

        if (data?.code === 'RATE_LIMIT' || data?.status === 429) {
          console.warn('⚠️ [AI Summary Debug] Rate limit in response data');
          toast.error('AI service rate limit reached. Showing formatted summary instead.');
          const fallbackSummary = createFormattedSummary(combinedText);
          setAiSummary(fallbackSummary);
          setShowAISummary(true);
          setIsGeneratingSummary(false);
          return;
        }
      } catch (functionError: any) {
        console.error('❌ [AI Summary Debug] Supabase function exception:', {
          message: functionError.message,
          stack: functionError.stack,
          fullError: functionError
        });
        // Continue to fallback methods
      }

      // Fallback: Direct OpenAI call (if API key is available in env)
      const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
      if (OPENAI_API_KEY) {
        const prompt = `You are a professional legal CRM assistant. Create a comprehensive, unified summary of the following lead information.

IMPORTANT FORMATTING REQUIREMENTS:
- Write in clean, plain text with paragraphs
- Do NOT use markdown formatting (no **, no *, no #, no -)
- Do NOT use bullet points or lists in the main summary
- Do NOT separate information by field names (no "Special Notes:", "General Notes:", etc.)
- Combine all information into one flowing, natural narrative
- Use paragraph breaks (double line breaks) to separate different topics naturally
- Write as a cohesive story that weaves together all the information
- Be clear, professional, and organized

STRUCTURE:
1. First, write a unified summary that combines all the information (special notes, general notes, facts, manager notes) into one flowing narrative. Do not mention field names - just naturally incorporate all the information.

2. At the end, add a section titled "Actionable Insights:" followed by specific recommendations. This section can use bullet points or numbered items for clarity.

Lead Information:
${combinedText}`;

        const requestBody = {
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are an expert legal CRM assistant. Create clear, concise summaries. Always write in clean, plain text paragraphs without any markdown formatting, bullet points, or special characters.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.4,
        };

        console.log('🔍 [AI Summary Debug] Calling OpenAI directly:', {
          promptLength: prompt.length,
          estimatedPromptTokens: Math.ceil(prompt.length / 4),
          maxTokens: requestBody.max_tokens,
          model: requestBody.model
        });

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        console.log('🔍 [AI Summary Debug] OpenAI response status:', response.status, response.statusText);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
          const errorType = errorData.error?.type || '';
          const errorCode = errorData.error?.code || '';

          console.error('❌ [AI Summary Debug] OpenAI API error:', {
            status: response.status,
            statusText: response.statusText,
            errorMessage: errorMessage,
            errorType: errorType,
            errorCode: errorCode,
            errorData: errorData,
            rateLimitInfo: errorData.error?.type === 'rate_limit_error' ? {
              retryAfter: response.headers.get('retry-after'),
              limit: errorData.error?.limit,
              remaining: errorData.error?.remaining
            } : null,
            quotaInfo: errorMessage.includes('quota') || errorMessage.includes('billing') ? {
              isQuotaError: true,
              message: errorMessage
            } : null
          });

          // Handle quota/billing errors specifically
          if (response.status === 429) {
            const isQuotaError = errorMessage.toLowerCase().includes('quota') ||
              errorMessage.toLowerCase().includes('billing') ||
              errorMessage.toLowerCase().includes('exceeded');

            if (isQuotaError) {
              console.warn('⚠️ [AI Summary Debug] Quota/billing limit exceeded');
              toast.error('AI service quota exceeded. Please check billing or use the individual fields view. Showing formatted summary instead.');
              // Show fallback formatted summary
              const fallbackSummary = createFormattedSummary(combinedText);
              setAiSummary(fallbackSummary);
              setShowAISummary(true);
              setIsGeneratingSummary(false);
              return;
            }

            // Regular rate limit (not quota)
            const retryAfter = response.headers.get('retry-after');
            console.warn('⚠️ [AI Summary Debug] Rate limit hit. Retry after:', retryAfter, 'seconds');
            toast.error(`AI service is currently busy. Please wait a moment and try again, or use the individual fields view.${retryAfter ? ` (Retry after ${retryAfter}s)` : ''}`);
            setIsGeneratingSummary(false);
            return;
          }

          throw new Error(`OpenAI API error: ${response.status} - ${errorMessage}`);
        }

        const data = await response.json();
        let summary = data.choices?.[0]?.message?.content || 'Unable to generate summary';

        // Clean up any markdown formatting that might have slipped through
        // But preserve bullet points in the "Actionable Insights" section
        const actionableInsightsMatch = summary.match(/Actionable Insights:[\s\S]*$/i);
        const mainSummary = actionableInsightsMatch ? summary.substring(0, summary.indexOf('Actionable Insights:')) : summary;
        const actionableInsights = actionableInsightsMatch ? actionableInsightsMatch[0] : '';

        // Clean main summary (no markdown, no bullets)
        let cleanedMain = mainSummary
          .replace(/\*\*/g, '') // Remove bold markdown
          .replace(/\*/g, '') // Remove italic markdown
          .replace(/#{1,6}\s+/g, '') // Remove headers
          .replace(/^[-*+]\s+/gm, '') // Remove bullet points at start of lines
          .replace(/^\d+\.\s+/gm, '') // Remove numbered lists
          .replace(/\n{3,}/g, '\n\n') // Normalize multiple line breaks to double
          .trim();

        // Clean actionable insights (allow bullets but remove markdown)
        let cleanedInsights = actionableInsights
          .replace(/\*\*/g, '') // Remove bold markdown
          .replace(/\*/g, '') // Remove italic markdown (but keep * for bullets if needed)
          .replace(/#{1,6}\s+/g, '') // Remove headers
          .replace(/\n{3,}/g, '\n\n') // Normalize multiple line breaks
          .trim();

        // Recombine
        summary = cleanedMain + (cleanedInsights ? '\n\n' + cleanedInsights : '');

        console.log('✅ [AI Summary Debug] Successfully received OpenAI summary:', {
          summaryLength: summary.length,
          tokensUsed: data.usage?.total_tokens || 'unknown'
        });
        setAiSummary(summary);
        setShowAISummary(true);
        // Save to database
        await saveAiSummaryToDatabase(summary);
      } else {
        // If no API key, show a simple formatted summary
        const simpleSummary = `Lead Summary for ${client.name || 'Client'}:\n\n${combinedText}`;
        setAiSummary(simpleSummary);
        setShowAISummary(true);
      }
    } catch (error: any) {
      console.error('❌ [AI Summary Debug] Final error catch:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        fullError: error
      });

      // If API fails, show a formatted fallback summary
      if (error.message?.includes('429') || error.message?.includes('rate limit')) {
        console.warn('⚠️ [AI Summary Debug] Rate limit in final catch');
        toast.error('AI service rate limit reached. Showing formatted summary instead.');
      } else {
        console.warn('⚠️ [AI Summary Debug] Other error, showing fallback');
        toast.error('AI summary unavailable. Showing formatted summary instead.');
      }

      // Fallback: Create a formatted summary
      const fallbackSummary = createFormattedSummary(combinedText);
      console.log('📋 [AI Summary Debug] Using fallback formatted summary');
      setAiSummary(fallbackSummary);
      setShowAISummary(true);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // Function to fetch saved AI summary from database
  const fetchSavedAiSummary = async () => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    // First check if client object already has the summary
    const aiSummaryFromClient = (client as any).ai_summary;
    if (aiSummaryFromClient) {
      setSavedAiSummary(aiSummaryFromClient);
      console.log('✅ [AI Summary] Loaded saved summary from client object');
      return;
    }

    try {
      if (isLegacyLead) {
        const legacyId = client.id.toString().replace('legacy_', '');
        const { data, error } = await supabase
          .from('leads_lead')
          .select('ai_summary')
          .eq('id', legacyId)
          .single();

        if (!error && data?.ai_summary) {
          setSavedAiSummary(data.ai_summary);
          console.log('✅ [AI Summary] Loaded saved summary from database (legacy)');
        }
      } else {
        const { data, error } = await supabase
          .from('leads')
          .select('ai_summary')
          .eq('id', client.id)
          .single();

        if (!error && data?.ai_summary) {
          setSavedAiSummary(data.ai_summary);
          console.log('✅ [AI Summary] Loaded saved summary from database (new lead)');
        }
      }
    } catch (error) {
      console.error('Error fetching saved AI summary:', error);
    }
  };

  // Function to save AI summary to database
  const saveAiSummaryToDatabase = async (summary: string) => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    try {
      if (isLegacyLead) {
        const legacyId = client.id.toString().replace('legacy_', '');
        const { error } = await supabase
          .from('leads_lead')
          .update({ ai_summary: summary })
          .eq('id', legacyId);

        if (error) {
          console.error('Error saving AI summary (legacy):', error);
          throw error;
        }
        console.log('✅ [AI Summary] Saved summary to database (legacy)');
      } else {
        const { error } = await supabase
          .from('leads')
          .update({ ai_summary: summary })
          .eq('id', client.id);

        if (error) {
          console.error('Error saving AI summary (new lead):', error);
          throw error;
        }
        console.log('✅ [AI Summary] Saved summary to database (new lead)');
      }

      // Update saved summary state
      setSavedAiSummary(summary);

      // Refresh client data
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error saving AI summary to database:', error);
      toast.error('Failed to save AI summary to database');
    }
  };

  // Function to fetch summary data
  const fetchSummaryData = async () => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    try {
      if (isLegacyLead) {
        // For legacy leads, try to use client data first, then fetch from database
        const specialNotes = (client as any).special_notes || '';
        const notes = (client as any).notes || '';
        const description = (client as any).description || '';
        const managementNotes = (client as any).management_notes || '';

        // If we have all data from client, use it; otherwise fetch from database
        if (specialNotes || notes || description || managementNotes) {
          setSummaryData({
            specialNotes: formatNoteText(specialNotes),
            generalNotes: formatNoteText(notes),
            facts: formatNoteText(description),
            managerNotes: formatNoteText(managementNotes)
          });
        } else {
          const legacyId = client.id.toString().replace('legacy_', '');
          const { data, error } = await supabase
            .from('leads_lead')
            .select('special_notes, notes, description, management_notes')
            .eq('id', legacyId)
            .single();

          if (!error && data) {
            setSummaryData({
              specialNotes: formatNoteText(data.special_notes || ''),
              generalNotes: formatNoteText(data.notes || ''),
              facts: formatNoteText(data.description || ''),
              managerNotes: formatNoteText(data.management_notes || '')
            });
          }
        }
      } else {
        // For new leads, try to use client data first, then fetch from database
        const specialNotes = client.special_notes || '';
        const generalNotes = client.general_notes || '';
        const facts = client.facts || '';
        const managerNotes = (client as any).manager_notes || '';

        // If we have all data from client, use it; otherwise fetch from database
        if (specialNotes || generalNotes || facts || managerNotes) {
          setSummaryData({
            specialNotes: formatNoteText(specialNotes),
            generalNotes: formatNoteText(generalNotes),
            facts: formatNoteText(facts),
            managerNotes: formatNoteText(managerNotes)
          });
        } else {
          const { data, error } = await supabase
            .from('leads')
            .select('special_notes, general_notes, facts, manager_notes')
            .eq('id', client.id)
            .single();

          if (!error && data) {
            setSummaryData({
              specialNotes: formatNoteText(data.special_notes || ''),
              generalNotes: formatNoteText(data.general_notes || ''),
              facts: formatNoteText(data.facts || ''),
              managerNotes: formatNoteText(data.manager_notes || '')
            });
          }
        }
      }
    } catch (error) {
      console.error('Error fetching summary data:', error);
    }
  };

  // Fetch legacy expert data on component mount
  useEffect(() => {
    const runFetches = async () => {
      setExpertNotesLastEditedBy(null);
      setExpertNotesLastEditedAt(null);
      setHandlerNotesLastEditedBy(null);
      setHandlerNotesLastEditedAt(null);
      // Fetch notes first so we have current data before fetchLegacyExpertData may add expert_opinion
      await fetchNotesFromDatabase();
      fetchLegacyExpertData();
      cleanupExistingNotes();
      fetchTrackingInfo();
      fetchDocsUrl();
      fetchAssignedExpert();
      fetchLegacyEligibilityData();
      fetchSummaryData();
      fetchSavedAiSummary();
    };
    runFetches();
  }, [client.id]);

  // Sync notes when client data changes (e.g., after refresh)
  // Only update if the client data is different from current state to avoid overwriting unsaved changes
  useEffect(() => {
    if (client.expert_notes && JSON.stringify(client.expert_notes) !== JSON.stringify(expertNotes)) {
      setExpertNotes(client.expert_notes);
    }
    if (client.handler_notes && JSON.stringify(client.handler_notes) !== JSON.stringify(handlerNotes)) {
      setHandlerNotes(client.handler_notes);
    }
  }, [client.expert_notes, client.handler_notes]);

  // Sync eligibility status and section for new leads when client data changes
  useEffect(() => {
    const isLegacy = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    if (!isLegacy) {
      // For new leads, sync from client data
      if (client.eligibility_status !== eligibilityStatus.value) {
        setEligibilityStatus({
          value: client.eligibility_status || '',
          timestamp: client.eligibility_status_timestamp || ''
        });
      }
      if (client.section_eligibility !== selectedSection) {
        setSelectedSection(client.section_eligibility || '');
      }
      // Sync section eligibility tracking info for new leads
      if (client.section_eligibility_last_edited_by !== undefined) {
        setSectionEligibilityLastEditedBy(client.section_eligibility_last_edited_by || null);
      }
      if (client.section_eligibility_last_edited_at !== undefined) {
        setSectionEligibilityLastEditedAt(client.section_eligibility_last_edited_at || null);
      }
    }
  }, [client.eligibility_status, client.eligibility_status_timestamp, client.section_eligibility, client.section_eligibility_last_edited_by, client.section_eligibility_last_edited_at]);

  // Refresh summary data when client updates
  useEffect(() => {
    fetchSummaryData();
  }, [
    (client as any).special_notes,
    (client as any).general_notes,
    (client as any).facts,
    (client as any).manager_notes,
    (client as any).notes,
    (client as any).description,
    (client as any).management_notes,
  ]);

  // Load saved AI summary when client.ai_summary changes
  useEffect(() => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const aiSummaryFromClient = (client as any).ai_summary;

    if (aiSummaryFromClient) {
      setSavedAiSummary(aiSummaryFromClient);
      // If we're in AI summary view and don't have a current summary, use the saved one
      if (showAISummary && !aiSummary) {
        setAiSummary(aiSummaryFromClient);
        setUseSavedSummary(true);
      }
    }
  }, [(client as any).ai_summary, showAISummary, aiSummary]);

  // Expert Notes
  const [expertNotes, setExpertNotes] = useState<Note[]>(client.expert_notes || []);
  const [isAddingExpertNote, setIsAddingExpertNote] = useState(false);
  const [editingExpertNoteId, setEditingExpertNoteId] = useState<string | null>(null);
  const [newExpertNoteContent, setNewExpertNoteContent] = useState('');
  const [isExpertNotesModalOpen, setIsExpertNotesModalOpen] = useState(false);

  // Handler Notes
  const [handlerNotes, setHandlerNotes] = useState<Note[]>(client.handler_notes || []);
  const [isAddingHandlerNote, setIsAddingHandlerNote] = useState(false);
  const [editingHandlerNoteId, setEditingHandlerNoteId] = useState<string | null>(null);
  const [newHandlerNoteContent, setNewHandlerNoteContent] = useState('');

  // File Upload State
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Document Modal State
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [documentCount, setDocumentCount] = useState<number>(0);
  const isFetchingCountRef = useRef(false); // Prevent duplicate fetches

  // Get docs_url for legacy leads (used for OneDrive folder resolution)
  const [docsUrl, setDocsUrl] = useState<string>('');
  const hasDocsUrl = !!docsUrl;

  // OneDrive legacy documents drawer (read-only)
  const [isOneDriveDrawerOpen, setIsOneDriveDrawerOpen] = useState(false);
  const [oneDriveFiles, setOneDriveFiles] = useState<OneDriveFileItem[]>([]);
  const [isLoadingOneDriveFiles, setIsLoadingOneDriveFiles] = useState(false);
  const [oneDriveFilesError, setOneDriveFilesError] = useState<string | null>(null);
  const [oneDriveQuery, setOneDriveQuery] = useState('');
  const [oneDriveDocumentCount, setOneDriveDocumentCount] = useState<number>(0);

  // Keep OneDrive count stable across tab switches (component remounts).
  useEffect(() => {
    if (!client?.lead_number) return;
    const key = `onedrive_doc_count:${client.lead_number}`;
    const cached = sessionStorage.getItem(key);
    if (cached != null) {
      const parsed = Number(cached);
      if (Number.isFinite(parsed)) setOneDriveDocumentCount(parsed);
    }
  }, [client?.lead_number]);

  // Case-documents "Expert" classification id (for uploads from this tab)
  const [expertCaseDocClassificationId, setExpertCaseDocClassificationId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from('case_document_classifications')
      .select('id')
      .eq('slug', 'expert')
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('case_document_classifications lookup (expert):', error.message);
          setExpertCaseDocClassificationId(null);
          return;
        }
        setExpertCaseDocClassificationId(data?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchOneDriveFiles = useCallback(async (folderUrlHint?: string) => {
    if (!client?.lead_number) return;
    setIsLoadingOneDriveFiles(true);
    setOneDriveFilesError(null);
    try {
      const folderUrl = String(folderUrlHint || (client as any).onedrive_folder_link || '').trim();
      const { data, error } = await supabase.functions.invoke('list-onedrive-files', {
        body: { leadNumber: client.lead_number, folderUrl: folderUrl || undefined },
      });

      if (error) throw new Error(error.message);
      if (data && data.success) {
        const files = (data.files || []) as OneDriveFileItem[];
        setOneDriveFiles(files);
        setOneDriveDocumentCount(files.length);
        try {
          sessionStorage.setItem(`onedrive_doc_count:${client.lead_number}`, String(files.length));
        } catch {
          // ignore
        }
      } else {
        if (data?.retryable) {
          // quick retry for transient OneDrive/Graph issues
          await new Promise((r) => setTimeout(r, 900));
          const { data: data2, error: error2 } = await supabase.functions.invoke('list-onedrive-files', {
            body: { leadNumber: client.lead_number, folderUrl: folderUrl || undefined },
          });
          if (!error2 && data2 && data2.success) {
            const files2 = (data2.files || []) as OneDriveFileItem[];
            setOneDriveFiles(files2);
            setOneDriveDocumentCount(files2.length);
            try {
              sessionStorage.setItem(`onedrive_doc_count:${client.lead_number}`, String(files2.length));
            } catch {
              // ignore
            }
            return;
          }
        }
        if (data?.error) setOneDriveFilesError(String(data.error));
      }
    } catch (e: any) {
      const msg = String(e?.message || 'Failed to load OneDrive documents');
      setOneDriveFilesError(msg);
    } finally {
      setIsLoadingOneDriveFiles(false);
    }
  }, [client?.lead_number, (client as any).onedrive_folder_link]);

  const openOneDriveDrawer = useCallback(async () => {
    setIsOneDriveDrawerOpen(true);

    const urlNow = (docsUrl || (client as any).onedrive_folder_link || '').trim();
    const fetched = !urlNow ? await fetchDocsUrl() : null;
    const finalUrl = String(fetched || urlNow || (client as any).onedrive_folder_link || '').trim();
    void fetchOneDriveFiles(finalUrl || undefined);
  }, [docsUrl, client, fetchOneDriveFiles]);

  const fetchOneDriveDocumentCount = useCallback(async (folderUrlHint?: string) => {
    if (!client?.lead_number) return;
    try {
      const folderUrl = String(folderUrlHint || (client as any).onedrive_folder_link || '').trim();
      const { data, error } = await supabase.functions.invoke('list-onedrive-files', {
        body: { leadNumber: client.lead_number, folderUrl: folderUrl || undefined },
      });
      if (error) return; // keep previous count on transient errors
      if (data && data.success) {
        const files = (data.files || []) as OneDriveFileItem[];
        setOneDriveDocumentCount(files.length);
        try {
          sessionStorage.setItem(`onedrive_doc_count:${client.lead_number}`, String(files.length));
        } catch {
          // ignore
        }
      } // else keep previous count (avoid flicker)
    } catch {
      // keep previous count (avoid flicker)
    }
  }, [client?.lead_number, (client as any).onedrive_folder_link]);

  useEffect(() => {
    void fetchOneDriveDocumentCount();
  }, [fetchOneDriveDocumentCount]);

  // Function to fetch document count - using useCallback to memoize
  const fetchDocumentCount = useCallback(async () => {
    if (!client.lead_number) {
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('list-lead-documents', {
        body: { leadNumber: client.lead_number }
      });

      if (error) {
        console.error('Error fetching document count:', error);
        setDocumentCount(0); // Set to 0 on error
        return;
      }

      if (data && data.success) {
        // The API returns a count field
        const count = data.count || (data.files ? data.files.length : 0);
        setDocumentCount(count);
      } else {
        setDocumentCount(0);
      }
    } catch (error) {
      console.error('Error fetching document count:', error);
      setDocumentCount(0); // Set to 0 on error
    }
  }, [client.lead_number]);

  // Fetch document count when lead_number is available
  useEffect(() => {
    // Skip if already fetching or no lead_number
    if (isFetchingCountRef.current || !client.lead_number) {
      return;
    }

    const fetchCount = async () => {
      isFetchingCountRef.current = true;

      try {
        const { data, error } = await supabase.functions.invoke('list-lead-documents', {
          body: { leadNumber: client.lead_number }
        });

        if (error) {
          console.error('Error fetching document count:', error);
          // Don't reset to 0 on error - keep previous count
          return;
        }

        if (data && data.success) {
          const count = data.count || (data.files ? data.files.length : 0);
          setDocumentCount(count);
        }
      } catch (error) {
        console.error('Error fetching document count:', error);
        // Don't reset to 0 on error - keep previous count
      } finally {
        isFetchingCountRef.current = false;
      }
    };

    fetchCount();
  }, [client.lead_number]);

  // Placeholder for document count and link
  const documentLink = client.onedrive_folder_link || '#';

  // Check if this is a legacy lead (used elsewhere in the component)
  const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
  const legacyLeadNumericId = isLegacyLead
    ? Number.parseInt(String(client.id).replace(/^legacy_/, ''), 10)
    : null;
  const newLeadUuidForFlags = !isLegacyLead && client.id != null ? String(client.id) : null;

  const { user } = useAuthContext();
  const authUserId = user?.id ?? null;
  const [publicUserId, setPublicUserId] = useState<string | null>(null);
  const [leadFieldFlagMeta, setLeadFieldFlagMeta] = useState<Map<string, ContentFlagMeta>>(() => new Map());
  const [flagTypes, setFlagTypes] = useState<FlagTypeRow[]>([]);

  useEffect(() => {
    if (!authUserId) {
      setPublicUserId(null);
      return;
    }
    let cancelled = false;
    void fetchPublicUserId(supabase, authUserId).then((id) => {
      if (!cancelled) setPublicUserId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  useEffect(() => {
    if (!publicUserId) {
      setLeadFieldFlagMeta(new Map());
      return;
    }
    let cancelled = false;
    void fetchLeadFieldFlagsForLead(supabase, publicUserId, {
      newLeadId: newLeadUuidForFlags || undefined,
      legacyLeadId:
        legacyLeadNumericId != null && !Number.isNaN(legacyLeadNumericId) ? legacyLeadNumericId : undefined,
    }).then((map) => {
      if (!cancelled) setLeadFieldFlagMeta(map);
    });
    return () => {
      cancelled = true;
    };
  }, [publicUserId, newLeadUuidForFlags, legacyLeadNumericId]);

  useEffect(() => {
    let cancelled = false;
    void fetchFlagTypes(supabase).then((rows) => {
      if (!cancelled) setFlagTypes(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const addLeadFieldFlag = useCallback(
    async (fieldKey: 'expert_notes' | 'handler_notes', flagTypeId: number) => {
      if (!publicUserId) {
        toast.error('Please sign in to flag items.');
        return;
      }
      if (isLegacyLead && legacyLeadNumericId != null && !Number.isNaN(legacyLeadNumericId)) {
        const { error } = await setLegacyLeadFieldFlagged(
          supabase,
          publicUserId,
          legacyLeadNumericId,
          fieldKey,
          true,
          flagTypeId
        );
        if (error) {
          toast.error(error.message);
          return;
        }
      } else if (newLeadUuidForFlags) {
        const { error } = await setLeadFieldFlagged(
          supabase,
          publicUserId,
          newLeadUuidForFlags,
          fieldKey,
          true,
          flagTypeId
        );
        if (error) {
          toast.error(error.message);
          return;
        }
      } else {
        toast.error('Unable to save flag for this lead.');
        return;
      }
      setLeadFieldFlagMeta((prev) => {
        const next = new Map(prev);
        next.set(fieldKey, { createdAt: new Date().toISOString(), flagTypeId });
        return next;
      });
    },
    [publicUserId, isLegacyLead, legacyLeadNumericId, newLeadUuidForFlags]
  );

  const removeLeadFieldFlag = useCallback(
    async (fieldKey: 'expert_notes' | 'handler_notes') => {
      if (!publicUserId) {
        toast.error('Please sign in to flag items.');
        return;
      }
      if (isLegacyLead && legacyLeadNumericId != null && !Number.isNaN(legacyLeadNumericId)) {
        const { error } = await setLegacyLeadFieldFlagged(
          supabase,
          publicUserId,
          legacyLeadNumericId,
          fieldKey,
          false
        );
        if (error) {
          toast.error(error.message);
          return;
        }
      } else if (newLeadUuidForFlags) {
        const { error } = await setLeadFieldFlagged(
          supabase,
          publicUserId,
          newLeadUuidForFlags,
          fieldKey,
          false
        );
        if (error) {
          toast.error(error.message);
          return;
        }
      } else {
        toast.error('Unable to save flag for this lead.');
        return;
      }
      setLeadFieldFlagMeta((prev) => {
        const next = new Map(prev);
        next.delete(fieldKey);
        return next;
      });
    },
    [publicUserId, isLegacyLead, legacyLeadNumericId, newLeadUuidForFlags]
  );

  // Expert name state
  const [expertName, setExpertName] = useState<string>(client.expert || '--');

  // Current user state
  const [isSuperuser, setIsSuperuser] = useState<boolean>(false);
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState<number | null>(null);
  const [currentUserDisplayName, setCurrentUserDisplayName] = useState<string | null>(null);
  const [assignedExpertId, setAssignedExpertId] = useState<number | null>(null);
  const [assignedExpertDisplayName, setAssignedExpertDisplayName] = useState<string | null>(null);

  // Summary data state
  const [summaryData, setSummaryData] = useState<{
    specialNotes: string;
    generalNotes: string;
    facts: string;
    managerNotes: string;
  }>({
    specialNotes: '',
    generalNotes: '',
    facts: '',
    managerNotes: ''
  });

  // Save section/eligibility to DB
  const handleSectionChange = async (value: string) => {
    setSelectedSection(value);

    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const currentUser = await getCurrentUserName();

    if (isLegacyLead) {
      // For legacy leads, save to leads_lead table using the actual integer ID
      const legacyId = client.id.toString().replace('legacy_', '');

      try {
        // First, try to update with tracking columns
        // section_eligibility can be null (empty string becomes null)
        const { error: updateError } = await supabase
          .from('leads_lead')
          .update({
            section_eligibility: value || null,
            section_eligibility_last_edited_by: currentUser,
            section_eligibility_last_edited_at: new Date().toISOString()
          })
          .eq('id', legacyId);

        if (updateError) {
          console.error('Error updating section eligibility with tracking (legacy):', updateError);

          // Fallback: try without tracking columns
          const { error: fallbackError } = await supabase
            .from('leads_lead')
            .update({ section_eligibility: value || null })
            .eq('id', legacyId);

          if (fallbackError) {
            console.error('Error updating section eligibility (fallback - legacy):', fallbackError);
            throw fallbackError;
          }
        } else {
          // Update local state with tracking info after successful save
          setSectionEligibilityLastEditedBy(currentUser);
          setSectionEligibilityLastEditedAt(new Date().toISOString());
        }
      } catch (error) {
        console.error('Error in handleSectionChange (legacy):', error);
        throw error;
      }
    } else {
      // For new leads, save to leads table with tracking
      try {
        const timestamp = new Date().toISOString();
        // First, try to update with tracking columns
        const { error: updateError } = await supabase
          .from('leads')
          .update({
            section_eligibility: value,
            section_eligibility_last_edited_by: currentUser,
            section_eligibility_last_edited_at: timestamp
          })
          .eq('id', client.id);

        if (updateError) {
          console.error('Error updating section eligibility with tracking (new leads):', updateError);

          // Fallback: try without tracking columns
          const { error: fallbackError } = await supabase
            .from('leads')
            .update({ section_eligibility: value })
            .eq('id', client.id);

          if (fallbackError) {
            console.error('Error updating section eligibility (fallback - new leads):', fallbackError);
            throw fallbackError;
          }
        } else {
          // Update local state with tracking info after successful save
          setSectionEligibilityLastEditedBy(currentUser);
          setSectionEligibilityLastEditedAt(timestamp);
        }
      } catch (error) {
        console.error('Error in handleSectionChange (new leads):', error);
        throw error;
      }
    }

    if (onClientUpdate) await onClientUpdate();
  };

  const handleEligibilityChange = async (newValue: string) => {
    const timestamp = new Date().toISOString();
    setEligibilityStatus({ value: newValue, timestamp });
    if (newValue === 'not_feasible') {
      setSelectedSection(''); // Clear section selection
    }

    // Only update expert assessment columns if this is the first time setting eligibility
    // or if the eligibility status is being changed from empty/null to a valid value
    const shouldUpdateExpertAssessment = !client.eligibility_status || client.eligibility_status === '';

    let updateData: any = {
      eligibility_status: newValue,
      eligibility_status_timestamp: timestamp,
      section_eligibility: newValue === 'not_feasible' ? '' : selectedSection
    };

    // Only update expert assessment columns when actually completing an assessment
    if (shouldUpdateExpertAssessment && newValue && newValue !== '') {
      const currentUser = await getCurrentUserName();

      updateData = {
        ...updateData,
        expert_eligibility_assessed: true,
        expert_eligibility_date: timestamp,
        expert_eligibility_assessed_by: currentUser
      };
    }

    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const currentUser = await getCurrentUserName();

    if (isLegacyLead) {
      // For legacy leads, save to leads_lead table using the actual integer ID
      const legacyId = client.id.toString().replace('legacy_', '');

      // Map eligibility status back to expert_examination value for legacy table
      let expertExaminationValue = null;
      if (newValue === 'feasible_no_check') {
        expertExaminationValue = 8;
      } else if (newValue === 'not_feasible') {
        expertExaminationValue = 1;
      } else if (newValue === 'feasible_check') {
        expertExaminationValue = 5;
      }

      // Prepare update data for legacy table
      const legacyUpdateData: any = {
        expert_examination: expertExaminationValue,
        eligibility_status: newValue, // Store eligibility_status directly (like new leads)
        eligibility_status_timestamp: timestamp, // Store eligibility_status_timestamp
        section_eligibility: newValue === 'not_feasible' ? '' : selectedSection,
        eligibilty_date: timestamp // Always update eligibilty_date when eligibility changes (legacy compatibility)
      };

      // Add tracking data if available
      if (shouldUpdateExpertAssessment && newValue && newValue !== '') {
        legacyUpdateData.expert_eligibility_assessed = true;
        legacyUpdateData.expert_eligibility_date = timestamp;
        legacyUpdateData.expert_eligibility_assessed_by = currentUser;
      }

      try {
        // First, try to update with tracking columns
        const { error: updateError } = await supabase
          .from('leads_lead')
          .update({
            ...legacyUpdateData,
            eligibility_status_last_edited_by: currentUser,
            eligibility_status_last_edited_at: new Date().toISOString()
          })
          .eq('id', legacyId);

        if (updateError) {
          console.error('Error updating eligibility status with tracking (legacy):', updateError);

          // Fallback: try without tracking columns
          const { error: fallbackError } = await supabase
            .from('leads_lead')
            .update(legacyUpdateData)
            .eq('id', legacyId);

          if (fallbackError) {
            console.error('Error updating eligibility status (fallback - legacy):', fallbackError);
            throw fallbackError;
          }
        }
      } catch (error) {
        console.error('Error in handleEligibilityChange (legacy):', error);
        throw error;
      }
    } else {
      // For new leads, save to leads table with tracking
      try {
        // First, try to update with tracking columns
        const { error: updateError } = await supabase
          .from('leads')
          .update({
            ...updateData,
            eligibility_status_last_edited_by: currentUser,
            eligibility_status_last_edited_at: new Date().toISOString()
          })
          .eq('id', client.id);

        if (updateError) {
          console.error('Error updating eligibility status with tracking (new leads):', updateError);

          // Fallback: try without tracking columns
          const { error: fallbackError } = await supabase
            .from('leads')
            .update(updateData)
            .eq('id', client.id);

          if (fallbackError) {
            console.error('Error updating eligibility status (fallback - new leads):', fallbackError);
            throw fallbackError;
          }
        }
      } catch (error) {
        console.error('Error in handleEligibilityChange (new leads):', error);
        throw error;
      }
    }

    if (onClientUpdate) await onClientUpdate();
  };

  // Save expert notes to DB
  const handleSaveExpertNotes = async (notes: Note[]) => {
    setExpertNotes(notes);

    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const currentUser = await getCurrentUserName();

    if (isLegacyLead) {
      // For legacy leads, save to leads_lead table using the actual integer ID
      const legacyIdStr = client.id.toString().replace('legacy_', '');
      const legacyId = parseInt(legacyIdStr, 10);

      if (isNaN(legacyId)) {
        console.error('Invalid legacy ID:', legacyIdStr);
        throw new Error('Invalid legacy ID');
      }

      try {

        // First, try to update with tracking columns
        const { data, error: updateError } = await supabase
          .from('leads_lead')
          .update({
            expert_notes: notes,
            expert_notes_last_edited_by: currentUser,
            expert_notes_last_edited_at: new Date().toISOString()
          })
          .eq('id', legacyId)
          .select('expert_notes')
          .single();

        if (updateError) {
          console.error('❌ Error updating expert notes with tracking:', updateError);

          // Fallback: try without tracking columns
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('leads_lead')
            .update({ expert_notes: notes })
            .eq('id', legacyId)
            .select('expert_notes')
            .single();

          if (fallbackError) {
            console.error('❌ Error updating expert notes (fallback):', fallbackError);
            throw fallbackError;
          }

          // Update local state with what was saved
          if (fallbackData?.expert_notes) {
            setExpertNotes(fallbackData.expert_notes);
          }
        } else {

          // Update local state with what was saved
          if (data?.expert_notes) {
            setExpertNotes(data.expert_notes);
          }
        }

        // Fetch the saved data to ensure it's persisted (separate query)
        const { data: verifyData, error: verifyError } = await supabase
          .from('leads_lead')
          .select('expert_notes')
          .eq('id', legacyId)
          .single();

        if (verifyError) {
          // Don't throw - the update might have succeeded even if verification fails
        } else if (verifyData) {
          // Update local state with verified data
          if (verifyData.expert_notes) {
            setExpertNotes(verifyData.expert_notes);
          }
        }
      } catch (error) {
        console.error('Error in handleSaveExpertNotes:', error);
        throw error;
      }

      // Refresh client data to ensure notes are synced
      if (onClientUpdate) {
        await onClientUpdate();
      }

      // Also fetch notes directly from database to ensure we have the latest
      await fetchNotesFromDatabase();
    } else {
      // For new leads, save to leads table with tracking
      try {
        // First, try to update with tracking columns
        const { data, error: updateError } = await supabase
          .from('leads')
          .update({
            expert_notes: notes,
            expert_notes_last_edited_by: currentUser,
            expert_notes_last_edited_at: new Date().toISOString()
          })
          .eq('id', client.id)
          .select('expert_notes')
          .single();

        if (updateError) {
          console.error('❌ Error updating expert notes with tracking (new leads):', updateError);

          // Fallback: try without tracking columns
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('leads')
            .update({ expert_notes: notes })
            .eq('id', client.id)
            .select('expert_notes')
            .single();

          if (fallbackError) {
            console.error('❌ Error updating expert notes (fallback - new leads):', fallbackError);
            throw fallbackError;
          }

          // Update local state with what was saved
          if (fallbackData?.expert_notes) {
            setExpertNotes(fallbackData.expert_notes);
          }
        } else {
          // Update local state with what was saved
          if (data?.expert_notes) {
            setExpertNotes(data.expert_notes);
          }
        }

        // Fetch the saved data to ensure it's persisted (separate query)
        const { data: verifyData, error: verifyError } = await supabase
          .from('leads')
          .select('expert_notes')
          .eq('id', client.id)
          .single();

        if (verifyError) {
          // Don't throw - the update might have succeeded even if verification fails
          console.warn('Warning: Could not verify expert notes save (new leads):', verifyError);
        } else if (verifyData) {
          // Update local state with verified data
          if (verifyData.expert_notes) {
            setExpertNotes(verifyData.expert_notes);
          }
        }
      } catch (error) {
        console.error('Error in handleSaveExpertNotes (new leads):', error);
        throw error;
      }

      // Refresh client data to ensure notes are synced
      if (onClientUpdate) {
        await onClientUpdate();
      }

      // Also fetch notes directly from database to ensure we have the latest
      await fetchNotesFromDatabase();
    }
  };

  // Save handler notes to DB
  const handleSaveHandlerNotes = async (notes: Note[]) => {
    setHandlerNotes(notes);

    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const currentUser = await getCurrentUserName();

    if (isLegacyLead) {
      // For legacy leads, save to leads_lead table using the actual integer ID
      const legacyIdStr = client.id.toString().replace('legacy_', '');
      const legacyId = parseInt(legacyIdStr, 10);

      if (isNaN(legacyId)) {
        console.error('Invalid legacy ID:', legacyIdStr);
        throw new Error('Invalid legacy ID');
      }

      try {

        // First, try to update with tracking columns
        const { data, error: updateError } = await supabase
          .from('leads_lead')
          .update({
            handler_notes: notes,
            handler_notes_last_edited_by: currentUser,
            handler_notes_last_edited_at: new Date().toISOString()
          })
          .eq('id', legacyId)
          .select('handler_notes')
          .single();

        if (updateError) {
          console.error('❌ Error updating handler notes with tracking:', updateError);

          // Fallback: try without tracking columns
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('leads_lead')
            .update({ handler_notes: notes })
            .eq('id', legacyId)
            .select('handler_notes')
            .single();

          if (fallbackError) {
            console.error('❌ Error updating handler notes (fallback):', fallbackError);
            throw fallbackError;
          }

          // Update local state with what was saved
          if (fallbackData?.handler_notes) {
            setHandlerNotes(fallbackData.handler_notes);
          }
        } else {

          // Update local state with what was saved
          if (data?.handler_notes) {
            setHandlerNotes(data.handler_notes);
          }
        }

        // Fetch the saved data to ensure it's persisted (separate query)
        const { data: verifyData, error: verifyError } = await supabase
          .from('leads_lead')
          .select('handler_notes')
          .eq('id', legacyId)
          .single();

        if (verifyError) {
          // Don't throw - the update might have succeeded even if verification fails
        } else if (verifyData) {
          // Update local state with verified data
          if (verifyData.handler_notes) {
            setHandlerNotes(verifyData.handler_notes);
          }
        }
      } catch (error) {
        console.error('Error in handleSaveHandlerNotes:', error);
        throw error;
      }

      // Refresh client data to ensure notes are synced
      if (onClientUpdate) {
        await onClientUpdate();
      }

      // Also fetch notes directly from database to ensure we have the latest
      await fetchNotesFromDatabase();
    } else {
      // For new leads, save to leads table with tracking
      try {
        // First, try to update with tracking columns
        const { data, error: updateError } = await supabase
          .from('leads')
          .update({
            handler_notes: notes,
            handler_notes_last_edited_by: currentUser,
            handler_notes_last_edited_at: new Date().toISOString()
          })
          .eq('id', client.id)
          .select('handler_notes')
          .single();

        if (updateError) {
          console.error('❌ Error updating handler notes with tracking (new leads):', updateError);

          // Fallback: try without tracking columns
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('leads')
            .update({ handler_notes: notes })
            .eq('id', client.id)
            .select('handler_notes')
            .single();

          if (fallbackError) {
            console.error('❌ Error updating handler notes (fallback - new leads):', fallbackError);
            throw fallbackError;
          }

          // Update local state with what was saved
          if (fallbackData?.handler_notes) {
            setHandlerNotes(fallbackData.handler_notes);
          }
        } else {
          // Update local state with what was saved
          if (data?.handler_notes) {
            setHandlerNotes(data.handler_notes);
          }
        }

        // Fetch the saved data to ensure it's persisted (separate query)
        const { data: verifyData, error: verifyError } = await supabase
          .from('leads')
          .select('handler_notes')
          .eq('id', client.id)
          .single();

        if (verifyError) {
          // Don't throw - the update might have succeeded even if verification fails
          console.warn('Warning: Could not verify handler notes save (new leads):', verifyError);
        } else if (verifyData) {
          // Update local state with verified data
          if (verifyData.handler_notes) {
            setHandlerNotes(verifyData.handler_notes);
          }
        }
      } catch (error) {
        console.error('Error in handleSaveHandlerNotes (new leads):', error);
        throw error;
      }

      // Refresh client data to ensure notes are synced
      if (onClientUpdate) {
        await onClientUpdate();
      }

      // Also fetch notes directly from database to ensure we have the latest
      await fetchNotesFromDatabase();
    }
  };

  // Expert Notes logic
  const handleSaveExpertNote = async () => {
    try {
      let updatedNotes;
      const cleanedContent = formatNoteText(newExpertNoteContent);
      const currentUser = await getCurrentUserName();
      const currentTime = new Date().toLocaleString();

      if (editingExpertNoteId) {
        updatedNotes = expertNotes.map(note =>
          note.id === editingExpertNoteId
            ? { ...note, content: cleanedContent, edited_by: currentUser, edited_at: currentTime }
            : note
        );
        setEditingExpertNoteId(null);
      } else {
        const newNote: Note = {
          id: Date.now().toString(),
          content: cleanedContent,
          timestamp: currentTime,
          edited_by: currentUser,
          edited_at: currentTime
        };
        updatedNotes = [...expertNotes, newNote];
        setIsAddingExpertNote(false);
      }
      setNewExpertNoteContent('');
      await handleSaveExpertNotes(updatedNotes);
      toast.success('Expert note saved successfully');
    } catch (error) {
      console.error('Error saving expert note:', error);
      toast.error('Failed to save expert note');
    }
  };

  const handleEditExpertNote = (note: Note) => {
    setEditingExpertNoteId(note.id);
    setNewExpertNoteContent(formatNoteText(note.content));
  };

  const handleCancelExpertEdit = () => {
    setEditingExpertNoteId(null);
    setNewExpertNoteContent('');
    setIsAddingExpertNote(false);
  };

  // Handler Notes logic
  const handleSaveHandlerNote = async () => {
    try {
      let updatedNotes;
      const cleanedContent = formatNoteText(newHandlerNoteContent);
      const currentUser = await getCurrentUserName();
      const currentTime = new Date().toLocaleString();

      if (editingHandlerNoteId) {
        updatedNotes = handlerNotes.map(note =>
          note.id === editingHandlerNoteId
            ? { ...note, content: cleanedContent, edited_by: currentUser, edited_at: currentTime }
            : note
        );
        setEditingHandlerNoteId(null);
      } else {
        const newNote: Note = {
          id: Date.now().toString(),
          content: cleanedContent,
          timestamp: currentTime,
          edited_by: currentUser,
          edited_at: currentTime
        };
        updatedNotes = [...handlerNotes, newNote];
        setIsAddingHandlerNote(false);
      }
      setNewHandlerNoteContent('');
      await handleSaveHandlerNotes(updatedNotes);
      toast.success('Handler note saved successfully');
    } catch (error) {
      console.error('Error saving handler note:', error);
      toast.error('Failed to save handler note');
    }
  };

  const handleEditHandlerNote = (note: Note) => {
    setEditingHandlerNoteId(note.id);
    setNewHandlerNoteContent(formatNoteText(note.content));
  };

  const handleCancelHandlerEdit = () => {
    setEditingHandlerNoteId(null);
    setNewHandlerNoteContent('');
    setIsAddingHandlerNote(false);
  };

  // Handle file drop
  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await uploadFiles(Array.from(files));
    }
  };

  // Handle file input change
  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      await uploadFiles(Array.from(files));
    }
    // Reset input so the same file can be selected again (matches DocumentModal)
    e.target.value = '';
  };

  // The main upload function
  const uploadFiles = async (files: File[]) => {
    setIsUploading(true);
    const newUploads = files.map(file => ({ name: file.name, status: 'uploading' as const, progress: 5 })); // Start at 5% for immediate feedback
    setUploadedFiles(prev => [...prev, ...newUploads]);

    // Store progress intervals for cleanup
    const progressIntervals: Map<string, NodeJS.Timeout> = new Map();

    // Function to simulate progress for a file
    const startProgressSimulation = (fileName: string, fileSize: number) => {
      const initialProgress = 5; // Start from initial progress
      let currentProgress = initialProgress;
      const targetProgress = 90; // Stop at 90% until upload completes
      const progressRange = targetProgress - initialProgress; // Range to animate through
      const startTime = Date.now();

      // Calculate timing based on file size (larger files take longer)
      const estimatedDuration = Math.max(2000, Math.min(10000, fileSize / 1024)); // 2-10 seconds
      const updateInterval = 100; // Update every 100ms for smooth animation

      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progressRatio = Math.min(elapsed / estimatedDuration, 0.95); // Cap at 95% of range

        // Use easing function for smooth progress (ease-out cubic)
        const easedProgress = 1 - Math.pow(1 - progressRatio, 3);
        currentProgress = Math.min(
          Math.floor(initialProgress + (easedProgress * progressRange)),
          targetProgress
        );

        if (currentProgress >= targetProgress) {
          clearInterval(interval);
          progressIntervals.delete(fileName);
        }

        setUploadedFiles(prev => prev.map(f =>
          f.name === fileName && f.status === 'uploading'
            ? { ...f, progress: currentProgress }
            : f
        ));
      }, updateInterval);

      progressIntervals.set(fileName, interval);
      return interval;
    };

    // Function to stop progress simulation
    const stopProgressSimulation = (fileName: string) => {
      const interval = progressIntervals.get(fileName);
      if (interval) {
        clearInterval(interval);
        progressIntervals.delete(fileName);
      }
    };

    for (const file of files) {
      // Start progress simulation immediately
      startProgressSimulation(file.name, file.size);

      try {
        if (!expertCaseDocClassificationId) {
          throw new Error('Expert documents category is missing. Please create the "Expert" case documents category first.');
        }

        const storagePath = buildCaseDocumentStoragePath(client.lead_number, null, file.name);
        const { error: storageErr } = await supabase.storage
          .from(CASE_DOCUMENTS_STORAGE_BUCKET)
          .upload(storagePath, file, {
            contentType: file.type?.trim() || undefined,
            upsert: false,
          });

        // Stop progress simulation
        stopProgressSimulation(file.name);

        if (storageErr) throw storageErr;

        const uploadedBy = await getCurrentUserName();
        const mimeType = file.type?.trim() || 'application/octet-stream';

        const { error: insErr } = await supabase.from('lead_case_documents').insert({
          lead_number: client.lead_number,
          onedrive_subfolder: null,
          onedrive_item_id: null,
          storage_path: storagePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: mimeType,
          classification_id: expertCaseDocClassificationId,
          uploaded_by: uploadedBy,
          ai_summary_status: 'pending',
        });

        if (insErr) {
          await supabase.storage.from(CASE_DOCUMENTS_STORAGE_BUCKET).remove([storagePath]);
          throw new Error(insErr.message);
        }

        // Update file status to success with smooth transition to 100%
        setUploadedFiles(prev => prev.map(f =>
          f.name === file.name
            ? { ...f, status: 'success' as const, progress: 100 }
            : f
        ));

      } catch (err) {
        // Stop progress simulation on error
        stopProgressSimulation(file.name);

        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        // Update file status to error
        setUploadedFiles(prev => prev.map(f =>
          f.name === file.name
            ? { ...f, status: 'error' as const, error: errorMessage, progress: 0 }
            : f
        ));
        console.error(`Error uploading ${file.name}:`, err);
      }
    }

    // Cleanup: clear any remaining intervals
    progressIntervals.forEach((interval) => clearInterval(interval));
    progressIntervals.clear();

    // Refresh document count after all uploads complete
    await fetchDocumentCount();

    setIsUploading(false);
  };

  // Section/Eligibility options
  const sections = [
    { value: '116', label: 'German Citizenship - § 116', country: 'German' },
    { value: '15', label: 'German Citizenship - § 15', country: 'German' },
    { value: '5', label: 'German Citizenship - § 5', country: 'German' },
    { value: '58c', label: 'Austrian Citizenship - § 58c', country: 'Austrian' },
  ];

  const eligibilityOptions: EligibilityOption[] = [
    {
      value: 'feasible_no_check',
      label: 'Feasible (no check)',
      icon: CheckCircleIcon,
      color: 'text-success'
    },
    {
      value: 'feasible_check',
      label: 'Feasible (further check)',
      icon: MagnifyingGlassIcon,
      color: 'text-warning'
    },
    {
      value: 'not_feasible',
      label: 'No feasibility',
      icon: XCircleIcon,
      color: 'text-error'
    }
  ];

  const selectedSectionLabel = sections.find(s => s.value === selectedSection)?.label.split(' - ')[1] || '';
  /** Normalized eligibility value — empty when null/undefined/blank so UI can show -- */
  const eligibilityValueStr =
    eligibilityStatus.value != null && String(eligibilityStatus.value).trim() !== ''
      ? String(eligibilityStatus.value).trim()
      : '';
  const selectedEligibilityLabel = eligibilityValueStr
    ? eligibilityOptions.find(opt => opt.value === eligibilityValueStr)?.label || eligibilityValueStr
    : '--';

  const selectedEligibility = eligibilityOptions.find(opt => opt.value === eligibilityStatus.value);

  // Determine if user can edit eligibility dropdowns
  // Can edit if: 
  // 1. User is superuser (always enabled)
  // 2. OR expert is assigned AND current user is the assigned expert (non-superuser expert can edit)
  //    - Check by employee_id if expert is stored as ID
  //    - Check by display_name if expert is stored as display_name
  const canEditEligibility = isSuperuser || (
    // Check by employee_id match
    (assignedExpertId !== null &&
      currentUserEmployeeId !== null &&
      Number(assignedExpertId) === Number(currentUserEmployeeId)) ||
    // Check by display_name match
    (assignedExpertDisplayName !== null &&
      currentUserDisplayName !== null &&
      assignedExpertDisplayName.trim().toLowerCase() === currentUserDisplayName.trim().toLowerCase())
  );


  // Function to update document count from DocumentModal
  const handleDocumentCountChange = (count: number) => {
    // Only update if modal is open (to prevent resetting when modal initializes)
    // Or if the new count is greater than 0 (to allow updates when documents are added/removed)
    if (isDocumentModalOpen || count > 0) {
      setDocumentCount(count);
    }
  };

  // Function to handle modal close and refresh count
  const handleDocumentModalClose = () => {
    setIsDocumentModalOpen(false);
    // Refresh count when modal closes in case documents were added/removed
    fetchDocumentCount();
  };


  return (
    <div className="p-3 sm:p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-base-200 flex items-center justify-center">
            <AcademicCapIcon className="w-5 h-5 text-base-content/70" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-base-content">Expert</h2>
            <p className="text-sm text-base-content/60">Case evaluation, documents, and expert opinions</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm rounded-full"
            onClick={() => setIsSummaryCollapsed((v) => !v)}
            title={isSummaryCollapsed ? 'Show lead summary' : 'Hide lead summary'}
          >
            <DocumentTextIcon className="w-4 h-4" />
            <span className="hidden sm:inline">{isSummaryCollapsed ? 'Show summary' : 'Hide summary'}</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
        {/* Left column */}
        <div className="space-y-6">

          {/* Expert Information */}
          <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Overview</div>
                <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50">Assigned expert</div>
                    <div className="text-lg font-semibold text-base-content truncate">{expertName}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50">Eligibility</div>
                    <span
                      className={`mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
                        !eligibilityValueStr
                          ? 'bg-base-200 text-base-content/60'
                          : eligibilityValueStr.includes('feasible_no_check')
                            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-100'
                            : eligibilityValueStr.includes('feasible_check')
                              ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/25 dark:text-amber-100'
                              : eligibilityValueStr.includes('not_feasible')
                                ? 'bg-rose-50 text-rose-800 dark:bg-rose-900/25 dark:text-rose-100'
                                : 'bg-base-200 text-base-content/70'
                      }`}
                    >
                      {selectedEligibilityLabel}
                      {eligibilityValueStr && selectedSection && ['feasible_no_check', 'feasible_check'].includes(eligibilityValueStr) ? (
                        <span className="rounded-full bg-[#3b28c7] px-2 py-0.5 text-[11px] font-bold text-white">
                          {selectedSectionLabel}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section Eligibility + Citizenship + Document Upload */}
          <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm">
            <div className="space-y-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Eligibility</div>
                <div className="mt-1 text-base font-semibold text-base-content">Section eligibility</div>
              </div>

              {/* Eligibility Dropdown */}
              <div className="space-y-2 text-left">
                <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Eligibility Assessment</label>
                <div className={!canEditEligibility ? "tooltip tooltip-top w-full" : ""} data-tip={!canEditEligibility ? "Only the assigned expert is able to save changes" : ""}>
                  <select
                    className="select select-bordered w-full"
                    value={eligibilityStatus.value}
                    onChange={(e) => handleEligibilityChange(e.target.value)}
                    disabled={!canEditEligibility}
                  >
                    <option value="">Set Eligibility...</option>
                    {eligibilityOptions.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Citizenship Section Dropdown */}
              <div className="space-y-2 text-left mb-6">
                <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                  Citizenship Section
                  {isLegacyLead && (
                    <span className="text-sm font-normal text-gray-400 ml-2">(Optional)</span>
                  )}
                </label>
                <div className="relative">
                  <div className={!canEditEligibility ? "tooltip tooltip-top w-full" : ""} data-tip={!canEditEligibility ? "Only the assigned expert is able to save changes" : ""}>
                    <select
                      className="select select-bordered w-full"
                      value={selectedSection}
                      onChange={(e) => handleSectionChange(e.target.value)}
                      disabled={!canEditEligibility || !eligibilityStatus.value || eligibilityStatus.value === 'not_feasible'}
                    >
                      <option value="">Select citizenship section...</option>
                      {sections.map((section) => (
                        <option
                          key={section.value}
                          value={section.value}
                        >
                          {section.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <HashtagIcon className="w-5 h-5 absolute right-10 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400" />
                </div>
              </div>

              {/* Section Eligibility Last Edited */}
              {sectionEligibilityLastEditedBy && sectionEligibilityLastEditedAt && (
                <div className="text-xs text-base-content/55 flex flex-col sm:flex-row sm:justify-between gap-1 border-t border-base-200 pt-3 text-left">
                  <span>Last edited by {sectionEligibilityLastEditedBy}</span>
                  <span>{new Date(sectionEligibilityLastEditedAt).toLocaleString()}</span>
                </div>
              )}

              {/* Document Upload — below citizenship selector */}
              <div className="space-y-5 pt-6 border-t border-base-200">
                <div className="text-base font-semibold text-base-content">Document upload</div>
                {/* Upload Area */}
                <div
                  className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-200 sm:p-8 ${
                    isUploading
                      ? 'border-primary bg-gray-50'
                      : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-purple-50'
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={handleFileDrop}
                >
                  <input
                    type="file"
                    className="hidden"
                    id="file-upload-expert"
                    multiple
                    onChange={handleFileInput}
                    disabled={isUploading}
                  />
                  <DocumentArrowUpIcon className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                  <div className="mb-4 text-base text-gray-600">
                    {isUploading ? 'Processing files...' : 'Drag and drop files here, or click to select files'}
                  </div>
                  <label
                    htmlFor="file-upload-expert"
                    className={`btn btn-outline btn-primary ${isUploading ? 'btn-disabled' : ''}`}
                  >
                    <PaperClipIcon className="w-5 h-5" />
                    Choose Files
                  </label>
                </div>

                {/* Uploaded Files List */}
                {uploadedFiles.length > 0 && (
                  <div className="space-y-2 text-left">
                    {uploadedFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-3 min-w-0">
                          <PaperClipIcon className="w-5 h-5 flex-shrink-0" style={{ color: '#3b28c7' }} />
                          <span className="text-base font-medium text-gray-900 truncate">{file.name}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {file.status === 'uploading' && (
                            <div className="flex items-center gap-2">
                              <div className="radial-progress text-xs" style={{ "--value": file.progress || 0, "--size": "2.5rem", color: '#3b28c7' } as any}>
                                <span className="text-xs font-semibold">{Math.round(file.progress || 0)}%</span>
                              </div>
                              <div className="text-xs text-gray-500 font-medium">
                                Uploading...
                              </div>
                            </div>
                          )}
                          {file.status === 'success' && (
                            <div className="flex items-center gap-2">
                              <CheckCircleIcon className="w-6 h-6 text-green-500" />
                              <span className="text-xs text-green-600 font-medium">Complete</span>
                            </div>
                          )}
                          {file.status === 'error' && (
                            <div className="tooltip tooltip-error" data-tip={file.error}>
                              <div className="flex items-center gap-2">
                                <XCircleIcon className="w-6 h-6 text-red-500" />
                                <span className="text-xs text-red-600 font-medium">Failed</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Expert Opinion */}
          <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm" id="expert-opinion-section">
            <div className="flex items-center justify-between mb-4 gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <h4 className="text-base font-semibold text-base-content">Expert Opinion</h4>
                <FlagTypeFlagButton
                  flagTypes={flagTypes}
                  isFlagged={leadFieldFlagMeta.has('expert_notes')}
                  disabled={!publicUserId}
                  onAdd={(flagTypeId) => void addLeadFieldFlag('expert_notes', flagTypeId)}
                  onRemove={() => void removeLeadFieldFlag('expert_notes')}
                  titleFlag="Flag expert opinion — choose type"
                  titleRemove="Remove flag"
                  className="shrink-0 text-amber-600 hover:bg-amber-50"
                />
              </div>
              <div className="flex gap-2">
                {!isAddingExpertNote && !editingExpertNoteId && (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setIsExpertNotesModalOpen(true)}
                      title="View full screen"
                    >
                      <ArrowsPointingOutIcon className="w-5 h-5 text-gray-600" />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setIsAddingExpertNote(true);
                        setNewExpertNoteContent('');
                      }}
                      title="Add note"
                    >
                      <PencilSquareIcon className="w-5 h-5 text-gray-600" />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div>
                {/* Add Expert Note Form */}
                {isAddingExpertNote && !editingExpertNoteId && (
                  <div className="mb-6">
                    <textarea
                      className="textarea textarea-bordered w-full h-32 mb-3"
                      placeholder="Enter your note..."
                      value={newExpertNoteContent}
                      onChange={(e) => setNewExpertNoteContent(e.target.value)}
                      dir={getTextDirection(newExpertNoteContent)}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        className="btn btn-ghost btn-sm hover:bg-red-50"
                        onClick={handleCancelExpertEdit}
                      >
                        <XMarkIcon className="w-4 h-4 text-red-600" />
                        Cancel
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ backgroundColor: '#3b28c7', color: 'white' }}
                        onClick={handleSaveExpertNote}
                        disabled={!newExpertNoteContent.trim()}
                      >
                        <CheckIcon className="w-4 h-4" />
                        Save
                      </button>
                    </div>
                  </div>
                )}

                {/* Expert Notes List */}
                <div className="space-y-6 overflow-y-auto max-h-[340px]">
                  {expertNotes.length > 0 ? (
                    expertNotes.map((note, index) => (
                      <div
                        key={note.id}
                        className={`rounded-lg transition-all duration-200 ${editingExpertNoteId === note.id ? 'ring-2 ring-purple-200 bg-purple-50' : ''
                          }`}
                        style={editingExpertNoteId === note.id ? { '--tw-ring-color': '#3b28c7', '--tw-ring-opacity': '0.2' } as React.CSSProperties : {}}
                      >
                        {/* Note Content */}
                        {editingExpertNoteId === note.id ? (
                          <div className="p-4">
                            <textarea
                              className="textarea textarea-bordered w-full h-32 mb-3"
                              value={newExpertNoteContent}
                              onChange={(e) => setNewExpertNoteContent(e.target.value)}
                              dir="rtl"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                className="btn btn-ghost btn-sm hover:bg-red-50"
                                onClick={handleCancelExpertEdit}
                              >
                                <XMarkIcon className="w-4 h-4 text-red-600" />
                                Cancel
                              </button>
                              <button
                                className="btn btn-sm"
                                style={{ backgroundColor: '#3b28c7', color: 'white' }}
                                onClick={handleSaveExpertNote}
                                disabled={!newExpertNoteContent.trim()}
                              >
                                <CheckIcon className="w-4 h-4" />
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="p-4">
                            {note.content && note.content.trim().startsWith('<') ? (
                              // Render HTML content
                              <div
                                className="text-base text-gray-800 leading-relaxed mb-3 prose max-w-none"
                                dir={getTextDirection(note.content)}
                                dangerouslySetInnerHTML={{ __html: note.content }}
                              />
                            ) : (
                              // Render plain text
                              <p className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed mb-3" dir={getTextDirection(note.content)}>{formatNoteText(note.content)}</p>
                            )}

                            {/* Note Footer - Last edited by/at */}
                            {(note.edited_by || note.edited_at || note.timestamp) && (
                              <div className="pt-3 border-t border-gray-100">
                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                  {note.edited_by && <span>Last edited by {note.edited_by}</span>}
                                  {(() => {
                                    const formatted = safeFormatDate(note.edited_at || note.timestamp);
                                    return formatted ? (
                                      <>
                                        {note.edited_by && <span>•</span>}
                                        <span>{formatted}</span>
                                      </>
                                    ) : null;
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-base-content/60">
                      <div className="min-h-[80px]">
                        <p className="text-lg font-medium mb-1">No expert opinion yet</p>
                        <p className="text-base">Expert opinions and assessments will appear here</p>
                      </div>
                    </div>
                  )}
                </div>
                {((client as any).expert_notes_last_edited_by || expertNotesLastEditedBy || (client as any).expert_notes_last_edited_at || expertNotesLastEditedAt) && (
                  <div className="text-xs text-gray-400 flex justify-between mt-3 pt-3 border-t border-gray-100">
                    <span>Last edited by {(client as any).expert_notes_last_edited_by || expertNotesLastEditedBy || 'Unknown'}</span>
                    <span>{safeFormatDate((client as any).expert_notes_last_edited_at || expertNotesLastEditedAt)}</span>
                  </div>
                )}
            </div>
          </div>

          {/* Handler Opinion */}
          <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm" id="handler-opinion-section">
            <div className="flex items-center justify-between mb-4 gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <h4 className="text-base font-semibold text-base-content">Handler Opinion</h4>
                <FlagTypeFlagButton
                  flagTypes={flagTypes}
                  isFlagged={leadFieldFlagMeta.has('handler_notes')}
                  disabled={!publicUserId}
                  onAdd={(flagTypeId) => void addLeadFieldFlag('handler_notes', flagTypeId)}
                  onRemove={() => void removeLeadFieldFlag('handler_notes')}
                  titleFlag="Flag handler opinion — choose type"
                  titleRemove="Remove flag"
                  className="shrink-0 text-amber-600 hover:bg-amber-50"
                />
              </div>
              {!isAddingHandlerNote && !editingHandlerNoteId && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setIsAddingHandlerNote(true);
                    setNewHandlerNoteContent('');
                  }}
                  title="Add Handler Note"
                >
                  <PencilSquareIcon className="w-5 h-5 text-gray-600" />
                </button>
              )}
            </div>
            <div>
                {/* Add/Edit Handler Note Form */}
                {(isAddingHandlerNote || editingHandlerNoteId) && (
                  <div className="mb-6">
                    <textarea
                      className="textarea textarea-bordered w-full h-32 mb-3"
                      placeholder="Enter your note..."
                      value={newHandlerNoteContent}
                      onChange={(e) => setNewHandlerNoteContent(e.target.value)}
                      dir={getTextDirection(newHandlerNoteContent)}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        className="btn btn-ghost btn-sm hover:bg-red-50"
                        onClick={handleCancelHandlerEdit}
                      >
                        <XMarkIcon className="w-4 h-4 text-red-600" />
                        Cancel
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ backgroundColor: '#3b28c7', color: 'white' }}
                        onClick={handleSaveHandlerNote}
                        disabled={!newHandlerNoteContent.trim()}
                      >
                        <CheckIcon className="w-4 h-4" />
                        Save
                      </button>
                    </div>
                  </div>
                )}

                {/* Handler Notes List */}
                <div className="space-y-6 overflow-y-auto max-h-[340px]">
                  {handlerNotes.length > 0 ? (
                    handlerNotes.map((note, index) => (
                      <div
                        key={note.id}
                        className="relative py-4"
                      >
                        {/* Note Content */}
                        <div>
                          <p className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed" dir={getTextDirection(note.content)}>{formatNoteText(note.content)}</p>
                        </div>

                        {/* Note Footer - Last edited by/at */}
                        {(note.edited_by || note.edited_at || note.timestamp) && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                              {note.edited_by && <span>Last edited by {note.edited_by}</span>}
                              {(() => {
                                const formatted = safeFormatDate(note.edited_at || note.timestamp);
                                return formatted ? (
                                  <>
                                    {note.edited_by && <span>•</span>}
                                    <span>{formatted}</span>
                                  </>
                                ) : null;
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-base-content/60">
                      <div className="min-h-[80px]">
                        <p className="text-lg font-medium mb-1">No handler opinion yet</p>
                        <p className="text-base">Case handling notes and updates will appear here</p>
                      </div>
                    </div>
                  )}
                </div>
                {((client as any).handler_notes_last_edited_by || handlerNotesLastEditedBy || (client as any).handler_notes_last_edited_at || handlerNotesLastEditedAt) && (
                  <div className="text-xs text-gray-400 flex justify-between mt-3 pt-3 border-t border-gray-100">
                    <span>Last edited by {(client as any).handler_notes_last_edited_by || handlerNotesLastEditedBy || 'Unknown'}</span>
                    <span>{safeFormatDate((client as any).handler_notes_last_edited_at || handlerNotesLastEditedAt)}</span>
                  </div>
                )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Documents */}
          <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Documents</div>
                <div className="mt-1 text-base font-semibold text-base-content truncate">
                  Client files
                </div>
              </div>
              <div className="shrink-0 rounded-full bg-base-200 px-2.5 py-1 text-xs font-bold tabular-nums text-base-content/70">
                {documentCount}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {hasDocsUrl ? (
                <button
                  type="button"
                  onClick={() => window.open(docsUrl, '_blank')}
                  className="btn btn-outline btn-ghost justify-between rounded-xl"
                  title="Open legacy documents link"
                >
                  <span className="inline-flex items-center gap-2">
                    <PaperClipIcon className="w-5 h-5" />
                    Documents link
                  </span>
                  <ArrowPathIcon className="w-4 h-4 opacity-40" />
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setIsDocumentModalOpen(true)}
                className="btn btn-outline btn-ghost justify-between rounded-xl"
                title="Open case documents"
              >
                <span className="inline-flex items-center gap-2">
                  <FolderIcon className="w-5 h-5" />
                  Case documents
                </span>
                <span className="inline-flex items-center gap-2 text-base-content/60">
                  <span className="font-bold tabular-nums">{documentCount}</span>
                  <ChevronRightIcon className="w-4 h-4 opacity-50" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => void openOneDriveDrawer()}
                className="btn btn-outline btn-ghost justify-between rounded-xl"
                title="Browse OneDrive (legacy)"
              >
                <span className="inline-flex items-center gap-2">
                  <PaperClipIcon className="w-5 h-5" />
                  OneDrive
                </span>
                <span className="inline-flex items-center gap-2 text-base-content/60">
                  <span className="font-bold tabular-nums">{oneDriveDocumentCount}</span>
                  <ChevronRightIcon className="w-4 h-4 opacity-50" />
                </span>
              </button>
            </div>
          </div>

          {/* Lead Summary */}
          {!isSummaryCollapsed ? (
          <div className="border border-base-200 rounded-2xl shadow-sm overflow-hidden h-full sticky top-6 bg-base-100 flex flex-col">
            <div className="pl-6 pt-2 pb-2 flex-shrink-0">
              <div className="flex items-center justify-between pr-6">
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-semibold text-base-content">Lead Summary</h4>
                </div>
                <div className="flex items-center gap-2">
                  {/* Toggle between AI Summary and Individual Fields */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setShowAISummary(false);
                        setUseSavedSummary(false);
                      }}
                      className={`btn btn-circle btn-sm transition-all border ${!showAISummary ? 'border-gray-300 bg-gray-50 text-gray-700 shadow-sm' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}
                      title="Show individual fields"
                    >
                      <DocumentTextIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setShowAISummary(true);
                        if (savedAiSummary) {
                          setUseSavedSummary(true);
                          setAiSummary(savedAiSummary);
                        } else if (aiSummary) {
                          setUseSavedSummary(false);
                        }
                      }}
                      className={`btn btn-circle btn-sm transition-all border ${showAISummary ? 'border-gray-300 bg-gray-50 text-gray-700 shadow-sm' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}
                      title="Show AI Summary"
                    >
                      <CpuChipIcon className="w-4 h-4" />
                    </button>
                  </div>
                  {!showAISummary && (
                    <button
                      onClick={generateAISummary}
                      disabled={isGeneratingSummary}
                      className="btn btn-sm btn-outline"
                      style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                      title="Generate AI Summary"
                    >
                      {isGeneratingSummary ? (
                        <span className="loading loading-spinner loading-xs"></span>
                      ) : (
                        <SparklesIcon className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div className="border-b border-gray-200 mt-2"></div>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              {showAISummary ? (
                <div className="space-y-4">
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <SparklesIcon className="w-5 h-5 text-purple-600" />
                        <h5 className="text-sm font-semibold text-purple-900">
                          {useSavedSummary ? 'Saved AI Summary' : 'AI Generated Summary'}
                        </h5>
                      </div>
                      {useSavedSummary && (
                        <button
                          onClick={generateAISummary}
                          disabled={isGeneratingSummary}
                          className="btn btn-xs btn-outline"
                          style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                          title="Generate new AI Summary"
                        >
                          {isGeneratingSummary ? (
                            <>
                              <span className="loading loading-spinner loading-xs"></span>
                              Generating...
                            </>
                          ) : (
                            <>
                              <SparklesIcon className="w-3 h-3" />
                              Regenerate
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div
                      className={`text-sm text-gray-800 whitespace-pre-wrap leading-relaxed ${
                        getTextDirection(aiSummary || savedAiSummary) === 'rtl' ? 'text-right' : 'text-left'
                      }`}
                      dir={getTextDirection(aiSummary || savedAiSummary)}
                    >
                      {aiSummary || (savedAiSummary || 'No AI summary available. Click "Generate" to create one.')}
                    </div>
                    {useSavedSummary && savedAiSummary && (
                      <div
                        className={`mt-3 pt-3 border-t border-purple-200 text-xs text-purple-600 ${
                          getTextDirection(savedAiSummary) === 'rtl' ? 'text-right' : 'text-left'
                        }`}
                        dir={getTextDirection(savedAiSummary)}
                      >
                        This is a saved summary. Click "Regenerate" to create a new one.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Special Notes */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700 uppercase tracking-wide text-left block">Special Notes</label>
                    <div className="p-2 min-h-[80px]">
                      {summaryData.specialNotes ? (
                        <p
                          className={`text-sm text-gray-800 whitespace-pre-wrap leading-relaxed ${
                            getTextDirection(summaryData.specialNotes) === 'rtl' ? 'text-right' : 'text-left'
                          }`}
                          dir={getTextDirection(summaryData.specialNotes)}
                        >
                          {summaryData.specialNotes}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic text-left" dir="ltr">No special notes</p>
                      )}
                    </div>
                    <div className="border-b border-gray-200 mt-4"></div>
                  </div>

                  {/* General Notes */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700 uppercase tracking-wide text-left block">General Notes</label>
                    <div className="p-2 min-h-[80px]">
                      {summaryData.generalNotes ? (
                        <p
                          className={`text-sm text-gray-800 whitespace-pre-wrap leading-relaxed ${
                            getTextDirection(summaryData.generalNotes) === 'rtl' ? 'text-right' : 'text-left'
                          }`}
                          dir={getTextDirection(summaryData.generalNotes)}
                        >
                          {summaryData.generalNotes}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic text-left" dir="ltr">No general notes</p>
                      )}
                    </div>
                    <div className="border-b border-gray-200 mt-4"></div>
                  </div>

                  {/* Facts of Case */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700 uppercase tracking-wide text-left block">Facts of Case</label>
                    <div className="p-2 min-h-[80px]">
                      {summaryData.facts ? (
                        <p
                          className={`text-sm text-gray-800 whitespace-pre-wrap leading-relaxed ${
                            getTextDirection(summaryData.facts) === 'rtl' ? 'text-right' : 'text-left'
                          }`}
                          dir={getTextDirection(summaryData.facts)}
                        >
                          {summaryData.facts}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic text-left" dir="ltr">No facts available</p>
                      )}
                    </div>
                    <div className="border-b border-gray-200 mt-4"></div>
                  </div>

                  {/* Manager Notes */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-gray-700 uppercase tracking-wide text-left block">Manager Notes</label>
                    <div className="p-2 min-h-[80px]">
                      {summaryData.managerNotes ? (
                        <p
                          className={`text-sm text-gray-800 whitespace-pre-wrap leading-relaxed ${
                            getTextDirection(summaryData.managerNotes) === 'rtl' ? 'text-right' : 'text-left'
                          }`}
                          dir={getTextDirection(summaryData.managerNotes)}
                        >
                          {summaryData.managerNotes}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic text-left" dir="ltr">No manager notes</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          ) : (
            <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm sticky top-6">
              <button
                type="button"
                className="btn btn-outline btn-ghost w-full rounded-xl justify-between"
                onClick={() => setIsSummaryCollapsed(false)}
                title="Show Lead Summary"
              >
                <span className="inline-flex items-center gap-2">
                  <DocumentTextIcon className="w-5 h-5" />
                  Lead summary
                </span>
                <ChevronLeftIcon className="w-4 h-4 opacity-60" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Document Modal */}
      <DocumentModal
        isOpen={isDocumentModalOpen}
        onClose={handleDocumentModalClose}
        leadNumber={client.lead_number || ''}
        clientName={client.name || ''}
        clientId={(client as any)?.id ?? null}
        onDocumentCountChange={handleDocumentCountChange}
      />

      {/* Expert Notes Modal */}
      <ExpertNotesModal
        isOpen={isExpertNotesModalOpen}
        onClose={() => setIsExpertNotesModalOpen(false)}
        notes={expertNotes}
        formatNoteText={formatNoteText}
        isSuperuser={isSuperuser}
        currentUserEmployeeId={currentUserEmployeeId}
        currentUserDisplayName={currentUserDisplayName}
        assignedExpertId={assignedExpertId}
        getCurrentUserName={getCurrentUserName}
        onSave={handleSaveExpertNotes}
      />

      {/* OneDrive legacy documents drawer */}
      {isOneDriveDrawerOpen && (
        <div className="fixed inset-0 z-[90]">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              setIsOneDriveDrawerOpen(false);
              setOneDriveQuery('');
              setOneDriveFilesError(null);
            }}
          />
          <div className="absolute inset-y-0 right-0 w-full max-w-xl bg-base-100 shadow-2xl border-l border-base-200 flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-base-200">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">OneDrive documents</div>
                <div className="text-xs opacity-70 truncate">
                  Lead {String(client.lead_number || '')}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => {
                  setIsOneDriveDrawerOpen(false);
                  setOneDriveQuery('');
                  setOneDriveFilesError(null);
                }}
                aria-label="Close OneDrive drawer"
                title="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-base-200">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="input input-bordered flex items-center gap-2">
                    <MagnifyingGlassIcon className="w-4 h-4 opacity-60" />
                    <input
                      type="text"
                      className="grow"
                      placeholder="Search documents…"
                      value={oneDriveQuery}
                      onChange={(e) => setOneDriveQuery(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                  onClick={() => void openOneDriveDrawer()}
                  disabled={isLoadingOneDriveFiles}
                  title="Refresh"
                >
                  {isLoadingOneDriveFiles ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : (
                    <ArrowPathIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
              {oneDriveFilesError ? (
                <div className="mt-3 text-xs text-error">{oneDriveFilesError}</div>
              ) : null}
            </div>

            <div className="flex-1 overflow-auto">
              {isLoadingOneDriveFiles ? (
                <div className="p-6 text-sm opacity-70 flex items-center gap-2">
                  <span className="loading loading-spinner loading-sm" />
                  Loading OneDrive documents…
                </div>
              ) : (() => {
                const q = oneDriveQuery.trim().toLowerCase();
                const filtered = (oneDriveFiles || []).filter((f) =>
                  !q ? true : String(f?.name || '').toLowerCase().includes(q),
                );
                if (!filtered.length) {
                  if (oneDriveFilesError) {
                    return (
                      <div className="p-6 text-sm opacity-70">
                        Failed to load OneDrive documents. Please try refresh.
                      </div>
                    );
                  }
                  return <div className="p-6 text-sm opacity-70">No OneDrive documents found.</div>;
                }
                return (
                  <div className="divide-y divide-base-200">
                    {filtered.map((f) => {
                      const href = f.downloadUrl || f.webUrl || '';
                      return (
                        <div key={f.id || f.name} className="p-4 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{f.name}</div>
                            <div className="mt-1 text-xs opacity-70 flex flex-wrap gap-x-3 gap-y-1">
                              <span>{formatBytes(f.size)}</span>
                              {f.lastModifiedDateTime ? (
                                <span>{safeFormatDate(f.lastModifiedDateTime) || String(f.lastModifiedDateTime)}</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <a
                              className="btn btn-sm btn-outline"
                              style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              title="Open"
                            >
                              Open
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ExpertTab; 