import { supabase } from './supabase';
import {
  fetchRecruitmentStages,
  getRecruitmentStageBySlug,
  type RecruitmentStage,
} from './recruitmentStages';
import {
  fetchRecruitmentUsers,
  recruitmentUserDisplayName,
  type RecruitmentUser,
} from './recruitmentDigitalContracts';

export type RecruitmentCandidate = {
  id: number;
  user_id: string;
  stage_id: number;
  stage_changed_at: string;
  stage_changed_by: string | null;
  position_applied: string | null;
  department_id: number | null;
  recruiter_employee_id: number | null;
  referred_by_employee_id: number | null;
  source: string | null;
  expected_salary: string | null;
  availability: string | null;
  notice_period: string | null;
  rating: number | null;
  overall_score: number | null;
  notes: string | null;
  phone: string | null;
  linkedin_url: string | null;
  address: string | null;
  nationality: string | null;
  languages: unknown;
  created_at: string;
  updated_at: string;
  stage?: RecruitmentStage | null;
  recruiter_name?: string | null;
  referred_by_name?: string | null;
  referred_by_photo_url?: string | null;
  department_name?: string | null;
};

export type RecruitmentListRow = {
  user: RecruitmentUser;
  candidate: RecruitmentCandidate;
};

const CANDIDATE_SELECT = `
  id,
  user_id,
  stage_id,
  stage_changed_at,
  stage_changed_by,
  position_applied,
  department_id,
  recruiter_employee_id,
  referred_by_employee_id,
  source,
  expected_salary,
  availability,
  notice_period,
  rating,
  overall_score,
  notes,
  phone,
  linkedin_url,
  address,
  nationality,
  languages,
  created_at,
  updated_at,
  recruitment_stages(id, slug, name, colour, sort_order, is_terminal),
  recruiter:tenants_employee!recruiter_employee_id(id, display_name, official_name),
  referred_by:tenants_employee!referred_by_employee_id(id, display_name, official_name, photo_url, photo),
  tenant_departement:department_id(id, name)
`;

function mapCandidateRow(row: any): RecruitmentCandidate {
  const stageRaw = row.recruitment_stages;
  const stage = Array.isArray(stageRaw) ? stageRaw[0] ?? null : stageRaw ?? null;
  const recruiterRaw = row.recruiter;
  const recruiter = Array.isArray(recruiterRaw) ? recruiterRaw[0] ?? null : recruiterRaw ?? null;
  const referredRaw = row.referred_by;
  const referredBy = Array.isArray(referredRaw) ? referredRaw[0] ?? null : referredRaw ?? null;
  const deptRaw = row.tenant_departement;
  const dept = Array.isArray(deptRaw) ? deptRaw[0] ?? null : deptRaw ?? null;

  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    stage_id: Number(row.stage_id),
    stage_changed_at: row.stage_changed_at,
    stage_changed_by: row.stage_changed_by ?? null,
    position_applied: row.position_applied ?? null,
    department_id: row.department_id != null ? Number(row.department_id) : null,
    recruiter_employee_id:
      row.recruiter_employee_id != null ? Number(row.recruiter_employee_id) : null,
    referred_by_employee_id:
      row.referred_by_employee_id != null ? Number(row.referred_by_employee_id) : null,
    source: row.source ?? null,
    expected_salary: row.expected_salary ?? null,
    availability: row.availability ?? null,
    notice_period: row.notice_period ?? null,
    rating: row.rating != null ? Number(row.rating) : null,
    overall_score: row.overall_score != null ? Number(row.overall_score) : null,
    notes: row.notes ?? null,
    phone: row.phone ?? null,
    linkedin_url: row.linkedin_url ?? null,
    address: row.address ?? null,
    nationality: row.nationality ?? null,
    languages: row.languages ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    stage: stage as RecruitmentStage | null,
    recruiter_name:
      recruiter?.display_name || recruiter?.official_name || null,
    referred_by_name:
      referredBy?.display_name || referredBy?.official_name || null,
    referred_by_photo_url:
      (typeof referredBy?.photo_url === 'string' && referredBy.photo_url.trim()) ||
      (typeof referredBy?.photo === 'string' && referredBy.photo.trim()) ||
      null,
    department_name: dept?.name ?? null,
  };
}

export async function ensureRecruitmentCandidateForUser(
  userId: string,
): Promise<RecruitmentCandidate> {
  const { data: existing, error: existingError } = await supabase
    .from('recruitment_candidates')
    .select(CANDIDATE_SELECT)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return mapCandidateRow(existing);

  const stages = await fetchRecruitmentStages();
  const newStage = getRecruitmentStageBySlug(stages, 'new_applicant');
  if (!newStage) {
    throw new Error('Recruitment stage "new_applicant" is not configured. Run the ATS migration.');
  }

  const { data: inserted, error: insertError } = await supabase
    .from('recruitment_candidates')
    .insert({
      user_id: userId,
      stage_id: newStage.id,
      stage_changed_at: new Date().toISOString(),
    })
    .select(CANDIDATE_SELECT)
    .single();

  if (insertError) throw insertError;
  return mapCandidateRow(inserted);
}

export async function fetchRecruitmentCandidateByUserId(
  userId: string,
): Promise<RecruitmentCandidate | null> {
  const { data, error } = await supabase
    .from('recruitment_candidates')
    .select(CANDIDATE_SELECT)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCandidateRow(data) : null;
}

export async function fetchRecruitmentListRows(): Promise<RecruitmentListRow[]> {
  const users = await fetchRecruitmentUsers();
  if (!users.length) return [];

  const userIds = users.map((u) => u.id);
  const { data: candidates, error } = await supabase
    .from('recruitment_candidates')
    .select(CANDIDATE_SELECT)
    .in('user_id', userIds);

  if (error) throw error;

  const byUser = new Map<string, RecruitmentCandidate>();
  for (const row of candidates || []) {
    const mapped = mapCandidateRow(row);
    byUser.set(mapped.user_id, mapped);
  }

  const missing = users.filter((u) => !byUser.has(u.id));
  for (const u of missing) {
    try {
      const created = await ensureRecruitmentCandidateForUser(u.id);
      byUser.set(u.id, created);
    } catch (err) {
      console.error('Failed to upsert recruitment candidate for', u.id, err);
    }
  }

  return users
    .map((user) => {
      const candidate = byUser.get(user.id);
      if (!candidate) return null;
      return { user, candidate };
    })
    .filter(Boolean) as RecruitmentListRow[];
}

export async function updateRecruitmentCandidateProfile(
  candidateId: number,
  patch: Partial<{
    position_applied: string | null;
    department_id: number | null;
    recruiter_employee_id: number | null;
    referred_by_employee_id: number | null;
    source: string | null;
    expected_salary: string | null;
    availability: string | null;
    notice_period: string | null;
    rating: number | null;
    overall_score: number | null;
    notes: string | null;
    phone: string | null;
    linkedin_url: string | null;
    address: string | null;
    nationality: string | null;
    languages: unknown;
  }>,
): Promise<RecruitmentCandidate> {
  const { data, error } = await supabase
    .from('recruitment_candidates')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
    .select(CANDIDATE_SELECT)
    .single();

  if (error) throw error;
  return mapCandidateRow(data);
}

export function candidateDisplayName(
  user: Pick<RecruitmentUser, 'full_name' | 'first_name' | 'last_name' | 'email'>,
): string {
  return recruitmentUserDisplayName(user);
}

export function buildRecruitmentCandidatePath(userId: string): string {
  return `/hr/recruitment/${userId}`;
}

export function buildRecruitmentSchedulePath(userId: string): string {
  return `/hr/recruitment/${userId}/schedule-meeting`;
}

export function buildRecruitmentReschedulePath(userId: string, meetingId: string | number): string {
  return `/hr/recruitment/${userId}/reschedule-meeting/${meetingId}`;
}
