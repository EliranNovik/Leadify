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
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
          <MegaphoneIcon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Marketing Information</h2>
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

      {/* Desired Location Section */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="pl-6 pt-2 pb-2 w-2/5">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold text-black">Desired Location</h4>
            {isEditingLocation ? (
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm hover:bg-green-50 bg-transparent" onClick={handleSaveLocation}>
                  <CheckIcon className="w-4 h-4 text-black" />
                </button>
                <button className="btn btn-ghost btn-sm hover:bg-red-50 bg-transparent" onClick={() => { setIsEditingLocation(false); setLocation(client.desired_location || ''); }}>
                  <XMarkIcon className="w-4 h-4 text-black" />
                </button>
              </div>
            ) : (
              <button 
                className="btn btn-ghost btn-md bg-transparent hover:bg-transparent shadow-none"
                onClick={() => setIsEditingLocation(true)}
              >
                <PencilSquareIcon className="w-5 h-5 text-black" />
              </button>
            )}
          </div>
          <div className="border-b border-gray-200 mt-2"></div>
        </div>
        <div className="p-6">
          <div className="space-y-2">
            {isEditingLocation ? (
              <input
                className="input input-bordered w-full"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="Enter desired location..."
              />
            ) : (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <MapPinIcon className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-900 font-medium">{location || 'Not specified'}</span>
                </div>
              </div>
            )}
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