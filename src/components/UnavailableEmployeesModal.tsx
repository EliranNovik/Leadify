import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  XMarkIcon,
  CalendarIcon,
  ClockIcon,
  UserIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

interface UnavailableEmployee {
  id: string;
  display_name: string;
  unavailable_times: UnavailableTime[];
  unavailable_ranges: UnavailableRange[];
  currentUnavailableReason?: string;
  currentUnavailableType?: 'time' | 'range';
}

interface UnavailabilityEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'time' | 'range';
  reason: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  status: 'currently_unavailable' | 'scheduled_today' | 'date_range';
}

interface UnavailableTime {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  outlookEventId?: string;
}

interface UnavailableRange {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  outlookEventId?: string;
}

interface UnavailableEmployeesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const UnavailableEmployeesModal: React.FC<UnavailableEmployeesModalProps> = ({
  isOpen,
  onClose
}) => {
  const [unavailabilityEntries, setUnavailabilityEntries] = useState<UnavailabilityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());

  // Format date as YYYY-MM-DD in local timezone
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Check if a date is within a range
  const isDateInRange = (date: string, startDate: string, endDate: string): boolean => {
    return date >= startDate && date <= endDate;
  };

  // Check if current time is within unavailable time range
  const isCurrentTimeUnavailable = (unavailableTime: UnavailableTime): boolean => {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const startTime = parseInt(unavailableTime.startTime.split(':')[0]) * 60 + parseInt(unavailableTime.startTime.split(':')[1]);
    const endTime = parseInt(unavailableTime.endTime.split(':')[0]) * 60 + parseInt(unavailableTime.endTime.split(':')[1]);
    
    return currentTime >= startTime && currentTime <= endTime;
  };

  // Fetch unavailable employees for current date and create unified entries
  const fetchUnavailableEmployees = async () => {
    setLoading(true);
    try {
      const today = formatDate(currentDate);
      
      const { data: employees, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, unavailable_times, unavailable_ranges')
        .not('unavailable_times', 'is', null);

      if (error) {
        console.error('Error fetching employees:', error);
        toast.error('Failed to fetch employee data');
        return;
      }

      if (!employees) {
        setUnavailabilityEntries([]);
        return;
      }

      // Create unified list of unavailability entries
      const allEntries: UnavailabilityEntry[] = [];

      employees.forEach(employee => {
        const unavailableTimes = employee.unavailable_times || [];
        const unavailableRanges = employee.unavailable_ranges || [];
        
        // Add time-based entries for today
        const todayTimes = unavailableTimes.filter((time: UnavailableTime) => time.date === today);
        todayTimes.forEach((time: UnavailableTime) => {
          const isCurrentlyActive = isCurrentTimeUnavailable(time);
          allEntries.push({
            id: `time-${time.id}`,
            employeeId: employee.id,
            employeeName: employee.display_name,
            type: 'time',
            reason: time.reason,
            date: time.date,
            startTime: time.startTime,
            endTime: time.endTime,
            isActive: isCurrentlyActive,
            status: isCurrentlyActive ? 'currently_unavailable' : 'scheduled_today'
          });
        });
        
        // Add range-based entries that include today
        const todayRanges = unavailableRanges.filter((range: UnavailableRange) => 
          isDateInRange(today, range.startDate, range.endDate)
        );
        todayRanges.forEach((range: UnavailableRange) => {
          allEntries.push({
            id: `range-${range.id}`,
            employeeId: employee.id,
            employeeName: employee.display_name,
            type: 'range',
            reason: range.reason,
            startDate: range.startDate,
            endDate: range.endDate,
            isActive: true, // Range is always "active" if it includes today
            status: 'date_range'
          });
        });
      });

      // Sort entries: currently active first, then by employee name, then by time
      allEntries.sort((a, b) => {
        // First sort by active status (currently unavailable first)
        if (a.status === 'currently_unavailable' && b.status !== 'currently_unavailable') return -1;
        if (b.status === 'currently_unavailable' && a.status !== 'currently_unavailable') return 1;
        
        // Then by employee name
        if (a.employeeName !== b.employeeName) {
          return a.employeeName.localeCompare(b.employeeName);
        }
        
        // Finally by time (for same employee)
        if (a.type === 'time' && b.type === 'time') {
          return (a.startTime || '').localeCompare(b.startTime || '');
        }
        
        // Range entries come after time entries for same employee
        if (a.type === 'time' && b.type === 'range') return -1;
        if (a.type === 'range' && b.type === 'time') return 1;
        
        return 0;
      });

      setUnavailabilityEntries(allEntries);
    } catch (error) {
      console.error('Error fetching unavailable employees:', error);
      toast.error('Failed to fetch unavailable employees');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUnavailableEmployees();
    }
  }, [isOpen, currentDate]);

  const getStatusIcon = (entry: UnavailabilityEntry) => {
    if (entry.status === 'currently_unavailable') {
      return <ClockIcon className="w-5 h-5 text-red-500" />;
    } else if (entry.type === 'time') {
      return <ClockIcon className="w-5 h-5 text-orange-500" />;
    } else {
      return <CalendarIcon className="w-5 h-5 text-blue-500" />;
    }
  };

  const getStatusText = (entry: UnavailabilityEntry) => {
    if (entry.type === 'time') {
      if (entry.status === 'currently_unavailable') {
        return `Currently unavailable until ${entry.endTime}`;
      } else {
        return `Scheduled: ${entry.startTime} - ${entry.endTime}`;
      }
    } else {
      const startDate = new Date(entry.startDate!).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
      const endDate = new Date(entry.endDate!).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
      return `Date range: ${startDate} - ${endDate}`;
    }
  };

  const getStatusColor = (entry: UnavailabilityEntry) => {
    if (entry.status === 'currently_unavailable') {
      return 'text-red-600 bg-red-50 border-red-200';
    } else if (entry.type === 'time') {
      return 'text-orange-600 bg-orange-50 border-orange-200';
    } else {
      return 'text-blue-600 bg-blue-50 border-blue-200';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <UserIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Unavailable Employees</h2>
                <p className="text-purple-100 text-sm">
                  {currentDate.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <XMarkIcon className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              <span className="ml-3 text-gray-600">Loading unavailable employees...</span>
            </div>
          ) : unavailabilityEntries.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">All Employees Available</h3>
              <p className="text-gray-600">No employees are marked as unavailable today.</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-6">
                <ExclamationTriangleIcon className="w-5 h-5 text-orange-500" />
                <span className="text-sm font-medium text-gray-700">
                  {unavailabilityEntries.length} unavailability entr{unavailabilityEntries.length !== 1 ? 'ies' : 'y'} today
                </span>
              </div>

              {/* Unified Table */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Employee
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Type
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Time/Date Range
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Reason
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {unavailabilityEntries.map((entry) => (
                        <tr
                          key={entry.id}
                          className={`transition-colors duration-200 hover:bg-gray-50 ${
                            entry.status === 'currently_unavailable' ? 'bg-red-50' : ''
                          }`}
                        >
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {getStatusIcon(entry)}
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  entry.status === 'currently_unavailable'
                                    ? 'bg-red-100 text-red-800'
                                    : entry.type === 'time'
                                    ? 'bg-orange-100 text-orange-800'
                                    : 'bg-blue-100 text-blue-800'
                                }`}
                              >
                                {entry.status === 'currently_unavailable'
                                  ? 'Active Now'
                                  : entry.type === 'time'
                                  ? 'Scheduled'
                                  : 'Date Range'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <UserIcon className="w-5 h-5 text-gray-400 mr-2" />
                              <span className="text-sm font-medium text-gray-900">
                                {entry.employeeName}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900 capitalize">
                              {entry.type === 'time' ? 'Time Slot' : 'Date Range'}
                            </span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-900">
                              {getStatusText(entry)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-gray-600">
                              {entry.reason}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Last updated: {new Date().toLocaleTimeString()}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setCurrentDate(new Date())}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Today
              </button>
              <button
                onClick={onClose}
                className="px-6 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnavailableEmployeesModal;
