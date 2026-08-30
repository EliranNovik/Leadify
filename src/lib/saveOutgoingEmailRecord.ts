import toast from 'react-hot-toast';
import { invalidateInteractionsTimeline } from './interactionsTimelineInvalidation';
import { notifyPriceOffersChanged } from './leadPriceOfferVersions';
import { recordOutgoingEmailViaBackend } from './mailboxApi';
import { supabase } from './supabase';
import { hasValidLeadId } from './meetingWhatsAppNotify';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EmailLeadForeignKeys = {
  client_id: string | null;
  legacy_id: number | null;
};

/** Maps notify client to emails.client_id / emails.legacy_id (null for staff-only / invalid ids). */
export function resolveEmailLeadForeignKeys(client: {
  id?: string | number;
  lead_type?: string;
  isStaffMeeting?: boolean;
}): EmailLeadForeignKeys {
  if (!hasValidLeadId(client)) {
    return { client_id: null, legacy_id: null };
  }

  const isLegacyLead =
    client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_');

  if (isLegacyLead) {
    const numeric = parseInt(String(client.id).replace(/[^0-9]/g, ''), 10);
    return {
      client_id: null,
      legacy_id: Number.isFinite(numeric) && numeric > 0 ? numeric : null,
    };
  }

  const idStr = String(client.id ?? '').trim();
  if (UUID_REGEX.test(idStr)) {
    return { client_id: idStr, legacy_id: null };
  }

  if (/^\d+$/.test(idStr)) {
    const numeric = parseInt(idStr, 10);
    return { client_id: null, legacy_id: numeric > 0 ? numeric : null };
  }

  return { client_id: null, legacy_id: null };
}

export type SaveOutgoingEmailRecordInput = {
  client: { id?: string | number; lead_type?: string; isStaffMeeting?: boolean };
  subject: string;
  htmlBody: string;
  senderName: string;
  senderEmail: string;
  recipientList: string | string[];
  contactId?: number | null;
  sentAt?: Date;
  /** Defaults to optimistic timestamp id */
  messageId?: string;
  bodyPreview?: string | null;
  attachments?: unknown;
  skipErrorToast?: boolean;
  /** Use SECURITY DEFINER RPC first (avoids emails RLS 42501). */
  preferRpc?: boolean;
};

function isRpcMissing(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = (error?.message || '').toLowerCase();
  return (
    error?.code === 'PGRST202' ||
    message.includes('could not find the function') ||
    message.includes('does not exist')
  );
}

async function insertCrmEmailRpc(
  record: Record<string, unknown>,
): Promise<{ id: number | null; error: { message?: string; code?: string } | null }> {
  const p_row: Record<string, unknown> = {
    message_id: record.message_id ?? '',
    sender_name: record.sender_name ?? null,
    sender_email: record.sender_email ?? null,
    recipient_list: record.recipient_list ?? null,
    subject: record.subject ?? '(no subject)',
    body_html: record.body_html ?? '',
    body_preview: record.body_preview ?? null,
    sent_at: record.sent_at ?? new Date().toISOString(),
    direction: record.direction ?? 'outgoing',
    client_id: record.client_id ?? null,
    legacy_id: record.legacy_id != null ? String(record.legacy_id) : null,
    contact_id: record.contact_id != null ? String(record.contact_id) : null,
    thread_id: record.thread_id ?? null,
    body_cached: true,
  };
  if (record.attachments != null) {
    p_row.attachments = record.attachments;
  }

  const tryFn = async (fn: string, row: Record<string, unknown>) => {
    const result = await supabase.rpc(fn, { p_row: row });
    if (result.error) {
      console.warn(`saveOutgoingEmailRecord: ${fn} failed`, {
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
        hint: result.error.hint,
      });
    }
    return result;
  };

  let lastError: { message?: string; code?: string } | null = null;
  for (const fn of ['insert_mailbox_email', 'insert_crm_email']) {
    let { data, error } = await tryFn(fn, p_row);
    if (error && !isRpcMissing(error)) {
      const retry = await tryFn(fn, { ...p_row, user_id: null });
      data = retry.data;
      error = retry.error;
    }
    if (!error) {
      const id = typeof data === 'number' ? data : data != null ? Number(data) : null;
      if (Number.isFinite(id as number)) return { id: id as number, error: null };
      return { id: null, error: { message: `${fn} returned no id` } };
    }
    lastError = error;
  }
  return { id: null, error: lastError };
}

/**
 * Persists an outgoing email to public.emails after Graph send succeeds.
 * Returns true when saved (or duplicate handled); false on failure (toast shown).
 */
export async function saveOutgoingEmailRecord(input: SaveOutgoingEmailRecordInput): Promise<boolean> {
  const now = input.sentAt ?? new Date();
  const senderEmail = (input.senderEmail || '').trim();
  if (!senderEmail) {
    console.warn('saveOutgoingEmailRecord: missing sender_email — inserting anyway');
  }

  const { client_id, legacy_id } = resolveEmailLeadForeignKeys(input.client);
  const recipientList = Array.isArray(input.recipientList)
    ? input.recipientList.join(', ')
    : input.recipientList;
  const bodyPreview =
    (input.bodyPreview && String(input.bodyPreview).trim()) ||
    String(input.htmlBody || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  let authUserId: string | null = null;
  try {
    const { data: authData } = await supabase.auth.getUser();
    authUserId = authData?.user?.id ?? null;
  } catch {
    authUserId = null;
  }

  const emailRecord: Record<string, unknown> = {
    message_id: input.messageId ?? `optimistic_${now.getTime()}`,
    thread_id: null,
    sender_name: input.senderName,
    sender_email: senderEmail || null,
    recipient_list: recipientList,
    subject: input.subject,
    body_html: input.htmlBody,
    body_preview: bodyPreview,
    sent_at: now.toISOString(),
    direction: 'outgoing',
    attachments: input.attachments ?? null,
    client_id,
    legacy_id,
  };
  if (authUserId) {
    emailRecord.user_id = authUserId;
  }

  const contactId = input.contactId;
  if (typeof contactId === 'number' && contactId > 0) {
    emailRecord.contact_id = contactId;
  }

  const logContext = {
    message_id: emailRecord.message_id,
    client_id,
    legacy_id,
    contact_id: emailRecord.contact_id ?? null,
    sender_email: senderEmail,
  };

  const notifyTimeline = () => {
    if (client_id) invalidateInteractionsTimeline(client_id);
    else if (legacy_id != null) invalidateInteractionsTimeline(`legacy_${legacy_id}`);
    else if (input.client.id != null) invalidateInteractionsTimeline(input.client.id);
    if (String(emailRecord.message_id || '').startsWith('offer_')) {
      notifyPriceOffersChanged(input.client.id);
    }
  };

  const tryInsert = async (record: Record<string, unknown>) => {
    return supabase.from('emails').insert([record]).select();
  };

  const linkContact = async (emailId: unknown, contactIdValue: unknown) => {
    const idNum = typeof contactIdValue === 'number' ? contactIdValue : Number(contactIdValue);
    if (!emailId || !Number.isFinite(idNum) || idNum <= 0) return;
    const { error } = await supabase.from('email_contacts').upsert(
      { email_id: String(emailId), contact_id: idNum },
      { onConflict: 'email_id,contact_id', ignoreDuplicates: true },
    );
    if (error) {
      console.warn('saveOutgoingEmailRecord: email_contacts link failed', error.message);
    }
  };

  try {
    try {
      const backend = await recordOutgoingEmailViaBackend(emailRecord);
      if (backend?.id != null && Number.isFinite(backend.id)) {
        console.log('saveOutgoingEmailRecord: saved via backend', {
          id: backend.id,
          message_id: emailRecord.message_id,
          client_id,
        });
        await linkContact(backend.id, emailRecord.contact_id);
        notifyTimeline();
        return true;
      }
      console.warn('saveOutgoingEmailRecord: backend record returned no id', backend);
    } catch (backendError) {
      console.warn('saveOutgoingEmailRecord: backend record failed', backendError);
    }

    if (input.preferRpc !== false) {
      const rpc = await insertCrmEmailRpc(emailRecord);
      if (!rpc.error && rpc.id != null) {
        await linkContact(rpc.id, emailRecord.contact_id);
        notifyTimeline();
        return true;
      }
      console.warn('saveOutgoingEmailRecord: RPC insert failed, trying table insert', rpc.error);
    }

    let { data: insertedData, error: insertError } = await tryInsert(emailRecord);

    if (
      insertError &&
      emailRecord.contact_id != null &&
      (insertError.code === '23503' || insertError.message?.toLowerCase().includes('contact'))
    ) {
      const withoutContact = { ...emailRecord };
      delete withoutContact.contact_id;
      const retry = await tryInsert(withoutContact);
      insertedData = retry.data;
      insertError = retry.error;
    }

    if (!insertError) {
      if (!insertedData?.length) {
        console.warn('saveOutgoingEmailRecord: insert ok but no rows returned', logContext);
      } else {
        await linkContact(insertedData[0]?.id, emailRecord.contact_id);
      }
      notifyTimeline();
      return true;
    }

    console.error('saveOutgoingEmailRecord: insert failed', {
      ...logContext,
      code: insertError.code,
      message: insertError.message,
      details: insertError.details,
      hint: insertError.hint,
    });

    if (
      insertError.code === '23505' ||
      insertError.message?.includes('unique') ||
      insertError.message?.includes('duplicate')
    ) {
      const { data: upserted, error: upsertError } = await supabase
        .from('emails')
        .upsert([emailRecord], { onConflict: 'message_id', ignoreDuplicates: false })
        .select();
      if (!upsertError) {
        await linkContact(upserted?.[0]?.id, emailRecord.contact_id);
        notifyTimeline();
        return true;
      }
      console.error('saveOutgoingEmailRecord: upsert failed', upsertError);
    }

    if (insertError.code === '42501') {
      const rpc = await insertCrmEmailRpc(emailRecord);
      if (!rpc.error && rpc.id != null) {
        await linkContact(rpc.id, emailRecord.contact_id);
        notifyTimeline();
        return true;
      }
      console.warn('saveOutgoingEmailRecord: RLS fallback RPC failed', rpc.error);

      const withoutContext = { ...emailRecord };
      delete withoutContext.client_id;
      delete withoutContext.legacy_id;
      delete withoutContext.contact_id;

      const { data: insertedWithoutContext, error: insertWithoutContextError } = await supabase
        .from('emails')
        .insert([withoutContext])
        .select();

      if (!insertWithoutContextError && insertedWithoutContext?.length) {
        const { error: updateError } = await supabase
          .from('emails')
          .update({
            client_id: emailRecord.client_id,
            legacy_id: emailRecord.legacy_id,
            contact_id: emailRecord.contact_id,
          })
          .eq('message_id', emailRecord.message_id);
        if (!updateError) {
          notifyTimeline();
          return true;
        }
        console.error('saveOutgoingEmailRecord: context update failed', updateError);
      } else {
        console.error('saveOutgoingEmailRecord: workaround insert failed', insertWithoutContextError);
      }
    }

    if (!input.skipErrorToast) {
      toast.error('Email sent but failed to save record. It will appear after sync.');
    }
    return false;
  } catch (error) {
    console.error('saveOutgoingEmailRecord: exception', error, logContext);
    if (!input.skipErrorToast) {
      toast.error('Email sent but failed to save record. It will appear after sync.');
    }
    return false;
  }
}
