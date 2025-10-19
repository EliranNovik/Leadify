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

  // State to track contract status
  const [contractStatuses, setContractStatuses] = useState<{ [id: string]: { status: string; signed_at?: string } }>({});

  // Add state for most recent contract (for backward compatibility)
  const [mostRecentContract, setMostRecentContract] = useState<any>(null);

  // Add state for archival research option
  const [archivalResearch, setArchivalResearch] = useState<'none' | 'with'>('none');

  // Add state for currencies from database
  const [currencies, setCurrencies] = useState<Array<{id: string, front_name: string, iso_code: string, name: string}>>([]);

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
  ];

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
        console.log('🔍 Fetching contracts for client:', client.id);
        
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
            
            // Assign legacy contracts to their respective contacts
            if (legacyContracts) {
              console.log('🔍 Processing legacy contracts:', legacyContracts);
              legacyContracts.forEach((legacyContract: any) => {
                console.log('🔍 Processing legacy contract:', legacyContract);
                if (legacyContract.contact_id) {
                  const hasContractHtml = legacyContract.contract_html && legacyContract.contract_html.trim() !== '';
                  const hasSignedContract = legacyContract.signed_contract_html && 
                    legacyContract.signed_contract_html.trim() !== '' && 
                    legacyContract.signed_contract_html !== '\\N';
                  
                  console.log('🔍 Contract status check:', { hasContractHtml, hasSignedContract, signedContractHtml: legacyContract.signed_contract_html });
                  
                  if (hasContractHtml || hasSignedContract) {
                    const status = hasSignedContract ? 'signed' : 'draft';
                    console.log('🔍 Setting contract status to:', status);
                    
                                                             // For legacy leads, use the actual contact_id from the legacy contract
                    const contactIdToUse = legacyContract.contact_id;
                    contactContractsMap[contactIdToUse] = {
                      id: `legacy_${legacyContract.id}`,
                      name: 'Legacy Contract',
                      status: status,
                      signed_at: hasSignedContract ? new Date().toISOString() : undefined,
                      isLegacy: true,
                      contractHtml: legacyContract.contract_html,
                      signedContractHtml: legacyContract.signed_contract_html
                    };
                    
                    console.log('🔍 Added legacy contract to map:', contactContractsMap[contactIdToUse]);
                  }
                }
              });
            }
            
            // Assign new contracts to their respective contacts (these will override legacy contracts if they exist)
            if (newContracts) {
              console.log('🔍 Processing new contracts:', newContracts);
              newContracts.forEach((contract: any) => {
                if (contract.contact_id) {
                  contactContractsMap[contract.contact_id] = {
                    id: contract.id,
                    name: contractTemplates.find(t => t.id === contract.template_id)?.name || 'Contract',
                    status: contract.status,
                    signed_at: contract.signed_at,
                    isLegacy: false
                  };
                }
              });
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
        }
      } catch (error) {
        console.error('❌ Error fetching contracts:', error);
      }
    })();
    return () => { mounted = false; };
  }, [client?.id]); // Removed contacts and contractTemplates to prevent infinite loops

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
                .select('id, name, mobile, phone, email, notes, address, additional_phones, additional_emails')
                .in('id', contactIds);
              
              console.log('🔍 Contacts query result:', { data: contacts, error: contactsError });
              
              if (contactsError) {
                console.error('❌ Error fetching contact details:', contactsError);
              } else if (contacts) {
                // Map contacts to their lead-contact relationships
                leadContacts.forEach((leadContact: any, index: number) => {
                  console.log('🔍 Processing lead contact:', leadContact);
                  
                  const contact = contacts.find((c: any) => c.id === leadContact.contact_id);
                  if (contact) {
                    console.log('🔍 Contact details found:', contact);
                    
                    // Check if this is the main contact (by name or email matching client data)
                    const isMainContact = (
                      (contact.name && client.name && contact.name.toLowerCase() === client.name.toLowerCase()) ||
                      (contact.email && client.email && contact.email.toLowerCase() === client.email.toLowerCase()) ||
                      (contact.mobile && client.mobile && contact.mobile === client.mobile)
                    );
                    
                    // Create contact entry with complete information from leads_contact table
                    const contactEntry: ContactEntry = {
                      id: contact.id, // Use the actual contact ID from leads_contact
                      name: contact.name || client.name || '---',
                      mobile: contact.mobile || client.mobile || '---',
                      phone: contact.phone || client.phone || '---',
                      email: contact.email || client.email || '---',
                      isMain: isMainContact || leadContact.main === 'true' || leadContact.main === true,
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
          
          console.log('🔍 Final contacts list:', contactEntries);
          setContacts(contactEntries);
          
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
        // For new leads, use the existing logic
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
      }
      
      setEditedMainContact({
        name: client.name || '',
        mobile: client.mobile || '',
        phone: client.phone || '',
        email: client.email || ''
      });
    };
    
    fetchContacts();
  }, [client]);

  // Fetch contract templates and currencies when component mounts
  useEffect(() => {
    // Fetch contract templates
    supabase.from('contract_templates').select('id, name, content, default_pricing_tiers, default_currency, default_country').then(({ data }) => {
      if (data) setContractTemplates(data);
    });

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
      // For legacy leads, we need to update the leads_lead table
      try {
        const legacyId = client.id.toString().replace('legacy_', '');
        
        const { error } = await supabase
          .from('leads_lead')
          .update({
            name: editedMainContact.name,
            mobile: editedMainContact.mobile,
            phone: editedMainContact.phone,
            email: editedMainContact.email
          })
          .eq('id', legacyId);

        if (error) throw error;

        setIsEditingMainContact(false);
        
        // Refresh client data in parent component
        if (onClientUpdate) {
          await onClientUpdate();
        }
      } catch (error) {
        console.error('Error updating legacy main contact:', error);
        alert('Failed to update contact information');
      }
    } else {
      // For new leads, use the existing logic
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

    // Check if this is a legacy lead
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    
    if (isLegacyLead) {
      // For legacy leads, we need to save to leads_contact and lead_leadcontact tables
      try {
        const legacyId = client.id.toString().replace('legacy_', '');
        const originalContact = contacts.find(c => c.id === id);
        const isNewContact = originalContact?.isEditing;
        
        if (isNewContact) {
          // Create new contact in leads_contact table
          const { data: newContact, error: contactError } = await supabase
            .from('leads_contact')
            .insert([{
              name: contact.name,
              mobile: contact.mobile,
              phone: contact.phone,
              email: contact.email,
              cdate: new Date().toISOString().split('T')[0],
              udate: new Date().toISOString().split('T')[0]
            }])
            .select('id')
            .single();
          
          if (contactError) throw contactError;
          
          // Create relationship in lead_leadcontact table
          const { error: relationshipError } = await supabase
            .from('lead_leadcontact')
            .insert([{
              contact_id: newContact.id,
              lead_id: legacyId,
              main: 'false'
              // ID will be auto-generated by the sequence
            }]);
          
          if (relationshipError) throw relationshipError;
          
          // Update local state with the new contact ID
          setContacts(contacts.map(c => 
            c.id === id ? { ...contact, id: newContact.id, isEditing: false } : c
          ));
          
          console.log('New legacy contact created successfully');
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
              udate: new Date().toISOString().split('T')[0]
            })
            .eq('id', contactToUpdate.id);
          
          if (updateError) throw updateError;
          setContacts(contacts.map(c => 
            c.id === id ? { ...contact, isEditing: false } : c
          ));
          
          console.log('Legacy contact updated in local state');
        }
        
        // Refresh client data in parent component
        if (onClientUpdate) {
          await onClientUpdate();
        }
      } catch (error) {
        console.error('Error saving legacy contact:', error);
        alert('Failed to save legacy contact');
      }
    } else {
      // For new leads, use the existing logic
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
      // For new leads, use the existing logic
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
      const isIsraeli = contractForm.selectedCurrency.iso_code === 'ILS';
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
        ? (contractForm.selectedCurrency.name === '₪' ? 1650 : contractForm.selectedCurrency.name === '$' ? 850 : 0)
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
            { percent: 50, due_date: addDays(0), value: Math.round(restAmount * 0.5), value_vat: 0, payment_order: 'First Payment', notes: '', currency },
            { percent: 25, due_date: addDays(30), value: Math.round(restAmount * 0.25), value_vat: 0, payment_order: 'Intermediate Payment', notes: '', currency },
            { percent: 25, due_date: addDays(60), value: Math.round(restAmount * 0.25), value_vat: 0, payment_order: 'Final Payment', notes: '', currency },
          ]);
        }
      } else {
        paymentPlan = [
          { percent: 50, due_date: addDays(0), value: Math.round(finalAmount * 0.5), value_vat: 0, payment_order: 'First Payment', notes: '', currency },
          { percent: 25, due_date: addDays(30), value: Math.round(finalAmount * 0.25), value_vat: 0, payment_order: 'Intermediate Payment', notes: '', currency },
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

      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      
      console.log('handleCreateContract: Debug info:', {
        clientId: client?.id,
        clientLeadType: client?.lead_type,
        isLegacyLead,
        clientIdType: typeof client?.id
      });
      
      // Create contract data with contact association
      const contractData: any = {
        template_id: contractForm.selectedTemplateId,
        status: 'draft',
        contact_id: contractForm.contactId, // Associate with specific contact
        contact_name: contactName, // Save the actual contact name
        contact_email: contactEmail, // Save contact email
        contact_phone: contactPhone, // Save contact phone
        contact_mobile: contactMobile, // Save contact mobile
        applicant_count: contractForm.applicantCount,
        client_country: contractForm.selectedCurrency.name,
        custom_pricing: initialCustomPricing, // Save initial customPricing with correct currency
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
        selectedCurrency: null,
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
            <div className="w-8 h-8 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
              <UserIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Contact Information</h2>
              <p className="text-sm text-gray-500">Manage client contacts and contracts</p>
            </div>
            
            {/* Debug button for legacy leads */}
            {(client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_')) && (
              <button 
                className="btn btn-outline btn-warning text-xs ml-auto"
                onClick={async () => {
                  console.log('🧪 Testing legacy contract functionality...');
                  console.log('🔍 Current client:', client);
                  console.log('🔍 Current contacts:', contacts);
                  console.log('🔍 Current contact contracts:', contactContracts);
                  
                  // Test fetching legacy contracts
                  const legacyId = client.id.toString().replace('legacy_', '');
                  console.log('🔍 Testing with legacy ID:', legacyId);
                  
                  const { data, error } = await supabase
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
                  
                  console.log('🧪 Legacy contract test result:', { data, error });
                  
                  if (data && data.length > 0) {
                    console.log('🧪 Found legacy contracts:', data);
                    data.forEach((contract, index) => {
                      console.log(`🧪 Contract ${index + 1}:`, {
                        id: contract.id,
                        contact_id: contract.contact_id,
                        has_contract_html: !!contract.contract_html,
                        has_signed_contract_html: !!contract.signed_contract_html
                      });
                    });
                  } else {
                    console.log('🧪 No legacy contracts found');
                  }
                  
                  toast.success('Check console for legacy contract test results');
                }}
                title="Test legacy contract functionality"
              >
                Test Legacy Contracts
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 w-full pb-6">
            {contacts.map((contact, index) => {
              return (
                <div
                  key={contact.id}
                  className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden"
                >
                  {/* Header */}
                  <div className="pl-6 pt-2 pb-2 w-2/5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-tr-2xl rounded-br-2xl shadow-sm">
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
                                  <option key={`${code.code}-${code.country}`} value={code.code}>
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
                                  <option key={`${code.code}-${code.country}`} value={code.code}>
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
                                  <option key={`${code.code}-${code.country}`} value={code.code}>
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
                                  <option key={`${code.code}-${code.country}`} value={code.code}>
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
                    const currency = contractForm.selectedCurrency?.iso_code || 'USD';
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
                  const isIsraeli = contractForm.selectedCurrency.iso_code === 'ILS';
                  let perApplicant = 0;
                  let currency = contractForm.selectedCurrency.iso_code;
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
                    ? (contractForm.selectedCurrency?.name === '₪' ? 1650 : contractForm.selectedCurrency?.name === '$' ? 850 : 0)
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
                        { percent: 50, due_date: addDays(0), value: Math.round(restAmount * 0.5), value_vat: 0, payment_order: 'First Payment', notes: '', currency },
                        { percent: 25, due_date: addDays(30), value: Math.round(restAmount * 0.25), value_vat: 0, payment_order: 'Intermediate Payment', notes: '', currency },
                        { percent: 25, due_date: addDays(60), value: Math.round(restAmount * 0.25), value_vat: 0, payment_order: 'Final Payment', notes: '', currency },
                      ]);
                    }
                  } else {
                    paymentPlan = [
                      { percent: 50, due_date: addDays(0), value: Math.round(finalAmount * 0.5), value_vat: 0, payment_order: 'First Payment', notes: '', currency },
                      { percent: 25, due_date: addDays(30), value: Math.round(finalAmount * 0.25), value_vat: 0, payment_order: 'Intermediate Payment', notes: '', currency },
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
                          <span className="font-semibold">{contractForm.selectedCurrency?.name || '$'} {archivalFee.toLocaleString()}</span>
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