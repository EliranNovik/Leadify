import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import SignaturePad from 'react-signature-canvas';

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



const PublicLegacyContractView: React.FC = () => {
  const { contractId, token } = useParams();
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientFields, setClientFields] = useState<{ [key: string]: string }>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isAlreadySigned, setIsAlreadySigned] = useState(false);
  const signaturePads = useRef<{ [key: string]: any }>({});

  useEffect(() => {
    const fetchContract = async () => {
      if (!contractId || !token) {
        setError('Invalid contract link');
        setLoading(false);
        return;
      }

      try {
        // Fetch the legacy contract
        const { data, error } = await supabase
          .from('lead_leadcontact')
          .select('*')
          .eq('id', contractId)
          .eq('public_token', token)
          .single();

        if (error || !data) {
          setError('Contract not found or invalid token');
          setLoading(false);
          return;
        }

        setContract(data);
        
        // Check if contract is already signed
        if (data.signed_contract_html && data.signed_contract_html !== '\\N') {
          setIsAlreadySigned(true);
        }
        
        setLoading(false);
      } catch (err) {
        console.error('Error fetching contract:', err);
        setError('Failed to load contract');
        setLoading(false);
      }
    };

    fetchContract();
  }, [contractId, token]);

  const handleFieldChange = (fieldId: string, value: string) => {
    setClientFields(prev => ({
      ...prev,
      [fieldId]: value
    }));
  };

  // Function to render contract content with interactive fields
  const renderContractContent = (htmlContent: string, isReadOnly: boolean = false) => {
    if (!htmlContent) return null;
    
    // For signed contracts, first process any base64 signature data
    if (isReadOnly) {
      // Handle base64 signature data (data:image/png;base64,...)
      htmlContent = htmlContent.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, (match) => {
        return `<img src="${match}" style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px; margin: 0 4px; background-color: #f0fdf4; max-width: 200px; max-height: 80px; object-fit: contain;" alt="Signature" />`;
      });
    }
    
    // Split the HTML content by placeholders
    const parts = [];
    let lastIndex = 0;
    let textCounter = 1;
    let signatureCounter = 1;
    
    // Find all {{text}} and {{sig}} placeholders
    const regex = /({{text}}|{{sig}})/g;
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
        const fieldId = `text-${textCounter++}`;
        if (isReadOnly) {
          // Show filled text in read-only mode
          parts.push(
            <span
              key={fieldId}
              className="filled-text"
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
              {clientFields[fieldId] || '_____________'}
            </span>
          );
        } else {
          parts.push(
            <input
              key={fieldId}
              type="text"
              className="client-input"
              placeholder="Enter text..."
              onChange={(e) => handleFieldChange(fieldId, e.target.value)}
            />
          );
        }
      } else if (match[1] === '{{sig}}') {
        const fieldId = `signature-${signatureCounter++}`;
        if (isReadOnly) {
          // Show signature image in read-only mode
          parts.push(
            <div key={fieldId} className="signature-container">
              <div
                className="signature-display"
                style={{
                  display: 'inline-block',
                  verticalAlign: 'middle',
                  border: '2px solid #10b981',
                  borderRadius: '6px',
                  padding: '4px',
                  margin: '0 4px',
                  backgroundColor: '#f0fdf4',
                  minWidth: '200px',
                  minHeight: '80px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <span style={{ color: '#065f46', fontSize: '12px' }}>✓ Signed</span>
              </div>
            </div>
          );
        } else {
          parts.push(
            <div key={fieldId} className="signature-container">
              <SignaturePad
                canvasProps={{
                  className: 'signature-pad-canvas',
                  style: {
                    border: '2px dashed #3b82f6',
                    borderRadius: '6px',
                    backgroundColor: '#f8fafc',
                    cursor: 'crosshair'
                  }
                }}
                ref={(ref) => {
                  if (ref) {
                    signaturePads.current[fieldId] = ref;
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (signaturePads.current[fieldId]) {
                    signaturePads.current[fieldId].clear();
                  }
                }}
                className="clear-signature-btn"
              >
                Clear
              </button>
            </div>
          );
        }
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

  const handleSubmit = async () => {
    if (!contract) return;

    setIsSubmitting(true);
    try {
      let htmlContent = contract.contract_html || '';

      // Create a mapping of field positions to values
      const fieldMappings: { [key: string]: string } = {};
      Object.keys(clientFields).forEach((fieldId) => {
        if (fieldId.startsWith('text-')) {
          const fieldNumber = parseInt(fieldId.replace('text-', ''));
          fieldMappings[fieldNumber] = clientFields[fieldId] || '_____________';
        }
      });

      // Replace {{text}} placeholders in order
      let textPlaceholderCount = 0;
      htmlContent = htmlContent.replace(/\{\{text\}\}/g, (match) => {
        textPlaceholderCount++;
        return fieldMappings[textPlaceholderCount] || '_____________';
      });

      // Create a mapping of signature positions to data
      const signatureMappings: { [key: string]: string } = {};
      Object.keys(signaturePads.current).forEach((fieldId) => {
        if (fieldId.startsWith('signature-')) {
          const signatureNumber = parseInt(fieldId.replace('signature-', ''));
          const signaturePad = signaturePads.current[fieldId];
          if (signaturePad && !signaturePad.isEmpty()) {
            signatureMappings[signatureNumber] = signaturePad.toDataURL();
          } else {
            signatureMappings[signatureNumber] = '_____________';
          }
        }
      });

      // Replace {{sig}} placeholders in order
      let sigPlaceholderCount = 0;
      htmlContent = htmlContent.replace(/\{\{sig\}\}/g, (match) => {
        sigPlaceholderCount++;
        return signatureMappings[sigPlaceholderCount] || '_____________';
      });

      // Update the signed_contract_html in lead_leadcontact table
      const { error } = await supabase
        .from('lead_leadcontact')
        .update({ signed_contract_html: htmlContent })
        .eq('id', contractId);

      if (error) {
        console.error('Error saving signed contract:', error);
        toast.error('Failed to save contract');
        return;
      }

      toast.success('Contract submitted successfully!');
      
      // Mark as submitted and update contract data
      setIsSubmitted(true);
      setContract(prev => ({
        ...prev,
        signed_contract_html: htmlContent
      }));

    } catch (error) {
      console.error('Error submitting contract:', error);
      toast.error('Failed to submit contract');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-blue-500"></div>
          <p className="mt-4 text-gray-600">Loading contract...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Contract Not Found</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Contract Agreement</h1>
          <p className="text-gray-600">
            {isSubmitted || isAlreadySigned 
              ? 'Contract has been signed and submitted successfully' 
              : 'Please review and fill in the required fields below'
            }
          </p>
        </div>

        {/* Thank You Message */}
        {(isSubmitted || isAlreadySigned) && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              <div className="ml-3">
                <h3 className="text-lg font-medium text-green-800">
                  {isSubmitted ? 'Thank You!' : 'Contract Already Signed'}
                </h3>
                <p className="text-green-700 mt-1">
                  {isSubmitted 
                    ? 'Your contract has been successfully submitted and signed. We will review it and get back to you soon.'
                    : 'This contract has already been signed and submitted. Thank you for your business.'
                  }
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Contract Content */}
        <div className="bg-white rounded-lg shadow-sm p-8">
          <style>
            {`
              .client-input {
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
              .signature-container {
                display: inline-block !important;
                vertical-align: middle !important;
                margin: 0 4px !important;
              }
              .signature-pad-canvas {
                border: 2px dashed #3b82f6 !important;
                border-radius: 6px !important;
                background-color: #f8fafc !important;
                cursor: crosshair !important;
                width: 200px !important;
                height: 80px !important;
              }
              .clear-signature-btn {
                display: block !important;
                margin-top: 4px !important;
                padding: 2px 8px !important;
                font-size: 12px !important;
                color: #ef4444 !important;
                background: none !important;
                border: 1px solid #ef4444 !important;
                border-radius: 4px !important;
                cursor: pointer !important;
              }
              .clear-signature-btn:hover {
                background: #ef4444 !important;
                color: white !important;
              }
            `}
          </style>
          
          <div className="prose prose-lg max-w-none" style={{ minHeight: '400px' }}>
            {renderContractContent(
              (isSubmitted || isAlreadySigned) ? (contract.signed_contract_html || contract.contract_html || '') : (contract.contract_html || ''), 
              isSubmitted || isAlreadySigned
            )}
          </div>
        </div>

        {/* Submit Button */}
        {!isSubmitted && !isAlreadySigned && (
          <div className="mt-6 text-center">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="btn btn-primary btn-lg px-8"
            >
              {isSubmitting ? (
                <>
                  <div className="loading loading-spinner loading-sm"></div>
                  Submitting...
                </>
              ) : (
                'Submit Contract'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicLegacyContractView;
