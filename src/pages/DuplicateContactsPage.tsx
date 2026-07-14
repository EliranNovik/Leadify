import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import LeadContactSearchStageBadge from '../components/search/LeadContactSearchStageBadge';
import {
  loadDuplicateContactsForLeadNumber,
  type DuplicateContactMatch,
} from '../lib/duplicateContactsApi';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import { isLeadContactSearchInactive } from '../lib/leadContactSearchUi';

function duplicateToStageBadgeLead(dup: DuplicateContactMatch): CombinedLead {
  return {
    id: String(dup.leadId),
    lead_number: dup.leadNumber,
    name: dup.leadName,
    email: dup.contactEmail || '',
    phone: dup.contactPhone || '',
    mobile: dup.contactMobile || '',
    topic: dup.topic || '',
    stage: dup.stage != null ? String(dup.stage) : '',
    stage_colour: dup.stageColour || '',
    source: dup.source || '',
    created_at: '',
    updated_at: '',
    notes: '',
    special_notes: '',
    next_followup: '',
    probability: '',
    category: dup.category || '',
    language: '',
    balance: '',
    lead_type: dup.leadType,
    status: dup.status ?? undefined,
    unactivation_reason: null,
    deactivate_note: null,
    isFuzzyMatch: false,
  };
}

type ContactFieldKind = 'email' | 'phone' | 'mobile' | 'country';

const CONTACT_FIELD_STYLES_MATCHED: Record<'email' | 'phone' | 'mobile', string> = {
  email: 'bg-sky-50 text-sky-800 dark:bg-sky-900/25 dark:text-sky-200',
  phone: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-200',
  mobile: 'bg-violet-50 text-violet-800 dark:bg-violet-900/25 dark:text-violet-200',
};

function isFieldMatched(dup: DuplicateContactMatch, kind: ContactFieldKind): boolean {
  const fields = new Set(dup.matchingFields.map((f) => f.toLowerCase()));
  if (kind === 'email') return fields.has('email');
  if (kind === 'phone') return fields.has('phone') || fields.has('phone/mobile');
  if (kind === 'mobile') return fields.has('mobile') || fields.has('mobile/phone');
  return false;
}

function ContactFieldCell({
  value,
  kind,
  matched,
}: {
  value: string | null | undefined;
  kind: ContactFieldKind;
  matched: boolean;
}) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return <span className="text-gray-300">—</span>;
  }

  if (matched && kind !== 'country') {
    return (
      <span
        className={`inline-flex max-w-[14rem] items-center truncate rounded-full px-2.5 py-1 text-xs font-semibold ${CONTACT_FIELD_STYLES_MATCHED[kind]}`}
        title={`Matched ${kind}`}
      >
        {trimmed}
      </span>
    );
  }

  return (
    <span className="block max-w-[14rem] truncate text-sm text-gray-500" title={trimmed}>
      {trimmed}
    </span>
  );
}

const DuplicateContactsPage: React.FC = () => {
  const { lead_number = '' } = useParams();
  const navigate = useNavigate();
  const [clientName, setClientName] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateContactMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const backToLead = () => {
    if (lead_number) {
      navigate(`/clients/${encodeURIComponent(lead_number)}`);
    } else {
      navigate(-1);
    }
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadDuplicateContactsForLeadNumber(lead_number, {
          preferCache: true,
          includeCurrentLead: true,
        });
        if (cancelled) return;
        if (!result.client) {
          setError('Lead not found.');
          setDuplicates([]);
          setClientName(null);
        } else {
          setClientName(result.client.name || null);
          setDuplicates(result.duplicates);
        }
      } catch (e) {
        if (cancelled) return;
        console.error('DuplicateContactsPage', e);
        setError('Failed to load duplicate contacts.');
        setDuplicates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lead_number]);

  const otherCount = duplicates.filter((d) => !d.isCurrentLead).length;

  return (
    <div className="min-h-full bg-[#ececec] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-6xl">
        <button
          type="button"
          onClick={backToLead}
          className="mb-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-base-content shadow-sm transition-colors hover:bg-white/90"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to client
          {lead_number ? (
            <span className="font-mono text-base-content/50">{lead_number}</span>
          ) : null}
        </button>

        {loading ? (
          <div className="flex justify-center py-20">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-[18px] bg-white p-10 text-center shadow-sm">
            <p className="text-base-content/60">{error}</p>
            <button
              type="button"
              onClick={backToLead}
              className="btn btn-ghost btn-sm mt-4"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back to client
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="rounded-[18px] bg-white p-6 shadow-sm md:p-8">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                  <DocumentDuplicateIcon className="h-8 w-8" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold text-base-content">
                      Duplicate contacts
                    </h1>
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                      {duplicates.length}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-base-content/60">
                    {duplicates.length} lead{duplicates.length === 1 ? '' : 's'} sharing matching
                    email, phone, or mobile
                    {lead_number || clientName ? (
                      <>
                        {' '}
                        for{' '}
                        {lead_number ? (
                          <span className="font-mono text-base-content/50" dir="ltr">
                            {lead_number}
                          </span>
                        ) : null}
                        {lead_number && clientName ? ' · ' : null}
                        {clientName ? (
                          <span className="font-medium text-base-content/80">{clientName}</span>
                        ) : null}
                      </>
                    ) : null}
                    {otherCount > 0 ? (
                      <>
                        {' '}
                        <span dir="ltr">
                          ({otherCount} other{otherCount === 1 ? '' : 's'})
                        </span>
                      </>
                    ) : null}
                    .
                  </p>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-[18px] bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-base-200/80 px-5 py-4">
                <DocumentDuplicateIcon className="h-5 w-5 text-warning" />
                <h2 className="text-base font-semibold text-base-content">Leads</h2>
                <span className="ml-auto rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                  {duplicates.length}
                </span>
              </div>

              {duplicates.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-base-content/50">
                  No leads found for this contact group.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[64rem] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-base-200/80 bg-white text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        <th className="px-5 py-3 font-semibold">Lead</th>
                        <th className="px-3 py-3 font-semibold">Number</th>
                        <th className="px-3 py-3 font-semibold">Category</th>
                        <th className="px-3 py-3 font-semibold">Contact</th>
                        <th className="px-3 py-3 font-semibold">Email</th>
                        <th className="px-3 py-3 font-semibold">Phone</th>
                        <th className="px-3 py-3 font-semibold">Mobile</th>
                        <th className="px-3 py-3 font-semibold">Country</th>
                        <th className="w-10 px-3 py-3" aria-hidden />
                      </tr>
                    </thead>
                    <tbody>
                      {duplicates.map((dup, index) => {
                        const badgeLead = duplicateToStageBadgeLead(dup);
                        const inactive = isLeadContactSearchInactive(badgeLead);
                        const isCurrent = Boolean(dup.isCurrentLead);

                        return (
                          <tr
                            key={`${dup.contactId}-${dup.leadId}-${index}`}
                            role="link"
                            tabIndex={0}
                            onClick={() => {
                              if (isCurrent) {
                                backToLead();
                                return;
                              }
                              navigate(`/clients/${encodeURIComponent(dup.leadNumber)}`);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (isCurrent) backToLead();
                                else navigate(`/clients/${encodeURIComponent(dup.leadNumber)}`);
                              }
                            }}
                            className={`cursor-pointer border-b border-base-200/60 last:border-b-0 transition-colors ${
                              inactive
                                ? 'bg-gray-100 hover:bg-gray-200/80'
                                : 'bg-white hover:bg-base-200/40'
                            }`}
                          >
                            <td className="px-5 py-3.5 align-middle">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span
                                  className={`max-w-[12rem] truncate text-base font-semibold ${
                                    inactive ? 'text-gray-700' : 'text-black'
                                  }`}
                                >
                                  {dup.leadName}
                                </span>
                                <LeadContactSearchStageBadge lead={badgeLead} />
                              </div>
                            </td>
                            <td
                              className={`whitespace-nowrap px-3 py-3.5 align-middle font-mono text-sm ${
                                inactive ? 'text-gray-400' : 'text-gray-600'
                              }`}
                            >
                              {dup.leadNumber}
                            </td>
                            <td
                              className={`max-w-[12rem] px-3 py-3.5 align-middle text-sm leading-snug ${
                                inactive ? 'text-gray-400' : 'text-gray-500'
                              }`}
                              title={dup.category || undefined}
                            >
                              <span className="line-clamp-2 whitespace-normal break-words">
                                {dup.category || '—'}
                              </span>
                            </td>
                            <td
                              className={`max-w-[10rem] truncate px-3 py-3.5 align-middle text-sm font-medium text-gray-500`}
                              title={dup.contactName}
                            >
                              {dup.contactName}
                            </td>
                            <td className="px-3 py-3.5 align-middle">
                              <ContactFieldCell
                                value={dup.contactEmail}
                                kind="email"
                                matched={isFieldMatched(dup, 'email')}
                              />
                            </td>
                            <td className="px-3 py-3.5 align-middle">
                              <ContactFieldCell
                                value={dup.contactPhone}
                                kind="phone"
                                matched={isFieldMatched(dup, 'phone')}
                              />
                            </td>
                            <td className="px-3 py-3.5 align-middle">
                              <ContactFieldCell
                                value={dup.contactMobile}
                                kind="mobile"
                                matched={isFieldMatched(dup, 'mobile')}
                              />
                            </td>
                            <td className="px-3 py-3.5 align-middle">
                              <ContactFieldCell
                                value={dup.contactCountry}
                                kind="country"
                                matched={false}
                              />
                            </td>
                            <td className="px-3 py-3.5 align-middle">
                              <ChevronRightIcon
                                className="h-4 w-4 text-base-content/25"
                                aria-hidden
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default DuplicateContactsPage;
