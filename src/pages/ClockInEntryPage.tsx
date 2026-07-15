import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import {
  ENTRY_KIOSK_DEFAULT_LOCATION_ID,
  announceClockInKioskSuccess,
  buildClockInEntryPath,
  validateClockInKioskToken,
  type ClockInKioskFlashAction,
} from '../lib/clockInKioskApi';
import { fetchClockInGateProfile } from '../lib/employeeClockInGate';
import {
  clockOutEmployeeRecord,
  fetchActiveClockInRecord,
} from '../lib/employeeClockOut';
import { clearClockInGateCache } from '../lib/clockInGateCache';

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
  const [clockTime, setClockTime] = useState<string | null>(null);
  const [action, setAction] = useState<ClockInKioskFlashAction>('in');

  useEffect(() => {
    let cancelled = false;

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

      const validation = await validateClockInKioskToken(token, locationId);
      if (cancelled) return;
      if (!validation.success || !validation.valid) {
        setStatus('error');
        setMessage(validation.error || 'QR code expired — scan the screen again.');
        return;
      }

      const resolvedLocationId = validation.locationId ?? locationId;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;

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
        window.setTimeout(() => navigate('/', { replace: true }), 1200);
        return;
      }
      if (!profileResult.userRowFound || profile.employeeId == null) {
        setStatus('no_employee');
        setMessage('Your account is not linked to an employee profile. Contact an admin.');
        return;
      }

      const { name, photoUrl } = await resolveEmployeeProfile(profile.employeeId, session.user.email);
      if (cancelled) return;
      setDisplayName(name);

      const activeRecord = await fetchActiveClockInRecord(profile.employeeId);
      if (cancelled) return;

      const nowIso = new Date().toISOString();
      const timeLabel = new Date(nowIso).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      if (activeRecord) {
        setStatus('clocking_out');
        setMessage('Clocking you out…');
        setAction('out');

        try {
          await clockOutEmployeeRecord({
            ...activeRecord,
            clock_in_location_id: activeRecord.clock_in_location_id || resolvedLocationId,
          });
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
        if (cancelled) return;

        setClockTime(timeLabel);
        setStatus('success');
        setMessage('You are clocked out');
        clearClockInGateCache();

        try {
          await announceClockInKioskSuccess(
            resolvedLocationId,
            name,
            photoUrl,
            profile.employeeId,
            'out',
          );
        } catch (err) {
          console.warn('Kiosk announce failed:', err);
        }

        window.setTimeout(() => navigate('/', { replace: true }), 1600);
        return;
      }

      setStatus('clocking_in');
      setMessage('Clocking you in…');
      setAction('in');

      const payload = {
        employee_id: profile.employeeId,
        user_id: session.user.id,
        clock_in_time: nowIso,
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

      setClockTime(timeLabel);
      setStatus('success');
      setMessage('You are clocked in');
      clearClockInGateCache();

      try {
        await announceClockInKioskSuccess(
          resolvedLocationId,
          name,
          photoUrl,
          profile.employeeId,
          'in',
        );
      } catch (err) {
        console.warn('Kiosk announce failed:', err);
      }

      window.setTimeout(() => navigate('/', { replace: true }), 1600);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [token, locationId, navigate]);

  const title =
    status === 'error'
      ? 'Clock failed'
      : status === 'need_login'
        ? 'Sign in required'
        : status === 'no_employee'
          ? 'Account not linked'
          : status === 'success'
            ? action === 'out'
              ? 'You are out'
              : 'You are in'
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
      <div className="w-full max-w-md rounded-[28px] bg-white/95 p-8 text-center shadow-[0_30px_70px_rgba(0,0,0,0.4)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Office entry
        </p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">{title}</h1>

        {status === 'success' ? (
          <div className="mt-6 flex flex-col items-center">
            <div
              className={[
                'mb-4 flex h-16 w-16 items-center justify-center rounded-full ring-2',
                action === 'out'
                  ? 'bg-amber-500/15 ring-amber-500/50'
                  : 'bg-emerald-500/15 ring-emerald-500/50',
              ].join(' ')}
            >
              <CheckIcon
                className={`h-8 w-8 ${action === 'out' ? 'text-amber-600' : 'text-emerald-600'}`}
                strokeWidth={2.5}
              />
            </div>
            {displayName ? (
              <p className="text-xl font-semibold text-slate-900">{displayName}</p>
            ) : null}
            <p className={`mt-1 text-sm ${action === 'out' ? 'text-amber-700' : 'text-emerald-700'}`}>
              {message}
            </p>
            {clockTime ? (
              <p className="mt-4 text-3xl font-semibold tabular-nums text-slate-800">{clockTime}</p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">{message}</p>
        )}

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
