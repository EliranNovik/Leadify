import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AtSymbolIcon, ArrowRightOnRectangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { LockClosedIcon } from '@heroicons/react/24/outline';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string>('');
  const navigate = useNavigate();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else {
      // Try to fetch the user's full name from the users table
      let name = email;
      if (data?.user?.email) {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', data.user.email)
          .single();
        if (!userError && userData?.full_name) {
          name = userData.full_name;
        }
      }
      setWelcomeName(name);
      setSuccess('Signed in! Redirecting...');
      setShowSuccessAnim(true);
      setTimeout(() => {
        setShowSuccessAnim(false);
        navigate('/', { replace: true });
      }, 1600);
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
    <div className={`min-h-screen w-full flex items-center justify-center relative overflow-hidden ${showSuccessAnim ? 'bg-gradient-to-br from-blue-600 via-purple-800 to-purple-900 animated-gradient' : ''}`}>
      {/* Full background image */}
      {!showSuccessAnim && (
        <img src="/DATA_IMAGE.jpg" alt="Leadify Illustration" className="absolute inset-0 w-full h-full object-cover z-0" style={{ objectFit: 'cover', objectPosition: 'center', minHeight: '100vh', minWidth: '100vw' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
      )}
      {/* Logo at the top left */}
      <div className="absolute top-0 left-0 z-30 flex items-center gap-3 pt-4 pl-6">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10" viewBox="0 0 24 24" fill="white">
          <path d="M2 19h20M2 7l5.586 5.586a2 2 0 0 0 2.828 0L12 11l1.586 1.586a2 2 0 0 0 2.828 0L22 7l-3 12H5L2 7z"/>
          <circle cx="4" cy="4" r="2" fill="white"/>
          <circle cx="12" cy="4" r="2" fill="white"/>
          <circle cx="20" cy="4" r="2" fill="white"/>
        </svg>
        <span className="text-3xl font-extrabold text-white tracking-tight" style={{ letterSpacing: '-0.03em' }}>
          Rainmaker Queen 2.0
        </span>
      </div>
      {/* Glassy login box (only show when not in welcome animation) */}
      {!showSuccessAnim && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="backdrop-blur-xl bg-black/40 border border-white/20 rounded-3xl shadow-2xl p-10 w-full max-w-md flex flex-col items-center" style={{ boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)' }}>
            <form className="w-full flex flex-col items-start gap-6" onSubmit={handleSignIn}>
              <div>
                <h2 className="text-3xl font-extrabold mb-2 text-white text-center w-full" style={{ letterSpacing: '-0.03em' }}>
                  Welcome to RMQ 2.0
                </h2>
                <p className="text-base text-white mb-6 text-center w-full">Please sign in.</p>
              </div>
              <div className="w-full mt-2">
                <label className="block font-semibold mb-1 text-white">Email</label>
                <div className="relative">
                  <input
                    type="email"
                    className="input input-bordered w-full pl-10 bg-white/20 text-white placeholder-white/60 border-white/30 focus:border-primary"
                    placeholder="you@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                  <AtSymbolIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-white/60" />
                </div>
              </div>
              <div className="w-full">
                <label className="block font-semibold mb-1 text-white">Password</label>
                <input
                  type="password"
                  className="input input-bordered w-full bg-white/20 text-white placeholder-white/60 border-white/30 focus:border-primary"
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn bg-white/20 hover:bg-white/30 text-white border-white/30 w-full text-lg font-semibold shadow-lg hover:scale-105 transition-transform"
                disabled={loading}
              >
                {loading ? <span className="loading loading-spinner loading-sm" /> : <LockClosedIcon className="w-5 h-5" />}
                Sign in
              </button>
              <button
                type="button"
                className="btn btn-outline border-white/30 text-white hover:bg-white/20 w-full text-lg font-semibold shadow-lg hover:scale-105 transition-transform"
                onClick={handleMagicLink}
                disabled={loading || !email}
              >
                Send Magic Link
              </button>
            </form>
          </div>
        </div>
      )}
      {/* Success animation overlay */}
      {showSuccessAnim && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/30 fade-in">
          <CheckCircleIcon className="w-24 h-24 text-green-400 checkmark-pop mb-4" />
          <div className="text-3xl font-bold text-white slide-fade-in">Welcome, {welcomeName}!</div>
        </div>
      )}
      {/* Copyright at bottom left */}
      <div className="absolute left-0 bottom-0 z-20 pb-6 pl-6">
        <span className="text-white text-lg font-semibold drop-shadow-lg">© Rainmaker Queen 2.0 {new Date().getFullYear()}</span>
      </div>
    </div>
  );
};

export default LoginPage; 