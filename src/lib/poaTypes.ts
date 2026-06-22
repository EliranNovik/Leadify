// Power of Attorney type definitions.
//
// Each POA type has its own document layout (rendered by a dedicated component
// in src/components/poa/documents), but the field ids, required fields and
// signature ids are centralised here so the public page validation and the
// renderers stay in sync.

export type PoaTypeKey =
  | 'german_citizenship'
  | 'standard_hebrew'
  | 'austrian_citizenship_standard'
  | 'austrian_citizenship_minor';

export interface PoaTypeMeta {
  key: PoaTypeKey;
  /** Default human-readable name (DB row is authoritative, this is a fallback). */
  name: string;
  language: 'en' | 'he' | 'de';
  direction: 'ltr' | 'rtl';
  jurisdiction: string;
  /** Field ids the signer MUST fill before submitting. */
  requiredFields: string[];
  /** Signature pad ids the signer MUST sign before submitting. */
  requiredSignatures: string[];
  /** All signature pad ids (required + optional), in display order. */
  signatureIds: string[];
}

export const POA_TYPES: Record<PoaTypeKey, PoaTypeMeta> = {
  // ---------------------------------------------------------------------------
  // German citizenship — Vollmacht to the Bundesverwaltungsamt (bilingual DE/EN)
  // ---------------------------------------------------------------------------
  german_citizenship: {
    key: 'german_citizenship',
    name: 'German Citizenship POA (Vollmacht)',
    language: 'de',
    direction: 'ltr',
    jurisdiction: 'Germany',
    requiredFields: [
      'applicant_last_name',
      'applicant_first_name',
      'applicant_birth_date',
      'applicant_birth_place',
      'applicant_address',
      'place_date_1',
    ],
    requiredSignatures: ['signature_first_parent'],
    signatureIds: ['signature_first_parent', 'signature_second_parent'],
  },

  // ---------------------------------------------------------------------------
  // Standard Hebrew POA (RTL)
  // ---------------------------------------------------------------------------
  standard_hebrew: {
    key: 'standard_hebrew',
    name: 'Standard POA (Hebrew)',
    language: 'he',
    direction: 'rtl',
    jurisdiction: 'Israel',
    requiredFields: ['full_name_he', 'full_name_en', 'id_number', 'sign_date'],
    requiredSignatures: ['signature'],
    signatureIds: ['signature'],
  },

  // ---------------------------------------------------------------------------
  // Austrian citizenship — standard (single applicant)
  // ---------------------------------------------------------------------------
  austrian_citizenship_standard: {
    key: 'austrian_citizenship_standard',
    name: 'Austrian Citizenship POA (Standard)',
    language: 'en',
    direction: 'ltr',
    jurisdiction: 'Austria',
    requiredFields: [
      'full_name',
      'date_of_birth',
      'address',
      'phone',
      'email',
      'sign_date',
      'passport_number',
    ],
    requiredSignatures: ['signature'],
    signatureIds: ['signature'],
  },

  // ---------------------------------------------------------------------------
  // Austrian citizenship — minor / family (applicant + minor children)
  // ---------------------------------------------------------------------------
  austrian_citizenship_minor: {
    key: 'austrian_citizenship_minor',
    name: 'Austrian Citizenship POA (Minor / Family)',
    language: 'en',
    direction: 'ltr',
    jurisdiction: 'Austria',
    requiredFields: [
      'full_name',
      'address',
      'contact_number',
      'email',
      'sign_date',
      'applicant_1',
    ],
    requiredSignatures: ['signature_first_parent'],
    signatureIds: ['signature_first_parent', 'signature_second_parent'],
  },
};

export function getPoaTypeMeta(key: string | null | undefined): PoaTypeMeta | null {
  if (!key) return null;
  return POA_TYPES[key as PoaTypeKey] ?? null;
}

/** Map a contact record to sensible prefill values for a given POA type. */
export function buildPoaPrefill(
  key: string,
  contact: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
    address?: string | null;
    id_passport?: string | null;
  },
): Record<string, string> {
  const name = (contact.name || '').trim();
  const email = (contact.email || '').trim();
  const phone = (contact.phone || contact.mobile || '').trim();
  const address = (contact.address || '').trim();
  const idPassport = (contact.id_passport || '').trim();

  switch (key) {
    case 'german_citizenship':
      return {
        applicant_last_name: '',
        applicant_first_name: name,
        applicant_address: address,
      };
    case 'standard_hebrew':
      return {
        full_name_he: name,
        id_number: idPassport,
      };
    case 'austrian_citizenship_standard':
      return {
        full_name: name,
        address,
        phone,
        email,
        passport_number: idPassport,
      };
    case 'austrian_citizenship_minor':
      return {
        full_name: name,
        address,
        contact_number: phone,
        email,
        applicant_1: idPassport ? `${idPassport} – ${name}`.trim() : name,
      };
    default:
      return {};
  }
}

export const POA_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  sent: 'Sent',
  viewed: 'Viewed',
  signed: 'Signed',
  cancelled: 'Cancelled',
};
