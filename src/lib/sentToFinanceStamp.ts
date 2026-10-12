/**
 * The columns that record a payment row being handed to finance.
 *
 * Two things have to be written together and used to not be:
 *
 * - `ready_to_pay` — the long-standing flag every collection report gates on.
 * - `sent_to_finance_at` — the day the Dashboard "Sent to finance" scoreboard files the row under.
 *
 * Before this existed the scoreboard had only `due_date` to date a row by, so marking a row sent to
 * finance overwrote the due date with the marking day. That conflated the client's payment schedule
 * with an internal workflow timestamp, and it meant any path that recorded one without the other
 * dropped money out of reporting entirely — which is how 317 invoiced rows ended up uncounted.
 *
 * Call sites spread this and add whatever else they own (`ready_to_pay_by`, the legacy `date` and
 * `due_by_id`, and so on).
 */
export type SentToFinanceStamp = {
  ready_to_pay: true;
  sent_to_finance: true;
  sent_to_finance_at: string;
};

export function sentToFinanceStamp(at: Date = new Date()): SentToFinanceStamp {
  return {
    ready_to_pay: true,
    sent_to_finance: true,
    sent_to_finance_at: at.toISOString(),
  };
}
