import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { portalValidateSession } from '../../lib/portalApi';
import {
  clearPortalSession,
  getPortalLeadRef,
  getPortalSessionToken,
} from '../../lib/portalSession';
import type { PortalContact, PortalLeadSummary } from '../../lib/portalApi';

export type PortalSessionState = {
  loading: boolean;
  valid: boolean;
  leadSummary: PortalLeadSummary | null;
  contact: PortalContact | null;
  leadRef: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

export function usePortalSession(requireValid = false): PortalSessionState {
  const { leadRef: routeLeadRef } = useParams<{ leadRef: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [leadSummary, setLeadSummary] = useState<PortalLeadSummary | null>(null);
  const [contact, setContact] = useState<PortalContact | null>(null);

  const storedLeadRef = getPortalLeadRef();
  const leadRef = routeLeadRef ?? storedLeadRef;

  const refresh = useCallback(async () => {
    const token = getPortalSessionToken();
    if (!token) {
      setValid(false);
      setLeadSummary(null);
      setContact(null);
      setLoading(false);
      return;
    }

    try {
      const ctx = await portalValidateSession(token);
      if (!ctx.ok) {
        clearPortalSession();
        setValid(false);
        setLeadSummary(null);
        setContact(null);
        return;
      }
      setValid(true);
      setLeadSummary(ctx.lead_summary ?? null);
      setContact(ctx.contact ?? null);
    } catch {
      clearPortalSession();
      setValid(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const { portalLogout } = await import('../../lib/portalApi');
    await portalLogout();
    clearPortalSession();
    setValid(false);
    if (leadRef) {
      navigate(`/portal/${encodeURIComponent(leadRef)}`, { replace: true });
    }
  }, [leadRef, navigate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!loading && requireValid && !valid && leadRef) {
      navigate(`/portal/${encodeURIComponent(leadRef)}`, { replace: true });
    }
  }, [loading, requireValid, valid, leadRef, navigate]);

  return { loading, valid, leadSummary, contact, leadRef, refresh, logout };
}
