import React, { useCallback, useEffect, useState } from 'react';
import { PencilSquareIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { portalGetContacts, portalUpdateContact } from '../../../lib/portalApi';
import {
  getPortalTabHeaderCoverImage,
  PortalCard,
  PortalLoading,
  PortalTabFrame,
} from '../components/portalTheme';
import PortalContactAvatar from '../components/PortalContactAvatar';
import { usePortalContactProfileUrls } from '../hooks/usePortalContactProfileUrls';

type ContactRow = {
  id: number;
  name: string;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  id_passport: string | null;
  country_id: number | null;
  is_main: boolean;
  portal_profile_image_path: string | null;
};

type Props = {
  sessionContactId?: number;
  onSessionRefresh?: () => void;
};

function displayContactValue(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

const FIELD_LABELS: Record<'email' | 'phone' | 'mobile' | 'address' | 'id_passport', string> = {
  email: 'Email',
  phone: 'Phone',
  mobile: 'Mobile',
  address: 'Address',
  id_passport: 'ID / Passport',
};

const CONTACT_FIELDS = ['email', 'phone', 'mobile', 'address', 'id_passport'] as const;

const PortalContactsTab: React.FC<Props> = ({ sessionContactId, onSessionRefresh }) => {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<ContactRow>>({});
  const [saving, setSaving] = useState(false);

  const profileUrls = usePortalContactProfileUrls(contacts.map((c) => c.portal_profile_image_path));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await portalGetContacts();
      setContacts((data?.contacts ?? []) as ContactRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (c: ContactRow) => {
    setEditingId(c.id);
    setDraft({ ...c });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const saveEdit = async () => {
    if (editingId == null) return;
    setSaving(true);
    try {
      const result = await portalUpdateContact(editingId, {
        name: draft.name,
        mobile: draft.mobile,
        phone: draft.phone,
        email: draft.email,
        address: draft.address,
        id_passport: draft.id_passport,
        country_id: draft.country_id,
      });
      if (!result.ok) throw new Error(result.error || 'Update failed');
      toast.success('Contact updated');
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleProfileUpdated = (contactId: number, storagePath: string) => {
    setContacts((prev) =>
      prev.map((c) =>
        c.id === contactId ? { ...c, portal_profile_image_path: storagePath } : c,
      ),
    );
    if (sessionContactId === contactId) {
      onSessionRefresh?.();
    }
  };

  if (loading) return <PortalLoading />;

  return (
    <PortalTabFrame
      title="My contacts"
      subtitle="People linked to your case. Update details or profile photos here."
      headerCoverImage={getPortalTabHeaderCoverImage('contacts')}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {contacts.map((c) => {
          const isEditing = editingId === c.id;
          const imageUrl = c.portal_profile_image_path
            ? profileUrls[c.portal_profile_image_path]
            : undefined;
          return (
            <PortalCard key={c.id} padding="p-0" className="overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-4 pb-4 pt-4 md:px-5 md:pb-5 md:pt-5">
                <div className="flex items-center gap-3 min-w-0">
                  <PortalContactAvatar
                    contactId={c.id}
                    name={c.name}
                    imageUrl={imageUrl}
                    sizeClass="h-16 w-16 text-lg"
                    onUpdated={(path) => handleProfileUpdated(c.id, path)}
                  />
                  <div className="min-w-0">
                    {isEditing ? (
                      <input
                        className="input input-bordered input-sm w-full max-w-xs"
                        value={draft.name ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      />
                    ) : (
                      <p className="font-bold text-base-content/90">{c.name}</p>
                    )}
                  </div>
                </div>
                {!isEditing ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-circle h-11 w-11 min-h-11 shrink-0"
                    onClick={() => startEdit(c)}
                    aria-label="Edit contact"
                  >
                    <PencilSquareIcon className="h-5 w-5" />
                  </button>
                ) : (
                  <div className="flex gap-1">
                    <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={saveEdit}>
                      <CheckIcon className="w-4 h-4" />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdit}>
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-200/50 bg-[#fafafa] px-4 py-4 md:px-5 md:py-5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm">
                  {CONTACT_FIELDS.map((field) => (
                    <div key={field} className="min-w-0">
                      <p className="mb-1 text-sm font-semibold text-gray-900">{FIELD_LABELS[field]}</p>
                      {isEditing ? (
                        <input
                          className="input input-bordered input-sm w-full border-gray-200 bg-white"
                          value={(draft[field] as string) ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                        />
                      ) : (
                        <p className="truncate text-sm text-gray-500">{displayContactValue(c[field])}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </PortalCard>
          );
        })}
      </div>
    </PortalTabFrame>
  );
};

export default PortalContactsTab;
