/**
 * Utility functions for resolving and matching categories
 */

export interface CategoryData {
    id?: string | number | null;
    name?: string | null;
    parent_id?: string | number | null;
    misc_maincategory?: any;
}

/**
 * Normalize category text for matching
 */
export const normalizeCategoryText = (text: string): string => {
    return text
        .trim()
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove special characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
};

/**
 * Find best matching category from map
 */
export const findBestCategoryMatch = (
    categoryValue: string,
    categoryNameToDataMap: Map<string, any>
): any => {
    if (!categoryValue || typeof categoryValue !== 'string' || categoryValue.trim() === '') {
        return null;
    }

    const trimmedValue = categoryValue.trim();
    const normalizedValue = normalizeCategoryText(trimmedValue);

    // Try exact match first (normalized)
    let mappedCategory = categoryNameToDataMap.get(normalizedValue);
    if (mappedCategory) return mappedCategory;

    // Try exact match with original case
    mappedCategory = categoryNameToDataMap.get(trimmedValue.toLowerCase());
    if (mappedCategory) return mappedCategory;

    // If no exact match, try matching the category name part (before parentheses)
    if (trimmedValue.includes('(')) {
        const categoryNamePart = trimmedValue.split('(')[0].trim().toLowerCase();
        mappedCategory = categoryNameToDataMap.get(categoryNamePart);
        if (mappedCategory) return mappedCategory;

        const normalizedCategoryNamePart = normalizeCategoryText(categoryNamePart);
        mappedCategory = categoryNameToDataMap.get(normalizedCategoryNamePart);
        if (mappedCategory) return mappedCategory;
    }

    // Try removing all spaces and special characters for comparison
    const normalizedValueNoSpaces = normalizedValue.replace(/[\s_-]/g, '');

    // Try exact match after removing spaces
    for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
        const normalizedMapKey = normalizeCategoryText(mapKey).replace(/[\s_-]/g, '');
        if (normalizedMapKey === normalizedValueNoSpaces) {
            return mapValue;
        }
    }

    // Try matching just the category name part (before parentheses in map key)
    for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
        const mapKeyNamePart = mapKey.split('(')[0].trim().toLowerCase().replace(/[\s_-]/g, '');
        if (mapKeyNamePart === normalizedValueNoSpaces || normalizedValueNoSpaces === mapKeyNamePart) {
            return mapValue;
        }
    }

    // Try substring matching (one contains the other) - be more lenient
    for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
        const normalizedMapKey = normalizeCategoryText(mapKey).replace(/[\s_-]/g, '');

        if (normalizedMapKey.includes(normalizedValueNoSpaces) || normalizedValueNoSpaces.includes(normalizedMapKey)) {
            const lengthDiff = Math.abs(normalizedMapKey.length - normalizedValueNoSpaces.length);
            const minLength = Math.min(normalizedMapKey.length, normalizedValueNoSpaces.length);
            // Allow match if difference is small relative to the shorter string (up to 50% difference)
            if (lengthDiff <= Math.max(3, minLength * 0.5)) {
                return mapValue;
            }
        }
    }

    // Try word-by-word matching (for cases like "Small without meetin" vs "Small Without Meeting")
    const valueWords = normalizedValue.split(/[\s_-]+/).filter(w => w.length > 0);
    if (valueWords.length > 0) {
        for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
            const mapKeyWords = normalizeCategoryText(mapKey).split(/[\s_-]+/).filter(w => w.length > 0);
            if (mapKeyWords.length > 0) {
                const matchingWords = mapKeyWords.filter(word =>
                    valueWords.some(vw =>
                        vw === word ||
                        word.includes(vw) ||
                        vw.includes(word) ||
                        word.startsWith(vw) ||
                        vw.startsWith(word)
                    )
                );
                // If most words match (at least 60% of words), consider it a match
                const matchRatio = matchingWords.length / Math.min(mapKeyWords.length, valueWords.length);
                if (matchRatio >= 0.6 && matchingWords.length > 0) {
                    return mapValue;
                }
            }
        }
    }

    // Try character-by-character similarity (Levenshtein-like, simplified)
    let bestMatch: { category: any; score: number } | null = null;
    for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
        const normalizedMapKey = normalizeCategoryText(mapKey);
        const shorter = normalizedValue.length < normalizedMapKey.length ? normalizedValue : normalizedMapKey;
        const longer = normalizedValue.length >= normalizedMapKey.length ? normalizedValue : normalizedMapKey;

        // Calculate simple similarity score
        let matches = 0;
        for (let i = 0; i < shorter.length; i++) {
            if (longer.includes(shorter[i])) matches++;
        }
        const score = matches / Math.max(shorter.length, 1);

        // If similarity is high enough (70%+), consider it a match
        if (score >= 0.7 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { category: mapValue, score };
        }
    }

    if (bestMatch) {
        return bestMatch.category;
    }

    return null;
};

/**
 * Resolve main category from lead data
 */
export const resolveMainCategory = (
    categoryValue: string | null | undefined,
    categoryId: string | number | null | undefined,
    miscCategory: any,
    allCategories: any[],
    categoryNameToDataMap: Map<string, any>
): string => {
    // Check if miscCategory is actually valid (not null, undefined, or empty array)
    const hasMiscCategory = miscCategory !== null &&
        miscCategory !== undefined &&
        !(Array.isArray(miscCategory) && miscCategory.length === 0) &&
        (Array.isArray(miscCategory) ? miscCategory.length > 0 && miscCategory[0] : miscCategory);

    // First, try to use the joined miscCategory if it's valid
    let resolvedMiscCategory = hasMiscCategory ? (Array.isArray(miscCategory) ? miscCategory[0] : miscCategory) : null;

    // If we don't have a valid miscCategory, try to look up by category_id first
    if (!resolvedMiscCategory && categoryId && allCategories.length > 0) {
        const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
        if (categoryById) {
            resolvedMiscCategory = categoryById;
        }
    }

    // If we still don't have a category, try to look it up by text category name in the map
    if (!resolvedMiscCategory && categoryValue && typeof categoryValue === 'string' && categoryValue.trim() !== '' && categoryNameToDataMap.size > 0) {
        const mappedCategory = findBestCategoryMatch(categoryValue, categoryNameToDataMap);
        if (mappedCategory) {
            resolvedMiscCategory = mappedCategory;
        }
    }

    // If we still don't have a category, return 'Uncategorized'
    if (!resolvedMiscCategory) {
        return 'Uncategorized';
    }

    // Handle array case (shouldn't happen at this point, but be safe)
    const categoryRecord = Array.isArray(resolvedMiscCategory) ? resolvedMiscCategory[0] : resolvedMiscCategory;
    if (!categoryRecord) {
        return 'Uncategorized';
    }

    // Extract main category (handle both array and object cases)
    let mainCategory = Array.isArray(categoryRecord.misc_maincategory)
        ? categoryRecord.misc_maincategory[0]
        : categoryRecord.misc_maincategory;

    if (!mainCategory) {
        return 'Uncategorized';
    }

    return mainCategory.name || 'Uncategorized';
};

/**
 * Pre-process leads to ensure all categories are correctly mapped
 */
export const preprocessLeadsCategories = (
    leads: any[],
    isLegacy: boolean,
    allCategories: any[],
    categoryNameToDataMap: Map<string, any>,
    categoriesLoaded: boolean
): any[] => {
    if (!leads || leads.length === 0) return leads;

    // If categories aren't loaded yet, we can't preprocess
    if (!categoriesLoaded || (categoryNameToDataMap.size === 0 && allCategories.length === 0)) {
        console.error('❌ Preprocessing called before categories loaded! This should not happen.', {
            categoriesLoaded,
            mapSize: categoryNameToDataMap.size,
            allCategoriesCount: allCategories.length,
            leadsCount: leads.length
        });
        // Still try to process with what we have
    }

    let resolvedCount = 0;
    let unresolvedCount = 0;
    const unresolvedCategories = new Set<string>();

    const processedLeads = leads.map(lead => {
        // If category is already correctly resolved via join, keep it
        const existingMiscCategory = Array.isArray(lead.misc_category)
            ? (lead.misc_category.length > 0 ? lead.misc_category[0] : null)
            : lead.misc_category;

        if (existingMiscCategory && existingMiscCategory.misc_maincategory) {
            return lead; // Already has valid category
        }

        // Try to resolve category using text value
        if (lead.category && typeof lead.category === 'string' && lead.category.trim() !== '') {
            const resolvedCategory = findBestCategoryMatch(lead.category, categoryNameToDataMap);
            if (resolvedCategory) {
                resolvedCount++;
                // Update the lead with the resolved category
                return {
                    ...lead,
                    misc_category: resolvedCategory,
                    category_id: resolvedCategory.id || lead.category_id
                };
            } else {
                unresolvedCount++;
                unresolvedCategories.add(lead.category);
            }
        }

        // Try to resolve using category_id if available
        if (lead.category_id && allCategories.length > 0) {
            const categoryById = allCategories.find((cat: any) => cat.id.toString() === lead.category_id.toString());
            if (categoryById) {
                resolvedCount++;
                return {
                    ...lead,
                    misc_category: categoryById
                };
            }
        }

        return lead;
    });

    // Debug logging
    if (unresolvedCount > 0) {
        console.warn('⚠️ Preprocessing - Some categories could not be resolved:', {
            totalLeads: leads.length,
            resolved: resolvedCount,
            unresolved: unresolvedCount,
            unresolvedCategories: Array.from(unresolvedCategories).slice(0, 10),
            mapSize: categoryNameToDataMap.size,
            allCategoriesCount: allCategories.length
        });
    } else if (resolvedCount > 0) {
        console.log('✅ Preprocessing - All categories resolved:', {
            totalLeads: leads.length,
            resolved: resolvedCount
        });
    }

    return processedLeads;
};
