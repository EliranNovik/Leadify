import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { refreshTemplatesFromAPI } from '../../lib/whatsappTemplates';
import GenericCRUDManager from './GenericCRUDManager';
import { buildApiUrl } from '../../lib/api';
import toast from 'react-hot-toast';

const WhatsAppTemplatesManager: React.FC = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [key, setKey] = useState(0);

  const fields = [
    {
      name: 'id',
      label: 'ID',
      type: 'number' as const,
      required: true,
      hideInForm: true,
      hideInEdit: true,
      hideInTable: false
    },
    {
      name: 'whatsapp_template_id',
      label: 'WhatsApp Template ID',
      type: 'text' as const,
      required: true,
      hideInEdit: true,
      hideInTable: false
    },
    {
      name: 'name',
      label: 'Template Name',
      type: 'text' as const,
      required: true,
      hideInEdit: true,
      hideInTable: false
    },
    {
      name: 'language',
      label: 'Language',
      type: 'text' as const,
      required: false,
      hideInEdit: true,
      hideInTable: false
    },
    {
      name: 'params',
      label: 'Has Parameters',
      type: 'text' as const,
      required: false,
      placeholder: '0 or 1',
      hideInEdit: true,
      hideInTable: false
    },
    {
      name: 'active',
      label: 'Active',
      type: 'boolean' as const,
      required: false,
      hideInEdit: true,
      hideInTable: false
    },
    {
      name: 'content',
      label: 'Content',
      type: 'textarea' as const,
      required: false,
      placeholder: 'Template message content',
      readOnly: true,
      hideInTable: false,  // Show in table
      formatValue: (value: any) => {
        if (!value) return '-';
        // Truncate long content for table display
        const content = String(value);
        const maxLength = 100;
        if (content.length > maxLength) {
          return (
            <span className="block max-w-md" title={content}>
              {content.substring(0, maxLength)}...
            </span>
          );
        }
        return <span className="block max-w-md whitespace-pre-wrap">{content}</span>;
      }
    }
  ];

  const handleRefreshTemplates = async () => {
    try {
      setIsRefreshing(true);
      const result = await refreshTemplatesFromAPI();
      
      if (result.success) {
        toast.success(result.message);
        // Force refresh the data by changing the key
        setKey(prev => prev + 1);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error('Error refreshing templates:', error);
      toast.error('Failed to refresh templates');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-base-content">WhatsApp Templates</h2>
          <p className="text-base-content/70 mt-1">Manage WhatsApp message templates from Meta Business Manager</p>
        </div>
        <button
          onClick={handleRefreshTemplates}
          disabled={isRefreshing}
          className="btn btn-primary gap-2"
        >
          {isRefreshing ? (
            <>
              <div className="loading loading-spinner loading-sm"></div>
              Refreshing...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Fetch New Templates
            </>
          )}
        </button>
      </div>
      
      <div key={key}>
        <GenericCRUDManager
          tableName="whatsapp_templates_v2"
          fields={fields}
          title="WhatsApp Template"
          description="Manage WhatsApp message templates and their configurations"
          pageSize={50}
          sortColumn="id"
          hideAddButton={true}
          hideTitle={true}
        />
      </div>
    </div>
  );
};

export default WhatsAppTemplatesManager; 