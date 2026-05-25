import React from 'react';
import {
  formatIlsAmount,
  formatProformaRateDate,
  type ProformaExchangeRateInfo,
} from '../../lib/proformaExchangeRate';
import { formatMoneyAmount } from '../../lib/paymentPageUtils';

export type PaymentSummaryData = {
  service: string;
  clientName: string;
  caseNumber: string;
  topic: string;
  currencySymbol: string;
  subtotal: number;
  vat: number;
  total: number;
};

type Props = {
  summary: PaymentSummaryData;
  exchangeInfo: ProformaExchangeRateInfo | null;
  exchangeLoading: boolean;
};

/** Inner sidebar for unified checkout shell (not a standalone card). */
const PaymentSummaryCard: React.FC<Props> = ({ summary, exchangeInfo, exchangeLoading }) => {
  const isForeign = exchangeInfo && !exchangeInfo.isLocalCurrency;
  const primaryNis = isForeign
    ? formatIlsAmount(exchangeInfo.totalNis)
    : formatMoneyAmount(summary.total, summary.currencySymbol);
  const secondaryForeign = isForeign
    ? `≈ ${formatMoneyAmount(summary.total, summary.currencySymbol)}`
    : null;

  return (
    <div className="h-full">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Payment Summary</h2>

      <div className="space-y-1.5 text-sm text-gray-600 mb-4 pb-4 border-b border-gray-200/80">
        <p className="text-gray-800">{summary.service}</p>
        <p>{summary.clientName}</p>
        <p className="font-mono text-xs text-gray-500">Case # {summary.caseNumber}</p>
        {summary.topic !== '--' && <p className="text-xs text-gray-500">{summary.topic}</p>}
      </div>

      <div className="space-y-2 text-sm text-gray-600 mb-4 pb-4 border-b border-gray-200/80">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="text-gray-800">{formatMoneyAmount(summary.subtotal, summary.currencySymbol)}</span>
        </div>
        <div className="flex justify-between">
          <span>VAT (18%)</span>
          <span className="text-gray-800">{formatMoneyAmount(summary.vat, summary.currencySymbol)}</span>
        </div>
      </div>

      <div
        className="rounded-[18px] border border-[#e6e0ff] p-5 mb-4"
        style={{
          background: 'linear-gradient(180deg, #f6f4ff 0%, #ffffff 100%)',
        }}
      >
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-2">
          Amount to pay
        </p>
        {exchangeLoading && !exchangeInfo ? (
          <div className="h-9 w-28 bg-violet-100/60 rounded-lg animate-pulse" />
        ) : (
          <>
            <p className="text-[28px] font-bold text-[#3b28c7] leading-tight tracking-tight">
              {primaryNis}
            </p>
            {secondaryForeign && (
              <p className="text-sm text-gray-500 mt-1 font-normal">{secondaryForeign}</p>
            )}
          </>
        )}
      </div>

      {isForeign && exchangeInfo && (
        <div className="text-[11px] text-gray-500 leading-relaxed mb-3 space-y-0.5">
          <p className="text-gray-400">Exchange rate</p>
          <p className="text-gray-600">
            1 {exchangeInfo.isoCode} = ₪
            {exchangeInfo.rateToIls.toLocaleString(undefined, {
              minimumFractionDigits: 4,
              maximumFractionDigits: 4,
            })}
          </p>
          <p>Bank of Israel, {formatProformaRateDate(exchangeInfo.rateDate)}</p>
        </div>
      )}

      <p className="text-[11px] text-gray-500 leading-relaxed">
        Processed securely by Pelecard. Card details are not stored by RMQ 2.0.
      </p>
    </div>
  );
};

export default PaymentSummaryCard;
