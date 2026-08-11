import React, { useEffect, useRef, useState } from 'react';
import {
  ChatBubbleLeftEllipsisIcon,
  PaperAirplaneIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import type { EmailComment } from '../../lib/interactions/emailComments';
import { createEmailComment, deleteEmailComment } from '../../lib/interactions/emailComments';
import { fetchStageActorInfo } from '../../lib/leadStageManager';
import { supabase } from '../../lib/supabase';

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

function initialsFromName(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

type Props = {
  emailId: string;
  comments: EmailComment[];
  onCommentsChange: (emailId: string, next: EmailComment[]) => void;
  composerOpen: boolean;
  onComposerClose?: () => void;
  currentUserName?: string | null;
  currentUserPhotoUrl?: string | null;
};

export function EmailMessageComments({
  emailId,
  comments,
  onCommentsChange,
  composerOpen,
  onComposerClose,
  currentUserName,
  currentUserPhotoUrl,
}: Props) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(composerOpen);
  const [actorName, setActorName] = useState(currentUserName || 'You');
  const [actorPhotoUrl, setActorPhotoUrl] = useState<string | null>(currentUserPhotoUrl || null);
  const [photoError, setPhotoError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (currentUserName) setActorName(currentUserName);
  }, [currentUserName]);

  useEffect(() => {
    setActorPhotoUrl(currentUserPhotoUrl || null);
    setPhotoError(false);
  }, [currentUserPhotoUrl]);

  useEffect(() => {
    if (!showComposer) return;
    let cancelled = false;
    void (async () => {
      try {
        const actor = await fetchStageActorInfo();
        if (cancelled) return;
        if (actor.fullName) setActorName(actor.fullName);
        if (!currentUserPhotoUrl && actor.employeeId != null) {
          const { data: emp } = await supabase
            .from('tenants_employee')
            .select('photo_url, photo')
            .eq('id', actor.employeeId)
            .maybeSingle();
          const url = String((emp as any)?.photo_url || (emp as any)?.photo || '').trim();
          if (url && !cancelled) {
            setActorPhotoUrl(url);
            setPhotoError(false);
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showComposer, currentUserPhotoUrl]);

  useEffect(() => {
    if (composerOpen) {
      setShowComposer(true);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [composerOpen]);

  if (!showComposer && comments.length === 0) return null;

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

  const initials = initialsFromName(actorName);

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <ChatBubbleLeftEllipsisIcon className="h-4 w-4" />
        Internal comments
        {comments.length > 0 ? (
          <span className="rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold tabular-nums normal-case tracking-normal text-slate-500">
            {comments.length}
          </span>
        ) : null}
      </div>

      {comments.length > 0 ? (
        <ul className="mb-3 space-y-2">
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
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700" dir="auto">
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
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex max-w-[42%] items-start p-2.5 sm:max-w-[38%]">
            <div className="pointer-events-none flex max-w-full items-center gap-2 rounded-full border border-white/70 bg-white/75 py-1 pl-1 pr-2.5 shadow-sm backdrop-blur-md backdrop-saturate-150">
              {actorPhotoUrl && !photoError ? (
                <img
                  src={actorPhotoUrl}
                  alt={actorName}
                  className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/90"
                  onError={() => setPhotoError(true)}
                />
              ) : (
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4218CC] text-[0.6rem] font-bold uppercase tracking-wide text-white ring-1 ring-white/90"
                  aria-hidden
                >
                  {initials}
                </div>
              )}
              <span className="truncate text-xs font-semibold text-slate-800" dir="auto">
                {actorName}
              </span>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Add an internal comment…"
            className="textarea min-h-[5.5rem] w-full resize-y border-0 bg-transparent pb-14 pl-[min(42%,11.5rem)] pr-14 pt-3 text-sm leading-relaxed focus:outline-none focus:ring-0 sm:pl-[min(38%,13rem)]"
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
      ) : (
        <button
          type="button"
          className="text-xs font-medium text-[#4218CC] hover:underline"
          onClick={() => setShowComposer(true)}
        >
          Add comment
        </button>
      )}
    </div>
  );
}
