import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import { InformationCircleIcon, ExclamationCircleIcon, PencilIcon, CheckIcon, XMarkIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import TimelineHistoryButtons from './TimelineHistoryButtons';

// Helper function to clean up text formatting
const formatNoteText = (text: string): string => {
  if (!text) return '';
  
  // Replace \r\n with \n, then \r with \n for proper line breaks
  // Also handle escaped \r characters (\\r)
  return text
    .replace(/\\r\\n/g, '\n')  // Handle escaped \r\n
    .replace(/\\r/g, '\n')     // Handle escaped \r
    .replace(/\r\n/g, '\n')    // Handle actual \r\n
    .replace(/\r/g, '\n')      // Handle actual \r
    .trim();
};

// Helper function to detect Hebrew text and apply RTL alignment
const getTextAlignment = (text: string): string => {
  if (!text) return 'text-left';
  
  // Check if text contains Hebrew characters (Unicode range 0590-05FF)
  const hebrewRegex = /[\u0590-\u05FF]/;
  return hebrewRegex.test(text) ? 'text-right' : 'text-left';
};

// Helper function to get the correct field value based on lead type
const getFieldValue = (client: any, fieldName: string, legacyFieldName?: string) => {
  if (client.lead_type === 'legacy') {
    // For legacy leads, use the legacy field name if provided, otherwise use the original
    const fieldToUse = legacyFieldName || fieldName;
    return client[fieldToUse];
  }
  // For new leads, use the original field name
  return client[fieldName];
};

// Helper function to determine if this is a legacy lead
const isLegacyLead = (client: any) => {
  return client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
};

const InfoTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  if (!client) {
    return <div className="flex justify-center items-center h-32"><span className="loading loading-spinner loading-md text-primary"></span></div>;
  }

  // Check if this is a legacy lead
  const isLegacy = isLegacyLead(client);

  // Get field values with proper mapping for legacy leads
  const getProbability = () => {
    const prob = getFieldValue(client, 'probability');
    if (isLegacy && typeof prob === 'string') {
      return parseInt(prob) || 50;
    }
    return prob || 50;
  };

  const getSpecialNotes = () => {
    const notes = getFieldValue(client, 'special_notes');
    return notes ? [notes] : [];
  };

  const getGeneralNotes = () => {
    // For legacy leads, use 'notes' field instead of 'general_notes'
    const notes = isLegacy ? getFieldValue(client, 'notes') : getFieldValue(client, 'general_notes');
    return notes || '';
  };

  const getTags = () => {
    // For legacy leads, use 'category' field instead of 'tags'
    const tags = isLegacy ? getFieldValue(client, 'category') : getFieldValue(client, 'tags');
    return tags || '';
  };

  const getAnchor = () => {
    // For legacy leads, use 'anchor_full_name' field instead of 'anchor'
    const anchor = isLegacy ? getFieldValue(client, 'anchor_full_name') : getFieldValue(client, 'anchor');
    return anchor || '';
  };

  const getFacts = () => {
    // For legacy leads, use 'description' field instead of 'facts'
    const facts = isLegacy ? getFieldValue(client, 'description') : getFieldValue(client, 'facts');
    
    if (!facts) return [];
    
    try {
      // Try to parse as JSON first
      const parsedFacts = JSON.parse(facts);
      
      // If it's an object, extract non-null values
      if (typeof parsedFacts === 'object' && parsedFacts !== null) {
        const nonNullFacts = Object.entries(parsedFacts)
          .filter(([key, value]) => value !== null && value !== undefined && value !== '')
          .map(([key, value]) => ({ key, value }));
        
        return nonNullFacts;
      }
      
      // If it's not an object, treat as plain text
      return [{ key: 'facts', value: facts }];
    } catch (error) {
      // If JSON parsing fails, treat as plain text
      return [{ key: 'facts', value: facts }];
    }
  };

  const getEligibilityStatus = () => {
    // For legacy leads, use 'eligibile' field instead of 'eligibility_status'
    const status = isLegacy ? getFieldValue(client, 'eligibile') : getFieldValue(client, 'eligibility_status');
    return status || '';
  };

  const getNextFollowup = () => {
    return getFieldValue(client, 'next_followup');
  };

  const [probability, setProbability] = useState(getProbability());
  const [isEditingSpecialNotes, setIsEditingSpecialNotes] = useState(false);
  const [isEditingGeneralNotes, setIsEditingGeneralNotes] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [isEditingAnchor, setIsEditingAnchor] = useState(false);
  const [isEditingFacts, setIsEditingFacts] = useState(false);
  
  const [specialNotes, setSpecialNotes] = useState(getSpecialNotes());
  const [generalNotes, setGeneralNotes] = useState(getGeneralNotes());
  const [tags, setTags] = useState(getTags());
  const [anchor, setAnchor] = useState(getAnchor());
  const [factsOfCase, setFactsOfCase] = useState(getFacts());

  const [editedSpecialNotes, setEditedSpecialNotes] = useState(specialNotes.join('\n'));
  const [editedGeneralNotes, setEditedGeneralNotes] = useState(generalNotes);
  const [editedTags, setEditedTags] = useState(tags);
  const [editedAnchor, setEditedAnchor] = useState(anchor);
  const [editedFacts, setEditedFacts] = useState(() => {
    const facts = getFacts();
    if (Array.isArray(facts)) {
      return facts.map(fact => `${fact.key}: ${fact.value}`).join('\n');
    }
    return '';
  });

  // Update state when client data changes (e.g., after page refresh)
  useEffect(() => {
    setProbability(getProbability());
    setSpecialNotes(getSpecialNotes());
    setGeneralNotes(getGeneralNotes());
    setTags(getTags());
    setAnchor(getAnchor());
    setFactsOfCase(getFacts());
    
    // Update edited values as well
    setEditedSpecialNotes(getSpecialNotes().join('\n'));
    setEditedGeneralNotes(getGeneralNotes());
    setEditedTags(getTags());
    setEditedAnchor(getAnchor());
    setEditedFacts(() => {
      const facts = getFacts();
      if (Array.isArray(facts)) {
        return facts.map(fact => `${fact.key}: ${fact.value}`).join('\n');
      }
      return '';
    });
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
      // Determine which table to update based on lead type
      const tableName = isLegacy ? 'leads_lead' : 'leads';
      const idField = isLegacy ? 'id' : 'id';
      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
      
      const { error } = await supabase
        .from(tableName)
        .update({ probability: newProbability })
        .eq(idField, clientId);
      
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

  const EditButtons = ({ isEditing, onEdit, onSave, onCancel, editButtonClassName, editIconClassName }: { 
    isEditing: boolean; 
    onEdit: () => void; 
    onSave: () => void; 
    onCancel: () => void;
    editButtonClassName?: string;
    editIconClassName?: string;
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
            className={`${editButtonClassName} btn btn-sm`}
            onClick={onEdit}
          >
            <PencilSquareIcon className={`w-4 h-4 ${editIconClassName}`} />
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

  const eligibilityDisplay = getEligibilityDisplay(getEligibilityStatus());

  // Follow-up status logic
  const today = new Date();
  const nextFollowupDate = getNextFollowup() ? new Date(getNextFollowup()) : null;
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
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
          <InformationCircleIcon className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">Client Information</h2>
            {isLegacy && (
              <span className="badge badge-warning badge-sm text-white">
                Legacy Lead
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">View and manage client details and case information</p>
        </div>
      </div>

      {/* Main Info Grid */}
      <div className="space-y-12">
        {/* Row 1: Case Probability, Follow-up Status, Eligibility Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 gap-y-12">
          {/* Case Probability */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-black">Case Probability</h4>
                <div className="tooltip" data-tip="Likelihood of successful case">
                  <InformationCircleIcon className="w-5 h-5 text-gray-400 cursor-help" />
                </div>
              </div>
              <div className="border-b border-gray-200 mt-2"></div>
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

          {/* Followup */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <h4 className="text-lg font-semibold text-black">Follow-up Status</h4>
              <div className="border-b border-gray-200 mt-2"></div>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {nextFollowupDate && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-500">Next Follow-up</span>
                    <span className="text-base font-semibold text-gray-900">{nextFollowupDate.toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Eligibility */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <h4 className="text-lg font-semibold text-black">Eligibility Status</h4>
              <div className="border-b border-gray-200 mt-2"></div>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-500">Current Status</span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#3b28c7] text-white ${getEligibilityStatus() === 'feasible_no_check' ? 'px-4 py-2 text-base rounded-xl' : ''}`}>
                  {eligibilityDisplay.text}
                  {['feasible_no_check', 'feasible_check'].includes(getEligibilityStatus() ?? '') && (client.section_eligibility ?? '') && (
                    <span className="ml-2 px-2 py-0.5 rounded text-white font-semibold text-xs">
                      {(() => {
                        // Map section_eligibility to label as in ExpertTab
                        const sections = [
                          { value: '116', label: 'German Citizenship - § 116' },
                          { value: '15', label: 'German Citizenship - § 15' },
                          { value: '5', label: 'German Citizenship - § 5' },
                          { value: '58c', label: 'Austrian Citizenship - § 58c' },
                        ];
                        const found = sections.find(s => s.value === (client.section_eligibility ?? ''));
                        return found ? found.label.split(' - ')[1] : client.section_eligibility;
                      })()}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Special Notes */}
        <div className="grid grid-cols-1 gap-6 gap-y-12">
          {/* Special Notes */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-black">Special Notes</h4>
                <EditButtons
                  isEditing={isEditingSpecialNotes}
                  onEdit={() => {
                    setIsEditingSpecialNotes(true);
                    setEditedSpecialNotes(specialNotes.map(note => formatNoteText(note)).join('\n'));
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const tableName = isLegacy ? 'leads_lead' : 'leads';
                      const idField = isLegacy ? 'id' : 'id';
                      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
                      
                      const { error } = await supabase
                        .from(tableName)
                        .update({
                          special_notes: formatNoteText(editedSpecialNotes),
                          special_notes_last_edited_by: userName,
                          special_notes_last_edited_at: new Date().toISOString(),
                        })
                        .eq(idField, clientId);
                      
                      if (error) throw error;
                      
                      setSpecialNotes(formatNoteText(editedSpecialNotes).split('\n').filter(note => note.trim() !== ''));
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
                  editButtonClassName="btn btn-ghost btn-sm"
                  editIconClassName="w-5 h-5 text-black"
                />
              </div>
              <div className="border-b border-gray-200 mt-2"></div>
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
                  <div className="min-h-[80px]">
                    {specialNotes.length > 0 ? (
                      specialNotes.map((note, index) => (
                        <p key={index} className={`text-gray-900 mb-2 last:mb-0 whitespace-pre-wrap break-words ${getTextAlignment(formatNoteText(note))}`}>{formatNoteText(note)}</p>
                      ))
                    ) : (
                      <span className="text-gray-500">No special notes added</span>
                    )}
                  </div>
                  {(getFieldValue(client, 'special_notes_last_edited_by') || getFieldValue(client, 'special_notes_last_edited_at')) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {getFieldValue(client, 'special_notes_last_edited_by') || 'Unknown'}</span>
                      <span>{getFieldValue(client, 'special_notes_last_edited_at') ? new Date(getFieldValue(client, 'special_notes_last_edited_at')).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 3: General Notes */}
        <div className="grid grid-cols-1 gap-6 gap-y-12">
          {/* General Notes */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-black">General Notes</h4>
                <EditButtons
                  isEditing={isEditingGeneralNotes}
                  onEdit={() => {
                    setIsEditingGeneralNotes(true);
                    setEditedGeneralNotes(formatNoteText(generalNotes));
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const tableName = isLegacy ? 'leads_lead' : 'leads';
                      const idField = isLegacy ? 'id' : 'id';
                      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
                      
                      const { error } = await supabase
                        .from(tableName)
                        .update({
                          [isLegacy ? 'notes' : 'general_notes']: formatNoteText(editedGeneralNotes),
                          [isLegacy ? 'notes_last_edited_by' : 'general_notes_last_edited_by']: userName,
                          [isLegacy ? 'notes_last_edited_at' : 'general_notes_last_edited_at']: new Date().toISOString(),
                        })
                        .eq(idField, clientId);
                      
                      if (error) throw error;
                      
                      setGeneralNotes(formatNoteText(editedGeneralNotes));
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
                  editButtonClassName="btn btn-ghost btn-sm"
                  editIconClassName="w-5 h-5 text-black"
                />
              </div>
              <div className="border-b border-gray-200 mt-2"></div>
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
                  <div className="min-h-[80px]">
                    {generalNotes ? (
                      <p className={`text-gray-900 whitespace-pre-wrap break-words ${getTextAlignment(formatNoteText(generalNotes))}`}>{formatNoteText(generalNotes)}</p>
                    ) : (
                      <span className="text-gray-500">No general notes added</span>
                    )}
                  </div>
                  {(getFieldValue(client, isLegacy ? 'notes_last_edited_by' : 'general_notes_last_edited_by') || getFieldValue(client, isLegacy ? 'notes_last_edited_at' : 'general_notes_last_edited_at')) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {getFieldValue(client, isLegacy ? 'notes_last_edited_by' : 'general_notes_last_edited_by') || 'Unknown'}</span>
                      <span>{getFieldValue(client, isLegacy ? 'notes_last_edited_at' : 'general_notes_last_edited_at') ? new Date(getFieldValue(client, isLegacy ? 'notes_last_edited_at' : 'general_notes_last_edited_at')).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 4: Facts of Case */}
        <div className="grid grid-cols-1 gap-6 gap-y-12">
          {/* Facts of Case */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-black">Facts of Case</h4>
                <EditButtons
                  isEditing={isEditingFacts}
                  onEdit={() => {
                    setIsEditingFacts(true);
                    setEditedFacts(factsOfCase.map(fact => `${fact.key}: ${fact.value}`).join('\n'));
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const tableName = isLegacy ? 'leads_lead' : 'leads';
                      const idField = isLegacy ? 'id' : 'id';
                      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
                      
                      const { error } = await supabase
                        .from(tableName)
                        .update({
                          [isLegacy ? 'description' : 'facts']: formatNoteText(editedFacts),
                          [isLegacy ? 'description_last_edited_by' : 'facts_last_edited_by']: userName,
                          [isLegacy ? 'description_last_edited_at' : 'facts_last_edited_at']: new Date().toISOString(),
                        })
                        .eq(idField, clientId);
                      
                      if (error) throw error;
                      
                      setFactsOfCase(formatNoteText(editedFacts).split('\n').filter(fact => fact.trim() !== ''));
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
                  editButtonClassName="btn btn-ghost btn-sm"
                  editIconClassName="w-5 h-5 text-black"
                />
              </div>
              <div className="border-b border-gray-200 mt-2"></div>
            </div>
            <div className="p-6">
              {isEditingFacts ? (
                <textarea
                  className="textarea textarea-bordered w-full h-32"
                  value={editedFacts}
                  onChange={(e) => setEditedFacts(e.target.value)}
                  placeholder="Add case facts here..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="min-h-[80px]">
                    {factsOfCase.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {factsOfCase.map((fact, index) => (
                          <div key={index} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                            <span className="text-sm font-medium text-gray-600 capitalize">{fact.key}:</span>
                            <span className="text-sm text-gray-900 ml-1">{fact.value}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-500">No case facts added</span>
                    )}
                  </div>
                  {(getFieldValue(client, isLegacy ? 'description_last_edited_by' : 'facts_last_edited_by') || getFieldValue(client, isLegacy ? 'description_last_edited_at' : 'facts_last_edited_at')) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {getFieldValue(client, isLegacy ? 'description_last_edited_by' : 'facts_last_edited_by') || 'Unknown'}</span>
                      <span>{getFieldValue(client, isLegacy ? 'description_last_edited_at' : 'facts_last_edited_at') ? new Date(getFieldValue(client, isLegacy ? 'description_last_edited_at' : 'facts_last_edited_at')).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 5: Anchor and Tags */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 gap-y-12">
          {/* Anchor */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-black">Anchor</h4>
                <EditButtons
                  isEditing={isEditingAnchor}
                  onEdit={() => {
                    setIsEditingAnchor(true);
                    setEditedAnchor(anchor);
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const tableName = isLegacy ? 'leads_lead' : 'leads';
                      const idField = isLegacy ? 'id' : 'id';
                      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
                      
                      const { error } = await supabase
                        .from(tableName)
                        .update({
                          [isLegacy ? 'anchor_full_name' : 'anchor']: editedAnchor,
                          [isLegacy ? 'anchor_full_name_last_edited_by' : 'anchor_last_edited_by']: userName,
                          [isLegacy ? 'anchor_full_name_last_edited_at' : 'anchor_last_edited_at']: new Date().toISOString(),
                        })
                        .eq(idField, clientId);
                      
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
                  editButtonClassName="btn btn-ghost btn-sm"
                  editIconClassName="w-5 h-5 text-black"
                />
              </div>
              <div className="border-b border-gray-200 mt-2"></div>
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
                  <div className="min-h-[80px]">
                    {anchor ? (
                      <p className={`text-gray-900 ${getTextAlignment(anchor)}`}>{anchor}</p>
                    ) : (
                      <span className="text-gray-500">No anchor information</span>
                    )}
                  </div>
                  {(getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_by' : 'anchor_last_edited_by') || getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_at' : 'anchor_last_edited_at')) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_by' : 'anchor_last_edited_by') || 'Unknown'}</span>
                      <span>{getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_at' : 'anchor_last_edited_at') ? new Date(getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_at' : 'anchor_last_edited_at')).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-black">Tags</h4>
                <EditButtons
                  isEditing={isEditingTags}
                  onEdit={() => {
                    setIsEditingTags(true);
                    setEditedTags(tags);
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const tableName = isLegacy ? 'leads_lead' : 'leads';
                      const idField = isLegacy ? 'id' : 'id';
                      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
                      
                      const { error } = await supabase
                        .from(tableName)
                        .update({
                          [isLegacy ? 'category' : 'tags']: editedTags,
                          [isLegacy ? 'category_last_edited_by' : 'tags_last_edited_by']: userName,
                          [isLegacy ? 'category_last_edited_at' : 'tags_last_edited_at']: new Date().toISOString(),
                        })
                        .eq(idField, clientId);
                      
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
                  editButtonClassName="btn btn-ghost btn-sm"
                  editIconClassName="w-5 h-5 text-black"
                />
              </div>
              <div className="border-b border-gray-200 mt-2"></div>
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
                  <div className="min-h-[80px]">
                    {tags ? (
                      <p className={`text-gray-900 whitespace-pre-wrap break-words ${getTextAlignment(tags)}`}>{tags}</p>
                    ) : (
                      <span className="text-gray-500">No tags added</span>
                    )}
                  </div>
                  {(getFieldValue(client, isLegacy ? 'category_last_edited_by' : 'tags_last_edited_by') || getFieldValue(client, isLegacy ? 'category_last_edited_at' : 'tags_last_edited_at')) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {getFieldValue(client, isLegacy ? 'category_last_edited_by' : 'tags_last_edited_by') || 'Unknown'}</span>
                      <span>{getFieldValue(client, isLegacy ? 'category_last_edited_at' : 'tags_last_edited_at') ? new Date(getFieldValue(client, isLegacy ? 'category_last_edited_at' : 'tags_last_edited_at')).toLocaleString() : ''}</span>
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