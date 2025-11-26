import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { refreshTemplatesFromAPI } from '../../lib/whatsappTemplates';
import GenericCRUDManager from './GenericCRUDManager';
import { buildApiUrl } from '../../lib/api';
import toast from 'react-hot-toast';
import ParameterMappingEditor, { type ParameterDefinition } from './ParameterMappingEditor';

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
      label: 'Parameter Count',
      type: 'text' as const,
      required: false,
      placeholder: '0, 1, 2, 3...',
      hideInEdit: true,
      hideInTable: false,
      formatValue: (value: any) => {
        const count = Number(value) || 0;
        if (count === 0) {
          return <span className="text-gray-500">No parameters</span>;
        }
        return <span className="font-semibold text-orange-600">{count} parameter{count !== 1 ? 's' : ''}</span>;
      }
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
    },
    {
      name: 'param_mapping',
      label: 'Parameter Mapping',
      type: 'custom' as const,
      required: false,
      hideInTable: true, // Hide in table, show only in edit form
      hideInAdd: true, // Only edit existing templates
      hideInEdit: false, // Show in edit mode
      customComponent: ({ value, onChange, record, readOnly }) => {
        const paramCount = record ? Number(record.params) || 0 : 0;
        const paramMapping = value as ParameterDefinition[] | null;
        
        console.log('🔧 Parameter Mapping Editor rendering:', { 
          paramCount, 
          paramMapping, 
          record: record ? { id: record.id, params: record.params } : null 
        });
        
        // Only show editor if template has parameters
        if (paramCount === 0) {
          return (
            <div className="text-sm text-gray-500 italic p-4 bg-gray-50 rounded-lg border border-gray-200">
              This template has no parameters, so no parameter mapping is needed.
            </div>
          );
        }
        
        return (
          <ParameterMappingEditor
            value={paramMapping}
            onChange={(mapping) => {
              console.log('🔧 Parameter mapping changed:', mapping);
              onChange(mapping);
            }}
            paramCount={paramCount}
            readOnly={readOnly || false}
          />
        );
      },
      prepareValueForForm: (value: any) => {
        // Parse JSONB from database
        if (!value) return null;
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        }
        return value;
      },
      prepareValueForSave: (value: any) => {
        // Ensure it's valid JSON or null
        if (!value || !Array.isArray(value) || value.length === 0) {
          return null;
        }
        return value;
      },
      formatValue: (value: any, record: Record) => {
        if (!value || !Array.isArray(value)) {
          return <span className="text-gray-500 italic">Not configured</span>;
        }
        const paramCount = Number(record.params) || 0;
        if (value.length === 0 || value.length !== paramCount) {
          return <span className="text-orange-600">Incomplete ({value.length}/{paramCount})</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {value.map((param: ParameterDefinition, idx: number) => (
              <span key={idx} className="badge badge-sm badge-outline">
                {idx + 1}: {param.type}
              </span>
            ))}
          </div>
        );
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