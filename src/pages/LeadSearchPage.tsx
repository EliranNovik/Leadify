import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Lead } from '../lib/supabase';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

// Static dropdown options - moved outside component to prevent re-creation on every render
const REASON_OPTIONS = ["Inquiry", "Follow-up", "Complaint", "Consultation", "Other"];
const TAG_OPTIONS = ["VIP", "Urgent", "Family", "Business", "Other"];
const STATUS_OPTIONS = ["new", "in_progress", "qualified", "not_qualified"];

// Column definitions for table view
const AVAILABLE_COLUMNS = [
  // Basic Info
  { key: 'name', label: 'Name', category: 'Basic Info' },
  { key: 'lead_number', label: 'Lead Number', category: 'Basic Info' },
  { key: 'topic', label: 'Topic', category: 'Basic Info' },
  
  // Contact Info
  { key: 'email', label: 'Email', category: 'Contact' },
  { key: 'phone', label: 'Phone', category: 'Contact' },
  { key: 'mobile', label: 'Mobile', category: 'Contact' },
  { key: 'additional_contacts', label: 'Additional Contacts', category: 'Contact' },
  
  // Status & Classification
  { key: 'stage', label: 'Stage', category: 'Status' },
  { key: 'source', label: 'Source', category: 'Status' },
  { key: 'category', label: 'Category', category: 'Status' },
  { key: 'status', label: 'Status', category: 'Status' },
  { key: 'language', label: 'Language', category: 'Status' },
  { key: 'eligibility_status', label: 'Eligibility Status', category: 'Status' },
  { key: 'priority', label: 'Priority', category: 'Status' },
  
  // Financial Information
  { key: 'meeting_amount', label: 'Meeting Amount', category: 'Financial' },
  { key: 'meeting_currency', label: 'Meeting Currency', category: 'Financial' },
  { key: 'proposal_total', label: 'Proposal Total', category: 'Financial' },
  { key: 'proposal_currency', label: 'Proposal Currency', category: 'Financial' },
  { key: 'balance', label: 'Balance', category: 'Financial' },
  { key: 'balance_currency', label: 'Balance Currency', category: 'Financial' },
  { key: 'potential_value', label: 'Potential Value', category: 'Financial' },
  { key: 'total', label: 'Total', category: 'Financial' },
  { key: 'first_payment', label: 'First Payment', category: 'Financial' },
  { key: 'meeting_total', label: 'Meeting Total', category: 'Financial' },
  { key: 'meeting_total_currency', label: 'Meeting Total Currency', category: 'Financial' },
  { key: 'vat', label: 'VAT', category: 'Financial' },
  { key: 'vat_value', label: 'VAT Value', category: 'Financial' },
  { key: 'bonus_paid', label: 'Bonus Paid', category: 'Financial' },
  { key: 'subcontractor_fee', label: 'Subcontractor Fee', category: 'Financial' },
  
  // Meeting Information
  { key: 'meeting_date', label: 'Meeting Date', category: 'Meeting' },
  { key: 'meeting_time', label: 'Meeting Time', category: 'Meeting' },
  { key: 'meeting_datetime', label: 'Meeting DateTime', category: 'Meeting' },
  { key: 'meeting_location', label: 'Meeting Location', category: 'Meeting' },
  { key: 'meeting_url', label: 'Meeting URL', category: 'Meeting' },
  { key: 'teams_meeting_url', label: 'Teams Meeting URL', category: 'Meeting' },
  { key: 'meeting_brief', label: 'Meeting Brief', category: 'Meeting' },
  { key: 'meeting_payment_form', label: 'Meeting Payment Form', category: 'Meeting' },
  { key: 'meeting_paid', label: 'Meeting Paid', category: 'Meeting' },
  { key: 'meeting_confirmation', label: 'Meeting Confirmation', category: 'Meeting' },
  { key: 'meeting_scheduling_notes', label: 'Meeting Scheduling Notes', category: 'Meeting' },
  { key: 'meeting_complexity', label: 'Meeting Complexity', category: 'Meeting' },
  { key: 'meeting_probability', label: 'Meeting Probability', category: 'Meeting' },
  { key: 'meeting_car_no', label: 'Meeting Car No', category: 'Meeting' },
  
  // Applicants Information
  { key: 'potential_applicants', label: 'Potential Applicants', category: 'Applicants' },
  { key: 'potential_applicants_meeting', label: 'Potential Applicants Meeting', category: 'Applicants' },
  { key: 'number_of_applicants_meeting', label: 'Number of Applicants Meeting', category: 'Applicants' },
  { key: 'no_of_applicants', label: 'No of Applicants', category: 'Applicants' },
  
  // Timeline & Dates
  { key: 'created_at', label: 'Created Date', category: 'Timeline' },
  { key: 'updated_at', label: 'Updated Date', category: 'Timeline' },
  { key: 'next_followup', label: 'Next Followup', category: 'Timeline' },
  { key: 'followup', label: 'Followup', category: 'Timeline' },
  { key: 'date_signed', label: 'Date Signed', category: 'Timeline' },
  { key: 'payment_due_date', label: 'Payment Due Date', category: 'Timeline' },
  { key: 'expiry_date', label: 'Expiry Date', category: 'Timeline' },
  { key: 'eligibility_date', label: 'Eligibility Date', category: 'Timeline' },
  { key: 'expert_eligibility_date', label: 'Expert Eligibility Date', category: 'Timeline' },
  { key: 'documents_uploaded_date', label: 'Documents Uploaded Date', category: 'Timeline' },
  { key: 'latest_interaction', label: 'Latest Interaction', category: 'Timeline' },
  { key: 'stage_changed_at', label: 'Stage Changed At', category: 'Timeline' },
  { key: 'unactivated_at', label: 'Unactivated At', category: 'Timeline' },
  
  // Details & Notes
  { key: 'facts', label: 'Facts', category: 'Details' },
  { key: 'special_notes', label: 'Special Notes', category: 'Details' },
  { key: 'general_notes', label: 'General Notes', category: 'Details' },
  { key: 'anchor', label: 'Anchor', category: 'Details' },
  { key: 'probability', label: 'Probability', category: 'Details' },
  { key: 'tags', label: 'Tags', category: 'Details' },
  { key: 'proposal_text', label: 'Proposal Text', category: 'Details' },
  { key: 'description', label: 'Description', category: 'Details' },
  { key: 'management_notes', label: 'Management Notes', category: 'Details' },
  { key: 'external_notes', label: 'External Notes', category: 'Details' },
  { key: 'deactivate_notes', label: 'Deactivate Notes', category: 'Details' },
  { key: 'unactivation_reason', label: 'Unactivation Reason', category: 'Details' },
  
  // Roles
  { key: 'scheduler', label: 'Scheduler', category: 'Roles' },
  { key: 'manager', label: 'Manager', category: 'Roles' },
  { key: 'lawyer', label: 'Lawyer', category: 'Roles' },
  { key: 'expert', label: 'Expert', category: 'Roles' },
  { key: 'closer', label: 'Closer', category: 'Roles' },
  { key: 'case_handler', label: 'Case Handler', category: 'Roles' },
  { key: 'handler', label: 'Handler', category: 'Roles' },
  { key: 'helper', label: 'Helper', category: 'Roles' },
  
  // Additional Info
  { key: 'desired_location', label: 'Desired Location', category: 'Additional' },
  { key: 'client_country', label: 'Client Country', category: 'Additional' },
  { key: 'language_preference', label: 'Language Preference', category: 'Additional' },
  { key: 'onedrive_folder_link', label: 'OneDrive Folder Link', category: 'Additional' },
  { key: 'docs_url', label: 'Docs URL', category: 'Additional' },
  { key: 'auto_email_meeting_summary', label: 'Auto Email Meeting Summary', category: 'Additional' },
  { key: 'expert_eligibility_assessed', label: 'Expert Eligibility Assessed', category: 'Additional' },
  { key: 'sales_roles_locked', label: 'Sales Roles Locked', category: 'Additional' },
  { key: 'dependent', label: 'Dependent', category: 'Additional' },
  { key: 'kind', label: 'Kind', category: 'Additional' },
  { key: 'auto', label: 'Auto', category: 'Additional' },
  { key: 'autocall', label: 'Autocall', category: 'Additional' },
  { key: 'ball', label: 'Ball', category: 'Additional' },
  { key: 'eligibile', label: 'Eligible', category: 'Additional' },
];

// Reusable searchable input component - moved outside to prevent re-creation
const SearchableInput = ({ 
  label, 
  field, 
  value, 
  placeholder, 
  options, 
  showDropdown, 
  onSelect,
  onFilterChange,
  onShowDropdown,
  onHideDropdown
}: {
  label: string;
  field: string;
  value: string;
  placeholder: string;
  options: string[];
  showDropdown: boolean;
  onSelect: (value: string) => void;
  onFilterChange: (field: string, value: string) => void;
  onShowDropdown: (field: string) => void;
  onHideDropdown: (field: string) => void;
}) => (
  <div className="form-control flex flex-col col-span-2 sm:col-span-1 relative">
    <label className="label mb-2"><span className="label-text">{label}</span></label>
    <div className="relative">
      <input
        type="text"
        className="input input-bordered w-full"
        placeholder={placeholder}
        value={value}
        onChange={e => {
          onFilterChange(field, e.target.value);
        }}
        onFocus={() => {
          if (options.length > 0) {
            onShowDropdown(field);
          }
        }}
        onBlur={() => {
          // Delay hiding to allow click on dropdown item
          setTimeout(() => onHideDropdown(field), 200);
        }}
      />
      {showDropdown && options.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {options.map((option, index) => (
            <div
              key={index}
              className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
              onClick={() => onSelect(option)}
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

// Multi-select input component for multiple selections
const MultiSelectInput = ({ 
  label, 
  field, 
  values,
  placeholder, 
  options, 
  showDropdown, 
  onSelect,
  onRemove,
  onFilterChange,
  onShowDropdown,
  onHideDropdown
}: {
  label: string;
  field: string;
  values: string[] | any; // Allow any type and handle it safely inside
  placeholder: string;
  options: string[];
  showDropdown: boolean;
  onSelect: (field: string, value: string) => void;
  onRemove: (field: string, value: string) => void;
  onFilterChange: (field: string, value: string) => void;
  onShowDropdown: (field: string) => void;
  onHideDropdown: (field: string) => void;
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    onFilterChange(field, value);
    onShowDropdown(field);
  };

  const handleSelect = (option: string) => {
    if (!safeValues.includes(option)) {
      onSelect(field, option);
    }
    setInputValue('');
    onHideDropdown(field);
  };

  const handleRemove = (value: string) => {
    onRemove(field, value);
  };

  // Ensure values is always an array
  const safeValues = Array.isArray(values) ? values : [];
  
  const filteredOptions = options.filter(option => 
    option.toLowerCase().includes(inputValue.toLowerCase()) && 
    !safeValues.includes(option)
  );

  return (
    <div className="form-control flex flex-col col-span-2 sm:col-span-1 relative">
      <label className="label mb-2">
        <span className="label-text">{label}</span>
        {safeValues.length > 0 && (
          <span className="label-text-alt text-purple-600 font-medium">
            {safeValues.length} selected
          </span>
        )}
      </label>
      
      {/* Selected items */}
      {safeValues.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {safeValues.map((value, index) => (
            <span
              key={index}
              className="badge badge-primary badge-lg gap-2"
            >
              {value}
              <button
                type="button"
                className="btn btn-ghost btn-xs p-0 h-auto min-h-0"
                onClick={() => handleRemove(value)}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input field */}
      <div className="relative">
        <input
          type="text"
          className="input input-bordered w-full"
          placeholder={safeValues.length === 0 ? placeholder : "Add more..."}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (options.length > 0) {
              onShowDropdown(field);
            }
          }}
          onBlur={() => {
            setTimeout(() => onHideDropdown(field), 200);
          }}
        />
        {showDropdown && filteredOptions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {filteredOptions.map((option, index) => (
              <div
                key={index}
                className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                onClick={() => handleSelect(option)}
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                {option}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Special component for main category selection with auto-subcategory selection
// Column Selector Component for Table View
const ColumnSelector = ({ 
  selectedColumns, 
  onColumnsChange, 
  showDropdown, 
  onShowDropdown, 
  onHideDropdown 
}: {
  selectedColumns: string[];
  onColumnsChange: (columns: string[]) => void;
  showDropdown: boolean;
  onShowDropdown: () => void;
  onHideDropdown: () => void;
}) => {
  const groupedColumns = AVAILABLE_COLUMNS.reduce((acc, column) => {
    if (!acc[column.category]) {
      acc[column.category] = [];
    }
    acc[column.category].push(column);
    return acc;
  }, {} as Record<string, typeof AVAILABLE_COLUMNS>);

  const handleColumnToggle = (columnKey: string) => {
    if (selectedColumns.includes(columnKey)) {
      onColumnsChange(selectedColumns.filter(col => col !== columnKey));
    } else {
      onColumnsChange([...selectedColumns, columnKey]);
    }
  };

  return (
    <div className="form-control flex flex-col col-span-2 sm:col-span-1 relative">
      <label className="label mb-2">
        <span className="label-text">Table Columns</span>
        <span className="label-text-alt text-purple-600 font-medium">
          {selectedColumns.length} selected
        </span>
      </label>
      
      <div className="relative">
        <button
          type="button"
          className="input input-bordered w-full text-left flex items-center justify-between"
          onClick={onShowDropdown}
        >
          <span>Select columns for table view...</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {showDropdown && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-96 overflow-y-auto">
            <div className="p-2" onMouseLeave={() => setTimeout(onHideDropdown, 200)}>
              {Object.entries(groupedColumns).map(([category, columns]) => (
                <div key={category} className="mb-4">
                  <h4 className="font-semibold text-sm text-gray-700 mb-2 border-b pb-1">
                    {category}
                  </h4>
                  <div className="space-y-1">
                    {columns.map((column) => (
                      <label key={column.key} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={selectedColumns.includes(column.key)}
                          onChange={() => handleColumnToggle(column.key)}
                          className="checkbox checkbox-sm"
                        />
                        <span className="text-sm">{column.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const MainCategoryInput = ({ 
  label, 
  field, 
  values,
  placeholder, 
  options, 
  showDropdown, 
  onSelect,
  onRemove,
  onFilterChange,
  onShowDropdown,
  onHideDropdown,
  onMainCategorySelect
}: {
  label: string;
  field: string;
  values: string[] | any;
  placeholder: string;
  options: string[];
  showDropdown: boolean;
  onSelect: (field: string, value: string) => void;
  onRemove: (field: string, value: string) => void;
  onFilterChange: (field: string, value: string) => void;
  onShowDropdown: (field: string) => void;
  onHideDropdown: (field: string) => void;
  onMainCategorySelect: (mainCategoryName: string) => void;
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    onFilterChange(field, value);
    onShowDropdown(field);
  };

  const handleSelect = (option: string) => {
    if (!safeValues.includes(option)) {
      // Call the special main category handler
      onMainCategorySelect(option);
    }
    setInputValue('');
    onHideDropdown(field);
  };

  const handleRemove = (value: string) => {
    onRemove(field, value);
  };

  // Ensure values is always an array
  const safeValues = Array.isArray(values) ? values : [];
  
  const filteredOptions = options.filter(option => 
    option.toLowerCase().includes(inputValue.toLowerCase()) && 
    !safeValues.includes(option)
  );

  return (
    <div className="form-control flex flex-col col-span-2 sm:col-span-1 relative">
      <label className="label mb-2">
        <span className="label-text">{label}</span>
        {safeValues.length > 0 && (
          <span className="label-text-alt text-purple-600 font-medium">
            {safeValues.length} selected
          </span>
        )}
      </label>
      
      {/* Selected items */}
      {safeValues.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {safeValues.map((value, index) => (
            <span
              key={index}
              className="badge badge-primary badge-lg gap-2"
            >
              {value}
              <button
                type="button"
                className="btn btn-ghost btn-xs p-0 h-auto min-h-0"
                onClick={() => handleRemove(value)}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input field */}
      <div className="relative">
        <input
          type="text"
          className="input input-bordered w-full"
          placeholder={safeValues.length === 0 ? placeholder : "Add more..."}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (options.length > 0) {
              onShowDropdown(field);
            }
          }}
          onBlur={() => {
            setTimeout(() => onHideDropdown(field), 200);
          }}
        />
        {showDropdown && filteredOptions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {filteredOptions.map((option, index) => (
              <div
                key={index}
                className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                onClick={() => handleSelect(option)}
              >
                <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span className="font-medium text-purple-700">{option}</span>
                <span className="text-xs text-gray-500 ml-auto">Auto-selects all subcategories</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Table View Component
const TableView = ({ leads, selectedColumns, onLeadClick }: { leads: Lead[], selectedColumns: string[], onLeadClick: (leadNumber: string) => void }) => {
  // Helper function to get currency symbol
  const getCurrencySymbol = (currencyId: any) => {
    if (!currencyId) return '₪'; // Default to NIS
    
    // Handle string currency codes
    if (typeof currencyId === 'string') {
      switch (currencyId.toLowerCase()) {
        case 'nis': case 'ils': return '₪';
        case 'usd': return '$';
        case 'eur': return '€';
        case 'gbp': return '£';
        case 'cad': return 'C$';
        case 'aud': return 'A$';
        default: return '₪';
      }
    }
    
    // Handle numeric currency IDs (common in database)
    if (typeof currencyId === 'number') {
      switch (currencyId) {
        case 1: return '₪'; // NIS
        case 2: return '$'; // USD
        case 3: return '€'; // EUR
        case 4: return '£'; // GBP
        default: return '₪';
      }
    }
    
    return '₪'; // Default fallback
  };

  const getColumnValue = (lead: Lead, columnKey: string) => {
    const leadWithData = lead as any;
    
    // Handle roles - both individual role fields and the roles object
    const roleFields = ['scheduler', 'manager', 'lawyer', 'expert', 'closer', 'case_handler', 'handler', 'helper'];
    if (roleFields.includes(columnKey)) {
      // First try to get from roles object
      if (leadWithData.roles && leadWithData.roles[columnKey]) {
        return leadWithData.roles[columnKey];
      }
      // Fallback to direct field access
      return leadWithData[columnKey] || '';
    }
    
    if (columnKey === 'roles') {
      return leadWithData.roles ? Object.entries(leadWithData.roles)
        .filter(([_, value]) => value)
        .map(([role, name]) => `${role}: ${name}`)
        .join(', ') : '';
    }
    
    // Special handling for category to show main and sub category together
    if (columnKey === 'category') {
      return leadWithData.category || 'No Category';
    }
    
    // Special handling for currency columns to show symbols instead of IDs
    const currencyColumns = ['meeting_currency', 'proposal_currency', 'balance_currency', 'meeting_total_currency'];
    if (currencyColumns.includes(columnKey)) {
      const currencyId = leadWithData[columnKey];
      const currencySymbol = getCurrencySymbol(currencyId);
      
      // Debug logging for currency columns
      if (columnKey === 'balance_currency' && Math.random() < 0.1) { // Log 10% of balance_currency fields for debugging
        console.log('🔍 Currency column debug:', {
          columnKey,
          currencyId,
          currencySymbol,
          leadData: leadWithData
        });
      }
      
      return currencySymbol;
    }
    
    const value = leadWithData[columnKey];
    if (value === null || value === undefined) return '';
    
    // Format dates
    if (columnKey.includes('_at') || columnKey.includes('date') || columnKey.includes('Date')) {
      try {
        return new Date(value).toLocaleDateString();
      } catch {
        return value.toString();
      }
    }
    
    // Format time fields
    if (columnKey.includes('time') || columnKey.includes('Time')) {
      return value.toString();
    }
    
    // Format financial values with currency
    const financialFields = ['meeting_amount', 'proposal_total', 'balance', 'potential_value', 'total', 'first_payment', 'meeting_total', 'vat', 'vat_value', 'bonus_paid', 'subcontractor_fee'];
    if (financialFields.includes(columnKey)) {
      // Handle both numbers and numeric strings
      const numericValue = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(numericValue)) {
        // Get corresponding currency field - try different naming conventions
        let currencyField = columnKey + '_currency';
        let currency = leadWithData[currencyField];
        
        // If currency field not found, try alternative naming
        if (!currency) {
          if (columnKey === 'meeting_amount' || columnKey === 'meeting_total') {
            currency = leadWithData['meeting_currency'] || leadWithData['meeting_total_currency'];
          } else if (columnKey === 'proposal_total') {
            currency = leadWithData['proposal_currency'];
          } else if (columnKey === 'balance') {
            currency = leadWithData['balance_currency'];
          } else {
            // Fallback to general currency fields
            currency = leadWithData['currency_id'] || leadWithData['currency'];
          }
        }
        
        const currencySymbol = getCurrencySymbol(currency);
        
        // Debug logging for currency display
        if (columnKey === 'total' && Math.random() < 0.1) { // Log 10% of total fields for debugging
          console.log('🔍 Currency debug for total field:', {
            columnKey,
            originalValue: value,
            numericValue,
            valueType: typeof value,
            currencyField,
            currency,
            currencySymbol,
            leadData: leadWithData
          });
        }
        
        return `${numericValue.toLocaleString()} ${currencySymbol}`;
      }
      return value.toString();
    }
    
    // Format boolean fields
    const booleanFields = ['meeting_paid', 'auto_email_meeting_summary', 'expert_eligibility_assessed', 'sales_roles_locked', 'dependent', 'auto', 'autocall', 'eligibile'];
    if (booleanFields.includes(columnKey)) {
      if (typeof value === 'boolean') {
        return value ? 'Yes' : 'No';
      }
      return value.toString();
    }
    
    // Handle arrays
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    
    // Handle JSON objects
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }
    
    return value.toString();
  };

  if (leads.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No leads found matching your criteria.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table table-zebra w-full">
        <thead>
          <tr>
            {selectedColumns.map((columnKey) => {
              const column = AVAILABLE_COLUMNS.find(col => col.key === columnKey);
              return (
                <th key={columnKey} className="font-semibold">
                  {column?.label || columnKey}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, index) => (
            <tr 
              key={lead.id || index} 
              className="hover cursor-pointer transition-colors duration-200 hover:bg-blue-50 active:bg-blue-100"
              onClick={() => {
                const leadNumber = (lead as any).lead_number || lead.id?.toString();
                if (leadNumber) {
                  onLeadClick(leadNumber);
                }
              }}
              title={`Click to view lead ${(lead as any).lead_number || lead.id}`}
            >
              {selectedColumns.map((columnKey) => (
                <td key={columnKey} className="max-w-xs">
                  <div className="truncate" title={getColumnValue(lead, columnKey)}>
                    {getColumnValue(lead, columnKey)}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const LeadSearchPage: React.FC = () => {
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    category: [] as string[],
    language: [] as string[],
    reason: [] as string[],
    tags: [] as string[],
    fileId: '',
    status: [] as string[],
    source: [] as string[],
    eligibilityDeterminedOnly: false,
    stage: [] as string[],
    topic: [] as string[],
    content: '',
    scheduler: [] as string[],
    manager: [] as string[],
    lawyer: [] as string[],
    expert: [] as string[],
    closer: [] as string[],
    case_handler: [] as string[],
  });
  const [results, setResults] = useState<Lead[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [mainCategoryOptions, setMainCategoryOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [topicOptions, setTopicOptions] = useState<string[]>([]);
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [showTopicDropdown, setShowTopicDropdown] = useState(false);
  const [filteredTopicOptions, setFilteredTopicOptions] = useState<string[]>([]);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [filteredCategoryOptions, setFilteredCategoryOptions] = useState<string[]>([]);
  const [showMainCategoryDropdown, setShowMainCategoryDropdown] = useState(false);
  const [filteredMainCategoryOptions, setFilteredMainCategoryOptions] = useState<string[]>([]);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [filteredLanguageOptions, setFilteredLanguageOptions] = useState<string[]>([]);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [filteredSourceOptions, setFilteredSourceOptions] = useState<string[]>([]);
  const [showStageDropdown, setShowStageDropdown] = useState(false);
  const [filteredStageOptions, setFilteredStageOptions] = useState<string[]>([]);
  const [showReasonDropdown, setShowReasonDropdown] = useState(false);
  const [filteredReasonOptions, setFilteredReasonOptions] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [filteredTagOptions, setFilteredTagOptions] = useState<string[]>([]);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [filteredStatusOptions, setFilteredStatusOptions] = useState<string[]>([]);
  const [showSchedulerDropdown, setShowSchedulerDropdown] = useState(false);
  const [showManagerDropdown, setShowManagerDropdown] = useState(false);
  const [showLawyerDropdown, setShowLawyerDropdown] = useState(false);
  const [showExpertDropdown, setShowExpertDropdown] = useState(false);
  const [showCloserDropdown, setShowCloserDropdown] = useState(false);
  const [showCaseHandlerDropdown, setShowCaseHandlerDropdown] = useState(false);
  const [filteredRoleOptions, setFilteredRoleOptions] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(['name', 'lead_number', 'email', 'phone', 'stage', 'source', 'created_at']);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const navigate = useNavigate();

  // Handle lead click navigation
  const handleLeadClick = (leadNumber: string) => {
    navigate(`/clients/${leadNumber}`);
  };

  // Fetch stage options from lead_stages table
  useEffect(() => {
    const fetchStageOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('lead_stages')
          .select('name')
          .order('name');
        
        if (error) throw error;
        
        const stages = data?.map(stage => stage.name) || [];
        setStageOptions(stages);
      } catch (error) {
        console.error('Error fetching stage options:', error);
        // Fallback to hardcoded options if database fetch fails
        setStageOptions([
          "created", "scheduler_assigned", "meeting_scheduled", "meeting_paid", 
          "unactivated", "communication_started", "another_meeting", "revised_offer", 
          "offer_sent", "waiting_for_mtng_sum", "client_signed", "client_declined", 
          "lead_summary", "meeting_rescheduled", "meeting_ended"
        ]);
      }
    };

    fetchStageOptions();
  }, []);

  // Fetch category options from misc_category table with main category relationship
  useEffect(() => {
    const fetchCategoryOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          `)
          .order('name', { ascending: true });
        
        if (error) throw error;
        
        // Format category names with main category in parentheses (same as CalendarPage)
        const formattedCategories = data?.map((category: any) => {
          if (category.misc_maincategory?.name) {
            return `${category.name} (${category.misc_maincategory.name})`;
          } else {
            return category.name; // Fallback if no main category
          }
        }).filter(Boolean) || [];
        
        setCategoryOptions(formattedCategories);
      } catch (error) {
        console.error('Error fetching category options:', error);
        // Fallback to hardcoded options if database fetch fails
        setCategoryOptions([
          "German Citizenship", "Austrian Citizenship", "Inquiry", "Consultation", "Other"
        ]);
      }
    };

    fetchCategoryOptions();
  }, []);

  // Fetch main categories
  useEffect(() => {
    const fetchMainCategories = async () => {
      try {
        const { data: mainCategories, error } = await supabase
          .from('misc_maincategory')
          .select('id, name')
          .order('name');

        if (error) {
          console.error('Error fetching main categories:', error);
          return;
        }

        if (mainCategories) {
          setMainCategoryOptions(mainCategories.map(cat => cat.name));
        }
      } catch (error) {
        console.error('Error fetching main categories:', error);
      }
    };

    fetchMainCategories();
  }, []);

  // Fetch source options from misc_leadsource table
  useEffect(() => {
    const fetchSourceOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_leadsource')
          .select('id, name')
          .eq('active', true)
          .order('name');
        
        if (error) throw error;
        
        const sources = data?.map(source => source.name) || [];
        setSourceOptions(sources);
        console.log('✅ Fetched source options from misc_leadsource:', sources);
      } catch (error) {
        console.error('Error fetching source options:', error);
        // Fallback to hardcoded options if database fetch fails
        setSourceOptions([
          "Manual", "AI Assistant", "Referral", "Website", "Other"
        ]);
      }
    };

    fetchSourceOptions();
  }, []);

  // Fetch language options from misc_language table
  useEffect(() => {
    const fetchLanguageOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_language')
          .select('name')
          .order('name');
        
        if (error) throw error;
        
        const languages = data?.map(language => language.name) || [];
        setLanguageOptions(languages);
      } catch (error) {
        console.error('Error fetching language options:', error);
        // Fallback to hardcoded options if database fetch fails
        setLanguageOptions([
          "English", "Hebrew", "German", "French", "Russian", "Other"
        ]);
      }
    };

    fetchLanguageOptions();
  }, []);

  // Fetch topic options from both leads and leads_lead tables
  useEffect(() => {
    const fetchTopicOptions = async () => {
      try {
        const [newTopics, legacyTopics] = await Promise.all([
          supabase.from('leads').select('topic').not('topic', 'is', null),
          supabase.from('leads_lead').select('topic').not('topic', 'is', null)
        ]);

        const allTopics = [
          ...(newTopics.data || []).map(t => t.topic),
          ...(legacyTopics.data || []).map(t => t.topic)
        ];
        const uniqueTopics = [...new Set(allTopics.filter(Boolean))];
        setTopicOptions(uniqueTopics);
      } catch (error) {
        console.error('Error fetching topic options:', error);
        // Fallback to hardcoded options if database fetch fails
        setTopicOptions([
          "German Citizenship", "Austrian Citizenship", "Inquiry", "Consultation", "Other"
        ]);
      }
    };

    fetchTopicOptions();
  }, []);

  // Fetch role options from tenants_employee table
  useEffect(() => {
    const fetchRoleOptions = async () => {
      try {
        const { data: employees, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .not('display_name', 'is', null)
          .order('display_name');

        if (error) {
          console.error('Error fetching employees for role options:', error);
          return;
        }

        if (employees) {
          const employeeNames = employees.map(emp => emp.display_name);
          setRoleOptions(employeeNames);
        }
      } catch (error) {
        console.error('Error fetching employees for role options:', error);
      }
    };

    fetchRoleOptions();
  }, []);

  // Initialize filtered options when data is loaded
  useEffect(() => {
    setFilteredTopicOptions(topicOptions);
  }, [topicOptions]);

  useEffect(() => {
    setFilteredCategoryOptions(categoryOptions);
  }, [categoryOptions]);

  useEffect(() => {
    setFilteredLanguageOptions(languageOptions);
  }, [languageOptions]);

  useEffect(() => {
    setFilteredSourceOptions(sourceOptions);
  }, [sourceOptions]);

  useEffect(() => {
    setFilteredStageOptions(stageOptions);
  }, [stageOptions]);

  useEffect(() => {
    setFilteredReasonOptions(REASON_OPTIONS);
  }, []);

  useEffect(() => {
    setFilteredTagOptions(TAG_OPTIONS);
  }, []);

  useEffect(() => {
    setFilteredStatusOptions(STATUS_OPTIONS);
  }, []);

  // Handle filtering for all dropdowns when user types
  // Topic filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredTopicOptions(topicOptions);
  }, [topicOptions]);

  // Category filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredCategoryOptions(categoryOptions);
  }, [categoryOptions]);

  // Main category filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredMainCategoryOptions(mainCategoryOptions);
  }, [mainCategoryOptions]);

  // Language filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredLanguageOptions(languageOptions);
  }, [languageOptions]);

  // Source filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredSourceOptions(sourceOptions);
  }, [sourceOptions]);

  // Stage filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredStageOptions(stageOptions);
  }, [stageOptions]);

  // Reason filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredReasonOptions(REASON_OPTIONS);
  }, []);

  // Tags filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredTagOptions(TAG_OPTIONS);
  }, []);

  // Status filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredStatusOptions(STATUS_OPTIONS);
  }, []);

  // Role filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredRoleOptions(roleOptions);
  }, [roleOptions]);

  const handleFilterChange = (field: string, value: any) => {
    // For multi-select fields, don't update the filter directly - 
    // the MultiSelectInput component handles its own input state
    const multiSelectFields = ['category', 'language', 'reason', 'tags', 'status', 'source', 'stage', 'topic', 'scheduler', 'manager', 'lawyer', 'expert', 'closer', 'case_handler'];
    if (multiSelectFields.includes(field)) {
      // Do nothing - MultiSelectInput handles its own input state
      return;
    }
    
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleMultiSelect = (field: string, value: string) => {
    setFilters(prev => ({
      ...prev,
      [field]: [...(prev[field as keyof typeof prev] as string[]), value]
    }));
  };

  const handleMultiRemove = (field: string, value: string) => {
    setFilters(prev => ({
      ...prev,
      [field]: (prev[field as keyof typeof prev] as string[]).filter(item => item !== value)
    }));
  };

  // Handle main category selection and automatically select all subcategories
  const handleMainCategorySelect = async (mainCategoryName: string) => {
    try {
      // First, get the main category ID
      const { data: mainCategory, error: mainError } = await supabase
        .from('misc_maincategory')
        .select('id')
        .eq('name', mainCategoryName)
        .single();

      if (mainError || !mainCategory) {
        console.error('Error finding main category:', mainError);
        return;
      }

      // Then get all subcategories for this main category
      const { data: subcategories, error: subError } = await supabase
        .from('misc_category')
        .select('name, misc_maincategory!parent_id(name)')
        .eq('parent_id', mainCategory.id);

      if (subError) {
        console.error('Error fetching subcategories:', subError);
        return;
      }

      if (subcategories) {
        // Format subcategories as "Subcategory (Main Category)" to match existing format
        const formattedSubcategories = subcategories.map(sub => 
          `${sub.name} (${mainCategoryName})`
        );

        // Add all subcategories to the current category selection
        setFilters(prev => {
          const currentCategories = prev.category || [];
          const newCategories = [...currentCategories, ...formattedSubcategories];
          // Remove duplicates
          return {
            ...prev,
            category: [...new Set(newCategories)]
          };
        });

        console.log(`✅ Auto-selected ${formattedSubcategories.length} subcategories for main category: ${mainCategoryName}`);
      }
    } catch (error) {
      console.error('Error handling main category selection:', error);
    }
  };

  const handleShowDropdown = (field: string) => {
    switch (field) {
      case 'topic': setShowTopicDropdown(true); break;
      case 'category': setShowCategoryDropdown(true); break;
      case 'mainCategory': setShowMainCategoryDropdown(true); break;
      case 'language': setShowLanguageDropdown(true); break;
      case 'source': setShowSourceDropdown(true); break;
      case 'stage': setShowStageDropdown(true); break;
      case 'reason': setShowReasonDropdown(true); break;
      case 'tags': setShowTagDropdown(true); break;
      case 'status': setShowStatusDropdown(true); break;
      case 'scheduler': setShowSchedulerDropdown(true); break;
      case 'manager': setShowManagerDropdown(true); break;
      case 'lawyer': setShowLawyerDropdown(true); break;
      case 'expert': setShowExpertDropdown(true); break;
      case 'closer': setShowCloserDropdown(true); break;
      case 'case_handler': setShowCaseHandlerDropdown(true); break;
      case 'columns': setShowColumnSelector(true); break;
    }
  };

  const handleHideDropdown = (field: string) => {
    switch (field) {
      case 'topic': setShowTopicDropdown(false); break;
      case 'category': setShowCategoryDropdown(false); break;
      case 'mainCategory': setShowMainCategoryDropdown(false); break;
      case 'language': setShowLanguageDropdown(false); break;
      case 'source': setShowSourceDropdown(false); break;
      case 'stage': setShowStageDropdown(false); break;
      case 'reason': setShowReasonDropdown(false); break;
      case 'tags': setShowTagDropdown(false); break;
      case 'status': setShowStatusDropdown(false); break;
      case 'scheduler': setShowSchedulerDropdown(false); break;
      case 'manager': setShowManagerDropdown(false); break;
      case 'lawyer': setShowLawyerDropdown(false); break;
      case 'expert': setShowExpertDropdown(false); break;
      case 'closer': setShowCloserDropdown(false); break;
      case 'case_handler': setShowCaseHandlerDropdown(false); break;
      case 'columns': setShowColumnSelector(false); break;
    }
  };

  // Old single-select handlers removed - now using MultiSelectInput with handleMultiSelect/handleMultiRemove


  // Helper function to escape special characters in search terms for PostgREST
  const escapeSearchTerm = (term: string) => {
    // PostgREST requires different escaping - replace parentheses with safe characters
    return term.replace(/[()]/g, '');
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchPerformed(true);
    
    console.log('🔍 Starting lead search with filters:', filters);
    
    // Create employee mappings for role filters
    const nameToIdMapping = new Map<string, number>();
    const idToNameMapping = new Map<number, string>();
    
    try {
      // Fetch employee data for role filtering
      const { data: employees, error: empError } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .not('display_name', 'is', null);

      if (!empError && employees) {
        employees.forEach(employee => {
          nameToIdMapping.set(employee.display_name, employee.id);
          idToNameMapping.set(employee.id, employee.display_name);
        });
        console.log('✅ Loaded employee mappings for role filters:', nameToIdMapping.size, 'employees');
      }

      // First, let's test basic table access without joins
      console.log('🧪 Testing basic table access...');
      
      try {
        const basicNewLeadsTest = await supabase.from('leads').select('id, name, category, created_at').limit(10);
        console.log('✅ Basic new leads test:', {
          data: basicNewLeadsTest.data,
          error: basicNewLeadsTest.error,
          count: basicNewLeadsTest.data?.length || 0,
          sampleDates: basicNewLeadsTest.data?.map(lead => ({
            id: lead.id,
            name: lead.name,
            category: lead.category,
            created_at: lead.created_at
          }))
        });
      } catch (testError) {
        console.error('❌ Basic new leads test failed:', testError);
      }
      
      try {
        const basicLegacyLeadsTest = await supabase.from('leads_lead').select('id, name, category, cdate').limit(10);
        console.log('✅ Basic legacy leads test:', {
          data: basicLegacyLeadsTest.data,
          error: basicLegacyLeadsTest.error,
          count: basicLegacyLeadsTest.data?.length || 0,
          sampleDates: basicLegacyLeadsTest.data?.map(lead => ({
            id: lead.id,
            name: lead.name,
            category: lead.category,
            cdate: lead.cdate
          }))
        });
      } catch (testError) {
        console.error('❌ Basic legacy leads test failed:', testError);
      }

      // Now try with category join
      console.log('🧪 Testing category join access...');
      
      try {
        const categoryJoinTest = await supabase
          .from('leads')
          .select(`
            id,
            name,
            category,
            misc_category!category_id (
              id,
              name,
              parent_id,
              misc_maincategory!parent_id (
                id,
                name
              )
            )
          `)
          .limit(3);
        console.log('✅ Category join test for new leads:', {
          data: categoryJoinTest.data,
          error: categoryJoinTest.error,
          count: categoryJoinTest.data?.length || 0
        });
      } catch (testError) {
        console.error('❌ Category join test for new leads failed:', testError);
      }
      
      try {
        const legacyCategoryJoinTest = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            category,
            misc_category!category_id (
              id,
              name,
              parent_id,
              misc_maincategory!parent_id (
                id,
                name
              )
            )
          `)
          .limit(3);
        console.log('✅ Category join test for legacy leads:', {
          data: legacyCategoryJoinTest.data,
          error: legacyCategoryJoinTest.error,
          count: legacyCategoryJoinTest.data?.length || 0
        });
      } catch (testError) {
        console.error('❌ Category join test for legacy leads failed:', testError);
      }
      
      // Search new leads table with category join for main category information
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          *,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(id, name)
          )
        `);
      
      console.log('📋 New leads query base:', newLeadsQuery);
      
      // Test filters one by one to identify the problem
      console.log('🧪 Testing filters individually...');
      
      // Test 1: No filters at all
      try {
        const noFiltersTest = await newLeadsQuery.limit(5);
        console.log('✅ New leads with no filters:', {
          count: noFiltersTest.data?.length || 0,
          data: noFiltersTest.data
        });
      } catch (testError) {
        console.error('❌ New leads no filters test failed:', testError);
      }
      
      // Test 2: Only date filters
      if (filters.fromDate || filters.toDate) {
        try {
          let dateOnlyQuery = newLeadsQuery;
          if (filters.fromDate) {
            console.log('📅 Testing fromDate filter only:', filters.fromDate);
            dateOnlyQuery = dateOnlyQuery.gte('created_at', filters.fromDate);
          }
          if (filters.toDate) {
            console.log('📅 Testing toDate filter only:', filters.toDate);
            dateOnlyQuery = dateOnlyQuery.lte('created_at', filters.toDate);
          }
          const dateOnlyTest = await dateOnlyQuery.limit(5);
          console.log('✅ New leads with date filters only:', {
            count: dateOnlyTest.data?.length || 0,
            data: dateOnlyTest.data
          });
        } catch (testError) {
          console.error('❌ New leads date filters test failed:', testError);
        }
      }
      
      // Test 3: Only category filter
      if (filters.category && filters.category.length > 0) {
        try {
          console.log('🏷️ Testing category filter only:', filters.category);
          
          const categoryNames = filters.category.map(cat => cat.split(' (')[0].trim());
          const categoryOnlyTest = await newLeadsQuery
            .in('category', categoryNames)
            .limit(5);
          console.log('✅ New leads with category filter:', {
            count: categoryOnlyTest.data?.length || 0,
            data: categoryOnlyTest.data
          });
        } catch (testError) {
          console.error('❌ New leads category filter test failed:', testError);
        }
      }
      
      // Apply filters for new leads
      if (filters.fromDate) {
        console.log('📅 Adding fromDate filter for new leads:', filters.fromDate);
        newLeadsQuery = newLeadsQuery.gte('created_at', filters.fromDate);
      }
      if (filters.toDate) {
        console.log('📅 Adding toDate filter for new leads:', filters.toDate);
        newLeadsQuery = newLeadsQuery.lte('created_at', filters.toDate);
      }
      if (filters.category && filters.category.length > 0) {
        console.log('🏷️ Adding category filter for new leads:', filters.category);
        // Extract category names (remove main category in parentheses)
        const categoryNames = filters.category.map(cat => cat.split(' (')[0].trim());
        
        if (categoryNames.length === 1) {
          // Single category - use exact match
          newLeadsQuery = newLeadsQuery.eq('category', categoryNames[0]);
        } else {
          // Multiple categories - use IN operator for exact matches
          newLeadsQuery = newLeadsQuery.in('category', categoryNames);
        }
      }
      if (filters.language && filters.language.length > 0) {
        console.log('🌐 Adding language filter for new leads:', filters.language);
        newLeadsQuery = newLeadsQuery.in('language', filters.language);
      }
      if (filters.status && filters.status.length > 0) {
        console.log('📊 Adding status filter for new leads:', filters.status);
        newLeadsQuery = newLeadsQuery.in('status', filters.status);
      }
      if (filters.stage && filters.stage.length > 0) {
        console.log('🎯 Adding stage filter for new leads:', filters.stage);
        newLeadsQuery = newLeadsQuery.in('stage', filters.stage);
      }
      if (filters.source && filters.source.length > 0) {
        console.log('📡 Adding source filter for new leads:', filters.source);
        if (filters.source.length === 1) {
          // Single source - use exact match
          newLeadsQuery = newLeadsQuery.eq('source', filters.source[0]);
        } else {
          // Multiple sources - use IN operator for exact matches
          newLeadsQuery = newLeadsQuery.in('source', filters.source);
        }
      }
      if (filters.topic && filters.topic.length > 0) {
        console.log('💬 Adding topic filter for new leads:', filters.topic);
        if (filters.topic.length === 1) {
          // Single topic - use exact match
          newLeadsQuery = newLeadsQuery.eq('topic', filters.topic[0]);
        } else {
          // Multiple topics - use IN operator for exact matches
          newLeadsQuery = newLeadsQuery.in('topic', filters.topic);
        }
      }
      if (filters.tags && filters.tags.length > 0) {
        console.log('🏷️ Adding tags filter for new leads:', filters.tags);
        if (filters.tags.length === 1) {
          // Single tag - use exact match
          newLeadsQuery = newLeadsQuery.eq('tags', filters.tags[0]);
        } else {
          // Multiple tags - use IN operator for exact matches
          newLeadsQuery = newLeadsQuery.in('tags', filters.tags);
        }
      }
      if (filters.fileId) {
        console.log('📁 Adding fileId filter for new leads:', filters.fileId);
        newLeadsQuery = newLeadsQuery.ilike('lead_number', `%${filters.fileId}%`);
      }
      if (filters.content) {
        console.log('📝 Adding content filter for new leads:', filters.content);
        newLeadsQuery = newLeadsQuery.or(`facts.ilike.%${filters.content}%,special_notes.ilike.%${filters.content}%,general_notes.ilike.%${filters.content}%`);
      }
      // Individual role filters for new leads
      if (filters.scheduler && filters.scheduler.length > 0) {
        console.log('👥 Adding scheduler filter for new leads:', filters.scheduler);
        newLeadsQuery = newLeadsQuery.in('scheduler', filters.scheduler);
      }
      if (filters.manager && filters.manager.length > 0) {
        console.log('👥 Adding manager filter for new leads:', filters.manager);
        newLeadsQuery = newLeadsQuery.in('manager', filters.manager);
      }
      if (filters.lawyer && filters.lawyer.length > 0) {
        console.log('👥 Adding lawyer filter for new leads:', filters.lawyer);
        newLeadsQuery = newLeadsQuery.in('lawyer', filters.lawyer);
      }
      if (filters.expert && filters.expert.length > 0) {
        console.log('👥 Adding expert filter for new leads:', filters.expert);
        newLeadsQuery = newLeadsQuery.in('expert', filters.expert);
      }
      if (filters.closer && filters.closer.length > 0) {
        console.log('👥 Adding closer filter for new leads:', filters.closer);
        newLeadsQuery = newLeadsQuery.in('closer', filters.closer);
      }
      if (filters.case_handler && filters.case_handler.length > 0) {
        console.log('👥 Adding case_handler filter for new leads:', filters.case_handler);
        newLeadsQuery = newLeadsQuery.in('handler', filters.case_handler);
      }
      if (filters.eligibilityDeterminedOnly) {
        console.log('✅ Adding eligibility filter for new leads');
        newLeadsQuery = newLeadsQuery.not('eligibility_status', 'is', null);
      }

      // Search legacy leads table with joins for language only (source and stage lookup done manually)
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(`
          *,
          misc_language!leads_lead_language_id_fkey (
            id,
            name
          )
        `);
      
      console.log('📋 Legacy leads query base:', legacyLeadsQuery);
      
      // Apply filters for legacy leads (mapping fields)
      if (filters.fromDate) {
        console.log('📅 Adding fromDate filter for legacy leads:', filters.fromDate);
        legacyLeadsQuery = legacyLeadsQuery.gte('cdate', filters.fromDate);
      }
      if (filters.toDate) {
        console.log('📅 Adding toDate filter for legacy leads:', filters.toDate);
        legacyLeadsQuery = legacyLeadsQuery.lte('cdate', filters.toDate);
      }
      if (filters.category && filters.category.length > 0) {
        console.log('🏷️ Adding category filter for legacy leads:', filters.category);
        try {
          // Look up all selected categories to get their category_ids
          const categoryIds: number[] = [];
          for (const cat of filters.category) {
            const categoryName = cat.split(' (')[0].trim();
            console.log('🔧 Extracted category name:', categoryName);
            
            const categoryLookup = await supabase
              .from('misc_category')
              .select('id')
              .ilike('name', `%${categoryName}%`)
              .limit(1);
            
            if (categoryLookup.data && categoryLookup.data.length > 0) {
              const categoryId = categoryLookup.data[0].id;
              categoryIds.push(categoryId);
              console.log('🔍 Found category_id:', categoryId, 'for category:', categoryName);
            }
          }
          
          if (categoryIds.length > 0) {
            // Use IN operator for multiple category_ids
            legacyLeadsQuery = legacyLeadsQuery.in('category_id', categoryIds);
          } else {
            console.log('❌ No category_ids found for any categories');
            // Fallback to exact match on misc_category.name
            const categoryNames = filters.category.map(cat => cat.split(' (')[0].trim());
            if (categoryNames.length === 1) {
              legacyLeadsQuery = legacyLeadsQuery.eq('misc_category.name', categoryNames[0]);
            } else {
              legacyLeadsQuery = legacyLeadsQuery.in('misc_category.name', categoryNames);
            }
          }
        } catch (error) {
          console.log('⚠️ Category lookup failed, falling back to misc_category.name:', error);
          const categoryNames = filters.category.map(cat => cat.split(' (')[0].trim());
          if (categoryNames.length === 1) {
            legacyLeadsQuery = legacyLeadsQuery.eq('misc_category.name', categoryNames[0]);
          } else {
            legacyLeadsQuery = legacyLeadsQuery.in('misc_category.name', categoryNames);
          }
        }
      }
      if (filters.language && filters.language.length > 0) {
        console.log('🌐 Adding language filter for legacy leads:', filters.language);
        if (filters.language.length === 1) {
          // Single language - use exact match
          legacyLeadsQuery = legacyLeadsQuery.eq('misc_language.name', filters.language[0]);
        } else {
          // Multiple languages - use IN operator for exact matches
          legacyLeadsQuery = legacyLeadsQuery.in('misc_language.name', filters.language);
        }
      }
      if (filters.status) {
        console.log('📊 Status filter for legacy leads - skipping for now');
        // For legacy leads, status is numeric, so we'll need to map status names to IDs
        // For now, skip status filtering for legacy leads
      }
      if (filters.stage && filters.stage.length > 0) {
        console.log('🎯 Adding stage filter for legacy leads:', filters.stage);
        try {
          // Look up all selected stages to get their stage_ids
          const stageIds: number[] = [];
          for (const stage of filters.stage) {
            const stageLookup = await supabase
              .from('lead_stages')
              .select('id')
              .ilike('name', `%${stage}%`)
              .limit(1);
            
            if (stageLookup.data && stageLookup.data.length > 0) {
              const stageId = stageLookup.data[0].id;
              stageIds.push(stageId);
              console.log('🔍 Found stage_id:', stageId, 'for stage:', stage);
            }
          }
          
          if (stageIds.length > 0) {
            // Use IN operator for multiple stage_ids
            legacyLeadsQuery = legacyLeadsQuery.in('stage', stageIds);
          } else {
            console.log('❌ No stage_ids found for any stages');
            // Fallback to exact match on lead_stages.name (if join exists) or skip
            console.log('⚠️ Skipping stage filter for legacy leads - no stage_ids found');
          }
        } catch (error) {
          console.log('⚠️ Stage lookup failed, skipping stage filter for legacy leads:', error);
        }
      }
      if (filters.source && filters.source.length > 0) {
        console.log('📡 Adding source filter for legacy leads:', filters.source);
        try {
          // Look up all selected sources to get their source_ids
          const sourceIds: number[] = [];
          for (const source of filters.source) {
            const sourceLookup = await supabase
              .from('misc_leadsource')
              .select('id')
              .eq('name', source)
              .limit(1);
            
            if (sourceLookup.data && sourceLookup.data.length > 0) {
              const sourceId = sourceLookup.data[0].id;
              sourceIds.push(sourceId);
              console.log('🔍 Found source_id:', sourceId, 'for source:', source);
            }
          }
          
          if (sourceIds.length > 0) {
            // Use IN operator for multiple source_ids
            legacyLeadsQuery = legacyLeadsQuery.in('source_id', sourceIds);
          } else {
            console.log('❌ No source_ids found for any sources');
            // Fallback to exact match on misc_leadsource.name
            if (filters.source.length === 1) {
              legacyLeadsQuery = legacyLeadsQuery.eq('misc_leadsource.name', filters.source[0]);
            } else {
              legacyLeadsQuery = legacyLeadsQuery.in('misc_leadsource.name', filters.source);
            }
          }
        } catch (error) {
          console.log('⚠️ Source lookup failed, falling back to misc_leadsource.name:', error);
          if (filters.source.length === 1) {
            legacyLeadsQuery = legacyLeadsQuery.eq('misc_leadsource.name', filters.source[0]);
          } else {
            legacyLeadsQuery = legacyLeadsQuery.in('misc_leadsource.name', filters.source);
          }
        }
      }
      if (filters.topic && filters.topic.length > 0) {
        console.log('💬 Adding topic filter for legacy leads:', filters.topic);
        if (filters.topic.length === 1) {
          // Single topic - use exact match
          legacyLeadsQuery = legacyLeadsQuery.eq('topic', filters.topic[0]);
        } else {
          // Multiple topics - use IN operator for exact matches
          legacyLeadsQuery = legacyLeadsQuery.in('topic', filters.topic);
        }
      }
      if (filters.fileId) {
        console.log('📁 Adding fileId filter for legacy leads:', filters.fileId);
        legacyLeadsQuery = legacyLeadsQuery.ilike('file_id', `%${filters.fileId}%`);
      }
      if (filters.content) {
        console.log('📝 Adding content filter for legacy leads:', filters.content);
        legacyLeadsQuery = legacyLeadsQuery.or(`special_notes.ilike.%${filters.content}%,notes.ilike.%${filters.content}%,description.ilike.%${filters.content}%`);
      }
      // Individual role filters for legacy leads
      if (filters.scheduler && filters.scheduler.length > 0) {
        console.log('👥 Adding scheduler filter for legacy leads:', filters.scheduler);
        const schedulerIds = filters.scheduler.map(name => nameToIdMapping.get(name)).filter(id => id !== undefined) as number[];
        if (schedulerIds.length > 0) {
          legacyLeadsQuery = legacyLeadsQuery.in('meeting_scheduler_id', schedulerIds);
        }
      }
      if (filters.manager && filters.manager.length > 0) {
        console.log('👥 Adding manager filter for legacy leads:', filters.manager);
        const managerIds = filters.manager.map(name => nameToIdMapping.get(name)).filter(id => id !== undefined) as number[];
        if (managerIds.length > 0) {
          legacyLeadsQuery = legacyLeadsQuery.in('meeting_manager_id', managerIds);
        }
      }
      if (filters.lawyer && filters.lawyer.length > 0) {
        console.log('👥 Adding lawyer filter for legacy leads:', filters.lawyer);
        const lawyerIds = filters.lawyer.map(name => nameToIdMapping.get(name)).filter(id => id !== undefined) as number[];
        if (lawyerIds.length > 0) {
          legacyLeadsQuery = legacyLeadsQuery.in('meeting_lawyer_id', lawyerIds);
        }
      }
      if (filters.expert && filters.expert.length > 0) {
        console.log('👥 Adding expert filter for legacy leads:', filters.expert);
        const expertIds = filters.expert.map(name => nameToIdMapping.get(name)).filter(id => id !== undefined) as number[];
        if (expertIds.length > 0) {
          legacyLeadsQuery = legacyLeadsQuery.in('expert_id', expertIds);
        }
      }
      if (filters.closer && filters.closer.length > 0) {
        console.log('👥 Adding closer filter for legacy leads:', filters.closer);
        const closerIds = filters.closer.map(name => nameToIdMapping.get(name)).filter(id => id !== undefined) as number[];
        if (closerIds.length > 0) {
          legacyLeadsQuery = legacyLeadsQuery.in('closer_id', closerIds);
        }
      }
      if (filters.case_handler && filters.case_handler.length > 0) {
        console.log('👥 Adding case_handler filter for legacy leads:', filters.case_handler);
        const caseHandlerIds = filters.case_handler.map(name => nameToIdMapping.get(name)).filter(id => id !== undefined) as number[];
        if (caseHandlerIds.length > 0) {
          legacyLeadsQuery = legacyLeadsQuery.in('case_handler_id', caseHandlerIds);
        }
      }
      if (filters.eligibilityDeterminedOnly) {
        console.log('✅ Adding eligibility filter for legacy leads');
        legacyLeadsQuery = legacyLeadsQuery.not('eligibility_status', 'is', null);
      }

      console.log('🚀 Executing queries...');
      
      // Execute both queries
      const [newLeadsResult, legacyLeadsResult] = await Promise.all([
        newLeadsQuery.order('created_at', { ascending: false }),
        legacyLeadsQuery.order('cdate', { ascending: false })
      ]);

      console.log('📊 New leads result:', {
        data: newLeadsResult.data,
        error: newLeadsResult.error,
        count: newLeadsResult.data?.length || 0
      });
      
      console.log('📊 Legacy leads result:', {
        data: legacyLeadsResult.data,
        error: legacyLeadsResult.error,
        count: legacyLeadsResult.data?.length || 0
      });

      if (newLeadsResult.error) {
        console.error('❌ New leads query error:', newLeadsResult.error);
        throw newLeadsResult.error;
      }
      if (legacyLeadsResult.error) {
        console.error('❌ Legacy leads query error:', legacyLeadsResult.error);
        throw legacyLeadsResult.error;
      }

      // Format category display to show main and sub category together
      const formatCategoryDisplay = (lead: any) => {
        // Check if we have joined category data
        if (lead.misc_category) {
          const category = lead.misc_category;
          const mainCategory = category.misc_maincategory?.[0]?.name;
          const categoryName = mainCategory ? `${category.name} (${mainCategory})` : category.name;
          return categoryName;
        }
        
        // Fallback to direct category field
        return lead.category || 'No Category';
      };

      console.log('🔄 Processing new leads...');
      // Map new leads with proper category formatting and role information
      const mappedNewLeads = (newLeadsResult.data || []).map(lead => {
        return {
          ...lead,
          category: formatCategoryDisplay(lead),
          roles: {
            scheduler: lead.scheduler || null,
            manager: lead.manager || null,
            lawyer: lead.lawyer || null,
            expert: lead.expert || null,
            closer: lead.closer || null,
            case_handler: lead.handler || null,
          },
        };
      });

      console.log('🔄 Processing legacy leads...');
      
      // Debug: Log the structure of the first legacy lead to see what fields are available
      if (legacyLeadsResult.data && legacyLeadsResult.data.length > 0) {
        console.log('🔍 First legacy lead structure:', Object.keys(legacyLeadsResult.data[0]));
        console.log('🔍 First legacy lead sample data:', legacyLeadsResult.data[0]);
      }
      
      // Create source, stage, category, and employee mapping for legacy leads
      const sourceMapping = new Map<number, string>();
      const stageMapping = new Map<number, string>();
      const categoryMapping = new Map<number, string>();
      const employeeMapping = new Map<number, string>();
      
      try {
        const [sourcesResult, stagesResult, categoriesResult, employeesResult] = await Promise.all([
          supabase.from('misc_leadsource').select('id, name'),
          supabase.from('lead_stages').select('id, name'),
          supabase.from('misc_category').select('id, name, parent_id, misc_maincategory!parent_id(id, name)'),
          supabase.from('tenants_employee').select('id, display_name').not('display_name', 'is', null)
        ]);
        
        if (sourcesResult.data) {
          sourcesResult.data.forEach(source => {
            sourceMapping.set(source.id, source.name);
          });
          console.log('✅ Loaded source mapping:', sourceMapping.size, 'sources');
        }
        
        if (stagesResult.data) {
          stagesResult.data.forEach(stage => {
            // Store both string and numeric keys to handle both cases
            stageMapping.set(stage.id, stage.name);
            stageMapping.set(stage.id.toString(), stage.name);
            stageMapping.set(parseInt(stage.id), stage.name);
          });
          console.log('✅ Loaded stage mapping:', stageMapping.size, 'stages');
          console.log('🔍 Sample stage mapping entries:', Array.from(stageMapping.entries()).slice(0, 5));
        }
        
        if (categoriesResult.data) {
          categoriesResult.data.forEach(category => {
            const mainCategory = (category.misc_maincategory as any)?.[0]?.name;
            const categoryName = mainCategory ? `${category.name} (${mainCategory})` : category.name;
            categoryMapping.set(category.id, categoryName);
          });
          console.log('✅ Loaded category mapping:', categoryMapping.size, 'categories');
        }
        
        if (employeesResult.data) {
          // Employee mapping already created at the beginning of search function
          console.log('✅ Employee data available for mapping:', employeesResult.data.length, 'employees');
        }
      } catch (error) {
        console.log('⚠️ Failed to load source/stage/category/employee mapping:', error);
      }
      
      // Map legacy leads to match new leads format using joined data
      const mappedLegacyLeads = (legacyLeadsResult.data || []).map(legacyLead => {
        const sourceName = legacyLead.source_id ? 
          sourceMapping.get(legacyLead.source_id) || legacyLead.source_external_id || 'Unknown' :
          legacyLead.source_external_id || 'Unknown';
          
        const stageName = legacyLead.stage ? 
          stageMapping.get(legacyLead.stage) || legacyLead.stage.toString() :
          null;
          
        const categoryName = legacyLead.category_id ? 
          categoryMapping.get(legacyLead.category_id) || legacyLead.category || 'No Category' :
          legacyLead.category || 'No Category';

        // Map role IDs to employee names for legacy leads
        const getEmployeeName = (empId: number | null) => {
          if (!empId) return null;
          return idToNameMapping.get(empId) || null;
        };

        const roles = {
          scheduler: getEmployeeName(legacyLead.meeting_scheduler_id),
          manager: getEmployeeName(legacyLead.meeting_manager_id),
          lawyer: getEmployeeName(legacyLead.meeting_lawyer_id),
          expert: getEmployeeName(legacyLead.expert_id),
          closer: getEmployeeName(legacyLead.closer_id),
          case_handler: getEmployeeName(legacyLead.case_handler_id),
        };
          
        // Debug stage mapping for first lead
        if (legacyLead.id === legacyLeadsResult.data[0].id) {
          console.log('🔍 Stage mapping debug for lead:', legacyLead.id, {
            originalStage: legacyLead.stage,
            stageMappingHasKey: stageMapping.has(legacyLead.stage),
            mappedStageName: stageMapping.get(legacyLead.stage),
            finalStageName: stageName
          });
        }
          
        return {
          // Basic Info
          id: legacyLead.id,
          lead_number: legacyLead.lead_number || legacyLead.id.toString(),
          name: legacyLead.name,
          topic: legacyLead.topic,
          
          // Contact Info
          email: legacyLead.email,
          phone: legacyLead.phone,
          mobile: legacyLead.mobile,
          additional_contacts: legacyLead.additional_emails || legacyLead.additional_phones,
          
          // Status & Classification
          stage: stageName,
          source: sourceName,
          category: categoryName,
          language: (legacyLead.misc_language as any)?.name || null,
          status: legacyLead.status ? legacyLead.status.toString() : null,
          eligibility_status: legacyLead.eligibility_status,
          priority: legacyLead.priority,
          
          // Financial Information
          meeting_amount: legacyLead.meeting_total,
          meeting_currency: legacyLead.meeting_total_currency_id,
          proposal_total: legacyLead.proposal,
          proposal_currency: legacyLead.meeting_total_currency_id,
          balance: legacyLead.total_base,
          balance_currency: legacyLead.currency_id,
          potential_value: legacyLead.potential_total,
          total: legacyLead.total,
          first_payment: legacyLead.first_payment,
          meeting_total: legacyLead.meeting_total,
          meeting_total_currency: legacyLead.meeting_total_currency_id,
          vat: legacyLead.vat,
          vat_value: legacyLead.vat_value,
          bonus_paid: legacyLead.bonus_paid,
          subcontractor_fee: legacyLead.subcontractor_fee,
          // Currency fields for all amounts
          currency_id: legacyLead.currency_id,
          currency: legacyLead.currency_id,
          
          // Meeting Information
          meeting_date: legacyLead.meeting_date,
          meeting_time: legacyLead.meeting_time,
          meeting_datetime: legacyLead.meeting_datetime,
          meeting_location: legacyLead.meeting_location_old,
          meeting_url: legacyLead.meeting_url,
          teams_meeting_url: legacyLead.teams_meeting_url,
          meeting_brief: legacyLead.meeting_brief,
          meeting_payment_form: legacyLead.meeting_fop,
          meeting_paid: legacyLead.meeting_paid,
          meeting_confirmation: legacyLead.meeting_confirmation,
          meeting_scheduling_notes: legacyLead.meeting_scheduling_notes,
          meeting_complexity: legacyLead.meeting_complexity,
          meeting_probability: legacyLead.meeting_probability,
          meeting_car_no: legacyLead.meeting_car_no,
          
          // Applicants Information
          potential_applicants: legacyLead.potential_applicants,
          potential_applicants_meeting: legacyLead.potential_applicants,
          number_of_applicants_meeting: legacyLead.potential_applicants_meeting,
          no_of_applicants: legacyLead.no_of_applicants,
          
          // Timeline & Dates
          created_at: legacyLead.cdate || new Date().toISOString(),
          updated_at: legacyLead.udate,
          next_followup: legacyLead.next_followup,
          followup: legacyLead.followup_log,
          date_signed: legacyLead.date_signed,
          payment_due_date: legacyLead.payment_due_date,
          expiry_date: legacyLead.expiry_date,
          eligibility_date: legacyLead.eligibility_date,
          expert_eligibility_date: legacyLead.expert_eligibility_date,
          documents_uploaded_date: legacyLead.documents_uploaded_date,
          latest_interaction: legacyLead.latest_interaction,
          stage_changed_at: legacyLead.stage_changed_at,
          unactivated_at: legacyLead.unactivated_at,
          
          // Details & Notes
          facts: legacyLead.description,
          special_notes: legacyLead.special_notes,
          general_notes: legacyLead.notes,
          anchor: legacyLead.anchor_full_name,
          probability: legacyLead.probability,
          tags: legacyLead.tags,
          proposal_text: legacyLead.proposal_text,
          description: legacyLead.description,
          management_notes: legacyLead.management_notes,
          external_notes: legacyLead.external_notes,
          deactivate_notes: legacyLead.deactivate_notes,
          unactivation_reason: legacyLead.unactivation_reason,
          
          // Roles
          roles: roles,
          scheduler: roles.scheduler,
          manager: roles.manager,
          lawyer: roles.lawyer,
          expert: roles.expert,
          closer: roles.closer,
          case_handler: roles.case_handler,
          handler: roles.case_handler,
          helper: null, // Not available in legacy leads
          
          // Additional Info
          desired_location: legacyLead.desired_location,
          client_country: legacyLead.client_country,
          language_preference: legacyLead.language_preference,
          onedrive_folder_link: legacyLead.onedrive_folder_link,
          docs_url: legacyLead.docs_url,
          auto_email_meeting_summary: legacyLead.auto_email_meeting_summary,
          expert_eligibility_assessed: legacyLead.expert_eligibility_assessed,
          sales_roles_locked: legacyLead.sales_roles_locked,
          dependent: legacyLead.dependent,
          kind: legacyLead.kind,
          auto: legacyLead.auto,
          autocall: legacyLead.autocall,
          ball: legacyLead.ball,
          eligibile: legacyLead.eligibile,
        };
      });

      // Debug: Check what the mapped data looks like
      if (mappedLegacyLeads.length > 0) {
        console.log('🔍 Sample mapped legacy lead:', {
          id: mappedLegacyLeads[0].id,
          name: mappedLegacyLeads[0].name,
          language: mappedLegacyLeads[0].language,
          source: mappedLegacyLeads[0].source,
          stage: mappedLegacyLeads[0].stage,
          status: mappedLegacyLeads[0].status,
          meeting_amount: mappedLegacyLeads[0].meeting_amount,
          meeting_date: mappedLegacyLeads[0].meeting_date,
          potential_applicants: mappedLegacyLeads[0].potential_applicants,
          balance: mappedLegacyLeads[0].balance
        });
        console.log('🔍 All mapped legacy lead fields:', Object.keys(mappedLegacyLeads[0]));
      }

      console.log('📊 Final mapping results:', {
        newLeadsCount: mappedNewLeads.length,
        legacyLeadsCount: mappedLegacyLeads.length,
        newLeads: mappedNewLeads,
        legacyLeads: mappedLegacyLeads
      });

      // Combine results and sort by creation date
      const allResults = [
        ...mappedNewLeads,
        ...mappedLegacyLeads
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      console.log('🎯 Final combined results:', {
        totalCount: allResults.length,
        results: allResults
      });
      
      setResults(allResults);
    } catch (error) {
      console.error('Error searching leads:', error);
      alert('Failed to search for leads.');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const getStageBadge = (stage: string | null | undefined) => {
    if (!stage) return <span className="badge badge-outline">No Stage</span>;
    const stageText = stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    // Use custom purple color #3f28cd for all stage badges with proper text wrapping
    return <span 
      className="badge text-white hover:opacity-90 transition-opacity duration-200 text-xs px-3 py-1 max-w-full"
      style={{
        backgroundColor: '#3f28cd',
        borderColor: '#3f28cd',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'inline-block'
      }}
      title={stageText}
    >
      {stageText}
    </span>;
  };

  const renderResultCard = (lead: Lead) => (
    <div 
      key={lead.id} 
      className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group"
      onClick={() => navigate(`/clients/${lead.lead_number || lead.id}`)}
    >
      <div className="card-body p-5">
        <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
            <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
              {lead.name}
            </h2>
            </div>
            {getStageBadge(lead.stage)}
        </div>
        
        <p className="text-sm text-base-content/60 font-mono mb-4">#{lead.lead_number}</p>

        <div className="divider my-0"></div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
          <div className="flex items-center gap-2" title="Date Created">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="font-medium">{new Date(lead.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2" title="Category">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            <span>{lead.category || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Source">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span>{lead.source || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2" title="Language">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
            <span>{lead.language || 'N/A'}</span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-base-200/50">
          <p className="text-sm font-semibold text-base-content/80">{lead.topic || 'No topic specified'}</p>
        </div>

      </div>
    </div>
  );

  return (
    <div className="p-6 md:p-10">
      <h1 className="text-3xl font-bold mb-6">Leads Search</h1>

      {/* Search Form */}
      <div className="card bg-white shadow-lg p-6 mb-8">
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Date Range Row */}
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">From date</span></label>
            <input type="date" className="input input-bordered" onChange={e => handleFilterChange('fromDate', e.target.value)} />
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">To date</span></label>
            <input type="date" className="input input-bordered" onChange={e => handleFilterChange('toDate', e.target.value)} />
          </div>
          <MainCategoryInput
            label="Main Category"
            field="mainCategory"
            values={[]} // Main categories don't get stored in filters, they auto-select subcategories
            placeholder="Select main category to auto-select all subcategories..."
            options={filteredMainCategoryOptions}
            showDropdown={showMainCategoryDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
            onMainCategorySelect={handleMainCategorySelect}
          />
          <MultiSelectInput
            label="Category"
            field="category"
            values={filters.category}
            placeholder="Type category or choose from suggestions..."
            options={filteredCategoryOptions}
            showDropdown={showCategoryDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Reason"
            field="reason"
            values={filters.reason}
            placeholder="Type reason or choose from suggestions..."
            options={filteredReasonOptions}
            showDropdown={showReasonDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">File id</span></label>
            <input type="text" className="input input-bordered" onChange={e => handleFilterChange('fileId', e.target.value)} />
          </div>

          {/* Column 2 */}
          <MultiSelectInput
            label="Language"
            field="language"
            values={filters.language}
            placeholder="Type language or choose from suggestions..."
            options={filteredLanguageOptions}
            showDropdown={showLanguageDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Tags"
            field="tags"
            values={filters.tags}
            placeholder="Type tag or choose from suggestions..."
            options={filteredTagOptions}
            showDropdown={showTagDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />

          {/* Column 3 */}
          <MultiSelectInput
            label="Status"
            field="status"
            values={filters.status}
            placeholder="Type status or choose from suggestions..."
            options={filteredStatusOptions}
            showDropdown={showStatusDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Source"
            field="source"
            values={filters.source}
            placeholder="Type source or choose from suggestions..."
            options={filteredSourceOptions}
            showDropdown={showSourceDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label cursor-pointer justify-start gap-2 mb-2">
              <span className="label-text">Eligibility Determined only</span> 
              <input type="checkbox" className="checkbox checkbox-primary" onChange={e => handleFilterChange('eligibilityDeterminedOnly', e.target.checked)} />
            </label>
          </div>

          {/* Column 4 */}
          <MultiSelectInput
            label="Stage"
            field="stage"
            values={filters.stage}
            placeholder="Type stage or choose from suggestions..."
            options={filteredStageOptions}
            showDropdown={showStageDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Topic"
            field="topic"
            values={filters.topic}
            placeholder="Type topic or choose from suggestions..."
            options={filteredTopicOptions}
            showDropdown={showTopicDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Scheduler"
            field="scheduler"
            values={filters.scheduler}
            placeholder="Type scheduler name or choose from suggestions..."
            options={filteredRoleOptions}
            showDropdown={showSchedulerDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Manager"
            field="manager"
            values={filters.manager}
            placeholder="Type manager name or choose from suggestions..."
            options={filteredRoleOptions}
            showDropdown={showManagerDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Lawyer"
            field="lawyer"
            values={filters.lawyer}
            placeholder="Type lawyer name or choose from suggestions..."
            options={filteredRoleOptions}
            showDropdown={showLawyerDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Expert"
            field="expert"
            values={filters.expert}
            placeholder="Type expert name or choose from suggestions..."
            options={filteredRoleOptions}
            showDropdown={showExpertDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Closer"
            field="closer"
            values={filters.closer}
            placeholder="Type closer name or choose from suggestions..."
            options={filteredRoleOptions}
            showDropdown={showCloserDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <MultiSelectInput
            label="Case Handler"
            field="case_handler"
            values={filters.case_handler}
            placeholder="Type case handler name or choose from suggestions..."
            options={filteredRoleOptions}
            showDropdown={showCaseHandlerDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">Content</span></label>
            <input type="text" className="input input-bordered" onChange={e => handleFilterChange('content', e.target.value)} />
          </div>
          
          {/* View Mode Toggle */}
          <div className="col-span-2 flex items-end gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">View:</span>
              <div className="btn-group">
             <button 
                  className={`btn btn-sm ${viewMode === 'cards' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setViewMode('cards')}
                >
                  Cards
                </button>
                <button 
                  className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setViewMode('table')}
                >
                  Table
                </button>
              </div>
            </div>
          </div>

          {/* Column Selector for Table View */}
          {viewMode === 'table' && (
            <ColumnSelector
              selectedColumns={selectedColumns}
              onColumnsChange={setSelectedColumns}
              showDropdown={showColumnSelector}
              onShowDropdown={() => handleShowDropdown('columns')}
              onHideDropdown={() => handleHideDropdown('columns')}
            />
          )}

          {/* Search Buttons: span both columns on mobile */}
          <div className="col-span-2 flex items-end gap-3">
             <button 
              className="btn btn-primary flex-1" 
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          <h2 className="text-2xl font-bold mb-4">
            Found {results.length} lead{results.length !== 1 && 's'}
          </h2>
          {isSearching ? (
            <div className="flex justify-center p-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : results.length > 0 ? (
            viewMode === 'table' ? (
              <TableView leads={results} selectedColumns={selectedColumns} onLeadClick={handleLeadClick} />
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {results.map(renderResultCard)}
            </div>
            )
          ) : (
            <div className="text-center p-8 bg-base-200 rounded-lg">
              No leads found matching your criteria.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LeadSearchPage; 