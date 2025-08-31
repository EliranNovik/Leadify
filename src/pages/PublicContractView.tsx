import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SignaturePad from 'react-signature-canvas';
import { handleContractSigned } from '../lib/contractAutomation';

// Function to preprocess template placeholders
function preprocessTemplatePlaceholders(content: any): any {
  console.log('🔧 PublicContractView: preprocessTemplatePlaceholders called with:', content);
  let textId = 1;
  let signatureId = 1;
  
  function processContent(content: any): any {
    if (!content) return content;
    if (Array.isArray(content)) {
      return content.map(processContent);
    }
    if (content.type === 'text' && content.text) {
      console.log('🔧 PublicContractView: Processing text node:', content.text);
      let newText = content.text.replace(/\{\{text\}\}/g, () => `{{text:text-${textId++}}}`)
                               .replace(/\{\{signature\}\}/g, () => `{{signature:signature-${signatureId++}}}`);
      console.log('🔧 PublicContractView: Processed text node:', newText);
      return { ...content, text: newText };
    }
    if (content.content) {
      return { ...content, content: processContent(content.content) };
    }
    return content;
  }
  
  const result = processContent(content);
  console.log('🔧 PublicContractView: preprocessTemplatePlaceholders result:', result);
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
  
  result = result.replace(/{{date}}/g, new Date().toLocaleDateString());
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
    console.log('🎯 PublicContractView: handleClientFieldChange called - Key:', key, 'Value:', value);
    console.log('🎯 PublicContractView: Previous clientFields:', clientFields);
    setClientFields(prev => {
      const newFields = { ...prev, [key]: value };
      console.log('🎯 PublicContractView: New clientFields:', newFields);
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
      console.log('📋 PublicContractView: Contract data:', contractData);
      console.log('📋 PublicContractView: Template data:', contractData.contract_templates);
      console.log('📋 PublicContractView: Original template content:', contractData.contract_templates.content);
      
      // Process template to add text and signature placeholders
      console.log('🔧 PublicContractView: About to call preprocessTemplatePlaceholders');
      const processedTemplate = {
        ...contractData.contract_templates,
        content: contractData.contract_templates.content ? 
          preprocessTemplatePlaceholders(contractData.contract_templates.content) : 
          contractData.contract_templates.content
      };
      console.log('📋 PublicContractView: Processed template:', processedTemplate);
      setTemplate(processedTemplate);
      // Fetch client info
      const { data: leadData } = await supabase
        .from('leads')
        .select('id, name, email, phone, mobile')
        .eq('id', contractData.client_id)
        .single();
      setClient(leadData);
      setCustomPricing(contractData.custom_pricing);
      setLoading(false);
    })();
  }, [contractId, token]);

  // Add a handler for submitting the contract (signing)
  const handleSubmitContract = async () => {
    if (!contract) return;
    setIsSubmitting(true);
    try {
      // Fill in client fields in the contract content
      const filledContent = fillClientFieldsInContent(contract.custom_content || template.content?.content);
      
      console.log('🔍 PublicContractView: Saving client inputs:', clientFields);
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
        // Render {{text}} and {{signature}} fields (before preprocessing) or {{text:ID}} and {{signature:ID}} fields (after preprocessing)
        console.log('🎨 PublicContractView: Checking text for placeholders:', text);
        console.log('🎨 PublicContractView: Has placeholders:', /\{\{(text|signature)(:[^}]+)?\}\}/.test(text));
        if (text && /\{\{(text|signature)(:[^}]+)?\}\}/.test(text)) {
          // Ensure placeholderIndex is defined
          if (!placeholderIndex) placeholderIndex = { text: 0, signature: 0 };
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
            const id = textMatch[1] ? textMatch[1].substring(1) : `text-${++placeholderIndex.text}`;
            console.log('🎯 PublicContractView: Creating text input with ID:', id, 'Current value:', clientFields[id]);
            parts.push(
              <input
                key={id}
                className="input input-bordered input-lg mx-2 bg-white border-2 border-blue-300 focus:border-blue-500"
                placeholder="Enter text"
                value={clientFields[id] || ''}
                onChange={e => {
                  console.log('🎯 PublicContractView: Text input changed - ID:', id, 'New value:', e.target.value);
                  handleClientFieldChange(id, e.target.value);
                }}
                disabled={contract?.status === 'signed'}
                style={{ minWidth: 150, display: 'inline-block', verticalAlign: 'middle' }}
              />
            );
          } else if (sigMatch) {
            const id = sigMatch[1] ? sigMatch[1].substring(1) : `signature-${++placeholderIndex.signature}`;
            parts.push(
              <span key={id} style={{ display: 'inline-block', minWidth: 220, minHeight: 100, verticalAlign: 'middle' }}>
                <span className="border-2 border-blue-300 rounded-lg bg-gray-50 p-3" style={{ display: 'inline-block' }}>
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
              <span className="inline-block bg-blue-50 border border-blue-200 rounded-lg px-3 py-1 mx-1 text-sm font-medium" key={keyPrefix + '-pprow-' + rowIndex}>
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
            return <div key={keyPrefix} className="mb-3">{paragraphContent}</div>;
          } else {
            return <p key={keyPrefix} className="mb-3">{paragraphContent}</p>;
          }
        }
        return null;
      case 'heading': {
        const level = content.attrs?.level || 1;
        const headingTags = ['h1','h2','h3','h4','h5','h6'];
        const HeadingTag = headingTags[Math.max(0, Math.min(5, level-1))] || 'h1';
        return React.createElement(
          HeadingTag,
          { key: keyPrefix },
          renderTiptapContent(content.content, keyPrefix + '-h', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)
        );
      }
      case 'bulletList':
        return <ul key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-ul', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}</ul>;
      case 'orderedList':
        return <ol key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-ol', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}</ol>;
      case 'listItem':
        return <li key={keyPrefix}>{renderTiptapContent(content.content, keyPrefix + '-li', signaturePads, applicantPriceIndex, paymentPlanIndex, placeholderIndex)}</li>;
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
        <p className="mt-4 text-gray-600">Loading contract...</p>
      </div>
    </div>
  );
  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <p className="text-red-500 text-lg">{error}</p>
      </div>
    </div>
  );
  if (!contract || !template) return null;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-2 py-8">
      <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg border border-gray-200 p-8">
        <h1 className="text-2xl font-bold mb-6 text-center">
          Contract for {contract?.contact_name || client?.name || 'Client'}
        </h1>
        
        <div className="prose max-w-none">
                  {thankYou ? (
          <>
            <div className="alert alert-success text-lg font-semibold mb-6">Thank you! Your contract was signed and submitted. You will be notified soon.</div>
            {(() => {
              console.log('🎯 PublicContractView: Rendering thank you with template.content:', template.content);
              return renderTiptapContent(contract.custom_content || template.content, '', signaturePads, undefined, undefined, { text: 0, signature: 0 });
            })()}
          </>
        ) : (
          (() => {
            console.log('🎯 PublicContractView: Rendering normal with template.content:', template.content);
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
        {/* Show read-only message if signed */}
        {contract.status === 'signed' && !thankYou && (
          <div className="alert alert-success mt-8">This contract has been signed and is now read-only.</div>
        )}
      </div>
    </div>
  );
};

export default PublicContractView; 