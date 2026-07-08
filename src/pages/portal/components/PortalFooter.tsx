import React from 'react';
import { FaFacebook, FaLinkedin, FaYoutube } from 'react-icons/fa';

const SOCIAL_LINKS = [
  {
    href: 'https://www.linkedin.com/company/decker-pex-co/',
    label: 'LinkedIn',
    Icon: FaLinkedin,
  },
  {
    href: 'https://www.youtube.com/@DeckerPexLawoffice',
    label: 'YouTube',
    Icon: FaYoutube,
  },
  {
    href: 'https://www.facebook.com/DeckerPexCo',
    label: 'Facebook',
    Icon: FaFacebook,
  },
] as const;

/** Same footer as PublicContractView — firm branding, addresses, copyright. */
const PortalFooter: React.FC = () => (
  <footer className="mt-8 bg-blue-950 text-white print-hide md:mt-24 mb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:mb-0">
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-20">
      <div className="flex flex-col items-center justify-center gap-4 md:gap-8">
        <div className="space-y-2 text-center md:space-y-3">
          <div className="flex items-center justify-center gap-3">
            <img src="/DPLOGO1.png" alt="DPL Logo" className="h-12 w-auto object-contain" />
            <p className="text-xl font-bold text-white">Decker Pex & Co. Law Offices</p>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 text-sm text-blue-100 md:flex-row md:gap-3">
            <p>Menachem Begin Rd. 11, Ramat Gan, Israel</p>
            <span className="hidden text-blue-200/80 md:inline">•</span>
            <p>Yad Harutzim 10, Jerusalem, Israel</p>
          </div>
        </div>
      </div>

      <div className="mt-6 border-t border-blue-900 pt-4 md:mt-12 md:pt-8">
        <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
          <div className="hidden sm:block" aria-hidden />
          <p className="text-center text-xs text-blue-200/90">
            RMQ 2.0 - Copyright © {new Date().getFullYear()} - All right reserved
          </p>
          <div className="flex items-center justify-end gap-2.5">
            {SOCIAL_LINKS.map(({ href, label, Icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                title={label}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-blue-100 transition-colors hover:bg-blue-900 hover:text-white"
              >
                <Icon className="h-6 w-6" aria-hidden />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  </footer>
);

export default PortalFooter;
