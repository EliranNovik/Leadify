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
  value: React.ReactNode;
  hint?: string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  gradientClassName: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
};

/** Gradient summary tile matching CasePipeline / PipelineSummaryCards. */
export function GradientSummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  gradientClassName,
  active = false,
  onClick,
  className = '',
}: GradientSummaryCardProps) {
  const sharedClassName = `${gradientClassName} flex w-full items-center justify-between gap-3 rounded-2xl p-5 text-left text-white shadow-xl transition-all duration-300 hover:shadow-2xl ${
    active ? 'ring-4 ring-white/70 scale-[1.02]' : onClick ? 'hover:scale-105' : ''
  } ${className}`;

  const content = (
    <>
      <div className="min-w-0">
        <p className="text-sm font-medium text-white/90">{label}</p>
        <p className="text-3xl font-bold tabular-nums">{value}</p>
        {hint ? (
          <p className="mt-1 truncate text-xs text-white/80" title={hint}>
            {hint}
          </p>
        ) : null}
      </div>
      {Icon ? (
        <div className="shrink-0 rounded-full bg-white/20 p-3">
          <Icon className="h-7 w-7" aria-hidden />
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
