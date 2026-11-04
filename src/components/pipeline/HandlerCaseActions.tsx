import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  PlusIcon,
  ArrowUturnLeftIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { sentToFinanceStamp } from '../../lib/sentToFinanceStamp';
import { getUSTimezoneFromPhone } from '../../lib/timezoneHelpers';
import {
  fetchActiveStaffEmployees,
  type ActiveStaffEmployee,
} from '../../lib/employeeSalaries';
import {
  prefetchEmployeePhotos,
  resolveEmployeePhotoUrl,
  toEmployeeAvatarSrc,
} from '../../lib/employeePhotoUrl';
import RMQMessagesPage from '../../pages/RMQMessagesPage';
import { handlerDbId, type HandlerPipelineRow } from './handlerTypes';
import type { ActiveHandlerType } from '../../lib/handlerCaseBuckets';

type HandlingRoleKey = 'handler' | 'retention' | 'support';

type HandlingRoleOption = {
  type: ActiveHandlerType;
  key: HandlingRoleKey;
  rolesLabel: string;
  id: number | null;
  display: string | null;
  photoUrl: string | null;
};

const CLIENT_SUPPORT_SUGGESTED_NAME = 'Lior';

function roleOptionsFromRow(row: HandlerPipelineRow): {
  assigned: HandlingRoleOption[];
  missing: HandlingRoleOption[];
} {
  const all: HandlingRoleOption[] = [
    {
      type: 2,
      key: 'handler',
      rolesLabel: 'Handler',
      id: row.caseHandlerId ?? null,
      display: row.handlerName ?? null,
      photoUrl: row.handlerPhotoUrl ?? null,
    },
    {
      type: 1,
      key: 'retention',
      rolesLabel: 'R-Handler',
      id: row.retainerHandlerId ?? null,
      display: row.retentionHandlerName ?? null,
      photoUrl: row.retentionPhotoUrl ?? null,
    },
    {
      type: 3,
      key: 'support',
      rolesLabel: 'Client Support',
      id: row.clientSupportId ?? null,
      display: row.clientSupportName ?? null,
      photoUrl: row.clientSupportPhotoUrl ?? null,
    },
  ];
  const assigned = all.filter((o) => o.id != null || (o.display && o.display.trim() && o.display !== '---'));
  const missing = all.filter((o) => !assigned.some((a) => a.key === o.key));
  return { assigned, missing };
}

function RoleAvatar({
  photoUrl,
  name,
  sizeClass = 'h-12 w-12',
  sizePx = 96,
}: {
  photoUrl: string | null;
  name: string | null;
  sizeClass?: string;
  sizePx?: number;
}) {
  const original = photoUrl?.trim() || null;
  const sized = toEmployeeAvatarSrc(original, sizePx);
  const [src, setSrc] = useState<string | null>(sized || original);
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setSrc(sized || original);
    setErrored(false);
  }, [sized, original]);
  const initials = (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
  if (src && !errored) {
    return (
      <img
        src={src}
        alt=""
        decoding="async"
        loading="eager"
        className={`${sizeClass} shrink-0 rounded-full object-cover bg-gray-200`}
        onError={() => {
          if (src !== original && original) {
            setSrc(original);
            return;
          }
          setErrored(true);
        }}
      />
    );
  }
  return (
    <span
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600`}
    >
      {initials || '—'}
    </span>
  );
}

/** Active / Not-active control: menu mirrors ClientHeader (avatar, name, add role). */
const ActiveHandlerTypeControl: React.FC<{
  row: HandlerPipelineRow;
  pipelineRole: ActiveHandlerType;
  onSetActiveType: (row: HandlerPipelineRow, nextType: ActiveHandlerType, e: React.MouseEvent) => void;
  onAssigned?: () => void | Promise<void>;
}> = ({ row, pipelineRole, onSetActiveType, onAssigned }) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [assignKey, setAssignKey] = useState<HandlingRoleKey | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [employees, setEmployees] = useState<ActiveStaffEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isMine = Number(row.active_handler_type) === pipelineRole;
  const showDeactivate = isMine && row.bucket === 'active';
  const showActivate = row.bucket === 'non_active';

  const { assigned, missing } = useMemo(() => roleOptionsFromRow(row), [row]);
  const makeActiveOptions = useMemo(() => {
    const list = showDeactivate
      ? assigned.filter((o) => o.type !== pipelineRole)
      : assigned;
    return list;
  }, [assigned, showDeactivate, pipelineRole]);

  const closeMenu = () => {
    setOpen(false);
    setAssignKey(null);
    setAssignSearch('');
  };

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const btn = buttonRef.current;
      const menu = menuRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuWidth = menu?.offsetWidth || 288;
      const menuHeight = menu?.offsetHeight || 220;
      const gap = 6;
      let left = rect.right - menuWidth;
      left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const openUp = spaceBelow < menuHeight && rect.top > spaceBelow;
      const top = openUp
        ? Math.max(8, rect.top - menuHeight - gap)
        : Math.min(rect.bottom + gap, window.innerHeight - menuHeight - 8);
      setMenuPos({ top, left });
    };
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, assignKey, makeActiveOptions.length, missing.length, employees.length, assignSearch]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      closeMenu();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    prefetchEmployeePhotos([
      row.handlerPhotoUrl,
      row.retentionPhotoUrl,
      row.clientSupportPhotoUrl,
    ]);
  }, [open, row.handlerPhotoUrl, row.retentionPhotoUrl, row.clientSupportPhotoUrl]);

  useEffect(() => {
    if (!open || !assignKey) return;
    let cancelled = false;
    setEmployeesLoading(employees.length === 0);
    void fetchActiveStaffEmployees()
      .then((list) => {
        if (cancelled) return;
        setEmployees(list);
        prefetchEmployeePhotos(list.slice(0, 40).map((e) => e.photo_url), 64);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setEmployees([]);
      })
      .finally(() => {
        if (!cancelled) setEmployeesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, assignKey, employees.length]);

  if (!showActivate && !showDeactivate) return null;

  const assignRoleLabel =
    assignKey === 'handler'
      ? 'Handler'
      : assignKey === 'retention'
        ? 'R-Handler'
        : assignKey === 'support'
          ? 'Client Support'
          : '';

  const suggested = CLIENT_SUPPORT_SUGGESTED_NAME.toLowerCase();
  const isSuggestedSupport = (emp: ActiveStaffEmployee) => {
    const name = emp.display_name.trim().toLowerCase();
    return name === suggested || name.startsWith(`${suggested} `) || name.includes(` ${suggested}`);
  };
  const assignSearchTerm = assignSearch.trim().toLowerCase();
  const assignEmployeeOptions = employees
    .filter((emp) => {
      if (!assignSearchTerm) return true;
      return emp.display_name.toLowerCase().includes(assignSearchTerm);
    })
    .sort((a, b) => {
      if (assignKey !== 'support') return a.display_name.localeCompare(b.display_name);
      const aS = isSuggestedSupport(a) ? 0 : 1;
      const bS = isSuggestedSupport(b) ? 0 : 1;
      if (aS !== bS) return aS - bS;
      return a.display_name.localeCompare(b.display_name);
    })
    .slice(0, 40);

  const assignEmployee = async (emp: ActiveStaffEmployee) => {
    if (!assignKey || assignSaving) return;
    setAssignSaving(true);
    try {
      await assignPipelineHandlingRole(row, assignKey, emp);
      closeMenu();
      await onAssigned?.();
    } catch (err) {
      console.error(err);
      throw err;
    } finally {
      setAssignSaving(false);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => {
            if (v) {
              setAssignKey(null);
              setAssignSearch('');
              return false;
            }
            return true;
          });
        }}
        className={
          showDeactivate
            ? 'btn btn-circle btn-md border-none bg-rose-500 text-white hover:bg-rose-600'
            : 'btn btn-circle btn-md border-none bg-emerald-500 text-white hover:bg-emerald-600'
        }
        title={showDeactivate ? 'Transfer active role' : 'Set active role'}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {showDeactivate ? <XCircleIcon className="h-6 w-6" /> : <CheckCircleIcon className="h-6 w-6" />}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-[9999] min-w-[18rem] overflow-hidden rounded-2xl border border-black/[0.06] bg-white py-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.14)] dark:border-white/10 dark:bg-base-200"
              role="menu"
              style={{
                top: menuPos?.top ?? -9999,
                left: menuPos?.left ?? -9999,
                visibility: menuPos ? 'visible' : 'hidden',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {assignKey ? (
                <>
                  <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-1">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-circle"
                      aria-label="Back"
                      onClick={() => {
                        setAssignKey(null);
                        setAssignSearch('');
                      }}
                    >
                      <ArrowLeftIcon className="h-4 w-4" />
                    </button>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-base-content/40">
                      Assign {assignRoleLabel}
                    </p>
                  </div>
                  <div className="relative px-2.5 pb-2">
                    <MagnifyingGlassIcon
                      className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/35"
                      aria-hidden
                    />
                    <input
                      type="text"
                      value={assignSearch}
                      onChange={(e) => setAssignSearch(e.target.value)}
                      placeholder="Search employee…"
                      className="input input-sm w-full rounded-lg border-base-200 bg-base-100 pl-8"
                      autoFocus
                      disabled={assignSaving}
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {employeesLoading ? (
                      <p className="px-3.5 py-2.5 text-sm text-base-content/50">Loading…</p>
                    ) : assignEmployeeOptions.length > 0 ? (
                      assignEmployeeOptions.map((emp) => (
                        <button
                          key={emp.id}
                          type="button"
                          role="menuitem"
                          disabled={assignSaving}
                          className="group mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-base-200/70"
                          onClick={() => {
                            void assignEmployee(emp).catch((err) => {
                              toast.error(err instanceof Error ? err.message : 'Failed to assign role');
                            });
                          }}
                        >
                          <RoleAvatar photoUrl={emp.photo_url} name={emp.display_name} sizeClass="h-8 w-8" sizePx={64} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{emp.display_name}</span>
                          <ChevronRightIcon
                            className="h-4 w-4 shrink-0 text-base-content/25 transition-transform duration-150 group-hover:scale-125 group-hover:text-base-content/50"
                            aria-hidden
                          />
                        </button>
                      ))
                    ) : (
                      <p className="px-3.5 py-2.5 text-sm text-base-content/50">No matches</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {makeActiveOptions.length > 0 ? (
                    <>
                      <p className="px-3.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-base-content/40">
                        {showDeactivate ? 'Transfer to' : 'Make active'}
                      </p>
                      {makeActiveOptions.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          role="menuitem"
                          className="group mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-base-200/70"
                          onClick={(e) => {
                            closeMenu();
                            onSetActiveType(row, opt.type, e);
                          }}
                        >
                          <RoleAvatar photoUrl={opt.photoUrl} name={opt.display} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-base-content/45">
                              {opt.rolesLabel}
                            </span>
                            <span className="block truncate text-sm font-semibold text-base-content/85">
                              {opt.display || '—'}
                            </span>
                          </span>
                          <ChevronRightIcon
                            className="h-4 w-4 shrink-0 text-base-content/30 transition-transform duration-150 group-hover:scale-125 group-hover:text-base-content/55"
                            aria-hidden
                          />
                        </button>
                      ))}
                    </>
                  ) : null}
                  {missing.length > 0 ? (
                    <>
                      <p
                        className={`px-3.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-base-content/40 ${
                          makeActiveOptions.length > 0 ? 'mt-1.5 border-t border-base-200 pt-2' : 'pt-1.5'
                        }`}
                      >
                        Add role
                      </p>
                      {missing.map((opt) => (
                        <button
                          key={`missing-${opt.key}`}
                          type="button"
                          role="menuitem"
                          className="group mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-base-200/70"
                          title={`Add ${opt.rolesLabel}`}
                          aria-label={`Add ${opt.rolesLabel}`}
                          onClick={() => {
                            setAssignKey(opt.key);
                            setAssignSearch('');
                          }}
                        >
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-base-300 bg-base-100 text-base-content/40">
                            <PlusIcon className="h-5 w-5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-base-content/45">
                              {opt.rolesLabel}
                            </span>
                            <span className="block truncate text-sm font-medium text-base-content/55">
                              Not assigned
                            </span>
                          </span>
                          <ChevronRightIcon
                            className="h-4 w-4 shrink-0 text-base-content/25 transition-transform duration-150 group-hover:scale-125 group-hover:text-base-content/50"
                            aria-hidden
                          />
                        </button>
                      ))}
                    </>
                  ) : null}
                  {makeActiveOptions.length === 0 && missing.length === 0 ? (
                    <p className="px-3.5 py-2.5 text-sm text-base-content/50">No roles available</p>
                  ) : null}
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

type CountryRef = { id: number; name: string; timezone?: string | null };

export function resolveHandlerTimezone(
  row: Pick<HandlerPipelineRow, 'country_id' | 'country' | 'timezone' | 'phone' | 'mobile'>,
  countries: CountryRef[] = [],
): string | null {
  const byId = row.country_id != null
    ? countries.find((c) => Number(c.id) === Number(row.country_id))
    : undefined;
  const byName = row.country
    ? countries.find((c) => c.name.toLowerCase().trim() === row.country!.toLowerCase().trim())
    : undefined;
  const country = byId || byName;
  const countryId = country?.id ?? row.country_id;
  if (Number(countryId) === 249) {
    return getUSTimezoneFromPhone(row.phone, row.mobile) || 'America/New_York';
  }
  return country?.timezone || row.timezone || null;
}

export function getBusinessHoursInfo(timezone: string | null): {
  isBusinessHours: boolean;
  localTime: string | null;
} {
  if (!timezone) return { isBusinessHours: false, localTime: null };
  try {
    const now = new Date();
    const formattedTime = now.toLocaleString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const hourParts = hourFormatter.formatToParts(now);
    const hour = parseInt(hourParts.find((part) => part.type === 'hour')?.value || '0', 10);
    return { isBusinessHours: hour >= 8 && hour < 20, localTime: formattedTime };
  } catch {
    return { isBusinessHours: false, localTime: null };
  }
}

export const HandlerCountryHoursDot: React.FC<{
  row: HandlerPipelineRow;
  countries?: CountryRef[];
}> = ({ row, countries = [] }) => {
  if (!row.country) {
    return <span className="text-gray-400">—</span>;
  }
  const timezone = resolveHandlerTimezone(row, countries);
  const businessInfo = getBusinessHoursInfo(timezone);
  return (
    <div className="flex items-center gap-2">
      <span>{row.country}</span>
      {timezone ? (
        <div
          className={`h-3 w-3 shrink-0 rounded-full ${businessInfo.isBusinessHours ? 'bg-green-500' : 'bg-red-500'}`}
          title={`${businessInfo.localTime ? `Local time: ${businessInfo.localTime}` : 'Time unavailable'} - ${businessInfo.isBusinessHours ? 'Business hours' : 'Outside business hours'} (${timezone})`}
        />
      ) : (
        <div className="h-3 w-3 shrink-0 rounded-full bg-gray-300" title="No timezone data available" />
      )}
    </div>
  );
};

type ActionHandlers = {
  onReload: () => void | Promise<void>;
  onOpenRmq: (row: HandlerPipelineRow) => void;
  onToggleRetention: (row: HandlerPipelineRow, nextType: ActiveHandlerType, e: React.MouseEvent) => void;
  onMarkReadyToPay: (row: HandlerPipelineRow, e: React.MouseEvent) => void;
  onEmailAction: (row: HandlerPipelineRow, e: React.MouseEvent) => void;
};

export const HandlerActionsColumn: React.FC<{
  row: HandlerPipelineRow;
  handlers: ActionHandlers;
  /** Which role this pipeline represents (2 handler, 1 retention, 3 client support). */
  pipelineRole?: ActiveHandlerType;
}> = ({ row, handlers, pipelineRole = 2 }) => (
  <div className="flex items-center justify-end gap-1.5">
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handlers.onEmailAction(row, e);
      }}
      className={
        row.emailFlag5
          ? 'btn btn-circle btn-md border-none bg-blue-600 text-white hover:bg-blue-700'
          : 'btn btn-circle btn-md border border-gray-300 bg-white text-gray-400 hover:border-gray-400 hover:text-gray-600'
      }
      title={
        row.emailFlag5
          ? 'Open flagged email in Interactions'
          : 'Send email'
      }
    >
      <EnvelopeIcon className="h-6 w-6" />
    </button>
    {!row.hasPaymentPlan && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlers.onOpenRmq(row);
        }}
        className="btn btn-circle btn-md border-none bg-orange-500 text-white hover:bg-orange-600 animate-pulse"
        title="Missing Payment Plan - Click to message closer"
      >
        <ExclamationTriangleIcon className="h-6 w-6" />
      </button>
    )}
    <ActiveHandlerTypeControl
      row={row}
      pipelineRole={pipelineRole}
      onSetActiveType={handlers.onToggleRetention}
      onAssigned={() => void handlers.onReload()}
    />
    {!row.isFirstPaymentPaid && row.hasUnpaidPayment && !row.hasReadyToPay && row.hasPaymentPlan && (
      <button
        type="button"
        onClick={(e) => handlers.onMarkReadyToPay(row, e)}
        className="btn btn-circle btn-md btn-warning animate-pulse"
        title="Mark as Ready to Pay"
      >
        <PaperAirplaneIcon className="h-6 w-6" />
      </button>
    )}
  </div>
);

type RetentionActionHandlers = {
  onReload?: () => void | Promise<void>;
  onOpenRmq: (row: HandlerPipelineRow) => void;
  onStartCase: (row: HandlerPipelineRow, e: React.MouseEvent) => void;
  onReverseStart: (row: HandlerPipelineRow, e: React.MouseEvent) => void;
  onToggleHandler: (row: HandlerPipelineRow, nextType: ActiveHandlerType, e: React.MouseEvent) => void;
  onMarkReadyToPay: (row: HandlerPipelineRow, e: React.MouseEvent) => void;
};

export const RetentionActionsColumn: React.FC<{
  row: HandlerPipelineRow;
  handlers: RetentionActionHandlers;
}> = ({ row, handlers }) => (
  <div className="flex items-center justify-end gap-1.5">
    {!row.hasPaymentPlan && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlers.onOpenRmq(row);
        }}
        className="btn btn-circle btn-md border-none bg-orange-500 text-white hover:bg-orange-600 animate-pulse"
        title="Missing Payment Plan - Click to message closer"
      >
        <ExclamationTriangleIcon className="h-6 w-6" />
      </button>
    )}
    {row.bucket === 'new' && !row.retentionHandlerStarted && (
      <button
        type="button"
        onClick={(e) => handlers.onStartCase(row, e)}
        className="btn btn-circle btn-md border-none bg-emerald-500 text-white hover:bg-emerald-600"
        title="Start Retention Case"
      >
        <ArrowUturnLeftIcon className="h-6 w-6" />
      </button>
    )}
    {row.bucket === 'active' && row.retentionHandlerStarted && (
      <button
        type="button"
        onClick={(e) => handlers.onReverseStart(row, e)}
        className="btn btn-circle btn-md border-none bg-amber-500 text-white hover:bg-amber-600"
        title="Reverse Retention Start Case"
      >
        <ArrowUturnLeftIcon className="h-6 w-6" />
      </button>
    )}
    <ActiveHandlerTypeControl
      row={row}
      pipelineRole={1}
      onSetActiveType={handlers.onToggleHandler}
      onAssigned={() => void handlers.onReload?.()}
    />
    {!row.isFirstPaymentPaid && row.hasUnpaidPayment && !row.hasReadyToPay && row.hasPaymentPlan && (
      <button
        type="button"
        onClick={(e) => handlers.onMarkReadyToPay(row, e)}
        className="btn btn-circle btn-md btn-warning animate-pulse"
        title="Mark as Ready to Pay"
      >
        <PaperAirplaneIcon className="h-6 w-6" />
      </button>
    )}
  </div>
);

export async function setRetentionHandlerStarted(row: HandlerPipelineRow, started: boolean): Promise<void> {
  const payload = started
    ? { retention_handler_started: true, active_handler_type: 1 }
    : { retention_handler_started: false };
  if (row.isNewLead) {
    const { error } = await supabase.from('leads').update(payload).eq('id', row.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('leads_lead').update(payload).eq('id', handlerDbId(row));
    if (error) throw error;
  }
}

export async function toggleHandlerRetention(
  row: HandlerPipelineRow,
  nextType: ActiveHandlerType,
): Promise<void> {
  if (row.isNewLead) {
    const { error } = await supabase.from('leads').update({ active_handler_type: nextType }).eq('id', row.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('leads_lead')
      .update({ active_handler_type: nextType })
      .eq('id', handlerDbId(row));
    if (error) throw error;
  }
}

export function activeHandlerTypeLabel(type: ActiveHandlerType): string {
  if (type === 1) return 'Retention';
  if (type === 3) return 'Client Support';
  return 'Handler';
}

export async function assignPipelineHandlingRole(
  row: HandlerPipelineRow,
  key: HandlingRoleKey,
  employee: { id: number; display_name: string },
): Promise<void> {
  const empId = Number(employee.id);
  if (!Number.isFinite(empId) || empId <= 0) throw new Error('Invalid employee');
  const activeType: ActiveHandlerType = key === 'retention' ? 1 : key === 'support' ? 3 : 2;
  const updateData: Record<string, unknown> = { active_handler_type: activeType };
  if (key === 'handler') {
    updateData.case_handler_id = empId;
    if (row.isNewLead) updateData.handler = employee.display_name;
  } else if (key === 'retention') {
    updateData.retainer_handler_id = empId;
  } else {
    updateData.client_support_id = empId;
  }

  if (row.isNewLead) {
    const { error } = await supabase.from('leads').update(updateData).eq('id', row.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('leads_lead')
      .update(updateData)
      .eq('id', handlerDbId(row));
    if (error) throw error;
  }
  toast.success(`${employee.display_name} assigned`);
}

/** Build id/name/photo lookup from a tenants_employee query result. */
export function createPipelineEmployeeLookup(
  employees: Array<{
    id: number | string;
    display_name?: string | null;
    photo_url?: string | null;
    photo?: string | null;
  }>,
) {
  const map = new Map<
    string,
    { id: number; name: string | null; photoUrl: string | null }
  >();
  for (const emp of employees) {
    const idNum = Number(emp.id);
    if (!Number.isFinite(idNum)) continue;
    map.set(String(emp.id), {
      id: idNum,
      name: emp.display_name?.trim() || null,
      photoUrl: resolveEmployeePhotoUrl(emp.photo_url, emp.photo),
    });
  }
  return (id: unknown) => {
    if (id == null || id === '') return { id: null as number | null, name: null as string | null, photoUrl: null as string | null };
    const hit = map.get(String(id));
    if (hit) return { id: hit.id, name: hit.name, photoUrl: hit.photoUrl };
    const n = Number(id);
    return {
      id: Number.isFinite(n) && n > 0 ? n : null,
      name: null,
      photoUrl: null,
    };
  };
}

export async function markHandlerReadyToPay(row: HandlerPipelineRow): Promise<void> {
  const currentDate = new Date().toISOString().split('T')[0];
  if (row.isNewLead) {
    const { data: payments, error: fetchError } = await supabase
      .from('payment_plans')
      .select('id, paid, cancel_date')
      .eq('lead_id', row.id)
      .eq('paid', false)
      .is('cancel_date', null)
      .order('due_date', { ascending: true })
      .limit(1);
    if (fetchError) throw fetchError;
    if (!payments || payments.length === 0) throw new Error('No unpaid payments found for this lead');
    const { error } = await supabase
      .from('payment_plans')
      .update({ ...sentToFinanceStamp(), due_date: currentDate })
      .eq('id', payments[0].id);
    if (error) throw error;
    return;
  }
  const { data: payments, error: fetchError } = await supabase
    .from('finances_paymentplanrow')
    .select('id, actual_date, cancel_date')
    .eq('lead_id', handlerDbId(row))
    .is('actual_date', null)
    .is('cancel_date', null)
    .order('date', { ascending: true })
    .limit(1);
  if (fetchError) throw fetchError;
  if (!payments || payments.length === 0) throw new Error('No unpaid payments found for this lead');
  const { error } = await supabase
    .from('finances_paymentplanrow')
    .update({ ...sentToFinanceStamp(), date: currentDate, due_date: currentDate })
    .eq('id', payments[0].id);
  if (error) throw error;
}

async function resolveCloserOrManagerUserId(row: HandlerPipelineRow): Promise<{ userId: string; role: string; name: string }> {
  let targetEmployeeId: number | null = null;
  let targetDisplayName: string | null = null;
  let roleType: 'closer' | 'manager' = 'closer';

  if (row.isNewLead) {
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .select('closer, manager')
      .eq('id', row.id)
      .single();
    if (leadError) throw leadError;
    const closerName = String(leadData?.closer || '').trim();
    if (closerName) {
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('display_name', closerName)
        .maybeSingle();
      if (employeeData) {
        targetEmployeeId = employeeData.id;
        targetDisplayName = employeeData.display_name;
        roleType = 'closer';
      }
    }
    if (!targetEmployeeId) {
      const managerName = String(leadData?.manager || '').trim();
      if (managerName) {
        const { data: employeeData } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .eq('display_name', managerName)
          .maybeSingle();
        if (employeeData) {
          targetEmployeeId = employeeData.id;
          targetDisplayName = employeeData.display_name;
          roleType = 'manager';
        }
      }
    }
  } else {
    const { data: leadData, error: leadError } = await supabase
      .from('leads_lead')
      .select('closer_id, meeting_manager_id')
      .eq('id', handlerDbId(row))
      .single();
    if (leadError) throw leadError;
    if (leadData?.closer_id) {
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', leadData.closer_id)
        .maybeSingle();
      if (employeeData) {
        targetEmployeeId = employeeData.id;
        targetDisplayName = employeeData.display_name;
        roleType = 'closer';
      }
    }
    if (!targetEmployeeId && leadData?.meeting_manager_id) {
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', leadData.meeting_manager_id)
        .maybeSingle();
      if (employeeData) {
        targetEmployeeId = employeeData.id;
        targetDisplayName = employeeData.display_name;
        roleType = 'manager';
      }
    }
  }

  if (!targetEmployeeId) throw new Error('No closer or manager assigned to this lead');

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('employee_id', targetEmployeeId)
    .maybeSingle();
  if (userError) throw userError;
  if (!userData) {
    throw new Error(`No user account found for ${roleType} (${targetDisplayName}). They may not have access to the system.`);
  }
  return { userId: userData.id, role: roleType, name: targetDisplayName || roleType };
}

type OverlayProps = {
  rmqTarget: { row: HandlerPipelineRow; userId: string } | null;
  onCloseRmq: () => void;
};

export const HandlerCaseOverlays: React.FC<OverlayProps> = ({ rmqTarget, onCloseRmq }) => {
  if (!rmqTarget) return null;
  return (
    <RMQMessagesPage
      isOpen
      onClose={onCloseRmq}
      initialUserId={rmqTarget.userId}
      initialMessage="The finance plan is not ready for this lead. Please create the payment plan."
      initialLeadNumber={rmqTarget.row.lead_number}
      initialLeadName={rmqTarget.row.name}
    />
  );
};

export async function openHandlerRmqForCloser(row: HandlerPipelineRow): Promise<{ userId: string; row: HandlerPipelineRow }> {
  const resolved = await resolveCloserOrManagerUserId(row);
  return { userId: resolved.userId, row };
}
