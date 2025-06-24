import React, { useState } from 'react';
import { ClientTabProps } from '../../types/client';
import { CurrencyDollarIcon, PencilSquareIcon } from '@heroicons/react/24/outline';

const PriceOfferTab: React.FC<ClientTabProps> = ({ client }) => {
  // Use values from client, fallback to defaults if missing
  const total = client?.proposal_total ?? 17000.0;
  const currency = client?.proposal_currency ?? 'NIS';
  const closer = client?.closer || '---';
  const proposal = client?.proposal_text ?? `Dear Client,\n\nWe are pleased to present you with the following price offer for our professional services regarding your case:\n\n- Comprehensive case review and documentation\n- Legal representation throughout the process\n- Ongoing support and communication\n\nOur team is committed to providing you with the highest level of service and expertise. Should you have any questions or require further clarification, please do not hesitate to contact us.\n\nWe look forward to working with you and achieving the best possible outcome for your case.\n\nBest regards,\nThe Law Firm Team`;

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
    <div className="p-8">
      <h2 className="text-3xl font-bold mb-2">Price offer</h2>
      <div className="text-lg mb-4 text-base-content/80">
        <span className="font-semibold">Closer:</span> {closer}
      </div>
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xl font-semibold">Total:</span>
        <span className="inline-flex items-center gap-2 bg-base-300 text-base-content font-bold rounded-lg px-4 py-2 text-lg tracking-wide shadow">
          <span className="text-base-content/70 text-base">₪</span>
          {total?.toLocaleString?.() ?? total} {currency && (
            <span className="ml-2 text-base-content/80 font-medium">{currency}</span>
          )}
        </span>
      </div>
      <div className="mb-2 text-lg font-semibold">Proposal:</div>
      <div className="mb-8">
        <textarea
          className="w-full min-h-[350px] max-h-[600px] border border-base-300 rounded-xl p-4 text-base font-medium bg-base-100 focus:outline-primary resize-none shadow"
          value={proposal}
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
    </div>
  );
};

export default PriceOfferTab; 