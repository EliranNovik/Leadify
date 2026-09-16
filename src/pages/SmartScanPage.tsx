import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { SmartScanHeader } from '../components/smart-scan/SmartScanHeader';
import { SmartScanKpis } from '../components/smart-scan/SmartScanKpis';
import { SmartScanFilters } from '../components/smart-scan/SmartScanFilters';
import { SmartScanTabs } from '../components/smart-scan/SmartScanTabs';
import { SmartScanTable } from '../components/smart-scan/SmartScanTable';
import { SmartScanBulkBar } from '../components/smart-scan/SmartScanBulkBar';
import { SmartScanReviewDrawer } from '../components/smart-scan/SmartScanReviewDrawer';
import { smartScanService } from '../lib/smartScan/smartScanService';
import { flattenGroupedScanItems, scanArrivalKey } from '../lib/smartScan/smartScanFormat';
import { buildClientRoute } from '../lib/masterLeadApi';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import {
  scanQueueBucket,
  type SmartScanItem,
  type SmartScanLeadRef,
  type SmartScanListFilters,
  type SmartScanTab,
} from '../lib/smartScan/smartScanTypes';

type KpiKey = 'scannedToday' | SmartScanTab;

type DrawerPin = {
  id: string;
  emailId?: number;
  parentDocumentId?: string;
  scanDocumentId?: string;
  splitIndex?: number;
  pageStart?: number;
  pageEnd?: number;
  suggestedFilename?: string;
};

function pinFromItem(item: SmartScanItem): DrawerPin {
  return {
    id: item.id,
    emailId: item.emailId,
    parentDocumentId: item.parentDocumentId,
    scanDocumentId: item.scanDocumentId,
    splitIndex: item.splitIndex,
    pageStart: item.pageStart,
    pageEnd: item.pageEnd,
    suggestedFilename: item.suggestedFilename,
  };
}

function drawerMatchScore(row: SmartScanItem, pin: DrawerPin): number {
  if (row.id === pin.id) return 50;
  if (pin.scanDocumentId && row.scanDocumentId === pin.scanDocumentId) return 40;
  const sameFamily =
    Boolean(pin.emailId && row.emailId === pin.emailId) ||
    Boolean(pin.parentDocumentId && (row.parentDocumentId === pin.parentDocumentId || row.scanDocumentId === pin.parentDocumentId));
  if (!sameFamily) return 0;
  if (pin.splitIndex && row.splitIndex === pin.splitIndex) return 30;
  if (pin.pageStart && pin.pageEnd && row.pageStart === pin.pageStart && row.pageEnd === pin.pageEnd) return 20;
  if (pin.suggestedFilename && row.suggestedFilename === pin.suggestedFilename) return 10;
  return 0;
}

function resolveDrawerItem(current: SmartScanItem, rows: SmartScanItem[], pin: DrawerPin | null): SmartScanItem {
  const target = pin || pinFromItem(current);
  let best: SmartScanItem | null = null;
  let score = 0;
  for (const row of rows) {
    const next = drawerMatchScore(row, target);
    if (next > score) {
      best = row;
      score = next;
    }
  }
  return best || current;
}

export default function SmartScanPage() {
  const navigate = useNavigate();
  const [allItems, setAllItems] = useState<SmartScanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SmartScanListFilters>({
    datePreset: 'all',
    sort: 'newest',
    scanner: 'all',
    status: 'all',
    documentType: 'all',
    confidence: 'all',
  });
  const [tab, setTab] = useState<SmartScanTab>('all');
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerItem, setDrawerItem] = useState<SmartScanItem | null>(null);
  const [drawerScanItems, setDrawerScanItems] = useState<SmartScanItem[] | null>(null);
  const [assigning, setAssigning] = useState(false);

  const [inboxWarning, setInboxWarning] = useState<string | null>(null);
  const allItemsRef = useRef<SmartScanItem[]>([]);
  const inflightRef = useRef(false);
  const fingerprintRef = useRef('');
  const drawerPinRef = useRef<DrawerPin | null>(null);
  const drawerGroupKeyRef = useRef<string | null>(null);
  allItemsRef.current = allItems;

  const applyRows = (rows: SmartScanItem[]) => {
    const fingerprint = rows
      .map((item) => `${item.id}:${item.status}:${item.processedAt || ''}:${item.documentType || ''}:${item.suggestedFilename || ''}`)
      .join('|');
    if (fingerprint === fingerprintRef.current) return false;
    fingerprintRef.current = fingerprint;
    setAllItems(rows);
    setInboxWarning(smartScanService.getInboxWarning() || null);
    setDrawerItem((current) => {
      if (!current) return current;
      const groupKey = drawerGroupKeyRef.current;
      if (groupKey) {
        const group = rows.filter((row) => scanArrivalKey(row) === groupKey);
        if (group.length > 1) return group.find((row) => row.id === current.id) || group[0];
      }
      return resolveDrawerItem(current, rows, drawerPinRef.current);
    });
    setDrawerScanItems(() => {
      const groupKey = drawerGroupKeyRef.current;
      if (!groupKey) return null;
      const group = rows.filter((row) => scanArrivalKey(row) === groupKey);
      return group.length > 1 ? group : null;
    });
    return true;
  };

  const load = useCallback(async (silent = false) => {
    if (silent && inflightRef.current) return;
    inflightRef.current = true;
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const rows = await smartScanService.listAll({ sync: false });
      if (silent && rows.length === 0 && allItemsRef.current.length > 0) {
        return;
      }
      applyRows(rows);
      setError(null);
    } catch (err) {
      console.error(err);
      if (!silent || allItemsRef.current.length === 0) {
        setError("We couldn't load scanned documents from scancenter@lawoffice.org.il.");
      }
    } finally {
      inflightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void smartScanService.requestBackgroundSync();
    void load(false);
  }, [load]);

  useEffect(() => {
    void load(false);
    void smartScanService.requestBackgroundSync();
  }, [load]);

  useRealtimeRefresh({
    channelName: 'smart-scan-documents',
    tables: [{ table: 'smart_scan_documents', event: '*' }],
    onChange: () => load(true),
    debounceMs: 400,
    refreshOnFocus: true,
  });

  const replaceItem = (next: SmartScanItem) => {
    setAllItems((prev) => prev.map((row) => (row.id === next.id ? next : row)));
    setDrawerItem((current) => (current?.id === next.id ? next : current));
    setDrawerScanItems((current) => current?.map((row) => (row.id === next.id ? next : row)) || current);
  };

  const kpis = useMemo(() => smartScanService.kpis(allItems), [allItems]);

  const preStatusItems = useMemo(() => {
    const search = (filters.search || '').trim().toLowerCase();
    return allItems.filter((item) => {
      if (item.ignored) return false;
      if (search) {
        const hay = [
          item.lead?.leadNumber,
          item.lead?.name,
          item.detectedPersonName,
          item.title,
          item.documentType,
          item.suggestedDocumentType,
          item.suggestedFilename,
          item.originalFilename,
          item.batchId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(search)) return false;
      }
      if (filters.scanner && filters.scanner !== 'all' && item.scannerName !== filters.scanner) return false;
      const created = new Date(item.createdAt).getTime();
      const preset = filters.datePreset || 'all';
      if (preset === 'today') {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        if (created < start.getTime()) return false;
      } else if (preset === '7d') {
        if (created < Date.now() - 7 * 24 * 60 * 60 * 1000) return false;
      } else if (preset === '30d') {
        if (created < Date.now() - 30 * 24 * 60 * 60 * 1000) return false;
      } else if (preset === 'custom') {
        if (filters.customFrom) {
          const from = new Date(filters.customFrom);
          from.setHours(0, 0, 0, 0);
          if (created < from.getTime()) return false;
        }
        if (filters.customTo) {
          const to = new Date(filters.customTo);
          to.setHours(23, 59, 59, 999);
          if (created > to.getTime()) return false;
        }
      }
      return true;
    });
  }, [allItems, filters]);

  const visibleItems = useMemo(() => {
    const statusFilter = filters.status && filters.status !== 'all' ? filters.status : tab === 'all' ? 'all' : tab;
    const rows =
      statusFilter === 'all'
        ? preStatusItems.filter((item) => scanQueueBucket(item) !== 'history')
        : preStatusItems.filter((item) => scanQueueBucket(item) === statusFilter);
    return flattenGroupedScanItems(rows, filters.sort || 'newest');
  }, [preStatusItems, filters.status, filters.sort, tab]);

  const tabCounts = useMemo(() => {
    const matched = preStatusItems.filter((item) => scanQueueBucket(item) === 'matched').length;
    const unmatched = preStatusItems.filter((item) => scanQueueBucket(item) === 'unmatched').length;
    const processing = preStatusItems.filter((item) => scanQueueBucket(item) === 'processing').length;
    const history = preStatusItems.filter((item) => scanQueueBucket(item) === 'history').length;
    return {
      all: matched + unmatched + processing,
      matched,
      unmatched,
      processing,
      history,
    };
  }, [preStatusItems]);

  const selectedItems = visibleItems.filter((item) => selectedIds.has(item.id));
  const hasSearchOrFilter =
    Boolean(filters.search?.trim()) ||
    (filters.datePreset && filters.datePreset !== 'all') ||
    (filters.status && filters.status !== 'all');

  const emptyMessage =
    !loading && allItems.length === 0
      ? 'No documents in scancenter@lawoffice.org.il yet. Scan a file and press Refresh.'
      : !loading && tab === 'unmatched' && visibleItems.length === 0 && !hasSearchOrFilter
        ? 'No unmatched scans.'
        : !loading && tab === 'matched' && visibleItems.length === 0 && !hasSearchOrFilter
          ? 'No matched scans waiting for approval.'
          : !loading && tab === 'history' && visibleItems.length === 0 && !hasSearchOrFilter
            ? 'No assigned documents in history yet.'
            : !loading && tab === 'all' && tabCounts.history > 0 && visibleItems.length === 0 && !hasSearchOrFilter
              ? `Assigned documents are under History (${tabCounts.history}).`
              : 'No scanned documents match these filters.';

  const openDrawer = (item: SmartScanItem, assign = false, group?: SmartScanItem[]) => {
    const merged = Boolean(group && group.length > 1);
    drawerPinRef.current = pinFromItem(item);
    drawerGroupKeyRef.current = merged ? scanArrivalKey(item) : null;
    setDrawerScanItems(merged ? group || null : null);
    setDrawerItem(merged ? group![0] : item);
    setAssigning(assign || item.status === 'unmatched' || item.leadMatchStatus === 'ambiguous' || item.status === 'failed');
  };

  const openLead = (item: SmartScanItem) => {
    if (!item.lead) return;
    navigate(buildClientRoute(item.lead.id, item.lead.leadNumber));
  };

  const handleKpi = (key: KpiKey) => {
    if (activeKpi === key) {
      setActiveKpi(null);
      setTab('all');
      setFilters((prev) => ({ ...prev, datePreset: 'all', status: 'all' }));
      return;
    }
    setActiveKpi(key);
    if (key === 'scannedToday') {
      setTab('all');
      setFilters((prev) => ({ ...prev, datePreset: 'today', status: 'all' }));
      return;
    }
    setTab(key);
    setFilters((prev) => ({ ...prev, status: 'all', datePreset: prev.datePreset === 'today' && key !== 'scannedToday' ? prev.datePreset : prev.datePreset }));
  };

  const handleRetry = async (id: string) => {
    try {
      const next = await smartScanService.retry(id);
      replaceItem(next);
      toast.success('AI processing started');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Could not start AI processing');
    }
  };

  const handleRemove = async (ids: string[], options?: { confirmed?: boolean }) => {
    if (!ids.length) return;
    if (
      !options?.confirmed &&
      !window.confirm(
        `Remove ${ids.length} document${ids.length === 1 ? '' : 's'} from Smart Scan? They will not be fetched again.`,
      )
    ) {
      return;
    }
    try {
      for (const id of ids) {
        await smartScanService.remove(id);
      }
      const rows = await smartScanService.listAll({ sync: false });
      applyRows(rows);
      const remainingIds = new Set(rows.map((row) => row.id));
      setSelectedIds((prev) => new Set([...prev].filter((id) => remainingIds.has(id))));
      setDrawerItem((current) => (current && remainingIds.has(current.id) ? current : null));
      setDrawerScanItems((current) => {
        if (!current) return current;
        const next = current.filter((row) => remainingIds.has(row.id));
        if (next.length <= 1) drawerGroupKeyRef.current = null;
        return next.length > 1 ? next : null;
      });
      toast.success(ids.length === 1 ? 'Document removed' : 'Documents removed');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Could not remove document');
    }
  };

  const confirmComplete = async (ids: string[]) => {
    if (!window.confirm(`Mark ${ids.length} scan${ids.length === 1 ? '' : 's'} as completed?`)) return;
    for (const id of ids) {
      const next = await smartScanService.markCompleted(id);
      replaceItem(next);
    }
    setSelectedIds(new Set());
  };

  return (
    <div className="min-h-full w-full bg-[#f3f4f6] p-4 md:p-6">
      <div className="flex w-full flex-col gap-4">
        <SmartScanHeader onRefresh={() => void refresh()} refreshing={loading} />
        {inboxWarning ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {inboxWarning}
          </div>
        ) : null}
        <SmartScanKpis kpis={kpis} active={activeKpi} onSelect={handleKpi} />
        <SmartScanFilters
          filters={filters}
          onChange={(patch) => {
            setFilters((prev) => ({ ...prev, ...patch }));
            if (patch.datePreset && patch.datePreset !== 'today' && activeKpi === 'scannedToday') {
              setActiveKpi(null);
            }
          }}
        />
        <SmartScanTabs
          active={tab}
          counts={tabCounts}
          onSelect={(next) => {
            setTab(next);
            setActiveKpi(next === 'all' ? null : next);
            setFilters((prev) => ({ ...prev, status: 'all' }));
          }}
        />
        <SmartScanBulkBar
          selectedCount={selectedItems.length}
          canApprove={selectedItems.length > 0 && selectedItems.every((item) => scanQueueBucket(item) === 'matched')}
          canRetry={selectedItems.length > 0 && selectedItems.every((item) => item.status === 'processing' || scanQueueBucket(item) === 'unmatched')}
          canAssign={selectedItems.length === 1 && scanQueueBucket(selectedItems[0]) === 'unmatched'}
          canComplete={selectedItems.length > 0 && selectedItems.every((item) => item.status !== 'processing')}
          onApprove={async () => {
            if (!window.confirm(`Approve ${selectedItems.length} scan${selectedItems.length === 1 ? '' : 's'}?`)) return;
            for (const item of selectedItems) {
              replaceItem(await smartScanService.approve(item.id));
            }
            setSelectedIds(new Set());
            toast.success('Approved and saved to Sequence of Events');
          }}
          onRetry={async () => {
            for (const item of selectedItems) {
              await handleRetry(item.id);
            }
            setSelectedIds(new Set());
          }}
          onAssign={() => {
            if (selectedItems[0]) openDrawer(selectedItems[0], true);
          }}
          onComplete={() => void confirmComplete(selectedItems.map((item) => item.id))}
          onRemove={() => void handleRemove(selectedItems.map((item) => item.id))}
          onClear={() => setSelectedIds(new Set())}
        />

        {error && visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-rose-200 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-sm text-gray-800">{error}</p>
            <button type="button" className="btn btn-sm mt-4 rounded-xl" onClick={() => void refresh()}>
              <ArrowPathIcon className="h-4 w-4" />
              Retry
            </button>
          </div>
        ) : !loading && visibleItems.length === 0 ? (
          <div className="rounded-2xl bg-white px-6 py-16 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-100">
            {emptyMessage}
          </div>
        ) : (
          <SmartScanTable
            items={visibleItems}
            loading={loading}
            selectedIds={selectedIds}
            sort={filters.sort || 'newest'}
            onToggle={(id) => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
            onToggleAll={() => {
              setSelectedIds((prev) => {
                if (visibleItems.every((item) => prev.has(item.id))) return new Set();
                return new Set(visibleItems.map((item) => item.id));
              });
            }}
            onRowClick={(item, group) => openDrawer(item, false, group)}
            onPreview={(item, group) => openDrawer(item, false, group)}
            onAssignLead={async (rows, lead) => {
              for (const item of rows) {
                replaceItem(await smartScanService.assignLead(item.id, lead));
              }
              setSelectedIds((prev) => {
                const next = new Set(prev);
                for (const item of rows) next.delete(item.id);
                return next;
              });
              toast.success(
                rows.length === 1
                  ? `Assigned ${lead.leadNumber} and saved to Sequence of Events`
                  : `Assigned ${rows.length} documents to ${lead.leadNumber}`,
              );
            }}
            onRemove={(rows) => void handleRemove(rows.map((row) => row.id))}
          />
        )}
      </div>

      <SmartScanReviewDrawer
        open={Boolean(drawerItem)}
        item={drawerItem}
        scanItems={drawerScanItems}
        assigning={assigning}
        onClose={() => {
          drawerPinRef.current = null;
          drawerGroupKeyRef.current = null;
          setDrawerItem(null);
          setDrawerScanItems(null);
          setAssigning(false);
        }}
        onSave={async (id, patch) => {
          replaceItem(await smartScanService.update(id, patch));
          toast.success('Changes saved');
        }}
        onApprove={async (id) => {
          replaceItem(await smartScanService.approve(id));
          toast.success('Approved and saved to Sequence of Events');
        }}
        onReject={async (id) => {
          if (!window.confirm('Reject this scan?')) return;
          replaceItem(await smartScanService.reject(id));
        }}
        onRetry={handleRetry}
        onAssign={async (id, lead: SmartScanLeadRef) => {
          replaceItem(await smartScanService.assignLead(id, lead));
          toast.success(`Assigned ${lead.leadNumber} and saved to Sequence of Events`);
        }}
        onAssignMany={async (ids, lead: SmartScanLeadRef) => {
          for (const id of ids) {
            replaceItem(await smartScanService.assignLead(id, lead));
          }
          toast.success(`Assigned ${ids.length} documents to ${lead.leadNumber}`);
        }}
        onRemove={async (ids) => {
          await handleRemove(ids, { confirmed: true });
        }}
        onOpenLead={openLead}
      />
    </div>
  );
}
