import React, { useState, useEffect, useRef, useCallback } from 'react';
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

interface ClockInModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  userId: string;
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

const ClockInModal: React.FC<ClockInModalProps> = ({ isOpen, onClose, employeeId, userId }) => {
  const { user } = useAuthContext();
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

  useEffect(() => {
    if (!isOpen) {
      setSuccessAction(null);
      setWorkplaceDropdownOpen(false);
      return;
    }
    void Promise.all([
      fetchActiveClockInLocations(),
      fetchEmployeeWorksFromHome(employeeId),
      fetchPendingHomeWfhApproval(employeeId),
    ]).then(([locations, wfh, pendingApproval]) => {
      setWorkplaceOptions(locations);
      setWorksFromHome(wfh);
      setPendingHomeApproval(pendingApproval);
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
      setSuccessAction(null);
      onClose();
    }, AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [successAction, onClose]);

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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-full shadow-2xl w-[380px] h-[380px] max-w-[92vw] max-h-[92vw] transform transition-all flex flex-col items-center justify-center text-center">

          {/* Close button — always visible */}
          <button
            onClick={onClose}
            className="absolute top-7 right-7 btn btn-sm btn-ghost btn-circle z-10"
            title="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>

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
              <h2 className="text-xl font-bold text-gray-900 mb-1">
                {successAction === 'approval'
                  ? 'Sent for approval!'
                  : successAction === 'in'
                    ? 'Clocked in!'
                    : 'Clocked out!'}
              </h2>
              {successAction === 'approval' ? (
                <p className="text-sm text-gray-500">Waiting for admin approval.</p>
              ) : selectedWorkplaceName ? (
                <p className="text-sm text-gray-500">{selectedWorkplaceName}</p>
              ) : null}
              <p className="text-xs text-gray-400 mt-1">Closing automatically…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5 px-10 w-full">
              {/* Status text */}
              <div>
                <p className={`text-lg font-extrabold leading-tight ${
                  isClockedIn ? 'text-green-700' : ''
                }`}
                  style={!isClockedIn ? {
                    background: 'linear-gradient(to right, #7c3aed, #6366f1)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  } : undefined}
                >
                  {isClockedIn && sessionDuration
                    ? <span className="tabular-nums">{sessionDuration}</span>
                    : isClockedIn ? 'Clocked In' : 'Clocked Out'}
                </p>
                {isClockedIn && (
                  <p className="text-xs text-gray-400 mt-0.5">Currently clocked in</p>
                )}
              </div>

              {/* Main action button */}
              {!isClockedIn ? (
                homeNeedsApproval ? (
                  <button
                    type="button"
                    onClick={handleSendHomeForApproval}
                    disabled={isLoading || pendingHomeApproval}
                    className="btn rounded-full h-14 min-h-14 px-6 gap-2 border-0 shadow-md bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 text-white hover:from-amber-600 hover:via-orange-600 hover:to-amber-600 hover:shadow-lg transition-all duration-200 disabled:opacity-60"
                  >
                    {isLoading ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <>
                        <ClockIcon className="w-5 h-5" />
                        <span className="font-semibold text-sm">
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
                    className="btn rounded-full h-16 min-h-16 px-8 gap-2 border-0 shadow-lg bg-gradient-to-r from-green-600 via-emerald-600 to-teal-500 text-white hover:from-green-700 hover:via-emerald-700 hover:to-teal-600 hover:shadow-xl transition-all duration-200 disabled:opacity-60 text-base"
                  >
                    {isLoading ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <>
                        <ClockIcon className="w-5 h-5" />
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
                  className="btn rounded-full h-16 min-h-16 px-8 gap-2 border-0 shadow-lg bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-500 text-white hover:from-violet-700 hover:via-purple-700 hover:to-indigo-600 hover:shadow-xl transition-all duration-200 disabled:opacity-60 text-base"
                >
                  {isLoading ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : (
                    <>
                      <ClockIcon className="w-5 h-5" />
                      <span className="font-semibold">Clock Out</span>
                    </>
                  )}
                </button>
              )}

              {/* Workplace */}
              <div className="w-full">
                {isClockedIn && currentRecord ? (
                  <div className="h-10 flex items-center justify-center rounded-full border border-gray-200 bg-gray-50 px-4 text-gray-700 font-medium text-sm">
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
                        className={`w-full h-10 px-4 flex items-center justify-between gap-2 rounded-full border bg-white text-left transition-colors text-sm ${
                          workplaceDropdownOpen
                            ? 'border-purple-400 ring-2 ring-purple-100'
                            : 'border-gray-200 hover:border-gray-300'
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        <span className="text-gray-900 font-medium truncate">
                          {workplaceDisplayLabel}
                        </span>
                        <ChevronDownIcon
                          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
                            workplaceDropdownOpen ? 'rotate-180' : ''
                          }`}
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
                      <p className="mt-1.5 text-xs text-amber-700">
                        {pendingHomeApproval
                          ? 'Home access is pending approval.'
                          : 'Home needs approval.'}
                      </p>
                    )}
                    {/* Mobile: native select */}
                    <select
                      className="select select-bordered select-sm w-full md:hidden rounded-full"
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
          )}
        </div>
      </div>
    </div>
  );
};

export default ClockInModal;
