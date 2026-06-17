import React, { useState } from 'react';
import { ChevronDownIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

const helpContent = (
  <>
    <ul className="space-y-2 text-xs md:text-[13px] text-white/80 leading-relaxed list-disc pl-4">
      <li>You must clock in before using the CRM. The system stays locked until your shift starts.</li>
      <li>Clock in records your work hours and workplace for payroll and attendance.</li>
      <li>Remember to clock out when you finish your workday.</li>
    </ul>
    <div className="mt-4 pt-3 border-t border-white/10">
      <p className="text-xs font-semibold text-[#E5C07B] mb-1.5">Working from home</p>
      <p className="text-xs md:text-[13px] text-white/75 leading-relaxed">
        If you select <span className="text-white/90 font-medium">Home</span> and you are not yet approved
        for remote work, tap <span className="text-white/90 font-medium">Send for approval</span>. An admin
        must approve your request before you can clock in from home. Until then, choose your office workplace
        to clock in.
      </p>
    </div>
  </>
);

const ClockInGateHelpBox: React.FC = () => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`pointer-events-auto w-full max-w-[min(20rem,calc(100vw-2rem))] md:max-w-xs rounded-2xl bg-[rgba(20,20,20,0.45)] backdrop-blur-[14px] border border-[rgba(255,255,255,0.12)] shadow-[0_12px_40px_rgba(0,0,0,0.35)] text-white text-left ${
        expanded ? 'max-h-[min(40vh,16rem)] overflow-y-auto overscroll-contain p-4' : 'p-3'
      } md:max-h-[min(40vh,16rem)] md:overflow-y-auto md:overscroll-contain md:p-5`}
      data-sheet-no-drag
    >
      <button
        type="button"
        className="md:hidden w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls="clock-in-help-content"
      >
        <span className="flex items-center gap-2.5">
          <InformationCircleIcon className="w-5 h-5 shrink-0 text-[#d4af37]" aria-hidden />
          <span className="text-sm font-semibold leading-snug">Why clock in?</span>
        </span>
        <ChevronDownIcon
          className={`w-4 h-4 shrink-0 text-white/60 transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>

      <div className="hidden md:flex items-start gap-2.5 mb-3">
        <InformationCircleIcon className="w-5 h-5 shrink-0 text-[#d4af37] mt-0.5" aria-hidden />
        <h3 className="text-sm font-semibold leading-snug">Why clock in?</h3>
      </div>

      <div
        id="clock-in-help-content"
        className={`${expanded ? 'mt-3 block' : 'hidden'} md:block`}
      >
        {helpContent}
      </div>
    </div>
  );
};

export default ClockInGateHelpBox;
