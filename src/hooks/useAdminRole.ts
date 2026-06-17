import { useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

/** Role flags are owned by AuthContext (single fetch). This hook is a thin read-only adapter. */
export const useAdminRole = () => {
  const { isAdmin, isSuperUser, sessionRefreshNonce } = useAuthContext();

  const refreshAdminStatus = useCallback(async () => {
    // Role refresh is driven by AuthContext fetchUserDetails on sessionRefreshNonce bumps.
    void sessionRefreshNonce;
  }, [sessionRefreshNonce]);

  return { isAdmin, isSuperUser, isLoading: false, refreshAdminStatus };
};
