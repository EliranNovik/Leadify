import React, { useState } from 'react';
import { ClientTabProps } from '../../types/client';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { CurrencyDollarIcon, PencilSquareIcon } from '@heroicons/react/24/outline';

const PriceOfferTab: React.FC<ClientTabProps> = ({ client }) => {
  // Use values from client, fallback to defaults if missing
  const total = client?.proposal_total;
  const currency = client?.proposal_currency ?? 'NIS';
  const closer = client?.closer || '---';
  const proposal = client?.proposal_text ?? '';

  const [isEditing, setIsEditing] = useState(false);
  const [editTotal, setEditTotal] = useState(total);
  const [editExtra, setEditExtra] = useState(3060.0);

  const handleEdit = () => {
    setEditTotal(total);
    setEditExtra(3060.0);
    setIsEditing(true);
  };

  const handleSave = () => {
    // Handle saving the edited total and extra
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  return (
    <div className="p-2 sm:p-4 md:p-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
          <CurrencyDollarIcon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Price Offer</h2>
          <p className="text-sm text-gray-500">Manage pricing and proposals</p>
        </div>
      </div>
      <div className="text-lg mb-4 text-base-content/80">
        <span className="font-semibold">Closer:</span> {closer}
      </div>
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xl font-semibold">Total:</span>
        <span className="inline-flex items-center gap-2 bg-base-300 text-base-content font-bold rounded-lg px-4 py-2 text-lg tracking-wide shadow">
          <span className="text-base-content/70 text-base">₪</span>
          {typeof total === 'number' && !isNaN(total) ? total.toLocaleString() : '--'}
          {currency && (
            <span className="ml-2 text-base-content/80 font-medium">{currency}</span>
          )}
        </span>
      </div>
      <div className="mb-2 text-lg font-semibold">Proposal:</div>
      <div className="mb-8">
        <textarea
          className="w-full min-h-[350px] max-h-[600px] border border-base-300 rounded-xl p-4 text-base font-medium bg-base-100 focus:outline-primary resize-none shadow"
          value={proposal}
          placeholder="Enter your price offer proposal here..."
          readOnly
        />
      </div>
      {isEditing ? (
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center mb-2">
          <div className="flex gap-2 items-center">
            <label className="font-semibold">Total:</label>
            <input
              type="number"
              className="input input-bordered w-28"
              value={editTotal}
              onChange={e => setEditTotal(Number(e.target.value))}
              min={0}
            />
          </div>
          <div className="flex gap-2 items-center">
            <label className="font-semibold">Extra:</label>
            <input
              type="number"
              className="input input-bordered w-28"
              value={editExtra}
              onChange={e => setEditExtra(Number(e.target.value))}
              min={0}
            />
          </div>
          <div className="flex gap-2 mt-2 sm:mt-0">
            <button className="btn btn-success btn-sm" onClick={handleSave}>Save</button>
            <button className="btn btn-ghost btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-outline flex items-center gap-2" onClick={handleEdit}>
          <PencilSquareIcon className="w-5 h-5" />
          Edit Total
        </button>
      )}
      
      <TimelineHistoryButtons client={client} />
    </div>
  );
};

export default PriceOfferTab; 