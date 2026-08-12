import React, { useEffect, useRef, useState } from 'react';
import {
  PaperAirplaneIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { ChatBubbleOvalLeftEllipsisIcon as ChatBubbleOvalLeftEllipsisSolidIcon } from '@heroicons/react/24/solid';
import { toast } from 'react-hot-toast';
import type { EmailComment } from '../../lib/interactions/emailComments';
import { createEmailComment, deleteEmailComment } from '../../lib/interactions/emailComments';

function formatCommentWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

type Props = {
  emailId: string;
  comments: EmailComment[];
  onCommentsChange: (emailId: string, next: EmailComment[]) => void;
  composerOpen: boolean;
  onComposerClose?: () => void;
  /** @deprecated Kept for call-site compatibility; no longer shown in the composer. */
  currentUserName?: string | null;
  /** @deprecated Kept for call-site compatibility; no longer shown in the composer. */
  currentUserPhotoUrl?: string | null;
};

export function EmailMessageComments({
  emailId,
  comments,
  onCommentsChange,
  composerOpen,
  onComposerClose,
}: Props) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(composerOpen);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (composerOpen) {
      setShowComposer(true);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [composerOpen]);

  const openComposer = () => {
    setShowComposer(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const submit = async () => {
    if (saving) return;
    const body = draft.trim();
    if (!body) {
      toast.error('Write a comment first');
      return;
    }
    setSaving(true);
    try {
      const saved = await createEmailComment(emailId, body);
      onCommentsChange(emailId, [...comments, saved]);
      setDraft('');
      toast.success('Comment added');
      onComposerClose?.();
    } catch (e: any) {
      console.error('createEmailComment:', e);
      toast.error(e?.message || 'Failed to add comment');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (comment: EmailComment) => {
    if (deletingId) return;
    if (!window.confirm('Delete this comment?')) return;
    setDeletingId(comment.id);
    try {
      await deleteEmailComment(comment.id);
      onCommentsChange(
        emailId,
        comments.filter((c) => c.id !== comment.id),
      );
      toast.success('Comment deleted');
    } catch (e: any) {
      console.error('deleteEmailComment:', e);
      toast.error(e?.message || 'Failed to delete comment');
    } finally {
      setDeletingId(null);
    }
  };

  const commentCount = comments.length;
  const panelOpen = showComposer || commentCount > 0;

  return (
    <div className="mt-3">
      {/* Badge sits above comments / input when those are visible */}
      <div className={`flex justify-end ${panelOpen ? 'mb-2' : ''}`}>
        <button
          type="button"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-500"
          title={
            commentCount > 0
              ? `${commentCount} internal comment${commentCount === 1 ? '' : 's'} — click to add`
              : 'Add internal comment'
          }
          aria-label={
            commentCount > 0 ? `${commentCount} comments, add comment` : 'Add comment'
          }
          onClick={openComposer}
        >
          <ChatBubbleOvalLeftEllipsisSolidIcon className="h-5 w-5 text-slate-400" />
          <span className="absolute -right-0.5 -top-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] font-semibold tabular-nums leading-none text-slate-600 ring-2 ring-white">
            {commentCount}
          </span>
        </button>
      </div>

      {panelOpen ? (
        <div className="border-t border-slate-100 pt-3">
          {commentCount > 0 ? (
            <ul className={`${showComposer ? 'mb-3' : ''} space-y-2`}>
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className="rounded-lg border border-slate-100/80 bg-slate-50/40 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-slate-800">{comment.created_by}</span>
                        <span className="text-[11px] tabular-nums text-slate-500">
                          {formatCommentWhen(comment.created_at)}
                        </span>
                      </div>
                      <p
                        className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700"
                        dir="auto"
                      >
                        {comment.body}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square shrink-0 text-slate-400 hover:text-red-600"
                      title="Delete comment"
                      disabled={deletingId === comment.id}
                      onClick={() => void remove(comment)}
                    >
                      {deletingId === comment.id ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <TrashIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {showComposer ? (
            <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder="Add an internal comment…"
                className="textarea min-h-[5.5rem] w-full resize-y border-0 bg-transparent pb-14 pl-3 pr-14 pt-3 text-sm leading-relaxed focus:outline-none focus:ring-0"
                dir="auto"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />

              <div className="absolute bottom-2 right-2 z-10 flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm h-10 min-h-0 px-3 text-slate-500"
                  onClick={() => {
                    setShowComposer(false);
                    setDraft('');
                    onComposerClose?.();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#4218CC] text-white shadow-md transition hover:bg-[#3514a8] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={saving || !draft.trim()}
                  onClick={() => void submit()}
                  title="Send comment"
                  aria-label="Send comment"
                >
                  {saving ? (
                    <span className="loading loading-spinner loading-sm text-white" />
                  ) : (
                    <PaperAirplaneIcon className="h-6 w-6" />
                  )}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
