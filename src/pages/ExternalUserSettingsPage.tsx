import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

type FirmRow = { id: string; name: string };
type FirmContactRow = {
  id: string;
  firm_id: string;
  name: string | null;
  profile_image_url: string | null;
  email: string | null;
  second_email: string | null;
  phone: string | null;
  user_email: string | null;
};

function extractExternalAvatarObjectPath(publicUrl: string): string | null {
  const marker = '/external-user-avatars/';
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length).split('?')[0] || null;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-stretch gap-1.5">
      <span className="text-left text-sm font-medium text-base-content/80">{label}</span>
      {children}
    </div>
  );
}

export default function ExternalUserSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [firm, setFirm] = useState<FirmRow | null>(null);
  const [contact, setContact] = useState<FirmContactRow | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const displayName = useMemo(() => contact?.name?.trim() || '', [contact?.name]);
  const photoUrl = useMemo(() => contact?.profile_image_url?.trim() || '', [contact?.profile_image_url]);
  const email = useMemo(() => contact?.email?.trim() || '', [contact?.email]);
  const secondEmail = useMemo(() => contact?.second_email?.trim() || '', [contact?.second_email]);
  const phone = useMemo(() => contact?.phone?.trim() || '', [contact?.phone]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const authIdFromSession = auth.user?.id;
        if (!authIdFromSession) throw new Error('Not signed in');
        if (cancelled) return;

        const { data: userRow, error: userErr } = await supabase
          .from('users')
          .select('id, extern_firm_id, email')
          .eq('auth_id', authIdFromSession)
          .maybeSingle();
        if (userErr) throw userErr;
        if (!userRow?.id) throw new Error('User record not found');

        const uid = String(userRow.id);
        if (cancelled) return;
        setUserId(uid);
        setUserEmail(userRow.email ? String(userRow.email) : null);

        const [{ data: contactRow, error: contactErr }, { data: firmRow, error: firmErr }] = await Promise.all([
          supabase
            .from('firm_contacts')
            .select('id, firm_id, name, profile_image_url, email, second_email, phone, user_email, user_id')
            .eq('user_id', uid)
            .maybeSingle(),
          userRow.extern_firm_id
            ? supabase.from('firms').select('id, name').eq('id', String(userRow.extern_firm_id)).maybeSingle()
            : Promise.resolve({ data: null as any, error: null as any }),
        ]);
        if (contactErr) throw contactErr;
        if (firmErr) throw firmErr;

        if (cancelled) return;

        setContact(
          contactRow
            ? {
                id: String(contactRow.id),
                firm_id: String(contactRow.firm_id),
                name: (contactRow as any).name ?? null,
                email: (contactRow as any).email ?? null,
                second_email: (contactRow as any).second_email ?? null,
                phone: (contactRow as any).phone ?? null,
                user_email: (contactRow as any).user_email ?? null,
                profile_image_url: (contactRow as any).profile_image_url ?? null,
              }
            : null,
        );
        setFirm(firmRow ? { id: String(firmRow.id), name: String(firmRow.name) } : null);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error(e);
        toast.error(e?.message || 'Failed to load external settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    if (!userId || !userEmail || !contact?.id) {
      toast.error('No firm contact linked to this user');
      return;
    }
    try {
      setSaving(true);
      const payload = {
        name: displayName || null,
        profile_image_url: photoUrl || null,
        email: email || null,
        second_email: secondEmail || null,
        phone: phone || null,
      };
      const { error } = await supabase.from('firm_contacts').update(payload).eq('id', contact.id);
      if (error) throw error;
      toast.success('Saved');
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(e);
      toast.error(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = () => {
    fileInputRef.current?.click();
  };

  const persistProfileImageUrl = async (url: string | null) => {
    if (!contact?.id) throw new Error('No firm contact linked to this user');
    const { error } = await supabase
      .from('firm_contacts')
      .update({ profile_image_url: url })
      .eq('id', contact.id);
    if (error) throw error;
    setContact((c) => (c ? { ...c, profile_image_url: url } : c));
  };

  const uploadAvatar = async (file: File) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUserId = sessionData.session?.user?.id;
    if (!sessionUserId) throw new Error('Not signed in (no Supabase session)');
    if (!contact?.id) throw new Error('No firm contact linked to this user');

    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) throw new Error('Image is too large (max 5MB)');
    if (!file.type.startsWith('image/')) throw new Error('Please select an image file');

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    // Must match Storage RLS: second path segment == auth.uid() from JWT
    const objectPath = `avatars/${sessionUserId}/${Date.now()}.${safeExt}`;

    // Do not use upsert: true unless SELECT (+ UPDATE) policies exist on storage.objects
    // (Supabase Storage upsert checks/overwrites existing objects). Paths are unique per upload.
    const { error: uploadErr } = await supabase.storage
      .from('external-user-avatars')
      .upload(objectPath, file, { upsert: false, contentType: file.type });
    if (uploadErr) throw uploadErr;

    const { data: publicUrlData } = supabase.storage.from('external-user-avatars').getPublicUrl(objectPath);
    const nextUrl = publicUrlData?.publicUrl ? String(publicUrlData.publicUrl) : '';
    if (!nextUrl) throw new Error('Upload succeeded but could not resolve URL');

    setContact((c) => (c ? { ...c, profile_image_url: nextUrl } : c));
    await persistProfileImageUrl(nextUrl);
    toast.success('Profile image saved');
  };

  const removeAvatar = async () => {
    if (!contact) return;
    const path = photoUrl ? extractExternalAvatarObjectPath(photoUrl) : null;
    if (path) {
      try {
        setUploading(true);
        const { error } = await supabase.storage.from('external-user-avatars').remove([path]);
        if (error) throw error;
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error(e);
        toast.error(e?.message || 'Could not remove file from storage');
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }
    try {
      await persistProfileImageUrl(null);
      toast.success('Profile image removed');
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(e);
      toast.error(e?.message || 'Could not clear profile image in database');
    }
  };

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-base-100 px-4 py-6 md:px-10 md:py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">External settings</h1>
          <p className="mt-1 text-sm text-base-content/60">Update your profile and contact details.</p>
        </div>

        <div className="space-y-8">
          <div className="flex items-start gap-5">
            <div className="shrink-0">
              <div className="relative h-24 w-24 md:h-28 md:w-28">
                <div className="h-full w-full overflow-hidden rounded-full border border-base-300 bg-base-200">
                  {photoUrl ? (
                    <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-base-content/70 md:text-xl">
                      {(displayName || 'U')
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((p) => p[0]?.toUpperCase())
                        .join('')}
                    </div>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    try {
                      setUploading(true);
                      await uploadAvatar(f);
                    } catch (err: any) {
                      // eslint-disable-next-line no-console
                      console.error(err);
                      toast.error(err?.message || 'Failed to upload image');
                    } finally {
                      setUploading(false);
                    }
                  }}
                />

                {!!photoUrl && (
                  <button
                    type="button"
                    className="btn btn-circle btn-xs absolute right-0 top-0 z-10 translate-x-1 -translate-y-1 border border-base-300 bg-base-100/95 text-base-content shadow-sm hover:bg-error/10 hover:text-error"
                    onClick={() => void removeAvatar()}
                    disabled={loading || uploading || saving}
                    title="Remove image"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm h-8 min-h-0 px-3 text-sm font-semibold"
                  onClick={onPickAvatar}
                  disabled={loading || uploading || saving}
                  title={photoUrl ? 'Edit image' : 'Upload image'}
                >
                  {uploading ? 'Uploading…' : photoUrl ? 'Edit' : 'Upload image'}
                </button>
              </div>
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="text-sm font-semibold text-base-content/80">Firm</div>
              <div className="truncate text-base font-bold">{firm?.name || '—'}</div>
              {userEmail && <div className="truncate text-xs text-base-content/60">{userEmail}</div>}
            </div>
          </div>

          <div className="divider my-0" />

          <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:items-start">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="text-sm font-semibold text-base-content/80">Profile</div>
              <Field label="Display name">
                <input
                  className="input input-bordered w-full"
                  value={displayName}
                  onChange={(e) => setContact((c) => ({ ...(c as any), name: e.target.value }))}
                  placeholder="e.g. John Doe"
                  disabled={loading}
                />
              </Field>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="text-sm font-semibold text-base-content/80">Contact</div>
              <Field label="Email">
                <input
                  className="input input-bordered w-full"
                  value={email}
                  onChange={(e) => setContact((c) => ({ ...(c as any), email: e.target.value }))}
                  placeholder="name@company.com"
                  disabled={loading}
                  inputMode="email"
                />
              </Field>
              <Field label="Second email">
                <input
                  className="input input-bordered w-full"
                  value={secondEmail}
                  onChange={(e) => setContact((c) => ({ ...(c as any), second_email: e.target.value }))}
                  placeholder="optional"
                  disabled={loading}
                  inputMode="email"
                />
              </Field>
              <Field label="Phone">
                <input
                  className="input input-bordered w-full"
                  value={phone}
                  onChange={(e) => setContact((c) => ({ ...(c as any), phone: e.target.value }))}
                  placeholder="+972..."
                  disabled={loading}
                  inputMode="tel"
                />
              </Field>
            </div>
          </div>

          <div className="divider my-0" />

          <div className="flex items-center justify-between">
            <div className="text-xs text-base-content/60">
              {loading ? 'Loading…' : contact?.id ? ' ' : 'No contact linked to this user.'}
            </div>
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={loading || saving || uploading}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

