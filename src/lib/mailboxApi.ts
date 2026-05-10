const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');

const buildUrl = (path: string) => {
  if (!path) return BACKEND_URL;
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
};

const parseJsonResponse = async (response: Response) => {
  let payload: any = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload && (payload as any).error) ||
      response.statusText ||
      'Request failed';
    const error = new Error(typeof message === 'string' ? message : 'Request failed');
    // Attach status code for error handling
    (error as any).statusCode = response.status;
    throw error;
  }

  if (payload && typeof payload === 'object' && 'success' in payload) {
    if ((payload as any).success === false) {
      const error = new Error((payload as any).error || 'Request failed');
      // Attach status code for error handling
      (error as any).statusCode = response.status;
      throw error;
    }
    return payload;
  }

  return payload;
};

export const getMailboxStatus = async (userId: string) => {
  if (!userId) throw new Error('userId is required');
  const url = new URL(buildUrl('/api/auth/status'));
  url.searchParams.set('userId', userId);
  const response = await fetch(url.toString());
  const payload = await parseJsonResponse(response);
  return payload?.data || { connected: false };
};

export const getMailboxLoginUrl = async (userId: string, redirectTo?: string) => {
  if (!userId) throw new Error('userId is required');
  const url = new URL(buildUrl('/api/auth/login'));
  url.searchParams.set('userId', userId);
  if (redirectTo) {
    url.searchParams.set('redirectTo', redirectTo);
  }
  const response = await fetch(url.toString());
  const payload = await parseJsonResponse(response);
  if (!payload?.url) {
    throw new Error('Backend did not return a login URL');
  }
  return payload.url as string;
};

/** Register/renew Microsoft Graph Inbox webhook (needs GRAPH_WEBHOOK_NOTIFICATION_URL on server). */
export const ensureMailboxGraphSubscription = async (userId: string) => {
  if (!userId) throw new Error('userId is required');
  const response = await fetch(buildUrl('/api/graph/subscriptions/ensure'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const payload = await parseJsonResponse(response);
  return payload?.data ?? null;
};

/** Webhook + delta sync (used after login / “Sync now”). */
export const runMailboxCatchUpSync = async (userId: string, options?: { reset?: boolean }) => {
  if (!userId) throw new Error('userId is required');
  await ensureMailboxGraphSubscription(userId).catch(() => {});
  return triggerMailboxSync(userId, { reset: options?.reset ?? false });
};

export const triggerMailboxSync = async (userId: string, options?: { reset?: boolean }) => {
  if (!userId) throw new Error('userId is required');
  const response = await fetch(buildUrl('/api/sync/now'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId,
      reset: options?.reset ?? false,
    }),
  });
  const payload = await parseJsonResponse(response);
  return payload?.data || null;
};

interface BackendAttachmentPayload {
  name: string;
  contentType?: string;
  contentBytes: string;
}

export interface BackendSendEmailPayload {
  userId: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  bodyContentType?: 'HTML' | 'Text';
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  attachments?: BackendAttachmentPayload[];
  importance?: 'low' | 'normal' | 'high';
  context?: {
    clientId?: string | number | null;
    legacyLeadId?: number | null;
    leadType?: string | null;
    leadNumber?: string | null;
    contactEmail?: string | null;
    contactName?: string | null;
    contactId?: number | null;
    senderName?: string | null;
    userInternalId?: string | number | null;
  };
}

export const sendEmailViaBackend = async (payload: BackendSendEmailPayload) => {
  if (!payload?.userId) throw new Error('userId is required');
  const response = await fetch(buildUrl('/api/emails/send'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse(response);
  return data?.data || null;
};

export type EmailBodyFromBackend = {
  body: string;
  /** File attachment metadata from Graph (id, name, size, …); empty if none */
  attachments: any[];
};

export const fetchEmailBodyFromBackend = async (userId: string, emailId: string): Promise<EmailBodyFromBackend> => {
  if (!userId || !emailId) throw new Error('userId and emailId are required');
  const url = new URL(buildUrl(`/api/emails/${encodeURIComponent(emailId)}/body`));
  url.searchParams.set('userId', userId);
  const response = await fetch(url.toString());
  const data = await parseJsonResponse(response);
  const body = typeof data?.body === 'string' ? data.body : '';
  const attachments = Array.isArray(data?.attachments) ? data.attachments : [];
  return { body, attachments };
};

export const buildAttachmentDownloadUrl = (userId: string, emailId: string, attachmentId: string) => {
  if (!userId || !emailId || !attachmentId) return '';
  const url = new URL(buildUrl(`/api/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`));
  url.searchParams.set('userId', userId);
  return url.toString();
};

export const downloadAttachmentFromBackend = async (userId: string, emailId: string, attachmentId: string) => {
  const url = buildAttachmentDownloadUrl(userId, emailId, attachmentId);
  if (!url) throw new Error('Invalid download parameters');
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to download attachment');
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const fileName = match ? match[1] : 'attachment';
  const contentType = response.headers.get('Content-Type') || blob.type || 'application/octet-stream';

  return {
    blob,
    fileName,
    contentType,
  };
};

