import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Lead } from '../lib/supabase';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { getStageName, getStageColour, fetchStageNames } from '../lib/stageUtils';
import LeadDetailsModal from '../components/LeadDetailsModal';
import { usePersistedState, usePersistedFilters } from '../hooks/usePersistedState';

// Static dropdown options - moved outside component to prevent re-creation on every render
const REASON_OPTIONS = ["Inquiry", "Follow-up", "Complaint", "Consultation", "Other"];
const TAG_OPTIONS = ["VIP", "Urgent", "Family", "Business", "Other"];
const STATUS_OPTIONS = ["Active", "Not active"];
const EXPERT_EXAMINATION_OPTIONS = [
  "Not Feasible",
  "Feasible (further check)",
  "Feasible (no check)",
  "Not checked",
];

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
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Handle clicks outside the component to close dropdown
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onHideDropdown(field);
      }
    };

    if (showDropdown) {
      // Add event listener with a small delay to avoid immediate closing
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown, field, onHideDropdown]);

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
    // Don't close dropdown - let user select multiple items
    // Dropdown will close when clicking outside
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
    <div ref={containerRef} className="form-control flex flex-col col-span-2 sm:col-span-1 relative">
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
        />
        {showDropdown && filteredOptions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {filteredOptions.map((option, index) => (
              <div
                key={index}
                className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                onMouseDown={(e) => {
                  // Prevent blur event from firing
                  e.preventDefault();
                  handleSelect(option);
                }}
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
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Handle clicks outside the component to close dropdown
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onHideDropdown(field);
      }
    };

    if (showDropdown) {
      // Add event listener with a small delay to avoid immediate closing
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown, field, onHideDropdown]);

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
    // Don't close dropdown - let user select multiple items
    // Dropdown will close when clicking outside
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
    <div ref={containerRef} className="form-control flex flex-col col-span-2 sm:col-span-1 relative">
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
        />
        {showDropdown && filteredOptions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {filteredOptions.map((option, index) => (
              <div
                key={index}
                className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                onMouseDown={(e) => {
                  // Prevent blur event from firing
                  e.preventDefault();
                  handleSelect(option);
                }}
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

// Helper function to calculate contrasting text color based on background
const getContrastingTextColor = (hexColor?: string | null) => {
  if (!hexColor) return '#111827';
  let sanitized = hexColor.trim();
  if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
  if (sanitized.length === 3) {
    sanitized = sanitized.split('').map(char => char + char).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
    return '#111827';
  }
  const r = parseInt(sanitized.slice(0, 2), 16) / 255;
  const g = parseInt(sanitized.slice(2, 4), 16) / 255;
  const b = parseInt(sanitized.slice(4, 6), 16) / 255;

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? '#111827' : '#ffffff';
};

// Table View Component
const TableView = ({ leads, selectedColumns, onLeadClick }: { leads: Lead[], selectedColumns: string[], onLeadClick: (lead: Lead | string, event?: React.MouseEvent) => void }) => {
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

  const getColumnValue = (lead: Lead, columnKey: string): string | React.ReactElement => {
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
    
    // Special handling for stage to show colored badge
    if (columnKey === 'stage') {
      const stage = leadWithData.stage;
      if (!stage && stage !== 0) return 'No Stage';
      
      // Convert stage to string for getStageName/getStageColour (handles both numeric IDs and stage names)
      const stageStr = String(stage);
      
      const stageName = getStageName(stageStr);
      const stageColour = getStageColour(stageStr);
      const badgeTextColour = getContrastingTextColor(stageColour);
      const backgroundColor = stageColour || '#3f28cd';
      const textColor = stageColour ? badgeTextColour : '#ffffff';
      
      return (
        <span 
          className="badge text-xs px-2 py-1"
          style={{
            backgroundColor: backgroundColor,
            borderColor: backgroundColor,
            color: textColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'inline-block'
          }}
          title={stageName}
        >
          {stageName}
        </span>
      );
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
      <table className="table w-full">
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
              onClick={(e) => {
                // Pass the full lead object so we can access manual_id and other properties
                onLeadClick(lead, e);
              }}
              title={`Click to view lead ${(lead as any).display_lead_number || (lead as any).lead_number || lead.id}`}
            >
              {selectedColumns.map((columnKey) => {
                const columnValue = getColumnValue(lead, columnKey);
                const titleText = typeof columnValue === 'string' ? columnValue : (columnValue?.props?.title || '');
                return (
                  <td key={columnKey} className="max-w-xs">
                    <div className="truncate" title={titleText}>
                      {columnValue}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ExternalUserLeadSearchPage: React.FC = () => {
  // Initialize filters with current date
  const todayStr = new Date().toISOString().split('T')[0];
  
  const [filters, setFilters] = usePersistedFilters('externalUserLeadSearch_filters', {
    fromDate: todayStr, // Default to today
    toDate: todayStr, // Default to today
    category: [] as string[],
    language: [] as string[],
    status: [] as string[],
    source: [] as string[],
    eligibilityDeterminedOnly: false,
    stage: [] as string[],
    topic: [] as string[],
  }, {
    storage: 'sessionStorage',
  });
  const [results, setResults] = usePersistedState<Lead[]>('externalUserLeadSearch_results', [], {
    storage: 'sessionStorage',
  });
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedState('externalUserLeadSearch_performed', false, {
    storage: 'sessionStorage',
  });
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [mainCategoryOptions, setMainCategoryOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [topicOptions, setTopicOptions] = useState<string[]>([]);
  const [allowedSourceIds, setAllowedSourceIds] = useState<number[]>([]);
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
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [filteredStatusOptions, setFilteredStatusOptions] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedColumns] = useState<string[]>(['name', 'lead_number', 'email', 'phone', 'stage', 'source', 'created_at']);
  const navigate = useNavigate();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Handle lead click - open modal instead of navigating (for external users)
  const handleLeadClick = (lead: Lead | string, event?: React.MouseEvent) => {
    // Handle both string (legacy) and Lead object (new)
    let leadObj: Lead;
    
    if (typeof lead === 'string') {
      // Legacy: create a minimal lead object from string
      leadObj = {
        id: lead,
        lead_number: lead,
        name: '',
        created_at: new Date().toISOString(),
      } as Lead;
    } else {
      // New: use the full lead object
      leadObj = lead;
    }
    
    // If Cmd/Ctrl is pressed, open in new tab (original behavior)
    if (event && (event.metaKey || event.ctrlKey)) {
      const anyLead = leadObj as any;
      const leadNumber = anyLead.display_lead_number || anyLead.lead_number || leadObj.id?.toString() || '';
      const manualId = anyLead.manual_id || null;
      const leadType = anyLead.lead_type;
      
      if (!leadNumber) return;
      
      const isSubLead = leadNumber.includes('/');
      let path = '';
      
      if (isSubLead && manualId) {
        path = `/clients/${encodeURIComponent(manualId)}?lead=${encodeURIComponent(leadNumber)}`;
      } else if (isSubLead && !manualId && leadType === 'new') {
        const baseNumber = leadNumber.split('/')[0];
        path = `/clients/${encodeURIComponent(baseNumber)}?lead=${encodeURIComponent(leadNumber)}`;
      } else {
        const identifier = manualId || leadNumber;
        path = `/clients/${encodeURIComponent(identifier)}`;
      }
      
      window.open(path, '_blank');
      return;
    }
    
    // Otherwise, open modal
    setSelectedLead(leadObj);
    setIsModalOpen(true);
  };


  // Initialize stage names cache on mount
  useEffect(() => {
    fetchStageNames().catch(error => {
      console.error('Error initializing stage names:', error);
    });
  }, []);

  // Fetch stage options from lead_stages table, ordered by ID (lowest to highest)
  useEffect(() => {
    const fetchStageOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('lead_stages')
          .select('id, name')
          .order('id', { ascending: true }); // Order by ID, lowest to highest
        
        if (error) throw error;
        
        // Extract names in the order they were fetched (sorted by ID)
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

  // Fetch current user's extern_source_id and get allowed source IDs
  useEffect(() => {
    const fetchUserSourceIds = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
          console.error('Error getting auth user:', authError);
          return;
        }

        // Fetch user data with extern_source_id
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id, extern_source_id')
          .eq('auth_id', user.id)
          .maybeSingle();

        // If not found by auth_id, try by email
        let finalUserData = userData;
        if ((userError || !userData) && user.email) {
          const { data: userByEmail } = await supabase
            .from('users')
            .select('id, extern_source_id')
            .eq('email', user.email)
            .maybeSingle();
          
          if (userByEmail) {
            finalUserData = userByEmail;
          }
        }

        if (finalUserData?.extern_source_id) {
          // extern_source_id is a JSONB array of source IDs
          let sourceIds: number[] = [];
          
          if (Array.isArray(finalUserData.extern_source_id)) {
            sourceIds = finalUserData.extern_source_id.filter(id => typeof id === 'number');
          } else if (typeof finalUserData.extern_source_id === 'string') {
            // Try to parse if it's a JSON string
            try {
              const parsed = JSON.parse(finalUserData.extern_source_id);
              if (Array.isArray(parsed)) {
                sourceIds = parsed.filter(id => typeof id === 'number');
              }
            } catch (e) {
              console.error('Error parsing extern_source_id:', e);
            }
          }

          setAllowedSourceIds(sourceIds);
          console.log('✅ Loaded allowed source IDs for user:', sourceIds);

          // Fetch source names for display
          if (sourceIds.length > 0) {
            const { data: sourcesData, error: sourcesError } = await supabase
              .from('misc_leadsource')
              .select('id, name')
              .in('id', sourceIds)
              .eq('active', true)
              .order('name');
            
            if (!sourcesError && sourcesData) {
              const sourceNames = sourcesData.map(s => s.name);
              setSourceOptions(sourceNames);
              setFilteredSourceOptions(sourceNames);
              console.log('✅ Fetched source names for allowed sources:', sourceNames);
            } else {
              console.error('Error fetching source names:', sourcesError);
              setSourceOptions([]);
              setFilteredSourceOptions([]);
            }
          } else {
            setSourceOptions([]);
            setFilteredSourceOptions([]);
          }
        } else {
          console.log('⚠️ No extern_source_id found for user, no source filtering will be applied');
          setAllowedSourceIds([]);
          setSourceOptions([]);
          setFilteredSourceOptions([]);
        }
      } catch (error) {
        console.error('Error fetching user source IDs:', error);
        setAllowedSourceIds([]);
        setSourceOptions([]);
        setFilteredSourceOptions([]);
      }
    };

    fetchUserSourceIds();
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
        // Add "N/A" option to filter for leads with null language_id and language
        setLanguageOptions([...languages, 'N/A']);
      } catch (error) {
        console.error('Error fetching language options:', error);
        // Fallback to hardcoded options if database fetch fails
        // Add "N/A" option to filter for leads with null language_id and language
        setLanguageOptions([
          "English", "Hebrew", "German", "French", "Russian", "Other", "N/A"
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
    setFilteredStageOptions(stageOptions);
  }, [stageOptions]);

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

  const handleFilterChange = (field: string, value: any) => {
    // For multi-select fields, don't update the filter directly - 
    // the MultiSelectInput component handles its own input state
    const multiSelectFields = [
      'category',
      'language',
      'status',
      'source',
      'stage',
      'topic',
    ];
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
    console.log('🔍 [Main Category] Starting main category selection:', mainCategoryName);
    try {
      // First, get the main category ID
      const { data: mainCategory, error: mainError } = await supabase
        .from('misc_maincategory')
        .select('id')
        .eq('name', mainCategoryName)
        .single();

      console.log('🔍 [Main Category] Main category lookup result:', {
        mainCategoryName,
        mainCategory,
        mainError,
        mainCategoryId: mainCategory?.id
      });

      if (mainError || !mainCategory) {
        console.error('❌ [Main Category] Error finding main category:', mainError);
        return;
      }

      // Then get all subcategories for this main category
      const { data: subcategories, error: subError } = await supabase
        .from('misc_category')
        .select('name, misc_maincategory!parent_id(name)')
        .eq('parent_id', mainCategory.id);

      console.log('🔍 [Main Category] Subcategories fetch result:', {
        mainCategoryId: mainCategory.id,
        subcategoriesCount: subcategories?.length || 0,
        subcategories: subcategories,
        subError
      });

      if (subError) {
        console.error('❌ [Main Category] Error fetching subcategories:', subError);
        return;
      }

      if (subcategories) {
        // Format subcategories as "Subcategory (Main Category)" to match existing format
        const formattedSubcategories = subcategories.map(sub => 
          `${sub.name} (${mainCategoryName})`
        );

        console.log('🔍 [Main Category] Formatted subcategories:', formattedSubcategories);

        // Add all subcategories to the current category selection
        setFilters(prev => {
          const currentCategories = prev.category || [];
          const newCategories = [...currentCategories, ...formattedSubcategories];
          // Remove duplicates
          const uniqueCategories = [...new Set(newCategories)];
          
          console.log('🔍 [Main Category] Updating category filter:', {
            previousCategories: currentCategories,
            newCategories: formattedSubcategories,
            finalCategories: uniqueCategories
          });
          
          return {
            ...prev,
            category: uniqueCategories
          };
        });

        console.log(`✅ [Main Category] Auto-selected ${formattedSubcategories.length} subcategories for main category: ${mainCategoryName}`);
      }
    } catch (error) {
      console.error('❌ [Main Category] Error handling main category selection:', error);
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
      case 'status': setShowStatusDropdown(true); break;
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
      case 'status': setShowStatusDropdown(false); break;
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
    console.log('📅 Current date info:', {
      currentDate: new Date().toISOString().split('T')[0],
      currentDateTime: new Date().toISOString(),
      filterFromDate: filters.fromDate,
      filterToDate: filters.toDate,
      fromDateMatch: filters.fromDate === new Date().toISOString().split('T')[0],
      toDateMatch: filters.toDate === new Date().toISOString().split('T')[0]
    });
    
    // Create employee mappings for role filters
    const nameToIdMapping = new Map<string, number>();
    const idToNameMapping = new Map<number, string>();
    
    // Fetch categories and create reverse mapping (formatted name -> category_id) for filtering
    // This avoids using ilike/eq queries during filtering - we use the mapping directly
    const categoryNameToIdMapping = new Map<string, number>();
    try {
      console.log('🔍 [Category Mapping] Fetching categories for mapping...');
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('misc_category')
        .select('id, name, parent_id, misc_maincategory!parent_id(id, name)')
        .order('name');
      
      console.log('🔍 [Category Mapping] Categories fetch result:', {
        categoriesCount: categoriesData?.length || 0,
        categoriesError,
        sampleCategories: categoriesData?.slice(0, 5)
      });
      
      if (categoriesData) {
        categoriesData.forEach((category: any) => {
          const mainRel = category.misc_maincategory;
          const mainCategory = Array.isArray(mainRel)
            ? mainRel[0]?.name
            : mainRel?.name;
          const formattedName = mainCategory
            ? `${category.name} (${mainCategory})`
            : category.name;
          categoryNameToIdMapping.set(formattedName, category.id);
          
          // Debug log for first few categories
          if (categoryNameToIdMapping.size <= 5) {
            console.log('🔍 [Category Mapping] Added mapping:', {
              formattedName,
              categoryId: category.id,
              categoryName: category.name,
              mainCategory
            });
          }
        });
        console.log('✅ [Category Mapping] Created category name to ID mapping:', {
          totalMappings: categoryNameToIdMapping.size,
          sampleMappings: Array.from(categoryNameToIdMapping.entries()).slice(0, 10)
        });
      }
    } catch (error) {
      console.error('❌ [Category Mapping] Error fetching categories for mapping:', error);
    }
    
    try {
      // Helper to build UTC range for a given local date string (YYYY-MM-DD)
      const buildUtcStartOfDay = (dateStr: string) => {
        const [year, month, day] = dateStr.split('-').map(Number);
        const local = new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
        return local.toISOString();
      };
      const buildUtcEndOfDay = (dateStr: string) => {
        const [year, month, day] = dateStr.split('-').map(Number);
        const local = new Date(year, (month || 1) - 1, day || 1, 23, 59, 59, 999);
        return local.toISOString();
      };
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
            cdate: lead.cdate,
            cdate_date: lead.cdate ? new Date(lead.cdate).toISOString().split('T')[0] : null
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
          data: noFiltersTest.data,
          sampleCreatedAt: noFiltersTest.data?.map(lead => ({
            id: lead.id,
            name: lead.name,
            created_at: lead.created_at,
            created_at_date: new Date(lead.created_at).toISOString().split('T')[0]
          }))
        });
      } catch (testError) {
        console.error('❌ New leads no filters test failed:', testError);
      }
      
      // Test 2: Only date filters
      if (filters.fromDate || filters.toDate) {
        try {
          let dateOnlyQuery = newLeadsQuery;
          if (filters.fromDate) {
            console.log('📅 Testing fromDate filter only (UTC range):', filters.fromDate);
            dateOnlyQuery = dateOnlyQuery.gte('created_at', buildUtcStartOfDay(filters.fromDate));
          }
          if (filters.toDate) {
            console.log('📅 Testing toDate filter only (UTC range):', filters.toDate);
            const endOfDay = buildUtcEndOfDay(filters.toDate);
            console.log('📅 Using end of day (UTC) for toDate:', endOfDay);
            dateOnlyQuery = dateOnlyQuery.lte('created_at', endOfDay);
          }
          const dateOnlyTest = await dateOnlyQuery.limit(5);
          console.log('✅ New leads with date filters only:', {
            count: dateOnlyTest.data?.length || 0,
            data: dateOnlyTest.data,
            sampleCreatedAt: dateOnlyTest.data?.map(lead => ({
              id: lead.id,
              name: lead.name,
              created_at: lead.created_at,
              created_at_date: new Date(lead.created_at).toISOString().split('T')[0]
            }))
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
        console.log('📅 Adding fromDate filter for new leads (UTC range):', filters.fromDate);
        newLeadsQuery = newLeadsQuery.gte('created_at', buildUtcStartOfDay(filters.fromDate));
      }
      if (filters.toDate) {
        console.log('📅 Adding toDate filter for new leads (UTC range):', filters.toDate);
        const endOfDay = buildUtcEndOfDay(filters.toDate);
        console.log('📅 Using end of day (UTC) for toDate:', endOfDay);
        newLeadsQuery = newLeadsQuery.lte('created_at', endOfDay);
      }
      if (filters.category && filters.category.length > 0) {
        console.log('🏷️ [New Leads Category Filter] Starting category filter application:', {
          selectedCategories: filters.category,
          categoryCount: filters.category.length,
          mappingSize: categoryNameToIdMapping.size
        });
        
        // Try using category_id first (more reliable), fallback to category text field
        const categoryIds: number[] = [];
        const categoryNames: string[] = [];
        
        for (const formattedCategoryName of filters.category) {
          // Try to get category_id from mapping
          const categoryId = categoryNameToIdMapping.get(formattedCategoryName);
          if (categoryId !== undefined) {
            categoryIds.push(categoryId);
            console.log('🔍 [New Leads Category Filter] Found category_id:', categoryId, 'for category:', formattedCategoryName);
          } else {
            // Fallback: extract category name (remove main category in parentheses)
            const categoryName = formattedCategoryName.split(' (')[0].trim();
            categoryNames.push(categoryName);
            console.log('⚠️ [New Leads Category Filter] No category_id found, will use category name:', categoryName, 'for:', formattedCategoryName);
          }
        }
        
        console.log('🏷️ [New Leads Category Filter] Category filter summary:', {
          totalSelected: filters.category.length,
          categoryIdsFound: categoryIds,
          categoryIdsCount: categoryIds.length,
          categoryNamesFallback: categoryNames,
          categoryNamesCount: categoryNames.length
        });
        
        // Prefer category_id filter if we have IDs, otherwise use category text field
        // If we have both IDs and names, use OR to include both
        if (categoryIds.length > 0 && categoryNames.length > 0) {
          // Mixed: some categories have IDs, some don't - use OR condition
          console.log('🏷️ [New Leads Category Filter] Applying mixed filter (OR): category_id IN', categoryIds, 'OR category IN', categoryNames);
          const orConditions = [
            categoryIds.length === 1 
              ? `category_id.eq.${categoryIds[0]}`
              : `category_id.in.(${categoryIds.join(',')})`,
            categoryNames.length === 1 
              ? `category.eq.${categoryNames[0]}`
              : `category.in.(${categoryNames.join(',')})`
          ];
          newLeadsQuery = newLeadsQuery.or(orConditions.join(','));
        } else if (categoryIds.length > 0) {
          // All categories have IDs - use category_id filter
          if (categoryIds.length === 1) {
            console.log('🏷️ [New Leads Category Filter] Applying single category_id filter:', categoryIds[0]);
            newLeadsQuery = newLeadsQuery.eq('category_id', categoryIds[0]);
          } else {
            console.log('🏷️ [New Leads Category Filter] Applying multiple category_id filter (IN):', categoryIds);
            newLeadsQuery = newLeadsQuery.in('category_id', categoryIds);
          }
        } else if (categoryNames.length > 0) {
          // Only category names available, use text field
          if (categoryNames.length === 1) {
            console.log('🏷️ [New Leads Category Filter] Applying single category name filter (fallback):', categoryNames[0]);
            newLeadsQuery = newLeadsQuery.eq('category', categoryNames[0]);
          } else {
            console.log('🏷️ [New Leads Category Filter] Applying multiple category name filter (IN, fallback):', categoryNames);
            newLeadsQuery = newLeadsQuery.in('category', categoryNames);
          }
        } else {
          console.log('❌ [New Leads Category Filter] No category IDs or names found - filter will not be applied');
        }
        
        console.log('🏷️ [New Leads Category Filter] Category filter applied to query');
      } else {
        console.log('🏷️ [New Leads Category Filter] No category filter - filters.category is empty or null');
      }
      if (filters.language && filters.language.length > 0) {
        console.log('🌐 Adding language filter for new leads:', filters.language);
        
        // Check if filtering for N/A
        const hasNAFilter = filters.language.some(lang => 
          lang.toUpperCase() === 'N/A' || lang === 'N/A'
        );
        const nonNALanguages = filters.language.filter(lang => 
          lang.toUpperCase() !== 'N/A' && lang !== 'N/A'
        );
        
        if (hasNAFilter && nonNALanguages.length === 0) {
          // Only filtering for N/A - find leads where language_id is null AND language is null/empty/N/A
          console.log('🌐 Filtering for N/A language (null language_id AND null/empty/N/A language)');
          // Use chained filters: language_id must be null (this creates an AND condition with subsequent filters)
          // Then we'll check language field - but we need to ensure BOTH conditions are met
          // Since Supabase PostgREST doesn't support complex nested AND/OR easily,
          // we'll filter by language_id first, then handle language null/empty/N/A in the query
          // The safest approach: filter by language_id null first (main indicator)
          newLeadsQuery = newLeadsQuery.is('language_id', null);
          // Then also check that language is null or empty or "N/A"
          // We can't use .or() after .is() easily, so we'll filter by language_id null first
          // and accept that this is the primary check. Leads with language_id null but language set
          // are edge cases that shouldn't exist in normal data.
          // For strict matching, we'd need to filter client-side or use a custom query
        } else if (hasNAFilter && nonNALanguages.length > 0) {
          // Filtering for both N/A and specific languages
          console.log('🌐 Filtering for both N/A and specific languages:', nonNALanguages);
          
          // Map language codes to full names for matching
          const languageCodeToFullName: Record<string, string> = {
            'EN': 'English',
            'ENGLISH': 'English',
            'HE': 'Hebrew',
            'HEBREW': 'Hebrew',
            'DE': 'German',
            'GERMAN': 'German',
            'FR': 'French',
            'FRENCH': 'French',
            'ES': 'Spanish',
            'SPANISH': 'Spanish',
            'RU': 'Russian',
            'RUSSIAN': 'Russian',
            'AR': 'Arabic',
            'ARABIC': 'Arabic',
            'PT': 'Portuguese',
            'POR': 'Portuguese',
            'PORTUGUESE': 'Portuguese',
          };
          
          // Expand filter array to include both codes and full names for non-N/A languages
          const expandedLanguageFilter = new Set<string>();
          nonNALanguages.forEach(lang => {
            const upperLang = lang.toUpperCase();
            expandedLanguageFilter.add(lang); // Add original value (case-sensitive match)
            expandedLanguageFilter.add(upperLang); // Add uppercase version
            
            // If it's a code, also add the full name
            if (languageCodeToFullName[upperLang]) {
              expandedLanguageFilter.add(languageCodeToFullName[upperLang]);
            }
            
            // If it's already a full name, also try to find if it maps to a code
            Object.entries(languageCodeToFullName).forEach(([code, fullName]) => {
              if (fullName.toLowerCase() === lang.toLowerCase()) {
                expandedLanguageFilter.add(code);
                expandedLanguageFilter.add(fullName);
              }
            });
          });
          
          const expandedFilterArray = Array.from(expandedLanguageFilter);
          
          // OR condition: (language_id is null OR language is null/N/A) OR language in expanded array
          // Build OR condition string
          const orConditions = [
            'language_id.is.null',
            'language.is.null',
            'language.eq.N/A'
          ];
          
          // Add language matches
          expandedFilterArray.forEach(lang => {
            orConditions.push(`language.eq.${lang}`);
          });
          
          newLeadsQuery = newLeadsQuery.or(orConditions.join(','));
          
          console.log('🌐 Mixed language filter (N/A + specific languages):', {
            original: filters.language,
            expanded: expandedFilterArray,
            orConditions
          });
        } else {
          // Only filtering for specific languages (not N/A) - exclude N/A/null values
          // Map language codes to full names for matching
          const languageCodeToFullName: Record<string, string> = {
            'EN': 'English',
            'ENGLISH': 'English',
            'HE': 'Hebrew',
            'HEBREW': 'Hebrew',
            'DE': 'German',
            'GERMAN': 'German',
            'FR': 'French',
            'FRENCH': 'French',
            'ES': 'Spanish',
            'SPANISH': 'Spanish',
            'RU': 'Russian',
            'RUSSIAN': 'Russian',
            'AR': 'Arabic',
            'ARABIC': 'Arabic',
            'PT': 'Portuguese',
            'POR': 'Portuguese',
            'PORTUGUESE': 'Portuguese',
          };
          
          // Expand filter array to include both codes and full names
          const expandedLanguageFilter = new Set<string>();
          nonNALanguages.forEach(lang => {
            const upperLang = lang.toUpperCase();
            expandedLanguageFilter.add(lang); // Add original value (case-sensitive match)
            expandedLanguageFilter.add(upperLang); // Add uppercase version
            
            // If it's a code, also add the full name
            if (languageCodeToFullName[upperLang]) {
              expandedLanguageFilter.add(languageCodeToFullName[upperLang]);
            }
            
            // If it's already a full name, also try to find if it maps to a code
            Object.entries(languageCodeToFullName).forEach(([code, fullName]) => {
              if (fullName.toLowerCase() === lang.toLowerCase()) {
                expandedLanguageFilter.add(code);
                expandedLanguageFilter.add(fullName);
              }
            });
          });
          
          const expandedFilterArray = Array.from(expandedLanguageFilter);
          console.log('🌐 Expanded language filter (excluding N/A):', {
            original: filters.language,
            expanded: expandedFilterArray
          });
          
          // Use in() to match specific languages
          // Exclude null/empty/N/A language values to prevent matching leads with N/A language
          // Note: We don't check language_id because some leads might only have language text
          newLeadsQuery = newLeadsQuery
            .in('language', expandedFilterArray)
            .not('language', 'is', null)
            .neq('language', '')
            .neq('language', 'N/A');
        }
      }
      if (filters.status && filters.status.length > 0) {
        console.log('📊 Adding status filter for new leads (Active/Not active):', filters.status);
        const includeActive = filters.status.includes('Active');
        const includeInactive = filters.status.includes('Not active');

        // If both are selected, don't filter by status at all
        if (includeActive && !includeInactive) {
          // Active: unactivated_at IS NULL
          newLeadsQuery = newLeadsQuery.is('unactivated_at', null);
        } else if (!includeActive && includeInactive) {
          // Not active: unactivated_at IS NOT NULL
          newLeadsQuery = newLeadsQuery.not('unactivated_at', 'is', null);
        }
      }
      if (filters.stage && filters.stage.length > 0) {
        console.log('🎯 Adding stage filter for new leads:', filters.stage);
        try {
          // Look up all selected stages to get their stage_ids
          const stageIds: number[] = [];
          for (const stage of filters.stage) {
            const trimmedStage = stage.trim();
            console.log('🔍 Looking up stage:', trimmedStage);
            
            // Special case: "Created" should map to stage ID 0
            if (trimmedStage.toLowerCase() === 'created') {
              stageIds.push(0);
              console.log('✅ Using stage_id 0 for "Created"');
              continue;
            }
            
            // Try exact match first (case-insensitive)
            let stageLookup = await supabase
              .from('lead_stages')
              .select('id')
              .ilike('name', trimmedStage)
              .limit(1);
            
            // If no exact match, try with wildcards
            if (!stageLookup.data || stageLookup.data.length === 0) {
              stageLookup = await supabase
                .from('lead_stages')
                .select('id')
                .ilike('name', `%${trimmedStage}%`)
                .limit(1);
            }
            
            if (stageLookup.data && stageLookup.data.length > 0) {
              const stageId = stageLookup.data[0].id;
              // Ensure stageId is a number
              const numericStageId = typeof stageId === 'number' ? stageId : parseInt(String(stageId), 10);
              if (!isNaN(numericStageId)) {
                stageIds.push(numericStageId);
                console.log('✅ Found stage_id:', numericStageId, 'for stage:', trimmedStage);
              } else {
                console.log('⚠️ Stage ID is not numeric:', stageId, 'for stage:', trimmedStage);
              }
            } else {
              console.log('❌ No stage found for:', trimmedStage);
            }
          }
          
          if (stageIds.length > 0) {
            console.log('✅ Applying stage filter with IDs:', stageIds);
            // Use IN operator for multiple stage_ids
            newLeadsQuery = newLeadsQuery.in('stage', stageIds);
          } else {
            console.log('❌ No stage_ids found for any stages in new leads filter');
          }
        } catch (error) {
          console.error('⚠️ Stage lookup failed for new leads, skipping stage filter:', error);
        }
      }
      // Filter by allowed source IDs from extern_source_id, and optionally by selected sources
      if (allowedSourceIds.length > 0) {
        // Get source names for the allowed IDs
        const { data: allowedSources, error: sourcesError } = await supabase
          .from('misc_leadsource')
          .select('id, name')
          .in('id', allowedSourceIds)
          .eq('active', true);
        
        if (!sourcesError && allowedSources && allowedSources.length > 0) {
          const allowedSourceNames = allowedSources.map(s => s.name);
          
          // If user has selected specific sources, filter by those; otherwise use all allowed sources
          const sourcesToFilter = filters.source && filters.source.length > 0 
            ? filters.source.filter(s => allowedSourceNames.includes(s))
            : allowedSourceNames;
          
          if (sourcesToFilter.length > 0) {
            console.log('📡 Filtering new leads by sources:', sourcesToFilter);
            if (sourcesToFilter.length === 1) {
              newLeadsQuery = newLeadsQuery.eq('source', sourcesToFilter[0]);
            } else {
              newLeadsQuery = newLeadsQuery.in('source', sourcesToFilter);
            }
          } else {
            console.log('⚠️ No valid sources to filter by, filtering out all new leads');
            newLeadsQuery = newLeadsQuery.eq('source', '__nonexistent__');
          }
        } else {
          console.log('⚠️ No active sources found for allowed source IDs, filtering out all new leads');
          newLeadsQuery = newLeadsQuery.eq('source', '__nonexistent__');
        }
      } else {
        console.log('⚠️ No allowed source IDs found, filtering out all new leads');
        newLeadsQuery = newLeadsQuery.eq('source', '__nonexistent__');
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
      // Helper function to apply role filter for new leads (handles both display names and IDs)
      const applyRoleFilterForNewLeads = (
        roleName: string,
        filterValues: string[],
        textField: string | null,
        idField: string | null
      ) => {
        if (!filterValues || filterValues.length === 0) return;
        
        console.log(`👥 [New Leads ${roleName} Filter] Starting filter application:`, {
          roleName,
          filterValues,
          textField,
          idField,
          employeeMappingSize: nameToIdMapping.size
        });
        
        // Convert filter values (display names) to employee IDs
        const employeeIds: number[] = [];
        const unmatchedNames: string[] = [];
        
        for (const filterValue of filterValues) {
          // Check if filterValue is already a numeric ID
          const numericId = parseInt(filterValue, 10);
          if (!isNaN(numericId)) {
            employeeIds.push(numericId);
            console.log(`🔍 [New Leads ${roleName} Filter] Filter value is numeric ID:`, numericId);
          } else {
            // It's a display name, look it up in the mapping
            const employeeId = nameToIdMapping.get(filterValue);
            if (employeeId !== undefined) {
              employeeIds.push(employeeId);
              console.log(`🔍 [New Leads ${roleName} Filter] Found employee ID:`, employeeId, 'for name:', filterValue);
            } else {
              unmatchedNames.push(filterValue);
              console.log(`⚠️ [New Leads ${roleName} Filter] No employee ID found for name:`, filterValue);
            }
          }
        }
        
        console.log(`👥 [New Leads ${roleName} Filter] Filter summary:`, {
          totalFilterValues: filterValues.length,
          employeeIdsFound: employeeIds,
          employeeIdsCount: employeeIds.length,
          unmatchedNames,
          unmatchedNamesCount: unmatchedNames.length
        });
        
        // Build OR condition if we have both text field and ID field
        const orConditions: string[] = [];
        
        // Add ID-based filter if we have IDs and an ID field
        if (employeeIds.length > 0 && idField) {
          if (employeeIds.length === 1) {
            orConditions.push(`${idField}.eq.${employeeIds[0]}`);
          } else {
            orConditions.push(`${idField}.in.(${employeeIds.join(',')})`);
          }
        }
        
        // Add text-based filter if we have unmatched names and a text field
        if (unmatchedNames.length > 0 && textField) {
          if (unmatchedNames.length === 1) {
            orConditions.push(`${textField}.eq.${unmatchedNames[0]}`);
          } else {
            orConditions.push(`${textField}.in.(${unmatchedNames.join(',')})`);
          }
        }
        
        // Also add text field filter for all filter values (in case some leads have names stored)
        if (textField && filterValues.length > 0) {
          if (filterValues.length === 1) {
            orConditions.push(`${textField}.eq.${filterValues[0]}`);
          } else {
            orConditions.push(`${textField}.in.(${filterValues.join(',')})`);
          }
        }
        
        if (orConditions.length > 0) {
          if (orConditions.length === 1) {
            // Single condition, apply directly
            const condition = orConditions[0];
            if (condition.includes('.eq.')) {
              const [field, value] = condition.split('.eq.');
              newLeadsQuery = newLeadsQuery.eq(field, value);
            } else if (condition.includes('.in.')) {
              const [field, values] = condition.split('.in.');
              const valueArray = values.replace(/[()]/g, '').split(',');
              newLeadsQuery = newLeadsQuery.in(field, valueArray);
            }
            console.log(`👥 [New Leads ${roleName} Filter] Applied single condition:`, condition);
          } else {
            // Multiple conditions, use OR
            const orString = orConditions.join(',');
            newLeadsQuery = newLeadsQuery.or(orString);
            console.log(`👥 [New Leads ${roleName} Filter] Applied OR condition:`, orString);
          }
        } else {
          console.log(`❌ [New Leads ${roleName} Filter] No valid conditions to apply - filter will not work`);
        }
      };
      
      if (filters.eligibilityDeterminedOnly) {
        console.log('✅ Adding eligibility filter for new leads');
        newLeadsQuery = newLeadsQuery.eq('eligible', true);
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
      // Use date strings directly - cdate column handles date comparisons correctly
      if (filters.fromDate) {
        console.log('📅 Adding fromDate filter for legacy leads:', filters.fromDate);
        legacyLeadsQuery = legacyLeadsQuery.gte('cdate', filters.fromDate);
      }
      if (filters.toDate) {
        console.log('📅 Adding toDate filter for legacy leads:', filters.toDate);
        // Append time to include the entire day
        const endOfDay = `${filters.toDate}T23:59:59`;
        legacyLeadsQuery = legacyLeadsQuery.lte('cdate', endOfDay);
      }
      if (filters.category && filters.category.length > 0) {
        console.log('🏷️ [Legacy Leads Category Filter] Starting category filter application:', {
          selectedCategories: filters.category,
          categoryCount: filters.category.length,
          mappingSize: categoryNameToIdMapping.size
        });
        
        // Use the category name to ID mapping we created earlier (no database queries needed)
        const categoryIds: number[] = [];
        const lookupResults: Array<{ formattedName: string; categoryId: number | undefined; found: boolean }> = [];
        
        for (const formattedCategoryName of filters.category) {
          const categoryId = categoryNameToIdMapping.get(formattedCategoryName);
          const found = categoryId !== undefined;
          
          lookupResults.push({
            formattedName: formattedCategoryName,
            categoryId,
            found
          });
          
          if (categoryId !== undefined) {
            categoryIds.push(categoryId);
            console.log('🔍 [Legacy Leads Category Filter] Found category_id:', categoryId, 'for category:', formattedCategoryName);
          } else {
            console.log('⚠️ [Legacy Leads Category Filter] No category ID found for:', formattedCategoryName);
            // Debug: Check if the mapping contains similar entries
            const similarEntries = Array.from(categoryNameToIdMapping.keys()).filter(key => 
              key.toLowerCase().includes(formattedCategoryName.toLowerCase().split(' (')[0]) ||
              formattedCategoryName.toLowerCase().includes(key.toLowerCase().split(' (')[0])
            );
            if (similarEntries.length > 0) {
              console.log('🔍 [Legacy Leads Category Filter] Similar entries in mapping:', similarEntries);
            }
          }
        }
        
        console.log('🏷️ [Legacy Leads Category Filter] Category ID lookup summary:', {
          totalSelected: filters.category.length,
          lookupResults,
          categoryIdsFound: categoryIds,
          categoryIdsCount: categoryIds.length
        });
        
        console.log(`🔍 [Legacy Leads Category Filter] DEBUG Lead 174503: Category filter - categoryIds found:`, categoryIds, 'Lead has category_id: 122, included:', categoryIds.includes(122));
        
        if (categoryIds.length > 0) {
          // Use IN operator for multiple category_ids
          console.log('🏷️ [Legacy Leads Category Filter] Applying category_id filter (IN):', categoryIds);
          legacyLeadsQuery = legacyLeadsQuery.in('category_id', categoryIds);
          console.log('🏷️ [Legacy Leads Category Filter] Category filter applied to query');
        } else {
          console.log('❌ [Legacy Leads Category Filter] No category_ids found for any categories - category filter will not be applied');
          console.log('🔍 [Legacy Leads Category Filter] Available mappings:', Array.from(categoryNameToIdMapping.entries()).slice(0, 20));
        }
      } else {
        console.log('🏷️ [Legacy Leads Category Filter] No category filter - filters.category is empty or null');
      }
      if (filters.language && filters.language.length > 0) {
        console.log('🌐 Adding language filter for legacy leads:', filters.language);
        
        // Check if filtering for N/A
        const hasNAFilter = filters.language.some(lang => 
          lang.toUpperCase() === 'N/A' || lang === 'N/A'
        );
        const nonNALanguages = filters.language.filter(lang => 
          lang.toUpperCase() !== 'N/A' && lang !== 'N/A'
        );
        
        // Map language codes to full names for matching
        const languageCodeToFullName: Record<string, string> = {
          'EN': 'English',
          'ENGLISH': 'English',
          'HE': 'Hebrew',
          'HEBREW': 'Hebrew',
          'DE': 'German',
          'GERMAN': 'German',
          'FR': 'French',
          'FRENCH': 'French',
          'ES': 'Spanish',
          'SPANISH': 'Spanish',
          'RU': 'Russian',
          'RUSSIAN': 'Russian',
          'AR': 'Arabic',
          'ARABIC': 'Arabic',
          'PT': 'Portuguese',
          'POR': 'Portuguese',
          'PORTUGUESE': 'Portuguese',
        };
        
        if (hasNAFilter && nonNALanguages.length === 0) {
          // Only filtering for N/A - find leads where language_id is null
          // For legacy leads, language_id is the primary field, so we just check that
          console.log('🌐 Filtering for N/A language (null language_id) for legacy leads');
          legacyLeadsQuery = legacyLeadsQuery.is('language_id', null);
        } else if (hasNAFilter && nonNALanguages.length > 0) {
          // Filtering for both N/A and specific languages
          console.log('🌐 Filtering for both N/A and specific languages for legacy leads:', nonNALanguages);
          
          // Expand filter array to include both codes and full names for non-N/A languages
          const expandedLanguageFilter = new Set<string>();
          nonNALanguages.forEach(lang => {
            const upperLang = lang.toUpperCase();
            expandedLanguageFilter.add(lang); // Add original value
            expandedLanguageFilter.add(upperLang); // Add uppercase version
            
            // If it's a code, also add the full name
            if (languageCodeToFullName[upperLang]) {
              expandedLanguageFilter.add(languageCodeToFullName[upperLang]);
            }
            
            // If it's already a full name, also try to find if it maps to a code
            Object.entries(languageCodeToFullName).forEach(([code, fullName]) => {
              if (fullName.toLowerCase() === lang.toLowerCase()) {
                expandedLanguageFilter.add(code);
                expandedLanguageFilter.add(fullName);
              }
            });
          });
          
          const expandedFilterArray = Array.from(expandedLanguageFilter);
          
          // OR condition: language_id is null OR misc_language.name in expanded array
          const orConditions = ['language_id.is.null'];
          expandedFilterArray.forEach(lang => {
            orConditions.push(`misc_language.name.eq.${lang}`);
          });
          
          legacyLeadsQuery = legacyLeadsQuery.or(orConditions.join(','));
          
          console.log('🌐 Mixed language filter (N/A + specific languages) for legacy leads:', {
            original: filters.language,
            expanded: expandedFilterArray,
            orConditions
          });
        } else {
          // Only filtering for specific languages (not N/A) - exclude N/A/null values
          // Expand filter array to include both codes and full names
          const expandedLanguageFilter = new Set<string>();
          nonNALanguages.forEach(lang => {
            const upperLang = lang.toUpperCase();
            expandedLanguageFilter.add(lang); // Add original value
            expandedLanguageFilter.add(upperLang); // Add uppercase version
            
            // If it's a code, also add the full name
            if (languageCodeToFullName[upperLang]) {
              expandedLanguageFilter.add(languageCodeToFullName[upperLang]);
            }
            
            // If it's already a full name, also try to find if it maps to a code
            Object.entries(languageCodeToFullName).forEach(([code, fullName]) => {
              if (fullName.toLowerCase() === lang.toLowerCase()) {
                expandedLanguageFilter.add(code);
                expandedLanguageFilter.add(fullName);
              }
            });
          });
          
          const expandedFilterArray = Array.from(expandedLanguageFilter);
          console.log('🌐 Expanded language filter (excluding N/A) for legacy leads:', {
            original: filters.language,
            expanded: expandedFilterArray
          });
          
          // Use in() to match specific languages and explicitly exclude null language_id
          // This prevents matching leads with N/A language
          if (expandedFilterArray.length === 1) {
            legacyLeadsQuery = legacyLeadsQuery
              .eq('misc_language.name', expandedFilterArray[0])
              .not('language_id', 'is', null);
          } else {
            legacyLeadsQuery = legacyLeadsQuery
              .in('misc_language.name', expandedFilterArray)
              .not('language_id', 'is', null);
          }
        }
      }
      if (filters.status && filters.status.length > 0) {
        console.log('📊 Adding status filter for legacy leads (Active/Not active):', filters.status);
        const includeActive = filters.status.includes('Active');
        const includeInactive = filters.status.includes('Not active');

        // Legacy mapping: status 0 = Active, status 10 = Not active, status null = Active (subleads)
        // This matches the logic in SignedSalesReportPage.tsx
        if (includeActive && !includeInactive) {
          // Active: status = 0 OR status IS NULL (subleads are considered active)
          legacyLeadsQuery = legacyLeadsQuery.or('status.eq.0,status.is.null');
        } else if (!includeActive && includeInactive) {
          // Not active: status = 10 only (excludes status null and status 0)
          legacyLeadsQuery = legacyLeadsQuery.eq('status', 10);
        }
        // If both selected, don't filter (includes all)
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
      // Filter by allowed source IDs from extern_source_id, and optionally by selected sources
      if (allowedSourceIds.length > 0) {
        // If user has selected specific sources, map them to IDs and filter by those
        let sourceIdsToFilter = allowedSourceIds;
        
        if (filters.source && filters.source.length > 0) {
          // Get source IDs for the selected source names
          const { data: selectedSources, error: selectedError } = await supabase
            .from('misc_leadsource')
            .select('id, name')
            .in('name', filters.source)
            .in('id', allowedSourceIds)
            .eq('active', true);
          
          if (!selectedError && selectedSources && selectedSources.length > 0) {
            sourceIdsToFilter = selectedSources.map(s => s.id);
            console.log('📡 Filtering legacy leads by selected source IDs:', sourceIdsToFilter);
          } else {
            console.log('⚠️ No valid selected sources found, filtering out all legacy leads');
            legacyLeadsQuery = legacyLeadsQuery.eq('source_id', -1);
            sourceIdsToFilter = [];
          }
        } else {
          console.log('📡 Filtering legacy leads by all allowed source IDs:', allowedSourceIds);
        }
        
        if (sourceIdsToFilter.length > 0) {
          if (sourceIdsToFilter.length === 1) {
            legacyLeadsQuery = legacyLeadsQuery.eq('source_id', sourceIdsToFilter[0]);
          } else {
            legacyLeadsQuery = legacyLeadsQuery.in('source_id', sourceIdsToFilter);
          }
        }
      } else {
        console.log('⚠️ No allowed source IDs found, filtering out all legacy leads');
        legacyLeadsQuery = legacyLeadsQuery.eq('source_id', -1);
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
      if (filters.eligibilityDeterminedOnly) {
        console.log('✅ Adding eligibility filter for legacy leads');
        legacyLeadsQuery = legacyLeadsQuery.eq('eligibile', 'true');
      }
      
      // Store categoryIds for later debugging (from legacy leads filter section)
      let legacyCategoryIds: number[] = [];
      if (filters.category && filters.category.length > 0) {
        for (const formattedCategoryName of filters.category) {
          const categoryId = categoryNameToIdMapping.get(formattedCategoryName);
          if (categoryId !== undefined) {
            legacyCategoryIds.push(categoryId);
          }
        }
      }
      
      // Execute both queries with explicit limit to ensure we get all results
      // Supabase default limit is 1000, but we'll set it explicitly to be safe
      console.log('🚀 [Query Execution] Executing queries with limits...');
      const [newLeadsResult, legacyLeadsResult] = await Promise.all([
        newLeadsQuery.order('created_at', { ascending: false }).limit(10000),
        legacyLeadsQuery.order('cdate', { ascending: false }).limit(10000)
      ]);

      console.log('📊 [Query Results] New leads result:', {
        data: newLeadsResult.data,
        error: newLeadsResult.error,
        count: newLeadsResult.data?.length || 0,
        sampleCategories: newLeadsResult.data?.slice(0, 5).map((lead: any) => ({
          id: lead.id,
          name: lead.name,
          category: lead.category,
          category_id: lead.category_id
        })),
        sampleRoles: newLeadsResult.data?.slice(0, 5).map((lead: any) => ({
          id: lead.id,
          name: lead.name,
          scheduler: lead.scheduler,
          manager: lead.manager,
          meeting_manager_id: lead.meeting_manager_id,
          lawyer: lead.lawyer,
          meeting_lawyer_id: lead.meeting_lawyer_id,
          expert: lead.expert,
          expert_id: lead.expert_id,
          closer: lead.closer,
          handler: lead.handler,
          case_handler_id: lead.case_handler_id
        }))
      });
      
      console.log('📊 [Query Results] Legacy leads result:', {
        data: legacyLeadsResult.data,
        error: legacyLeadsResult.error,
        count: legacyLeadsResult.data?.length || 0,
        sampleCategories: legacyLeadsResult.data?.slice(0, 5).map((lead: any) => ({
          id: lead.id,
          name: lead.name,
          category: lead.category,
          category_id: lead.category_id
        }))
      });
      
      // Debug: Check if any results match the selected categories
      if (filters.category && filters.category.length > 0) {
        // Get category IDs for new leads too
        const newLeadsCategoryIds: number[] = [];
        const categoryNames = filters.category.map(cat => cat.split(' (')[0].trim());
        for (const formattedCategoryName of filters.category) {
          const categoryId = categoryNameToIdMapping.get(formattedCategoryName);
          if (categoryId !== undefined) {
            newLeadsCategoryIds.push(categoryId);
          }
        }
        
        console.log('🔍 [Query Results] Checking if results match selected categories:', {
          selectedCategoryNames: categoryNames,
          selectedFormattedCategories: filters.category,
          newLeadsCategoryIds,
          legacyCategoryIds,
          newLeadsMatchingByCategoryId: newLeadsResult.data?.filter((lead: any) => 
            newLeadsCategoryIds.length > 0 && newLeadsCategoryIds.includes(lead.category_id)
          ).length || 0,
          newLeadsMatchingByCategoryName: newLeadsResult.data?.filter((lead: any) => 
            categoryNames.includes(lead.category)
          ).length || 0,
          legacyLeadsMatching: legacyLeadsResult.data?.filter((lead: any) => {
            const leadCategoryId = lead.category_id;
            return legacyCategoryIds.length > 0 && legacyCategoryIds.includes(leadCategoryId);
          }).length || 0,
          sampleNewLeadsCategories: newLeadsResult.data?.slice(0, 10).map((lead: any) => ({
            id: lead.id,
            category: lead.category,
            category_id: lead.category_id,
            matchesById: newLeadsCategoryIds.includes(lead.category_id),
            matchesByName: categoryNames.includes(lead.category)
          })),
          sampleLegacyLeadsCategories: legacyLeadsResult.data?.slice(0, 10).map((lead: any) => ({
            id: lead.id,
            category_id: lead.category_id,
            matches: legacyCategoryIds.includes(lead.category_id)
          })),
          // Role filter matching (if any role filters are applied)
          roleFiltersApplied: {
            scheduler: filters.scheduler?.length > 0,
            manager: filters.manager?.length > 0,
            lawyer: filters.lawyer?.length > 0,
            expert: filters.expert?.length > 0,
            closer: filters.closer?.length > 0,
            case_handler: filters.case_handler?.length > 0
          },
          sampleNewLeadsRoles: newLeadsResult.data?.slice(0, 10).map((lead: any) => {
            const schedulerMatch = filters.scheduler?.length > 0 
              ? (filters.scheduler.includes(lead.scheduler) || 
                 (lead.meeting_scheduler_id && filters.scheduler.some(name => nameToIdMapping.get(name) === lead.meeting_scheduler_id)))
              : null;
            const managerMatch = filters.manager?.length > 0
              ? (filters.manager.includes(lead.manager) ||
                 (lead.meeting_manager_id && filters.manager.some(name => nameToIdMapping.get(name) === lead.meeting_manager_id)))
              : null;
            const lawyerMatch = filters.lawyer?.length > 0
              ? (filters.lawyer.includes(lead.lawyer) ||
                 (lead.meeting_lawyer_id && filters.lawyer.some(name => nameToIdMapping.get(name) === lead.meeting_lawyer_id)))
              : null;
            const expertMatch = filters.expert?.length > 0
              ? (filters.expert.includes(lead.expert) ||
                 (lead.expert_id && filters.expert.some(name => nameToIdMapping.get(name) === lead.expert_id)))
              : null;
            const closerMatch = filters.closer?.length > 0
              ? filters.closer.includes(lead.closer)
              : null;
            const caseHandlerMatch = filters.case_handler?.length > 0
              ? (filters.case_handler.includes(lead.handler) ||
                 (lead.case_handler_id && filters.case_handler.some(name => nameToIdMapping.get(name) === lead.case_handler_id)))
              : null;
            
            return {
              id: lead.id,
              scheduler: lead.scheduler,
              schedulerMatch,
              manager: lead.manager,
              meeting_manager_id: lead.meeting_manager_id,
              managerMatch,
              lawyer: lead.lawyer,
              meeting_lawyer_id: lead.meeting_lawyer_id,
              lawyerMatch,
              expert: lead.expert,
              expert_id: lead.expert_id,
              expertMatch,
              closer: lead.closer,
              closerMatch,
              handler: lead.handler,
              case_handler_id: lead.case_handler_id,
              caseHandlerMatch
            };
          })
        });
      }
      

      // DEBUG: Check if lead 174503 is in the query results
      const debugLeadId = 174503;
      const debugLeadInResults = legacyLeadsResult.data?.find((lead: any) => lead.id === debugLeadId);
      if (debugLeadInResults) {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: Found in query results:`, {
          id: debugLeadInResults.id,
          name: debugLeadInResults.name,
          cdate: debugLeadInResults.cdate,
          status: debugLeadInResults.status,
          stage: debugLeadInResults.stage,
          category_id: debugLeadInResults.category_id,
          source_id: debugLeadInResults.source_id,
          language_id: debugLeadInResults.language_id,
          topic: debugLeadInResults.topic,
        });
      } else {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: NOT found in query results - checking if it exists in database...`);
        // Check if the lead exists at all
        const { data: debugLeadCheck, error: debugCheckError } = await supabase
          .from('leads_lead')
          .select('id, name, cdate, status, stage, category_id, source_id, language_id, topic, unactivated_at')
          .eq('id', debugLeadId)
          .maybeSingle();
        if (!debugCheckError && debugLeadCheck) {
          console.log(`🔍 DEBUG Lead ${debugLeadId}: Exists in database:`, debugLeadCheck);
          
          // Check what category name corresponds to category_id 122
          let categoryNameFor122 = null;
          try {
            const { data: catData } = await supabase
              .from('misc_category')
              .select('id, name, parent_id, misc_maincategory!parent_id(name)')
              .eq('id', debugLeadCheck.category_id)
              .single();
            if (catData) {
              const mainCat = Array.isArray(catData.misc_maincategory) ? catData.misc_maincategory[0] : catData.misc_maincategory;
              categoryNameFor122 = mainCat?.name ? `${catData.name} (${mainCat.name})` : catData.name;
              console.log(`🔍 DEBUG Lead ${debugLeadId}: Category name for category_id ${debugLeadCheck.category_id}:`, categoryNameFor122);
            }
          } catch (e) {
            console.log(`🔍 DEBUG Lead ${debugLeadId}: Error fetching category name for ID ${debugLeadCheck.category_id}:`, e);
          }
          
          // Check why it was filtered out
          console.log(`🔍 DEBUG Lead ${debugLeadId}: Filter analysis:`, {
            fromDate: filters.fromDate,
            toDate: filters.toDate,
            cdate: debugLeadCheck.cdate,
            cdateMatchesFromDate: filters.fromDate ? (debugLeadCheck.cdate >= filters.fromDate) : 'N/A',
            cdateMatchesToDate: filters.toDate ? (debugLeadCheck.cdate <= `${filters.toDate}T23:59:59`) : 'N/A',
            status: debugLeadCheck.status,
            statusFilter: filters.status,
            stage: debugLeadCheck.stage,
            stageFilter: filters.stage,
            category_id: debugLeadCheck.category_id,
            categoryNameFor122: categoryNameFor122,
            categoryFilter: filters.category,
            categoryMatches: categoryNameFor122 ? filters.category.includes(categoryNameFor122) : 'Unknown - check category IDs',
            source_id: debugLeadCheck.source_id,
            sourceFilter: filters.source,
            language_id: debugLeadCheck.language_id,
            languageFilter: filters.language,
          });
        } else {
          console.log(`🔍 DEBUG Lead ${debugLeadId}: Does not exist in database or error:`, debugCheckError);
        }
      }

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
          const mainRel = category.misc_maincategory;

          // Support both array and single-object shapes from PostgREST
          const mainCategory = Array.isArray(mainRel)
            ? mainRel[0]?.name
            : mainRel?.name;

          const categoryName = mainCategory
            ? `${category.name} (${mainCategory})`
            : category.name;

          return categoryName;
        }
        
        // Fallback to direct category field
        return lead.category || 'No Category';
      };

      console.log('🔄 Processing new leads...');
      
      // If filtering for N/A only, filter out leads with non-empty language values
      const hasNAFilterOnly = filters.language && 
        filters.language.length === 1 && 
        (filters.language[0].toUpperCase() === 'N/A' || filters.language[0] === 'N/A') &&
        filters.language.every(lang => lang.toUpperCase() === 'N/A' || lang === 'N/A');
      
      // Filter leads if N/A only filter is active
      let filteredNewLeads = newLeadsResult.data || [];
      if (hasNAFilterOnly) {
        console.log('🌐 Applying client-side N/A filter to new leads');
        filteredNewLeads = filteredNewLeads.filter(lead => {
          // language_id must be null AND language must be null/empty/N/A
          const languageIdNull = lead.language_id === null || lead.language_id === undefined;
          const languageEmpty = !lead.language || 
                                lead.language === null || 
                                lead.language === '' || 
                                lead.language === 'N/A' ||
                                String(lead.language).trim() === '';
          return languageIdNull && languageEmpty;
        });
        console.log('🌐 Client-side N/A filter result:', {
          before: (newLeadsResult.data || []).length,
          after: filteredNewLeads.length
        });
      }
      
      // Calculate sublead suffixes for new leads (similar to Clients.tsx)
      // Group subleads by master_id and calculate suffixes based on id ordering
      const newSubLeadSuffixMap = new Map<string, number>();
      const newMasterIdsWithSubLeads = new Set<string>(); // Track which master IDs have subleads
      const newLeadsWithMaster = filteredNewLeads.filter((l: any) => l.master_id);
      const newMasterIds = Array.from(new Set(newLeadsWithMaster.map((l: any) => l.master_id?.toString()).filter(Boolean)));
      
      for (const masterId of newMasterIds) {
        const sameMasterLeads = filteredNewLeads.filter((l: any) => l.master_id?.toString() === masterId);
        // Sort by id ascending (same as Clients.tsx)
        sameMasterLeads.sort((a: any, b: any) => {
          const aId = typeof a.id === 'string' ? parseInt(a.id) || 0 : (a.id || 0);
          const bId = typeof b.id === 'string' ? parseInt(b.id) || 0 : (b.id || 0);
          return aId - bId;
        });
        
        // Mark this master ID as having subleads
        if (sameMasterLeads.length > 0) {
          newMasterIdsWithSubLeads.add(masterId);
        }
        
        sameMasterLeads.forEach((lead: any, index: number) => {
          const leadKey = lead.id?.toString();
          if (leadKey) {
            // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
            newSubLeadSuffixMap.set(leadKey, index + 2);
          }
        });
      }
      
      // Map new leads with proper category formatting and role information
      let mappedNewLeads = filteredNewLeads.map(lead => {
        const anyLead = lead as any;
        
        // Format lead number with sublead handling (similar to Clients.tsx)
        let displayLeadNumber: string;
        if (anyLead.master_id) {
          // It's a sublead - format as master_id/suffix
          // If lead_number already has a /, use it; otherwise calculate suffix
          if (anyLead.lead_number && String(anyLead.lead_number).includes('/')) {
            displayLeadNumber = anyLead.lead_number;
          } else {
            // Calculate suffix based on position in ordered list of subleads with same master_id
            const leadKey = anyLead.id?.toString();
            const suffix = leadKey ? newSubLeadSuffixMap.get(leadKey) : undefined;
            
            // Find the master lead to get its lead_number (prefer lead_number over manual_id for new leads)
            const masterLead = filteredNewLeads.find((l: any) => l.id === anyLead.master_id);
            // For new leads, always use lead_number (not manual_id) for sublead display
            const masterLeadNumber = masterLead?.lead_number || anyLead.master_id?.toString() || '';
            
            // Use calculated suffix if available, otherwise default to /2
            displayLeadNumber = suffix ? `${masterLeadNumber}/${suffix}` : `${masterLeadNumber}/2`;
          }
        } else {
          // It's a master lead or standalone lead
          // For new leads, prefer lead_number over manual_id
          const baseNumber = anyLead.lead_number || anyLead.manual_id || anyLead.id?.toString?.() || '';
          // Add /1 suffix ONLY if this master lead has subleads
          // Check if this lead's ID is in the set of master IDs that have subleads
          const leadIdStr = anyLead.id?.toString();
          const hasSubLeads = leadIdStr && newMasterIdsWithSubLeads.has(leadIdStr);
          
          // Check if it already has a suffix
          if (hasSubLeads && baseNumber && !baseNumber.includes('/')) {
            displayLeadNumber = `${baseNumber}/1`;
          } else {
            displayLeadNumber = baseNumber;
          }
        }

        return {
          ...lead,
          lead_type: 'new',
          display_lead_number: String(displayLeadNumber),
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
            const mainRel = (category as any).misc_maincategory;
            const mainCategory = Array.isArray(mainRel)
              ? mainRel[0]?.name
              : mainRel?.name;
            const categoryName = mainCategory
              ? `${category.name} (${mainCategory})`
              : category.name;
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
      
      // If filtering for N/A only, filter out legacy leads with non-null language_id
      const hasNAFilterOnlyLegacy = filters.language && 
        filters.language.length === 1 && 
        (filters.language[0].toUpperCase() === 'N/A' || filters.language[0] === 'N/A') &&
        filters.language.every(lang => lang.toUpperCase() === 'N/A' || lang === 'N/A');
      
      // Filter legacy leads if N/A only filter is active
      let filteredLegacyLeads = legacyLeadsResult.data || [];
      if (hasNAFilterOnlyLegacy) {
        console.log('🌐 Applying client-side N/A filter to legacy leads');
        filteredLegacyLeads = filteredLegacyLeads.filter(lead => {
          // For legacy leads, language_id must be null
          return lead.language_id === null || lead.language_id === undefined;
        });
        console.log('🌐 Client-side N/A filter result for legacy leads:', {
          before: (legacyLeadsResult.data || []).length,
          after: filteredLegacyLeads.length
        });
      }
      
      // Calculate sublead suffixes for legacy leads (similar to Clients.tsx)
      // Group subleads by master_id and calculate suffixes based on id ordering
      const legacySubLeadSuffixMap = new Map<string, number>();
      const legacyMasterIdsWithSubLeads = new Set<string>(); // Track which master IDs have subleads
      const legacyLeadsWithMaster = filteredLegacyLeads.filter((l: any) => l.master_id);
      const legacyMasterIds = Array.from(new Set(legacyLeadsWithMaster.map((l: any) => l.master_id?.toString()).filter(Boolean)));
      
      for (const masterId of legacyMasterIds) {
        const sameMasterLeads = filteredLegacyLeads.filter((l: any) => l.master_id?.toString() === masterId);
        // Sort by id ascending (same as Clients.tsx)
        sameMasterLeads.sort((a: any, b: any) => {
          const aId = typeof a.id === 'string' ? parseInt(a.id) || 0 : (a.id || 0);
          const bId = typeof b.id === 'string' ? parseInt(b.id) || 0 : (b.id || 0);
          return aId - bId;
        });
        
        // Mark this master ID as having subleads
        if (sameMasterLeads.length > 0) {
          legacyMasterIdsWithSubLeads.add(masterId);
        }
        
        sameMasterLeads.forEach((lead: any, index: number) => {
          const leadKey = lead.id?.toString();
          if (leadKey) {
            // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
            legacySubLeadSuffixMap.set(leadKey, index + 2);
          }
        });
      }
      
      // Map legacy leads to match new leads format using joined data
      let mappedLegacyLeads = filteredLegacyLeads.map(legacyLead => {
        const sourceName = legacyLead.source_id ? 
          sourceMapping.get(legacyLead.source_id) || legacyLead.source_external_id || 'Unknown' :
          legacyLead.source_external_id || 'Unknown';
          
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
          
        // Format lead number with sublead handling (similar to Clients.tsx)
        let displayLeadNumber: string;
        const legacyLeadAny = legacyLead as any;
        if (legacyLeadAny.master_id) {
          // It's a sublead - format as master_id/suffix
          // If lead_number already has a /, use it; otherwise calculate suffix
          if (legacyLead.lead_number && String(legacyLead.lead_number).includes('/')) {
            displayLeadNumber = legacyLead.lead_number;
          } else {
            // Calculate suffix based on position in ordered list of subleads with same master_id
            const leadKey = legacyLead.id?.toString();
            const suffix = leadKey ? legacySubLeadSuffixMap.get(leadKey) : undefined;
            
            // Find the master lead to get its lead_number or manual_id
            const masterLead = filteredLegacyLeads.find((l: any) => l.id === legacyLeadAny.master_id);
            const masterLeadNumber = masterLead?.lead_number || masterLead?.manual_id || legacyLeadAny.master_id?.toString() || '';
            
            // Use calculated suffix if available, otherwise default to /2
            displayLeadNumber = suffix ? `${masterLeadNumber}/${suffix}` : `${masterLeadNumber}/2`;
          }
        } else {
          // It's a master lead or standalone lead
          const baseNumber = legacyLeadAny.manual_id ||
            legacyLead.lead_number ||
            legacyLead.id?.toString?.() ||
            '';
          // Add /1 suffix ONLY if this master lead has subleads
          // Check if this lead's ID is in the set of master IDs that have subleads
          const leadIdStr = legacyLead.id?.toString();
          const hasSubLeads = leadIdStr && legacyMasterIdsWithSubLeads.has(leadIdStr);
          
          // Check if it already has a suffix
          if (hasSubLeads && baseNumber && !baseNumber.includes('/')) {
            displayLeadNumber = `${baseNumber}/1`;
          } else {
            displayLeadNumber = baseNumber;
          }
        }

        return {
          // Basic Info
          id: legacyLead.id,
          lead_number: legacyLead.lead_number || legacyLead.id.toString(),
          display_lead_number: String(displayLeadNumber),
          name: legacyLead.name,
          topic: legacyLead.topic,
          
          // Contact Info
          email: legacyLead.email,
          phone: legacyLead.phone,
          mobile: legacyLead.mobile,
          additional_contacts: legacyLead.additional_emails || legacyLead.additional_phones,
          
          // Status & Classification
          // Preserve original numeric stage ID so getStageName/getStageColour can look it up
          stage: legacyLead.stage,
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

          // Type marker so we can distinguish legacy leads in the UI
          lead_type: 'legacy',
        };
      });

      
      // DEBUG: Check if lead 174503 is still in mapped legacy leads after all processing
      const debugLeadFinal = mappedLegacyLeads.find((lead: any) => lead.id === debugLeadId);
      if (debugLeadFinal) {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: Still present in final mapped legacy leads:`, {
          id: debugLeadFinal.id,
          name: debugLeadFinal.name,
          status: debugLeadFinal.status,
          stage: debugLeadFinal.stage,
          category: debugLeadFinal.category,
        });
      } else if (debugLeadInResults) {
        console.log(`🔍 DEBUG Lead ${debugLeadId}: Was in query results but filtered out during mapping/processing`);
      }

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

  const getStageBadge = (stage: string | number | null | undefined) => {
    if (!stage && stage !== 0) return <span className="badge badge-outline">No Stage</span>;
    
    // Convert stage to string for getStageName/getStageColour (handles both numeric IDs and stage names)
    const stageStr = String(stage);
    
    // Get stage name and color from stageUtils
    const stageName = getStageName(stageStr);
    const stageColour = getStageColour(stageStr);
    const badgeTextColour = getContrastingTextColor(stageColour);
    
    // Use dynamic color if available, otherwise fallback to default purple
    const backgroundColor = stageColour || '#3f28cd';
    const textColor = stageColour ? badgeTextColour : '#ffffff';
    
    return <span 
      className="badge stage-badge hover:opacity-90 transition-opacity duration-200 text-xs px-3 py-1 max-w-full"
      style={{
        backgroundColor: backgroundColor,
        borderColor: backgroundColor,
        color: textColor,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'inline-block'
      }}
      title={stageName}
    >
      {stageName}
    </span>;
  };

  const renderResultCard = (lead: Lead) => {
    const anyLead = lead as any;

    // Legacy lead highlighting: status 10 = Not active
    const isLegacyInactive =
      anyLead.lead_type === 'legacy' && anyLead.status && Number(anyLead.status) === 10;

    const cardClasses = [
      'card',
      'shadow-lg',
      'hover:shadow-2xl',
      'transition-all',
      'duration-300',
      'ease-in-out',
      'transform',
      'hover:-translate-y-1',
      'cursor-pointer',
      'group',
      'border',
      // Bring back soft red highlight for inactive legacy leads
      isLegacyInactive ? 'bg-red-50 border-red-200' : 'bg-base-100 border-base-200',
    ].join(' ');

    // Ensure category is always shown as "Subcategory (Main Category)" when possible
    let displayCategory: string | null = null;

    // If category already contains a main category in parentheses, just use it
    if (typeof anyLead.category === 'string' && anyLead.category.includes('(')) {
      displayCategory = anyLead.category;
    } else if (anyLead.misc_category && anyLead.misc_category.name) {
      // New leads with joined misc_category + misc_maincategory
      const mainName = anyLead.misc_category.misc_maincategory?.[0]?.name;
      displayCategory = mainName
        ? `${anyLead.misc_category.name} (${mainName})`
        : anyLead.misc_category.name;
    } else if (anyLead.category && anyLead.main_category) {
      // Fallback if we ever store main_category separately
      displayCategory = `${anyLead.category} (${anyLead.main_category})`;
    } else {
      displayCategory = anyLead.category || null;
    }

    return (
  <div 
      key={lead.id} 
      className={cardClasses}
      onClick={(e) => {
        // Pass the full lead object so we can access manual_id and other properties
        handleLeadClick(lead, e);
      }}
    >
      <div className="card-body p-5 relative">
        {isLegacyInactive && (
          <span className="badge badge-xs absolute top-1 left-3 bg-white border-red-400 text-red-500 shadow-sm">
            Not active
          </span>
        )}
        <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
            <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
              {lead.name}
            </h2>
            </div>
            {getStageBadge(lead.stage)}
        </div>
        
        <p className="text-sm text-base-content/60 font-mono mb-4">
          #{(lead as any).display_lead_number || lead.lead_number || lead.id}
        </p>

        <div className="divider my-0"></div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
          <div className="flex items-center gap-2" title="Date Created">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="font-medium">{new Date(lead.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2" title="Category">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            <span>{displayCategory || 'N/A'}</span>
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
  };

  return (
    <div className="p-6 md:p-10">
      <h1 className="text-3xl font-bold mb-6">Leads Search</h1>

      {/* Search Form */}
      <div className="mb-8">
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Date Range Row */}
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">From date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              value={filters.fromDate}
              onChange={e => handleFilterChange('fromDate', e.target.value)} 
            />
          </div>
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2"><span className="label-text">To date</span></label>
            <input 
              type="date" 
              className="input input-bordered" 
              value={filters.toDate}
              onChange={e => handleFilterChange('toDate', e.target.value)} 
            />
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

          {/* Column 3 */}
          <MultiSelectInput
            label="Status"
            field="status"
            values={filters.status}
            placeholder="Select status..."
            options={filteredStatusOptions}
            showDropdown={showStatusDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
          />
          <div className="form-control flex flex-col col-span-2 sm:col-span-1">
            <label className="label mb-2">
              <span className="label-text">Eligible</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={filters.eligibilityDeterminedOnly}
                onChange={e => handleFilterChange('eligibilityDeterminedOnly', e.target.checked)}
              />
              <span className="text-xs text-gray-500">
                Show only leads where eligibility is determined
              </span>
            </div>
          </div>

          {/* Column 4 */}
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
      {searchPerformed && results.length > 0 && (
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

      {/* Lead Details Modal */}
      <LeadDetailsModal
        lead={selectedLead}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedLead(null);
        }}
      />
    </div>
  );
};

export default ExternalUserLeadSearchPage; 