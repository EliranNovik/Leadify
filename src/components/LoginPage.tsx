import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AtSymbolIcon, ArrowRightOnRectangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 via-purple-800 to-purple-900 animated-gradient relative overflow-hidden">
      <div className="flex flex-col md:flex-row items-center justify-start w-full max-w-7xl mx-auto relative z-10">
        {/* Login Box */}
        <form className={`bg-white/60 backdrop-blur-md shadow-2xl rounded-2xl p-12 max-w-3xl w-full flex flex-col items-center z-10 relative transition-opacity duration-200 ${showSuccessAnim ? 'opacity-0 pointer-events-none' : 'opacity-100'} md:ml-[-80px] md:mr-16`} style={{ boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)' }} onSubmit={handleSignIn}>
          <div className="w-full flex flex-col items-center pt-0 pb-3">
            <img src="/Leadify12.png" alt="Leadify Logo" className="h-37 mb-3" />
            <h1 className="text-4xl font-bold mb-1 text-primary">Welcome to Leadify</h1>
            <p className="text-center text-black font-medium mt-1">
              Please sign in to access the Leadify CRM.
            </p>
          </div>
          <div className="w-full mb-4">
            <label className="block font-semibold mb-1 text-black">Email</label>
            <div className="relative">
              <input
                type="email"
                className="input input-bordered w-full pl-10 bg-white/60 text-black placeholder-gray-500 border-gray-300 focus:border-primary focus:bg-white/80"
                placeholder="you@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
              <AtSymbolIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </div>
          <div className="w-full mb-4">
            <label className="block font-semibold mb-1 text-black">Password</label>
            <input
              type="password"
              className="input input-bordered w-full bg-white/60 text-black placeholder-gray-500 border-gray-300 focus:border-primary focus:bg-white/80"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="alert alert-error w-full mb-2">{error}</div>}
          {success && <div className="alert alert-success w-full mb-2">{success}</div>}
          <button
            className="btn btn-primary btn-lg w-full flex items-center gap-3 mb-2"
            type="submit"
            disabled={loading}
          >
            <ArrowRightOnRectangleIcon className="w-6 h-6" />
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <button
            className="btn btn-outline w-full"
            type="button"
            onClick={handleMagicLink}
            disabled={loading || !email}
          >
            Send Magic Link
          </button>
        </form>
        {/* Side Image (hidden on mobile, only show if not logged in) */}
        {!showSuccessAnim && (
          <div className="hidden md:flex flex-1 justify-center items-center">
            <img src="src/public/DATA_IMAGE.jpg" alt="Leadify Visual" className="max-h-[700px] max-w-[800px] rounded-2xl shadow-2xl object-contain" />
          </div>
        )}
      </div>
      {/* Animated blurred shapes */}
      <div className="absolute w-96 h-96 bg-purple-800 opacity-30 rounded-full blur-3xl top-10 left-10 animate-move1" />
      <div className="absolute w-80 h-80 bg-blue-900 opacity-20 rounded-full blur-2xl bottom-10 right-10 animate-move2" />
      {/* Success animation overlay */}
      {showSuccessAnim && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/30 fade-in">
          <CheckCircleIcon className="w-24 h-24 text-green-400 checkmark-pop mb-4" />
          <div className="text-3xl font-bold text-white slide-fade-in">Welcome, {welcomeName}!</div>
        </div>
      )}
      {/* Copyright Notice */}
      <div className="absolute left-0 right-0 flex justify-center" style={{ bottom: '5vh' }}>
        <span className="text-white text-lg font-semibold text-center drop-shadow-lg">© Leadify CRM {new Date().getFullYear()}</span>
      </div>
    </div>
  );
};

export default LoginPage; 