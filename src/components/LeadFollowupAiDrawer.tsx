import React, { useEffect, useState } from 'react';
import { ExclamationTriangleIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import type { Lead } from '../lib/supabase';
import { buildLeadClientPath } from '../lib/leadClientRoute';
import {
  fetchLeadFollowupVerdict,
  type LeadFollowupResult,
  type LeadFollowupVerdict,
} from '../lib/leadFollowupAiApi';
import { getSoftStageBadgeStyle, getStageColour, getStageName, fetchStageNames } from '../lib/stageUtils';
import MobileBottomSheet from './MobileBottomSheet';

type Props = {
  open: boolean;
  lead: Lead | null;
  onClose: () => void;
};

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

const LeadFollowupAiDrawer: React.FC<Props> = ({ open, lead, onClose }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LeadFollowupResult | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchStageNames();
  }, [open]);

  useEffect(() => {
    if (!open || !lead) {
      setResult(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setResult(null);
    void fetchLeadFollowupVerdict(lead).then((next) => {
      if (cancelled) return;
      setResult(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, lead]);

  const anyLead = (lead || {}) as Record<string, unknown>;
  const title = String(anyLead.name || result?.leadName || 'Lead');
  const leadNumber = anyLead.display_lead_number || anyLead.lead_number || result?.leadNumber;
  const clientPath = lead ? buildLeadClientPath(lead) : null;

  const moneyCurrency = result?.stats.balanceCurrency || result?.stats.proposalCurrency;

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
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <span className="loading loading-spinner loading-lg text-neutral-400" />
          <p className="text-sm text-neutral-500">Reading this lead…</p>
        </div>
      ) : result && !result.success ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <ExclamationTriangleIcon className="h-8 w-8 text-neutral-400" />
          <p className="text-sm text-neutral-600">{result.error || 'Could not generate a summary.'}</p>
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

          {result.nextAction ? (
            <div className="mt-6 rounded-2xl bg-neutral-100 px-4 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Next step</p>
              <p className="mt-2 text-[15px] font-medium leading-relaxed text-neutral-900">
                {result.nextAction}
              </p>
            </div>
          ) : null}

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
              <StatRow
                label="Days quiet"
                value={result.stats.daysSinceContact != null ? result.stats.daysSinceContact : '—'}
              />
              <StatRow
                label="In / out"
                value={`${result.stats.inboundCount ?? 0} / ${result.stats.outboundCount ?? 0}`}
              />
              <StatRow label="Stage" value={<StageBadge stage={result.stats.stage} />} />
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
