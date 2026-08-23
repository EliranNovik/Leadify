import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EditorContent, useEditor, type Content, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { FontSize } from '@tiptap/extension-font-size';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import {
  ArrowDownOnSquareIcon,
  ArrowLeftIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  Bars3BottomLeftIcon,
  Bars3BottomRightIcon,
  BoldIcon,
  ChatBubbleLeftRightIcon,
  ItalicIcon,
  LinkIcon,
  ListBulletIcon,
  NumberedListIcon,
  PrinterIcon,
  ShareIcon,
  SparklesIcon,
  UnderlineIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import ContractAiReviewPanel, { type ContractAiReviewMessage } from './ContractAiReviewPanel';
import WordDocumentLetterhead, { WordDocumentFooterBar } from './WordDocumentLetterhead';
import { fetchCompanySignatureSettings } from '../lib/companyEmailSignature';
import { shareOrCopyUrl } from '../lib/webShare';
import {
  buildWordDocumentPublicUrl,
  ensureWordDocumentPublicToken,
  fetchLeadForWordPage,
  fetchLeadWordDocument,
  uploadWordDocumentToCaseFolder,
  upsertLeadWordDocument,
  wordDocumentFolderOptions,
  WORD_DOC_EMPTY_CONTENT,
  type LeadWordDocumentRow,
  type WordPageLead,
} from '../lib/leadWordDocuments';
import {
  aiTextToTiptapDoc,
  sendWordDocumentAiChatMessage,
  tiptapJsonToAiText,
} from '../lib/wordDocumentAiApi';
import { buildWordDocumentBlob, letterheadFromSettings, wordFileName, type WordLetterhead } from '../lib/wordDocumentDocx';
import type { CaseDocumentCategoryKey } from '../lib/sequenceOfEventsDocuments';

const BAR_ICON =
  'btn btn-ghost btn-circle h-10 w-10 min-h-10 border-0 text-[#57534e] hover:bg-[#1c1917]/8';
const HEADER_ACTION =
  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-[#44403c] transition-all duration-150 hover:-translate-y-0.5 hover:bg-white hover:text-[#1c1917] hover:shadow-md disabled:pointer-events-none disabled:opacity-50';
const HEADER_AI =
  'inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#1c1917] px-5 text-sm font-semibold text-[#f7f4ee] transition-all duration-150 hover:-translate-y-0.5 hover:bg-black hover:shadow-lg';
const TOOL_BTN = 'btn btn-ghost btn-xs h-8 min-h-8 rounded-lg px-2 text-[#44403c]';
const TOOL_BTN_ON = `${TOOL_BTN} bg-[#1c1917]/10 text-[#1c1917]`;
const TOOL_SELECT =
  'h-8 rounded-lg border border-[#d6d3d1] bg-white px-2 text-xs text-[#1c1917] outline-none focus:border-[#a8a29e]';

const FONT_FAMILIES = [
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Calibri',
  'Cambria',
  'Candara',
  'Century Gothic',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'David',
  'FrankRuehl',
  'Garamond',
  'Georgia',
  'Gisha',
  'Helvetica',
  'Impact',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Miriam',
  'Narkisim',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
] as const;

const FONT_SIZES = ['10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '36pt'] as const;

const extensions = [
  StarterKit,
  Underline,
  Link.configure({ openOnClick: false, HTMLAttributes: { class: 'underline' } }),
  Placeholder.configure({ placeholder: 'Start writing, or ask AI to draft this document…' }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }),
  Color,
  TextStyle,
  FontFamily,
  FontSize,
];

function toolbarFocus(editor: Editor) {
  setTimeout(() => editor.commands.focus(), 10);
}

function toolClass(active: boolean) {
  return active ? TOOL_BTN_ON : TOOL_BTN;
}

function WordEditorToolbar({ editor }: { editor: Editor }) {
  const fontFamily = String(editor.getAttributes('textStyle').fontFamily || 'Arial');
  const fontSize = String(editor.getAttributes('textStyle').fontSize || '12pt');
  const textColor = String(editor.getAttributes('textStyle').color || '#1c1917');
  const highlightColor = String(editor.getAttributes('highlight').color || '#fef08a');

  const setLink = () => {
    const previous = String(editor.getAttributes('link').href || '');
    const next = window.prompt('Link URL', previous);
    if (next == null) return;
    if (!next.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: next.trim() }).run();
    toolbarFocus(editor);
  };

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-3 py-1.5 sm:px-4">
      <button type="button" className={TOOL_BTN} title="Undo" onClick={() => { editor.chain().focus().undo().run(); toolbarFocus(editor); }}>
        <ArrowUturnLeftIcon className="h-4 w-4" />
      </button>
      <button type="button" className={TOOL_BTN} title="Redo" onClick={() => { editor.chain().focus().redo().run(); toolbarFocus(editor); }}>
        <ArrowUturnRightIcon className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px shrink-0 bg-[#d6d3d1]" aria-hidden />
      <select
        className={`${TOOL_SELECT} min-w-[10.5rem]`}
        title="Font"
        style={{ fontFamily: FONT_FAMILIES.includes(fontFamily as (typeof FONT_FAMILIES)[number]) ? fontFamily : 'Arial' }}
        value={FONT_FAMILIES.includes(fontFamily as (typeof FONT_FAMILIES)[number]) ? fontFamily : 'Arial'}
        onChange={(e) => {
          editor.chain().focus().setFontFamily(e.target.value).run();
          toolbarFocus(editor);
        }}
      >
        {FONT_FAMILIES.map((font) => (
          <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
        ))}
      </select>
      <select
        className={`${TOOL_SELECT} w-[4.25rem]`}
        title="Font size"
        value={FONT_SIZES.includes(fontSize as (typeof FONT_SIZES)[number]) ? fontSize : '12pt'}
        onChange={(e) => {
          editor.chain().focus().setFontSize(e.target.value).run();
          toolbarFocus(editor);
        }}
      >
        {FONT_SIZES.map((size) => (
          <option key={size} value={size}>{size.replace('pt', '')}</option>
        ))}
      </select>
      <span className="mx-1 h-5 w-px shrink-0 bg-[#d6d3d1]" aria-hidden />
      <button type="button" className={toolClass(editor.isActive('bold'))} title="Bold" onClick={() => { editor.chain().focus().toggleBold().run(); toolbarFocus(editor); }}>
        <BoldIcon className="h-4 w-4" />
      </button>
      <button type="button" className={toolClass(editor.isActive('italic'))} title="Italic" onClick={() => { editor.chain().focus().toggleItalic().run(); toolbarFocus(editor); }}>
        <ItalicIcon className="h-4 w-4" />
      </button>
      <button type="button" className={toolClass(editor.isActive('underline'))} title="Underline" onClick={() => { editor.chain().focus().toggleUnderline().run(); toolbarFocus(editor); }}>
        <UnderlineIcon className="h-4 w-4" />
      </button>
      <button type="button" className={toolClass(editor.isActive('strike'))} title="Strikethrough" onClick={() => { editor.chain().focus().toggleStrike().run(); toolbarFocus(editor); }}>
        <s className="text-xs font-semibold">S</s>
      </button>
      <label className={`${TOOL_BTN} cursor-pointer`} title="Text color">
        <span className="relative flex h-4 w-4 items-center justify-center text-xs font-bold">
          A
          <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded" style={{ background: textColor }} />
        </span>
        <input
          type="color"
          className="sr-only"
          value={/^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : '#1c1917'}
          onChange={(e) => {
            editor.chain().focus().setColor(e.target.value).run();
            toolbarFocus(editor);
          }}
        />
      </label>
      <label className={`${toolClass(editor.isActive('highlight'))} cursor-pointer`} title="Highlight">
        <span className="rounded px-0.5 text-[11px] font-semibold" style={{ background: highlightColor }}>HL</span>
        <input
          type="color"
          className="sr-only"
          value={/^#[0-9a-fA-F]{6}$/.test(highlightColor) ? highlightColor : '#fef08a'}
          onChange={(e) => {
            editor.chain().focus().toggleHighlight({ color: e.target.value }).run();
            toolbarFocus(editor);
          }}
        />
      </label>
      <span className="mx-1 h-5 w-px shrink-0 bg-[#d6d3d1]" aria-hidden />
      <button type="button" className={toolClass(editor.isActive('heading', { level: 1 }))} title="Heading 1" onClick={() => { editor.chain().focus().toggleHeading({ level: 1 }).run(); toolbarFocus(editor); }}>
        H1
      </button>
      <button type="button" className={toolClass(editor.isActive('heading', { level: 2 }))} title="Heading 2" onClick={() => { editor.chain().focus().toggleHeading({ level: 2 }).run(); toolbarFocus(editor); }}>
        H2
      </button>
      <button type="button" className={toolClass(editor.isActive('bulletList'))} title="Bullets" onClick={() => { editor.chain().focus().toggleBulletList().run(); toolbarFocus(editor); }}>
        <ListBulletIcon className="h-4 w-4" />
      </button>
      <button type="button" className={toolClass(editor.isActive('orderedList'))} title="Numbered list" onClick={() => { editor.chain().focus().toggleOrderedList().run(); toolbarFocus(editor); }}>
        <NumberedListIcon className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px shrink-0 bg-[#d6d3d1]" aria-hidden />
      <button type="button" className={toolClass(editor.isActive({ textAlign: 'left' }))} title="Align left" onClick={() => { editor.chain().focus().setTextAlign('left').run(); toolbarFocus(editor); }}>
        <Bars3BottomLeftIcon className="h-4 w-4" />
      </button>
      <button type="button" className={toolClass(editor.isActive({ textAlign: 'center' }))} title="Align center" onClick={() => { editor.chain().focus().setTextAlign('center').run(); toolbarFocus(editor); }}>
        C
      </button>
      <button type="button" className={toolClass(editor.isActive({ textAlign: 'right' }))} title="Align right" onClick={() => { editor.chain().focus().setTextAlign('right').run(); toolbarFocus(editor); }}>
        <Bars3BottomRightIcon className="h-4 w-4" />
      </button>
      <button type="button" className={toolClass(editor.isActive({ textAlign: 'justify' }))} title="Justify" onClick={() => { editor.chain().focus().setTextAlign('justify').run(); toolbarFocus(editor); }}>
        J
      </button>
      <span className="mx-1 h-5 w-px shrink-0 bg-[#d6d3d1]" aria-hidden />
      <button type="button" className={toolClass(editor.isActive('link'))} title="Link" onClick={setLink}>
        <LinkIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

const WordDocumentPage: React.FC = () => {
  const navigate = useNavigate();
  const { lead_number: leadParam, id: docIdParam } = useParams<{
    lead_number: string;
    id?: string;
  }>();
  const paperRef = useRef<HTMLDivElement>(null);

  const [lead, setLead] = useState<WordPageLead | null>(null);
  const [draft, setDraft] = useState<LeadWordDocumentRow | null>(null);
  const [title, setTitle] = useState('Untitled document');
  const [letterhead, setLetterhead] = useState<WordLetterhead>(() => letterheadFromSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [folder, setFolder] = useState<CaseDocumentCategoryKey>('sequence_of_events');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRemarks, setAiRemarks] = useState('');
  const [aiMessages, setAiMessages] = useState<ContractAiReviewMessage[]>([]);
  const [aiApplying, setAiApplying] = useState(false);
  const [aiThinking, setAiThinking] = useState<string | null>(null);

  const editor = useEditor({
    extensions,
    content: WORD_DOC_EMPTY_CONTENT as Content,
    editorProps: {
      attributes: {
        class: 'word-doc-editor min-h-[12rem] outline-none text-[#1c1917]',
      },
    },
  });

  const leadNumber = lead?.lead_number || (leadParam ? decodeURIComponent(leadParam) : '');
  const folders = useMemo(() => wordDocumentFolderOptions(), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!leadParam) {
        setLoading(false);
        return;
      }
      try {
        const [nextLead, settings] = await Promise.all([
          fetchLeadForWordPage(leadParam),
          fetchCompanySignatureSettings().catch(() => null),
        ]);
        if (cancelled) return;
        setLead(nextLead);
        setLetterhead(letterheadFromSettings(settings));

        if (docIdParam) {
          const existing = await fetchLeadWordDocument(docIdParam);
          if (cancelled) return;
          if (existing) {
            setDraft(existing);
            setTitle(existing.title || 'Untitled document');
            if (existing.classification_key) setFolder(existing.classification_key);
            editor?.commands.setContent(existing.content || WORD_DOC_EMPTY_CONTENT);
          }
        }
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [leadParam, docIdParam, editor]);

  const persistDraft = useCallback(
    async (opts?: {
      classificationKey?: CaseDocumentCategoryKey | null;
      caseDocumentId?: string | null;
    }) => {
      if (!leadNumber) throw new Error('Lead number is required');
      const row = await upsertLeadWordDocument({
        id: draft?.id,
        leadNumber,
        title,
        content: editor?.getJSON() ?? WORD_DOC_EMPTY_CONTENT,
        classificationKey: opts?.classificationKey ?? draft?.classification_key ?? folder,
        caseDocumentId: opts?.caseDocumentId ?? draft?.case_document_id,
        publicToken: draft?.public_token ?? null,
      });
      setDraft(row);
      if (!docIdParam && leadParam) {
        navigate(`/clients/${encodeURIComponent(leadParam)}/word-document/${row.id}`, { replace: true });
      }
      return row;
    },
    [draft, editor, folder, leadNumber, leadParam, navigate, title, docIdParam],
  );

  const handleSaveToFolder = async () => {
    if (!leadNumber) {
      toast.error('Lead number is required');
      return;
    }
    setSaving(true);
    try {
      const blob = await buildWordDocumentBlob({
        title,
        content: editor?.getJSON() ?? WORD_DOC_EMPTY_CONTENT,
        letterhead,
      });
      const file = new File([blob], wordFileName(title), {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const caseDocumentId = await uploadWordDocumentToCaseFolder({
        leadNumber,
        file,
        category: folder,
      });
      await persistDraft({ classificationKey: folder, caseDocumentId });
      setSaveOpen(false);
      toast.success('Saved as a Word document');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to save Word document');
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async () => {
    try {
      const row = await persistDraft();
      const withToken = await ensureWordDocumentPublicToken(row);
      setDraft(withToken);
      if (!withToken.public_token) throw new Error('Could not create a share link');
      await shareOrCopyUrl({
        url: buildWordDocumentPublicUrl(withToken.id, withToken.public_token),
        title,
        text: title,
      });
    } catch (err) {
      if (err instanceof Error && err.message) toast.error(err.message);
    }
  };

  const handlePrint = useCallback(() => {
    const node = paperRef.current;
    if (!node) {
      window.print();
      return;
    }

    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) {
      window.print();
      return;
    }

    const headStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((el) => el.outerHTML)
      .join('\n');
    const safeTitle = title.replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] || ch,
    );

    win.document.open();
    win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<base href="${window.location.origin}/" />
<title>${safeTitle}</title>
${headStyles}
<style>
  @page { size: A4; margin: 16mm; }
  html, body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
  }
  .word-doc-print-area,
  .contract-a4-page {
    width: 100% !important;
    max-width: none !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #fff !important;
  }
  .word-doc-print-area,
  .word-doc-print-area .word-doc-editor,
  .word-doc-print-area .ProseMirror {
    font-family: Arial, Helvetica, sans-serif !important;
    font-size: 12pt;
    line-height: 1.5;
    color: #1c1917 !important;
  }
</style>
</head>
<body>${node.outerHTML}</body>
</html>`);
    win.document.close();

    const waitForImages = () =>
      Promise.all(
        Array.from(win.document.images).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }),
        ),
      );

    const start = async () => {
      await waitForImages();
      win.setTimeout(() => {
        win.focus();
        win.print();
      }, 200);
    };

    if (win.document.readyState === 'complete') void start();
    else win.onload = () => void start();
  }, [title]);

  const handleApplyAi = async () => {
    const remarks = aiRemarks.trim();
    if (!remarks) return;
    setAiApplying(true);
    setAiThinking('Reading your request…');
    setAiMessages((prev) => [...prev, { role: 'user', content: remarks }]);
    setAiRemarks('');
    try {
      const result = await sendWordDocumentAiChatMessage(
        {
          currentDocumentText: tiptapJsonToAiText(editor?.getJSON() ?? WORD_DOC_EMPTY_CONTENT),
          userRemarks: remarks,
          clientName: lead?.name,
          leadNumber,
          language: lead?.language,
          category: lead?.category,
          chatHistory: aiMessages.map((m) => ({ role: m.role, content: m.content })),
        },
        (text) => setAiThinking(text),
      );
      if (result.intent === 'action' && editor) {
        editor.commands.setContent(aiTextToTiptapDoc(result.improvedDocumentText, editor.getJSON()));
      }
      setAiMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            result.intent === 'question'
              ? result.answer
              : result.changeSummary || 'Done — I updated the document.',
        },
      ]);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'AI request failed');
    } finally {
      setAiApplying(false);
      setAiThinking(null);
    }
  };

  const goBack = () => {
    if (leadParam) navigate(`/clients/${encodeURIComponent(leadParam)}`);
    else navigate(-1);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0eee9]">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className={`contract-studio min-h-screen ${aiOpen ? 'md:pr-[28rem]' : ''}`}>
      <style>{`
        @media print {
          @page { size: A4; margin: 16mm; }
          html, body, #root {
            background: #fff !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            display: block !important;
          }
          .print-hide,
          header,
          nav,
          [class*="sidebar"],
          [class*="Sidebar"] {
            display: none !important;
          }
          .app-main-scroll,
          .clients-detail-scroll,
          .contract-studio,
          .print-content-wrapper {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            background: #fff !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .print-content-wrapper {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
          }
          .word-doc-print-area {
            box-shadow: none !important;
            border: none !important;
            width: 100% !important;
            max-width: none !important;
            min-height: 0 !important;
          }
        }
        @page { size: A4; margin: 16mm; }
        .word-doc-print-area,
        .word-doc-print-area .word-doc-editor,
        .word-doc-print-area .ProseMirror {
          font-family: Arial, Helvetica, sans-serif !important;
          font-weight: 400;
          font-size: 12pt;
          line-height: 1.5;
          color: #1c1917;
        }
        .word-doc-editor p { margin: 0 0 0.85em; }
        .word-doc-editor h1 { font-size: 19pt; font-weight: 700; margin: 0 0 0.6em; }
        .word-doc-editor h2 { font-size: 15pt; font-weight: 700; margin: 0 0 0.5em; }
        .word-doc-editor ul { list-style: disc; padding-left: 1.25rem; margin: 0 0 0.85em; }
        .word-doc-editor ol { list-style: decimal; padding-left: 1.25rem; margin: 0 0 0.85em; }
        .word-doc-editor a { color: #1d4ed8; text-decoration: underline; }
        .word-doc-print-area {
          display: flex;
          flex-direction: column;
          min-height: 297mm;
        }
        .word-doc-print-area .ProseMirror,
        .word-doc-print-area .word-doc-editor {
          min-height: 8rem;
        }
      `}</style>

      <div className="print-hide sticky top-0 z-[45]">
        <div className="flex min-w-0 items-center gap-3 bg-[#f0eee9]/90 px-3 py-2 backdrop-blur sm:px-4">
          <button type="button" className={`${BAR_ICON} shrink-0`} onClick={goBack} aria-label="Back">
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full truncate border-0 bg-transparent text-lg font-semibold leading-tight text-[#1c1917] outline-none"
            />
            <p className="truncate text-xs text-[#78716c]">
              {lead?.name || 'Client'}
              {leadNumber ? ` · ${leadNumber}` : ''}
            </p>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto">
            <button type="button" className={HEADER_ACTION} onClick={() => setSaveOpen(true)}>
              <ArrowDownOnSquareIcon className="h-5 w-5" />
              Save
            </button>
            <button type="button" className={HEADER_ACTION} onClick={handlePrint}>
              <PrinterIcon className="h-5 w-5" />
              Print
            </button>
            <button type="button" className={HEADER_ACTION} onClick={() => void handleShare()}>
              <ShareIcon className="h-5 w-5" />
              Share
            </button>
            <button type="button" className={HEADER_AI} onClick={() => setAiOpen(true)}>
              <SparklesIcon className="h-5 w-5" />
              AI
            </button>
          </div>
        </div>
        {editor ? (
          <div className="pointer-events-none flex justify-center px-8 pb-2 pt-1 sm:px-16">
            <div className="pointer-events-auto w-fit max-w-full overflow-x-auto rounded-2xl bg-[#e7e5e4] shadow-md">
              <WordEditorToolbar editor={editor} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="print-content-wrapper flex justify-center px-3 py-8">
        <div
          ref={paperRef}
          id="word-document-print-area"
          className="contract-a4-page word-doc-print-area"
        >
          <WordDocumentLetterhead letterhead={letterhead} />
          <div className="min-h-0 flex-1">
            <EditorContent editor={editor} />
          </div>
          <WordDocumentFooterBar letterhead={letterhead} />
        </div>
      </div>

      {saveOpen ? (
        <div className="print-hide fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-[#1c1917]">Save as Word document</h2>
            <p className="mt-1 text-sm text-[#78716c]">Choose a case-documents folder. Default format is .docx.</p>
            <label className="mt-4 block text-sm font-medium text-[#44403c]">
              Title
              <input
                className="input input-bordered mt-1 w-full"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="mt-4 grid gap-2">
              {folders.map((item) => (
                <label
                  key={item.key}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                    folder === item.key ? 'border-[#1c1917] bg-[#f5f5f4]' : 'border-[#e7e5e4]'
                  }`}
                >
                  <input
                    type="radio"
                    name="word-folder"
                    checked={folder === item.key}
                    onChange={() => setFolder(item.key)}
                  />
                  {item.title}
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setSaveOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn border-0 bg-[#1c1917] text-white hover:bg-black"
                disabled={saving}
                onClick={() => void handleSaveToFolder()}
              >
                {saving ? 'Saving…' : 'Save Word file'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ContractAiReviewPanel
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
        initialSummary={null}
        messages={aiMessages}
        remarks={aiRemarks}
        onRemarksChange={setAiRemarks}
        onApplyRemarks={() => void handleApplyAi()}
        isApplying={aiApplying}
        thinkingText={aiThinking}
        title={
          <span className="flex items-center gap-2">
            <ChatBubbleLeftRightIcon className="h-5 w-5 shrink-0 text-violet-600" />
            <span>AI document assistant</span>
          </span>
        }
        subtitle="Describe the document you want, or ask for edits"
        placeholder="e.g. Draft a legal claims letter for this client…"
        conversationOnly
      />
    </div>
  );
};

export default WordDocumentPage;
