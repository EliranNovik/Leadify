import React from 'react';
import WheelTimePicker from '../WheelTimePicker';

export type BookingTimeWheelProps = {
  value: string | null;
  onChange: (time: string) => void;
  loading?: boolean;
  disabled?: boolean;
  dayUnavailable?: boolean;
  minHour?: number;
  maxHour?: number;
};

const BookingTimeWheel: React.FC<BookingTimeWheelProps> = ({
  value,
  onChange,
  loading = false,
  disabled = false,
  dayUnavailable = false,
  minHour = 9,
  maxHour = 20,
}) => (
  <WheelTimePicker
    value={value || ''}
    onChange={onChange}
    loading={loading}
    disabled={disabled}
    unavailable={dayUnavailable}
    emptyMessage="No times available this day."
    minHour={minHour}
    maxHour={maxHour}
  />
);

export default BookingTimeWheel;
