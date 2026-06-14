import type { ContactInfo } from './contactHelpers';

export const INTERACTIONS_COMM_PRESET_KEY = 'interactionsCommunicationPreset';

export type SelectedLeadContact = {
  contact: ContactInfo;
  leadId: string | number;
  leadType: 'legacy' | 'new';
};

export type InteractionsCommunicationPreset = {
  mode: 'email';
  primary: SelectedLeadContact;
  additionalContacts?: SelectedLeadContact[];
};

export function setInteractionsCommunicationPreset(preset: InteractionsCommunicationPreset): void {
  sessionStorage.setItem(INTERACTIONS_COMM_PRESET_KEY, JSON.stringify(preset));
}

export function peekInteractionsCommunicationPreset(): InteractionsCommunicationPreset | null {
  const raw = sessionStorage.getItem(INTERACTIONS_COMM_PRESET_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InteractionsCommunicationPreset;
  } catch {
    return null;
  }
}

export function consumeInteractionsCommunicationPreset(): InteractionsCommunicationPreset | null {
  const preset = peekInteractionsCommunicationPreset();
  if (preset) {
    sessionStorage.removeItem(INTERACTIONS_COMM_PRESET_KEY);
  }
  return preset;
}

export function normalizeLeadIdForCompare(leadId: string | number, leadType: 'legacy' | 'new'): string {
  const raw = String(leadId);
  if (leadType === 'legacy') {
    return raw.replace(/^legacy_/, '');
  }
  return raw;
}
