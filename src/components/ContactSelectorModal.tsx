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
  leadEmail?: string | null;
  leadPhone?: string | null;
  leadMobile?: string | null;
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
  leadEmail,
  leadPhone,
  leadMobile,
  mode,
  onContactSelected,
}) => {
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Helper function to normalize contact info for comparison
  const normalizeContactInfo = (contact: ContactInfo | { name?: string; email?: string | null; phone?: string | null; mobile?: string | null }) => {
    const normalizeEmail = (email: string | null | undefined) => email?.toLowerCase().trim() || '';
    const normalizePhone = (phone: string | null | undefined) => phone?.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '') || '';
    
    return {
      name: (contact.name || '').toLowerCase().trim(),
      email: normalizeEmail(contact.email),
      phone: normalizePhone(contact.phone || contact.mobile),
    };
  };

  // Helper function to check if two contacts match (same person)
  const contactsMatch = (contact1: ContactInfo | { name?: string; email?: string | null; phone?: string | null; mobile?: string | null }, contact2: ContactInfo | { name?: string; email?: string | null; phone?: string | null; mobile?: string | null }): boolean => {
    const norm1 = normalizeContactInfo(contact1);
    const norm2 = normalizeContactInfo(contact2);
    
    // Match if same email (and email is not empty)
    if (norm1.email && norm2.email && norm1.email === norm2.email) {
      return true;
    }
    
    // Match if same phone (and phone is not empty)
    if (norm1.phone && norm2.phone && norm1.phone === norm2.phone) {
      return true;
    }
    
    // Match if same name AND (same email OR same phone)
    if (norm1.name && norm2.name && norm1.name === norm2.name) {
      if ((norm1.email && norm2.email && norm1.email === norm2.email) ||
          (norm1.phone && norm2.phone && norm1.phone === norm2.phone)) {
        return true;
      }
    }
    
    return false;
  };

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
        
        // Create fallback contact from lead info if no contacts found
        let processedContacts = [...fetchedContacts];
        
        const mainLeadInfo = {
          name: leadName || '',
          email: leadEmail || null,
          phone: leadPhone || null,
          mobile: leadMobile || null,
        };
        
        if (processedContacts.length === 0) {
          // Create a fallback contact from the lead's information only if no contacts exist
          const fallbackContact: ContactInfo = {
            id: -1, // Use -1 as a temporary ID for fallback contact
            name: leadName || 'Client',
            email: leadEmail || null,
            phone: leadPhone || null,
            mobile: leadMobile || null,
            country_id: null,
            isMain: true,
          };
          processedContacts = [fallbackContact];
        } else {
          // Deduplicate contacts based on matching info
          const uniqueContacts: ContactInfo[] = [];
          const seenContactKeys = new Set<string>();
          
          processedContacts.forEach((contact) => {
            // Create a unique key for this contact based on email, phone, and name
            const normalized = normalizeContactInfo(contact);
            const contactKey = `${normalized.email}_${normalized.phone}_${normalized.name}`;
            
            // Check if this contact matches the main lead
            const matchesMainLead = contactsMatch(contact, mainLeadInfo);
            
            // Check if we've already seen a contact with the same key
            if (seenContactKeys.has(contactKey)) {
              // Skip duplicate
              return;
            }
            
            // Check if this contact is a duplicate of any existing contact
            const isDuplicate = uniqueContacts.some(existing => contactsMatch(existing, contact));
            if (isDuplicate) {
              // Skip duplicate
              return;
            }
            
            // If contact matches main lead, we still add it (it's the contact entry)
            // The main lead info is just used for comparison, not added separately
            seenContactKeys.add(contactKey);
            uniqueContacts.push(contact);
          });
          
          processedContacts = uniqueContacts;
        }
        
        setContacts(processedContacts);
      } catch (error) {
        console.error('Error loading contacts:', error);
        toast.error('Failed to load contacts');
        // On error, create fallback contact
        const fallbackContact: ContactInfo = {
          id: -1,
          name: leadName || 'Client',
          email: leadEmail || null,
          phone: leadPhone || null,
          mobile: leadMobile || null,
          country_id: null,
          isMain: true,
        };
        setContacts([fallbackContact]);
      } finally {
        setLoading(false);
      }
    };

    loadContacts();
  }, [isOpen, leadId, leadType, leadName, leadEmail, leadPhone, leadMobile]);

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

