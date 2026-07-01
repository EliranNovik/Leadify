import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VideoCameraIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

type MeetingJoinAction = 'enter' | 'copy' | 'share';

type MeetingJoinLinkMenuProps = {
  meeting: unknown;
  getMeetingJoinUrl: (meeting: unknown) => string;
  copyTextToClipboard: (text: string) => Promise<boolean>;
  buttonClassName?: string;
  iconClassName?: string;
  title?: string;
};

function stopPropagationOnly(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function MeetingJoinLinkMenu({
  meeting,
  getMeetingJoinUrl,
  copyTextToClipboard,
  buttonClassName = 'btn btn-outline btn-primary btn-sm',
  iconClassName = 'w-4 h-4',
  title = 'Meeting link',
}: MeetingJoinLinkMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
    openUpward: boolean;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPosition(null);
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedMenuHeight = canShare ? 148 : 112;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < estimatedMenuHeight + 12 && rect.top > estimatedMenuHeight + 12;

    setMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 216)),
      top: openUpward ? rect.top - 8 : rect.bottom + 8,
      openUpward,
    });
  }, [open, canShare]);

  useEffect(() => {
    if (!open) return undefined;

    const close = (event: Event) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    // Defer so the opening tap does not immediately close the menu on iOS.
    const timerId = window.setTimeout(() => {
      document.addEventListener('mousedown', close);
      document.addEventListener('touchstart', close, { passive: true });
    }, 0);

    return () => {
      window.clearTimeout(timerId);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  const runAction = async (action: MeetingJoinAction) => {
    setOpen(false);
    const url = getMeetingJoinUrl(meeting);
    if (!url) {
      toast.error('No meeting URL available');
      return;
    }
    if (action === 'enter') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'copy') {
      const ok = await copyTextToClipboard(url);
      if (ok) toast.success('Meeting link copied');
      else toast.error('Failed to copy link');
      return;
    }
    try {
      await navigator.share({ title: 'Meeting link', url });
    } catch {
      // user cancelled or share unavailable
    }
  };

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${buttonClassName} shrink-0 touch-manipulation`}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
        onTouchStart={stopPropagationOnly}
      >
        <VideoCameraIcon className={iconClassName} />
      </button>

      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              data-meeting-join-menu
              className="w-52 rounded-xl border border-base-200 bg-base-100 p-2 shadow-lg"
              style={{
                position: 'fixed',
                left: menuPosition.left,
                top: menuPosition.top,
                transform: menuPosition.openUpward ? 'translateY(-100%)' : undefined,
                zIndex: 10000,
              }}
              onClick={stopPropagationOnly}
              onTouchStart={stopPropagationOnly}
            >
              <ul className="menu menu-sm p-0">
                <li>
                  <button
                    type="button"
                    className="touch-manipulation"
                    onClick={(e) => {
                      stopPropagationOnly(e);
                      void runAction('enter');
                    }}
                  >
                    Enter meeting
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="touch-manipulation"
                    onClick={(e) => {
                      stopPropagationOnly(e);
                      void runAction('copy');
                    }}
                  >
                    Copy link
                  </button>
                </li>
                {canShare ? (
                  <li>
                    <button
                      type="button"
                      className="touch-manipulation"
                      onClick={(e) => {
                        stopPropagationOnly(e);
                        void runAction('share');
                      }}
                    >
                      Share
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
