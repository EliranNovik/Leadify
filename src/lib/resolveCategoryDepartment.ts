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

/** Resolve misc_category → main category → department (shared by Dashboard scoreboard tables). */
export function resolveCategoryAndDepartment(
  categoryValue: string | null | undefined,
  categoryId: string | number | null | undefined,
  miscCategory: any,
  allCategoriesData: any[] | null | undefined,
  categoryNameToDataMap: Map<string, any>,
): ResolvedCategoryDepartment {
  let resolvedMiscCategory = miscCategory;

  if (!resolvedMiscCategory && categoryId != null && allCategoriesData) {
    const numericId = typeof categoryId === 'number' ? categoryId : Number(categoryId);
    if (!Number.isNaN(numericId)) {
      const foundById = (allCategoriesData || []).find((cat: any) => cat.id === numericId);
      if (foundById) resolvedMiscCategory = foundById;
    }
  }

  if (!resolvedMiscCategory && categoryValue?.trim() && categoryNameToDataMap.size > 0) {
    const normalizedName = categoryValue.trim().toLowerCase();
    const mappedCategory = categoryNameToDataMap.get(normalizedName);
    if (mappedCategory) {
      resolvedMiscCategory = mappedCategory;
    } else if (normalizedName.includes('>')) {
      const subPart = normalizedName.split('>').pop()?.trim();
      if (subPart) {
        const bySub = categoryNameToDataMap.get(subPart);
        if (bySub) resolvedMiscCategory = bySub;
      }
    }
  }

  if (!resolvedMiscCategory) {
    return { departmentId: null, departmentName: '—', mainCategoryId: null, mainCategoryName: null };
  }

  const categoryRecord = Array.isArray(resolvedMiscCategory) ? resolvedMiscCategory[0] : resolvedMiscCategory;
  if (!categoryRecord) {
    return { departmentId: null, departmentName: '—', mainCategoryId: null, mainCategoryName: null };
  }

  const mainCategory = Array.isArray(categoryRecord.misc_maincategory)
    ? categoryRecord.misc_maincategory[0]
    : categoryRecord.misc_maincategory;

  if (!mainCategory) {
    return {
      departmentId: null,
      departmentName: categoryRecord.name || '—',
      mainCategoryId: null,
      mainCategoryName: null,
    };
  }

  const department = mainCategory.tenant_departement
    ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement)
    : null;

  const departmentId = department?.id ?? mainCategory.department_id ?? null;
  const departmentName = department?.name || mainCategory.name || categoryRecord.name || '—';
  const mainCategoryId = mainCategory.id != null ? Number(mainCategory.id) : null;
  const mainCategoryName = typeof mainCategory.name === 'string' ? mainCategory.name : null;

  return {
    departmentId: departmentId != null ? Number(departmentId) : null,
    departmentName,
    mainCategoryId: mainCategoryId != null && !Number.isNaN(mainCategoryId) ? mainCategoryId : null,
    mainCategoryName,
  };
}
