import React, { useState, useEffect, Fragment, useMemo, useRef } from 'react';
import { ClientTabProps } from '../../types/client';
import { UserIcon, PhoneIcon, EnvelopeIcon, PlusIcon, DocumentTextIcon, XMarkIcon, PencilSquareIcon, CheckIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { createPortal } from 'react-dom';
import SignaturePad from 'react-signature-canvas';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { handleContractSigned } from '../../lib/contractAutomation';
import { getPricePerApplicant } from '../../lib/contractPricing';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { FontSize } from '@tiptap/extension-font-size';

// Function to clean HTML content and make it readable
const cleanHtmlContent = (html: string): string => {
  if (!html) return '';
  
  // Create a temporary div to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  // Get text content and clean it up
  let text = tempDiv.textContent || tempDiv.innerText || '';
  
  // Clean up common HTML artifacts and formatting
  text = text
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/\n\s*\n/g, '\n\n') // Replace multiple newlines with double newlines
    .replace(/^\s+|\s+$/g, '') // Trim whitespace
    .replace(/{{text}}/g, '_____________') // Replace placeholders with underscores
    .replace(/{{sig}}/g, '_____________') // Replace signature placeholder
    .replace(/{{date}}/g, '_____________') // Replace date placeholder
    .replace(/{{client_name}}/g, '_____________') // Replace client name placeholder
    .replace(/{{price_per_applicant}}/g, '_____________') // Replace price placeholder
    .replace(/{{payment_plan_row}}/g, '_____________') // Replace payment plan placeholder
    .replace(/\s*:\s*/g, ': ') // Clean up colons
    .replace(/\s*\.\s*/g, '. ') // Clean up periods
    .replace(/\s*,\s*/g, ', ') // Clean up commas
    .replace(/\s*\(\s*/g, ' (') // Clean up opening parentheses
    .replace(/\s*\)\s*/g, ') ') // Clean up closing parentheses
    .replace(/\s*-\s*/g, ' - ') // Clean up dashes
    .replace(/\s*;\s*/g, '; ') // Clean up semicolons
    .replace(/\s*\n\s*/g, '\n') // Clean up newlines
    .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines to 2
    .trim();
  
  return text;
};

// Helper function to process HTML for editing with consistent styling
const processHtmlForEditing = (html: string): string => {
  if (!html) return '';
  
  // Replace placeholders with styled input fields and signature pads
  let processed = html
    .replace(/\{\{text\}\}/g, '<input type="text" class="inline-input" style="border: 2px solid #3b82f6; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; font-family: inherit; font-size: 14px; background: #ffffff; color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.1);" placeholder="Enter text..." />')
    .replace(/\{\{sig\}\}/g, '<div class="signature-pad" style="display: inline-block; border: 2px dashed #3b82f6; border-radius: 6px; padding: 12px; margin: 0 4px; min-width: 180px; min-height: 50px; background: #f8fafc; cursor: pointer; text-align: center; font-size: 14px; color: #6b7280; font-weight: 500;">Click to sign</div>');
  
  return processed;
};

// Helper function to process signed contract HTML for display (replaces placeholders with filled values)
const processSignedContractHtml = (html: string): string => {
  if (!html) return '';
  
  console.log('🔍 Processing signed contract HTML:', html.substring(0, 500) + '...');
  
  let processed = html;
  
  // First, handle base64 signature data (data:image/png;base64,...) - do this before replacing placeholders
  processed = processed.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, (match) => {
    console.log('🔍 Found base64 signature data, length:', match.length);
    return `<img src="${match}" style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px; margin: 0 4px; background-color: #f0fdf4; max-width: 200px; max-height: 80px; object-fit: contain;" alt="Signature" />`;
  });
  
  // Replace {{text}} placeholders with styled filled text
  processed = processed.replace(/\{\{text\}\}/g, '<span style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; background-color: #f0fdf4; color: #065f46; font-weight: bold;">_____________</span>');
  
  // Replace {{sig}} placeholders with signature image display (only if not already replaced by base64)
  processed = processed.replace(/\{\{sig\}\}/g, '<div style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px; margin: 0 4px; background-color: #f0fdf4; min-width: 200px; min-height: 80px; display: flex; align-items: center; justify-content: center;"><span style="color: #065f46; font-size: 12px;">✓ Signed</span></div>');
  
  console.log('🔍 Processed HTML result:', processed.substring(0, 500) + '...');
  
  return processed;
};

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
  country_id?: number | null;
  isMain?: boolean;
  isEditing?: boolean;
}

interface ContractTemplate {
  id: string;
  name: string;
  content: any;
  default_pricing_tiers?: { [key: string]: number }; // Legacy
  default_pricing_tiers_usd?: { [key: string]: number }; // USD/GBP/EUR pricing tiers
  default_pricing_tiers_nis?: { [key: string]: number }; // NIS pricing tiers
  default_currency?: string;
  default_country?: string;
  sourceTable?: 'contract_templates' | 'misc_contracttemplate'; // Track which table template came from
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
    email: client.email || '',
    country_id: null as number | null
  });


  const [contactContracts, setContactContracts] = useState<{ [id: number]: { id: string; name: string; status: string; signed_at?: string; isLegacy?: boolean; contractHtml?: string; signedContractHtml?: string } | null }>({});
  const [contractTemplates, setContractTemplates] = useState<ContractTemplate[]>([]);
  const [viewingContract, setViewingContract] = useState<{ id: string; mode: 'view' | 'edit'; contractHtml?: string; signedContractHtml?: string; status?: string; public_token?: string } | null>(null);

  // State for 'View as Client' mode in contract modal
  const [viewAsClient, setViewAsClient] = useState(false);
  const [signaturePads, setSignaturePads] = useState<{ [key: string]: any }>({});

  // New state for contract creation with applicant count and currency
  const [showContractCreation, setShowContractCreation] = useState(false);
  const [contractForm, setContractForm] = useState({
    applicantCount: 1,
    selectedCurrency: null as {id: string, front_name: string, iso_code: string, name: string} | null,
    selectedTemplateId: '',
    contactId: null as number | null,
  });
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);

  // State to track contract status
  const [contractStatuses, setContractStatuses] = useState<{ [id: string]: { status: string; signed_at?: string } }>({});

  // Add state for most recent contract (for backward compatibility)
  const [mostRecentContract, setMostRecentContract] = useState<any>(null);

  // Add state for archival research option
  const [archivalResearch, setArchivalResearch] = useState<'none' | 'with'>('none');
  // Add state for VAT inclusion
  const [includeVAT, setIncludeVAT] = useState<boolean>(false);

  // Add state for currencies from database
  const [currencies, setCurrencies] = useState<Array<{id: string, front_name: string, iso_code: string, name: string}>>([]);

  // Add country codes data from database (matching CreateNewLead structure)
  const [countryOptions, setCountryOptions] = useState<Array<{ id: number; name: string; phone_code: string; iso_code: string }>>([
    { id: 0, name: 'Israel', phone_code: '+972', iso_code: 'IL' } // Default fallback
  ]);
  
  // State for country code search (for main contact mobile)
  const [mainContactMobileCodeSearchTerm, setMainContactMobileCodeSearchTerm] = useState<string>('');
  const [showMainContactMobileCodeDropdown, setShowMainContactMobileCodeDropdown] = useState<boolean>(false);
  const mainContactMobileCodeInputRef = useRef<HTMLDivElement>(null);
  const [selectedMainContactMobileCode, setSelectedMainContactMobileCode] = useState<string>('+972');
  
  // State for country code search (for main contact phone)
  const [mainContactPhoneCodeSearchTerm, setMainContactPhoneCodeSearchTerm] = useState<string>('');
  const [showMainContactPhoneCodeDropdown, setShowMainContactPhoneCodeDropdown] = useState<boolean>(false);
  const mainContactPhoneCodeInputRef = useRef<HTMLDivElement>(null);
  const [selectedMainContactPhoneCode, setSelectedMainContactPhoneCode] = useState<string>('+972');
  
  // State for country code search (for regular contacts mobile - keyed by contact ID)
  const [contactMobileCodeSearchTerms, setContactMobileCodeSearchTerms] = useState<{ [key: number]: string }>({});
  const [showContactMobileCodeDropdowns, setShowContactMobileCodeDropdowns] = useState<{ [key: number]: boolean }>({});
  const contactMobileCodeInputRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  const [selectedContactMobileCodes, setSelectedContactMobileCodes] = useState<{ [key: number]: string }>({});
  
  // State for country code search (for regular contacts phone - keyed by contact ID)
  const [contactPhoneCodeSearchTerms, setContactPhoneCodeSearchTerms] = useState<{ [key: number]: string }>({});
  const [showContactPhoneCodeDropdowns, setShowContactPhoneCodeDropdowns] = useState<{ [key: number]: boolean }>({});
  const contactPhoneCodeInputRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  const [selectedContactPhoneCodes, setSelectedContactPhoneCodes] = useState<{ [key: number]: string }>({});

  // Add state for countries from database (for country dropdown)
  const [countries, setCountries] = useState<Array<{ id: number; name: string; iso_code: string | null }>>([]);
  
  // State for country search (for main contact)
  const [mainContactCountrySearchTerm, setMainContactCountrySearchTerm] = useState<string>('');
  const [showMainContactCountryDropdown, setShowMainContactCountryDropdown] = useState<boolean>(false);
  const mainContactCountryInputRef = useRef<HTMLDivElement>(null);
  
  // State for country search (for regular contacts - keyed by contact ID)
  const [contactCountrySearchTerms, setContactCountrySearchTerms] = useState<{ [key: number]: string }>({});
  const [showContactCountryDropdowns, setShowContactCountryDropdowns] = useState<{ [key: number]: boolean }>({});
  const contactCountryInputRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // TipTap editor setup for legacy contract editing
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Edit contract...' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight,
      Color,
      TextStyle,
      FontFamily,
      FontSize,
    ],
    content: { type: 'doc', content: [] },
    editable: false,
    parseOptions: {
      preserveWhitespace: 'full',
    },
  });

  // State for client inputs (text fields and signatures)
  const [clientInputs, setClientInputs] = useState<{ [key: string]: string }>({});

  // Global function for clearing signatures (needed for onclick handlers)
  React.useEffect(() => {
    (window as any).clearSignature = (id: string) => {
      setClientInputs(prev => ({ ...prev, [id]: '' }));
    };
  }, []);

  // Helper function to execute commands on the contentEditable div
  const executeCommand = (command: string, value?: string) => {
    const contentDiv = document.querySelector('[contenteditable="true"]');
    if (contentDiv) {
      (contentDiv as HTMLElement).focus();
      document.execCommand(command, false, value);
    }
  };

  // Effect to handle signature pad clicks and input field interactions
  useEffect(() => {
    if (viewingContract && viewingContract.mode === 'edit') {
      // Wait for the DOM to be ready
      setTimeout(() => {
        const contentDiv = document.querySelector('[contenteditable="true"]');
        if (contentDiv) {
          // Handle signature pad clicks
          const signaturePads = contentDiv.querySelectorAll('.signature-pad');
          signaturePads.forEach(pad => {
            pad.addEventListener('click', (e) => {
              e.preventDefault();
              const target = e.target as HTMLElement;
              if (target.classList.contains('signature-pad')) {
                // Replace the signature pad with a signature input
                const signatureInput = document.createElement('input');
                signatureInput.type = 'text';
                signatureInput.className = 'signature-input';
                signatureInput.placeholder = 'Enter signature...';
                target.parentNode?.replaceChild(signatureInput, target);
                signatureInput.focus();
              }
            });
          });

          // Handle input field interactions
          const inputs = contentDiv.querySelectorAll('input.inline-input');
          inputs.forEach(input => {
            input.addEventListener('input', (e) => {
              // Store the value in the input's data attribute
              (e.target as HTMLInputElement).setAttribute('data-value', (e.target as HTMLInputElement).value);
            });
          });
        }
      }, 100);
    }
  }, [viewingContract]);

  // Function to render contract content with interactive fields
  const renderContractContent = (htmlContent: string) => {
    if (!htmlContent) return null;
    
    // Split the HTML content by placeholders
    const parts = [];
    let lastIndex = 0;
    let textCounter = 1;
    let signatureCounter = 1;
    
    // Find all {{text}} and {{signature}} placeholders
    const regex = /({{text}}|{{signature}})/g;
    let match;
    
    while ((match = regex.exec(htmlContent)) !== null) {
      // Add the HTML content before the placeholder
      if (match.index > lastIndex) {
        const htmlBefore = htmlContent.slice(lastIndex, match.index);
        parts.push(
          <span 
            key={`html-${lastIndex}`}
            dangerouslySetInnerHTML={{ __html: htmlBefore }}
          />
        );
      }
      
      // Add the interactive field
      if (match[1] === '{{text}}') {
        const id = `text-${textCounter++}`;
        parts.push(
          <input
            key={id}
            className="input input-bordered input-sm mx-2 bg-white border-2 border-blue-300 focus:border-blue-500"
            placeholder="Enter text"
            style={{ minWidth: 120, display: 'inline-block' }}
            value={clientInputs[id] || ''}
            onChange={e => setClientInputs(inputs => ({ ...inputs, [id]: e.target.value }))}
          />
        );
      } else if (match[1] === '{{signature}}') {
        const id = `signature-${signatureCounter++}`;
        parts.push(
          <div
            key={id}
            className="inline-block mx-2 align-middle"
            style={{ minWidth: 180, minHeight: 60 }}
          >
            <div className="border-2 border-blue-300 rounded-lg bg-gray-50 p-2">
              <SignaturePad
                ref={ref => {
                  if (ref && signaturePads) signaturePads[id] = ref;
                }}
                penColor="#4c6fff"
                backgroundColor="transparent"
                canvasProps={{
                  width: 160,
                  height: 50,
                  style: {
                    display: 'block',
                    borderRadius: 4,
                    background: 'transparent',
                  },
                }}
                onEnd={() => {
                  if (signaturePads && signaturePads[id]) {
                    const dataUrl = signaturePads[id].getTrimmedCanvas().toDataURL('image/png');
                    setClientInputs(inputs => ({ ...inputs, [id]: dataUrl }));
                  }
                }}
              />
              <div className="flex justify-between items-center mt-1">
                <div className="text-xs text-gray-500 font-medium">Sign here</div>
                <button
                  className="btn btn-xs btn-ghost text-red-500"
                  onClick={() => {
                    if (signaturePads && signaturePads[id]) {
                      signaturePads[id].clear();
                      setClientInputs(inputs => ({ ...inputs, [id]: '' }));
                    }
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        );
      }
      
      lastIndex = match.index + match[1].length;
    }
    
    // Add any remaining HTML content
    if (lastIndex < htmlContent.length) {
      const htmlAfter = htmlContent.slice(lastIndex);
      parts.push(
        <span 
          key={`html-${lastIndex}`}
          dangerouslySetInnerHTML={{ __html: htmlAfter }}
        />
      );
    }
    
    return parts;
  };

  // Helper function to extract country code and number from full phone number

  // Helper function to extract country code and number from full phone number
  const parsePhoneNumber = (fullNumber: string | undefined | null) => {
    // Handle null, undefined, or empty values
    if (!fullNumber || fullNumber === '---' || fullNumber === null || fullNumber === undefined || fullNumber.trim() === '') {
      return { countryCode: '+972', number: '' };
    }
    
    // Trim the input to remove any extra spaces
    const trimmed = fullNumber.trim();
    
    // Find matching country code
    const matchedCode = countryOptions.find(country => trimmed.startsWith(country.phone_code));
    if (matchedCode) {
      return {
        countryCode: matchedCode.phone_code,
        number: trimmed.substring(matchedCode.phone_code.length)
      };
    }
    
    // Default to Israel if no match found
    return { countryCode: '+972', number: trimmed };
  };

  // Helper function to format phone number for display
  const formatPhoneNumber = (countryCode: string, number: string) => {
    if (!number || number.trim() === '') return '';
    return `${countryCode}${number}`;
  };

  // Get main contact ID for dependency tracking
  const mainContactId = useMemo(() => {
    const mainContact = contacts.find(c => c.isMain);
    return mainContact?.id ?? null;
  }, [contacts]);

  // Fetch contracts for each contact
  useEffect(() => {
    if (!client?.id || contacts.length === 0) return;
    let mounted = true;
    (async () => {
      try {
        console.log('🔍 Fetching contracts for client:', client.id, 'main contact ID:', mainContactId);
        
        // Check if this is a legacy lead
        const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
        console.log('🔍 Is legacy lead:', isLegacyLead);
        
        if (isLegacyLead) {
          // For legacy leads, fetch contracts from lead_leadcontact table
          const legacyId = client.id.toString().replace('legacy_', '');
          console.log('🔍 Legacy ID:', legacyId);
          
          // Fetch legacy contracts from lead_leadcontact table
          const { data: legacyContracts, error: legacyError } = await supabase
            .from('lead_leadcontact')
            .select(`
              id,
              contact_id,
              lead_id,
              contract_html,
              signed_contract_html,
              main
            `)
            .eq('lead_id', legacyId);
          
          console.log('🔍 Legacy contracts query result:', { data: legacyContracts, error: legacyError });
          
          if (legacyError) {
            console.error('❌ Error fetching legacy contracts:', legacyError);
          }
          
          // Fetch new contracts from contracts table
          const { data: newContracts, error: newError } = await supabase
            .from('contracts')
            .select('*')
            .eq('legacy_id', legacyId)
            .order('created_at', { ascending: false });
          
          console.log('🔍 New contracts query result:', { data: newContracts, error: newError });
          
          if (newError) {
            console.error('❌ Error fetching new contracts for legacy lead:', newError);
          }
          
          if (mounted) {
            // Group contracts by contact_id for legacy leads
            const contactContractsMap: { [id: number]: { id: string; name: string; status: string; signed_at?: string; isLegacy?: boolean; contractHtml?: string; signedContractHtml?: string } | null } = {};
            
            // Initialize all contacts with no contract
            contacts.forEach(contact => {
              contactContractsMap[contact.id] = null;
            });
            
            // Find the main contact
            const mainContact = contacts.find(c => c.isMain);
            
            // Assign ALL legacy contracts to the main contact (regardless of which contact they're associated with)
            if (legacyContracts && mainContact) {
              console.log('🔍 Processing legacy contracts:', legacyContracts);
              legacyContracts.forEach((legacyContract: any) => {
                console.log('🔍 Processing legacy contract:', legacyContract);
                // Assign to main contact regardless of contact_id - if contract exists in any state, show it
                const hasContractHtml = legacyContract.contract_html && legacyContract.contract_html.trim() !== '';
                const hasSignedContract = legacyContract.signed_contract_html && 
                  legacyContract.signed_contract_html.trim() !== '' && 
                  legacyContract.signed_contract_html !== '\\N';
                
                console.log('🔍 Contract status check:', { hasContractHtml, hasSignedContract, signedContractHtml: legacyContract.signed_contract_html });
                
                if (hasContractHtml || hasSignedContract) {
                  const status = hasSignedContract ? 'signed' : 'draft';
                  console.log('🔍 Setting contract status to:', status);
                  
                  // Always assign to main contact, but keep the most recent/complete one if multiple exist
                  const existingContract = contactContractsMap[mainContact.id];
                  if (!existingContract || (hasSignedContract && existingContract.status !== 'signed')) {
                    contactContractsMap[mainContact.id] = {
                      id: `legacy_${legacyContract.id}`,
                      name: 'Legacy Contract',
                      status: status,
                      signed_at: hasSignedContract ? new Date().toISOString() : undefined,
                      isLegacy: true,
                      contractHtml: legacyContract.contract_html,
                      signedContractHtml: legacyContract.signed_contract_html
                    };
                    
                    console.log('🔍 Added legacy contract to main contact:', contactContractsMap[mainContact.id]);
                  }
                }
              });
            }
            
            // Assign ALL new contracts to the main contact (regardless of which contact they're associated with)
            if (newContracts && mainContact) {
              console.log('🔍 Processing new contracts:', newContracts);
              // Get the most recent contract (already ordered by created_at desc)
              if (newContracts.length > 0) {
                const contract = newContracts[0]; // Most recent contract
                contactContractsMap[mainContact.id] = {
                  id: contract.id,
                  name: contractTemplates.find(t => t.id === contract.template_id)?.name || 'Contract',
                  status: contract.status,
                  signed_at: contract.signed_at,
                  isLegacy: false
                };
                console.log('🔍 Added new contract to main contact:', contactContractsMap[mainContact.id]);
              }
            }
            
            console.log('🔍 Final contact contracts map:', contactContractsMap);
            setContactContracts(contactContractsMap);
            
            // Set most recent contract for backward compatibility
            const allContracts = [...(legacyContracts || []), ...(newContracts || [])];
            if (allContracts.length > 0) {
              setMostRecentContract(allContracts[0]);
            } else {
              setMostRecentContract(null);
            }
          }
        } else {
          // For new leads, fetch contracts from contracts table
          // Check if this is a sub-lead and also fetch contracts from master lead
          let masterLeadId: string | null = null;
          
          // Check if this is a sub-lead by checking lead_number or master_id
          const isSubLead = client.lead_number && client.lead_number.includes('/');
          
          if (isSubLead) {
            // Extract master lead number
            const masterLeadNumber = client.lead_number.split('/')[0];
            
            // Fetch master lead to get its UUID
            const { data: masterLead } = await supabase
              .from('leads')
              .select('id')
              .eq('lead_number', masterLeadNumber)
              .maybeSingle();
            
            if (masterLead?.id) {
              masterLeadId = masterLead.id;
              console.log('🔍 Sub-lead detected, master lead ID:', masterLeadId);
            }
          }
          
          // Fetch contracts for current client and master lead (if sub-lead)
          const clientIds = [client.id];
          if (masterLeadId && masterLeadId !== client.id) {
            clientIds.push(masterLeadId);
          }
          
          const { data, error } = await supabase
            .from('contracts')
            .select('*')
            .in('client_id', clientIds)
            .order('created_at', { ascending: false });
          
          if (error) throw error;
          
          if (mounted && data) {
            // Initialize all contacts with no contract
            const contactContractsMap: { [id: number]: { id: string; name: string; status: string; signed_at?: string } | null } = {};
            contacts.forEach(contact => {
              contactContractsMap[contact.id] = null;
            });
            
            // Get the most recent contract (prefer contracts from master lead if sub-lead)
            let contractToUse = null;
            if (data.length > 0) {
              // If we have multiple contracts (sub-lead with master contracts), prefer master's contracts
              if (masterLeadId) {
                const masterContracts = data.filter(c => c.client_id === masterLeadId);
                contractToUse = masterContracts.length > 0 ? masterContracts[0] : data[0];
              } else {
                contractToUse = data[0];
              }
            }
            
            // If there's a contract, assign it ONLY to the main contact
            if (contractToUse) {
              const contractInfo = {
                  id: contractToUse.id,
                  name: contractTemplates.find(t => t.id === contractToUse.template_id)?.name || 'Contract',
                  status: contractToUse.status,
                  signed_at: contractToUse.signed_at
                };
              
              // Find the main contact and assign contract only to it
              const mainContact = contacts.find(c => c.isMain);
              if (mainContact) {
                contactContractsMap[mainContact.id] = contractInfo;
              }
            }
            
            setContactContracts(contactContractsMap);
            
            // Set most recent contract for backward compatibility
            if (contractToUse) {
              setMostRecentContract(contractToUse);
            } else {
              setMostRecentContract(null);
            }
          }
        }
      } catch (error) {
        console.error('❌ Error fetching contracts:', error);
      }
    })();
    return () => { mounted = false; };
  }, [client?.id, mainContactId, contractTemplates]); // Re-fetch when main contact changes

  // Fetch country codes and countries from database
  useEffect(() => {
    const fetchCountryCodes = async () => {
      try {
        const { data: countriesData, error: countriesError } = await supabase
          .from('misc_country')
          .select('id, name, phone_code, iso_code, order')
          .not('phone_code', 'is', null)
          .order('order', { ascending: true })
          .order('name', { ascending: true });

        if (!countriesError && countriesData) {
          // Process countries: normalize phone codes, filter out NULL phone_code, and remove duplicates
          const processedCountries = countriesData
            .filter(country => country?.phone_code && country?.phone_code !== '\\N' && country?.phone_code !== null && country?.name)
              .map(country => ({
              id: country.id,
              name: country.name,
              phone_code: country.phone_code.startsWith('+') ? country.phone_code : `+${country.phone_code}`,
              iso_code: country.iso_code || ''
            }));

          // Remove duplicates by phone_code, keeping the first occurrence
          const uniqueCountriesMap = new Map<string, { id: number; name: string; phone_code: string; iso_code: string }>();
          processedCountries.forEach(country => {
            if (!uniqueCountriesMap.has(country.phone_code)) {
              uniqueCountriesMap.set(country.phone_code, country);
            }
          });

          // Ensure USA is included (check by name or iso_code)
          const usaCountry = processedCountries.find(
            c => c.name.toLowerCase().includes('united states') || 
                 c.name.toLowerCase() === 'usa' || 
                 c.name.toLowerCase() === 'us' ||
                 c.iso_code === 'US' ||
                 c.iso_code === 'USA'
          );
          
          if (usaCountry && !uniqueCountriesMap.has(usaCountry.phone_code)) {
            uniqueCountriesMap.set(usaCountry.phone_code, usaCountry);
          } else if (!usaCountry) {
            // If USA not found, add it manually
            uniqueCountriesMap.set('+1', {
              id: 0,
              name: 'United States',
              phone_code: '+1',
              iso_code: 'US'
            });
          }

          // Convert map to array and sort by phone code (matching CreateNewLead sorting)
          const uniqueCountries = Array.from(uniqueCountriesMap.values())
            .sort((a, b) => {
              // Sort ID 234 first (highest priority)
              if (a.id === 234 && b.id !== 234) return -1;
              if (b.id === 234 && a.id !== 234) return 1;
              // Sort ID 249 second
              if (a.id === 249 && b.id !== 249 && b.id !== 234) return -1;
              if (b.id === 249 && a.id !== 249 && a.id !== 234) return 1;
              // Sort ID 110 third
              if (a.id === 110 && b.id !== 110 && b.id !== 234 && b.id !== 249) return -1;
              if (b.id === 110 && a.id !== 110 && a.id !== 234 && a.id !== 249) return 1;
              // Then sort USA (+1) next
              if (a.phone_code === '+1') return -1;
              if (b.phone_code === '+1') return 1;
              // Then sort UK (+44) and South Africa (+27) after USA
              const isUK = a.name.toLowerCase().includes('united kingdom') || 
                          a.name.toLowerCase() === 'uk' || 
                          a.iso_code === 'GB' || 
                          a.iso_code === 'UK' ||
                          a.phone_code === '+44';
              const isSouthAfrica = a.name.toLowerCase().includes('south africa') || 
                                   a.iso_code === 'ZA' ||
                                   a.phone_code === '+27';
              const isBUK = b.name.toLowerCase().includes('united kingdom') || 
                           b.name.toLowerCase() === 'uk' || 
                           b.iso_code === 'GB' || 
                           b.iso_code === 'UK' ||
                           b.phone_code === '+44';
              const isBSouthAfrica = b.name.toLowerCase().includes('south africa') || 
                                    b.iso_code === 'ZA' ||
                                    b.phone_code === '+27';
              
              if (isUK && !isBUK) return -1;
              if (isBUK && !isUK) return 1;
              if (isSouthAfrica && !isBSouthAfrica) return -1;
              if (isBSouthAfrica && !isSouthAfrica) return 1;
              // Then sort by phone code
              return a.phone_code.localeCompare(b.phone_code);
            });

          setCountryOptions(uniqueCountries);
        }
      } catch (error) {
        console.error('Error fetching country codes:', error);
      }
    };

    const fetchCountries = async () => {
      try {
        const { data: countriesData, error: countriesError } = await supabase
          .from('misc_country')
          .select('id, name, iso_code')
          .order('order', { ascending: true })
          .order('name', { ascending: true });

        if (!countriesError && countriesData) {
          const processedCountries = countriesData
              .filter(country => country?.name)
              .map(country => ({
                id: country.id,
                name: country.name,
                iso_code: country.iso_code || null
            }));

          // Ensure United States is included - check if it exists
          const hasUnitedStates = processedCountries.some(
            c => c.name.toLowerCase().includes('united states') || 
                 c.name.toLowerCase() === 'usa' || 
                 c.name.toLowerCase() === 'us' ||
                 c.iso_code === 'US' ||
                 c.iso_code === 'USA'
          );

          // If United States doesn't exist, try to find it in countryCodes (which includes phone_code filter)
          if (!hasUnitedStates) {
            // Fetch countries with phone_code to find USA
            const { data: countriesWithPhoneCode } = await supabase
              .from('misc_country')
              .select('id, name, iso_code')
              .not('phone_code', 'is', null)
              .order('order', { ascending: true })
              .order('name', { ascending: true });
            
            const usaFromPhoneCode = countriesWithPhoneCode?.find(
              c => c.name.toLowerCase().includes('united states') || 
                   c.name.toLowerCase() === 'usa' || 
                   c.name.toLowerCase() === 'us' ||
                   c.iso_code === 'US' ||
                   c.iso_code === 'USA'
            );
            
            if (usaFromPhoneCode) {
              processedCountries.push({
                id: usaFromPhoneCode.id,
                name: usaFromPhoneCode.name,
                iso_code: usaFromPhoneCode.iso_code || 'US'
              });
            }
          }

          setCountries(processedCountries.sort((a, b) => a.name.localeCompare(b.name)));
        }
      } catch (error) {
        console.error('Error fetching countries:', error);
      }
    };

    fetchCountryCodes();
    fetchCountries();
  }, []);

  // Update contacts when client data changes
  useEffect(() => {
    const fetchContacts = async () => {
      console.log('🔍 Fetching contacts for client:', client?.id);
      
      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      console.log('🔍 Is legacy lead:', isLegacyLead);
      
      if (isLegacyLead) {
        // For legacy leads, fetch contacts from leads_contact and lead_leadcontact tables
        const legacyId = client.id.toString().replace('legacy_', '');
        console.log('🔍 Legacy ID for contacts:', legacyId);
        
        try {
          // Process contacts from lead_leadcontact and leads_contact tables
          const contactEntries: ContactEntry[] = [];
          
          // For legacy leads, we should NOT add the main contact from leads_lead table
          // because it's already in the leads_contact table and linked via lead_leadcontact
          // This prevents duplicate entries
          
          // Then get additional contacts from lead-contact relationships
          const { data: leadContacts, error: leadContactsError } = await supabase
            .from('lead_leadcontact')
            .select(`
              id,
              main,
              contact_id,
              lead_id
            `)
            .eq('lead_id', legacyId);
          
          console.log('🔍 Lead contacts query result:', { data: leadContacts, error: leadContactsError });
          
          if (leadContactsError) {
            console.error('❌ Error fetching legacy lead contacts:', leadContactsError);
            return;
          }
          
          if (leadContacts && leadContacts.length > 0) {
            console.log('🔍 Processing lead contacts:', leadContacts);
            
            // Get all contact IDs
            const contactIds = leadContacts.map((lc: any) => lc.contact_id).filter(Boolean);
            console.log('🔍 Contact IDs found:', contactIds);
            
            if (contactIds.length > 0) {
              // Fetch contact details from leads_contact table
              const { data: contacts, error: contactsError } = await supabase
                .from('leads_contact')
                .select('id, name, mobile, phone, email, notes, address, additional_phones, additional_emails, country_id')
                .in('id', contactIds);
              
              console.log('🔍 Contacts query result:', { data: contacts, error: contactsError });
              
              if (contactsError) {
                console.error('❌ Error fetching contact details:', contactsError);
              } else if (contacts) {
                // Map contacts to their lead-contact relationships
                let mainContactFound = false;
                
                leadContacts.forEach((leadContact: any, index: number) => {
                  console.log('🔍 Processing lead contact:', leadContact);
                  
                  const contact = contacts.find((c: any) => c.id === leadContact.contact_id);
                  if (contact) {
                    console.log('🔍 Contact details found:', contact);
                    
                    // Check if this is marked as main in the lead_leadcontact table
                    const isMarkedAsMain = leadContact.main === 'true' || leadContact.main === true || leadContact.main === 't';
                    
                    // Only mark as main if it's explicitly marked as main AND no main contact has been found yet
                    const isMainContact = isMarkedAsMain && !mainContactFound;
                    
                    if (isMainContact) {
                      mainContactFound = true;
                    }
                    
                    // Create contact entry with complete information from leads_contact table
                    // Only use client data as fallback if the contact field is truly empty
                    const contactEntry: ContactEntry = {
                      id: contact.id, // Use the actual contact ID from leads_contact
                      name: contact.name || '---',
                      mobile: contact.mobile || '---',
                      phone: contact.phone || '---',
                      email: contact.email || '---',
                      country_id: contact.country_id || null,
                      isMain: isMainContact,
                    };
                    
                    console.log('🔍 Created contact entry:', contactEntry);
                    contactEntries.push(contactEntry);
                  }
                });
              }
            }
          }
          
          // If no contacts were found in the database, create a fallback main contact from client data
          if (contactEntries.length === 0) {
            console.log('🔍 No contacts found in database, creating fallback main contact');
            const fallbackContact: ContactEntry = {
              id: 1,
              name: client.name || '---',
              mobile: client.mobile || '---',
              phone: client.phone || '---',
              email: client.email || '---',
              isMain: true,
            };
            contactEntries.push(fallbackContact);
          } else {
            console.log('🔍 Found', contactEntries.length, 'contacts in database, no fallback needed');
          }
          
          // Remove duplicates by ID before sorting
          const uniqueContacts = contactEntries.reduce((acc, contact) => {
            if (!acc.find(c => c.id === contact.id)) {
              acc.push(contact);
            }
            return acc;
          }, [] as ContactEntry[]);
          
          // Sort contacts: main contact first, then others by ID
          uniqueContacts.sort((a, b) => {
            // Main contact always comes first
            if (a.isMain && !b.isMain) return -1;
            if (!a.isMain && b.isMain) return 1;
            // If both are main or both are not main, sort by ID
            return a.id - b.id;
          });
          
          console.log('🔍 Final contacts list (deduplicated):', uniqueContacts);
          setContacts(uniqueContacts);
          
        } catch (error) {
          console.error('❌ Error fetching legacy contacts:', error);
          // Fallback to basic contact structure
          const mainContact: ContactEntry = {
            id: 1,
            name: client.name || '---',
            mobile: client.mobile || '---',
            phone: client.phone || '---',
            email: client.email || '---',
            isMain: true,
          };
          setContacts([mainContact]);
        }
      } else {
        // For new leads, fetch contacts from leads_contact and lead_leadcontact tables using newlead_id
        try {
          const newLeadId = client.id; // UUID for new leads
          console.log('🔍 New lead ID for contacts:', newLeadId);
          
          // Process contacts from lead_leadcontact and leads_contact tables
          const contactEntries: ContactEntry[] = [];
          
          // Get contacts from lead-contact relationships
          const { data: leadContacts, error: leadContactsError } = await supabase
            .from('lead_leadcontact')
            .select(`
              id,
              main,
              contact_id,
              newlead_id
            `)
            .eq('newlead_id', newLeadId);
          
          console.log('🔍 New lead contacts query result:', { data: leadContacts, error: leadContactsError });
          
          if (leadContactsError) {
            console.error('❌ Error fetching new lead contacts:', leadContactsError);
            // Fallback to basic contact structure
        const mainContact: ContactEntry = {
          id: 1,
          name: client.name || '---',
          mobile: client.mobile || '---',
          phone: client.phone || '---',
          email: client.email || '---',
          isMain: true,
        };
            setContacts([mainContact]);
            return;
          }
          
          if (leadContacts && leadContacts.length > 0) {
            console.log('🔍 Processing new lead contacts:', leadContacts);
            
            // Get all contact IDs
            const contactIds = leadContacts.map((lc: any) => lc.contact_id).filter(Boolean);
            console.log('🔍 Contact IDs found:', contactIds);
            
            if (contactIds.length > 0) {
              // Fetch contact details from leads_contact table
              const { data: contacts, error: contactsError } = await supabase
                .from('leads_contact')
                .select('id, name, mobile, phone, email, notes, address, additional_phones, additional_emails, country_id')
                .in('id', contactIds);
              
              console.log('🔍 Contacts query result:', { data: contacts, error: contactsError });
              
              if (contactsError) {
                console.error('❌ Error fetching contact details:', contactsError);
              } else if (contacts) {
                // Map contacts to their lead-contact relationships
                let mainContactFound = false;
                
                leadContacts.forEach((leadContact: any) => {
                  console.log('🔍 Processing lead contact:', leadContact);
                  
                  const contact = contacts.find((c: any) => c.id === leadContact.contact_id);
                  if (contact) {
                    console.log('🔍 Contact details found:', contact);
                    
                    // Check if this is marked as main in the lead_leadcontact table
                    const isMarkedAsMain = leadContact.main === 'true' || leadContact.main === true || leadContact.main === 't';
                    
                    // Only mark as main if it's explicitly marked as main AND no main contact has been found yet
                    const isMainContact = isMarkedAsMain && !mainContactFound;
                    
                    if (isMainContact) {
                      mainContactFound = true;
                    }
                    
                    // Create contact entry with complete information from leads_contact table
                    const contactEntry: ContactEntry = {
                      id: contact.id,
                      name: contact.name || '---',
                      mobile: contact.mobile || '---',
                      phone: contact.phone || '---',
                      email: contact.email || '---',
                      country_id: contact.country_id || null,
                      isMain: isMainContact,
                    };
                    
                    console.log('🔍 Created contact entry:', contactEntry);
                    contactEntries.push(contactEntry);
                  }
                });
              }
            }
          }
          
          // If no contacts were found in the database, check if one exists but wasn't found, or create a new one
          if (contactEntries.length === 0) {
            console.log('🔍 No contacts found in database, checking if contact exists or creating main contact from client data');
            
            // First, try to find an existing contact for this lead (in case it was created by SQL function but query didn't find it)
            const { data: existingContacts, error: existingError } = await supabase
              .from('leads_contact')
              .select('id, name, mobile, phone, email, country_id')
              .eq('newlead_id', newLeadId)
              .limit(1);
            
            if (existingContacts && existingContacts.length > 0) {
              console.log('🔍 Found existing contact that was missed in previous query:', existingContacts);
              const existingContact = existingContacts[0];
              
              // Check if relationship exists
              const { data: existingRelationship } = await supabase
                .from('lead_leadcontact')
                .select('id, main')
                .eq('newlead_id', newLeadId)
                .eq('contact_id', existingContact.id)
                .single();
              
              const mainContact: ContactEntry = {
                id: existingContact.id,
                name: existingContact.name || client.name || '---',
                mobile: existingContact.mobile || client.mobile || '---',
                phone: existingContact.phone || client.phone || '---',
                email: existingContact.email || client.email || '---',
                isMain: existingRelationship?.main === true || existingRelationship?.main === 'true' || existingRelationship?.main === 't',
              };
              contactEntries.push(mainContact);
            } else {
              // No existing contact found, create a new one
              const insertData: Record<string, any> = {
                name: client.name || '',
                mobile: client.mobile || null,
                phone: client.phone || null,
                email: client.email || null,
                newlead_id: newLeadId,
                cdate: new Date().toISOString().split('T')[0],
                udate: new Date().toISOString().split('T')[0]
              };
              
              let newContact: any = null;
              let contactError: any = null;
              
              try {
                const result = await supabase
                  .from('leads_contact')
                  .insert([insertData])
                  .select('id')
                  .single();
                
                newContact = result.data;
                contactError = result.error;
                
                // If duplicate key error, try to get the existing contact
                if (contactError && contactError.code === '23505') {
                  console.warn('Duplicate key error when creating contact. Fetching existing contact...');
                  
                  const { data: maxIdData } = await supabase
                    .from('leads_contact')
                    .select('id')
                    .order('id', { ascending: false })
                    .limit(1)
                    .single();
                  
                  const nextId = maxIdData ? maxIdData.id + 1 : 1;
                  
                  // Try insert with explicit ID
                  const resultWithId = await supabase
                    .from('leads_contact')
                    .insert([{ ...insertData, id: nextId }])
                    .select('id')
                    .single();
                  
                  newContact = resultWithId.data;
                  contactError = resultWithId.error;
                  
                  // If still error, try to fetch existing contact by newlead_id
                  if (contactError) {
                    const { data: fetchedContact } = await supabase
                      .from('leads_contact')
                      .select('id, name, mobile, phone, email, country_id')
                      .eq('newlead_id', newLeadId)
                      .limit(1)
                      .single();
                    
                    if (fetchedContact) {
                      newContact = { id: fetchedContact.id };
                      contactError = null;
                    }
                  }
                }
              } catch (err) {
                console.error('Insert failed:', err);
                contactError = err;
              }
              
              if (contactError) {
                console.error('Error creating main contact:', contactError);
                // Fallback to temporary contact entry
                const fallbackContact: ContactEntry = {
                  id: 1,
                  name: client.name || '---',
                  mobile: client.mobile || '---',
                  phone: client.phone || '---',
                  email: client.email || '---',
                  isMain: true,
                };
                contactEntries.push(fallbackContact);
              } else if (newContact) {
                // Create relationship in lead_leadcontact table with main = 'true'
                let relationshipError: any = null;
                
                try {
                  const result = await supabase
                    .from('lead_leadcontact')
                    .insert([{
                      contact_id: newContact.id,
                      newlead_id: newLeadId,
                      main: 'true'
                    }]);
                  
                  relationshipError = result.error;
                  
                  // If duplicate key error, try to get next available ID
                  if (relationshipError && relationshipError.code === '23505') {
                    console.warn('Duplicate key error for relationship. Getting next available ID...');
                    
                    const { data: maxIdData } = await supabase
                      .from('lead_leadcontact')
                      .select('id')
                      .order('id', { ascending: false })
                      .limit(1)
                      .single();
                    
                    const nextId = maxIdData ? maxIdData.id + 1 : 1;
                    
                    const resultWithId = await supabase
                      .from('lead_leadcontact')
                      .insert([{
                        id: nextId,
                        contact_id: newContact.id,
                        newlead_id: newLeadId,
                        main: 'true'
                      }]);
                    
                    relationshipError = resultWithId.error;
                  }
                } catch (err) {
                  console.error('Relationship insert failed:', err);
                  relationshipError = err;
                }
                
                if (relationshipError) {
                  console.error('Error creating main contact relationship:', relationshipError);
                }
                
                const mainContact: ContactEntry = {
                  id: newContact.id,
                  name: client.name || '---',
                  mobile: client.mobile || '---',
                  phone: client.phone || '---',
                  email: client.email || '---',
                  isMain: true,
                };
                contactEntries.push(mainContact);
              }
            }
          } else {
            console.log('🔍 Found', contactEntries.length, 'contacts in database, no fallback needed');
          }
          
          // Remove duplicates by ID before sorting
          const uniqueContacts = contactEntries.reduce((acc, contact) => {
            if (!acc.find(c => c.id === contact.id)) {
              acc.push(contact);
            }
            return acc;
          }, [] as ContactEntry[]);
          
          // Sort contacts: main contact first, then others by ID
          uniqueContacts.sort((a, b) => {
            // Main contact always comes first
            if (a.isMain && !b.isMain) return -1;
            if (!a.isMain && b.isMain) return 1;
            // If both are main or both are not main, sort by ID
            return a.id - b.id;
          });
          
          console.log('🔍 Final contacts list (deduplicated):', uniqueContacts);
          setContacts(uniqueContacts);
          
        } catch (error) {
          console.error('❌ Error fetching new lead contacts:', error);
          // Fallback to basic contact structure
          const mainContact: ContactEntry = {
            id: 1,
            name: client.name || '---',
            mobile: client.mobile || '---',
            phone: client.phone || '---',
            email: client.email || '---',
            isMain: true,
          };
          setContacts([mainContact]);
        }
      }
      
      // Don't initialize editedMainContact here - it will be set when Edit button is clicked
    };
    
    fetchContacts();
  }, [client?.id]); // Only depend on client.id to prevent unnecessary re-fetches

  // Fetch contract templates and currencies when component mounts
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        // Fetch contract templates from both tables
        const [newTemplatesResult, legacyTemplatesResult] = await Promise.all([
          supabase
            .from('contract_templates')
            .select('id, name, content, default_pricing_tiers, default_pricing_tiers_usd, default_pricing_tiers_nis, default_currency, default_country, active')
            .eq('active', true)
            .order('name', { ascending: true }),
          supabase
            .from('misc_contracttemplate')
            .select('id, name, content, default_pricing_tiers_usd, default_pricing_tiers_nis, active')
            .order('name', { ascending: true })
        ]);

        const newTemplates: ContractTemplate[] = [];
        const legacyTemplates: ContractTemplate[] = [];

        // Process new templates
        if (newTemplatesResult.error) {
          console.error('Error fetching contract_templates:', newTemplatesResult.error);
        } else if (newTemplatesResult.data) {
          newTemplates.push(...newTemplatesResult.data.map((template: any) => ({
            ...template,
            id: String(template.id), // Ensure ID is string for consistency
            sourceTable: 'contract_templates' as const // Track source table
          })));
          console.log(`✅ Loaded ${newTemplates.length} templates from contract_templates`);
        }

        // Process legacy templates
        if (legacyTemplatesResult.error) {
          console.error('Error fetching misc_contracttemplate:', legacyTemplatesResult.error);
        } else if (legacyTemplatesResult.data) {
          // Filter for active templates - handle both boolean true and string 't'
          const activeLegacyTemplates = legacyTemplatesResult.data.filter((template: any) => {
            // Handle boolean true, string 't', or truthy values
            return template.active === true || template.active === 't' || template.active === 1 || (template.active !== false && template.active !== 'f' && template.active !== 0);
          });
          
          legacyTemplates.push(...activeLegacyTemplates.map((template: any) => ({
            ...template,
            id: String(template.id), // Convert numeric ID to string for consistency
            default_currency: null, // misc_contracttemplate doesn't have default_currency
            default_country: null, // misc_contracttemplate doesn't have default_country
            default_pricing_tiers: null, // misc_contracttemplate doesn't have this column, only _usd and _nis
            default_pricing_tiers_usd: template.default_pricing_tiers_usd || null,
            default_pricing_tiers_nis: template.default_pricing_tiers_nis || null,
            sourceTable: 'misc_contracttemplate' as const // Track source table
          })));
          console.log(`✅ Loaded ${legacyTemplates.length} active templates from misc_contracttemplate (out of ${legacyTemplatesResult.data.length} total)`);
          console.log('Legacy templates:', legacyTemplates.map(t => ({ id: t.id, name: t.name })));
        }

        // Combine both template arrays
        const allTemplates = [...newTemplates, ...legacyTemplates];
        console.log(`✅ Total templates loaded: ${allTemplates.length} (${newTemplates.length} new + ${legacyTemplates.length} legacy)`);
        setContractTemplates(allTemplates);
      } catch (error) {
        console.error('Error fetching contract templates:', error);
        setContractTemplates([]);
      }
    };

    fetchTemplates();

    // Fetch currencies from database
    supabase.from('currencies').select('id, front_name, iso_code, name').eq('is_active', true).order('order_value').then(({ data, error }) => {
      if (error) {
        console.error('Error fetching currencies:', error);
      } else if (data) {
        setCurrencies(data);
      }
    });
  }, []);

  // Fetch contract statuses when contacts change
  useEffect(() => {
    const fetchContractStatuses = async () => {
      if (!client?.id) return;
      
      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        // For legacy leads, contract statuses are handled in the main contract fetching logic
        // No need to fetch from contracts table
        return;
      }
      
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
    // Check if this is a legacy lead
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      // For legacy leads, update the leads_contact table (not leads_lead)
      try {
        const legacyId = client.id.toString().replace('legacy_', '');
        
        // Find the main contact from the current contacts list
        const mainContactFromList = contacts.find(c => c.isMain);
        
        if (!mainContactFromList) {
          console.error('No main contact found in contacts list');
          alert('Failed to find main contact to update');
          return;
        }
        
        console.log('Updating main contact:', mainContactFromList.id);
        console.log('Updated data:', editedMainContact);
        
        // Update the contact in leads_contact table using the contact ID from the list
        const { error } = await supabase
          .from('leads_contact')
          .update({
            name: editedMainContact.name,
            mobile: editedMainContact.mobile || null,
            phone: editedMainContact.phone || null,
            email: editedMainContact.email || null,
            country_id: editedMainContact.country_id || null,
            udate: new Date().toISOString().split('T')[0]
          })
          .eq('id', mainContactFromList.id);

        if (error) {
          console.error('Error updating contact:', error);
          throw error;
        }
        
        console.log('Contact updated successfully');

        // Also update leads_lead table with main contact details
        const { error: updateLeadError } = await supabase
          .from('leads_lead')
          .update({
            name: editedMainContact.name,
            mobile: editedMainContact.mobile || null,
            phone: editedMainContact.phone || null,
            email: editedMainContact.email || null
          })
          .eq('id', parseInt(legacyId));
        
        if (updateLeadError) {
          console.error('Error updating leads_lead with main contact details:', updateLeadError);
          // Don't throw - this is a secondary update, contact update already succeeded
          toast.error('Contact updated, but failed to sync to lead record');
        } else {
          console.log('✅ Updated leads_lead table with main contact details');
        }

        // Update the local contacts state to reflect the changes immediately
        setContacts(contacts.map(c => 
          c.isMain ? {
            ...c,
            name: editedMainContact.name,
            mobile: editedMainContact.mobile || '---',
            phone: editedMainContact.phone || '---',
            email: editedMainContact.email || '---',
            country_id: editedMainContact.country_id || null
          } : c
        ));
        
        setIsEditingMainContact(false);
        
        // Refresh client data in parent component
        if (onClientUpdate) {
          await onClientUpdate();
        }
      } catch (error) {
        console.error('Error updating legacy main contact:', error);
        alert('Failed to update contact information: ' + (error as any).message);
      }
    } else {
      // For new leads, update leads_contact and lead_leadcontact tables
      try {
        const newLeadId = client.id; // UUID for new leads
        
        // Find the main contact from the current contacts list
        const mainContactFromList = contacts.find(c => c.isMain);
        
        if (!mainContactFromList) {
          console.error('No main contact found in contacts list');
          alert('Failed to find main contact to update');
          return;
        }
        
        console.log('Updating main contact for new lead:', mainContactFromList.id);
        console.log('Updated data:', editedMainContact);
        
        // Update the contact in leads_contact table using the contact ID from the list
        const { error } = await supabase
          .from('leads_contact')
          .update({
            name: editedMainContact.name,
            mobile: editedMainContact.mobile || null,
            phone: editedMainContact.phone || null,
            email: editedMainContact.email || null,
            country_id: editedMainContact.country_id || null,
            udate: new Date().toISOString().split('T')[0]
          })
          .eq('id', mainContactFromList.id);

        if (error) {
          console.error('Error updating contact:', error);
          throw error;
        }
        
        console.log('Contact updated successfully');

        // Also update leads table with main contact details
        const { error: updateLeadError } = await supabase
          .from('leads')
          .update({
            name: editedMainContact.name,
            mobile: editedMainContact.mobile || null,
            phone: editedMainContact.phone || null,
            email: editedMainContact.email || null
          })
          .eq('id', newLeadId);
        
        if (updateLeadError) {
          console.error('Error updating leads table with main contact details:', updateLeadError);
          // Don't throw - this is a secondary update, contact update already succeeded
          toast.error('Contact updated, but failed to sync to lead record');
        } else {
          console.log('✅ Updated leads table with main contact details');
        }

        // Update the local contacts state to reflect the changes immediately
        setContacts(contacts.map(c => 
          c.isMain ? {
            ...c,
            name: editedMainContact.name,
            mobile: editedMainContact.mobile || '---',
            phone: editedMainContact.phone || '---',
            email: editedMainContact.email || '---',
            country_id: editedMainContact.country_id || null
          } : c
        ));

        setIsEditingMainContact(false);
        
        // Refresh client data in parent component
        if (onClientUpdate) {
          await onClientUpdate();
        }
      } catch (error) {
        console.error('Error updating new lead main contact:', error);
        alert('Failed to update contact information: ' + (error as any).message);
      }
    }
  };

  const handleCancelMainContact = () => {
    // Find the main contact to get its country_id
    const mainContact = contacts.find(c => c.isMain);
    setEditedMainContact({
      name: client.name || '',
      mobile: client.mobile || '',
      phone: client.phone || '',
      email: client.email || '',
      country_id: mainContact?.country_id || null
    });
    setIsEditingMainContact(false);
    // Reset country search term
    const countryName = mainContact?.country_id ? countries.find(c => c.id === mainContact.country_id)?.name || '' : '';
    setMainContactCountrySearchTerm(countryName);
    setShowMainContactCountryDropdown(false);
  };

  // Filter country options based on search term (for main contact)
  const filteredMainContactCountryOptions = countries.filter(country => {
    const searchTerm = mainContactCountrySearchTerm.toLowerCase();
    const countryName = country.name.toLowerCase();
    const isoCode = (country.iso_code || '').toLowerCase();
    
    // Check if search term matches country name or ISO code
    if (countryName.includes(searchTerm) || isoCode.includes(searchTerm)) {
      return true;
    }
    
    // Special handling for United States aliases
    const isUnitedStates = countryName.includes('united states') || 
                          countryName === 'usa' || 
                          isoCode === 'us' || 
                          isoCode === 'usa';
    if (isUnitedStates) {
      return searchTerm === 'usa' || 
             searchTerm === 'us' || 
             searchTerm === 'america' || 
             searchTerm.includes('united states');
    }
    
    return false;
  });

  // Filter country options for a specific contact
  const getFilteredContactCountryOptions = (contactId: number) => {
    const searchTerm = (contactCountrySearchTerms[contactId] || '').toLowerCase();
    return countries.filter(country => {
      const countryName = country.name.toLowerCase();
      const isoCode = (country.iso_code || '').toLowerCase();
      
      // Check if search term matches country name or ISO code
      if (countryName.includes(searchTerm) || isoCode.includes(searchTerm)) {
        return true;
      }
      
      // Special handling for United States aliases
      const isUnitedStates = countryName.includes('united states') || 
                            countryName === 'usa' || 
                            isoCode === 'us' || 
                            isoCode === 'usa';
      if (isUnitedStates) {
        return searchTerm === 'usa' || 
               searchTerm === 'us' || 
               searchTerm === 'america' || 
               searchTerm.includes('united states');
      }
      
      return false;
    });
  };

  // Handle country select for main contact
  const handleMainContactCountrySelect = (countryId: number, countryName: string) => {
    setEditedMainContact({ ...editedMainContact, country_id: countryId });
    setMainContactCountrySearchTerm(countryName);
    setShowMainContactCountryDropdown(false);
  };

  // Handle country select for regular contact
  const handleContactCountrySelect = (contactId: number, countryId: number, countryName: string) => {
    setContacts(contacts.map(c => 
      c.id === contactId ? { ...c, country_id: countryId } : c
    ));
    setContactCountrySearchTerms({ ...contactCountrySearchTerms, [contactId]: countryName });
    setShowContactCountryDropdowns({ ...showContactCountryDropdowns, [contactId]: false });
  };

  // Filter country code options based on search term
  const getFilteredCountryCodeOptions = (searchTerm: string) => {
    return countryOptions.filter(country => {
      const searchLower = searchTerm.toLowerCase();
      const phoneCode = country.phone_code.toLowerCase();
      const countryName = country.name.toLowerCase();
      
      // Direct matches
      if (phoneCode.includes(searchLower) || countryName.includes(searchLower)) {
        return true;
      }
      
      // Special handling for USA/United States/America
      const usaSearchTerms = ['usa', 'us', 'america', 'united states'];
      const isUSASearch = usaSearchTerms.some(term => searchLower.includes(term) || term.includes(searchLower));
      
      if (isUSASearch) {
        return countryName.includes('united states') || 
               countryName.includes('america') ||
               countryName === 'usa' || 
               countryName === 'us' ||
               country.iso_code === 'US' ||
               country.iso_code === 'USA' ||
               phoneCode === '+1';
      }
      
      return false;
    });
  };

  // Click outside handler for country dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mainContactCountryInputRef.current && !mainContactCountryInputRef.current.contains(event.target as Node)) {
        setShowMainContactCountryDropdown(false);
      }
      
      if (mainContactMobileCodeInputRef.current && !mainContactMobileCodeInputRef.current.contains(event.target as Node)) {
        setShowMainContactMobileCodeDropdown(false);
        setMainContactMobileCodeSearchTerm('');
      }
      
      if (mainContactPhoneCodeInputRef.current && !mainContactPhoneCodeInputRef.current.contains(event.target as Node)) {
        setShowMainContactPhoneCodeDropdown(false);
        setMainContactPhoneCodeSearchTerm('');
      }
      
      // Check all contact country dropdowns
      Object.keys(contactCountryInputRefs.current).forEach(contactIdStr => {
        const contactId = parseInt(contactIdStr, 10);
        const ref = contactCountryInputRefs.current[contactId];
        if (ref && !ref.contains(event.target as Node)) {
          setShowContactCountryDropdowns(prev => ({ ...prev, [contactId]: false }));
        }
      });
      
      // Check all contact mobile code dropdowns
      Object.keys(contactMobileCodeInputRefs.current).forEach(contactIdStr => {
        const contactId = parseInt(contactIdStr, 10);
        const ref = contactMobileCodeInputRefs.current[contactId];
        if (ref && !ref.contains(event.target as Node)) {
          setShowContactMobileCodeDropdowns(prev => ({ ...prev, [contactId]: false }));
          setContactMobileCodeSearchTerms(prev => ({ ...prev, [contactId]: '' }));
        }
      });
      
      // Check all contact phone code dropdowns
      Object.keys(contactPhoneCodeInputRefs.current).forEach(contactIdStr => {
        const contactId = parseInt(contactIdStr, 10);
        const ref = contactPhoneCodeInputRefs.current[contactId];
        if (ref && !ref.contains(event.target as Node)) {
          setShowContactPhoneCodeDropdowns(prev => ({ ...prev, [contactId]: false }));
          setContactPhoneCodeSearchTerms(prev => ({ ...prev, [contactId]: '' }));
        }
      });
    };

    const hasAnyDropdownOpen = showMainContactCountryDropdown || 
      showMainContactMobileCodeDropdown ||
      showMainContactPhoneCodeDropdown ||
      Object.values(showContactCountryDropdowns).some(open => open) ||
      Object.values(showContactMobileCodeDropdowns).some(open => open) ||
      Object.values(showContactPhoneCodeDropdowns).some(open => open);

    if (hasAnyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMainContactCountryDropdown, showMainContactMobileCodeDropdown, showMainContactPhoneCodeDropdown, showContactCountryDropdowns, showContactMobileCodeDropdowns, showContactPhoneCodeDropdowns]);

  // Sync country search term when editing main contact starts
  useEffect(() => {
    if (isEditingMainContact) {
      const countryName = editedMainContact.country_id 
        ? countries.find(c => c.id === editedMainContact.country_id)?.name || '' 
        : '';
      setMainContactCountrySearchTerm(countryName);
    }
  }, [isEditingMainContact, editedMainContact.country_id, countries]);

  // Sync country search term when editing a contact starts
  useEffect(() => {
    contacts.forEach(contact => {
      if (contact.isEditing && !contactCountrySearchTerms[contact.id]) {
        const countryName = contact.country_id 
          ? countries.find(c => c.id === contact.country_id)?.name || '' 
          : '';
        setContactCountrySearchTerms(prev => ({ ...prev, [contact.id]: countryName }));
      }
    });
  }, [contacts, countries]);

  // Sync country code search terms when editing main contact starts
  useEffect(() => {
    if (isEditingMainContact) {
      const mobileCode = parsePhoneNumber(editedMainContact.mobile).countryCode;
      const phoneCode = parsePhoneNumber(editedMainContact.phone).countryCode;
      setSelectedMainContactMobileCode(mobileCode);
      setSelectedMainContactPhoneCode(phoneCode);
      setMainContactMobileCodeSearchTerm('');
      setMainContactPhoneCodeSearchTerm('');
    }
  }, [isEditingMainContact]);

  // Sync country code search terms when editing a contact starts
  useEffect(() => {
    contacts.forEach(contact => {
      if (contact.isEditing) {
        const mobileCode = parsePhoneNumber(contact.mobile).countryCode;
        const phoneCode = parsePhoneNumber(contact.phone).countryCode;
        if (!selectedContactMobileCodes[contact.id]) {
          setSelectedContactMobileCodes(prev => ({ ...prev, [contact.id]: mobileCode }));
          setSelectedContactPhoneCodes(prev => ({ ...prev, [contact.id]: phoneCode }));
          setContactMobileCodeSearchTerms(prev => ({ ...prev, [contact.id]: '' }));
          setContactPhoneCodeSearchTerms(prev => ({ ...prev, [contact.id]: '' }));
        }
      }
    });
  }, [contacts]);

  const handleCancelContact = (contact: ContactEntry) => {
    // Check if this is a newly created contact (temporary ID from Date.now())
    // Database IDs are typically much smaller than timestamps
    // Date.now() returns a timestamp in milliseconds (e.g., 1734567890123)
    // Database IDs are usually sequential numbers (1, 2, 3, etc.)
    const isNewContact = contact.id > 1000000000000; // Roughly year 2001 in milliseconds
    
    if (isNewContact && contact.isEditing) {
      // This is a newly created contact that hasn't been saved, remove it from the list
      setContacts(contacts.filter(c => c.id !== contact.id));
    } else {
      // This is an existing contact being edited, just exit edit mode
      setContacts(contacts.map(c => c.id === contact.id ? { ...c, isEditing: false } : c));
    }
  };

  const handleSaveContact = async (id: number, contact: ContactEntry) => {
    if (contact.isMain) {
      await handleSaveMainContact();
      return;
    }

    // Check if this is a legacy lead
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      // For legacy leads, we need to save to leads_contact and lead_leadcontact tables
      try {
        const legacyId = client.id.toString().replace('legacy_', '');
        const originalContact = contacts.find(c => c.id === id);
        // Check if this is a newly created contact (temporary ID from Date.now())
        // Database IDs are typically much smaller than timestamps
        const isNewContact = id > 1000000000000; // Roughly year 2001 in milliseconds
        
        if (isNewContact) {
          console.log('Creating new legacy contact with data:', contact);
          
          // Prepare the insert data WITHOUT the timestamp ID
          // We cannot include the id from contact (which is a timestamp)
          const insertData: Record<string, any> = {
            name: contact.name || '',
            mobile: contact.mobile || null,
            phone: contact.phone || null,
            email: contact.email || null,
            country_id: contact.country_id || null,
            cdate: new Date().toISOString().split('T')[0],
            udate: new Date().toISOString().split('T')[0]
          };
          
          // console.log('Insert data (without ID):', insertData);
          // console.log('Contact timestamp ID to ignore:', contact.id);
          
          // Try to insert without specifying the ID column
          // The database should auto-generate it
          let newContact: any = null;
          let contactError: any = null;
          
          // Use RPC call instead of direct insert to avoid trigger issues
          try {
            // First try with direct insert
            const result = await supabase
              .from('leads_contact')
              .insert([insertData])
              .select('id')
              .single();
            newContact = result.data;
            contactError = result.error;
            
            console.log('Direct insert result:', { newContact, contactError });
            
            // If direct insert fails with duplicate key, try to get the next available ID
            if (contactError && contactError.code === '23505') {
              console.warn('Duplicate key error. Attempting to get next available ID...');
              
              // Get the max ID from the table
              const { data: maxIdData } = await supabase
                .from('leads_contact')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .single();
              
              const nextId = maxIdData ? maxIdData.id + 1 : 1;
              console.log('Next available ID:', nextId);
              
              // Try insert with explicit ID
              const resultWithId = await supabase
                .from('leads_contact')
                .insert([{ ...insertData, id: nextId }])
                .select('id')
                .single();
              
              newContact = resultWithId.data;
              contactError = resultWithId.error;
              console.log('Insert with explicit ID result:', { newContact, contactError });
            }
          } catch (err) {
            console.error('Insert failed:', err);
            contactError = err;
          }
          
          console.log('Contact insert result:', { newContact, contactError });
          
          if (contactError) {
            console.error('Error creating contact:', contactError);
            throw contactError;
          }
          
          // Create relationship in lead_leadcontact table
          if (!newContact || !newContact.id) {
            throw new Error('Failed to get new contact ID');
          }
          
          let relationshipError: any = null;
          
          try {
            // First try without specifying ID
            const result = await supabase
              .from('lead_leadcontact')
              .insert([{
                contact_id: newContact.id,
                lead_id: legacyId,
                main: 'false'
              }]);
            
            relationshipError = result.error;
            
            // If duplicate key error, get next available ID and try again
            if (relationshipError && relationshipError.code === '23505') {
              console.warn('Duplicate key error for relationship. Getting next available ID...');
              
              const { data: maxIdData } = await supabase
                .from('lead_leadcontact')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .single();
              
              const nextId = maxIdData ? maxIdData.id + 1 : 1;
              console.log('Next available relationship ID:', nextId);
              
              const resultWithId = await supabase
                .from('lead_leadcontact')
                .insert([{
                  id: nextId,
                  contact_id: newContact.id,
                  lead_id: legacyId,
                  main: 'false'
                }]);
              
              relationshipError = resultWithId.error;
            }
          } catch (err) {
            console.error('Relationship insert failed:', err);
            relationshipError = err;
          }
          
          console.log('Relationship insert result:', { relationshipError });
          
          if (relationshipError) {
            console.error('Error creating relationship:', relationshipError);
            throw relationshipError;
          }
          
          // Update local state with the new contact ID - use functional update to prevent duplicates
          setContacts(prevContacts => {
            // Remove the old temporary contact and add the new one with real ID
            const filtered = prevContacts.filter(c => c.id !== id && c.id !== newContact.id);
            return [...filtered, { ...contact, id: newContact.id, isEditing: false, isMain: false }];
          });
          
          toast.success('New contact created successfully!');
          console.log('New legacy contact created successfully');
          
          // Don't call onClientUpdate to prevent duplicate fetching
        } else {
          // Update existing contact in leads_contact table
          // Find the contact_id from the current contacts list
          const contactToUpdate = contacts.find(c => c.id === id);
          
          if (!contactToUpdate) {
            console.error('Contact not found for update');
            return;
          }
          
          // Update the contact in leads_contact table using the contact ID
          const { error: updateError } = await supabase
            .from('leads_contact')
            .update({
              name: contact.name,
              mobile: contact.mobile,
              phone: contact.phone,
              email: contact.email,
              country_id: contact.country_id || null,
              udate: new Date().toISOString().split('T')[0]
            })
            .eq('id', contactToUpdate.id);
          
          if (updateError) throw updateError;
          // Use functional update to avoid stale state
          setContacts(prevContacts => 
            prevContacts.map(c => 
            c.id === id ? { ...contact, isEditing: false } : c
            )
          );
          
          console.log('Legacy contact updated in local state');
        }
        
        // Don't call onClientUpdate to prevent unnecessary re-fetches
      } catch (error) {
        console.error('Error saving legacy contact:', error);
        alert('Failed to save legacy contact');
      }
    } else {
      // For new leads, save to leads_contact and lead_leadcontact tables
      try {
        const newLeadId = client.id; // UUID for new leads
        const originalContact = contacts.find(c => c.id === id);
        // Check if this is a newly created contact (temporary ID from Date.now())
        // Database IDs are typically much smaller than timestamps
        const isNewContact = id > 1000000000000; // Roughly year 2001 in milliseconds
        
        if (isNewContact) {
          console.log('Creating new contact for new lead with data:', contact);
          
          // Prepare the insert data - explicitly exclude ID to let database auto-generate it
          const insertData: Record<string, any> = {
            name: contact.name || '',
            mobile: contact.mobile || null,
            phone: contact.phone || null,
            email: contact.email || null,
            country_id: contact.country_id || null,
            newlead_id: newLeadId,
            cdate: new Date().toISOString().split('T')[0],
            udate: new Date().toISOString().split('T')[0]
          };
          
          // Ensure ID is not included in insert data
          delete insertData.id;
          
          console.log('Insert data (without ID):', insertData);
          
          // Insert into leads_contact table - let database auto-generate ID
          let newContact: any = null;
          let contactError: any = null;
          
          try {
            const result = await supabase
              .from('leads_contact')
              .insert([insertData])
              .select('id')
              .single();
            
            newContact = result.data;
            contactError = result.error;
            
            console.log('Contact insert result:', { newContact, contactError });
            
            // If duplicate key error, try to get next available ID
            if (contactError && contactError.code === '23505') {
              console.warn('Duplicate key error. Getting next available ID...');
              
              // Get the max ID from the table
              const { data: maxIdData } = await supabase
                .from('leads_contact')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .single();
              
              const nextId = maxIdData ? maxIdData.id + 1 : 1;
              console.log('Next available ID:', nextId);
              
              // Try insert with explicit ID
              const resultWithId = await supabase
                .from('leads_contact')
                .insert([{ ...insertData, id: nextId }])
                .select('id')
                .single();
              
              newContact = resultWithId.data;
              contactError = resultWithId.error;
              console.log('Insert with explicit ID result:', { newContact, contactError });
            }
          } catch (err) {
            console.error('Insert failed:', err);
            contactError = err;
          }
          
          if (contactError) {
            console.error('Error creating contact:', contactError);
            throw contactError;
          }
          
          if (!newContact || !newContact.id) {
            throw new Error('Failed to get new contact ID');
          }
          
          // Create relationship in lead_leadcontact table
          let relationshipError: any = null;
          
          try {
            // First try without specifying ID
            const result = await supabase
              .from('lead_leadcontact')
              .insert([{
                contact_id: newContact.id,
                newlead_id: newLeadId,
                main: 'false'
              }]);
            
            relationshipError = result.error;
            
            // If duplicate key error, get next available ID and try again
            if (relationshipError && relationshipError.code === '23505') {
              console.warn('Duplicate key error for relationship. Getting next available ID...');
              
              const { data: maxIdData } = await supabase
                .from('lead_leadcontact')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .single();
              
              const nextId = maxIdData ? maxIdData.id + 1 : 1;
              console.log('Next available relationship ID:', nextId);
              
              const resultWithId = await supabase
                .from('lead_leadcontact')
                .insert([{
                  id: nextId,
                  contact_id: newContact.id,
                  newlead_id: newLeadId,
                  main: 'false'
                }]);
              
              relationshipError = resultWithId.error;
              console.log('Insert with explicit ID result:', { relationshipError });
            }
          } catch (err) {
            console.error('Relationship insert failed:', err);
            relationshipError = err;
          }
          
          if (relationshipError) {
            console.error('Error creating relationship:', relationshipError);
            throw relationshipError;
          }
          
          // Update local state with the new contact ID - use functional update to avoid stale state
          setContacts(prevContacts => {
            // Remove the old temporary contact (by the temporary ID) and add the new one with real ID
            // Also check if contact with new ID already exists to prevent duplicates
            const filtered = prevContacts.filter(c => c.id !== id && c.id !== newContact.id);
            return [...filtered, { ...contact, id: newContact.id, isEditing: false, isMain: false }];
          });
          
          toast.success('New contact created successfully!');
          console.log('New contact created successfully');
          
          // Don't call onClientUpdate here as it will trigger fetchContacts which might cause duplicates
          // The state is already updated, so the UI will reflect the change immediately
          // If we need to refresh other parts of the client data, we can do it more selectively
        } else {
          // Update existing contact in leads_contact table
          const contactToUpdate = contacts.find(c => c.id === id);
          
          if (!contactToUpdate) {
            console.error('Contact not found for update');
            return;
          }
          
          // Update the contact in leads_contact table using the contact ID
          const { error: updateError } = await supabase
            .from('leads_contact')
            .update({
              name: contact.name,
              mobile: contact.mobile || null,
              phone: contact.phone || null,
              email: contact.email || null,
              country_id: contact.country_id || null,
              udate: new Date().toISOString().split('T')[0]
            })
            .eq('id', contactToUpdate.id);

          if (updateError) throw updateError;

          // Use functional update to avoid stale state
          setContacts(prevContacts => 
            prevContacts.map(c => 
          c.id === id ? { ...contact, isEditing: false } : c
            )
          );
          
          console.log('Contact updated in local state');
          
          // Don't call onClientUpdate to prevent unnecessary re-fetches
        }
      } catch (error) {
        console.error('Error saving new lead contact:', error);
        alert('Failed to save contact');
      }
    }
  };

  // Function to change which contact is marked as main
  const handleSetMainContact = async (contactId: number) => {
    // Check if this is a legacy lead
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    try {
      // First, fetch the contact details that will become the main contact
      const { data: contactData, error: contactError } = await supabase
        .from('leads_contact')
        .select('id, name, email, phone, mobile, country_id')
        .eq('id', contactId)
        .single();
      
      if (contactError || !contactData) {
        throw new Error('Failed to fetch contact details');
      }
      
      if (isLegacyLead) {
        const legacyId = client.id.toString().replace('legacy_', '');
        
        // First, set all contacts for this lead to main = 'false'
        const { error: clearError } = await supabase
          .from('lead_leadcontact')
          .update({ main: 'false' })
          .eq('lead_id', legacyId);
        
        if (clearError) throw clearError;
        
        // Then set the selected contact to main = 'true'
        const { error: setError } = await supabase
          .from('lead_leadcontact')
          .update({ main: 'true' })
          .eq('lead_id', legacyId)
          .eq('contact_id', contactId);
        
        if (setError) throw setError;
        
        // Update leads_lead table with main contact details
        const { error: updateLeadError } = await supabase
          .from('leads_lead')
          .update({
            name: contactData.name || null,
            email: contactData.email || null,
            phone: contactData.phone || null,
            mobile: contactData.mobile || null,
          })
          .eq('id', parseInt(legacyId));
        
        if (updateLeadError) {
          console.error('Error updating leads_lead with main contact details:', updateLeadError);
          // Don't throw - this is a secondary update, main contact setting already succeeded
        } else {
          console.log('✅ Updated leads_lead table with main contact details');
        }
      } else {
        const newLeadId = client.id; // UUID for new leads
        
        // First, set all contacts for this lead to main = 'false'
        const { error: clearError } = await supabase
          .from('lead_leadcontact')
          .update({ main: 'false' })
          .eq('newlead_id', newLeadId);
        
        if (clearError) throw clearError;
        
        // Then set the selected contact to main = 'true'
        const { error: setError } = await supabase
          .from('lead_leadcontact')
          .update({ main: 'true' })
          .eq('newlead_id', newLeadId)
          .eq('contact_id', contactId);
        
        if (setError) throw setError;
        
        // Update leads table with main contact details
        const { error: updateLeadError } = await supabase
          .from('leads')
          .update({
            name: contactData.name || null,
            email: contactData.email || null,
            phone: contactData.phone || null,
            mobile: contactData.mobile || null,
          })
          .eq('id', newLeadId);
        
        if (updateLeadError) {
          console.error('Error updating leads table with main contact details:', updateLeadError);
          // Don't throw - this is a secondary update, main contact setting already succeeded
        } else {
          console.log('✅ Updated leads table with main contact details');
        }
      }
      
      // Update local state
      setContacts(contacts.map(c => ({
        ...c,
        isMain: c.id === contactId
      })));
        
        // Refresh client data in parent component
        if (onClientUpdate) {
          await onClientUpdate();
        }
      
      toast.success('Main contact updated successfully');
      } catch (error) {
      console.error('Error setting main contact:', error);
      toast.error('Failed to update main contact');
    }
  };

  const handleDeleteContact = async (id: number) => {
    if (contacts.find(c => c.id === id)?.isMain) {
      alert('Cannot delete the main contact');
      return;
    }

    // Check if this is a legacy lead
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      // For legacy leads, delete from lead_leadcontact table
      try {
        const legacyId = client.id.toString().replace('legacy_', '');
        
        // Find the contact to get its contact_id
        const contactToDelete = contacts.find(c => c.id === id);
        if (!contactToDelete) {
          throw new Error('Contact not found');
        }
        
        // Delete the relationship from lead_leadcontact table
        const { error: relationshipError } = await supabase
          .from('lead_leadcontact')
          .delete()
          .eq('lead_id', legacyId)
          .eq('contact_id', contactToDelete.id);
        
        if (relationshipError) throw relationshipError;
        
        // Note: We don't delete from leads_contact table as the contact might be used by other leads
        // Only the relationship is deleted
        
        setContacts(contacts.filter(c => c.id !== id));
        
        console.log('Legacy contact relationship deleted successfully');
        
        // Refresh client data in parent component
        if (onClientUpdate) {
          await onClientUpdate();
        }
      } catch (error) {
        console.error('Error deleting legacy contact:', error);
        alert('Failed to delete legacy contact');
      }
    } else {
      // For new leads, delete from lead_leadcontact table
      try {
        const newLeadId = client.id; // UUID for new leads
        
        // Find the contact to get its contact_id
        const contactToDelete = contacts.find(c => c.id === id);
        if (!contactToDelete) {
          throw new Error('Contact not found');
        }
        
        // Delete the relationship from lead_leadcontact table
        const { error: relationshipError } = await supabase
          .from('lead_leadcontact')
          .delete()
          .eq('newlead_id', newLeadId)
          .eq('contact_id', contactToDelete.id);
        
        if (relationshipError) throw relationshipError;
        
        // Note: We don't delete from leads_contact table as the contact might be used by other leads
        // Only the relationship is deleted

        setContacts(contacts.filter(c => c.id !== id));
        
        console.log('Contact relationship deleted successfully');
        
        // Refresh client data in parent component
        if (onClientUpdate) {
          await onClientUpdate();
        }
      } catch (error) {
        console.error('Error deleting new lead contact:', error);
        alert('Failed to delete contact');
      }
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
    
    // Check if stage is >= 40 (Waiting for mtng sum and on)
    // Handle both numeric and string stages
    let currentStage = 0;
    if (typeof client.stage === 'number') {
      currentStage = client.stage;
    } else if (client.stage) {
      const parsed = parseInt(String(client.stage), 10);
      currentStage = isNaN(parsed) ? 0 : parsed;
    }
    
    if (currentStage < 40) {
      toast.error('Contracts can only be created from stage 40 (Waiting for mtng sum) onwards.');
      return;
    }
    
    if (!contractForm.selectedTemplateId || !client?.id || !contractForm.contactId || !contractForm.selectedCurrency) {
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
      
      // Initialize customPricing with correct currency based on selected currency
      const isIsraeliCurrency = contractForm.selectedCurrency.iso_code === 'ILS' || contractForm.selectedCurrency.iso_code === 'NIS' || contractForm.selectedCurrency.name === '₪';
      const currency = contractForm.selectedCurrency.name;
      
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
      
      // Use template default pricing tiers based on currency selection
      // USD/GBP/EUR share the same pricing tiers, NIS has separate tiers
      if (contractForm.selectedCurrency.iso_code === 'ILS' || contractForm.selectedCurrency.iso_code === 'NIS') {
        // NIS currency - use NIS pricing tiers
        if (selectedTemplate?.default_pricing_tiers_nis) {
          Object.assign(pricingTiers, selectedTemplate.default_pricing_tiers_nis);
        } else if (selectedTemplate?.default_pricing_tiers) {
          // Fallback to legacy
          Object.assign(pricingTiers, selectedTemplate.default_pricing_tiers);
        }
      } else {
        // USD/GBP/EUR currencies - use USD pricing tiers
        if (selectedTemplate?.default_pricing_tiers_usd) {
          Object.assign(pricingTiers, selectedTemplate.default_pricing_tiers_usd);
        } else if (selectedTemplate?.default_pricing_tiers) {
          // Fallback to legacy
          Object.assign(pricingTiers, selectedTemplate.default_pricing_tiers);
        }
      }
      
      // If no template pricing tiers, use system defaults
      if (Object.keys(pricingTiers).length === 0) {
        tierStructure.forEach(tier => {
          const priceTier = getPricePerApplicant(tier.count, isIsraeliCurrency);
          const pricePerApplicant = isIsraeliCurrency && 'priceWithVat' in priceTier ? priceTier.priceWithVat : priceTier.price;
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
      // 850 for USD/GBP/EUR, 1650 for NIS
      let archivalFee = 0;
      if (archivalResearch === 'with' && contractForm.selectedCurrency) {
        const isoCode = contractForm.selectedCurrency.iso_code?.toUpperCase();
        const currencyName = contractForm.selectedCurrency.name;
        
        // Check for NIS (1650)
        if (isoCode === 'ILS' || isoCode === 'NIS' || currencyName === '₪') {
          archivalFee = 1650;
        }
        // Check for USD/GBP/EUR (850)
        else if (isoCode === 'USD' || isoCode === 'GBP' || isoCode === 'EUR' 
                 || currencyName === '$' || currencyName === '£' || currencyName === '€') {
          archivalFee = 850;
        }
      }

      // Calculate due dates
      const today = new Date();
      const addDays = (days: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
      };

      // Calculate VAT rate (17% for NIS, 0% for others)
      const vatRate = includeVAT && isIsraeliCurrency ? 0.17 : 0;

      let paymentPlan;
      if (archivalResearch === 'with' && archivalFee > 0) {
        // First payment: 100% of archival research fee
        // Remaining: default plan for the rest
        const restAmount = total - archivalFee;
        const archivalFeeVAT = Math.round(archivalFee * vatRate);
        paymentPlan = [
          { percent: 100, due_date: addDays(0), value: archivalFee, value_vat: archivalFeeVAT, payment_order: 'Archival Research', notes: '', currency },
        ];
        if (restAmount > 0) {
          const restAmount50 = Math.round(restAmount * 0.5);
          const restAmount25 = Math.round(restAmount * 0.25);
          paymentPlan = paymentPlan.concat([
            { percent: 50, due_date: addDays(0), value: restAmount50, value_vat: Math.round(restAmount50 * vatRate), payment_order: 'First Payment', notes: '', currency },
            { percent: 25, due_date: addDays(30), value: restAmount25, value_vat: Math.round(restAmount25 * vatRate), payment_order: 'Intermediate Payment', notes: '', currency },
            { percent: 25, due_date: addDays(60), value: Math.round(restAmount * 0.25), value_vat: Math.round(Math.round(restAmount * 0.25) * vatRate), payment_order: 'Final Payment', notes: '', currency },
          ]);
        }
      } else {
        const payment50 = Math.round(finalAmount * 0.5);
        const payment25 = Math.round(finalAmount * 0.25);
        paymentPlan = [
          { percent: 50, due_date: addDays(0), value: payment50, value_vat: Math.round(payment50 * vatRate), payment_order: 'First Payment', notes: '', currency },
          { percent: 25, due_date: addDays(30), value: payment25, value_vat: Math.round(payment25 * vatRate), payment_order: 'Intermediate Payment', notes: '', currency },
          { percent: 25, due_date: addDays(60), value: payment25, value_vat: Math.round(payment25 * vatRate), payment_order: 'Final Payment', notes: '', currency },
        ];
      }
      
      // Check if template is from legacy table (misc_contracttemplate) - these have numeric IDs, not UUIDs
      const isLegacyTemplate = selectedTemplate?.sourceTable === 'misc_contracttemplate';
      
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
        include_vat: includeVAT,
        // Store legacy template ID in custom_pricing for future reference
        ...(isLegacyTemplate && { legacy_template_id: contractForm.selectedTemplateId }),
      };

      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      
      console.log('handleCreateContract: Debug info:', {
        clientId: client?.id,
        clientLeadType: client?.lead_type,
        isLegacyLead,
        clientIdType: typeof client?.id
      });
      
      // Check if there's already a contract for this lead (only one contract per lead allowed)
      if (!isLegacyLead) {
        const { data: existingContracts, error: checkError } = await supabase
          .from('contracts')
          .select('id')
          .eq('client_id', client.id)
          .limit(1);
        
        if (checkError) {
          console.error('Error checking existing contracts:', checkError);
        } else if (existingContracts && existingContracts.length > 0) {
          toast.error('Only one contract per lead is allowed. Please delete the existing contract first.');
          return;
        }
      }
      
      // Create contract data with contact association
      const contractData: any = {
        // For legacy templates, template_id must be NULL since contracts.template_id is UUID type
        // Legacy template ID is stored in custom_pricing.legacy_template_id
        template_id: isLegacyTemplate ? null : contractForm.selectedTemplateId,
        status: 'draft',
        contact_id: contractForm.contactId, // Associate with specific contact
        contact_name: contactName, // Save the actual contact name
        contact_email: contactEmail, // Save contact email
        contact_phone: contactPhone, // Save contact phone
        contact_mobile: contactMobile, // Save contact mobile
        applicant_count: contractForm.applicantCount,
        client_country: contractForm.selectedCurrency.name,
        custom_pricing: initialCustomPricing, // Save initial customPricing with legacy_template_id if needed
      };
      
      // Set the appropriate ID field based on lead type
      if (isLegacyLead) {
        const legacyId = client.id.toString().replace('legacy_', '');
        console.log('handleCreateContract: Legacy lead detected, legacyId:', legacyId);
        contractData.legacy_id = parseInt(legacyId);
        contractData.client_id = null; // Set to null for legacy leads
        console.log('handleCreateContract: Set legacy_id to:', contractData.legacy_id, 'and client_id to null');
      } else {
        console.log('handleCreateContract: New lead detected, using client_id:', client.id);
        contractData.client_id = client.id; // Use UUID for new leads
        contractData.legacy_id = null; // Set to null for new leads
      }
      console.log('handleCreateContract: Inserting contract data:', contractData);
      
      // Create the contract record
      const { data: contract, error } = await supabase
        .from('contracts')
        .insert([contractData])
        .select()
        .single();

      console.log('handleCreateContract: Insert result:', { contract, error });

      if (error) throw error;

      // Assign the contract to all contacts (since only one contract per lead is allowed)
      const contractInfo = {
          id: contract.id, 
          name: contractTemplates.find(t => t.id === contractForm.selectedTemplateId)?.name || 'Contract',
          status: 'draft',
          signed_at: undefined
      };
      
      setContactContracts(prev => {
        const updated = { ...prev };
        // Assign contract to all contacts
        contacts.forEach(contact => {
          updated[contact.id] = contractInfo;
        });
        return updated;
      });

      setShowContractCreation(false);
      setTemplateSearchQuery(''); // Reset search when closing
      setShowTemplateDropdown(false); // Close dropdown when closing
      setContractForm({
        applicantCount: 1,
        selectedCurrency: null,
        selectedTemplateId: '',
        contactId: null,
      });

      // Automatically navigate to the contract page using just contractId
      if (contract && contract.id) {
        navigate(`/contract/${contract.id}`);
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
    console.log('🔍 handleViewContract called with contractId:', contractId);
    
    // Check if this is a legacy contract
    if (contractId && contractId.startsWith('legacy_')) {
      console.log('🔍 Legacy contract detected');
      
      // For legacy contracts, find the contract data and display it in a modal
      const legacyContractId = contractId.replace('legacy_', '');
      console.log('🔍 Legacy contract ID:', legacyContractId);
      
      // Find the contract data in contactContracts
      const contractData = Object.values(contactContracts).find(contract => 
        contract && contract.id === contractId
      );
      
      console.log('🔍 Found contract data:', contractData);
      
      if (contractData && contractData.isLegacy) {
        console.log('🔍 Setting up legacy contract modal');
        
        // Determine if contract is signed or draft
        const hasSignedContract = contractData.signedContractHtml && 
          contractData.signedContractHtml.trim() !== '' && 
          contractData.signedContractHtml !== '\\N';
        const hasDraftContract = contractData.contractHtml && contractData.contractHtml.trim() !== '';
        
        console.log('🔍 Contract status check:', { hasSignedContract, hasDraftContract });
        
        if (hasSignedContract || hasDraftContract) {
          // Set the contract data for viewing in modal
          const contractContent = hasSignedContract ? contractData.signedContractHtml : contractData.contractHtml;
          console.log('🔍 Contract content being set:', contractContent?.substring(0, 500) + '...');
          
          setViewingContract({
            id: contractId,
            mode: hasSignedContract ? 'view' : 'edit', // If signed, view only; if draft, editable
            contractHtml: contractContent,
            signedContractHtml: contractData.signedContractHtml,
            status: hasSignedContract ? 'signed' : 'draft'
          });
          
          console.log('🔍 Set viewingContract with mode:', hasSignedContract ? 'view' : 'edit', 'and status:', hasSignedContract ? 'signed' : 'draft');
          return;
        } else {
          console.log('🔍 No contract content found');
          alert('No contract content found for this legacy contract.');
          return;
        }
      }
    }
    
    // For new contracts, use the existing navigation logic
    if (client.lead_number) {
      // Check if this is a sub-lead and if the contract belongs to the master lead
      const isSubLead = client.lead_number.includes('/');
      let targetLeadNumber = client.lead_number;
      
      if (isSubLead && contractId) {
        // Fetch the contract to check which client_id it belongs to
        const { data: contractData } = await supabase
          .from('contracts')
          .select('client_id')
          .eq('id', contractId)
          .maybeSingle();
        
        if (contractData?.client_id) {
          // Extract master lead number
          const masterLeadNumber = client.lead_number.split('/')[0];
          
          // Fetch master lead to get its UUID
          const { data: masterLead } = await supabase
            .from('leads')
            .select('id, lead_number')
            .eq('lead_number', masterLeadNumber)
            .maybeSingle();
          
          // If contract belongs to master lead, use master lead number in URL
          if (masterLead && masterLead.id === contractData.client_id && masterLead.lead_number) {
            targetLeadNumber = masterLead.lead_number;
            console.log('🔍 Contract belongs to master lead, using master lead number:', targetLeadNumber);
          }
        }
      }
      
      // Navigate to contract using just contractId - simpler link
      if (contractId) {
        navigate(`/contract/${contractId}`);
      } else if (mostRecentContract?.id) {
        navigate(`/contract/${mostRecentContract.id}`);
      } else {
        alert('No contract found for this client.');
      }
    } else if (contractId) {
      // Navigate to contract using just contractId
      navigate(`/contract/${contractId}`);
    } else if (mostRecentContract?.id) {
      navigate(`/contract/${mostRecentContract.id}`);
    } else {
      alert('No contract found for this client.');
    }
  };

  return (
    <Fragment>
      <div className="w-full overflow-x-hidden">
        <div className="p-2 sm:p-4 md:p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-8 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
              <UserIcon className="w-6 h-6 text-white" />
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
                  className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-visible"
                >
                  {/* Header */}
                  <div className="pl-6 pr-4 pt-2 pb-2 w-full bg-gradient-to-r from-purple-600 to-blue-600 rounded-tr-2xl rounded-br-2xl shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <h4 className="text-lg font-semibold text-white">
                          {contact.name && contact.name !== '---' ? contact.name : 'Contact'}
                        </h4>
                        {contact.isMain && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-white text-[#3b28c7] whitespace-nowrap">
                            Main
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!contact.isMain && (
                          <button
                            className="btn btn-xs btn-ghost text-white hover:bg-white/20 border-white/30 whitespace-nowrap"
                            onClick={() => {
                              if (window.confirm('Set this contact as the main contact?')) {
                                handleSetMainContact(contact.id);
                              }
                            }}
                            title="Set as main contact"
                          >
                            Set as Main
                          </button>
                        )}
                        {/* Edit and Delete buttons - icon only */}
                        {((contact.isMain && !isEditingMainContact) || (!contact.isMain && !contact.isEditing)) && (
                          <>
                            <button
                              className="btn btn-ghost btn-sm btn-circle text-white hover:bg-white/20 border-white/30"
                              onClick={async () => {
                                if (contact.isMain) {
                                  console.log('🔍 Edit button clicked - current contact data:', contact);
                                  const editedData = {
                                    name: (contact.name && contact.name !== '---') ? contact.name : '',
                                    mobile: (contact.mobile && contact.mobile !== '---') ? contact.mobile : '',
                                    phone: (contact.phone && contact.phone !== '---') ? contact.phone : '',
                                    email: (contact.email && contact.email !== '---') ? contact.email : '',
                                    country_id: contact.country_id || null
                                  };
                                  setEditedMainContact(editedData);
                                  setIsEditingMainContact(true);
                                  // Sync country search term
                                  const countryName = contact.country_id ? countries.find(c => c.id === contact.country_id)?.name || '' : '';
                                  setMainContactCountrySearchTerm(countryName);
                                } else {
                                  setContacts(contacts.map(c => c.id === contact.id ? { ...c, isEditing: true } : c));
                                  // Sync country search term for this contact
                                  const countryName = contact.country_id ? countries.find(c => c.id === contact.country_id)?.name || '' : '';
                                  setContactCountrySearchTerms({ ...contactCountrySearchTerms, [contact.id]: countryName });
                                }
                              }}
                              title="Edit contact"
                            >
                              <PencilSquareIcon className="w-4 h-4" />
                            </button>
                            {!contact.isMain && (
                              <button
                                className="btn btn-ghost btn-sm btn-circle text-white hover:bg-red-500/30 border-white/30"
                                onClick={() => {
                                  if (window.confirm('Are you sure you want to delete this contact?')) {
                                    handleDeleteContact(contact.id);
                                  }
                                }}
                                title="Delete contact"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                        {/* Save and Cancel buttons in edit mode - icon only */}
                        {((contact.isMain && isEditingMainContact) || contact.isEditing) && (
                          <>
                            <button
                              className="btn btn-ghost btn-sm btn-circle text-white hover:bg-green-500/30 border-white/30"
                              onClick={async () => {
                                if (contact.isMain) {
                                  await handleSaveMainContact();
                                } else {
                                  await handleSaveContact(contact.id, contact);
                                }
                              }}
                              title="Save changes"
                            >
                              <CheckIcon className="w-4 h-4" />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm btn-circle text-white hover:bg-white/20 border-white/30"
                              onClick={() => contact.isMain ? handleCancelMainContact() : handleCancelContact(contact)}
                              title="Cancel editing"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
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
                              <div className="relative w-40" ref={mainContactMobileCodeInputRef}>
                                <input
                                  type="text"
                                  className="input input-bordered w-full"
                                  value={mainContactMobileCodeSearchTerm}
                                  onChange={(e) => {
                                    setMainContactMobileCodeSearchTerm(e.target.value);
                                    setShowMainContactMobileCodeDropdown(true);
                                  }}
                                  onFocus={() => {
                                    setShowMainContactMobileCodeDropdown(true);
                                    setMainContactMobileCodeSearchTerm('');
                                  }}
                                  placeholder={selectedMainContactMobileCode || '+972'}
                                />
                                {showMainContactMobileCodeDropdown && getFilteredCountryCodeOptions(mainContactMobileCodeSearchTerm).length > 0 && (
                                  <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                    {getFilteredCountryCodeOptions(mainContactMobileCodeSearchTerm).map(country => (
                                      <button
                                        key={`${country.phone_code}-${country.id}`}
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                                        onClick={() => {
                                          setSelectedMainContactMobileCode(country.phone_code);
                                          setMainContactMobileCodeSearchTerm(country.phone_code);
                                          setShowMainContactMobileCodeDropdown(false);
                                          const currentParsed = parsePhoneNumber(editedMainContact.mobile);
                                          const newNumber = currentParsed.number ? formatPhoneNumber(country.phone_code, currentParsed.number) : country.phone_code;
                                          setEditedMainContact({
                                            ...editedMainContact,
                                            mobile: newNumber
                                          });
                                        }}
                                      >
                                        {country.phone_code} {country.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {showMainContactMobileCodeDropdown && getFilteredCountryCodeOptions(mainContactMobileCodeSearchTerm).length === 0 && mainContactMobileCodeSearchTerm && (
                                  <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                                    No country codes found
                                  </div>
                                )}
                              </div>
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
                              <div 
                                className="relative w-40"
                                ref={(el) => {
                                  if (el) {
                                    contactMobileCodeInputRefs.current[contact.id] = el;
                                  } else {
                                    delete contactMobileCodeInputRefs.current[contact.id];
                                  }
                                }}
                              >
                                <input
                                  type="text"
                                  className="input input-bordered w-full"
                                  value={contactMobileCodeSearchTerms[contact.id] || ''}
                                  onChange={(e) => {
                                    setContactMobileCodeSearchTerms({ ...contactMobileCodeSearchTerms, [contact.id]: e.target.value });
                                    setShowContactMobileCodeDropdowns({ ...showContactMobileCodeDropdowns, [contact.id]: true });
                                  }}
                                  onFocus={() => {
                                    setShowContactMobileCodeDropdowns({ ...showContactMobileCodeDropdowns, [contact.id]: true });
                                    setContactMobileCodeSearchTerms({ ...contactMobileCodeSearchTerms, [contact.id]: '' });
                                  }}
                                  placeholder={selectedContactMobileCodes[contact.id] || parsePhoneNumber(contact.mobile).countryCode || '+972'}
                                />
                                {showContactMobileCodeDropdowns[contact.id] && getFilteredCountryCodeOptions(contactMobileCodeSearchTerms[contact.id] || '').length > 0 && (
                                  <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                    {getFilteredCountryCodeOptions(contactMobileCodeSearchTerms[contact.id] || '').map(country => (
                                      <button
                                        key={`${country.phone_code}-${country.id}`}
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                                        onClick={() => {
                                          setSelectedContactMobileCodes({ ...selectedContactMobileCodes, [contact.id]: country.phone_code });
                                          setContactMobileCodeSearchTerms({ ...contactMobileCodeSearchTerms, [contact.id]: country.phone_code });
                                          setShowContactMobileCodeDropdowns({ ...showContactMobileCodeDropdowns, [contact.id]: false });
                                          const currentParsed = parsePhoneNumber(contact.mobile);
                                          const newNumber = currentParsed.number ? formatPhoneNumber(country.phone_code, currentParsed.number) : country.phone_code;
                                          setContacts(contacts.map(c => c.id === contact.id ? {
                                            ...c,
                                            mobile: newNumber
                                          } : c));
                                        }}
                                      >
                                        {country.phone_code} {country.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {showContactMobileCodeDropdowns[contact.id] && getFilteredCountryCodeOptions(contactMobileCodeSearchTerms[contact.id] || '').length === 0 && contactMobileCodeSearchTerms[contact.id] && (
                                  <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                                    No country codes found
                                  </div>
                                )}
                              </div>
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
                              <div className="relative w-40" ref={mainContactPhoneCodeInputRef}>
                                <input
                                  type="text"
                                  className="input input-bordered w-full"
                                  value={mainContactPhoneCodeSearchTerm}
                                  onChange={(e) => {
                                    setMainContactPhoneCodeSearchTerm(e.target.value);
                                    setShowMainContactPhoneCodeDropdown(true);
                                  }}
                                  onFocus={() => {
                                    setShowMainContactPhoneCodeDropdown(true);
                                    setMainContactPhoneCodeSearchTerm('');
                                  }}
                                  placeholder={selectedMainContactPhoneCode || '+972'}
                                />
                                {showMainContactPhoneCodeDropdown && getFilteredCountryCodeOptions(mainContactPhoneCodeSearchTerm).length > 0 && (
                                  <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                    {getFilteredCountryCodeOptions(mainContactPhoneCodeSearchTerm).map(country => (
                                      <button
                                        key={`${country.phone_code}-${country.id}`}
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                                        onClick={() => {
                                          setSelectedMainContactPhoneCode(country.phone_code);
                                          setMainContactPhoneCodeSearchTerm(country.phone_code);
                                          setShowMainContactPhoneCodeDropdown(false);
                                          const currentParsed = parsePhoneNumber(editedMainContact.phone);
                                          const newNumber = currentParsed.number ? formatPhoneNumber(country.phone_code, currentParsed.number) : country.phone_code;
                                          setEditedMainContact({
                                            ...editedMainContact,
                                            phone: newNumber
                                          });
                                        }}
                                      >
                                        {country.phone_code} {country.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {showMainContactPhoneCodeDropdown && getFilteredCountryCodeOptions(mainContactPhoneCodeSearchTerm).length === 0 && mainContactPhoneCodeSearchTerm && (
                                  <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                                    No country codes found
                                  </div>
                                )}
                              </div>
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
                              <div 
                                className="relative w-40"
                                ref={(el) => {
                                  if (el) {
                                    contactPhoneCodeInputRefs.current[contact.id] = el;
                                  } else {
                                    delete contactPhoneCodeInputRefs.current[contact.id];
                                  }
                                }}
                              >
                                <input
                                  type="text"
                                  className="input input-bordered w-full"
                                  value={contactPhoneCodeSearchTerms[contact.id] || ''}
                                  onChange={(e) => {
                                    setContactPhoneCodeSearchTerms({ ...contactPhoneCodeSearchTerms, [contact.id]: e.target.value });
                                    setShowContactPhoneCodeDropdowns({ ...showContactPhoneCodeDropdowns, [contact.id]: true });
                                  }}
                                  onFocus={() => {
                                    setShowContactPhoneCodeDropdowns({ ...showContactPhoneCodeDropdowns, [contact.id]: true });
                                    setContactPhoneCodeSearchTerms({ ...contactPhoneCodeSearchTerms, [contact.id]: '' });
                                  }}
                                  placeholder={selectedContactPhoneCodes[contact.id] || parsePhoneNumber(contact.phone).countryCode || '+972'}
                                />
                                {showContactPhoneCodeDropdowns[contact.id] && getFilteredCountryCodeOptions(contactPhoneCodeSearchTerms[contact.id] || '').length > 0 && (
                                  <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                    {getFilteredCountryCodeOptions(contactPhoneCodeSearchTerms[contact.id] || '').map(country => (
                                      <button
                                        key={`${country.phone_code}-${country.id}`}
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                                        onClick={() => {
                                          setSelectedContactPhoneCodes({ ...selectedContactPhoneCodes, [contact.id]: country.phone_code });
                                          setContactPhoneCodeSearchTerms({ ...contactPhoneCodeSearchTerms, [contact.id]: country.phone_code });
                                          setShowContactPhoneCodeDropdowns({ ...showContactPhoneCodeDropdowns, [contact.id]: false });
                                          const currentParsed = parsePhoneNumber(contact.phone);
                                          const newNumber = currentParsed.number ? formatPhoneNumber(country.phone_code, currentParsed.number) : country.phone_code;
                                          setContacts(contacts.map(c => c.id === contact.id ? {
                                            ...c,
                                            phone: newNumber
                                          } : c));
                                        }}
                                      >
                                        {country.phone_code} {country.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {showContactPhoneCodeDropdowns[contact.id] && getFilteredCountryCodeOptions(contactPhoneCodeSearchTerms[contact.id] || '').length === 0 && contactPhoneCodeSearchTerms[contact.id] && (
                                  <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                                    No country codes found
                                  </div>
                                )}
                              </div>
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

                      {/* Country */}
                      <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Country</label>
                        <div className="flex-1 ml-4">
                          {contact.isMain && isEditingMainContact ? (
                            <div className="relative" ref={mainContactCountryInputRef}>
                              <input
                                type="text"
                                className="input input-bordered w-full"
                                value={mainContactCountrySearchTerm}
                                onChange={(e) => {
                                  setMainContactCountrySearchTerm(e.target.value);
                                  setShowMainContactCountryDropdown(true);
                                  if (e.target.value !== countries.find(c => c.id === editedMainContact.country_id)?.name) {
                                    setEditedMainContact({ ...editedMainContact, country_id: null });
                                  }
                                }}
                                onFocus={() => setShowMainContactCountryDropdown(true)}
                                placeholder="Search or type country..."
                              />
                              {showMainContactCountryDropdown && filteredMainContactCountryOptions.length > 0 && (
                                <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                  {filteredMainContactCountryOptions.map(country => (
                                    <button
                                      key={country.id}
                                      type="button"
                                      className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                                      onClick={() => handleMainContactCountrySelect(country.id, country.name)}
                                    >
                                  {country.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {showMainContactCountryDropdown && filteredMainContactCountryOptions.length === 0 && mainContactCountrySearchTerm && (
                                <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                                  No countries found
                                </div>
                              )}
                            </div>
                          ) : contact.isEditing ? (
                            <div 
                              className="relative" 
                              ref={(el) => {
                                if (el) {
                                  contactCountryInputRefs.current[contact.id] = el;
                                } else {
                                  delete contactCountryInputRefs.current[contact.id];
                                }
                              }}
                            >
                              <input
                                type="text"
                                className="input input-bordered w-full"
                                value={contactCountrySearchTerms[contact.id] || ''}
                                onChange={(e) => {
                                  setContactCountrySearchTerms({ ...contactCountrySearchTerms, [contact.id]: e.target.value });
                                  setShowContactCountryDropdowns({ ...showContactCountryDropdowns, [contact.id]: true });
                                  if (e.target.value !== countries.find(c => c.id === contact.country_id)?.name) {
                                    setContacts(contacts.map(c => c.id === contact.id ? { ...c, country_id: null } : c));
                                  }
                                }}
                                onFocus={() => setShowContactCountryDropdowns({ ...showContactCountryDropdowns, [contact.id]: true })}
                                placeholder="Search or type country..."
                              />
                              {showContactCountryDropdowns[contact.id] && getFilteredContactCountryOptions(contact.id).length > 0 && (
                                <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                  {getFilteredContactCountryOptions(contact.id).map(country => (
                                    <button
                                      key={country.id}
                                      type="button"
                                      className="w-full text-left px-4 py-2 hover:bg-base-200 transition-colors"
                                      onClick={() => handleContactCountrySelect(contact.id, country.id, country.name)}
                                    >
                                  {country.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {showContactCountryDropdowns[contact.id] && getFilteredContactCountryOptions(contact.id).length === 0 && contactCountrySearchTerms[contact.id] && (
                                <div className="absolute z-[9999] w-full bottom-full mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg p-4 text-center text-base-content/60">
                                  No countries found
                                </div>
                              )}
                            </div>
                          ) : contact.country_id ? (
                            <div className="text-base text-gray-900 text-right">
                              {countries.find(c => c.id === contact.country_id)?.name || '---'}
                            </div>
                          ) : (
                            <div className="text-base text-gray-500 text-right">---</div>
                          )}
                        </div>
                      </div>

                      {/* Contract - Only show for main contact */}
                      {contact.isMain && (
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
                                  contactContracts[contact.id]?.status === 'signed' ? 'bg-purple-600 text-white border-none' : 'badge-warning'
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
                            (() => {
                              // Check if stage is >= 40 (Waiting for mtng sum and on)
                              // Handle both numeric and string stages
                              let currentStage = 0;
                              if (typeof client.stage === 'number') {
                                currentStage = client.stage;
                              } else if (client.stage) {
                                const parsed = parseInt(String(client.stage), 10);
                                currentStage = isNaN(parsed) ? 0 : parsed;
                              }
                              
                              const canCreateContract = currentStage >= 40;
                              
                              if (!canCreateContract) {
                                return (
                                  <div className="text-xs text-gray-500 text-right">
                                    Unavailable
                                  </div>
                                );
                              }
                              
                              return (
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
                              );
                            })()
                          )}
                        </div>
                      </div>
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
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300 z-[9999]" onClick={() => {
            setShowContractCreation(false);
      setTemplateSearchQuery(''); // Reset search when closing
      setShowTemplateDropdown(false); // Close dropdown when closing
            setTemplateSearchQuery(''); // Reset search when closing
          }} />
          <div className="fixed top-0 right-0 h-screen w-full max-w-md bg-white shadow-2xl flex flex-col animate-slideInRight z-[10000] overflow-hidden">
            {/* Header - Fixed at top */}
            <div className="flex-shrink-0 p-8 pb-4 border-b border-gray-200">
              <button className="btn btn-ghost btn-circle absolute top-4 right-4" onClick={() => {
                setShowContractCreation(false);
                setTemplateSearchQuery(''); // Reset search when closing
                setShowTemplateDropdown(false); // Close dropdown when closing
              }}>
                <XMarkIcon className="w-6 h-6" />
              </button>
              <h2 className="text-2xl font-bold mb-2 pr-10">Create Contract</h2>
              {contractForm.contactId && (
                <p className="text-sm text-gray-600">
                  For: {contacts.find(c => c.id === contractForm.contactId)?.name || 'Unknown Contact'}
                </p>
              )}
            </div>
            
            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto p-8 pt-6 space-y-6">
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
                  value={contractForm.selectedCurrency?.id || ''}
                  onChange={(e) => {
                    const selectedCurrency = currencies.find(c => c.id === e.target.value);
                    setContractForm(prev => ({ ...prev, selectedCurrency: selectedCurrency || null }));
                  }}
                >
                  <option value="">Select a country/currency</option>
                  {currencies.map(currency => (
                    <option key={currency.id} value={currency.id}>
                      {currency.front_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price Preview */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3">Price Preview</h3>
                {(() => {
                  if (!contractForm.selectedTemplateId || !contractForm.selectedCurrency) {
                    // No template or currency selected: show zeroes
                    const currencySymbol = contractForm.selectedCurrency?.name || '$';
                    return (
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Per applicant:</span>
                          <span className="font-semibold">{currencySymbol} 0</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Total ({contractForm.applicantCount} applicants):</span>
                          <span className="font-bold text-lg text-primary">{currencySymbol} 0</span>
                        </div>
                      </div>
                    );
                  }
                  // Template selected: use its pricing tiers if available
                  const selectedTemplate = contractTemplates.find(t => t.id === contractForm.selectedTemplateId);
                  const isIsraeli = contractForm.selectedCurrency.iso_code === 'ILS' || contractForm.selectedCurrency.iso_code === 'NIS';
                  let perApplicant = 0;
                  let currencySymbol = contractForm.selectedCurrency.name; // Use currency symbol from selected currency
                  
                  // Get pricing tiers based on selected currency
                  let pricingTiers: { [key: string]: number } | null = null;
                  
                  if (isIsraeli) {
                    // NIS currency - use NIS pricing tiers
                    if (selectedTemplate?.default_pricing_tiers_nis) {
                      pricingTiers = selectedTemplate.default_pricing_tiers_nis;
                    } else if (selectedTemplate?.default_pricing_tiers) {
                      // Fallback to legacy
                      pricingTiers = selectedTemplate.default_pricing_tiers;
                    }
                  } else {
                    // USD/GBP/EUR currencies - use USD pricing tiers
                    if (selectedTemplate?.default_pricing_tiers_usd) {
                      pricingTiers = selectedTemplate.default_pricing_tiers_usd;
                    } else if (selectedTemplate?.default_pricing_tiers) {
                      // Fallback to legacy
                      pricingTiers = selectedTemplate.default_pricing_tiers;
                    }
                  }
                  
                  if (pricingTiers) {
                    // Use template's pricing tiers
                    const tierKey = getCurrentTierKey(contractForm.applicantCount);
                    perApplicant = pricingTiers[tierKey] || 0;
                  } else {
                    // Fallback to system pricing
                    const priceTier = getPricePerApplicant(contractForm.applicantCount, isIsraeli);
                    perApplicant = isIsraeli && 'priceWithVat' in priceTier ? priceTier.priceWithVat : priceTier.price;
                  }
                  
                  const total = perApplicant * contractForm.applicantCount;
                  const discount = 0;
                  const discountAmount = 0;
                  const finalAmount = total;

                  // Calculate archival fee based on selected currency
                  // 850 for USD/GBP/EUR, 1650 for NIS
                  let archivalFee = 0;
                  if (archivalResearch === 'with' && contractForm.selectedCurrency) {
                    const isoCode = contractForm.selectedCurrency.iso_code?.toUpperCase();
                    const currencyName = contractForm.selectedCurrency.name;
                    
                    // Check for NIS (1650)
                    if (isoCode === 'ILS' || isoCode === 'NIS' || currencyName === '₪') {
                      archivalFee = 1650;
                    }
                    // Check for USD/GBP/EUR (850)
                    else if (isoCode === 'USD' || isoCode === 'GBP' || isoCode === 'EUR' 
                             || currencyName === '$' || currencyName === '£' || currencyName === '€') {
                      archivalFee = 850;
                    }
                  }
                  
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Per applicant:</span>
                        <span className="font-semibold">{currencySymbol} {perApplicant.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total ({contractForm.applicantCount} applicants):</span>
                        <span className="font-bold text-lg text-primary">{currencySymbol} {total.toLocaleString()}</span>
                      </div>
                      {archivalResearch === 'with' && archivalFee > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Archival Research:</span>
                          <span className="font-semibold">{currencySymbol} {archivalFee.toLocaleString()}</span>
                        </div>
                      )}
                      {includeVAT && (() => {
                        const isIsraeli = contractForm.selectedCurrency?.iso_code === 'ILS' || contractForm.selectedCurrency?.iso_code === 'NIS' || contractForm.selectedCurrency?.name === '₪';
                        if (isIsraeli) {
                          const totalWithArchival = total + (archivalResearch === 'with' ? archivalFee : 0);
                          const vatAmount = Math.round(totalWithArchival * 0.17);
                          return (
                            <>
                              <div className="flex justify-between">
                                <span className="text-gray-600">VAT (17%):</span>
                                <span className="font-semibold">{currencySymbol} {vatAmount.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between pt-2 border-t border-gray-200">
                                <span className="text-gray-900 font-semibold">Total with VAT:</span>
                                <span className="font-bold text-lg text-primary">{currencySymbol} {(totalWithArchival + vatAmount).toLocaleString()}</span>
                              </div>
                            </>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  );
                })()}
              </div>

              {/* Template Selection */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-2">Contract Template</label>
                
                {/* Searchable Input with Dropdown */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search and select a template..."
                    className="input input-bordered w-full"
                    value={
                      contractForm.selectedTemplateId && !templateSearchQuery
                        ? contractTemplates.find(t => t.id === contractForm.selectedTemplateId)?.name || ''
                        : templateSearchQuery
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      setTemplateSearchQuery(value);
                      setShowTemplateDropdown(true);
                      // Clear selected template if user starts typing
                      if (contractForm.selectedTemplateId) {
                        setContractForm(prev => ({ ...prev, selectedTemplateId: '' }));
                      }
                    }}
                    onFocus={(e) => {
                      setShowTemplateDropdown(true);
                      // If template is selected, select all text for easy replacement
                      if (contractForm.selectedTemplateId && !templateSearchQuery) {
                        e.target.select();
                      }
                    }}
                    onBlur={() => {
                      // Delay closing to allow click on dropdown item
                      setTimeout(() => setShowTemplateDropdown(false), 200);
                    }}
                  />
                  
                  {/* Dropdown Arrow */}
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm"
                    onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                  >
                    <svg 
                      className={`w-4 h-4 transition-transform ${showTemplateDropdown ? 'rotate-180' : ''}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {/* Dropdown Menu */}
                  {showTemplateDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {contractTemplates
                        .filter(template => {
                          if (!templateSearchQuery.trim()) return true;
                          const searchLower = templateSearchQuery.toLowerCase();
                          return template.name.toLowerCase().includes(searchLower);
                        })
                        .length === 0 ? (
                          <div className="p-3 text-sm text-gray-500">
                            No templates found matching "{templateSearchQuery}"
                          </div>
                        ) : (
                          contractTemplates
                            .filter(template => {
                              if (!templateSearchQuery.trim()) return true;
                              const searchLower = templateSearchQuery.toLowerCase();
                              return template.name.toLowerCase().includes(searchLower);
                            })
                            .map(template => (
                              <div
                                key={template.id}
                                className={`px-4 py-2 cursor-pointer hover:bg-gray-100 ${
                                  contractForm.selectedTemplateId === template.id ? 'bg-blue-50' : ''
                                }`}
                                onMouseDown={(e) => {
                                  e.preventDefault(); // Prevent input blur
                                  setContractForm(prev => ({ ...prev, selectedTemplateId: template.id }));
                                  setTemplateSearchQuery('');
                                  setShowTemplateDropdown(false);
                                }}
                              >
                                {template.name}
                              </div>
                            ))
                        )}
                    </div>
                  )}
                </div>
                
                {/* Clear button if template is selected */}
                {contractForm.selectedTemplateId && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs mt-2"
                    onClick={() => {
                      setContractForm(prev => ({ ...prev, selectedTemplateId: '' }));
                      setTemplateSearchQuery('');
                    }}
                  >
                    Clear selection
                  </button>
                )}
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

              {/* VAT Option */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">VAT</label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="vat"
                      checked={!includeVAT}
                      onChange={() => setIncludeVAT(false)}
                      className="radio radio-primary"
                    />
                    <span>Exclude VAT</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="vat"
                      checked={includeVAT}
                      onChange={() => setIncludeVAT(true)}
                      className="radio radio-primary"
                    />
                    <span>Include VAT</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Footer - Fixed at bottom */}
            <div className="flex-shrink-0 p-8 pt-4 border-t border-gray-200 bg-white">
              <div className="flex gap-3">
                <button
                  className="btn btn-primary flex-1"
                  onClick={handleCreateContract}
                  disabled={!contractForm.selectedTemplateId}
                >
                  Create Contract
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowContractCreation(false);
                    setTemplateSearchQuery(''); // Reset search when closing
                    setShowTemplateDropdown(false); // Close dropdown when closing
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Legacy Contract Viewing Modal */}
      {viewingContract && viewingContract.contractHtml && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          <style>
            {`
              .inline-input {
                display: inline-block !important;
                vertical-align: middle !important;
                border: 2px solid #3b82f6 !important;
                border-radius: 6px !important;
                padding: 4px 8px !important;
                margin: 0 4px !important;
                min-width: 150px !important;
                font-family: inherit !important;
                font-size: 14px !important;
                background: #ffffff !important;
                color: #374151 !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                line-height: 1.5 !important;
                height: auto !important;
              }
              .signature-pad {
                display: inline-block !important;
                vertical-align: middle !important;
                border: 2px dashed #3b82f6 !important;
                border-radius: 6px !important;
                padding: 12px !important;
                margin: 0 4px !important;
                min-width: 180px !important;
                min-height: 50px !important;
                background: #f8fafc !important;
                cursor: pointer !important;
                text-align: center !important;
                font-size: 14px !important;
                color: #6b7280 !important;
                font-weight: 500 !important;
                line-height: 1.5 !important;
              }
              .signature-input {
                display: inline-block !important;
                vertical-align: middle !important;
                border: 2px solid #3b82f6 !important;
                border-radius: 6px !important;
                padding: 4px 8px !important;
                margin: 0 4px !important;
                min-width: 150px !important;
                font-family: inherit !important;
                font-size: 14px !important;
                background: #ffffff !important;
                color: #374151 !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                line-height: 1.5 !important;
                height: auto !important;
              }
              /* Right alignment for Hebrew text */
              .ql-align-right {
                text-align: right !important;
              }
              .ql-direction-rtl {
                direction: rtl !important;
              }
              /* Ensure paragraphs with right alignment are properly aligned */
              p.ql-align-right {
                text-align: right !important;
                direction: rtl !important;
              }
              /* Override any conflicting alignment */
              .prose p.ql-align-right {
                text-align: right !important;
                direction: rtl !important;
              }
              /* Specific styling for signature images */
              .signature-image {
                border: none !important;
                background: transparent !important;
                padding: 0 !important;
                margin: 0 !important;
                box-shadow: none !important;
                border-radius: 0 !important;
                display: inline-block !important;
                vertical-align: middle !important;
                max-width: 200px !important;
                max-height: 80px !important;
                object-fit: contain !important;
              }
            `}
          </style>
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gray-50 flex-shrink-0">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">
                  {viewingContract.mode === 'edit' ? 'Edit Legacy Contract' : 'Legacy Contract'}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Status: <span className={`font-semibold ${viewingContract.status === 'signed' ? 'text-green-600' : 'text-yellow-600'}`}>
                    {viewingContract.status === 'signed' ? 'Signed' : 'Draft'}
                  </span>
                  {viewingContract.mode === 'edit' && (
                    <span className="ml-2 text-blue-600 font-semibold">(Editable)</span>
                  )}
                </p>
              </div>
              <button
                className="btn btn-ghost btn-lg"
                onClick={() => setViewingContract(null)}
              >
                <XMarkIcon className="w-8 h-8" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 p-6 overflow-y-auto">
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-4">
                    {viewingContract.status === 'signed' 
                      ? 'Signed Contract (Read Only)' 
                      : viewingContract.mode === 'edit' 
                        ? 'Contract Draft (Editable)' 
                        : 'Contract Draft'
                    }
                  </h4>
                  {viewingContract.mode === 'edit' ? (
                    <div className="border border-gray-300 rounded-lg p-4 flex flex-col">
                      <div className="bg-white rounded-lg flex flex-col">
                        {/* Rich Text Toolbar */}
                        <div className="border-b border-gray-200 p-2 bg-gray-50">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => executeCommand('bold')}
                              className="btn btn-sm btn-ghost"
                              title="Bold"
                            >
                              <strong>B</strong>
                            </button>
                            <button
                              onClick={() => executeCommand('italic')}
                              className="btn btn-sm btn-ghost"
                              title="Italic"
                            >
                              <em>I</em>
                            </button>
                            <button
                              onClick={() => executeCommand('underline')}
                              className="btn btn-sm btn-ghost"
                              title="Underline"
                            >
                              <u>U</u>
                            </button>
                            <button
                              onClick={() => executeCommand('strikeThrough')}
                              className="btn btn-sm btn-ghost"
                              title="Strikethrough"
                            >
                              <s>S</s>
                            </button>
                            <div className="divider divider-horizontal mx-1"></div>
                            <button
                              onClick={() => executeCommand('formatBlock', 'p')}
                              className="btn btn-sm btn-ghost"
                              title="Paragraph"
                            >
                              P
                            </button>
                            <button
                              onClick={() => executeCommand('formatBlock', 'h1')}
                              className="btn btn-sm btn-ghost"
                              title="Heading 1"
                            >
                              H1
                            </button>
                            <button
                              onClick={() => executeCommand('formatBlock', 'h2')}
                              className="btn btn-sm btn-ghost"
                              title="Heading 2"
                            >
                              H2
                            </button>
                            <button
                              onClick={() => executeCommand('formatBlock', 'h3')}
                              className="btn btn-sm btn-ghost"
                              title="Heading 3"
                            >
                              H3
                            </button>
                            <div className="divider divider-horizontal mx-1"></div>
                            <button
                              onClick={() => executeCommand('insertUnorderedList')}
                              className="btn btn-sm btn-ghost"
                              title="Bullet List"
                            >
                              • List
                            </button>
                            <button
                              onClick={() => executeCommand('insertOrderedList')}
                              className="btn btn-sm btn-ghost"
                              title="Numbered List"
                            >
                              1. List
                            </button>
                            <div className="divider divider-horizontal mx-1"></div>
                            <button
                              onClick={() => executeCommand('justifyLeft')}
                              className="btn btn-sm btn-ghost"
                              title="Align Left"
                            >
                              ←
                            </button>
                            <button
                              onClick={() => executeCommand('justifyCenter')}
                              className="btn btn-sm btn-ghost"
                              title="Align Center"
                            >
                              ↔
                            </button>
                            <button
                              onClick={() => executeCommand('justifyRight')}
                              className="btn btn-sm btn-ghost"
                              title="Align Right"
                            >
                              →
                            </button>
                            <button
                              onClick={() => executeCommand('justifyFull')}
                              className="btn btn-sm btn-ghost"
                              title="Justify"
                            >
                              ≡
                            </button>
                          </div>
                        </div>
                        <div 
                          key={`editor-content-${viewingContract?.id}-${Date.now()}`}
                          className="flex-1 prose prose-lg max-w-none p-4 overflow-y-auto"
                          style={{ maxHeight: 'calc(100vh - 300px)' }}
                        >
                          {viewingContract?.contractHtml && (
                            <div 
                              className="prose prose-lg max-w-none"
                              contentEditable={viewingContract.mode === 'edit'}
                              suppressContentEditableWarning={true}
                              dangerouslySetInnerHTML={{ 
                                __html: viewingContract.mode === 'edit' 
                                  ? processHtmlForEditing(viewingContract.contractHtml)
                                  : processSignedContractHtml(viewingContract.signedContractHtml || viewingContract.contractHtml)
                              }} 
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gray-50 p-6 rounded-lg h-full overflow-y-auto">
                      <div className="prose prose-lg max-w-none">
                        <div 
                          className="font-sans text-base leading-relaxed text-gray-800"
                          dangerouslySetInnerHTML={{ __html: processSignedContractHtml(viewingContract.contractHtml || '') }}
                        />
                      </div>
                    </div>
                  )}
                </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-6 border-t border-gray-200 flex-shrink-0">
                              {/* Share button for both edit and signed modes */}
                <button
                  className="btn btn-info"
                  onClick={async () => {
                    try {
                      console.log('🔍 Creating share link for legacy contract');
                      
                      // Extract the legacy contract ID from the viewingContract.id
                      const legacyContractId = viewingContract.id.replace('legacy_', '');
                      console.log('🔍 Legacy contract ID for sharing:', legacyContractId);
                      
                      let publicToken = viewingContract.public_token;
                      
                      // For signed contracts, always fetch the actual token from database
                      if (viewingContract.status === 'signed') {
                        console.log('🔍 Fetching actual public token from database for signed contract');
                        const { data, error } = await supabase
                          .from('lead_leadcontact')
                          .select('public_token')
                          .eq('id', legacyContractId)
                          .single();
                        
                        if (error) {
                          console.error('❌ Error fetching public token:', error);
                          toast.error('Failed to get share link.');
                          return;
                        }
                        
                        publicToken = data?.public_token;
                        if (!publicToken) {
                          toast.error('No share link found for this contract.');
                          return;
                        }
                        
                        console.log('🔍 Found existing public token:', publicToken);
                      }
                      
                      // For draft contracts, generate a new token if it doesn't exist
                      if (viewingContract.status === 'draft' && !publicToken) {
                        publicToken = crypto.randomUUID();
                        console.log('🔍 Generated new public token for draft contract:', publicToken);
                        
                        // Update the contract with the public token
                        const { error } = await supabase
                          .from('lead_leadcontact')
                          .update({ public_token: publicToken })
                          .eq('id', legacyContractId);
                        
                        if (error) {
                          console.error('❌ Error updating legacy contract with public token:', error);
                          toast.error('Failed to create share link.');
                          return;
                        }
                      }
                      
                      // Create the public URL
                      const publicUrl = `${window.location.origin}/public-legacy-contract/${legacyContractId}/${publicToken}`;
                      console.log('🔍 Public URL created:', publicUrl);
                      
                      // Copy to clipboard
                      await navigator.clipboard.writeText(publicUrl);
                      toast.success('Share link copied to clipboard!');
                      
                    } catch (error) {
                      console.error('❌ Error creating share link:', error);
                      toast.error('Failed to create share link.');
                    }
                  }}
                >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                </svg>
                Share
              </button>
              
              {viewingContract.mode === 'edit' && (
                  <button
                    className="btn btn-success"
                    onClick={async () => {
                    try {
                      console.log('🔍 Saving edited legacy contract');
                      
                      if (!editor) {
                        alert('Editor not available');
                        return;
                      }
                      
                      // Get the content from the contentEditable div
                      const contentDiv = document.querySelector('[contenteditable="true"]');
                      if (!contentDiv) {
                        toast.error('Editor not found');
                        return;
                      }
                      
                      let htmlContent = contentDiv.innerHTML;
                      console.log('🔍 Content from editor:', htmlContent);
                      
                      // Extract values from input fields and replace them back with placeholders
                      const inputs = contentDiv.querySelectorAll('input.inline-input');
                      inputs.forEach((input) => {
                        const value = (input as HTMLInputElement).value || '_____________';
                        // Replace the input element with the value
                        const inputRegex = /<input[^>]*class="inline-input"[^>]*>/g;
                        htmlContent = htmlContent.replace(inputRegex, value);
                      });
                      
                      // Replace signature pad containers and signature inputs with placeholders
                      htmlContent = htmlContent.replace(
                        /<div[^>]*class="signature-pad"[^>]*>.*?<\/div>/gs,
                        '{{sig}}'
                      );
                      htmlContent = htmlContent.replace(
                        /<input[^>]*class="signature-input"[^>]*>/g,
                        '{{sig}}'
                      );
                      
                      console.log('🔍 Processed HTML content:', htmlContent);
                      
                      // Extract the legacy contract ID from the viewingContract.id
                      const legacyContractId = viewingContract.id.replace('legacy_', '');
                      console.log('🔍 Legacy contract ID to update:', legacyContractId);
                      
                      // Update the contract_html in lead_leadcontact table
                      const { error } = await supabase
                        .from('lead_leadcontact')
                        .update({ contract_html: htmlContent })
                        .eq('id', legacyContractId);
                      
                      if (error) {
                        console.error('❌ Error updating legacy contract:', error);
                        alert('Failed to save contract changes.');
                        return;
                      }
                      
                      console.log('✅ Legacy contract updated successfully');
                      alert('Contract saved successfully!');
                      
                      // Close the modal
                      setViewingContract(null);
                      
                      // Refresh the contracts data
                      if (onClientUpdate) {
                        await onClientUpdate();
                      }
                      
                    } catch (error) {
                      console.error('❌ Error saving legacy contract:', error);
                      alert('Failed to save contract changes.');
                    }
                  }}
                >
                  Save Changes
                </button>
              )}
              
              <button
                className="btn btn-primary"
                onClick={() => {
                  // Create a blob and download the contract
                  const htmlContent = viewingContract.status === 'signed' && viewingContract.signedContractHtml 
                    ? viewingContract.signedContractHtml 
                    : viewingContract.contractHtml || '';
                  
                  const blob = new Blob([htmlContent], { type: 'text/html' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `contract_${viewingContract.id}.html`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
              >
                Download Contract
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setViewingContract(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </Fragment>
  );
};

export default ContactInfoTab; 