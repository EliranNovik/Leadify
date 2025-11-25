export const WAITING_STAGE_TARGET = 'Waiting for Mtng sum';

export interface WaitingLeadRow {
  id: string;
  lead_number: string;
  client_name: string;
  category: string;
  topic: string;
  manager: string;
  helper: string;
  meeting_date: string | null;
  lead_type: 'new' | 'legacy';
  applicants: number | null;
  value: string | null;
}

export const formatCategoryDisplayName = (
  allCategories: any[],
  categoryId: string | number | null | undefined,
  fallbackCategory?: string
) => {
  if (!categoryId || categoryId === '---' || categoryId === '--') {
    if (fallbackCategory && fallbackCategory.trim() !== '') {
      const foundCategory = allCategories.find((cat: any) =>
        cat.name?.toLowerCase().trim() === fallbackCategory.toLowerCase().trim()
      );
      if (foundCategory) {
        if (foundCategory.misc_maincategory?.name) {
          return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
        }
        return foundCategory.name;
      }
      return fallbackCategory;
    }
    return 'Not specified';
  }

  const category = allCategories.find((cat: any) => cat.id?.toString() === categoryId.toString());
  if (category) {
    if (category.misc_maincategory?.name) {
      return `${category.name} (${category.misc_maincategory.name})`;
    }
    return category.name;
  }

  return fallbackCategory || 'Not specified';
};

export const getCurrencySymbol = (
  currencyMap: Map<number, string>,
  currencyId: number | null | undefined,
  currencyCode?: string
) => {
  if (currencyCode) return currencyCode;
  if (currencyId && currencyMap.has(currencyId)) {
    return currencyMap.get(currencyId) || '₪';
  }
  return '₪';
};

