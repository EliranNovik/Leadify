import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import { InformationCircleIcon, ExclamationCircleIcon, PencilIcon, CheckIcon, XMarkIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import TimelineHistoryButtons from './TimelineHistoryButtons';

const InfoTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  if (!client) {
    return <div className="flex justify-center items-center h-32"><span className="loading loading-spinner loading-md text-primary"></span></div>;
  }

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

  // State to hold current user's display name
  const [currentUserName, setCurrentUserName] = useState<string>('Unknown');

  useEffect(() => {
    async function fetchUserName() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        const { data: userProfile } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        if (userProfile && userProfile.full_name) {
          setCurrentUserName(userProfile.full_name);
        } else {
          setCurrentUserName(user.email || 'Unknown');
        }
      }
    }
    fetchUserName();
  }, []);

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
            style={{ backgroundColor: '#3b28c7', color: 'white' }}
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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-blue-100 rounded-lg">
          <InformationCircleIcon className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Client Information</h2>
          <p className="text-sm text-gray-500">View and manage client details and case information</p>
        </div>
      </div>

      {/* Probability Section */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold text-gray-900">Case Probability</h4>
            <div className="tooltip" data-tip="Likelihood of successful case">
              <InformationCircleIcon className="w-5 h-5 text-gray-400 cursor-help" />
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-500">Success Probability</span>
              <span className="text-lg font-bold text-gray-900">{probability}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={probability}
              onChange={handleProbabilityChange}
              className="range range-primary w-full"
              step="1"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Info Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Followup */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <h4 className="text-lg font-semibold text-gray-900">Follow-up Status</h4>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {nextFollowupDate && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-500">Next Follow-up</span>
                    <span className="text-base font-semibold text-gray-900">{nextFollowupDate.toLocaleDateString()}</span>
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {followupStatus === 'Missed!' && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      <ExclamationCircleIcon className="w-3 h-3 mr-1" />
                      Missed!
                    </span>
                  )}
                  {followupStatus === 'Close to follow up' && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                      <ExclamationCircleIcon className="w-3 h-3 mr-1" />
                      Close to follow up
                    </span>
                  )}
                  {followupCountdown && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {followupCountdown}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Eligibility */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <h4 className="text-lg font-semibold text-gray-900">Eligibility Status</h4>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-500">Current Status</span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                  eligibilityDisplay.className === 'badge-success text-success-content' ? 'bg-green-100 text-green-800' :
                  eligibilityDisplay.className === 'badge-warning text-warning-content' ? 'bg-yellow-100 text-yellow-800' :
                  eligibilityDisplay.className === 'badge-error text-error-content' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {eligibilityDisplay.text}
                </span>
              </div>
            </div>
          </div>

          {/* Special Notes */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-gray-900">Special Notes</h4>
                <EditButtons
                  isEditing={isEditingSpecialNotes}
                  onEdit={() => {
                    setIsEditingSpecialNotes(true);
                    setEditedSpecialNotes(specialNotes.join('\n'));
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const { error } = await supabase
                        .from('leads')
                        .update({
                          special_notes: editedSpecialNotes,
                          special_notes_last_edited_by: userName,
                          special_notes_last_edited_at: new Date().toISOString(),
                        })
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
            </div>
            <div className="p-6">
              {isEditingSpecialNotes ? (
                <textarea
                  className="textarea textarea-bordered w-full h-32"
                  value={editedSpecialNotes}
                  onChange={(e) => setEditedSpecialNotes(e.target.value)}
                  placeholder="Add special notes here..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-lg p-4 min-h-[80px]">
                    {specialNotes.length > 0 ? (
                      specialNotes.map((note, index) => (
                        <p key={index} className="text-gray-900 mb-2 last:mb-0">{note}</p>
                      ))
                    ) : (
                      <span className="text-gray-500">No special notes added</span>
                    )}
                  </div>
                  {(client.special_notes_last_edited_by || client.special_notes_last_edited_at) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {client.special_notes_last_edited_by || 'Unknown'}</span>
                      <span>{client.special_notes_last_edited_at ? new Date(client.special_notes_last_edited_at).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* General Notes */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-gray-900">General Notes</h4>
                <EditButtons
                  isEditing={isEditingGeneralNotes}
                  onEdit={() => {
                    setIsEditingGeneralNotes(true);
                    setEditedGeneralNotes(generalNotes);
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const { error } = await supabase
                        .from('leads')
                        .update({
                          general_notes: editedGeneralNotes,
                          general_notes_last_edited_by: userName,
                          general_notes_last_edited_at: new Date().toISOString(),
                        })
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
            </div>
            <div className="p-6">
              {isEditingGeneralNotes ? (
                <textarea
                  className="textarea textarea-bordered w-full h-32"
                  value={editedGeneralNotes}
                  onChange={(e) => setEditedGeneralNotes(e.target.value)}
                  placeholder="Add general notes here..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-lg p-4 min-h-[80px]">
                    {generalNotes ? (
                      <p className="text-gray-900">{generalNotes}</p>
                    ) : (
                      <span className="text-gray-500">No general notes added</span>
                    )}
                  </div>
                  {(client.general_notes_last_edited_by || client.general_notes_last_edited_at) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {client.general_notes_last_edited_by || 'Unknown'}</span>
                      <span>{client.general_notes_last_edited_at ? new Date(client.general_notes_last_edited_at).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Tags */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-gray-900">Tags</h4>
                <EditButtons
                  isEditing={isEditingTags}
                  onEdit={() => {
                    setIsEditingTags(true);
                    setEditedTags(tags);
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const { error } = await supabase
                        .from('leads')
                        .update({
                          tags: editedTags,
                          tags_last_edited_by: userName,
                          tags_last_edited_at: new Date().toISOString(),
                        })
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
            </div>
            <div className="p-6">
              {isEditingTags ? (
                <textarea
                  className="textarea textarea-bordered w-full h-32"
                  value={editedTags}
                  onChange={(e) => setEditedTags(e.target.value)}
                  placeholder="Add tags here..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-lg p-4 min-h-[80px]">
                    {tags ? (
                      <p className="text-gray-900">{tags}</p>
                    ) : (
                      <span className="text-gray-500">No tags added</span>
                    )}
                  </div>
                  {(client.tags_last_edited_by || client.tags_last_edited_at) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {client.tags_last_edited_by || 'Unknown'}</span>
                      <span>{client.tags_last_edited_at ? new Date(client.tags_last_edited_at).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Anchor */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-gray-900">Anchor</h4>
                <EditButtons
                  isEditing={isEditingAnchor}
                  onEdit={() => {
                    setIsEditingAnchor(true);
                    setEditedAnchor(anchor);
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const { error } = await supabase
                        .from('leads')
                        .update({
                          anchor: editedAnchor,
                          anchor_last_edited_by: userName,
                          anchor_last_edited_at: new Date().toISOString(),
                        })
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
            </div>
            <div className="p-6">
              {isEditingAnchor ? (
                <textarea
                  className="textarea textarea-bordered w-full h-32"
                  value={editedAnchor}
                  onChange={(e) => setEditedAnchor(e.target.value)}
                  placeholder="Add anchor information..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-lg p-4 min-h-[80px]">
                    {anchor ? (
                      <p className="text-gray-900">{anchor}</p>
                    ) : (
                      <span className="text-gray-500">No anchor information</span>
                    )}
                  </div>
                  {(client.anchor_last_edited_by || client.anchor_last_edited_at) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {client.anchor_last_edited_by || 'Unknown'}</span>
                      <span>{client.anchor_last_edited_at ? new Date(client.anchor_last_edited_at).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Facts of Case */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-gray-900">Facts of Case</h4>
                <EditButtons
                  isEditing={isEditingFacts}
                  onEdit={() => {
                    setIsEditingFacts(true);
                    setEditedFacts(factsOfCase.join('\n'));
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const { error } = await supabase
                        .from('leads')
                        .update({
                          facts: editedFacts,
                          facts_last_edited_by: userName,
                          facts_last_edited_at: new Date().toISOString(),
                        })
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
            </div>
            <div className="p-6">
              {isEditingFacts ? (
                <textarea
                  className="textarea textarea-bordered w-full h-40"
                  value={editedFacts}
                  onChange={(e) => setEditedFacts(e.target.value)}
                  placeholder="Add case facts here..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-lg p-4 min-h-[120px]">
                    {factsOfCase.length > 0 ? (
                      factsOfCase.map((fact, index) => (
                        <p key={index} className="text-gray-900 mb-3 last:mb-0 font-medium">{fact}</p>
                      ))
                    ) : (
                      <span className="text-gray-500">No case facts added</span>
                    )}
                  </div>
                  {(client.facts_last_edited_by || client.facts_last_edited_at) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {client.facts_last_edited_by || 'Unknown'}</span>
                      <span>{client.facts_last_edited_at ? new Date(client.facts_last_edited_at).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <TimelineHistoryButtons client={client} />
    </div>
  );
};

export default InfoTab; 