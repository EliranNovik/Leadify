import type { PortalPaymentRow } from '../../../lib/portalApi';
import { buildPaymentPagePath } from '../../../lib/proformaPaymentLink';

export type PortalSearchTab = 'summary' | 'stages' | 'finance' | 'documents' | 'contacts' | 'meetings';

export type PortalSearchAction =
  | { type: 'navigate'; tab: PortalSearchTab }
  | { type: 'request-meeting' }
  | { type: 'external'; href: string };

export type PortalSearchEntry = {
  id: string;
  title: string;
  subtitle?: string;
  category: string;
  keywords: string[];
  action: PortalSearchAction;
};

export type PortalSearchResult = PortalSearchEntry & { score: number };

export type PortalSearchData = {
  lead?: {
    display_name: string;
    lead_number: string;
    stage_name?: string | null;
    category?: string | null;
  };
  contacts?: Array<{
    name: string;
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
  }>;
  meetings?: Array<{
    meeting_subject?: string | null;
    meeting_date?: string | null;
    meeting_location?: string | null;
  }>;
  payments?: PortalPaymentRow[];
  subEfforts?: Array<{ sub_effort_name?: string | null }>;
  documents?: Array<{ file_name: string }>;
  team?: Array<{ role: string; name?: string | null }>;
};

const PAGE_ENTRIES: PortalSearchEntry[] = [
  {
    id: 'page-summary',
    title: 'Dashboard',
    subtitle: 'Case overview and quick stats',
    category: 'Page',
    keywords: ['dashboard', 'home', 'overview', 'summary', 'main'],
    action: { type: 'navigate', tab: 'summary' },
  },
  {
    id: 'page-stages',
    title: 'Case Status',
    subtitle: 'Track milestones and stage progress',
    category: 'Page',
    keywords: ['case status', 'stages', 'stage', 'progress', 'milestone', 'timeline', 'status'],
    action: { type: 'navigate', tab: 'stages' },
  },
  {
    id: 'page-finance',
    title: 'Finance',
    subtitle: 'Payments, invoices, and balances',
    category: 'Page',
    keywords: ['finance', 'payment', 'payments', 'pay', 'invoice', 'invoices', 'proforma', 'money', 'balance', 'due', 'overdue', 'bill'],
    action: { type: 'navigate', tab: 'finance' },
  },
  {
    id: 'page-documents',
    title: 'Documents',
    subtitle: 'Download files or upload documents',
    category: 'Page',
    keywords: ['documents', 'document', 'files', 'file', 'upload', 'download', 'attachment', 'pdf'],
    action: { type: 'navigate', tab: 'documents' },
  },
  {
    id: 'page-contacts',
    title: 'My contacts',
    subtitle: 'People on your case',
    category: 'Page',
    keywords: [
      'contacts',
      'contact',
      'people',
      'email',
      'phone',
      'address',
      'profile',
      'contract',
      'contracts',
      'poa',
      'power of attorney',
      'attorney',
    ],
    action: { type: 'navigate', tab: 'contacts' },
  },
  {
    id: 'page-contracts',
    title: 'Contracts',
    subtitle: 'View and open your contracts',
    category: 'Page',
    keywords: ['contract', 'contracts', 'agreement', 'agreements', 'sign', 'signed', 'engagement'],
    action: { type: 'navigate', tab: 'contacts' },
  },
  {
    id: 'page-poa',
    title: 'Power of Attorney',
    subtitle: 'View and open your power of attorney documents',
    category: 'Page',
    keywords: [
      'poa',
      'power of attorney',
      'powers of attorney',
      'attorney',
      'authorization',
      'authorisation',
      'mandate',
      'vollmacht',
    ],
    action: { type: 'navigate', tab: 'contacts' },
  },
  {
    id: 'page-meetings',
    title: 'Meetings',
    subtitle: 'Schedule appointments and view upcoming meetings',
    category: 'Page',
    keywords: ['meetings', 'meeting', 'schedule', 'appointment', 'calendar', 'video', 'teams', 'zoom'],
    action: { type: 'navigate', tab: 'meetings' },
  },
  {
    id: 'action-schedule-meeting',
    title: 'Schedule a meeting',
    subtitle: 'Pick a date and time for your appointment',
    category: 'Action',
    keywords: ['request meeting', 'book', 'schedule meeting', 'new meeting', 'appointment'],
    action: { type: 'navigate', tab: 'meetings' },
  },
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function tokenize(query: string): string[] {
  return normalize(query).split(/\s+/).filter((t) => t.length > 0);
}

function haystack(entry: PortalSearchEntry): string {
  return normalize([entry.title, entry.subtitle, entry.category, ...entry.keywords].filter(Boolean).join(' '));
}

function scoreEntry(entry: PortalSearchEntry, query: string, tokens: string[]): number {
  const nq = normalize(query);
  if (!nq) return 0;

  const stack = haystack(entry);
  const title = normalize(entry.title);

  if (title === nq) return 100;
  if (title.startsWith(nq)) return 92;
  if (stack.includes(nq)) return 85;

  if (tokens.length === 0) return 0;

  let score = 0;
  for (const token of tokens) {
    if (token.length < 2) continue;
    if (title.includes(token)) score += 28;
    else if (stack.includes(token)) score += 18;
    else if (entry.keywords.some((k) => normalize(k).includes(token))) score += 12;
    else return 0;
  }

  return score;
}

export function buildPortalSearchIndex(data: PortalSearchData): PortalSearchEntry[] {
  const entries: PortalSearchEntry[] = [...PAGE_ENTRIES];

  if (data.lead) {
    entries.push({
      id: 'case-info',
      title: data.lead.display_name,
      subtitle: `Case #${data.lead.lead_number}`,
      category: 'Case',
      keywords: [
        data.lead.lead_number,
        data.lead.stage_name || '',
        data.lead.category || '',
        'case',
        'client',
      ].filter(Boolean),
      action: { type: 'navigate', tab: 'summary' },
    });

    if (data.lead.stage_name) {
      entries.push({
        id: 'case-stage',
        title: data.lead.stage_name,
        subtitle: 'Current case stage',
        category: 'Case',
        keywords: ['stage', 'status', 'progress', data.lead.category || ''].filter(Boolean),
        action: { type: 'navigate', tab: 'stages' },
      });
    }
  }

  for (const contact of data.contacts ?? []) {
    entries.push({
      id: `contact-${contact.name}`,
      title: contact.name,
      subtitle: [contact.email, contact.phone || contact.mobile].filter(Boolean).join(' · ') || 'Contact',
      category: 'Contact',
      keywords: ['contact', contact.email || '', contact.phone || '', contact.mobile || ''].filter(Boolean),
      action: { type: 'navigate', tab: 'contacts' },
    });
  }

  for (const meeting of data.meetings ?? []) {
    const title = meeting.meeting_subject?.trim() || 'Meeting';
    entries.push({
      id: `meeting-${title}-${meeting.meeting_date || ''}`,
      title,
      subtitle: [meeting.meeting_date, meeting.meeting_location].filter(Boolean).join(' · ') || 'Scheduled meeting',
      category: 'Meeting',
      keywords: ['meeting', 'appointment', meeting.meeting_location || ''].filter(Boolean),
      action: { type: 'navigate', tab: 'meetings' },
    });
  }

  for (const effort of data.subEfforts ?? []) {
    const name = effort.sub_effort_name?.trim();
    if (!name) continue;
    entries.push({
      id: `stage-${name}`,
      title: name,
      subtitle: 'Case milestone',
      category: 'Case Status',
      keywords: ['stage', 'milestone', 'status', 'progress'],
      action: { type: 'navigate', tab: 'stages' },
    });
  }

  for (const doc of data.documents ?? []) {
    entries.push({
      id: `doc-${doc.file_name}`,
      title: doc.file_name,
      subtitle: 'Document on your case',
      category: 'Document',
      keywords: ['document', 'file', 'download', doc.file_name],
      action: { type: 'navigate', tab: 'documents' },
    });
  }

  for (const member of data.team ?? []) {
    const name = member.name?.trim();
    if (!name || name === '—' || name === 'Not assigned') continue;
    entries.push({
      id: `team-${member.role}-${name}`,
      title: name,
      subtitle: member.role,
      category: 'Team',
      keywords: ['team', 'handler', member.role.toLowerCase(), name],
      action: { type: 'navigate', tab: 'summary' },
    });
  }

  for (const payment of data.payments ?? []) {
    const total = Number(payment.value || 0) + Number(payment.value_vat || 0);
    const label = payment.paid ? 'Paid payment' : 'Outstanding payment';
    entries.push({
      id: `payment-${payment.id}`,
      title: label,
      subtitle: payment.due_date ? `Due ${payment.due_date}` : 'Payment',
      category: 'Finance',
      keywords: ['payment', 'finance', 'invoice', payment.paid ? 'paid' : 'outstanding', 'overdue'],
      action: { type: 'navigate', tab: 'finance' },
    });

    if (!payment.paid && payment.secure_token) {
      entries.push({
        id: `pay-online-${payment.id}`,
        title: 'Pay online',
        subtitle: `Pay ${total}`,
        category: 'Action',
        keywords: ['pay', 'payment', 'online', 'finance', 'due'],
        action: { type: 'external', href: buildPaymentPagePath(payment.secure_token) },
      });
    }
  }

  return entries;
}

export function searchPortal(entries: PortalSearchEntry[], query: string, limit = 8): PortalSearchResult[] {
  const trimmed = query.trim();
  const tokens = tokenize(trimmed);

  if (!trimmed) {
    return PAGE_ENTRIES.slice(0, limit).map((entry) => ({ ...entry, score: 1 }));
  }

  if (trimmed.length < 2 && tokens.every((t) => t.length < 2)) {
    return [];
  }

  const seen = new Set<string>();
  const results: PortalSearchResult[] = [];

  for (const entry of entries) {
    const score = scoreEntry(entry, trimmed, tokens);
    if (score <= 0 || seen.has(entry.id)) continue;
    seen.add(entry.id);
    results.push({ ...entry, score });
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
