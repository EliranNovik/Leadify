/** Pelecard ClientSecureV2 — required on the merchant page for Apple Pay / Google Pay (parent frame). */
export const PELECARD_CLIENT_SECURE_V2_URL =
  'https://gateway21.pelecard.biz/Scripts/Payment/ClientSecureV2.js';

const SCRIPT_ID = 'pelecard-client-secure-v2';

/** Load Pelecard ClientSecureV2 once per page (idempotent). */
export function ensurePelecardClientSecureScript(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SCRIPT_ID)) return;

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.src = PELECARD_CLIENT_SECURE_V2_URL;
  script.type = 'text/javascript';
  script.async = true;
  document.body.appendChild(script);
}
