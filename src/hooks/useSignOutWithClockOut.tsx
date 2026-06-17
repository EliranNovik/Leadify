import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';
import { fetchClockInGateProfile, fetchIsEmployeeClockedIn } from '../lib/employeeClockInGate';
import {
  clockOutEmployeeRecord,
  fetchActiveClockInRecord,
  type ActiveClockInRecord,
} from '../lib/employeeClockOut';
import SignOutClockOutModal from '../components/SignOutClockOutModal';

type PendingSignOut = {
  record: ActiveClockInRecord;
};

type UseSignOutWithClockOutOptions = {
  redirectOnSignOut?: boolean;
  redirectTo?: string;
};

export function useSignOutWithClockOut(options: UseSignOutWithClockOutOptions = {}) {
  const { redirectOnSignOut = true, redirectTo = '/login' } = options;
  const { user } = useAuthContext();
  const [pending, setPending] = useState<PendingSignOut | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const performSignOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out');
      return false;
    }

    toast.success('Signed out successfully');
    if (redirectOnSignOut) {
      window.location.href = redirectTo;
    }
    return true;
  }, [redirectOnSignOut, redirectTo]);

  const requestSignOut = useCallback(async () => {
    if (!user?.id) {
      await performSignOut();
      return;
    }

    try {
      const profile = await fetchClockInGateProfile(user.id);
      if (profile.isExternalUser || profile.employeeId == null) {
        await performSignOut();
        return;
      }

      const isClockedIn = await fetchIsEmployeeClockedIn(profile.employeeId);
      if (!isClockedIn) {
        await performSignOut();
        return;
      }

      const record = await fetchActiveClockInRecord(profile.employeeId);
      if (!record) {
        await performSignOut();
        return;
      }

      setPending({ record });
    } catch (error) {
      console.error('Sign-out clock-in check failed:', error);
      await performSignOut();
    }
  }, [user?.id, performSignOut]);

  const handleClockOutAndSignOut = useCallback(async () => {
    if (!pending) return;

    setIsProcessing(true);
    try {
      await clockOutEmployeeRecord(pending.record);
      setPending(null);
      await performSignOut();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to clock out';
      toast.error(message);
    } finally {
      setIsProcessing(false);
    }
  }, [pending, performSignOut]);

  const handleSignOutOnly = useCallback(async () => {
    setPending(null);
    setIsProcessing(true);
    try {
      await performSignOut();
    } finally {
      setIsProcessing(false);
    }
  }, [performSignOut]);

  const signOutModal = pending
    ? createPortal(
        <SignOutClockOutModal
          isOpen
          clockInTime={pending.record.clock_in_time}
          isProcessing={isProcessing}
          onClockOutAndSignOut={() => void handleClockOutAndSignOut()}
          onSignOutOnly={() => void handleSignOutOnly()}
          onCancel={() => {
            if (!isProcessing) setPending(null);
          }}
        />,
        document.body,
      )
    : null;

  return { requestSignOut, signOutModal, isSignOutModalOpen: pending != null };
}
