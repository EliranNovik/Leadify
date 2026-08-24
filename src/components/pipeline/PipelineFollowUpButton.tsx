import React from 'react';
import { CalendarIcon } from '@heroicons/react/24/outline';
import { pipelineFollowUpColor } from './pipelineUi';

type Props = {
  date: string | null | undefined;
  onClick: (e: React.MouseEvent) => void;
};

function formatFollowUpDisplay(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date.slice(0, 10);
  return d.toLocaleDateString('en-GB');
}

/** Calendar icon + date / Set date text — no chip or badge. */
const PipelineFollowUpButton: React.FC<Props> = ({ date, onClick }) => (
  <button
    type="button"
    title="Edit your follow-up date"
    onClick={(e) => {
      e.stopPropagation();
      onClick(e);
    }}
    className={`inline-flex items-center gap-1.5 bg-transparent p-0 font-semibold hover:underline ${
      date ? pipelineFollowUpColor(date) : 'text-gray-500 hover:text-gray-700'
    }`}
  >
    <CalendarIcon className="h-4 w-4 shrink-0" />
    {date ? formatFollowUpDisplay(date) : 'Set date'}
  </button>
);

export default PipelineFollowUpButton;
