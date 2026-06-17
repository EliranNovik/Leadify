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
  isHomeClockInLocation,
  persistLastSelectedWorkplaceId,
  readLastSelectedWorkplaceId,
  resolveWorkplaceName,
  type ClockInLocationOption,
} from '../lib/clockInLocations';
import {
  fetchPendingHomeWfhApproval,
  insertHomeWfhApprovalRequest,
} from '../lib/employeeClockInApproval';
import { getGreetingFirstName, getTimeBasedGreeting } from '../lib/clockInGreeting';
import { clearClockInGateCache } from '../lib/clockInGateCache';

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
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<ClockInRecord | null>(null);
  const [location, setLocation] = useState<ClockInLocationData>(EMPTY_CLOCK_IN_LOCATION);
  const [isLoading, setIsLoading] = useState(false);
  const [workplaceOptions, setWorkplaceOptions] = useState<ClockInLocationOption[]>([]);
  const [worksFromHome, setWorksFromHome] = useState(false);
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState<number | null>(null);
  const [successAction, setSuccessAction] = useState<'in' | 'out' | 'approval' | null>(null);
  const [pendingHomeApproval, setPendingHomeApproval] = useState(false);
  const [workplaceDropdownOpen, setWorkplaceDropdownOpen] = useState(false);
  const [sessionDuration, setSessionDuration] = useState('');
  const [employeeDisplayName, setEmployeeDisplayName] = useState('');
  const workplaceDropdownRef = useRef<HTMLDivElement>(null);

  const updateSessionDuration = useCallback((clockInTime: string) => {
    const diffMs = Math.max(0, Date.now() - new Date(clockInTime).getTime());
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    setSessionDuration(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
  }, []);

  const AUTO_CLOSE_MS = 1800;

  const selectedWorkplaceName =
    workplaceOptions.find((o) => o.id === selectedWorkplaceId)?.name ?? '';

  const workplaceDisplayLabel = selectedWorkplaceName
    || (workplaceOptions.length === 0 ? 'Loading workplaces…' : 'Select workplace');

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
      fetchPendingHomeWfhApproval(employeeId),
      supabase
        .from('tenants_employee')
        .select('display_name')
        .eq('id', employeeId)
        .maybeSingle(),
    ]).then(([locations, wfh, pendingApproval, employeeResult]) => {
      setWorkplaceOptions(locations);
      setWorksFromHome(wfh);
      setPendingHomeApproval(pendingApproval);
      setEmployeeDisplayName(employeeResult.data?.display_name?.trim() || '');
      // Initialize selection (prefer last selected if still valid)
      setSelectedWorkplaceId((prev) => {
        if (prev != null && locations.some((o) => o.id === prev)) return prev;
        const last = readLastSelectedWorkplaceId();
        const validLast = last != null && locations.some((o) => o.id === last);
        return validLast ? last : locations[0]?.id ?? null;
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
          onClockInSuccess?.();
        }
        if (action === 'out') {
          clearClockInGateCache();
          const { error } = await supabase.auth.signOut();
          if (error) {
            console.error('Error signing out after clock-out:', error);
            toast.error('Clocked out but failed to sign out');
            onClose();
            return;
          }
          window.location.href = '/login';
          return;
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
  const homeNeedsApproval = selectedIsHome && !worksFromHome;

  const handleSendHomeForApproval = async () => {
    if (!employeeId || !userId) {
      toast.error('Missing employee or user information');
      return;
    }
    if (!selectedWorkplaceId) {
      toast.error('Please select a workplace');
      return;
    }
    if (pendingHomeApproval) {
      toast('You already have a pending work-from-home approval request.');
      return;
    }

    setIsLoading(true);
    try {
      await insertHomeWfhApprovalRequest(employeeId, userId, selectedWorkplaceId);
      setPendingHomeApproval(true);
      setSuccessAction('approval');
    } catch (error: any) {
      console.error('Error sending home approval request:', error);
      toast.error(error.message || 'Failed to send approval request');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockIn = async () => {
    if (!employeeId || !userId) {
      toast.error('Missing employee or user information');
      return;
    }
    if (!selectedWorkplaceId) {
      toast.error('Please select a workplace');
      return;
    }
    if (homeNeedsApproval) {
      toast.error('You cannot clock in from Home until an admin approves your work-from-home access.');
      return;
    }

    setIsLoading(true);
    try {
      const payload = {
        employee_id: employeeId,
        user_id: userId,
        clock_in_time: new Date().toISOString(),
        clock_in_location_id: selectedWorkplaceId,
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

      persistLastSelectedWorkplaceId(selectedWorkplaceId);

      setSuccessAction('in');
    } catch (error: any) {
      console.error('Error clocking in:', error);
      toast.error(error.message || 'Failed to clock in');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!currentRecord) {
      toast.error('No active clock-in record found');
      return;
    }

    const clockOutLocationId =
      currentRecord.clock_in_location_id ?? selectedWorkplaceId;
    if (!clockOutLocationId) {
      toast.error('Missing workplace for clock-out');
      return;
    }

    setIsLoading(true);
    try {
      const outLocation = await detectClockInLocation();
      const baseUpdate = {
        clock_out_time: new Date().toISOString(),
        is_active: false,
        notes: null,
        clock_out_location_id: clockOutLocationId,
      };
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
          })
          .eq('id', currentRecord.id);
        error = retry2.error;
      }

      if (error) throw error;

      if (clockOutLocationId) {
        persistLastSelectedWorkplaceId(clockOutLocationId);
      }

      setSuccessAction('out');
    } catch (error: any) {
      console.error('Error clocking out:', error);
      toast.error(error.message || 'Failed to clock out');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const dialogSurfaceClass = isGateStyle
    ? 'bg-gray-500/15 backdrop-blur-[24px] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.28)] text-white'
    : 'bg-white shadow-2xl text-gray-900';

  const dialogSizeClass = isGateStyle
    ? 'w-[min(380px,92vw)] h-[min(380px,92vw)] md:w-[min(480px,88vh)] md:h-[min(480px,88vh)]'
    : 'w-[min(380px,92vw)] h-[min(380px,92vw)]';

  const dialogPaddingClass = isGateStyle
    ? 'pt-12 pb-6 md:pt-16 md:pb-8'
    : 'pt-12 pb-8 md:pt-14 md:pb-10';

  const dialog = (
    <div
      className={`pointer-events-auto relative rounded-full transform transition-all flex flex-col items-center justify-between text-center ${dialogSizeClass} ${dialogPaddingClass} ${dialogSurfaceClass}`}
      role="dialog"
      aria-modal="true"
      aria-label="Clock in"
      onClick={(e) => e.stopPropagation()}
    >

          {/* Close button */}
          {!required && (
            <button
              onClick={onClose}
              className={`absolute top-7 right-7 btn btn-sm btn-ghost btn-circle z-10 border-0 ${
                isGateStyle ? 'text-white hover:bg-white/10' : ''
              }`}
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
                <p className={`text-sm ${isGateStyle ? 'md:text-base text-white/75' : 'text-gray-500'}`}>Signing you out…</p>
              ) : selectedWorkplaceName ? (
                <p className={`text-sm ${isGateStyle ? 'md:text-base text-white/75' : 'text-gray-500'}`}>{selectedWorkplaceName}</p>
              ) : null}
              <p className={`text-xs mt-1 ${isGateStyle ? 'md:text-sm text-white/50' : 'text-gray-400'}`}>Closing automatically…</p>
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
                    {/* Desktop dropdown */}
                    <div className="hidden md:block relative" ref={workplaceDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setWorkplaceDropdownOpen((open) => !open)}
                        disabled={workplaceOptions.length === 0}
                        className={`w-full h-10 md:h-12 px-4 md:px-5 flex items-center justify-between gap-2 rounded-full border text-left transition-colors text-sm md:text-base disabled:opacity-60 disabled:cursor-not-allowed ${
                          isGateStyle
                            ? `bg-white/8 backdrop-blur-sm ${
                                workplaceDropdownOpen
                                  ? 'border-[#d4af37]/50 ring-2 ring-[#d4af37]/15'
                                  : 'border-white/12 hover:border-white/25'
                              }`
                            : `bg-white ${
                                workplaceDropdownOpen
                                  ? 'border-purple-400 ring-2 ring-purple-100'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`
                        }`}
                      >
                        <span className={`font-medium truncate ${isGateStyle ? 'text-white' : 'text-gray-800'}`}>
                          {workplaceDisplayLabel}
                        </span>
                        <ChevronDownIcon
                          className={`w-4 h-4 md:w-5 md:h-5 shrink-0 transition-transform ${
                            isGateStyle ? 'text-white/50' : 'text-gray-400'
                          } ${workplaceDropdownOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {workplaceDropdownOpen && workplaceOptions.length > 0 && (
                        <div className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
                          {workplaceOptions.map((opt) => {
                            const isSelected = opt.id === selectedWorkplaceId;
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
                                    ? 'bg-purple-50 text-purple-700 font-semibold'
                                    : 'text-gray-800 hover:bg-gray-50'
                                }`}
                              >
                                {opt.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {homeNeedsApproval && (
                      <p className={`mt-1.5 text-xs md:text-sm ${isGateStyle ? 'text-amber-300' : 'text-amber-700'}`}>
                        {pendingHomeApproval
                          ? 'Home access is pending approval.'
                          : 'Home needs approval.'}
                      </p>
                    )}
                    {/* Mobile: native select */}
                    <select
                      className={`select select-bordered w-full md:hidden rounded-full h-10 min-h-10 text-base ${
                        isGateStyle ? 'bg-white/90 text-gray-900 border-white/30' : ''
                      }`}
                      value={selectedWorkplaceId ?? ''}
                      onChange={(e) => setSelectedWorkplaceId(Number(e.target.value))}
                      disabled={workplaceOptions.length === 0}
                    >
                      {workplaceOptions.length === 0 ? (
                        <option value="">Loading…</option>
                      ) : (
                        workplaceOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.name}</option>
                        ))
                      )}
                    </select>
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
    return dialog;
  }

  return createPortal(
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
  );
};

export default ClockInModal;
