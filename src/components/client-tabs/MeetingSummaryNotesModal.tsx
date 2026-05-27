import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  MapPinIcon,
  MicrophoneIcon,
  SparklesIcon,
  StopIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  fetchMeetingSummaryNotes,
  polishMeetingSummaryNotes,
  saveMeetingSummaryNotes,
  transcribeMeetingSummaryAudio,
} from '../../lib/meetingSummaryNotesApi';
import { useLiveSpeechRecognition } from '../../lib/useLiveSpeechRecognition';
import {
  formatRecordingTime,
  useMeetingSummaryVoiceRecorder,
  voiceBlobToBase64,
  type VoiceRecordingResult,
} from '../../lib/useMeetingSummaryVoiceRecorder';
import VoiceSpeakingBars from './VoiceSpeakingBars';

export type MeetingSummaryNotesModalMeeting = {
  id: number;
  date: string;
  time?: string | null;
  location?: string | null;
  meeting_summary_notes?: string | null;
};

export interface MeetingSummaryNotesModalProps {
  open: boolean;
  meeting: MeetingSummaryNotesModalMeeting | null;
  clientName: string;
  leadNumber?: string | null;
  locationLabel?: string | null;
  onClose: () => void;
  onSaved?: (meetingId: number, notes: string) => void;
  resolveEditorDisplayName: () => Promise<string>;
}

function combineLiveTranscript(baseDraft: string, finalText: string, interimText: string): string {
  const spoken = [finalText.trim(), interimText.trim()].filter(Boolean).join(' ').trim();
  if (!spoken) return baseDraft;
  if (!baseDraft.trim()) return spoken;
  return `${baseDraft.trim()}\n\n${spoken}`;
}

const MeetingSummaryNotesModal: React.FC<MeetingSummaryNotesModalProps> = ({
  open,
  meeting,
  clientName,
  leadNumber,
  locationLabel,
  onClose,
  onSaved,
  resolveEditorDisplayName,
}) => {
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [autoPolishAfterVoice, setAutoPolishAfterVoice] = useState(true);
  const draftRef = useRef(draft);
  const recordingBaseDraftRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  draftRef.current = draft;

  const formattedDate = meeting?.date
    ? new Date(meeting.date).toLocaleDateString('en-GB')
    : null;
  const formattedTime = meeting?.time ? meeting.time.substring(0, 5) : null;

  const liveSpeech = useLiveSpeechRecognition();
  const liveSpeechRef = useRef(liveSpeech);
  liveSpeechRef.current = liveSpeech;
  const { cancel: cancelLiveSpeech, isSupported: liveSpeechSupported, isListening } = liveSpeech;

  const processVoiceRecording = useCallback(
    async (
      result: VoiceRecordingResult,
      reachedMaxDuration = false,
      liveTranscript = '',
    ) => {
      setTranscribing(true);
      try {
        let transcript = liveTranscript.trim();

        if (!transcript) {
          const audioBase64 = await voiceBlobToBase64(result.blob);
          const whisperResult = await transcribeMeetingSummaryAudio({
            audioBase64,
            mimeType: result.mimeType,
            language: 'auto',
          });
          transcript = whisperResult.transcript.trim();
        }

        const combinedText = recordingBaseDraftRef.current.trim()
          ? `${recordingBaseDraftRef.current.trim()}\n\n${transcript}`
          : transcript;

        if (autoPolishAfterVoice) {
          setPolishing(true);
          try {
            const { summary } = await polishMeetingSummaryNotes({
              draft: combinedText,
              clientName,
              leadNumber: leadNumber || null,
              meetingDate: formattedDate,
              meetingLocation: locationLabel || null,
            });
            setDraft(summary);
            toast.success(
              reachedMaxDuration
                ? 'Max recording length reached — transcribed and summarized.'
                : 'Voice transcribed and summarized — review and save when ready.',
            );
          } catch (err) {
            setDraft(combinedText);
            toast.error(
              err instanceof Error ? err.message : 'Transcription saved, but AI summary failed',
            );
          } finally {
            setPolishing(false);
          }
        } else {
          setDraft(combinedText);
          toast.success(
            reachedMaxDuration
              ? 'Max recording length reached — transcription added.'
              : 'Voice transcribed — added to notes.',
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to transcribe recording');
      } finally {
        setTranscribing(false);
        recordingBaseDraftRef.current = '';
      }
    },
    [autoPolishAfterVoice, clientName, formattedDate, leadNumber, locationLabel],
  );

  const {
    isSupported: voiceSupported,
    isRecording,
    seconds,
    audioLevel,
    maxSeconds,
    start: startRecording,
    stop: stopRecording,
    cancel: cancelRecording,
  } = useMeetingSummaryVoiceRecorder({
    onRecordingComplete: (result) => {
      const liveText = liveSpeechRef.current.isListening ? liveSpeechRef.current.stop() : '';
      void processVoiceRecording(result, true, liveText);
    },
  });

  useEffect(() => {
    if (!open || !meeting) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const fromDb = await fetchMeetingSummaryNotes(meeting.id);
        if (!cancelled) {
          setDraft(fromDb || meeting.meeting_summary_notes?.trim() || '');
        }
      } catch (err) {
        if (!cancelled) {
          setDraft(meeting.meeting_summary_notes?.trim() || '');
          toast.error(err instanceof Error ? err.message : 'Failed to load summary');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, meeting?.id, meeting?.meeting_summary_notes]);

  useEffect(() => {
    if (!open) {
      cancelRecording();
      cancelLiveSpeech();
      recordingBaseDraftRef.current = '';
    }
  }, [open, cancelRecording, cancelLiveSpeech]);

  useEffect(() => {
    if (!isRecording || !textareaRef.current) return;
    textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
  }, [draft, isRecording]);

  if (!open || !meeting) return null;

  const runAiPolish = async (sourceText: string) => {
    const { summary } = await polishMeetingSummaryNotes({
      draft: sourceText,
      clientName,
      leadNumber: leadNumber || null,
      meetingDate: formattedDate,
      meetingLocation: locationLabel || null,
    });
    setDraft(summary);
    toast.success('AI summary applied — review and save when ready.');
  };

  const handleAiSummary = async () => {
    if (!draft.trim()) {
      toast.error('Write some notes first, then use AI Summary.');
      return;
    }

    setPolishing(true);
    try {
      await runAiPolish(draft);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate AI summary');
    } finally {
      setPolishing(false);
    }
  };

  const handleStartRecording = async () => {
    recordingBaseDraftRef.current = draftRef.current;
    try {
      await startRecording();
      if (liveSpeechSupported) {
        liveSpeech.start({
          lang: 'he-IL',
          onUpdate: (finalText, interimText) => {
            setDraft(combineLiveTranscript(recordingBaseDraftRef.current, finalText, interimText));
          },
        });
      }
    } catch (err) {
      recordingBaseDraftRef.current = '';
      cancelLiveSpeech();
      toast.error(err instanceof Error ? err.message : 'Could not start recording');
    }
  };

  const handleStopRecording = async () => {
    try {
      const liveText = isListening ? liveSpeech.stop() : '';
      const result = await stopRecording();
      await processVoiceRecording(result, false, liveText);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop recording');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const editor = await resolveEditorDisplayName();
      await saveMeetingSummaryNotes(meeting.id, draft, editor);
      toast.success('Meeting summary saved');
      onSaved?.(meeting.id, draft.trim());
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save summary');
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || saving || polishing || transcribing;
  const textareaDisabled = busy || isRecording;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex h-full min-h-0 w-full max-h-[100dvh] flex-col overflow-hidden bg-white shadow-xl rounded-none sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-summary-notes-title"
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-gray-100 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id="meeting-summary-notes-title" className="text-lg font-semibold text-gray-900">
                Meeting summary
              </h3>
              <div className="text-sm mt-1.5 space-y-1">
                <p className="text-gray-900">
                  {leadNumber ? (
                    <>
                      <span className="font-semibold">#{leadNumber}</span>
                      <span className="text-gray-300 mx-1.5" aria-hidden>
                        |
                      </span>
                    </>
                  ) : null}
                  <span className="font-medium">{clientName || '—'}</span>
                </p>
                {(formattedDate || formattedTime || locationLabel) && (
                  <p className="text-gray-500 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    {formattedDate && <span>{formattedDate}</span>}
                    {formattedTime && <span>· {formattedTime}</span>}
                    {locationLabel && (
                      <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                        <span className="text-gray-300" aria-hidden>
                          ·
                        </span>
                        <MapPinIcon className="w-3.5 h-3.5 opacity-70 shrink-0" aria-hidden />
                        <span className="truncate">{locationLabel}</span>
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-sm btn-square shrink-0"
              aria-label="Close"
              disabled={busy && !isRecording}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-500">
              Type notes, record voice, or both — then polish with AI.
            </p>
            <button
              type="button"
              className="btn btn-outline btn-sm gap-2 shrink-0 border-violet-200 text-violet-800 hover:bg-violet-50"
              onClick={handleAiSummary}
              disabled={busy || isRecording}
            >
              {polishing ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <SparklesIcon className="w-4 h-4" />
              )}
              AI Summary
            </button>
          </div>

          {voiceSupported && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-50 to-white px-3 py-2.5 shadow-sm ring-1 ring-slate-100">
              {!isRecording ? (
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 active:scale-[0.98]"
                  onClick={handleStartRecording}
                  disabled={busy}
                >
                  {transcribing ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <MicrophoneIcon className="w-4 h-4" />
                  )}
                  Record voice
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 active:scale-[0.98]"
                    onClick={handleStopRecording}
                    disabled={transcribing}
                  >
                    {transcribing ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <StopIcon className="w-4 h-4" />
                    )}
                    Stop & transcribe
                  </button>
                  <VoiceSpeakingBars active={isRecording} level={audioLevel} />
                  <span className="inline-flex items-center gap-2 rounded-full border border-red-200/80 bg-red-50 px-3 py-1 shadow-sm">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-red-800">
                      {formatRecordingTime(seconds)}
                    </span>
                    <span className="text-xs font-medium text-red-600/70">/</span>
                    <span className="font-mono text-xs font-medium tabular-nums text-red-600/80">
                      {formatRecordingTime(maxSeconds)}
                    </span>
                  </span>
                  {isListening && (
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 ring-1 ring-violet-100">
                      Live caption
                    </span>
                  )}
                </>
              )}

              <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs rounded-md border-slate-300 [--chkbg:theme(colors.violet.600)] [--chkfg:white]"
                  checked={autoPolishAfterVoice}
                  onChange={(e) => setAutoPolishAfterVoice(e.target.checked)}
                  disabled={busy || isRecording}
                />
                Auto AI summary after voice
              </label>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <span className="loading loading-spinner loading-md text-gray-400" />
            </div>
          ) : (
            <div
              className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm ring-1 transition-colors ${
                isRecording
                  ? 'border-red-200/80 bg-gradient-to-b from-red-50/40 to-white ring-red-100'
                  : 'border-slate-200/80 bg-white ring-slate-100'
              }`}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Summary notes
                </span>
                {isRecording && (
                  <span className="text-xs font-medium text-red-600">Recording…</span>
                )}
              </div>
              <textarea
                ref={textareaRef}
                className="min-h-[14rem] w-full flex-1 resize-y border-0 bg-transparent px-4 py-3 text-base leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-0 sm:min-h-[360px]"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  isRecording
                    ? 'Speak now — your words will appear here as you talk…'
                    : 'Meeting summary notes…'
                }
                autoFocus
                disabled={textareaDisabled}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-100 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy && !isRecording}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy || isRecording}>
            {saving ? <span className="loading loading-spinner loading-xs" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MeetingSummaryNotesModal;
