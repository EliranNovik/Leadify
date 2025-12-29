import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

interface TimePickerProps {
  value: string; // Format: "HH:MM"
  onChange: (time: string) => void;
  meetingCounts: Record<string, number>; // Maps "HH:MM" to count
  disabled?: boolean;
  label?: string;
}

const TimePicker: React.FC<TimePickerProps> = ({
  value,
  onChange,
  meetingCounts,
  disabled = false,
  label = 'Time',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);

  // Parse current value
  const [selectedHour, setSelectedHour] = useState(() => {
    if (value) {
      const [hour] = value.split(':').map(Number);
      return hour;
    }
    return 9;
  });

  const [selectedMinute, setSelectedMinute] = useState(() => {
    if (value) {
      const [, minute] = value.split(':').map(Number);
      return minute;
    }
    return 0;
  });

  // Generate hour options (0-23)
  const hours = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => i);
  }, []);

  // Generate minute options (0-59)
  const minutes = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => i);
  }, []);

  // Update selected time when value prop changes
  useEffect(() => {
    if (value) {
      const [hour, minute] = value.split(':').map(Number);
      setSelectedHour(hour);
      setSelectedMinute(minute);
    }
  }, [value]);

  // Scroll to selected values when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (hourScrollRef.current) {
          const hourElement = hourScrollRef.current.children[selectedHour] as HTMLElement;
          if (hourElement) {
            hourElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
        if (minuteScrollRef.current) {
          const minuteElement = minuteScrollRef.current.children[selectedMinute] as HTMLElement;
          if (minuteElement) {
            minuteElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 100);
    }
  }, [isOpen, selectedHour, selectedMinute]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleHourChange = (hour: number) => {
    setSelectedHour(hour);
    const timeStr = `${hour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
    onChange(timeStr);
  };

  const handleMinuteChange = (minute: number) => {
    setSelectedMinute(minute);
    const timeStr = `${selectedHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    onChange(timeStr);
  };

  const getBadgeClass = (count: number) => {
    if (count === 0) return 'badge badge-ghost text-xs';
    if (count <= 2) return 'badge badge-success text-xs';
    if (count <= 5) return 'badge badge-warning text-xs';
    return 'badge badge-error text-xs';
  };

  const currentTimeStr = `${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
  const currentCount = meetingCounts[currentTimeStr] || 0;

  return (
    <div className="relative" ref={containerRef}>
      <label className="block font-semibold mb-1">{label}</label>
      <div
        className={`input input-bordered w-full cursor-pointer flex items-center justify-between ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <span>{currentTimeStr}</span>
          {currentCount > 0 && (
            <span className={getBadgeClass(currentCount)}>{currentCount}</span>
          )}
        </div>
        <ChevronDownIcon className={`w-4 h-4 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
          {/* Simplified Time Picker Wheel */}
          <div className="flex bg-white justify-center py-4">
            {/* Hours Column */}
            <div className="w-16 relative">
              <div
                ref={hourScrollRef}
                className="overflow-y-auto max-h-64 custom-scrollbar"
                style={{ scrollBehavior: 'smooth' }}
              >
                {hours.map((hour) => {
                  const isSelected = hour === selectedHour;

                  return (
                    <div
                      key={hour}
                      className={`px-2 py-2 cursor-pointer transition-all text-center ${
                        isSelected
                          ? 'text-purple-600 font-bold text-lg'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                      onClick={() => handleHourChange(hour)}
                    >
                      {hour.toString().padStart(2, '0')}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Separator */}
            <div className="flex items-center justify-center px-1">
              <span className="text-2xl font-bold text-gray-400">:</span>
            </div>

            {/* Minutes Column */}
            <div className="w-16 relative">
              <div
                ref={minuteScrollRef}
                className="overflow-y-auto max-h-64 custom-scrollbar"
                style={{ scrollBehavior: 'smooth' }}
              >
                {minutes.map((minute) => {
                  const isSelected = minute === selectedMinute;

                  return (
                    <div
                      key={minute}
                      className={`px-2 py-2 cursor-pointer transition-all text-center ${
                        isSelected
                          ? 'text-purple-600 font-bold text-lg'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                      onClick={() => handleMinuteChange(minute)}
                    >
                      {minute.toString().padStart(2, '0')}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Simplified Footer */}
          {currentCount > 0 && (
            <div className="bg-purple-50 px-4 py-2 border-t border-purple-100 flex items-center justify-center gap-2">
              <span className="text-sm text-purple-700 font-medium">
                {currentCount} meeting{currentCount !== 1 ? 's' : ''} at {currentTimeStr}
              </span>
            </div>
          )}
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
      `}</style>
    </div>
  );
};

export default TimePicker;
