import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { getStageName, getStageColour, areStagesEquivalent } from '../lib/stageUtils';
import { updateLeadStageWithHistory, fetchStageActorInfo } from '../lib/leadStageManager';
import { addToHighlights, removeFromHighlights, isInHighlights } from '../lib/highlightsUtils';
import ClientHeader from './ClientHeader';
import ContactsTab from './case-manager/ContactsTab';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface LeadDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string | number;
  leadName?: string;
}

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
  lead_type?: 'new' | 'legacy';
  master_id?: string | number | null;
  [key: string]: any;
}

const LeadDetailsModal: React.FC<LeadDetailsModalProps> = ({ isOpen, onClose, leadId, leadName }) => {
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [isInHighlightsState, setIsInHighlightsState] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [nextDuePayment, setNextDuePayment] = useState<any>(null);
  const [duplicateContacts, setDuplicateContacts] = useState<any[]>([]);
  const [isSubLead, setIsSubLead] = useState(false);
  const [isMasterLead, setIsMasterLead] = useState(false);
  const [masterLeadNumber, setMasterLeadNumber] = useState<string | null>(null);
  const [subLeadsCount, setSubLeadsCount] = useState(0);
  const [uploadingLeadId, setUploadingLeadId] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{ [leadId: string]: any[] }>({});
  const [isUploading, setIsUploading] = useState(false);

  // Fetch reference data
  const fetchReferenceData = async () => {
    try {
      // Fetch employees
      const { data: employeesData } = await supabase
        .from('tenants_employee')
        .select('id, display_name, official_name, photo_url, photo')
        .order('display_name');

      if (employeesData) {
        setAllEmployees(employeesData);
      }

      // Fetch categories
      const { data: categoriesData } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id(id, name)
        `)
        .order('name');

      if (categoriesData) {
        setAllCategories(categoriesData);
      }

      // Check if user is superuser
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userData } = await supabase
          .from('users')
          .select('is_superuser')
          .eq('auth_id', user.id)
          .single();

        if (userData) {
          setIsSuperuser(userData.is_superuser || false);
        }
      }
    } catch (error) {
      console.error('Error fetching reference data:', error);
    }
  };

  // Fetch the lead data
  const fetchLead = async () => {
    if (!leadId) return;

    setLoading(true);
    try {
      const leadIdStr = String(leadId);
      const isLegacy = leadIdStr.startsWith('legacy_');
      const actualLeadId = isLegacy ? leadIdStr.replace('legacy_', '') : leadIdStr;

      if (isLegacy) {
        // Fetch legacy lead
        const legacyIdNum = parseInt(actualLeadId, 10);
        const { data: legacyLeadData, error: legacyError } = await supabase
          .from('leads_lead')
          .select('*')
          .eq('id', legacyIdNum)
          .single();

        if (legacyError) throw legacyError;

        if (legacyLeadData) {
          const lead: HandlerLead = {
            ...legacyLeadData,
            id: `legacy_${legacyLeadData.id}`, // Ensure ID is a string with legacy_ prefix (set after spread to override)
            lead_number: String(legacyLeadData.id),
            name: legacyLeadData.name || 'Unknown',
            email: legacyLeadData.email,
            phone: legacyLeadData.phone,
            category: legacyLeadData.category,
            topic: legacyLeadData.topic,
            stage: String(legacyLeadData.stage || ''),
            handler_stage: String(legacyLeadData.stage || ''),
            created_at: legacyLeadData.cdate || '',
            balance: legacyLeadData.total || 0,
            balance_currency: '₪',
            lead_type: 'legacy',
            master_id: legacyLeadData.master_id
          };
          setSelectedClient(lead);
          
          // Check highlights after setting client
          const highlightsState = await isInHighlights(
            parseInt(actualLeadId),
            true
          );
          setIsInHighlightsState(highlightsState);
        }
      } else {
        // Fetch new lead
        const { data: newLeadData, error: newLeadError } = await supabase
          .from('leads')
          .select('*')
          .eq('id', actualLeadId)
          .single();

        if (newLeadError) throw newLeadError;

        if (newLeadData) {
          const lead: HandlerLead = {
            ...newLeadData,
            id: String(newLeadData.id), // Ensure ID is a string for ContactsTab (set after spread to override)
            lead_number: newLeadData.lead_number || String(newLeadData.id),
            name: newLeadData.name || 'Unknown',
            email: newLeadData.email,
            phone: newLeadData.phone,
            category: newLeadData.category,
            topic: newLeadData.topic,
            stage: String(newLeadData.stage || ''),
            handler_stage: String(newLeadData.stage || ''),
            created_at: newLeadData.created_at || '',
            balance: newLeadData.balance || 0,
            balance_currency: newLeadData.balance_currency || '₪',
            lead_type: 'new',
            master_id: newLeadData.master_id
          };
          setSelectedClient(lead);
          
          // Check highlights after setting client
          const highlightsState = await isInHighlights(
            actualLeadId,
            false
          );
          setIsInHighlightsState(highlightsState);
        }
      }

      // Fetch next payment
      // TODO: Implement payment fetching logic

      // Check for subleads/master lead
      // TODO: Implement sublead/master lead logic

    } catch (error: any) {
      console.error('Error fetching lead:', error);
      toast.error('Failed to load lead details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && leadId) {
      fetchReferenceData();
      fetchLead();
    }
  }, [isOpen, leadId]);

  // Helper functions
  const getEmployeeDisplayName = (id: string | number | null | undefined): string => {
    if (!id) return '---';
    const employee = allEmployees.find((emp: any) => {
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const searchId = typeof id === 'string' ? parseInt(id, 10) : id;
      if (isNaN(Number(searchId))) return false;
      return empId === searchId || Number(empId) === Number(searchId);
    });
    return employee?.display_name || '---';
  };

  const getStageBadge = (stage: string | number, anchor?: 'badge' | 'mobile' | 'desktop') => {
    const stageStr = String(stage);
    const stageName = getStageName(stageStr);
    const stageColor = getStageColour(stageStr);
    const textColor = '#ffffff';

    return (
      <span
        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold"
        style={{ backgroundColor: stageColor, color: textColor }}
      >
        {stageName}
      </span>
    );
  };

  const currentStageName = selectedClient ? getStageName(String(selectedClient.stage)) : '';

  const refreshClientData = async (clientId: number | string) => {
    await fetchLead();
  };

  const updateLeadStage = async (newStage: string) => {
    if (!selectedClient) return;

    try {
      const stageId = await fetchStageActorInfo(newStage);
      if (!stageId) {
        toast.error('Invalid stage');
        return;
      }

      const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
      const actualLeadId = isLegacy
        ? (typeof selectedClient.id === 'string' ? parseInt(selectedClient.id.replace('legacy_', '')) : selectedClient.id)
        : selectedClient.id;

      await updateLeadStageWithHistory({
        leadId: actualLeadId,
        isLegacyLead: isLegacy,
        newStage: stageId,
        actor: 'System',
        timestamp: new Date().toISOString(),
      });

      await fetchLead();
      toast.success('Stage updated successfully');
    } catch (error: any) {
      console.error('Error updating lead stage:', error);
      toast.error('Failed to update lead stage');
    }
  };

  const handleStartCase = () => {
    updateLeadStage('Handler Started');
  };

  const handleActivation = async () => {
    if (!selectedClient) return;
    // TODO: Implement activation logic
    toast.info('Activation functionality to be implemented');
  };

  const uploadFiles = async (lead: HandlerLead, files: File[]) => {
    // TODO: Implement file upload
    toast.info('File upload functionality to be implemented');
  };

  const handleFileInput = (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => {
    // TODO: Implement file input handling
  };

  const refreshLeads = async () => {
    await fetchLead();
  };

  const refreshDashboardData = async () => {
    // Not needed in modal context
  };

  const getStageDisplayName = (stage: string | number | null | undefined): string => {
    if (!stage && stage !== 0) return 'No Stage';
    return getStageName(String(stage));
  };

  const handleCaseSelect = (lead: HandlerLead) => {
    // Not needed in modal context
  };

  if (!isOpen) return null;

  // Ensure lead ID is always a string for ContactsTab compatibility
  const normalizedLead = selectedClient ? {
    ...selectedClient,
    id: String(selectedClient.id || '')
  } : null;

  const tabProps = {
    leads: normalizedLead ? [normalizedLead] : [],
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
      await fetchLead();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-full max-w-[95vw] h-[95vh] my-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">
            {leadName || selectedClient?.name || 'Lead Details'}
          </h2>
          <button
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="loading loading-spinner loading-lg text-primary"></div>
                <p className="mt-4 text-gray-600">Loading lead details...</p>
              </div>
            </div>
          ) : normalizedLead ? (
            <div className="space-y-8">
              {/* ClientHeader Section */}
              <div className="border-b border-gray-200 pb-8">
                <ClientHeader
                  selectedClient={normalizedLead}
                  refreshClientData={refreshClientData}
                  isSubLead={isSubLead}
                  masterLeadNumber={masterLeadNumber}
                  isMasterLead={isMasterLead}
                  subLeadsCount={subLeadsCount}
                  nextDuePayment={nextDuePayment}
                  setIsBalanceModalOpen={() => {}}
                  currentStageName={currentStageName}
                  handleStartCase={handleStartCase}
                  updateLeadStage={updateLeadStage}
                  isInHighlightsState={isInHighlightsState}
                  isSuperuser={isSuperuser}
                  setShowDeleteModal={() => {}}
                  duplicateContacts={duplicateContacts}
                  setIsDuplicateModalOpen={() => {}}
                  setIsDuplicateDropdownOpen={() => {}}
                  isDuplicateDropdownOpen={false}
                  setShowSubLeadDrawer={() => {}}
                  openEditLeadDrawer={() => {}}
                  handleActivation={handleActivation}
                  setShowUnactivationModal={() => {}}
                  renderStageBadge={getStageBadge}
                  getEmployeeDisplayName={getEmployeeDisplayName}
                  allEmployees={allEmployees}
                />
              </div>

              {/* ContactsTab Section */}
              <div className="pt-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Contacts</h3>
                <ContactsTab {...tabProps} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-600">Lead not found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeadDetailsModal;
