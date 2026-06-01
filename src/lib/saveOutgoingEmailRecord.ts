import toast from 'react-hot-toast';
import { invalidateInteractionsTimeline } from './interactionsTimelineInvalidation';
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
};

/**
 * Persists an outgoing email to public.emails after Graph send succeeds.
 * Returns true when saved (or duplicate handled); false on failure (toast shown).
 */
export async function saveOutgoingEmailRecord(input: SaveOutgoingEmailRecordInput): Promise<boolean> {
  const now = input.sentAt ?? new Date();
  const senderEmail = (input.senderEmail || '').trim();
  if (!senderEmail) {
    console.error('saveOutgoingEmailRecord: missing sender_email');
    return false;
  }

  const { client_id, legacy_id } = resolveEmailLeadForeignKeys(input.client);
  const recipientList = Array.isArray(input.recipientList)
    ? input.recipientList.join(', ')
    : input.recipientList;

  const emailRecord: Record<string, unknown> = {
    message_id: input.messageId ?? `optimistic_${now.getTime()}`,
    thread_id: null,
    sender_name: input.senderName,
    sender_email: senderEmail,
    recipient_list: recipientList,
    subject: input.subject,
    body_html: input.htmlBody,
    body_preview: input.htmlBody.substring(0, 500),
    sent_at: now.toISOString(),
    direction: 'outgoing',
    attachments: null,
    client_id,
    legacy_id,
  };

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
  };

  const tryInsert = async (record: Record<string, unknown>) => {
    return supabase.from('emails').insert([record]).select();
  };

  try {
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
      const { error: upsertError } = await supabase
        .from('emails')
        .upsert([emailRecord], { onConflict: 'message_id', ignoreDuplicates: false })
        .select();
      if (!upsertError) {
        notifyTimeline();
        return true;
      }
      console.error('saveOutgoingEmailRecord: upsert failed', upsertError);
    } else if (
      insertError.code === '42501' &&
      insertError.message?.includes('pending_stage_evaluations')
    ) {
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

    toast.error('Email sent but failed to save record. It will appear after sync.');
    return false;
  } catch (error) {
    console.error('saveOutgoingEmailRecord: exception', error, logContext);
    toast.error('Email sent but failed to save record. It will appear after sync.');
    return false;
  }
}
