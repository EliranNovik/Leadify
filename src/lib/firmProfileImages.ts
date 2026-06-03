import { supabase } from './supabase';

export const FIRM_PROFILE_IMAGES_BUCKET = 'firm-profile-images';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

function safeImageExt(file: File): string {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  return ALLOWED_EXT.has(ext) ? ext : 'jpg';
}

function validateImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select an image file');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Image is too large (max 5MB)');
  }
}

export function extractFirmProfileImageObjectPath(publicUrl: string): string | null {
  const marker = `/${FIRM_PROFILE_IMAGES_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length).split('?')[0] || null;
}

export async function uploadFirmCoverImage(firmId: string, file: File): Promise<string> {
  validateImageFile(file);
  const ext = safeImageExt(file);
  const objectPath = `firms/${firmId}/cover/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(FIRM_PROFILE_IMAGES_BUCKET)
    .upload(objectPath, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from(FIRM_PROFILE_IMAGES_BUCKET).getPublicUrl(objectPath);
  const url = data?.publicUrl ? String(data.publicUrl) : '';
  if (!url) throw new Error('Upload succeeded but could not resolve URL');
  return url;
}

export async function uploadFirmProfileImage(firmId: string, file: File): Promise<string> {
  validateImageFile(file);
  const ext = safeImageExt(file);
  const objectPath = `firms/${firmId}/avatar/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(FIRM_PROFILE_IMAGES_BUCKET)
    .upload(objectPath, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from(FIRM_PROFILE_IMAGES_BUCKET).getPublicUrl(objectPath);
  const url = data?.publicUrl ? String(data.publicUrl) : '';
  if (!url) throw new Error('Upload succeeded but could not resolve URL');
  return url;
}

export async function uploadContactProfileImage(contactId: string, file: File): Promise<string> {
  validateImageFile(file);
  const ext = safeImageExt(file);
  const objectPath = `contacts/${contactId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(FIRM_PROFILE_IMAGES_BUCKET)
    .upload(objectPath, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from(FIRM_PROFILE_IMAGES_BUCKET).getPublicUrl(objectPath);
  const url = data?.publicUrl ? String(data.publicUrl) : '';
  if (!url) throw new Error('Upload succeeded but could not resolve URL');
  return url;
}

export async function removeFirmProfileImageFromStorage(publicUrl: string | null | undefined) {
  const path = publicUrl?.trim() ? extractFirmProfileImageObjectPath(publicUrl.trim()) : null;
  if (!path) return;
  const { error } = await supabase.storage.from(FIRM_PROFILE_IMAGES_BUCKET).remove([path]);
  if (error) throw error;
}
