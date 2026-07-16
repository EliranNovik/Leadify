import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  CakeIcon,
  CalendarDaysIcon,
  ClockIcon,
  CloudIcon,
  DevicePhoneMobileIcon,
  MegaphoneIcon,
  UserGroupIcon,
  UsersIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import MorphingQrCode from '../components/MorphingQrCode';
import KioskDocumentShell from '../components/kiosk/KioskDocumentShell';
import KioskPairingScreen from '../components/kiosk/KioskPairingScreen';
import '../components/kiosk/kiosk-shell.css';
import {
  ENTRY_KIOSK_DEFAULT_LOCATION_ID,
  fetchClockInKioskCurrent,
  fetchClockInKioskRecentEvent,
  fetchEntryKioskDisplay,
  fetchEntryKioskMeetingsToday,
  toPublicClockInQrUrl,
  type ClockInKioskRecentEvent,
  type EntryKioskDisplayResponse,
  type EntryKioskMeetingDetail,
} from '../lib/clockInKioskApi';
import {
  fetchKioskState,
  getStoredKioskDeviceToken,
  kioskHeartbeat,
  type KioskStateResponse,
} from '../lib/kioskDeviceApi';

const QR_RENDER_SIZE = 640;
const EVENT_POLL_MS = 1_400;
const DISPLAY_POLL_MS = 60_000;
const KIOSK_STATE_POLL_MS = 2_000;
const KIOSK_HEARTBEAT_MS = 30_000;
const KIOSK_SUCCESS_MS = 5_000;
const SUCCESS_FLASH_MS = 5_000;
const SUCCESS_FLASH_SEC = 5;
const MEETINGS_IDLE_MS = 15_000;

type DeviceUiMode = 'checking' | 'unpaired' | 'attendance' | 'document' | 'success' | 'locked';

const MEETING_TYPE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  im: { bg: 'rgba(245, 158, 11, 0.18)', color: '#fbbf24', label: 'IM' },
  active: { bg: 'rgba(34, 197, 94, 0.14)', color: '#4ade80', label: 'Active' },
  potential: { bg: 'rgba(96, 165, 250, 0.14)', color: '#60a5fa', label: 'Potential' },
  other: { bg: 'rgba(148, 163, 184, 0.14)', color: '#cbd5e1', label: 'Meeting' },
};

function participantInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '•';
}

const MEETING_DOT_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c'];

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
  const [welcomeSecondsLeft, setWelcomeSecondsLeft] = useState(SUCCESS_FLASH_SEC);
  const [display, setDisplay] = useState<EntryKioskDisplayResponse | null>(null);
  const [meetingsScreenOpen, setMeetingsScreenOpen] = useState(false);
  const [meetingsDetail, setMeetingsDetail] = useState<EntryKioskMeetingDetail[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  const [deviceUiMode, setDeviceUiMode] = useState<DeviceUiMode>('checking');
  const [documentSession, setDocumentSession] = useState<{
    sessionId: string;
    resourceType: 'digital_contract' | 'poa' | 'payment';
  } | null>(null);
  const [kioskSuccessMessage, setKioskSuccessMessage] = useState<string | null>(null);

  const lastEventIdRef = useRef<string | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const welcomeTickRef = useRef<number | null>(null);
  const meetingsIdleTimerRef = useRef<number | null>(null);
  const kioskSuccessTimerRef = useRef<number | null>(null);
  const deviceUiModeRef = useRef<DeviceUiMode>('checking');

  useEffect(() => {
    deviceUiModeRef.current = deviceUiMode;
  }, [deviceUiMode]);

  const applyKioskState = useCallback((state: KioskStateResponse) => {
    if (!state.success) {
      if (!getStoredKioskDeviceToken()) {
        setDeviceUiMode('unpaired');
        setDocumentSession(null);
      }
      return;
    }
    if (state.mode === 'locked') {
      setDeviceUiMode('locked');
      setDocumentSession(null);
      return;
    }
    if (state.mode === 'document' && state.sessionId && state.resourceType) {
      setDocumentSession({
        sessionId: state.sessionId,
        resourceType: state.resourceType,
      });
      setDeviceUiMode('document');
      return;
    }
    setDocumentSession(null);
    setDeviceUiMode((prev) => (prev === 'success' ? prev : 'attendance'));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const token = getStoredKioskDeviceToken();
      if (!token) {
        if (!cancelled) setDeviceUiMode('unpaired');
        return;
      }
      const state = await fetchKioskState();
      if (!cancelled) applyKioskState(state);
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyKioskState]);

  useEffect(() => {
    if (deviceUiMode !== 'unpaired') return undefined;
    const token = getStoredKioskDeviceToken();
    if (!token) return undefined;

    let cancelled = false;
    void fetchKioskState().then((state) => {
      if (!cancelled) applyKioskState(state);
    });
    return () => {
      cancelled = true;
    };
  }, [deviceUiMode, applyKioskState]);

  useEffect(() => {
    if (deviceUiMode === 'unpaired' || deviceUiMode === 'checking' || deviceUiMode === 'document') {
      return undefined;
    }
    if (!getStoredKioskDeviceToken()) return undefined;

    let cancelled = false;
    const poll = async () => {
      const mode = deviceUiModeRef.current;
      if (cancelled || mode === 'document' || mode === 'success') return;
      const state = await fetchKioskState();
      if (cancelled) return;
      const currentMode = deviceUiModeRef.current;
      if (currentMode === 'document' || currentMode === 'success') return;
      applyKioskState(state);
    };

    void poll();
    const timer = window.setInterval(() => void poll(), KIOSK_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyKioskState, deviceUiMode]);

  useEffect(() => {
    if (!getStoredKioskDeviceToken()) return undefined;
    const timer = window.setInterval(() => {
      void kioskHeartbeat();
    }, KIOSK_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [deviceUiMode]);

  const handleKioskDocumentDone = useCallback((message?: string) => {
    setKioskSuccessMessage(message || 'Completed successfully');
    setDeviceUiMode('success');
    setDocumentSession(null);
    if (kioskSuccessTimerRef.current) window.clearTimeout(kioskSuccessTimerRef.current);
    kioskSuccessTimerRef.current = window.setTimeout(() => {
      setKioskSuccessMessage(null);
      setDeviceUiMode('attendance');
    }, KIOSK_SUCCESS_MS);
  }, []);

  const handleKioskDocumentCancelled = useCallback(() => {
    setDocumentSession(null);
    setDeviceUiMode('attendance');
  }, []);

  useEffect(() => {
    if (deviceUiMode !== 'document' || !documentSession) return undefined;

    let cancelled = false;
    const poll = async () => {
      const state = await fetchKioskState();
      if (cancelled) return;
      if (
        state.mode !== 'document' ||
        !state.sessionId ||
        state.sessionId !== documentSession.sessionId
      ) {
        setDocumentSession(null);
        setDeviceUiMode('attendance');
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), KIOSK_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [deviceUiMode, documentSession]);

  const refreshToken = useCallback(async () => {
    try {
      const result = await fetchClockInKioskCurrent(ENTRY_KIOSK_DEFAULT_LOCATION_ID);
      if (!result.success || !result.qrUrl) {
        setError(result.error || 'Could not load QR code');
        setOnline(false);
        return;
      }
      setQrUrl(toPublicClockInQrUrl(result.qrUrl));
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
      if (welcomeTickRef.current) window.clearInterval(welcomeTickRef.current);
      if (meetingsIdleTimerRef.current) window.clearTimeout(meetingsIdleTimerRef.current);
    };
  }, []);

  const closeMeetingsScreen = useCallback(() => {
    setMeetingsScreenOpen(false);
    if (meetingsIdleTimerRef.current) {
      window.clearTimeout(meetingsIdleTimerRef.current);
      meetingsIdleTimerRef.current = null;
    }
  }, []);

  const resetMeetingsIdleTimer = useCallback(() => {
    if (!meetingsScreenOpen) return;
    if (meetingsIdleTimerRef.current) window.clearTimeout(meetingsIdleTimerRef.current);
    meetingsIdleTimerRef.current = window.setTimeout(() => {
      closeMeetingsScreen();
    }, MEETINGS_IDLE_MS);
  }, [closeMeetingsScreen, meetingsScreenOpen]);

  const openMeetingsScreen = useCallback(async () => {
    setMeetingsScreenOpen(true);
    setMeetingsLoading(true);
    setMeetingsError(null);
    try {
      const result = await fetchEntryKioskMeetingsToday(ENTRY_KIOSK_DEFAULT_LOCATION_ID);
      if (result.success) {
        setMeetingsDetail(result.meetings || []);
      } else {
        setMeetingsDetail([]);
        setMeetingsError(result.error || 'Could not load meetings');
      }
    } catch {
      setMeetingsDetail([]);
      setMeetingsError('Could not load meetings');
    } finally {
      setMeetingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!meetingsScreenOpen) return undefined;
    resetMeetingsIdleTimer();
    return () => {
      if (meetingsIdleTimerRef.current) window.clearTimeout(meetingsIdleTimerRef.current);
    };
  }, [meetingsScreenOpen, resetMeetingsIdleTimer]);

  useEffect(() => {
    let cancelled = false;

    const applyEvent = (event: ClockInKioskRecentEvent | null | undefined) => {
      if (!event?.id || event.id === lastEventIdRef.current) return;
      lastEventIdRef.current = event.id;
      setSuccessFlash(event);
      setWelcomeSecondsLeft(SUCCESS_FLASH_SEC);
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
      if (welcomeTickRef.current) window.clearInterval(welcomeTickRef.current);
      welcomeTickRef.current = window.setInterval(() => {
        setWelcomeSecondsLeft((prev) => Math.max(0, prev - 1));
      }, 1000);
      successTimerRef.current = window.setTimeout(() => {
        setSuccessFlash(null);
        setWelcomeSecondsLeft(SUCCESS_FLASH_SEC);
        if (welcomeTickRef.current) {
          window.clearInterval(welcomeTickRef.current);
          welcomeTickRef.current = null;
        }
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

  useEffect(() => {
    let cancelled = false;

    const pollDisplay = async () => {
      try {
        const result = await fetchEntryKioskDisplay(ENTRY_KIOSK_DEFAULT_LOCATION_ID);
        if (cancelled || !result.success) return;
        setDisplay(result);
      } catch (err) {
        if (!cancelled) console.warn('Kiosk display poll failed:', err);
      }
    };

    void pollDisplay();
    const timer = window.setInterval(() => {
      void pollDisplay();
    }, DISPLAY_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const progress = useMemo(() => {
    const totalSec = Math.max(1, Math.round(totalRotateMs / 1000));
    return Math.min(1, Math.max(0, secondsLeft / totalSec));
  }, [secondsLeft, totalRotateMs]);

  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - progress);

  const kioskSettings = display?.settings;
  const showClockDate = kioskSettings?.showClockDate !== false;
  const showWeather = Boolean(kioskSettings?.showWeather);
  const showMeetings = Boolean(kioskSettings?.showMeetingsToday);
  const showAnnouncements = Boolean(kioskSettings?.showAnnouncements);
  const showBirthdaysColumn =
    Boolean(kioskSettings?.showBirthdays) && (display?.birthdays?.length ?? 0) > 0;
  const infoColCount =
    (showMeetings ? 1 : 0) + (showAnnouncements ? 1 : 0) + (showBirthdaysColumn ? 1 : 0);
  const hasInfoStrip = infoColCount > 0;
  const currentAnnouncement = display?.announcements?.[0] ?? null;
  const currentBirthday = display?.birthdays?.[0] ?? null;

  if (deviceUiMode === 'checking') {
    return (
      <div className="entry-kiosk relative flex h-[100dvh] items-center justify-center bg-[#0a1628] text-white">
        <span className="loading loading-spinner loading-lg text-slate-300" />
      </div>
    );
  }

  if (deviceUiMode === 'unpaired') {
    return (
      <div className="entry-kiosk relative flex h-[100dvh] flex-col overflow-hidden bg-[#0a1628] text-white">
        <KioskPairingScreen
          locationId={ENTRY_KIOSK_DEFAULT_LOCATION_ID}
          onPaired={() => {
            setDeviceUiMode('checking');
            void fetchKioskState().then(applyKioskState);
          }}
        />
      </div>
    );
  }

  if (deviceUiMode === 'locked') {
    return (
      <div className="entry-kiosk relative flex h-[100dvh] items-center justify-center bg-[#0a1628] px-6 text-center text-white">
        <div>
          <h1 className="text-2xl font-bold">Kiosk locked</h1>
          <p className="mt-2 text-slate-300">This device was revoked. Contact your administrator.</p>
        </div>
      </div>
    );
  }

  if (deviceUiMode === 'document' && documentSession) {
    return (
      <div className="entry-kiosk relative flex h-[100dvh] flex-col overflow-hidden bg-white">
        <KioskDocumentShell
          sessionId={documentSession.sessionId}
          resourceType={documentSession.resourceType}
          onDone={handleKioskDocumentDone}
          onCancelled={handleKioskDocumentCancelled}
        />
      </div>
    );
  }

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
      <div className="kiosk-waves" aria-hidden>
        <svg
          className="kiosk-wave kiosk-wave-1"
          viewBox="0 0 1440 200"
          preserveAspectRatio="none"
        >
          <path
            fill="rgba(74, 120, 190, 0.14)"
            d="M0,120 C240,160 480,60 720,100 C960,140 1200,180 1440,120 L1440,200 L0,200 Z"
          />
        </svg>
        <svg
          className="kiosk-wave kiosk-wave-2"
          viewBox="0 0 1440 200"
          preserveAspectRatio="none"
        >
          <path
            fill="rgba(100, 150, 210, 0.1)"
            d="M0,140 C320,90 560,170 800,130 C1040,90 1280,40 1440,90 L1440,200 L0,200 Z"
          />
        </svg>
        <svg
          className="kiosk-wave kiosk-wave-3"
          viewBox="0 0 1440 200"
          preserveAspectRatio="none"
        >
          <path
            fill="rgba(50, 90, 160, 0.12)"
            d="M0,160 C280,120 520,180 760,150 C1000,120 1240,100 1440,140 L1440,200 L0,200 Z"
          />
        </svg>
      </div>
      {deviceUiMode === 'success' && kioskSuccessMessage ? (
        <div className="kiosk-success-overlay" role="status" aria-live="polite">
          <div className="kiosk-success-card">
            <h2>Done</h2>
            <p>{kioskSuccessMessage}</p>
          </div>
        </div>
      ) : null}
      <style>{`
        @keyframes kiosk-scan-orbit {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes kiosk-wave-drift {
          0% { transform: translateX(0); }
          50% { transform: translateX(-3%); }
          100% { transform: translateX(0); }
        }
        @keyframes kiosk-wave-drift-alt {
          0% { transform: translateX(0); }
          50% { transform: translateX(3.5%); }
          100% { transform: translateX(0); }
        }
        .kiosk-waves {
          pointer-events: none;
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: min(38vh, 320px);
          z-index: 0;
          overflow: hidden;
          opacity: 0.9;
        }
        .kiosk-wave {
          position: absolute;
          left: -5%;
          width: 110%;
          height: 100%;
          bottom: 0;
        }
        .kiosk-wave-1 {
          bottom: -8%;
          animation: kiosk-wave-drift 22s ease-in-out infinite;
        }
        .kiosk-wave-2 {
          bottom: -2%;
          animation: kiosk-wave-drift-alt 28s ease-in-out infinite;
        }
        .kiosk-wave-3 {
          bottom: -14%;
          animation: kiosk-wave-drift 34s ease-in-out infinite;
        }
        @keyframes kiosk-success-in {
          0% { opacity: 0; transform: translateY(12px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes kiosk-confetti-pop {
          0% { opacity: 0; transform: scale(0.4); }
          40% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.85; }
        }
        .kiosk-success-backdrop {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.25rem;
          background: rgba(2, 6, 15, 0.82);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        .kiosk-success-card {
          width: min(420px, 94vw);
          border-radius: 28px;
          background: linear-gradient(180deg, #121826 0%, #0b1220 100%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 40px 100px rgba(0, 0, 0, 0.55);
          padding: 1.75rem 1.5rem 1.35rem;
          text-align: center;
          animation: kiosk-success-in 320ms ease-out;
          color: #f8fafc;
        }
        .kiosk-success-photo-wrap {
          position: relative;
          width: 112px;
          height: 112px;
          margin: 0 auto 0.85rem;
        }
        .kiosk-success-photo-wrap::before {
          content: '';
          position: absolute;
          inset: -10px;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(16, 185, 129, 0.35), transparent 70%);
          z-index: 0;
        }
        .kiosk-success-dot {
          position: absolute;
          width: 0.45rem;
          height: 0.45rem;
          border-radius: 9999px;
          animation: kiosk-confetti-pop 700ms ease-out both;
          z-index: 2;
        }
        .kiosk-success-photo {
          position: relative;
          z-index: 1;
          width: 112px;
          height: 112px;
          border-radius: 9999px;
          object-fit: cover;
          border: 3px solid rgba(255, 255, 255, 0.9);
          background: #1e293b;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.35), 0 12px 32px rgba(0, 0, 0, 0.35);
        }
        .kiosk-success-photo-fallback {
          position: relative;
          z-index: 1;
          width: 112px;
          height: 112px;
          border-radius: 9999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(145deg, #1e3a5f, #0f172a);
          color: #d8b15a;
          font-size: 2.25rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          border: 3px solid rgba(255, 255, 255, 0.9);
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.35), 0 12px 32px rgba(0, 0, 0, 0.35);
        }
        .kiosk-success-welcome {
          font-size: 1.35rem;
          font-weight: 700;
          color: #34d399;
          letter-spacing: 0.01em;
        }
        .kiosk-success-name {
          margin-top: 0.2rem;
          font-size: 1.85rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #fff;
          line-height: 1.15;
        }
        .kiosk-success-clocked {
          margin-top: 0.55rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          font-size: 0.92rem;
          color: #d8b15a;
        }
        .kiosk-success-clocked strong {
          color: #34d399;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .kiosk-success-divider {
          margin: 1.15rem 0 0.85rem;
          border: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .kiosk-success-meetings-label {
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #94a3b8;
          margin-bottom: 0.55rem;
        }
        .kiosk-success-meetings {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          text-align: left;
          max-height: 11.5rem;
          overflow-y: auto;
        }
        .kiosk-success-meeting {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.55rem 0.7rem;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .kiosk-success-meeting-time {
          flex-shrink: 0;
          width: 2.75rem;
          font-size: 0.82rem;
          font-weight: 700;
          color: #d8b15a;
          font-variant-numeric: tabular-nums;
        }
        .kiosk-success-meeting-dot {
          width: 0.45rem;
          height: 0.45rem;
          border-radius: 9999px;
          flex-shrink: 0;
        }
        .kiosk-success-meeting-body {
          min-width: 0;
          flex: 1 1 auto;
        }
        .kiosk-success-meeting-title {
          font-size: 0.88rem;
          font-weight: 600;
          color: #f8fafc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kiosk-success-meeting-loc {
          font-size: 0.72rem;
          color: #94a3b8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kiosk-success-meeting-icon {
          width: 1.1rem;
          height: 1.1rem;
          color: #94a3b8;
          flex-shrink: 0;
        }
        .kiosk-success-empty-meetings {
          font-size: 0.85rem;
          color: #94a3b8;
          padding: 0.35rem 0 0.15rem;
        }
        .kiosk-success-footer-msg {
          margin-top: 1rem;
          font-size: 0.95rem;
          font-weight: 500;
          color: rgba(248, 250, 252, 0.92);
        }
        .kiosk-success-timer {
          margin-top: 0.85rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
        }
        .kiosk-success-timer-ring {
          position: relative;
          width: 3.25rem;
          height: 3.25rem;
        }
        .kiosk-success-timer-num {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.05rem;
          font-weight: 700;
          color: #fff;
          font-variant-numeric: tabular-nums;
        }
        .kiosk-success-timer-label {
          font-size: 0.68rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #94a3b8;
        }
        .kiosk-success-now {
          margin-top: 0.65rem;
          font-size: 1.35rem;
          font-weight: 700;
          color: #fff;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
        }

        /*
          Primary target: ~10" tablet kiosk (landscape ~1024×768–1366×800).
          QR stays dominant; chrome stays readable at arm's length but compact.
        */
        .kiosk-header {
          padding-block: 0.65rem;
          padding-inline: max(1rem, env(safe-area-inset-left)) max(1rem, env(safe-area-inset-right));
          align-items: flex-start;
        }
        .kiosk-logo {
          height: 3.25rem;
        }
        .kiosk-clock {
          font-size: 2.6rem;
          line-height: 1.1;
        }
        .kiosk-date {
          font-size: 1.15rem;
        }
        .kiosk-weather {
          margin-top: 0.45rem;
          font-size: 0.95rem;
          line-height: 1.25;
          color: rgba(248, 250, 252, 0.9);
        }
        .kiosk-weather-detail {
          margin-top: 0.15rem;
          font-size: 0.78rem;
          color: var(--kiosk-muted);
        }
        .kiosk-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
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
          padding-top: 0.45rem;
          flex-shrink: 0;
        }
        .kiosk-countdown {
          width: 5rem;
          height: 5rem;
          flex-shrink: 0;
        }
        .kiosk-countdown-num {
          font-size: 1.35rem;
        }
        .kiosk-main {
          padding-bottom: 2.75rem;
          min-height: 0;
        }
        .kiosk-center {
          display: flex;
          min-width: 0;
          min-height: 0;
          flex: 1 1 auto;
          flex-direction: column;
          width: 100%;
          overflow: hidden;
        }
        .kiosk-info-strip {
          width: min(920px, 100%);
          margin: 0.75rem auto 0;
          border-radius: 18px;
          border: none;
          background: rgba(8, 16, 34, 0.82);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          padding: 0.85rem 1rem;
          display: grid;
          grid-template-columns: repeat(var(--kiosk-info-cols, 3), minmax(0, 1fr));
          gap: 0;
          flex: 0 0 auto;
          position: relative;
          z-index: 5;
        }
        .kiosk-info-col {
          min-width: 0;
          padding: 0.15rem 0.9rem;
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .kiosk-info-col + .kiosk-info-col {
          border-left: 1px solid rgba(255, 255, 255, 0.12);
        }
        .kiosk-info-label {
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--kiosk-gold);
        }
        .kiosk-info-item {
          display: flex;
          align-items: flex-start;
          gap: 0.65rem;
          min-width: 0;
        }
        .kiosk-info-icon {
          width: 1.85rem;
          height: 1.85rem;
          flex-shrink: 0;
          color: var(--kiosk-gold);
          margin-top: 0.05rem;
        }
        .kiosk-info-text {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
        }
        .kiosk-info-primary {
          font-size: 0.95rem;
          font-weight: 700;
          line-height: 1.25;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kiosk-info-secondary {
          font-size: 0.82rem;
          line-height: 1.3;
          color: var(--kiosk-gold);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kiosk-info-empty {
          font-size: 0.82rem;
          color: var(--kiosk-muted);
          line-height: 1.3;
        }
        .kiosk-info-meetings {
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          min-width: 0;
        }
        .kiosk-info-meeting-row {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          min-width: 0;
          font-size: 0.82rem;
          line-height: 1.25;
          color: rgba(248, 250, 252, 0.92);
        }
        .kiosk-info-meeting-type-badge {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.12rem 0.38rem;
          border-radius: 9999px;
          font-size: 0.58rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          line-height: 1;
        }
        .kiosk-info-meeting-row.is-current {
          color: #fff;
          font-weight: 700;
        }
        .kiosk-info-meeting-row.is-past {
          opacity: 0.62;
        }
        .kiosk-info-meeting-time {
          flex-shrink: 0;
          color: var(--kiosk-gold);
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .kiosk-info-meeting-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .kiosk-info-col-clickable {
          cursor: pointer;
          border: none;
          outline: none;
          background: transparent;
          border-radius: 12px;
          transition: background 160ms ease, transform 120ms ease;
        }
        .kiosk-info-col-clickable:hover,
        .kiosk-info-col-clickable:focus,
        .kiosk-info-col-clickable:focus-visible {
          background: rgba(255, 255, 255, 0.05);
          outline: none;
        }
        .kiosk-info-col-clickable:active {
          transform: scale(0.99);
        }
        .kiosk-info-tap-hint {
          font-size: 0.68rem;
          color: var(--kiosk-muted);
          letter-spacing: 0.06em;
        }

        .kiosk-meetings-screen {
          position: fixed;
          inset: 0;
          z-index: 90;
          display: flex;
          flex-direction: column;
          padding: max(0.85rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
          background:
            radial-gradient(ellipse 70% 45% at 50% 0%, rgba(74, 110, 190, 0.32), transparent 58%),
            linear-gradient(180deg, #0a1630 0%, #050d1c 48%, #02060f 100%);
          color: #f8fafc;
          animation: kiosk-success-in 260ms ease-out;
        }
        .kiosk-meetings-header {
          flex-shrink: 0;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 0.85rem;
        }
        .kiosk-meetings-title {
          font-size: clamp(1.5rem, 3.2vw, 2.1rem);
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #fff;
        }
        .kiosk-meetings-subtitle {
          margin-top: 0.2rem;
          font-size: 0.95rem;
          color: var(--kiosk-muted);
        }
        .kiosk-meetings-count {
          flex-shrink: 0;
          padding: 0.45rem 0.75rem;
          border-radius: 9999px;
          background: rgba(216, 177, 90, 0.14);
          border: none;
          color: var(--kiosk-gold);
          font-size: 0.82rem;
          font-weight: 700;
        }
        .kiosk-meetings-table-wrap {
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
          border-radius: 16px;
          border: none;
          background: rgba(8, 16, 34, 0.78);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .kiosk-meetings-table-wrap::-webkit-scrollbar {
          display: none;
        }
        .kiosk-meetings-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.98rem;
        }
        .kiosk-meetings-table thead {
          position: sticky;
          top: 0;
          z-index: 2;
          background: rgba(12, 22, 44, 0.98);
        }
        .kiosk-meetings-table th {
          padding: 0.75rem 0.85rem;
          text-align: left;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--kiosk-gold);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          white-space: nowrap;
        }
        .kiosk-meetings-table td {
          padding: 0.72rem 0.85rem;
          vertical-align: middle;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          color: rgba(248, 250, 252, 0.94);
          line-height: 1.4;
        }
        .kiosk-meetings-table tbody tr:last-child td {
          border-bottom: none;
        }
        .kiosk-meetings-table tbody tr.is-current {
          background: rgba(52, 211, 153, 0.1);
        }
        .kiosk-meetings-table tbody tr.is-current td:first-child {
          box-shadow: inset 3px 0 0 #34d399;
        }
        .kiosk-meetings-table tbody tr.is-past {
          opacity: 0.65;
        }
        .kiosk-meetings-table .col-time {
          width: 5.25rem;
        }
        .kiosk-meetings-time-value {
          display: block;
          font-size: 1.08rem;
          font-weight: 800;
          color: var(--kiosk-gold);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          line-height: 1.15;
        }
        .kiosk-meetings-type-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-top: 0.32rem;
          padding: 0.2rem 0.5rem;
          border-radius: 9999px;
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          line-height: 1.1;
          white-space: nowrap;
        }
        .kiosk-meetings-table .col-lead {
          min-width: 9rem;
        }
        .kiosk-meetings-lead {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .kiosk-meetings-table .col-lead-num {
          display: block;
          font-size: 0.84rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: var(--kiosk-gold);
          line-height: 1.2;
        }
        .kiosk-meetings-table .col-lead-name {
          font-size: 1rem;
          font-weight: 700;
          color: #fff;
          line-height: 1.25;
        }
        .kiosk-meetings-table .col-participants {
          min-width: 11rem;
        }
        .kiosk-meetings-participants-list {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .kiosk-meetings-participant {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
        }
        .kiosk-meetings-participant-photo,
        .kiosk-meetings-participant-fallback {
          width: 2.65rem;
          height: 2.65rem;
          border-radius: 9999px;
          flex-shrink: 0;
        }
        .kiosk-meetings-participant-photo {
          object-fit: cover;
          background: #1e293b;
        }
        .kiosk-meetings-participant-fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(145deg, #1e3a5f, #0f172a);
          color: var(--kiosk-gold);
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.03em;
        }
        .kiosk-meetings-participant-name {
          font-size: 0.92rem;
          font-weight: 600;
          color: rgba(248, 250, 252, 0.94);
          line-height: 1.25;
        }
        .kiosk-meetings-table .col-location {
          min-width: 8rem;
          font-size: 0.92rem;
          color: rgba(248, 250, 252, 0.88);
        }
        .kiosk-meetings-empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          color: var(--kiosk-muted);
          font-size: 1rem;
          padding: 2rem 1rem;
        }
        .kiosk-meetings-back {
          flex-shrink: 0;
          margin-top: 0.85rem;
          width: 100%;
          min-height: 3.4rem;
          border-radius: 18px;
          border: none;
          outline: none;
          background: linear-gradient(180deg, rgba(216, 177, 90, 0.22), rgba(216, 177, 90, 0.1));
          color: #fff;
          font-size: 1.05rem;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.55rem;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
        }
        .kiosk-meetings-back:focus,
        .kiosk-meetings-back:focus-visible {
          outline: none;
        }
        .kiosk-meetings-back:active {
          transform: scale(0.99);
        }
        .kiosk-meetings-back-icon {
          width: 1.35rem;
          height: 1.35rem;
        }
        .kiosk-meetings-idle-hint {
          margin-top: 0.45rem;
          text-align: center;
          font-size: 0.72rem;
          color: var(--kiosk-muted);
          letter-spacing: 0.04em;
        }

        @media (max-width: 820px) {
          .kiosk-meetings-table .col-location {
            display: none;
          }
          .kiosk-meetings-table th:nth-child(4),
          .kiosk-meetings-table td:nth-child(4) {
            display: none;
          }
        }

        @media (max-width: 700px) {
          .kiosk-info-strip {
            grid-template-columns: 1fr;
            gap: 0.75rem;
            padding: 0.75rem;
          }
          .kiosk-info-col + .kiosk-info-col {
            border-left: none;
            border-top: 1px solid rgba(255, 255, 255, 0.12);
            padding-top: 0.75rem;
          }
        }

        .kiosk-qr-slot {
          flex: 1 1 0;
          min-height: 0;
          min-width: 0;
          width: 100%;
          display: grid;
          place-items: center;
          container-type: size;
          padding: 4px 4px 0;
          overflow: hidden;
        }
        .kiosk-qr-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          /* Account for camera hint + office label so the square QR fits above the strip */
          width: min(100cqi, calc(100cqb - 3.75rem), 480px);
          max-width: 100%;
        }
        @supports not (width: 1cqi) {
          .kiosk-qr-block {
            width: min(68vw, 48vh, 480px);
          }
        }
        .kiosk-qr-shell {
          position: relative;
          width: 100%;
          aspect-ratio: 1 / 1;
          z-index: 1;
        }
        .kiosk-scan-ring {
          position: absolute;
          inset: -4px;
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

        .kiosk-scan-hint {
          margin: 0 0 0.75rem;
          max-width: 22rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.4rem;
          text-align: center;
          font-size: 0.82rem;
          line-height: 1.35;
          font-weight: 500;
          letter-spacing: 0.02em;
          color: var(--kiosk-muted);
        }
        .kiosk-scan-hint-icon {
          width: 1.1rem;
          height: 1.1rem;
          flex-shrink: 0;
          color: var(--kiosk-gold);
        }

        /* 10" landscape sweet spot (iPad / Android tablets) */
        @media (orientation: landscape) and (max-height: 900px) and (min-width: 900px) {
          .kiosk-header { padding-block: 0.55rem; }
          .kiosk-logo { height: 3.35rem; }
          .kiosk-clock { font-size: 2.75rem; }
          .kiosk-date { font-size: 1.2rem; }
          .kiosk-title { font-size: 2rem; margin-top: 0.35rem; }
          .kiosk-sub { font-size: 1rem; }
          .kiosk-countdown { width: 5rem; height: 5rem; }
          .kiosk-countdown-num { font-size: 1.35rem; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 3.75rem), 460px); }
          .kiosk-qr-frame { padding: 14px; border-radius: 24px; }
          .kiosk-main { padding-bottom: 2.75rem; }
        }

        /* Shorter 10" landscape (~768–800 CSS height) — keep QR large */
        @media (orientation: landscape) and (max-height: 820px) {
          .kiosk-header { padding-block: 0.45rem; }
          .kiosk-logo { height: 3rem; }
          .kiosk-clock { font-size: 2.45rem; }
          .kiosk-date { font-size: 1.1rem; }
          .kiosk-title { font-size: 1.7rem; margin-top: 0.25rem; }
          .kiosk-sub { font-size: 0.9rem; margin-top: 0.2rem; }
          .kiosk-countdown { width: 4.5rem; height: 4.5rem; }
          .kiosk-countdown-num { font-size: 1.25rem; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 3.5rem), 420px); }
          .kiosk-qr-frame { padding: 12px; }
          .kiosk-main { padding-bottom: 2.5rem; }
        }

        /* Very short landscape — drop subtitle before shrinking QR further */
        @media (orientation: landscape) and (max-height: 740px) {
          .kiosk-sub { display: none; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 2.75rem), 380px); }
        }

        /* 10" portrait (tablet upright) — QR can use more width */
        @media (orientation: portrait) and (max-width: 900px) {
          .kiosk-logo { height: 3.5rem; }
          .kiosk-clock { font-size: 2.85rem; }
          .kiosk-date { font-size: 1.25rem; }
          .kiosk-title { font-size: 2.1rem; }
          .kiosk-sub { font-size: 1.05rem; }
          .kiosk-countdown { width: 5rem; height: 5rem; }
          .kiosk-countdown-num { font-size: 1.35rem; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 3.75rem), 480px); }
        }

        /* Large desktop preview — don't let chrome balloon; keep QR capped */
        @media (min-height: 960px) and (min-width: 1200px) {
          .kiosk-logo { height: 3.75rem; }
          .kiosk-clock { font-size: 3rem; }
          .kiosk-date { font-size: 1.3rem; }
          .kiosk-title { font-size: 2.5rem; }
          .kiosk-sub { font-size: 1.1rem; }
          .kiosk-countdown { width: 5.5rem; height: 5.5rem; }
          .kiosk-countdown-num { font-size: 1.5rem; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 3.75rem), 500px); }
        }
      `}</style>

      {successFlash ? (
        <div className="kiosk-success-backdrop" role="dialog" aria-live="polite" aria-label="Employee clocked in">
          <div className="kiosk-success-card">
            <div className="kiosk-success-photo-wrap">
              <span className="kiosk-success-dot" style={{ top: '8%', left: '4%', background: '#fb923c' }} />
              <span className="kiosk-success-dot" style={{ top: '2%', right: '18%', background: '#34d399' }} />
              <span className="kiosk-success-dot" style={{ bottom: '14%', left: '0%', background: '#60a5fa' }} />
              <span className="kiosk-success-dot" style={{ bottom: '6%', right: '6%', background: '#a78bfa' }} />
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
            </div>

            <p
              className="kiosk-success-welcome"
              style={successFlash.action === 'out' ? { color: '#fbbf24' } : undefined}
            >
              {successFlash.action === 'out' ? 'Goodbye' : 'Welcome'}
            </p>
            <p className="kiosk-success-name">{successFlash.employeeName || 'Employee'}</p>
            <p className="kiosk-success-clocked">
              <ClockIcon className="h-4 w-4" aria-hidden />
              <span>
                {successFlash.action === 'out' ? 'Clocked out at' : 'Clocked in at'}{' '}
                <strong
                  style={successFlash.action === 'out' ? { color: '#fbbf24' } : undefined}
                >
                  {formatClock(new Date(successFlash.at || Date.now()))}
                </strong>
              </span>
            </p>

            {successFlash.action === 'out' ? (
              <>
                <hr className="kiosk-success-divider" />
                <p className="kiosk-success-footer-msg" style={{ marginTop: '0.35rem' }}>
                  See you next time!
                </p>
              </>
            ) : (
              <>
                <hr className="kiosk-success-divider" />

                <p className="kiosk-success-meetings-label">Meetings today</p>
                {(successFlash.meetings?.length ?? 0) > 0 ? (
                  <div className="kiosk-success-meetings">
                    {successFlash.meetings?.map((m) => {
                      const MeetingIcon = m.isVirtual ? VideoCameraIcon : UserGroupIcon;
                      const dotColor = MEETING_DOT_COLORS[(m.colorIndex ?? 0) % MEETING_DOT_COLORS.length];
                      return (
                        <div key={m.id} className="kiosk-success-meeting">
                          <span className="kiosk-success-meeting-time">{m.time || '—'}</span>
                          <span className="kiosk-success-meeting-dot" style={{ background: dotColor }} />
                          <div className="kiosk-success-meeting-body">
                            <p className="kiosk-success-meeting-title">{m.title}</p>
                            {m.location ? (
                              <p className="kiosk-success-meeting-loc">{m.location}</p>
                            ) : null}
                          </div>
                          <MeetingIcon className="kiosk-success-meeting-icon" aria-hidden />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="kiosk-success-empty-meetings">No meetings scheduled today</p>
                )}

                <p className="kiosk-success-footer-msg">Have a productive day!</p>
              </>
            )}

            <div className="kiosk-success-timer" aria-label={`${welcomeSecondsLeft} seconds remaining`}>
              <div className="kiosk-success-timer-ring">
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 48 48" aria-hidden>
                  <circle
                    cx="24"
                    cy="24"
                    r="20"
                    fill="none"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="3.5"
                  />
                  <circle
                    cx="24"
                    cy="24"
                    r="20"
                    fill="none"
                    stroke={successFlash.action === 'out' ? '#fbbf24' : '#34d399'}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 20}
                    strokeDashoffset={2 * Math.PI * 20 * (1 - welcomeSecondsLeft / SUCCESS_FLASH_SEC)}
                    style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                  />
                </svg>
                <span className="kiosk-success-timer-num">{welcomeSecondsLeft}</span>
              </div>
              <span className="kiosk-success-timer-label">Closing</span>
            </div>

            <p className="kiosk-success-now">{formatClock(now)}</p>
          </div>
        </div>
      ) : null}

      {meetingsScreenOpen ? (
        <div
          className="kiosk-meetings-screen"
          role="dialog"
          aria-label="All meetings today"
          onTouchStart={resetMeetingsIdleTimer}
          onPointerDown={resetMeetingsIdleTimer}
        >
          <div className="kiosk-meetings-header">
            <div>
              <h2 className="kiosk-meetings-title">Meetings Today</h2>
              <p className="kiosk-meetings-subtitle">{formatDate(now)}</p>
            </div>
            <span className="kiosk-meetings-count">
              {meetingsLoading ? '…' : `${meetingsDetail.length} total`}
            </span>
          </div>

          {meetingsLoading ? (
            <div className="kiosk-meetings-empty">
              <span className="loading loading-spinner loading-lg text-slate-400" />
            </div>
          ) : meetingsDetail.length > 0 ? (
            <div className="kiosk-meetings-table-wrap">
              <table className="kiosk-meetings-table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Lead</th>
                    <th scope="col">Participants</th>
                    <th scope="col">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {meetingsDetail.map((m) => {
                    const typeStyle = MEETING_TYPE_STYLES[m.typeCode] || MEETING_TYPE_STYLES.other;
                    return (
                      <tr
                        key={m.id}
                        className={[m.isCurrent ? 'is-current' : '', m.isPast ? 'is-past' : ''].join(' ')}
                      >
                        <td className="col-time">
                          <span className="kiosk-meetings-time-value">{m.time || '—'}</span>
                          <span
                            className="kiosk-meetings-type-badge"
                            style={{
                              background: typeStyle.bg,
                              color: typeStyle.color,
                            }}
                          >
                            {typeStyle.label}
                          </span>
                        </td>
                        <td className="col-lead">
                          <div className="kiosk-meetings-lead">
                            {m.leadNumber ? (
                              <span className="col-lead-num">{m.leadNumber}</span>
                            ) : null}
                            <span className="col-lead-name">
                              {m.clientName || m.title || 'Meeting'}
                            </span>
                          </div>
                        </td>
                        <td className="col-participants">
                          {m.participants.length > 0 ? (
                            <div className="kiosk-meetings-participants-list">
                              {m.participants.map((participant) => (
                                <div
                                  key={`${m.id}-${participant.employeeId ?? participant.name}`}
                                  className="kiosk-meetings-participant"
                                >
                                  {participant.photoUrl ? (
                                    <img
                                      src={participant.photoUrl}
                                      alt=""
                                      className="kiosk-meetings-participant-photo"
                                    />
                                  ) : (
                                    <span className="kiosk-meetings-participant-fallback" aria-hidden>
                                      {participantInitials(participant.name)}
                                    </span>
                                  )}
                                  <span className="kiosk-meetings-participant-name">{participant.name}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="col-location">{m.location || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="kiosk-meetings-empty">
              {meetingsError || 'No meetings scheduled today'}
            </div>
          )}

          <button
            type="button"
            className="kiosk-meetings-back"
            onClick={closeMeetingsScreen}
            aria-label="Back to main screen"
          >
            <ArrowLeftIcon className="kiosk-meetings-back-icon" aria-hidden />
            Back to main screen
          </button>
          <p className="kiosk-meetings-idle-hint">Returns automatically after 15 seconds of inactivity</p>
        </div>
      ) : null}

      <header className="kiosk-header relative z-10 flex shrink-0 justify-between gap-3 px-4 sm:px-8">
        <img
          src="/DPLOGO1.png"
          alt="Decker Pex & Co. Lawoffice"
          className="kiosk-logo w-auto max-w-[42vw] object-contain opacity-95 drop-shadow"
        />
        <div className="kiosk-meta min-w-0 shrink-0">
          {showClockDate ? (
            <>
              <p className="kiosk-clock font-semibold tracking-tight text-white tabular-nums">
                {formatClock(now)}
              </p>
              <p className="kiosk-date mt-0.5 text-[var(--kiosk-muted)]">
                {formatDate(now)}
              </p>
            </>
          ) : null}
          {showWeather ? (
            <div className="kiosk-weather">
              {display?.weather ? (
                <>
                  <p className="inline-flex items-center justify-end gap-1.5">
                    <CloudIcon className="h-8 w-8 shrink-0 text-[var(--kiosk-gold)]" aria-hidden />
                    <span>
                      {display.weather.city}
                      {display.weather.temperatureC != null
                        ? ` · ${Math.round(display.weather.temperatureC)}°C`
                        : ''}
                    </span>
                  </p>
                  <p className="kiosk-weather-detail">{display.weather.label}</p>
                </>
              ) : (
                <p className="kiosk-weather-detail">Loading weather…</p>
              )}
            </div>
          ) : null}
        </div>
      </header>

      <main className="kiosk-main relative z-10 flex min-h-0 flex-1 flex-col items-stretch px-3 sm:px-8">
        <div className="kiosk-center">
          <div className="kiosk-qr-slot">
            <div className="flex flex-col items-center">
              <p className="kiosk-scan-hint">
                <DevicePhoneMobileIcon className="kiosk-scan-hint-icon" aria-hidden />
                Scan to clock in or clock out
              </p>
              <div className="kiosk-qr-block">
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
            </div>
          </div>

          {hasInfoStrip ? (
            <section
              className="kiosk-info-strip"
              aria-label="Office updates"
              style={{ ['--kiosk-info-cols' as string]: String(infoColCount) } as React.CSSProperties}
            >
              {showMeetings ? (
                <button
                  type="button"
                  className="kiosk-info-col kiosk-info-col-clickable text-left"
                  onClick={() => void openMeetingsScreen()}
                  aria-label="View all meetings today"
                >
                  <p className="kiosk-info-label">Next meeting</p>
                  {(display?.meetings?.length ?? 0) > 0 ? (
                    <div className="kiosk-info-item">
                      <CalendarDaysIcon className="kiosk-info-icon" aria-hidden />
                      <div className="kiosk-info-meetings">
                        {display?.meetings?.map((m) => {
                          const typeStyle =
                            MEETING_TYPE_STYLES[m.typeCode || 'other'] || MEETING_TYPE_STYLES.other;
                          const leadLabel = m.clientName || m.title || 'Meeting';
                          return (
                            <div
                              key={m.id}
                              className={[
                                'kiosk-info-meeting-row',
                                m.isCurrent ? 'is-current' : '',
                                m.isPast ? 'is-past' : '',
                              ].join(' ')}
                            >
                              <span className="kiosk-info-meeting-time">{m.time || '—'}</span>
                              <span
                                className="kiosk-info-meeting-type-badge"
                                style={{
                                  background: typeStyle.bg,
                                  color: typeStyle.color,
                                }}
                              >
                                {typeStyle.label}
                              </span>
                              <span className="kiosk-info-meeting-name">
                                {[leadLabel, m.leadNumber].filter(Boolean).join(' · ')}
                              </span>
                            </div>
                          );
                        })}
                        <span className="kiosk-info-tap-hint">Tap for full schedule →</span>
                      </div>
                    </div>
                  ) : (
                    <div className="kiosk-info-item">
                      <CalendarDaysIcon className="kiosk-info-icon" aria-hidden />
                      <div className="kiosk-info-text">
                        <p className="kiosk-info-empty">No meetings scheduled today</p>
                        <span className="kiosk-info-tap-hint">Tap to view schedule →</span>
                      </div>
                    </div>
                  )}
                </button>
              ) : null}

              {showAnnouncements ? (
                <div className="kiosk-info-col">
                  <p className="kiosk-info-label">Announcements</p>
                  {currentAnnouncement ? (
                    <div className="kiosk-info-item">
                      <MegaphoneIcon className="kiosk-info-icon" aria-hidden />
                      <div className="kiosk-info-text">
                        <p className="kiosk-info-primary">
                          {currentAnnouncement.title?.trim() || currentAnnouncement.body}
                        </p>
                        {currentAnnouncement.title?.trim() ? (
                          <p className="kiosk-info-secondary">{currentAnnouncement.body}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="kiosk-info-item">
                      <MegaphoneIcon className="kiosk-info-icon" aria-hidden />
                      <p className="kiosk-info-empty">No active announcements</p>
                    </div>
                  )}
                </div>
              ) : null}

              {showBirthdaysColumn && currentBirthday ? (
                <div className="kiosk-info-col">
                  <p className="kiosk-info-label">Birthdays</p>
                  <div className="kiosk-info-item">
                    <CakeIcon className="kiosk-info-icon" aria-hidden />
                    <div className="kiosk-info-text">
                      <p className="kiosk-info-primary">Happy Birthday</p>
                      <p className="kiosk-info-secondary">
                        {currentBirthday.name}
                        {(display?.birthdays?.length ?? 0) > 1
                          ? ` +${(display?.birthdays?.length ?? 1) - 1}`
                          : ''}
                        !
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="kiosk-footer mx-auto flex w-full shrink-0 flex-col items-center">
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
        </div>
      </main>

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[70vw] items-center gap-2.5 sm:bottom-5 sm:left-8">
        <UsersIcon className="h-5 w-5 shrink-0 text-[var(--kiosk-gold)] sm:h-6 sm:w-6" aria-hidden />
        <p className="text-sm font-medium text-white/90 sm:text-base">
          {display?.inOfficeCount ?? 0}{' '}
          {(display?.inOfficeCount ?? 0) === 1 ? 'employee' : 'employees'} in office
        </p>
      </div>
    </div>
  );
};

export default EntryKioskPage;
