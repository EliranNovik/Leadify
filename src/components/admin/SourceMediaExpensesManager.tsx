import React, { useCallback, useEffect, useMemo, useState } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import { supabase } from '../../lib/supabase';

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

const formatAmount = (value: unknown): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₪${Math.round(n).toLocaleString()}`;
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
          className="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-base-100"
          onError={() => setImgErr(true)}
        />
      ) : (
        <span
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-base-100"
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

const parseExternSourceIds = (value: unknown): string[] => {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => parseExternSourceIds(v)).map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') {
    if (value.includes(',')) return value.split(',').map((v) => v.trim()).filter(Boolean);
    return [value.trim()].filter(Boolean);
  }
  try {
    const s = String(value).trim();
    return s ? [s] : [];
  } catch {
    return [];
  }
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
          onChange={(e) => emitChange(e.target.value, year || String(currentYear))}
        >
          <option value="">Select month</option>
          {MONTH_OPTIONS.map((opt) => (
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
          onChange={(e) => emitChange(month || '01', e.target.value)}
        >
          <option value="">Select year</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

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
        onChange={(e) => onMonthChange(e.target.value)}
        aria-label="Filter by month"
      >
        <option value="">All months</option>
        {MONTH_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        className="select select-bordered w-full sm:w-28"
        value={year}
        onChange={(e) => onYearChange(e.target.value)}
        aria-label="Filter by year"
      >
        <option value="">All years</option>
        {yearOptions.map((y) => (
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

const SourceMediaExpensesManager: React.FC = () => {
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(() => String(now.getMonth() + 1).padStart(2, '0'));
  const [filterYear, setFilterYear] = useState(() => String(now.getFullYear()));
  const [sourceChannelById, setSourceChannelById] = useState<Record<string, string>>({});
  const [sourceFirmById, setSourceFirmById] = useState<Record<string, string>>({});
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
      (data || []).forEach((user) => {
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

    loadCreators();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSourceMetadata = async () => {
      const [sourcesRes, firmsRes] = await Promise.all([
        supabase.from('misc_leadsource').select('id, channel_id'),
        supabase.from('firms').select(`
          id,
          name,
          firm_contacts(
            users:user_id(extern_source_id)
          )
        `),
      ]);

      if (sourcesRes.error || !sourcesRes.data) {
        console.error('Error fetching lead sources:', sourcesRes.error);
        return;
      }
      if (firmsRes.error) {
        console.error('Error fetching firms for source mapping:', firmsRes.error);
      }

      const channelIds = [
        ...new Set(
          sourcesRes.data.map((s) => s.channel_id).filter((id): id is string => Boolean(id)),
        ),
      ];

      let channelById: Record<string, string> = {};
      if (channelIds.length > 0) {
        const { data: channels, error: channelsError } = await supabase
          .from('channels')
          .select('id, label')
          .in('id', channelIds);

        if (channelsError) {
          console.error('Error fetching channels:', channelsError);
        } else {
          channelById = Object.fromEntries((channels || []).map((c) => [String(c.id), c.label]));
        }
      }

      const firmNamesBySourceId: Record<string, Set<string>> = {};
      (firmsRes.data || []).forEach((firm) => {
        const firmName = String(firm.name || '').trim();
        if (!firmName) return;

        (firm.firm_contacts || []).forEach((contact) => {
          const usersJoin = (contact as { users?: unknown }).users;
          const linkedUser = Array.isArray(usersJoin) ? usersJoin[0] : usersJoin;
          parseExternSourceIds((linkedUser as { extern_source_id?: unknown } | null)?.extern_source_id).forEach(
            (sourceId) => {
              if (!firmNamesBySourceId[sourceId]) {
                firmNamesBySourceId[sourceId] = new Set();
              }
              firmNamesBySourceId[sourceId].add(firmName);
            },
          );
        });
      });

      if (cancelled) return;

      const channelMap: Record<string, string> = {};
      const firmMap: Record<string, string> = {};

      sourcesRes.data.forEach((source) => {
        const sourceId = String(source.id);
        const channelId = source.channel_id ? String(source.channel_id) : null;

        channelMap[sourceId] = channelId ? channelById[channelId] ?? '—' : '—';

        const firmNames = firmNamesBySourceId[sourceId];
        firmMap[sourceId] = firmNames && firmNames.size > 0 ? Array.from(firmNames).join(', ') : '—';
      });

      setSourceChannelById(channelMap);
      setSourceFirmById(firmMap);
    };

    loadSourceMetadata();

    return () => {
      cancelled = true;
    };
  }, []);

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
      name: 'lead_source_id',
      label: 'Lead Source',
      type: 'select' as const,
      required: true,
      searchableSelect: true,
      foreignKey: {
        table: 'misc_leadsource',
        valueField: 'id',
        displayField: 'name',
      },
    },
    {
      name: 'source_firm',
      label: 'Firm',
      type: 'text' as const,
      readOnly: true,
      hideInAdd: true,
      hideInEdit: true,
      formatValue: (_value: unknown, record: { lead_source_id?: unknown }) =>
        sourceFirmById[String(record.lead_source_id ?? '')] ?? '—',
    },
    {
      name: 'source_channel',
      label: 'Channel',
      type: 'text' as const,
      readOnly: true,
      hideInAdd: true,
      hideInEdit: true,
      formatValue: (_value: unknown, record: { lead_source_id?: unknown }) =>
        sourceChannelById[String(record.lead_source_id ?? '')] ?? '—',
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
      name: 'amount',
      label: 'Amount (₪)',
      type: 'number' as const,
      required: true,
      placeholder: 'e.g., 5000',
      formatValue: (value: unknown) => formatAmount(value),
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
      formatValue: (value: unknown) => {
        const creator = creatorByAuthId[String(value ?? '')];
        if (!creator) return '—';
        return <CreatedByAvatar creator={creator} />;
      },
    },
  ],
    [sourceChannelById, sourceFirmById, creatorByAuthId],
  );

  return (
    <GenericCRUDManager
      tableName="source_media_expense"
      fields={fields}
      title="Source Media Expense"
      description="Manage monthly media/marketing spend per lead source"
      pageSize={20}
      sortColumn="expense_month"
      sortAscending={false}
      filterBar={filterBar}
      queryModifier={queryModifier}
      queryModifierKey={`${filterYear}-${filterMonth}`}
    />
  );
};

export default SourceMediaExpensesManager;
