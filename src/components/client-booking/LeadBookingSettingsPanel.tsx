import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  LinkIcon,
  ClipboardDocumentIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import {
  buildPublicBookingUrl,
  staffGetLeadBookingSettings,
  staffUpsertLeadBookingSettings,
} from '../../lib/clientBookingApi';

type Props = {
  leadId: string;
  leadType?: 'new' | 'legacy' | string;
  /** Extra classes for the outer wrapper (e.g. when placed inline next to a title). */
  className?: string;
};

const LeadBookingSettingsPanel: React.FC<Props> = ({
  leadId,
  leadType = 'new',
  className = '',
}) => {
  const normalizedType = leadType === 'legacy' || String(leadId).startsWith('legacy_') ? 'legacy' : 'new';
  const normalizedLeadId = String(leadId).replace(/^legacy_/, '');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [bookingToken, setBookingToken] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!normalizedLeadId) return;
    setLoading(true);
    try {
      const result = await staffGetLeadBookingSettings(normalizedLeadId, normalizedType);
      if (result.settings) {
        setEnabled(Boolean(result.settings.enabled));
        setBookingToken(result.settings.booking_token);
      } else {
        setEnabled(false);
        setBookingToken(null);
      }
    } catch (e) {
      console.error('load booking settings', e);
    } finally {
      setLoading(false);
    }
  }, [normalizedLeadId, normalizedType]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleEnabledChange = async (next: boolean) => {
    if (!bookingToken && next) {
      toast.error('Generate a link first');
      return;
    }
    setSaving(true);
    try {
      const result = await staffUpsertLeadBookingSettings(normalizedLeadId, normalizedType, {
        enabled: next,
      });
      if (result.settings) {
        setEnabled(Boolean(result.settings.enabled));
        setBookingToken(result.settings.booking_token);
      }
      toast.success(next ? 'Booking link enabled' : 'Booking link disabled');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
      void load();
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await staffUpsertLeadBookingSettings(normalizedLeadId, normalizedType, {
        generate_link: true,
      });
      if (result.settings) {
        setEnabled(Boolean(result.settings.enabled));
        setBookingToken(result.settings.booking_token);
        toast.success('Booking link generated');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate link');
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = async () => {
    if (!bookingToken) {
      toast.error('Generate a link first');
      return;
    }
    const url = buildPublicBookingUrl(bookingToken);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Booking link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const bookingUrl = bookingToken ? buildPublicBookingUrl(bookingToken) : null;

  const statusLabel = enabled ? 'Active' : bookingToken ? 'Inactive' : 'Not set up';
  const statusClass = enabled
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
    : bookingToken
      ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
      : 'bg-slate-100 text-slate-600 ring-slate-500/10';

  const collapsedHint = enabled
    ? 'Public booking page is live'
    : bookingToken
      ? 'Link ready — click to manage'
      : 'Share a public booking page with this client';

  if (loading) {
    return (
      <div
        className={`h-12 w-72 max-w-full animate-pulse rounded-xl border border-slate-200/80 bg-slate-50 ${className}`.trim()}
      />
    );
  }

  if (!expanded) {
    return (
      <div className={`w-fit max-w-lg ${className}`.trim()}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex max-w-full items-center gap-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:border-indigo-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
            <LinkIcon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">Client self-scheduling link</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClass}`}>
                {statusLabel}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">{collapsedHint}</p>
          </div>
          <ChevronDownIcon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`w-fit max-w-lg overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ${className}`.trim()}
    >
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="flex w-full items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-4 py-3.5 text-left transition-colors hover:from-indigo-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/40"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
          <LinkIcon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">Client self-scheduling link</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusClass}`}>
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            Public booking page for this lead · defaults in Admin → Meeting Booking
          </p>
        </div>
        <ChevronUpIcon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
      </button>

      <div className="space-y-5 px-4 py-5 sm:px-5">
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3.5 transition-colors hover:bg-slate-50">
          <div className="min-w-0">
            <span className="block text-sm font-medium text-slate-900">Enable public booking page</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Clients can book meetings without staff involvement
            </span>
          </div>
          <input
            type="checkbox"
            className="toggle toggle-primary shrink-0"
            checked={enabled}
            disabled={saving || !bookingToken}
            onChange={(e) => void handleEnabledChange(e.target.checked)}
          />
        </label>

        {bookingUrl ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Booking URL</p>
            <p className="mt-1 break-all font-mono text-sm text-slate-700">{bookingUrl}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Generate a unique link for this lead, then enable it when you are ready to share.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1.5 rounded-lg shadow-sm"
            disabled={generating || saving || Boolean(bookingToken)}
            onClick={() => void handleGenerate()}
          >
            {generating ? 'Generating…' : bookingToken ? 'Link generated' : 'Generate link'}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm gap-1.5 rounded-lg border-slate-200 bg-white hover:border-slate-300"
            disabled={!bookingToken}
            onClick={() => void copyLink()}
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
            Copy link
          </button>
          {bookingUrl ? (
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm gap-1.5 rounded-lg text-slate-600"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              Preview
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default LeadBookingSettingsPanel;
