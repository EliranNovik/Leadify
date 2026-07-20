import { supabase } from "./supabase";
import { generateSearchVariants } from "./transliteration";
import {
  buildPhoneSearchOrClause,
  looksLikePhoneSearchQuery,
  phoneDigitsMatch,
  phoneDigitsOnly,
} from "./phoneSearchUtils";

// -----------------------------------------------------
// Types
// -----------------------------------------------------

export interface CombinedLead {
  id: string;
  lead_number: string;
  manual_id?: string | null;
  name: string;
  email: string;
  phone: string;
  mobile: string;
  topic: string;
  stage: string;
  stage_colour?: string;
  source: string;
  created_at: string;
  updated_at: string;
  notes: string;
  special_notes: string;
  next_followup: string;
  probability: string;
  category: string;
  language: string;
  balance: string;
  lead_type: "legacy" | "new";
  matchType?: "exact" | "prefix" | "contains" | "fuzzy";
  unactivation_reason: string | null;
  deactivate_note: string | null;
  isFuzzyMatch: boolean;
  isContact?: boolean;
  contactName?: string;
  isMainContact?: boolean;
  contact_id?: string | null;
  portal_profile_image_path?: string | null;
  status?: number | string | null;
  /** Set when lead is a sublead (new: UUID, legacy: numeric master id) */
  master_id?: string | number | null;
  /** Set when lead is linked to a master via linked_master_lead column */
  linked_master_lead?: string | number | null;
  category_id?: number | string | null;
}

type SearchIntent =
  | { kind: "email"; email: string }
  | { kind: "lead"; raw: string; digits: string; hasPrefix: boolean; master: number | null; suffix: number | null }
  | { kind: "phone"; digits: string; raw: string }
  | { kind: "name"; raw: string; variants: string[] };

type SearchOptions = {
  limit?: number;
  contactsLimit?: number;
  leadsLimit?: number;
  legacyLimit?: number;
  timeoutMs?: number;
};

const DEFAULTS: Required<SearchOptions> = {
  limit: 40, // Reduced from 60 for faster queries
  contactsLimit: 30, // Reduced from 50 for faster queries
  leadsLimit: 25, // Reduced from 40 for faster queries
  legacyLimit: 25, // Reduced from 40 for faster queries
  timeoutMs: 2000, // Increased to 2s for better reliability, especially for lead number searches
};

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------

const normalize = (s: string) => s.trim();
const lower = (s: string) => s.trim().toLowerCase();
const digitsOnly = phoneDigitsOnly;
const looksLikeEmail = (s: string) => s.includes("@");
const hasLeadPrefix = (s: string) => /^[LC]/i.test(s.trim());
const stripLeadPrefix = (s: string) => s.trim().replace(/^[LC]/i, "");

/** Quote a PostgREST `.or()` filter value (needed for patterns like L1234%). */
function quoteFilterValue(value: string): string {
  return `"${String(value).replace(/"/g, '')}"`;
}

/**
 * Match legacy lead_number / manual_id whether stored bare ("1234") or with L/C prefix ("L1234").
 * digit-only header search must find L-prefixed values without typing the prefix.
 */
function buildLegacyLeadNumberOrFilter(
  searchDigits: string,
  mode: 'prefix' | 'exact',
): string {
  const digits = String(searchDigits || '').replace(/\D/g, '');
  if (!digits) return '';

  if (mode === 'exact') {
    return [
      `lead_number.eq.${quoteFilterValue(digits)}`,
      `lead_number.eq.${quoteFilterValue(`L${digits}`)}`,
      `lead_number.eq.${quoteFilterValue(`C${digits}`)}`,
      `lead_number.ilike.${quoteFilterValue(`${digits}/%`)}`,
      `lead_number.ilike.${quoteFilterValue(`L${digits}/%`)}`,
      `lead_number.ilike.${quoteFilterValue(`C${digits}/%`)}`,
      `manual_id.eq.${quoteFilterValue(digits)}`,
      `manual_id.eq.${quoteFilterValue(`L${digits}`)}`,
      `manual_id.eq.${quoteFilterValue(`C${digits}`)}`,
    ].join(',');
  }

  // Prefix + contains so "1234" matches "L1234", "C1234", "1234", "L12345", etc.
  return [
    `lead_number.ilike.${quoteFilterValue(`${digits}%`)}`,
    `lead_number.ilike.${quoteFilterValue(`L${digits}%`)}`,
    `lead_number.ilike.${quoteFilterValue(`C${digits}%`)}`,
    `lead_number.ilike.${quoteFilterValue(`%${digits}%`)}`,
    `manual_id.ilike.${quoteFilterValue(`${digits}%`)}`,
    `manual_id.ilike.${quoteFilterValue(`L${digits}%`)}`,
    `manual_id.ilike.${quoteFilterValue(`C${digits}%`)}`,
    `manual_id.ilike.${quoteFilterValue(`%${digits}%`)}`,
  ].join(',');
}

function parseSubLead(raw: string): { master: number | null; suffix: number | null } {
  const t = raw.trim();
  if (!t.includes("/")) return { master: null, suffix: null };
  const parts = t.split("/");
  if (parts.length !== 2) return { master: null, suffix: null };
  const masterPart = parts[0].replace(/^[LC]/i, "");
  const suffixPart = parts[1];
  const master = parseInt(masterPart, 10);
  const suffix = parseInt(suffixPart, 10);
  if (Number.isNaN(master) || Number.isNaN(suffix)) return { master: null, suffix: null };
  return { master, suffix };
}

/**
 * Phone pattern builder — matches common Israeli/international prefix variants.
 * Short queries (e.g. 052, 50, 972) use contains; longer queries also match suffixes.
 */
function buildPhoneOr(digits: string, rawQuery?: string): string {
  return buildPhoneSearchOrClause(digits, rawQuery);
}

/**
 * Pure digit lead searches (no L/C, no sub-lead) of 7+ digits should also query phones,
 * so users can find numbers without typing the 052 / +972 prefix.
 */
function shouldAlsoSearchPhoneForLeadQuery(
  intent: Extract<SearchIntent, { kind: "lead" }>,
): boolean {
  if (intent.hasPrefix) return false;
  if (intent.raw.includes("/")) return false;
  const d = digitsOnly(intent.digits);
  if (!/^\d+$/.test(d)) return false;
  return d.length >= 7;
}

function mergeRowsById<T extends { id?: string | number | null }>(primary: T[], extra: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of [...primary, ...extra]) {
    if (row?.id == null) continue;
    const key = String(row.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Decide intent with stable rules and minimal ambiguity.
 */
function detectIntent(query: string): SearchIntent | null {
  const raw = normalize(query);
  if (!raw) return null;

  if (looksLikeEmail(raw)) {
    return { kind: "email", email: lower(raw) };
  }

  const d = digitsOnly(raw);
  const hasPrefix = hasLeadPrefix(raw);
  const rawNoPrefix = stripLeadPrefix(raw);

  const { master, suffix } = parseSubLead(raw);

  // Lead intent triggers:
  // - explicit prefix L/C
  // - contains "/" (sub-lead)
  // - short pure digit numbers (3–6) — prefer lead_number over phone so 4-digit
  //   legacy ids and numbers starting with 5 are not diverted to phone search
  // Longer pure digits (7+) without a leading 0 may still be lead numbers, but we
  // also run phone search (see shouldAlsoSearchPhoneForLeadQuery) so users can find
  // numbers without typing 052 / +972.
  const isPureNumeric = rawNoPrefix.length > 0 && /^\d+$/.test(rawNoPrefix) && rawNoPrefix === d;
  const startsWithZero = d.startsWith("0") && d.length >= 3;
  const isInternationalPhone =
    d.startsWith("972") || d.startsWith("00972");
  // Prefer phone for local mobiles typed without the leading 0 (52xxxxxxx).
  const isLocalMobileWithoutZero = d.startsWith("5") && d.length >= 8 && d.length <= 10;
  const isLikelyLeadNumber =
    isPureNumeric &&
    d.length >= 3 &&
    d.length <= 10 &&
    !startsWithZero &&
    !isInternationalPhone &&
    !isLocalMobileWithoutZero;

  const leadLike = hasPrefix || raw.includes("/") || isLikelyLeadNumber;

  if (leadLike) {
    return { kind: "lead", raw, digits: rawNoPrefix, hasPrefix, master, suffix };
  }

  if (looksLikePhoneSearchQuery(raw)) {
    return { kind: "phone", digits: d, raw };
  }

  // Phone intent triggers (fallback for formatted numbers):
  const formatted = raw.length > d.length;
  const phoneLike = formatted && d.length >= 4;

  if (phoneLike) {
    return { kind: "phone", digits: d, raw };
  }

  // Default name intent
  const variants = generateSearchVariants(raw).map((v) => v.trim().toLowerCase()).filter(Boolean);
  const uniqVariants = Array.from(new Set(variants.length ? variants : [lower(raw)]));
  return { kind: "name", raw, variants: uniqVariants };
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]) as Promise<T>;
}

// -----------------------------------------------------
// Query functions (small and predictable)
// -----------------------------------------------------

const NEW_LEAD_CATEGORY_JOIN =
  "category_id, misc_category!category_id(id, name, parent_id, misc_maincategory!parent_id(id, name))";

const LEGACY_LEAD_CATEGORY_JOIN =
  "category_id, misc_category!leads_lead_category_id_fkey(id, name, parent_id, misc_maincategory!parent_id(id, name))";

const NEW_LEAD_SEARCH_SELECT = `id, lead_number, name, email, phone, mobile, topic, stage, created_at, status, master_id, linked_master_lead, ${NEW_LEAD_CATEGORY_JOIN}`;

const LEGACY_LEAD_SEARCH_SELECT = `id, name, email, phone, mobile, topic, stage, cdate, master_id, status, lead_number, manual_id, linked_master_lead, ${LEGACY_LEAD_CATEGORY_JOIN}`;

function formatLeadCategoryFromRow(row: any): string {
  const categoryJoin = Array.isArray(row?.misc_category) ? row.misc_category[0] : row?.misc_category;
  if (categoryJoin?.name) {
    const mainRel = categoryJoin.misc_maincategory;
    const mainCategory = Array.isArray(mainRel) ? mainRel[0]?.name : mainRel?.name;
    return mainCategory ? `${categoryJoin.name} (${mainCategory})` : categoryJoin.name;
  }
  return row?.category || "";
}

async function searchNewLeads(intent: SearchIntent, opts: Required<SearchOptions>): Promise<any[]> {
  const queryStartTime = performance.now();
  const selectFields = NEW_LEAD_SEARCH_SELECT;

  let qb = supabase.from("leads").select(selectFields);

  if (intent.kind === "lead") {
    // If searching for a specific sublead (both master and suffix provided), search for exact formatted lead_number
    if (intent.master != null && intent.suffix != null && !Number.isNaN(intent.master) && !Number.isNaN(intent.suffix)) {
      // Search for exact sublead format: "master/suffix" or "Lmaster/suffix" or "Cmaster/suffix"
      const subleadPatterns = [
        `${intent.master}/${intent.suffix}`,
        `L${intent.master}/${intent.suffix}`,
        `C${intent.master}/${intent.suffix}`,
      ];
      qb = qb.or(subleadPatterns.map(p => `lead_number.ilike.${p}`).join(","));
    } else {
      // Regular lead number search
      const searchDigits = intent.digits || stripLeadPrefix(intent.raw);

      // For 4-5 digit searches, use both exact and prefix matching to allow finding longer leads
      // For 6 digit searches, use exact match only to avoid partial matches
      // Example: searching "212421" should NOT match "21242", but "11234" should find "112345"
      const isSixDigitQuery = searchDigits.length === 6 && /^\d+$/.test(searchDigits);
      const isFourOrFiveDigitQuery = searchDigits.length >= 4 && searchDigits.length <= 5 && /^\d+$/.test(searchDigits);
      const isLongLeadNumberQuery =
        searchDigits.length >= 7 && searchDigits.length <= 10 && /^\d+$/.test(searchDigits);

      if (isSixDigitQuery || isLongLeadNumberQuery) {
        // For 6-digit queries, match the lead itself exactly AND any sublead of that master
        // (e.g. typing "209994" must also surface "L209994/2", "C209994/3", "209994/4" — these
        // would have been visible while the user was still typing "20999" via the L20999% prefix
        // pattern and would otherwise vanish on the final digit).
        // We still avoid bare prefix matches like "209994%" so unrelated 7-digit lead numbers
        // like "2099940" don't bleed in.
        const exactPatterns = [
          `lead_number.eq.L${searchDigits}`,
          `lead_number.eq.C${searchDigits}`,
          `lead_number.eq.${searchDigits}`, // Also try without prefix for legacy compatibility
          `lead_number.ilike.L${searchDigits}/%`,
          `lead_number.ilike.C${searchDigits}/%`,
          `lead_number.ilike.${searchDigits}/%`,
        ];

        const baseOr = exactPatterns.join(",");
        qb = qb.or(baseOr);
      } else if (isFourOrFiveDigitQuery) {
        // For 4-5 digit queries, use both exact and prefix matching
        // This allows "11234" to find "112345" while still finding exact matches
        const searchPatterns: string[] = [
          `lead_number.eq.L${searchDigits}`, // Exact match with L prefix
          `lead_number.eq.C${searchDigits}`, // Exact match with C prefix
          `lead_number.ilike.${searchDigits}%`, // Prefix match without prefix
          `lead_number.ilike.L${searchDigits}%`, // Prefix match with L prefix
          `lead_number.ilike.C${searchDigits}%`, // Prefix match with C prefix
        ];

        const baseOr = searchPatterns.join(",");
        qb = qb.or(baseOr);
      } else {
        // For shorter queries (1-3 digits), use prefix matching
        const searchPatterns: string[] = [
          `lead_number.ilike.${searchDigits}%`,
          `lead_number.ilike.L${searchDigits}%`,
          `lead_number.ilike.C${searchDigits}%`,
        ];

        const baseOr = searchPatterns.join(",");
        qb = qb.or(baseOr);
      }

      // sub-lead: also match master/xxx (when only master is provided, not specific suffix)
      if (intent.master != null) {
        qb = qb.or(
          [
            `lead_number.ilike.%${intent.master}/%`,
            `lead_number.ilike.L%${intent.master}/%`,
            `lead_number.ilike.C%${intent.master}/%`,
          ].join(","),
        );
      }
    }
  } else if (intent.kind === "email") {
    qb = qb.ilike("email", `${intent.email}%`);
  } else if (intent.kind === "phone") {
    const cond = buildPhoneOr(intent.digits, intent.raw);
    if (!cond) return [];
    qb = qb.or(cond);
  } else if (intent.kind === "name") {
    // Starts-with is fast and avoids scanning everything
    if (intent.variants.length > 1) {
      qb = qb.or(intent.variants.map((v) => `name.ilike.${v}%`).join(","));
    } else {
      qb = qb.ilike("name", `${intent.variants[0]}%`);
    }
  }

  const executeStartTime = performance.now();
  // Use longer timeout for lead searches (they can be more complex)
  const timeoutForLeadSearch = intent.kind === "lead" ? opts.timeoutMs * 1.5 : opts.timeoutMs;
  const { data, error } = await withTimeout(qb.limit(opts.leadsLimit), timeoutForLeadSearch, "new leads search timeout").catch(
    (err) => {
      // Return empty array instead of throwing to allow search to continue
      return { data: [], error: err };
    },
  );
  const executeTime = performance.now() - executeStartTime;

  if (error) {
    // Don't throw - return empty array to allow other search paths to continue
    return [];
  }

  if (!data) {
    return [];
  }

  return data;
}

async function searchLegacyLeads(intent: SearchIntent, opts: Required<SearchOptions>): Promise<any[]> {
  if (intent.kind === "lead") return [];

  let qb = supabase.from("leads_lead").select(LEGACY_LEAD_SEARCH_SELECT);

  if (intent.kind === "email") {
    qb = qb.ilike("email", `${intent.email}%`);
  } else if (intent.kind === "phone") {
    const cond = buildPhoneOr(intent.digits, intent.raw);
    if (!cond) return [];
    qb = qb.or(cond);
  } else if (intent.kind === "name") {
    const numericOnly = /^\d+$/.test(intent.raw.trim());
    if (numericOnly) {
      const digits = intent.raw.trim();
      const leadNumberOr = buildLegacyLeadNumberOrFilter(digits, 'prefix');
      qb = qb.or(
        [
          leadNumberOr,
          `name.ilike.${quoteFilterValue(`${digits}%`)}`,
        ].filter(Boolean).join(","),
      );
    } else if (intent.variants.length > 1) {
      qb = qb.or(intent.variants.map((v) => `name.ilike.${v}%`).join(","));
    } else {
      qb = qb.ilike("name", `${intent.variants[0]}%`);
    }
  }

  const { data, error } = await withTimeout(qb.limit(opts.legacyLimit), opts.timeoutMs, "legacy leads search timeout").catch(
    (err) => {
      return { data: [], error: err };
    },
  );

  if (error || !data) return [];
  return data;
}

async function searchContacts(intent: SearchIntent, opts: Required<SearchOptions>): Promise<any[]> {
  const queryStartTime = performance.now();
  // For very short name searches, contacts search is expensive and noisy.
  if (intent.kind === "name" && intent.raw.trim().length < 2) {
    return [];
  }

  let qb = supabase.from("leads_contact").select("id, name, email, phone, mobile, newlead_id, portal_profile_image_path");

  if (intent.kind === "email") {
    // Use prefix matching instead of contains to avoid matching middle of emails
    // This prevents matches like "john123@example.com" when searching "john@example.com"
    qb = qb.ilike("email", `${intent.email}%`);
  } else if (intent.kind === "phone") {
    const cond = buildPhoneOr(intent.digits, intent.raw);
    if (!cond) return [];
    qb = qb.or(cond);
  } else if (intent.kind === "name") {
    if (intent.variants.length > 1) {
      qb = qb.or(intent.variants.map((v) => `name.ilike.%${v}%`).join(","));
    } else {
      qb = qb.ilike("name", `%${intent.variants[0]}%`);
    }
  } else if (intent.kind === "lead") {
    // When searching by lead number, contacts are obtained via junction,
    // so here we return empty and do the junction-based flow.
    return [];
  }

  const executeStartTime = performance.now();
  const { data, error } = await withTimeout(qb.limit(opts.contactsLimit), opts.timeoutMs, "contacts search timeout").catch(
    (err) => {
      return { data: [], error: err };
    },
  );
  const executeTime = performance.now() - executeStartTime;

  if (error) {
    return [];
  }

  if (!data) {
    return [];
  }

  return data;
}

/**
 * Junction-based contact discovery when lead number is searched.
 * Finds contact ids linked to new leads and legacy leads.
 */
async function findContactsForLeadSearch(
  leadIntent: Extract<SearchIntent, { kind: "lead" }>,
  newLeadRows: any[],
  opts: Required<SearchOptions>,
): Promise<{ rels: any[]; contacts: any[]; legacyLeads: any[] }> {
  const rels: any[] = [];
  const contacts: any[] = [];
  const legacyLeads: any[] = [];

  const newLeadIds = newLeadRows.map((l) => l.id).filter(Boolean);

  // legacy: try exact id only for 1-6 digits (including 4-digit queries)
  const legacyExactId = (() => {
    const base = leadIntent.master != null ? String(leadIntent.master) : stripLeadPrefix(leadIntent.raw).split("/")[0];
    if (!base) return null;
    if (!/^\d+$/.test(base)) return null;
    // Allow 1-10 digit lead numbers (legacy ids and lead_number values can exceed 6 digits)
    if (base.length < 1 || base.length > 10) return null;
    const parsed = parseInt(base, 10);
    if (Number.isNaN(parsed)) return null;
    return parsed;
  })();

  // If searching for a sublead (both master and suffix provided), find the specific sublead
  if (leadIntent.master != null && leadIntent.suffix != null && !Number.isNaN(leadIntent.master) && !Number.isNaN(leadIntent.suffix)) {
    // Fetch all subleads with this master_id
    const { data: subleads } = await withTimeout(
      supabase
        .from("leads_lead")
        .select(LEGACY_LEAD_SEARCH_SELECT)
        .eq("master_id", leadIntent.master)
        .not("master_id", "is", null)
        .order("id", { ascending: true }),
      opts.timeoutMs,
      "legacy sublead search timeout",
    ).catch(() => ({ data: [] as any[] }));

    if (subleads && subleads.length > 0) {
      // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
      // So suffix 4 means it's the 3rd sublead (index 2)
      const targetIndex = leadIntent.suffix - 2;
      if (targetIndex >= 0 && targetIndex < subleads.length) {
        const targetSublead = subleads[targetIndex];
        legacyLeads.push(targetSublead);
      }
    }
  } else if (legacyExactId != null && !Number.isNaN(legacyExactId) && (leadIntent.master == null || leadIntent.suffix == null)) {
    // For 1-5 digit queries, search by lead_number prefix (not just exact ID)
    // For 6 digit queries, search by lead_number exact match
    // This allows "11" to find "1123" and "11234" to find "112345", and "183221" to find "183221"
    const searchDigits = leadIntent.digits || stripLeadPrefix(leadIntent.raw);
    const isPrefixQuery = searchDigits.length >= 1 && searchDigits.length <= 5;
    const isSixDigitQuery = searchDigits.length === 6 && /^\d+$/.test(searchDigits);
    const isLongLeadNumberQuery =
      searchDigits.length >= 7 && searchDigits.length <= 10 && /^\d+$/.test(searchDigits);

    if (isPrefixQuery) {
      // Search by lead_number / manual_id for 1-5 digit queries, including L/C-prefixed values
      // (legacy lead_number is often stored as "L1234" — bare digits must still match).
      const prefixOr = buildLegacyLeadNumberOrFilter(searchDigits, 'prefix');
      const { data: prefixData, error: prefixError } = await withTimeout(
        supabase
          .from("leads_lead")
          .select(LEGACY_LEAD_SEARCH_SELECT)
          .or(prefixOr)
          .limit(30),
        opts.timeoutMs,
        "legacy prefix search timeout",
      ).catch((err) => {
        console.warn('[legacyLeadsApi] legacy prefix search failed:', err?.message || err);
        return { data: [] as any[], error: err };
      });

      if (prefixError) {
        console.warn('[legacyLeadsApi] legacy prefix search error:', prefixError);
      }

      if (prefixData && prefixData.length) {
        legacyLeads.push(...prefixData);
      }
    } else if (isSixDigitQuery) {
      // For 6-digit queries, match the exact master lead AND any of its subleads (e.g.
      // "L209994/2"). Without the sublead patterns, typing the 6th digit can make a sublead
      // that was visible during the 5-digit prefix search disappear entirely.
      const exactOrSublead = buildLegacyLeadNumberOrFilter(searchDigits, 'exact');
      const { data: exactLeadNumberData } = await withTimeout(
        supabase
          .from("leads_lead")
          .select(LEGACY_LEAD_SEARCH_SELECT)
          .or(exactOrSublead)
          .limit(30),
        opts.timeoutMs,
        "legacy 6-digit lead_number search timeout",
      ).catch((err) => {
        console.warn('[legacyLeadsApi] legacy 6-digit search failed:', err?.message || err);
        return { data: [] as any[] };
      });

      if (exactLeadNumberData && exactLeadNumberData.length) {
        legacyLeads.push(...exactLeadNumberData);
      }
    } else if (isLongLeadNumberQuery) {
      const exactOrSublead = buildLegacyLeadNumberOrFilter(searchDigits, 'exact');
      const { data: longLeadNumberData } = await withTimeout(
        supabase
          .from("leads_lead")
          .select(LEGACY_LEAD_SEARCH_SELECT)
          .or(exactOrSublead)
          .limit(30),
        opts.timeoutMs,
        "legacy long lead_number search timeout",
      ).catch((err) => {
        console.warn('[legacyLeadsApi] legacy long lead_number search failed:', err?.message || err);
        return { data: [] as any[] };
      });

      if (longLeadNumberData && longLeadNumberData.length) {
        legacyLeads.push(...longLeadNumberData);
      }
    }

    // Also try exact ID match (for cases where ID matches the query).
    // IMPORTANT: include lead_number in the select so the dropdown can show the actual lead number
    // (the row's id and its lead_number column are NOT guaranteed to be the same value).
    const { data } = await withTimeout(
      supabase
        .from("leads_lead")
        .select(LEGACY_LEAD_SEARCH_SELECT)
        .eq("id", legacyExactId)
        .limit(1),
      opts.timeoutMs,
      "legacy exact search timeout",
    ).catch(() => ({ data: [] as any[] }));

    if (data && data.length) {
      // Avoid duplicates
      const existingIds = new Set(legacyLeads.map(l => l.id));
      data.forEach(l => {
        if (!existingIds.has(l.id)) {
          legacyLeads.push(l);
        }
      });
    }
  }

  // Junction queries
  const junctionQueries: Promise<any>[] = [];

  if (newLeadIds.length) {
    junctionQueries.push(
      supabase
        .from("lead_leadcontact")
        .select("contact_id, newlead_id, lead_id, main")
        .in("newlead_id", newLeadIds)
        .limit(150) // Reduced from 250 for faster queries
        .then((result) => result)
    );
  }

  // If legacy lead exact found, pull its contacts as well
  if (legacyLeads.length) {
    const legacyIds = legacyLeads.map((l) => l.id);
    junctionQueries.push(
      supabase
        .from("lead_leadcontact")
        .select("contact_id, newlead_id, lead_id, main")
        .in("lead_id", legacyIds)
        .limit(150) // Reduced from 250 for faster queries
        .then((result) => result)
    );
  }

  // Use allSettled to continue even if some junction queries fail
  const junctionResults = await Promise.allSettled(junctionQueries);

  junctionResults.forEach((result) => {
    if (result.status === 'fulfilled') {
      const r = result.value;
      if (r?.data) {
        rels.push(...r.data);
      }
    }
  });

  const contactIds = Array.from(new Set(rels.map((x) => x.contact_id).filter(Boolean)));

  if (contactIds.length) {
    const { data, error } = await withTimeout(
      supabase.from("leads_contact").select("id, name, email, phone, mobile, newlead_id, portal_profile_image_path").in("id", contactIds).limit(opts.contactsLimit),
      opts.timeoutMs,
      "contacts fetch for lead search timeout",
    ).catch((err) => {
      return { data: [] as any[], error: err };
    });

    if (data) contacts.push(...data);
  }

  return { rels, contacts, legacyLeads };
}

async function fetchNewLeadsByIds(ids: string[], opts: Required<SearchOptions>): Promise<any[]> {
  if (!ids.length) return [];

  const fetchStartTime = performance.now();
  const { data, error } = await withTimeout(
    supabase
      .from("leads")
      .select(NEW_LEAD_SEARCH_SELECT)
      .in("id", ids)
      .limit(opts.leadsLimit),
    opts.timeoutMs,
    "fetch new leads by ids timeout",
  ).catch((err) => {
    return { data: [], error: err };
  });
  const fetchTime = performance.now() - fetchStartTime;

  if (error) {
    return [];
  }

  if (!data) {
    return [];
  }

  return data;
}

async function fetchLegacyLeadsByIds(ids: number[], opts: Required<SearchOptions>): Promise<any[]> {
  if (!ids.length) return [];

  const fetchStartTime = performance.now();
  const { data, error } = await withTimeout(
    // lead_number must be selected so the dropdown can display the real number (e.g. "209994")
    // instead of falling back to the row's primary key id (e.g. "20999").
    supabase
      .from("leads_lead")
      .select(LEGACY_LEAD_SEARCH_SELECT)
      .in("id", ids)
      .limit(opts.legacyLimit),
    opts.timeoutMs,
    "fetch legacy leads by ids timeout",
  ).catch((err) => {
    return { data: [], error: err };
  });
  const fetchTime = performance.now() - fetchStartTime;

  if (error) {
    return [];
  }

  if (!data) {
    return [];
  }

  return data;
}

function applyContactFieldsToResult(r: CombinedLead, c: any, options?: { isContact?: boolean; isMainContact?: boolean }) {
  if (options?.isContact != null) r.isContact = options.isContact;
  if (options?.isMainContact != null) r.isMainContact = options.isMainContact;
  if (c?.id != null) r.contact_id = String(c.id);
  if (c?.name) r.contactName = c.name;
  const profilePath = c?.portal_profile_image_path?.trim();
  if (profilePath) r.portal_profile_image_path = profilePath;
}

export async function enrichLeadContactSearchProfiles(results: CombinedLead[]): Promise<CombinedLead[]> {
  const missing = results.filter((r) => !r.portal_profile_image_path?.trim());
  if (!missing.length) return results;

  const newLeadIds = Array.from(new Set(missing.filter((r) => r.lead_type === "new").map((r) => r.id)));
  const legacyLeadIds = Array.from(
    new Set(
      missing
        .filter((r) => r.lead_type === "legacy")
        .map((r) => Number(r.id))
        .filter((id) => !Number.isNaN(id)),
    ),
  );

  const profileByNewLead = new Map<string, { main: boolean; path: string }>();
  const profileByLegacyLead = new Map<number, { main: boolean; path: string }>();

  const pickProfile = <T extends string | number>(
    map: Map<T, { main: boolean; path: string }>,
    key: T,
    path: string,
    isMain: boolean,
  ) => {
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { main: isMain, path });
      return;
    }
    if (isMain && !existing.main) {
      map.set(key, { main: true, path });
    }
  };

  if (newLeadIds.length) {
    const { data } = await supabase
      .from("lead_leadcontact")
      .select("newlead_id, main, leads_contact (portal_profile_image_path)")
      .in("newlead_id", newLeadIds);

    (data || []).forEach((row: any) => {
      const path = row?.leads_contact?.portal_profile_image_path?.trim();
      if (!path || !row?.newlead_id) return;
      pickProfile(profileByNewLead, String(row.newlead_id), path, row.main === true || row.main === "true");
    });
  }

  if (legacyLeadIds.length) {
    const { data } = await supabase
      .from("lead_leadcontact")
      .select("lead_id, main, leads_contact (portal_profile_image_path)")
      .in("lead_id", legacyLeadIds);

    (data || []).forEach((row: any) => {
      const path = row?.leads_contact?.portal_profile_image_path?.trim();
      if (!path || row?.lead_id == null) return;
      pickProfile(profileByLegacyLead, Number(row.lead_id), path, row.main === true || row.main === "true");
    });
  }

  return results.map((result) => {
    if (result.portal_profile_image_path?.trim()) return result;

    const picked =
      result.lead_type === "new"
        ? profileByNewLead.get(result.id)
        : profileByLegacyLead.get(Number(result.id));

    if (!picked?.path) return result;
    return { ...result, portal_profile_image_path: picked.path };
  });
}

// -----------------------------------------------------
// Mapping and ranking
// -----------------------------------------------------

function mapNewLeadRow(row: any): CombinedLead {
  return {
    id: String(row.id),
    lead_number: row.lead_number || "",
    manual_id: row.manual_id ?? row.lead_number ?? null,
    name: row.name || "",
    email: row.email || "",
    phone: row.phone || "",
    mobile: row.mobile || "",
    topic: row.topic || "",
    stage: String(row.stage ?? ""),
    source: "",
    created_at: row.created_at || "",
    updated_at: row.created_at || "",
    notes: "",
    special_notes: "",
    next_followup: "",
    probability: "",
    category: formatLeadCategoryFromRow(row),
    category_id: row.category_id ?? null,
    language: "",
    balance: "",
    lead_type: "new",
    unactivation_reason: null,
    deactivate_note: null,
    isFuzzyMatch: false,
    status: row.status ?? null,
    master_id: row.master_id ?? null,
    linked_master_lead: row.linked_master_lead ?? null,
  };
}

function mapLegacyLeadRow(row: any, formattedLeadNumber?: string): CombinedLead {
  // Use provided formatted lead_number if available, otherwise format it.
  // For master leads we must prefer the real `lead_number` column over `String(row.id)`:
  // those values can diverge (e.g. id=20999 with lead_number="209994") which caused the
  // search dropdown to display the id while the user typed/matched on the lead_number.
  const rawLeadNumberFromRow = (row.lead_number ?? row.manual_id ?? '').toString().trim();
  const leadNumber =
    formattedLeadNumber ||
    (row.master_id
      ? `${row.master_id}`
      : (rawLeadNumberFromRow || String(row.id)));
  const manualIdFromRow =
    row.manual_id != null && String(row.manual_id).trim() !== ''
      ? String(row.manual_id).trim()
      : leadNumber.includes('/')
        ? leadNumber.split('/')[0]
        : rawLeadNumberFromRow || null;
  return {
    id: String(row.id),
    lead_number: leadNumber,
    manual_id: manualIdFromRow,
    name: row.name || "",
    email: row.email || "",
    phone: row.phone || "",
    mobile: row.mobile || "",
    topic: row.topic || "",
    stage: String(row.stage ?? ""),
    source: "",
    created_at: row.cdate || "",
    updated_at: row.cdate || "",
    notes: "",
    special_notes: "",
    next_followup: "",
    probability: "",
    category: formatLeadCategoryFromRow(row),
    category_id: row.category_id ?? null,
    language: "",
    balance: "",
    lead_type: "legacy",
    unactivation_reason: null,
    deactivate_note: null,
    isFuzzyMatch: false,
    status: row.status ?? null,
    master_id: row.master_id ?? null,
    linked_master_lead: row.linked_master_lead ?? null,
  };
}

function scoreResult(intent: SearchIntent, r: CombinedLead): number {
  // Higher score = better
  const qRaw = intent.kind === "email" ? intent.email : lower(intent.kind === "phone" ? intent.raw : intent.raw);
  const qDigits = intent.kind === "phone" ? digitsOnly(intent.digits) : digitsOnly(intent.kind === "lead" ? intent.digits : "");
  const name = lower(r.contactName || r.name || "");
  const email = lower(r.email || "");
  const phone = digitsOnly(r.phone || "");
  const mobile = digitsOnly(r.mobile || "");
  const leadNum = lower(String(r.lead_number || ""));

  let s = 0;

  // Base: prefer lead itself over contact entry
  if (!r.isContact) s += 5;
  if (r.isMainContact) s += 2;

  // Intent-specific scoring
  // For email: only exact matches or starts-with matches count as high scores
  // Contains matches (middle of email) are too lenient and create false direct matches
  if (intent.kind === "email") {
    if (email === qRaw) s += 100;
    else if (email.startsWith(qRaw)) s += 70;
    // Removed includes() check - it was too lenient and matched emails with different letters/numbers
  } else if (intent.kind === "lead") {
    const q = lower(intent.raw);
    const qNoPrefix = lower(stripLeadPrefix(intent.raw));
    const leadNumNoPrefix = lower(stripLeadPrefix(String(r.lead_number || "")));
    if (leadNum === q || leadNum === qNoPrefix || leadNumNoPrefix === qNoPrefix) s += 100;
    else if (leadNum.startsWith(q) || leadNum.startsWith(qNoPrefix) || leadNumNoPrefix.startsWith(qNoPrefix)) s += 70;
    else if (leadNum.includes(qNoPrefix) || leadNumNoPrefix.includes(qNoPrefix)) s += 40;

    // Digit queries without L/C may be phones typed without 052 / +972 — boost phone hits.
    if (
      !intent.hasPrefix &&
      !intent.raw.includes("/") &&
      qDigits.length >= 7 &&
      (phoneDigitsMatch(r.phone || "", qDigits) || phoneDigitsMatch(r.mobile || "", qDigits))
    ) {
      const pd = digitsOnly(r.phone || "");
      const md = digitsOnly(r.mobile || "");
      if (pd === qDigits || md === qDigits) s = Math.max(s, 100);
      else if (pd.endsWith(qDigits) || md.endsWith(qDigits) || qDigits.endsWith(pd) || qDigits.endsWith(md)) {
        s = Math.max(s, 70);
      } else {
        s = Math.max(s, 55);
      }
    }
  } else if (intent.kind === "phone") {
    if (qDigits && (phoneDigitsMatch(r.phone || "", qDigits) || phoneDigitsMatch(r.mobile || "", qDigits))) {
      const pd = digitsOnly(r.phone || "");
      const md = digitsOnly(r.mobile || "");
      if (pd === qDigits || md === qDigits) s += 100;
      else if (pd.endsWith(qDigits) || md.endsWith(qDigits) || qDigits.endsWith(pd) || qDigits.endsWith(md)) s += 70;
      else s += 40;
    }
  } else {
    const q = lower(intent.raw);
    if (name === q) s += 80;
    else if (name.startsWith(q)) s += 55;
    else if (name.includes(q)) s += 35;
  }

  // Slight prefer newer leads if tie
  const t = Date.parse(r.created_at || "") || 0;
  s += Math.min(10, Math.floor(t / 1e12)); // tiny stable bias

  return s;
}

function markFuzzy(intent: SearchIntent, r: CombinedLead): boolean {
  // Fuzzy means "not exact and not a clean prefix"
  const q = lower(intent.kind === "email" ? intent.email : intent.raw);
  const nm = lower(r.contactName || r.name || "");
  const em = lower(r.email || "");
  const ld = lower(String(r.lead_number || ""));
  const qDigits = digitsOnly(intent.kind === "phone" ? intent.digits : intent.kind === "lead" ? intent.digits : "");
  const pd = digitsOnly(r.phone || "");
  const md = digitsOnly(r.mobile || "");

  // For email: mark as fuzzy if not exact match or starts-with match
  // Removed includes() check - it was too lenient
  if (intent.kind === "email") return !(em === q || em.startsWith(q));
  if (intent.kind === "lead") {
    const qNo = lower(stripLeadPrefix(intent.raw));
    const ldNo = lower(stripLeadPrefix(String(r.lead_number || "")));
    const leadExact =
      ld === q || ld === qNo || ld.startsWith(qNo) || ldNo === qNo || ldNo.startsWith(qNo);
    if (leadExact) return false;
    if (
      !intent.hasPrefix &&
      !intent.raw.includes("/") &&
      qDigits.length >= 7 &&
      (phoneDigitsMatch(r.phone || "", qDigits) || phoneDigitsMatch(r.mobile || "", qDigits))
    ) {
      return false;
    }
    return true;
  }
  if (intent.kind === "phone") {
    return !(qDigits && (phoneDigitsMatch(r.phone || "", qDigits) || phoneDigitsMatch(r.mobile || "", qDigits)));
  }
  return !(nm === q || nm.startsWith(q));
}

// -----------------------------------------------------
// Main Search (public)
// -----------------------------------------------------

export async function searchLeads(query: string, options: SearchOptions = {}): Promise<CombinedLead[]> {
  const opts = { ...DEFAULTS, ...options };

  try {
    const intent = detectIntent(query);

    if (!intent) {
      return [];
    }

    // Very short queries: return only fast new lead prefix matches
    if (intent.kind === "name" && intent.raw.trim().length < 2) {
      const rows = await searchNewLeads(intent, opts);
      const mapped = rows.map(mapNewLeadRow);
      mapped.forEach((r) => (r.isFuzzyMatch = markFuzzy(intent, r)));
      return mapped.slice(0, opts.limit);
    }

    // 1) Search new leads (always) - parallelize with contacts for non-lead searches
    let newRows: any[];
    let contactRows: any[] = [];
    let rels: any[] = [];
    let legacyDirectRows: any[] = [];
    let alsoPhoneSearch = false;

    if (intent.kind === "lead") {
      // For lead search: search new leads first, then get contacts via junction
      try {
        newRows = await searchNewLeads(intent, opts);
      } catch (error) {
        newRows = []; // Continue with empty results
      }

      let leadFlow;
      try {
        leadFlow = await findContactsForLeadSearch(intent, newRows, opts);
      } catch (error) {
        leadFlow = { contacts: [], rels: [], legacyLeads: [] }; // Continue with empty results
      }
      contactRows = leadFlow.contacts;
      rels = leadFlow.rels;
      legacyDirectRows = leadFlow.legacyLeads;

      // Also search phones when the digit query may be a number without 052 / +972.
      alsoPhoneSearch = shouldAlsoSearchPhoneForLeadQuery(intent);
      if (alsoPhoneSearch) {
        const phoneIntent: SearchIntent = {
          kind: "phone",
          digits: digitsOnly(intent.digits),
          raw: intent.raw,
        };
        try {
          const phoneResults = await Promise.allSettled([
            searchNewLeads(phoneIntent, opts),
            searchContacts(phoneIntent, opts),
            searchLegacyLeads(phoneIntent, opts),
          ]);
          const phoneNew =
            phoneResults[0].status === "fulfilled" ? phoneResults[0].value : [];
          const phoneContacts =
            phoneResults[1].status === "fulfilled" ? phoneResults[1].value : [];
          const phoneLegacy =
            phoneResults[2].status === "fulfilled" ? phoneResults[2].value : [];

          newRows = mergeRowsById(newRows, phoneNew);
          contactRows = mergeRowsById(contactRows, phoneContacts);
          legacyDirectRows = mergeRowsById(legacyDirectRows, phoneLegacy);

          const phoneContactIds = phoneContacts.map((c) => c.id).filter(Boolean);
          if (phoneContactIds.length) {
            const { data } = await withTimeout(
              supabase
                .from("lead_leadcontact")
                .select("contact_id, newlead_id, lead_id, main")
                .in("contact_id", phoneContactIds)
                .limit(150),
              opts.timeoutMs,
              "phone junction search timeout",
            ).catch(() => ({ data: [] as any[] }));
            const phoneRels = data || [];
            const seenRel = new Set(
              rels.map(
                (r: any) =>
                  `${r.contact_id}:${r.newlead_id ?? ""}:${r.lead_id ?? ""}:${r.main ?? ""}`,
              ),
            );
            for (const rel of phoneRels) {
              const key = `${rel.contact_id}:${rel.newlead_id ?? ""}:${rel.lead_id ?? ""}:${rel.main ?? ""}`;
              if (seenRel.has(key)) continue;
              seenRel.add(key);
              rels.push(rel);
            }
          }
        } catch {
          // Keep lead-only results if phone dual-search fails
        }
      }
    } else {
      // For non-lead searches: parallelize new leads and contacts search
      let newRowsResult: any[] = [];
      let contactRowsResult: any[] = [];

      try {
        const results = await Promise.allSettled([
          searchNewLeads(intent, opts),
          searchContacts(intent, opts),
          searchLegacyLeads(intent, opts),
        ]);

        if (results[0].status === 'fulfilled') {
          newRowsResult = results[0].value;
        }

        if (results[1].status === 'fulfilled') {
          contactRowsResult = results[1].value;
        }

        if (results[2].status === 'fulfilled') {
          legacyDirectRows = results[2].value;
        }
      } catch (error) {
        // Continue with empty results
      }

      newRows = newRowsResult;
      contactRows = contactRowsResult;

      // Junction to collect legacy and extra new leads for found contacts
      const contactIds = contactRows.map((c) => c.id).filter(Boolean);
      if (contactIds.length) {
        const { data, error } = await withTimeout(
          supabase
            .from("lead_leadcontact")
            .select("contact_id, newlead_id, lead_id, main")
            .in("contact_id", contactIds)
            .limit(150), // Reduced from 300 for faster queries
          opts.timeoutMs,
          "junction search timeout",
        ).catch((err) => {
          return { data: [] as any[], error: err };
        });
        rels = data || [];
      }
    }

    // 3) Fetch missing leads from ids collected via contacts and junction
    const directNewIds = Array.from(new Set(contactRows.map((c) => c.newlead_id).filter(Boolean)));
    const junctionNewIds = Array.from(new Set(rels.map((r) => r.newlead_id).filter(Boolean)));
    const allNewIds = Array.from(new Set([...newRows.map((r: any) => r.id), ...directNewIds, ...junctionNewIds]));

    const junctionLegacyIds = Array.from(new Set(rels.map((r) => r.lead_id).filter((x) => x != null))) as number[];
    // Combine legacyDirectRows with junction legacy IDs, but avoid duplicates
    const legacyDirectIds = legacyDirectRows.map((l: any) => l.id);
    const allLegacyIds = Array.from(new Set([...legacyDirectIds, ...junctionLegacyIds]));

    let newLeadsExtra: any[] = [];
    let legacyLeadsFetched: any[] = [];

    try {
      const fetchResults = await Promise.allSettled([
        allNewIds.length > 0 ? fetchNewLeadsByIds(allNewIds.filter(Boolean), opts) : Promise.resolve([]),
        allLegacyIds.length > 0 ? fetchLegacyLeadsByIds(allLegacyIds.filter((x) => typeof x === "number"), opts) : Promise.resolve([]),
      ]);

      if (fetchResults[0].status === 'fulfilled') {
        newLeadsExtra = fetchResults[0].value;
      }

      if (fetchResults[1].status === 'fulfilled') {
        legacyLeadsFetched = fetchResults[1].value;
      }
    } catch (error) {
      // Continue with empty results
    }

    // Maps - include legacyDirectRows in the map
    const newMap = new Map<string, any>(newLeadsExtra.map((l: any) => [l.id, l]));
    const legacyMap = new Map<number, any>();

    // Add legacyDirectRows first (they may have been found via sublead search)
    legacyDirectRows.forEach((l: any) => {
      legacyMap.set(l.id, l);
    });

    // Then add fetched legacy leads (overwrite if duplicate, but legacyDirectRows take precedence)
    legacyLeadsFetched.forEach((l: any) => {
      if (!legacyMap.has(l.id)) {
        legacyMap.set(l.id, l);
      }
    });

    // Format legacy lead numbers (handle subleads) - batch process all legacy leads
    const legacyLeadNumberMap = new Map<number, string>();
    const legacyLeadsToFormat = Array.from(legacyMap.values());
    const uniqueMasterIds = new Set<number>();
    legacyLeadsToFormat.forEach((lead: any) => {
      if (lead.master_id !== null && lead.master_id !== undefined && lead.master_id !== '') {
        uniqueMasterIds.add(Number(lead.master_id));
      }
    });

    // Batch fetch subleads for all unique master_ids
    if (uniqueMasterIds.size > 0) {
      const subleadPromises = Array.from(uniqueMasterIds).map(async (masterId) => {
        try {
          const { data: subleads, error } = await withTimeout(
            supabase
              .from('leads_lead')
              .select('id')
              .eq('master_id', masterId)
              .not('master_id', 'is', null)
              .order('id', { ascending: true }),
            opts.timeoutMs,
            `sublead fetch timeout for master_id ${masterId}`
          ).catch((err) => {
            return { data: null, error: err };
          });

          if (error) {
            return;
          }

          if (subleads) {
            subleads.forEach((sublead: any, index: number) => {
              // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
              const suffix = index + 2;
              legacyLeadNumberMap.set(sublead.id, `${masterId}/${suffix}`);
            });
          }
        } catch (error) {
          // Continue on error
        }
      });

      // Use allSettled to continue even if some sublead fetches fail
      await Promise.allSettled(subleadPromises);
    }

    // Update legacyMap with formatted lead numbers
    legacyLeadsToFormat.forEach((lead: any) => {
      const masterId = lead.master_id;
      if (masterId !== null && masterId !== undefined && masterId !== '') {
        const formatted = legacyLeadNumberMap.get(lead.id);
        if (formatted) {
          legacyMap.set(lead.id, { ...lead, formattedLeadNumber: formatted });
        } else {
          // Fallback: use placeholder
          legacyMap.set(lead.id, { ...lead, formattedLeadNumber: `${masterId}/?` });
        }
      } else {
        // Master lead: prefer the real lead_number column (e.g. "209994") over the row's primary key id.
        // The two can diverge — using id caused the dropdown to show "#20999" while the user typed "209994".
        const rawLeadNumber = (lead.lead_number ?? lead.manual_id ?? '').toString().trim();
        legacyMap.set(lead.id, {
          ...lead,
          formattedLeadNumber: rawLeadNumber || String(lead.id),
        });
      }
    });

    const relByContact = new Map<string, any[]>();
    rels.forEach((r: any) => {
      if (!r.contact_id) return;
      const key = String(r.contact_id);
      if (!relByContact.has(key)) relByContact.set(key, []);
      relByContact.get(key)!.push(r);
    });

    // 4) Build results
    const results: CombinedLead[] = [];
    const seen = new Set<string>();

    // Add new leads directly found (lead rows)
    newRows.forEach((row: any) => {
      const l = newMap.get(row.id) || row;
      const r = mapNewLeadRow(l);

      // For lead number searches, enrich the lead with contact information if name is empty
      if (intent.kind === "lead" && (!r.name || r.name.trim() === "")) {
        // Find contacts associated with this lead
        const associatedContacts = contactRows.filter((c: any) => {
          // Check direct relation
          if (c.newlead_id === l.id) return true;
          // Check junction relations
          const contactId = String(c.id);
          const relList = relByContact.get(contactId) || [];
          return relList.some((rel: any) => rel.newlead_id === l.id);
        });

        // Use the first contact's name if available (prefer main contact)
        if (associatedContacts.length > 0) {
          // Sort to prefer main contacts
          const sortedContacts = associatedContacts.sort((a: any, b: any) => {
            const aIsMain = relByContact.get(String(a.id))?.some((rel: any) => rel.main === true || rel.main === "true") || false;
            const bIsMain = relByContact.get(String(b.id))?.some((rel: any) => rel.main === true || rel.main === "true") || false;
            return bIsMain ? 1 : aIsMain ? -1 : 0;
          });

          const contact = sortedContacts[0];
          if (contact && contact.name) {
            r.name = contact.name;
            r.email = contact.email || r.email;
            r.phone = contact.phone || r.phone;
            r.mobile = contact.mobile || r.mobile;
            applyContactFieldsToResult(r, contact);
          }
        }
      }

      const key = `new:${r.id}:lead`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(r);
      }
    });

    // For lead number searches, skip contact entries - we only want the lead itself.
    // When we also searched phones (suffix without 052), keep contact matches.
    if (intent.kind !== "lead" || alsoPhoneSearch) {
      // Prefer phone-matching contacts when dual-searching so we don't flood with every
      // contact linked to a lead-number hit.
      const contactsForEntries =
        intent.kind === "lead" && alsoPhoneSearch
          ? contactRows.filter((c: any) => {
              const qDigits = digitsOnly(intent.digits);
              return (
                phoneDigitsMatch(c.phone || "", qDigits) ||
                phoneDigitsMatch(c.mobile || "", qDigits)
              );
            })
          : contactRows;

      // Add results from contacts and junction (only for non-lead searches)
      contactsForEntries.forEach((c: any) => {
        const contactId = String(c.id);
        const relList = relByContact.get(contactId) || [];

        // Direct new lead relation
        if (c.newlead_id && newMap.has(c.newlead_id)) {
          const l = newMap.get(c.newlead_id);
          const r = mapNewLeadRow({ ...l, name: c.name, email: c.email, phone: c.phone, mobile: c.mobile });
          applyContactFieldsToResult(r, c, { isContact: true, isMainContact: false });

          const key = `new:${r.id}:contact:${contactId}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push(r);
          }
        }

        // Junction relations
        relList.forEach((rel: any) => {
          const isMain = rel.main === true || rel.main === "true";

          if (rel.newlead_id && newMap.has(rel.newlead_id)) {
            const l = newMap.get(rel.newlead_id);
            const r = mapNewLeadRow({ ...l, name: c.name, email: c.email, phone: c.phone, mobile: c.mobile });
            applyContactFieldsToResult(r, c, { isContact: !isMain, isMainContact: isMain });

            const key = `new:${r.id}:contact:${contactId}:main:${isMain ? "1" : "0"}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push(r);
            }
          }

          if (rel.lead_id != null) {
            const legacy = legacyMap.get(rel.lead_id);
            const formattedNumber = legacy?.formattedLeadNumber;
            const r = legacy ? mapLegacyLeadRow(legacy, formattedNumber) : mapLegacyLeadRow({ id: rel.lead_id });
            // attach contact data for display
            r.name = c.name || r.name;
            r.email = c.email || r.email;
            r.phone = c.phone || r.phone;
            r.mobile = c.mobile || r.mobile;
            applyContactFieldsToResult(r, c, { isContact: !isMain, isMainContact: isMain });

            const key = `legacy:${r.id}:contact:${contactId}:main:${isMain ? "1" : "0"}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push(r);
            }
          }
        });
      });
    }

    // 5) Add every legacy lead found (direct lead_number search + junction refetch).
    // Prefer legacyMap — it already contains direct hits with formattedLeadNumber, even if
    // fetchLegacyLeadsByIds timed out or returned empty.
    Array.from(legacyMap.values()).forEach((l: any) => {
      const formattedNumber = l?.formattedLeadNumber;
      const r = mapLegacyLeadRow(l, formattedNumber);

      // For lead number searches, enrich the legacy lead with contact information if name is empty
      if (intent.kind === "lead" && (!r.name || r.name.trim() === "")) {
        // Find contacts associated with this legacy lead
        const associatedContacts = contactRows.filter((c: any) => {
          // Check junction relations
          const contactId = String(c.id);
          const relList = relByContact.get(contactId) || [];
          return relList.some((rel: any) => rel.lead_id === l.id);
        });

        // Use the first contact's name if available (prefer main contact)
        if (associatedContacts.length > 0) {
          // Sort to prefer main contacts
          const sortedContacts = associatedContacts.sort((a: any, b: any) => {
            const aIsMain = relByContact.get(String(a.id))?.some((rel: any) => rel.lead_id === l.id && (rel.main === true || rel.main === "true")) || false;
            const bIsMain = relByContact.get(String(b.id))?.some((rel: any) => rel.lead_id === l.id && (rel.main === true || rel.main === "true")) || false;
            return bIsMain ? 1 : aIsMain ? -1 : 0;
          });

          const contact = sortedContacts[0];
          if (contact && contact.name) {
            r.name = contact.name;
            r.email = contact.email || r.email;
            r.phone = contact.phone || r.phone;
            r.mobile = contact.mobile || r.mobile;
            applyContactFieldsToResult(r, contact);
          }
        }
      }

      const key = `legacy:${r.id}:lead`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(r);
      }
    });

    // 6) Rank and mark fuzzy
    results.forEach((r) => {
      r.isFuzzyMatch = markFuzzy(intent, r);
    });

    results.sort((a, b) => scoreResult(intent, b) - scoreResult(intent, a));

    const finalResults = results.slice(0, opts.limit);

    return enrichLeadContactSearchProfiles(finalResults);
  } catch (error) {
    // Return empty array instead of throwing to prevent UI crashes
    return [];
  }
}

// -----------------------------------------------------
// Fetch latest lead only (for Clients page when no lead in URL - fast path)
// -----------------------------------------------------

export async function fetchLatestLead(): Promise<CombinedLead | null> {
  try {
    const [newResult, legacyResult] = await Promise.all([
      supabase
        .from("leads")
        .select("id, lead_number, manual_id, name, email, phone, mobile, topic, stage, created_at, status")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("leads_lead")
        .select("id, name, email, phone, mobile, topic, stage, cdate, master_id, status")
        .order("cdate", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const newLead = newResult.data && !newResult.error ? mapNewLeadRow(newResult.data) : null;
    const legacyLead = legacyResult.data && !legacyResult.error ? mapLegacyLeadRow(legacyResult.data) : null;

    if (!newLead && !legacyLead) return null;
    if (!legacyLead) return newLead;
    if (!newLead) return legacyLead;

    const newDate = new Date(newLead.created_at).getTime();
    const legacyDate = new Date(legacyLead.created_at).getTime();
    return newDate >= legacyDate ? newLead : legacyLead;
  } catch (error) {
    return null;
  }
}

// -----------------------------------------------------
// Fetch All Leads (for navigation to latest lead)
// -----------------------------------------------------

export async function fetchAllLeads(): Promise<CombinedLead[]> {
  try {
    // Fetch new leads and legacy leads in parallel
    const [newLeadsResult, legacyLeadsResult] = await Promise.all([
      supabase
        .from("leads")
        .select("id, lead_number, name, email, phone, mobile, topic, stage, created_at, status")
        .order("created_at", { ascending: false })
        .limit(100)
        .then((result) => ({ data: result.data || [], error: result.error })),
      supabase
        .from("leads_lead")
        .select("id, name, email, phone, mobile, topic, stage, cdate, master_id, status")
        .order("cdate", { ascending: false })
        .limit(100)
        .then((result) => ({ data: result.data || [], error: result.error })),
    ]);

    const newLeads = (newLeadsResult.data || []).map(mapNewLeadRow);
    // For fetchAllLeads, we don't format subleads (performance - this is just for navigation)
    // The lead_number will be formatted when displayed in the UI
    const legacyLeads = (legacyLeadsResult.data || []).map((l: any) => mapLegacyLeadRow(l));

    // Combine and sort by creation date (most recent first)
    const allLeads = [...newLeads, ...legacyLeads].sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA; // Descending (newest first)
    });

    return allLeads;
  } catch (error) {
    return [];
  }
}

// -----------------------------------------------------
// Fetch Lead By ID
// -----------------------------------------------------

export async function fetchLeadById(
  leadId: string | number,
  leadType?: "legacy" | "new"
): Promise<CombinedLead | null> {
  try {
    // If leadType is not specified, try both
    if (!leadType) {
      // Try new leads first
      const { data: newLead, error: newError } = await supabase
        .from("leads")
        .select("id, lead_number, name, email, phone, mobile, topic, stage, created_at, status")
        .eq("id", String(leadId))
        .maybeSingle();

      if (newLead && !newError) {
        return mapNewLeadRow(newLead);
      }

      // Try legacy leads
      const { data: legacyLead, error: legacyError } = await supabase
        .from("leads_lead")
        .select("id, name, email, phone, mobile, topic, stage, cdate, master_id, status")
        .eq("id", Number(leadId))
        .maybeSingle();

      if (legacyLead && !legacyError) {
        // For fetchLeadById, format the lead number if it's a sublead
        // We need to calculate the suffix
        let formattedNumber: string | undefined;
        if (legacyLead.master_id) {
          try {
            const { data: subleads } = await supabase
              .from('leads_lead')
              .select('id')
              .eq('master_id', legacyLead.master_id)
              .not('master_id', 'is', null)
              .order('id', { ascending: true });

            if (subleads) {
              const currentLeadIndex = subleads.findIndex(sub => sub.id === legacyLead.id);
              if (currentLeadIndex >= 0) {
                const suffix = currentLeadIndex + 2;
                formattedNumber = `${legacyLead.master_id}/${suffix}`;
              }
            }
          } catch (error) {
            // Continue on error
          }
        }
        return mapLegacyLeadRow(legacyLead, formattedNumber);
      }

      return null;
    }

    // LeadType is specified
    if (leadType === "new") {
      const { data, error } = await supabase
        .from("leads")
        .select("id, lead_number, name, email, phone, mobile, topic, stage, created_at, status")
        .eq("id", String(leadId))
        .maybeSingle();

      if (error || !data) return null;
      return mapNewLeadRow(data);
    } else {
      const { data, error } = await supabase
        .from("leads_lead")
        .select("id, name, email, phone, mobile, topic, stage, cdate, master_id, status")
        .eq("id", Number(leadId))
        .maybeSingle();

      if (error || !data) return null;
      // Format the lead number if it's a sublead
      let formattedNumber: string | undefined;
      if (data.master_id) {
        try {
          const { data: subleads } = await supabase
            .from('leads_lead')
            .select('id')
            .eq('master_id', data.master_id)
            .not('master_id', 'is', null)
            .order('id', { ascending: true });

          if (subleads) {
            const currentLeadIndex = subleads.findIndex(sub => sub.id === data.id);
            if (currentLeadIndex >= 0) {
              const suffix = currentLeadIndex + 2;
              formattedNumber = `${data.master_id}/${suffix}`;
            }
          }
        } catch (error) {
          // Continue on error
        }
      }
      return mapLegacyLeadRow(data, formattedNumber);
    }
  } catch (error) {
    return null;
  }
}
