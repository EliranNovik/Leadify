import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import { InformationCircleIcon, ExclamationCircleIcon, PencilIcon, CheckIcon, XMarkIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';

const InfoTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const [probability, setProbability] = useState(client.probability || 50);
  const [isEditingSpecialNotes, setIsEditingSpecialNotes] = useState(false);
  const [isEditingGeneralNotes, setIsEditingGeneralNotes] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [isEditingAnchor, setIsEditingAnchor] = useState(false);
  const [isEditingFacts, setIsEditingFacts] = useState(false);
  
  const [specialNotes, setSpecialNotes] = useState(client.special_notes ? [client.special_notes] : ['No special notes']);
  const [generalNotes, setGeneralNotes] = useState(client.general_notes || '');
  const [tags, setTags] = useState(client.tags || '');
  const [anchor, setAnchor] = useState(client.anchor || '');
  const [factsOfCase, setFactsOfCase] = useState(client.facts ? [client.facts] : ['No facts of case']);

  const [editedSpecialNotes, setEditedSpecialNotes] = useState(specialNotes.join('\n'));
  const [editedGeneralNotes, setEditedGeneralNotes] = useState(generalNotes);
  const [editedTags, setEditedTags] = useState(tags);
  const [editedAnchor, setEditedAnchor] = useState(anchor);
  const [editedFacts, setEditedFacts] = useState(factsOfCase.join('\n'));

  // Update state when client data changes (e.g., after page refresh)
  useEffect(() => {
    setProbability(client.probability || 50);
    setSpecialNotes(client.special_notes ? [client.special_notes] : ['No special notes']);
    setGeneralNotes(client.general_notes || '');
    setTags(client.tags || '');
    setAnchor(client.anchor || '');
    setFactsOfCase(client.facts ? [client.facts] : ['No facts of case']);
    
    // Update edited values as well
    setEditedSpecialNotes(client.special_notes || '');
    setEditedGeneralNotes(client.general_notes || '');
    setEditedTags(client.tags || '');
    setEditedAnchor(client.anchor || '');
    setEditedFacts(client.facts || '');
  }, [client]);

  const handleProbabilityChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newProbability = Number(event.target.value);
    setProbability(newProbability);
    
    try {
      const { error } = await supabase
        .from('leads')
        .update({ probability: newProbability })
        .eq('id', client.id);
      
      if (error) throw error;
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error updating probability:', error);
      alert('Failed to update probability');
    }
  };

  const EditButtons = ({ isEditing, onEdit, onSave, onCancel }: { 
    isEditing: boolean; 
    onEdit: () => void; 
    onSave: () => void; 
    onCancel: () => void;
  }) => (
    <div className="flex gap-2">
      {isEditing ? (
        <>
          <button 
            className="btn btn-circle btn-ghost btn-sm"
            onClick={onSave}
          >
            <CheckIcon className="w-4 h-4 text-success" />
          </button>
          <button 
            className="btn btn-circle btn-ghost btn-sm"
            onClick={onCancel}
          >
            <XMarkIcon className="w-4 h-4 text-error" />
          </button>
        </>
      ) : (
        <>
          <button 
            className="btn btn-square btn-sm"
            style={{ backgroundColor: '#000000', color: 'white' }}
            onClick={onEdit}
          >
            <PencilSquareIcon className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );

  const getEligibilityDisplay = (status: string | undefined) => {
    switch (status) {
      case 'feasible_no_check':
        return { text: 'Feasible (no check)', className: 'badge-success text-success-content' };
      case 'feasible_check':
        return { text: 'Feasible (further check)', className: 'badge-warning text-warning-content' };
      case 'not_feasible':
        return { text: 'No feasibility', className: 'badge-error text-error-content' };
      default:
        return { text: 'Not checked', className: 'badge-neutral' };
    }
  };

  const eligibilityDisplay = getEligibilityDisplay(client.eligibility_status);

  // Follow-up status logic
  const today = new Date();
  const nextFollowupDate = client.next_followup ? new Date(client.next_followup) : null;
  let followupStatus = '';
  let followupCountdown = '';
  if (nextFollowupDate) {
    // Remove time for comparison
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const followupMidnight = new Date(nextFollowupDate.getFullYear(), nextFollowupDate.getMonth(), nextFollowupDate.getDate());
    const diffDays = Math.floor((todayMidnight.getTime() - followupMidnight.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === -1 || diffDays === 0) {
      followupStatus = 'Close to follow up';
    } else if (diffDays === 1) {
      followupStatus = 'Missed!';
    } else if (diffDays < -1) {
      followupCountdown = `Follow up in ${Math.abs(diffDays)} days`;
    }
  }

  return (
    <div className="p-6 space-y-8">
      {/* Probability Section */}
      <div className="bg-base-200 p-4 rounded-lg">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-lg font-medium">Probability: {probability}%</label>
            <div className="tooltip" data-tip="Likelihood of successful case">
              <InformationCircleIcon className="w-5 h-5 text-primary cursor-help" />
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={probability}
            onChange={handleProbabilityChange}
            className="range"
            step="1"
          />
          <div className="w-full flex justify-between text-xs px-2">
            <span>|</span>
            <span>|</span>
            <span>|</span>
            <span>|</span>
            <span>|</span>
          </div>
        </div>
      </div>

      {/* Main Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Followup */}
          <div className="card bg-base-200">
            <div className="card-body p-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Followup</h3>
                <div className="flex items-center gap-2">
                  {followupStatus === 'Missed!' && (
                    <div className="badge badge-error gap-2">
                      <ExclamationCircleIcon className="w-4 h-4" />
                      Missed!
                    </div>
                  )}
                  {followupStatus === 'Close to follow up' && (
                    <div className="badge badge-warning gap-2">
                      <ExclamationCircleIcon className="w-4 h-4" />
                      Close to follow up
                    </div>
                  )}
                  {nextFollowupDate && (
                    <span className="font-medium">{nextFollowupDate.toLocaleDateString()}</span>
                  )}
                  {followupCountdown && (
                    <span className="ml-2 badge badge-info">{followupCountdown}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Eligibility */}
          <div className="card bg-base-200">
            <div className="card-body p-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Eligibility</h3>
                <div className={`badge ${eligibilityDisplay.className}`}>{eligibilityDisplay.text}</div>
              </div>
            </div>
          </div>

          {/* Special Notes */}
          <div className="card bg-base-200">
            <div className="card-body p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-medium">Special Notes</h3>
                <EditButtons
                  isEditing={isEditingSpecialNotes}
                  onEdit={() => {
                    setIsEditingSpecialNotes(true);
                    setEditedSpecialNotes(specialNotes.join('\n'));
                  }}
                  onSave={async () => {
                    try {
                      const { error } = await supabase
                        .from('leads')
                        .update({ special_notes: editedSpecialNotes })
                        .eq('id', client.id);
                      
                      if (error) throw error;
                      
                      setSpecialNotes(editedSpecialNotes.split('\n').filter(note => note.trim() !== ''));
                      setIsEditingSpecialNotes(false);
                      
                      // Refresh client data in parent component
                      if (onClientUpdate) {
                        await onClientUpdate();
                      }
                    } catch (error) {
                      console.error('Error updating special notes:', error);
                      alert('Failed to update special notes');
                    }
                  }}
                  onCancel={() => setIsEditingSpecialNotes(false)}
                />
              </div>
              {isEditingSpecialNotes ? (
                <textarea
                  className="textarea textarea-bordered w-full h-24 text-right"
                  value={editedSpecialNotes}
                  onChange={(e) => setEditedSpecialNotes(e.target.value)}
                  dir="rtl"
                />
              ) : (
                <div className="bg-success/20 p-3 rounded-lg text-left">
                  {specialNotes.map((note, index) => (
                    <p key={index}>{note}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* General Notes */}
          <div className="card bg-base-200">
            <div className="card-body p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-medium">General Notes</h3>
                <EditButtons
                  isEditing={isEditingGeneralNotes}
                  onEdit={() => {
                    setIsEditingGeneralNotes(true);
                    setEditedGeneralNotes(generalNotes);
                  }}
                  onSave={async () => {
                    try {
                      const { error } = await supabase
                        .from('leads')
                        .update({ general_notes: editedGeneralNotes })
                        .eq('id', client.id);
                      
                      if (error) throw error;
                      
                      setGeneralNotes(editedGeneralNotes);
                      setIsEditingGeneralNotes(false);
                      
                      // Refresh client data in parent component
                      if (onClientUpdate) {
                        await onClientUpdate();
                      }
                    } catch (error) {
                      console.error('Error updating general notes:', error);
                      alert('Failed to update general notes');
                    }
                  }}
                  onCancel={() => setIsEditingGeneralNotes(false)}
                />
              </div>
              {isEditingGeneralNotes ? (
                <textarea
                  className="textarea textarea-bordered w-full h-24"
                  value={editedGeneralNotes}
                  onChange={(e) => setEditedGeneralNotes(e.target.value)}
                  placeholder="Add general notes here..."
                />
              ) : (
                <div className="p-3 rounded-lg">
                  {generalNotes || <span className="text-base-content/50">No general notes added</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Tags */}
          <div className="card bg-base-200">
            <div className="card-body p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-medium">Tags</h3>
                <EditButtons
                  isEditing={isEditingTags}
                  onEdit={() => {
                    setIsEditingTags(true);
                    setEditedTags(tags);
                  }}
                  onSave={async () => {
                    try {
                      const { error } = await supabase
                        .from('leads')
                        .update({ tags: editedTags })
                        .eq('id', client.id);
                      
                      if (error) throw error;
                      
                      setTags(editedTags);
                      setIsEditingTags(false);
                      
                      // Refresh client data in parent component
                      if (onClientUpdate) {
                        await onClientUpdate();
                      }
                    } catch (error) {
                      console.error('Error updating tags:', error);
                      alert('Failed to update tags');
                    }
                  }}
                  onCancel={() => setIsEditingTags(false)}
                />
              </div>
              {isEditingTags ? (
                <textarea
                  className="textarea textarea-bordered w-full h-24"
                  value={editedTags}
                  onChange={(e) => setEditedTags(e.target.value)}
                  placeholder="Add tags here..."
                />
              ) : (
                <div className="text-base-content/70">
                  {tags || '---'}
                </div>
              )}
            </div>
          </div>

          {/* Anchor */}
          <div className="card bg-base-200">
            <div className="card-body p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-medium">Anchor</h3>
                <EditButtons
                  isEditing={isEditingAnchor}
                  onEdit={() => {
                    setIsEditingAnchor(true);
                    setEditedAnchor(anchor);
                  }}
                  onSave={async () => {
                    try {
                      const { error } = await supabase
                        .from('leads')
                        .update({ anchor: editedAnchor })
                        .eq('id', client.id);
                      
                      if (error) throw error;
                      
                      setAnchor(editedAnchor);
                      setIsEditingAnchor(false);
                      
                      // Refresh client data in parent component
                      if (onClientUpdate) {
                        await onClientUpdate();
                      }
                    } catch (error) {
                      console.error('Error updating anchor:', error);
                      alert('Failed to update anchor');
                    }
                  }}
                  onCancel={() => setIsEditingAnchor(false)}
                />
              </div>
              {isEditingAnchor ? (
                <textarea
                  className="textarea textarea-bordered w-full h-24"
                  value={editedAnchor}
                  onChange={(e) => setEditedAnchor(e.target.value)}
                  placeholder="Add anchor information..."
                />
              ) : (
                <div className="text-base-content/70">
                  {anchor || 'No anchor information'}
                </div>
              )}
            </div>
          </div>

          {/* Facts of Case */}
          <div className="card bg-base-200">
            <div className="card-body p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-medium">Facts of Case</h3>
                <EditButtons
                  isEditing={isEditingFacts}
                  onEdit={() => {
                    setIsEditingFacts(true);
                    setEditedFacts(factsOfCase.join('\n'));
                  }}
                  onSave={async () => {
                    try {
                      const { error } = await supabase
                        .from('leads')
                        .update({ facts: editedFacts })
                        .eq('id', client.id);
                      
                      if (error) throw error;
                      
                      setFactsOfCase(editedFacts.split('\n').filter(fact => fact.trim() !== ''));
                      setIsEditingFacts(false);
                      
                      // Refresh client data in parent component
                      if (onClientUpdate) {
                        await onClientUpdate();
                      }
                    } catch (error) {
                      console.error('Error updating facts:', error);
                      alert('Failed to update facts');
                    }
                  }}
                  onCancel={() => setIsEditingFacts(false)}
                />
              </div>
              {isEditingFacts ? (
                <textarea
                  className="textarea textarea-bordered w-full h-48 text-right"
                  value={editedFacts}
                  onChange={(e) => setEditedFacts(e.target.value)}
                  dir="rtl"
                />
              ) : (
                <div className="space-y-4 text-left">
                  {factsOfCase.map((fact, index) => (
                    <p key={index} className="font-medium">{fact}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InfoTab; 