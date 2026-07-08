import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  deriveInitialsFromName,
  fetchBypassStaffUsers,
  type BypassStaffUser,
} from '../lib/adminClockInBypass';
import { switchToAdminWorker } from '../lib/adminSwitchWorker';
import { whatsAppAvatarBackgroundStyle } from '../lib/whatsappAvatarColors';

type AdminChangeUserModalProps = {
  isOpen: boolean;
  adminAuthUserId: string;
  currentUserId?: string | null;
  onClose: () => void;
  onSwitched: () => void;
};

const INPUT_CLASS =
  'h-11 w-full rounded-[10px] border border-base-300 bg-white px-4 text-sm text-base-content shadow-sm transition placeholder:text-base-content/35 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15';

const STAFF_AVATAR_SIZE = 'h-12 w-12';

function StaffListAvatar({
  displayName,
  photoUrl,
}: {
  displayName: string;
  photoUrl: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedUrl = photoUrl?.trim() || '';
  const showImage = Boolean(resolvedUrl) && !imageFailed;
  const initials = deriveInitialsFromName(displayName);
  const avatarStyle = whatsAppAvatarBackgroundStyle(displayName);

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedUrl]);

  if (!showImage) {
    return (
      <span
        className={`flex ${STAFF_AVATAR_SIZE} shrink-0 items-center justify-center rounded-full text-sm font-semibold`}
        style={avatarStyle}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt=""
      className={`${STAFF_AVATAR_SIZE} shrink-0 rounded-full object-cover`}
      onError={() => setImageFailed(true)}
    />
  );
}

const AdminChangeUserModal: React.FC<AdminChangeUserModalProps> = ({
  isOpen,
  adminAuthUserId,
  currentUserId,
  onClose,
  onSwitched,
}) => {
  const [staffUsers, setStaffUsers] = useState<BypassStaffUser[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setError(null);
      setIsSwitching(false);
      return;
    }

    let cancelled = false;
    setIsLoadingStaff(true);
    void (async () => {
      try {
        const users = await fetchBypassStaffUsers();
        if (!cancelled) setStaffUsers(users);
      } finally {
        if (!cancelled) setIsLoadingStaff(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const filteredStaff = useMemo(() => {
    const query = search.trim().toLowerCase();
    return staffUsers
      .filter((staff) => staff.userId !== currentUserId)
      .filter((staff) => {
        if (!query) return true;
        return (
          staff.displayName.toLowerCase().includes(query) ||
          staff.email.toLowerCase().includes(query)
        );
      });
  }, [currentUserId, search, staffUsers]);

  const handleWorkerSelect = async (staffUser: BypassStaffUser) => {
    setIsSwitching(true);
    setError(null);

    try {
      await switchToAdminWorker(adminAuthUserId, staffUser);
      toast.success(`Signed in as ${staffUser.displayName}`);
      onSwitched();
    } catch (switchError) {
      console.error('Admin worker switch failed:', switchError);
      const message = switchError instanceof Error ? switchError.message : 'Failed to switch user';
      setError(message);
      toast.error(message);
    } finally {
      setIsSwitching(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-change-user-title"
    >
      <div className="relative flex max-h-[min(90dvh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-base-200 px-5 py-4">
          <div>
            <h2 id="admin-change-user-title" className="text-lg font-semibold text-base-content">
              Change user
            </h2>
            <p className="mt-1 text-sm text-base-content/60">
              Select another worker account to sign in as.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm"
            onClick={onClose}
            aria-label="Close change user"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email"
            className={`${INPUT_CLASS} mb-3`}
          />

          <div className="max-h-80 overflow-y-auto">
            {isLoadingStaff ? (
              <div className="flex justify-center py-10">
                <span className="loading loading-spinner loading-md text-primary" />
              </div>
            ) : filteredStaff.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-base-content/55">No matching staff found.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {filteredStaff.map((staff) => (
                  <li key={staff.userId}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl bg-base-200/40 px-4 py-3 text-left transition hover:bg-base-200/70 disabled:opacity-60 outline-none ring-0 focus:outline-none focus:ring-0"
                      disabled={isSwitching}
                      onClick={() => void handleWorkerSelect(staff)}
                    >
                      <StaffListAvatar displayName={staff.displayName} photoUrl={staff.photoUrl} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{staff.displayName}</span>
                        {staff.email ? (
                          <span className="block truncate text-xs text-base-content/55">{staff.email}</span>
                        ) : null}
                      </span>
                      <ChevronRightIcon className="h-5 w-5 shrink-0 text-base-content/35" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default AdminChangeUserModal;
