import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, ClockIcon, CheckCircleIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { useAuthContext } from '../contexts/AuthContext';
import {
  detectClockInLocation,
  EMPTY_CLOCK_IN_LOCATION,
  locationToDbFields,
  type ClockInLocationData,
} from '../lib/employeeClockInLocation';
import {
  fetchActiveClockInLocations,
  fetchEmployeeWorksFromHome,
  filterManualSelectableClockInLocations,
  isHomeClockInLocation,
  isQrOnlyClockInLocation,
  isQrOnlyClockInLocationId,
  persistLastSelectedWorkplaceId,
  QR_ONLY_CLOCK_IN_LOCATION_ID,
  readLastSelectedWorkplaceId,
  resolveWorkplaceName,
  type ClockInLocationOption,
} from '../lib/clockInLocations';
import {
  fetchPendingHomeWfhApproval,
} from '../lib/employeeClockInApproval';
import { getGreetingFirstName, getTimeBasedGreeting } from '../lib/clockInGreeting';
import { clearClockInGateCache } from '../lib/clockInGateCache';
import { setClockInGateBlocksDataAccess } from '../lib/clockInGateFetchPolicy';
import {
  type HomeWfhApprovalSnapshot,
  useHomeWfhApprovalAutoClockIn,
} from '../hooks/useHomeWfhApprovalAutoClockIn';
import { useOptionalClockInGate } from '../hooks/useClockInGate';
import HomeWfhPeriodRequestModal from './HomeWfhPeriodRequestModal';
import {
  employeeHasApprovedWfhPeriodOnDate,
  fetchPendingWfhPeriodRequestCount,
} from '../lib/employeeWfhPeriodRequests';

interface ClockInModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  userId: string;
  /** Mandatory gate: no dismiss until clocked in */
  required?: boolean;
  /** Render inline (e.g. on login hero video) instead of portaling to document.body */
  embedded?: boolean;
  onClockInSuccess?: () => void;
  onSignOut?: () => void;
}

interface ClockInRecord {
  id: number;
  clock_in_time: string;
  clock_out_time: string | null;
  location_address: string | null;
  is_active: boolean;
  clock_in_location_id?: number | null;
  clock_in_place?: { name: string } | { name: string }[] | null;
}

const ClockInModal: React.FC<ClockInModalProps> = ({
  isOpen,
  onClose,
  employeeId,
  userId,
  required = false,
  embedded = false,
  onClockInSuccess,
  onSignOut,
}) => {
  const { user, userFullName } = useAuthContext();
  const gate = useOptionalClockInGate();
  const refreshClockInGate = gate?.refreshClockInGate;
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<ClockInRecord | null>(null);
  const [location, setLocation] = useState<ClockInLocationData>(EMPTY_CLOCK_IN_LOCATION);
  const [isLoading, setIsLoading] = useState(false);
  const [workplaceOptions, setWorkplaceOptions] = useState<ClockInLocationOption[]>([]);
  const [worksFromHome, setWorksFromHome] = useState(false);
  const [homePeriodAccessToday, setHomePeriodAccessToday] = useState(false);
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState<number | null>(null);
  const [successAction, setSuccessAction] = useState<'in' | 'out' | 'approval' | null>(null);
  const [pendingHomeApproval, setPendingHomeApproval] = useState(false);
  const [wfhPeriodModalOpen, setWfhPeriodModalOpen] = useState(false);
  const [workplaceDropdownOpen, setWorkplaceDropdownOpen] = useState(false);
  const [sessionDuration, setSessionDuration] = useState('');
  const [employeeDisplayName, setEmployeeDisplayName] = useState('');
  const workplaceDropdownRef = useRef<HTMLDivElement>(null);
  const autoClockInInFlightRef = useRef(false);
  const isClockedInRef = useRef(isClockedIn);
  isClockedInRef.current = isClockedIn;

  const updateSessionDuration = useCallback((clockInTime: string) => {
    const diffMs = Math.max(0, Date.now() - new Date(clockInTime).getTime());
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    setSessionDuration(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
  }, []);

  const AUTO_CLOSE_MS = 1800;

  const greetingName = (
    employeeDisplayName
    || userFullName?.trim()
    || user?.email?.split('@')[0]
    || ''
  ).trim();
  const greetingFirstName = getGreetingFirstName(greetingName);
  const isGateStyle = embedded;
  const greetingGradientStyle = {
    background: 'linear-gradient(to right, #7c3aed, #6366f1)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  } as const;
  const gateGreetingHeadingClass =
    'text-base md:text-2xl font-semibold leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)]';
  const gateGreetingHeadingStyle = {
    fontFamily: "'Playfair Display', 'Libre Baskerville', serif",
  } as const;
  const appGreetingHeadingClass = 'text-base md:text-lg font-extrabold leading-snug';

  useEffect(() => {
    if (!isOpen) {
      setSuccessAction(null);
      setWorkplaceDropdownOpen(false);
      setEmployeeDisplayName('');
      return;
    }
    void Promise.all([
      fetchActiveClockInLocations(),
      fetchEmployeeWorksFromHome(employeeId),
      fetchPendingHomeWfhApproval(employeeId).catch(() => false),
      fetchPendingWfhPeriodRequestCount(employeeId).catch(() => false),
      employeeHasApprovedWfhPeriodOnDate(employeeId).catch(() => false),
      supabase
        .from('tenants_employee')
        .select('display_name')
        .eq('id', employeeId)
        .maybeSingle(),
    ]).then(([locations, wfh, pendingLegacy, pendingPeriod, periodToday, employeeResult]) => {
      const selectable = filterManualSelectableClockInLocations(locations);
      setWorkplaceOptions(selectable);
      setWorksFromHome(wfh);
      setHomePeriodAccessToday(periodToday);
      setPendingHomeApproval((pendingLegacy || pendingPeriod) && !wfh && !periodToday);
      setEmployeeDisplayName(employeeResult.data?.display_name?.trim() || '');
      // Initialize selection (prefer last selected if still valid — never QR-only offices)
      setSelectedWorkplaceId((prev) => {
        // Keep Ramat Gan selected when clocked in via QR (Clock Out stays disabled).
        if (prev != null && isQrOnlyClockInLocationId(prev)) return prev;
        if (prev != null && selectable.some((o) => o.id === prev)) return prev;
        const last = readLastSelectedWorkplaceId();
        if (last != null && isQrOnlyClockInLocationId(last)) {
          return selectable[0]?.id ?? null;
        }
        const validLast = last != null && selectable.some((o) => o.id === last);
        return validLast ? last : selectable[0]?.id ?? null;
      });
    }).catch((error) => {
      console.error('Error loading clock-in modal data:', error);
    });
  }, [isOpen, employeeId]);

  useEffect(() => {
    if (isOpen && employeeId) {
      fetchClockInStatus();
    }
  }, [isOpen, employeeId]);

  // Get user's location when modal opens
  useEffect(() => {
    if (isOpen) {
      getLocation();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!successAction) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const action = successAction;
        setSuccessAction(null);
        if (action === 'in') {
          if (!required) {
            onClockInSuccess?.();
          }
        }
        if (!required) {
          onClose();
        }
      })();
    }, AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [successAction, onClose, onClockInSuccess, required]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isClockedIn || !currentRecord?.clock_in_time) {
      setSessionDuration('');
      return;
    }
    updateSessionDuration(currentRecord.clock_in_time);
    const interval = window.setInterval(() => {
      updateSessionDuration(currentRecord.clock_in_time);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [isOpen, isClockedIn, currentRecord?.clock_in_time, updateSessionDuration]);

  useEffect(() => {
    if (!workplaceDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        workplaceDropdownRef.current
        && !workplaceDropdownRef.current.contains(event.target as Node)
      ) {
        setWorkplaceDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [workplaceDropdownOpen]);

  const getLocation = async () => {
    try {
      setLocation(await detectClockInLocation());
    } catch (error) {
      console.error('Error getting location:', error);
      setLocation(EMPTY_CLOCK_IN_LOCATION);
    }
  };

  const fetchClockInStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('employee_clock_in')
        .select(
          `id, clock_in_time, clock_out_time, location_address, is_active, clock_in_location_id,
           clock_in_place:clock_in_locations!clock_in_location_id ( name )`,
        )
        .eq('employee_id', employeeId)
        .eq('is_active', true)
        .order('clock_in_time', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setIsClockedIn(true);
        setCurrentRecord(data);
        if (data.clock_in_location_id != null) {
          // QR Ramat Gan stays selected by default so Clock Out stays disabled until another workplace is chosen.
          setSelectedWorkplaceId(data.clock_in_location_id);
        }
      } else {
        setIsClockedIn(false);
        setCurrentRecord(null);
      }
    } catch (error) {
      console.error('Error fetching clock-in status:', error);
      toast.error('Failed to fetch clock-in status');
    }
  };

  const selectedWorkplace = workplaceOptions.find((o) => o.id === selectedWorkplaceId) ?? null;
  const selectedIsHome = selectedWorkplace != null && isHomeClockInLocation(selectedWorkplace);
  const canClockInFromHome = worksFromHome || homePeriodAccessToday;
  const homeNeedsApproval = selectedIsHome && !canClockInFromHome;
  const awaitingWfhApproval = pendingHomeApproval || successAction === 'approval';
  const clockedInAtQrOnlyOffice =
    Boolean(isClockedIn)
    && isQrOnlyClockInLocationId(currentRecord?.clock_in_location_id);

  // Default clock-out picker to Ramat Gan (QR) so Clock Out stays disabled until they pick elsewhere.
  useEffect(() => {
    if (!clockedInAtQrOnlyOffice) return;
    const ramatGanId = currentRecord?.clock_in_location_id ?? QR_ONLY_CLOCK_IN_LOCATION_ID;
    if (selectedWorkplaceId == null) {
      setSelectedWorkplaceId(ramatGanId);
    }
  }, [clockedInAtQrOnlyOffice, currentRecord?.clock_in_location_id, selectedWorkplaceId]);

  const ramatGanClockOutOption: ClockInLocationOption = {
    id: currentRecord?.clock_in_location_id ?? QR_ONLY_CLOCK_IN_LOCATION_ID,
    name: resolveWorkplaceName(currentRecord, 'in') || 'Ramat Gan - Office',
    slug: 'ramat-gan-office',
  };

  const clockOutPickerOptions: ClockInLocationOption[] = clockedInAtQrOnlyOffice
    ? [
        ramatGanClockOutOption,
        ...workplaceOptions.filter((o) => o.id !== ramatGanClockOutOption.id),
      ]
    : workplaceOptions;

  const selectedWorkplaceName =
    clockOutPickerOptions.find((o) => o.id === selectedWorkplaceId)?.name
    ?? (isQrOnlyClockInLocationId(selectedWorkplaceId)
      ? resolveWorkplaceName(currentRecord, 'in')
      : '');

  const workplaceDisplayLabel = selectedWorkplaceName
    || (clockOutPickerOptions.length === 0 ? 'Loading workplaces…' : 'Select workplace');

  const performClockIn = useCallback(async (options?: {
    skipHomeApprovalCheck?: boolean;
    workplaceId?: number;
  }): Promise<boolean> => {
    if (!employeeId || !userId) {
      toast.error('Missing employee or user information');
      return false;
    }

    const workplaceId = options?.workplaceId ?? selectedWorkplaceId;
    if (!workplaceId) {
      toast.error('Please select a workplace');
      return false;
    }

    const workplace = workplaceOptions.find((o) => o.id === workplaceId) ?? null;
    if (workplace != null && isQrOnlyClockInLocation(workplace)) {
      toast.error('Ramat Gan Office clock-in is only available via the office QR code.');
      return false;
    }
    if (isQrOnlyClockInLocationId(workplaceId)) {
      toast.error('Ramat Gan Office clock-in is only available via the office QR code.');
      return false;
    }
    const clockingInFromHome = workplace != null && isHomeClockInLocation(workplace);
    if (clockingInFromHome && !worksFromHome && !homePeriodAccessToday && !options?.skipHomeApprovalCheck) {
      toast.error('You cannot clock in from Home until an admin approves your work-from-home period.');
      return false;
    }

    setIsLoading(true);
    try {
      const payload = {
        employee_id: employeeId,
        user_id: userId,
        clock_in_time: new Date().toISOString(),
        clock_in_location_id: workplaceId,
        ...locationToDbFields(location),
        notes: null,
        is_active: true,
        manually: false,
        approved: true,
        declined: false,
      };
      let { data, error } = await supabase.from('employee_clock_in').insert(payload).select().single();

      if (error) {
        const { clock_in_location_id: _drop, ...withoutPreset } = payload;
        const retry = await supabase.from('employee_clock_in').insert(withoutPreset).select().single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;

      persistLastSelectedWorkplaceId(workplaceId);
      setIsClockedIn(true);
      if (data) {
        setCurrentRecord(data as ClockInRecord);
      }
      setSuccessAction('in');
      if (required) {
        onClockInSuccess?.();
      }
      return true;
    } catch (error: any) {
      console.error('Error clocking in:', error);
      toast.error(error.message || 'Failed to clock in');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [employeeId, userId, selectedWorkplaceId, workplaceOptions, worksFromHome, homePeriodAccessToday, location, required, onClockInSuccess]);

  const handleWfhApprovalGranted = useCallback(async (snapshot: HomeWfhApprovalSnapshot) => {
    if (!employeeId || !userId || isClockedInRef.current || autoClockInInFlightRef.current) return;

    setWorksFromHome(snapshot.worksFromHome);
    setHomePeriodAccessToday(snapshot.canClockInFromHome);
    setPendingHomeApproval(snapshot.pendingApproval && !snapshot.canClockInFromHome);
    setSuccessAction((current) => (current === 'approval' ? null : current));

    const homeWorkplace =
      workplaceOptions.find((o) => o.id === selectedWorkplaceId && isHomeClockInLocation(o))
      ?? workplaceOptions.find(isHomeClockInLocation)
      ?? null;

    if (!homeWorkplace) {
      toast.success('Home access approved! You can now clock in from Home.');
      return;
    }

    if (selectedWorkplaceId !== homeWorkplace.id) {
      setSelectedWorkplaceId(homeWorkplace.id);
    }

    autoClockInInFlightRef.current = true;
    try {
      toast.success('Home access approved — clocking you in...');
      await performClockIn({
        skipHomeApprovalCheck: true,
        workplaceId: homeWorkplace.id,
      });
    } finally {
      autoClockInInFlightRef.current = false;
    }
  }, [employeeId, userId, workplaceOptions, selectedWorkplaceId, performClockIn]);

  useHomeWfhApprovalAutoClockIn({
    employeeId,
    enabled: isOpen && !!employeeId && !isClockedIn && awaitingWfhApproval,
    onApprovalGranted: handleWfhApprovalGranted,
  });

  useEffect(() => {
    if (!isOpen) {
      autoClockInInFlightRef.current = false;
    }
  }, [isOpen]);

  const handleSendHomeForApproval = () => {
    if (!employeeId || !userId) {
      toast.error('Missing employee or user information');
      return;
    }
    if (pendingHomeApproval) {
      toast('You already have a pending work-from-home approval request.');
      return;
    }
    setWfhPeriodModalOpen(true);
  };

  const handleClockIn = async () => {
    await performClockIn();
  };

  const handleClockOut = async () => {
    if (!currentRecord) {
      toast.error('No active clock-in record found');
      return;
    }

    const clockedInAtRamatGanQr = isQrOnlyClockInLocationId(currentRecord.clock_in_location_id);
    let clockOutLocationId: number | null | undefined;

    if (clockedInAtRamatGanQr) {
      // May leave Ramat Gan by clocking out at another workplace; Ramat Gan itself stays QR-only.
      clockOutLocationId = selectedWorkplaceId;
      if (!clockOutLocationId || isQrOnlyClockInLocationId(clockOutLocationId)) {
        toast.error('Select another workplace to clock out, or scan the office QR code for Ramat Gan.');
        return;
      }
    } else {
      clockOutLocationId = currentRecord.clock_in_location_id ?? selectedWorkplaceId;
      if (!clockOutLocationId) {
        toast.error('Missing workplace for clock-out');
        return;
      }
      if (isQrOnlyClockInLocationId(clockOutLocationId)) {
        toast.error('Ramat Gan Office clock-out is only available via the office QR code.');
        return;
      }
    }

    // Leaving Ramat Gan QR session from another workplace = manual entry pending approval
    // (same as Working Hours → Add manual clock-in).
    const needsManualApproval = clockedInAtRamatGanQr;
    const clockOutWorkplace =
      clockOutPickerOptions.find((o) => o.id === clockOutLocationId)
      ?? workplaceOptions.find((o) => o.id === clockOutLocationId)
      ?? null;
    const clockingOutToHome =
      clockOutWorkplace != null && isHomeClockInLocation(clockOutWorkplace);

    setIsLoading(true);
    try {
      const outLocation = await detectClockInLocation();
      const approvalNotes = needsManualApproval
        ? [
            `Clocked out away from Ramat Gan Office (QR in) at ${
              clockOutWorkplace?.name || 'another workplace'
            }. Awaiting admin approval.`,
            clockingOutToHome && !worksFromHome
              ? 'Clock-out from Home — waiting for admin approval (auto-enables Works From Home when approved)'
              : null,
          ]
            .filter(Boolean)
            .join('\n')
        : null;

      const baseUpdate: Record<string, unknown> = {
        clock_out_time: new Date().toISOString(),
        is_active: false,
        notes: approvalNotes,
        clock_out_location_id: clockOutLocationId,
      };

      if (needsManualApproval) {
        baseUpdate.manually = true;
        baseUpdate.approved = false;
        baseUpdate.declined = false;
        baseUpdate.approved_by = null;
        baseUpdate.approved_at = null;
        baseUpdate.location_source = 'manual';
        baseUpdate.clock_out_location_source = 'manual';
      }

      const gpsFields = locationToDbFields(outLocation, 'clock_out_');
      let { error } = await supabase
        .from('employee_clock_in')
        .update({ ...baseUpdate, ...gpsFields })
        .eq('id', currentRecord.id);

      if (error) {
        const { clock_out_location_id: _drop, ...withoutPreset } = baseUpdate;
        const retry = await supabase
          .from('employee_clock_in')
          .update({ ...withoutPreset, ...gpsFields })
          .eq('id', currentRecord.id);
        error = retry.error;
      }
      if (error) {
        const retry2 = await supabase
          .from('employee_clock_in')
          .update({
            clock_out_time: baseUpdate.clock_out_time,
            is_active: false,
            notes: baseUpdate.notes,
            ...(needsManualApproval
              ? {
                  manually: true,
                  approved: false,
                  declined: false,
                  approved_by: null,
                  approved_at: null,
                }
              : {}),
          })
          .eq('id', currentRecord.id);
        error = retry2.error;
      }

      if (error) throw error;

      if (clockOutLocationId) {
        persistLastSelectedWorkplaceId(clockOutLocationId);
      }

      // Immediately flip to the clock-in gate (keep session). Don't wait for modal auto-close.
      clearClockInGateCache();
      setClockInGateBlocksDataAccess(true);
      try {
        await refreshClockInGate?.();
      } catch (gateError) {
        console.error('Clock-in gate refresh after clock-out failed:', gateError);
      }

      if (needsManualApproval) {
        setIsClockedIn(false);
        setCurrentRecord(null);
        setSuccessAction('approval');
        onClockInSuccess?.();
        toast.success('Clock-out submitted for approval');
      } else {
        onClockInSuccess?.();
        onClose();
        toast.success('Clocked out');
      }
    } catch (error: any) {
      console.error('Error clocking out:', error);
      toast.error(error.message || 'Failed to clock out');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const useCardLayout = clockedInAtQrOnlyOffice && !successAction;

  const dialogSurfaceClass = isGateStyle
    ? 'bg-gray-500/15 backdrop-blur-[24px] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.28)] text-white'
    : 'bg-white shadow-2xl text-gray-900';

  const dialogSizeClass = useCardLayout
    ? 'w-[min(400px,92vw)] h-auto max-h-[min(90dvh,640px)]'
    : isGateStyle
      ? 'w-[min(380px,92vw)] h-[min(380px,92vw)] md:w-[min(480px,88vh)] md:h-[min(480px,88vh)]'
      : 'w-[min(380px,92vw)] h-[min(380px,92vw)]';

  const dialogShapeClass = useCardLayout ? 'rounded-[1.75rem]' : 'rounded-full';

  const dialogPaddingClass = useCardLayout
    ? 'pt-7 pb-6'
    : isGateStyle
      ? 'pt-12 pb-6 md:pt-16 md:pb-8'
      : 'pt-12 pb-8 md:pt-14 md:pb-10';

  const workplacePicker = (
    <>
      <div className="hidden md:block relative" ref={workplaceDropdownRef}>
        <button
          type="button"
          onClick={() => setWorkplaceDropdownOpen((open) => !open)}
          disabled={clockOutPickerOptions.length === 0}
          className={`w-full h-11 px-4 flex items-center justify-between gap-2 rounded-xl border text-left transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed ${
            isGateStyle
              ? `bg-white/10 backdrop-blur-sm ${
                  workplaceDropdownOpen
                    ? 'border-[#d4af37]/50 ring-2 ring-[#d4af37]/15'
                    : 'border-white/15 hover:border-white/30'
                }`
              : `bg-white ${
                  workplaceDropdownOpen
                    ? 'border-violet-400 ring-2 ring-violet-100'
                    : 'border-gray-200 hover:border-gray-300'
                }`
          }`}
        >
          <span className={`font-medium truncate ${isGateStyle ? 'text-white' : 'text-gray-800'}`}>
            {workplaceDisplayLabel}
          </span>
          <ChevronDownIcon
            className={`w-4 h-4 shrink-0 transition-transform ${
              isGateStyle ? 'text-white/50' : 'text-gray-400'
            } ${workplaceDropdownOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {workplaceDropdownOpen && clockOutPickerOptions.length > 0 && (
          <div className="absolute z-30 w-full mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
            {clockOutPickerOptions.map((opt) => {
              const isSelected = opt.id === selectedWorkplaceId;
              const isQrOnly = isQrOnlyClockInLocationId(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setSelectedWorkplaceId(opt.id);
                    setWorkplaceDropdownOpen(false);
                  }}
                  className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-violet-50 text-violet-700 font-semibold'
                      : 'text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>{opt.name}</span>
                    {isQrOnly ? (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        QR only
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <select
        className={`select select-bordered w-full md:hidden rounded-xl h-11 min-h-11 text-sm ${
          isGateStyle ? 'bg-white/90 text-gray-900 border-white/30' : ''
        }`}
        value={selectedWorkplaceId ?? ''}
        onChange={(e) => setSelectedWorkplaceId(Number(e.target.value))}
        disabled={clockOutPickerOptions.length === 0}
      >
        {clockOutPickerOptions.length === 0 ? (
          <option value="">Loading…</option>
        ) : (
          clockOutPickerOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {isQrOnlyClockInLocationId(opt.id) ? `${opt.name} (QR only)` : opt.name}
            </option>
          ))
        )}
      </select>
    </>
  );

  const dialog = (
    <div
      className={`pointer-events-auto relative transform transition-all flex flex-col items-center text-center overflow-visible ${dialogShapeClass} ${dialogSizeClass} ${dialogPaddingClass} ${dialogSurfaceClass} ${
        useCardLayout ? 'justify-start' : 'justify-between'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Clock in"
      onClick={(e) => e.stopPropagation()}
    >

          {/* Close button */}
          {!required && (
            <button
              onClick={onClose}
              className={`absolute z-10 btn btn-sm btn-ghost btn-circle border-0 ${
                useCardLayout ? 'top-3 right-3' : 'top-7 right-7'
              } ${isGateStyle ? 'text-white hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'}`}
              title="Close"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          )}

          {successAction ? (
            <div className="flex flex-col items-center justify-center px-10 animate-fade-in">
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
                  successAction === 'approval'
                    ? 'bg-amber-500'
                    : successAction === 'in'
                      ? 'bg-green-500'
                      : 'bg-gray-600'
                }`}
              >
                <CheckCircleIcon className="w-10 h-10 text-white" />
              </div>
              <h2 className={`text-xl font-bold mb-1 ${isGateStyle ? 'md:text-2xl text-white' : 'text-gray-900'}`}>
                {successAction === 'approval'
                  ? 'Sent for approval!'
                  : successAction === 'in'
                    ? 'Clocked in!'
                    : 'Clocked out!'}
              </h2>
              {successAction === 'approval' ? (
                <p className={`text-sm ${isGateStyle ? 'md:text-base text-white/75' : 'text-gray-500'}`}>Waiting for admin approval.</p>
              ) : successAction === 'out' ? (
                <p className={`text-sm ${isGateStyle ? 'md:text-base text-white/75' : 'text-gray-500'}`}>
                  Returning to clock-in…
                </p>
              ) : selectedWorkplaceName ? (
                <p className={`text-sm ${isGateStyle ? 'md:text-base text-white/75' : 'text-gray-500'}`}>{selectedWorkplaceName}</p>
              ) : null}
              <p className={`text-xs mt-1 ${isGateStyle ? 'md:text-sm text-white/50' : 'text-gray-400'}`}>Closing automatically…</p>
            </div>
          ) : useCardLayout ? (
            <div className={`flex w-full flex-col items-stretch gap-4 px-6 ${isGateStyle ? 'md:px-8' : ''}`}>
              <div className="text-center pt-1">
                <p className={`text-2xl font-bold tabular-nums tracking-tight ${isGateStyle ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  {sessionDuration || 'Clocked In'}
                </p>
                <p className={`mt-1 text-sm font-semibold ${isGateStyle ? 'text-white/90' : 'text-gray-800'}`}>
                  {greetingFirstName
                    ? `Hi ${greetingFirstName}, ready to clock out?`
                    : 'Ready to clock out?'}
                </p>
              </div>

              <div
                className={`rounded-2xl border px-3.5 py-3 text-left ${
                  isGateStyle
                    ? 'border-white/12 bg-white/8'
                    : 'border-amber-100 bg-amber-50/90'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      isGateStyle
                        ? 'bg-[#d4af37]/20 text-[#f0d78c]'
                        : 'bg-amber-200/80 text-amber-900'
                    }`}
                  >
                    QR
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className={`text-sm font-semibold leading-snug ${isGateStyle ? 'text-white' : 'text-gray-900'}`}>
                      {resolveWorkplaceName(currentRecord, 'in')}
                    </p>
                    <p className={`text-xs leading-relaxed ${isGateStyle ? 'text-white/70' : 'text-amber-950/70'}`}>
                      Scan the office QR again to clock out there.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-left">
                <label className={`block text-xs font-semibold uppercase tracking-wide ${isGateStyle ? 'text-white/55' : 'text-gray-500'}`}>
                  Or clock out elsewhere
                </label>
                <p className={`text-xs leading-relaxed ${isGateStyle ? 'text-white/60' : 'text-gray-500'}`}>
                  Choosing another workplace submits a manual clock-out for admin approval.
                </p>
                {workplacePicker}
              </div>

              <button
                type="button"
                onClick={handleClockOut}
                disabled={
                  isLoading
                  || selectedWorkplaceId == null
                  || isQrOnlyClockInLocationId(selectedWorkplaceId)
                }
                className="btn mt-1 h-12 min-h-12 w-full gap-2 rounded-xl border-0 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-500 text-base font-semibold text-white shadow-md hover:from-violet-700 hover:via-purple-700 hover:to-indigo-600 disabled:opacity-60"
              >
                {isLoading ? (
                  <span className="loading loading-spinner loading-md" />
                ) : (
                  <>
                    <ClockIcon className="h-5 w-5" />
                    Clock Out
                  </>
                )}
              </button>
            </div>
          ) : (
            <>
            <div className={`flex flex-col items-center w-full flex-1 min-h-0 ${isGateStyle ? 'px-8 md:px-14' : 'px-8 md:px-10'}`}>
              {/* Status text */}
              <div
                className={`text-center w-full ${
                  isGateStyle && !isClockedIn
                    ? 'mb-8 md:hidden'
                    : isGateStyle
                      ? 'mb-8 md:mb-6'
                      : 'mb-8 md:mb-10'
                }`}
              >
                {isClockedIn ? (
                  <>
                    <p className={`text-lg font-extrabold leading-tight ${isGateStyle ? 'md:text-2xl text-emerald-400' : 'text-green-700'}`}>
                      {sessionDuration
                        ? <span className="tabular-nums">{sessionDuration}</span>
                        : 'Clocked In'}
                    </p>
                    {isGateStyle ? (
                      <p className={`${gateGreetingHeadingClass} mt-1`} style={gateGreetingHeadingStyle}>
                        {greetingFirstName
                          ? `Hi ${greetingFirstName}, ready to clock out?`
                          : 'Ready to clock out?'}
                      </p>
                    ) : (
                      <p className={`${appGreetingHeadingClass} mt-1`} style={greetingGradientStyle}>
                        {greetingFirstName
                          ? `Hi ${greetingFirstName}, ready to clock out?`
                          : 'Ready to clock out?'}
                      </p>
                    )}
                  </>
                ) : isGateStyle ? (
                  <p className={gateGreetingHeadingClass} style={gateGreetingHeadingStyle}>
                    {greetingFirstName
                      ? `${getTimeBasedGreeting()}, ${greetingFirstName}`
                      : getTimeBasedGreeting()}
                  </p>
                ) : (
                  <p className={appGreetingHeadingClass} style={greetingGradientStyle}>
                    {greetingFirstName
                      ? `${getTimeBasedGreeting()}, ${greetingFirstName}`
                      : getTimeBasedGreeting()}
                  </p>
                )}
              </div>

              <div className={`flex flex-col items-center w-full ${isGateStyle ? 'gap-5 md:gap-7' : 'gap-5'}`}>
              {/* Main action button */}
              {!isClockedIn ? (
                homeNeedsApproval ? (
                  <button
                    type="button"
                    onClick={handleSendHomeForApproval}
                    disabled={isLoading || pendingHomeApproval}
                    className="btn rounded-full h-20 min-h-20 px-10 gap-3 border-0 shadow-md bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 text-white hover:from-amber-600 hover:via-orange-600 hover:to-amber-600 hover:shadow-lg transition-all duration-200 disabled:opacity-60 md:h-[4.5rem] md:min-h-[4.5rem] md:px-12 md:gap-3"
                  >
                    {isLoading ? (
                      <span className="loading loading-spinner loading-md" />
                    ) : (
                      <>
                        <ClockIcon className="w-6 h-6 md:w-7 md:h-7" />
                        <span className="font-semibold text-lg md:text-xl">
                          {pendingHomeApproval ? 'Approval pending' : 'Send for approval'}
                        </span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleClockIn}
                    disabled={isLoading}
                    className="btn rounded-full h-20 min-h-20 px-10 gap-3 border-0 shadow-lg bg-gradient-to-r from-green-600 via-emerald-600 to-teal-500 text-white hover:from-green-700 hover:via-emerald-700 hover:to-teal-600 hover:shadow-xl transition-all duration-200 disabled:opacity-60 text-lg md:h-[5rem] md:min-h-[5rem] md:px-12 md:gap-3 md:text-xl"
                  >
                    {isLoading ? (
                      <span className="loading loading-spinner loading-md md:loading-lg" />
                    ) : (
                      <>
                        <ClockIcon className="w-8 h-8 md:w-9 md:h-9" />
                        <span className="font-semibold">Clock In</span>
                      </>
                    )}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={handleClockOut}
                  disabled={isLoading}
                  className="btn rounded-full h-20 min-h-20 px-10 gap-3 border-0 shadow-lg bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-500 text-white hover:from-violet-700 hover:via-purple-700 hover:to-indigo-600 hover:shadow-xl transition-all duration-200 disabled:opacity-60 text-lg md:h-[5rem] md:min-h-[5rem] md:px-12 md:gap-3 md:text-xl"
                >
                  {isLoading ? (
                    <span className="loading loading-spinner loading-md md:loading-lg" />
                  ) : (
                    <>
                      <ClockIcon className="w-6 h-6 md:w-8 md:h-8" />
                      <span className="font-semibold">Clock Out</span>
                    </>
                  )}
                </button>
              )}

              {/* Workplace */}
              <div className="w-full">
                {isClockedIn && currentRecord ? (
                  <div
                    className={`h-10 md:h-12 flex items-center justify-center rounded-full px-4 font-medium text-sm md:text-base ${
                      isGateStyle
                        ? 'border border-white/12 bg-white/8 backdrop-blur-sm text-white/90'
                        : 'border border-gray-200 bg-gray-50 text-gray-700'
                    }`}
                  >
                    {resolveWorkplaceName(currentRecord, 'in')}
                  </div>
                ) : (
                  <>
                    {workplacePicker}
                    {homeNeedsApproval && (
                      <p className={`mt-1.5 text-xs md:text-sm ${isGateStyle ? 'text-amber-300' : 'text-amber-700'}`}>
                        {pendingHomeApproval
                          ? 'Home access is pending approval.'
                          : 'Home needs approval for a selected period.'}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
            </div>

            {required && onSignOut && (
              <div className="w-full shrink-0 px-8 md:px-14 pb-2 text-center flex flex-col items-center gap-2">
                {isGateStyle && (
                  <img
                    src="/DPLOGO1.png"
                    alt="Decker Pex & Co."
                    className="hidden md:block h-9 w-auto max-w-[7.5rem] object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
                  />
                )}
                <button
                  type="button"
                  className="text-xs md:text-sm text-white/50 hover:text-white/80 transition-colors"
                  onClick={onSignOut}
                >
                  Sign out instead
                </button>
              </div>
            )}
            </>
          )}
    </div>
  );

  if (embedded) {
    return (
      <>
        {dialog}
        <HomeWfhPeriodRequestModal
          isOpen={wfhPeriodModalOpen}
          employeeId={employeeId}
          userId={userId}
          onClose={() => setWfhPeriodModalOpen(false)}
          onSubmitted={() => {
            setPendingHomeApproval(true);
            setSuccessAction('approval');
          }}
        />
      </>
    );
  }

  return (
    <>
      {createPortal(
        <div
          className="fixed inset-0 z-[10050] overflow-y-auto overscroll-contain"
          role="presentation"
        >
          <div
            className={`fixed inset-0 transition-opacity ${required ? 'bg-transparent' : 'bg-black/50'}`}
            onClick={required ? undefined : onClose}
            aria-hidden="true"
          />
          <div
            className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
            style={{
              paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
            }}
          >
            {dialog}
          </div>
        </div>,
        document.body,
      )}
      <HomeWfhPeriodRequestModal
        isOpen={wfhPeriodModalOpen}
        employeeId={employeeId}
        userId={userId}
        onClose={() => setWfhPeriodModalOpen(false)}
        onSubmitted={() => {
          setPendingHomeApproval(true);
          setSuccessAction('approval');
        }}
      />
    </>
  );
};

export default ClockInModal;
