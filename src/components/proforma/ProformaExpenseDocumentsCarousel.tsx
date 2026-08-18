import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import DocumentViewerModal, { type DocumentViewerItem } from '../DocumentViewerModal';
import DocumentSidebarThumb from '../DocumentSidebarThumb';
import {
  FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL,
  type FinanceExpenseDocumentType,
} from '../../lib/financeExpenseDocuments';
import {
  fetchSignedProformaExpenseDocuments,
  toProformaExpenseViewerItems,
  type ProformaExpenseDocSource,
} from '../../lib/proformaExpenseDocuments';

type Props = {
  source: ProformaExpenseDocSource | null;
  className?: string;
};

function typeLabel(name: string, fileType?: string): string {
  const lower = `${name} ${fileType || ''}`.toLowerCase();
  if (lower.includes('receipt')) return FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL.receipt;
  if (lower.includes('invoice')) return FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL.invoice;
  return 'Document';
}

const ProformaExpenseDocumentsCarousel: React.FC<Props> = ({ source, className = '' }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [docs, setDocs] = useState<DocumentViewerItem[]>([]);
  const [typeById, setTypeById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const sourceKey = !source
    ? ''
    : source.type === 'new'
      ? `new:${source.leadId || ''}`
      : source.type === 'legacy'
        ? `legacy:${source.leadId || ''}`
        : source.type === 'public-new'
          ? `public-new:${source.paymentPlanId}:${source.token}`
          : `public-legacy:${source.proformaId}:${source.token}`;

  useEffect(() => {
    if (!source || !sourceKey) {
      setDocs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const signed = await fetchSignedProformaExpenseDocuments(source);
        if (cancelled) return;
        const types: Record<string, string> = {};
        signed.forEach((doc) => {
          const kind = doc.document_type as FinanceExpenseDocumentType;
          types[String(doc.id)] = FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL[kind] || 'Document';
        });
        setTypeById(types);
        setDocs(toProformaExpenseViewerItems(signed));
      } catch (err) {
        console.warn('[ProformaExpenseDocumentsCarousel]', err);
        if (!cancelled) setDocs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // sourceKey captures the identity; source is read inside for the fetch payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const scrollByCard = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.7, 280), behavior: 'smooth' });
  };

  if (!source || (!loading && docs.length === 0)) return null;

  return (
    <div className={`print-hide ${className}`.trim()}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-gray-900">Expense documents</h3>
        {docs.length > 3 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle"
              aria-label="Previous documents"
              onClick={() => scrollByCard(-1)}
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle"
              aria-label="Next documents"
              onClick={() => scrollByCard(1)}
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
        ) : null}
      </div>
      {loading && docs.length === 0 ? (
        <div className="flex h-36 items-center justify-center rounded-2xl border border-gray-200 bg-white">
          <span className="loading loading-spinner loading-md text-blue-600" />
        </div>
      ) : (
        <div
          ref={scrollerRef}
          className="flex gap-3 overflow-x-auto pb-2 scroll-smooth [scrollbar-width:thin]"
        >
          {docs.map((doc, index) => (
            <button
              key={doc.id}
              type="button"
              className="w-36 shrink-0 rounded-2xl border border-gray-200 bg-white p-2 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md"
              onClick={() => setViewerIndex(index)}
            >
              <DocumentSidebarThumb
                name={doc.name}
                url={doc.url}
                fileType={doc.fileType || ''}
                storagePath={doc.storagePath}
              />
              <div className="mt-2 truncate text-xs font-semibold text-gray-800" title={doc.name}>
                {doc.name}
              </div>
              <div className="truncate text-[11px] text-gray-500">
                {typeById[doc.id] || typeLabel(doc.name, doc.fileType)}
              </div>
            </button>
          ))}
        </div>
      )}
      <DocumentViewerModal
        isOpen={viewerIndex !== null && docs.length > 0}
        onClose={() => setViewerIndex(null)}
        documents={docs}
        initialIndex={viewerIndex ?? 0}
      />
    </div>
  );
};

export default ProformaExpenseDocumentsCarousel;
