export type DepartmentRef = { id: number; name: string };

export type DepartmentHourTotal = {
  name: string;
  workedMs: number;
  costNis: number;
};

function isSingleGermanOrAustrian(name: string): boolean {
  const text = name.toLowerCase();
  const german = /german/.test(text);
  const austrian = /austria/.test(text);
  return (german || austrian) && !(german && austrian);
}

export function combinedGermanAustrian(targets: { name: string }[]): string {
  const named =
    targets.find((dept) => /austria/i.test(dept.name) && /german/i.test(dept.name) && !/sales/i.test(dept.name)) ||
    targets.find((dept) => /austria/i.test(dept.name) && /german/i.test(dept.name));
  return named?.name || 'Austria and Germany';
}

export function departmentIconSrc(name: string): string {
  const text = name.toLowerCase();
  if (text.includes('austria') || text.includes('german')) return '/department-icons/flag-austria-germany.jpg';
  if (text.includes('commercial') || text.includes('civil')) return '/department-icons/dept-commercial-civil.jpg';
  if (text.includes('small')) return '/department-icons/dept-small-cases.jpg';
  if (text.includes('usa') || text.includes('united states') || text.includes('america')) return '/department-icons/flag-usa.jpg';
  if (text.includes('israel')) return '/department-icons/flag-israel.jpg';
  if (text.includes('poland') || text.includes('polish')) return '/department-icons/flag-poland.jpg';
  if (text.includes('portugal') || text.includes('portuguese')) return '/department-icons/flag-portugal.jpg';
  return '/department-icons/dept-default.jpg';
}

/** Every department name that can appear in the For column, including General when no target is set. */
export function forDepartmentFilterOptions(allDepartments: { name: string }[]): string[] {
  const names: string[] = [];
  const push = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || names.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;
    names.push(trimmed);
  };
  for (const dept of allDepartments) push(dept.name);
  push('General');
  return names;
}

export function agreementDepartmentOptions(targets: { name: string }[]): string[] {
  const names: string[] = [];
  let addedCombined = false;
  for (const dept of targets) {
    if (isSingleGermanOrAustrian(dept.name)) {
      if (!addedCombined) {
        names.push(combinedGermanAustrian(targets));
        addedCombined = true;
      }
      continue;
    }
    if (dept.name && !names.includes(dept.name)) names.push(dept.name);
  }
  return names;
}

export function displayAgreementDepartment(name: string, targets: { name: string }[]): string | null {
  if (!name || name === '—' || name === 'Other') return null;
  if (isSingleGermanOrAustrian(name)) return combinedGermanAustrian(targets);
  return name;
}

/** Employee HR department, with sales twins folded into the regular department. */
export function mergedEmployeeDepartmentName(rawName: string, targets: { name: string }[]): string {
  const original = rawName.trim();
  if (!original) return 'No department';
  const stripped = original.replace(/\s*-\s*Sales$/i, '').trim() || original;
  if (isSingleGermanOrAustrian(stripped) || (/austria/i.test(stripped) && /german/i.test(stripped))) {
    return combinedGermanAustrian(targets);
  }
  if (/commercial/i.test(stripped)) {
    return (
      targets.find((dept) => /commercial/i.test(dept.name) && !/sales/i.test(dept.name))?.name ||
      'Commercial & Civil'
    );
  }
  const match = targets.find((dept) => dept.name.trim().toLowerCase() === stripped.toLowerCase());
  return match?.name || stripped;
}

/** Hours grouped by the For department, not the employee who reported them. */
export function buildForDepartmentTotals(
  lines: { forDepartments: string[]; workedMs: number; costNis: number | null }[],
  allDepartments: { name: string }[],
): DepartmentHourTotal[] {
  const names = forDepartmentFilterOptions(allDepartments);
  const byName = new Map<string, { workedMs: number; costNis: number; order: number }>();
  names.forEach((name, index) => byName.set(name, { workedMs: 0, costNis: 0, order: index }));
  const canonical = (raw: string) => {
    const trimmed = raw.trim();
    if (byName.has(trimmed)) return trimmed;
    return [...byName.keys()].find((name) => name.toLowerCase() === trimmed.toLowerCase()) || trimmed;
  };
  for (const line of lines) {
    const targets = line.forDepartments.map((name) => name.trim()).filter(Boolean);
    if (targets.length === 0) continue;
    const share = targets.length;
    for (const raw of targets) {
      const name = canonical(raw);
      const current = byName.get(name) || { workedMs: 0, costNis: 0, order: byName.size + 1000 };
      current.workedMs += line.workedMs / share;
      current.costNis += (line.costNis || 0) / share;
      byName.set(name, current);
    }
  }
  return [...byName.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
    .map(([name, totals]) => ({ name, workedMs: totals.workedMs, costNis: totals.costNis }));
}

export function buildEmployeeDepartmentTotals(
  lines: { departmentName: string | null; workedMs: number; costNis: number | null }[],
  allDepartments: { name: string }[],
  targets: { name: string }[],
): DepartmentHourTotal[] {
  const preferred = agreementDepartmentOptions(targets);
  const byName = new Map<string, { workedMs: number; costNis: number; order: number }>();
  const ensure = (name: string, order: number) => {
    if (!name || name === 'No department' || byName.has(name)) return;
    byName.set(name, { workedMs: 0, costNis: 0, order });
  };
  preferred.forEach((name, index) => ensure(name, index));
  allDepartments.forEach((dept) => {
    ensure(mergedEmployeeDepartmentName(dept.name, targets), preferred.length + 100);
  });
  for (const line of lines) {
    const name = mergedEmployeeDepartmentName(line.departmentName || '', targets);
    const current = byName.get(name) || { workedMs: 0, costNis: 0, order: byName.size + 1000 };
    current.workedMs += line.workedMs;
    current.costNis += line.costNis || 0;
    byName.set(name, current);
  }
  return [...byName.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
    .map(([name, totals]) => ({ name, workedMs: totals.workedMs, costNis: totals.costNis }));
}
