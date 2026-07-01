const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isExpenseNoVatPayment,
  resolvePaymentOrderFromLink,
  isExpenseNoVatPaymentLink,
} = require('./paymentPlanOrder');

describe('paymentPlanOrder', () => {
  it('detects expense (no VAT) by order id and label', () => {
    assert.equal(isExpenseNoVatPayment(99), true);
    assert.equal(isExpenseNoVatPayment('99'), true);
    assert.equal(isExpenseNoVatPayment('Expense (no VAT)'), true);
    assert.equal(isExpenseNoVatPayment('expense no vat'), true);
    assert.equal(isExpenseNoVatPayment(1), false);
    assert.equal(isExpenseNoVatPayment('First Payment'), false);
  });

  it('resolves payment order from payment link joins', () => {
    assert.equal(
      resolvePaymentOrderFromLink({ payment_plans: { payment_order: 99 } }),
      99,
    );
    assert.equal(
      resolvePaymentOrderFromLink({ legacy_payment_plan: { order: 'Expense (no VAT)' } }),
      'Expense (no VAT)',
    );
    assert.equal(resolvePaymentOrderFromLink({}), null);
  });

  it('flags expense no VAT payment links', () => {
    assert.equal(
      isExpenseNoVatPaymentLink({ payment_plans: { payment_order: 99 } }),
      true,
    );
    assert.equal(
      isExpenseNoVatPaymentLink({ payment_plans: { payment_order: 1 } }),
      false,
    );
  });
});
