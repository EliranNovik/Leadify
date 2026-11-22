import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { searchExternalFirms } from '../../lib/externalFirms';
import { allocationRowFromCombinedLead } from '../../lib/employeeLeadReporting';
import { useLeadContactSearch } from '../../hooks/useLeadContactSearch';
import type { EffortFirmLink, EffortLeadLink } from '../../lib/workAreaEfforts';

type Tab = 'firms' | 'leads';

type Props = {
  firms: EffortFirmLink[];
  leads: EffortLeadLink[];
  readOnly?: boolean;
  /** Links are stored with the effort's time, so a row at zero is not saved. */
  persists?: boolean;
  onChange: (next: { firms: EffortFirmLink[]; leads: EffortLeadLink[] }) => void;
};

const AVATAR = 'h-7 w-7 rounded-full object-cover ring-2 ring-white';

function FirmAvatar({ firm }: { firm: EffortFirmLink }) {
  if (firm.imageUrl) {
    return <img src={firm.imageUrl} alt="" className={AVATAR} />;
  }
  return (
    <span className={`${AVATAR} inline-flex items-center justify-center bg-gray-200 text-[10px] font-semibold text-gray-600`}>
      {firm.name.slice(0, 1).toUpperCase() || 'F'}
    </span>
  );
}

function LeadAvatar({ lead }: { lead: EffortLeadLink }) {
  const letter = (lead.clientName || lead.leadNumber || 'L').slice(0, 1).toUpperCase();
  return (
    <span className={`${AVATAR} inline-flex items-center justify-center bg-sky-100 text-[10px] font-semibold text-sky-800`}>
      {letter}
    </span>
  );
}

const EffortLinkPicker: React.FC<Props> = ({ firms, leads, readOnly = false, persists = true, onChange }) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('firms');
  const [firmQuery, setFirmQuery] = useState('');
  const [leadQuery, setLeadQuery] = useState('');
  const [firmResults, setFirmResults] = useState<EffortFirmLink[]>([]);
  const [firmLoading, setFirmLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  const { results: leadResults, loading: leadLoading } = useLeadContactSearch(leadQuery, {
    enabled: open && tab === 'leads',
    limit: 12,
  });

  useEffect(() => {
    if (!open || tab !== 'firms') return;
    const q = firmQuery.trim();
    if (q.length < 2) {
      setFirmResults([]);
      setFirmLoading(false);
      return;
    }
    let cancelled = false;
    setFirmLoading(true);
    const timer = window.setTimeout(() => {
      void searchExternalFirms(q)
        .then((rows) => {
          if (cancelled) return;
          setFirmResults(
            rows.map((firm) => ({
              id: firm.id,
              name: firm.name,
              imageUrl: firm.profileImageUrl || null,
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setFirmResults([]);
        })
        .finally(() => {
          if (!cancelled) setFirmLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [firmQuery, open, tab]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 288;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const openUp = window.innerHeight - rect.bottom < 300;
      setPanelStyle({
        position: 'fixed',
        left,
        width,
        zIndex: 80,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = [...firms.map((firm) => ({ kind: 'firm' as const, firm })), ...leads.map((lead) => ({ kind: 'lead' as const, lead }))];
  const visible = selected.slice(0, 3);
  const extra = selected.length - visible.length;
  const leadChoices = leadResults.flatMap((result) => {
    if (result.isContact) return [];
    const row = allocationRowFromCombinedLead(result);
    if (!row) return [];
    const lead: EffortLeadLink = {
      key: row.key,
      leadType: row.lead_type,
      newLeadId: row.new_lead_id,
      legacyLeadId: row.legacy_lead_id,
      leadNumber: row.lead_number,
      clientName: row.client_name,
    };
    return [lead];
  });

  const toggleFirm = (firm: EffortFirmLink) => {
    const exists = firms.some((item) => item.id === firm.id);
    onChange({
      firms: exists ? firms.filter((item) => item.id !== firm.id) : [...firms, firm],
      leads,
    });
  };

  const toggleLead = (lead: EffortLeadLink) => {
    const exists = leads.some((item) => item.key === lead.key);
    onChange({
      firms,
      leads: exists ? leads.filter((item) => item.key !== lead.key) : [...leads, lead],
    });
  };

  if (readOnly && selected.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={readOnly && selected.length === 0}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white px-1.5 text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50 disabled:cursor-default"
        aria-label={selected.length > 0 ? 'Firms and leads linked to this effort' : 'Link a firm or lead'}
        title={selected.length > 0 ? 'Firms and leads' : 'Link a firm or lead'}
        onClick={() => {
          if (readOnly) return;
          setOpen((current) => !current);
        }}
      >
        {visible.length > 0 ? (
          <span className="flex items-center pl-0.5">
            {visible.map((item) => (
              <span key={item.kind === 'firm' ? `f-${item.firm.id}` : `l-${item.lead.key}`} className="-ml-1.5 first:ml-0">
                {item.kind === 'firm' ? <FirmAvatar firm={item.firm} /> : <LeadAvatar lead={item.lead} />}
              </span>
            ))}
          </span>
        ) : null}
        {extra > 0 ? <span className="text-xs font-semibold tabular-nums text-gray-500">+{extra}</span> : null}
        {!readOnly ? <PlusIcon className="h-4 w-4" aria-hidden /> : null}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              style={panelStyle}
              className="rounded-2xl bg-white p-3 shadow-xl ring-1 ring-black/10"
            >
              <div className="mb-2 flex rounded-full bg-gray-100 p-0.5 text-xs font-semibold">
                {(['firms', 'leads'] as Tab[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`flex-1 rounded-full px-2 py-1 capitalize ${
                      tab === item ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                    }`}
                    onClick={() => setTab(item)}
                  >
                    {item === 'firms' ? `Firms${firms.length ? ` ${firms.length}` : ''}` : `Leads${leads.length ? ` ${leads.length}` : ''}`}
                  </button>
                ))}
              </div>
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  autoFocus
                  value={tab === 'firms' ? firmQuery : leadQuery}
                  onChange={(event) =>
                    tab === 'firms' ? setFirmQuery(event.target.value) : setLeadQuery(event.target.value)
                  }
                  placeholder={tab === 'firms' ? 'Search firms by name' : 'Search leads by name or number'}
                  className="h-9 w-full rounded-full bg-gray-50 pl-9 pr-3 text-sm ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {(tab === 'firms' ? firms.length > 0 : leads.length > 0) && !persists ? (
                <p className="mt-2 text-xs text-amber-700">Move the slider so these are saved with this effort.</p>
              ) : null}
              {(tab === 'firms' ? firms.length > 0 : leads.length > 0) ? (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {(tab === 'firms' ? firms : []).map((firm) => (
                    <li key={firm.id}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-0.5 pr-1.5 text-xs text-gray-700"
                        onClick={() => toggleFirm(firm)}
                      >
                        <FirmAvatar firm={firm} />
                        <span className="max-w-[8rem] truncate">{firm.name}</span>
                        <XMarkIcon className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                    </li>
                  ))}
                  {(tab === 'leads' ? leads : []).map((lead) => (
                    <li key={lead.key}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full bg-sky-50 py-0.5 pl-0.5 pr-1.5 text-xs text-sky-900"
                        onClick={() => toggleLead(lead)}
                      >
                        <LeadAvatar lead={lead} />
                        <span className="max-w-[8rem] truncate">{lead.leadNumber || lead.clientName}</span>
                        <XMarkIcon className="h-3.5 w-3.5 text-sky-400" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="mt-2 max-h-52 overflow-y-auto">
                {tab === 'firms' ? (
                  firmQuery.trim().length < 2 ? (
                    <li className="px-1 py-3 text-center text-xs text-gray-400">Type a firm name</li>
                  ) : firmLoading ? (
                    <li className="px-1 py-3 text-center text-xs text-gray-400">Searching…</li>
                  ) : firmResults.length === 0 ? (
                    <li className="px-1 py-3 text-center text-xs text-gray-400">No firms found</li>
                  ) : (
                    firmResults.map((firm) => {
                      const picked = firms.some((item) => item.id === firm.id);
                      return (
                        <li key={firm.id}>
                          <button
                            type="button"
                            className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-gray-50 ${
                              picked ? 'bg-gray-50' : ''
                            }`}
                            onClick={() => toggleFirm(firm)}
                          >
                            <FirmAvatar firm={firm} />
                            <span className="min-w-0 flex-1 truncate">{firm.name}</span>
                            {picked ? <span className="text-xs font-semibold text-primary">Added</span> : null}
                          </button>
                        </li>
                      );
                    })
                  )
                ) : leadQuery.trim().length < 2 ? (
                  <li className="px-1 py-3 text-center text-xs text-gray-400">Type a lead name or number</li>
                ) : leadLoading ? (
                  <li className="px-1 py-3 text-center text-xs text-gray-400">Searching…</li>
                ) : leadChoices.length === 0 ? (
                  <li className="px-1 py-3 text-center text-xs text-gray-400">No leads found</li>
                ) : (
                  leadChoices.map((lead) => {
                    const picked = leads.some((item) => item.key === lead.key);
                    return (
                      <li key={lead.key}>
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-gray-50 ${
                            picked ? 'bg-sky-50' : ''
                          }`}
                          onClick={() => toggleLead(lead)}
                        >
                          <LeadAvatar lead={lead} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-gray-900">
                              {lead.leadNumber || 'Lead'}
                            </span>
                            <span className="block truncate text-xs text-gray-500">{lead.clientName}</span>
                          </span>
                          {picked ? <span className="text-xs font-semibold text-primary">Added</span> : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default EffortLinkPicker;
