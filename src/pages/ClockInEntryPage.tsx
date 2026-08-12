import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isRefreshTokenReuseRaceError, supabase } from '../lib/supabase';
/**
 * Office entry-kiosk QR handler (`/clock-in/entry?token=…`).
 * Independent of the forced CRM clock-in gate (which is currently optional/disabled).
 * Scanning still clocks the employee in or out via the backend kiosk APIs.
 */
import {
  ENTRY_KIOSK_DEFAULT_LOCATION_ID,
  announceClockInKioskSuccess,
  buildClockInEntryPath,
  fetchMeetingClockAdjustment,
  validateClockInKioskToken,
  type ClockInKioskFlashAction,
  type ClockInKioskWelcomeMeeting,
} from '../lib/clockInKioskApi';
import { clearPostLoginRedirect, persistPostLoginRedirect } from '../lib/postLoginRedirect';
import { fetchClockInGateProfile } from '../lib/employeeClockInGate';
import {
  clockOutEmployeeRecord,
  fetchActiveClockInRecord,
} from '../lib/employeeClockOut';
import { clearClockInGateCache } from '../lib/clockInGateCache';
import { resolveSessionWithRecovery } from '../lib/authSessionKeepAlive';
import KioskWelcomeGoodbyeModal, {
  PHONE_WELCOME_DURATION_MS,
  PHONE_WELCOME_DURATION_SEC,
} from '../components/kiosk/KioskWelcomeGoodbyeModal';

type EntryStatus =
  | 'loading'
  | 'connecting'
  | 'need_login'
  | 'clocking_in'
  | 'clocking_out'
  | 'success'
  | 'no_employee'
  | 'error';

type EntryRunResult =
  | {
      kind: 'success';
      action: ClockInKioskFlashAction;
      name: string;
      photoUrl: string | null;
      employeeId: number;
      locationId: number;
      atIso: string;
      remark: string | null;
      meetings: ClockInKioskWelcomeMeeting[];
      message: string;
    }
  | { kind: 'need_login'; returnPath: string; message: string }
  | { kind: 'no_employee'; message: string }
  | { kind: 'external'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'missing_token'; message: string };

/**
 * Shared in-flight runs keyed by QR token.
 * Strict Mode remounts must JOIN this promise (not early-return), otherwise the live
 * mount never applies state and the UI sticks on "Connecting…" until refresh.
 */
const entryRunsByToken = new Map<string, Promise<EntryRunResult>>();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Resolve the signed-in session for a scan.
 * Phones reopen this page after hours in the background, so the stored access token is
 * normally expired and the network may still be switching; recover the session with retries
 * instead of bouncing to /login. When the URL carries auth params we also wait for the
 * PKCE / magic-link exchange to land.
 */
async function resolveSessionForEntryPage() {
  const recovered = await resolveSessionWithRecovery({ attempts: 6, baseDelayMs: 400 });
  if (recovered?.user) return recovered;

  if (typeof window === 'undefined') return null;
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  const authInUrl =
    /[?&#](code|access_token)=/.test(`${search}${hash}`)
    || search.includes('type=magiclink')
    || hash.includes('type=magiclink');
  if (!authInUrl) return null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((r) => window.setTimeout(r, 300));
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session;
  }
  return null;
}

async function resolveEmployeeProfile(employeeId: number | null, fallbackEmail?: string | null) {
  let name = 'Employee';
  let photoUrl: string | null = null;

  if (employeeId != null) {
    const { data } = await supabase
      .from('tenants_employee')
      .select('display_name, official_name, photo_url, photo')
      .eq('id', employeeId)
      .maybeSingle();
    const row = data as {
      official_name?: string | null;
      display_name?: string | null;
      photo_url?: string | null;
      photo?: string | null;
    } | null;
    const resolved =
      row?.official_name?.trim()
      || row?.display_name?.trim();
    if (resolved) name = resolved;
    const photo = row?.photo_url?.trim() || row?.photo?.trim();
    if (photo) photoUrl = photo;
  }

  if (name === 'Employee' && fallbackEmail?.trim()) {
    const local = fallbackEmail.split('@')[0]?.replace(/[._]/g, ' ');
    if (local) name = local.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return { name, photoUrl };
}

/** Rotate refresh token on every successful QR identity resolve (extends stay-signed-in). */
async function rotateSessionAfterScan(): Promise<void> {
  try {
    const { error } = await withTimeout(supabase.auth.refreshSession(), 8_000, 'session refresh');
    if (!error) return;
    if (isRefreshTokenReuseRaceError(error)) {
      // Another refresh (autoRefresh / parallel tab) already rotated — session should still be valid.
      await withTimeout(supabase.auth.getSession(), 4_000, 'session read after reuse');
      return;
    }
    console.warn('[ClockInEntry] refresh after scan skipped:', error);
  } catch (err) {
    console.warn('[ClockInEntry] refresh after scan skipped:', err);
  }
}

async function executeEntryRun(token: string, locationId: number): Promise<EntryRunResult> {
  if (!token) {
    return { kind: 'missing_token', message: 'Missing QR token. Please scan the screen again.' };
  }

  const [validation, session] = await Promise.all([
    withTimeout(validateClockInKioskToken(token, locationId), 12_000, 'QR validation'),
    withTimeout(resolveSessionForEntryPage(), 15_000, 'session recovery'),
  ]);

  if (!validation.success || !validation.valid) {
    return {
      kind: 'error',
      message: validation.error || 'QR code expired — scan the screen again.',
    };
  }

  const resolvedLocationId = validation.locationId ?? locationId;

  if (!session?.user) {
    const returnPath = buildClockInEntryPath(resolvedLocationId, token);
    return {
      kind: 'need_login',
      returnPath,
      message: 'Sign in to finish…',
    };
  }

  // Each scan is often the only chance that day to rotate the refresh token.
  await rotateSessionAfterScan();

  const profileResult = await withTimeout(
    fetchClockInGateProfile(session.user.id, { email: session.user.email }),
    12_000,
    'employee profile',
  );
  if (profileResult.queryFailed) {
    return {
      kind: 'error',
      message: 'Could not verify your employee profile. Please try again.',
    };
  }
  const profile = profileResult.profile;
  if (profile.isExternalUser) {
    return {
      kind: 'external',
      message: 'Signed in. External accounts skip office clock-in.',
    };
  }
  if (!profileResult.userRowFound || profile.employeeId == null) {
    return {
      kind: 'no_employee',
      message: 'Your account is not linked to an employee profile. Contact an admin.',
    };
  }

  const employeeId = profile.employeeId;
  const [profileInfo, activeRecord] = await Promise.all([
    resolveEmployeeProfile(employeeId, session.user.email),
    withTimeout(fetchActiveClockInRecord(employeeId), 12_000, 'active clock record'),
  ]);

  const { name, photoUrl: nextPhotoUrl } = profileInfo;
  const nowIso = new Date().toISOString();

  if (activeRecord) {
    // Clock out first; meeting adjustment patches in the background so welcome isn't blocked.
    try {
      await withTimeout(
        clockOutEmployeeRecord(
          {
            ...activeRecord,
            clock_in_location_id: activeRecord.clock_in_location_id || resolvedLocationId,
          },
          { skipGeolocation: true, clockOutTime: nowIso },
        ),
        15_000,
        'clock out',
      );
    } catch (err) {
      console.error('Entry kiosk clock-out failed:', err);
      return {
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to clock out. Please try again from the CRM.',
      };
    }

    void (async () => {
      try {
        const adjustment = await fetchMeetingClockAdjustment(
          employeeId,
          'out',
          activeRecord.clock_in_time,
        );
        if (adjustment.success && adjustment.adjusted && adjustment.adjustedAt) {
          await supabase
            .from('employee_clock_in')
            .update({ clock_out_time: adjustment.adjustedAt })
            .eq('id', activeRecord.id);
        }
        await announceClockInKioskSuccess(
          resolvedLocationId,
          name,
          nextPhotoUrl,
          employeeId,
          'out',
          {
            remark: adjustment.success ? adjustment.remark || null : null,
            adjustedAt:
              adjustment.success && adjustment.adjusted && adjustment.adjustedAt
                ? adjustment.adjustedAt
                : nowIso,
          },
        );
      } catch (err) {
        console.warn('Kiosk clock-out follow-up failed:', err);
        void announceClockInKioskSuccess(
          resolvedLocationId,
          name,
          nextPhotoUrl,
          employeeId,
          'out',
          { adjustedAt: nowIso },
        ).catch(() => undefined);
      }
    })();

    return {
      kind: 'success',
      action: 'out',
      name,
      photoUrl: nextPhotoUrl,
      employeeId,
      locationId: resolvedLocationId,
      atIso: nowIso,
      remark: null,
      meetings: [],
      message: 'You are clocked out',
    };
  }

  const payload = {
    employee_id: employeeId,
    user_id: session.user.id,
    clock_in_time: nowIso,
    clock_in_location_id: resolvedLocationId,
    notes: 'Entry kiosk QR',
    is_active: true,
    manually: false,
    approved: true,
    declined: false,
  };

  let insertedId: number | null = null;
  type InsertRow = { id?: number | null };
  let inserted: InsertRow | null = null;
  let error: { message?: string } | null = null;

  try {
    const first = await withTimeout(
      Promise.resolve(
        supabase.from('employee_clock_in').insert(payload).select('id').single(),
      ) as Promise<{ data: InsertRow | null; error: { message?: string } | null }>,
      15_000,
      'clock in',
    );
    inserted = first.data;
    error = first.error;
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Failed to clock in. Please try again from the CRM.',
    };
  }

  if (error) {
    const { clock_in_location_id: _drop, ...withoutPreset } = payload;
    try {
      const retry = await withTimeout(
        Promise.resolve(
          supabase.from('employee_clock_in').insert(withoutPreset).select('id').single(),
        ) as Promise<{ data: InsertRow | null; error: { message?: string } | null }>,
        15_000,
        'clock in retry',
      );
      error = retry.error;
      inserted = retry.data;
    } catch (err) {
      return {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to clock in. Please try again from the CRM.',
      };
    }
  }

  if (error) {
    console.error('Entry kiosk clock-in failed:', error);
    return {
      kind: 'error',
      message: error.message || 'Failed to clock in. Please try again from the CRM.',
    };
  }
  insertedId = inserted?.id != null ? Number(inserted.id) : null;

  void (async () => {
    try {
      const adjustment = await fetchMeetingClockAdjustment(employeeId, 'in');
      let atIso = nowIso;
      let remark: string | null = null;
      if (adjustment.success) {
        if (adjustment.remark) remark = adjustment.remark;
        if (adjustment.adjusted && adjustment.adjustedAt && insertedId != null) {
          atIso = adjustment.adjustedAt;
          await supabase
            .from('employee_clock_in')
            .update({ clock_in_time: atIso })
            .eq('id', insertedId);
        }
      }
      await announceClockInKioskSuccess(
        resolvedLocationId,
        name,
        nextPhotoUrl,
        employeeId,
        'in',
        { remark, adjustedAt: atIso },
      );
    } catch (err) {
      console.warn('Kiosk clock-in follow-up failed:', err);
      void announceClockInKioskSuccess(
        resolvedLocationId,
        name,
        nextPhotoUrl,
        employeeId,
        'in',
        { adjustedAt: nowIso },
      ).catch(() => undefined);
    }
  })();

  return {
    kind: 'success',
    action: 'in',
    name,
    photoUrl: nextPhotoUrl,
    employeeId,
    locationId: resolvedLocationId,
    atIso: nowIso,
    remark: null,
    meetings: [],
    message: 'You are clocked in',
  };
}

function getOrStartEntryRun(token: string, locationId: number): Promise<EntryRunResult> {
  const existing = entryRunsByToken.get(token);
  if (existing) return existing;

  const run = executeEntryRun(token, locationId).finally(() => {
    // Keep lock briefly so a remount cannot immediately start a second clock-out.
    window.setTimeout(() => {
      entryRunsByToken.delete(token);
    }, 2_500);
  });
  entryRunsByToken.set(token, run);
  return run;
}

/**
 * Public scan landing page opened from the entry-kiosk QR.
 * Validates token via backend, then clocks in or out based on current status.
 * Office QR path: no geolocation prompt — workplace comes from the kiosk location.
 */
const ClockInEntryPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = (searchParams.get('token') || '').trim();
  const locationIdRaw = Number(searchParams.get('locationId') || ENTRY_KIOSK_DEFAULT_LOCATION_ID);
  const locationId = Number.isFinite(locationIdRaw) && locationIdRaw > 0
    ? Math.trunc(locationIdRaw)
    : ENTRY_KIOSK_DEFAULT_LOCATION_ID;

  const [status, setStatus] = useState<EntryStatus>('loading');
  const [message, setMessage] = useState('Connecting…');
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [clockedAt, setClockedAt] = useState<string | null>(null);
  const [action, setAction] = useState<ClockInKioskFlashAction>('in');
  const [remark, setRemark] = useState<string | null>(null);
  const [welcomeMeetings, setWelcomeMeetings] = useState<ClockInKioskWelcomeMeeting[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(PHONE_WELCOME_DURATION_SEC);
  const [now, setNow] = useState(() => new Date());
  const [retryNonce, setRetryNonce] = useState(0);
  const welcomeTickRef = useRef<number | null>(null);
  const welcomeCloseRef = useRef<number | null>(null);

  const clearWelcomeTimers = useCallback(() => {
    if (welcomeTickRef.current != null) {
      window.clearInterval(welcomeTickRef.current);
      welcomeTickRef.current = null;
    }
    if (welcomeCloseRef.current != null) {
      window.clearTimeout(welcomeCloseRef.current);
      welcomeCloseRef.current = null;
    }
  }, []);

  const dismissWelcome = useCallback(() => {
    clearWelcomeTimers();
    navigate('/', { replace: true });
  }, [clearWelcomeTimers, navigate]);

  const retryEntry = useCallback(() => {
    if (token) entryRunsByToken.delete(token);
    setStatus('loading');
    setMessage('Connecting…');
    setRetryNonce((n) => n + 1);
  }, [token]);

  useEffect(() => {
    if (status !== 'success') return undefined;
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, [status]);

  useEffect(() => {
    // Arrived on the QR landing page (e.g. magic-link redirect) — drop stored return path.
    clearPostLoginRedirect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applySuccess = (result: Extract<EntryRunResult, { kind: 'success' }>) => {
      if (cancelled) return;
      setAction(result.action);
      setDisplayName(result.name);
      setPhotoUrl(result.photoUrl);
      setClockedAt(result.atIso);
      setRemark(result.remark);
      setWelcomeMeetings(result.meetings);
      setStatus('success');
      setMessage(result.message);
      setSecondsLeft(PHONE_WELCOME_DURATION_SEC);
      clearClockInGateCache();

      clearWelcomeTimers();
      welcomeTickRef.current = window.setInterval(() => {
        if (cancelled) return;
        setSecondsLeft((prev) => Math.max(0, prev - 1));
      }, 1000);

      welcomeCloseRef.current = window.setTimeout(() => {
        clearWelcomeTimers();
        if (!cancelled) navigate('/', { replace: true });
      }, PHONE_WELCOME_DURATION_MS);
    };

    const applyResult = (result: EntryRunResult) => {
      if (cancelled) return;

      if (result.kind === 'missing_token' || result.kind === 'error') {
        setStatus('error');
        setMessage(result.message);
        return;
      }
      if (result.kind === 'need_login') {
        persistPostLoginRedirect(result.returnPath);
        setStatus('need_login');
        setMessage(result.message);
        navigate(`/login?redirect=${encodeURIComponent(result.returnPath)}`, {
          replace: true,
          state: { from: result.returnPath },
        });
        return;
      }
      if (result.kind === 'no_employee') {
        setStatus('no_employee');
        setMessage(result.message);
        return;
      }
      if (result.kind === 'external') {
        setStatus('success');
        setMessage(result.message);
        window.setTimeout(() => {
          if (!cancelled) navigate('/', { replace: true });
        }, 900);
        return;
      }
      applySuccess(result);
    };

    setStatus('connecting');
    setMessage('Connecting to entry…');

    void getOrStartEntryRun(token, locationId)
      .then(applyResult)
      .catch((err) => {
        if (cancelled) return;
        console.error('Entry kiosk run failed:', err);
        setStatus('error');
        setMessage(
          err instanceof Error
            ? err.message
            : 'Something went wrong. Tap retry or scan the screen again.',
        );
      });

    return () => {
      cancelled = true;
      clearWelcomeTimers();
    };
  }, [token, locationId, navigate, clearWelcomeTimers, retryNonce]);

  if (status === 'success' && displayName && clockedAt) {
    return (
      <KioskWelcomeGoodbyeModal
        action={action}
        employeeName={displayName}
        photoUrl={photoUrl}
        clockedAt={clockedAt}
        secondsLeft={secondsLeft}
        totalSeconds={PHONE_WELCOME_DURATION_SEC}
        now={now}
        variant="page"
        compact
        onClose={dismissWelcome}
      />
    );
  }

  const title =
    status === 'error'
      ? 'Clock failed'
      : status === 'need_login'
        ? 'Sign in required'
        : status === 'no_employee'
          ? 'Account not linked'
          : status === 'connecting'
            ? 'Connecting…'
            : status === 'clocking_out'
              ? 'Clocking out…'
              : 'Office entry';

  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center px-4 py-10"
      style={{
        background:
          'radial-gradient(ellipse 80% 55% at 50% 10%, rgba(74, 110, 190, 0.28), transparent 55%), linear-gradient(180deg, #0a1630 0%, #02060f 100%)',
      }}
    >
      <div className="w-full max-w-md rounded-[28px] bg-white/95 p-8 text-center shadow-[0_30px_70px_rgba(0,0,0,0.4)] border-0 outline-none">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Office entry
        </p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-3 text-sm text-slate-600">{message}</p>

        {(status === 'loading'
          || status === 'connecting'
          || status === 'clocking_in'
          || status === 'clocking_out'
          || status === 'need_login') && (
          <div className="mt-6 flex justify-center">
            <span className="loading loading-spinner loading-md text-sky-700" />
          </div>
        )}

        {status === 'error' && (
          <div className="mt-6 flex flex-col gap-3">
            <button type="button" className="btn btn-primary btn-sm" onClick={retryEntry}>
              Retry clock-in
            </button>
            <Link to="/login" className="btn btn-ghost btn-sm">
              Go to login
            </Link>
            <p className="text-xs text-slate-400">Scan the tablet QR again if it rotated.</p>
          </div>
        )}

        {status === 'no_employee' && (
          <Link to="/" className="btn btn-ghost btn-sm mt-6">
            Open CRM
          </Link>
        )}
      </div>
    </div>
  );
};

export default ClockInEntryPage;
