import { supabase } from '../supabase';
import { fetchStageNames } from '../stageUtils';
import type { SmartScanLeadRef } from './smartScanTypes';

export type SmartScanLeadCasePreview = {
  leadNumber: string;
  name: string;
  summary: string | null;
  stage: string | null;
  category: string | null;
  inactive: boolean;
  handlerName: string | null;
  createdAt: string | null;
};

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clip(value: string, max = 240): string {
  const text = stripHtml(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

async function handlerNameForId(id: unknown): Promise<string | null> {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  const { data } = await supabase.from('employees').select('display_name').eq('id', n).maybeSingle();
  return String(data?.display_name || '').trim() || null;
}

async function categoryNameFor(categoryId: unknown, fallback?: string | null): Promise<string | null> {
  const id = Number(categoryId);
  if (Number.isFinite(id) && id > 0) {
    const { data } = await supabase.from('misc_category').select('name').eq('id', id).maybeSingle();
    const name = String(data?.name || '').trim();
    if (name) return name;
  }
  return String(fallback || '').trim() || null;
}

function isNewLeadInactive(row: { status?: unknown; stage?: unknown; unactivated_at?: unknown }): boolean {
  return (
    String(row.status || '').toLowerCase() === 'inactive' ||
    String(row.stage) === '91' ||
    Boolean(row.unactivated_at)
  );
}

function isLegacyLeadInactive(row: { status?: unknown; stage?: unknown }): boolean {
  return row.status === 10 || row.status === '10' || String(row.stage) === '91';
}

function previewFromNewRow(
  row: {
    lead_number?: string | null;
    name?: string | null;
    topic?: string | null;
    facts?: string | null;
    stage?: string | number | null;
    created_at?: string | null;
    handler?: string | null;
    case_handler_id?: unknown;
    status?: unknown;
    category?: string | null;
    unactivated_at?: unknown;
  },
  fallback: SmartScanLeadRef,
  extras: { handlerName: string | null; category: string | null },
): SmartScanLeadCasePreview {
  return {
    leadNumber: String(row.lead_number || fallback.leadNumber || '').trim(),
    name: String(row.name || fallback.name || '').trim() || 'Unknown',
    summary: clip(String(row.facts || row.topic || '')) || null,
    stage: row.stage == null ? null : String(row.stage),
    category: extras.category || String(row.category || '').trim() || null,
    inactive: isNewLeadInactive(row),
    handlerName: extras.handlerName || String(row.handler || '').trim() || null,
    createdAt: row.created_at || null,
  };
}

export async function fetchSmartScanLeadCasePreview(
  lead: SmartScanLeadRef,
): Promise<SmartScanLeadCasePreview> {
  await fetchStageNames().catch(() => undefined);
  const fallback: SmartScanLeadCasePreview = {
    leadNumber: lead.leadNumber,
    name: lead.name,
    summary: null,
    stage: null,
    category: null,
    inactive: false,
    handlerName: null,
    createdAt: null,
  };

  const id = String(lead.id || '').trim();
  const leadNumber = String(lead.leadNumber || '').trim();

  try {
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      const { data } = await supabase
        .from('leads')
        .select('lead_number, name, topic, facts, stage, created_at, case_handler_id, handler, status, category, category_id, unactivated_at')
        .eq('id', id)
        .maybeSingle();
      if (data) {
        const [handlerName, category] = await Promise.all([
          handlerNameForId(data.case_handler_id),
          categoryNameFor(data.category_id, data.category),
        ]);
        return previewFromNewRow(data, lead, { handlerName, category });
      }
    }

    if (leadNumber) {
      const { data } = await supabase
        .from('leads')
        .select('lead_number, name, topic, facts, stage, created_at, case_handler_id, handler, status, category, category_id, unactivated_at')
        .eq('lead_number', leadNumber)
        .maybeSingle();
      if (data) {
        const [handlerName, category] = await Promise.all([
          handlerNameForId(data.case_handler_id),
          categoryNameFor(data.category_id, data.category),
        ]);
        return previewFromNewRow(data, lead, { handlerName, category });
      }
    }

    const legacyId = id.startsWith('legacy_')
      ? Number.parseInt(id.replace(/^legacy_/, ''), 10)
      : /^\d+$/.test(id)
        ? Number.parseInt(id, 10)
        : /^\d+$/.test(leadNumber)
          ? Number.parseInt(leadNumber, 10)
          : NaN;

    if (Number.isFinite(legacyId)) {
      const { data } = await supabase
        .from('leads_lead')
        .select('lead_number, name, topic, description, stage, cdate, case_handler_id, status, category, category_id')
        .eq('id', legacyId)
        .maybeSingle();
      if (data) {
        const handlerName = await handlerNameForId(data.case_handler_id);
        const category = await categoryNameFor(data.category_id, data.category);
        return {
          leadNumber: String(data.lead_number || leadNumber || legacyId).trim(),
          name: String(data.name || lead.name || '').trim() || 'Unknown',
          summary: clip(String(data.description || data.topic || '')) || null,
          stage: data.stage == null ? null : String(data.stage),
          category,
          inactive: isLegacyLeadInactive(data),
          handlerName,
          createdAt: data.cdate || null,
        };
      }
    }
  } catch (error) {
    console.warn('Smart Scan lead preview failed:', error);
  }

  return fallback;
}
