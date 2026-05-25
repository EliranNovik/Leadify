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
  variant?: 'default' | 'gradient';
};

const PaymentSummaryCard: React.FC<Props> = ({
  summary,
  exchangeInfo,
  exchangeLoading,
  variant = 'default',
}) => {
  const isGradient = variant === 'gradient';
  const isForeign = exchangeInfo && !exchangeInfo.isLocalCurrency;
  const primaryNis = isForeign
    ? formatIlsAmount(exchangeInfo.totalNis)
    : formatMoneyAmount(summary.total, summary.currencySymbol);
  const secondaryForeign = isForeign
    ? `≈ ${formatMoneyAmount(summary.total, summary.currencySymbol)}`
    : null;

  if (isGradient) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          {exchangeLoading && !exchangeInfo ? (
            <div className="h-11 w-40 rounded-lg animate-pulse bg-white/25" />
          ) : (
            <>
              <p className="text-[2.5rem] xl:text-[2.75rem] font-bold text-white leading-none tracking-tight">
                {primaryNis}
              </p>
              {secondaryForeign && (
                <p className="text-sm mt-2 font-normal text-white/70">{secondaryForeign}</p>
              )}
            </>
          )}
        </div>

        <div
          className="rounded-2xl p-5 bg-white/30 backdrop-blur-xl border border-white/50 shadow-[0_8px_32px_rgba(0,0,0,0.06)]"
          style={{ WebkitBackdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{summary.service}</p>
              <p className="text-xs text-white/90 mt-1.5">{summary.clientName}</p>
              <p className="font-mono text-[11px] text-white/75 mt-1">Case # {summary.caseNumber}</p>
            </div>
            <p className="text-sm font-semibold text-white shrink-0">{primaryNis}</p>
          </div>
          {summary.topic !== '--' && (
            <p className="text-xs text-white/80 mt-3 leading-relaxed border-t border-white/25 pt-3">
              {summary.topic}
            </p>
          )}
        </div>

        <div className="space-y-2.5 text-sm text-white/75">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="text-white">{formatMoneyAmount(summary.subtotal, summary.currencySymbol)}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT (18%)</span>
            <span className="text-white">{formatMoneyAmount(summary.vat, summary.currencySymbol)}</span>
          </div>
          <div className="flex justify-between pt-3 border-t border-white/20 text-base font-semibold text-white">
            <span>Total due today</span>
            <span>{primaryNis}</span>
          </div>
        </div>

        {isForeign && exchangeInfo && (
          <div className="text-[11px] leading-relaxed text-white/60 space-y-0.5">
            <p>
              1 {exchangeInfo.isoCode} = ₪
              {exchangeInfo.rateToIls.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 4,
              })}
            </p>
            <p>Bank of Israel, {formatProformaRateDate(exchangeInfo.rateDate)}</p>
          </div>
        )}
      </div>
    );
  }

  const textMuted = 'text-gray-600';
  const textMain = 'text-gray-800';
  const textSub = 'text-gray-500';

  return (
    <div className="h-full">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Payment Summary</h2>

      <div className="space-y-1.5 text-sm text-gray-600 mb-4 pb-4 border-b border-gray-200/80">
        <p className={textMain}>{summary.service}</p>
        <p>{summary.clientName}</p>
        <p className={`font-mono text-xs ${textSub}`}>Case # {summary.caseNumber}</p>
        {summary.topic !== '--' && <p className={`text-xs ${textSub}`}>{summary.topic}</p>}
      </div>

      <div className={`space-y-2 text-sm mb-4 pb-4 border-b border-gray-200/80 ${textMuted}`}>
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className={textMain}>{formatMoneyAmount(summary.subtotal, summary.currencySymbol)}</span>
        </div>
        <div className="flex justify-between">
          <span>VAT (18%)</span>
          <span className={textMain}>{formatMoneyAmount(summary.vat, summary.currencySymbol)}</span>
        </div>
      </div>

      <div className="mb-4">
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
              <p className={`text-sm mt-1 font-normal ${textSub}`}>{secondaryForeign}</p>
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

      <p className={`text-[11px] leading-relaxed ${textSub}`}>
        Processed securely by Pelecard. Card details are not stored on our servers.
      </p>
    </div>
  );
};

export default PaymentSummaryCard;
