/**
 * Transliteration utilities for multilingual search
 * Supports Hebrew, Arabic, and English name matching
 */

// Hebrew to English transliteration map
const hebrewToEnglish: Record<string, string> = {
  'א': 'a',
  'ב': 'b',
  'ג': 'g',
  'ד': 'd',
  'ה': 'h',
  'ו': 'v',
  'ז': 'z',
  'ח': 'ch',
  'ט': 't',
  'י': 'y',
  'כ': 'k',
  'ך': 'k',
  'ל': 'l',
  'מ': 'm',
  'ם': 'm',
  'נ': 'n',
  'ן': 'n',
  'ס': 's',
  'ע': 'a',
  'פ': 'p',
  'ף': 'p',
  'צ': 'ts',
  'ץ': 'ts',
  'ק': 'k',
  'ר': 'r',
  'ש': 'sh',
  'ת': 't',
};

// Arabic to English transliteration map (common patterns)
const arabicToEnglish: Record<string, string> = {
  'ا': 'a',
  'أ': 'a',
  'إ': 'i',
  'آ': 'aa',
  'ب': 'b',
  'ت': 't',
  'ث': 'th',
  'ج': 'j',
  'ح': 'h',
  'خ': 'kh',
  'د': 'd',
  'ذ': 'dh',
  'ر': 'r',
  'ز': 'z',
  'س': 's',
  'ش': 'sh',
  'ص': 's',
  'ض': 'd',
  'ط': 't',
  'ظ': 'z',
  'ع': 'a',
  'غ': 'gh',
  'ف': 'f',
  'ق': 'q',
  'ك': 'k',
  'ل': 'l',
  'م': 'm',
  'ن': 'n',
  'ه': 'h',
  'و': 'w',
  'ي': 'y',
  'ى': 'a',
  'ة': 'a',
};

/**
 * Transliterate Hebrew text to English
 */
export function transliterateHebrew(text: string): string {
  if (!text) return '';
  
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    // Handle special cases
    if (char === 'ש' && nextChar === 'ׁ') {
      result += 'sh';
      i++; // Skip the next character
      continue;
    }
    
    if (char === 'ש' && nextChar === 'ׂ') {
      result += 's';
      i++; // Skip the next character
      continue;
    }
    
    // Handle vav with vowel marks
    if (char === 'ו' && (nextChar === 'ֹ' || nextChar === 'ֻ')) {
      result += 'o';
      i++;
      continue;
    }
    
    // Map Hebrew character to English
    if (hebrewToEnglish[char]) {
      result += hebrewToEnglish[char];
    } else if (/[\u0590-\u05FF]/.test(char)) {
      // Hebrew character not in map, skip vowel marks
      if (!['ְ', 'ֱ', 'ֲ', 'ֳ', 'ִ', 'ֵ', 'ֶ', 'ַ', 'ָ', 'ֹ', 'ֺ', 'ֻ', 'ּ', 'ֽ', '־'].includes(char)) {
        result += char; // Keep unknown Hebrew characters
      }
    } else {
      result += char; // Keep non-Hebrew characters
    }
  }
  
  return result.toLowerCase();
}

/**
 * Transliterate Arabic text to English
 */
export function transliterateArabic(text: string): string {
  if (!text) return '';
  
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (arabicToEnglish[char]) {
      result += arabicToEnglish[char];
    } else if (/[\u0600-\u06FF]/.test(char)) {
      // Arabic character not in map, try to approximate
      result += char;
    } else {
      result += char; // Keep non-Arabic characters
    }
  }
  
  return result.toLowerCase();
}

/**
 * Check if text contains Hebrew characters
 */
export function containsHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text);
}

/**
 * Check if text contains Arabic characters
 */
export function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

// Reverse transliteration: English to Hebrew/Arabic
// Common name mappings for reverse transliteration
const englishToHebrewCommon: Record<string, string[]> = {
  'david': ['דוד', 'דויד'],
  'michael': ['מיכאל', 'מיכל'],
  'sarah': ['שרה'],
  'rachel': ['רחל'],
  'joshua': ['יהושע', 'יושע'],
  'daniel': ['דניאל'],
  'benjamin': ['בנימין'],
  'james': ['יעקב'],
  'john': ['יוחנן', 'יונתן'],
  'mary': ['מרים'],
  'elizabeth': ['אליזבת'],
  'josef': ['יוסף'],
  'joseph': ['יוסף'],
  'moshe': ['משה'],
  'moses': ['משה'],
  'yosef': ['יוסף'],
  'yitzhak': ['יצחק'],
  'isaac': ['יצחק'],
  'avraham': ['אברהם'],
  'abraham': ['אברהם'],
  'yaakov': ['יעקב'],
  'jacob': ['יעקב'],
  'rebecca': ['רבקה'],
  'rivka': ['רבקה'],
  'hannah': ['חנה'],
  'chana': ['חנה'],
  'esther': ['אסתר'],
  'ruth': ['רות'],
  'deborah': ['דבורה'],
  'miriam': ['מרים'],
  'levi': ['לוי'],
  'aaron': ['אהרן'],
  'samuel': ['שמואל'],
  'shmuel': ['שמואל'],
  'solomon': ['שלמה'],
  'shlomo': ['שלמה'],
  'jonathan': ['יונתן'],
  'yoni': ['יוני'],
  'adam': ['אדם'],
  'noah': ['נח'],
  'isaac': ['יצחק'],
  'ezra': ['עזרא'],
  'mordechai': ['מרדכי'],
  'shimon': ['שמעון'],
  'simon': ['שמעון'],
  'yehuda': ['יהודה'],
  'judah': ['יהודה'],
};

// English to Arabic common names
const englishToArabicCommon: Record<string, string[]> = {
  'david': ['داود', 'داوود'],
  'michael': ['ميخائيل', 'ميشيل'],
  'sarah': ['سارة', 'سارا'],
  'mary': ['مريم', 'ماري'],
  'joseph': ['يوسف', 'جوزيف'],
  'john': ['يحيى', 'جون'],
  'james': ['يعقوب', 'جيمس'],
  'mohammed': ['محمد'],
  'muhammad': ['محمد'],
  'ahmed': ['أحمد', 'احمد'],
  'ali': ['علي'],
  'hassan': ['حسن', 'حسان'],
  'ibrahim': ['إبراهيم', 'ابراهيم'],
  'abraham': ['إبراهيم', 'ابراهيم'],
  'isaac': ['إسحاق'],
  'jacob': ['يعقوب'],
  'adam': ['آدم'],
  'noah': ['نوح'],
  'solomon': ['سليمان'],
  'suleiman': ['سليمان'],
  'daniyal': ['دانيال'],
  'daniel': ['دانيال'],
  'samuel': ['صموئيل'],
  'aaron': ['هارون'],
  'moses': ['موسى'],
  'joshua': ['يشوع'],
  'jonathan': ['يوناثان'],
  'hannah': ['حنة'],
  'esther': ['أستير'],
  'ruth': ['راعوث'],
  'rebecca': ['رفقة'],
  'miriam': ['مريم'],
  'elizabeth': ['إليزابيث'],
  'fatima': ['فاطمة'],
  'aisha': ['عائشة'],
  'khadija': ['خديجة'],
  'omar': ['عمر'],
  'osman': ['عثمان'],
  'yusuf': ['يوسف'],
  'yousef': ['يوسف'],
  'khalil': ['خليل'],
  'nasser': ['ناصر'],
  'saleh': ['صالح'],
  'tariq': ['طارق'],
};

// Reverse transliteration map: English letters/sounds to Hebrew characters
const englishToHebrewSounds: Record<string, string[]> = {
  'a': ['א', 'ע', 'ה'],
  'b': ['ב'],
  'v': ['ב', 'ו'],
  'g': ['ג'],
  'd': ['ד'],
  'h': ['ה', 'ח'],
  'w': ['ו'],
  'z': ['ז'],
  'ch': ['ח', 'כ'],
  't': ['ט', 'ת'],
  'y': ['י'],
  'i': ['י', 'א'],
  'k': ['כ', 'ק'],
  'c': ['כ', 'ק', 'ס'],
  'l': ['ל'],
  'm': ['מ', 'ם'],
  'n': ['נ', 'ן'],
  's': ['ס', 'ש', 'צ'],
  'o': ['ו', 'א'],
  'p': ['פ', 'ף'],
  'f': ['פ', 'ף'],
  'ts': ['צ', 'ץ'],
  'tz': ['צ', 'ץ'],
  'q': ['ק'],
  'r': ['ר'],
  'sh': ['ש'],
  'th': ['ת', 'ט'],
  'e': ['א', 'ע'],
  'u': ['ו', 'א'],
};

/**
 * Reverse transliterate English to Hebrew (phonetic approximation)
 * This creates Hebrew character patterns that could match the English name
 */
function reverseTransliterateToHebrew(english: string): string[] {
  const lower = english.toLowerCase();
  
  // Check common names first
  if (englishToHebrewCommon[lower]) {
    return englishToHebrewCommon[lower];
  }
  
  // Phonetic approximation: convert English sounds to Hebrew characters
  const patterns: string[] = [];
  let hebrewPattern = '';
  let i = 0;
  
  while (i < lower.length) {
    // Check for two-character sounds first (ch, sh, ts, th, tz)
    const twoChar = lower.substring(i, i + 2);
    if (twoChar.length === 2 && englishToHebrewSounds[twoChar]) {
      const options = englishToHebrewSounds[twoChar];
      // For now, use the first option (can be enhanced to try all combinations)
      hebrewPattern += options[0];
      i += 2;
    } else {
      // Single character
      const char = lower[i];
      if (englishToHebrewSounds[char]) {
        const options = englishToHebrewSounds[char];
        hebrewPattern += options[0]; // Use first option
      }
      i++;
    }
  }
  
  if (hebrewPattern) {
    patterns.push(hebrewPattern);
  }
  
  return patterns;
}

// Reverse transliteration map: English letters/sounds to Arabic characters
const englishToArabicSounds: Record<string, string[]> = {
  'a': ['ا', 'أ', 'إ', 'آ'],
  'b': ['ب'],
  't': ['ت', 'ط'],
  'th': ['ث', 'ذ'],
  'j': ['ج'],
  'h': ['ه', 'ح'],
  'kh': ['خ'],
  'd': ['د', 'ض'],
  'dh': ['ذ', 'ظ'],
  'r': ['ر'],
  'z': ['ز', 'ظ'],
  's': ['س', 'ص'],
  'sh': ['ش'],
  's': ['ص'],
  'd': ['ض'],
  't': ['ط'],
  'z': ['ظ'],
  'a': ['ع'],
  'gh': ['غ'],
  'f': ['ف'],
  'q': ['ق'],
  'k': ['ك'],
  'l': ['ل'],
  'm': ['م'],
  'n': ['ن'],
  'h': ['ه'],
  'w': ['و'],
  'y': ['ي', 'ى'],
  'i': ['ي', 'إ'],
  'e': ['ي', 'ا'],
  'o': ['و'],
  'u': ['و'],
  'c': ['ك', 'س'],
  'g': ['ج'],
  'p': ['ب'], // Arabic doesn't have 'p', use 'b'
};

/**
 * Reverse transliterate English to Arabic (phonetic approximation)
 */
function reverseTransliterateToArabic(english: string): string[] {
  const lower = english.toLowerCase();
  
  // Check common names first
  if (englishToArabicCommon[lower]) {
    return englishToArabicCommon[lower];
  }
  
  // Phonetic approximation: convert English sounds to Arabic characters
  const patterns: string[] = [];
  let arabicPattern = '';
  let i = 0;
  
  while (i < lower.length) {
    // Check for two-character sounds first (th, kh, sh, gh, dh)
    const twoChar = lower.substring(i, i + 2);
    if (twoChar.length === 2 && englishToArabicSounds[twoChar]) {
      const options = englishToArabicSounds[twoChar];
      arabicPattern += options[0];
      i += 2;
    } else {
      // Single character
      const char = lower[i];
      if (englishToArabicSounds[char]) {
        const options = englishToArabicSounds[char];
        arabicPattern += options[0]; // Use first option
      }
      i++;
    }
  }
  
  if (arabicPattern) {
    patterns.push(arabicPattern);
  }
  
  return patterns;
}

/**
 * Generate search variants for multilingual search
 * Returns array of search terms including original and transliterated versions
 * When searching in English, also includes Hebrew/Arabic equivalents
 */
export function generateSearchVariants(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  
  const lower = trimmed.toLowerCase();
  const variants: string[] = [lower];
  const isEnglish = !containsHebrew(trimmed) && !containsArabic(trimmed);
  
  // If query contains Hebrew, add transliterated English version
  if (containsHebrew(trimmed)) {
    const transliterated = transliterateHebrew(trimmed);
    if (transliterated && transliterated !== lower) {
      variants.push(transliterated);
    }
  }
  
  // If query contains Arabic, add transliterated English version
  if (containsArabic(trimmed)) {
    const transliterated = transliterateArabic(trimmed);
    if (transliterated && transliterated !== lower) {
      variants.push(transliterated);
    }
  }
  
  // If query is English, add Hebrew and Arabic equivalents
  if (isEnglish && trimmed.length >= 2) {
    // Add Hebrew equivalents for common names
    const hebrewEquivalents = reverseTransliterateToHebrew(trimmed);
    hebrewEquivalents.forEach(hebrew => {
      if (hebrew && !variants.includes(hebrew)) {
        variants.push(hebrew);
      }
    });
    
    // Add Arabic equivalents for common names
    const arabicEquivalents = reverseTransliterateToArabic(trimmed);
    arabicEquivalents.forEach(arabic => {
      if (arabic && !variants.includes(arabic)) {
        variants.push(arabic);
      }
    });
  }
  
  return [...new Set(variants)]; // Remove duplicates
}

/**
 * Build OR conditions for multilingual search
 * Searches both original text and transliterated versions
 */
export function buildMultilingualSearchConditions(field: string, query: string): string[] {
  const variants = generateSearchVariants(query);
  const conditions: string[] = [];
  
  variants.forEach(variant => {
    conditions.push(`${field}.ilike.%${variant}%`);
  });
  
  return conditions;
}

