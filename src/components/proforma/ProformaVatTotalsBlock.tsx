import React from 'react';
import type { ResolvedProformaVat } from '../../lib/proformaVat';

type Props = {
  currencyLabel: string;
  resolved: ResolvedProformaVat;
  totalAmountClassName?: string;
  totalAmountStyle?: React.CSSProperties;
};

/** Subtotal / VAT / total lines — matches FinancesTab (VAT only on Israeli shekel). */
const ProformaVatTotalsBlock: React.FC<Props> = ({
  currencyLabel,
  resolved,
  totalAmountClassName = 'text-green-600',
  totalAmountStyle,
}) => (
  <>
    <div className="mb-2 flex justify-between text-lg">
      <span className="font-semibold text-gray-700">Subtotal</span>
      <span className="font-bold text-gray-900">
        {currencyLabel} {resolved.subtotal.toFixed(2)}
      </span>
    </div>
    {resolved.addVat && (
      <div className="mb-2 flex justify-between text-lg">
        <span className="font-semibold text-gray-700">VAT ({resolved.vatPercentLabel}%)</span>
        <span className="font-bold text-gray-900">
          {currencyLabel} {resolved.vat.toFixed(2)}
        </span>
      </div>
    )}
    <div className="mt-4 flex justify-between border-t pt-4 text-xl font-extrabold">
      <span>Total</span>
      <span className={totalAmountClassName || undefined} style={totalAmountStyle}>
        {currencyLabel} {resolved.totalWithVat.toFixed(2)}
      </span>
    </div>
  </>
);

export default ProformaVatTotalsBlock;
