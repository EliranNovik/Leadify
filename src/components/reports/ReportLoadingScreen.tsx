import type { ComponentType } from 'react';

type IconComponent = ComponentType<{ className?: string }>;

export default function ReportLoadingScreen({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  icon: IconComponent;
}) {
  return (
    <div
      className="flex min-h-[min(70vh,32rem)] flex-col items-center justify-center gap-6 px-6 py-20"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="relative flex h-28 w-28 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-30" aria-hidden />
        <span
          className="absolute inset-2 animate-spin rounded-full border-[3px] border-transparent border-r-primary/40 border-t-primary"
          aria-hidden
        />
        <span
          className="absolute inset-5 animate-spin rounded-full border-2 border-transparent border-b-primary/70 [animation-direction:reverse] [animation-duration:1.1s]"
          aria-hidden
        />
        <Icon className="relative h-9 w-9 text-primary" aria-hidden />
      </div>
      <div className="space-y-1.5 text-center">
        <p className="text-xl font-semibold tracking-tight text-gray-900">{title}</p>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </div>
  );
}
