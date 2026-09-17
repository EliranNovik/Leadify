const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  paymentAmountsEqual,
  snapshotFromNewPlanRow,
  paymentLinkMatchesSnapshot,
  applySnapshotToPaymentLink,
} = require('./paymentLinkPlanSnapshot');
const { paymentOrderLabel } = require('./paymentPlanOrder');

describe('paymentLinkPlanSnapshot', () => {
  it('builds first-payment amounts from the plan row, not a sibling installment', () => {
    const first = snapshotFromNewPlanRow({
      value: 3750,
      value_vat: 675,
      payment_order: 1,
      currency: '₪',
    });
    const intermediateLink = {
      amount: 7500,
      vat_amount: 1350,
      total_amount: 8850,
      description: 'First Payment - Client (#L226688)',
    };

    assert.equal(first.orderLabel, 'First Payment');
    assert.equal(first.totalAmount, 4425);
    assert.equal(paymentLinkMatchesSnapshot(intermediateLink, first), false);

    const overlay = applySnapshotToPaymentLink(intermediateLink, first);
    assert.equal(overlay.amount, 3750);
    assert.equal(overlay.vat_amount, 675);
    assert.equal(overlay.total_amount, 4425);
    assert.equal(overlay.description.startsWith('First Payment'), true);
  });

  it('treats tiny rounding differences as the same installment', () => {
    assert.equal(paymentAmountsEqual(4425, 4425.004), true);
    assert.equal(paymentAmountsEqual(4425, 8850), false);
  });

  it('labels numeric payment_order the same way Finances does', () => {
    assert.equal(paymentOrderLabel(1), 'First Payment');
    assert.equal(paymentOrderLabel(5), 'Intermediate Payment');
    assert.equal(paymentOrderLabel(9), 'Final Payment');
  });
});
