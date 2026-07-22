import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  CakeIcon,
  CalendarDaysIcon,
  CloudIcon,
  EnvelopeIcon,
  MapPinIcon,
  MegaphoneIcon,
  PhoneIcon,
  SparklesIcon,
  UserGroupIcon,
  UsersIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import MorphingQrCode from '../components/MorphingQrCode';
import KioskDocumentShell from '../components/kiosk/KioskDocumentShell';
import KioskPairingScreen from '../components/kiosk/KioskPairingScreen';
import KioskWelcomeGoodbyeModal, {
  KIOSK_WELCOME_DURATION_MS,
  KIOSK_WELCOME_DURATION_SEC,
} from '../components/kiosk/KioskWelcomeGoodbyeModal';
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
import { useKioskImmersiveMode } from '../hooks/useKioskImmersiveMode';

const QR_RENDER_SIZE = 640;
const EVENT_POLL_MS = 1_400;
const DISPLAY_POLL_MS = 60_000;
const KIOSK_STATE_POLL_MS = 2_000;
const KIOSK_HEARTBEAT_MS = 30_000;
const KIOSK_SUCCESS_MS = KIOSK_WELCOME_DURATION_MS;
const KIOSK_SUCCESS_SEC = KIOSK_WELCOME_DURATION_SEC;
const DOCUMENT_DONE_MS = 5_000;
const MEETINGS_IDLE_MS = 15_000;
const MEETINGS_IDLE_SEC = Math.round(MEETINGS_IDLE_MS / 1000);
const UPDATES_CAROUSEL_MS = 10_000;
const KIOSK_PROMO_SRC = '/kiosk-promo-overlay.png';
const KIOSK_PROMO_INTERVAL_MS = 2 * 60 * 1000;
const KIOSK_PROMO_VISIBLE_MS = 20_000;

type UpdatesCarouselSlide =
  | {
      id: string;
      kind: 'staff';
      label: string;
      inOffice: number;
      unavailable: number;
    }
  | {
      id: string;
      kind: 'meetingsByDept';
      label: string;
      rows: Array<{ department: string; count: number }>;
    }
  | {
      id: string;
      kind: 'holidays';
      label: string;
      names: string[];
    }
  | {
      id: string;
      kind: 'birthdays';
      label: string;
      names: string[];
    }
  | {
      id: string;
      kind: 'announcement';
      label: string;
      title: string;
      body: string;
    }
  | {
      id: string;
      kind: 'contacts';
      label: string;
      contacts: Array<{
        id: number;
        name: string;
        photoUrl: string | null;
        phone: string | null;
        email: string | null;
      }>;
    };

type DeviceUiMode = 'checking' | 'unpaired' | 'attendance' | 'document' | 'success' | 'locked';

const KioskFullscreenGate: React.FC<{
  visible: boolean;
  canInstall: boolean;
  showInstallHint: boolean;
  onEnter: () => void;
  onInstall: () => void;
}> = ({ visible, canInstall, showInstallHint, onEnter, onInstall }) => {
  if (!visible) {
    if (!showInstallHint) return null;
    return (
      <div className="fixed bottom-4 left-1/2 z-[99998] flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col gap-2 rounded-2xl border border-white/15 bg-[#0a1628]/95 px-4 py-3 text-center text-white shadow-2xl backdrop-blur">
        <p className="text-sm text-slate-200">
          Chrome still shows a bottom bar in a normal tab. Install this kiosk as an app for true fullscreen.
        </p>
        <button
          type="button"
          className="rounded-full border border-[rgba(216,177,90,0.55)] bg-[rgba(216,177,90,0.18)] px-4 py-2 text-sm font-semibold text-[#f5e6c0]"
          onClick={onInstall}
        >
          {canInstall ? 'Install Entry Kiosk app' : 'How to install'}
        </button>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-center gap-5 bg-[#0a1628]/95 px-8 text-center text-white">
      <span className="text-2xl font-semibold tracking-tight">Enter kiosk fullscreen</span>
      <span className="max-w-md text-sm text-slate-300 leading-relaxed">
        Chrome on tablets only fully hides the bottom bar when this page runs as an installed app
        (or after you allow fullscreen below).
      </span>
      <button
        type="button"
        className="rounded-full border border-white/25 bg-white/10 px-6 py-3 text-sm font-semibold text-white"
        onClick={onEnter}
      >
        Tap for fullscreen
      </button>
      <button
        type="button"
        className="rounded-full border border-[rgba(216,177,90,0.55)] bg-[rgba(216,177,90,0.18)] px-6 py-3 text-sm font-semibold text-[#f5e6c0]"
        onClick={onInstall}
      >
        {canInstall ? 'Install as kiosk app (recommended)' : 'Install instructions (recommended)'}
      </button>
    </div>
  );
};

const MEETING_TYPE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  im: { bg: 'rgba(245, 158, 11, 0.18)', color: '#fbbf24', label: 'IM' },
  active: { bg: 'rgba(34, 197, 94, 0.14)', color: '#4ade80', label: 'Active' },
  potential: { bg: 'rgba(96, 165, 250, 0.14)', color: '#60a5fa', label: 'Potential' },
  other: { bg: 'rgba(148, 163, 184, 0.14)', color: '#cbd5e1', label: 'Meeting' },
};

function participantInitials(name: string) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts
    .slice(0, 2)
    .map((part) => {
      const ch = [...part].find((c) => /[\p{L}\p{N}]/u.test(c));
      return ch ? ch.toUpperCase() : '';
    })
    .filter(Boolean);
  return letters.join('') || '?';
}

const PARTICIPANT_AVATAR_COLORS = [
  { bg: '#2563eb', fg: '#eff6ff' }, // blue
  { bg: '#7c3aed', fg: '#f5f3ff' }, // violet
  { bg: '#db2777', fg: '#fdf2f8' }, // pink
  { bg: '#059669', fg: '#ecfdf5' }, // emerald
  { bg: '#d97706', fg: '#fffbeb' }, // amber
  { bg: '#0891b2', fg: '#ecfeff' }, // cyan
  { bg: '#dc2626', fg: '#fef2f2' }, // red
  { bg: '#4f46e5', fg: '#eef2ff' }, // indigo
  { bg: '#ca8a04', fg: '#fefce8' }, // yellow
  { bg: '#0d9488', fg: '#f0fdfa' }, // teal
];

function participantAvatarColor(seed: string) {
  const text = String(seed || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return PARTICIPANT_AVATAR_COLORS[hash % PARTICIPANT_AVATAR_COLORS.length];
}

function parseMeetingTimeMinutes(time: string | null | undefined): number | null {
  const raw = String(time || '').trim();
  if (!raw) return null;
  // Prefer HH:MM at the start; also accept values like "17:45:00".
  const match = raw.match(/(?:^|T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour === 24) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function nowMinutesJerusalem(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  let hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  if (hour === 24) hour = 0;
  return hour * 60 + minute;
}

const CURRENT_MEETING_WINDOW_MINUTES = 30;

type MeetingCardStatus = EntryKioskMeetingDetail & {
  isUpcoming?: boolean;
};

function withLiveMeetingStatus(meetings: EntryKioskMeetingDetail[], now: Date): MeetingCardStatus[] {
  const nowMinutes = nowMinutesJerusalem(now);
  return meetings
    .map((meeting) => {
      const startMinutes = parseMeetingTimeMinutes(meeting.time);
      if (startMinutes == null) {
        return { ...meeting, isCurrent: false, isPast: false, isUpcoming: false };
      }
      const isCurrent =
        startMinutes <= nowMinutes &&
        startMinutes >= nowMinutes - CURRENT_MEETING_WINDOW_MINUTES;
      const isUpcoming =
        !isCurrent &&
        startMinutes > nowMinutes &&
        startMinutes <= nowMinutes + CURRENT_MEETING_WINDOW_MINUTES;
      const isPast = startMinutes < nowMinutes - CURRENT_MEETING_WINDOW_MINUTES;
      return {
        ...meeting,
        isCurrent,
        isPast,
        isUpcoming,
      };
    })
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
}

function MeetingParticipantAvatar({
  name,
  photoUrl,
  employeeId,
}: {
  name: string;
  photoUrl?: string | null;
  employeeId?: number | null;
}) {
  const trimmedPhoto = String(photoUrl || '').trim();
  const [imageFailed, setImageFailed] = useState(!trimmedPhoto);
  const initials = participantInitials(name);
  const color = participantAvatarColor(`${employeeId ?? ''}:${name}`);

  useEffect(() => {
    setImageFailed(!trimmedPhoto);
  }, [trimmedPhoto]);

  if (!imageFailed && trimmedPhoto) {
    return (
      <img
        src={trimmedPhoto}
        alt=""
        className="kiosk-meetings-participant-photo"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className="kiosk-meetings-participant-fallback"
      aria-hidden
      style={{ background: color.bg, color: color.fg }}
    >
      {initials}
    </span>
  );
}

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
  const {
    needsTapToFullscreen,
    needsInstallForTrueFullscreen,
    canInstall,
    isPwa,
    enterFullscreen,
    installKioskApp,
  } = useKioskImmersiveMode();
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotateInMs, setRotateInMs] = useState(15_000);
  const [totalRotateMs, setTotalRotateMs] = useState(15_000);
  const [secondsLeft, setSecondsLeft] = useState(15);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(true);
  const [successFlash, setSuccessFlash] = useState<ClockInKioskRecentEvent | null>(null);
  const [welcomeSecondsLeft, setWelcomeSecondsLeft] = useState(KIOSK_SUCCESS_SEC);
  const [display, setDisplay] = useState<EntryKioskDisplayResponse | null>(null);
  const [updatesCarouselIndex, setUpdatesCarouselIndex] = useState(0);
  const [meetingsScreenOpen, setMeetingsScreenOpen] = useState(false);
  const [meetingsDetail, setMeetingsDetail] = useState<EntryKioskMeetingDetail[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  const [meetingsIdleSecondsLeft, setMeetingsIdleSecondsLeft] = useState(MEETINGS_IDLE_SEC);
  const [deviceUiMode, setDeviceUiMode] = useState<DeviceUiMode>('checking');
  const [documentSession, setDocumentSession] = useState<{
    sessionId: string;
    resourceType: 'digital_contract' | 'poa' | 'payment';
  } | null>(null);
  const [kioskSuccessMessage, setKioskSuccessMessage] = useState<string | null>(null);
  const [promoVisible, setPromoVisible] = useState(false);

  const lastEventIdRef = useRef<string | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const welcomeTickRef = useRef<number | null>(null);
  const meetingsIdleTimerRef = useRef<number | null>(null);
  const meetingsIdleTickRef = useRef<number | null>(null);
  const kioskSuccessTimerRef = useRef<number | null>(null);
  const promoNextShowAtRef = useRef<number | null>(null);
  const promoHideAtRef = useRef<number | null>(null);

  const dismissSuccessFlash = useCallback(() => {
    if (successTimerRef.current) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    if (welcomeTickRef.current) {
      window.clearInterval(welcomeTickRef.current);
      welcomeTickRef.current = null;
    }
    setSuccessFlash(null);
    setWelcomeSecondsLeft(KIOSK_SUCCESS_SEC);
  }, []);
  const deviceUiModeRef = useRef<DeviceUiMode>('checking');
  const meetingsScreenOpenRef = useRef(false);
  const successFlashActiveRef = useRef(false);
  const meetingsTableWrapRef = useRef<HTMLDivElement | null>(null);
  const meetingsScrollDoneRef = useRef(false);

  useEffect(() => {
    deviceUiModeRef.current = deviceUiMode;
  }, [deviceUiMode]);

  useEffect(() => {
    meetingsScreenOpenRef.current = meetingsScreenOpen;
  }, [meetingsScreenOpen]);

  useEffect(() => {
    successFlashActiveRef.current = Boolean(successFlash) || deviceUiMode === 'success';
  }, [successFlash, deviceUiMode]);

  const isPromoIdleScreen =
    deviceUiMode === 'attendance' &&
    !meetingsScreenOpen &&
    !successFlash;

  const canShowPromoNow = useCallback(() => {
    return (
      deviceUiModeRef.current === 'attendance' &&
      !meetingsScreenOpenRef.current &&
      !successFlashActiveRef.current
    );
  }, []);

  const dismissPromo = useCallback(() => {
    setPromoVisible(false);
    promoHideAtRef.current = null;
    promoNextShowAtRef.current = Date.now() + KIOSK_PROMO_INTERVAL_MS;
  }, []);

  useEffect(() => {
    if (!isPromoIdleScreen) {
      setPromoVisible(false);
      promoHideAtRef.current = null;
      return;
    }

    if (promoNextShowAtRef.current == null) {
      promoNextShowAtRef.current = Date.now() + KIOSK_PROMO_INTERVAL_MS;
    }

    const tick = () => {
      const now = Date.now();
      if (!canShowPromoNow()) {
        if (promoHideAtRef.current != null) {
          setPromoVisible(false);
          promoHideAtRef.current = null;
          promoNextShowAtRef.current = now + KIOSK_PROMO_INTERVAL_MS;
        }
        return;
      }

      if (promoHideAtRef.current != null) {
        if (now >= promoHideAtRef.current) {
          setPromoVisible(false);
          promoHideAtRef.current = null;
          promoNextShowAtRef.current = now + KIOSK_PROMO_INTERVAL_MS;
        }
        return;
      }

      const nextShowAt = promoNextShowAtRef.current ?? now + KIOSK_PROMO_INTERVAL_MS;
      if (now >= nextShowAt) {
        setPromoVisible(true);
        promoHideAtRef.current = now + KIOSK_PROMO_VISIBLE_MS;
        promoNextShowAtRef.current = null;
      }
    };

    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [isPromoIdleScreen, canShowPromoNow]);

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
    }, DOCUMENT_DONE_MS);
  }, []);

  const handleKioskDocumentCancelled = useCallback(() => {
    setDocumentSession(null);
    setDeviceUiMode('attendance');
  }, []);

  const handleKioskPaired = useCallback(() => {
    setDeviceUiMode('checking');
    void fetchKioskState().then(applyKioskState);
  }, [applyKioskState]);

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
    return () => {
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
      if (welcomeTickRef.current) window.clearInterval(welcomeTickRef.current);
      if (meetingsIdleTimerRef.current) window.clearTimeout(meetingsIdleTimerRef.current);
      if (meetingsIdleTickRef.current) window.clearInterval(meetingsIdleTickRef.current);
    };
  }, []);

  const closeMeetingsScreen = useCallback(() => {
    setMeetingsScreenOpen(false);
    if (meetingsIdleTimerRef.current) {
      window.clearTimeout(meetingsIdleTimerRef.current);
      meetingsIdleTimerRef.current = null;
    }
    if (meetingsIdleTickRef.current) {
      window.clearInterval(meetingsIdleTickRef.current);
      meetingsIdleTickRef.current = null;
    }
    setMeetingsIdleSecondsLeft(MEETINGS_IDLE_SEC);
  }, []);

  const resetMeetingsIdleTimer = useCallback(() => {
    if (!meetingsScreenOpen) return;
    if (meetingsIdleTimerRef.current) window.clearTimeout(meetingsIdleTimerRef.current);
    if (meetingsIdleTickRef.current) window.clearInterval(meetingsIdleTickRef.current);
    setMeetingsIdleSecondsLeft(MEETINGS_IDLE_SEC);
    meetingsIdleTickRef.current = window.setInterval(() => {
      setMeetingsIdleSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    meetingsIdleTimerRef.current = window.setTimeout(() => {
      closeMeetingsScreen();
    }, MEETINGS_IDLE_MS);
  }, [closeMeetingsScreen, meetingsScreenOpen]);

  const openMeetingsScreen = useCallback(async () => {
    setMeetingsScreenOpen(true);
    setMeetingsIdleSecondsLeft(MEETINGS_IDLE_SEC);
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
      if (meetingsIdleTickRef.current) window.clearInterval(meetingsIdleTickRef.current);
    };
  }, [meetingsScreenOpen, resetMeetingsIdleTimer]);

  useEffect(() => {
    let cancelled = false;

    const applyEvent = (event: ClockInKioskRecentEvent | null | undefined) => {
      if (!event?.id || event.id === lastEventIdRef.current) return;
      lastEventIdRef.current = event.id;
      setSuccessFlash(event);
      setWelcomeSecondsLeft(KIOSK_SUCCESS_SEC);
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
      if (welcomeTickRef.current) window.clearInterval(welcomeTickRef.current);
      welcomeTickRef.current = window.setInterval(() => {
        setWelcomeSecondsLeft((prev) => Math.max(0, prev - 1));
      }, 1000);
      successTimerRef.current = window.setTimeout(() => {
        setSuccessFlash(null);
        setWelcomeSecondsLeft(KIOSK_SUCCESS_SEC);
        if (welcomeTickRef.current) {
          window.clearInterval(welcomeTickRef.current);
          welcomeTickRef.current = null;
        }
      }, KIOSK_SUCCESS_MS);
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

  const sortedMeetingsDetail = useMemo(
    () => withLiveMeetingStatus(meetingsDetail, now),
    [meetingsDetail, now],
  );
  const currentMeetingsCount = useMemo(
    () => sortedMeetingsDetail.filter((m) => m.isCurrent).length,
    [sortedMeetingsDetail],
  );
  const meetingsScrollAnchorId = useMemo(() => {
    const current = sortedMeetingsDetail.find((m) => m.isCurrent);
    if (current) return current.id;
    const soon = sortedMeetingsDetail.find((m) => m.isUpcoming);
    if (soon) return soon.id;
    const upcoming = sortedMeetingsDetail.find((m) => !m.isPast);
    return upcoming?.id ?? null;
  }, [sortedMeetingsDetail]);

  useEffect(() => {
    if (!meetingsScreenOpen) {
      meetingsScrollDoneRef.current = false;
      return;
    }
    if (meetingsLoading || meetingsScrollDoneRef.current || meetingsScrollAnchorId == null) {
      return;
    }

    const scrollToAnchor = () => {
      const wrap = meetingsTableWrapRef.current;
      const row = wrap?.querySelector(
        `[data-meeting-id="${meetingsScrollAnchorId}"]`,
      ) as HTMLElement | null;
      if (!row || !wrap) return false;
      const delta =
        row.getBoundingClientRect().top -
        wrap.getBoundingClientRect().top +
        wrap.scrollTop -
        16;
      wrap.scrollTo({ top: Math.max(0, delta), behavior: 'smooth' });
      meetingsScrollDoneRef.current = true;
      return true;
    };

    const frame = window.requestAnimationFrame(() => {
      if (scrollToAnchor()) return;
      window.setTimeout(() => {
        scrollToAnchor();
      }, 120);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [meetingsScreenOpen, meetingsLoading, meetingsScrollAnchorId, sortedMeetingsDetail.length]);

  const meetingsIdleProgress = useMemo(() => {
    return Math.min(1, Math.max(0, meetingsIdleSecondsLeft / MEETINGS_IDLE_SEC));
  }, [meetingsIdleSecondsLeft]);
  const meetingsIdleRingR = 18;
  const meetingsIdleRingC = 2 * Math.PI * meetingsIdleRingR;
  const meetingsIdleRingOffset = meetingsIdleRingC * (1 - meetingsIdleProgress);

  const ringR = 50;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - progress);

  const kioskSettings = display?.settings;
  const showClockDate = kioskSettings?.showClockDate !== false;
  const showWeather = Boolean(kioskSettings?.showWeather);
  const showMeetings = Boolean(kioskSettings?.showMeetingsToday);
  const showAnnouncements = Boolean(kioskSettings?.showAnnouncements);
  const showBirthdays = Boolean(kioskSettings?.showBirthdays);
  const showUpdatesCarousel = showAnnouncements || showBirthdays;
  const infoColCount = (showMeetings ? 1 : 0) + (showUpdatesCarousel ? 1 : 0);
  const hasInfoStrip = infoColCount > 0;

  const updatesCarouselSlides = useMemo((): UpdatesCarouselSlide[] => {
    if (!showUpdatesCarousel) return [];
    const slides: UpdatesCarouselSlide[] = [];

    if (showAnnouncements) {
      const announcements = display?.announcements || [];
      if (announcements.length > 0) {
        announcements.forEach((ann, index) => {
          const title = String(ann.title || '').trim();
          const body = String(ann.body || '').trim();
          slides.push({
            id: `announcement-${ann.id ?? index}`,
            kind: 'announcement',
            label: 'Announcements',
            title: title || body || 'Announcement',
            body: title ? body : '',
          });
        });
      } else {
        slides.push({
          id: 'announcement-empty',
          kind: 'announcement',
          label: 'Announcements',
          title: 'No active announcements',
          body: '',
        });
      }
    }

    slides.push({
      id: 'staff',
      kind: 'staff',
      label: 'Clocked in',
      inOffice: Number(display?.inOfficeCount) || 0,
      unavailable: Number(display?.unavailableCount) || 0,
    });

    const byDept = display?.meetingsByDepartment || [];
    if (byDept.length > 0) {
      slides.push({
        id: 'meetings-by-dept',
        kind: 'meetingsByDept',
        label: 'Meetings today',
        rows: byDept.slice(0, 5),
      });
    }

    const holidayNames = (display?.holidays || [])
      .map((h) => String(h.name || '').trim())
      .filter(Boolean);
    if (holidayNames.length > 0) {
      slides.push({
        id: 'holidays',
        kind: 'holidays',
        label: 'Holidays',
        names: holidayNames,
      });
    }

    if (showBirthdays) {
      const birthdayNames = (display?.birthdays || [])
        .map((b) => String(b.name || '').trim())
        .filter(Boolean);
      if (birthdayNames.length > 0) {
        slides.push({
          id: 'birthdays',
          kind: 'birthdays',
          label: 'Birthdays',
          names: birthdayNames,
        });
      }
    }

    const helpContacts = (display?.helpContacts || [])
      .map((c) => ({
        id: Number(c.id),
        name: String(c.name || '').trim() || `Employee #${c.id}`,
        photoUrl: c.photoUrl || null,
        phone: c.phone || null,
        email: c.email || null,
      }))
      .filter((c) => Number.isFinite(c.id) && c.id > 0);
    if (helpContacts.length > 0) {
      slides.push({
        id: 'contacts',
        kind: 'contacts',
        label: 'Contact',
        contacts: helpContacts,
      });
    }

    return slides;
  }, [display, showAnnouncements, showBirthdays, showUpdatesCarousel]);

  useEffect(() => {
    setUpdatesCarouselIndex((prev) =>
      updatesCarouselSlides.length === 0 ? 0 : prev % updatesCarouselSlides.length,
    );
  }, [updatesCarouselSlides.length]);

  useEffect(() => {
    if (updatesCarouselSlides.length <= 1) return;
    const timer = window.setInterval(() => {
      setUpdatesCarouselIndex((prev) => (prev + 1) % updatesCarouselSlides.length);
    }, UPDATES_CAROUSEL_MS);
    return () => window.clearInterval(timer);
  }, [updatesCarouselSlides.length]);

  const safeUpdatesCarouselIndex =
    updatesCarouselSlides.length === 0
      ? 0
      : Math.min(updatesCarouselIndex, updatesCarouselSlides.length - 1);
  const currentUpdatesSlide = updatesCarouselSlides[safeUpdatesCarouselIndex] ?? null;

  if (deviceUiMode === 'checking') {
    return (
      <div className="entry-kiosk relative flex items-center justify-center bg-[#0a1628] text-white">
        <KioskFullscreenGate
          visible={needsTapToFullscreen}
          canInstall={canInstall}
          showInstallHint={!isPwa && needsInstallForTrueFullscreen && !needsTapToFullscreen}
          onEnter={() => void enterFullscreen()}
          onInstall={() => void installKioskApp()}
        />
        <span className="loading loading-spinner loading-lg text-slate-300" />
      </div>
    );
  }

  if (deviceUiMode === 'unpaired') {
    return (
      <div className="entry-kiosk relative flex flex-col overflow-hidden bg-[#0a1628] text-white">
        <KioskFullscreenGate
          visible={needsTapToFullscreen}
          canInstall={canInstall}
          showInstallHint={!isPwa && needsInstallForTrueFullscreen && !needsTapToFullscreen}
          onEnter={() => void enterFullscreen()}
          onInstall={() => void installKioskApp()}
        />
        <KioskPairingScreen
          locationId={ENTRY_KIOSK_DEFAULT_LOCATION_ID}
          onPaired={handleKioskPaired}
        />
      </div>
    );
  }

  if (deviceUiMode === 'locked') {
    return (
      <div className="entry-kiosk relative flex items-center justify-center bg-[#0a1628] px-6 text-center text-white">
        <KioskFullscreenGate
          visible={needsTapToFullscreen}
          canInstall={canInstall}
          showInstallHint={!isPwa && needsInstallForTrueFullscreen && !needsTapToFullscreen}
          onEnter={() => void enterFullscreen()}
          onInstall={() => void installKioskApp()}
        />
        <div>
          <h1 className="text-2xl font-bold">Kiosk locked</h1>
          <p className="mt-2 text-slate-300">This device was revoked. Contact your administrator.</p>
        </div>
      </div>
    );
  }

  if (deviceUiMode === 'document' && documentSession) {
    return (
      <div className="entry-kiosk relative flex flex-col overflow-hidden bg-white">
        <KioskFullscreenGate
          visible={needsTapToFullscreen}
          canInstall={canInstall}
          showInstallHint={!isPwa && needsInstallForTrueFullscreen && !needsTapToFullscreen}
          onEnter={() => void enterFullscreen()}
          onInstall={() => void installKioskApp()}
        />
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
      className="entry-kiosk relative flex flex-col overflow-hidden text-[var(--kiosk-text)]"
      style={
        {
          '--kiosk-text': '#f8fafc',
          '--kiosk-muted': '#9ca3af',
          '--kiosk-gold': '#d8b15a',
          background:
            'radial-gradient(ellipse 80% 55% at 50% 8%, rgba(74, 110, 190, 0.28), transparent 55%), radial-gradient(ellipse 60% 40% at 80% 90%, rgba(40, 70, 140, 0.18), transparent 50%), radial-gradient(ellipse 50% 35% at 10% 70%, rgba(30, 55, 120, 0.12), transparent 45%), linear-gradient(180deg, #0a1630 0%, #050d1c 42%, #02060f 100%)',
          backgroundColor: '#0a1628',
        } as React.CSSProperties
      }
    >
      <KioskFullscreenGate
        visible={needsTapToFullscreen}
        canInstall={canInstall}
        showInstallHint={!isPwa && needsInstallForTrueFullscreen && !needsTapToFullscreen}
        onEnter={() => void enterFullscreen()}
        onInstall={() => void installKioskApp()}
      />
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
        <div className="kiosk-doc-done-overlay" role="status" aria-live="polite">
          <div className="kiosk-doc-done-card">
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
          font-size: 3.25rem;
          line-height: 1.1;
        }
        .kiosk-date {
          font-size: 1.05rem;
        }
        .kiosk-weather {
          margin-top: 0.35rem;
          font-size: 1.05rem;
          line-height: 1.25;
          color: var(--kiosk-muted);
        }
        .kiosk-weather-detail {
          margin-top: 0.15rem;
          font-size: 0.95rem;
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
          width: 6.25rem;
          height: 6.25rem;
          flex-shrink: 0;
        }
        .kiosk-countdown-num {
          font-size: 1.45rem;
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
          width: min(1100px, 100%);
          margin: 0.85rem auto 0;
          border-radius: 20px;
          border: none;
          background: rgba(8, 16, 34, 0.82);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          padding: 1.35rem 1.35rem 1.25rem;
          min-height: 11.5rem;
          height: 11.5rem;
          display: grid;
          grid-template-columns: repeat(var(--kiosk-info-cols, 3), minmax(0, 1fr));
          gap: 0;
          flex: 0 0 auto;
          position: relative;
          z-index: 5;
          overflow: hidden;
          align-items: stretch;
        }
        .kiosk-info-col {
          min-width: 0;
          min-height: 0;
          padding: 0.15rem 1.1rem;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: stretch;
          gap: 0.7rem;
        }
        .kiosk-info-col + .kiosk-info-col {
          border-left: 1px solid rgba(255, 255, 255, 0.12);
        }
        .kiosk-info-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.65rem;
          min-width: 0;
          height: 1.35rem;
          flex-shrink: 0;
        }
        .kiosk-info-label {
          font-size: 0.95rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--kiosk-gold);
          flex-shrink: 0;
        }
        .kiosk-info-item {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          min-width: 0;
        }
        .kiosk-info-icon {
          width: 2.85rem;
          height: 2.85rem;
          flex-shrink: 0;
          color: var(--kiosk-gold);
          margin-top: 0.05rem;
        }
        .kiosk-info-text {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .kiosk-info-primary {
          font-size: 1.15rem;
          font-weight: 700;
          line-height: 1.3;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kiosk-info-secondary {
          font-size: 0.98rem;
          line-height: 1.35;
          color: var(--kiosk-gold);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kiosk-info-empty {
          font-size: 0.98rem;
          color: var(--kiosk-muted);
          line-height: 1.35;
        }
        .kiosk-info-meetings {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          min-width: 0;
        }
        .kiosk-info-meeting-row {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.2rem;
          min-width: 0;
          font-size: 1.12rem;
          line-height: 1.3;
          color: rgba(248, 250, 252, 0.92);
        }
        .kiosk-info-meeting-meta {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
        }
        .kiosk-info-meeting-type-badge {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.18rem 0.45rem;
          border-radius: 9999px;
          font-size: 0.68rem;
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
          font-weight: 700;
          font-size: 1.28rem;
        }
        .kiosk-info-meeting-name {
          min-width: 0;
          max-width: 100%;
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
          font-size: 0.78rem;
          color: var(--kiosk-muted);
          letter-spacing: 0.04em;
          white-space: nowrap;
          text-align: right;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kiosk-updates-carousel {
          gap: 0.7rem;
          min-width: 0;
        }
        .kiosk-carousel-viewport {
          position: relative;
          height: 7.75rem;
          min-height: 7.75rem;
          max-height: 7.75rem;
          overflow: hidden;
          flex: 1 1 auto;
          min-width: 0;
        }
        .kiosk-carousel-slide > .kiosk-info-item,
        .kiosk-carousel-slide > .kiosk-carousel-contacts {
          width: 100%;
        }
        .kiosk-carousel-slide {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: flex-start;
          opacity: 0;
          transform: translateY(0.55rem);
          pointer-events: none;
          transition:
            opacity 0.45s ease,
            transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .kiosk-carousel-slide.is-active {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
          z-index: 1;
        }
        .kiosk-carousel-dots {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          flex-shrink: 0;
        }
        .kiosk-carousel-dot {
          width: 0.4rem;
          height: 0.4rem;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.28);
          transition: background 0.25s ease, transform 0.25s ease;
        }
        .kiosk-carousel-dot.is-active {
          background: var(--kiosk-gold);
          transform: scale(1.15);
        }
        .kiosk-carousel-wrap {
          white-space: normal !important;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .kiosk-carousel-dept-list {
          width: 100%;
          gap: 0.2rem;
        }
        .kiosk-carousel-dept-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.75rem;
          min-width: 0;
          font-size: 1.02rem;
          line-height: 1.3;
          color: #fff;
        }
        .kiosk-carousel-dept-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
        }
        .kiosk-carousel-dept-count {
          flex-shrink: 0;
          font-weight: 700;
          color: var(--kiosk-gold);
          font-variant-numeric: tabular-nums;
        }
        .kiosk-carousel-contacts {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          width: 100%;
          align-items: stretch;
          justify-content: flex-start;
        }
        .kiosk-carousel-contact {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          min-width: 0;
        }
        .kiosk-carousel-contact .kiosk-meetings-participant-photo,
        .kiosk-carousel-contact .kiosk-meetings-participant-fallback {
          width: 2.6rem;
          height: 2.6rem;
          flex-shrink: 0;
          font-size: 0.78rem;
        }
        .kiosk-carousel-contact-text {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.12rem;
        }
        .kiosk-carousel-contact-name {
          font-size: 1.02rem;
          font-weight: 700;
          color: #fff;
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kiosk-carousel-contact-line {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          min-width: 0;
          font-size: 0.88rem;
          line-height: 1.25;
          color: var(--kiosk-gold);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kiosk-carousel-contact-icon {
          width: 0.95rem;
          height: 0.95rem;
          flex-shrink: 0;
          opacity: 0.9;
        }

        .kiosk-promo-overlay {
          position: fixed;
          inset: 0;
          z-index: 200;
          margin: 0;
          padding: 0;
          border: none;
          background: #02060f;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: kiosk-promo-in 280ms ease-out;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .kiosk-promo-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: center;
          pointer-events: none;
          user-select: none;
          -webkit-user-drag: none;
        }
        @keyframes kiosk-promo-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
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
        .kiosk-meetings-list-wrap {
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          padding: 0.25rem 0 0.5rem;
        }
        .kiosk-meetings-list-wrap::-webkit-scrollbar {
          display: none;
        }
        .kiosk-meetings-list {
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
          width: 100%;
          margin: 0 auto;
        }
        .kiosk-meeting-card {
          position: relative;
          display: flex;
          flex-direction: row;
          align-items: stretch;
          gap: 1rem;
          padding: 1.1rem 1.15rem 1.15rem;
          border-radius: 20px;
          border: 1.5px solid rgba(216, 177, 90, 0.28);
          background: #121c32;
          box-shadow:
            0 12px 28px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .kiosk-meeting-card.is-current {
          border-color: rgba(52, 211, 153, 0.65);
          background: #10261f;
          box-shadow:
            0 0 0 1px rgba(52, 211, 153, 0.25),
            0 14px 32px rgba(0, 0, 0, 0.4);
        }
        .kiosk-meeting-card.is-upcoming {
          border-color: rgba(96, 165, 250, 0.55);
          background: #101c32;
          box-shadow:
            0 0 0 1px rgba(96, 165, 250, 0.2),
            0 12px 28px rgba(0, 0, 0, 0.35);
        }
        .kiosk-meeting-card.is-past {
          opacity: 0.7;
          border-color: rgba(255, 255, 255, 0.12);
          background: #0e1628;
        }
        .kiosk-meeting-card-main {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
          justify-content: center;
        }
        .kiosk-meeting-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
        }
        .kiosk-meeting-card-time-block {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem 0.55rem;
          min-width: 0;
        }
        .kiosk-meeting-card-status-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.45rem;
          margin-top: 0.15rem;
        }
        .kiosk-meetings-time-value {
          font-size: 1.35rem;
          font-weight: 800;
          color: var(--kiosk-gold);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          line-height: 1;
          letter-spacing: -0.02em;
        }
        .kiosk-meetings-type-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.28rem 0.55rem;
          border: none;
          outline: none;
          box-shadow: none;
          border-radius: 9999px;
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          line-height: 1.1;
          white-space: nowrap;
        }
        .kiosk-meeting-card-live {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.38rem 0.8rem;
          border: none;
          outline: none;
          box-shadow: none;
          border-radius: 9999px;
          background: #34d399;
          color: #052e1c;
          font-size: 0.82rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .kiosk-meeting-card-live-dot {
          width: 0.45rem;
          height: 0.45rem;
          border-radius: 9999px;
          background: #052e1c;
        }
        .kiosk-meeting-card-soon {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          padding: 0.38rem 0.8rem;
          border: none;
          outline: none;
          box-shadow: none;
          border-radius: 9999px;
          background: #60a5fa;
          color: #0b1f3a;
          font-size: 0.82rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .kiosk-meeting-card-title {
          margin: 0;
          font-size: 1.22rem;
          font-weight: 800;
          color: #fff;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          word-break: break-word;
        }
        .kiosk-meeting-card-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.45rem 0.75rem;
          font-size: 0.88rem;
          color: rgba(226, 232, 240, 0.78);
        }
        .kiosk-meeting-card-lead-num {
          font-weight: 700;
          letter-spacing: 0.04em;
          color: var(--kiosk-gold);
        }
        .kiosk-meeting-card-location {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          min-width: 0;
        }
        .kiosk-meeting-card-location-icon {
          width: 1rem;
          height: 1rem;
          flex-shrink: 0;
          opacity: 0.85;
        }
        .kiosk-meetings-participants-list {
          flex: 0 0 auto;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: center;
          gap: 0.55rem;
          max-width: 44%;
          min-width: 10rem;
          padding-left: 0.95rem;
          border-left: 1px solid rgba(255, 255, 255, 0.1);
        }
        .kiosk-meetings-participant {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          min-width: 0;
          max-width: 100%;
          padding: 0;
          border: none;
          outline: none;
          box-shadow: none;
          background: transparent;
          border-radius: 0;
        }
        .kiosk-meetings-participant-photo,
        .kiosk-meetings-participant-fallback {
          width: 2.55rem;
          height: 2.55rem;
          border-radius: 9999px;
          object-fit: cover;
          flex-shrink: 0;
        }
        .kiosk-meetings-participant-fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.85rem;
          font-weight: 800;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          box-shadow: none;
          border: none;
        }
        .kiosk-meetings-participant-name {
          font-size: 1.05rem;
          font-weight: 700;
          color: rgba(248, 250, 252, 0.96);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
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
        .kiosk-meetings-idle-badge {
          margin-top: 0.65rem;
          align-self: center;
          position: relative;
          width: 2.75rem;
          height: 2.75rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .kiosk-meetings-idle-badge-value {
          font-size: 0.95rem;
          font-weight: 800;
          color: #fff;
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }

        @media (min-width: 900px) and (orientation: landscape) {
          .kiosk-meetings-list {
            width: min(100%, 36rem);
          }
        }

        @media (max-width: 700px) {
          .kiosk-info-strip {
            grid-template-columns: 1fr;
            gap: 0.75rem;
            padding: 1rem;
            min-height: 0;
            height: auto;
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
          /* Room for the gold orbit stroke outside the QR frame */
          padding: 18px;
          overflow: visible;
        }
        .kiosk-qr-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: min(100cqi, calc(100cqb - 2.5rem), 580px);
          max-width: 100%;
          overflow: visible;
        }
        @supports not (width: 1cqi) {
          .kiosk-qr-block {
            width: min(76vw, 56vh, 580px);
          }
        }
        .kiosk-qr-shell {
          position: relative;
          width: 100%;
          aspect-ratio: 1 / 1;
          z-index: 1;
          overflow: visible;
        }
        .kiosk-scan-ring {
          position: absolute;
          /* Outer gap = visible gold stroke thickness (no CSS mask — Chrome tablet broke it) */
          inset: -14px;
          border-radius: 36px;
          pointer-events: none;
          overflow: hidden;
          z-index: 0;
        }
        .kiosk-scan-ring::before {
          content: '';
          position: absolute;
          inset: -55%;
          background: conic-gradient(
            from 0deg,
            transparent 0deg,
            transparent 285deg,
            rgba(216, 177, 90, 0.2) 305deg,
            rgba(216, 177, 90, 0.95) 328deg,
            rgba(216, 177, 90, 0.2) 348deg,
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

        /* 10" landscape sweet spot (iPad / Android tablets) */
        @media (orientation: landscape) and (max-height: 900px) and (min-width: 900px) {
          .kiosk-header { padding-block: 0.55rem; }
          .kiosk-logo { height: 3.35rem; }
          .kiosk-clock { font-size: 3.4rem; }
          .kiosk-date { font-size: 1.2rem; }
          .kiosk-title { font-size: 2rem; margin-top: 0.35rem; }
          .kiosk-sub { font-size: 1rem; }
          .kiosk-countdown { width: 6.25rem; height: 6.25rem; }
          .kiosk-countdown-num { font-size: 1.45rem; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 2.25rem), 560px); }
          .kiosk-qr-frame { padding: 14px; border-radius: 24px; }
          .kiosk-main { padding-bottom: 2.75rem; }
        }

        /* Shorter 10" landscape (~768–800 CSS height) — keep QR large */
        @media (orientation: landscape) and (max-height: 820px) {
          .kiosk-header { padding-block: 0.45rem; }
          .kiosk-logo { height: 3rem; }
          .kiosk-clock { font-size: 3.05rem; }
          .kiosk-date { font-size: 1rem; }
          .kiosk-weather { font-size: 1rem; }
          .kiosk-title { font-size: 1.7rem; margin-top: 0.25rem; }
          .kiosk-sub { font-size: 0.9rem; margin-top: 0.2rem; }
          .kiosk-countdown { width: 5.75rem; height: 5.75rem; }
          .kiosk-countdown-num { font-size: 1.35rem; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 2rem), 520px); }
          .kiosk-qr-frame { padding: 12px; }
          .kiosk-main { padding-bottom: 2.5rem; }
        }

        /* Very short landscape — drop subtitle before shrinking QR further */
        @media (orientation: landscape) and (max-height: 740px) {
          .kiosk-sub { display: none; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 1.5rem), 480px); }
        }

        /* 10" portrait (tablet upright) — QR can use more width */
        @media (orientation: portrait) and (max-width: 900px) {
          .kiosk-logo { height: 3.5rem; }
          .kiosk-clock { font-size: 3.5rem; }
          .kiosk-date { font-size: 1.1rem; }
          .kiosk-weather { font-size: 1.1rem; }
          .kiosk-title { font-size: 2.1rem; }
          .kiosk-sub { font-size: 1.05rem; }
          .kiosk-countdown { width: 6.25rem; height: 6.25rem; }
          .kiosk-countdown-num { font-size: 1.45rem; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 2.25rem), 570px); }
        }

        /* Large desktop preview — don't let chrome balloon; keep QR capped */
        @media (min-height: 960px) and (min-width: 1200px) {
          .kiosk-logo { height: 3.75rem; }
          .kiosk-clock { font-size: 3.75rem; }
          .kiosk-date { font-size: 1.15rem; }
          .kiosk-weather { font-size: 1.15rem; }
          .kiosk-title { font-size: 2.5rem; }
          .kiosk-sub { font-size: 1.1rem; }
          .kiosk-countdown { width: 6.75rem; height: 6.75rem; }
          .kiosk-countdown-num { font-size: 1.55rem; }
          .kiosk-qr-block { width: min(100cqi, calc(100cqb - 2.25rem), 600px); }
        }
      `}</style>

      {successFlash ? (
        <KioskWelcomeGoodbyeModal
          action={successFlash.action === 'out' ? 'out' : 'in'}
          employeeName={successFlash.employeeName || 'Employee'}
          photoUrl={successFlash.photoUrl}
          clockedAt={successFlash.at || new Date().toISOString()}
          meetings={successFlash.meetings}
          secondsLeft={welcomeSecondsLeft}
          totalSeconds={KIOSK_SUCCESS_SEC}
          now={now}
          variant="overlay"
          onClose={dismissSuccessFlash}
        />
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
              {meetingsLoading
                ? '…'
                : currentMeetingsCount > 0
                  ? `${currentMeetingsCount} now · ${sortedMeetingsDetail.length} total`
                  : `${sortedMeetingsDetail.length} total`}
            </span>
          </div>

          {meetingsLoading ? (
            <div className="kiosk-meetings-empty">
              <span className="loading loading-spinner loading-lg text-slate-400" />
            </div>
          ) : sortedMeetingsDetail.length > 0 ? (
            <div className="kiosk-meetings-list-wrap" ref={meetingsTableWrapRef}>
              <div className="kiosk-meetings-list">
                {sortedMeetingsDetail.map((m) => {
                  const typeStyle = MEETING_TYPE_STYLES[m.typeCode] || MEETING_TYPE_STYLES.other;
                  const title = m.clientName || m.title || 'Meeting';
                  return (
                    <article
                      key={m.id}
                      data-meeting-id={m.id}
                      className={[
                        'kiosk-meeting-card',
                        m.isCurrent ? 'is-current' : '',
                        m.isUpcoming ? 'is-upcoming' : '',
                        m.isPast ? 'is-past' : '',
                      ].join(' ')}
                    >
                      <div className="kiosk-meeting-card-main">
                        <div className="kiosk-meeting-card-top">
                          <div className="kiosk-meeting-card-time-block">
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
                          </div>
                        </div>
                        {(m.isCurrent || m.isUpcoming) && (
                          <div className="kiosk-meeting-card-status-row">
                            {m.isCurrent ? (
                              <span className="kiosk-meeting-card-live">
                                <span className="kiosk-meeting-card-live-dot" aria-hidden />
                                Now
                              </span>
                            ) : null}
                            {m.isUpcoming ? (
                              <span className="kiosk-meeting-card-soon">Coming up</span>
                            ) : null}
                          </div>
                        )}

                        <h3 className="kiosk-meeting-card-title">{title}</h3>

                        {(m.leadNumber || m.location) && (
                          <div className="kiosk-meeting-card-meta">
                            {m.leadNumber ? (
                              <span className="kiosk-meeting-card-lead-num">{m.leadNumber}</span>
                            ) : null}
                            {m.location ? (
                              <span className="kiosk-meeting-card-location">
                                {m.isVirtual ? (
                                  <VideoCameraIcon
                                    className="kiosk-meeting-card-location-icon"
                                    aria-hidden
                                  />
                                ) : (
                                  <MapPinIcon
                                    className="kiosk-meeting-card-location-icon"
                                    aria-hidden
                                  />
                                )}
                                <span className="truncate">{m.location}</span>
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>

                      {m.participants.length > 0 ? (
                        <div className="kiosk-meetings-participants-list">
                          {m.participants.map((participant) => (
                            <div
                              key={`${m.id}-${participant.employeeId ?? participant.name}`}
                              className="kiosk-meetings-participant"
                            >
                              <MeetingParticipantAvatar
                                name={participant.name}
                                photoUrl={participant.photoUrl}
                                employeeId={participant.employeeId}
                              />
                              <span className="kiosk-meetings-participant-name">
                                {participant.name}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
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
          <div
            className="kiosk-meetings-idle-badge"
            role="timer"
            aria-label={`${meetingsIdleSecondsLeft} seconds until return to main screen`}
          >
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 44 44" aria-hidden>
              <circle
                cx="22"
                cy="22"
                r={meetingsIdleRingR}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="3"
              />
              <circle
                cx="22"
                cy="22"
                r={meetingsIdleRingR}
                fill="none"
                stroke="var(--kiosk-gold)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={meetingsIdleRingC}
                strokeDashoffset={meetingsIdleRingOffset}
              />
            </svg>
            <span className="kiosk-meetings-idle-badge-value">{meetingsIdleSecondsLeft}</span>
          </div>
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
                <p className="inline-flex items-center justify-end gap-1.5">
                  <CloudIcon className="h-8 w-8 shrink-0 text-[var(--kiosk-gold)]" aria-hidden />
                  <span>
                    {display.weather.city}
                    {display.weather.temperatureC != null
                      ? ` · ${Math.round(display.weather.temperatureC)}°C`
                      : ''}
                  </span>
                </p>
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
                  <div className="kiosk-info-label-row">
                    <p className="kiosk-info-label">
                      {(display?.meetings || []).some((m) => m.isCurrent)
                        ? 'Happening now'
                        : 'Next meeting'}
                    </p>
                  </div>
                  {(display?.meetings?.length ?? 0) > 0 ? (
                    <div className="kiosk-info-item">
                      <CalendarDaysIcon className="kiosk-info-icon" aria-hidden />
                      <div className="kiosk-info-meetings">
                        {display?.meetings?.slice(0, 2).map((m) => {
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
                              <div className="kiosk-info-meeting-meta">
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
                              </div>
                              <span className="kiosk-info-meeting-name">
                                {[leadLabel, m.leadNumber].filter(Boolean).join(' · ')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="kiosk-info-item">
                      <CalendarDaysIcon className="kiosk-info-icon" aria-hidden />
                      <div className="kiosk-info-text">
                        <p className="kiosk-info-empty">No meetings scheduled today</p>
                      </div>
                    </div>
                  )}
                </button>
              ) : null}

              {showUpdatesCarousel && updatesCarouselSlides.length > 0 ? (
                <div className="kiosk-info-col kiosk-updates-carousel" aria-live="polite">
                  <div className="kiosk-info-label-row">
                    <p className="kiosk-info-label">
                      {currentUpdatesSlide?.label || 'Updates'}
                    </p>
                    {updatesCarouselSlides.length > 1 ? (
                      <div className="kiosk-carousel-dots" aria-hidden>
                        {updatesCarouselSlides.map((slide, index) => (
                          <span
                            key={slide.id}
                            className={[
                              'kiosk-carousel-dot',
                              index === safeUpdatesCarouselIndex ? 'is-active' : '',
                            ].join(' ')}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="kiosk-carousel-viewport">
                    {updatesCarouselSlides.map((slide, index) => {
                      const isActive = index === safeUpdatesCarouselIndex;
                      return (
                        <div
                          key={slide.id}
                          className={[
                            'kiosk-carousel-slide',
                            isActive ? 'is-active' : '',
                          ].join(' ')}
                          aria-hidden={!isActive}
                        >
                          {slide.kind === 'staff' ? (
                            <div className="kiosk-info-item">
                              <UsersIcon className="kiosk-info-icon" aria-hidden />
                              <div className="kiosk-info-text kiosk-carousel-stats">
                                <p className="kiosk-info-primary">
                                  {slide.inOffice}{' '}
                                  {slide.inOffice === 1
                                    ? 'employee clocked in'
                                    : 'employees clocked in'}
                                </p>
                                <p className="kiosk-info-secondary">
                                  {slide.unavailable} unavailable
                                </p>
                              </div>
                            </div>
                          ) : null}

                          {slide.kind === 'meetingsByDept' ? (
                            <div className="kiosk-info-item">
                              <UserGroupIcon className="kiosk-info-icon" aria-hidden />
                              <div className="kiosk-info-text kiosk-carousel-dept-list">
                                {slide.rows.map((row) => (
                                  <p key={row.department} className="kiosk-carousel-dept-row">
                                    <span className="kiosk-carousel-dept-name">
                                      {row.department}
                                    </span>
                                    <span className="kiosk-carousel-dept-count">{row.count}</span>
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {slide.kind === 'holidays' ? (
                            <div className="kiosk-info-item">
                              <SparklesIcon className="kiosk-info-icon" aria-hidden />
                              <div className="kiosk-info-text">
                                <p className="kiosk-info-primary kiosk-carousel-wrap">
                                  {slide.names.join(' · ')}
                                </p>
                                <p className="kiosk-info-secondary">Today</p>
                              </div>
                            </div>
                          ) : null}

                          {slide.kind === 'birthdays' ? (
                            <div className="kiosk-info-item">
                              <CakeIcon className="kiosk-info-icon" aria-hidden />
                              <div className="kiosk-info-text">
                                <p className="kiosk-info-primary">Happy Birthday</p>
                                <p className="kiosk-info-secondary kiosk-carousel-wrap">
                                  {slide.names.join(', ')}!
                                </p>
                              </div>
                            </div>
                          ) : null}

                          {slide.kind === 'announcement' ? (
                            <div className="kiosk-info-item">
                              <MegaphoneIcon className="kiosk-info-icon" aria-hidden />
                              <div className="kiosk-info-text">
                                <p
                                  className={[
                                    'kiosk-info-primary',
                                    'kiosk-carousel-wrap',
                                    slide.id === 'announcement-empty' ? 'kiosk-info-empty' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {slide.title}
                                </p>
                                {slide.body ? (
                                  <p className="kiosk-info-secondary kiosk-carousel-wrap">
                                    {slide.body}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {slide.kind === 'contacts' ? (
                            <div className="kiosk-carousel-contacts">
                              {slide.contacts.map((contact) => (
                                <div key={contact.id} className="kiosk-carousel-contact">
                                  <MeetingParticipantAvatar
                                    name={contact.name}
                                    photoUrl={contact.photoUrl}
                                    employeeId={contact.id}
                                  />
                                  <div className="kiosk-carousel-contact-text">
                                    <p className="kiosk-carousel-contact-name">{contact.name}</p>
                                    {contact.phone ? (
                                      <p className="kiosk-carousel-contact-line">
                                        <PhoneIcon className="kiosk-carousel-contact-icon" aria-hidden />
                                        {contact.phone}
                                      </p>
                                    ) : null}
                                    {contact.email ? (
                                      <p className="kiosk-carousel-contact-line">
                                        <EnvelopeIcon className="kiosk-carousel-contact-icon" aria-hidden />
                                        {contact.email}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
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
                  strokeWidth="4.5"
                />
                <circle
                  cx="56"
                  cy="56"
                  r={ringR}
                  fill="none"
                  stroke="var(--kiosk-gold)"
                  strokeWidth="4.5"
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

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[70vw] items-center gap-3 sm:bottom-5 sm:left-8">
        <UsersIcon className="h-7 w-7 shrink-0 text-[var(--kiosk-gold)] sm:h-8 sm:w-8" aria-hidden />
        <p className="text-lg font-semibold text-white/90 sm:text-xl">
          {display?.localInOfficeCount ?? 0}{' '}
          {(display?.localInOfficeCount ?? 0) === 1 ? 'employee' : 'employees'} in office
        </p>
      </div>

      {promoVisible && isPromoIdleScreen ? (
        <button
          type="button"
          className="kiosk-promo-overlay"
          onPointerDown={(e) => {
            e.preventDefault();
            dismissPromo();
          }}
          aria-label="Dismiss featured image"
        >
          <img
            src={KIOSK_PROMO_SRC}
            alt=""
            className="kiosk-promo-image"
            draggable={false}
          />
        </button>
      ) : null}
    </div>
  );
};

export default EntryKioskPage;
