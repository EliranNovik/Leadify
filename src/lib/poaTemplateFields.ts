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

/** One placed field token in the document body (duplicate keys get unique instance ids). */
export interface PoaBodyFieldInstance {
  segmentIndex: number;
  key: string;
  instanceId: string;
}

/**
 * When the same {{key}} appears multiple times in the body, each occurrence
 * needs its own value id so inputs don't share state.
 */
export function listPoaBodyFieldInstances(body: string): PoaBodyFieldInstance[] {
  const segments = parsePoaBody(body);
  const keyCounts = new Map<string, number>();
  for (const seg of segments) {
    if (seg.kind === 'field') {
      keyCounts.set(seg.key, (keyCounts.get(seg.key) || 0) + 1);
    }
  }

  const seen = new Map<string, number>();
  const out: PoaBodyFieldInstance[] = [];
  segments.forEach((seg, segmentIndex) => {
    if (seg.kind !== 'field') return;
    const occurrence = seen.get(seg.key) ?? 0;
    seen.set(seg.key, occurrence + 1);
    const total = keyCounts.get(seg.key) || 1;
    const instanceId = total <= 1 ? seg.key : `${seg.key}__${occurrence}`;
    out.push({ segmentIndex, key: seg.key, instanceId });
  });
  return out;
}

/** Map segment index -> value id for quick lookup while rendering. */
export function poaFieldInstanceIdBySegment(body: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const inst of listPoaBodyFieldInstances(body)) {
    map.set(inst.segmentIndex, inst.instanceId);
  }
  return map;
}

/** Pick a unique field key when inserting another catalog field of the same type. */
export function allocatePoaFieldKey(
  baseKey: string,
  fields: PoaTemplateField[],
  body: string,
): string {
  const used = new Set<string>();
  for (const f of fields) used.add(f.key);
  for (const k of extractPoaBodyKeys(body)) used.add(k);
  if (!used.has(baseKey)) return baseKey;
  let n = 2;
  while (used.has(`${baseKey}_${n}`)) n += 1;
  return `${baseKey}_${n}`;
}

export function resolvePoaTemplateField(key: string, fields: PoaTemplateField[]): PoaTemplateField {
  return (
    fields.find((f) => f.key === key) || {
      key,
      label: key,
      type: 'text',
      required: false,
      prefill: '',
    }
  );
}

/** All fillable instances: body placements (incl. duplicate keys) + orphan field defs. */
export function listPoaFillableInstances(
  body: string,
  fields: PoaTemplateField[],
): { instanceId: string; field: PoaTemplateField }[] {
  const placedKeys = new Set<string>();
  const instances: { instanceId: string; field: PoaTemplateField }[] = [];

  for (const { key, instanceId } of listPoaBodyFieldInstances(body)) {
    placedKeys.add(key);
    instances.push({ instanceId, field: resolvePoaTemplateField(key, fields) });
  }

  for (const f of fields) {
    if (!placedKeys.has(f.key)) {
      instances.push({ instanceId: f.key, field: f });
    }
  }

  return instances;
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
