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
  confirmation_email_sent?: boolean;
  payper_invoice_link?: string | null;
  payper_invoice_number?: string | null;
  payper_invoice_status?: string | null;
  error?: string;
}

export interface BillingContactResponse {
  success: boolean;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  planContactId?: number | null;
  error?: string;
}

export interface CreatePelecardSessionResponse {
  success: boolean;
  paymentUrl?: string;
  paymentId?: string;
  /** Set when backend reconciled a prior charge and link is already paid. */
  alreadyPaid?: boolean;
  status?: PaymentLinkStatus;
  /** CssURL sent to Pelecard at init — verify this URL returns your CSS file. */
  cssUrl?: string;
  /** False when Pelecard ignores CssURL and loads default variant CSS (terminal must be enabled by Pelecard). */
  cssApplied?: boolean;
  error?: string;
}

/**
 * In local dev, prefer the Vite `/api` proxy (same-origin) even when VITE_BACKEND_URL
 * points at localhost:3001 — direct cross-origin calls fail CORS in the browser.
 */
function shouldUseViteApiProxy(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host.includes('ngrok')) return false;

  const backend = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, '');
  if (!backend) return true;

  try {
    const { hostname } = new URL(backend);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function getPelecardPaymentsApiBase(): string {
  return getApiBase();
}

function getApiBase(): string {
  if (shouldUseViteApiProxy()) {
    return '/api/payments/pelecard';
  }
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

export async function fetchBillingContact(
  paymentId: string,
): Promise<BillingContactResponse> {
  try {
    const response = await fetch(
      `${getApiBase()}/billing-contact/${encodeURIComponent(paymentId)}`,
      { headers: buildHeaders(), cache: 'no-store' },
    );
    return await parseJsonResponse<BillingContactResponse>(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load billing contact';
    return { success: false, error: message };
  }
}

export async function fetchPaymentStatus(
  paymentId: string
): Promise<PaymentStatusResponse> {
  try {
    const response = await fetch(
      `${getApiBase()}/status/${encodeURIComponent(paymentId)}`,
      { headers: buildHeaders(), cache: 'no-store' },
    );
    return await parseJsonResponse<PaymentStatusResponse>(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load payment status';
    return { success: false, error: message };
  }
}
