import { supabase } from './supabase';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): boolean {
  return Boolean(value && UUID_REGEX.test(String(value).trim()));
}

const NEW_LEAD_SELECT = `
  id, lead_number, name, stage, status, master_id, linked_master_lead, category_id,
  misc_category!category_id(id, name, parent_id, misc_maincategory!parent_id(id, name)),
  lead_stages!leads_stage_fkey(name, colour)
`;

const LEGACY_LEAD_SELECT = `
  id, name, lead_number, manual_id, stage, status, master_id, linked_master_lead, category_id,
  misc_category!leads_lead_category_id_fkey(id, name, parent_id, misc_maincategory!parent_id(id, name)),
  lead_stages!fk_leads_lead_stage(name, colour)
`;

export type ContactBridgeContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  portal_profile_image_path: string | null;
};

export type ContactBridgeLead = {
  id: string;
  lead_number: string;
  name: string;
  lead_type: 'new' | 'legacy';
  stage: string;
  stage_name: string;
  stage_colour: string;
  category: string;
  status?: string | number | null;
  is_sublead: boolean;
  is_master: boolean;
  is_main_for_contact: boolean;
  route: string;
  family_key: string;
  sort_order: number;
};

export type ContactBridgeData = {
  contact: ContactBridgeContact;
  leads: ContactBridgeLead[];
};

function formatCategoryFromRow(row: any): string {
  const categoryJoin = Array.isArray(row?.misc_category) ? row.misc_category[0] : row?.misc_category;
  if (categoryJoin?.name) {
    const mainRel = categoryJoin.misc_maincategory;
    const mainCategory = Array.isArray(mainRel) ? mainRel[0]?.name : mainRel?.name;
    return mainCategory ? `${categoryJoin.name} (${mainCategory})` : categoryJoin.name;
  }
  return row?.category || '';
}

function getStageMeta(row: any): { name: string; colour: string } {
  const stageJoin = Array.isArray(row?.lead_stages) ? row.lead_stages[0] : row?.lead_stages;
  return {
    name: stageJoin?.name || String(row?.stage ?? ''),
    colour: stageJoin?.colour || '',
  };
}

function buildNewLeadRoute(leadNumber: string): string {
  return `/clients/${encodeURIComponent(leadNumber)}`;
}

function buildLegacyLeadRoute(id: number | string): string {
  return `/clients/${encodeURIComponent(String(id).replace(/^legacy_/, ''))}`;
}

function formatLegacyLeadNumbers(rows: any[]): Map<number, string> {
  const numbers = new Map<number, string>();
  const subleadsByMaster = new Map<number, any[]>();

  rows.forEach((row) => {
    if (row.master_id != null && row.master_id !== '') {
      const masterId = Number(row.master_id);
      const list = subleadsByMaster.get(masterId) || [];
      list.push(row);
      subleadsByMaster.set(masterId, list);
    }
  });

  subleadsByMaster.forEach((subs, masterId) => {
    subs.sort((a, b) => Number(a.id) - Number(b.id));
    subs.forEach((sub, index) => {
      numbers.set(Number(sub.id), `${masterId}/${index + 2}`);
    });
  });

  rows.forEach((row) => {
    const id = Number(row.id);
    if (numbers.has(id)) return;
    const raw = (row.lead_number ?? row.manual_id ?? '').toString().trim();
    numbers.set(id, raw || String(row.id));
  });

  return numbers;
}

function mapNewLeadRow(
  row: any,
  options: { isMainForContact?: boolean; familyKey: string; sortOrder: number },
): ContactBridgeLead {
  const leadNumber = row.lead_number || String(row.id);
  const hasMaster = row.master_id != null && String(row.master_id).trim() !== '';
  const isSublead = hasMaster || String(leadNumber).includes('/');
  const stage = getStageMeta(row);

  return {
    id: String(row.id),
    lead_number: leadNumber,
    name: row.name || leadNumber,
    lead_type: 'new',
    stage: String(row.stage ?? ''),
    stage_name: stage.name,
    stage_colour: stage.colour,
    category: formatCategoryFromRow(row),
    status: row.status ?? null,
    is_sublead: isSublead,
    is_master: !isSublead && !row.linked_master_lead,
    is_main_for_contact: Boolean(options.isMainForContact),
    route: buildNewLeadRoute(leadNumber),
    family_key: options.familyKey,
    sort_order: options.sortOrder,
  };
}

function mapLegacyLeadRow(
  row: any,
  leadNumber: string,
  options: { isMainForContact?: boolean; familyKey: string; sortOrder: number },
): ContactBridgeLead {
  const isSublead = row.master_id != null && String(row.master_id).trim() !== '';
  const stage = getStageMeta(row);

  return {
    id: String(row.id),
    lead_number: leadNumber,
    name: row.name || leadNumber,
    lead_type: 'legacy',
    stage: String(row.stage ?? ''),
    stage_name: stage.name,
    stage_colour: stage.colour,
    category: formatCategoryFromRow(row),
    status: row.status ?? null,
    is_sublead: isSublead,
    is_master: !isSublead,
    is_main_for_contact: Boolean(options.isMainForContact),
    route: buildLegacyLeadRoute(row.id),
    family_key: options.familyKey,
    sort_order: options.sortOrder,
  };
}

async function fetchNewLeadsByIds(ids: string[]): Promise<any[]> {
  const uuidIds = ids.filter((id) => isUuid(id));
  if (!uuidIds.length) return [];
  const { data, error } = await supabase.from('leads').select(NEW_LEAD_SELECT).in('id', uuidIds);
  if (error) throw error;
  return data || [];
}

async function fetchLegacyLeadsByIds(ids: number[]): Promise<any[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('leads_lead').select(LEGACY_LEAD_SELECT).in('id', ids);
  if (error) throw error;
  return data || [];
}

async function expandLegacyFamilies(seedIds: number[]): Promise<any[]> {
  const masterIds = new Set<number>();

  if (seedIds.length) {
    const seeds = await fetchLegacyLeadsByIds(seedIds);
    seeds.forEach((row) => {
      if (row.master_id != null && String(row.master_id).trim() !== '') {
        masterIds.add(Number(row.master_id));
      } else {
        masterIds.add(Number(row.id));
      }
    });
  }

  if (!masterIds.size) return [];

  const masterIdList = Array.from(masterIds);
  const [masters, byMasterId, byLinkedMaster] = await Promise.all([
    fetchLegacyLeadsByIds(masterIdList),
    supabase
      .from('leads_lead')
      .select(LEGACY_LEAD_SELECT)
      .in('master_id', masterIdList)
      .not('master_id', 'is', null)
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      }),
    supabase
      .from('leads_lead')
      .select(LEGACY_LEAD_SELECT)
      .in('linked_master_lead', masterIdList)
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      }),
  ]);

  const merged = new Map<number, any>();
  [...masters, ...byMasterId, ...byLinkedMaster].forEach((row) => {
    if (row?.id != null) merged.set(Number(row.id), row);
  });

  return Array.from(merged.values());
}

async function expandNewFamilies(seedIds: string[]): Promise<any[]> {
  const uuidSeedIds = seedIds.filter((id) => isUuid(id));
  if (!uuidSeedIds.length) return [];

  const seeds = await fetchNewLeadsByIds(uuidSeedIds);
  const familyRoots = new Set<string>();

  seeds.forEach((row) => {
    if (isUuid(row.master_id)) {
      familyRoots.add(String(row.master_id));
    } else if (isUuid(row.id)) {
      familyRoots.add(String(row.id));
    }
  });

  const uuidRoots = Array.from(familyRoots).filter((id) => isUuid(id));
  const linkedRefs = Array.from(familyRoots).filter((id) => !isUuid(id));

  const [roots, children, linked] = await Promise.all([
    fetchNewLeadsByIds(uuidRoots),
    uuidRoots.length
      ? supabase
          .from('leads')
          .select(NEW_LEAD_SELECT)
          .in('master_id', uuidRoots)
          .then(({ data, error }) => {
            if (error) throw error;
            return data || [];
          })
      : Promise.resolve([]),
    linkedRefs.length
      ? supabase
          .from('leads')
          .select(NEW_LEAD_SELECT)
          .in('linked_master_lead', linkedRefs)
          .then(({ data, error }) => {
            if (error) throw error;
            return data || [];
          })
      : Promise.resolve([]),
  ]);

  const merged = new Map<string, any>();
  [...seeds, ...roots, ...children, ...linked].forEach((row) => {
    if (row?.id) merged.set(String(row.id), row);
  });

  return Array.from(merged.values());
}

function sortBridgeLeads(leads: ContactBridgeLead[]): ContactBridgeLead[] {
  return [...leads].sort((a, b) => {
    if (a.family_key !== b.family_key) return a.family_key.localeCompare(b.family_key);
    if (a.is_master && !b.is_master) return -1;
    if (!a.is_master && b.is_master) return 1;
    return a.sort_order - b.sort_order || a.lead_number.localeCompare(b.lead_number);
  });
}

export async function fetchContactBridge(contactId: string): Promise<ContactBridgeData | null> {
  const contactNumericId = Number(contactId);
  if (Number.isNaN(contactNumericId)) return null;

  const { data: contactRow, error: contactError } = await supabase
    .from('leads_contact')
    .select('id, name, email, phone, mobile, portal_profile_image_path')
    .eq('id', contactNumericId)
    .maybeSingle();

  if (contactError) throw contactError;
  if (!contactRow) return null;

  const { data: junctionRows, error: junctionError } = await supabase
    .from('lead_leadcontact')
    .select('newlead_id, lead_id, main')
    .eq('contact_id', contactNumericId);

  if (junctionError) throw junctionError;

  const mainNewLeadIds = new Set<string>();
  const mainLegacyLeadIds = new Set<number>();
  const newLeadIds = new Set<string>();
  const legacyLeadIds = new Set<number>();

  (junctionRows || []).forEach((row: any) => {
    const isMain = row.main === true || row.main === 'true' || row.main === 't';
    if (row.newlead_id) {
      const newleadId = String(row.newlead_id);
      if (isUuid(newleadId)) {
        newLeadIds.add(newleadId);
        if (isMain) mainNewLeadIds.add(newleadId);
      } else {
        const legacyFromNewlead = Number(newleadId);
        if (!Number.isNaN(legacyFromNewlead)) {
          legacyLeadIds.add(legacyFromNewlead);
          if (isMain) mainLegacyLeadIds.add(legacyFromNewlead);
        }
      }
    }
    if (row.lead_id != null) {
      legacyLeadIds.add(Number(row.lead_id));
      if (isMain) mainLegacyLeadIds.add(Number(row.lead_id));
    }
  });

  const [newRows, legacyRows] = await Promise.all([
    expandNewFamilies(Array.from(newLeadIds)),
    expandLegacyFamilies(Array.from(legacyLeadIds)),
  ]);

  const legacyNumbers = formatLegacyLeadNumbers(legacyRows);
  const bridgeLeads: ContactBridgeLead[] = [];

  newRows.forEach((row, index) => {
    const familyKey = row.master_id ? `new:${row.master_id}` : `new:${row.id}`;
    bridgeLeads.push(
      mapNewLeadRow(row, {
        isMainForContact: mainNewLeadIds.has(String(row.id)),
        familyKey,
        sortOrder: index,
      }),
    );
  });

  legacyRows.forEach((row, index) => {
    const masterId =
      row.master_id != null && String(row.master_id).trim() !== '' ? Number(row.master_id) : Number(row.id);
    const familyKey = `legacy:${masterId}`;
    bridgeLeads.push(
      mapLegacyLeadRow(row, legacyNumbers.get(Number(row.id)) || String(row.id), {
        isMainForContact: mainLegacyLeadIds.has(Number(row.id)),
        familyKey,
        sortOrder: index,
      }),
    );
  });

  const deduped = new Map<string, ContactBridgeLead>();
  bridgeLeads.forEach((lead) => {
    const key = `${lead.lead_type}:${lead.id}`;
    const existing = deduped.get(key);
    if (!existing || (lead.is_main_for_contact && !existing.is_main_for_contact)) {
      deduped.set(key, lead);
    }
  });

  return {
    contact: {
      id: String(contactRow.id),
      name: contactRow.name || 'Unknown contact',
      email: contactRow.email || null,
      phone: contactRow.phone || null,
      mobile: contactRow.mobile || null,
      portal_profile_image_path: contactRow.portal_profile_image_path || null,
    },
    leads: sortBridgeLeads(Array.from(deduped.values())),
  };
}

export function buildContactBridgeRoute(contactId: string | number): string {
  return `/contacts/${encodeURIComponent(String(contactId))}`;
}
