import React, { useEffect, useMemo, useState } from 'react';
import { ChatLeadNumberText } from './ChatLeadNumberText';
import { formatChatCurrencyText } from '../lib/leadCurrencyDisplay';
import {
  listPaymentReminderCandidates,
  sendPaymentReminders,
  type PaymentReminderRow,
  type PaymentReminderSendResult,
} from '../lib/paymentReminderAi';

export type ChatPaymentRemindersData = {
  kind: 'payment_reminders';
  phase?: 'pick_scope' | 'pick_period' | 'review' | 'done';
  /** Lead number / query used for “For this lead”. */
  leadQuery?: string;
  period?: string;
  count?: number;
  select?: 'all' | 'first';
  rows?: PaymentReminderRow[];
  results?: PaymentReminderSendResult[];
};

function initialSelectedIds(
  rows: PaymentReminderRow[] | undefined,
  select?: 'all' | 'first',
): Set<string> {
  const list = rows || [];
  if (!list.length) return new Set();
  if (select === 'first') return new Set([list[0].id]);
  return new Set(list.map((row) => row.id));
}

export function parsePaymentRemindersCard(raw: string): ChatPaymentRemindersData | null {
  try {
    const parsed = JSON.parse(raw) as ChatPaymentRemindersData;
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'payment_reminders') return null;
    return parsed;
  } catch {
    return null;
  }
}

type PeriodChoice = 'today' | 'yesterday' | 'last_week' | 'custom';
type ReminderPhase = 'pick_scope' | 'pick_period' | 'review' | 'done';

function reminderSentTooltip(row: PaymentReminderRow): string {
  const count = Number(row.reminderSentCount) || 0;
  const when = row.reminderSentLabel || null;
  if (when && count > 1) return `Reminder sent ${when} · ${count}×`;
  if (when) return `Reminder sent ${when}`;
  if (count > 1) return `Reminder sent ${count}×`;
  return 'Reminder already sent';
}

export function ChatPaymentReminderCard({
  data,
  onChange,
}: {
  data: ChatPaymentRemindersData;
  onChange?: (next: ChatPaymentRemindersData, assistantText?: string) => void;
}) {
  const [phase, setPhase] = useState<ReminderPhase>(
    data.phase || (data.rows?.length ? 'review' : data.leadQuery ? 'pick_scope' : 'pick_period'),
  );
  const [leadQuery, setLeadQuery] = useState(String(data.leadQuery || '').trim());
  const [rows, setRows] = useState<PaymentReminderRow[]>(data.rows || []);
  const [periodLabel, setPeriodLabel] = useState(data.period || '');
  const [selected, setSelected] = useState<Set<string>>(() =>
    initialSelectedIds(data.rows, data.select),
  );
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<PaymentReminderSendResult[]>(data.results || []);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    if (data.leadQuery) setLeadQuery(String(data.leadQuery).trim());
    if (data.rows?.length) {
      setRows(data.rows);
      setSelected(initialSelectedIds(data.rows, data.select));
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
        {
          kind: 'payment_reminders',
          phase: 'pick_scope',
          leadQuery,
          rows: [],
        },
        'Send reminders for this lead, or pick a wider period?',
      );
      return;
    }
    setPhase('pick_period');
    onChange?.(
      {
        kind: 'payment_reminders',
        phase: 'pick_period',
        leadQuery: leadQuery || undefined,
        rows: [],
      },
      'What period should I check for unpaid invoices?',
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
      const { period, rows: nextRows } = await listPaymentReminderCandidates({ query });
      setRows(nextRows);
      setSelected(new Set(nextRows.map((row) => row.id)));
      setPeriodLabel(period);
      setPhase('review');
      onChange?.(
        {
          kind: 'payment_reminders',
          phase: 'review',
          leadQuery: query,
          period,
          count: nextRows.length,
          rows: nextRows,
        },
        nextRows.length
          ? `Found ${nextRows.length} unpaid invoice${nextRows.length === 1 ? '' : 's'} for this lead. Select rows and confirm to send WhatsApp reminders.`
          : 'No unpaid invoiced payments for this lead.',
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
        kind: 'payment_reminders',
        phase: 'pick_period',
        leadQuery: leadQuery || undefined,
        rows: [],
      },
      'What period should I check for unpaid invoices?',
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
      const { period, rows: nextRows } = await listPaymentReminderCandidates(args);
      setRows(nextRows);
      setSelected(new Set(nextRows.map((row) => row.id)));
      setPeriodLabel(period);
      setPhase('review');
      onChange?.(
        {
          kind: 'payment_reminders',
          phase: 'review',
          leadQuery: leadQuery || undefined,
          period,
          count: nextRows.length,
          rows: nextRows,
        },
        nextRows.length
          ? `Found ${nextRows.length} unpaid invoice${nextRows.length === 1 ? '' : 's'} for ${period}. Select rows and confirm to send WhatsApp reminders.`
          : `No unpaid invoices found for ${period}.`,
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
      const nextResults = await sendPaymentReminders(selectedRows, (done, total) => {
        setProgress(`Sending ${done}/${total} contact${total === 1 ? '' : 's'}…`);
      });
      setResults(nextResults);
      setPhase('done');
      const messaged = nextResults.filter((row) => row.ok && !row.skippedDuplicate).length;
      const skippedDup = nextResults.filter((row) => row.ok && row.skippedDuplicate).length;
      const failed = nextResults.filter((row) => !row.ok).length;
      const text =
        failed === 0
          ? `All done. Sent ${messaged} WhatsApp reminder${messaged === 1 ? '' : 's'}${
              skippedDup
                ? ` (${skippedDup} extra row${skippedDup === 1 ? '' : 's'} shared the same contact and were not re-messaged)`
                : ''
            }.`
          : `Done. Sent ${messaged}, skipped ${skippedDup} duplicate contact${
              skippedDup === 1 ? '' : 's'
            }, failed ${failed}. Check the table for details.`;
      onChange?.(
        {
          kind: 'payment_reminders',
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
            <span className="ai-meeting-card-lead">Payment reminder</span>
          </div>
          <p className="ai-payment-remind-copy">
            Remind unpaid invoices for this lead, or pick a wider period?
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
            <span className="ai-meeting-card-lead">Payment reminder period</span>
          </div>
          <p className="ai-payment-remind-copy">What period should I check for unpaid invoices?</p>
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
          {loading ? <p className="ai-payment-remind-status">Loading unpaid invoices…</p> : null}
          {error ? <p className="ai-payment-remind-error">{error}</p> : null}
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const messaged = results.filter((row) => row.ok && !row.skippedDuplicate).length;
    const skippedDup = results.filter((row) => row.ok && row.skippedDuplicate).length;
    const failed = results.filter((row) => !row.ok).length;
    return (
      <div className="ai-meeting-stack ai-fullwidth-card-stack">
        <div className="ai-meeting-card ai-signed-card">
          <div className="ai-meeting-card-head">
            <span />
            <span className="ai-meeting-card-lead">{periodLabel || 'Payment reminders'}</span>
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
                    <td>
                      {!row.ok
                        ? 'Failed'
                        : row.skippedDuplicate
                          ? 'Same contact'
                          : 'Sent'}
                    </td>
                    <td>
                      {!row.ok
                        ? row.error || '—'
                        : row.skippedDuplicate
                          ? 'Not re-messaged (duplicate contact)'
                          : row.phone || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ai-signed-footer">
            <span>
              {messaged} sent
              {skippedDup ? ` · ${skippedDup} same contact` : ''}
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
            {periodLabel ? `Invoice sent ${periodLabel}` : 'Unpaid invoices'}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="ai-payment-remind-copy">No unpaid invoices in this period.</p>
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
                    <th className="ai-signed-paid">Due</th>
                    <th>Invoice</th>
                    <th>Lang</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const checked = selected.has(row.id);
                    const reminded =
                      (Number(row.reminderSentCount) || 0) > 0 || Boolean(row.reminderSentAt);
                    const tip = reminded ? reminderSentTooltip(row) : '';
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
                          <span className="ai-payment-remind-lead">
                            {reminded ? (
                              <span
                                className="ai-payment-remind-sent-dot"
                                title={tip}
                                aria-label={tip}
                              />
                            ) : null}
                            {row.leadNumber ? (
                              <ChatLeadNumberText text={row.leadNumber} />
                            ) : (
                              '—'
                            )}
                          </span>
                        </td>
                        <td>{row.name || '—'}</td>
                        <td className="ai-signed-value">
                          {formatChatCurrencyText(row.amountLabel) || '—'}
                        </td>
                        <td className="ai-signed-paid">{row.dueLabel || '—'}</td>
                        <td>{row.invoiceLabel || '—'}</td>
                        <td>{row.templateId === 53 ? 'HE' : 'EN+'}</td>
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
