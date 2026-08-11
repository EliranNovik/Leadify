import { supabase } from '../supabase';
import { fetchStageActorInfo } from '../leadStageManager';

export type EmailComment = {
  id: string;
  email_id: string;
  body: string;
  created_by: string;
  created_by_employee_id: number | null;
  created_by_user_id: string | null;
  created_at: string;
};

export async function fetchEmailCommentsByEmailIds(
  emailIds: string[],
): Promise<Record<string, EmailComment[]>> {
  const ids = Array.from(new Set(emailIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from('email_comments')
    .select('id, email_id, body, created_by, created_by_employee_id, created_by_user_id, created_at')
    .in('email_id', ids)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const byEmail: Record<string, EmailComment[]> = {};
  for (const row of (data as EmailComment[]) || []) {
    const key = String(row.email_id);
    if (!byEmail[key]) byEmail[key] = [];
    byEmail[key].push(row);
  }
  return byEmail;
}

export async function createEmailComment(emailId: string, body: string): Promise<EmailComment> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Write a comment first');
  const actor = await fetchStageActorInfo();

  const { data: authData } = await supabase.auth.getUser();
  let userId: string | null = null;
  if (authData?.user?.id) {
    const { data: userRow } = await supabase
      .from('users')
      .select('id')
      .eq('auth_id', authData.user.id)
      .maybeSingle();
    userId = userRow?.id ? String(userRow.id) : null;
  }

  const { data, error } = await supabase
    .from('email_comments')
    .insert({
      email_id: String(emailId),
      body: trimmed,
      created_by: actor.fullName,
      created_by_employee_id: actor.employeeId,
      created_by_user_id: userId,
    })
    .select('id, email_id, body, created_by, created_by_employee_id, created_by_user_id, created_at')
    .single();

  if (error) throw error;
  return data as EmailComment;
}

export async function deleteEmailComment(commentId: string): Promise<void> {
  const { error } = await supabase.from('email_comments').delete().eq('id', commentId);
  if (error) throw error;
}
