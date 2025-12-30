import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import SignaturePad from 'react-signature-canvas';
import { updateLeadStageWithHistory } from '../lib/leadStageManager';

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
        // Convert contractId to number (it's a bigint in the database)
        const contractIdNum = parseInt(contractId || '', 10);
        if (isNaN(contractIdNum)) {
          setError('Invalid contract ID');
          setLoading(false);
          return;
        }

        // Fetch the legacy contract - specify columns explicitly for better compatibility
        // Try with number first, then string if that fails
        let query = supabase
          .from('lead_leadcontact')
          .select('id, contract_html, signed_contract_html, public_token, lead_id, contact_id, main')
          .eq('id', contractIdNum)
          .eq('public_token', token!);
        
        let { data, error } = await query.maybeSingle();
        
        // If query failed, try with string ID
        if (error && error.code !== 'PGRST116') {
          console.log('Query with number ID failed, trying with string ID:', error);
          query = supabase
            .from('lead_leadcontact')
            .select('id, contract_html, signed_contract_html, public_token, lead_id, contact_id, main')
            .eq('id', contractId!)
            .eq('public_token', token!);
          
          const result = await query.maybeSingle();
          data = result.data;
          error = result.error;
        }

        if (error) {
          console.error('Error fetching contract:', error);
          setError(`Failed to load contract: ${error.message || 'Invalid contract link'}`);
          setLoading(false);
          return;
        }

        if (!data) {
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

  // Helper function to process HTML for editing with input fields
  const processHtmlForEditing = (html: string): string => {
    if (!html) return '';
    
    // First, convert any existing lines (_____________) back to placeholders
    // This handles cases where the contract was saved with lines instead of placeholders
    let processed = html;
    
    // Convert lines in styled spans (from processSignedContractHtml) back to placeholders
    // Match any span with style containing border and the line text
    processed = processed.replace(/<span[^>]*style="[^"]*border[^"]*"[^>]*>_____________<\/span>/gi, '{{text}}');
    
    // Convert plain lines that appear after colons or other text (common pattern: ": _____________")
    // Use a more flexible pattern that handles various spacing
    processed = processed.replace(/([:\s>])(_____________)([\s<])/g, '$1{{text}}$3');
    
    // Handle lines that might be inside paragraph tags directly: <p>_____________</p>
    processed = processed.replace(/(<p[^>]*>)([^<]*)_____________([^<]*)(<\/p>)/g, '$1$2{{text}}$3$4');
    
    // Also handle lines that appear as standalone text nodes between tags
    processed = processed.replace(/(>)([^<]*?)_____________([^<]*?)(<)/g, '$1$2{{text}}$3$4');
    
    // Replace {{text}} placeholders with styled input fields with unique IDs
    let textCounter = 1;
    let sigCounter = 1;
    processed = processed
      .replace(/\{\{text\}\}/g, () => {
        const id = `text-field-${textCounter++}`;
        return `<input type="text" id="${id}" class="inline-input" data-field-type="text" style="border: 2px solid #3b82f6; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; font-family: inherit; font-size: 14px; background: #ffffff; color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.1);" placeholder="Enter text..." />`;
      })
      .replace(/\{\{sig\}\}/g, () => {
        const id = `sig-field-${sigCounter++}`;
        return `<div id="${id}" class="signature-pad-placeholder" data-field-type="signature" style="display: inline-block; border: 2px dashed #3b82f6; border-radius: 6px; padding: 12px; margin: 0 4px; min-width: 180px; min-height: 50px; background: #f8fafc; cursor: pointer; text-align: center; font-size: 14px; color: #6b7280; font-weight: 500; direction: inherit; text-align: inherit;">Click to sign</div>`;
      });
    
    return processed;
  };

  // Effect to convert signature placeholders to actual signature pads
  useEffect(() => {
    if (!contract || isSubmitted || isAlreadySigned) return;

    // Use a timeout to ensure DOM is ready after render
    const timeoutId = setTimeout(() => {
      // Find all signature pad placeholders and replace them with actual signature pads
      const placeholders = document.querySelectorAll('.contract-content .signature-pad-placeholder');
      placeholders.forEach((placeholder) => {
        const id = placeholder.getAttribute('id');
        if (!id) return;
        
        // Check if already replaced (container exists)
        if (document.querySelector(`.signature-pad-container[data-signature-id="${id}"]`)) {
          return;
        }

        const container = document.createElement('div');
        container.className = 'signature-pad-container';
        // Check if parent paragraph has right alignment
        const parentParagraph = placeholder.closest('p.ql-align-right, .ql-align-right');
        const isRightAligned = parentParagraph !== null;
        container.style.cssText = `display: inline-block; vertical-align: middle; margin: 0 4px; ${isRightAligned ? 'text-align: right; direction: rtl;' : ''}`;
        container.setAttribute('data-signature-id', id);

        const canvasContainer = document.createElement('div');
        // Make canvas container responsive for mobile - use max-width instead of fixed width
        canvasContainer.style.cssText = 'border: 2px dashed #3b82f6; border-radius: 6px; background-color: #f8fafc; width: 100%; max-width: 200px; min-width: 150px; height: 80px; position: relative;';

        const canvas = document.createElement('canvas');
        // Initial dimensions - will be resized based on actual container size
        canvas.width = 200;
        canvas.height = 80;
        canvas.style.cssText = 'display: block; width: 100%; height: 100%; cursor: crosshair; touch-action: none;';

        canvasContainer.appendChild(canvas);
        
        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.type = 'button';
        clearBtn.style.cssText = 'display: block; margin-top: 4px; padding: 2px 8px; font-size: 12px; color: #ef4444; background: none; border: 1px solid #ef4444; border-radius: 4px; cursor: pointer;';
        clearBtn.onclick = () => {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        };

        container.appendChild(canvasContainer);
        container.appendChild(clearBtn);
        
        // Replace placeholder with container FIRST so canvas is in DOM
        placeholder.parentNode?.replaceChild(container, placeholder);

        // Initialize signature pad functionality - must happen AFTER canvas is in DOM
        setTimeout(() => {
          let isDrawing = false;
          let lastX = 0;
          let lastY = 0;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          
          // Set canvas size to match its displayed size (now that it's in DOM)
          // Use devicePixelRatio for crisp rendering on high-DPI displays
          const rect = canvas.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const displayWidth = Math.max(1, Math.floor(rect.width));
          const displayHeight = Math.max(1, Math.floor(rect.height));
          
          // Set actual canvas size accounting for device pixel ratio (backing store resolution)
          canvas.width = displayWidth * dpr;
          canvas.height = displayHeight * dpr;
          
          // Set the CSS size to the display size (logical pixels) - keep it responsive
          // Don't set explicit pixel sizes to maintain responsiveness
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          
          // Scale the context to account for device pixel ratio (do this BEFORE setting styles)
          ctx.scale(dpr, dpr);
          
          // Set drawing style (after scaling) - use logical pixel values
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 2; // This will be 2 logical pixels, rendered as 2*dpr physical pixels
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          const getPoint = (e: any): { x: number; y: number } => {
            const rect = canvas.getBoundingClientRect();
            
            // Check for touch events (use type checking that works in browsers)
            if (e.touches && e.touches.length > 0) {
              // For touch events, use the first touch point
              const touch = e.touches[0] || e.changedTouches?.[0];
              if (touch) {
                return {
                  x: touch.clientX - rect.left,
                  y: touch.clientY - rect.top
                };
              }
            } else if (e.clientX !== undefined && e.clientY !== undefined) {
              // Mouse event
              return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
              };
            } else if (e.changedTouches && e.changedTouches.length > 0) {
              // Handle touchend/touchcancel events
              const touch = e.changedTouches[0];
              return {
                x: touch.clientX - rect.left,
                y: touch.clientY - rect.top
              };
            }
            return { x: 0, y: 0 };
          };

          const startDrawing = (e: any) => {
            e.preventDefault();
            isDrawing = true;
            const point = getPoint(e);
            lastX = point.x;
            lastY = point.y;
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
          };

          const draw = (e: any) => {
            if (!isDrawing) return;
            e.preventDefault();
            e.stopPropagation(); // Prevent scrolling on mobile
            const point = getPoint(e);
            if (point.x > 0 || point.y > 0) { // Only draw if we have valid coordinates
              ctx.beginPath();
              ctx.moveTo(lastX, lastY);
              ctx.lineTo(point.x, point.y);
              ctx.stroke();
              lastX = point.x;
              lastY = point.y;
            }
          };

          const stopDrawing = (e: any) => {
            e.preventDefault();
            if (isDrawing) {
              isDrawing = false;
            }
          };

          canvas.addEventListener('mousedown', startDrawing, { passive: false });
          canvas.addEventListener('mousemove', draw, { passive: false });
          canvas.addEventListener('mouseup', stopDrawing, { passive: false });
          canvas.addEventListener('mouseleave', stopDrawing, { passive: false });
          canvas.addEventListener('touchstart', startDrawing, { passive: false });
          canvas.addEventListener('touchmove', draw, { passive: false });
          canvas.addEventListener('touchend', stopDrawing, { passive: false });
          canvas.addEventListener('touchcancel', stopDrawing, { passive: false });

          // Store canvas reference for later use
          (signaturePads.current as any)[id] = { canvas, ctx };
        }, 50);
      });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [contract, isSubmitted, isAlreadySigned]);

  // Function to render contract content with interactive fields
  const renderContractContent = (htmlContent: string, isReadOnly: boolean = false) => {
    if (!htmlContent) return null;
    
    // For signed contracts, first process any base64 signature data
    if (isReadOnly) {
      // Handle base64 signature data (data:image/png;base64,...)
      // We'll process this with context awareness for RTL alignment
      htmlContent = htmlContent.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, (match, offset, string) => {
        // Check if this signature is in a right-aligned context by looking at surrounding HTML
        const beforeMatch = string.substring(Math.max(0, offset - 200), offset);
        const isInRightAlignedContext = /ql-align-right|ql-direction-rtl/.test(beforeMatch);
        const alignmentStyle = isInRightAlignedContext ? 'text-align: right; direction: rtl;' : '';
        return `<img src="${match}" style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px; margin: 0 4px; background-color: #f0fdf4; max-width: 200px; max-height: 80px; object-fit: contain; ${alignmentStyle}" alt="Signature" />`;
      });
      
      // For read-only mode, just render the HTML as-is (for signed contracts)
      return (
        <div 
          className="contract-content"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      );
    }
    
    // For editable mode, process the HTML to replace placeholders with inputs
    const processedHtml = processHtmlForEditing(htmlContent);
    
    return (
      <div 
        className="contract-content"
        dangerouslySetInnerHTML={{ __html: processedHtml }}
      />
    );
  };

  const handleSubmit = async () => {
    if (!contract) return;

    setIsSubmitting(true);
    try {
      // CRITICAL: Start with the ORIGINAL contract_html which still contains {{text}} placeholders
      // We'll replace these placeholders with the actual values from the DOM inputs
      const originalHtml = contract.contract_html || '';

      // Get values from all text input fields in the DOM (ordered by appearance)
      // Use a more specific selector and ensure we're getting from the right container
      const contractContentEl = document.querySelector('.contract-content');
      if (!contractContentEl) {
        toast.error('Could not find contract content');
        setIsSubmitting(false);
        return;
      }

      const inputFields = contractContentEl.querySelectorAll('.inline-input');
      console.log('🔍 Found input fields in DOM:', inputFields.length);
      const inputValues: string[] = [];
      inputFields.forEach((input, index) => {
        const htmlInput = input as HTMLInputElement;
        const value = htmlInput.value.trim();
        console.log(`🔍 Input ${index} value: "${value}"`);
        // Store the actual value entered by the user (or empty string, not the placeholder)
        inputValues.push(value || '_____________');
      });

      // The original HTML contains _____________ lines, not {{text}} placeholders
      // We need to convert these lines to placeholders first (same logic as processHtmlForEditing),
      // then replace placeholders with actual input values
      
      // Step 1: Convert _____________ lines back to {{text}} placeholders
      // (This matches the logic in processHtmlForEditing)
      let processedHtml = originalHtml;
      
      // Convert lines in styled spans back to placeholders
      processedHtml = processedHtml.replace(/<span[^>]*style="[^"]*border[^"]*"[^>]*>_____________<\/span>/gi, '{{text}}');
      
      // Convert plain lines that appear after colons or other text (common pattern: ": _____________")
      processedHtml = processedHtml.replace(/([:\s>])(_____________)([\s<])/g, '$1{{text}}$3');
      
      // Handle lines that might be inside paragraph tags directly: <p>_____________</p>
      processedHtml = processedHtml.replace(/(<p[^>]*>)([^<]*)_____________([^<]*)(<\/p>)/g, '$1$2{{text}}$3$4');
      
      // Also handle lines that appear as standalone text nodes between tags
      processedHtml = processedHtml.replace(/(>)([^<]*?)_____________([^<]*?)(<)/g, '$1$2{{text}}$3$4');
      
      // Catch any remaining lines that weren't matched by the above patterns
      const remainingLines = (processedHtml.match(/_____________/g) || []).length;
      if (remainingLines > 0) {
        console.log(`🔍 Converting ${remainingLines} remaining lines to {{text}} placeholders`);
        processedHtml = processedHtml.replace(/_____________/g, '{{text}}');
      }
      
      const placeholderCount = (processedHtml.match(/\{\{text\}\}/g) || []).length;
      console.log(`🔍 Converted lines to ${placeholderCount} {{text}} placeholders`);
      console.log(`🔍 Have ${inputValues.length} input values to use`);
      
      // Step 2: Replace {{text}} placeholders with actual input values
      let textPlaceholderIndex = 0;
      let htmlContent = processedHtml.replace(/\{\{text\}\}/g, () => {
        if (textPlaceholderIndex >= inputValues.length) {
          console.warn(`⚠️ More {{text}} placeholders than text inputs! Placeholder ${textPlaceholderIndex} will use default`);
          textPlaceholderIndex++;
          return '_____________';
        }
        const value = inputValues[textPlaceholderIndex];
        console.log(`🔍 Replacing {{text}} placeholder ${textPlaceholderIndex} with: "${value}"`);
        textPlaceholderIndex++;
        return value; // This is the actual user input value
      });
      
      console.log(`🔍 Replaced ${textPlaceholderIndex} {{text}} placeholders with text values`);
      console.log('🔍 HTML content after text replacement (first 500 chars):', htmlContent.substring(0, 500));

      // Get signature data from canvas elements (ordered by appearance)
      const signatureContainers = document.querySelectorAll('.contract-content .signature-pad-container');
      const signatureValues: string[] = [];
      signatureContainers.forEach((container) => {
        const canvas = container.querySelector('canvas');
        if (canvas) {
          const dataUrl = canvas.toDataURL('image/png');
          // Check if canvas has content (check for any non-transparent pixels)
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hasContent = imageData.data.some((channel, index) => {
              // Check alpha channel (every 4th value, starting at index 3)
              return index % 4 === 3 && channel > 0;
            });
            signatureValues.push(hasContent ? dataUrl : '_____________');
          } else {
            signatureValues.push('_____________');
          }
        } else {
          signatureValues.push('_____________');
        }
      });

      // Replace {{sig}} placeholders in order with signature data
      let sigPlaceholderIndex = 0;
      htmlContent = htmlContent.replace(/\{\{sig\}\}/g, () => {
        const value = signatureValues[sigPlaceholderIndex] || '_____________';
        sigPlaceholderIndex++;
        return value;
      });

      // Update the signed_contract_html in lead_leadcontact table
      // Convert contractId to number for consistency with the fetch query
      const contractIdNum = parseInt(contractId || '', 10);
      if (isNaN(contractIdNum)) {
        toast.error('Invalid contract ID');
        setIsSubmitting(false);
        return;
      }
      
      // First, get the lead_id from the contract
      const { data: contractData, error: contractFetchError } = await supabase
        .from('lead_leadcontact')
        .select('lead_id')
        .eq('id', contractIdNum)
        .eq('public_token', token!)
        .single();

      if (contractFetchError || !contractData) {
        console.error('Error fetching contract data:', contractFetchError);
        toast.error('Failed to fetch contract data');
        setIsSubmitting(false);
        return;
      }

      const leadId = contractData.lead_id;
      if (!leadId) {
        console.error('No lead_id found in contract');
        toast.error('Contract is not associated with a lead');
        setIsSubmitting(false);
        return;
      }

      // Update the signed contract HTML
      const { error } = await supabase
        .from('lead_leadcontact')
        .update({ signed_contract_html: htmlContent })
        .eq('id', contractIdNum)
        .eq('public_token', token!);

      if (error) {
        console.error('Error saving signed contract:', error);
        toast.error('Failed to save contract');
        setIsSubmitting(false);
        return;
      }

      // Fetch the lead data for stage update
      const { data: leadData, error: leadFetchError } = await supabase
        .from('leads_lead')
        .select('*')
        .eq('id', leadId)
        .single();

      if (leadFetchError) {
        console.error('Error fetching lead for stage update:', leadFetchError);
      } else if (leadData) {
        // Update lead stage to 60 (Client signed agreement)
        try {
          await updateLeadStageWithHistory({
            lead: { ...leadData, id: `legacy_${leadId}`, lead_type: 'legacy' } as any,
            stage: 60,
            additionalFields: {},
          });
          console.log('✅ Lead stage updated to 60 (Client signed agreement)');
        } catch (stageError) {
          console.error('Error updating lead stage:', stageError);
          // Don't fail the entire operation if stage update fails
        }
      }

      // Show success popup/modal
      toast.success('Contract signed successfully! The contract has been saved and the lead has been updated.', {
        duration: 6000,
        icon: '✅',
        style: {
          fontSize: '16px',
          padding: '16px',
        },
      });
      
      // Mark as submitted and update contract data
      setIsSubmitted(true);
      setContract((prev: any) => ({
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
              .contract-content {
                font-family: inherit;
                line-height: 1.75;
              }
              /* Auto-detect and right-align Hebrew text */
              .contract-content p,
              .contract-content h1,
              .contract-content h2,
              .contract-content h3,
              .contract-content h4,
              .contract-content h5,
              .contract-content h6,
              .contract-content div,
              .contract-content li,
              .contract-content span {
                unicode-bidi: plaintext;
                text-align: right !important;
                direction: rtl !important;
              }
              /* RTL support for Hebrew text - explicit classes */
              .contract-content .ql-align-right,
              .contract-content .ql-direction-rtl,
              .contract-content p.ql-align-right {
                text-align: right !important;
                direction: rtl !important;
              }
              .contract-content .ql-align-justify {
                text-align: justify !important;
              }
              .contract-content .ql-align-center {
                text-align: center !important;
              }
              .contract-content .ql-align-left {
                text-align: left !important;
              }
              /* Input fields styling */
              .contract-content .inline-input {
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
              /* Signature pad placeholder and container */
              .contract-content .signature-pad-placeholder {
                display: inline-block !important;
                vertical-align: middle !important;
                border: 2px dashed #3b82f6 !important;
                border-radius: 6px !important;
                padding: 12px !important;
                margin: 0 4px !important;
                width: 100% !important;
                max-width: 200px !important;
                min-width: 150px !important;
                min-height: 50px !important;
                background: #f8fafc !important;
                cursor: pointer !important;
                text-align: center !important;
                font-size: 14px !important;
                color: #6b7280 !important;
                font-weight: 500 !important;
              }
              .contract-content .signature-pad-container {
                display: inline-block !important;
                vertical-align: middle !important;
                margin: 0 4px !important;
                width: 100% !important;
                max-width: 200px !important;
                min-width: 150px !important;
              }
              /* Mobile responsive adjustments */
              @media (max-width: 640px) {
                .contract-content {
                  font-size: 0.875rem !important; /* 14px */
                  line-height: 1.6 !important;
                }
                .contract-content p,
                .contract-content li,
                .contract-content span {
                  font-size: 0.875rem !important; /* 14px */
                }
                .contract-content h1 {
                  font-size: 1.5rem !important; /* 24px */
                }
                .contract-content h2 {
                  font-size: 1.25rem !important; /* 20px */
                }
                .contract-content h3 {
                  font-size: 1.125rem !important; /* 18px */
                }
                .contract-content h4,
                .contract-content h5,
                .contract-content h6 {
                  font-size: 1rem !important; /* 16px */
                }
                .contract-content .inline-input {
                  font-size: 0.8125rem !important; /* 13px */
                  padding: 3px 6px !important;
                  min-width: 120px !important;
                }
                .contract-content .signature-pad-placeholder,
                .contract-content .signature-pad-container {
                  max-width: 100% !important;
                  min-width: 120px !important;
                  font-size: 0.75rem !important; /* 12px */
                }
                .contract-content .signature-pad-container button {
                  font-size: 0.6875rem !important; /* 11px */
                  padding: 2px 6px !important;
                }
              }
              .contract-content .signature-pad-container button {
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
              .contract-content .signature-pad-container button:hover {
                background: #ef4444 !important;
                color: white !important;
              }
              /* Right-align signatures in right-aligned paragraphs - use more specific selectors */
              .contract-content p.ql-align-right .signature-pad-placeholder,
              .contract-content p.ql-align-right .signature-pad-container,
              .contract-content p.ql-align-right img[alt="Signature"],
              .contract-content .ql-align-right .signature-pad-placeholder,
              .contract-content .ql-align-right .signature-pad-container,
              .contract-content .ql-align-right img[alt="Signature"],
              .contract-content .ql-direction-rtl .signature-pad-placeholder,
              .contract-content .ql-direction-rtl .signature-pad-container,
              .contract-content .ql-direction-rtl img[alt="Signature"] {
                text-align: right !important;
                display: inline-block !important;
                direction: rtl !important;
                float: none !important;
              }
              /* Ensure signature images in right-aligned contexts are right-aligned */
              .contract-content p.ql-align-right img[alt="Signature"],
              .contract-content .ql-align-right img[alt="Signature"],
              .contract-content .ql-direction-rtl img[alt="Signature"] {
                display: inline-block !important;
                text-align: right !important;
                direction: rtl !important;
              }
              /* Right-align the parent paragraph content when it contains signatures */
              .contract-content p.ql-align-right,
              .contract-content .ql-align-right {
                text-align: right !important;
                direction: rtl !important;
              }
              /* Make sure all inline elements in RTL paragraphs align right */
              .contract-content p.ql-align-right *,
              .contract-content .ql-align-right * {
                text-align: inherit !important;
                direction: inherit !important;
              }
              /* Override for signature elements specifically */
              .contract-content p.ql-align-right .signature-pad-placeholder,
              .contract-content p.ql-align-right .signature-pad-container,
              .contract-content p.ql-align-right img[alt="Signature"],
              .contract-content .ql-align-right .signature-pad-placeholder,
              .contract-content .ql-align-right .signature-pad-container,
              .contract-content .ql-align-right img[alt="Signature"] {
                text-align: right !important;
                direction: rtl !important;
              }
              /* General paragraph styling */
              .contract-content p {
                margin-bottom: 1em;
              }
              /* Text formatting - preserve bold and other formatting */
              .contract-content strong,
              .contract-content b {
                font-weight: 700 !important;
              }
              .contract-content em,
              .contract-content i {
                font-style: italic !important;
              }
              .contract-content u {
                text-decoration: underline !important;
              }
              .contract-content s,
              .contract-content strike {
                text-decoration: line-through !important;
              }
              /* Ensure formatting is preserved in all contexts */
              .contract-content p strong,
              .contract-content p b,
              .contract-content .ql-align-right strong,
              .contract-content .ql-align-right b,
              .contract-content .ql-direction-rtl strong,
              .contract-content .ql-direction-rtl b {
                font-weight: 700 !important;
              }
              .contract-content p em,
              .contract-content p i,
              .contract-content .ql-align-right em,
              .contract-content .ql-align-right i,
              .contract-content .ql-direction-rtl em,
              .contract-content .ql-direction-rtl i {
                font-style: italic !important;
              }
            `}
          </style>
          
          <div className="prose prose-lg max-w-none contract-content" style={{ minHeight: '400px' }}>
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
