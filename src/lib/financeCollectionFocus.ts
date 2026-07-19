/** Focus presets from Finance dashboard → Collection / Collection Due auto-filters. */

export type FinanceCollectionFocusId =
  | 'overdue'
  | 'due-today'
  | 'due-7'
  | 'ready'
  | 'pending-proforma'
  | 'pending-no-proforma'
  | 'collected-today';

export type FinanceCollectionFocusTab = 'collection' | 'collection-due';

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
      return raw;
    default:
      return null;
  }
}

export function financeFocusDefaultTab(focus: FinanceCollectionFocusId): FinanceCollectionFocusTab {
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
  const wideFrom = '2020-01-01';
  const wideTo = isoDateLocal(addDays(today, 365));

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
  };

  switch (focus) {
    case 'overdue':
      return {
        ...base,
        fromDate: wideFrom,
        toDate: yesterday,
        collected: ['no_with_proforma', 'no_without_proforma'],
        due: 'due_only',
      };
    case 'due-today':
      return {
        ...base,
        fromDate: todayStr,
        toDate: todayStr,
        collected: ['no_with_proforma', 'no_without_proforma'],
        due: 'due_only',
      };
    case 'due-7':
      return {
        ...base,
        fromDate: tomorrow,
        toDate: in7,
        collected: ['no_with_proforma', 'no_without_proforma'],
        due: 'due_only',
      };
    case 'ready':
      return {
        ...base,
        fromDate: wideFrom,
        toDate: wideTo,
        collected: ['no_with_proforma', 'no_without_proforma'],
        due: 'due_only',
      };
    case 'pending-proforma':
      return {
        ...base,
        fromDate: wideFrom,
        toDate: wideTo,
        collected: ['no_with_proforma'],
        due: 'ignore',
      };
    case 'pending-no-proforma':
      return {
        ...base,
        fromDate: wideFrom,
        toDate: wideTo,
        collected: ['no_without_proforma'],
        due: 'ignore',
      };
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
  const wideFrom = '2020-01-01';
  const wideTo = isoDateLocal(addDays(today, 365));

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
    case 'overdue':
      return { ...base, fromDate: wideFrom, toDate: yesterday };
    case 'due-today':
      return { ...base, fromDate: todayStr, toDate: todayStr };
    case 'due-7':
      return { ...base, fromDate: tomorrow, toDate: in7 };
    case 'ready':
      return { ...base, fromDate: wideFrom, toDate: wideTo };
    default:
      return null;
  }
}

export function collectionDisplayFilterForFocus(
  focus: FinanceCollectionFocusId,
): 'all' | 'uncollected' | 'with_proforma' {
  if (focus === 'pending-proforma') return 'with_proforma';
  if (
    focus === 'overdue' ||
    focus === 'due-today' ||
    focus === 'due-7' ||
    focus === 'ready' ||
    focus === 'pending-no-proforma'
  ) {
    return 'uncollected';
  }
  return 'all';
}
