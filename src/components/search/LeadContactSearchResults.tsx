import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import type { CombinedLead } from '../../lib/legacyLeadsApi';
import { useContactProfileImageUrls } from '../../hooks/useContactProfileImageUrls';
import ContactProfileAvatar from '../ContactProfileAvatar';
import {
  getLeadContactSearchResultKey,
  getLeadContactSearchResultTitle,
  isLeadContactSearchInactive,
  isLeadContactSearchResultContact,
} from '../../lib/leadContactSearchUi';
import LeadContactSearchStageBadge from './LeadContactSearchStageBadge';
import LeadContactSearchTypeFilter, {
  type LeadContactSearchTypeFilterValue,
} from './LeadContactSearchTypeFilter';

type Props = {
  results: CombinedLead[];
  loading: boolean;
  query: string;
  onSelect: (lead: CombinedLead) => void;
  emptyMessage?: string;
  minLength?: number;
  className?: string;
  showTypeFilter?: boolean;
};

const RESULT_ROW_BASE_CLASS =
  'flex w-full items-stretch gap-3 border-0 px-4 pt-3.5 text-left transition-colors focus-visible:outline-none';

function getResultRowClass(inactive: boolean, isContact: boolean): string {
  if (isContact) {
    return `${RESULT_ROW_BASE_CLASS} hover:bg-base-200/50 focus-visible:bg-base-200/60 dark:hover:bg-base-200/40`;
  }
  if (inactive) {
    return `${RESULT_ROW_BASE_CLASS} bg-gray-100 hover:bg-gray-200/80 focus-visible:bg-gray-200/80 dark:bg-base-200/40 dark:hover:bg-base-200/55`;
  }
  return `${RESULT_ROW_BASE_CLASS} bg-white hover:bg-base-200/50 focus-visible:bg-base-200/60 dark:bg-transparent dark:hover:bg-base-200/40`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightQuery(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed || !text) return text;

  const parts = text.split(new RegExp(`(${escapeRegExp(trimmed)})`, 'gi'));
  if (parts.length === 1) return text;

  return parts.map((part, index) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-[#ffd4c4]/70 px-0.5 text-inherit"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

const LeadContactSearchResults: React.FC<Props> = ({
  results,
  loading,
  query,
  onSelect,
  emptyMessage = 'No matches for lead number, name, phone, mobile, email, or contact details.',
  minLength = 2,
  className = '',
  showTypeFilter = true,
}) => {
  const trimmed = query.trim();
  const [typeFilter, setTypeFilter] = useState<LeadContactSearchTypeFilterValue>('all');

  useEffect(() => {
    setTypeFilter('all');
  }, [trimmed]);

  const leadCount = useMemo(
    () => results.filter((result) => !isLeadContactSearchResultContact(result)).length,
    [results],
  );
  const contactCount = useMemo(
    () => results.filter((result) => isLeadContactSearchResultContact(result)).length,
    [results],
  );

  const filteredResults = useMemo(() => {
    if (typeFilter === 'lead') {
      return results.filter((result) => !isLeadContactSearchResultContact(result));
    }
    if (typeFilter === 'contact') {
      return results.filter((result) => isLeadContactSearchResultContact(result));
    }
    return results;
  }, [results, typeFilter]);

  const profilePaths = useMemo(
    () => filteredResults.map((lead) => lead.portal_profile_image_path),
    [filteredResults],
  );
  const profileImageUrls = useContactProfileImageUrls(profilePaths);

  const showFilterBar = showTypeFilter && trimmed.length >= minLength && (loading || results.length > 0);

  if (trimmed.length < minLength && !loading) {
    return null;
  }

  const filteredEmptyMessage =
    typeFilter === 'lead'
      ? 'No lead matches for this search.'
      : typeFilter === 'contact'
        ? 'No contact matches for this search.'
        : emptyMessage;

  return (
    <div className={className}>
      {showFilterBar ? (
        <LeadContactSearchTypeFilter
          value={typeFilter}
          onChange={setTypeFilter}
          leadCount={leadCount}
          contactCount={contactCount}
        />
      ) : null}

      {loading ? (
        <div className="flex justify-center px-4 py-8">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      ) : filteredResults.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-base-content/50">
          {filteredEmptyMessage}
        </div>
      ) : (
        <ul className="scrollbar-hide max-h-[min(24rem,60vh)] overflow-y-auto">
          {filteredResults.map((lead, index) => {
            const title = getLeadContactSearchResultTitle(lead);
            const isContact = isLeadContactSearchResultContact(lead);
            const inactive = isLeadContactSearchInactive(lead);
            const profilePath = lead.portal_profile_image_path?.trim() || null;
            const profileImageUrl = profilePath ? profileImageUrls[profilePath] : undefined;
            const isLast = index === filteredResults.length - 1;
            const avatarClassName = isContact
              ? 'h-12 w-12 text-[15px] !bg-primary/10 !text-primary'
              : inactive
                ? 'h-12 w-12 text-[15px] !bg-gray-200 !text-gray-400'
                : 'h-12 w-12 text-[15px] !bg-gray-100 !text-gray-500';

            return (
              <li key={getLeadContactSearchResultKey(lead, index)}>
                <button
                  type="button"
                  className={getResultRowClass(inactive, isContact)}
                  onClick={() => onSelect(lead)}
                >
                  <div className="flex shrink-0 items-center self-center">
                    <ContactProfileAvatar
                      name={title}
                      imageUrl={profileImageUrl}
                      className={avatarClassName}
                    />
                  </div>

                  <div
                    className={`flex min-w-0 flex-1 items-center gap-2.5 pb-3.5 ${
                      isLast ? '' : 'border-b border-base-200/80'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      {isContact ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                            Contact
                          </span>
                          <p
                            className={`min-w-0 truncate text-[15px] font-semibold leading-snug ${
                              inactive ? 'text-gray-700' : 'text-base-content'
                            }`}
                          >
                            {highlightQuery(title, trimmed)}
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="flex min-w-0 items-center gap-2">
                            <p
                              className={`min-w-0 truncate text-[15px] font-semibold leading-snug ${
                                inactive ? 'text-gray-500' : 'text-base-content'
                              }`}
                            >
                              {highlightQuery(title, trimmed)}
                            </p>
                            <LeadContactSearchStageBadge lead={lead} />
                          </div>

                          <p
                            className={`mt-1.5 truncate text-sm leading-snug ${
                              inactive ? 'text-gray-400' : 'text-gray-500'
                            }`}
                          >
                            {lead.lead_number ? (
                              <>
                                {highlightQuery(lead.lead_number, trimmed)}
                                {lead.category ? (
                                  <>
                                    <span className="mx-1.5 text-gray-400">·</span>
                                    <span>{highlightQuery(lead.category, trimmed)}</span>
                                  </>
                                ) : null}
                              </>
                            ) : (
                              lead.category || '—'
                            )}
                          </p>
                        </>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center">
                      <ChevronRightIcon className="h-4 w-4 text-base-content/25" aria-hidden />
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default LeadContactSearchResults;
