import React, { createContext, useContext } from 'react';

export const CLIENT_TAB_PAGE_HEADER_ICON_BOX =
  'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gray-100 dark:bg-base-200';

export const CLIENT_TAB_PAGE_HEADER_ICON = 'h-8 w-8 text-gray-600 dark:text-base-content/70';

export const CLIENT_TAB_PAGE_HEADER_TITLE =
  'text-xl font-semibold text-gray-900 dark:text-base-content';

export const CLIENT_TAB_PAGE_HEADER_SUBTITLE = 'text-sm text-gray-500 dark:text-base-content/60';

/** Injected from Clients (e.g. next-payment / missing-plan badge) — shown next to every tab title. */
const ClientTabPageHeaderExtrasContext = createContext<React.ReactNode>(null);

export function ClientTabPageHeaderExtrasProvider({
  value,
  children,
}: {
  value: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ClientTabPageHeaderExtrasContext.Provider value={value}>
      {children}
    </ClientTabPageHeaderExtrasContext.Provider>
  );
}

type ClientTabPageHeaderProps = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  titleExtra?: React.ReactNode;
  /** Right-aligned content (e.g. actions / panels). */
  actions?: React.ReactNode;
  className?: string;
};

export function ClientTabPageHeader({
  icon: Icon,
  title,
  subtitle,
  titleExtra,
  actions,
  className = 'mb-8',
}: ClientTabPageHeaderProps) {
  const injectedExtra = useContext(ClientTabPageHeaderExtrasContext);
  const hasRightContent = Boolean(injectedExtra || actions);

  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className={CLIENT_TAB_PAGE_HEADER_ICON_BOX}>
          <Icon className={CLIENT_TAB_PAGE_HEADER_ICON} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={CLIENT_TAB_PAGE_HEADER_TITLE}>{title}</h2>
            {titleExtra}
          </div>
          {subtitle ? <p className={CLIENT_TAB_PAGE_HEADER_SUBTITLE}>{subtitle}</p> : null}
        </div>
      </div>
      {hasRightContent ? (
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          {injectedExtra}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
