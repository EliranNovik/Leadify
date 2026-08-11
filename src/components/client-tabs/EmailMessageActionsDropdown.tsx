import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ChatBubbleLeftEllipsisIcon,
  EllipsisVerticalIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

type Props = {
  onReply: () => void;
  onForward: () => void;
  onComment: () => void;
  onDelete: () => void;
  className?: string;
};

export function EmailMessageActionsDropdown({
  onReply,
  onForward,
  onComment,
  onDelete,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <EllipsisVerticalIcon className="h-5 w-5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onReply();
            }}
          >
            <ArrowUturnLeftIcon className="h-4 w-4 text-slate-500" />
            Reply
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onForward();
            }}
          >
            <ArrowUturnRightIcon className="h-4 w-4 text-slate-500" />
            Forward
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onComment();
            }}
          >
            <ChatBubbleLeftEllipsisIcon className="h-4 w-4 text-slate-500" />
            Comment
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onDelete();
            }}
          >
            <TrashIcon className="h-4 w-4" />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
