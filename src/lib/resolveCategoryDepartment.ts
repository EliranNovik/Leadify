/** Resolve misc_category → main category → department (shared by Dashboard scoreboard tables). */
export function resolveCategoryAndDepartment(
  categoryValue: string | null | undefined,
  categoryId: string | number | null | undefined,
  miscCategory: any,
  allCategoriesData: any[] | null | undefined,
  categoryNameToDataMap: Map<string, any>,
): { departmentId: number | null; departmentName: string } {
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
    return { departmentId: null, departmentName: '—' };
  }

  const categoryRecord = Array.isArray(resolvedMiscCategory) ? resolvedMiscCategory[0] : resolvedMiscCategory;
  if (!categoryRecord) {
    return { departmentId: null, departmentName: '—' };
  }

  const mainCategory = Array.isArray(categoryRecord.misc_maincategory)
    ? categoryRecord.misc_maincategory[0]
    : categoryRecord.misc_maincategory;

  if (!mainCategory) {
    return { departmentId: null, departmentName: categoryRecord.name || '—' };
  }

  const department = mainCategory.tenant_departement
    ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement)
    : null;

  const departmentId = department?.id ?? mainCategory.department_id ?? null;
  const departmentName = department?.name || mainCategory.name || categoryRecord.name || '—';

  return { departmentId: departmentId != null ? Number(departmentId) : null, departmentName };
}
