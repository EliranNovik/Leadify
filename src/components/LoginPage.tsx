import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AtSymbolIcon, ArrowRightOnRectangleIcon, CheckCircleIcon, Bars3Icon, XMarkIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { preCheckExternalUser } from '../hooks/useExternalUser';
import { fetchWelcomeProfileForEmail } from '../lib/loginWelcomeProfile';
import { setDashboardWelcomePending } from '../lib/dashboardWelcomeSession';
import LoginHeroBackground from './LoginHeroBackground';
import ClockInGateVideos from './ClockInGateVideos';

const LOGIN_PAGE_THEME_COLOR = '#1a1a1a';

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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
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
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: 'https://leadify-crm.onrender.com'
        }
      });

      if (error) {
        setError(error.message);
      } else {
        setSuccess('Magic link sent successfully! Please check your email and click the secure link to sign in.');
        // Clear success message after 10 seconds
        setTimeout(() => {
          setSuccess(null);
        }, 10000);
      }
    } catch (err) {
      setError('Failed to send magic link. Please try again.');
    } finally {
      setMagicLinkLoading(false);
    }
  };

  return (
    <div className="login-page fixed inset-0 z-0 flex flex-col overflow-y-auto overflow-x-hidden">
      <LoginHeroBackground />
      <>
          {/* Full width login box */}
          <div className="w-full flex flex-col justify-start items-center flex-1 relative z-10 pt-[calc(4rem+env(safe-area-inset-top,0px))] md:pt-20 min-h-[100dvh] min-h-[100svh]">
            {/* Header bar - Mobile */}
            <div className="md:hidden absolute top-0 left-0 right-0 z-30 pt-safe">
              <div className="flex items-center justify-between py-4 px-6">
                {/* Hamburger Menu Button */}
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="text-white hover:text-gray-200 transition-colors duration-200"
                >
                  {isMenuOpen ? (
                    <XMarkIcon className="w-7 h-7" />
                  ) : (
                    <Bars3Icon className="w-7 h-7" />
                  )}
                </button>

                {/* Centered Logo */}
                <div className="flex items-center gap-3">
                  <img src="/RMQ_LOGO.png" alt="RMQ 2.0" className="w-20 h-20 object-contain" />
                </div>

              </div>
              {/* Mobile Menu Overlay */}
              {isMenuOpen && (
                <div className="absolute top-full left-0 right-0 shadow-lg z-40 bg-black/70 border border-white/15 backdrop-blur-md">
                  <div className="py-2">
                    <button
                      onClick={() => {
                        navigate('/about');
                        setIsMenuOpen(false);
                      }}
                      className="w-full text-left px-6 py-3 text-white/90 hover:bg-white/10 transition-colors duration-200"
                    >
                      About Us
                    </button>
                    <button
                      onClick={() => {
                        navigate('/contact');
                        setIsMenuOpen(false);
                      }}
                      className="w-full text-left px-6 py-3 text-white/90 hover:bg-white/10 transition-colors duration-200"
                    >
                      Contact
                    </button>
                    <button
                      onClick={() => {
                        navigate('/how-it-works');
                        setIsMenuOpen(false);
                      }}
                      className="w-full text-left px-6 py-3 text-white/90 hover:bg-white/10 transition-colors duration-200"
                    >
                      How It Works
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Desktop Header */}
            <div className="hidden md:block absolute top-0 left-0 right-0 z-30">
              <div className="flex items-center justify-between py-4 px-8">
                {/* Brand */}
                <div className="flex items-center gap-3">
                  <img src="/RMQ_LOGO.png" alt="RMQ 2.0" className="w-24 h-24 object-contain" />
                </div>

                {/* Navigation Links */}
                <div className="flex items-center gap-9">
                  <button
                    onClick={() => navigate('/about')}
                    className="text-white/95 hover:text-[#f5e8c4] transition-colors duration-200 font-semibold text-[15px] tracking-[0.03em] drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
                  >
                    About Us
                  </button>
                  <button
                    onClick={() => navigate('/contact')}
                    className="text-white/95 hover:text-[#f5e8c4] transition-colors duration-200 font-semibold text-[15px] tracking-[0.03em] drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
                  >
                    Contact
                  </button>
                  <button
                    onClick={() => navigate('/how-it-works')}
                    className="text-white/95 hover:text-[#f5e8c4] transition-colors duration-200 font-semibold text-[15px] tracking-[0.03em] drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
                  >
                    How It Works
                  </button>
                </div>
              </div>
            </div>
            {/* Logo above login form */}
            <div className="w-full h-72 md:h-[420px] relative -mt-16 md:-mt-20 mb-4 md:mb-6 flex justify-center items-center">
              <div className="hidden md:block absolute right-4 md:right-10 top-1/2 -translate-y-1/2 z-10 text-right text-white max-w-[320px] md:max-w-[700px] px-4 py-3 md:px-6 md:py-5">
                <div className="text-xl md:text-[2.2rem] font-semibold leading-[1.12] whitespace-nowrap drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]" style={{ fontFamily: "'Playfair Display', 'Libre Baskerville', serif" }}>
                  Smart CRM for Law Firms
                </div>
                <div className="mt-2 text-[11px] md:text-sm font-medium tracking-[0.12em] uppercase text-white/95 leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">
                  Secure. Structured. Scalable.
                </div>
              </div>
            </div>

            {/* Login box */}
            <div className="w-full max-w-md flex flex-col items-center justify-center min-h-[500px] -mt-10 md:-mt-16 pt-0 pb-12 px-6 md:pt-2 md:px-0 md:-ml-20 relative z-20">
              {/* Glassy blurred white box container */}
              <div className="w-full p-6 md:p-9 bg-[rgba(20,20,20,0.30)] backdrop-blur-[16px] border border-[rgba(255,255,255,0.08)] shadow-[0_20px_60px_rgba(0,0,0,0.45)] rounded-2xl transition-transform duration-300 hover:scale-[1.02]">
                <div className="mb-5 text-center text-white">
                  <h2 className="text-xl font-semibold tracking-wide" style={{ fontFamily: "'Playfair Display', 'Libre Baskerville', serif" }}>
                    Sign In
                  </h2>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/75">
                    Secure Access to RMQ
                  </p>
                </div>
                <form className="w-full flex flex-col items-center gap-6" onSubmit={handleSignIn}>
                  <div className="w-full mt-0 md:mt-2">
                    <div className="relative">
                      <input
                        type="email"
                        className="peer input input-bordered w-full h-12 pl-10 bg-[rgba(255,255,255,0.14)] text-white placeholder-transparent border-[rgba(255,255,255,0.28)] rounded-[10px] shadow-none focus:border-[#d4af37] focus:shadow-[0_0_0_2px_rgba(212,175,55,0.2)] focus:bg-[rgba(255,255,255,0.18)] transition-all duration-200 focus:outline-none"
                        placeholder="Email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                        required
                        autoFocus
                      />
                      <AtSymbolIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-white/75" />
                      <label
                        className={`absolute left-9 px-1 pointer-events-none transition-all duration-200 drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)] ${
                          email
                            ? '-top-2 -translate-y-1/2 text-xs text-[#E5C07B]'
                            : 'top-1/2 -translate-y-1/2 text-sm text-white/70'
                        } peer-focus:-top-2 peer-focus:-translate-y-1/2 peer-focus:text-xs peer-focus:text-[#E5C07B]`}
                      >
                        Email
                      </label>
                    </div>
                  </div>
                  <div className="w-full">
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="peer input input-bordered w-full h-12 pr-11 pl-10 bg-[rgba(255,255,255,0.14)] text-white placeholder-transparent border-[rgba(255,255,255,0.28)] rounded-[10px] shadow-none focus:border-[#d4af37] focus:shadow-[0_0_0_2px_rgba(212,175,55,0.2)] focus:bg-[rgba(255,255,255,0.18)] transition-all duration-200 focus:outline-none"
                        placeholder="Password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                      />
                      <LockClosedIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-white/75" />
                      <label
                        className={`absolute left-9 px-1 pointer-events-none transition-all duration-200 drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)] ${
                          password
                            ? '-top-2 -translate-y-1/2 text-xs text-[#E5C07B]'
                            : 'top-1/2 -translate-y-1/2 text-sm text-white/70'
                        } peer-focus:-top-2 peer-focus:-translate-y-1/2 peer-focus:text-xs peer-focus:text-[#E5C07B]`}
                      >
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowPassword(prev => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/75 hover:text-white transition-colors"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="btn w-full h-12 text-base font-semibold border-0 rounded-[10px] bg-gradient-to-br from-[#d4af37] to-[#b8962e] text-[#111] shadow-[0_4px_20px_rgba(212,175,55,0.25)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(212,175,55,0.35)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={loading}
                  >
                    {loading ? <span className="loading loading-spinner loading-sm" /> : <LockClosedIcon className="w-5 h-5" />}
                    Sign in
                  </button>
                  <div className="w-full flex items-center justify-end text-xs text-white/85 -mt-1">
                    <button
                      type="button"
                      onClick={handleMagicLink}
                      disabled={magicLinkLoading || !email}
                      className="text-[#E5C07B] hover:text-[#f2d79d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {magicLinkLoading ? 'Sending…' : 'Forgot password?'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Success and Error Messages */}
              {success && (
                <div className="w-full mt-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0">
                        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="text-sm font-semibold text-green-800 mb-1">Magic Link Sent Successfully!</h4>
                            <p className="text-sm text-green-700 leading-relaxed">{success}</p>
                            <div className="mt-2 text-xs text-green-600">
                              <p>• Check your email inbox (and spam folder)</p>
                              <p>• Click the secure link to sign in automatically</p>
                              <p>• The link will expire in 1 hour for security</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setSuccess(null)}
                            className="ml-2 text-green-400 hover:text-green-600 transition-colors"
                            title="Dismiss message"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="w-full mt-4">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0">
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="text-sm font-semibold text-red-800 mb-1">Error Sending Magic Link</h4>
                            <p className="text-sm text-red-700 leading-relaxed">{error}</p>
                            <div className="mt-2 text-xs text-red-600">
                              <p>• Please check your email address is correct</p>
                              <p>• Try again in a few moments</p>
                              <p>• Contact support if the problem persists</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setError(null)}
                            className="ml-2 text-red-400 hover:text-red-600 transition-colors"
                            title="Dismiss message"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="lg:hidden w-full px-4 mt-2 mb-4 pointer-events-none relative z-20">
              <ClockInGateVideos placement="mobile" />
            </div>

            {/* Copyright at bottom left */}
            <div className="absolute left-0 right-0 bottom-0 z-20 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] flex justify-center w-full pointer-events-none">
              <span className="text-white/85 text-lg font-semibold text-center w-full">© Rainmaker Queen 2.0 {new Date().getFullYear()}</span>
            </div>
          </div>

          <div
            className="hidden lg:block fixed left-6 xl:left-8 top-1/2 -translate-y-1/2 z-20 w-[min(18rem,22vw)] max-h-[min(70vh,calc(100dvh-6rem))] pointer-events-none"
          >
            <ClockInGateVideos placement="desktop" />
          </div>
      </>
    </div>
  );
};

export default LoginPage; 