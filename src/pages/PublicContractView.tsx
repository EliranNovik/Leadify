import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SignaturePad from 'react-signature-canvas';
import { handleContractSigned } from '../lib/contractAutomation';
import { generateJSON } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { FontSize } from '@tiptap/extension-font-size';
// @ts-ignore - html2pdf.js doesn't have TypeScript definitions
import html2pdf from 'html2pdf.js';
import { PrinterIcon, ArrowDownTrayIcon, ShareIcon } from '@heroicons/react/24/outline';

// Editor extensions for HTML to TipTap JSON conversion
const editorExtensionsForConversion = [
  StarterKit,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight,
  Color,
  TextStyle,
  FontFamily,
  FontSize,
];

// Helper function to validate and normalize TipTap content
function normalizeTiptapContent(content: any): any {
  if (!content) {
    return { type: 'doc', content: [] };
  }
  
  // If content is a string, try to parse it as JSON
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      content = parsed;
    } catch (e) {
      // Try to convert HTML string to TipTap JSON
      try {
        return generateJSON(content, editorExtensionsForConversion);
      } catch (conversionError) {
        console.error('Failed to convert HTML string to TipTap JSON:', conversionError);
        return { type: 'doc', content: [] };
      }
    }
  }
  
  // Check if content has html/delta properties (Quill format - convert HTML to TipTap JSON)
  if (content && typeof content === 'object' && ('html' in content || 'delta' in content)) {
    const htmlContent = content.html;
    
    if (htmlContent && typeof htmlContent === 'string') {
      try {
        return generateJSON(htmlContent, editorExtensionsForConversion);
      } catch (conversionError) {
        console.error('Failed to convert HTML to TipTap JSON:', conversionError);
        return { type: 'doc', content: [] };
      }
    } else {
      return { type: 'doc', content: [] };
    }
  }
  
  // Check if content is a valid TipTap JSON structure
  if (content && typeof content === 'object' && content.type === 'doc') {
    if (Array.isArray(content.content)) {
      return content;
    } else {
      return { type: 'doc', content: content.content || [] };
    }
  }
  
  // If content is an object but not a valid TipTap doc, try to wrap it
  if (content && typeof content === 'object') {
    if (Array.isArray(content)) {
      return { type: 'doc', content: content };
    }
    
    if (content.type && content.content !== undefined) {
      return { type: 'doc', content: [content] };
    }
    
    if (content.content && Array.isArray(content.content)) {
      return { type: 'doc', content: content.content };
    }
  }
  
  // Fallback: return empty doc
  return { type: 'doc', content: [] };
}

// Function to preprocess template placeholders
function preprocessTemplatePlaceholders(content: any): any {
  let textId = 1;
  let signatureId = 1;
  let dateId = 1;
  
  function processContent(content: any): any {
    if (!content) return content;
    if (Array.isArray(content)) {
      return content.map(processContent);
    }
    if (content.type === 'text' && content.text) {
      // Process date FIRST to avoid conflicts, then signature, then text
      let newText = content.text
                               .replace(/\{\{date\}\}/g, () => {
                                 const dateIdStr = `date-${dateId++}`;
                                 return `{{date:${dateIdStr}}}`;
                               })
                               .replace(/\{\{signature\}\}/g, () => {
                                 const sigIdStr = `signature-${signatureId++}`;
                                 return `{{signature:${sigIdStr}}}`;
                               })
                               .replace(/\{\{text\}\}/g, () => {
                                 const textIdStr = `text-${textId++}`;
                                 return `{{text:${textIdStr}}}`;
                               });
      return { ...content, text: newText };
    }
    if (content.content) {
      return { ...content, content: processContent(content.content) };
    }
    return content;
  }
  
  const result = processContent(content);
  return result;
}

function fillAllPlaceholders(text: string, customPricing: any, client: any, contract?: any) {
  if (!text) return text;
  let result = text;
  if (customPricing) {
    result = result.replace(/{{applicant_count}}/g, customPricing.applicant_count?.toString() || '');
    result = result.replace(/{{total_amount}}/g, customPricing.total_amount?.toLocaleString() || '');
    result = result.replace(/{{final_amount}}/g, customPricing.final_amount?.toLocaleString() || '');
    result = result.replace(/{{discount_percentage}}/g, customPricing.discount_percentage?.toString() || '');
    result = result.replace(/{{discount_amount}}/g, customPricing.discount_amount?.toLocaleString() || '');
    result = result.replace(/{{currency}}/g, customPricing.currency || '');
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
  
  // Don't auto-replace {{date}} - let user pick the date via date picker
  // The {{date:ID}} placeholders will be handled in renderTiptapContent
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

const PublicContractView: React.FC = () => {
  const { contractId, token } = useParams();
  const [contract, setContract] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [customPricing, setCustomPricing] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signaturePads, setSignaturePads] = useState<{ [key: string]: any }>({});
  // Add submit state and client field state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientFields, setClientFields] = useState<{ [key: string]: string }>({});
  const [clientSignature, setClientSignature] = useState<string | null>(null);
  const [thankYou, setThankYou] = useState(false);
  const [applicantFieldIds, setApplicantFieldIds] = useState<string[]>([]);
  const [activeApplicantFields, setActiveApplicantFields] = useState<string[]>([]); // Fields that are currently visible (can be added/removed)
  const [dynamicApplicantFieldCounter, setDynamicApplicantFieldCounter] = useState(0); // Counter for generating new field IDs
  const [leadNumber, setLeadNumber] = useState<string | null>(null);
  
  // Ref for contract content area (for PDF generation)
  const contractContentRef = useRef<HTMLDivElement>(null);
  
  // PDF loading state
  const [pdfLoading, setPdfLoading] = useState(false);

  // Helper to recursively fill placeholders in TipTap JSON
  function fillClientFieldsInContent(content: any): any {
    if (Array.isArray(content)) {
      return content.map(fillClientFieldsInContent);
    }
    if (content && typeof content === 'object') {
      if (content.type === 'text' && typeof content.text === 'string') {
        let text = content.text;
        // Replace {{text:ID}} fields with actual client input values
        text = text.replace(/\{\{text:([^}]+)\}\}/g, (match: string, id: string) => {
          return clientFields[id] || '';
        });
        // Replace {{signature:ID}} fields with signature data
        text = text.replace(/\{\{signature:([^}]+)\}\}/g, (match: string, id: string) => {
          return clientSignature || '[Signed]';
        });
        // Replace {{date:ID}} fields with formatted date values when signing
        text = text.replace(/\{\{date:([^}]+)\}\}/g, (match: string, id: string) => {
          const dateValue = clientFields[id] || '';
          if (!dateValue) return '';
          
          // Format date for display
          try {
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
              const date = new Date(dateValue + 'T00:00:00');
              if (!isNaN(date.getTime())) {
                return date.toLocaleDateString('en-US', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                });
              }
            } else {
              const date = new Date(dateValue);
              if (!isNaN(date.getTime())) {
                return date.toLocaleDateString('en-US', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                });
              }
            }
          } catch (e) {
            // If formatting fails, return the raw value
          }
          return dateValue;
        });
        return { ...content, text };
      }
      // Recursively fill in children
      if (content.content) {
        return { ...content, content: fillClientFieldsInContent(content.content) };
      }
      return content;
    }
    return content;
  }

  // Handler for text field changes
  const handleClientFieldChange = (key: string, value: string) => {
    console.log('📝 handleClientFieldChange called:', { key, value, valueType: typeof value, valueLength: value?.length });
    setClientFields(prev => {
      const newFields = { ...prev, [key]: value };
      console.log('📝 Setting clientFields:', { 
        key, 
        oldValue: prev[key], 
        newValue: value, 
        allFields: Object.keys(newFields).length,
        fieldValue: newFields[key]
      });
      return newFields;
    });
  };

  // Handler for signature
  const handleClientSignature = (dataUrl: string) => {
    setClientSignature(dataUrl);
    // Also save to clientFields for database storage
    setClientFields(prev => ({ ...prev, signature: dataUrl }));
  };

  useEffect(() => {
    if (!contractId || !token) return;
    setLoading(true);
    (async () => {
      // Fetch contract by id and public_token
      const { data: contractData, error: contractError } = await supabase
        .from('contracts')
        .select(`*, contract_templates ( id, name, content )`)
        .eq('id', contractId)
        .eq('public_token', token)
        .single();
      if (contractError || !contractData) {
        setError('Invalid or expired contract link.');
        setLoading(false);
        return;
      }
      setContract(contractData);
      setCustomPricing(contractData.custom_pricing);
      
      // Fetch template - handle both new templates (contract_templates) and legacy templates (misc_contracttemplate)
      let templateData = contractData.contract_templates;
      
      // If no template from join, check if we need to fetch from misc_contracttemplate (legacy)
      if (!templateData) {
        // First check if template_id is set and try fetching as legacy template
        if (contractData.template_id) {
          const isLegacyTemplate = !isNaN(Number(contractData.template_id)) || contractData.template_id.toString().startsWith('legacy_');
          
          if (isLegacyTemplate) {
            const templateId = contractData.template_id.toString().replace('legacy_', '');
            const { data: legacyTemplate, error: legacyTemplateError } = await supabase
              .from('misc_contracttemplate')
              .select('*')
              .eq('id', templateId)
              .single();
            
            if (!legacyTemplateError && legacyTemplate) {
              templateData = legacyTemplate;
            }
          }
        }
        // If template_id is NULL, check for legacy_template_id in custom_pricing
        else if (contractData.custom_pricing?.legacy_template_id) {
          const legacyTemplateId = contractData.custom_pricing.legacy_template_id;
          const { data: legacyTemplate, error: legacyTemplateError } = await supabase
            .from('misc_contracttemplate')
            .select('*')
            .eq('id', legacyTemplateId)
            .single();
          
          if (!legacyTemplateError && legacyTemplate) {
            templateData = legacyTemplate;
          }
        }
      }
      
      // Process template to add text and signature placeholders
      if (templateData) {
        // First normalize to ensure valid TipTap JSON (handles HTML/delta format)
        let normalizedContent = normalizeTiptapContent(templateData.content);
        
        // Then preprocess placeholders
        const processedContent = normalizedContent && normalizedContent.type === 'doc' ?
          preprocessTemplatePlaceholders(normalizedContent) :
          normalizedContent;
        
        const processedTemplate = {
          ...templateData,
          content: processedContent
        };
        setTemplate(processedTemplate);
      } else {
        setError('Template not found for this contract.');
        setLoading(false);
        return;
      }
      // Fetch client info and lead number
      // Check if this is a legacy lead (has legacy_id) or new lead (has client_id)
      if (contractData.legacy_id) {
        // Legacy lead - fetch from leads_lead table using legacy_id from contracts table
        const { data: legacyLeadData } = await supabase
          .from('leads_lead')
          .select('id, lead_number, manual_id, master_id, name, email, phone, mobile')
          .eq('id', contractData.legacy_id)
          .single();
        
        if (legacyLeadData) {
          setClient({
            id: legacyLeadData.id,
            name: legacyLeadData.name,
            email: legacyLeadData.email,
            phone: legacyLeadData.phone,
            mobile: legacyLeadData.mobile
          });
          
          // Format lead number: handle subleads (master_id/suffix) or master leads
          let formattedLeadNumber: string;
          const masterId = legacyLeadData.master_id;
          
          if (masterId && String(masterId).trim() !== '') {
            // It's a sub-lead - calculate suffix from all subleads with same master_id
            const { data: allSubLeads } = await supabase
              .from('leads_lead')
              .select('id')
              .eq('master_id', masterId)
              .not('master_id', 'is', null)
              .order('id', { ascending: true });
            
            if (allSubLeads && allSubLeads.length > 0) {
              const suffix = allSubLeads.findIndex(subLead => subLead.id === legacyLeadData.id) + 2;
              formattedLeadNumber = `${masterId}/${suffix}`;
            } else {
              // Fallback if subleads not found
              formattedLeadNumber = `${masterId}/?`;
            }
          } else {
            // It's a master lead - use lead_number, then manual_id, then id
            formattedLeadNumber = legacyLeadData.lead_number 
              ? String(legacyLeadData.lead_number)
              : (legacyLeadData.manual_id 
                ? String(legacyLeadData.manual_id)
                : String(legacyLeadData.id));
          }
          
          setLeadNumber(formattedLeadNumber);
        }
      } else if (contractData.client_id) {
        // New lead - fetch from leads table
        const { data: leadData } = await supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile')
          .eq('id', contractData.client_id)
          .single();
        
        if (leadData) {
          setClient(leadData);
          // Format lead number: use lead_number with L prefix if it doesn't have it
          const formattedLeadNumber = leadData.lead_number 
            ? (leadData.lead_number.startsWith('L') ? leadData.lead_number : `L${leadData.lead_number}`)
            : null;
          setLeadNumber(formattedLeadNumber);
        }
      }
      
      // Load saved client inputs if contract was previously started
      if (contractData.client_inputs) {
        setClientFields(contractData.client_inputs);
      }
      
      setLoading(false);
    })();
  }, [contractId, token]);


  // Track applicant fields for UI purposes only
  useEffect(() => {
    if (!template?.content || contract?.status === 'signed') return;
    
    const contentStr = JSON.stringify(template.content);
    
    // Helper function to recursively extract text content from template structure
    const extractTextFromContent = (content: any, depth = 0): string => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content.map(item => extractTextFromContent(item, depth + 1)).join(' ');
      }
      if (content && typeof content === 'object') {
        if (content.text) return content.text;
        if (content.content) return extractTextFromContent(content.content, depth + 1);
      }
      return '';
    };
    
    // Helper function to find all text field positions with their surrounding context
    const findTextFieldsWithContext = (content: any, path: string[] = []): Array<{ id: string; context: string; position: number }> => {
      const results: Array<{ id: string; context: string; position: number }> = [];
      
      if (Array.isArray(content)) {
        content.forEach((item, idx) => {
          results.push(...findTextFieldsWithContext(item, [...path, String(idx)]));
        });
      } else if (content && typeof content === 'object') {
        // Extract all text from this node and its siblings
        const nodeText = extractTextFromContent(content);
        
        // Look for text field placeholders
        const fieldMatches = nodeText.match(/\{\{text:([^}]+)\}\}/g);
        if (fieldMatches) {
          fieldMatches.forEach(match => {
            const id = match.match(/\{\{text:([^}]+)\}\}/)?.[1];
            if (id) {
              // Get context from surrounding text in this node
              results.push({
                id,
                context: nodeText.toLowerCase(),
                position: results.length
              });
            }
          });
        }
        
        // Recursively check children
        if (content.content) {
          results.push(...findTextFieldsWithContext(content.content, [...path, 'content']));
        }
      }
      
      return results;
    };
    
    // Get all date field IDs (for applicant field detection)
    const dateFieldIds = new Set<string>();
    const dateMatches = contentStr.match(/\{\{date:([^}]+)\}\}/g) || [];
    dateMatches.forEach(match => {
      const id = match.match(/\{\{date:([^}]+)\}\}/)?.[1];
      if (id) {
        dateFieldIds.add(id);
      }
    });
    
    // Find text matches for applicant field detection
    const textMatches = contentStr.match(/\{\{text:([^}]+)\}\}/g) || [];
    
    // Identify applicant fields for UI purposes
    const applicantFields: Array<{ id: string; position: number; context: string }> = [];
    const fieldContexts = findTextFieldsWithContext(template?.content || {});
    
    textMatches.forEach(match => {
      const id = match.match(/\{\{text:([^}]+)\}\}/)?.[1];
      if (!id) return;
      
      // Skip if this is a date field
      if (dateFieldIds.has(id)) {
        return;
      }
      
      // Check if this field is an applicant name field by ID
      const idLower = id.toLowerCase();
      let isApplicantField = idLower.startsWith('text:applicant') || idLower.startsWith('applicant');
      
      // Find the position and context of this placeholder
      const placeholderPattern = `{{text:${id}}}`;
      let placeholderIndex = contentStr.indexOf(placeholderPattern);
      let context = '';
      
      // Get context from the fieldContexts we found
      const fieldContext = fieldContexts.find(fc => fc.id === id);
      if (fieldContext) {
        context = fieldContext.context;
      }
      
      // Also check surrounding context in the JSON string
      if (placeholderIndex !== -1) {
        // Check 500 characters before and after for "applicant" mentions
        const contextStart = Math.max(0, placeholderIndex - 500);
        const contextEnd = Math.min(contentStr.length, placeholderIndex + placeholderPattern.length + 500);
        const jsonContext = contentStr.substring(contextStart, contextEnd).toLowerCase();
        context = context || jsonContext;
      }
      
      if (isApplicantField) {
        applicantFields.push({ id, position: placeholderIndex !== -1 ? placeholderIndex : 999999, context });
      }
    });
    
    // Sort applicant fields by position in the content
    applicantFields.sort((a, b) => a.position - b.position);
    const sortedApplicantIds = applicantFields.map(f => f.id);
    setApplicantFieldIds(sortedApplicantIds);
    
    // Initialize activeApplicantFields with detected fields if not already set
    setActiveApplicantFields(prev => {
      if (sortedApplicantIds.length === 0) return prev;
      
      if (prev.length === 0 && sortedApplicantIds.length > 0) {
        return [...sortedApplicantIds];
      }
      
      const merged = [...prev];
      let hasChanges = false;
      sortedApplicantIds.forEach(id => {
        if (!merged.includes(id)) {
          merged.push(id);
          hasChanges = true;
        }
      });
      
      return hasChanges ? merged : prev;
    });
  }, [template, contract?.status]);

  // Add a handler for submitting the contract (signing)
  const handleSubmitContract = async () => {
    if (!contract) return;
    
    setIsSubmitting(true);
    try {
      // Fill in client fields in the contract content
      const filledContent = fillClientFieldsInContent(contract.custom_content || template.content?.content);
      await supabase.from('contracts').update({
        custom_content: filledContent,
        client_inputs: clientFields, // Save the actual client input values
        status: 'signed',
        signed_at: new Date().toISOString(),
      }).eq('id', contract.id);
      // Fetch updated contract
      const { data: updatedContract } = await supabase
        .from('contracts')
        .select('*')
        .eq('id', contract.id)
        .single();
      
      // For new leads (has client_id), directly update stage in leads and leads_leadstage tables
      if (updatedContract && updatedContract.client_id && !updatedContract.legacy_id) {
        console.log('📝 Public contract signing: Updating lead stage to "Client signed agreement" for new lead:', updatedContract.client_id);
        
        const timestamp = new Date().toISOString();
        const stageId = 60; // Client signed agreement
        
        // Step 1: Insert into leads_leadstage table
        const { error: stageInsertError } = await supabase
          .from('leads_leadstage')
          .insert({
            newlead_id: updatedContract.client_id,
            stage: stageId,
            date: timestamp,
            cdate: timestamp,
            udate: timestamp,
            creator_id: null, // No creator for public contract signing
          });
        
        if (stageInsertError) {
          console.error('❌ Failed to insert stage record:', stageInsertError);
          alert(`Warning: Contract signed but stage history update failed: ${stageInsertError.message || 'Database error'}. Please contact support.`);
        } else {
          console.log('✅ Stage history record inserted successfully');
        }
        
        // Step 2: Update the lead's stage in leads table
        const { error: leadUpdateError } = await supabase
          .from('leads')
          .update({
            stage: stageId,
            stage_changed_at: timestamp,
          })
          .eq('id', updatedContract.client_id);
        
        if (leadUpdateError) {
          console.error('❌ Failed to update lead stage:', {
            error: leadUpdateError,
            code: leadUpdateError.code,
            message: leadUpdateError.message,
            contractId: updatedContract.id,
            token: token,
            clientId: updatedContract.client_id,
          });
          alert(`Warning: Contract signed but stage update failed: ${leadUpdateError.message || 'Database error'}. Please contact support.`);
        } else {
          console.log('✅ Lead stage "Client signed agreement" (stage 60) successfully updated');
        }
      } else if (updatedContract && updatedContract.legacy_id) {
        // For legacy leads (has legacy_id) in new contracts table, directly update stage
        console.log('📝 Public contract signing: Updating lead stage to 60 for legacy lead in contracts table:', updatedContract.legacy_id);
        
        const timestamp = new Date().toISOString();
        const stageId = 60; // Client signed agreement
        const legacyId = typeof updatedContract.legacy_id === 'number' 
          ? updatedContract.legacy_id 
          : parseInt(updatedContract.legacy_id, 10);
        
        // Step 1: Insert into leads_leadstage table
        const { error: stageInsertError } = await supabase
          .from('leads_leadstage')
          .insert({
            lead_id: legacyId,
            stage: stageId,
            date: timestamp,
            cdate: timestamp,
            udate: timestamp,
            creator_id: null, // No creator for public contract signing
          });
        
        if (stageInsertError) {
          console.error('❌ Failed to insert stage record:', stageInsertError);
          alert(`Warning: Contract signed but stage history update failed: ${stageInsertError.message || 'Database error'}. Please contact support.`);
        } else {
          console.log('✅ Stage history record inserted successfully');
        }
        
        // Step 2: Update the lead's stage in leads_lead table
        const { error: leadUpdateError } = await supabase
          .from('leads_lead')
          .update({
            stage: stageId,
            stage_changed_at: timestamp,
          })
          .eq('id', legacyId);
        
        if (leadUpdateError) {
          console.error('❌ Failed to update legacy lead stage:', {
            error: leadUpdateError,
            code: leadUpdateError.code,
            message: leadUpdateError.message,
            contractId: updatedContract.id,
            token: token,
            legacyId: updatedContract.legacy_id,
          });
          alert(`Warning: Contract signed but stage update failed: ${leadUpdateError.message || 'Database error'}. Please contact support.`);
        } else {
          console.log('✅ Lead stage 60 (Client signed agreement) successfully updated');
        }
      }
      
      // Trigger backend logic (e.g., payment plan, lead balance)
      if (updatedContract) {
        await handleContractSigned(updatedContract);
      }
      
      // Only scroll to top AFTER successful submission
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      setThankYou(true);
      setContract(updatedContract);
    } catch (err) {
      console.error('Error submitting contract:', err);
      alert('Failed to submit contract. Please try again.');
      // Don't set thankYou to true if there was an error
      // Don't scroll to top if there was an error
    } finally {
      setIsSubmitting(false);
    }
  };

  // Print contract handler
  const handlePrint = () => {
    window.print();
  };

  // Share contract handler (mobile only - uses Web Share API)
  const handleShareContract = async () => {
    if (!contract) return;
    
    const contractUrl = window.location.href;
    const contractTitle = `Contract for ${contract?.contact_name || client?.name || 'Client'}`;
    
    // Check if Web Share API is available (mobile devices)
    if (navigator.share) {
      try {
        await navigator.share({
          title: contractTitle,
          text: `Please review this contract: ${contractTitle}`,
          url: contractUrl,
        });
      } catch (error: any) {
        // User cancelled or error occurred
        if (error.name !== 'AbortError') {
          console.error('Error sharing contract:', error);
        }
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(contractUrl);
        alert('Contract link copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy link:', err);
        alert('Failed to share contract link.');
      }
    }
  };

  // Check if Web Share API is available (for conditional rendering)
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  // Download PDF handler
  const handleDownloadPDF = async () => {
    if (!contractContentRef.current) return;
    setPdfLoading(true);
    const clientName = (contract && contract.contact_name) ? contract.contact_name : (client?.name || 'Client');
    const filename = `contract-${clientName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${contract.id}.pdf`;
    
    try {
      // Clone and pre-process the element to convert all colors to RGB
      const elementToPrint = contractContentRef.current.cloneNode(true) as HTMLElement;
      elementToPrint.id = 'contract-print-area-pdf';
      
      // Add to DOM temporarily for processing
      elementToPrint.style.position = 'absolute';
      elementToPrint.style.left = '-9999px';
      elementToPrint.style.top = '0';
      elementToPrint.style.visibility = 'hidden';
      document.body.appendChild(elementToPrint);
      
      // Convert all computed styles to inline RGB styles
      const convertColorsToRGB = (el: HTMLElement) => {
        try {
          const computed = window.getComputedStyle(el);
          
          // Convert background colors
          const bgColor = computed.backgroundColor;
          if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
            el.style.setProperty('background-color', bgColor, 'important');
          }
          
          // Remove gradient backgrounds
          if (computed.backgroundImage && computed.backgroundImage !== 'none') {
            el.style.setProperty('background-image', 'none', 'important');
            if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
              el.style.setProperty('background-color', '#ffffff', 'important');
            }
          }
          
          // Convert text colors
          const textColor = computed.color;
          if (textColor) {
            el.style.setProperty('color', textColor, 'important');
          }
          
          // Process children
          Array.from(el.children).forEach(child => {
            convertColorsToRGB(child as HTMLElement);
          });
        } catch (e) {
          // Ignore errors for individual elements
        }
      };
      
      // Wait for clone to be in DOM, then process
      setTimeout(() => {
        convertColorsToRGB(elementToPrint);
        
        // Add CSS to override any remaining problematic styles
        const styleOverride = document.createElement('style');
        styleOverride.id = 'pdf-style-override';
        styleOverride.textContent = `
          #contract-print-area-pdf * {
            background-image: none !important;
          }
          #contract-print-area-pdf [class*="gradient"] {
            background: #ffffff !important;
            background-color: #ffffff !important;
            background-image: none !important;
          }
        `;
        document.head.appendChild(styleOverride);
        
        // Wait a bit more for styles to apply
        setTimeout(() => {
          html2pdf(elementToPrint, {
            margin: [10, 10, 10, 10],
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { 
              scale: 2, 
              useCORS: true, 
              logging: false
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
          }).then(() => {
            cleanup();
            setPdfLoading(false);
          }).catch((error: any) => {
            cleanup();
            throw error;
          });
        }, 200);
      }, 100);
      
      const cleanup = () => {
        if (elementToPrint.parentNode) {
          document.body.removeChild(elementToPrint);
        }
        const styleEl = document.getElementById('pdf-style-override');
        if (styleEl) {
          document.head.removeChild(styleEl);
        }
      };
      
    } catch (error: any) {
      console.error('Error generating PDF:', error);
      setPdfLoading(false);
      
      // Suggest using print instead
      if (confirm('PDF generation failed due to unsupported color formats. Would you like to use the Print dialog instead? (You can save as PDF from there)')) {
        handlePrint();
      } else {
        alert('Failed to generate PDF. Please try using the Print button and save as PDF from the print dialog.');
      }
    }
  };

  // Reuse the renderTiptapContent logic for client view
  // Helper function to render a single applicant field (used for both template and dynamic fields)
  const renderApplicantField = useCallback((id: string, index: number, total: number) => {
    return (
      <div key={id} className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-2 flex-1">
          <input
            type="text"
            className="input input-bordered input-lg flex-1 bg-white border-2 focus:border-blue-500 focus:shadow-lg"
            placeholder="Enter applicant name"
            value={clientFields[id] || ''}
            onChange={e => handleClientFieldChange(id, e.target.value)}
            disabled={contract?.status === 'signed'}
            data-field-id={id}
            data-is-applicant="true"
            style={{ minWidth: 200 }}
          />
        </span>
      </div>
    );
  }, [clientFields, contract?.status, activeApplicantFields, applicantFieldIds, dynamicApplicantFieldCounter]);

  // Helper function to get placeholder text based on field ID type
  const getTextFieldPlaceholder = (fieldId: string): string => {
    const idLower = fieldId.toLowerCase();
    
    // Check for specific field types
    if (idLower.includes('applicant') || idLower.startsWith('text:applicant')) {
      // This will be handled separately for applicant fields with index
      return 'Enter applicant name';
    } else if (idLower.includes('document') || idLower.startsWith('text:document')) {
      return 'Enter document name';
    } else if (idLower.includes('country') || idLower.startsWith('text:country')) {
      return 'Enter country';
    } else if (idLower.includes('address') || idLower.startsWith('text:address')) {
      return 'Enter address';
    } else if (idLower.includes('city') || idLower.startsWith('text:city')) {
      return 'Enter city';
    } else if (idLower.includes('postal') || idLower.startsWith('text:postal')) {
      return 'Enter postal code';
    } else if (idLower.includes('notes') || idLower.startsWith('text:notes')) {
      return 'Enter notes';
    } else if (idLower.includes('reference') || idLower.startsWith('text:reference')) {
      return 'Enter reference number';
    } else if (idLower.includes('other') || idLower.startsWith('text:other')) {
      return 'Enter text';
    }
    
    // Default placeholder for generic text fields
    return 'Enter text';
  };

  // Helper function to detect RTL text (Hebrew/Arabic)
  const isRTL = (text: string): boolean => {
    if (!text || typeof text !== 'string') return false;
    // Check for Hebrew (U+0590 to U+05FF) or Arabic (U+0600 to U+06FF) characters
    const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF]/;
    return rtlRegex.test(text);
  };

  // Helper function to extract text content from TipTap content
  const extractTextContent = (content: any): string => {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(extractTextContent).join(' ');
    }
    if (content.type === 'text' && content.text) {
      return content.text;
    }
    if (content.content) {
      return extractTextContent(content.content);
    }
    return '';
  };

  function renderTiptapContent(
    content: any,
    keyPrefix = '',
    signaturePads?: { [key: string]: any },
    applicantPriceIndex?: { current: number },
    paymentPlanIndex?: { current: number },
    placeholderIndex?: { text: number; signature: number; date: number }
  ): React.ReactNode {
    if (!content) return null;
    if (Array.isArray(content)) {
      if (!applicantPriceIndex) applicantPriceIndex = { current: 0 };
      if (!paymentPlanIndex) paymentPlanIndex = { current: 0 };
      if (!placeholderIndex) placeholderIndex = { text: 0, signature: 0, date: 0 };
      return content.map((n, i) => renderTiptapContent(n, keyPrefix + '-' + i, signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex));
    }
          if (content.type === 'text') {
        let text = content.text;
        text = fillAllPlaceholders(text, customPricing, client, contract);
        
        // Handle {{price_per_applicant}} placeholders FIRST, before splitting text into parts
        if (text && customPricing && customPricing.pricing_tiers && text.includes('{{price_per_applicant}}')) {
          const currency = customPricing.currency || 'USD';
          
          // Find each {{price_per_applicant}} placeholder and replace it based on context
          while (text.includes('{{price_per_applicant}}')) {
            const placeholderIndex = text.indexOf('{{price_per_applicant}}');
            
            // Get context before the placeholder - look at more text to catch tier labels
            const contextBefore = text.substring(Math.max(0, placeholderIndex - 200), placeholderIndex);
            
            let tierKey: string | null = null;
            
            // Check for tier patterns in order of specificity (most specific first)
            // 16+ patterns
            if (/16\s*\+\s*applicant|16\s+or\s+more\s+applicant|16\s+applicant.*or\s+more/i.test(contextBefore)) {
              tierKey = '16+';
            }
            // 10-15 patterns - match "10-15 applicants:" or "10-15 applicant:"
            else if (/10\s*[-–]\s*15\s+applicant/i.test(contextBefore)) {
              tierKey = '10-15';
            }
            // 8-9 patterns - match "8-9 applicants:" or "8-9 applicant:"
            else if (/8\s*[-–]\s*9\s+applicant/i.test(contextBefore)) {
              tierKey = '8-9';
            }
            // 4-7 patterns - match "4-7 applicants:" or "4-7 applicant:"
            else if (/4\s*[-–]\s*7\s+applicant/i.test(contextBefore)) {
              tierKey = '4-7';
            }
            // Single numbers - check for exact matches
            else {
              const recentContext = contextBefore.substring(Math.max(0, contextBefore.length - 80));
              if (/\b3\s+applicant/i.test(recentContext)) {
                tierKey = '3';
              } else if (/\b2\s+applicant/i.test(recentContext)) {
                tierKey = '2';
              } else if (/\b1\s+applicant|one\s+applicant|For\s+one\s+applicant/i.test(recentContext)) {
                tierKey = '1';
              }
            }
            
            if (tierKey && customPricing.pricing_tiers[tierKey] !== undefined) {
              const price = (customPricing.pricing_tiers[tierKey] || 0).toLocaleString();
              const replacement = `${currency} ${price}`;
              text = text.replace('{{price_per_applicant}}', replacement);
            } else {
              // If no tier matched, replace with 0
              text = text.replace('{{price_per_applicant}}', `${currency} 0`);
            }
          }
          
          // Also handle specific tier placeholders like {{price_1}}, {{price_2}}, etc.
          Object.keys(customPricing.pricing_tiers).forEach(tierKey => {
            const placeholder = `{{price_${tierKey}}}`;
            if (text.includes(placeholder)) {
              const price = (customPricing.pricing_tiers[tierKey] || 0).toLocaleString();
              text = text.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `${currency} ${price}`);
            }
          });
        }
        
        // Render {{text}}, {{date}}, and {{signature}} fields (before preprocessing) or {{text:ID}}, {{date:ID}}, and {{signature:ID}} fields (after preprocessing)
        if (text && /\{\{(text|date|signature)(:[^}]+)?\}\}/.test(text)) {
          // Ensure placeholderIndex is defined
          if (!placeholderIndex) placeholderIndex = { text: 0, signature: 0, date: 0 };
        const parts = [];
        let lastIndex = 0;
        // IMPORTANT: Match date fields FIRST, then signature, then text to prevent confusion
        const regex = /({{date(:[^}]+)?}}|{{signature(:[^}]+)?}}|{{text(:[^}]+)?}}|\n)/g;
        let match;
        // Counter for applicant field instances - ensures each gets a unique ID
        let applicantInstanceCounter = 0;
        
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const normalText = text.slice(lastIndex, match.index);
            parts.push(normalText);
          }
          const placeholder = match[1];
          
          // Use specific regex patterns to ensure correct matching
          const dateMatch = placeholder.match(/^{{date(:[^}]+)?}}$/);
          const sigMatch = placeholder.match(/^{{signature(:[^}]+)?}}$/);
          const textMatch = placeholder.match(/^{{text(:[^}]+)?}}$/);
          
          // Process date fields FIRST to prevent them from being treated as text fields
          if (dateMatch) {
            // Extract ID from the match - dateMatch[1] will be ":date-1" or similar, so substring(1) removes the colon
            // Use stable ID from placeholder or generate based on placeholderIndex
            const extractedId = dateMatch[1] ? dateMatch[1].substring(1) : null;
            const id = extractedId || `date-${placeholderIndex.date++}`;
            const dateValue = clientFields[id];
            // Date fields are NEVER applicant fields - explicitly exclude
            if (applicantFieldIds.includes(id)) {
              setApplicantFieldIds(prev => prev.filter(aid => aid !== id));
            }
            
            // Format date value for input (YYYY-MM-DD format required)
            let formattedDate = '';
            let displayDate = '';
            if (dateValue) {
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                formattedDate = dateValue;
                // Format for display (e.g., "January 15, 2024")
                try {
                  const date = new Date(dateValue + 'T00:00:00'); // Add time to avoid timezone issues
                  if (!isNaN(date.getTime())) {
                    displayDate = date.toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    });
                  }
                } catch (e) {
                  displayDate = dateValue;
                }
              } else {
                try {
                  const date = new Date(dateValue);
                  if (!isNaN(date.getTime())) {
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    formattedDate = `${year}-${month}-${day}`;
                    displayDate = date.toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    });
                  }
                } catch (e) {
                  // Invalid date, leave empty
                }
              }
            }
            
            // For signed contracts, show date as formatted text instead of input
            if (contract?.status === 'signed') {
              parts.push(
                <span
                  key={id}
                  className="filled-date"
                  style={{
                    display: 'inline-block',
                    verticalAlign: 'middle',
                    border: '2px solid #10b981',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    margin: '0 4px',
                    minWidth: '150px',
                    backgroundColor: '#f0fdf4',
                    color: '#065f46',
                    fontWeight: 'bold'
                  }}
                >
                  {displayDate || dateValue || '_____________'}
                </span>
              );
            } else {
              parts.push(
                <span 
                  key={id} 
                  className="inline-flex items-center gap-2 relative" 
                  style={{ verticalAlign: 'middle' }}
                  data-field-id={id}
                  data-field-type="date"
                >
                  <input
                    type="date"
                    className="input input-bordered input-lg mx-2 bg-white border-2 focus:border-blue-500 focus:shadow-lg"
                    value={formattedDate}
                    onChange={e => handleClientFieldChange(id, e.target.value)}
                    data-input-type="date"
                    style={{ 
                      minWidth: 180, 
                      display: 'inline-block', 
                      verticalAlign: 'middle',
                      color: '#111827',
                      cursor: 'text'
                    }}
                  />
                  {contract?.status !== 'signed' && (
                    <span className="badge badge-warning badge-sm text-xs whitespace-nowrap">
                      Fill before submitting
                    </span>
                  )}
                </span>
              );
            }
          } else if (textMatch) {
            // Extract the base ID from the placeholder
            const baseId = textMatch[1] ? textMatch[1].substring(1) : `text-${++placeholderIndex.text}`;
            
            // Check if this is an applicant field based on base ID (will need unique instance IDs)
            const baseIdLower = baseId.toLowerCase();
            const isApplicantFieldBase = baseIdLower.startsWith('text:applicant') || baseIdLower.startsWith('applicant') || applicantFieldIds.includes(baseId);
            
            // For applicant fields, create a unique ID for each instance to prevent state sharing
            // CRITICAL: Use a combination that ensures uniqueness and stability
            let id: string;
            if (isApplicantFieldBase) {
              // Use keyPrefix + match.index to create a truly unique, stable ID
              // keyPrefix provides context about position in content tree
              // match.index provides position in text
              // This combination ensures each field instance has its own state key
              const uniqueKey = `${keyPrefix}-${match.index}`.replace(/[^a-zA-Z0-9-]/g, '-');
              id = `${baseId}-${uniqueKey}`;
            } else {
              id = baseId;
            }
            
            // CRITICAL: Check if this text field is actually a date field based on context
            // Look for "Date:" label immediately before the placeholder in the text
            const textBeforePlaceholderForDate = text.slice(Math.max(0, match.index - 50), match.index);
            // Check if the text ends with "Date:" or "Date: " (case insensitive)
            const trimmedBefore = textBeforePlaceholderForDate.trim();
            const isActuallyDateField = /date\s*:\s*$/i.test(trimmedBefore) || 
                                       /^date\s*:/i.test(trimmedBefore) ||
                                       (trimmedBefore.toLowerCase().endsWith('date:') || trimmedBefore.toLowerCase().endsWith('date: '));
            // If this is actually a date field, render it as a date input instead
            if (isActuallyDateField) {
              // Remove from applicant fields if it's there (using base ID)
              if (applicantFieldIds.includes(baseId)) {
                setApplicantFieldIds(prev => prev.filter(aid => aid !== baseId));
              }
              if (activeApplicantFields.includes(baseId)) {
                setActiveApplicantFields(prev => prev.filter(aid => aid !== baseId));
              }
              
              // Format date value for input (YYYY-MM-DD format required)
              const dateValue = clientFields[id];
              let formattedDate = '';
              let displayDate = '';
              if (dateValue) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                  formattedDate = dateValue;
                  // Format for display (e.g., "January 15, 2024")
                  try {
                    const date = new Date(dateValue + 'T00:00:00'); // Add time to avoid timezone issues
                    if (!isNaN(date.getTime())) {
                      displayDate = date.toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      });
                    }
                  } catch (e) {
                    displayDate = dateValue;
                  }
                } else {
                  try {
                    const date = new Date(dateValue);
                    if (!isNaN(date.getTime())) {
                      const year = date.getFullYear();
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const day = String(date.getDate()).padStart(2, '0');
                      formattedDate = `${year}-${month}-${day}`;
                      displayDate = date.toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      });
                    }
                  } catch (e) {
                    // Invalid date, leave empty
                  }
                }
              }
              
              // For signed contracts, show date as formatted text instead of input
              if (contract?.status === 'signed') {
                parts.push(
                  <span
                    key={id}
                    className="filled-date"
                    style={{
                      display: 'inline-block',
                      verticalAlign: 'middle',
                      border: '2px solid #10b981',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      margin: '0 4px',
                      minWidth: '150px',
                      backgroundColor: '#f0fdf4',
                      color: '#065f46',
                      fontWeight: 'bold'
                    }}
                  >
                    {displayDate || dateValue || '_____________'}
                  </span>
                );
              } else {
                parts.push(
                  <span 
                    key={id} 
                    className="inline-flex items-center gap-2 relative" 
                    style={{ verticalAlign: 'middle' }}
                    data-field-id={id}
                    data-field-type="date"
                  >
                    <input
                      type="date"
                      className="input input-bordered input-lg mx-2 bg-white border-2 focus:border-blue-500 focus:shadow-lg"
                      value={formattedDate}
                      onChange={e => handleClientFieldChange(id, e.target.value)}
                      data-input-type="date"
                      style={{ 
                        minWidth: 180, 
                        display: 'inline-block', 
                        verticalAlign: 'middle',
                        color: '#111827',
                        cursor: 'text'
                      }}
                    />
                    {contract?.status !== 'signed' && (
                      <span className="badge badge-warning badge-sm text-xs whitespace-nowrap">
                        Fill before submitting
                      </span>
                    )}
                  </span>
                );
              }
              lastIndex = match.index + match[1].length;
              continue; // Skip the rest of the text field processing
            }
            
            // Determine if this is specifically an applicant field by checking the ID pattern
            // Use the base ID to check if it's an applicant field, but use unique instance ID for state
            const isApplicantField = isApplicantFieldBase;
            // For applicant fields with unique instance IDs, check using base ID for tracking
            // But use the unique instance ID for state management
            const isActiveApplicantField = isApplicantField && (activeApplicantFields.includes(id) || activeApplicantFields.includes(baseId));
            
            // Note: We don't add to activeApplicantFields during render to avoid infinite loops
            // The useEffect will handle initializing activeApplicantFields from applicantFieldIds
            // Unique instance IDs will be tracked through the rendering process
            
            // For applicant fields, calculate the correct index based on activeApplicantFields
            // Use unique instance IDs in activeApplicantFields, but fallback to base IDs if needed
            const currentActiveFields = activeApplicantFields.length > 0 ? activeApplicantFields : applicantFieldIds;
            // Try to find by instance ID first, then by base ID
            let applicantFieldIndex = -1;
            if (isApplicantField) {
              applicantFieldIndex = currentActiveFields.indexOf(id);
              if (applicantFieldIndex === -1 && isApplicantFieldBase) {
                // Fallback to base ID index
                applicantFieldIndex = currentActiveFields.indexOf(baseId);
              }
            }
            const isFirstApplicantField = applicantFieldIndex === 0;
            const totalFields = currentActiveFields.length;
            const isLastApplicantField = isApplicantField && applicantFieldIndex >= 0 && applicantFieldIndex === totalFields - 1;
            const canRemoveApplicantField = isApplicantField && totalFields > 1;
            
            // Skip rendering if this is an applicant field that's been explicitly removed
            // Only skip if activeApplicantFields has items AND this field is not in it
            // This allows fields to render on initial load even if activeApplicantFields is not yet populated
            // Check both unique instance ID and base ID
            const isFieldActive = activeApplicantFields.includes(id) || (isApplicantFieldBase && activeApplicantFields.includes(baseId));
            if (isApplicantField && activeApplicantFields.length > 0 && !isFieldActive) {
              // Just skip this placeholder - don't render anything
              lastIndex = match.index + match[1].length;
              continue;
            }
            
            
            // For applicant fields, render as block-level elements with buttons
            // Always render applicant fields with buttons, even if not yet in activeApplicantFields
            if (isApplicantField) {
              // Don't set state during render - let the useEffect handle initialization
              // For now, just render the field - the useEffect will properly initialize activeApplicantFields
              parts.push(
                <div 
                  key={id} 
                  className="flex items-center gap-2 mb-2 relative field-wrapper group w-full" 
                  data-field-id={id}
                  data-is-applicant="true"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}
                >
                  <input
                    type="text"
                    className="input input-bordered input-lg flex-1 bg-white border-2 focus:border-blue-500 focus:shadow-lg"
                    placeholder="Enter applicant name"
                    value={clientFields[id] || ''}
                    onChange={e => handleClientFieldChange(id, e.target.value)}
                    disabled={contract?.status === 'signed'}
                    style={{ minWidth: 200 }}
                  />
                </div>
              );
              
              // After rendering the last template applicant field, render any dynamic fields that come after it
              if (isLastApplicantField) {
                // Find dynamic fields that should be rendered after this one
                const currentIndexInActive = activeApplicantFields.indexOf(id);
                const dynamicFieldsAfter = activeApplicantFields.slice(currentIndexInActive + 1)
                  .filter(fieldId => fieldId.startsWith('applicant-dynamic-'));
                
                // Render dynamic fields inline right after this field
                dynamicFieldsAfter.forEach((dynamicFieldId) => {
                  const dynamicIndex = activeApplicantFields.indexOf(dynamicFieldId);
                  parts.push(
                    <div 
                      key={dynamicFieldId} 
                      className="flex items-center gap-2 mb-2 relative field-wrapper group w-full" 
                      data-field-id={dynamicFieldId}
                      data-is-applicant="true"
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}
                    >
                      <input
                        type="text"
                        className="input input-bordered input-lg flex-1 bg-white border-2 focus:border-blue-500 focus:shadow-lg"
                        placeholder="Enter applicant name"
                        value={clientFields[dynamicFieldId] || ''}
                        onChange={e => handleClientFieldChange(dynamicFieldId, e.target.value)}
                        disabled={contract?.status === 'signed'}
                        style={{ minWidth: 200 }}
                      />
                    </div>
                  );
                });
              }
              
              lastIndex = match.index + match[1].length;
              continue; // Skip the rest of the text field processing
            }
            
            // For non-applicant text fields, render inline as before
            parts.push(
              <span 
                key={id} 
                className="inline-block relative field-wrapper group" 
                style={{ verticalAlign: 'middle', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                data-field-id={id}
                data-is-applicant={isApplicantField ? 'true' : 'false'}
              >
                <input
                  className="input input-bordered input-lg mx-2 bg-white border-2 focus:border-blue-500 focus:shadow-lg"
                  placeholder={isApplicantField ? 'Enter applicant name' : getTextFieldPlaceholder(id)}
                  value={clientFields[id] || ''}
                  onChange={e => handleClientFieldChange(id, e.target.value)}
                  disabled={contract?.status === 'signed'}
                  style={{ minWidth: 150, display: 'inline-block', verticalAlign: 'middle' }}
                />
              </span>
            );
          } else if (sigMatch) {
            const id = sigMatch[1] ? sigMatch[1].substring(1) : `signature-${++placeholderIndex.signature}`;
            
            parts.push(
              <span 
                key={id} 
                className="inline-flex items-center gap-4 relative field-wrapper" 
                style={{ display: 'inline-flex', minWidth: 220, minHeight: 100, verticalAlign: 'middle' }}
                data-field-id={id}
              >
                <span 
                  className="border-2 rounded-lg bg-gray-50 p-3 border-gray-300" 
                  style={{ display: 'inline-block' }}
                >
                  {contract?.status === 'signed' && clientSignature ? (
                    <img src={clientSignature} alt="Signature" style={{ width: 200, height: 80, display: 'block', borderRadius: 8, background: 'transparent' }} />
                  ) : (
                    <SignaturePad
                      ref={(ref) => {
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
                          background: 'transparent'
                        } 
                      }}
                      onEnd={() => {
                        if (signaturePads && signaturePads[id]) {
                          const dataUrl = signaturePads[id].toDataURL();
                          setClientSignature(dataUrl);
                          // Save to clientFields with the correct ID
                          setClientFields(prev => ({ ...prev, [id]: dataUrl }));
                        }
                      }}
                    />
                  )}
                  <div className="text-xs text-gray-500 text-center mt-2 font-medium">
                    Sign here
                  </div>
                </span>
                {/* Stamp image */}
                <div className="flex-shrink-0">
                  <img 
                    src="/חתימה מסמכים (5).png" 
                    alt="Stamp" 
                    style={{ 
                      width: 'auto', 
                      height: 150, 
                      maxWidth: 250,
                      display: 'block',
                      objectFit: 'contain'
                    }} 
                  />
                </div>
                {contract?.status !== 'signed' && (
                  <span className="badge badge-warning badge-sm text-xs whitespace-nowrap">
                    Fill before submitting
                  </span>
                )}
              </span>
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


      // Render payment plan row as text for every {{payment_plan_row}} occurrence
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
            // Use row.value if defined, otherwise fallback to row.amount
            const amount = typeof row.value !== 'undefined' ? row.value : row.amount;
            result.push(
              <span className="inline-block px-3 py-1 mx-1 text-sm font-medium" key={keyPrefix + '-pprow-' + rowIndex}>
                {row.percent}% {rowIndex === 0 && row.due_date ? `(${row.due_date}) ` : ''}= {customPricing.currency} {amount?.toLocaleString()}
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
      
      // Apply text formatting (bold, italic, etc.)
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
      
      // Default: just return the text
      return text;
    }
    switch (content.type) {
      case 'paragraph':
        const paragraphContent = renderTiptapContent(content.content, keyPrefix + '-p', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex);
        // Only render paragraph if it has content
        if (paragraphContent && (typeof paragraphContent === 'string' ? paragraphContent.trim() : true)) {
          // Check if paragraph contains input fields (React elements)
          const hasInputFields = React.isValidElement(paragraphContent) || 
            (Array.isArray(paragraphContent) && paragraphContent.some(item => React.isValidElement(item)));
          
          // Extract text to determine direction
          const textContent = extractTextContent(content.content);
          const direction = isRTL(textContent) ? 'rtl' : 'ltr';
          const textAlign = isRTL(textContent) ? 'right' : 'left';
          
          if (hasInputFields) {
            // Use div instead of p to avoid DOM nesting issues with input fields
            return (
              <div 
                key={keyPrefix} 
                className="mb-2 md:mb-3 text-sm md:text-base" 
                dir={direction}
                style={{ textAlign }}
              >
                {paragraphContent}
              </div>
            );
          } else {
            return (
              <p 
                key={keyPrefix} 
                className="mb-2 md:mb-3 text-sm md:text-base" 
                dir={direction}
                style={{ textAlign }}
              >
                {paragraphContent}
              </p>
            );
          }
        }
        return null;
      case 'heading': {
        const level = content.attrs?.level || 1;
        const headingTags = ['h1','h2','h3','h4','h5','h6'];
        const HeadingTag = headingTags[Math.max(0, Math.min(5, level-1))] || 'h1';
        const headingSizes = {
          h1: 'text-lg md:text-2xl',
          h2: 'text-base md:text-xl',
          h3: 'text-sm md:text-lg',
          h4: 'text-sm md:text-base',
          h5: 'text-xs md:text-sm',
          h6: 'text-xs md:text-sm'
        };
        const sizeClass = headingSizes[HeadingTag as keyof typeof headingSizes] || 'text-base md:text-lg';
        
        // Extract text to determine direction
        const textContent = extractTextContent(content.content);
        const direction = isRTL(textContent) ? 'rtl' : 'ltr';
        const textAlign = isRTL(textContent) ? 'right' : 'left';
        
        return React.createElement(
          HeadingTag,
          { 
            key: keyPrefix, 
            className: `${sizeClass} font-semibold mb-2 md:mb-3`,
            dir: direction,
            style: { textAlign }
          },
          renderTiptapContent(content.content, keyPrefix + '-h', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)
        );
      }
      case 'bulletList': {
        // Remove bullet points - render as plain div without list styling
        const bulletTextContent = extractTextContent(content.content);
        const bulletDirection = isRTL(bulletTextContent) ? 'rtl' : 'ltr';
        const bulletAlign = isRTL(bulletTextContent) ? 'right' : 'left';
        return (
          <div 
            key={keyPrefix} 
            className="text-sm md:text-base mb-2 md:mb-3" 
            dir={bulletDirection}
            style={{ textAlign: bulletAlign }}
          >
            {renderTiptapContent(content.content, keyPrefix + '-ul', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}
          </div>
        );
      }
      case 'orderedList': {
        // Remove numbering - render as plain div without list styling
        const orderedTextContent = extractTextContent(content.content);
        const orderedDirection = isRTL(orderedTextContent) ? 'rtl' : 'ltr';
        const orderedAlign = isRTL(orderedTextContent) ? 'right' : 'left';
        return (
          <div 
            key={keyPrefix} 
            className="text-sm md:text-base mb-2 md:mb-3" 
            dir={orderedDirection}
            style={{ textAlign: orderedAlign }}
          >
            {renderTiptapContent(content.content, keyPrefix + '-ol', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}
          </div>
        );
      }
      case 'listItem': {
        // Remove list item styling - render as plain div
        const listItemTextContent = extractTextContent(content.content);
        const listItemDirection = isRTL(listItemTextContent) ? 'rtl' : 'ltr';
        const listItemAlign = isRTL(listItemTextContent) ? 'right' : 'left';
        return (
          <div 
            key={keyPrefix} 
            className="text-sm md:text-base" 
            dir={listItemDirection}
            style={{ textAlign: listItemAlign }}
          >
            {renderTiptapContent(content.content, keyPrefix + '-li', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}
          </div>
        );
      }
      case 'blockquote': {
        const blockquoteTextContent = extractTextContent(content.content);
        const blockquoteDirection = isRTL(blockquoteTextContent) ? 'rtl' : 'ltr';
        const blockquoteAlign = isRTL(blockquoteTextContent) ? 'right' : 'left';
        return (
          <blockquote 
            key={keyPrefix} 
            dir={blockquoteDirection}
            style={{ textAlign: blockquoteAlign }}
          >
            {renderTiptapContent(content.content, keyPrefix + '-bq', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}
          </blockquote>
        );
      }
      case 'horizontalRule':
        return <hr key={keyPrefix} />;
      case 'hardBreak':
        return <br key={keyPrefix} />;
      default:
        return renderTiptapContent(content.content, keyPrefix + '-d', signaturePads, applicantPriceIndex, paymentPlanIndex);
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="loading loading-spinner loading-lg text-primary"></div>
        <p className="mt-4 text-gray-600 text-sm md:text-base">Loading contract...</p>
      </div>
    </div>
  );
  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <p className="text-red-500 text-sm md:text-lg">{error}</p>
      </div>
    </div>
  );
  if (!contract || !template) return null;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-2 py-8">
      <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg border border-gray-200 p-4 md:p-8">
        {/* Show signed message at the top if contract is signed */}
        {contract.status === 'signed' && !thankYou && (
          <div className="alert alert-success mb-4 md:mb-6 text-sm md:text-base">
            This contract has been signed and is now read-only.
          </div>
        )}
        
        {/* Print and Share buttons for signed contracts */}
        {contract.status === 'signed' && (
          <div className="flex justify-center gap-2 mb-4 print-hide">
            <button
              className="btn btn-outline btn-xs sm:btn-sm gap-1 sm:gap-2"
              onClick={handlePrint}
              title="Print contract"
            >
              <PrinterIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Print</span>
            </button>
            {/* PDF button commented out */}
            {/* <button
              className="btn btn-outline btn-sm gap-2"
              onClick={handleDownloadPDF}
              disabled={pdfLoading}
              title="Download as PDF"
            >
              <ArrowDownTrayIcon className="w-5 h-5" />
              {pdfLoading ? 'Generating...' : 'Download PDF'}
            </button> */}
            {/* Share button - mobile only */}
            {canShare && (
              <button
                className="btn btn-outline btn-sm gap-2 md:hidden"
                onClick={handleShareContract}
                title="Share contract"
              >
                <ShareIcon className="w-5 h-5" />
                Share
              </button>
            )}
          </div>
        )}
        
        <div className="mb-4 md:mb-6 text-center">
          <h1 className="text-xl md:text-2xl font-bold">
            Contract for {contract?.contact_name || client?.name || 'Client'}
          </h1>
          {leadNumber && (
            <p className="text-sm md:text-base text-gray-600 mt-2">
              Lead Number: <span className="font-mono font-semibold text-blue-600">#{leadNumber}</span>
            </p>
          )}
        </div>
        
        <div ref={contractContentRef} id="contract-print-area" className="prose prose-sm md:prose-base max-w-none">
                  {thankYou ? (
          <>
            <div className="alert alert-success text-sm md:text-lg font-semibold mb-4 md:mb-6">Thank you! Your contract was signed and submitted. You will be notified soon.</div>
            {(() => {
              return renderTiptapContent(contract.custom_content || template.content, '', signaturePads, undefined, undefined, { text: 0, signature: 0, date: 0 });
            })()}
          </>
        ) : (
          (() => {
            return renderTiptapContent(contract.custom_content || template.content, '', signaturePads, undefined, undefined, { text: 0, signature: 0, date: 0 });
          })()
        )}
        </div>
        
        {/* Submit Contract Button (only if not signed) */}
        {contract.status !== 'signed' && !thankYou && (
          <div className="mt-8">
            <button
              className="btn btn-success btn-lg w-full print-hide"
              onClick={handleSubmitContract}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Contract'}
            </button>
          </div>
        )}
      </div>
      
      {/* Print-specific CSS */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 2cm;
          }
          
          /* Reset body styles */
          body,
          html {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: auto !important;
          }
          
          /* Hide non-content elements */
          .print-hide,
          button,
          .alert,
          nav,
          header {
            display: none !important;
            visibility: hidden !important;
          }
          
          /* Hide everything except the contract print area */
          body > * {
            visibility: hidden !important;
          }
          
          /* Show only the contract content wrapper and its contents */
          body > div,
          body > div > div,
          #contract-print-area,
          #contract-print-area * {
            visibility: visible !important;
          }
          
          /* Reset wrapper positioning for natural flow */
          body > div {
            position: static !important;
            display: block !important;
            min-height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            flex: none !important;
            align-items: normal !important;
            justify-content: normal !important;
          }
          
          body > div > div {
            position: static !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
          }
          
          /* Format contract content for multi-page printing */
          #contract-print-area {
            position: relative !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            page-break-inside: auto !important;
            overflow: visible !important;
            height: auto !important;
          }
          
          #contract-print-area * {
            background-image: none !important;
          }
          
          #contract-print-area [class*="gradient"] {
            background: #ffffff !important;
            background-color: #ffffff !important;
            background-image: none !important;
          }
          
          /* Page break handling for better multi-page layout */
          #contract-print-area p {
            orphans: 3;
            widows: 3;
            page-break-inside: avoid;
          }
          
          #contract-print-area h1,
          #contract-print-area h2,
          #contract-print-area h3,
          #contract-print-area h4,
          #contract-print-area h5,
          #contract-print-area h6 {
            page-break-after: avoid;
            page-break-inside: avoid;
          }
          
          #contract-print-area img {
            page-break-inside: avoid;
            max-width: 100% !important;
          }
        }
      `}</style>
      
      {/* CSS for animations and RTL support */}
      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes field-highlight-pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
          }
        }
        
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
        
        .field-highlight-pulse {
          animation: field-highlight-pulse 2s ease-out;
        }
        
        .field-wrapper {
          transition: all 0.3s ease;
        }
        
        .field-wrapper:hover {
          transform: scale(1.02);
        }
        
        /* Ensure date inputs are fully clickable and functional */
        input[type="date"] {
          position: relative;
          z-index: 10;
        }
        
        input[type="date"]:not(:disabled) {
          cursor: text;
        }
        
        input[type="date"]::-webkit-calendar-picker-indicator {
          cursor: pointer;
          opacity: 1;
        }
        
        /* RTL support for Hebrew/Arabic text in contract content */
        #contract-print-area p[dir="rtl"],
        #contract-print-area h1[dir="rtl"],
        #contract-print-area h2[dir="rtl"],
        #contract-print-area h3[dir="rtl"],
        #contract-print-area h4[dir="rtl"],
        #contract-print-area h5[dir="rtl"],
        #contract-print-area h6[dir="rtl"],
        #contract-print-area li[dir="rtl"],
        #contract-print-area blockquote[dir="rtl"],
        #contract-print-area div[dir="rtl"] {
          text-align: right !important;
          direction: rtl !important;
        }
        
        #contract-print-area p[dir="ltr"],
        #contract-print-area h1[dir="ltr"],
        #contract-print-area h2[dir="ltr"],
        #contract-print-area h3[dir="ltr"],
        #contract-print-area h4[dir="ltr"],
        #contract-print-area h5[dir="ltr"],
        #contract-print-area h6[dir="ltr"],
        #contract-print-area li[dir="ltr"],
        #contract-print-area blockquote[dir="ltr"],
        #contract-print-area div[dir="ltr"] {
          text-align: left !important;
          direction: ltr !important;
        }
        
        #contract-print-area ul[dir="rtl"],
        #contract-print-area ol[dir="rtl"] {
          padding-right: 2rem;
          padding-left: 0;
          text-align: right;
          direction: rtl;
        }
        
        #contract-print-area ul[dir="ltr"],
        #contract-print-area ol[dir="ltr"] {
          padding-left: 2rem;
          padding-right: 0;
          text-align: left;
          direction: ltr;
        }
        
        /* Auto-detect direction for Hebrew/Arabic - key for line breaks and text flow */
        #contract-print-area p,
        #contract-print-area h1,
        #contract-print-area h2,
        #contract-print-area h3,
        #contract-print-area h4,
        #contract-print-area h5,
        #contract-print-area h6,
        #contract-print-area div {
          unicode-bidi: plaintext;
        }
        
        /* Preserve original font weights - don't force bold */
        #contract-print-area p {
          font-weight: normal;
        }
        
        #contract-print-area div:not(.prose h1):not(.prose h2):not(.prose h3):not(.prose h4):not(.prose h5):not(.prose h6) {
          font-weight: normal;
        }
        
        /* Only bold text that has explicit bold marks */
        #contract-print-area b,
        #contract-print-area strong {
          font-weight: bold;
        }
        
        /* Headings should be bold by default */
        #contract-print-area h1,
        #contract-print-area h2,
        #contract-print-area h3,
        #contract-print-area h4,
        #contract-print-area h5,
        #contract-print-area h6 {
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};

export default PublicContractView; 