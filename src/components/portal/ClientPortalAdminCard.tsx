import React, { useCallback, useEffect, useState } from 'react';
import {
  ClipboardDocumentIcon,
  LinkIcon,
  KeyIcon,
  PaperAirplaneIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useAuthContext } from '../../contexts/AuthContext';
import { buildPortalUrl } from '../../lib/portalApi';
import { portalStaffGetStatus, portalStaffSetPassword } from '../../lib/portalStaffApi';
import { getMailboxLoginUrl } from '../../lib/mailboxApi';
import {
  loadPortalSendContacts,
  sendPortalAccessCode,
  type PortalSendCodeLanguage,
} from '../../lib/portalSendCode';
import type { ContactInfo } from '../../lib/contactHelpers';
import { supabase } from '../../lib/supabase';
import MobileBottomSheet from '../MobileBottomSheet';
import EditFieldModal, {
  EDIT_FIELD_INPUT,
  EditFieldLabel,
} from '../EditFieldModal';
import {
  MeetingFormDrawerActionButton,
  MeetingFormDrawerFooter,
} from '../meeting/MeetingFormDrawerSheet';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

const PORTAL_DRAWER_Z = 320;
const SEND_CODE_DRAWER_Z = 330;

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
  const isLegacyLead = portalLeadType === 'legacy' || String(leadId).startsWith('legacy_');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [enabled, setEnabled] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);
  const [storedPassword, setStoredPassword] = useState<string | null>(null);
  const [leadRef, setLeadRef] = useState<string | null>(leadNumber ?? portalLeadRef ?? null);
  const [password, setPassword] = useState('');
  const [passwordFieldOpen, setPasswordFieldOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [sendCodeOpen, setSendCodeOpen] = useState(false);
  const [sendCodeStep, setSendCodeStep] = useState<'language' | 'contacts'>('language');
  const [sendLanguage, setSendLanguage] = useState<PortalSendCodeLanguage>('en');
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [contactsExpanded, setContactsExpanded] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
  const [sendingCode, setSendingCode] = useState(false);
  const [addFieldModal, setAddFieldModal] = useState<{
    contact: ContactInfo;
    field: 'email' | 'phone';
  } | null>(null);
  const [addFieldValue, setAddFieldValue] = useState('');
  const [savingContactField, setSavingContactField] = useState(false);

  const CONTACTS_PREVIEW_COUNT = 3;

  const load = useCallback(async () => {
    setLoading(true);
    setContactsLoading(true);
    setContactsExpanded(false);
    try {
      const [status, contactRows] = await Promise.all([
        portalStaffGetStatus(rpcLeadId, portalLeadType, leadNumber || portalLeadRef),
        loadPortalSendContacts(rpcLeadId, isLegacyLead),
      ]);
      setEnabled(status.has_password ? !!status.enabled : true);
      setHasPassword(!!status.has_password);
      setStoredPassword(status.password_plain?.trim() || null);
      setLeadRef(status.lead_ref || leadNumber || portalLeadRef);
      setPasswordFieldOpen(!status.has_password);
      setPassword('');
      setContacts(contactRows);
    } catch (e) {
      console.error('portal status', e);
      toast.error(e instanceof Error ? e.message : 'Failed to load portal status');
      setContacts([]);
    } finally {
      setLoading(false);
      setContactsLoading(false);
    }
  }, [portalLeadRef, portalLeadType, leadNumber, rpcLeadId, isLegacyLead]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const close = () => {
    setOpen(false);
    setPassword('');
    setPasswordFieldOpen(false);
    setContactsExpanded(false);
    setAddFieldModal(null);
    setAddFieldValue('');
    setSendCodeOpen(false);
    setSendCodeStep('language');
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
        setPasswordFieldOpen(false);
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

  const applyGeneratedPassword = async (nextPassword: string) => {
    setPasswordFieldOpen(true);
    setPassword(nextPassword);

    if (!hasPassword) {
      return;
    }

    if (!supabaseSessionReady) {
      toast.error('Still connecting — wait a moment and try again');
      return;
    }

    setSaving(true);
    try {
      const result = await portalStaffSetPassword(rpcLeadId, portalLeadType, {
        password: nextPassword,
        enabled: enabled !== false,
        leadNumber: leadNumber || portalLeadRef,
      });
      setStoredPassword(nextPassword);
      setPassword('');
      setHasPassword(true);
      setPasswordFieldOpen(false);
      setEnabled(result.enabled !== false);
      toast.success('Portal password updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePassword = () => {
    if (hasPassword) {
      const confirmed = window.confirm(
        'Generate a new portal password? The current password will change immediately and contacts will need the new code to sign in.',
      );
      if (!confirmed) return;
    }
    void applyGeneratedPassword(randomPassword());
  };

  const openAddContactFieldModal = (contact: ContactInfo, field: 'email' | 'phone') => {
    setAddFieldModal({ contact, field });
    setAddFieldValue('');
  };

  const closeAddContactFieldModal = () => {
    if (savingContactField) return;
    setAddFieldModal(null);
    setAddFieldValue('');
  };

  const copyText = async (value: string, label: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error(`No ${label} to copy`);
      return;
    }
    await navigator.clipboard.writeText(trimmed);
    toast.success(`${label} copied`);
  };

  const contactPhone = (contact: ContactInfo) =>
    contact.mobile?.trim() || contact.phone?.trim() || '';

  const handleSaveContactField = async () => {
    if (!addFieldModal) return;
    const trimmed = addFieldValue.trim();
    if (!trimmed) {
      toast.error(
        addFieldModal.field === 'email'
          ? 'Enter a valid email address'
          : 'Enter a phone number',
      );
      return;
    }
    if (addFieldModal.field === 'email' && !emailRegex.test(trimmed)) {
      toast.error('Enter a valid email address');
      return;
    }

    setSavingContactField(true);
    try {
      const payload =
        addFieldModal.field === 'email'
          ? { email: trimmed, udate: new Date().toISOString().split('T')[0] }
          : {
              mobile: trimmed,
              udate: new Date().toISOString().split('T')[0],
            };

      const { error } = await supabase
        .from('leads_contact')
        .update(payload)
        .eq('id', addFieldModal.contact.id);

      if (error) throw error;

      setContacts((prev) =>
        prev.map((c) => {
          if (c.id !== addFieldModal.contact.id) return c;
          return addFieldModal.field === 'email'
            ? { ...c, email: trimmed }
            : { ...c, mobile: trimmed };
        }),
      );
      toast.success(addFieldModal.field === 'email' ? 'Email saved' : 'Phone saved');
      setAddFieldModal(null);
      setAddFieldValue('');
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : addFieldModal.field === 'email'
            ? 'Failed to save email'
            : 'Failed to save phone',
      );
    } finally {
      setSavingContactField(false);
    }
  };

  const openSendCodeModal = () => {
    if (!displayPassword) {
      toast.error('Set and save a portal password before sending the access code');
      return;
    }
    if (!portalUrl) {
      toast.error('Portal link is not available yet');
      return;
    }

    setSendLanguage('en');
    setSendCodeStep('language');
    setSendCodeOpen(true);
    setSelectedContactIds(new Set());
  };

  const loadContactsForSend = async () => {
    setSelectedContactIds(new Set());
    if (contacts.length > 0) {
      const main = contacts.find((c) => c.isMain) || contacts[0];
      if (main) {
        setSelectedContactIds(new Set([main.id]));
      }
      return;
    }

    setContactsLoading(true);
    try {
      const rows = await loadPortalSendContacts(rpcLeadId, isLegacyLead);
      setContacts(rows);
      const main = rows.find((c) => c.isMain) || rows[0];
      if (main) {
        setSelectedContactIds(new Set([main.id]));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load contacts');
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  };

  const chooseSendLanguage = async (language: PortalSendCodeLanguage) => {
    setSendLanguage(language);
    setSendCodeStep('contacts');
    await loadContactsForSend();
  };

  const closeSendCodeFlow = () => {
    setSendCodeOpen(false);
    setSendCodeStep('language');
  };

  const toggleContact = (id: number) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllContacts = () => {
    setSelectedContactIds(new Set(contacts.map((c) => c.id)));
  };

  const clearContactSelection = () => {
    setSelectedContactIds(new Set());
  };

  const handleSendCode = async () => {
    if (!displayPassword || !portalUrl) {
      toast.error('Portal password and link are required');
      return;
    }
    const chosen = contacts.filter((c) => selectedContactIds.has(c.id));
    if (!chosen.length) {
      toast.error('Select at least one contact');
      return;
    }

    setSendingCode(true);
    try {
      const result = await sendPortalAccessCode({
        leadId: rpcLeadId,
        isLegacyLead,
        leadNumber: leadNumber || leadRef,
        portalLink: portalUrl,
        accessCode: displayPassword,
        contacts: chosen,
        language: sendLanguage,
      });

      if (result.failed === 0 && (result.whatsappSent > 0 || result.emailSent > 0)) {
        toast.success(
          `Sent: ${result.whatsappSent} WhatsApp, ${result.emailSent} email` +
            (result.skipped ? ` (${result.skipped} skipped — missing phone/email)` : ''),
        );
        closeSendCodeFlow();
        return;
      }

      if (result.whatsappSent > 0 || result.emailSent > 0) {
        const firstError = result.results.find((r) => !r.ok && !r.skipped)?.error;
        toast.error(
          `Partial send — WA ${result.whatsappSent}, email ${result.emailSent}, failed ${result.failed}` +
            (firstError ? `: ${firstError}` : ''),
        );
        return;
      }

      const firstError = result.results.find((r) => !r.ok && !r.skipped)?.error;
      toast.error(firstError || 'Nothing was sent — contacts may be missing phone or email');
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err?.code === 'MAILBOX_NOT_CONNECTED' || err?.message === 'MAILBOX_NOT_CONNECTED') {
        toast.error('Connect your mailbox to send portal emails');
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user?.id) {
            const url = await getMailboxLoginUrl(user.id, window.location.href);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          }
        } catch {
          /* ignore */
        }
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Failed to send access code');
    } finally {
      setSendingCode(false);
    }
  };

  const portalTitle = (
    <span className="inline-flex items-center gap-2.5">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50">
        <LinkIcon className="h-6 w-6 text-indigo-600" />
      </span>
      Client portal
    </span>
  );

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

      <MobileBottomSheet
        open={open}
        onClose={close}
        title={portalTitle}
        mobileFullHeight
        desktopLayout="drawer-right"
        zIndex={PORTAL_DRAWER_Z}
        sheetClassName="md:max-w-md"
        contentClassName="px-4 py-4 md:px-6 md:py-5"
        footer={
          loading ? undefined : (
            <MeetingFormDrawerFooter>
              <MeetingFormDrawerActionButton
                className="gap-1 rounded-full border-0 bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-600 text-white shadow-md hover:from-emerald-500 hover:via-green-600 hover:to-emerald-700 hover:shadow-lg disabled:opacity-50 disabled:shadow-none"
                onClick={openSendCodeModal}
                disabled={!displayPassword || !portalUrl}
                title={
                  !displayPassword
                    ? 'Save a portal password first'
                    : 'Send portal link and access code via WhatsApp and email'
                }
              >
                <PaperAirplaneIcon className="w-4 h-4" />
                Send code
              </MeetingFormDrawerActionButton>
              <MeetingFormDrawerActionButton
                className="btn-primary rounded-full"
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? 'Saving…' : 'Save'}
              </MeetingFormDrawerActionButton>
            </MeetingFormDrawerFooter>
          )
        }
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="text-sm text-base-content">Portal enabled</span>
            </label>

            {!enabled && hasPassword && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Portal is disabled — clients cannot sign in until you turn it back on.
              </p>
            )}

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-base-content/55 uppercase tracking-wide">
                  Password
                </label>
                {hasPassword && displayPassword ? (
                  <div className="flex items-center gap-1 rounded-lg border border-base-200 bg-base-200/50 px-2 py-1.5 w-full mt-1">
                    <code className="text-sm font-mono text-base-content flex-1 truncate">
                      {displayPassword}
                    </code>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square shrink-0"
                      onClick={copyPassword}
                      title="Copy password"
                    >
                      <ClipboardDocumentIcon className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-base-content/50 mt-1">No password set</p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-base-content/55 uppercase tracking-wide">
                  Link
                </label>
                <div className="flex items-start gap-1 rounded-lg border border-base-200 bg-base-200/50 px-2 py-1.5 w-full mt-1">
                  <span className="text-sm text-base-content/80 break-all flex-1 min-w-0">
                    {portalUrl || '—'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square shrink-0"
                    onClick={copyLink}
                    disabled={!portalUrl}
                    title="Copy link"
                  >
                    <ClipboardDocumentIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-base-content/55 uppercase tracking-wide">
                Portal password
              </label>
              {passwordFieldOpen ? (
                <div className="flex flex-wrap gap-2 mt-1">
                  <input
                    type="text"
                    className="input input-bordered input-sm flex-1 min-w-[10rem] font-mono"
                    placeholder={hasPassword ? 'Leave blank to keep current password' : 'Min 6 characters'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-outline gap-1 shrink-0"
                    onClick={handleGeneratePassword}
                    disabled={saving}
                    title="Generate password"
                  >
                    <KeyIcon className="w-4 h-4" />
                    Generate password
                  </button>
                </div>
              ) : (
                <div className="mt-1">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline gap-1"
                    onClick={handleGeneratePassword}
                    disabled={saving}
                  >
                    <KeyIcon className="w-4 h-4" />
                    Generate password
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-base-content/55 uppercase tracking-wide inline-flex items-center gap-1.5">
                <UserGroupIcon className="w-4 h-4" />
                Contacts
              </label>
              {contactsLoading ? (
                <div className="flex justify-center py-4 mt-1">
                  <span className="loading loading-spinner loading-sm" />
                </div>
              ) : contacts.length === 0 ? (
                <p className="text-sm text-base-content/50 mt-1">No contacts found</p>
              ) : (
                <div className="mt-1 space-y-2">
                  <ul className="divide-y divide-base-200 border border-base-200 rounded-lg overflow-hidden">
                    {(contactsExpanded
                      ? contacts
                      : contacts.slice(0, CONTACTS_PREVIEW_COUNT)
                    ).map((contact) => {
                      const email = contact.email?.trim() || '';
                      const phone = contactPhone(contact);
                      return (
                        <li key={contact.id} className="px-3 py-3 space-y-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base font-medium text-base-content truncate">
                              {contact.name || `Contact #${contact.id}`}
                            </span>
                            {contact.isMain ? (
                              <span className="badge badge-sm badge-primary shrink-0">Main</span>
                            ) : null}
                          </div>

                          {email ? (
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="text-sm text-gray-500 truncate flex-1 min-w-0">
                                {email}
                              </span>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs btn-square shrink-0"
                                onClick={() => void copyText(email, 'Email')}
                                title="Copy email"
                              >
                                <ClipboardDocumentIcon className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="text-sm text-primary font-medium hover:underline"
                              onClick={() => openAddContactFieldModal(contact, 'email')}
                            >
                              Add email
                            </button>
                          )}

                          {phone ? (
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="text-sm text-gray-500 truncate flex-1 min-w-0">
                                {phone}
                              </span>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs btn-square shrink-0"
                                onClick={() => void copyText(phone, 'Phone')}
                                title="Copy phone"
                              >
                                <ClipboardDocumentIcon className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="text-sm text-primary font-medium hover:underline"
                              onClick={() => openAddContactFieldModal(contact, 'phone')}
                            >
                              Add phone
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {contacts.length > CONTACTS_PREVIEW_COUNT ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => setContactsExpanded((prev) => !prev)}
                    >
                      {contactsExpanded
                        ? 'Show less'
                        : `More (${contacts.length - CONTACTS_PREVIEW_COUNT})`}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}
      </MobileBottomSheet>

      <MobileBottomSheet
        open={sendCodeOpen}
        onClose={closeSendCodeFlow}
        title={sendCodeStep === 'language' ? 'Choose language' : 'Send access code'}
        subtitle={
          sendCodeStep === 'language'
            ? 'Select the language for WhatsApp and email templates.'
            : `Choose contacts (${sendLanguage === 'he' ? 'Hebrew' : 'English'} templates).`
        }
        mobileFullHeight
        desktopLayout="drawer-right"
        zIndex={SEND_CODE_DRAWER_Z}
        sheetClassName="md:max-w-md"
        contentClassName="px-4 py-4 md:px-6 md:py-5"
        closeOnOverlayClick={!sendingCode}
        footer={
          sendCodeStep === 'language' ? (
            <MeetingFormDrawerFooter>
              <MeetingFormDrawerActionButton className="btn-ghost" onClick={closeSendCodeFlow}>
                Cancel
              </MeetingFormDrawerActionButton>
            </MeetingFormDrawerFooter>
          ) : contactsLoading ? undefined : contacts.length === 0 ? (
            <MeetingFormDrawerFooter>
              <MeetingFormDrawerActionButton
                className="btn-ghost"
                onClick={() => setSendCodeStep('language')}
              >
                Back
              </MeetingFormDrawerActionButton>
              <MeetingFormDrawerActionButton className="btn-ghost" onClick={closeSendCodeFlow}>
                Cancel
              </MeetingFormDrawerActionButton>
            </MeetingFormDrawerFooter>
          ) : (
            <MeetingFormDrawerFooter>
              <MeetingFormDrawerActionButton
                className="btn-ghost"
                onClick={() => setSendCodeStep('language')}
                disabled={sendingCode}
              >
                Back
              </MeetingFormDrawerActionButton>
              <MeetingFormDrawerActionButton
                className="btn-ghost"
                onClick={closeSendCodeFlow}
                disabled={sendingCode}
              >
                Cancel
              </MeetingFormDrawerActionButton>
              <MeetingFormDrawerActionButton
                className="btn-primary gap-1"
                disabled={sendingCode || selectedContactIds.size === 0}
                onClick={handleSendCode}
              >
                {sendingCode ? (
                  <>
                    <span className="loading loading-spinner loading-xs" />
                    Sending…
                  </>
                ) : (
                  <>
                    <PaperAirplaneIcon className="w-4 h-4" />
                    Send
                  </>
                )}
              </MeetingFormDrawerActionButton>
            </MeetingFormDrawerFooter>
          )
        }
      >
        {sendCodeStep === 'language' ? (
          <div className="space-y-3">
            <button
              type="button"
              className="btn btn-outline w-full justify-start h-auto py-3 max-md:min-h-14"
              onClick={() => void chooseSendLanguage('en')}
            >
              <span className="text-left">
                <span className="block font-medium">English</span>
                <span className="block text-xs font-normal opacity-70">
                  WhatsApp template 50 · Email template 192
                </span>
              </span>
            </button>
            <button
              type="button"
              className="btn btn-outline w-full justify-start h-auto py-3 max-md:min-h-14"
              onClick={() => void chooseSendLanguage('he')}
            >
              <span className="text-left">
                <span className="block font-medium">עברית · Hebrew</span>
                <span className="block text-xs font-normal opacity-70">
                  WhatsApp template 49 · Email template 193
                </span>
              </span>
            </button>
          </div>
        ) : contactsLoading ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-base-content/55 py-6 text-center">No contacts found for this lead.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <button type="button" className="btn btn-ghost btn-xs" onClick={selectAllContacts}>
                Select all
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={clearContactSelection}>
                Clear
              </button>
            </div>
            <ul className="divide-y divide-base-200 border border-base-200 rounded-lg overflow-hidden">
              {contacts.map((contact) => {
                const phone = contact.mobile?.trim() || contact.phone?.trim() || '';
                const email = contact.email?.trim() || '';
                const checked = selectedContactIds.has(contact.id);
                return (
                  <li key={contact.id}>
                    <label className="flex items-start gap-3 px-3 py-3 cursor-pointer hover:bg-base-200/40 max-md:min-h-14">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm mt-0.5"
                        checked={checked}
                        onChange={() => toggleContact(contact.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-base-content truncate">
                          {contact.name || `Contact #${contact.id}`}
                        </span>
                        <span className="block text-xs text-base-content/55 truncate">
                          {[email || null, phone || null].filter(Boolean).join(' · ') ||
                            'No email or phone'}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </MobileBottomSheet>

      <EditFieldModal
        open={!!addFieldModal}
        onClose={closeAddContactFieldModal}
        title={addFieldModal?.field === 'phone' ? 'Add phone' : 'Add email'}
        subtitle={
          addFieldModal
            ? `For ${addFieldModal.contact.name || `Contact #${addFieldModal.contact.id}`}`
            : undefined
        }
        onSave={handleSaveContactField}
        saving={savingContactField}
        saveDisabled={!addFieldValue.trim()}
        saveLabel={addFieldModal?.field === 'phone' ? 'Save phone' : 'Save email'}
        zIndex={SEND_CODE_DRAWER_Z + 10}
      >
        <EditFieldLabel htmlFor="portal-add-contact-field">
          {addFieldModal?.field === 'phone' ? 'Phone' : 'Email'}
        </EditFieldLabel>
        <input
          id="portal-add-contact-field"
          type={addFieldModal?.field === 'phone' ? 'tel' : 'email'}
          className={EDIT_FIELD_INPUT}
          placeholder={
            addFieldModal?.field === 'phone' ? '+972…' : 'name@example.com'
          }
          value={addFieldValue}
          onChange={(e) => setAddFieldValue(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSaveContactField();
            }
          }}
        />
      </EditFieldModal>
    </>
  );
};

export default ClientPortalAdminCard;
