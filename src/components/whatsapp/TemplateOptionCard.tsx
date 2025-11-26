import React from 'react';
import type { WhatsAppTemplate } from '../../lib/whatsappTemplates';

interface TemplateOptionCardProps {
  template: WhatsAppTemplate;
  isSelected?: boolean;
  onClick: () => void;
}

const TemplateOptionCard: React.FC<TemplateOptionCardProps> = ({ 
  template, 
  isSelected = false, 
  onClick 
}) => {
  const hasParams = template.params !== '0' && Number(template.params) > 0;
  
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
        isSelected 
          ? 'bg-blue-50 border-blue-400 shadow-sm' 
          : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left side: Active status and language */}
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

        {/* Right side: Title, params, and content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="font-semibold text-gray-900 text-sm mb-2">
            {template.title || template.name360 || 'Untitled'}
          </div>

          {/* Params indicator */}
          <div className="mb-2">
            {hasParams ? (
              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-orange-100 text-orange-700">
                {template.params} Parameter{Number(template.params) !== 1 ? 's' : ''}
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                No Parameters
              </span>
            )}
          </div>

          {/* Content */}
          {template.content && template.content.trim() && (
            <div className="text-sm text-gray-600 line-clamp-3 mt-2 whitespace-pre-wrap">
              {template.content}
            </div>
          )}
        </div>
      </div>
    </button>
  );
};

export default TemplateOptionCard;
