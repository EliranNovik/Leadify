import { last7DaysRange, last30DaysRange } from './paymentRequestEmail';

/** Focus presets from Finance dashboard → Collection / Collection Due auto-filters. */

export type FinanceCollectionFocusId =
  | 'overdue'
  | 'due-today'
  | 'due-7'
  | 'ready'
  | 'pending-proforma'
  | 'pending-no-proforma'
  | 'collected-today'
  | 'signed-missing-plan'
  | 'due-unsent-proforma'
  | 'due-sent-proforma'
  | 'due-no-proforma'
  | 'due-invoice-instructions'
  | 'collected-this-month';

export type FinanceCollectionFocusTab = 'collection' | 'collection-due' | 'signed';

export type CollectionFocusFilters = {
  fromDate: string;
  toDate: string;
  paymentFromDate: string;
  paymentToDate: string;
  collected: string[];
  categoryId: string[];
  order: string[];
  currencyId: string[];
  due: 'ignore' | 'due_only';
  proformaEmail: 'any' | 'not_sent' | 'sent';
};

export type CollectionDueFocusFilters = {
  fromDate: string;
  toDate: string;
  category: string[];
  order: string[];
  department: string[];
  employee: string;
  employeeType: string;
};

function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayLocal(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function parseFinanceCollectionFocus(raw: string | null | undefined): FinanceCollectionFocusId | null {
  switch (raw) {
    case 'overdue':
    case 'due-today':
    case 'due-7':
    case 'ready':
    case 'pending-proforma':
    case 'pending-no-proforma':
    case 'collected-today':
    case 'signed-missing-plan':
    case 'due-unsent-proforma':
    case 'due-sent-proforma':
    case 'due-no-proforma':
    case 'due-invoice-instructions':
    case 'collected-this-month':
      return raw;
    default:
      return null;
  }
}

export function financeFocusDefaultTab(focus: FinanceCollectionFocusId): FinanceCollectionFocusTab {
  if (focus === 'signed-missing-plan') return 'signed';
  if (focus === 'overdue' || focus === 'due-7' || focus === 'ready') return 'collection-due';
  return 'collection';
}

/** Build Collection Finances filters that match a dashboard Attention card. */
export function buildCollectionFiltersForFocus(focus: FinanceCollectionFocusId): CollectionFocusFilters {
  const today = todayLocal();
  const todayStr = isoDateLocal(today);
  const yesterday = isoDateLocal(addDays(today, -1));
  const tomorrow = isoDateLocal(addDays(today, 1));
  const in7 = isoDateLocal(addDays(today, 7));

  const base: CollectionFocusFilters = {
    fromDate: todayStr,
    toDate: todayStr,
    paymentFromDate: '',
    paymentToDate: '',
    collected: [],
    categoryId: [],
    order: [],
    currencyId: [],
    due: 'ignore',
    proformaEmail: 'any',
  };

  switch (focus) {
    case 'overdue': {
      const last30 = last30DaysRange(today);
      return {
        ...base,
        fromDate: last30.from,
        toDate: yesterday,
        collected: ['no_with_proforma', 'no_with_proforma_sent', 'no_without_proforma'],
        due: 'due_only',
      };
    }
    case 'due-today':
      return {
        ...base,
        fromDate: todayStr,
        toDate: todayStr,
        collected: ['no_with_proforma', 'no_with_proforma_sent', 'no_without_proforma'],
        due: 'due_only',
      };
    case 'due-7':
      return {
        ...base,
        fromDate: tomorrow,
        toDate: in7,
        collected: ['no_with_proforma', 'no_with_proforma_sent', 'no_without_proforma'],
        due: 'due_only',
      };
    case 'ready': {
      const last30 = last30DaysRange(today);
      return {
        ...base,
        fromDate: last30.from,
        toDate: last30.to,
        collected: ['no_with_proforma', 'no_with_proforma_sent', 'no_without_proforma'],
        due: 'due_only',
      };
    }
    case 'pending-proforma': {
      const last30 = last30DaysRange(today);
      return {
        ...base,
        fromDate: last30.from,
        toDate: last30.to,
        collected: ['no_with_proforma', 'no_with_proforma_sent'],
        due: 'due_only',
      };
    }
    case 'pending-no-proforma': {
      const last30 = last30DaysRange(today);
      return {
        ...base,
        fromDate: last30.from,
        toDate: last30.to,
        collected: ['no_without_proforma'],
        due: 'due_only',
      };
    }
    case 'collected-today':
      return {
        ...base,
        fromDate: '',
        toDate: '',
        paymentFromDate: todayStr,
        paymentToDate: todayStr,
        collected: ['yes_with_proforma', 'yes_without_proforma'],
        due: 'ignore',
      };
    case 'due-unsent-proforma': {
      const last30 = last30DaysRange(today);
      return {
        ...base,
        fromDate: last30.from,
        toDate: last30.to,
        collected: ['no_with_proforma'],
        due: 'due_only',
        proformaEmail: 'not_sent',
      };
    }
    case 'due-sent-proforma': {
      const last30 = last30DaysRange(today);
      return {
        ...base,
        fromDate: last30.from,
        toDate: last30.to,
        collected: ['no_with_proforma_sent'],
        due: 'due_only',
      };
    }
    case 'due-no-proforma': {
      const last30 = last30DaysRange(today);
      return {
        ...base,
        fromDate: last30.from,
        toDate: last30.to,
        collected: ['no_without_proforma'],
        due: 'due_only',
      };
    }
    case 'due-invoice-instructions': {
      const last7 = last7DaysRange(today);
      return {
        ...base,
        fromDate: last7.from,
        toDate: last7.to,
        collected: ['no_without_proforma', 'no_with_proforma'],
        due: 'due_only',
        proformaEmail: 'not_sent',
      };
    }
    case 'collected-this-month': {
      const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      return {
        ...base,
        fromDate: '',
        toDate: '',
        paymentFromDate: monthStart,
        paymentToDate: todayStr,
        collected: ['yes_with_proforma', 'yes_without_proforma'],
        due: 'ignore',
      };
    }
    default:
      return base;
  }
}

/** Build Collection Due filters for overdue / next-7 / ready cards. */
export function buildCollectionDueFiltersForFocus(
  focus: FinanceCollectionFocusId,
): CollectionDueFocusFilters | null {
  const today = todayLocal();
  const todayStr = isoDateLocal(today);
  const yesterday = isoDateLocal(addDays(today, -1));
  const tomorrow = isoDateLocal(addDays(today, 1));
  const in7 = isoDateLocal(addDays(today, 7));

  const base: CollectionDueFocusFilters = {
    fromDate: todayStr,
    toDate: todayStr,
    category: [],
    order: [],
    department: [],
    employee: '',
    employeeType: 'actual_employee_due',
  };

  switch (focus) {
    case 'overdue': {
      const last30 = last30DaysRange(today);
      return { ...base, fromDate: last30.from, toDate: yesterday };
    }
    case 'due-today':
      return { ...base, fromDate: todayStr, toDate: todayStr };
    case 'due-7':
      return { ...base, fromDate: tomorrow, toDate: in7 };
    case 'ready': {
      const last30 = last30DaysRange(today);
      return { ...base, fromDate: last30.from, toDate: last30.to };
    }
    default:
      return null;
  }
}

export function collectionDisplayFilterForFocus(
  focus: FinanceCollectionFocusId,
): 'all' | 'uncollected' | 'with_proforma' {
  if (focus === 'pending-proforma' || focus === 'due-unsent-proforma' || focus === 'due-sent-proforma') {
    return 'with_proforma';
  }
  if (
    focus === 'overdue' ||
    focus === 'due-today' ||
    focus === 'due-7' ||
    focus === 'ready' ||
    focus === 'pending-no-proforma' ||
    focus === 'due-no-proforma' ||
    focus === 'due-invoice-instructions'
  ) {
    return 'uncollected';
  }
  return 'all';
}
