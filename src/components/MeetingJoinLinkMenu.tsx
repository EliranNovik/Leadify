import React from 'react';
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

export function MeetingJoinLinkMenu({
  meeting,
  getMeetingJoinUrl,
  copyTextToClipboard,
  buttonClassName = 'btn btn-outline btn-primary btn-sm',
  iconClassName = 'w-4 h-4',
  title = 'Meeting link',
}: MeetingJoinLinkMenuProps) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const runAction = async (action: MeetingJoinAction) => {
    const url = getMeetingJoinUrl(meeting);
    if (!url) {
      toast.error('No meeting URL available');
      return;
    }
    if (action === 'enter') {
      window.open(url, '_blank');
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

  return (
    <>
      {/* Mobile: native picker (reliable on iOS Safari) */}
      <div className="relative shrink-0 md:hidden" onClick={(e) => e.stopPropagation()}>
        <span
          className={`${buttonClassName} inline-flex items-center justify-center pointer-events-none`}
          aria-hidden
        >
          <VideoCameraIcon className={iconClassName} />
        </span>
        <select
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          style={{ fontSize: '16px' }}
          defaultValue=""
          onChange={(e) => {
            const value = e.target.value as MeetingJoinAction | '';
            if (value) void runAction(value);
            e.target.value = '';
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={title}
        >
          <option value="" disabled>
            Meeting link
          </option>
          <option value="enter">Enter meeting</option>
          <option value="copy">Copy link</option>
          {canShare ? <option value="share">Share</option> : null}
        </select>
      </div>

      {/* Desktop: DaisyUI dropdown */}
      <div className="dropdown dropdown-top hidden md:block" onClick={(e) => e.stopPropagation()}>
        <button type="button" className={buttonClassName} title={title}>
          <VideoCameraIcon className={iconClassName} />
        </button>
        <ul
          tabIndex={0}
          className="dropdown-content menu z-[1000] w-52 rounded-box bg-base-100 p-2 shadow"
        >
          <li>
            <button type="button" onClick={() => void runAction('enter')}>
              Enter meeting
            </button>
          </li>
          <li>
            <button type="button" onClick={() => void runAction('copy')}>
              Copy link
            </button>
          </li>
          {canShare ? (
            <li>
              <button type="button" onClick={() => void runAction('share')}>
                Share
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </>
  );
}
