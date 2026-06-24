/** Pelecard ClientSecureV2 — required on the merchant page for Apple Pay / Google Pay (parent frame). */
export const PELECARD_CLIENT_SECURE_V2_URL =
  'https://gateway21.pelecard.biz/Scripts/Payment/ClientSecureV2.js';

const SCRIPT_ID = 'pelecard-client-secure-v2';
const LOADED_ATTR = 'data-pelecard-loaded';

function waitForScriptElement(script: HTMLScriptElement): Promise<void> {
  if (script.getAttribute(LOADED_ATTR) === 'true') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      script.setAttribute(LOADED_ATTR, 'true');
      resolve();
    };
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', done, { once: true });
  });
}

/** Load Pelecard ClientSecureV2 once per page; resolves when the script has finished loading. */
export function ensurePelecardClientSecureScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) return waitForScriptElement(existing);

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.src = PELECARD_CLIENT_SECURE_V2_URL;
  script.type = 'text/javascript';
  script.async = true;
  document.body.appendChild(script);
  return waitForScriptElement(script);
}
