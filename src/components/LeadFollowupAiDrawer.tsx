import React, { useEffect, useMemo, useState } from 'react';
import { ExclamationTriangleIcon, SparklesIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import type { Lead } from '../lib/supabase';
import { buildLeadClientPath } from '../lib/leadClientRoute';
import {
  fetchLeadFollowupVerdict,
  type LeadFollowupResult,
  type LeadFollowupVerdict,
} from '../lib/leadFollowupAiApi';
import { getSoftStageBadgeStyle, getStageColour, getStageName, fetchStageNames, areStagesEquivalent } from '../lib/stageUtils';
import MobileBottomSheet from './MobileBottomSheet';
import { updateLeadStageWithHistory } from '../lib/leadStageManager';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import {
  fetchActiveStaffEmployees,
  type ActiveStaffEmployee,
} from '../lib/employeeSalaries';
import { EmployeeAvatarLabel } from './admin/ActiveEmployeeSelect';

type Props = {
  open: boolean;
  lead: Lead | null;
  onClose: () => void;
  onResult?: (lead: Lead, result: LeadFollowupResult) => void;
  onSchedulerAssigned?: (lead: Lead, patch: { scheduler: string; meeting_scheduler_id?: number; stage: number }) => void;
};

const LOADING_LINES = [
  'Opening the file',
  'Reading facts & meetings',
  'Checking WhatsApp & email',
  'Scoring the follow-up',
];

const VERDICT_LABEL: Record<LeadFollowupVerdict, string> = {
  high: 'High chance — follow up',
  medium: 'Worth a follow-up',
  low: 'Low priority',
  not_worth: 'Probably not worth chasing',
};

const VERDICT_BADGE: Record<LeadFollowupVerdict, string> = {
  high: 'bg-gradient-to-r from-emerald-500 to-teal-500',
  medium: 'bg-gradient-to-r from-amber-400 to-orange-500',
  low: 'bg-gradient-to-r from-slate-400 to-slate-500',
  not_worth: 'bg-gradient-to-r from-rose-500 to-red-600',
};

function isEmptyRole(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return !s || s === '---' || s === '--' || /^not[_\s-]?assigned$/i.test(s);
}

function isBeforeSchedulerAssigned(stage: unknown): boolean {
  if (stage == null || String(stage).trim() === '') return true;
  const raw = String(stage).trim();
  if (/^\d+$/.test(raw)) return Number(raw) < 10;
  if (areStagesEquivalent(raw, 'Created')) return true;
  const name = getStageName(raw);
  if (areStagesEquivalent(name, 'Created')) return true;
  if (areStagesEquivalent(name, 'Scheduler assigned')) return false;
  return false;
}

function leadHasScheduler(lead: Lead): boolean {
  const row = lead as unknown as Record<string, unknown>;
  if (!isEmptyRole(row.scheduler)) return true;
  const schedulerId = row.meeting_scheduler_id;
  if (schedulerId != null && String(schedulerId).trim() !== '' && String(schedulerId) !== '0' && !isEmptyRole(schedulerId)) {
    return true;
  }
  const roles = row.roles as { scheduler?: unknown } | undefined;
  if (roles && !isEmptyRole(roles.scheduler)) return true;
  return false;
}

function formatWhen(value?: string | null) {
  if (!value) return '—';
  const ymd = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])).toLocaleDateString();
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleDateString();
}

function formatMeeting(date?: string | null, time?: string | null) {
  if (!date) return '—';
  const datePart = formatWhen(String(date).slice(0, 10));
  const timePart = String(time || '').slice(0, 5);
  return timePart ? `${datePart} · ${timePart}` : datePart;
}

function formatGeneratedAt(value?: string | null, cached?: boolean) {
  if (!value) return cached ? 'Saved summary' : 'Just generated';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return cached ? 'Saved summary' : 'Just generated';
  const when = new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return cached ? `Saved · ${when}` : `Generated · ${when}`;
}

function currencySymbol(raw?: string | number | null) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim().toUpperCase();
  if (s === '1' || s === 'NIS' || s === 'ILS' || s === '₪') return '₪';
  if (s === '2' || s === 'EUR' || s === '€') return '€';
  if (s === '3' || s === 'USD' || s === '$') return '$';
  if (s === 'GBP' || s === '£') return '£';
  return String(raw).trim();
}

function formatMoney(value?: string | number | null, currency?: string | number | null) {
  if (value == null || value === '') return '—';
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return String(value);
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const symbol = currencySymbol(currency);
  return symbol ? `${symbol}${formatted}` : formatted;
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="shrink-0 text-sm text-neutral-500">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium text-neutral-900">{value}</span>
    </div>
  );
}

function StageBadge({ stage }: { stage: string | number | null | undefined }) {
  if (stage == null || stage === '') {
    return (
      <span className="badge stage-badge rounded-full shrink-0 border-0 bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
        No Stage
      </span>
    );
  }

  const stageStr = String(stage);
  const stageName = getStageName(stageStr);
  const soft = getSoftStageBadgeStyle(getStageColour(stageStr), stageStr);

  return (
    <span
      className="badge stage-badge inline-block max-w-full shrink-0 rounded-full border-0 px-2.5 py-0.5 text-xs"
      style={{
        backgroundColor: soft.backgroundColor,
        color: soft.color,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      title={stageName}
    >
      {stageName}
    </span>
  );
}

const LeadFollowupAiDrawer: React.FC<Props> = ({ open, lead, onClose, onResult, onSchedulerAssigned }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LeadFollowupResult | null>(null);
  const [loadingLine, setLoadingLine] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [employees, setEmployees] = useState<ActiveStaffEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [assignedName, setAssignedName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchStageNames();
  }, [open]);

  useEffect(() => {
    if (!loading) {
      setLoadingLine(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingLine((prev) => (prev + 1) % LOADING_LINES.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!open || !lead) {
      setResult(null);
      setLoading(false);
      setPickerOpen(false);
      setEmployeeSearch('');
      setAssignedName(null);
      setAssigningId(null);
      return;
    }
    const currentLead = lead;
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setPickerOpen(false);
    setEmployeeSearch('');
    setAssignedName(null);
    void fetchLeadFollowupVerdict(currentLead).then((next) => {
      if (cancelled) return;
      setResult(next);
      setLoading(false);
      if (next.success) onResult?.(currentLead, next);
    });
    return () => {
      cancelled = true;
    };
  }, [open, lead?.id, onResult]);

  useEffect(() => {
    if (!pickerOpen) return;
    if (employees.length > 0) return;
    let cancelled = false;
    setEmployeesLoading(true);
    void fetchActiveStaffEmployees()
      .then((rows) => {
        if (!cancelled) setEmployees(rows);
      })
      .catch((err) => {
        console.error('Failed to load employees', err);
        if (!cancelled) {
          setEmployees([]);
          toast.error('Could not load employees');
        }
      })
      .finally(() => {
        if (!cancelled) setEmployeesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, employees.length]);

  const filteredEmployees = useMemo(() => {
    const term = employeeSearch.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((emp) => emp.display_name.toLowerCase().includes(term));
  }, [employees, employeeSearch]);

  const canAssignScheduler = Boolean(
    lead && isBeforeSchedulerAssigned(lead.stage) && !leadHasScheduler(lead) && !assignedName,
  );

  const assignScheduler = async (employee: ActiveStaffEmployee) => {
    if (!lead || assigningId != null) return;
    const row = lead as unknown as Record<string, unknown>;
    const isLegacy = row.lead_type === 'legacy' || String(lead.id ?? '').startsWith('legacy_');
    setAssigningId(employee.id);
    try {
      await updateLeadStageWithHistory({
        lead: {
          ...(lead as unknown as CombinedLead),
          id: String(lead.id),
          lead_type: isLegacy ? 'legacy' : 'new',
        },
        stage: 10,
        additionalFields: isLegacy
          ? { meeting_scheduler_id: employee.id }
          : { scheduler: employee.display_name },
      });
      setAssignedName(employee.display_name);
      setPickerOpen(false);
      setEmployeeSearch('');
      onSchedulerAssigned?.(lead, {
        scheduler: employee.display_name,
        meeting_scheduler_id: employee.id,
        stage: 10,
      });
      toast.success(`Assigned ${employee.display_name} as scheduler`);
    } catch (err) {
      console.error('Failed to assign scheduler', err);
      toast.error('Could not assign scheduler');
    } finally {
      setAssigningId(null);
    }
  };

  const anyLead = (lead || {}) as Record<string, unknown>;
  const title = String(anyLead.name || result?.leadName || 'Lead');
  const leadNumber = anyLead.display_lead_number || anyLead.lead_number || result?.leadNumber;
  const clientPath = lead ? buildLeadClientPath(lead) : null;

  const moneyCurrency = result?.stats.balanceCurrency || result?.stats.proposalCurrency;

  const assignSchedulerPanel =
    canAssignScheduler ? (
      <div className="mt-6">
        {!pickerOpen ? (
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700"
            onClick={() => setPickerOpen(true)}
          >
            <UserPlusIcon className="h-5 w-5" aria-hidden />
            Assign scheduler
          </button>
        ) : (
          <div className="rounded-2xl border border-neutral-200 bg-white p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
              Assign scheduler
            </p>
            <input
              type="text"
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              placeholder="Search employees…"
              className="h-10 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-900 placeholder:text-neutral-400"
              autoFocus
            />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-neutral-100">
              {employeesLoading ? (
                <p className="px-3 py-4 text-sm text-neutral-500">Loading employees…</p>
              ) : filteredEmployees.length === 0 ? (
                <p className="px-3 py-4 text-sm text-neutral-500">No employees match this search.</p>
              ) : (
                filteredEmployees.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    disabled={assigningId != null}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-neutral-50 disabled:opacity-60"
                    onClick={() => void assignScheduler(emp)}
                  >
                    <EmployeeAvatarLabel employee={emp} size="sm" />
                    {assigningId === emp.id ? (
                      <span className="ml-auto text-xs text-violet-600">Saving…</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              className="mt-2 w-full rounded-xl px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-50"
              onClick={() => {
                setPickerOpen(false);
                setEmployeeSearch('');
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    ) : assignedName ? (
      <p className="mt-6 rounded-2xl bg-violet-50 px-4 py-3 text-sm font-medium text-violet-800">
        Scheduler: {assignedName}
      </p>
    ) : null;

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={
        <span className="flex flex-col items-start gap-1">
          {leadNumber ? (
            clientPath ? (
              <button
                type="button"
                className="text-sm font-medium font-mono text-violet-700 hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose();
                  navigate(clientPath);
                }}
              >
                #{String(leadNumber)}
              </button>
            ) : (
              <span className="text-sm font-medium font-mono text-neutral-500">#{String(leadNumber)}</span>
            )
          ) : null}
          <span>{title}</span>
        </span>
      }
      headerRight={
        result?.success ? (
          <div className="pr-0 text-right">
            <p className="text-2xl font-semibold tabular-nums leading-none text-neutral-900">{result.score}</p>
            <p className="mt-1 text-xs text-neutral-400">out of 100</p>
          </div>
        ) : null
      }
      desktopLayout="drawer-right"
      zIndex={340}
      headerClassName="!border-b-0"
      contentClassName="!px-5 !pb-8 !bg-white"
      overlayClassName="bg-black/40"
      sheetClassName="md:max-w-[min(100%,26rem)] md:shadow-xl md:!border-l md:!border-neutral-200 md:!bg-white"
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center px-4 py-20">
          <div className="followup-ai-loader relative mb-7 flex items-center justify-center">
            <span className="followup-ai-ring-outer" aria-hidden />
            <span className="followup-ai-ring-inner" aria-hidden />
            <span className="followup-ai-glow" aria-hidden />
            <SparklesIcon className="followup-ai-sparkle relative z-10 h-8 w-8 text-violet-600" aria-hidden />
          </div>
          <p className="bg-gradient-to-r from-fuchsia-600 via-violet-600 to-indigo-500 bg-clip-text text-lg font-semibold tracking-tight text-transparent">
            Reviewing this lead
          </p>
          <p className="mt-2 text-sm text-neutral-500 transition-opacity duration-500">
            {LOADING_LINES[loadingLine]}
          </p>
          <style>{`
            @keyframes followup-ai-spin {
              to { transform: rotate(360deg); }
            }
            @keyframes followup-ai-spin-rev {
              to { transform: rotate(-360deg); }
            }
            @keyframes followup-ai-pulse {
              0%, 100% { transform: scale(0.92); opacity: 0.4; }
              50% { transform: scale(1.06); opacity: 0.9; }
            }
            @keyframes followup-ai-sparkle {
              0%, 100% { transform: scale(1) rotate(0deg); }
              50% { transform: scale(1.12) rotate(8deg); }
            }
            .followup-ai-loader {
              width: 5.5rem;
              height: 5.5rem;
            }
            .followup-ai-ring-outer {
              position: absolute;
              inset: 0;
              border-radius: 9999px;
              background: conic-gradient(from 0deg, #e879f9, #8b5cf6, #6366f1, #38bdf8, #e879f9);
              -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
              mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
              animation: followup-ai-spin 1.15s linear infinite;
            }
            .followup-ai-ring-inner {
              position: absolute;
              inset: 12px;
              border-radius: 9999px;
              border: 2px solid transparent;
              border-top-color: #c4b5fd;
              border-right-color: #67e8f9;
              animation: followup-ai-spin-rev 0.9s linear infinite;
            }
            .followup-ai-glow {
              position: absolute;
              inset: 20px;
              border-radius: 9999px;
              background: radial-gradient(circle, rgba(167,139,250,0.5) 0%, rgba(56,189,248,0.18) 55%, transparent 72%);
              animation: followup-ai-pulse 2s ease-in-out infinite;
            }
            .followup-ai-sparkle {
              animation: followup-ai-sparkle 1.7s ease-in-out infinite;
            }
          `}</style>
        </div>
      ) : result && !result.success ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <ExclamationTriangleIcon className="h-8 w-8 text-neutral-400" />
          <p className="text-sm text-neutral-600">{result.error || 'Could not generate a summary.'}</p>
          <div className="w-full text-left">{assignSchedulerPanel}</div>
        </div>
      ) : result ? (
        <div className="flex flex-col">
          <div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-sm ${VERDICT_BADGE[result.verdict]}`}
            >
              <SparklesIcon className="h-5 w-5" aria-hidden />
              {VERDICT_LABEL[result.verdict]}
            </span>
            {result.headline ? (
              <p className="mt-2 text-lg font-semibold leading-snug text-neutral-900">{result.headline}</p>
            ) : null}
            <p className="mt-1.5 text-xs text-neutral-400">
              {formatGeneratedAt(result.generatedAt, result.cached)}
            </p>
          </div>

          {result.summary ? (
            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Summary</p>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-700">
                {result.summary}
              </p>
            </div>
          ) : null}

          {result.caseHighlights.length > 0 ? (
            <div className="mt-6 rounded-2xl bg-violet-50 px-4 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-violet-400">Case</p>
              <ul className="mt-2 space-y-2">
                {result.caseHighlights.map((item, index) => (
                  <li key={`${index}-${item.slice(0, 24)}`} className="flex gap-2.5 text-sm leading-relaxed text-violet-950/80">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-violet-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.nextAction ? (
            <div className="mt-6 rounded-2xl bg-neutral-100 px-4 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Next step</p>
              <p className="mt-2 text-[15px] font-medium leading-relaxed text-neutral-900">
                {result.nextAction}
              </p>
            </div>
          ) : null}

          {assignSchedulerPanel}

          {result.why.length > 0 ? (
            <div className="mt-6 rounded-2xl bg-emerald-50 px-4 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-400">Why</p>
              <ul className="mt-2 space-y-2">
                {result.why.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-emerald-900/80">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.risks.length > 0 ? (
            <div className="mt-6 rounded-2xl bg-rose-50 px-4 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-rose-400">Risks</p>
              <ul className="mt-2 space-y-2">
                {result.risks.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-rose-900/80">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-rose-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-6 border-t border-neutral-200 pt-2">
            <p className="mb-1 pt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">Details</p>
            <div className="divide-y divide-neutral-100">
              <StatRow
                label="Proposal"
                value={formatMoney(result.stats.proposal, result.stats.proposalCurrency || moneyCurrency)}
              />
              <StatRow
                label="Balance"
                value={formatMoney(result.stats.balance, result.stats.balanceCurrency || moneyCurrency)}
              />
              <StatRow
                label="Last contact"
                value={`${result.stats.lastContactChannel || '—'} · ${formatWhen(result.stats.lastContactAt)}`}
              />
              {result.stats.lastMessagePreview ? (
                <StatRow
                  label="Last message"
                  value={
                    result.stats.lastMessagePreview.length > 160
                      ? `${result.stats.lastMessagePreview.slice(0, 160)}…`
                      : result.stats.lastMessagePreview
                  }
                />
              ) : null}
              <StatRow
                label="Days quiet"
                value={result.stats.daysSinceContact != null ? result.stats.daysSinceContact : '—'}
              />
              <StatRow
                label="In / out"
                value={`${result.stats.inboundCount ?? 0} / ${result.stats.outboundCount ?? 0}`}
              />
              <StatRow label="Stage" value={<StageBadge stage={assignedName ? 10 : result.stats.stage} />} />
              {result.stats.expertExam ? (
                <StatRow label="Expert exam" value={result.stats.expertExam} />
              ) : null}
              <StatRow
                label="Last meeting"
                value={formatMeeting(result.stats.lastMeetingDate, result.stats.lastMeetingTime)}
              />
              <StatRow
                label="Next meeting"
                value={formatMeeting(result.stats.nextMeetingDate, result.stats.nextMeetingTime)}
              />
              <StatRow
                label="Payments"
                value={`${result.stats.paidPlanRows ?? 0} paid / ${result.stats.unpaidPlanRows ?? 0} unpaid`}
              />
              <StatRow label="Next due" value={formatWhen(result.stats.nextDue)} />
            </div>
          </div>
        </div>
      ) : null}
    </MobileBottomSheet>
  );
};

export default LeadFollowupAiDrawer;
