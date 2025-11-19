import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { FontSize } from '@tiptap/extension-font-size';
import { generateJSON } from '@tiptap/html';
import { v4 as uuidv4 } from 'uuid';
import SignatureCanvas from 'react-signature-canvas';
import { JSONContent } from '@tiptap/core';
import { 
  MagnifyingGlassIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowLeftIcon,
  DocumentTextIcon,
  Squares2X2Icon,
  TableCellsIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

const DYNAMIC_FIELDS = [
  { label: 'Client Name', tag: '{{client_name}}' },
  { label: 'Client Phone', tag: '{{client_phone}}' },
  { label: 'Client Email', tag: '{{client_email}}' },
  { label: 'Signature', tag: '{{signature}}' },
  { label: 'Date', tag: '{{date}}' },
];

const FIELD_TYPES = [
  { label: 'Text Field', tag: '{{text}}' },
  { label: 'Signature Field', tag: '{{signature}}' },
];

// New field types for the custom_pricing system
const PRICING_FIELDS = [
  { label: 'Applicant Count', tag: '{{applicant_count}}' },
  { label: 'Price Per Applicant', tag: '{{price_per_applicant}}' },
  { label: 'Total Amount', tag: '{{total_amount}}' },
  { label: 'Discount Percentage', tag: '{{discount_percentage}}' },
  { label: 'Discount Amount', tag: '{{discount_amount}}' },
  { label: 'Final Amount', tag: '{{final_amount}}' },
  { label: 'Currency', tag: '{{currency}}' },
  { label: 'Client Country', tag: '{{client_country}}' },
];

const PAYMENT_PLAN_FIELDS = [
  { label: 'Payment Plan Row', tag: '{{payment_plan_row}}' },
  { label: 'Payment Percent', tag: '{{payment_percent}}' },
  { label: 'Payment Due', tag: '{{payment_due}}' },
  { label: 'Payment Amount', tag: '{{payment_amount}}' },
];

const FONT_FAMILIES = [
  'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Comic Sans MS'
];
const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'];

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

const SAMPLE_TEMPLATE = {
  name: 'Citizenship Service Contract',
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Citizenship Service Agreement' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'This contract is made between ' }, { type: 'text', text: '{{client_name}}', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and the Service Provider.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Client Contact: ' }, { type: 'text', text: '{{client_phone}}', marks: [{ type: 'italic' }] }, { type: 'text', text: ' / ' }, { type: 'text', text: '{{client_email}}', marks: [{ type: 'italic' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Number of Applicants: ' }, { type: 'text', text: '{{applicant_count}}', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Price per Applicant: ' }, { type: 'text', text: '{{currency}} {{price_per_applicant}}', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Total Amount: ' }, { type: 'text', text: '{{currency}} {{total_amount}}', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Discount: ' }, { type: 'text', text: '{{discount_percentage}}% ({{currency}} {{discount_amount}})', marks: [{ type: 'italic' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Final Amount: ' }, { type: 'text', text: '{{currency}} {{final_amount}}', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Date: ' }, { type: 'text', text: '{{date}}', marks: [{ type: 'italic' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Signature: ' }, { type: 'text', text: '{{signature}}', marks: [{ type: 'underline' }] }] },
    ],
  },
};

const Toolbar = ({ editor }: { editor: any }) => {
  if (!editor) return null;
  return (
    <div className="flex flex-wrap gap-2 items-center mb-4 p-4 rounded-xl border border-base-300 bg-base-100">
      {/* Font Family */}
      <select
        className="select select-sm select-bordered mr-2 w-32"
        value={editor.getAttributes('fontFamily').fontFamily || 'Arial'}
        onChange={e => editor.chain().focus().setFontFamily(e.target.value).run()}
      >
        {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
      {/* Font Size */}
      <select
        className="select select-sm select-bordered mr-2 w-24"
        value={editor.getAttributes('fontSize').fontSize || '16px'}
        onChange={e => editor.chain().focus().setFontSize(e.target.value).run()}
      >
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      {/* Bold, Italic, Underline, Strike */}
      <button className={`btn btn-sm ${editor.isActive('bold') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><b className="text-base font-bold">B</b></button>
      <button className={`btn btn-sm ${editor.isActive('italic') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><i className="text-base italic">I</i></button>
      <button className={`btn btn-sm ${editor.isActive('underline') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><u className="text-base underline">U</u></button>
      <button className={`btn btn-sm ${editor.isActive('strike') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><s className="text-base line-through">S</s></button>
      {/* Color & Highlight */}
      <input type="color" className="ml-2 w-10 h-10 rounded cursor-pointer" value={editor.getAttributes('textStyle').color || '#000000'} onChange={e => editor.chain().focus().setColor(e.target.value).run()} title="Text Color" />
      <button className={`btn btn-sm ${editor.isActive('highlight') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleHighlight().run()} title="Highlight"><span className="text-base font-semibold">HL</span></button>
      {/* Alignment */}
      <button className={`btn btn-sm ${editor.isActive({ textAlign: 'left' }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align Left"><span className="text-base font-semibold">L</span></button>
      <button className={`btn btn-sm ${editor.isActive({ textAlign: 'center' }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align Center"><span className="text-base font-semibold">C</span></button>
      <button className={`btn btn-sm ${editor.isActive({ textAlign: 'right' }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align Right"><span className="text-base font-semibold">R</span></button>
      {/* Lists, Blockquote, Headings */}
      <button className={`btn btn-sm ${editor.isActive('bulletList') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List"><span className="text-base">• List</span></button>
      <button className={`btn btn-sm ${editor.isActive('orderedList') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List"><span className="text-base">1. List</span></button>
      <button className={`btn btn-sm ${editor.isActive('blockquote') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote"><span className="text-lg">❝</span></button>
      <button className={`btn btn-sm ${editor.isActive('heading', { level: 1 }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1"><span className="text-base font-bold">H1</span></button>
      <button className={`btn btn-sm ${editor.isActive('heading', { level: 2 }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2"><span className="text-base font-bold">H2</span></button>
      <button className={`btn btn-sm ${editor.isActive('heading', { level: 3 }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="H3"><span className="text-base font-bold">H3</span></button>
      {/* Link */}
      <button className={`btn btn-sm ${editor.isActive('link') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => {
        const url = window.prompt('Enter URL');
        if (url) editor.chain().focus().setLink({ href: url }).run();
      }} title="Link"><span className="text-lg">🔗</span></button>
      {/* Undo/Redo */}
      <button className="btn btn-sm btn-ghost" onClick={() => editor.chain().focus().undo().run()} title="Undo"><span className="text-lg">⎌</span></button>
      <button className="btn btn-sm btn-ghost" onClick={() => editor.chain().focus().redo().run()} title="Redo"><span className="text-lg">⎌⎌</span></button>
    </div>
  );
};

interface Template {
  id: string | number;
  name: string;
  content: any;
  created_at?: string;
  language_id: string | number | null;
  sourceTable: 'contract_templates' | 'misc_contracttemplate';
  active?: boolean;
  firm_id?: number;
  default_pricing_tiers?: any;
  default_currency?: string;
  default_country?: string;
  category_id?: string | number | null;
}

const getTitleSizeClass = (name: string | undefined) => {
  if (!name) return 'text-lg';
  if (name.length > 80) return 'text-sm';
  if (name.length > 55) return 'text-base';
  return 'text-lg';
};

const ContractTemplatesManager: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSourceTable, setSelectedSourceTable] = useState<'contract_templates' | 'misc_contracttemplate' | null>(null);
  const [name, setName] = useState('');
  const [languageId, setLanguageId] = useState<string | number | null>(null);
  const [categoryId, setCategoryId] = useState<string | number | null>(null);
  const [active, setActive] = useState<boolean>(true);
  const [languages, setLanguages] = useState<any[]>([]);
  const [categories, setCategories] = useState<{ id: string | number; name: string; mainName?: string; label: string }[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLanguage, setFilterLanguage] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'box' | 'list'>('box');
  const [previewData, setPreviewData] = useState({ 
    date: '2024-06-01',
    discount_percentage: 10,
    currency: 'USD',
    client_country: 'US',
    pricing_tiers: {
      '1': 2500,
      '2': 2400,
      '3': 2300,
      '4-7': 2200,
      '8-9': 2100,
      '10-15': 2000,
      '16+': 1900
    }
  });
  const [dynamicFields, setDynamicFields] = useState<{ [key: string]: string }>({});
  const [signatureData, setSignatureData] = useState<{ [key: string]: string }>({});
  const signatureRefs = React.useRef<{ [key: string]: SignatureCanvas | null }>({});
  const [quickEditTemplate, setQuickEditTemplate] = useState<Template | null>(null);
  const [quickEditValues, setQuickEditValues] = useState({
    name: '',
    languageId: '',
    categoryId: '',
    categoryInput: '',
    active: true
  });
  const [isQuickSaving, setIsQuickSaving] = useState(false);
  const [isQuickCreating, setIsQuickCreating] = useState(false);
  const [isQuickCategoryDropdownOpen, setIsQuickCategoryDropdownOpen] = useState(false);

  // Editor setup - define extensions as a memoized constant so we can reuse them for generateJSON
  // This must be defined before fetchTemplates so we can use it there
  // Memoize to prevent unnecessary re-renders
  // Note: StarterKit already includes Link and Underline, so we don't add them separately
  const editorExtensions = useMemo(() => [
    StarterKit,
    Placeholder.configure({ placeholder: 'Write your contract template here...' }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight,
    Color,
    TextStyle,
    FontFamily,
    FontSize,
  ], []); // Empty dependency array - extensions never change

  // Load templates from both tables
  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch from contract_templates
      const { data: contractTemplatesData, error: contractTemplatesError } = await supabase
        .from('contract_templates')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10000); // High limit to fetch all templates
      
      // Fetch from misc_contracttemplate
      const { data: miscTemplatesData, error: miscTemplatesError } = await supabase
        .from('misc_contracttemplate')
        .select('*')
        .order('name', { ascending: true })
        .limit(10000); // High limit to fetch all templates
      
      const allTemplates: Template[] = [];
      
      // Process contract_templates
      if (contractTemplatesError) {
        console.error('Error fetching contract_templates:', contractTemplatesError);
      }
      if (contractTemplatesData) {
        console.log(`✅ Fetched ${contractTemplatesData.length} templates from contract_templates`);
        contractTemplatesData.forEach((template: any) => {
          allTemplates.push({
            id: template.id,
            name: template.name,
            content: template.content,
            created_at: template.created_at,
            language_id: template.language_id,
            sourceTable: 'contract_templates',
            active: template.active !== undefined ? template.active : true, // Default to true if not set
            firm_id: template.firm_id,
            default_pricing_tiers: template.default_pricing_tiers,
            default_currency: template.default_currency,
            default_country: template.default_country,
            category_id: template.category_id,
          });
        });
      }
      
      // Process misc_contracttemplate
      if (miscTemplatesError) {
        console.error('Error fetching misc_contracttemplate:', miscTemplatesError);
      }
      if (miscTemplatesData) {
        console.log(`✅ Fetched ${miscTemplatesData.length} templates from misc_contracttemplate`);
        miscTemplatesData.forEach((template: any) => {
          console.log('🔍 Processing misc_contracttemplate:', template.id, template.name);
          console.log('🔍 Raw content type:', typeof template.content);
          console.log('🔍 Raw content:', template.content);
          
          // Content is now JSONB, so it should already be an object
          let content = template.content;
          
          // Handle different content formats
          if (typeof content === 'string') {
            try {
              // Try to parse as JSON if it's a string
              content = JSON.parse(content);
              console.log('🔍 Parsed JSON string to object:', content);
            } catch (e) {
              console.warn('⚠️ Failed to parse content as JSON, converting to TipTap format:', e);
              // If not JSON, convert plain text to TipTap JSON format
              content = {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: content }]
                  }
                ]
              };
            }
          }
          
          // Check if content is in Quill format (has html and/or delta properties)
          if (content && typeof content === 'object' && content !== null) {
            if (content.html) {
              console.log('🔍 Detected Quill format, extracting HTML property');
              // Extract HTML from Quill format
              let htmlContent = content.html;
              
              // Clean Quill-specific classes and convert to standard HTML
              // First, do a global pass to remove all ql-* classes and extract alignment/direction info
              htmlContent = htmlContent.replace(/<(\w+)([^>]*)>/g, (match: string, tagName: string, attributes: string) => {
                let cleanedAttributes = attributes;
                let textAlign: string | null = null;
                let direction: string | null = null;
                
                // Extract ql-align-* classes BEFORE removing them
                const alignMatch = attributes.match(/class=["'][^"']*ql-align-(\w+)[^"']*["']/);
                if (alignMatch) {
                  const alignValue = alignMatch[1];
                  const styleMap: { [key: string]: string } = {
                    'left': 'left',
                    'center': 'center',
                    'right': 'right',
                    'justify': 'justify'
                  };
                  textAlign = styleMap[alignValue] || 'left';
                }
                
                // Extract ql-direction-rtl BEFORE removing it
                if (attributes.match(/class=["'][^"']*ql-direction-rtl[^"']*["']/)) {
                  direction = 'rtl';
                }
                
                // Remove all ql-* classes from class attributes (handle both single and double quotes)
                cleanedAttributes = cleanedAttributes.replace(/class=(["'])([^"']*)\1/g, (classMatch: string, quote: string, classValue: string) => {
                  const cleanedClasses = classValue
                    .split(/\s+/)
                    .filter(cls => cls && !cls.startsWith('ql-'))
                    .join(' ');
                  return cleanedClasses ? `class=${quote}${cleanedClasses}${quote}` : '';
                });
                
                // Remove empty class attributes (handle both single and double quotes)
                cleanedAttributes = cleanedAttributes.replace(/\s*class=["']\s*["']/g, '');
                
                // Add style attribute for text-align if needed
                if (textAlign) {
                  if (cleanedAttributes.match(/style=["']/)) {
                    // Append to existing style
                    cleanedAttributes = cleanedAttributes.replace(/style=(["'])([^"']*)\1/g, (styleMatch: string, quote: string, styleValue: string) => {
                      if (!styleValue.includes('text-align')) {
                        return `style=${quote}${styleValue}; text-align: ${textAlign}${quote}`;
                      }
                      return styleMatch;
                    });
                  } else {
                    // Add new style attribute
                    cleanedAttributes = `${cleanedAttributes} style="text-align: ${textAlign}"`.trim();
                  }
                }
                
                // Add dir attribute if needed
                if (direction && !cleanedAttributes.match(/dir=["']/)) {
                  cleanedAttributes = `${cleanedAttributes} dir="${direction}"`.trim();
                }
                
                // Clean up extra spaces
                cleanedAttributes = cleanedAttributes.replace(/\s+/g, ' ').trim();
                
                return `<${tagName}${cleanedAttributes ? ' ' + cleanedAttributes : ''}>`;
              });
              
              // Second pass: remove any remaining ql-* classes that might have been missed
              // This handles edge cases where classes might not have been caught in the first pass
              htmlContent = htmlContent.replace(/class=(["'])([^"']*)\1/g, (classMatch: string, quote: string, classValue: string) => {
                const cleanedClasses = classValue
                  .split(/\s+/)
                  .filter(cls => cls && !cls.startsWith('ql-'))
                  .join(' ');
                return cleanedClasses ? `class=${quote}${cleanedClasses}${quote}` : '';
              });
              
              // Remove any empty class attributes left after cleaning
              htmlContent = htmlContent.replace(/\s*class=["']\s*["']/g, '');
              
              console.log('🔍 Cleaned HTML content:', htmlContent);
              
              // Ensure the HTML is wrapped in a proper structure for TipTap parsing
              // TipTap expects content to be in block elements (p, div, etc.)
              // If the HTML doesn't start with a block element, wrap it
              const trimmedHtml = htmlContent.trim();
              if (trimmedHtml && !trimmedHtml.match(/^<(p|div|h[1-6]|ul|ol|blockquote|pre)/i)) {
                // Wrap in a div to ensure proper parsing
                htmlContent = `<div>${trimmedHtml}</div>`;
              }
              
              // Convert HTML to TipTap JSON format using generateJSON
              // This ensures the content is stored in the correct format from the start
              // Use htmlContent (which may have been wrapped) instead of trimmedHtml
              try {
                console.log('🔍 Converting cleaned HTML to TipTap JSON format');
                const finalHtml = htmlContent.trim();
                const jsonContent = generateJSON(finalHtml, editorExtensions);
                console.log('✅ Successfully converted HTML to TipTap JSON');
                console.log('🔍 Converted JSON structure:', {
                  type: jsonContent?.type,
                  hasContent: !!jsonContent?.content,
                  contentLength: jsonContent?.content?.length || 0
                });
                
                // Validate the JSON structure
                if (jsonContent && jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
                  content = jsonContent; // Store as TipTap JSON format
                } else {
                  console.error('❌ Invalid JSON structure after conversion:', jsonContent);
                  // Fallback to HTML string if structure is invalid
                  content = htmlContent;
                }
              } catch (conversionError) {
                console.error('❌ Error converting HTML to JSON, storing as HTML string:', conversionError);
                // Fallback to HTML string if conversion fails
                content = htmlContent;
              }
            } else if (content.type === 'doc') {
              // Already in TipTap format
              console.log('🔍 Content is already in TipTap format');
            } else if (!content) {
              // Empty content, create empty doc
              console.log('🔍 Content is empty, creating empty doc');
              content = {
                type: 'doc',
                content: []
              };
            } else {
              // Unknown object format, try to use as-is
              console.log('🔍 Content is object but not recognized format, using as-is');
            }
          } else if (!content) {
            // Empty content, create empty doc
            console.log('🔍 Content is empty, creating empty doc');
            content = {
              type: 'doc',
              content: []
            };
          }
          
          console.log('🔍 Final processed content:', content);
          
          allTemplates.push({
            id: template.id,
            name: template.name,
            content: content,
            language_id: template.language_id,
            sourceTable: 'misc_contracttemplate',
            active: template.active !== undefined ? template.active : true, // Default to true if not set
            firm_id: template.firm_id,
            category_id: template.category_id,
          });
        });
      }
      
      // Sort by name for consistent display
      allTemplates.sort((a, b) => a.name.localeCompare(b.name));
      
      console.log(`✅ Total templates loaded: ${allTemplates.length} (${allTemplates.filter(t => t.sourceTable === 'contract_templates').length} from contract_templates, ${allTemplates.filter(t => t.sourceTable === 'misc_contracttemplate').length} from misc_contracttemplate)`);
      
      setTemplates(allTemplates);
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // Fetch languages from misc_languages table
  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        // Try misc_languages first (as user specified), fallback to misc_language
        let { data, error } = await supabase
          .from('misc_languages')
          .select('id, name')
          .order('name', { ascending: true });
        
        if (error) {
          // Fallback to misc_language if misc_languages doesn't exist
          const fallbackResult = await supabase
            .from('misc_language')
            .select('id, name')
            .order('name', { ascending: true });
          data = fallbackResult.data;
          error = fallbackResult.error;
        }
        
        if (error) throw error;
        setLanguages(data || []);
      } catch (error) {
        console.error('Error fetching languages:', error);
      }
    };
    
    fetchLanguages();
  }, []);

  // Fetch categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_category')
          .select('id, name, misc_maincategory ( name )')
          .order('name', { ascending: true });

        if (error) throw error;
        setCategories(
          (data || []).map((cat: any) => {
            const mainName = cat.misc_maincategory?.name || '';
            return {
              id: cat.id,
              name: cat.name,
              mainName,
              label: mainName ? `${cat.name} (${mainName})` : cat.name
            };
          })
        );
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };

    fetchCategories();
  }, []);

  // Get language name by ID
  const getLanguageName = (langId: string | number | null | undefined): string => {
    if (!langId || !languages.length) return 'Not set';
    const language = languages.find(lang => String(lang.id) === String(langId));
    return language?.name || 'Not set';
  };

  const getCategoryLabel = (catId: string | number | null | undefined): string => {
    if (!catId || !categories.length) return 'Not set';
    const category = categories.find(cat => String(cat.id) === String(catId));
    return category?.label || category?.name || 'Not set';
  };

  useEffect(() => {
    if (!quickEditTemplate) return;
    const categoryLabel = quickEditTemplate.category_id ? getCategoryLabel(quickEditTemplate.category_id) : '';
    setQuickEditValues({
      name: quickEditTemplate.name,
      languageId: quickEditTemplate.language_id ? String(quickEditTemplate.language_id) : '',
      categoryId: quickEditTemplate.category_id ? String(quickEditTemplate.category_id) : '',
      categoryInput: categoryLabel !== 'Not set' ? categoryLabel : '',
      active: quickEditTemplate.active !== undefined ? quickEditTemplate.active : true,
    });
  }, [quickEditTemplate, categories]);

  const filteredQuickCategories = useMemo(() => {
    const term = (quickEditValues.categoryInput || '').trim().toLowerCase();
    if (!term) {
      return categories.slice(0, 50);
    }
    return categories
      .filter((cat) => cat.label.toLowerCase().includes(term))
      .slice(0, 50);
  }, [categories, quickEditValues.categoryInput]);

  // Filter templates based on search term, language, and active status
  const filteredTemplates = useMemo(() => {
    let filtered = templates;
    
    // Filter by search term
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(template =>
        template.name.toLowerCase().includes(searchLower)
      );
    }
    
    // Filter by language
    if (filterLanguage) {
      filtered = filtered.filter(template => {
        const templateLangId = template.language_id ? String(template.language_id) : null;
        return templateLangId === filterLanguage;
      });
    }
    
    // Filter by active status
    if (filterActive !== 'all') {
      filtered = filtered.filter(template => {
        const isActive = template.active !== undefined ? template.active : true;
        return filterActive === 'active' ? isActive : !isActive;
      });
    }

    if (filterCategory) {
      filtered = filtered.filter(template =>
        template.category_id ? String(template.category_id) === filterCategory : false
      );
    }
    
    return filtered;
  }, [templates, searchTerm, filterLanguage, filterActive, filterCategory]);

  const selectedTemplate = useMemo(() => {
    if (!selectedId || !selectedSourceTable) return null;
    // Convert both to strings for comparison since IDs can be numbers or strings
    return templates.find(t => String(t.id) === String(selectedId) && t.sourceTable === selectedSourceTable);
  }, [templates, selectedId, selectedSourceTable]);
  
  // Initialize editor with empty content (like ContractPage.tsx)
  // Content will be loaded via useEffect when a template is selected
  const editor = useEditor({
    extensions: editorExtensions,
    content: { type: 'doc', content: [] }, // Always start with empty JSON
    parseOptions: {
      preserveWhitespace: 'full',
    },
    onUpdate: ({ editor }) => {
      // No-op, handled on save
    },
  });

  // Update editor content when switching templates
  // Content should already be in TipTap JSON format from fetchTemplates
  useEffect(() => {
    console.log('🔍 useEffect triggered:', {
      hasEditor: !!editor,
      selectedId,
      selectedSourceTable,
      showEditor,
      hasSelectedTemplate: !!selectedTemplate,
      editorDestroyed: editor?.isDestroyed
    });
    
    if (editor && !selectedId && showEditor) {
      // New template - empty content (only for contract_templates)
      console.log('📝 New template - setting empty content');
      editor.commands.setContent({ type: 'doc', content: [] });
      setName('Untitled Contract');
      setLanguageId(null);
      setActive(true);
      return;
    }
    
    if (!editor) {
      console.log('⚠️ No editor available');
      return;
    }
    
    if (!selectedTemplate) {
      console.log('⚠️ No selected template');
      return;
    }
    
    if (!showEditor) {
      console.log('⚠️ Editor not shown');
      return;
    }
    
    // Ensure editor is ready before loading content
    if (editor.isDestroyed) {
      console.log('⚠️ Editor is destroyed');
      return;
    }
    
    console.log('📝 Loading template into editor:', selectedTemplate.id, selectedTemplate.name);
    console.log('📝 Template source:', selectedTemplate.sourceTable);
    console.log('📝 Template content:', selectedTemplate.content);
    console.log('📝 Content type:', typeof selectedTemplate.content);
    
    // Content should already be in TipTap JSON format from fetchTemplates
    // But handle edge cases where it might still be HTML string (for backwards compatibility)
    let contentToLoad = selectedTemplate.content;
    
    // If content is null or undefined, create empty doc
    if (!contentToLoad) {
      console.log('⚠️ Content is null/undefined, creating empty doc');
      contentToLoad = { type: 'doc', content: [] };
    }
    // If content is still an HTML string (shouldn't happen after our fix, but handle it)
    else if (typeof contentToLoad === 'string' && contentToLoad.trim().startsWith('<')) {
      console.log('📝 Content is still HTML string, converting to JSON');
      try {
        const trimmedContent = contentToLoad.trim();
        if (trimmedContent) {
          contentToLoad = generateJSON(trimmedContent, editorExtensions);
          console.log('✅ Converted HTML to TipTap JSON');
        } else {
          contentToLoad = { type: 'doc', content: [] };
        }
      } catch (e) {
        console.error('❌ Error converting HTML to JSON:', e);
        contentToLoad = { type: 'doc', content: [] };
      }
    }
    // If content is already JSON (expected case)
    else if (typeof contentToLoad === 'object' && contentToLoad !== null) {
      console.log('📝 Content is already in JSON format (expected)');
      // Use as-is - should be TipTap JSON format
    }
    
    // Load content into editor
    // Use requestAnimationFrame to ensure editor DOM is ready
    requestAnimationFrame(() => {
      try {
        if (editor.isDestroyed) {
          console.error('❌ Editor is destroyed, cannot set content');
          return;
        }
        
        console.log('📝 Setting content to editor');
        console.log('📝 Content structure:', {
          type: contentToLoad?.type,
          hasContent: !!contentToLoad?.content,
          contentLength: contentToLoad?.content?.length || 0
        });
        
        // Ensure editor is editable
        editor.setEditable(true);
        
        // Clear editor first to ensure clean state
        editor.commands.clearContent();
        
        // Set the content
        editor.commands.setContent(contentToLoad, { emitUpdate: false });
        
        // Verify content was set correctly
        const currentContent = editor.getJSON();
        console.log('✅ Content set. Editor has nodes:', currentContent?.content?.length || 0);
        
        if (!currentContent?.content || currentContent.content.length === 0) {
          console.warn('⚠️ Warning: Editor content appears empty after setting');
          // Force a re-render by setting content again
          setTimeout(() => {
            if (!editor.isDestroyed) {
              editor.commands.setContent(contentToLoad, { emitUpdate: false });
              const retryContent = editor.getJSON();
              console.log('🔄 Retry - Content has nodes:', retryContent?.content?.length || 0);
            }
          }, 100);
        }
      } catch (e) {
        console.error('❌ Error setting content to editor:', e);
        // Fallback to empty doc
        try {
          if (!editor.isDestroyed) {
            editor.commands.setContent({ type: 'doc', content: [] });
          }
        } catch (fallbackError) {
          console.error('❌ Even fallback failed:', fallbackError);
        }
      }
    });
    
    setName(selectedTemplate.name);
    setLanguageId(selectedTemplate.language_id || null);
    setCategoryId(selectedTemplate.category_id || null);
    setActive(selectedTemplate.active !== undefined ? selectedTemplate.active : true);
    
    // Load default pricing tiers if they exist (only for contract_templates)
    if (selectedTemplate.sourceTable === 'contract_templates' && selectedTemplate.default_pricing_tiers) {
      setPreviewData(prev => ({
        ...prev,
        pricing_tiers: selectedTemplate.default_pricing_tiers,
        currency: selectedTemplate.default_currency || prev.currency,
        client_country: selectedTemplate.default_country || prev.client_country,
        discount_percentage: prev.discount_percentage
      }));
    }
  }, [selectedId, selectedSourceTable, editor, showEditor, selectedTemplate, editorExtensions]);

  // Insert dynamic field
  const insertField = (tag: string) => {
    if (editor) {
      editor.chain().focus().insertContent(tag).run();
    }
  };

  // Save template
  const handleSave = async () => {
    if (!editor) return;
    if (!name.trim()) {
      alert('Please enter a template name');
      return;
    }
    setIsSaving(true);
    const content = editor.getJSON();
    
    try {
      if (selectedId && selectedSourceTable) {
        // Update existing template
        if (selectedSourceTable === 'contract_templates') {
          const templateData: any = {
            name: name.trim(),
            content,
            default_pricing_tiers: previewData.pricing_tiers,
            default_currency: previewData.currency,
            default_country: previewData.client_country,
            language_id: languageId || null,
            active: active,
            category_id: categoryId || null
          };
          const { error } = await supabase
            .from('contract_templates')
            .update(templateData)
            .eq('id', selectedId);
          if (error) throw error;
        } else if (selectedSourceTable === 'misc_contracttemplate') {
          // For misc_contracttemplate, content is now JSONB so save as JSON object directly
          console.log('💾 Saving misc_contracttemplate:', selectedId);
          console.log('💾 Content to save:', content);
          console.log('💾 Content type:', typeof content);
          
          const templateData: any = {
            name: name.trim(),
            content: content, // Save as JSON object directly (JSONB column)
            language_id: languageId || null,
            category_id: categoryId || null,
            active: active
          };
          
          console.log('💾 Template data to save:', templateData);
          
          const { error } = await supabase
            .from('misc_contracttemplate')
            .update(templateData)
            .eq('id', selectedId);
          
          if (error) {
            console.error('❌ Error saving misc_contracttemplate:', error);
            throw error;
          }
          
          console.log('✅ Successfully saved misc_contracttemplate');
        }
      } else {
        // Create new template (only in contract_templates as per requirement)
        const id = uuidv4();
        const templateData: any = {
          id,
          name: name.trim(),
          content,
          default_pricing_tiers: previewData.pricing_tiers,
          default_currency: previewData.currency,
          default_country: previewData.client_country,
          language_id: languageId || null,
          category_id: categoryId || null,
          active: active
        };
        const { error } = await supabase
          .from('contract_templates')
          .insert([templateData]);
        if (error) throw error;
        setSelectedId(id);
        setSelectedSourceTable('contract_templates');
      }
      await fetchTemplates();
      alert('Template saved successfully!');
    } catch (error: any) {
      console.error('Error saving template:', error);
      alert('Error saving template: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  // Create new template (only in contract_templates)
  const handleCreate = () => {
    const newTemplateId = uuidv4();
    const stubTemplate: Template = {
      id: newTemplateId,
      name: 'Untitled Contract',
      content: { type: 'doc', content: [] },
      language_id: null,
      category_id: null,
      sourceTable: 'contract_templates',
      active: true
    };
    openQuickEditDrawer(stubTemplate, { isNew: true });
  };

  const openQuickEditDrawer = (template: Template, options?: { isNew?: boolean }) => {
    setQuickEditTemplate(template);
    setIsQuickCreating(Boolean(options?.isNew));
  };

  const closeQuickEditDrawer = () => {
    setQuickEditTemplate(null);
    setIsQuickCreating(false);
  };

  const handleQuickSave = async () => {
    if (!quickEditTemplate) return;
    const trimmedName = quickEditValues.name.trim();
    if (!trimmedName) {
      alert('Template name is required');
      return;
    }

    setIsQuickSaving(true);
    try {
      if (isQuickCreating) {
        const newTemplateData: any = {
          id: quickEditTemplate.id,
          name: trimmedName,
          content: { type: 'doc', content: [] },
          default_pricing_tiers: previewData.pricing_tiers,
          default_currency: previewData.currency,
          default_country: previewData.client_country,
          language_id: quickEditValues.languageId || null,
          category_id: quickEditValues.categoryId || null,
          active: quickEditValues.active
        };

        const { error } = await supabase
          .from('contract_templates')
          .insert([newTemplateData]);

        if (error) throw error;
        await fetchTemplates();
        closeQuickEditDrawer();
        setSelectedId(String(newTemplateData.id));
        setSelectedSourceTable('contract_templates');
        setName(trimmedName);
        setLanguageId(quickEditValues.languageId || null);
        setCategoryId(quickEditValues.categoryId || null);
        setActive(quickEditValues.active);
        setShowEditor(true);
        setIsPreview(false);
        if (editor) {
          editor.commands.setContent({ type: 'doc', content: [] });
        }
      } else {
        const payload: any = {
          name: trimmedName,
          language_id: quickEditValues.languageId || null,
          category_id: quickEditValues.categoryId || null,
          active: quickEditValues.active,
        };

        const { error } = await supabase
          .from(quickEditTemplate.sourceTable)
          .update(payload)
          .eq('id', quickEditTemplate.id);

        if (error) throw error;
        await fetchTemplates();
        closeQuickEditDrawer();
      }
    } catch (error: any) {
      console.error('Error saving template metadata:', error);
      alert(error.message || 'Failed to save template changes.');
    } finally {
      setIsQuickSaving(false);
    }
  };

  const handleOpenEditorFromDrawer = () => {
    if (!quickEditTemplate) return;
    const { id, sourceTable } = quickEditTemplate;
    closeQuickEditDrawer();
    handleEditTemplate(id, sourceTable);
  };

  // Open template for editing
  const handleEditTemplate = (id: string | number, sourceTable: 'contract_templates' | 'misc_contracttemplate') => {
    setSelectedId(String(id));
    setSelectedSourceTable(sourceTable);
    const template = templates.find(t => t.id === id && t.sourceTable === sourceTable);
    if (template) {
      setName(template.name);
       setLanguageId(template.language_id || null);
       setCategoryId(template.category_id || null);
       setActive(template.active !== undefined ? template.active : true);
      setShowEditor(true);
      setIsPreview(false);
    }
  };

  // Go back to list view
  const handleBackToList = () => {
    setShowEditor(false);
    setSelectedId(null);
    setSelectedSourceTable(null);
    setIsPreview(false);
    setLanguageId(null);
    setCategoryId(null);
    setActive(true);
  };

  // Delete template with confirmation
  const handleDelete = async (id: string | number, sourceTable: 'contract_templates' | 'misc_contracttemplate', e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    
    const template = templates.find(t => t.id === id && t.sourceTable === sourceTable);
    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${template?.name || 'this template'}"? This action cannot be undone.`
    );
    
    if (confirmDelete) {
      const { error } = await supabase
        .from(sourceTable)
        .delete()
        .eq('id', id);
      
      if (!error) {
        await fetchTemplates();
        // If we deleted the currently selected template, go back to list
        if (selectedId === String(id) && selectedSourceTable === sourceTable) {
          handleBackToList();
        }
      } else {
        alert('Error deleting template: ' + error.message);
      }
    }
  };

  // Render preview with React components for dynamic fields
  const renderPreview = () => {
    if (!editor) return null;
    const content: JSONContent = editor.getJSON();
    let textFieldIdx = 0;
    let signatureFieldIdx = 0;
    
    // Update existing pricing content in the template instead of adding new section
    const updateExistingPricing = (content: JSONContent): JSONContent => {
      if (!content.content) return content;
      
      const tierStructure = [
        { key: '1', label: 'For one applicant' },
        { key: '2', label: 'For 2 applicants' },
        { key: '3', label: 'For 3 applicants' },
        { key: '4-7', label: 'For 4-7 applicants' },
        { key: '8-9', label: 'For 8-9 applicants' },
        { key: '10-15', label: 'For 10-15 applicants' },
        { key: '16+', label: 'For 16 applicants or more' }
      ];
      
      // Recursively update content to replace pricing placeholders
      const updateNode = (node: any): any => {
        if (node.type === 'text' && node.text) {
          let updatedText = node.text;
          
          // Replace pricing tier placeholders with actual values
          tierStructure.forEach(tier => {
            const price = previewData.pricing_tiers[tier.key as keyof typeof previewData.pricing_tiers] || 0;
            const priceText = `${previewData.currency} ${price.toLocaleString()}`;
            
            // Replace {{price_per_applicant}} in the context of specific tier lines
            const tierRegex = new RegExp(`(${tier.label}[^\\n]*?):?\\s*\\{\\{price_per_applicant\\}\\}`, 'g');
            updatedText = updatedText.replace(tierRegex, `$1: ${priceText}`);
            
            // Also replace any general {{price_per_applicant}} with the first tier price
            if (updatedText.includes('{{price_per_applicant}}')) {
              const firstTierPrice = previewData.pricing_tiers['1'] || 0;
              updatedText = updatedText.replace(/\{\{price_per_applicant\}\}/g, `${previewData.currency} ${firstTierPrice.toLocaleString()}`);
            }
          });
          
          return { ...node, text: updatedText };
        }
        
        if (node.content) {
          return { ...node, content: node.content.map(updateNode) };
        }
        
        return node;
      };
      
      return updateNode(content);
    };
    
    // Update existing pricing content instead of adding new section
    const contentWithUpdatedPricing = updateExistingPricing(content);

    // Use preview data with pricing tiers for template preview
    const calculatedPricing = {
      ...previewData,
      price_per_applicant: 0, // Not used in template preview
      total_amount: 0, // Not used in template preview
      discount_amount: 0, // Not used in template preview
      final_amount: 0, // Not used in template preview
      pricing_tiers: previewData.pricing_tiers, // Use the actual pricing tiers from preview data
    };

    // Helper to recursively render TipTap JSON nodes
    const renderNode = (node: any, key: string | number): React.ReactNode => {
      if (node.type === 'text') {
        let text = node.text;
        // Replace {{date}}, etc. with previewData and calculatedPricing
        Object.entries({ ...previewData, ...calculatedPricing }).forEach(([k, v]) => {
          text = text.replaceAll(`{{${k}}}`, String(v));
        });
        
        // Handle client fields with placeholder values for preview
        text = text.replaceAll('{{client_name}}', 'John Doe');
        text = text.replaceAll('{{client_phone}}', '+1-555-0123');
        text = text.replaceAll('{{client_email}}', 'john.doe@example.com');
        
                  // Handle pricing tier placeholders - using the same logic as ContractPage.tsx
          if (text && calculatedPricing.pricing_tiers) {
            const currency = calculatedPricing.currency || 'USD';
            const tierStructure = [
              { key: '1', label: 'For one applicant' },
              { key: '2', label: 'For 2 applicants' },
              { key: '3', label: 'For 3 applicants' },
              { key: '4-7', label: 'For 4-7 applicants' },
              { key: '8-9', label: 'For 8-9 applicants' },
              { key: '10-15', label: 'For 10-15 applicants' },
              { key: '16+', label: 'For 16 applicants or more' }
            ];
            
            // Replace specific tier placeholders that we added to the template
            tierStructure.forEach(tier => {
              const price = calculatedPricing.pricing_tiers[tier.key as keyof typeof calculatedPricing.pricing_tiers] || 0;
              const tierPlaceholder = `{{${tier.key}_tier_price}}`;
              if (text.includes(tierPlaceholder)) {
                text = text.replace(new RegExp(tierPlaceholder, 'g'), `${currency} ${price.toLocaleString()}`);
              }
            });
            
            // Handle individual pricing tier placeholders like in ContractPage.tsx
            text = text.replace(/For one applicant-\s*[A-Z]{2,3}\s*[\d,]+/g, 
              `For one applicant- ${currency} ${(calculatedPricing.pricing_tiers['1'] || 0).toLocaleString()}`);
            
            text = text.replace(/For 2 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g, 
              `For 2 applicants- ${currency} ${(calculatedPricing.pricing_tiers['2'] || 0).toLocaleString()}`);
            
            text = text.replace(/For 3 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g, 
              `For 3 applicants- ${currency} ${(calculatedPricing.pricing_tiers['3'] || 0).toLocaleString()}`);
            
            text = text.replace(/For 4-7 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g, 
              `For 4-7 applicants- ${currency} ${(calculatedPricing.pricing_tiers['4-7'] || 0).toLocaleString()}`);
            
            text = text.replace(/For 8-9 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g, 
              `For 8-9 applicants- ${currency} ${(calculatedPricing.pricing_tiers['8-9'] || 0).toLocaleString()}`);
            
            text = text.replace(/For 10-15 applicants-\s*[A-Z]{2,3}\s*[\d,]+/g, 
              `For 10-15 applicants- ${currency} ${(calculatedPricing.pricing_tiers['10-15'] || 0).toLocaleString()}`);
            
            text = text.replace(/For 16 applicants or more-\s*[A-Z]{2,3}\s*[\d,]+/g, 
              `For 16 applicants or more- ${currency} ${(calculatedPricing.pricing_tiers['16+'] || 0).toLocaleString()}`);
            
            // Also replace any general price_per_applicant with the first tier price as fallback
            if (text.includes('{{price_per_applicant}}')) {
              const firstTierPrice = calculatedPricing.pricing_tiers['1'] || 0;
              text = text.replace(/\{\{price_per_applicant\}\}/g, `${currency} ${firstTierPrice.toLocaleString()}`);
            }
          }
        // Replace {{text}} and {{signature}} with React fields
        if (text.includes('{{text}}')) {
          const parts = text.split(/(\{\{text\}\})/g);
          return parts.map((part: any, idx: number) =>
            part === '{{text}}'
              ? <input
                  key={key + '-text-' + idx}
                  className="inline-block border border-base-300 rounded px-2 py-1 mx-1 min-w-[80px]"
                  value={dynamicFields[`text_${textFieldIdx}`] || ''}
                  placeholder="Type here..."
                  onChange={e => setDynamicFields(f => ({ ...f, [`text_${textFieldIdx}`]: e.target.value }))}
                  style={{ display: 'inline-block', verticalAlign: 'middle' }}
                />
              : (textFieldIdx++, part)
          );
        }
        if (text.includes('{{signature}}')) {
          const parts = text.split(/(\{\{signature\}\})/g);
          return parts.map((part: any, idx: number) =>
            part === '{{signature}}'
              ? <span key={key + '-sig-' + idx} style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 8px' }}>
                  <SignatureCanvas
                    penColor="#111"
                    canvasProps={{ width: 180, height: 60, style: { border: '1px solid #ccc', borderRadius: 6, background: '#fff', width: 180, height: 60 } }}
                    ref={ref => {
                      if (ref) signatureRefs.current[`signature_${signatureFieldIdx}`] = ref;
                    }}
                    onEnd={() => {
                      const ref = signatureRefs.current[`signature_${signatureFieldIdx}`];
                      if (ref) setSignatureData(s => ({ ...s, [`signature_${signatureFieldIdx}`]: ref.toDataURL() }));
                    }}
                  />
                </span>
              : (signatureFieldIdx++, part)
          );
        }
        // Render normal text
        return text;
      }
      // Render marks (bold, italic, etc.)
      if (node.marks && node.marks.length > 0) {
        return node.marks.reduce((acc: any, mark: any) => {
          if (mark.type === 'bold') return <b key={key}>{acc}</b>;
          if (mark.type === 'italic') return <i key={key}>{acc}</i>;
          if (mark.type === 'underline') return <u key={key}>{acc}</u>;
          if (mark.type === 'strike') return <s key={key}>{acc}</s>;
          return acc;
        }, renderNode({ ...node, marks: [] }, key));
      }
      // Render block nodes
      switch (node.type) {
        case 'paragraph':
          return <p key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</p>;
        case 'heading':
          const level = node.attrs?.level || 1;
          switch (level) {
            case 1: return <h1 key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</h1>;
            case 2: return <h2 key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</h2>;
            case 3: return <h3 key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</h3>;
            case 4: return <h4 key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</h4>;
            case 5: return <h5 key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</h5>;
            case 6: return <h6 key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</h6>;
            default: return <h1 key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</h1>;
          }
        case 'bulletList':
          return <ul key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</ul>;
        case 'orderedList':
          return <ol key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</ol>;
        case 'listItem':
          return <li key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</li>;
        case 'blockquote':
          return <blockquote key={key}>{node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i))}</blockquote>;
        case 'horizontalRule':
          return <hr key={key} />;
        case 'hardBreak':
          return <br key={key} />;
        default:
          return node.content?.map((n: any, i: number) => renderNode(n, key + '-' + i));
      }
    };

    return (
      <div className="prose max-w-full text-black min-h-[300px] space-y-2">
        {contentWithUpdatedPricing.content?.map((n: any, i: number) => renderNode(n, i))}
      </div>
    );
  };

  // List View
  if (!showEditor) {
    return (
      <div className="w-full">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Contract Templates</h2>
            <p className="text-sm text-gray-500 mt-1">Manage your contract templates</p>
          </div>
          <div className="flex items-center gap-4">
            {/* View Toggle */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('box')}
                className={`p-2 rounded-md transition-all ${
                  viewMode === 'box'
                    ? 'bg-white shadow-sm text-primary'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                title="Box view"
              >
                <Squares2X2Icon className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-md transition-all ${
                  viewMode === 'list'
                    ? 'bg-white shadow-sm text-primary'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                title="List view"
              >
                <TableCellsIcon className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={handleCreate}
              className="btn btn-primary gap-2"
            >
              <PlusIcon className="w-5 h-5" />
              New Template
            </button>
          </div>
        </div>

        {/* Search Bar and Filters */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            {/* Search Bar */}
            <div className="form-control w-full sm:max-w-md">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search templates..."
                  className="input input-bordered w-full pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                  <button 
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 btn btn-ghost btn-xs"
                    onClick={() => setSearchTerm('')}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            
            {/* Language Filter */}
            <div className="form-control w-full sm:w-auto sm:min-w-[200px]">
              <select
                className="select select-bordered w-full"
                value={filterLanguage || ''}
                onChange={(e) => setFilterLanguage(e.target.value || null)}
              >
                <option value="">All Languages</option>
                {languages.map(lang => (
                  <option key={lang.id} value={String(lang.id)}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Category Filter */}
            <div className="form-control w-full sm:w-auto sm:min-w-[220px]">
              <select
                className="select select-bordered w-full"
                value={filterCategory || ''}
                onChange={(e) => setFilterCategory(e.target.value || null)}
              >
                <option value="">All Categories</option>
                {categories.map(cat => (
                  <option key={cat.id} value={String(cat.id)}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Active/Inactive Filter */}
            <div className="form-control w-full sm:w-auto sm:min-w-[180px]">
              <select
                className="select select-bordered w-full"
                value={filterActive}
                onChange={(e) => setFilterActive(e.target.value as 'all' | 'active' | 'inactive')}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            
            {/* Clear Filters Button */}
            {(filterLanguage || filterCategory || filterActive !== 'all' || searchTerm) && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSearchTerm('');
                  setFilterLanguage(null);
                  setFilterCategory(null);
                  setFilterActive('all');
                }}
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Loading State */}
        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-12 text-center">
            <div className="loading loading-spinner loading-lg text-primary"></div>
            <p className="text-gray-500 mt-4">Loading templates...</p>
          </div>
        ) : (
          <>
            {/* Templates List */}
            {filteredTemplates.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-12 text-center">
                <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-700 mb-2">
                  {searchTerm ? 'No templates found' : 'No templates yet'}
                </h3>
                <p className="text-gray-500 mb-6">
                  {searchTerm 
                    ? 'Try adjusting your search terms'
                    : 'Get started by creating your first contract template'}
                </p>
                {!searchTerm && (
                  <button
                    onClick={handleCreate}
                    className="btn btn-primary gap-2"
                  >
                    <PlusIcon className="w-5 h-5" />
                    Create First Template
                  </button>
                )}
              </div>
            ) : viewMode === 'box' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTemplates.map(template => (
                  <div
                    key={`${template.sourceTable}_${template.id}`}
                    className="card bg-white shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 cursor-pointer group relative"
                    onClick={() => openQuickEditDrawer(template)}
                  >
                    <div className="card-body p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="p-3 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg">
                            <DocumentTextIcon className="w-6 h-6 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3
                              className={`card-title font-bold text-gray-900 group-hover:text-primary transition-colors break-words leading-tight mb-1 ${getTitleSizeClass(template.name)}`}
                              style={{ wordBreak: 'break-word' }}
                            >
                              {template.name}
                            </h3>
                            {template.created_at && (
                              <p className="text-xs text-gray-500">
                                {new Date(template.created_at).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            className="btn btn-ghost btn-sm text-error hover:bg-red-50"
                            onClick={(e) => handleDelete(template.id, template.sourceTable, e)}
                            title="Delete template"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {/* Badges at bottom left */}
                      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-gray-100">
                        {template.active !== undefined && (
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                            template.active 
                              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' 
                              : 'bg-red-100 text-red-700 border border-red-200'
                          }`}>
                            {template.active ? 'Active' : 'Inactive'}
                          </span>
                        )}
                        {template.category_id && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                            {getCategoryLabel(template.category_id)}
                          </span>
                        )}
                        {template.language_id && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                            {getLanguageName(template.language_id)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="font-semibold text-gray-700">Template Name</th>
                        <th className="font-semibold text-gray-700">Created</th>
                        <th className="font-semibold text-gray-700">Status</th>
                        <th className="font-semibold text-gray-700">Language</th>
                        <th className="font-semibold text-gray-700">Category</th>
                        <th className="font-semibold text-gray-700 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTemplates.map(template => (
                        <tr
                          key={`${template.sourceTable}_${template.id}`}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => openQuickEditDrawer(template)}
                        >
                          <td>
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg">
                                <DocumentTextIcon className="w-4 h-4 text-white" />
                              </div>
                              <div>
                                <span className="font-medium text-gray-900 block">{template.name}</span>
                                {template.created_at && (
                                  <span className="text-xs text-gray-500">
                                    {new Date(template.created_at).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="text-sm text-gray-600">
                              {template.created_at 
                                ? new Date(template.created_at).toLocaleDateString()
                                : '-'}
                            </span>
                          </td>
                          <td className="text-sm text-gray-700">
                            {template.active !== undefined ? (template.active ? 'Active' : 'Inactive') : '-'}
                          </td>
                          <td className="text-sm text-gray-700">
                            {template.language_id ? getLanguageName(template.language_id) : '-'}
                          </td>
                          <td className="text-sm text-gray-700">
                            {template.category_id ? getCategoryLabel(template.category_id) : '-'}
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                className="btn btn-ghost btn-sm text-error hover:bg-red-50"
                                onClick={(e) => handleDelete(template.id, template.sourceTable, e)}
                                title="Delete template"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Results count */}
        {searchTerm && filteredTemplates.length > 0 && (
          <div className="mt-4 text-sm text-gray-500">
            Found {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}
          </div>
        )}

        {quickEditTemplate && (
          <>
            <div
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
              onClick={closeQuickEditDrawer}
            />
            <div
              className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">
                    Quick edit
                  </p>
                  <h3 className="text-xl font-semibold text-gray-900 truncate max-w-xs">
                    {quickEditTemplate.name}
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    {quickEditTemplate.sourceTable === 'contract_templates' ? 'Contract template' : 'Legacy template'}
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={closeQuickEditDrawer}>
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium">Template name</span>
                  </label>
                  <input
                    className="input input-bordered w-full"
                    value={quickEditValues.name}
                    onChange={(e) => setQuickEditValues((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium">Language</span>
                  </label>
                  <select
                    className="select select-bordered w-full"
                    value={quickEditValues.languageId}
                    onChange={(e) => setQuickEditValues((prev) => ({ ...prev, languageId: e.target.value }))}
                  >
                    <option value="">Not set</option>
                    {languages.map((lang) => (
                      <option key={lang.id} value={String(lang.id)}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium">Category</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      className="input input-bordered w-full pr-10"
                      placeholder="Search category..."
                      value={quickEditValues.categoryInput}
                      onFocus={() => setIsQuickCategoryDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setIsQuickCategoryDropdownOpen(false), 150)}
                      onChange={(e) => {
                        const value = e.target.value;
                        setQuickEditValues((prev) => ({
                          ...prev,
                          categoryInput: value,
                          categoryId: value ? prev.categoryId : '',
                        }));
                      }}
                    />
                    {quickEditValues.categoryId && (
                      <button
                        type="button"
                        className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() =>
                          setQuickEditValues((prev) => ({
                            ...prev,
                            categoryId: '',
                            categoryInput: '',
                          }))
                        }
                      >
                        ×
                      </button>
                    )}
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      ▼
                    </span>
                    {isQuickCategoryDropdownOpen && filteredQuickCategories.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-auto">
                        {filteredQuickCategories.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            className={`w-full text-left px-4 py-2 hover:bg-gray-50 ${
                              String(cat.id) === quickEditValues.categoryId ? 'bg-primary/10 text-primary font-semibold' : ''
                            }`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setQuickEditValues((prev) => ({
                                ...prev,
                                categoryId: String(cat.id),
                                categoryInput: cat.label,
                              }));
                              setIsQuickCategoryDropdownOpen(false);
                            }}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between border border-gray-200 rounded-xl p-4">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Status</p>
                    <p className="text-xs text-gray-500">
                      {quickEditValues.active ? 'Template is available for use' : 'Template hidden from new contracts'}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={quickEditValues.active}
                    onChange={(e) => setQuickEditValues((prev) => ({ ...prev, active: e.target.checked }))}
                  />
                </div>
              </div>
              <div className="p-5 border-t border-gray-200 space-y-3">
                <button
                  className="btn btn-primary w-full"
                  disabled={isQuickSaving}
                  onClick={handleQuickSave}
                >
                  {isQuickSaving
                    ? 'Saving...'
                    : isQuickCreating
                      ? 'Save & open editor'
                      : 'Save changes'}
                </button>
                {!isQuickCreating && (
                  <button className="btn btn-outline w-full" onClick={handleOpenEditorFromDrawer}>
                    Open template editor
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Editor View
  return (
    <div className="w-full">
      {/* Editor Header */}
      <div className="mb-6">
        <button
          onClick={handleBackToList}
          className="btn btn-ghost btn-sm gap-2 mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to Templates
        </button>
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {selectedId ? 'Edit Template' : 'New Template'}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {selectedId ? 'Modify your contract template' : 'Create a new contract template'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-base-100 rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        {/* Main Editor Area */}
        <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 200px)', maxHeight: 'calc(100vh - 200px)' }}>
          <div className="flex items-center gap-4 p-4 border-b border-gray-200">
            <input
              className="input input-bordered flex-1 text-lg font-semibold"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Template Name"
            />
            <select
              className="select select-bordered w-48"
              value={languageId || ''}
              onChange={(e) => setLanguageId(e.target.value || null)}
            >
              <option value="">Select Language...</option>
              {languages.map(lang => (
                <option key={lang.id} value={lang.id}>
                  {lang.name}
                </option>
              ))}
            </select>
            <select
              className="select select-bordered w-48"
              value={categoryId || ''}
              onChange={(e) => setCategoryId(e.target.value || null)}
            >
              <option value="">Select Category...</option>
              {categories.map(cat => (
                <option key={cat.id} value={String(cat.id)}>
                  {cat.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Active</span>
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="dropdown dropdown-bottom">
                <button className="btn btn-sm btn-outline">Client Fields</button>
                <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 z-50">
                  {DYNAMIC_FIELDS.map(f => (
                    <li key={f.tag}><button onClick={() => insertField(f.tag)}>{f.label}</button></li>
                  ))}
                </ul>
              </div>
              <div className="dropdown dropdown-bottom">
                <button className="btn btn-sm btn-outline">Pricing Fields</button>
                <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 z-50">
                  {PRICING_FIELDS.map(f => (
                    <li key={f.tag}><button onClick={() => insertField(f.tag)}>{f.label}</button></li>
                  ))}
                </ul>
              </div>
              <div className="dropdown dropdown-bottom">
                <button className="btn btn-sm btn-outline">Payment Fields</button>
                <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 z-50">
                  {PAYMENT_PLAN_FIELDS.map(f => (
                    <li key={f.tag}><button onClick={() => insertField(f.tag)}>{f.label}</button></li>
                  ))}
                </ul>
              </div>
              <div className="dropdown dropdown-bottom">
                <button className="btn btn-sm btn-outline">Input Fields</button>
                <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 z-50">
                  {FIELD_TYPES.map(f => (
                    <li key={f.tag}><button onClick={() => insertField(f.tag)}>{f.label}</button></li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-sm btn-outline" onClick={() => setIsPreview(p => !p)}>
                {isPreview ? 'Edit' : 'Preview as Client'}
              </button>
              <button 
                className="btn btn-sm btn-primary" 
                onClick={handleSave} 
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          {/* Toolbar */}
          {!isPreview && <div className="px-4 pt-4"><Toolbar editor={editor} /></div>}
          <div className="flex-1 p-6 overflow-y-auto" style={{ minHeight: '600px' }}>
          {!isPreview ? (
            <EditorContent editor={editor} className="prose max-w-full min-h-[800px] border border-base-300 rounded-xl bg-white p-4 text-black" style={{ minHeight: '800px' }} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Preview Data Editor */}
              <div className="lg:col-span-1">
                <div className="card bg-base-100 shadow-sm">
                  <div className="card-body p-4">
                    <h3 className="text-lg font-semibold mb-4">Preview Data</h3>
                    <div className="space-y-3">


                      <div>
                        <label className="label">
                          <span className="label-text">Currency</span>
                        </label>
                        <select
                          className="select select-bordered select-sm w-full"
                          value={previewData.currency}
                          onChange={e => setPreviewData(prev => ({ ...prev, currency: e.target.value }))}
                        >
                          <option value="USD">USD</option>
                          <option value="NIS">NIS</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">
                          <span className="label-text">Discount %</span>
                        </label>
                        <input
                          type="number"
                          className="input input-bordered input-sm w-full"
                          value={previewData.discount_percentage}
                          onChange={e => {
                            const newDiscount = Number(e.target.value);
                            setPreviewData(prev => ({ 
                              ...prev, 
                              discount_percentage: newDiscount
                            }));
                          }}
                        />
                      </div>
                      
                      {/* Pricing Tiers */}
                      <div>
                        <label className="label">
                          <span className="label-text">Pricing Tiers (Price per applicant)</span>
                        </label>
                        <div className="space-y-2">
                          {(() => {
                            // Define the correct order for pricing tiers
                            const tierOrder = ['1', '2', '3', '4-7', '8-9', '10-15', '16+'];
                            return tierOrder.map(tierKey => {
                              const price = previewData.pricing_tiers[tierKey as keyof typeof previewData.pricing_tiers] || 0;
                              return (
                                <div key={tierKey} className="flex items-center gap-2">
                                  <span className="text-xs text-gray-600 w-16">
                                    {tierKey === '1' ? '1 applicant' :
                                     tierKey === '2' ? '2 applicants' :
                                     tierKey === '3' ? '3 applicants' :
                                     tierKey === '4-7' ? '4-7 applicants' :
                                     tierKey === '8-9' ? '8-9 applicants' :
                                     tierKey === '10-15' ? '10-15 applicants' :
                                     tierKey === '16+' ? '16+ applicants' :
                                     '16+ applicants'}
                                  </span>
                                  <input
                                    type="number"
                                    className="input input-bordered input-sm flex-1"
                                    value={price}
                                    onChange={e => {
                                      const newPrice = Number(e.target.value);
                                      const newPricingTiers = { ...previewData.pricing_tiers, [tierKey]: newPrice };
                                      setPreviewData(prev => ({ 
                                        ...prev, 
                                        pricing_tiers: newPricingTiers
                                      }));
                                    }}
                                  />
                                  <span className="text-xs text-gray-600">{previewData.currency}</span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              </div>
              {/* Contract Preview */}
              <div className="lg:col-span-2">
                <div className="bg-base-200 rounded-xl p-6 border border-base-300" key={JSON.stringify(previewData.pricing_tiers)}>
                  {renderPreview()}
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContractTemplatesManager; 