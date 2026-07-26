import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../contexts/AuthContext';
import { consumePostLoginRedirect } from '../lib/postLoginRedirect';

/**
 * If magic-link / OAuth lands on `/` or `/login` after auth, resume a stored
 * entry-kiosk QR return path (e.g. `/clock-in/entry?…`).
 */
export default function PostLoginRedirectRecovery() {
  const { user, supabaseSessionReady } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!supabaseSessionReady || !user || handledRef.current) return;
    if (location.pathname.startsWith('/clock-in/entry')) {
      handledRef.current = true;
      return;
    }
    if (location.pathname !== '/' && location.pathname !== '/login') return;

    const path = consumePostLoginRedirect();
    if (!path || path === '/' || path === `${location.pathname}${location.search}`) return;

    handledRef.current = true;
    navigate(path, { replace: true });
  }, [user, supabaseSessionReady, location.pathname, location.search, navigate]);

  return null;
}
