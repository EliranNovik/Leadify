import React from 'react';
import {
  type ProformaExchangeRateInfo,
  formatIlsAmount,
} from '../../lib/proformaExchangeRate';

type Props = {
  info: ProformaExchangeRateInfo | null;
  loading?: boolean;
  variant?: 'card' | 'invoice';
};

const ProformaTotalInNis: React.FC<Props> = ({ info, loading, variant = 'card' }) => {
  if (loading || !info || info.isLocalCurrency) return null;

  if (variant === 'invoice') {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 18,
          marginTop: 8,
          fontFamily: 'Inter, Arial, sans-serif',
        }}
      >
        <span style={{ color: '#404040', fontWeight: 600 }}>Total (NIS)</span>
        <span style={{ color: '#18181b', fontWeight: 700 }}>{formatIlsAmount(info.totalNis)}</span>
      </div>
    );
  }

  return (
    <div className="flex justify-between text-lg mt-2 text-gray-600">
      <span className="font-semibold">Total (NIS)</span>
      <span className="font-bold text-gray-900">{formatIlsAmount(info.totalNis)}</span>
    </div>
  );
};

export default ProformaTotalInNis;
