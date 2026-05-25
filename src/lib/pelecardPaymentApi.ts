export type PaymentLinkStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | string;

export interface PaymentStatusResponse {
  success: boolean;
  paymentId?: string;
  status?: PaymentLinkStatus;
  amount?: number;
  vat_amount?: number;
  total_amount?: number;
  currency?: string;
  description?: string;
  paid_at?: string | null;
  expires_at?: string | null;
  pelecard_transaction_id?: string | null;
  pelecard_status_code?: string | null;
  pelecard_status_description?: string | null;
  error?: string;
}

export interface CreatePelecardSessionResponse {
  success: boolean;
  paymentUrl?: string;
  paymentId?: string;
  error?: string;
}

function getApiBase(): string {
  const backend = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, '');
  if (backend) {
    return `${backend}/api/payments/pelecard`;
  }
  return '/api/payments/pelecard';
}

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // ngrok free tier returns an HTML interstitial unless this header is set
  if (typeof window !== 'undefined' && window.location.hostname.includes('ngrok')) {
    headers['ngrok-skip-browser-warning'] = 'true';
  }
  return headers;
}

async function parseJsonResponse<T extends { success?: boolean; error?: string }>(
  response: Response
): Promise<T> {
  const text = await response.text();
  if (!text) {
    if (!response.ok) {
      throw new Error(response.statusText || `Request failed (${response.status})`);
    }
    return { success: false, error: 'Empty response from server' } as T;
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 120);
    const hint = preview.includes('<!DOCTYPE') || preview.includes('<html')
      ? ' (received HTML — if using ngrok, ensure the backend is running and Vite proxy targets port 3001)'
      : '';
    throw new Error(`Invalid server response${hint}`);
  }

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && data.error) ||
      response.statusText ||
      `Request failed (${response.status})`;
    throw new Error(typeof message === 'string' ? message : 'Request failed');
  }

  return data;
}

export async function createPelecardPaymentSession(
  paymentId: string
): Promise<CreatePelecardSessionResponse> {
  try {
    const response = await fetch(`${getApiBase()}/create-payment-session`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ paymentId }),
    });
    return await parseJsonResponse<CreatePelecardSessionResponse>(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create payment session';
    return { success: false, error: message };
  }
}

export async function fetchPaymentStatus(
  paymentId: string
): Promise<PaymentStatusResponse> {
  try {
    const response = await fetch(
      `${getApiBase()}/status/${encodeURIComponent(paymentId)}`,
      { headers: buildHeaders() }
    );
    return await parseJsonResponse<PaymentStatusResponse>(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load payment status';
    return { success: false, error: message };
  }
}
