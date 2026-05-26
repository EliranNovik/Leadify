/** Map payment plan order id / text to display label (matches PaymentPage / FinancesTab). */
function paymentOrderLabel(order) {
  if (order == null || order === '') return 'Payment';
  if (typeof order === 'string') {
    const lower = order.toLowerCase();
    if (
      lower.includes('first') ||
      lower.includes('intermediate') ||
      lower.includes('final') ||
      lower.includes('single') ||
      lower.includes('expense')
    ) {
      return order;
    }
    const num = parseInt(order, 10);
    if (!Number.isNaN(num)) order = num;
    else return order;
  }
  if (typeof order === 'number') {
    switch (order) {
      case 1:
        return 'First Payment';
      case 5:
        return 'Intermediate Payment';
      case 9:
        return 'Final Payment';
      case 90:
        return 'Single Payment';
      case 99:
        return 'Expense (no VAT)';
      default:
        return 'Payment';
    }
  }
  return 'Payment';
}

module.exports = { paymentOrderLabel };
