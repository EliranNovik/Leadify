import React from 'react';

/** Same stamp image used on ContractPage */
export const PROFORMA_STAMP_SRC = '/חתימה מסמכים (5).png';

type Props = {
  variant?: 'card' | 'invoice';
};

const ProformaDocumentStamp: React.FC<Props> = ({ variant = 'card' }) => {
  if (variant === 'invoice') {
    return (
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <img
          src={PROFORMA_STAMP_SRC}
          alt="Stamp"
          style={{ display: 'block', height: 96, width: 'auto', maxWidth: 120, objectFit: 'contain' }}
        />
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 right-4 z-10 pointer-events-none">
      <img
        src={PROFORMA_STAMP_SRC}
        alt="Stamp"
        className="block h-24 w-auto max-w-[120px] object-contain md:h-28 md:max-w-[140px]"
      />
    </div>
  );
};

export default ProformaDocumentStamp;
