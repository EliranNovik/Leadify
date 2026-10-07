import { supabase } from './supabase';

export type ExternalFirmRow = {
  id: string;
  name: string;
  /** The same firm's other-language or registered name; see `firmMatchesSearch`. */
  legalName: string;
  /** Public URL of the firm's logo, empty for the majority that have none. */
  profileImageUrl: string;
};

/** Niqqud and cantillation: stored names sometimes carry them, typed ones almost never do. */
const HEBREW_MARKS = /[\u0591-\u05C7]/g;

/**
 * A firm name reduced to what two people typing it would agree on.
 *
 * Punctuation is dropped rather than kept because the same firm is written `בע"מ` and `בעמ`,
 * `Bar-Am` and `Bar Am`, so leaving it in means the search depends on guessing which.
 */
export function normalizeFirmSearchText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(HEBREW_MARKS, '')
    .replace(/["'`\u2018\u2019\u201C\u201D\u05F3\u05F4]/g, '')
    .replace(/[\s\-_.,&()/]+/g, ' ')
    .trim()
    .toLowerCase();
}

/*
 * Hebrew letters as the consonant a Latin speller would write.
 *
 * Uppercase on purpose: the input is lowercased first, so these symbols cannot be mistaken for
 * letters still awaiting translation. The silent carriers (alef, he, ayin, yod, and vav outside the
 * cases handled below) map to nothing, because Hebrew leaves the vowels they stand for unwritten
 * and so does this comparison.
 */
const HEBREW_CONSONANT: Record<string, string> = {
  א: '', ב: 'B', ג: 'G', ד: 'D', ה: '', ו: '', ז: 'Z', ח: 'K', ט: 'T',
  י: '', כ: 'K', ך: 'K', ל: 'L', מ: 'M', ם: 'M', נ: 'N', ן: 'N', ס: 'S',
  ע: '', פ: 'P', ף: 'P', צ: 'C', ץ: 'C', ק: 'K', ר: 'R', ש: 'S', ת: 'T',
};

/** Latin pairs that stand for one sound, resolved before the letters beneath them are read. */
const LATIN_DIGRAPHS: Array<[RegExp, string]> = [
  [/ts|tz/g, 'C'],
  [/ch|kh|ck/g, 'K'],
  [/sh/g, 'S'],
  [/ph/g, 'P'],
  [/th/g, 'T'],
  // Soft c, so `office` reaches the samekh in אופיסכל while `Pelecard` still reaches a kuf.
  [/c(?=[eiy])/g, 'S'],
];

const LATIN_CONSONANT: Record<string, string> = {
  a: '', e: '', i: '', o: '', u: '', y: '', h: '',
  b: 'B', v: 'B', w: 'B', c: 'K', k: 'K', q: 'K', g: 'G', j: 'G',
  d: 'D', t: 'T', z: 'Z', s: 'S', p: 'P', f: 'P', l: 'L', m: 'M',
  n: 'N', r: 'R', x: 'KS',
};

/**
 * A name reduced to its consonant skeleton, the same way whichever script it is written in.
 *
 * This is what makes `Bezeq` and `בזק` comparable: Hebrew does not write vowels, so the only part
 * of a name the two scripts reliably agree on is its consonants, and even those are spelled with
 * some freedom (`b`/`v`, `k`/`ch`/`q`, `ts`/`tz`). Grouping the sounds that share a Hebrew letter
 * and dropping the vowels leaves something both spellings land on.
 */
export function transliterationSkeleton(value: string | null | undefined): string {
  let text = normalizeFirmSearchText(value);

  /*
   * Vav is the one Hebrew letter that is a consonant or a vowel depending on where it sits: doubled,
   * or opening a word, it is the v sound; anywhere else it is the o/u a Latin speller writes as a
   * vowel and this comparison discards. Rewriting those two cases as bet lets one table cover it.
   */
  text = text.replace(/וו/g, 'ב').replace(/(^|\s)ו/g, '$1ב');

  for (const [pattern, symbol] of LATIN_DIGRAPHS) text = text.replace(pattern, symbol);

  let out = '';
  for (const ch of text) {
    if (HEBREW_CONSONANT[ch] !== undefined) out += HEBREW_CONSONANT[ch];
    else if (LATIN_CONSONANT[ch] !== undefined) out += LATIN_CONSONANT[ch];
    else if (/[0-9A-Z]/.test(ch)) out += ch;
  }

  // A sound written twice is still one sound: `Netvill` has to reach `נטוויל`.
  return out.replace(/(.)\1+/g, '$1');
}

function hasHebrew(value: string): boolean {
  return /[\u05D0-\u05EA]/.test(value);
}

function hasLatin(value: string): boolean {
  return /[a-z]/i.test(value);
}

/**
 * How much has to be typed before a name is read across scripts.
 *
 * Measured on what was typed rather than on the skeleton, because the skeleton of a real name can
 * be very short — `Henley` and `הנלי` both reduce to two consonants — and refusing those would miss
 * exactly the names this is for. A keystroke or two is still too little to mean anything.
 */
const MIN_CROSS_SCRIPT_QUERY = 3;

/**
 * Fewest consonants a cross-script comparison may rest on.
 *
 * A name can be long and still reduce to almost nothing — `אייל` is four letters of which three are
 * vowel carriers, leaving a lone `L` that half the list contains. One consonant describes too much
 * to be evidence of anything.
 */
const MIN_CROSS_SCRIPT_SKELETON = 2;

/** Whether a query written in the other script describes this text. */
function matchesAcrossScripts(text: string, query: string): boolean {
  if (!text || query.length < MIN_CROSS_SCRIPT_QUERY) return false;
  // Only when the query's own script is absent here — within one script, a plain match is enough.
  const crossScript =
    (hasHebrew(query) && !hasHebrew(text) && hasLatin(text)) ||
    (hasLatin(query) && !hasLatin(text) && hasHebrew(text));
  if (!crossScript) return false;

  const textWords = text.split(/\s+/).map(transliterationSkeleton).filter(Boolean);
  if (!textWords.length) return false;

  /*
   * Every word typed has to open a word of the name, in any order. Matching only at the start of a
   * word is what keeps this useful: skeletons are short, so comparing them anywhere inside the name
   * makes `Ruth` (RT) answer to every Hebrew name containing שירותי (SRT). Order is not required
   * because the two names rarely carry the same words — `פרטנר - שירותי אינטרנט` has one in the
   * middle that `partner internet` leaves out. A word reducing to a single consonant is ignored
   * rather than matched, since one consonant describes most of the list.
   */
  const queryWords = query
    .split(/\s+/)
    .map(transliterationSkeleton)
    .filter((w) => w.length >= MIN_CROSS_SCRIPT_SKELETON);
  if (queryWords.length && queryWords.every((q) => textWords.some((t) => t.startsWith(q)))) {
    return true;
  }

  // Allows the spaces to fall differently on the two sides, as in `officekol` for `אופיס כל`.
  const whole = transliterationSkeleton(query);
  return (
    whole.length >= MIN_CROSS_SCRIPT_SKELETON && transliterationSkeleton(text).startsWith(whole)
  );
}

/**
 * Whether a firm answers to what was typed, in either language.
 *
 * Two things bridge the languages. A firm's `name` and `legal_name` are frequently the same firm
 * written in the two scripts — `Tomedes` / `תומדס`, `רם אפרתי` / `Ram Ephrati, Adv. & Notary` — so
 * both columns are read. And where only one script was ever recorded, the names are compared by
 * their consonant skeletons, which is what lets `bezeq` find `בזק`. Without either, whoever typed
 * the language a firm is not filed under sees no results and goes on to create a duplicate.
 */
export function firmMatchesSearch(
  firm: { name?: string | null; legalName?: string | null },
  query: string,
): boolean {
  const q = normalizeFirmSearchText(query);
  if (!q) return true;

  const name = normalizeFirmSearchText(firm.name);
  const legalName = normalizeFirmSearchText(firm.legalName);
  return (
    name.includes(q) ||
    legalName.includes(q) ||
    matchesAcrossScripts(name, q) ||
    matchesAcrossScripts(legalName, q)
  );
}

/**
 * Whether what was typed is this firm already — the same text, or the same name in the other script.
 *
 * Used to withhold the offer to create a firm, which is why it demands the whole skeletons be equal
 * instead of reusing the generous prefix matching above. Searching should cast a wide net; refusing
 * to let someone add a firm has to be certain. `bezeq` is `בזק` and must not be created a second
 * time, while `partnoris` (PRTNRS) against `פרטנר - שירותי אינטרנט` (PRTNRSRTNTRNT) is near enough
 * to show in the results and far enough to be a different firm worth adding.
 */
export function firmIsExactMatch(
  firm: { name?: string | null; legalName?: string | null },
  query: string,
): boolean {
  const q = normalizeFirmSearchText(query);
  if (!q) return false;

  const fields = [normalizeFirmSearchText(firm.name), normalizeFirmSearchText(firm.legalName)].filter(
    Boolean,
  );
  if (fields.some((field) => field === q)) return true;

  const querySkeleton = transliterationSkeleton(q);
  if (querySkeleton.length < MIN_CROSS_SCRIPT_SKELETON) return false;
  return fields.some(
    (field) =>
      ((hasHebrew(q) && !hasHebrew(field) && hasLatin(field)) ||
        (hasLatin(q) && !hasLatin(field) && hasHebrew(field))) &&
      transliterationSkeleton(field) === querySkeleton,
  );
}

/** Shortest name worth creating a firm for; one character is almost always a slip. */
const MIN_FIRM_NAME_LENGTH = 2;

/** `ilike` treats these as wildcards, so a name containing one has to be escaped to match literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Find a firm by name, or create it.
 *
 * These are the rows the External Firms page lists, so a firm added here from an expense drawer
 * shows up there as an ordinary firm; `name` is the only column the table requires, and the type,
 * VAT number and contacts get filled in on that page afterwards.
 *
 * An existing firm is returned rather than a second row created, because the name is the only thing
 * being matched on and two firms sharing one are indistinguishable everywhere they are displayed.
 * The check is case-insensitive and ignores surrounding spaces, which is how someone retyping a
 * firm they could not find in the picker would differ from the stored name.
 */
export async function createExternalFirm(
  rawName: string,
): Promise<{ firm: ExternalFirmRow; alreadyExisted: boolean }> {
  const name = rawName.trim();
  if (name.length < MIN_FIRM_NAME_LENGTH) {
    throw new Error('Enter at least 2 characters for the firm name');
  }

  const { data: existing, error: lookupError } = await supabase
    .from('firms')
    .select('id, name, legal_name, profile_image_url')
    .ilike('name', escapeLikePattern(name))
    .limit(1);
  if (lookupError) throw lookupError;

  const match = existing?.[0];
  if (match) {
    return {
      firm: {
        id: String(match.id),
        name: String(match.name || name),
        legalName: String(match.legal_name || ''),
        profileImageUrl: String(match.profile_image_url || ''),
      },
      alreadyExisted: true,
    };
  }

  const { data, error } = await supabase
    .from('firms')
    .insert({ name })
    .select('id, name, legal_name, profile_image_url')
    .single();
  if (error) throw error;

  return {
    firm: {
      id: String(data.id),
      name: String(data.name || name),
      legalName: String(data.legal_name || ''),
      profileImageUrl: String(data.profile_image_url || ''),
    },
    alreadyExisted: false,
  };
}
