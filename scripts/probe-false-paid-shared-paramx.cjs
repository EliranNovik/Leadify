/*
 * Scratch probe: for each Pelecard charge marked paid on more than one payment_links row, decide
 * which row is real and which never had a charge of its own.
 *
 * The decisive test is whether a hosted payment page was ever created for the row: no
 * pelecard_session_url and no `init` block in the raw response means the client was never shown
 * anything to pay, so a "paid" status on that row cannot be its own charge.
 *
 * Prints ids and amounts only. Delete after use.
 */
require('dotenv').config({ path: 'backend/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const agorot = (value) => {
  const n = Number(String(value ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

async function main() {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('payment_links')
      .select(
        'id, client_id, legacy_id, payment_plan_id, total_amount, currency, status, paid_at, ' +
        'pelecard_session_url, pelecard_auth_number, pelecard_voucher_id, pelecard_status_code, ' +
        'pelecard_raw_response, description, payment_confirmation_email_sent_at',
      )
      .eq('status', 'paid')
      .order('paid_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }

  /*
   * Group on the bank approval number alone. Voucher and Pelecard id are unreliable here: a row
   * whose raw response was later overwritten by a failed GetTransaction keeps the approval but
   * loses the rest, which hides exactly the pairs being looked for.
   */
  const byCharge = new Map();
  for (const row of rows) {
    const result = row.pelecard_raw_response?.pelecard?.ResultData || {};
    const auth = String(
      row.pelecard_auth_number || result.DebitApproveNumber || result.AuthManpikNo || '',
    ).trim().replace(/^0+/, '');
    if (auth.length < 4) continue;
    if (!byCharge.has(auth)) byCharge.set(auth, []);
    byCharge.get(auth).push(row);
  }

  const shared = [...byCharge.entries()].filter(([, group]) => group.length > 1);
  const phantoms = [];

  console.log(`paid payment_links scanned: ${rows.length}`);
  console.log(`charges claimed by more than one paid row: ${shared.length}\n`);

  for (const [key, group] of shared) {
    // Whichever row still holds a populated result carries the real charged amount.
    const charged = group
      .map((r) => agorot(r.pelecard_raw_response?.pelecard?.ResultData?.DebitTotal))
      .find((v) => v != null) ?? null;
    console.log(
      `charge ${key}  actually_charged=${charged != null ? (charged / 100).toFixed(2) : 'n/a'}`,
    );
    for (const r of group) {
      const raw = r.pelecard_raw_response || {};
      const hadOwnSession = Boolean(r.pelecard_session_url) || Boolean(raw.init);
      const matchesOwnAmount =
        charged != null && Math.abs(charged - Math.round(Number(r.total_amount) * 100)) <= 100;
      const verdict = !hadOwnSession
        ? 'NEVER CHARGED (no payment page was ever created)'
        : matchesOwnAmount
          ? 'real charge'
          : 'had a session, but the charge on record is not its amount — needs review';
      if (!hadOwnSession) phantoms.push(r);
      console.log(
        `   ${verdict}\n      link=${r.id} plan=${r.payment_plan_id} asked=${r.total_amount} ` +
        `code=${r.pelecard_status_code} paid=${r.paid_at}` +
        `${r.payment_confirmation_email_sent_at ? ' emailed=yes' : ''}\n` +
        `      lead=${r.client_id || r.legacy_id} | ${r.description}`,
      );
    }
    console.log('');
  }

  console.log('='.repeat(70));
  console.log(`rows marked paid with no payment page of their own: ${phantoms.length}\n`);

  /*
   * What the books are out by. Several rows sharing one charge is only a money problem when the
   * amounts we marked paid add up to more than the card was actually charged — if one payment
   * covered two installments, recording both is the right answer.
   */
  console.log('overstatement per charge (recorded as collected vs actually charged):');
  let overstated = 0;
  for (const [key, group] of shared) {
    const charged = group
      .map((r) => agorot(r.pelecard_raw_response?.pelecard?.ResultData?.DebitTotal))
      .find((v) => v != null);
    if (charged == null) continue;
    const recorded = group.reduce(
      (sum, r) => sum + Math.round(Number(r.total_amount || 0) * 100),
      0,
    );
    const diff = recorded - charged;
    if (diff <= 100) continue;
    overstated += diff;
    const lead = group[0].client_id || group[0].legacy_id;
    console.log(
      `  charge ${key}: recorded ${(recorded / 100).toFixed(2)} vs charged ` +
      `${(charged / 100).toFixed(2)}  OVER BY ${(diff / 100).toFixed(2)}  lead=${lead}`,
    );
    for (const r of group) {
      console.log(`      link=${r.id} plan=${r.payment_plan_id} amount=${r.total_amount}`);
    }
  }
  console.log(`\nTOTAL overstated across all shared charges: ${(overstated / 100).toFixed(2)}`);
}

main().catch((err) => {
  console.error('probe failed:', err.message || err);
  process.exit(1);
});
