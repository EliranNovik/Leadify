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
  persistLastSelectedWorkplaceId,
  readLastSelectedWorkplaceId,
  resolveWorkplaceName,
  type ClockInLocationOption,
} from '../lib/clockInLocations';

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
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState<number | null>(null);
  const [successAction, setSuccessAction] = useState<'in' | 'out' | null>(null);
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
    void fetchActiveClockInLocations().then(setWorkplaceOptions);
  }, [isOpen]);

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
        const opts = await fetchActiveClockInLocations();
        setWorkplaceOptions(opts);
        const last = readLastSelectedWorkplaceId();
        const validLast = last != null && opts.some((o) => o.id === last);
        setSelectedWorkplaceId(validLast ? last : opts[0]?.id ?? null);
      }
    } catch (error) {
      console.error('Error fetching clock-in status:', error);
      toast.error('Failed to fetch clock-in status');
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
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl transform transition-all">
          {successAction ? (
            <div className="p-10 md:p-12 text-center animate-fade-in">
              <div
                className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 ${
                  successAction === 'in' ? 'bg-green-500' : 'bg-gray-600'
                }`}
              >
                <CheckCircleIcon className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {successAction === 'in' ? 'Clocked in successfully!' : 'Clocked out successfully!'}
              </h2>
              {selectedWorkplaceName && (
                <p className="text-gray-600 mb-1">{selectedWorkplaceName}</p>
              )}
              <p className="text-sm text-gray-400">Closing automatically…</p>
            </div>
          ) : (
            <>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-tr from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <ClockIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Clock In/Out</h2>
                <p className="text-sm text-gray-500">Track your work hours</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="btn btn-sm btn-ghost btn-circle"
              title="Close"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Status + action */}
            <div className="flex items-center gap-4">
                {!isClockedIn ? (
                  <button
                    type="button"
                    onClick={handleClockIn}
                    disabled={isLoading}
                    className="btn btn-primary rounded-full h-14 min-h-14 px-5 gap-2 shrink-0 shadow-md"
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
                ) : (
                  <button
                    type="button"
                    onClick={handleClockOut}
                    disabled={isLoading}
                    className="btn rounded-full h-14 min-h-14 px-5 gap-2 shrink-0 border-0 shadow-md bg-gradient-to-r from-red-600 via-rose-600 to-red-500 text-white hover:from-red-700 hover:via-rose-700 hover:to-red-600 hover:shadow-lg transition-all duration-200 disabled:opacity-60"
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
                <div className="min-w-0 flex-1">
                  <p className={`text-2xl font-extrabold leading-tight ${
                    isClockedIn ? 'text-green-700' : 'text-gray-700'
                  }`}>
                    {isClockedIn && sessionDuration
                      ? (
                        <>
                          Clocked In since{' '}
                          <span className="tabular-nums">{sessionDuration}</span>
                        </>
                      )
                      : isClockedIn
                        ? 'Clocked In'
                        : 'Clocked Out'}
                  </p>
                </div>
            </div>

            {/* Workplace */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {isClockedIn ? 'Workplace' : 'Workplace (clock in)'}
              </label>
              {isClockedIn && currentRecord ? (
                <div className="select select-bordered w-full h-12 flex items-center px-4 bg-gray-50 text-gray-900 font-medium">
                  {resolveWorkplaceName(currentRecord, 'in')}
                </div>
              ) : (
                <>
                  {/* Desktop: custom white dropdown */}
                  <div className="hidden md:block relative" ref={workplaceDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setWorkplaceDropdownOpen((open) => !open)}
                      disabled={workplaceOptions.length === 0}
                      className={`w-full h-12 px-4 flex items-center justify-between gap-2 rounded-lg border bg-white text-left transition-colors ${
                        workplaceDropdownOpen
                          ? 'border-purple-400 ring-2 ring-purple-100'
                          : 'border-gray-200 hover:border-gray-300'
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      <span className="text-gray-900 font-medium truncate">
                        {workplaceDisplayLabel}
                      </span>
                      <ChevronDownIcon
                        className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${
                          workplaceDropdownOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {workplaceDropdownOpen && workplaceOptions.length > 0 && (
                      <div className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
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
                              className={`w-full px-4 py-3 text-left text-sm transition-colors ${
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

                  {/* Mobile: native select */}
                  <select
                    className="select select-bordered w-full md:hidden"
                    value={selectedWorkplaceId ?? ''}
                    onChange={(e) => setSelectedWorkplaceId(Number(e.target.value))}
                    disabled={workplaceOptions.length === 0}
                  >
                    {workplaceOptions.length === 0 ? (
                      <option value="">Loading workplaces…</option>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClockInModal;
