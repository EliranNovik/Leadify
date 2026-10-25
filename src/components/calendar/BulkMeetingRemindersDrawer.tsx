import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { useMsal } from '@azure/msal-react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import {
  buildBulkReminderTargets,
  findTargetsMissingEmailTemplate,
  loadBulkReminderContext,
  sendBulkMeetingReminders,
  summarizeBulkReminderResults,
  type BulkReminderChannel,
  type BulkReminderContext,
  type BulkReminderProgress,
  type BulkReminderTarget,
  type BulkReminderTargetResult,
} from '../../lib/bulkMeetingReminders';
import { loginRequest } from '../../msalConfig';
import { OutlookIcon } from '../MeetingNotifyControls';

type BulkMeetingRemindersDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** The selected raw CalendarPage meeting rows. */
  meetings: any[];
  /** Closes the drawer and drops the selection — used once a successful run is acknowledged. */
  onSent?: () => void;
};

type Phase = 'review' | 'sending' | 'done';

const languageLabel = (language: 'en' | 'he') => (language === 'he' ? 'עברית' : 'English');

const formatDisplayDate = (date: string): string => {
  const [year, month, day] = (date || '').split('-');
  if (!year || !month || !day) return date;
  return `${day}/${month}`;
};

const ChannelToggle: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}> = ({ checked, onChange, disabled, icon, title, subtitle }) => (
  <label
    className={`flex items-start gap-3 px-4 py-3 border rounded-lg transition-colors ${
      disabled
        ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
        : checked
          ? 'border-purple-300 bg-purple-50 cursor-pointer'
          : 'border-gray-200 hover:bg-gray-50 cursor-pointer'
    }`}
  >
    <input
      type="checkbox"
      className="checkbox checkbox-primary checkbox-sm mt-1"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="w-5 h-5 flex items-center justify-center mt-0.5">{icon}</span>
    <span className="flex-1 min-w-0">
      <span className="block font-medium text-gray-900">{title}</span>
      <span className="block text-xs text-gray-500">{subtitle}</span>
    </span>
  </label>
);

const ResultChannelLine: React.FC<{
  label: string;
  result: BulkReminderTargetResult['email'];
  /** Channels the user turned off are left out of the summary entirely. */
  selected: boolean;
}> = ({ label, result, selected }) => {
  if (!selected) return null;

  const tone =
    result.status === 'sent'
      ? 'text-green-700'
      : result.status === 'partial'
        ? 'text-amber-700'
        : result.status === 'failed'
          ? 'text-red-600'
          : 'text-gray-500';

  const detail =
    result.recipients.length > 0
      ? `${label}: sent to ${result.recipients.length} recipient${result.recipients.length === 1 ? '' : 's'}`
      : `${label}: ${result.reason || 'not sent'}`;

  return (
    <div className={`text-xs ${tone}`}>
      {detail}
      {result.status === 'partial' && result.reason ? ` — ${result.reason}` : ''}
    </div>
  );
};

export const BulkMeetingRemindersDrawer: React.FC<BulkMeetingRemindersDrawerProps> = ({
  open,
  onClose,
  meetings,
  onSent,
}) => {
  const { instance } = useMsal();
  const [phase, setPhase] = useState<Phase>('review');
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [sendEmailChannel, setSendEmailChannel] = useState(true);
  const [context, setContext] = useState<BulkReminderContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [progress, setProgress] = useState<BulkReminderProgress | null>(null);
  const [results, setResults] = useState<BulkReminderTargetResult[]>([]);

  const targets = useMemo(() => buildBulkReminderTargets(meetings), [meetings]);

  const channels = useMemo<BulkReminderChannel[]>(() => {
    const next: BulkReminderChannel[] = [];
    if (sendWhatsApp) next.push('whatsapp');
    if (sendEmailChannel) next.push('email');
    return next;
  }, [sendWhatsApp, sendEmailChannel]);

  useEffect(() => {
    if (!open) {
      setPhase('review');
      setProgress(null);
      setResults([]);
      setContext(null);
      return;
    }

    let cancelled = false;
    setLoadingContext(true);
    // Both channels are loaded up front so the review list can show the language and any
    // missing template before the user commits to sending.
    loadBulkReminderContext(targets, ['whatsapp', 'email'])
      .then((loaded) => {
        if (!cancelled) setContext(loaded);
      })
      .catch((error) => {
        console.error('BulkMeetingRemindersDrawer: failed to load templates', error);
        if (!cancelled) toast.error('Failed to load reminder templates');
      })
      .finally(() => {
        if (!cancelled) setLoadingContext(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, targets]);

  const missingEmailTemplate = useMemo(() => {
    if (!context) return new Set<string>();
    return new Set(findTargetsMissingEmailTemplate(targets, context).map((t) => t.rowId));
  }, [targets, context]);

  const handleSend = useCallback(async () => {
    if (!context || channels.length === 0 || targets.length === 0) return;

    let accessToken: string | null = null;
    if (channels.includes('email')) {
      try {
        const { getAccessTokenWithFallback } = await import('../../lib/graph');
        const accounts = instance.getAllAccounts();
        accessToken = await getAccessTokenWithFallback(instance, loginRequest, accounts[0], () => {
          toast('Your session has expired. Please sign in again.', { icon: '🔑' });
        });
      } catch (error) {
        console.error('BulkMeetingRemindersDrawer: token acquisition failed', error);
      }
      if (!accessToken) {
        toast.error('Microsoft sign-in is required to send the email reminders');
        return;
      }
    }

    setPhase('sending');
    setProgress({ completed: 0, total: targets.length, current: targets[0] ?? null, results: [] });

    const sent = await sendBulkMeetingReminders({
      targets,
      channels,
      context,
      accessToken,
      onProgress: setProgress,
    });

    setResults(sent);
    setPhase('done');

    const summary = summarizeBulkReminderResults(sent);
    if (summary.fullyFailed === 0) {
      toast.success(`Reminders sent for ${summary.total} meeting${summary.total === 1 ? '' : 's'}`);
    } else if (summary.fullyFailed === summary.total) {
      toast.error('No reminders could be sent');
    } else {
      toast(`${summary.total - summary.fullyFailed} of ${summary.total} leads reminded`, { icon: '⚠️' });
    }
  }, [channels, context, instance, targets]);

  /** Acknowledging a finished run drops the selection; closing any other way keeps it. */
  const handleDone = useCallback(() => {
    const anyDelivered = results.some(
      (r) => r.whatsapp.recipients.length > 0 || r.email.recipients.length > 0,
    );
    if (anyDelivered && onSent) onSent();
    else onClose();
  }, [results, onClose, onSent]);

  if (!open) return null;

  const summary = results.length > 0 ? summarizeBulkReminderResults(results) : null;
  const isBusy = phase === 'sending';

  const renderTargetRow = (target: BulkReminderTarget) => {
    const noEmailTemplate = sendEmailChannel && missingEmailTemplate.has(target.rowId);
    return (
      <div key={target.rowId} className="flex items-start gap-3 px-4 py-3 border border-gray-200 rounded-lg">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 truncate">
            {target.lead.name || 'Client'}
            {target.lead.lead_number ? (
              <span className="text-xs text-gray-500 font-semibold"> ({target.lead.lead_number})</span>
            ) : null}
          </div>
          <div className="text-xs text-gray-500">
            {formatDisplayDate(target.date)} at {target.time}
          </div>
          {noEmailTemplate && (
            <div className="text-xs text-amber-700 mt-1 flex items-start gap-1">
              <ExclamationTriangleIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>No {languageLabel(target.language)} reminder email template for this location — WhatsApp only</span>
            </div>
          )}
        </div>
        <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-medium flex-shrink-0">
          {languageLabel(target.language)}
        </span>
      </div>
    );
  };

  const drawer = (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-[200]"
        onClick={isBusy ? undefined : onClose}
        aria-hidden="true"
      />
      <aside className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-[210] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Send meeting reminders</h2>
            <p className="text-sm text-gray-500 mt-1">
              {targets.length} lead{targets.length === 1 ? '' : 's'} selected. Each one is reminded in its
              own language.
            </p>
          </div>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">Send via</h3>
            <ChannelToggle
              checked={sendWhatsApp}
              onChange={setSendWhatsApp}
              disabled={isBusy}
              icon={<FaWhatsapp className="w-5 h-5 text-green-600" aria-hidden="true" />}
              title="WhatsApp"
              subtitle="Reminder template, to every contact with a phone number"
            />
            <ChannelToggle
              checked={sendEmailChannel}
              onChange={setSendEmailChannel}
              disabled={isBusy}
              icon={<OutlookIcon className="w-5 h-5" />}
              title="Outlook email"
              subtitle="Reminder template, to every contact with an email address"
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">Recipients</h3>
            {loadingContext ? (
              <div className="flex justify-center items-center py-8">
                <span className="loading loading-spinner loading-md"></span>
              </div>
            ) : targets.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">
                None of the selected rows can be reminded. Internal meetings and rows without a lead are
                skipped.
              </p>
            ) : (
              <div className="space-y-2">{targets.map(renderTargetRow)}</div>
            )}
          </div>
        </div>

        <div className="p-6 pt-4 border-t border-gray-100 flex gap-3">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={isBusy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={isBusy || loadingContext || targets.length === 0 || channels.length === 0 || !context}
            onClick={() => void handleSend()}
          >
            Send reminders{targets.length > 0 ? ` (${targets.length})` : ''}
          </button>
        </div>
      </aside>
    </>
  );

  const progressModal =
    phase === 'sending' || phase === 'done' ? (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[220] p-4">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
          {phase === 'sending' ? (
            <div className="p-8 text-center">
              <span className="loading loading-spinner loading-lg text-primary"></span>
              <h3 className="text-lg font-semibold text-gray-900 mt-4">Sending reminders…</h3>
              <p className="text-sm text-gray-500 mt-1">
                {progress ? `${progress.completed} of ${progress.total} done` : 'Starting…'}
                {progress?.current ? ` — ${progress.current.lead.name || 'Client'}` : ''}
              </p>
              <progress
                className="progress progress-primary w-full mt-4"
                value={progress?.completed ?? 0}
                max={progress?.total ?? targets.length}
              ></progress>
              <p className="text-xs text-gray-400 mt-3">Please keep this window open.</p>
            </div>
          ) : (
            <>
              <div className="p-6 border-b border-gray-100 text-center">
                {summary && summary.fullyFailed === 0 ? (
                  <CheckCircleIcon className="w-12 h-12 mx-auto text-green-500" />
                ) : (
                  <ExclamationTriangleIcon className="w-12 h-12 mx-auto text-amber-500" />
                )}
                <h3 className="text-lg font-semibold text-gray-900 mt-3">
                  {summary && summary.fullyFailed === 0 ? 'All reminders sent' : 'Finished with problems'}
                </h3>
                {summary && (
                  <p className="text-sm text-gray-500 mt-1">
                    WhatsApp: {summary.whatsappSent}/{summary.total} leads ({summary.whatsappRecipients}{' '}
                    recipients) · Email: {summary.emailSent}/{summary.total} leads (
                    {summary.emailRecipients} recipients)
                  </p>
                )}
              </div>

              <div className="p-6 overflow-y-auto flex-1 space-y-2">
                {results.map((result) => (
                  <div key={result.rowId} className="px-4 py-3 border border-gray-200 rounded-lg">
                    <div className="font-medium text-gray-900 text-sm">
                      {result.leadName}
                      {result.leadNumber ? (
                        <span className="text-xs text-gray-500 font-semibold"> ({result.leadNumber})</span>
                      ) : null}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <ResultChannelLine label="WhatsApp" result={result.whatsapp} selected={sendWhatsApp} />
                      <ResultChannelLine label="Email" result={result.email} selected={sendEmailChannel} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 pt-4 border-t border-gray-100">
                <button type="button" className="btn btn-primary w-full" onClick={handleDone}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    ) : null;

  return createPortal(
    <>
      {drawer}
      {progressModal}
    </>,
    document.body,
  );
};

export default BulkMeetingRemindersDrawer;
