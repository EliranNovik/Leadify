import { scanQueueBucket, type SmartScanItem, type SmartScanLeadRef, type SmartScanQueue, type SmartScanSort } from './smartScanTypes';

export function formatScanDateTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

export function formatScanTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatScanLongDateTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function formatScanDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    const parts = iso.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return iso;
  }
  return date.toLocaleDateString('en-GB');
}

export function scanArrivalKey(item: SmartScanItem): string {
  if (item.emailId) return `email:${item.emailId}`;
  if (item.parentDocumentId) return `parent:${item.parentDocumentId}`;
  if (item.batchId) return `batch:${item.batchId}`;
  return `item:${item.id}`;
}

function siblingSortKey(item: SmartScanItem) {
  return item.parentDocumentId || item.scanDocumentId || item.attachmentId || item.id;
}

export type SmartScanArrivalGroup = {
  key: string;
  items: SmartScanItem[];
  createdAt: string;
};

export function groupSmartScanItems(items: SmartScanItem[], sort: SmartScanSort = 'newest'): SmartScanArrivalGroup[] {
  const groups = new Map<string, SmartScanItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = scanArrivalKey(item);
    const list = groups.get(key);
    if (!list) {
      groups.set(key, [item]);
      order.push(key);
    } else {
      list.push(item);
    }
  }

  return order
    .map((key) => {
      const members = [...(groups.get(key) || [])].sort((a, b) => {
        const family = siblingSortKey(a).localeCompare(siblingSortKey(b));
        if (family) return family;
        const split = (a.splitIndex || 0) - (b.splitIndex || 0);
        if (split) return split;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
      const latest = members.reduce((max, item) => {
        const time = new Date(item.createdAt).getTime();
        return time > max ? time : max;
      }, 0);
      return {
        key,
        items: members,
        createdAt: members.find((item) => new Date(item.createdAt).getTime() === latest)?.createdAt || members[0]?.createdAt || '',
      };
    })
    .sort((a, b) => {
      const delta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return sort === 'oldest' ? -delta : delta;
    });
}

export function flattenGroupedScanItems(items: SmartScanItem[], sort: SmartScanSort = 'newest'): SmartScanItem[] {
  return groupSmartScanItems(items, sort).flatMap((group) => group.items);
}

export function scanDocumentTypeLabel(item: SmartScanItem): string {
  return (item.documentType || item.suggestedDocumentType || item.title || 'Unknown').trim() || 'Unknown';
}

export function scanGroupDocumentLabel(items: SmartScanItem[]): string {
  const types = [...new Set(items.map(scanDocumentTypeLabel))];
  if (types.length <= 1) return types[0] || 'Unknown';
  return 'Other';
}

export function scanGroupPageCount(items: SmartScanItem[]): number {
  return items.reduce((sum, item) => sum + (Number(item.pageCount) || 0), 0);
}

export function scanGroupQueueBucket(items: SmartScanItem[]): SmartScanQueue {
  const buckets = items.map((item) => scanQueueBucket(item));
  if (buckets.includes('processing')) return 'processing';
  if (buckets.length > 0 && buckets.every((bucket) => bucket === 'history')) return 'history';
  if (buckets.includes('unmatched')) return 'unmatched';
  if (buckets.includes('matched')) return 'matched';
  return 'unmatched';
}

export function scanGroupLead(items: SmartScanItem[]): { lead?: SmartScanLeadRef; name: string; leadNumber: string } {
  const leads = items.map((item) => item.lead).filter((lead): lead is SmartScanLeadRef => Boolean(lead?.leadNumber));
  const unique = new Map<string, SmartScanLeadRef>();
  for (const lead of leads) unique.set(`${lead.id || ''}:${lead.leadNumber}`, lead);
  if (unique.size === 1) {
    const lead = [...unique.values()][0];
    return { lead, name: lead.name, leadNumber: lead.leadNumber };
  }
  if (unique.size > 1) {
    return { name: 'Multiple clients', leadNumber: 'Multiple leads' };
  }
  const people = [...new Set(items.map((item) => item.detectedPersonName).filter(Boolean))];
  return {
    name: people.length === 1 ? String(people[0]) : people.length > 1 ? 'Multiple names' : 'Unknown',
    leadNumber: 'No lead',
  };
}

export function scanGroupConfidence(items: SmartScanItem[]): number | undefined {
  const values = items.map((item) => item.confidence).filter((value): value is number => value != null && !Number.isNaN(value));
  if (!values.length) return undefined;
  return Math.min(...values);
}

export type ScanPageRange = { id: string; start: number; end: number };

export function scanGroupPageRanges(items: SmartScanItem[]): ScanPageRange[] {
  let cursor = 1;
  return items.map((item) => {
    const start = Number(item.pageStart) > 0 ? Number(item.pageStart) : cursor;
    const counted = Math.max(1, Number(item.pageCount) || 1);
    const end = Number(item.pageEnd) > 0 ? Number(item.pageEnd) : start + counted - 1;
    cursor = end + 1;
    return { id: item.id, start, end };
  });
}

export function scanTabLabel(item: SmartScanItem, items: SmartScanItem[]): string {
  const type = scanDocumentTypeLabel(item);
  const same = items.filter((row) => scanDocumentTypeLabel(row) === type);
  if (same.length <= 1) return type;
  const index = same.findIndex((row) => row.id === item.id) + 1;
  return `${type} ${index}`;
}

export function uniqueScanLeadMatches(rows: SmartScanItem[]): SmartScanLeadRef[] {
  const seen = new Set<string>();
  const matches: SmartScanLeadRef[] = [];
  for (const row of rows) {
    for (const lead of row.possibleLeadMatches || []) {
      const key = `${lead.id || ''}:${lead.leadNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(lead);
    }
  }
  return matches;
}
