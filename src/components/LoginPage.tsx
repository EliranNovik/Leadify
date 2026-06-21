import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  AtSymbolIcon,
  Bars3Icon,
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { preCheckExternalUser } from '../hooks/useExternalUser';
import { fetchWelcomeProfileForEmail } from '../lib/loginWelcomeProfile';
import { setDashboardWelcomePending } from '../lib/dashboardWelcomeSession';
import LoginHeroBackground from './LoginHeroBackground';
import LoginHeroTagline from './LoginHeroTagline';
import ClockInGateVideos from './ClockInGateVideos';

const LOGIN_PAGE_THEME_COLOR = '#ffffff';

const LEFT_PANEL_CLASS =
  'relative z-10 flex min-h-[100dvh] w-full flex-col overflow-y-auto bg-white lg:w-[min(500px,46%)] lg:max-w-[540px] lg:shrink-0 lg:pt-0';

const INPUT_CLASS =
  'h-11 w-full rounded-[10px] border border-base-300 bg-white px-4 text-sm text-base-content shadow-sm transition placeholder:text-base-content/35 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15';

const NAV_LINK_CLASS =
  'rounded-full px-3.5 py-2 text-sm font-medium text-white/95 transition-colors hover:bg-white/15 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
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

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    else if (data?.user) {
      const profile = data.user.email
        ? await fetchWelcomeProfileForEmail(data.user.email, data.user)
        : { name: email, imageUrl: '' };

      setDashboardWelcomePending(profile);

      void import('../components/Dashboard');
      if (data.user.id) {
        void preCheckExternalUser(data.user.id);
      }

      navigate('/', { replace: true });
    }
    setLoading(false);
  };

  const handleMagicLink = async () => {
    setMagicLinkLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: 'https://leadify-crm.onrender.com',
        },
      });

      if (otpError) {
        setError(otpError.message);
      } else {
        setSuccess(
          'Magic link sent successfully! Please check your email and click the secure link to sign in.',
        );
        setTimeout(() => setSuccess(null), 10000);
      }
    } catch {
      setError('Failed to send magic link. Please try again.');
    } finally {
      setMagicLinkLoading(false);
    }
  };

  const navLinks = (
    <>
      <button type="button" onClick={() => navigate('/about')} className={NAV_LINK_CLASS}>
        About Us
      </button>
      <button type="button" onClick={() => navigate('/contact')} className={NAV_LINK_CLASS}>
        Contact
      </button>
      <button type="button" onClick={() => navigate('/how-it-works')} className={NAV_LINK_CLASS}>
        How It Works
      </button>
    </>
  );

  const mobileNavLinks = (
    <>
      <button
        type="button"
        onClick={() => {
          navigate('/about');
          setIsMenuOpen(false);
        }}
        className="w-full px-6 py-3 text-left text-white/90 transition-colors hover:bg-white/10"
      >
        About Us
      </button>
      <button
        type="button"
        onClick={() => {
          navigate('/contact');
          setIsMenuOpen(false);
        }}
        className="w-full px-6 py-3 text-left text-white/90 transition-colors hover:bg-white/10"
      >
        Contact
      </button>
      <button
        type="button"
        onClick={() => {
          navigate('/how-it-works');
          setIsMenuOpen(false);
        }}
        className="w-full px-6 py-3 text-left text-white/90 transition-colors hover:bg-white/10"
      >
        How It Works
      </button>
    </>
  );

  const signInForm = (
    <div className="w-full">
      <div className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-base-content md:text-3xl">
          Employee sign in
        </h1>
      </div>

      <form onSubmit={handleSignIn} className="space-y-7">
        <div>
          <label className="mb-2.5 block text-sm font-medium text-base-content/60" htmlFor="staff-email">
            Email
          </label>
          <div className="relative">
            <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-base-content/40" />
            <input
              id="staff-email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              placeholder="you@example.com"
              className={`${INPUT_CLASS} pl-10`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="mb-2.5 block text-sm font-medium text-base-content/60" htmlFor="staff-password">
            Password
          </label>
          <div className="relative">
            <LockClosedIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-base-content/40" />
            <input
              id="staff-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder="Enter your password"
              className={`${INPUT_CLASS} pl-10 pr-11`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/40 transition-colors hover:text-base-content/70"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary mt-2 h-11 w-full rounded-xl border-0 font-semibold"
          disabled={loading}
        >
          {loading ? <span className="loading loading-spinner loading-sm" /> : 'Sign in'}
        </button>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleMagicLink}
            disabled={magicLinkLoading || !email}
            className="text-sm text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {magicLinkLoading ? 'Sending…' : 'Forgot password?'}
          </button>
        </div>
      </form>

      {success ? (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {success}
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="login-page fixed inset-0 z-0 flex overflow-hidden bg-white">
      {/* Left: sign-in panel */}
      <div className={LEFT_PANEL_CLASS}>
        <div className="relative shrink-0 overflow-hidden lg:hidden">
          <div className="absolute inset-0">
            <LoginHeroBackground />
            <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-black/35 via-black/25 to-black/50" />
          </div>

          <div className="relative z-10">
            <div className="flex items-center justify-between gap-3 px-4 py-2 pb-2.5 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] md:px-6">
              <button
                type="button"
                onClick={() => setIsMenuOpen((v) => !v)}
                className="text-white/90 transition-colors hover:text-white"
                aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
              >
                {isMenuOpen ? <XMarkIcon className="h-7 w-7" /> : <Bars3Icon className="h-7 w-7" />}
              </button>
              <img
                src="/RMQ_LOGO.png"
                alt="RMQ 2.0"
                className="h-11 w-11 shrink-0 object-contain opacity-95 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
              />
            </div>

            {isMenuOpen ? (
              <div className="border-t border-white/15 bg-black/45 py-2 backdrop-blur-md">
                {mobileNavLinks}
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-8 md:px-10 lg:justify-start lg:px-12 lg:pt-36 lg:py-0 xl:pt-40">
          <div className="w-full max-w-[380px]">{signInForm}</div>
          <div className="mt-8 w-full lg:hidden">
            <ClockInGateVideos placement="mobile" mobileTheme="light" />
          </div>
        </div>

        <div className="pointer-events-none flex shrink-0 justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-2">
          <span className="text-center text-xs font-medium text-base-content/40 md:text-sm">
            © Rainmaker Queen 2.0 {year}
          </span>
        </div>
      </div>

      {/* Right: inset video panel (desktop) */}
      <div className="relative hidden min-h-[100dvh] flex-1 bg-white p-1 lg:flex xl:p-1.5">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] xl:rounded-3xl">
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
    </div>
  );
};

export default LoginPage;
