import React from 'react';
import {
  type ProformaExchangeRateInfo,
  buildProformaExchangeFooterLines,
} from '../../lib/proformaExchangeRate';

function exchangeRateTitle(info: ProformaExchangeRateInfo): string {
  if (info.rateSource === 'legacy' && info.paid) {
    return 'Exchange rate (at payment)';
  }
  return 'Exchange rate (Bank of Israel)';
}

type Props = {
  info: ProformaExchangeRateInfo | null;
  loading?: boolean;
  /** Tailwind card layout vs inline styles for PDF/minimal invoice */
  variant?: 'card' | 'invoice';
};

const invoiceTextStyle: React.CSSProperties = {
  marginTop: 24,
  fontSize: 12,
  color: '#4b5563',
  fontFamily: 'Inter, Arial, sans-serif',
  lineHeight: 1.5,
};

const ProformaExchangeRateFooter: React.FC<Props> = ({ info, loading, variant = 'card' }) => {
  if (loading) {
    if (variant === 'invoice') {
      return (
        <div style={invoiceTextStyle}>
          <div style={{ fontWeight: 600, color: '#374151' }}>Exchange rate</div>
          <div>Loading Bank of Israel rate…</div>
        </div>
      );
    }
    return (
      <div className="mt-6 text-sm text-gray-500">
        <span className="font-semibold text-gray-600">Exchange rate: </span>
        Loading…
      </div>
    );
  }

  if (!info) return null;
  if (info.isLocalCurrency) return null;

  const lines = buildProformaExchangeFooterLines(info);

  if (variant === 'invoice') {
    return (
      <div style={invoiceTextStyle}>
        <div style={{ fontWeight: 700, color: '#374151', marginBottom: 8 }}>{exchangeRateTitle(info)}</div>
        {lines.map((line, i) => (
          <div key={i} style={{ marginBottom: i === lines.length - 1 ? 0 : 4 }}>
            {line}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-6 text-sm text-gray-600 space-y-1">
      <div className="font-semibold text-gray-700">{exchangeRateTitle(info)}</div>
      {lines.map((line, i) => (
        <p key={i} className="leading-relaxed">
          {line}
        </p>
      ))}
    </div>
  );
};

export default ProformaExchangeRateFooter;
