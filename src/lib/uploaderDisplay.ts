import { supabase } from './supabase';

export type UploaderDisplay = {
  name: string;
  photoUrl: string | null;
  /** False when the key was not found on staff users/employees (identity fallback). */
  matched?: boolean;
};

function employeePhotoFromUserRow(row: {
  tenants_employee?:
    | { photo_url?: string | null; display_name?: string | null }
    | { photo_url?: string | null; display_name?: string | null }[]
    | null;
}): string | null {
  const emp = row.tenants_employee;
  const e = Array.isArray(emp) ? emp[0] : emp;
  const url = e?.photo_url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function displayNameFromUserRow(row: {
  full_name?: string | null;
  email?: string | null;
  tenants_employee?:
    | { photo_url?: string | null; display_name?: string | null }
    | { photo_url?: string | null; display_name?: string | null }[]
    | null;
}): string {
  const emp = row.tenants_employee;
  const e = Array.isArray(emp) ? emp[0] : emp;
  const dn = e?.display_name?.trim();
  if (dn) return dn;
  const fn = row.full_name?.trim();
  if (fn) return fn;
  const em = row.email?.trim();
  if (em) return em;
  return 'Unknown';
}

/** Map `uploaded_by` text → display name + employee photo (full_name, email, or employee display_name). */
export async function resolveUploaderDisplayByKey(
  keys: string[],
): Promise<Map<string, UploaderDisplay>> {
  const out = new Map<string, UploaderDisplay>();
  const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  if (unique.length === 0) return out;

  const userSelect =
    'full_name, email, tenants_employee!users_employee_id_fkey(photo_url, display_name)';

  const { data: byFullName, error: errName } = await supabase
    .from('users')
    .select(userSelect)
    .in('full_name', unique);
  if (errName) console.warn('resolveUploaderDisplayByName:', errName);

  for (const row of (byFullName || []) as {
    full_name?: string | null;
    email?: string | null;
    tenants_employee?:
      | { photo_url?: string | null; display_name?: string | null }
      | { photo_url?: string | null; display_name?: string | null }[]
      | null;
  }[]) {
    const fn = row.full_name?.trim();
    if (fn && unique.includes(fn)) {
      out.set(fn, {
        name: displayNameFromUserRow(row),
        photoUrl: employeePhotoFromUserRow(row),
        matched: true,
      });
    }
  }

  const needEmail = unique.filter((k) => !out.has(k));
  if (needEmail.length > 0) {
    const { data: byEmail, error: errEmail } = await supabase
      .from('users')
      .select(userSelect)
      .in('email', needEmail);
    if (errEmail) console.warn('resolveUploaderDisplayByEmail:', errEmail);

    for (const row of (byEmail || []) as {
      full_name?: string | null;
      email?: string | null;
      tenants_employee?:
        | { photo_url?: string | null; display_name?: string | null }
        | { photo_url?: string | null; display_name?: string | null }[]
        | null;
    }[]) {
      const em = row.email?.trim();
      if (!em) continue;
      for (const key of needEmail) {
        if (key === em) {
          out.set(key, {
            name: displayNameFromUserRow(row),
            photoUrl: employeePhotoFromUserRow(row),
            matched: true,
          });
        }
      }
    }
  }

  // Sub-effort / stage actors often store tenants_employee.display_name, not users.full_name.
  const needDisplay = unique.filter((k) => !out.has(k));
  if (needDisplay.length > 0) {
    const { data: byDisplay, error: errDisplay } = await supabase
      .from('tenants_employee')
      .select('display_name, photo_url')
      .in('display_name', needDisplay);
    if (errDisplay) console.warn('resolveUploaderDisplayByEmployeeName:', errDisplay);

    for (const row of (byDisplay || []) as {
      display_name?: string | null;
      photo_url?: string | null;
    }[]) {
      const dn = row.display_name?.trim();
      if (!dn || !needDisplay.includes(dn)) continue;
      const photo = typeof row.photo_url === 'string' && row.photo_url.trim() ? row.photo_url.trim() : null;
      out.set(dn, { name: dn, photoUrl: photo, matched: true });
    }
  }

  for (const k of unique) {
    if (!out.has(k)) {
      out.set(k, { name: k, photoUrl: null, matched: false });
    }
  }
  return out;
}

/**
 * Gradients for an initials avatar, deep enough in the middle for white initials to read on them.
 */
const UPLOADER_AVATAR_GRADIENTS = [
  'from-violet-400 to-indigo-700',
  'from-sky-400 to-blue-700',
  'from-emerald-400 to-teal-700',
  'from-amber-400 to-orange-600',
  'from-rose-400 to-pink-700',
  'from-fuchsia-400 to-purple-700',
  'from-cyan-400 to-sky-700',
  'from-lime-400 to-green-700',
  'from-orange-400 to-rose-600',
  'from-indigo-400 to-violet-800',
] as const;

/**
 * Which gradient an initials avatar wears. Picked from the name rather than at random, so one
 * person keeps one colour everywhere and across reloads, while a list of people stays varied.
 */
export function uploaderAvatarGradient(name: string): string {
  const key = name.trim().toLowerCase();
  if (!key) return UPLOADER_AVATAR_GRADIENTS[0];
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    // Shift and subtract, which is the usual string hash: cheap and spread out enough that
    // 'Anna Cohen' and 'Anna Cohn' do not land on the same colour.
    hash = (hash << 5) - hash + key.charCodeAt(index);
    hash |= 0;
  }
  return UPLOADER_AVATAR_GRADIENTS[Math.abs(hash) % UPLOADER_AVATAR_GRADIENTS.length];
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
