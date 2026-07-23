import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SignaturePad from 'react-signature-canvas';
import { generateJSON } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { FontSize } from '@tiptap/extension-font-size';
import { PrinterIcon, ArrowDownTrayIcon, ShareIcon, PhoneIcon, ArrowDownIcon, EnvelopeIcon, DevicePhoneMobileIcon, ArrowsRightLeftIcon, XMarkIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { FaLinkedin, FaWhatsapp, FaEnvelope } from 'react-icons/fa';
import PublicNeedAssistanceWidget from '../components/public/PublicNeedAssistanceWidget';
import { OFFICE_EMAIL, OFFICE_PHONE_TEL, WHATSAPP_URL } from '../components/public/publicContactInfo';
import toast from 'react-hot-toast';
import { fetchEmployeeProfileById } from '../lib/fetchEmployeeProfile';
import {
  fetchRecruitmentUserById,
  recruitmentUserDisplayName,
} from '../lib/recruitmentDigitalContracts';
import { ensurePerEntityContractContentSnapshot } from '../lib/contractContentSnapshot';

function unwrapTemplateRelation(raw: any): any | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

/** Prefer per-contract body; fall back to template only when no instance content yet. */
function resolveContractBodyContent(contract: any, template: any): any {
  return contract?.custom_content || template?.content || null;
}

// Lazy load html2pdf only when needed (for PDF download)
let html2pdf: any = null;
const loadHtml2Pdf = async () => {
  if (!html2pdf) {
    // @ts-ignore - html2pdf.js doesn't have TypeScript definitions
    html2pdf = (await import('html2pdf.js')).default;
  }
  return html2pdf;
};

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

// Cache for normalized content to avoid reprocessing (using Map for object keys)
const normalizeCache = new Map<string | object, any>();

// Helper function to validate and normalize TipTap content (with caching)
function normalizeTiptapContent(content: any): any {
  if (!content) {
    return { type: 'doc', content: [] };
  }

  // Create cache key - use string for strings, object reference for objects
  const cacheKey = typeof content === 'string' ? content : content;

  // Check cache first (only for objects, strings are fast to process)
  if (typeof content === 'object' && normalizeCache.has(cacheKey)) {
    return normalizeCache.get(cacheKey);
  }

  let result: any;

  // If content is a string, try to parse it as JSON
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      content = parsed;
    } catch (e) {
      // Try to convert HTML string to TipTap JSON
      try {
        result = generateJSON(content, editorExtensionsForConversion);
        normalizeCache.set(cacheKey, result);
        return result;
      } catch (conversionError) {
        console.error('Failed to convert HTML string to TipTap JSON:', conversionError);
        result = { type: 'doc', content: [] };
        normalizeCache.set(cacheKey, result);
        return result;
      }
    }
  }

  // Check if content has html/delta properties (Quill format - convert HTML to TipTap JSON)
  if (content && typeof content === 'object' && ('html' in content || 'delta' in content)) {
    const htmlContent = content.html;

    if (htmlContent && typeof htmlContent === 'string') {
      try {
        result = generateJSON(htmlContent, editorExtensionsForConversion);
        normalizeCache.set(cacheKey, result);
        return result;
      } catch (conversionError) {
        console.error('Failed to convert HTML to TipTap JSON:', conversionError);
        result = { type: 'doc', content: [] };
        normalizeCache.set(cacheKey, result);
        return result;
      }
    } else {
      result = { type: 'doc', content: [] };
      normalizeCache.set(cacheKey, result);
      return result;
    }
  }

  // Check if content is a valid TipTap JSON structure
  if (content && typeof content === 'object' && content.type === 'doc') {
    if (Array.isArray(content.content)) {
      result = content;
    } else {
      result = { type: 'doc', content: content.content || [] };
    }
    normalizeCache.set(cacheKey, result);
    return result;
  }

  // If content is an object but not a valid TipTap doc, try to wrap it
  if (content && typeof content === 'object') {
    if (Array.isArray(content)) {
      result = { type: 'doc', content: content };
    } else if (content.type && content.content !== undefined) {
      result = { type: 'doc', content: [content] };
    } else if (content.content && Array.isArray(content.content)) {
      result = { type: 'doc', content: content.content };
    } else {
      result = { type: 'doc', content: [] };
    }
    normalizeCache.set(cacheKey, result);
    return result;
  }

  // Fallback: return empty doc
  result = { type: 'doc', content: [] };
  normalizeCache.set(cacheKey, result);
  return result;
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

function isRTL(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF]/;
  return rtlRegex.test(text);
}

function extractTextContent(content: any): string {
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
}

function getInputPlaceholder(fieldId: string, rtl: boolean, isApplicantField = false): string {
  if (isApplicantField) {
    return rtl ? 'הזן שם מועמד' : 'Enter applicant name';
  }

  const idLower = fieldId.toLowerCase();

  if (rtl) {
    if (idLower.includes('document') || idLower.startsWith('text:document')) return 'הזן שם מסמך';
    if (idLower.includes('country') || idLower.startsWith('text:country')) return 'הזן מדינה';
    if (idLower.includes('address') || idLower.startsWith('text:address')) return 'הזן כתובת';
    if (idLower.includes('city') || idLower.startsWith('text:city')) return 'הזן עיר';
    if (idLower.includes('postal') || idLower.startsWith('text:postal')) return 'הזן מיקוד';
    if (idLower.includes('notes') || idLower.startsWith('text:notes')) return 'הזן הערות';
    if (idLower.includes('reference') || idLower.startsWith('text:reference')) return 'הזן מספר אסמכתא';
    if (idLower.includes('phone') || idLower.startsWith('text:phone')) return 'הזן טלפון';
    if (idLower.includes('email') || idLower.startsWith('text:email')) return 'הזן דוא״ל';
    if (idLower.includes('id') || idLower.includes('document') || idLower.startsWith('text:id')) return 'הזן מספר';
    return 'הזן טקסט';
  }

  if (idLower.includes('applicant') || idLower.startsWith('text:applicant')) {
    return 'Enter applicant name';
  }
  if (idLower.includes('document') || idLower.startsWith('text:document')) return 'Enter document name';
  if (idLower.includes('country') || idLower.startsWith('text:country')) return 'Enter country';
  if (idLower.includes('address') || idLower.startsWith('text:address')) return 'Enter address';
  if (idLower.includes('city') || idLower.startsWith('text:city')) return 'Enter city';
  if (idLower.includes('postal') || idLower.startsWith('text:postal')) return 'Enter postal code';
  if (idLower.includes('notes') || idLower.startsWith('text:notes')) return 'Enter notes';
  if (idLower.includes('reference') || idLower.startsWith('text:reference')) return 'Enter reference number';
  if (idLower.includes('other') || idLower.startsWith('text:other')) return 'Enter text';
  return 'Enter text';
}

const PublicContractView: React.FC<{
  kioskMode?: boolean;
  contractIdOverride?: string;
  tokenOverride?: string;
  onKioskComplete?: () => void;
  employeeMode?: boolean;
  firmMode?: boolean;
  recruitmentMode?: boolean;
}> = ({
  kioskMode = false,
  contractIdOverride,
  tokenOverride,
  onKioskComplete,
  employeeMode = false,
  firmMode = false,
  recruitmentMode = false,
}) => {
  const { contractId: routeContractId, token: routeToken } = useParams();
  const contractId = contractIdOverride ?? routeContractId;
  const token = tokenOverride ?? routeToken;
  const isEmployeeContractMode =
    employeeMode ||
    (typeof window !== 'undefined' && window.location.pathname.includes('/public-hr-contract/'));
  const isFirmContractMode =
    firmMode ||
    (typeof window !== 'undefined' && window.location.pathname.includes('/public-firm-contract/'));
  const isRecruitmentContractMode =
    recruitmentMode ||
    (typeof window !== 'undefined' && window.location.pathname.includes('/public-recruitment-contract/'));
  const [contract, setContract] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [customPricing, setCustomPricing] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signaturePads, setSignaturePads] = useState<{ [key: string]: any }>({});
  const [signatureModalId, setSignatureModalId] = useState<string | null>(null);
  const modalSignaturePadRef = useRef<any>(null);
  const modalPadWrapRef = useRef<HTMLDivElement | null>(null);
  const [modalPadSize, setModalPadSize] = useState({ width: 720, height: 320 });
  // Add submit state and client field state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientFields, setClientFields] = useState<{ [key: string]: string }>({});
  const [clientSignature, setClientSignature] = useState<string | null>(null);
  const [thankYou, setThankYou] = useState(false);
  const [applicantFieldIds, setApplicantFieldIds] = useState<string[]>([]);
  const [activeApplicantFields, setActiveApplicantFields] = useState<string[]>([]); // Fields that are currently visible (can be added/removed)
  const [dynamicApplicantFieldCounter, setDynamicApplicantFieldCounter] = useState(0); // Counter for generating new field IDs
  const [leadNumber, setLeadNumber] = useState<string | null>(null);
  const [closerEmployee, setCloserEmployee] = useState<any>(null);
  const [showCloserModal, setShowCloserModal] = useState(false);
  const [isCardVisible, setIsCardVisible] = useState(false);

  // Trigger card visibility animation when modal opens
  useEffect(() => {
    if (showCloserModal) {
      const timer = setTimeout(() => {
        setIsCardVisible(true);
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setIsCardVisible(false);
    }
  }, [showCloserModal]);

  // Ref for contract content area (for PDF generation)
  const contractContentRef = useRef<HTMLDivElement>(null);

  const contractIsRTL = useMemo(() => {
    const content = resolveContractBodyContent(contract, template);
    return isRTL(extractTextContent(content));
  }, [contract?.custom_content, template?.content]);

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
        // Replace {{signature:ID}} fields with signature data (stored per-field id)
        text = text.replace(/\{\{signature:([^}]+)\}\}/g, (match: string, id: string) => {
          return clientFields[id] || '';
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

  const applySignatureFromModal = useCallback(() => {
    if (!signatureModalId) return;
    const pad = modalSignaturePadRef.current;
    if (!pad || pad.isEmpty()) {
      toast.error('Please draw your signature first');
      return;
    }

    let dataUrl = '';
    try {
      dataUrl = pad.getTrimmedCanvas().toDataURL('image/png');
    } catch {
      dataUrl = pad.toDataURL('image/png');
    }

    setClientSignature(dataUrl);
    setClientFields((prev) => ({ ...prev, [signatureModalId]: dataUrl }));

    const inlinePad = signaturePads[signatureModalId];
    if (inlinePad) {
      try {
        inlinePad.clear();
        inlinePad.fromDataURL(dataUrl);
      } catch {
        /* ignore canvas sync errors */
      }
    }

    setSignatureModalId(null);
    toast.success('Signature applied');
  }, [signatureModalId, signaturePads]);

  useEffect(() => {
    if (!signatureModalId) return;

    const el = modalPadWrapRef.current;
    const update = () => {
      const wrap = modalPadWrapRef.current;
      if (!wrap) return;
      const width = Math.max(280, Math.floor(wrap.clientWidth));
      const height = Math.min(420, Math.max(240, Math.round(width * 0.42)));
      setModalPadSize({ width, height });
    };

    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (el && ro) ro.observe(el);

    const existing = clientFields[signatureModalId];
    const timer = window.setTimeout(() => {
      const pad = modalSignaturePadRef.current;
      if (!pad) return;
      pad.clear();
      if (existing) {
        try {
          pad.fromDataURL(existing);
        } catch {
          /* ignore */
        }
      }
    }, 50);

    return () => {
      window.clearTimeout(timer);
      ro?.disconnect();
    };
  }, [signatureModalId, clientFields]);

  // Update meta tags for link preview
  useEffect(() => {
    if (!contract || !client) return;

    const clientName = contract?.contact_name || client?.name || 'Client';
    const contractTitle = `Contract for ${clientName} - Decker Pex Levi Law Offices`;
    const contractDescription = `Please review and sign your legal contract. This is a secure document from Decker Pex Levi Law Offices.`;
    const contractUrl = window.location.href;
    const siteUrl = 'https://rainmakerqueen.org';

    // Update or create meta tags
    const updateMetaTag = (property: string, content: string, isProperty = true) => {
      const attribute = isProperty ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attribute}="${property}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attribute, property);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

    // Open Graph tags
    updateMetaTag('og:title', contractTitle);
    updateMetaTag('og:description', contractDescription);
    updateMetaTag('og:url', contractUrl);
    updateMetaTag('og:type', 'website');
    updateMetaTag('og:site_name', 'Decker Pex Levi Law Offices');
    updateMetaTag('og:image', `${siteUrl}/RMQ_LOGO.png`);

    // Twitter Card tags
    updateMetaTag('twitter:card', 'summary', false);
    updateMetaTag('twitter:title', contractTitle, false);
    updateMetaTag('twitter:description', contractDescription, false);
    updateMetaTag('twitter:image', `${siteUrl}/RMQ_LOGO.png`, false);

    // Standard meta tags
    updateMetaTag('description', contractDescription, false);
    document.title = contractTitle;

    // Cleanup function
    return () => {
      // Optionally remove meta tags on unmount, but usually we want to keep them
    };
  }, [contract, client]);

  useEffect(() => {
    if (!contractId || !token) return;
    setLoading(true);
    (async () => {
      try {
        // STEP 1: Fetch contract and template in parallel (critical path)
        const contractPromise = supabase
          .from('contracts')
          .select(`*, contract_templates ( id, name, content )`)
          .eq('id', contractId)
          .eq('public_token', token)
          .single();

        const [contractResult] = await Promise.all([contractPromise]);
        const { data: contractData, error: contractError } = contractResult;

        if (contractError || !contractData) {
          setError('Invalid or expired contract link.');
          setLoading(false);
          return;
        }

        // Set contract and pricing immediately (allows early rendering)
        setContract(contractData);
        setCustomPricing(contractData.custom_pricing);

        // Load saved client inputs if contract was previously started
        if (contractData.client_inputs) {
          setClientFields(contractData.client_inputs);
        }

        // STEP 2: Fetch template - handle both new templates (contract_templates) and legacy templates (misc_contracttemplate)
        let templateData = unwrapTemplateRelation(contractData.contract_templates);

        // If no template from join, check if we need to fetch from misc_contracttemplate (legacy)
        let templatePromise: any = null;

        // If no template from join, check if we need to fetch from misc_contracttemplate (legacy)
        if (!templateData) {
          // First check if template_id is set and try fetching as legacy template
          if (contractData.template_id) {
            const isLegacyTemplate = !isNaN(Number(contractData.template_id)) || contractData.template_id.toString().startsWith('legacy_');

            if (isLegacyTemplate) {
              const templateId = contractData.template_id.toString().replace('legacy_', '');
              templatePromise = supabase
                .from('misc_contracttemplate')
                .select('*')
                .eq('id', templateId)
                .single();
            }
          }
          // If template_id is NULL, check for legacy_template_id in custom_pricing
          else if (contractData.custom_pricing?.legacy_template_id) {
            const legacyTemplateId = contractData.custom_pricing.legacy_template_id;
            templatePromise = supabase
              .from('misc_contracttemplate')
              .select('*')
              .eq('id', legacyTemplateId)
              .single();
          }
        }

        // Fetch template if needed
        if (templatePromise) {
          const { data: legacyTemplate, error: legacyTemplateError } = await templatePromise;
          if (!legacyTemplateError && legacyTemplate) {
            templateData = legacyTemplate;
          }
        }

        // Isolate per-entity drafts that still only pointed at the admin template.
        if (templateData?.content) {
          const snapshotted = await ensurePerEntityContractContentSnapshot({
            contract: contractData,
            templateContent: templateData.content,
          });
          if (snapshotted !== contractData) {
            Object.assign(contractData, snapshotted);
            setContract(snapshotted);
          }
        }

        // STEP 3: Start fetching client/employee/firm data in parallel (non-blocking)
        let clientDataPromise: any = null;
        let employeeDataPromise: Promise<any> | null = null;
        let firmDataPromise: any = null;
        if (contractData.employee_id || isEmployeeContractMode) {
          const empId = Number(contractData.employee_id);
          if (Number.isFinite(empId) && empId > 0) {
            employeeDataPromise = fetchEmployeeProfileById(empId);
          }
        } else if (contractData.user_id || isRecruitmentContractMode) {
          const uId = String(contractData.user_id || '');
          if (uId) {
            employeeDataPromise = fetchRecruitmentUserById(uId).then((profile) => {
              if (!profile) return null;
              return {
                id: profile.id,
                official_name: recruitmentUserDisplayName(profile),
                display_name: recruitmentUserDisplayName(profile),
                email: profile.email,
                phone: null,
                mobile: null,
                photo_url: null,
                department_name: null,
                __recruitment: true,
              };
            });
          }
        } else if (contractData.external_firm_id || isFirmContractMode) {
          const firmId = String(contractData.external_firm_id || '');
          if (firmId) {
            firmDataPromise = supabase
              .from('firms')
              .select('id, name, legal_name, profile_image_url')
              .eq('id', firmId)
              .maybeSingle();
          }
        } else if (contractData.legacy_id) {
          // Legacy lead - fetch from leads_lead table
          clientDataPromise = supabase
            .from('leads_lead')
            .select('id, lead_number, manual_id, master_id, name, email, phone, mobile')
            .eq('id', contractData.legacy_id)
            .single();
        } else if (contractData.client_id) {
          // New lead - fetch from leads table
          clientDataPromise = supabase
            .from('leads')
            .select('id, lead_number, name, email, phone, mobile, topic')
            .eq('id', contractData.client_id)
            .single();
        }

        // STEP 4: Process template (required for rendering, but keep it fast)
        if (templateData) {
          try {
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
          } catch (err) {
            console.error('Error processing template:', err);
            // Fallback to raw template if processing fails
            setTemplate(templateData);
          }
        } else {
          setError('Template not found for this contract.');
          setLoading(false);
          return;
        }

        // STEP 5: Process client/employee/firm data (non-blocking - can happen after initial render)
        if (employeeDataPromise) {
          employeeDataPromise
            .then((profile) => {
              if (!profile) return;
              const name = profile.official_name || profile.display_name || contractData.contact_name || 'Employee';
              const isRecruitment = Boolean(profile.__recruitment) || Boolean(contractData.user_id);
              setClient({
                id: isRecruitment ? `user_${profile.id}` : `employee_${profile.id}`,
                name,
                email: profile.email || contractData.contact_email || '',
                phone: profile.phone || profile.mobile || '',
                mobile: profile.mobile || '',
              });
              if (!contractData.contact_name) {
                setContract((prev: any) => (prev ? { ...prev, contact_name: name } : prev));
              }
            })
            .catch((err) => {
              console.error('Error fetching employee/user for public contract:', err);
              setClient({
                id: contractData.user_id
                  ? `user_${contractData.user_id}`
                  : `employee_${contractData.employee_id}`,
                name: contractData.contact_name || (contractData.user_id ? 'User' : 'Employee'),
                email: contractData.contact_email || '',
                phone: '',
                mobile: '',
              });
            });
        } else if (firmDataPromise) {
          firmDataPromise
            .then(({ data: firmData, error: firmErr }) => {
              if (firmErr) {
                console.error('Error fetching firm for public firm contract:', firmErr);
              }
              const name =
                firmData?.legal_name ||
                firmData?.name ||
                contractData.contact_name ||
                'External firm';
              setClient({
                id: firmData?.id ? `firm_${firmData.id}` : 'firm_unknown',
                name,
                email: contractData.contact_email || '',
                phone: '',
                mobile: '',
              });
              if (!contractData.contact_name) {
                setContract((prev: any) => (prev ? { ...prev, contact_name: name } : prev));
              }
            })
            .catch((err) => {
              console.error('Error fetching firm for public firm contract:', err);
              setClient({
                id: `firm_${contractData.external_firm_id}`,
                name: contractData.contact_name || 'External firm',
                email: contractData.contact_email || '',
                phone: '',
                mobile: '',
              });
            });
        } else if (clientDataPromise) {
          clientDataPromise.then(async (clientResult) => {
            const { data: clientData } = clientResult;

            if (clientData) {
              // Check if contact_name is missing or is a placeholder (like "Contact 1", "Contact 2", etc.)
              const contactName = contractData.contact_name?.trim() || '';
              const isPlaceholder = !contactName || 
                /^contact\s*\d+$/i.test(contactName) || 
                contactName.toLowerCase().startsWith('contact ');

              // If contact_name is missing or is a placeholder, try to fetch the actual contact name
              if (isPlaceholder && contractData.contact_id && contractData.client_id) {
                try {
                  // Fetch the contact from leads_contact table
                  const { data: contactData } = await supabase
                    .from('leads_contact')
                    .select('name')
                    .eq('id', contractData.contact_id)
                    .eq('newlead_id', contractData.client_id)
                    .maybeSingle();

                  if (contactData?.name && contactData.name.trim() !== '') {
                    // Update contract with the fetched contact name
                    setContract((prev: any) => prev ? { ...prev, contact_name: contactData.name.trim() } : prev);
                  } else {
                    // If contact not found, fall back to main contact (client name)
                    // This handles the case where contact_id doesn't match any contact
                    if (clientData.name && clientData.name.trim() !== '') {
                      setContract((prev: any) => prev ? { ...prev, contact_name: clientData.name.trim() } : prev);
                    }
                  }
                } catch (err) {
                  console.error('Error fetching contact name:', err);
                  // Fall back to client name if fetch fails
                  if (clientData.name && clientData.name.trim() !== '') {
                    setContract((prev: any) => prev ? { ...prev, contact_name: clientData.name.trim() } : prev);
                  }
                }
              } else if (isPlaceholder && clientData.name && clientData.name.trim() !== '') {
                // If no contact_id but we have client name, use it as fallback
                setContract((prev: any) => prev ? { ...prev, contact_name: clientData.name.trim() } : prev);
              }

              if (contractData.legacy_id) {
                // Legacy lead processing
                setClient({
                  id: clientData.id,
                  name: clientData.name,
                  email: clientData.email,
                  phone: clientData.phone,
                  mobile: clientData.mobile
                });

                // Format lead number: handle subleads (master_id/suffix) or master leads
                let formattedLeadNumber: string;
                const masterId = clientData.master_id;

                if (masterId && String(masterId).trim() !== '') {
                  // It's a sub-lead - calculate suffix from all subleads with same master_id
                  // Defer this query as it's not critical for initial render
                  setTimeout(async () => {
                    const { data: allSubLeads } = await supabase
                      .from('leads_lead')
                      .select('id')
                      .eq('master_id', masterId)
                      .not('master_id', 'is', null)
                      .order('id', { ascending: true });

                    if (allSubLeads && allSubLeads.length > 0) {
                      const suffix = allSubLeads.findIndex(subLead => subLead.id === clientData.id) + 2;
                      setLeadNumber(`${masterId}/${suffix}`);
                    } else {
                      setLeadNumber(`${masterId}/?`);
                    }
                  }, 100);
                } else {
                  // It's a master lead - use lead_number, then manual_id, then id
                  formattedLeadNumber = clientData.lead_number
                    ? String(clientData.lead_number)
                    : (clientData.manual_id
                      ? String(clientData.manual_id)
                      : String(clientData.id));
                  setLeadNumber(formattedLeadNumber);
                }
              } else {
                // New lead processing
                setClient(clientData);
                // Format lead number: use lead_number with L prefix if it doesn't have it
                const formattedLeadNumber = clientData.lead_number
                  ? (clientData.lead_number.startsWith('L') ? clientData.lead_number : `L${clientData.lead_number}`)
                  : null;
                setLeadNumber(formattedLeadNumber);
              }

              // Fetch closer employee
              fetchCloserEmployee(clientData, contractData.legacy_id ? 'legacy' : 'new');
            }
          }).catch(err => {
            console.error('Error fetching client data:', err);
            // Don't block rendering if client fetch fails
          });
        } else {
          // No client data to fetch, we're done
        }

        // Mark loading as complete - content can now render
        setLoading(false);
      } catch (err) {
        console.error('Error loading contract:', err);
        setError('Failed to load contract. Please try again.');
        setLoading(false);
      }
    })();
  }, [contractId, token]);


  // Track applicant fields for UI purposes only (defer to avoid blocking initial render)
  useEffect(() => {
    if (!template?.content || contract?.status === 'signed') return;

    // Defer applicant field detection to avoid blocking initial render
    const detectApplicantFields = () => {
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
    };

    // Defer applicant field detection to avoid blocking initial render
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(detectApplicantFields, { timeout: 500 });
    } else {
      setTimeout(detectApplicantFields, 100);
    }
  }, [template, contract?.status]);

  // Add a handler for submitting the contract (signing)
  const handleSubmitContract = async () => {
    if (!contract) return;

    setIsSubmitting(true);
    try {
      // Validate required placeholders BEFORE signing the contract.
      // Otherwise we can end up with status='signed' while date/signature fields are empty.
      const sourceContent = resolveContractBodyContent(contract, template);
      // Normalize TipTap shape + placeholders so both `{{date}}` and `{{date:...}}` are treated consistently.
      // Use the same preprocessing approach as the main render path to avoid ID mismatches.
      const normalizedForValidation = sourceContent ? normalizeTiptapContent(sourceContent) : null;
      const contentForValidation =
        normalizedForValidation && normalizedForValidation.type === 'doc'
          ? preprocessTemplatePlaceholders(normalizedForValidation)
          : normalizedForValidation;
      const contentStr = contentForValidation ? JSON.stringify(contentForValidation) : '';
      const signatureIds = Array.from(contentStr.matchAll(/\{\{signature:([^}]+)\}\}/g)).map((m) => m[1]);
      const dateIds = Array.from(contentStr.matchAll(/\{\{date:([^}]+)\}\}/g)).map((m) => m[1]);

      const missingSignatureIds = signatureIds.filter((id) => {
        const v = clientFields?.[id];
        return !(typeof v === 'string' && v.startsWith('data:image/'));
      });
      const missingDateIds = dateIds.filter((id) => {
        const v = clientFields?.[id];
        return !(typeof v === 'string' && v.trim().length > 0);
      });

      if (missingSignatureIds.length > 0 || missingDateIds.length > 0) {
        const parts: string[] = [];
        if (missingDateIds.length > 0) parts.push('date');
        if (missingSignatureIds.length > 0) parts.push('signature');
        alert(`Please add your ${parts.join(' and ')} before submitting the contract.`);
        return;
      }

      // Fill in client fields in the contract content
      const filledContent = fillClientFieldsInContent(resolveContractBodyContent(contract, template));
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

      // Skip for HR employee / recruitment / external firm digital contracts
      if (
        updatedContract &&
        (updatedContract.employee_id || updatedContract.external_firm_id || updatedContract.user_id)
      ) {
        console.log('📝 Public non-client contract signing: skipping lead stage update');
      } else if (updatedContract && updatedContract.client_id && !updatedContract.legacy_id) {
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

      // NOTE: Contract signing should NOT auto-generate payment plans/proformas.
      // Any downstream financial actions must be initiated manually by staff.

      // Only scroll to top AFTER successful submission
      window.scrollTo({ top: 0, behavior: 'smooth' });

      setThankYou(true);
      setContract(updatedContract);
      if (kioskMode) onKioskComplete?.();
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

  // Scroll to date field handler
  const scrollToDateField = () => {
    const dateField = document.querySelector('[data-field-type="date"]');
    if (dateField) {
      dateField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Focus the input if it exists
      const input = dateField.querySelector('input[type="date"]');
      if (input) {
        setTimeout(() => {
          (input as HTMLInputElement).focus();
        }, 500);
      }
    }
  };

  // Fetch closer employee
  const fetchCloserEmployee = async (clientData: any, leadType: 'legacy' | 'new') => {
    try {
      let closerId: number | null = null;
      let closerDisplayName: string | null = null;

      if (leadType === 'legacy') {
        // For legacy leads, fetch closer_id from leads_lead
        const { data: legacyLeadData } = await supabase
          .from('leads_lead')
          .select('closer_id')
          .eq('id', clientData.id)
          .single();

        if (legacyLeadData?.closer_id) {
          closerId = legacyLeadData.closer_id;
        }
      } else {
        // For new leads, fetch closer from leads table (it's a display name string)
        const { data: newLeadData } = await supabase
          .from('leads')
          .select('closer')
          .eq('id', clientData.id)
          .single();

        if (newLeadData?.closer && newLeadData.closer.trim() !== '' && newLeadData.closer !== '---') {
          closerDisplayName = newLeadData.closer.trim();
        }
      }

      // Fetch employee data
      if (closerId) {
        const { data: employeeData, error: employeeError } = await supabase
          .from('tenants_employee')
          .select(`
            id,
            display_name,
            photo_url,
            chat_background_image_url,
            mobile,
            phone,
            phone_ext,
            bonuses_role,
            official_name,
            linkedin_url,
            department_id,
            tenant_departement!department_id (
              name
            )
          `)
          .eq('id', closerId)
          .single();

        if (!employeeError && employeeData) {
          // Fetch email from users table
          const { data: userData } = await supabase
            .from('users')
            .select('email')
            .eq('employee_id', employeeData.id)
            .maybeSingle();

          const profileData = {
            id: employeeData.id,
            display_name: employeeData.display_name,
            photo_url: employeeData.photo_url,
            chat_background_image_url: employeeData.chat_background_image_url,
            mobile: employeeData.mobile || '',
            phone: employeeData.phone || '',
            phone_ext: employeeData.phone_ext || '',
            email: userData?.email || null,
            department_name: (employeeData as any).tenant_departement?.name || 'General',
            bonuses_role: employeeData.bonuses_role || 'Employee',
            official_name: employeeData.official_name || employeeData.display_name,
            linkedin_url: employeeData.linkedin_url || null,
          };

          setCloserEmployee(profileData);
        }
      } else if (closerDisplayName) {
        // Find employee by display name
        const { data: employeeData, error: employeeError } = await supabase
          .from('tenants_employee')
          .select(`
            id,
            display_name,
            photo_url,
            chat_background_image_url,
            mobile,
            phone,
            phone_ext,
            bonuses_role,
            official_name,
            linkedin_url,
            department_id,
            tenant_departement!department_id (
              name
            )
          `)
          .eq('display_name', closerDisplayName)
          .single();

        if (!employeeError && employeeData) {
          // Fetch email from users table
          const { data: userData } = await supabase
            .from('users')
            .select('email')
            .eq('employee_id', employeeData.id)
            .maybeSingle();

          const profileData = {
            id: employeeData.id,
            display_name: employeeData.display_name,
            photo_url: employeeData.photo_url,
            chat_background_image_url: employeeData.chat_background_image_url,
            mobile: employeeData.mobile || '',
            phone: employeeData.phone || '',
            phone_ext: employeeData.phone_ext || '',
            email: userData?.email || null,
            department_name: (employeeData as any).tenant_departement?.name || 'General',
            bonuses_role: employeeData.bonuses_role || 'Employee',
            official_name: employeeData.official_name || employeeData.display_name,
            linkedin_url: employeeData.linkedin_url || null,
          };

          setCloserEmployee(profileData);
        }
      }
    } catch (error) {
      console.error('Error fetching closer employee:', error);
    }
  };

  // Share contract handler (uses Web Share API on mobile and desktop when available)
  const handleShareContract = async () => {
    if (!contract) return;

    const contractUrl = window.location.href;
    const clientName = contract?.contact_name || client?.name || 'Client';
    const contractTitle = `Contract for ${clientName} - Decker Pex Levi Law Offices`;
    const shareText = `You have been invited to review and sign a legal contract from Decker Pex Levi Law Offices. This is a secure link - please review the contract and sign if you agree to the terms.`;

    // Try Web Share API first (works on mobile and some desktop browsers)
    if (navigator.share) {
      try {
        await navigator.share({
          title: contractTitle,
          text: shareText,
          url: contractUrl,
        });
        return; // Successfully shared
      } catch (error: any) {
        // User cancelled - don't show error
        if (error.name === 'AbortError') {
          return;
        }
        // Other error - fall through to clipboard fallback
        console.error('Error sharing contract:', error);
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(contractUrl);
      alert('Contract link copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy link:', err);
      alert('Failed to share contract link.');
    }
  };

  // Download PDF handler
  const handleDownloadPDF = async () => {
    if (!contractContentRef.current) return;
    setPdfLoading(true);
    const clientName = (contract && contract.contact_name) ? contract.contact_name : (client?.name || 'Client');
    const filename = `contract-${clientName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${contract.id}.pdf`;

    try {
      // Lazy load html2pdf only when needed
      const html2pdfLib = await loadHtml2Pdf();
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
          html2pdfLib(elementToPrint, {
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
  const contractTextInputClass =
    'w-full max-w-md rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm ' +
    'placeholder:text-slate-400 transition ' +
    'hover:border-slate-300 focus:border-blue-950 focus:outline-none focus:ring-2 focus:ring-blue-950/15 ' +
    'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

  const contractDateInputClass =
    'w-full max-w-xs rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm transition ' +
    'hover:border-slate-300 focus:border-blue-950 focus:outline-none focus:ring-2 focus:ring-blue-950/15 ' +
    'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

  const contractSignaturePadClass =
    'inline-flex w-full max-w-[240px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm ' +
    'transition hover:border-slate-300';

  // Helper function to render a single applicant field (used for both template and dynamic fields)
  const renderApplicantField = useCallback((id: string, index: number, total: number) => {
    return (
      <div key={id} className="mb-3 flex w-full max-w-md items-center gap-2" dir={contractIsRTL ? 'rtl' : 'ltr'}>
        <input
          type="text"
          className={contractTextInputClass}
          placeholder={getInputPlaceholder(id, contractIsRTL, true)}
          value={clientFields[id] || ''}
          onChange={e => handleClientFieldChange(id, e.target.value)}
          disabled={contract?.status === 'signed'}
          data-field-id={id}
          data-is-applicant="true"
          dir={contractIsRTL ? 'rtl' : 'ltr'}
          style={{ textAlign: contractIsRTL ? 'right' : 'left' }}
        />
      </div>
    );
  }, [clientFields, contract?.status, activeApplicantFields, applicantFieldIds, dynamicApplicantFieldCounter, contractIsRTL]);

  const getBlockDirection = (
    textContent: string,
    savedAlign?: string | null
  ): { dir?: 'rtl' | 'ltr'; textAlign: React.CSSProperties['textAlign'] } => {
    const rtl = isRTL(textContent);
    // Editor uses dir="auto", so Hebrew often looked right-aligned even with textAlign left/null.
    if (savedAlign === 'right' || (rtl && (savedAlign === 'left' || !savedAlign))) {
      return { dir: 'rtl', textAlign: 'right' };
    }
    if (savedAlign === 'left') return { dir: 'ltr', textAlign: 'left' };
    if (savedAlign === 'center') return { textAlign: 'center' };
    if (savedAlign === 'justify') {
      return { dir: rtl ? 'rtl' : 'ltr', textAlign: 'justify' };
    }
    return { dir: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' };
  };

  const renderInlineTextField = (
    id: string,
    labelText: string,
    surroundingText: string,
    isApplicantField: boolean
  ) => {
    const fieldIsRTL = contractIsRTL || isRTL(labelText) || isRTL(surroundingText);
    return (
      <span
        key={id}
        className="inline-flex relative field-wrapper group align-middle items-center gap-2 my-1"
        dir={fieldIsRTL ? 'rtl' : 'ltr'}
        style={{ verticalAlign: 'middle', unicodeBidi: 'embed' }}
        data-field-id={id}
        data-is-applicant={isApplicantField ? 'true' : 'false'}
      >
        {labelText}
        <input
          className={`${contractTextInputClass} !w-auto min-w-[10rem] max-w-[18rem]`}
          placeholder={getInputPlaceholder(id, fieldIsRTL, isApplicantField)}
          value={clientFields[id] || ''}
          onChange={e => handleClientFieldChange(id, e.target.value)}
          disabled={contract?.status === 'signed'}
          dir={fieldIsRTL ? 'rtl' : 'ltr'}
          style={{
            display: 'inline-block',
            verticalAlign: 'middle',
            textAlign: fieldIsRTL ? 'right' : 'left',
          }}
        />
      </span>
    );
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

        // Check if this text contains both date and signature fields for side-by-side layout
        const textLower = text.toLowerCase();
        const hasBothFields = textLower.includes('date:') && textLower.includes('signature:') &&
          text.includes('{{date') && text.includes('{{signature');

        const parts = [];
        let lastIndex = 0;
        // IMPORTANT: Match date fields FIRST, then signature, then text to prevent confusion
        const regex = /({{date(:[^}]+)?}}|{{signature(:[^}]+)?}}|{{text(:[^}]+)?}}|\n)/g;
        let match;
        // Counter for applicant field instances - ensures each gets a unique ID
        let applicantInstanceCounter = 0;

        // Track text before date and signature fields to wrap them with their labels
        let textBeforeDate = '';
        let textBeforeSignature = '';

        while ((match = regex.exec(text)) !== null) {
          const placeholder = match[1];
          const textBeforePlaceholder = match.index > lastIndex ? text.slice(lastIndex, match.index) : '';

          // Use specific regex patterns to ensure correct matching
          const dateMatch = placeholder.match(/^{{date(:[^}]+)?}}$/);
          const sigMatch = placeholder.match(/^{{signature(:[^}]+)?}}$/);
          const textMatch = placeholder.match(/^{{text(:[^}]+)?}}$/);

          // Process date fields FIRST to prevent them from being treated as text fields
          if (dateMatch) {
            // Extract ID from the match - dateMatch[1] will be ":date-1" or similar, so substring(1) removes the colon
            // Use stable ID from placeholder or generate based on placeholderIndex
            const extractedId = dateMatch[1] ? dateMatch[1].substring(1) : null;
            // Keep generated IDs aligned with preprocessTemplatePlaceholders (date-1, date-2, ...)
            const id = extractedId || `date-${++placeholderIndex.date}`;
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
              const dateField = (
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

              parts.push(
                <div
                  key={`date-wrapper-${id}`}
                  className="contract-date-block my-3 flex w-full max-w-xl flex-col items-start gap-2"
                >
                  {textBeforePlaceholder.trim() ? (
                    <span className="block font-medium text-gray-800">
                      {textBeforePlaceholder.trim()}
                    </span>
                  ) : null}
                  {dateField}
                </div>
              );
            } else {
              const dateField = (
                <div
                  key={id}
                  className="flex flex-col items-start gap-2 relative"
                  style={{ maxWidth: '100%' }}
                  data-field-id={id}
                  data-field-type="date"
                >
                  <input
                    type="date"
                    className={contractDateInputClass}
                    value={formattedDate}
                    onChange={e => handleClientFieldChange(id, e.target.value)}
                    data-input-type="date"
                    style={{
                      minWidth: '180px',
                      color: '#111827',
                      cursor: 'text'
                    }}
                  />
                  {contract?.status !== 'signed' && !formattedDate ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                      Please add date
                    </span>
                  ) : null}
                </div>
              );

              parts.push(
                <div
                  key={`date-wrapper-${id}`}
                  className="contract-date-block my-3 flex w-full max-w-xl flex-col items-start gap-2"
                >
                  {textBeforePlaceholder.trim() ? (
                    <span className="block font-medium text-gray-800">
                      {textBeforePlaceholder.trim()}
                    </span>
                  ) : null}
                  {dateField}
                </div>
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
                  <div
                    key={id}
                    className="flex flex-col items-start gap-2 relative max-w-full"
                    data-field-id={id}
                    data-field-type="date"
                  >
                    <input
                      type="date"
                      className={contractDateInputClass}
                      value={formattedDate}
                      onChange={e => handleClientFieldChange(id, e.target.value)}
                      data-input-type="date"
                      style={{
                        minWidth: '180px',
                        color: '#111827',
                        cursor: 'text'
                      }}
                    />
                    {contract?.status !== 'signed' && !formattedDate ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                        Please add date
                      </span>
                    ) : null}
                  </div>
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
                  className="mb-3 flex w-full max-w-md items-center gap-2 relative field-wrapper group"
                  data-field-id={id}
                  data-is-applicant="true"
                  dir={contractIsRTL ? 'rtl' : 'ltr'}
                >
                  <input
                    type="text"
                    className={contractTextInputClass}
                    placeholder={getInputPlaceholder(id, contractIsRTL, true)}
                    value={clientFields[id] || ''}
                    onChange={e => handleClientFieldChange(id, e.target.value)}
                    disabled={contract?.status === 'signed'}
                    dir={contractIsRTL ? 'rtl' : 'ltr'}
                    style={{ textAlign: contractIsRTL ? 'right' : 'left' }}
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
                  parts.push(
                    <div
                      key={dynamicFieldId}
                      className="mb-3 flex w-full max-w-md items-center gap-2 relative field-wrapper group"
                      data-field-id={dynamicFieldId}
                      data-is-applicant="true"
                      dir={contractIsRTL ? 'rtl' : 'ltr'}
                    >
                      <input
                        type="text"
                        className={contractTextInputClass}
                        placeholder={getInputPlaceholder(dynamicFieldId, contractIsRTL, true)}
                        value={clientFields[dynamicFieldId] || ''}
                        onChange={e => handleClientFieldChange(dynamicFieldId, e.target.value)}
                        disabled={contract?.status === 'signed'}
                        dir={contractIsRTL ? 'rtl' : 'ltr'}
                        style={{ textAlign: contractIsRTL ? 'right' : 'left' }}
                      />
                    </div>
                  );
                });
              }

              lastIndex = match.index + match[1].length;
              continue; // Skip the rest of the text field processing
            }

            // For non-applicant text fields, keep label text before the input (RTL-safe)
            parts.push(renderInlineTextField(id, textBeforePlaceholder, text, isApplicantField));
            lastIndex = match.index + match[1].length;
            continue;
          } else if (sigMatch) {
            const id = sigMatch[1] ? sigMatch[1].substring(1) : `signature-${++placeholderIndex.signature}`;

            const signatureField = (
              <div
                key={id}
                className="contract-signature-block my-3 flex w-full max-w-xl flex-col items-start gap-2"
                data-field-id={id}
              >
                {textBeforePlaceholder.trim() ? (
                  <span className="block font-medium text-gray-800">
                    {textBeforePlaceholder.trim()}
                  </span>
                ) : null}
                <div className="inline-flex items-start gap-2 md:gap-4 relative field-wrapper flex-wrap max-w-full">
                  <div className="flex flex-col items-start gap-2">
                    <div className={contractSignaturePadClass}>
                      {clientFields[id] || (contract?.status === 'signed' && clientSignature) ? (
                        <img
                          src={clientFields[id] || clientSignature || ''}
                          alt="Signature"
                          className="block h-20 w-full max-w-[200px] rounded-lg object-contain"
                        />
                      ) : (
                        <SignaturePad
                          ref={(ref) => {
                            if (ref && signaturePads) signaturePads[id] = ref;
                          }}
                          penColor="#0f172a"
                          backgroundColor="rgba(248,250,252,1)"
                          canvasProps={{
                            width: 200,
                            height: 80,
                            className: 'block w-full rounded-lg',
                            style: {
                              display: 'block',
                              borderRadius: 8,
                              background: 'rgb(248, 250, 252)',
                              maxWidth: '100%',
                              width: '100%'
                            }
                          }}
                          onEnd={() => {
                            if (signaturePads && signaturePads[id]) {
                              const dataUrl = signaturePads[id].toDataURL();
                              setClientSignature(dataUrl);
                              setClientFields(prev => ({ ...prev, [id]: dataUrl }));
                            }
                          }}
                        />
                      )}
                      <div className="mt-2 text-center text-xs font-medium text-slate-400">
                        Sign here
                      </div>
                    </div>
                    {contract?.status !== 'signed' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm gap-2 rounded-full border-0 bg-blue-950 px-5 text-white hover:bg-blue-900"
                          onClick={() => setSignatureModalId(id)}
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                          {clientFields[id] ? 'Edit signature' : 'Open signature pad'}
                        </button>
                        {!clientFields[id] ? (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                            Please sign first
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>
                  <div className="flex-shrink-0 max-w-full flex items-center">
                    <img
                      src="/חתימה מסמכים (5).png"
                      alt="Stamp"
                      className="h-32 md:h-52 w-auto object-contain"
                      style={{
                        display: 'block',
                        objectFit: 'contain'
                      }}
                    />
                  </div>
                </div>
              </div>
            );

            parts.push(signatureField);
          } else if (placeholder === '\n') {
            parts.push(<br key={keyPrefix + '-br-' + match.index} />);
            lastIndex = match.index + match[1].length;
            continue;
          }
          lastIndex = match.index + match[1].length;
        }
        if (lastIndex < text.length) {
          parts.push(text.slice(lastIndex));
        }

        // If both fields are present, stack date above signature and keep them left-aligned
        if (hasBothFields && parts.length > 0) {
          const dateWrapperIndex = parts.findIndex((part: any) =>
            React.isValidElement(part) && part.key && typeof part.key === 'string' && part.key.includes('date-wrapper')
          );
          const signatureWrapperIndex = parts.findIndex((part: any) =>
            React.isValidElement(part) &&
            part.key &&
            typeof part.key === 'string' &&
            (String(part.key).includes('signature') ||
              (part.props && String(part.props.className || '').includes('contract-signature-block')))
          );

          if (dateWrapperIndex !== -1 && signatureWrapperIndex !== -1) {
            const beforeDate = parts.slice(0, dateWrapperIndex);
            const dateWrapper = parts[dateWrapperIndex];
            const betweenFields = parts.slice(dateWrapperIndex + 1, signatureWrapperIndex);
            const signatureWrapper = parts[signatureWrapperIndex];
            const afterSignature = parts.slice(signatureWrapperIndex + 1);

            return (
              <div key={`${keyPrefix}-date-signature-stack`} className="flex w-full flex-col items-start gap-4">
                {beforeDate.length > 0
                  ? beforeDate.map((part: any, idx: number) =>
                      React.isValidElement(part) ? (
                        part
                      ) : (
                        <React.Fragment key={`date-before-${idx}`}>{part}</React.Fragment>
                      ),
                    )
                  : null}
                {dateWrapper}
                {betweenFields.length > 0
                  ? betweenFields.map((part: any, idx: number) =>
                      React.isValidElement(part) ? (
                        part
                      ) : (
                        <React.Fragment key={`date-between-${idx}`}>{part}</React.Fragment>
                      ),
                    )
                  : null}
                {signatureWrapper}
                {afterSignature.length > 0
                  ? afterSignature.map((part: any, idx: number) =>
                      React.isValidElement(part) ? (
                        part
                      ) : (
                        <React.Fragment key={`signature-after-${idx}`}>{part}</React.Fragment>
                      ),
                    )
                  : null}
              </div>
            );
          }
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
        // Always render paragraph, even if empty, to preserve line breaks
        const paragraphText = content.content?.map((n: any) => n.text || '').join('') || '';

        // Check if paragraph contains input fields (React elements)
        const hasInputFields = React.isValidElement(paragraphContent) ||
          (Array.isArray(paragraphContent) && paragraphContent.some(item => React.isValidElement(item)));

        // Check if paragraph contains both date and signature fields (for desktop side-by-side layout)
        const paragraphTextLower = paragraphText.toLowerCase();
        const hasDateField = paragraphTextLower.includes('date:') && paragraphText.includes('{{date');
        const hasSignatureField = paragraphTextLower.includes('signature:') && paragraphText.includes('{{signature');
        const hasBothFields = hasDateField && hasSignatureField;

        const textContent = extractTextContent(content.content);
        const savedTextAlign = content.attrs?.textAlign as string | undefined;
        const { dir: direction, textAlign } = getBlockDirection(textContent || paragraphText, savedTextAlign);

        if (hasInputFields) {
          // Use div instead of p to avoid DOM nesting issues with input fields
          return (
            <div
              key={keyPrefix}
              className={`contract-paragraph-with-fields mb-2 md:mb-3 text-sm md:text-base ${hasBothFields ? 'flex flex-col items-start gap-4' : ''}`}
              dir={direction}
              style={{ textAlign }}
            >
              {paragraphContent || <br />}
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
              {paragraphContent || <br />}
            </p>
          );
        }
      case 'heading': {
        const level = content.attrs?.level || 1;
        const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        const HeadingTag = headingTags[Math.max(0, Math.min(5, level - 1))] || 'h1';
        const headingSizes = {
          h1: 'text-lg md:text-2xl',
          h2: 'text-base md:text-xl',
          h3: 'text-sm md:text-lg',
          h4: 'text-sm md:text-base',
          h5: 'text-xs md:text-sm',
          h6: 'text-xs md:text-sm'
        };
        const sizeClass = headingSizes[HeadingTag as keyof typeof headingSizes] || 'text-base md:text-lg';

        const headingTextContent = extractTextContent(content.content);
        const savedHeadingAlign = content.attrs?.textAlign as string | undefined;
        const { dir: headingDirection, textAlign: headingTextAlign } = getBlockDirection(headingTextContent, savedHeadingAlign);

        return React.createElement(
          HeadingTag,
          {
            key: keyPrefix,
            className: `${sizeClass} font-semibold mb-2 md:mb-3`,
            dir: headingDirection,
            style: { textAlign: headingTextAlign }
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="flex flex-col items-center gap-6">
          <div className="bg-black p-0.5 md:p-1 rounded-lg shadow-2xl animate-sway">
            <img
              src="/RMQ_LOGO.png"
              alt="Decker Pex Levi Law Offices"
              className="w-64 h-64 md:w-80 md:h-80 object-contain"
            />
          </div>
          <div className="loading loading-spinner loading-lg text-primary"></div>
        </div>
      </div>
    </div>
  );
  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <p className="text-red-500 text-sm md:text-lg">{error}</p>
      </div>
    </div>
  );
  if (!contract || !template) return null;

  const headerClientName =
    (contract?.contact_name && contract.contact_name.trim() !== '')
      ? contract.contact_name.trim()
      : (client?.name && client.name.trim() !== '')
        ? client.name.trim()
        : 'Client';
  const isSigned = contract.status === 'signed' || thankYou;

  return (
    <div className="min-h-screen bg-white md:bg-gray-100">
      {/* Premium client-first header */}
      <header className="print-hide w-full bg-white shadow-sm">
        <div
          className="mx-auto grid w-full max-w-6xl items-center gap-4 px-4 py-5 md:gap-8 md:px-8 md:py-7"
          style={{ gridTemplateColumns: 'auto minmax(0, 1fr) auto' }}
        >
          {/* Logo - Left (secondary) */}
          <div className="flex shrink-0 items-center self-center">
            <img
              src="/DPL-LOGO1.png"
              alt="DPL Logo"
              className="h-10 w-auto object-contain md:h-14"
            />
          </div>

          {/* Client - Center (hero) */}
          <div className="min-w-0 text-center">
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
              <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 md:text-3xl md:leading-tight">
                {headerClientName}
              </h1>
              {isSigned ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-200">
                  <span className="relative flex h-2 w-2" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  Signed
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide shadow-sm ring-1 ring-amber-200"
                  style={{
                    background: 'linear-gradient(90deg, #f7efd8 0%, #f3e4bc 50%, #efe0b0 100%)',
                    color: '#7a5c16',
                  }}
                >
                  <span className="relative flex h-2 w-2" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-50" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                  </span>
                  Ready to sign
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:text-xs md:tracking-[0.16em]">
              Decker Pex &amp; Co. Law Office
            </p>
          </div>

          {/* Matter ID - Right */}
          <div className="flex min-w-[5.5rem] shrink-0 flex-col items-end justify-center self-center text-right md:min-w-[7rem]">
            {leadNumber ? (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 md:text-[11px]">
                  Matter ID
                </span>
                <span className="mt-1 font-mono text-sm font-semibold text-slate-900 md:text-base">
                  #{leadNumber}
                </span>
              </>
            ) : (
              <span className="text-xs text-slate-300">—</span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content — full-bleed white on phone/tablet; grey framed card on desktop */}
      <div className="bg-white px-0 py-3 md:bg-gray-100 md:flex md:items-center md:justify-center md:px-8 md:py-8 pb-32 md:pb-8">
        <div className="w-full max-w-6xl bg-white relative px-3.5 py-4 sm:px-5 sm:py-5 md:rounded-lg md:shadow-lg md:border md:border-gray-200 md:p-8">
          {/* Share button in top right corner - removed since we have it in floating buttons on desktop */}

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
            </div>
          )}


          <div ref={contractContentRef} id="contract-print-area" className="prose prose-sm md:prose-base max-w-none overflow-x-hidden">
            {(() => {
              const contentToRender = resolveContractBodyContent(contract, template);
              if (!contentToRender) return null;

              return thankYou ? (
                <>
                  <div className="alert alert-success text-sm md:text-lg font-semibold mb-4 md:mb-6">Thank you! Your contract was signed and submitted. You will be notified soon.</div>
                  {renderTiptapContent(contentToRender, '', signaturePads, undefined, undefined, { text: 0, signature: 0, date: 0 })}
                </>
              ) : (
                renderTiptapContent(contentToRender, '', signaturePads, undefined, undefined, { text: 0, signature: 0, date: 0 })
              );
            })()}
          </div>

          {/* Submit Contract Button (only if not signed) */}
          {contract.status !== 'signed' && !thankYou && (
            <div className="mt-8 flex justify-center print-hide">
              <button
                className="btn btn-lg rounded-full border-none bg-blue-950 px-8 text-white hover:bg-blue-900 sm:px-10"
                onClick={handleSubmitContract}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Contract'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-blue-950 text-white mt-8 md:mt-24 print-hide">
        <div className="max-w-5xl mx-auto px-4 py-8 md:py-20 md:px-8">
          <div className="flex flex-col items-center justify-center gap-4 md:gap-8">
            {/* Company Info & Addresses */}
            <div className="text-center space-y-2 md:space-y-3">
              <div className="flex items-center justify-center gap-3">
                <img src="/DPLOGO1.png" alt="DPL Logo" className="h-12 w-auto object-contain" />
                <p className="font-bold text-xl text-white">Decker, Pex, Levi Law Offices</p>
              </div>
              <div className="text-blue-100 text-sm flex flex-col md:flex-row items-center justify-center gap-1 md:gap-3">
                <p>Yad Harutzim 10, Jerusalem, Israel</p>
                <span className="hidden md:inline text-blue-200/80">•</span>
                <p>Menachem Begin Rd. 150, Tel Aviv, Israel</p>
              </div>
            </div>
          </div>

          <div className="mt-6 md:mt-12 pt-4 md:pt-8 border-t border-blue-900 text-center text-xs text-blue-200/90">
            RMQ 2.0 - Copyright © {new Date().getFullYear()} - All right reserved
          </div>
        </div>
      </footer>

      <PublicNeedAssistanceWidget
        className="hidden md:flex"
        closerSlot={
          closerEmployee ? (
            <button
              type="button"
              onClick={() => setShowCloserModal(true)}
              className="btn btn-circle h-12 w-12 min-h-12 min-w-12 shrink-0 overflow-hidden border-2 border-gray-300 bg-white p-0 shadow-lg transition-transform hover:scale-105 active:scale-95"
              title={`View ${closerEmployee.official_name}'s business card`}
            >
              <img
                src={closerEmployee.photo_url || 'https://ui-avatars.com/api/?background=random'}
                alt={closerEmployee.official_name}
                className="h-full w-full object-cover"
              />
            </button>
          ) : undefined
        }
      />

      {/* Scroll to Date + Share — Desktop only (top right) */}
      <div className="hidden md:flex fixed top-32 right-6 z-40 print-hide flex-col gap-4">
        <button
          onClick={scrollToDateField}
          className="btn btn-circle btn-lg bg-blue-950 text-white border-none hover:bg-blue-900 shadow-lg hover:scale-110 transition-transform"
          title="Scroll to date field"
        >
          <ArrowDownIcon className="w-8 h-8" />
        </button>

        <button
          onClick={handleShareContract}
          className="btn btn-circle btn-lg bg-emerald-600 text-white border-none hover:bg-emerald-700 shadow-lg hover:scale-110 transition-transform"
          title="Share contract"
        >
          <ShareIcon className="w-8 h-8" />
        </button>
      </div>

      {/* Mobile Bottom Oval Box with Contact Buttons */}
      <div
        className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-50 print-hide"
        style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}
      >
        <div className="bg-white/20 backdrop-blur-md rounded-full border border-white/30 shadow-lg">
          <div className="flex items-center justify-center gap-3 px-4 py-2.5">
            {closerEmployee && (
              <button
                type="button"
                onClick={() => setShowCloserModal(true)}
                className="btn btn-ghost btn-circle text-black hover:bg-white/20 overflow-hidden p-0"
                title={`View ${closerEmployee.official_name}'s business card`}
              >
                <img
                  src={closerEmployee.photo_url || 'https://ui-avatars.com/api/?background=random'}
                  alt={closerEmployee.official_name}
                  className="w-8 h-8 rounded-full object-cover"
                />
              </button>
            )}
            <button
              type="button"
              onClick={handleShareContract}
              className="btn btn-circle border-none bg-emerald-600 text-white hover:bg-emerald-700"
              title="Share contract"
            >
              <ShareIcon className="w-6 h-6" />
            </button>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-circle text-black hover:bg-white/20"
              title="Chat on WhatsApp"
            >
              <FaWhatsapp className="w-6 h-6" />
            </a>
            <a
              href={`mailto:${OFFICE_EMAIL}`}
              className="btn btn-ghost btn-circle text-black hover:bg-white/20"
              title="Send Email"
            >
              <FaEnvelope className="w-6 h-6" />
            </a>
            <a
              href={OFFICE_PHONE_TEL}
              className="btn btn-ghost btn-circle text-black hover:bg-white/20"
              title="Call Office"
            >
              <PhoneIcon className="w-6 h-6" />
            </a>
          </div>
        </div>
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
        
        @keyframes sway {
          0%, 100% {
            transform: rotate(0deg);
          }
          25% {
            transform: rotate(3deg);
          }
          75% {
            transform: rotate(-3deg);
          }
        }
        
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
        
        .field-highlight-pulse {
          animation: field-highlight-pulse 2s ease-out;
        }
        
        .animate-sway {
          animation: sway 3s ease-in-out infinite;
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
          color-scheme: light;
        }
        
        input[type="date"]:not(:disabled) {
          cursor: text;
        }
        
        input[type="date"]::-webkit-calendar-picker-indicator {
          cursor: pointer;
          opacity: 0.7;
          padding: 4px;
          border-radius: 6px;
        }

        input[type="date"]::-webkit-calendar-picker-indicator:hover {
          opacity: 1;
          background: rgba(15, 23, 42, 0.06);
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
        #contract-print-area h6 {
          unicode-bidi: plaintext;
        }

        /* Paragraphs with inline fields need stable RTL/LTR — plaintext bidi breaks label placement */
        #contract-print-area .contract-paragraph-with-fields {
          unicode-bidi: normal;
        }

        #contract-print-area .field-wrapper {
          unicode-bidi: embed;
          max-width: none;
        }

        #contract-print-area .field-wrapper input[type="text"] {
          position: relative;
          z-index: auto;
          flex: none;
          width: auto;
        }

        #contract-print-area div[dir="rtl"] .field-wrapper input[type="text"] {
          text-align: right;
        }

        #contract-print-area div[dir="rtl"] .field-wrapper input[type="text"]::placeholder,
        #contract-print-area .field-wrapper input[dir="rtl"]::placeholder {
          text-align: right;
          direction: rtl;
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

      {/* Large signature pad modal */}
      {signatureModalId && contract?.status !== 'signed' && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm print-hide sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSignatureModalId(null);
          }}
        >
          <div className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
              <div>
                <h3 className="text-base font-semibold text-slate-900 sm:text-lg">Sign the contract</h3>
                <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                  Draw your signature in the large pad below, then apply it.
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
                onClick={() => setSignatureModalId(null)}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-5">
              <div
                ref={modalPadWrapRef}
                className="relative w-full overflow-hidden rounded-2xl border-2 border-dashed border-indigo-200 bg-slate-50"
                style={{ height: modalPadSize.height }}
              >
                <SignaturePad
                  ref={(ref) => {
                    modalSignaturePadRef.current = ref;
                  }}
                  penColor="#1e293b"
                  backgroundColor="rgba(248,250,252,1)"
                  canvasProps={{
                    width: modalPadSize.width,
                    height: modalPadSize.height,
                    className: 'touch-none block w-full h-full',
                    style: {
                      width: '100%',
                      height: '100%',
                      display: 'block',
                    },
                  }}
                />
                <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs font-medium text-slate-400">
                  Sign here
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 sm:px-6">
              <button
                type="button"
                className="inline-flex h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => modalSignaturePadRef.current?.clear()}
              >
                Clear
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="inline-flex h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  onClick={() => setSignatureModalId(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                  onClick={applySignatureFromModal}
                >
                  <PencilSquareIcon className="h-4 w-4" />
                  Apply signature
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Business Card Modal */}
      {showCloserModal && closerEmployee && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm print-hide"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCloserModal(false);
            }
          }}
        >
          <div className="relative w-full max-w-[95vw] md:max-w-6xl max-h-[90vh] overflow-hidden bg-transparent rounded-2xl shadow-2xl">
            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowCloserModal(false);
              }}
              className="absolute top-4 right-4 z-[110] btn btn-circle btn-sm bg-black/60 text-white border-none hover:bg-black/80 backdrop-blur-md"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>

            {/* Business Card Content */}
            <div
              className="relative w-full min-h-[400px] md:min-h-[630px] transition-all duration-700 ease-out overflow-hidden rounded-2xl"
              style={{
                perspective: '1000px',
                animation: isCardVisible ? 'cardTilt 3s ease-in-out' : 'none',
                opacity: isCardVisible ? 1 : 0,
                transform: isCardVisible ? 'scale(1)' : 'scale(0.95)',
              }}
            >
              <style>{`
                @keyframes cardTilt {
                  0% {
                    transform: perspective(1000px) rotateX(0deg) rotateY(0deg);
                  }
                  25% {
                    transform: perspective(1000px) rotateX(0deg) rotateY(-2deg);
                  }
                  50% {
                    transform: perspective(1000px) rotateX(0deg) rotateY(2deg);
                  }
                  75% {
                    transform: perspective(1000px) rotateX(0deg) rotateY(-1deg);
                  }
                  100% {
                    transform: perspective(1000px) rotateX(0deg) rotateY(0deg);
                  }
                }
              `}</style>
              {/* Background Image with Overlay */}
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{
                  backgroundImage: `url(${closerEmployee.chat_background_image_url || 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80'})`,
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/50 to-black/60"></div>
              </div>

              {/* Logo - Top Left */}
              <div className="absolute top-4 left-4 md:top-6 md:left-6 z-10">
                <img
                  src="/DPLOGO1.png"
                  alt="DPL Logo"
                  className="h-8 md:h-14 drop-shadow-2xl"
                />
              </div>

              {/* Centered Content Container */}
              <div className="relative z-10 h-full flex items-center justify-center px-4 py-6 md:py-8 md:px-16 md:py-12 min-h-[400px] md:min-h-[630px]">
                <div className="text-center text-white max-w-3xl w-full -mt-8 md:-mt-12">
                  {/* Profile Image - Centered above name */}
                  <div className="flex justify-center md:justify-center mb-4 md:mb-6 ml-4 md:ml-0">
                    <div className="w-24 h-24 md:w-40 md:h-40 rounded-full shadow-2xl overflow-hidden">
                      <img
                        src={closerEmployee.photo_url || 'https://ui-avatars.com/api/?background=random'}
                        alt={closerEmployee.official_name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  {/* Name */}
                  <h1 className="text-3xl md:text-6xl font-bold mb-2 md:mb-3 drop-shadow-2xl tracking-tight px-2">
                    {closerEmployee.official_name}
                  </h1>

                  {/* Department */}
                  <p className="text-base md:text-2xl text-white/95 mb-3 md:mb-4 drop-shadow-lg font-medium px-2">
                    {closerEmployee.department_name} Department
                  </p>

                  {/* Company Name */}
                  <p className="text-sm md:text-xl text-white/90 mb-4 md:mb-8 drop-shadow-md font-semibold px-2">
                    Decker, Pex, Levi Law Offices
                  </p>

                  {/* Contact Information */}
                  <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-6 mt-4 md:mt-8 px-2">
                    {closerEmployee.email && (
                      <a
                        href={`mailto:${closerEmployee.email}`}
                        className="flex items-center gap-2 md:gap-3 bg-white/10 backdrop-blur-md px-3 py-2 md:px-5 md:py-2.5 rounded-full border border-white/20 shadow-lg hover:bg-white/20 transition-all cursor-pointer w-full md:w-auto justify-center"
                      >
                        <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 text-white flex-shrink-0" />
                        <span className="text-xs md:text-base font-medium break-all">{closerEmployee.email}</span>
                      </a>
                    )}
                    {closerEmployee.mobile && (
                      <a
                        href={`tel:${closerEmployee.mobile}`}
                        className="flex items-center gap-2 md:gap-3 bg-white/10 backdrop-blur-md px-3 py-2 md:px-5 md:py-2.5 rounded-full border border-white/20 shadow-lg hover:bg-white/20 transition-all cursor-pointer w-full md:w-auto justify-center"
                      >
                        <DevicePhoneMobileIcon className="w-4 h-4 md:w-5 md:h-5 text-white flex-shrink-0" />
                        <span className="text-xs md:text-base font-medium">{closerEmployee.mobile}</span>
                      </a>
                    )}
                    {closerEmployee.phone && (
                      <a
                        href={`tel:${closerEmployee.phone}`}
                        className="flex items-center gap-2 md:gap-3 bg-white/10 backdrop-blur-md px-3 py-2 md:px-5 md:py-2.5 rounded-full border border-white/20 shadow-lg hover:bg-white/20 transition-all cursor-pointer w-full md:w-auto justify-center"
                      >
                        <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 text-white flex-shrink-0" />
                        <span className="text-xs md:text-base font-medium">
                          {closerEmployee.phone}
                          {closerEmployee.phone_ext && <span className="ml-2 text-white/80">Ext: {closerEmployee.phone_ext}</span>}
                        </span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Addresses - Bottom */}
              <div className="hidden md:block absolute bottom-6 left-0 right-0 z-10">
                <div className="flex flex-row items-center justify-center gap-6 text-white/90 text-sm drop-shadow-md">
                  <span>Yad Harutzim 10, Jerusalem, Israel</span>
                  <span className="text-white/60">•</span>
                  <span>Menachem Begin Rd. 150, Tel Aviv, Israel</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicContractView; 