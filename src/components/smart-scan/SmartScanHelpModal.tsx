import { useEffect, useState } from 'react';
import { CheckIcon, ClipboardIcon, XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { SCAN_CENTER_EMAIL } from '../../lib/smartScan/scanCenterInbox';

const HELP_ICON = '/smart-scan/smart-scan-help-icon.png';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SmartScanHelpModal({ open, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(SCAN_CENTER_EMAIL);
      setCopied(true);
      toast.success('Scan address copied');
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not copy the address');
    }
  };

  return (
    <div className="modal modal-open z-[80]">
      <div className="modal-box max-h-[85vh] max-w-lg overflow-y-auto p-0">
        <div className="flex items-start justify-between gap-3 px-6 pt-5">
          <h3 id="smart-scan-help-title" className="text-lg font-semibold text-gray-900">
            How Smart Scan works
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 pb-2 pt-1 text-center">
          <img
            src={HELP_ICON}
            alt=""
            className="mx-auto h-36 w-36 rounded-[1.75rem] object-cover shadow-sm ring-1 ring-gray-100"
          />
        </div>

        <div className="space-y-4 px-6 pb-5 text-sm text-gray-700">
          <section className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Where to scan</p>
            <p className="mt-1">Send the scan from the office scanner to this mailbox:</p>
            <button
              type="button"
              className="mt-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900"
              onClick={() => void copyAddress()}
            >
              <span className="truncate">{SCAN_CENTER_EMAIL}</span>
              {copied ? <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600" /> : <ClipboardIcon className="h-4 w-4 shrink-0 text-gray-400" />}
            </button>
          </section>

          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">How to scan</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Place passports, IDs, or case documents on the scanner.</li>
              <li>Scan as PDF or image. You can include several pages in one file.</li>
              <li>Choose email send and use the Scan Center address above as the destination.</li>
              <li>The file appears here after it arrives in that mailbox. Press Refresh if it is not listed yet.</li>
            </ol>
          </section>

          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">How to use this page</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Click a row to preview the document. AI suggests a lead when it can; you still have to approve it.</li>
              <li>Approve an AI match or assign a lead yourself. That saves the file to Sequence of Events on the lead.</li>
              <li>Delete a document if it should leave the queue and not come back.</li>
            </ol>
          </section>
        </div>

        <div className="modal-action border-t border-gray-100 px-6 py-3">
          <button type="button" className="btn btn-primary rounded-xl" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop bg-black/50" onClick={onClose} aria-label="Close dialog" />
    </div>
  );
}
