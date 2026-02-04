import React, { useState, useEffect } from 'react';
import { ClockIcon, MapPinIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import ClockInModal from './ClockInModal';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';

interface ClockInBoxProps {
  employeeId: number | null;
}

const ClockInBox: React.FC<ClockInBoxProps> = ({ employeeId }) => {
  const { user } = useAuthContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [currentDuration, setCurrentDuration] = useState<string>('');
  const [todayTotal, setTodayTotal] = useState<string>('');

  useEffect(() => {
    if (employeeId) {
      fetchClockInStatus();
      fetchTodayTotal();
      // Update duration every minute
      const interval = setInterval(() => {
        if (isClockedIn) {
          fetchClockInStatus();
        }
        fetchTodayTotal();
      }, 60000); // Update every minute

      return () => clearInterval(interval);
    }
  }, [employeeId, isClockedIn]);

  const fetchClockInStatus = async () => {
    if (!employeeId) return;

    try {
      const { data, error } = await supabase
        .from('employee_clock_in')
        .select('clock_in_time, clock_out_time')
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
        updateDuration(data.clock_in_time, data.clock_out_time);
      } else {
        setIsClockedIn(false);
        setCurrentDuration('');
      }
    } catch (error) {
      console.error('Error fetching clock-in status:', error);
    }
  };

  const updateDuration = (start: string, end: string | null) => {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : new Date().getTime();
    const diffMs = endTime - startTime;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    setCurrentDuration(`${hours}h ${minutes}m`);
  };

  const fetchTodayTotal = async () => {
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
          : new Date().getTime();
        totalMs += end - start;
      });

      const hours = Math.floor(totalMs / (1000 * 60 * 60));
      const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
      setTodayTotal(`${hours}h ${minutes}m`);
    } catch (error) {
      console.error('Error fetching today total:', error);
    }
  };

  if (!employeeId || !user) return null;

  return (
    <>
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-all duration-300">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-tr from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center">
              <ClockIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Clock In/Out</h2>
              <p className="text-sm text-gray-500">Track your work hours</p>
            </div>
          </div>
        </div>

        {/* Status Card */}
        <div
          className={`p-4 rounded-xl border-2 mb-4 cursor-pointer transition-all ${
            isClockedIn
              ? 'bg-green-50 border-green-200 hover:bg-green-100'
              : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
          }`}
          onClick={() => setIsModalOpen(true)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  isClockedIn ? 'bg-green-500' : 'bg-gray-400'
                }`}
              >
                <CheckCircleIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Status</p>
                <p
                  className={`text-lg font-bold ${
                    isClockedIn ? 'text-green-700' : 'text-gray-700'
                  }`}
                >
                  {isClockedIn ? 'Clocked In' : 'Clocked Out'}
                </p>
              </div>
            </div>
            {isClockedIn && currentDuration && (
              <div className="text-right">
                <p className="text-sm text-gray-600">Current</p>
                <p className="text-lg font-bold text-green-700">{currentDuration}</p>
              </div>
            )}
          </div>
        </div>

        {/* Today's Total */}
        {todayTotal && (
          <div className="p-3 bg-purple-50 rounded-lg border border-purple-200 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-purple-900">Total Today</span>
              <span className="text-lg font-bold text-purple-600">{todayTotal}</span>
            </div>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={() => setIsModalOpen(true)}
          className={`btn w-full ${
            isClockedIn ? 'btn-error' : 'btn-primary'
          }`}
        >
          <ClockIcon className="w-5 h-5" />
          {isClockedIn ? 'Clock Out' : 'Clock In'}
        </button>
      </div>

      <ClockInModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          fetchClockInStatus();
          fetchTodayTotal();
        }}
        employeeId={employeeId}
        userId={user.id}
      />
    </>
  );
};

export default ClockInBox;
