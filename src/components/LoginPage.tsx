import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AtSymbolIcon, ArrowRightOnRectangleIcon, CheckCircleIcon, Bars3Icon, XMarkIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { preCheckExternalUser } from '../hooks/useExternalUser';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string>('');
  const [welcomeImage, setWelcomeImage] = useState<string>('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else {
      // Try to fetch the user's official_name from the tenants_employee table using JOIN
      let name = email;
      let imageUrl = '';

      if (data?.user?.email) {
        // Fetch user with joined employee (image, name) via users.employee_id -> tenants_employee.id
        let userData: { first_name?: string; last_name?: string; full_name?: string; employee_id?: number; tenants_employee?: any } | null = null;
        let userError: Error | null = null;

        const { data: withJoin, error: joinErr } = await supabase
          .from('users')
          .select(`
            first_name,
            last_name,
            full_name,
            employee_id,
            tenants_employee!users_employee_id_fkey(
              official_name,
              display_name,
              photo,
              photo_url
            )
          `)
          .eq('email', data.user.email)
          .single();

        if (!joinErr && withJoin) {
          userData = withJoin;
        } else {
          userError = joinErr ?? null;
          // Fallback: fetch without join if FK missing or join fails
          const { data: fallbackData, error: fallbackErr } = await supabase
            .from('users')
            .select('first_name, last_name, full_name, employee_id')
            .eq('email', data.user.email)
            .single();
          if (!fallbackErr && fallbackData) {
            userData = fallbackData;
          } else {
            userError = fallbackErr ?? userError;
          }
        }

        console.log('Login - User data fetched:', userData);
        if (userError) console.log('Login - User error:', userError);

        if (!userError && userData) {
          const empData = userData.tenants_employee
            ? (Array.isArray(userData.tenants_employee) ? userData.tenants_employee[0] : userData.tenants_employee)
            : null;

          console.log('Login - Employee data (from join):', empData);

          if (empData) {
            imageUrl = (empData.photo_url && String(empData.photo_url).trim()) || (empData.photo && String(empData.photo).trim()) || '';
          }

          // Priority: official_name > display_name > first_name + last_name > full_name
          if (empData?.official_name && empData.official_name.trim()) {
            name = empData.official_name.trim();
            console.log('Login - Using official_name:', name);
          } else if (empData?.display_name && empData.display_name.trim()) {
            name = empData.display_name.trim();
            console.log('Login - Using display_name:', name);
          } else if (userData.first_name && userData.last_name && userData.first_name.trim() && userData.last_name.trim()) {
            name = `${userData.first_name.trim()} ${userData.last_name.trim()}`;
            console.log('Login - Using first_name + last_name:', name);
          } else if (userData.full_name && userData.full_name.trim()) {
            name = userData.full_name.trim();
            console.log('Login - Using full_name:', name);
          } else {
            console.log('Login - No name found, using email:', name);
          }
        } else {
          console.log('Login - User error or no data, error:', userError);
          // Fallback to auth user metadata
          if (data.user.user_metadata?.first_name || data.user.user_metadata?.full_name) {
            name = data.user.user_metadata.first_name || data.user.user_metadata.full_name;
          }
        }
      }
      setWelcomeName(name);
      setWelcomeImage(imageUrl);
      setSuccess('Signed in! Redirecting...');
      setShowSuccessAnim(true);

      // Save to session storage that user is signed in - this allows Dashboard to load immediately
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('user_signed_in', 'true');
        sessionStorage.setItem('user_signed_in_timestamp', Date.now().toString());
      }

      // Pre-check external user status in the background during the delay
      // This runs during the 1 second login screen delay, so the check is ready when dashboard loads
      if (data?.user?.id) {
        preCheckExternalUser(data.user.id).catch(err => {
          console.error('Error pre-checking external user:', err);
        });
      }

      // Navigate after showing welcome message for a bit longer
      // The welcome animation will show for 2.5 seconds
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 2500); // Show welcome message for 2.5 seconds
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
    <div className="min-h-screen w-full flex relative overflow-hidden">
      {/* Full-page video background */}
      <video
        className="absolute inset-0 w-full h-full object-cover z-0"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      >
        <source src="/login-hero.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 w-full h-full bg-gradient-to-b from-[rgba(10,10,10,0.38)] to-[rgba(10,10,10,0.58)] z-0" />
      <div className="absolute inset-0 w-full h-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),transparent_60%)] z-0" />

      {/* Only render login UI if not showing welcome animation */}
      {!showSuccessAnim && (
        <>
          {/* Full width login box */}
          <div className="w-full flex flex-col justify-start items-center min-h-screen relative z-10 pt-16 md:pt-20">
            {/* Header bar - Mobile */}
            <div className="md:hidden absolute top-0 left-0 right-0 z-30">
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
              <div className="hidden md:flex absolute left-10 bottom-12 z-10 flex-col gap-2 text-white/95 text-[15px] px-4 py-3 drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]">
                <div className="flex items-center gap-2"><span className="text-[#d4af37]">✔</span><span>Case tracking</span></div>
                <div className="flex items-center gap-2"><span className="text-[#d4af37]">✔</span><span>Client management</span></div>
                <div className="flex items-center gap-2"><span className="text-[#d4af37]">✔</span><span>Automated workflows</span></div>
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
                        className="peer input input-bordered w-full h-12 pl-10 bg-[rgba(255,255,255,0.06)] text-white placeholder-transparent border-[rgba(255,255,255,0.18)] rounded-[10px] shadow-none focus:border-[#d4af37] focus:shadow-[0_0_0_2px_rgba(212,175,55,0.2)] focus:bg-[rgba(255,255,255,0.10)] transition-all duration-200 focus:outline-none"
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
                        className="peer input input-bordered w-full h-12 pr-11 pl-10 bg-[rgba(255,255,255,0.06)] text-white placeholder-transparent border-[rgba(255,255,255,0.18)] rounded-[10px] shadow-none focus:border-[#d4af37] focus:shadow-[0_0_0_2px_rgba(212,175,55,0.2)] focus:bg-[rgba(255,255,255,0.10)] transition-all duration-200 focus:outline-none"
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
            {/* Copyright at bottom left */}
            <div className="absolute left-0 right-0 bottom-0 z-20 pb-6 flex justify-center w-full">
              <span className="text-white/85 text-lg font-semibold text-center w-full">© Rainmaker Queen 2.0 {new Date().getFullYear()}</span>
            </div>
          </div>
        </>
      )}


      {/* Success animation overlay */}
      {showSuccessAnim && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center w-full h-full">
          {/* Animated gradient background */}
          <div className="absolute inset-0 w-full h-full bg-white md:bg-gradient-to-br md:from-[#0b1e3d] md:via-[#0f4c75] md:to-[#06b6d4] md:animate-gradient z-0" />
          {/* Welcome message and icon */}
          <div className="relative z-10 flex flex-col items-center justify-center w-full h-full gap-6 -mt-16">
            {/* Welcome text above */}
            <div className="flex flex-col items-center gap-2 slide-fade-in">
              <div className="text-4xl font-bold text-gray-900 md:text-white">
                Welcome to RMQ 2.0.
              </div>
            </div>

            {/* Employee Image or Success Icon */}
            {welcomeImage ? (
              <div className="checkmark-pop">
                <div className="relative">
                  <img
                    src={welcomeImage}
                    alt={welcomeName}
                    className="w-32 h-32 rounded-full object-cover border-4 border-green-400 shadow-2xl"
                    onError={(e) => {
                      // If image fails to load, hide it and show the checkmark icon instead
                      e.currentTarget.style.display = 'none';
                      const checkIcon = document.createElement('div');
                      checkIcon.innerHTML = '<svg class="w-24 h-24 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
                      e.currentTarget.parentNode?.appendChild(checkIcon);
                    }}
                  />
                  <CheckCircleIcon className="w-10 h-10 text-green-400 absolute bottom-0 right-0 bg-white rounded-full" />
                </div>
              </div>
            ) : (
              <CheckCircleIcon className="w-24 h-24 text-green-400 checkmark-pop" />
            )}
            <div className="text-3xl font-bold text-gray-900 md:text-white slide-fade-in">
              Welcome, {welcomeName}!
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginPage; 