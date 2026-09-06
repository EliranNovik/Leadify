const supabase = require('../config/supabase');
const graphMailboxSyncService = require('./graphMailboxSyncService');
const mailboxTokenService = require('./mailboxTokenService');
const {
  parseEmailTemplateContent,
  escapeHtml,
  formatPlainEmailHtml,
} = require('../lib/emailTemplateContent');

const DEFAULT_TEMPLATE_ID = 194;
const NEW_WINDOW_DAYS = 7;
const PAGE_SIZE = 1000;
const ID_CHUNK = 100;
const HISTORY_CHUNK = 100;
const STAGE_CHUNK = 200;

const STAGE_FALLBACK = {
  0: 'Created',
  10: 'Scheduler assigned',
  11: 'Precommunication',
  15: 'Communication started',
  20: 'Meeting scheduled',
  21: 'Meeting rescheduling',
  30: 'Meeting complete',
  35: 'Meeting Irrelevant',
  40: 'Waiting for Mtng sum',
  50: 'Mtng sum+Agreement sent',
  51: 'Client declined price offer',
  55: 'Another meeting',
  60: 'Client signed agreement',
  70: 'Payment request sent',
  91: 'Dropped (Spam/Irrelevant)',
  100: 'Success',
  105: 'Handler Set',
  110: 'Handler Started',
  150: 'Application submitted',
  200: 'Closed',
};

function getTemplateId() {
  const id = parseInt(process.env.HANDLER_NEW_CASES_TEMPLATE_ID || String(DEFAULT_TEMPLATE_ID), 10);
  return Number.isFinite(id) ? id : DEFAULT_TEMPLATE_ID;
}

/** Same sender as payment receipt emails (`PAYMENT_CONFIRMATION_MAILBOX_USER_ID`). */
function getPaymentReceiptMailboxUserId() {
  return (process.env.PAYMENT_CONFIRMATION_MAILBOX_USER_ID || '').trim();
}

async function getGraphAppAccessToken() {
  const tenantId =
    process.env.GRAPH_TENANT_ID || process.env.MSAL_TENANT_ID || process.env.AZURE_TENANT_ID;
  const clientId =
    process.env.GRAPH_CLIENT_ID || process.env.MSAL_CLIENT_ID || process.env.AZURE_CLIENT_ID;
  const clientSecret =
    process.env.GRAPH_CLIENT_SECRET ||
    process.env.CLIENT_SECRET ||
    process.env.MSAL_CLIENT_SECRET ||
    process.env.AZURE_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph app credentials are not configured on the server');
  }
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to acquire Graph app token: ${await response.text()}`);
  }
  const data = await response.json();
  return data.access_token;
}

function isAppOnlyGraphBlocked(message) {
  const text = String(message || '');
  return (
    text.includes('AppOnly AccessPolicy') ||
    text.includes('Access to OData is disabled') ||
    text.includes('[RAOP]')
  );
}

async function sendMailAsPaymentReceiptMailbox({ fromEmail, to, subject, html }) {
  const accessToken = await getGraphAppAccessToken();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromEmail)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
          importance: 'high',
        },
        saveToSentItems: true,
      }),
    },
  );
  if (!response.ok && response.status !== 202) {
    const detail = await response.text();
    if (isAppOnlyGraphBlocked(detail)) {
      throw new Error(
        `Tenant blocks app-only Graph send from ${fromEmail}. Connect that Outlook mailbox in the CRM (same account as payment receipts).`,
      );
    }
    throw new Error(`Failed to send from payment-receipt mailbox ${fromEmail}: ${detail}`);
  }
}

async function loadPaymentReceiptUser(configuredId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, auth_id, email')
    .or(`id.eq.${configuredId},auth_id.eq.${configuredId}`)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findDelegatedMailboxUserId(configuredId, user) {
  const tokenTable = process.env.MAILBOX_TOKEN_TABLE || 'mailbox_tokens';
  const candidateIds = [...new Set([configuredId, user?.id, user?.auth_id].filter(Boolean))];
  for (const id of candidateIds) {
    try {
      const token = await mailboxTokenService.getTokenByUserId(id);
      if (token?.mailbox_address) return { userId: id, fromEmail: token.mailbox_address };
    } catch {
      // try raw mailbox_tokens.user_id (sometimes stored as auth_id)
    }
    const { data } = await supabase
      .from(tokenTable)
      .select('user_id, mailbox_address, status')
      .eq('user_id', id)
      .limit(1)
      .maybeSingle();
    if (data?.mailbox_address) {
      return { userId: data.user_id, fromEmail: data.mailbox_address };
    }
  }

  const mailboxEmail = String(user?.email || '').trim();
  if (mailboxEmail) {
    const { data } = await supabase
      .from(tokenTable)
      .select('user_id, mailbox_address, status')
      .ilike('mailbox_address', mailboxEmail)
      .limit(1)
      .maybeSingle();
    if (data?.user_id && data?.mailbox_address) {
      return { userId: data.user_id, fromEmail: data.mailbox_address };
    }
  }
  return null;
}

/**
 * Always send as the payment-receipt account.
 * Prefer its connected mailbox token; otherwise send as that user's email via Graph app credentials.
 */
async function resolvePaymentReceiptSender() {
  const configuredId = getPaymentReceiptMailboxUserId();
  if (!configuredId) {
    throw new Error(
      'PAYMENT_CONFIRMATION_MAILBOX_USER_ID is not set. Handler digest emails use the same sender as payment receipts.',
    );
  }

  const user = await loadPaymentReceiptUser(configuredId);
  const delegated = await findDelegatedMailboxUserId(configuredId, user);
  if (delegated) {
    return { mode: 'delegated', mailboxUserId: delegated.userId, fromEmail: delegated.fromEmail };
  }

  const fromEmail = String(user?.email || '').trim();
  if (fromEmail.includes('@')) {
    return { mode: 'app', mailboxUserId: configuredId, fromEmail };
  }

  const bookingId = (process.env.BOOKING_MAILBOX_USER_ID || '').trim();
  if (bookingId) {
    const bookingUser = await loadPaymentReceiptUser(bookingId);
    const bookingDelegated = await findDelegatedMailboxUserId(bookingId, bookingUser);
    if (bookingDelegated) {
      console.warn(
        '[HandlerNewCasesDigest] PAYMENT_CONFIRMATION_MAILBOX_USER_ID is not a connected CRM mailbox; sending from BOOKING_MAILBOX_USER_ID',
        { paymentId: configuredId, fromEmail: bookingDelegated.fromEmail },
      );
      return {
        mode: 'delegated',
        mailboxUserId: bookingDelegated.userId,
        fromEmail: bookingDelegated.fromEmail,
        fallback: 'booking',
      };
    }
  }

  throw new Error(
    `PAYMENT_CONFIRMATION_MAILBOX_USER_ID=${configuredId} is not a CRM user and has no connected Outlook mailbox. Set it to a users.id with mailbox status=connected (the account that should send payment receipts).`,
  );
}

function getPublicAppUrl() {
  const raw =
    process.env.CRM_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    process.env.VITE_FRONTEND_URL ||
    'https://rmq-crm.app';
  return String(raw).replace(/\/$/, '');
}

function getJerusalemDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function safeParseDate(value) {
  if (!value || (typeof value === 'string' && value.trim() === '')) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  if (year < 1900 || year > 2100) return null;
  return date;
}

function toYmd(date) {
  return date.toISOString().split('T')[0];
}

function daysSince(date, today = new Date()) {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const base = new Date(date);
  base.setHours(0, 0, 0, 0);
  return Math.floor((start.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateDisplay(value) {
  const date = safeParseDate(value);
  if (!date) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

function isUnassignedLike(nameOrId) {
  if (nameOrId == null) return true;
  const s = String(nameOrId).trim().toLowerCase();
  return (
    !s ||
    s === '---' ||
    s === '--' ||
    s === '(empty)' ||
    s === 'empty' ||
    s === 'unassigned' ||
    s === 'not assigned' ||
    s === 'null' ||
    s === 'undefined' ||
    s === '0'
  );
}

function classifyBucket(stageId, activeHandlerType, isInactive) {
  if (stageId == null || Number.isNaN(stageId)) return null;
  if (stageId === 200) return 'closed';
  if (Number(activeHandlerType) === 1) return 'non_active';
  if (isInactive) return null;
  if (Number(activeHandlerType) === 2 && stageId <= 105) return 'new';
  if (Number(activeHandlerType) === 2 && stageId >= 110) return 'active';
  return null;
}

/** Same New / Re-assigned rules as Handler pipeline + My Cases. Re-assigned wins. */
function getHandlerAssignmentFlags(input) {
  let isNew = false;
  if (input.bucket === 'new') {
    const newCasesBase = safeParseDate(
      input.handlerAssignedDate || input.stage105Date || input.assignedDate,
    );
    if (newCasesBase) {
      const days = daysSince(newCasesBase);
      isNew = days >= 0 && days <= NEW_WINDOW_DAYS;
    }
  } else if (input.bucket === 'active' || input.bucket === 'non_active') {
    const s110 = safeParseDate(input.stage110Date);
    if (s110) {
      const days = daysSince(s110);
      isNew = days >= 0 && days <= NEW_WINDOW_DAYS;
    }
  }

  const prevHandlerName = (input.previousHandlerName || '').trim();
  const myHandler = safeParseDate(input.handlerAssignedDate);
  const isReassigned = Boolean(
    myHandler && prevHandlerName && daysSince(myHandler) >= 0 && daysSince(myHandler) <= NEW_WINDOW_DAYS,
  );

  return { isNew, isReassigned };
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function fetchAllPages(buildQuery) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function formatCategory(miscCategory, fallback) {
  const cat = Array.isArray(miscCategory) ? miscCategory[0] : miscCategory;
  if (cat && typeof cat === 'object') {
    const main = Array.isArray(cat.misc_maincategory) ? cat.misc_maincategory[0] : cat.misc_maincategory;
    if (cat.name && main?.name) return `${cat.name} (${main.name})`;
    if (cat.name) return cat.name;
  }
  const text = String(fallback || '').trim();
  return text || '—';
}

function leadPageUrl(navId) {
  return `${getPublicAppUrl()}/clients/${encodeURIComponent(String(navId))}`;
}

function resolveHandlerDisplayName(maybeIdOrName, employeesById) {
  if (maybeIdOrName == null) return null;
  const s = String(maybeIdOrName).trim();
  if (!s || isUnassignedLike(s)) return null;
  const n = Number(s);
  if (!Number.isNaN(n) && Number.isFinite(n) && n > 0) {
    return employeesById.get(String(n)) || null;
  }
  return s;
}

function buildAssignmentMeta(histRows, employeeId, employeeName, employeesById) {
  const employeeIdStr = String(employeeId);
  const normalizedName = String(employeeName || '').trim().toLowerCase();
  const lastHandlerNameByLead = new Map();
  const lastHandlerChangedAtByLead = new Map();
  const assigned = new Map();
  const first = new Map();
  const prevName = new Map();
  const prevDate = new Map();

  const sorted = [...histRows].sort((a, b) => {
    const da = safeParseDate(a.changed_at)?.getTime() || 0;
    const db = safeParseDate(b.changed_at)?.getTime() || 0;
    return da - db;
  });

  sorted.forEach((row) => {
    const oid = String(row.original_id);
    const caseHandlerId = row.case_handler_id != null ? String(row.case_handler_id) : '';
    const handlerName = row.handler != null ? String(row.handler).trim().toLowerCase() : '';
    const hasAnyHandler =
      (caseHandlerId !== '' && caseHandlerId !== '0') ||
      (handlerName !== '' && handlerName !== '---' && handlerName !== '--');
    if (hasAnyHandler && !first.has(oid)) {
      const dAny = safeParseDate(row.changed_at);
      if (dAny) first.set(oid, toYmd(dAny));
    }

    const isAssignedToMe =
      (caseHandlerId !== '' && caseHandlerId === employeeIdStr) ||
      (!!normalizedName && handlerName === normalizedName) ||
      (handlerName !== '' && handlerName === employeeIdStr);

    if (isAssignedToMe) {
      const d = safeParseDate(row.changed_at);
      if (!d) return;
      const prevNameRaw = lastHandlerNameByLead.get(oid) || null;
      const prev = !prevNameRaw || isUnassignedLike(prevNameRaw) ? null : prevNameRaw;
      const prevD = lastHandlerChangedAtByLead.get(oid) || null;
      if (prev) prevName.set(oid, prev);
      else prevName.delete(oid);
      if (prevD) prevDate.set(oid, prevD);
      else prevDate.delete(oid);
      assigned.set(oid, toYmd(d));
      return;
    }

    const anyHandlerDisplay =
      resolveHandlerDisplayName(row.case_handler_id, employeesById) ||
      resolveHandlerDisplayName(row.handler, employeesById);
    if (anyHandlerDisplay && !isUnassignedLike(anyHandlerDisplay)) {
      const dAny = safeParseDate(row.changed_at);
      if (dAny) {
        lastHandlerNameByLead.set(oid, anyHandlerDisplay);
        lastHandlerChangedAtByLead.set(oid, toYmd(dAny));
      }
    }
  });

  return { assigned, first, prevName, prevDate };
}

async function loadStageDates(ids, column, stage, keepEarliest) {
  const target = new Map();
  if (ids.length === 0) return target;
  for (const part of chunk(ids, STAGE_CHUNK)) {
    const { data, error } = await supabase
      .from('leads_leadstage')
      .select(`${column}, date, cdate`)
      .eq('stage', stage)
      .in(column, part)
      .order('date', { ascending: true, nullsFirst: false })
      .order('cdate', { ascending: true, nullsFirst: false });
    if (error) throw error;
    (data || []).forEach((row) => {
      const rawId = row?.[column];
      if (rawId == null) return;
      const d = safeParseDate(row.date) || safeParseDate(row.cdate);
      if (!d) return;
      const nextVal = toYmd(d);
      const prevVal = target.get(String(rawId));
      if (!prevVal) {
        target.set(String(rawId), nextVal);
        return;
      }
      const prevD = safeParseDate(prevVal);
      if (!prevD) return;
      if (keepEarliest ? d.getTime() < prevD.getTime() : d.getTime() > prevD.getTime()) {
        target.set(String(rawId), nextVal);
      }
    });
  }
  return target;
}

function matchesHandlerFilter(handler, filter = {}) {
  const employeeId = filter.employeeId != null ? Number(filter.employeeId) : null;
  const email = String(filter.email || '').trim().toLowerCase();
  if (employeeId && Number.isFinite(employeeId) && employeeId > 0) {
    return handler.employeeId === employeeId;
  }
  if (email) {
    return handler.email.toLowerCase() === email;
  }
  return true;
}

async function loadActiveHandlers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, full_name, employee_id, is_active, is_staff')
    .not('employee_id', 'is', null)
    .eq('is_active', true)
    .eq('is_staff', true);
  if (error) throw error;

  const employeeIds = [...new Set((users || []).map((u) => Number(u.employee_id)).filter((id) => id > 0))];
  if (employeeIds.length === 0) return [];

  const employees = [];
  for (const part of chunk(employeeIds, ID_CHUNK)) {
    let { data, error: empError } = await supabase
      .from('tenants_employee')
      .select('id, display_name, fired')
      .in('id', part);
    if (empError && /fired/i.test(empError.message || '')) {
      const retry = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .in('id', part);
      data = retry.data;
      empError = retry.error;
    }
    if (empError) throw empError;
    employees.push(...(data || []));
  }

  const employeesById = new Map();
  employees.forEach((emp) => {
    if (emp?.fired === true) return;
    employeesById.set(String(emp.id), (emp.display_name || '').trim() || `Employee ${emp.id}`);
  });

  const handlers = [];
  const seen = new Set();
  (users || []).forEach((user) => {
    const employeeId = Number(user.employee_id);
    if (!employeeId || seen.has(employeeId)) return;
    const displayName = employeesById.get(String(employeeId));
    if (!displayName) return;
    const email = String(user.email || '').trim();
    if (!email || !email.includes('@')) return;
    seen.add(employeeId);
    handlers.push({
      employeeId,
      userId: user.id,
      email,
      displayName,
      fullName: (user.full_name || displayName).trim(),
    });
  });
  return handlers;
}

async function loadStageNameMap() {
  const map = new Map(Object.entries(STAGE_FALLBACK).map(([id, name]) => [String(id), name]));
  const { data, error } = await supabase.from('lead_stages').select('id, name');
  if (error) {
    console.warn('[HandlerNewCasesDigest] lead_stages lookup failed, using fallback names:', error.message);
    return map;
  }
  (data || []).forEach((row) => {
    if (row?.id != null && row.name) map.set(String(row.id), row.name);
  });
  return map;
}

function categorySelect() {
  return `
    misc_category!category_id (
      id, name, parent_id,
      misc_maincategory!parent_id ( id, name )
    )
  `;
}

async function loadHandlerLeads(handlers) {
  const ids = handlers.map((h) => h.employeeId);
  const names = handlers.map((h) => h.displayName).filter(Boolean);
  const idStrings = ids.map(String);
  const newLeads = [];
  const legacyLeads = [];

  const newSelectWithTopic = `id, lead_number, name, stage, category_id, category, topic, created_at,
           handler, case_handler_id, active_handler_type, unactivated_at,
           ${categorySelect()}`;
  const newSelectNoTopic = `id, lead_number, name, stage, category_id, category, created_at,
           handler, case_handler_id, active_handler_type, unactivated_at,
           ${categorySelect()}`;
  const legacySelectWithTopic = `id, name, stage, category_id, topic, cdate, case_handler_id,
           active_handler_type, status, ${categorySelect()}`;
  const legacySelectNoTopic = `id, name, stage, category_id, cdate, case_handler_id,
           active_handler_type, status, ${categorySelect()}`;

  let newSelect = newSelectWithTopic;
  let legacySelect = legacySelectWithTopic;

  for (const part of chunk(ids, ID_CHUNK)) {
    try {
      const byId = await fetchAllPages(() =>
        supabase.from('leads').select(newSelect).in('case_handler_id', part).order('created_at', { ascending: false }),
      );
      newLeads.push(...byId);
    } catch (error) {
      if (newSelect === newSelectWithTopic && /topic/i.test(error.message || '')) {
        newSelect = newSelectNoTopic;
        const byId = await fetchAllPages(() =>
          supabase.from('leads').select(newSelect).in('case_handler_id', part).order('created_at', { ascending: false }),
        );
        newLeads.push(...byId);
      } else {
        throw error;
      }
    }

    try {
      const byLegacy = await fetchAllPages(() =>
        supabase.from('leads_lead').select(legacySelect).in('case_handler_id', part).order('cdate', { ascending: false }),
      );
      legacyLeads.push(...byLegacy);
    } catch (error) {
      if (legacySelect === legacySelectWithTopic && /topic/i.test(error.message || '')) {
        legacySelect = legacySelectNoTopic;
        const byLegacy = await fetchAllPages(() =>
          supabase.from('leads_lead').select(legacySelect).in('case_handler_id', part).order('cdate', { ascending: false }),
        );
        legacyLeads.push(...byLegacy);
      } else {
        throw error;
      }
    }
  }

  const nameParts = chunk([...names, ...idStrings], 80);
  for (const part of nameParts) {
    if (part.length === 0) continue;
    try {
      const byName = await fetchAllPages(() =>
        supabase.from('leads').select(newSelect).in('handler', part).order('created_at', { ascending: false }),
      );
      newLeads.push(...byName);
    } catch (error) {
      if (newSelect === newSelectWithTopic && /topic/i.test(error.message || '')) {
        newSelect = newSelectNoTopic;
        const byName = await fetchAllPages(() =>
          supabase.from('leads').select(newSelect).in('handler', part).order('created_at', { ascending: false }),
        );
        newLeads.push(...byName);
      } else {
        throw error;
      }
    }
  }

  const seenNew = new Set();
  const uniqueNew = [];
  newLeads.forEach((lead) => {
    const key = String(lead.id);
    if (seenNew.has(key)) return;
    seenNew.add(key);
    uniqueNew.push(lead);
  });
  const seenLegacy = new Set();
  const uniqueLegacy = [];
  legacyLeads.forEach((lead) => {
    const key = String(lead.id);
    if (seenLegacy.has(key)) return;
    seenLegacy.add(key);
    uniqueLegacy.push(lead);
  });

  return { newLeads: uniqueNew, legacyLeads: uniqueLegacy };
}

function matchHandler(lead, handlers, isLegacy) {
  if (isLegacy) {
    const id = lead.case_handler_id != null ? Number(lead.case_handler_id) : null;
    return handlers.find((h) => id != null && h.employeeId === id) || null;
  }
  const caseId = lead.case_handler_id != null ? Number(lead.case_handler_id) : null;
  if (caseId) {
    const byId = handlers.find((h) => h.employeeId === caseId);
    if (byId) return byId;
  }
  const handlerVal = String(lead.handler || '').trim().toLowerCase();
  if (!handlerVal) return null;
  return (
    handlers.find((h) => String(h.employeeId) === handlerVal) ||
    handlers.find((h) => h.displayName.trim().toLowerCase() === handlerVal) ||
    handlers.find((h) => h.fullName.trim().toLowerCase() === handlerVal) ||
    null
  );
}

async function loadAssignmentHistory(newLeadIds, legacyLeadIds, handlers) {
  const employeesById = new Map(handlers.map((h) => [String(h.employeeId), h.displayName]));
  const newHist = [];
  const legacyHist = [];

  for (const part of chunk(newLeadIds, HISTORY_CHUNK)) {
    if (part.length === 0) continue;
    const { data, error } = await supabase
      .from('history_leads')
      .select('original_id, changed_at, handler, case_handler_id')
      .in('original_id', part)
      .order('changed_at', { ascending: true });
    if (error) throw error;
    newHist.push(...(data || []));
  }

  const legacyNumeric = legacyLeadIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  for (const part of chunk(legacyNumeric, HISTORY_CHUNK)) {
    if (part.length === 0) continue;
    const { data, error } = await supabase
      .from('history_leads_lead')
      .select('original_id, changed_at, case_handler_id')
      .in('original_id', part)
      .order('changed_at', { ascending: true });
    if (error) throw error;
    legacyHist.push(...(data || []));
  }

  const histByNew = new Map();
  newHist.forEach((row) => {
    const oid = String(row.original_id);
    const list = histByNew.get(oid) || [];
    list.push(row);
    histByNew.set(oid, list);
  });
  const histByLegacy = new Map();
  legacyHist.forEach((row) => {
    const oid = String(row.original_id);
    const list = histByLegacy.get(oid) || [];
    list.push(row);
    histByLegacy.set(oid, list);
  });

  return { histByNew, histByLegacy, employeesById };
}

async function alreadySentKeys(employeeId) {
  const keys = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('handler_new_cases_digest_sent')
      .select('lead_type, lead_id, assignment_kind, assignment_date')
      .eq('employee_id', employeeId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      if (error.code === '42P01' || /does not exist/i.test(error.message || '')) {
        throw new Error(
          'handler_new_cases_digest_sent table is missing. Run sql/2026-09-06_handler_new_cases_digest.sql',
        );
      }
      throw error;
    }
    (data || []).forEach((row) => {
      keys.add(`${row.lead_type}:${row.lead_id}:${row.assignment_kind}:${row.assignment_date}`);
    });
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return keys;
}

async function recordSent(employeeId, digestDate, cases) {
  if (cases.length === 0) return;
  const rows = cases.map((c) => ({
    employee_id: employeeId,
    lead_type: c.leadType,
    lead_id: String(c.leadId),
    assignment_kind: c.kind,
    assignment_date: c.assignmentDate,
    digest_date: digestDate,
  }));
  const { error } = await supabase.from('handler_new_cases_digest_sent').upsert(rows, {
    onConflict: 'employee_id,lead_type,lead_id,assignment_kind,assignment_date',
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

function assignmentDateForCase(flags, assignment, assignedDate) {
  if (flags.isReassigned) return assignment.handlerAssignedDate || toYmd(new Date());
  return (
    assignment.handlerAssignedDate ||
    assignment.stage105Date ||
    assignment.stage110Date ||
    (safeParseDate(assignedDate) ? toYmd(safeParseDate(assignedDate)) : getJerusalemDateKey())
  );
}

function buildCasesTableHtml(cases) {
  const newCases = cases.filter((c) => c.kind === 'new');
  const reassigned = cases.filter((c) => c.kind === 'reassigned');

  const renderSection = (title, rows, badgeBg, badgeColor) => {
    if (rows.length === 0) return '';
    const body = rows
      .map((row) => {
        const dateLabel =
          row.kind === 'reassigned' && row.previousHandlerName
            ? `${escapeHtml(formatDateDisplay(row.assignmentDate))} <span style="color:#6b7280;font-size:12px;">(from ${escapeHtml(row.previousHandlerName)})</span>`
            : escapeHtml(formatDateDisplay(row.assignmentDate));
        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
              <a href="${escapeHtml(row.url)}" style="color:#3b28c7;text-decoration:none;font-weight:700;">
                ${escapeHtml(row.leadNumber)}
              </a>
              <div style="color:#111827;font-size:13px;margin-top:2px;">${escapeHtml(row.clientName)}</div>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;vertical-align:top;">${escapeHtml(row.stage)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;vertical-align:top;">${escapeHtml(row.category)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;vertical-align:top;">${escapeHtml(row.topic)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;white-space:nowrap;vertical-align:top;">${dateLabel}</td>
          </tr>`;
      })
      .join('');

    return `
      <p style="margin:20px 0 8px;font-size:13px;font-weight:700;color:${badgeColor};">
        <span style="display:inline-block;background:${badgeBg};border-radius:999px;padding:3px 10px;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(title)}</span>
        <span style="margin-left:8px;color:#6b7280;font-weight:600;text-transform:none;letter-spacing:0;">${rows.length}</span>
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Lead</th>
            <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Stage</th>
            <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Category</th>
            <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Topic</th>
            <th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Date assigned</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
  };

  return `
    <div dir="ltr" style="text-align:left;">
      ${renderSection('New', newCases, '#ecfdf5', '#047857')}
      ${renderSection('Re-assigned', reassigned, '#fff7ed', '#c2410c')}
    </div>
  `.trim();
}

function applyTemplate(content, listHtml, handlerName) {
  const safeName = escapeHtml(handlerName);
  let body = String(content || '');
  const listRe = /\{\{\s*list_cases\s*\}\}|\{\s*list_cases\s*\}/gi;
  if (listRe.test(body)) {
    body = body.replace(listRe, listHtml);
  } else {
    body = `${body}\n\n${listHtml}`;
  }
  body = body
    .replace(/\{\{\s*handler_name\s*\}\}|\{\s*handler_name\s*\}/gi, safeName)
    .replace(/\{\{\s*name\s*\}\}|\{\s*name\s*\}/gi, safeName);

  const parts = body.split(listHtml);
  if (parts.length === 1) {
    return formatPlainEmailHtml(body);
  }
  return parts
    .map((part, index) => `${formatPlainEmailHtml(part)}${index < parts.length - 1 ? listHtml : ''}`)
    .join('');
}

async function fetchTemplate() {
  const templateId = getTemplateId();
  const { data, error } = await supabase
    .from('misc_emailtemplate')
    .select('id, name, content, active')
    .eq('id', templateId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to load misc_emailtemplate id ${templateId}: ${error.message || error.code || 'unknown error'}`,
    );
  }
  if (!data) {
    throw new Error(
      `misc_emailtemplate id ${templateId} was not found. Check SUPABASE_URL points at the project that has this row.`,
    );
  }
  return {
    id: Number(data.id) || templateId,
    name: (data.name || 'New Cases Assigned!').trim(),
    content: parseEmailTemplateContent(data.content),
  };
}

function sortCases(cases) {
  return [...cases].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'reassigned' ? -1 : 1;
    return String(b.assignmentDate).localeCompare(String(a.assignmentDate));
  });
}

async function collectEligibleCases({ handlers, dryRun }) {
  const stageNames = await loadStageNameMap();
  const { newLeads, legacyLeads } = await loadHandlerLeads(handlers);
  const newLeadIds = newLeads.map((l) => String(l.id));
  const legacyLeadIds = legacyLeads.map((l) => String(l.id));
  const { histByNew, histByLegacy, employeesById } = await loadAssignmentHistory(
    newLeadIds,
    legacyLeadIds,
    handlers,
  );

  const [stage105New, stage110New, stage105Legacy, stage110Legacy] = await Promise.all([
    loadStageDates(newLeadIds, 'newlead_id', 105, true),
    loadStageDates(newLeadIds, 'newlead_id', 110, false),
    loadStageDates(legacyLeadIds.map(Number).filter(Number.isFinite), 'lead_id', 105, true),
    loadStageDates(legacyLeadIds.map(Number).filter(Number.isFinite), 'lead_id', 110, false),
  ]);

  const byEmployee = new Map();
  handlers.forEach((h) => byEmployee.set(h.employeeId, []));

  const pushIfEligible = (lead, isLegacy) => {
    const handler = matchHandler(lead, handlers, isLegacy);
    if (!handler) return;
    const stageId = lead.stage != null ? Number(lead.stage) : null;
    const activeHandlerType = Number(lead.active_handler_type) === 1 ? 1 : 2;
    const isInactive = isLegacy ? Number(lead.status) === 10 : lead.unactivated_at != null;
    const bucket = classifyBucket(stageId, activeHandlerType, isInactive);
    if (!bucket || bucket === 'closed') return;

    const oid = String(lead.id);
    const histRows = (isLegacy ? histByLegacy.get(oid) : histByNew.get(oid)) || [];
    const meta = buildAssignmentMeta(histRows, handler.employeeId, handler.displayName, employeesById);
    const stage105 = (isLegacy ? stage105Legacy : stage105New).get(oid) || null;
    const stage110 = (isLegacy ? stage110Legacy : stage110New).get(oid) || null;
    const handlerAssignedDate = meta.assigned.get(oid) || stage105 || null;
    const previousHandlerName = meta.prevName.get(oid) || null;
    const assignedDate = isLegacy ? lead.cdate || null : lead.created_at || null;
    const flags = getHandlerAssignmentFlags({
      bucket,
      assignedDate,
      handlerAssignedDate,
      stage105Date: stage105,
      stage110Date: stage110,
      previousHandlerName,
    });
    if (!flags.isNew && !flags.isReassigned) return;

    const kind = flags.isReassigned ? 'reassigned' : 'new';
    const assignmentDate = assignmentDateForCase(flags, { handlerAssignedDate, stage105Date: stage105, stage110Date: stage110 }, assignedDate);
    const navId = isLegacy ? String(lead.id) : String(lead.lead_number || lead.id);
    byEmployee.get(handler.employeeId).push({
      employeeId: handler.employeeId,
      leadType: isLegacy ? 'legacy' : 'new',
      leadId: oid,
      kind,
      assignmentDate,
      leadNumber: navId,
      clientName: lead.name || 'Unknown',
      stage: stageNames.get(String(stageId)) || `Stage ${stageId ?? '—'}`,
      category: formatCategory(lead.misc_category, lead.category),
      topic: String(lead.topic || '').trim() || '—',
      previousHandlerName,
      url: leadPageUrl(navId),
    });
  };

  newLeads.forEach((lead) => pushIfEligible(lead, false));
  legacyLeads.forEach((lead) => pushIfEligible(lead, true));

  const result = [];
  for (const handler of handlers) {
    let cases = sortCases(byEmployee.get(handler.employeeId) || []);
    if (!dryRun) {
      const sent = await alreadySentKeys(handler.employeeId);
      cases = cases.filter(
        (c) => !sent.has(`${c.leadType}:${c.leadId}:${c.kind}:${c.assignmentDate}`),
      );
    }
    if (cases.length === 0) continue;
    result.push({ handler, cases });
  }
  return result;
}

async function sendHandlerEmail(handler, cases, template, sender) {
  if (!sender?.mailboxUserId && !sender?.fromEmail) {
    throw new Error(
      'PAYMENT_CONFIRMATION_MAILBOX_USER_ID is not set. Handler digest emails send from the same address as payment receipts.',
    );
  }

  const newCount = cases.filter((c) => c.kind === 'new').length;
  const reassignedCount = cases.filter((c) => c.kind === 'reassigned').length;
  const countBits = [];
  if (newCount) countBits.push(`${newCount} new`);
  if (reassignedCount) countBits.push(`${reassignedCount} re-assigned`);
  const subjectBase = template.name || 'New Cases Assigned!';
  const subject = countBits.length ? `${subjectBase} — ${countBits.join(', ')}` : subjectBase;

  const listHtml = buildCasesTableHtml(cases);
  const bodyHtml = applyTemplate(template.content, listHtml, handler.displayName);

  if (sender.mode === 'delegated' && sender.mailboxUserId) {
    await graphMailboxSyncService.sendEmail(sender.mailboxUserId, {
      subject,
      bodyHtml,
      bodyContentType: 'HTML',
      to: [handler.email],
      importance: 'high',
      context: {
        userInternalId: sender.mailboxUserId,
        contactEmail: handler.email,
        contactName: handler.displayName,
      },
    });
    return;
  }

  await sendMailAsPaymentReceiptMailbox({
    fromEmail: sender.fromEmail,
    to: handler.email,
    subject,
    html: bodyHtml,
  });
}

/**
 * Daily digest of New / Re-assigned handler cases (same 7-day rules as the Handler pipeline).
 * Each case is emailed once per assignment event.
 */
async function processHandlerNewCasesDigest({
  dryRun = false,
  employeeId = null,
  email = null,
  force = false,
  sendTo = null,
} = {}) {
  const digestDate = getJerusalemDateKey();
  const template = await fetchTemplate();
  const allHandlers = await loadActiveHandlers();
  const handlers = allHandlers.filter((handler) => matchesHandlerFilter(handler, { employeeId, email }));
  if ((employeeId || email) && handlers.length === 0) {
    throw new Error(
      `No active handler matched employeeId=${employeeId || '—'} email=${email || '—'}`,
    );
  }
  const skipSentLog = dryRun || force;
  const eligible = await collectEligibleCases({ handlers, dryRun: skipSentLog });
  const sender = dryRun
    ? { mode: 'preview', mailboxUserId: getPaymentReceiptMailboxUserId(), fromEmail: null }
    : await resolvePaymentReceiptSender();

  const summary = {
    digestDate,
    templateId: template.id,
    handlersChecked: handlers.length,
    handlersWithCases: eligible.length,
    casesFound: eligible.reduce((sum, row) => sum + row.cases.length, 0),
    sent: 0,
    skipped: 0,
    dryRun,
    force,
    filteredTo: employeeId || email || null,
    mailboxUserId: sender.mailboxUserId,
    mailboxFrom: sender.fromEmail || null,
    mailboxMode: sender.mode,
    errors: [],
    recipients: [],
  };

  for (const { handler, cases } of eligible) {
    const preview = {
      employeeId: handler.employeeId,
      email: handler.email,
      name: handler.displayName,
      newCount: cases.filter((c) => c.kind === 'new').length,
      reassignedCount: cases.filter((c) => c.kind === 'reassigned').length,
      cases: cases.map((c) => ({
        leadNumber: c.leadNumber,
        name: c.clientName,
        kind: c.kind,
        assignmentDate: c.assignmentDate,
      })),
    };
    summary.recipients.push(preview);

    if (dryRun) {
      summary.skipped += 1;
      continue;
    }

    try {
      const target = {
        ...handler,
        email: String(sendTo || handler.email).trim() || handler.email,
      };
      await sendHandlerEmail(target, cases, template, sender);
      if (!force) {
        await recordSent(handler.employeeId, digestDate, cases);
      }
      summary.sent += 1;
    } catch (error) {
      const message = error?.message || String(error);
      console.error('[HandlerNewCasesDigest] Failed for', handler.email, message);
      summary.errors.push({ employeeId: handler.employeeId, email: handler.email, error: message });
    }
  }

  console.info('[HandlerNewCasesDigest] Run complete', {
    digestDate,
    handlersChecked: summary.handlersChecked,
    handlersWithCases: summary.handlersWithCases,
    sent: summary.sent,
    errors: summary.errors.length,
    dryRun,
  });

  return summary;
}

async function getDigestRuntimeStatus() {
  const templateId = getTemplateId();
  const [{ error: tableError }, template] = await Promise.all([
    supabase.from('handler_new_cases_digest_sent').select('id').limit(1),
    supabase
      .from('misc_emailtemplate')
      .select('id, name, active')
      .eq('id', templateId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
  ]);

  return {
    sentLogTableReady: !tableError,
    sentLogTableError: tableError?.message || null,
    templateReady: Boolean(template?.id),
    templateName: template?.name || null,
    publicAppUrl: getPublicAppUrl(),
    paymentMailboxUserId: getPaymentReceiptMailboxUserId() || null,
    bookingMailboxUserId: (process.env.BOOKING_MAILBOX_USER_ID || '').trim() || null,
  };
}

module.exports = {
  processHandlerNewCasesDigest,
  getJerusalemDateKey,
  getHandlerAssignmentFlags,
  classifyBucket,
  getDigestRuntimeStatus,
};
