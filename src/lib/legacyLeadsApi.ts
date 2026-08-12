import { supabase } from "./supabase";
import { containsArabic, containsHebrew, generateFuzzyNameVariants, generateSearchVariants } from "./transliteration";
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
  /** Single RPC budget (no stacked 1.8s + 3.2s retries). */
  timeoutMs?: number;
  /** Abort in-flight PostgREST/RPC when the query changes. */
  signal?: AbortSignal;
};

const DEFAULTS: Required<Omit<SearchOptions, "signal">> = {
  limit: 20,
  contactsLimit: 20,
  leadsLimit: 20,
  legacyLimit: 20,
  timeoutMs: 2500,
};

type ResolvedSearchOptions = Required<Omit<SearchOptions, "signal">> & {
  signal?: AbortSignal;
};

const HEADER_RPC_BUDGET_MS = 2500;

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------

const normalize = (s: string) => s.trim();
const lower = (s: string) => s.trim().toLowerCase();
const digitsOnly = phoneDigitsOnly;
const looksLikeEmail = (s: string) => s.includes("@");
const hasLeadPrefix = (s: string) => /^[LC]/i.test(s.trim());
const stripLeadPrefix = (s: string) => s.trim().replace(/^[LC]/i, "");

/** Quote a PostgREST `.or()` filter value (needed for patterns like L1234% and Hebrew). */
function quoteFilterValue(value: string): string {
  return `"${String(value).replace(/"/g, "")}"`;
}

/**
 * Fast name filters — prefer indexed prefix matches.
 * MUST quote values (Hebrew/Arabic break unquoted PostgREST `.or()`).
 */
function buildNameSearchOrFilter(variants: string[], rawQuery: string): string {
  const primary = lower(rawQuery).replace(/%/g, "");
  const terms = Array.from(
    new Set(
      [primary, ...variants.map((v) => String(v || "").trim().toLowerCase().replace(/%/g, ""))]
        .filter((v) => v.length >= 2),
    ),
  ).slice(0, 4);

  if (terms.length === 0) return "";

  const nonLatin = containsHebrew(rawQuery) || containsArabic(rawQuery);
  const parts: string[] = [];

  // Indexed prefix for every variant
  for (const term of terms) {
    parts.push(`name.ilike.${quoteFilterValue(`${term}%`)}`);
  }

  // One word-start on the typed term only (last-name: "cohen" → "David Cohen")
  if (primary.length >= 3) {
    parts.push(`name.ilike.${quoteFilterValue(`% ${primary}%`)}`);
  }

  // Contains only for Hebrew/Arabic primary (trigram-friendly, single pattern)
  if (nonLatin && primary.length >= 2) {
    parts.push(`name.ilike.${quoteFilterValue(`%${primary}%`)}`);
  }

  // Email only when query looks email-ish (not every name search)
  const emailOr = buildProgressiveEmailOrFilter(rawQuery);
  if (emailOr) parts.push(...emailOr.split(","));

  return Array.from(new Set(parts)).join(",");
}

/** Match partial emails while typing — only when query has @ or domain-ish shape. */
function buildProgressiveEmailOrFilter(rawQuery: string): string {
  const q = lower(rawQuery).replace(/%/g, "").trim();
  if (q.length < 3) return "";
  if (!/[a-z0-9@._+-]/i.test(q)) return "";
  // Require @ or a dot so plain names don't scan emails
  if (!q.includes("@") && !q.includes(".")) return "";

  return [
    `email.ilike.${quoteFilterValue(`${q}%`)}`,
    ...(q.includes("@") ? [`email.ilike.${quoteFilterValue(`%${q}%`)}`] : []),
  ].join(",");
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
 * Do not dual-run phone on lead-digit queries.
 * Phone vs lead is exclusive in detectIntent + search_leads_header RPC;
 * dual search caused intermittent multi-second latency.
 */
function shouldAlsoSearchPhoneForLeadQuery(
  _intent: Extract<SearchIntent, { kind: "lead" }>,
): boolean {
  return false;
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
function intentQueryText(intent: SearchIntent): string {
  if (intent.kind === "email") return intent.email;
  return intent.raw;
}

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
  // Longer pure digits (7+) without a leading 0 may still be lead numbers.
  // Phone search is exclusive (0… / 972… / 5xxxxxxxx / formatted) — not dual-run.
  const isPureNumeric = rawNoPrefix.length > 0 && /^\d+$/.test(rawNoPrefix) && rawNoPrefix === d;
  const startsWithZero = d.startsWith("0") && d.length >= 3;
  const isInternationalPhone =
    d.startsWith("972") || d.startsWith("00972");
  // Prefer phone for local mobiles typed without the leading 0 (52xxxxxxx / 5xxxxxxxx).
  // Use progressive threshold (5+) so typing "052…" shows phone hits early.
  const isLocalMobileWithoutZero = d.startsWith("5") && d.length >= 5 && d.length <= 10;
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

  // Phone intent triggers (fallback for formatted numbers / short progressive prefixes):
  const formatted = raw.length > d.length;
  const phoneLike =
    (formatted && d.length >= 4) ||
    (d.startsWith("0") && d.length >= 4) ||
    (d.startsWith("972") && d.length >= 5);

  if (phoneLike) {
    return { kind: "phone", digits: d, raw };
  }

  // Default name intent — lean variants only (fuzzy is a second pass if empty)
  const variants = generateSearchVariants(raw).map((v) => v.trim().toLowerCase()).filter(Boolean);
  const uniqVariants = Array.from(new Set(variants.length ? variants : [lower(raw)])).slice(0, 4);
  return { kind: "name", raw, variants: uniqVariants };
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "AbortedError";
}

/**
 * Race a promise against a timeout. When `signal` is provided and aborts (or we
 * time out with a linked AbortController), the underlying fetch can be cancelled
 * via supabase `.abortSignal()` — unlike a bare Promise.race which left ghosts.
 */
function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  msg: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => reject(new Error(msg)), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    p.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function attachAbortSignal<T extends { abortSignal?: (signal: AbortSignal) => T }>(
  builder: T,
  signal?: AbortSignal,
): T {
  if (signal && typeof builder.abortSignal === "function") {
    return builder.abortSignal(signal);
  }
  return builder;
}

function mapHeaderSearchRpcRow(row: any): CombinedLead | null {
  if (!row) return null;
  const leadType = row.lead_type === "legacy" ? "legacy" : "new";
  const id = String(row.id || "").replace(/^legacy_/, "");
  if (!id) return null;

  return {
    id,
    lead_number: String(row.lead_number || id),
    manual_id: row.manual_id ?? null,
    name: String(row.name || row.contact_name || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    mobile: String(row.mobile || ""),
    topic: String(row.topic || ""),
    stage: String(row.stage ?? ""),
    source: "",
    created_at: row.created_at || "",
    updated_at: row.created_at || "",
    notes: "",
    special_notes: "",
    next_followup: "",
    probability: "",
    category: String(row.category || ""),
    category_id: row.category_id ?? null,
    language: "",
    balance: "",
    lead_type: leadType,
    unactivation_reason: null,
    deactivate_note: null,
    isFuzzyMatch: false,
    isContact: Boolean(row.is_contact),
    contactName: row.contact_name || undefined,
    isMainContact: row.is_main_contact == null ? undefined : Boolean(row.is_main_contact),
    contact_id: row.contact_id != null ? String(row.contact_id) : null,
    portal_profile_image_path: row.portal_profile_image_path || null,
    status: row.status ?? null,
    master_id: row.master_id ?? null,
    linked_master_lead: row.linked_master_lead ?? null,
  };
}

/**
 * Fast path: one SECURITY DEFINER RPC. Returns null on miss/error so caller can fall back.
 * Aborts the HTTP request on timeout or external signal so ghost RPCs don't stack.
 */
async function trySearchLeadsHeaderRpc(
  query: string,
  limit: number,
  timeoutMs: number,
  variants?: string[],
  signal?: AbortSignal,
): Promise<CombinedLead[] | null> {
  if (signal?.aborted) return null;

  const localAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
  const budget = Math.min(Math.max(timeoutMs, 500), HEADER_RPC_BUDGET_MS);
  const timer =
    localAbort != null ? setTimeout(() => localAbort.abort(), budget) : null;

  const onExternalAbort = () => localAbort?.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  const combinedSignal = localAbort?.signal ?? signal;

  try {
    const payload: Record<string, unknown> = {
      p_query: query,
      p_limit: limit,
    };
    if (variants && variants.length > 0) {
      payload.p_variants = variants.slice(0, 4);
    }

    let rpcCall = supabase.rpc("search_leads_header", payload) as any;
    rpcCall = attachAbortSignal(rpcCall, combinedSignal);

    const { data, error } = await withTimeout(
      rpcCall,
      budget + 50,
      "search_leads_header timeout",
      combinedSignal,
    );

    if (error) return null;

    let rows: any[] = [];
    if (Array.isArray(data)) rows = data;
    else if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        rows = Array.isArray(parsed) ? parsed : [];
      } catch {
        return null;
      }
    } else if (data == null) {
      rows = [];
    } else {
      return null;
    }

    // Empty array is a valid "no matches" from RPC — still use it (don't fall back).
    const mapped = rows
      .map(mapHeaderSearchRpcRow)
      .filter((r): r is CombinedLead => r != null);
    return mapped;
  } catch (err) {
    if (isAbortError(err) && signal?.aborted) return null;
    return null;
  } finally {
    if (timer != null) clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

let headerSearchWarmPromise: Promise<void> | null = null;

/**
 * Warm TLS + PostgREST + RPC plan + name indexes so the first typed search isn't cold.
 * Safe to call multiple times; only the first call does work.
 */
export function warmHeaderLeadSearch(): Promise<void> {
  if (headerSearchWarmPromise) return headerSearchWarmPromise;
  headerSearchWarmPromise = (async () => {
    try {
      // Intentional no-hit query: still executes the NAME branch and warms caches.
      await supabase.rpc("search_leads_header", {
        p_query: "zz",
        p_limit: 1,
      });
    } catch {
      // Best-effort — allow a later warm retry if this failed before auth was ready
      headerSearchWarmPromise = null;
    }
  })();
  return headerSearchWarmPromise;
}

// -----------------------------------------------------
// Query functions (small and predictable)
// -----------------------------------------------------

const NEW_LEAD_SEARCH_SELECT =
  "id, lead_number, name, email, phone, mobile, topic, stage, created_at, status, master_id, linked_master_lead, category_id";

const LEGACY_LEAD_SEARCH_SELECT =
  "id, name, email, phone, mobile, topic, stage, cdate, master_id, status, lead_number, manual_id, linked_master_lead, category_id";

function formatLeadCategoryFromRow(row: any): string {
  // Search selects omit nested category joins for speed; keep fallback for richer rows.
  const categoryJoin = Array.isArray(row?.misc_category) ? row.misc_category[0] : row?.misc_category;
  if (categoryJoin?.name) {
    const mainRel = categoryJoin.misc_maincategory;
    const mainCategory = Array.isArray(mainRel) ? mainRel[0]?.name : mainRel?.name;
    return mainCategory ? `${categoryJoin.name} (${mainCategory})` : categoryJoin.name;
  }
  return row?.category || "";
}

async function searchNewLeads(intent: SearchIntent, opts: ResolvedSearchOptions): Promise<any[]> {
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
    const nameOr = buildNameSearchOrFilter(intent.variants, intent.raw);
    if (!nameOr) return [];
    qb = qb.or(nameOr);
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

async function searchLegacyLeads(intent: SearchIntent, opts: ResolvedSearchOptions): Promise<any[]> {
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
    } else {
      const nameOr = buildNameSearchOrFilter(intent.variants, intent.raw);
      if (!nameOr) return [];
      qb = qb.or(nameOr);
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

async function searchContacts(intent: SearchIntent, opts: ResolvedSearchOptions): Promise<any[]> {
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
    const nameOr = buildNameSearchOrFilter(intent.variants, intent.raw);
    if (!nameOr) return [];
    qb = qb.or(nameOr);
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
/**
 * Legacy lead_number / id lookup for digit queries (runs in parallel with new-lead search).
 */
async function searchLegacyLeadsForLeadIntent(
  leadIntent: Extract<SearchIntent, { kind: "lead" }>,
  opts: ResolvedSearchOptions,
): Promise<any[]> {
  const legacyLeads: any[] = [];

  const legacyExactId = (() => {
    const base =
      leadIntent.master != null
        ? String(leadIntent.master)
        : stripLeadPrefix(leadIntent.raw).split("/")[0];
    if (!base) return null;
    if (!/^\d+$/.test(base)) return null;
    if (base.length < 1 || base.length > 10) return null;
    const parsed = parseInt(base, 10);
    if (Number.isNaN(parsed)) return null;
    return parsed;
  })();

  if (
    leadIntent.master != null &&
    leadIntent.suffix != null &&
    !Number.isNaN(leadIntent.master) &&
    !Number.isNaN(leadIntent.suffix)
  ) {
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
      const targetIndex = leadIntent.suffix - 2;
      if (targetIndex >= 0 && targetIndex < subleads.length) {
        legacyLeads.push(subleads[targetIndex]);
      }
    }
    return legacyLeads;
  }

  if (legacyExactId == null || Number.isNaN(legacyExactId)) {
    return legacyLeads;
  }

  const searchDigits = leadIntent.digits || stripLeadPrefix(leadIntent.raw);
  const isPrefixQuery = searchDigits.length >= 1 && searchDigits.length <= 5;
  const isSixDigitQuery = searchDigits.length === 6 && /^\d+$/.test(searchDigits);
  const isLongLeadNumberQuery =
    searchDigits.length >= 7 && searchDigits.length <= 10 && /^\d+$/.test(searchDigits);

  const leadNumberQuery = (() => {
    if (isPrefixQuery) {
      return supabase
        .from("leads_lead")
        .select(LEGACY_LEAD_SEARCH_SELECT)
        .or(buildLegacyLeadNumberOrFilter(searchDigits, "prefix"))
        .limit(30);
    }
    if (isSixDigitQuery || isLongLeadNumberQuery) {
      return supabase
        .from("leads_lead")
        .select(LEGACY_LEAD_SEARCH_SELECT)
        .or(buildLegacyLeadNumberOrFilter(searchDigits, "exact"))
        .limit(30);
    }
    return null;
  })();

  const exactIdQuery = supabase
    .from("leads_lead")
    .select(LEGACY_LEAD_SEARCH_SELECT)
    .eq("id", legacyExactId)
    .limit(1);

  const settled = await Promise.allSettled([
    leadNumberQuery
      ? withTimeout(leadNumberQuery, opts.timeoutMs, "legacy lead_number search timeout").catch(
          () => ({ data: [] as any[] }),
        )
      : Promise.resolve({ data: [] as any[] }),
    withTimeout(exactIdQuery, opts.timeoutMs, "legacy exact search timeout").catch(() => ({
      data: [] as any[],
    })),
  ]);

  const existingIds = new Set<number>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const rows = result.value?.data || [];
    for (const row of rows) {
      if (row?.id == null || existingIds.has(row.id)) continue;
      existingIds.add(row.id);
      legacyLeads.push(row);
    }
  }

  return legacyLeads;
}

async function fetchJunctionContactsForLeads(
  newLeadIds: string[],
  legacyLeadIds: number[],
  opts: ResolvedSearchOptions,
): Promise<{ rels: any[]; contacts: any[] }> {
  const rels: any[] = [];
  const contacts: any[] = [];
  const junctionQueries: Promise<any>[] = [];

  if (newLeadIds.length) {
    junctionQueries.push(
      supabase
        .from("lead_leadcontact")
        .select("contact_id, newlead_id, lead_id, main")
        .in("newlead_id", newLeadIds)
        .limit(150)
        .then((result) => result),
    );
  }

  if (legacyLeadIds.length) {
    junctionQueries.push(
      supabase
        .from("lead_leadcontact")
        .select("contact_id, newlead_id, lead_id, main")
        .in("lead_id", legacyLeadIds)
        .limit(150)
        .then((result) => result),
    );
  }

  const junctionResults = await Promise.allSettled(junctionQueries);
  junctionResults.forEach((result) => {
    if (result.status === "fulfilled" && result.value?.data) {
      rels.push(...result.value.data);
    }
  });

  const contactIds = Array.from(new Set(rels.map((x) => x.contact_id).filter(Boolean)));
  if (contactIds.length) {
    const { data } = await withTimeout(
      supabase
        .from("leads_contact")
        .select("id, name, email, phone, mobile, newlead_id, portal_profile_image_path")
        .in("id", contactIds)
        .limit(opts.contactsLimit),
      opts.timeoutMs,
      "contacts fetch for lead search timeout",
    ).catch(() => ({ data: [] as any[] }));
    if (data) contacts.push(...data);
  }

  return { rels, contacts };
}

async function findContactsForLeadSearch(
  leadIntent: Extract<SearchIntent, { kind: "lead" }>,
  newLeadRows: any[],
  opts: ResolvedSearchOptions,
  prefetchedLegacyLeads?: any[],
): Promise<{ rels: any[]; contacts: any[]; legacyLeads: any[] }> {
  const newLeadIds = newLeadRows.map((l) => l.id).filter(Boolean);
  const legacyLeads =
    prefetchedLegacyLeads != null
      ? [...prefetchedLegacyLeads]
      : await searchLegacyLeadsForLeadIntent(leadIntent, opts);
  const legacyIds = legacyLeads.map((l) => l.id).filter((id) => typeof id === "number");
  const { rels, contacts } = await fetchJunctionContactsForLeads(newLeadIds, legacyIds, opts);
  return { rels, contacts, legacyLeads };
}

async function fetchNewLeadsByIds(ids: string[], opts: ResolvedSearchOptions): Promise<any[]> {
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

async function fetchLegacyLeadsByIds(ids: number[], opts: ResolvedSearchOptions): Promise<any[]> {
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
    const contactNm = lower(r.contactName || "");
    if (name === q || contactNm === q) s += 80;
    else if (name.startsWith(q) || contactNm.startsWith(q)) s += 55;
    else if (name.includes(q) || contactNm.includes(q)) s += 35;
    else {
      // Word-start / transliteration variants
      for (const variant of intent.variants) {
        const v = lower(variant);
        if (!v) continue;
        if (name === v || contactNm === v) {
          s += 75;
          break;
        }
        if (name.startsWith(v) || contactNm.startsWith(v) || name.includes(` ${v}`) || contactNm.includes(` ${v}`)) {
          s += 50;
          break;
        }
        if (name.includes(v) || contactNm.includes(v)) {
          s += 30;
          break;
        }
      }
    }
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
  return !(
    nm === q ||
    nm.startsWith(q) ||
    nm.includes(` ${q}`) ||
    nm.includes(q) ||
    (intent.kind === "name" &&
      intent.variants.some((variant) => {
        const v = lower(variant);
        return Boolean(v) && (nm === v || nm.startsWith(v) || nm.includes(` ${v}`) || nm.includes(v));
      }))
  );
}

// -----------------------------------------------------
// Main Search (public)
// -----------------------------------------------------

export async function searchLeads(query: string, options: SearchOptions = {}): Promise<CombinedLead[]> {
  const { signal, ...rest } = options;
  const opts: ResolvedSearchOptions = { ...DEFAULTS, ...rest, signal };

  try {
    if (signal?.aborted) return [];

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

    // If a warm is already in flight, wait briefly so we don't race it (double cold hit).
    // Do NOT kick a new warm here — Header/focus already warms on session ready.
    if (headerSearchWarmPromise) {
      await Promise.race([
        headerSearchWarmPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 350)),
      ]);
    }

    if (signal?.aborted) return [];

    const rpcQuery = intentQueryText(intent);

    // Fast path: single DB round-trip within one budget. Fall back to multi-query if RPC
    // missing/errors. Phone/email timeouts fall through to PostgREST waterfall.
    const rpcBudget = Math.min(opts.timeoutMs, HEADER_RPC_BUDGET_MS);
    let rpcRows = await trySearchLeadsHeaderRpc(
      rpcQuery,
      opts.limit,
      rpcBudget,
      intent.kind === "name" ? intent.variants : undefined,
      signal,
    );

    // One short retry only (same budget family) — not stacked 1.8s + 3.2s.
    if (rpcRows == null && intent.kind !== "lead" && !signal?.aborted) {
      rpcRows = await trySearchLeadsHeaderRpc(
        rpcQuery,
        opts.limit,
        Math.min(rpcBudget, 1800),
        intent.kind === "name" ? intent.variants : undefined,
        signal,
      );
      if (rpcRows == null) {
        // Phone/email: allow client PostgREST fallback. Name: prefer empty over cold waterfall.
        if (intent.kind === "name") {
          return [];
        }
      }
    }

    const isSubleadQuery =
      intent.kind === "lead" && intent.raw.includes("/") && intent.master != null;

    const finalize = (rows: CombinedLead[]) => {
      rows.forEach((r) => {
        r.isFuzzyMatch = markFuzzy(intent, r);
      });
      rows.sort((a, b) => scoreResult(intent, b) - scoreResult(intent, a));
      return rows.slice(0, opts.limit);
    };

    if (rpcRows != null && !(isSubleadQuery && rpcRows.length === 0)) {
      // Fast hit — return immediately (including valid empty for non-name / short names)
      if (rpcRows.length > 0 || intent.kind !== "name" || intent.raw.trim().length < 4) {
        return finalize(rpcRows);
      }

      // Name miss: one cheap fuzzy retry (few spelling variants), then stop.
      const fuzzyExtra = generateFuzzyNameVariants(intent.raw);
      if (fuzzyExtra.length > 0) {
        const fuzzyRows = await trySearchLeadsHeaderRpc(
          rpcQuery,
          opts.limit,
          Math.min(opts.timeoutMs, 1200),
          Array.from(new Set([...intent.variants, ...fuzzyExtra])).slice(0, 4),
          signal,
        );
        if (fuzzyRows != null) return finalize(fuzzyRows);
      }
      return finalize([]);
    }

    if (signal?.aborted) return [];

    // 1) Search new leads (always) - parallelize with contacts for non-lead searches
    let newRows: any[];
    let contactRows: any[] = [];
    let rels: any[] = [];
    let legacyDirectRows: any[] = [];
    let alsoPhoneSearch = false;

    if (intent.kind === "lead") {
      // Parallel: new leads + legacy lead_number/id (was sequential before).
      let prefetchedLegacy: any[] = [];
      try {
        const parallel = await Promise.allSettled([
          searchNewLeads(intent, opts),
          searchLegacyLeadsForLeadIntent(intent, opts),
        ]);
        newRows = parallel[0].status === "fulfilled" ? parallel[0].value : [];
        prefetchedLegacy = parallel[1].status === "fulfilled" ? parallel[1].value : [];
      } catch {
        newRows = [];
        prefetchedLegacy = [];
      }

      let leadFlow;
      try {
        leadFlow = await findContactsForLeadSearch(intent, newRows, opts, prefetchedLegacy);
      } catch {
        leadFlow = { contacts: [], rels: [], legacyLeads: prefetchedLegacy };
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

    // 3) Only fetch lead rows we don't already have (skip redundant full re-fetch).
    const knownNewById = new Map<string, any>(
      newRows.filter((r: any) => r?.id).map((r: any) => [String(r.id), r]),
    );
    const directNewIds = Array.from(new Set(contactRows.map((c) => c.newlead_id).filter(Boolean)));
    const junctionNewIds = Array.from(new Set(rels.map((r) => r.newlead_id).filter(Boolean)));
    const allNewIds = Array.from(
      new Set([...knownNewById.keys(), ...directNewIds, ...junctionNewIds].map(String)),
    );
    const missingNewIds = allNewIds.filter((id) => !knownNewById.has(id));

    const junctionLegacyIds = Array.from(
      new Set(rels.map((r) => r.lead_id).filter((x) => x != null)),
    ) as number[];
    const knownLegacyById = new Map<number, any>();
    legacyDirectRows.forEach((l: any) => {
      if (l?.id != null) knownLegacyById.set(Number(l.id), l);
    });
    const allLegacyIds = Array.from(
      new Set([...Array.from(knownLegacyById.keys()), ...junctionLegacyIds]),
    );
    const missingLegacyIds = allLegacyIds.filter((id) => !knownLegacyById.has(id));

    try {
      const fetchResults = await Promise.allSettled([
        missingNewIds.length > 0
          ? fetchNewLeadsByIds(missingNewIds.filter(Boolean), opts)
          : Promise.resolve([]),
        missingLegacyIds.length > 0
          ? fetchLegacyLeadsByIds(
              missingLegacyIds.filter((x) => typeof x === "number"),
              opts,
            )
          : Promise.resolve([]),
      ]);

      if (fetchResults[0].status === "fulfilled") {
        (fetchResults[0].value || []).forEach((l: any) => {
          if (l?.id != null) knownNewById.set(String(l.id), l);
        });
      }

      if (fetchResults[1].status === "fulfilled") {
        (fetchResults[1].value || []).forEach((l: any) => {
          if (l?.id != null && !knownLegacyById.has(Number(l.id))) {
            knownLegacyById.set(Number(l.id), l);
          }
        });
      }
    } catch {
      // Continue with what we already have
    }

    const newMap = knownNewById;
    const legacyMap = knownLegacyById;

    // Format legacy lead numbers (handle subleads) — one batched query, not N.
    const legacyLeadNumberMap = new Map<number, string>();
    const legacyLeadsToFormat = Array.from(legacyMap.values());
    const uniqueMasterIds = Array.from(
      new Set(
        legacyLeadsToFormat
          .map((lead: any) =>
            lead.master_id !== null && lead.master_id !== undefined && lead.master_id !== ""
              ? Number(lead.master_id)
              : null,
          )
          .filter((id): id is number => id != null && !Number.isNaN(id)),
      ),
    );

    if (uniqueMasterIds.length > 0) {
      try {
        const { data: subleads } = await withTimeout(
          supabase
            .from("leads_lead")
            .select("id, master_id")
            .in("master_id", uniqueMasterIds)
            .not("master_id", "is", null)
            .order("id", { ascending: true }),
          opts.timeoutMs,
          "batched sublead fetch timeout",
        ).catch(() => ({ data: [] as any[] }));

        const byMaster = new Map<number, any[]>();
        (subleads || []).forEach((row: any) => {
          const mid = Number(row.master_id);
          if (!byMaster.has(mid)) byMaster.set(mid, []);
          byMaster.get(mid)!.push(row);
        });
        byMaster.forEach((rows, masterId) => {
          rows.forEach((sublead: any, index: number) => {
            const suffix = index + 2;
            legacyLeadNumberMap.set(sublead.id, `${masterId}/${suffix}`);
          });
        });
      } catch {
        // Continue without formatted sublead numbers
      }
    }

    // Update legacyMap with formatted lead numbers
    legacyLeadsToFormat.forEach((lead: any) => {
      const masterId = lead.master_id;
      if (masterId !== null && masterId !== undefined && masterId !== "") {
        const formatted = legacyLeadNumberMap.get(lead.id);
        if (formatted) {
          legacyMap.set(lead.id, { ...lead, formattedLeadNumber: formatted });
        } else {
          legacyMap.set(lead.id, { ...lead, formattedLeadNumber: `${masterId}/?` });
        }
      } else {
        const rawLeadNumber = (lead.lead_number ?? lead.manual_id ?? "").toString().trim();
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
      const l = newMap.get(String(row.id)) || row;
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
        if (c.newlead_id && newMap.has(String(c.newlead_id))) {
          const l = newMap.get(String(c.newlead_id));
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

          if (rel.newlead_id && newMap.has(String(rel.newlead_id))) {
            const l = newMap.get(String(rel.newlead_id));
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

    // Return immediately — profile enrich used to add another junction round-trip before paint.
    // Contact rows already carry portal_profile_image_path when available.
    return finalResults;
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
