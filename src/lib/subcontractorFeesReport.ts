import { supabase } from './supabase';
import { createBoiDateRateConverter } from './boiCurrencyConversion';
import { applyLeadSourceIdUpdate } from './leadSourceId';
import {
  insertLeadSubcontractorFee,
  setLeadSubcontractorFeeScalar,
  type LeadFeeIdentity,
} from './leadSubcontractorFees';

export type SubcontractorFeeReportSource = 'fee_table' | 'lead_column';

export type SubcontractorFeeReportRow = {
  key: string;
  leadKey: string;
  leadType: 'new' | 'legacy';
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
  clientName: string | null;
  contactNames: string[];
  /** Lead pipeline stage name. */
  stageName: string | null;
  stageId: string | null;
  stageColour: string | null;
  mainCategory: string | null;
  subcategory: string | null;
  /** Marketing / lead source name (misc_leadsource). */
  leadSource: string | null;
  leadSourceId: string | null;
  firmId: string | null;
  firmName: string | null;
  /** Firm logo (`firms.profile_image_url`). */
  firmProfileImageUrl: string | null;
  amount: number;
  /** Amount converted to NIS via BOI rates (as of fee date). */
  amountNis: number;
  currencyId: number | null;
  currencyLabel: string;
  feeDate: string | null;
  /** Fee notes (joined when multiple fee lines are aggregated). */
  notes: string | null;
  source: SubcontractorFeeReportSource;
};

export type SubcontractorFeesReportFilters = {
  dateFrom?: string | null;
  dateTo?: string | null;
  mainCategory?: string | null;
  firmSearch?: string | null;
  /** Match lead #, client name, or contact name */
  leadSearch?: string | null;
};

export type SubcontractorFeesReportResult = {
  rows: SubcontractorFeeReportRow[];
  mainCategories: string[];
};

const PAGE = 1000;

function endOfDayIso(dateYmd: string): string {
  return `${dateYmd}T23:59:59.999`;
}

function startOfDayIso(dateYmd: string): string {
  return `${dateYmd}T00:00:00.000`;
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function categoryPartsFromJoin(categoryJoin: any): {
  mainCategory: string | null;
  subcategory: string | null;
} {
  const cat = unwrapOne(categoryJoin);
  if (!cat) return { mainCategory: null, subcategory: null };
  const main = unwrapOne(cat.misc_maincategory);
  const mainCategory = main?.name != null ? String(main.name).trim() || null : null;
  const subcategory = cat?.name != null ? String(cat.name).trim() || null : null;
  return { mainCategory, subcategory };
}

function formatCategoryLabel(mainCategory: string | null, subcategory: string | null): string {
  if (mainCategory && subcategory) return `${mainCategory} / ${subcategory}`;
  return mainCategory || subcategory || '—';
}

function stageInfoFromJoin(stageJoin: any): {
  id: string | null;
  name: string | null;
  colour: string | null;
} {
  const stage = unwrapOne(stageJoin);
  if (!stage) return { id: null, name: null, colour: null };
  const id = stage?.id != null ? String(stage.id).trim() || null : null;
  const name = stage?.name != null ? String(stage.name).trim() || null : null;
  const colour =
    stage?.colour != null ? String(stage.colour).trim() || null : null;
  return { id, name, colour };
}

function sourceInfoFromJoin(sourceJoin: any): { id: string | null; name: string | null } {
  const src = unwrapOne(sourceJoin);
  if (!src) return { id: null, name: null };
  const id = src?.id != null ? String(src.id).trim() || null : null;
  const name = src?.name != null ? String(src.name).trim() || null : null;
  return { id, name };
}

function currencySignFromLabel(currencyLabel: string | null | undefined, currencyId: number | null): string {
  const label = String(currencyLabel || '').trim();
  if (label === '₪' || label === '€' || label === '$' || label === '£') return label;
  const upper = label.toUpperCase();
  if (upper === 'NIS' || upper === 'ILS') return '₪';
  if (upper === 'EUR') return '€';
  if (upper === 'USD') return '$';
  if (upper === 'GBP') return '£';
  if (currencyId === 1) return '₪';
  if (currencyId === 2) return '€';
  if (currencyId === 3) return '$';
  if (currencyId === 4) return '£';
  return label || '₪';
}

function currencyLabelFromJoin(
  currencyJoin: any,
  currencyId: number | null,
): string {
  const cur = unwrapOne(currencyJoin);
  if (cur?.name) return String(cur.name);
  if (cur?.iso_code) return String(cur.iso_code);
  if (currencyId === 1) return '₪';
  if (currencyId === 2) return '€';
  if (currencyId === 3) return '$';
  if (currencyId === 4) return '£';
  return currencyId != null ? `Currency #${currencyId}` : '—';
}

function firmInfoFromJoin(firmJoin: any): {
  name: string | null;
  profileImageUrl: string | null;
} {
  const firm = unwrapOne(firmJoin);
  if (!firm) return { name: null, profileImageUrl: null };
  const name = firm?.name != null ? String(firm.name).trim() || null : null;
  const profileImageUrl =
    firm?.profile_image_url != null
      ? String(firm.profile_image_url).trim() || null
      : null;
  return { name, profileImageUrl };
}

async function fetchAllPaged<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const { data, error } = await run(from, to);
    if (error) throw error;
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

function applyDateFilters(
  query: any,
  dateFrom?: string | null,
  dateTo?: string | null,
  column = 'created_at',
) {
  let q = query;
  if (dateFrom) q = q.gte(column, startOfDayIso(dateFrom));
  if (dateTo) q = q.lte(column, endOfDayIso(dateTo));
  return q;
}

type LeadMeta = {
  leadKey: string;
  leadType: 'new' | 'legacy';
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
  clientName: string | null;
  stageName: string | null;
  stageId: string | null;
  stageColour: string | null;
  mainCategory: string | null;
  subcategory: string | null;
  leadSource: string | null;
  leadSourceId: string | null;
  currencyId: number | null;
  currencyLabel: string;
  externalFirmId: string | null;
  externalFirmName: string | null;
  externalFirmProfileImageUrl: string | null;
  subcontractorFee: number;
  createdAt: string | null;
};

function leadMetaFromNewRow(row: any): LeadMeta {
  const id = String(row.id);
  const currencyId =
    row.currency_id != null && Number.isFinite(Number(row.currency_id))
      ? Number(row.currency_id)
      : null;
  const cats = categoryPartsFromJoin(row.misc_category);
  const firm = firmInfoFromJoin(row.firms);
  const source = sourceInfoFromJoin(row.misc_leadsource);
  const stage = stageInfoFromJoin(row.lead_stages);
  return {
    leadKey: id,
    leadType: 'new',
    newLeadId: id,
    legacyLeadId: null,
    leadNumber: row.lead_number != null ? String(row.lead_number) : null,
    clientName: row.name != null ? String(row.name).trim() || null : null,
    stageName: stage.name,
    stageId: stage.id,
    stageColour: stage.colour,
    mainCategory: cats.mainCategory,
    subcategory: cats.subcategory,
    leadSource: source.name,
    leadSourceId: source.id,
    currencyId,
    currencyLabel: currencyLabelFromJoin(row.accounting_currencies, currencyId),
    externalFirmId: row.external_firm_id != null ? String(row.external_firm_id) : null,
    externalFirmName: firm.name,
    externalFirmProfileImageUrl: firm.profileImageUrl,
    subcontractorFee: Number(row.subcontractor_fee ?? 0) || 0,
    createdAt: row.created_at ? String(row.created_at) : null,
  };
}

function leadMetaFromLegacyRow(row: any): LeadMeta {
  const id = Number(row.id);
  const currencyId =
    row.currency_id != null && Number.isFinite(Number(row.currency_id))
      ? Number(row.currency_id)
      : null;
  const cats = categoryPartsFromJoin(row.misc_category);
  const firm = firmInfoFromJoin(row.firms);
  const source = sourceInfoFromJoin(row.misc_leadsource);
  const stage = stageInfoFromJoin(row.lead_stages);
  return {
    leadKey: `legacy_${id}`,
    leadType: 'legacy',
    newLeadId: null,
    legacyLeadId: id,
    leadNumber: row.manual_id != null ? String(row.manual_id) : String(id),
    clientName: row.name != null ? String(row.name).trim() || null : null,
    stageName: stage.name,
    stageId: stage.id,
    stageColour: stage.colour,
    mainCategory: cats.mainCategory,
    subcategory: cats.subcategory,
    leadSource: source.name,
    leadSourceId: source.id,
    currencyId,
    currencyLabel: currencyLabelFromJoin(row.accounting_currencies, currencyId),
    externalFirmId: row.external_firm_id != null ? String(row.external_firm_id) : null,
    externalFirmName: firm.name,
    externalFirmProfileImageUrl: firm.profileImageUrl,
    subcontractorFee: Number(row.subcontractor_fee ?? 0) || 0,
    // Legacy leads use `cdate`, not `created_at`.
    createdAt: row.cdate ? String(row.cdate) : null,
  };
}

async function fetchNewLeadMeta(ids: string[]): Promise<Map<string, LeadMeta>> {
  const map = new Map<string, LeadMeta>();
  if (ids.length === 0) return map;

  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from('leads')
      .select(
        `
        id, name, lead_number, created_at, subcontractor_fee, currency_id, external_firm_id,
        accounting_currencies!leads_currency_id_fkey ( id, name, iso_code ),
        firms!leads_external_firm_id_fkey ( id, name, profile_image_url ),
        misc_leadsource!fk_leads_source_id ( id, name ),
        lead_stages!fk_leads_stage ( id, name, colour ),
        misc_category!fk_leads_category_id (
          id, name, parent_id,
          misc_maincategory!parent_id ( id, name )
        )
      `,
      )
      .in('id', chunk);
    if (error) throw error;
    for (const row of data || []) {
      map.set(String(row.id), leadMetaFromNewRow(row));
    }
  }
  return map;
}

async function fetchLegacyLeadMeta(ids: number[]): Promise<Map<number, LeadMeta>> {
  const map = new Map<number, LeadMeta>();
  if (ids.length === 0) return map;

  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from('leads_lead')
      .select(
        `
        id, name, manual_id, cdate, subcontractor_fee, currency_id, external_firm_id,
        accounting_currencies!leads_lead_currency_id_fkey ( id, name, iso_code ),
        firms!leads_lead_external_firm_id_fkey ( id, name, profile_image_url ),
        misc_leadsource!leads_lead_source_id_fkey ( id, name ),
        lead_stages!fk_leads_lead_stage ( id, name, colour ),
        misc_category!leads_lead_category_id_fkey (
          id, name, parent_id,
          misc_maincategory!parent_id ( id, name )
        )
      `,
      )
      .in('id', chunk);
    if (error) throw error;
    for (const row of data || []) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      map.set(id, leadMetaFromLegacyRow(row));
    }
  }
  return map;
}

async function fetchContactNamesByLeadKeys(params: {
  newLeadIds: string[];
  legacyLeadIds: number[];
}): Promise<Map<string, string[]>> {
  const namesByLead = new Map<string, string[]>();
  const contactIds = new Set<number>();
  const links: Array<{ leadKey: string; contactId: number }> = [];

  const tasks: Promise<void>[] = [];
  if (params.newLeadIds.length > 0) {
    tasks.push(
      (async () => {
        for (let i = 0; i < params.newLeadIds.length; i += PAGE) {
          const chunk = params.newLeadIds.slice(i, i + PAGE);
          const { data, error } = await supabase
            .from('lead_leadcontact')
            .select('contact_id, newlead_id')
            .in('newlead_id', chunk);
          if (error) {
            console.warn('[subcontractorFeesReport] contact links (new):', error);
            return;
          }
          for (const row of data || []) {
            if (row.contact_id == null || !row.newlead_id) continue;
            const contactId = Number(row.contact_id);
            if (!Number.isFinite(contactId)) continue;
            contactIds.add(contactId);
            links.push({ leadKey: String(row.newlead_id), contactId });
          }
        }
      })(),
    );
  }
  if (params.legacyLeadIds.length > 0) {
    tasks.push(
      (async () => {
        for (let i = 0; i < params.legacyLeadIds.length; i += PAGE) {
          const chunk = params.legacyLeadIds.slice(i, i + PAGE);
          const { data, error } = await supabase
            .from('lead_leadcontact')
            .select('contact_id, lead_id')
            .in('lead_id', chunk);
          if (error) {
            console.warn('[subcontractorFeesReport] contact links (legacy):', error);
            return;
          }
          for (const row of data || []) {
            if (row.contact_id == null || row.lead_id == null) continue;
            const contactId = Number(row.contact_id);
            const leadId = Number(row.lead_id);
            if (!Number.isFinite(contactId) || !Number.isFinite(leadId)) continue;
            contactIds.add(contactId);
            links.push({ leadKey: `legacy_${leadId}`, contactId });
          }
        }
      })(),
    );
  }
  await Promise.all(tasks);

  if (links.length === 0) return namesByLead;

  const nameByContactId = new Map<number, string>();
  const idList = Array.from(contactIds);
  for (let i = 0; i < idList.length; i += PAGE) {
    const chunk = idList.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from('leads_contact')
      .select('id, name')
      .in('id', chunk);
    if (error) {
      console.warn('[subcontractorFeesReport] contact names:', error);
      break;
    }
    for (const row of data || []) {
      const id = Number(row.id);
      const name = row.name != null ? String(row.name).trim() : '';
      if (Number.isFinite(id) && name) nameByContactId.set(id, name);
    }
  }

  for (const link of links) {
    const name = nameByContactId.get(link.contactId);
    if (!name) continue;
    const list = namesByLead.get(link.leadKey) || [];
    if (!list.includes(name)) list.push(name);
    namesByLead.set(link.leadKey, list);
  }
  return namesByLead;
}

function rowMatchesLeadSearch(row: SubcontractorFeeReportRow, q: string): boolean {
  if (!q) return true;
  const haystacks = [
    row.leadNumber,
    row.clientName,
    row.leadKey,
    ...(row.contactNames || []),
  ];
  return haystacks.some((v) => (v || '').toLowerCase().includes(q));
}

function aggregateKey(parts: {
  leadKey: string;
  firmId: string | null;
  currencyId: number | null;
  source: SubcontractorFeeReportSource;
}): string {
  return [
    parts.leadKey,
    parts.firmId || 'nofirm',
    parts.currencyId != null ? String(parts.currencyId) : 'nocur',
    parts.source,
  ].join('|');
}

/**
 * Totals per lead × firm from `lead_subcontractor_fees`, plus legacy scalar
 * `leads` / `leads_lead.subcontractor_fee` when the lead has no fee-table rows yet.
 */
export async function fetchSubcontractorFeesReport(
  filters: SubcontractorFeesReportFilters = {},
): Promise<SubcontractorFeesReportResult> {
  const dateFrom = filters.dateFrom?.trim() || null;
  const dateTo = filters.dateTo?.trim() || null;

  const feeRows = await fetchAllPaged<any>((from, to) => {
    let q = supabase
      .from('lead_subcontractor_fees')
      .select(
        `
        id, created_at, lead_type, new_lead_id, legacy_lead_id, lead_number,
        firm_id, amount, currency_id, notes,
        firms ( id, name, profile_image_url ),
        accounting_currencies ( id, name, iso_code )
      `,
      )
      .order('created_at', { ascending: false })
      .range(from, to);
    q = applyDateFilters(q, dateFrom, dateTo);
    return q;
  });

  const newIdsFromFees = new Set<string>();
  const legacyIdsFromFees = new Set<number>();
  for (const row of feeRows) {
    if (row.new_lead_id) newIdsFromFees.add(String(row.new_lead_id));
    if (row.legacy_lead_id != null) {
      const n = Number(row.legacy_lead_id);
      if (Number.isFinite(n)) legacyIdsFromFees.add(n);
    }
  }

  // Scalar-only leads: fee column > 0 and not already covered by fee-table lines.
  const [newScalar, legacyScalar] = await Promise.all([
    fetchAllPaged<any>((from, to) => {
      let q = supabase
        .from('leads')
        .select(
          `
          id, name, lead_number, created_at, subcontractor_fee, currency_id, external_firm_id,
          accounting_currencies!leads_currency_id_fkey ( id, name, iso_code ),
          firms!leads_external_firm_id_fkey ( id, name, profile_image_url ),
          misc_leadsource!fk_leads_source_id ( id, name ),
          lead_stages!fk_leads_stage ( id, name, colour ),
          misc_category!fk_leads_category_id (
            id, name, parent_id,
            misc_maincategory!parent_id ( id, name )
          )
        `,
        )
        .gt('subcontractor_fee', 0)
        .order('created_at', { ascending: false })
        .range(from, to);
      q = applyDateFilters(q, dateFrom, dateTo, 'created_at');
      return q;
    }),
    fetchAllPaged<any>((from, to) => {
      let q = supabase
        .from('leads_lead')
        .select(
          `
          id, name, manual_id, cdate, subcontractor_fee, currency_id, external_firm_id,
          accounting_currencies!leads_lead_currency_id_fkey ( id, name, iso_code ),
          firms!leads_lead_external_firm_id_fkey ( id, name, profile_image_url ),
          misc_leadsource!leads_lead_source_id_fkey ( id, name ),
          lead_stages!fk_leads_lead_stage ( id, name, colour ),
          misc_category!leads_lead_category_id_fkey (
            id, name, parent_id,
            misc_maincategory!parent_id ( id, name )
          )
        `,
        )
        .gt('subcontractor_fee', 0)
        .order('cdate', { ascending: false })
        .range(from, to);
      q = applyDateFilters(q, dateFrom, dateTo, 'cdate');
      return q;
    }),
  ]);

  const needNewMeta = new Set(newIdsFromFees);
  const needLegacyMeta = new Set(legacyIdsFromFees);
  for (const row of newScalar) {
    const id = String(row.id);
    if (!newIdsFromFees.has(id)) needNewMeta.add(id);
  }
  for (const row of legacyScalar) {
    const id = Number(row.id);
    if (Number.isFinite(id) && !legacyIdsFromFees.has(id)) needLegacyMeta.add(id);
  }

  const [newMeta, legacyMeta] = await Promise.all([
    fetchNewLeadMeta(Array.from(needNewMeta)),
    fetchLegacyLeadMeta(Array.from(needLegacyMeta)),
  ]);

  // Fill meta from scalar fetches for leads not yet in maps (avoids double round-trip miss).
  for (const row of newScalar) {
    const id = String(row.id);
    if (newMeta.has(id)) continue;
    newMeta.set(id, leadMetaFromNewRow(row));
  }
  for (const row of legacyScalar) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || legacyMeta.has(id)) continue;
    legacyMeta.set(id, leadMetaFromLegacyRow(row));
  }

  const contactNamesByLead = await fetchContactNamesByLeadKeys({
    newLeadIds: Array.from(
      new Set(
        [
          ...Array.from(needNewMeta),
          ...Array.from(newMeta.keys()),
        ].map(String),
      ),
    ),
    legacyLeadIds: Array.from(
      new Set(
        [
          ...Array.from(needLegacyMeta),
          ...Array.from(legacyMeta.keys()),
        ].filter((n) => Number.isFinite(n)),
      ),
    ),
  });

  const aggregated = new Map<string, SubcontractorFeeReportRow>();

  const bump = (row: Omit<SubcontractorFeeReportRow, 'amountNis'> & { amountNis?: number }) => {
    const key = aggregateKey(row);
    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, {
        ...row,
        key,
        amount: Math.round(row.amount * 100) / 100,
        amountNis: 0,
        notes: row.notes?.trim() || null,
      });
      return;
    }
    existing.amount = Math.round((existing.amount + row.amount) * 100) / 100;
    if (row.feeDate && (!existing.feeDate || row.feeDate > existing.feeDate)) {
      existing.feeDate = row.feeDate;
    }
    for (const name of row.contactNames || []) {
      if (!existing.contactNames.includes(name)) existing.contactNames.push(name);
    }
    const note = row.notes?.trim();
    if (note) {
      if (!existing.notes) existing.notes = note;
      else if (!existing.notes.split('\n').includes(note)) {
        existing.notes = `${existing.notes}\n${note}`;
      }
    }
  };

  for (const fee of feeRows) {
    const amount = Number(fee.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let meta: LeadMeta | undefined;
    if (fee.new_lead_id) meta = newMeta.get(String(fee.new_lead_id));
    else if (fee.legacy_lead_id != null) meta = legacyMeta.get(Number(fee.legacy_lead_id));

    const leadType: 'new' | 'legacy' =
      fee.lead_type === 'legacy' || fee.legacy_lead_id != null
        ? 'legacy'
        : 'new';
    const leadKey =
      meta?.leadKey ||
      (fee.new_lead_id
        ? String(fee.new_lead_id)
        : fee.legacy_lead_id != null
          ? `legacy_${fee.legacy_lead_id}`
          : `fee_${fee.id}`);
    const currencyId =
      fee.currency_id != null && Number.isFinite(Number(fee.currency_id))
        ? Number(fee.currency_id)
        : meta?.currencyId ?? null;
    const feeFirm = firmInfoFromJoin(fee.firms);

    bump({
      key: '',
      leadKey,
      leadType,
      newLeadId: fee.new_lead_id ? String(fee.new_lead_id) : null,
      legacyLeadId:
        fee.legacy_lead_id != null && Number.isFinite(Number(fee.legacy_lead_id))
          ? Number(fee.legacy_lead_id)
          : null,
      leadNumber: meta?.leadNumber ?? (fee.lead_number != null ? String(fee.lead_number) : null),
      clientName: meta?.clientName ?? null,
      contactNames: contactNamesByLead.get(leadKey) || [],
      stageName: meta?.stageName ?? null,
      stageId: meta?.stageId ?? null,
      stageColour: meta?.stageColour ?? null,
      mainCategory: meta?.mainCategory ?? null,
      subcategory: meta?.subcategory ?? null,
      leadSource: meta?.leadSource ?? null,
      leadSourceId: meta?.leadSourceId ?? null,
      firmId: fee.firm_id != null ? String(fee.firm_id) : null,
      firmName: feeFirm.name,
      firmProfileImageUrl: feeFirm.profileImageUrl,
      amount,
      currencyId,
      currencyLabel: currencyLabelFromJoin(fee.accounting_currencies, currencyId),
      feeDate: fee.created_at ? String(fee.created_at) : null,
      notes: fee.notes != null ? String(fee.notes).trim() || null : null,
      source: 'fee_table',
    });
  }

  for (const meta of newMeta.values()) {
    if (newIdsFromFees.has(meta.leadKey)) continue;
    if (!(meta.subcontractorFee > 0)) continue;
    bump({
      key: '',
      leadKey: meta.leadKey,
      leadType: 'new',
      newLeadId: meta.newLeadId,
      legacyLeadId: null,
      leadNumber: meta.leadNumber,
      clientName: meta.clientName,
      contactNames: contactNamesByLead.get(meta.leadKey) || [],
      stageName: meta.stageName,
      stageId: meta.stageId,
      stageColour: meta.stageColour,
      mainCategory: meta.mainCategory,
      subcategory: meta.subcategory,
      leadSource: meta.leadSource,
      leadSourceId: meta.leadSourceId,
      firmId: meta.externalFirmId,
      firmName: meta.externalFirmName,
      firmProfileImageUrl: meta.externalFirmProfileImageUrl,
      amount: meta.subcontractorFee,
      currencyId: meta.currencyId,
      currencyLabel: meta.currencyLabel,
      feeDate: meta.createdAt,
      notes: null,
      source: 'lead_column',
    });
  }

  for (const meta of legacyMeta.values()) {
    if (meta.legacyLeadId != null && legacyIdsFromFees.has(meta.legacyLeadId)) continue;
    if (!(meta.subcontractorFee > 0)) continue;
    bump({
      key: '',
      leadKey: meta.leadKey,
      leadType: 'legacy',
      newLeadId: null,
      legacyLeadId: meta.legacyLeadId,
      leadNumber: meta.leadNumber,
      clientName: meta.clientName,
      contactNames: contactNamesByLead.get(meta.leadKey) || [],
      stageName: meta.stageName,
      stageId: meta.stageId,
      stageColour: meta.stageColour,
      mainCategory: meta.mainCategory,
      subcategory: meta.subcategory,
      leadSource: meta.leadSource,
      leadSourceId: meta.leadSourceId,
      firmId: meta.externalFirmId,
      firmName: meta.externalFirmName,
      firmProfileImageUrl: meta.externalFirmProfileImageUrl,
      amount: meta.subcontractorFee,
      currencyId: meta.currencyId,
      currencyLabel: meta.currencyLabel,
      feeDate: meta.createdAt,
      notes: null,
      source: 'lead_column',
    });
  }

  let rows = Array.from(aggregated.values());

  const mainCategoryFilter = filters.mainCategory?.trim() || '';
  if (mainCategoryFilter) {
    rows = rows.filter((r) => (r.mainCategory || '') === mainCategoryFilter);
  }

  const firmSearch = filters.firmSearch?.trim().toLowerCase() || '';
  if (firmSearch) {
    rows = rows.filter((r) => (r.firmName || '').toLowerCase().includes(firmSearch));
  }

  const leadSearch = filters.leadSearch?.trim().toLowerCase() || '';
  if (leadSearch) {
    rows = rows.filter((r) => rowMatchesLeadSearch(r, leadSearch));
  }

  rows.sort((a, b) => {
    const da = a.feeDate || '';
    const db = b.feeDate || '';
    if (da !== db) return db.localeCompare(da);
    const fa = (a.firmName || '').localeCompare(b.firmName || '');
    if (fa !== 0) return fa;
    return (a.leadNumber || '').localeCompare(b.leadNumber || '', undefined, { numeric: true });
  });

  // Convert each row to NIS with BOI rates as of the fee/lead date.
  const boiConverter = await createBoiDateRateConverter();
  await Promise.all(
    rows.map(async (row) => {
      const currencyInput = row.currencyId ?? row.currencyLabel ?? 1;
      const nis = await boiConverter.toNis(row.amount, currencyInput, row.feeDate);
      row.amountNis = Math.round((Number.isFinite(nis) ? nis : 0) * 100) / 100;
    }),
  );

  // Prefer full category list from DB for the filter dropdown.
  let categoryOptions: string[] = [];
  try {
    const { data: cats } = await supabase
      .from('misc_maincategory')
      .select('name')
      .order('name', { ascending: true });
    if (cats?.length) {
      categoryOptions = Array.from(
        new Set(
          cats
            .map((c) => (c.name != null ? String(c.name).trim() : ''))
            .filter(Boolean),
        ),
      );
    }
  } catch {
    categoryOptions = Array.from(
      new Set(rows.map((r) => r.mainCategory).filter((v): v is string => Boolean(v))),
    ).sort((a, b) => a.localeCompare(b));
  }

  return { rows, mainCategories: categoryOptions };
}

export function buildSubcontractorFeeClientRoute(row: SubcontractorFeeReportRow): string | null {
  if (row.leadType === 'legacy' && row.legacyLeadId != null) {
    return `/clients/${encodeURIComponent(String(row.legacyLeadId))}`;
  }
  if (row.leadNumber) {
    return `/clients/${encodeURIComponent(row.leadNumber)}`;
  }
  if (row.newLeadId) {
    return `/clients/${encodeURIComponent(row.newLeadId)}`;
  }
  return null;
}

export function buildExternalFirmReportRoute(firmId: string | null | undefined): string | null {
  if (!firmId) return null;
  return `/reports/external-firms?firmId=${encodeURIComponent(firmId)}`;
}

export async function updateReportLeadExternalFirm(
  row: Pick<SubcontractorFeeReportRow, 'leadType' | 'newLeadId' | 'legacyLeadId' | 'firmId' | 'currencyId' | 'source'>,
  nextFirmId: string | null,
): Promise<void> {
  if (row.leadType === 'legacy' && row.legacyLeadId != null) {
    const { error } = await supabase
      .from('leads_lead')
      .update({ external_firm_id: nextFirmId })
      .eq('id', row.legacyLeadId);
    if (error) throw error;
  } else if (row.newLeadId) {
    const { error } = await supabase
      .from('leads')
      .update({ external_firm_id: nextFirmId })
      .eq('id', row.newLeadId);
    if (error) throw error;
  } else {
    throw new Error('Lead identity missing');
  }

  // Fee-table rows: also move matching fee lines to the new firm.
  if (row.source === 'fee_table' && row.firmId && nextFirmId && row.firmId !== nextFirmId) {
    let q = supabase
      .from('lead_subcontractor_fees')
      .update({ firm_id: nextFirmId, updated_at: new Date().toISOString() });
    if (row.leadType === 'legacy' && row.legacyLeadId != null) {
      q = q.eq('legacy_lead_id', row.legacyLeadId);
    } else if (row.newLeadId) {
      q = q.eq('new_lead_id', row.newLeadId);
    }
    q = q.eq('firm_id', row.firmId);
    if (row.currencyId != null) q = q.eq('currency_id', row.currencyId);
    const { error } = await q;
    if (error) throw error;
  }
}

export async function updateReportLeadSource(
  row: Pick<SubcontractorFeeReportRow, 'leadType' | 'newLeadId' | 'legacyLeadId'>,
  nextSourceId: string | null,
  displayName?: string | null,
): Promise<void> {
  const updateData: Record<string, unknown> = {};
  applyLeadSourceIdUpdate(updateData, nextSourceId, displayName);

  if (row.leadType === 'legacy' && row.legacyLeadId != null) {
    const { error } = await supabase
      .from('leads_lead')
      .update(updateData)
      .eq('id', row.legacyLeadId);
    if (error) throw error;
    return;
  }
  if (row.newLeadId) {
    const { error } = await supabase.from('leads').update(updateData).eq('id', row.newLeadId);
    if (error) throw error;
    return;
  }
  throw new Error('Lead identity missing');
}

function reportRowFeeIdentity(
  row: Pick<SubcontractorFeeReportRow, 'leadType' | 'newLeadId' | 'legacyLeadId' | 'leadNumber'>,
): LeadFeeIdentity {
  if (row.leadType === 'legacy') {
    return {
      leadType: 'legacy',
      legacyLeadId: row.legacyLeadId,
      leadNumber: row.leadNumber,
    };
  }
  return {
    leadType: 'new',
    newLeadId: row.newLeadId,
    leadNumber: row.leadNumber,
  };
}

function applyReportFeeMatchFilters<T extends { eq: Function; is: Function }>(
  query: T,
  row: Pick<
    SubcontractorFeeReportRow,
    'leadType' | 'newLeadId' | 'legacyLeadId' | 'firmId' | 'currencyId'
  >,
): T {
  let q = query;
  if (row.leadType === 'legacy' && row.legacyLeadId != null) {
    q = q.eq('legacy_lead_id', row.legacyLeadId);
  } else if (row.newLeadId) {
    q = q.eq('new_lead_id', row.newLeadId);
  } else {
    throw new Error('Lead identity missing');
  }
  if (row.firmId) q = q.eq('firm_id', row.firmId);
  else q = q.is('firm_id', null);
  if (row.currencyId != null) q = q.eq('currency_id', row.currencyId);
  else q = q.is('currency_id', null);
  return q;
}

/** Delete fee lines for this report row (or zero the legacy lead scalar). */
export async function deleteReportFeeRow(row: SubcontractorFeeReportRow): Promise<void> {
  if (row.source === 'fee_table') {
    let q = supabase.from('lead_subcontractor_fees').delete();
    q = applyReportFeeMatchFilters(q as any, row);
    const { error } = await q;
    if (error) throw error;
    return;
  }
  await setLeadSubcontractorFeeScalar(reportRowFeeIdentity(row), 0);
}

/**
 * Set the aggregate amount for this report row.
 * Fee-table rows are consolidated into a single fee line; lead-column rows update the scalar.
 */
export async function updateReportFeeAmount(
  row: SubcontractorFeeReportRow,
  amount: number,
  createdBy?: string | null,
): Promise<void> {
  const rounded = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(rounded) || rounded < 0) {
    throw new Error('Enter a valid amount');
  }

  if (row.source === 'lead_column') {
    await setLeadSubcontractorFeeScalar(reportRowFeeIdentity(row), rounded);
    return;
  }

  if (!row.firmId) {
    throw new Error('Assign a firm before editing the fee amount');
  }

  let del = supabase.from('lead_subcontractor_fees').delete();
  del = applyReportFeeMatchFilters(del as any, row);
  const { error: delError } = await del;
  if (delError) throw delError;

  if (rounded <= 0) return;

  await insertLeadSubcontractorFee({
    identity: reportRowFeeIdentity(row),
    firmId: row.firmId,
    amount: rounded,
    currencyId: row.currencyId,
    notes: row.notes,
    createdBy: createdBy || null,
  });
}

/** Update notes on matching fee lines (or create a fee line for lead-column rows). */
export async function updateReportFeeNotes(
  row: SubcontractorFeeReportRow,
  notes: string | null,
  createdBy?: string | null,
): Promise<void> {
  const trimmed = notes?.trim() || null;

  if (row.source === 'fee_table') {
    let q = supabase
      .from('lead_subcontractor_fees')
      .update({
        notes: trimmed,
        updated_at: new Date().toISOString(),
        updated_by: createdBy || null,
      });
    q = applyReportFeeMatchFilters(q as any, row);
    const { error } = await q;
    if (error) throw error;
    return;
  }

  // Legacy scalar-only row: need a fee line to store notes.
  if (!trimmed) return;
  if (!row.firmId) {
    throw new Error('Assign a firm before adding a note');
  }
  if (!(row.amount > 0)) {
    throw new Error('Fee amount is required before adding a note');
  }

  await insertLeadSubcontractorFee({
    identity: reportRowFeeIdentity(row),
    firmId: row.firmId,
    amount: Math.round(Number(row.amount) * 100) / 100,
    currencyId: row.currencyId,
    notes: trimmed,
    createdBy: createdBy || null,
  });
}

export function formatFeeReportCategory(row: SubcontractorFeeReportRow): string {
  return formatCategoryLabel(row.mainCategory, row.subcategory);
}

export function formatFeeReportMoney(
  amount: number,
  currencyLabel: string | null | undefined,
  currencyId: number | null | undefined,
): string {
  const sign = currencySignFromLabel(currencyLabel, currencyId ?? null);
  return `${sign}${formatFeeReportAmount(amount)}`;
}

export function formatFeeReportAmount(amount: number): string {
  return Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatFeeReportDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}
