import {
  buildUserAdminBypass,
  readAdminClockInBypassRaw,
  resolveAdminSwitchGrant,
  writeAdminClockInBypass,
  type BypassStaffUser,
} from './adminClockInBypass';
import { readAdminImpersonationGrant, writeAdminImpersonationGrant } from './adminImpersonationGrant';
import {
  requestWorkerSwitchToken,
  signInWithWorkerLoginToken,
} from './adminWorkerLoginApi';

export async function switchToAdminWorker(
  adminAuthUserId: string,
  staffUser: BypassStaffUser,
): Promise<{ authUserId: string }> {
  const bypass = readAdminClockInBypassRaw();
  const grant = readAdminImpersonationGrant(adminAuthUserId);
  const resolved = resolveAdminSwitchGrant(adminAuthUserId);
  const sessionAuthUserId = bypass?.sessionAuthUserId ?? resolved.sessionAuthUserId;

  if (!sessionAuthUserId) {
    throw new Error('Admin session expired. Please sign in again from the login page.');
  }

  const switchGrant = grant?.switchGrant ?? resolved.switchGrant ?? null;

  const tokenPayload = await requestWorkerSwitchToken(
    adminAuthUserId,
    switchGrant,
    sessionAuthUserId,
    staffUser.userId,
  );

  const { authUserId } = await signInWithWorkerLoginToken(
    tokenPayload.email,
    tokenPayload.token_hash,
  );

  const nextSwitchGrant = tokenPayload.switch_grant ?? switchGrant;
  if (nextSwitchGrant) {
    writeAdminImpersonationGrant({
      adminAuthUserId,
      switchGrant: nextSwitchGrant,
    });
  }

  writeAdminClockInBypass(
    buildUserAdminBypass(adminAuthUserId, staffUser, authUserId, nextSwitchGrant),
  );

  return { authUserId };
}
