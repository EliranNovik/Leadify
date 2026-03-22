import React, { useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import SignatureCanvas from 'react-signature-canvas';
import { ShareIcon } from '@heroicons/react/24/outline';

type InlineSignatureFieldProps = {
  index: number;
  registerPad: (idx: number, pad: SignatureCanvas | null) => void;
};

/** Same stamp asset as PublicContractView (public folder). */
const CONTRACT_STAMP_SRC = '/חתימה מסמכים (5).png';

/** Real signature pad (react-signature-canvas) for public legacy contract — not a click-to-sign placeholder. */
const InlineSignatureField: React.FC<InlineSignatureFieldProps> = ({ index, registerPad }) => {
  const padRef = useRef<SignatureCanvas | null>(null);
  return (
    <span
      className="inline-flex items-start gap-2 md:gap-4 flex-wrap my-1"
      style={{ display: 'inline-flex', verticalAlign: 'middle', maxWidth: '100%' }}
    >
      <div className="inline-flex flex-col align-middle gap-1 max-w-[min(100%,300px)] flex-shrink-0">
        <SignatureCanvas
          ref={(instance) => {
            padRef.current = instance;
            registerPad(index, instance);
          }}
          penColor="#1e3a8a"
          canvasProps={{
            width: 300,
            height: 120,
            className: 'rounded-md border-2 border-dashed border-blue-500 bg-slate-50 touch-none',
            style: { width: '100%', maxWidth: 300, height: 120, touchAction: 'none' },
          }}
          backgroundColor="rgba(255,255,255,0)"
        />
        <button
          type="button"
          className="self-start text-xs text-red-600 border border-red-400 rounded px-2 py-0.5 bg-white hover:bg-red-50"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            padRef.current?.clear();
          }}
        >
          Clear
        </button>
      </div>
      {/* Stamp image — same route as PublicContractView */}
      <div className="flex-shrink-0 max-w-full flex items-center min-h-[96px] md:min-h-[160px]">
        <img
          src={CONTRACT_STAMP_SRC}
          alt="Stamp"
          width={160}
          height={160}
          decoding="async"
          loading="eager"
          className="h-24 md:h-40 w-auto max-w-[min(100vw,200px)] object-contain"
          style={{ display: 'block', objectFit: 'contain' }}
        />
      </div>
    </span>
  );
};

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
  const [leadNumber, setLeadNumber] = useState<string | null>(null);
  /** One entry per {{sig}} field, in document order (for submit). */
  const signaturePadListRef = useRef<(SignatureCanvas | null)[]>([]);
  const signatureFieldRootsRef = useRef<Root[]>([]);
  /** Host for legacy HTML (inner div with dangerouslySetInnerHTML) — scope signature mounts & avoid wrong .contract-content on refresh. */
  const legacyContractHtmlHostRef = useRef<HTMLDivElement | null>(null);

  const registerSignaturePad = useCallback((idx: number, pad: SignatureCanvas | null) => {
    signaturePadListRef.current[idx] = pad;
  }, []);

  const teardownSignatureRoots = useCallback(() => {
    signatureFieldRootsRef.current.forEach((r) => {
      try {
        r.unmount();
      } catch {
        /* ignore */
      }
    });
    signatureFieldRootsRef.current = [];
    signaturePadListRef.current = [];
  }, []);

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
        
        // Fetch lead number from leads_lead table
        if (data.lead_id) {
          try {
            const { data: leadData, error: leadError } = await supabase
              .from('leads_lead')
              .select('id, lead_number, manual_id, master_id')
              .eq('id', data.lead_id)
              .single();
            
            if (!leadError && leadData) {
              // Format lead number: use lead_number, then manual_id, then id
              // If it's a sublead (has master_id), format as master_id/suffix
              let formattedLeadNumber: string;
              if (leadData.master_id) {
                // It's a sublead - we'd need to calculate suffix, but for now just show master_id
                formattedLeadNumber = `${leadData.master_id}/?`;
              } else {
                formattedLeadNumber = String(leadData.lead_number || leadData.manual_id || leadData.id);
              }
              setLeadNumber(formattedLeadNumber);
            }
          } catch (leadFetchError) {
            console.error('Error fetching lead number:', leadFetchError);
            // Don't fail the entire page if we can't fetch lead number
          }
        }
        
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

  // Helper function to process signed contract HTML for display (replaces placeholders with filled values)
  const processSignedContractHtml = (html: string, signedDate?: string): string => {
    if (!html) return '';

    let processed = html;

    // STEP 1: Extract ALL base64 signature data first (before any cleanup)
    const base64Matches: string[] = [];
    const base64Regex = /data:image\/png;base64,[A-Za-z0-9+/=]+/gi;
    let match;
    while ((match = base64Regex.exec(html)) !== null) {
      if (!base64Matches.includes(match[0])) {
        base64Matches.push(match[0]);
      }
    }

    // STEP 2: Remove ALL img tags completely (including broken ones)
    // This handles both properly formed and broken img tags
    processed = processed.replace(/<img[^>]*>/gi, '');
    // Also remove any broken img tag fragments
    processed = processed.replace(/<img[^<]*/gi, '');
    processed = processed.replace(/img[^>]*>/gi, '');
    // Remove any orphaned attributes that might look like img tags
    processed = processed.replace(/src\s*=\s*["']data:image[^"']*["'][^>]*/gi, '');
    processed = processed.replace(/alt\s*=\s*["']Signature["'][^>]*/gi, '');
    processed = processed.replace(/class\s*=\s*["']user-input["'][^>]*/gi, '');

    // STEP 3: Insert proper img tags for each base64 signature found
    base64Matches.forEach((base64Data, index) => {
      // Check if this signature is in a right-aligned context by looking at surrounding HTML
      const sigIndex = processed.search(/חתימת|Signature|{{sig}}/i);
      const beforeMatch = sigIndex !== -1 ? processed.substring(Math.max(0, sigIndex - 200), sigIndex) : '';
      const isInRightAlignedContext = /ql-align-right|ql-direction-rtl|hebrew-text/.test(beforeMatch);
      const alignmentStyle = isInRightAlignedContext ? 'text-align: right; direction: rtl;' : 'text-align: left; direction: ltr;';
      
      const imgTag = `<img src="${base64Data}" style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px; margin: 0 4px; background-color: #f0fdf4; max-width: 200px; max-height: 80px; object-fit: contain; ${alignmentStyle}" alt="Signature" />`;

      // Priority 1: Replace {{sig}} placeholder (this is the correct location at the bottom)
      if (processed.includes('{{sig}}')) {
        processed = processed.replace('{{sig}}', imgTag);
      } else {
        // Priority 2: Look for "חתימת הלקוח" (Client Signature) - this should be at the bottom
        const clientSigIndex = processed.search(/חתימת\s+הלקוח|Client\s+Signature/i);
        if (clientSigIndex !== -1) {
          // Find the end of the paragraph/tag containing "חתימת הלקוח" and insert after it
          // Look for the closing tag after the signature text
          let insertPos = processed.indexOf('</p>', clientSigIndex);
          if (insertPos === -1) {
            insertPos = processed.indexOf('</div>', clientSigIndex);
          }
          if (insertPos === -1) {
            insertPos = processed.indexOf('>', clientSigIndex);
            if (insertPos !== -1) insertPos += 1;
          } else {
            insertPos += 4; // Move past </p> or </div>
          }
          
          if (insertPos === -1 || insertPos < clientSigIndex) {
            // Fallback: insert right after the signature text
            insertPos = clientSigIndex + 20; // Approximate length of "חתימת הלקוח"
          }
          
          processed = processed.substring(0, insertPos) + ' ' + imgTag + processed.substring(insertPos);
        } else {
          // Priority 3: Find the LAST occurrence of "חתימת" in the document (should be at bottom)
          let lastSigIndex = -1;
          let searchIndex = 0;
          while (true) {
            const found = processed.indexOf('חתימת', searchIndex);
            if (found === -1) break;
            lastSigIndex = found;
            searchIndex = found + 1;
          }
          
          if (lastSigIndex !== -1) {
            // Found last occurrence - insert after the paragraph containing it
            let insertPos = processed.indexOf('</p>', lastSigIndex);
            if (insertPos === -1) {
              insertPos = processed.indexOf('</div>', lastSigIndex);
            }
            if (insertPos === -1) {
              insertPos = processed.indexOf('>', lastSigIndex);
              if (insertPos !== -1) insertPos += 1;
            } else {
              insertPos += 4;
            }
            
            if (insertPos === -1 || insertPos < lastSigIndex) {
              insertPos = lastSigIndex + 10;
            }
            
            processed = processed.substring(0, insertPos) + ' ' + imgTag + processed.substring(insertPos);
          } else {
            // Last resort: append at the very end, before any closing tags
            // Find the last </p> or </div> and insert before it
            const lastP = processed.lastIndexOf('</p>');
            const lastDiv = processed.lastIndexOf('</div>');
            const lastTag = Math.max(lastP, lastDiv);
            
            if (lastTag !== -1) {
              processed = processed.substring(0, lastTag) + ' ' + imgTag + processed.substring(lastTag);
            } else {
              // No closing tags found, just append at the end
              processed += ' ' + imgTag;
            }
          }
        }
      }
    });

    // Replace {{date}} placeholders with the actual signed date (if available)
    if (signedDate) {
      const formattedDate = new Date(signedDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      processed = processed.replace(/\{\{date\}\}/g, `<span style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; background-color: #f0fdf4; color: #065f46; font-weight: bold;">${formattedDate}</span>`);
    } else {
      // If no date provided, show placeholder
      processed = processed.replace(/\{\{date\}\}/g, '<span style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; background-color: #f0fdf4; color: #065f46; font-weight: bold;">_____________</span>');
    }

    // Replace {{text}} placeholders with styled filled text
    processed = processed.replace(/\{\{text\}\}/g, '<span style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; background-color: #f0fdf4; color: #065f46; font-weight: bold;">_____________</span>');

    // Replace {{sig}} placeholders with signature image display (only if not already replaced by base64)
    processed = processed.replace(/\{\{sig\}\}/g, '<div style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px; margin: 0 4px; background-color: #f0fdf4; min-width: 200px; min-height: 80px; display: flex; align-items: center; justify-content: center;"><span style="color: #065f46; font-size: 12px;">✓ Signed</span></div>');

    return processed;
  };

  // Helper function to process HTML for editing with input fields
  const processHtmlForEditing = (html: string): string => {
    if (!html) return '';

    // Align with other templates that use {{signature}}
    let processed = html.replace(/\{\{signature\}\}/g, '{{sig}}');
    
    // First, convert any existing lines (_____________) back to placeholders
    // This handles cases where the contract was saved with lines instead of placeholders
    
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
        const order = sigCounter++;
        // Mount point for react-signature-canvas (filled in useEffect via createRoot)
        return `<div class="sig-inline-mount" data-sig-order="${order}" data-field-type="signature"></div>`;
      });
    
    return processed;
  };

  /** Memoize processed HTML so React does not constantly replace innerHTML and destroy mounted signature roots. */
  const editableContractHtml = useMemo(() => {
    if (!contract?.contract_html || isSubmitted || isAlreadySigned) return '';
    return processHtmlForEditing(contract.contract_html);
  }, [contract?.contract_html, isSubmitted, isAlreadySigned]);

  /**
   * Mount signature pads after the innerHTML host is in the DOM (useLayoutEffect + rAF + scoped ref).
   * Avoids refresh races from document.querySelector('.contract-content') and setTimeout(0) running before commit.
   */
  useLayoutEffect(() => {
    if (!editableContractHtml || isSubmitted || isAlreadySigned) {
      teardownSignatureRoots();
      return;
    }

    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 8;

    const tryMount = () => {
      if (cancelled) return;
      const host = legacyContractHtmlHostRef.current;
      if (!host || !host.isConnected) {
        if (attempt < maxAttempts) {
          attempt += 1;
          requestAnimationFrame(() => {
            if (!cancelled) tryMount();
          });
        }
        return;
      }

      const mounts = host.querySelectorAll('.sig-inline-mount');
      if (mounts.length === 0) {
        // innerHTML may not be parsed yet on hard refresh — retry
        if (attempt < maxAttempts) {
          attempt += 1;
          requestAnimationFrame(() => {
            if (!cancelled) tryMount();
          });
        }
        return;
      }

      teardownSignatureRoots();
      signaturePadListRef.current = new Array(mounts.length).fill(null);

      mounts.forEach((el, index) => {
        if (!(el instanceof HTMLElement) || !el.isConnected) return;
        try {
          const root = createRoot(el);
          signatureFieldRootsRef.current.push(root);
          root.render(
            <InlineSignatureField
              key={`legacy-sig-${contractId ?? 'c'}-${token ?? 't'}-${index}`}
              index={index}
              registerPad={registerSignaturePad}
            />
          );
        } catch (e) {
          console.warn('Legacy contract: signature mount failed', e);
        }
      });
    };

    // After paint, DOM from dangerouslySetInnerHTML is guaranteed for this frame
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        if (!cancelled) tryMount();
      });
    });

    const safetyTimer = window.setTimeout(() => {
      if (cancelled) return;
      if (signatureFieldRootsRef.current.length > 0) return;
      if (!editableContractHtml.includes('sig-inline-mount')) return;
      attempt = 0;
      tryMount();
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
      teardownSignatureRoots();
    };
  }, [
    editableContractHtml,
    isSubmitted,
    isAlreadySigned,
    registerSignaturePad,
    teardownSignatureRoots,
    contractId,
    token,
  ]);

  // Helper function to detect if text contains Hebrew characters
  const containsHebrew = (text: string): boolean => {
    return /[\u0590-\u05FF]/.test(text);
  };

  // Handle share functionality
  const handleShare = async () => {
    const url = window.location.href;
    
    // Check if Web Share API is available (mobile devices)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Contract Agreement',
          text: 'View this contract agreement',
          url: url,
        });
        toast.success('Contract link shared successfully');
      } catch (error: any) {
        // User cancelled or error occurred
        if (error.name !== 'AbortError') {
          console.error('Error sharing:', error);
          // Fallback to clipboard
          copyToClipboard(url);
        }
      }
    } else {
      // Fallback to clipboard for desktop
      copyToClipboard(url);
    }
  };

  // Copy URL to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Contract link copied to clipboard');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        toast.success('Contract link copied to clipboard');
      } catch (err) {
        console.error('Fallback copy failed:', err);
        toast.error('Failed to copy link');
      }
      document.body.removeChild(textArea);
    }
  };

  // Effect to process rendered HTML and apply appropriate direction/alignment
  useEffect(() => {
    if (!contract || loading) return;

    const contractContentEl =
      legacyContractHtmlHostRef.current ||
      document.querySelector('.legacy-contract-html-host') ||
      document.querySelector('.contract-wrapper .contract-content') ||
      document.querySelector('.contract-content');
    if (!contractContentEl) return;
    
    // Process all elements in the contract content
    const processElements = (container: Element) => {
      const allElements = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, li, span');
      
      allElements.forEach((el) => {
        // Skip if element already has explicit alignment classes
        if (el.classList.contains('ql-align-left') || 
            el.classList.contains('ql-align-right') || 
            el.classList.contains('ql-align-center') ||
            el.classList.contains('ql-direction-rtl')) {
          return;
        }
        
        // Get text content (excluding input fields and signatures)
        const text = Array.from(el.childNodes)
          .filter(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const elem = node as Element;
              return !elem.classList.contains('inline-input') && 
                     !elem.classList.contains('sig-inline-mount') &&
                     !elem.classList.contains('signature-pad-container') &&
                     elem.tagName !== 'INPUT' &&
                     elem.tagName !== 'CANVAS';
            }
            return node.nodeType === Node.TEXT_NODE;
          })
          .map(node => node.textContent || '')
          .join(' ')
          .trim();
        
        if (text) {
          if (containsHebrew(text)) {
            // Hebrew text - right align
            el.setAttribute('dir', 'rtl');
            el.classList.add('hebrew-text');
          } else {
            // English text - left align
            el.setAttribute('dir', 'ltr');
            el.classList.add('english-text');
          }
        }
      });
    };
    
    // Process after a short delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      processElements(contractContentEl);
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [contract, loading, isSubmitted, isAlreadySigned]);

  // Function to render contract content with interactive fields
  const renderContractContent = (htmlContent: string, isReadOnly: boolean = false) => {
    // For signed contracts, process the HTML to properly position signatures at the bottom
    if (isReadOnly) {
      if (!htmlContent) return null;
      const readHtml = processSignedContractHtml(htmlContent);
      return (
        <div className="contract-content" dangerouslySetInnerHTML={{ __html: readHtml }} />
      );
    }

    // Editable: memoized HTML keeps innerHTML stable so createRoot signature mounts survive re-renders
    const editHtml =
      editableContractHtml || (htmlContent ? processHtmlForEditing(htmlContent) : '');
    if (!editHtml) return null;
    return (
      <div
        ref={legacyContractHtmlHostRef}
        className="contract-content legacy-contract-html-host"
        dangerouslySetInnerHTML={{ __html: editHtml }}
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
      const contractContentEl =
        legacyContractHtmlHostRef.current ||
        document.querySelector('.legacy-contract-html-host') ||
        document.querySelector('.contract-wrapper .contract-content') ||
        document.querySelector('.contract-content');
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

      // Get signature data from react-signature-canvas (same order as {{sig}} placeholders)
      const signatureValues: string[] = signaturePadListRef.current.map((pad) => {
        if (!pad) return '_____________';
        try {
          if (typeof (pad as any).isEmpty === 'function' && (pad as any).isEmpty()) {
            return '_____________';
          }
          return pad.toDataURL('image/png');
        } catch {
          return '_____________';
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
        console.error('❌ Error fetching lead for stage update:', leadFetchError);
        toast.error('Contract saved, but failed to update lead stage. Please contact support.');
      } else if (leadData) {
        // For public contract signing, directly update the tables (RLS is disabled)
        console.log('📝 Public contract signing: Updating lead stage to 60 for lead:', leadId);
        
        const timestamp = new Date().toISOString();
        const stageId = 60; // Client signed agreement
        const numericLeadId = typeof leadId === 'number' ? leadId : parseInt(leadId, 10);
        
        // Step 1: Insert into leads_leadstage table
        const { error: stageInsertError } = await supabase
          .from('leads_leadstage')
          .insert({
            lead_id: numericLeadId,
            stage: stageId,
            date: timestamp,
            cdate: timestamp,
            udate: timestamp,
            creator_id: null, // No creator for public contract signing
          });
        
        if (stageInsertError) {
          console.error('❌ Failed to insert stage record:', stageInsertError);
          toast.error(`Contract saved, but failed to update stage history: ${stageInsertError.message || 'Database error'}. Please contact support.`);
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
          .eq('id', numericLeadId);
        
        if (leadUpdateError) {
          console.error('❌ Failed to update lead stage:', {
            error: leadUpdateError,
            code: leadUpdateError.code,
            message: leadUpdateError.message,
            leadId: leadId,
          });
          toast.error(`Contract saved, but failed to update lead stage: ${leadUpdateError.message || 'Database error'}. Please contact support.`);
        } else {
          console.log('✅ Lead stage 60 (Client signed agreement) successfully updated');
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
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6 print:hidden">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold text-gray-900">Contract Agreement</h1>
            <div className="flex items-center gap-4">
              {leadNumber && (
                <div className="text-right">
                  <span className="text-sm text-gray-500 font-medium">Case:</span>
                  <span className="ml-2 text-lg font-mono font-bold text-blue-600">#{leadNumber}</span>
                </div>
              )}
              {/* Share Button */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleShare}
                  className="btn btn-outline btn-sm gap-2 print:hidden"
                  title="Share Contract"
                >
                  <ShareIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Share</span>
                </button>
              </div>
            </div>
          </div>
          <p className="text-gray-600">
            {isSubmitted || isAlreadySigned 
              ? 'Contract has been signed and submitted successfully' 
              : 'Please review and fill in the required fields below'
            }
          </p>
        </div>

        {/* Thank You Message */}
        {(isSubmitted || isAlreadySigned) && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6 print:hidden">
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
        <div className="bg-white rounded-lg shadow-sm p-8 contract-wrapper">
          <style>
            {`
              .contract-content {
                font-family: inherit;
                line-height: 1.75;
              }
              /* Default: left-align for English text */
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
                text-align: left;
                direction: ltr;
              }
              /* Hebrew text - right-align */
              .contract-content .hebrew-text,
              .contract-content [dir="rtl"],
              .contract-content .ql-align-right,
              .contract-content .ql-direction-rtl,
              .contract-content p.ql-align-right {
                text-align: right !important;
                direction: rtl !important;
              }
              /* English text - left-align */
              .contract-content .english-text,
              .contract-content [dir="ltr"],
              .contract-content .ql-align-left {
                text-align: left !important;
                direction: ltr !important;
              }
              .contract-content .ql-align-justify {
                text-align: justify !important;
              }
              .contract-content .ql-align-center {
                text-align: center !important;
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
              /* react-signature-canvas mount (filled by createRoot) */
              .contract-content .sig-inline-mount {
                display: inline-block !important;
                vertical-align: middle !important;
                margin: 0 4px !important;
                max-width: 300px !important;
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
                .contract-content .sig-inline-mount,
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
              .contract-content p.ql-align-right .sig-inline-mount,
              .contract-content p.ql-align-right .signature-pad-container,
              .contract-content p.ql-align-right img[alt="Signature"],
              .contract-content .ql-align-right .sig-inline-mount,
              .contract-content .ql-align-right .signature-pad-container,
              .contract-content .ql-align-right img[alt="Signature"],
              .contract-content .ql-direction-rtl .sig-inline-mount,
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
              .contract-content p.ql-align-right .sig-inline-mount,
              .contract-content p.ql-align-right .signature-pad-container,
              .contract-content p.ql-align-right img[alt="Signature"],
              .contract-content .ql-align-right .sig-inline-mount,
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
              /* Print styles */
              @media print {
                * {
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
                html, body {
                  background: white !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  width: 100% !important;
                  height: auto !important;
                }
                /* Hide elements with print:hidden class */
                .print\\:hidden {
                  display: none !important;
                }
                /* Remove ALL backgrounds and padding from ALL containers */
                .min-h-screen,
                .bg-gray-50,
                .max-w-4xl,
                .mx-auto {
                  background: transparent !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  min-height: auto !important;
                  max-width: 100% !important;
                }
                /* Remove white background from contract wrapper - be very specific */
                .contract-wrapper,
                div.bg-white,
                .bg-white,
                .bg-white.rounded-lg,
                .bg-white.shadow-sm,
                .bg-white.p-8,
                div.bg-white.rounded-lg.shadow-sm.p-8 {
                  background: transparent !important;
                  background-color: transparent !important;
                  box-shadow: none !important;
                  border-radius: 0 !important;
                  padding: 0 !important;
                  margin: 0 !important;
                }
                .shadow-sm {
                  box-shadow: none !important;
                }
                .rounded-lg {
                  border-radius: 0 !important;
                }
                /* Remove padding from all p-* classes */
                [class*="p-"] {
                  padding: 0 !important;
                }
                [class*="px-"] {
                  padding-left: 0 !important;
                  padding-right: 0 !important;
                }
                [class*="py-"] {
                  padding-top: 0 !important;
                  padding-bottom: 0 !important;
                }
                /* Remove margin from all m-* classes except contract content */
                [class*="m-"]:not(.contract-content):not(.contract-content *) {
                  margin: 0 !important;
                }
                [class*="mb-"]:not(.contract-content):not(.contract-content *) {
                  margin-bottom: 0 !important;
                }
                [class*="mt-"]:not(.contract-content):not(.contract-content *) {
                  margin-top: 0 !important;
                }
                /* Ensure contract content is visible and properly formatted */
                .contract-content {
                  page-break-inside: avoid;
                  background: white !important;
                  color: black !important;
                  padding: 20px !important;
                  margin: 0 !important;
                  display: block !important;
                  width: 100% !important;
                }
                .contract-content p {
                  page-break-inside: avoid;
                }
                /* Ensure all text is visible */
                .contract-content * {
                  color: black !important;
                }
                /* Hide prose class padding if present, but keep content visible */
                .prose {
                  padding: 0 !important;
                  margin: 0 !important;
                  max-width: 100% !important;
                }
                .prose.prose-lg {
                  font-size: inherit !important;
                }
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
          <div className="mt-6 text-center print:hidden">
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

      {/* Footer — same as PublicContractView */}
      <footer className="bg-white border-t border-gray-200 mt-8 md:mt-24 print:hidden">
        <div className="max-w-5xl mx-auto px-4 py-8 md:py-20 md:px-8">
          <div className="flex flex-col items-center justify-center gap-4 md:gap-8">
            <div className="text-center space-y-2 md:space-y-3">
              <div className="flex items-center justify-center gap-3">
                <img src="/DPL-LOGO1.png" alt="DPL Logo" className="h-12 w-auto object-contain" />
                <p className="font-bold text-xl text-gray-900">Decker, Pex, Levi Law Offices</p>
              </div>
              <div className="text-gray-500 text-sm flex flex-col md:flex-row items-center justify-center gap-1 md:gap-3">
                <p>Yad Harutzim 10, Jerusalem, Israel</p>
                <span className="hidden md:inline text-gray-400">•</span>
                <p>Menachem Begin Rd. 150, Tel Aviv, Israel</p>
              </div>
            </div>
          </div>

          <div className="mt-6 md:mt-12 pt-4 md:pt-8 border-t border-gray-100 text-center text-xs text-gray-400">
            RMQ 2.0 - Copyright © {new Date().getFullYear()} - All right reserved
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicLegacyContractView;
