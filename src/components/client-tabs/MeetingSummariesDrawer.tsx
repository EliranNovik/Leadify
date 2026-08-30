import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MapPinIcon, SparklesIcon } from '@heroicons/react/24/outline';
import MobileBottomSheet from '../MobileBottomSheet';
import { hasHebrewText, saveMeetingSummaryNotes } from '../../lib/meetingSummaryNotesApi';
import { supabase } from '../../lib/supabase';

export type MeetingSummaryListItem = {
  id: number | string;
  date: string;
  time?: string | null;
  locationLabel?: string | null;
  notes: string;
  brief: string;
  isLegacy?: boolean;
  legacyLeadId?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: MeetingSummaryListItem[];
  resolveEditorDisplayName: () => Promise<string>;
  onSaved?: (meetingId: number | string, patch: { notes: string; brief: string }) => void;
  onOpenSummaryAi?: (item: MeetingSummaryListItem) => void;
};

type Draft = { notes: string; brief: string };
type Drafts = Record<string, Draft>;

const itemKey = (id: number | string) => String(id);
const BRIEF_MIN_HEIGHT_PX = 220;

function resizeBriefTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, BRIEF_MIN_HEIGHT_PX)}px`;
}

const MeetingSummariesDrawer: React.FC<Props> = ({
  open,
  onClose,
  items,
  resolveEditorDisplayName,
  onSaved,
  onOpenSummaryAi,
}) => {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const aTime = Date.parse(`${a.date}T${a.time || '00:00'}`);
        const bTime = Date.parse(`${b.date}T${b.time || '00:00'}`);
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      }),
    [items],
  );

  useEffect(() => {
    if (!open) return;
    const next: Drafts = {};
    for (const item of items) {
      next[itemKey(item.id)] = { notes: item.notes, brief: item.brief };
    }
    setDrafts(next);
  }, [open, items]);

  useLayoutEffect(() => {
    if (!open) return;
    document.querySelectorAll<HTMLTextAreaElement>('[data-meeting-brief-textarea]').forEach(resizeBriefTextarea);
  }, [open, drafts]);

  const handleSave = async (item: MeetingSummaryListItem) => {
    const key = itemKey(item.id);
    const draft = drafts[key] ?? { notes: item.notes, brief: item.brief };
    const notes = draft.notes.trim();
    const brief = draft.brief.trim();
    setSavingId(key);
    try {
      if (item.isLegacy) {
        if (!item.legacyLeadId) {
          throw new Error('Missing legacy lead id');
        }
        const { error: briefError } = await supabase
          .from('leads_lead')
          .update({ meeting_brief: brief || null })
          .eq('id', item.legacyLeadId);
        if (briefError) throw briefError;
      } else {
        const meetingId = Number(item.id);
        if (!Number.isFinite(meetingId)) {
          throw new Error('Invalid meeting id');
        }
        const editor = await resolveEditorDisplayName();
        const { error: briefError } = await supabase
          .from('meetings')
          .update({ meeting_brief: brief || null })
          .eq('id', meetingId);
        if (briefError) throw briefError;
        await saveMeetingSummaryNotes(meetingId, notes, editor);
      }
      toast.success('Meeting notes saved');
      onSaved?.(item.id, { notes, brief });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="Meeting Summaries"
      desktopLayout="drawer-right"
      mobileFullHeight
      zIndex={330}
      sheetClassName="meeting-summaries-drawer md:max-w-xl"
      contentClassName="flex flex-col min-h-0 px-5 py-5 md:px-6 md:py-6"
    >
      {sortedItems.length === 0 ? (
        <p className="text-sm text-base-content/60">No saved meeting briefs or summaries yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {sortedItems.map((item) => {
            const key = itemKey(item.id);
            const draft = drafts[key] ?? { notes: item.notes, brief: item.brief };
            const briefHebrew = hasHebrewText(draft.brief);
            const notesHebrew = hasHebrewText(draft.notes);
            const dateLabel = item.date ? new Date(item.date).toLocaleDateString('en-GB') : '—';
            const timeLabel = item.time ? item.time.substring(0, 5) : null;
            return (
              <div key={key} className="rounded-2xl bg-gray-50 p-4">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm text-gray-600">
                  <span className="font-semibold text-gray-900">{dateLabel}</span>
                  {timeLabel ? <span>· {timeLabel}</span> : null}
                  {item.locationLabel ? (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                      <span className="text-gray-300" aria-hidden>
                        ·
                      </span>
                      <MapPinIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                      <span className="truncate">{item.locationLabel}</span>
                    </span>
                  ) : null}
                </div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Brief
                </label>
                <textarea
                  data-meeting-brief-textarea
                  dir={briefHebrew ? 'rtl' : 'ltr'}
                  className={`textarea mb-3 min-h-[13.75rem] w-full resize-none overflow-hidden border-0 bg-white text-base leading-relaxed focus:outline-none focus:ring-0 ${
                    briefHebrew ? 'text-right' : 'text-left'
                  }`}
                  value={draft.brief}
                  onChange={(e) => {
                    resizeBriefTextarea(e.target);
                    setDrafts((prev) => ({
                      ...prev,
                      [key]: { ...draft, brief: e.target.value },
                    }));
                  }}
                />
                {!item.isLegacy ? (
                  <>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Summary
                      </span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-100"
                        onClick={() => onOpenSummaryAi?.(item)}
                      >
                        <SparklesIcon className="h-4 w-4" aria-hidden />
                        AI
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenSummaryAi?.(item)}
                      className={`w-full rounded-xl bg-white px-4 py-3 text-left text-base leading-relaxed transition hover:bg-violet-50/50 ${
                        notesHebrew ? 'text-right' : 'text-left'
                      }`}
                      dir={notesHebrew ? 'rtl' : 'ltr'}
                    >
                      {draft.notes.trim() ? (
                        <span className="whitespace-pre-wrap text-slate-700">{draft.notes}</span>
                      ) : (
                        <span className="text-sm text-gray-400">
                          Open the AI summary drawer to add or edit…
                        </span>
                      )}
                    </button>
                  </>
                ) : null}
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="btn btn-primary h-10 min-h-0 rounded-full px-6"
                    disabled={savingId === key}
                    onClick={() => void handleSave(item)}
                  >
                    {savingId === key ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      'Save'
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </MobileBottomSheet>
  );
};

export default MeetingSummariesDrawer;
