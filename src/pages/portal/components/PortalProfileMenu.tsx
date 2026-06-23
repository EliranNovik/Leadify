import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRightOnRectangleIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { EntityAvatar } from './portalTheme';

type Props = {
  name: string;
  leadNumber?: string | null;
  imageUrl?: string | null;
  stableKey: string;
  onLogout: () => void;
  onSettings?: () => void;
  dropUp?: boolean;
  onDark?: boolean;
};

const PortalProfileMenu: React.FC<Props> = ({
  name,
  leadNumber,
  imageUrl,
  stableKey,
  onLogout,
  onSettings,
  dropUp = false,
  onDark = false,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex max-w-[220px] items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors sm:max-w-[240px] sm:pr-2.5 ${
          onDark ? 'hover:bg-white/15' : 'hover:bg-base-200/70'
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <EntityAvatar
          name={name}
          imageUrl={imageUrl}
          stableKey={stableKey}
          className="h-9 w-9 shrink-0 text-xs"
        />
        <div className="min-w-0 text-left">
          <span
            className={`block truncate text-sm font-semibold ${
              onDark ? 'text-primary-content' : 'text-base-content/80'
            }`}
          >
            {name}
          </span>
          {leadNumber ? (
            <span
              className={`block truncate text-xs ${
                onDark ? 'text-primary-content/70' : 'text-base-content/45'
              }`}
            >
              Case #{leadNumber}
            </span>
          ) : null}
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 transition-transform ${
            onDark ? 'text-primary-content/70' : 'text-base-content/40'
          } ${open ? (dropUp ? 'rotate-0' : 'rotate-180') : dropUp ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          className={`absolute right-0 z-50 min-w-[180px] rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg ${
            dropUp ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {onSettings ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
              onClick={() => {
                close();
                onSettings();
              }}
            >
              <Cog6ToothIcon className="h-4 w-4 text-base-content/50" />
              Settings
            </button>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
            onClick={() => {
              close();
              onLogout();
            }}
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4 text-base-content/50" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default PortalProfileMenu;
