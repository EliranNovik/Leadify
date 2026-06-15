import React from 'react';
import {
  clockInApprovalWatermarkLabel,
  type ClockInApprovalStatus,
} from '../lib/employeeClockInApproval';

type ClockInApprovalWatermarkProps = {
  status: ClockInApprovalStatus;
};

const ClockInApprovalWatermark: React.FC<ClockInApprovalWatermarkProps> = ({ status }) => {
  const label = clockInApprovalWatermarkLabel(status);
  if (!label) return null;

  const colorClass =
    status === 'pending' ? 'text-sky-600/30' : 'text-red-600/30';

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden z-[1]"
      aria-hidden
    >
      <span
        className={`${colorClass} text-sm md:text-base font-bold uppercase tracking-[0.18em] -rotate-12 select-none whitespace-nowrap`}
      >
        {label}
      </span>
    </div>
  );
};

export default ClockInApprovalWatermark;
