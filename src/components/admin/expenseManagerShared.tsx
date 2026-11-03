import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Pieces every expense rubric's admin screen needs: a month picker, a month/year filter bar and the
 * avatar of whoever added the row. Written once here for the screens added since; the older
 * managers (rent, partner draws, source media) still carry their own copies.
 */

export const EXPENSE_MONTH_OPTIONS = [
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

export const toMonthStart = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, 10);
  const match = s.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-01`;
};

export const formatMonthLabel = (value: unknown): string => {
  const monthStart = toMonthStart(value);
  if (!monthStart) return '—';
  const d = new Date(`${monthStart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export const formatAmountNis = (value: unknown): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₪${Math.round(n).toLocaleString()}`;
};

export const formatDateLabel = (value: unknown): string => {
  const s = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const buildExpenseYearOptions = (currentYear: number): string[] => {
  const years: string[] = [];
  for (let y = currentYear - 5; y <= currentYear + 2; y += 1) years.push(String(y));
  return years;
};

const parseMonthYear = (value: unknown): { month: string; year: string } => {
  const monthStart = toMonthStart(value);
  if (!monthStart) return { month: '', year: '' };
  const [year, month] = monthStart.split('-');
  return { month, year };
};

export const MonthYearSelect: React.FC<{
  value: unknown;
  onChange: (value: string) => void;
  readOnly?: boolean;
}> = ({ value, onChange, readOnly }) => {
  const { month, year } = parseMonthYear(value);
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => buildExpenseYearOptions(currentYear), [currentYear]);

  const emitChange = (nextMonth: string, nextYear: string) => {
    if (!nextMonth || !nextYear) {
      onChange('');
      return;
    }
    onChange(`${nextYear}-${nextMonth}-01`);
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="label mb-1 py-0">
          <span className="label-text text-xs text-base-content/70">Month</span>
        </label>
        <select
          className="select select-bordered w-full"
          value={month}
          disabled={readOnly}
          onChange={e => emitChange(e.target.value, year || String(currentYear))}
        >
          <option value="">Select month</option>
          {EXPENSE_MONTH_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label mb-1 py-0">
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

export const MonthYearFilterBar: React.FC<{
  month: string;
  year: string;
  onMonthChange: (month: string) => void;
  onYearChange: (year: string) => void;
}> = ({ month, year, onMonthChange, onYearChange }) => {
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => buildExpenseYearOptions(currentYear), [currentYear]);

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <span className="whitespace-nowrap text-sm text-base-content/70">View:</span>
      <select
        className="select select-bordered w-full sm:w-36"
        value={month}
        onChange={e => onMonthChange(e.target.value)}
        aria-label="Filter by month"
      >
        <option value="">All months</option>
        {EXPENSE_MONTH_OPTIONS.map(opt => (
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

/** Narrows a list query to a month, a whole year, or leaves it alone. */
export const applyMonthColumnFilter = (
  query: any,
  column: string,
  month: string,
  year: string,
): any => {
  if (year && month) return query.eq(column, `${year}-${month}-01`);
  if (year) {
    return query.gte(column, `${year}-01-01`).lt(column, `${Number(year) + 1}-01-01`);
  }
  return query;
};

/** Same, for tables that date rows by a real date rather than a month anchor. */
export const applyDateColumnFilter = (
  query: any,
  column: string,
  month: string,
  year: string,
): any => {
  if (!year) return query;
  if (month) {
    const next = Number(month) === 12 ? `${Number(year) + 1}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`;
    return query.gte(column, `${year}-${month}-01`).lt(column, next);
  }
  return query.gte(column, `${year}-01-01`).lt(column, `${Number(year) + 1}-01-01`);
};

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
    return (Math.abs(Math.trunc(employeeId)) * 47) % 360;
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
    <div className="flex min-w-0 items-center gap-2">
      {showPhoto ? (
        <img
          src={url}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-base-100 dark:ring-base-300/60"
          onError={() => setImgErr(true)}
        />
      ) : (
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-base-100 dark:ring-base-300/60"
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

/** Renders a `created_by` auth id as the employee's avatar and name. */
export function useCreatedByFormatter(): (value: unknown) => React.ReactNode {
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

        map[String(user.auth_id)] = { name, photoUrl, employeeId: employee?.id ?? null };
      });
      setCreatorByAuthId(map);
    };

    void loadCreators();

    return () => {
      cancelled = true;
    };
  }, []);

  return useCallback(
    (value: unknown) => {
      const creator = creatorByAuthId[String(value ?? '')];
      if (!creator) return '—';
      return <CreatedByAvatar creator={creator} />;
    },
    [creatorByAuthId],
  );
}

/**
 * The paid flag, as every expense rubric declares it.
 *
 * Deliberately left without a `formatValue`: the plain boolean field is what GenericCRUDManager
 * renders as a toggle in the table, which is how a row gets marked paid in one click.
 */
export const PAID_EXPENSE_FIELD = {
  name: 'paid',
  label: 'Paid',
  type: 'boolean' as const,
  required: false,
  defaultValue: false,
};
