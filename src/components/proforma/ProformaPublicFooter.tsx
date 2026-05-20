import React from 'react';

/** Site footer — same as PublicContractView */
const ProformaPublicFooter: React.FC = () => (
  <footer className="print-hide mt-8 border-t border-gray-200 bg-white md:mt-24 mb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:mb-0">
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-20">
      <div className="flex flex-col items-center justify-center gap-4 md:gap-8">
        <div className="space-y-2 text-center md:space-y-3">
          <div className="flex items-center justify-center gap-3">
            <img src="/DPL-LOGO1.png" alt="DPL Logo" className="h-12 w-auto object-contain" />
            <p className="text-xl font-bold text-gray-900">Decker, Pex & Co Law Offices</p>
          </div>
          <p className="text-sm text-gray-500">Menachem Begin Rd. 11, Ramat Gan, Israel</p>
        </div>
      </div>

      <div className="mt-6 border-t border-gray-100 pt-4 text-center text-xs text-gray-400 md:mt-12 md:pt-8">
        RMQ 2.0 - Copyright © {new Date().getFullYear()} - All right reserved
      </div>
    </div>
  </footer>
);

export default ProformaPublicFooter;
