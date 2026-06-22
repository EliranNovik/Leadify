// Field catalog + token helpers for staff-authored POA templates.
//
// A template's `body` is plain text containing {{key}} tokens. Each token maps
// to an entry in the template's `fields` array, which describes how the public
// page renders that placeholder (a text input, a date, a signature pad, …) and
// (optionally) which contact attribute to prefill it from.

export type PoaFieldType = 'text' | 'textarea' | 'date' | 'email' | 'tel' | 'signature';

/** Which contact attribute (if any) should prefill a field. */
export type PoaPrefillSource = 'name' | 'email' | 'phone' | 'address' | 'id_passport' | '';

export interface PoaTemplateField {
  key: string;
  label: string;
  type: PoaFieldType;
  required: boolean;
  prefill: PoaPrefillSource;
}

/** A field the staff can drop into a template, with sensible defaults. */
export interface PoaFieldCatalogItem {
  key: string;
  label: string;
  type: PoaFieldType;
  prefill: PoaPrefillSource;
  /** Short hint shown in the palette. */
  hint?: string;
}

/**
 * Fields available to insert into a template. The "contact" ones prefill from
 * leads_contact; the generic ones are blank inputs the signer fills in.
 */
export const POA_FIELD_CATALOG: PoaFieldCatalogItem[] = [
  // From the linked contact
  { key: 'contact_name', label: 'Full name', type: 'text', prefill: 'name', hint: 'Contact name' },
  { key: 'id_passport', label: 'ID / Passport number', type: 'text', prefill: 'id_passport', hint: 'Contact ID/passport' },
  { key: 'address', label: 'Address', type: 'textarea', prefill: 'address', hint: 'Contact address' },
  { key: 'email', label: 'Email', type: 'email', prefill: 'email', hint: 'Contact email' },
  { key: 'phone', label: 'Phone', type: 'tel', prefill: 'phone', hint: 'Contact phone' },
  // Generic inputs the signer fills in
  { key: 'date_of_birth', label: 'Date of birth', type: 'date', prefill: '' },
  { key: 'place_of_birth', label: 'Place of birth', type: 'text', prefill: '' },
  { key: 'city', label: 'City', type: 'text', prefill: '' },
  { key: 'country', label: 'Country', type: 'text', prefill: '' },
  { key: 'date', label: 'Date', type: 'date', prefill: '' },
  { key: 'place_date', label: 'Place & date', type: 'text', prefill: '' },
  { key: 'note', label: 'Free text', type: 'textarea', prefill: '' },
  { key: 'signature', label: 'Signature', type: 'signature', prefill: '' },
];

export const POA_FIELD_TYPE_LABELS: Record<PoaFieldType, string> = {
  text: 'Text',
  textarea: 'Paragraph',
  date: 'Date',
  email: 'Email',
  tel: 'Phone',
  signature: 'Signature',
};

/** Build a token string for a field key, e.g. "{{signature}}". */
export function poaToken(key: string): string {
  return `{{${key}}}`;
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type PoaBodySegment =
  | { kind: 'text'; text: string }
  | { kind: 'field'; key: string };

/** Split a body into text + field segments in document order. */
export function parsePoaBody(body: string): PoaBodySegment[] {
  const segments: PoaBodySegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: body.slice(lastIndex, match.index) });
    }
    segments.push({ kind: 'field', key: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    segments.push({ kind: 'text', text: body.slice(lastIndex) });
  }
  return segments;
}

/** Distinct field keys referenced by {{...}} tokens in a body, in order. */
export function extractPoaBodyKeys(body: string): string[] {
  const keys: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(body)) !== null) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

/** Map a contact record to prefill values for a template's fields. */
export function buildTemplatePrefill(
  fields: PoaTemplateField[],
  contact: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
    address?: string | null;
    id_passport?: string | null;
  },
): Record<string, string> {
  const source: Record<PoaPrefillSource, string> = {
    name: (contact.name || '').trim(),
    email: (contact.email || '').trim(),
    phone: (contact.phone || contact.mobile || '').trim(),
    address: (contact.address || '').trim(),
    id_passport: (contact.id_passport || '').trim(),
    '': '',
  };
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.prefill && source[f.prefill]) out[f.key] = source[f.prefill];
  }
  return out;
}
