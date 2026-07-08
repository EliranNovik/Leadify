import React from 'react';

/** Same stamp image used on ContractPage */
export const PROFORMA_STAMP_SRC = '/חתימה מסמכים (5).png';

type Props = {
  variant?: 'card' | 'invoice';
  side?: 'left' | 'right';
  size?: 'default' | 'lg';
};

const ProformaDocumentStamp: React.FC<Props> = ({ variant = 'card', side = 'right', size = 'default' }) => {
  const horizontalStyle = side === 'left' ? { left: 16 } : { right: 16 };
  const isLarge = size === 'lg';

  if (variant === 'invoice') {
    return (
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          ...horizontalStyle,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <img
          src={PROFORMA_STAMP_SRC}
          alt="Stamp"
          style={{
            display: 'block',
            height: isLarge ? 140 : 96,
            width: 'auto',
            maxWidth: isLarge ? 180 : 120,
            objectFit: 'contain',
          }}
        />
      </div>
    );
  }

  const horizontalClass = side === 'left' ? 'left-4 sm:left-6' : 'right-4 sm:right-6';
  const imageClass = isLarge
    ? 'block h-32 w-auto max-w-[180px] object-contain md:h-40 md:max-w-[220px]'
    : 'block h-24 w-auto max-w-[120px] object-contain md:h-28 md:max-w-[140px]';

  return (
    <div className={`poa-document-stamp absolute bottom-4 z-10 pointer-events-none sm:bottom-6 ${horizontalClass}`}>
      <img src={PROFORMA_STAMP_SRC} alt="Stamp" className={imageClass} />
    </div>
  );
};

export default ProformaDocumentStamp;
