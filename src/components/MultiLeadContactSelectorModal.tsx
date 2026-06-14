import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, EnvelopeIcon, PhoneIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { toast } from 'react-hot-toast';
import { fetchLeadContacts, type ContactInfo } from '../lib/contactHelpers';
import type { SelectedLeadContact } from '../lib/interactionsCommunicationPreset';

export type MultiLeadContactSelectorLead = {
  leadId: string;
  leadType: 'legacy' | 'new';
  leadName: string;
  caseNumber: string;
  clientName: string;
};

type LeadContactsGroup = {
  lead: MultiLeadContactSelectorLead;
  contacts: ContactInfo[];
};

export type ContactPickerMode = 'email' | 'whatsapp' | 'call';

interface MultiLeadContactSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: ContactPickerMode;
  leads: MultiLeadContactSelectorLead[];
  onConfirm: (selections: SelectedLeadContact[]) => void;
}

const normalizeContactInfo = (
  contact: ContactInfo | { name?: string; email?: string | null; phone?: string | null; mobile?: string | null },
) => {
  const normalizeEmail = (email: string | null | undefined) => email?.toLowerCase().trim() || '';
  const normalizePhone = (phone: string | null | undefined) =>
    phone?.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '') || '';

  return {
    name: (contact.name || '').toLowerCase().trim(),
    email: normalizeEmail(contact.email),
    phone: normalizePhone(contact.phone || contact.mobile),
  };
};

const contactsMatch = (
  contact1: ContactInfo | { name?: string; email?: string | null; phone?: string | null; mobile?: string | null },
  contact2: ContactInfo | { name?: string; email?: string | null; phone?: string | null; mobile?: string | null },
): boolean => {
  const norm1 = normalizeContactInfo(contact1);
  const norm2 = normalizeContactInfo(contact2);

  if (norm1.email && norm2.email && norm1.email === norm2.email) return true;
  if (norm1.phone && norm2.phone && norm1.phone === norm2.phone) return true;
  if (norm1.name && norm2.name && norm1.name === norm2.name) {
    if (
      (norm1.email && norm2.email && norm1.email === norm2.email) ||
      (norm1.phone && norm2.phone && norm1.phone === norm2.phone)
    ) {
      return true;
    }
  }
  return false;
};

function dedupeContacts(contacts: ContactInfo[], leadName: string): ContactInfo[] {
  if (contacts.length === 0) {
    return [
      {
        id: -1,
        name: leadName || 'Client',
        email: null,
        phone: null,
        mobile: null,
        country_id: null,
        isMain: true,
      },
    ];
  }

  const uniqueContacts: ContactInfo[] = [];
  const seenContactKeys = new Set<string>();

  for (const contact of contacts) {
    const normalized = normalizeContactInfo(contact);
    const contactKey = `${normalized.email}_${normalized.phone}_${normalized.name}`;
    if (seenContactKeys.has(contactKey)) continue;
    if (uniqueContacts.some((existing) => contactsMatch(existing, contact))) continue;
    seenContactKeys.add(contactKey);
    uniqueContacts.push(contact);
  }

  return uniqueContacts;
}

function contactKey(leadId: string, contact: ContactInfo): string {
  return `${leadId}:${contact.id}:${contact.email || ''}:${contact.phone || ''}:${contact.mobile || ''}`;
}

function contactUsableForMode(contact: ContactInfo, mode: ContactPickerMode): boolean {
  if (mode === 'email') {
    return Boolean(contact.email?.trim());
  }
  return Boolean(contact.phone?.trim() || contact.mobile?.trim());
}

function modeLabel(mode: ContactPickerMode): string {
  if (mode === 'email') return 'email';
  if (mode === 'whatsapp') return 'WhatsApp';
  return 'call';
}

function modeEmptySelectionError(mode: ContactPickerMode): string {
  if (mode === 'email') return 'Select at least one contact with email';
  return 'Select at least one contact with phone';
}

function modeNoContactsMessage(mode: ContactPickerMode): string {
  if (mode === 'email') return 'No contacts with email found for the selected leads';
  return 'No contacts with phone found for the selected leads';
}

const MultiLeadContactSelectorModal: React.FC<MultiLeadContactSelectorModalProps> = ({
  isOpen,
  onClose,
  mode,
  leads,
  onConfirm,
}) => {
  const [groups, setGroups] = useState<LeadContactsGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      setGroups([]);
      setSelectedKeys(new Set());
      setLoading(true);
      return;
    }

    let cancelled = false;

    const loadAll = async () => {
      setLoading(true);
      try {
        const loaded = await Promise.all(
          leads.map(async (lead) => {
            const isLegacy = lead.leadType === 'legacy';
            const normalizedLeadId = isLegacy ? lead.leadId.replace(/^legacy_/, '') : lead.leadId;
            const fetched = await fetchLeadContacts(normalizedLeadId, isLegacy);
            const contacts = dedupeContacts(fetched, lead.leadName || lead.clientName).filter((c) =>
              contactUsableForMode(c, mode),
            );
            return { lead, contacts };
          }),
        );
        if (!cancelled) {
          setGroups(loaded);
        }
      } catch (error) {
        console.error('Error loading contacts for multi-lead selector:', error);
        if (!cancelled) {
          toast.error('Failed to load contacts');
          setGroups([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [isOpen, leads, mode]);

  const totalSelectable = useMemo(
    () => groups.reduce((sum, group) => sum + group.contacts.length, 0),
    [groups],
  );

  const toggleContact = useCallback((lead: MultiLeadContactSelectorLead, contact: ContactInfo) => {
    const key = contactKey(lead.leadId, contact);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleConfirm = () => {
    const selections: SelectedLeadContact[] = [];
    for (const group of groups) {
      const isLegacy = group.lead.leadType === 'legacy';
      const normalizedLeadId = isLegacy
        ? group.lead.leadId.replace(/^legacy_/, '')
        : group.lead.leadId;

      for (const contact of group.contacts) {
        const key = contactKey(group.lead.leadId, contact);
        if (!selectedKeys.has(key)) continue;
        selections.push({
          contact,
          leadId: normalizedLeadId,
          leadType: group.lead.leadType,
        });
      }
    }

    if (selections.length === 0) {
      toast.error(modeEmptySelectionError(mode));
      return;
    }

    onConfirm(selections);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {mode === 'email' ? (
              <EnvelopeIcon className="w-6 h-6 text-blue-600" />
            ) : mode === 'whatsapp' ? (
              <FaWhatsapp className="w-6 h-6 text-green-600" />
            ) : (
              <PhoneIcon className="w-6 h-6 text-gray-700" />
            )}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Select contacts</h2>
              <p className="text-sm text-gray-500">
                Choose one or more contacts for {modeLabel(mode)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle" type="button">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="loading loading-spinner loading-lg" />
            </div>
          ) : totalSelectable === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">{modeNoContactsMessage(mode)}</p>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => {
                if (group.contacts.length === 0) return null;
                const leadLabel = group.lead.caseNumber?.replace(/^#/, '') || group.lead.leadName;
                return (
                  <div key={group.lead.leadId}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                      {leadLabel} — {group.lead.leadName || group.lead.clientName}
                    </p>
                    <div className="space-y-2">
                      {group.contacts.map((contact) => {
                        const key = contactKey(group.lead.leadId, contact);
                        const checked = selectedKeys.has(key);
                        return (
                          <label
                            key={key}
                            className={`flex items-start gap-3 w-full p-4 border rounded-lg cursor-pointer transition-colors ${
                              checked ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm mt-1"
                              checked={checked}
                              onChange={() => toggleContact(group.lead, contact)}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-gray-900">{contact.name}</span>
                                {contact.isMain && (
                                  <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                                    Main
                                  </span>
                                )}
                              </div>
                              {contact.email && (
                                <p className="text-sm text-gray-600 mt-1 truncate">{contact.email}</p>
                              )}
                              {(contact.phone || contact.mobile) && (
                                <p className="text-sm text-gray-500 mt-1">{contact.phone || contact.mobile}</p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            {selectedKeys.size > 0 ? `${selectedKeys.size} selected` : 'No contacts selected'}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={selectedKeys.size === 0 || loading}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default MultiLeadContactSelectorModal;
