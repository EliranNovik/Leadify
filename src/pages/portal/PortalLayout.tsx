import React, { useEffect, useState } from 'react';
import { Bars3Icon, ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import PublicPageContactButtons from '../../components/public/PublicPageContactButtons';
import type { PortalContact, PortalLeadSummary } from '../../lib/portalApi';
import { PORTAL_SHELL_CLASS } from './components/portalTheme';
import PortalProfileMenu from './components/PortalProfileMenu';
import PortalNotifications from './components/PortalNotifications';
import PortalFooter from './components/PortalFooter';
import PortalAppLanguageSwitcher from './components/PortalAppLanguageSwitcher';

export type PortalNavTab = { id: string; label: string };

const PORTAL_NAV_MENUS: Record<string, { id: string; labelKey: string }[]> = {
  meetings: [
    { id: 'create', labelKey: 'nav.actions.meetings.create' },
    { id: 'past', labelKey: 'nav.actions.meetings.past' },
  ],
  contacts: [{ id: 'create', labelKey: 'nav.actions.contacts.create' }],
  finance: [
    { id: 'paid', labelKey: 'nav.actions.finance.paid' },
    { id: 'due', labelKey: 'nav.actions.finance.due' },
    { id: 'invoices', labelKey: 'nav.actions.finance.invoices' },
    { id: 'taxReceipts', labelKey: 'nav.actions.finance.taxReceipts' },
  ],
};

type Props = {
  leadSummary: PortalLeadSummary | null;
  contact: PortalContact | null;
  contactProfileImageUrl?: string | null;
  onLogout: () => void;
  onSettings?: () => void;
  navTabs?: PortalNavTab[];
  activeNavTab?: string;
  onNavTabChange?: (tabId: string) => void;
  onNavAction?: (tabId: string, actionId: string) => void;
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
  onNavAction,
  children,
}) => {
  const { t } = useTranslation();
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

  const dashboardWash = activeNavTab === 'summary';

  return (
    <div className={`${PORTAL_SHELL_CLASS} flex flex-col ${dashboardWash ? 'portal-dashboard-wash' : ''}`}>
      {/* Mobile header */}
      <header className="sticky top-0 z-30 bg-[#f7f7fb] md:hidden">
        <div className="relative flex w-full items-center gap-2 px-2 py-2">
          {hasNav ? (
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base-content/70 transition-colors hover:bg-base-200/70"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? t('layout.menuClose') : t('layout.menuOpen')}
            >
              {mobileNavOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
            </button>
          ) : null}

          <img
            src="/DPL-LOGO1.png"
            alt={t('layout.logoAlt')}
            className="h-8 w-auto max-w-[96px] shrink-0 object-contain"
          />

          <div className="flex-1" />

          <PortalAppLanguageSwitcher />

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

      {/* Desktop header — same grey as the page, so it does not read as a white bar. */}
      <header className="sticky top-0 z-40 hidden h-14 w-full items-center gap-3 overflow-visible bg-[#f7f7fb] px-4 md:flex lg:px-6">
        <img
          src="/DPL-LOGO1.png"
          alt={t('layout.logoAlt')}
          className="h-8 w-auto max-w-[130px] shrink-0 object-contain lg:h-9 lg:max-w-[140px]"
        />

        {hasNav ? (
          <nav
            className="mx-auto flex min-w-0 flex-wrap items-center justify-center gap-x-2"
            aria-label={t('nav.ariaCaseSections')}
          >
            {navTabs!.map((tab) => {
              const active = activeNavTab === tab.id;
              const menu = PORTAL_NAV_MENUS[tab.id];
              const tabButton = (
                <button
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  className={`inline-flex shrink-0 items-center gap-1 border-b-2 px-2 py-1 text-xs transition-colors lg:px-3 lg:py-1.5 lg:text-sm ${
                    active
                      ? 'border-blue-900 font-semibold text-blue-900'
                      : 'border-transparent font-medium text-[#747684] hover:text-[#16161d]'
                  }`}
                >
                  {tab.label}
                  {menu?.length ? (
                    <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:rotate-180" />
                  ) : null}
                </button>
              );
              if (!menu?.length) return <React.Fragment key={tab.id}>{tabButton}</React.Fragment>;
              return (
                <div key={tab.id} className="group relative">
                  {tabButton}
                  <div className="invisible absolute left-1/2 top-full z-50 w-52 -translate-x-1/2 pt-2 opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                    <div className="rounded-2xl bg-white py-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.14)] ring-1 ring-black/5">
                      {menu.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="block w-full px-4 py-2.5 text-start text-sm font-medium text-[#16161d] transition-colors hover:bg-[#f4f5f8]"
                          onClick={() => onNavAction?.(tab.id, item.id)}
                        >
                          {t(item.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        ) : (
          <div className="mx-auto" />
        )}

        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          <PortalAppLanguageSwitcher />
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
          <div className="flex items-center gap-2 border-b border-[rgba(20,20,30,0.06)] bg-white/90 px-2 py-2 backdrop-blur-md">
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base-content/70 transition-colors hover:bg-base-200/70"
              onClick={() => setMobileNavOpen(false)}
              aria-label={t('layout.menuClose')}
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
            <img
              src="/DPL-LOGO1.png"
              alt={t('layout.logoAlt')}
              className="h-8 w-auto max-w-[96px] object-contain"
            />
            <div className="flex-1" />
            <PortalAppLanguageSwitcher />
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-6" aria-label={t('nav.ariaCaseSections')}>
            <div className="flex flex-col gap-2">
              {navTabs!.map((tab) => {
                const active = activeNavTab === tab.id;
                const menu = PORTAL_NAV_MENUS[tab.id];
                return (
                  <div key={tab.id} className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => selectTab(tab.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-4 text-start text-base transition-colors ${
                        active
                          ? `bg-white font-semibold text-blue-900 shadow-[0_8px_24px_rgba(15,23,42,0.06)]`
                          : 'bg-white/70 font-medium text-[#747684] hover:bg-white'
                      }`}
                    >
                      <span>{tab.label}</span>
                      {menu?.length ? <ChevronDownIcon className="h-5 w-5 shrink-0" /> : null}
                    </button>
                    {menu?.length ? (
                      <div className="flex flex-col gap-1 ps-3">
                        {menu.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="w-full rounded-xl bg-white/80 px-4 py-3 text-start text-sm font-medium text-[#16161d]"
                            onClick={() => {
                              onNavAction?.(tab.id, item.id);
                              setMobileNavOpen(false);
                            }}
                          >
                            {t(item.labelKey)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </nav>
        </div>
      ) : null}

      <main className="w-full flex-1 overflow-visible px-2 py-6 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] md:px-10 md:py-8 md:pb-12">
        {children}
      </main>

      <PortalFooter tone="gray" logoSrc="/DPL-LOGO1.png" />

      <PublicPageContactButtons
        gradient
        needHelpLabel={t('common.needHelp')}
        contactUsLabel={t('common.contactUs')}
        whatsappLabel={t('common.teamContact.whatsApp')}
        emailLabel={t('common.teamContact.email')}
        callLabel={t('common.teamContact.call')}
      />
    </div>
  );
};

export default PortalLayout;
