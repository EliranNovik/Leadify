import { supabase } from './supabase';

export type MeetingEmailNotifyType =
  | 'invitation'
  | 'invitation_jlm'
  | 'invitation_tlv'
  | 'invitation_tlv_parking'
  | 'reminder'
  | 'cancellation'
  | 'rescheduled';

export const MEETING_EMAIL_TYPE_TO_PLACEMENT_CODE: Record<MeetingEmailNotifyType, string> = {
  invitation: 'meeting_invitation',
  invitation_jlm: 'meeting_invitation_jlm',
  invitation_tlv: 'meeting_invitation_tlv',
  invitation_tlv_parking: 'meeting_invitation_tlv_parking',
  reminder: 'meeting_reminder',
  cancellation: 'meeting_cancellation',
  rescheduled: 'meeting_rescheduled',
};

/** Admin → Email Templates Automation rows with `meeting_location_id` NULL (external / IM meetings). */
export const EXTERNAL_MEETING_EMAIL_TYPE_TO_PLACEMENT_CODE: Record<MeetingEmailNotifyType, string> = {
  invitation: 'external_meeting_invitation',
  invitation_jlm: 'external_meeting_invitation_jlm',
  invitation_tlv: 'external_meeting_invitation_tlv',
  invitation_tlv_parking: 'external_meeting_invitation_tlv_parking',
  reminder: 'external_meeting_reminder',
  cancellation: 'external_meeting_cancellation',
  rescheduled: 'external_meeting_rescheduled',
};

/** Internal / staff calendar meetings (MeetingTab “External Meeting” + Calendar internal meetings). */
export function isStaffOrInternalMeeting(meeting: { calendar_type?: string } | null | undefined): boolean {
  return meeting?.calendar_type === 'staff' || meeting?.calendar_type === 'recruitment';
}

/** misc_emailtemplate ids for IM / external meeting invitations (EN / HE). */
export const IM_MEETING_INVITATION_EMAIL_TEMPLATE_IDS = {
  en: 186,
  he: 185,
} as const;

export type EmailAutomationRule = {
  meeting_location_id: number | null;
  placement_code: string;
  language_id: number;
  email_template_id: number;
};

export type EmailAutomationCache = {
  rules: EmailAutomationRule[];
  languageIds: { en: number | null; he: number | null };
};

let automationCache: EmailAutomationCache | null = null;
let automationCachePromise: Promise<EmailAutomationCache> | null = null;

export function invalidateEmailTemplatesAutomationCache(): void {
  automationCache = null;
  automationCachePromise = null;
}

async function resolveLanguageIds(): Promise<{ en: number | null; he: number | null }> {
  const { data, error } = await supabase.from('misc_language').select('id, name');
  if (error || !data?.length) return { en: null, he: null };

  let en: number | null = null;
  let he: number | null = null;
  for (const row of data) {
    const id = Number(row.id);
    if (!Number.isFinite(id)) continue;
    const name = String(row.name || '').toLowerCase();
    if (!en && (name.includes('english') || name === 'en')) en = id;
    if (!he && (name.includes('hebrew') || name.includes('heb') || name === 'he')) he = id;
  }
  return { en, he };
}

export async function fetchEmailTemplatesAutomationCache(
  forceRefresh = false
): Promise<EmailAutomationCache> {
  if (!forceRefresh && automationCache) return automationCache;
  if (!forceRefresh && automationCachePromise) return automationCachePromise;

  automationCachePromise = (async () => {
    const [languageIds, placementsRes, rulesRes] = await Promise.all([
      resolveLanguageIds(),
      supabase.from('email_templates_placement').select('id, code').not('code', 'is', null),
      supabase
        .from('email_templates_automation')
        .select('meeting_location_id, placement_id, language_id, email_template_id, is_active')
        .eq('is_active', true),
    ]);

    const placementCodeById = new Map<number, string>();
    (placementsRes.data || []).forEach((row: any) => {
      const id = Number(row.id);
      const code = row.code ? String(row.code) : '';
      if (Number.isFinite(id) && code) placementCodeById.set(id, code);
    });

    const rules: EmailAutomationRule[] = (rulesRes.data || [])
      .map((row: any) => {
        const placementId = Number(row.placement_id);
        const languageId = Number(row.language_id);
        const templateId = Number(row.email_template_id);
        const placementCode = placementCodeById.get(placementId);
        if (!placementCode || !Number.isFinite(languageId) || !Number.isFinite(templateId)) return null;

        const locationRaw = row.meeting_location_id;
        const meetingLocationId =
          locationRaw == null || locationRaw === ''
            ? null
            : Number(locationRaw);

        return {
          meeting_location_id:
            meetingLocationId != null && Number.isFinite(meetingLocationId) ? meetingLocationId : null,
          placement_code: placementCode,
          language_id: languageId,
          email_template_id: templateId,
        } satisfies EmailAutomationRule;
      })
      .filter(Boolean) as EmailAutomationRule[];

    if (rulesRes.error) {
      console.warn('fetchEmailTemplatesAutomationCache: rules query failed', rulesRes.error);
    }

    automationCache = { rules, languageIds };
    automationCachePromise = null;
    return automationCache;
  })();

  return automationCachePromise;
}

export function resolveMeetingLocationId(
  location: string | number | null | undefined,
  locations: Array<{ id: number | string; name?: string | null }>
): number | null {
  if (location == null || location === '' || location === '---' || location === 'Not specified') return null;
  const s = String(location).trim();

  const byId = locations.find((loc) => String(loc.id) === s);
  if (byId) {
    const id = Number(byId.id);
    return Number.isFinite(id) ? id : null;
  }

  const byNameExact = locations.find(
    (loc) => loc.name != null && String(loc.name).trim().toLowerCase() === s.toLowerCase()
  );
  if (byNameExact) {
    const id = Number(byNameExact.id);
    return Number.isFinite(id) ? id : null;
  }

  const byNamePartial = locations.find(
    (loc) => loc.name != null && String(loc.name).toLowerCase().includes(s.toLowerCase())
  );
  if (byNamePartial) {
    const id = Number(byNamePartial.id);
    return Number.isFinite(id) ? id : null;
  }

  return null;
}

export function inferInvitationEmailTypeFromLocationName(
  locationName: string | null | undefined
): Extract<
  MeetingEmailNotifyType,
  'invitation' | 'invitation_jlm' | 'invitation_tlv' | 'invitation_tlv_parking'
> {
  const location = (locationName || '').toLowerCase();
  if (location.includes('jrslm') || location.includes('jerusalem')) return 'invitation_jlm';
  if (location.includes('tlv') && location.includes('parking')) return 'invitation_tlv_parking';
  if (location.includes('tlv') || location.includes('tel aviv')) return 'invitation_tlv';
  return 'invitation';
}

export function resolveEmailTemplateIdFromAutomation(
  cache: EmailAutomationCache,
  params: {
    locationId: number | null;
    placementCode: string;
    languageId: number | null;
  }
): number | null {
  const { locationId, placementCode, languageId } = params;
  if (!languageId) return null;

  const matches = (rule: EmailAutomationRule) =>
    rule.placement_code === placementCode && rule.language_id === languageId;

  if (locationId != null) {
    const exact = cache.rules.find(
      (rule) => rule.meeting_location_id === locationId && matches(rule)
    );
    if (exact) return exact.email_template_id;
  }

  const fallback = cache.rules.find(
    (rule) => rule.meeting_location_id == null && matches(rule)
  );
  return fallback?.email_template_id ?? null;
}

function resolveEmailTemplateIdForMeetingType(
  cache: EmailAutomationCache,
  params: {
    locationId: number | null;
    emailType: MeetingEmailNotifyType;
    languageId: number | null;
    useExternalMeetingPlacements?: boolean;
  },
): number | null {
  const useExternal = params.useExternalMeetingPlacements === true;
  const placementMap = useExternal
    ? EXTERNAL_MEETING_EMAIL_TYPE_TO_PLACEMENT_CODE
    : MEETING_EMAIL_TYPE_TO_PLACEMENT_CODE;
  const locationId = useExternal ? null : params.locationId;

  const tryCode = (type: MeetingEmailNotifyType) =>
    resolveEmailTemplateIdFromAutomation(cache, {
      locationId,
      placementCode: placementMap[type],
      languageId: params.languageId,
    });

  const primary = tryCode(params.emailType);
  if (primary || !useExternal) return primary;

  // External / IM: if only base invitation is configured, fall back from JLM/TLV variants.
  if (params.emailType.startsWith('invitation') && params.emailType !== 'invitation') {
    return tryCode('invitation');
  }

  return null;
}

export function resolveMeetingEmailTemplateIds(
  cache: EmailAutomationCache,
  params: {
    locationId: number | null;
    emailType: MeetingEmailNotifyType;
    /** When true, use external_meeting_* placement codes and ignore location-specific rows. */
    useExternalMeetingPlacements?: boolean;
  }
): { en: number | null; he: number | null } {
  return {
    en: resolveEmailTemplateIdForMeetingType(cache, {
      locationId: params.locationId,
      emailType: params.emailType,
      languageId: cache.languageIds.en,
      useExternalMeetingPlacements: params.useExternalMeetingPlacements,
    }),
    he: resolveEmailTemplateIdForMeetingType(cache, {
      locationId: params.locationId,
      emailType: params.emailType,
      languageId: cache.languageIds.he,
      useExternalMeetingPlacements: params.useExternalMeetingPlacements,
    }),
  };
}

export function resolveMeetingEmailTemplateIdsForNotify(
  cache: EmailAutomationCache,
  meeting: { calendar_type?: string; location?: string | number | null },
  allMeetingLocations: Array<{ id: number | string; name?: string | null }>,
  emailType: MeetingEmailNotifyType,
): { en: number | null; he: number | null } {
  const useExternal = isStaffOrInternalMeeting(meeting);

  if (useExternal && emailType.startsWith('invitation')) {
    return {
      en: IM_MEETING_INVITATION_EMAIL_TEMPLATE_IDS.en,
      he: IM_MEETING_INVITATION_EMAIL_TEMPLATE_IDS.he,
    };
  }

  const locationId = useExternal
    ? null
    : resolveMeetingLocationId(meeting.location, allMeetingLocations);
  return resolveMeetingEmailTemplateIds(cache, {
    locationId,
    emailType,
    useExternalMeetingPlacements: useExternal,
  });
}

export async function fetchMiscEmailTemplatesByIds(
  templateIds: number[]
): Promise<Map<number, { content: string | null; name: string | null }>> {
  const uniqueIds = Array.from(new Set(templateIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (!uniqueIds.length) return new Map();

  const { data, error } = await supabase
    .from('misc_emailtemplate')
    .select('id, content, name')
    .in('id', uniqueIds);

  if (error) {
    console.error('fetchMiscEmailTemplatesByIds failed', error);
    return new Map();
  }

  const map = new Map<number, { content: string | null; name: string | null }>();
  (data || []).forEach((row: any) => {
    map.set(Number(row.id), {
      content: row.content ?? null,
      name: row.name ?? null,
    });
  });
  return map;
}
