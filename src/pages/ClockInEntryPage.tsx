import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ENTRY_KIOSK_DEFAULT_LOCATION_ID,
  announceClockInKioskSuccess,
  buildClockInEntryPath,
  fetchMeetingClockAdjustment,
  validateClockInKioskToken,
  type ClockInKioskFlashAction,
  type ClockInKioskWelcomeMeeting,
} from '../lib/clockInKioskApi';
import { fetchClockInGateProfile } from '../lib/employeeClockInGate';
import {
  clockOutEmployeeRecord,
  fetchActiveClockInRecord,
} from '../lib/employeeClockOut';
import { clearClockInGateCache } from '../lib/clockInGateCache';
import KioskWelcomeGoodbyeModal, {
  KIOSK_WELCOME_DURATION_MS,
  KIOSK_WELCOME_DURATION_SEC,
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
  const [secondsLeft, setSecondsLeft] = useState(KIOSK_WELCOME_DURATION_SEC);
  const [now, setNow] = useState(() => new Date());
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

  useEffect(() => {
    if (status !== 'success') return undefined;
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, [status]);

  useEffect(() => {
    let cancelled = false;

    const finishSuccess = (
      nextAction: ClockInKioskFlashAction,
      name: string,
      nextPhotoUrl: string | null,
      employeeId: number,
      resolvedLocationId: number,
      atIso: string,
      nextRemark?: string | null,
      nextMeetings?: ClockInKioskWelcomeMeeting[],
    ) => {
      if (cancelled) return;
      setAction(nextAction);
      setDisplayName(name);
      setPhotoUrl(nextPhotoUrl);
      setClockedAt(atIso);
      setRemark(nextRemark || null);
      setWelcomeMeetings(nextMeetings || []);
      setStatus('success');
      setMessage(nextAction === 'out' ? 'You are clocked out' : 'You are clocked in');
      setSecondsLeft(KIOSK_WELCOME_DURATION_SEC);
      clearClockInGateCache();

      void announceClockInKioskSuccess(
        resolvedLocationId,
        name,
        nextPhotoUrl,
        employeeId,
        nextAction,
        { remark: nextRemark || null, adjustedAt: atIso },
      ).catch((err) => console.warn('Kiosk announce failed:', err));

      clearWelcomeTimers();
      welcomeTickRef.current = window.setInterval(() => {
        if (cancelled) return;
        setSecondsLeft((prev) => Math.max(0, prev - 1));
      }, 1000);

      welcomeCloseRef.current = window.setTimeout(() => {
        clearWelcomeTimers();
        if (!cancelled) navigate('/', { replace: true });
      }, KIOSK_WELCOME_DURATION_MS);
    };

    const run = async () => {
      if (!token) {
        if (!cancelled) {
          setStatus('error');
          setMessage('Missing QR token. Please scan the screen again.');
        }
        return;
      }

      setStatus('connecting');
      setMessage('Connecting to entry…');

      const [validation, sessionResult] = await Promise.all([
        validateClockInKioskToken(token, locationId),
        supabase.auth.getSession(),
      ]);
      if (cancelled) return;

      if (!validation.success || !validation.valid) {
        setStatus('error');
        setMessage(validation.error || 'QR code expired — scan the screen again.');
        return;
      }

      const resolvedLocationId = validation.locationId ?? locationId;
      const session = sessionResult.data.session;

      if (!session?.user) {
        const returnPath = buildClockInEntryPath(resolvedLocationId, token);
        setStatus('need_login');
        setMessage('Sign in to finish…');
        navigate('/login', {
          replace: true,
          state: { from: returnPath },
        });
        return;
      }

      const profileResult = await fetchClockInGateProfile(session.user.id, {
        email: session.user.email,
      });
      if (cancelled) return;
      if (profileResult.queryFailed) {
        setStatus('error');
        setMessage('Could not verify your employee profile. Please try again.');
        return;
      }
      const profile = profileResult.profile;
      if (profile.isExternalUser) {
        setStatus('success');
        setMessage('Signed in. External accounts skip office clock-in.');
        window.setTimeout(() => navigate('/', { replace: true }), 900);
        return;
      }
      if (!profileResult.userRowFound || profile.employeeId == null) {
        setStatus('no_employee');
        setMessage('Your account is not linked to an employee profile. Contact an admin.');
        return;
      }

      const employeeId = profile.employeeId;
      const [profileInfo, activeRecord] = await Promise.all([
        resolveEmployeeProfile(employeeId, session.user.email),
        fetchActiveClockInRecord(employeeId),
      ]);
      if (cancelled) return;

      const { name, photoUrl: nextPhotoUrl } = profileInfo;
      setDisplayName(name);
      setPhotoUrl(nextPhotoUrl);

      const nowIso = new Date().toISOString();

      if (activeRecord) {
        setStatus('clocking_out');
        setMessage('Clocking you out…');
        setAction('out');

        let outAt = nowIso;
        let outRemark: string | null = null;
        try {
          const adjustment = await fetchMeetingClockAdjustment(
            employeeId,
            'out',
            activeRecord.clock_in_time,
          );
          if (adjustment.success) {
            if (adjustment.remark) outRemark = adjustment.remark;
            // End-time override only for internal/external (backend sets adjusted=true).
            if (adjustment.adjusted && adjustment.adjustedAt) {
              outAt = adjustment.adjustedAt;
            }
          }
        } catch (adjErr) {
          console.warn('Meeting clock-out adjustment skipped:', adjErr);
        }

        try {
          await clockOutEmployeeRecord(
            {
              ...activeRecord,
              clock_in_location_id: activeRecord.clock_in_location_id || resolvedLocationId,
            },
            { skipGeolocation: true, clockOutTime: outAt },
          );
        } catch (err) {
          console.error('Entry kiosk clock-out failed:', err);
          if (!cancelled) {
            setStatus('error');
            setMessage(
              err instanceof Error
                ? err.message
                : 'Failed to clock out. Please try again from the CRM.',
            );
          }
          return;
        }

        finishSuccess(
          'out',
          name,
          nextPhotoUrl,
          employeeId,
          resolvedLocationId,
          outAt,
          outRemark,
        );
        return;
      }

      setStatus('clocking_in');
      setMessage('Clocking you in…');
      setAction('in');

      let inAt = nowIso;
      let inRemark: string | null = null;
      try {
        const adjustment = await fetchMeetingClockAdjustment(employeeId, 'in');
        if (adjustment.success) {
          if (adjustment.remark) inRemark = adjustment.remark;
          if (adjustment.adjusted && adjustment.adjustedAt) {
            inAt = adjustment.adjustedAt;
          }
        }
      } catch (adjErr) {
        console.warn('Meeting clock-in adjustment skipped:', adjErr);
      }

      const payload = {
        employee_id: employeeId,
        user_id: session.user.id,
        clock_in_time: inAt,
        clock_in_location_id: resolvedLocationId,
        notes: 'Entry kiosk QR',
        is_active: true,
        manually: false,
        approved: true,
        declined: false,
      };

      let { error } = await supabase.from('employee_clock_in').insert(payload).select('id').single();
      if (error) {
        const { clock_in_location_id: _drop, ...withoutPreset } = payload;
        const retry = await supabase.from('employee_clock_in').insert(withoutPreset).select('id').single();
        error = retry.error;
      }
      if (cancelled) return;

      if (error) {
        console.error('Entry kiosk clock-in failed:', error);
        setStatus('error');
        setMessage(error.message || 'Failed to clock in. Please try again from the CRM.');
        return;
      }

      finishSuccess(
        'in',
        name,
        nextPhotoUrl,
        employeeId,
        resolvedLocationId,
        inAt,
        inRemark,
      );
    };

    void run();
    return () => {
      cancelled = true;
      clearWelcomeTimers();
    };
  }, [token, locationId, navigate, clearWelcomeTimers]);

  if (status === 'success' && displayName && clockedAt) {
    return (
      <KioskWelcomeGoodbyeModal
        action={action}
        employeeName={displayName}
        photoUrl={photoUrl}
        clockedAt={clockedAt}
        meetings={welcomeMeetings}
        remark={remark}
        secondsLeft={secondsLeft}
        totalSeconds={KIOSK_WELCOME_DURATION_SEC}
        now={now}
        variant="page"
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
            <Link to="/login" className="btn btn-primary btn-sm">
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
