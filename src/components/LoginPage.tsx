import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AtSymbolIcon, ArrowRightOnRectangleIcon, CheckCircleIcon, Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { LockClosedIcon } from '@heroicons/react/24/outline';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string>('');
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
      // Try to fetch the user's name from the users table or auth metadata
      let name = email;
      if (data?.user?.email) {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('first_name, last_name, full_name')
          .eq('email', data.user.email)
          .single();
        
        if (!userError && userData) {
          // Use first_name + last_name if available, otherwise fall back to full_name
          if (userData.first_name && userData.last_name && userData.first_name.trim() && userData.last_name.trim()) {
            name = `${userData.first_name.trim()} ${userData.last_name.trim()}`;
          } else if (userData.full_name && userData.full_name.trim()) {
            name = userData.full_name.trim();
          }
        } else {
          // Fallback to auth user metadata
          if (data.user.user_metadata?.first_name || data.user.user_metadata?.full_name) {
            name = data.user.user_metadata.first_name || data.user.user_metadata.full_name;
          }
        }
      }
      setWelcomeName(name);
      setSuccess('Signed in! Redirecting...');
      setShowSuccessAnim(true);
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 2200); // Wait for the welcome animation to finish before navigating
    }
    setLoading(false);
  };

  const handleMagicLink = async () => {
    setLoading(true);
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
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex relative overflow-hidden">
      {/* Only render login UI if not showing welcome animation */}
      {!showSuccessAnim && (
        <>
          {/* Left: Login box */}
          <div className="w-full md:w-1/2 flex flex-col justify-center items-center min-h-screen relative z-10 bg-white">
      {/* Header bar - Mobile */}
      <div className="md:hidden absolute top-0 left-0 right-0 z-30 bg-gradient-to-r from-purple-600 via-purple-700 to-purple-800 shadow-lg border-b border-purple-500/20">
        <div className="flex items-center justify-between py-4 px-6">
          {/* Hamburger Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="text-white hover:text-purple-200 transition-colors duration-200"
          >
            {isMenuOpen ? (
              <XMarkIcon className="w-6 h-6" />
            ) : (
              <Bars3Icon className="w-6 h-6" />
            )}
          </button>
          
          {/* Centered Logo and Text */}
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 19h20M2 7l5.586 5.586a2 2 0 0 0 2.828 0L12 11l1.586 1.586a2 2 0 0 0 2.828 0L22 7l-3 12H5L2 7z"/>
              <circle cx="4" cy="4" r="2" fill="currentColor"/>
              <circle cx="12" cy="4" r="2" fill="currentColor"/>
              <circle cx="20" cy="4" r="2" fill="currentColor"/>
            </svg>
            <span className="text-lg font-bold text-white tracking-tight" style={{ letterSpacing: '-0.02em' }}>
              Rainmaker Queen 2.0
            </span>
          </div>
          
        </div>
        
        {/* Mobile Menu Overlay */}
        {isMenuOpen && (
          <div className="absolute top-full left-0 right-0 bg-white shadow-lg border-b border-gray-200 z-40">
            <div className="py-2">
              <button
                onClick={() => {
                  navigate('/about');
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-6 py-3 text-gray-700 hover:bg-purple-50 hover:text-purple-700 transition-colors duration-200"
              >
                About Us
              </button>
              <button
                onClick={() => {
                  navigate('/contact');
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-6 py-3 text-gray-700 hover:bg-purple-50 hover:text-purple-700 transition-colors duration-200"
              >
                Contact
              </button>
              <button
                onClick={() => {
                  navigate('/how-it-works');
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-6 py-3 text-gray-700 hover:bg-purple-50 hover:text-purple-700 transition-colors duration-200"
              >
                How It Works
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Desktop Header */}
      <div className="hidden md:block absolute top-0 left-0 right-0 z-30 bg-gradient-to-r from-purple-600 via-purple-700 to-purple-800 shadow-lg">
        <div className="flex items-center justify-between py-4 px-8">
          {/* Logo and Brand */}
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 19h20M2 7l5.586 5.586a2 2 0 0 0 2.828 0L12 11l1.586 1.586a2 2 0 0 0 2.828 0L22 7l-3 12H5L2 7z"/>
              <circle cx="4" cy="4" r="2" fill="currentColor"/>
              <circle cx="12" cy="4" r="2" fill="currentColor"/>
              <circle cx="20" cy="4" r="2" fill="currentColor"/>
            </svg>
            <span className="text-xl font-extrabold text-white tracking-tight" style={{ letterSpacing: '-0.03em' }}>
              Rainmaker Queen 2.0
            </span>
          </div>
          
          {/* Navigation Links */}
          <div className="flex items-center gap-8">
            <button
              onClick={() => navigate('/about')}
              className="text-white hover:text-purple-200 transition-colors duration-200 font-medium"
            >
              About Us
            </button>
            <button
              onClick={() => navigate('/contact')}
              className="text-white hover:text-purple-200 transition-colors duration-200 font-medium"
            >
              Contact
            </button>
            <button
              onClick={() => navigate('/how-it-works')}
              className="text-white hover:text-purple-200 transition-colors duration-200 font-medium"
            >
              How It Works
            </button>
          </div>
        </div>
      </div>
            {/* Login box */}
            <div className="w-full max-w-md flex flex-col items-center justify-center min-h-[500px] py-12 px-6 md:px-0 mt-16 md:mt-20">
            <form className="w-full flex flex-col items-start gap-6" onSubmit={handleSignIn}>
              <div>
                  <h2 className="text-3xl font-extrabold mb-2 text-primary text-left w-full">
                  Welcome to RMQ 2.0
                </h2>
                  <p className="text-base text-gray-700 mb-6 text-left w-full">Please sign in.</p>
              </div>
              <div className="w-full mt-2">
                  <label className="block font-semibold mb-1 text-gray-800">Email</label>
                <div className="relative">
                  <input
                    type="email"
                      className="input input-bordered w-full pl-10 bg-white text-gray-900 placeholder-gray-400 border-gray-300 focus:border-primary"
                    placeholder="you@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                    <AtSymbolIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
              </div>
              <div className="w-full">
                  <label className="block font-semibold mb-1 text-gray-800">Password</label>
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
                    disabled={loading || !email}
                >
                  {loading ? (
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
                              <div className="text-xs text-gray-400">Look for email from Leadify CRM (check spam folder)</div>
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
              <div className="w-full max-w-md mt-4">
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
              <div className="w-full max-w-md mt-4">
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
          {/* Right: Image background */}
          <div className="hidden md:block md:w-1/2 h-full min-h-screen fixed right-0 top-0 z-0">
            <img src="/DATA_IMAGE.jpg" alt="Leadify Illustration" className="w-full h-full object-cover" style={{ objectFit: 'cover', objectPosition: 'center', minHeight: '100vh', minWidth: '50vw' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
        </div>
        </>
      )}
      
      
      {/* Success animation overlay */}
      {showSuccessAnim && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center w-full h-full">
          {/* Animated gradient background */}
          <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-blue-600 via-purple-800 to-purple-900 animate-gradient z-0" />
          {/* Welcome message and icon */}
          <div className="relative z-10 flex flex-col items-center justify-center w-full h-full">
          <CheckCircleIcon className="w-24 h-24 text-green-400 checkmark-pop mb-4" />
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