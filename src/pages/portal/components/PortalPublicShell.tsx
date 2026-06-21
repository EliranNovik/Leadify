import React, { useEffect } from 'react';
import LoginHeroBackground from '../../../components/LoginHeroBackground';
import PublicPageContactButtons from '../../../components/public/PublicPageContactButtons';
import { usePortalLoginI18nOptional } from '../i18n/PortalLoginI18nContext';
import PortalPublicNav from './PortalPublicNav';
import PortalLoginAboutPanel from './PortalLoginAboutPanel';
import { PORTAL_LOGIN_SIGNIN_PANEL_BG_CLASS } from './portalTheme';

const LOGIN_PAGE_THEME_COLOR = '#ffffff';
const LOGIN_PAGE_THEME_COLOR_FULL = '#1a1a1a';

/** White sign-in column */
const LEFT_PANEL_CLASS =
  `relative z-10 flex min-h-[100dvh] w-full flex-col overflow-y-auto ${PORTAL_LOGIN_SIGNIN_PANEL_BG_CLASS} lg:w-[min(500px,46%)] lg:max-w-[540px] lg:shrink-0 lg:pt-0`;

type Props = {
  leadRef: string;
  children: React.ReactNode;
  showLanguageSwitcher?: boolean;
  /** Left: dark panel with content. Right: hero video (desktop only). */
  splitHero?: boolean;
};

const PortalPublicShell: React.FC<Props> = ({
  leadRef,
  children,
  showLanguageSwitcher = false,
  splitHero = false,
}) => {
  const i18n = usePortalLoginI18nOptional();
  const year = new Date().getFullYear();

  useEffect(() => {
    const html = document.documentElement;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    const prevTheme = metaTheme?.getAttribute('content') ?? '#ffffff';

    html.classList.add('login-page-active');
    metaTheme?.setAttribute('content', splitHero ? LOGIN_PAGE_THEME_COLOR : LOGIN_PAGE_THEME_COLOR_FULL);

    return () => {
      html.classList.remove('login-page-active');
      metaTheme?.setAttribute('content', prevTheme);
    };
  }, [splitHero]);

  const logoMobile = (
    <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-primary p-1">
      <img
        src="/DPL-LOGO1.png"
        alt={i18n?.t.logoAlt ?? 'Decker Pex & CO Law Offices'}
        className="h-full w-full object-contain"
      />
    </span>
  );

  const logoVideo = (
    <img
      src="/DPLOGO1.png"
      alt={i18n?.t.logoAlt ?? 'Decker Pex & CO Law Offices'}
      className="h-11 w-auto max-w-[170px] shrink-0 object-contain opacity-95 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)] md:h-12 md:max-w-[190px]"
    />
  );

  const logo = logoVideo;

  const headerVideoPanel = (
    <div className="flex items-start justify-between gap-4 px-4 py-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] md:px-8 md:py-6">
      <div className="flex min-w-0 justify-start">{logoVideo}</div>
      <div className="flex min-w-0 shrink-0 justify-end">
        {leadRef ? (
          <PortalPublicNav
            leadRef={leadRef}
            variant="hero"
            showLanguageSwitcher={showLanguageSwitcher}
            hideAboutLink
          />
        ) : null}
      </div>
    </div>
  );

  const headerMobile = (
    <div className="flex items-center justify-between gap-4 px-4 py-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] md:px-8 md:py-5">
      {leadRef ? (
        <PortalPublicNav
          leadRef={leadRef}
          variant="light"
          showLanguageSwitcher={showLanguageSwitcher}
        />
      ) : (
        <div />
      )}
      {logoMobile}
    </div>
  );

  const footerDark = (
    <div className="pointer-events-none flex shrink-0 justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-2">
      <span className="text-center text-xs font-medium text-white/40 md:text-sm">
        © RMQ 2.0 {year}
      </span>
    </div>
  );

  const footerLight = (
    <div className="pointer-events-none flex shrink-0 justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-2">
      <span className="text-center text-xs font-medium text-base-content/40 md:text-sm">
        © RMQ 2.0 {year}
      </span>
    </div>
  );

  const contactButtons = (opts: { darkSurface?: boolean; className?: string }) => (
    <PublicPageContactButtons
      needHelpLabel={i18n?.t.needHelp}
      contactUsLabel={i18n?.t.contactUs}
      whatsappLabel={i18n?.t.whatsapp}
      emailLabel={i18n?.t.email}
      callLabel={i18n?.t.call}
      darkSurface={opts.darkSurface}
      containerClassName={
        opts.className ??
        'fixed bottom-10 end-6 z-40 print-hide flex flex-col items-end gap-2'
      }
    />
  );

  if (splitHero) {
    return (
      <div className="login-page fixed inset-0 z-0 flex overflow-hidden bg-white">
        {/* Left: sign-in panel */}
        <div className={LEFT_PANEL_CLASS}>
          <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-8 pt-[calc(4.5rem+env(safe-area-inset-top,0px))] md:px-10 lg:px-12 lg:py-8 lg:pt-0">
            <div className="w-full max-w-[380px]">{children}</div>
          </div>
          {footerLight}
          {contactButtons({
            darkSurface: false,
            className:
              'absolute bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))] end-6 z-40 print-hide flex flex-col items-end gap-2 lg:hidden',
          })}
        </div>

        {/* Right: inset video panel (desktop) */}
        <div className="relative hidden min-h-[100dvh] flex-1 bg-white p-1 lg:flex xl:p-1.5">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] xl:rounded-3xl">
            <LoginHeroBackground />
            <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-black/22 via-black/14 to-black/30" />

            <div className="absolute inset-0 z-10 flex items-center justify-center px-6 py-24 pt-28 pb-28 xl:px-10">
              <PortalLoginAboutPanel variant="hero" />
            </div>

            <div className="absolute inset-x-0 top-0 z-30">{headerVideoPanel}</div>

            {contactButtons({
              darkSurface: true,
              className:
                'absolute bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))] end-6 z-40 print-hide flex flex-col items-end gap-2 xl:end-8',
            })}
          </div>
        </div>

        {/* Mobile: logo + nav on sign-in panel */}
        <div className="absolute inset-x-0 top-0 z-30 bg-white/95 backdrop-blur-md lg:hidden">
          {headerMobile}
        </div>
      </div>
    );
  }

  return (
    <div className="login-page fixed inset-0 z-0 flex flex-col overflow-y-auto overflow-x-hidden">
      <LoginHeroBackground />
      <div className="absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-4 px-4 py-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] md:px-8 md:py-6">
        {logo}
        {leadRef ? (
          <PortalPublicNav
            leadRef={leadRef}
            variant="hero"
            showLanguageSwitcher={showLanguageSwitcher}
          />
        ) : null}
      </div>
      <div className="relative z-10 flex flex-1 min-h-[100dvh] items-center justify-center px-4 py-10 pt-[calc(4.5rem+env(safe-area-inset-top,0px))] pb-[max(2.5rem,env(safe-area-inset-bottom,0px))]">
        {children}
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20">{footerDark}</div>
      {contactButtons({ darkSurface: true })}
    </div>
  );
};

export default PortalPublicShell;
