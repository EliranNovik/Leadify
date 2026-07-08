import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon, DocumentCheckIcon } from '@heroicons/react/24/outline';
import MobileBottomSheet from './MobileBottomSheet';

type SubEffortsLogSidebarProps = {
  isLoading: boolean;
  rows: any[];
  onRowClick: (rowId: string | number) => void;
  onViewAll: () => void;
  /** Hide the fixed side tab (e.g. while the full-page sub-efforts modal is open). */
  hideSideTab?: boolean;
};

function SubEffortsLogList({
  isLoading,
  rows,
  onRowClick,
}: {
  isLoading: boolean;
  rows: any[];
  onRowClick: (rowId: string | number) => void;
}) {
  const count = rows.length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
        <span className="loading loading-spinner loading-sm text-primary" />
        Loading sub efforts…
      </div>
    );
  }

  if (count === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">No sub efforts yet.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row: any) => {
        const name = row?.sub_efforts?.name ?? '—';
        const who = row?.tenants_employee?.display_name ?? row?.created_by ?? '—';
        const when = row?.created_at ? new Date(row.created_at).toLocaleString() : '—';
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onRowClick(row.id)}
            className="w-full rounded-xl border border-base-200 bg-gray-50/60 px-3 py-2.5 text-left transition hover:bg-gray-50 dark:border-base-300 dark:bg-base-200/30 dark:hover:bg-base-200/50"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{name}</div>
                <div className="mt-0.5 truncate text-xs text-gray-500">
                  by <span className="font-medium text-gray-700 dark:text-gray-300">{String(who)}</span>
                </div>
              </div>
              <div className="whitespace-nowrap text-[11px] text-gray-400">{when}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function SubEffortsLogSidebar({
  isLoading,
  rows,
  onRowClick,
  onViewAll,
  hideSideTab = false,
}: SubEffortsLogSidebarProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (hideSideTab) setOpen(false);
  }, [hideSideTab]);

  if (hideSideTab) return null;

  const count = rows.length;

  const handleClose = () => setOpen(false);

  const handleRowClick = (rowId: string | number) => {
    onRowClick(rowId);
    setOpen(false);
  };

  const handleViewAll = () => {
    onViewAll();
    setOpen(false);
  };

  return createPortal(
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-0 top-1/2 z-[240] flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-2xl border border-r-0 border-base-200 bg-base-100 px-3.5 py-4 shadow-lg transition hover:bg-base-200/60 active:scale-[0.98] dark:border-base-300 md:px-4 md:py-5"
          aria-label="Open sub efforts log"
          title="Sub efforts log"
        >
          <DocumentCheckIcon className="h-7 w-7 text-primary md:h-8 md:w-8" />
          {count > 0 && (
            <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-content">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      )}

      <MobileBottomSheet
        open={open}
        onClose={handleClose}
        title="Sub efforts log"
        subtitle={count > 0 ? `${count} ${count === 1 ? 'entry' : 'entries'}` : undefined}
        zIndex={240}
        desktopLayout="drawer-right"
        scrollLock="mobile"
        contentClassName="px-4 py-3"
        sheetClassName="md:max-w-sm"
        footer={
          count > 0 ? (
            <div className="px-4 py-3">
              <button
                type="button"
                className="btn btn-primary btn-sm w-full gap-2"
                onClick={handleViewAll}
              >
                <ChevronLeftIcon className="h-4 w-4" />
                View all details
              </button>
            </div>
          ) : undefined
        }
      >
        <SubEffortsLogList isLoading={isLoading} rows={rows} onRowClick={handleRowClick} />
      </MobileBottomSheet>
    </>,
    document.body
  );
}
