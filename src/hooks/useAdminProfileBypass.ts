import { useCallback, useEffect, useState } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import {
  ADMIN_PROFILE_BYPASS_CHANGED_EVENT,
  buildSelfAdminBypass,
  buildUserAdminBypass,
  clearAdminClockInBypass,
  readAdminClockInBypass,
  type AdminClockInBypass,
  type BypassStaffUser,
  verifyAuthUserIsSuperuser,
  writeAdminClockInBypass,
} from '../lib/adminClockInBypass';

export function useAdminProfileBypass() {
  const { user } = useAuthContext();
  const [bypass, setBypass] = useState<AdminClockInBypass | null>(() =>
    readAdminClockInBypass(user?.id),
  );

  const syncBypass = useCallback(() => {
    setBypass(readAdminClockInBypass(user?.id));
  }, [user?.id]);

  useEffect(() => {
    syncBypass();
  }, [syncBypass]);

  useEffect(() => {
    const onChanged = () => syncBypass();
    window.addEventListener(ADMIN_PROFILE_BYPASS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ADMIN_PROFILE_BYPASS_CHANGED_EVENT, onChanged);
  }, [syncBypass]);

  const activateSelfBypass = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;

    const isSuper = await verifyAuthUserIsSuperuser(user.id);
    if (!isSuper) return false;

    const next = await buildSelfAdminBypass(user.id);
    if (!next) return false;

    writeAdminClockInBypass(next);
    setBypass(next);
    return true;
  }, [user?.id]);

  const activateUserBypass = useCallback(async (
    adminAuthUserId: string,
    staffUser: BypassStaffUser,
    workerAuthUserId: string,
  ): Promise<boolean> => {
    const next = buildUserAdminBypass(adminAuthUserId, staffUser, workerAuthUserId);
    writeAdminClockInBypass(next);
    setBypass(next);
    return true;
  }, []);

  const clearBypass = useCallback(() => {
    clearAdminClockInBypass();
    setBypass(null);
  }, []);

  return {
    bypass,
    isBypassActive: bypass != null,
    effectiveEmployeeId: bypass?.targetEmployeeId ?? null,
    effectiveDisplayName: bypass?.targetDisplayName ?? null,
    effectivePhotoUrl: bypass?.targetPhotoUrl ?? null,
    effectiveInitials: bypass?.targetInitials ?? null,
    activateSelfBypass,
    activateUserBypass,
    clearBypass,
  };
}
