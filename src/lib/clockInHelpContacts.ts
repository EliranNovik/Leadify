/** Help contacts shown on clock-in gate + entry kiosk carousel. Keep in sync with backend. */
export const CLOCK_IN_HELP_CONTACT_EMPLOYEE_IDS = [1, 3] as const;

export const CLOCK_IN_HELP_CONTACT_PHONE_OVERRIDES: Record<number, string> = {
  3: '0547652074',
};

export type ClockInHelpContact = {
  id: number;
  display_name: string;
  photo_url: string | null;
  photo: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
};

export function resolveHelpContactPhone(emp: ClockInHelpContact): string | null {
  const override = CLOCK_IN_HELP_CONTACT_PHONE_OVERRIDES[emp.id];
  if (override) return override;
  const mobile = emp.mobile?.trim();
  const phone = emp.phone?.trim();
  return mobile || phone || null;
}

export function resolveHelpContactMobile(emp: ClockInHelpContact): string | null {
  const override = CLOCK_IN_HELP_CONTACT_PHONE_OVERRIDES[emp.id];
  if (override) return override;
  const mobile = emp.mobile?.trim();
  return mobile || null;
}

export function buildHelpContactWhatsAppUrl(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}
