import React, { useState } from 'react';
import { ClientTabProps } from '../../types/client';
import { MegaphoneIcon, MapPinIcon, PencilSquareIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
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

  // Location
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [location, setLocation] = useState(client.desired_location || '');

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

  const handleSaveLocation = async () => {
    await supabase
      .from('leads')
      .update({ desired_location: location })
      .eq('id', client.id);
    setIsEditingLocation(false);
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

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-6">
        <MegaphoneIcon className="w-6 h-6 text-primary" />
        <h3 className="text-lg font-semibold">Marketing</h3>
      </div>

      {/* Potential Section */}
      <div className="card bg-base-100 shadow-lg">
        <div className="card-body">
          <div className="flex justify-between items-center mb-4">
            <h2 className="card-title text-xl">Potential</h2>
            {isEditingPotential ? (
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={handleSavePotential}><CheckIcon className="w-4 h-4" /></button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setIsEditingPotential(false); setPotentialMetrics(client.potential_metrics || defaultPotentialMetrics); }}><XMarkIcon className="w-4 h-4" /></button>
              </div>
            ) : (
              <button className="btn btn-square btn-sm" style={{ backgroundColor: '#000', color: 'white' }} onClick={() => setIsEditingPotential(true)}>
                <PencilSquareIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="space-y-6">
            {potentialMetrics.map((metric, index) => (
              <div key={index} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-base-content/70">{metric.label}:</span>
                  {isEditingPotential ? (
                    <div className="flex gap-2 items-center">
                      <input
                        className="input input-sm w-24"
                        value={metric.value}
                        onChange={e => {
                          const newMetrics = [...potentialMetrics];
                          newMetrics[index].value = e.target.value;
                          setPotentialMetrics(newMetrics);
                        }}
                      />
                      <input
                        type="number"
                        className="input input-sm w-16"
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
                    <span className="font-medium">{metric.value}</span>
                  )}
                </div>
                <progress
                  className={`progress progress-${metric.color} w-full`}
                  value={metric.progress}
                  max="100"
                />
              </div>
            ))}

            {/* Desired Location */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-base-content/70">Desired Location</span>
                {isEditingLocation ? (
                  <div className="flex gap-2">
                    <button className="btn btn-ghost btn-sm" onClick={handleSaveLocation}><CheckIcon className="w-4 h-4" /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setIsEditingLocation(false); setLocation(client.desired_location || ''); }}><XMarkIcon className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <button className="btn btn-square btn-sm" style={{ backgroundColor: '#000', color: 'white' }} onClick={() => setIsEditingLocation(true)}>
                    <PencilSquareIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
              {isEditingLocation ? (
                <input
                  className="input input-sm w-full"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                />
              ) : (
                <span className="font-medium">{location || 'Unset'}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Source Section */}
      <div className="card bg-base-100 shadow-lg mt-6">
        <div className="card-body">
          <h2 className="card-title text-xl mb-2 flex items-center gap-2">
            Source
            {isEditingSource ? (
              <>
                <button className="btn btn-ghost btn-sm" onClick={handleSaveSource}><CheckIcon className="w-4 h-4" /></button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setIsEditingSource(false); setSource(client.source || ''); }}><XMarkIcon className="w-4 h-4" /></button>
              </>
            ) : (
              <button className="btn btn-square btn-sm" style={{ backgroundColor: '#000', color: 'white' }} onClick={() => setIsEditingSource(true)}>
                <PencilSquareIcon className="w-4 h-4" />
              </button>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {isEditingSource ? (
              <input
                className="input input-sm w-32"
                value={source}
                onChange={e => setSource(e.target.value)}
              />
            ) : (
              <>
                <span className="badge badge-primary">Auto lead</span>
                <span className="text-base-content/70">{source}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Facts of Case Section */}
      <div className="card bg-base-100 shadow-lg mt-6">
        <div className="card-body">
          <h2 className="card-title text-xl mb-2">Facts of Case</h2>
          {client.facts && client.facts.trim() !== '' ? (
            <div className="bg-base-200 p-4 rounded-lg whitespace-pre-line">
              {client.facts}
            </div>
          ) : (
            <div className="alert bg-base-200">
              <span>No case facts have been specified yet</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarketingTab; 