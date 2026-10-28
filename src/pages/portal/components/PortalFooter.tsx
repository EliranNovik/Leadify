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
const PortalFooter: React.FC<{
  className?: string;
  compact?: boolean;
  /** `gray` = light grey plate (payment page); default navy. */
  tone?: 'navy' | 'gray';
  /** Override firm logo path (e.g. payment page). */
  logoSrc?: string;
}> = ({ className = '', compact = false, tone = 'navy', logoSrc = '/DPLOGO1.png' }) => {
  const isGray = tone === 'gray';
  return (
    <footer
      className={`${isGray ? 'bg-gray-100 text-gray-800' : 'bg-blue-950 text-white'} print-hide ${
        compact ? 'mt-6 shrink-0' : 'mt-8 md:mt-24'
      } ${className}`.trim()}
    >
      {/*
        On a phone the floating contact buttons sit over the bottom of the page, so the footer
        holds room for them underneath its own text. That room is padding rather than margin: the
        plate itself reaches the bottom of the screen instead of leaving the page colour below it.
      */}
      <div
        className={`mx-auto max-w-5xl px-4 md:px-8 ${
          compact
            ? 'pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-6 md:py-8'
            : 'pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] pt-8 md:py-20'
        }`}
      >
        {/* Stacked on a phone, so each part of the footer is given room to stand apart. */}
        <div className={`flex flex-col items-center justify-center ${compact ? 'gap-5 md:gap-4' : 'gap-7 md:gap-8'}`}>
          <div
            className={`text-center ${
              compact ? 'space-y-4 md:space-y-2.5' : 'space-y-5 md:space-y-3'
            }`}
          >
            {/* The firm's name is too long to sit beside the logo on a phone, so it sits under it. */}
            <div className="flex flex-col items-center justify-center gap-4 md:flex-row md:gap-3">
              <img
                src={logoSrc}
                alt="DPL Logo"
                className={`object-contain ${compact ? 'h-10 w-auto' : 'h-12 w-auto'}`}
              />
              <p
                className={`font-bold ${isGray ? 'text-gray-900' : 'text-white'} ${
                  compact ? 'text-lg' : 'text-xl'
                }`}
              >
                Decker Pex & Co. Law Offices
              </p>
            </div>
            <div
              className={`flex flex-col items-center justify-center gap-2 md:flex-row md:gap-3 ${
                isGray ? 'text-gray-600' : 'text-blue-100'
              } ${compact ? 'text-sm' : 'text-sm'}`}
            >
              <p>Menachem Begin Rd. 11, Ramat Gan, Israel</p>
              <span
                className={`hidden md:inline ${isGray ? 'text-gray-400' : 'text-blue-200/80'}`}
              >
                •
              </span>
              <p>Yad Harutzim 10, Jerusalem, Israel</p>
            </div>
          </div>
        </div>

        <div
          className={`${isGray ? 'border-t border-gray-200' : 'border-t border-blue-900'} ${
            compact ? 'mt-6 pt-5 md:mt-5 md:pt-4' : 'mt-8 pt-6 md:mt-12 md:pt-8'
          }`}
        >
          <div className="grid grid-cols-1 items-center gap-5 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
            <div className="hidden sm:block" aria-hidden />
            <p
              className={`text-center text-xs ${isGray ? 'text-gray-500' : 'text-blue-200/90'}`}
            >
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
                  className={`inline-flex items-center justify-center rounded-full transition-colors ${
                    isGray
                      ? 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                      : 'text-blue-100 hover:bg-blue-900 hover:text-white'
                  } ${compact ? 'h-10 w-10' : 'h-11 w-11'}`}
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
};

export default PortalFooter;
