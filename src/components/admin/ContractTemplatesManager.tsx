import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontFamily } from '@tiptap/extension-font-family';
import { FontSize } from '@tiptap/extension-font-size';
import { v4 as uuidv4 } from 'uuid';
import SignatureCanvas from 'react-signature-canvas';
import { JSONContent } from '@tiptap/core';

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
    <div className="flex flex-wrap gap-1 items-center mb-4 bg-base-200 p-2 rounded-xl border border-base-300">
      {/* Font Family */}
      <select
        className="select select-xs select-bordered mr-2"
        value={editor.getAttributes('fontFamily').fontFamily || 'Arial'}
        onChange={e => editor.chain().focus().setFontFamily(e.target.value).run()}
      >
        {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
      {/* Font Size */}
      <select
        className="select select-xs select-bordered mr-2"
        value={editor.getAttributes('fontSize').fontSize || '16px'}
        onChange={e => editor.chain().focus().setFontSize(e.target.value).run()}
      >
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      {/* Bold, Italic, Underline, Strike */}
      <button className={`btn btn-xs ${editor.isActive('bold') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><b>B</b></button>
      <button className={`btn btn-xs ${editor.isActive('italic') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><i>I</i></button>
      <button className={`btn btn-xs ${editor.isActive('underline') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></button>
      <button className={`btn btn-xs ${editor.isActive('strike') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><s>S</s></button>
      {/* Color & Highlight */}
      <input type="color" className="ml-2" value={editor.getAttributes('textStyle').color || '#000000'} onChange={e => editor.chain().focus().setColor(e.target.value).run()} title="Text Color" />
      <button className={`btn btn-xs ${editor.isActive('highlight') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleHighlight().run()} title="Highlight">HL</button>
      {/* Alignment */}
      <button className={`btn btn-xs ${editor.isActive({ textAlign: 'left' }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align Left">L</button>
      <button className={`btn btn-xs ${editor.isActive({ textAlign: 'center' }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align Center">C</button>
      <button className={`btn btn-xs ${editor.isActive({ textAlign: 'right' }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align Right">R</button>
      {/* Lists, Blockquote, Headings */}
      <button className={`btn btn-xs ${editor.isActive('bulletList') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">• List</button>
      <button className={`btn btn-xs ${editor.isActive('orderedList') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List">1. List</button>
      <button className={`btn btn-xs ${editor.isActive('blockquote') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">❝</button>
      <button className={`btn btn-xs ${editor.isActive('heading', { level: 1 }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1">H1</button>
      <button className={`btn btn-xs ${editor.isActive('heading', { level: 2 }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2">H2</button>
      <button className={`btn btn-xs ${editor.isActive('heading', { level: 3 }) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="H3">H3</button>
      {/* Link */}
      <button className={`btn btn-xs ${editor.isActive('link') ? 'btn-primary' : 'btn-ghost'}`} onClick={() => {
        const url = window.prompt('Enter URL');
        if (url) editor.chain().focus().setLink({ href: url }).run();
      }} title="Link">🔗</button>
      {/* Undo/Redo */}
      <button className="btn btn-xs btn-ghost" onClick={() => editor.chain().focus().undo().run()} title="Undo">⎌</button>
      <button className="btn btn-xs btn-ghost" onClick={() => editor.chain().focus().redo().run()} title="Redo">⎌⎌</button>
    </div>
  );
};

const ContractTemplatesManager: React.FC = () => {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
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

  // Load templates from Supabase
  const fetchTemplates = useCallback(async () => {
    const { data, error } = await supabase.from('contract_templates').select('*').order('created_at', { ascending: true });
    if (!error && data) {
      setTemplates(data);
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
        setName(data[0].name);
      }
    }
  }, [selectedId]);

  useEffect(() => { fetchTemplates(); }, []);

  // Editor setup
  const selectedTemplate = templates.find(t => t.id === selectedId);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Write your contract template here...' }),
      Underline,
      Link,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight,
      Color,
      TextStyle,
      FontFamily,
      FontSize,
    ],
    content: selectedTemplate ? selectedTemplate.content : SAMPLE_TEMPLATE.content,
    onUpdate: ({ editor }) => {
      // No-op, handled on save
    },
  });

  // Update editor content when switching templates
  useEffect(() => {
    if (editor && selectedTemplate) {
      editor.commands.setContent(selectedTemplate.content);
      setName(selectedTemplate.name);
      
      // Load default pricing tiers if they exist
      if (selectedTemplate.default_pricing_tiers) {
        setPreviewData(prev => ({
          ...prev,
          pricing_tiers: selectedTemplate.default_pricing_tiers,
          currency: selectedTemplate.default_currency || prev.currency,
          client_country: selectedTemplate.default_country || prev.client_country,
          discount_percentage: prev.discount_percentage
        }));
      }
    }
  }, [selectedId, editor]);

  // Insert dynamic field
  const insertField = (tag: string) => {
    if (editor) {
      editor.chain().focus().insertContent(tag).run();
    }
  };

  // Save template
  const handleSave = async () => {
    if (!editor) return;
    setIsSaving(true);
    const content = editor.getJSON();
    const templateData = {
      name,
      content,
      default_pricing_tiers: previewData.pricing_tiers,
      default_currency: previewData.currency,
      default_country: previewData.client_country
    };
    
    if (selectedId) {
      // Update
      await supabase.from('contract_templates').update(templateData).eq('id', selectedId);
    } else {
      // Create
      const id = uuidv4();
      await supabase.from('contract_templates').insert([{ id, ...templateData }]);
      setSelectedId(id);
    }
    await fetchTemplates();
    setIsSaving(false);
  };

  // Delete template
  const handleDelete = async (id: string) => {
    await supabase.from('contract_templates').delete().eq('id', id);
    setTemplates(templates.filter(t => t.id !== id));
    setSelectedId(templates.length > 1 ? templates.find(t => t.id !== id)?.id : null);
  };

  // Create new template
  const handleCreate = () => {
    setSelectedId(null);
    setName('Untitled Contract');
    if (editor) editor.commands.setContent({ type: 'doc', content: [] });
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

  return (
    <div className="flex h-[600px] bg-base-100 rounded-xl shadow overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-base-200 border-r border-base-300 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-base-300">
          <span className="font-bold text-lg">Templates</span>
          <button className="btn btn-sm btn-primary" onClick={handleCreate}>+ New</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {templates.length === 0 && (
            <div className="p-4 text-base-content/60">No templates yet.</div>
          )}
          {templates.map(t => (
            <div key={t.id} className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${selectedId === t.id ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-base-300'}`}
              onClick={() => { setSelectedId(t.id); setName(t.name); }}>
              <span className="truncate">{t.name}</span>
              <button className="btn btn-xs btn-ghost text-error ml-2" onClick={e => { e.stopPropagation(); handleDelete(t.id); }}>🗑️</button>
            </div>
          ))}
        </div>
      </div>
      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-4 p-4 border-b border-base-300">
          <input
            className="input input-bordered w-1/2 text-lg font-semibold"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Template Name"
          />
          <div className="flex gap-2 ml-4">
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
          <div className="flex gap-2 ml-auto">
            <button className="btn btn-sm btn-outline" onClick={() => setIsPreview(p => !p)}>{isPreview ? 'Edit' : 'Preview as Client'}</button>
            <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
        {/* Toolbar */}
        {!isPreview && <Toolbar editor={editor} />}
        <div className="flex-1 p-6 overflow-y-auto">
          {!isPreview ? (
            <EditorContent editor={editor} className="prose max-w-full min-h-[300px] border border-base-300 rounded-xl bg-white p-4 text-black" />
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
  );
};

export default ContractTemplatesManager; 