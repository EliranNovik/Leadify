import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import TimelineHistoryButtons from './TimelineHistoryButtons';
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
  XCircleIcon
} from '@heroicons/react/24/outline';
import { FolderIcon } from '@heroicons/react/24/solid';
import { supabase } from '../../lib/supabase';
import DocumentModal from '../DocumentModal';

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
        const legacyId = client.id.toString().replace('legacy_', '');
        await supabase
          .from('leads_lead')
          .update({ expert_notes: cleanedNotes })
          .eq('id', legacyId);
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
    if (!expertId) return 'Not assigned';
    
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
      const legacyId = client.id.toString().replace('legacy_', '');
      const { data: legacyData, error } = await supabase
        .from('leads_lead')
        .select('expert_id, expert_opinion')
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
        
        // Add expert_opinion to expert notes if it exists
        if (legacyData.expert_opinion && legacyData.expert_opinion.trim()) {
          const existingNotes = client.expert_notes || [];
          const hasExpertOpinion = existingNotes.some((note: any) => 
            note.content.includes('Expert Opinion:') || note.content.includes(legacyData.expert_opinion)
          );
          
          if (!hasExpertOpinion) {
            const expertOpinionNote = {
              id: `legacy_opinion_${Date.now()}`,
              content: `Expert Opinion: ${formatNoteText(legacyData.expert_opinion)}`,
              timestamp: new Date().toLocaleString()
            };
            
            const updatedNotes = [...existingNotes, expertOpinionNote];
            setExpertNotes(updatedNotes);
            
            // Save to database
            const legacyId = client.id.toString().replace('legacy_', '');
            await supabase
              .from('leads_lead')
              .update({ expert_notes: updatedNotes })
              .eq('id', legacyId);
          }
        }
        
        // Update client expert name if it's different
        if (expertName !== client.expert) {
          // Update the client object locally
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
  const fetchDocsUrl = async () => {
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
          return;
        }
        
        if (data && data.docs_url) {
          setDocsUrl(data.docs_url);
        }
      } catch (error) {
        // Silent error handling
      }
    }
  };

  // Function to fetch expert_id for legacy leads
  const fetchExpertId = async () => {
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
          setExpertName('Not assigned');
          return;
        }
        
        if (data && data.expert_id) {
          // Get the expert name from the ID
          const expertName = await getExpertName(data.expert_id);
          setExpertName(expertName);
        } else {
          setExpertName('Not assigned');
        }
      } catch (error) {
        console.error('Error in fetchExpertId:', error);
        setExpertName('Not assigned');
      }
    } else {
      // For new leads, use the expert field from client
      setExpertName(client.expert || 'Not assigned');
    }
  };

  // Function to fetch eligibility data for legacy leads
  const fetchLegacyEligibilityData = async () => {
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      try {
        const legacyId = client.id.toString().replace('legacy_', '');
        const { data, error } = await supabase
          .from('leads_lead')
          .select('expert_examination, section_eligibility, eligibilty_date')
          .eq('id', legacyId)
          .single();
        
        if (error) {
          console.error('Error fetching legacy eligibility data:', error);
          return;
        }
        
        if (data) {
          // Map expert_examination to eligibility status
          let eligibilityValue = '';
          // Convert to number for comparison since it might come as string from database
          const examValue = Number(data.expert_examination);
          if (examValue === 8) {
            eligibilityValue = 'feasible_no_check';
          } else if (examValue === 1) {
            eligibilityValue = 'not_feasible';
          } else if (examValue === 5) {
            eligibilityValue = 'feasible_check';
          }
          
          // Update eligibility status if we have a value
          if (eligibilityValue) {
            setEligibilityStatus({
              value: eligibilityValue,
              timestamp: data.eligibilty_date || new Date().toISOString() // Use eligibilty_date if available
            });
          }
          
          // Update section eligibility if we have a value (optional for legacy leads)
          if (data.section_eligibility) {
            setSelectedSection(data.section_eligibility);
          }
          
          console.log('Legacy eligibility data loaded:', {
            expert_examination: data.expert_examination,
            examValue_converted: Number(data.expert_examination),
            mapped_eligibility: eligibilityValue,
            section_eligibility: data.section_eligibility,
            eligibilty_date: data.eligibilty_date
          });
        }
      } catch (error) {
        console.error('Error in fetchLegacyEligibilityData:', error);
      }
    }
  };

  // Fetch legacy expert data on component mount
  useEffect(() => {
    fetchLegacyExpertData();
    cleanupExistingNotes();
    fetchTrackingInfo();
    fetchDocsUrl();
    fetchExpertId();
    fetchLegacyEligibilityData();
  }, [client.id]);

  // Section & eligibility
  const [selectedSection, setSelectedSection] = useState(client.section_eligibility || '');
  const [eligibilityStatus, setEligibilityStatus] = useState<EligibilityStatus>({
    value: client.eligibility_status || '',
    timestamp: client.eligibility_status_timestamp || ''
  });

  // Expert Notes
  const [expertNotes, setExpertNotes] = useState<Note[]>(client.expert_notes || []);
  const [isAddingExpertNote, setIsAddingExpertNote] = useState(false);
  const [editingExpertNoteId, setEditingExpertNoteId] = useState<string | null>(null);
  const [newExpertNoteContent, setNewExpertNoteContent] = useState('');

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

  // Placeholder for document count and link
  const documentLink = client.onedrive_folder_link || '#';
  const hasDocumentLink = !!client.onedrive_folder_link;
  
  // Get docs_url for legacy leads
  const [docsUrl, setDocsUrl] = useState<string>('');
  const hasDocsUrl = !!docsUrl;
  
  // Expert name state
  const [expertName, setExpertName] = useState<string>(client.expert || 'Not assigned');

  // I need an expert feature
  const [isAssigningExpert, setIsAssigningExpert] = useState(false);
  const handleAssignRandomExpert = async () => {
    setIsAssigningExpert(true);
    
    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    
    try {
      // Fetch all available experts from tenants_employee table
      const { data: employeesData, error: employeesError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, bonuses_role')
        .eq('bonuses_role', 'e') // 'e' for expert role
        .limit(100);
      
      if (employeesError || !employeesData || employeesData.length === 0) {
        // Fallback: try to get experts from employees table
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('employees')
          .select('id, full_name, role')
          .eq('role', 'expert')
          .limit(100);
        
        if (fallbackError || !fallbackData || fallbackData.length === 0) {
          // Final fallback: try to get experts from leads table
          const { data: leadsData, error: leadsError } = await supabase
            .from('leads')
            .select('expert')
            .not('expert', 'is', null)
            .neq('expert', '')
            .limit(100);
          
          if (leadsError || !leadsData || leadsData.length === 0) {
            setIsAssigningExpert(false);
            alert('No available experts found.');
            return;
          }
          
          // Get unique expert names from leads
          const experts = Array.from(new Set(leadsData.map((row: any) => row.expert).filter(Boolean)));
          if (experts.length === 0) {
            setIsAssigningExpert(false);
            alert('No available experts found.');
            return;
          }
          
          // Pick one at random
          const randomExpert = experts[Math.floor(Math.random() * experts.length)];
          
          // Save to appropriate table
          if (isLegacyLead) {
            const legacyId = client.id.toString().replace('legacy_', '');
            await supabase
              .from('leads_lead')
              .update({ expert_id: randomExpert })
              .eq('id', legacyId);
          } else {
            await supabase
              .from('leads')
              .update({ expert: randomExpert })
              .eq('id', client.id);
          }
        } else {
          // Use employees table data
          const experts = fallbackData.filter((emp: any) => emp.full_name);
          if (experts.length === 0) {
            setIsAssigningExpert(false);
            alert('No available experts found.');
            return;
          }
          
          // Pick one at random
          const randomExpert = experts[Math.floor(Math.random() * experts.length)];
          
          // Save to appropriate table
          if (isLegacyLead) {
            const legacyId = client.id.toString().replace('legacy_', '');
            await supabase
              .from('leads_lead')
              .update({ expert_id: randomExpert.id })
              .eq('id', legacyId);
          } else {
            await supabase
              .from('leads')
              .update({ expert: randomExpert.full_name })
              .eq('id', client.id);
          }
        }
      } else {
        // Use tenants_employee table data
        const experts = employeesData.filter((emp: any) => emp.display_name);
        if (experts.length === 0) {
          setIsAssigningExpert(false);
          alert('No available experts found.');
          return;
        }
        
        // Pick one at random
        const randomExpert = experts[Math.floor(Math.random() * experts.length)];
        
        // Save to appropriate table
        if (isLegacyLead) {
          const legacyId = client.id.toString().replace('legacy_', '');
          await supabase
            .from('leads_lead')
            .update({ expert_id: randomExpert.id })
            .eq('id', legacyId);
        } else {
          await supabase
            .from('leads')
            .update({ expert: randomExpert.display_name })
            .eq('id', client.id);
        }
      }
      
      setIsAssigningExpert(false);
      if (onClientUpdate) await onClientUpdate();
      
      // Refresh expert data for legacy leads
      if (isLegacyLead) {
        await fetchLegacyExpertData();
        await fetchExpertId(); // Also refresh the expert name display
      }
    } catch (error) {
      console.error('Error assigning expert:', error);
      setIsAssigningExpert(false);
      alert('Failed to assign expert. Please try again.');
    }
  };

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
        const { error: updateError } = await supabase
          .from('leads_lead')
          .update({ 
            section_eligibility: value,
            section_eligibility_last_edited_by: currentUser,
            section_eligibility_last_edited_at: new Date().toISOString()
          })
          .eq('id', legacyId);
        
        if (updateError) {
          console.error('Error updating section eligibility with tracking (legacy):', updateError);
          
          // Fallback: try without tracking columns
          const { error: fallbackError } = await supabase
            .from('leads_lead')
            .update({ section_eligibility: value })
            .eq('id', legacyId);
          
          if (fallbackError) {
            console.error('Error updating section eligibility (fallback - legacy):', fallbackError);
            throw fallbackError;
          }
        }
      } catch (error) {
        console.error('Error in handleSectionChange (legacy):', error);
        throw error;
      }
    } else {
      // For new leads, save to leads table with tracking
      try {
        // First, try to update with tracking columns
        const { error: updateError } = await supabase
          .from('leads')
          .update({ 
            section_eligibility: value,
            section_eligibility_last_edited_by: currentUser,
            section_eligibility_last_edited_at: new Date().toISOString()
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
        section_eligibility: newValue === 'not_feasible' ? '' : selectedSection,
        eligibilty_date: timestamp // Always update eligibilty_date when eligibility changes
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
      const legacyId = client.id.toString().replace('legacy_', '');
      
      try {
        // First, try to update with tracking columns
        const { error: updateError } = await supabase
          .from('leads_lead')
          .update({ 
            expert_notes: notes,
            expert_notes_last_edited_by: currentUser,
            expert_notes_last_edited_at: new Date().toISOString()
          })
          .eq('id', legacyId);
        
        if (updateError) {
          console.error('Error updating expert notes with tracking:', updateError);
          
          // Fallback: try without tracking columns
          const { error: fallbackError } = await supabase
            .from('leads_lead')
            .update({ expert_notes: notes })
            .eq('id', legacyId);
          
          if (fallbackError) {
            console.error('Error updating expert notes (fallback):', fallbackError);
            throw fallbackError;
          }
        }
      } catch (error) {
        console.error('Error in handleSaveExpertNotes:', error);
        throw error;
      }
    } else {
      // For new leads, save to leads table with tracking
      try {
        // First, try to update with tracking columns
        const { error: updateError } = await supabase
          .from('leads')
          .update({ 
            expert_notes: notes,
            expert_notes_last_edited_by: currentUser,
            expert_notes_last_edited_at: new Date().toISOString()
          })
          .eq('id', client.id);
        
        if (updateError) {
          console.error('Error updating expert notes with tracking (new leads):', updateError);
          
          // Fallback: try without tracking columns
          const { error: fallbackError } = await supabase
            .from('leads')
            .update({ expert_notes: notes })
            .eq('id', client.id);
          
          if (fallbackError) {
            console.error('Error updating expert notes (fallback - new leads):', fallbackError);
            throw fallbackError;
          }
        }
      } catch (error) {
        console.error('Error in handleSaveExpertNotes (new leads):', error);
        throw error;
      }
    }
    
    if (onClientUpdate) await onClientUpdate();
  };

  // Save handler notes to DB
  const handleSaveHandlerNotes = async (notes: Note[]) => {
    setHandlerNotes(notes);
    
    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const currentUser = await getCurrentUserName();
    
    if (isLegacyLead) {
      // For legacy leads, save to leads_lead table using the actual integer ID
      const legacyId = client.id.toString().replace('legacy_', '');
      
      try {
        // First, try to update with tracking columns
        const { error: updateError } = await supabase
          .from('leads_lead')
          .update({ 
            handler_notes: notes,
            handler_notes_last_edited_by: currentUser,
            handler_notes_last_edited_at: new Date().toISOString()
          })
          .eq('id', legacyId);
        
        if (updateError) {
          console.error('Error updating handler notes with tracking:', updateError);
          
          // Fallback: try without tracking columns
          const { error: fallbackError } = await supabase
            .from('leads_lead')
            .update({ handler_notes: notes })
            .eq('id', legacyId);
          
          if (fallbackError) {
            console.error('Error updating handler notes (fallback):', fallbackError);
            throw fallbackError;
          }
        }
      } catch (error) {
        console.error('Error in handleSaveHandlerNotes:', error);
        throw error;
      }
    } else {
      // For new leads, save to leads table with tracking
      try {
        // First, try to update with tracking columns
        const { error: updateError } = await supabase
          .from('leads')
          .update({ 
            handler_notes: notes,
            handler_notes_last_edited_by: currentUser,
            handler_notes_last_edited_at: new Date().toISOString()
          })
          .eq('id', client.id);
        
        if (updateError) {
          console.error('Error updating handler notes with tracking (new leads):', updateError);
          
          // Fallback: try without tracking columns
          const { error: fallbackError } = await supabase
            .from('leads')
            .update({ handler_notes: notes })
            .eq('id', client.id);
          
          if (fallbackError) {
            console.error('Error updating handler notes (fallback - new leads):', fallbackError);
            throw fallbackError;
          }
        }
      } catch (error) {
        console.error('Error in handleSaveHandlerNotes (new leads):', error);
        throw error;
      }
    }
    
    if (onClientUpdate) await onClientUpdate();
  };

  // Expert Notes logic
  const handleSaveExpertNote = async () => {
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
  };

  // The main upload function
  const uploadFiles = async (files: File[]) => {
    setIsUploading(true);
    const newUploads = files.map(file => ({ name: file.name, status: 'uploading' as const, progress: 0 }));
    setUploadedFiles(prev => [...prev, ...newUploads]);

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('leadNumber', client.lead_number);

        const { data, error } = await supabase.functions.invoke('upload-to-onedrive', {
          body: formData,
        });

        if (error) throw new Error(error.message);
        if (!data || !data.success) {
          throw new Error(data.error || 'Upload function returned an error.');
        }

        const folderUrl = data.folderUrl;
        if (folderUrl && folderUrl !== client.onedrive_folder_link) {
            // Get current user for tracking who uploaded documents
            const currentUser = await getCurrentUserName();
            
            // Check if this is a legacy lead
            const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
            
            if (isLegacyLead) {
              // For legacy leads, save to leads_lead table using the actual integer ID
              const legacyId = client.id.toString().replace('legacy_', '');
              await supabase
                  .from('leads_lead')
                  .update({ 
                      onedrive_folder_link: folderUrl,
                      // Update new AI notification columns
                      documents_uploaded_date: new Date().toISOString(),
                      documents_uploaded_by: currentUser
                  })
                  .eq('id', legacyId);
            } else {
              // For new leads, save to leads table
              await supabase
                  .from('leads')
                  .update({ 
                      onedrive_folder_link: folderUrl,
                      // Update new AI notification columns
                      documents_uploaded_date: new Date().toISOString(),
                      documents_uploaded_by: currentUser
                  })
                  .eq('id', client.id);
            }
            
            if (onClientUpdate) {
                await onClientUpdate();
            }
        }

        // Update file status to success
        setUploadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'success', progress: 100 } : f));
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        // Update file status to error
        setUploadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'error', error: errorMessage } : f));
        console.error(`Error uploading ${file.name}:`, err);
      }
    }
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
  const selectedEligibilityLabel = eligibilityOptions.find(opt => opt.value === eligibilityStatus.value)?.label || '';
  
  // Check if this is a legacy lead
  const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
  
  const statusDisplay = eligibilityStatus.value === 'not_feasible'
    ? selectedEligibilityLabel || 'No feasibility'
    : (isLegacyLead 
      ? (eligibilityStatus.value ? selectedEligibilityLabel : 'Not checked')
      : (selectedSection && eligibilityStatus.value
        ? `${selectedSectionLabel} - ${selectedEligibilityLabel}`
        : 'Not checked')
    );

  const selectedEligibility = eligibilityOptions.find(opt => opt.value === eligibilityStatus.value);

  // Function to update document count from DocumentModal
  const handleDocumentCountChange = (count: number) => {
    setDocumentCount(count);
  };

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg">
          <AcademicCapIcon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Expert Assignment</h2>
          <p className="text-sm text-gray-500">Case evaluation and expert opinions</p>
        </div>
      </div>

      {/* Expert Information */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="pl-6 pt-2 pb-2 w-2/5">
          <h4 className="text-lg font-semibold text-black">Expert Information</h4>
          <div className="border-b border-gray-200 mt-2"></div>
        </div>
        <div className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-base font-medium text-gray-500 uppercase tracking-wide">Assigned Expert</label>
                <span className="text-2xl font-bold text-gray-900">{expertName}</span>
                {(!expertName || expertName === '---' || expertName === 'Not assigned') && (
                  <button
                    className="btn btn-sm text-white border-none"
                    style={{ backgroundColor: '#3b28c7' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2d1b69'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3b28c7'}
                    onClick={handleAssignRandomExpert}
                    disabled={isAssigningExpert}
                  >
                    {isAssigningExpert ? 'Assigning...' : 'I need an expert'}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-base font-medium text-gray-500 uppercase tracking-wide">Eligibility Status</label>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-base font-medium ${
                  eligibilityStatus.value === 'Not checked' ? 'bg-gray-100 text-gray-800' :
                  eligibilityStatus.value.includes('feasible_no_check') ? 'bg-green-100 text-green-800' :
                  eligibilityStatus.value.includes('feasible_check') ? 'bg-yellow-100 text-yellow-800' :
                  eligibilityStatus.value.includes('not_feasible') ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {statusDisplay}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              {/* Documents Link button for legacy leads */}
              {hasDocsUrl && (
                <button
                  onClick={() => window.open(docsUrl, '_blank')}
                  className="btn btn-outline bg-white shadow-sm w-full"
                  style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f3f0ff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'white';
                  }}
                  title="Open Documents Link"
                >
                  <PaperClipIcon className="w-5 h-5" />
                  Documents Link
                </button>
              )}
              
              <button
                onClick={() => setIsDocumentModalOpen(true)}
                className={`btn btn-outline bg-white shadow-sm w-full ${!hasDocumentLink ? 'btn-disabled' : ''}`}
                style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = '#f3f0ff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!e.currentTarget.disabled) {
                    e.currentTarget.style.backgroundColor = 'white';
                  }
                }}
                disabled={!hasDocumentLink}
              >
                <FolderIcon className="w-5 h-5" />
                Documents
                <span className="badge text-white ml-2" style={{ backgroundColor: '#3b28c7' }}>{documentCount}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Section Eligibility and Document Upload Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Section Eligibility */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="pl-6 pt-2 pb-2 w-2/5">
            <h4 className="text-lg font-semibold text-black">Section Eligibility</h4>
            <div className="border-b border-gray-200 mt-2"></div>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {/* Eligibility Dropdown */}
              <div className="space-y-2">
                <label className="text-base font-medium text-gray-500 uppercase tracking-wide">Eligibility Assessment</label>
                <select 
                  className="select select-bordered w-full"
                  value={eligibilityStatus.value}
                  onChange={(e) => handleEligibilityChange(e.target.value)}
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
              
              {/* Citizenship Section Dropdown */}
              <div className="space-y-2">
                <label className="text-base font-medium text-gray-500 uppercase tracking-wide">
                  Citizenship Section
                  {isLegacyLead && (
                    <span className="text-sm font-normal text-gray-400 ml-2">(Optional)</span>
                  )}
                </label>
                <div className="relative">
                  <select 
                    className="select select-bordered w-full"
                    value={selectedSection}
                    onChange={(e) => handleSectionChange(e.target.value)}
                    disabled={!eligibilityStatus.value || eligibilityStatus.value === 'not_feasible'}
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
                  <HashtagIcon className="w-5 h-5 absolute right-10 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400" />
                </div>
              </div>
              
              {/* Timestamp */}
              {eligibilityStatus.timestamp && (
                <div className="text-sm text-gray-400 flex justify-between border-t border-gray-100 pt-3">
                  <span>Last updated: {new Date(eligibilityStatus.timestamp).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Document Upload Section */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="pl-6 pt-2 pb-2 w-2/5">
            <h4 className="text-lg font-semibold text-black">Document Upload</h4>
            <div className="border-b border-gray-200 mt-2"></div>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {/* Upload Area */}
              <div 
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors duration-200 ${
                  isUploading 
                    ? 'bg-gray-50 border-gray-300' 
                    : 'bg-gray-50 border-gray-300'
                }`}
                style={{
                  borderColor: isUploading ? '#3b28c7' : '',
                  backgroundColor: isUploading ? '#f3f0ff' : ''
                }}
                onMouseEnter={(e) => {
                  if (!isUploading) {
                    e.currentTarget.style.borderColor = '#3b28c7';
                    e.currentTarget.style.backgroundColor = '#f3f0ff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isUploading) {
                    e.currentTarget.style.borderColor = '#d1d5db';
                    e.currentTarget.style.backgroundColor = '#f9fafb';
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={handleFileDrop}
              >
                <DocumentArrowUpIcon className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                <div className="text-base text-gray-600 mb-4">
                  {isUploading ? 'Processing files...' : 'Drag and drop files here, or click to select files'}
                </div>
                <input
                  type="file"
                  className="hidden"
                  id="file-upload"
                  multiple
                  onChange={handleFileInput}
                  disabled={isUploading}
                />
                <label
                  htmlFor="file-upload"
                  className={`btn btn-outline bg-white ${isUploading ? 'btn-disabled' : ''}`}
                  style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                  onMouseEnter={(e) => {
                    if (!isUploading) {
                      e.currentTarget.style.backgroundColor = '#f3f0ff';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isUploading) {
                      e.currentTarget.style.backgroundColor = 'white';
                    }
                  }}
                >
                  <PaperClipIcon className="w-5 h-5" />
                  Choose Files
                </label>
              </div>

              {/* Uploaded Files List */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center gap-3">
                        <PaperClipIcon className="w-5 h-5" style={{ color: '#3b28c7' }} />
                        <span className="text-base font-medium text-gray-900">{file.name}</span>
                      </div>
                      <div>
                        {file.status === 'uploading' && (
                          <div className="radial-progress" style={{ "--value": file.progress || 0, color: '#3b28c7' } as any}>
                            {file.progress || 0}%
                          </div>
                        )}
                        {file.status === 'success' && (
                          <CheckCircleIcon className="w-6 h-6 text-green-500" />
                        )}
                        {file.status === 'error' && (
                          <div className="tooltip" data-tip={file.error}>
                            <XCircleIcon className="w-6 h-6 text-red-500" />
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
      </div>

      {/* Expert Notes Row */}
      <div className="grid grid-cols-1 gap-6">
        {/* Expert Opinion Notes */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="pl-6 pt-2 pb-2 w-2/5">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold text-black">Expert Notes</h4>
              <div className="flex gap-2">
                {!isAddingExpertNote && !editingExpertNoteId && (
                  <button 
                    className="btn btn-ghost btn-md bg-transparent hover:bg-transparent shadow-none"
                    onClick={() => {
                      setIsAddingExpertNote(true);
                      setNewExpertNoteContent('');
                    }}
                  >
                    <PencilSquareIcon className="w-5 h-5 text-black" />
                  </button>
                )}
              </div>
            </div>
            <div className="border-b border-gray-200 mt-2"></div>
          </div>
          <div className="p-6">
            {/* Add/Edit Expert Note Form */}
            {(isAddingExpertNote || editingExpertNoteId) && (
              <div className="mb-6">
                <textarea
                  className="textarea textarea-bordered w-full h-32 mb-3"
                  placeholder="Enter your note..."
                  value={newExpertNoteContent}
                  onChange={(e) => setNewExpertNoteContent(e.target.value)}
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
            <div className="space-y-4 overflow-y-auto max-h-[300px]">
              {expertNotes.length > 0 ? (
                expertNotes.map((note, index) => (
                  <div 
                    key={note.id} 
                    className={`relative p-4 rounded-lg transition-all duration-200 hover:shadow-sm ${
                      editingExpertNoteId === note.id ? 'ring-2 ring-purple-200 bg-purple-50' : 'bg-white'
                    }`}
                    style={editingExpertNoteId === note.id ? { '--tw-ring-color': '#3b28c7', '--tw-ring-opacity': '0.2' } as React.CSSProperties : {}}
                  >
                    {/* Note Content */}
                    {editingExpertNoteId === note.id ? (
                      <textarea
                        className="textarea textarea-bordered w-full h-32 mb-3"
                        value={newExpertNoteContent}
                        onChange={(e) => setNewExpertNoteContent(e.target.value)}
                      />
                    ) : (
                      <div className="p-4">
                        <p className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed">{formatNoteText(note.content)}</p>
                      </div>
                    )}

                    {/* Note Footer */}
                    {note.edited_by && (
                      <div className="mt-3 pt-2 bg-[#391BCB] rounded-b-lg -mx-4 -mb-4 px-4 pb-3">
                        <div className="flex items-center gap-2 text-sm text-white">
                          <span className="font-medium">Edited by {note.edited_by}</span>
                          <span>•</span>
                          <span>{note.timestamp}</span>
                          {note.edited_at && note.edited_at !== note.timestamp && (
                            <>
                              <span>•</span>
                              <span>Updated: {note.edited_at}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="min-h-[80px]">
                    <p className="text-lg font-medium mb-1">No expert notes yet</p>
                    <p className="text-base">Expert opinions and assessments will appear here</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Handler Notes Row */}
      <div className="grid grid-cols-1 gap-6">
        {/* Handler Opinion Section */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="pl-6 pt-2 pb-2 w-2/5">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold text-black">Handler Notes</h4>
              {!isAddingHandlerNote && !editingHandlerNoteId && (
                <button
                  className="btn btn-ghost btn-md bg-transparent hover:bg-transparent shadow-none"
                  onClick={() => {
                    setIsAddingHandlerNote(true);
                    setNewHandlerNoteContent('');
                  }}
                  title="Add Handler Note"
                >
                  <PencilSquareIcon className="w-5 h-5 text-black" />
                </button>
              )}
            </div>
            <div className="border-b border-gray-200 mt-2"></div>
          </div>
          <div className="p-6">
            {/* Add/Edit Handler Note Form */}
            {(isAddingHandlerNote || editingHandlerNoteId) && (
              <div className="mb-6">
                <textarea
                  className="textarea textarea-bordered w-full h-32 mb-3"
                  placeholder="Enter your note..."
                  value={newHandlerNoteContent}
                  onChange={(e) => setNewHandlerNoteContent(e.target.value)}
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
            <div className="space-y-4 overflow-y-auto max-h-[300px]">
              {handlerNotes.length > 0 ? (
                handlerNotes.map((note, index) => (
                  <div 
                    key={note.id} 
                    className="relative p-4 rounded-lg transition-all duration-200 hover:shadow-sm bg-white"
                  >
                    {/* Note Content */}
                    <div className="p-4">
                      <p className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed">{formatNoteText(note.content)}</p>
                    </div>

                    {/* Note Footer */}
                    {note.edited_by && (
                      <div className="mt-3 pt-2 bg-[#391BCB] rounded-b-lg -mx-4 -mb-4 px-4 pb-3">
                        <div className="flex items-center gap-2 text-sm text-white">
                          <span className="font-medium">Edited by {note.edited_by}</span>
                          <span>•</span>
                          <span>{note.timestamp}</span>
                          {note.edited_at && note.edited_at !== note.timestamp && (
                            <>
                              <span>•</span>
                              <span>Updated: {note.edited_at}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="min-h-[80px]">
                    <p className="text-lg font-medium mb-1">No handler notes yet</p>
                    <p className="text-base">Case handling notes and updates will appear here</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>



      {/* Document Modal */}
      <DocumentModal
        isOpen={isDocumentModalOpen}
        onClose={() => setIsDocumentModalOpen(false)}
        leadNumber={client.lead_number || ''}
        clientName={client.name || ''}
        onDocumentCountChange={handleDocumentCountChange}
      />
      
      <TimelineHistoryButtons client={client} />
    </div>
  );
};

export default ExpertTab; 