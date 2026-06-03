/** Stable pseudo-random gradient avatars (diagonal, white initials). */
const AVATAR_GRADIENTS = [
  { from: '#f48fb1', to: '#880e4f' },
  { from: '#64b5f6', to: '#283593' },
  { from: '#4dd0e1', to: '#006064' },
  { from: '#ffb74d', to: '#e65100' },
  { from: '#ba68c8', to: '#4a148c' },
  { from: '#81c784', to: '#1b5e20' },
  { from: '#ff8a65', to: '#bf360c' },
  { from: '#7986cb', to: '#1a237e' },
  { from: '#f06292', to: '#ad1457' },
  { from: '#4fc3f7', to: '#01579b' },
] as const;

export type WhatsAppAvatarGradient = (typeof AVATAR_GRADIENTS)[number];

export function getWhatsAppAvatarGradient(seed: string): WhatsAppAvatarGradient {
  const s = String(seed || '?');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export function whatsAppAvatarBackgroundStyle(seed: string): { background: string; color: string } {
  const { from, to } = getWhatsAppAvatarGradient(seed);
  return {
    background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
    color: '#ffffff',
  };
}
