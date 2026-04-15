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
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
          <MegaphoneIcon className="w-5 h-5 text-gray-600" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Marketing Information</h2>
          <p className="text-sm text-gray-500">Client potential and source tracking</p>
        </div>
      </div>

      {/* Potential Section */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="pl-6 pt-2 pb-2 w-2/5">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold text-black">Client Potential</h4>
            {isEditingPotential ? (
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm hover:bg-green-50 bg-transparent" onClick={handleSavePotential}>
                  <CheckIcon className="w-4 h-4 text-black" />
                </button>
                <button className="btn btn-ghost btn-sm hover:bg-red-50 bg-transparent" onClick={() => { setIsEditingPotential(false); setPotentialMetrics(client.potential_metrics || defaultPotentialMetrics); }}>
                  <XMarkIcon className="w-4 h-4 text-black" />
                </button>
              </div>
            ) : (
              <button 
                className="btn btn-ghost btn-md bg-transparent hover:bg-transparent shadow-none"
                onClick={() => setIsEditingPotential(true)}
              >
                <PencilSquareIcon className="w-5 h-5 text-black" />
              </button>
            )}
          </div>
          <div className="border-b border-gray-200 mt-2"></div>
        </div>
        <div className="p-6">
          <div className="space-y-6">
            {potentialMetrics.map((metric, index) => (
              <div key={index} className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700">{metric.label}</label>
                  {isEditingPotential ? (
                    <div className="flex gap-2 items-center">
                      <input
                        className="input input-bordered input-sm w-24"
                        value={metric.value}
                        onChange={e => {
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
                        onChange={e => {
                          const newMetrics = [...potentialMetrics];
                          newMetrics[index].progress = Number(e.target.value);
                          setPotentialMetrics(newMetrics);
                        }}
                      />
                    </div>
                  ) : (
                    <span className="font-semibold text-gray-900">{metric.value}</span>
                  )}
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full transition-all duration-300 ${
                      metric.color === 'info' ? 'bg-blue-500' :
                      metric.color === 'warning' ? 'bg-yellow-500' :
                      metric.color === 'success' ? 'bg-green-500' :
                      'bg-[#3b28c7]'
                    }`}
                    style={{ width: `${metric.progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>0%</span>
                  <span>{metric.progress}%</span>
                  <span>100%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lead Info Section (utm_params) */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="pl-6 pt-2 pb-2 w-2/5">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold text-black">Lead info</h4>
          </div>
          <div className="border-b border-gray-200 mt-2"></div>
        </div>
        <div className="p-6">
          <div className="space-y-2">
            <div className="bg-gray-50 rounded-lg p-4">
              {isLoadingUtm ? (
                <div className="text-sm text-gray-500">Loading…</div>
              ) : utmText ? (
                <pre className="text-xs sm:text-sm text-gray-900 whitespace-pre-wrap break-words leading-relaxed">{utmText}</pre>
              ) : (
                <div className="text-sm text-gray-500">Not specified</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Source Section */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="pl-6 pt-2 pb-2 w-2/5">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold text-black">Lead Source</h4>
            {isEditingSource ? (
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm hover:bg-green-50 bg-transparent" onClick={handleSaveSource}>
                  <CheckIcon className="w-4 h-4 text-black" />
                </button>
                <button className="btn btn-ghost btn-sm hover:bg-red-50 bg-transparent" onClick={() => { setIsEditingSource(false); setSource(client.source || ''); }}>
                  <XMarkIcon className="w-4 h-4 text-black" />
                </button>
              </div>
            ) : (
              <button 
                className="btn btn-ghost btn-md bg-transparent hover:bg-transparent shadow-none"
                onClick={() => setIsEditingSource(true)}
              >
                <PencilSquareIcon className="w-5 h-5 text-black" />
              </button>
            )}
          </div>
          <div className="border-b border-gray-200 mt-2"></div>
        </div>
        <div className="p-6">
          <div className="space-y-3">
            {isEditingSource ? (
              <input
                className="input input-bordered w-full"
                value={source}
                onChange={e => setSource(e.target.value)}
                placeholder="Enter lead source..."
              />
            ) : (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  Auto Lead
                </span>
                <span className="text-gray-900 font-medium">{source || 'Not specified'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Facts of Case Section */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="pl-6 pt-2 pb-2 w-2/5">
          <h4 className="text-lg font-semibold text-black">Facts of Case</h4>
          <div className="border-b border-gray-200 mt-2"></div>
        </div>
        <div className="p-6">
          {client.facts && client.facts.trim() !== '' ? (
            <div className="bg-gray-50 rounded-lg p-4 min-h-[100px]">
              <p className="text-gray-900 whitespace-pre-line leading-relaxed">{client.facts}</p>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <div className="bg-gray-50 rounded-lg p-6">
                <p className="font-medium mb-1">No case facts specified</p>
                <p className="text-sm">Case facts will appear here when available</p>
              </div>
            </div>
          )}
        </div>
      </div>
      
    </div>
  );
};

export default MarketingTab; 