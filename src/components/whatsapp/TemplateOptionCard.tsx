import React from 'react';
import type { WhatsAppTemplate } from '../../lib/whatsappTemplates';

interface TemplateOptionCardProps {
  template: WhatsAppTemplate;
  isSelected?: boolean;
  onClick: () => void;
}

// Helper function to detect Hebrew/RTL text
const containsRTL = (text?: string | null): boolean => {
  if (!text) return false;
  return /[\u0590-\u05FF]/.test(text);
};

const TemplateOptionCard: React.FC<TemplateOptionCardProps> = ({ 
  template, 
  isSelected = false, 
  onClick 
}) => {
  const hasParams = template.params !== '0' && Number(template.params) > 0;
  
  // Check if content contains Hebrew
  const contentHasHebrew = containsRTL(template.content);
  const titleHasHebrew = containsRTL(template.title || template.name360);
  const isRTL = contentHasHebrew || titleHasHebrew;
  
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full p-4 rounded-lg border-2 transition-all ${
        isRTL ? 'text-right' : 'text-left'
      } ${
        isSelected 
          ? 'bg-blue-50 border-blue-400 shadow-sm' 
          : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className={`flex items-start gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
        {/* Active status and language */}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
            template.active === 't' 
              ? 'bg-green-100 text-green-700' 
              : 'bg-yellow-100 text-yellow-700'
          }`}>
            {template.active === 't' ? 'Active' : 'Pending'}
          </span>
          <span className="text-xs text-gray-500 font-medium px-2 py-0.5">
            {template.language || 'en_US'}
          </span>
        </div>

        {/* Title, params badge, and content */}
        <div className="flex-1 min-w-0">
          {/* Title with Parameters Badge */}
          <div className={`flex items-center gap-2 mb-2 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <div className="font-semibold text-gray-900 text-sm" style={{ textAlign: isRTL ? 'right' : 'left' }}>
              {template.title || template.name360 || 'Untitled'}
            </div>
            {hasParams && (
              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-orange-100 text-orange-700 flex-shrink-0">
                {template.params} Parameter{Number(template.params) !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Content */}
          {template.content && template.content.trim() && (
            <div 
              className="text-sm text-gray-600 line-clamp-6 mt-2 whitespace-pre-wrap"
              dir={contentHasHebrew ? 'rtl' : 'ltr'}
              style={{ textAlign: contentHasHebrew ? 'right' : 'left' }}
            >
              {template.content}
            </div>
          )}
        </div>
      </div>
    </button>
  );
};

export default TemplateOptionCard;
