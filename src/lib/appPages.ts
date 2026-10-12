/**
 * Navigable pages, for the URL bar's page search and for labelling history entries.
 *
 * Derived from the static routes in App.tsx. Deliberately excludes routes that are not somewhere a
 * user navigates on purpose: the login screen, the entry kiosk and CTI popup (own windows), payment
 * callbacks, the external-user portal (different audience), marketing pages, and dev scratch routes.
 *
 * Access is still enforced by the routes themselves — a page listed here is not a page everyone can
 * open, so search does not promise authorisation.
 */
export type AppPage = {
  path: string;
  label: string;
  /** Terms people type that do not appear in the label. */
  keywords?: string[];
  group?: string;
};

export const APP_PAGES: AppPage[] = [
  { path: '/', label: 'Dashboard', keywords: ['home', 'overview', 'scoreboard', 'targets'] },
  { path: '/calendar', label: 'Calendar', keywords: ['meetings', 'schedule'] },
  { path: '/outlook-calendar', label: 'Outlook Calendar', keywords: ['microsoft', 'graph'] },
  {
    path: '/calendar/internal-meeting-documents',
    label: 'Internal Meeting Documents',
    group: 'Calendar',
  },
  { path: '/communications', label: 'Communications', keywords: ['inbox', 'messages'] },
  { path: '/whatsapp', label: 'WhatsApp', keywords: ['chat', 'messages'] },
  { path: '/whatsapp-leads', label: 'WhatsApp Leads', keywords: ['chat'] },
  { path: '/email-leads', label: 'Email Leads', keywords: ['mail'] },
  { path: '/calls-ledger', label: 'Calls Ledger', keywords: ['phone', 'teams', 'cti'] },

  { path: '/create', label: 'Create New Lead', group: 'Leads', keywords: ['new', 'add'] },
  { path: '/lead-search', label: 'Lead Search', group: 'Leads', keywords: ['find', 'client'] },
  { path: '/clients', label: 'Clients', group: 'Leads', keywords: ['leads', 'cases'] },
  { path: '/double-leads', label: 'Double Leads', group: 'Leads', keywords: ['duplicate', 'merge'] },
  { path: '/new-cases', label: 'Assign Leads', group: 'Leads', keywords: ['allocation', 'new cases'] },
  { path: '/pipeline', label: 'Pipeline', group: 'Leads' },
  { path: '/scheduler-tool', label: 'Hot Leads', group: 'Leads', keywords: ['scheduler', 'tool'] },
  {
    path: '/waiting-for-price-offer',
    label: 'Waiting for Price Offer',
    group: 'Leads',
    keywords: ['proposal', 'quote'],
  },
  { path: '/sales/signed', label: 'Signed Sales', group: 'Leads', keywords: ['agreements', 'deals'] },

  { path: '/my-cases', label: 'My Cases', group: 'Cases' },
  { path: '/new-handler-cases', label: 'New Handler Cases', group: 'Cases' },
  { path: '/case-pipeline', label: 'Case Pipeline', group: 'Cases' },
  { path: '/case-manager', label: 'Case Manager', group: 'Cases', keywords: ['family tree', 'german', 'austrian'] },
  { path: '/retainer-handler-cases', label: 'Retention Cases', group: 'Cases', keywords: ['retainer'] },
  { path: '/handler-management', label: 'Handler Management', group: 'Cases' },
  { path: '/documents', label: 'Documents', group: 'Cases', keywords: ['files', 'uploads'] },
  { path: '/smart-scan', label: 'Smart Scan', group: 'Cases', keywords: ['ocr', 'document scan'] },

  { path: '/collection', label: 'Collection', group: 'Finance', keywords: ['debt', 'payments'] },
  {
    path: '/reports/finance-management',
    label: 'Finance Pipeline',
    group: 'Finance',
    keywords: ['expenses', 'proforma', 'invoices'],
  },
  { path: '/reports/collection-due', label: 'Collection Due', group: 'Finance' },
  { path: '/reports/collection-finances', label: 'Collection Finances', group: 'Finance' },
  { path: '/reports/subcontractor-fees', label: 'Subcontractor Fees', group: 'Finance' },
  { path: '/reports/employee-salaries', label: 'Employee Salaries', group: 'Finance', keywords: ['payroll'] },
  {
    path: '/tools/boi-exchange-rates',
    label: 'Exchange Rates',
    group: 'Finance',
    keywords: ['boi', 'bank of israel', 'currency', 'fx'],
  },

  { path: '/reports', label: 'Reports', group: 'Reports' },
  { path: '/reports/leads-report', label: 'Leads Report', group: 'Reports' },
  { path: '/reports/leads-management', label: 'Leads Management', group: 'Reports' },
  { path: '/reports/reassign-leads', label: 'Reassign Leads', group: 'Reports' },
  { path: '/reports/sales-contribution', label: 'Sales Contribution', group: 'Reports' },
  { path: '/reports/simple-contribution', label: 'Simple Contribution', group: 'Reports' },
  { path: '/reports/closer-super-pipeline', label: 'Closer Super Pipeline', group: 'Reports' },
  { path: '/reports/external-firms', label: 'External Firms', group: 'Reports' },
  { path: '/reports/tags-manager', label: 'Tags Manager', group: 'Reports' },
  { path: '/reports/edit-contracts', label: 'Edit Contracts', group: 'Reports' },
  { path: '/lead-time-report', label: 'Lead Time Report', group: 'Reports' },
  { path: '/performance', label: 'My Performance', group: 'Reports' },
  { path: '/employee-performance', label: 'Employee Performance', group: 'Reports' },

  {
    path: '/reports/hr-management',
    label: 'HR Management',
    group: 'People',
    keywords: ['human resources', 'attendance', 'clock in', 'working hours'],
  },
  { path: '/reports/employee-info', label: 'Employee Info', group: 'People' },
  { path: '/reports/employee-lead-allocations', label: 'Employee Lead Allocations', group: 'People' },
  {
    path: '/reports/employee-unavailabilities',
    label: 'Employee Unavailabilities',
    group: 'People',
    keywords: ['holiday', 'vacation', 'time off', 'absence'],
  },
  { path: '/organization', label: 'Organization', group: 'People', keywords: ['org chart', 'departments'] },
  { path: '/teams', label: 'Teams', group: 'People' },
  { path: '/expert', label: 'Expert', group: 'People' },
  { path: '/my-profile', label: 'My Profile', group: 'People', keywords: ['account', 'me'] },

  { path: '/rmq-ai', label: 'RMQ AI', keywords: ['assistant', 'chat', 'gpt'] },
  { path: '/settings', label: 'Settings', keywords: ['preferences', 'configuration'] },
  { path: '/admin', label: 'Admin Panel', keywords: ['superuser', 'management'] },
  { path: '/access-logs', label: 'Access Logs', group: 'Admin', keywords: ['audit', 'security'] },
];

const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

/** "HR Management" -> "hrm", so typing "hrm" or "hr" lands on it. */
function initialsOf(label: string): string {
  return label
    .split(/[\s/&_-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toLowerCase();
}

/** Lets "clmgmt" reach "Collection Management" — the loosest match we accept, ranked lowest. */
function isSubsequence(query: string, target: string): boolean {
  if (!query) return true;
  let cursor = 0;
  for (const char of target) {
    if (char === query[cursor]) cursor += 1;
    if (cursor === query.length) return true;
  }
  return false;
}

/**
 * Higher is better; 0 means no match. Ties subtract the label length so that when two pages match
 * equally well the more specific one ("Reports" over "Reports Management") comes first.
 */
function scorePage(page: AppPage, query: string): number {
  const label = normalise(page.label);
  if (label === query) return 1000;
  if (label.startsWith(query)) return 900 - label.length;
  if (label.split(' ').some((word) => word.startsWith(query))) return 800 - label.length;
  if (query.length > 1 && initialsOf(page.label).startsWith(query)) return 750 - label.length;
  if (label.includes(query)) return 600 - label.length;
  if (page.keywords?.some((keyword) => normalise(keyword).includes(query))) return 500 - label.length;
  if (page.path.toLowerCase().includes(query)) return 400 - label.length;
  if (isSubsequence(query, label)) return 300 - label.length;
  return 0;
}

export function searchAppPages(query: string, limit = 8): AppPage[] {
  const normalised = normalise(query);
  if (!normalised) return [];
  return APP_PAGES
    .map((page) => ({ page, score: scorePage(page, normalised) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.page.label.localeCompare(b.page.label))
    .slice(0, limit)
    .map((entry) => entry.page);
}

/** Label for a path, or null when the path is not a registered page. */
export function appPageLabel(pathname: string): string | null {
  return APP_PAGES.find((page) => page.path === pathname)?.label ?? null;
}

/**
 * Always a readable title, for history entries that have no exact registry match. Deep paths borrow
 * their section's name so "/clients/L231236" reads as "Clients · L231236" rather than as a URL.
 */
export function appPageTitle(pathname: string): string {
  const exact = appPageLabel(pathname);
  if (exact) return exact;

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return appPageLabel('/') ?? pathname;

  const section = appPageLabel(`/${segments[0]}`);
  let last = segments[segments.length - 1];
  try {
    last = decodeURIComponent(last);
  } catch {
    // Malformed percent-encoding — the raw segment is still a usable title.
  }
  if (!section) return last;
  return section === last ? section : `${section} · ${last}`;
}
