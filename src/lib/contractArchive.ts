import { supabase } from './supabase';

/**
 * Archiving a signed contract and replacing it with an amended draft.
 *
 * A lead has one live contract. Once it is signed it must stay untouched for the
 * record, so changes are made on a fresh draft cloned from it. Archived contracts
 * keep status='signed' and signed_at — `archived_at` is what takes them out of the
 * live lookups, so signed-deal reporting is unaffected.
 *
 * Legacy leads keep their contract as HTML on lead_leadcontact rather than as a row
 * in `contracts`. Those are archived in place and the replacement is created from a
 * template by the normal create flow, because converting the stored HTML into the
 * TipTap JSON that `contracts.custom_content` holds is not a safe transformation.
 */

const LEGACY_CONTRACT_PREFIX = 'legacy_';

export function isLegacyContractId(contractId: string): boolean {
  return String(contractId || '').startsWith(LEGACY_CONTRACT_PREFIX);
}

function stripLegacyPrefix(contractId: string): string {
  return String(contractId || '').replace(/^legacy_/, '');
}

/**
 * Never carried over to the amended draft: identity, timestamps, signing state,
 * approval state, the public link, and the archive bookkeeping itself. Everything
 * else (template, contact details, pricing, applicant count, country...) is copied,
 * so the new draft starts as the signed deal minus the signature.
 */
const CLONE_EXCLUDED_COLUMNS = new Set([
  'id',
  'created_at',
  'updated_at',
  // The amended draft is new work: let the defaults record who made it rather than
  // inheriting the original signer's attribution.
  'created_by',
  'updated_by',
  'status',
  'signed_at',
  'date_signed',
  'public_token',
  'token_claimed_at',
  'client_inputs',
  'custom_content',
  'pre_sign_content',
  'archived_at',
  'archived_by',
  'archive_reason',
  'superseded_by_contract_id',
  'approved',
  'approved_at',
  'approved_by',
  'declined',
  'decline_note',
  'ai_summary',
  'ai_summary_at',
  'ai_summary_status',
  'ai_summary_error',
]);

async function currentUserLabel(): Promise<string | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.email ?? user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The signed body has the raw date string replaced by its localised rendering, so
 * matching it back needs the same variants the signing page produced.
 */
function dateMatchVariants(raw: string): string[] {
  const variants = new Set<string>([raw]);
  try {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
    if (!isNaN(parsed.getTime())) {
      for (const locale of ['he-IL', 'en-US']) {
        variants.add(
          parsed.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
        );
      }
    }
  } catch {
    // Unparseable value: the raw string is still worth matching.
  }
  return [...variants].filter((value) => value.trim().length > 0);
}

type RestoreRule = { needles: string[]; token: string };

function looksLikeDateField(id: string, value: string, templateText: string): boolean {
  if (templateText.includes(`{{date:${id}}}`)) return true;
  if (/date/i.test(id)) return true;
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * Every client input — text, date and signature alike — is turned back into its
 * placeholder, so the amended draft presents empty input fields again instead of the
 * values the client filled in on the signed copy.
 */
function buildRestoreRules(clientInputs: unknown, templateText: string): RestoreRule[] {
  if (!clientInputs || typeof clientInputs !== 'object') return [];

  const rules: RestoreRule[] = [];
  for (const [id, rawValue] of Object.entries(clientInputs as Record<string, unknown>)) {
    if (typeof rawValue !== 'string' || rawValue.trim() === '') continue;

    if (rawValue.startsWith('data:image/')) {
      rules.push({ needles: [rawValue], token: `{{signature:${id}}}` });
      continue;
    }
    if (looksLikeDateField(id, rawValue, templateText)) {
      rules.push({ needles: dateMatchVariants(rawValue), token: `{{date:${id}}}` });
      continue;
    }
    rules.push({ needles: [rawValue], token: `{{text:${id}}}` });
  }

  // Longest needle first so a shorter value can't clobber part of a longer one.
  return rules.sort(
    (a, b) => Math.max(...b.needles.map((n) => n.length)) - Math.max(...a.needles.map((n) => n.length)),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Below this length a value is too generic to replace without checking its edges. */
const AMBIGUOUS_NEEDLE_MAX_LENGTH = 3;

function replaceNeedle(text: string, needle: string, token: string): string {
  if (!needle || !text.includes(needle)) return text;

  // A short answer like "2" must not be matched inside "2026" or "$1,250".
  if (needle.length <= AMBIGUOUS_NEEDLE_MAX_LENGTH) {
    const bounded = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}(?=[^\\p{L}\\p{N}]|$)`,
      'gu',
    );
    return text.replace(bounded, (_match, prefix: string) => `${prefix}${token}`);
  }

  return text.split(needle).join(token);
}

function applyRulesToString(text: string, rules: RestoreRule[]): string {
  let result = text;
  for (const rule of rules) {
    for (const needle of rule.needles) {
      result = replaceNeedle(result, needle, rule.token);
    }
  }
  return result;
}

function restorePlaceholders(content: unknown, rules: RestoreRule[]): unknown {
  if (typeof content === 'string') return applyRulesToString(content, rules);
  if (Array.isArray(content)) return content.map((node) => restorePlaceholders(node, rules));
  if (!content || typeof content !== 'object') return content;

  const node = { ...(content as Record<string, unknown>) };

  if (typeof node.text === 'string') node.text = applyRulesToString(node.text, rules);

  // Some bodies hold the signature as an image node rather than inline text.
  const attrs = node.attrs as Record<string, unknown> | undefined;
  if (attrs && typeof attrs.src === 'string' && attrs.src.startsWith('data:image/')) {
    const matched = rules.find((rule) => rule.needles.includes(attrs.src as string));
    if (matched) return { type: 'text', text: matched.token };
  }

  if (node.content !== undefined) node.content = restorePlaceholders(node.content, rules);
  return node;
}

async function fetchTemplateContent(templateId: unknown): Promise<unknown> {
  if (!templateId) return null;
  const { data } = await supabase
    .from('contract_templates')
    .select('content')
    .eq('id', templateId)
    .maybeSingle();
  return data?.content ?? null;
}

function hasFieldPlaceholders(content: unknown): boolean {
  try {
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    return /\{\{(text|date|signature|sig)[:}]/.test(text);
  } catch {
    return false;
  }
}

/**
 * Body for the amended draft: the snapshot taken at sign time when we have one,
 * otherwise the signed body with the client's answers turned back into placeholders.
 */
export async function deriveAmendedContractBody(source: Record<string, any>): Promise<unknown> {
  if (source.pre_sign_content) return source.pre_sign_content;

  const templateContent = await fetchTemplateContent(source.template_id);
  const signedBody = source.custom_content ?? null;
  if (!signedBody) return templateContent ?? null;

  const rules = buildRestoreRules(source.client_inputs, JSON.stringify(templateContent ?? ''));
  const restored = rules.length > 0 ? restorePlaceholders(signedBody, rules) : signedBody;

  // Nothing could be turned back into a field — without client_inputs the answers are
  // indistinguishable from the body text. An unedited template still has real input
  // fields, which beats a draft permanently locked to the old answers.
  if (!hasFieldPlaceholders(restored) && hasFieldPlaceholders(templateContent)) {
    return templateContent;
  }

  return restored;
}

/**
 * Flag a contract as archived. Handles both storage shapes.
 * Does not create a replacement — see archiveAndAmendContract.
 */
export async function archiveContract(params: {
  contractId: string;
  reason?: string | null;
}): Promise<void> {
  const { contractId, reason } = params;
  const archivedAt = new Date().toISOString();

  if (isLegacyContractId(contractId)) {
    const { error } = await supabase
      .from('lead_leadcontact')
      .update({ contract_archived_at: archivedAt })
      .eq('id', stripLegacyPrefix(contractId));
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('contracts')
    .update({
      archived_at: archivedAt,
      archived_by: await currentUserLabel(),
      archive_reason: reason ?? null,
    })
    .eq('id', contractId);
  if (error) throw error;
}

export async function unarchiveContract(contractId: string): Promise<void> {
  if (isLegacyContractId(contractId)) {
    const { error } = await supabase
      .from('lead_leadcontact')
      .update({ contract_archived_at: null })
      .eq('id', stripLegacyPrefix(contractId));
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('contracts')
    .update({ archived_at: null, archived_by: null, archive_reason: null })
    .eq('id', contractId);
  if (error) throw error;
}

export type AmendedContractResult = {
  /** Null for legacy contracts: archived in place, replacement comes from a template. */
  newContractId: string | null;
};

/**
 * Archive a signed contract and, for contracts held in the `contracts` table, create
 * the amended draft cloned from it without signature, date, or public link.
 */
export async function archiveAndAmendContract(params: {
  contractId: string;
  reason?: string | null;
}): Promise<AmendedContractResult> {
  const { contractId, reason } = params;

  if (isLegacyContractId(contractId)) {
    await archiveContract({ contractId, reason });
    return { newContractId: null };
  }

  const { data: source, error: fetchError } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .single();
  if (fetchError) throw fetchError;
  if (!source) throw new Error('Contract not found');

  const body = await deriveAmendedContractBody(source);

  const clone: Record<string, any> = {};
  for (const [column, value] of Object.entries(source)) {
    if (CLONE_EXCLUDED_COLUMNS.has(column)) continue;
    clone[column] = value;
  }
  clone.status = 'draft';
  clone.signed_at = null;
  clone.custom_content = body;

  const { data: created, error: insertError } = await supabase
    .from('contracts')
    .insert([clone])
    .select('id')
    .single();
  if (insertError) throw insertError;

  const archivedAt = new Date().toISOString();
  const { error: archiveError } = await supabase
    .from('contracts')
    .update({
      archived_at: archivedAt,
      archived_by: await currentUserLabel(),
      archive_reason: reason ?? null,
      superseded_by_contract_id: created.id,
    })
    .eq('id', contractId);

  if (archiveError) {
    // Leaving both live would show two contracts on the card; drop the clone.
    await supabase.from('contracts').delete().eq('id', created.id);
    throw archiveError;
  }

  return { newContractId: created.id };
}
