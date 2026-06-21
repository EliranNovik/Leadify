import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardDocumentIcon, LinkIcon, KeyIcon, XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useAuthContext } from '../../contexts/AuthContext';
import { buildPortalUrl } from '../../lib/portalApi';
import { portalStaffGetStatus, portalStaffSetPassword } from '../../lib/portalStaffApi';

type Props = {
  leadId: string;
  leadType?: string | null;
  leadNumber?: string | null;
  /** When set, controls modal visibility instead of the default trigger button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Show the inline "Client portal" button (default true). */
  showTrigger?: boolean;
};

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolvePortalLeadRef(leadId: string, leadType: string | null | undefined, leadNumber?: string | null): {
  leadRef: string;
  leadType: string;
  rpcLeadId: string;
} {
  const id = String(leadId || '').trim();
  const num = leadNumber?.trim();
  const isLegacy = leadType === 'legacy' || id.startsWith('legacy_');
  const rpcLeadId = isLegacy ? id.replace(/^legacy_/, '') : id;
  const resolvedType = leadType || (isLegacy ? 'legacy' : UUID_RE.test(rpcLeadId) ? 'new' : 'auto');

  if (num) {
    return { leadRef: num, leadType: resolvedType, rpcLeadId: rpcLeadId || num };
  }
  if (isLegacy) {
    return { leadRef: rpcLeadId, leadType: 'legacy', rpcLeadId };
  }
  if (UUID_RE.test(rpcLeadId)) {
    return { leadRef: rpcLeadId, leadType: resolvedType, rpcLeadId };
  }
  return { leadRef: rpcLeadId, leadType: resolvedType, rpcLeadId };
}

const ClientPortalAdminCard: React.FC<Props> = ({
  leadId,
  leadType,
  leadNumber,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}) => {
  const { supabaseSessionReady } = useAuthContext();
  const { leadRef: portalLeadRef, leadType: portalLeadType, rpcLeadId } = resolvePortalLeadRef(
    leadId,
    leadType,
    leadNumber,
  );
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [enabled, setEnabled] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);
  const [storedPassword, setStoredPassword] = useState<string | null>(null);
  const [leadRef, setLeadRef] = useState<string | null>(leadNumber ?? portalLeadRef ?? null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = await portalStaffGetStatus(rpcLeadId, portalLeadType, leadNumber || portalLeadRef);
      setEnabled(status.has_password ? !!status.enabled : true);
      setHasPassword(!!status.has_password);
      setStoredPassword(status.password_plain?.trim() || null);
      setLeadRef(status.lead_ref || leadNumber || portalLeadRef);
    } catch (e) {
      console.error('portal status', e);
      toast.error(e instanceof Error ? e.message : 'Failed to load portal status');
    } finally {
      setLoading(false);
    }
  }, [portalLeadRef, portalLeadType, leadNumber, rpcLeadId]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const close = () => {
    setOpen(false);
    setPassword('');
  };

  const displayPassword = password.trim() || storedPassword || '';

  const portalUrl = leadRef ? buildPortalUrl(leadRef) : '';

  const handleSave = async () => {
    const trimmedPwd = password.trim();
    const isNewSetup = !hasPassword;

    if (!supabaseSessionReady) {
      toast.error('Still connecting — wait a moment and try again');
      return;
    }

    if (isNewSetup && !trimmedPwd) {
      toast.error('Set a portal password before saving');
      return;
    }

    if (trimmedPwd && trimmedPwd.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setSaving(true);
    try {
      const pwdToSave = trimmedPwd || null;
      const result = await portalStaffSetPassword(rpcLeadId, portalLeadType, {
        password: pwdToSave,
        enabled: enabled !== false,
        leadNumber: leadNumber || portalLeadRef,
      });
      if (pwdToSave) {
        setStoredPassword(pwdToSave);
        setPassword('');
        setHasPassword(true);
      }
      setEnabled(result.enabled !== false);
      if (leadNumber || portalLeadRef) {
        setLeadRef(leadNumber || portalLeadRef);
      }
      toast.success(
        pwdToSave ? 'Client portal password saved' : 'Client portal settings saved',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!portalUrl) return;
    await navigator.clipboard.writeText(portalUrl);
    toast.success('Portal link copied');
  };

  const copyPassword = async () => {
    if (!displayPassword) {
      toast.error('No password on file — set and save a password first');
      return;
    }
    await navigator.clipboard.writeText(displayPassword);
    toast.success('Password copied');
  };

  return (
    <>
      {showTrigger ? (
        <button
          type="button"
          className="btn btn-outline btn-sm gap-2 shrink-0"
          onClick={() => setOpen(true)}
        >
          <LinkIcon className="w-4 h-4" />
          Client portal
        </button>
      ) : null}

      {open && (
        <dialog open className="modal modal-open z-[100]">
          <div className="modal-box max-w-lg">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                  <LinkIcon className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900">Client portal</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Password-protected link for contacts to view case info, pay invoices, and upload documents.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-circle btn-ghost shrink-0"
                onClick={close}
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-10">
                <span className="loading loading-spinner loading-md" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-sm"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />
                    <span className="text-sm text-gray-700">Portal enabled</span>
                  </label>
                  {hasPassword && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-sm badge-ghost">Password set</span>
                      {displayPassword ? (
                        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1">
                          <code className="text-sm font-mono text-gray-800">{displayPassword}</code>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-square"
                            onClick={copyPassword}
                            title="Copy password"
                          >
                            <ClipboardDocumentIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">
                          Not on file — save a new password to store it
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {!enabled && hasPassword && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    Portal is disabled — clients cannot sign in until you turn it back on.
                  </p>
                )}

                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Portal password
                  </label>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text"
                      className="input input-bordered input-sm flex-1 font-mono"
                      placeholder={hasPassword ? 'Leave blank to keep current password' : 'Min 6 characters'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setPassword(randomPassword())}
                      title="Generate password"
                    >
                      <KeyIcon className="w-4 h-4" />
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={copyPassword}>
                      <ClipboardDocumentIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {portalUrl && (
                  <div className="text-sm text-gray-600 break-all bg-gray-50 rounded-lg px-3 py-2">
                    {portalUrl}
                  </div>
                )}

                <div className="modal-action mt-6 px-0">
                  <button type="button" className="btn btn-ghost" onClick={close}>
                    Close
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={copyLink} disabled={!portalUrl}>
                    Copy link
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={handleSave}>
                    {saving ? 'Saving…' : 'Save portal settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={close}>
              close
            </button>
          </form>
        </dialog>
      )}
    </>
  );
};

export default ClientPortalAdminCard;
