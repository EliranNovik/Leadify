/** Digits-only form for phone search (strips +, spaces, dashes, etc.). */
export function phoneDigitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Quote a PostgREST filter value so +, spaces, and hyphens don't break `.or()`. */
function quotePhoneFilterValue(value: string): string {
  return `"${String(value).replace(/"/g, '')}"`;
}

/**
 * Common hyphen/spacing variants for stored phone values (e.g. 050-7748025).
 * ilike on raw DB columns cannot match 0507748025 against 050-7748025 without these.
 */
export function hyphenatedPhoneForms(digits: string): string[] {
  const d = phoneDigitsOnly(digits);
  if (d.length < 4) return [];

  const forms = new Set<string>();

  const addNational = (national: string) => {
    const n = phoneDigitsOnly(national);
    if (!n.startsWith('0') || n.length < 4) return;
    // 050-7748025
    forms.add(`${n.slice(0, 3)}-${n.slice(3)}`);
    if (n.length >= 7) {
      // 050-774-8025
      forms.add(`${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`);
    }
    if (n.length >= 9) {
      // 050-77-48025 (less common, still seen)
      forms.add(`${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`);
    }
  };

  addNational(d);

  if (d.startsWith('0')) {
    const withoutZero = d.slice(1);
    forms.add(`${withoutZero.slice(0, 2)}-${withoutZero.slice(2)}`);
    if (withoutZero.length >= 5) {
      forms.add(`0${withoutZero.slice(0, 2)}-${withoutZero.slice(2)}`);
    }
    if (withoutZero.length >= 7) {
      forms.add(`0${withoutZero.slice(0, 2)}-${withoutZero.slice(2, 5)}-${withoutZero.slice(5)}`);
    }
  } else if (d.startsWith('5')) {
    addNational(`0${d}`);
    forms.add(`${d.slice(0, 2)}-${d.slice(2)}`);
    if (d.length >= 7) {
      forms.add(`${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`);
    }
  }

  if (d.startsWith('972') && d.length >= 6) {
    const afterCc = d.slice(3);
    const mobile = afterCc.startsWith('0') ? afterCc.slice(1) : afterCc;
    if (mobile.length >= 3) {
      forms.add(`972-${mobile.slice(0, 2)}-${mobile.slice(2)}`);
      forms.add(`+972-${mobile.slice(0, 2)}-${mobile.slice(2)}`);
      forms.add(`+972-${mobile.slice(0, 2)}${mobile.slice(2)}`);
      addNational(afterCc.startsWith('0') ? afterCc : `0${mobile}`);
    }
  }

  if (d.startsWith('00972') && d.length >= 8) {
    for (const f of hyphenatedPhoneForms(d.slice(2))) forms.add(f);
  }

  // Subscriber / suffix fragments (e.g. 7748025 → match 050-774-8025)
  if (
    d.length >= 6 &&
    !d.startsWith('0') &&
    !d.startsWith('5') &&
    !d.startsWith('972') &&
    !d.startsWith('00972')
  ) {
    forms.add(`${d.slice(0, 3)}-${d.slice(3)}`);
    if (d.length >= 7) {
      forms.add(`${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`);
      forms.add(`${d.slice(0, 4)}-${d.slice(4)}`);
    }
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

  // NANP: 8452902552 ↔ 1-845-290-2552 / +18452902552
  if (d.length === 10 && !d.startsWith('0') && !d.startsWith('1')) {
    add(`1${d}`);
  } else if (d.length === 11 && d.startsWith('1')) {
    add(d.slice(1));
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
  if (!d || d.length < 4) return false;

  const hasFormatting = trimmed.length > d.length;
  if (hasFormatting && d.length >= 4) return true;
  // E.164 / international (e.g. 18452902552 for +18452902552). Lead ids are ≤10 digits.
  if (d.length >= 11 && d.length <= 15) return true;
  if (d.startsWith('00972') && d.length >= 6) return true;
  if (d.startsWith('972') && d.length >= 5) return true;
  if (d.startsWith('0') && d.length >= 4) return true;
  if (d.startsWith('5') && d.length >= 5) return true;
  return false;
}

/** Strip country / trunk prefix so 0524, 524, 972524, and 1845… compare as the same national number. */
export function nationalPhoneDigits(digits: string): string {
  let d = phoneDigitsOnly(digits);
  if (d.startsWith('00972')) d = d.slice(5);
  else if (d.startsWith('972')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

/**
 * Progressive phone match — same idea as name / lead-number startsWith.
 * Compare raw digits and national digits (0 / 972 stripped) so "0507" still
 * matches 050-7748025. Do not require 4 national digits: "0507" is only 3
 * after stripping the trunk 0, and that used to drop every hit.
 */
export function phoneDigitsPrefixMatch(stored: string, queryDigits: string): boolean {
  const q = phoneDigitsOnly(queryDigits);
  const s = phoneDigitsOnly(stored);
  if (!q || q.length < 4 || !s) return false;
  if (s.startsWith(q) || (q.length >= 7 && s.endsWith(q))) return true;

  const qNat = nationalPhoneDigits(q);
  const sNat = nationalPhoneDigits(s);
  if (!qNat || !sNat) return false;
  return sNat === qNat || sNat.startsWith(qNat) || (qNat.length >= 7 && sNat.endsWith(qNat));
}

/** Check if stored phone/mobile matches a search query (any common prefix format). */
export function phoneDigitsMatch(stored: string, queryDigits: string): boolean {
  if (phoneDigitsPrefixMatch(stored, queryDigits)) return true;

  const storedDigits = phoneDigitsOnly(stored);
  const q = phoneDigitsOnly(queryDigits);
  if (!storedDigits || q.length < 7) return false;

  const patterns = expandPhoneSearchPatterns(q);
  return patterns.some((pattern) => {
    if (!pattern || pattern.length < 7) return false;
    if (storedDigits === pattern) return true;
    if (storedDigits.startsWith(pattern) || pattern.startsWith(storedDigits)) return true;
    if (storedDigits.endsWith(pattern) || pattern.endsWith(storedDigits)) return true;
    return false;
  });
}

/** Build Supabase `.or()` clause for phone/mobile prefix matching (same as names/leads). */
export function buildPhoneSearchOrClause(digits: string, rawQuery?: string): string {
  const d = phoneDigitsOnly(digits);
  const digitPatterns = expandPhoneSearchPatterns(d).slice(0, 6);
  if (digitPatterns.length === 0) return '';

  const searchForms = new Set<string>();
  for (const p of digitPatterns) {
    searchForms.add(p);
    searchForms.add(`+${p}`);
    for (const h of hyphenatedPhoneForms(p).slice(0, 3)) searchForms.add(h);
  }

  const raw = rawQuery?.trim();
  if (raw && raw !== digits && phoneDigitsOnly(raw) === d) {
    searchForms.add(raw);
  }

  const clauses = new Set<string>();
  const forms = Array.from(searchForms).slice(0, 8);
  for (const form of forms) {
    if (/\s/.test(form)) continue;
    const escaped = form.replace(/[%_,]/g, '');
    if (!escaped) continue;
    const quoted = quotePhoneFilterValue(`${escaped}%`);
    clauses.add(`phone.like.${quoted}`);
    clauses.add(`mobile.like.${quoted}`);
  }
  // Stored +18452902552 vs typed 18452902552 — prefix without + misses; contains hits.
  if (d.length >= 10) {
    const quotedContains = quotePhoneFilterValue(`%${d}%`);
    clauses.add(`phone.like.${quotedContains}`);
    clauses.add(`mobile.like.${quotedContains}`);
  }

  return Array.from(clauses).join(',');
}
