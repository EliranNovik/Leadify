import React from 'react';
import {
  PaperAirplaneIcon,
  PencilSquareIcon,
  PrinterIcon,
  ShareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

export type ProformaViewActionButtonsProps = {
  onEdit: () => void;
  onPrint: () => void;
  onSend: () => void;
  onShare: () => void;
  onDelete: () => void;
  sending?: boolean;
  sharing?: boolean;
  editTitle?: string;
  sendTitle?: string;
};

const iconClass = 'h-4 w-4 shrink-0';

const ProformaViewActionButtons: React.FC<ProformaViewActionButtonsProps> = ({
  onEdit,
  onPrint,
  onSend,
  onShare,
  onDelete,
  sending = false,
  sharing = false,
  editTitle = 'Edit proforma',
  sendTitle = 'Send invoice to the linked contact by email (Outlook) and WhatsApp',
}) => (
  <div className="flex shrink-0 items-center gap-3">
    <button
      type="button"
      className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      onClick={onEdit}
      title={editTitle}
    >
      <PencilSquareIcon className={iconClass} />
      Edit
    </button>

    <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        className="inline-flex h-10 items-center gap-2 rounded-l-xl px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
        onClick={onPrint}
        title="Print"
      >
        <PrinterIcon className={iconClass} />
        Print
      </button>

      <div className="h-6 w-px bg-slate-200" aria-hidden />

      <button
        type="button"
        className="inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        onClick={onSend}
        disabled={sending}
        title={sendTitle}
      >
        {sending ? (
          <span className="loading loading-spinner loading-xs text-slate-600" />
        ) : (
          <PaperAirplaneIcon className={iconClass} />
        )}
        Send
      </button>

      <div className="h-6 w-px bg-slate-200" aria-hidden />

      <button
        type="button"
        className="inline-flex h-10 items-center gap-2 rounded-r-xl px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        onClick={onShare}
        disabled={sharing}
        title="Share link with client"
      >
        {sharing ? (
          <span className="loading loading-spinner loading-xs text-slate-600" />
        ) : (
          <ShareIcon className={iconClass} />
        )}
        Share
      </button>
    </div>

    <button
      type="button"
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 active:scale-[0.98]"
      onClick={onDelete}
      title="Delete"
    >
      <TrashIcon className={iconClass} />
      Delete
    </button>
  </div>
);

export default ProformaViewActionButtons;
