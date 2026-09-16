import { assignScanCenterLead, approveScanCenterItem, fetchScanCenterInbox, processScanCenterItem, removeScanCenterItem, requestScanCenterSync } from './scanCenterInbox';
import {
  buildSuggestedFilename,
  confidenceBand,
  scanQueueBucket,
  type SmartScanItem,
  type SmartScanKpis,
  type SmartScanLeadRef,
  type SmartScanListFilters,
  type SmartScanTab,
} from './smartScanTypes';

const delay = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

function cloneItems(items: SmartScanItem[]): SmartScanItem[] {
  return items.map((item) => ({
    ...item,
    lead: item.lead ? { ...item.lead } : undefined,
    possibleLeadMatches: item.possibleLeadMatches?.map((lead) => ({ ...lead })),
    activity: item.activity?.map((entry) => ({ ...entry })),
  }));
}

const overlays = new Map<string, Partial<SmartScanItem>>();
let cache: SmartScanItem[] = [];
let lastWarning: string | undefined;

function nowIso() {
  return new Date().toISOString();
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function matchesDate(item: SmartScanItem, filters: SmartScanListFilters): boolean {
  const created = new Date(item.createdAt).getTime();
  const preset = filters.datePreset || 'all';
  if (preset === 'all') return true;
  if (preset === 'today') return created >= startOfToday().getTime();
  if (preset === '7d') return created >= Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (preset === '30d') return created >= Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (preset === 'custom') {
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
}

function matchesSearch(item: SmartScanItem, search?: string): boolean {
  const q = (search || '').trim().toLowerCase();
  if (!q) return true;
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
  return hay.includes(q);
}

function applyFilters(items: SmartScanItem[], filters: SmartScanListFilters = {}): SmartScanItem[] {
  return items.filter((item) => {
    if (item.ignored) return false;
    if (!matchesSearch(item, filters.search)) return false;
    if (!matchesDate(item, filters)) return false;
    if (filters.scanner && filters.scanner !== 'all' && item.scannerName !== filters.scanner) return false;
    if (filters.status && filters.status !== 'all' && scanQueueBucket(item) !== filters.status) return false;
    if (filters.documentType && filters.documentType !== 'all') {
      const type = item.documentType || item.suggestedDocumentType || 'Unknown';
      if (type !== filters.documentType) return false;
    }
    if (filters.confidence && filters.confidence !== 'all') {
      const band = confidenceBand(item.confidence);
      if (band !== filters.confidence) return false;
    }
    return true;
  });
}

function findIndex(id: string) {
  return cache.findIndex((item) => item.id === id);
}

function pushActivity(item: SmartScanItem, label: string) {
  item.activity = [...(item.activity || []), { at: nowIso(), label }];
}

function applyOverlay(item: SmartScanItem): SmartScanItem {
  const overlay = overlays.get(item.id);
  if (!overlay) return item;
  if (overlay.status === 'processing' && item.status !== 'processing' && item.processedAt) {
    const rest = { ...overlay };
    delete rest.status;
    delete rest.classificationStatus;
    overlays.set(item.id, rest);
    return { ...item, ...rest };
  }
  return { ...item, ...overlay };
}

function writeItem(next: SmartScanItem): SmartScanItem {
  overlays.set(next.id, { ...overlays.get(next.id), ...next });
  const index = findIndex(next.id);
  if (index >= 0) cache[index] = next;
  else cache.unshift(next);
  return cloneItems([next])[0];
}

function requireItem(id: string): SmartScanItem {
  const index = findIndex(id);
  if (index < 0) throw new Error('Scan not found');
  return cache[index];
}

export function computeSmartScanKpis(items: SmartScanItem[]): SmartScanKpis {
  const today = startOfToday().getTime();
  const visible = items.filter((item) => !item.ignored);
  return {
    scannedToday: visible.filter((item) => new Date(item.createdAt).getTime() >= today).length,
    matched: visible.filter((item) => scanQueueBucket(item) === 'matched').length,
    unmatched: visible.filter((item) => scanQueueBucket(item) === 'unmatched').length,
    processing: visible.filter((item) => scanQueueBucket(item) === 'processing').length,
    history: visible.filter((item) => scanQueueBucket(item) === 'history').length,
  };
}

export const smartScanService = {
  getInboxWarning(): string | undefined {
    return lastWarning;
  },

  async list(filters: SmartScanListFilters = {}): Promise<SmartScanItem[]> {
    if (!cache.length) await this.listAll();
    await delay();
    return cloneItems(applyFilters(cache, filters)).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  },

  async listAll(options?: { sync?: boolean }): Promise<SmartScanItem[]> {
    const result = await fetchScanCenterInbox({ sync: options?.sync === true });
    lastWarning = result.warning;
    cache = result.items.map(applyOverlay);
    return cloneItems(cache.filter((item) => !item.ignored));
  },

  async get(id: string): Promise<SmartScanItem | null> {
    await delay(40);
    const item = cache.find((row) => row.id === id);
    return item ? cloneItems([item])[0] : null;
  },

  async update(id: string, patch: Partial<SmartScanItem>): Promise<SmartScanItem> {
    await delay(80);
    const current = requireItem(id);
    const next: SmartScanItem = { ...current, ...patch };
    if (!next.suggestedFilename) {
      next.suggestedFilename = buildSuggestedFilename(next);
    }
    pushActivity(next, 'Details updated');
    return writeItem(next);
  },

  async assignLead(id: string, lead: SmartScanLeadRef): Promise<SmartScanItem> {
    await assignScanCenterLead(id, lead);
    const current = requireItem(id);
    const next: SmartScanItem = {
      ...current,
      lead,
      leadMatchStatus: 'matched',
      leadAssignedBy: 'user',
      possibleLeadMatches: undefined,
      issue: undefined,
      status: 'completed',
      classificationStatus:
        current.classificationStatus === 'failed' || current.classificationStatus === 'processing'
          ? 'classified'
          : current.classificationStatus,
      suggestedFilename: buildSuggestedFilename({ ...current, lead }),
    };
    pushActivity(next, `Lead assigned: ${lead.leadNumber} — ${lead.name}`);
    return writeItem(next);
  },

  async retry(id: string): Promise<SmartScanItem> {
    const current = requireItem(id);
    const processing: SmartScanItem = {
      ...current,
      status: 'processing',
      classificationStatus: 'processing',
      issue: undefined,
    };
    pushActivity(processing, 'AI reprocess started');
    writeItem(processing);
    await processScanCenterItem(id);
    return cloneItems([processing])[0];
  },

  async approve(id: string, actor = 'You'): Promise<SmartScanItem> {
    await approveScanCenterItem(id);
    const current = requireItem(id);
    const next: SmartScanItem = {
      ...current,
      status: 'completed',
      classificationStatus: 'classified',
      documentType: current.documentType || current.suggestedDocumentType || 'Unknown',
      approvedBy: actor,
      approvedAt: nowIso(),
      issue: undefined,
      leadAssignedBy: current.leadAssignedBy || 'ai',
    };
    pushActivity(next, `Approved by ${actor}`);
    return writeItem(next);
  },

  async reject(id: string, actor = 'You'): Promise<SmartScanItem> {
    await delay(80);
    const current = requireItem(id);
    const next: SmartScanItem = {
      ...current,
      status: 'failed',
      classificationStatus: 'failed',
      issue: current.issue || 'ai_processing_failed',
    };
    pushActivity(next, `Rejected by ${actor}`);
    return writeItem(next);
  },

  async ignore(id: string): Promise<void> {
    await this.remove(id);
  },

  async remove(id: string): Promise<void> {
    const current = cache.find((item) => item.id === id);
    const result = await removeScanCenterItem(id);
    const attachmentId = result.attachmentId || current?.attachmentId;
    cache = cache.filter((item) => {
      if (item.id === id) return false;
      if (attachmentId && item.attachmentId === attachmentId) return false;
      if (
        current?.parentDocumentId &&
        (item.parentDocumentId === current.parentDocumentId || item.scanDocumentId === current.parentDocumentId)
      ) {
        return false;
      }
      if (current?.scanDocumentId && item.parentDocumentId === current.scanDocumentId) return false;
      return true;
    });
    for (const overlayId of [...overlays.keys()]) {
      if (!cache.some((item) => item.id === overlayId)) overlays.delete(overlayId);
    }
  },

  async markCompleted(id: string, actor = 'You'): Promise<SmartScanItem> {
    return this.approve(id, actor);
  },

  kpis(items: SmartScanItem[]): SmartScanKpis {
    return computeSmartScanKpis(items);
  },

  reset(): void {
    overlays.clear();
    cache = [];
    lastWarning = undefined;
  },

  requestBackgroundSync(): Promise<void> {
    return requestScanCenterSync();
  },
};

export function tabStatusFor(tab: string): SmartScanTab {
  if (tab === 'matched' || tab === 'unmatched' || tab === 'processing' || tab === 'history') {
    return tab;
  }
  return 'all';
}
