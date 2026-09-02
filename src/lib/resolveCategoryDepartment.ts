/**
 * Shared category → department resolution for dashboard + reports.
 *
 * Some categories have a parent/department relationship.
 * When a lead has a category, we look up the category's parent department.
 */

/** Main categories that always roll into the Dashboard scoreboard "Other" column. */
export const SCOREBOARD_OTHER_MAIN_CATEGORY_IDS = new Set([
  2, // other
  6, // Damages
  9, // Other Citizenships
  12, // Portugal
  13, // Poland
  16, // Referral Commission
]);

/** Departments that always roll into scoreboard "Other" (not dedicated columns). */
export const SCOREBOARD_OTHER_DEPARTMENT_IDS = new Set([
  1, // General
]);

export type ResolvedCategoryDepartment = {
  departmentId: number | null;
  departmentName: string;
  mainCategoryId: number | null;
  mainCategoryName: string | null;
};

export function isScoreboardOtherMainCategory(
  id?: number | null,
  name?: string | null,
): boolean {
  if (id != null && !Number.isNaN(Number(id)) && SCOREBOARD_OTHER_MAIN_CATEGORY_IDS.has(Number(id))) {
    return true;
  }
  const n = (name || '').trim().toLowerCase();
  if (!n) return false;
  if (n === 'other' || n === 'damages' || n === 'portugal' || n === 'poland') return true;
  if (n.includes('other citizenship')) return true;
  if (n.includes('referral commission')) return true;
  return false;
}

export function isScoreboardOtherDepartment(
  departmentId?: number | null,
  departmentName?: string | null,
): boolean {
  if (departmentId != null && SCOREBOARD_OTHER_DEPARTMENT_IDS.has(Number(departmentId))) return true;
  return String(departmentName || '').trim().toLowerCase() === 'general';
}

/** Whether a lead should land in the scoreboard Other column (vs a dedicated dept column). */
export function shouldUseScoreboardOtherColumn(params: {
  departmentId: number | null | undefined;
  departmentIds: number[];
  mainCategoryId?: number | null;
  mainCategoryName?: string | null;
}): boolean {
  if (isScoreboardOtherMainCategory(params.mainCategoryId, params.mainCategoryName)) {
    return true;
  }
  if (params.departmentId != null && SCOREBOARD_OTHER_DEPARTMENT_IDS.has(Number(params.departmentId))) {
    return true;
  }
  if (params.departmentId == null || !params.departmentIds.includes(Number(params.departmentId))) {
    return true;
  }
  return false;
}

function unwrapEmbed(value: any): any {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function asFiniteId(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeNameKey(value: unknown): string {
  return String(value || '')
    .replace(/\s*>\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function looksLikeNumericId(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  const s = String(value ?? '').trim();
  return /^\d+$/.test(s);
}

function emptyResolved(): ResolvedCategoryDepartment {
  return { departmentId: null, departmentName: '—', mainCategoryId: null, mainCategoryName: null };
}

function resolveFromCatalogRow(cat: any): ResolvedCategoryDepartment {
  const main = unwrapEmbed(cat?.misc_maincategory);
  if (!main) {
    return {
      departmentId: null,
      departmentName: cat?.name || '—',
      mainCategoryId: null,
      mainCategoryName: null,
    };
  }
  const dept = unwrapEmbed(main.tenant_departement);
  const departmentId = asFiniteId(dept?.id ?? main.department_id);
  return {
    departmentId,
    departmentName: dept?.name || main.name || cat?.name || '—',
    mainCategoryId: asFiniteId(main.id ?? cat?.parent_id),
    mainCategoryName: typeof main.name === 'string' ? main.name : null,
  };
}

/**
 * Load subcategories with parent main category + department.
 * If the FK join hint fails (PostgREST schema cache), stitch the three tables.
 */
export async function fetchCategoriesWithDepartments(client: {
  from: (table: string) => any;
}): Promise<any[]> {
  const joined = await client
    .from('misc_category')
    .select(`
      id,
      name,
      parent_id,
      misc_maincategory!parent_id(
        id,
        name,
        department_id,
        tenant_departement!fk_misc_maincategory_department_id(id, name)
      )
    `)
    .order('name');

  const joinedRows = Array.isArray(joined.data) ? joined.data : [];
  const joinedWithMain = joinedRows.filter((c: any) => unwrapEmbed(c?.misc_maincategory));
  if (!joined.error && joinedWithMain.length > 0) {
    return joinedRows;
  }

  const [{ data: cats }, { data: mains }, { data: depts }] = await Promise.all([
    client.from('misc_category').select('id, name, parent_id').order('name'),
    client.from('misc_maincategory').select('id, name, department_id'),
    client.from('tenant_departement').select('id, name'),
  ]);

  const deptById = new Map<number, any>();
  for (const d of depts || []) {
    const id = asFiniteId(d?.id);
    if (id != null) deptById.set(id, d);
  }
  const mainById = new Map<number, any>();
  for (const m of mains || []) {
    const id = asFiniteId(m?.id);
    if (id == null) continue;
    const deptId = asFiniteId(m.department_id);
    const dept = deptId != null ? deptById.get(deptId) || null : null;
    mainById.set(id, { ...m, tenant_departement: dept });
  }

  return (cats || []).map((c: any) => ({
    ...c,
    misc_maincategory: mainById.get(asFiniteId(c.parent_id) ?? Number.NaN) || null,
  }));
}

/** Name / id → subcategory row, including "main > sub" keys. */
export function buildCategoryNameToDataMap(allCategoriesData: any[] | null | undefined): Map<string, any> {
  const map = new Map<string, any>();
  for (const cat of allCategoriesData || []) {
    if (!cat) continue;
    if (cat.name) {
      map.set(normalizeNameKey(cat.name), cat);
    }
    const main = unwrapEmbed(cat.misc_maincategory);
    if (main?.name && cat.name) {
      map.set(normalizeNameKey(`${main.name} > ${cat.name}`), cat);
    }
    const id = asFiniteId(cat.id);
    if (id != null) {
      map.set(String(id), cat);
    }
  }
  return map;
}

/**
 * Map Sales-sister / alias departments onto the visible scoreboard column
 * (Austria and Germany - Sales → Austria and Germany, Commercial Law → Commercial & Civil).
 */
export function canonicalizeScoreboardDepartment(
  resolved: ResolvedCategoryDepartment,
  departmentTargets: Array<{ id: number; name: string }> | null | undefined,
): ResolvedCategoryDepartment {
  if (isScoreboardOtherMainCategory(resolved.mainCategoryId, resolved.mainCategoryName)) {
    return { ...resolved, departmentId: null, departmentName: 'Other' };
  }
  if (isScoreboardOtherDepartment(resolved.departmentId, resolved.departmentName)) {
    return { ...resolved, departmentId: null, departmentName: 'Other' };
  }

  const targets = departmentTargets || [];
  const rawId = asFiniteId(resolved.departmentId);
  if (rawId != null) {
    const byId = targets.find((d) => Number(d.id) === rawId);
    if (byId) {
      return { ...resolved, departmentId: byId.id, departmentName: byId.name };
    }
  }

  const stripSales = (name: string) => name.replace(/\s*-\s*Sales$/i, '').trim();
  const matchTargetByName = (raw: string | null | undefined) => {
    const key = normalizeNameKey(stripSales(raw || ''));
    if (!key || key === '—') return undefined;
    return targets.find((d) => normalizeNameKey(stripSales(d.name)) === key);
  };

  const byDeptName = matchTargetByName(resolved.departmentName);
  if (byDeptName) {
    return { ...resolved, departmentId: byDeptName.id, departmentName: byDeptName.name };
  }
  const byMainName = matchTargetByName(resolved.mainCategoryName);
  if (byMainName) {
    return { ...resolved, departmentId: byMainName.id, departmentName: byMainName.name };
  }

  const hay = `${resolved.departmentName || ''} ${resolved.mainCategoryName || ''}`;
  if (/austria|german/i.test(hay)) {
    const austriaGermany =
      targets.find((d) => /austria/i.test(d.name) && /german/i.test(d.name) && !/sales/i.test(d.name)) ||
      targets.find((d) => /austria/i.test(d.name) && /german/i.test(d.name));
    if (austriaGermany) {
      return { ...resolved, departmentId: austriaGermany.id, departmentName: austriaGermany.name };
    }
  }

  if (/commercial/i.test(resolved.departmentName || '') || /commercial/i.test(resolved.mainCategoryName || '')) {
    const commercial = targets.find((d) => Number(d.id) === 20) || targets.find((d) => /commercial/i.test(d.name));
    if (commercial) {
      return { ...resolved, departmentId: commercial.id, departmentName: commercial.name };
    }
  }

  return resolved;
}

/**
 * Resolve a lead's category (id, name, or "Main > Sub") to its parent department.
 */
export function resolveCategoryAndDepartment(
  categoryValue: string | number | null | undefined,
  categoryId: string | number | null | undefined,
  miscCategory: any,
  allCategoriesData: any[] | null | undefined,
  categoryNameToDataMap?: Map<string, any>,
): ResolvedCategoryDepartment {
  const catalog = allCategoriesData || [];
  const byId = new Map<number, any>();
  const mainByName = new Map<string, any>();
  for (const cat of catalog) {
    const id = asFiniteId(cat?.id);
    if (id != null) byId.set(id, cat);
    const main = unwrapEmbed(cat?.misc_maincategory);
    if (main?.name) {
      const key = normalizeNameKey(main.name);
      if (!mainByName.has(key)) mainByName.set(key, cat);
    }
  }

  const tryId = (raw: unknown): ResolvedCategoryDepartment | null => {
    const id = asFiniteId(raw);
    if (id == null) return null;
    const cat = byId.get(id);
    return cat ? resolveFromCatalogRow(cat) : null;
  };

  const tryName = (raw: unknown): ResolvedCategoryDepartment | null => {
    const name = String(raw ?? '').trim();
    if (!name) return null;
    if (looksLikeNumericId(name)) return tryId(name);

    const parts = name.split(/\s*>\s*/).map((p) => p.trim()).filter(Boolean);
    const subPart = parts.length >= 2 ? parts[parts.length - 1] : name;
    const mainPart = parts.length >= 2 ? parts[0] : '';

    const candidates = [
      normalizeNameKey(name),
      normalizeNameKey(subPart),
      mainPart && subPart ? normalizeNameKey(`${mainPart} > ${subPart}`) : '',
    ].filter(Boolean);

    for (const key of candidates) {
      const cat = categoryNameToDataMap?.get(key);
      if (cat) return resolveFromCatalogRow(cat);
    }

    const fromCatalog = catalog.find((c) => normalizeNameKey(c?.name) === normalizeNameKey(subPart));
    if (fromCatalog) return resolveFromCatalogRow(fromCatalog);

    if (mainPart) {
      const viaMain = mainByName.get(normalizeNameKey(mainPart));
      if (viaMain) return resolveFromCatalogRow(viaMain);
    }
    const viaMainOnly = mainByName.get(normalizeNameKey(name));
    if (viaMainOnly) return resolveFromCatalogRow(viaMainOnly);

    return null;
  };

  const fromId = tryId(categoryId);
  if (fromId) return fromId;

  const fromValueAsId = looksLikeNumericId(categoryValue) ? tryId(categoryValue) : null;
  if (fromValueAsId) return fromValueAsId;

  const fromName = tryName(categoryValue);
  if (fromName) return fromName;

  const embed = unwrapEmbed(miscCategory);
  if (embed) {
    const fromEmbedId = tryId(embed.id);
    if (fromEmbedId) return fromEmbedId;
    const fromEmbedName = tryName(embed.name);
    if (fromEmbedName) return fromEmbedName;
    const main = unwrapEmbed(embed.misc_maincategory);
    if (main) {
      const dept = unwrapEmbed(main.tenant_departement);
      return {
        departmentId: asFiniteId(dept?.id ?? main.department_id),
        departmentName: dept?.name || main.name || embed.name || '—',
        mainCategoryId: asFiniteId(main.id ?? embed.parent_id),
        mainCategoryName: typeof main.name === 'string' ? main.name : null,
      };
    }
    if (embed.name) {
      return {
        departmentId: null,
        departmentName: String(embed.name),
        mainCategoryId: null,
        mainCategoryName: null,
      };
    }
  }

  return emptyResolved();
}

/** Scoreboard modal label: "Main > Sub", with catalog fallback when the lead join is missing. */
export function formatScoreboardCategoryLabel(
  lead: any,
  categories?: any[] | null,
): string {
  const misc = unwrapEmbed(lead?.misc_category);
  const subFromJoin = String(misc?.name || '').trim();
  const mainFromJoin = String(unwrapEmbed(misc?.misc_maincategory)?.name || '').trim();
  if (mainFromJoin && subFromJoin) return `${mainFromJoin} > ${subFromJoin}`;

  const rawCat = String(lead?.category || '').trim();
  const catId = lead?.category_id ?? (looksLikeNumericId(rawCat) ? rawCat : null);
  const catalog = categories || [];

  const found =
    (catId != null
      ? catalog.find((c: any) => asFiniteId(c?.id) != null && asFiniteId(c.id) === asFiniteId(catId))
      : null) ||
    (rawCat && !looksLikeNumericId(rawCat)
      ? catalog.find((c: any) => normalizeNameKey(c?.name) === normalizeNameKey(rawCat))
      : null);

  if (found) {
    const foundMain = unwrapEmbed(found.misc_maincategory);
    const mainName = String(foundMain?.name || '').trim();
    const subName = String(found.name || '').trim();
    if (mainName && subName) return `${mainName} > ${subName}`;
    return mainName || subName || '—';
  }

  if (mainFromJoin || subFromJoin) return mainFromJoin || subFromJoin;
  if (rawCat && !looksLikeNumericId(rawCat)) return rawCat;
  return '—';
}
