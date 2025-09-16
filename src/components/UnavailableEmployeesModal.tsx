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
  const [unavailableEmployees, setUnavailableEmployees] = useState<UnavailableEmployee[]>([]);
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

  // Fetch unavailable employees for current date
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
        setUnavailableEmployees([]);
        return;
      }

      // Filter employees who are unavailable today
      const todayUnavailableEmployees: UnavailableEmployee[] = [];

      employees.forEach(employee => {
        const unavailableTimes = employee.unavailable_times || [];
        const unavailableRanges = employee.unavailable_ranges || [];
        
        // Check for specific time slots today
        const todayTimes = unavailableTimes.filter((time: UnavailableTime) => time.date === today);
        
        // Check for date ranges that include today
        const todayRanges = unavailableRanges.filter((range: UnavailableRange) => 
          isDateInRange(today, range.startDate, range.endDate)
        );

        if (todayTimes.length > 0 || todayRanges.length > 0) {
          // Determine the current unavailable reason
          let currentReason = '';
          let currentType: 'time' | 'range' = 'time';
          
          if (todayTimes.length > 0) {
            // Check if any time slot is currently active
            const activeTime = todayTimes.find(time => isCurrentTimeUnavailable(time));
            if (activeTime) {
              currentReason = activeTime.reason;
              currentType = 'time';
            } else {
              // Show the next upcoming time slot
              const now = new Date();
              const currentTime = now.getHours() * 60 + now.getMinutes();
              const upcomingTimes = todayTimes
                .filter(time => {
                  const startTime = parseInt(time.startTime.split(':')[0]) * 60 + parseInt(time.startTime.split(':')[1]);
                  return startTime > currentTime;
                })
                .sort((a, b) => {
                  const timeA = parseInt(a.startTime.split(':')[0]) * 60 + parseInt(a.startTime.split(':')[1]);
                  const timeB = parseInt(b.startTime.split(':')[0]) * 60 + parseInt(b.startTime.split(':')[1]);
                  return timeA - timeB;
                });
              
              if (upcomingTimes.length > 0) {
                currentReason = upcomingTimes[0].reason;
                currentType = 'time';
              } else {
                currentReason = todayTimes[0].reason;
                currentType = 'time';
              }
            }
          } else if (todayRanges.length > 0) {
            currentReason = todayRanges[0].reason;
            currentType = 'range';
          }

          todayUnavailableEmployees.push({
            id: employee.id,
            display_name: employee.display_name,
            unavailable_times: unavailableTimes,
            unavailable_ranges: unavailableRanges,
            currentUnavailableReason: currentReason,
            currentUnavailableType: currentType
          });
        }
      });

      setUnavailableEmployees(todayUnavailableEmployees);
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

  const getStatusIcon = (employee: UnavailableEmployee) => {
    if (employee.currentUnavailableType === 'time') {
      const todayTimes = employee.unavailable_times.filter(time => time.date === formatDate(currentDate));
      const activeTime = todayTimes.find(time => isCurrentTimeUnavailable(time));
      
      if (activeTime) {
        return <ClockIcon className="w-5 h-5 text-red-500" />;
      } else {
        return <ClockIcon className="w-5 h-5 text-orange-500" />;
      }
    } else {
      return <CalendarIcon className="w-5 h-5 text-orange-500" />;
    }
  };

  const getStatusText = (employee: UnavailableEmployee) => {
    if (employee.currentUnavailableType === 'time') {
      const todayTimes = employee.unavailable_times.filter(time => time.date === formatDate(currentDate));
      const activeTime = todayTimes.find(time => isCurrentTimeUnavailable(time));
      
      if (activeTime) {
        return `Currently unavailable until ${activeTime.endTime}`;
      } else {
        // Show the next upcoming time slot or all time slots
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const upcomingTimes = todayTimes
          .filter(time => {
            const startTime = parseInt(time.startTime.split(':')[0]) * 60 + parseInt(time.startTime.split(':')[1]);
            return startTime > currentTime;
          })
          .sort((a, b) => {
            const timeA = parseInt(a.startTime.split(':')[0]) * 60 + parseInt(a.startTime.split(':')[1]);
            const timeB = parseInt(b.startTime.split(':')[0]) * 60 + parseInt(b.startTime.split(':')[1]);
            return timeA - timeB;
          });
        
        if (upcomingTimes.length > 0) {
          return `Scheduled: ${upcomingTimes[0].startTime} - ${upcomingTimes[0].endTime}`;
        } else if (todayTimes.length > 0) {
          return `Time slots: ${todayTimes.map(t => `${t.startTime}-${t.endTime}`).join(', ')}`;
        } else {
          return 'Scheduled unavailable time today';
        }
      }
    } else {
      // Show the actual date range
      const todayRanges = employee.unavailable_ranges.filter(range => 
        isDateInRange(formatDate(currentDate), range.startDate, range.endDate)
      );
      if (todayRanges.length > 0) {
        const range = todayRanges[0];
        const startDate = new Date(range.startDate).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric' 
        });
        const endDate = new Date(range.endDate).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric' 
        });
        return `Date range: ${startDate} - ${endDate}`;
      }
      return 'Unavailable for date range';
    }
  };

  const getStatusColor = (employee: UnavailableEmployee) => {
    if (employee.currentUnavailableType === 'time') {
      const todayTimes = employee.unavailable_times.filter(time => time.date === formatDate(currentDate));
      const activeTime = todayTimes.find(time => isCurrentTimeUnavailable(time));
      
      if (activeTime) {
        return 'text-red-600 bg-red-50 border-red-200';
      } else {
        return 'text-orange-600 bg-orange-50 border-orange-200';
      }
    } else {
      return 'text-orange-600 bg-orange-50 border-orange-200';
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
          ) : unavailableEmployees.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">All Employees Available</h3>
              <p className="text-gray-600">No employees are marked as unavailable today.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-6">
                <ExclamationTriangleIcon className="w-5 h-5 text-orange-500" />
                <span className="text-sm font-medium text-gray-700">
                  {unavailableEmployees.length} employee{unavailableEmployees.length !== 1 ? 's' : ''} unavailable today
                </span>
              </div>

              {unavailableEmployees.map((employee) => (
                <div
                  key={employee.id}
                  className={`border rounded-xl p-4 transition-all duration-200 hover:shadow-md ${getStatusColor(employee)}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      {getStatusIcon(employee)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">
                          {employee.display_name}
                        </h3>
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-3">
                        {employee.currentUnavailableReason}
                      </p>
                      
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                        <InformationCircleIcon className="w-4 h-4" />
                        <span>{getStatusText(employee)}</span>
                      </div>
                      
                      {/* Show additional time slots if there are multiple */}
                      {employee.currentUnavailableType === 'time' && (() => {
                        const todayTimes = employee.unavailable_times.filter(time => time.date === formatDate(currentDate));
                        if (todayTimes.length > 1) {
                          return (
                            <div className="text-xs text-gray-500">
                              <span className="font-medium">All time slots today:</span>
                              <div className="mt-1 space-y-1">
                                {todayTimes.map((time, index) => (
                                  <div key={index} className="flex items-center gap-2">
                                    <ClockIcon className="w-3 h-3" />
                                    <span>{time.startTime} - {time.endTime}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                </div>
              ))}
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
