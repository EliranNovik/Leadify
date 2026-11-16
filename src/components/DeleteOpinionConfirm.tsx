import React from 'react';

export const commentPreviewLine = (text: string): string => {
  const plain = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return 'Empty comment';
  const max = 90;
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max).trimEnd()}...`;
};

const previewDirection = (text: string): 'rtl' | 'ltr' => (
  /[\u0590-\u05FF]/.test(text) ? 'rtl' : 'ltr'
);

interface DeleteOpinionConfirmProps {
  open: boolean;
  preview: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const DeleteOpinionConfirm: React.FC<DeleteOpinionConfirmProps> = ({
  open,
  preview,
  busy = false,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;
  const direction = previewDirection(preview);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={busy ? undefined : onCancel}
      />
      <div className="relative w-full max-w-md rounded-2xl bg-base-100 p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-base-content">Delete this comment?</h3>
        <p
          className={`mt-3 truncate text-sm text-base-content/70 ${direction === 'rtl' ? 'text-right' : ''}`}
          dir={direction}
          title={preview}
        >
          {preview}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost rounded-full px-5"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn rounded-full border-none bg-red-600 px-5 text-white hover:bg-red-700"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Deleting...' : 'Delete comment'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteOpinionConfirm;
