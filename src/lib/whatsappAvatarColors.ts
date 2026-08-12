/** Stable pseudo-random avatar backgrounds — washed-out pastels with muted text. */
const AVATAR_GRADIENTS = [
  { from: '#f8c8d8', to: '#f0a8be', text: '#7a3d52' },
  { from: '#c5daf8', to: '#a8c4ec', text: '#3d567a' },
  { from: '#b8e8ee', to: '#96d5de', text: '#3a6369' },
  { from: '#f5d9b8', to: '#ebc49a', text: '#7a5530' },
  { from: '#e0c8ec', to: '#cba8de', text: '#5c3d6e' },
  { from: '#c5e6c8', to: '#a8d4ad', text: '#3d6342' },
  { from: '#f5c8b8', to: '#ebaa96', text: '#7a4535' },
  { from: '#c8cfee', to: '#a8b2de', text: '#3d456e' },
  { from: '#f0c0d0', to: '#e0a0b8', text: '#6e3a50' },
  { from: '#b8dff0', to: '#96cce0', text: '#355a6e' },
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
  const { from, to, text } = getWhatsAppAvatarGradient(seed);
  return {
    background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
    color: text,
  };
}
