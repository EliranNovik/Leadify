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
  managementCostInvoiceKey,
  toBillingMonthStart,
  type FirmInvoiceDoc,
} from '../../lib/firmManagementCosts';
import FirmInvoiceDocumentsCell from './FirmInvoiceDocumentsCell';
import FirmManagementCostInvoiceField from './FirmManagementCostInvoiceField';
import type { ExpenseManagerEmbedProps } from '../reports/expenses/expenseDetailTypes';

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
}) => {
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(
    () => initialMonth ?? String(now.getMonth() + 1).padStart(2, '0'),
  );
  const [filterYear, setFilterYear] = useState(() => initialYear ?? String(now.getFullYear()));

  useEffect(() => {
    if (initialYear != null) setFilterYear(initialYear);
    if (initialMonth !== undefined) setFilterMonth(initialMonth);
  }, [initialYear, initialMonth]);
  const [totals, setTotals] = useState<TotalsSummary>({ totalNis: 0, rowCount: 0, firmCount: 0 });
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [invoicesByKey, setInvoicesByKey] = useState<Map<string, FirmInvoiceDoc[]>>(new Map());

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
  }, [filterMonth, filterYear]);

  const loadInvoices = useCallback(async () => {
    try {
      const index = await fetchFirmInvoicesIndex(filterMonth, filterYear);
      setInvoicesByKey(index);
    } catch (err) {
      console.error('Failed to load firm invoices:', err);
      setInvoicesByKey(new Map());
    }
  }, [filterMonth, filterYear]);

  const loadAuxData = useCallback(async () => {
    await Promise.all([loadTotals(), loadInvoices()]);
  }, [loadTotals, loadInvoices]);

  useEffect(() => {
    void loadAuxData();
  }, [loadAuxData]);

  const formatInvoiceColumn = useCallback(
    (_value: unknown, record: { firm_id?: string; billing_month?: string }) => {
      if (!record.firm_id || !record.billing_month) return '—';
      const key = managementCostInvoiceKey(record.firm_id, record.billing_month);
      const invoices = invoicesByKey.get(key) || [];
      return <FirmInvoiceDocumentsCell invoices={invoices} />;
    },
    [invoicesByKey],
  );

  const queryModifier = useCallback(
    (query: any) => applyBillingMonthFilter(query, filterMonth, filterYear),
    [filterMonth, filterYear],
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
    [formatInvoiceColumn, loadAuxData],
  );

  const totalFormatted = new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(totals.totalNis));

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="rounded-2xl border border-base-200 bg-white dark:bg-base-100 p-5 shadow-sm">
        <p className="text-sm font-medium text-base-content/60 uppercase tracking-wide">
          Total management costs (all firms)
        </p>
        <p className="text-3xl font-bold text-base-content mt-1 tabular-nums">
          {totalsLoading ? (
            <span className="loading loading-spinner loading-md align-middle" />
          ) : (
            totalFormatted
          )}
        </p>
        <p className="text-sm text-base-content/70 mt-2">
          <span className="font-medium text-base-content">{periodLabel}</span>
          {!totalsLoading && (
            <>
              {' · '}
              {totals.rowCount} {totals.rowCount === 1 ? 'entry' : 'entries'}
              {' · '}
              {totals.firmCount} {totals.firmCount === 1 ? 'firm' : 'firms'}
            </>
          )}
        </p>
      </div>

      <GenericCRUDManager
        tableName="firm_management_costs"
        fields={fields}
        title="Firm Management Cost"
        description="Monthly management costs per media supplier firm"
        pageSize={20}
        sortColumn="billing_month"
        sortAscending={false}
        skipIdAssignment
        filterBar={filterBar}
        queryModifier={queryModifier}
        queryModifierKey={`${filterYear}-${filterMonth}`}
        onRecordsLoaded={loadAuxData}
        booleanStorage="native"
      />
    </div>
  );
};

export default FirmManagementCostsManager;
