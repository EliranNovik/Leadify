import React from 'react';
import WheelTimePicker from '../WheelTimePicker';

export type BookingTimeWheelProps = {
  value: string | null;
  onChange: (time: string) => void;
  loading?: boolean;
  disabled?: boolean;
  dayUnavailable?: boolean;
  /** Available slot times in the client's local timezone (from the booking API). */
  allowedTimes?: string[];
};

const BookingTimeWheel: React.FC<BookingTimeWheelProps> = ({
  value,
  onChange,
  loading = false,
  disabled = false,
  dayUnavailable = false,
  allowedTimes,
}) => (
  <WheelTimePicker
    value={value || ''}
    onChange={onChange}
    loading={loading}
    disabled={disabled}
    unavailable={dayUnavailable}
    emptyMessage="No times available this day."
    allowedTimes={allowedTimes}
  />
);

export default BookingTimeWheel;
