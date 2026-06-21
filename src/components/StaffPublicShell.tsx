import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import LoginHeroBackground from './LoginHeroBackground';
import LoginHeroTagline from './LoginHeroTagline';
import ClockInGateVideos from './ClockInGateVideos';

const LOGIN_PAGE_THEME_COLOR = '#ffffff';

export const STAFF_PUBLIC_INPUT_CLASS =
  'h-11 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 text-sm text-neutral-900 transition placeholder:text-neutral-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20';

export const STAFF_PUBLIC_TEXTAREA_CLASS =
  'w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-900 transition placeholder:text-neutral-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none';

export const STAFF_PUBLIC_LABEL_CLASS =
  'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500';

const BACK_BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-full bg-base-200/45 px-3.5 py-2 text-sm font-medium text-base-content/65 transition-colors hover:bg-primary/10 hover:text-primary';

/** Login-like split — animation start state */
const LEFT_PANEL_NARROW_CLASS = 'lg:w-[min(500px,46%)] lg:max-w-[540px]';
/** Wider content panel for About / Contact */
const LEFT_PANEL_WIDE_CLASS = 'lg:w-[min(640px,58%)] lg:max-w-[720px]';

const PANEL_TRANSITION_CLASS =
  'transition-[width,max-width,flex-basis,padding] duration-[850ms] ease-[cubic-bezier(0.4,0,0.2,1)]';

const NAV_LINK_CLASS =
  'rounded-full px-3.5 py-2 text-sm font-medium text-white/95 transition-colors hover:bg-white/15 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]';

const NAV_LINK_ACTIVE_CLASS = 'bg-white/20 ring-1 ring-white/25';

const SERIF_STYLE = { fontFamily: "'Playfair Display', 'Libre Baskerville', serif" } as const;

export type StaffPublicNavKey = 'about' | 'contact' | 'how-it-works';

type Props = {
  title: string;
  subtitle?: string;
  activeNav?: StaffPublicNavKey;
  children: React.ReactNode;
  showBackToLogin?: boolean;
};

const StaffPublicShell: React.FC<Props> = ({
  title,
  subtitle,
  activeNav,
  children,
  showBackToLogin = true,
}) => {
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [splitExpanded, setSplitExpanded] = useState(false);
  const year = new Date().getFullYear();

  useEffect(() => {
    const html = document.documentElement;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    const prevTheme = metaTheme?.getAttribute('content') ?? '#ffffff';

    html.classList.add('login-page-active');
    metaTheme?.setAttribute('content', LOGIN_PAGE_THEME_COLOR);

    return () => {
      html.classList.remove('login-page-active');
      metaTheme?.setAttribute('content', prevTheme);
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setSplitExpanded(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  const leftPanelWidthClass = splitExpanded ? LEFT_PANEL_WIDE_CLASS : LEFT_PANEL_NARROW_CLASS;
  const videoInsetClass = splitExpanded ? 'p-1 xl:p-1.5' : 'p-8 xl:p-12';

  const navItemClass = (key: StaffPublicNavKey) =>
    `${NAV_LINK_CLASS}${activeNav === key ? ` ${NAV_LINK_ACTIVE_CLASS}` : ''}`;

  const navLinks = (
    <>
      <button type="button" onClick={() => navigate('/about')} className={navItemClass('about')}>
        About Us
      </button>
      <button type="button" onClick={() => navigate('/contact')} className={navItemClass('contact')}>
        Contact
      </button>
      <button
        type="button"
        onClick={() => navigate('/how-it-works')}
        className={navItemClass('how-it-works')}
      >
        How It Works
      </button>
    </>
  );

  const mobileNavLinks = (
    <>
      {(
        [
          ['about', '/about', 'About Us'],
          ['contact', '/contact', 'Contact'],
          ['how-it-works', '/how-it-works', 'How It Works'],
        ] as const
      ).map(([key, path, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => {
            navigate(path);
            setIsMenuOpen(false);
          }}
          className={`w-full px-6 py-3 text-left transition-colors hover:bg-base-200 ${
            activeNav === key ? 'bg-primary/5 font-semibold text-primary' : 'text-base-content/80'
          }`}
        >
          {label}
        </button>
      ))}
      {showBackToLogin ? (
        <>
          <div className="mx-6 my-1 border-t border-base-200" />
          <button
            type="button"
            onClick={() => {
              navigate('/login');
              setIsMenuOpen(false);
            }}
            className="w-full px-6 py-3 text-left font-semibold text-primary transition-colors hover:bg-primary/5"
          >
            Sign in
          </button>
        </>
      ) : null}
    </>
  );

  return (
    <div className="login-page fixed inset-0 z-0 flex overflow-hidden bg-white">
      {showBackToLogin ? (
        <div
          className={`fixed left-0 z-40 hidden w-full bg-[#ececec]/95 backdrop-blur-md lg:block ${leftPanelWidthClass} ${PANEL_TRANSITION_CLASS} lg:top-0`}
        >
          <div className="flex items-center px-6 py-3 md:px-10 lg:px-12 lg:py-4">
            <button type="button" onClick={() => navigate('/login')} className={BACK_BUTTON_CLASS}>
              <ArrowLeftIcon className="h-4 w-4" />
              Back to sign in
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={`relative z-10 flex min-h-[100dvh] w-full flex-col overflow-y-auto bg-[#ececec] ${leftPanelWidthClass} ${PANEL_TRANSITION_CLASS} lg:shrink-0`}
      >
        <div className="relative flex flex-1 flex-col px-6 py-8 pt-[calc(3.5rem+env(safe-area-inset-top,0px))] md:px-10 lg:px-12 lg:pt-28 lg:pb-10 xl:pt-32">
          <div className="w-full max-w-[560px]">
            <div className="mb-10">
              <div
                className="mb-5 h-px w-14 bg-gradient-to-r from-primary/70 via-primary/30 to-transparent"
                aria-hidden
              />
              <h1
                className="text-2xl font-bold tracking-tight text-base-content md:text-[2rem] md:leading-tight"
                style={SERIF_STYLE}
              >
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-3 max-w-sm text-xs font-medium uppercase tracking-[0.14em] text-base-content/45 md:text-[13px]">
                  {subtitle}
                </p>
              ) : null}
            </div>

            {children}
          </div>

          <div className="mt-10 w-full max-w-[560px] lg:hidden">
            <ClockInGateVideos placement="mobile" mobileTheme="light" />
          </div>
        </div>

        <div className="pointer-events-none flex shrink-0 justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-2">
          <span className="text-center text-xs font-medium text-base-content/40 md:text-sm">
            © Rainmaker Queen 2.0 {year}
          </span>
        </div>
      </div>

      <div
        className={`relative hidden min-h-[100dvh] flex-1 bg-white lg:flex ${videoInsetClass} ${PANEL_TRANSITION_CLASS}`}
      >
        <div
          className={`relative min-h-0 flex-1 overflow-hidden rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] transition-[transform,opacity,border-radius] duration-[850ms] ease-[cubic-bezier(0.4,0,0.2,1)] xl:rounded-3xl ${
            splitExpanded ? 'scale-100 opacity-100' : 'scale-[0.94] opacity-90'
          }`}
        >
          <LoginHeroBackground />
          <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-black/22 via-black/14 to-black/30" />

          <div className="absolute inset-x-0 top-0 z-30 px-8 py-4">
            <div className="flex items-start justify-between gap-6">
              <img
                src="/RMQ_LOGO.png"
                alt="RMQ 2.0"
                className="h-20 w-20 shrink-0 object-contain opacity-95 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)] xl:h-24 xl:w-24"
              />
              <div className="flex min-w-0 flex-col items-end gap-4">
                <div className="flex items-start justify-end gap-1">{navLinks}</div>
                <LoginHeroTagline />
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-28 z-20 flex flex-col items-stretch px-4 xl:bottom-32 xl:px-6">
            <ClockInGateVideos placement="desktop" desktopLayout="strip" />
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 top-0 z-30 bg-white/95 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top,0px))] md:px-8 md:py-3">
          <button
            type="button"
            onClick={() => setIsMenuOpen((v) => !v)}
            className="text-base-content/70 transition-colors hover:text-base-content"
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {isMenuOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
          </button>
          <img
            src="/RMQ_LOGO.png"
            alt="RMQ 2.0"
            className="h-12 w-12 shrink-0 object-contain md:h-14 md:w-14"
          />
        </div>

        {isMenuOpen ? (
          <div className="border-t border-base-200 bg-white py-2 shadow-lg">{mobileNavLinks}</div>
        ) : null}
      </div>
    </div>
  );
};

export default StaffPublicShell;
