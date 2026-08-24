import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { supabase } from '../_shared/supabase-client.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MEETING_SELECT =
  'id, meeting_date, meeting_time, status, meeting_amount, meeting_currency, meeting_brief, expert_notes, meeting_summary_notes, meeting_location, scheduler, expert';

const STAGE_FALLBACK: Record<string, string> = {
  '0': 'Created',
  '10': 'Scheduler assigned',
  '11': 'Precommunication',
  '15': 'Communication started',
  '20': 'Meeting scheduled',
  '21': 'Meeting rescheduling',
  '30': 'Meeting complete',
  '35': 'Meeting Irrelevant',
  '40': 'Waiting for Mtng sum',
  '50': 'Mtng sum+Agreement sent',
  '51': 'Client declined price offer',
  '55': 'Another meeting',
  '60': 'Client signed agreement',
  '70': 'Payment request sent',
  '91': 'Dropped (Spam/Irrelevant)',
  '100': 'Success',
  '105': 'Handler Set',
  '110': 'Handler Started',
  '150': 'Application submitted',
};

function stageNameFor(raw: unknown, names: Record<string, string>): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  const id = String(raw).trim();
  if (names[id]) return names[id];
  if (STAGE_FALLBACK[id]) return STAGE_FALLBACK[id];
  if (!/^\d+$/.test(id)) return id.replace(/_/g, ' ');
  return id;
}

type Direction = 'in' | 'out';

type Interaction = {
  channel: 'whatsapp' | 'email' | 'call' | 'manual' | 'meeting';
  direction: Direction | null;
  at: string | null;
  preview: string;
  subject?: string;
};

type MeetingRow = {
  id?: number;
  meeting_date?: string | null;
  meeting_time?: string | null;
  status?: string | null;
  meeting_amount?: number | string | null;
  meeting_currency?: string | null;
  meeting_brief?: string | null;
  expert_notes?: string | null;
  meeting_summary_notes?: string | null;
  meeting_location?: string | null;
  scheduler?: string | null;
  expert?: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function clip(raw: unknown, max = 400): string {
  const text = String(raw ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function clipNote(raw: unknown, max = 2500): string {
  return clip(raw, max);
}

function emailBody(row: { body_html?: unknown; body_preview?: unknown }): string {
  const html = clip(row.body_html, 900);
  const preview = clip(row.body_preview, 900);
  return html.length >= preview.length ? html : preview;
}

function normalizeDirection(raw: unknown): Direction | null {
  const d = String(raw ?? '').toLowerCase().trim();
  if (d === 'in' || d === 'inbound' || d === 'incoming' || d === 'i') return 'in';
  if (d === 'out' || d === 'outbound' || d === 'outgoing' || d === 'o') return 'out';
  if (d.includes('incoming')) return 'in';
  if (d.includes('outgoing') || d.includes('outbound')) return 'out';
  return null;
}

function parseLeadRef(leadId: string, isLegacyFlag?: boolean) {
  const raw = String(leadId || '').trim();
  const isLegacy = isLegacyFlag === true || raw.startsWith('legacy_');
  if (isLegacy) {
    const n = Number.parseInt(raw.replace(/^legacy_/i, ''), 10);
    return { isLegacy: true, legacyId: Number.isFinite(n) ? n : null, uuid: null as string | null };
  }
  return { isLegacy: false, legacyId: null as number | null, uuid: raw || null };
}

function cacheKeyFor(ref: { isLegacy: boolean; legacyId: number | null; uuid: string | null }): string {
  return ref.isLegacy ? `legacy_${ref.legacyId}` : String(ref.uuid);
}

function pick(row: Record<string, unknown> | null, keys: string[]): string | number | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') {
      return value as string | number;
    }
  }
  return null;
}

function sortByAtDesc(a: Interaction, b: Interaction) {
  return Date.parse(b.at || '') - Date.parse(a.at || '') || 0;
}

function jerusalemYmd(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

function meetingAt(row: MeetingRow): string | null {
  const date = String(row.meeting_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = String(row.meeting_time || '').slice(0, 8) || '00:00:00';
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

function mapMeeting(row: MeetingRow) {
  return {
    id: row.id ?? null,
    date: row.meeting_date || null,
    time: row.meeting_time || null,
    status: row.status || null,
    location: clip(row.meeting_location, 80) || null,
    amount: row.meeting_amount ?? null,
    currency: row.meeting_currency || null,
    scheduler: clip(row.scheduler, 80) || null,
    expert: clip(row.expert, 80) || null,
    brief: clip(row.meeting_brief, 900) || null,
    expertNotes: clip(row.expert_notes, 900) || null,
    summaryNotes: clip(row.meeting_summary_notes, 2200) || null,
  };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function requireUser(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const user = await requireUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const { isLegacy: isLegacyFlag } = body as { leadId?: string; isLegacy?: boolean; force?: boolean };
    const force = body?.force === true;
    const leadId = String(body?.leadId ?? '').trim();
    if (!leadId) return json({ error: 'leadId is required' }, 400);

    const ref = parseLeadRef(leadId, isLegacyFlag);
    if (ref.isLegacy && ref.legacyId == null) return json({ error: 'Invalid legacy lead id' }, 400);
    if (!ref.isLegacy && !ref.uuid) return json({ error: 'Invalid lead id' }, 400);

    const leadQuery = ref.isLegacy
      ? supabase.from('leads_lead').select('*').eq('id', ref.legacyId).maybeSingle()
      : supabase.from('leads').select('*').eq('id', ref.uuid).maybeSingle();

    const { data: leadRow, error: leadError } = await leadQuery;
    if (leadError) throw leadError;
    if (!leadRow) return json({ error: 'Lead not found' }, 404);

    const lead = leadRow as Record<string, unknown>;
    const interactions: Interaction[] = [];
    const cacheId = cacheKeyFor(ref);

    const waQuery = ref.isLegacy
      ? supabase
          .from('whatsapp_messages')
          .select('direction, message, sent_at, sender_name')
          .eq('legacy_id', ref.legacyId)
          .order('sent_at', { ascending: false })
          .limit(20)
      : supabase
          .from('whatsapp_messages')
          .select('direction, message, sent_at, sender_name')
          .eq('lead_id', ref.uuid)
          .order('sent_at', { ascending: false })
          .limit(20);

    const emailQuery = ref.isLegacy
      ? supabase
          .from('emails')
          .select('direction, subject, body_preview, body_html, sent_at')
          .eq('legacy_id', ref.legacyId)
          .order('sent_at', { ascending: false })
          .limit(10)
      : supabase
          .from('emails')
          .select('direction, subject, body_preview, body_html, sent_at')
          .eq('client_id', ref.uuid)
          .order('sent_at', { ascending: false })
          .limit(10);

    const callQuery = ref.isLegacy
      ? supabase
          .from('call_logs')
          .select('cdate, time, direction, duration, source, destination')
          .eq('lead_id', ref.legacyId)
          .order('cdate', { ascending: false })
          .limit(10)
      : supabase
          .from('call_logs')
          .select('cdate, time, direction, duration, source, destination')
          .eq('client_id', ref.uuid)
          .order('cdate', { ascending: false })
          .limit(10);

    const meetingQuery = ref.isLegacy
      ? supabase
          .from('meetings')
          .select(MEETING_SELECT)
          .eq('legacy_lead_id', ref.legacyId)
          .order('meeting_date', { ascending: false })
          .limit(10)
      : supabase
          .from('meetings')
          .select(MEETING_SELECT)
          .eq('client_id', ref.uuid)
          .order('meeting_date', { ascending: false })
          .limit(10);

    const linkedLegacyId = !ref.isLegacy ? Number.parseInt(String(lead.legacy_lead_id ?? ''), 10) : NaN;
    const linkedMeetingQuery =
      Number.isFinite(linkedLegacyId)
        ? supabase
            .from('meetings')
            .select(MEETING_SELECT)
            .eq('legacy_lead_id', linkedLegacyId)
            .order('meeting_date', { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] as MeetingRow[], error: null });

    const paymentQuery = ref.isLegacy
      ? supabase
          .from('finances_paymentplanrow')
          .select('value, due_date, cancel_date, actual_date')
          .eq('lead_id', ref.legacyId)
          .is('cancel_date', null)
          .order('due_date', { ascending: true })
          .limit(8)
      : supabase
          .from('payment_plans')
          .select('value, due_date, paid, paid_at, cancel_date')
          .eq('lead_id', ref.uuid)
          .is('cancel_date', null)
          .order('due_date', { ascending: true })
          .limit(8);

    const manualQuery = ref.isLegacy
      ? supabase
          .from('leads_leadinteractions')
          .select('kind, direction, cdate, content, description')
          .eq('lead_id', ref.legacyId)
          .order('cdate', { ascending: false })
          .limit(15)
      : supabase
          .from('lead_manual_interactions')
          .select('kind, direction, raw_date, content, observation')
          .eq('lead_id', ref.uuid)
          .order('raw_date', { ascending: false })
          .limit(15);

    const stageQuery = supabase.from('lead_stages').select('id, name');
    const sourceIdRaw = pick(lead, ['source_id']);
    const sourceQuery =
      sourceIdRaw != null
        ? supabase.from('misc_leadsource').select('id, name').eq('id', sourceIdRaw).maybeSingle()
        : Promise.resolve({ data: null, error: null });

    const [
      waRes,
      emailRes,
      callRes,
      meetingRes,
      linkedMeetingRes,
      paymentRes,
      manualRes,
      stageRes,
      sourceRes,
    ] = await Promise.all([
      waQuery,
      emailQuery,
      callQuery,
      meetingQuery,
      linkedMeetingQuery,
      paymentQuery,
      manualQuery,
      stageQuery,
      sourceQuery,
    ]);

    for (const row of waRes.data || []) {
      interactions.push({
        channel: 'whatsapp',
        direction: normalizeDirection(row.direction),
        at: row.sent_at || null,
        preview: clip(row.message, 500),
      });
    }
    for (const row of emailRes.data || []) {
      interactions.push({
        channel: 'email',
        direction: normalizeDirection(row.direction),
        at: row.sent_at || null,
        subject: clip(row.subject, 160),
        preview: emailBody(row),
      });
    }
    for (const row of callRes.data || []) {
      const date = String(row.cdate || '');
      const time = String(row.time || '').slice(0, 8);
      const at = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T${time || '00:00:00'}` : date || null;
      interactions.push({
        channel: 'call',
        direction: normalizeDirection(row.direction),
        at,
        preview: clip(`${row.source || ''} → ${row.destination || ''} ${row.duration || ''}`.trim()),
      });
    }
    for (const row of manualRes.data || []) {
      interactions.push({
        channel: 'manual',
        direction: normalizeDirection(row.direction),
        at: row.raw_date || row.cdate || null,
        preview: clip(row.content || row.description || row.observation || row.kind, 500),
      });
    }

    if (!ref.isLegacy && Array.isArray(lead.manual_interactions)) {
      for (const item of (lead.manual_interactions as Record<string, unknown>[]).slice(0, 10)) {
        interactions.push({
          channel: 'manual',
          direction: normalizeDirection(item.direction),
          at: String(item.raw_date || item.date || '') || null,
          preview: clip(item.content || item.observation || item.kind, 500),
        });
      }
    }

    const meetingById = new Map<number | string, MeetingRow>();
    for (const row of [...(meetingRes.data || []), ...(linkedMeetingRes.data || [])] as MeetingRow[]) {
      const key = row.id ?? `${row.meeting_date}-${row.meeting_time}`;
      if (!meetingById.has(key)) meetingById.set(key, row);
    }
    let meetingRows = [...meetingById.values()];

    if (meetingRows.length === 0 && ref.isLegacy) {
      const date = pick(lead, ['meeting_date', 'meeting_datetime']);
      if (date) {
        meetingRows = [
          {
            meeting_date: String(date).slice(0, 10),
            meeting_time: String(pick(lead, ['meeting_time']) || '') || null,
            status: 'scheduled',
            meeting_amount: pick(lead, ['meeting_total', 'meeting_amount']) as number | null,
            meeting_brief: String(pick(lead, ['meeting_brief']) || '') || null,
            meeting_location: String(pick(lead, ['meeting_location_old']) || '') || null,
          },
        ];
      }
    }

    meetingRows.sort((a, b) => String(b.meeting_date || '').localeCompare(String(a.meeting_date || '')));
    const meetings = meetingRows.slice(0, 10).map(mapMeeting);

    for (const row of meetingRows.slice(0, 10)) {
      interactions.push({
        channel: 'meeting',
        direction: null,
        at: meetingAt(row),
        preview: clip(
          [row.status, row.meeting_location, row.meeting_summary_notes, row.meeting_brief, row.expert_notes]
            .filter(Boolean)
            .join(' · '),
          700,
        ),
      });
    }

    interactions.sort(sortByAtDesc);
    const recent = interactions.slice(0, 24);

    const inbound = recent.filter((i) => i.direction === 'in').length;
    const outbound = recent.filter((i) => i.direction === 'out').length;
    const last = recent[0] || null;
    const lastAtMs = last?.at ? Date.parse(last.at) : NaN;
    const daysSinceContact = Number.isFinite(lastAtMs)
      ? Math.max(0, Math.round((Date.now() - lastAtMs) / 86400000))
      : null;

    const todayYmd = jerusalemYmd();
    const isCanceled = (status?: string | null) => String(status || '').toLowerCase().includes('cancel');
    const upcoming = meetingRows
      .filter((m) => String(m.meeting_date || '').slice(0, 10) >= todayYmd && !isCanceled(m.status))
      .sort((a, b) => String(a.meeting_date || '').localeCompare(String(b.meeting_date || '')));
    const past = meetingRows
      .filter((m) => String(m.meeting_date || '').slice(0, 10) < todayYmd)
      .sort((a, b) => String(b.meeting_date || '').localeCompare(String(a.meeting_date || '')));
    const nextMeeting = upcoming[0] || null;
    const lastMeeting = past[0] || null;

    const paymentRows = paymentRes.data || [];
    const unpaid = paymentRows.filter((p) => {
      if (ref.isLegacy) return !p.actual_date;
      return p.paid !== true;
    }).length;
    const paid = paymentRows.length - unpaid;
    const nextDue = paymentRows.find((p) => (ref.isLegacy ? !p.actual_date : p.paid !== true))?.due_date || null;

    const stageNames: Record<string, string> = {};
    for (const row of stageRes.data || []) {
      if (row?.id == null) continue;
      stageNames[String(row.id)] = String(row.name || row.id);
    }
    const stageRaw = pick(lead, ['stage']);
    const stageLabel = stageNameFor(stageRaw, stageNames);
    const sourceName =
      (sourceRes.data && String(sourceRes.data.name || '').trim()) ||
      String(pick(lead, ['source']) || '').trim() ||
      null;
    const createdAt = pick(lead, ['created_at', 'cdate']);
    const createdMs = createdAt != null ? Date.parse(String(createdAt)) : NaN;
    const daysSinceCreated = Number.isFinite(createdMs)
      ? Math.max(0, Math.round((Date.now() - createdMs) / 86400000))
      : null;
    const daysWithoutContact = daysSinceContact ?? daysSinceCreated;

    const caseBlock = {
      name: pick(lead, ['name']),
      leadNumber: pick(lead, ['lead_number', 'id']),
      isNewLead: !ref.isLegacy,
      stage: stageLabel,
      stageId: stageRaw,
      status: pick(lead, ['status']),
      topic: pick(lead, ['topic']),
      category: pick(lead, ['category']),
      source: sourceName,
      sourceId: sourceIdRaw,
      language: pick(lead, ['language']),
      country: pick(lead, ['client_country', 'country']),
      expertExamination: pick(lead, ['expert_examination']),
      proposalTotal: pick(lead, ['proposal_total', 'proposal']),
      proposalCurrency: pick(lead, ['proposal_currency', 'balance_currency', 'currency_id']),
      balance: pick(lead, ['balance', 'total_base', 'total']),
      balanceCurrency: pick(lead, ['balance_currency', 'proposal_currency', 'currency_id']),
      potentialValue: pick(lead, ['potential_value', 'potential_total']),
      probability: pick(lead, ['probability']),
      legalPotential: pick(lead, ['legal_potential']),
      seriousness: pick(lead, ['seriousness']),
      financialAbility: pick(lead, ['financial_ability']),
      createdAt: pick(lead, ['created_at', 'cdate']),
      daysSinceCreated,
      daysSinceContact,
      daysWithoutContact,
      neverContacted: daysSinceContact == null,
      followUpDate: pick(lead, ['follow_up_date', 'next_followup']),
      latestInteraction: pick(lead, ['latest_interaction']),
      dateSigned: pick(lead, ['date_signed']),
      eligible: pick(lead, ['eligible', 'eligibile']),
      applicants: pick(lead, [
        'no_of_applicants',
        'number_of_applicants',
        'number_of_applicants_meeting',
        'potential_applicants',
        'potential_applicants_meeting',
      ]),
      facts: clipNote(pick(lead, ['facts', 'description']), 2500),
      specialNotes: clipNote(pick(lead, ['special_notes']), 1200),
      generalNotes: clipNote(pick(lead, ['general_notes', 'notes']), 1200),
      schedulingNotes: clipNote(pick(lead, ['meeting_scheduling_notes']), 800),
      proposalText: clipNote(pick(lead, ['proposal_text']), 800),
    };

    const stats = {
      lastContactChannel: last?.channel || null,
      lastContactAt: last?.at || null,
      inboundCount: inbound,
      outboundCount: outbound,
      daysSinceContact,
      daysWithoutContact,
      source: sourceName,
      stage: stageRaw,
      stageName: stageLabel,
      proposal: caseBlock.proposalTotal,
      proposalCurrency: caseBlock.proposalCurrency,
      balance: caseBlock.balance,
      balanceCurrency: caseBlock.balanceCurrency,
      potentialValue: caseBlock.potentialValue,
      expertExam: caseBlock.expertExamination,
      unpaidPlanRows: unpaid,
      paidPlanRows: paid,
      nextDue,
      meetingCount: meetings.length,
      lastMeetingDate: lastMeeting?.meeting_date || null,
      lastMeetingTime: lastMeeting?.meeting_time || null,
      lastMeetingStatus: lastMeeting?.status || null,
      nextMeetingDate: nextMeeting?.meeting_date || null,
      nextMeetingTime: nextMeeting?.meeting_time || null,
      nextMeetingStatus: nextMeeting?.status || null,
      lastMessagePreview: last?.preview || null,
    };

    const fingerprint = await sha256(
      JSON.stringify({
        caseBlock,
        meetings,
        payments: { unpaid, paid, nextDue, rowCount: paymentRows.length },
        recent,
      }),
    );

    if (!force) {
      const { data: cached, error: cacheErr } = await supabase
        .from('lead_followup_ai_cache')
        .select('*')
        .eq('lead_id', cacheId)
        .maybeSingle();
      if (cacheErr) {
        console.warn('[ai-lead-followup] cache read', cacheErr.message);
      } else if (cached?.fingerprint === fingerprint && cached.verdict) {
        const generatedAt = String(cached.generated_at || '');
        const ageMs = generatedAt ? Date.now() - Date.parse(generatedAt) : Number.POSITIVE_INFINITY;
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < CACHE_MAX_AGE_MS) {
          return json({
            success: true,
            cached: true,
            generatedAt,
            leadName: cached.lead_name || caseBlock.name,
            leadNumber: cached.lead_number || caseBlock.leadNumber,
            isLegacy: ref.isLegacy,
            verdict: cached.verdict,
            score: cached.score,
            headline: cached.headline || 'Follow-up review',
            summary: cached.summary || '',
            why: Array.isArray(cached.why) ? cached.why : [],
            nextAction: cached.next_action || '',
            risks: Array.isArray(cached.risks) ? cached.risks : [],
            caseHighlights: Array.isArray((cached.stats as { highlights?: unknown })?.highlights)
              ? ((cached.stats as { highlights: unknown[] }).highlights as unknown[]).map((item) => String(item))
              : [],
            stats: {
              ...stats,
              highlights: Array.isArray((cached.stats as { highlights?: unknown })?.highlights)
                ? (cached.stats as { highlights: unknown[] }).highlights
                : [],
            },
          });
        }
      }
    }

    if (!OPENAI_API_KEY) {
      return json({ error: 'OpenAI API key not configured', code: 'NO_OPENAI_KEY' }, 503);
    }

    const formatLine = (items: Array<string | null | undefined>) =>
      items.filter((item) => item && String(item).trim()).join(' · ');

    const factsBlock = [caseBlock.facts, caseBlock.specialNotes, caseBlock.generalNotes, caseBlock.schedulingNotes]
      .filter((item) => item && String(item).trim())
      .join('\n\n') || '(none on file)';

    const meetingNarrative =
      meetings
        .map((m) => {
          const header = formatLine([String(m.date || ''), String(m.status || '')]);
          const body = [m.summaryNotes, m.brief, m.expertNotes].filter(Boolean).join('\n');
          if (!body) return header ? `${header}: (no notes)` : '';
          return `${header}\n${body}`;
        })
        .filter(Boolean)
        .slice(0, 6)
        .join('\n---\n') || '(no meeting notes)';

    const whatsappBlock =
      interactions
        .filter((i) => i.channel === 'whatsapp' && i.preview)
        .slice(0, 12)
        .map((i) => `${i.direction || '?'} ${String(i.at || '').slice(0, 16)}: ${i.preview}`)
        .join('\n') || '(none)';

    const emailBlock =
      interactions
        .filter((i) => i.channel === 'email' && (i.preview || i.subject))
        .slice(0, 8)
        .map((i) => `${i.direction || '?'} ${String(i.at || '').slice(0, 16)} ${i.subject || ''}: ${i.preview}`)
        .join('\n') || '(none)';

    const systemPrompt =
      'You are an expert CRM assistant for a citizenship and immigration law firm. ' +
      'Judge whether THIS lead is worth following up NOW, not lifetime case success. ' +
      'Use only the provided data. Never invent facts, payments, signatures, or conversations. ' +
      'Always use the stage display name (for example "Mtng sum+Agreement sent"), never the numeric stage id. ' +
      'The summary must explain THIS client\'s situation: who they are, what they want, eligibility/family/documents, and what was actually said in facts, meeting notes, WhatsApp, and email. ' +
      'Do NOT write a generic recap of last communication channel, stage, and balance — those are shown separately in the UI. Mention them only if they change the follow-up decision. ' +
      'If a source is empty, skip it; do not pad the summary with "no WhatsApp" / "stage is X" / "balance is Y". ' +
      (!ref.isLegacy
        ? 'This is a NEW lead. Add one short sentence naming the lead source (the source name, never the numeric id) and how many days have passed without contact (daysWithoutContact). Put that sentence at the end, not as the whole summary. '
        : '') +
      'Return JSON only.';

    const userPrompt = `Return a JSON object with this exact shape:
{
  "verdict": "high" | "medium" | "low" | "not_worth",
  "score": 0-100,
  "headline": "one line about THIS client's situation",
  "summary": "2-4 short paragraphs a closer can read without opening the file. Paragraph 1: who the client is and what they want. Paragraph 2: crucial case details from facts and meeting notes. Paragraph 3: what WhatsApp/email show (requests, objections, promises, documents). Optional last sentence: follow-up timing.",
  "caseHighlights": ["4-8 short bullets of crucial client/case details from facts, meetings, WhatsApp, email. Not stage, not balance, not last-channel."],
  "why": ["3-6 bullets on why follow up NOW, grounded in the data"],
  "nextAction": "one concrete next step for staff",
  "risks": ["optional risks"]
}

CASE FILE — facts and notes:
${factsBlock}

MEETING SUMMARIES (newest first):
${meetingNarrative}

WHATSAPP (newest first):
${whatsappBlock}

EMAIL (newest first):
${emailBlock}

CRM fields:
${JSON.stringify(caseBlock)}

Meetings (dates/status):
${JSON.stringify(meetings.map((m) => ({ date: m.date, time: m.time, status: m.status, location: m.location, amount: m.amount })))}

Payments:
${JSON.stringify({ unpaid, paid, nextDue, rowCount: paymentRows.length })}

Recent interactions (newest first):
${JSON.stringify(recent)}

Computed stats:
${JSON.stringify(stats)}${
      !ref.isLegacy
        ? `

REQUIRED one-sentence addendum at the end of the summary for this NEW lead (not a substitute for the case narrative):
- Name the source as "${sourceName || 'unknown'}" (never the numeric source_id).
- State that ${daysWithoutContact ?? 'an unknown number of'} day(s) have passed without contact${
            daysSinceContact == null ? ' (no recorded contact; counted from the created date)' : ''
          }.`
        : ''
    }`;

    const openaiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.35,
        max_tokens: 1400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      const message = err.error?.message || openaiRes.statusText;
      const isQuota =
        String(message).toLowerCase().includes('quota') ||
        String(message).toLowerCase().includes('billing');
      if (openaiRes.status === 429) {
        return json(
          {
            error: isQuota
              ? 'AI quota exceeded. Try again later.'
              : 'AI is busy. Try again in a moment.',
            code: isQuota ? 'QUOTA_EXCEEDED' : 'RATE_LIMIT',
          },
          429,
        );
      }
      throw new Error(message);
    }

    const openaiJson = await openaiRes.json();
    let raw = String(openaiJson.choices?.[0]?.message?.content || '').trim();
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { summary: raw, headline: 'Follow-up review', verdict: 'medium', score: 50 };
    }

    const verdictRaw = String(parsed.verdict || 'medium').toLowerCase();
    const verdict = ['high', 'medium', 'low', 'not_worth'].includes(verdictRaw)
      ? verdictRaw
      : 'medium';
    const scoreNum = Number(parsed.score);
    const score = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, Math.round(scoreNum))) : 50;
    const caseHighlights = Array.isArray(parsed.caseHighlights)
      ? parsed.caseHighlights.map((item) => clip(item, 280)).filter(Boolean)
      : [];
    const generatedAt = new Date().toISOString();
    const statsWithHighlights = { ...stats, highlights: caseHighlights };
    const payload = {
      success: true,
      cached: false,
      generatedAt,
      leadName: caseBlock.name,
      leadNumber: caseBlock.leadNumber,
      isLegacy: ref.isLegacy,
      verdict,
      score,
      headline: clip(parsed.headline, 180) || 'Follow-up review',
      summary: String(parsed.summary || '').trim(),
      caseHighlights,
      why: Array.isArray(parsed.why) ? parsed.why.map((item) => clip(item, 280)).filter(Boolean) : [],
      nextAction: String(parsed.nextAction || '').trim(),
      risks: Array.isArray(parsed.risks) ? parsed.risks.map((item) => clip(item, 280)).filter(Boolean) : [],
      stats: statsWithHighlights,
    };

    const { error: cacheWriteErr } = await supabase.from('lead_followup_ai_cache').upsert(
      {
        lead_id: cacheId,
        is_legacy: ref.isLegacy,
        fingerprint,
        verdict: payload.verdict,
        score: payload.score,
        headline: payload.headline,
        summary: payload.summary,
        why: payload.why,
        next_action: payload.nextAction,
        risks: payload.risks,
        stats: payload.stats,
        lead_name: payload.leadName != null ? String(payload.leadName) : null,
        lead_number: payload.leadNumber != null ? String(payload.leadNumber) : null,
        generated_at: generatedAt,
        generated_by: user.id,
        updated_at: generatedAt,
      },
      { onConflict: 'lead_id' },
    );
    if (cacheWriteErr) {
      console.warn('[ai-lead-followup] cache write', cacheWriteErr.message);
    }

    return json(payload);
  } catch (err) {
    console.error('[ai-lead-followup]', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
  }
});
