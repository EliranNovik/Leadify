/**
 * Office and personal folders are rows in their own tables rather than in the case folder tree,
 * but since sql/2026-10-25_nested_space_folders.sql they nest the same way. These are the pure
 * parts of walking such a tree — reading, ordering and planning a path — with no store attached,
 * so both of those libraries and the drive can share one set of rules.
 */

/** The little a tree walk needs, which both folder tables report. */
export type SpaceFolderNode = {
  id: string;
  title: string;
  parent_id: string | null;
};

/** Deep enough for any dropped tree worth keeping, and a guard against a silly one. */
export const MAX_SPACE_FOLDER_DEPTH = 6;

export function normaliseSpaceFolderTitle(raw: string): string {
  return raw.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function spaceFolderChildren<T extends SpaceFolderNode>(
  folders: T[],
  parentId: string | null,
): T[] {
  return folders.filter((folder) => (folder.parent_id ?? null) === (parentId ?? null));
}

/** Case-insensitive, since two folders differing only in case would read as one to a person. */
export function findSpaceFolderChild<T extends SpaceFolderNode>(
  folders: T[],
  parentId: string | null,
  title: string,
): T | undefined {
  const needle = normaliseSpaceFolderTitle(title).toLowerCase();
  return spaceFolderChildren(folders, parentId).find(
    (folder) => folder.title.trim().toLowerCase() === needle,
  );
}

/** Root-first chain down to `folderId`, for breadcrumbs. Empty when the id is unknown. */
export function spaceFolderTrail<T extends SpaceFolderNode>(folders: T[], folderId: string | null): T[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const trail: T[] = [];
  let current = byId.get(folderId);
  while (current) {
    trail.unshift(current);
    const parentId = current.parent_id;
    // A row whose parent is missing (or a cycle, which the database rejects) ends the walk.
    if (!parentId || trail.some((item) => item.id === parentId)) break;
    current = byId.get(parentId);
  }
  return trail;
}

export function spaceFolderDepth<T extends SpaceFolderNode>(folders: T[], folderId: string | null): number {
  return Math.max(0, spaceFolderTrail(folders, folderId).length - 1);
}

/** ' / ' joined titles down to the folder, which is how the drive names a folder in a list. */
export function spaceFolderPath<T extends SpaceFolderNode>(folders: T[], folderId: string | null): string {
  return spaceFolderTrail(folders, folderId)
    .map((folder) => folder.title)
    .join(' / ');
}

/**
 * What to call a folder in a list that does not show the nesting: the title alone at the top
 * level, and the whole path inside another folder, so two folders named the same under different
 * parents can still be told apart.
 */
export function spaceFolderLabel<T extends SpaceFolderNode>(folders: T[], folder: T): string {
  return folder.parent_id ? spaceFolderPath(folders, folder.id) : folder.title;
}

/**
 * Depth-first, parents before their children, for a `select` that shows the tree with indents.
 */
export function orderSpaceFolders<T extends SpaceFolderNode>(
  folders: T[],
): Array<{ folder: T; depth: number }> {
  const out: Array<{ folder: T; depth: number }> = [];
  const seen = new Set<string>();

  const walk = (parentId: string | null, depth: number) => {
    for (const folder of spaceFolderChildren(folders, parentId)) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);

  // A folder whose parent is not in the list (a space filter, or a row since deleted) would be
  // lost otherwise, so it is shown at the top rather than hidden.
  for (const folder of folders) {
    if (!seen.has(folder.id)) {
      seen.add(folder.id);
      out.push({ folder, depth: 0 });
    }
  }

  return out;
}

/**
 * The titles a dropped path like `['Reports', '2026', '']` turns into, cleaned up and cut off at
 * the depth limit counted from the folder it is being dropped into. Anything deeper is dropped
 * rather than refused, so a silly tree still files its documents somewhere sensible.
 */
export function spaceFolderSegmentsToCreate<T extends SpaceFolderNode>(
  folders: T[],
  segments: string[],
  baseId: string | null = null,
): string[] {
  const titles = segments.map(normaliseSpaceFolderTitle).filter(Boolean);
  if (titles.length === 0) return [];
  const baseDepth = baseId ? spaceFolderDepth(folders, baseId) + 1 : 0;
  return titles.slice(0, Math.max(0, MAX_SPACE_FOLDER_DEPTH - baseDepth));
}
