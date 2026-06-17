import React, { useState } from 'react';
import { ChevronDownIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

const helpContent = (
  <>
    <ul className="space-y-2.5 text-xs md:text-sm text-white/80 leading-relaxed list-disc pl-4 md:pl-5">
      <li>You must clock in before using the CRM. The system stays locked until your shift starts.</li>
      <li>Clock in records your work hours and workplace for payroll and attendance.</li>
      <li>Remember to clock out when you finish your workday.</li>
    </ul>
    <div className="mt-4 pt-3 border-t border-white/10">
      <p className="text-xs md:text-sm font-semibold text-[#E5C07B] mb-1.5 md:mb-2">Working from home</p>
      <p className="text-xs md:text-sm text-white/75 leading-relaxed">
        If you select <span className="text-white/90 font-medium">Home</span> and you are not yet approved
        for remote work, tap <span className="text-white/90 font-medium">Send for approval</span>. An admin
        must approve your request before you can clock in from home.
      </p>
    </div>
  </>
);

const ClockInGateHelpBox: React.FC = () => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`pointer-events-auto w-full max-w-[min(20rem,calc(100vw-2rem))] md:max-w-sm rounded-2xl bg-[rgba(20,20,20,0.45)] backdrop-blur-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.35)] text-white text-left ${
        expanded
          ? 'max-h-[min(40vh,16rem)] md:max-h-[min(44vh,18rem)] overflow-y-auto overscroll-contain p-4 md:p-6'
          : 'p-3 md:p-4'
      }`}
      data-sheet-no-drag
    >
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 md:gap-3 text-left"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls="clock-in-help-content"
      >
        <span className="flex items-center gap-2.5 md:gap-3">
          <InformationCircleIcon className="w-5 h-5 md:w-6 md:h-6 shrink-0 text-[#d4af37]" aria-hidden />
          <span className="text-sm md:text-base font-semibold leading-snug">Why clock in?</span>
        </span>
        <ChevronDownIcon
          className={`w-4 h-4 md:w-5 md:h-5 shrink-0 text-white/60 transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>

      <div
        id="clock-in-help-content"
        className={expanded ? 'mt-3 md:mt-4 block' : 'hidden'}
      >
        {helpContent}
      </div>
    </div>
  );
};

export default ClockInGateHelpBox;
