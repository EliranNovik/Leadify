import { supabase } from './supabase';
import { getFrontendBaseUrl } from './api';

export type LeadContractPublicLink = {
  url: string;
  signed: boolean;
};

export const AGREEMENT_LINK_LABEL = 'Agreement Link';
export const CONTRACT_LINK_LABEL = 'Contract Link';
export const RMQ_LOGO_URL = `${getFrontendBaseUrl()}/RMQ_LOGO.png`;

export function labelForContractLink(signed: boolean): string {
  return signed ? CONTRACT_LINK_LABEL : AGREEMENT_LINK_LABEL;
}

export function contractLinkTitle(leadNumber?: string | null): string {
  const caseId = String(leadNumber || '').trim();
  return caseId ? `${CONTRACT_LINK_LABEL} · Case ${caseId}` : CONTRACT_LINK_LABEL;
}

function escapeAttr(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function contractIsSigned(row: {
  signed_at?: unknown;
  status?: unknown;
  signed_contract_html?: unknown;
}): boolean {
  if (row.signed_at) return true;
  if (String(row.status || '').toLowerCase() === 'signed') return true;
  const html = String(row.signed_contract_html || '').trim();
  return Boolean(html) && html !== '\\N';
}

async function ensurePublicToken(
  table: 'contracts' | 'lead_leadcontact',
  id: unknown,
  existing: unknown,
): Promise<string> {
  const token = String(existing || '').trim();
  if (token) return token;
  if (id == null || id === '') return '';
  const next = crypto.randomUUID();
  const { error } = await supabase.from(table).update({ public_token: next }).eq('id', id);
  return error ? '' : next;
}

function buildContractPublicUrl(opts: { id: unknown; token: string; legacyContact?: boolean }): string {
  if (opts.legacyContact) {
    return `${getFrontendBaseUrl()}/public-legacy-contract/${opts.id}/${opts.token}`;
  }
  return `${getFrontendBaseUrl()}/public-contract/${opts.id}/${opts.token}`;
}

const CONTRACT_URL_IN_HREF_RE =
  /https?:\/\/[^"'>\s]+\/(?:public-contract|public-legacy-contract)\/[^"'>\s]+/i;
const BARE_CONTRACT_URL_RE =
  /https?:\/\/[^\s<>"']+\/(?:public-contract|public-legacy-contract)\/[^\s<>"']+/gi;
const SIMPLE_CONTRACT_ANCHOR_RE =
  /<a\s+[^>]*href=["'](https?:\/\/[^"']+\/(?:public-contract|public-legacy-contract)\/[^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;

export const CONTRACT_PREVIEW_TABLE_RE =
  /<table\b[^>]*\bdata-contract-preview\b[\s\S]*?<\/table>/gi;

function extractBalancedTag(
  html: string,
  tagName: string,
  prefix: string,
  startIndex: number,
): { text: string; blocks: string[] } {
  const openNeedle = `<${tagName}`;
  const closeNeedle = `</${tagName}>`;
  const source = String(html || '');
  const blocks: string[] = [];
  let result = '';
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf(openNeedle, i);
    if (start < 0) {
      result += source.slice(i);
      break;
    }
    const tagEnd = source.indexOf('>', start);
    if (tagEnd < 0) {
      result += source.slice(i);
      break;
    }
    const openTag = source.slice(start, tagEnd + 1);
    if (!/\bdata-contract-preview\b/i.test(openTag)) {
      result += source.slice(i, tagEnd + 1);
      i = tagEnd + 1;
      continue;
    }
    result += source.slice(i, start);
    let depth = 1;
    let pos = tagEnd + 1;
    while (pos < source.length && depth > 0) {
      const nextOpen = source.indexOf(openNeedle, pos);
      const nextClose = source.indexOf(closeNeedle, pos);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        pos = nextOpen + openNeedle.length;
      } else {
        depth -= 1;
        pos = nextClose + closeNeedle.length;
      }
    }
    blocks.push(normalizeContractPreviewBlock(source.slice(start, pos)));
    result += `@@${prefix}${startIndex + blocks.length - 1}@@`;
    i = pos;
  }
  return { text: result, blocks };
}

function extractBalancedContractPreviewTables(
  html: string,
  prefix: string,
): { text: string; blocks: string[] } {
  const tables = extractBalancedTag(html, 'table', prefix, 0);
  const divs = extractBalancedTag(tables.text, 'div', prefix, tables.blocks.length);
  return {
    text: divs.text,
    blocks: [...tables.blocks, ...divs.blocks],
  };
}

export function extractContractPreviewTables(
  html: string,
  prefix = 'CONTRACTPREVIEW',
): { text: string; blocks: string[] } {
  return extractBalancedContractPreviewTables(html, prefix);
}

function normalizeContractPreviewBlock(html: string): string {
  const href =
    html.match(/data-href=["']([^"']+)["']/i)?.[1] ||
    html.match(/href=["'](https?:\/\/[^"']+\/(?:public-(?:legacy-)?contract)\/[^"']+)["']/i)?.[1];
  if (!href) return html;
  const signed = /data-signed=["']1["']/i.test(html);
  const leadNumber = html.match(/data-lead-number=["']([^"']*)["']/i)?.[1] || '';
  return buildContractLinkPreviewHtml(href, signed, leadNumber);
}

export function restoreContractPreviewTables(
  html: string,
  blocks: string[],
  prefix = 'CONTRACTPREVIEW',
): string {
  let next = String(html || '');
  blocks.forEach((block, index) => {
    next = next.replace(`@@${prefix}${index}@@`, block);
  });
  return next;
}

export function buildContractLinkPreviewHtml(
  url: string,
  signed: boolean,
  leadNumber?: string | null,
): string {
  const safeUrl = String(url || '').trim().replace(/"/g, '&quot;');
  if (!safeUrl) return '';
  const caseId = String(leadNumber || '').trim();
  const title = escapeAttr(contractLinkTitle(caseId));
  const cta = signed ? 'View contract' : 'Open contract';
  const leadAttr = caseId ? ` data-lead-number="${escapeAttr(caseId)}"` : '';
  return `<table role="presentation" data-contract-preview="1" data-href="${safeUrl}" data-signed="${
    signed ? '1' : '0'
  }"${leadAttr} width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-collapse:collapse;max-width:360px;">
  <tr>
    <td style="border:0;outline:none;background:#F3F4F6;padding:16px 18px;border-radius:12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="middle" style="font-size:16px;font-weight:700;color:#111827;padding-right:12px;">${title}</td>
          <td valign="middle" align="right" width="72" style="width:72px;text-align:right;">
            <img src="${RMQ_LOGO_URL}" width="64" height="64" alt="RMQ" border="0" style="display:block;border:0;outline:none;width:64px;height:64px;" />
          </td>
        </tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
        <tr>
          <td bgcolor="#4218CC" style="background-color:#4218CC;border-radius:999px;">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 20px;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${cta}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function buildContractLinkPreviewEditorHtml(
  url: string,
  signed: boolean,
  leadNumber?: string | null,
): string {
  const safeUrl = String(url || '').trim().replace(/"/g, '&quot;');
  if (!safeUrl) return '';
  const caseId = String(leadNumber || '').trim();
  const title = escapeAttr(contractLinkTitle(caseId));
  const cta = signed ? 'View contract' : 'Open contract';
  const leadAttr = caseId ? ` data-lead-number="${escapeAttr(caseId)}"` : '';
  return `<div data-contract-preview="1" data-href="${safeUrl}" data-signed="${
    signed ? '1' : '0'
  }"${leadAttr} class="contract-link-preview-card" contenteditable="false">
  <div class="contract-link-preview-header">
    <div class="contract-link-preview-title">${title}</div>
    <img class="contract-link-preview-logo" src="${RMQ_LOGO_URL}" width="64" height="64" alt="RMQ" />
  </div>
  <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="contract-link-preview-btn">${cta}</a>
</div>`;
}

export function buildClickableContractLinkHtml(
  url: string,
  signed: boolean,
  leadNumber?: string | null,
): string {
  return buildContractLinkPreviewHtml(url, signed, leadNumber);
}

export function buildClickableContractLinkAnchor(
  url: string,
  signed: boolean,
  leadNumber?: string | null,
): string {
  return buildContractLinkPreviewHtml(url, signed, leadNumber);
}

export function applyContractLinkPreviewHtml(html: string): string {
  if (!html) return html;
  const first = extractContractPreviewTables(html, 'EXISTINGPREVIEW');
  let next = first.text.replace(SIMPLE_CONTRACT_ANCHOR_RE, (match, url: string) => {
    const signed = /Contract Link/i.test(match) && !/Agreement Link/i.test(match);
    return buildContractLinkPreviewHtml(String(url || '').trim(), signed);
  });
  const second = extractContractPreviewTables(next, 'NEWPREVIEW');
  next = second.text.replace(BARE_CONTRACT_URL_RE, (url) =>
    buildContractLinkPreviewHtml(url.replace(/[.,;)+]+$/, ''), false),
  );
  return restoreContractPreviewTables(
    restoreContractPreviewTables(next, second.blocks, 'NEWPREVIEW'),
    first.blocks,
    'EXISTINGPREVIEW',
  );
}

export function bodyHasContractLink(html: string): boolean {
  return /data-contract-preview/i.test(html);
}

export function stripLooseContractPreviewText(html: string): string {
  return String(html || '')
    .replace(/<p[^>]*>\s*(<strong>)?\s*Contract Link\s*(<\/strong>)?\s*<\/p>/gi, '')
    .replace(
      /<p[^>]*>\s*<a[^>]*\/(?:public-contract|public-legacy-contract)\/[^>]*>\s*(Open contract|View contract|Contract Link|Agreement Link)\s*<\/a>\s*<\/p>/gi,
      '',
    )
    .replace(
      /<a[^>]*\/(?:public-contract|public-legacy-contract)\/[^>]*>\s*(Open contract|View contract|Contract Link|Agreement Link)\s*<\/a>/gi,
      '',
    );
}

export async function fetchLeadContractPublicLink(
  leadId: string,
  isLegacy: boolean,
): Promise<LeadContractPublicLink | null> {
  const rawId = String(leadId || '').replace(/^legacy_/i, '').trim();
  if (!rawId) return null;

  const contractQuery = isLegacy
    ? supabase
        .from('contracts')
        .select('id, status, signed_at, public_token, created_at')
        .eq('legacy_id', rawId)
        .order('created_at', { ascending: false })
        .limit(8)
    : supabase
        .from('contracts')
        .select('id, status, signed_at, public_token, created_at')
        .eq('client_id', rawId)
        .order('created_at', { ascending: false })
        .limit(8);

  const { data: contracts } = await contractQuery;
  const rows: Array<{
    id: unknown;
    signed: boolean;
    token: string;
    legacyContact: boolean;
  }> = (contracts || []).map((row) => ({
    id: row.id,
    signed: contractIsSigned(row),
    token: String(row.public_token || ''),
    legacyContact: false,
  }));

  if (isLegacy) {
    const { data: contacts } = await supabase
      .from('lead_leadcontact')
      .select('id, public_token, signed_contract_html, contract_html, main')
      .eq('lead_id', rawId)
      .limit(8);
    for (const row of contacts || []) {
      if (!row.contract_html && !row.signed_contract_html && !row.public_token) continue;
      rows.push({
        id: row.id,
        signed: contractIsSigned(row),
        token: String(row.public_token || ''),
        legacyContact: true,
      });
    }
  }

  if (!rows.length) return null;

  const preferred = rows.find((row) => !row.signed) || rows[0];
  const token = await ensurePublicToken(
    preferred.legacyContact ? 'lead_leadcontact' : 'contracts',
    preferred.id,
    preferred.token,
  );
  if (!token) return null;

  return {
    url: buildContractPublicUrl({
      id: preferred.id,
      token,
      legacyContact: preferred.legacyContact,
    }),
    signed: preferred.signed,
  };
}
