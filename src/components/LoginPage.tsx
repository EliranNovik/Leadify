import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AtSymbolIcon, ArrowRightOnRectangleIcon, CheckCircleIcon, Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { LockClosedIcon } from '@heroicons/react/24/outline';

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
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select(`
            first_name, 
            last_name, 
            full_name,
            employee_id,
            tenants_employee!users_employee_id_fkey(
              official_name,
              display_name,
              photo_url
            )
          `)
          .eq('email', data.user.email)
          .single();
        
        console.log('Login - User data fetched:', userData);
        console.log('Login - User error:', userError);
        
        if (!userError && userData) {
          // Handle both array and single object responses
          const empData = userData.tenants_employee ? 
            (Array.isArray(userData.tenants_employee) ? userData.tenants_employee[0] : userData.tenants_employee) : 
            null;
          
          console.log('Login - Employee data:', empData);
          
          // Set profile image if available
          if (empData?.photo_url) {
            imageUrl = empData.photo_url;
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
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 2200); // Wait for the welcome animation to finish before navigating
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
      {/* Only render login UI if not showing welcome animation */}
      {!showSuccessAnim && (
        <>
          {/* Full width login box */}
          <div className="w-full flex flex-col justify-start items-center min-h-screen relative z-10 bg-white pt-48">
      {/* Header bar - Mobile */}
      <div className="md:hidden absolute top-0 left-0 right-0 z-30" style={{ backgroundColor: '#3B18BC' }}>
        <div className="flex items-center justify-between py-4 px-6">
          {/* Hamburger Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="text-white hover:text-gray-200 transition-colors duration-200"
          >
            {isMenuOpen ? (
              <XMarkIcon className="w-6 h-6" />
            ) : (
              <Bars3Icon className="w-6 h-6" />
            )}
          </button>
          
          {/* Centered Text */}
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-white tracking-tight" style={{ letterSpacing: '-0.02em' }}>
              RMQ 2.0
            </span>
          </div>
          
        </div>
        
        {/* Mobile Menu Overlay */}
        {isMenuOpen && (
          <div className="absolute top-full left-0 right-0 shadow-lg z-40" style={{ backgroundColor: '#3B18BC' }}>
            <div className="py-2">
              <button
                onClick={() => {
                  navigate('/about');
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-6 py-3 text-white hover:bg-purple-800 transition-colors duration-200"
              >
                About Us
              </button>
              <button
                onClick={() => {
                  navigate('/contact');
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-6 py-3 text-white hover:bg-purple-800 transition-colors duration-200"
              >
                Contact
              </button>
              <button
                onClick={() => {
                  navigate('/how-it-works');
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-6 py-3 text-white hover:bg-purple-800 transition-colors duration-200"
              >
                How It Works
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Desktop Header */}
      <div className="hidden md:block absolute top-0 left-0 right-0 z-30" style={{ backgroundColor: '#3B18BC' }}>
        <div className="flex items-center justify-between py-4 px-8">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="text-xl font-extrabold text-white tracking-tight" style={{ letterSpacing: '-0.03em' }}>
              RMQ 2.0
            </span>
          </div>
          
          {/* Navigation Links */}
          <div className="flex items-center gap-8">
            <button
              onClick={() => navigate('/about')}
              className="text-white hover:text-gray-200 transition-colors duration-200 font-medium"
            >
              About Us
            </button>
            <button
              onClick={() => navigate('/contact')}
              className="text-white hover:text-gray-200 transition-colors duration-200 font-medium"
            >
              Contact
            </button>
            <button
              onClick={() => navigate('/how-it-works')}
              className="text-white hover:text-gray-200 transition-colors duration-200 font-medium"
            >
              How It Works
            </button>
          </div>
        </div>
      </div>
            {/* Logo above login form */}
            <div className="mb-0 md:mb-1 flex flex-col items-center">
              <img src="/rmq-logo.png" alt="RMQ 2.0" className="w-64 h-64 md:w-72 md:h-72 object-contain" />
            </div>
            
            {/* Login box */}
            <div className="w-full max-w-md flex flex-col items-center justify-center min-h-[500px] pt-0 pb-12 px-6 md:pt-2 md:px-0">
            <form className="w-full flex flex-col items-center gap-6" onSubmit={handleSignIn}>
              <div className="w-full mt-0 md:mt-2">
                  <label className="block font-semibold mb-1 text-gray-800 text-left">Email</label>
                <div className="relative">
                  <input
                    type="email"
                      className="input input-bordered w-full pl-10 bg-white text-gray-900 placeholder-gray-400 border-gray-300 focus:border-primary"
                    placeholder="you@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    required
                    autoFocus
                  />
                    <AtSymbolIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
              </div>
              <div className="w-full">
                  <label className="block font-semibold mb-1 text-gray-800 text-left">Password</label>
                <input
                  type="password"
                    className="input input-bordered w-full bg-white text-gray-900 placeholder-gray-400 border-gray-300 focus:border-primary"
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                  className="btn bg-primary text-white border-none w-full text-lg font-semibold shadow-lg hover:scale-105 transition-transform"
                disabled={loading}
              >
                {loading ? <span className="loading loading-spinner loading-sm" /> : <LockClosedIcon className="w-5 h-5" />}
                Sign in
              </button>
              <div className="relative group w-full">
                <button
                  type="button"
                    className="btn btn-outline border-primary text-primary hover:bg-primary/10 w-full text-lg font-semibold shadow-lg hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleMagicLink}
                    disabled={magicLinkLoading || !email}
                >
                  {magicLinkLoading ? (
                    <>
                      <span className="loading loading-spinner loading-sm mr-2"></span>
                      Sending Magic Link...
                    </>
                  ) : (
                    'Trouble signing in? Get a Magic Link'
                  )}
                </button>
                
                {/* Desktop hover tooltip */}
                <div className="hidden md:block absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-6 py-5 bg-gray-900 text-white text-sm rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-50 max-w-md">
                  <div className="text-left">
                    <div className="font-bold mb-3 text-lg flex items-center gap-2">
                      <span className="text-2xl">🔗</span>
                      Magic Link Authentication
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <div className="font-semibold text-gray-100 mb-2">What is a Magic Link?</div>
                        <p className="text-xs text-gray-300 leading-relaxed">
                          A secure, passwordless way to sign in. Instead of remembering passwords, 
                          you'll receive a time-limited link via email that automatically logs you in with one click.
                        </p>
                      </div>
                      
                      <div>
                        <div className="font-semibold text-gray-100 mb-2">How it works:</div>
                        <div className="space-y-2">
                          <div className="flex items-start gap-3">
                            <span className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</span>
                            <div>
                              <div className="text-xs font-medium">Enter your email address above</div>
                              <div className="text-xs text-gray-400">Use the same email associated with your account</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-3">
                            <span className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</span>
                            <div>
                              <div className="text-xs font-medium">Click "Get a Magic Link" button</div>
                              <div className="text-xs text-gray-400">We'll send a secure link instantly</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-3">
                            <span className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</span>
                            <div>
                              <div className="text-xs font-medium">Check your email inbox</div>
                              <div className="text-xs text-gray-400">Look for email from RMQ 2.0 (check spam folder)</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-3">
                            <span className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">4</span>
                            <div>
                              <div className="text-xs font-medium">Click the secure link in the email</div>
                              <div className="text-xs text-gray-400">You'll be automatically logged in and redirected</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Arrow pointing down */}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                </div>
              </div>
            </form>
            
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
              <span className="text-gray-500 text-lg font-semibold drop-shadow-lg text-center w-full">© Rainmaker Queen 2.0 {new Date().getFullYear()}</span>
            </div>
          </div>
        </>
      )}
      
      
      {/* Success animation overlay */}
      {showSuccessAnim && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center w-full h-full">
          {/* Animated gradient background */}
          <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-[#0b1e3d] via-[#0f4c75] to-[#06b6d4] animate-gradient z-0" />
          {/* Welcome message and icon */}
          <div className="relative z-10 flex flex-col items-center justify-center w-full h-full gap-6">
            {/* Welcome text above */}
            <div className="flex flex-col items-center gap-2 slide-fade-in">
              <div className="text-4xl font-bold text-white">
                Welcome to RMQ 2.0.
              </div>
              <div className="text-xl text-white/90 font-medium">
                Enjoy the future today.
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
            <div className="text-3xl font-bold text-white slide-fade-in">
              Welcome, {welcomeName}!
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginPage; 