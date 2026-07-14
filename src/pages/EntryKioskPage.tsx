import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraIcon, CheckIcon } from '@heroicons/react/24/outline';
import MorphingQrCode from '../components/MorphingQrCode';
import {
  ENTRY_KIOSK_DEFAULT_LOCATION_ID,
  fetchClockInKioskCurrent,
  fetchClockInKioskRecentEvent,
  type ClockInKioskRecentEvent,
} from '../lib/clockInKioskApi';

const OFFICE_LABEL = 'RAMAT GAN';
const QR_RENDER_SIZE = 512;
const EVENT_POLL_MS = 1_400;
const SUCCESS_FLASH_MS = 3_600;

function formatClock(now: Date) {
  return now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDate(now: Date) {
  return now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Public tablet display at the office entry.
 * Optimized for ~10" tablet kiosks (landscape first); QR stays dominant.
 */
const EntryKioskPage: React.FC = () => {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotateInMs, setRotateInMs] = useState(15_000);
  const [totalRotateMs, setTotalRotateMs] = useState(15_000);
  const [secondsLeft, setSecondsLeft] = useState(15);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(true);
  const [successFlash, setSuccessFlash] = useState<ClockInKioskRecentEvent | null>(null);

  const lastEventIdRef = useRef<string | null>(null);
  const successTimerRef = useRef<number | null>(null);

  const refreshToken = useCallback(async () => {
    try {
      const result = await fetchClockInKioskCurrent(ENTRY_KIOSK_DEFAULT_LOCATION_ID);
      if (!result.success || !result.qrUrl) {
        setError(result.error || 'Could not load QR code');
        setOnline(false);
        return;
      }
      setQrUrl(result.qrUrl);
      setError(null);
      setOnline(true);
      const nextRotate = Math.max(1_000, Number(result.rotateInMs) || 15_000);
      setRotateInMs(nextRotate);
      setTotalRotateMs(nextRotate);
      setSecondsLeft(Math.ceil(nextRotate / 1000));
    } catch (err) {
      console.error('Entry kiosk refresh failed:', err);
      setError('Connection issue — retrying…');
      setOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshToken();
  }, [refreshToken]);

  useEffect(() => {
    if (!qrUrl || successFlash) return;
    const timer = window.setTimeout(() => {
      void refreshToken();
    }, rotateInMs);
    return () => window.clearTimeout(timer);
  }, [qrUrl, rotateInMs, refreshToken, successFlash]);

  useEffect(() => {
    if (!qrUrl || successFlash) return;
    const tick = window.setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [qrUrl, rotateInMs, successFlash]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const prevOverflow = document.body.style.overflow;
    html.classList.add('entry-kiosk-active');
    document.body.style.overflow = 'hidden';
    return () => {
      html.classList.remove('entry-kiosk-active');
      document.body.style.overflow = prevOverflow;
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applyEvent = (event: ClockInKioskRecentEvent | null | undefined) => {
      if (!event?.id || event.id === lastEventIdRef.current) return;
      lastEventIdRef.current = event.id;
      setSuccessFlash(event);
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
      successTimerRef.current = window.setTimeout(() => {
        setSuccessFlash(null);
      }, SUCCESS_FLASH_MS);
    };

    const pollOnce = async () => {
      try {
        const result = await fetchClockInKioskRecentEvent(ENTRY_KIOSK_DEFAULT_LOCATION_ID);
        if (cancelled) return;
        if (!result.success) {
          setOnline(false);
          return;
        }
        setOnline(true);
        applyEvent(result.event);
      } catch (err) {
        if (!cancelled) {
          console.warn('Kiosk recent-event poll failed:', err);
          setOnline(false);
        }
      }
    };

    void pollOnce();
    const poll = window.setInterval(() => {
      void pollOnce();
    }, EVENT_POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void pollOnce();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const progress = useMemo(() => {
    const totalSec = Math.max(1, Math.round(totalRotateMs / 1000));
    return Math.min(1, Math.max(0, secondsLeft / totalSec));
  }, [secondsLeft, totalRotateMs]);

  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - progress);

  return (
    <div
      className="entry-kiosk relative flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden text-[var(--kiosk-text)]"
      style={
        {
          '--kiosk-text': '#f8fafc',
          '--kiosk-muted': '#9ca3af',
          '--kiosk-gold': '#d8b15a',
          background:
            'radial-gradient(ellipse 80% 55% at 50% 8%, rgba(74, 110, 190, 0.28), transparent 55%), radial-gradient(ellipse 60% 40% at 80% 90%, rgba(40, 70, 140, 0.18), transparent 50%), radial-gradient(ellipse 50% 35% at 10% 70%, rgba(30, 55, 120, 0.12), transparent 45%), linear-gradient(180deg, #0a1630 0%, #050d1c 42%, #02060f 100%)',
        } as React.CSSProperties
      }
    >
      <style>{`
        @keyframes kiosk-scan-orbit {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes kiosk-success-in {
          0% { opacity: 0; transform: translateY(12px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .kiosk-success-backdrop {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.25rem;
          background: rgba(2, 6, 15, 0.78);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .kiosk-success-card {
          width: min(420px, 92vw);
          border-radius: 28px;
          background: linear-gradient(180deg, #ffffff 0%, #f4f7fb 100%);
          box-shadow:
            0 40px 100px rgba(0, 0, 0, 0.55),
            0 0 0 1px rgba(255, 255, 255, 0.35);
          padding: 2rem 1.75rem 1.75rem;
          text-align: center;
          animation: kiosk-success-in 320ms ease-out;
        }
        .kiosk-success-photo {
          width: 112px;
          height: 112px;
          border-radius: 9999px;
          object-fit: cover;
          margin: 0 auto;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.25);
          border: 4px solid #fff;
          background: #e2e8f0;
        }
        .kiosk-success-photo-fallback {
          width: 112px;
          height: 112px;
          border-radius: 9999px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(145deg, #1e3a5f, #0f172a);
          color: #d8b15a;
          font-size: 2.25rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.25);
          border: 4px solid #fff;
        }
        .kiosk-success-check {
          width: 2.25rem;
          height: 2.25rem;
          border-radius: 9999px;
          background: #10b981;
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 20px rgba(16, 185, 129, 0.45);
          margin: -1.15rem auto 0.85rem;
          position: relative;
          z-index: 1;
        }

        /*
          Primary target: ~10" tablet kiosk (landscape ~1024×768–1366×800).
          QR stays dominant; chrome stays readable at arm's length but compact.
        */
        .kiosk-header {
          padding-block: 0.65rem;
          padding-inline: max(1rem, env(safe-area-inset-left)) max(1rem, env(safe-area-inset-right));
        }
        .kiosk-logo {
          height: 3.25rem;
        }
        .kiosk-clock {
          font-size: 2rem;
          line-height: 1.1;
        }
        .kiosk-date {
          font-size: 0.9rem;
        }
        .kiosk-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
        }
        .kiosk-location {
          font-size: 0.8rem;
          margin-top: 0.25rem;
          padding: 0;
          letter-spacing: 0.14em;
          background: none;
          border-radius: 0;
        }
        .kiosk-title {
          margin-top: 0;
          font-size: 1.85rem;
          line-height: 1.15;
        }
        .kiosk-sub {
          margin-top: 0.3rem;
          font-size: 0.95rem;
        }
        .kiosk-footer {
          gap: 0.35rem;
          padding-top: 0.2rem;
        }
        .kiosk-countdown {
          width: 5.5rem;
          height: 5.5rem;
          flex-shrink: 0;
        }
        .kiosk-countdown-num {
          font-size: 1.5rem;
        }
        .kiosk-main {
          padding-bottom: 2.5rem;
        }

        .kiosk-qr-slot {
          flex: 1 1 0;
          min-height: 0;
          min-width: 0;
          width: 100%;
          display: grid;
          place-items: center;
          container-type: size;
          padding: 4px;
        }
        .kiosk-qr-shell {
          position: relative;
          width: min(100cqi, 100cqb, 520px);
          max-width: 100%;
          aspect-ratio: 1 / 1;
        }
        @supports not (width: 1cqi) {
          .kiosk-qr-shell {
            width: min(78vw, 62vh, 520px);
          }
        }
        .kiosk-scan-ring {
          position: absolute;
          inset: -7px;
          border-radius: 28px;
          pointer-events: none;
          overflow: hidden;
          z-index: 0;
        }
        .kiosk-scan-ring::before {
          content: '';
          position: absolute;
          inset: -45%;
          background: conic-gradient(
            from 0deg,
            transparent 0deg,
            transparent 300deg,
            rgba(216, 177, 90, 0.85) 330deg,
            transparent 360deg
          );
          animation: kiosk-scan-orbit 4.5s linear infinite;
        }
        .kiosk-qr-frame {
          position: relative;
          z-index: 1;
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          border-radius: 26px;
          background: #fff;
          padding: 16px;
          box-shadow: 0 35px 80px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .kiosk-qr-frame svg,
        .kiosk-qr-placeholder {
          width: 100% !important;
          height: 100% !important;
          max-width: 100%;
          max-height: 100%;
          display: block;
        }

        /* Always hide camera hint on short tablet heights — frees QR room */
        .kiosk-camera-hint {
          display: none;
        }

        /* 10" landscape sweet spot (iPad / Android tablets) */
        @media (orientation: landscape) and (max-height: 900px) and (min-width: 900px) {
          .kiosk-header { padding-block: 0.55rem; }
          .kiosk-logo { height: 3.35rem; }
          .kiosk-clock { font-size: 2.15rem; }
          .kiosk-date { font-size: 0.95rem; }
          .kiosk-title { font-size: 2rem; margin-top: 0.35rem; }
          .kiosk-sub { font-size: 1rem; }
          .kiosk-countdown { width: 5.75rem; height: 5.75rem; }
          .kiosk-countdown-num { font-size: 1.6rem; }
          .kiosk-qr-shell { width: min(100cqi, 100cqb, 540px); }
          .kiosk-qr-frame { padding: 14px; border-radius: 24px; }
          .kiosk-main { padding-bottom: 2.25rem; }
        }

        /* Shorter 10" landscape (~768–800 CSS height) — keep QR large */
        @media (orientation: landscape) and (max-height: 820px) {
          .kiosk-header { padding-block: 0.45rem; }
          .kiosk-logo { height: 3rem; }
          .kiosk-clock { font-size: 1.9rem; }
          .kiosk-date { font-size: 0.85rem; }
          .kiosk-title { font-size: 1.7rem; margin-top: 0.25rem; }
          .kiosk-sub { font-size: 0.9rem; margin-top: 0.2rem; }
          .kiosk-countdown { width: 5rem; height: 5rem; }
          .kiosk-countdown-num { font-size: 1.35rem; }
          .kiosk-qr-shell { width: min(100cqi, 100cqb, 500px); }
          .kiosk-qr-frame { padding: 12px; }
          .kiosk-main { padding-bottom: 2rem; }
        }

        /* Very short landscape — drop subtitle before shrinking QR further */
        @media (orientation: landscape) and (max-height: 740px) {
          .kiosk-sub { display: none; }
          .kiosk-qr-shell { width: min(100cqi, 100cqb, 460px); }
        }

        /* 10" portrait (tablet upright) — QR can use more width */
        @media (orientation: portrait) and (max-width: 900px) {
          .kiosk-logo { height: 3.5rem; }
          .kiosk-clock { font-size: 2.25rem; }
          .kiosk-date { font-size: 1rem; }
          .kiosk-title { font-size: 2.1rem; }
          .kiosk-sub { font-size: 1.05rem; }
          .kiosk-countdown { width: 6rem; height: 6rem; }
          .kiosk-countdown-num { font-size: 1.65rem; }
          .kiosk-qr-shell { width: min(100cqi, 100cqb, 560px); }
          .kiosk-camera-hint { display: none; }
        }

        /* Large desktop preview — don't let chrome balloon; keep QR capped */
        @media (min-height: 960px) and (min-width: 1200px) {
          .kiosk-logo { height: 3.75rem; }
          .kiosk-clock { font-size: 2.4rem; }
          .kiosk-date { font-size: 1.05rem; }
          .kiosk-title { font-size: 2.5rem; }
          .kiosk-sub { font-size: 1.1rem; }
          .kiosk-countdown { width: 6.5rem; height: 6.5rem; }
          .kiosk-countdown-num { font-size: 1.75rem; }
          .kiosk-qr-shell { width: min(100cqi, 100cqb, 520px); }
          .kiosk-camera-hint {
            display: inline-flex;
          }
        }
      `}</style>

      {successFlash ? (
        <div className="kiosk-success-backdrop" role="dialog" aria-live="polite" aria-label="Employee clocked in">
          <div className="kiosk-success-card">
            {successFlash.photoUrl ? (
              <img
                src={successFlash.photoUrl}
                alt=""
                className="kiosk-success-photo"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling;
                  if (fallback instanceof HTMLElement) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className="kiosk-success-photo-fallback"
              style={successFlash.photoUrl ? { display: 'none' } : undefined}
              aria-hidden={Boolean(successFlash.photoUrl)}
            >
              {(successFlash.employeeName || 'E')
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() ?? '')
                .join('') || '•'}
            </div>
            <div className="kiosk-success-check" aria-hidden>
              <CheckIcon className="h-5 w-5" strokeWidth={2.75} />
            </div>
            <p className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {successFlash.employeeName || 'Employee'}
            </p>
            <p className="mt-2 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-600">
              Clocked in
            </p>
            <p className="mt-5 text-4xl font-semibold tabular-nums text-slate-800 sm:text-5xl">
              {formatClock(new Date(successFlash.at || Date.now()))}
            </p>
            <p className="mt-3 text-xs text-slate-500 sm:text-sm">Welcome to the office</p>
          </div>
        </div>
      ) : null}

      <header className="kiosk-header relative z-10 flex shrink-0 items-start justify-between gap-3 px-4 sm:px-8">
        <img
          src="/DPLOGO1.png"
          alt="Decker Pex & Co. Lawoffice"
          className="kiosk-logo w-auto max-w-[42vw] object-contain opacity-95 drop-shadow"
        />
        <div className="kiosk-meta min-w-0 shrink-0">
          <p className="kiosk-clock font-semibold tracking-tight text-white tabular-nums">
            {formatClock(now)}
          </p>
          <p className="kiosk-date mt-0.5 text-[var(--kiosk-muted)]">
            {formatDate(now)}
          </p>
          <p className="kiosk-location font-semibold uppercase text-[var(--kiosk-gold)]">
            {OFFICE_LABEL}
          </p>
        </div>
      </header>

      <main className="kiosk-main relative z-10 flex min-h-0 flex-1 flex-col items-stretch px-3 sm:px-8">
        <div className="kiosk-welcome-block mx-auto flex w-full max-w-xl shrink-0 flex-col items-center px-1 text-center">
          <h1 className="kiosk-title font-bold tracking-tight text-white">
            Welcome to the office
          </h1>
          <p className="kiosk-sub text-[var(--kiosk-muted)]">
            Scan with your phone
          </p>
        </div>

        <div className="kiosk-qr-slot">
          <div className="kiosk-qr-shell">
            <div className="kiosk-scan-ring" aria-hidden />
            <div className="kiosk-qr-frame">
              {loading && !qrUrl ? (
                <div className="kiosk-qr-placeholder flex items-center justify-center">
                  <span className="loading loading-spinner loading-lg text-slate-400" />
                </div>
              ) : qrUrl ? (
                <MorphingQrCode
                  value={qrUrl}
                  size={QR_RENDER_SIZE}
                  fgColor="#0f172a"
                  bgColor="#ffffff"
                />
              ) : (
                <div className="kiosk-qr-placeholder flex items-center justify-center p-4 text-center text-sm text-slate-500">
                  {error || 'Waiting for QR…'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="kiosk-footer mx-auto flex w-full shrink-0 flex-col items-center">
          <div className="kiosk-camera-hint inline-flex items-center gap-2 text-xs text-[var(--kiosk-muted)] sm:text-sm">
            <CameraIcon className="h-4 w-4 text-[var(--kiosk-gold)] sm:h-5 sm:w-5" aria-hidden />
            <span>Point your camera at the QR code</span>
          </div>

          <div
            className="kiosk-countdown relative flex items-center justify-center"
            role="timer"
            aria-label={`${secondsLeft} seconds until QR refresh`}
          >
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 112 112" aria-hidden>
              <circle
                cx="56"
                cy="56"
                r={ringR}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="5"
              />
              <circle
                cx="56"
                cy="56"
                r={ringR}
                fill="none"
                stroke="var(--kiosk-gold)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={ringC}
                strokeDashoffset={ringOffset}
                style={{ transition: 'stroke-dashoffset 0.9s linear' }}
              />
            </svg>
            <div className="flex flex-col items-center leading-none">
              <span className="kiosk-countdown-num font-bold tabular-nums text-white">{secondsLeft}</span>
              <span className="mt-0.5 text-[8px] font-medium uppercase tracking-[0.12em] text-[var(--kiosk-muted)] sm:text-[10px]">
                seconds
              </span>
            </div>
          </div>

          {error && qrUrl ? (
            <p className="max-w-[90vw] text-center text-xs text-amber-300/90 sm:text-sm">{error}</p>
          ) : null}
        </div>
      </main>

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[40vw] items-center gap-2 sm:bottom-5 sm:left-8 sm:max-w-none">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : 'bg-amber-400'}`}
        />
        <div className="leading-tight">
          <p className="text-[11px] font-medium text-white/85 sm:text-xs">
            {online ? 'Online' : 'Reconnecting'}
          </p>
          <p className="kiosk-secure text-[9px] text-[var(--kiosk-muted)] sm:text-[10px]">Secure connection</p>
        </div>
      </div>
    </div>
  );
};

export default EntryKioskPage;
