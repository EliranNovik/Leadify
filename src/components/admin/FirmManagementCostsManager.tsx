import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import GenericCRUDManager from './GenericCRUDManager';
import {
  FIRM_MANAGEMENT_DEFAULT_CURRENCY,
  applyBillingMonthFilter,
  fetchFirmInvoicesIndex,
  formatBillingMonthLabel,
  formatFirmManagementAmount,
  managementAmountToNis,
  managementCostLineKey,
  toBillingMonthStart,
  type FirmInvoiceDoc,
} from '../../lib/firmManagementCosts';
import FirmInvoiceDocumentsCell from './FirmInvoiceDocumentsCell';
import FirmManagementCostInvoiceField from './FirmManagementCostInvoiceField';
import { FirmManagementCostDocumentsCell } from './FirmManagementCostDocumentCell';
import {
  FirmManagementCostPaymentConfirmationField,
  FirmManagementCostTaxReceiptField,
} from './FirmManagementCostDocumentField';
import type { FirmManagementCostDocColumn } from '../../lib/firmManagementCostDocuments';
import {
  fetchFirmManagementCostDocumentsIndex,
  type FirmManagementCostDocument,
} from '../../lib/firmManagementCostDocuments';
import type { ExpenseManagerEmbedProps } from '../reports/expenses/expenseDetailTypes';
import {
  expenseTypeIdByCode,
  expenseTypeLabelByCode,
  fetchActiveExpenseTypes,
  type ExpenseTypeRow,
} from '../../lib/expenseTypes';

const MONTH_OPTIONS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const CURRENCY_OPTIONS = [
  { value: 'ILS', label: 'ILS (₪)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
];

const buildYearOptions = (currentYear: number): string[] => {
  const years: string[] = [];
  for (let y = currentYear - 5; y <= currentYear + 2; y += 1) {
    years.push(String(y));
  }
  return years;
};

type MonthYearSelectProps = {
  value: unknown;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

const MonthYearSelect: React.FC<MonthYearSelectProps> = ({ value, onChange, readOnly }) => {
  const monthStart = toBillingMonthStart(value);
  const month = monthStart ? monthStart.split('-')[1] : '';
  const year = monthStart ? monthStart.split('-')[0] : '';
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => buildYearOptions(currentYear), [currentYear]);

  const emitChange = (nextMonth: string, nextYear: string) => {
    if (!nextMonth || !nextYear) {
      onChange('');
      return;
    }
    onChange(`${nextYear}-${nextMonth}-01`);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className="label py-0 mb-1">
          <span className="label-text text-xs text-base-content/70">Month</span>
        </label>
        <select
          className="select select-bordered w-full"
          value={month}
          disabled={readOnly}
          onChange={e => emitChange(e.target.value, year || String(currentYear))}
        >
          <option value="">Select month</option>
          {MONTH_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label py-0 mb-1">
          <span className="label-text text-xs text-base-content/70">Year</span>
        </label>
        <select
          className="select select-bordered w-full"
          value={year}
          disabled={readOnly}
          onChange={e => emitChange(month || '01', e.target.value)}
        >
          <option value="">Select year</option>
          {yearOptions.map(y => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

type MonthYearFilterBarProps = {
  month: string;
  year: string;
  onMonthChange: (month: string) => void;
  onYearChange: (year: string) => void;
};

const MonthYearFilterBar: React.FC<MonthYearFilterBarProps> = ({
  month,
  year,
  onMonthChange,
  onYearChange,
}) => {
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => buildYearOptions(currentYear), [currentYear]);

  return (
    <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
      <span className="text-sm text-base-content/70 whitespace-nowrap">View:</span>
      <select
        className="select select-bordered w-full sm:w-36"
        value={month}
        onChange={e => onMonthChange(e.target.value)}
        aria-label="Filter by month"
      >
        <option value="">All months</option>
        {MONTH_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        className="select select-bordered w-full sm:w-28"
        value={year}
        onChange={e => onYearChange(e.target.value)}
        aria-label="Filter by year"
      >
        <option value="">All years</option>
        {yearOptions.map(y => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
};

type TotalsSummary = {
  totalNis: number;
  rowCount: number;
  firmCount: number;
};

const FirmManagementCostsManager: React.FC<ExpenseManagerEmbedProps> = ({
  initialYear,
  initialMonth,
  expenseTypeCode,
}) => {
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(
    () => initialMonth ?? String(now.getMonth() + 1).padStart(2, '0'),
  );
  const [filterYear, setFilterYear] = useState(() => initialYear ?? String(now.getFullYear()));
  const [expenseTypes, setExpenseTypes] = useState<ExpenseTypeRow[]>([]);

  useEffect(() => {
    if (initialYear != null) setFilterYear(initialYear);
    if (initialMonth !== undefined) setFilterMonth(initialMonth);
  }, [initialYear, initialMonth]);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveExpenseTypes()
      .then(types => {
        if (!cancelled) setExpenseTypes(types);
      })
      .catch(err => {
        console.error('Failed to load expense types:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const lockedExpenseTypeId = useMemo(
    () => (expenseTypeCode ? expenseTypeIdByCode(expenseTypes, expenseTypeCode) : null),
    [expenseTypeCode, expenseTypes],
  );

  const lockedExpenseTypeLabel = useMemo(
    () => (expenseTypeCode ? expenseTypeLabelByCode(expenseTypes, expenseTypeCode) : null),
    [expenseTypeCode, expenseTypes],
  );

  const isExpenseTypeScoped = Boolean(expenseTypeCode);
  const [totals, setTotals] = useState<TotalsSummary>({ totalNis: 0, rowCount: 0, firmCount: 0 });
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [invoicesByKey, setInvoicesByKey] = useState<Map<string, FirmInvoiceDoc[]>>(new Map());
  const [paymentDocsByKey, setPaymentDocsByKey] = useState<Map<string, FirmManagementCostDocument[]>>(
    new Map(),
  );
  const [taxDocsByKey, setTaxDocsByKey] = useState<Map<string, FirmManagementCostDocument[]>>(
    new Map(),
  );

  const periodLabel = useMemo(() => {
    if (filterYear && filterMonth) {
      const d = new Date(`${filterYear}-${filterMonth}-01T12:00:00`);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (filterYear) return filterYear;
    return 'All periods';
  }, [filterMonth, filterYear]);

  const loadTotals = useCallback(async () => {
    setTotalsLoading(true);
    try {
      let q = supabase.from('firm_management_costs').select('firm_id, amount, currency');
      q = applyBillingMonthFilter(q, filterMonth, filterYear);
      if (lockedExpenseTypeId) {
        q = q.eq('expense_type_id', lockedExpenseTypeId);
      }
      const { data, error } = await q;
      if (error) throw error;

      const rows = data || [];
      const firmIds = new Set<string>();
      let totalNis = 0;
      rows.forEach((row: { firm_id: string; amount: unknown; currency: string | null }) => {
        firmIds.add(String(row.firm_id));
        totalNis += managementAmountToNis(row.amount, row.currency);
      });

      setTotals({
        totalNis,
        rowCount: rows.length,
        firmCount: firmIds.size,
      });
    } catch (err) {
      console.error('Failed to load management cost totals:', err);
      setTotals({ totalNis: 0, rowCount: 0, firmCount: 0 });
    } finally {
      setTotalsLoading(false);
    }
  }, [filterMonth, filterYear, lockedExpenseTypeId]);

  const loadInvoices = useCallback(async () => {
    try {
      const index = await fetchFirmInvoicesIndex(filterMonth, filterYear);
      setInvoicesByKey(index);
    } catch (err) {
      console.error('Failed to load firm invoices:', err);
      setInvoicesByKey(new Map());
    }
  }, [filterMonth, filterYear]);

  const loadCostDocuments = useCallback(async () => {
    try {
      const { paymentByKey, taxByKey } = await fetchFirmManagementCostDocumentsIndex(
        filterMonth,
        filterYear,
      );
      setPaymentDocsByKey(paymentByKey);
      setTaxDocsByKey(taxByKey);
    } catch (err) {
      console.error('Failed to load management cost documents:', err);
      setPaymentDocsByKey(new Map());
      setTaxDocsByKey(new Map());
    }
  }, [filterMonth, filterYear]);

  const loadAuxData = useCallback(async () => {
    await Promise.all([loadTotals(), loadInvoices(), loadCostDocuments()]);
  }, [loadTotals, loadInvoices, loadCostDocuments]);

  useEffect(() => {
    void loadAuxData();
  }, [loadAuxData]);

  const formatInvoiceColumn = useCallback(
    (_value: unknown, record: { id?: string; firm_id?: string; billing_month?: string }) => {
      if (!record.firm_id || !record.billing_month) return '—';
      const key = managementCostLineKey(record.id, record.firm_id, record.billing_month);
      const invoices = invoicesByKey.get(key) || [];
      return <FirmInvoiceDocumentsCell invoices={invoices} />;
    },
    [invoicesByKey],
  );

  const formatCostDocumentColumn = useCallback(
    (column: FirmManagementCostDocColumn, label: string, docsByKey: Map<string, FirmManagementCostDocument[]>) =>
      (_value: unknown, record: { id?: string; firm_id?: string; billing_month?: string }) => {
        if (!record.firm_id || !record.billing_month) return '—';
        const key = managementCostLineKey(record.id, record.firm_id, record.billing_month);
        const docs = docsByKey.get(key) || [];
        return <FirmManagementCostDocumentsCell documents={docs} column={column} linkLabel={label} />;
      },
    [],
  );

  const queryModifier = useCallback(
    (query: any) => {
      let q = applyBillingMonthFilter(query, filterMonth, filterYear);
      if (expenseTypeCode && !lockedExpenseTypeId) {
        return q.eq('expense_type_id', '00000000-0000-0000-0000-000000000000');
      }
      if (lockedExpenseTypeId) {
        q = q.eq('expense_type_id', lockedExpenseTypeId);
      }
      return q;
    },
    [filterMonth, filterYear, lockedExpenseTypeId, expenseTypeCode],
  );

  const filterBar = (
    <MonthYearFilterBar
      month={filterMonth}
      year={filterYear}
      onMonthChange={setFilterMonth}
      onYearChange={setFilterYear}
    />
  );

  const fields = useMemo(
    () => [
      {
        name: 'firm_id',
        label: 'Firm (media supplier)',
        type: 'select' as const,
        required: true,
        searchableSelect: true,
        foreignKey: {
          table: 'firms',
          valueField: 'id',
          displayField: 'name',
        },
      },
      {
        name: 'billing_month',
        label: 'Month & Year',
        type: 'custom' as const,
        required: true,
        customComponent: MonthYearSelect,
        formatValue: (value: unknown) => formatBillingMonthLabel(value),
        prepareValueForForm: (value: unknown) => toBillingMonthStart(value) ?? '',
        prepareValueForSave: (value: unknown) => toBillingMonthStart(value),
      },
      {
        name: 'expense_type_id',
        label: 'Expense type',
        type: 'select' as const,
        required: true,
        hideInAdd: isExpenseTypeScoped,
        hideInEdit: isExpenseTypeScoped,
        hideInTable: isExpenseTypeScoped,
        foreignKey: {
          table: 'expense_types',
          valueField: 'id',
          displayField: 'label',
        },
      },
      {
        name: 'amount',
        label: 'Amount',
        type: 'number' as const,
        required: true,
        placeholder: 'e.g., 5000',
        formatValue: (value: unknown, record: { currency?: string | null }) =>
          formatFirmManagementAmount(value, record?.currency),
      },
      {
        name: '_invoice_document',
        label: 'Invoice document',
        type: 'text' as const,
        hideInAdd: true,
        hideInEdit: true,
        formatValue: formatInvoiceColumn,
      },
      {
        name: '_invoice_upload',
        label: 'Invoice document',
        type: 'custom' as const,
        hideInTable: true,
        customComponent: FirmManagementCostInvoiceField,
        customProps: { onInvoiceChanged: loadAuxData },
      },
      {
        name: '_payment_confirmation_docs',
        label: 'Payment confirmation',
        type: 'custom' as const,
        required: false,
        hideInAdd: true,
        customComponent: FirmManagementCostPaymentConfirmationField,
        customProps: { onDocumentsChanged: loadAuxData },
        formatValue: formatCostDocumentColumn(
          'payment_confirmation',
          'Payment confirmation',
          paymentDocsByKey,
        ),
      },
      {
        name: '_tax_receipt_docs',
        label: 'Tax receipt',
        type: 'custom' as const,
        required: false,
        hideInAdd: true,
        customComponent: FirmManagementCostTaxReceiptField,
        customProps: { onDocumentsChanged: loadAuxData },
        formatValue: formatCostDocumentColumn('tax_receipt', 'Tax receipt', taxDocsByKey),
      },
      {
        name: 'currency',
        label: 'Currency',
        type: 'select' as const,
        required: true,
        defaultValue: FIRM_MANAGEMENT_DEFAULT_CURRENCY,
        options: CURRENCY_OPTIONS,
        prepareValueForSave: (value: unknown) =>
          (value && String(value).trim()) || FIRM_MANAGEMENT_DEFAULT_CURRENCY,
      },
      {
        name: 'notes',
        label: 'Notes',
        type: 'textarea' as const,
        required: false,
        placeholder: 'Optional',
      },
      {
        name: 'created_at',
        label: 'Created At',
        type: 'datetime' as const,
        readOnly: true,
        hideInAdd: true,
        hideInEdit: true,
      },
      {
        name: 'updated_at',
        label: 'Updated At',
        type: 'datetime' as const,
        readOnly: true,
        hideInAdd: true,
        hideInEdit: true,
      },
    ],
    [formatInvoiceColumn, formatCostDocumentColumn, loadAuxData, isExpenseTypeScoped, paymentDocsByKey, taxDocsByKey],
  );

  const createDefaults = useMemo(
    () => (lockedExpenseTypeId ? { expense_type_id: lockedExpenseTypeId } : undefined),
    [lockedExpenseTypeId],
  );

  const managerTitle = lockedExpenseTypeLabel
    ? `Firm Management Cost (${lockedExpenseTypeLabel})`
    : 'Firm Management Cost';

  const managerDescription = lockedExpenseTypeLabel
    ? `Monthly firm costs for ${lockedExpenseTypeLabel.toLowerCase()}`
    : 'Monthly management costs per media supplier firm';

  const searchBarExtra = totalsLoading ? (
    <span className="loading loading-spinner loading-sm text-primary" />
  ) : (
    <span className="text-sm text-base-content">
      <span className="font-semibold">Total: </span>
      <span className="font-bold tabular-nums">
        {formatFirmManagementAmount(totals.totalNis, FIRM_MANAGEMENT_DEFAULT_CURRENCY)}
      </span>
      <span className="ml-1 text-base-content/55">
        · {periodLabel}
        {totals.rowCount > 0 && (
          <>
            {' '}
            · {totals.rowCount} {totals.rowCount === 1 ? 'entry' : 'entries'}
            {totals.firmCount > 0 && (
              <>
                {' '}
                · {totals.firmCount} {totals.firmCount === 1 ? 'firm' : 'firms'}
              </>
            )}
          </>
        )}
      </span>
    </span>
  );

  return (
    <GenericCRUDManager
      tableName="firm_management_costs"
      fields={fields}
      title={managerTitle}
      description={managerDescription}
      pageSize={20}
      sortColumn="billing_month"
      sortAscending={false}
      skipIdAssignment
      filterBar={filterBar}
      searchBarExtra={searchBarExtra}
      queryModifier={queryModifier}
      queryModifierKey={`${filterYear}-${filterMonth}-${lockedExpenseTypeId ?? 'all'}`}
      onRecordsLoaded={loadAuxData}
      booleanStorage="native"
      createDefaults={createDefaults}
    />
  );
};

export default FirmManagementCostsManager;
