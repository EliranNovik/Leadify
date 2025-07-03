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
  { label: 'Signature', tag: '{{signature}}' },
  { label: 'Date', tag: '{{date}}' },
];

const FIELD_TYPES = [
  { label: 'Text Field', tag: '{{text}}' },
  { label: 'Signature Field', tag: '{{signature}}' },
];

const FONT_FAMILIES = [
  'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'Comic Sans MS'
];
const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'];

const SAMPLE_TEMPLATE = {
  name: 'Simple Service Contract',
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Service Agreement' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'This contract is made between ' }, { type: 'text', text: '{{client_name}}', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and the Service Provider.' }] },
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
  const [previewData, setPreviewData] = useState({ client_name: 'John Doe', date: '2024-06-01' });
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
    if (selectedId) {
      // Update
      await supabase.from('contract_templates').update({ name, content }).eq('id', selectedId);
    } else {
      // Create
      const id = uuidv4();
      await supabase.from('contract_templates').insert([{ id, name, content }]);
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

    // Helper to recursively render TipTap JSON nodes
    const renderNode = (node: any, key: string | number): React.ReactNode => {
      if (node.type === 'text') {
        let text = node.text;
        // Replace {{client_name}}, {{date}}, etc. with previewData
        Object.entries(previewData).forEach(([k, v]) => {
          text = text.replaceAll(`{{${k}}}`, v);
        });
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
        {content.content?.map((n, i) => renderNode(n, i))}
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
            {FIELD_TYPES.map(f => (
              <button key={f.tag} className="btn btn-sm btn-outline" onClick={() => insertField(f.tag)}>{f.label}</button>
            ))}
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
            <div className="bg-base-200 rounded-xl p-6 border border-base-300">
              {renderPreview()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContractTemplatesManager; 