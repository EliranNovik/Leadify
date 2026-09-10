import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArchiveBoxIcon,
  ClockIcon,
  DocumentCheckIcon,
  DocumentDuplicateIcon,
  FolderOpenIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import { FaFileWord } from 'react-icons/fa';
import toast from 'react-hot-toast';
import DocumentModal from './DocumentModal';
import ClientPortalAdminCard from './portal/ClientPortalAdminCard';
import { SubEffortsLogModal } from './SubEffortsLogModal';
import { CLIENT_HEADER_ONEDRIVE_SUBFOLDER } from '../lib/leadOneDrivePaths';
import { supabase } from '../lib/supabase';
import { fetchStageActorInfo } from '../lib/leadStageManager';
import {
  addLeadSubEffortRow,
  dedupeLeadSubEffortRows,
  ensureLeadSubEffortRows,
  fetchActiveSubEffortTemplates,
  fetchSubEffortsForMiscCategory,
  leadSubEffortIdentity,
  removeLeadSubEffortRow,
  resolveLeadMiscCategoryId,
} from '../lib/leadSubEfforts';

const TAB_BASE =
  'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors whitespace-nowrap';
const TAB_IDLE = `${TAB_BASE} bg-transparent text-gray-600 hover:text-gray-900`;
const TAB_ACTIVE = `${TAB_BASE} bg-white text-gray-900 shadow-sm`;

const LEAD_SUB_EFFORT_SELECT = `
  id,
  legacy_lead_id,
  new_lead_id,
  employee_id,
  created_at,
  created_by,
  updated_by,
  updated_at,
  internal,
  active,
  sort_order,
  document_url,
  internal_notes,
  client_notes,
  sub_effort_id,
  sub_efforts (
    id,
    name,
    sort_order,
    percentage,
    description,
    default_client_visible,
    sub_category_efforts (
      id,
      name,
      sort_order
    )
  ),
  tenants_employee ( id, display_name, photo_url, photo )
`;

type Props = {
  leadPathId: string;
  clientName?: string | null;
  clientId?: string | number | null;
  leadNumber?: string | null;
  leadType?: string | null;
  leadStage?: string | number | null;
  categoryId?: unknown;
};

export default function LeadSubpageQuickNav({
  leadPathId,
  clientName,
  clientId,
  leadNumber,
  leadType,
  leadStage,
  categoryId,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [subEffortsOpen, setSubEffortsOpen] = useState(false);
  const [leadSubEfforts, setLeadSubEfforts] = useState<any[]>([]);
  const [categoryLinkedCount, setCategoryLinkedCount] = useState(0);
  const [subEffortOptions, setSubEffortOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [isLoadingSubEffortOptions, setIsLoadingSubEffortOptions] = useState(false);
  const [isAddingSubEffort, setIsAddingSubEffort] = useState(false);
  const [isRemovingSubEffort, setIsRemovingSubEffort] = useState(false);
  const provisionKeyRef = useRef<string | null>(null);

  const encoded = encodeURIComponent(leadPathId);
  const base = `/clients/${encoded}`;
  const path = location.pathname;
  const docsLeadNumber = String(leadNumber || leadPathId || '').trim();
  const leadMiscCategoryId = useMemo(
    () => resolveLeadMiscCategoryId({ category_id: categoryId }),
    [categoryId],
  );
  const identityClient = useMemo(
    () => ({ id: clientId, lead_type: leadType }),
    [clientId, leadType],
  );

  const openDocuments = () => {
    if (!docsLeadNumber) {
      toast.error('Add a lead number to use documents.');
      return;
    }
    setDocumentsOpen(true);
  };

  const fetchLeadSubEfforts = useCallback(async () => {
    if (clientId == null || String(clientId) === '') return;

    const { legacyId, newLeadId } = leadSubEffortIdentity(identityClient);
    if (!legacyId && !newLeadId) return;

    const provisionKey = `${String(clientId)}:${leadMiscCategoryId ?? 'none'}`;
    try {
      const selectWithManual = LEAD_SUB_EFFORT_SELECT.replace(
        'sub_effort_id,',
        'sub_effort_id,\n                    manually_added,',
      );
      const buildQuery = (selectQuery: string) => {
        let q = supabase
          .from('lead_sub_efforts')
          .select(selectQuery)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(500);
        if (legacyId) q = q.eq('legacy_lead_id', legacyId);
        else if (newLeadId) q = q.eq('new_lead_id', newLeadId);
        return q;
      };

      let q = buildQuery(selectWithManual);
      let { data, error } = await q;
      if (error && /manually_added/i.test(String(error.message ?? ''))) {
        q = buildQuery(LEAD_SUB_EFFORT_SELECT);
        ({ data, error } = await q);
      }
      if (error) throw error;
      let rows = (data as any[]) ?? [];

      const catalog = leadMiscCategoryId
        ? await fetchSubEffortsForMiscCategory(supabase, leadMiscCategoryId)
        : [];
      setCategoryLinkedCount(catalog.length);

      if (catalog.length > 0 && provisionKeyRef.current !== provisionKey) {
        const actor = await fetchStageActorInfo();
        const inserted = await ensureLeadSubEffortRows(supabase, {
          catalog,
          legacyLeadId: legacyId,
          newLeadId,
          actor,
        });
        provisionKeyRef.current = provisionKey;
        if (inserted) {
          const { data: refreshed, error: refreshError } = await q;
          if (refreshError) throw refreshError;
          rows = (refreshed as any[]) ?? [];
        }
      }

      if (catalog.length > 0) {
        const allowedIds = new Set(catalog.map((item) => item.id));
        rows = rows.filter((row) => {
          const id = Number((row as any)?.sub_effort_id ?? (row as any)?.sub_efforts?.id);
          if (!Number.isFinite(id) || id <= 0) return false;
          if (allowedIds.has(id)) return true;
          return Boolean((row as any)?.manually_added);
        });
      }

      setLeadSubEfforts(dedupeLeadSubEffortRows(rows));
    } catch (e) {
      console.error('Error fetching lead_sub_efforts:', e);
    }
  }, [clientId, identityClient, leadMiscCategoryId]);

  useEffect(() => {
    provisionKeyRef.current = null;
  }, [clientId, leadMiscCategoryId]);

  useEffect(() => {
    if (!subEffortsOpen) return;
    void fetchLeadSubEfforts();
  }, [subEffortsOpen, fetchLeadSubEfforts]);

  useEffect(() => {
    if (!subEffortsOpen) return;
    let cancelled = false;
    setIsLoadingSubEffortOptions(true);
    void (async () => {
      try {
        const opts = await fetchActiveSubEffortTemplates(supabase);
        if (!cancelled) setSubEffortOptions(opts.map((o) => ({ id: o.id, name: o.name })));
      } catch (e) {
        console.error('Failed to load sub effort templates:', e);
        if (!cancelled) setSubEffortOptions([]);
      } finally {
        if (!cancelled) setIsLoadingSubEffortOptions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subEffortsOpen]);

  const handleAddLeadSubEffort = useCallback(
    async (opt: { id: number; name: string }) => {
      const { legacyId, newLeadId } = leadSubEffortIdentity(identityClient);
      if (!legacyId && !newLeadId) {
        toast.error('Cannot add sub effort: lead identity missing');
        return null;
      }
      setIsAddingSubEffort(true);
      try {
        const actor = await fetchStageActorInfo();
        const newId = await addLeadSubEffortRow(supabase, {
          subEffortId: opt.id,
          legacyLeadId: legacyId,
          newLeadId,
          actor,
        });
        await fetchLeadSubEfforts();
        if (newId == null) {
          toast.error('Sub effort already on this lead');
          return null;
        }
        toast.success(`Added “${opt.name}”`);
        return newId;
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : 'Failed to add sub effort');
        return null;
      } finally {
        setIsAddingSubEffort(false);
      }
    },
    [identityClient, fetchLeadSubEfforts],
  );

  const handleRemoveLeadSubEffort = useCallback(
    async (rowId: string | number) => {
      const row = leadSubEfforts.find((r) => String(r?.id) === String(rowId));
      const name = String(row?.sub_efforts?.name ?? row?.name ?? '').trim() || 'this sub effort';
      if (!window.confirm(`Remove “${name}” from this lead’s workflow? This does not delete the template.`)) {
        return;
      }
      setIsRemovingSubEffort(true);
      try {
        await removeLeadSubEffortRow(supabase, rowId);
        await fetchLeadSubEfforts();
        toast.success('Sub effort removed');
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : 'Failed to remove sub effort');
      } finally {
        setIsRemovingSubEffort(false);
      }
    },
    [leadSubEfforts, fetchLeadSubEfforts],
  );

  const openSubEfforts = () => {
    if (clientId == null || String(clientId) === '') {
      toast.error('Lead is still loading.');
      return;
    }
    setSubEffortsOpen(true);
  };

  const wordActive = path.includes('/word-document');
  const tabs: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    active: boolean;
    onClick: () => void;
  }> = [
    {
      key: 'timeline',
      label: 'Timeline',
      icon: <ClockIcon className="h-4 w-4" />,
      active: path.includes('/timeline'),
      onClick: () => navigate(`${base}/timeline`),
    },
    {
      key: 'history',
      label: 'History',
      icon: <ArchiveBoxIcon className="h-4 w-4" />,
      active: path.includes('/history'),
      onClick: () => navigate(`${base}/history`),
    },
    {
      key: 'documents',
      label: 'Documents',
      icon: <FolderOpenIcon className="h-4 w-4" />,
      active: documentsOpen,
      onClick: openDocuments,
    },
    {
      key: 'sub-efforts',
      label: 'Sub efforts',
      icon: <DocumentCheckIcon className="h-4 w-4" />,
      active: subEffortsOpen,
      onClick: openSubEfforts,
    },
    {
      key: 'word',
      label: 'Create Word document',
      icon: <FaFileWord className="h-4 w-4 text-[#185ABD]" />,
      active: wordActive,
      onClick: () => navigate(`${base}/word-document`),
    },
    {
      key: 'duplicates',
      label: 'Duplicate contacts',
      icon: <DocumentDuplicateIcon className="h-4 w-4" />,
      active: path.includes('/duplicates'),
      onClick: () => navigate(`${base}/duplicates`),
    },
    {
      key: 'portal',
      label: 'Client portal',
      icon: <LinkIcon className="h-4 w-4" />,
      active: portalOpen,
      onClick: () => setPortalOpen(true),
    },
  ];

  return (
    <>
      <div className="mb-4 md:mb-8 flex w-full justify-center">
      <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-1 rounded-xl bg-gray-200 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={tab.active ? TAB_ACTIVE : TAB_IDLE}
            onClick={tab.onClick}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      </div>

      <DocumentModal
        isOpen={documentsOpen}
        onClose={() => setDocumentsOpen(false)}
        leadNumber={docsLeadNumber}
        clientName={clientName || ''}
        clientId={clientId != null ? String(clientId) : null}
        onedriveSubFolder={CLIENT_HEADER_ONEDRIVE_SUBFOLDER}
        modalTitle="Case documents"
        requireCaseDocumentClassification
      />

      <SubEffortsLogModal
        open={subEffortsOpen}
        onClose={() => setSubEffortsOpen(false)}
        rows={leadSubEfforts}
        leadNumber={docsLeadNumber}
        clientName={clientName || null}
        leadStage={leadStage ?? null}
        clientId={clientId != null ? String(clientId) : null}
        onRefresh={() => void fetchLeadSubEfforts()}
        categoryLinkedCount={categoryLinkedCount}
        hasLeadCaseType={leadMiscCategoryId != null}
        subEffortOptions={subEffortOptions}
        isLoadingSubEffortOptions={isLoadingSubEffortOptions}
        isAddingSubEffort={isAddingSubEffort}
        onAddSubEffort={handleAddLeadSubEffort}
        isRemovingSubEffort={isRemovingSubEffort}
        onRemoveSubEffort={handleRemoveLeadSubEffort}
      />

      {clientId != null && String(clientId) !== '' ? (
        <ClientPortalAdminCard
          leadId={String(clientId)}
          leadType={leadType}
          leadNumber={leadNumber || leadPathId}
          open={portalOpen}
          onOpenChange={setPortalOpen}
          showTrigger={false}
        />
      ) : null}
    </>
  );
}
