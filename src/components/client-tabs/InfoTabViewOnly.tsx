import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';

// Helper function to decode HTML entities
const decodeHtmlEntities = (text: string): string => {
  if (!text) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};

// Helper function to strip HTML tags from text
const stripHtmlTags = (text: string): string => {
  if (!text) return '';
  let decoded = decodeHtmlEntities(text);
  decoded = decodeHtmlEntities(decoded);
  decoded = decoded.replace(/<\/p>/gi, '\n\n');
  decoded = decoded.replace(/<\/div>/gi, '\n');
  decoded = decoded.replace(/<\/tr>/gi, '\n');
  decoded = decoded.replace(/<\/td>/gi, ' ');
  decoded = decoded.replace(/<\/th>/gi, ' ');
  decoded = decoded.replace(/<\/li>/gi, '\n');
  decoded = decoded.replace(/<\/h[1-6]>/gi, '\n\n');
  decoded = decoded.replace(/<br\s*\/?>/gi, '\n');
  decoded = decoded.replace(/<\/blockquote>/gi, '\n\n');
  const withoutTags = decoded.replace(/<[^>]*>/g, '');
  let finalDecoded = decodeHtmlEntities(withoutTags);
  finalDecoded = finalDecoded.replace(/_/g, ' ');
  finalDecoded = finalDecoded.replace(/[ \t]+/g, ' ');
  finalDecoded = finalDecoded.replace(/^[ \t]+/gm, '');
  finalDecoded = finalDecoded.replace(/[ \t]+$/gm, '');
  finalDecoded = finalDecoded.replace(/\n{3,}/g, '\n\n');
  return finalDecoded.trim();
};

// Helper function to clean up text formatting
const formatNoteText = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
};

// Helper function to detect Hebrew text and apply RTL alignment
const getTextAlignment = (text: string): string => {
  if (!text) return 'text-left';
  const hebrewRegex = /[\u0590-\u05FF]/;
  return hebrewRegex.test(text) ? 'text-right' : 'text-left';
};

// Helper function to get the correct field value based on lead type
const getFieldValue = (client: any, fieldName: string, legacyFieldName?: string) => {
  if (client.lead_type === 'legacy') {
    const fieldToUse = legacyFieldName || fieldName;
    return client[fieldToUse];
  }
  return client[fieldName];
};

// Helper function to determine if this is a legacy lead
const isLegacyLead = (client: any) => {
  return client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
};

const InfoTabViewOnly: React.FC<ClientTabProps> = ({ client }) => {
  if (!client) {
    return <div className="flex justify-center items-center h-32"><span className="loading loading-spinner loading-md text-primary"></span></div>;
  }

  const isLegacy = isLegacyLead(client);

  // Get field values with proper mapping for legacy leads
  const getProbability = () => {
    const prob = getFieldValue(client, 'probability');
    if (typeof prob === 'string') {
      return prob === '' ? 50 : (parseInt(prob) || 50);
    }
    return prob !== null && prob !== undefined ? Number(prob) : 50;
  };

  const getSpecialNotes = () => {
    const notes = getFieldValue(client, 'special_notes');
    return notes ? [notes] : [];
  };

  const getGeneralNotes = () => {
    const notes = isLegacy ? getFieldValue(client, 'notes') : getFieldValue(client, 'general_notes');
    return notes || '';
  };

  const getTags = () => {
    const tags = isLegacy ? getFieldValue(client, 'category') : getFieldValue(client, 'tags');
    return tags || '';
  };

  const getFacts = () => {
    const facts = isLegacy ? getFieldValue(client, 'description') : getFieldValue(client, 'facts');
    
    if (!facts) {
      return [];
    }
    
    try {
      const parsedFacts = JSON.parse(facts);
      
      if (typeof parsedFacts === 'object' && parsedFacts !== null) {
        const nonNullFacts = Object.entries(parsedFacts)
          .filter(([key, value]) => value !== null && value !== undefined && value !== '')
          .map(([key, value]) => {
            let processedValue = typeof value === 'string' ? value.replace(/n\//g, '\n') : String(value || '');
            processedValue = stripHtmlTags(processedValue);
            return { key, value: processedValue };
          });
        
        return nonNullFacts;
      }
      
      let processedFacts = typeof facts === 'string' ? facts.replace(/n\//g, '\n') : String(facts || '');
      processedFacts = stripHtmlTags(processedFacts);
      const result = [{ key: 'facts', value: processedFacts }];
      return result;
    } catch (error) {
      let processedFacts = typeof facts === 'string' ? facts.replace(/n\//g, '\n') : String(facts || '');
      processedFacts = stripHtmlTags(processedFacts);
      const result = [{ key: 'facts', value: processedFacts }];
      return result;
    }
  };

  // State for eligibility status and section eligibility (for legacy leads)
  const [eligibilityStatus, setEligibilityStatus] = useState<string>('');
  const [sectionEligibility, setSectionEligibility] = useState<string>('');
  const [currentUserFollowup, setCurrentUserFollowup] = useState<string | null>(null);

  // Function to fetch eligibility data for legacy leads
  const fetchLegacyEligibilityData = async () => {
    if (!isLegacy || !client?.id) return;
    
    try {
      const legacyId = client.id.toString().replace('legacy_', '');
      const { data, error } = await supabase
        .from('leads_lead')
        .select('expert_examination, section_eligibility, eligibilty_date, eligibility_status, eligibility_status_timestamp')
        .eq('id', legacyId)
        .single();
      
      if (error) {
        console.error('Error fetching legacy eligibility data:', error);
        return;
      }
      
      if (data) {
        let eligibilityValue = '';
        
        if (data.eligibility_status) {
          eligibilityValue = data.eligibility_status;
        } else {
          const examValue = Number(data.expert_examination);
          if (examValue === 8) {
            eligibilityValue = 'feasible_no_check';
          } else if (examValue === 1) {
            eligibilityValue = 'not_feasible';
          } else if (examValue === 5) {
            eligibilityValue = 'feasible_check';
          }
        }
        
        setEligibilityStatus(eligibilityValue);
        setSectionEligibility(data.section_eligibility || '');
      }
    } catch (error) {
      console.error('Error in fetchLegacyEligibilityData:', error);
    }
  };

  // Fetch eligibility data for legacy leads on mount
  useEffect(() => {
    if (isLegacy) {
      fetchLegacyEligibilityData();
    } else {
      setEligibilityStatus(getFieldValue(client, 'eligibility_status') || '');
      setSectionEligibility(getFieldValue(client, 'section_eligibility') || '');
    }
  }, [client?.id, client?.lead_type]);

  const getEligibilityStatus = () => {
    if (isLegacy) {
      return eligibilityStatus;
    }
    return getFieldValue(client, 'eligibility_status') || '';
  };

  const getEligibleStatus = () => {
    if (isLegacy) {
      const eligibile = getFieldValue(client, 'eligibile');
      return eligibile === 'true' || eligibile === true;
    }
    return getFieldValue(client, 'eligible') === true || getFieldValue(client, 'eligible') === 'true';
  };

  // Fetch current user's follow-up
  useEffect(() => {
    const fetchUserFollowup = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) return;

        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('email', user.email)
          .single();

        if (!userData?.id) return;

        const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
        const { data: followupData } = await supabase
          .from('follow_ups')
          .select('follow_up_date')
          .eq('lead_id', clientId)
          .eq('user_id', userData.id)
          .order('follow_up_date', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (followupData?.follow_up_date) {
          setCurrentUserFollowup(followupData.follow_up_date);
        }
      } catch (error) {
        console.error('Error fetching user follow-up:', error);
      }
    };

    fetchUserFollowup();
  }, [client?.id, isLegacy]);

  const getNextFollowup = () => {
    return currentUserFollowup;
  };

  const probability = getProbability();
  const eligible = getEligibleStatus();
  const specialNotes = getSpecialNotes();
  const generalNotes = getGeneralNotes();
  const tags = getTags();
  const factsOfCase = getFacts();

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
  const nextFollowupValue = getNextFollowup();
  const nextFollowupDate = nextFollowupValue ? new Date(nextFollowupValue) : null;
  let followupStatus = '';
  let followupCountdown = '';
  if (nextFollowupDate) {
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

  // Get section eligibility for display
  const currentSection = isLegacy ? sectionEligibility : (client.section_eligibility ?? '');

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
          <p className="text-sm text-gray-500">View client details and case information</p>
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
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className="bg-primary h-2.5 rounded-full" 
                    style={{ width: `${probability}%` }}
                  ></div>
                </div>
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
                {nextFollowupDate ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-500">Next Follow-up</span>
                      <span className="text-base font-semibold text-gray-900">{nextFollowupDate.toLocaleDateString()}</span>
                    </div>
                    {followupStatus && (
                      <div className="text-sm text-gray-600">{followupStatus}</div>
                    )}
                    {followupCountdown && (
                      <div className="text-sm text-gray-600">{followupCountdown}</div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-4">
                    <p className="text-sm text-gray-500">No follow-up scheduled</p>
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
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-500">Expert Status</span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#3b28c7] text-white ${getEligibilityStatus() === 'feasible_no_check' ? 'px-4 py-2 text-base rounded-xl' : ''}`}>
                  {eligibilityDisplay.text}
                  {(() => {
                    if (['feasible_no_check', 'feasible_check'].includes(getEligibilityStatus() ?? '') && currentSection) {
                      const sections = [
                        { value: '116', label: 'German Citizenship - § 116' },
                        { value: '15', label: 'German Citizenship - § 15' },
                        { value: '5', label: 'German Citizenship - § 5' },
                        { value: '58c', label: 'Austrian Citizenship - § 58c' },
                      ];
                      const found = sections.find(s => s.value === currentSection);
                      return (
                        <span className="ml-2 px-2 py-0.5 rounded text-white font-semibold text-xs">
                          {found ? found.label.split(' - ')[1] : currentSection}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                <span className="text-sm font-medium text-gray-500">Eligibility Determined</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700">
                    {eligible ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Special Notes and General Notes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 gap-y-12">
          {/* Special Notes */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <h4 className="text-lg font-semibold text-black">Special Notes</h4>
              <div className="border-b border-gray-200 mt-2"></div>
            </div>
            <div className="p-6">
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
            </div>
          </div>

          {/* General Notes */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <h4 className="text-lg font-semibold text-black">General Notes</h4>
              <div className="border-b border-gray-200 mt-2"></div>
            </div>
            <div className="p-6">
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
            </div>
          </div>
        </div>

        {/* Row 4: Facts of Case and Tags */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 gap-y-12">
          {/* Facts of Case */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <h4 className="text-lg font-semibold text-black">Facts of Case</h4>
              <div className="border-b border-gray-200 mt-2"></div>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                <div className="min-h-[80px]">
                  {(() => {
                    if (factsOfCase.length > 0) {
                      const processedFacts = factsOfCase.map((fact, index) => {
                        const displayValue = typeof fact.value === 'string' ? fact.value.replace(/n\//g, '\n') : String(fact.value || '');
                        const hasMultipleKeys = factsOfCase.length > 1 && new Set(factsOfCase.map(f => f.key)).size > 1;
                        if (hasMultipleKeys || (fact.key !== 'facts' && fact.key)) {
                          return `${fact.key}: ${displayValue}`;
                        } else {
                          return displayValue;
                        }
                      }).join('\n');
                      
                      return (
                        <p className={`text-gray-900 whitespace-pre-wrap break-words ${getTextAlignment(factsOfCase.map(fact => fact.value).join('\n'))}`}>
                          {processedFacts}
                        </p>
                      );
                    } else {
                      return <span className="text-gray-500">No case facts added</span>;
                    }
                  })()}
                </div>
                {(getFieldValue(client, isLegacy ? 'description_last_edited_by' : 'facts_last_edited_by') || getFieldValue(client, isLegacy ? 'description_last_edited_at' : 'facts_last_edited_at')) && (
                  <div className="text-xs text-gray-400 flex justify-between">
                    <span>Last edited by {getFieldValue(client, isLegacy ? 'description_last_edited_by' : 'facts_last_edited_by') || 'Unknown'}</span>
                    <span>{getFieldValue(client, isLegacy ? 'description_last_edited_at' : 'facts_last_edited_at') ? new Date(getFieldValue(client, isLegacy ? 'description_last_edited_at' : 'facts_last_edited_at')).toLocaleString() : ''}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <h4 className="text-lg font-semibold text-black">Tags</h4>
              <div className="border-b border-gray-200 mt-2"></div>
            </div>
            <div className="p-6">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InfoTabViewOnly;
