import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ClockIcon, ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';
import ClockInModal from './ClockInModal';
import ManualClockInApprovalModal from './ManualClockInApprovalModal';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';
import { useAdminRole } from '../hooks/useAdminRole';
import { resolveWorkplaceName } from '../lib/clockInLocations';
import { fetchPendingManualClockInCount } from '../lib/employeeClockInApproval';

interface ClockInBoxProps {
  employeeId: number | null;
  isDark2Theme?: boolean;
  isAltTheme?: boolean;
}

const ClockInBox: React.FC<ClockInBoxProps> = ({
  employeeId,
  isDark2Theme = false,
  isAltTheme = false,
}) => {
  const { user } = useAuthContext();
  const { isSuperUser } = useAdminRole();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [currentDuration, setCurrentDuration] = useState<string>('');
  const [todayTotal, setTodayTotal] = useState<string>('');
  const [activeWorkplace, setActiveWorkplace] = useState<string>('');
  const clockInStartRef = useRef<string | null>(null);

  const updateDuration = useCallback((start: string, end: string | null) => {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const diffMs = endTime - startTime;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    setCurrentDuration(`${hours}h ${minutes}m`);
  }, []);

  // Tick the displayed duration every minute while clocked in
  useEffect(() => {
    if (!isClockedIn || !clockInStartRef.current) return;
    const tick = () => updateDuration(clockInStartRef.current!, null);
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [isClockedIn, updateDuration]);

  const fetchClockInStatus = useCallback(async () => {
    if (!employeeId) return;

    try {
      const { data, error } = await supabase
        .from('employee_clock_in')
        .select(
          `clock_in_time, clock_out_time, clock_in_location_id,
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
        clockInStartRef.current = data.clock_in_time;
        setIsClockedIn(true);
        updateDuration(data.clock_in_time, data.clock_out_time);
        setActiveWorkplace(resolveWorkplaceName(data, 'in'));
      } else {
        clockInStartRef.current = null;
        setIsClockedIn(false);
        setCurrentDuration('');
        setActiveWorkplace('');
      }
    } catch (error) {
      console.error('Error fetching clock-in status:', error);
    }
  }, [employeeId, updateDuration]);

  const fetchTodayTotal = useCallback(async () => {
    if (!employeeId) return;

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStart = today.toISOString();
      const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('employee_clock_in')
        .select('clock_in_time, clock_out_time')
        .eq('employee_id', employeeId)
        .gte('clock_in_time', todayStart)
        .lt('clock_in_time', todayEnd);

      if (error) throw error;

      let totalMs = 0;
      (data || []).forEach((record) => {
        const start = new Date(record.clock_in_time).getTime();
        const end = record.clock_out_time
          ? new Date(record.clock_out_time).getTime()
          : Date.now();
        totalMs += end - start;
      });

      const hours = Math.floor(totalMs / (1000 * 60 * 60));
      const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
      setTodayTotal(`${hours}h ${minutes}m`);
    } catch (error) {
      console.error('Error fetching today total:', error);
    }
  }, [employeeId]);

  const fetchPendingApprovals = useCallback(async () => {
    if (!isSuperUser) {
      setPendingApprovalCount(0);
      return;
    }
    try {
      const count = await fetchPendingManualClockInCount();
      setPendingApprovalCount(count);
    } catch (error) {
      console.error('Error fetching pending approvals:', error);
    }
  }, [isSuperUser]);

  useEffect(() => {
    if (!employeeId) return;

    void fetchClockInStatus();
    void fetchTodayTotal();
    void fetchPendingApprovals();

    // Realtime subscription: react instantly to clock-in/out changes
    const channel = supabase
      .channel(`clockin_box_${employeeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'employee_clock_in',
          filter: `employee_id=eq.${employeeId}`,
        },
        () => {
          void fetchClockInStatus();
          void fetchTodayTotal();
        },
      )
      .subscribe();

    // Fallback poll every 5 minutes (keeps today-total accurate even without changes)
    const interval = setInterval(() => {
      void fetchTodayTotal();
      void fetchPendingApprovals();
    }, 5 * 60_000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [employeeId, fetchClockInStatus, fetchTodayTotal, fetchPendingApprovals]);

  const handleCloseModal = () => {
    setIsModalOpen(false);
    void fetchClockInStatus();
    void fetchTodayTotal();
  };

  if (!employeeId || !user) return null;

  const displayValue = isClockedIn && currentDuration ? currentDuration : todayTotal || '0h 0m';
  const displayLabel = isClockedIn ? 'Clocked In' : 'Clocked Out';

  const approvalButtonClass = `inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-full shadow-lg ${
    isDark2Theme
      ? 'bg-base-100 text-primary ring-2 ring-base-300'
      : 'bg-white/95 text-primary ring-2 ring-white/80'
  }`;

  const gradientClass = isClockedIn
    ? isAltTheme
      ? 'from-emerald-600 via-green-600 to-teal-500'
      : 'from-green-600 via-emerald-600 to-teal-500'
    : isAltTheme
      ? 'from-violet-600 via-purple-600 to-indigo-500'
      : 'from-violet-600 via-purple-600 to-indigo-500';

  return (
    <>
      <div
        className={`flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] relative overflow-hidden p-4 md:p-6 w-[calc(50vw-0.75rem)] md:w-auto h-32 md:h-auto ${
          isDark2Theme
            ? 'border border-base-300 bg-base-200 text-base-content shadow-none'
            : `bg-gradient-to-tr ${gradientClass} text-white`
        }`}
        onClick={() => setIsModalOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsModalOpen(true);
          }
        }}
      >
        {isClockedIn && (
          <div className="absolute top-2 right-2 z-10">
            <span
              className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-[10px] font-bold rounded-full shadow-lg animate-pulse ${
                isDark2Theme
                  ? 'bg-base-200 text-green-600 ring-2 ring-base-300'
                  : 'bg-white text-green-600 ring-2 ring-white ring-opacity-75'
              }`}
            >
              Active
            </span>
          </div>
        )}

        {isSuperUser && (
          <div className="absolute bottom-2 left-2 z-10 md:top-2 md:right-2 md:bottom-auto md:left-auto">
            <button
              type="button"
              className={approvalButtonClass}
              title="Approve manual clock-ins"
              aria-label="Approve manual clock-ins"
              onClick={(e) => {
                e.stopPropagation();
                setIsApprovalModalOpen(true);
              }}
            >
              <ClipboardDocumentCheckIcon className="w-4 h-4" />
              {pendingApprovalCount > 0 && (
                <span className="ml-1 text-[10px] font-bold">{pendingApprovalCount}</span>
              )}
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 md:gap-4">
          <div
            className={`flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full ${
              isDark2Theme ? 'border border-base-300 bg-base-200/40' : 'bg-white/20'
            }`}
          >
            <ClockIcon
              className={`w-7 h-7 md:w-7 md:h-7 ${isDark2Theme ? 'text-base-content' : 'text-white'}`}
            />
          </div>
          <div className="min-w-0">
            <div
              className={`text-2xl md:text-4xl font-extrabold leading-tight truncate ${
                isDark2Theme ? 'text-base-content' : 'text-white'
              }`}
            >
              {displayValue}
            </div>
            <div
              className={`text-sm md:text-sm font-medium mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 ${
                isDark2Theme ? 'text-base-content/70' : 'text-white/80'
              }`}
            >
              <span>{displayLabel}</span>
              {!isClockedIn && (
                <span className={isDark2Theme ? 'text-base-content/50' : 'text-white/60'}>
                  · Please clock in
                </span>
              )}
            </div>
            {isClockedIn && activeWorkplace !== '—' && (
              <div
                className={`text-xs mt-0.5 truncate max-w-[140px] md:max-w-none ${
                  isDark2Theme ? 'text-base-content/60' : 'text-white/70'
                }`}
              >
                {activeWorkplace}
              </div>
            )}
          </div>
        </div>

        <svg
          className={`absolute bottom-2 right-2 w-10 h-10 md:w-10 md:h-10 ${
            isDark2Theme ? 'text-base-content/35' : 'text-white/40'
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 32 32"
        >
          <circle cx="16" cy="16" r="12" />
          <path d="M16 10v6l4 2" strokeLinecap="round" />
        </svg>
      </div>

      <ClockInModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        employeeId={employeeId}
        userId={user.id}
      />

      {isSuperUser && (
        <ManualClockInApprovalModal
          isOpen={isApprovalModalOpen}
          onClose={() => setIsApprovalModalOpen(false)}
          onUpdated={() => void fetchPendingApprovals()}
        />
      )}
    </>
  );
};

export default ClockInBox;
