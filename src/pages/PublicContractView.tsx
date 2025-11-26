import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SignaturePad from 'react-signature-canvas';
import { handleContractSigned } from '../lib/contractAutomation';

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
  const [incompleteFields, setIncompleteFields] = useState<Set<string>>(new Set());
  const [highlightedFieldId, setHighlightedFieldId] = useState<string | null>(null);
  const [showScrollGuide, setShowScrollGuide] = useState(true);
  const [applicantFieldIds, setApplicantFieldIds] = useState<string[]>([]);
  const [activeApplicantFields, setActiveApplicantFields] = useState<string[]>([]); // Fields that are currently visible (can be added/removed)
  const [dynamicApplicantFieldCounter, setDynamicApplicantFieldCounter] = useState(0); // Counter for generating new field IDs

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
        // Replace {{date:ID}} fields with actual date values
        text = text.replace(/\{\{date:([^}]+)\}\}/g, (match: string, id: string) => {
          const dateValue = clientFields[id];
          if (dateValue) {
            try {
              // Date values are stored in YYYY-MM-DD format from the date input
              // Parse and format for display
              let date: Date;
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                // Already in YYYY-MM-DD format - add time to avoid timezone issues
                date = new Date(dateValue + 'T00:00:00');
              } else {
                // Try to parse other formats
                date = new Date(dateValue);
              }
              
              if (!isNaN(date.getTime())) {
                // Format date for display (e.g., "January 15, 2025")
                return date.toLocaleDateString('en-US', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                });
              }
            } catch (e) {
            }
          }
          return '[Date]';
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
    setClientFields(prev => {
      const newFields = { ...prev, [key]: value };
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
      // Process template to add text and signature placeholders
      const processedTemplate = {
        ...contractData.contract_templates,
        content: contractData.contract_templates.content ? 
          preprocessTemplatePlaceholders(contractData.contract_templates.content) : 
          contractData.contract_templates.content
      };
      setTemplate(processedTemplate);
      // Fetch client info
      const { data: leadData } = await supabase
        .from('leads')
        .select('id, name, email, phone, mobile')
        .eq('id', contractData.client_id)
        .single();
      setClient(leadData);
      setCustomPricing(contractData.custom_pricing);
      
      // Load saved client inputs if contract was previously started
      if (contractData.client_inputs) {
        setClientFields(contractData.client_inputs);
      }
      
      setLoading(false);
    })();
  }, [contractId, token]);

  // Track incomplete fields
  useEffect(() => {
    if (!template?.content || contract?.status === 'signed') return;
    
    const incomplete = new Set<string>();
    const contentStr = JSON.stringify(template.content);
    
    // Find all field IDs
    const textMatches = contentStr.match(/\{\{text:([^}]+)\}\}/g) || [];
    const dateMatches = contentStr.match(/\{\{date:([^}]+)\}\}/g) || [];
    const signatureMatches = contentStr.match(/\{\{signature:([^}]+)\}\}/g) || [];
    
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
    
    // First, get all date field IDs to exclude them from applicant field detection
    const dateFieldIds = new Set<string>();
    dateMatches.forEach(match => {
      const id = match.match(/\{\{date:([^}]+)\}\}/)?.[1];
      if (id) {
        dateFieldIds.add(id);
      }
    });
    
    // First, identify all applicant fields and their order using multiple methods
    const applicantFields: Array<{ id: string; position: number; context: string }> = [];
    const fieldContexts = findTextFieldsWithContext(template?.content || {});
    
    textMatches.forEach(match => {
      const id = match.match(/\{\{text:([^}]+)\}\}/)?.[1];
      if (!id) return;
      
      // Skip if this is a date field (shouldn't happen, but safety check)
      if (dateFieldIds.has(id)) {
        return;
      }
      
      // Check if this field is an applicant name field by ID
      const idLower = id.toLowerCase();
      let isApplicantField = 
        idLower.includes('applicant') || 
        idLower.includes('applicant-') ||
        idLower.includes('applicant_') ||
        idLower.includes('applicantname') ||
        idLower.includes('applicant_name');
      
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
      
      // Check if context mentions "applicant" in various forms
      if (!isApplicantField && context) {
        const applicantPatterns = [
          /applicant/i,
          /applicants/i,
          /name.*applicant/i,
          /applicant.*name/i,
          /applicant\s*\d+/i,
          /first.*applicant/i,
          /second.*applicant/i,
          /third.*applicant/i,
          /additional.*applicant/i,
        ];
        
        const hasApplicantContext = applicantPatterns.some(pattern => pattern.test(context));
        const hasNameContext = /name/i.test(context);
        
        // If context mentions "applicant" and likely refers to names
        if (hasApplicantContext && (hasNameContext || /applicant\s*\d+/.test(context) || /applicant\s*[123]/.test(context) || /applicants?/i.test(context))) {
          isApplicantField = true;
        }
      }
      
      if (isApplicantField) {
        applicantFields.push({ id, position: placeholderIndex !== -1 ? placeholderIndex : 999999, context });
      }
    });
    
    // Sort applicant fields by position in the content (to find the first one)
    applicantFields.sort((a, b) => a.position - b.position);
    const sortedApplicantIds = applicantFields.map(f => f.id);
    setApplicantFieldIds(sortedApplicantIds);
    
    // Initialize activeApplicantFields with detected fields if not already set
    setActiveApplicantFields(prev => {
      if (prev.length === 0 && sortedApplicantIds.length > 0) {
        return [...sortedApplicantIds];
      }
      // Merge new fields that aren't in active list yet (keep existing active fields)
      const merged = [...prev];
      sortedApplicantIds.forEach(id => {
        if (!merged.includes(id)) {
          merged.push(id);
        }
      });
      return merged;
    });
    
    // Now check which fields are incomplete - ONLY after we've identified applicant fields
    // IMPORTANT: Only count fields that are actually in activeApplicantFields (for applicant fields)
    textMatches.forEach(match => {
      const id = match.match(/\{\{text:([^}]+)\}\}/)?.[1];
      if (!id) return;
      
      // Skip if field is already filled
      if (clientFields[id]?.trim()) {
        return;
      }
      
      // Check if this is an applicant field
      const isApplicantField = sortedApplicantIds.includes(id);
      
      // For applicant fields, only count them if they're in activeApplicantFields
      // This ensures deleted fields are not counted
      if (isApplicantField) {
        // Check if this field is actually active (exists in activeApplicantFields)
        // We'll check this after activeApplicantFields is updated, but for now use the sortedApplicantIds
        // Since we're initializing activeApplicantFields from sortedApplicantIds, they should match
        // But we need to ensure we're only counting fields that will actually be rendered
        const isActiveField = activeApplicantFields.length === 0 || activeApplicantFields.includes(id);
        if (isActiveField) {
          incomplete.add(id);
        } else {
        }
      } else {
        // Non-applicant fields are required
        incomplete.add(id);
      }
    });
    // Date fields are ALWAYS required (never optional)
    // Also ensure date fields are NOT in applicantFieldIds
    dateMatches.forEach(match => {
      const id = match.match(/\{\{date:([^}]+)\}\}/)?.[1];
      if (id) {
        // Remove from applicantFieldIds if somehow added there
        if (sortedApplicantIds.includes(id)) {
          const updatedApplicantIds = sortedApplicantIds.filter(aid => aid !== id);
          setApplicantFieldIds(updatedApplicantIds);
        }
        
        // Date fields are always required
        if (!clientFields[id]) {
          incomplete.add(id);
        }
      }
    });
    
    signatureMatches.forEach(match => {
      const id = match.match(/\{\{signature:([^}]+)\}\}/)?.[1];
      if (id && !clientSignature && !clientFields[id]) {
        incomplete.add(id);
      }
    });
    
    // IMPORTANT: Filter out any fields from incompleteFields that don't exist anymore
    // This ensures deleted fields are removed from the count
    const filteredIncomplete = new Set<string>();
    incomplete.forEach(fieldId => {
      // Check if this is an applicant field
      const isApplicantField = sortedApplicantIds.includes(fieldId);
      if (isApplicantField) {
        // For applicant fields, only include if they're in activeApplicantFields
        // If activeApplicantFields is empty, use sortedApplicantIds (initial state)
        const activeFields = activeApplicantFields.length > 0 ? activeApplicantFields : sortedApplicantIds;
        if (activeFields.includes(fieldId)) {
          filteredIncomplete.add(fieldId);
        } else {
        }
      } else {
        // For non-applicant fields, include them (they always exist in template)
        filteredIncomplete.add(fieldId);
      }
    });
    
    const previousIncompleteCount = incompleteFields.size;
    setIncompleteFields(filteredIncomplete);
    
    // If a field was just completed and we had a highlighted field, move to next
    if (previousIncompleteCount > filteredIncomplete.size && highlightedFieldId && !filteredIncomplete.has(highlightedFieldId)) {
      // Current field was completed, move to next
      if (filteredIncomplete.size > 0) {
        const nextIncomplete = Array.from(filteredIncomplete)[0];
        setTimeout(() => {
          setHighlightedFieldId(nextIncomplete);
          scrollToField(nextIncomplete);
        }, 300);
      } else {
        setHighlightedFieldId(null);
      }
    } else if (filteredIncomplete.size > 0 && !highlightedFieldId) {
      // Auto-highlight first incomplete field on initial load
      const firstIncomplete = Array.from(filteredIncomplete)[0];
      setHighlightedFieldId(firstIncomplete);
      setTimeout(() => {
        scrollToField(firstIncomplete);
      }, 500);
    }
  }, [template, clientFields, clientSignature, contract?.status, activeApplicantFields, incompleteFields.size, highlightedFieldId]);

  // Scroll to a specific field smoothly
  const scrollToField = (fieldId: string) => {
    const fieldElement = document.querySelector(`[data-field-id="${fieldId}"]`);
    if (fieldElement) {
      fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add a temporary highlight pulse
      fieldElement.classList.add('field-highlight-pulse');
      setTimeout(() => {
        fieldElement.classList.remove('field-highlight-pulse');
      }, 2000);
    }
  };

  // Handle scroll to highlight field in viewport
  useEffect(() => {
    if (contract?.status === 'signed') return;
    
    const handleScroll = () => {
      const incompleteArray = Array.from(incompleteFields);
      if (incompleteArray.length === 0) return;
      
      // Find which incomplete field is most visible in viewport
      let mostVisibleField: string | null = null;
      let maxVisibility = 0;
      
      incompleteArray.forEach(fieldId => {
        const fieldElement = document.querySelector(`[data-field-id="${fieldId}"]`);
        if (fieldElement) {
          const rect = fieldElement.getBoundingClientRect();
          const windowHeight = window.innerHeight;
          
          // Calculate visibility (how much of the field is visible)
          const visibleTop = Math.max(0, rect.top);
          const visibleBottom = Math.min(windowHeight, rect.bottom);
          const visibleHeight = Math.max(0, visibleBottom - visibleTop);
          const visibility = visibleHeight / rect.height;
          
          // Prefer fields that are partially visible in the upper portion of viewport
          if (visibility > 0.3 && rect.top < windowHeight * 0.7) {
            if (visibility > maxVisibility) {
              maxVisibility = visibility;
              mostVisibleField = fieldId;
            }
          }
        }
      });
      
      if (mostVisibleField && mostVisibleField !== highlightedFieldId) {
        setHighlightedFieldId(mostVisibleField);
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check
    
    return () => window.removeEventListener('scroll', handleScroll);
  }, [incompleteFields, highlightedFieldId, contract?.status]);

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
      // Trigger backend logic (e.g., payment plan, lead balance)
      if (updatedContract) {
        await handleContractSigned(updatedContract);
      }
      setThankYou(true);
      setContract(updatedContract);
    } catch (err) {
      alert('Failed to submit contract. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reuse the renderTiptapContent logic for client view
  // Helper function to render a single applicant field (used for both template and dynamic fields)
  const renderApplicantField = useCallback((id: string, index: number, total: number) => {
    const isEmpty = !clientFields[id]?.trim();
    const isHighlighted = highlightedFieldId === id;
    const needsAttention = incompleteFields.has(id);
    const isLastApplicantField = index === total - 1;
    const canRemoveApplicantField = total > 1;
    
    return (
      <div key={id} className="mb-3 flex items-center gap-2">
        <span className="text-xs md:text-sm font-medium text-gray-700 min-w-[100px] md:min-w-[120px]">
          Applicant {index + 1}:
        </span>
        <span className="inline-flex items-center gap-2 flex-1">
          <input
            type="text"
            className={`input input-bordered input-lg flex-1 bg-white border-2 transition-all duration-300 ${
              isEmpty 
                ? needsAttention
                  ? isHighlighted 
                    ? 'border-blue-500 shadow-lg shadow-blue-500/50 ring-2 ring-blue-500 ring-opacity-50' 
                    : 'border-orange-400 shadow-md'
                  : 'border-orange-400 shadow-md'
                : 'border-green-400 focus:border-blue-500'
            } focus:border-blue-500 focus:shadow-lg`}
            placeholder={`Enter applicant ${index + 1} name`}
            value={clientFields[id] || ''}
            onChange={e => {
              handleClientFieldChange(id, e.target.value);
              if (e.target.value.trim()) {
                setIncompleteFields(prev => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                });
              }
            }}
            onFocus={() => setHighlightedFieldId(id)}
            disabled={contract?.status === 'signed'}
            data-field-id={id}
            data-is-applicant="true"
            style={{ minWidth: 200 }}
          />
          {/* Required badge */}
          {needsAttention && !contract?.status && (
            <div className={`flex items-center gap-1 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded-full shadow-lg transition-all duration-300 ${
              isHighlighted ? 'scale-110 animate-pulse' : 'scale-100'
            }`}>
              <span className="w-2 h-2 bg-white rounded-full animate-ping absolute"></span>
              <span className="relative">Required</span>
            </div>
          )}
        </span>
      </div>
    );
  }, [clientFields, highlightedFieldId, incompleteFields, contract?.status, activeApplicantFields, applicantFieldIds, dynamicApplicantFieldCounter]);

  function renderTiptapContent(
    content: any,
    keyPrefix = '',
    signaturePads?: { [key: string]: any },
    applicantPriceIndex?: { current: number },
    paymentPlanIndex?: { current: number },
    placeholderIndex?: { text: number; signature: number }
  ): React.ReactNode {
    if (!content) return null;
    if (Array.isArray(content)) {
      if (!applicantPriceIndex) applicantPriceIndex = { current: 0 };
      if (!paymentPlanIndex) paymentPlanIndex = { current: 0 };
      if (!placeholderIndex) placeholderIndex = { text: 0, signature: 0 };
      return content.map((n, i) => renderTiptapContent(n, keyPrefix + '-' + i, signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex));
    }
          if (content.type === 'text') {
        let text = content.text;
        text = fillAllPlaceholders(text, customPricing, client, contract);
        // Render {{text}}, {{date}}, and {{signature}} fields (before preprocessing) or {{text:ID}}, {{date:ID}}, and {{signature:ID}} fields (after preprocessing)
        if (text && /\{\{(text|date|signature)(:[^}]+)?\}\}/.test(text)) {
          // Ensure placeholderIndex is defined
          if (!placeholderIndex) placeholderIndex = { text: 0, signature: 0 };
        const parts = [];
        let lastIndex = 0;
        // IMPORTANT: Match date fields FIRST, then signature, then text to prevent confusion
        // The order in the regex matters - we want date to be matched before text
        const regex = /({{date(:[^}]+)?}}|{{signature(:[^}]+)?}}|{{text(:[^}]+)?}}|\n)/g;
        let match;
        
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            const normalText = text.slice(lastIndex, match.index);
            parts.push(normalText);
          }
          const placeholder = match[1];
          
          // Check the text before this placeholder to see if it ends with "Date:"
          const textBeforePlaceholder = text.slice(Math.max(0, match.index - 30), match.index);
          // Check date FIRST before text to ensure date fields are never confused with text fields
          // Use more specific regex patterns to ensure correct matching
          const dateMatch = placeholder.match(/^{{date(:[^}]+)?}}$/);
          const sigMatch = placeholder.match(/^{{signature(:[^}]+)?}}$/);
          const textMatch = placeholder.match(/^{{text(:[^}]+)?}}$/);
          
          // Debug logging
          if (placeholder.includes('date')) {
          }
          
          // Process date fields FIRST to prevent them from being treated as text fields
          if (dateMatch) {
            const id = dateMatch[1] ? dateMatch[1].substring(1) : `date-${Date.now()}`;
            const isEmpty = !clientFields[id];
            const isHighlighted = highlightedFieldId === id;
            const needsAttention = incompleteFields.has(id);
            
            // Date fields are NEVER applicant fields - explicitly exclude
            if (applicantFieldIds.includes(id)) {
              setApplicantFieldIds(prev => prev.filter(aid => aid !== id));
            }
            parts.push(
              <span 
                key={id} 
                className="inline-block relative field-wrapper" 
                style={{ verticalAlign: 'middle' }}
                data-field-id={id}
                data-field-type="date"
              >
                <input
                  type="date"
                  className={`input input-bordered input-lg mx-2 bg-white border-2 transition-all duration-300 ${
                    isEmpty 
                      ? isHighlighted 
                        ? 'border-blue-500 shadow-lg shadow-blue-500/50 ring-2 ring-blue-500 ring-opacity-50' 
                        : 'border-orange-400 shadow-md'
                      : 'border-green-400 focus:border-blue-500'
                  } focus:border-blue-500 focus:shadow-lg`}
                  value={clientFields[id] ? (() => {
                    // Ensure the value is in YYYY-MM-DD format for date inputs
                    const dateValue = clientFields[id];
                    if (dateValue) {
                      // If it's already in YYYY-MM-DD format, use it directly
                      if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                        return dateValue;
                      }
                      // Otherwise, try to parse it and convert to YYYY-MM-DD
                      try {
                        const date = new Date(dateValue);
                        if (!isNaN(date.getTime())) {
                          const year = date.getFullYear();
                          const month = String(date.getMonth() + 1).padStart(2, '0');
                          const day = String(date.getDate()).padStart(2, '0');
                          return `${year}-${month}-${day}`;
                        }
                      } catch (e) {
                      }
                    }
                    return '';
                  })() : ''}
                  onChange={e => {
                    const selectedDate = e.target.value;
                    // Date inputs return values in YYYY-MM-DD format, save it directly
                    handleClientFieldChange(id, selectedDate);
                    if (selectedDate) {
                      setIncompleteFields(prev => {
                        const next = new Set(prev);
                        next.delete(id);
                        return next;
                      });
                    }
                  }}
                  onFocus={() => setHighlightedFieldId(id)}
                  onBlur={() => {
                    // Validate date format on blur
                    const dateValue = clientFields[id];
                    if (dateValue && !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                    }
                  }}
                  disabled={contract?.status === 'signed'}
                  required
                  aria-label="Select date (required)"
                  // CRITICAL: Ensure NO placeholder - date inputs don't use placeholders
                  placeholder=""
                  readOnly={false}
                  autoComplete="off"
                  data-input-type="date"
                  style={{ 
                    minWidth: 180, 
                    display: 'inline-block', 
                    verticalAlign: 'middle',
                    color: '#111827',
                    WebkitTextFillColor: '#111827',
                    cursor: contract?.status === 'signed' ? 'not-allowed' : 'pointer',
                    // Ensure date picker shows correctly - remove any text input styling
                    appearance: 'auto',
                    WebkitAppearance: 'menulist',
                    MozAppearance: 'menulist'
                  }}
                />
                {/* Date fields are always required - show badge if empty */}
                {isEmpty && !contract?.status && (
                  <div className={`absolute -right-2 -top-2 flex items-center gap-1 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded-full shadow-lg z-20 transition-all duration-300 ${
                    isHighlighted ? 'scale-110 animate-pulse' : 'scale-100'
                  }`}>
                    <span className="w-2 h-2 bg-white rounded-full animate-ping absolute"></span>
                    <span className="relative">Required</span>
                  </div>
                )}
                {/* Date field popup - always show if empty */}
                {isEmpty && (
                  <div className={`absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl z-30 transition-all duration-300 pointer-events-none whitespace-nowrap ${
                    isHighlighted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
                  }`}>
                    Please select a date (required)
                    <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
                  </div>
                )}
              </span>
            );
          } else if (textMatch) {
            const id = textMatch[1] ? textMatch[1].substring(1) : `text-${++placeholderIndex.text}`;
            
            // CRITICAL: Check if this text field is actually a date field based on context
            // Look for "Date:" label immediately before the placeholder in the text
            const textBeforePlaceholder = text.slice(Math.max(0, match.index - 50), match.index);
            // Check if the text ends with "Date:" or "Date: " (case insensitive)
            const trimmedBefore = textBeforePlaceholder.trim();
            const isActuallyDateField = /date\s*:\s*$/i.test(trimmedBefore) || 
                                       /^date\s*:/i.test(trimmedBefore) ||
                                       (trimmedBefore.toLowerCase().endsWith('date:') || trimmedBefore.toLowerCase().endsWith('date: '));
            // If this is actually a date field, render it as a date input instead
            if (isActuallyDateField) {
              const isEmpty = !clientFields[id];
              const isHighlighted = highlightedFieldId === id;
              const needsAttention = incompleteFields.has(id);
              
              // Remove from applicant fields if it's there
              if (applicantFieldIds.includes(id)) {
                setApplicantFieldIds(prev => prev.filter(aid => aid !== id));
              }
              if (activeApplicantFields.includes(id)) {
                setActiveApplicantFields(prev => prev.filter(aid => aid !== id));
              }
              
              parts.push(
                <span 
                  key={id} 
                  className="inline-block relative field-wrapper" 
                  style={{ verticalAlign: 'middle' }}
                  data-field-id={id}
                  data-field-type="date"
                >
                  <input
                    type="date"
                    className={`input input-bordered input-lg mx-2 bg-white border-2 transition-all duration-300 ${
                      isEmpty 
                        ? isHighlighted 
                          ? 'border-blue-500 shadow-lg shadow-blue-500/50 ring-2 ring-blue-500 ring-opacity-50' 
                          : 'border-orange-400 shadow-md'
                        : 'border-green-400 focus:border-blue-500'
                    } focus:border-blue-500 focus:shadow-lg`}
                    value={clientFields[id] ? (() => {
                      const dateValue = clientFields[id];
                      if (dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                        return dateValue;
                      }
                      try {
                        const date = new Date(dateValue);
                        if (!isNaN(date.getTime())) {
                          const year = date.getFullYear();
                          const month = String(date.getMonth() + 1).padStart(2, '0');
                          const day = String(date.getDate()).padStart(2, '0');
                          return `${year}-${month}-${day}`;
                        }
                      } catch (e) {
                      }
                      return '';
                    })() : ''}
                    onChange={e => {
                      const selectedDate = e.target.value;
                      handleClientFieldChange(id, selectedDate);
                      if (selectedDate) {
                        setIncompleteFields(prev => {
                          const next = new Set(prev);
                          next.delete(id);
                          return next;
                        });
                      }
                    }}
                    onFocus={() => setHighlightedFieldId(id)}
                    disabled={contract?.status === 'signed'}
                    required
                    aria-label="Select date (required)"
                    placeholder=""
                    readOnly={false}
                    autoComplete="off"
                    data-input-type="date"
                    style={{ 
                      minWidth: 180, 
                      display: 'inline-block', 
                      verticalAlign: 'middle',
                      color: '#111827',
                      WebkitTextFillColor: '#111827',
                      cursor: contract?.status === 'signed' ? 'not-allowed' : 'pointer',
                      appearance: 'auto',
                      WebkitAppearance: 'menulist',
                      MozAppearance: 'menulist'
                    }}
                  />
                  {isEmpty && !contract?.status && (
                    <div className={`absolute -right-2 -top-2 flex items-center gap-1 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded-full shadow-lg z-20 transition-all duration-300 ${
                      isHighlighted ? 'scale-110 animate-pulse' : 'scale-100'
                    }`}>
                      <span className="w-2 h-2 bg-white rounded-full animate-ping absolute"></span>
                      <span className="relative">Required</span>
                    </div>
                  )}
                  {isEmpty && (
                    <div className={`absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl z-30 transition-all duration-300 pointer-events-none whitespace-nowrap ${
                      isHighlighted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
                    }`}>
                      Please select a date (required)
                      <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
                    </div>
                  )}
                </span>
              );
              lastIndex = match.index + match[1].length;
              continue; // Skip the rest of the text field processing
            }
            
            const isEmpty = !clientFields[id]?.trim();
            const isHighlighted = highlightedFieldId === id;
            const needsAttention = incompleteFields.has(id);
            
            // Check if this is an applicant name field and if it's active
            const isApplicantField = applicantFieldIds.includes(id);
            const isActiveApplicantField = isApplicantField && activeApplicantFields.includes(id);
            
            // If it's an applicant field but not active, ensure it gets added to activeApplicantFields
            if (isApplicantField && !isActiveApplicantField && activeApplicantFields.length === 0) {
              // Auto-add to active fields if the array is empty (initial load)
              setActiveApplicantFields(prev => {
                if (!prev.includes(id)) {
                  const updated = [...prev, id];
                  return updated;
                }
                return prev;
              });
            }
            
            const applicantFieldIndex = isApplicantField ? activeApplicantFields.indexOf(id) : -1;
            // If not in activeApplicantFields yet, use applicantFieldIds index as fallback
            const fallbackIndex = applicantFieldIndex < 0 && isApplicantField ? applicantFieldIds.indexOf(id) : applicantFieldIndex;
            const isFirstApplicantField = fallbackIndex === 0;
            // Check if this is the last field in activeApplicantFields (current visible fields)
            const currentActiveFields = activeApplicantFields.length > 0 ? activeApplicantFields : applicantFieldIds;
            const totalFields = currentActiveFields.length;
            const isLastApplicantField = isApplicantField && (
              (applicantFieldIndex >= 0 && applicantFieldIndex === activeApplicantFields.length - 1) ||
              (applicantFieldIndex < 0 && fallbackIndex === totalFields - 1 && totalFields > 0)
            );
            const canRemoveApplicantField = isApplicantField && totalFields > 1;
            
            // Skip rendering if this is an applicant field that's been explicitly removed
            // Only skip if activeApplicantFields has items AND this field is not in it
            // This allows fields to render on initial load even if activeApplicantFields is not yet populated
            if (isApplicantField && activeApplicantFields.length > 0 && !activeApplicantFields.includes(id)) {
              // Just skip this placeholder - don't render anything
              lastIndex = match.index + match[1].length;
              continue;
            }
            
            
            // For applicant fields, render as block-level elements with buttons
            // Always render applicant fields with buttons, even if not yet in activeApplicantFields
            if (isApplicantField) {
              // Ensure this field is in activeApplicantFields immediately
              // Use useCallback pattern but we need to ensure it's added synchronously
              // Instead, we'll check and add it during rendering
              const needsAdding = !activeApplicantFields.includes(id);
              if (needsAdding) {
                // Immediately add to activeApplicantFields using a ref-like approach
                // We'll let the useEffect handle this, but for now ensure it's in the list
              }
              parts.push(
                <div 
                  key={id} 
                  className="flex items-center gap-2 mb-2 relative field-wrapper group w-full" 
                  data-field-id={id}
                  data-is-applicant="true"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}
                >
                  <span className="text-xs md:text-sm font-medium text-gray-700 min-w-[80px] md:min-w-[100px] flex-shrink-0">
                    Applicant {fallbackIndex >= 0 ? fallbackIndex + 1 : ''}:
                  </span>
                  <input
                    type="text"
                    className={`input input-bordered input-lg flex-1 bg-white border-2 transition-all duration-300 ${
                      isEmpty 
                        ? needsAttention
                          ? isHighlighted 
                            ? 'border-blue-500 shadow-lg shadow-blue-500/50 ring-2 ring-blue-500 ring-opacity-50' 
                            : 'border-orange-400 shadow-md'
                          : 'border-orange-400 shadow-md'
                        : 'border-green-400 focus:border-blue-500'
                    } focus:border-blue-500 focus:shadow-lg`}
                    placeholder={`Enter applicant ${fallbackIndex >= 0 ? fallbackIndex + 1 : ''} name`}
                    value={clientFields[id] || ''}
                    onChange={e => {
                      handleClientFieldChange(id, e.target.value);
                      if (e.target.value.trim()) {
                        setIncompleteFields(prev => {
                          const next = new Set(prev);
                          next.delete(id);
                          return next;
                        });
                      }
                    }}
                    onFocus={() => {
                      setHighlightedFieldId(id);
                    }}
                    disabled={contract?.status === 'signed'}
                    style={{ minWidth: 200 }}
                  />
                  {/* Required badge */}
                  {needsAttention && !contract?.status && (
                    <div className={`flex items-center gap-1 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded-full shadow-lg transition-all duration-300 flex-shrink-0 ${
                      isHighlighted ? 'scale-110 animate-pulse' : 'scale-100'
                    }`}>
                      <span className="w-2 h-2 bg-white rounded-full animate-ping absolute"></span>
                      <span className="relative">Required</span>
                    </div>
                  )}
                  {/* Popup for applicant fields */}
                  {isEmpty && !contract?.status && (
                    <div className={`absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl z-30 transition-all duration-300 pointer-events-none whitespace-nowrap ${
                      isHighlighted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
                    }`}>
                      Please fill in applicant {applicantFieldIndex >= 0 ? applicantFieldIndex + 1 : ''} name (required)
                      <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
                    </div>
                  )}
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
                  const dynamicIsEmpty = !clientFields[dynamicFieldId]?.trim();
                  const dynamicIsHighlighted = highlightedFieldId === dynamicFieldId;
                  const dynamicNeedsAttention = incompleteFields.has(dynamicFieldId);
                  const dynamicIsLast = dynamicIndex === activeApplicantFields.length - 1;
                  const dynamicCanRemove = activeApplicantFields.length > 1;
                  
                  parts.push(
                    <div 
                      key={dynamicFieldId} 
                      className="flex items-center gap-2 mb-2 relative field-wrapper group w-full" 
                      data-field-id={dynamicFieldId}
                      data-is-applicant="true"
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}
                    >
                      <span className="text-xs md:text-sm font-medium text-gray-700 min-w-[80px] md:min-w-[100px] flex-shrink-0">
                        Applicant {dynamicIndex >= 0 ? dynamicIndex + 1 : ''}:
                      </span>
                      <input
                        type="text"
                        className={`input input-bordered input-lg flex-1 bg-white border-2 transition-all duration-300 ${
                          dynamicIsEmpty 
                            ? dynamicNeedsAttention
                              ? dynamicIsHighlighted 
                                ? 'border-blue-500 shadow-lg shadow-blue-500/50 ring-2 ring-blue-500 ring-opacity-50' 
                                : 'border-orange-400 shadow-md'
                              : 'border-orange-400 shadow-md'
                            : 'border-green-400 focus:border-blue-500'
                        } focus:border-blue-500 focus:shadow-lg`}
                        placeholder={`Enter applicant ${dynamicIndex >= 0 ? dynamicIndex + 1 : ''} name`}
                        value={clientFields[dynamicFieldId] || ''}
                        onChange={e => {
                          handleClientFieldChange(dynamicFieldId, e.target.value);
                          if (e.target.value.trim()) {
                            setIncompleteFields(prev => {
                              const next = new Set(prev);
                              next.delete(dynamicFieldId);
                              return next;
                            });
                          }
                        }}
                        onFocus={() => setHighlightedFieldId(dynamicFieldId)}
                        disabled={contract?.status === 'signed'}
                        style={{ minWidth: 200 }}
                      />
                      {dynamicNeedsAttention && !contract?.status && (
                        <div className={`flex items-center gap-1 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded-full shadow-lg transition-all duration-300 flex-shrink-0 ${
                          dynamicIsHighlighted ? 'scale-110 animate-pulse' : 'scale-100'
                        }`}>
                          <span className="w-2 h-2 bg-white rounded-full animate-ping absolute"></span>
                          <span className="relative">Required</span>
                        </div>
                      )}
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
                  className={`input input-bordered input-lg mx-2 bg-white border-2 transition-all duration-300 ${
                    isEmpty 
                      ? isHighlighted 
                        ? 'border-blue-500 shadow-lg shadow-blue-500/50 ring-2 ring-blue-500 ring-opacity-50' 
                        : 'border-orange-400 shadow-md'
                      : 'border-green-400 focus:border-blue-500'
                  } focus:border-blue-500 focus:shadow-lg`}
                  placeholder="Enter text"
                  value={clientFields[id] || ''}
                  onChange={e => {
                    handleClientFieldChange(id, e.target.value);
                    if (e.target.value.trim()) {
                      setIncompleteFields(prev => {
                        const next = new Set(prev);
                        next.delete(id);
                        return next;
                      });
                    }
                  }}
                  onFocus={() => {
                    setHighlightedFieldId(id);
                  }}
                  disabled={contract?.status === 'signed'}
                  style={{ minWidth: 150, display: 'inline-block', verticalAlign: 'middle' }}
                />
                {/* Add/Remove buttons for applicant fields - always visible for applicant fields */}
                {/* Required badge - for all required fields including all applicant fields */}
                {needsAttention && !contract?.status && (
                  <div className={`absolute -right-2 -top-2 flex items-center gap-1 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded-full shadow-lg z-20 transition-all duration-300 ${
                    isHighlighted ? 'scale-110 animate-pulse' : 'scale-100'
                  }`}>
                    <span className="w-2 h-2 bg-white rounded-full animate-ping absolute"></span>
                    <span className="relative">Required</span>
                  </div>
                )}
                {/* Popup for applicant fields explaining to fill all applicants */}
                {isApplicantField && isEmpty && !contract?.status && (
                  <div className={`absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl z-30 transition-all duration-300 pointer-events-none whitespace-nowrap ${
                    isHighlighted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
                  }`}>
                    Please fill in applicant {applicantFieldIndex >= 0 ? applicantFieldIndex + 1 : ''} name (required)
                    <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
                  </div>
                )}
                {/* Regular popup for non-applicant required fields */}
                {needsAttention && !isApplicantField && (
                  <div className={`absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl z-30 transition-all duration-300 pointer-events-none whitespace-nowrap ${
                    isHighlighted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
                  }`}>
                    Please fill in this field
                    <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
                  </div>
                )}
              </span>
            );
          } else if (sigMatch) {
            const id = sigMatch[1] ? sigMatch[1].substring(1) : `signature-${++placeholderIndex.signature}`;
            const isEmpty = !clientSignature && !clientFields[id];
            const isHighlighted = highlightedFieldId === id;
            const needsAttention = incompleteFields.has(id);
            
            parts.push(
              <span 
                key={id} 
                className="inline-flex items-center gap-4 relative field-wrapper" 
                style={{ display: 'inline-flex', minWidth: 220, minHeight: 100, verticalAlign: 'middle' }}
                data-field-id={id}
              >
                <span 
                  className={`border-2 rounded-lg bg-gray-50 p-3 transition-all duration-300 ${
                    isEmpty 
                      ? isHighlighted 
                        ? 'border-blue-500 shadow-lg shadow-blue-500/50 ring-2 ring-blue-500 ring-opacity-50' 
                        : 'border-orange-400 shadow-md'
                      : 'border-green-400'
                  }`} 
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
                          // Remove from incomplete fields
                          setIncompleteFields(prev => {
                            const next = new Set(prev);
                            next.delete(id);
                            return next;
                          });
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
                {needsAttention && !contract?.status && (
                  <div className={`absolute -right-2 -top-2 flex items-center gap-1 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded-full shadow-lg z-20 transition-all duration-300 ${
                    isHighlighted ? 'scale-110 animate-pulse' : 'scale-100'
                  }`}>
                    <span className="w-2 h-2 bg-white rounded-full animate-ping absolute"></span>
                    <span className="relative">Required</span>
                  </div>
                )}
                {needsAttention && (
                  <div className={`absolute right-0 top-full mt-2 md:bottom-full md:top-auto md:mb-2 md:left-1/2 md:transform md:-translate-x-1/2 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl z-30 transition-all duration-300 pointer-events-none whitespace-nowrap ${
                    isHighlighted ? 'opacity-100' : 'opacity-0'
                  }`} style={{ 
                    maxWidth: 'calc(100vw - 40px)'
                  }}>
                    Please sign in the box above
                    <div className="absolute -top-1 left-4 md:top-full md:left-1/2 md:transform md:-translate-x-1/2 md:-mt-1 border-4 border-transparent border-b-gray-900 md:border-t-gray-900 md:border-b-transparent"></div>
                  </div>
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
      // Replace {{price_per_applicant}} for each tier row
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
          const lineRegex = new RegExp(`(${tier.label}[^\n]*?):?\s*\{\{price_per_applicant\}\}`, 'g');
          text = text.replace(lineRegex, `$1: ${currency} ${(customPricing.pricing_tiers[tier.key] || 0).toLocaleString()}`);
        });
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
          
          if (hasInputFields) {
            // Use div instead of p to avoid DOM nesting issues with input fields
            return <div key={keyPrefix} className="mb-2 md:mb-3 text-sm md:text-base">{paragraphContent}</div>;
          } else {
            return <p key={keyPrefix} className="mb-2 md:mb-3 text-sm md:text-base">{paragraphContent}</p>;
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
        return React.createElement(
          HeadingTag,
          { key: keyPrefix, className: `${sizeClass} font-semibold mb-2 md:mb-3` },
          renderTiptapContent(content.content, keyPrefix + '-h', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)
        );
      }
      case 'bulletList':
        return <ul key={keyPrefix} className="text-sm md:text-base mb-2 md:mb-3 list-disc list-inside">{renderTiptapContent(content.content, keyPrefix + '-ul', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}</ul>;
      case 'orderedList':
        // Check if this ordered list contains applicant fields - if so, hide the numbering
        const listContentStr = JSON.stringify(content);
        const hasApplicantField = listContentStr.toLowerCase().includes('applicant') && 
          (listContentStr.includes('{{text:') || listContentStr.includes('text:'));
        const listContent = renderTiptapContent(content.content, keyPrefix + '-ol', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex);
        return <ol key={keyPrefix} className={`text-sm md:text-base mb-2 md:mb-3 ${hasApplicantField ? 'list-none pl-0' : 'list-decimal list-inside'}`}>{listContent}</ol>;
      case 'listItem':
        // Check if this list item contains an applicant field placeholder
        const itemContentStr = JSON.stringify(content);
        const hasApplicantInItem = itemContentStr.toLowerCase().includes('applicant') && 
          (itemContentStr.includes('{{text:') || itemContentStr.includes('text:'));
        return <li key={keyPrefix} className={`text-sm md:text-base ${hasApplicantInItem ? 'list-none ml-0 before:content-none' : ''}`}>{renderTiptapContent(content.content, keyPrefix + '-li', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}</li>;
      case 'blockquote':
        return <blockquote key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-bq', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}</blockquote>;
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
        
        
        <h1 className="text-xl md:text-2xl font-bold mb-4 md:mb-6 text-center">
          Contract for {contract?.contact_name || client?.name || 'Client'}
        </h1>
        
        <div className="prose prose-sm md:prose-base max-w-none">
                  {thankYou ? (
          <>
            <div className="alert alert-success text-sm md:text-lg font-semibold mb-4 md:mb-6">Thank you! Your contract was signed and submitted. You will be notified soon.</div>
            {(() => {
              return renderTiptapContent(contract.custom_content || template.content, '', signaturePads, undefined, undefined, { text: 0, signature: 0 });
            })()}
          </>
        ) : (
          (() => {
            return renderTiptapContent(contract.custom_content || template.content, '', signaturePads, undefined, undefined, { text: 0, signature: 0 });
          })()
        )}
        </div>
        
        {/* Submit Contract Button (only if not signed) */}
        {contract.status !== 'signed' && !thankYou && (
          <button
            className="btn btn-success btn-lg w-full mt-8"
            onClick={handleSubmitContract}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Contract'}
          </button>
        )}
      </div>
      
      {/* CSS for animations */}
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
      `}</style>
    </div>
  );
};

export default PublicContractView; 