import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AtSymbolIcon, ArrowRightOnRectangleIcon, CheckCircleIcon, Bars3Icon, XMarkIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
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
  const [showHelpModal, setShowHelpModal] = useState(false);
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
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) setError(error.message);
    else setSuccess('Check your email for the magic link!');
    setLoading(false);
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
          
          {/* Help Button */}
          <button
            onClick={() => setShowHelpModal(true)}
            className="text-white hover:text-purple-200 transition-colors duration-200"
          >
            <QuestionMarkCircleIcon className="w-6 h-6" />
          </button>
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
              <button
                type="button"
                  className="btn btn-outline border-primary text-primary hover:bg-primary/10 w-full text-lg font-semibold shadow-lg hover:scale-105 transition-transform"
                onClick={handleMagicLink}
                disabled={loading || !email}
              >
                Send Magic Link
              </button>
            </form>
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
      
      {/* Help Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-800">Magic Link Help</h3>
              <button
                onClick={() => setShowHelpModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">What is a Magic Link?</h4>
                <p className="text-gray-600 text-sm leading-relaxed">
                  A Magic Link is a secure, passwordless way to sign in. Instead of remembering a password, 
                  you'll receive a special link via email that automatically logs you into your account.
                </p>
              </div>
              
              <div>
                <h4 className="font-semibold text-gray-800 mb-2">How it works:</h4>
                <ol className="text-gray-600 text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</span>
                    <span>Enter your email address in the field above</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</span>
                    <span>Click "Send Magic Link" button</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</span>
                    <span>Check your email for a secure login link</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">4</span>
                    <span>Click the link in your email to automatically sign in</span>
                  </li>
                </ol>
              </div>
              

            </div>
            
            <button
              onClick={() => setShowHelpModal(false)}
              className="w-full mt-6 bg-primary text-white font-semibold py-3 px-4 rounded-lg hover:scale-105 transition-transform"
            >
              Got it!
            </button>
          </div>
        </div>
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