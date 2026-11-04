import React, { useEffect, useMemo, useState } from 'react';
import { ChatLeadNumberText } from './ChatLeadNumberText';
import { formatChatCurrencyText } from '../lib/leadCurrencyDisplay';
import {
  listSendInvoiceCandidates,
  sendInvoices,
  type SendInvoiceRow,
  type SendInvoiceSendResult,
} from '../lib/sendInvoiceAi';

export type ChatSendInvoicesData = {
  kind: 'send_invoices';
  phase?: 'pick_scope' | 'pick_period' | 'review' | 'done';
  leadQuery?: string;
  period?: string;
  count?: number;
  rows?: SendInvoiceRow[];
  results?: SendInvoiceSendResult[];
};

function initialSelectedIds(rows: SendInvoiceRow[] | undefined): Set<string> {
  return new Set((rows || []).map((row) => row.id));
}

export function parseSendInvoicesCard(raw: string): ChatSendInvoicesData | null {
  try {
    const parsed = JSON.parse(raw) as ChatSendInvoicesData;
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'send_invoices') return null;
    return parsed;
  } catch {
    return null;
  }
}

type PeriodChoice = 'today' | 'yesterday' | 'last_week' | 'custom';
type Phase = 'pick_scope' | 'pick_period' | 'review' | 'done';

export function ChatSendInvoiceCard({
  data,
  onChange,
}: {
  data: ChatSendInvoicesData;
  onChange?: (next: ChatSendInvoicesData, assistantText?: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>(
    data.phase || (data.rows?.length ? 'review' : data.leadQuery ? 'pick_scope' : 'pick_period'),
  );
  const [leadQuery, setLeadQuery] = useState(String(data.leadQuery || '').trim());
  const [rows, setRows] = useState<SendInvoiceRow[]>(data.rows || []);
  const [periodLabel, setPeriodLabel] = useState(data.period || '');
  const [selected, setSelected] = useState<Set<string>>(() => initialSelectedIds(data.rows));
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<SendInvoiceSendResult[]>(data.results || []);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    if (data.leadQuery) setLeadQuery(String(data.leadQuery).trim());
    if (data.rows?.length) {
      setRows(data.rows);
      setSelected(initialSelectedIds(data.rows));
      setPeriodLabel(data.period || '');
      setPhase(data.phase || 'review');
    } else if (data.phase === 'pick_scope') {
      setPhase('pick_scope');
    } else if (data.phase === 'pick_period') {
      setPhase('pick_period');
    }
    if (data.results?.length) setResults(data.results);
  }, [data]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );

  const goBackFromReview = () => {
    setError('');
    if (leadQuery) {
      setPhase('pick_scope');
      onChange?.(
        { kind: 'send_invoices', phase: 'pick_scope', leadQuery, rows: [] },
        'Send invoices for this lead, or pick a wider period?',
      );
      return;
    }
    setPhase('pick_period');
    onChange?.(
      { kind: 'send_invoices', phase: 'pick_period', rows: [] },
      'What period should I check for payments sent to finance without an invoice?',
    );
  };

  const loadForThisLead = async () => {
    const query = leadQuery.trim();
    if (!query) {
      setError('No lead is open.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { period, rows: nextRows } = await listSendInvoiceCandidates({ query });
      setRows(nextRows);
      setSelected(new Set(nextRows.map((row) => row.id)));
      setPeriodLabel(period);
      setPhase('review');
      onChange?.(
        {
          kind: 'send_invoices',
          phase: 'review',
          leadQuery: query,
          period,
          count: nextRows.length,
          rows: nextRows,
        },
        nextRows.length
          ? `Found ${nextRows.length} payment${nextRows.length === 1 ? '' : 's'} sent to finance without an invoice for this lead. Select rows and confirm to send.`
          : 'No payments sent to finance without an invoice for this lead.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const chooseMore = () => {
    setError('');
    setPhase('pick_period');
    onChange?.(
      {
        kind: 'send_invoices',
        phase: 'pick_period',
        leadQuery: leadQuery || undefined,
        rows: [],
      },
      'What period should I check for payments sent to finance without an invoice?',
    );
  };

  const loadPeriod = async (choice: PeriodChoice) => {
    setError('');
    setLoading(true);
    try {
      const args =
        choice === 'custom'
          ? { date_from: customFrom, date_to: customTo || customFrom }
          : { period: choice };
      if (choice === 'custom' && !customFrom.trim()) {
        setError('Pick a from date.');
        setLoading(false);
        return;
      }
      const { period, rows: nextRows } = await listSendInvoiceCandidates(args);
      setRows(nextRows);
      setSelected(new Set(nextRows.map((row) => row.id)));
      setPeriodLabel(period);
      setPhase('review');
      onChange?.(
        {
          kind: 'send_invoices',
          phase: 'review',
          leadQuery: leadQuery || undefined,
          period,
          count: nextRows.length,
          rows: nextRows,
        },
        nextRows.length
          ? `Found ${nextRows.length} payment${nextRows.length === 1 ? '' : 's'} sent to finance without an invoice for ${period}. Select rows and confirm to send.`
          : `No payments sent to finance without an invoice for ${period}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((row) => row.id)));
  };

  const confirmSend = async () => {
    if (!selectedRows.length) {
      setError('Select at least one row.');
      return;
    }
    setError('');
    setSending(true);
    setProgress('Sending…');
    try {
      const nextResults = await sendInvoices(selectedRows, (done, total) => {
        setProgress(`Sending ${done}/${total}…`);
      });
      setResults(nextResults);
      setPhase('done');
      const ok = nextResults.filter((row) => row.ok).length;
      const failed = nextResults.length - ok;
      const text =
        failed === 0
          ? `All done. Sent ${ok} invoice${ok === 1 ? '' : 's'} (email + WhatsApp when available).`
          : `Done. Sent ${ok}, failed ${failed}. Check the table for details.`;
      onChange?.(
        {
          kind: 'send_invoices',
          phase: 'done',
          leadQuery: leadQuery || undefined,
          period: periodLabel,
          count: nextResults.length,
          rows: selectedRows,
          results: nextResults,
        },
        text,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      setProgress('');
    }
  };

  if (phase === 'pick_scope') {
    return (
      <div className="ai-meeting-stack ai-fullwidth-card-stack">
        <div className="ai-meeting-card ai-signed-card">
          <div className="ai-meeting-card-head">
            <span />
            <span className="ai-meeting-card-lead">Send invoice</span>
          </div>
          <p className="ai-payment-remind-copy">
            Send invoices for this lead’s finance-ready unpaid rows, or pick a wider period?
          </p>
          <div className="ai-payment-remind-periods">
            <button
              type="button"
              className="ai-payment-remind-confirm"
              disabled={loading || !leadQuery}
              onClick={() => void loadForThisLead()}
            >
              {loading ? 'Loading…' : 'For this lead'}
            </button>
            <button
              type="button"
              className="ai-payment-remind-chip"
              disabled={loading}
              onClick={chooseMore}
            >
              More…
            </button>
          </div>
          {leadQuery ? (
            <p className="ai-payment-remind-status">
              Open lead: <ChatLeadNumberText text={leadQuery} />
            </p>
          ) : null}
          {error ? <p className="ai-payment-remind-error">{error}</p> : null}
        </div>
      </div>
    );
  }

  if (phase === 'pick_period') {
    return (
      <div className="ai-meeting-stack ai-fullwidth-card-stack">
        <div className="ai-meeting-card ai-signed-card">
          <div className="ai-meeting-card-head">
            <span />
            <span className="ai-meeting-card-lead">Send invoice period</span>
          </div>
          <p className="ai-payment-remind-copy">
            What period should I check for payments sent to finance without an invoice?
          </p>
          <div className="ai-payment-remind-periods">
            {(
              [
                ['today', 'Today'],
                ['yesterday', 'Yesterday'],
                ['last_week', 'Last week'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="ai-payment-remind-chip"
                disabled={loading}
                onClick={() => void loadPeriod(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ai-payment-remind-custom">
            <label>
              From
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                disabled={loading}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                disabled={loading}
              />
            </label>
            <button
              type="button"
              className="ai-payment-remind-chip"
              disabled={loading}
              onClick={() => void loadPeriod('custom')}
            >
              Custom range
            </button>
          </div>
          {leadQuery ? (
            <div className="ai-payment-remind-toolbar ai-payment-remind-toolbar-bottom">
              <button
                type="button"
                className="ai-payment-remind-chip"
                disabled={loading}
                onClick={() => {
                  setPhase('pick_scope');
                  setError('');
                }}
              >
                Back
              </button>
            </div>
          ) : null}
          {loading ? <p className="ai-payment-remind-status">Loading payments…</p> : null}
          {error ? <p className="ai-payment-remind-error">{error}</p> : null}
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const ok = results.filter((row) => row.ok).length;
    const failed = results.length - ok;
    return (
      <div className="ai-meeting-stack ai-fullwidth-card-stack">
        <div className="ai-meeting-card ai-signed-card">
          <div className="ai-meeting-card-head">
            <span />
            <span className="ai-meeting-card-lead">{periodLabel || 'Send invoice'}</span>
          </div>
          <div className="ai-signed-table-wrap">
            <table className="ai-signed-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.leadNumber ? <ChatLeadNumberText text={row.leadNumber} /> : '—'}
                    </td>
                    <td>{row.name || '—'}</td>
                    <td>{row.ok ? 'Sent' : 'Failed'}</td>
                    <td>{row.ok ? row.detail || '—' : row.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ai-signed-footer">
            <span>
              {ok} sent
              {failed ? ` · ${failed} failed` : ''}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-meeting-stack ai-fullwidth-card-stack">
      <div className="ai-meeting-card ai-signed-card">
        <div className="ai-meeting-card-head">
          <span />
          <span className="ai-meeting-card-lead">
            {periodLabel ? `Sent to finance ${periodLabel}` : 'Ready to invoice'}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="ai-payment-remind-copy">
            No payments sent to finance without an invoice in this period.
          </p>
        ) : (
          <>
            <div className="ai-payment-remind-toolbar">
              <label className="ai-payment-remind-check">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={sending} />
                Select all ({rows.length})
              </label>
            </div>
            <div className="ai-signed-table-wrap">
              <table className="ai-signed-table">
                <thead>
                  <tr>
                    <th />
                    <th>Lead</th>
                    <th>Client</th>
                    <th className="ai-signed-value">Amount</th>
                    <th>Type</th>
                    <th className="ai-signed-paid">Due</th>
                    <th>Sent to finance</th>
                    <th>Lang</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const checked = selected.has(row.id);
                    return (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={sending}
                            onChange={() => toggleRow(row.id)}
                          />
                        </td>
                        <td>
                          {row.leadNumber ? (
                            <ChatLeadNumberText text={row.leadNumber} />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{row.name || '—'}</td>
                        <td className="ai-signed-value">
                          {formatChatCurrencyText(row.amountLabel) || '—'}
                        </td>
                        <td>{row.orderLabel || '—'}</td>
                        <td className="ai-signed-paid">{row.dueLabel || '—'}</td>
                        <td>{row.sentToFinanceLabel || '—'}</td>
                        <td>{row.sendLanguage === 'he' ? 'HE' : 'EN'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="ai-payment-remind-toolbar ai-payment-remind-toolbar-bottom">
          <button
            type="button"
            className="ai-payment-remind-chip"
            disabled={loading || sending}
            onClick={goBackFromReview}
          >
            {leadQuery ? 'Change scope' : 'Change period'}
          </button>
          {rows.length > 0 ? (
            <button
              type="button"
              className="ai-payment-remind-confirm"
              disabled={sending || selectedRows.length === 0}
              onClick={() => void confirmSend()}
            >
              {sending ? progress || 'Sending…' : `Confirm send (${selectedRows.length})`}
            </button>
          ) : null}
        </div>
        {error ? <p className="ai-payment-remind-error">{error}</p> : null}
      </div>
    </div>
  );
}
