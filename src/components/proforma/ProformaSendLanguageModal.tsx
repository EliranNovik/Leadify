import React, { useEffect, useState } from 'react';
import type { ProformaSendLanguage } from '../../lib/proformaSendLanguage';

interface ProformaSendLanguageModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (language: ProformaSendLanguage) => void;
  sending?: boolean;
  contactLabel?: string;
  title?: string;
  description?: string;
  confirmLabel?: string;
}

const ProformaSendLanguageModal: React.FC<ProformaSendLanguageModalProps> = ({
  open,
  onClose,
  onConfirm,
  sending = false,
  contactLabel,
  title = 'Send invoice',
  description,
  confirmLabel = 'Send invoice',
}) => {
  const [language, setLanguage] = useState<ProformaSendLanguage>('en');

  useEffect(() => {
    if (open) setLanguage('en');
  }, [open]);

  if (!open) return null;

  return (
    <dialog open className="modal modal-open z-[100]">
      <div className="modal-box max-w-md">
        <h3 className="font-bold text-lg text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600 mt-1">
          {description ?? (
            <>
              Choose the language for the email and WhatsApp message
              {contactLabel ? (
                <>
                  {' '}
                  to <span className="font-medium text-gray-800">{contactLabel}</span>
                </>
              ) : (
                '.'
              )}
            </>
          )}
        </p>

        <div className="mt-4 space-y-2">
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${
              language === 'en'
                ? 'border-primary bg-primary/5'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="proforma-send-lang"
              className="radio radio-primary"
              checked={language === 'en'}
              disabled={sending}
              onChange={() => setLanguage('en')}
            />
            <span className="font-semibold text-gray-900">English</span>
          </label>

          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${
              language === 'he'
                ? 'border-primary bg-primary/5'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="proforma-send-lang"
              className="radio radio-primary"
              checked={language === 'he'}
              disabled={sending}
              onChange={() => setLanguage('he')}
            />
            <span className="font-semibold text-gray-900">עברית</span>
          </label>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary gap-2"
            disabled={sending}
            onClick={() => onConfirm(language)}
          >
            {sending ? (
              <>
                <span className="loading loading-spinner loading-xs" />
                Sending…
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop bg-black/40">
        <button type="button" onClick={onClose} disabled={sending} aria-label="Close">
          close
        </button>
      </form>
    </dialog>
  );
};

export default ProformaSendLanguageModal;
