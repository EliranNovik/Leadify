import React, { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import type { AccountInfo } from '@azure/msal-browser';
import toast from 'react-hot-toast';
import { loginRequest } from '../../msalConfig';

/** Header-equivalent Microsoft sign-in control; hidden when already signed in. */
const MicrosoftSignInBox: React.FC = () => {
  const { instance } = useMsal();
  const [userAccount, setUserAccount] = useState<AccountInfo | null>(null);
  const [isMsalInitialized, setIsMsalInitialized] = useState(false);
  const [isMsalLoading, setIsMsalLoading] = useState(false);

  useEffect(() => {
    if (!instance) return;
    try {
      const accounts = instance.getAllAccounts();
      setUserAccount(accounts[0] || null);
      setIsMsalInitialized(true);
    } catch (error) {
      console.error('Failed to initialize MSAL sign-in box:', error);
    }
  }, [instance]);

  useEffect(() => {
    const syncAccount = () => {
      if (!instance) return;
      const accounts = instance.getAllAccounts();
      setUserAccount(accounts[0] || null);
    };
    window.addEventListener('msal:signInSuccess', syncAccount);
    window.addEventListener('msal:signInFailure', syncAccount);
    return () => {
      window.removeEventListener('msal:signInSuccess', syncAccount);
      window.removeEventListener('msal:signInFailure', syncAccount);
    };
  }, [instance]);

  const handleMicrosoftSignIn = async () => {
    if (!instance || !isMsalInitialized) {
      toast.error('Sign-in is not ready yet. Please try again in a moment.');
      return;
    }
    if (userAccount) return;

    setIsMsalLoading(true);
    window.dispatchEvent(new CustomEvent('msal:signInStart'));

    try {
      const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
      if (isMobile) {
        await instance.loginRedirect(loginRequest);
      } else {
        await instance.loginPopup(loginRequest);
        const account = instance.getAllAccounts()[0] || null;
        setUserAccount(account);
        window.dispatchEvent(new CustomEvent('msal:signInSuccess'));
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent('msal:signInFailure'));
      if (error instanceof Error && error.message.includes('interaction_in_progress')) {
        return;
      }
    } finally {
      setIsMsalLoading(false);
    }
  };

  if (userAccount) return null;

  return (
    <button
      type="button"
      onClick={() => void handleMicrosoftSignIn()}
      disabled={isMsalLoading || !isMsalInitialized}
      className="inline-flex items-center gap-2 rounded-full bg-[#3b28c7] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3221ad] disabled:opacity-60"
    >
      {isMsalLoading ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"
          />
        </svg>
      )}
      Sign in to Microsoft
    </button>
  );
};

export default MicrosoftSignInBox;
