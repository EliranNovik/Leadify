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
const PortalFooter: React.FC<{ className?: string; compact?: boolean }> = ({
  className = '',
  compact = false,
}) => (
  <footer
    className={`bg-blue-950 text-white print-hide ${
      compact
        ? 'mt-6 shrink-0 mb-[env(safe-area-inset-bottom,0px)]'
        : 'mt-8 md:mt-24 mb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:mb-0'
    } ${className}`.trim()}
  >
    <div
      className={`mx-auto max-w-5xl px-4 md:px-8 ${compact ? 'py-6 md:py-8' : 'py-8 md:py-20'}`}
    >
      <div className={`flex flex-col items-center justify-center ${compact ? 'gap-3 md:gap-4' : 'gap-4 md:gap-8'}`}>
        <div className={`space-y-2 text-center ${compact ? 'md:space-y-2.5' : 'md:space-y-3'}`}>
          <div className="flex items-center justify-center gap-3">
            <img
              src="/DPLOGO1.png"
              alt="DPL Logo"
              className={`object-contain ${compact ? 'h-10 w-auto' : 'h-12 w-auto'}`}
            />
            <p className={`font-bold text-white ${compact ? 'text-lg' : 'text-xl'}`}>
              Decker Pex & Co. Law Offices
            </p>
          </div>
          <div
            className={`flex flex-col items-center justify-center gap-1 text-blue-100 md:flex-row md:gap-3 ${
              compact ? 'text-sm' : 'text-sm'
            }`}
          >
            <p>Menachem Begin Rd. 11, Ramat Gan, Israel</p>
            <span className="hidden text-blue-200/80 md:inline">•</span>
            <p>Yad Harutzim 10, Jerusalem, Israel</p>
          </div>
        </div>
      </div>

      <div className={`border-t border-blue-900 ${compact ? 'mt-5 pt-4' : 'mt-6 md:mt-12 pt-4 md:pt-8'}`}>
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
                className={`inline-flex items-center justify-center rounded-full text-blue-100 transition-colors hover:bg-blue-900 hover:text-white ${
                  compact ? 'h-10 w-10' : 'h-11 w-11'
                }`}
              >
                <Icon className={compact ? 'h-5 w-5' : 'h-6 w-6'} aria-hidden />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  </footer>
);

export default PortalFooter;
