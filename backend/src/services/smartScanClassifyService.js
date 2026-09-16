const supabase = require('../config/supabase');
const {
  classifySmartScanDocument,
  splitPdf,
  normalizeRanges,
  buildFilename,
  normalizeType,
} = require('./smartScanAiRunner');

const TABLE = 'smart_scan_documents';
const REMOVED_TABLE = 'smart_scan_removed';

// Narrow on purpose: matching bare "relation" / "does not exist" also hides not-null and
// missing-column errors, which then look like an empty queue instead of a failure.
function tableMissing(error) {
  const code = String(error?.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /Could not find the table|relation "[^"]+" does not exist/i.test(
    String(error?.message || error || '')
  );
}

function nowIso() {
  return new Date().toISOString();
}

function parseItemRef(id) {
  const value = String(id || '').trim();
  const scan = value.match(/^scan:([0-9a-f-]{36})$/i);
  if (scan) return { documentId: scan[1] };
  const emailAtt = value.match(/^email-att:(\d+):(.+)$/);
  if (emailAtt) {
    return { emailId: Number(emailAtt[1]), attachmentId: emailAtt[2] };
  }
  if (/^[0-9a-f-]{36}$/i.test(value)) return { documentId: value };
  return null;
}

function sourceItemId(row) {
  return `email-att:${row.source_email_id}:${row.source_graph_attachment_id}`;
}

function itemIdFor(row) {
  return row.parent_id ? `scan:${row.id}` : sourceItemId(row);
}

function asActivity(value) {
  return Array.isArray(value) ? value : [];
}

async function loadRemovedRefs() {
  const { data, error } = await supabase
    .from(REMOVED_TABLE)
    .select('source_graph_attachment_id, graph_message_id');
  if (error) {
    if (!tableMissing(error)) {
      console.warn('⚠️  Smart Scan removed lookup failed:', error.message || error);
    }
    return { attachmentIds: new Set(), messageIds: new Set() };
  }
  const attachmentIds = new Set();
  const messageIds = new Set();
  for (const row of data || []) {
    if (row.source_graph_attachment_id) attachmentIds.add(String(row.source_graph_attachment_id));
    if (row.graph_message_id) messageIds.add(String(row.graph_message_id));
  }
  return { attachmentIds, messageIds };
}

async function isAttachmentRemoved(attachmentId) {
  const graphId = String(attachmentId || '').trim();
  if (!graphId) return false;
  const { data, error } = await supabase
    .from(REMOVED_TABLE)
    .select('source_graph_attachment_id')
    .eq('source_graph_attachment_id', graphId)
    .maybeSingle();
  if (error) return tableMissing(error) ? false : false;
  return Boolean(data?.source_graph_attachment_id);
}

async function loadRecentEmailIds(limit = 100) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('source_email_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (!tableMissing(error)) {
      console.warn('⚠️  Smart Scan recent lookup failed:', error.message || error);
    }
    return [];
  }
  return [...new Set((data || []).map((row) => Number(row.source_email_id)).filter((id) => Number.isFinite(id)))];
}

async function loadDocumentsForAttachments(attachmentIds = []) {
  const ids = [...new Set(attachmentIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from(TABLE).select('*').in('source_graph_attachment_id', ids);
  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(error.message || 'Failed to load Smart Scan AI rows');
  }
  return data || [];
}

async function loadDocumentsForEmails(emailIds = []) {
  const ids = [...new Set(emailIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from(TABLE).select('*').in('source_email_id', ids);
  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(error.message || 'Failed to load Smart Scan AI rows');
  }
  return data || [];
}

async function findSourceByAttachmentId(attachmentId) {
  const graphId = String(attachmentId || '').trim();
  if (!graphId) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('source_graph_attachment_id', graphId)
    .is('parent_id', null)
    .order('processed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    if (tableMissing(error)) return null;
    throw new Error(error.message || 'Failed to load Smart Scan document');
  }
  return data?.[0] || null;
}

async function findDocument(ref) {
  if (!ref) return null;
  if (ref.documentId) {
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', ref.documentId).maybeSingle();
    if (error) {
      if (tableMissing(error)) return null;
      throw new Error(error.message || 'Failed to load Smart Scan document');
    }
    return data || null;
  }
  if (ref.emailId && ref.attachmentId) {
    const byAttachment = await findSourceByAttachmentId(ref.attachmentId);
    if (byAttachment) return byAttachment;
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('source_email_id', ref.emailId)
      .eq('source_graph_attachment_id', ref.attachmentId)
      .is('parent_id', null)
      .maybeSingle();
    if (error) {
      if (tableMissing(error)) return null;
      throw new Error(error.message || 'Failed to load Smart Scan document');
    }
    return data || null;
  }
  return null;
}

function sourcePayloadFromItem(item) {
  return {
    source_email_id: Number(item.emailId),
    source_graph_attachment_id: String(item.attachmentId),
    storage_path: item.storagePath || null,
    content_type: item.contentType || null,
    original_filename: item.originalFilename || 'scan.pdf',
    status: 'processing',
    classification_status: 'processing',
    lead_match_status: item.leadMatchStatus || 'unmatched',
    issue: item.issue || 'lead_not_found',
    ignored: false,
    page_count: item.pageCount || 1,
    activity: asActivity(item.activity),
    updated_at: nowIso(),
  };
}

async function ensureSourceRow(item) {
  if (!item?.attachmentId) return null;
  if (await isAttachmentRemoved(item.attachmentId)) return null;
  const existing = await findSourceByAttachmentId(item.attachmentId);
  if (existing) {
    const patch = {};
    if (!existing.storage_path && item.storagePath) patch.storage_path = item.storagePath;
    if (!existing.content_type && item.contentType) patch.content_type = item.contentType;
    if (Object.keys(patch).length) {
      patch.updated_at = nowIso();
      await supabase.from(TABLE).update(patch).eq('id', existing.id);
      return { ...existing, ...patch };
    }
    return existing;
  }
  if (!item?.emailId) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .insert(sourcePayloadFromItem(item))
    .select('*')
    .maybeSingle();
  if (error) {
    if (tableMissing(error)) return null;
    const race = await findSourceByAttachmentId(item.attachmentId);
    if (race) return race;
    console.warn('⚠️  Smart Scan source insert failed:', error.message || error);
    return null;
  }
  return data;
}

const inFlight = new Set();

function shouldClassify(row, { force = false } = {}) {
  if (!row || row.parent_id) return false;
  if (force) return true;
  if (row.processed_at) return false;
  if (row.ignored) return false;
  if (row.status === 'failed' || row.status === 'removed') return false;
  if (inFlight.has(row.id)) return false;
  return true;
}

function resolveClassifyUrl() {
  const override = String(process.env.SMART_SCAN_CLASSIFY_URL || '').trim();
  if (override) return override.replace(/\/$/, '');
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!supabaseUrl) return '';
  return `${supabaseUrl}/functions/v1/smart-scan-classify`;
}

async function markFailed(row, message) {
  if (!row?.id) return;
  await supabase
    .from(TABLE)
    .update({
      status: 'failed',
      classification_status: 'failed',
      issue: 'ai_processing_failed',
      error: String(message || 'AI processing failed').slice(0, 2000),
      processed_at: nowIso(),
      updated_at: nowIso(),
      activity: [
        ...asActivity(row.activity),
        { at: nowIso(), label: `AI classification failed: ${String(message || '').slice(0, 180)}` },
      ],
    })
    .eq('id', row.id);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyErrorMessage(status, payload, text) {
  const detail = payload?.error || payload?.message || payload?.msg || payload?.raw || String(text || '').trim();
  if (status === 546 || status === 547) {
    return `Classify HTTP ${status}: AI worker crashed or hit its CPU/memory limit${detail ? ` (${String(detail).slice(0, 240)})` : ''}`;
  }
  if (detail) return String(detail).slice(0, 500);
  return `Classify HTTP ${status}`;
}

async function invokeClassifyOnce(documentId, { force = false } = {}) {
  const url = resolveClassifyUrl();
  const invokeKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || '';
  if (!url || !invokeKey) {
    throw new Error('Smart Scan classify is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }

  const secret = process.env.SMART_SCAN_CLASSIFY_SECRET?.trim() || '';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${invokeKey}`,
    apikey: invokeKey,
  };
  if (secret) headers['x-smart-scan-secret'] = secret;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ documentId, force: Boolean(force) }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text.slice(0, 400) };
  }
  if (!res.ok || payload?.success === false) {
    const err = new Error(classifyErrorMessage(res.status, payload, text));
    err.status = res.status;
    throw err;
  }
  return payload;
}

async function invokeClassifyEdge(documentId, { force = false } = {}) {
  const transient = new Set([546, 547, 502, 503, 504]);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await invokeClassifyOnce(documentId, { force });
    } catch (error) {
      lastError = error;
      const status = Number(error?.status) || 0;
      if (attempt < 3 && transient.has(status)) {
        console.warn(`⚠️  Smart Scan classify HTTP ${status} for ${documentId}, retry ${attempt}/3`);
        await sleep(1500 * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function invokeClassify(documentId, { force = false } = {}) {
  try {
    return await classifySmartScanDocument(documentId);
  } catch (error) {
    if (error?.code !== 'NO_OPENAI_KEY') throw error;
    console.warn('⚠️  Smart Scan using Edge classify (no OPENAI_API_KEY on backend)');
    return invokeClassifyEdge(documentId, { force });
  }
}

function enqueueClassify(row, { force = false } = {}) {
  if (!row?.id) return;
  if (inFlight.has(row.id)) return;
  inFlight.add(row.id);
  Promise.resolve()
    .then(() => invokeClassify(row.id, { force }))
    .then(async (payload) => {
      console.log(
        `🧠 Smart Scan classified ${row.id} split=${Boolean(payload?.split)} type=${payload?.documentType || 'n/a'}`,
      );
      await applyAiLeadSuggestionsForDocument(row.id);
    })
    .catch(async (error) => {
      console.error(`❌ Smart Scan classify failed for ${row.id}:`, error.message || error);
      await markFailed(row, error.message || error);
    })
    .finally(() => inFlight.delete(row.id));
}

function rowTime(row) {
  return new Date(row?.processed_at || row?.updated_at || row?.created_at || 0).getTime();
}

function visibleQueue(documents) {
  const sources = (documents || []).filter((row) => !row.parent_id);
  const childrenByParent = new Map();
  for (const row of documents || []) {
    if (!row.parent_id || row.ignored) continue;
    const list = childrenByParent.get(row.parent_id) || [];
    list.push(row);
    childrenByParent.set(row.parent_id, list);
  }

  const canonicalByAttachment = new Map();
  for (const row of sources) {
    const key = String(row.source_graph_attachment_id || row.id);
    const prev = canonicalByAttachment.get(key);
    if (!prev || rowTime(row) >= rowTime(prev)) canonicalByAttachment.set(key, row);
  }

  const visible = [];
  for (const source of canonicalByAttachment.values()) {
    if (source.ignored && !(childrenByParent.get(source.id) || []).length) continue;
    const kids = (childrenByParent.get(source.id) || []).sort(
      (a, b) => Number(a.split_index || 0) - Number(b.split_index || 0),
    );
    if (kids.length) visible.push(...kids);
    else if (!source.ignored) visible.push(source);
  }
  return visible;
}

function leadNameFromRow(row) {
  return String(row?.name || '').trim() || 'Unknown';
}

function asAiRaw(row) {
  return row?.ai_raw && typeof row.ai_raw === 'object' && !Array.isArray(row.ai_raw) ? { ...row.ai_raw } : {};
}

function leadRefFromRow(row) {
  if (!row) return null;
  const id = String(row.id || '').trim();
  const leadNumber = String(row.lead_number || row.leadNumber || '').trim();
  const name = leadNameFromRow(row);
  if (!id && !leadNumber) return null;
  return { id: id || undefined, leadNumber, name };
}

function sanitizeLeadRef(lead) {
  if (!lead) return null;
  const id = String(lead.id || '').trim();
  const leadNumber = String(lead.leadNumber || lead.lead_number || '').trim();
  const name = String(lead.name || '').trim() || 'Unknown';
  if (!id && !leadNumber) return null;
  return { id: id || undefined, leadNumber, name };
}

function ilikeSafe(value) {
  return String(value || '')
    .replace(/[%_,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0590-\u05ff\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreLead(personName, leadName) {
  const person = normalizeName(personName);
  const lead = normalizeName(leadName);
  if (!person || !lead) return 0;
  if (person === lead) return 100;
  if (lead.includes(person) || person.includes(lead)) return 82;
  const tokens = person.split(' ').filter((part) => part.length >= 2);
  if (!tokens.length) return 0;
  const hits = tokens.filter((part) => lead.includes(part)).length;
  if (hits === tokens.length && tokens.length >= 2) return 74;
  if (hits >= 2) return 58;
  if (hits === 1 && tokens.length === 1) return 42;
  return 0;
}

function decideLeadMatch(personName, leads) {
  const scored = (leads || [])
    .map((lead) => ({ lead, score: scoreLead(personName, lead.name) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  const possibleLeads = scored.slice(0, 8).map((row) => row.lead);
  const top = scored[0];
  const second = scored[1];
  const uniqueTop = Boolean(top && (!second || top.score - second.score >= 12));
  if (top && uniqueTop && top.score >= 50) {
    return { suggestedLead: top.lead, possibleLeads, leadMatchStatus: 'matched', issue: null };
  }
  if (scored.length > 1 && top.score >= 40) {
    return { suggestedLead: null, possibleLeads, leadMatchStatus: 'ambiguous', issue: 'multiple_leads' };
  }
  return {
    suggestedLead: null,
    possibleLeads,
    leadMatchStatus: 'unmatched',
    issue: possibleLeads.length ? 'multiple_leads' : 'lead_not_found',
  };
}

async function searchLeadsByPersonName(personName) {
  const raw = ilikeSafe(personName);
  if (raw.length < 2) return [];
  const parts = raw.split(/\s+/).filter((part) => part.length >= 2);
  const clauses = [`name.ilike.%${raw}%`];
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (first && first !== raw) clauses.push(`name.ilike.%${first}%`);
    if (last && last !== first) clauses.push(`name.ilike.%${last}%`);
  }
  const { data, error } = await supabase
    .from('leads')
    .select('id, lead_number, name')
    .or(clauses.join(','))
    .limit(20);
  if (error) {
    console.warn('⚠️  Smart Scan lead suggest failed:', error.message || error);
    return [];
  }
  return (data || []).map(leadRefFromRow).filter(Boolean);
}

function mergeLeadDecision(row, decision) {
  const raw = asAiRaw(row);
  raw.suggestedLead = decision.suggestedLead;
  raw.possibleLeads = decision.possibleLeads;
  raw.leadAssignedBy = decision.suggestedLead ? 'ai' : null;
  raw.leadMatchApplied = true;
  const keepIssue =
    row.issue && row.issue !== 'lead_not_found' && row.issue !== 'multiple_leads' ? row.issue : decision.issue;
  const status =
    row.status === 'failed' || row.status === 'processing'
      ? row.status
      : decision.leadMatchStatus === 'matched'
        ? 'needs_review'
        : 'unmatched';
  return {
    ...row,
    lead_match_status: decision.leadMatchStatus,
    issue: keepIssue,
    status,
    ai_raw: raw,
  };
}

async function enrichDocumentsWithLeadMatches(documents, { persist = true, force = false } = {}) {
  const list = documents || [];
  const targets = list.filter((row) => {
    if (!row || row.status === 'processing' || row.status === 'completed' || row.status === 'failed') return false;
    const raw = asAiRaw(row);
    if (raw.leadAssignedBy === 'user') return false;
    if (!force && raw.leadMatchApplied) return false;
    return Boolean(String(row.detected_person_name || '').trim());
  });
  if (!targets.length) return list;

  const byName = new Map();
  for (const row of targets) {
    const key = normalizeName(row.detected_person_name);
    if (!key) continue;
    const group = byName.get(key) || [];
    group.push(row);
    byName.set(key, group);
  }

  const updatedById = new Map();
  for (const rows of byName.values()) {
    const person = rows[0].detected_person_name;
    const matches = await searchLeadsByPersonName(person);
    const decision = decideLeadMatch(person, matches);
    for (const row of rows) {
      const next = mergeLeadDecision(row, decision);
      updatedById.set(row.id, next);
      if (persist) {
        const { error } = await supabase
          .from(TABLE)
          .update({
            lead_match_status: next.lead_match_status,
            issue: next.issue,
            status: next.status,
            ai_raw: next.ai_raw,
            updated_at: nowIso(),
          })
          .eq('id', row.id);
        if (error) {
          console.warn('⚠️  Smart Scan lead suggest persist failed:', error.message || error);
        }
      }
    }
  }

  return list.map((row) => updatedById.get(row.id) || row);
}

async function applyAiLeadSuggestionsForDocument(documentId) {
  const id = String(documentId || '').trim();
  if (!id) return;
  const { data, error } = await supabase.from(TABLE).select('*').or(`id.eq.${id},parent_id.eq.${id}`);
  if (error || !data?.length) return;
  await enrichDocumentsWithLeadMatches(data, { persist: true, force: true });
}

function leadStateFromRow(row) {
  const raw = asAiRaw(row);
  const assignedBy = raw.leadAssignedBy === 'user' || raw.leadAssignedBy === 'ai' ? raw.leadAssignedBy : null;
  const suggested = sanitizeLeadRef(raw.suggestedLead);
  const assigned = sanitizeLeadRef(raw.assignedLead);
  const possible = Array.isArray(raw.possibleLeads)
    ? raw.possibleLeads.map(sanitizeLeadRef).filter(Boolean)
    : [];
  const completed = row.status === 'completed';
  const lead = completed || assignedBy === 'user' ? assigned || suggested : suggested || assigned;
  const leadMatchStatus =
    assignedBy === 'user' || completed
      ? lead
        ? 'matched'
        : 'unmatched'
      : row.lead_match_status || (suggested ? 'matched' : possible.length > 1 ? 'ambiguous' : 'unmatched');
  return {
    lead: lead || undefined,
    possibleLeadMatches: possible.length ? possible : undefined,
    leadAssignedBy: assignedBy || (suggested && !completed ? 'ai' : undefined),
    leadMatchStatus,
  };
}

function pushDocumentActivity(row, label) {
  return [...asActivity(row.activity), { at: nowIso(), label }];
}

async function patchDocument(row, fields, activityLabel) {
  const activity = activityLabel ? pushDocumentActivity(row, activityLabel) : asActivity(row.activity);
  const { data, error } = await supabase
    .from(TABLE)
    .update({ ...fields, activity, updated_at: nowIso() })
    .eq('id', row.id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message || 'Failed to update Smart Scan document');
  return data || { ...row, ...fields, activity };
}

const CASE_DOCUMENTS_BUCKET = process.env.CASE_DOCUMENTS_STORAGE_BUCKET || 'lead-sub-efforts-documents';
const SCAN_FILES_BUCKET = process.env.EMAIL_ATTACHMENTS_BUCKET || 'email-attachments';
const CLIENT_HEADER_FOLDER = 'ClientHeaderDocuments';

function safePathSegment(value, max = 120) {
  return (
    String(value || '_')
      .replace(/[^\w.\-()+]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, max) || '_'
  );
}

function normalizeSubEffortDocs(documentUrl) {
  if (!documentUrl) return [];
  if (Array.isArray(documentUrl)) return documentUrl.filter(Boolean);
  if (typeof documentUrl === 'string') {
    const trimmed = documentUrl.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      /* ignore */
    }
    return [{ url: trimmed }];
  }
  if (typeof documentUrl === 'object') return [documentUrl];
  return [];
}

async function resolveLeadIdentity(lead) {
  const id = String(lead?.id || '').trim();
  let leadNumber = String(lead?.leadNumber || '').trim();

  if (id.startsWith('legacy_')) {
    const legacyLeadId = Number.parseInt(id.replace(/^legacy_/, ''), 10);
    if (!leadNumber && Number.isFinite(legacyLeadId)) leadNumber = String(legacyLeadId);
    return {
      newLeadId: null,
      legacyLeadId: Number.isFinite(legacyLeadId) ? legacyLeadId : null,
      leadNumber,
    };
  }

  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const { data } = await supabase.from('leads').select('id, lead_number').eq('id', id).maybeSingle();
    return {
      newLeadId: data?.id || id,
      legacyLeadId: null,
      leadNumber: String(data?.lead_number || leadNumber || '').trim(),
    };
  }

  if (leadNumber) {
    const { data } = await supabase
      .from('leads')
      .select('id, lead_number')
      .eq('lead_number', leadNumber)
      .maybeSingle();
    if (data?.id) {
      return { newLeadId: data.id, legacyLeadId: null, leadNumber: String(data.lead_number) };
    }
    if (/^\d+$/.test(leadNumber)) {
      return { newLeadId: null, legacyLeadId: Number(leadNumber), leadNumber };
    }
  }

  throw new Error('Could not resolve the assigned lead');
}

async function resolveSequenceOfEventsClassificationId() {
  const { data, error } = await supabase
    .from('case_document_classifications')
    .select('id, slug, label')
    .eq('is_active', true);
  if (error) throw new Error(error.message || 'Failed to load document categories');
  const rows = data || [];
  const match =
    rows.find((row) => String(row.slug || '').toLowerCase() === 'sequence_of_events') ||
    rows.find((row) => String(row.slug || '').toLowerCase() === 'sequence-of-events') ||
    rows.find((row) => String(row.label || '').trim().toLowerCase() === 'sequence of events');
  return match?.id || null;
}

async function resolveLeadCaseDocumentTypeId(documentType) {
  const name = String(documentType || '').trim();
  if (!name || name.toLowerCase() === 'unknown') return null;
  const { data, error } = await supabase.from('lead_case_document_types').select('id, name').eq('active', true);
  if (error) return null;
  const lower = name.toLowerCase();
  const exact = (data || []).find((row) => String(row.name || '').trim().toLowerCase() === lower);
  return exact?.id || null;
}

async function copyScanFileToCaseDocuments(row, leadNumber) {
  const srcPath = String(row.storage_path || '').trim();
  if (!srcPath) throw new Error('Scan file is missing');
  const { data, error } = await supabase.storage.from(SCAN_FILES_BUCKET).download(srcPath);
  if (error || !data) throw new Error(error?.message || 'Failed to download scanned file');
  const buffer = Buffer.from(await data.arrayBuffer());
  const fileName = safePathSegment(row.suggested_filename || row.original_filename || 'scan.pdf', 160);
  const destPath = `case-documents/${safePathSegment(leadNumber)}/${CLIENT_HEADER_FOLDER}/${Date.now()}_${fileName}`;
  const contentType =
    row.content_type ||
    (/\.pdf$/i.test(fileName) ? 'application/pdf' : 'application/octet-stream');
  const { error: upErr } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).upload(destPath, buffer, {
    contentType,
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message || 'Failed to save scan to lead documents');
  return { destPath, fileName, contentType, fileSize: buffer.length };
}

async function attachToSequenceOfEventsSubEffort(identity, classificationId, destPath, fileName, contentType) {
  if (!identity?.newLeadId && !identity?.legacyLeadId) return;
  let query = supabase
    .from('lead_sub_efforts')
    .select('id, document_url, sub_efforts ( id, name, case_document_classification_id )')
    .order('created_at', { ascending: true })
    .limit(80);
  if (identity.legacyLeadId) query = query.eq('legacy_lead_id', identity.legacyLeadId);
  else query = query.eq('new_lead_id', identity.newLeadId);
  const { data, error } = await query;
  if (error || !data?.length) return;

  const soe =
    data.find((row) => {
      const se = Array.isArray(row.sub_efforts) ? row.sub_efforts[0] : row.sub_efforts;
      return String(se?.case_document_classification_id || '') === String(classificationId);
    }) ||
    data.find((row) => {
      const se = Array.isArray(row.sub_efforts) ? row.sub_efforts[0] : row.sub_efforts;
      return String(se?.name || '').trim().toLowerCase() === 'sequence of events';
    });
  if (!soe) return;

  const items = normalizeSubEffortDocs(soe.document_url);
  if (items.some((item) => String(item?.path || '').trim() === destPath)) return;
  items.push({ path: destPath, name: fileName, mimeType: contentType });
  const { error: upErr } = await supabase
    .from('lead_sub_efforts')
    .update({ document_url: items, updated_by: 'Smart Scan', updated_at: nowIso() })
    .eq('id', soe.id);
  if (upErr) {
    console.warn('⚠️  Smart Scan sub-effort attach failed:', upErr.message || upErr);
  }
}

async function removePathFromSequenceOfEvents(identity, classificationId, destPath) {
  if (!identity?.newLeadId && !identity?.legacyLeadId) return;
  let query = supabase
    .from('lead_sub_efforts')
    .select('id, document_url, sub_efforts ( id, name, case_document_classification_id )')
    .order('created_at', { ascending: true })
    .limit(80);
  if (identity.legacyLeadId) query = query.eq('legacy_lead_id', identity.legacyLeadId);
  else query = query.eq('new_lead_id', identity.newLeadId);
  const { data, error } = await query;
  if (error || !data?.length) return;
  const soe =
    data.find((row) => {
      const se = Array.isArray(row.sub_efforts) ? row.sub_efforts[0] : row.sub_efforts;
      return String(se?.case_document_classification_id || '') === String(classificationId);
    }) ||
    data.find((row) => {
      const se = Array.isArray(row.sub_efforts) ? row.sub_efforts[0] : row.sub_efforts;
      return String(se?.name || '').trim().toLowerCase() === 'sequence of events';
    });
  if (!soe) return;
  const items = normalizeSubEffortDocs(soe.document_url).filter(
    (item) => String(item?.path || '').trim() !== String(destPath || '').trim(),
  );
  await supabase
    .from('lead_sub_efforts')
    .update({ document_url: items, updated_by: 'Smart Scan', updated_at: nowIso() })
    .eq('id', soe.id);
}

async function resolveScanSourceRow(row) {
  if (!row?.parent_id) return row;
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', row.parent_id).maybeSingle();
  if (error) throw new Error(error.message || 'Failed to load original scan');
  return data || row;
}

async function markScanFamilyAssigned(sourceRow, lead, aiRaw, activityLabel) {
  const fields = {
    status: 'completed',
    classification_status:
      sourceRow.classification_status === 'processing' ? 'classified' : sourceRow.classification_status,
    lead_match_status: 'matched',
    issue: null,
    ai_raw: aiRaw,
  };
  await patchDocument(sourceRow, fields, activityLabel);
  const { data: children } = await supabase.from(TABLE).select('*').eq('parent_id', sourceRow.id);
  for (const child of children || []) {
    await patchDocument(
      child,
      {
        status: 'completed',
        lead_match_status: 'matched',
        issue: null,
        ai_raw: {
          ...asAiRaw(child),
          assignedLead: lead,
          leadAssignedBy: aiRaw.leadAssignedBy,
          caseDocumentId: aiRaw.caseDocumentId,
          caseDocumentPath: aiRaw.caseDocumentPath,
          savedLeadNumber: aiRaw.savedLeadNumber,
          combinedScan: true,
        },
      },
      activityLabel,
    );
  }
}

async function saveScanToLeadCaseDocuments(row, lead) {
  const source = await resolveScanSourceRow(row);
  const identity = await resolveLeadIdentity(lead);
  if (!identity.leadNumber) throw new Error('Lead number is required');

  const raw = asAiRaw(source);
  if (raw.caseDocumentPath && raw.savedLeadNumber === identity.leadNumber && !raw.caseDocumentSplit) {
    const classificationId = await resolveSequenceOfEventsClassificationId();
    if (classificationId) {
      await attachToSequenceOfEventsSubEffort(
        identity,
        classificationId,
        raw.caseDocumentPath,
        source.original_filename || source.suggested_filename || 'scan.pdf',
        source.content_type || 'application/pdf',
      );
    }
    return raw;
  }

  const classificationId = await resolveSequenceOfEventsClassificationId();
  if (!classificationId) {
    throw new Error('Sequence of Events is not configured in case document categories');
  }

  const copied = await copyScanFileToCaseDocuments(
    {
      ...source,
      suggested_filename: source.original_filename || source.suggested_filename || 'scan.pdf',
    },
    identity.leadNumber,
  );
  const aiDocs = Array.isArray(raw.documents) ? raw.documents : [];
  const documentTypeId =
    aiDocs.length <= 1
      ? await resolveLeadCaseDocumentTypeId(source.document_type || source.suggested_document_type)
      : null;

  const { data: inserted, error: insErr } = await supabase
    .from('lead_case_documents')
    .insert({
      lead_number: identity.leadNumber,
      onedrive_subfolder: CLIENT_HEADER_FOLDER,
      onedrive_item_id: `smart-scan-combined:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      storage_path: copied.destPath,
      file_name: copied.fileName,
      file_size: copied.fileSize,
      mime_type: copied.contentType,
      classification_id: classificationId,
      uploaded_by: 'Smart Scan',
      ai_summary_status: 'pending',
      contact_id: null,
      document_type_id: documentTypeId,
    })
    .select('id')
    .single();

  if (insErr) {
    await supabase.storage.from(CASE_DOCUMENTS_BUCKET).remove([copied.destPath]).catch(() => undefined);
    throw new Error(insErr.message || 'Failed to save scan to Sequence of Events');
  }

  if (inserted?.id) {
    void supabase.functions
      .invoke('case-document-summarize', { body: { documentId: inserted.id } })
      .catch(() => undefined);
  }

  await attachToSequenceOfEventsSubEffort(
    identity,
    classificationId,
    copied.destPath,
    copied.fileName,
    copied.contentType,
  );

  raw.caseDocumentPath = copied.destPath;
  raw.caseDocumentId = inserted?.id || null;
  raw.savedLeadNumber = identity.leadNumber;
  raw.combinedScan = true;
  raw.caseDocumentSplit = false;
  return raw;
}

async function findScanByCaseDocumentId(caseDocumentId) {
  const id = String(caseDocumentId || '').trim();
  if (!id) return null;
  const matchesId = (row) => {
    const raw = asAiRaw(row);
    if (String(raw.caseDocumentId || '') === id) return true;
    return Array.isArray(raw.caseDocumentIds) && raw.caseDocumentIds.some((value) => String(value) === id);
  };
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .filter('ai_raw->>caseDocumentId', 'eq', id)
    .limit(20);
  const rows = !error && Array.isArray(data) ? data.filter(matchesId) : [];
  if (rows.length) return rows.find((row) => !row.parent_id) || rows[0];

  const { data: fallback, error: fallbackError } = await supabase
    .from(TABLE)
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(400);
  if (fallbackError) return null;
  const matches = (fallback || []).filter(matchesId);
  return matches.find((row) => !row.parent_id) || matches[0] || null;
}

async function pdfPageCount(buffer) {
  try {
    const { PDFDocument } = require('pdf-lib');
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return Math.max(1, pdf.getPageCount());
  } catch {
    return 1;
  }
}

async function splitLeadCaseDocument(caseDocumentId) {
  const id = String(caseDocumentId || '').trim();
  if (!id) throw new Error('Document is required');

  const { data: caseDoc, error } = await supabase.from('lead_case_documents').select('*').eq('id', id).maybeSingle();
  if (error || !caseDoc) throw new Error(error?.message || 'Document not found');

  let scan = await findScanByCaseDocumentId(id);
  if (scan) scan = await resolveScanSourceRow(scan);
  if (!scan) throw new Error('Could not find the original scan to separate');
  if (asAiRaw(scan).caseDocumentSplit) {
    throw new Error('This scan is already separated into documents');
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from(CASE_DOCUMENTS_BUCKET)
    .download(caseDoc.storage_path);
  if (dlErr || !blob) throw new Error(dlErr?.message || 'Failed to download scan');
  const buffer = Buffer.from(await blob.arrayBuffer());
  const pageCount = Number(scan?.page_count) || (await pdfPageCount(buffer));

  let aiDocs = scan && Array.isArray(asAiRaw(scan).documents) ? asAiRaw(scan).documents : [];
  let ranges = normalizeRanges(aiDocs, pageCount);
  if (scan && aiDocs.length <= 1) {
    await classifySmartScanDocument(scan.id);
    const refreshed = await findDocument({ documentId: scan.id });
    if (refreshed) {
      scan = refreshed;
      aiDocs = Array.isArray(asAiRaw(refreshed).documents) ? asAiRaw(refreshed).documents : [];
      ranges = normalizeRanges(aiDocs, Number(refreshed.page_count) || pageCount);
    }
  }
  if (ranges.length <= 1) {
    throw new Error('AI found only one document in this scan');
  }

  const leadNumber = String(caseDoc.lead_number || '').trim();
  if (!leadNumber) throw new Error('Lead number is required');

  const stamp = Date.now();
  const insertedIds = [];
  const insertedPaths = [];
  try {
    for (let i = 0; i < ranges.length; i += 1) {
      const doc = ranges[i];
      const documentType = normalizeType(doc.documentType);
      const fileName = buildFilename({ ...doc, documentType });
      const bytes = await splitPdf(buffer, doc.pageStart, doc.pageEnd);
      const destPath = `case-documents/${safePathSegment(leadNumber)}/${CLIENT_HEADER_FOLDER}/${stamp}_${i + 1}_${fileName}`;
      const { error: upErr } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).upload(destPath, bytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (upErr) throw new Error(upErr.message || 'Failed to save split PDF');
      insertedPaths.push({ destPath, fileName });

      const documentTypeId = await resolveLeadCaseDocumentTypeId(documentType);
      const { data: inserted, error: insErr } = await supabase
        .from('lead_case_documents')
        .insert({
          lead_number: leadNumber,
          onedrive_subfolder: caseDoc.onedrive_subfolder || CLIENT_HEADER_FOLDER,
          onedrive_item_id: null,
          storage_path: destPath,
          file_name: fileName,
          file_size: bytes.length,
          mime_type: 'application/pdf',
          classification_id: caseDoc.classification_id,
          uploaded_by: 'Smart Scan',
          ai_summary_status: 'pending',
          contact_id: null,
          document_type_id: documentTypeId,
        })
        .select('id')
        .single();
      if (insErr) throw new Error(insErr.message || 'Failed to save split document');
      insertedIds.push(inserted.id);
      if (inserted?.id) {
        void supabase.functions
          .invoke('case-document-summarize', { body: { documentId: inserted.id } })
          .catch(() => undefined);
      }
    }
  } catch (splitError) {
    if (insertedIds.length) {
      await supabase.from('lead_case_documents').delete().in('id', insertedIds).catch(() => undefined);
    }
    if (insertedPaths.length) {
      await supabase.storage
        .from(CASE_DOCUMENTS_BUCKET)
        .remove(insertedPaths.map((part) => part.destPath))
        .catch(() => undefined);
    }
    throw splitError;
  }

  const identity = await resolveLeadIdentity({
    leadNumber,
    name: 'Unknown',
  }).catch(() => ({
    leadNumber,
    newLeadId: null,
    legacyLeadId: /^\d+$/.test(leadNumber) ? Number(leadNumber) : null,
  }));
  const classificationId = caseDoc.classification_id || (await resolveSequenceOfEventsClassificationId());
  if (classificationId && (identity.newLeadId || identity.legacyLeadId)) {
    await removePathFromSequenceOfEvents(identity, classificationId, caseDoc.storage_path);
    for (const part of insertedPaths) {
      await attachToSequenceOfEventsSubEffort(
        identity,
        classificationId,
        part.destPath,
        part.fileName,
        'application/pdf',
      );
    }
  }

  await supabase.from('lead_case_documents').delete().eq('id', caseDoc.id);
  await supabase.storage.from(CASE_DOCUMENTS_BUCKET).remove([caseDoc.storage_path]).catch(() => undefined);

  if (scan) {
    const nextRaw = {
      ...asAiRaw(scan),
      caseDocumentSplit: true,
      combinedScan: false,
      caseDocumentId: insertedIds[0] || null,
      caseDocumentIds: insertedIds,
      caseDocumentPath: insertedPaths[0]?.destPath || null,
    };
    await patchDocument(scan, { ai_raw: nextRaw }, `Separated scan into ${ranges.length} PDFs`);
    const { data: children } = await supabase.from(TABLE).select('*').eq('parent_id', scan.id);
    for (const child of children || []) {
      await patchDocument(
        child,
        {
          ai_raw: {
            ...asAiRaw(child),
            caseDocumentSplit: true,
            combinedScan: false,
            caseDocumentId: insertedIds[0] || null,
            caseDocumentIds: insertedIds,
          },
        },
        `Separated scan into ${ranges.length} PDFs`,
      );
    }
  }

  return { success: true, count: ranges.length, documentIds: insertedIds };
}

async function assignLeadByItemId(id, leadInput) {
  const row = await findDocument(parseItemRef(id));
  if (!row) throw new Error('Scan not found');
  const lead = sanitizeLeadRef(leadInput);
  if (!lead) throw new Error('Lead is required');
  const source = await resolveScanSourceRow(row);
  const aiRaw = await saveScanToLeadCaseDocuments(source, lead);
  aiRaw.assignedLead = lead;
  aiRaw.leadAssignedBy = 'user';
  aiRaw.leadMatchApplied = true;
  return markScanFamilyAssigned(
    source,
    lead,
    aiRaw,
    `Lead assigned: ${lead.leadNumber} — ${lead.name}`,
  );
}

async function approveByItemId(id) {
  const row = await findDocument(parseItemRef(id));
  if (!row) throw new Error('Scan not found');
  const source = await resolveScanSourceRow(row);
  const aiRaw = asAiRaw(source);
  const lead = sanitizeLeadRef(aiRaw.assignedLead || aiRaw.suggestedLead);
  if (!lead) throw new Error('No AI lead match to approve');
  const savedRaw = await saveScanToLeadCaseDocuments(source, lead);
  savedRaw.assignedLead = lead;
  savedRaw.leadAssignedBy = savedRaw.leadAssignedBy === 'user' ? 'user' : 'ai';
  savedRaw.approvedAt = nowIso();
  savedRaw.leadMatchApplied = true;
  return markScanFamilyAssigned(
    source,
    lead,
    savedRaw,
    `Approved AI lead match: ${lead.leadNumber} — ${lead.name}`,
  );
}

function isStatementTimeout(error) {
  return (
    String(error?.code || '') === '57014' ||
    /statement timeout/i.test(String(error?.message || error?.details || ''))
  );
}

async function loadQueueRows() {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(400);
    if (!error) return data || [];
    if (tableMissing(error)) return [];
    if (attempt < 2 && isStatementTimeout(error)) {
      console.warn('⚠️  Smart Scan queue read timed out, retrying once');
      await sleep(400);
      continue;
    }
    throw new Error(error.message || 'Failed to load Smart Scan queue');
  }
  return [];
}

async function listQueueItems() {
  const rows = await loadQueueRows();

  // Lead matching is a nice-to-have; a slow leads query must not empty the queue.
  let documents = rows;
  try {
    documents = await enrichDocumentsWithLeadMatches(rows, { persist: true, force: false });
  } catch (error) {
    console.warn('⚠️  Smart Scan lead matching skipped:', error.message || error);
  }
  const visible = visibleQueue(documents);
  const childrenByParent = new Map();
  for (const row of documents) {
    if (!row.parent_id) continue;
    const list = childrenByParent.get(row.parent_id) || [];
    list.push(row);
    childrenByParent.set(row.parent_id, list);
  }

  const emailIds = [
    ...new Set(visible.map((row) => Number(row.source_email_id)).filter((id) => Number.isFinite(id))),
  ];
  const emailTable = process.env.EMAIL_HEADERS_TABLE || 'emails';
  let emails = [];
  if (emailIds.length) {
    const { data: emailRows, error: emailError } = await supabase
      .from(emailTable)
      .select('id, subject, sender_email, sent_at, client_id, recipient_list')
      .in('id', emailIds);
    if (emailError) {
      console.warn('⚠️  Smart Scan email lookup failed:', emailError.message || emailError);
    } else {
      emails = emailRows || [];
    }
  }
  const emailById = new Map(emails.map((row) => [Number(row.id), row]));

  return visible.map((row) => {
    const email = emailById.get(Number(row.source_email_id)) || {};
    const leadState = leadStateFromRow(row);
    const siblings = row.parent_id ? childrenByParent.get(row.parent_id) || [] : [];
    const createdAt = row.created_at || email.sent_at || nowIso();
    const base = {
      id: itemIdFor(row),
      batchId: String(email.subject || '').trim() || `SCN-${row.source_email_id}`,
      createdAt,
      scannerName: 'Scan Center',
      pageCount: Number(row.page_count) || 1,
      leadMatchStatus: leadState.leadMatchStatus,
      leadAssignedBy: leadState.leadAssignedBy,
      classificationStatus: row.classification_status || 'needs_review',
      lead: leadState.lead,
      possibleLeadMatches: leadState.possibleLeadMatches,
      documentType: row.document_type || 'Unknown',
      suggestedDocumentType: row.suggested_document_type || row.document_type || 'Unknown',
      title: row.title || row.original_filename,
      originalFilename: row.original_filename || 'scan.pdf',
      status: row.status || 'unmatched',
      issue: row.issue || undefined,
      confidence: row.confidence == null ? 0 : Number(row.confidence),
      summary: row.summary || undefined,
      activity: asActivity(row.activity),
      storagePath: row.storage_path || null,
      contentType: row.content_type || 'application/pdf',
      emailId: Number(row.source_email_id) || undefined,
      attachmentId: row.parent_id ? undefined : row.source_graph_attachment_id,
    };
    return applyDocumentToItem(base, row, siblings.length);
  });
}

function applyDocumentToItem(item, row, splitCount = 0) {
  if (!row) return item;
  const documentType = row.document_type || row.suggested_document_type || item.documentType;
  const suggested = row.suggested_document_type || documentType;
  const classified = Boolean(row.processed_at) && row.status !== 'processing';
  const leadState = leadStateFromRow(row);
  return {
    ...item,
    id: itemIdFor(row),
    scanDocumentId: row.id,
    parentDocumentId: row.parent_id || undefined,
    splitIndex: row.split_index || undefined,
    splitCount: splitCount || undefined,
    pageStart: row.page_start || undefined,
    pageEnd: row.page_end || undefined,
    pageCount: Number(row.page_count) || item.pageCount || 1,
    documentType: classified ? documentType : item.documentType,
    suggestedDocumentType: classified ? suggested : item.suggestedDocumentType,
    title: row.title || item.title,
    suggestedFilename: row.suggested_filename || item.suggestedFilename,
    detectedPersonName: row.detected_person_name || item.detectedPersonName,
    detectedCountry: row.detected_country || item.detectedCountry,
    documentDate: row.document_date || item.documentDate,
    expiryDate: row.expiry_date || item.expiryDate,
    summary: row.summary || item.summary,
    confidence: row.confidence == null ? item.confidence : Number(row.confidence),
    status: row.status || item.status,
    classificationStatus: row.classification_status || item.classificationStatus,
    leadMatchStatus: leadState.leadMatchStatus,
    leadAssignedBy: leadState.leadAssignedBy,
    lead: leadState.lead,
    possibleLeadMatches: leadState.possibleLeadMatches,
    issue: row.issue || undefined,
    processedAt: row.processed_at || item.processedAt,
    originalFilename: row.original_filename || item.originalFilename,
    storagePath: row.storage_path || item.storagePath,
    contentType: row.content_type || item.contentType,
    activity: asActivity(row.activity).length ? asActivity(row.activity) : item.activity,
    emailId: Number(row.source_email_id) || item.emailId,
    attachmentId: row.parent_id ? undefined : row.source_graph_attachment_id || item.attachmentId,
  };
}

function childItemFrom(parentItem, row, splitCount) {
  return applyDocumentToItem(
    {
      ...parentItem,
      previewUrl: undefined,
    },
    row,
    splitCount,
  );
}

async function attachAndEnqueue(baseItems, { auto = true } = {}) {
  const emailIds = baseItems.map((item) => item.emailId).filter(Boolean);
  const attachmentIds = baseItems.map((item) => item.attachmentId).filter(Boolean);
  let documents = [];
  try {
    const [byEmail, byAttachment] = await Promise.all([
      loadDocumentsForEmails(emailIds),
      loadDocumentsForAttachments(attachmentIds),
    ]);
    const byId = new Map();
    for (const row of [...byEmail, ...byAttachment]) {
      if (row?.id) byId.set(row.id, row);
    }
    documents = [...byId.values()];
  } catch (error) {
    console.warn('⚠️  Smart Scan AI table unavailable:', error.message || error);
    return baseItems;
  }

  const bySource = new Map();
  for (const row of documents) {
    if (row.parent_id) continue;
    const key = String(row.source_graph_attachment_id || '');
    if (!key) continue;
    const prev = bySource.get(key);
    if (!prev || rowTime(row) >= rowTime(prev)) bySource.set(key, row);
  }

  const ensured = [];
  for (const item of baseItems) {
    const key = String(item.attachmentId || '');
    if (key && (await isAttachmentRemoved(key))) continue;
    let row = key ? bySource.get(key) : null;
    if (!row) {
      try {
        row = await ensureSourceRow(item);
      } catch (error) {
        if (tableMissing(error)) return baseItems;
        console.warn('⚠️  Smart Scan ensure source failed:', error.message || error);
      }
      if (row) {
        documents.push(row);
        bySource.set(key, row);
      }
    }
    if (row && auto && shouldClassify(row) && (row.storage_path || item.storagePath)) {
      if (row.status !== 'processing') {
        await supabase
          .from(TABLE)
          .update({
            status: 'processing',
            classification_status: 'processing',
            error: null,
            updated_at: nowIso(),
          })
          .eq('id', row.id);
        row = { ...row, status: 'processing', classification_status: 'processing' };
        bySource.set(key, row);
      }
      enqueueClassify(row);
    }
    ensured.push({ item, row: bySource.get(key) });
  }

  const latest = await loadDocumentsForEmails(emailIds);
  const all = latest.length ? latest : documents;
  const childrenByParent = new Map();
  for (const row of all) {
    if (!row.parent_id) continue;
    const list = childrenByParent.get(row.parent_id) || [];
    list.push(row);
    childrenByParent.set(row.parent_id, list);
  }

  const items = [];
  for (const { item, row } of ensured) {
    if (!row) {
      items.push(item);
      continue;
    }
    const children = (childrenByParent.get(row.id) || []).sort(
      (a, b) => Number(a.split_index || 0) - Number(b.split_index || 0),
    );
    if (children.length) {
      for (const child of children) {
        if (child.ignored) continue;
        items.push(childItemFrom(item, child, children.length));
      }
      continue;
    }
    if (row.ignored) continue;
    items.push(applyDocumentToItem(item, row));
  }

  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function processByItemId(id, { force = true } = {}) {
  const ref = parseItemRef(id);
  if (!ref) throw new Error('Invalid Smart Scan id');
  let row = await findDocument(ref);
  if (!row) throw new Error('Scan not found');
  if (row.parent_id) {
    const parent = await findDocument({ documentId: row.parent_id });
    if (parent) row = parent;
  }
  await supabase
    .from(TABLE)
    .update({
      status: 'processing',
      classification_status: 'processing',
      ignored: false,
      processed_at: null,
      error: null,
      updated_at: nowIso(),
    })
    .eq('id', row.id);
  enqueueClassify({ ...row, status: 'processing' }, { force });
  return { success: true, documentId: row.id, status: 'processing' };
}

async function removeByItemId(id) {
  const ref = parseItemRef(id);
  if (!ref) throw new Error('Invalid Smart Scan id');
  let row = await findDocument(ref);
  const source = row?.parent_id ? await findDocument({ documentId: row.parent_id }) : row;
  const attachmentId = String(
    source?.source_graph_attachment_id || row?.source_graph_attachment_id || ref.attachmentId || '',
  ).trim();
  if (!attachmentId) throw new Error(row ? 'Scan attachment is missing' : 'Scan not found');

  let graphMessageId = null;
  const emailId = Number(source?.source_email_id || row?.source_email_id);
  if (Number.isFinite(emailId)) {
    const emailTable = process.env.EMAIL_HEADERS_TABLE || 'emails';
    const { data: email } = await supabase.from(emailTable).select('message_id').eq('id', emailId).maybeSingle();
    graphMessageId = email?.message_id || null;
  }

  const { error: removedError } = await supabase.from(REMOVED_TABLE).upsert({
    source_graph_attachment_id: attachmentId,
    source_email_id: Number.isFinite(emailId) ? emailId : null,
    graph_message_id: graphMessageId,
    original_filename: row?.original_filename || source?.original_filename || null,
    removed_at: nowIso(),
  });
  if (removedError) {
    throw new Error(
      tableMissing(removedError)
        ? 'Run sql/2026-09-15_smart_scan_removed.sql before deleting scans'
        : removedError.message || 'Failed to remember removed scan',
    );
  }

  const { data: sources, error: sourceError } = await supabase
    .from(TABLE)
    .select('id')
    .eq('source_graph_attachment_id', attachmentId)
    .is('parent_id', null);
  if (sourceError && !tableMissing(sourceError)) {
    throw new Error(sourceError.message || 'Failed to list scan rows');
  }
  const sourceIds = (sources || []).map((entry) => entry.id);
  if (sourceIds.length) {
    await supabase.from(TABLE).delete().in('parent_id', sourceIds);
    await supabase.from(TABLE).delete().in('id', sourceIds);
  }
  await supabase.from(TABLE).delete().eq('source_graph_attachment_id', attachmentId);
  return { success: true, attachmentId };
}

async function downloadScanDocument(documentId) {
  const row = await findDocument({ documentId });
  if (!row?.storage_path) throw new Error('Scan file not found');
  const bucket = process.env.EMAIL_ATTACHMENTS_BUCKET || 'email-attachments';
  const { data, error } = await supabase.storage.from(bucket).download(row.storage_path);
  if (error || !data) throw new Error(error?.message || 'Failed to download scan file');
  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    fileName: row.suggested_filename || row.original_filename || 'scan.pdf',
    contentType: row.content_type || 'application/pdf',
  };
}

module.exports = {
  TABLE,
  parseItemRef,
  loadDocumentsForEmails,
  loadRecentEmailIds,
  attachAndEnqueue,
  listQueueItems,
  processByItemId,
  assignLeadByItemId,
  approveByItemId,
  splitLeadCaseDocument,
  removeByItemId,
  loadRemovedRefs,
  findDocument,
  downloadScanDocument,
};
