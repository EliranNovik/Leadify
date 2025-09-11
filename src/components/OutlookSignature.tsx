import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { 
  EnvelopeIcon, 
  PencilIcon, 
  CheckIcon,
  XMarkIcon,
  EyeIcon,
  EyeSlashIcon,
  PhotoIcon,
  TrashIcon,
  BoldIcon,
  ItalicIcon,
  LinkIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

const OutlookSignature: React.FC = () => {
  const [signature, setSignature] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [tempSignature, setTempSignature] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Default signature template with HTML support
  const defaultSignature = `<div style="font-family: Arial, sans-serif; font-size: 12px; color: #333;">
  <p><strong>Best regards,</strong></p>
  <p>[Your Name]<br>
  [Your Title]<br>
  [Company Name]</p>
  <p>📧 [your.email@company.com]<br>
  📱 [Your Phone Number]<br>
  🌐 [www.company.com]</p>
</div>`;

  // Fetch user's email signature
  const fetchSignature = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      // Get the user's full_name from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        console.error('Error getting user full name:', userError);
        return;
      }

      // Get the employee's email signature
      const { data: employeeData, error } = await supabase
        .from('tenants_employee')
        .select('email_signature')
        .eq('display_name', userData.full_name)
        .single();

      if (error) {
        console.error('Error fetching email signature:', error);
        return;
      }

      if (employeeData) {
        setSignature(employeeData.email_signature || defaultSignature);
      } else {
        setSignature(defaultSignature);
      }
    } catch (error) {
      console.error('Error fetching email signature:', error);
    }
  };

  // Save email signature
  const saveSignature = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('User not authenticated');
        return;
      }

      // Get the user's full_name from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        toast.error('Could not get user information');
        return;
      }

      // Save the signature to database
      const { error } = await supabase
        .from('tenants_employee')
        .update({ 
          email_signature: tempSignature,
          last_sync_date: new Date().toISOString()
        })
        .eq('display_name', userData.full_name);

      if (error) {
        console.error('Error saving email signature:', error);
        toast.error('Failed to save email signature');
        return;
      }

      setSignature(tempSignature);
      setIsEditing(false);
      toast.success('Email signature saved successfully');
    } catch (error) {
      console.error('Error saving email signature:', error);
      toast.error('Failed to save email signature');
    } finally {
      setLoading(false);
    }
  };

  // Cancel editing
  const cancelEditing = () => {
    setTempSignature(signature);
    setIsEditing(false);
  };

  // Start editing
  const startEditing = () => {
    // Clean the existing signature if it's from Outlook
    const cleanedSignature = cleanOutlookSignature(signature);
    setTempSignature(cleanedSignature);
    setIsEditing(true);
    
    // Update the editor content after a brief delay to ensure it's rendered
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = cleanedSignature;
      }
    }, 100);
  };

  // Reset to default
  const resetToDefault = () => {
    setTempSignature(defaultSignature);
  };

  // Handle image upload
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB');
      return;
    }

    setUploadingImage(true);
    try {
      // Upload image to Supabase storage
      const fileExt = file.name.split('.').pop();
      const fileName = `signature-images/${Date.now()}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from('public')
        .upload(fileName, file);

      if (error) {
        console.error('Error uploading image:', error);
        toast.error('Failed to upload image');
        return;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('public')
        .getPublicUrl(fileName);

      // Insert image into editor
      insertImageIntoEditor(publicUrl);
      toast.success('Image uploaded successfully');
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Insert image into the editor
  const insertImageIntoEditor = (imageUrl: string) => {
    if (!editorRef.current) return;
    
    const img = document.createElement('img');
    img.src = imageUrl;
    img.style.maxWidth = '200px';
    img.style.height = 'auto';
    img.style.margin = '5px';
    img.style.border = '1px solid #ddd';
    img.style.borderRadius = '4px';
    
    // Insert at cursor position
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.insertNode(img);
      range.setStartAfter(img);
      range.setEndAfter(img);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editorRef.current.appendChild(img);
    }
    
    // Update temp signature
    setTempSignature(editorRef.current.innerHTML);
  };

  // Rich text formatting functions
  const formatText = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setTempSignature(editorRef.current.innerHTML);
    }
  };

  // Insert link
  const insertLink = () => {
    const url = prompt('Enter URL:');
    if (url) {
      formatText('createLink', url);
    }
  };

  // Clean Outlook signature HTML
  const cleanOutlookSignature = (html: string): string => {
    if (!html) return '';
    
    // Remove Outlook-specific classes and IDs
    let cleaned = html
      .replace(/class="[^"]*"/g, '') // Remove all class attributes
      .replace(/id="[^"]*"/g, '') // Remove all id attributes
      .replace(/style="[^"]*"/g, '') // Remove inline styles
      .replace(/<o:p[^>]*>.*?<\/o:p>/g, '') // Remove Outlook paragraph tags
      .replace(/<o:shapedefaults[^>]*>.*?<\/o:shapedefaults>/g, '') // Remove Outlook shape defaults
      .replace(/<o:shapelayout[^>]*>.*?<\/o:shapelayout>/g, '') // Remove Outlook shape layout
      .replace(/<o:shapetype[^>]*>.*?<\/o:shapetype>/g, '') // Remove Outlook shape type
      .replace(/<v:shapetype[^>]*>.*?<\/v:shapetype>/g, '') // Remove VML shape type
      .replace(/<v:shape[^>]*>.*?<\/v:shape>/g, '') // Remove VML shapes
      .replace(/<w:[^>]*>.*?<\/w:[^>]*>/g, '') // Remove Word-specific tags
      .replace(/<m:[^>]*>.*?<\/m:[^>]*>/g, '') // Remove MathML tags
      .replace(/<o:[^>]*>.*?<\/o:[^>]*>/g, '') // Remove other Outlook tags
      .replace(/<v:[^>]*>.*?<\/v:[^>]*>/g, '') // Remove other VML tags
      .replace(/<xml[^>]*>.*?<\/xml>/g, '') // Remove XML declarations
      .replace(/<![^>]*>/g, '') // Remove comments and CDATA
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // Clean up empty tags
    cleaned = cleaned
      .replace(/<p[^>]*>\s*<\/p>/g, '') // Remove empty paragraphs
      .replace(/<div[^>]*>\s*<\/div>/g, '') // Remove empty divs
      .replace(/<span[^>]*>\s*<\/span>/g, '') // Remove empty spans
      .replace(/<br\s*\/?>\s*<br\s*\/?>/g, '<br>') // Remove duplicate line breaks
      .replace(/\s+/g, ' ') // Normalize whitespace again
      .trim();

    return cleaned;
  };

  // Handle paste events to clean Outlook signatures
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    
    const clipboardData = e.clipboardData;
    const htmlData = clipboardData.getData('text/html');
    const textData = clipboardData.getData('text/plain');
    
    if (htmlData) {
      // Clean the pasted HTML
      const cleanedHtml = cleanOutlookSignature(htmlData);
      
      // Insert the cleaned HTML
      if (editorRef.current) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = cleanedHtml;
          
          const fragment = document.createDocumentFragment();
          while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
          }
          
          range.insertNode(fragment);
          range.setStartAfter(fragment.lastChild || fragment);
          range.setEndAfter(fragment.lastChild || fragment);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        
        setTempSignature(editorRef.current.innerHTML);
      }
    } else if (textData) {
      // Insert plain text
      document.execCommand('insertText', false, textData);
      if (editorRef.current) {
        setTempSignature(editorRef.current.innerHTML);
      }
    }
  };

  useEffect(() => {
    fetchSignature();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <EnvelopeIcon className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-base-content">Email Signature</h3>
            <p className="text-sm text-base-content/70">Manage your email signature for Outlook</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPreviewMode(!previewMode)}
            title={previewMode ? 'Hide Preview' : 'Show Preview'}
          >
            {previewMode ? (
              <EyeSlashIcon className="w-4 h-4" />
            ) : (
              <EyeIcon className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">{previewMode ? 'Hide Preview' : 'Preview'}</span>
          </button>
        </div>
      </div>

      {/* Signature Editor */}
      <div className="bg-base-100 rounded-xl border border-base-300 p-6">
        {isEditing ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-base-content">Edit Signature</h4>
              <div className="flex gap-2">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={resetToDefault}
                >
                  Reset to Default
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={cancelEditing}
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={saveSignature}
                  disabled={loading}
                >
                  {loading ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    <CheckIcon className="w-4 h-4" />
                  )}
                  Save
                </button>
              </div>
            </div>
            
            <div>
              <label className="label">
                <span className="label-text font-medium">Email Signature</span>
                <span className="label-text-alt text-base-content/60">Rich text signature with images</span>
              </label>
              
              {/* Formatting Toolbar */}
              <div className="flex flex-wrap gap-2 p-3 bg-base-200 rounded-t-lg border border-base-300 border-b-0">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => formatText('bold')}
                  title="Bold"
                >
                  <BoldIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => formatText('italic')}
                  title="Italic"
                >
                  <ItalicIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={insertLink}
                  title="Insert Link"
                >
                  <LinkIcon className="w-4 h-4" />
                </button>
                <div className="divider divider-horizontal"></div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                  title="Insert Image"
                >
                  {uploadingImage ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    <PhotoIcon className="w-4 h-4" />
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const cleaned = cleanOutlookSignature(tempSignature);
                    setTempSignature(cleaned);
                    if (editorRef.current) {
                      editorRef.current.innerHTML = cleaned;
                    }
                    toast.success('Signature cleaned!');
                  }}
                  title="Clean Outlook Signature"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
              
              {/* Rich Text Editor */}
              <div
                ref={editorRef}
                className="textarea textarea-bordered w-full h-64 text-sm rounded-t-none resize-none overflow-auto"
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setTempSignature(e.currentTarget.innerHTML)}
                onPaste={handlePaste}
                dangerouslySetInnerHTML={{ __html: tempSignature }}
                style={{ 
                  minHeight: '200px',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '12px',
                  lineHeight: '1.4'
                }}
              />
            </div>
            
            <div className="text-xs text-base-content/60">
              <p><strong>Tips:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Use the formatting toolbar to style your text (bold, italic, links)</li>
                <li>Click the image icon to upload and insert photos/logos</li>
                <li>Paste signatures from Outlook - they'll be automatically cleaned</li>
                <li>Use the trash icon to clean messy Outlook HTML</li>
                <li>Include your name, title, and contact information</li>
                <li>Keep it professional and concise</li>
                <li>This signature will be automatically added to all your emails</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-base-content">Current Signature</h4>
              <button
                className="btn btn-outline btn-sm"
                onClick={startEditing}
              >
                <PencilIcon className="w-4 h-4" />
                Edit
              </button>
            </div>
            
            <div className="bg-base-200 rounded-lg p-4 min-h-[100px]">
              {signature ? (
                <div 
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: signature }}
                />
              ) : (
                <p className="text-base-content/60 italic">No signature set. Click Edit to create one.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Preview Panel */}
      {previewMode && (
        <div className="bg-base-100 rounded-xl border border-base-300 p-6">
          <h4 className="font-medium text-base-content mb-4">Preview</h4>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="border-b border-gray-200 pb-4 mb-4">
              <p className="text-sm text-gray-600">Sample email content...</p>
            </div>
            <div 
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: isEditing ? tempSignature : signature }}
            />
          </div>
        </div>
      )}

      {/* Help Section */}
      <div className="bg-info/10 border border-info/20 rounded-lg p-4">
        <h4 className="font-medium text-info mb-2">💡 Signature Tips</h4>
        <ul className="text-sm text-info space-y-1">
          <li>• Use the formatting toolbar for bold, italic, and links</li>
          <li>• Upload company logos or professional photos (max 5MB)</li>
          <li>• Keep your signature under 4-5 lines for best compatibility</li>
          <li>• Include your name, title, and primary contact method</li>
          <li>• Test your signature across different email clients</li>
        </ul>
      </div>
    </div>
  );
};

export default OutlookSignature;
