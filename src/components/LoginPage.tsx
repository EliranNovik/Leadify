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
    <div className={`min-h-screen flex relative overflow-hidden ${showSuccessAnim ? 'bg-gradient-to-br from-blue-600 via-purple-800 to-purple-900 animated-gradient' : 'bg-white'}`}>
      {/* Logo at top left, tighter to corner */}
      <div className="absolute top-0 left-0 p-4 z-20">
        <img src="/Leadify12.png" alt="Leadify Logo" className="h-40 w-auto" />
      </div>
      {/* Left: Login Form Content (no card) */}
      <div className="flex-1 flex items-center justify-center z-10">
        <form className={`w-full max-w-lg flex flex-col items-start gap-6 px-8 py-12 ${showSuccessAnim ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} onSubmit={handleSignIn}>
          <div>
            <h1 className="text-4xl font-bold mb-4 text-primary">Welcome to Leadify</h1>
            <p className="text-black font-medium mb-4">
              Please sign in to access the Leadify CRM.
            </p>
          </div>
          <div className="w-full mt-2">
            <label className="block font-semibold mb-1 text-black">Email</label>
            <div className="relative">
              <input
                type="email"
                className="input input-bordered w-full pl-10 bg-white text-black placeholder-gray-500 border-gray-300 focus:border-primary"
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
            <label className="block font-semibold mb-1 text-black">Password</label>
            <input
              type="password"
              className="input input-bordered w-full bg-white text-black placeholder-gray-500 border-gray-300 focus:border-primary"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary w-full mb-2 flex items-center justify-center gap-2 text-lg font-semibold"
            disabled={loading}
          >
            {loading ? <span className="loading loading-spinner loading-sm" /> : <LockClosedIcon className="w-5 h-5" />}
            Sign in
          </button>
          <button
            type="button"
            className="btn btn-outline w-full"
            onClick={handleMagicLink}
            disabled={loading || !email}
          >
            Send Magic Link
          </button>
        </form>
      </div>
      {/* Right: Large Image (hidden on mobile) */}
      {!showSuccessAnim && (
        <div className="hidden md:flex w-1/2 h-full flex-col items-center justify-center p-8">
          <img src="/DATA_IMAGE.jpg" alt="Leadify Illustration" className="w-full h-[90vh] object-cover rounded-3xl mx-auto my-auto" onError={e => { e.currentTarget.style.display = 'none'; }} />
          <div className="w-full flex justify-center mt-6">
            <span className="text-primary text-lg font-semibold text-center drop-shadow-lg">© Leadify CRM {new Date().getFullYear()}</span>
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
      {/* Copyright Notice (mobile only) */}
      <div className="md:hidden absolute left-0 right-0 flex justify-center" style={{ bottom: '5vh' }}>
        <span className="text-primary text-lg font-semibold text-center drop-shadow-lg">© Leadify CRM {new Date().getFullYear()}</span>
      </div>
    </div>
  );
};

export default LoginPage; 