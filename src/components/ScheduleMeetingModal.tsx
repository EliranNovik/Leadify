import React, { useState } from 'react';
import { CalendarIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface ScheduleMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (meetingDetails: {
    date: string;
    time: string;
    manager?: string;
    helper?: string;
  }) => void;
  isCreating?: boolean;
}

const managers = ['Anna Zh', 'Mindi', 'Sarah L', 'David K'];
const helpers = ['Anna Zh', 'Mindi', 'Sarah L', 'David K', '---'];

const timeOptions = Array.from({ length: 32 }, (_, i) => {
  const hour = Math.floor(i / 2) + 8; // Start from 8:00
  const minute = i % 2 === 0 ? '00' : '30';
  return `${hour.toString().padStart(2, '0')}:${minute}`;
});

const ScheduleMeetingModal: React.FC<ScheduleMeetingModalProps> = ({
  isOpen,
  onClose,
  onSchedule,
  isCreating = false,
}) => {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [manager, setManager] = useState('');
  const [helper, setHelper] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSchedule({ date, time, manager, helper });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-base-100 rounded-lg shadow-xl w-full max-w-md p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-primary" />
              Schedule Meeting
            </h3>
            <button
              onClick={onClose}
              className="btn btn-ghost btn-sm btn-circle"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Date */}
            <div>
              <label className="label">
                <span className="label-text">Date</span>
              </label>
              <input
                type="date"
                className="input input-bordered w-full"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            {/* Time */}
            <div>
              <label className="label">
                <span className="label-text">Time</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              >
                {timeOptions.map((timeOption) => (
                  <option key={timeOption} value={timeOption}>
                    {timeOption}
                  </option>
                ))}
              </select>
            </div>

            {/* Manager (Optional) */}
            <div>
              <label className="label">
                <span className="label-text">Manager (Optional)</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={manager}
                onChange={(e) => setManager(e.target.value)}
              >
                <option value="">Select a manager...</option>
                {managers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Helper (Optional) */}
            <div>
              <label className="label">
                <span className="label-text">Helper (Optional)</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={helper}
                onChange={(e) => setHelper(e.target.value)}
              >
                <option value="">Select a helper...</option>
                {helpers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={!date || !time || isCreating}
              >
                {isCreating ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Creating Meeting...
                  </>
                ) : (
                  'Create Meeting'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ScheduleMeetingModal; 