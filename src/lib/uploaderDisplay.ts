import { supabase } from './supabase';

export type UploaderDisplay = {
  name: string;
  photoUrl: string | null;
};

function employeePhotoFromUserRow(row: {
  tenants_employee?: { photo_url?: string | null } | { photo_url?: string | null }[] | null;
}): string | null {
  const emp = row.tenants_employee;
  const e = Array.isArray(emp) ? emp[0] : emp;
  const url = e?.photo_url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function displayNameFromUserRow(row: {
  full_name?: string | null;
  email?: string | null;
}): string {
  const fn = row.full_name?.trim();
  if (fn) return fn;
  const em = row.email?.trim();
  if (em) return em;
  return 'Unknown';
}

/** Map `uploaded_by` text → display name + employee photo (matches full_name or email). */
export async function resolveUploaderDisplayByKey(
  keys: string[],
): Promise<Map<string, UploaderDisplay>> {
  const out = new Map<string, UploaderDisplay>();
  const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  if (unique.length === 0) return out;

  const userSelect = 'full_name, email, tenants_employee!users_employee_id_fkey(photo_url)';

  const { data: byFullName, error: errName } = await supabase
    .from('users')
    .select(userSelect)
    .in('full_name', unique);
  if (errName) console.warn('resolveUploaderDisplayByName:', errName);

  for (const row of (byFullName || []) as {
    full_name?: string | null;
    email?: string | null;
    tenants_employee?: { photo_url?: string | null } | { photo_url?: string | null }[] | null;
  }[]) {
    const fn = row.full_name?.trim();
    if (fn && unique.includes(fn)) {
      out.set(fn, { name: displayNameFromUserRow(row), photoUrl: employeePhotoFromUserRow(row) });
    }
  }

  const needEmail = unique.filter((k) => !out.has(k));
  if (needEmail.length === 0) return out;

  const { data: byEmail, error: errEmail } = await supabase
    .from('users')
    .select(userSelect)
    .in('email', needEmail);
  if (errEmail) console.warn('resolveUploaderDisplayByEmail:', errEmail);

  for (const row of (byEmail || []) as {
    full_name?: string | null;
    email?: string | null;
    tenants_employee?: { photo_url?: string | null } | { photo_url?: string | null }[] | null;
  }[]) {
    const em = row.email?.trim();
    if (!em) continue;
    for (const key of needEmail) {
      if (key === em) {
        out.set(key, { name: displayNameFromUserRow(row), photoUrl: employeePhotoFromUserRow(row) });
      }
    }
  }

  for (const k of unique) {
    if (!out.has(k)) {
      out.set(k, { name: k, photoUrl: null });
    }
  }
  return out;
}

export function initialsFromUploaderName(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[parts.length - 1][0];
    if (a && b) return (a + b).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}
