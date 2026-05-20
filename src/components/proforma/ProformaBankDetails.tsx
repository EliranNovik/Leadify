import React from 'react';
import {
  type BankAccountSnapshot,
  buildBankDetailLines,
} from '../../lib/bankAccounts';

type Props = {
  details: BankAccountSnapshot | null | undefined;
  variant?: 'card' | 'invoice';
};

const ProformaBankDetails: React.FC<Props> = ({ details, variant = 'card' }) => {
  if (!details) return null;

  const lines = buildBankDetailLines(details);
  if (lines.length === 0) return null;

  if (variant === 'invoice') {
    return (
      <div style={{ marginTop: 24, marginBottom: 8, fontFamily: 'Inter, Arial, sans-serif' }}>
        <div style={{ fontWeight: 700, color: '#374151', marginBottom: 8, fontSize: 14 }}>
          Bank details
        </div>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color: '#4b5563',
              fontSize: 12,
              lineHeight: 1.5,
              marginBottom: line.label ? 2 : 4,
            }}
          >
            {line.label ? (
              <>
                <span style={{ fontWeight: 600, color: '#404040' }}>{line.label}: </span>
                {line.value}
              </>
            ) : (
              line.value
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-6 mb-2">
      <div className="font-semibold text-gray-700 mb-2">Bank details</div>
      <div className="text-sm text-gray-600 space-y-1">
        {lines.map((line, i) => (
          <p key={i} className="leading-relaxed">
            {line.label ? (
              <>
                <span className="font-medium text-gray-700">{line.label}: </span>
                {line.value}
              </>
            ) : (
              line.value
            )}
          </p>
        ))}
      </div>
    </div>
  );
};

export default ProformaBankDetails;
