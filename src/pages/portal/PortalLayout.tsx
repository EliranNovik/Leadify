import React, { useEffect, useState } from 'react';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import PublicPageContactButtons from '../../components/public/PublicPageContactButtons';
import type { PortalContact, PortalLeadSummary } from '../../lib/portalApi';
import { PORTAL_SHELL_CLASS } from './components/portalTheme';
import PortalProfileMenu from './components/PortalProfileMenu';

export type PortalNavTab = { id: string; label: string };

type Props = {
  leadSummary: PortalLeadSummary | null;
  contact: PortalContact | null;
  contactProfileImageUrl?: string | null;
  onLogout: () => void;
  onSettings?: () => void;
  navTabs?: PortalNavTab[];
  activeNavTab?: string;
  onNavTabChange?: (tabId: string) => void;
  children: React.ReactNode;
};

const PortalLayout: React.FC<Props> = ({
  leadSummary,
  contact,
  contactProfileImageUrl,
  onLogout,
  onSettings,
  navTabs,
  activeNavTab,
  onNavTabChange,
  children,
}) => {
  const coverKey = `portal::${leadSummary?.lead_number || 'case'}::${contact?.name || 'user'}`;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const hasNav = Boolean(navTabs?.length && onNavTabChange);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [activeNavTab]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

  const selectTab = (tabId: string) => {
    onNavTabChange?.(tabId);
    setMobileNavOpen(false);
  };

  const hideHeaderLogo = activeNavTab === 'summary';

  return (
    <div className={`${PORTAL_SHELL_CLASS} flex flex-col`}>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur-md">
        <div className="relative flex w-full items-center gap-2 px-2 py-3 md:gap-6 md:px-10">
          {hasNav ? (
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base-content/70 transition-colors hover:bg-base-200/70 md:hidden"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileNavOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
            </button>
          ) : null}

          {!hideHeaderLogo ? (
            <img
              src="/DPL-LOGO1.png"
              alt="Decker Pex & Co Law Offices"
              className="h-10 w-auto max-w-[120px] shrink-0 object-contain md:h-11 md:max-w-[140px]"
            />
          ) : null}

          {hasNav ? (
            <nav
              className="hidden min-w-0 flex-1 flex-wrap items-center gap-x-1 md:flex md:gap-x-2"
              aria-label="Case sections"
            >
              {navTabs!.map((tab) => {
                const active = activeNavTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => selectTab(tab.id)}
                    className={`shrink-0 px-2 py-1.5 text-sm transition-colors md:px-3 ${
                      active
                        ? 'font-semibold text-primary'
                        : 'font-medium text-base-content/55 hover:text-base-content/85'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="hidden flex-1 md:block" />
          )}

          <div className="flex-1 md:hidden" />

          {contact?.name ? (
            <PortalProfileMenu
              name={contact.name}
              leadNumber={leadSummary?.lead_number}
              imageUrl={contactProfileImageUrl}
              stableKey={coverKey}
              onLogout={onLogout}
              onSettings={onSettings}
            />
          ) : null}
        </div>
      </header>

      {hasNav && mobileNavOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#ececec] md:hidden">
          <div className="flex items-center gap-2 border-b border-gray-200 bg-white/95 px-2 py-3 backdrop-blur-md">
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base-content/70 transition-colors hover:bg-base-200/70"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
            <img
              src="/DPL-LOGO1.png"
              alt="Decker Pex & Co Law Offices"
              className="h-10 w-auto max-w-[120px] object-contain"
            />
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-6" aria-label="Case sections">
            <div className="flex flex-col gap-2">
              {navTabs!.map((tab) => {
                const active = activeNavTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => selectTab(tab.id)}
                    className={`w-full rounded-2xl px-4 py-4 text-left text-base transition-colors ${
                      active
                        ? 'bg-white font-semibold text-primary shadow-sm'
                        : 'bg-white/60 font-medium text-base-content/75 hover:bg-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      ) : null}

      <main className="w-full flex-1 px-2 py-6 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] md:px-10 md:py-8 md:pb-12">
        {children}
      </main>

      <PublicPageContactButtons />
    </div>
  );
};

export default PortalLayout;
