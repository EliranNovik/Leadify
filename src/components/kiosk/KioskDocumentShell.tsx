import React, { useCallback, useEffect, useRef, useState } from 'react';
import './kiosk-shell.css';
import PublicContractView from '../../pages/PublicContractView';
import PoaPage from '../../pages/PoaPage';
import PaymentPage from '../../pages/PaymentPage';
import {
  cancelKioskSessionFromDevice,
  completeKioskSession,
  fetchKioskSessionAccess,
  type KioskSessionAccess,
} from '../../lib/kioskDeviceApi';

type KioskDocumentShellProps = {
  sessionId: string;
  resourceType: 'digital_contract' | 'poa' | 'payment';
  onDone: (message?: string) => void;
  onCancelled: () => void;
};

export default function KioskDocumentShell({
  sessionId,
  resourceType,
  onDone,
  onCancelled,
}: KioskDocumentShellProps) {
  const [access, setAccess] = useState<KioskSessionAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [poaToken, setPoaToken] = useState<string | null>(null);
  const cleanedUpRef = useRef(false);

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchKioskSessionAccess(sessionId);
      if (!result.success || !result.access) {
        setError(result.error || 'Could not open this document');
        return;
      }
      setAccess(result.access);
      if (result.access.resourceType === 'poa') {
        setPoaToken(result.access.resourceToken);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open document');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  useEffect(() => {
    const onPopState = () => {
      if (cleanedUpRef.current) return;
      cleanedUpRef.current = true;
      void cancelKioskSessionFromDevice(sessionId);
      onCancelled();
    };
    window.history.pushState({ kioskDocument: sessionId }, '', window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [sessionId, onCancelled]);

  const handleComplete = useCallback(
    async (message?: string) => {
      if (cleanedUpRef.current) return;
      cleanedUpRef.current = true;
      await completeKioskSession(sessionId);
      window.history.replaceState(null, '', window.location.pathname);
      onDone(message);
    },
    [sessionId, onDone],
  );

  if (loading) {
    return (
      <div className="kiosk-document-shell kiosk-document-loading">
        <span className="loading loading-spinner loading-lg text-slate-300" />
        <p>Loading document…</p>
      </div>
    );
  }

  if (error || !access) {
    return (
      <div className="kiosk-document-shell kiosk-document-error">
        <p>{error || 'Document unavailable'}</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onCancelled()}>
          Return to home
        </button>
      </div>
    );
  }

  if (access.resourceType === 'digital_contract' || resourceType === 'digital_contract') {
    return (
      <div className="kiosk-document-shell">
        <PublicContractView
          kioskMode
          contractIdOverride={access.resourceId}
          tokenOverride={access.resourceToken}
          onKioskComplete={() => void handleComplete('Contract signed successfully')}
        />
      </div>
    );
  }

  if ((access.resourceType === 'poa' || resourceType === 'poa') && poaToken) {
    return (
      <div className="kiosk-document-shell">
        <PoaPage
          kioskMode
          tokenOverride={poaToken}
          onKioskTokenChange={setPoaToken}
          onKioskComplete={() => void handleComplete('Documents signed successfully')}
        />
      </div>
    );
  }

  if (access.resourceType === 'payment' || resourceType === 'payment') {
    return (
      <div className="kiosk-document-shell kiosk-document-shell--payment">
        <PaymentPage
          kioskMode
          tokenOverride={access.resourceToken}
          onKioskComplete={() => void handleComplete('Payment completed')}
        />
      </div>
    );
  }

  return (
    <div className="kiosk-document-shell kiosk-document-error">
      <p>Unsupported document type</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => onCancelled()}>
        Return to home
      </button>
    </div>
  );
}
