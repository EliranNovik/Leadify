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

  const triggerButton = (
    <button
      type="button"
      onClick={() => setExpanded((prev) => !prev)}
      className="inline-flex items-center gap-1.5 rounded-full border-0 bg-white px-3.5 py-1.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
    >
      <LinkIcon className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
      <span>Client link ({statusLabel})</span>
      {expanded ? (
        <ChevronUpIcon className="h-5 w-5 shrink-0 text-gray-400" aria-hidden />
      ) : (
        <ChevronDownIcon className="h-5 w-5 shrink-0 text-gray-400" aria-hidden />
      )}
    </button>
  );

  if (loading) {
    return (
      <div
        className={`h-8 w-40 max-w-full animate-pulse rounded-full bg-white shadow-sm ${className}`.trim()}
      />
    );
  }

  if (!expanded) {
    return <div className={`w-fit ${className}`.trim()}>{triggerButton}</div>;
  }

  return (
    <div className={`relative w-fit ${className}`.trim()}>
      {triggerButton}
      <div className="absolute right-0 top-full z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm">
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
    </div>
  );
};

export default LeadBookingSettingsPanel;
