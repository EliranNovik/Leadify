import { supabase } from "./supabase";
import { generateSearchVariants } from "./transliteration";

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
  unactivation_reason: string | null;
  deactivate_note: string | null;
  isFuzzyMatch: boolean;
  isContact?: boolean;
  contactName?: string;
  isMainContact?: boolean;
  status?: number | string | null;
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
  timeoutMs: 1500, // Reduced from 3500ms to 1.5s for faster response
};

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------

const normalize = (s: string) => s.trim();
const lower = (s: string) => s.trim().toLowerCase();
const digitsOnly = (s: string) => s.replace(/\D/g, "");
const looksLikeEmail = (s: string) => s.includes("@");
const hasLeadPrefix = (s: string) => /^[LC]/i.test(s.trim());
const stripLeadPrefix = (s: string) => s.trim().replace(/^[LC]/i, "");

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
 * Phone pattern builder with strict suffix matching.
 * Matches from the END of phone numbers only, never from the middle.
 * 
 * Rules:
 * - Strip everything to digits only
 * - Normalize leading zero variants
 * - Match only suffixes (endsWith logic, not contains)
 * - Require minimum length (5-6 digits)
 * 
 * Example:
 * - Search "7825" on "972507825939" → NO match (middle fragment)
 * - Search "507825939" on "972507825939" → Match (suffix)
 * - Search "07825939" on "972507825939" → Match (with leading zero variant)
 */
function buildPhoneOr(digits: string): string {
  const d = digitsOnly(digits);
  
  // Require minimum length: 5-6 digits for meaningful suffix matching
  // Shorter queries can match too many false positives
  if (d.length < 5) return "";
  
  const patterns: string[] = [];
  
  // Normalize leading zero: handle both with and without leading zero
  const hadZero = d.startsWith("0");
  const noZero = hadZero ? d.slice(1) : d;
  const withZero = hadZero ? d : `0${d}`;
  
  // Only use the full search string (not fragments)
  // This ensures we match suffixes, not middle fragments
  // Use both with/without leading zero variants
  if (noZero.length >= 5 && noZero.length <= 15) {
    patterns.push(noZero);
  }
  if (withZero.length >= 6 && withZero.length <= 16 && withZero !== noZero) {
    patterns.push(withZero);
  }
  
  const uniq = Array.from(new Set(patterns)).filter((p) => p.length >= 5);
  if (uniq.length === 0) return "";
  
  // Use suffix matching: %pattern (no trailing %) means "ends with"
  // This prevents middle-of-number matches
  const clauses = uniq.flatMap((p) => [`phone.ilike.%${p}`, `mobile.ilike.%${p}`]);
  return clauses.join(",");
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
  // - pure numeric length 1-6 and not phone-like
  const isPureNumeric = rawNoPrefix.length > 0 && /^\d+$/.test(rawNoPrefix) && rawNoPrefix === d;
  const startsWithZero = d.startsWith("0") && d.length >= 4;

  const leadLike = hasPrefix || raw.includes("/") || (isPureNumeric && d.length <= 6 && !startsWithZero);

  if (leadLike) {
    return { kind: "lead", raw, digits: rawNoPrefix, hasPrefix, master, suffix };
  }

  // Phone intent triggers:
  // - starts with 0 and 4+ digits
  // - 7+ digits always phone
  // - formatted numbers (raw length > digits length) with 4+ digits
  const formatted = raw.length > d.length;
  const phoneLike = (startsWithZero && d.length >= 4) || d.length >= 7 || (formatted && d.length >= 4);

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

async function searchNewLeads(intent: SearchIntent, opts: Required<SearchOptions>): Promise<any[]> {
  const selectFields = "id, lead_number, name, email, phone, mobile, topic, stage, created_at, status";

  let qb = supabase.from("leads").select(selectFields);

  if (intent.kind === "lead") {
    const searchDigits = intent.digits || stripLeadPrefix(intent.raw);
    const baseOr = [
      `lead_number.ilike.${searchDigits}%`,
      `lead_number.ilike.L${searchDigits}%`,
      `lead_number.ilike.C${searchDigits}%`,
    ].join(",");

    qb = qb.or(baseOr);

    // sub-lead: also match master/xxx
    if (intent.master != null) {
      qb = qb.or(
        [
          `lead_number.ilike.%${intent.master}/%`,
          `lead_number.ilike.L%${intent.master}/%`,
          `lead_number.ilike.C%${intent.master}/%`,
        ].join(","),
      );
    }
  } else if (intent.kind === "email") {
    qb = qb.ilike("email", `${intent.email}%`);
  } else if (intent.kind === "phone") {
    const cond = buildPhoneOr(intent.digits);
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

  const { data, error } = await withTimeout(qb.limit(opts.leadsLimit), opts.timeoutMs, "new leads search timeout").catch(
    () => ({ data: [], error: null as any }),
  );

  if (error || !data) return [];
  return data;
}

async function searchContacts(intent: SearchIntent, opts: Required<SearchOptions>): Promise<any[]> {
  // For very short name searches, contacts search is expensive and noisy.
  if (intent.kind === "name" && intent.raw.trim().length < 2) return [];

  let qb = supabase.from("leads_contact").select("id, name, email, phone, mobile, newlead_id");

  if (intent.kind === "email") {
    // Use prefix matching instead of contains to avoid matching middle of emails
    // This prevents matches like "john123@example.com" when searching "john@example.com"
    qb = qb.ilike("email", `${intent.email}%`);
  } else if (intent.kind === "phone") {
    const cond = buildPhoneOr(intent.digits);
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

  const { data, error } = await withTimeout(qb.limit(opts.contactsLimit), opts.timeoutMs, "contacts search timeout").catch(
    () => ({ data: [], error: null as any }),
  );

  if (error || !data) return [];
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

  // legacy: try exact id only for 1-6 digits
  const legacyExactId = (() => {
    const base = leadIntent.master != null ? String(leadIntent.master) : stripLeadPrefix(leadIntent.raw).split("/")[0];
    if (!base) return null;
    if (!/^\d+$/.test(base)) return null;
    if (base.length > 6) return null;
    return parseInt(base, 10);
  })();

  // Fetch legacy lead exact match (safe, no range scanning)
  if (legacyExactId != null && !Number.isNaN(legacyExactId)) {
    const { data } = await withTimeout(
      supabase
        .from("leads_lead")
        .select("id, name, email, phone, mobile, topic, stage, cdate, master_id, status")
        .eq("id", legacyExactId)
        .limit(1),
      opts.timeoutMs,
      "legacy exact search timeout",
    ).catch(() => ({ data: [] as any[] }));

    if (data && data.length) legacyLeads.push(...data);
  }

  // Junction queries
  const junctionQueries: Promise<any>[] = [];

  if (newLeadIds.length) {
    junctionQueries.push(
      supabase
        .from("lead_leadcontact")
        .select("contact_id, newlead_id, lead_id, main")
        .in("newlead_id", newLeadIds)
        .limit(150), // Reduced from 250 for faster queries
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
        .limit(150), // Reduced from 250 for faster queries
    );
  }

  const junctionResults = await Promise.all(junctionQueries);
  junctionResults.forEach((r) => {
    if (r?.data) rels.push(...r.data);
  });

  const contactIds = Array.from(new Set(rels.map((x) => x.contact_id).filter(Boolean)));

  if (contactIds.length) {
    const { data } = await withTimeout(
      supabase.from("leads_contact").select("id, name, email, phone, mobile, newlead_id").in("id", contactIds).limit(opts.contactsLimit),
      opts.timeoutMs,
      "contacts fetch for lead search timeout",
    ).catch(() => ({ data: [] as any[] }));
    if (data) contacts.push(...data);
  }

  return { rels, contacts, legacyLeads };
}

async function fetchNewLeadsByIds(ids: string[], opts: Required<SearchOptions>): Promise<any[]> {
  if (!ids.length) return [];
  const { data, error } = await withTimeout(
    supabase
      .from("leads")
      .select("id, lead_number, topic, stage, created_at, status")
      .in("id", ids)
      .limit(opts.leadsLimit),
    opts.timeoutMs,
    "fetch new leads by ids timeout",
  ).catch(() => ({ data: [], error: null as any }));
  if (error || !data) return [];
  return data;
}

async function fetchLegacyLeadsByIds(ids: number[], opts: Required<SearchOptions>): Promise<any[]> {
  if (!ids.length) return [];
  const { data, error } = await withTimeout(
    supabase
      .from("leads_lead")
      .select("id, name, email, phone, mobile, topic, stage, cdate, master_id, status")
      .in("id", ids)
      .limit(opts.legacyLimit),
    opts.timeoutMs,
    "fetch legacy leads by ids timeout",
  ).catch(() => ({ data: [], error: null as any }));
  if (error || !data) return [];
  return data;
}

// -----------------------------------------------------
// Mapping and ranking
// -----------------------------------------------------

function mapNewLeadRow(row: any): CombinedLead {
  return {
    id: String(row.id),
    lead_number: row.lead_number || "",
    manual_id: row.lead_number || null,
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
    category: "",
    language: "",
    balance: "",
    lead_type: "new",
    unactivation_reason: null,
    deactivate_note: null,
    isFuzzyMatch: false,
    status: row.status ?? null,
  };
}

function mapLegacyLeadRow(row: any): CombinedLead {
  const leadNumber = row.master_id ? `${row.master_id}` : String(row.id);
  return {
    id: String(row.id),
    lead_number: leadNumber,
    manual_id: leadNumber,
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
    category: "",
    language: "",
    balance: "",
    lead_type: "legacy",
    unactivation_reason: null,
    deactivate_note: null,
    isFuzzyMatch: false,
    status: row.status ?? null,
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
    if (leadNum === q || leadNum === qNoPrefix) s += 100;
    else if (leadNum.startsWith(qNoPrefix)) s += 70;
    else if (leadNum.includes(qNoPrefix)) s += 40;
  } else if (intent.kind === "phone") {
    if (qDigits && (phone === qDigits || mobile === qDigits)) s += 100;
    else if (qDigits && (phone.endsWith(qDigits) || mobile.endsWith(qDigits))) s += 70;
    else if (qDigits && (phone.includes(qDigits) || mobile.includes(qDigits))) s += 40;
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
    return !(ld === q || ld === qNo || ld.startsWith(qNo));
  }
  if (intent.kind === "phone") return !(qDigits && (pd.includes(qDigits) || md.includes(qDigits)));
  return !(nm === q || nm.startsWith(q));
}

// -----------------------------------------------------
// Main Search (public)
// -----------------------------------------------------

export async function searchLeads(query: string, options: SearchOptions = {}): Promise<CombinedLead[]> {
  const opts = { ...DEFAULTS, ...options };
  const intent = detectIntent(query);
  if (!intent) return [];

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

  if (intent.kind === "lead") {
    // For lead search: search new leads first, then get contacts via junction
    newRows = await searchNewLeads(intent, opts);
    const leadFlow = await findContactsForLeadSearch(intent, newRows, opts);
    contactRows = leadFlow.contacts;
    rels = leadFlow.rels;
    legacyDirectRows = leadFlow.legacyLeads;
  } else {
    // For non-lead searches: parallelize new leads and contacts search
    const [newRowsResult, contactRowsResult] = await Promise.all([
      searchNewLeads(intent, opts),
      searchContacts(intent, opts),
    ]);
    newRows = newRowsResult;
    contactRows = contactRowsResult;

    // Junction to collect legacy and extra new leads for found contacts
    const contactIds = contactRows.map((c) => c.id).filter(Boolean);
    if (contactIds.length) {
      const { data } = await withTimeout(
        supabase
          .from("lead_leadcontact")
          .select("contact_id, newlead_id, lead_id, main")
          .in("contact_id", contactIds)
          .limit(150), // Reduced from 300 for faster queries
        opts.timeoutMs,
        "junction search timeout",
      ).catch(() => ({ data: [] as any[] }));
      rels = data || [];
    }
  }

  // 3) Fetch missing leads from ids collected via contacts and junction
  const directNewIds = Array.from(new Set(contactRows.map((c) => c.newlead_id).filter(Boolean)));
  const junctionNewIds = Array.from(new Set(rels.map((r) => r.newlead_id).filter(Boolean)));
  const allNewIds = Array.from(new Set([...newRows.map((r: any) => r.id), ...directNewIds, ...junctionNewIds]));

  const junctionLegacyIds = Array.from(new Set(rels.map((r) => r.lead_id).filter((x) => x != null))) as number[];
  const legacyIds = Array.from(new Set([...legacyDirectRows.map((l: any) => l.id), ...junctionLegacyIds]));

  const [newLeadsExtra, legacyLeadsFetched] = await Promise.all([
    fetchNewLeadsByIds(allNewIds.filter(Boolean), opts),
    fetchLegacyLeadsByIds(legacyIds.filter((x) => typeof x === "number"), opts),
  ]);

  // Maps
  const newMap = new Map<string, any>(newLeadsExtra.map((l: any) => [l.id, l]));
  const legacyMap = new Map<number, any>(legacyLeadsFetched.map((l: any) => [l.id, l]));

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
    const key = `new:${r.id}:lead`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(r);
    }
  });

  // Add results from contacts and junction
  contactRows.forEach((c: any) => {
    const contactId = String(c.id);
    const relList = relByContact.get(contactId) || [];

    // Direct new lead relation
    if (c.newlead_id && newMap.has(c.newlead_id)) {
      const l = newMap.get(c.newlead_id);
      const r = mapNewLeadRow({ ...l, name: c.name, email: c.email, phone: c.phone, mobile: c.mobile });
      r.isContact = true;
      r.contactName = c.name || "";
      r.isMainContact = false;

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
        r.isContact = !isMain;
        r.contactName = c.name || "";
        r.isMainContact = isMain;

        const key = `new:${r.id}:contact:${contactId}:main:${isMain ? "1" : "0"}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(r);
        }
      }

      if (rel.lead_id != null) {
        const legacy = legacyMap.get(rel.lead_id);
        const r = legacy ? mapLegacyLeadRow(legacy) : mapLegacyLeadRow({ id: rel.lead_id });
        // attach contact data for display
        r.name = c.name || r.name;
        r.email = c.email || r.email;
        r.phone = c.phone || r.phone;
        r.mobile = c.mobile || r.mobile;

        r.isContact = !isMain;
        r.contactName = c.name || "";
        r.isMainContact = isMain;

        const key = `legacy:${r.id}:contact:${contactId}:main:${isMain ? "1" : "0"}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(r);
        }
      }
    });
  });

  // 5) Add legacy lead itself if found (even if no contacts)
  legacyLeadsFetched.forEach((l: any) => {
    const r = mapLegacyLeadRow(l);
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

  return results.slice(0, opts.limit);
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
    const legacyLeads = (legacyLeadsResult.data || []).map(mapLegacyLeadRow);

    // Combine and sort by creation date (most recent first)
    const allLeads = [...newLeads, ...legacyLeads].sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA; // Descending (newest first)
    });

    return allLeads;
  } catch (error) {
    console.error("Error fetching all leads:", error);
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
        return mapLegacyLeadRow(legacyLead);
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
      return mapLegacyLeadRow(data);
    }
  } catch (error) {
    console.error("Error fetching lead by ID:", error);
    return null;
  }
}
