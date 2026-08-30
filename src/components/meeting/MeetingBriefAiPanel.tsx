import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
  ArrowRightIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  MapPinIcon,
  MicrophoneIcon,
  SparklesIcon,
  StopIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  cleanMeetingBriefChatReply,
  cleanMeetingBriefText,
  fetchMeetingSummaryNotes,
  hasHebrewText,
  saveMeetingSummaryNotes,
  transcribeMeetingSummaryAudio,
} from '../../lib/meetingSummaryNotesApi';
import { fetchLeadCaseFileForAi } from '../../lib/leadFollowupAiApi';
import { sendWordDocumentAiChatMessage } from '../../lib/wordDocumentAiApi';
import ContractAiReviewPanel, {
  type ContractAiReviewMessage,
} from '../ContractAiReviewPanel';
import { useLiveSpeechRecognition } from '../../lib/useLiveSpeechRecognition';
import {
  formatRecordingTime,
  useMeetingSummaryVoiceRecorder,
  voiceBlobToBase64,
  type VoiceRecordingResult,
} from '../../lib/useMeetingSummaryVoiceRecorder';
import VoiceSpeakingBars from '../client-tabs/VoiceSpeakingBars';

export const MEETING_BRIEF_AI_OPEN_EVENT = 'meeting-brief-ai:open-change';
export const MEETING_BRIEF_AI_DISMISS_EVENT = 'meeting-brief-ai:dismiss';

export interface MeetingBriefAiPanelProps {
  open: boolean;
  onClose: () => void;
  /** Brief text, owned by the Meeting Ended drawer. */
  value: string;
  onChange: (next: string) => void;
  clientName: string;
  leadNumber?: string | null;
  leadId?: string | null;
  isLegacy?: boolean;
  language?: string | null;
  category?: string | null;
  /** Original meeting brief — shown so past edits stay visible. */
  previousBrief?: string | null;
  /** Meeting row the summary is stored on (`meetings.meeting_summary_notes`). */
  meetingId: number | null;
  meetingDate?: string | null;
  meetingTime?: string | null;
  locationLabel?: string | null;
  resolveEditorDisplayName: () => Promise<string>;
  onSaved?: (notes: string) => void;
  zIndex?: number;
}

function resolveMeetingBriefAiLanguage(raw?: string | null): 'en' | 'he' {
  const s = String(raw ?? '').trim().toLowerCase();
  if (
    s.includes('עבר') ||
    s.includes('hebrew') ||
    s === 'he' ||
    s === 'heb' ||
    s.startsWith('he-') ||
    s === 'iw'
  ) {
    return 'he';
  }
  return 'en';
}

function combineLiveTranscript(baseDraft: string, finalText: string, interimText: string): string {
  const spoken = [finalText.trim(), interimText.trim()].filter(Boolean).join(' ').trim();
  if (!spoken) return baseDraft;
  if (!baseDraft.trim()) return spoken;
  return `${baseDraft.trim()}\n\n${spoken}`;
}

const MeetingBriefAiPanel: React.FC<MeetingBriefAiPanelProps> = ({
  open,
  onClose,
  value,
  onChange,
  clientName,
  leadNumber,
  leadId,
  isLegacy = false,
  language,
  category,
  previousBrief,
  meetingId,
  meetingDate,
  meetingTime,
  locationLabel,
  resolveEditorDisplayName,
  onSaved,
  zIndex = 321,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [autoPolishAfterVoice, setAutoPolishAfterVoice] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ContractAiReviewMessage[]>([]);
  const [chatRemarks, setChatRemarks] = useState('');
  const [chatApplying, setChatApplying] = useState(false);
  const [chatThinking, setChatThinking] = useState<string | null>(null);
  const [briefAiLanguage, setBriefAiLanguage] = useState<'en' | 'he'>('en');
  const caseFileRef = useRef('');
  const caseFilePromiseRef = useRef<Promise<string> | null>(null);
  const valueRef = useRef(value);
  const recordingBaseDraftRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const aiLanguageLabel = briefAiLanguage === 'he' ? 'Hebrew' : 'English';
  const languageLock = `LANGUAGE: write the meeting brief and every chat reply in ${aiLanguageLabel} only. Do not mix languages.`;

  const formattedDate = meetingDate ? new Date(meetingDate).toLocaleDateString('en-GB') : null;
  const formattedTime = meetingTime ? meetingTime.substring(0, 5) : null;

  const liveSpeech = useLiveSpeechRecognition();
  const liveSpeechRef = useRef(liveSpeech);
  liveSpeechRef.current = liveSpeech;
  const { cancel: cancelLiveSpeech, isSupported: liveSpeechSupported, isListening } = liveSpeech;

  const loadCaseFile = useCallback(async () => {
    const id = String(leadId || '').trim();
    if (!id) return '';
    const promise = fetchLeadCaseFileForAi({
      leadId: id,
      isLegacy: isLegacy || id.startsWith('legacy_'),
    })
      .then((text) => {
        caseFileRef.current = text;
        return text;
      })
      .catch((error) => {
        console.warn('Failed to load CRM case file for meeting brief AI', error);
        caseFileRef.current = '';
        return '';
      });
    caseFilePromiseRef.current = promise;
    return promise;
  }, [leadId, isLegacy]);

  const getCaseFile = useCallback(async () => {
    if (caseFileRef.current) return caseFileRef.current;
    if (caseFilePromiseRef.current) return caseFilePromiseRef.current;
    return loadCaseFile();
  }, [loadCaseFile]);

  const runCaseAwareBriefAi = useCallback(
    async (remarks: string, sourceText: string, onThinking?: (text: string) => void) => {
      const caseContext = await getCaseFile();
      const userRemarks = [
        languageLock,
        remarks,
        caseContext
          ? `[BACKGROUND CASE FILE — use only the facts that matter. Write a short meeting note, not a CRM report. No labels, markdown, or links. Never invent facts.]\n${caseContext}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const result = await sendWordDocumentAiChatMessage(
        {
          currentDocumentText:
            sourceText.trim() || '(empty meeting brief — write a meeting summary for this client)',
          userRemarks,
          clientName,
          leadNumber,
          language: aiLanguageLabel,
          category,
          caseContext,
          purpose: 'meeting_brief',
        },
        onThinking,
      );
      if (result.intent !== 'action') {
        throw new Error(result.answer || 'AI did not return a meeting brief');
      }
      return cleanMeetingBriefText(result.improvedDocumentText);
    },
    [aiLanguageLabel, category, clientName, getCaseFile, languageLock, leadNumber],
  );

  const processVoiceRecording = useCallback(
    async (result: VoiceRecordingResult, reachedMaxDuration = false, liveTranscript = '') => {
      setTranscribing(true);
      try {
        let transcript = liveTranscript.trim();

        if (!transcript) {
          const audioBase64 = await voiceBlobToBase64(result.blob);
          const whisperResult = await transcribeMeetingSummaryAudio({
            audioBase64,
            mimeType: result.mimeType,
            language: briefAiLanguage === 'he' ? 'he' : 'en',
          });
          transcript = whisperResult.transcript.trim();
        }

        const combinedText = recordingBaseDraftRef.current.trim()
          ? `${recordingBaseDraftRef.current.trim()}\n\n${transcript}`
          : transcript;

        if (autoPolishAfterVoice) {
          setPolishing(true);
          try {
            const summary = await runCaseAwareBriefAi(
              `Turn this voice transcript into a clear meeting brief in ${aiLanguageLabel} using the CRM case file. Keep the staff notes, add missing case context, and do not invent facts.`,
              combinedText,
            );
            onChangeRef.current(summary);
            toast.success(
              reachedMaxDuration
                ? 'Max recording length reached — transcribed and summarized.'
                : 'Voice transcribed and summarized — review and save when ready.',
            );
          } catch (err) {
            onChangeRef.current(combinedText);
            toast.error(
              err instanceof Error ? err.message : 'Transcription saved, but AI summary failed',
            );
          } finally {
            setPolishing(false);
          }
        } else {
          onChangeRef.current(combinedText);
          toast.success(
            reachedMaxDuration
              ? 'Max recording length reached — transcription added.'
              : 'Voice transcribed — added to the brief.',
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to transcribe recording');
      } finally {
        setTranscribing(false);
        recordingBaseDraftRef.current = '';
      }
    },
    [aiLanguageLabel, autoPolishAfterVoice, briefAiLanguage, runCaseAwareBriefAi],
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

  // Pull anything already stored on the meeting so the brief and the Meeting tab
  // summary stay a single text.
  useEffect(() => {
    if (!open || meetingId == null) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const stored = await fetchMeetingSummaryNotes(meetingId);
        if (!cancelled && stored && !valueRef.current.trim()) {
          onChangeRef.current(stored);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load meeting summary');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, meetingId]);

  useEffect(() => {
    if (!open) {
      cancelRecording();
      cancelLiveSpeech();
      recordingBaseDraftRef.current = '';
      caseFileRef.current = '';
      caseFilePromiseRef.current = null;
      setChatOpen(false);
      setChatMessages([]);
      setChatRemarks('');
      setChatApplying(false);
      setChatThinking(null);
      return;
    }

    setChatOpen(true);
    setBriefAiLanguage(resolveMeetingBriefAiLanguage(language));
    void loadCaseFile();
  }, [open, cancelRecording, cancelLiveSpeech, loadCaseFile, language]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(MEETING_BRIEF_AI_OPEN_EVENT, { detail: { open } }));
    return () => {
      window.dispatchEvent(new CustomEvent(MEETING_BRIEF_AI_OPEN_EVENT, { detail: { open: false } }));
    };
  }, [open]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(false);
  const recordingRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    const shouldIgnoreDismiss = () => busyRef.current || recordingRef.current;

    const onDismiss = () => {
      if (shouldIgnoreDismiss()) return;
      onCloseRef.current();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.meeting-brief-ai-panel, .meeting-brief-ai-chat')) return;
      onDismiss();
    };

    window.addEventListener(MEETING_BRIEF_AI_DISMISS_EVENT, onDismiss);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener(MEETING_BRIEF_AI_DISMISS_EVENT, onDismiss);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!isRecording || !textareaRef.current) return;
    textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
  }, [value, isRecording]);

  if (!open) return null;

  const handleAiSummary = async () => {
    setChatOpen(true);
    setPolishing(true);
    try {
      const remarks = value.trim()
        ? `Rewrite this as a short meeting note in ${aiLanguageLabel}: 2–4 plain paragraphs, no labels, no markdown, no links. Keep the staff notes and add only the case facts that matter.`
        : `Write a short meeting note in ${aiLanguageLabel} from the case file: 2–4 plain paragraphs on what matters now (interest, facts, money, docs, next step). No labels, no markdown, no links.`;
      const summary = await runCaseAwareBriefAi(remarks, value);
      onChange(summary);
      setChatMessages((prev) => [
        ...prev,
        { role: 'user', content: value.trim() ? 'AI Summary from case file' : 'Write a meeting brief from the case file' },
        { role: 'assistant', kind: 'change', content: briefAiLanguage === 'he' ? 'עודכן סיכום הפגישה.' : 'Updated the meeting brief from the CRM case file.' },
      ]);
      toast.success('AI summary applied — review and save when ready.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate AI summary');
    } finally {
      setPolishing(false);
    }
  };

  const handleApplyChat = async () => {
    const remarks = chatRemarks.trim();
    if (!remarks) return;
    setChatApplying(true);
    setChatThinking('Opening the case file…');
    setChatMessages((prev) => [...prev, { role: 'user', content: remarks }]);
    setChatRemarks('');
    try {
      const caseContext = await getCaseFile();
      setChatThinking('Reading the case and your request…');
      const userRemarks = [
        languageLock,
        remarks,
        caseContext
          ? `[BACKGROUND CASE FILE — use only the facts that matter. Write a short meeting note, not a CRM report. No labels, markdown, or links. Never invent facts.]\n${caseContext}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const result = await sendWordDocumentAiChatMessage(
        {
          currentDocumentText:
            value.trim() || '(empty meeting brief — write a meeting summary for this client)',
          userRemarks,
          clientName,
          leadNumber,
          language: aiLanguageLabel,
          category,
          chatHistory: chatMessages.map((m) => ({
            role: m.role,
            content: m.role === 'assistant' && m.kind === 'change' ? 'Updated the meeting brief.' : m.content,
          })),
          caseContext,
          purpose: 'meeting_brief',
        },
        (text) => setChatThinking(text),
      );
      if (result.intent === 'action') {
        onChange(cleanMeetingBriefText(result.improvedDocumentText));
      }
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          kind: result.intent === 'question' ? 'answer' : 'change',
          content:
            result.intent === 'question'
              ? cleanMeetingBriefText(result.answer)
              : cleanMeetingBriefChatReply(
                  result.changeSummary || (briefAiLanguage === 'he' ? 'עודכן סיכום הפגישה.' : 'Updated the meeting brief.'),
                  briefAiLanguage,
                ),
        },
      ]);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'AI request failed');
    } finally {
      setChatApplying(false);
      setChatThinking(null);
    }
  };

  const handleStartRecording = async () => {
    recordingBaseDraftRef.current = valueRef.current;
    try {
      await startRecording();
      if (liveSpeechSupported) {
        liveSpeech.start({
          lang: briefAiLanguage === 'he' ? 'he-IL' : 'en-US',
          onUpdate: (finalText, interimText) => {
            onChangeRef.current(
              combineLiveTranscript(recordingBaseDraftRef.current, finalText, interimText),
            );
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
    if (meetingId == null) {
      toast.error('No meeting found for this lead — the brief will be saved with the lead update.');
      onClose();
      return;
    }

    setSaving(true);
    try {
      const editor = await resolveEditorDisplayName();
      await saveMeetingSummaryNotes(meetingId, value, editor);
      toast.success('Meeting summary saved');
      onSaved?.(value.trim());
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save summary');
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || saving || polishing || transcribing || chatApplying;
  busyRef.current = busy;
  recordingRef.current = isRecording;

  return (
    <>
    {createPortal(
    <div className="pointer-events-none fixed inset-0 flex" style={{ zIndex }} role="presentation">
      <div
        className="meeting-brief-ai-panel pointer-events-auto flex h-full w-full flex-col overflow-hidden bg-gray-50 shadow-2xl md:ml-auto md:w-full md:max-w-2xl"
        role="dialog"
        aria-modal="false"
        aria-label="Meeting brief"
      >
        <div className="flex shrink-0 flex-col gap-3 bg-gray-50 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3 md:px-6 md:pt-5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setChatOpen((prev) => !prev)}
              className={`btn btn-ghost btn-sm btn-square ${chatOpen ? 'text-violet-700' : ''}`}
              aria-label={chatOpen ? 'Hide AI assistant' : 'Show AI assistant'}
              title={chatOpen ? 'Hide AI assistant' : 'Show AI assistant'}
              disabled={busy && !isRecording}
            >
              <ChatBubbleLeftRightIcon className="h-5 w-5" />
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-4 py-1.5 text-sm font-semibold text-violet-800 shadow-sm transition-all hover:bg-violet-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleAiSummary}
                disabled={busy || isRecording}
              >
                {polishing ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <SparklesIcon className="h-5 w-5" />
                )}
                AI Summary
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost btn-sm btn-square"
                aria-label="Close meeting brief"
                disabled={busy && !isRecording}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-base-content">
              {leadNumber ? (
                <>
                  <span className="font-semibold">#{leadNumber}</span>
                  <span className="mx-1.5 text-base-content/25" aria-hidden>
                    |
                  </span>
                </>
              ) : null}
              <span className="font-medium">{clientName || '—'}</span>
            </p>
            {(formattedDate || formattedTime || locationLabel) && (
              <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-base-content/55">
                {formattedDate && <span>{formattedDate}</span>}
                {formattedTime && <span>· {formattedTime}</span>}
                {locationLabel && (
                  <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                    <span className="text-base-content/25" aria-hidden>
                      ·
                    </span>
                    <MapPinIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                    <span className="truncate">{locationLabel}</span>
                  </span>
                )}
              </p>
            )}
          </div>

          {voiceSupported && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2.5">
              {!isRecording ? (
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-50 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 active:scale-[0.98]"
                  onClick={handleStartRecording}
                  disabled={busy}
                >
                  {transcribing ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <MicrophoneIcon className="h-4 w-4" />
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
                      <StopIcon className="h-4 w-4" />
                    )}
                    Stop &amp; transcribe
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 px-5 py-4 md:px-6">
          {previousBrief?.trim() && previousBrief.trim() !== value.trim() ? (
            <div className="mb-3 shrink-0 rounded-2xl bg-white px-4 py-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Previous brief
              </p>
              <p
                dir={hasHebrewText(previousBrief) ? 'rtl' : 'ltr'}
                className={`max-h-36 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-600 ${
                  hasHebrewText(previousBrief) ? 'text-right' : 'text-left'
                }`}
              >
                {previousBrief.trim()}
              </p>
            </div>
          ) : null}
          <div
            className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white transition-colors ${
              isRecording ? 'bg-red-50/40' : 'bg-white'
            }`}
          >
            <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
              <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <DocumentTextIcon className="h-4 w-4" aria-hidden />
                Meeting summary
              </span>
              {loading ? (
                <span className="loading loading-spinner loading-xs text-slate-400" />
              ) : isRecording ? (
                <span className="text-xs font-medium text-red-600">Recording…</span>
              ) : null}
            </div>
            <textarea
              ref={textareaRef}
              dir={briefAiLanguage === 'he' ? 'rtl' : 'ltr'}
              className={`h-full w-full flex-1 resize-none border-0 bg-transparent px-4 py-3 text-base leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-0 ${
                briefAiLanguage === 'he' ? 'text-right' : 'text-left'
              }`}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={
                isRecording
                  ? briefAiLanguage === 'he'
                    ? 'דברו עכשיו — המילים יופיעו כאן…'
                    : 'Speak now — your words will appear here as you talk…'
                  : briefAiLanguage === 'he'
                    ? 'תקציר / סיכום פגישה…'
                    : 'Meeting brief / summary…'
              }
              autoFocus
              disabled={busy || isRecording}
            />
          </div>
        </div>

        <div
          className="flex shrink-0 justify-end gap-2 bg-gray-50 px-5 py-4 md:px-6"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={busy && !isRecording}
          >
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary rounded-full px-6"
            onClick={handleSave}
            disabled={busy || isRecording}
          >
            {saving ? <span className="loading loading-spinner loading-xs" /> : 'Save summary'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
    )}
    <ContractAiReviewPanel
      isOpen={chatOpen}
      onClose={() => setChatOpen(false)}
      initialSummary={null}
      messages={chatMessages}
      remarks={chatRemarks}
      onRemarksChange={setChatRemarks}
      onApplyRemarks={() => void handleApplyChat()}
      isApplying={chatApplying || polishing}
      thinkingText={chatThinking}
      zIndex={zIndex + 1}
      title={
        <span className="flex items-center gap-2.5">
          <ChatBubbleLeftRightIcon className="h-7 w-7 shrink-0 text-violet-600" />
          <span>AI meeting assistant</span>
        </span>
      }
      subtitle=""
      placeholder={briefAiLanguage === 'he' ? 'שאלו כל דבר' : 'Ask anything...'}
      conversationOnly
      dockToSelector=".meeting-brief-ai-panel"
      closeIcon={<ArrowRightIcon className="h-5 w-5" />}
      inputDir={briefAiLanguage === 'he' ? 'rtl' : 'ltr'}
      headerExtra={
        <div className="inline-flex rounded-lg bg-gray-200 p-0.5 text-xs font-semibold" role="group" aria-label="Assistant language">
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 transition-colors ${
              briefAiLanguage === 'en' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setBriefAiLanguage('en')}
          >
            EN
          </button>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 transition-colors ${
              briefAiLanguage === 'he' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setBriefAiLanguage('he')}
          >
            עב
          </button>
        </div>
      }
      sheetClassName="meeting-brief-ai-chat !bg-gray-50 !shadow-none md:!max-w-md md:!border-l-0 md:border-r"
      headerClassName="!bg-gray-50 !border-0"
      contentClassName="!bg-gray-50"
    />
    </>
  );
};

export default MeetingBriefAiPanel;
