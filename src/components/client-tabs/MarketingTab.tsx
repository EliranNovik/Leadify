import React, { useEffect, useMemo, useState } from 'react';
import { ClientTabProps } from '../../types/client';
import { MegaphoneIcon, PencilSquareIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';

interface PotentialMetric {
  label: string;
  value: string | number;
  progress?: number;
  color?: string;
}

const defaultPotentialMetrics: PotentialMetric[] = [
  { label: 'Legal', value: 'Very low', progress: 20, color: 'info' },
  { label: 'Revenue', value: '0-5k', progress: 15, color: 'warning' },
  { label: 'Seriousness', value: 'Medium', progress: 60, color: 'warning' },
  { label: 'Financial ability', value: 'Medium', progress: 60, color: 'warning' },
];

const MarketingTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  // Potential
  const [isEditingPotential, setIsEditingPotential] = useState(false);
  const [potentialMetrics, setPotentialMetrics] = useState<PotentialMetric[]>(
    client.potential_metrics || defaultPotentialMetrics
  );

  const isLegacyLead = useMemo(
    () => client.lead_type === 'legacy' || String(client.id || '').startsWith('legacy_'),
    [client.id, client.lead_type]
  );

  const [utmParams, setUtmParams] = useState<Record<string, unknown> | null>(null);
  const [isLoadingUtm, setIsLoadingUtm] = useState(false);

  // Source
  const [isEditingSource, setIsEditingSource] = useState(false);
  const [source, setSource] = useState(client.source || '');

  // Save handlers
  const handleSavePotential = async () => {
    await supabase
      .from('leads')
      .update({ potential_metrics: potentialMetrics })
      .eq('id', client.id);
    setIsEditingPotential(false);
    if (onClientUpdate) await onClientUpdate();
  };

  const handleSaveSource = async () => {
    await supabase
      .from('leads')
      .update({ source })
      .eq('id', client.id);
    setIsEditingSource(false);
    if (onClientUpdate) await onClientUpdate();
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoadingUtm(true);
      try {
        // Note: legacy table `leads_lead` does not have `utm_params`.
        // We only fetch from `leads` (new leads). Legacy leads will show "Not specified".
        if (!client.id || isLegacyLead) {
          if (!cancelled) setUtmParams(null);
          return;
        }

        const { data, error } = await supabase
          .from('leads')
          .select('utm_params')
          .eq('id', client.id)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) setUtmParams((data?.utm_params as Record<string, unknown> | null) ?? null);
      } catch (e) {
        console.error('Error loading utm_params:', e);
        if (!cancelled) setUtmParams(null);
      } finally {
        if (!cancelled) setIsLoadingUtm(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client.id, isLegacyLead]);

  const utmText = useMemo(() => {
    if (!utmParams) return '';
    try {
      return JSON.stringify(utmParams, null, 2);
    } catch {
      return String(utmParams);
    }
  }, [utmParams]);

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-base-200 flex items-center justify-center">
          <MegaphoneIcon className="w-5 h-5 text-base-content/70" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-base-content">Marketing</h2>
          <p className="text-sm text-base-content/60">Client potential and source tracking</p>
        </div>
      </div>

      {/* Potential Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
              Client potential
            </div>
            <div className="mt-1 text-base font-semibold text-base-content">Potential metrics</div>
          </div>
          {isEditingPotential ? (
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={handleSavePotential} title="Save">
                <CheckIcon className="w-4 h-4" />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setIsEditingPotential(false);
                  setPotentialMetrics(client.potential_metrics || defaultPotentialMetrics);
                }}
                title="Cancel"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setIsEditingPotential(true)} title="Edit">
              <PencilSquareIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="space-y-6">
          {potentialMetrics.map((metric, index) => (
            <div key={index} className="space-y-2">
              <div className="flex justify-between items-center gap-3">
                <label className="text-sm font-medium text-base-content/70">{metric.label}</label>
                {isEditingPotential ? (
                  <div className="flex gap-2 items-center">
                    <input
                      className="input input-bordered input-sm w-28"
                      value={metric.value}
                      onChange={(e) => {
                        const newMetrics = [...potentialMetrics];
                        newMetrics[index].value = e.target.value;
                        setPotentialMetrics(newMetrics);
                      }}
                    />
                    <input
                      type="number"
                      className="input input-bordered input-sm w-16"
                      value={metric.progress}
                      min={0}
                      max={100}
                      onChange={(e) => {
                        const newMetrics = [...potentialMetrics];
                        newMetrics[index].progress = Number(e.target.value);
                        setPotentialMetrics(newMetrics);
                      }}
                    />
                  </div>
                ) : (
                  <span className="font-semibold text-base-content">{metric.value}</span>
                )}
              </div>
              <div className="w-full bg-base-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    metric.color === 'info'
                      ? 'bg-blue-500'
                      : metric.color === 'warning'
                        ? 'bg-yellow-500'
                        : metric.color === 'success'
                          ? 'bg-green-500'
                          : 'bg-[#3b28c7]'
                  }`}
                  style={{ width: `${metric.progress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-base-content/45">
                <span>0%</span>
                <span>{metric.progress}%</span>
                <span>100%</span>
              </div>
            </div>
          ))}
        </div>

        <div className="divider my-0" />
      </section>

      {/* Lead Info Section (utm_params) */}
      <section className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Lead info</div>
        <div className="text-base font-semibold text-base-content">UTM parameters</div>
        {isLoadingUtm ? (
          <div className="text-sm text-base-content/60">Loading…</div>
        ) : utmText ? (
          <pre className="text-xs sm:text-sm text-base-content whitespace-pre-wrap break-words leading-relaxed">{utmText}</pre>
        ) : (
          <div className="text-sm text-base-content/60">Not specified</div>
        )}
        <div className="divider my-0" />
      </section>

      {/* Source Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Lead source</div>
            <div className="mt-1 text-base font-semibold text-base-content">Source</div>
          </div>
          {isEditingSource ? (
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={handleSaveSource} title="Save">
                <CheckIcon className="w-4 h-4" />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setIsEditingSource(false);
                  setSource(client.source || '');
                }}
                title="Cancel"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setIsEditingSource(true)} title="Edit">
              <PencilSquareIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        {isEditingSource ? (
          <input
            className="input input-bordered w-full"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Enter lead source..."
          />
        ) : (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              Auto Lead
            </span>
            <span className="text-base-content font-medium">{source || 'Not specified'}</span>
          </div>
        )}

        <div className="divider my-0" />
      </section>

      {/* Facts of Case Section */}
      <section className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Facts</div>
        <div className="text-base font-semibold text-base-content">Facts of case</div>
        {client.facts && client.facts.trim() !== '' ? (
          <p className="text-base-content whitespace-pre-line leading-relaxed">{client.facts}</p>
        ) : (
          <div className="text-sm text-base-content/60">No case facts specified</div>
        )}
      </section>
      
    </div>
  );
};

export default MarketingTab; 