import React from 'react';

/** Same footer as PublicContractView — firm branding, addresses, copyright. */
const PortalFooter: React.FC = () => (
  <footer className="mt-8 bg-blue-950 text-white print-hide md:mt-24 mb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:mb-0">
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-20">
      <div className="flex flex-col items-center justify-center gap-4 md:gap-8">
        <div className="space-y-2 text-center md:space-y-3">
          <div className="flex items-center justify-center gap-3">
            <img src="/DPLOGO1.png" alt="DPL Logo" className="h-12 w-auto object-contain" />
            <p className="text-xl font-bold text-white">Decker, Pex, Levi Law Offices</p>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 text-sm text-blue-100 md:flex-row md:gap-3">
            <p>Yad Harutzim 10, Jerusalem, Israel</p>
            <span className="hidden text-blue-200/80 md:inline">•</span>
            <p>Menachem Begin Rd. 150, Tel Aviv, Israel</p>
          </div>
        </div>
      </div>

      <div className="mt-6 border-t border-blue-900 pt-4 text-center text-xs text-blue-200/90 md:mt-12 md:pt-8">
        RMQ 2.0 - Copyright © {new Date().getFullYear()} - All right reserved
      </div>
    </div>
  </footer>
);

export default PortalFooter;
