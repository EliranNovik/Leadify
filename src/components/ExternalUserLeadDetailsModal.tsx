import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { getStageName, getStageColour } from '../lib/stageUtils';
import { isInHighlights } from '../lib/highlightsUtils';
import ClientHeader from './ClientHeader';
import InfoTab from './client-tabs/InfoTab';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { Client } from '../types/client';

interface ExternalUserLeadDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string | number;
  leadName?: string;
}

interface FetchedLead {
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
  lead_type?: 'new' | 'legacy';
  master_id?: string | number | null;
  [key: string]: any;
}

const ExternalUserLeadDetailsModal: React.FC<ExternalUserLeadDetailsModalProps> = ({
  isOpen,
  onClose,
  leadId,
  leadName,
}) => {
  const [selectedClient, setSelectedClient] = useState<FetchedLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [isInHighlightsState, setIsInHighlightsState] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [nextDuePayment, setNextDuePayment] = useState<any>(null);
  const [isSubLead, setIsSubLead] = useState(false);
  const [isMasterLead, setIsMasterLead] = useState(false);
  const [masterLeadNumber, setMasterLeadNumber] = useState<string | null>(null);
  const [subLeadsCount, setSubLeadsCount] = useState(0);

  const fetchReferenceData = async () => {
    try {
      const { data: employeesData } = await supabase
        .from('tenants_employee')
        .select('id, display_name, official_name, photo_url, photo')
        .order('display_name');
      if (employeesData) setAllEmployees(employeesData);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userData } = await supabase
          .from('users')
          .select('is_superuser')
          .eq('auth_id', user.id)
          .single();
        if (userData) setIsSuperuser(Boolean(userData.is_superuser));
      }
    } catch (error) {
      console.error('Error fetching reference data:', error);
    }
  };

  const fetchLead = async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const leadIdStr = String(leadId);
      const isLegacy = leadIdStr.startsWith('legacy_');
      const actualLeadId = isLegacy ? leadIdStr.replace('legacy_', '') : leadIdStr;

      if (isLegacy) {
        const legacyIdNum = parseInt(actualLeadId, 10);
        const { data: legacyLeadData, error: legacyError } = await supabase
          .from('leads_lead')
          .select('*')
          .eq('id', legacyIdNum)
          .single();
        if (legacyError) throw legacyError;
        if (legacyLeadData) {
          const lead: FetchedLead = {
            ...legacyLeadData,
            id: `legacy_${legacyLeadData.id}`,
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
            master_id: legacyLeadData.master_id,
          };
          setSelectedClient(lead);
          const highlightsState = await isInHighlights(parseInt(actualLeadId, 10), true);
          setIsInHighlightsState(highlightsState);
        }
      } else {
        const { data: newLeadData, error: newLeadError } = await supabase
          .from('leads')
          .select('*')
          .eq('id', actualLeadId)
          .single();
        if (newLeadError) throw newLeadError;
        if (newLeadData) {
          const lead: FetchedLead = {
            ...newLeadData,
            id: String(newLeadData.id),
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
            master_id: newLeadData.master_id,
          };
          setSelectedClient(lead);
          const highlightsState = await isInHighlights(actualLeadId, false);
          setIsInHighlightsState(highlightsState);
        }
      }
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
    } else if (isOpen && !leadId) {
      setLoading(false);
    }
  }, [isOpen, leadId]);

  const getEmployeeDisplayName = (id: string | number | null | undefined): string => {
    if (!id) return '---';
    const employee = allEmployees.find((emp: any) => {
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const searchId = typeof id === 'string' ? parseInt(id, 10) : id;
      if (Number.isNaN(Number(searchId))) return false;
      return empId === searchId || Number(empId) === Number(searchId);
    });
    return employee?.display_name || '---';
  };

  const getStageBadge = (stage: string | number, anchor?: 'badge' | 'mobile' | 'desktop') => {
    const stageStr = String(stage);
    const stageName = getStageName(stageStr);
    const stageColor = getStageColour(stageStr);
    return (
      <span
        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold"
        style={{ backgroundColor: stageColor, color: '#ffffff' }}
      >
        {stageName}
      </span>
    );
  };

  const currentStageName = selectedClient ? getStageName(String(selectedClient.stage)) : '';
  const refreshClientData = async (_clientId: number | string) => {
    await fetchLead();
  };
  const updateLeadStage = async (_newStage: string) => {
    // Read-only for external users; no-op or optional toast
  };
  const handleStartCase = () => {};
  const handleActivation = async () => {};

  if (!isOpen) return null;

  const normalizedLead = selectedClient
    ? { ...selectedClient, id: String(selectedClient.id || '') }
    : null;

  const clientForInfoTab: Client | null = normalizedLead ? (normalizedLead as Client) : null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-[95vw] max-h-[95vh] my-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">
            {leadName || selectedClient?.name || 'Lead Details'}
          </h2>
          <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost" type="button">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="loading loading-spinner loading-lg text-primary" />
                <p className="mt-4 text-gray-600">Loading lead details...</p>
              </div>
            </div>
          ) : normalizedLead && clientForInfoTab ? (
            <div className="space-y-8">
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
                  duplicateContacts={[]}
                  setIsDuplicateModalOpen={() => {}}
                  setIsDuplicateDropdownOpen={() => {}}
                  isDuplicateDropdownOpen={false}
                  setShowSubLeadDrawer={() => {}}
                  openEditLeadDrawer={() => {}}
                  handleActivation={handleActivation}
                  setShowUnactivationModal={() => {}}
                  renderStageBadge={() => getStageBadge(normalizedLead.stage)}
                  getEmployeeDisplayName={getEmployeeDisplayName}
                  allEmployees={allEmployees}
                  hideHistoryAndTimeline
                  hideActionsDropdown
                  hideTotalValueBadge
                  disableCategoryModal
                />
              </div>
              <div className="pt-4">
                <InfoTab
                  client={clientForInfoTab}
                  allEmployees={allEmployees}
                  readOnly
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <p className="text-gray-600">Lead not found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExternalUserLeadDetailsModal;
