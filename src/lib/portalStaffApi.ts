import { supabase } from './supabase';

function formatRpcError(error: { message?: string; details?: string; hint?: string; code?: string }): string {
  const parts = [error.message, error.details, error.hint].filter(Boolean);
  if (parts.length) return parts.join(' — ');
  return 'Request failed';
}

function parseRpcJson<T>(data: unknown): T {
  if (data == null) return {} as T;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as T;
    } catch {
      return {} as T;
    }
  }
  return data as T;
}

function normalizePortalLeadId(leadId: string): string {
  return String(leadId || '').replace(/^legacy_/, '').trim();
}

type StaffStatus = {
  enabled: boolean;
  has_password: boolean;
  password_plain?: string | null;
  lead_ref: string | null;
  updated_at?: string;
};

type StaffSaveResult = {
  ok: boolean;
  error?: string;
  enabled?: boolean;
  updated_at?: string;
};

const PORTAL_RPC_MIGRATION_HINT =
  'Run sql/client_portal_fix_auth.sql in the Supabase SQL editor, then try again.';

function buildStaffStatusRpcArgs(
  leadId: string,
  leadType: string,
  leadNumber?: string | null,
) {
  const id = normalizePortalLeadId(leadId);
  const num = (leadNumber || '').trim();
  return {
    p_lead_id: id,
    p_lead_type: leadType || 'auto',
    p_lead_number: num || id,
  };
}

function buildStaffSetPasswordRpcArgs(
  leadId: string,
  leadType: string,
  leadNumber: string | null | undefined,
  password: string | null,
  enabled: boolean,
) {
  return {
    ...buildStaffStatusRpcArgs(leadId, leadType, leadNumber),
    p_password: password,
    p_enabled: enabled,
  };
}

export async function portalStaffGetStatus(
  leadId: string,
  leadType: string,
  leadNumber?: string | null,
): Promise<StaffStatus> {
  const id = normalizePortalLeadId(leadId);
  const num = (leadNumber || '').trim();
  const fallbackRef = num || id;

  const { data, error } = await supabase.rpc(
    'portal_staff_get_status',
    buildStaffStatusRpcArgs(leadId, leadType, leadNumber),
  );

  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      throw new Error(`${PORTAL_RPC_MIGRATION_HINT} (${formatRpcError(error)})`);
    }
    throw new Error(formatRpcError(error));
  }

  const status = parseRpcJson<StaffStatus>(data);
  return {
    enabled: status.enabled !== false,
    has_password: !!status.has_password,
    password_plain: status.password_plain?.trim() || null,
    lead_ref: status.lead_ref || fallbackRef,
    updated_at: status.updated_at,
  };
}

export async function portalStaffSetPassword(
  leadId: string,
  leadType: string,
  options: {
    password?: string | null;
    enabled: boolean;
    leadNumber?: string | null;
  },
): Promise<StaffSaveResult> {
  const password = options.password?.trim() || null;

  const { data, error } = await supabase.rpc(
    'portal_staff_set_password',
    buildStaffSetPasswordRpcArgs(leadId, leadType, options.leadNumber, password, options.enabled),
  );

  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      throw new Error(`${PORTAL_RPC_MIGRATION_HINT} (${formatRpcError(error)})`);
    }
    throw new Error(formatRpcError(error));
  }

  const result = parseRpcJson<StaffSaveResult>(data);
  if (result.ok === false) {
    throw new Error(result.error || 'Failed to save portal settings');
  }
  return result;
}
