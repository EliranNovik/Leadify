import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { 
  PhotoIcon,
  TrashIcon,
  PlusIcon,
  CheckIcon,
  XMarkIcon,
  BuildingOfficeIcon,
  PencilIcon,
  UserIcon,
  EyeIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

interface ImageData {
  url: string;
  alt: string;
  width?: number; // Width in pixels
  height?: number; // Height in pixels
  x?: number; // X position in pixels (relative to container)
  y?: number; // Y position in pixels (relative to container)
}

interface TemplateData {
  namePosition: { text: string };
  twoImages: ImageData[];
  phone: { text: string };
  address: { text: string };
  website: { text: string };
  singleImage: ImageData | null;
  threeImages: ImageData[];
  finalImage: ImageData | null;
}

interface CompanySignatureTemplate {
  id: string;
  name: string;
  description?: string;
  template_data: TemplateData;
  is_active: boolean;
  is_default: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

const CompanySignatureTemplate: React.FC = () => {
  const [templates, setTemplates] = useState<CompanySignatureTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CompanySignatureTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState<{ [key: string]: boolean }>({});
  
  // User signature creation state
  const [selectedTemplateForUser, setSelectedTemplateForUser] = useState<CompanySignatureTemplate | null>(null);
  const [userSignatureForm, setUserSignatureForm] = useState({
    name: '',
    position: '',
    phone: ''
  });
  const [userSignatureHtml, setUserSignatureHtml] = useState('');
  const [isGeneratingSignature, setIsGeneratingSignature] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  
  const [templateForm, setTemplateForm] = useState({
    name: '',
    description: '',
    templateData: {
      namePosition: { text: '{{name}} - {{position}}' },
      twoImages: [{ url: '', alt: '' }, { url: '', alt: '' }] as ImageData[],
      phone: { text: '{{phone}}' },
      address: { text: '' },
      website: { text: '' },
      singleImage: null as ImageData | null,
      threeImages: [{ url: '', alt: '' }, { url: '', alt: '' }, { url: '', alt: '' }] as ImageData[],
      finalImage: null as ImageData | null
    } as TemplateData
  });

  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const [draggingImage, setDraggingImage] = useState<{ key: string; index?: number } | null>(null);
  const [resizingImage, setResizingImage] = useState<{ key: string; index?: number; corner: string } | null>(null);
  const dragStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const resizeStartPos = useRef<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });

  // Fetch company templates (user_id IS NULL)
  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('company_signature_templates')
        .select('*')
        .is('user_id', null)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error: any) {
      console.error('Error fetching templates:', error);
      toast.error('Failed to fetch templates');
    }
  };

  // Fetch current user's signature
  const fetchUserSignature = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      const { data: userData } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (!userData?.full_name) return;

      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('newsignature, display_name')
        .eq('display_name', userData.full_name)
        .single();

      if (employeeData?.newsignature) {
        setUserSignatureHtml(employeeData.newsignature);
      }
    } catch (error: any) {
      console.error('Error fetching user signature:', error);
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchUserSignature();
  }, []);

  // Generate HTML signature from template
  const generateSignatureHtml = (template: TemplateData, name: string, position: string, phone: string): string => {
    let html = '<div style="font-family: Arial, sans-serif; font-size: 12px; color: #333; line-height: 1.6; max-width: 600px;">';
    
    // 1. Name and Position (text field) with golden underline
    const namePositionText = template.namePosition.text
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{position\}\}/g, position);
    if (namePositionText.trim()) {
      html += `<div style="margin-bottom: 12px;"><p style="margin: 0; padding-bottom: 4px; font-weight: bold; font-size: 14px; color: #333; border-bottom: 3px solid #D4AF37;">${namePositionText}</p></div>`;
    }
    
    // 2. Two Images (side by side)
    const hasTwoImages = template.twoImages[0]?.url || template.twoImages[1]?.url;
    if (hasTwoImages) {
      html += '<div style="margin: 12px 0; position: relative; min-height: 200px;">';
      template.twoImages.forEach((img) => {
        if (img.url) {
          const imgStyle = [
            img.width ? `width: ${img.width}px` : 'max-width: 150px',
            img.height ? `height: ${img.height}px` : 'height: auto',
            img.x !== undefined ? `left: ${img.x}px` : '',
            img.y !== undefined ? `top: ${img.y}px` : '',
            'position: absolute',
            'object-fit: contain'
          ].filter(Boolean).join('; ');
          html += `<img src="${img.url}" alt="${img.alt || ''}" style="${imgStyle}" />`;
        }
      });
      html += '</div>';
    }
    
    // 3. Phone (number) with icon - always show if template has phone field
    if (template.phone && template.phone.text) {
      let phoneText = template.phone.text.replace(/\{\{phone\}\}/g, phone || '');
      // Remove any existing phone icon from template text and add our own
      phoneText = phoneText.replace(/📱|☎️|📞/g, '').trim();
      // If phone text is empty after replacement, show just the placeholder format
      if (!phoneText && phone) {
        phoneText = phone;
      } else if (!phoneText) {
        phoneText = ''; // Will show just the icon if no phone entered
      }
      html += `<div style="margin: 10px 0;"><p style="margin: 0; font-size: 12px; color: #333;">📱 ${phoneText}</p></div>`;
    }
    
    // 4. Address (text) with icon
    if (template.address.text && template.address.text.trim()) {
      // Remove any existing location icon from template text and add our own
      const cleanAddressText = template.address.text.replace(/📍|🏢|📍/g, '').trim();
      html += `<div style="margin: 10px 0;"><p style="margin: 0; font-size: 12px; color: #333;">📍 ${cleanAddressText}</p></div>`;
    }
    
    // 5. Website (text) with icon
    if (template.website.text && template.website.text.trim()) {
      const websiteUrl = template.website.text.startsWith('http') ? template.website.text : `https://${template.website.text}`;
      // Remove any existing website icon from template text and add our own
      const cleanWebsiteText = template.website.text.replace(/🌐|🔗|🌍/g, '').trim();
      html += `<div style="margin: 10px 0;"><p style="margin: 0; font-size: 12px;">🌐 <a href="${websiteUrl}" style="color: #0066cc; text-decoration: none;">${cleanWebsiteText}</a></p></div>`;
    }
    
    // 6. Single Image
    if (template.singleImage?.url) {
      const img = template.singleImage;
      const imgStyle = [
        img.width ? `width: ${img.width}px` : 'max-width: 200px',
        img.height ? `height: ${img.height}px` : 'height: auto',
        'display: block'
      ].filter(Boolean).join('; ');
      html += `<div style="margin: 12px 0; position: relative; min-height: 200px;"><img src="${img.url}" alt="${img.alt || ''}" style="${imgStyle}; ${img.x !== undefined ? `left: ${img.x}px; position: absolute;` : ''} ${img.y !== undefined ? `top: ${img.y}px;` : ''}" /></div>`;
    }
    
    // 7. Three Images (side by side)
    const hasThreeImages = template.threeImages.some(img => img.url);
    if (hasThreeImages) {
      html += '<div style="margin: 12px 0; position: relative; min-height: 200px;">';
      template.threeImages.forEach(img => {
        if (img.url) {
          const imgStyle = [
            img.width ? `width: ${img.width}px` : 'max-width: 120px',
            img.height ? `height: ${img.height}px` : 'height: auto',
            img.x !== undefined ? `left: ${img.x}px` : '',
            img.y !== undefined ? `top: ${img.y}px` : '',
            'position: absolute',
            'object-fit: contain'
          ].filter(Boolean).join('; ');
          html += `<img src="${img.url}" alt="${img.alt || ''}" style="${imgStyle}" />`;
        }
      });
      html += '</div>';
    }
    
    // 8. Final Image
    if (template.finalImage?.url) {
      const img = template.finalImage;
      const imgStyle = [
        img.width ? `width: ${img.width}px` : 'max-width: 200px',
        img.height ? `height: ${img.height}px` : 'height: auto',
        'display: block'
      ].filter(Boolean).join('; ');
      html += `<div style="margin: 12px 0; position: relative; min-height: 200px;"><img src="${img.url}" alt="${img.alt || ''}" style="${imgStyle}; ${img.x !== undefined ? `left: ${img.x}px; position: absolute;` : ''} ${img.y !== undefined ? `top: ${img.y}px;` : ''}" /></div>`;
    }
    
    html += '</div>';
    return html;
  };

  // Handle template selection for user signature
  const handleTemplateSelect = (template: CompanySignatureTemplate) => {
    setSelectedTemplateForUser(template);
    setUserSignatureForm({ name: '', position: '', phone: '' });
    setUserSignatureHtml('');
  };

  // Generate and preview signature
  const generateSignature = () => {
    if (!selectedTemplateForUser) {
      toast.error('Please select a template first');
      return;
    }
    if (!userSignatureForm.name.trim()) {
      toast.error('Please enter your name');
      return;
    }
    
    const html = generateSignatureHtml(
      selectedTemplateForUser.template_data,
      userSignatureForm.name,
      userSignatureForm.position,
      userSignatureForm.phone
    );
    setUserSignatureHtml(html);
    setShowPreview(true);
  };

  // Save user signature
  const saveUserSignature = async () => {
    if (!userSignatureHtml) {
      toast.error('Please generate a signature first');
      return;
    }

    setIsGeneratingSignature(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('User not authenticated');
        return;
      }

      // Get user's full_name
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        toast.error('Could not get user information');
        return;
      }

      // Save to tenants_employee.newsignature
      const { error } = await supabase
        .from('tenants_employee')
        .update({ newsignature: userSignatureHtml })
        .eq('display_name', userData.full_name);

      if (error) throw error;

      toast.success('Signature saved successfully!');
      fetchUserSignature();
    } catch (error: any) {
      console.error('Error saving signature:', error);
      toast.error('Failed to save signature');
    } finally {
      setIsGeneratingSignature(false);
    }
  };

  // Handle image upload (for template creation)
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>, imageKey: string, imageIndex?: number) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB');
      return;
    }

    setUploadingImages(prev => ({ ...prev, [imageKey]: true }));
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `signature-templates/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from('signature-templates')
        .upload(fileName, file);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('signature-templates')
        .getPublicUrl(fileName);

      // Load image to get natural dimensions
      const img = new Image();
      img.onload = () => {
        const defaultWidth = Math.min(img.width, 200);
        const defaultHeight = Math.min(img.height, 200);
        
        setTemplateForm(prev => {
          const newData = { ...prev.templateData };
          
          if (imageKey === 'singleImage') {
            newData.singleImage = { url: publicUrl, alt: '', width: defaultWidth, height: defaultHeight, x: 0, y: 0 };
          } else if (imageKey === 'finalImage') {
            newData.finalImage = { url: publicUrl, alt: '', width: defaultWidth, height: defaultHeight, x: 0, y: 0 };
          } else if (imageKey === 'twoImages' && imageIndex !== undefined) {
            newData.twoImages[imageIndex] = { url: publicUrl, alt: '', width: defaultWidth, height: defaultHeight, x: imageIndex * 220, y: 0 };
          } else if (imageKey === 'threeImages' && imageIndex !== undefined) {
            newData.threeImages[imageIndex] = { url: publicUrl, alt: '', width: defaultWidth, height: defaultHeight, x: imageIndex * 150, y: 0 };
          }
          
          return { ...prev, templateData: newData };
        });
      };
      img.src = publicUrl;

      toast.success('Image uploaded successfully');
    } catch (error: any) {
      console.error('Error uploading image:', error);
      toast.error('Failed to upload image');
    } finally {
      setUploadingImages(prev => ({ ...prev, [imageKey]: false }));
      if (fileInputRefs.current[imageKey]) {
        fileInputRefs.current[imageKey]!.value = '';
      }
    }
  };

  // Save template (company-wide, user_id = NULL)
  const saveTemplate = async () => {
    if (!templateForm.name.trim()) {
      toast.error('Please enter a template name');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('User not authenticated');
        return;
      }

      const templatePayload = {
        name: templateForm.name,
        description: templateForm.description || null,
        template_data: templateForm.templateData,
        user_id: null, // Company-wide template
        is_active: true,
        is_default: false,
        created_by: user.id,
        updated_by: user.id
      };

      if (isEditing && selectedTemplate) {
        const { error } = await supabase
          .from('company_signature_templates')
          .update({
            ...templatePayload,
            updated_by: user.id
          })
          .eq('id', selectedTemplate.id);

        if (error) throw error;
        toast.success('Template updated successfully');
      } else {
        const { error } = await supabase
          .from('company_signature_templates')
          .insert([templatePayload]);

        if (error) throw error;
        toast.success('Template created successfully');
      }

      setTemplateForm({
        name: '',
        description: '',
        templateData: {
          namePosition: { text: '{{name}} - {{position}}' },
          twoImages: [{ url: '', alt: '' }, { url: '', alt: '' }],
          phone: { text: '{{phone}}' },
          address: { text: '' },
          website: { text: '' },
          singleImage: null,
          threeImages: [{ url: '', alt: '' }, { url: '', alt: '' }, { url: '', alt: '' }],
          finalImage: null
        }
      });
      setIsCreating(false);
      setIsEditing(false);
      setSelectedTemplate(null);
      fetchTemplates();
    } catch (error: any) {
      console.error('Error saving template:', error);
      toast.error('Failed to save template');
    } finally {
      setLoading(false);
    }
  };

  const startCreating = () => {
    setTemplateForm({
      name: '',
      description: '',
      templateData: {
        namePosition: { text: '{{name}} - {{position}}' },
        twoImages: [{ url: '', alt: '' }, { url: '', alt: '' }],
        phone: { text: '{{phone}}' },
        address: { text: '' },
        website: { text: '' },
        singleImage: null,
        threeImages: [{ url: '', alt: '' }, { url: '', alt: '' }, { url: '', alt: '' }],
        finalImage: null
      }
    });
    setIsCreating(true);
    setIsEditing(false);
    setSelectedTemplate(null);
  };

  const startEditing = (template: CompanySignatureTemplate) => {
    setTemplateForm({
      name: template.name,
      description: template.description || '',
      templateData: template.template_data
    });
    setSelectedTemplate(template);
    setIsEditing(true);
    setIsCreating(false);
  };

  const cancelEditing = () => {
    setIsCreating(false);
    setIsEditing(false);
    setSelectedTemplate(null);
    setTemplateForm({
      name: '',
      description: '',
      templateData: {
        namePosition: { text: '{{name}} - {{position}}' },
        twoImages: [{ url: '', alt: '' }, { url: '', alt: '' }],
        phone: { text: '{{phone}}' },
        address: { text: '' },
        website: { text: '' },
        singleImage: null,
        threeImages: [{ url: '', alt: '' }, { url: '', alt: '' }, { url: '', alt: '' }],
        finalImage: null
      }
    });
  };

  const deleteTemplate = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this template?')) return;

    try {
      const { error } = await supabase
        .from('company_signature_templates')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;
      toast.success('Template deleted successfully');
      fetchTemplates();
    } catch (error: any) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
    }
  };

  // Update image dimensions and position
  const updateImageData = (imageKey: string, imageIndex: number | undefined, updates: Partial<ImageData>) => {
    setTemplateForm(prev => {
      const newData = { ...prev.templateData };
      if (imageKey === 'singleImage') {
        newData.singleImage = { ...newData.singleImage!, ...updates };
      } else if (imageKey === 'finalImage') {
        newData.finalImage = { ...newData.finalImage!, ...updates };
      } else if (imageKey === 'twoImages' && imageIndex !== undefined) {
        newData.twoImages[imageIndex] = { ...newData.twoImages[imageIndex], ...updates };
      } else if (imageKey === 'threeImages' && imageIndex !== undefined) {
        newData.threeImages[imageIndex] = { ...newData.threeImages[imageIndex], ...updates };
      }
      return { ...prev, templateData: newData };
    });
  };

  // Handle mouse down for dragging
  const handleDragStart = (e: React.MouseEvent, imageKey: string, imageIndex?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const container = target.parentElement as HTMLElement;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      // Store the offset of mouse within the image
      dragStartPos.current = { 
        x: e.clientX - targetRect.left,
        y: e.clientY - targetRect.top
      };
    } else {
      dragStartPos.current = { x: 0, y: 0 };
    }
    setDraggingImage({ key: imageKey, index: imageIndex });
  };

  // Handle mouse move for dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingImage) {
        const imageElement = document.querySelector(`[data-image-key="${draggingImage.key}"][data-image-index="${draggingImage.index ?? ''}"]`) as HTMLElement;
        const container = imageElement?.parentElement as HTMLElement;
        
        if (container && imageElement) {
          const containerRect = container.getBoundingClientRect();
          const imageWidth = imageElement.offsetWidth || 0;
          const imageHeight = imageElement.offsetHeight || 0;
          // Calculate new position: mouse position minus the offset within the image
          let newX = e.clientX - containerRect.left - dragStartPos.current.x;
          let newY = e.clientY - containerRect.top - dragStartPos.current.y;
          // Constrain to container bounds
          newX = Math.max(0, Math.min(newX, containerRect.width - imageWidth));
          newY = Math.max(0, Math.min(newY, containerRect.height - imageHeight));
          updateImageData(draggingImage.key, draggingImage.index, { x: newX, y: newY });
        }
      }

      if (resizingImage) {
        const imageElement = document.querySelector(`[data-image-key="${resizingImage.key}"][data-image-index="${resizingImage.index ?? ''}"]`) as HTMLElement;
        const container = imageElement?.parentElement as HTMLElement;
        
        if (container && imageElement) {
          const containerRect = container.getBoundingClientRect();
          const currentImage = resizingImage.index !== undefined
            ? (resizingImage.key === 'twoImages' 
                ? templateForm.templateData.twoImages[resizingImage.index]
                : templateForm.templateData.threeImages[resizingImage.index])
            : (resizingImage.key === 'singleImage'
                ? templateForm.templateData.singleImage
                : templateForm.templateData.finalImage);

          if (currentImage) {
            const deltaX = e.clientX - resizeStartPos.current.x;
            const deltaY = e.clientY - resizeStartPos.current.y;
            let newWidth = resizeStartPos.current.width;
            let newHeight = resizeStartPos.current.height;
            let newX = currentImage.x || 0;
            let newY = currentImage.y || 0;

            // Get container dimensions (accounting for padding)
            const containerWidth = containerRect.width - 32; // 16px padding on each side
            const containerHeight = containerRect.height - 32;

            if (resizingImage.corner.includes('right')) {
              newWidth = Math.max(50, Math.min(resizeStartPos.current.width + deltaX, containerWidth - newX));
            }
            if (resizingImage.corner.includes('left')) {
              const proposedWidth = Math.max(50, resizeStartPos.current.width - deltaX);
              const maxWidth = containerWidth - newX;
              newWidth = Math.min(proposedWidth, maxWidth);
              newX = Math.max(0, (currentImage.x || 0) + (resizeStartPos.current.width - newWidth));
              // Ensure image doesn't go outside left boundary
              if (newX < 0) {
                newWidth = newWidth + newX;
                newX = 0;
              }
            }
            if (resizingImage.corner.includes('bottom')) {
              newHeight = Math.max(50, Math.min(resizeStartPos.current.height + deltaY, containerHeight - newY));
            }
            if (resizingImage.corner.includes('top')) {
              const proposedHeight = Math.max(50, resizeStartPos.current.height - deltaY);
              const maxHeight = containerHeight - newY;
              newHeight = Math.min(proposedHeight, maxHeight);
              newY = Math.max(0, (currentImage.y || 0) + (resizeStartPos.current.height - newHeight));
              // Ensure image doesn't go outside top boundary
              if (newY < 0) {
                newHeight = newHeight + newY;
                newY = 0;
              }
            }

            // Final bounds check to ensure image stays within container
            newX = Math.max(0, Math.min(newX, containerWidth - newWidth));
            newY = Math.max(0, Math.min(newY, containerHeight - newHeight));
            newWidth = Math.min(newWidth, containerWidth - newX);
            newHeight = Math.min(newHeight, containerHeight - newY);

            updateImageData(resizingImage.key, resizingImage.index, { 
              width: Math.max(50, newWidth), 
              height: Math.max(50, newHeight),
              x: newX,
              y: newY
            });
          }
        }
      }
    };

    const handleMouseUp = () => {
      setDraggingImage(null);
      setResizingImage(null);
    };

    if (draggingImage || resizingImage) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggingImage, resizingImage, templateForm.templateData]);

  // Handle resize start
  const handleResizeStart = (e: React.MouseEvent, imageKey: string, imageIndex: number | undefined, corner: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingImage({ key: imageKey, index: imageIndex, corner });
    
    const currentImage = imageIndex !== undefined
      ? (imageKey === 'twoImages' 
          ? templateForm.templateData.twoImages[imageIndex]
          : templateForm.templateData.threeImages[imageIndex])
      : (imageKey === 'singleImage'
          ? templateForm.templateData.singleImage
          : templateForm.templateData.finalImage);

    if (currentImage) {
      resizeStartPos.current = {
        x: e.clientX,
        y: e.clientY,
        width: currentImage.width || 200,
        height: currentImage.height || 200
      };
    }
  };

  const renderImageField = (
    label: string,
    imageKey: string,
    image: ImageData | null,
    imageIndex?: number
  ) => {
    const inputKey = imageIndex !== undefined ? `${imageKey}-${imageIndex}` : imageKey;
    const isDragging = draggingImage?.key === imageKey && draggingImage?.index === imageIndex;
    const isResizing = resizingImage?.key === imageKey && resizingImage?.index === imageIndex;
    
    return (
      <div className="space-y-2">
        <label className="label">
          <span className="label-text font-medium">{label}</span>
        </label>
        {image?.url ? (
          <div className="space-y-2">
            <div 
              className="relative border-2 border-dashed border-primary rounded-lg p-4 bg-base-200"
              style={{ minHeight: '200px', position: 'relative', overflow: 'hidden' }}
            >
              <div
                data-image-key={imageKey}
                data-image-index={imageIndex}
                style={{
                  position: 'absolute',
                  left: `${image.x || 0}px`,
                  top: `${image.y || 0}px`,
                  width: image.width ? `${image.width}px` : 'auto',
                  height: image.height ? `${image.height}px` : 'auto',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  zIndex: isDragging || isResizing ? 10 : 1
                }}
                onMouseDown={(e) => handleDragStart(e, imageKey, imageIndex)}
              >
                <img 
                  src={image.url} 
                  alt={image.alt || label}
                  style={{
                    width: image.width ? `${image.width}px` : 'auto',
                    height: image.height ? `${image.height}px` : 'auto',
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    display: 'block',
                    pointerEvents: 'none'
                  }}
                  draggable={false}
                />
                {/* Resize handles */}
                <div
                  className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full cursor-se-resize border-2 border-white"
                  onMouseDown={(e) => handleResizeStart(e, imageKey, imageIndex, 'bottom-right')}
                  style={{ zIndex: 20 }}
                />
                <div
                  className="absolute -bottom-1 -left-1 w-4 h-4 bg-primary rounded-full cursor-sw-resize border-2 border-white"
                  onMouseDown={(e) => handleResizeStart(e, imageKey, imageIndex, 'bottom-left')}
                  style={{ zIndex: 20 }}
                />
                <div
                  className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full cursor-ne-resize border-2 border-white"
                  onMouseDown={(e) => handleResizeStart(e, imageKey, imageIndex, 'top-right')}
                  style={{ zIndex: 20 }}
                />
                <div
                  className="absolute -top-1 -left-1 w-4 h-4 bg-primary rounded-full cursor-nw-resize border-2 border-white"
                  onMouseDown={(e) => handleResizeStart(e, imageKey, imageIndex, 'top-left')}
                  style={{ zIndex: 20 }}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Width (px)"
                className="input input-bordered input-sm flex-1"
                value={image.width || ''}
                onChange={(e) => updateImageData(imageKey, imageIndex, { width: parseInt(e.target.value) || undefined })}
              />
              <input
                type="number"
                placeholder="Height (px)"
                className="input input-bordered input-sm flex-1"
                value={image.height || ''}
                onChange={(e) => updateImageData(imageKey, imageIndex, { height: parseInt(e.target.value) || undefined })}
              />
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="X position (px)"
                className="input input-bordered input-sm flex-1"
                value={image.x || ''}
                onChange={(e) => updateImageData(imageKey, imageIndex, { x: parseInt(e.target.value) || undefined })}
              />
              <input
                type="number"
                placeholder="Y position (px)"
                className="input input-bordered input-sm flex-1"
                value={image.y || ''}
                onChange={(e) => updateImageData(imageKey, imageIndex, { y: parseInt(e.target.value) || undefined })}
              />
            </div>
            <input
              type="text"
              placeholder="Image alt text"
              className="input input-bordered input-sm w-full"
              value={image.alt}
              onChange={(e) => updateImageData(imageKey, imageIndex, { alt: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-xs btn-error w-full"
              onClick={() => {
                setTemplateForm(prev => {
                  const newData = { ...prev.templateData };
                  if (imageKey === 'singleImage') {
                    newData.singleImage = null;
                  } else if (imageKey === 'finalImage') {
                    newData.finalImage = null;
                  } else if (imageKey === 'twoImages' && imageIndex !== undefined) {
                    newData.twoImages[imageIndex] = { url: '', alt: '' };
                  } else if (imageKey === 'threeImages' && imageIndex !== undefined) {
                    newData.threeImages[imageIndex] = { url: '', alt: '' };
                  }
                  return { ...prev, templateData: newData };
                });
              }}
            >
              <TrashIcon className="w-4 h-4" />
              Remove Image
            </button>
          </div>
        ) : (
          <div>
            <input
              ref={(el) => { fileInputRefs.current[inputKey] = el; }}
              type="file"
              accept="image/*"
              onChange={(e) => handleImageUpload(e, imageKey, imageIndex)}
              className="hidden"
            />
            <button
              type="button"
              className="btn btn-outline btn-sm w-full"
              onClick={() => fileInputRefs.current[inputKey]?.click()}
              disabled={uploadingImages[inputKey]}
            >
              {uploadingImages[inputKey] ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                <PhotoIcon className="w-4 h-4" />
              )}
              Upload Image
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* User Signature Creation Section */}
      <div className="bg-base-100 rounded-xl border border-base-300 p-4 sm:p-6">
        <div className="flex items-center gap-2 sm:gap-3 mb-4">
          <div className="p-1.5 sm:p-2 bg-primary/10 rounded-lg">
            <UserIcon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-base-content">Create Your Signature</h3>
            <p className="text-xs sm:text-sm text-base-content/70">Select a template and fill in your details</p>
          </div>
        </div>

        {/* Template Selection */}
        <div className="space-y-4">
          <div>
            <label className="label">
              <span className="label-text font-medium">Select Template</span>
            </label>
            <select
              className="select select-bordered w-full"
              value={selectedTemplateForUser?.id || ''}
              onChange={(e) => {
                const template = templates.find(t => t.id === e.target.value);
                if (template) handleTemplateSelect(template);
              }}
            >
              <option value="">Choose a template...</option>
              {templates.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          {selectedTemplateForUser && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Your Name *</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={userSignatureForm.name}
                    onChange={(e) => setUserSignatureForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., John Doe"
                  />
                </div>
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Your Position</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={userSignatureForm.position}
                    onChange={(e) => setUserSignatureForm(prev => ({ ...prev, position: e.target.value }))}
                    placeholder="e.g., Senior Lawyer"
                  />
                </div>
              </div>
              <div>
                <label className="label">
                  <span className="label-text font-medium">Your Phone Number</span>
                </label>
                <input
                  type="tel"
                  className="input input-bordered w-full"
                  value={userSignatureForm.phone}
                  onChange={(e) => setUserSignatureForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="e.g., +972-50-123-4567"
                />
              </div>

              <div className="flex gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={generateSignature}
                  disabled={!userSignatureForm.name.trim()}
                >
                  <EyeIcon className="w-4 h-4" />
                  Generate & Preview
                </button>
                {userSignatureHtml && (
                  <button
                    className="btn btn-success btn-sm"
                    onClick={saveUserSignature}
                    disabled={isGeneratingSignature}
                  >
                    {isGeneratingSignature ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <CheckIcon className="w-4 h-4" />
                    )}
                    Save Signature
                  </button>
                )}
              </div>

              {showPreview && userSignatureHtml && (
                <div className="mt-4 p-4 bg-white rounded-lg border border-base-300">
                  <h4 className="font-semibold mb-2">Preview:</h4>
                  <div 
                    className="prose prose-sm max-w-none"
                    style={{ backgroundColor: 'white' }}
                    dangerouslySetInnerHTML={{ __html: userSignatureHtml }}
                  />
                </div>
              )}

              {userSignatureHtml && !showPreview && (
                <div className="mt-4">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowPreview(true)}
                  >
                    <EyeIcon className="w-4 h-4" />
                    Show Preview
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Company Template Management Section */}
      <div className="bg-base-100 rounded-xl border border-base-300 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 bg-primary/10 rounded-lg">
              <BuildingOfficeIcon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-base-content">Company Templates</h3>
              <p className="text-xs sm:text-sm text-base-content/70">Manage company-wide signature templates</p>
            </div>
          </div>
          
          {!isCreating && !isEditing && (
            <button
              className="btn btn-primary btn-xs sm:btn-sm w-full sm:w-auto"
              onClick={startCreating}
            >
              <PlusIcon className="w-4 h-4" />
              <span className="text-xs sm:text-sm">Create Template</span>
            </button>
          )}
        </div>

        {/* Template List */}
        {!isCreating && !isEditing && (
          <div className="space-y-3">
            {templates.length === 0 ? (
              <div className="bg-base-200 rounded-lg p-6 text-center">
                <p className="text-base-content/60">No templates created yet. Click "Create Template" to get started.</p>
              </div>
            ) : (
              templates.map((template) => (
                <div key={template.id} className="bg-base-100 rounded-xl border border-base-300 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-base-content">{template.name}</h4>
                        {template.is_default && (
                          <span className="badge badge-primary badge-sm">Default</span>
                        )}
                      </div>
                      {template.description && (
                        <p className="text-sm text-base-content/70 mb-2">{template.description}</p>
                      )}
                      <p className="text-xs text-base-content/50">
                        Created: {new Date(template.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => startEditing(template)}
                        title="Edit"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        className="btn btn-ghost btn-xs text-error"
                        onClick={() => deleteTemplate(template.id)}
                        title="Delete"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Template Form (same as before) */}
        {(isCreating || isEditing) && (
          <div className="bg-base-100 rounded-xl border border-base-300 p-4 sm:p-6 mt-4">
            <div className="space-y-4 sm:space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Template Name *</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Company Standard Signature"
                  />
                </div>
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Description</span>
                  </label>
                  <textarea
                    className="textarea textarea-bordered w-full"
                    value={templateForm.description}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Optional description for this template"
                    rows={2}
                  />
                </div>
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-medium">Name and Position</span>
                  <span className="label-text-alt">Use {'{{name}}'} and {'{{position}}'} as placeholders</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={templateForm.templateData.namePosition.text}
                  onChange={(e) => setTemplateForm(prev => ({
                    ...prev,
                    templateData: {
                      ...prev.templateData,
                      namePosition: { text: e.target.value }
                    }
                  }))}
                  placeholder="e.g., {{name}} - {{position}}"
                />
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-medium">Two Images (Side by Side)</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {renderImageField('Image 1', 'twoImages', templateForm.templateData.twoImages[0], 0)}
                  {renderImageField('Image 2', 'twoImages', templateForm.templateData.twoImages[1], 1)}
                </div>
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-medium">Phone Number</span>
                  <span className="label-text-alt">Use {'{{phone}}'} as placeholder</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={templateForm.templateData.phone.text}
                  onChange={(e) => setTemplateForm(prev => ({
                    ...prev,
                    templateData: {
                      ...prev.templateData,
                      phone: { text: e.target.value }
                    }
                  }))}
                  placeholder="e.g., 📱 {{phone}}"
                />
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-medium">Address</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={templateForm.templateData.address.text}
                  onChange={(e) => setTemplateForm(prev => ({
                    ...prev,
                    templateData: {
                      ...prev.templateData,
                      address: { text: e.target.value }
                    }
                  }))}
                  placeholder="e.g., 123 Main Street, City, Country"
                />
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-medium">Website</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={templateForm.templateData.website.text}
                  onChange={(e) => setTemplateForm(prev => ({
                    ...prev,
                    templateData: {
                      ...prev.templateData,
                      website: { text: e.target.value }
                    }
                  }))}
                  placeholder="e.g., www.company.com"
                />
              </div>

              <div>
                {renderImageField('Single Image', 'singleImage', templateForm.templateData.singleImage)}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-medium">Three Images (Side by Side)</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {renderImageField('Image 1', 'threeImages', templateForm.templateData.threeImages[0], 0)}
                  {renderImageField('Image 2', 'threeImages', templateForm.templateData.threeImages[1], 1)}
                  {renderImageField('Image 3', 'threeImages', templateForm.templateData.threeImages[2], 2)}
                </div>
              </div>

              <div>
                {renderImageField('Final Image', 'finalImage', templateForm.templateData.finalImage)}
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t border-base-300">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={cancelEditing}
                >
                  <XMarkIcon className="w-4 h-4" />
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={saveTemplate}
                  disabled={loading || !templateForm.name.trim()}
                >
                  {loading ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    <CheckIcon className="w-4 h-4" />
                  )}
                  {isEditing ? 'Update' : 'Create'} Template
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanySignatureTemplate;
