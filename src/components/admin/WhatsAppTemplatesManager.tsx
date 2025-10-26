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
      name: 'number_id',
      label: 'WhatsApp ID',
      type: 'text' as const,
      required: true,
      hideInEdit: true,
      hideInTable: false
    },
    {
      name: 'title',
      label: 'Title',
      type: 'text' as const,
      required: true,
      hideInEdit: true,
      hideInTable: false
    },
    {
      name: 'name360',
      label: 'Name 360',
      type: 'text' as const,
      required: true,
      hideInEdit: true,
      hideInTable: true
    },
    {
      name: 'category_id',
      label: 'Category',
      type: 'select' as const,
      required: false,
      foreignKey: {
        table: 'misc_maincategory',
        displayField: 'name',
        valueField: 'id'
      },
      hideInTable: false
    },
    {
      name: 'language_id',
      label: 'Language',
      type: 'select' as const,
      required: false,
      foreignKey: {
        table: 'misc_language',
        displayField: 'name',
        valueField: 'id'
      },
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
      placeholder: 'e.g., Template message content',
      readOnly: true,
      hideInTable: true
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
          tableName="whatsapp_whatsapptemplate"
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