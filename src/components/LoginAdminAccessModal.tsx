import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ShieldCheckIcon,
  XMarkIcon,
  LockClosedIcon,
  AtSymbolIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import {
  buildUserAdminBypass,
  deriveInitialsFromName,
  fetchBypassStaffUsers,
  verifyAuthUserIsSuperuser,
  writeAdminClockInBypass,
  type BypassStaffUser,
} from '../lib/adminClockInBypass';
import { whatsAppAvatarBackgroundStyle } from '../lib/whatsappAvatarColors';
import {
  requestWorkerLoginToken,
  signInWithWorkerLoginToken,
} from '../lib/adminWorkerLoginApi';
import { writeAdminImpersonationGrant } from '../lib/adminImpersonationGrant';
import { fetchWelcomeProfileForEmail } from '../lib/loginWelcomeProfile';
import { setDashboardWelcomePending } from '../lib/dashboardWelcomeSession';
import { preCheckExternalUser } from '../hooks/useExternalUser';

type LoginAdminAccessModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onWorkerSignedIn: () => void;
};

type Step = 'verify' | 'pick';

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

const LoginAdminAccessModal: React.FC<LoginAdminAccessModalProps> = ({
  isOpen,
  onClose,
  onWorkerSignedIn,
}) => {
  const [step, setStep] = useState<Step>('verify');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuthUserId, setAdminAuthUserId] = useState<string | null>(null);
  const [staffUsers, setStaffUsers] = useState<BypassStaffUser[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [isSigningInWorker, setIsSigningInWorker] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setStep('verify');
      setAdminEmail('');
      setAdminPassword('');
      setAdminAuthUserId(null);
      setStaffUsers([]);
      setSearch('');
      setError(null);
      setIsVerifying(false);
      setIsLoadingStaff(false);
      setIsSigningInWorker(false);
    }
  }, [isOpen]);

  const filteredStaff = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return staffUsers;
    return staffUsers.filter((staff) =>
      staff.displayName.toLowerCase().includes(query) ||
      staff.email.toLowerCase().includes(query),
    );
  }, [search, staffUsers]);

  const cleanupAdminSession = async () => {
    await supabase.auth.signOut().catch(() => {});
    setAdminAuthUserId(null);
  };

  const handleClose = () => {
    void cleanupAdminSession();
    onClose();
  };

  const handleVerifyAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsVerifying(true);
    setError(null);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: adminEmail.trim(),
        password: adminPassword,
      });

      if (signInError || !data.session?.access_token || !data.user?.id) {
        throw signInError || new Error('Admin sign-in failed');
      }

      const isSuper = await verifyAuthUserIsSuperuser(data.user.id);
      if (!isSuper) {
        await cleanupAdminSession();
        throw new Error('This account is not a superuser.');
      }

      setAdminAuthUserId(data.user.id);
      setStep('pick');
      setIsLoadingStaff(true);

      const users = await fetchBypassStaffUsers();
      setStaffUsers(users);
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : 'Admin verification failed';
      setError(message);
    } finally {
      setIsVerifying(false);
      setIsLoadingStaff(false);
    }
  };

  const handleWorkerSelect = async (staffUser: BypassStaffUser) => {
    if (!adminAuthUserId) return;

    setIsSigningInWorker(true);
    setError(null);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) {
        throw new Error('Admin session expired. Please verify again.');
      }

      const tokenPayload = await requestWorkerLoginToken(accessToken, staffUser.userId);
      const { authUserId } = await signInWithWorkerLoginToken(
        tokenPayload.email,
        tokenPayload.token_hash,
      );

      const switchGrant = tokenPayload.switch_grant ?? null;
      if (switchGrant) {
        writeAdminImpersonationGrant({
          adminAuthUserId,
          switchGrant,
        });
      }

      writeAdminClockInBypass(
        buildUserAdminBypass(adminAuthUserId, staffUser, authUserId, switchGrant),
      );

      const profile = await fetchWelcomeProfileForEmail(tokenPayload.email, { email: tokenPayload.email });
      setDashboardWelcomePending(profile);
      void import('../components/Dashboard');
      void preCheckExternalUser(authUserId);

      toast.success(`Signed in as ${staffUser.displayName}`);
      onWorkerSignedIn();
    } catch (workerError) {
      console.error('Worker admin sign-in failed:', workerError);
      const message = workerError instanceof Error ? workerError.message : 'Failed to sign in as worker';
      setError(message);
      await cleanupAdminSession();
      setStep('verify');
    } finally {
      setIsSigningInWorker(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-admin-access-title"
    >
      <div className="relative flex max-h-[min(90dvh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-base-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheckIcon className="h-5 w-5" aria-hidden />
              <h2 id="login-admin-access-title" className="text-lg font-semibold text-base-content">
                Admin access
              </h2>
            </div>
            <p className="mt-1 text-sm text-base-content/60">
              {step === 'verify'
                ? 'Verify your superuser account to continue on this page.'
                : 'Choose a worker account to sign in as.'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm"
            onClick={handleClose}
            aria-label="Close admin access"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 'verify' ? (
            <form onSubmit={(event) => void handleVerifyAdmin(event)} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-base-content/60" htmlFor="admin-email">
                  Admin email
                </label>
                <div className="relative">
                  <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-base-content/40" />
                  <input
                    id="admin-email"
                    type="email"
                    autoComplete="username"
                    required
                    className={`${INPUT_CLASS} pl-10`}
                    value={adminEmail}
                    onChange={(event) => setAdminEmail(event.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-base-content/60" htmlFor="admin-password">
                  Admin password
                </label>
                <div className="relative">
                  <LockClosedIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-base-content/40" />
                  <input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className={`${INPUT_CLASS} pl-10`}
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary h-11 w-full rounded-xl border-0 font-semibold"
                disabled={isVerifying}
              >
                {isVerifying ? <span className="loading loading-spinner loading-sm" /> : 'Verify admin access'}
              </button>
            </form>
          ) : (
            <div>
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
                          className="flex w-full items-center gap-3 rounded-xl bg-base-200/40 px-4 py-3 text-left transition hover:bg-base-200/70 disabled:opacity-60 outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none"
                          disabled={isSigningInWorker}
                          onClick={() => void handleWorkerSelect(staff)}
                        >
                          <StaffListAvatar
                            displayName={staff.displayName}
                            photoUrl={staff.photoUrl}
                          />
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
            </div>
          )}

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

export default LoginAdminAccessModal;
