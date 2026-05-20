import { supabase } from './supabase';

export type BankAccountRecord = {
  id: string;
  name: string;
  account_name: string | null;
  account_number: string | null;
  bank_code: string | null;
  branch_number: string | null;
  branch_name: string | null;
  branch_address: string | null;
  swift_code: string | null;
  iban: string | null;
  bank_phone: string | null;
};

export type BankAccountSnapshot = BankAccountRecord;

const BANK_SELECT =
  'id, name, account_name, account_number, bank_code, branch_number, branch_name, branch_address, swift_code, iban, bank_phone';

const LEGACY_BANK_MARKER = '<!--PROFORMA_BANK:';

export async function fetchActiveBankAccounts(): Promise<BankAccountRecord[]> {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select(BANK_SELECT)
    .eq('is_active', true)
    .order('order_value', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as BankAccountRecord[];
}

export async function fetchBankAccountById(id: string): Promise<BankAccountSnapshot | null> {
  if (!id) return null;
  const { data, error } = await supabase.from('bank_accounts').select(BANK_SELECT).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as BankAccountSnapshot;
}

export function toBankAccountSnapshot(account: BankAccountRecord): BankAccountSnapshot {
  return { ...account };
}

export function resolveBankAccountFromProforma(proforma: {
  bankAccountDetails?: BankAccountSnapshot | null;
} | null | undefined): BankAccountSnapshot | null {
  return proforma?.bankAccountDetails ?? null;
}

export function buildBankDetailLines(details: BankAccountSnapshot): { label?: string; value: string }[] {
  const lines: { label?: string; value: string }[] = [];
  if (details.name) lines.push({ label: 'Bank', value: details.name });
  if (details.account_name) lines.push({ label: 'Account name', value: details.account_name });
  if (details.account_number) lines.push({ label: 'Account number', value: details.account_number });
  if (details.bank_code || details.branch_number) {
    lines.push({
      label: 'Bank / branch code',
      value: [details.bank_code, details.branch_number].filter(Boolean).join(' / '),
    });
  }
  if (details.branch_name) lines.push({ label: 'Branch', value: details.branch_name });
  if (details.branch_address) lines.push({ value: details.branch_address });
  if (details.iban) lines.push({ label: 'IBAN', value: details.iban });
  if (details.swift_code) lines.push({ label: 'SWIFT', value: details.swift_code });
  if (details.bank_phone) lines.push({ label: 'Phone', value: details.bank_phone });
  return lines;
}

export function stripLegacyBankFromNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  const idx = notes.indexOf(LEGACY_BANK_MARKER);
  if (idx === -1) return notes;
  return notes.slice(0, idx).trimEnd();
}

export function parseLegacyBankFromNotes(notes: string | null | undefined): BankAccountSnapshot | null {
  if (!notes) return null;
  const start = notes.indexOf(LEGACY_BANK_MARKER);
  if (start === -1) return null;
  const end = notes.indexOf('-->', start);
  if (end === -1) return null;
  try {
    return JSON.parse(notes.slice(start + LEGACY_BANK_MARKER.length, end)) as BankAccountSnapshot;
  } catch {
    return null;
  }
}

export function embedLegacyBankInNotes(
  notes: string | null | undefined,
  snapshot: BankAccountSnapshot | null,
): string {
  const cleaned = stripLegacyBankFromNotes(notes ?? '');
  if (!snapshot) return cleaned;
  return `${cleaned}\n${LEGACY_BANK_MARKER}${JSON.stringify(snapshot)}-->`;
}
