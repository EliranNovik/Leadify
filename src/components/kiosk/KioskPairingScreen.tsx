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
/** Refresh the displayed code a bit before the server TTL (10 min). */
const CODE_REFRESH_MS = 8 * 60 * 1000;
/** Back off after create rate-limits before trying again. */
const CREATE_RETRY_MS = 30_000;

export default function KioskPairingScreen({ locationId = 1, onPaired }: KioskPairingScreenProps) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pairedRef = useRef(false);
  const onPairedRef = useRef(onPaired);
  const codeRef = useRef<string | null>(null);
  const expiresAtRef = useRef<string | null>(null);
  const createInFlightRef = useRef(false);
  const lastCreateAtRef = useRef(0);

  onPairedRef.current = onPaired;
  codeRef.current = code;
  expiresAtRef.current = expiresAt;

  const finishPairing = useCallback((deviceToken: string) => {
    if (pairedRef.current) return;
    pairedRef.current = true;
    setStoredKioskDeviceToken(deviceToken);
    onPairedRef.current?.();
  }, []);

  const refreshCode = useCallback(
    async (options?: { force?: boolean }) => {
      if (pairedRef.current || getStoredKioskDeviceToken()) return;
      if (createInFlightRef.current) return;

      const force = Boolean(options?.force);
      const existingExpires = expiresAtRef.current;
      if (!force && codeRef.current && existingExpires) {
        const msLeft = new Date(existingExpires).getTime() - Date.now();
        // Keep showing the current code until it is close to expiry.
        if (msLeft > 90_000) return;
      }

      const sinceLast = Date.now() - lastCreateAtRef.current;
      if (!force && sinceLast > 0 && sinceLast < 5_000) return;

      createInFlightRef.current = true;
      setError(null);
      try {
        const result = await requestKioskPairingCode(locationId);
        if (!result.success || !result.code) {
          const msg = result.error || 'Could not generate pairing code';
          setError(msg);
          if (msg.toLowerCase().includes('too many')) {
            lastCreateAtRef.current = Date.now();
          }
          return;
        }
        lastCreateAtRef.current = Date.now();
        setCode(result.code);
        setExpiresAt(result.expiresAt || null);
      } finally {
        createInFlightRef.current = false;
      }
    },
    [locationId],
  );

  // Create one code on mount; refresh on a timer. Do not depend on onPaired —
  // parent re-renders (e.g. clock tick) must not mint new codes.
  useEffect(() => {
    if (getStoredKioskDeviceToken()) {
      onPairedRef.current?.();
      return undefined;
    }

    void refreshCode({ force: true });
    const timer = window.setInterval(() => {
      void refreshCode();
    }, CODE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshCode]);

  useEffect(() => {
    if (!code || pairedRef.current || getStoredKioskDeviceToken()) return undefined;

    let cancelled = false;
    let timer: number | null = null;
    let pollMs = PAIRING_POLL_MS;

    const schedule = (delay: number) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (cancelled || pairedRef.current || getStoredKioskDeviceToken()) return;

      const result = await claimKioskPairingCode(code);
      if (cancelled || pairedRef.current) return;

      if (result.status === 'paired' && result.deviceToken) {
        finishPairing(result.deviceToken);
        return;
      }

      if (result.status === 'claimed' && getStoredKioskDeviceToken()) {
        onPairedRef.current?.();
        return;
      }

      if (result.status === 'expired') {
        setError('Pairing code expired — generating a new code…');
        await refreshCode({ force: true });
        return;
      }

      if (!result.success && result.error?.toLowerCase().includes('too many')) {
        pollMs = Math.min(pollMs * 2, CREATE_RETRY_MS);
        schedule(pollMs);
        return;
      }

      pollMs = PAIRING_POLL_MS;
      schedule(pollMs);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [code, finishPairing, refreshCode]);

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
        <button type="button" className="btn btn-outline btn-sm mt-4" onClick={() => void refreshCode({ force: true })}>
          New code
        </button>
      </div>
    </div>
  );
}
