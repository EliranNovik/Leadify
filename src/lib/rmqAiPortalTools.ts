import { fetchLeadContacts } from './contactHelpers';
import { getRmqAiCurrentLead } from './rmqAiChatContext';
import { requireResolvedLead, type LeadResolveArgs } from './rmqAiLeadResolver';
import { buildPortalUrl } from './portalApi';
import { portalStaffGetStatus, portalStaffSetPassword } from './portalStaffApi';
import { supabase } from './supabase';

export type ClientPortalAccess = {
  leadNumber: string;
  displayName: string;
  portalEnabled: boolean;
  passwordGenerated: boolean;
  portalLink: string;
  loginEmail: string;
  password: string;
  ready: boolean;
};

function generatePortalPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function portalLeadType(isLegacy: boolean): 'legacy' | 'new' {
  return isLegacy ? 'legacy' : 'new';
}

function portalRpcLeadId(leadId: string): string {
  return String(leadId || '').replace(/^legacy_/i, '').trim();
}

async function resolvePortalLoginEmail(
  leadId: string,
  isLegacy: boolean,
  fallback?: string | null,
): Promise<string> {
  const openEmail = String(fallback || '').trim();
  if (openEmail.includes('@')) return openEmail;
  const rawId = portalRpcLeadId(leadId);
  try {
    const contacts = await fetchLeadContacts(rawId, isLegacy);
    const withEmail =
      contacts.find((c) => c.isMain && c.email) || contacts.find((c) => Boolean(c.email));
    if (withEmail?.email?.includes('@')) return String(withEmail.email).trim();
  } catch {
    /* fall through */
  }
  const table = isLegacy ? 'leads_lead' : 'leads';
  const { data } = await supabase.from(table).select('email').eq('id', rawId).maybeSingle();
  const email = String(data?.email || '').trim();
  return email.includes('@') ? email : '';
}

export function formatClientPortalAccessBlock(access: ClientPortalAccess, heading = 'CLIENT PORTAL'): string {
  const lines = [
    `${heading}`,
    `- portal_enabled: ${access.portalEnabled ? 'yes' : 'no'}`,
    `- password_generated: ${access.passwordGenerated ? 'yes' : 'no'}`,
    `- portal_link: ${access.portalLink || '(none)'}`,
    `- login_email: ${access.loginEmail || '(none on file)'}`,
    `- password: ${access.password || '(none — call setup_client_portal to generate and save one)'}`,
    '',
    'HOW TO SIGN IN — the client needs all three:',
    '1. Open the exact portal_link in a browser (never invent a URL).',
    '2. Sign in with login_email (the email on the client’s CRM contact).',
    '3. Enter the portal password / access code.',
  ];
  if (!access.ready) {
    const missing: string[] = [];
    if (!access.passwordGenerated) missing.push('password is not generated');
    if (!access.portalEnabled) missing.push('portal is not enabled');
    if (!access.portalLink) missing.push('portal link is missing');
    if (!access.loginEmail) missing.push('no client email on file');
    lines.push(`NOT READY: ${missing.join('; ')}. Call setup_client_portal to generate a password, save it, and enable the portal.`);
  }
  return lines.join('\n');
}

export async function loadClientPortalAccess(args: LeadResolveArgs): Promise<ClientPortalAccess> {
  const lead = await requireResolvedLead(args);
  const open = getRmqAiCurrentLead();
  const rpcLeadId = portalRpcLeadId(lead.leadId);
  const leadType = portalLeadType(lead.isLegacy);
  const [status, loginEmail] = await Promise.all([
    portalStaffGetStatus(rpcLeadId, leadType, lead.leadNumber),
    resolvePortalLoginEmail(lead.leadId, lead.isLegacy, open?.email),
  ]);
  const leadRef = String(status.lead_ref || lead.leadNumber || rpcLeadId).trim();
  const portalLink = leadRef ? buildPortalUrl(leadRef) : '';
  const storedPassword = String(status.password_plain || '').trim();
  const passwordGenerated = !!status.has_password;
  const portalEnabled = passwordGenerated ? status.enabled !== false : false;
  const password = storedPassword
    || (passwordGenerated ? '(saved — call setup_client_portal to generate a new visible password)' : '');
  return {
    leadNumber: lead.leadNumber,
    displayName: lead.displayName,
    portalEnabled,
    passwordGenerated,
    portalLink,
    loginEmail,
    password,
    ready: portalEnabled && passwordGenerated && Boolean(portalLink),
  };
}

export async function executeGetClientPortalAccess(args: LeadResolveArgs): Promise<string> {
  const access = await loadClientPortalAccess(args);
  return [
    `Matched: ${access.leadNumber} ${access.displayName}`,
    '',
    formatClientPortalAccessBlock(access),
    '',
    access.ready
      ? 'Copy portal_link, login_email, and password exactly. Do not invent a URL or password. Do not write [Insert client portal link].'
      : 'Do not invent a portal URL or password. Tell the staff the portal is not ready and offer to call setup_client_portal.',
  ].join('\n');
}

export async function executeSetupClientPortal(
  args: LeadResolveArgs & {
    generate_password?: boolean;
    enable_portal?: boolean;
    password?: string;
  },
): Promise<string> {
  const lead = await requireResolvedLead(args);
  const rpcLeadId = portalRpcLeadId(lead.leadId);
  const leadType = portalLeadType(lead.isLegacy);
  const current = await portalStaffGetStatus(rpcLeadId, leadType, lead.leadNumber);
  const enablePortal = args.enable_portal !== false;
  const requestedPassword = String(args.password || '').trim();
  const shouldGenerate =
    Boolean(args.generate_password) ||
    Boolean(requestedPassword) ||
    !current.has_password;

  if (requestedPassword && requestedPassword.length < 6) {
    return 'Error executing setup_client_portal: password must be at least 6 characters.';
  }

  const passwordToSave = shouldGenerate
    ? requestedPassword || generatePortalPassword()
    : null;

  if (!current.has_password && !passwordToSave) {
    return 'Error executing setup_client_portal: generate a password before enabling the portal.';
  }

  await portalStaffSetPassword(rpcLeadId, leadType, {
    password: passwordToSave,
    enabled: enablePortal,
    leadNumber: lead.leadNumber,
  });

  const access = await loadClientPortalAccess({
    query: args.query,
    lead_id: lead.leadId,
    is_legacy: lead.isLegacy,
  });
  const action = passwordToSave
    ? current.has_password
      ? 'Generated a new portal password, saved it, and updated portal access.'
      : 'Generated a portal password, saved it, and enabled the client portal.'
    : enablePortal
      ? 'Enabled the client portal (existing password kept).'
      : 'Saved portal settings.';

  return [
    `Matched: ${access.leadNumber} ${access.displayName}`,
    action,
    '',
    formatClientPortalAccessBlock(access),
    '',
    'Share portal_link, login_email, and password with the staff. The client needs all three to sign in. Do not invent a URL.',
  ].join('\n');
}

export function parsePortalLinkFromToolResult(result: string): string | null {
  const match = String(result || '').match(/portal_link:\s*(https:\/\/\S+)/i);
  const url = (match?.[1] || '').replace(/[.,;]+$/, '');
  return url.startsWith('https://') ? url : null;
}
