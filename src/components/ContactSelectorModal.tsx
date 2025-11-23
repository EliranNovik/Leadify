import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { supabase } from '../lib/supabase';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';
import { toast } from 'react-hot-toast';

interface ContactSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string | number;
  leadType: 'legacy' | 'new';
  leadName?: string;
  leadNumber?: string;
  mode: 'email' | 'whatsapp';
  onContactSelected: (contact: ContactInfo, leadId: string | number, leadType: 'legacy' | 'new') => void;
}

const ContactSelectorModal: React.FC<ContactSelectorModalProps> = ({
  isOpen,
  onClose,
  leadId,
  leadType,
  leadName,
  leadNumber,
  mode,
  onContactSelected,
}) => {
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      setContacts([]);
      setLoading(true);
      return;
    }

    const loadContacts = async () => {
      try {
        setLoading(true);
        const isLegacy = leadType === 'legacy';
        const normalizedLeadId = isLegacy 
          ? (typeof leadId === 'string' ? leadId.replace('legacy_', '') : String(leadId))
          : leadId;

        const fetchedContacts = await fetchLeadContacts(normalizedLeadId, isLegacy);
        setContacts(fetchedContacts);
      } catch (error) {
        console.error('Error loading contacts:', error);
        toast.error('Failed to load contacts');
      } finally {
        setLoading(false);
      }
    };

    loadContacts();
  }, [isOpen, leadId, leadType]);

  const handleContactClick = (contact: ContactInfo) => {
    const normalizedLeadId = leadType === 'legacy' 
      ? (typeof leadId === 'string' ? leadId.replace('legacy_', '') : String(leadId))
      : leadId;
    
    onContactSelected(contact, normalizedLeadId, leadType);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {mode === 'email' ? (
              <EnvelopeIcon className="w-6 h-6 text-blue-600" />
            ) : (
              <FaWhatsapp className="w-6 h-6 text-green-600" />
            )}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Select Contact
              </h2>
              <p className="text-sm text-gray-500">
                {leadName || leadNumber || 'Lead'} - {mode === 'email' ? 'Email' : 'WhatsApp'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="loading loading-spinner loading-lg"></div>
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No contacts found for this lead</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => handleContactClick(contact)}
                  className="w-full p-4 text-left border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-300 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">
                          {contact.name}
                        </span>
                        {contact.isMain && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                            Main
                          </span>
                        )}
                      </div>
                      {contact.email && (
                        <p className="text-sm text-gray-600 mt-1">{contact.email}</p>
                      )}
                      {(contact.phone || contact.mobile) && (
                        <p className="text-sm text-gray-500 mt-1">
                          {contact.phone || contact.mobile}
                        </p>
                      )}
                    </div>
                    {mode === 'email' ? (
                      <EnvelopeIcon className="w-5 h-5 text-blue-600 ml-4" />
                    ) : (
                      <FaWhatsapp className="w-5 h-5 text-green-600 ml-4" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ContactSelectorModal;

