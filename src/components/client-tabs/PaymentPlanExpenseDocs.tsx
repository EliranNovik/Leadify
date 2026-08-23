import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import ExpenseDocumentsDrawer from '../finance/ExpenseDocumentsDrawer';
import DocumentViewerModal, { type DocumentViewerItem } from '../DocumentViewerModal';
import { FINANCE_EXPENSE_DOCUMENTS_BUCKET } from '../../lib/financeExpenseDocuments';
import {
  fetchLeadExpenses,
  type LeadExpenseRow,
} from '../../lib/leadExpenses';
import { resolveLeadFeeIdentity } from '../../lib/leadSubcontractorFees';
import {
  fetchFinanceDocsByDestinationIds,
  type FinanceExpenseEntryRow,
} from '../../lib/financeExpenseCreate';
import type { FinanceExpenseDocumentRow } from '../../lib/financeExpenseDocuments';
import { isExpenseNoVatPayment } from '../../lib/proformaVat';

type DocsBundle = { entryId: number; documents: FinanceExpenseDocumentRow[] };

type PaymentDocHit = {
  expense: LeadExpenseRow;
  docs: DocsBundle;
  count: number;
};

function expenseToDocsRow(row: LeadExpenseRow, docs?: DocsBundle): FinanceExpenseEntryRow {
  return {
    id: docs?.entryId || 0,
    listKey: `lead:${row.id}`,
    created_at: row.created_at,
    kind: 'lead',
    destination_table: 'lead_expenses',
    destination_id: String(row.id),
    expense_date: row.expense_date,
    amount: Number(row.amount) || 0,
    currency_code: row.accounting_currencies?.iso_code || row.accounting_currencies?.name || null,
    firm_id: null,
    new_lead_id: row.new_lead_id,
    legacy_lead_id: row.legacy_lead_id,
    category_label: row.lead_expense_types?.label || null,
    vendor_label: row.leads_contact?.name || null,
    lead_number: row.lead_number,
    notes: row.notes,
    created_by: row.created_by,
    created_by_name: null,
    created_by_photo: null,
    documents: docs?.documents || [],
  };
}

function paymentDocsKey(isLegacy: boolean | undefined, id: string | number | null | undefined): string | null {
  if (id == null || id === '') return null;
  return `${isLegacy ? 'legacy' : 'new'}:${id}`;
}

export function usePaymentPlanExpenseDocs(client: {
  id?: string | number | null;
  lead_type?: string | null;
  lead_number?: string | null;
}) {
  const identity = useMemo(
    () => resolveLeadFeeIdentity(client),
    [client?.id, client?.lead_type, client?.lead_number],
  );
  const [byPaymentKey, setByPaymentKey] = useState<Map<string, PaymentDocHit>>(new Map());
  const [docsRow, setDocsRow] = useState<FinanceExpenseEntryRow | null>(null);
  const [viewerDocs, setViewerDocs] = useState<DocumentViewerItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!identity) {
      setByPaymentKey(new Map());
      return;
    }
    try {
      const rows = await fetchLeadExpenses(identity);
      const docsMap = await fetchFinanceDocsByDestinationIds(
        'lead_expenses',
        rows.map((row) => row.id),
      );
      const next = new Map<string, PaymentDocHit>();
      rows.forEach((row) => {
        const bundle = docsMap.get(String(row.id)) || { entryId: 0, documents: [] };
        const count = bundle.documents.length;
        const hit: PaymentDocHit = { expense: row, docs: bundle, count };
        const keys = [
          paymentDocsKey(false, row.payment_plan_id),
          paymentDocsKey(true, row.legacy_payment_plan_row_id),
        ].filter(Boolean) as string[];
        keys.forEach((key) => {
          const prev = next.get(key);
          if (!prev || count > prev.count) next.set(key, hit);
        });
      });
      setByPaymentKey(next);
    } catch (err) {
      console.warn('[usePaymentPlanExpenseDocs]', err);
      setByPaymentKey(new Map());
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChange = () => {
      void load();
    };
    window.addEventListener('paymentPlan:changed', onChange);
    return () => window.removeEventListener('paymentPlan:changed', onChange);
  }, [load]);

  const openForPayment = (payment: { id?: string | number; isLegacy?: boolean; order?: string | number | null }) => {
    const key = paymentDocsKey(payment.isLegacy, payment.id);
    if (!key) return;
    const hit = byPaymentKey.get(key);
    if (!hit) return;
    setDocsRow(expenseToDocsRow(hit.expense, hit.docs));
  };

  const renderType = (
    payment: { id?: string | number; isLegacy?: boolean; order?: string | number | null },
    label: React.ReactNode,
  ) => {
    const isExpense = isExpenseNoVatPayment(payment.order) || isExpenseNoVatPayment(String(label ?? ''));
    const key = paymentDocsKey(payment.isLegacy, payment.id);
    const hit = isExpense && key ? byPaymentKey.get(key) : null;
    const category = hit?.expense.lead_expense_types?.label?.trim() || null;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span title={category || undefined}>
          {label}
        </span>
        {hit && hit.count > 0 ? (
          <button
            type="button"
            className="relative inline-flex h-7 w-7 items-center justify-center rounded-full text-blue-600 hover:bg-blue-50"
            title={`${hit.count} document${hit.count === 1 ? '' : 's'}`}
            aria-label={`${hit.count} expense documents`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openForPayment(payment);
            }}
          >
            <DocumentTextIcon className="h-5 w-5" />
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
              {hit.count}
            </span>
          </button>
        ) : null}
      </span>
    );
  };

  const layer = (
    <>
      <ExpenseDocumentsDrawer
        open={Boolean(docsRow)}
        row={docsRow}
        onClose={() => setDocsRow(null)}
        onChanged={() => void load()}
        onOpenDocument={(docs, index) => {
          setViewerDocs(docs);
          setViewerIndex(index);
        }}
      />
      <DocumentViewerModal
        isOpen={viewerIndex !== null && viewerDocs.length > 0}
        onClose={() => {
          setViewerIndex(null);
          setViewerDocs([]);
        }}
        documents={viewerDocs}
        initialIndex={viewerIndex ?? 0}
        bucketName={FINANCE_EXPENSE_DOCUMENTS_BUCKET}
      />
    </>
  );

  return { renderType, layer };
}
