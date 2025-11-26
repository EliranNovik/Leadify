import React, { useState, useEffect } from 'react';
import { ChevronDownIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

export type ParamType = 'name' | 'meeting_datetime' | 'meeting_date' | 'meeting_time' | 'phone_number' | 'mobile_number' | 'email' | 'meeting_location' | 'meeting_link' | 'custom';

export interface ParameterDefinition {
  type: ParamType;
  value?: string; // For custom params
}

interface ParameterMappingEditorProps {
  value: ParameterDefinition[] | null;
  onChange: (value: ParameterDefinition[]) => void;
  paramCount: number; // Total number of parameters the template has
  readOnly?: boolean;
}

const PARAM_TYPE_OPTIONS: Array<{ value: ParamType; label: string; description: string }> = [
  { value: 'name', label: 'Name', description: 'The name of the client or contact (automatically selected based on chat context)' },
  { value: 'phone_number', label: 'Phone Number', description: 'The phone number of the client/contact' },
  { value: 'mobile_number', label: 'Mobile Number', description: 'The mobile number of the client/contact' },
  { value: 'email', label: 'Email Address', description: 'The email address of the client/contact' },
  { value: 'meeting_datetime', label: 'Meeting Date & Time', description: 'Full meeting date and time (e.g., "January 15, 2025 at 10:00 AM")' },
  { value: 'meeting_date', label: 'Meeting Date Only', description: 'Just the meeting date (e.g., "January 15, 2025")' },
  { value: 'meeting_time', label: 'Meeting Time Only', description: 'Just the meeting time (e.g., "10:00 AM")' },
  { value: 'meeting_location', label: 'Meeting Location', description: 'The location of the meeting' },
  { value: 'meeting_link', label: 'Meeting Link', description: 'The Zoom/Teams meeting link (URL)' },
  { value: 'custom', label: 'Custom Text', description: 'Enter a custom static value' },
];

const ParameterMappingEditor: React.FC<ParameterMappingEditorProps> = ({
  value,
  onChange,
  paramCount,
  readOnly = false
}) => {
  const [mappings, setMappings] = useState<ParameterDefinition[]>(() => {
    if (value && Array.isArray(value) && value.length > 0) {
      return value;
    }
    // Initialize with empty mappings based on param count
    return Array(paramCount).fill(null).map(() => ({ type: 'name' }));
  });

  useEffect(() => {
    // Sync with external value changes
    if (value && Array.isArray(value) && value.length > 0) {
      setMappings(value);
    } else if (paramCount > 0 && (!value || value.length === 0)) {
      // Initialize if we have param count but no mapping
      setMappings(Array(paramCount).fill(null).map(() => ({ type: 'name' })));
    }
  }, [value, paramCount]);

  const handleParamTypeChange = (index: number, type: ParamType) => {
    const updated = [...mappings];
    updated[index] = { ...updated[index], type, value: type === 'custom' ? updated[index]?.value || '' : undefined };
    setMappings(updated);
    onChange(updated);
  };

  const handleCustomValueChange = (index: number, customValue: string) => {
    const updated = [...mappings];
    updated[index] = { ...updated[index], value: customValue };
    setMappings(updated);
    onChange(updated);
  };

  const handleAddParam = () => {
    const updated = [...mappings, { type: 'name' }];
    setMappings(updated);
    onChange(updated);
  };

  const handleRemoveParam = (index: number) => {
    const updated = mappings.filter((_, i) => i !== index);
    setMappings(updated);
    onChange(updated);
  };

  if (paramCount === 0) {
    return (
      <div className="text-sm text-gray-500 italic">
        This template has no parameters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600 mb-2">
        Configure what each parameter should contain. The template requires <strong>{paramCount}</strong> parameter{paramCount !== 1 ? 's' : ''}.
      </div>
      
      {mappings.map((mapping, index) => (
        <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-700">Parameter {index + 1}:</span>
              </div>
              
              <div className="mb-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Parameter Type
                </label>
                <select
                  value={mapping.type}
                  onChange={(e) => handleParamTypeChange(index, e.target.value as ParamType)}
                  disabled={readOnly}
                  className="select select-bordered select-sm w-full max-w-xs"
                >
                  {PARAM_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {PARAM_TYPE_OPTIONS.find(opt => opt.value === mapping.type)?.description}
                </p>
              </div>
              
              {mapping.type === 'custom' && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Custom Value
                  </label>
                  <input
                    type="text"
                    value={mapping.value || ''}
                    onChange={(e) => handleCustomValueChange(index, e.target.value)}
                    disabled={readOnly}
                    placeholder="Enter custom text value..."
                    className="input input-bordered input-sm w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    This text will be used as-is for this parameter.
                  </p>
                </div>
              )}
            </div>
            
            {!readOnly && mappings.length > 1 && (
              <button
                type="button"
                onClick={() => handleRemoveParam(index)}
                className="btn btn-ghost btn-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                title="Remove parameter"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
      
      {!readOnly && mappings.length < paramCount && (
        <button
          type="button"
          onClick={handleAddParam}
          className="btn btn-outline btn-sm gap-2"
        >
          <PlusIcon className="w-4 h-4" />
          Add Parameter Mapping
        </button>
      )}
      
      {mappings.length !== paramCount && (
        <div className="alert alert-warning py-2">
          <div className="text-xs">
            <strong>Warning:</strong> You have {mappings.length} parameter mapping{mappings.length !== 1 ? 's' : ''} configured, 
            but this template requires {paramCount}. {mappings.length < paramCount ? 'Please add more.' : 'Please remove extra mappings.'}
          </div>
        </div>
      )}
    </div>
  );
};

export default ParameterMappingEditor;

