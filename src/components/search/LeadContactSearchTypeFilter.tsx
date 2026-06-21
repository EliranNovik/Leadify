import React from 'react';

export type LeadContactSearchTypeFilterValue = 'all' | 'lead' | 'contact';

type Props = {
  value: LeadContactSearchTypeFilterValue;
  onChange: (value: LeadContactSearchTypeFilterValue) => void;
  leadCount: number;
  contactCount: number;
  className?: string;
};

const LeadContactSearchTypeFilter: React.FC<Props> = ({
  value,
  onChange,
  leadCount,
  contactCount,
  className = '',
}) => {
  const segments: Array<{ id: LeadContactSearchTypeFilterValue; label: string; count?: number }> = [
    { id: 'all', label: 'All' },
    { id: 'lead', label: 'Lead', count: leadCount },
    { id: 'contact', label: 'Contact', count: contactCount },
  ];

  return (
    <div className={`px-4 pb-2 pt-3 ${className}`}>
      <div className="flex rounded-full bg-gray-100 p-1" role="tablist" aria-label="Filter search results">
        {segments.map((segment) => {
          const isActive = value === segment.id;
          return (
            <button
              key={segment.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(segment.id)}
              className={`min-w-0 flex-1 rounded-full px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-all ${
                isActive
                  ? 'bg-white text-base-content shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {segment.label}
              {segment.count != null && segment.count > 0 ? ` (${segment.count})` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LeadContactSearchTypeFilter;
