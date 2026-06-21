import React, { useState } from 'react';
import toast from 'react-hot-toast';
import MobileBottomSheet from '../../components/MobileBottomSheet';
import { portalCreateMeetingRequest } from '../../lib/portalApi';

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
};

const TIME_OPTIONS = [
  'Morning (9:00–12:00)',
  'Afternoon (12:00–17:00)',
  'Evening (17:00–20:00)',
  'Flexible',
];

const PortalMeetingRequestDrawer: React.FC<Props> = ({ open, onClose, onSubmitted }) => {
  const [preferredDate, setPreferredDate] = useState('');
  const [preferredTimeRange, setPreferredTimeRange] = useState(TIME_OPTIONS[3]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preferredDate) {
      toast.error('Please select a preferred date');
      return;
    }
    setSubmitting(true);
    try {
      const result = await portalCreateMeetingRequest({
        preferred_date: preferredDate,
        preferred_time_range: preferredTimeRange,
        notes: notes.trim() || undefined,
      });
      if (!result.ok) throw new Error(result.error || 'Request failed');
      toast.success('Meeting request submitted. Our team will contact you to confirm.');
      setPreferredDate('');
      setNotes('');
      onSubmitted?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="Schedule a meeting"
      desktopLayout="drawer-right"
      zIndex={50}
    >
      <form onSubmit={handleSubmit} className="space-y-6 p-5">
        <div>
          <label className="label text-sm font-medium" htmlFor="portal-meeting-date">
            Preferred date
          </label>
          <input
            id="portal-meeting-date"
            type="date"
            required
            min={new Date().toISOString().split('T')[0]}
            className="input input-bordered w-full"
            value={preferredDate}
            onChange={(e) => setPreferredDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label text-sm font-medium" htmlFor="portal-meeting-time">
            Preferred time
          </label>
          <select
            id="portal-meeting-time"
            className="select select-bordered w-full"
            value={preferredTimeRange}
            onChange={(e) => setPreferredTimeRange(e.target.value)}
          >
            {TIME_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-sm font-medium" htmlFor="portal-meeting-notes">
            Notes (optional)
          </label>
          <textarea
            id="portal-meeting-notes"
            className="textarea textarea-bordered w-full"
            rows={3}
            placeholder="Anything we should know before scheduling?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Request meeting'}
        </button>
        <p className="text-xs text-gray-500 text-center">
          This sends a request to our office. We will confirm the final date and time with you.
        </p>
      </form>
    </MobileBottomSheet>
  );
};

export default PortalMeetingRequestDrawer;
