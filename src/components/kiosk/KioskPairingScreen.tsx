import React, { useCallback, useEffect, useRef, useState } from 'react';
import './kiosk-shell.css';
import {
  claimKioskPairingCode,
  getStoredKioskDeviceToken,
  requestKioskPairingCode,
  setStoredKioskDeviceToken,
} from '../../lib/kioskDeviceApi';

type KioskPairingScreenProps = {
  locationId?: number;
  onPaired?: () => void;
};

const PAIRING_POLL_MS = 3_000;

export default function KioskPairingScreen({ locationId = 1, onPaired }: KioskPairingScreenProps) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pairedRef = useRef(false);

  const finishPairing = useCallback(
    (deviceToken: string) => {
      if (pairedRef.current) return;
      pairedRef.current = true;
      setStoredKioskDeviceToken(deviceToken);
      onPaired?.();
    },
    [onPaired],
  );

  const refreshCode = useCallback(async () => {
    if (pairedRef.current || getStoredKioskDeviceToken()) return;
    setError(null);
    const result = await requestKioskPairingCode(locationId);
    if (!result.success || !result.code) {
      setError(result.error || 'Could not generate pairing code');
      return;
    }
    setCode(result.code);
    setExpiresAt(result.expiresAt || null);
  }, [locationId]);

  useEffect(() => {
    if (getStoredKioskDeviceToken()) {
      onPaired?.();
      return undefined;
    }

    void refreshCode();
    const timer = window.setInterval(() => {
      void refreshCode();
    }, 8 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [onPaired, refreshCode]);

  useEffect(() => {
    if (!code || pairedRef.current || getStoredKioskDeviceToken()) return undefined;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (cancelled || pairedRef.current || getStoredKioskDeviceToken()) return;

      const result = await claimKioskPairingCode(code);
      if (cancelled || pairedRef.current) return;

      if (result.status === 'paired' && result.deviceToken) {
        finishPairing(result.deviceToken);
        return;
      }

      if (result.status === 'claimed' && getStoredKioskDeviceToken()) {
        onPaired?.();
        return;
      }

      if (result.status === 'expired') {
        setError('Pairing code expired — generating a new code…');
        void refreshCode();
        return;
      }

      if (!result.success && result.error?.includes('Too many')) {
        if (timer) window.clearInterval(timer);
        timer = window.setInterval(() => void poll(), PAIRING_POLL_MS * 2);
      }
    };

    void poll();
    timer = window.setInterval(() => void poll(), PAIRING_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [code, finishPairing, onPaired, refreshCode]);

  return (
    <div className="kiosk-pairing-screen">
      <div className="kiosk-pairing-card">
        <p className="kiosk-pairing-label">This kiosk is not registered</p>
        <h1 className="kiosk-pairing-title">Pairing code</h1>
        <p className="kiosk-pairing-code" aria-live="polite">
          {code || '…'}
        </p>
        <p className="kiosk-pairing-hint">
          In the CRM, open HR → Entry kiosk → Devices, enter this code, and name this tablet.
        </p>
        {expiresAt ? (
          <p className="kiosk-pairing-expires">
            Code expires {new Date(expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </p>
        ) : null}
        {error ? <p className="kiosk-pairing-error">{error}</p> : null}
        <button type="button" className="btn btn-outline btn-sm mt-4" onClick={() => void refreshCode()}>
          New code
        </button>
      </div>
    </div>
  );
}
