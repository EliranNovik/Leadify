import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import { InformationCircleIcon, ExclamationCircleIcon, PencilIcon, CheckIcon, XMarkIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import TimelineHistoryButtons from './TimelineHistoryButtons';

// Helper function to decode HTML entities
const decodeHtmlEntities = (text: string): string => {
  if (!text) return '';
  
  // Create a temporary DOM element to decode HTML entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};

// Helper function to strip HTML tags from text
const stripHtmlTags = (text: string): string => {
  if (!text) return '';
  
  // First decode HTML entities
  let decoded = decodeHtmlEntities(text);
  
  // Decode HTML entities again in case there were double-encoded entities
  decoded = decodeHtmlEntities(decoded);
  
  // Convert common HTML line breaks and block elements to newlines before stripping tags
  // Order matters: process block-level elements first, then inline breaks
  decoded = decoded.replace(/<\/p>/gi, '\n\n'); // Paragraphs get double newline
  decoded = decoded.replace(/<\/div>/gi, '\n'); // Divs get single newline
  decoded = decoded.replace(/<\/tr>/gi, '\n'); // Table rows get newline
  decoded = decoded.replace(/<\/td>/gi, ' '); // Table cells get space
  decoded = decoded.replace(/<\/th>/gi, ' '); // Table headers get space
  decoded = decoded.replace(/<\/li>/gi, '\n'); // List items get newline
  decoded = decoded.replace(/<\/h[1-6]>/gi, '\n\n'); // Headings get double newline
  decoded = decoded.replace(/<br\s*\/?>/gi, '\n'); // Line breaks get newline
  decoded = decoded.replace(/<\/blockquote>/gi, '\n\n'); // Blockquotes get double newline
  
  // Remove HTML tags using regex (non-greedy match)
  const withoutTags = decoded.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities one more time to catch any remaining entities
  let finalDecoded = decodeHtmlEntities(withoutTags);
  
  // Convert underscores to spaces for better readability
  finalDecoded = finalDecoded.replace(/_/g, ' ');
  
  // Clean up whitespace while preserving line breaks
  // Replace multiple spaces/tabs with single space (but not newlines)
  finalDecoded = finalDecoded.replace(/[ \t]+/g, ' '); // Collapse horizontal whitespace to single space
  // Remove spaces at the start of lines
  finalDecoded = finalDecoded.replace(/^[ \t]+/gm, '');
  // Remove spaces at the end of lines
  finalDecoded = finalDecoded.replace(/[ \t]+$/gm, '');
  // Collapse 3+ consecutive newlines to max 2 newlines
  finalDecoded = finalDecoded.replace(/\n{3,}/g, '\n\n');
  
  return finalDecoded.trim();
};

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
    // Handle both string and number formats
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
    
    if (!facts) {
      return [];
    }
    
    try {
      // Try to parse as JSON first
      const parsedFacts = JSON.parse(facts);
      
      // If it's an object, extract non-null values
      if (typeof parsedFacts === 'object' && parsedFacts !== null) {
        const nonNullFacts = Object.entries(parsedFacts)
          .filter(([key, value]) => value !== null && value !== undefined && value !== '')
          .map(([key, value]) => {
            // Convert "n/" to line break in values
            let processedValue = typeof value === 'string' ? value.replace(/n\//g, '\n') : String(value || '');
            // Strip HTML tags from the value
            processedValue = stripHtmlTags(processedValue);
            return { key, value: processedValue };
          });
        
        return nonNullFacts;
      }
      
      // If it's not an object, treat as plain text
      // Convert "n/" to line break and strip HTML tags
      let processedFacts = typeof facts === 'string' ? facts.replace(/n\//g, '\n') : String(facts || '');
      processedFacts = stripHtmlTags(processedFacts);
      const result = [{ key: 'facts', value: processedFacts }];
      return result;
    } catch (error) {
      // If JSON parsing fails, treat as plain text
      // Convert "n/" to line break and strip HTML tags
      let processedFacts = typeof facts === 'string' ? facts.replace(/n\//g, '\n') : String(facts || '');
      processedFacts = stripHtmlTags(processedFacts);
      const result = [{ key: 'facts', value: processedFacts }];
      return result;
    }
  };

  // State for eligibility status and section eligibility (for legacy leads)
  const [eligibilityStatus, setEligibilityStatus] = useState<string>('');
  const [sectionEligibility, setSectionEligibility] = useState<string>('');

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
        // Priority: Use eligibility_status if it exists, otherwise map from expert_examination
        let eligibilityValue = '';
        
        if (data.eligibility_status) {
          eligibilityValue = data.eligibility_status;
        } else {
          // Fallback: Map expert_examination to eligibility status
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
        
        console.log('✅ InfoTab - Legacy eligibility data loaded:', {
          eligibility_status: data.eligibility_status,
          expert_examination: data.expert_examination,
          final_eligibility: eligibilityValue,
          section_eligibility: data.section_eligibility
        });
      }
    } catch (error) {
      console.error('Error in fetchLegacyEligibilityData:', error);
    }
  };

  // Fetch eligibility data for legacy leads on mount
  useEffect(() => {
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    if (isLegacyLead) {
      fetchLegacyEligibilityData();
    } else {
      // For new leads, use client data
      setEligibilityStatus(getFieldValue(client, 'eligibility_status') || '');
      setSectionEligibility(getFieldValue(client, 'section_eligibility') || '');
    }
  }, [client?.id, client?.lead_type]);

  const getEligibilityStatus = () => {
    // For legacy leads, use state (fetched from database)
    // For new leads, use client data
    if (isLegacy) {
      return eligibilityStatus;
    }
    return getFieldValue(client, 'eligibility_status') || '';
  };

  const getEligibleStatus = () => {
    // For new leads, 'eligible' is a boolean
    // For legacy leads, 'eligibile' is stored as 'true'/'false' strings (TEXT column)
    if (isLegacy) {
      const eligibile = getFieldValue(client, 'eligibile');
      return eligibile === 'true' || eligibile === true;
    }
    return getFieldValue(client, 'eligible') === true || getFieldValue(client, 'eligible') === 'true';
  };

  // State for current user's follow-up
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserFollowup, setCurrentUserFollowup] = useState<string | null>(null);
  const [followupId, setFollowupId] = useState<number | null>(null);

  const getNextFollowup = () => {
    // Return the current user's follow-up from the follow_ups table
    return currentUserFollowup;
  };

  const [probability, setProbability] = useState(getProbability());
  const [isEditingSpecialNotes, setIsEditingSpecialNotes] = useState(false);
  const [isEditingGeneralNotes, setIsEditingGeneralNotes] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [isEditingAnchor, setIsEditingAnchor] = useState(false);
  const [isEditingFacts, setIsEditingFacts] = useState(false);
  const [eligible, setEligible] = useState(getEligibleStatus());
  const [isAddingFollowup, setIsAddingFollowup] = useState(false);
  const [isEditingFollowup, setIsEditingFollowup] = useState(false);
  const [followupDate, setFollowupDate] = useState('');
  
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

  // Tags state and functionality
  const [allTags, setAllTags] = useState<any[]>([]);
  const [tagsList, setTagsList] = useState<string[]>([]);

  // Fetch all tags on mount
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const { data: tagsData, error: tagsError } = await supabase
          .from('misc_leadtag')
          .select('id, name, order')
          .eq('active', true)
          .order('order', { ascending: true });
        
        if (!tagsError && tagsData) {
          setAllTags(tagsData);
          const tagNames = tagsData.map(tag => tag.name);
          setTagsList(tagNames);
        }
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    
    fetchTags();
  }, []);

  // Fetch current lead tags
  const fetchCurrentLeadTags = async (leadId: string) => {
    try {
      const isLegacy = leadId.toString().startsWith('legacy_');
      
      if (isLegacy) {
        const legacyId = parseInt(leadId.replace('legacy_', ''));
        const { data, error } = await supabase
          .from('leads_lead_tags')
          .select(`
            id,
            leadtag_id,
            misc_leadtag (
              id,
              name
            )
          `)
          .eq('lead_id', legacyId);
        
        if (!error && data) {
          const tags = data
            .filter(item => item.misc_leadtag && typeof item.misc_leadtag === 'object')
            .map(item => (item.misc_leadtag as any).name);
          return tags.join(', ');
        }
      } else {
        const { data, error } = await supabase
          .from('leads_lead_tags')
          .select(`
            id,
            leadtag_id,
            misc_leadtag (
              id,
              name
            )
          `)
          .eq('newlead_id', leadId);
        
        if (!error && data) {
          const tags = data
            .filter(item => item.misc_leadtag && typeof item.misc_leadtag === 'object')
            .map(item => (item.misc_leadtag as any).name);
          return tags.join(', ');
        }
      }
      return '';
    } catch (error) {
      console.error('Error fetching current lead tags:', error);
      return '';
    }
  };

  // Save lead tags
  const saveLeadTags = async (leadId: string, tagsString: string) => {
    try {
      const isLegacy = leadId.toString().startsWith('legacy_');
      
      if (isLegacy) {
        const legacyId = parseInt(leadId.replace('legacy_', ''));
        await supabase
          .from('leads_lead_tags')
          .delete()
          .eq('lead_id', legacyId);
        
        if (tagsString.trim()) {
          const tagNames = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
          const tagIds = tagNames
            .map(tagName => allTags.find(tag => tag.name === tagName)?.id)
            .filter(id => id !== undefined);
          
          if (tagIds.length > 0) {
            const tagInserts = tagIds.map(tagId => ({
              lead_id: legacyId,
              leadtag_id: tagId
            }));
            await supabase.from('leads_lead_tags').insert(tagInserts);
          }
        }
      } else {
        await supabase
          .from('leads_lead_tags')
          .delete()
          .eq('newlead_id', leadId);
        
        if (tagsString.trim()) {
          const tagNames = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
          const tagIds = tagNames
            .map(tagName => allTags.find(tag => tag.name === tagName)?.id)
            .filter(id => id !== undefined);
          
          if (tagIds.length > 0) {
            const tagInserts = tagIds.map(tagId => ({
              newlead_id: leadId,
              leadtag_id: tagId
            }));
            await supabase.from('leads_lead_tags').insert(tagInserts);
          }
        }
      }
    } catch (error) {
      console.error('Error saving tags:', error);
    }
  };

  // Update tags when client changes
  useEffect(() => {
    const loadTags = async () => {
      const tagsString = await fetchCurrentLeadTags(client.id);
      setTags(tagsString);
      setEditedTags(tagsString);
    };
    
    if (client?.id) {
      loadTags();
    }
  }, [client?.id]);

  // Update probability when client changes
  useEffect(() => {
    const newProbability = getProbability();
    setProbability(newProbability);
  }, [client?.probability, client?.id]);

  // Update eligible status when client changes
  // Only update if we're not currently toggling (to prevent race condition)
  const [isTogglingEligible, setIsTogglingEligible] = useState(false);
  
  useEffect(() => {
    if (!isTogglingEligible) {
      setEligible(getEligibleStatus());
    }
  }, [client, isTogglingEligible]);

  // State to hold current user's display name
  const [currentUserName, setCurrentUserName] = useState<string>('Unknown');

  // Fetch current user ID and name
  useEffect(() => {
    async function fetchUserInfo() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && user.email) {
          const { data: userProfile } = await supabase
            .from('users')
            .select('id, full_name, email')
            .eq('email', user.email)
            .single();
          if (userProfile) {
            setCurrentUserId(userProfile.id);
            if (userProfile.full_name) {
              setCurrentUserName(userProfile.full_name);
            } else {
              setCurrentUserName(userProfile.email || 'Unknown');
            }
          }
        }
      } catch (error) {
        console.error('Error fetching user info:', error);
      }
    }
    fetchUserInfo();
  }, []);

  // Fetch current user's follow-up for this lead
  useEffect(() => {
    const fetchUserFollowup = async () => {
      if (!currentUserId || !client?.id) {
        setCurrentUserFollowup(null);
        setFollowupId(null);
        return;
      }

      try {
        let query;

        if (isLegacy) {
          const legacyId = client.id.toString().replace('legacy_', '');
          query = supabase
            .from('follow_ups')
            .select('id, date')
            .eq('lead_id', legacyId)
            .eq('user_id', currentUserId)
            .is('new_lead_id', null)
            .maybeSingle();
        } else {
          query = supabase
            .from('follow_ups')
            .select('id, date')
            .eq('new_lead_id', client.id)
            .eq('user_id', currentUserId)
            .is('lead_id', null)
            .maybeSingle();
        }

        const { data, error } = await query;

        if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned", which is fine
          console.error('Error fetching follow-up:', error);
          return;
        }

        if (data) {
          setFollowupId(data.id);
          // Convert date to string format for display
          const dateStr = data.date ? new Date(data.date).toISOString().split('T')[0] : null;
          setCurrentUserFollowup(dateStr);
        } else {
          setFollowupId(null);
          setCurrentUserFollowup(null);
        }
      } catch (error) {
        console.error('Error fetching user follow-up:', error);
        setCurrentUserFollowup(null);
        setFollowupId(null);
      }
    };

    fetchUserFollowup();
  }, [currentUserId, client?.id]);

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

  const handleEligibleToggle = async (newEligible: boolean) => {
    setIsTogglingEligible(true);
    
    try {
      console.log('🔍 handleEligibleToggle - Starting:', {
        isLegacy,
        clientId: client.id,
        newEligible,
        currentEligible: eligible
      });

      // Optimistically update the UI first
      setEligible(newEligible);

      const tableName = isLegacy ? 'leads_lead' : 'leads';
      const idField = isLegacy ? 'id' : 'id';
      
      // Extract legacy ID - use string format like handleProbabilityChange does
      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
      
      console.log('🔍 handleEligibleToggle - Extracted ID:', {
        original: client.id,
        extracted: clientId,
        type: typeof clientId
      });
      
      // For legacy leads, convert boolean to 'true'/'false' strings (TEXT column)
      // For new leads, use boolean
      const updateData = isLegacy 
        ? { eligibile: (newEligible ? 'true' : 'false') } 
        : { eligible: newEligible };

      console.log('🔍 handleEligibleToggle - Update query:', {
        tableName,
        idField,
        clientId,
        updateData
      });

      // Try with string ID first (like handleProbabilityChange)
      let result = await supabase
        .from(tableName)
        .update(updateData)
        .eq(idField, clientId)
        .select();
      
      // If that fails and it's a legacy lead, try with number format
      if (result.error && isLegacy) {
        console.log('⚠️ handleEligibleToggle - String ID failed, trying number format');
        const numericId = parseInt(clientId, 10);
        result = await supabase
          .from(tableName)
          .update(updateData)
          .eq(idField, numericId)
          .select();
      }
      
      console.log('🔍 handleEligibleToggle - Update result:', { data: result.data, error: result.error });
      
      if (result.error) {
        console.error('❌ Error updating eligible status:', result.error);
        // Revert optimistic update on error
        setEligible(!newEligible);
        alert(`Failed to update eligible status: ${result.error.message || result.error.code || 'Unknown error'}`);
        return;
      }
      
      if (!result.data || result.data.length === 0) {
        console.warn('⚠️ handleEligibleToggle - No rows updated');
        // Revert optimistic update
        setEligible(!newEligible);
        alert('No rows were updated. Please check the lead ID.');
        return;
      }
      
      console.log('✅ handleEligibleToggle - Successfully updated:', result.data);
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error: any) {
      console.error('❌ Error updating eligible status:', error);
      // Revert optimistic update on error
      setEligible(!newEligible);
      alert(`Failed to update eligible status: ${error?.message || 'Unknown error'}`);
    } finally {
      // Allow useEffect to sync state after a short delay
      setTimeout(() => {
        setIsTogglingEligible(false);
      }, 500);
    }
  };

  const handleAddFollowup = async () => {
    if (!followupDate) {
      alert('Please select a follow-up date');
      return;
    }

    if (!currentUserId) {
      alert('User not authenticated');
      return;
    }

    try {
      const insertData: any = {
        user_id: currentUserId,
        date: followupDate + 'T00:00:00Z', // Convert to timestamp format
        created_at: new Date().toISOString()
      };

      if (isLegacy) {
        const legacyId = client.id.toString().replace('legacy_', '');
        insertData.lead_id = legacyId;
        insertData.new_lead_id = null;
      } else {
        insertData.new_lead_id = client.id;
        insertData.lead_id = null;
      }

      const { data, error } = await supabase
        .from('follow_ups')
        .insert(insertData)
        .select('id')
        .single();

      if (error) throw error;

      // Update local state
      if (data) {
        setFollowupId(data.id);
        setCurrentUserFollowup(followupDate);
      }
      
      setIsAddingFollowup(false);
      setIsEditingFollowup(false);
      setFollowupDate('');
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error adding follow-up:', error);
      alert('Failed to add follow-up date');
    }
  };

  const handleUpdateFollowup = async () => {
    if (!followupDate) {
      alert('Please select a follow-up date');
      return;
    }

    if (!followupId || !currentUserId) {
      alert('Follow-up not found or user not authenticated');
      return;
    }

    try {
      const { error } = await supabase
        .from('follow_ups')
        .update({ 
          date: followupDate + 'T00:00:00Z' // Convert to timestamp format
        })
        .eq('id', followupId)
        .eq('user_id', currentUserId);
      
      if (error) throw error;
      
      // Update local state
      setCurrentUserFollowup(followupDate);
      setIsEditingFollowup(false);
      setFollowupDate('');
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error updating follow-up:', error);
      alert('Failed to update follow-up date');
    }
  };

  const handleDeleteFollowup = async () => {
    if (!window.confirm('Are you sure you want to delete this follow-up?')) {
      return;
    }

    if (!followupId || !currentUserId) {
      alert('Follow-up not found or user not authenticated');
      return;
    }

    try {
      const { error } = await supabase
        .from('follow_ups')
        .delete()
        .eq('id', followupId)
        .eq('user_id', currentUserId);
      
      if (error) throw error;
      
      // Update local state
      setFollowupId(null);
      setCurrentUserFollowup(null);
      setIsEditingFollowup(false);
      setFollowupDate('');
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error deleting follow-up:', error);
      alert('Failed to delete follow-up date');
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
  const nextFollowupValue = getNextFollowup();
  const nextFollowupDate = nextFollowupValue ? new Date(nextFollowupValue) : null;
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
                {nextFollowupDate && !isEditingFollowup ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-500">Next Follow-up</span>
                      <span className="text-base font-semibold text-gray-900">{nextFollowupDate.toLocaleDateString()}</span>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        className="btn btn-primary btn-sm gap-2"
                        onClick={() => {
                          setIsEditingFollowup(true);
                          setFollowupDate(nextFollowupDate.toISOString().split('T')[0]);
                        }}
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                        Change Follow-up
                      </button>
                      <button
                        className="btn btn-ghost btn-sm gap-2 text-gray-700 hover:text-gray-900"
                        onClick={handleDeleteFollowup}
                      >
                        <TrashIcon className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                ) : isAddingFollowup || isEditingFollowup ? (
                  <div className="space-y-3">
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-gray-500">Select Follow-up Date</label>
                      <input
                        type="date"
                        className="input input-bordered w-full"
                        value={followupDate}
                        onChange={(e) => setFollowupDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setIsAddingFollowup(false);
                          setIsEditingFollowup(false);
                          setFollowupDate('');
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={isEditingFollowup ? handleUpdateFollowup : handleAddFollowup}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-4">
                    <p className="text-sm text-gray-500 mb-3">No follow-up scheduled</p>
                    <button
                      className="btn btn-primary btn-sm gap-2"
                      onClick={() => setIsAddingFollowup(true)}
                    >
                      <PlusIcon className="w-4 h-4" />
                      Add Follow-up
                    </button>
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
                    // Get section_eligibility - use state for legacy leads, client data for new leads
                    const currentSection = isLegacy ? sectionEligibility : (client.section_eligibility ?? '');
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
                  <input
                    type="checkbox"
                    className="toggle toggle-success"
                    checked={eligible}
                    onChange={(e) => handleEligibleToggle(e.target.checked)}
                  />
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
                      
                      if (isLegacy) {
                        // For legacy leads, convert ID to integer
                        const legacyIdStr = client.id.toString().replace('legacy_', '');
                        const legacyId = parseInt(legacyIdStr, 10);
                        
                        if (isNaN(legacyId)) {
                          console.error('Invalid legacy ID:', legacyIdStr);
                          throw new Error('Invalid legacy ID');
                        }
                        
                        const { data, error } = await supabase
                          .from(tableName)
                          .update({
                            special_notes: formatNoteText(editedSpecialNotes),
                            special_notes_last_edited_by: userName,
                            special_notes_last_edited_at: new Date().toISOString(),
                          })
                          .eq('id', legacyId)
                          .select('special_notes')
                          .single();
                        
                        if (error) throw error;
                        
                        setSpecialNotes(formatNoteText(editedSpecialNotes).split('\n').filter(note => note.trim() !== ''));
                        setIsEditingSpecialNotes(false);
                      } else {
                        // For new leads, use UUID directly
                        const { data, error } = await supabase
                          .from(tableName)
                          .update({
                            special_notes: formatNoteText(editedSpecialNotes),
                            special_notes_last_edited_by: userName,
                            special_notes_last_edited_at: new Date().toISOString(),
                          })
                          .eq('id', client.id)
                          .select('special_notes')
                          .single();
                        
                        if (error) throw error;
                        
                        setSpecialNotes(formatNoteText(editedSpecialNotes).split('\n').filter(note => note.trim() !== ''));
                        setIsEditingSpecialNotes(false);
                      }
                      
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
                      
                      if (isLegacy) {
                        // For legacy leads, convert ID to integer
                        const legacyIdStr = client.id.toString().replace('legacy_', '');
                        const legacyId = parseInt(legacyIdStr, 10);
                        
                        if (isNaN(legacyId)) {
                          console.error('Invalid legacy ID:', legacyIdStr);
                          throw new Error('Invalid legacy ID');
                        }
                        
                        const { data, error } = await supabase
                          .from(tableName)
                          .update({
                            notes: formatNoteText(editedGeneralNotes),
                            notes_last_edited_by: userName,
                            notes_last_edited_at: new Date().toISOString(),
                          })
                          .eq('id', legacyId)
                          .select('notes')
                          .single();
                        
                        if (error) throw error;
                        
                        setGeneralNotes(formatNoteText(editedGeneralNotes));
                        setIsEditingGeneralNotes(false);
                      } else {
                        // For new leads, use UUID directly
                        const { data, error } = await supabase
                          .from(tableName)
                          .update({
                            general_notes: formatNoteText(editedGeneralNotes),
                            general_notes_last_edited_by: userName,
                            general_notes_last_edited_at: new Date().toISOString(),
                          })
                          .eq('id', client.id)
                          .select('general_notes')
                          .single();
                        
                        if (error) throw error;
                        
                        setGeneralNotes(formatNoteText(editedGeneralNotes));
                        setIsEditingGeneralNotes(false);
                      }
                      
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

        {/* Row 4: Facts of Case and Tags */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 gap-y-12">
          {/* Facts of Case */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-black">Facts of Case</h4>
                <EditButtons
                  isEditing={isEditingFacts}
                  onEdit={() => {
                    setIsEditingFacts(true);
                    // Join facts with line breaks, preserving any existing line breaks from "n/" conversion
                    // Only add "key: " prefix if key is not 'facts' or if there are multiple facts with different keys
                    const hasMultipleKeys = factsOfCase.length > 1 && new Set(factsOfCase.map(f => f.key)).size > 1;
                    setEditedFacts(factsOfCase.map(fact => {
                      // If all facts have the same key 'facts', don't add the prefix
                      // If there are multiple different keys, add the prefix
                      if (hasMultipleKeys || (fact.key !== 'facts' && fact.key)) {
                        return `${fact.key}: ${fact.value}`;
                      } else {
                        return fact.value;
                      }
                    }).join('\n'));
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const tableName = isLegacy ? 'leads_lead' : 'leads';
                      const formattedFacts = formatNoteText(editedFacts);
                      
                      if (isLegacy) {
                        // For legacy leads, convert ID to integer
                        const legacyIdStr = client.id.toString().replace('legacy_', '');
                        const legacyId = parseInt(legacyIdStr, 10);
                        
                        if (isNaN(legacyId)) {
                          console.error('Invalid legacy ID:', legacyIdStr);
                          throw new Error('Invalid legacy ID');
                        }
                        
                        const { data, error } = await supabase
                          .from(tableName)
                          .update({
                            description: formattedFacts,
                            description_last_edited_by: userName,
                            description_last_edited_at: new Date().toISOString(),
                          })
                          .eq('id', legacyId)
                          .select('description')
                          .single();
                        
                        if (error) {
                          throw error;
                        }
                      } else {
                        // For new leads, use UUID directly
                        const { data, error } = await supabase
                          .from(tableName)
                          .update({
                            facts: formattedFacts,
                            facts_last_edited_by: userName,
                            facts_last_edited_at: new Date().toISOString(),
                          })
                          .eq('id', client.id)
                          .select('facts')
                          .single();
                        
                        if (error) throw error;
                      }
                      
                      // Process edited facts: convert "n/" to line breaks, then parse
                      const processedFacts = formattedFacts.replace(/n\//g, '\n');
                      const factsArray = processedFacts.split('\n').filter(fact => fact.trim() !== '').map(line => {
                        const trimmedLine = line.trim();
                        const colonIndex = trimmedLine.indexOf(':');
                        if (colonIndex > 0 && colonIndex < trimmedLine.length - 1) {
                          const key = trimmedLine.substring(0, colonIndex).trim();
                          const value = trimmedLine.substring(colonIndex + 1).trim();
                          return { key: key || 'facts', value: value };
                        } else {
                          return { key: 'facts', value: trimmedLine };
                        }
                      });
                      
                      setFactsOfCase(factsArray);
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
                    {(() => {
                      if (factsOfCase.length > 0) {
                        // Process facts: HTML tags are already stripped in getFacts(), just format for display
                        const processedFacts = factsOfCase.map((fact, index) => {
                          // Convert "n/" to line break in display (HTML tags already stripped)
                          const displayValue = typeof fact.value === 'string' ? fact.value.replace(/n\//g, '\n') : String(fact.value || '');
                          // Only add "key: " prefix if key is not 'facts' or if there are multiple facts with different keys
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
                      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
                      
                      // Use saveLeadTags function for proper tag management
                      await saveLeadTags(client.id, editedTags);
                      
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
                <>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="Search or select tags..."
                    value={editedTags}
                    onChange={(e) => setEditedTags(e.target.value)}
                    list="tags-options"
                  />
                  <datalist id="tags-options">
                    {tagsList.map((name, index) => (
                      <option key={`${name}-${index}`} value={name} />
                    ))}
                  </datalist>
                </>
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

        {/* Row 5: Anchor - COMMENTED OUT */}
        {/* <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 gap-y-12">
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
        </div> */}
      </div>
      
      <TimelineHistoryButtons client={client} />
    </div>
  );
};

export default InfoTab; 