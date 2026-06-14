import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import GenericCRUDManager from './GenericCRUDManager';
import {
  FIRM_MANAGEMENT_DEFAULT_CURRENCY,
  formatFirmManagementAmount,
} from '../../lib/firmManagementCosts';
import OfficeExpenseDocumentCell from './OfficeExpenseDocumentCell';
import {
  OfficeExpenseInvoiceField,
  OfficeExpensePaymentConfirmationField,
  OfficeExpenseTaxReceiptField,
} from './OfficeExpenseDocumentField';
import type { OfficeExpenseDocColumn } from '../../lib/officeExpenseDocuments';
import type { ExpenseManagerEmbedProps } from '../reports/expenses/expenseDetailTypes';

type CreatorInfo = {
  name: string;
  photoUrl: string | null;
  employeeId: number | null;
};

const initialsFromDisplayName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '—') return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return parts[0].toUpperCase();
};

const stableHueForAvatar = (employeeId: number | null, label: string): number => {
  if (employeeId != null && Number.isFinite(employeeId)) {
    return Math.abs(Math.trunc(employeeId)) * 47 % 360;
  }
  let h = 0;
  for (let i = 0; i < label.length; i += 1) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0;
  }
  return h % 360;
};

const CreatedByAvatar: React.FC<{ creator: CreatorInfo }> = ({ creator }) => {
  const [imgErr, setImgErr] = useState(false);
  const url = creator.photoUrl?.trim() || '';
  const showPhoto = url.length > 0 && !imgErr;
  const hue = stableHueForAvatar(creator.employeeId, creator.name);
  const hue2 = (hue + 32) % 360;

  return (
    <div className="flex items-center gap-2 min-w-0">
      {showPhoto ? (
        <img
          src={url}
          alt=""
          className="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-base-100 dark:ring-base-300/60"
          onError={() => setImgErr(true)}
        />
      ) : (
        <span
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-base-100 dark:ring-base-300/60"
          style={{ background: `linear-gradient(145deg, hsl(${hue} 58% 46%), hsl(${hue2} 52% 36%))` }}
          aria-hidden
        >
          {initialsFromDisplayName(creator.name)}
        </span>
      )}
      <span className="truncate">{creator.name}</span>
    </div>
  );
};

const CURRENCY_OPTIONS = [
  { value: 'ILS', label: 'ILS (₪)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
];

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

const buildYearOptions = (currentYear: number): string[] => {
  const years: string[] = [];
  for (let y = currentYear - 5; y <= currentYear + 2; y += 1) {
    years.push(String(y));
  }
  return years;
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

const nextMonthStartIso = (year: string, month: string): string => {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return `${year}-${month}-01`;
  if (m >= 12) return `${y + 1}-01-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

const applyCreatedAtMonthFilter = (query: any, month: string, year: string) => {
  if (year && month) {
    const start = `${year}-${month}-01`;
    const end = nextMonthStartIso(year, month);
    return query.gte('created_at', start).lt('created_at', end);
  }
  if (year) {
    return query.gte('created_at', `${year}-01-01`).lt('created_at', `${Number(year) + 1}-01-01`);
  }
  return query;
};

const formatPaidAt = (value: unknown): string => {
  if (value == null || value === '') return '—';
  const s = String(value).trim().slice(0, 10);
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const coercePaid = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  return s === 'true' || s === 't' || s === '1' || s === 'yes';
};

const OfficeExpensesManager: React.FC<ExpenseManagerEmbedProps> = ({
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

  const [creatorByAuthId, setCreatorByAuthId] = useState<Record<string, CreatorInfo>>({});

  useEffect(() => {
    let cancelled = false;

    const loadCreators = async () => {
      const { data, error } = await supabase
        .from('users')
        .select(`
          auth_id,
          full_name,
          first_name,
          last_name,
          tenants_employee!employee_id(id, display_name, photo_url, photo)
        `)
        .not('auth_id', 'is', null);

      if (error) {
        console.error('Error fetching creators:', error);
        return;
      }
      if (cancelled) return;

      const map: Record<string, CreatorInfo> = {};
      (data || []).forEach(user => {
        if (!user.auth_id) return;
        const employeeJoin = user.tenants_employee as
          | { id?: number; display_name?: string | null; photo_url?: string | null; photo?: string | null }
          | { id?: number; display_name?: string | null; photo_url?: string | null; photo?: string | null }[]
          | null;
        const employee = Array.isArray(employeeJoin) ? employeeJoin[0] : employeeJoin;
        const name =
          employee?.display_name?.trim() ||
          user.full_name?.trim() ||
          [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
          'Unknown';
        const photoUrl =
          (typeof employee?.photo_url === 'string' && employee.photo_url.trim()) ||
          (typeof employee?.photo === 'string' && employee.photo.trim()) ||
          null;

        map[String(user.auth_id)] = {
          name,
          photoUrl,
          employeeId: employee?.id ?? null,
        };
      });
      setCreatorByAuthId(map);
    };

    void loadCreators();

    return () => {
      cancelled = true;
    };
  }, []);

  const formatCreatedBy = useCallback(
    (value: unknown) => {
      const creator = creatorByAuthId[String(value ?? '')];
      if (!creator) return '—';
      return <CreatedByAvatar creator={creator} />;
    },
    [creatorByAuthId],
  );

  const formatDocumentColumn = useCallback(
    (column: OfficeExpenseDocColumn, label: string) =>
      (value: unknown) => (
        <OfficeExpenseDocumentCell
          storagePath={typeof value === 'string' ? value : null}
          column={column}
          linkLabel={label}
        />
      ),
    [],
  );

  const queryModifier = useCallback(
    (query: any) => applyCreatedAtMonthFilter(query, filterMonth, filterYear),
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
        label: 'Firm',
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
        name: 'expense_type_id',
        label: 'Expense type',
        type: 'select' as const,
        required: false,
        foreignKey: {
          table: 'office_expense_types',
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
        name: 'description',
        label: 'Description',
        type: 'textarea' as const,
        required: false,
        placeholder: 'Optional notes',
      },
      {
        name: 'paid',
        label: 'Paid',
        type: 'boolean' as const,
        required: false,
        defaultValue: false,
        prepareValueForSave: (value: unknown, record?: Partial<{ paid_at?: unknown }> | null) => {
          const paid = coercePaid(value);
          if (!paid && record) {
            record.paid_at = null;
          }
          return paid;
        },
      },
      {
        name: 'paid_at',
        label: 'Paid at',
        type: 'date' as const,
        required: false,
        formatValue: formatPaidAt,
        prepareValueForSave: (value: unknown, record?: Partial<{ paid?: unknown }> | null) => {
          if (!coercePaid(record?.paid)) return null;
          if (value == null || value === '') return null;
          return String(value).trim().slice(0, 10) || null;
        },
      },
      {
        name: 'invoice',
        label: 'Invoice',
        type: 'custom' as const,
        required: false,
        hideInAdd: true,
        customComponent: OfficeExpenseInvoiceField,
        formatValue: formatDocumentColumn('invoice', 'Invoice'),
      },
      {
        name: 'payment_confirmation',
        label: 'Payment confirmation',
        type: 'custom' as const,
        required: false,
        hideInAdd: true,
        customComponent: OfficeExpensePaymentConfirmationField,
        formatValue: formatDocumentColumn('payment_confirmation', 'Payment confirmation'),
      },
      {
        name: 'tax_receipt',
        label: 'Tax receipt',
        type: 'custom' as const,
        required: false,
        hideInAdd: true,
        customComponent: OfficeExpenseTaxReceiptField,
        formatValue: formatDocumentColumn('tax_receipt', 'Tax receipt'),
      },
      {
        name: 'created_at',
        label: 'Created at',
        type: 'datetime' as const,
        readOnly: true,
        hideInAdd: true,
        hideInEdit: true,
      },
      {
        name: 'created_by',
        label: 'Created by',
        type: 'text' as const,
        readOnly: true,
        hideInAdd: true,
        hideInEdit: true,
        formatValue: formatCreatedBy,
      },
    ],
    [formatCreatedBy, formatDocumentColumn],
  );

  return (
    <GenericCRUDManager
      tableName="office_expenses"
      fields={fields}
      title="Office Expense"
      description="Office expenses per firm (Open AI, legal opinions, consultation, etc.)"
      pageSize={20}
      sortColumn="created_at"
      sortAscending={false}
      skipIdAssignment
      booleanStorage="native"
      filterBar={filterBar}
      queryModifier={queryModifier}
      queryModifierKey={`${filterYear}-${filterMonth}`}
    />
  );
};

export default OfficeExpensesManager;
