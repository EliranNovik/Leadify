import { supabase } from './supabase';

const LEGACY_INTERACTION_LIMIT = 200;

interface LegacyInteraction {
  id: number;
  cdate: string | null;
  kind: string | null;
  date: string | null;
  time: string | null;
  minutes: number | null;
  content: string | null;
  creator_id: string | null;
  direction: string | null;
  employee_id: string | null;
  description: string | null;
}

interface EmployeeRecord {
  id: string;
  display_name: string | null;
  official_name: string | null;
}

export interface TransformedLegacyInteraction {
  id: string | number;
  date: string;
  time: string;
  raw_date: string;
  employee: string;
  direction: 'in' | 'out';
  kind: string;
  length: string;
  content: string;
  observation: string;
  editable: boolean;
  status?: string;
  subject?: string;
}

const cleanLegacyText = (text?: string | null): string => {
  if (!text || text === '\\N' || text === 'EMPTY' || text === 'FAILED') {
    return '';
  }

  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .trim();
};

const transformLegacyInteraction = (
  interaction: LegacyInteraction,
  employeeMap: Record<string, EmployeeRecord>,
  clientName: string,
): TransformedLegacyInteraction => {
  let interactionDate = interaction.date || interaction.cdate?.split('T')[0] || '';
  let interactionTime = interaction.time || interaction.cdate?.split('T')[1]?.substring(0, 5) || '';

  if (interactionDate === '\\N' || interactionDate === 'EMPTY') interactionDate = '';
  if (interactionTime === '\\N' || interactionTime === 'EMPTY') interactionTime = '';

  let direction: 'in' | 'out' = 'in';
  if (interaction.direction === 'o' || interaction.kind === 'c') {
    direction = 'out';
  }

  let kind = interaction.kind || 'note';
  switch (kind) {
    case 'w':
      kind = 'whatsapp';
      break;
    case 'c':
      kind = 'call';
      break;
    case 'e':
      kind = 'email';
      break;
    default:
      kind = 'note';
  }

  let content = cleanLegacyText(interaction.content);
  if (!content) {
    content = 'No content';
  }

  const length = interaction.minutes ? `${interaction.minutes} min` : '';

  let employeeName = clientName || 'Client';
  if (direction === 'out') {
    let employeeId: string | null = null;
    if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY') {
      employeeId = interaction.creator_id;
    } else if (interaction.employee_id && interaction.employee_id !== '\\N' && interaction.employee_id !== 'EMPTY') {
      employeeId = interaction.employee_id;
    }

    if (employeeId && employeeMap[employeeId]) {
      const record = employeeMap[employeeId];
      employeeName = record.display_name || record.official_name || employeeId;
    } else if (employeeId) {
      employeeName = employeeId;
    } else {
      employeeName = 'Unknown';
    }
  }

  return {
    id: `legacy_${interaction.id}`,
    date: interactionDate
      ? new Date(interactionDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : 'Unknown',
    time: interactionTime || 'Unknown',
    raw_date: interaction.cdate || interactionDate || '',
    employee: employeeName,
    direction,
    kind,
    length,
    content,
    observation: cleanLegacyText(interaction.description),
    editable: false,
    status: interaction.direction === 'o' ? 'sent' : 'received',
    subject: cleanLegacyText(interaction.description),
  };
};

export const fetchLegacyInteractions = async (
  leadId: string,
  clientName?: string,
): Promise<TransformedLegacyInteraction[]> => {
  const numericId = parseInt(leadId.replace('legacy_', ''), 10);
  if (Number.isNaN(numericId)) {
    return [];
  }

  const { data, error } = await supabase
    .from('leads_leadinteractions')
    .select(
      'id, cdate, kind, date, time, minutes, content, creator_id, direction, employee_id, description',
    )
    .eq('lead_id', numericId)
    .order('cdate', { ascending: false })
    .limit(LEGACY_INTERACTION_LIMIT);

  if (error) {
    console.error('❌ Error fetching legacy interactions:', error);
    return [];
  }

  const interactions = (data || []) as LegacyInteraction[];
  const employeeIds = [
    ...new Set(
      interactions.flatMap((interaction) => {
        const ids: string[] = [];
        if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY') {
          ids.push(interaction.creator_id);
        }
        if (interaction.employee_id && interaction.employee_id !== '\\N' && interaction.employee_id !== 'EMPTY') {
          ids.push(interaction.employee_id);
        }
        return ids;
      }),
    ),
  ];

  let employeeMap: Record<string, EmployeeRecord> = {};
  if (employeeIds.length > 0) {
    const { data: employeeData, error: employeeError } = await supabase
      .from('tenants_employee')
      .select('id, display_name, official_name')
      .in('id', employeeIds);

    if (!employeeError && employeeData) {
      employeeMap = (employeeData as EmployeeRecord[]).reduce((acc, record) => {
        acc[record.id.toString()] = record;
        return acc;
      }, {} as Record<string, EmployeeRecord>);
    }
  }

  return interactions.map((interaction) =>
    transformLegacyInteraction(interaction, employeeMap, clientName || 'Client'),
  );
};

