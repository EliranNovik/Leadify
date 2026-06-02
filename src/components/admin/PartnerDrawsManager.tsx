import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  fetchActiveStaffEmployees,
  type ActiveStaffEmployee,
} from '../../lib/employeeSalaries';
import ActiveEmployeeSelect, { EmployeeAvatarLabel } from './ActiveEmployeeSelect';
import GenericCRUDManager from './GenericCRUDManager';
import type { ExpenseManagerEmbedProps } from '../reports/expenses/expenseDetailTypes';

type CreatorInfo = {
  name: string;
  photoUrl: string | null;
  employeeId: number | null;
};

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

const toMonthStart = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, 10);
  const match = s.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-01`;
};

const parseMonthYear = (value: unknown): { month: string; year: string } => {
  const monthStart = toMonthStart(value);
  if (!monthStart) return { month: '', year: '' };
  const [year, month] = monthStart.split('-');
  return { month, year };
};

const formatMonthLabel = (value: unknown): string => {
  const monthStart = toMonthStart(value);
  if (!monthStart) return '—';
  const d = new Date(`${monthStart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const formatAmountNis = (value: unknown): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₪${Math.round(n).toLocaleString()}`;
};

const buildYearOptions = (currentYear: number): string[] => {
  const years: string[] = [];
  for (let y = currentYear - 5; y <= currentYear + 2; y += 1) {
    years.push(String(y));
  }
  return years;
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

type MonthYearSelectProps = {
  value: unknown;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

const MonthYearSelect: React.FC<MonthYearSelectProps> = ({ value, onChange, readOnly }) => {
  const { month, year } = parseMonthYear(value);
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

const applyExpenseMonthFilter = (query: any, month: string, year: string) => {
  if (year && month) {
    return query.eq('expense_month', `${year}-${month}-01`);
  }
  if (year) {
    return query.gte('expense_month', `${year}-01-01`).lt('expense_month', `${Number(year) + 1}-01-01`);
  }
  return query;
};

const PartnerDrawsManager: React.FC<ExpenseManagerEmbedProps> = ({
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
  const [employeeById, setEmployeeById] = useState<Record<string, ActiveStaffEmployee>>({});

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

  useEffect(() => {
    let cancelled = false;

    const loadEmployeeLookup = async () => {
      const active = await fetchActiveStaffEmployees();
      const map: Record<string, ActiveStaffEmployee> = {};
      active.forEach(emp => {
        map[String(emp.id)] = emp;
      });

      const { data: drawRows } = await supabase.from('partner_draw_expense').select('employee_id');
      const extraIds = [
        ...new Set(
          (drawRows || [])
            .map((r: { employee_id: number }) => r.employee_id)
            .filter((id: number) => id && !map[String(id)]),
        ),
      ];

      if (extraIds.length > 0) {
        const { data: extraEmps } = await supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url, photo')
          .in('id', extraIds);
        (extraEmps || []).forEach(
          (emp: { id: number; display_name: string | null; photo_url: string | null; photo: string | null }) => {
            map[String(emp.id)] = {
              id: emp.id,
              display_name: emp.display_name?.trim() || `Employee #${emp.id}`,
              photo_url:
                (typeof emp.photo_url === 'string' && emp.photo_url.trim()) ||
                (typeof emp.photo === 'string' && emp.photo.trim()) ||
                null,
            };
          },
        );
      }

      if (!cancelled) setEmployeeById(map);
    };

    void loadEmployeeLookup().catch(err =>
      console.error('Failed to load employees for partner draws:', err),
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const formatEmployee = useCallback(
    (value: unknown) => {
      const emp = employeeById[String(value ?? '')];
      if (!emp) return '—';
      return <EmployeeAvatarLabel employee={emp} />;
    },
    [employeeById],
  );

  const formatCreatedBy = useCallback(
    (value: unknown) => {
      const creator = creatorByAuthId[String(value ?? '')];
      if (!creator) return '—';
      return <CreatedByAvatar creator={creator} />;
    },
    [creatorByAuthId],
  );

  const queryModifier = useCallback(
    (query: any) => applyExpenseMonthFilter(query, filterMonth, filterYear),
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
        name: 'employee_id',
        label: 'Employee',
        type: 'custom' as const,
        required: true,
        customComponent: ActiveEmployeeSelect,
        formatValue: formatEmployee,
        prepareValueForForm: (value: unknown) =>
          value != null && value !== '' ? Number(value) : '',
        prepareValueForSave: (value: unknown) =>
          value === '' || value == null ? null : Number(value),
      },
      {
        name: 'expense_month',
        label: 'Month & Year',
        type: 'custom' as const,
        required: true,
        customComponent: MonthYearSelect,
        formatValue: (value: unknown) => formatMonthLabel(value),
        prepareValueForForm: (value: unknown) => toMonthStart(value) ?? '',
        prepareValueForSave: (value: unknown) => toMonthStart(value),
      },
      {
        name: 'amount_nis',
        label: 'Amount (₪)',
        type: 'number' as const,
        required: true,
        placeholder: 'e.g., 15000',
        formatValue: (value: unknown) => formatAmountNis(value),
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
        name: 'created_by',
        label: 'Created By',
        type: 'text' as const,
        readOnly: true,
        hideInAdd: true,
        hideInEdit: true,
        formatValue: formatCreatedBy,
      },
    ],
    [formatCreatedBy, formatEmployee],
  );

  return (
    <GenericCRUDManager
      tableName="partner_draw_expense"
      fields={fields}
      title="Partner Draw"
      description="Monthly partner draw amount in NIS per employee"
      pageSize={20}
      sortColumn="expense_month"
      sortAscending={false}
      filterBar={filterBar}
      queryModifier={queryModifier}
      queryModifierKey={`${filterYear}-${filterMonth}`}
      booleanStorage="native"
    />
  );
};

export default PartnerDrawsManager;
