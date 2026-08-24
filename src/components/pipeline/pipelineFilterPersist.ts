const memory = new Map<string, unknown>();

function storageKey(key: string): string {
  return `pipeline_filters_${key}`;
}

/** Load filters kept across leaving the pipeline page and coming back. */
export function loadPipelineFilters<T>(key: string, fallback: T): T {
  if (memory.has(key)) {
    return { ...fallback, ...(memory.get(key) as T) };
  }
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (raw) {
      const parsed = { ...fallback, ...(JSON.parse(raw) as T) };
      memory.set(key, parsed);
      return parsed;
    }
  } catch {
    // Ignore quota / JSON errors and use the in-memory or default value.
  }
  memory.set(key, fallback);
  return { ...fallback };
}

export function savePipelineFilters<T>(key: string, value: T): void {
  memory.set(key, value);
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // Ignore quota errors; in-memory still keeps the value for this session.
  }
}
