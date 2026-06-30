import React from 'react';

export const CLIENT_TAB_PAGE_HEADER_ICON_BOX =
  'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gray-100 dark:bg-base-200';

export const CLIENT_TAB_PAGE_HEADER_ICON = 'h-8 w-8 text-gray-600 dark:text-base-content/70';

export const CLIENT_TAB_PAGE_HEADER_TITLE =
  'text-xl font-semibold text-gray-900 dark:text-base-content';

export const CLIENT_TAB_PAGE_HEADER_SUBTITLE = 'text-sm text-gray-500 dark:text-base-content/60';

type ClientTabPageHeaderProps = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  titleExtra?: React.ReactNode;
  className?: string;
};

export function ClientTabPageHeader({
  icon: Icon,
  title,
  subtitle,
  titleExtra,
  className = 'mb-8',
}: ClientTabPageHeaderProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className={CLIENT_TAB_PAGE_HEADER_ICON_BOX}>
        <Icon className={CLIENT_TAB_PAGE_HEADER_ICON} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={CLIENT_TAB_PAGE_HEADER_TITLE}>{title}</h2>
          {titleExtra}
        </div>
        {subtitle ? <p className={CLIENT_TAB_PAGE_HEADER_SUBTITLE}>{subtitle}</p> : null}
      </div>
    </div>
  );
}
