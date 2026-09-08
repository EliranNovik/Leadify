import React, { useEffect, useState } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import type { ProformaSendLanguage } from '../../lib/proformaSendLanguage';

const SEND_INVOICE_ICON = '/finance-icons/send-invoice.png';
const FINANCE_HANDOFF_ICON = '/finance-icons/finance-handoff.png';

type ChoiceStep = 'choice' | 'language';

interface SentToFinanceChoiceModalProps {
  open: boolean;
  onClose: () => void;
  sending?: boolean;
  contactLabel?: string;
  onChooseFinanceTeam: () => void;
  onSendInvoice: (language: ProformaSendLanguage) => void;
}

const SentToFinanceChoiceModal: React.FC<SentToFinanceChoiceModalProps> = ({
  open,
  onClose,
  sending = false,
  contactLabel,
  onChooseFinanceTeam,
  onSendInvoice,
}) => {
  const [step, setStep] = useState<ChoiceStep>('choice');
  const [language, setLanguage] = useState<ProformaSendLanguage>('en');

  useEffect(() => {
    if (open) {
      setStep('choice');
      setLanguage('en');
    }
  }, [open]);

  if (!open) return null;

  const contactSuffix = contactLabel ? (
    <>
      {' '}
      for <span className="font-medium text-gray-800">{contactLabel}</span>
    </>
  ) : null;

  return (
    <dialog open className="modal modal-open z-[100]">
      <div className="modal-box max-w-lg">
        {step === 'choice' ? (
          <>
            <h3 className="text-lg font-bold text-gray-900">Sent to finance</h3>
            <p className="mt-1 text-sm text-gray-600">
              Choose how this invoice should be handled{contactSuffix}.
            </p>

            <div className="mt-4 space-y-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-indigo-50/70 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={sending}
                onClick={() => setStep('language')}
              >
                <img
                  src={SEND_INVOICE_ICON}
                  alt=""
                  className="h-24 w-24 shrink-0 rounded-2xl object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900">Send invoice to the client</span>
                  <span className="mt-0.5 block text-sm text-gray-600">
                    Send automated invoice to client
                  </span>
                </span>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-sky-50/70"
                disabled={sending}
                onClick={onChooseFinanceTeam}
              >
                <img
                  src={FINANCE_HANDOFF_ICON}
                  alt=""
                  className="h-24 w-24 shrink-0 rounded-2xl object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900">I’m not sure — let finance handle it</span>
                  <span className="mt-0.5 block text-sm text-gray-600">
                    Use this if you weren’t involved in this payment plan or you’re unsure about the payment situation. The finance team will review and send the invoice.
                  </span>
                </span>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              </button>
            </div>

            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={sending}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-gray-900">Send invoice to the client</h3>
            <p className="mt-1 text-sm text-gray-600">
              Choose the language for the email and WhatsApp message{contactSuffix}.
            </p>

            <div className="mt-4 space-y-2">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${
                  language === 'en' ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="sent-to-finance-send-lang"
                  className="radio radio-primary"
                  checked={language === 'en'}
                  disabled={sending}
                  onChange={() => setLanguage('en')}
                />
                <span className="font-semibold text-gray-900">English</span>
              </label>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${
                  language === 'he' ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="sent-to-finance-send-lang"
                  className="radio radio-primary"
                  checked={language === 'he'}
                  disabled={sending}
                  onChange={() => setLanguage('he')}
                />
                <span className="font-semibold text-gray-900">עברית</span>
              </label>
            </div>

            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={sending}
                onClick={() => setStep('choice')}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary gap-2"
                disabled={sending}
                onClick={() => onSendInvoice(language)}
              >
                {sending ? (
                  <>
                    <span className="loading loading-spinner loading-xs" />
                    Sending…
                  </>
                ) : (
                  'Send invoice'
                )}
              </button>
            </div>
          </>
        )}
      </div>
      <form method="dialog" className="modal-backdrop bg-black/40">
        <button type="button" onClick={onClose} disabled={sending} aria-label="Close">
          close
        </button>
      </form>
    </dialog>
  );
};

export default SentToFinanceChoiceModal;
