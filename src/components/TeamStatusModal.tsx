import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  XMarkIcon,
  MagnifyingGlassIcon,
  UserGroupIcon,
  UserIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  ClockIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import RMQMessagesPage from '../pages/RMQMessagesPage';
import { supabase } from '../lib/supabase';
import {
  unavailabilityTypeCompactLabelClass,
  unavailabilityTypeLabel,
  unavailabilityGeneralTimeRange,
  type EmployeeUnavailabilityEntry,
  type UnavailabilityType,
} from '../lib/employeeUnavailabilities';
import { resolveWorkplaceName } from '../lib/clockInLocations';
import { fetchActiveStaffEmployeesWithDepartment } from '../lib/employeeSalaries';
import { useAdminRole } from '../hooks/useAdminRole';

// ─── Types ────────────────────────────────────────────────────────────────────

type ClockInRow = {
  clock_in_time: string;
  clock_in_place: { name: string } | { name: string }[] | null;
  clock_in_location_id: number | null;
};

type EmployeeRow = {
  id: string | number;
  display_name: string;
  photo_url: string | null;
  department: string | null;
  email: string | null;
  chatUserId: string | null;
  clockIn: ClockInRow | null;
  workplaceName: string | null;
  unavailabilities: EmployeeUnavailabilityEntry[];
};

type ActiveFilter =
  | { kind: 'all' }
  | { kind: 'clocked_in' }
  | { kind: 'clocked_out' }
  | { kind: 'unavailable' }
  | { kind: 'available' }
  | { kind: 'not_clocked_in_available' }
  | { kind: 'workplace'; name: string }
  | { kind: 'unavail_type'; type: UnavailabilityType };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: string): string {
  const [y, m, day] = date.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

const AVATAR_COLOR_CLASSES = [
  'bg-violet-100 text-violet-800',
  'bg-indigo-100 text-indigo-800',
  'bg-sky-100 text-sky-800',
  'bg-teal-100 text-teal-800',
  'bg-emerald-100 text-emerald-800',
  'bg-lime-100 text-lime-800',
  'bg-amber-100 text-amber-900',
  'bg-orange-100 text-orange-800',
  'bg-rose-100 text-rose-800',
  'bg-fuchsia-100 text-fuchsia-800',
  'bg-pink-100 text-pink-800',
  'bg-cyan-100 text-cyan-800',
  'bg-blue-100 text-blue-800',
  'bg-purple-100 text-purple-800',
] as const;

function hashString(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function avatarColorClass(name: string): string {
  return AVATAR_COLOR_CLASSES[hashString(name.trim().toLowerCase()) % AVATAR_COLOR_CLASSES.length];
}

function isValidPhotoUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  const trimmed = url.trim();
  return trimmed.startsWith('http://')
    || trimmed.startsWith('https://')
    || trimmed.startsWith('data:')
    || trimmed.startsWith('/');
}

function filterMatches(emp: EmployeeRow, filter: ActiveFilter): boolean {
  switch (filter.kind) {
    case 'all': return true;
    case 'clocked_in': return emp.clockIn !== null;
    case 'clocked_out': return emp.clockIn === null;
    case 'unavailable': return emp.unavailabilities.length > 0;
    case 'available': return emp.unavailabilities.length === 0;
    case 'not_clocked_in_available':
      return emp.unavailabilities.length === 0 && emp.clockIn === null;
    case 'workplace':
      return emp.clockIn !== null && emp.workplaceName?.toLowerCase() === filter.name.toLowerCase();
    case 'unavail_type':
      return emp.unavailabilities.some((u) => u.unavailability_type === filter.type);
  }
}

function filterKey(f: ActiveFilter): string {
  if (f.kind === 'workplace') return `workplace:${f.name}`;
  if (f.kind === 'unavail_type') return `unavail_type:${f.type}`;
  return f.kind;
}

type FilterOption = {
  filter: ActiveFilter;
  label: string;
  activeClass: string;
  section: 'status' | 'where' | 'type';
};

/** True when the entry overlaps a single calendar day. Null end_date = single day. */
function unavailabilityOverlapsDay(entry: EmployeeUnavailabilityEntry, day: string): boolean {
  const end = entry.end_date ?? entry.start_date;
  return entry.start_date <= day && end >= day;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showPhoto = isValidPhotoUrl(photoUrl) && !imgFailed;

  useEffect(() => {
    setImgFailed(false);
  }, [photoUrl]);

  if (showPhoto && photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="w-10 h-10 rounded-full object-cover ring-2 ring-base-200 shrink-0"
        onError={() => setImgFailed(true)}
      />
    );
  }

  const initials = getInitials(name);
  return (
    <span
      className={`w-10 h-10 rounded-full font-semibold inline-flex items-center justify-center ring-2 ring-base-200 shrink-0 text-base ${avatarColorClass(name)}`}
      aria-label={name}
    >
      {initials || <UserIcon className="w-5 h-5" />}
    </span>
  );
}

function UnavailabilityTime({ entry }: { entry: EmployeeUnavailabilityEntry }) {
  const timeLabel = unavailabilityTimeLabel(entry);
  return (
    <span className="text-sm font-medium text-base-content/70 tabular-nums whitespace-nowrap">
      {timeLabel}
    </span>
  );
}

function unavailabilityTimeLabel(entry: EmployeeUnavailabilityEntry): string {
  if (entry.unavailability_type === 'sick_days' || entry.unavailability_type === 'vacation') {
    return 'All day';
  }
  return unavailabilityGeneralTimeRange(entry) || '—';
}

function unavailabilityReasonOnly(entry: EmployeeUnavailabilityEntry): string {
  if (entry.unavailability_type === 'sick_days') {
    return entry.sick_days_reason?.trim() || '—';
  }
  if (entry.unavailability_type === 'vacation') {
    return entry.vacation_reason?.trim() || '—';
  }
  return entry.general_reason?.trim() || '—';
}

function UnavailabilityReason({ entry }: { entry: EmployeeUnavailabilityEntry }) {
  const reason = unavailabilityReasonOnly(entry);
  if (reason === '—') return <span className="text-base-content/35 text-base">—</span>;
  return (
    <span className="text-sm text-base-content/70 max-w-[260px] truncate block" title={reason}>
      {reason}
    </span>
  );
}

function EmployeeUnavailabilityBlock({ entries }: { entries: EmployeeUnavailabilityEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const entriesKey = entries.map((e) => e.id).join(',');

  useEffect(() => {
    setExpanded(false);
  }, [entriesKey]);

  const visible = expanded ? entries : entries.slice(0, 1);
  const hasMore = entries.length > 1;

  return (
    <div className="mt-2 pt-2 border-t border-base-200/80 flex flex-col gap-2">
      {visible.map((e, idx) => (
        <div key={e.id} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${unavailabilityTypeCompactLabelClass(e.unavailability_type)}`}
            >
              {unavailabilityTypeLabel(e.unavailability_type)}
            </span>
            <UnavailabilityTime entry={e} />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              <UnavailabilityReason entry={e} />
            </div>
            {hasMore && idx === 0 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-base-content/50 hover:text-base-content transition-colors"
                aria-expanded={expanded}
                title={expanded ? 'Show less' : `Show ${entries.length - 1} more`}
              >
                {!expanded && <span>{`+${entries.length - 1}`}</span>}
                <ChevronDownIcon
                  className={`w-5 h-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmployeeMobileCard({
  emp,
  onMessage,
}: {
  emp: EmployeeRow;
  onMessage: () => void;
}) {
  return (
    <article className="rounded-[18px] bg-white px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Avatar name={emp.display_name} photoUrl={emp.photo_url} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-base truncate">{emp.display_name}</div>
          {emp.department && (
            <div className="text-sm text-base-content/50 truncate">{emp.department}</div>
          )}
          <div className="mt-2">
            <ClockStatusCell clockIn={emp.clockIn} />
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <EmployeeEmailButton email={emp.email} />
          <EmployeeMessageButton chatUserId={emp.chatUserId} onMessage={onMessage} />
        </div>
      </div>
      {emp.clockIn && (
        <p className="mt-2 text-sm text-base-content/65">
          <span className="font-medium tabular-nums">{formatTime(emp.clockIn.clock_in_time)}</span>
          {emp.workplaceName && (
            <>
              <span className="text-base-content/35 mx-1">·</span>
              <span>{emp.workplaceName}</span>
            </>
          )}
        </p>
      )}
      {emp.unavailabilities.length > 0 && (
        <EmployeeUnavailabilityBlock entries={emp.unavailabilities} />
      )}
    </article>
  );
}

function EmployeeUnavailabilityCells({ entries }: { entries: EmployeeUnavailabilityEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const entriesKey = entries.map((e) => e.id).join(',');

  useEffect(() => {
    setExpanded(false);
  }, [entriesKey]);

  if (entries.length === 0) {
    return (
      <>
        <td className="px-5 py-4"><span className="text-base-content/35 text-base">—</span></td>
        <td className="px-5 py-4"><span className="text-base-content/35 text-base">—</span></td>
        <td className="px-5 py-4"><span className="text-base-content/35 text-base">—</span></td>
      </>
    );
  }

  const visible = expanded ? entries : entries.slice(0, 1);
  const hasMore = entries.length > 1;

  return (
    <>
      <td className="px-5 py-4 align-top">
        <div className="flex flex-col gap-1.5">
          {visible.map((e) => (
            <span
              key={e.id}
              className={`inline-flex items-center self-start rounded-full px-3 py-1 text-sm font-medium ${unavailabilityTypeCompactLabelClass(e.unavailability_type)}`}
            >
              {unavailabilityTypeLabel(e.unavailability_type)}
            </span>
          ))}
        </div>
      </td>
      <td className="px-5 py-4 align-top">
        <div className="flex flex-col gap-1.5">
          {visible.map((e) => (
            <UnavailabilityTime key={e.id} entry={e} />
          ))}
        </div>
      </td>
      <td className="px-5 py-4 align-top">
        <div className="flex flex-col gap-1.5">
          {visible.map((e, idx) => (
            <div key={e.id} className="flex items-center gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <UnavailabilityReason entry={e} />
              </div>
              {hasMore && idx === 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-base-content/50 hover:text-base-content transition-colors"
                  aria-expanded={expanded}
                  title={expanded ? 'Show less' : `Show ${entries.length - 1} more`}
                >
                  {!expanded && <span>{`+${entries.length - 1}`}</span>}
                  <ChevronDownIcon
                    className={`w-5 h-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
              )}
            </div>
          ))}
        </div>
      </td>
    </>
  );
}

function ClockStatusCell({ clockIn }: { clockIn: ClockInRow | null }) {
  if (!clockIn) {
    return (
      <span className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium bg-gray-100 text-gray-500">
        Clocked out
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium bg-green-100/90 text-green-800">
      Clocked in
    </span>
  );
}

function ClockedInAtCell({ clockIn }: { clockIn: ClockInRow | null }) {
  if (!clockIn) return <span className="text-base-content/35 text-base">—</span>;
  return (
    <span className="text-base font-medium tabular-nums text-base-content/80">
      {formatTime(clockIn.clock_in_time)}
    </span>
  );
}

function ClockedInFromCell({ workplaceName }: { workplaceName: string | null }) {
  if (!workplaceName || workplaceName === '—') {
    return <span className="text-base-content/35 text-base">—</span>;
  }
  return (
    <span className="text-base text-base-content/80 max-w-[180px] truncate" title={workplaceName}>
      {workplaceName}
    </span>
  );
}

function EmployeeMessageButton({
  chatUserId,
  onMessage,
}: {
  chatUserId: string | null;
  onMessage: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#4829CC]/25 bg-[#4829CC]/8 text-[#4829CC] hover:bg-[#4829CC]/14 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
      disabled={!chatUserId}
      title={chatUserId ? 'Open RMQ chat' : 'No RMQ account linked'}
      aria-label="Open RMQ chat"
      onClick={(e) => {
        e.stopPropagation();
        onMessage();
      }}
    >
      <ChatBubbleLeftRightIcon className="w-[18px] h-[18px]" aria-hidden />
    </button>
  );
}

function EmployeeEmailButton({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <a
      href={`mailto:${email}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-base-content/15 bg-base-200/60 text-base-content/50 hover:bg-base-200 hover:text-base-content transition-colors shrink-0"
      title={`Email ${email}`}
      aria-label={`Send email to ${email}`}
      onClick={(e) => e.stopPropagation()}
    >
      <EnvelopeIcon className="w-[18px] h-[18px]" aria-hidden />
    </a>
  );
}

// ─── Filter pill ──────────────────────────────────────────────────────────────

const PILL_BASE = 'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors border whitespace-nowrap';
const PILL_INACTIVE = 'bg-white text-base-content/55 border-base-200 hover:border-base-content/30 hover:text-base-content';

const TEAM_STATUS_TABLE_STYLES = `
  .team-status-table-shell table {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    border-collapse: separate !important;
    border-spacing: 0 10px !important;
  }

  .team-status-table-shell .table tbody tr:hover {
    background-color: transparent !important;
  }

  .team-status-table-shell table tbody tr {
    background: transparent !important;
    border-radius: 18px !important;
    overflow: hidden !important;
    box-shadow: none !important;
  }

  .team-status-table-shell table tbody td {
    border: none !important;
    border-bottom: none !important;
    background: #ffffff !important;
    box-shadow: none !important;
    vertical-align: middle;
  }

  .team-status-table-shell table tbody td:first-child {
    border-top-left-radius: 18px !important;
    border-bottom-left-radius: 18px !important;
    padding-left: 1.1rem !important;
  }

  .team-status-table-shell table tbody td:last-child {
    border-top-right-radius: 18px !important;
    border-bottom-right-radius: 18px !important;
    padding-right: 1.1rem !important;
  }

  .team-status-table-shell table tbody tr:hover td {
    background: #f1f5f9 !important;
  }

  .team-status-table-shell table thead,
  .team-status-table-shell table thead tr,
  .team-status-table-shell table thead th {
    background-color: transparent !important;
    background-image: none !important;
    border-bottom: none !important;
  }

  .team-status-table-shell table.team-status-results-table thead tr,
  .team-status-table-shell table.team-status-results-table thead th {
    background-color: #ececec !important;
  }
`;

function FilterPill({
  label,
  active,
  activeClass,
  onClick,
}: {
  label: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${PILL_BASE} ${active ? activeClass : PILL_INACTIVE}`}
    >
      {label}
    </button>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface TeamStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TeamStatusModal: React.FC<TeamStatusModalProps> = ({ isOpen, onClose }) => {
  const { isSuperUser } = useAdminRole();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>({ kind: 'all' });
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [rmqOpen, setRmqOpen] = useState(false);
  const [rmqChatUserId, setRmqChatUserId] = useState<string | null>(null);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const mobileToolsRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const showLiveClockIn = selectedDate === todayIso();

  const load = useCallback(async (day: string) => {
    setLoading(true);
    try {
      const empData = await fetchActiveStaffEmployeesWithDepartment();
      if (!empData.length) { setEmployees([]); return; }

      const ids = empData.map((e) => e.id);
      const liveClockIn = day === todayIso();

      const [clockResult, unavailResult, usersResult] = await Promise.all([
        liveClockIn
          ? supabase
              .from('employee_clock_in')
              .select('employee_id, clock_in_time, clock_in_location_id, clock_in_place:clock_in_locations!clock_in_location_id(name)')
              .in('employee_id', ids)
              .eq('is_active', true)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('employee_unavailability_reasons')
          .select('id, employee_id, unavailability_type, sick_days_reason, vacation_reason, general_reason, document_url, start_date, end_date, start_time, end_time, created_at')
          .in('employee_id', ids)
          .lte('start_date', day),
        supabase
          .from('users')
          .select('id, email, employee_id')
          .in('employee_id', ids),
      ]);

      if (clockResult.error) throw clockResult.error;
      if (unavailResult.error) throw unavailResult.error;
      if (usersResult.error) throw usersResult.error;

      const contactByEmployeeId = new Map<string, { email: string | null; chatUserId: string | null }>();
      for (const user of usersResult.data ?? []) {
        if (user.employee_id == null) continue;
        contactByEmployeeId.set(String(user.employee_id), {
          email: user.email ?? null,
          chatUserId: user.id,
        });
      }

      const clockMap = new Map<string, ClockInRow>();
      for (const row of clockResult.data ?? []) {
        const key = String(row.employee_id);
        const existing = clockMap.get(key);
        if (!existing || row.clock_in_time > existing.clock_in_time) {
          clockMap.set(key, {
            clock_in_time: row.clock_in_time,
            clock_in_place: row.clock_in_place as any,
            clock_in_location_id: row.clock_in_location_id,
          });
        }
      }

      const unavailMap = new Map<string, EmployeeUnavailabilityEntry[]>();
      for (const row of unavailResult.data ?? []) {
        const entry = row as EmployeeUnavailabilityEntry;
        if (!unavailabilityOverlapsDay(entry, day)) continue;
        const key = String(row.employee_id);
        const list = unavailMap.get(key) ?? [];
        list.push(entry);
        unavailMap.set(key, list);
      }

      setEmployees(
        empData.map((e) => {
          const key = String(e.id);
          const clockIn = clockMap.get(key) ?? null;
          const workplaceName = clockIn
            ? resolveWorkplaceName(
                { clock_in_location_id: clockIn.clock_in_location_id ?? null, clock_in_place: clockIn.clock_in_place } as any,
                'in',
              )
            : null;
          const contact = contactByEmployeeId.get(key);
          return {
            id: e.id,
            display_name: e.display_name,
            photo_url: e.photo_url ?? null,
            department: e.departmentName ?? null,
            email: contact?.email ?? null,
            chatUserId: contact?.chatUserId ?? null,
            clockIn,
            workplaceName: workplaceName && workplaceName !== '—' ? workplaceName : null,
            unavailabilities: unavailMap.get(key) ?? [],
          };
        }),
      );
    } catch (err) {
      console.error('TeamStatusModal load:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const today = todayIso();
    setSearch('');
    setActiveFilter({ kind: 'all' });
    setSelectedDate(today);
    setMobileToolsOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!mobileToolsOpen) return;
    const id = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [mobileToolsOpen]);

  useEffect(() => {
    if (!mobileToolsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!mobileToolsRef.current?.contains(e.target as Node)) {
        setMobileToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [mobileToolsOpen]);

  useEffect(() => {
    if (isOpen && !isSuperUser) {
      onClose();
    }
  }, [isOpen, isSuperUser, onClose]);

  useEffect(() => {
    if (!isOpen || !isSuperUser) return;
    void load(selectedDate);
  }, [isOpen, isSuperUser, selectedDate, load]);

  // Derive unique workplace names from clocked-in employees
  const workplaces = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const e of employees) {
      if (e.workplaceName && !seen.has(e.workplaceName)) {
        seen.add(e.workplaceName);
        list.push(e.workplaceName);
      }
    }
    return list.sort();
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (q && !e.display_name.toLowerCase().includes(q) && !(e.department ?? '').toLowerCase().includes(q)) return false;
      return filterMatches(e, activeFilter);
    });
  }, [employees, search, activeFilter]);

  // Counts for badge labels
  const clockedInCount = useMemo(() => employees.filter((e) => e.clockIn).length, [employees]);
  const clockedOutCount = employees.length - clockedInCount;
  const unavailableCount = useMemo(() => employees.filter((e) => e.unavailabilities.length > 0).length, [employees]);
  const availableCount = employees.length - unavailableCount;
  const notClockedInAvailableCount = useMemo(
    () => employees.filter((e) => e.unavailabilities.length === 0 && !e.clockIn).length,
    [employees],
  );

  const filterOptions = useMemo((): FilterOption[] => {
    const options: FilterOption[] = [
      { filter: { kind: 'clocked_in' }, label: `Clocked in (${clockedInCount})`, activeClass: 'bg-green-700 text-white border-green-800', section: 'status' },
      { filter: { kind: 'clocked_out' }, label: `Clocked out (${clockedOutCount})`, activeClass: 'bg-gray-600 text-white border-gray-700', section: 'status' },
      { filter: { kind: 'unavailable' }, label: `Unavailable (${unavailableCount})`, activeClass: 'bg-red-600 text-white border-red-700', section: 'status' },
      { filter: { kind: 'available' }, label: `Available (${availableCount})`, activeClass: 'bg-emerald-600 text-white border-emerald-700', section: 'status' },
    ];

    if (showLiveClockIn) {
      options.push({
        filter: { kind: 'not_clocked_in_available' },
        label: `Not clocked in (${notClockedInAvailableCount})`,
        activeClass: 'bg-primary text-white border-primary',
        section: 'status',
      });
    }

    for (const wp of workplaces) {
      const wpCount = employees.filter((e) => filterMatches(e, { kind: 'workplace', name: wp })).length;
      options.push({
        filter: { kind: 'workplace', name: wp },
        label: `${wp} (${wpCount})`,
        activeClass: 'bg-[rgb(25,49,31)] text-white border-[rgb(25,49,31)]',
        section: 'where',
      });
    }

    for (const { type, label, activeClass } of [
      { type: 'sick_days' as UnavailabilityType, label: 'Sick days', activeClass: 'bg-orange-500 text-white border-orange-600' },
      { type: 'vacation' as UnavailabilityType, label: 'Vacation', activeClass: 'bg-emerald-600 text-white border-emerald-700' },
      { type: 'general' as UnavailabilityType, label: 'General', activeClass: 'bg-slate-600 text-white border-slate-700' },
    ]) {
      const count = employees.filter((e) => filterMatches(e, { kind: 'unavail_type', type })).length;
      if (count === 0) continue;
      options.push({
        filter: { kind: 'unavail_type', type },
        label: `${label} (${count})`,
        activeClass,
        section: 'type',
      });
    }

    return options;
  }, [
    clockedInCount,
    clockedOutCount,
    unavailableCount,
    availableCount,
    notClockedInAvailableCount,
    showLiveClockIn,
    workplaces,
    employees,
  ]);

  const [jerusalemNow, setJerusalemNow] = useState(() => new Date());
  useEffect(() => {
    if (!isOpen) return;
    const tick = () => setJerusalemNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isOpen]);

  const jerusalemTime = useMemo(
    () => jerusalemNow.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    [jerusalemNow],
  );

  function toggleFilter(f: ActiveFilter) {
    setActiveFilter((prev) => filterKey(prev) === filterKey(f) ? { kind: 'all' } : f);
  }

  function openEmployeeChat(emp: EmployeeRow) {
    if (!emp.chatUserId) {
      toast.error('No RMQ account linked for this employee');
      return;
    }
    setRmqChatUserId(emp.chatUserId);
    setRmqOpen(true);
  }

  if (!isOpen || !isSuperUser || typeof window === 'undefined') return null;

  const curKey = filterKey(activeFilter);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-base-100" role="dialog" aria-modal="true">
      {/* Header */}
      <div className="shrink-0 bg-base-100 px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg flex items-center justify-center shrink-0">
              <UserGroupIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold leading-tight">Team Status</h2>
              <p className="text-xs sm:text-sm text-base-content/55 mt-0.5 sm:hidden">
                {formatDate(selectedDate)}
              </p>
              <p className="hidden sm:block text-sm text-base-content/55 mt-0.5">
                {formatDate(selectedDate)} · {employees.length} employees · {clockedInCount} clocked in · {unavailableCount} unavailable
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {showLiveClockIn && (
              <button
                type="button"
                onClick={() => toggleFilter({ kind: 'not_clocked_in_available' })}
                className={`text-right rounded-lg transition-colors px-1 ${
                  curKey === 'not_clocked_in_available'
                    ? 'text-primary'
                    : 'text-base-content hover:text-primary'
                }`}
                title="Show available employees not clocked in"
                aria-pressed={curKey === 'not_clocked_in_available'}
              >
                <p className="text-[10px] sm:text-xs text-base-content/45 leading-none">Not clocked in</p>
                <p className="text-sm sm:text-lg font-semibold tabular-nums leading-tight">
                  {notClockedInAvailableCount}
                  <span className="text-[10px] sm:text-xs font-normal text-base-content/50 ml-0.5 sm:ml-1">avail.</span>
                </p>
              </button>
            )}
            <div className="rounded-xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 px-2.5 py-1.5 sm:px-3 sm:py-2 text-white shadow-md">
              <div className="flex items-center justify-end gap-1 text-[8px] sm:text-[9px] font-semibold uppercase tracking-wider text-white/70">
                <ClockIcon className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" aria-hidden />
                Tel Aviv
              </div>
              <p className="text-sm sm:text-lg font-bold font-mono tabular-nums tracking-wide leading-tight mt-0.5 text-right">
                {jerusalemTime}
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm btn-circle shrink-0" onClick={onClose}>
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <p className="mt-2 text-xs text-base-content/55 sm:hidden">
          {employees.length} employees · {clockedInCount} in · {unavailableCount} unavailable
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 border-b border-base-200 bg-base-200/20 shrink-0" ref={mobileToolsRef}>
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-start md:gap-12 w-full">
          <div className="relative hidden md:block w-64 max-w-full shrink-0">
            <MagnifyingGlassIcon
              className="w-5 h-5 text-base-content/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10"
              aria-hidden
            />
            <input
              type="search"
              className="input input-bordered input-sm h-9 w-full rounded-full pl-10 pr-4 bg-white"
              placeholder="Search employee…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <button
              type="button"
              onClick={() => setSelectedDate((d) => shiftIsoDate(d, -1))}
              className="btn btn-sm btn-ghost btn-circle shrink-0"
              title="Previous day"
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
            <CalendarIcon className="w-5 h-5 text-base-content/40 shrink-0" aria-hidden />
            <input
              type="date"
              className="input input-bordered input-sm h-9 bg-white flex-1 min-w-0 sm:flex-none"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              title="Select date"
            />
            <button
              type="button"
              onClick={() => setSelectedDate((d) => shiftIsoDate(d, 1))}
              className="btn btn-sm btn-ghost btn-circle shrink-0"
              title="Next day"
            >
              <ChevronRightIcon className="w-5 h-5" />
            </button>
            <button
              type="button"
              className={`md:hidden btn btn-sm btn-outline btn-circle h-9 w-9 shrink-0 bg-white ${
                mobileToolsOpen || curKey !== 'all' || search.trim()
                  ? 'border-primary text-primary'
                  : ''
              }`}
              onClick={() => setMobileToolsOpen((v) => !v)}
              aria-label="Search and filter"
              aria-expanded={mobileToolsOpen}
            >
              <FunnelIcon className="w-5 h-5" aria-hidden />
            </button>
          </div>
          <div className="hidden md:flex items-center gap-4 ml-auto shrink-0">
            {curKey !== 'all' && (
              <button
                type="button"
                onClick={() => setActiveFilter({ kind: 'all' })}
                className="text-sm text-base-content/45 hover:text-base-content underline-offset-2 hover:underline"
              >
                Clear filter
              </button>
            )}
            {!showLiveClockIn && (
              <span className="text-xs text-base-content/45 whitespace-nowrap">Clock-in status shown only for today</span>
            )}
          </div>
          {!showLiveClockIn && (
            <span className="text-xs text-base-content/45 text-center md:hidden">Clock-in status shown only for today</span>
          )}
        </div>

        {mobileToolsOpen && (
          <div className="md:hidden rounded-2xl border border-base-200 bg-white p-3 shadow-sm flex flex-col gap-3">
            <div className="relative">
              <MagnifyingGlassIcon
                className="w-5 h-5 text-base-content/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10"
                aria-hidden
              />
              <input
                ref={searchInputRef}
                type="search"
                className="input input-bordered input-sm h-10 w-full rounded-full pl-10 pr-4 bg-white"
                placeholder="Search employee…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="max-h-56 overflow-y-auto overscroll-y-contain -mx-1 px-1">
              <button
                type="button"
                className={`w-full px-3 py-2.5 text-left text-sm rounded-xl hover:bg-base-200/70 transition-colors ${
                  curKey === 'all' ? 'font-semibold text-primary bg-primary/5' : ''
                }`}
                onClick={() => setActiveFilter({ kind: 'all' })}
              >
                All employees
              </button>
              {(['status', 'where', 'type'] as const).map((section) => {
                const sectionOptions = filterOptions.filter((o) => o.section === section);
                if (sectionOptions.length === 0) return null;
                const sectionLabel = section === 'status' ? 'Status' : section === 'where' ? 'Where' : 'Type';
                return (
                  <div key={section} className="mt-1">
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-base-content/40">
                      {sectionLabel}
                    </div>
                    {sectionOptions.map((opt) => (
                      <button
                        key={filterKey(opt.filter)}
                        type="button"
                        className={`w-full px-3 py-2.5 text-left text-sm rounded-xl hover:bg-base-200/70 transition-colors ${
                          curKey === filterKey(opt.filter) ? 'font-semibold text-primary bg-primary/5' : ''
                        }`}
                        onClick={() => toggleFilter(opt.filter)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            {curKey !== 'all' && (
              <button
                type="button"
                onClick={() => setActiveFilter({ kind: 'all' })}
                className="text-sm text-base-content/45 hover:text-base-content underline-offset-2 hover:underline self-start"
              >
                Clear filter
              </button>
            )}
          </div>
        )}

        {/* Desktop filter pills */}
        <div className="hidden md:flex flex-wrap gap-x-4 gap-y-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-base-content/40 font-medium uppercase tracking-wide mr-0.5">Status</span>
            {filterOptions.filter((o) => o.section === 'status' && o.filter.kind !== 'not_clocked_in_available').map((opt) => (
              <FilterPill
                key={filterKey(opt.filter)}
                label={opt.label}
                active={curKey === filterKey(opt.filter)}
                activeClass={opt.activeClass}
                onClick={() => toggleFilter(opt.filter)}
              />
            ))}
          </div>

          {workplaces.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-base-content/40 font-medium uppercase tracking-wide mr-0.5">Where</span>
              {filterOptions.filter((o) => o.section === 'where').map((opt) => (
                <FilterPill
                  key={filterKey(opt.filter)}
                  label={opt.label}
                  active={curKey === filterKey(opt.filter)}
                  activeClass={opt.activeClass}
                  onClick={() => toggleFilter(opt.filter)}
                />
              ))}
            </div>
          )}

          {filterOptions.some((o) => o.section === 'type') && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-base-content/40 font-medium uppercase tracking-wide mr-0.5">Type</span>
              {filterOptions.filter((o) => o.section === 'type').map((opt) => (
                <FilterPill
                  key={filterKey(opt.filter)}
                  label={opt.label}
                  active={curKey === filterKey(opt.filter)}
                  activeClass={opt.activeClass}
                  onClick={() => toggleFilter(opt.filter)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y bg-[#ececec] px-4 md:px-5 py-4">
        {loading ? (
          <div className="flex justify-center py-20">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-base-content/45">No employees match your filter.</div>
        ) : (
          <>
            <div className="md:hidden flex flex-col gap-2.5 pb-1">
              {filtered.map((emp) => (
                <EmployeeMobileCard
                  key={emp.id}
                  emp={emp}
                  onMessage={() => openEmployeeChat(emp)}
                />
              ))}
            </div>
            <div className="hidden md:block team-status-table-shell pb-1 overflow-x-auto">
              <table className="table team-status-results-table w-full min-w-[80rem] text-base">
              <thead>
                <tr>
                  <th className="px-5 py-3.5 text-left text-sm font-semibold uppercase tracking-wider text-base-content/40 w-60">
                    Employee
                  </th>
                  <th className="px-5 py-3.5 text-left text-sm font-semibold uppercase tracking-wider text-base-content/40 w-36">
                    Clock-in status
                  </th>
                  <th className="px-5 py-3.5 text-left text-sm font-semibold uppercase tracking-wider text-base-content/40 w-28">
                    Clocked in at
                  </th>
                  <th className="px-5 py-3.5 text-left text-sm font-semibold uppercase tracking-wider text-base-content/40 w-40">
                    Clocked in from
                  </th>
                  <th className="px-5 py-3.5 text-left text-sm font-semibold uppercase tracking-wider text-base-content/40 w-36">
                    Unavailability type
                  </th>
                  <th className="px-5 py-3.5 text-left text-sm font-semibold uppercase tracking-wider text-base-content/40 w-44">
                    Unavailable time
                  </th>
                  <th className="px-5 py-3.5 text-left text-sm font-semibold uppercase tracking-wider text-base-content/40">
                    Unavailability
                  </th>
                  <th className="w-24 px-3 py-3.5 text-right text-sm font-semibold uppercase tracking-wider text-base-content/40">
                    <span className="sr-only">Contact</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => (
                  <tr key={emp.id}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={emp.display_name} photoUrl={emp.photo_url} />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-base truncate">{emp.display_name}</div>
                          {emp.department && (
                            <div className="text-sm text-base-content/50 truncate">{emp.department}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <ClockStatusCell clockIn={emp.clockIn} />
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <ClockedInAtCell clockIn={emp.clockIn} />
                    </td>
                    <td className="px-5 py-4">
                      <ClockedInFromCell workplaceName={emp.workplaceName} />
                    </td>
                    <EmployeeUnavailabilityCells entries={emp.unavailabilities} />
                    <td className="px-3 py-4 align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        <EmployeeEmailButton email={emp.email} />
                        <EmployeeMessageButton
                          chatUserId={emp.chatUserId}
                          onMessage={() => openEmployeeChat(emp)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <style>{TEAM_STATUS_TABLE_STYLES}</style>
      <RMQMessagesPage
        isOpen={rmqOpen}
        initialUserId={rmqChatUserId || undefined}
        onClose={() => {
          setRmqOpen(false);
          setRmqChatUserId(null);
        }}
      />
    </div>,
    document.body,
  );
};

export default TeamStatusModal;
