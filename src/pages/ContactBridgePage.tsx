import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  EnvelopeIcon,
  PhoneIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import ContactProfileAvatar from '../components/ContactProfileAvatar';
import LeadContactSearchStageBadge from '../components/search/LeadContactSearchStageBadge';
import { useContactProfileImageUrls } from '../hooks/useContactProfileImageUrls';
import {
  fetchContactBridge,
  type ContactBridgeData,
  type ContactBridgeLead,
} from '../lib/contactBridgeApi';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import { isLeadContactSearchInactive } from '../lib/leadContactSearchUi';

function bridgeLeadToStageBadgeLead(lead: ContactBridgeLead): CombinedLead {
  return {
    id: lead.id,
    lead_number: lead.lead_number,
    name: lead.name,
    email: '',
    phone: '',
    mobile: '',
    topic: '',
    stage: lead.stage,
    stage_colour: lead.stage_colour,
    source: '',
    created_at: '',
    updated_at: '',
    notes: '',
    special_notes: '',
    next_followup: '',
    probability: '',
    category: lead.category,
    language: '',
    balance: '',
    lead_type: lead.lead_type,
    status: lead.status ?? undefined,
    unactivation_reason: null,
    deactivate_note: null,
    isFuzzyMatch: false,
  };
}

const ContactBridgePage: React.FC = () => {
  const { contactId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ContactBridgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchContactBridge(contactId);
        if (cancelled) return;
        if (!result) {
          setError('Contact not found.');
          setData(null);
        } else {
          setData(result);
        }
      } catch (e) {
        if (cancelled) return;
        console.error('ContactBridgePage', e);
        setError('Failed to load contact.');
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const profileUrls = useContactProfileImageUrls(
    useMemo(() => [data?.contact.portal_profile_image_path], [data?.contact.portal_profile_image_path]),
  );
  const profileImageUrl = data?.contact.portal_profile_image_path
    ? profileUrls[data.contact.portal_profile_image_path]
    : undefined;

  const groupedLeads = useMemo(() => {
    if (!data?.leads.length) return [];
    const groups = new Map<string, ContactBridgeLead[]>();
    data.leads.forEach((lead) => {
      const list = groups.get(lead.family_key) || [];
      list.push(lead);
      groups.set(lead.family_key, list);
    });
    return Array.from(groups.values());
  }, [data?.leads]);

  return (
    <div className="min-h-full bg-[#ececec] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-5 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-base-content/70 transition-colors hover:bg-white/70"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back
        </button>

        {loading ? (
          <div className="flex justify-center py-20">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-[18px] bg-white p-10 text-center shadow-sm">
            <p className="text-base-content/60">{error}</p>
          </div>
        ) : data ? (
          <div className="space-y-5">
            <section className="rounded-[18px] bg-white p-6 shadow-sm md:p-8">
              <div className="flex items-start gap-4">
                <ContactProfileAvatar
                  name={data.contact.name}
                  imageUrl={profileImageUrl}
                  className="h-16 w-16 text-lg !bg-gray-100 !text-gray-500"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-base-content/45">
                    Contact
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold text-base-content">{data.contact.name}</h1>
                  <div className="mt-3 space-y-1.5 text-sm text-gray-500">
                    {data.contact.email ? (
                      <p className="flex items-center gap-2 truncate">
                        <EnvelopeIcon className="h-4 w-4 shrink-0" />
                        {data.contact.email}
                      </p>
                    ) : null}
                    {data.contact.mobile || data.contact.phone ? (
                      <p className="flex items-center gap-2 truncate">
                        <PhoneIcon className="h-4 w-4 shrink-0" />
                        {data.contact.mobile || data.contact.phone}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[18px] bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-base-200/80 px-5 py-4">
                <UserGroupIcon className="h-5 w-5 text-primary" />
                <h2 className="text-base font-semibold text-base-content">
                  Connected leads
                </h2>
                <span className="ml-auto rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                  {data.leads.length}
                </span>
              </div>

              {data.leads.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-base-content/50">
                  No leads are linked to this contact yet.
                </div>
              ) : (
                <div className="py-1">
                  {groupedLeads.map((group, groupIndex) =>
                    group.map((lead, index) => {
                      const isLastInGroup = index === group.length - 1;
                      const isLastGroup = groupIndex === groupedLeads.length - 1;
                      const isLast = isLastInGroup && isLastGroup;
                      const inactive = isLeadContactSearchInactive(bridgeLeadToStageBadgeLead(lead));

                      return (
                        <button
                          key={`${lead.lead_type}-${lead.id}`}
                          type="button"
                          onClick={() => navigate(lead.route)}
                          className={`flex w-full items-stretch gap-3 border-0 px-5 pt-3.5 text-left transition-colors ${
                            inactive
                              ? 'bg-gray-100 hover:bg-gray-200/80 dark:bg-base-200/40 dark:hover:bg-base-200/55'
                              : 'bg-white hover:bg-base-200/40 dark:hover:bg-base-200/30'
                          }`}
                        >
                          <div className="flex w-8 shrink-0 items-center justify-center self-center">
                            <span
                              className={`inline-flex h-2.5 w-2.5 rounded-full ${
                                lead.is_master ? 'bg-primary' : 'bg-gray-300'
                              }`}
                              aria-hidden
                            />
                          </div>

                          <div
                            className={`flex min-w-0 flex-1 items-center gap-3 pb-3.5 ${
                              isLast ? '' : 'border-b border-base-200/80'
                            } ${lead.is_sublead ? 'pl-1' : ''}`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p
                                  className={`min-w-0 truncate text-[15px] font-semibold ${
                                    inactive ? 'text-gray-500' : 'text-base-content'
                                  }`}
                                >
                                  {lead.name}
                                </p>
                                <LeadContactSearchStageBadge lead={bridgeLeadToStageBadgeLead(lead)} />
                                {lead.is_main_for_contact ? (
                                  <span className="inline-flex shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                    Main
                                  </span>
                                ) : null}
                                {lead.is_sublead ? (
                                  <span className="inline-flex shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                    Sublead
                                  </span>
                                ) : null}
                              </div>
                              <p
                                className={`mt-1.5 truncate text-sm ${
                                  inactive ? 'text-gray-400' : 'text-gray-500'
                                }`}
                              >
                                {lead.lead_number}
                                {lead.category ? (
                                  <>
                                    <span className="mx-1.5 text-gray-400">·</span>
                                    {lead.category}
                                  </>
                                ) : null}
                              </p>
                            </div>

                            <div className="flex shrink-0 items-center">
                              <ChevronRightIcon className="h-4 w-4 text-base-content/25" aria-hidden />
                            </div>
                          </div>
                        </button>
                      );
                    }),
                  )}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ContactBridgePage;
