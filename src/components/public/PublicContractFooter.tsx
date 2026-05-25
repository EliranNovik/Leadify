import React from 'react';

type Props = {
  variant?: 'default' | 'payment';
};

/** Site footer — compact on payment page */
const PublicContractFooter: React.FC<Props> = ({ variant = 'default' }) => {
  const isPayment = variant === 'payment';

  return (
    <footer
      className={`border-t print-hide ${
        isPayment
          ? 'bg-transparent border-gray-100/80 mt-4 pt-6 pb-6'
          : 'bg-gray-50 border-gray-200 mt-8 md:mt-24'
      }`}
    >
      <div
        className={`mx-auto px-6 text-center ${isPayment ? 'max-w-4xl' : 'max-w-5xl py-8 md:py-20 md:px-8'}`}
      >
        {!isPayment && (
          <div className="flex flex-col items-center justify-center gap-4 md:gap-8 mb-6">
            <div className="flex items-center justify-center gap-3">
              <img src="/DPL-LOGO1.png" alt="DPL Logo" className="h-12 w-auto object-contain" />
              <p className="font-bold text-xl text-gray-900">Decker, Pex & Co Lawoffices</p>
            </div>
            <p className="text-sm text-gray-500">Menachem Begin Rd. 11, Ramat Gan, Israel</p>
          </div>
        )}

        {isPayment && (
          <div className="space-y-1 mb-3 text-[12px] text-[#8a94a6] font-normal">
            <p className="font-medium text-[#6b7280]">Decker, Pex & Co Lawoffices</p>
            <p>Menachem Begin Rd. 11, Ramat Gan, Israel</p>
            <p className="max-w-lg mx-auto leading-relaxed pt-1 opacity-90">
              Payments are securely processed by Pelecard. Card details are not stored by RMQ 2.0.
            </p>
          </div>
        )}

        <p
          className={`${
            isPayment
              ? 'text-[11px] text-[#8a94a6]/80'
              : 'text-xs text-gray-400 mt-6 md:mt-12 pt-4 md:pt-8 border-t border-gray-100'
          }`}
        >
          RMQ 2.0 — Copyright © {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
};

export default PublicContractFooter;
