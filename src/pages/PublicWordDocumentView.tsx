import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { generateHTML } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { FontSize } from '@tiptap/extension-font-size';
import { Underline } from '@tiptap/extension-underline';
import { ArrowDownTrayIcon, PrinterIcon, ShareIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import html2pdf from 'html2pdf.js';
import WordDocumentLetterhead, { WordDocumentFooterBar } from '../components/WordDocumentLetterhead';
import { fetchCompanySignatureSettings } from '../lib/companyEmailSignature';
import {
  buildWordDocumentPublicUrl,
  fetchPublicLeadWordDocument,
  WORD_DOC_EMPTY_CONTENT,
  type LeadWordDocumentRow,
} from '../lib/leadWordDocuments';
import { letterheadFromSettings, type WordLetterhead } from '../lib/wordDocumentDocx';
import { shareOrCopyUrl } from '../lib/webShare';

const extensions = [
  StarterKit,
  Underline,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight,
  Color,
  TextStyle,
  FontFamily,
  FontSize,
];

const PublicWordDocumentView: React.FC = () => {
  const { id, token } = useParams<{ id: string; token: string }>();
  const paperRef = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState<LeadWordDocumentRow | null>(null);
  const [letterhead, setLetterhead] = useState<WordLetterhead>(() => letterheadFromSettings());
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!id || !token) {
        setMissing(true);
        setLoading(false);
        return;
      }
      try {
        const [doc, settings] = await Promise.all([
          fetchPublicLeadWordDocument(id, token),
          fetchCompanySignatureSettings().catch(() => null),
        ]);
        if (cancelled) return;
        if (!doc) {
          setMissing(true);
        } else {
          setRow(doc);
          setLetterhead(letterheadFromSettings(settings));
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setMissing(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  const html = useMemo(() => {
    try {
      return generateHTML(row?.content || WORD_DOC_EMPTY_CONTENT, extensions);
    } catch {
      return '<p></p>';
    }
  }, [row]);

  const handleShare = async () => {
    if (!row?.public_token) return;
    await shareOrCopyUrl({
      url: buildWordDocumentPublicUrl(row.id, row.public_token),
      title: row.title,
    });
  };

  const handlePdf = async () => {
    if (!paperRef.current || !row) return;
    try {
      await html2pdf(paperRef.current, {
        margin: [10, 10, 12, 10],
        filename: `${row.title || 'document'}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      });
    } catch {
      toast.error('PDF generation failed. Try Print and save as PDF.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0eee9]">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (missing || !row) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0eee9] px-6">
        <p className="text-center text-[#57534e]">This document link is invalid or no longer available.</p>
      </div>
    );
  }

  return (
    <div className="contract-studio min-h-screen">
      <style>{`
        @media print {
          .print-hide { display: none !important; }
          .word-doc-print-area { box-shadow: none !important; border: none !important; }
        }
        @page { size: A4; margin: 16mm; }
        .word-doc-print-area,
        .word-doc-body {
          font-family: Arial, Helvetica, sans-serif !important;
          font-weight: 400;
          font-size: 12pt;
          line-height: 1.5;
          color: #1c1917;
        }
        .word-doc-body p { margin: 0 0 0.85em; }
        .word-doc-body h1 { font-size: 19pt; font-weight: 700; margin: 0 0 0.6em; }
        .word-doc-body h2 { font-size: 15pt; font-weight: 700; margin: 0 0 0.5em; }
        .word-doc-body ul { list-style: disc; padding-left: 1.25rem; }
        .word-doc-body ol { list-style: decimal; padding-left: 1.25rem; }
        .word-doc-print-area {
          display: flex;
          flex-direction: column;
          min-height: 297mm;
        }
      `}</style>
      <div className="print-hide mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
        <h1 className="min-w-0 truncate text-lg font-semibold text-[#1c1917]">{row.title}</h1>
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
            <PrinterIcon className="h-5 w-5" />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handlePdf()}>
            <ArrowDownTrayIcon className="h-5 w-5" />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleShare()}>
            <ShareIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex justify-center px-3 pb-16">
        <div ref={paperRef} className="contract-a4-page word-doc-print-area">
          <WordDocumentLetterhead letterhead={letterhead} />
          <div className="word-doc-body min-h-0 flex-1" dangerouslySetInnerHTML={{ __html: html }} />
          <WordDocumentFooterBar letterhead={letterhead} />
        </div>
      </div>
    </div>
  );
};

export default PublicWordDocumentView;
