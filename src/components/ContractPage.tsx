import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { FontSize } from '@tiptap/extension-font-size';
import { CheckIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import { handleContractSigned } from '../lib/contractAutomation';
import { getPricePerApplicant } from '../lib/contractPricing';
import SignaturePad from 'react-signature-canvas';
import { v4 as uuidv4 } from 'uuid';
// Import Heroicons for plus/minus
import { PlusIcon, MinusIcon } from '@heroicons/react/24/solid';

function fillAllPlaceholders(text: string, customPricing: any, client: any, contract?: any) {
  if (!text) return text;
  let result = text;
  if (customPricing) {
    result = result.replace(/{{applicant_count}}/g, customPricing.applicant_count?.toString() || '');
    result = result.replace(/{{total_amount}}/g, customPricing.total_amount?.toLocaleString() || '');
    result = result.replace(/{{final_amount}}/g, customPricing.final_amount?.toLocaleString() || '');

    // Handle discount placeholders - only show if there's an actual discount
    const discountPercentage = Number(customPricing.discount_percentage) || 0;
    const discountAmount = Number(customPricing.discount_amount) || 0;

    if (discountPercentage > 0 && discountAmount > 0) {
      // Only replace discount placeholders if there's an actual discount
      result = result.replace(/{{discount_percentage}}/g, discountPercentage.toString());
      result = result.replace(/{{discount_amount}}/g, discountAmount.toLocaleString());
    } else {
      // Remove lines that contain discount information when there's no discount
      result = result.replace(/.*discount.*total.*%.*/gi, ''); // Remove lines mentioning discount
      result = result.replace(/.*The client receives a discount.*/gi, ''); // Remove specific discount text
      result = result.replace(/.*{{discount_percentage}}.*/g, ''); // Remove lines with discount percentage placeholder
      result = result.replace(/.*{{discount_amount}}.*/g, ''); // Remove lines with discount amount placeholder
    }

    result = result.replace(/{{currency}}/g, customPricing.currency || '');

    // Handle payment plan placeholders
    if (customPricing.payment_plan && Array.isArray(customPricing.payment_plan)) {
      customPricing.payment_plan.forEach((row: any, index: number) => {
        const placeholder = `{{payment_${index + 1}_percent}}`;
        const valuePlaceholder = `{{payment_${index + 1}_value}}`;
        const duePlaceholder = `{{payment_${index + 1}_due}}`;

        // Handle the new value format "value + VAT" or just "value"
        let displayValue = '0';
        if (row.value) {
          if (typeof row.value === 'string' && row.value.includes('+')) {
            // Parse "value + VAT" format
            const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
            const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
            displayValue = totalValue.toLocaleString();
          } else {
            // Handle numeric value or simple string
            const numValue = parseFloat(row.value) || 0;
            displayValue = numValue.toLocaleString();
          }
        }

        result = result.replace(new RegExp(placeholder, 'g'), row.percent?.toString() || '0');
        result = result.replace(new RegExp(valuePlaceholder, 'g'), `${customPricing.currency} ${displayValue}`);
        result = result.replace(new RegExp(duePlaceholder, 'g'), row.payment_order || row.label || '');
      });
    }

    // Handle payment plan row placeholders
    if (result && result.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
      // Handle specific payment plan row placeholders like {{payment_1_row}}, {{payment_2_row}}, etc.
      customPricing.payment_plan.forEach((row: any, index: number) => {
        const specificPlaceholder = `{{payment_${index + 1}_row}}`;
        if (result.includes(specificPlaceholder)) {
          // Handle the new value format "value + VAT" or just "value"
          let displayValue = '0';
          if (row.value) {
            if (typeof row.value === 'string' && row.value.includes('+')) {
              // Parse "value + VAT" format
              const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
              const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
              displayValue = totalValue.toLocaleString();
            } else {
              // Handle numeric value or simple string
              const numValue = parseFloat(row.value) || 0;
              displayValue = numValue.toLocaleString();
            }
          }
          result = result.replace(new RegExp(specificPlaceholder, 'g'), `${row.percent}% = ${customPricing.currency} ${displayValue}`);
        }
      });

      // Also handle generic {{payment_plan_row}} placeholders (sequential replacement)
      let rowIndex = 0;
      result = result.replace(/\{\{payment_plan_row\}\}/g, (match: string) => {
        const row = customPricing.payment_plan[rowIndex];
        rowIndex++;
        if (row) {
          // Use the exact same value format as shown in the payment plan panel
          let displayValue = '0';
          if (row.value) {
            if (typeof row.value === 'string' && row.value.includes('+')) {
              // Keep the "value + VAT" format exactly as it appears in the panel
              displayValue = row.value;
            } else {
              // Handle numeric value or simple string
              const numValue = parseFloat(row.value) || 0;
              displayValue = numValue.toString();
            }
          }
          return `${row.percent}% = ${customPricing.currency} ${displayValue}`;
        }
        return '';
      });
    }

    // Handle pricing tiers
    if (customPricing.pricing_tiers) {
      const currency = customPricing.currency || 'USD';
      const tierStructure = [
        { key: '1', label: 'For one applicant' },
        { key: '2', label: 'For 2 applicants' },
        { key: '3', label: 'For 3 applicants' },
        { key: '4-7', label: 'For 4-7 applicants' },
        { key: '8-9', label: 'For 8-9 applicants' },
        { key: '10-15', label: 'For 10-15 applicants' },
        { key: '16+', label: 'For 16 applicants or more' }
      ];

      // Handle {{price_per_applicant}} placeholders
      tierStructure.forEach(tier => {
        const lineRegex = new RegExp(`(${tier.label}[^\n]*?):?\s*\{\{price_per_applicant\}\}`, 'g');
        result = result.replace(lineRegex, `$1: ${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
      });

      // Also handle specific tier placeholders that might be in the template
      tierStructure.forEach(tier => {
        const placeholder = `{{price_${tier.key}}}`;
        result = result.replace(new RegExp(placeholder, 'g'), `${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
      });

      // Handle any existing pricing lines that need to be updated
      tierStructure.forEach(tier => {
        // Replace lines that already have a price but need updating
        const existingPriceRegex = new RegExp(`(${tier.label}[^\\n]*?):?\\s*[₪$]\\s*[\\d,]+`, 'g');
        result = result.replace(existingPriceRegex, `$1: ${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
      });
    }
  }

  // Use contact information if available, otherwise fall back to client
  if (contract && contract.contact_name) {
    result = result.replace(/{{client_name}}/g, contract.contact_name || '');
    result = result.replace(/{{client_phone}}/g, contract.contact_phone || contract.contact_mobile || '');
    result = result.replace(/{{client_email}}/g, contract.contact_email || '');
  } else if (client) {
    result = result.replace(/{{client_name}}/g, client.name || '');
    result = result.replace(/{{client_phone}}/g, client.phone || client.mobile || '');
    result = result.replace(/{{client_email}}/g, client.email || '');
  }

  result = result.replace(/{{date}}/g, new Date().toLocaleDateString());
  return result;
}

// Function to fill placeholders in TipTap content structure (preserves {{text}} and {{signature}})
function fillPlaceholdersInTiptapContent(content: any, customPricing: any, client: any, contract?: any, editing?: boolean, globalRowIndex?: { current: number }): any {
  if (!content) return content;

  if (Array.isArray(content)) {
    const processedArray = content.map(item => fillPlaceholdersInTiptapContent(item, customPricing, client, contract, editing, globalRowIndex));
    // Filter out undefined values and empty text nodes
    return processedArray.filter(item => {
      if (item === undefined || item === null) return false;
      if (item.type === 'text') {
        return item.text && item.text.trim() !== '';
      }
      return true;
    });
  }

  if (content.type === 'text' && content.text) {
    // Fill all placeholders except {{text}} and {{signature}} (preserve those for interactive elements)
    let text = content.text;

    // Apply all the same placeholder replacements as fillAllPlaceholders but skip {{text}} and {{signature}}
    if (customPricing) {
      text = text.replace(/{{applicant_count}}/g, customPricing.applicant_count?.toString() || '');
      text = text.replace(/{{total_amount}}/g, customPricing.total_amount?.toLocaleString() || '');
      text = text.replace(/{{final_amount}}/g, customPricing.final_amount?.toLocaleString() || '');

      // Handle discount placeholders
      const discountPercentage = Number(customPricing.discount_percentage) || 0;
      const discountAmount = Number(customPricing.discount_amount) || 0;

      if (discountPercentage > 0 && discountAmount > 0) {
        text = text.replace(/{{discount_percentage}}/g, discountPercentage.toString());
        text = text.replace(/{{discount_amount}}/g, discountAmount.toLocaleString());
      } else {
        text = text.replace(/.*discount.*total.*%.*/gi, '');
        text = text.replace(/.*The client receives a discount.*/gi, '');
        text = text.replace(/.*{{discount_percentage}}.*/g, '');
        text = text.replace(/.*{{discount_amount}}.*/g, '');
      }

      text = text.replace(/{{currency}}/g, customPricing.currency || '');

      // Handle payment plan placeholders
      if (customPricing.payment_plan && Array.isArray(customPricing.payment_plan)) {
        customPricing.payment_plan.forEach((row: any, index: number) => {
          const placeholder = `{{payment_${index + 1}_percent}}`;
          const valuePlaceholder = `{{payment_${index + 1}_value}}`;
          const duePlaceholder = `{{payment_${index + 1}_due}}`;

          // Handle the new value format "value + VAT" or just "value"
          let displayValue = '0';
          if (row.value) {
            if (typeof row.value === 'string' && row.value.includes('+')) {
              // Parse "value + VAT" format
              const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
              const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
              displayValue = totalValue.toLocaleString();
            } else {
              // Handle numeric value or simple string
              const numValue = parseFloat(row.value) || 0;
              displayValue = numValue.toLocaleString();
            }
          }

          text = text.replace(new RegExp(placeholder, 'g'), row.percent?.toString() || '0');
          text = text.replace(new RegExp(valuePlaceholder, 'g'), `${customPricing.currency} ${displayValue}`);
          text = text.replace(new RegExp(duePlaceholder, 'g'), row.payment_order || row.label || '');
        });
      }

      // Handle payment plan row placeholders
      if (text && text.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
        // Handle specific payment plan row placeholders like {{payment_1_row}}, {{payment_2_row}}, etc.
        customPricing.payment_plan.forEach((row: any, index: number) => {
          const specificPlaceholder = `{{payment_${index + 1}_row}}`;
          if (text.includes(specificPlaceholder)) {
            // Handle the new value format "value + VAT" or just "value"
            let displayValue = '0';
            if (row.value) {
              if (typeof row.value === 'string' && row.value.includes('+')) {
                // Parse "value + VAT" format
                const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
                const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
                displayValue = totalValue.toLocaleString();
              } else {
                // Handle numeric value or simple string
                const numValue = parseFloat(row.value) || 0;
                displayValue = numValue.toLocaleString();
              }
            }
            text = text.replace(new RegExp(specificPlaceholder, 'g'), `${row.percent}% = ${customPricing.currency} ${displayValue}`);
          }
        });

        // Also handle generic {{payment_plan_row}} placeholders (sequential replacement)
        if (!globalRowIndex) globalRowIndex = { current: 0 };
        text = text.replace(/\{\{payment_plan_row\}\}/g, (match: string) => {
          const row = customPricing.payment_plan[globalRowIndex!.current];
          globalRowIndex!.current++;
          if (row) {
            // Use the exact same value format as shown in the payment plan panel
            let displayValue = '0';
            if (row.value) {
              if (typeof row.value === 'string' && row.value.includes('+')) {
                // Keep the "value + VAT" format exactly as it appears in the panel
                displayValue = row.value;
              } else {
                // Handle numeric value or simple string
                const numValue = parseFloat(row.value) || 0;
                displayValue = numValue.toString();
              }
            }
            return `${row.percent}% = ${customPricing.currency} ${displayValue}`;
          }
          return '';
        });
      }

      // Handle pricing tiers
      if (customPricing.pricing_tiers) {
        const currency = customPricing.currency || 'USD';
        const tierStructure = [
          { key: '1', label: 'For one applicant' },
          { key: '2', label: 'For 2 applicants' },
          { key: '3', label: 'For 3 applicants' },
          { key: '4-7', label: 'For 4-7 applicants' },
          { key: '8-9', label: 'For 8-9 applicants' },
          { key: '10-15', label: 'For 10-15 applicants' },
          { key: '16+', label: 'For 16 applicants or more' }
        ];

        // Handle {{price_per_applicant}} placeholders
        tierStructure.forEach(tier => {
          const lineRegex = new RegExp(`(${tier.label}[^\n]*?):?\s*\{\{price_per_applicant\}\}`, 'g');
          text = text.replace(lineRegex, `$1: ${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
        });

        // Also handle specific tier placeholders that might be in the template
        tierStructure.forEach(tier => {
          const placeholder = `{{price_${tier.key}}}`;
          text = text.replace(new RegExp(placeholder, 'g'), `${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
        });

        // Handle any existing pricing lines that need to be updated
        tierStructure.forEach(tier => {
          // Replace lines that already have a price but need updating
          const existingPriceRegex = new RegExp(`(${tier.label}[^\\n]*?):?\\s*[₪$]\\s*[\\d,]+`, 'g');
          text = text.replace(existingPriceRegex, `$1: ${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
        });
      }
    }

    // Handle client information
    if (contract && contract.contact_name) {
      text = text.replace(/{{client_name}}/g, contract.contact_name || '');
      text = text.replace(/{{client_phone}}/g, contract.contact_phone || contract.contact_mobile || '');
      text = text.replace(/{{client_email}}/g, contract.contact_email || '');
    } else if (client) {
      text = text.replace(/{{client_name}}/g, client.name || '');
      text = text.replace(/{{client_phone}}/g, client.phone || client.mobile || '');
      text = text.replace(/{{client_email}}/g, client.email || '');
    }

    text = text.replace(/{{date}}/g, new Date().toLocaleDateString());

    // Replace {{text}} and {{signature}} with styled placeholders for view mode
    if (!editing) {
      text = text.replace(/\{\{text\}\}/g, '<span class="text-field-placeholder">[Text Field]</span>');
      text = text.replace(/\{\{signature\}\}/g, '<span class="signature-placeholder"></span>');
    }

    // Skip empty text nodes by returning undefined (will be filtered out)
    if (!text || text.trim() === '') {
      return undefined;
    }

    return { ...content, text };
  }

  if (content.content) {
    const processedContent = fillPlaceholdersInTiptapContent(content.content, customPricing, client, contract, editing, globalRowIndex);
    // Filter out undefined/null values (empty text nodes)
    if (Array.isArray(processedContent)) {
      const filteredContent = processedContent.filter(item => item !== undefined && item !== null);
      return { ...content, content: filteredContent };
    }
    return { ...content, content: processedContent };
  }

  return content;
}

// Helper function to clean up TipTap content and remove empty nodes
function cleanTiptapContent(content: any): any {
  if (!content) return content;

  if (Array.isArray(content)) {
    const cleanedArray = content.map(item => cleanTiptapContent(item));
    return cleanedArray.filter(item => {
      if (item === undefined || item === null) return false;
      if (item.type === 'text') {
        return item.text && item.text.trim() !== '';
      }
      if (item.type === 'paragraph') {
        return item.content && item.content.length > 0;
      }
      return true;
    });
  }

  if (content.type === 'text') {
    if (!content.text || content.text.trim() === '') {
      return null;
    }
    return content;
  }

  if (content.content) {
    const cleanedContent = cleanTiptapContent(content.content);
    if (Array.isArray(cleanedContent)) {
      const filteredContent = cleanedContent.filter(item => item !== null);
      if (filteredContent.length === 0) {
        return null;
      }
      return { ...content, content: filteredContent };
    }
    return { ...content, content: cleanedContent };
  }

  return content;
}

function preprocessTemplatePlaceholders(content: any): any {
  console.log('🔧 preprocessTemplatePlaceholders called with:', content);
  let textId = 1;
  let signatureId = 1;

  function processContent(content: any): any {
    if (!content) return content;
    if (Array.isArray(content)) {
      return content.map(processContent);
    }
    if (content.type === 'text' && content.text) {
      console.log('🔧 Processing text node:', content.text);
      let newText = content.text.replace(/\{\{text\}\}/g, () => `{{text:text-${textId++}}}`)
        .replace(/\{\{signature\}\}/g, () => `{{signature:signature-${signatureId++}}}`);
      console.log('🔧 Processed text node:', newText);
      return { ...content, text: newText };
    }
    if (content.content) {
      return { ...content, content: processContent(content.content) };
    }
    return content;
  }

  const result = processContent(content);
  console.log('🔧 preprocessTemplatePlaceholders result:', result);
  return result;
}

// Function to convert template content to preserve line breaks
function convertTemplateToLineBreaks(content: any): any {
  if (!content) return content;
  if (Array.isArray(content)) {
    return content.map(convertTemplateToLineBreaks);
  }

  // If this is a paragraph with multiple text nodes, combine them with line breaks
  if (content.type === 'paragraph' && content.content && content.content.length > 1) {
    const textNodes = content.content.filter((node: any) => node.type === 'text');
    if (textNodes.length > 1) {
      // Combine all text nodes with line breaks
      const combinedText = textNodes.map((node: any) => node.text).join('\n');
      return {
        ...content,
        content: [{ type: 'text', text: combinedText }]
      };
    }
  }

  if (content.content) {
    return { ...content, content: convertTemplateToLineBreaks(content.content) };
  }
  return content;
}

// Helper to build correct payment plan
function buildPaymentPlan(finalAmount: number, archivalFee: number) {
  const plan = [];
  if (archivalFee > 0) {
    plan.push({
      percent: 100,
      due_date: 'On signing',
      value: archivalFee,
      label: 'Archival Research',
    });
  }
  if (finalAmount > 0) {
    plan.push(
      { percent: 50, due_date: 'On signing', value: Math.round(finalAmount * 0.5), label: 'First Payment' },
      { percent: 25, due_date: '30 days', value: Math.round(finalAmount * 0.25), label: 'Intermediate Payment' },
      { percent: 25, due_date: '60 days', value: Math.round(finalAmount * 0.25), label: 'Final Payment' }
    );
  }
  return plan;
}

const ContractPage: React.FC = () => {
  const { leadNumber: paramLeadNumber, contractId: paramContractId } = useParams<{ leadNumber?: string; contractId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // Extract leadNumber from URL path manually (may be undefined if using /contract/:contractId route)
  const leadNumber = paramLeadNumber || (location.pathname.startsWith('/contract/') ? undefined : location.pathname.split('/')[2]);
  // Extract contractId from URL - can be from route param or query string
  const contractId = paramContractId || new URLSearchParams(location.search).get('contractId') || (location.pathname.startsWith('/contract/') ? location.pathname.split('/')[2] : null);

  const [contract, setContract] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [signaturePads, setSignaturePads] = useState<{ [key: string]: any }>({});
  const [editing, setEditing] = useState(false);
  const [contractStatuses, setContractStatuses] = useState<{ [id: string]: { status: string; signed_at?: string } }>({});

  // Editable right panel state
  const [customPricing, setCustomPricing] = useState<any>(null);
  const [renderKey, setRenderKey] = useState(0);

  // TipTap editor setup for editing - must be called before any early returns
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
    content: { type: 'doc', content: [] }, // Default empty content
    editable: false,
    parseOptions: {
      preserveWhitespace: 'full',
    },
  });

  // Add at the top, after useState declarations
  const [clientInputs, setClientInputs] = useState<{ [key: string]: string }>({});

  // Fetch client data
  useEffect(() => {
    const fetchClient = async () => {
      if (!leadNumber) {
        return;
      }
      try {
        console.log('ContractPage: fetchClient called with leadNumber:', leadNumber);

        // Check if this is a legacy lead
        const isLegacyLead = leadNumber?.toString().startsWith('legacy_') ||
          (!isNaN(Number(leadNumber)));

        console.log('ContractPage: fetchClient - isLegacyLead:', isLegacyLead);

        let clientData = null;

        if (isLegacyLead) {
          // For legacy leads, fetch from leads_lead table
          const legacyId = leadNumber.toString().replace('legacy_', '');
          console.log('ContractPage: fetchClient - fetching from leads_lead with id:', legacyId);

          const { data: legacyClient, error: legacyError } = await supabase
            .from('leads_lead')
            .select('*')
            .eq('id', legacyId)
            .single();

          if (legacyError) {
            console.error('ContractPage: Error fetching legacy client:', legacyError);
            return;
          }

          if (legacyClient) {
            // Transform legacy client to match new client structure
            clientData = {
              ...legacyClient,
              id: `legacy_${legacyClient.id}`,
              lead_number: String(legacyClient.id),
              stage: String(legacyClient.stage || ''),
              source: String(legacyClient.source_id || ''),
              created_at: legacyClient.cdate,
              updated_at: legacyClient.udate,
              notes: legacyClient.notes || '',
              special_notes: legacyClient.special_notes || '',
              next_followup: legacyClient.next_followup || '',
              probability: String(legacyClient.probability || ''),
              category: String(legacyClient.category_id || legacyClient.category || ''),
              language: String(legacyClient.language_id || ''),
              balance: String(legacyClient.total || ''),
              lead_type: 'legacy',
              client_country: null,
              closer: null,
              handler: null,
              unactivation_reason: null,
            };
          }
        } else {
          // For new leads, fetch from leads table
          console.log('ContractPage: fetchClient - fetching from leads with id:', leadNumber);

          const { data: newClient, error: newError } = await supabase
            .from('leads')
            .select('*')
            .eq('lead_number', leadNumber)
            .single();

          if (newError) {
            console.error('ContractPage: Error fetching new client:', newError);
            return;
          }

          clientData = newClient;
        }

        console.log('ContractPage: fetchClient - setting client data:', clientData);
        setClient(clientData);

      } catch (error) {
        console.error('ContractPage: Error in fetchClient:', error);
      }
    };

    // Fetch client either by leadNumber or after contract is loaded
    if (leadNumber) {
      fetchClient();
    }
    // If we only have contractId, we'll fetch client after contract is loaded
  }, [leadNumber]);

  // Fetch contract data
  useEffect(() => {
    const fetchContract = async () => {
      try {
        console.log('ContractPage: fetchContract called with:', { leadNumber, contractId });

        let query = supabase
          .from('contracts')
          .select(`
            *,
            contract_templates (
              id,
              name,
              content
            )
          `);

        // If we only have contractId (no leadNumber), fetch contract directly
        if (contractId && !leadNumber) {
          console.log('ContractPage: Fetching contract directly by contractId:', contractId);
          query = query.eq('id', contractId);
        } else if (leadNumber) {
          // Check if this is a legacy lead
          // Legacy leads can be identified by:
          // 1. Starting with 'legacy_' prefix
          // 2. Being a numeric string (UUIDs are not numeric)
          const isLegacyLead = leadNumber.toString().startsWith('legacy_') ||
            (!isNaN(Number(leadNumber)));

          console.log('ContractPage: isLegacyLead:', isLegacyLead, 'leadNumber:', leadNumber);

          if (isLegacyLead) {
            // For legacy leads, use legacy_id
            const legacyId = leadNumber.toString().replace('legacy_', '');
            console.log('ContractPage: Using legacy_id:', legacyId);
            query = query.eq('legacy_id', legacyId);
          } else {
            // For new leads, we need to get the UUID from the leads table first
            console.log('ContractPage: Fetching UUID for lead_number:', leadNumber);
            const { data: leadData, error: leadError } = await supabase
              .from('leads')
              .select('id')
              .eq('lead_number', leadNumber)
              .single();

            if (leadError) {
              console.error('ContractPage: Error fetching lead UUID:', leadError);
              return;
            }

            if (!leadData) {
              console.error('ContractPage: No lead found for lead_number:', leadNumber);
              return;
            }

            console.log('ContractPage: Using client_id (UUID):', leadData.id);
            query = query.eq('client_id', leadData.id);
          }

          // If we have a specific contractId, filter by that too
          if (contractId) {
            console.log('ContractPage: Also filtering by contractId:', contractId);
            query = query.eq('id', contractId);
          }
        } else {
          console.error('ContractPage: No contractId or leadNumber provided');
          setLoading(false);
          return;
        }

        console.log('ContractPage: Executing query...');
        const { data: contractData, error } = await query.single();

        console.log('ContractPage: Query result:', { contractData, error });

        if (error) {
          console.error('Error fetching contract:', error);
          return;
        }

        console.log('ContractPage: Setting contract data:', contractData);
        setContract(contractData);

        // If we don't have leadNumber but have a contract, fetch the client from the contract's client_id
        let clientLoaded = false;
        if (!leadNumber && contractData.client_id) {
          console.log('ContractPage: Fetching client from contract client_id:', contractData.client_id);
          try {
            // Try fetching from leads table first (new leads)
            let { data: clientData, error: clientError } = await supabase
              .from('leads')
              .select('*')
              .eq('id', contractData.client_id)
              .single();
            
            // If not found in leads table, try legacy leads_lead table
            if (clientError || !clientData) {
              console.log('ContractPage: Client not found in leads table, trying legacy table...');
              const legacyId = contractData.client_id?.toString().replace('legacy_', '') || contractData.client_id;
              const { data: legacyClient, error: legacyError } = await supabase
                .from('leads_lead')
                .select('*')
                .eq('id', legacyId)
                .single();
              
              if (!legacyError && legacyClient) {
                // Transform legacy client to match new client structure
                clientData = {
                  ...legacyClient,
                  id: `legacy_${legacyClient.id}`,
                  lead_number: String(legacyClient.id),
                  stage: String(legacyClient.stage || ''),
                  source: String(legacyClient.source_id || ''),
                  created_at: legacyClient.cdate,
                  updated_at: legacyClient.udate,
                  notes: legacyClient.notes || '',
                  special_notes: legacyClient.special_notes || '',
                  next_followup: legacyClient.next_followup || '',
                  probability: String(legacyClient.probability || ''),
                  category: String(legacyClient.category_id || legacyClient.category || ''),
                  language: String(legacyClient.language_id || ''),
                  balance: String(legacyClient.total || ''),
                  lead_type: 'legacy',
                };
                clientError = null;
              } else {
                clientError = legacyError;
              }
            }
            
            if (clientError) {
              console.error('ContractPage: Error fetching client from contract:', clientError);
              // Don't return - continue to set loading to false
            } else if (clientData) {
              console.log('ContractPage: Setting client data from contract:', clientData);
              setClient(clientData);
              clientLoaded = true;
            }
          } catch (err) {
            console.error('ContractPage: Exception fetching client:', err);
            // Don't return - continue to set loading to false
          }
        } else if (leadNumber) {
          // Client should already be loaded from the fetchClient useEffect
          clientLoaded = true;
        }

        // Set the template if available
        if (contractData.contract_templates) {
          console.log('Original template content:', contractData.contract_templates.content);
          // Process template to add text and signature placeholders
          const processedTemplate = {
            ...contractData.contract_templates,
            content: contractData.contract_templates.content ?
              preprocessTemplatePlaceholders(contractData.contract_templates.content) :
              contractData.contract_templates.content
          };
          console.log('📋 Processed template content:', processedTemplate.content);
          console.log('📋 Setting template:', processedTemplate);
          setTemplate(processedTemplate);

          // Immediately set the editor content if editor is available
          if (editor && processedTemplate.content) {
            console.log('🎯 Setting editor content immediately:', processedTemplate.content);
            let processedContent = JSON.parse(JSON.stringify(processedTemplate.content)); // Deep clone

            if (customPricing && client) {
              // Replace pricing and other placeholders but keep {{text}} and {{signature}} for the custom renderer
              processedContent = fillPlaceholdersInTiptapContent(processedContent, customPricing, client, contract, editing, { current: 0 });
            }

            // Clean up any empty nodes
            processedContent = cleanTiptapContent(processedContent);
            editor.commands.setContent(processedContent);
            editor.setEditable(editing);
          }
        }

        // Set the custom pricing if available
        if (contractData.custom_pricing) {
          console.log('ContractPage: Setting custom pricing:', contractData.custom_pricing);
          // Force VAT calculation by temporarily setting payment_plan to null
          const pricingWithVat = {
            ...contractData.custom_pricing,
            payment_plan: null // This will trigger the useEffect to recalculate with VAT
          };
          setCustomPricing(pricingWithVat);
        } else {
          console.log('ContractPage: No custom pricing found in contract data, initializing with defaults');
          // Initialize with default pricing structure
          const defaultPricing = {
            applicant_count: contractData.applicant_count || 1,
            pricing_tiers: {},
            total_amount: 0,
            discount_percentage: 0,
            discount_amount: 0,
            final_amount: 0,
            payment_plan: [],
            currency: contractData.client_country || '₪',
            archival_research_fee: 0,
          };
          console.log('ContractPage: Setting default pricing:', defaultPricing);
          setCustomPricing(defaultPricing);
        }

        // Load client inputs if available (for signed contracts)
        if (contractData.client_inputs) {
          console.log('ContractPage: Loading client inputs:', contractData.client_inputs);
          setClientInputs(contractData.client_inputs);
        }

        // If contract is signed, display filled-in content
        if (contractData.signed_at) {
          // Contract is signed, displaying filled-in content
        }

        // Set loading to false after contract is loaded
        // For contractId-only routes: if we tried to fetch client, it should be loaded by now (or failed)
        // For leadNumber routes: client is loaded separately in fetchClient useEffect
        // Only set loading to false if we don't need to wait for client, or if client is already loaded
        if (leadNumber || clientLoaded || client) {
          setLoading(false);
        } else if (!leadNumber && !contractData.client_id) {
          // No client needed, set loading to false
          setLoading(false);
        }

      } catch (error) {
        console.error('Error in fetchContract:', error);
        setLoading(false);
      }
    };

    // Fetch contract if we have either leadNumber or contractId
    if (leadNumber || contractId) {
      console.log('ContractPage: Starting fetchContract with:', { leadNumber, contractId });
      fetchContract();
    } else {
      console.log('ContractPage: No leadNumber or contractId, setting loading to false');
      setLoading(false);
    }
  }, [leadNumber, contractId]);

  // Set loading to false when both contract and client are loaded (for contractId-only routes)
  useEffect(() => {
    if (contract && !leadNumber) {
      // For contractId-only routes, we need both contract and client before setting loading to false
      if (client || !contract.client_id) {
        // Client is loaded, or contract doesn't require a client
        if (loading) {
          console.log('ContractPage: Contract and client ready, setting loading to false');
          setLoading(false);
        }
      }
    } else if (contract && leadNumber && client) {
      // For leadNumber routes, both contract and client are loaded
      if (loading) {
        console.log('ContractPage: Contract and client ready (leadNumber route), setting loading to false');
        setLoading(false);
      }
    }
  }, [contract, client, leadNumber, loading]);

  // Auto-refresh signed contracts to ensure we have the latest filled-in content
  useEffect(() => {
    if (contract && contract.status === 'signed' && !loading) {
      // Only refresh once when the contract is first loaded as signed
      const timer = setTimeout(() => {
        handleRefreshContract();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [contract?.id]); // Only depend on contract ID, not status or loading

  // Update editor content when switching between edit/view modes
  useEffect(() => {
    if (editor && contract && template) {
      console.log('🎯 Editor content effect triggered:', { editing, hasContract: !!contract, hasTemplate: !!template, hasCustomPricing: !!customPricing, hasClient: !!client });

      // Always load the content (custom_content if available, otherwise template)
      const content = contract.custom_content || template.content;
      console.log('🎯 Content to load:', content);

      if (content) {
        // ALWAYS process the content the same way for both edit and view modes
        // This ensures consistent paragraph structure and spacing
        let processedContent = JSON.parse(JSON.stringify(content)); // Deep clone

        if (customPricing && client) {
          // Replace pricing and other placeholders but keep {{text}} and {{signature}} for the custom renderer
          processedContent = fillPlaceholdersInTiptapContent(processedContent, customPricing, client, contract, editing, { current: 0 });
        }

        // Clean up any empty nodes
        processedContent = cleanTiptapContent(processedContent);
        console.log('🎯 Setting processed content for both modes:', processedContent);
        editor.commands.setContent(processedContent);
      }

      // Set editability
      editor.setEditable(editing);
    }
  }, [editing, editor, contract, template, customPricing, client, renderKey]);

  // Ensure editor content is loaded when template is first set
  useEffect(() => {
    if (editor && template && template.content && !contract?.custom_content) {
      console.log('🎯 Initial template load - setting editor content:', template.content);
      let processedContent = JSON.parse(JSON.stringify(template.content)); // Deep clone

      if (customPricing && client) {
        // Replace pricing and other placeholders but keep {{text}} and {{signature}} for the custom renderer
        processedContent = fillPlaceholdersInTiptapContent(processedContent, customPricing, client, contract, editing, { current: 0 });
      }

      // Clean up any empty nodes
      processedContent = cleanTiptapContent(processedContent);
      editor.commands.setContent(processedContent);
      editor.setEditable(editing);
    }
  }, [editor, template, contract?.custom_content, editing, customPricing, client, contract]);

  // Save handler for edited contract
  const handleSaveEdit = async () => {
    if (!editor) return;
    const content = editor.getJSON();
    await supabase.from('contracts').update({ custom_content: content }).eq('id', contract.id);
    setEditing(false);
    // Reload contract data
    window.location.reload();
  };

  // Update contract.custom_pricing in DB and local state
  const updateCustomPricing = useCallback(async (updates: any) => {
    if (!contract) return;
    const newPricing = { ...customPricing, ...updates };
    setCustomPricing(newPricing);
    setRenderKey(prev => prev + 1); // Force re-render
    await supabase.from('contracts').update({ custom_pricing: newPricing }).eq('id', contract.id);
    setContract((prev: any) => ({ ...prev, custom_pricing: newPricing }));
  }, [contract, customPricing]);

  // Ensure applicant_count is at least 1 after loading contract/customPricing
  useEffect(() => {
    if (customPricing && (!customPricing.applicant_count || customPricing.applicant_count < 1)) {
      const updated = { ...customPricing, applicant_count: 1 };
      setCustomPricing(updated);
      if (contract) {
        supabase.from('contracts').update({ custom_pricing: updated }).eq('id', contract.id);
      }
    }
    // Ensure payment_plan is initialized
    if (customPricing && (!customPricing.payment_plan || customPricing.payment_plan.length === 0)) {
      const finalAmount = customPricing.final_amount || 0;
      const defaultPlan = [
        { percent: 50, due_date: 'On signing', value: Math.round(finalAmount * 0.5) },
        { percent: 25, due_date: '30 days', value: Math.round(finalAmount * 0.25) },
        { percent: 25, due_date: '60 days', value: Math.round(finalAmount * 0.25) },
      ];
      const updated = { ...customPricing, payment_plan: defaultPlan };
      setCustomPricing(updated);
      if (contract) {
        supabase.from('contracts').update({ custom_pricing: updated }).eq('id', contract.id);
      }
    }
  }, [customPricing, contract]);

  // Ensure total_amount and pricing fields are always saved to DB after customPricing is initialized
  useEffect(() => {
    if (!contract || !customPricing) return;
    const dbTotal = contract.custom_pricing?.total_amount;
    const localTotal = customPricing.total_amount;
    if (typeof localTotal === 'number' && localTotal > 0 && localTotal !== dbTotal) {
      supabase.from('contracts').update({ custom_pricing: customPricing }).eq('id', contract.id);
    }
  }, [contract, customPricing]);

  // When initializing or updating customPricing, use buildPaymentPlan with VAT calculations
  useEffect(() => {
    if (!customPricing) return;
    
    const archivalFee = customPricing.archival_research_fee || 0;
    const totalAmount = customPricing.total_amount || 0;
    const discountAmount = customPricing?.discount_amount || 0;
    const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';

    // Check if payment plan needs VAT calculation
    const currentPaymentPlan = customPricing.payment_plan || [];
    const needsVatCalculation = !currentPaymentPlan.length || 
      currentPaymentPlan.some((row: any) => typeof row.value === 'number' || !row.value.includes('+'));

    if (!needsVatCalculation) return;

    // Calculate the discounted base total
    const discountedBaseTotal = totalAmount - discountAmount;

    // Build the basic payment plan structure
    const basicPaymentPlan = buildPaymentPlan(totalAmount, archivalFee);

    // Update each payment to show value + VAT only if there's VAT
    const paymentPlan = basicPaymentPlan.map((payment: any) => {
      if (payment.label === 'Archival Research') {
        return payment;
      } else {
        // Calculate the base value for this percentage
        const baseValueForThisPercent = Math.round((discountedBaseTotal * payment.percent) / 100);
        const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;
        
        return {
          ...payment,
          value: isIsraeli && vatForThisPercent > 0 ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString(),
        };
      }
    });

    // Always update the payment plan to ensure VAT is applied
    setCustomPricing((prev: typeof customPricing) => ({ ...prev, payment_plan: paymentPlan }));
  }, [customPricing?.total_amount, customPricing?.discount_amount, customPricing?.archival_research_fee, contract?.client_country, customPricing?.currency, customPricing?._forceVatCalculation]);

  // Force VAT calculation on initial load
  useEffect(() => {
    if (!customPricing || !customPricing.payment_plan) return;
    
    const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';
    const currentPaymentPlan = customPricing.payment_plan;
    
    // Check if payment plan needs VAT calculation (has numeric values instead of "value + VAT" strings)
    const needsVatCalculation = currentPaymentPlan.some((row: any) => 
      typeof row.value === 'number' || (typeof row.value === 'string' && !row.value.includes('+'))
    );

    if (needsVatCalculation && isIsraeli) {
      console.log('🔧 Forcing VAT calculation on initial load');
      // Trigger the main VAT calculation by updating a dependency
      setCustomPricing((prev: typeof customPricing) => ({ 
        ...prev, 
        _forceVatCalculation: Date.now() 
      }));
    }
  }, [customPricing?.payment_plan, contract?.client_country, customPricing?.currency]);

  // Discount options
  const discountOptions = [0, 5, 10, 15, 20];

  // Helper function to get tier key based on applicant count
  const getCurrentTierKey = (count: number) => {
    if (count === 1) return '1';
    if (count === 2) return '2';
    if (count === 3) return '3';
    if (count >= 4 && count <= 7) return '4-7';
    if (count >= 8 && count <= 9) return '8-9';
    if (count >= 10 && count <= 15) return '10-15';
    return '16+';
  };

  // Update applicant count and recalculate pricing
  const handleApplicantCountChange = (newCount: number) => {
    if (!customPricing || !customPricing.pricing_tiers) return;

    // Get the correct tier for this applicant count
    const tierKey = getCurrentTierKey(newCount);
    const pricePerApplicant = customPricing.pricing_tiers[tierKey] || 0;
    const total = pricePerApplicant * newCount;
    const discount = Number(customPricing.discount_percentage) || 0;
    const discountAmount = Math.round(total * (discount / 100));
    const finalAmount = total - discountAmount;

    // Calculate final amount with VAT for payment plan calculations
    const archivalFee = customPricing?.archival_research_fee || 0;
    const baseTotal = total + archivalFee;
    const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';

    // Calculate VAT on the discounted amount (baseTotal - discountAmount)
    const discountedBaseTotal = baseTotal - discountAmount;
    const vatAmount = isIsraeli ? Math.round(discountedBaseTotal * 0.18 * 100) / 100 : 0;
    const finalAmountWithVat = discountedBaseTotal + vatAmount;

    // Recalculate payment plan amounts - each payment should show "value + VAT" only if there's VAT
    let paymentPlan = customPricing.payment_plan || [];
    if (paymentPlan.length > 0) {
      const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
      paymentPlan = paymentPlan.map((row: any) => {
        // Calculate the base value for this percentage (based on discounted amount)
        const baseValueForThisPercent = Math.round((discountedBaseTotal * Number(row.percent)) / totalPercent);
        // Calculate the VAT for this percentage
        const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;
        // The amount field should show "value + VAT" format only if there's VAT, otherwise just the value
        return {
          ...row,
          value: isIsraeli && vatForThisPercent > 0 ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString(),
        };
      });
    }

    updateCustomPricing({
      applicant_count: newCount,
      total_amount: total,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      payment_plan: paymentPlan,
    });
  };

  // Update price for a specific tier
  const handleTierPriceChange = (tierKey: string, newPrice: number) => {
    if (!customPricing || !customPricing.pricing_tiers) return;

    const newPricingTiers: { [key: string]: number } = {
      ...customPricing.pricing_tiers,
      [tierKey]: newPrice
    };

    // Check if this tier affects the current applicant count
    const currentTierKey = getCurrentTierKey(customPricing.applicant_count);
    if (tierKey === currentTierKey) {
      const total = newPrice * customPricing.applicant_count;
      const discount = Number(customPricing.discount_percentage) || 0;
      const discountAmount = Math.round(total * (discount / 100));
      const finalAmount = total - discountAmount;

      // Calculate final amount with VAT for payment plan calculations
      const archivalFee = customPricing?.archival_research_fee || 0;
      const baseTotal = total + archivalFee;
      const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';

      // Calculate VAT on the discounted amount (baseTotal - discountAmount)
      const discountedBaseTotal = baseTotal - discountAmount;
      const vatAmount = isIsraeli ? Math.round(discountedBaseTotal * 0.18 * 100) / 100 : 0;
      const finalAmountWithVat = discountedBaseTotal + vatAmount;

      // Recalculate payment plan amounts - each payment should show "value + VAT" only if there's VAT
      let paymentPlan = customPricing.payment_plan || [];
      if (paymentPlan.length > 0) {
        const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
        paymentPlan = paymentPlan.map((row: any) => {
          // Calculate the base value for this percentage (based on discounted amount)
          const baseValueForThisPercent = Math.round((discountedBaseTotal * Number(row.percent)) / totalPercent);
          // Calculate the VAT for this percentage
          const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;
          // The amount field should show "value + VAT" format only if there's VAT, otherwise just the value
          return {
            ...row,
            value: isIsraeli && vatForThisPercent > 0 ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString(),
          };
        });
      }

      updateCustomPricing({
        pricing_tiers: newPricingTiers,
        total_amount: total,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        payment_plan: paymentPlan,
      });
    } else {
      updateCustomPricing({
        pricing_tiers: newPricingTiers,
      });
    }
  };

  // Payment plan editor helpers
  const handlePaymentPlanChange = (idx: number, field: string, value: any) => {
    const newPlan = [...(customPricing.payment_plan || [])];
    newPlan[idx] = { ...newPlan[idx], [field]: value };

    // Calculate the correct final amount including VAT
    const archivalFee = customPricing?.archival_research_fee || 0;
    const baseTotal = (customPricing?.total_amount || 0) + archivalFee;
    const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';
    const discountAmount = customPricing?.discount_amount || 0;

    // Calculate VAT on the discounted amount (baseTotal - discountAmount)
    const discountedBaseTotal = baseTotal - discountAmount;
    const vatAmount = isIsraeli ? Math.round(discountedBaseTotal * 0.18 * 100) / 100 : 0;
    const finalAmountWithVat = discountedBaseTotal + vatAmount;

    // If changing value (amount), recalculate percentage
    if (field === 'value') {
      // Parse the value string to extract the total amount
      let totalValue = 0;
      if (typeof value === 'string' && value.includes('+')) {
        // Extract numbers from "value + vat" format
        const parts = value.split('+').map(part => parseFloat(part.trim()) || 0);
        totalValue = parts.reduce((sum, part) => sum + part, 0);
      } else {
        totalValue = parseFloat(value) || 0;
      }
      newPlan[idx].percent = finalAmountWithVat > 0 ? Math.round((totalValue / finalAmountWithVat) * 100) : 0;
    }
    // If changing percentage, recalculate value (amount) - this should show "value + VAT" only if there's VAT
    else if (field === 'percent') {
      // Calculate the base value for this percentage (based on discounted amount)
      const baseValueForThisPercent = Math.round((discountedBaseTotal * value) / 100);
      // Calculate the VAT for this percentage
      const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;
      // The amount field should show "value + VAT" format only if there's VAT, otherwise just the value
      newPlan[idx].value = isIsraeli && vatForThisPercent > 0 ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString();
    }

    updateCustomPricing({ payment_plan: newPlan });
  };

  const handleAddPaymentRow = () => {
    const newPlan = [
      ...(customPricing.payment_plan || []),
      { percent: 0, due_date: '', value: 0 },
    ];
    updateCustomPricing({ payment_plan: newPlan });
  };

  const handleDeletePaymentRow = (idx: number) => {
    const newPlan = (customPricing.payment_plan || []).filter((_: any, i: number) => i !== idx);
    updateCustomPricing({ payment_plan: newPlan });
  };

  // Handle contract signing
  const handleSignContract = async () => {
    try {
      // Fetch the latest contract from the DB to get the freshest custom_pricing
      const { data: freshContract, error: fetchError } = await supabase
        .from('contracts')
        .select('*')
        .eq('id', contract.id)
        .single();
      if (fetchError) throw fetchError;
      const latestPricing = freshContract.custom_pricing || {};
      const applicantCount = latestPricing.applicant_count || 1;
      const isIsraeli = freshContract.client_country === 'IL';
      const currency = isIsraeli ? 'NIS' : 'USD';
      const pricingTiers = latestPricing.pricing_tiers || {};
      const getCurrentTierKey = (count: number) => {
        if (count === 1) return '1';
        if (count === 2) return '2';
        if (count === 3) return '3';
        if (count >= 4 && count <= 7) return '4-7';
        if (count >= 8 && count <= 9) return '8-9';
        if (count >= 10 && count <= 15) return '10-15';
        return '16+';
      };
      const currentTierKey = getCurrentTierKey(applicantCount);
      const currentPricePerApplicant = pricingTiers[currentTierKey] || 0;
      const total = currentPricePerApplicant * applicantCount;
      const discount = Number(latestPricing.discount_percentage) || 0;
      const discountAmount = Math.round(total * (discount / 100));
      const finalAmount = total - discountAmount;
      // Debug logging

      if (!applicantCount || applicantCount < 1) {
        alert('Please set the number of applicants before signing.');
        return;
      }
      // Recalculate payment plan amounts and convert "value + VAT" format to separate numeric values
      let updatedPaymentPlan = latestPricing.payment_plan || [];
      if (updatedPaymentPlan.length > 0) {
        const totalPercent = updatedPaymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
        updatedPaymentPlan = updatedPaymentPlan.map((row: any) => {
          // Parse the "value + VAT" format to extract separate values
          let value = 0;
          let value_vat = 0;

          if (typeof row.value === 'string' && row.value.includes('+')) {
            // Extract numbers from "value + vat" format
            const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
            value = parts[0] || 0;
            value_vat = parts[1] || 0;
          } else {
            // If it's already a number or doesn't have the format, use as is
            value = parseFloat(row.value) || 0;
            value_vat = 0;
          }

          return {
            ...row,
            value: value,
            value_vat: value_vat,
            amount: value + value_vat, // Keep amount for backward compatibility
          };
        });
      }
      // Update the contract with the rebuilt payment plan and final amount before signing
      await supabase.from('contracts').update({
        custom_pricing: {
          ...latestPricing,
          pricing_tiers: pricingTiers,
          currency,
          total_amount: total,
          discount_amount: discountAmount,
          final_amount: finalAmount,
          payment_plan: updatedPaymentPlan,
        }
      }).eq('id', contract.id);

      // Fill TipTap JSON with clientInputs
      const filledContent = fillTiptapJsonWithInputs(
        contract.custom_content || template.content?.content,
        clientInputs,
        '',
        { text: 0, signature: 0 }
      );
      // Save filled content to DB before marking as signed
      await supabase.from('contracts').update({
        custom_content: filledContent
      }).eq('id', contract.id);

      const { data: updatedContract, error } = await supabase
        .from('contracts')
        .update({
          status: 'signed',
          signed_at: new Date().toISOString()
        })
        .eq('id', contract.id)
        .select()
        .single();

      if (error) throw error;

      // Update the client's balance in the leads table to the contract's final_amount
      if (client && client.id && finalAmount) {
        const { error: balanceError } = await supabase
          .from('leads')
          .update({ balance: finalAmount })
          .eq('id', client.id);
        if (balanceError) {
          console.error('Failed to update client balance:', balanceError);
          alert('Contract signed, but failed to update client balance.');
        }
      }

      await handleContractSigned(updatedContract);
      alert('Contract signed! Payment plan and proforma have been automatically generated.');
      navigate(`/clients/${leadNumber}`);

    } catch (error) {
      console.error('Error signing contract:', error);
      alert('Failed to sign contract. Please try again.');
    }
  };

  // Add handler for country change
  const handleCountryChange = async (newCountry: string) => {
    if (!contract) return;
    // Update contract in DB
    await supabase.from('contracts').update({ client_country: newCountry }).eq('id', contract.id);
    // Update local contract state
    setContract((prev: any) => ({ ...prev, client_country: newCountry }));
    // Recalculate pricing tiers and currency
    const isIsraeli = newCountry === 'IL';
    const currency = isIsraeli ? 'NIS' : 'USD';
    // Rebuild pricing tiers
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
    tierStructure.forEach(tier => {
      const priceTier = getPricePerApplicant(tier.count, isIsraeli);
      const pricePerApplicant = isIsraeli && 'priceWithVat' in priceTier ? priceTier.priceWithVat : priceTier.price;
      pricingTiers[tier.key] = pricePerApplicant;
    });
    // Recalculate totals
    const applicantCount = customPricing?.applicant_count || 1;
    const currentTierKey = getCurrentTierKey(applicantCount);
    const currentPricePerApplicant = pricingTiers[currentTierKey];
    const total = currentPricePerApplicant * applicantCount;
    const discount = Number(customPricing?.discount_percentage) || 0;
    const discountAmount = Math.round(total * (discount / 100));
    const finalAmount = total - discountAmount;
    // Recalculate payment plan amounts
    let paymentPlan = customPricing?.payment_plan || [];
    if (paymentPlan.length > 0) {
      const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
      paymentPlan = paymentPlan.map((row: any) => ({
        ...row,
        value: Math.round(finalAmount * (Number(row.percent) / totalPercent)),
      }));
    }
    // Update customPricing
    setCustomPricing((prev: any) => ({
      ...prev,
      pricing_tiers: pricingTiers,
      currency,
      total_amount: total,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      payment_plan: paymentPlan,
    }));
    // Save to DB
    await supabase.from('contracts').update({
      custom_pricing: {
        ...customPricing,
        pricing_tiers: pricingTiers,
        currency,
        total_amount: total,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        payment_plan: paymentPlan,
      }
    }).eq('id', contract.id);
  };

  // Helper to render TipTap JSON as React elements, with support for dynamic fields in 'View as Client' mode
  const renderTiptapContent = (
    content: any,
    keyPrefix = '',
    asClient = false,
    signaturePads?: { [key: string]: any },
    applicantPriceIndex?: { current: number },
    paymentPlanIndex?: { current: number },
    isReadOnly = false,
    placeholderIndex?: { text: number; signature: number }
  ): React.ReactNode => {
    if (!placeholderIndex) placeholderIndex = { text: 0, signature: 0 };
    if (!content) return null;
    if (Array.isArray(content)) {
      // Initialize indices if not provided
      if (!applicantPriceIndex) applicantPriceIndex = { current: 0 };
      if (!paymentPlanIndex) paymentPlanIndex = { current: 0 };
      // In renderTiptapContent, when recursing into an array, pass the SAME placeholderIndex object to all children (do NOT clone)
      return content.map((n, i) =>
        renderTiptapContent(
          n,
          keyPrefix + '-' + i,
          asClient,
          signaturePads,
          applicantPriceIndex,
          paymentPlanIndex,
          isReadOnly,
          placeholderIndex // DO NOT CLONE
        )
      );
    }
    if (content.type === 'text') {
      let text = content.text;

      // Always render {{text}} and {{signature}} as input fields and signature pads
      console.log('🎨 Checking for placeholders in text:', text);
      console.log('🎨 Has placeholders:', /\{\{(text|signature)\}\}/.test(text));
      if (text && /\{\{(text|signature)\}\}/.test(text)) {
        const parts = [];
        let lastIndex = 0;
        const regex = /({{text}}|{{signature}}|\n)/g;
        let match;
        let textCounter = 1;
        let signatureCounter = 1;

        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const normalText = text.slice(lastIndex, match.index);
            parts.push(normalText);
          }
          const placeholder = match[1];

          if (placeholder === '{{text}}') {
            const id = `text-${textCounter++}`;
            parts.push(
              <input
                key={id}
                className="input input-bordered input-lg mx-2 bg-white border-2 border-blue-300 focus:border-blue-500"
                placeholder="Enter text"
                style={{ minWidth: 150, display: 'inline-block' }}
                value={clientInputs[id] || ''}
                onChange={e => setClientInputs(inputs => ({ ...inputs, [id]: e.target.value }))}
              />
            );
          } else if (placeholder === '{{signature}}') {
            const id = `signature-${signatureCounter++}`;
            parts.push(
              <div
                key={id}
                className="inline-block mx-2 align-middle"
                style={{ minWidth: 220, minHeight: 100 }}
              >
                <div className="border-2 border-blue-300 rounded-lg bg-gray-50 p-3">
                  <SignaturePad
                    ref={ref => {
                      if (ref && signaturePads) signaturePads[id] = ref;
                    }}
                    penColor="#4c6fff"
                    backgroundColor="transparent"
                    canvasProps={{
                      width: 200,
                      height: 80,
                      style: {
                        display: 'block',
                        borderRadius: 8,
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
                  <div className="text-xs text-gray-500 text-center mt-2 font-medium">Sign here</div>
                </div>
              </div>
            );
          } else if (placeholder === '\n') {
            parts.push(<br key={keyPrefix + '-br-' + match.index} />);
          }
          lastIndex = match.index + match[1].length;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }
        return parts;

      }

      // Replace other placeholders (but preserve text/signature placeholders in client view)
      text = fillAllPlaceholders(text, customPricing, client, contract);

      // Robustly replace price_per_applicant for each tier row
      if (text && customPricing && customPricing.pricing_tiers) {
        const currency = customPricing.currency || 'USD';
        const tierStructure = [
          { key: '1', label: 'For one applicant' },
          { key: '2', label: 'For 2 applicants' },
          { key: '3', label: 'For 3 applicants' },
          { key: '4-7', label: 'For 4-7 applicants' },
          { key: '8-9', label: 'For 8-9 applicants' },
          { key: '10-15', label: 'For 10-15 applicants' },
          { key: '16+', label: 'For 16 applicants or more' }
        ];
        tierStructure.forEach(tier => {
          // Replace only in the correct line
          const lineRegex = new RegExp(`(${tier.label}[^\n]*?):?\s*\{\{price_per_applicant\}\}`, 'g');
          text = text.replace(lineRegex, `$1: ${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
        });
      }

      // Handle payment plan row placeholders in client view
      if (text && text.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
        if (!paymentPlanIndex) paymentPlanIndex = { current: 0 };
        let result: (string | JSX.Element)[] = [];
        let lastIdx = 0;
        let match;
        const regex = /\{\{payment_plan_row\}\}/g;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIdx) {
            result.push(text.slice(lastIdx, match.index));
          }
          const rowIndex = paymentPlanIndex.current;
          const row = customPricing.payment_plan[rowIndex];
          paymentPlanIndex.current++;
          if (row) {
            // Handle the new value format "value + VAT" or just "value"
            let displayValue = '0';
            if (row.value) {
              if (typeof row.value === 'string' && row.value.includes('+')) {
                // Parse "value + VAT" format
                const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
                const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
                displayValue = totalValue.toLocaleString();
              } else {
                // Handle numeric value or simple string
                const numValue = parseFloat(row.value) || 0;
                displayValue = numValue.toLocaleString();
              }
            }

            result.push(
              <span className="inline-block text-black font-medium border-b-2 border-black" key={keyPrefix + '-pprow-' + rowIndex}>
                {row.percent}% {rowIndex === 0 && row.due_date ? `(${row.due_date}) ` : ''}= {customPricing.currency} {displayValue}
              </span>
            );
          } else {
            result.push('');
          }
          lastIdx = match.index + match[0].length;
        }
        if (lastIdx < text.length) {
          result.push(text.slice(lastIdx));
        }
        return result.length > 0 ? result : text;
      }

      // Handle individual pricing tier placeholders
      if (text && customPricing && customPricing.pricing_tiers) {
        const currency = customPricing.currency || 'USD';

        // Replace specific tier placeholders
        text = text.replace(/For one applicant-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For one applicant- ${currency} ${(customPricing.pricing_tiers['1'] || 0).toLocaleString()}`);

        text = text.replace(/For 2 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 2 applicants- ${currency} ${(customPricing.pricing_tiers['2'] || 0).toLocaleString()}`);

        text = text.replace(/For 3 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 3 applicants- ${currency} ${(customPricing.pricing_tiers['3'] || 0).toLocaleString()}`);

        text = text.replace(/For 4-7 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 4-7 applicants- ${currency} ${(customPricing.pricing_tiers['4-7'] || 0).toLocaleString()}`);

        text = text.replace(/For 8-9 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 8-9 applicants- ${currency} ${(customPricing.pricing_tiers['8-9'] || 0).toLocaleString()}`);

        text = text.replace(/For 10-15 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 10-15 applicants- ${currency} ${(customPricing.pricing_tiers['10-15'] || 0).toLocaleString()}`);

        text = text.replace(/For 16 applicants or more-\s*[A-Z]{2,3}\s*[\d,]+/g,
          `For 16 applicants or more- ${currency} ${(customPricing.pricing_tiers['16+'] || 0).toLocaleString()}`);
      }

      // Handle payment plan placeholders
      if (text && text.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
        if (!paymentPlanIndex) paymentPlanIndex = { current: 0 };
        const rowIndex = paymentPlanIndex.current;
        const row = customPricing.payment_plan[rowIndex];
        paymentPlanIndex.current++;

        if (row) {
          if (asClient) {
            // In client view, show the payment plan data as text
            return (
              <span className="inline-block text-black font-medium border-b-2 border-black">
                {row.percent}% {row.due} = {customPricing.currency} {row.amount?.toLocaleString()}
              </span>
            );
          } else {
            // In admin view, show editable fields
            return (
              <span className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2 my-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input input-bordered input-sm w-16 text-center bg-white"
                  value={row.percent}
                  onChange={e => handlePaymentPlanChange(rowIndex, 'percent', Number(e.target.value))}
                  placeholder="%"
                />
                <span className="text-sm font-medium">%</span>
                <input
                  type="text"
                  className="input input-bordered input-sm w-32 text-center bg-white"
                  value={row.due_date}
                  onChange={e => handlePaymentPlanChange(rowIndex, 'due_date', e.target.value)}
                  placeholder="When due"
                />
                <span className="text-sm font-medium">=</span>
                <input
                  type="number"
                  min={0}
                  className="input input-bordered input-sm w-24 text-center bg-white"
                  value={row.value}
                  onChange={e => handlePaymentPlanChange(rowIndex, 'value', Number(e.target.value))}
                  placeholder="Amount"
                />
                <span className="text-sm font-medium">{customPricing.currency}</span>
              </span>
            );
          }
        }
      }

      // Default placeholder replacement
      if (text && customPricing) {
        text = text.replace(/{{applicant_count}}/g, customPricing.applicant_count?.toString() || '');
        text = text.replace(/{{total_amount}}/g, customPricing.total_amount?.toLocaleString() || '');
        text = text.replace(/{{final_amount}}/g, customPricing.final_amount?.toLocaleString() || '');
        text = text.replace(/{{discount_percentage}}/g, customPricing.discount_percentage?.toString() || '');
        text = text.replace(/{{discount_amount}}/g, customPricing.discount_amount?.toLocaleString() || '');
        text = text.replace(/{{currency}}/g, customPricing.currency || '');
        text = text.replace(/{{client_name}}/g, client?.name || '');
        text = text.replace(/{{client_phone}}/g, client?.phone || client?.mobile || '');
        text = text.replace(/{{client_email}}/g, client?.email || '');
        text = text.replace(/{{date}}/g, new Date().toLocaleDateString());
      }

      // Apply text formatting
      if (content.marks && content.marks.length > 0) {
        const formattedText = content.marks.reduce((acc: any, mark: any) => {
          if (mark.type === 'bold') return <b key={keyPrefix}>{acc}</b>;
          if (mark.type === 'italic') return <i key={keyPrefix}>{acc}</i>;
          if (mark.type === 'underline') return <u key={keyPrefix}>{acc}</u>;
          if (mark.type === 'strike') return <s key={keyPrefix}>{acc}</s>;
          return acc;
        }, text);

        // Handle line breaks after formatting
        if (typeof formattedText === 'string' && formattedText.includes('\n')) {
          const lines = formattedText.split('\n');
          return lines.map((line: string, index: number) => (
            <React.Fragment key={keyPrefix + '-line-' + index}>
              {index > 0 && <br />}
              {line}
            </React.Fragment>
          ));
        }
        return formattedText;
      }

      // Handle line breaks in plain text
      if (text && text.includes('\n')) {
        const lines = text.split('\n');
        return lines.map((line: string, index: number) => (
          <React.Fragment key={keyPrefix + '-line-' + index}>
            {index > 0 && <br />}
            {line}
          </React.Fragment>
        ));
      }
      return text;
    }

    switch (content.type) {
      case 'paragraph':
        const paragraphContent = renderTiptapContent(content.content, keyPrefix + '-p', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex);
        // Only render paragraph if it has content
        if (paragraphContent && (typeof paragraphContent === 'string' ? paragraphContent.trim() : true)) {
          return <p key={keyPrefix} className="mb-3">{paragraphContent}</p>;
        }
        return null;
      case 'heading':
        const level = content.attrs?.level || 1;
        const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        const HeadingTag = headingTags[Math.max(0, Math.min(5, level - 1))] || 'h1';
        return React.createElement(
          HeadingTag,
          { key: keyPrefix },
          renderTiptapContent(content.content, keyPrefix + '-h', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)
        );
      case 'bulletList':
        return <ul key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-ul', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)}</ul>;
      case 'orderedList':
        return <ol key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-ol', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)}</ol>;
      case 'listItem':
        return <li key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-li', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)}</li>;
      case 'blockquote':
        return <blockquote key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-bq', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex)}</blockquote>;
      case 'horizontalRule':
        return <hr key={keyPrefix} />;
      case 'hardBreak':
        return <br key={keyPrefix} />;
      default:
        return renderTiptapContent(content.content, keyPrefix + '-d', asClient, signaturePads, applicantPriceIndex, paymentPlanIndex, isReadOnly, placeholderIndex);
    }
  };

  // Add a helper to fill TipTap JSON with clientInputs
  function fillTiptapJsonWithInputs(content: any, clientInputs: { [key: string]: string }, keyPrefix = '', placeholderIndex?: { text: number; signature: number }): any {
    if (!placeholderIndex) placeholderIndex = { text: 0, signature: 0 };
    if (!content) return content;
    if (Array.isArray(content)) {
      // In fillTiptapJsonWithInputs, when recursing into an array, pass the SAME placeholderIndex object to all children (do NOT clone)
      return content.map((n, i) =>
        fillTiptapJsonWithInputs(
          n,
          clientInputs,
          keyPrefix + '-' + i,
          placeholderIndex // DO NOT CLONE
        )
      );
    }
    if (content.type === 'text' && content.text) {
      // Replace all {{text:ID}} and {{signature:ID}} with the value from clientInputs[ID]
      let newText = content.text.replace(/\{\{text:([^}]+)\}\}/g, (_m: string, id: string) => clientInputs[id] || '')
        .replace(/\{\{signature:([^}]+)\}\}/g, (_m: string, id: string) => clientInputs[id] || '');
      return { ...content, text: newText };
    }
    if (content.content) {
      return { ...content, content: fillTiptapJsonWithInputs(content.content, clientInputs, keyPrefix, placeholderIndex) };
    }
    return content;
  }

  const handleShareContractLink = async () => {
    if (!contract) return;
    let publicToken = contract.public_token;
    if (!publicToken) {
      publicToken = uuidv4();
      await supabase.from('contracts').update({ public_token: publicToken }).eq('id', contract.id);
      setContract((prev: any) => ({ ...prev, public_token: publicToken }));
    }
    const publicUrl = `${window.location.origin}/public-contract/${contract.id}/${publicToken}`;
    await navigator.clipboard.writeText(publicUrl);
    alert('Link copied!');
  };

  // Add save state
  const [isSaving, setIsSaving] = useState(false);

  // Save customPricing to DB
  const handleSaveCustomPricing = async () => {
    if (!contract || !customPricing) return;
    setIsSaving(true);
    try {
      await supabase.from('contracts').update({
        custom_pricing: customPricing,
        total_amount: customPricing.total_amount,
        applicant_count: customPricing.applicant_count,
      }).eq('id', contract.id);
      alert('Pricing and payment plan saved!');
    } catch (err) {
      alert('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete contract handler
  const handleDeleteContract = async () => {
    if (!contract) return;
    if (!window.confirm('Are you sure you want to delete this contract? This action cannot be undone.')) return;
    await supabase.from('contracts').delete().eq('id', contract.id);
    alert('Contract deleted.');
    navigate(`/clients/${leadNumber}`);
  };

  // Render signed contract content (already filled-in by client)
  const renderSignedContractContent = (content: any, keyPrefix = ''): React.ReactNode => {
    if (!content) return null;
    if (Array.isArray(content)) {
      return content.map((n, i) => renderSignedContractContent(n, keyPrefix + '-' + i));
    }
    if (content.type === 'text') {
      let text = content.text;
      text = fillAllPlaceholders(text, customPricing, client, contract);

      // Handle both {{text}} and {{text:ID}} placeholders that might still be in signed contracts
      if (text && /\{\{(text|signature)(:[^}]+)?\}\}/.test(text)) {
        const parts = [];
        let lastIndex = 0;
        const regex = /({{text(:[^}]+)?}}|{{signature(:[^}]+)?}}|\n)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const normalText = text.slice(lastIndex, match.index);
            parts.push(normalText);
          }
          const placeholder = match[1];
          const textMatch = placeholder.match(/^{{text(:[^}]+)?}}$/);
          const sigMatch = placeholder.match(/^{{signature(:[^}]+)?}}$/);
          if (textMatch) {
            const id = textMatch[1] ? textMatch[1].substring(1) : 'text-input';
            const clientValue = clientInputs[id] || '[No input provided]';
            // For signed contracts, show the actual client input value
            parts.push(
              <span key={id} className="inline-block bg-green-50 border-2 border-green-300 rounded-lg px-3 py-2 mx-1 text-sm font-medium text-green-800 min-w-[150px]">
                {clientValue}
              </span>
            );
          } else if (sigMatch) {
            const id = sigMatch[1] ? sigMatch[1].substring(1) : 'signature';
            const signatureData = clientInputs[id];
            // For signed contracts, show the actual signature if available
            if (signatureData && signatureData.startsWith('data:image/')) {
              parts.push(
                <span key={id} className="inline-block mx-1">
                  <img
                    src={signatureData}
                    alt="Client Signature"
                    style={{ width: 150, height: 60, display: 'block', borderRadius: 4, border: '1px solid #ccc' }}
                  />
                </span>
              );
            } else {
              parts.push(
                <span key={id} className="inline-block bg-blue-50 border-2 border-blue-300 rounded-lg px-3 py-2 mx-1 text-sm font-medium text-blue-800">
                  ✓ [Client Signature]
                </span>
              );
            }
          } else if (placeholder === '\n') {
            parts.push(<br key={keyPrefix + '-br-' + match.index} />);
          }
          lastIndex = match.index + match[1].length;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }
        return parts;
      }

      // Handle base64 image data that might be directly in the text (for signatures)
      if (text && text.includes('data:image/png;base64,')) {
        const parts = [];
        let lastIndex = 0;
        const regex = /(data:image\/png;base64,[A-Za-z0-9+/=]+)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const normalText = text.slice(lastIndex, match.index);
            parts.push(normalText);
          }
          const imageData = match[1];
          parts.push(
            <span key={keyPrefix + '-img-' + match.index} className="inline-block mx-1">
              <img
                src={imageData}
                alt="Signature"
                style={{ width: 150, height: 60, display: 'block', borderRadius: 4, border: '1px solid #ccc' }}
              />
            </span>
          );
          lastIndex = match.index + match[1].length;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }
        return parts.length > 0 ? parts : text;
      }

      // Handle payment plan placeholders
      if (text && text.includes('{{payment_plan_row}}') && customPricing && customPricing.payment_plan) {
        const parts = [];
        let lastIndex = 0;
        const regex = /\{\{payment_plan_row\}\}/g;
        let match;
        let rowIndex = 0;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
          }
          const row = customPricing.payment_plan[rowIndex];
          if (row) {
            // Handle the new value format "value + VAT" or just "value"
            let displayValue = '0';
            if (row.value) {
              if (typeof row.value === 'string' && row.value.includes('+')) {
                // Parse "value + VAT" format
                const parts = row.value.split('+').map((part: string) => parseFloat(part.trim()) || 0);
                const totalValue = parts.reduce((sum: number, part: number) => sum + part, 0);
                displayValue = totalValue.toLocaleString();
              } else {
                // Handle numeric value or simple string
                const numValue = parseFloat(row.value) || 0;
                displayValue = numValue.toLocaleString();
              }
            }

            parts.push(
              <span key={keyPrefix + '-pprow-' + rowIndex} className="inline-block text-black font-medium border-b-2 border-black">
                {row.percent}% {rowIndex === 0 && row.due_date ? `(${row.due_date}) ` : ''}= {customPricing.currency} {displayValue}
              </span>
            );
          }
          rowIndex++;
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }
        return parts.length > 0 ? parts : text;
      }

      // Replace pricing placeholders with actual values
      if (text && customPricing && customPricing.pricing_tiers) {
        const currency = customPricing.currency || 'USD';
        const tierStructure = [
          { key: '1', label: 'For one applicant' },
          { key: '2', label: 'For 2 applicants' },
          { key: '3', label: 'For 3 applicants' },
          { key: '4-7', label: 'For 4-7 applicants' },
          { key: '8-9', label: 'For 8-9 applicants' },
          { key: '10-15', label: 'For 10-15 applicants' },
          { key: '16+', label: 'For 16 applicants or more' }
        ];

        tierStructure.forEach(tier => {
          const lineRegex = new RegExp(`(${tier.label}[^\\n]*?):?\\s*\\{\\{price_per_applicant\\}\\}`, 'g');
          text = text.replace(lineRegex, `$1: ${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
        });
      }

      // Replace other placeholders
      text = fillAllPlaceholders(text, customPricing, client, contract);

      // Apply text formatting
      if (content.marks && content.marks.length > 0) {
        const formattedText = content.marks.reduce((acc: any, mark: any) => {
          if (mark.type === 'bold') return <b key={keyPrefix}>{acc}</b>;
          if (mark.type === 'italic') return <i key={keyPrefix}>{acc}</i>;
          if (mark.type === 'underline') return <u key={keyPrefix}>{acc}</u>;
          if (mark.type === 'strike') return <s key={keyPrefix}>{acc}</s>;
          return acc;
        }, text);

        // Handle line breaks after formatting
        if (typeof formattedText === 'string' && formattedText.includes('\n')) {
          const lines = formattedText.split('\n');
          return lines.map((line: string, index: number) => (
            <React.Fragment key={keyPrefix + '-line-' + index}>
              {index > 0 && <br />}
              {line}
            </React.Fragment>
          ));
        }
        return formattedText;
      }

      // Handle line breaks in plain text
      if (text && text.includes('\n')) {
        const lines = text.split('\n');
        return lines.map((line: string, index: number) => (
          <React.Fragment key={keyPrefix + '-line-' + index}>
            {index > 0 && <br />}
            {line}
          </React.Fragment>
        ));
      }
      return text;
    }

    switch (content.type) {
      case 'paragraph':
        const paragraphContent = renderSignedContractContent(content.content, keyPrefix + '-p');
        if (paragraphContent && (typeof paragraphContent === 'string' ? paragraphContent.trim() : true)) {
          // Check if paragraph contains input fields (React elements)
          const hasInputFields = React.isValidElement(paragraphContent) ||
            (Array.isArray(paragraphContent) && paragraphContent.some(item => React.isValidElement(item)));

          if (hasInputFields) {
            // Use div instead of p to avoid DOM nesting issues with input fields
            return <div key={keyPrefix} className="mb-3">{paragraphContent}</div>;
          } else {
            return <p key={keyPrefix} className="mb-3">{paragraphContent}</p>;
          }
        }
        return null;
      case 'heading':
        const level = content.attrs?.level || 1;
        const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        const HeadingTag = headingTags[Math.max(0, Math.min(5, level - 1))] || 'h1';
        return React.createElement(
          HeadingTag,
          { key: keyPrefix },
          renderSignedContractContent(content.content, keyPrefix + '-h')
        );
      case 'bulletList':
        return <ul key={keyPrefix}>{renderSignedContractContent(content.content, keyPrefix + '-ul')}</ul>;
      case 'orderedList':
        return <ol key={keyPrefix}>{renderSignedContractContent(content.content, keyPrefix + '-ol')}</ol>;
      case 'listItem':
        return <li key={keyPrefix}>{renderSignedContractContent(content.content, keyPrefix + '-li')}</li>;
      case 'blockquote':
        return <blockquote key={keyPrefix}>{renderSignedContractContent(content.content, keyPrefix + '-bq')}</blockquote>;
      case 'horizontalRule':
        return <hr key={keyPrefix} />;
      case 'hardBreak':
        return <br key={keyPrefix} />;
      default:
        return renderSignedContractContent(content.content, keyPrefix + '-d');
    }
  };

  // Refresh contract data to get the latest signed contract content
  const handleRefreshContract = async () => {
    if (!contract) return;
    setLoading(true);
    try {
      const { data: refreshedContract, error } = await supabase
        .from('contracts')
        .select(`
          *,
          contract_templates (
            id,
            name,
            content
          )
        `)
        .eq('id', contract.id)
        .single();

      if (error) throw error;

      setContract(refreshedContract);
      setTemplate(refreshedContract.contract_templates);

      // Load client inputs if available
      if (refreshedContract.client_inputs) {
        console.log('ContractPage: Refreshing client inputs:', refreshedContract.client_inputs);
        setClientInputs(refreshedContract.client_inputs);
      }

      setRenderKey(prev => prev + 1); // Force re-render

      if (refreshedContract.status === 'signed') {

      }
    } catch (error) {
      console.error('Error refreshing contract:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="loading loading-spinner loading-lg text-primary"></div>
        <p className="mt-4 text-gray-600">Loading contract...</p>
      </div>
    </div>
  );

  if (!client) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-500 text-lg">Client not found.</p>
        <button
          onClick={() => navigate('/clients')}
          className="mt-4 btn btn-primary"
        >
          Back to Clients
        </button>
      </div>
    </div>
  );

  if (!contract) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">No Contract Found</h2>
          <p className="text-gray-600 mb-6">
            No contract has been created for client <strong>{client.name}</strong> yet.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate(`/clients/${leadNumber}`)}
              className="btn btn-outline"
            >
              Back to Client
            </button>
            <button
              onClick={() => navigate(`/clients/${leadNumber}?tab=contact`)}
              className="btn btn-primary"
            >
              Create Contract
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!template) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-500 text-lg">Template not found.</p>
        <button
          onClick={() => navigate(`/clients/${leadNumber}`)}
          className="mt-4 btn btn-primary"
        >
          Back to Client
        </button>
      </div>
    </div>
  );

  const status = contractStatuses[contract.id]?.status || contract.status;

  // Before the return statement in ContractPage, define VAT logic
  const archivalFee = customPricing?.archival_research_fee || 0;
  const baseTotal = (customPricing?.total_amount || 0) + archivalFee;
  const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';
  const vatAmount = isIsraeli ? Math.round(baseTotal * 0.18 * 100) / 100 : 0;
  const discountAmount = customPricing?.discount_amount || 0;
  const finalAmountWithVat = baseTotal + vatAmount - discountAmount;

  // In the side panel and contract, show total as final_amount + archival_research_fee
  const totalWithArchival = (customPricing?.final_amount || 0) + (customPricing?.archival_research_fee || 0);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="w-full px-2 sm:px-4 md:px-8 lg:px-16 xl:px-32 2xl:px-48">
          <div className="flex justify-between items-center py-2 sm:py-4">
            <div className="flex items-center space-x-1 sm:space-x-4">
              <div className="min-w-0 flex-1">
                <h1 className="text-sm sm:text-2xl font-bold text-gray-900 truncate">{template.name || 'Contract'}</h1>
                <div className="flex flex-col">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">
                    Client: {client?.name} ({leadNumber})
                  </p>
                  {contract?.contact_name && contract.contact_name !== client?.name && (
                    <p className="text-xs sm:text-sm text-purple-600 font-medium truncate">
                      Contact: {contract.contact_name}
                      {contract.contact_email && (
                        <span className="text-gray-500 ml-2">• {contract.contact_email}</span>
                      )}
                    </p>
                  )}
                  {status === 'signed' && contract?.custom_content && (
                    <p className="text-xs sm:text-sm text-green-600 font-medium truncate">
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-1 sm:space-x-2">
              {!editing && status === 'draft' && (
                <button className="btn btn-outline btn-xs sm:btn-sm" onClick={() => setEditing(true)}>
                  <span className="hidden sm:inline">Edit</span>
                  <span className="sm:hidden">E</span>
                </button>
              )}
              {editing && (
                <button className="btn btn-primary btn-xs sm:btn-sm" onClick={handleSaveEdit}>
                  <span className="hidden sm:inline">Save</span>
                  <span className="sm:hidden">S</span>
                </button>
              )}

              <button
                className="btn btn-info btn-xs sm:btn-sm"
                onClick={handleShareContractLink}
                title="Copy public contract link"
              >
                <span className="hidden sm:inline">Share</span>
                <span className="sm:hidden">S</span>
              </button>
              {status === 'signed' && (
                <button
                  className="btn btn-outline btn-xs sm:btn-sm"
                  onClick={handleRefreshContract}
                  title="Refresh contract data"
                >
                  <span className="hidden sm:inline">Refresh</span>
                  <span className="sm:hidden">R</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full px-2 sm:px-6 xl:px-16 2xl:px-32 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-10 xl:gap-16 items-start">
          {/* Contract Content */}
          <div className="w-full xl:pr-0">
            <div className="bg-white rounded-lg shadow-lg border border-gray-200">
              <div className="p-8 xl:p-10 2xl:p-12">
                <div className="text-gray-900 leading-relaxed [&_.ProseMirror_p]:mb-3">
                  {editing ? (
                    <EditorContent editor={editor} />
                  ) : status === 'signed' ? (
                    // For signed contracts, show the filled-in content using custom rendering
                    <div key={`signed-${renderKey}-${customPricing?.final_amount}-${customPricing?.applicant_count}`}>
                      {contract.custom_content ? (
                        (() => {
                          console.log('🔍 Signed contract.custom_content:', contract.custom_content);
                          return renderSignedContractContent(contract.custom_content);
                        })()
                      ) : (
                        (() => {
                          console.log('🎯 Rendering signed template.content:', template.content);
                          return renderTiptapContent(template.content, '', false, undefined, undefined, undefined, true, { text: 0, signature: 0 });
                        })()
                      )}
                    </div>
                  ) : (
                    // For non-signed contracts, use the SAME EditorContent component with identical styling
                    <EditorContent
                      editor={editor}
                      key={`readonly-${renderKey}-${customPricing?.final_amount}-${customPricing?.applicant_count}`}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-full xl:w-[450px] 2xl:w-[500px]">
            <div className="space-y-6">
              {/* Contact Information */}
              {contract?.contact_name && (
                <div className="bg-white rounded-lg shadow-lg border border-gray-200">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900">Contact Information</h3>
                    <div className="space-y-3 text-sm">
                      <div className="text-gray-700">
                        <span className="font-medium">Name:</span>
                        <span className="ml-2 font-semibold text-purple-600">{contract.contact_name}</span>
                      </div>
                      {contract.contact_email && (
                        <div className="text-gray-700">
                          <span className="font-medium">Email:</span>
                          <span className="ml-2">{contract.contact_email}</span>
                        </div>
                      )}
                      {contract.contact_phone && (
                        <div className="text-gray-700">
                          <span className="font-medium">Phone:</span>
                          <span className="ml-2">{contract.contact_phone}</span>
                        </div>
                      )}
                      {contract.contact_mobile && (
                        <div className="text-gray-700">
                          <span className="font-medium">Mobile:</span>
                          <span className="ml-2">{contract.contact_mobile}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Contract Details */}
              <div className="bg-white rounded-lg shadow-lg border border-gray-200">
                <div className="p-6">
                  <h3 className="text-lg font-semibold mb-4 text-gray-900">Contract Details</h3>
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Status:</span>
                      <span className={`badge badge-sm ml-2 ${status === 'signed' ? 'badge-success' : 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none'}`}>{status}</span>
                    </div>
                    <div className="text-gray-700 flex items-center"><span className="font-medium">Applicants:</span> <span className="ml-2">{customPricing?.applicant_count || ''}</span></div>
                    <div className="text-gray-700 flex items-center">
                      <span className="font-medium">Country:</span>
                      <select
                        className="select select-bordered select-sm ml-2"
                        value={contract?.client_country || 'US'}
                        onChange={e => handleCountryChange(e.target.value)}
                        disabled={status === 'signed'}
                      >
                        <option value="IL">Israel</option>
                        <option value="US">United States</option>
                      </select>
                    </div>
                    <div className="text-gray-700"><span className="font-medium">Created:</span> {new Date(contract.created_at).toLocaleDateString()}</div>
                    {contract.signed_at && (
                      <div className="text-gray-700"><span className="font-medium">Signed:</span> {new Date(contract.signed_at).toLocaleDateString()}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Editable Pricing Panel */}
              <div className="bg-white rounded-lg shadow-lg border border-gray-200">
                <div className="p-6 space-y-6">
                  <h3 className="text-lg font-semibold text-gray-900">Pricing & Payment Plan</h3>
                  {customPricing ? (
                    <>
                      {/* Applicant Count */}
                      <div className="flex items-center justify-between">
                        <label className="font-medium text-gray-700">Number of Applicants:</label>
                        <div className="flex items-center gap-3">
                          <button
                            className="btn btn-circle btn-md bg-gray-200 hover:bg-blue-200 border-none flex items-center justify-center"
                            style={{ width: 40, height: 40 }}
                            onClick={() => handleApplicantCountChange(Math.max(1, (customPricing.applicant_count || 1) - 1))}
                            aria-label="Decrease number of applicants"
                            type="button"
                            disabled={status === 'signed'}
                          >
                            <MinusIcon className="w-6 h-6 text-blue-600" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={50}
                            className="input input-bordered input-lg w-28 text-center bg-white text-lg font-bold px-4 py-2 rounded-xl border-2 border-blue-300 focus:border-blue-500 no-arrows"
                            value={customPricing.applicant_count || 1}
                            onChange={e => handleApplicantCountChange(Number(e.target.value))}
                            style={{ height: 48 }}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            disabled={status === 'signed'}
                          />
                          <button
                            className="btn btn-circle btn-md bg-gray-200 hover:bg-blue-200 border-none flex items-center justify-center"
                            style={{ width: 40, height: 40 }}
                            onClick={() => handleApplicantCountChange(Math.min(50, (customPricing.applicant_count || 1) + 1))}
                            aria-label="Increase number of applicants"
                            type="button"
                            disabled={status === 'signed'}
                          >
                            <PlusIcon className="w-6 h-6 text-blue-600" />
                          </button>
                        </div>
                      </div>

                      {/* Pricing Tiers */}
                      <div>
                        <label className="block font-medium text-gray-700 mb-3">Pricing Tiers (Price per applicant):</label>
                        <div className="space-y-2">
                          {customPricing.pricing_tiers ? (() => {
                            const tierStructure = [
                              { key: '1', label: 'For one applicant' },
                              { key: '2', label: 'For 2 applicants' },
                              { key: '3', label: 'For 3 applicants' },
                              { key: '4-7', label: 'For 4-7 applicants' },
                              { key: '8-9', label: 'For 8-9 applicants' },
                              { key: '10-15', label: 'For 10-15 applicants' },
                              { key: '16+', label: 'For 16 applicants or more' }
                            ];

                            const getCurrentTierKey = (count: number) => {
                              if (count === 1) return '1';
                              if (count === 2) return '2';
                              if (count === 3) return '3';
                              if (count >= 4 && count <= 7) return '4-7';
                              if (count >= 8 && count <= 9) return '8-9';
                              if (count >= 10 && count <= 15) return '10-15';
                              return '16+';
                            };

                            const currentTierKey = getCurrentTierKey(customPricing.applicant_count);

                            return tierStructure.map(tier => {
                              const price = customPricing.pricing_tiers[tier.key] || 0;
                              const isActive = tier.key === currentTierKey;
                              return (
                                <div key={tier.key} className={`flex items-center justify-between p-2 rounded-lg ${isActive
                                    ? 'bg-blue-50 border-2 border-blue-200'
                                    : 'bg-gray-50 border border-gray-200'
                                  }`}>
                                  <span className="text-base font-semibold text-gray-700">
                                    {tier.label}:
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <button
                                      className="btn btn-circle btn-md bg-gray-200 hover:bg-blue-200 border-none flex items-center justify-center"
                                      style={{ width: 40, height: 40 }}
                                      onClick={() => handleTierPriceChange(tier.key, Math.max(0, price - 100))}
                                      aria-label={`Decrease price for ${tier.label}`}
                                      type="button"
                                      disabled={status === 'signed'}
                                    >
                                      <MinusIcon className="w-6 h-6 text-blue-600" />
                                    </button>
                                    <input
                                      type="number"
                                      min={0}
                                      className="input input-bordered input-lg w-36 text-right bg-white text-lg font-bold px-4 py-2 rounded-xl border-2 border-blue-300 focus:border-blue-500 no-arrows"
                                      value={price}
                                      onChange={e => handleTierPriceChange(tier.key, Number(e.target.value))}
                                      style={{ height: 48 }}
                                      disabled={status === 'signed'}
                                    />
                                    <button
                                      className="btn btn-circle btn-md bg-gray-200 hover:bg-blue-200 border-none flex items-center justify-center"
                                      style={{ width: 40, height: 40 }}
                                      onClick={() => handleTierPriceChange(tier.key, price + 100)}
                                      aria-label={`Increase price for ${tier.label}`}
                                      type="button"
                                      disabled={status === 'signed'}
                                    >
                                      <PlusIcon className="w-6 h-6 text-blue-600" />
                                    </button>
                                    <span className="text-base font-semibold text-gray-600">{customPricing.currency}</span>
                                  </div>
                                </div>
                              );
                            });
                          })() : (
                            <div className="text-gray-500 text-sm p-4 text-center">
                              Loading pricing tiers...
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Discount */}
                      <div className="flex items-center justify-between">
                        <label className="font-medium text-gray-700">Discount:</label>
                        <select
                          className="select select-bordered select-md w-24 text-right bg-white"
                          value={customPricing.discount_percentage}
                          onChange={e => {
                            const discount = Number(e.target.value);
                            const getCurrentTierKey = (count: number) => {
                              if (count === 1) return '1';
                              if (count === 2) return '2';
                              if (count === 3) return '3';
                              if (count >= 4 && count <= 7) return '4-7';
                              if (count >= 8 && count <= 9) return '8-9';
                              if (count >= 10 && count <= 15) return '10-15';
                              return '16+';
                            };
                            const currentTierKey = getCurrentTierKey(customPricing.applicant_count);
                            const currentTierPrice = customPricing.pricing_tiers?.[currentTierKey] || 0;
                            const total = currentTierPrice * (customPricing.applicant_count || 1);
                            const discountAmount = Math.round(total * (discount / 100));
                            const finalAmount = total - discountAmount;

                            // Calculate final amount with VAT for payment plan calculations
                            const archivalFee = customPricing?.archival_research_fee || 0;
                            const baseTotal = total + archivalFee;
                            const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';

                            // Calculate VAT on the discounted amount (baseTotal - discountAmount)
                            const discountedBaseTotal = baseTotal - discountAmount;
                            const vatAmount = isIsraeli ? Math.round(discountedBaseTotal * 0.18 * 100) / 100 : 0;
                            const finalAmountWithVat = discountedBaseTotal + vatAmount;

                            // Recalculate payment plan amounts - each payment should show "value + VAT" only if there's VAT
                            let paymentPlan = customPricing.payment_plan || [];
                            if (paymentPlan.length > 0) {
                              const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
                              paymentPlan = paymentPlan.map((row: any) => {
                                // Calculate the base value for this percentage (based on discounted amount)
                                const baseValueForThisPercent = Math.round((discountedBaseTotal * Number(row.percent)) / totalPercent);
                                // Calculate the VAT for this percentage
                                const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;
                                // The amount field should show "value + VAT" format only if there's VAT, otherwise just the value
                                return {
                                  ...row,
                                  value: isIsraeli && vatForThisPercent > 0 ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString(),
                                };
                              });
                            }

                            updateCustomPricing({
                              discount_percentage: discount,
                              discount_amount: discountAmount,
                              final_amount: finalAmount,
                              payment_plan: paymentPlan,
                            });
                          }}
                          disabled={status === 'signed'}
                        >
                          {discountOptions.map(opt => (
                            <option key={opt} value={opt}>{opt}%</option>
                          ))}
                        </select>
                      </div>

                      {/* Totals */}
                      <div className="space-y-2 pt-3 border-t border-gray-200">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Total:</span>
                          <span className="font-semibold text-gray-900">{customPricing.currency} {(customPricing.total_amount || 0).toLocaleString()}</span>
                        </div>
                        {customPricing?.archival_research_fee && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Archival Research:</span>
                            <span className="font-semibold text-gray-900">{customPricing.currency} {customPricing.archival_research_fee.toLocaleString()}</span>
                          </div>
                        )}
                        {isIsraeli && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">VAT (18%):</span>
                            <span className="font-semibold text-gray-900">{customPricing.currency} {vatAmount.toLocaleString()}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Discount:</span>
                          <span className="font-semibold text-gray-900">{customPricing.currency} {discountAmount.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-gray-900">Final Amount:</span>
                          <span className="font-bold text-lg text-blue-600">{customPricing.currency} {finalAmountWithVat.toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Payment Plan Editor */}
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Payment Plan</h4>
                        {(() => {
                          const totalPercent = (customPricing.payment_plan || []).reduce((sum: number, row: any) => sum + Number(row.percent), 0);
                          if (totalPercent < 100) {
                            return (
                              <div className="flex items-center gap-3 p-4 mb-3 rounded-xl shadow-lg bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white">
                                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                                <span className="font-medium">Payment plan total is {totalPercent}%. Please ensure the total equals 100%.</span>
                              </div>
                            );
                          }
                          return null;
                        })()}
                        <div className="space-y-3">
                          {(customPricing.payment_plan || []).map((row: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-3 bg-gray-50 p-4 rounded-lg">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                className="input input-bordered w-24 text-center bg-white text-xl font-bold px-4 py-3 rounded-xl border-2 border-blue-300 focus:border-blue-500 no-arrows"
                                value={row.percent === 0 ? '' : row.percent}
                                onChange={e => {
                                  const value = e.target.value;
                                  // If the field is empty or 0, treat it as 0
                                  const numValue = value === '' ? 0 : Number(value);
                                  handlePaymentPlanChange(idx, 'percent', numValue);
                                }}
                                placeholder="%"
                                disabled={status === 'signed'}
                              />
                              <span className="text-lg font-semibold text-gray-700">%</span>
                              <span className="text-lg font-semibold text-gray-700">=</span>
                              <input
                                type="text"
                                className="input input-bordered w-40 text-center bg-white text-xl font-bold px-4 py-3 rounded-xl border-2 border-blue-300 focus:border-blue-500"
                                value={row.value}
                                onChange={e => handlePaymentPlanChange(idx, 'value', e.target.value)}
                                placeholder="Value + VAT"
                                disabled={status === 'signed'}
                              />
                              <span className="text-lg font-semibold text-gray-700">{customPricing.currency}</span>
                              <button
                                className="btn btn-circle btn-ghost text-red-500 hover:bg-red-100 text-xl font-bold w-10 h-10"
                                onClick={() => handleDeletePaymentRow(idx)}
                                disabled={status === 'signed'}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button className="btn btn-outline btn-sm w-full" onClick={handleAddPaymentRow} disabled={status === 'signed'}>
                            + Add Payment
                          </button>
                        </div>
                      </div>
                      {/* Save Button */}
                      {status !== 'signed' && (
                        <button
                          className="btn btn-primary btn-block mt-4"
                          onClick={handleSaveCustomPricing}
                          disabled={isSaving}
                        >
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                      )}
                      {/* Delete Contract Button (show for all users if signed) */}
                      {status === 'signed' && (
                        <button
                          className="btn btn-error btn-block mt-4"
                          onClick={handleDeleteContract}
                        >
                          Delete Contract
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="text-gray-500">Loading pricing data...</div>
                  )}
                </div>
              </div>

              {/* Actions */}
              {status === 'draft' && (
                <div className="bg-white rounded-lg shadow-lg border border-gray-200">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900">Actions</h3>
                    <div className="space-y-3">
                      <div className="alert alert-info bg-blue-50 border-blue-200">
                        <div className="text-sm text-blue-800">
                          <strong>Ready to sign?</strong><br />
                          Please review the contract carefully and fill in all required fields before signing.
                        </div>
                      </div>
                      <button
                        className="btn btn-success btn-lg w-full"
                        onClick={handleSignContract}
                      >
                        <CheckIcon className="w-5 h-5 mr-2" />
                        Sign Contract
                      </button>
                      <p className="text-xs text-gray-500">
                        Signing will generate payment plans and proforma invoices automatically.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Remove default arrows from all number inputs
// Add this style at the end of the file or in a global style block
<style>{`
  input[type=number].no-arrows::-webkit-inner-spin-button, 
  input[type=number].no-arrows::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type=number].no-arrows {
    -moz-appearance: textfield;
  }
  
  /* Ensure read-only mode has identical styling to edit mode */
  .ProseMirror[contenteditable="false"] {
    padding: 0 !important;
    margin: 0 !important;
    min-height: 0 !important;
  }
  
  .ProseMirror[contenteditable="false"] p {
    margin-bottom: 0.75rem !important;
    margin-top: 0 !important;
  }
  
  .ProseMirror[contenteditable="false"] p:last-child {
    margin-bottom: 0 !important;
  }
  
  /* Style {{text}} and {{signature}} placeholders to look like input fields in view mode */
  .ProseMirror[contenteditable="false"] .text-field-placeholder {
    display: inline-block;
    min-width: 150px;
    height: 40px;
    border: 2px solid #d1d5db;
    border-radius: 8px;
    background-color: #f9fafb;
    padding: 8px 12px;
    margin: 0 4px;
    font-size: 14px;
    color: #6b7280;
    font-style: italic;
  }
  
  .ProseMirror[contenteditable="false"] .signature-placeholder {
    display: inline-block;
    min-width: 200px;
    height: 80px;
    border: 2px solid #d1d5db;
    border-radius: 8px;
    background-color: #f9fafb;
    margin: 0 4px;
    position: relative;
  }
  
  .ProseMirror[contenteditable="false"] .signature-placeholder::after {
    content: "Sign here";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #9ca3af;
    font-size: 12px;
    font-style: italic;
  }
`}</style>

export default ContractPage; 