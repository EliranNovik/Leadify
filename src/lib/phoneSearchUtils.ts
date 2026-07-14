/** Digits-only form for phone search (strips +, spaces, dashes, etc.). */
export function phoneDigitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Common hyphen/spacing variants for stored phone values (e.g. 052-7748025).
 * ilike on raw DB columns cannot match 0527748025 against 052-7748025 without these.
 */
export function hyphenatedPhoneForms(digits: string): string[] {
  const d = phoneDigitsOnly(digits);
  if (d.length < 4) return [];

  const forms = new Set<string>();

  const addNational = (national: string) => {
    const n = phoneDigitsOnly(national);
    if (!n.startsWith('0') || n.length < 4) return;
    forms.add(`${n.slice(0, 3)}-${n.slice(3)}`);
    if (n.length >= 7) {
      forms.add(`${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`);
    }
  };

  addNational(d);

  if (d.startsWith('0')) {
    const withoutZero = d.slice(1);
    forms.add(`${withoutZero.slice(0, 2)}-${withoutZero.slice(2)}`);
    if (withoutZero.length >= 5) {
      forms.add(`0${withoutZero.slice(0, 2)}-${withoutZero.slice(2)}`);
    }
  } else if (d.startsWith('5')) {
    addNational(`0${d}`);
    forms.add(`${d.slice(0, 2)}-${d.slice(2)}`);
  }

  if (d.startsWith('972') && d.length >= 6) {
    const afterCc = d.slice(3);
    const mobile = afterCc.startsWith('0') ? afterCc.slice(1) : afterCc;
    if (mobile.length >= 3) {
      forms.add(`972-${mobile.slice(0, 2)}-${mobile.slice(2)}`);
      forms.add(`+972-${mobile.slice(0, 2)}-${mobile.slice(2)}`);
      forms.add(`+972 ${mobile.slice(0, 2)} ${mobile.slice(2)}`);
      addNational(afterCc.startsWith('0') ? afterCc : `0${mobile}`);
    }
  }

  if (d.startsWith('00972') && d.length >= 8) {
    for (const f of hyphenatedPhoneForms(d.slice(2))) forms.add(f);
  }

  return Array.from(forms);
}

/**
 * Expand a phone search query into equivalent digit patterns.
 * Handles Israeli formats: 052…, 52…, 97252…, 0097252…, +972…
 */
export function expandPhoneSearchPatterns(digits: string): string[] {
  let d = phoneDigitsOnly(digits);
  if (!d) return [];

  const patterns = new Set<string>();

  const add = (value: string) => {
    const v = phoneDigitsOnly(value);
    if (v.length >= 3 && v.length <= 16) patterns.add(v);
  };

  add(d);

  if (d.startsWith('00972')) {
    const rest = d.slice(5);
    add(rest);
    if (rest && !rest.startsWith('0')) add(`0${rest}`);
    add(`972${rest.startsWith('0') ? rest.slice(1) : rest}`);
  } else if (d.startsWith('972')) {
    const rest = d.slice(3);
    add(rest);
    if (rest && !rest.startsWith('0')) add(`0${rest}`);
    add(`972${rest.startsWith('0') ? rest.slice(1) : rest}`);
  } else if (d.startsWith('00') && d.length > 2) {
    add(d.slice(2));
  }

  if (d.startsWith('0') && d.length >= 3) {
    add(d.slice(1));
    add(`972${d.slice(1)}`);
  } else if (d.startsWith('5') && d.length >= 2) {
    add(`0${d}`);
    add(`972${d}`);
  }

  return Array.from(patterns).sort((a, b) => b.length - a.length);
}

/** True when the query looks like a phone number rather than a lead number or name. */
export function looksLikePhoneSearchQuery(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('@')) return false;
  if (/^[LC]\d/i.test(trimmed)) return false;
  if (trimmed.includes('/')) return false;

  const d = phoneDigitsOnly(trimmed);
  if (!d) return false;

  const hasFormatting = trimmed.length > d.length;
  if (hasFormatting && d.length >= 3) return true;
  if (d.startsWith('00972') && d.length >= 6) return true;
  if (d.startsWith('972') && d.length >= 5) return true;
  if (d.startsWith('0') && d.length >= 3) return true;
  // Pure digits starting with 5 that are short (2–6) collide with lead_number searches;
  // only treat longer local mobiles (7+) as phone-like without formatting.
  if (d.startsWith('5') && d.length >= 7) return true;
  if (d.length >= 7) return true;

  return false;
}

/** Check if stored phone/mobile matches a search query (any common prefix format). */
export function phoneDigitsMatch(stored: string, queryDigits: string): boolean {
  const storedDigits = phoneDigitsOnly(stored);
  if (!storedDigits) return false;

  const patterns = expandPhoneSearchPatterns(queryDigits);
  if (patterns.length === 0) return false;

  return patterns.some((pattern) => {
    if (storedDigits === pattern) return true;
    if (storedDigits.endsWith(pattern) || pattern.endsWith(storedDigits)) return true;
    if (pattern.length <= 6 && storedDigits.includes(pattern)) return true;
    return false;
  });
}

/** Build Supabase `.or()` clause for phone/mobile ilike matching. */
export function buildPhoneSearchOrClause(digits: string, rawQuery?: string): string {
  const digitPatterns = expandPhoneSearchPatterns(digits);
  if (digitPatterns.length === 0) return '';

  const searchForms = new Set<string>();
  for (const p of digitPatterns) {
    searchForms.add(p);
    for (const h of hyphenatedPhoneForms(p)) searchForms.add(h);
  }

  const raw = rawQuery?.trim();
  if (raw && raw !== digits && phoneDigitsOnly(raw) === phoneDigitsOnly(digits)) {
    searchForms.add(raw);
  }

  const clauses = new Set<string>();
  for (const form of searchForms) {
    const escaped = form.replace(/[%_]/g, '');
    if (!escaped) continue;
    if (phoneDigitsOnly(escaped).length >= 7 || escaped.includes('-') || escaped.includes(' ')) {
      clauses.add(`phone.ilike.%${escaped}%`);
      clauses.add(`mobile.ilike.%${escaped}%`);
    } else {
      clauses.add(`phone.ilike.%${escaped}%`);
      clauses.add(`mobile.ilike.%${escaped}%`);
    }
  }

  return Array.from(clauses).join(',');
}
