import { supabase } from './supabase';
import {
  buildCategoryNameToDataMap,
  canonicalizeScoreboardDepartment,
  fetchCategoriesWithDepartments,
  isScoreboardOtherMainCategory,
  resolveCategoryAndDepartment,
} from './resolveCategoryDepartment';
import {
  buildPhoneSearchOrClause,
  looksLikePhoneSearchQuery,
  phoneDigitsOnly,
} from './phoneSearchUtils';
import { buildCalendarClientRoute } from './calendarClientRoute';
import { expandLeadCaseDocumentLeadNumbers } from './leadCaseDocumentKeys';
import type { MainDepartment } from './mainDepartments';

/**
 * Which department a case belongs to, worked out the way the dashboard's scoreboard does it: a
 * lead carries a category, the category hangs off a main category, and the main category belongs
 * to a department.
 *
 * The drive needs the reverse of that lookup — every case of one department — so rather than
 * reading each case's lead one at a time, this resolves the department of each *category* once and
 * then asks for the leads carrying those categories.
 */

/** Cases outside every scoreboard department, which the dashboard also keeps in one bucket. */
export const CASE_DEPARTMENT_OTHER = 'other';

export type CaseDepartmentKey = number | typeof CASE_DEPARTMENT_OTHER;

/** How many of a department's leads are collected before the lookup stops. */
const DEPARTMENT_LEAD_SCAN_LIMIT = 20000;
const LEAD_PAGE_SIZE = 1000;

type CategorySplit = {
  /** Category ids per department, plus the ids that belong to no scoreboard department. */
  byDepartment: Map<CaseDepartmentKey, number[]>;
  /** Category names per department, for leads that kept a name instead of an id. */
  namesByDepartment: Map<CaseDepartmentKey, string[]>;
};

let categorySplitCache: { departmentsKey: string; split: CategorySplit } | null = null;
let catalogueCache: { rows: any[]; nameMap: Map<string, any> } | null = null;
const leadNumberCache = new Map<string, Set<string>>();

/** The category catalogue, read once: it changes only when the firm adds a practice area. */
async function loadCatalogue(): Promise<{ rows: any[]; nameMap: Map<string, any> }> {
  if (!catalogueCache) {
    const rows = await fetchCategoriesWithDepartments(supabase);
    catalogueCache = { rows, nameMap: buildCategoryNameToDataMap(rows) };
  }
  return catalogueCache;
}

/**
 * Legacy cases were filed with whatever category text was current at the time, and plenty of
 * those names are no longer in the catalogue ("German|Austrian"). When the catalogue can say
 * nothing about a lead, what its category says in words is all there is left to sort it by: each
 * hint lists the words that mark a case, and the words its department's name has to contain.
 */
const CATEGORY_TEXT_HINTS: Array<{ words: string[]; department: RegExp[] }> = [
  {
    words: ['german', 'austria', 'austrian', 'österreich', 'oesterreich', 'deutsch'],
    department: [/austria/i, /german/i],
  },
];

/** The department a hint points at: the one named after all of its words, else any of them. */
function departmentMatchingHint(
  hint: { department: RegExp[] },
  departments: MainDepartment[],
): MainDepartment | undefined {
  return (
    departments.find((department) => hint.department.every((part) => part.test(department.name))) ||
    departments.find((department) => hint.department.some((part) => part.test(department.name)))
  );
}

function departmentFromCategoryText(
  text: string,
  departments: MainDepartment[],
): number | null {
  const haystack = text.toLowerCase();
  if (!haystack.trim()) return null;
  for (const hint of CATEGORY_TEXT_HINTS) {
    if (!hint.words.some((word) => haystack.includes(word))) continue;
    const match = departmentMatchingHint(hint, departments);
    if (match) return match.id;
  }
  return null;
}

/** The category columns every lead carries, whichever of the two tables it lives in. */
type LeadCategoryFields = {
  category?: unknown;
  category_id?: unknown;
  misc_category?: unknown;
};

/**
 * Resolves a lead's department the way the dashboard's scoreboard does — the lead's category, its
 * main category, then that main category's department — accepting the category as an id, as a
 * name, or as the "Main > Sub" text legacy leads sometimes hold. A case the catalogue knows
 * nothing about falls back to the words of its category.
 */
async function loadDepartmentOfLead(
  departments: MainDepartment[],
): Promise<(lead: LeadCategoryFields) => CaseDepartmentKey> {
  const { rows, nameMap } = await loadCatalogue();
  const targets = departments.map((department) => ({ id: department.id, name: department.name }));
  const known = new Set(departments.map((department) => department.id));

  return (lead) => {
    const resolved = canonicalizeScoreboardDepartment(
      resolveCategoryAndDepartment(
        (lead?.category as string | number | null | undefined) ?? null,
        (lead?.category_id as string | number | null | undefined) ?? null,
        lead?.misc_category ?? null,
        rows,
        nameMap,
      ),
      targets,
    );

    if (resolved.departmentId != null && known.has(Number(resolved.departmentId))) {
      return Number(resolved.departmentId);
    }
    // A category the scoreboard does file under "Other" belongs there, however its name reads.
    // Anything else that got this far is a case the catalogue could not place: all that is left
    // is what its category, or the main category behind it, says in words.
    if (!isScoreboardOtherMainCategory(resolved.mainCategoryId, resolved.mainCategoryName)) {
      const fromText = departmentFromCategoryText(
        [lead?.category, resolved.mainCategoryName, resolved.departmentName]
          .map((value) => String(value ?? ''))
          .join(' '),
        departments,
      );
      if (fromText != null) return fromText;
    }
    return CASE_DEPARTMENT_OTHER;
  };
}

function pushInto<K>(map: Map<K, string[] | number[]>, key: K, value: string | number): void {
  const list = map.get(key);
  if (list) (list as unknown[]).push(value);
  else map.set(key, [value] as string[] | number[]);
}

/**
 * Sorts the category catalogue into departments. Done once: the catalogue is small and changes
 * only when the firm adds a practice area.
 */
async function loadCategorySplit(departments: MainDepartment[]): Promise<CategorySplit> {
  const departmentsKey = departments.map((department) => department.id).join(',');
  if (categorySplitCache && categorySplitCache.departmentsKey === departmentsKey) {
    return categorySplitCache.split;
  }

  const { rows: catalogue } = await loadCatalogue();
  const departmentOf = await loadDepartmentOfLead(departments);

  const split: CategorySplit = { byDepartment: new Map(), namesByDepartment: new Map() };

  for (const category of catalogue || []) {
    const categoryId = Number(category?.id);
    if (!Number.isFinite(categoryId)) continue;

    const key = departmentOf({
      category: category?.name ?? null,
      category_id: categoryId,
      misc_category: category,
    });

    pushInto(split.byDepartment, key, categoryId);
    // A legacy lead's category column holds text rather than an id, and not always the
    // subcategory's name: some rows carry the main category, some the "Main > Sub" label, some
    // the id as text. Every form is collected so the filter picks those leads up too.
    const main = Array.isArray(category?.misc_maincategory)
      ? category.misc_maincategory[0]
      : category?.misc_maincategory;
    const mainName = String(main?.name || '').trim();
    const categoryName = String(category?.name || '').trim();
    for (const form of [
      categoryName,
      mainName,
      mainName && categoryName ? `${mainName} > ${categoryName}` : '',
      String(categoryId),
    ]) {
      if (form) pushInto(split.namesByDepartment, key, form);
    }
  }

  categorySplitCache = { departmentsKey, split };
  return split;
}

/**
 * A legacy case is filed under the number people use for it, which that table keeps in
 * `manual_id` — `lead_number` is often empty there, and a case with neither is known by its row
 * id. All three are read, so a legacy case is found whichever of them its documents were filed
 * under.
 */
const LEAD_KEY_SELECT: Record<'leads' | 'leads_lead', string> = {
  leads: 'lead_number',
  leads_lead: 'id, lead_number, manual_id',
};

function leadKeysOf(row: any): string[] {
  return [row?.lead_number, row?.manual_id, row?.id]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

/** Every lead number in one table whose category is one of `categoryIds` / `categoryNames`. */
async function leadNumbersForCategories(
  table: 'leads' | 'leads_lead',
  categoryIds: number[],
  categoryNames: string[],
  textHints: string[],
): Promise<string[]> {
  const found: string[] = [];

  const collect = async (apply: (request: any) => any) => {
    for (let page = 0; page * LEAD_PAGE_SIZE < DEPARTMENT_LEAD_SCAN_LIMIT; page += 1) {
      const from = page * LEAD_PAGE_SIZE;
      const { data, error } = await apply(
        supabase.from(table).select(LEAD_KEY_SELECT[table]),
      ).range(from, from + LEAD_PAGE_SIZE - 1);
      // A missing legacy table or a column it does not have is not worth failing the filter over.
      if (error) return;
      const rows = (data || []) as any[];
      for (const row of rows) found.push(...leadKeysOf(row));
      if (rows.length < LEAD_PAGE_SIZE) return;
    }
  };

  if (categoryIds.length > 0) {
    await collect((request) => request.in('category_id', categoryIds));
  }
  // Older leads kept the category as text, so those are picked up by name as well.
  if (categoryNames.length > 0) {
    await collect((request) => request.is('category_id', null).in('category', categoryNames));
  }
  // And the ones whose category text the catalogue no longer knows, matched on the words it
  // contains — the same last resort a single lead's department falls back to.
  if (textHints.length > 0) {
    const clause = textHints.map((word) => `category.ilike."%${word}%"`).join(',');
    await collect((request) => request.is('category_id', null).or(clause));
  }

  return found;
}

/**
 * The lead numbers of every case in one department. Cached per department, since the answer only
 * changes when a lead's category changes and the list is only used to narrow what is on screen.
 */
export async function fetchDepartmentCaseLeadNumbers(
  department: CaseDepartmentKey,
  departments: MainDepartment[],
): Promise<Set<string>> {
  const cacheKey = `${department}:${departments.map((item) => item.id).join(',')}`;
  const cached = leadNumberCache.get(cacheKey);
  if (cached) return cached;

  const split = await loadCategorySplit(departments);
  const categoryIds = (split.byDepartment.get(department) as number[]) || [];
  const categoryNames = [...new Set((split.namesByDepartment.get(department) as string[]) || [])];
  const target = departments.find((item) => item.id === department);
  const textHints = target
    ? CATEGORY_TEXT_HINTS.filter((hint) =>
        hint.department.every((part) => part.test(target.name)),
      ).flatMap((hint) => hint.words)
    : [];

  if (categoryIds.length === 0 && categoryNames.length === 0 && textHints.length === 0) {
    const empty = new Set<string>();
    leadNumberCache.set(cacheKey, empty);
    return empty;
  }

  const [fromNew, fromLegacy] = await Promise.all([
    leadNumbersForCategories('leads', categoryIds, categoryNames, textHints),
    leadNumbersForCategories('leads_lead', categoryIds, categoryNames, textHints),
  ]);

  const leadNumbers = new Set([...fromNew, ...fromLegacy]);
  leadNumberCache.set(cacheKey, leadNumbers);
  return leadNumbers;
}

/**
 * One colour per department, assigned down the list rather than hashed, so no two departments on
 * screen can end up wearing the same dot.
 */
const DEPARTMENT_DOT_COLOURS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-pink-500',
] as const;

export function buildDepartmentColours(
  departments: MainDepartment[],
): Map<CaseDepartmentKey, string> {
  const colours = new Map<CaseDepartmentKey, string>();
  departments.forEach((department, index) => {
    colours.set(department.id, DEPARTMENT_DOT_COLOURS[index % DEPARTMENT_DOT_COLOURS.length]);
  });
  colours.set(CASE_DEPARTMENT_OTHER, 'bg-slate-400');
  return colours;
}

export type CaseLeadInfo = {
  name: string | null;
  department: CaseDepartmentKey;
  departmentName: string | null;
  /** Where the lead's own page lives, which is rarely `/clients/<the case number>`. */
  route: string;
};

/**
 * How many lead numbers go into one lookup, so the request URL stays a sane length. Each one is
 * asked for in several forms, so the list sent is a few times this.
 */
const LEAD_LOOKUP_CHUNK = 60;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Everything about a lead a case folder needs: who it is for, and where to open it. */
const CASE_LEAD_SELECT = 'id, lead_number, manual_id, name, category, category_id';

/** Which column a case number can be filed under, tried in this order. */
type LeadLookup = ['leads' | 'leads_lead', 'lead_number' | 'manual_id' | 'id'];

const LEAD_LOOKUPS: LeadLookup[] = [
  ['leads', 'lead_number'],
  // A case migrated into the new table keeps its old number in `manual_id`, which is the number
  // its documents were filed under.
  ['leads', 'manual_id'],
  ['leads_lead', 'manual_id'],
  ['leads_lead', 'lead_number'],
  ['leads_lead', 'id'],
];

/**
 * The lead page of one lead row. A new lead is opened by its number, a legacy one by its numeric
 * id, and a sub-case of either carries the number it is filed under in the query — the same rules
 * the calendar opens a client with.
 */
function routeOfLeadRow(table: 'leads' | 'leads_lead', row: any): string {
  if (table === 'leads') {
    return buildCalendarClientRoute({
      lead_type: 'new',
      lead_number: String(row?.lead_number ?? '').trim() || null,
      manual_id: row?.manual_id ?? null,
      id: row?.id ?? null,
    });
  }
  // Legacy cases are known by their manual id ("115900/2"), which is also what marks a sub-case.
  const known = [row?.manual_id, row?.lead_number]
    .map((value) => String(value ?? '').trim())
    .find(Boolean);
  const id = String(row?.id ?? '').trim();
  if (!id) return known ? `/clients/${encodeURIComponent(known)}` : '/clients';
  return buildCalendarClientRoute({ lead_type: 'legacy', id, lead_number: known ?? null });
}

/**
 * A case number of the shape `113138/3`, which is a legacy master's id and the case's place
 * under it. `/1` is the master itself and is found by its own id, so it is not one of these.
 */
function legacySubCaseParts(key: string): { base: string; suffix: number } | null {
  const match = /^(\d+)\/(\d+)$/.exec(key.replace(/^[LC]/i, '').trim());
  if (!match) return null;
  const suffix = Number(match[2]);
  return suffix >= 2 ? { base: match[1], suffix } : null;
}

/**
 * The lead rows behind legacy sub-case numbers, which are stored nowhere: masterLeadApi's
 * `formatLegacyLeadNumber` makes `113138/3` up at display time out of the master's id and the
 * row's place among its siblings, ordered by id, counting from `/2`. Read back the same way
 * round, so a document filed under the number as it was displayed still finds its lead.
 */
async function readLegacySubCases(keys: string[]): Promise<Map<string, any>> {
  const rows = new Map<string, any>();
  const parts = new Map<string, { base: string; suffix: number }>();
  for (const key of keys) {
    const part = legacySubCaseParts(key);
    if (part) parts.set(key, part);
  }
  if (parts.size === 0) return rows;

  const bases = Array.from(new Set(Array.from(parts.values(), (part) => part.base)));
  const { data, error } = await supabase
    .from('leads_lead')
    .select(`${CASE_LEAD_SELECT}, master_id`)
    .in('master_id', bases)
    // The order the suffixes were handed out in.
    .order('id', { ascending: true });
  if (error) return rows;

  const siblings = new Map<string, any[]>();
  for (const row of (data || []) as any[]) {
    const base = String(row?.master_id ?? '').trim();
    const known = siblings.get(base);
    if (known) known.push(row);
    else siblings.set(base, [row]);
  }

  // The number each sibling is shown as, handed out the way masterLeadApi hands it out: by
  // position in the order, counting from `/2`. A master that points at itself still holds its
  // place in that order while showing as `/1`, so the count is taken over the whole list.
  const byNumber = new Map<string, any>();
  for (const [base, list] of siblings) {
    list.forEach((row, index) => {
      const own = String(row?.id ?? '').trim();
      const itsOwnMaster = own !== '' && own === String(row?.master_id ?? '').trim();
      byNumber.set(`${base}/${itsOwnMaster ? 1 : index + 2}`, row);
    });
  }

  for (const [key, { base, suffix }] of parts) {
    const row = byNumber.get(`${base}/${suffix}`);
    if (row) rows.set(key, row);
  }
  return rows;
}

const caseRouteCache = new Map<string, string>();

/**
 * The client name and department of each case on screen. One lookup per page of cases, rather
 * than the per-case query the alternative would be.
 */
export async function fetchCaseLeadInfo(
  leadNumbers: string[],
  departments: MainDepartment[],
): Promise<Map<string, CaseLeadInfo>> {
  const wanted = Array.from(new Set(leadNumbers.map((value) => String(value || '').trim()).filter(Boolean)));
  const info = new Map<string, CaseLeadInfo>();
  if (wanted.length === 0) return info;

  // Started here and awaited once a read comes back, so the category catalogue loads alongside
  // the leads rather than ahead of them. Without the catalogue a case cannot be sorted, but its
  // name and its page are still worth having.
  const departmentOfLead = loadDepartmentOfLead(departments).catch(
    () => () => CASE_DEPARTMENT_OTHER as CaseDepartmentKey,
  );
  const departmentById = new Map(departments.map((department) => [department.id, department.name]));

  // The drive files a document under the case number as it was typed, while the lead keeps that
  // number with or without its L/C prefix — and a master case filed as `123` is shown as `123/1`.
  // Asking for one spelling alone is what left whole sub-cases without a name.
  const formsOf = new Map(wanted.map((key) => [key, expandLeadCaseDocumentLeadNumbers(key)]));
  // A case asked for by its own exact number owns that spelling outright; the other forms go to
  // whichever case claimed them first.
  const askedFor = new Map<string, string>();
  for (const key of wanted) {
    askedFor.set(key.toLowerCase(), key);
  }
  for (const [key, forms] of formsOf) {
    for (const form of forms) {
      const lower = form.toLowerCase();
      if (!askedFor.has(lower)) askedFor.set(lower, key);
    }
  }

  /** What the case list shows for one lead row, once it is known which lead a number meant. */
  const infoOfRow = async (row: any, route: string): Promise<CaseLeadInfo> => {
    const department = (await departmentOfLead)(row);
    return {
      name: String(row?.name || '').trim() || null,
      department,
      departmentName:
        department === CASE_DEPARTMENT_OTHER ? 'Other' : departmentById.get(department) ?? null,
      route,
    };
  };

  const readTable = async (
    [table, column]: LeadLookup,
    numbers: string[],
  ): Promise<Map<string, CaseLeadInfo>> => {
    const found = new Map<string, CaseLeadInfo>();
    const forms = Array.from(
      new Set(numbers.flatMap((number) => formsOf.get(number) ?? [number])),
    );
    // A case filed under a row id is only ever a number; asking by a case number would fail.
    const values = column === 'id' ? forms.filter((value) => /^\d+$/.test(value)) : forms;
    if (values.length === 0) return found;

    const { data, error } = await supabase
      .from(table)
      .select(CASE_LEAD_SELECT)
      .in(column, values);
    // The legacy table may not exist on every deployment, and a name is not worth failing over.
    if (error) return found;

    for (const row of (data || []) as any[]) {
      // Keyed by the number the documents were filed under, whichever spelling of it answered.
      const stored = String(row?.[column] ?? '').trim();
      const leadNumber = askedFor.get(stored.toLowerCase());
      if (!leadNumber || found.has(leadNumber)) continue;
      found.set(leadNumber, await infoOfRow(row, routeOfLeadRow(table, row)));
    }
    return found;
  };

  for (const part of chunk(wanted, LEAD_LOOKUP_CHUNK)) {
    // Every place a case number can be filed, asked at once. Tried one after the next, a legacy
    // case took three or four round trips to find, which is what had the client names turning up
    // a beat after the list they belong to.
    const results = await Promise.all(LEAD_LOOKUPS.map((lookup) => readTable(lookup, part)));
    // Merged in the order the lookups are listed, which is the order they take precedence in.
    for (const found of results) {
      for (const [leadNumber, lead] of found) {
        if (info.has(leadNumber)) continue;
        info.set(leadNumber, lead);
        caseRouteCache.set(leadNumber, lead.route);
      }
    }
  }

  // What no column answered to is either a legacy sub-case, which is numbered rather than stored,
  // or a number with no lead behind it at all.
  const subCases = await readLegacySubCases(wanted.filter((key) => !info.has(key)));
  for (const [leadNumber, row] of subCases) {
    const route = buildCalendarClientRoute({
      lead_type: 'legacy',
      id: row?.id ?? null,
      lead_number: leadNumber,
    });
    info.set(leadNumber, await infoOfRow(row, route));
    caseRouteCache.set(leadNumber, route);
  }

  return info;
}

/**
 * Where one case's lead page lives, for a case whose lead has not otherwise been read — a
 * document's own case, say, rather than a case in the list.
 */
export async function fetchCaseLeadRoute(caseKey: string): Promise<string> {
  const key = String(caseKey || '').trim();
  if (!key) return '/clients';

  const cached = caseRouteCache.get(key);
  if (cached) return cached;

  // The same spellings the case list asks by, since the number was filed as typed.
  const forms = expandLeadCaseDocumentLeadNumbers(key);
  for (const [table, column] of LEAD_LOOKUPS) {
    const values = column === 'id' ? forms.filter((value) => /^\d+$/.test(value)) : forms;
    if (values.length === 0) continue;
    const { data, error } = await supabase
      .from(table)
      .select(CASE_LEAD_SELECT)
      .in(column, values)
      .limit(1);
    if (error || !data || data.length === 0) continue;
    const route = routeOfLeadRow(table, data[0]);
    caseRouteCache.set(key, route);
    return route;
  }

  // A legacy sub-case answers to no column, being numbered by its master and its place under it.
  const subCase = (await readLegacySubCases([key])).get(key);
  if (subCase) {
    const route = buildCalendarClientRoute({
      lead_type: 'legacy',
      id: subCase?.id ?? null,
      lead_number: key,
    });
    caseRouteCache.set(key, route);
    return route;
  }

  // Still nothing, and yet the number names a case under another: that base case's page is where
  // the app keeps sub-cases. Better that than a URL built from a number nothing answers to.
  const base = key.includes('/') ? key.split('/')[0] : '';
  if (base) {
    const baseRoute = await fetchCaseLeadRoute(base);
    if (baseRoute !== '/clients' && !baseRoute.includes('?')) {
      const route = `${baseRoute}?lead=${encodeURIComponent(key)}`;
      caseRouteCache.set(key, route);
      return route;
    }
  }

  // Nothing found: the number itself is still what the lead page is best able to look up.
  return `/clients/${encodeURIComponent(key)}`;
}

/** How many matching people one search looks at, and how many cases it may answer with. */
const NAME_SEARCH_LIMIT = 40;
const NAME_SEARCH_LINKS = 200;

/** A value inside a PostgREST `or` filter, where @ . - and spaces are all ordinary characters. */
function quotedFilterValue(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/**
 * Name, email and — when the term reads as a number — phone and mobile, so a person is found by
 * whichever of their details you happen to remember. Phones go through the shared clause builder,
 * which knows the formats they are stored in (+972, 050-, 0050…).
 */
function personMatchClause(needle: string): string {
  const parts = [
    `name.ilike.${quotedFilterValue(`%${needle}%`)}`,
    `email.ilike.${quotedFilterValue(`%${needle}%`)}`,
  ];
  if (looksLikePhoneSearchQuery(needle)) {
    const phones = buildPhoneSearchOrClause(phoneDigitsOnly(needle), needle);
    if (phones) parts.push(phones);
  }
  return parts.join(',');
}

/**
 * The cases of everyone a term matches — the lead's own client details and the contacts attached
 * to it. The documents view only carries the case number, so without this a search for a person
 * finds nothing of theirs.
 */
export async function findLeadNumbersByPerson(term: string): Promise<string[]> {
  const needle = String(term || '').replace(/[%,()*\\]/g, ' ').trim();
  if (needle.length < 2) return [];
  const clause = personMatchClause(needle);
  const found = new Set<string>();

  const addFrom = (result: { data: any[] | null; error: unknown }) => {
    if (result.error) return;
    for (const row of result.data || []) {
      for (const key of leadKeysOf(row)) found.add(key);
    }
  };

  const [fromNew, fromLegacy, contacts] = await Promise.all([
    supabase.from('leads').select(LEAD_KEY_SELECT.leads).or(clause).limit(NAME_SEARCH_LIMIT),
    supabase
      .from('leads_lead')
      .select(LEAD_KEY_SELECT.leads_lead)
      .or(clause)
      .limit(NAME_SEARCH_LIMIT),
    supabase.from('leads_contact').select('id').or(clause).limit(NAME_SEARCH_LIMIT),
  ]);

  addFrom(fromNew as any);
  addFrom(fromLegacy as any);

  const contactIds = ((contacts.data || []) as any[])
    .map((row) => Number(row?.id))
    .filter((id) => Number.isFinite(id));
  if (contactIds.length === 0) return [...found];

  const { data: links, error: linksError } = await supabase
    .from('lead_leadcontact')
    .select('lead_id, newlead_id')
    .in('contact_id', contactIds)
    .limit(NAME_SEARCH_LINKS);
  if (linksError) return [...found];

  const legacyIds = [
    ...new Set(
      (links || [])
        .map((link: any) => Number(link?.lead_id))
        .filter((id: number) => Number.isFinite(id)),
    ),
  ];
  const newIds = [
    ...new Set(
      (links || [])
        .map((link: any) => String(link?.newlead_id || '').trim())
        .filter(Boolean),
    ),
  ];

  const [legacyLeads, newLeads] = await Promise.all([
    legacyIds.length > 0
      ? supabase.from('leads_lead').select(LEAD_KEY_SELECT.leads_lead).in('id', legacyIds)
      : Promise.resolve({ data: [], error: null }),
    newIds.length > 0
      ? supabase.from('leads').select(LEAD_KEY_SELECT.leads).in('id', newIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  addFrom(legacyLeads as any);
  addFrom(newLeads as any);

  return [...found];
}

/** Forgets the cached lookups, for when a lead's category has just been changed. */
export function clearCaseDepartmentCache(): void {
  categorySplitCache = null;
  leadNumberCache.clear();
}
