import React from 'react';

/** Flowing lines over the checkout gradient (Dribbble-style). */
const PaymentSummaryGradientDecor: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
    <svg
      className="absolute -bottom-8 -right-4 w-[115%] h-[72%] min-w-[420px] text-white"
      viewBox="0 0 520 420"
      fill="none"
      preserveAspectRatio="xMaxYMax slice"
    >
      <path
        d="M520 420 C380 380 320 280 180 200 C80 140 20 80 -40 20"
        stroke="currentColor"
        strokeOpacity="0.14"
        strokeWidth="1.25"
      />
      <path
        d="M520 420 C400 360 340 250 200 170 C100 110 40 50 -60 -10"
        stroke="currentColor"
        strokeOpacity="0.12"
        strokeWidth="1.25"
      />
      <path
        d="M520 420 C420 340 360 220 220 140 C120 80 60 20 -40 -40"
        stroke="currentColor"
        strokeOpacity="0.1"
        strokeWidth="1.25"
      />
      <path
        d="M520 420 C440 320 380 190 240 110 C140 50 80 -10 -20 -70"
        stroke="currentColor"
        strokeOpacity="0.08"
        strokeWidth="1.25"
      />
      <path
        d="M520 420 C460 300 400 160 260 80 C160 20 100 -40 0 -100"
        stroke="currentColor"
        strokeOpacity="0.07"
        strokeWidth="1.25"
      />
      <path
        d="M520 380 C400 320 340 240 200 160 C100 100 40 40 -40 -20"
        stroke="currentColor"
        strokeOpacity="0.11"
        strokeWidth="1.25"
      />
      <path
        d="M520 360 C410 300 350 210 210 130 C110 70 50 10 -50 -50"
        stroke="currentColor"
        strokeOpacity="0.09"
        strokeWidth="1.25"
      />
      <path
        d="M520 400 C390 340 330 260 190 180 C90 120 30 60 -50 0"
        stroke="currentColor"
        strokeOpacity="0.13"
        strokeWidth="1.25"
      />
      <path
        d="M480 420 C360 360 300 270 160 190 C60 130 0 70 -80 10"
        stroke="currentColor"
        strokeOpacity="0.06"
        strokeWidth="1.25"
      />
      <path
        d="M520 320 C420 280 360 200 220 120 C120 60 60 0 -40 -60"
        stroke="currentColor"
        strokeOpacity="0.08"
        strokeWidth="1.25"
      />
    </svg>

    <div
      className="absolute inset-0"
      style={{
        background:
          'radial-gradient(ellipse 70% 55% at 95% 95%, rgba(255,255,255,0.18) 0%, transparent 58%), radial-gradient(ellipse 45% 35% at 5% 85%, rgba(255,255,255,0.06) 0%, transparent 50%)',
      }}
    />
  </div>
);

export default PaymentSummaryGradientDecor;
