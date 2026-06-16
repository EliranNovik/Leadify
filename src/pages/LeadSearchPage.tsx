import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, type Lead } from '../lib/supabase';
import {
  ArrowDownTrayIcon,
  Squares2X2Icon,
  TableCellsIcon,
  CalendarIcon,
  GlobeAltIcon,
  BoltIcon,
  DocumentTextIcon,
  LanguageIcon,
  FunnelIcon,
  ChevronDownIcon,
  XMarkIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline';
import { Search, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';
import { getStageName, getStageColour, fetchStageNames, areStagesEquivalent } from '../lib/stageUtils';
import {
  buildJerusalemEndOfDayIso,
  buildJerusalemStartOfDayIso,
  buildLegacyLeadSourceIdOrFilterClauseFromNames,
  buildLeadSourceOrFilterClauseFromNames,
  timestampInCalendarRange,
} from '../lib/leadDateFilters';
import { usePersistedFilters, usePersistedState } from '../hooks/usePersistedState';
import { useTheme } from '../hooks/useTheme';
import LeadSearchCardActions from '../components/LeadSearchCardActions';
import LeadSearchRolesModal from '../components/LeadSearchRolesModal';
import { buildLeadClientPath } from '../lib/leadClientRoute';

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

const MOBILE_FILTER_CHIPS = [
  { key: 'mainCategory', label: 'Main Category' },
  { key: 'category', label: 'Category' },
  { key: 'reason', label: 'Reason' },
  { key: 'fileId', label: 'File id' },
  { key: 'language', label: 'Language' },
  { key: 'tags', label: 'Tags' },
  { key: 'status', label: 'Status' },
  { key: 'expert_examination', label: 'Expert exam' },
  { key: 'source', label: 'Source' },
  { key: 'eligibilityDeterminedOnly', label: 'Eligible' },
  { key: 'stage', label: 'Stage' },
  { key: 'topic', label: 'Topic' },
  { key: 'scheduler', label: 'Scheduler' },
  { key: 'manager', label: 'Manager' },
  { key: 'lawyer', label: 'Lawyer' },
  { key: 'expert', label: 'Expert' },
  { key: 'closer', label: 'Closer' },
  { key: 'case_handler', label: 'Case Handler' },
  { key: 'country', label: 'Country' },
  { key: 'content', label: 'Content' },
] as const;

type MobileFilterKey = (typeof MOBILE_FILTER_CHIPS)[number]['key'];

const stripHtmlForDisplay = (html: string | null | undefined): string => {
  if (html == null || typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
};

const LANGUAGE_CODE_TO_DISPLAY_NAME: Record<string, string> = {
  EN: 'English',
  ENGLISH: 'English',
  HE: 'Hebrew',
  HEBREW: 'Hebrew',
  DE: 'German',
  GERMAN: 'German',
  FR: 'French',
  FRENCH: 'French',
  ES: 'Spanish',
  SPANISH: 'Spanish',
  RU: 'Russian',
  RUSSIAN: 'Russian',
  AR: 'Arabic',
  ARABIC: 'Arabic',
  PT: 'Portuguese',
  POR: 'Portuguese',
  PORTUGUESE: 'Portuguese',
};

const getLeadLanguageDisplay = (language: string | null | undefined): string => {
  if (language == null || String(language).trim() === '') return 'N/A';
  const raw = String(language).trim();
  const upper = raw.toUpperCase();
  const fromCode = LANGUAGE_CODE_TO_DISPLAY_NAME[upper];
  if (fromCode) return fromCode;
  if (raw.length <= 3 && /^[a-zA-Z]+$/.test(raw)) {
    return LANGUAGE_CODE_TO_DISPLAY_NAME[upper] ?? raw;
  }
  return raw;
};

const getLeadCountryDisplay = (anyLead: Record<string, unknown>, displayCategory: string | null): string => {
  const clientCountry = anyLead.client_country;
  if (typeof clientCountry === 'string' && clientCountry.trim()) return clientCountry;

  if (displayCategory) {
    const parenMatch = displayCategory.match(/\(([^)]+)\)/);
    if (parenMatch?.[1]) return parenMatch[1].trim();
    if (displayCategory.includes(' - ')) {
      const part = displayCategory.split(' - ').pop()?.trim();
      if (part) return part;
    }
  }

  return 'N/A';
};

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
        className="input w-full"
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
        <div className="absolute z-10 w-full mt-1 bg-white rounded-md shadow-lg max-h-60 overflow-y-auto">
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
  onHideDropdown,
  hideLabel = false,
  sheetMode = false,
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
  hideLabel?: boolean;
  sheetMode?: boolean;
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

  // Helper function to check if option matches search term (with country aliases)
  const matchesSearch = (option: string, searchTerm: string, fieldName: string): boolean => {
    const optionLower = option.toLowerCase();
    const searchLower = searchTerm.toLowerCase().trim();

    // If search is empty, show all options
    if (!searchLower) return true;

    // Special handling for country field with aliases
    if (fieldName === 'country') {
      // United States aliases - match if search is "us", "usa", or "america"
      if (optionLower.includes('united states')) {
        if (searchLower === 'us' || searchLower === 'usa' || searchLower === 'america' ||
          searchLower.startsWith('us ') || searchLower.startsWith('usa ') ||
          searchLower.startsWith('america ')) {
          return true;
        }
      }

      // United Kingdom aliases - match if search is "uk", "england", "britain", or "gb"
      if (optionLower.includes('united kingdom')) {
        if (searchLower === 'uk' || searchLower === 'england' || searchLower === 'britain' || searchLower === 'gb' ||
          searchLower.startsWith('uk ') || searchLower.startsWith('england ') ||
          searchLower.startsWith('britain ') || searchLower.startsWith('gb ')) {
          return true;
        }
      }
    }

    // Standard matching: check if option contains search term
    return optionLower.includes(searchLower);
  };

  const filteredOptions = options.filter(option =>
    matchesSearch(option, inputValue, field) &&
    !safeValues.includes(option)
  );

  return (
    <div ref={containerRef} className={`form-control flex flex-col relative ${sheetMode ? '' : 'col-span-2 sm:col-span-1'}`}>
      {!hideLabel && (
        <label className="label mb-2">
          <span className="label-text">{label}</span>
          {safeValues.length > 0 && (
            <span className="label-text-alt text-purple-600 font-medium">
              {safeValues.length} selected
            </span>
          )}
        </label>
      )}

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
      <div className={sheetMode ? '' : 'relative'}>
        <input
          type="text"
          className="input w-full"
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
          <div
            className={
              sheetMode
                ? 'mt-2 max-h-56 overflow-y-auto rounded-xl border border-base-200 bg-base-100'
                : 'absolute z-10 w-full mt-1 bg-white rounded-md shadow-lg max-h-60 overflow-y-auto'
            }
          >
            {filteredOptions.map((option, index) => (
              <div
                key={index}
                className={`cursor-pointer text-sm flex items-center gap-2 ${
                  sheetMode
                    ? 'px-4 py-3 hover:bg-base-200/60 active:bg-base-200 border-b border-base-200/60 last:border-0'
                    : 'px-4 py-2 hover:bg-gray-100'
                }`}
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
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Handle clicks outside the component to close dropdown
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onHideDropdown();
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
  }, [showDropdown, onHideDropdown]);

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
    // Don't close dropdown - let user select multiple columns
    // Dropdown will close when clicking outside
  };

  return (
    <div ref={containerRef} className="form-control flex flex-col col-span-2 sm:col-span-1 relative">
      <label className="label mb-2">
        <span className="label-text">Table Columns</span>
        <span className="label-text-alt text-purple-600 font-medium">
          {selectedColumns.length} selected
        </span>
      </label>

      <div className="relative">
        <button
          type="button"
          className="input w-full text-left flex items-center justify-between"
          onClick={onShowDropdown}
        >
          <span>Select columns for table view...</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showDropdown && (
          <div className="absolute z-20 w-full mt-1 bg-white rounded-md shadow-lg max-h-96 overflow-y-auto">
            <div className="p-2">
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
  onMainCategorySelect,
  hideLabel = false,
  sheetMode = false,
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
  hideLabel?: boolean;
  sheetMode?: boolean;
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
    <div ref={containerRef} className={`form-control flex flex-col relative ${sheetMode ? '' : 'col-span-2 sm:col-span-1'}`}>
      {!hideLabel && (
        <label className="label mb-2">
          <span className="label-text">{label}</span>
          {safeValues.length > 0 && (
            <span className="label-text-alt text-purple-600 font-medium">
              {safeValues.length} selected
            </span>
          )}
        </label>
      )}

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
      <div className={sheetMode ? '' : 'relative'}>
        <input
          type="text"
          className="input w-full"
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
          <div
            className={
              sheetMode
                ? 'mt-2 max-h-56 overflow-y-auto rounded-xl border border-base-200 bg-base-100'
                : 'absolute z-10 w-full mt-1 bg-white rounded-md shadow-lg max-h-60 overflow-y-auto'
            }
          >
            {filteredOptions.map((option, index) => (
              <div
                key={index}
                className={`cursor-pointer text-sm flex items-center gap-2 ${
                  sheetMode
                    ? 'px-4 py-3 hover:bg-base-200/60 active:bg-base-200 border-b border-base-200/60 last:border-0'
                    : 'px-4 py-2 hover:bg-gray-100'
                }`}
                onMouseDown={(e) => {
                  // Prevent blur event from firing
                  e.preventDefault();
                  handleSelect(option);
                }}
              >
                <svg className="w-4 h-4 text-purple-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span className="font-medium text-purple-700">{option}</span>
                {!sheetMode && (
                  <span className="text-xs text-gray-500 ml-auto">Auto-selects all subcategories</span>
                )}
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

const getSoftStageBadgeStyle = (hexColor?: string | null, stageId?: string | number | null) => {
  const stageStr = stageId != null ? String(stageId) : '';
  const isMtngSumAgreement =
    stageStr === '50'
    || areStagesEquivalent(getStageName(stageStr), 'Mtng sum+Agreement sent');

  if (isMtngSumAgreement) {
    return {
      backgroundColor: 'rgba(22, 163, 74, 0.3)',
      borderColor: 'rgba(22, 163, 74, 0.45)',
      color: '#15803d',
    };
  }

  const fallback = '#3f28cd';
  const color = hexColor || fallback;
  let sanitized = color.trim();
  if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
  if (sanitized.length === 3) {
    sanitized = sanitized.split('').map(char => char + char).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
    return {
      backgroundColor: 'rgba(63, 40, 205, 0.12)',
      borderColor: 'rgba(63, 40, 205, 0.28)',
      color: fallback,
    };
  }
  const r = parseInt(sanitized.slice(0, 2), 16);
  const g = parseInt(sanitized.slice(2, 4), 16);
  const b = parseInt(sanitized.slice(4, 6), 16);
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.14)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.32)`,
    color: `#${sanitized}`,
  };
};

/** Shared with table + Excel export */
function leadSearchCurrencySymbol(currencyId: unknown): string {
  if (!currencyId) return '₪';
  if (typeof currencyId === 'string') {
    switch (currencyId.toLowerCase()) {
      case 'nis':
      case 'ils':
        return '₪';
      case 'usd':
        return '$';
      case 'eur':
        return '€';
      case 'gbp':
        return '£';
      case 'cad':
        return 'C$';
      case 'aud':
        return 'A$';
      default:
        return '₪';
    }
  }
  if (typeof currencyId === 'number') {
    switch (currencyId) {
      case 1:
        return '₪';
      case 2:
        return '$';
      case 3:
        return '€';
      case 4:
        return '£';
      default:
        return '₪';
    }
  }
  return '₪';
}

/** Plain-text cell value (matches table formatting except stage badge → stage name). */
function getLeadColumnValueForExport(lead: Lead, columnKey: string): string {
  const leadWithData = lead as unknown as Record<string, unknown>;

  const roleFields = ['scheduler', 'manager', 'lawyer', 'expert', 'closer', 'case_handler', 'handler', 'helper'];
  if (roleFields.includes(columnKey)) {
    const roles = leadWithData.roles as Record<string, string> | undefined;
    if (roles && roles[columnKey]) return String(roles[columnKey]);
    return String(leadWithData[columnKey] ?? '');
  }

  if (columnKey === 'roles') {
    const roles = leadWithData.roles as Record<string, string> | undefined;
    if (!roles) return '';
    return Object.entries(roles)
      .filter(([, value]) => value)
      .map(([role, name]) => `${role}: ${name}`)
      .join(', ');
  }

  if (columnKey === 'category') {
    return String(leadWithData.category ?? 'No Category');
  }

  if (columnKey === 'stage') {
    const stage = leadWithData.stage;
    if (stage === null || stage === undefined || stage === '') return 'No Stage';
    return getStageName(String(stage));
  }

  const currencyColumns = ['meeting_currency', 'proposal_currency', 'balance_currency', 'meeting_total_currency'];
  if (currencyColumns.includes(columnKey)) {
    return leadSearchCurrencySymbol(leadWithData[columnKey]);
  }

  const value = leadWithData[columnKey];
  if (value === null || value === undefined) return '';

  if (columnKey.includes('_at') || columnKey.includes('date') || columnKey.includes('Date')) {
    try {
      return new Date(value as string | number | Date).toLocaleDateString();
    } catch {
      return String(value);
    }
  }

  if (columnKey.includes('time') || columnKey.includes('Time')) {
    return String(value);
  }

  const financialFields = [
    'meeting_amount',
    'proposal_total',
    'balance',
    'potential_value',
    'total',
    'first_payment',
    'meeting_total',
    'vat',
    'vat_value',
    'bonus_paid',
    'subcontractor_fee',
  ];
  if (financialFields.includes(columnKey)) {
    const numericValue = typeof value === 'number' ? value : parseFloat(String(value));
    if (!isNaN(numericValue)) {
      let currencyField = `${columnKey}_currency`;
      let currency = leadWithData[currencyField];
      if (!currency) {
        if (columnKey === 'meeting_amount' || columnKey === 'meeting_total') {
          currency = leadWithData.meeting_currency ?? leadWithData.meeting_total_currency;
        } else if (columnKey === 'proposal_total') {
          currency = leadWithData.proposal_currency;
        } else if (columnKey === 'balance') {
          currency = leadWithData.balance_currency;
        } else {
          currency = leadWithData.currency_id ?? leadWithData.currency;
        }
      }
      const currencySymbol = leadSearchCurrencySymbol(currency);
      return `${numericValue.toLocaleString()} ${currencySymbol}`;
    }
    return String(value);
  }

  const booleanFields = [
    'meeting_paid',
    'auto_email_meeting_summary',
    'expert_eligibility_assessed',
    'sales_roles_locked',
    'dependent',
    'auto',
    'autocall',
    'eligibile',
  ];
  if (booleanFields.includes(columnKey)) {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }

  return String(value);
}

// Table View Component
const TableView = ({ leads, selectedColumns, onLeadClick }: { leads: Lead[], selectedColumns: string[], onLeadClick: (lead: Lead | string, event?: React.MouseEvent) => void }) => {
  const getColumnValue = (lead: Lead, columnKey: string): string | React.ReactElement => {
    const leadWithData = lead as any;

    // Stage: colored badge in UI; export uses plain name via getLeadColumnValueForExport
    if (columnKey === 'stage') {
      const stage = leadWithData.stage;
      if (!stage && stage !== 0) return 'No Stage';

      const stageStr = String(stage);

      const stageName = getStageName(stageStr);
      const stageColour = getStageColour(stageStr);
      const badgeTextColour = getContrastingTextColor(stageColour);
      const backgroundColor = stageColour || '#3f28cd';
      const textColor = stageColour ? badgeTextColour : '#ffffff';

      return (
        <span
          className="badge border-0 text-xs px-2 py-1"
          style={{
            backgroundColor: backgroundColor,
            color: textColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'inline-block',
          }}
          title={stageName}
        >
          {stageName}
        </span>
      );
    }

    return getLeadColumnValueForExport(lead, columnKey);
  };

  if (leads.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No leads found matching your criteria.
      </div>
    );
  }

  return (
    <div className="lead-search-table-shell -mx-4 overflow-x-auto md:mx-0 py-2 pb-8">
      <table className="table lead-search-results-table w-full min-w-[36rem] text-base">
        <thead>
          <tr className="md:sticky md:top-0 z-20">
            {selectedColumns.map((columnKey) => {
              const column = AVAILABLE_COLUMNS.find(col => col.key === columnKey);
              return (
                <th
                  key={columnKey}
                  className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-base-content/40"
                >
                  {column?.label || columnKey}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, index) => {
            const anyLead = lead as any;
            const isLegacyInactive = anyLead.lead_type === 'legacy' && anyLead.status != null && (Number(anyLead.status) === 10 || anyLead.status === '10');
            const isNewInactive = anyLead.lead_type === 'new' && anyLead.unactivated_at != null;
            const isInactive = isLegacyInactive || isNewInactive;
            return (
              <tr
                key={lead.id || index}
                className={`group cursor-pointer${
                  isInactive
                    ? ' lead-search-row-inactive [&_.badge]:!border-0 [&_.badge]:!bg-gray-200 [&_.badge]:![color:black]'
                    : ''
                }`}
                onClick={(e) => {
                  onLeadClick(lead, e);
                }}
                title={`Click to view lead ${anyLead.display_lead_number || anyLead.lead_number || lead.id}`}
              >
                {selectedColumns.map((columnKey) => {
                  const columnValue = getColumnValue(lead, columnKey);
                  const titleText = typeof columnValue === 'string' ? columnValue : (columnValue?.props?.title || '');
                  return (
                    <td key={columnKey} className="max-w-xs px-5 py-4">
                      <div className="truncate" title={titleText}>
                        {columnValue}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <style>{`
        .lead-search-table-shell table {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          border-collapse: separate !important;
          border-spacing: 0 10px !important;
        }

        .lead-search-table-shell .table tbody tr:hover {
          background-color: transparent !important;
        }

        html.dark .lead-search-table-shell .table tbody tr:hover {
          background-color: transparent !important;
        }

        .lead-search-table-shell table tbody tr {
          background: transparent !important;
          border-radius: 18px !important;
          overflow: hidden !important;
          box-shadow: none !important;
        }

        .lead-search-table-shell table tbody td {
          border: none !important;
          border-bottom: none !important;
          background: #ffffff !important;
          box-shadow: none !important;
          vertical-align: middle;
        }

        .lead-search-table-shell table tbody tr.lead-search-row-inactive td {
          background: #f3f4f6 !important;
        }

        .lead-search-table-shell table tbody td:first-child {
          border-top-left-radius: 18px !important;
          border-bottom-left-radius: 18px !important;
          padding-left: 1.1rem !important;
        }

        .lead-search-table-shell table tbody td:last-child {
          border-top-right-radius: 18px !important;
          border-bottom-right-radius: 18px !important;
          padding-right: 1.1rem !important;
        }

        .lead-search-table-shell table tbody tr:hover td {
          background: #f1f5f9 !important;
        }

        .lead-search-table-shell table tbody tr.lead-search-row-inactive:hover td {
          background: #e5e7eb !important;
        }

        html.dark .lead-search-table-shell table tbody td {
          background: rgba(255, 255, 255, 0.06) !important;
        }

        html.dark .lead-search-table-shell table tbody tr.lead-search-row-inactive td {
          background: rgba(255, 255, 255, 0.04) !important;
        }

        html.dark .lead-search-table-shell table tbody tr:hover td {
          background: rgba(255, 255, 255, 0.10) !important;
        }

        .lead-search-table-shell table thead,
        .lead-search-table-shell table thead tr,
        .lead-search-table-shell table thead th {
          background-color: transparent !important;
          background-image: none !important;
          border-bottom: none !important;
        }

        .lead-search-table-shell table.lead-search-results-table thead tr,
        .lead-search-table-shell table.lead-search-results-table thead th {
          background-color: #ececec !important;
        }
      `}</style>
    </div>
  );
};

const LeadSearchPage: React.FC = () => {
  const { isAltTheme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  // Ref for results section to scroll to after search
  const resultsRef = useRef<HTMLDivElement>(null);
  const cardsGridRef = useRef<HTMLDivElement>(null);
  const tableResultsRef = useRef<HTMLDivElement>(null);
  const scrollToResultsAfterSearchRef = useRef(false);

  // Initialize filters with current date - ensure no persistent state interferes
  const todayStr = new Date().toISOString().split('T')[0];

  const [filters, setFilters] = usePersistedFilters('leadSearchPage_filters', {
    fromDate: todayStr, // Default to today
    toDate: todayStr, // Default to today
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
    expert_examination: [] as string[],
    country: [] as string[],
  }, {
    storage: 'sessionStorage',
  });
  const [results, setResults] = usePersistedState<Lead[]>('leadSearchPage_results', [], {
    storage: 'sessionStorage',
  });
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedState('leadSearchPage_performed', false, {
    storage: 'sessionStorage',
  });
  const [factsModalLead, setFactsModalLead] = useState<Lead | null>(null);
  const [factsModalText, setFactsModalText] = useState('');
  const [factsModalLoading, setFactsModalLoading] = useState(false);
  const [openCardMenuLeadId, setOpenCardMenuLeadId] = useState<string | null>(null);
  const [rolesModalLead, setRolesModalLead] = useState<Lead | null>(null);
  const [stageOptions, setStageOptions] = useState<string[]>([]);

  // Pre-fill content filter from ?q= param (e.g. from Header recent search)
  const qParamAppliedRef = useRef(false);
  useEffect(() => {
    if (qParamAppliedRef.current) return;
    const q = searchParams.get('q');
    if (q?.trim()) {
      qParamAppliedRef.current = true;
      setFilters(prev => ({ ...prev, content: q.trim() }));
      setSearchParams({}, { replace: true }); // Clear param after applying
    }
  }, [searchParams, setFilters, setSearchParams]);

  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [mainCategoryOptions, setMainCategoryOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [topicOptions, setTopicOptions] = useState<string[]>([]);
  const [reasonOptions, setReasonOptions] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
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
  const [showExpertExaminationDropdown, setShowExpertExaminationDropdown] = useState(false);
  const [filteredStatusOptions, setFilteredStatusOptions] = useState<string[]>([]);
  const [filteredExpertExaminationOptions, setFilteredExpertExaminationOptions] = useState<string[]>([]);
  const [showSchedulerDropdown, setShowSchedulerDropdown] = useState(false);
  const [showManagerDropdown, setShowManagerDropdown] = useState(false);
  const [showLawyerDropdown, setShowLawyerDropdown] = useState(false);
  const [showExpertDropdown, setShowExpertDropdown] = useState(false);
  const [showCloserDropdown, setShowCloserDropdown] = useState(false);
  const [showCaseHandlerDropdown, setShowCaseHandlerDropdown] = useState(false);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [filteredRoleOptions, setFilteredRoleOptions] = useState<string[]>([]);
  const [filteredCountryOptions, setFilteredCountryOptions] = useState<string[]>([]);
  const [viewMode, setViewMode] = usePersistedState<'cards' | 'table'>('leadSearchPage_viewMode', 'cards', {
    storage: 'sessionStorage',
  });
  const [selectedColumns, setSelectedColumns] = usePersistedState<string[]>('leadSearchPage_selectedColumns', ['name', 'lead_number', 'email', 'phone', 'stage', 'source', 'created_at'], {
    storage: 'sessionStorage',
  });
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [showFiltersPanel, setShowFiltersPanel] = useState(true);
  const [mobileQuickBarOpen, setMobileQuickBarOpen] = useState(false);
  const [activeMobileFilter, setActiveMobileFilter] = useState<MobileFilterKey | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (searchPerformed) setShowFiltersPanel(false);
  }, []);

  const appliedAdvancedFilterCount = useMemo(() => {
    let count = 0;
    const arrayFields = [
      'category', 'language', 'reason', 'tags', 'status', 'source', 'stage', 'topic',
      'scheduler', 'manager', 'lawyer', 'expert', 'closer', 'case_handler', 'expert_examination', 'country',
    ] as const;
    for (const field of arrayFields) {
      count += filters[field].length;
    }
    if (filters.fileId.trim()) count += 1;
    if (filters.content.trim()) count += 1;
    if (filters.eligibilityDeterminedOnly) count += 1;
    return count;
  }, [filters]);

  const filtersPanelHidden = searchPerformed && !showFiltersPanel;

  // After search finishes and DOM updates, scroll to cards grid or table (premium UX)
  useEffect(() => {
    if (isSearching || !scrollToResultsAfterSearchRef.current) return;
    scrollToResultsAfterSearchRef.current = false;
    if (results.length === 0) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target =
          viewMode === 'cards' ? cardsGridRef.current : tableResultsRef.current ?? resultsRef.current;
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }, [isSearching, results, viewMode]);

  const closeFactsModal = useCallback(() => {
    setFactsModalLead(null);
    setFactsModalText('');
    setFactsModalLoading(false);
  }, []);

  const openFactsModal = useCallback(async (lead: Lead, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const anyLead = lead as unknown as Record<string, unknown>;
    setFactsModalLead(lead);
    setFactsModalText(String(anyLead.facts ?? anyLead.description ?? ''));
    setFactsModalLoading(true);

    try {
      if (anyLead.lead_type === 'legacy') {
        const rawId = String(anyLead.id ?? '').replace(/^legacy_/, '');
        const legacyId = parseInt(rawId, 10);
        if (Number.isFinite(legacyId)) {
          const { data, error } = await supabase
            .from('leads_lead')
            .select('description')
            .eq('id', legacyId)
            .maybeSingle();
          if (!error && data?.description != null) {
            setFactsModalText(data.description);
          }
        }
      } else if (anyLead.id != null) {
        const { data, error } = await supabase
          .from('leads')
          .select('facts')
          .eq('id', anyLead.id)
          .maybeSingle();
        if (!error && data?.facts != null) {
          setFactsModalText(data.facts);
        }
      }
    } catch (err) {
      console.error('Failed to load lead facts:', err);
      toast.error('Could not load lead facts');
    } finally {
      setFactsModalLoading(false);
    }
  }, []);

  // Handle lead click navigation
  // Uses the exact same logic as MasterLeadPage.tsx
  const handleLeadClick = (lead: Lead | string, event?: React.MouseEvent) => {
    let path: string | null = null;

    if (typeof lead === 'string') {
      path = `/clients/${encodeURIComponent(lead)}`;
    } else {
      path = buildLeadClientPath(lead);
    }

    if (!path) return;

    if (event && (event.metaKey || event.ctrlKey)) {
      // Open in new tab if Cmd (Mac) or Ctrl (Windows/Linux) is pressed
      window.open(path, '_blank');
    } else {
      // Navigate using React Router
      navigate(path);
    }
  };

  const handleExportTableToExcel = useCallback(() => {
    if (selectedColumns.length === 0) {
      toast.error('Select at least one table column to export.');
      return;
    }
    if (results.length === 0) {
      toast.error('No leads to export. Run a search first.');
      return;
    }
    try {
      const headers = selectedColumns.map(
        (k) => AVAILABLE_COLUMNS.find((c) => c.key === k)?.label || k
      );
      const rows = results.map((lead) =>
        selectedColumns.map((key) => getLeadColumnValueForExport(lead, key))
      );
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Leads');
      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `lead_search_export_${dateStr}.xlsx`);
      toast.success(`Exported ${results.length} lead${results.length !== 1 ? 's' : ''}.`);
    } catch (e) {
      console.error('Excel export failed:', e);
      toast.error('Export failed.');
    }
  }, [selectedColumns, results]);

  // Note: State persistence is now handled by usePersistedFilters and usePersistedState hooks
  // They automatically handle saving/restoring state across navigation (but not on page refresh)

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
        // Add "N/A" option to filter for leads with null language_id
        setLanguageOptions([...languages, 'N/A']);
      } catch (error) {
        console.error('Error fetching language options:', error);
        // Fallback to hardcoded options if database fetch fails
        // Add "N/A" option to filter for leads with null language_id
        setLanguageOptions([
          "English", "Hebrew", "German", "French", "Russian", "Other", "N/A"
        ]);
      }
    };

    fetchLanguageOptions();
  }, []);

  // Fetch tag options from misc_leadtag table
  useEffect(() => {
    const fetchTagOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_leadtag')
          .select('name, "order", active')
          .eq('active', true)
          .order('order', { ascending: true })
          .order('name', { ascending: true });

        if (error) throw error;

        const tags =
          data?.map(tag => tag.name).filter((name): name is string => !!name) || [];

        if (tags.length > 0) {
          setTagOptions(tags);
          setFilteredTagOptions(tags);
        } else {
          // Fallback to static options if table is empty
          setTagOptions(TAG_OPTIONS);
          setFilteredTagOptions(TAG_OPTIONS);
        }
      } catch (error) {
        console.error('Error fetching tag options:', error);
        // Fallback to static options on error
        setTagOptions(TAG_OPTIONS);
        setFilteredTagOptions(TAG_OPTIONS);
      }
    };

    fetchTagOptions();
  }, []);

  // Fetch reason options from lead_stage_reasons table
  useEffect(() => {
    const fetchReasonOptions = async () => {
      try {
        const { data, error } = await supabase
          .from('lead_stage_reasons')
          .select('name, order_value, is_active')
          .eq('is_active', true)
          .order('order_value', { ascending: true })
          .order('name', { ascending: true });

        if (error) throw error;

        const reasons =
          data?.map(reason => reason.name).filter((name): name is string => !!name) || [];

        if (reasons.length > 0) {
          setReasonOptions(reasons);
          setFilteredReasonOptions(reasons);
        } else {
          // Fallback to static options if table is empty
          setReasonOptions(REASON_OPTIONS);
          setFilteredReasonOptions(REASON_OPTIONS);
        }
      } catch (error) {
        console.error('Error fetching reason options:', error);
        // Fallback to static options on error
        setReasonOptions(REASON_OPTIONS);
        setFilteredReasonOptions(REASON_OPTIONS);
      }
    };

    fetchReasonOptions();
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

  // Fetch country options from misc_country table (with phone_code for phone number matching)
  useEffect(() => {
    const fetchCountryOptions = async () => {
      try {
        const { data: countriesData, error } = await supabase
          .from('misc_country')
          .select('id, name, iso_code, phone_code')
          .order('name', { ascending: true });

        if (error) {
          console.error('Error fetching country options:', error);
          return;
        }

        if (countriesData) {
          const countryNames = countriesData.map(country => country.name).filter(Boolean);
          setCountryOptions(countryNames);
          setFilteredCountryOptions(countryNames);
          // Store country data with phone codes for filtering
          // We'll use this in the search function
        }
      } catch (error) {
        console.error('Error fetching country options:', error);
      }
    };

    fetchCountryOptions();
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
    setFilteredTagOptions(tagOptions);
  }, [tagOptions]);

  useEffect(() => {
    setFilteredStatusOptions(STATUS_OPTIONS);
  }, []);

  useEffect(() => {
    setFilteredExpertExaminationOptions(EXPERT_EXAMINATION_OPTIONS);
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

  // Country filtering is now handled by MultiSelectInput component
  useEffect(() => {
    setFilteredCountryOptions(countryOptions);
  }, [countryOptions]);

  const handleFilterChange = (field: string, value: any) => {
    // For multi-select fields, don't update the filter directly - 
    // the MultiSelectInput component handles its own input state
    const multiSelectFields = [
      'category',
      'language',
      'reason',
      'tags',
      'status',
      'source',
      'stage',
      'topic',
      'scheduler',
      'manager',
      'lawyer',
      'expert',
      'closer',
      'case_handler',
      'expert_examination',
      'country',
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
      case 'reason': setShowReasonDropdown(true); break;
      case 'tags': setShowTagDropdown(true); break;
      case 'status': setShowStatusDropdown(true); break;
      case 'expert_examination': setShowExpertExaminationDropdown(true); break;
      case 'scheduler': setShowSchedulerDropdown(true); break;
      case 'manager': setShowManagerDropdown(true); break;
      case 'lawyer': setShowLawyerDropdown(true); break;
      case 'expert': setShowExpertDropdown(true); break;
      case 'closer': setShowCloserDropdown(true); break;
      case 'case_handler': setShowCaseHandlerDropdown(true); break;
      case 'country': setShowCountryDropdown(true); break;
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
      case 'expert_examination': setShowExpertExaminationDropdown(false); break;
      case 'scheduler': setShowSchedulerDropdown(false); break;
      case 'manager': setShowManagerDropdown(false); break;
      case 'lawyer': setShowLawyerDropdown(false); break;
      case 'expert': setShowExpertDropdown(false); break;
      case 'closer': setShowCloserDropdown(false); break;
      case 'case_handler': setShowCaseHandlerDropdown(false); break;
      case 'country': setShowCountryDropdown(false); break;
      case 'columns': setShowColumnSelector(false); break;
    }
  };

  const isMobileFilterActive = (key: MobileFilterKey): boolean => {
    if (key === 'fileId') return !!filters.fileId.trim();
    if (key === 'content') return !!filters.content.trim();
    if (key === 'eligibilityDeterminedOnly') return filters.eligibilityDeterminedOnly;
    if (key === 'mainCategory') return filters.category.length > 0;
    const value = filters[key as keyof typeof filters];
    return Array.isArray(value) && value.length > 0;
  };

  const getMobileFilterCount = (key: MobileFilterKey): number => {
    if (key === 'fileId') return filters.fileId.trim() ? 1 : 0;
    if (key === 'content') return filters.content.trim() ? 1 : 0;
    if (key === 'eligibilityDeterminedOnly') return filters.eligibilityDeterminedOnly ? 1 : 0;
    if (key === 'mainCategory') return 0;
    const value = filters[key as keyof typeof filters];
    return Array.isArray(value) ? value.length : 0;
  };

  const closeMobileFilter = () => {
    if (activeMobileFilter) {
      const dropdownKey = activeMobileFilter;
      if (dropdownKey !== 'fileId' && dropdownKey !== 'content' && dropdownKey !== 'eligibilityDeterminedOnly') {
        handleHideDropdown(dropdownKey === 'mainCategory' ? 'mainCategory' : dropdownKey);
      }
    }
    setActiveMobileFilter(null);
  };

  const openMobileFilter = (key: MobileFilterKey) => {
    if (activeMobileFilter && activeMobileFilter !== key) {
      const prev = activeMobileFilter;
      if (prev !== 'fileId' && prev !== 'content' && prev !== 'eligibilityDeterminedOnly') {
        handleHideDropdown(prev === 'mainCategory' ? 'mainCategory' : prev);
      }
    }
    setActiveMobileFilter(key);
    if (key !== 'fileId' && key !== 'content' && key !== 'eligibilityDeterminedOnly') {
      handleShowDropdown(key === 'mainCategory' ? 'mainCategory' : key);
    }
  };

  useEffect(() => {
    if (!activeMobileFilter) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [activeMobileFilter]);

  const mobileSheetProps = { hideLabel: true, sheetMode: true } as const;

  const renderMobileFilterControl = (key: MobileFilterKey) => {
    switch (key) {
      case 'mainCategory':
        return (
          <MainCategoryInput
            label="Main Category"
            field="mainCategory"
            values={[]}
            placeholder="Select main category to auto-select all subcategories..."
            options={filteredMainCategoryOptions}
            showDropdown={showMainCategoryDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
            onMainCategorySelect={handleMainCategorySelect}
            {...mobileSheetProps}
          />
        );
      case 'category':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'reason':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'fileId':
        return (
          <input
            type="text"
            className="input w-full"
            placeholder="Enter file id..."
            value={filters.fileId}
            onChange={e => handleFilterChange('fileId', e.target.value)}
            autoFocus
          />
        );
      case 'language':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'tags':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'status':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'expert_examination':
        return (
          <MultiSelectInput
            label="Expert examination"
            field="expert_examination"
            values={filters.expert_examination}
            placeholder="Select expert examination result..."
            options={filteredExpertExaminationOptions}
            showDropdown={showExpertExaminationDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
            {...mobileSheetProps}
          />
        );
      case 'source':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'eligibilityDeterminedOnly':
        return (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-base-200 bg-base-100 px-4 py-4">
            <div>
              <p className="text-base font-medium">Eligible only</p>
              <p className="text-sm text-base-content/60">Show leads where eligibility is determined</p>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={filters.eligibilityDeterminedOnly}
              onChange={e => handleFilterChange('eligibilityDeterminedOnly', e.target.checked)}
            />
          </div>
        );
      case 'stage':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'topic':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'scheduler':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'manager':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'lawyer':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'expert':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'closer':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'case_handler':
        return (
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
            {...mobileSheetProps}
          />
        );
      case 'country':
        return (
          <MultiSelectInput
            label="Country"
            field="country"
            values={filters.country}
            placeholder="Type country name or choose from suggestions..."
            options={filteredCountryOptions}
            showDropdown={showCountryDropdown}
            onSelect={handleMultiSelect}
            onRemove={handleMultiRemove}
            onFilterChange={handleFilterChange}
            onShowDropdown={handleShowDropdown}
            onHideDropdown={handleHideDropdown}
            {...mobileSheetProps}
          />
        );
      case 'content':
        return (
          <input
            type="text"
            className="input w-full"
            placeholder="Search in lead content..."
            value={filters.content}
            onChange={e => handleFilterChange('content', e.target.value)}
            autoFocus
          />
        );
      default:
        return null;
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
    setShowFiltersPanel(false);
    closeMobileFilter();

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

    // Fetch countries with phone codes for phone number matching
    const countryNameToPhoneCodeMap = new Map<string, string>(); // country name -> phone_code (e.g., "+1", "+44")
    try {
      const { data: countriesData, error: countriesError } = await supabase
        .from('misc_country')
        .select('id, name, phone_code')
        .not('phone_code', 'is', null);

      if (!countriesError && countriesData) {
        countriesData.forEach((country: any) => {
          if (country.name && country.phone_code) {
            countryNameToPhoneCodeMap.set(country.name, country.phone_code);
          }
        });
        console.log('✅ Loaded country phone code mapping:', countryNameToPhoneCodeMap.size, 'countries');
      }
    } catch (error) {
      console.error('Error fetching country phone codes:', error);
    }

    // Helper function to extract country code from phone number
    const extractCountryCodeFromPhone = (phone: string | null | undefined): string | null => {
      if (!phone) return null;

      // Normalize phone: remove spaces, dashes, parentheses
      const normalized = phone.replace(/[\s\-\(\)]/g, '');

      // If phone starts with +, extract country code
      if (normalized.startsWith('+')) {
        // Check for 3-digit country codes first (e.g., +972, +351, +353)
        if (normalized.length > 4) {
          const threeDigit = normalized.substring(1, 4);
          if (/^97[0-9]$/.test(threeDigit) || /^35[0-9]$/.test(threeDigit) || /^90[0-9]$/.test(threeDigit)) {
            return `+${threeDigit}`;
          }
        }

        // Check for 2-digit country codes (e.g., +44, +61, +27, +33, +49, +39)
        if (normalized.length > 3) {
          const twoDigit = normalized.substring(1, 3);
          if (/^[2-9][0-9]$/.test(twoDigit)) {
            return `+${twoDigit}`;
          }
        }

        // US/Canada: +1
        if (normalized.startsWith('+1') && normalized.length > 2) {
          return '+1';
        }
      }

      // If phone starts with 00, extract country code (e.g., 0044, 00972)
      if (normalized.startsWith('00')) {
        // Check for 3-digit country codes (e.g., 00972)
        if (normalized.length > 5) {
          const threeDigit = normalized.substring(2, 5);
          if (/^97[0-9]$/.test(threeDigit) || /^35[0-9]$/.test(threeDigit) || /^90[0-9]$/.test(threeDigit)) {
            return `+${threeDigit}`;
          }
        }

        // Check for 2-digit country codes (e.g., 0044, 0061, 0027)
        if (normalized.length > 4) {
          const twoDigit = normalized.substring(2, 4);
          if (/^[2-9][0-9]$/.test(twoDigit)) {
            return `+${twoDigit}`;
          }
        }

        // US/Canada: 001
        if (normalized.startsWith('001') && normalized.length > 3) {
          return '+1';
        }
      }

      // If phone starts with country code without prefix (e.g., 44, 972, 1)
      // This is less reliable, but we'll try
      if (normalized.length > 2) {
        // Check for 3-digit codes
        const threeDigit = normalized.substring(0, 3);
        if (/^97[0-9]$/.test(threeDigit) || /^35[0-9]$/.test(threeDigit) || /^90[0-9]$/.test(threeDigit)) {
          return `+${threeDigit}`;
        }
      }

      if (normalized.length > 1) {
        // Check for 2-digit codes
        const twoDigit = normalized.substring(0, 2);
        if (/^[2-9][0-9]$/.test(twoDigit)) {
          return `+${twoDigit}`;
        }

        // US/Canada: 1
        if (normalized.startsWith('1') && normalized.length > 1) {
          return '+1';
        }
      }

      return null;
    };

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

    // Fetch languages for language_id filter (name -> id)
    const languageNameToIdMapping = new Map<string, number>();
    try {
      const { data: languagesData } = await supabase
        .from('misc_language')
        .select('id, name')
        .order('name');
      if (languagesData) {
        languagesData.forEach((lang: { id: number; name: string }) => {
          languageNameToIdMapping.set(lang.name, lang.id);
          if (lang.name && lang.name.toUpperCase() !== lang.name) {
            languageNameToIdMapping.set(lang.name.toUpperCase(), lang.id);
          }
        });
        console.log('✅ [Language Mapping] Created language name to ID mapping:', languageNameToIdMapping.size);
      }
    } catch (error) {
      console.error('❌ [Language Mapping] Error fetching languages:', error);
    }

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

      // Search new leads table with joins for category, source, language (no client-side mapping)
      let newLeadsQuery = supabase
        .from('leads')
        .select(`
          *,
          misc_category!fk_leads_category_id(id, name, parent_id, misc_maincategory!parent_id(id, name)),
          misc_leadsource!fk_leads_source_id(id, name),
          misc_language!fk_leads_language_id(id, name)
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
            dateOnlyQuery = dateOnlyQuery.gte('created_at', buildJerusalemStartOfDayIso(filters.fromDate));
          }
          if (filters.toDate) {
            console.log('📅 Testing toDate filter only (UTC range):', filters.toDate);
            const endOfDay = buildJerusalemEndOfDayIso(filters.toDate);
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
        newLeadsQuery = newLeadsQuery.gte('created_at', buildJerusalemStartOfDayIso(filters.fromDate));
      }
      if (filters.toDate) {
        console.log('📅 Adding toDate filter for new leads (UTC range):', filters.toDate);
        const endOfDay = buildJerusalemEndOfDayIso(filters.toDate);
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
            const raw = formattedCategoryName.trim();
            const stripped = raw.split(' (')[0].trim();
            // Some leads store category as plain text ("Poland"), others may store the formatted label ("Poland (Main)").
            // Include both to avoid missing text-only leads.
            if (stripped) categoryNames.push(stripped);
            if (raw) categoryNames.push(raw);
            console.log('⚠️ [New Leads Category Filter] No category_id found, will use category text fallback for:', formattedCategoryName);
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
          const encCategoryNames = categoryNames.map((n) => encodeURIComponent(n));
          const orConditions = [
            categoryIds.length === 1
              ? `category_id.eq.${categoryIds[0]}`
              : `category_id.in.(${categoryIds.join(',')})`,
            encCategoryNames.length === 1
              ? `category.eq.${encCategoryNames[0]}`
              : `category.in.(${encCategoryNames.join(',')})`
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
          const uniqNames = Array.from(new Set(categoryNames.map((n) => n.trim()).filter(Boolean)));
          if (uniqNames.length === 1) {
            console.log('🏷️ [New Leads Category Filter] Applying single category name filter (fallback):', categoryNames[0]);
            newLeadsQuery = newLeadsQuery.eq('category', uniqNames[0]);
          } else {
            console.log('🏷️ [New Leads Category Filter] Applying multiple category name filter (IN, fallback):', categoryNames);
            newLeadsQuery = newLeadsQuery.in('category', uniqNames);
          }
        } else {
          console.log('❌ [New Leads Category Filter] No category IDs or names found - filter will not be applied');
        }

        console.log('🏷️ [New Leads Category Filter] Category filter applied to query');
      } else {
        console.log('🏷️ [New Leads Category Filter] No category filter - filters.category is empty or null');
      }
      if (filters.language && filters.language.length > 0) {
        console.log('🌐 Adding language filter for new leads (language_id only):', filters.language);

        const hasNAFilter = filters.language.some(lang =>
          lang.toUpperCase() === 'N/A' || lang === 'N/A'
        );
        const nonNALanguages = filters.language.filter(lang =>
          lang.toUpperCase() !== 'N/A' && lang !== 'N/A'
        );

        const languageIds: number[] = [];
        nonNALanguages.forEach(lang => {
          const id = languageNameToIdMapping.get(lang) ?? languageNameToIdMapping.get(lang.toUpperCase());
          if (id != null) languageIds.push(id);
        });

        if (hasNAFilter && nonNALanguages.length === 0) {
          newLeadsQuery = newLeadsQuery.is('language_id', null);
        } else if (hasNAFilter && languageIds.length > 0) {
          const orConditions = ['language_id.is.null'];
          languageIds.forEach(id => orConditions.push(`language_id.eq.${id}`));
          newLeadsQuery = newLeadsQuery.or(orConditions.join(','));
        } else if (languageIds.length > 0) {
          if (languageIds.length === 1) {
            newLeadsQuery = newLeadsQuery.eq('language_id', languageIds[0]);
          } else {
            newLeadsQuery = newLeadsQuery.in('language_id', languageIds);
          }
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
      if (filters.source && filters.source.length > 0) {
        console.log('📡 Adding source filter for new leads:', filters.source);
        try {
          const selectedSourceNames = filters.source.map((s) => (s || '').trim()).filter(Boolean);
          const { data: srcRows, error: srcErr } = await supabase
            .from('misc_leadsource')
            .select('id, name')
            .in('name', selectedSourceNames);

          if (srcErr) throw srcErr;

          const sourceOr = buildLeadSourceOrFilterClauseFromNames(selectedSourceNames, srcRows || []);
          if (sourceOr) {
            newLeadsQuery = newLeadsQuery.or(sourceOr);
          }
        } catch (e) {
          console.log('⚠️ New leads source filter lookup failed, falling back to text `source` only:', e);
          const selectedSourceNames = filters.source.map((s) => (s || '').trim()).filter(Boolean);
          if (selectedSourceNames.length === 1) {
            newLeadsQuery = newLeadsQuery.eq('source', selectedSourceNames[0]);
          } else if (selectedSourceNames.length > 1) {
            newLeadsQuery = newLeadsQuery.in('source', selectedSourceNames);
          }
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
      if (filters.reason && filters.reason.length > 0) {
        console.log('🎯 Adding reason filter for new leads:', filters.reason);
        // For new leads, reasons are stored as text (unactivation_reason)
        if (filters.reason.length === 1) {
          newLeadsQuery = newLeadsQuery.eq('unactivation_reason', filters.reason[0]);
        } else {
          newLeadsQuery = newLeadsQuery.in('unactivation_reason', filters.reason);
        }
      }
      if (filters.fileId) {
        console.log('📁 Adding fileId filter for new leads:', filters.fileId);
        newLeadsQuery = newLeadsQuery.ilike('file_id', `%${filters.fileId}%`);
      }
      if (filters.content) {
        console.log('📝 Adding content filter for new leads:', filters.content);
        newLeadsQuery = newLeadsQuery.or(`facts.ilike.%${filters.content}%,special_notes.ilike.%${filters.content}%,general_notes.ilike.%${filters.content}%`);
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

      // Individual role filters for new leads
      // Scheduler: text field 'scheduler' (display name), no ID field
      if (filters.scheduler && filters.scheduler.length > 0) {
        applyRoleFilterForNewLeads('Scheduler', filters.scheduler, 'scheduler', null);
      }

      // Manager: ID field 'meeting_manager_id', text field 'manager' (may contain name or ID)
      if (filters.manager && filters.manager.length > 0) {
        applyRoleFilterForNewLeads('Manager', filters.manager, 'manager', 'meeting_manager_id');
      }

      // Lawyer: ID field 'meeting_lawyer_id', text field 'lawyer' (may contain name or ID)
      if (filters.lawyer && filters.lawyer.length > 0) {
        applyRoleFilterForNewLeads('Lawyer', filters.lawyer, 'lawyer', 'meeting_lawyer_id');
      }

      // Expert: ID field 'expert_id' or 'expert', text field 'expert' (may contain name or ID)
      if (filters.expert && filters.expert.length > 0) {
        applyRoleFilterForNewLeads('Expert', filters.expert, 'expert', 'expert_id');
      }

      // Closer: text field 'closer' (display name), no ID field
      if (filters.closer && filters.closer.length > 0) {
        applyRoleFilterForNewLeads('Closer', filters.closer, 'closer', null);
      }

      // Case Handler: ID field 'case_handler_id', text field 'handler' (may contain name or ID)
      if (filters.case_handler && filters.case_handler.length > 0) {
        applyRoleFilterForNewLeads('Case Handler', filters.case_handler, 'handler', 'case_handler_id');
      }
      if (filters.eligibilityDeterminedOnly) {
        console.log('✅ Adding eligibility filter for new leads');
        newLeadsQuery = newLeadsQuery.eq('eligible', true);
      }
      // Country filter for new leads: filter by country_id (database) AND phone number (client-side)
      // Note: We'll apply country_id filter to the main query, but for phone matching we need
      // to check leads that match all OTHER filters (without country_id)
      let countryIdsForFilter: number[] | null = null;
      if (filters.country && filters.country.length > 0) {
        console.log('🌍 Adding country filter for new leads:', filters.country);
        try {
          // Look up country IDs for selected country names
          const { data: countryData, error: countryError } = await supabase
            .from('misc_country')
            .select('id, name')
            .in('name', filters.country);

          if (countryError) {
            console.error('Error looking up country IDs:', countryError);
          } else if (countryData && countryData.length > 0) {
            countryIdsForFilter = countryData.map(c => c.id);
            if (countryIdsForFilter.length === 1) {
              newLeadsQuery = newLeadsQuery.eq('country_id', countryIdsForFilter[0]);
            } else {
              newLeadsQuery = newLeadsQuery.in('country_id', countryIdsForFilter);
            }
            console.log('🌍 Applied country_id filter:', countryIdsForFilter);
          } else {
            console.log('⚠️ No country IDs found for selected countries');
          }
        } catch (error) {
          console.error('Error applying country filter for new leads:', error);
        }
      }

      // Search legacy leads table with joins for language, category, source, employees
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(`
          *,
          misc_language!leads_lead_language_id_fkey(id, name),
          misc_category!leads_lead_category_id_fkey(id, name, parent_id, misc_maincategory!parent_id(id, name)),
          misc_leadsource!leads_lead_source_id_fkey(id, name),
          scheduler_employee:tenants_employee!fk_leads_lead_meeting_scheduler_id(id, display_name),
          manager_employee:tenants_employee!fk_leads_lead_meeting_manager_id(id, display_name),
          lawyer_employee:tenants_employee!fk_leads_lead_meeting_lawyer_id(id, display_name),
          expert_employee:tenants_employee!fk_leads_lead_expert_id(id, display_name),
          closer_employee:tenants_employee!fk_leads_lead_closer_id(id, display_name),
          handler_employee:tenants_employee!fk_leads_lead_case_handler_id(id, display_name),
          reason_record:misc_reason!fk_leads_lead_reason_id(name)
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
        console.log('🌐 Adding language filter for legacy leads (language_id only):', filters.language);

        const hasNAFilter = filters.language.some(lang =>
          lang.toUpperCase() === 'N/A' || lang === 'N/A'
        );
        const nonNALanguages = filters.language.filter(lang =>
          lang.toUpperCase() !== 'N/A' && lang !== 'N/A'
        );

        const legacyLanguageIds: number[] = [];
        nonNALanguages.forEach(lang => {
          const id = languageNameToIdMapping.get(lang) ?? languageNameToIdMapping.get(lang.toUpperCase());
          if (id != null) legacyLanguageIds.push(id);
        });

        if (hasNAFilter && nonNALanguages.length === 0) {
          legacyLeadsQuery = legacyLeadsQuery.is('language_id', null);
        } else if (hasNAFilter && legacyLanguageIds.length > 0) {
          const orConditions = ['language_id.is.null'];
          legacyLanguageIds.forEach(id => orConditions.push(`language_id.eq.${id}`));
          legacyLeadsQuery = legacyLeadsQuery.or(orConditions.join(','));
        } else if (legacyLanguageIds.length > 0) {
          if (legacyLanguageIds.length === 1) {
            legacyLeadsQuery = legacyLeadsQuery.eq('language_id', legacyLanguageIds[0]);
          } else {
            legacyLeadsQuery = legacyLeadsQuery.in('language_id', legacyLanguageIds);
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
      if (filters.source && filters.source.length > 0) {
        console.log('📡 Adding source filter for legacy leads:', filters.source);
        try {
          const selectedSourceNames = filters.source.map((s) => (s || '').trim()).filter(Boolean);
          const { data: srcRows, error: srcErr } = await supabase
            .from('misc_leadsource')
            .select('id, name')
            .in('name', selectedSourceNames);

          if (srcErr) throw srcErr;

          const sourceOr = buildLegacyLeadSourceIdOrFilterClauseFromNames(selectedSourceNames, srcRows || []);
          if (sourceOr) {
            legacyLeadsQuery = legacyLeadsQuery.or(sourceOr);
          } else if (selectedSourceNames.length === 1) {
            legacyLeadsQuery = legacyLeadsQuery.eq('misc_leadsource.name', selectedSourceNames[0]);
          } else if (selectedSourceNames.length > 1) {
            legacyLeadsQuery = legacyLeadsQuery.in('misc_leadsource.name', selectedSourceNames);
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
      if (filters.reason && filters.reason.length > 0) {
        console.log('🎯 Adding reason filter for legacy leads:', filters.reason);
        try {
          const legacyReasonIds: string[] = [];

          for (const reasonName of filters.reason) {
            const { data: reasonRows, error: reasonError } = await supabase
              .from('lead_stage_reasons')
              .select('legacy_id')
              .ilike('name', reasonName)
              .limit(1);

            if (reasonError) {
              console.error('Error looking up legacy_id for reason', reasonName, reasonError);
              continue;
            }

            if (reasonRows && reasonRows.length > 0) {
              const legacyId = reasonRows[0].legacy_id;
              if (legacyId !== null && legacyId !== undefined) {
                legacyReasonIds.push(String(legacyId));
              }
            }
          }

          if (legacyReasonIds.length > 0) {
            console.log('✅ Applying legacy reason_id filter with values:', legacyReasonIds);
            legacyLeadsQuery = legacyLeadsQuery.in('reason_id', legacyReasonIds);
          } else {
            console.log('⚠️ No legacy_ids found for selected reasons, skipping legacy reason filter');
          }
        } catch (error) {
          console.error('⚠️ Reason lookup failed for legacy leads, skipping reason filter:', error);
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
        legacyLeadsQuery = legacyLeadsQuery.eq('eligibile', 'true');
      }
      if (filters.expert_examination && filters.expert_examination.length > 0) {
        console.log('🧪 Adding expert_examination filter for legacy leads:', filters.expert_examination);

        const selected = filters.expert_examination as string[];
        const numericValues: number[] = [];

        for (const value of selected) {
          switch (value) {
            case 'Not Feasible':
              numericValues.push(1);
              break;
            case 'Feasible (further check)':
              numericValues.push(5);
              break;
            case 'Feasible (no check)':
              numericValues.push(8);
              break;
            case 'Not checked':
              numericValues.push(0);
              break;
          }
        }

        if (numericValues.length > 0) {
          // Apply IN filter for all selected expert_examination codes
          legacyLeadsQuery = legacyLeadsQuery.in('expert_examination', numericValues);
        }
      }
      // Note: Country filter for legacy leads is now handled by phone number matching

      // If tags filter is applied, prefetch lead IDs from leads_lead_tags
      // Use string-based sets to avoid bigint/Number precision issues
      let taggedNewLeadIds = new Set<string>();
      let taggedLegacyLeadIds = new Set<string>();

      if (filters.tags && filters.tags.length > 0) {
        try {
          console.log('🏷️ Preparing tag-based lead filters using leads_lead_tags:', filters.tags);

          // Look up tag IDs for selected tag names
          const { data: tagRows, error: tagError } = await supabase
            .from('misc_leadtag')
            .select('id, name')
            .in('name', filters.tags);

          if (tagError) throw tagError;

          const tagIds = (tagRows || [])
            .map(row => row.id)
            .filter((id): id is number => id !== null && id !== undefined);

          if (tagIds.length > 0) {
            console.log('🏷️ Found tag IDs for filter:', tagIds);

            // Fetch mapping between tags and leads from bridge table
            const { data: tagLinks, error: linkError } = await supabase
              .from('leads_lead_tags')
              .select('lead_id, newlead_id, leadtag_id')
              .in('leadtag_id', tagIds)
              .limit(10000);

            if (linkError) throw linkError;

            (tagLinks || []).forEach(link => {
              if (link.newlead_id) {
                taggedNewLeadIds.add(String(link.newlead_id));
              }
              if (link.lead_id !== null && link.lead_id !== undefined) {
                // Store legacy lead IDs as strings to avoid bigint precision issues
                taggedLegacyLeadIds.add(String(link.lead_id));
              }
            });

            console.log('🏷️ Tag-based lead sets prepared:', {
              newLeadCount: taggedNewLeadIds.size,
              legacyLeadCount: taggedLegacyLeadIds.size,
            });
          } else {
            console.log('⚠️ No tag IDs found for selected tag names, tag filter will exclude all leads.');
            // Use a special marker to indicate that no leads should match
            taggedNewLeadIds = new Set<string>(['__none__']);
            taggedLegacyLeadIds = new Set<string>(['__none__']);
          }
        } catch (error) {
          console.error('⚠️ Failed to build tag-based filters from leads_lead_tags, skipping tag filter:', error);
          taggedNewLeadIds = new Set<string>();
          taggedLegacyLeadIds = new Set<string>();
        }
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

      // Country filter for legacy leads: fetch country data from contacts AND match by phone number
      let legacyCountryMap = new Map<string, string>(); // lead_id -> country name
      if (filters.country && filters.country.length > 0) {
        try {
          console.log('🌍 Fetching country data for legacy leads from contacts...');
          // Fetch country data for all legacy leads (we'll filter client-side after mapping)
          const { data: legacyCountryResult, error: countryError } = await supabase
            .from('lead_leadcontact')
            .select(`
              lead_id,
              main,
              leads_contact (
                country_id,
                misc_country (
                  id,
                  name
                )
              )
            `)
            .eq('main', true); // Only main contacts

          if (countryError) {
            console.error('Error fetching country data for legacy leads:', countryError);
          } else if (legacyCountryResult) {
            legacyCountryResult.forEach((item: any) => {
              if (item.leads_contact && (item.leads_contact as any).misc_country) {
                const leadId = String(item.lead_id);
                const countryName = ((item.leads_contact as any).misc_country as any).name;
                if (countryName) {
                  legacyCountryMap.set(leadId, countryName);
                }
              }
            });
            console.log('🌍 Loaded country data for', legacyCountryMap.size, 'legacy leads');
          }
        } catch (error) {
          console.error('Error fetching country data for legacy leads:', error);
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

      // Debug role filters separately
      if (filters.scheduler?.length > 0 || filters.manager?.length > 0 || filters.lawyer?.length > 0 ||
        filters.expert?.length > 0 || filters.closer?.length > 0 || filters.case_handler?.length > 0) {
        console.log('👥 [Query Results] Role filter matching summary:', {
          schedulerFilter: filters.scheduler,
          managerFilter: filters.manager,
          lawyerFilter: filters.lawyer,
          expertFilter: filters.expert,
          closerFilter: filters.closer,
          caseHandlerFilter: filters.case_handler,
          newLeadsMatchingScheduler: newLeadsResult.data?.filter((lead: any) =>
            filters.scheduler?.includes(lead.scheduler) ||
            (lead.meeting_scheduler_id && filters.scheduler?.some(name => nameToIdMapping.get(name) === lead.meeting_scheduler_id))
          ).length || 0,
          newLeadsMatchingManager: newLeadsResult.data?.filter((lead: any) =>
            filters.manager?.includes(lead.manager) ||
            (lead.meeting_manager_id && filters.manager?.some(name => nameToIdMapping.get(name) === lead.meeting_manager_id))
          ).length || 0,
          newLeadsMatchingLawyer: newLeadsResult.data?.filter((lead: any) =>
            filters.lawyer?.includes(lead.lawyer) ||
            (lead.meeting_lawyer_id && filters.lawyer?.some(name => nameToIdMapping.get(name) === lead.meeting_lawyer_id))
          ).length || 0,
          newLeadsMatchingExpert: newLeadsResult.data?.filter((lead: any) =>
            filters.expert?.includes(lead.expert) ||
            (lead.expert_id && filters.expert?.some(name => nameToIdMapping.get(name) === lead.expert_id))
          ).length || 0,
          newLeadsMatchingCloser: newLeadsResult.data?.filter((lead: any) =>
            filters.closer?.includes(lead.closer)
          ).length || 0,
          newLeadsMatchingCaseHandler: newLeadsResult.data?.filter((lead: any) =>
            filters.case_handler?.includes(lead.handler) ||
            (lead.case_handler_id && filters.case_handler?.some(name => nameToIdMapping.get(name) === lead.case_handler_id))
          ).length || 0
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

      // If filtering for N/A only, filter out leads with non-null language_id (safety; server already filters)
      const hasNAFilterOnly = filters.language &&
        filters.language.length === 1 &&
        (filters.language[0].toUpperCase() === 'N/A' || filters.language[0] === 'N/A') &&
        filters.language.every(lang => lang.toUpperCase() === 'N/A' || lang === 'N/A');

      let filteredNewLeads = newLeadsResult.data || [];
      if (hasNAFilterOnly) {
        console.log('🌐 Applying client-side N/A filter to new leads (language_id only)');
        filteredNewLeads = filteredNewLeads.filter(lead => lead.language_id === null || lead.language_id === undefined);
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

      // Apply country filter to new leads: combine country_id (already filtered) with phone number matching
      if (filters.country && filters.country.length > 0) {
        console.log('🌍 Applying combined country filter (country_id + phone) to new leads:', filters.country);
        const selectedPhoneCodes = new Set<string>();
        filters.country.forEach((countryName: string) => {
          const phoneCode = countryNameToPhoneCodeMap.get(countryName);
          if (phoneCode) {
            // Normalize phone code to include + prefix (extractCountryCodeFromPhone returns codes with +)
            const normalizedCode = phoneCode.startsWith('+') ? phoneCode : `+${phoneCode}`;
            selectedPhoneCodes.add(normalizedCode);
          }
        });
        console.log('🌍 Selected phone codes:', Array.from(selectedPhoneCodes));

        const beforeCountryFilter = filteredNewLeads.length;

        // Filter: include leads that match by country_id OR by phone number
        filteredNewLeads = filteredNewLeads.filter((lead: any) => {
          // Method 1: Check if lead matches by country_id (already filtered by database query)
          // Since we already filtered by country_id in the query, all leads here match by country_id
          // But we'll also check explicitly to be safe
          const matchesCountryId = lead.country_id && filters.country.some((countryName: string) => {
            // We can't easily check country_id here without a reverse mapping, so we'll rely on the query filter
            // and just check phone numbers as additional matches
            return false; // Skip this check, rely on query filter
          });

          // Method 2: Check if lead matches by phone number country code
          const phoneCountryCode = extractCountryCodeFromPhone(lead.phone);
          if (phoneCountryCode && selectedPhoneCodes.has(phoneCountryCode)) {
            console.log(`✅ New lead phone match: ${lead.phone} → ${phoneCountryCode}`);
            return true;
          }

          // Method 3: Check if lead matches by mobile number country code
          const mobileCountryCode = extractCountryCodeFromPhone(lead.mobile);
          if (mobileCountryCode && selectedPhoneCodes.has(mobileCountryCode)) {
            console.log(`✅ New lead mobile match: ${lead.mobile} → ${mobileCountryCode}`);
            return true;
          }

          // If we reach here, the lead was already filtered by country_id in the query
          // So we include it (it matches by country_id)
          return true;
        });

        // Now we need to also fetch new leads (with all OTHER filters but WITHOUT country_id filter) to find phone matches
        // and combine them with the country_id matches
        try {
          // Execute the main query first to get leads matching country_id
          // Then we'll fetch leads matching all OTHER filters (without country_id) and filter by phone
          // The simplest approach: execute newLeadsQuery first, then build a query without country_id
          
          // Build a query with all filters EXCEPT country_id by rebuilding it
          // We need to apply all the same filters but skip the country_id filter
          let phoneCheckQuery = supabase
            .from('leads')
            .select(`
              *,
              misc_category!fk_leads_category_id(id, name, parent_id, misc_maincategory!parent_id(id, name)),
              misc_leadsource!fk_leads_source_id(id, name),
              misc_language!fk_leads_language_id(id, name)
            `);

          // Apply all the same filters as newLeadsQuery, but skip country_id
          // Date filters
          if (filters.fromDate) {
            phoneCheckQuery = phoneCheckQuery.gte('created_at', buildJerusalemStartOfDayIso(filters.fromDate));
          }
          if (filters.toDate) {
            phoneCheckQuery = phoneCheckQuery.lte('created_at', buildJerusalemEndOfDayIso(filters.toDate));
          }
          // Category filter
          if (filters.category && filters.category.length > 0) {
            const categoryIds: number[] = [];
            const categoryNames: string[] = [];
            for (const formattedCategoryName of filters.category) {
              const categoryId = categoryNameToIdMapping.get(formattedCategoryName);
              if (categoryId !== undefined) {
                categoryIds.push(categoryId);
              } else {
                const raw = formattedCategoryName.trim();
                const stripped = raw.split(' (')[0].trim();
                if (stripped) categoryNames.push(stripped);
                if (raw) categoryNames.push(raw);
              }
            }
            if (categoryIds.length > 0 && categoryNames.length > 0) {
              const encCategoryNames = categoryNames.map((n) => encodeURIComponent(n));
              const orConditions = [
                categoryIds.length === 1 ? `category_id.eq.${categoryIds[0]}` : `category_id.in.(${categoryIds.join(',')})`,
                encCategoryNames.length === 1 ? `category.eq.${encCategoryNames[0]}` : `category.in.(${encCategoryNames.join(',')})`
              ];
              phoneCheckQuery = phoneCheckQuery.or(orConditions.join(','));
            } else if (categoryIds.length > 0) {
              if (categoryIds.length === 1) {
                phoneCheckQuery = phoneCheckQuery.eq('category_id', categoryIds[0]);
              } else {
                phoneCheckQuery = phoneCheckQuery.in('category_id', categoryIds);
              }
            } else if (categoryNames.length > 0) {
              const uniqNames = Array.from(new Set(categoryNames.map((n) => n.trim()).filter(Boolean)));
              if (uniqNames.length === 1) {
                phoneCheckQuery = phoneCheckQuery.eq('category', uniqNames[0]);
              } else {
                phoneCheckQuery = phoneCheckQuery.in('category', uniqNames);
              }
            }
          }
          // Language filter (language_id only)
          if (filters.language && filters.language.length > 0) {
            const hasNAFilter = filters.language.some(lang => lang.toUpperCase() === 'N/A' || lang === 'N/A');
            const nonNALanguages = filters.language.filter(lang => lang.toUpperCase() !== 'N/A' && lang !== 'N/A');
            const phoneLangIds: number[] = [];
            nonNALanguages.forEach(lang => {
              const id = languageNameToIdMapping.get(lang) ?? languageNameToIdMapping.get(lang.toUpperCase());
              if (id != null) phoneLangIds.push(id);
            });
            if (hasNAFilter && nonNALanguages.length === 0) {
              phoneCheckQuery = phoneCheckQuery.is('language_id', null);
            } else if (hasNAFilter && phoneLangIds.length > 0) {
              const orConditions = ['language_id.is.null'];
              phoneLangIds.forEach(id => orConditions.push(`language_id.eq.${id}`));
              phoneCheckQuery = phoneCheckQuery.or(orConditions.join(','));
            } else if (phoneLangIds.length > 0) {
              if (phoneLangIds.length === 1) {
                phoneCheckQuery = phoneCheckQuery.eq('language_id', phoneLangIds[0]);
              } else {
                phoneCheckQuery = phoneCheckQuery.in('language_id', phoneLangIds);
              }
            }
          }
          // Status filter
          if (filters.status && filters.status.length > 0) {
            const includeActive = filters.status.includes('Active');
            const includeInactive = filters.status.includes('Not active');
            if (includeActive && !includeInactive) {
              phoneCheckQuery = phoneCheckQuery.is('unactivated_at', null);
            } else if (!includeActive && includeInactive) {
              phoneCheckQuery = phoneCheckQuery.not('unactivated_at', 'is', null);
            }
          }
          // Stage filter
          if (filters.stage && filters.stage.length > 0) {
            const stageIds: number[] = [];
            for (const stage of filters.stage) {
              const trimmedStage = stage.trim();
              if (trimmedStage.toLowerCase() === 'created') {
                stageIds.push(0);
                continue;
              }
              let stageLookup = await supabase
                .from('lead_stages')
                .select('id')
                .ilike('name', trimmedStage)
                .limit(1);
              if (!stageLookup.data || stageLookup.data.length === 0) {
                stageLookup = await supabase
                  .from('lead_stages')
                  .select('id')
                  .ilike('name', `%${trimmedStage}%`)
                  .limit(1);
              }
              if (stageLookup.data && stageLookup.data.length > 0) {
                const stageId = stageLookup.data[0].id;
                const numericStageId = typeof stageId === 'number' ? stageId : parseInt(String(stageId), 10);
                if (!isNaN(numericStageId)) {
                  stageIds.push(numericStageId);
                }
              }
            }
            if (stageIds.length > 0) {
              phoneCheckQuery = phoneCheckQuery.in('stage', stageIds);
            }
          }
          // Source filter
          if (filters.source && filters.source.length > 0) {
            try {
              const selectedSourceNames = filters.source.map((s) => (s || '').trim()).filter(Boolean);
              const { data: srcRows, error: srcErr } = await supabase
                .from('misc_leadsource')
                .select('id, name')
                .in('name', selectedSourceNames);

              if (srcErr) throw srcErr;

              const sourceOr = buildLeadSourceOrFilterClauseFromNames(selectedSourceNames, srcRows || []);
              if (sourceOr) {
                phoneCheckQuery = phoneCheckQuery.or(sourceOr);
              }
            } catch (e) {
              console.log('⚠️ Phone-check source filter lookup failed, falling back to text `source` only:', e);
              const selectedSourceNames = filters.source.map((s) => (s || '').trim()).filter(Boolean);
              if (selectedSourceNames.length === 1) {
                phoneCheckQuery = phoneCheckQuery.eq('source', selectedSourceNames[0]);
              } else if (selectedSourceNames.length > 1) {
                phoneCheckQuery = phoneCheckQuery.in('source', selectedSourceNames);
              }
            }
          }
          // Topic filter
          if (filters.topic && filters.topic.length > 0) {
            if (filters.topic.length === 1) {
              phoneCheckQuery = phoneCheckQuery.eq('topic', filters.topic[0]);
            } else {
              phoneCheckQuery = phoneCheckQuery.in('topic', filters.topic);
            }
          }
          // Reason filter
          if (filters.reason && filters.reason.length > 0) {
            if (filters.reason.length === 1) {
              phoneCheckQuery = phoneCheckQuery.eq('unactivation_reason', filters.reason[0]);
            } else {
              phoneCheckQuery = phoneCheckQuery.in('unactivation_reason', filters.reason);
            }
          }
          // FileId filter
          if (filters.fileId) {
            phoneCheckQuery = phoneCheckQuery.ilike('file_id', `%${filters.fileId}%`);
          }
          // Content filter
          if (filters.content) {
            phoneCheckQuery = phoneCheckQuery.or(`facts.ilike.%${filters.content}%,special_notes.ilike.%${filters.content}%,general_notes.ilike.%${filters.content}%`);
          }
          // Role filters (using the same helper function logic)
          const applyRoleFilterToPhoneQuery = (roleName: string, filterValues: string[], textField: string | null, idField: string | null) => {
            if (!filterValues || filterValues.length === 0) return;
            const employeeIds: number[] = [];
            const unmatchedNames: string[] = [];
            for (const filterValue of filterValues) {
              const numericId = parseInt(filterValue, 10);
              if (!isNaN(numericId)) {
                employeeIds.push(numericId);
              } else {
                const employeeId = nameToIdMapping.get(filterValue);
                if (employeeId !== undefined) {
                  employeeIds.push(employeeId);
                } else {
                  unmatchedNames.push(filterValue);
                }
              }
            }
            const orConditions: string[] = [];
            if (employeeIds.length > 0 && idField) {
              if (employeeIds.length === 1) {
                orConditions.push(`${idField}.eq.${employeeIds[0]}`);
              } else {
                orConditions.push(`${idField}.in.(${employeeIds.join(',')})`);
              }
            }
            if (unmatchedNames.length > 0 && textField) {
              if (unmatchedNames.length === 1) {
                orConditions.push(`${textField}.eq.${unmatchedNames[0]}`);
              } else {
                orConditions.push(`${textField}.in.(${unmatchedNames.join(',')})`);
              }
            }
            if (textField && filterValues.length > 0) {
              if (filterValues.length === 1) {
                orConditions.push(`${textField}.eq.${filterValues[0]}`);
              } else {
                orConditions.push(`${textField}.in.(${filterValues.join(',')})`);
              }
            }
            if (orConditions.length > 0) {
              if (orConditions.length === 1) {
                const condition = orConditions[0];
                if (condition.includes('.eq.')) {
                  const [field, value] = condition.split('.eq.');
                  phoneCheckQuery = phoneCheckQuery.eq(field, value);
                } else if (condition.includes('.in.')) {
                  const [field, values] = condition.split('.in.');
                  const valueArray = values.replace(/[()]/g, '').split(',');
                  phoneCheckQuery = phoneCheckQuery.in(field, valueArray);
                }
              } else {
                phoneCheckQuery = phoneCheckQuery.or(orConditions.join(','));
              }
            }
          };
          if (filters.scheduler && filters.scheduler.length > 0) {
            applyRoleFilterToPhoneQuery('Scheduler', filters.scheduler, 'scheduler', null);
          }
          if (filters.manager && filters.manager.length > 0) {
            applyRoleFilterToPhoneQuery('Manager', filters.manager, 'manager', 'meeting_manager_id');
          }
          if (filters.lawyer && filters.lawyer.length > 0) {
            applyRoleFilterToPhoneQuery('Lawyer', filters.lawyer, 'lawyer', 'meeting_lawyer_id');
          }
          if (filters.expert && filters.expert.length > 0) {
            applyRoleFilterToPhoneQuery('Expert', filters.expert, 'expert', 'expert_id');
          }
          if (filters.closer && filters.closer.length > 0) {
            applyRoleFilterToPhoneQuery('Closer', filters.closer, 'closer', null);
          }
          if (filters.case_handler && filters.case_handler.length > 0) {
            applyRoleFilterToPhoneQuery('Case Handler', filters.case_handler, 'handler', 'case_handler_id');
          }
          // Eligibility filter
          if (filters.eligibilityDeterminedOnly) {
            phoneCheckQuery = phoneCheckQuery.eq('eligible', true);
          }
          // NOTE: We intentionally skip country_id filter here
          
          // Fetch new leads with all filters EXCEPT country_id to check for phone number matches
          const { data: filteredLeadsForPhoneCheck, error: filteredLeadsError } = await phoneCheckQuery
            .limit(10000);

          if (!filteredLeadsError && filteredLeadsForPhoneCheck) {
            // Find leads that match by phone but might not match by country_id
            const phoneMatchedLeadIds = new Set<string>();
            filteredLeadsForPhoneCheck.forEach((lead: any) => {
              const phoneCountryCode = extractCountryCodeFromPhone(lead.phone);
              const mobileCountryCode = extractCountryCodeFromPhone(lead.mobile);

              if ((phoneCountryCode && selectedPhoneCodes.has(phoneCountryCode)) ||
                (mobileCountryCode && selectedPhoneCodes.has(mobileCountryCode))) {
                phoneMatchedLeadIds.add(lead.id?.toString());
              }
            });

            // Get IDs of leads already in filteredNewLeads (matched by country_id)
            const countryIdMatchedLeadIds = new Set(
              filteredNewLeads.map((lead: any) => lead.id?.toString()).filter(Boolean)
            );

            // Combine: include all leads that match by country_id OR by phone
            const allMatchedLeadIds = new Set([...countryIdMatchedLeadIds, ...phoneMatchedLeadIds]);

            // Re-fetch full lead data for phone-matched leads that aren't already included
            if (phoneMatchedLeadIds.size > 0) {
              const phoneOnlyLeadIds = Array.from(phoneMatchedLeadIds).filter(id => !countryIdMatchedLeadIds.has(id));
              if (phoneOnlyLeadIds.length > 0) {
                const { data: phoneMatchedLeads, error: phoneLeadsError } = await supabase
                  .from('leads')
                  .select(`
                    *,
                    misc_category!category_id(
                      id,
                      name,
                      parent_id,
                      misc_maincategory!parent_id(id, name)
                    )
                  `)
                  .in('id', phoneOnlyLeadIds);

                if (!phoneLeadsError && phoneMatchedLeads) {
                  // Add phone-matched leads to filteredNewLeads
                  filteredNewLeads = [...filteredNewLeads, ...phoneMatchedLeads];
                }
              }
            }

            console.log(`🌍 Combined country filter (country_id + phone) for new leads: ${beforeCountryFilter} → ${filteredNewLeads.length}`, {
              countryIdMatches: countryIdMatchedLeadIds.size,
              phoneMatches: phoneMatchedLeadIds.size,
              totalMatches: allMatchedLeadIds.size,
              filteredLeadsForPhoneCheck: filteredLeadsForPhoneCheck.length
            });
          }
        } catch (error) {
          console.error('Error fetching additional leads for phone-based country filter:', error);
        }
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

        const leadAny = lead as any;
        return {
          ...lead,
          lead_type: 'new',
          display_lead_number: String(displayLeadNumber),
          category: formatCategoryDisplay(lead),
          source: leadAny.misc_leadsource?.name ?? lead.source,
          language: getLeadLanguageDisplay(leadAny.misc_language?.name ?? lead.language),
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

      // Create source, stage, category, language, and employee mapping for legacy leads
      const sourceMapping = new Map<number, string>();
      const stageMapping = new Map<number, string>();
      const categoryMapping = new Map<number, string>();
      const languageIdToName = new Map<number, string>();

      try {
        const [sourcesResult, stagesResult, categoriesResult, languagesResult, employeesResult] = await Promise.all([
          supabase.from('misc_leadsource').select('id, name'),
          supabase.from('lead_stages').select('id, name'),
          supabase.from('misc_category').select('id, name, parent_id, misc_maincategory!parent_id(id, name)'),
          supabase.from('misc_language').select('id, name'),
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

        if (languagesResult.data) {
          languagesResult.data.forEach((lang: { id: number; name: string }) => {
            languageIdToName.set(lang.id, lang.name);
          });
          console.log('✅ Loaded language mapping:', languageIdToName.size, 'languages');
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

      const fromJoin = (rel: any) => {
        const r = Array.isArray(rel) ? rel[0] : rel;
        const name = r?.display_name ?? r?.name;
        return name && String(name).trim() ? String(name).trim() : null;
      };
      const categoryFromJoin = (lead: any) => {
        const cat = lead.misc_category;
        if (!cat) return null;
        const mainRel = Array.isArray(cat.misc_maincategory) ? cat.misc_maincategory[0] : cat.misc_maincategory;
        const mainName = mainRel?.name;
        return mainName ? `${cat.name} (${mainName})` : cat.name;
      };
      const languageFromJoinOrMap = (lead: any) => {
        const ml = lead.misc_language;
        const fromJoin = Array.isArray(ml) ? ml[0]?.name : ml?.name;
        if (fromJoin && String(fromJoin).trim()) return getLeadLanguageDisplay(String(fromJoin).trim());
        const lid = lead.language_id;
        if (lid != null && languageIdToName.has(Number(lid))) {
          return getLeadLanguageDisplay(languageIdToName.get(Number(lid)) ?? null);
        }
        const text = lead.language;
        if (text != null && String(text).trim()) return getLeadLanguageDisplay(String(text).trim());
        return null;
      };

      // Map legacy leads to match new leads format using joined data when present
      let mappedLegacyLeads = filteredLegacyLeads.map(legacyLead => {
        const leadAny = legacyLead as any;
        const sourceName = fromJoin(leadAny.misc_leadsource) ??
          (legacyLead.source_id ? sourceMapping.get(legacyLead.source_id) : null) ??
          legacyLead.source_external_id ?? 'Unknown';

        const categoryName = categoryFromJoin(leadAny) ??
          (legacyLead.category_id ? categoryMapping.get(legacyLead.category_id) : null) ??
          legacyLead.category ?? 'No Category';

        const getEmployeeName = (empId: number | null, joinRel: any) => {
          const fromJoinName = fromJoin(joinRel);
          if (fromJoinName) return fromJoinName;
          if (!empId) return null;
          return idToNameMapping.get(empId) || null;
        };

        const roles = {
          scheduler: getEmployeeName(legacyLead.meeting_scheduler_id, leadAny.scheduler_employee),
          manager: getEmployeeName(legacyLead.meeting_manager_id, leadAny.manager_employee),
          lawyer: getEmployeeName(legacyLead.meeting_lawyer_id, leadAny.lawyer_employee),
          expert: getEmployeeName(legacyLead.expert_id, leadAny.expert_employee),
          closer: getEmployeeName(legacyLead.closer_id, leadAny.closer_employee),
          case_handler: getEmployeeName(legacyLead.case_handler_id, leadAny.handler_employee),
        };

        // Format lead number with sublead handling (same logic as MasterLeadPage formatLegacyLeadNumber)
        let displayLeadNumber: string;
        const legacyLeadAny = legacyLead as any;
        const masterId = legacyLeadAny.master_id;
        const leadId = String(legacyLead.id);

        if (masterId && String(masterId).trim() !== '') {
          // It's a sublead - format as masterId/suffix (same as MasterLeadPage)
          const leadKey = legacyLead.id?.toString();
          const suffix = leadKey ? legacySubLeadSuffixMap.get(leadKey) : undefined;

          if (suffix !== undefined) {
            // Use calculated suffix (starts at 2 for first sublead)
            displayLeadNumber = `${masterId}/${suffix}`;
          } else {
            // Fallback if suffix not found
            displayLeadNumber = `${masterId}/?`;
          }
        } else {
          // It's a master lead or standalone lead
          // Check if this lead has subleads
          const leadIdStr = legacyLead.id?.toString();
          const hasSubLeads = leadIdStr && legacyMasterIdsWithSubLeads.has(leadIdStr);

          // Use leadId (numeric ID) as base, add /1 if has subleads (same as MasterLeadPage)
          displayLeadNumber = hasSubLeads ? `${leadId}/1` : leadId;
        }

        // Add "C" prefix for legacy leads with stage "100" (Success) - same as MasterLeadPage
        if (legacyLead.stage === 100 || legacyLead.stage === '100') {
          displayLeadNumber = `C${displayLeadNumber}`;
        }

        return {
          // Basic Info
          id: legacyLead.id,
          lead_number: legacyLead.lead_number || legacyLead.id.toString(),
          display_lead_number: String(displayLeadNumber),
          manual_id: legacyLead.manual_id || null,
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
          language: languageFromJoinOrMap(leadAny),
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
          unactivation_reason: legacyLead.unactivation_reason ?? (legacyLead.reason_record?.name ?? (Array.isArray(legacyLead.reason_record) ? legacyLead.reason_record[0]?.name : null)) ?? null,

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
          client_country: legacyCountryMap.get(String(legacyLead.id)) || null, // Get country from contact mapping
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

      // Apply tag-based filters using leads_lead_tags mapping (if present)
      if (filters.tags && filters.tags.length > 0) {
        console.log('🏷️ Applying tag-based filtering to mapped leads...');

        if (taggedNewLeadIds.size > 0) {
          const beforeTagFilter = mappedNewLeads.length;
          mappedNewLeads = mappedNewLeads.filter(lead => taggedNewLeadIds.has(String(lead.id)));
          console.log(`🏷️ Tag filter for new leads: ${beforeTagFilter} → ${mappedNewLeads.length}`);
        } else {
          console.log('🏷️ No tagged new leads found, filtering out all new leads for tag filter.');
          mappedNewLeads = [];
        }

        if (taggedLegacyLeadIds.size > 0) {
          const beforeTagFilter = mappedLegacyLeads.length;
          const debugLeadBeforeTags = mappedLegacyLeads.find((lead: any) => lead.id === debugLeadId);
          mappedLegacyLeads = mappedLegacyLeads.filter(lead => taggedLegacyLeadIds.has(String(lead.id)));
          const debugLeadAfterTags = mappedLegacyLeads.find((lead: any) => lead.id === debugLeadId);
          console.log(`🏷️ Tag filter for legacy leads: ${beforeTagFilter} → ${mappedLegacyLeads.length}`);
          if (debugLeadBeforeTags && !debugLeadAfterTags) {
            console.log(`🔍 DEBUG Lead ${debugLeadId}: Filtered out by tag filter. Tagged legacy lead IDs include 174503:`, taggedLegacyLeadIds.has(String(debugLeadId)));
          }
        } else {
          console.log('🏷️ No tagged legacy leads found, filtering out all legacy leads for tag filter.');
          const debugLeadBeforeTags = mappedLegacyLeads.find((lead: any) => lead.id === debugLeadId);
          if (debugLeadBeforeTags) {
            console.log(`🔍 DEBUG Lead ${debugLeadId}: Filtered out because no tagged leads found (tag filter active but lead not tagged)`);
          }
          mappedLegacyLeads = [];
        }
      }

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

      // Apply country filter for legacy leads: combine contact country (client_country) with phone number matching
      if (filters.country && filters.country.length > 0) {
        console.log('🌍 Applying combined country filter (contact + phone) to mapped legacy leads...');
        const selectedPhoneCodes = new Set<string>();
        filters.country.forEach((countryName: string) => {
          const phoneCode = countryNameToPhoneCodeMap.get(countryName);
          if (phoneCode) {
            // Normalize phone code to include + prefix (extractCountryCodeFromPhone returns codes with +)
            const normalizedCode = phoneCode.startsWith('+') ? phoneCode : `+${phoneCode}`;
            selectedPhoneCodes.add(normalizedCode);
          }
        });
        console.log('🌍 Selected phone codes for legacy leads:', Array.from(selectedPhoneCodes));

        const beforeCountryFilter = mappedLegacyLeads.length;
        mappedLegacyLeads = mappedLegacyLeads.filter((lead: any) => {
          // Method 1: Check if lead matches by contact country (from legacyCountryMap)
          const leadId = String(lead.id);
          const leadCountry = legacyCountryMap.get(leadId);
          if (leadCountry && filters.country.includes(leadCountry)) {
            return true;
          }

          // Method 2: Check if lead matches by phone number country code
          const phoneCountryCode = extractCountryCodeFromPhone(lead.phone);
          if (phoneCountryCode && selectedPhoneCodes.has(phoneCountryCode)) {
            console.log(`✅ Legacy phone match: ${lead.phone} → ${phoneCountryCode}`);
            return true;
          }

          // Method 3: Check if lead matches by mobile number country code
          const mobileCountryCode = extractCountryCodeFromPhone(lead.mobile);
          if (mobileCountryCode && selectedPhoneCodes.has(mobileCountryCode)) {
            console.log(`✅ Legacy mobile match: ${lead.mobile} → ${mobileCountryCode}`);
            return true;
          }

          return false;
        });
        console.log(`🌍 Combined country filter (contact + phone) for legacy leads: ${beforeCountryFilter} → ${mappedLegacyLeads.length}`);
      }
      // Country filter for legacy leads is now handled by phone number matching (see above)

      console.log('📊 Final mapping results:', {
        newLeadsCount: mappedNewLeads.length,
        legacyLeadsCount: mappedLegacyLeads.length,
        newLeads: mappedNewLeads,
        legacyLeads: mappedLegacyLeads
      });

      // Combine results and sort by creation date
      const allResults = [
        ...mappedNewLeads,
        ...mappedLegacyLeads,
      ]
        .filter((lead) => timestampInCalendarRange(lead.created_at, filters.fromDate, filters.toDate))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      console.log('🎯 Final combined results:', {
        totalCount: allResults.length,
        results: allResults
      });

      scrollToResultsAfterSearchRef.current = true;
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
    if (!stage && stage !== 0) {
      return (
        <span className="badge stage-badge rounded-full shrink-0 border-0 text-xs px-2.5 py-0.5 max-w-full bg-gray-100 text-gray-600">
          No Stage
        </span>
      );
    }

    const stageStr = String(stage);
    const stageName = getStageName(stageStr);
    const stageColour = getStageColour(stageStr);
    const softBadgeStyle = getSoftStageBadgeStyle(stageColour, stageStr);

    return <span
      className="badge stage-badge rounded-full shrink-0 border-0 hover:opacity-90 transition-opacity duration-200 text-xs px-2.5 py-0.5 max-w-full"
      style={{
        backgroundColor: softBadgeStyle.backgroundColor,
        color: softBadgeStyle.color,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'inline-block',
      }}
      title={stageName}
    >
      {stageName}
    </span>;
  };

  const renderResultCard = (lead: Lead) => {
    const anyLead = lead as any;

    // Legacy lead highlighting: status 10 = Not active
    // Check if status exists (not null/undefined) and equals 10 (as number or string)
    const isLegacyInactive =
      anyLead.lead_type === 'legacy' && 
      anyLead.status != null && 
      (Number(anyLead.status) === 10 || anyLead.status === '10');

    // New lead highlighting: unactivated_at IS NOT NULL = Not active
    const isNewInactive =
      anyLead.lead_type === 'new' && anyLead.unactivated_at !== null && anyLead.unactivated_at !== undefined;

    const isInactive = isLegacyInactive || isNewInactive;

    const cardClasses = [
      'w-full',
      'max-w-full',
      'rounded-2xl',
      'shadow-[0_2px_10px_rgba(0,0,0,0.06)]',
      'hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)]',
      'md:hover:-translate-y-0.5',
      'transition-all',
      'duration-300',
      'ease-out',
      'cursor-pointer',
      'group',
      isInactive ? 'bg-gray-100 border-0' : 'bg-white border border-gray-100',
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

    const countryDisplay = getLeadCountryDisplay(anyLead, displayCategory);
    const leadNumber = (lead as any).display_lead_number || lead.lead_number || lead.id;

    return (
      <div
        key={lead.id}
        className={cardClasses}
        onClick={(e) => {
          handleLeadClick(lead, e);
        }}
      >
        <div className="relative p-4 md:p-5">
          <div className="absolute top-3 right-3 z-20">
            <LeadSearchCardActions
              lead={lead}
              isOpen={openCardMenuLeadId === String(lead.id)}
              onOpenChange={(open) => setOpenCardMenuLeadId(open ? String(lead.id) : null)}
              onViewFacts={(l) => void openFactsModal(l)}
              onViewRoles={(l) => setRolesModalLead(l)}
            />
          </div>
          <div className="mb-4 flex items-start justify-between gap-2 pr-11">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-gray-900 leading-snug line-clamp-2 group-hover:text-[#6d28d9] transition-colors">
                {lead.name}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500 font-mono font-medium">
                #{leadNumber}
              </p>
            </div>
            <div
              className={`shrink-0 max-w-[42%] ${isInactive ? '[&_.stage-badge]:!border-0 [&_.stage-badge]:!bg-gray-200 [&_.stage-badge]:![color:black]' : ''}`}
            >
              {getStageBadge(lead.stage)}
            </div>
          </div>

          <div className="mb-4 flex min-w-0 items-center gap-2">
            <DocumentTextIcon className="h-4 w-4 shrink-0 text-violet-600/80" aria-hidden />
            <span className="truncate text-sm font-medium text-violet-700 leading-relaxed">
              {lead.topic || 'No topic specified'}
            </span>
          </div>

          <div
            className="relative rounded-xl px-3.5 py-3 bg-gray-50"
          >
            <div
              className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-gray-300/80"
              aria-hidden
            />
            <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 text-sm text-gray-700">
              <div className="flex min-w-0 items-center gap-2.5" title="Date Created">
                <CalendarIcon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                <span className="truncate">
                  {new Date(lead.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-2.5 min-w-0" title="Country">
                <GlobeAltIcon className="h-4 w-4 text-gray-500 shrink-0" aria-hidden />
                <span className="truncate">{countryDisplay}</span>
              </div>
              <div className="flex items-center gap-2.5 min-w-0" title="Source">
                <BoltIcon className="h-4 w-4 text-gray-500 shrink-0" aria-hidden />
                <span className="truncate">{lead.source || 'N/A'}</span>
              </div>
              <div className="flex items-center gap-2.5 min-w-0" title="Language">
                <LanguageIcon className="h-4 w-4 text-gray-500 shrink-0" aria-hidden />
                <span className="truncate">{getLeadLanguageDisplay(lead.language)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-full pt-4 pb-6 px-1.5 sm:px-4 md:px-8 md:py-8 min-w-0 bg-gray-100 dark:bg-base-300 min-h-full">
      {/* Quick search + view toolbar — bottom-right */}
      <div
        className="fixed right-3 md:right-8 z-[35] bottom-[max(4.5rem,calc(3.75rem+env(safe-area-inset-bottom,0px)+0.5rem))] md:bottom-8"
        role="toolbar"
        aria-label="Lead search quick filters"
      >
        {/* Mobile: collapsed FAB by default; panel expands above it */}
        <div className="md:hidden flex flex-col items-end gap-2 pointer-events-auto">
          {mobileQuickBarOpen && (
            <div className="flex w-[min(calc(100vw-1.5rem),17.5rem)] flex-col items-stretch gap-2">
              <div className="rounded-2xl border border-base-200/80 bg-base-100/95 px-3.5 py-3 shadow-lg backdrop-blur-md dark:border-base-content/12 dark:bg-base-300/90">
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-base-content/55">Date range</p>
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-base-content/70">From</span>
                    <input
                      type="date"
                      className="input input-bordered h-12 min-h-[48px] w-full text-base"
                      value={filters.fromDate}
                      onChange={e => handleFilterChange('fromDate', e.target.value)}
                      title="From date"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-base-content/70">To</span>
                    <input
                      type="date"
                      className="input input-bordered h-12 min-h-[48px] w-full text-base"
                      value={filters.toDate}
                      onChange={e => handleFilterChange('toDate', e.target.value)}
                      title="To date"
                    />
                  </label>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 rounded-2xl border border-base-200/80 bg-base-100/95 px-3 py-2.5 shadow-lg backdrop-blur-md dark:border-base-content/12 dark:bg-base-300/90">
                {searchPerformed && (
                  <button
                    type="button"
                    className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      showFiltersPanel
                        ? (isAltTheme ? 'border-[#505d57] bg-[#505d57] text-white' : 'border-primary bg-primary text-primary-content')
                        : 'border-base-300/60 bg-base-100 text-base-content/70 hover:bg-base-200/80'
                    }`}
                    onClick={() => setShowFiltersPanel(v => !v)}
                    title={showFiltersPanel ? 'Hide filters' : 'Show filters'}
                    aria-pressed={showFiltersPanel}
                    aria-label={showFiltersPanel ? 'Hide filters' : `Show filters (${appliedAdvancedFilterCount} applied)`}
                  >
                    <FunnelIcon className="h-5 w-5" aria-hidden />
                    {appliedAdvancedFilterCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-base-100">
                        {appliedAdvancedFilterCount > 9 ? '9+' : appliedAdvancedFilterCount}
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-base-300/60 bg-base-100 shadow-sm transition-colors ${
                    isAltTheme ? 'text-white hover:bg-[#505d57]/95' : 'text-primary hover:bg-base-200/80'
                  } ${isSearching ? 'cursor-wait opacity-95' : ''} disabled:opacity-70`}
                  style={
                    isAltTheme
                      ? { background: isSearching ? 'rgba(80, 93, 87, 0.85)' : 'rgba(80, 93, 87, 0.92)' }
                      : undefined
                  }
                  onClick={handleSearch}
                  disabled={isSearching}
                  title="Search"
                  aria-busy={isSearching}
                  aria-label={isSearching ? 'Searching…' : 'Search'}
                >
                  {isSearching ? (
                    <Loader2 className={`h-5 w-5 animate-spin ${isAltTheme ? 'text-white' : 'text-primary'}`} aria-hidden />
                  ) : (
                    <Search className={`h-5 w-5 ${isAltTheme ? 'text-white' : ''}`} strokeWidth={2.25} />
                  )}
                </button>
                <div className="mx-0.5 h-9 w-px shrink-0 bg-base-300/60" aria-hidden />
                <button
                  type="button"
                  className={`btn btn-circle btn-sm min-h-[44px] min-w-[44px] h-11 w-11 border-0 transition-all duration-300 ${
                    viewMode === 'cards'
                      ? (isAltTheme ? 'bg-[#505d57] text-white shadow-sm hover:bg-[#3d4743]' : 'btn-primary shadow-sm')
                      : 'btn-ghost'
                  }`}
                  onClick={() => setViewMode('cards')}
                  title="Cards view"
                  aria-pressed={viewMode === 'cards'}
                >
                  <Squares2X2Icon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className={`btn btn-circle btn-sm min-h-[44px] min-w-[44px] h-11 w-11 border-0 transition-all duration-300 ${
                    viewMode === 'table'
                      ? (isAltTheme ? 'bg-[#505d57] text-white shadow-sm hover:bg-[#3d4743]' : 'btn-primary shadow-sm')
                      : 'btn-ghost'
                  }`}
                  onClick={() => setViewMode('table')}
                  title="Table view"
                  aria-pressed={viewMode === 'table'}
                >
                  <TableCellsIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-white/30 shadow-xl transition-colors ${
              mobileQuickBarOpen
                ? 'bg-base-100 text-base-content ring-2 ring-base-300/80'
                : isAltTheme
                  ? 'bg-[#505d57] text-white hover:bg-[#3d4743]'
                  : 'bg-primary text-primary-content hover:brightness-110'
            }`}
            onClick={() => setMobileQuickBarOpen(open => !open)}
            title={mobileQuickBarOpen ? 'Close quick actions' : 'Quick actions'}
            aria-expanded={mobileQuickBarOpen}
            aria-label={mobileQuickBarOpen ? 'Close quick actions' : 'Open quick actions'}
          >
            {mobileQuickBarOpen ? (
              <XMarkIcon className="h-6 w-6" aria-hidden />
            ) : (
              <AdjustmentsHorizontalIcon className="h-6 w-6" aria-hidden />
            )}
            {!mobileQuickBarOpen && appliedAdvancedFilterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold leading-none text-white ring-2 ring-white dark:ring-base-100">
                {appliedAdvancedFilterCount > 9 ? '9+' : appliedAdvancedFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Desktop: always-visible toolbar */}
        <div className="hidden md:flex items-center gap-3 rounded-3xl border border-base-200/80 dark:border-base-content/12 bg-base-100/95 dark:bg-base-300/90 backdrop-blur-md shadow-xl px-4 py-3 pointer-events-auto">
          <input
            type="date"
            className="input input-md input-bordered w-36 h-11 min-h-[44px] text-sm shrink-0"
            value={filters.fromDate}
            onChange={e => handleFilterChange('fromDate', e.target.value)}
            title="From date"
          />
          <input
            type="date"
            className="input input-md input-bordered w-36 h-11 min-h-[44px] text-sm shrink-0"
            value={filters.toDate}
            onChange={e => handleFilterChange('toDate', e.target.value)}
            title="To date"
          />
          {searchPerformed && (
            <button
              type="button"
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors ${
                showFiltersPanel
                  ? (isAltTheme ? 'border-[#505d57] bg-[#505d57] text-white' : 'border-primary bg-primary text-primary-content')
                  : 'border-base-300/60 bg-base-100 text-base-content/70 hover:bg-base-200/80'
              }`}
              onClick={() => setShowFiltersPanel(v => !v)}
              title={showFiltersPanel ? 'Hide filters' : 'Show filters'}
              aria-pressed={showFiltersPanel}
              aria-label={showFiltersPanel ? 'Hide filters' : `Show filters (${appliedAdvancedFilterCount} applied)`}
            >
              <FunnelIcon className="h-5 w-5" aria-hidden />
              {appliedAdvancedFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold leading-none text-white ring-2 ring-white dark:ring-base-100">
                  {appliedAdvancedFilterCount > 9 ? '9+' : appliedAdvancedFilterCount}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-base-300/60 bg-base-100 shadow-sm transition-colors ${
              isAltTheme ? 'text-white hover:bg-[#505d57]/95' : 'text-primary hover:bg-base-200/80'
            } ${isSearching ? 'cursor-wait opacity-95' : ''} disabled:opacity-70`}
            style={
              isAltTheme
                ? { background: isSearching ? 'rgba(80, 93, 87, 0.85)' : 'rgba(80, 93, 87, 0.92)' }
                : undefined
            }
            onClick={handleSearch}
            disabled={isSearching}
            title="Search"
            aria-busy={isSearching}
            aria-label={isSearching ? 'Searching…' : 'Search'}
          >
            {isSearching ? (
              <Loader2 className={`h-5 w-5 animate-spin ${isAltTheme ? 'text-white' : 'text-primary'}`} aria-hidden />
            ) : (
              <Search className={`h-5 w-5 ${isAltTheme ? 'text-white' : ''}`} strokeWidth={2.25} />
            )}
          </button>
          <div className="w-px h-10 bg-base-300/60 shrink-0" aria-hidden />
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              className={`btn btn-circle btn-md min-w-[44px] min-h-[44px] w-11 h-11 border-0 transition-all duration-300 ${
                viewMode === 'cards'
                  ? (isAltTheme ? 'bg-[#505d57] text-white shadow-sm hover:bg-[#3d4743]' : 'btn-primary shadow-sm')
                  : 'btn-ghost'
              }`}
              onClick={() => setViewMode('cards')}
              title="Cards view"
              aria-pressed={viewMode === 'cards'}
            >
              <Squares2X2Icon className="w-5 h-5" />
            </button>
            <button
              type="button"
              className={`btn btn-circle btn-md min-w-[44px] min-h-[44px] w-11 h-11 border-0 transition-all duration-300 ${
                viewMode === 'table'
                  ? (isAltTheme ? 'bg-[#505d57] text-white shadow-sm hover:bg-[#3d4743]' : 'btn-primary shadow-sm')
                  : 'btn-ghost'
              }`}
              onClick={() => setViewMode('table')}
              title="Table view"
              aria-pressed={viewMode === 'table'}
            >
              <TableCellsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <h1
        className={`text-3xl font-bold mb-6 md:px-0 ${filtersPanelHidden ? 'hidden' : ''}`}
      >
        Leads Search
      </h1>

      {/* Search Form */}
      <div className={`mb-8 md:px-0 ${filtersPanelHidden ? 'hidden' : ''} ${isSearching ? 'max-md:hidden' : ''}`}>
        {/* Mobile: horizontal filter chips */}
        <div className="md:hidden mb-4 -mx-1">
          <div
            className="flex gap-2 overflow-x-auto pb-1 px-1 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            role="toolbar"
            aria-label="Lead search filters"
          >
            {MOBILE_FILTER_CHIPS.map(({ key, label }) => {
              const active = isMobileFilterActive(key);
              const count = getMobileFilterCount(key);
              const isOpen = activeMobileFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => (isOpen ? closeMobileFilter() : openMobileFilter(key))}
                  className={`shrink-0 snap-start inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors active:scale-[0.98] ${
                    isOpen || active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 bg-white text-gray-700'
                  }`}
                  aria-expanded={isOpen}
                >
                  <span className="whitespace-nowrap">{label}</span>
                  {count > 0 && (
                    <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-content">
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                  <ChevronDownIcon className={`h-4 w-4 shrink-0 opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                </button>
              );
            })}
          </div>
        </div>

        <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Main Category and Category: full width on mobile */}
          <div className="col-span-2 lg:col-span-1">
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
          </div>
          <div className="col-span-2 lg:col-span-1">
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
          </div>
          {/* Rest: two columns on mobile */}
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1">
            <div className="form-control flex flex-col relative">
              <label className="label mb-2"><span className="label-text">File id</span></label>
              <input type="text" className="input" value={filters.fileId} onChange={e => handleFilterChange('fileId', e.target.value)} />
            </div>
          </div>

          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>

          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
            <MultiSelectInput
              label="Expert examination"
              field="expert_examination"
              values={filters.expert_examination}
              placeholder="Select expert examination result..."
              options={filteredExpertExaminationOptions}
              showDropdown={showExpertExaminationDropdown}
              onSelect={handleMultiSelect}
              onRemove={handleMultiRemove}
              onFilterChange={handleFilterChange}
              onShowDropdown={handleShowDropdown}
              onHideDropdown={handleHideDropdown}
            />
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1">
            <div className="form-control flex flex-col">
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
          </div>

          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
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
          </div>
          <div className="col-span-1 [&>div]:!col-span-1">
            <MultiSelectInput
              label="Country"
              field="country"
              values={filters.country}
              placeholder="Type country name or choose from suggestions..."
              options={filteredCountryOptions}
              showDropdown={showCountryDropdown}
              onSelect={handleMultiSelect}
              onRemove={handleMultiRemove}
              onFilterChange={handleFilterChange}
              onShowDropdown={handleShowDropdown}
              onHideDropdown={handleHideDropdown}
            />
          </div>
          <div className="col-span-1">
            <div className="form-control flex flex-col">
              <label className="label mb-2"><span className="label-text">Content</span></label>
              <input type="text" className="input" value={filters.content} onChange={e => handleFilterChange('content', e.target.value)} />
            </div>
          </div>

          {/* Column Selector + Excel export (table view) */}
          {viewMode === 'table' && (
            <div className="col-span-1 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 sm:gap-3 items-end">
              <div className="min-w-0 [&>div]:!col-span-1">
                <ColumnSelector
                  selectedColumns={selectedColumns}
                  onColumnsChange={setSelectedColumns}
                  showDropdown={showColumnSelector}
                  onShowDropdown={() => handleShowDropdown('columns')}
                  onHideDropdown={() => handleHideDropdown('columns')}
                />
              </div>
              <button
                type="button"
                className="btn btn-outline btn-primary gap-2 whitespace-nowrap w-full sm:w-auto shrink-0"
                onClick={handleExportTableToExcel}
                title="Download current results with the selected columns as Excel"
              >
                <ArrowDownTrayIcon className="w-4 h-4 shrink-0" aria-hidden />
                Export Excel
              </button>
            </div>
          )}

          {/* Search Buttons: Removed (now in fixed bar) */}
        </div>
      </div>

      {activeMobileFilter && createPortal(
        <div className="fixed inset-0 z-[100] md:hidden" role="presentation">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeMobileFilter}
            aria-hidden="true"
          />
          <div
            className="absolute bottom-0 left-0 right-0 flex max-h-[min(88vh,640px)] flex-col rounded-t-3xl bg-base-100 shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={MOBILE_FILTER_CHIPS.find(f => f.key === activeMobileFilter)?.label}
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="flex justify-center pt-3 pb-2 shrink-0">
              <div className="h-1 w-10 rounded-full bg-base-300" aria-hidden />
            </div>
            <div className="flex items-center justify-between gap-3 px-5 pb-4 border-b border-base-200 shrink-0">
              <h2 className="text-lg font-semibold text-base-content">
                {MOBILE_FILTER_CHIPS.find(f => f.key === activeMobileFilter)?.label}
              </h2>
              <button
                type="button"
                className="btn btn-ghost btn-circle btn-sm"
                onClick={closeMobileFilter}
                aria-label="Close filter"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto min-h-0 flex-1 px-4 py-4">
              {renderMobileFilterControl(activeMobileFilter)}
            </div>
            <button
              type="button"
              className="mx-4 mt-2 mb-1 flex h-12 w-[calc(100%-2rem)] items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-content active:opacity-90"
              onClick={closeMobileFilter}
            >
              Done
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Results */}
      {searchPerformed && (
        <div ref={resultsRef}>
          {/* Mobile: dedicated loading surface — no filter fields, no stale "Found N" while fetching */}
          {isSearching && (
            <div
              className="md:hidden flex flex-col items-center justify-center gap-4 py-16 px-6 min-h-[min(60vh,28rem)]"
              aria-busy="true"
              aria-live="polite"
            >
              <Loader2 className="w-14 h-14 animate-spin text-primary shrink-0" aria-hidden />
              <span className="text-sm font-medium text-base-content/60">Searching leads…</span>
            </div>
          )}

          <div className={isSearching ? 'hidden md:block' : ''}>
            {results.length > 0 ? (
              <>
                <h2 className="text-2xl font-bold mb-4 md:px-0">
                  Found {results.length} lead{results.length !== 1 && 's'}
                </h2>
                {isSearching ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" aria-hidden />
                  </div>
                ) : (
                  viewMode === 'table' ? (
                    <div ref={tableResultsRef}>
                      <TableView leads={results} selectedColumns={selectedColumns} onLeadClick={handleLeadClick} />
                    </div>
                  ) : (
                    <div
                      ref={cardsGridRef}
                      className="grid w-full min-w-0 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4"
                    >
                      {results.map(renderResultCard)}
                    </div>
                  )
                )}
              </>
            ) : (
              !isSearching && (
                <div className="text-center p-8 bg-white rounded-lg md:mx-0 shadow-sm">
                  No leads found matching your criteria.
                </div>
              )
            )}
          </div>
        </div>
      )}

      {factsModalLead &&
        createPortal(
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" role="presentation">
            <div className="absolute inset-0 bg-black/50" onClick={closeFactsModal} aria-hidden />
            <div
              className="relative z-10 flex w-full max-w-lg max-h-[min(85vh,640px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lead-facts-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-5">
                <div className="min-w-0 pr-2">
                  <h3 id="lead-facts-modal-title" className="truncate text-lg font-bold text-gray-900">
                    {factsModalLead.name}
                  </h3>
                  <p className="mt-0.5 font-mono text-sm text-gray-500">
                    #{(factsModalLead as { display_lead_number?: string }).display_lead_number ||
                      factsModalLead.lead_number ||
                      factsModalLead.id}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-circle btn-sm shrink-0"
                  onClick={closeFactsModal}
                  aria-label="Close"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Facts of case
                </h4>
                {factsModalLoading ? (
                  <div className="flex justify-center py-8">
                    <span className="loading loading-spinner loading-md text-primary" />
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700" dir="auto">
                    {stripHtmlForDisplay(factsModalText) || (
                      <span className="italic text-gray-400">No facts provided</span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-gray-200 p-4">
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeFactsModal}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={(e) => {
                    handleLeadClick(factsModalLead, e);
                    closeFactsModal();
                  }}
                >
                  Open lead
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <LeadSearchRolesModal
        lead={rolesModalLead}
        isOpen={rolesModalLead != null}
        onClose={() => setRolesModalLead(null)}
      />

    </div>
  );
};

export default LeadSearchPage; 