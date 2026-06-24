import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  LinkIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline';
import {
  buildPublicBookingUrl,
  staffGetLeadBookingSettings,
  staffUpsertLeadBookingSettings,
} from '../../lib/clientBookingApi';

type Props = {
  leadId: string;
  leadType?: 'new' | 'legacy' | string;
};

const LeadBookingSettingsPanel: React.FC<Props> = ({
  leadId,
  leadType = 'new',
}) => {
  const normalizedType = leadType === 'legacy' || String(leadId).startsWith('legacy_') ? 'legacy' : 'new';
  const normalizedLeadId = String(leadId).replace(/^legacy_/, '');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [bookingToken, setBookingToken] = useState<string | null>(null);

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

  if (loading) return null;

  return (
    <div className="mb-8 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-white overflow-hidden px-5 py-5">
      <div className="flex items-start gap-3 mb-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 shrink-0">
          <LinkIcon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900">Client self-scheduling link</h3>
            {enabled ? (
              <span className="badge badge-success badge-sm">Enabled</span>
            ) : (
              <span className="badge badge-ghost badge-sm">Disabled</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Public booking page for this lead. Configure defaults in Admin → Meeting Booking.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer mb-5">
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={enabled}
          disabled={saving || !bookingToken}
          onChange={(e) => void handleEnabledChange(e.target.checked)}
        />
        <span className="text-sm font-medium">Enable public booking page for this lead</span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={generating || saving || Boolean(bookingToken)}
          onClick={() => void handleGenerate()}
        >
          {generating ? 'Generating…' : 'Generate link'}
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm gap-1"
          disabled={!bookingToken}
          onClick={() => void copyLink()}
        >
          <ClipboardDocumentIcon className="h-4 w-4" />
          Copy link
        </button>
      </div>
    </div>
  );
};

export default LeadBookingSettingsPanel;
