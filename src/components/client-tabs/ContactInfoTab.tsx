import React, { useState, useEffect, Fragment } from 'react';
import { ClientTabProps } from '../../types/client';
import { UserIcon, PhoneIcon, EnvelopeIcon, PlusIcon, DocumentTextIcon, XMarkIcon, PencilSquareIcon, CheckIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { createPortal } from 'react-dom';
import SignaturePad from 'react-signature-canvas';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { handleContractSigned } from '../../lib/contractAutomation';
import { getPricePerApplicant } from '../../lib/contractPricing';
import { useNavigate } from 'react-router-dom';

// Helper function to get current tier key based on applicant count
const getCurrentTierKey = (count: number) => {
  if (count === 1) return '1';
  if (count === 2) return '2';
  if (count === 3) return '3';
  if (count >= 4 && count <= 7) return '4-7';
  if (count >= 8 && count <= 9) return '8-9';
  if (count >= 10 && count <= 15) return '10-15';
  return '16+';
};

interface ContactEntry {
  id: number;
  name: string;
  mobile: string;
  phone: string;
  email: string;
  isMain?: boolean;
  isEditing?: boolean;
}

interface ContractTemplate {
  id: string;
  name: string;
  content: any;
  default_pricing_tiers?: { [key: string]: number };
  default_currency?: string;
  default_country?: string;
}

// Helper to render TipTap JSON as React elements, with support for dynamic fields in 'View as Client' mode
const renderTiptapContent = (content: any, keyPrefix = '', asClient = false, signaturePads?: { [key: string]: any }): React.ReactNode => {
  if (!content) return null;
  if (Array.isArray(content)) {
    return content.map((n, i) => renderTiptapContent(n, keyPrefix + '-' + i, asClient, signaturePads));
  }
  if (content.type === 'text') {
    let text = content.text;
    if (asClient && text) {
      // Split text by {{text}} and {{signature}} placeholders
      const parts = [];
      let lastIndex = 0;
      const regex = /({{text}}|{{signature}})/g;
      let match;
      let partIdx = 0;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          // Normal text before the placeholder
          const normalText = text.slice(lastIndex, match.index);
          parts.push(normalText);
        }
        // Placeholder
        if (match[1] === '{{text}}') {
          parts.push(
            <input
              key={keyPrefix + '-input-' + partIdx}
              className="input input-bordered input-sm mx-1"
              placeholder="Enter text"
              style={{ minWidth: 80, display: 'inline-block' }}
            />
          );
        } else if (match[1] === '{{signature}}') {
          parts.push(
            <span
              key={keyPrefix + '-sig-' + partIdx}
              style={{ display: 'inline-block', minWidth: 180, minHeight: 60, border: '1px solid #ccc', borderRadius: 8, background: '#f9f9f9', margin: '0 8px', verticalAlign: 'middle' }}
            >
              <SignaturePad
                ref={(ref) => {
                  if (ref && signaturePads) signaturePads[keyPrefix + '-sig-' + partIdx] = ref;
                }}
                penColor="#3b28c7"
                backgroundColor="#f9f9f9"
                canvasProps={{ width: 180, height: 60, style: { display: 'block', borderRadius: 8 } }}
              />
            </span>
          );
        }
        lastIndex = match.index + match[1].length;
        partIdx++;
      }
      if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
      }
      // If marks are present, wrap the whole thing
      if (content.marks && content.marks.length > 0) {
        return content.marks.reduce((acc: any, mark: any) => {
          if (mark.type === 'bold') return <b key={keyPrefix}>{acc}</b>;
          if (mark.type === 'italic') return <i key={keyPrefix}>{acc}</i>;
          if (mark.type === 'underline') return <u key={keyPrefix}>{acc}</u>;
          if (mark.type === 'strike') return <s key={keyPrefix}>{acc}</s>;
          return acc;
        }, parts);
      }
      return parts;
    }
    // Not in client view, render as before
    if (content.marks && content.marks.length > 0) {
      return content.marks.reduce((acc: any, mark: any) => {
        if (mark.type === 'bold') return <b key={keyPrefix}>{acc}</b>;
        if (mark.type === 'italic') return <i key={keyPrefix}>{acc}</i>;
        if (mark.type === 'underline') return <u key={keyPrefix}>{acc}</u>;
        if (mark.type === 'strike') return <s key={keyPrefix}>{acc}</s>;
        return acc;
      }, text);
    }
    return text;
  }
  switch (content.type) {
    case 'paragraph':
      return <p key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-p', asClient, signaturePads)}</p>;
    case 'heading':
      const level = content.attrs?.level || 1;
      const headingTags = ['h1','h2','h3','h4','h5','h6'];
      const HeadingTag = headingTags[Math.max(0, Math.min(5, level-1))] || 'h1';
      return React.createElement(
        HeadingTag,
        { key: keyPrefix },
        renderTiptapContent(content.content, keyPrefix + '-h', asClient, signaturePads)
      );
    case 'bulletList':
      return <ul key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-ul', asClient, signaturePads)}</ul>;
    case 'orderedList':
      return <ol key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-ol', asClient, signaturePads)}</ol>;
    case 'listItem':
      return <li key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-li', asClient, signaturePads)}</li>;
    case 'blockquote':
      return <blockquote key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-bq', asClient, signaturePads)}</blockquote>;
    case 'horizontalRule':
      return <hr key={keyPrefix} />;
    case 'hardBreak':
      return <br key={keyPrefix} />;
    default:
      return renderTiptapContent(content.content, keyPrefix + '-d', asClient, signaturePads);
  }
};

const ContactInfoTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ContactEntry[]>([
    {
      id: 1,
      name: client.name || '---',
      mobile: client.mobile || '---',
      phone: client.phone || '---',
      email: client.email || '---',
      isMain: true,
    }
  ]);

  const [isEditingMainContact, setIsEditingMainContact] = useState(false);
  const [editedMainContact, setEditedMainContact] = useState({
    name: client.name || '',
    mobile: client.mobile || '',
    phone: client.phone || '',
    email: client.email || ''
  });


  const [contactContracts, setContactContracts] = useState<{ [id: number]: { id: string; name: string; status: string; signed_at?: string } | null }>({});
  const [contractTemplates, setContractTemplates] = useState<ContractTemplate[]>([]);
  const [viewingContract, setViewingContract] = useState<{ id: string; mode: 'view' } | null>(null);

  // State for 'View as Client' mode in contract modal
  const [viewAsClient, setViewAsClient] = useState(false);
  const [signaturePads, setSignaturePads] = useState<{ [key: string]: any }>({});

  // New state for contract creation with applicant count and country
  const [showContractCreation, setShowContractCreation] = useState(false);
  const [contractForm, setContractForm] = useState({
    applicantCount: 1,
    clientCountry: 'IL', // Default to Israel
    selectedTemplateId: '',
    contactId: null as number | null,
  });

  // State to track contract status
  const [contractStatuses, setContractStatuses] = useState<{ [id: string]: { status: string; signed_at?: string } }>({});

  // Add state for most recent contract (for backward compatibility)
  const [mostRecentContract, setMostRecentContract] = useState<any>(null);

  // Add state for archival research option
  const [archivalResearch, setArchivalResearch] = useState<'none' | 'with'>('none');

  // Add country codes data
  const countryCodes = [
    { code: '+972', country: 'IL', name: 'Israel' },
    { code: '+1', country: 'US', name: 'United States' },
    { code: '+49', country: 'DE', name: 'Germany' },
    { code: '+44', country: 'GB', name: 'United Kingdom' },
    { code: '+33', country: 'FR', name: 'France' },
    { code: '+39', country: 'IT', name: 'Italy' },
    { code: '+34', country: 'ES', name: 'Spain' },
    { code: '+31', country: 'NL', name: 'Netherlands' },
    { code: '+32', country: 'BE', name: 'Belgium' },
    { code: '+41', country: 'CH', name: 'Switzerland' },
    { code: '+43', country: 'AT', name: 'Austria' },
    { code: '+46', country: 'SE', name: 'Sweden' },
    { code: '+47', country: 'NO', name: 'Norway' },
    { code: '+45', country: 'DK', name: 'Denmark' },
    { code: '+358', country: 'FI', name: 'Finland' },
    { code: '+48', country: 'PL', name: 'Poland' },
    { code: '+420', country: 'CZ', name: 'Czech Republic' },
    { code: '+36', country: 'HU', name: 'Hungary' },
    { code: '+40', country: 'RO', name: 'Romania' },
    { code: '+380', country: 'UA', name: 'Ukraine' },
    { code: '+7', country: 'RU', name: 'Russia' },
    { code: '+90', country: 'TR', name: 'Turkey' },
    { code: '+86', country: 'CN', name: 'China' },
    { code: '+81', country: 'JP', name: 'Japan' },
    { code: '+82', country: 'KR', name: 'South Korea' },
    { code: '+91', country: 'IN', name: 'India' },
    { code: '+61', country: 'AU', name: 'Australia' },
    { code: '+64', country: 'NZ', name: 'New Zealand' },
    { code: '+27', country: 'ZA', name: 'South Africa' },
    { code: '+55', country: 'BR', name: 'Brazil' },
    { code: '+52', country: 'MX', name: 'Mexico' },
    { code: '+54', country: 'AR', name: 'Argentina' },
    { code: '+56', country: 'CL', name: 'Chile' },
    { code: '+57', country: 'CO', name: 'Colombia' },
    { code: '+58', country: 'VE', name: 'Venezuela' },
    { code: '+51', country: 'PE', name: 'Peru' },
    { code: '+593', country: 'EC', name: 'Ecuador' },
    { code: '+595', country: 'PY', name: 'Paraguay' },
    { code: '+598', country: 'UY', name: 'Uruguay' },
    { code: '+591', country: 'BO', name: 'Bolivia' },
    { code: '+507', country: 'PA', name: 'Panama' },
    { code: '+506', country: 'CR', name: 'Costa Rica' },
    { code: '+502', country: 'GT', name: 'Guatemala' },
    { code: '+503', country: 'SV', name: 'El Salvador' },
    { code: '+504', country: 'HN', name: 'Honduras' },
    { code: '+505', country: 'NI', name: 'Nicaragua' },
    { code: '+501', country: 'BZ', name: 'Belize' },
    { code: '+509', country: 'HT', name: 'Haiti' },
    { code: '+1-809', country: 'DO', name: 'Dominican Republic' },
    { code: '+1-787', country: 'PR', name: 'Puerto Rico' },
    { code: '+1-242', country: 'BS', name: 'Bahamas' },
    { code: '+1-246', country: 'BB', name: 'Barbados' },
    { code: '+1-284', country: 'VG', name: 'British Virgin Islands' },
    { code: '+1-345', country: 'KY', name: 'Cayman Islands' },
    { code: '+1-441', country: 'BM', name: 'Bermuda' },
    { code: '+1-473', country: 'GD', name: 'Grenada' },
    { code: '+1-649', country: 'TC', name: 'Turks and Caicos' },
    { code: '+1-664', country: 'MS', name: 'Montserrat' },
    { code: '+1-721', country: 'SX', name: 'Sint Maarten' },
    { code: '+1-758', country: 'LC', name: 'Saint Lucia' },
    { code: '+1-784', country: 'VC', name: 'Saint Vincent' },
    { code: '+1-868', country: 'TT', name: 'Trinidad and Tobago' },
    { code: '+1-869', country: 'KN', name: 'Saint Kitts' },
    { code: '+1-876', country: 'JM', name: 'Jamaica' },
    { code: '+971', country: 'AE', name: 'United Arab Emirates' },
    { code: '+966', country: 'SA', name: 'Saudi Arabia' },
    { code: '+965', country: 'KW', name: 'Kuwait' },
    { code: '+973', country: 'BH', name: 'Bahrain' },
    { code: '+974', country: 'QA', name: 'Qatar' },
    { code: '+968', country: 'OM', name: 'Oman' },
    { code: '+967', country: 'YE', name: 'Yemen' },
    { code: '+962', country: 'JO', name: 'Jordan' },
    { code: '+961', country: 'LB', name: 'Lebanon' },
    { code: '+963', country: 'SY', name: 'Syria' },
    { code: '+964', country: 'IQ', name: 'Iraq' },
    { code: '+98', country: 'IR', name: 'Iran' },
    { code: '+93', country: 'AF', name: 'Afghanistan' },
    { code: '+92', country: 'PK', name: 'Pakistan' },
    { code: '+880', country: 'BD', name: 'Bangladesh' },
    { code: '+94', country: 'LK', name: 'Sri Lanka' },
    { code: '+95', country: 'MM', name: 'Myanmar' },
    { code: '+66', country: 'TH', name: 'Thailand' },
    { code: '+84', country: 'VN', name: 'Vietnam' },
    { code: '+60', country: 'MY', name: 'Malaysia' },
    { code: '+65', country: 'SG', name: 'Singapore' },
    { code: '+63', country: 'PH', name: 'Philippines' },
    { code: '+62', country: 'ID', name: 'Indonesia' },
    { code: '+673', country: 'BN', name: 'Brunei' },
    { code: '+856', country: 'LA', name: 'Laos' },
    { code: '+855', country: 'KH', name: 'Cambodia' },
    { code: '+976', country: 'MN', name: 'Mongolia' },
    { code: '+977', country: 'NP', name: 'Nepal' },
    { code: '+975', country: 'BT', name: 'Bhutan' },
    { code: '+960', country: 'MV', name: 'Maldives' },
    { code: '+978', country: 'XX', name: 'International' },
    { code: '+979', country: 'XX', name: 'International' },
    { code: '+99', country: 'XX', name: 'International' },
  ];

  // Helper function to extract country code and number from full phone number
  const parsePhoneNumber = (fullNumber: string) => {
    if (!fullNumber || fullNumber === '---') return { countryCode: '+972', number: '' };
    
    // Find matching country code
    const matchedCode = countryCodes.find(code => fullNumber.startsWith(code.code));
    if (matchedCode) {
      return {
        countryCode: matchedCode.code,
        number: fullNumber.substring(matchedCode.code.length)
      };
    }
    
    // Default to Israel if no match found
    return { countryCode: '+972', number: fullNumber };
  };

  // Helper function to format phone number for display
  const formatPhoneNumber = (countryCode: string, number: string) => {
    if (!number) return '---';
    return `${countryCode}${number}`;
  };

  // Fetch contracts for each contact
  useEffect(() => {
    if (!client?.id) return;
    let mounted = true;
    (async () => {
      try {
        // Fetch all contracts for this client
        const { data, error } = await supabase
          .from('contracts')
          .select('*')
          .eq('client_id', client.id)
          .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        if (mounted && data) {
          // Group contracts by contact_id
          const contactContractsMap: { [id: number]: { id: string; name: string; status: string; signed_at?: string } | null } = {};
          
          // Initialize all contacts with no contract
          contacts.forEach(contact => {
            contactContractsMap[contact.id] = null;
          });
          
          // Assign contracts to their respective contacts
          data.forEach(contract => {
            if (contract.contact_id) {
              contactContractsMap[contract.contact_id] = {
                id: contract.id,
                name: contractTemplates.find(t => t.id === contract.template_id)?.name || 'Contract',
                status: contract.status,
                signed_at: contract.signed_at
              };
            }
          });
          
          setContactContracts(contactContractsMap);
          
          // Set most recent contract for backward compatibility
          if (data.length > 0) {
            setMostRecentContract(data[0]);
          } else {
            setMostRecentContract(null);
          }
        }
      } catch (error) {
        console.error('Error fetching contracts:', error);
      }
    })();
    return () => { mounted = false; };
  }, [client?.id, contacts, contractTemplates]);

  // Update contacts when client data changes
  useEffect(() => {
    const mainContact: ContactEntry = {
      id: 1,
      name: client.name || '---',
      mobile: client.mobile || '---',
      phone: client.phone || '---',
      email: client.email || '---',
      isMain: true,
    };

    const additionalContacts = client.additional_contacts || [];
    const additionalContactEntries: ContactEntry[] = additionalContacts.map((contact: any, index: number) => ({
      id: index + 2,
      name: contact.name || '---',
      mobile: contact.mobile || '---',
      phone: contact.phone || '---',
      email: contact.email || '---',
      isMain: false,
    }));

    setContacts([mainContact, ...additionalContactEntries]);
    setEditedMainContact({
      name: client.name || '',
      mobile: client.mobile || '',
      phone: client.phone || '',
      email: client.email || ''
    });
  }, [client]);

  // Fetch contract templates when component mounts
  useEffect(() => {
    supabase.from('contract_templates').select('id, name, content, default_pricing_tiers, default_currency, default_country').then(({ data }) => {
      if (data) setContractTemplates(data);
    });
  }, []);

  // Fetch contract statuses when contacts change
  useEffect(() => {
    const fetchContractStatuses = async () => {
      if (!client?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('contracts')
          .select('id, status, signed_at')
          .eq('client_id', client.id);
        
        if (error) throw error;
        
        const statusMap: { [id: string]: { status: string; signed_at?: string } } = {};
        data?.forEach(contract => {
          statusMap[contract.id] = {
            status: contract.status,
            signed_at: contract.signed_at
          };
        });
        
        setContractStatuses(statusMap);
      } catch (error) {
        console.error('Error fetching contract statuses:', error);
      }
    };

    fetchContractStatuses();
  }, [client?.id]);

  const handleCreateNewContact = () => {
    const newContact: ContactEntry = {
      id: Date.now(),
      name: '',
      mobile: '',
      phone: '',
      email: '',
      isEditing: true,
    };
    setContacts([...contacts, newContact]);
  };

  const handleSaveMainContact = async () => {
    try {
      const { error } = await supabase
        .from('leads')
        .update({
          name: editedMainContact.name,
          mobile: editedMainContact.mobile,
          phone: editedMainContact.phone,
          email: editedMainContact.email
        })
        .eq('id', client.id);

      if (error) throw error;

      setIsEditingMainContact(false);
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error updating main contact:', error);
      alert('Failed to update contact information');
    }
  };

  const handleCancelMainContact = () => {
    setEditedMainContact({
      name: client.name || '',
      mobile: client.mobile || '',
      phone: client.phone || '',
      email: client.email || ''
    });
    setIsEditingMainContact(false);
  };

  const handleCancelContact = (contact: ContactEntry) => {
    // If this is a newly created contact (has isEditing flag), remove it from the list
    if (contact.isEditing) {
      setContacts(contacts.filter(c => c.id !== contact.id));
    } else {
      // If it's an existing contact, just exit edit mode
      setContacts(contacts.map(c => c.id === contact.id ? { ...c, isEditing: false } : c));
    }
  };

  const handleSaveContact = async (id: number, contact: ContactEntry) => {
    if (contact.isMain) {
      await handleSaveMainContact();
      return;
    }

    try {
      // Update additional contacts
      const additionalContacts = contacts.filter(c => !c.isMain && c.id !== id);
      const updatedAdditionalContacts = [...additionalContacts, {
        name: contact.name,
        mobile: contact.mobile,
        phone: contact.phone,
        email: contact.email
      }];

      const { error } = await supabase
        .from('leads')
        .update({ additional_contacts: updatedAdditionalContacts })
        .eq('id', client.id);

      if (error) throw error;

      setContacts(contacts.map(c => 
        c.id === id ? { ...contact, isEditing: false } : c
      ));
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error updating contact:', error);
      alert('Failed to update contact');
    }
  };

  const handleDeleteContact = async (id: number) => {
    if (contacts.find(c => c.id === id)?.isMain) {
      alert('Cannot delete the main contact');
      return;
    }

    try {
      const additionalContacts = contacts
        .filter(c => !c.isMain && c.id !== id)
        .map(c => ({
          name: c.name,
          mobile: c.mobile,
          phone: c.phone,
          email: c.email
        }));

      const { error } = await supabase
        .from('leads')
        .update({ additional_contacts: additionalContacts })
        .eq('id', client.id);

      if (error) throw error;

      setContacts(contacts.filter(c => c.id !== id));
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error deleting contact:', error);
      alert('Failed to delete contact');
    }
  };

  // Select contract template (for the modal)
  const handleSelectContract = async (template: ContractTemplate) => {
    // Set the selected template in the form and open the creation modal
    setContractForm(prev => ({ 
      ...prev, 
      selectedTemplateId: template.id 
    }));
    setShowContractCreation(true); // Open the creation modal
  };

  // Utility to extract default pricing and plan from template and form
  // (No longer needed for contract creation, but may be used elsewhere)

  // Create contract with minimal fields
  const handleCreateContract = async () => {
    console.log('handleCreateContract called with:', { contractForm, clientId: client?.id });
    if (!contractForm.selectedTemplateId || !client?.id || !contractForm.contactId) {
      console.log('handleCreateContract: Missing required data, returning early');
      return;
    }

    try {
      // Get the contact details
      let contactName = '';
      let contactEmail = '';
      let contactPhone = '';
      let contactMobile = '';
      
      if (contractForm.contactId === 0) {
        // Main contact
        contactName = client.name || 'Main Contact';
        contactEmail = client.email || '';
        contactPhone = client.phone || '';
        contactMobile = client.mobile || '';
      } else {
        // Additional contact
        const contact = contacts.find(c => c.id === contractForm.contactId);
        contactName = contact?.name || `Contact ${contractForm.contactId}`;
        contactEmail = contact?.email || '';
        contactPhone = contact?.phone || '';
        contactMobile = contact?.mobile || '';
      }

      // Get the selected template to use its default pricing
      const selectedTemplate = contractTemplates.find(t => t.id === contractForm.selectedTemplateId);
      
      // Initialize customPricing with correct currency based on country
      const isIsraeli = contractForm.clientCountry === 'IL';
      const currency = isIsraeli ? 'NIS' : 'USD';
      
      // Initialize pricing tiers - use template defaults if available, otherwise use system defaults
      const pricingTiers: { [key: string]: number } = {};
      const tierStructure = [
        { key: '1', label: 'For one applicant', count: 1 },
        { key: '2', label: 'For 2 applicants', count: 2 },
        { key: '3', label: 'For 3 applicants', count: 3 },
        { key: '4-7', label: 'For 4-7 applicants', count: 4 },
        { key: '8-9', label: 'For 8-9 applicants', count: 8 },
        { key: '10-15', label: 'For 10-15 applicants', count: 10 },
        { key: '16+', label: 'For 16 applicants or more', count: 16 }
      ];
      
      // Use template default pricing tiers if available, otherwise use system defaults
      if (selectedTemplate?.default_pricing_tiers) {
        Object.assign(pricingTiers, selectedTemplate.default_pricing_tiers);
      } else {
        tierStructure.forEach(tier => {
          const priceTier = getPricePerApplicant(tier.count, isIsraeli);
          const pricePerApplicant = isIsraeli && 'priceWithVat' in priceTier ? priceTier.priceWithVat : priceTier.price;
          pricingTiers[tier.key] = pricePerApplicant;
        });
      }
      
      // Calculate initial totals
      const currentTierKey = getCurrentTierKey(contractForm.applicantCount);
      const currentPricePerApplicant = pricingTiers[currentTierKey];
      const total = currentPricePerApplicant * contractForm.applicantCount;
      const discount = 0;
      const discountAmount = 0;
      const finalAmount = total;
      
      // Calculate archivalFee before paymentPlan
      const archivalFee = archivalResearch === 'with'
        ? (contractForm.clientCountry === 'IL' ? 1650 : contractForm.clientCountry === 'US' ? 850 : 0)
        : 0;

      // Calculate due dates
      const today = new Date();
      const addDays = (days: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
      };

      let paymentPlan;
      if (archivalResearch === 'with' && archivalFee > 0) {
        // First payment: 100% of archival research fee
        // Remaining: default plan for the rest
        const restAmount = total - archivalFee;
        paymentPlan = [
          { percent: 100, due_date: addDays(0), value: archivalFee, value_vat: 0, payment_order: 'Archival Research', notes: '', currency },
        ];
        if (restAmount > 0) {
          paymentPlan = paymentPlan.concat([
            { percent: 50, due_date: addDays(0), value: Math.round(restAmount * 0.5), value_vat: 0, payment_order: 'First Service Payment', notes: '', currency },
            { percent: 25, due_date: addDays(30), value: Math.round(restAmount * 0.25), value_vat: 0, payment_order: 'Second Service Payment', notes: '', currency },
            { percent: 25, due_date: addDays(60), value: Math.round(restAmount * 0.25), value_vat: 0, payment_order: 'Final Service Payment', notes: '', currency },
          ]);
        }
      } else {
        paymentPlan = [
          { percent: 50, due_date: addDays(0), value: Math.round(finalAmount * 0.5), value_vat: 0, payment_order: 'First Payment', notes: '', currency },
          { percent: 25, due_date: addDays(30), value: Math.round(finalAmount * 0.25), value_vat: 0, payment_order: 'Second Payment', notes: '', currency },
          { percent: 25, due_date: addDays(60), value: Math.round(finalAmount * 0.25), value_vat: 0, payment_order: 'Final Payment', notes: '', currency },
        ];
      }
      
      const initialCustomPricing = {
        applicant_count: contractForm.applicantCount,
        pricing_tiers: pricingTiers,
        total_amount: total,
        discount_percentage: discount,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        payment_plan: paymentPlan,
        currency,
        archival_research_fee: archivalFee,
      };

      // Create contract data with contact association
      const contractData = {
        client_id: client.id,
        template_id: contractForm.selectedTemplateId,
        status: 'draft',
        contact_id: contractForm.contactId, // Associate with specific contact
        contact_name: contactName, // Save the actual contact name
        contact_email: contactEmail, // Save contact email
        contact_phone: contactPhone, // Save contact phone
        contact_mobile: contactMobile, // Save contact mobile
        applicant_count: contractForm.applicantCount,
        client_country: contractForm.clientCountry,
        custom_pricing: initialCustomPricing, // Save initial customPricing with correct currency
      };
      console.log('handleCreateContract: Inserting contract data:', contractData);
      
      // Create the contract record
      const { data: contract, error } = await supabase
        .from('contracts')
        .insert([contractData])
        .select()
        .single();

      console.log('handleCreateContract: Insert result:', { contract, error });

      if (error) throw error;

      // Assign the contract to the specific contact
      setContactContracts(prev => ({ 
        ...prev, 
        [contractForm.contactId!]: { 
          id: contract.id, 
          name: contractTemplates.find(t => t.id === contractForm.selectedTemplateId)?.name || 'Contract',
          status: 'draft',
          signed_at: undefined
        } 
      }));

      setShowContractCreation(false);
      setContractForm({
        applicantCount: 1,
        clientCountry: 'IL',
        selectedTemplateId: '',
        contactId: null,
      });

      // Automatically navigate to the contract page
      if (contract && client.lead_number) {
        navigate(`/clients/${client.lead_number}/contract?contractId=${contract.id}`);
      }
    } catch (error) {
      console.error('Error creating contract:', error);
      alert('Failed to create contract. Please try again.');
    }
  };

  // Handle contract signing (for testing/development)
  const handleDeleteContract = async (contractId: string) => {
    try {
      console.log('handleDeleteContract called with contractId:', contractId);
      
      // Delete the contract from the database
      const { error } = await supabase
        .from('contracts')
        .delete()
        .eq('id', contractId);

      if (error) throw error;

      console.log('Contract deleted successfully');

      // Update the local state to remove the contract
      setContactContracts(prev => {
        const updated = { ...prev };
        // Find and remove the contract from the contactContracts
        Object.keys(updated).forEach(contactId => {
          if (updated[Number(contactId)]?.id === contractId) {
            updated[Number(contactId)] = null;
          }
        });
        return updated;
      });

      alert('Contract deleted successfully');

    } catch (error) {
      console.error('Error deleting contract:', error);
      alert('Failed to delete contract. Please try again.');
    }
  };

  const handleSignContract = async (contractId: string) => {
    try {
      console.log('handleSignContract called with contractId:', contractId);
      
      // First, get the current contract data
      const { data: currentContract, error: fetchError } = await supabase
        .from('contracts')
        .select('*')
        .eq('id', contractId)
        .single();

      if (fetchError) {
        console.error('Error fetching contract:', fetchError);
        throw fetchError;
      }

      console.log('Current contract data:', currentContract);

      // Update contract status to signed
      const { data: contract, error } = await supabase
        .from('contracts')
        .update({ 
          status: 'signed',
          signed_at: new Date().toISOString()
        })
        .eq('id', contractId)
        .select()
        .single();

      if (error) throw error;

      console.log('Contract updated to signed:', contract);

      // Trigger the automation
      console.log('Calling handleContractSigned with contract:', contract);
      await handleContractSigned(contract);

      console.log('Contract signing automation completed successfully');
      alert('Contract signed! Payment plan and proforma have been automatically generated.');

    } catch (error) {
      console.error('Error signing contract:', error);
      alert('Failed to sign contract. Please try again.');
    }
  };

  const handleViewContract = async (contractId?: string) => {
    if (client.lead_number) {
      if (contractId) {
        // Navigate to specific contract
        navigate(`/clients/${client.lead_number}/contract?contractId=${contractId}`);
      } else {
        // Navigate to most recent contract
        navigate(`/clients/${client.lead_number}/contract`);
      }
    } else if (contractId) {
      // Fetch lead_number from Supabase using the contract
      const { data, error } = await supabase
        .from('contracts')
        .select('client_id')
        .eq('id', contractId)
        .single();
      if (data && data.client_id) {
        const { data: leadData, error: leadError } = await supabase
          .from('leads')
          .select('lead_number')
          .eq('id', data.client_id)
          .single();
        if (leadData && leadData.lead_number) {
          navigate(`/clients/${leadData.lead_number}/contract?contractId=${contractId}`);
        } else {
          alert('Lead number not found for this contract.');
        }
      } else {
        alert('Contract not found.');
      }
    } else if (mostRecentContract && mostRecentContract.client_id) {
      // Fallback to most recent contract
      const { data, error } = await supabase
        .from('leads')
        .select('lead_number')
        .eq('id', mostRecentContract.client_id)
        .single();
      if (data && data.lead_number) {
        navigate(`/clients/${data.lead_number}/contract`);
      } else {
        alert('Lead number not found for this contract.');
      }
    } else {
      alert('No contract found for this client.');
    }
  };

  return (
    <Fragment>
      <div className="w-full overflow-x-hidden">
        <div className="p-2 sm:p-4 md:p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-blue-100 rounded-lg">
              <UserIcon className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Contact Information</h2>
              <p className="text-sm text-gray-500">Manage client contacts and contracts</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 w-full pb-6">
            {contacts.map((contact, index) => {
              return (
                <div
                  key={contact.id}
                  className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden"
                >
                  {/* Header */}
                  <div className="pl-6 pt-2 pb-2 w-2/5 bg-[#3b28c7] rounded-tr-2xl rounded-br-2xl">
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg font-semibold text-white">
                        {contact.isMain ? 'Primary Contact' : `Contact ${index}`}
                      </h4>
                      {contact.isMain && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white text-[#3b28c7]">
                          Main
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-6">
                    <div className="space-y-0">
                      {/* Name */}
                      <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Name</label>
                        <div className="flex-1 ml-4">
                          {contact.isMain && isEditingMainContact ? (
                            <input
                              type="text"
                              placeholder="Enter name"
                              className="input input-bordered w-full"
                              value={editedMainContact.name}
                              onChange={(e) => setEditedMainContact({ ...editedMainContact, name: e.target.value })}
                            />
                          ) : contact.isEditing ? (
                            <input
                              type="text"
                              placeholder="Enter name"
                              className="input input-bordered w-full"
                              value={contact.name}
                              onChange={(e) => setContacts(contacts.map(c => c.id === contact.id ? { ...c, name: e.target.value } : c))}
                            />
                          ) : (
                            <div className="text-base font-semibold text-gray-900 text-right">{contact.name}</div>
                          )}
                        </div>
                      </div>

                      {/* Mobile */}
                      <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Mobile</label>
                        <div className="flex-1 ml-4">
                          {contact.isMain && isEditingMainContact ? (
                            <div className="flex gap-2">
                              <select
                                className="select select-bordered w-24"
                                value={parsePhoneNumber(editedMainContact.mobile).countryCode}
                                onChange={(e) => {
                                  const { number } = parsePhoneNumber(editedMainContact.mobile);
                                  setEditedMainContact({
                                    ...editedMainContact,
                                    mobile: formatPhoneNumber(e.target.value, number)
                                  });
                                }}
                              >
                                {countryCodes.map((code) => (
                                  <option key={code.code} value={code.code}>
                                    {code.code}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="tel"
                                placeholder="Enter mobile"
                                className="input input-bordered flex-1"
                                value={parsePhoneNumber(editedMainContact.mobile).number}
                                onChange={(e) => {
                                  const { countryCode } = parsePhoneNumber(editedMainContact.mobile);
                                  setEditedMainContact({
                                    ...editedMainContact,
                                    mobile: formatPhoneNumber(countryCode, e.target.value)
                                  });
                                }}
                              />
                            </div>
                          ) : contact.isEditing ? (
                            <div className="flex gap-2">
                              <select
                                className="select select-bordered w-24"
                                value={parsePhoneNumber(contact.mobile).countryCode}
                                onChange={(e) => {
                                  const { number } = parsePhoneNumber(contact.mobile);
                                  setContacts(contacts.map(c => c.id === contact.id ? {
                                    ...c,
                                    mobile: formatPhoneNumber(e.target.value, number)
                                  } : c));
                                }}
                              >
                                {countryCodes.map((code) => (
                                  <option key={code.code} value={code.code}>
                                    {code.code}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="tel"
                                placeholder="Enter mobile"
                                className="input input-bordered flex-1"
                                value={parsePhoneNumber(contact.mobile).number}
                                onChange={(e) => {
                                  const { countryCode } = parsePhoneNumber(contact.mobile);
                                  setContacts(contacts.map(c => c.id === contact.id ? {
                                    ...c,
                                    mobile: formatPhoneNumber(countryCode, e.target.value)
                                  } : c));
                                }}
                              />
                            </div>
                          ) : (
                            <div className="text-base text-gray-900 flex items-center justify-end gap-2">
                              <PhoneIcon className="w-4 h-4 text-gray-400" />
                              <span className="text-base font-medium">{contact.mobile}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Phone */}
                      <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Phone</label>
                        <div className="flex-1 ml-4">
                          {contact.isMain && isEditingMainContact ? (
                            <div className="flex gap-2">
                              <select
                                className="select select-bordered w-24"
                                value={parsePhoneNumber(editedMainContact.phone).countryCode}
                                onChange={(e) => {
                                  const { number } = parsePhoneNumber(editedMainContact.phone);
                                  setEditedMainContact({
                                    ...editedMainContact,
                                    phone: formatPhoneNumber(e.target.value, number)
                                  });
                                }}
                              >
                                {countryCodes.map((code) => (
                                  <option key={code.code} value={code.code}>
                                    {code.code}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="tel"
                                placeholder="Enter phone"
                                className="input input-bordered flex-1"
                                value={parsePhoneNumber(editedMainContact.phone).number}
                                onChange={(e) => {
                                  const { countryCode } = parsePhoneNumber(editedMainContact.phone);
                                  setEditedMainContact({
                                    ...editedMainContact,
                                    phone: formatPhoneNumber(countryCode, e.target.value)
                                  });
                                }}
                              />
                            </div>
                          ) : contact.isEditing ? (
                            <div className="flex gap-2">
                              <select
                                className="select select-bordered w-24"
                                value={parsePhoneNumber(contact.phone).countryCode}
                                onChange={(e) => {
                                  const { number } = parsePhoneNumber(contact.phone);
                                  setContacts(contacts.map(c => c.id === contact.id ? {
                                    ...c,
                                    phone: formatPhoneNumber(e.target.value, number)
                                  } : c));
                                }}
                              >
                                {countryCodes.map((code) => (
                                  <option key={code.code} value={code.code}>
                                    {code.code}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="tel"
                                placeholder="Enter phone"
                                className="input input-bordered flex-1"
                                value={parsePhoneNumber(contact.phone).number}
                                onChange={(e) => {
                                  const { countryCode } = parsePhoneNumber(contact.phone);
                                  setContacts(contacts.map(c => c.id === contact.id ? {
                                    ...c,
                                    phone: formatPhoneNumber(countryCode, e.target.value)
                                  } : c));
                                }}
                              />
                            </div>
                          ) : contact.phone && contact.phone !== '---' ? (
                            <a href={`tel:${contact.phone}`} className="text-base text-gray-900 hover:text-purple-600 flex items-center justify-end gap-2 transition-colors">
                              <PhoneIcon className="w-4 h-4 text-gray-400" />
                              <span className="text-base font-medium">{contact.phone}</span>
                            </a>
                          ) : (
                            <div className="text-base text-gray-900 flex items-center justify-end gap-2">
                              <PhoneIcon className="w-4 h-4 text-gray-400" />
                              <span className="text-base font-medium">{contact.phone}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Email */}
                      <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Email</label>
                        <div className="flex-1 ml-4">
                          {contact.isMain && isEditingMainContact ? (
                            <input
                              type="email"
                              placeholder="Enter email"
                              className="input input-bordered w-full"
                              value={editedMainContact.email}
                              onChange={(e) => setEditedMainContact({ ...editedMainContact, email: e.target.value })}
                            />
                          ) : contact.isEditing ? (
                            <input
                              type="email"
                              placeholder="Enter email"
                              className="input input-bordered w-full"
                              value={contact.email}
                              onChange={(e) => setContacts(contacts.map(c => c.id === contact.id ? { ...c, email: e.target.value } : c))}
                            />
                          ) : contact.email && contact.email !== '---' ? (
                            <a href={`mailto:${contact.email}`} className="text-base text-gray-900 hover:text-purple-600 flex items-center justify-end gap-2 transition-colors">
                              <EnvelopeIcon className="w-4 h-4 text-gray-400" />
                              <span className="text-base font-medium">{contact.email}</span>
                            </a>
                          ) : (
                            <div className="text-base text-gray-900 flex items-center justify-end gap-2">
                              <EnvelopeIcon className="w-4 h-4 text-gray-400" />
                              <span className="text-base font-medium">{contact.email}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Contract */}
                      <div className="flex items-center justify-between py-3">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Contract</label>
                        <div className="flex-1 ml-4">
                          {contactContracts[contact.id] ? (
                            <div className="flex flex-col gap-2 items-end">
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-sm font-medium text-gray-700">
                                  {contactContracts[contact.id]?.name}
                                </span>
                                <span className={`badge badge-sm ${
                                  contactContracts[contact.id]?.status === 'signed' ? 'badge-success' : 'badge-warning'
                                }`}>
                                  {contactContracts[contact.id]?.status}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  className="btn btn-outline btn-primary btn-sm justify-start w-auto min-w-0 px-2 self-start" 
                                  onClick={() => handleViewContract(contactContracts[contact.id]?.id)}
                                >
                                  <DocumentTextIcon className="w-4 h-4" />
                                  View Contract
                                </button>
                                {contactContracts[contact.id]?.status === 'draft' && (
                                  <button 
                                    className="btn btn-outline btn-primary btn-sm justify-start w-auto min-w-0 px-2 self-start" 
                                    onClick={() => {
                                      if (window.confirm('Are you sure you want to delete this contract? This action cannot be undone.')) {
                                        handleDeleteContract(contactContracts[contact.id]?.id!);
                                      }
                                    }}
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                    Delete Contract
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <button 
                              className="btn btn-outline btn-primary btn-sm justify-start" 
                              onClick={() => {
                                setContractForm(prev => ({ ...prev, contactId: contact.id }));
                                setShowContractCreation(true);
                              }}
                            >
                              <PlusIcon className="w-4 h-4" />
                              Create Contract
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                    <div className="flex gap-2">
                      {(contact.isMain && !isEditingMainContact) || (!contact.isMain && !contact.isEditing) ? (
                        <button
                          className="btn btn-ghost btn-sm bg-transparent hover:bg-transparent shadow-none"
                          onClick={() => contact.isMain ? setIsEditingMainContact(true) : setContacts(contacts.map(c => c.id === contact.id ? { ...c, isEditing: true } : c))}
                        >
                          <PencilSquareIcon className="w-4 h-4 text-white" />
                          Edit
                        </button>
                      ) : null}
                      {((contact.isMain && isEditingMainContact) || contact.isEditing) && (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => contact.isMain ? handleSaveMainContact() : handleSaveContact(contact.id, contact)}
                          >
                            <CheckIcon className="w-4 h-4" />
                            Save
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => contact.isMain ? handleCancelMainContact() : handleCancelContact(contact)}
                          >
                            <XMarkIcon className="w-4 h-4" />
                            Cancel
                          </button>
                        </>
                      )}
                      {!contact.isMain && (
                        <button
                          className="btn btn-ghost btn-sm text-red-500 hover:text-red-600 ml-auto"
                          onClick={() => {
                            if (window.confirm('Are you sure you want to delete this contact?')) {
                              handleDeleteContact(contact.id);
                            }
                          }}
                        >
                          <TrashIcon className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            
            {/* Add New Contact Card */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden border-dashed border-gray-300">
              <div className="p-6">
                <div className="flex flex-col items-center justify-center py-8">
                  {/* Removed plus icon and circle */}
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Add New Contact</h3>
                  <p className="text-sm text-gray-500 text-center mb-4">
                    Create additional contacts for this client
                  </p>
                  <button
                    className="btn btn-primary btn-outline"
                    onClick={handleCreateNewContact}
                  >
                    <PlusIcon className="w-4 h-4 mr-2" />
                    Add Contact
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <TimelineHistoryButtons client={client} />
      </div>
      


      {/* Contract Creation Modal */}
      {showContractCreation && typeof window !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300 z-[9999]" onClick={() => setShowContractCreation(false)} />
          <div className="fixed top-0 right-0 h-screen w-full max-w-md bg-white shadow-2xl p-8 flex flex-col animate-slideInRight z-[10000]" style={{ minHeight: '100vh' }}>
            <button className="btn btn-ghost btn-circle absolute top-4 right-4" onClick={() => setShowContractCreation(false)}>
              <XMarkIcon className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold mb-2">Create Contract</h2>
            {contractForm.contactId && (
              <p className="text-sm text-gray-600 mb-6">
                For: {contacts.find(c => c.id === contractForm.contactId)?.name || 'Unknown Contact'}
              </p>
            )}
            
            <div className="flex-1 space-y-6">
              {/* Applicant Count */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Number of Applicants</label>
                <select
                  className="select select-bordered w-full"
                  value={contractForm.applicantCount}
                  onChange={(e) => setContractForm(prev => ({ ...prev, applicantCount: parseInt(e.target.value) }))}
                >
                  {Array.from({ length: 20 }, (_, i) => i + 1).map(num => (
                    <option key={num} value={num}>{num} {num === 1 ? 'applicant' : 'applicants'}</option>
                  ))}
                </select>
              </div>

              {/* Client Country */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Client Country</label>
                <select
                  className="select select-bordered w-full"
                  value={contractForm.clientCountry}
                  onChange={(e) => setContractForm(prev => ({ ...prev, clientCountry: e.target.value }))}
                >
                  <option value="IL">Israel (NIS + VAT)</option>
                  <option value="US">United States (USD)</option>
                  <option value="OTHER">Other Countries (USD)</option>
                </select>
              </div>

              {/* Price Preview */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3">Price Preview</h3>
                {(() => {
                  if (!contractForm.selectedTemplateId) {
                    // No template selected: show zeroes
                    const currency = contractForm.clientCountry === 'IL' ? 'NIS' : 'USD';
                    return (
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Per applicant:</span>
                          <span className="font-semibold">{currency} 0</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Total ({contractForm.applicantCount} applicants):</span>
                          <span className="font-bold text-lg text-primary">{currency} 0</span>
                        </div>
                      </div>
                    );
                  }
                  // Template selected: use its pricing tiers if available
                  const selectedTemplate = contractTemplates.find(t => t.id === contractForm.selectedTemplateId);
                  const isIsraeli = contractForm.clientCountry === 'IL';
                  let perApplicant = 0;
                  let currency = isIsraeli ? 'NIS' : 'USD';
                  if (selectedTemplate?.default_currency) {
                    currency = selectedTemplate.default_currency;
                  }
                  if (selectedTemplate?.default_pricing_tiers) {
                    // Use template's pricing tiers
                    const tierKey = getCurrentTierKey(contractForm.applicantCount);
                    perApplicant = selectedTemplate.default_pricing_tiers[tierKey] || 0;
                  } else {
                    // Fallback to system pricing
                    const priceTier = getPricePerApplicant(contractForm.applicantCount, isIsraeli);
                    perApplicant = isIsraeli && 'priceWithVat' in priceTier ? priceTier.priceWithVat : priceTier.price;
                  }
                  const total = perApplicant * contractForm.applicantCount;
                  const discount = 0;
                  const discountAmount = 0;
                  const finalAmount = total;

                  // Add state for archival research option
                  const archivalFee = archivalResearch === 'with'
                    ? (contractForm.clientCountry === 'IL' ? 1650 : contractForm.clientCountry === 'US' ? 850 : 0)
                    : 0;

                  // Calculate due dates
                  const today = new Date();
                  const addDays = (days: number) => {
                    const d = new Date(today);
                    d.setDate(d.getDate() + days);
                    return d.toISOString().split('T')[0];
                  };

                  let paymentPlan;
                  if (archivalResearch === 'with' && archivalFee > 0) {
                    // First payment: 100% of archival research fee
                    // Remaining: default plan for the rest
                    const restAmount = total - archivalFee;
                    paymentPlan = [
                      { percent: 100, due_date: addDays(0), value: archivalFee, value_vat: 0, payment_order: 'Archival Research', notes: '', currency },
                    ];
                    if (restAmount > 0) {
                      paymentPlan = paymentPlan.concat([
                        { percent: 50, due_date: addDays(0), value: Math.round(restAmount * 0.5), value_vat: 0, payment_order: 'First Service Payment', notes: '', currency },
                        { percent: 25, due_date: addDays(30), value: Math.round(restAmount * 0.25), value_vat: 0, payment_order: 'Second Service Payment', notes: '', currency },
                        { percent: 25, due_date: addDays(60), value: Math.round(restAmount * 0.25), value_vat: 0, payment_order: 'Final Service Payment', notes: '', currency },
                      ]);
                    }
                  } else {
                    paymentPlan = [
                      { percent: 50, due_date: addDays(0), value: Math.round(finalAmount * 0.5), value_vat: 0, payment_order: 'First Payment', notes: '', currency },
                      { percent: 25, due_date: addDays(30), value: Math.round(finalAmount * 0.25), value_vat: 0, payment_order: 'Second Payment', notes: '', currency },
                      { percent: 25, due_date: addDays(60), value: Math.round(finalAmount * 0.25), value_vat: 0, payment_order: 'Final Payment', notes: '', currency },
                    ];
                  }
                  
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Per applicant:</span>
                        <span className="font-semibold">{currency} {perApplicant.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total ({contractForm.applicantCount} applicants):</span>
                        <span className="font-bold text-lg text-primary">{currency} {total.toLocaleString()}</span>
                      </div>
                      {archivalResearch === 'with' && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Archival Research:</span>
                          <span className="font-semibold">{contractForm.clientCountry === 'IL' ? 'NIS' : 'USD'} {archivalFee.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Template Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Contract Template</label>
                <select
                  className="select select-bordered w-full"
                  value={contractForm.selectedTemplateId}
                  onChange={(e) => setContractForm(prev => ({ ...prev, selectedTemplateId: e.target.value }))}
                >
                  <option value="">Select a template</option>
                  {contractTemplates.map(template => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </div>

              {/* Archival Research Option */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Archival Research</label>
                <select
                  className="select select-bordered w-full"
                  value={archivalResearch}
                  onChange={e => setArchivalResearch(e.target.value as any)}
                >
                  <option value="none">Without archival research</option>
                  <option value="with">With archival research</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-6">
              <button
                className="btn btn-primary flex-1"
                onClick={handleCreateContract}
                disabled={!contractForm.selectedTemplateId}
              >
                Create Contract
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setShowContractCreation(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </Fragment>
  );
};

export default ContactInfoTab; 