/**
 * Synchronous language / category / source / topic labels for the Clients header.
 * Catalogs are module-cached so chips paint on the first frame instead of waiting
 * for per-mount dropdown fetches or a later lead refresh.
 */

import { supabase } from './supabase';
import {
  getSourceDisplayFromJoin,
  lookupSourceNameById,
  normalizeLeadSourceId,
} from './leadSourceId';
import { clientsTabCacheLeadKey, readClientsTabCache, writeClientsTabCache } from './clientsTabCache';

export type LeadLanguageRow = { id: number | string; name: string };
export type LeadCategoryRow = {
  id?: number | string | null;
  name?: string | null;
  misc_maincategory?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

export type LeadMetaChips = {
  language: string | null;
  source: string | null;
  category: string | null;
  topic: string | null;
};

type LeadMetaLike = {
  id?: string | number | null;
  lead_type?: string | null;
  language?: unknown;
  language_id?: unknown;
  misc_language?: unknown;
  category?: unknown;
  category_id?: unknown;
  misc_category?: unknown;
  source?: unknown;
  source_id?: unknown;
  misc_leadsource?: unknown;
  topic?: unknown;
} | null | undefined;

const resolvedMetaByLeadId = new Map<string, LeadMetaChips>();

let cachedLanguages: LeadLanguageRow[] | null = null;
let cachedLanguagesPromise: Promise<LeadLanguageRow[]> | null = null;

let cachedCategories: LeadCategoryRow[] | null = null;
let cachedCategoriesPromise: Promise<LeadCategoryRow[]> | null = null;

let hydratedFromSession = false;

function hydrateCatalogsFromSession(): void {
  if (hydratedFromSession || typeof window === 'undefined') return;
  hydratedFromSession = true;
  try {
    const raw = sessionStorage.getItem('clientsPage_backgroundData');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!cachedCategories && Array.isArray(data.categoryObjects) && data.categoryObjects.length > 0) {
      cachedCategories = data.categoryObjects;
    }
    if (!cachedLanguages && Array.isArray(data.languageObjects) && data.languageObjects.length > 0) {
      cachedLanguages = data.languageObjects.filter((row: LeadLanguageRow) => row?.name);
    }
  } catch {
    /* ignore */
  }
}

function joinRecord(join: unknown): Record<string, unknown> | null {
  if (!join) return null;
  const rec = Array.isArray(join) ? join[0] : join;
  if (!rec || typeof rec !== 'object') return null;
  return rec as Record<string, unknown>;
}

function trimName(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === '---' || s === '--' || s === 'null' || s === 'undefined') return null;
  return s;
}

/** True when a denormalized field is actually a numeric id, not a display name. */
export function looksLikeNumericId(value: unknown): boolean {
  const s = trimName(value);
  return !!s && /^\d+$/.test(s);
}

function idsEqual(a: unknown, b: unknown): boolean {
  const as = trimName(a);
  const bs = trimName(b);
  if (as == null || bs == null) return false;
  if (as === bs) return true;
  const an = Number(as);
  const bn = Number(bs);
  return Number.isFinite(an) && Number.isFinite(bn) && an === bn;
}

export function getLanguageDisplayFromJoin(lead: LeadMetaLike): string | null {
  const rec = joinRecord(lead?.misc_language);
  return rec ? trimName(rec.name) : null;
}

export function getCategoryDisplayFromJoin(lead: LeadMetaLike): string | null {
  const rec = joinRecord(lead?.misc_category);
  if (!rec) return null;
  const name = trimName(rec.name);
  if (!name) return null;
  const main = joinRecord(rec.misc_maincategory);
  const mainName = main ? trimName(main.name) : null;
  return mainName ? `${name} (${mainName})` : name;
}

export function lookupLanguageNameById(
  languageId: unknown,
  languages: Array<{ id?: unknown; name?: string | null }> | null | undefined,
): string | null {
  if (languageId == null || languageId === '' || !languages?.length) return null;
  const found = languages.find((row) => idsEqual(row.id, languageId));
  return found ? trimName(found.name) : null;
}

export function formatCategoryDisplayName(category: LeadCategoryRow | null | undefined): string | null {
  if (!category) return null;
  const name = trimName(category.name);
  if (!name) return null;
  const main = joinRecord(category.misc_maincategory);
  const mainName = main ? trimName(main.name) : null;
  return mainName ? `${name} (${mainName})` : name;
}

export function lookupCategoryDisplayById(
  categoryId: unknown,
  categories: LeadCategoryRow[] | null | undefined,
): string | null {
  if (categoryId == null || categoryId === '' || categoryId === '---' || !categories?.length) return null;
  const found = categories.find((row) => idsEqual(row.id, categoryId));
  return formatCategoryDisplayName(found);
}

export function resolveLeadLanguageName(
  lead: LeadMetaLike,
  languages?: Array<{ id?: unknown; name?: string | null }> | null,
): string | null {
  const fromJoin = getLanguageDisplayFromJoin(lead);
  if (fromJoin) return fromJoin;

  const raw = trimName(lead?.language);
  if (raw && !looksLikeNumericId(raw)) return raw;

  const languageId = lead?.language_id ?? (raw && looksLikeNumericId(raw) ? raw : null);
  return lookupLanguageNameById(languageId, languages);
}

export function resolveLeadCategoryName(
  lead: LeadMetaLike,
  categories?: LeadCategoryRow[] | null,
): string | null {
  const fromJoin = getCategoryDisplayFromJoin(lead);
  if (fromJoin) return fromJoin;

  const fromCatalog = lookupCategoryDisplayById(lead?.category_id, categories);
  if (fromCatalog) return fromCatalog;

  const raw = trimName(lead?.category);
  if (raw && !looksLikeNumericId(raw)) return raw;

  if (raw && looksLikeNumericId(raw)) {
    return lookupCategoryDisplayById(raw, categories);
  }
  return null;
}

export function resolveLeadSourceName(
  lead: LeadMetaLike,
  sources?: Array<{ id: string; name: string }> | null,
): string | null {
  const fromJoin = getSourceDisplayFromJoin(lead);
  if (fromJoin) return fromJoin;

  const raw = trimName(lead?.source);
  if (raw && !looksLikeNumericId(raw)) return raw;

  const sourceId =
    normalizeLeadSourceId(lead?.source_id) ??
    (raw && looksLikeNumericId(raw) ? normalizeLeadSourceId(raw) : null);
  if (sourceId && sources?.length) {
    return lookupSourceNameById(sourceId, sources);
  }
  return null;
}

export function resolveLeadTopic(lead: LeadMetaLike): string | null {
  return trimName(lead?.topic);
}

export function readResolvedLeadMeta(lead: LeadMetaLike): LeadMetaChips | null {
  const id = lead?.id != null ? String(lead.id) : null;
  if (id && resolvedMetaByLeadId.has(id)) return resolvedMetaByLeadId.get(id)!;
  const stored = readClientsTabCache<LeadMetaChips>(clientsTabCacheLeadKey(lead), 'meta');
  if (stored && id) resolvedMetaByLeadId.set(id, stored);
  return stored;
}

export function writeResolvedLeadMeta(lead: LeadMetaLike, chips: LeadMetaChips): void {
  const id = lead?.id != null ? String(lead.id) : null;
  if (!id) return;
  const prev: LeadMetaChips = resolvedMetaByLeadId.get(id) || {
    language: null,
    source: null,
    category: null,
    topic: null,
  };
  const next: LeadMetaChips = {
    language: chips.language || prev.language,
    source: chips.source || prev.source,
    category: chips.category || prev.category,
    topic: chips.topic || prev.topic,
  };
  resolvedMetaByLeadId.set(id, next);
  writeClientsTabCache(clientsTabCacheLeadKey(lead), 'meta', next);
}

export function resolveLeadMetaChips(
  lead: LeadMetaLike,
  catalogs?: {
    languages?: Array<{ id?: unknown; name?: string | null }> | null;
    categories?: LeadCategoryRow[] | null;
    sources?: Array<{ id: string; name: string }> | null;
  },
): LeadMetaChips {
  const cached = readResolvedLeadMeta(lead);
  const language = resolveLeadLanguageName(lead, catalogs?.languages) || cached?.language || null;
  const source = resolveLeadSourceName(lead, catalogs?.sources) || cached?.source || null;
  const category = resolveLeadCategoryName(lead, catalogs?.categories) || cached?.category || null;
  const topic = resolveLeadTopic(lead) || cached?.topic || null;
  return { language, source, category, topic };
}

export function getCachedLanguagesSync(): LeadLanguageRow[] {
  hydrateCatalogsFromSession();
  return cachedLanguages ?? [];
}

export function getCachedCategoriesSync(): LeadCategoryRow[] {
  hydrateCatalogsFromSession();
  return cachedCategories ?? [];
}

export function primeLeadLanguagesCache(rows: LeadLanguageRow[] | null | undefined): void {
  if (rows && rows.length > 0) cachedLanguages = rows.filter((row) => row?.name);
}

export function primeLeadCategoriesCache(rows: LeadCategoryRow[] | null | undefined): void {
  if (rows && rows.length > 0) cachedCategories = rows;
}

export async function ensureLeadLanguages(): Promise<LeadLanguageRow[]> {
  hydrateCatalogsFromSession();
  if (cachedLanguages && cachedLanguages.length > 0) return cachedLanguages;
  if (!cachedLanguagesPromise) {
    cachedLanguagesPromise = (async () => {
      const { data, error } = await supabase
        .from('misc_language')
        .select('id, name')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data || []).filter((row: LeadLanguageRow) => row?.name);
    })().catch((err) => {
      cachedLanguagesPromise = null;
      throw err;
    });
  }
  const rows = await cachedLanguagesPromise;
  cachedLanguages = rows;
  return rows;
}

export async function ensureLeadCategories(): Promise<LeadCategoryRow[]> {
  hydrateCatalogsFromSession();
  if (cachedCategories && cachedCategories.length > 0) return cachedCategories;
  if (!cachedCategoriesPromise) {
    cachedCategoriesPromise = (async () => {
      const { data, error } = await supabase
        .from('misc_category')
        .select(
          `
            id,
            name,
            parent_id,
            misc_maincategory!parent_id ( id, name )
          `,
        )
        .order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    })().catch((err) => {
      cachedCategoriesPromise = null;
      throw err;
    });
  }
  const rows = await cachedCategoriesPromise;
  cachedCategories = rows;
  return rows;
}
