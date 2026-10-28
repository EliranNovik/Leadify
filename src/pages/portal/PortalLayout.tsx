import React, { useEffect, useState } from 'react';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import PublicPageContactButtons from '../../components/public/PublicPageContactButtons';
import type { PortalContact, PortalLeadSummary } from '../../lib/portalApi';
import { PORTAL_SHELL_CLASS } from './components/portalTheme';
import PortalProfileMenu from './components/PortalProfileMenu';
import PortalNotifications from './components/PortalNotifications';
import PortalFooter from './components/PortalFooter';

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

  return (
    <div className={`${PORTAL_SHELL_CLASS} flex flex-col`}>
      {/* Mobile header */}
      <header className="sticky top-0 z-30 border-b border-[rgba(20,20,30,0.07)] bg-white/95 backdrop-blur-xl md:hidden">
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

          {contact?.name ? (
            <PortalProfileMenu
              name={contact.name}
              leadNumber={leadSummary?.lead_number}
              imageUrl={contactProfileImageUrl}
              stableKey={coverKey}
              onLogout={onLogout}
              onSettings={onSettings}
              showIdentity={false}
            />
          ) : null}

          {/* Last on the row, so the bell is in the corner and its list opens inside the screen. */}
          {hasNav ? (
            <PortalNotifications
              onNavigate={(tabId) => selectTab(tabId)}
              storageKey={leadSummary?.lead_number}
            />
          ) : null}
        </div>
      </header>

      {/* Desktop header — a plain white bar: logo · nav · profile/bell, all sitting on it. */}
      <header className="sticky top-0 z-30 hidden h-20 w-full items-center gap-3 bg-white/95 px-4 backdrop-blur-xl md:flex lg:px-6">
        <img
          src="/DPL-LOGO1.png"
          alt="Decker Pex & Co Law Offices"
          className="h-10 w-auto max-w-[160px] shrink-0 object-contain lg:h-12 lg:max-w-[180px]"
        />

        {hasNav ? (
          <nav
            className="mx-auto flex min-w-0 flex-wrap items-center justify-center gap-x-2"
            aria-label="Case sections"
          >
            {navTabs!.map((tab) => {
              const active = activeNavTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  // The section you are in is marked by a line under it rather than a pill.
                  className={`shrink-0 border-b-2 px-2 py-1.5 text-xs transition-colors lg:px-3 lg:py-2 lg:text-sm ${
                    active
                      ? 'border-blue-900 font-semibold text-blue-900'
                      : 'border-transparent font-medium text-[#747684] hover:text-[#16161d]'
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
            <PortalProfileMenu
              name={contact.name}
              leadNumber={leadSummary?.lead_number}
              imageUrl={contactProfileImageUrl}
              stableKey={coverKey}
              onLogout={onLogout}
              onSettings={onSettings}
            />
          ) : null}
          {hasNav ? (
            <PortalNotifications
              onNavigate={(tabId) => selectTab(tabId)}
              storageKey={leadSummary?.lead_number}
            />
          ) : null}
        </div>
      </header>

      {hasNav && mobileNavOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-[#f7f7fb] to-[#f1f2f6] md:hidden">
          <div className="flex items-center gap-2 border-b border-[rgba(20,20,30,0.06)] bg-white/90 px-2 py-3 backdrop-blur-md">
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
                        ? `bg-white font-semibold text-blue-900 shadow-[0_8px_24px_rgba(15,23,42,0.06)]`
                        : 'bg-white/70 font-medium text-[#747684] hover:bg-white'
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

      <main className="w-full flex-1 overflow-visible px-2 py-6 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] md:px-10 md:py-8 md:pb-12">
        {children}
      </main>

      <PortalFooter />

      <PublicPageContactButtons />
    </div>
  );
};

export default PortalLayout;
