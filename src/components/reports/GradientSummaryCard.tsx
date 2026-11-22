import React from 'react';

export const REPORT_SUMMARY_GRADIENTS = [
  'bg-gradient-to-tr from-pink-500 via-rose-500 to-orange-500',
  'bg-gradient-to-tr from-teal-600 via-emerald-500 to-green-500',
  'bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-500',
  'bg-gradient-to-tr from-sky-600 via-cyan-500 to-blue-500',
  'bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500',
] as const;

type GradientSummaryCardProps = {
  label: string;
  labelClassName?: string;
  value: React.ReactNode;
  hint?: string;
  /** Place the hint on the same line as the value. */
  hintBeside?: boolean;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  iconClassName?: string;
  imageSrc?: string;
  gradientClassName: string;
  variant?: 'gradient' | 'white';
  active?: boolean;
  onClick?: () => void;
  className?: string;
};

/** Gradient summary tile matching CasePipeline / PipelineSummaryCards. */
export function GradientSummaryCard({
  label,
  labelClassName = 'text-sm font-medium',
  value,
  hint,
  hintBeside = false,
  icon: Icon,
  iconClassName = '',
  imageSrc,
  gradientClassName,
  variant = 'gradient',
  active = false,
  onClick,
  className = '',
}: GradientSummaryCardProps) {
  const white = variant === 'white';
  const sharedClassName = `${
    white ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-100' : `${gradientClassName} text-white shadow-xl hover:shadow-2xl`
  } flex w-full items-center justify-between gap-3 rounded-2xl text-left transition-all duration-300 ${
    hintBeside ? 'px-4 py-3' : 'p-5'
  } ${
    active ? 'ring-4 ring-white/70 scale-[1.02]' : onClick ? 'hover:scale-105' : ''
  } ${className}`;

  const content = (
    <>
      <div className="min-w-0">
        <p className={`${labelClassName} ${white ? 'text-gray-500' : 'text-white/90'}`}>{label}</p>
        {hintBeside ? (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {hint ? (
              <>
                <span className={white ? 'text-gray-300' : 'text-white/50'} aria-hidden>
                  |
                </span>
                <p className={`text-base font-semibold tabular-nums ${white ? 'text-gray-500' : 'text-white/85'}`}>{hint}</p>
              </>
            ) : null}
          </div>
        ) : (
          <>
            <p className="text-3xl font-bold tabular-nums">{value}</p>
            {hint ? (
              <p className={`mt-1 truncate text-xs ${white ? 'text-gray-500' : 'text-white/80'}`} title={hint}>
                {hint}
              </p>
            ) : null}
          </>
        )}
      </div>
      {imageSrc ? (
        <img
          src={imageSrc}
          alt=""
          className={`h-16 w-16 shrink-0 rounded-2xl object-cover ring-2 ${white ? 'ring-gray-100' : 'ring-white/60'}`}
        />
      ) : Icon ? (
        <div className={`shrink-0 rounded-full bg-white/20 ${iconClassName ? 'p-4' : 'p-3'}`}>
          <Icon className={iconClassName || 'h-7 w-7'} aria-hidden />
        </div>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={sharedClassName}
      >
        {content}
      </button>
    );
  }

  return <div className={sharedClassName}>{content}</div>;
}
