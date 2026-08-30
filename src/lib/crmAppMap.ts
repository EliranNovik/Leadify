export type CrmAppPlace = {
  id: string;
  title: string;
  path: string;
  how: string;
  section: string;
  keywords: string[];
};

/** Internal Leadify CRM pages RMQ AI can send users to. */
export const CRM_APP_MAP: CrmAppPlace[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    path: '/',
    how: 'Sidebar → Dashboard',
    section: 'Home',
    keywords: ['home', 'main', 'overview', 'landing', 'start'],
  },
  {
    id: 'calendar',
    title: 'Calendar',
    path: '/calendar',
    how: 'Sidebar → Calendar',
    section: 'Schedule',
    keywords: ['meetings', 'schedule', 'agenda', 'appointments', 'outlook calendar'],
  },
  {
    id: 'outlook-calendar',
    title: 'Outlook calendar',
    path: '/outlook-calendar',
    how: 'Open Calendar, then Outlook calendar',
    section: 'Schedule',
    keywords: ['outlook', 'exchange', 'microsoft calendar'],
  },
  {
    id: 'internal-meeting-docs',
    title: 'Internal meeting documents',
    path: '/calendar/internal-meeting-documents',
    how: 'Calendar → internal meeting documents',
    section: 'Schedule',
    keywords: ['internal meeting', 'meeting documents', 'staff meeting files'],
  },
  {
    id: 'create-lead',
    title: 'Create new lead',
    path: '/create',
    how: 'Sidebar → Leads → Create New',
    section: 'Leads',
    keywords: ['new lead', 'add lead', 'create client', 'new client'],
  },
  {
    id: 'lead-search',
    title: 'Lead search',
    path: '/lead-search',
    how: 'Sidebar → Leads → Lead Search',
    section: 'Leads',
    keywords: ['find lead', 'search client', 'lookup lead', 'search leads'],
  },
  {
    id: 'double-leads',
    title: 'Double leads',
    path: '/double-leads',
    how: 'Sidebar → Leads → Double Leads',
    section: 'Leads',
    keywords: ['duplicates', 'duplicate leads', 'double clients'],
  },
  {
    id: 'assign-leads',
    title: 'Assign leads',
    path: '/new-cases',
    how: 'Sidebar → Leads → Assign Leads',
    section: 'Leads',
    keywords: ['new cases', 'allocate leads', 'assign case', 'unassigned'],
  },
  {
    id: 'hot-leads',
    title: 'Hot leads',
    path: '/scheduler-tool',
    how: 'Sidebar → Hot Leads',
    section: 'Leads',
    keywords: ['hot', 'priority leads', 'scheduler tool', 'urgent leads'],
  },
  {
    id: 'waiting-price-offer',
    title: 'Waiting for price offer',
    path: '/waiting-for-price-offer',
    how: 'Sidebar → Waiting for Price Offer',
    section: 'Leads',
    keywords: ['price offer', 'waiting offer', 'proposal pending', 'offer'],
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    path: '/pipeline',
    how: 'Sidebar → Pipeline',
    section: 'Sales',
    keywords: ['sales pipeline', 'stages', 'funnel'],
  },
  {
    id: 'expert',
    title: 'Expert',
    path: '/expert',
    how: 'Sidebar → Expert',
    section: 'Sales',
    keywords: ['expert page', 'expert queue', 'expert meetings'],
  },
  {
    id: 'new-handler-cases',
    title: 'New handler cases',
    path: '/new-handler-cases',
    how: 'Sidebar → Cases → New Handler Cases',
    section: 'Cases',
    keywords: ['handler cases', 'new files', 'assign handler'],
  },
  {
    id: 'my-cases',
    title: 'My cases',
    path: '/my-cases',
    how: 'Sidebar → Cases → My Cases',
    section: 'Cases',
    keywords: ['my files', 'handler caseload', 'my clients cases'],
  },
  {
    id: 'case-pipeline',
    title: 'Case pipeline',
    path: '/case-pipeline',
    how: 'Sidebar → Cases → Case Pipeline',
    section: 'Cases',
    keywords: ['case stages', 'handler pipeline'],
  },
  {
    id: 'retention-cases',
    title: 'Retention cases',
    path: '/retainer-handler-cases',
    how: 'Sidebar → Cases → Retention Cases',
    section: 'Cases',
    keywords: ['retainer', 'retention', 'keep clients'],
  },
  {
    id: 'case-manager',
    title: 'Case manager',
    path: '/case-manager',
    how: 'Sidebar → Cases → Case Manager',
    section: 'Cases',
    keywords: ['german case', 'austrian case', 'family tree', 'citizenship case'],
  },
  {
    id: 'handler-management',
    title: 'Handler management',
    path: '/handler-management',
    how: 'Open Handler management from reports / admin tools',
    section: 'Cases',
    keywords: ['manage handlers', 'handler admin'],
  },
  {
    id: 'whatsapp-leads',
    title: 'WhatsApp leads',
    path: '/whatsapp-leads',
    how: 'Sidebar → WhatsApp Leads',
    section: 'Inbox',
    keywords: ['whatsapp', 'wa', 'whats app', 'chat leads'],
  },
  {
    id: 'email-leads',
    title: 'Email leads',
    path: '/email-leads',
    how: 'Sidebar → Email Leads',
    section: 'Inbox',
    keywords: ['email inbox', 'mail leads', 'outlook mail'],
  },
  {
    id: 'calls-ledger',
    title: 'Calls ledger',
    path: '/calls-ledger',
    how: 'Sidebar → Calls Ledger',
    section: 'Inbox',
    keywords: ['calls', 'phone log', 'cti', 'call history'],
  },
  {
    id: 'my-performance',
    title: 'My performance',
    path: '/performance',
    how: 'Sidebar → My Performance',
    section: 'Performance',
    keywords: ['my stats', 'my kpi', 'my results'],
  },
  {
    id: 'lead-time-report',
    title: 'Lead time report',
    path: '/lead-time-report',
    how: 'Sidebar → Lead time report',
    section: 'Performance',
    keywords: ['lead time', 'response time', 'time to meeting'],
  },
  {
    id: 'employee-performance',
    title: 'Employee performance',
    path: '/employee-performance',
    how: 'Employee Performance page',
    section: 'Performance',
    keywords: ['staff performance', 'team kpi'],
  },
  {
    id: 'reports',
    title: 'Reports',
    path: '/reports',
    how: 'Sidebar (mobile) or hamburger → Reports',
    section: 'Reports',
    keywords: ['analytics', 'report hub', 'all reports'],
  },
  {
    id: 'signed-sales',
    title: 'Signed sales',
    path: '/sales/signed',
    how: 'Reports → Signed sales, or /sales/signed',
    section: 'Reports',
    keywords: ['signed deals', 'closed sales', 'who signed', 'stage 60'],
  },
  {
    id: 'sales-contribution',
    title: 'Sales contribution',
    path: '/reports/sales-contribution',
    how: 'Reports → Contribution → M&M Contribution profitability',
    section: 'Reports',
    keywords: ['contribution', 'profitability', 'm&m'],
  },
  {
    id: 'leads-report',
    title: 'Leads report',
    path: '/reports/leads-report',
    how: 'Reports → Tools → Leads Report',
    section: 'Reports',
    keywords: ['export leads', 'leads excel', 'lead list report'],
  },
  {
    id: 'leads-management',
    title: 'Leads management',
    path: '/reports/leads-management',
    how: 'Reports → Employees → Leads management',
    section: 'Reports',
    keywords: ['lead allocations board', 'manage lead load'],
  },
  {
    id: 'lead-allocations',
    title: 'Lead allocations',
    path: '/reports/employee-lead-allocations',
    how: 'Reports → Employees → Lead allocations',
    section: 'Reports',
    keywords: ['who has which leads', 'allocation report'],
  },
  {
    id: 'employee-info',
    title: 'Employee info',
    path: '/reports/employee-info',
    how: 'Reports → Employees → Employee Info',
    section: 'HR',
    keywords: ['staff directory', 'employee list report'],
  },
  {
    id: 'tags-manager',
    title: 'Tags manager',
    path: '/reports/tags-manager',
    how: 'Reports → Tools → Tags manager',
    section: 'Tools',
    keywords: ['tags', 'labels', 'lead tags'],
  },
  {
    id: 'reassign-leads',
    title: 'Re-assign leads',
    path: '/reports/reassign-leads',
    how: 'Reports → Tools → Re-assign leads',
    section: 'Tools',
    keywords: ['reassign', 'move leads', 'change closer', 'change expert'],
  },
  {
    id: 'edit-contracts',
    title: 'Edit contracts',
    path: '/reports/edit-contracts',
    how: 'Reports → Tools → Edit Contracts',
    section: 'Tools',
    keywords: ['contract editor list', 'fix contracts'],
  },
  {
    id: 'external-firms',
    title: 'External firms',
    path: '/reports/external-firms',
    how: 'Reports / hamburger search → External Firms',
    section: 'Tools',
    keywords: ['firms', 'partners', 'marketing firms', 'tenants'],
  },
  {
    id: 'finance-hub',
    title: 'Finance management',
    path: '/reports/finance-management',
    how: 'Sidebar → Finance Pipeline',
    section: 'Finance',
    keywords: ['finance pipeline', 'finance hub', 'money', 'billing'],
  },
  {
    id: 'finance-collection',
    title: 'Collection',
    path: '/reports/finance-management?tab=collection',
    how: 'Sidebar → Finance Pipeline → Collection',
    section: 'Finance',
    keywords: ['collect payment', 'outstanding', 'receivables', 'collection tab'],
  },
  {
    id: 'finance-collection-due',
    title: 'Collection due',
    path: '/reports/finance-management?tab=collection-due',
    how: 'Finance Pipeline → Collection Due',
    section: 'Finance',
    keywords: ['due payments', 'overdue', 'collection due'],
  },
  {
    id: 'finance-signed',
    title: 'Finance · Signed',
    path: '/reports/finance-management?tab=signed',
    how: 'Finance Pipeline → Signed',
    section: 'Finance',
    keywords: ['signed payments', 'signed finance'],
  },
  {
    id: 'add-expense',
    title: 'Add expense',
    path: '/reports/finance-management?tab=expense-entry',
    how: 'Sidebar → Finance Pipeline or Add expense → Expenses tab',
    section: 'Finance',
    keywords: ['expense', 'add expense', 'submit expense', 'receipt', 'spend'],
  },
  {
    id: 'all-expenses',
    title: 'All expenses',
    path: '/reports/finance-management?tab=expenses',
    how: 'Finance Pipeline → All expenses (superuser)',
    section: 'Finance',
    keywords: ['expense list', 'all receipts', 'approve expenses'],
  },
  {
    id: 'subcontractor-fees',
    title: 'Subcontractor fees',
    path: '/reports/subcontractor-fees',
    how: 'Reports → Finances → Subcontractor fees',
    section: 'Finance',
    keywords: ['subcontractor', 'vendor fees', 'outside counsel'],
  },
  {
    id: 'collection-page',
    title: 'Collection page',
    path: '/collection',
    how: 'Collection page (legacy collection view)',
    section: 'Finance',
    keywords: ['old collection'],
  },
  {
    id: 'hr-hub',
    title: 'HR management',
    path: '/reports/hr-management',
    how: 'Sidebar → HR Management',
    section: 'HR',
    keywords: ['hr', 'human resources', 'staff', 'personnel'],
  },
  {
    id: 'hr-approvals',
    title: 'HR approvals',
    path: '/reports/hr-management?tab=approvals',
    how: 'HR Management → Approvals',
    section: 'HR',
    keywords: ['approve hours', 'approve leave', 'clock in approval', 'pending approvals'],
  },
  {
    id: 'hr-employees',
    title: 'HR employees',
    path: '/reports/hr-management?tab=employees',
    how: 'HR Management → Employees',
    section: 'HR',
    keywords: ['employee file', 'staff list', 'hr employees'],
  },
  {
    id: 'hr-recruitment',
    title: 'Recruitment',
    path: '/reports/hr-management?tab=recruitment',
    how: 'HR Management → Recruitment',
    section: 'HR',
    keywords: ['hiring', 'candidates', 'recruit', 'job applicants'],
  },
  {
    id: 'hr-hours',
    title: 'Working hours (HR)',
    path: '/reports/hr-management?tab=hours',
    how: 'HR Management → Working hours',
    section: 'HR',
    keywords: ['timesheet', 'hours board', 'clock hours', 'work hours', 'working hours'],
  },
  {
    id: 'hr-leave',
    title: 'Leave',
    path: '/reports/hr-management?tab=leave',
    how: 'HR Management → Leave',
    section: 'HR',
    keywords: ['vacation', 'sick days', 'time off', 'unavailability', 'pto'],
  },
  {
    id: 'hr-status',
    title: 'Team status',
    path: '/reports/hr-management?tab=status',
    how: 'HR Management → Status',
    section: 'HR',
    keywords: ['who is in', 'team status', 'who is clocked in', 'office presence'],
  },
  {
    id: 'hr-salaries',
    title: 'Salaries',
    path: '/reports/hr-management?tab=salaries',
    how: 'HR Management → Salaries',
    section: 'HR',
    keywords: ['salary', 'payroll', 'wages', 'pay'],
  },
  {
    id: 'hr-kiosk',
    title: 'Entry kiosk',
    path: '/reports/hr-management?tab=entry-kiosk',
    how: 'HR Management → Entry kiosk',
    section: 'HR',
    keywords: ['kiosk', 'qr clock', 'ramat gan clock', 'entry tablet'],
  },
  {
    id: 'employee-unavailabilities',
    title: 'Employee unavailabilities',
    path: '/reports/employee-unavailabilities',
    how: 'Reports → Tools → Employee Unavailabilities',
    section: 'HR',
    keywords: ['unavailable report', 'leave report', 'who is off'],
  },
  {
    id: 'employee-salaries-report',
    title: 'Employee salaries report',
    path: '/reports/employee-salaries',
    how: 'Reports → Tools → Employee Salaries',
    section: 'HR',
    keywords: ['salary report', 'payroll report'],
  },
  {
    id: 'organization',
    title: 'Organization',
    path: '/organization',
    how: 'Header avatar menu → Organization',
    section: 'HR',
    keywords: ['org chart', 'organization chart', 'departments', 'who reports to'],
  },
  {
    id: 'my-profile',
    title: 'My profile',
    path: '/my-profile',
    how: 'Header avatar → My Profile',
    section: 'Account',
    keywords: ['profile', 'my account', 'my photo', 'about me'],
  },
  {
    id: 'my-working-hours',
    title: 'My working hours',
    path: '/my-profile?tab=working-hours',
    how: 'Header avatar → My Profile → Working Hours',
    section: 'Account',
    keywords: ['my timesheet', 'clock in out', 'my hours', 'punch', 'clocked'],
  },
  {
    id: 'my-documents',
    title: 'My documents',
    path: '/my-profile?tab=documents',
    how: 'My Profile → Documents',
    section: 'Account',
    keywords: ['personal files', 'my files', 'upload my document'],
  },
  {
    id: 'my-signature',
    title: 'Email signature',
    path: '/my-profile?tab=email-signature',
    how: 'My Profile → Email Signature',
    section: 'Account',
    keywords: ['signature', 'email footer', 'outlook signature'],
  },
  {
    id: 'settings',
    title: 'Settings',
    path: '/settings',
    how: 'Sidebar → Settings',
    section: 'Account',
    keywords: ['preferences', 'config', 'theme'],
  },
  {
    id: 'admin',
    title: 'Admin panel',
    path: '/admin',
    how: 'Sidebar → Admin Panel',
    section: 'Admin',
    keywords: ['admin', 'users', 'permissions', 'superuser'],
  },
  {
    id: 'access-logs',
    title: 'External user access logs',
    path: '/access-logs',
    how: 'Admin / external access logs',
    section: 'Admin',
    keywords: ['access log', 'who logged in', 'external login'],
  },
  {
    id: 'external-settings',
    title: 'External settings',
    path: '/external-settings',
    how: 'Header menu → External settings (external users)',
    section: 'External',
    keywords: ['external profile', 'firm settings'],
  },
  {
    id: 'external-reports',
    title: 'External reports',
    path: '/external-reports',
    how: 'External user → Reports',
    section: 'External',
    keywords: ['external funnel', 'marketing report'],
  },
  {
    id: 'documents',
    title: 'Documents',
    path: '/documents',
    how: 'Documents page',
    section: 'Tools',
    keywords: ['document library', 'files library'],
  },
  {
    id: 'client-info',
    title: 'Client · Info tab',
    path: '/clients?tab=info',
    how: 'Open a lead, then Info',
    section: 'Client',
    keywords: ['client info', 'lead info', 'client page', 'where is the client'],
  },
  {
    id: 'client-roles',
    title: 'Client · Roles tab',
    path: '/clients?tab=roles',
    how: 'Open a lead, then Roles',
    section: 'Client',
    keywords: ['closer role', 'expert role', 'scheduler role', 'team on lead'],
  },
  {
    id: 'client-contact',
    title: 'Client · Contact tab',
    path: '/clients?tab=contact',
    how: 'Open a lead, then Contact',
    section: 'Client',
    keywords: ['phone', 'email', 'address', 'contact details'],
  },
  {
    id: 'client-meeting',
    title: 'Client · Meeting tab',
    path: '/clients?tab=meeting',
    how: 'Open a lead, then Meeting',
    section: 'Client',
    keywords: ['schedule meeting', 'meeting brief', 'reschedule', 'zoom'],
  },
  {
    id: 'client-offer',
    title: 'Client · Offer tab',
    path: '/clients?tab=price',
    how: 'Open a lead, then Offer',
    section: 'Client',
    keywords: ['price offer', 'proposal', 'send offer', 'quote'],
  },
  {
    id: 'client-interactions',
    title: 'Client · Interactions tab',
    path: '/clients?tab=interactions',
    how: 'Open a lead, then Interactions',
    section: 'Client',
    keywords: ['whatsapp thread', 'emails', 'calls', 'timeline', 'communication'],
  },
  {
    id: 'client-finances',
    title: 'Client · Finances tab',
    path: '/clients?tab=finances',
    how: 'Open a lead, then Finances',
    section: 'Client',
    keywords: ['proforma', 'payment plan', 'invoice', 'balance', 'payments'],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenScore(query: string, candidate: string): number {
  const target = normalize(candidate);
  if (!query || !target) return 0;
  if (target === query) return 100;
  if (target.startsWith(query)) return 90;
  if (target.includes(query)) return 78;
  const qWords = query.split(' ').filter(Boolean);
  const tWords = target.split(' ');
  if (qWords.length && qWords.every((word) => tWords.some((part) => part.startsWith(word) || part.includes(word)))) {
    return 72 + Math.min(10, qWords.length * 2);
  }
  return 0;
}

export function findCrmAppPlaces(query: string, limit = 6): Array<CrmAppPlace & { score: number }> {
  const q = normalize(query.replace(/^(where (can i|do i|is)|how do i (get to|open|find)|take me to|show me)\s+/i, ''));
  if (!q) return [];
  const ranked = CRM_APP_MAP.map((place) => {
    const haystacks = [place.title, place.how, place.section, place.path, ...place.keywords];
    let score = 0;
    for (const hay of haystacks) {
      score = Math.max(score, tokenScore(q, hay));
    }
    for (const word of q.split(' ')) {
      if (word.length < 3) continue;
      for (const hay of haystacks) {
        if (normalize(hay).includes(word)) score += 4;
      }
    }
    return { ...place, score };
  })
    .filter((place) => place.score >= 62)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const unique = new Map<string, CrmAppPlace & { score: number }>();
  for (const place of ranked) {
    if (unique.has(place.path)) continue;
    unique.set(place.path, place);
    if (unique.size >= limit) break;
  }
  return Array.from(unique.values());
}

export function isInternalAppPath(url: string): boolean {
  const value = String(url || '').trim();
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  return !/^https?:/i.test(value);
}
