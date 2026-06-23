import React, { useEffect, useState } from 'react';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import PublicPageContactButtons from '../../components/public/PublicPageContactButtons';
import type { PortalContact, PortalLeadSummary } from '../../lib/portalApi';
import { PORTAL_SHELL_CLASS } from './components/portalTheme';
import PortalProfileMenu from './components/PortalProfileMenu';
import PortalNotifications from './components/PortalNotifications';

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
  const isDashboard = activeNavTab === 'summary';
  const desktopLogoSrc = isDashboard ? '/DPLOGO1.png' : '/DPL-LOGO1.png';

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

  return (
    <div className={`${PORTAL_SHELL_CLASS} flex flex-col`}>
      {/* Mobile header */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur-md md:hidden">
        <div className="relative flex w-full items-center gap-2 px-2 py-3">
          {hasNav ? (
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base-content/70 transition-colors hover:bg-base-200/70"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileNavOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
            </button>
          ) : null}

          <img
            src="/DPL-LOGO1.png"
            alt="Decker Pex & Co Law Offices"
            className="h-10 w-auto max-w-[120px] shrink-0 object-contain"
          />

          <div className="flex-1" />

          {hasNav ? (
            <PortalNotifications
              onNavigate={(tabId) => selectTab(tabId)}
              storageKey={leadSummary?.lead_number}
            />
          ) : null}

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

      {/* Desktop header — single row: logo · nav · profile/bell */}
      <header className="sticky top-0 z-30 hidden h-20 w-full items-center gap-3 px-4 md:flex lg:px-6">
        <img
          src={desktopLogoSrc}
          alt="Decker Pex & Co Law Offices"
          className={`h-10 w-auto max-w-[160px] shrink-0 object-contain lg:h-12 lg:max-w-[180px] ${
            isDashboard ? 'drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]' : ''
          }`}
        />

        {hasNav ? (
          <nav
            className="mx-auto flex min-w-0 flex-wrap items-center justify-center gap-x-0.5 rounded-full border border-gray-200 bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur-md lg:gap-x-1.5 lg:px-3 lg:py-2"
            aria-label="Case sections"
          >
            {navTabs!.map((tab) => {
              const active = activeNavTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  className={`shrink-0 rounded-full px-2.5 py-1.5 text-xs transition-colors lg:px-4 lg:text-sm ${
                    active
                      ? 'bg-primary/10 font-semibold text-primary shadow-sm'
                      : 'font-medium text-base-content/55 hover:bg-base-200/60 hover:text-base-content/85'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="mx-auto" />
        )}

        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          {contact?.name ? (
            <div className="rounded-full border border-gray-200 bg-white px-1.5 shadow-lg">
              <PortalProfileMenu
                name={contact.name}
                leadNumber={leadSummary?.lead_number}
                imageUrl={contactProfileImageUrl}
                stableKey={coverKey}
                onLogout={onLogout}
                onSettings={onSettings}
              />
            </div>
          ) : null}
          {hasNav ? (
            <div className="rounded-full border border-gray-200 bg-white shadow-lg">
              <PortalNotifications
                onNavigate={(tabId) => selectTab(tabId)}
                storageKey={leadSummary?.lead_number}
              />
            </div>
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
