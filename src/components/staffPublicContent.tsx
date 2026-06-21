import React from 'react';

export const SERIF_FONT_STYLE = {
  fontFamily: "'Playfair Display', 'Libre Baskerville', serif",
} as const;

export function StaffPublicSection({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl bg-white p-5 md:p-6 ${className}`}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">{title}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export function StaffPublicProse({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15px] leading-[1.65] text-neutral-600">{children}</p>
  );
}

export function StaffPublicBulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <span
            className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10"
            aria-hidden
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="text-[15px] leading-snug text-neutral-600">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function StaffPublicCtaBox({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-primary to-primary/90 p-6 text-white md:p-10">
      <h2 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h2>
      <div className="mt-3 text-[15px] leading-relaxed text-white/90 md:text-base">{children}</div>
      <div className="mt-6">{action}</div>
    </section>
  );
}

export function StaffPublicContactList({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-50/60">
      {children}
    </div>
  );
}

export function StaffPublicContactRow({
  icon: Icon,
  label,
  lines,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  lines: string[];
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-4 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-semibold text-neutral-900">{label}</p>
        {lines.map((line) => (
          <p key={line} className="text-sm text-neutral-600">
            {line}
          </p>
        ))}
        {hint ? <p className="mt-1 text-xs text-neutral-400">{hint}</p> : null}
      </div>
    </div>
  );
}
