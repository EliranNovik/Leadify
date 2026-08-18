import React, { useEffect, useMemo, useState } from 'react';
import {
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import MobileBottomSheet from './MobileBottomSheet';
import type { ContactInfo } from '../lib/contactHelpers';
import { pickWhatsAppPhoneFromContactFields } from '../lib/whatsappPhone';
import {
  previewContractSendTemplates,
  type ContractSendChannel,
  type ContractSendLanguage,
  type ContractSendRecipient,
} from '../lib/contractSend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s().-]{6,20}$/;

type ContractSendDrawerProps = {
  open: boolean;
  onClose: () => void;
  contacts: ContactInfo[];
  loadingContacts: boolean;
  sending: boolean;
  onSend: (opts: {
    language: ContractSendLanguage;
    channels: ContractSendChannel[];
    recipients: ContractSendRecipient[];
  }) => void;
};

const ContractSendDrawer: React.FC<ContractSendDrawerProps> = ({
  open,
  onClose,
  contacts,
  loadingContacts,
  sending,
  onSend,
}) => {
  const [language, setLanguage] = useState<ContractSendLanguage>('en');
  const [whatsappOn, setWhatsappOn] = useState(true);
  const [emailOn, setEmailOn] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPhone, setCustomPhone] = useState('');
  const [customEmail, setCustomEmail] = useState('');
  const [templatePreview, setTemplatePreview] = useState<{
    whatsappName: string | null;
    emailName: string | null;
    whatsappError: string | null;
    emailError: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLanguage('en');
    setWhatsappOn(true);
    setEmailOn(true);
    setCustomOpen(false);
    setCustomName('');
    setCustomPhone('');
    setCustomEmail('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (contacts.length > 0) {
      const main = contacts.find((c) => c.isMain) || contacts[0];
      setSelectedIds([main.id]);
    } else {
      setSelectedIds([]);
      setCustomOpen(true);
    }
  }, [open, contacts]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTemplatePreview(null);
    void previewContractSendTemplates(language)
      .then((preview) => {
        if (!cancelled) setTemplatePreview(preview);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTemplatePreview({
            whatsappName: null,
            emailName: null,
            whatsappError: error instanceof Error ? error.message : 'Could not load templates',
            emailError: error instanceof Error ? error.message : 'Could not load templates',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, language]);

  const customValid = useMemo(() => {
    if (!customOpen) return true;
    const phoneOk = !customPhone.trim() || PHONE_RE.test(customPhone.trim());
    const emailOk = !customEmail.trim() || EMAIL_RE.test(customEmail.trim());
    const hasDest =
      (whatsappOn && Boolean(customPhone.trim())) || (emailOn && Boolean(customEmail.trim()));
    return phoneOk && emailOk && hasDest;
  }, [customOpen, customPhone, customEmail, whatsappOn, emailOn]);

  const channelError =
    (whatsappOn ? templatePreview?.whatsappError : null) ||
    (emailOn ? templatePreview?.emailError : null) ||
    null;

  const canSend =
    (whatsappOn || emailOn) &&
    (selectedIds.length > 0 || (customOpen && customValid)) &&
    !sending &&
    Boolean(templatePreview) &&
    !channelError;

  const toggleContact = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSend = () => {
    const recipients: ContractSendRecipient[] = contacts
      .filter((c) => selectedIds.includes(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        mobile: c.mobile,
      }));
    if (customOpen && customValid) {
      recipients.push({
        id: null,
        name: customName.trim() || 'Recipient',
        email: customEmail.trim() || null,
        phone: customPhone.trim() || null,
        mobile: null,
      });
    }
    const channels: ContractSendChannel[] = [];
    if (whatsappOn) channels.push('whatsapp');
    if (emailOn) channels.push('email');
    onSend({ language, channels, recipients });
  };

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="Send contract"
      subtitle="WhatsApp and email templates"
      desktopLayout="drawer-right"
      mobileFullHeight
      zIndex={72}
      sheetClassName="print-hide md:max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-sm border-0 bg-gray-900 text-white hover:bg-black"
            onClick={handleSend}
            disabled={!canSend}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      }
    >
      <div className="space-y-5 px-1 pb-4">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
            Language
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(['en', 'he'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${
                  language === code
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-[#EAECF0] bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {code === 'he' ? 'Hebrew' : 'English'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
            Send via
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setWhatsappOn((v) => !v)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                whatsappOn
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-[#EAECF0] bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <ChatBubbleLeftRightIcon className="h-4 w-4" />
              WhatsApp
            </button>
            <button
              type="button"
              onClick={() => setEmailOn((v) => !v)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                emailOn
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-[#EAECF0] bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <EnvelopeIcon className="h-4 w-4" />
              Email
            </button>
          </div>
          {channelError ? (
            <p className="mt-2 text-xs text-rose-600">{channelError}</p>
          ) : templatePreview ? (
            <p className="mt-2 text-xs text-gray-500">
              {[
                whatsappOn && templatePreview.whatsappName
                  ? `WhatsApp: ${templatePreview.whatsappName}`
                  : null,
                emailOn && templatePreview.emailName
                  ? `Email: ${templatePreview.emailName}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : (
            <p className="mt-2 text-xs text-gray-400">Looking up templates…</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
            To
          </p>
          {loadingContacts ? (
            <div className="flex justify-center py-6">
              <span className="loading loading-spinner loading-sm" />
            </div>
          ) : (
            <div className="space-y-2">
              {contacts.map((contact) => {
                const phone = pickWhatsAppPhoneFromContactFields(contact.phone, contact.mobile);
                const email = contact.email?.trim() || '';
                return (
                  <label
                    key={contact.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${
                      selectedIds.includes(contact.id)
                        ? 'border-gray-900 bg-gray-50'
                        : 'border-[#EAECF0]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm mt-0.5"
                      checked={selectedIds.includes(contact.id)}
                      onChange={() => toggleContact(contact.id)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">
                        {contact.name}
                        {contact.isMain ? (
                          <span className="ml-1 text-[10px] font-normal uppercase text-gray-400">
                            Main
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {[phone, email].filter(Boolean).join(' · ') || 'No phone or email'}
                      </span>
                    </span>
                  </label>
                );
              })}
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${
                  customOpen ? 'border-gray-900 bg-gray-50' : 'border-[#EAECF0]'
                }`}
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm mt-0.5"
                  checked={customOpen}
                  onChange={(e) => setCustomOpen(e.target.checked)}
                />
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="block text-sm font-medium text-gray-900">
                    Enter another number or email
                  </span>
                  {customOpen ? (
                    <>
                      <input
                        type="text"
                        className="input input-bordered input-sm w-full"
                        placeholder="Name (optional)"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                      />
                      {whatsappOn ? (
                        <input
                          type="tel"
                          className="input input-bordered input-sm w-full"
                          placeholder="+972…"
                          value={customPhone}
                          onChange={(e) => setCustomPhone(e.target.value)}
                        />
                      ) : null}
                      {emailOn ? (
                        <input
                          type="email"
                          className="input input-bordered input-sm w-full"
                          placeholder="name@example.com"
                          value={customEmail}
                          onChange={(e) => setCustomEmail(e.target.value)}
                        />
                      ) : null}
                    </>
                  ) : null}
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </MobileBottomSheet>
  );
};

export default ContractSendDrawer;
