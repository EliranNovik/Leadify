/**
 * Confirmation step for a case-handler or retention-handler reassignment.
 *
 * Replaces the browser `confirm()` the bulk assign used to show, and does the job that dialog could
 * not: list the leads about to change hands, resolve the client address each notification would go
 * to, and say which of them will carry a department manager block. Most departments have no manager,
 * so without that column the omission would only be discoverable by reading a sent email.
 *
 * The checkboxes govern email only. Every lead listed is reassigned either way, which is what the
 * "Don't send email" button already implies.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  buildReassignNotifyPreview,
  defaultNotifyLanguage,
  type ReassignNotifyLanguage,
  type ReassignNotifyLead,
  type ReassignNotifyPreviewRow,
  type ReassignNotifyRole,
} from '../../lib/reassignNotificationEmail';

type Props = {
  role: ReassignNotifyRole;
  /** The employee being assigned, shown so the user can confirm before any client hears about it. */
  newEmployeeName: string;
  leads: ReassignNotifyLead[];
  busy: boolean;
  /** Set while emails are going out, which happens one at a time. */
  progress: { done: number; total: number } | null;
  onCancel: () => void;
  onAssignAndEmail: (options: {
    language: ReassignNotifyLanguage;
    emailLeadIds: string[];
  }) => void;
  onAssignOnly: () => void;
};

const ROLE_LABEL: Record<ReassignNotifyRole, string> = {
  handler: 'case handler',
  retainer_handler: 'retention handler',
};

const ReassignNotifyEmailModal: React.FC<Props> = ({
  role,
  newEmployeeName,
  leads,
  busy,
  progress,
  onCancel,
  onAssignAndEmail,
  onAssignOnly,
}) => {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(leads.map((l) => l.id)));
  const [language, setLanguage] = useState<ReassignNotifyLanguage>(() =>
    defaultNotifyLanguage(leads),
  );
  const [preview, setPreview] = useState<Map<string, ReassignNotifyPreviewRow> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    buildReassignNotifyPreview(leads)
      .then((rows) => {
        if (!cancelled) setPreview(rows);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Reassign notification preview failed:', error);
          setPreviewError('Could not look up client addresses. You can still assign without email.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [leads]);

  const toggle = (leadId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  /*
   * Only leads with an address can actually be emailed, so they are what the send button acts on and
   * counts. A lead with no address stays listed and stays checked — it is still being reassigned.
   */
  const sendableIds = useMemo(
    () => leads.filter((lead) => preview?.get(lead.id)?.clientEmail).map((lead) => lead.id),
    [leads, preview],
  );
  const toEmail = useMemo(
    () => sendableIds.filter((id) => selected.has(id)),
    [sendableIds, selected],
  );
  const missingEmailCount = leads.length - sendableIds.length;
  const allSendableSelected = sendableIds.length > 0 && toEmail.length === sendableIds.length;

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSendableSelected) sendableIds.forEach((id) => next.delete(id));
      else sendableIds.forEach((id) => next.add(id));
      return next;
    });
  };

  return (
    <dialog open className="modal modal-open z-[10050]">
      <div className="modal-box max-w-4xl w-full">
        <h3 className="text-lg font-bold">
          Assign {newEmployeeName} as {ROLE_LABEL[role]}
        </h3>
        <p className="mt-1 text-sm text-base-content/70">
          {leads.length} lead{leads.length === 1 ? '' : 's'} will be reassigned. Choose which clients
          should be told by email — unticking a row does not cancel its reassignment.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Email language:</span>
          <div className="join">
            {(['en', 'he'] as ReassignNotifyLanguage[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`btn btn-sm join-item ${language === option ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setLanguage(option)}
                disabled={busy}
              >
                {option === 'en' ? 'English' : 'Hebrew'}
              </button>
            ))}
          </div>
        </div>

        {previewError && (
          <div className="alert alert-warning mt-3 py-2 text-sm">
            <span>{previewError}</span>
          </div>
        )}

        <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-base-300">
          <table className="table table-sm table-pin-rows">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={allSendableSelected}
                    onChange={toggleAll}
                    disabled={busy || sendableIds.length === 0}
                    aria-label="Select all leads with an email address"
                  />
                </th>
                <th>Lead</th>
                <th>Client</th>
                <th>Email</th>
                <th>Department manager</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const row = preview?.get(lead.id);
                const hasEmail = Boolean(row?.clientEmail);
                return (
                  <tr key={lead.id} className={preview && !hasEmail ? 'opacity-60' : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={selected.has(lead.id)}
                        onChange={() => toggle(lead.id)}
                        disabled={busy || (Boolean(preview) && !hasEmail)}
                        aria-label={`Email the client on lead ${lead.leadNumber}`}
                      />
                    </td>
                    <td className="whitespace-nowrap font-medium">{lead.leadNumber}</td>
                    <td className="max-w-[12rem] truncate">{lead.name || '—'}</td>
                    <td className="max-w-[14rem] truncate text-xs">
                      {!preview ? (
                        <span className="text-base-content/40">Looking up…</span>
                      ) : hasEmail ? (
                        row?.clientEmail
                      ) : (
                        <span className="text-warning">No email on file</span>
                      )}
                    </td>
                    <td className="max-w-[12rem] truncate text-xs">
                      {!preview ? (
                        <span className="text-base-content/40">—</span>
                      ) : row?.departmentManagerName ? (
                        row.departmentManagerName
                      ) : (
                        <span className="text-base-content/50">None — section omitted</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-sm text-base-content/70">
          {progress ? (
            <span>
              Sending {progress.done} of {progress.total}…
            </span>
          ) : preview ? (
            <span>
              {toEmail.length} email{toEmail.length === 1 ? '' : 's'} will be sent from your Outlook
              mailbox.
              {missingEmailCount > 0 && (
                <>
                  {' '}
                  {missingEmailCount} lead{missingEmailCount === 1 ? ' has' : 's have'} no client
                  email and cannot be notified.
                </>
              )}
            </span>
          ) : (
            <span>Looking up client addresses…</span>
          )}
        </div>

        <div className="modal-action mt-3 flex-wrap gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={onAssignOnly}>
            Don&apos;t send email
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !preview || toEmail.length === 0}
            onClick={() => onAssignAndEmail({ language, emailLeadIds: toEmail })}
          >
            {busy ? (
              <>
                <span className="loading loading-spinner loading-sm" />
                Working…
              </>
            ) : (
              `Send email (${toEmail.length})`
            )}
          </button>
        </div>
      </div>
      <form
        method="dialog"
        className="modal-backdrop"
        onClick={() => {
          if (!busy) onCancel();
        }}
      >
        <button type="button">close</button>
      </form>
    </dialog>
  );
};

export default ReassignNotifyEmailModal;
