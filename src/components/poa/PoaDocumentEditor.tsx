import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Highlight } from '@tiptap/extension-highlight';
import { Placeholder } from '@tiptap/extension-placeholder';
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  Bars3BottomLeftIcon,
  Bars3BottomRightIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  ClipboardDocumentIcon,
  EyeIcon,
  PlusIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { SparklesIcon as SparklesIconSolid } from '@heroicons/react/24/solid';
import TemplatePoaDoc from './documents/TemplatePoaDoc';
import ContractAiReviewPanel, { type ContractAiReviewMessage } from '../ContractAiReviewPanel';
import type { PoaDocController } from './PoaFormPrimitives';
import {
  POA_FIELD_CATALOG,
  POA_FIELD_TYPE_LABELS,
  poaToken,
  extractPoaBodyKeys,
  allocatePoaFieldKey,
  buildTemplatePrefill,
  type PoaTemplateField,
  type PoaFieldType,
  type PoaPrefillSource,
} from '../../lib/poaTemplateFields';
import {
  buildPoaUrl,
  fetchPoaForEdit,
  markPoaSent,
  updatePoaDocument,
  type PoaEditData,
  type PoaStatus,
} from '../../lib/poaApi';
import { POA_STATUS_LABELS } from '../../lib/poaTypes';
import {
  PoaOutline,
  PoaAiAdded,
  PoaAiChanged,
  poaHtmlToMarkup,
  poaMarkupToHtml,
  type PoaTextMarkKind,
} from '../../lib/poaBodyMarkup';
import { formatAiChangeReviewContent, extractAiBodyHighlights, type AiPatchEdit } from '../../lib/aiChangeReview';
import {
  applyAiHighlightsToPoaEditor,
  clearAiHighlightsFromPoaEditor,
} from '../../lib/poaEditorAiHighlights';
import {
  applyPoaAiEditResult,
  fetchLeadMeetingSummaries,
  formatMeetingSummariesForAi,
  improvePoaWithMeetingSummaries,
  leadRefFromPoaData,
  poaBodyToAiText,
  sendPoaAiChatMessage,
  shouldPreferFastPoaEdit,
} from '../../lib/poaImprovementApi';

const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
];
const FONT_SIZES = ['12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px'];
const DEFAULT_FONT_FAMILY = 'Arial';
const DEFAULT_FONT_SIZE = '15px';

const PREFILL_OPTIONS: { value: PoaPrefillSource; label: string }[] = [
  { value: '', label: 'No prefill (signer fills in)' },
  { value: 'name', label: 'Contact name' },
  { value: 'id_passport', label: 'Contact ID / passport' },
  { value: 'address', label: 'Contact address' },
  { value: 'email', label: 'Contact email' },
  { value: 'phone', label: 'Contact phone' },
];

const FIELD_TYPE_OPTIONS = Object.keys(POA_FIELD_TYPE_LABELS) as PoaFieldType[];

const sidePanelIconBtnClass = (active: boolean, disabled = false) =>
  `btn btn-ghost btn-circle w-11 h-11 min-h-11 min-w-11 border-0 flex-shrink-0 ${
    disabled
      ? 'text-gray-400 opacity-50 cursor-not-allowed'
      : active
        ? 'bg-gray-300 text-gray-900 hover:bg-gray-400'
        : 'text-gray-600 hover:bg-gray-300/70'
  }`;

function PoaSidePanelDropdown({
  title,
  'aria-label': ariaLabel,
  disabled = false,
  disabledStyle = false,
  panelClassName = 'min-w-[9.5rem]',
  trigger,
  children,
}: {
  title: string;
  'aria-label'?: string;
  disabled?: boolean;
  disabledStyle?: boolean;
  panelClassName?: string;
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const close = useCallback(() => setOpen(false), []);

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.top, left: rect.right + 8 });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener('resize', updatePos);
    const scrollRoot = triggerRef.current?.closest('.app-main-scroll');
    scrollRoot?.addEventListener('scroll', updatePos, { passive: true });
    return () => {
      window.removeEventListener('resize', updatePos);
      scrollRoot?.removeEventListener('scroll', updatePos);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={sidePanelIconBtnClass(open, disabledStyle)}
        title={title}
        aria-label={ariaLabel || title}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[200] bg-transparent" aria-hidden onClick={close} />
            <div
              ref={panelRef}
              className={`fixed z-[201] max-h-60 overflow-y-auto poa-editor-scroll rounded-lg border border-gray-200 bg-white py-1 shadow-lg ${panelClassName}`}
              style={{ top: pos.top, left: pos.left }}
              role="menu"
            >
              {children(close)}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

const headerToolbarBtnClass = (active: boolean) =>
  `btn btn-sm btn-ghost h-9 min-h-9 rounded-full border-0 px-4 shadow-none ${
    active ? 'bg-gray-100 text-gray-900 hover:bg-gray-100' : 'text-gray-700 hover:bg-gray-50'
  }`;

const STATUS_BADGE: Record<PoaStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  sent: 'bg-sky-50 text-sky-700',
  viewed: 'bg-amber-50 text-amber-700',
  signed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-rose-50 text-rose-600',
};

interface FormState {
  body: string;
  fields: PoaTemplateField[];
  direction: 'ltr' | 'rtl';
  font_family: string;
  font_size: string;
}

function formFromData(data: PoaEditData): FormState {
  return {
    body: data.document.body || '',
    fields: Array.isArray(data.document.fields) ? data.document.fields : [],
    direction: data.document.direction === 'rtl' ? 'rtl' : 'ltr',
    font_family: data.document.font_family || DEFAULT_FONT_FAMILY,
    font_size: data.document.font_size || DEFAULT_FONT_SIZE,
  };
}

function cloneFormState(state: FormState): FormState {
  return {
    ...state,
    fields: state.fields.map((f) => ({ ...f })),
  };
}

const MAX_UNDO_HISTORY = 80;

const PoaDocumentEditor: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PoaEditData | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [insertPanelOpen, setInsertPanelOpen] = useState(false);
  const [fieldsPanelOpen, setFieldsPanelOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [historyNav, setHistoryNav] = useState({ canUndo: false, canRedo: false });
  const [showAiReviewPanel, setShowAiReviewPanel] = useState(false);
  const [aiReviewNotes, setAiReviewNotes] = useState<string | null>(null);
  const [aiReviewChatMessages, setAiReviewChatMessages] = useState<ContractAiReviewMessage[]>([]);
  const [aiRemarksInput, setAiRemarksInput] = useState('');
  const [improvingPoa, setImprovingPoa] = useState(false);
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [aiThinkingText, setAiThinkingText] = useState<string | null>(null);

  const editorHeaderRef = useRef<HTMLDivElement | null>(null);
  const formatRailDesktopRef = useRef<HTMLDivElement | null>(null);
  const formatRailMobileRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [editorRailTopPx, setEditorRailTopPx] = useState(108);
  const historyRef = useRef<FormState[]>([]);
  const historyIndexRef = useRef(0);
  const skipHistoryRef = useRef(false);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipEditorSyncRef = useRef(false);
  const lastMeetingSummariesRef = useRef('');
  const updateFormRef = useRef<(updater: (prev: FormState) => FormState, opts?: { debounce?: boolean }) => void>(
    () => undefined,
  );

  const syncHistoryButtons = useCallback(() => {
    setHistoryNav({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    });
  }, []);

  const resetHistory = useCallback(
    (state: FormState) => {
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      historyRef.current = [cloneFormState(state)];
      historyIndexRef.current = 0;
      syncHistoryButtons();
    },
    [syncHistoryButtons],
  );

  const pushHistoryNow = useCallback(
    (state: FormState) => {
      if (skipHistoryRef.current) {
        skipHistoryRef.current = false;
        return;
      }
      const snap = cloneFormState(state);
      const current = historyRef.current[historyIndexRef.current];
      if (current && JSON.stringify(current) === JSON.stringify(snap)) return;

      const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
      trimmed.push(snap);
      if (trimmed.length > MAX_UNDO_HISTORY) trimmed.shift();
      historyRef.current = trimmed;
      historyIndexRef.current = trimmed.length - 1;
      syncHistoryButtons();
    },
    [syncHistoryButtons],
  );

  const scheduleHistoryPush = useCallback(
    (state: FormState) => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = setTimeout(() => {
        pushHistoryNow(state);
        historyTimerRef.current = null;
      }, 450);
    },
    [pushHistoryNow],
  );

  const updateForm = useCallback(
    (updater: (prev: FormState) => FormState, opts?: { debounce?: boolean }) => {
      setForm((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        queueMicrotask(() => {
          if (opts?.debounce) scheduleHistoryPush(next);
          else pushHistoryNow(next);
        });
        return next;
      });
    },
    [pushHistoryNow, scheduleHistoryPush],
  );

  updateFormRef.current = updateForm;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        italic: false,
        strike: false,
        code: false,
        undoRedo: false,
        hardBreak: {
          keepMarks: true,
        },
      }),
      Underline,
      Highlight.configure({ multicolor: false }),
      PoaOutline,
      PoaAiAdded,
      PoaAiChanged,
      Placeholder.configure({
        placeholder: 'Write the POA text here. Use fields from the panel on the right.',
      }),
    ],
    content: '<p></p>',
    editable: true,
    editorProps: {
      attributes: {
        class:
          'poa-body-editor w-full leading-relaxed focus:outline-none break-words',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          const hardBreak = view.state.schema.nodes.hardBreak;
          if (hardBreak) {
            view.dispatch(view.state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed, transaction }) => {
      if (!transaction.getMeta('poaAiHighlight')) {
        clearAiHighlightsFromPoaEditor(ed);
      }
      skipEditorSyncRef.current = true;
      const markup = poaHtmlToMarkup(ed.getHTML());
      updateFormRef.current((p) => ({ ...p, body: markup }), { debounce: true });
    },
  });

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    historyIndexRef.current -= 1;
    skipHistoryRef.current = true;
    setForm(cloneFormState(historyRef.current[historyIndexRef.current]));
    syncHistoryButtons();
  }, [syncHistoryButtons]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    historyIndexRef.current += 1;
    skipHistoryRef.current = true;
    setForm(cloneFormState(historyRef.current[historyIndexRef.current]));
    syncHistoryButtons();
  }, [syncHistoryButtons]);

  const reload = useCallback(async () => {
    if (!token) {
      setError('Invalid link');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPoaForEdit(token);
      setData(result);
      const nextForm = formFromData(result);
      resetHistory(nextForm);
      setForm(nextForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load POA');
    } finally {
      setLoading(false);
    }
  }, [token, resetHistory]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!data || data.read_only) return;
    void (async () => {
      try {
        const summaries = await fetchLeadMeetingSummaries(leadRefFromPoaData(data));
        lastMeetingSummariesRef.current = formatMeetingSummariesForAi(summaries);
      } catch {
        // AI chat still works without summaries
      }
    })();
  }, [data]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!(data?.read_only ?? false));
  }, [editor, data?.read_only]);

  useEffect(() => {
    if (!editor || form == null) return;
    if (skipEditorSyncRef.current) {
      skipEditorSyncRef.current = false;
      return;
    }
    const currentMarkup = poaHtmlToMarkup(editor.getHTML());
    if (currentMarkup === form.body) return;
    editor.commands.setContent(poaMarkupToHtml(form.body), { emitUpdate: false });
  }, [editor, form?.body]);

  useLayoutEffect(() => {
    const el = editorHeaderRef.current;
    if (!el) return;
    const update = () => {
      const header = editorHeaderRef.current;
      if (header) setEditorRailTopPx(Math.round(header.getBoundingClientRect().bottom));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const scrollRoot = el.closest('.app-main-scroll');
    scrollRoot?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      scrollRoot?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [loading, error, data, form]);

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [actionsMenuOpen]);

  const readOnly = data?.read_only ?? false;

  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readOnly, undo, redo]);

  const rightPanelOpen = insertPanelOpen || fieldsPanelOpen;
  const aiReviewOpen = showAiReviewPanel && !readOnly && !showPreview;
  const usedKeys = useMemo(() => new Set((form?.fields || []).map((f) => f.key)), [form?.fields]);

  const previewValues = useMemo(() => {
    if (!data || !form) return {};
    const prefill = buildTemplatePrefill(form.fields, data.contact);
    return { ...prefill, ...data.poa.field_data };
  }, [data, form]);

  const previewCtrl: PoaDocController = useMemo(
    () => ({
      values: previewValues,
      signatures: {},
      readOnly: true,
      setValue: () => undefined,
      setSignature: () => undefined,
    }),
    [previewValues],
  );

  const applyPoaBodyFromAi = useCallback(
    (beforeBody: string, afterBody: string, patch?: AiPatchEdit) => {
      skipEditorSyncRef.current = true;
      updateForm((p) => ({ ...p, body: afterBody }));
      if (editor && !editor.isDestroyed) {
        editor.commands.setContent(poaMarkupToHtml(afterBody), { emitUpdate: false });
        requestAnimationFrame(() => {
          if (editor.isDestroyed) return;
          applyAiHighlightsToPoaEditor(
            editor,
            extractAiBodyHighlights(beforeBody, afterBody, patch),
          );
        });
      }
    },
    [editor, updateForm],
  );

  const handleImprovePoaWithAi = useCallback(async () => {
    if (!data || !form || readOnly || showPreview || improvingPoa || aiChatLoading) return;

    const currentPoaText = poaBodyToAiText(form.body);
    setImprovingPoa(true);
    setAiReviewNotes(null);
    setAiReviewChatMessages([]);
    setAiThinkingText(null);
    setShowAiReviewPanel(true);
    try {
      const leadRef = leadRefFromPoaData(data);
      if (!lastMeetingSummariesRef.current) {
        const summaries = await fetchLeadMeetingSummaries(leadRef);
        lastMeetingSummariesRef.current = formatMeetingSummariesForAi(summaries);
      }
      const meetingSummaries = lastMeetingSummariesRef.current;
      if (!meetingSummaries) {
        toast(
          currentPoaText
            ? 'No meeting summaries found — improving POA from current text only'
            : 'No meeting summaries found — drafting POA from document context only',
          { icon: 'ℹ️' },
        );
      }

      const result = await improvePoaWithMeetingSummaries(
        {
          currentPoaText,
          meetingSummaries,
          clientName: data.contact.name,
          documentName: data.document.name,
          documentDescription: data.document.description,
          language: data.document.language,
          direction: form.direction,
        },
        setAiThinkingText,
      );

      const beforeBody = form.body;
      const afterBody = applyPoaAiEditResult(beforeBody, result);
      applyPoaBodyFromAi(beforeBody, afterBody, result);
      setAiReviewNotes(
        formatAiChangeReviewContent(poaBodyToAiText(beforeBody), poaBodyToAiText(afterBody), {
          summary: result.changeSummary,
          patch: result,
        }),
      );
      setShowAiReviewPanel(true);
      setAiRemarksInput('');
      toast.success(
        currentPoaText
          ? 'POA improved with AI — review and request changes in the panel'
          : 'POA drafted with AI — review and request changes in the panel',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI POA improvement failed');
    } finally {
      setImprovingPoa(false);
      setAiThinkingText(null);
    }
  }, [
    data,
    form,
    readOnly,
    showPreview,
    improvingPoa,
    aiChatLoading,
    applyPoaBodyFromAi,
  ]);

  const handleApplyAiRemarks = useCallback(async () => {
    if (!data || !form || readOnly || showPreview || aiChatLoading || improvingPoa) return;
    const remarks = aiRemarksInput.trim();
    if (!remarks) {
      toast.error('Please enter a question or change request');
      return;
    }

    const userMessage: ContractAiReviewMessage = { role: 'user', content: remarks };
    setAiReviewChatMessages((prev) => [...prev, userMessage]);
    setAiRemarksInput('');

    const currentPoaText = poaBodyToAiText(form.body);
    setAiChatLoading(true);
    setAiThinkingText(null);
    try {
      let result = await sendPoaAiChatMessage(
        {
          currentPoaText,
          meetingSummaries: lastMeetingSummariesRef.current,
          clientName: data.contact.name,
          documentName: data.document.name,
          documentDescription: data.document.description,
          language: data.document.language,
          direction: form.direction,
          userRemarks: remarks,
          chatHistory: [...aiReviewChatMessages, userMessage],
          preferFastEdit: shouldPreferFastPoaEdit(remarks, currentPoaText),
        },
        setAiThinkingText,
      );

      if (
        result.intent === 'question' &&
        /try asking what else|suggest improvements/i.test(result.answer)
      ) {
        result = await sendPoaAiChatMessage(
          {
            currentPoaText,
            meetingSummaries: lastMeetingSummariesRef.current,
            clientName: data.contact.name,
            documentName: data.document.name,
            documentDescription: data.document.description,
            language: data.document.language,
            direction: form.direction,
            userRemarks: `${remarks}\n\nApply changes to the POA document now (edit the text; do not reply with suggestions only).`,
            chatHistory: [...aiReviewChatMessages, userMessage],
            preferFastEdit: false,
          },
          setAiThinkingText,
        );
      }

      if (result.intent === 'question') {
        setAiReviewChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.answer, kind: 'answer' },
        ]);
      } else {
        const beforeBody = form.body;
        const afterBody = applyPoaAiEditResult(beforeBody, result, remarks);
        applyPoaBodyFromAi(beforeBody, afterBody, result);
        setAiReviewChatMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: formatAiChangeReviewContent(poaBodyToAiText(beforeBody), poaBodyToAiText(afterBody), {
              summary: result.changeSummary,
              patch: result,
            }),
            kind: 'change',
          },
        ]);
        toast.success('POA updated with your changes');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setAiChatLoading(false);
      setAiThinkingText(null);
    }
  }, [
    data,
    form,
    readOnly,
    showPreview,
    aiChatLoading,
    improvingPoa,
    aiRemarksInput,
    aiReviewChatMessages,
    applyPoaBodyFromAi,
  ]);

  const handleOpenAiReviewPanel = useCallback(async () => {
    if (!data || readOnly || showPreview) return;
    setShowAiReviewPanel(true);
    if (!lastMeetingSummariesRef.current) {
      try {
        const summaries = await fetchLeadMeetingSummaries(leadRefFromPoaData(data));
        lastMeetingSummariesRef.current = formatMeetingSummariesForAi(summaries);
      } catch {
        // Chat can still work without meeting summaries
      }
    }
  }, [data, readOnly, showPreview]);

  const addCatalogField = useCallback(
    (catalogKey: string) => {
      if (readOnly) return;
      const item = POA_FIELD_CATALOG.find((c) => c.key === catalogKey);
      if (!item) return;
      setForm((prev) => {
        if (!prev) return prev;
        const fieldKey = allocatePoaFieldKey(item.key, prev.fields, prev.body);
        const exists = prev.fields.some((f) => f.key === fieldKey);
        const fields = exists
          ? prev.fields
          : [
              ...prev.fields,
              {
                key: fieldKey,
                label: item.label,
                type: item.type,
                required: item.type === 'signature',
                prefill: item.prefill,
              } as PoaTemplateField,
            ];

        const tokenStr = poaToken(fieldKey);
        let body = prev.body;
        if (editor && !editor.isDestroyed) {
          editor.chain().focus().insertContent(tokenStr).run();
          body = poaHtmlToMarkup(editor.getHTML());
          skipEditorSyncRef.current = true;
        } else {
          body = body + (body && !body.endsWith('\n') ? ' ' : '') + tokenStr;
        }

        const next = { ...prev, fields, body };
        queueMicrotask(() => pushHistoryNow(next));
        return next;
      });
    },
    [readOnly, pushHistoryNow, editor],
  );

  const updateField = (key: string, patch: Partial<PoaTemplateField>) => {
    if (readOnly) return;
    updateForm((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    }));
  };

  const removeField = (key: string) => {
    if (readOnly) return;
    updateForm((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.key !== key) }));
  };

  const handleSave = async () => {
    if (!token || !form || readOnly) return;

    const bodyKeys = extractPoaBodyKeys(form.body);
    const fieldsByKey = new Map(form.fields.map((f) => [f.key, f]));
    for (const key of bodyKeys) {
      if (!fieldsByKey.has(key)) {
        const item = POA_FIELD_CATALOG.find((c) => c.key === key);
        fieldsByKey.set(key, {
          key,
          label: item?.label || key,
          type: item?.type || 'text',
          required: item?.type === 'signature',
          prefill: item?.prefill || '',
        });
      }
    }
    const fields = Array.from(fieldsByKey.values());

    setSaving(true);
    try {
      await updatePoaDocument({
        token,
        body: form.body,
        fields,
        direction: form.direction,
        fontFamily: form.font_family,
        fontSize: form.font_size,
      });
      toast.success('POA saved');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save POA');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!data) return;
    const url = buildPoaUrl(data.poa.secure_token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('POA link copied');
      if (data.poa.status === 'pending') {
        await markPoaSent(data.poa.id).catch(() => undefined);
        await reload();
      }
    } catch {
      window.prompt('Copy this POA link:', url);
    }
  };

  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/clients');
  };

  const fontSizeShort = (form?.font_size || DEFAULT_FONT_SIZE).replace('px', '');

  const applyTextFormat = useCallback(
    (kind: PoaTextMarkKind) => {
      if (readOnly || !editor || editor.isDestroyed) return;
      const { empty } = editor.state.selection;
      if (empty) {
        toast.error('Select text to format');
        return;
      }
      const chain = editor.chain().focus();
      if (kind === 'bold') chain.toggleBold().run();
      else if (kind === 'underline') chain.toggleUnderline().run();
      else if (kind === 'highlight') chain.toggleHighlight().run();
      else if (kind === 'outline') chain.togglePoaOutline().run();
    },
    [readOnly, editor],
  );

  const renderSidePanelButton = (
    props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; disabledStyle?: boolean },
  ) => {
    const { active = false, disabledStyle, className, ...rest } = props;
    return (
      <button
        type="button"
        className={`${sidePanelIconBtnClass(active, disabledStyle)} ${className || ''}`}
        {...rest}
      />
    );
  };

  const renderSidePanelDivider = () => <div className="h-px w-8 bg-gray-200" aria-hidden />;

  const renderSidePanelContent = (horizontal = false) => (
      <div
        className={
          horizontal
            ? 'flex max-w-full flex-wrap items-center justify-center gap-2'
            : 'flex w-full flex-col items-center gap-3 px-1 py-4'
        }
      >
        {renderSidePanelButton({
          title: 'Undo',
          'aria-label': 'Undo',
          disabled: readOnly || !historyNav.canUndo,
          disabledStyle: readOnly || !historyNav.canUndo,
          onClick: undo,
          children: <ArrowUturnLeftIcon className="h-6 w-6" />,
        })}
        {renderSidePanelButton({
          title: 'Redo',
          'aria-label': 'Redo',
          disabled: readOnly || !historyNav.canRedo,
          disabledStyle: readOnly || !historyNav.canRedo,
          onClick: redo,
          children: <ArrowUturnRightIcon className="h-6 w-6" />,
        })}

        {renderSidePanelDivider()}

        <PoaSidePanelDropdown
          title="Text formatting"
          aria-label="Text formatting"
          disabled={readOnly}
          disabledStyle={readOnly}
          panelClassName="min-w-[9.5rem]"
          trigger={<b className="text-sm font-bold">B</b>}
        >
          {(close) =>
            (
              [
                { kind: 'bold' as const, label: 'Bold', node: <b className="font-bold">B</b> },
                { kind: 'underline' as const, label: 'Underline', node: <u className="underline">U</u> },
                {
                  kind: 'outline' as const,
                  label: 'Outlined',
                  node: <span className="rounded border border-current px-0.5 text-xs leading-none">O</span>,
                },
                {
                  kind: 'highlight' as const,
                  label: 'Highlight',
                  node: <span className="bg-yellow-200 px-0.5 text-xs leading-none">H</span>,
                },
              ] as const
            ).map(({ kind, label, node }) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => {
                  applyTextFormat(kind);
                  close();
                }}
              >
                <span className="flex h-5 w-5 items-center justify-center text-gray-600">{node}</span>
                {label}
              </button>
            ))
          }
        </PoaSidePanelDropdown>

        {renderSidePanelDivider()}

        {renderSidePanelButton({
          title: 'Left to right (LTR)',
          'aria-label': 'Left to right',
          'aria-pressed': form?.direction === 'ltr',
          disabled: readOnly,
          disabledStyle: readOnly,
          active: form?.direction === 'ltr',
          onClick: () => updateForm((p) => ({ ...p, direction: 'ltr' })),
          children: <Bars3BottomLeftIcon className="h-6 w-6" />,
        })}
        {renderSidePanelButton({
          title: 'Right to left (RTL)',
          'aria-label': 'Right to left',
          'aria-pressed': form?.direction === 'rtl',
          disabled: readOnly,
          disabledStyle: readOnly,
          active: form?.direction === 'rtl',
          onClick: () => updateForm((p) => ({ ...p, direction: 'rtl' })),
          children: <Bars3BottomRightIcon className="h-6 w-6" />,
        })}

        {renderSidePanelDivider()}

        <PoaSidePanelDropdown
          title={`Font: ${form?.font_family || DEFAULT_FONT_FAMILY}`}
          aria-label="Font family"
          disabled={readOnly}
          disabledStyle={readOnly}
          panelClassName="max-h-64 min-w-[200px]"
          trigger={<span className="text-xs font-bold leading-none">Aa</span>}
        >
          {(close) =>
            FONT_FAMILIES.map((f) => (
              <button
                key={f}
                type="button"
                role="menuitem"
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-100 ${
                  form?.font_family === f ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-700'
                }`}
                style={{ fontFamily: f }}
                onClick={() => {
                  updateForm((p) => ({ ...p, font_family: f }));
                  close();
                }}
              >
                {f}
              </button>
            ))
          }
        </PoaSidePanelDropdown>
        <PoaSidePanelDropdown
          title={`Size: ${form?.font_size || DEFAULT_FONT_SIZE}`}
          aria-label="Font size"
          disabled={readOnly}
          disabledStyle={readOnly}
          panelClassName="min-w-[120px]"
          trigger={<span className="text-xs font-bold leading-none">{fontSizeShort}</span>}
        >
          {(close) =>
            FONT_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-100 ${
                  form?.font_size === s ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-700'
                }`}
                onClick={() => {
                  updateForm((p) => ({ ...p, font_size: s }));
                  close();
                }}
              >
                {s}
              </button>
            ))
          }
        </PoaSidePanelDropdown>
      </div>
  );

  const renderFormatControls = () => renderSidePanelContent(true);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <span className="loading loading-spinner loading-lg text-gray-400" />
      </div>
    );
  }

  if (error || !data || !form) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-100 px-6">
        <p className="text-center text-gray-600">{error || 'POA not found'}</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={goBack}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-100">
      <style>{`
        .poa-a4-page {
          width: 210mm;
          min-height: 297mm;
          max-width: 100%;
          box-sizing: border-box;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow:
            0 4px 6px -1px rgb(0 0 0 / 0.08),
            0 2px 4px -2px rgb(0 0 0 / 0.06);
          padding: 12mm;
        }
        .poa-editor-shell .ProseMirror {
          min-height: calc(297mm - 24mm);
          width: 100%;
          outline: none;
          line-height: 1.625;
        }
        .poa-editor-shell .ProseMirror p {
          margin: 0;
          padding: 0;
        }
        .poa-editor-shell .ProseMirror p.is-editor-empty:first-child::before {
          color: #9ca3af;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
        .poa-editor-shell .ProseMirror mark {
          background-color: #fef08a;
        }
        .poa-editor-shell .ProseMirror [data-poa-outline="1"],
        .poa-editor-shell .ProseMirror .poa-outline {
          border: 1px solid #1f2937;
          border-radius: 0.125rem;
          padding: 0 0.125rem;
        }
        .poa-editor-shell .ProseMirror [data-poa-ai-added="1"],
        .poa-editor-shell .ProseMirror .poa-ai-added {
          background: rgba(52, 211, 153, 0.28);
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .poa-editor-shell .ProseMirror [data-poa-ai-changed="1"],
        .poa-editor-shell .ProseMirror .poa-ai-changed {
          background: rgba(251, 191, 36, 0.32);
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .poa-editor-scroll {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .poa-editor-scroll::-webkit-scrollbar {
          display: none;
        }
        @keyframes ai-cook-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes ai-cook-spin-rev {
          to { transform: rotate(-360deg); }
        }
        @keyframes ai-cook-pulse {
          0%, 100% { transform: scale(0.92); opacity: 0.45; }
          50% { transform: scale(1.05); opacity: 0.9; }
        }
        @keyframes ai-cook-sparkle {
          0%, 100% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.12) rotate(10deg); }
        }
        .ai-cooking-loader {
          width: 5.75rem;
          height: 5.75rem;
        }
        .ai-cooking-ring-outer {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: conic-gradient(from 0deg, #e879f9, #a855f7, #6366f1, #38bdf8, #e879f9);
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
          animation: ai-cook-spin 1.15s linear infinite;
        }
        .ai-cooking-ring-inner {
          position: absolute;
          inset: 12px;
          border-radius: 9999px;
          border: 2px solid transparent;
          border-top-color: #c4b5fd;
          border-right-color: #67e8f9;
          border-bottom-color: #f0abfc;
          animation: ai-cook-spin-rev 0.85s linear infinite;
        }
        .ai-cooking-glow {
          position: absolute;
          inset: 20px;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(167,139,250,0.45) 0%, rgba(56,189,248,0.2) 55%, transparent 72%);
          animation: ai-cook-pulse 2.1s ease-in-out infinite;
        }
        .ai-cooking-sparkle {
          animation: ai-cook-sparkle 1.7s ease-in-out infinite;
        }
      `}</style>
      <div
        ref={editorHeaderRef}
        className="z-40 shrink-0 border-b border-gray-200/70 bg-white/90 shadow-sm backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3">
          <button
            type="button"
            onClick={goBack}
            className="btn btn-sm h-9 min-h-9 gap-1.5 rounded-full border-0 bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 sm:px-4"
          >
            <ArrowLeftIcon className="h-4 w-4 shrink-0 opacity-90" />
            <span>Back</span>
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Power of Attorney</p>
            <p className="truncate text-base font-semibold text-gray-900">{data.document.name}</p>
            <p className="truncate text-xs text-gray-500">{data.contact.name || 'Contact'}</p>
          </div>

          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[data.poa.status] || 'bg-gray-100 text-gray-600'}`}
          >
            {POA_STATUS_LABELS[data.poa.status] || data.poa.status}
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <button
                type="button"
                className={headerToolbarBtnClass(insertPanelOpen)}
                onClick={() => setInsertPanelOpen((v) => !v)}
              >
                <PlusIcon className="h-4 w-4" />
                Insert a field
              </button>
            )}
            <button
              type="button"
              className={headerToolbarBtnClass(fieldsPanelOpen)}
              onClick={() => setFieldsPanelOpen((v) => !v)}
            >
              Fields
              <span className="badge badge-sm ml-1 border-none bg-gray-200 text-gray-700">
                {form.fields.length}
              </span>
            </button>

            <div className="relative" ref={actionsMenuRef}>
              <button
                type="button"
                className={`${headerToolbarBtnClass(actionsMenuOpen)} gap-1`}
                aria-expanded={actionsMenuOpen}
                onClick={() => setActionsMenuOpen((v) => !v)}
              >
                Actions
                <ChevronDownIcon className={`h-4 w-4 transition-transform ${actionsMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {actionsMenuOpen && (
                <div
                  className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => {
                      setShowPreview((v) => !v);
                      setActionsMenuOpen(false);
                    }}
                  >
                    <EyeIcon className="h-4 w-4 shrink-0 text-gray-500" />
                    {showPreview ? 'Back to editor' : 'Preview'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => {
                      void copyLink();
                      setActionsMenuOpen(false);
                    }}
                  >
                    <ClipboardDocumentIcon className="h-4 w-4 shrink-0 text-gray-500" />
                    Copy link
                  </button>
                  <a
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    href={buildPoaUrl(data.poa.secure_token)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setActionsMenuOpen(false)}
                  >
                    <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0 text-gray-500" />
                    Client view
                  </a>
                </div>
              )}
            </div>

            {!readOnly && (
              <button
                type="button"
                className="btn btn-sm btn-primary h-9 min-h-9 rounded-full border-0 px-5 font-medium"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? <span className="loading loading-spinner loading-xs" /> : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>

      {readOnly && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">
          This POA is {data.poa.status} and can no longer be edited. You can still view it and copy the link.
        </div>
      )}

      {data.document.description && (
        <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2 text-sm text-gray-500 sm:px-6">
          {data.document.description}
        </div>
      )}

      {showPreview ? (
        <div className="poa-editor-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="flex justify-center px-4 py-8 sm:px-6">
            <div className="poa-a4-page shrink-0">
              <TemplatePoaDoc
                ctrl={previewCtrl}
                body={form.body}
                fields={form.fields}
                direction={form.direction}
                fontFamily={form.font_family}
                fontSize={form.font_size}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop: fixed left icon rail */}
          <aside
            ref={formatRailDesktopRef}
            className="fixed bottom-0 left-0 z-[35] hidden w-[4.5rem] flex-col overflow-visible border-r border-gray-200 bg-gray-50 lg:flex"
            style={{ top: editorRailTopPx }}
          >
            <div
              className="poa-editor-scroll overflow-y-auto overflow-x-visible"
              style={{ maxHeight: `calc(100dvh - ${editorRailTopPx}px)` }}
            >
              {renderSidePanelContent(false)}
            </div>
          </aside>

          <div className={`flex min-h-0 flex-1 overflow-hidden lg:pl-[4.5rem] ${aiReviewOpen ? 'lg:pr-[28rem]' : ''}`}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
              {/* Mobile: horizontal format strip */}
              <div
                ref={formatRailMobileRef}
                className="flex shrink-0 items-center justify-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 lg:hidden"
              >
                {renderFormatControls()}
              </div>

              {/* Document: only this area scrolls with the page layout */}
              <div className="poa-editor-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
                <div className="flex justify-center">
                  <div className="poa-a4-page shrink-0">
                    <EditorContent
                      editor={editor}
                      style={{ fontFamily: form.font_family, fontSize: form.font_size }}
                      dir={form.direction}
                      className="poa-editor-shell"
                    />
                  </div>
                </div>
              </div>

              {/* Right: fixed-height panels with independent scroll */}
              {rightPanelOpen && (
                <div className="flex min-h-0 w-full shrink-0 flex-col gap-6 overflow-hidden bg-gray-100 px-4 py-5 lg:w-80 lg:border-l lg:border-gray-200/60 xl:w-[22rem]">
                  {insertPanelOpen && !readOnly && (
                    <div
                      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ${
                        fieldsPanelOpen ? 'max-h-[min(16rem,38%)] shrink-0 lg:max-h-[38%]' : 'flex-1'
                      }`}
                    >
                      <div className="poa-editor-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
                        <div className="flex flex-wrap gap-2.5">
                          {POA_FIELD_CATALOG.map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => addCatalogField(item.key)}
                              className={`btn btn-sm ${usedKeys.has(item.key) ? 'btn-primary' : 'btn-outline'} gap-1.5`}
                              title={item.hint || item.label}
                            >
                              <PlusIcon className="h-4 w-4" />
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {fieldsPanelOpen && (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      <div className="poa-editor-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        {form.fields.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-gray-300 bg-white/70 px-4 py-8 text-center text-sm text-gray-400">
                            No fields yet.{!readOnly ? ' Open Insert a field to add some.' : ''}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {form.fields.map((f) => (
                              <div
                                key={f.key}
                                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                              >
                                <div className="mb-3 flex items-center justify-between gap-2">
                                  <code className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                                    {poaToken(f.key)}
                                  </code>
                                  {!readOnly && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm btn-circle text-gray-400 hover:bg-red-50 hover:text-error"
                                      onClick={() => removeField(f.key)}
                                      title="Remove field"
                                    >
                                      <XMarkIcon className="h-5 w-5" />
                                    </button>
                                  )}
                                </div>
                                <input
                                  className="input input-bordered input-sm mb-3 w-full"
                                  value={f.label}
                                  readOnly={readOnly}
                                  onChange={(e) => updateField(f.key, { label: e.target.value })}
                                  placeholder="Field label"
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                  <select
                                    className="select select-bordered select-sm"
                                    value={f.type}
                                    disabled={readOnly}
                                    onChange={(e) => updateField(f.key, { type: e.target.value as PoaFieldType })}
                                  >
                                    {FIELD_TYPE_OPTIONS.map((t) => (
                                      <option key={t} value={t}>
                                        {POA_FIELD_TYPE_LABELS[t]}
                                      </option>
                                    ))}
                                  </select>
                                  {f.type !== 'signature' && (
                                    <select
                                      className="select select-bordered select-sm"
                                      value={f.prefill}
                                      disabled={readOnly}
                                      onChange={(e) =>
                                        updateField(f.key, { prefill: e.target.value as PoaPrefillSource })
                                      }
                                    >
                                      {PREFILL_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-600">
                                    Required
                                    <input
                                      type="checkbox"
                                      className="toggle toggle-sm toggle-success"
                                      checked={f.required}
                                      disabled={readOnly}
                                      onChange={(e) => updateField(f.key, { required: e.target.checked })}
                                    />
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {improvingPoa ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-poa-cooking-title"
          aria-busy="true"
        >
          <div className="relative mx-4 flex w-full max-w-sm flex-col items-center overflow-hidden rounded-3xl border border-gray-200 bg-white px-8 py-10 text-center shadow-2xl">
            <div className="ai-cooking-loader relative mb-6 flex items-center justify-center">
              <div className="ai-cooking-ring-outer" aria-hidden="true" />
              <div className="ai-cooking-ring-inner" aria-hidden="true" />
              <div className="ai-cooking-glow" aria-hidden="true" />
              <SparklesIconSolid className="ai-cooking-sparkle relative z-10 h-9 w-9 text-violet-600 drop-shadow-sm" />
            </div>
            <p id="ai-poa-cooking-title" className="bg-gradient-to-r from-fuchsia-600 via-violet-600 to-indigo-600 bg-clip-text text-lg font-bold text-transparent">
              AI is cooking
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">
              {aiThinkingText?.trim() ||
                (form?.body?.trim()
                  ? 'Improving your POA with meeting summaries…'
                  : 'Drafting your POA with meeting summaries…')}
            </p>
          </div>
        </div>
      ) : null}

      <ContractAiReviewPanel
        isOpen={aiReviewOpen}
        onClose={() => {
          setShowAiReviewPanel(false);
          setAiRemarksInput('');
        }}
        initialSummary={aiReviewNotes}
        messages={aiReviewChatMessages}
        remarks={aiRemarksInput}
        onRemarksChange={setAiRemarksInput}
        onApplyRemarks={() => void handleApplyAiRemarks()}
        isApplying={aiChatLoading || improvingPoa}
        thinkingText={aiThinkingText}
        title={
          <span className="flex items-center gap-2">
            <SparklesIconSolid className="h-5 w-5 shrink-0 text-violet-600" />
            <span>AI POA Review</span>
          </span>
        }
        subtitle="Ask questions or request POA changes"
      />

      {!readOnly && !showPreview ? (
        <div
          className={`fixed bottom-6 right-4 z-[45] flex flex-col gap-2 sm:bottom-8 sm:right-6 sm:flex-row sm:items-center ${
            aiReviewOpen ? 'lg:right-[29rem]' : rightPanelOpen ? 'lg:right-[23rem] xl:right-[24rem]' : ''
          }`}
        >
          <button
            type="button"
            className="btn h-12 min-h-12 gap-2 rounded-full border-0 bg-gradient-to-r from-fuchsia-600 via-violet-600 to-indigo-600 px-5 text-white shadow-lg shadow-violet-500/35 transition hover:scale-[1.02] hover:shadow-xl hover:shadow-violet-500/45 disabled:opacity-70"
            onClick={() => void handleImprovePoaWithAi()}
            disabled={improvingPoa || aiChatLoading}
            title="Improve or draft POA with AI using meeting summaries"
            aria-label="AI Summary — improve POA with meeting summaries"
          >
            <SparklesIcon className="h-6 w-6 shrink-0" />
            <span className="text-sm font-semibold tracking-tight">AI Summary</span>
          </button>
          <button
            type="button"
            className="btn h-12 min-h-12 gap-2 rounded-full border-2 border-violet-300 bg-white px-5 text-violet-700 shadow-md transition hover:scale-[1.02] hover:border-violet-400 hover:bg-violet-50 disabled:opacity-70"
            onClick={() => void handleOpenAiReviewPanel()}
            disabled={improvingPoa || aiChatLoading}
            title="Open AI POA review chat to request changes"
            aria-label="AI Review — open chat to request POA changes"
          >
            <ChatBubbleLeftRightIcon className="h-6 w-6 shrink-0" />
            <span className="text-sm font-semibold tracking-tight">AI Review</span>
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default PoaDocumentEditor;
